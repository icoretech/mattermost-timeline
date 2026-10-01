package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type webhookTokenConfig struct {
	Name             string   `json:"name"`
	Secret           string   `json:"secret"`
	Enabled          *bool    `json:"enabled,omitempty"`
	Team             string   `json:"team,omitempty"`
	Channels         []string `json:"channels,omitempty"`
	RequireSignature bool     `json:"require_signature,omitempty"`
}

type webhookCredential struct {
	Name             string
	Secret           string
	Team             string
	Channels         []string
	RequireSignature bool
	Legacy           bool
}

func parseWebhookTokenConfigs(raw string) ([]webhookTokenConfig, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		trimmed = "[]"
	}

	var tokens []webhookTokenConfig
	if err := json.Unmarshal([]byte(trimmed), &tokens); err != nil {
		return nil, err
	}
	return tokens, nil
}

func configuredWebhookCredentials(config *configuration) ([]webhookCredential, error) {
	if config == nil {
		config = &configuration{}
	}

	credentials := make([]webhookCredential, 0)
	secrets := make(map[string]struct{})
	if config.WebhookSecret != "" {
		credentials = append(credentials, webhookCredential{Secret: config.WebhookSecret, Legacy: true})
		secrets[config.WebhookSecret] = struct{}{}
	}

	tokens, err := parseWebhookTokenConfigs(config.WebhookTokens)
	if err != nil {
		return nil, fmt.Errorf("parse webhook tokens: %w", err)
	}

	names := make(map[string]struct{}, len(tokens))
	for index, token := range tokens {
		if token.Enabled != nil && !*token.Enabled {
			continue
		}

		name := strings.TrimSpace(token.Name)
		secret := strings.TrimSpace(token.Secret)
		if name == "" {
			return nil, fmt.Errorf("webhook token %d has empty name", index)
		}
		if secret == "" {
			return nil, fmt.Errorf("webhook token %q has empty secret", name)
		}
		if _, ok := names[name]; ok {
			return nil, fmt.Errorf("duplicate webhook token name %q", name)
		}
		if _, ok := secrets[secret]; ok {
			return nil, fmt.Errorf("duplicate webhook token secret for %q", name)
		}

		names[name] = struct{}{}
		secrets[secret] = struct{}{}

		channels := make([]string, 0, len(token.Channels))
		for _, channel := range token.Channels {
			channels = append(channels, strings.TrimSpace(channel))
		}

		credentials = append(credentials, webhookCredential{
			Name:             name,
			Secret:           secret,
			Team:             strings.TrimSpace(token.Team),
			Channels:         channels,
			RequireSignature: token.RequireSignature,
		})
	}

	return credentials, nil
}

func (p *Plugin) authenticateWebhookRequest(r *http.Request, body []byte, config *configuration) (webhookCredential, *webhookHandlerError) {
	credentials, err := configuredWebhookCredentials(config)
	if err != nil {
		p.API.LogError("Invalid webhook token configuration", "error", err.Error())
		return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook token configuration", status: http.StatusInternalServerError}
	}
	if len(credentials) == 0 {
		return webhookCredential{}, &webhookHandlerError{message: "Webhook secret not configured", status: http.StatusInternalServerError}
	}

	credential, ok := authenticateSharedSecret(r.Header.Get("X-Webhook-Secret"), credentials)
	if !ok {
		return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook secret", status: http.StatusUnauthorized}
	}

	return credential, nil
}

func authenticateSharedSecret(header string, credentials []webhookCredential) (webhookCredential, bool) {
	for _, credential := range credentials {
		if subtle.ConstantTimeCompare([]byte(header), []byte(credential.Secret)) == 1 {
			return credential, true
		}
	}
	return webhookCredential{}, false
}
