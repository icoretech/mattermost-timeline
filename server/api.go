package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	router.HandleFunc("/webhook/batch", p.handleWebhookBatch).Methods(http.MethodPost)

	// Internal API — requires Mattermost session
	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.Use(p.mattermostAuthRequired)
	apiRouter.HandleFunc("/events", p.handleGetEvents).Methods(http.MethodGet)
	apiRouter.HandleFunc("/events/read", p.handleMarkEventsRead).Methods(http.MethodPost)
	apiRouter.HandleFunc("/admin/webhook-config", p.systemAdminRequired(http.HandlerFunc(p.handleGetWebhookConfig)).ServeHTTP).Methods(http.MethodGet)
	apiRouter.HandleFunc("/admin/test-event", p.systemAdminRequired(http.HandlerFunc(p.handleCreateTestEvent)).ServeHTTP).Methods(http.MethodPost)
	apiRouter.HandleFunc("/admin/webhook-tokens", p.systemAdminRequired(http.HandlerFunc(p.handleUpdateWebhookTokens)).ServeHTTP).Methods(http.MethodPut)
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
const maxWebhookBatchBodyBytes = 1024 * 1024
const maxWebhookBatchEvents = 50

type validatedWebhookRequest struct {
	teamID        string
	payload       WebhookPayload
	eventType     string
	incomingLinks []EventLink
	credential    webhookCredential
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

type BatchWebhookResponse struct {
	Results []BatchWebhookResult `json:"results"`
}

type BatchWebhookResult struct {
	Index  int          `json:"index"`
	Status int          `json:"status"`
	Event  *ClientEvent `json:"event,omitempty"`
	Error  string       `json:"error,omitempty"`
}

type markEventsReadRequest struct {
	TeamID    string   `json:"team_id"`
	ChannelID string   `json:"channel_id,omitempty"`
	EventIDs  []string `json:"event_ids"`
}

func (p *Plugin) resolveWebhookTeamID(teamIdentifier string) (string, *webhookHandlerError) {
	teamIdentifier = strings.TrimSpace(teamIdentifier)
	if teamIdentifier == "" {
		return "", &webhookHandlerError{message: "team_id is required (query param or JSON field)", status: http.StatusBadRequest}
	}

	if model.IsValidId(teamIdentifier) {
		team, appErr := p.API.GetTeam(teamIdentifier)
		if appErr == nil && team != nil {
			return team.Id, nil
		}
		if appErr != nil && appErr.StatusCode != http.StatusNotFound {
			return "", &webhookHandlerError{message: fmt.Sprintf("Failed to resolve team ID: %s", teamIdentifier), status: http.StatusInternalServerError}
		}
	}

	team, appErr := p.API.GetTeamByName(teamIdentifier)
	if appErr != nil || team == nil {
		return "", &webhookHandlerError{message: fmt.Sprintf("Invalid team ID or name: %s", teamIdentifier), status: http.StatusBadRequest}
	}

	return team.Id, nil
}

func (p *Plugin) resolveWebhookChannelIDs(teamID string, channelIdentifiers []string) ([]string, *webhookHandlerError) {
	if len(channelIdentifiers) > maxChannelsPerEvent {
		return nil, &webhookHandlerError{message: fmt.Sprintf("Maximum %d channels per event", maxChannelsPerEvent), status: http.StatusBadRequest}
	}

	channelIDs := make([]string, 0, len(channelIdentifiers))
	seen := make(map[string]bool, len(channelIdentifiers))
	for _, channelIdentifier := range channelIdentifiers {
		channelID, handlerErr := p.resolveWebhookChannelID(teamID, channelIdentifier)
		if handlerErr != nil {
			return nil, handlerErr
		}
		if !seen[channelID] {
			seen[channelID] = true
			channelIDs = append(channelIDs, channelID)
		}
	}

	return channelIDs, nil
}

func (p *Plugin) resolveWebhookChannelID(teamID, channelIdentifier string) (string, *webhookHandlerError) {
	channelIdentifier = strings.TrimSpace(channelIdentifier)
	if channelIdentifier == "" {
		return "", &webhookHandlerError{message: "Channel ID or name cannot be empty", status: http.StatusBadRequest}
	}

	var ch *model.Channel
	var appErr *model.AppError
	if model.IsValidId(channelIdentifier) {
		ch, appErr = p.API.GetChannel(channelIdentifier)
	} else {
		ch, appErr = p.API.GetChannelByName(teamID, channelIdentifier, false)
	}
	if appErr != nil || ch == nil {
		return "", &webhookHandlerError{message: fmt.Sprintf("Invalid channel ID or name: %s", channelIdentifier), status: http.StatusBadRequest}
	}
	if ch.TeamId != teamID {
		return "", &webhookHandlerError{message: fmt.Sprintf("Channel %s does not belong to team %s", channelIdentifier, teamID), status: http.StatusBadRequest}
	}
	if ch.Type == model.ChannelTypeDirect || ch.Type == model.ChannelTypeGroup {
		return "", &webhookHandlerError{message: fmt.Sprintf("DM/GM channels are not supported: %s", channelIdentifier), status: http.StatusBadRequest}
	}

	return ch.Id, nil
}

func (p *Plugin) handleWebhook(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	body, handlerErr := readWebhookBody(w, r, maxWebhookBodyBytes)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	credential, handlerErr := p.authenticateWebhookRequest(r, body, config)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	payload, handlerErr := decodeWebhookPayload(body)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	validated, handlerErr := p.validateWebhookPayloadForRequest(r, payload, credential)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	stored, handlerErr := p.storeWebhookEvent(validated)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	p.writeTimelineEventResponse(w, stored.status, stored.eventName, stored.event)
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
			if handlerErr := p.enforceWebhookCredentialScope(request.teamID, existing.Channels, request.credential); handlerErr != nil {
				return storedWebhookEvent{}, handlerErr
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
	now := time.Now().UnixMilli()
	existing.Title = payload.Title
	existing.Message = payload.Message
	existing.EventType = eventType
	existing.Source = payload.Source
	existing.Timestamp = now
	existing.Links = mergeLinks(existing.Links, incomingLinks)
	existing.Channels = payload.Channels
	applyWebhookMetadata(existing, payload, now)
	return oldChannels
}

func newWebhookEvent(teamID string, payload WebhookPayload, eventType string, incomingLinks []EventLink) Event {
	now := time.Now().UnixMilli()
	event := Event{
		ID:         uuid.New().String(),
		TeamID:     teamID,
		Timestamp:  now,
		Title:      payload.Title,
		Message:    payload.Message,
		Links:      incomingLinks,
		EventType:  eventType,
		Source:     payload.Source,
		ExternalID: payload.ExternalID,
		Channels:   payload.Channels,
	}
	applyWebhookMetadata(&event, payload, now)
	return event
}

func (p *Plugin) getVisibleEventsForUser(userID, teamID, channelID string, offset, limit int) ([]Event, int, *webhookHandlerError) {
	if _, appErr := p.API.GetTeamMember(teamID, userID); appErr != nil {
		return nil, 0, &webhookHandlerError{message: "Not a member of this team", status: http.StatusForbidden}
	}

	if channelID != "" {
		if _, appErr := p.API.GetChannelMember(channelID, userID); appErr != nil {
			return nil, 0, &webhookHandlerError{message: "Not a member of this channel", status: http.StatusForbidden}
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
		return nil, 0, &webhookHandlerError{message: "Failed to get events", status: http.StatusInternalServerError}
	}

	return events, total, nil
}

func (p *Plugin) handleGetEvents(w http.ResponseWriter, r *http.Request) {
	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		http.Error(w, "team_id is required", http.StatusBadRequest)
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

	userID := r.Header.Get("Mattermost-User-ID")
	channelID := r.URL.Query().Get("channel_id")
	now := time.Now().UnixMilli()
	filters, handlerErr := parseEventFilterOptions(r, now)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	var events []Event
	var total int
	var unreadEvents []Event
	if hasEventFilters(filters) {
		allEvents, handlerErr := p.getAllVisibleEventsForUser(userID, teamID, channelID)
		if handlerErr != nil {
			http.Error(w, handlerErr.message, handlerErr.status)
			return
		}
		baselineTimestamp := maxEventTimestamp(allEvents)
		if baselineTimestamp == 0 {
			baselineTimestamp = now
		}
		allUnreadEvents, _, err := p.store.GetUnreadEventsForContext(userID, teamID, channelID, allEvents, baselineTimestamp)
		if err != nil {
			p.API.LogError("Failed to get read state", "error", err.Error())
			http.Error(w, "Failed to get events", http.StatusInternalServerError)
			return
		}
		unreadIDs := unreadIDSet(allUnreadEvents)
		filteredEvents := filterEvents(allEvents, filters, unreadIDs)
		total = len(filteredEvents)
		events = paginateEvents(filteredEvents, total, offset, limit)
		unreadEvents = filterEvents(events, EventFilterOptions{Unread: boolPtr(true)}, unreadIDs)
	} else {
		events, total, handlerErr = p.getVisibleEventsForUser(userID, teamID, channelID, offset, limit)
		if handlerErr != nil {
			http.Error(w, handlerErr.message, handlerErr.status)
			return
		}
		baselineTimestamp := maxEventTimestamp(events)
		if baselineTimestamp == 0 {
			baselineTimestamp = now
		}
		var err error
		unreadEvents, _, err = p.store.GetUnreadEventsForContext(userID, teamID, channelID, events, baselineTimestamp)
		if err != nil {
			p.API.LogError("Failed to get read state", "error", err.Error())
			http.Error(w, "Failed to get events", http.StatusInternalServerError)
			return
		}
	}

	resp := EventsResponse{
		Events:          clientEventsFrom(events, userID),
		UnreadEvents:    clientEventsFrom(unreadEvents, userID),
		Total:           total,
		TimelineOrder:   config.timelineOrder(),
		EnableReactions: config.enableReactions(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		p.API.LogError("Failed to encode events response", "error", err.Error())
	}
}

func (p *Plugin) handleMarkEventsRead(w http.ResponseWriter, r *http.Request) {
	var payload markEventsReadRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	if payload.TeamID == "" {
		http.Error(w, "team_id is required", http.StatusBadRequest)
		return
	}
	if len(payload.EventIDs) > 100 {
		http.Error(w, "too many event_ids", http.StatusBadRequest)
		return
	}

	userID := r.Header.Get("Mattermost-User-ID")
	config := p.getConfiguration()
	visibleEvents, _, handlerErr := p.getVisibleEventsForUser(userID, payload.TeamID, payload.ChannelID, 0, config.maxEventsDisplayedInt())
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	selectedEvents := visibleEvents
	if len(payload.EventIDs) > 0 {
		requestedEventIDs := make(map[string]struct{}, len(payload.EventIDs))
		for _, eventID := range payload.EventIDs {
			requestedEventIDs[eventID] = struct{}{}
		}

		selectedEvents = make([]Event, 0, len(visibleEvents))
		for _, event := range visibleEvents {
			if _, ok := requestedEventIDs[event.ID]; ok {
				selectedEvents = append(selectedEvents, event)
			}
		}
	}

	readState, err := p.store.MarkEventsRead(userID, payload.TeamID, payload.ChannelID, selectedEvents)
	if err != nil {
		p.API.LogError("Failed to mark events read", "error", err.Error())
		http.Error(w, "Failed to mark events read", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(readState); err != nil {
		p.API.LogError("Failed to encode read state response", "error", err.Error())
	}
}

func applyWebhookMetadata(event *Event, payload WebhookPayload, now int64) {
	if payload.Severity != nil {
		event.Severity = *payload.Severity
	}
	if payload.Status != nil {
		event.Status = *payload.Status
		if *payload.Status == "resolved" && (payload.ResolvedAt == nil || *payload.ResolvedAt == 0) {
			event.ResolvedAt = now
		}
		if *payload.Status != "resolved" && payload.ResolvedAt != nil && *payload.ResolvedAt == 0 {
			event.ResolvedAt = 0
		}
	}
	if payload.Environment != nil {
		event.Environment = *payload.Environment
	}
	if payload.ExpiresAt != nil {
		event.ExpiresAt = *payload.ExpiresAt
	}
	if payload.Pinned != nil {
		event.Pinned = *payload.Pinned
	}
	if payload.ResolvedAt != nil && (payload.Status == nil || *payload.Status != "resolved" || *payload.ResolvedAt != 0) {
		event.ResolvedAt = *payload.ResolvedAt
	}
}

func readWebhookBody(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, *webhookHandlerError) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return nil, &webhookHandlerError{message: "Payload too large", status: http.StatusRequestEntityTooLarge}
		}
		return nil, &webhookHandlerError{message: "Invalid JSON payload", status: http.StatusBadRequest}
	}
	return body, nil
}

func decodeWebhookPayload(body []byte) (WebhookPayload, *webhookHandlerError) {
	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return WebhookPayload{}, &webhookHandlerError{message: "Invalid JSON payload", status: http.StatusBadRequest}
	}
	return payload, nil
}

func (p *Plugin) validateWebhookPayloadForRequest(r *http.Request, payload WebhookPayload, credential webhookCredential) (validatedWebhookRequest, *webhookHandlerError) {
	teamIdentifier := r.URL.Query().Get("team_id")
	if teamIdentifier == "" {
		teamIdentifier = payload.TeamID
	}
	teamID, handlerErr := p.resolveWebhookTeamID(teamIdentifier)
	if handlerErr != nil {
		return validatedWebhookRequest{}, handlerErr
	}
	payload.TeamID = teamID

	if payload.Severity != nil {
		severity := strings.ToLower(strings.TrimSpace(*payload.Severity))
		payload.Severity = &severity
	}
	if payload.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*payload.Status))
		payload.Status = &status
	}

	eventType := payload.EventType
	if eventType == "" {
		eventType = "generic"
	}

	channelIDs, handlerErr := p.resolveWebhookChannelIDs(teamID, payload.Channels)
	if handlerErr != nil {
		return validatedWebhookRequest{}, handlerErr
	}
	payload.Channels = channelIDs

	if !credential.Legacy && strings.TrimSpace(payload.Source) == "" && credential.Name != "" {
		payload.Source = credential.Name
	}

	incomingLinks := normalizeLinks(payload)
	if handlerErr := validateWebhookPayload(payload, incomingLinks); handlerErr != nil {
		return validatedWebhookRequest{}, handlerErr
	}
	if handlerErr := p.enforceWebhookCredentialScope(teamID, channelIDs, credential); handlerErr != nil {
		return validatedWebhookRequest{}, handlerErr
	}

	return validatedWebhookRequest{
		teamID:        teamID,
		payload:       payload,
		eventType:     eventType,
		incomingLinks: incomingLinks,
		credential:    credential,
	}, nil
}

