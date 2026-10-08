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

func TestAdminTokenErrors_ReturnStructuredValidation(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		code    string
		params  map[string]string
	}{
		{"invalid json", `{`, "invalid_json", nil},
		{"blank name", `{"tokens":[{"name":" "}]}`, "token_name_required", nil},
		{"duplicate name", `{"tokens":[{"name":"build","secret":"sample-secret"},{"name":" build "}]}`, "token_name_duplicate", map[string]string{"name": "build"}},
		{"missing secret", `{"tokens":[{"name":"build"}]}`, "token_secret_required", map[string]string{"name": "build"}},
		{"duplicate secret", `{"tokens":[{"name":"build","secret":"sample-secret"},{"name":"deploy","secret":"sample-secret"}]}`, "token_secret_duplicate", map[string]string{"name": "deploy", "owner": "build"}},
		{"legacy secret", `{"tokens":[{"name":"build","secret":"legacy-secret"}]}`, "token_secret_matches_legacy", map[string]string{"name": "build"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given an authenticated admin with a legacy secret configured.
			api := &plugintest.API{}
			p := newTestPlugin(t, api, &configuration{WebhookSecret: "legacy-secret"})
			api.On("HasPermissionTo", "admin-user", model.PermissionManageSystem).Return(true).Once()
			req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/webhook-tokens", strings.NewReader(tt.payload))
			req.Header.Set("Mattermost-User-ID", "admin-user")
			rec := httptest.NewRecorder()

			// When the invalid configuration is submitted through the real router.
			p.router.ServeHTTP(rec, req)

			// Then clients can translate the error without exposing secrets or saving it.
			require.Equal(t, http.StatusBadRequest, rec.Code)
			require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			var response adminErrorResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
			assert.Equal(t, tt.code, response.Code)
			assert.Equal(t, tt.params, response.Params)
			assert.NotEmpty(t, response.Message)
			assert.NotContains(t, rec.Body.String(), "sample-secret")
			assert.NotContains(t, rec.Body.String(), "legacy-secret")
			api.AssertNotCalled(t, "SavePluginConfig", mock.Anything)
			api.AssertExpectations(t)
		})
	}
}

func TestAdminTestEventErrors_ReturnStructuredIdentifiers(t *testing.T) {
	const teamID = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
	tests := []struct {
		name    string
		payload string
		code    string
		params  map[string]string
		status  int
		setup   func(*plugintest.API)
	}{
		{"invalid json", `{`, "invalid_json", nil, http.StatusBadRequest, nil},
		{"missing team", `{}`, "team_required", nil, http.StatusBadRequest, nil},
		{"unknown team", `{"team_id":"missing-team"}`, "team_invalid", map[string]string{"team": "missing-team"}, http.StatusBadRequest, func(api *plugintest.API) {
			api.On("GetTeamByName", "missing-team").Return((*model.Team)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound)).Once()
		}},
		{"team lookup failure", `{"team_id":"` + teamID + `"}`, "team_lookup_failed", map[string]string{"team": teamID}, http.StatusInternalServerError, func(api *plugintest.API) {
			api.On("GetTeam", teamID).Return((*model.Team)(nil), model.NewAppError("test", "lookup_failed", nil, "", http.StatusInternalServerError)).Once()
		}},
		{"unknown channel", `{"team_id":"` + teamID + `","channel_id":"missing-channel"}`, "channel_invalid", map[string]string{"channel": "missing-channel"}, http.StatusBadRequest, func(api *plugintest.API) {
			api.On("GetChannelByName", teamID, "missing-channel", false).Return((*model.Channel)(nil), model.NewAppError("test", "not_found", nil, "", http.StatusNotFound)).Once()
		}},
		{"wrong team channel", `{"team_id":"` + teamID + `","channel_id":"other-channel"}`, "channel_team_mismatch", map[string]string{"channel": "other-channel", "team": teamID}, http.StatusBadRequest, func(api *plugintest.API) {
			api.On("GetChannelByName", teamID, "other-channel", false).Return(&model.Channel{TeamId: "other-team", Type: model.ChannelTypeOpen}, (*model.AppError)(nil)).Once()
		}},
		{"direct channel", `{"team_id":"` + teamID + `","channel_id":"direct-channel"}`, "channel_dm_unsupported", map[string]string{"channel": "direct-channel"}, http.StatusBadRequest, func(api *plugintest.API) {
			api.On("GetChannelByName", teamID, "direct-channel", false).Return(&model.Channel{TeamId: teamID, Type: model.ChannelTypeDirect}, (*model.AppError)(nil)).Once()
		}},
		{"store failure", `{"team_id":"` + teamID + `"}`, "store_event_failed", nil, http.StatusInternalServerError, func(api *plugintest.API) {
			api.On("KVCompareAndSet", mock.Anything, []byte(nil), mock.Anything).Return(false, model.NewAppError("test", "store_failed", nil, "", http.StatusInternalServerError)).Once()
			api.On("LogError", "Failed to store admin test event", "error", mock.Anything).Once()
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given an admin and the selected lookup or storage outcome.
			api := &plugintest.API{}
			if tt.setup != nil {
				tt.setup(api)
			}
			p := newTestPlugin(t, api, &configuration{})
			api.On("HasPermissionTo", "admin-user", model.PermissionManageSystem).Return(true).Once()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/test-event", strings.NewReader(tt.payload))
			req.Header.Set("Mattermost-User-ID", "admin-user")
			rec := httptest.NewRecorder()

			// When a test event is submitted through the real router.
			p.router.ServeHTTP(rec, req)

			// Then the response retains status and supplies translated-message parameters.
			require.Equal(t, tt.status, rec.Code)
			require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			var response adminErrorResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
			assert.Equal(t, tt.code, response.Code)
			assert.Equal(t, tt.params, response.Params)
			assert.NotEmpty(t, response.Message)
			api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
			api.AssertExpectations(t)
		})
	}
}

