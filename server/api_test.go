package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// newTestPlugin creates a Plugin wired up with a mock API and the given configuration.
func newTestPlugin(t *testing.T, api *plugintest.API, cfg *configuration) *Plugin {
	t.Helper()
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(cfg)
	p.store = NewEventStore(api, cfg.maxEventsStoredInt())
	p.router = p.initRouter()
	return p
}

// --- Webhook endpoint tests ---

func TestHandleWebhook_ValidRequest(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy v1.0","message":"Deployed successfully","event_type":"deploy","source":"ci","team_id":"team-1"}`

	// Store mocks
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)

	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "deploy v1.0", event.Title)
	assert.Equal(t, "deploy", event.EventType)
	assert.Equal(t, "team-1", event.TeamID)
	assert.NotEmpty(t, event.ID)
	api.AssertExpectations(t)
}

func TestHandleWebhook_TeamIDFromQueryParam(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy","event_type":"deploy"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-q:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-q:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-q").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-q", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook?team_id=team-q", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "team-q", event.TeamID)
	api.AssertExpectations(t)
}

func TestHandleWebhook_MissingSecret(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"test","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	// No X-Webhook-Secret header
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid webhook secret")
}

func TestHandleWebhook_WrongSecret(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"test","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "wrong-secret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid webhook secret")
}

func TestHandleWebhook_UnconfiguredSecret(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: ""}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"test","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "anything")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "Webhook secret not configured")
}

func TestHandleWebhook_MissingTitle(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	payload := `{"message":"no title here","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Title is required")
}

func TestHandleWebhook_MissingTeamID(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"no team"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "team_id is required")
}

func TestHandleWebhook_InvalidJSON(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader("not json"))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid JSON payload")
}

func TestHandleWebhook_DefaultEventType(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	// No event_type in payload
	payload := `{"title":"test event","team_id":"team-1"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "generic", event.EventType, "should default to 'generic'")
	api.AssertExpectations(t)
}

func TestHandleWebhook_StoreError(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"fail event","team_id":"team-1"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).
		Return(model.NewAppError("test", "kv_error", nil, "", 500))
	api.On("LogError", "Failed to store event", "error", mock.AnythingOfType("string"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "Failed to store event")
	api.AssertExpectations(t)
}

// --- Get events endpoint tests ---

func TestHandleGetEvents_ValidRequest(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	// User is a team member
	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))

	evt := Event{ID: "evt-1", Title: "test", EventType: "deploy"}
	evtJSON, _ := json.Marshal(evt)
	ids := []string{"evt-1"}
	indexData, _ := json.Marshal(ids)

	api.On("KVGet", "event_index:team-1:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-1").Return(evtJSON, (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Len(t, resp.Events, 1)
	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, "evt-1", resp.Events[0].ID)
	assert.Equal(t, "oldest_first", resp.TimelineOrder)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_WithoutChannelIDUsesTeamWideIndex(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))

	evt := Event{ID: "evt-global", Title: "team wide", EventType: "generic"}
	evtJSON, _ := json.Marshal(evt)
	ids := []string{"evt-global"}
	indexData, _ := json.Marshal(ids)

	api.On("KVGet", "event_index:team-1:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-global").Return(evtJSON, (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Events, 1)
	assert.Equal(t, "evt-global", resp.Events[0].ID)
	api.AssertNotCalled(t, "KVGet", "event_index:team-1")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_TimelineOrder(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
		TimelineOrder:      "newest_first",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "newest_first", resp.TimelineOrder)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_MissingTeamID(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "team_id is required")
}

func TestHandleGetEvents_Unauthorized(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	// No Mattermost-User-ID header
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not authorized")
}

