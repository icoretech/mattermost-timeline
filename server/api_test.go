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
	api.On("GetTeam", mock.AnythingOfType("string")).Return(func(teamID string) *model.Team {
		return &model.Team{Id: teamID}
	}, (*model.AppError)(nil)).Maybe()
	p.setConfiguration(cfg)
	p.store = NewEventStore(api, cfg.maxEventsStoredInt())
	p.router = p.initRouter()
	return p
}

func expectExistingReadState(api *plugintest.API, userID, teamID string, state TimelineReadState) {
	api.On("KVGet", readStateKey(userID, teamID)).Return(mustMarshalReadStateForAPI(state), (*model.AppError)(nil)).Once()
}

func expectReadStateInitialization(t *testing.T, api *plugintest.API, userID, teamID, channelID string, baselineTimestamp int64) {
	t.Helper()
	key := readStateKey(userID, teamID)
	api.On("KVGet", key).Return([]byte(nil), (*model.AppError)(nil)).Once()
	api.On("KVGet", key).Return([]byte(nil), (*model.AppError)(nil)).Once()
	api.On("KVCompareAndSet", key, []byte(nil), mock.MatchedBy(func(data []byte) bool {
		var state TimelineReadState
		require.NoError(t, json.Unmarshal(data, &state))
		return state.ContextReadAt[readStateContextKey(channelID)] == baselineTimestamp
	})).Return(true, (*model.AppError)(nil)).Once()
}

func mustMarshalReadStateForAPI(state TimelineReadState) []byte {
	data, err := json.Marshal(state)
	if err != nil {
		panic(err)
	}
	return data
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

	payload := `{"title":"deploy v1.0","message":"Deployed successfully","event_type":"deploy","source":"ci","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`

	// Store mocks
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
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
	assert.Equal(t, "aaaaaaaaaaaaaaaaaaaaaaaaaa", event.TeamID)
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
	api.On("KVGet", "event_index:bbbbbbbbbbbbbbbbbbbbbbbbbb:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:bbbbbbbbbbbbbbbbbbbbbbbbbb:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:bbbbbbbbbbbbbbbbbbbbbbbbbb").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:bbbbbbbbbbbbbbbbbbbbbbbbbb", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast"))

	req := httptest.NewRequest(http.MethodPost, "/webhook?team_id=bbbbbbbbbbbbbbbbbbbbbbbbbb", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "bbbbbbbbbbbbbbbbbbbbbbbbbb", event.TeamID)
	api.AssertExpectations(t)
}
func TestHandleWebhook_TeamNameFromQueryParam(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy","event_type":"deploy"}`

	api.On("GetTeamByName", "example-org").Return(&model.Team{Id: "cccccccccccccccccccccccccc", Name: "example-org"}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.TeamId == "cccccccccccccccccccccccccc"
	})).Return()

	req := httptest.NewRequest(http.MethodPost, "/webhook?team_id=example-org", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "cccccccccccccccccccccccccc", event.TeamID)
	api.AssertExpectations(t)
}

func TestHandleWebhook_TeamNameFromPayload(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"deploy","event_type":"deploy","team_id":"example-org"}`

	api.On("GetTeamByName", "example-org").Return(&model.Team{Id: "cccccccccccccccccccccccccc", Name: "example-org"}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.TeamId == "cccccccccccccccccccccccccc"
	})).Return()

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, "cccccccccccccccccccccccccc", event.TeamID)
	api.AssertExpectations(t)
}

func TestHandleWebhook_IDShapedTeamNameFromPayload(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:      "s3cret",
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}

	const idShapedTeamName = "slugslugslugslugslugslugsl"
	const resolvedTeamID = "dddddddddddddddddddddddddd"
	api.On("GetTeam", idShapedTeamName).Return((*model.Team)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound)).Once()
	p := newTestPlugin(t, api, cfg)

	payload := fmt.Sprintf(`{"title":"deploy","event_type":"deploy","team_id":"%s"}`, idShapedTeamName)

	api.On("GetTeamByName", idShapedTeamName).Return(&model.Team{Id: resolvedTeamID, Name: idShapedTeamName}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:"+resolvedTeamID+":_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:"+resolvedTeamID+":_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:"+resolvedTeamID).Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:"+resolvedTeamID, mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.TeamId == resolvedTeamID
	})).Return()

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	var event Event
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &event))
	assert.Equal(t, resolvedTeamID, event.TeamID)
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsUnknownTeamName(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamByName", "missing-team").Return((*model.Team)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound))

	payload := `{"title":"deploy","event_type":"deploy","team_id":"missing-team"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid team ID or name: missing-team")
	api.AssertExpectations(t)
}

