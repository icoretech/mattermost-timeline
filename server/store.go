package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	eventKeyPrefix     = "event:"
	indexKeyPrefix     = "event_index:"
	extIDKeyPrefix     = "ext_id:"
	readStateKeyPrefix = "read_state:"
)

const maxIndexMutationRetries = 3

const readStateCurrentVersion = 1

const globalReadContextKey = "_global"

type TimelineReadState struct {
	Version       int              `json:"version"`
	ContextReadAt map[string]int64 `json:"context_read_at,omitempty"`
	SeenEvents    map[string]int64 `json:"seen_events,omitempty"`
}

var errExternalIDAlreadyExists = errors.New("external ID mapping already exists")

// EventStore handles persistence of events using the plugin KV store.
// Events are stored per-team with an index+individual-key pattern.
type EventStore struct {
	api       plugin.API
	maxEvents atomic.Int64
}

func NewEventStore(api plugin.API, maxEvents int) *EventStore {
	store := &EventStore{api: api}
	store.SetMaxEvents(maxEvents)
	return store
}

// SetMaxEvents updates the maximum number of events stored per team.
func (s *EventStore) SetMaxEvents(n int) {
	s.maxEvents.Store(int64(n))
}

func (s *EventStore) maxEventsLimit() int {
	return int(s.maxEvents.Load())
}

