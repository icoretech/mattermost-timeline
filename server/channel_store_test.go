package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestMergeUniqueIDsKeepsPrimaryOrder(t *testing.T) {
	ids := mergeUniqueIDs(
		[]string{"evt-2", "evt-1"},
		[]string{"evt-3", "evt-2", "evt-0"},
	)

	assert.Equal(t, []string{"evt-2", "evt-1", "evt-3", "evt-0"}, ids)
}

func TestPaginateEventsBounds(t *testing.T) {
	events := []Event{
		{ID: "evt-3"},
		{ID: "evt-2"},
		{ID: "evt-1"},
	}

	page := paginateEvents(events, len(events), 1, 5)

	assert.Equal(t, []Event{{ID: "evt-2"}, {ID: "evt-1"}}, page)
	assert.Empty(t, paginateEvents(events, len(events), 4, 1))
}

func TestGetEventsByChannelRejectsNonPositiveLimit(t *testing.T) {
	api := &plugintest.API{}
	store := NewEventStore(api, 100)

	events, total, err := store.GetEventsByChannel("team-1", "channel-1", 0, 0)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "limit must be positive")
	assert.Nil(t, events)
	assert.Equal(t, 0, total)
	api.AssertNotCalled(t, "KVGet", mock.Anything)
}
