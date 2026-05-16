package main

import (
	"encoding/json"
	"fmt"
)

const maxReactionRetries = 3

// AddReaction adds a user's reaction to an event using KVCompareAndSet for concurrency safety.
func (s *EventStore) AddReaction(eventID, icon, userID string) (*Event, error) {
	return s.mutateReaction(eventID, "add reaction", func(event *Event) bool {
		if event.Reactions == nil {
			event.Reactions = make(EventReactions)
		}

		summary := event.Reactions[icon]
		for _, uid := range summary.UserIDs {
			if uid == userID {
				return false
			}
		}

		summary.UserIDs = append(summary.UserIDs, userID)
		summary.Count = len(summary.UserIDs)
		event.Reactions[icon] = summary
		return true
	})
}

// RemoveReaction removes a user's reaction from an event using KVCompareAndSet.
func (s *EventStore) RemoveReaction(eventID, icon, userID string) (*Event, error) {
	return s.mutateReaction(eventID, "remove reaction", func(event *Event) bool {
		if event.Reactions == nil {
			return false
		}

		summary, exists := event.Reactions[icon]
		if !exists {
			return false
		}

		filtered := make([]string, 0, len(summary.UserIDs))
		for _, uid := range summary.UserIDs {
			if uid != userID {
				filtered = append(filtered, uid)
			}
		}

		if len(filtered) == len(summary.UserIDs) {
			return false
		}

		if len(filtered) == 0 {
			delete(event.Reactions, icon)
		} else {
			summary.UserIDs = filtered
			summary.Count = len(filtered)
			event.Reactions[icon] = summary
		}
		return true
	})
}

func (s *EventStore) mutateReaction(eventID, operation string, mutate func(*Event) bool) (*Event, error) {
	for attempt := 0; attempt < maxReactionRetries; attempt++ {
		data, appErr := s.api.KVGet(eventKey(eventID))
		if appErr != nil {
			return nil, fmt.Errorf("failed to get event: %w", appErr)
		}
		if data == nil {
			return nil, fmt.Errorf("event not found: %s", eventID)
		}

		var event Event
		if err := json.Unmarshal(data, &event); err != nil {
			return nil, fmt.Errorf("failed to unmarshal event: %w", err)
		}

		if !mutate(&event) {
			return &event, nil
		}

		newData, err := json.Marshal(event)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal event: %w", err)
		}

		ok, appErr := s.api.KVCompareAndSet(eventKey(eventID), data, newData)
		if appErr != nil {
			return nil, fmt.Errorf("failed to compare-and-set: %w", appErr)
		}
		if ok {
			return &event, nil
		}
		// Conflict — retry
	}
	return nil, fmt.Errorf("failed to %s after %d retries (conflict)", operation, maxReactionRetries)
}

// GetReactionUsers returns all user IDs for a specific reaction icon on an event.
func (s *EventStore) GetReactionUsers(eventID, icon string) ([]string, error) {
	event, err := s.GetEvent(eventID)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, fmt.Errorf("event not found: %s", eventID)
	}
	if event.Reactions == nil {
		return []string{}, nil
	}
	summary, exists := event.Reactions[icon]
	if !exists {
		return []string{}, nil
	}
	return summary.UserIDs, nil
}
