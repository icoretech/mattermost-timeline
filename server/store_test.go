package main

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestAddEvent(t *testing.T) {
	t.Run("add single event to empty team", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID:        "evt-1",
			TeamID:    "team-1",
			Timestamp: 1000,
			Title:     "deploy v1.0",
			EventType: "deploy",
		}

		// KVSet for the event itself
		api.On("KVSet", "event:evt-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index (no channels on event)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// KVGet for the index (empty team)
		api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))
		// KVSet for the updated index
		api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))

		err := store.AddEvent("team-1", event)
		require.NoError(t, err)
		api.AssertExpectations(t)
	})

	t.Run("add event prepends to existing index", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		existingIndex, _ := json.Marshal([]string{"evt-old"})
		event := Event{
			ID:        "evt-new",
			TeamID:    "team-1",
			Timestamp: 2000,
			Title:     "deploy v2.0",
			EventType: "deploy",
		}

		api.On("KVSet", "event:evt-new", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index (no channels on event)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		api.On("KVGet", "event_index:team-1").Return(existingIndex, (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).
			Run(func(args mock.Arguments) {
				data := args.Get(1).([]byte)
				var ids []string
				require.NoError(t, json.Unmarshal(data, &ids))
				assert.Equal(t, []string{"evt-new", "evt-old"}, ids)
			}).
			Return((*model.AppError)(nil))

		err := store.AddEvent("team-1", event)
		require.NoError(t, err)
		api.AssertExpectations(t)
	})

	t.Run("prune old events when exceeding maxEvents", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 3)

		existingIDs := []string{"evt-2", "evt-1", "evt-0"}
		existingIndex, _ := json.Marshal(existingIDs)

		event := Event{
			ID:        "evt-3",
			TeamID:    "team-1",
			Timestamp: 4000,
			Title:     "new event",
			EventType: "generic",
		}

		pruneEvt0 := Event{ID: "evt-0", Title: "old event", EventType: "generic"}
		pruneEvt0JSON, _ := json.Marshal(pruneEvt0)

		api.On("KVSet", "event:evt-3", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index for the new event (no channels)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		api.On("KVGet", "event_index:team-1").Return(existingIndex, (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).
			Run(func(args mock.Arguments) {
				data := args.Get(1).([]byte)
				var ids []string
				require.NoError(t, json.Unmarshal(data, &ids))
				assert.Equal(t, []string{"evt-3", "evt-2", "evt-1"}, ids, "should keep only maxEvents items")
			}).
			Return((*model.AppError)(nil))
		// Pruning: read the event to find its channels, then remove from global index
		api.On("KVGet", "event:evt-0").Return(pruneEvt0JSON, (*model.AppError)(nil))
		// The pruned event should be deleted
		api.On("KVDelete", "event:evt-0").Return((*model.AppError)(nil))

		err := store.AddEvent("team-1", event)
		require.NoError(t, err)
		api.AssertExpectations(t)
	})

	t.Run("prune continues even if delete fails", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 2)

		existingIDs := []string{"evt-1", "evt-0"}
		existingIndex, _ := json.Marshal(existingIDs)

		pruneEvt0 := Event{ID: "evt-0", Title: "old", EventType: "generic"}
		pruneEvt0JSON, _ := json.Marshal(pruneEvt0)

		event := Event{
			ID:        "evt-2",
			TeamID:    "team-1",
			Timestamp: 3000,
			Title:     "new",
			EventType: "generic",
		}

		api.On("KVSet", "event:evt-2", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index for the new event (no channels)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		api.On("KVGet", "event_index:team-1").Return(existingIndex, (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Pruning: read the event to find its channels, then remove from global index
		api.On("KVGet", "event:evt-0").Return(pruneEvt0JSON, (*model.AppError)(nil))
		// Simulate delete failure
		api.On("KVDelete", "event:evt-0").Return(model.NewAppError("test", "delete_failed", nil, "", 500))
		api.On("LogWarn", "Failed to prune event", "event_id", "evt-0", "error", mock.AnythingOfType("string"))

		err := store.AddEvent("team-1", event)
		require.NoError(t, err)
		api.AssertExpectations(t)
	})

	t.Run("corrupted index is reset", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID:        "evt-1",
			TeamID:    "team-1",
			Timestamp: 1000,
			Title:     "event after corruption",
			EventType: "generic",
		}

		api.On("KVSet", "event:evt-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index (no channels on event)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Return garbage data for the index
		api.On("KVGet", "event_index:team-1").Return([]byte("not valid json!!!"), (*model.AppError)(nil))
		api.On("LogWarn", "Corrupted event index, resetting", "team_id", "team-1", "error", mock.AnythingOfType("string"))
		api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).
			Run(func(args mock.Arguments) {
				data := args.Get(1).([]byte)
				var ids []string
				require.NoError(t, json.Unmarshal(data, &ids))
				assert.Equal(t, []string{"evt-1"}, ids, "should start fresh with only the new event")
			}).
			Return((*model.AppError)(nil))

		err := store.AddEvent("team-1", event)
		require.NoError(t, err)
		api.AssertExpectations(t)
	})

	t.Run("error storing event", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{ID: "evt-1", Title: "test"}

		api.On("KVSet", "event:evt-1", mock.AnythingOfType("[]uint8")).
			Return(model.NewAppError("test", "store_failed", nil, "", 500))

		err := store.AddEvent("team-1", event)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to store event")
		api.AssertExpectations(t)
	})

	t.Run("error reading index", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{ID: "evt-1", Title: "test"}

		api.On("KVSet", "event:evt-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		// Global index (no channels on event)
		api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
		api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
		api.On("KVGet", "event_index:team-1").
			Return([]byte(nil), model.NewAppError("test", "get_failed", nil, "", 500))

		err := store.AddEvent("team-1", event)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get index")
		api.AssertExpectations(t)
	})
}

