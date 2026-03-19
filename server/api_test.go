package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

	api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
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

	api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
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
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))

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
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))

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
