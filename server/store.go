package main

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	eventKeyPrefix = "event:"
	indexKeyPrefix = "event_index:"
	extIDKeyPrefix = "ext_id:"
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

func extIDKey(teamID, externalID string) string {
	return extIDKeyPrefix + teamID + ":" + externalID
}

const (
	globalChannelSuffix = "_global"
	maxChannelsPerEvent = 10
)

func channelIndexKey(teamID, channelID string) string {
	return indexKeyPrefix + teamID + ":" + channelID
}

func globalIndexKey(teamID string) string {
	return indexKeyPrefix + teamID + ":" + globalChannelSuffix
}

func (s *EventStore) loadEventsFromIndex(key string, offset, limit int) ([]Event, int, error) {
	if offset < 0 {
		return nil, 0, fmt.Errorf("offset must be non-negative")
	}

	data, appErr := s.api.KVGet(key)
	if appErr != nil {
		return nil, 0, fmt.Errorf("failed to get index: %w", appErr)
	}
	if data == nil {
		return []Event{}, 0, nil
	}

	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil, 0, fmt.Errorf("failed to unmarshal index: %w", err)
	}

	total := len(ids)
	if offset >= total {
		return []Event{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
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

// LookupByExternalID returns the internal event ID for a given external ID, or "" if not found.
func (s *EventStore) LookupByExternalID(teamID, externalID string) (string, error) {
	data, appErr := s.api.KVGet(extIDKey(teamID, externalID))
	if appErr != nil {
		return "", fmt.Errorf("failed to lookup external ID: %w", appErr)
	}
	if data == nil {
		return "", nil
	}
	return string(data), nil
}

// GetEvent returns a single event by ID.
func (s *EventStore) GetEvent(eventID string) (*Event, error) {
	data, appErr := s.api.KVGet(eventKey(eventID))
	if appErr != nil {
		return nil, fmt.Errorf("failed to get event: %w", appErr)
	}
	if data == nil {
		return nil, nil
	}
	var event Event
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, fmt.Errorf("failed to unmarshal event: %w", err)
	}
	return &event, nil
}

// UpdateEvent replaces an existing event in the KV store, updates channel indexes, and moves it to the front of the main index.
// oldChannels is the event's previous Channels value (before the update), used to compute index diffs.
func (s *EventStore) UpdateEvent(teamID string, oldChannels []string, event Event) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	if appErr := s.api.KVSet(eventKey(event.ID), eventJSON); appErr != nil {
		return fmt.Errorf("failed to store event: %w", appErr)
	}

	// Update channel indexes if channels changed
	oldSet := make(map[string]bool, len(oldChannels))
	for _, ch := range oldChannels {
		oldSet[ch] = true
	}
	newSet := make(map[string]bool, len(event.Channels))
	for _, ch := range event.Channels {
		newSet[ch] = true
	}

	// Remove from old channel indexes (or global)
	if len(oldChannels) == 0 {
		if len(event.Channels) > 0 {
			_ = s.removeFromIndex(globalIndexKey(teamID), event.ID)
		}
	} else {
		for _, ch := range oldChannels {
			if !newSet[ch] {
				_ = s.removeFromIndex(channelIndexKey(teamID, ch), event.ID)
			}
		}
	}

	// Add to new channel indexes (or global)
	if len(event.Channels) == 0 {
		if len(oldChannels) > 0 {
			_ = s.prependToIndex(globalIndexKey(teamID), event.ID)
		}
	} else {
		for _, ch := range event.Channels {
			if !oldSet[ch] {
				_ = s.prependToIndex(channelIndexKey(teamID, ch), event.ID)
			}
		}
	}

	// Move to front of main team index
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

	filtered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != event.ID {
			filtered = append(filtered, id)
		}
	}
	ids = append([]string{event.ID}, filtered...)

	newData, err := json.Marshal(ids)
	if err != nil {
		return fmt.Errorf("failed to marshal index: %w", err)
	}

	if appErr := s.api.KVSet(key, newData); appErr != nil {
		return fmt.Errorf("failed to update index: %w", appErr)
	}

	return nil
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

	// Store external ID mapping if present
	if event.ExternalID != "" {
		if appErr := s.api.KVSet(extIDKey(teamID, event.ExternalID), []byte(event.ID)); appErr != nil {
			s.api.LogWarn("Failed to store external ID mapping", "external_id", event.ExternalID, "error", appErr.Error())
		}
	}

	// Maintain channel-specific or global index
	if len(event.Channels) > 0 {
		for _, chID := range event.Channels {
			if err := s.prependToIndex(channelIndexKey(teamID, chID), event.ID); err != nil {
				s.api.LogWarn("Failed to update channel index", "channel_id", chID, "error", err.Error())
			}
		}
	} else {
		if err := s.prependToIndex(globalIndexKey(teamID), event.ID); err != nil {
			s.api.LogWarn("Failed to update global index", "error", err.Error())
		}
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
		// Read event to find its channel indexes before deleting
		if eventData, appErr := s.api.KVGet(eventKey(id)); appErr == nil && eventData != nil {
			var pruneEvent Event
			if err := json.Unmarshal(eventData, &pruneEvent); err == nil {
				if len(pruneEvent.Channels) > 0 {
					for _, chID := range pruneEvent.Channels {
						if err := s.removeFromIndex(channelIndexKey(teamID, chID), id); err != nil {
							s.api.LogWarn("Failed to clean channel index during prune", "channel_id", chID, "event_id", id, "error", err.Error())
						}
					}
				} else {
					if err := s.removeFromIndex(globalIndexKey(teamID), id); err != nil {
						s.api.LogWarn("Failed to clean global index during prune", "event_id", id, "error", err.Error())
					}
				}
			}
		}
		if appErr := s.api.KVDelete(eventKey(id)); appErr != nil {
			s.api.LogWarn("Failed to prune event", "event_id", id, "error", appErr.Error())
		}
	}

	return nil
}