func TestHandleWebhook_MissingSecret(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	payload := `{"title":"test","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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

	payload := `{"title":"test","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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

	payload := `{"title":"test","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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

	payload := `{"message":"no title here","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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
	payload := `{"title":"test event","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
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

	payload := `{"title":"fail event","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`

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
	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))

	evt := Event{ID: "evt-1", TeamID: "aaaaaaaaaaaaaaaaaaaaaaaaaa", Timestamp: 100, Title: "test", EventType: "deploy"}
	evtJSON, _ := json.Marshal(evt)
	ids := []string{"evt-1"}
	indexData, _ := json.Marshal(ids)

	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-1").Return(evtJSON, (*model.AppError)(nil))
	expectReadStateInitialization(t, api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "", 100)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Len(t, resp.Events, 1)
	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, "evt-1", resp.Events[0].ID)
	assert.Equal(t, TimelineOrderOldestFirst, resp.TimelineOrder)
	assert.Empty(t, resp.UnreadEvents)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_ProjectsReactionSummaries(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))

	evt := Event{
		ID:        "evt-1",
		Title:     "test",
		EventType: "deploy",
		Reactions: EventReactions{
			"eyes": ReactionSummary{
				Count:   4,
				UserIDs: []string{"user-2", "user-3", "user-4", "user-1"},
			},
		},
	}
	evtJSON, _ := json.Marshal(evt)
	indexData, _ := json.Marshal([]string{"evt-1"})

	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-1").Return(evtJSON, (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)

	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Events, 1)
	assert.Equal(t, ReactionClientSummary{
		Count:       4,
		Self:        true,
		RecentUsers: []string{"user-3", "user-4", "user-1"},
	}, resp.Events[0].ClientReactions["eyes"])

	var raw map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &raw))
	events := raw["events"].([]interface{})
	firstEvent := events[0].(map[string]interface{})
	assert.NotContains(t, firstEvent, "reactions")
	assert.Contains(t, firstEvent, "client_reactions")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_WithoutChannelIDUsesTeamWideIndex(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))

	evt := Event{ID: "evt-global", Title: "team wide", EventType: "generic"}
	evtJSON, _ := json.Marshal(evt)
	ids := []string{"evt-global"}
	indexData, _ := json.Marshal(ids)

	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-global").Return(evtJSON, (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Events, 1)
	assert.Equal(t, "evt-global", resp.Events[0].ID)
	api.AssertNotCalled(t, "KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa")
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

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, TimelineOrderNewestFirst, resp.TimelineOrder)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
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

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return((*model.TeamMember)(nil), model.NewAppError("test", "not_found", nil, "", 404))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
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

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))

	ids := []string{"evt-3", "evt-2", "evt-1"}
	indexData, _ := json.Marshal(ids)

	evt2 := Event{ID: "evt-2", Title: "middle", EventType: "generic"}
	evt2JSON, _ := json.Marshal(evt2)

	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa&offset=1&limit=1", nil)
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