func TestGetEvents(t *testing.T) {
	t.Run("empty team returns empty slice", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.NoError(t, err)
		assert.Empty(t, events)
		assert.Equal(t, 0, total)
		api.AssertExpectations(t)
	})

	t.Run("returns all events within limit", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-2", "evt-1"}
		indexData, _ := json.Marshal(ids)

		evt1 := Event{ID: "evt-1", Title: "first", EventType: "deploy"}
		evt2 := Event{ID: "evt-2", Title: "second", EventType: "deploy"}
		evt1JSON, _ := json.Marshal(evt1)
		evt2JSON, _ := json.Marshal(evt2)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-1").Return(evt1JSON, (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.NoError(t, err)
		assert.Len(t, events, 2)
		assert.Equal(t, 2, total)
		assert.Equal(t, "evt-2", events[0].ID)
		assert.Equal(t, "evt-1", events[1].ID)
		api.AssertExpectations(t)
	})

	t.Run("pagination with offset and limit", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-4", "evt-3", "evt-2", "evt-1", "evt-0"}
		indexData, _ := json.Marshal(ids)

		evt2 := Event{ID: "evt-2", Title: "middle", EventType: "generic"}
		evt2JSON, _ := json.Marshal(evt2)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 2, 1)
		require.NoError(t, err)
		assert.Len(t, events, 1)
		assert.Equal(t, 5, total)
		assert.Equal(t, "evt-2", events[0].ID)
		api.AssertExpectations(t)
	})

	t.Run("offset beyond total returns empty", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-1"}
		indexData, _ := json.Marshal(ids)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 10, 50)
		require.NoError(t, err)
		assert.Empty(t, events)
		assert.Equal(t, 1, total)
		api.AssertExpectations(t)
	})

	t.Run("skips missing events and adjusts total", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-2", "evt-1"}
		indexData, _ := json.Marshal(ids)

		evt2 := Event{ID: "evt-2", Title: "found", EventType: "deploy"}
		evt2JSON, _ := json.Marshal(evt2)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
		// evt-1 is missing (nil data)
		api.On("KVGet", "event:evt-1").Return([]byte(nil), (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.NoError(t, err)
		assert.Len(t, events, 1)
		assert.Equal(t, 1, total, "total should be decremented for missing events")
		assert.Equal(t, "evt-2", events[0].ID)
		api.AssertExpectations(t)
	})

	t.Run("skips events that fail to load", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-2", "evt-1"}
		indexData, _ := json.Marshal(ids)

		evt2 := Event{ID: "evt-2", Title: "ok", EventType: "deploy"}
		evt2JSON, _ := json.Marshal(evt2)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-1").Return([]byte(nil), model.NewAppError("test", "load_failed", nil, "", 500))
		api.On("LogWarn", "Failed to load event", "event_id", "evt-1", "error", mock.AnythingOfType("string"))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.NoError(t, err)
		assert.Len(t, events, 1)
		assert.Equal(t, 1, total)
		api.AssertExpectations(t)
	})

	t.Run("skips events with corrupted JSON", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		ids := []string{"evt-1"}
		indexData, _ := json.Marshal(ids)

		api.On("KVGet", "event_index:team-1").Return(indexData, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-1").Return([]byte("{bad json"), (*model.AppError)(nil))
		api.On("LogWarn", "Failed to unmarshal event", "event_id", "evt-1", "error", mock.AnythingOfType("string"))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.NoError(t, err)
		assert.Empty(t, events)
		assert.Equal(t, 0, total)
		api.AssertExpectations(t)
	})

	t.Run("error reading index", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		api.On("KVGet", "event_index:team-1").
			Return([]byte(nil), model.NewAppError("test", "get_failed", nil, "", 500))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get index")
		assert.Nil(t, events)
		assert.Equal(t, 0, total)
		api.AssertExpectations(t)
	})

	t.Run("corrupted index returns error", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		api.On("KVGet", "event_index:team-1").Return([]byte("not json"), (*model.AppError)(nil))

		events, total, err := store.GetEvents("team-1", 0, 50)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to unmarshal index")
		assert.Nil(t, events)
		assert.Equal(t, 0, total)
		api.AssertExpectations(t)
	})
}

