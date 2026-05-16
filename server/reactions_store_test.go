package main

import (
	"encoding/json"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetReactionUsersReturnsEmptyForMissingIcon(t *testing.T) {
	api := &plugintest.API{}
	store := NewEventStore(api, 100)
	event := Event{
		ID:     "evt-1",
		TeamID: "team-1",
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user-1"}},
		},
	}
	eventJSON, _ := json.Marshal(event)
	api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))

	userIDs, err := store.GetReactionUsers("evt-1", "heart")

	require.NoError(t, err)
	assert.Empty(t, userIDs)
	api.AssertExpectations(t)
}
