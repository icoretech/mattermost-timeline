package main

import (
	"encoding/json"
	"fmt"

	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	eventKeyPrefix = "event:"
	indexKeyPrefix = "event_index:"
)

// EventStore handles persistence of events using the plugin KV store.
// Events are stored per-team with an index+individual-key pattern.
type EventStore struct {
	api       plugin.API
	maxEvents int
}

func NewEventStore(api plugin.API, maxEvents int) *EventStore {
	return &EventStore{
		api:       api,
		maxEvents: maxEvents,
	}
}

// SetMaxEvents updates the maximum number of events stored per team.
func (s *EventStore) SetMaxEvents(n int) {
	s.maxEvents = n
}

func indexKey(teamID string) string {
	return indexKeyPrefix + teamID
}

func eventKey(id string) string {
	return eventKeyPrefix + id
}

// AddEvent stores a new event and updates the team's index.
func (s *EventStore) AddEvent(teamID string, event Event) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	if appErr := s.api.KVSet(eventKey(event.ID), eventJSON); appErr != nil {
		return fmt.Errorf("failed to store event: %w", appErr)
	}

	key := indexKey(teamID)

	var ids []string
	data, appErr := s.api.KVGet(key)
	if appErr != nil {
		return fmt.Errorf("failed to get index: %w", appErr)
	}

	if data != nil {
		if err := json.Unmarshal(data, &ids); err != nil {
			s.api.LogWarn("Corrupted event index, resetting", "team_id", teamID, "error", err.Error())
			ids = nil
		}
	}

	ids = append([]string{event.ID}, ids...)

	// Prune old events
	var pruneIDs []string
	if len(ids) > s.maxEvents {
		pruneIDs = ids[s.maxEvents:]
		ids = ids[:s.maxEvents]
	}

	newData, err := json.Marshal(ids)
	if err != nil {
		return fmt.Errorf("failed to marshal index: %w", err)
	}

	if appErr := s.api.KVSet(key, newData); appErr != nil {
		return fmt.Errorf("failed to update index: %w", appErr)
	}

	for _, id := range pruneIDs {
		if appErr := s.api.KVDelete(eventKey(id)); appErr != nil {
			s.api.LogWarn("Failed to prune event", "event_id", id, "error", appErr.Error())
		}
	}

	return nil
}

// GetEvents returns events for a team, paginated.
func (s *EventStore) GetEvents(teamID string, offset, limit int) ([]Event, int, error) {
	data, appErr := s.api.KVGet(indexKey(teamID))
	if appErr != nil {
		return nil, 0, fmt.Errorf("failed to get index: %s", appErr.Error())
	}

	if data == nil {
		return []Event{}, 0, nil
	}

	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil, 0, fmt.Errorf("failed to unmarshal index: %w", err)
	}

	total := len(ids)

	// Apply pagination
	if offset >= len(ids) {
		return []Event{}, total, nil
	}
	end := offset + limit
	if end > len(ids) {
		end = len(ids)
	}
	pageIDs := ids[offset:end]

	events := make([]Event, 0, len(pageIDs))
	var skipped int
	for _, id := range pageIDs {
		eventData, appErr := s.api.KVGet(eventKey(id))
		if appErr != nil {
			s.api.LogWarn("Failed to load event", "event_id", id, "error", appErr.Error())
			skipped++
			continue
		}
		if eventData == nil {
			skipped++
			continue
		}
		var event Event
		if err := json.Unmarshal(eventData, &event); err != nil {
			s.api.LogWarn("Failed to unmarshal event", "event_id", id, "error", err.Error())
			skipped++
			continue
		}
		events = append(events, event)
	}

	return events, total - skipped, nil
}