func TestSetMaxEvents(t *testing.T) {
	api := &plugintest.API{}
	store := NewEventStore(api, 100)
	assert.Equal(t, 100, store.maxEvents)

	store.SetMaxEvents(50)
	assert.Equal(t, 50, store.maxEvents)
}

func TestMultipleTeamsAreIsolated(t *testing.T) {
	api := &plugintest.API{}
	store := NewEventStore(api, 100)

	evt1 := Event{ID: "evt-t1", TeamID: "team-1", Title: "team 1 event", EventType: "generic"}
	evt2 := Event{ID: "evt-t2", TeamID: "team-2", Title: "team 2 event", EventType: "generic"}

	// Add event to team-1
	api.On("KVSet", "event:evt-t1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return([]byte(nil), (*model.AppError)(nil)).Once()
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))

	// Add event to team-2
	api.On("KVSet", "event:evt-t2", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-2:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-2:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-2").Return([]byte(nil), (*model.AppError)(nil)).Once()
	api.On("KVSet", "event_index:team-2", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))

	require.NoError(t, store.AddEvent("team-1", evt1))
	require.NoError(t, store.AddEvent("team-2", evt2))

	// Retrieve team-1 events
	t1Index, _ := json.Marshal([]string{"evt-t1"})
	evt1JSON, _ := json.Marshal(evt1)
	api.On("KVGet", "event_index:team-1").Return(t1Index, (*model.AppError)(nil)).Once()
	api.On("KVGet", "event:evt-t1").Return(evt1JSON, (*model.AppError)(nil))

	events, total, err := store.GetEvents("team-1", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, events, 1)
	assert.Equal(t, "evt-t1", events[0].ID)

	api.AssertExpectations(t)
}

