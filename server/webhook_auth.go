package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

const webhookSignatureWindow = 5 * time.Minute
const webhookReplayKeyPrefix = "webhook_replay:"

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

	signature, signedRequest := timelineSignatureHeader(r)
	if signedRequest {
		return p.authenticateSignedWebhook(r, body, credentials, signature)
	}

	credential, ok := authenticateSharedSecret(r.Header.Get("X-Webhook-Secret"), credentials)
	if !ok {
		return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook secret", status: http.StatusUnauthorized}
	}
	if config.RequireSignedWebhooks || credential.RequireSignature {
		return webhookCredential{}, &webhookHandlerError{message: "Signed webhook required", status: http.StatusUnauthorized}
	}

	return credential, nil
}

func timelineSignatureHeader(r *http.Request) (string, bool) {
	values, ok := r.Header[http.CanonicalHeaderKey("X-Timeline-Signature")]
	if !ok {
		return "", false
	}
	if len(values) == 0 {
		return "", true
	}
	return values[0], true
}

func authenticateSharedSecret(header string, credentials []webhookCredential) (webhookCredential, bool) {
	for _, credential := range credentials {
		if subtle.ConstantTimeCompare([]byte(header), []byte(credential.Secret)) == 1 {
			return credential, true
		}
	}
	return webhookCredential{}, false
}

func (p *Plugin) authenticateSignedWebhook(r *http.Request, body []byte, credentials []webhookCredential, signatureHeader string) (webhookCredential, *webhookHandlerError) {
	timestampHeader := strings.TrimSpace(r.Header.Get("X-Timeline-Timestamp"))
	timestamp, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil || timestamp <= 0 {
		return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook signature timestamp", status: http.StatusUnauthorized}
	}

	now := time.Now()
	timestampTime := time.Unix(timestamp, 0)
	if timestampTime.Before(now.Add(-webhookSignatureWindow)) || timestampTime.After(now.Add(webhookSignatureWindow)) {
		return webhookCredential{}, &webhookHandlerError{message: "Webhook signature timestamp outside allowed window", status: http.StatusUnauthorized}
	}

	normalizedSignature := normalizeTimelineSignature(signatureHeader)
	if normalizedSignature == "" {
		return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook signature", status: http.StatusUnauthorized}
	}

	message := []byte(timestampHeader + ".")
	message = append(message, body...)
	for _, credential := range credentials {
		mac := hmac.New(sha256.New, []byte(credential.Secret))
		_, _ = mac.Write(message)
		expected := hex.EncodeToString(mac.Sum(nil))
		if subtle.ConstantTimeCompare([]byte(expected), []byte(normalizedSignature)) == 1 {
			if handlerErr := p.recordWebhookSignature(normalizedSignature, timestampTime); handlerErr != nil {
				return webhookCredential{}, handlerErr
			}
			return credential, nil
		}
	}

	return webhookCredential{}, &webhookHandlerError{message: "Invalid webhook signature", status: http.StatusUnauthorized}
}

func normalizeTimelineSignature(signature string) string {
	normalized := strings.TrimSpace(signature)
	if strings.HasPrefix(strings.ToLower(normalized), "sha256=") {
		normalized = normalized[len("sha256="):]
	}
	normalized = strings.ToLower(strings.TrimSpace(normalized))
	if _, err := hex.DecodeString(normalized); err != nil {
		return ""
	}
	return normalized
}

func (p *Plugin) recordWebhookSignature(normalizedSignature string, timestamp time.Time) *webhookHandlerError {
	signatureHash := sha256.Sum256([]byte(normalizedSignature))
	key := webhookReplayKeyPrefix + hex.EncodeToString(signatureHash[:])
	remaining := time.Until(timestamp.Add(webhookSignatureWindow))
	ttl := max(int64((remaining+time.Second-1)/time.Second), 1)
	ok, appErr := p.API.KVSetWithOptions(key, []byte{1}, model.PluginKVSetOptions{
		Atomic:          true,
		OldValue:        nil,
		ExpireInSeconds: ttl,
	})
	if appErr != nil {
		p.API.LogError("Failed to record webhook signature", "error", appErr.Error())
		return &webhookHandlerError{message: "Failed to record webhook signature", status: http.StatusInternalServerError}
	}
	if !ok {
		return &webhookHandlerError{message: "Webhook replay detected", status: http.StatusConflict}
	}
	return nil
}
