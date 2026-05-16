package main

import (
	"encoding/json"
	"fmt"
	"sort"
)

// GetGlobalEvents returns team-wide events from the global index.
func (s *EventStore) GetGlobalEvents(teamID string, offset, limit int) ([]Event, int, error) {
	return s.loadEventsFromIndex(globalIndexKey(teamID), offset, limit)
}

// GetEventsByChannel returns events for a specific channel merged with team-wide events.
func (s *EventStore) GetEventsByChannel(teamID, channelID string, offset, limit int) ([]Event, int, error) {
	if err := validatePagination(offset, limit); err != nil {
		return nil, 0, err
	}

	channelIDs, err := s.loadIndexIDs(channelIndexKey(teamID, channelID), "channel index")
	if err != nil {
		return nil, 0, err
	}
	globalIDs, err := s.loadIndexIDs(globalIndexKey(teamID), "global index")
	if err != nil {
		return nil, 0, err
	}

	loaded, err := s.loadEventsByID(mergeUniqueIDs(channelIDs, globalIDs))
	if err != nil {
		return nil, 0, err
	}
	events := sortEventsByTimestampDesc(loaded)
	total := len(events)

	return paginateEvents(events, total, offset, limit), total, nil
}

func validatePagination(offset, limit int) error {
	if offset < 0 {
		return fmt.Errorf("offset must be non-negative")
	}
	if limit <= 0 {
		return fmt.Errorf("limit must be positive")
	}
	return nil
}

func (s *EventStore) loadIndexIDs(key, label string) ([]string, error) {
	data, appErr := s.api.KVGet(key)
	if appErr != nil {
		return nil, fmt.Errorf("failed to get %s: %w", label, appErr)
	}
	if data == nil {
		return nil, nil
	}

	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s: %w", label, err)
	}
	return ids, nil
}

func mergeUniqueIDs(primary, secondary []string) []string {
	seen := make(map[string]bool, len(primary)+len(secondary))
	ids := make([]string, 0, len(primary)+len(secondary))
	for _, id := range primary {
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	for _, id := range secondary {
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	return ids
}

type eventWithTimestamp struct {
	event Event
	ts    int64
}

func (s *EventStore) loadEventsByID(ids []string) ([]eventWithTimestamp, error) {
	loaded := make([]eventWithTimestamp, 0, len(ids))
	for _, id := range ids {
		event, err := s.loadEventByID(id)
		if err != nil {
			return nil, err
		}
		loaded = append(loaded, eventWithTimestamp{event: event, ts: event.Timestamp})
	}
	return loaded, nil
}

func sortEventsByTimestampDesc(loaded []eventWithTimestamp) []Event {
	sort.Slice(loaded, func(i, j int) bool {
		return loaded[i].ts > loaded[j].ts
	})

	return eventsFromLoaded(loaded)
}

func eventsFromLoaded(loaded []eventWithTimestamp) []Event {
	events := make([]Event, 0, len(loaded))
	for _, record := range loaded {
		events = append(events, record.event)
	}
	return events
}

func paginateEvents(events []Event, total, offset, limit int) []Event {
	if offset >= total {
		return []Event{}
	}
	end := offset + limit
	if end > total {
		end = total
	}

	return events[offset:end]
}

func paginateIDs(ids []string, total, offset, limit int) []string {
	if offset >= total {
		return []string{}
	}
	end := offset + limit
	if end > total {
		end = total
	}

	return ids[offset:end]
}