func TestGetEventsByChannel(t *testing.T) {
	t.Run("merges channel and global events sorted by timestamp", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		chIndex, _ := json.Marshal([]string{"evt-2"})
		api.On("KVGet", "event_index:team-1:ch1").Return(chIndex, (*model.AppError)(nil))

		glIndex, _ := json.Marshal([]string{"evt-3", "evt-1"})
		api.On("KVGet", "event_index:team-1:_global").Return(glIndex, (*model.AppError)(nil))

		evt1 := Event{ID: "evt-1", Timestamp: 1000}
		evt2 := Event{ID: "evt-2", Timestamp: 2000}
		evt3 := Event{ID: "evt-3", Timestamp: 3000}
		evt1JSON, _ := json.Marshal(evt1)
		evt2JSON, _ := json.Marshal(evt2)
		evt3JSON, _ := json.Marshal(evt3)

		api.On("KVGet", "event:evt-1").Return(evt1JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-3").Return(evt3JSON, (*model.AppError)(nil))

		events, total, err := store.GetEventsByChannel("team-1", "ch1", 0, 10)
		require.NoError(t, err)
		assert.Equal(t, 3, total)
		require.Len(t, events, 3)
		assert.Equal(t, "evt-3", events[0].ID)
		assert.Equal(t, "evt-2", events[1].ID)
		assert.Equal(t, "evt-1", events[2].ID)
		api.AssertExpectations(t)
	})

	t.Run("pagination works after sorting", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		chIndex, _ := json.Marshal([]string{"evt-2"})
		api.On("KVGet", "event_index:team-1:ch1").Return(chIndex, (*model.AppError)(nil))

		glIndex, _ := json.Marshal([]string{"evt-3", "evt-1"})
		api.On("KVGet", "event_index:team-1:_global").Return(glIndex, (*model.AppError)(nil))

		evt1 := Event{ID: "evt-1", Timestamp: 1000}
		evt2 := Event{ID: "evt-2", Timestamp: 2000}
		evt3 := Event{ID: "evt-3", Timestamp: 3000}
		evt1JSON, _ := json.Marshal(evt1)
		evt2JSON, _ := json.Marshal(evt2)
		evt3JSON, _ := json.Marshal(evt3)

		api.On("KVGet", "event:evt-1").Return(evt1JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-2").Return(evt2JSON, (*model.AppError)(nil))
		api.On("KVGet", "event:evt-3").Return(evt3JSON, (*model.AppError)(nil))

		events, total, err := store.GetEventsByChannel("team-1", "ch1", 1, 1)
		require.NoError(t, err)
		assert.Equal(t, 3, total)
		require.Len(t, events, 1)
		assert.Equal(t, "evt-2", events[0].ID)
		api.AssertExpectations(t)
	})

	t.Run("deduplicates IDs across indexes", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		chIndex, _ := json.Marshal([]string{"evt-1"})
		api.On("KVGet", "event_index:team-1:ch1").Return(chIndex, (*model.AppError)(nil))

		glIndex, _ := json.Marshal([]string{"evt-1"})
		api.On("KVGet", "event_index:team-1:_global").Return(glIndex, (*model.AppError)(nil))

		evt1 := Event{ID: "evt-1", Timestamp: 1000}
		evt1JSON, _ := json.Marshal(evt1)
		api.On("KVGet", "event:evt-1").Return(evt1JSON, (*model.AppError)(nil))

		events, total, err := store.GetEventsByChannel("team-1", "ch1", 0, 10)
		require.NoError(t, err)
		assert.Equal(t, 1, total)
		require.Len(t, events, 1)
		api.AssertExpectations(t)
	})
}

func TestAddReaction(t *testing.T) {
	t.Run("adds reaction to event", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{ID: "evt-1", Title: "Test", EventType: "info"}
		eventJSON, _ := json.Marshal(event)

		api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
		api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))

		updated, err := store.AddReaction("evt-1", "eyes", "user1")
		require.NoError(t, err)
		require.NotNil(t, updated)
		assert.Equal(t, 1, updated.Reactions["eyes"].Count)
		assert.Equal(t, []string{"user1"}, updated.Reactions["eyes"].UserIDs)
		api.AssertExpectations(t)
	})

	t.Run("no-op if user already reacted", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID: "evt-1", Title: "Test", EventType: "info",
			Reactions: EventReactions{"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user1"}}},
		}
		eventJSON, _ := json.Marshal(event)

		api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))

		updated, err := store.AddReaction("evt-1", "eyes", "user1")
		require.NoError(t, err)
		assert.Equal(t, 1, updated.Reactions["eyes"].Count)
		api.AssertExpectations(t)
	})
}

