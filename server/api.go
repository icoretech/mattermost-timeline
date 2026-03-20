package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()

	// Webhook endpoint — authenticated via shared secret, no Mattermost session required
	router.HandleFunc("/webhook", p.handleWebhook).Methods(http.MethodPost)

	// Internal API — requires Mattermost session
	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.Use(p.mattermostAuthRequired)
	apiRouter.HandleFunc("/events", p.handleGetEvents).Methods(http.MethodGet)
	apiRouter.HandleFunc("/events/{eventId}/reactions/{icon}", p.handleAddReaction).Methods(http.MethodPut)
	apiRouter.HandleFunc("/events/{eventId}/reactions/{icon}", p.handleRemoveReaction).Methods(http.MethodDelete)
	apiRouter.HandleFunc("/events/{eventId}/reactions/{icon}", p.handleGetReactionUsers).Methods(http.MethodGet)

	return router
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

func (p *Plugin) mattermostAuthRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if userID == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// normalizeLinks converts a single legacy link to a links array, or returns the payload links.
func normalizeLinks(payload WebhookPayload) []EventLink {
	if len(payload.Links) > 0 {
		return payload.Links
	}
	if payload.Link != "" {
		return []EventLink{{URL: payload.Link}}
	}
	return nil
}

// mergeLinks appends new links to existing ones, deduplicating by URL.
func mergeLinks(existing, incoming []EventLink) []EventLink {
	seen := make(map[string]bool, len(existing))
	for _, l := range existing {
		seen[l.URL] = true
	}
	merged := make([]EventLink, len(existing))
	copy(merged, existing)
	for _, l := range incoming {
		if !seen[l.URL] {
			merged = append(merged, l)
			seen[l.URL] = true
		}
	}
	return merged
}