// prependToIndex adds an event ID to the front of an index array.
func (s *EventStore) prependToIndex(key, eventID string) error {
	var ids []string
	data, appErr := s.api.KVGet(key)
	if appErr != nil {
		return fmt.Errorf("failed to get index %s: %w", key, appErr)
	}
	if data != nil {
		if err := json.Unmarshal(data, &ids); err != nil {
			s.api.LogWarn("Corrupted index, resetting", "key", key, "error", err.Error())
			ids = nil
		}
	}
	ids = append([]string{eventID}, ids...)
	newData, err := json.Marshal(ids)
	if err != nil {
		return fmt.Errorf("failed to marshal index: %w", err)
	}
	if appErr := s.api.KVSet(key, newData); appErr != nil {
		return fmt.Errorf("failed to update index: %w", appErr)
	}
	return nil
}

// removeFromIndex removes an event ID from an index array.
func (s *EventStore) removeFromIndex(key, eventID string) error {
	var ids []string
	data, appErr := s.api.KVGet(key)
	if appErr != nil {
		return fmt.Errorf("failed to get index %s: %w", key, appErr)
	}
	if data == nil {
		return nil
	}
	if err := json.Unmarshal(data, &ids); err != nil {
		s.api.LogWarn("Corrupted index, skipping removal", "key", key, "error", err.Error())
		return nil
	}
	filtered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != eventID {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == len(ids) {
		return nil // not found, nothing changed
	}
	newData, err := json.Marshal(filtered)
	if err != nil {
		return fmt.Errorf("failed to marshal index: %w", err)
	}
	if appErr := s.api.KVSet(key, newData); appErr != nil {
		return fmt.Errorf("failed to update index: %w", appErr)
	}
	return nil
}

// GetEvents returns events for a team, paginated.
func (s *EventStore) GetEvents(teamID string, offset, limit int) ([]Event, int, error) {
	return s.loadEventsFromIndex(indexKey(teamID), offset, limit)
}

// GetGlobalEvents returns team-wide events from the global index.
func (s *EventStore) GetGlobalEvents(teamID string, offset, limit int) ([]Event, int, error) {
	return s.loadEventsFromIndex(globalIndexKey(teamID), offset, limit)
}

// GetEventsByChannel returns events for a specific channel merged with team-wide events.
func (s *EventStore) GetEventsByChannel(teamID, channelID string, offset, limit int) ([]Event, int, error) {
	if offset < 0 {
		return nil, 0, fmt.Errorf("offset must be non-negative")
	}

	// Load channel-specific index
	chData, appErr := s.api.KVGet(channelIndexKey(teamID, channelID))
	if appErr != nil {
		return nil, 0, fmt.Errorf("failed to get channel index: %w", appErr)
	}
	var chIDs []string
	if chData != nil {
		if err := json.Unmarshal(chData, &chIDs); err != nil {
			chIDs = nil
		}
	}

	// Load global (team-wide) index
	glData, appErr := s.api.KVGet(globalIndexKey(teamID))
	if appErr != nil {
		return nil, 0, fmt.Errorf("failed to get global index: %w", appErr)
	}
	var glIDs []string
	if glData != nil {
		if err := json.Unmarshal(glData, &glIDs); err != nil {
			glIDs = nil
		}
	}

	// Deduplicate IDs from both indexes
	seen := make(map[string]bool, len(chIDs)+len(glIDs))
	allIDs := make([]string, 0, len(chIDs)+len(glIDs))
	for _, id := range chIDs {
		if !seen[id] {
			allIDs = append(allIDs, id)
			seen[id] = true
		}
	}
	for _, id := range glIDs {
		if !seen[id] {
			allIDs = append(allIDs, id)
			seen[id] = true
		}
	}

	// Load ALL events to get timestamps for correct sorting
	type eventWithTS struct {
		event Event
		ts    int64
	}
	var loaded []eventWithTS
	for _, id := range allIDs {
		eventData, appErr := s.api.KVGet(eventKey(id))
		if appErr != nil || eventData == nil {
			continue
		}
		var ev Event
		if err := json.Unmarshal(eventData, &ev); err != nil {
			continue
		}
		loaded = append(loaded, eventWithTS{event: ev, ts: ev.Timestamp})
	}

	// Sort by timestamp descending (newest first)
	sort.Slice(loaded, func(i, j int) bool {
		return loaded[i].ts > loaded[j].ts
	})

	// total reflects only successfully loaded events (skipped events excluded)
	total := len(loaded)

	// Apply pagination AFTER sorting
	if offset >= total {
		return []Event{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}

	events := make([]Event, 0, end-offset)
	for _, l := range loaded[offset:end] {
		events = append(events, l.event)
	}

	return events, total, nil
}

const maxReactionRetries = 3

// AddReaction adds a user's reaction to an event using KVCompareAndSet for concurrency safety.
func (s *EventStore) AddReaction(eventID, icon, userID string) (*Event, error) {
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

		if event.Reactions == nil {
			event.Reactions = make(EventReactions)
		}

		summary := event.Reactions[icon]
		// Check if already reacted
		for _, uid := range summary.UserIDs {
			if uid == userID {
				return &event, nil // already reacted, no-op
			}
		}
		summary.UserIDs = append(summary.UserIDs, userID)
		summary.Count = len(summary.UserIDs)
		event.Reactions[icon] = summary

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
	return nil, fmt.Errorf("failed to add reaction after %d retries (conflict)", maxReactionRetries)
}

// RemoveReaction removes a user's reaction from an event using KVCompareAndSet.
func (s *EventStore) RemoveReaction(eventID, icon, userID string) (*Event, error) {
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

		if event.Reactions == nil {
			return &event, nil // no reactions, nothing to remove
		}

		summary, exists := event.Reactions[icon]
		if !exists {
			return &event, nil
		}

		filtered := make([]string, 0, len(summary.UserIDs))
		for _, uid := range summary.UserIDs {
			if uid != userID {
				filtered = append(filtered, uid)
			}
		}

		if len(filtered) == len(summary.UserIDs) {
			return &event, nil // user hadn't reacted, no-op
		}

		if len(filtered) == 0 {
			delete(event.Reactions, icon)
		} else {
			summary.UserIDs = filtered
			summary.Count = len(filtered)
			event.Reactions[icon] = summary
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
	}
	return nil, fmt.Errorf("failed to remove reaction after %d retries (conflict)", maxReactionRetries)
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
