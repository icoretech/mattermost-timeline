package main

import (
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

var allowedSeverities = []string{"info", "warning", "critical"}
var allowedStatuses = []string{"open", "running", "success", "failed", "resolved", "closed"}

const maxWebhookTitleLength = 200
const maxWebhookMessageLength = 8000
const maxWebhookSourceLength = 80
const maxWebhookExternalIDLength = 200
const maxWebhookEventTypeLength = 64
const maxWebhookEnvironmentLength = 32
const maxWebhookLinkCount = 10
const maxWebhookLinkURLLength = 2048
const maxWebhookLinkLabelLength = 80

var allowedLinkSchemes = map[string]struct{}{
	"http":   {},
	"https":  {},
	"mailto": {},
	"tel":    {},
}

func validateWebhookPayload(payload WebhookPayload, links []EventLink) *webhookHandlerError {
	if strings.TrimSpace(payload.Title) == "" {
		return &webhookHandlerError{message: "Title is required", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(payload.Title) > maxWebhookTitleLength {
		return &webhookHandlerError{message: "title exceeds maximum length", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(payload.Message) > maxWebhookMessageLength {
		return &webhookHandlerError{message: "message exceeds maximum length", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(payload.Source) > maxWebhookSourceLength {
		return &webhookHandlerError{message: "source exceeds maximum length", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(payload.ExternalID) > maxWebhookExternalIDLength {
		return &webhookHandlerError{message: "external_id exceeds maximum length", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(payload.EventType) > maxWebhookEventTypeLength {
		return &webhookHandlerError{message: "event_type exceeds maximum length", status: http.StatusBadRequest}
	}
	if payload.Environment != nil && utf8.RuneCountInString(*payload.Environment) > maxWebhookEnvironmentLength {
		return &webhookHandlerError{message: "environment exceeds maximum length", status: http.StatusBadRequest}
	}
	if len(links) > maxWebhookLinkCount {
		return &webhookHandlerError{message: "Maximum 10 links per event", status: http.StatusBadRequest}
	}
	if payload.ExpiresAt != nil && *payload.ExpiresAt < 0 {
		return &webhookHandlerError{message: "expires_at must be non-negative", status: http.StatusBadRequest}
	}
	if payload.ResolvedAt != nil && *payload.ResolvedAt < 0 {
		return &webhookHandlerError{message: "resolved_at must be non-negative", status: http.StatusBadRequest}
	}
	if payload.Severity != nil && !isAllowedStringValue(*payload.Severity, allowedSeverities) {
		return &webhookHandlerError{message: "invalid severity", status: http.StatusBadRequest}
	}
	if payload.Status != nil && !isAllowedStringValue(*payload.Status, allowedStatuses) {
		return &webhookHandlerError{message: "invalid status", status: http.StatusBadRequest}
	}
	if containsControlCharacter(payload.EventType) {
		return &webhookHandlerError{message: "event_type contains unsupported control characters", status: http.StatusBadRequest}
	}
	if containsControlCharacter(payload.Source) {
		return &webhookHandlerError{message: "source contains unsupported control characters", status: http.StatusBadRequest}
	}
	if containsControlCharacter(payload.ExternalID) {
		return &webhookHandlerError{message: "external_id contains unsupported control characters", status: http.StatusBadRequest}
	}
	if payload.Environment != nil && containsControlCharacter(*payload.Environment) {
		return &webhookHandlerError{message: "environment contains unsupported control characters", status: http.StatusBadRequest}
	}
	for _, link := range links {
		if handlerErr := validateWebhookLink(link); handlerErr != nil {
			return handlerErr
		}
	}
	return validateCustomFields(payload.CustomFields)
}

func validateWebhookLink(link EventLink) *webhookHandlerError {
	if strings.TrimSpace(link.URL) == "" {
		return &webhookHandlerError{message: "link URL is required", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(link.URL) > maxWebhookLinkURLLength {
		return &webhookHandlerError{message: "link URL exceeds maximum length", status: http.StatusBadRequest}
	}
	if utf8.RuneCountInString(link.Label) > maxWebhookLinkLabelLength {
		return &webhookHandlerError{message: "link label exceeds maximum length", status: http.StatusBadRequest}
	}
	if containsControlCharacter(link.URL) {
		return &webhookHandlerError{message: "link URL contains unsupported control characters", status: http.StatusBadRequest}
	}
	if containsControlCharacter(link.Label) {
		return &webhookHandlerError{message: "link label contains unsupported control characters", status: http.StatusBadRequest}
	}

	scheme := explicitURLScheme(link.URL)
	if scheme == "" {
		return nil
	}
	if _, ok := allowedLinkSchemes[scheme]; !ok {
		return &webhookHandlerError{message: "Unsupported link URL scheme", status: http.StatusBadRequest}
	}
	return nil
}

func explicitURLScheme(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Scheme)
}

func isAllowedStringValue(value string, allowed []string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	for _, candidate := range allowed {
		if strings.EqualFold(trimmed, candidate) {
			return true
		}
	}
	return false
}

func containsControlCharacter(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}