func retentionIndexKey(teamID string) string {
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

func readStateKey(userID, teamID string) string {
	return readStateKeyPrefix + userID + ":" + teamID
}

func readStateContextKey(channelID string) string {
	if channelID == "" {
		return globalReadContextKey
	}
	return channelID
}

func emptyTimelineReadState() TimelineReadState {
	return TimelineReadState{
		Version:       readStateCurrentVersion,
		ContextReadAt: map[string]int64{},
		SeenEvents:    map[string]int64{},
	}
}

func normalizeTimelineReadState(state TimelineReadState) TimelineReadState {
	if state.Version == 0 {
		state.Version = readStateCurrentVersion
	}
	if state.ContextReadAt == nil {
		state.ContextReadAt = map[string]int64{}
	}
	if state.SeenEvents == nil {
		state.SeenEvents = map[string]int64{}
	}
	return state
}

func maxEventTimestamp(events []Event) int64 {
	var maxTimestamp int64
	for _, event := range events {
		if event.Timestamp > maxTimestamp {
			maxTimestamp = event.Timestamp
		}
	}
	return maxTimestamp
}

func (s *EventStore) GetReadState(userID, teamID string) (TimelineReadState, error) {
	data, appErr := s.api.KVGet(readStateKey(userID, teamID))
	if appErr != nil {
		return TimelineReadState{}, fmt.Errorf("failed to get read state: %w", appErr)
	}
	if data == nil {
		return emptyTimelineReadState(), nil
	}

	var state TimelineReadState
	if err := json.Unmarshal(data, &state); err != nil {
		return TimelineReadState{}, fmt.Errorf("failed to unmarshal read state: %w", err)
	}

	return normalizeTimelineReadState(state), nil
}

func (s *EventStore) mutateReadState(userID, teamID, operation string, mutate func(*TimelineReadState) bool) (TimelineReadState, error) {
	key := readStateKey(userID, teamID)
	for attempt := 0; attempt < maxIndexMutationRetries; attempt++ {
		data, appErr := s.api.KVGet(key)
		if appErr != nil {
			return TimelineReadState{}, fmt.Errorf("failed to %s: %w", operation, appErr)
		}

		state := emptyTimelineReadState()
		if data != nil {
			if err := json.Unmarshal(data, &state); err != nil {
				return TimelineReadState{}, fmt.Errorf("failed to unmarshal read state: %w", err)
			}
			state = normalizeTimelineReadState(state)
		}

		if !mutate(&state) {
			return state, nil
		}

		state.Version = readStateCurrentVersion
		nextData, err := json.Marshal(state)
		if err != nil {
			return TimelineReadState{}, fmt.Errorf("failed to %s: %w", operation, err)
		}

		ok, appErr := s.api.KVCompareAndSet(key, data, nextData)
		if appErr != nil {
			return TimelineReadState{}, fmt.Errorf("failed to %s: %w", operation, appErr)
		}
		if ok {
			return state, nil
		}
	}

	return TimelineReadState{}, fmt.Errorf("failed to %s after %d retries (conflict)", operation, maxIndexMutationRetries)
}

func (s *EventStore) GetUnreadEventsForContext(userID, teamID, channelID string, events []Event, baselineTimestamp int64) ([]Event, TimelineReadState, error) {
	contextKey := readStateContextKey(channelID)
	state, err := s.GetReadState(userID, teamID)
	if err != nil {
		return nil, TimelineReadState{}, err
	}

	if _, initialized := state.ContextReadAt[contextKey]; !initialized {
		initializedContext := false
		initializedState, err := s.mutateReadState(userID, teamID, "initialize read state", func(current *TimelineReadState) bool {
			initializedContext = false
			if _, ok := current.ContextReadAt[contextKey]; ok {
				return false
			}
			current.ContextReadAt[contextKey] = baselineTimestamp
			initializedContext = true
			return true
		})
		if err != nil {
			return nil, TimelineReadState{}, err
		}
		if initializedContext {
			return []Event{}, initializedState, nil
		}
		return unreadEventsForState(contextKey, initializedState, events), initializedState, nil
	}

	return unreadEventsForState(contextKey, state, events), state, nil
}

func unreadEventsForState(contextKey string, state TimelineReadState, events []Event) []Event {
	contextReadAt := state.ContextReadAt[contextKey]
	unreadEvents := make([]Event, 0, len(events))
	for _, event := range events {
		if event.Timestamp > contextReadAt && state.SeenEvents[event.ID] < event.Timestamp {
			unreadEvents = append(unreadEvents, event)
		}
	}
	return unreadEvents
}

func (s *EventStore) MarkEventsRead(userID, teamID, channelID string, events []Event) (TimelineReadState, error) {
	contextKey := readStateContextKey(channelID)
	return s.mutateReadState(userID, teamID, "mark events read", func(state *TimelineReadState) bool {
		if len(events) == 0 {
			return false
		}

		changed := false
		if _, ok := state.ContextReadAt[contextKey]; !ok {
			state.ContextReadAt[contextKey] = 0
			changed = true
		}

		for _, event := range events {
			if state.SeenEvents[event.ID] < event.Timestamp {
				state.SeenEvents[event.ID] = event.Timestamp
				changed = true
			}
		}

		return pruneSeenEvents(state, s.maxEventsLimit()) || changed
	})
}

type seenEventEntry struct {
	ID        string
	Timestamp int64
}

func pruneSeenEvents(state *TimelineReadState, maxEvents int) bool {
	basis := maxEvents
	if basis <= 0 {
		basis = 500
	}
	maxSeenEvents := basis * 2
	if len(state.SeenEvents) <= maxSeenEvents {
		return false
	}

	entries := make([]seenEventEntry, 0, len(state.SeenEvents))
	for id, timestamp := range state.SeenEvents {
		entries = append(entries, seenEventEntry{ID: id, Timestamp: timestamp})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Timestamp == entries[j].Timestamp {
			return entries[i].ID < entries[j].ID
		}
		return entries[i].Timestamp > entries[j].Timestamp
	})

	pruned := make(map[string]int64, maxSeenEvents)
	for _, entry := range entries[:maxSeenEvents] {
		pruned[entry.ID] = entry.Timestamp
	}
	state.SeenEvents = pruned
	return true
}

func (s *EventStore) loadEventsFromIndex(key string, offset, limit int) ([]Event, int, error) {
	if err := validatePagination(offset, limit); err != nil {
		return nil, 0, err
	}

	ids, err := s.loadIndexIDs(key, "index")
	if err != nil {
		return nil, 0, err
	}

	total := len(ids)
	pageIDs := paginateIDs(ids, total, offset, limit)

	loaded, err := s.loadEventsByID(pageIDs)
	if err != nil {
		return nil, 0, err
	}
	events := eventsFromLoaded(loaded)
	return events, total, nil
}

