package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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

const maxWebhookBodyBytes = 256 * 1024

type validatedWebhookRequest struct {
	teamID        string
	payload       WebhookPayload
	eventType     string
	incomingLinks []EventLink
}

type storedWebhookEvent struct {
	event     Event
	status    int
	eventName string
}

type webhookHandlerError struct {
	message string
	status  int
}

func (p *Plugin) handleWebhook(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	validated, handlerErr := p.validateWebhookRequest(w, r, config)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	stored, handlerErr := p.storeWebhookEvent(validated)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	p.publishAndWriteTimelineEventResponse(w, stored.status, stored.eventName, stored.event)
}

func (p *Plugin) validateWebhookRequest(w http.ResponseWriter, r *http.Request, config *configuration) (validatedWebhookRequest, *webhookHandlerError) {
	if config.WebhookSecret == "" {
		return validatedWebhookRequest{}, &webhookHandlerError{message: "Webhook secret not configured", status: http.StatusInternalServerError}
	}

	secret := r.Header.Get("X-Webhook-Secret")
	if secret != config.WebhookSecret {
		return validatedWebhookRequest{}, &webhookHandlerError{message: "Invalid webhook secret", status: http.StatusUnauthorized}
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBodyBytes)

	var payload WebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return validatedWebhookRequest{}, &webhookHandlerError{message: "Payload too large", status: http.StatusRequestEntityTooLarge}
		}
		return validatedWebhookRequest{}, &webhookHandlerError{message: "Invalid JSON payload", status: http.StatusBadRequest}
	}

	if payload.Title == "" {
		return validatedWebhookRequest{}, &webhookHandlerError{message: "Title is required", status: http.StatusBadRequest}
	}

	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		teamID = payload.TeamID
	}
	if teamID == "" {
		return validatedWebhookRequest{}, &webhookHandlerError{message: "team_id is required (query param or JSON field)", status: http.StatusBadRequest}
	}

	eventType := payload.EventType
	if eventType == "" {
		eventType = "generic"
	}

	if len(payload.Channels) > maxChannelsPerEvent {
		return validatedWebhookRequest{}, &webhookHandlerError{message: fmt.Sprintf("Maximum %d channels per event", maxChannelsPerEvent), status: http.StatusBadRequest}
	}
	for _, chID := range payload.Channels {
		ch, appErr := p.API.GetChannel(chID)
		if appErr != nil {
			return validatedWebhookRequest{}, &webhookHandlerError{message: fmt.Sprintf("Invalid channel ID: %s", chID), status: http.StatusBadRequest}
		}
		if ch.TeamId != teamID {
			return validatedWebhookRequest{}, &webhookHandlerError{message: fmt.Sprintf("Channel %s does not belong to team %s", chID, teamID), status: http.StatusBadRequest}
		}
		if ch.Type == model.ChannelTypeDirect || ch.Type == model.ChannelTypeGroup {
			return validatedWebhookRequest{}, &webhookHandlerError{message: fmt.Sprintf("DM/GM channels are not supported: %s", chID), status: http.StatusBadRequest}
		}
	}

	return validatedWebhookRequest{
		teamID:        teamID,
		payload:       payload,
		eventType:     eventType,
		incomingLinks: normalizeLinks(payload),
	}, nil
}

