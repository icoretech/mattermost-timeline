package main

// EventLink represents a labeled link attached to an event.
type EventLink struct {
	URL   string `json:"url"`
	Label string `json:"label,omitempty"`
}

// Event represents a single event in the timeline.
type Event struct {
	ID         string      `json:"id"`
	TeamID     string      `json:"team_id"`
	Timestamp  int64       `json:"timestamp"`
	Title      string      `json:"title"`
	Message    string      `json:"message,omitempty"`
	Link       string      `json:"link,omitempty"`
	Links      []EventLink `json:"links,omitempty"`
	EventType  string      `json:"event_type"`
	Source     string      `json:"source,omitempty"`
	ExternalID string      `json:"external_id,omitempty"`
}

// WebhookPayload is the expected JSON body from external services.
type WebhookPayload struct {
	Title      string      `json:"title"`
	Message    string      `json:"message,omitempty"`
	Link       string      `json:"link,omitempty"`
	Links      []EventLink `json:"links,omitempty"`
	EventType  string      `json:"event_type"`
	Source     string      `json:"source,omitempty"`
	TeamID     string      `json:"team_id,omitempty"`
	ExternalID string      `json:"external_id,omitempty"`
}

// EventsResponse is returned by the GET /api/v1/events endpoint.
type EventsResponse struct {
	Events        []Event `json:"events"`
	Total         int     `json:"total"`
	TimelineOrder string  `json:"timeline_order"`
}