func TestAdminConfigErrors_ReturnStructuredFailures(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		config string
		code   string
		setup  func(*plugintest.API)
	}{
		{"get corrupt configuration", http.MethodGet, "/api/v1/admin/webhook-config", `{`, "invalid_token_config", func(api *plugintest.API) {
			api.On("LogError", "Invalid webhook token configuration", "error", mock.Anything).Once()
		}},
		{"update corrupt configuration", http.MethodPut, "/api/v1/admin/webhook-tokens", `{`, "invalid_token_config", func(api *plugintest.API) {
			api.On("LogError", "Invalid webhook token configuration", "error", mock.Anything).Once()
		}},
		{"save failure", http.MethodPut, "/api/v1/admin/webhook-tokens", `[]`, "save_token_config", func(api *plugintest.API) {
			api.On("SavePluginConfig", mock.Anything).Return(model.NewAppError("test", "save_failed", nil, "", http.StatusInternalServerError)).Once()
			api.On("LogError", "Failed to save webhook token configuration", "error", mock.Anything).Once()
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given an admin and a configuration read or write failure.
			api := &plugintest.API{}
			tt.setup(api)
			p := newTestPlugin(t, api, &configuration{WebhookTokens: tt.config})
			api.On("HasPermissionTo", "admin-user", model.PermissionManageSystem).Return(true).Once()
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"tokens":[]}`))
			req.Header.Set("Mattermost-User-ID", "admin-user")
			rec := httptest.NewRecorder()

			// When the operation is requested through the real router.
			p.router.ServeHTTP(rec, req)

			// Then the configuration remains unchanged and a stable error is returned.
			require.Equal(t, http.StatusInternalServerError, rec.Code)
			var response adminErrorResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
			assert.Equal(t, tt.code, response.Code)
			assert.Nil(t, response.Params)
			assert.NotEmpty(t, response.Message)
			assert.Equal(t, tt.config, p.getConfiguration().WebhookTokens)
			api.AssertExpectations(t)
		})
	}
}

func TestWebhookErrors_RemainPlainText(t *testing.T) {
	// Given an authenticated webhook request without a team.
	api := &plugintest.API{}
	p := newTestPlugin(t, api, &configuration{WebhookSecret: "sample-secret"})
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{"title":"Example event"}`))
	req.Header.Set("X-Webhook-Secret", "sample-secret")
	rec := httptest.NewRecorder()

	// When shared validation produces an error that has an admin translation code.
	p.router.ServeHTTP(rec, req)

	// Then the external webhook's existing plain-text contract is retained.
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, "text/plain; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "team_id is required (query param or JSON field)\n", rec.Body.String())
	api.AssertExpectations(t)
}