func (p *Plugin) storeWebhookEvent(request validatedWebhookRequest) (storedWebhookEvent, *webhookHandlerError) {
	if request.payload.ExternalID != "" {
		existingID, err := p.store.LookupByExternalID(request.teamID, request.payload.ExternalID)
		if err != nil {
			p.API.LogError("Failed to lookup external ID", "error", err.Error())
			return storedWebhookEvent{}, &webhookHandlerError{message: "Failed to lookup external ID", status: http.StatusInternalServerError}
		}

		if existingID != "" {
			existing, err := p.store.GetEvent(existingID)
			if err != nil {
				p.API.LogError("Failed to get existing event", "error", err.Error())
				return storedWebhookEvent{}, &webhookHandlerError{message: "Failed to get existing event", status: http.StatusInternalServerError}
			}
			if existing == nil {
				p.API.LogError("External ID mapping points to missing event", "event_id", existingID)
				return storedWebhookEvent{}, &webhookHandlerError{message: "Failed to get existing event", status: http.StatusInternalServerError}
			}

			oldChannels := applyWebhookUpdate(existing, request.payload, request.eventType, request.incomingLinks)

			if err := p.store.UpdateEvent(request.teamID, oldChannels, *existing); err != nil {
				p.API.LogError("Failed to update event", "error", err.Error())
				return storedWebhookEvent{}, &webhookHandlerError{message: "Failed to update event", status: http.StatusInternalServerError}
			}

			return storedWebhookEvent{event: *existing, status: http.StatusOK, eventName: "updated_event"}, nil
		}
	}

	event := newWebhookEvent(request.teamID, request.payload, request.eventType, request.incomingLinks)

	if err := p.store.AddEvent(request.teamID, event); err != nil {
		if errors.Is(err, errExternalIDAlreadyExists) {
			return storedWebhookEvent{}, &webhookHandlerError{message: "External ID already exists", status: http.StatusConflict}
		}
		p.API.LogError("Failed to store event", "error", err.Error())
		return storedWebhookEvent{}, &webhookHandlerError{message: "Failed to store event", status: http.StatusInternalServerError}
	}

	return storedWebhookEvent{event: event, status: http.StatusCreated, eventName: "new_event"}, nil
}

func applyWebhookUpdate(existing *Event, payload WebhookPayload, eventType string, incomingLinks []EventLink) []string {
	oldChannels := existing.Channels
	existing.Title = payload.Title
	existing.Message = payload.Message
	existing.EventType = eventType
	existing.Source = payload.Source
	existing.Timestamp = time.Now().UnixMilli()
	existing.Links = mergeLinks(existing.Links, incomingLinks)
	existing.Channels = payload.Channels
	return oldChannels
}

func newWebhookEvent(teamID string, payload WebhookPayload, eventType string, incomingLinks []EventLink) Event {
	return Event{
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
}

func (p *Plugin) publishAndWriteTimelineEventResponse(w http.ResponseWriter, status int, eventName string, event Event) {
	websocketJSON, err := json.Marshal(clientEventFrom(event, ""))
	if err != nil {
		p.API.LogError("Failed to marshal event for broadcast", "error", err.Error())
		http.Error(w, "Failed to serialize event", http.StatusInternalServerError)
		return
	}

	responseJSON, err := json.Marshal(webhookEventResponseFrom(event))
	if err != nil {
		p.API.LogError("Failed to marshal webhook event response", "error", err.Error())
		http.Error(w, "Failed to serialize event", http.StatusInternalServerError)
		return
	}

	p.publishTimelineEvent(eventName, event, websocketJSON)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(responseJSON)
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

	offsetParam := r.URL.Query().Get("offset")
	offset := 0
	if offsetParam != "" {
		parsedOffset, err := strconv.Atoi(offsetParam)
		if err != nil {
			http.Error(w, "offset must be an integer", http.StatusBadRequest)
			return
		}
		offset = parsedOffset
	}
	if offset < 0 {
		http.Error(w, "offset must be non-negative", http.StatusBadRequest)
		return
	}

	limitParam := r.URL.Query().Get("limit")
	limit := 50
	if limitParam != "" {
		parsedLimit, err := strconv.Atoi(limitParam)
		if err != nil {
			http.Error(w, "limit must be an integer", http.StatusBadRequest)
			return
		}
		if parsedLimit <= 0 {
			http.Error(w, "limit must be positive", http.StatusBadRequest)
			return
		}
		limit = parsedLimit
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
		events, total, err = p.store.GetGlobalEvents(teamID, offset, limit)
	}
	if err != nil {
		p.API.LogError("Failed to get events", "error", err.Error())
		http.Error(w, "Failed to get events", http.StatusInternalServerError)
		return
	}

	resp := EventsResponse{
		Events:          clientEventsFrom(events, userID),
		Total:           total,
		TimelineOrder:   config.timelineOrder(),
		EnableReactions: config.enableReactions(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		p.API.LogError("Failed to encode events response", "error", err.Error())
	}
}