func (s *EventStore) loadEventByID(id string) (Event, error) {
	eventData, appErr := s.api.KVGet(eventKey(id))
	if appErr != nil {
		return Event{}, fmt.Errorf("failed to load event %s: %w", id, appErr)
	}
	if eventData == nil {
		return Event{}, fmt.Errorf("event not found: %s", id)
	}

	var event Event
	if err := json.Unmarshal(eventData, &event); err != nil {
		return Event{}, fmt.Errorf("failed to unmarshal event %s: %w", id, err)
	}

	return event, nil
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

	if err := s.syncEventScopeIndexes(teamID, oldChannels, event); err != nil {
		return err
	}
	if err := s.moveToFront(retentionIndexKey(teamID), event.ID); err != nil {
		return fmt.Errorf("failed to update index: %w", err)
	}

	return nil
}

// AddEvent stores a new event and updates its scope indexes plus retention index.
func (s *EventStore) AddEvent(teamID string, event Event) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	mappingCreated := false
	if event.ExternalID != "" {
		var err error
		mappingCreated, err = s.createExternalIDMapping(teamID, event.ExternalID, event.ID)
		if err != nil {
			return err
		}
	}

	if appErr := s.api.KVSet(eventKey(event.ID), eventJSON); appErr != nil {
		if mappingCreated {
			if deleteErr := s.api.KVDelete(extIDKey(teamID, event.ExternalID)); deleteErr != nil {
				s.api.LogWarn("Failed to clean external ID mapping after event store failure", "external_id", event.ExternalID, "error", deleteErr.Error())
			}
		}
		return fmt.Errorf("failed to store event: %w", appErr)
	}

	if err := s.addEventToScopeIndexes(teamID, event); err != nil {
		return err
	}

	pruneIDs, err := s.prependToTeamIndex(teamID, event.ID)
	if err != nil {
		return err
	}
	s.pruneEvents(teamID, pruneIDs)

	return nil
}

func (s *EventStore) createExternalIDMapping(teamID, externalID, eventID string) (bool, error) {
	ok, appErr := s.api.KVCompareAndSet(extIDKey(teamID, externalID), nil, []byte(eventID))
	if appErr != nil {
		return false, fmt.Errorf("failed to store external ID mapping: %w", appErr)
	}
	if !ok {
		return false, errExternalIDAlreadyExists
	}
	return true, nil
}

func (s *EventStore) scopeIndexKeys(teamID string, channels []string) []string {
	if len(channels) == 0 {
		return []string{globalIndexKey(teamID)}
	}

	keys := make([]string, 0, len(channels))
	for _, channelID := range channels {
		keys = append(keys, channelIndexKey(teamID, channelID))
	}
	return keys
}

func (s *EventStore) addEventToScopeIndexes(teamID string, event Event) error {
	for _, key := range s.scopeIndexKeys(teamID, event.Channels) {
		if err := s.prependUniqueToIndex(key, event.ID); err != nil {
			if len(event.Channels) == 0 {
				return fmt.Errorf("failed to update global index: %w", err)
			}
			return fmt.Errorf("failed to update channel index %s: %w", indexScopeLabel(key), err)
		}
	}
	return nil
}

func (s *EventStore) syncEventScopeIndexes(teamID string, oldChannels []string, event Event) error {
	oldKeys := s.scopeIndexKeys(teamID, oldChannels)
	newKeys := s.scopeIndexKeys(teamID, event.Channels)
	oldSet := stringSet(oldKeys)
	newSet := stringSet(newKeys)

	for _, key := range oldKeys {
		if !newSet[key] {
			if err := s.removeFromIndex(key, event.ID); err != nil {
				return fmt.Errorf("failed to remove event from %s: %w", indexScopeDescription(key), err)
			}
		}
	}

	for _, key := range newKeys {
		if !oldSet[key] {
			if err := s.prependUniqueToIndex(key, event.ID); err != nil {
				return fmt.Errorf("failed to add event to %s: %w", indexScopeDescription(key), err)
			}
		}
	}

	return nil
}

func stringSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func indexScopeLabel(key string) string {
	if strings.HasSuffix(key, ":"+globalChannelSuffix) {
		return "global"
	}
	parts := strings.Split(key, ":")
	return parts[len(parts)-1]
}