func TestHandleGetEvents_ReturnsUnreadEventsAfterBaselineExists(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsStored:    "100",
		MaxEventsDisplayed: "50",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("GetChannelMember", "channel-1", "user-1").
		Return(&model.ChannelMember{ChannelId: "channel-1", UserId: "user-1"}, (*model.AppError)(nil))

	channelIndexData, _ := json.Marshal([]string{"evt-channel"})
	globalIndexData, _ := json.Marshal([]string{"evt-global"})
	channelEvent := Event{ID: "evt-channel", TeamID: "team-1", Timestamp: 200, Title: "channel", EventType: "deploy", Channels: []string{"channel-1"}}
	globalEvent := Event{ID: "evt-global", TeamID: "team-1", Timestamp: 150, Title: "global", EventType: "deploy"}
	channelEventJSON, _ := json.Marshal(channelEvent)
	globalEventJSON, _ := json.Marshal(globalEvent)

	api.On("KVGet", "event_index:team-1:channel-1").Return(channelIndexData, (*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return(globalIndexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-channel").Return(channelEventJSON, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-global").Return(globalEventJSON, (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "team-1", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"channel-1": 100},
		SeenEvents:    map[string]int64{"evt-global": 150},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=team-1&channel_id=channel-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp EventsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Events, 2)
	require.Len(t, resp.UnreadEvents, 1)
	assert.Equal(t, "evt-channel", resp.UnreadEvents[0].ID)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_DefaultLimit(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		MaxEventsDisplayed: "100",
		MaxEventsStored:    "500",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{TeamId: "aaaaaaaaaaaaaaaaaaaaaaaaaa", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	// No limit param => defaults to 50
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa&offset=-1", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	require.NotPanics(t, func() {
		p.router.ServeHTTP(rec, req)
	})

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "offset must be non-negative")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_InvalidOffsetRejected(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa&offset=abc", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "offset must be an integer")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_InvalidLimitRejected(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa&limit=abc", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "limit must be an integer")
	api.AssertExpectations(t)
}

func TestHandleGetEvents_NonPositiveLimitRejected(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa&limit=0", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "limit must be positive")
	api.AssertExpectations(t)
}

func TestHandleMarkEventsRead_RequiresAuthAndMembership(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{"team_id":"team-1","event_ids":[]}`))
	rec := httptest.NewRecorder()
	p.router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)

	api.On("GetTeamMember", "team-1", "user-1").
		Return((*model.TeamMember)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound))
	req = httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{"team_id":"team-1","event_ids":[]}`))
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec = httptest.NewRecorder()
	p.router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not a member of this team")

	api.AssertExpectations(t)
}

func TestHandleMarkEventsRead_RequiresChannelMembership(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("GetChannelMember", "channel-1", "user-1").
		Return((*model.ChannelMember)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{"team_id":"team-1","channel_id":"channel-1","event_ids":[]}`))
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not a member of this channel")
	api.AssertExpectations(t)
}

func TestHandleMarkEventsRead_EmptyIDsMarksVisibleEvents(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	indexData, _ := json.Marshal([]string{"evt-visible"})
	visibleEvent := Event{ID: "evt-visible", TeamID: "team-1", Timestamp: 100, Title: "visible", EventType: "deploy"}
	visibleEventJSON, _ := json.Marshal(visibleEvent)
	api.On("KVGet", "event_index:team-1:_global").Return(indexData, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-visible").Return(visibleEventJSON, (*model.AppError)(nil))
	api.On("KVGet", readStateKey("user-1", "team-1")).Return([]byte(nil), (*model.AppError)(nil)).Once()
	api.On("KVCompareAndSet", readStateKey("user-1", "team-1"), []byte(nil), mock.MatchedBy(func(data []byte) bool {
		var state TimelineReadState
		require.NoError(t, json.Unmarshal(data, &state))
		return state.ContextReadAt["_global"] == 0 && state.SeenEvents["evt-visible"] == 100
	})).Return(true, (*model.AppError)(nil)).Once()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{"team_id":"team-1","event_ids":[]}`))
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var state TimelineReadState
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &state))
	assert.Equal(t, int64(100), state.SeenEvents["evt-visible"])
	api.AssertExpectations(t)
}

