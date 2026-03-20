package main

// EventLink represents a labeled link attached to an event.
type EventLink struct {
	URL   string `json:"url"`
	Label string `json:"label,omitempty"`
}

// ReactionSummary stores the full reaction data in KV.
type ReactionSummary struct {
	Count   int      `json:"count"`
	UserIDs []string `json:"user_ids"`
}

// EventReactions maps icon names to their reaction summaries.
type EventReactions map[string]ReactionSummary

// ReactionClientSummary is the lightweight wire format sent to clients.
type ReactionClientSummary struct {
	Count       int      `json:"count"`
	Self        bool     `json:"self"`
	RecentUsers []string `json:"recent_users"`
}

// AllowedReactions is the set of valid reaction icon names.
var AllowedReactions = map[string]bool{
	"eyes": true, "wrench": true, "check": true, "megaphone": true,
	"thumbs-up": true, "hand": true, "party": true, "heart": true,
}

// Event represents a single event in the timeline.
type Event struct {
	ID              string                          `json:"id"`
	TeamID          string                          `json:"team_id"`
	Timestamp       int64                           `json:"timestamp"`
	Title           string                          `json:"title"`
	Message         string                          `json:"message,omitempty"`
	Link            string                          `json:"link,omitempty"`
	Links           []EventLink                     `json:"links,omitempty"`
	EventType       string                          `json:"event_type"`
	Source          string                          `json:"source,omitempty"`
	ExternalID      string                          `json:"external_id,omitempty"`
	Reactions       EventReactions                  `json:"reactions,omitempty"`
	Channels        []string                        `json:"channels,omitempty"`
	ClientReactions map[string]ReactionClientSummary `json:"client_reactions,omitempty"`
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
	Channels   []string    `json:"channels,omitempty"`
}

// EventsResponse is returned by the GET /api/v1/events endpoint.
type EventsResponse struct {
	Events          []Event `json:"events"`
	Total           int     `json:"total"`
	TimelineOrder   string  `json:"timeline_order"`
	EnableReactions bool    `json:"enable_reactions"`
}

// ToClientSummaries converts full reaction data to lightweight client format.
func (r EventReactions) ToClientSummaries(currentUserID string) map[string]ReactionClientSummary {
	if len(r) == 0 {
		return nil
	}
	result := make(map[string]ReactionClientSummary, len(r))
	for icon, summary := range r {
		isSelf := false
		for _, uid := range summary.UserIDs {
			if uid == currentUserID {
				isSelf = true
				break
			}
		}
		recentCount := 3
		if len(summary.UserIDs) < recentCount {
			recentCount = len(summary.UserIDs)
		}
		recent := make([]string, recentCount)
		copy(recent, summary.UserIDs[len(summary.UserIDs)-recentCount:])
		result[icon] = ReactionClientSummary{
			Count:       summary.Count,
			Self:        isSelf,
			RecentUsers: recent,
		}
	}
	return result
}
