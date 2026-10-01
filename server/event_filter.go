package main

import "strings"

type EventFilterOptions struct {
	Query       string
	EventType   string
	Source      string
	Severity    string
	Status      string
	Environment string
	Pinned      *bool
	Active      *bool
	Unread      *bool
	Now         int64
}

func eventMatchesFilters(event Event, filters EventFilterOptions, unreadIDs map[string]struct{}) bool {
	if filters.Query != "" && !eventMatchesQuery(event, filters.Query) {
		return false
	}
	if !matchOptionalStringFilter(event.EventType, filters.EventType) {
		return false
	}
	if !matchOptionalStringFilter(event.Source, filters.Source) {
		return false
	}
	if !matchOptionalStringFilter(event.Severity, filters.Severity) {
		return false
	}
	if !matchOptionalStringFilter(event.Status, filters.Status) {
		return false
	}
	if !matchOptionalStringFilter(event.Environment, filters.Environment) {
		return false
	}
	if filters.Pinned != nil && event.Pinned != *filters.Pinned {
		return false
	}
	if filters.Active != nil && eventIsActive(event, filters.Now) != *filters.Active {
		return false
	}
	if filters.Unread != nil {
		_, unread := unreadIDs[event.ID]
		if unread != *filters.Unread {
			return false
		}
	}
	return true
}

func eventMatchesQuery(event Event, query string) bool {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return true
	}
	fields := []string{
		event.Title,
		event.Message,
		event.Source,
		event.ExternalID,
		event.EventType,
		event.Environment,
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), needle) {
			return true
		}
	}
	for _, link := range event.Links {
		if strings.Contains(strings.ToLower(link.Label), needle) || strings.Contains(strings.ToLower(link.URL), needle) {
			return true
		}
	}
	return false
}

func matchOptionalStringFilter(value, filter string) bool {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(value), filter)
}

func eventIsExpired(event Event, now int64) bool {
	return event.ExpiresAt > 0 && event.ExpiresAt <= now
}

func eventIsTerminalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success", "failed", "resolved":
		return true
	default:
		return false
	}
}

func eventIsActive(event Event, now int64) bool {
	if event.Pinned {
		return true
	}
	if eventIsExpired(event, now) || eventIsTerminalStatus(event.Status) {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(event.Status))
	return status == "open" || status == "running" || strings.EqualFold(event.Severity, "critical")
}

func filterEvents(events []Event, filters EventFilterOptions, unreadIDs map[string]struct{}) []Event {
	filtered := make([]Event, 0, len(events))
	for _, event := range events {
		if eventMatchesFilters(event, filters, unreadIDs) {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func hasEventFilters(filters EventFilterOptions) bool {
	return strings.TrimSpace(filters.Query) != "" ||
		strings.TrimSpace(filters.EventType) != "" ||
		strings.TrimSpace(filters.Source) != "" ||
		strings.TrimSpace(filters.Severity) != "" ||
		strings.TrimSpace(filters.Status) != "" ||
		strings.TrimSpace(filters.Environment) != "" ||
		filters.Pinned != nil ||
		filters.Active != nil ||
		filters.Unread != nil
}

func boolPtr(value bool) *bool {
	return &value
}