func indexScopeDescription(key string) string {
	if strings.HasSuffix(key, ":"+globalChannelSuffix) {
		return "global index"
	}
	return "channel index " + indexScopeLabel(key)
}

func (s *EventStore) mutateIndex(key string, resetOnCorruption bool, operation string, mutate func([]string) ([]string, bool)) error {
	for attempt := 0; attempt < maxIndexMutationRetries; attempt++ {
		data, appErr := s.api.KVGet(key)
		if appErr != nil {
			return fmt.Errorf("failed to get index %s: %w", key, appErr)
		}

		var ids []string
		if data != nil {
			if err := json.Unmarshal(data, &ids); err != nil {
				if !resetOnCorruption {
					s.api.LogWarn("Corrupted index, skipping removal", "key", key, "error", err.Error())
					return nil
				}
				s.api.LogWarn("Corrupted event index, resetting", "key", key, "error", err.Error())
				ids = nil
			}
		}

		nextIDs, changed := mutate(ids)
		if !changed {
			return nil
		}

		nextData, err := json.Marshal(nextIDs)
		if err != nil {
			return fmt.Errorf("failed to marshal index: %w", err)
		}

		ok, appErr := s.api.KVCompareAndSet(key, data, nextData)
		if appErr != nil {
			return fmt.Errorf("failed to update index: %w", appErr)
		}
		if ok {
			return nil
		}
	}

	return fmt.Errorf("failed to %s after %d retries (conflict)", operation, maxIndexMutationRetries)
}

func (s *EventStore) prependUniqueToIndex(key, eventID string) error {
	return s.mutateIndex(key, true, "prepend event to index", func(ids []string) ([]string, bool) {
		return prependUnique(ids, eventID), true
	})
}

func (s *EventStore) moveToFront(key, eventID string) error {
	return s.prependUniqueToIndex(key, eventID)
}

func (s *EventStore) prependToTeamIndex(teamID, eventID string) ([]string, error) {
	var pruneIDs []string
	if err := s.mutateIndex(retentionIndexKey(teamID), true, "prepend event to retention index", func(ids []string) ([]string, bool) {
		ids = prependUnique(ids, eventID)
		pruneIDs = nil
		maxEvents := s.maxEventsLimit()
		if len(ids) > maxEvents {
			pruneIDs = ids[maxEvents:]
			ids = ids[:maxEvents]
		}
		return ids, true
	}); err != nil {
		return nil, fmt.Errorf("failed to get index: %w", err)
	}
	return pruneIDs, nil
}

func prependUnique(ids []string, eventID string) []string {
	filtered := make([]string, 0, len(ids)+1)
	filtered = append(filtered, eventID)
	for _, id := range ids {
		if id != eventID {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

// removeFromIndex removes an event ID from an index array.
func (s *EventStore) removeFromIndex(key, eventID string) error {
	return s.mutateIndex(key, false, "remove event from index", func(ids []string) ([]string, bool) {
		if ids == nil {
			return nil, false
		}
		filtered := removeID(ids, eventID)
		return filtered, len(filtered) != len(ids)
	})
}

func removeID(ids []string, eventID string) []string {
	filtered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != eventID {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

func (s *EventStore) pruneEvents(teamID string, pruneIDs []string) {
	for _, id := range pruneIDs {
		pruneEvent, err := s.GetEvent(id)
		if err != nil {
			s.api.LogWarn("Failed to read event during prune", "event_id", id, "error", err.Error())
		} else if pruneEvent != nil {
			if err := s.removeEventFromScopeIndexes(teamID, *pruneEvent); err != nil {
				s.api.LogWarn("Failed to clean scope index during prune", "event_id", id, "error", err.Error())
			}
		}
		if appErr := s.api.KVDelete(eventKey(id)); appErr != nil {
			s.api.LogWarn("Failed to prune event", "event_id", id, "error", appErr.Error())
		}
	}
}

func (s *EventStore) removeEventFromScopeIndexes(teamID string, event Event) error {
	for _, key := range s.scopeIndexKeys(teamID, event.Channels) {
		if err := s.removeFromIndex(key, event.ID); err != nil {
			return err
		}
	}
	return nil
}