func TestHandleMarkEventsRead_ExplicitIDsIgnoresOutsideContext(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetTeamMember", "team-1", "user-1").
		Return(&model.TeamMember{TeamId: "team-1", UserId: "user-1"}, (*model.AppError)(nil))
	api.On("GetChannelMember", "channel-1", "user-1").
		Return(&model.ChannelMember{ChannelId: "channel-1", UserId: "user-1"}, (*model.AppError)(nil))
	channelIndexData, _ := json.Marshal([]string{"evt-visible"})
	api.On("KVGet", "event_index:team-1:channel-1").Return(channelIndexData, (*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))

	visibleEvent := Event{ID: "evt-visible", TeamID: "team-1", Timestamp: 100, Title: "visible", EventType: "deploy", Channels: []string{"channel-1"}}
	visibleEventJSON, _ := json.Marshal(visibleEvent)
	api.On("KVGet", "event:evt-visible").Return(visibleEventJSON, (*model.AppError)(nil))
	readStateJSON := mustMarshalReadStateForAPI(TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"channel-1": 50},
		SeenEvents:    map[string]int64{},
	})
	api.On("KVGet", readStateKey("user-1", "team-1")).Return(readStateJSON, (*model.AppError)(nil)).Once()
	api.On("KVCompareAndSet", readStateKey("user-1", "team-1"), readStateJSON, mock.MatchedBy(func(data []byte) bool {
		var state TimelineReadState
		require.NoError(t, json.Unmarshal(data, &state))
		_, outsideMarked := state.SeenEvents["evt-outside"]
		_, otherTeamMarked := state.SeenEvents["evt-other-team"]
		return state.ContextReadAt["channel-1"] == 50 && state.SeenEvents["evt-visible"] == 100 && !outsideMarked && !otherTeamMarked
	})).Return(true, (*model.AppError)(nil)).Once()

	body := `{"team_id":"team-1","channel_id":"channel-1","event_ids":["evt-visible","evt-hidden","evt-outside","evt-other-team","evt-missing"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(body))
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var state TimelineReadState
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &state))
	assert.Equal(t, map[string]int64{"evt-visible": 100}, state.SeenEvents)
	api.AssertNotCalled(t, "KVGet", "event:evt-outside")
	api.AssertNotCalled(t, "KVGet", "event:evt-hidden")
	api.AssertNotCalled(t, "KVGet", "event:evt-other-team")
	api.AssertNotCalled(t, "KVGet", "event:evt-missing")
	api.AssertExpectations(t)
}

func TestHandleMarkEventsRead_RejectsInvalidPayloads(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"}
	p := newTestPlugin(t, api, cfg)

	t.Run("invalid JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{`))
		req.Header.Set("Mattermost-User-ID", "user-1")
		rec := httptest.NewRecorder()
		p.router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "Invalid JSON payload")
	})

	t.Run("missing team", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", strings.NewReader(`{"event_ids":[]}`))
		req.Header.Set("Mattermost-User-ID", "user-1")
		rec := httptest.NewRecorder()
		p.router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "team_id is required")
	})

	t.Run("too many ids", func(t *testing.T) {
		eventIDs := make([]string, 101)
		for i := range eventIDs {
			eventIDs[i] = fmt.Sprintf("evt-%d", i)
		}
		payload, err := json.Marshal(markEventsReadRequest{TeamID: "team-1", EventIDs: eventIDs})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/events/read", bytes.NewReader(payload))
		req.Header.Set("Mattermost-User-ID", "user-1")
		rec := httptest.NewRecorder()
		p.router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "too many event_ids")
	})
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
	payload := `{"title":"` + tooLargeTitle + `","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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
	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").
		Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	expectExistingReadState(api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{"_global": 0},
		SeenEvents:    map[string]int64{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
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
	payload := `{"title":"test","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}`
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

	payload := `{"title":"deploy","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","links":[{"url":"https://a.com","label":"Release"},{"url":"https://b.com","label":"CI"}]}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
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

	payload := `{"title":"deploy","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","link":"https://example.com"}`

	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
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

	payload := `{"title":"build started","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123","links":[{"url":"https://ci.com/1","label":"CI"}]}`

	// External ID lookup returns nothing (new event)
	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "event:")
	}), mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Store external ID mapping
	api.On("KVCompareAndSet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	// Global index (no channels on event)
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa:_global", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
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

func TestHandleWebhook_ExternalID_MappingWriteFailure(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{
		WebhookSecret:   "s3cret",
		MaxEventsStored: "100",
	}
	p := newTestPlugin(t, api, cfg)

	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123", mock.Anything, mock.AnythingOfType("[]uint8")).
		Return(false, model.NewAppError("test", "mapping_write_failed", nil, "", 500))
	api.On("LogError", "Failed to store event", "error", mock.AnythingOfType("string"))

	payload := `{"title":"build started","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
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
		TeamID:     "aaaaaaaaaaaaaaaaaaaaaaaaaa",
		Timestamp:  1000,
		Title:      "build started",
		EventType:  "deploy",
		ExternalID: "build-123",
		Links:      []EventLink{{URL: "https://ci.com/1", Label: "CI"}},
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user-1"}},
		},
	}
	existingJSON, _ := json.Marshal(existingEvent)

	// External ID lookup returns existing event ID
	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").Return([]byte("evt-existing"), (*model.AppError)(nil))
	api.On("KVGet", "event:evt-existing").Return(existingJSON, (*model.AppError)(nil))
	// Update event store
	api.On("KVSet", "event:evt-existing", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Update index (move to front)
	api.On("KVGet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa").Return([]byte(`["other-1","evt-existing","other-2"]`), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:aaaaaaaaaaaaaaaaaaaaaaaaaa", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	var websocketEventJSON string
	api.On("PublishWebSocketEvent", "updated_event", mock.Anything, mock.AnythingOfType("*model.WebsocketBroadcast")).
		Run(func(args mock.Arguments) {
			payload := args.Get(1).(map[string]interface{})
			websocketEventJSON, _ = payload["event"].(string)
		}).
		Return()

	// Second webhook: different title, new link
	payload := `{"title":"build completed","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123","event_type":"success","links":[{"url":"https://ci.com/2","label":"Artifacts"}]}`

	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var updated ClientEvent
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &updated))
	assert.Equal(t, "evt-existing", updated.ID, "should keep the same internal ID")
	assert.Equal(t, "build completed", updated.Title, "title should be replaced")
	assert.Equal(t, "success", updated.EventType, "event type should be replaced")
	assert.Greater(t, updated.Timestamp, int64(1000), "timestamp should be updated")
	require.Len(t, updated.Links, 2, "links should be aggregated")
	assert.Equal(t, "https://ci.com/1", updated.Links[0].URL)
	assert.Equal(t, "https://ci.com/2", updated.Links[1].URL)
	assert.Empty(t, updated.ClientReactions)

	var raw map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &raw))
	assert.NotContains(t, raw, "reactions")
	assert.NotContains(t, raw, "client_reactions")

	var websocketEvent map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(websocketEventJSON), &websocketEvent))
	assert.NotContains(t, websocketEvent, "reactions")
	assert.Contains(t, websocketEvent, "client_reactions")
	api.AssertExpectations(t)
}

