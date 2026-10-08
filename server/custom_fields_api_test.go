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

func TestHandleWebhook_CustomFieldsRoundTrip(t *testing.T) {
	// Given a webhook with ordered native scalar fields.
	api := &plugintest.API{}
	p := newTestPlugin(t, api, &configuration{WebhookSecret: "s3cret", MaxEventsStored: "100"})
	expectWebhookEventCreate(api, "aaaaaaaaaaaaaaaaaaaaaaaaaa")
	api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVCompareAndSet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-1", []byte(nil), mock.Anything).Return(true, (*model.AppError)(nil))
	var storedJSON, websocketJSON []byte
	for _, call := range api.ExpectedCalls {
		switch call.Method {
		case "KVSet":
			call.Run(func(args mock.Arguments) {
				if strings.HasPrefix(args.String(0), "event:") {
					storedJSON = args.Get(1).([]byte)
				}
			})
		case "PublishWebSocketEvent":
			call.Run(func(args mock.Arguments) {
				websocketJSON = []byte(args.Get(1).(map[string]interface{})["event"].(string))
			})
		}
	}
	fields := `[{"name":"stage","value":"review","label":"Stage"},{"name":"attempt","value":0,"type":"number"},{"name":"approved","value":false}]`
	body := `{"title":"build","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-1","custom_fields":` + fields + `}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	// When the real HTTP route ingests the event.
	p.router.ServeHTTP(rec, req)

	// Then its response retains the ordered values and their native types.
	require.Equal(t, http.StatusCreated, rec.Code)
	for _, encoded := range [][]byte{rec.Body.Bytes(), storedJSON, websocketJSON} {
		var event map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(encoded, &event))
		assert.JSONEq(t, fields, string(event["custom_fields"]))
	}
	api.AssertExpectations(t)
}

func TestHandleWebhook_CustomFieldsUpdate(t *testing.T) {
	for _, test := range []struct {
		name, update, expected string
	}{
		{"omitted preserves", "", `[{"name":"stage","value":"review"}]`},
		{"null preserves", `,"custom_fields":null`, `[{"name":"stage","value":"review"}]`},
		{"empty clears", `,"custom_fields":[]`, ""},
		{"array replaces", `,"custom_fields":[{"name":"approved","value":false}]`, `[{"name":"approved","value":false}]`},
	} {
		t.Run(test.name, func(t *testing.T) {
			// Given an external-id event with saved custom metadata.
			api := &plugintest.API{}
			p := newTestPlugin(t, api, &configuration{WebhookSecret: "s3cret", MaxEventsStored: "100"})
			existing := []byte(`{"id":"evt-1","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","title":"build","external_id":"build-1","custom_fields":[{"name":"stage","value":"review"}]}`)
			api.On("KVGet", "ext_id:aaaaaaaaaaaaaaaaaaaaaaaaaa:build-1").Return([]byte("evt-1"), (*model.AppError)(nil))
			api.On("KVGet", "event:evt-1").Return(existing, (*model.AppError)(nil))
			var storedJSON, websocketJSON []byte
			api.On("KVSet", "event:evt-1", mock.Anything).Run(func(args mock.Arguments) {
				storedJSON = args.Get(1).([]byte)
			}).Return((*model.AppError)(nil))
			api.On("KVGet", retentionIndexKey("aaaaaaaaaaaaaaaaaaaaaaaaaa")).Return([]byte(`["evt-1"]`), (*model.AppError)(nil))
			api.On("KVCompareAndSet", retentionIndexKey("aaaaaaaaaaaaaaaaaaaaaaaaaa"), mock.Anything, mock.Anything).Return(true, (*model.AppError)(nil))
			api.On("PublishWebSocketEvent", "updated_event", mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
				websocketJSON = []byte(args.Get(1).(map[string]interface{})["event"].(string))
			})
			body := `{"title":"build updated","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","external_id":"build-1"` + test.update + `}`
			req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
			req.Header.Set("X-Webhook-Secret", "s3cret")
			rec := httptest.NewRecorder()

			// When a webhook updates that external-id event.
			p.router.ServeHTTP(rec, req)

			// Then storage, HTTP and websocket carry the same updated fields.
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			for _, encoded := range [][]byte{rec.Body.Bytes(), storedJSON, websocketJSON} {
				var event map[string]json.RawMessage
				require.NoError(t, json.Unmarshal(encoded, &event))
				assert.Equal(t, `"evt-1"`, string(event["id"]))
				if test.expected == "" {
					assert.NotContains(t, event, "custom_fields")
				} else {
					assert.JSONEq(t, test.expected, string(event["custom_fields"]))
				}
			}
			api.AssertExpectations(t)
		})
	}
}

func TestHandleWebhookBatch_CustomFields(t *testing.T) {
	// Given a batch containing valid and invalid field values.
	api := &plugintest.API{}
	p := newTestPlugin(t, api, &configuration{WebhookSecret: "s3cret", MaxEventsStored: "100"})
	expectWebhookEventCreate(api, "aaaaaaaaaaaaaaaaaaaaaaaaaa")
	body := `{"events":[{"title":"first","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","custom_fields":[{"name":"attempt","value":0}]},{"title":"invalid","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","custom_fields":[{"name":"nested","value":{}}]}]}`
	req := httptest.NewRequest(http.MethodPost, "/webhook/batch", strings.NewReader(body))
	req.Header.Set("X-Webhook-Secret", "s3cret")
	rec := httptest.NewRecorder()

	// When the batch route processes both items.
	p.router.ServeHTTP(rec, req)

	// Then the valid scalar survives and the invalid item has its own error.
	require.Equal(t, http.StatusMultiStatus, rec.Code)
	var response BatchWebhookResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
	require.Len(t, response.Results, 2)
	assert.Equal(t, http.StatusCreated, response.Results[0].Status)
	require.NotNil(t, response.Results[0].Event)
	require.Len(t, response.Results[0].Event.CustomFields, 1)
	assert.Equal(t, "0", string(response.Results[0].Event.CustomFields[0].Value))
	assert.Equal(t, http.StatusBadRequest, response.Results[1].Status)
	assert.Nil(t, response.Results[1].Event)
	api.AssertExpectations(t)
}

func TestHandleGetEvents_CustomFields(t *testing.T) {
	// Given persisted custom fields and an authorized team member.
	api := &plugintest.API{}
	p := newTestPlugin(t, api, &configuration{MaxEventsStored: "100", MaxEventsDisplayed: "50"})
	api.On("GetTeamMember", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "user-1").Return(&model.TeamMember{}, (*model.AppError)(nil))
	fields := `[{"name":"stage","label":"Stage","value":"review"},{"name":"approved","value":false}]`
	storedJSON := []byte(`{"id":"evt-1","team_id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","timestamp":100,"title":"build","custom_fields":` + fields + `}`)
	api.On("KVGet", globalIndexKey("aaaaaaaaaaaaaaaaaaaaaaaaaa")).Return([]byte(`["evt-1"]`), (*model.AppError)(nil))
	api.On("KVGet", "event:evt-1").Return(storedJSON, (*model.AppError)(nil))
	expectReadStateInitialization(t, api, "user-1", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "", 100)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?team_id=aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	rec := httptest.NewRecorder()

	// When the authenticated list route reloads the event from storage.
	p.router.ServeHTTP(rec, req)

	// Then the event still includes native fields in their original order.
	require.Equal(t, http.StatusOK, rec.Code)
	var response struct {
		Events []map[string]json.RawMessage `json:"events"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
	require.Len(t, response.Events, 1)
	assert.JSONEq(t, fields, string(response.Events[0]["custom_fields"]))
	api.AssertExpectations(t)
}