func TestHandleGetEvents_NotTeamMember(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return((*model.TeamMember)(nil), model.NewAppError("test", "not_found", nil, "", 404))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not a member of this team")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_WithPagination(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsDisplayed: "50",
		MaxEventsStored:    "100",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))

	ids := []string{"evt-3", "evt-2", "evt-1"}
	indexData, _ := json.Marshal(ids)

	evt2 := Event{ID: "evt-2", Title: "middle", EventType: "generic"}
	evt2JSON, _ := json.Marshal(evt2)

	api.On("KVGet", "event_index:team-1:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1&offset=1&limit=1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Len(t, resp.Events, 1)
	assert.Equal(t, "evt-2", resp.Events[0].ID)
	assert.Equal(t, 3, resp.Total)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_DefaultLimit(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsDisplayed: "100",
		MaxEventsStored:    "500",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))

	// No limit param => defaults to 50
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Empty(t, resp.Events)
	assert.Equal(t, 0, resp.Total)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_NegativeOffsetRejected(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1&offset=-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	require.NotPanics(t, func() {
		p.router.ServeHTTP(rec, req)
	})

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "offset must be non-negative")
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsOversizedBody(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	const oversizedWebhookBodyBytes = 256 * 1024
	tooLargeTitle := strings.Repeat("a", oversizedWebhookBodyBytes)
	payload := `{"title":"` + tooLargeTitle + `","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Contains(t, rec.Body.String(), "Payload too large")
}

// --- Auth middleware tests ---

func TestMattermostAuthRequired_WithUserID(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsDisplayed: "50",
		MaxEventsStored:    "100",
	}
	p := newTestPlugin(t, api, cfg)

	// We need the full pipeline to reach handleGetEvents, so mock the team member check
	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	// Should pass through to the handler (200 OK, not 401)
	assert.Equal(t, http.StatusOK, rec.Code)
	api.AssertExpectations(t)
}

func TestMattermostAuthRequired_WithoutUserID(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1", nil)
	// No Mattermost-User-ID header
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not authorized")
}

func TestWebhookDoesNotRequireAuth(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	// The webhook should not go through the auth middleware,
	// so a request without Mattermost-User-ID should still be processed
	// (and fail on validation, not on auth)
	payload := `{"title":"test","team_id":"team-1"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "wrong")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	// Should get 401 from webhook secret check, not from auth middleware
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid webhook secret")
}

// --- Links tests ---

func TestHandleWebhook_WithLinks(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy","team_id":"team-1","links":[{"url":"https://a.com","label":"Release"},{"url":"https://b.com","label":"CI"}]}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	require.Len(t, event.Links, 2)
	assert.Equal(t, "https://a.com", event.Links[0].URL)
	assert.Equal(t, "Release", event.Links[0].Label)
	api.AssertExpectations(t)
}

func TestHandleWebhook_LegacyLinkNormalized(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy","team_id":"team-1","link":"https://example.com"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	require.Len(t, event.Links, 1)
	assert.Equal(t, "https://example.com", event.Links[0].URL)
	api.AssertExpectations(t)
}

// --- External ID tests ---

