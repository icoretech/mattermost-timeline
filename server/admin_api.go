package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type sanitizedWebhookTokenConfig struct {
	Name             string   `json:"name"`
	Enabled          bool     `json:"enabled"`
	Team             string   `json:"team,omitempty"`
	Channels         []string `json:"channels,omitempty"`
	RequireSignature bool     `json:"require_signature"`
}

type webhookConfigResponse struct {
	LegacySecretConfigured bool                          `json:"legacy_secret_configured"`
	RequireSignedWebhooks  bool                          `json:"require_signed_webhooks"`
	Tokens                 []sanitizedWebhookTokenConfig `json:"tokens"`
	WebhookPath            string                        `json:"webhook_path"`
	BatchWebhookPath       string                        `json:"batch_webhook_path"`
}

type createTestEventRequest struct {
	TeamID    string `json:"team_id"`
	ChannelID string `json:"channel_id,omitempty"`
}

type updateWebhookTokensRequest struct {
	Tokens []webhookTokenConfig `json:"tokens"`
}

func (p *Plugin) handleGetWebhookConfig(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	tokens, err := parseWebhookTokenConfigs(config.WebhookTokens)
	if err != nil {
		p.API.LogError("Invalid webhook token configuration", "error", err.Error())
		http.Error(w, "Invalid webhook token configuration", http.StatusInternalServerError)
		return
	}

	resp := buildWebhookConfigResponse(config, tokens)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		p.API.LogError("Failed to encode webhook config response", "error", err.Error())
	}
}

func buildWebhookConfigResponse(config *configuration, tokens []webhookTokenConfig) webhookConfigResponse {
	return webhookConfigResponse{
		LegacySecretConfigured: config.WebhookSecret != "",
		RequireSignedWebhooks:  config.RequireSignedWebhooks,
		Tokens:                 sanitizeWebhookTokens(tokens),
		WebhookPath:            "/plugins/ch.icorete.mattermost-timeline/webhook?team_id=<team-id-or-name>",
		BatchWebhookPath:       "/plugins/ch.icorete.mattermost-timeline/webhook/batch?team_id=<team-id-or-name>",
	}
}

func (p *Plugin) handleUpdateWebhookTokens(w http.ResponseWriter, r *http.Request) {
	var payload updateWebhookTokensRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	config := p.getConfiguration().Clone()
	currentTokens, err := parseWebhookTokenConfigs(config.WebhookTokens)
	if err != nil {
		p.API.LogError("Invalid webhook token configuration", "error", err.Error())
		http.Error(w, "Invalid webhook token configuration", http.StatusInternalServerError)
		return
	}

	nextTokens, handlerErr := prepareWebhookTokenUpdate(payload.Tokens, currentTokens, config.WebhookSecret)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	data, err := json.Marshal(nextTokens)
	if err != nil {
		p.API.LogError("Failed to encode webhook token configuration", "error", err.Error())
		http.Error(w, "Failed to encode webhook token configuration", http.StatusInternalServerError)
		return
	}

	config.WebhookTokens = string(data)
	if appErr := p.API.SavePluginConfig(pluginConfigMap(config)); appErr != nil {
		p.API.LogError("Failed to save webhook token configuration", "error", appErr.Error())
		http.Error(w, "Failed to save webhook token configuration", http.StatusInternalServerError)
		return
	}

	p.setConfiguration(config)
	if p.store != nil {
		p.store.SetMaxEvents(config.maxEventsStoredInt())
	}

	resp := buildWebhookConfigResponse(config, nextTokens)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		p.API.LogError("Failed to encode webhook config response", "error", err.Error())
	}
}