func TestHandleWebhook_ExternalID_LookupFailure(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").
		Return([]byte(nil), model.NewAppError("test", "lookup_failed", nil, "", 500))
	api.On("LogError", "Failed to lookup external ID", "error", mock.AnythingOfType("string"))

	payload := `{"title":"build started","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	api.AssertExpectations(t)
}

func TestHandleWebhook_ExternalID_ExistingEventReadFailure(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").Return([]byte("evt-existing"), (*model.AppError)(nil))
	api.On("KVGet", "event:evt-existing").
		Return([]byte(nil), model.NewAppError("test", "event_read_failed", nil, "", 500))
	api.On("LogError", "Failed to get existing event", "error", mock.AnythingOfType("string"))

	payload := `{"title":"build completed","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	api.AssertExpectations(t)
}

func TestHandleWebhook_ExternalID_MissingExistingEvent(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "s3cret"}
	p := newTestPlugin(t, api, cfg)

	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-123").Return([]byte("evt-missing"), (*model.AppError)(nil))
	api.On("KVGet", "event:evt-missing").Return([]byte(nil), (*model.AppError)(nil))
	api.On("LogError", "External ID mapping points to missing event", "event_id", "evt-missing")

	payload := `{"title":"build completed","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-123"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(payload))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	p.router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
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
		ID: "evt-1", TeamID: "cccccccccccccccccccccccccc", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "cccccccccccccccccccccccccc", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "reaction_updated", mock.Anything, mock.Anything).Return()

	req := httptest.NewRequest(http.MethodPut, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]ReactionClientSummary
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	assert.Equal(t, ReactionClientSummary{
		Count:       1,
		Self:        true,
		RecentUsers: []string{"user1"},
	}, resp["eyes"])
	api.AssertExpectations(t)
}

func TestHandleRemoveReaction(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	event := Event{
		ID: "evt-1", TeamID: "cccccccccccccccccccccccccc", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user1"}},
		},
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "cccccccccccccccccccccccccc", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "reaction_updated", mock.Anything, mock.Anything).Return()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/events/evt-1/reactions/eyes", nil)
	req.Header.Set("Mattermost-User-ID", "user1")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]ReactionClientSummary
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	assert.Empty(t, resp)
	api.AssertExpectations(t)
}

func TestHandleGetReactionUsers(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	event := Event{
		ID: "evt-1", TeamID: "cccccccccccccccccccccccccc", Title: "Test", EventType: "info",
		Timestamp: time.Now().UnixMilli(),
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 2, UserIDs: []string{"user1", "user2"}},
		},
	}
	eventJSON, _ := json.Marshal(event)

	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
	api.On("GetTeamMember", "cccccccccccccccccccccccccc", "user1").Return(&model.TeamMember{}, (*model.AppError)(nil))

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

func TestHandleReaction_EventReadFailure(t *testing.T) {
	tests := []struct {
		name   string
		method string
	}{
		{name: "add", method: http.MethodPut},
		{name: "remove", method: http.MethodDelete},
		{name: "list users", method: http.MethodGet},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api := &plugintest.API{}
			cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
			p := newTestPlugin(t, api, cfg)

			api.On("KVGet", "event:evt-1").
				Return([]byte(nil), model.NewAppError("test", "event_read_failed", nil, "", 500))
			api.On("LogError", "Failed to get event for reaction", "event_id", "evt-1", "error", mock.AnythingOfType("string"))

			req := httptest.NewRequest(tt.method, "/api/v1/events/evt-1/reactions/eyes", nil)
			req.Header.Set("Mattermost-User-ID", "user1")
			rr := httptest.NewRecorder()
			p.router.ServeHTTP(rr, req)

			assert.Equal(t, http.StatusInternalServerError, rr.Code)
			api.AssertExpectations(t)
		})
	}
}

func TestHandleGetReactionUsers_InvalidIcon(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", EnableReactions: true}
	p := newTestPlugin(t, api, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/evt-1/reactions/poop", nil)
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

	api.On("GetChannel", "eeeeeeeeeeeeeeeeeeeeeeeeee").Return(&model.Channel{Id: "eeeeeeeeeeeeeeeeeeeeeeeeee", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool { return strings.HasPrefix(key, "event:") }), mock.Anything).Return((*model.AppError)(nil))
	// Channel index for eeeeeeeeeeeeeeeeeeeeeeeeee
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	// Main team index
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	// Channel-scoped WebSocket broadcast
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.ChannelId == "eeeeeeeeeeeeeeeeeeeeeeeeee"
	})).Return()

	body := `{"title":"Deploy","event_type":"deploy","team_id":"cccccccccccccccccccccccccc","channels":["eeeeeeeeeeeeeeeeeeeeeeeeee"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	api.AssertExpectations(t)
}
func TestHandleWebhook_WithChannelNames(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", MaxEventsStored: "100"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannelByName", "cccccccccccccccccccccccccc", "town-square", false).Return(&model.Channel{Id: "eeeeeeeeeeeeeeeeeeeeeeeeee", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))
	api.On("GetChannelByName", "cccccccccccccccccccccccccc", "alerts", false).Return(&model.Channel{Id: "ffffffffffffffffffffffffff", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypePrivate}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool { return strings.HasPrefix(key, "event:") }), mock.Anything).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:ffffffffffffffffffffffffff").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:ffffffffffffffffffffffffff", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.ChannelId == "eeeeeeeeeeeeeeeeeeeeeeeeee" || b.ChannelId == "ffffffffffffffffffffffffff"
	})).Return().Twice()

	body := `{"title":"Deploy","event_type":"deploy","team_id":"cccccccccccccccccccccccccc","channels":["town-square","alerts"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	require.Equal(t, http.StatusCreated, rr.Code)
	var event ClientEvent
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &event))
	assert.Equal(t, []string{"eeeeeeeeeeeeeeeeeeeeeeeeee", "ffffffffffffffffffffffffff"}, event.Channels)
	api.AssertExpectations(t)
}

func TestHandleWebhook_DeduplicatesResolvedChannels(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret", MaxEventsStored: "100"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannelByName", "cccccccccccccccccccccccccc", "town-square", false).Return(&model.Channel{Id: "eeeeeeeeeeeeeeeeeeeeeeeeee", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))
	api.On("GetChannel", "eeeeeeeeeeeeeeeeeeeeeeeeee").Return(&model.Channel{Id: "eeeeeeeeeeeeeeeeeeeeeeeeee", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))
	api.On("KVSet", mock.MatchedBy(func(key string) bool { return strings.HasPrefix(key, "event:") }), mock.Anything).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc:eeeeeeeeeeeeeeeeeeeeeeeeee", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("KVGet", "event_index:cccccccccccccccccccccccccc").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "event_index:cccccccccccccccccccccccccc", mock.Anything, mock.AnythingOfType("[]uint8")).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "new_event", mock.Anything, mock.MatchedBy(func(b *model.WebsocketBroadcast) bool {
		return b.ChannelId == "eeeeeeeeeeeeeeeeeeeeeeeeee"
	})).Return().Once()

	body := `{"title":"Deploy","event_type":"deploy","team_id":"cccccccccccccccccccccccccc","channels":["town-square","eeeeeeeeeeeeeeeeeeeeeeeeee"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	require.Equal(t, http.StatusCreated, rr.Code)
	var event ClientEvent
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &event))
	assert.Equal(t, []string{"eeeeeeeeeeeeeeeeeeeeeeeeee"}, event.Channels)
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsBlankChannel(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	body := `{"title":"Test","event_type":"info","team_id":"cccccccccccccccccccccccccc","channels":[" "]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "Channel ID or name cannot be empty")
}

func TestHandleWebhook_RejectsChannelNameFromDifferentTeam(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannelByName", "cccccccccccccccccccccccccc", "town-square", false).Return(&model.Channel{Id: "eeeeeeeeeeeeeeeeeeeeeeeeee", TeamId: "dddddddddddddddddddddddddd", Type: model.ChannelTypeOpen}, (*model.AppError)(nil))

	body := `{"title":"Test","event_type":"info","team_id":"cccccccccccccccccccccccccc","channels":["town-square"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "Channel town-square does not belong to team cccccccccccccccccccccccccc")
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsUnknownChannelName(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannelByName", "cccccccccccccccccccccccccc", "missing", false).Return((*model.Channel)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound))

	body := `{"title":"Test","event_type":"info","team_id":"cccccccccccccccccccccccccc","channels":["missing"]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "Invalid channel ID or name: missing")
	api.AssertExpectations(t)
}

func TestHandleWebhook_RejectsDMChannel(t *testing.T) {
	api := &plugintest.API{}
	cfg := &configuration{WebhookSecret: "secret"}
	p := newTestPlugin(t, api, cfg)

	api.On("GetChannel", "gggggggggggggggggggggggggg").Return(&model.Channel{Id: "gggggggggggggggggggggggggg", TeamId: "cccccccccccccccccccccccccc", Type: model.ChannelTypeDirect}, (*model.AppError)(nil))

	body := `{"title":"Test","event_type":"info","team_id":"cccccccccccccccccccccccccc","channels":["gggggggggggggggggggggggggg"]}`
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
		"title": "Test", "event_type": "info", "team_id": "cccccccccccccccccccccccccc", "channels": channels,
	})

	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "secret")
	rr := httptest.NewRecorder()
	p.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