func (p *Plugin) enforceWebhookCredentialScope(teamID string, payloadChannelIDs []string, credential webhookCredential) *webhookHandlerError {
	if credential.Legacy {
		return nil
	}

	if credential.Team != "" {
		allowedTeamID, handlerErr := p.resolveWebhookTeamID(credential.Team)
		if handlerErr != nil {
			return handlerErr
		}
		if allowedTeamID != teamID {
			return &webhookHandlerError{message: "Webhook token is not allowed for this team", status: http.StatusForbidden}
		}
	}

	if len(credential.Channels) == 0 {
		return nil
	}
	if len(payloadChannelIDs) == 0 {
		return &webhookHandlerError{message: "Webhook token is not allowed to publish team-wide events", status: http.StatusForbidden}
	}

	allowedChannelIDs := make(map[string]struct{}, len(credential.Channels))
	for _, channelIdentifier := range credential.Channels {
		channelID, handlerErr := p.resolveWebhookChannelID(teamID, channelIdentifier)
		if handlerErr != nil {
			return handlerErr
		}
		allowedChannelIDs[channelID] = struct{}{}
	}
	for _, channelID := range payloadChannelIDs {
		if _, ok := allowedChannelIDs[channelID]; !ok {
			return &webhookHandlerError{message: "Webhook token is not allowed for one or more channels", status: http.StatusForbidden}
		}
	}
	return nil
}