func (p *Plugin) handleWebhook(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()

	// Validate webhook secret
	if config.WebhookSecret == "" {
		http.Error(w, "Webhook secret not configured", http.StatusInternalServerError)
		return
	}

	secret := r.Header.Get("X-Webhook-Secret")
	if secret != config.WebhookSecret {
		http.Error(w, "Invalid webhook secret", http.StatusUnauthorized)
		return
	}

	// Parse payload
	var payload WebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	if payload.Title == "" {
		http.Error(w, "Title is required", http.StatusBadRequest)
		return
	}

	// Determine team ID from query param or payload
	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		teamID = payload.TeamID
	}
	if teamID == "" {
		http.Error(w, "team_id is required (query param or JSON field)", http.StatusBadRequest)
		return
	}

	// Default event type
	eventType := payload.EventType
	if eventType == "" {
		eventType = "generic"
	}

	// Validate channels
	if len(payload.Channels) > maxChannelsPerEvent {
		http.Error(w, fmt.Sprintf("Maximum %d channels per event", maxChannelsPerEvent), http.StatusBadRequest)
		return
	}
	for _, chID := range payload.Channels {
		ch, appErr := p.API.GetChannel(chID)
		if appErr != nil {
			http.Error(w, fmt.Sprintf("Invalid channel ID: %s", chID), http.StatusBadRequest)
			return
		}
		if ch.TeamId != teamID {
			http.Error(w, fmt.Sprintf("Channel %s does not belong to team %s", chID, teamID), http.StatusBadRequest)
			return
		}
		if ch.Type == model.ChannelTypeDirect || ch.Type == model.ChannelTypeGroup {
			http.Error(w, fmt.Sprintf("DM/GM channels are not supported: %s", chID), http.StatusBadRequest)
			return
		}
	}

	incomingLinks := normalizeLinks(payload)

	// Check for existing event via external_id
	if payload.ExternalID != "" {
		existingID, err := p.store.LookupByExternalID(teamID, payload.ExternalID)
		if err != nil {
			p.API.LogError("Failed to lookup external ID", "error", err.Error())
		}

		if existingID != "" {
			existing, err := p.store.GetEvent(existingID)
			if err != nil {
				p.API.LogError("Failed to get existing event", "error", err.Error())
			}

			if existing != nil {
				oldChannels := existing.Channels

				// Update existing event: replace fields, aggregate links
				existing.Title = payload.Title
				existing.Message = payload.Message
				existing.EventType = eventType
				existing.Source = payload.Source
				existing.Timestamp = time.Now().UnixMilli()
				existing.Links = mergeLinks(existing.Links, incomingLinks)
				existing.Channels = payload.Channels

				if err := p.store.UpdateEvent(teamID, oldChannels, *existing); err != nil {
					p.API.LogError("Failed to update event", "error", err.Error())
					http.Error(w, "Failed to update event", http.StatusInternalServerError)
					return
				}

				eventJSON, err := json.Marshal(existing)
				if err != nil {
					p.API.LogError("Failed to marshal event for broadcast", "error", err.Error())
					http.Error(w, "Failed to serialize event", http.StatusInternalServerError)
					return
				}

				if len(existing.Channels) > 0 {
					for _, chID := range existing.Channels {
						p.API.PublishWebSocketEvent("updated_event", map[string]interface{}{
							"event": string(eventJSON),
						}, &model.WebsocketBroadcast{
							ChannelId: chID,
						})
					}
				} else {
					p.API.PublishWebSocketEvent("updated_event", map[string]interface{}{
						"event": string(eventJSON),
					}, &model.WebsocketBroadcast{
						TeamId: teamID,
					})
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(eventJSON)
				return
			}
		}
	}

	// New event
	event := Event{
		ID:         uuid.New().String(),
		TeamID:     teamID,
		Timestamp:  time.Now().UnixMilli(),
		Title:      payload.Title,
		Message:    payload.Message,
		Links:      incomingLinks,
		EventType:  eventType,
		Source:     payload.Source,
		ExternalID: payload.ExternalID,
		Channels:   payload.Channels,
	}

	if err := p.store.AddEvent(teamID, event); err != nil {
		p.API.LogError("Failed to store event", "error", err.Error())
		http.Error(w, "Failed to store event", http.StatusInternalServerError)
		return
	}

	// Broadcast via WebSocket to team members
	eventJSON, err := json.Marshal(event)
	if err != nil {
		p.API.LogError("Failed to marshal event for broadcast", "error", err.Error())
		http.Error(w, "Failed to serialize event", http.StatusInternalServerError)
		return
	}

	if len(event.Channels) > 0 {
		for _, chID := range event.Channels {
			p.API.PublishWebSocketEvent("new_event", map[string]interface{}{
				"event": string(eventJSON),
			}, &model.WebsocketBroadcast{
				ChannelId: chID,
			})
		}
	} else {
		p.API.PublishWebSocketEvent("new_event", map[string]interface{}{
			"event": string(eventJSON),
		}, &model.WebsocketBroadcast{
			TeamId: teamID,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write(eventJSON)
}

func (p *Plugin) handleGetEvents(w http.ResponseWriter, r *http.Request) {
	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		http.Error(w, "team_id is required", http.StatusBadRequest)
		return
	}

	// Verify user is a member of the team
	userID := r.Header.Get("Mattermost-User-ID")
	_, appErr := p.API.GetTeamMember(teamID, userID)
	if appErr != nil {
		http.Error(w, "Not a member of this team", http.StatusForbidden)
		return
	}

	config := p.getConfiguration()

	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}
	if maxDisplay := config.maxEventsDisplayedInt(); limit > maxDisplay {
		limit = maxDisplay
	}

	channelID := r.URL.Query().Get("channel_id")

	if channelID != "" {
		if _, appErr := p.API.GetChannelMember(channelID, userID); appErr != nil {
			http.Error(w, "Not a member of this channel", http.StatusForbidden)
			return
		}
	}

	var events []Event
	var total int
	var err error

	if channelID != "" {
		events, total, err = p.store.GetEventsByChannel(teamID, channelID, offset, limit)
	} else {
		events, total, err = p.store.GetEvents(teamID, offset, limit)
	}
	if err != nil {
		p.API.LogError("Failed to get events", "error", err.Error())
		http.Error(w, "Failed to get events", http.StatusInternalServerError)
		return
	}

	// Transform reactions to client summaries for the response
	for i := range events {
		if events[i].Reactions != nil {
			events[i].ClientReactions = events[i].Reactions.ToClientSummaries(userID)
			events[i].Reactions = nil // don't send full user_ids list to client
		}
	}

	resp := EventsResponse{
		Events:          events,
		Total:           total,
		TimelineOrder:   config.timelineOrder(),
		EnableReactions: config.enableReactions(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (p *Plugin) handleAddReaction(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.enableReactions() {
		http.Error(w, "Reactions are disabled", http.StatusForbidden)
		return
	}

	vars := mux.Vars(r)
	eventID := vars["eventId"]
	icon := vars["icon"]

	if !AllowedReactions[icon] {
		http.Error(w, "Invalid reaction icon", http.StatusBadRequest)
		return
	}

	userID := r.Header.Get("Mattermost-User-ID")

	event, err := p.store.GetEvent(eventID)
	if err != nil || event == nil {
		http.Error(w, "Event not found", http.StatusNotFound)
		return
	}

	if _, appErr := p.API.GetTeamMember(event.TeamID, userID); appErr != nil {
		http.Error(w, "Not a member of this team", http.StatusForbidden)
		return
	}

	if len(event.Channels) > 0 {
		isMember := false
		for _, chID := range event.Channels {
			if _, appErr := p.API.GetChannelMember(chID, userID); appErr == nil {
				isMember = true
				break
			}
		}
		if !isMember {
			http.Error(w, "Not a member of the event's channel", http.StatusForbidden)
			return
		}
	}

	updated, err := p.store.AddReaction(eventID, icon, userID)
	if err != nil {
		p.API.LogError("Failed to add reaction", "error", err.Error())
		http.Error(w, "Failed to add reaction", http.StatusInternalServerError)
		return
	}

	summary := updated.Reactions[icon]
	reactionJSON, _ := json.Marshal(map[string]interface{}{
		"event_id": eventID,
		"icon":     icon,
		"count":    summary.Count,
		"user_ids": summary.UserIDs,
	})

	if len(updated.Channels) > 0 {
		for _, chID := range updated.Channels {
			p.API.PublishWebSocketEvent("reaction_updated", map[string]interface{}{
				"payload": string(reactionJSON),
			}, &model.WebsocketBroadcast{
				ChannelId: chID,
			})
		}
	} else {
		p.API.PublishWebSocketEvent("reaction_updated", map[string]interface{}{
			"payload": string(reactionJSON),
		}, &model.WebsocketBroadcast{
			TeamId: updated.TeamID,
		})
	}

	clientReactions := updated.Reactions.ToClientSummaries(userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clientReactions)
}

func (p *Plugin) handleRemoveReaction(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.enableReactions() {
		http.Error(w, "Reactions are disabled", http.StatusForbidden)
		return
	}

	vars := mux.Vars(r)
	eventID := vars["eventId"]
	icon := vars["icon"]

	if !AllowedReactions[icon] {
		http.Error(w, "Invalid reaction icon", http.StatusBadRequest)
		return
	}

	userID := r.Header.Get("Mattermost-User-ID")

	event, err := p.store.GetEvent(eventID)
	if err != nil || event == nil {
		http.Error(w, "Event not found", http.StatusNotFound)
		return
	}

	if _, appErr := p.API.GetTeamMember(event.TeamID, userID); appErr != nil {
		http.Error(w, "Not a member of this team", http.StatusForbidden)
		return
	}

	if len(event.Channels) > 0 {
		isMember := false
		for _, chID := range event.Channels {
			if _, appErr := p.API.GetChannelMember(chID, userID); appErr == nil {
				isMember = true
				break
			}
		}
		if !isMember {
			http.Error(w, "Not a member of the event's channel", http.StatusForbidden)
			return
		}
	}

	updated, err := p.store.RemoveReaction(eventID, icon, userID)
	if err != nil {
		p.API.LogError("Failed to remove reaction", "error", err.Error())
		http.Error(w, "Failed to remove reaction", http.StatusInternalServerError)
		return
	}

	var broadcastUserIDs []string
	count := 0
	if summary, ok := updated.Reactions[icon]; ok {
		broadcastUserIDs = summary.UserIDs
		count = summary.Count
	}
	reactionJSON, _ := json.Marshal(map[string]interface{}{
		"event_id": eventID,
		"icon":     icon,
		"count":    count,
		"user_ids": broadcastUserIDs,
	})

	if len(updated.Channels) > 0 {
		for _, chID := range updated.Channels {
			p.API.PublishWebSocketEvent("reaction_updated", map[string]interface{}{
				"payload": string(reactionJSON),
			}, &model.WebsocketBroadcast{
				ChannelId: chID,
			})
		}
	} else {
		p.API.PublishWebSocketEvent("reaction_updated", map[string]interface{}{
			"payload": string(reactionJSON),
		}, &model.WebsocketBroadcast{
			TeamId: updated.TeamID,
		})
	}

	clientReactions := updated.Reactions.ToClientSummaries(userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clientReactions)
}

func (p *Plugin) handleGetReactionUsers(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.enableReactions() {
		http.Error(w, "Reactions are disabled", http.StatusForbidden)
		return
	}

	vars := mux.Vars(r)
	eventID := vars["eventId"]
	icon := vars["icon"]

	userID := r.Header.Get("Mattermost-User-ID")

	event, err := p.store.GetEvent(eventID)
	if err != nil || event == nil {
		http.Error(w, "Event not found", http.StatusNotFound)
		return
	}

	if _, appErr := p.API.GetTeamMember(event.TeamID, userID); appErr != nil {
		http.Error(w, "Not a member of this team", http.StatusForbidden)
		return
	}

	if len(event.Channels) > 0 {
		isMember := false
		for _, chID := range event.Channels {
			if _, appErr := p.API.GetChannelMember(chID, userID); appErr == nil {
				isMember = true
				break
			}
		}
		if !isMember {
			http.Error(w, "Not a member of the event's channel", http.StatusForbidden)
			return
		}
	}

	userIDs, err := p.store.GetReactionUsers(eventID, icon)
	if err != nil {
		http.Error(w, "Failed to get reaction users", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_ids": userIDs,
	})
}