func prepareWebhookTokenUpdate(incoming []webhookTokenConfig, existing []webhookTokenConfig, legacySecret string) ([]webhookTokenConfig, *webhookHandlerError) {
	existingSecrets := make(map[string]string, len(existing))
	for _, token := range existing {
		existingSecrets[strings.TrimSpace(token.Name)] = strings.TrimSpace(token.Secret)
	}

	seenNames := make(map[string]struct{}, len(incoming))
	seenEnabledSecrets := make(map[string]string, len(incoming)+1)
	if strings.TrimSpace(legacySecret) != "" {
		seenEnabledSecrets[strings.TrimSpace(legacySecret)] = "legacy Webhook Secret"
	}

	next := make([]webhookTokenConfig, 0, len(incoming))
	for _, token := range incoming {
		name := strings.TrimSpace(token.Name)
		if name == "" {
			return nil, &webhookHandlerError{message: "Webhook token name is required", status: http.StatusBadRequest}
		}
		if _, ok := seenNames[name]; ok {
			return nil, &webhookHandlerError{message: "Duplicate webhook token name: " + name, status: http.StatusBadRequest}
		}
		seenNames[name] = struct{}{}

		enabled := true
		if token.Enabled != nil {
			enabled = *token.Enabled
		}

		secret := strings.TrimSpace(token.Secret)
		if secret == "" {
			secret = existingSecrets[name]
		}
		if enabled && secret == "" {
			return nil, &webhookHandlerError{message: "Webhook token secret is required for enabled token: " + name, status: http.StatusBadRequest}
		}
		if enabled && secret != "" {
			if owner, ok := seenEnabledSecrets[secret]; ok {
				return nil, &webhookHandlerError{message: "Webhook token secret for " + name + " duplicates " + owner, status: http.StatusBadRequest}
			}
			seenEnabledSecrets[secret] = name
		}

		channels := make([]string, 0, len(token.Channels))
		for _, channel := range token.Channels {
			channel = strings.TrimSpace(channel)
			if channel != "" {
				channels = append(channels, channel)
			}
		}

		next = append(next, webhookTokenConfig{
			Name:             name,
			Secret:           secret,
			Enabled:          boolPtr(enabled),
			Team:             strings.TrimSpace(token.Team),
			Channels:         channels,
			RequireSignature: token.RequireSignature,
		})
	}

	return next, nil
}

func pluginConfigMap(config *configuration) map[string]interface{} {
	return map[string]interface{}{
		"WebhookSecret":         config.WebhookSecret,
		"WebhookTokens":         config.WebhookTokens,
		"RequireSignedWebhooks": config.RequireSignedWebhooks,
		"WebhookTools":          config.WebhookTools,
		"MaxEventsStored":       config.MaxEventsStored,
		"MaxEventsDisplayed":    config.MaxEventsDisplayed,
		"TimelineOrder":         config.TimelineOrder,
		"EnableReactions":       config.EnableReactions,
	}
}

func sanitizeWebhookTokens(tokens []webhookTokenConfig) []sanitizedWebhookTokenConfig {
	sanitized := make([]sanitizedWebhookTokenConfig, 0, len(tokens))
	for _, token := range tokens {
		enabled := true
		if token.Enabled != nil {
			enabled = *token.Enabled
		}
		channels := make([]string, len(token.Channels))
		copy(channels, token.Channels)
		sanitized = append(sanitized, sanitizedWebhookTokenConfig{
			Name:             strings.TrimSpace(token.Name),
			Enabled:          enabled,
			Team:             strings.TrimSpace(token.Team),
			Channels:         channels,
			RequireSignature: token.RequireSignature,
		})
	}
	return sanitized
}

func (p *Plugin) handleCreateTestEvent(w http.ResponseWriter, r *http.Request) {
	var payload createTestEventRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	teamID, handlerErr := p.resolveWebhookTeamID(payload.TeamID)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	channels := []string(nil)
	if strings.TrimSpace(payload.ChannelID) != "" {
		channelID, handlerErr := p.resolveWebhookChannelID(teamID, payload.ChannelID)
		if handlerErr != nil {
			http.Error(w, handlerErr.message, handlerErr.status)
			return
		}
		channels = []string{channelID}
	}

	event := Event{
		ID:          uuid.New().String(),
		TeamID:      teamID,
		Timestamp:   nowMillis(),
		Title:       "Mattermost Timeline test event",
		Message:     "This test event was sent from the plugin configuration page.",
		EventType:   "info",
		Source:      "admin-console",
		ExternalID:  "admin-test-" + uuid.New().String(),
		Status:      "success",
		Environment: "test",
		Channels:    channels,
	}

	if err := p.store.AddEvent(teamID, event); err != nil {
		p.API.LogError("Failed to store admin test event", "error", err.Error())
		http.Error(w, "Failed to store event", http.StatusInternalServerError)
		return
	}

	p.writeTimelineEventResponse(w, http.StatusCreated, "new_event", event)
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