func (p *Plugin) publishTimelineEventResponse(eventName string, event Event) (ClientEvent, *webhookHandlerError) {
	clientEvent := clientEventFrom(event, "")
	websocketJSON, err := json.Marshal(clientEvent)
	if err != nil {
		p.API.LogError("Failed to marshal event for broadcast", "error", err.Error())
		return ClientEvent{}, &webhookHandlerError{message: "Failed to serialize event", status: http.StatusInternalServerError}
	}

	p.publishTimelineEvent(eventName, event, websocketJSON)
	return webhookEventResponseFrom(event), nil
}

func (p *Plugin) writeTimelineEventResponse(w http.ResponseWriter, status int, eventName string, event Event) {
	clientEvent, handlerErr := p.publishTimelineEventResponse(eventName, event)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	responseJSON, err := json.Marshal(clientEvent)
	if err != nil {
		p.API.LogError("Failed to marshal webhook event response", "error", err.Error())
		http.Error(w, "Failed to serialize event", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(responseJSON)
}

func (p *Plugin) getAllVisibleEventsForUser(userID, teamID, channelID string) ([]Event, *webhookHandlerError) {
	if _, appErr := p.API.GetTeamMember(teamID, userID); appErr != nil {
		return nil, &webhookHandlerError{message: "Not a member of this team", status: http.StatusForbidden}
	}

	if channelID != "" {
		if _, appErr := p.API.GetChannelMember(channelID, userID); appErr != nil {
			return nil, &webhookHandlerError{message: "Not a member of this channel", status: http.StatusForbidden}
		}
	}

	var events []Event
	var err error
	if channelID != "" {
		events, err = p.store.GetAllEventsByChannel(teamID, channelID)
	} else {
		events, err = p.store.GetAllGlobalEvents(teamID)
	}
	if err != nil {
		p.API.LogError("Failed to get events", "error", err.Error())
		return nil, &webhookHandlerError{message: "Failed to get events", status: http.StatusInternalServerError}
	}
	return events, nil
}

func parseEventFilterOptions(r *http.Request, now int64) (EventFilterOptions, *webhookHandlerError) {
	query := r.URL.Query()
	filters := EventFilterOptions{
		Query:       query.Get("q"),
		EventType:   query.Get("event_type"),
		Source:      query.Get("source"),
		Severity:    strings.TrimSpace(query.Get("severity")),
		Status:      strings.TrimSpace(query.Get("status")),
		Environment: query.Get("environment"),
		Now:         now,
	}
	if filters.Severity != "" && !isAllowedStringValue(filters.Severity, allowedSeverities) {
		return EventFilterOptions{}, &webhookHandlerError{message: "invalid severity filter", status: http.StatusBadRequest}
	}
	if filters.Status != "" && !isAllowedStringValue(filters.Status, allowedStatuses) {
		return EventFilterOptions{}, &webhookHandlerError{message: "invalid status filter", status: http.StatusBadRequest}
	}
	var handlerErr *webhookHandlerError
	filters.Pinned, handlerErr = parseOptionalBoolFilter(query.Get("pinned"), "pinned")
	if handlerErr != nil {
		return EventFilterOptions{}, handlerErr
	}
	filters.Active, handlerErr = parseOptionalBoolFilter(query.Get("active"), "active")
	if handlerErr != nil {
		return EventFilterOptions{}, handlerErr
	}
	filters.Unread, handlerErr = parseOptionalBoolFilter(query.Get("unread"), "unread")
	if handlerErr != nil {
		return EventFilterOptions{}, handlerErr
	}
	return filters, nil
}

func parseOptionalBoolFilter(rawValue, name string) (*bool, *webhookHandlerError) {
	if rawValue == "" {
		return nil, nil
	}
	value, err := strconv.ParseBool(rawValue)
	if err != nil {
		return nil, &webhookHandlerError{message: name + " must be true or false", status: http.StatusBadRequest}
	}
	return &value, nil
}

func unreadIDSet(events []Event) map[string]struct{} {
	unreadIDs := make(map[string]struct{}, len(events))
	for _, event := range events {
		unreadIDs[event.ID] = struct{}{}
	}
	return unreadIDs
}

func (p *Plugin) systemAdminRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if !p.API.HasPermissionTo(userID, model.PermissionManageSystem) {
			http.Error(w, "System admin permission required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