func TestHandleWebhook_ExternalID_NewEvent(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"build started","team_id":"team-1","external_id":"build-123","links":[{"url":"https://ci.com/1","label":"CI"}]}`

	// External ID lookup returns nothing (new event)
	api.On("KVGet", "ext_id:team-1:build-123").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Store external ID mapping
	api.On("KVSet", "ext_id:team-1:build-123", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Global index (no channels on event)
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "build-123", event.ExternalID)
	assert.Equal(t, "build started", event.Title)
	require.Len(t, event.Links, 1)
	api.AssertExpectations(t)
}

func TestHandleWebhook_ExternalID_UpdateExisting(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	// Existing event stored under this external ID
	existingEvent := Event{
		ID:         "evt-existing",
		TeamID:     "team-1",
		Timestamp:  1000,
		Title:      "build started",
		EventType:  "deploy",
		ExternalID: "build-123",
		Links:      []EventLink{{URL: "https://ci.com/1", Label: "CI"}},
	}
	existingJSON, _ := json.Marshal(existingEvent)

	// External ID lookup returns existing event ID
	api.On("KVGet", "ext_id:team-1:build-123").Return([]byte("evt-existing"), (*model.AppError)(nil))
	api.On("KVGet", "event:evt-existing").Return(existingJSON, (*model.AppError)(nil))
	// Update event store
	api.On("KVSet", "event:evt-existing", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Update index (move to front)
	api.On("KVGet", "event_index:team-1").Return([]byte(`["other-1","evt-existing","other-2"]`), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "updated_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	// Second webhook: different title, new link
	payload := `{"title":"build completed","team_id":"team-1","external_id":"build-123","event_type":"success","links":[{"url":"https://ci.com/2","label":"Artifacts"}]}`

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var updated Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &updated))
	assert.Equal(t, "evt-existing", updated.ID, "should keep the same internal ID")
	assert.Equal(t, "build completed", updated.Title, "title should be replaced")
	assert.Equal(t, "success", updated.EventType, "event type should be replaced")
	assert.Greater(t, updated.Timestamp, int64(1000), "timestamp should be updated")
	require.Len(t, updated.Links, 2, "links should be aggregated")
	assert.Equal(t, "https://ci.com/1", updated.Links[0].URL)
	assert.Equal(t, "https://ci.com/2", updated.Links[1].URL)
	api.AssertExpectations(t)
}

func TestMergeLinks_DeduplicatesByURL(t *testing.T) {
	existing := []EventLink{
		{URL: "https://a.com", Label: "A"},
		{URL: "https://b.com", Label: "B"},
	}
	incoming := []EventLink{
		{URL: "https://b.com", Label: "B duplicate"},
		{URL: "https://c.com", Label: "C"},
	}
	result := mergeLinks(existing, incoming)
	require.Len(t, result, 3)
	assert.Equal(t, "https://a.com", result[0].URL)
	assert.Equal(t, "https://b.com", result[1].URL)
	assert.Equal(t, "https://c.com", result[2].URL)
}

// --- Reaction endpoint tests ---

func TestHandleAddReaction(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	event := Event{
		ID: "evt-1", TeamID: "team1", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "team1", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "reaction_updated", mock.Anything, mock.Anything).Return()

	req := httptest.NewRequest(http.MethodPut, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	api.AssertExpectations(t)
}

func TestHandleRemoveReaction(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	event := Event{
		ID: "evt-1", TeamID: "team1", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user1"}},
		},
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "team1", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "reaction_updated", mock.Anything, mock.Anything).Return()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	api.AssertExpectations(t)
}

func TestHandleGetReactionUsers(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	event := Event{
		ID: "evt-1", TeamID: "team1", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 2, UserIDs: []string{"user1", "user2"}},
		},
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "team1", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp map[string][]string
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	assert.Equal(t, []string{"user1", "user2"}, resp["user_ids"])
	api.AssertExpectations(t)
}

func TestHandleAddReaction_Disabled(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: false}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestHandleAddReaction_InvalidIcon(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/events/evt-1/reactions/poop", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

// --- Channel scoping tests ---

func TestHandleWebhook_WithChannels(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", MaxEventsStored: "100"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannel", "ch1").Return(&model.Channel{Id: "ch1", TeamId: "team1", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool { return strings.HasPrefix(key, "event:") }), mock.Anything).Return((*model.AppError)(nil))
	// Channel index for ch1
	api.On("KVGet", "event_index:team1:ch1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team1:ch1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Main team index
	api.On("KVGet", "event_index:team1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Channel-scoped WebSocket broadcast
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.ChannelId == "ch1"
	})).Return()

	body := `{"title":"Deploy","event_type":"deploy","team_id":"team1","channels":["ch1"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsDMChannel(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannel", "dm1").Return(&model.Channel{Id: "dm1", TeamId: "team1", Type: model.ChannelTypeDirect}, (*model.AppError)(nil))

	body := `{"title":"Test","event_type":"info","team_id":"team1","channels":["dm1"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "DM/GM")
}

func TestHandleWebhook_TooManyChannels(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	channels := make([]string, 11)
	for i := range channels {
		channels[i] = fmt.Sprintf("ch%d", i)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"title": "Test", "event_type": "info", "team_id": "team1", "channels": channels,
	})

	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
