package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrepareReactionRequestRejectsInvalidIconBeforeStoreAccess(t *testing.T) {
	api := &plugintest.API{}
	p := newTestPlugin(t, api, &configuration{
		WebhookSecret:   "secret",
		EnableReactions: true,
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/events/evt-1/reactions/nope", nil)
	req.Header.Set("Mattermost-User-ID", "user-1")
	req = mux.SetURLVars(req, map[string]string{
		"eventId": "evt-1",
		"icon":    "nope",
	})
	rec := httptest.NewRecorder()

	reactionReq, ok := p.prepareReactionRequest(rec, req)

	require.False(t, ok)
	assert.Equal(t, reactionRequest{}, reactionReq)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid reaction icon")
	api.AssertExpectations(t)
}
