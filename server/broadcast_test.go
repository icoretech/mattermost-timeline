package main

import (
	"encoding/json"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestPublishTimelineEventUsesEventAudience(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)

	event := Event{
		ID:       "evt-1",
		TeamID:   "team-1",
		Channels: []string{"ch-1", "ch-2"},
	}
	eventJSON, _ := json.Marshal(event)
	var payloads []map[string]interface{}
	var channelIDs []string

	api.On(
		"PublishWebSocketEvent",
		"new_event",
		mock.Anything,
		mock.AnythingOfType("*model.WebsocketBroadcast"),
	).Run(func(args mock.Arguments) {
		payloads = append(payloads, args.Get(1).(map[string]interface{}))
		broadcast := args.Get(2).(*model.WebsocketBroadcast)
		channelIDs = append(channelIDs, broadcast.ChannelId)
	}).Return().Twice()

	p.publishTimelineEvent("new_event", event, eventJSON)

	assert.Len(t, payloads, 2)
	assert.Equal(t, []string{"ch-1", "ch-2"}, channelIDs)
	assert.Equal(t, string(eventJSON), payloads[0]["event"])
	assert.Equal(t, string(eventJSON), payloads[1]["event"])
	assert.True(t, api.AssertExpectations(t))
}