func TestRemoveReaction(t *testing.T) {
	t.Run("removes reaction from event", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID: "evt-1", Title: "Test", EventType: "info",
			Reactions: EventReactions{"eyes": ReactionSummary{Count: 2, UserIDs: []string{"user1", "user2"}}},
		}
		eventJSON, _ := json.Marshal(event)

		api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
		api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))

		updated, err := store.RemoveReaction("evt-1", "eyes", "user1")
		require.NoError(t, err)
		require.NotNil(t, updated)
		assert.Equal(t, 1, updated.Reactions["eyes"].Count)
		assert.Equal(t, []string{"user2"}, updated.Reactions["eyes"].UserIDs)
		api.AssertExpectations(t)
	})

	t.Run("removes last reaction deletes icon entry", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID: "evt-1", Title: "Test", EventType: "info",
			Reactions: EventReactions{"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user1"}}},
		}
		eventJSON, _ := json.Marshal(event)

		api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))
		api.On("KVCompareAndSet", "event:evt-1", eventJSON, mock.Anything).Return(true, (*model.AppError)(nil))

		updated, err := store.RemoveReaction("evt-1", "eyes", "user1")
		require.NoError(t, err)
		_, exists := updated.Reactions["eyes"]
		assert.False(t, exists, "should remove icon entry when last user unreacts")
		api.AssertExpectations(t)
	})

	t.Run("no-op if user hasn't reacted", func(t *testing.T) {
		api := &plugintest.API{}
		store := NewEventStore(api, 100)

		event := Event{
			ID: "evt-1", Title: "Test", EventType: "info",
			Reactions: EventReactions{"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user1"}}},
		}
		eventJSON, _ := json.Marshal(event)

		api.On("KVGet", "event:evt-1").Return(eventJSON, (*model.AppError)(nil))

		updated, err := store.RemoveReaction("evt-1", "eyes", "user2")
		require.NoError(t, err)
		assert.Equal(t, 1, updated.Reactions["eyes"].Count)
		api.AssertExpectations(t)
	})
}

func TestPruneMultipleEvents(t *testing.T) {
	api := &plugintest.API{}
	store := NewEventStore(api, 2)

	// Already have 3 events, maxEvents is 2
	existingIDs := []string{"evt-3", "evt-2", "evt-1"}
	existingIndex, _ := json.Marshal(existingIDs)

	event := Event{ID: "evt-4", Title: "newest", EventType: "generic"}

	pruneEvt2 := Event{ID: "evt-2", Title: "old2", EventType: "generic"}
	pruneEvt2JSON, _ := json.Marshal(pruneEvt2)
	pruneEvt1 := Event{ID: "evt-1", Title: "old1", EventType: "generic"}
	pruneEvt1JSON, _ := json.Marshal(pruneEvt1)

	api.On("KVSet", "event:evt-4", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	// Global index for the new event (no channels)
	api.On("KVGet", "event_index:team-1:_global").Return([]byte(nil), (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1:_global", mock.AnythingOfType("[]uint8")).Return((*model.AppError)(nil))
	api.On("KVGet", "event_index:team-1").Return(existingIndex, (*model.AppError)(nil))
	api.On("KVSet", "event_index:team-1", mock.AnythingOfType("[]uint8")).
		Run(func(args mock.Arguments) {
			var ids []string
			require.NoError(t, json.Unmarshal(args.Get(1).([]byte), &ids))
			assert.Equal(t, []string{"evt-4", "evt-3"}, ids)
		}).
		Return((*model.AppError)(nil))
	// Pruning: read each event, then remove from global index and delete
	api.On("KVGet", "event:evt-2").Return(pruneEvt2JSON, (*model.AppError)(nil))
	api.On("KVGet", "event:evt-1").Return(pruneEvt1JSON, (*model.AppError)(nil))
	for _, id := range []string{"evt-2", "evt-1"} {
		api.On("KVDelete", fmt.Sprintf("event:%s", id)).Return((*model.AppError)(nil))
	}

	err := store.AddEvent("team-1", event)
	require.NoError(t, err)
	api.AssertExpectations(t)
}
