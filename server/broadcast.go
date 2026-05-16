package main

import (
	"encoding/json"

	"github.com/mattermost/mattermost/server/public/model"
)

type reactionUpdatedPayload struct {
	EventID string   `json:"event_id"`
	Icon    string   `json:"icon"`
	Count   int      `json:"count"`
	UserIDs []string `json:"user_ids"`
}

func (p *Plugin) publishTimelineEvent(eventName string, event Event, eventJSON []byte) {
	p.publishToEventAudience(eventName, event, map[string]interface{}{
		"event": string(eventJSON),
	})
}

func (p *Plugin) publishToEventAudience(eventName string, event Event, payload map[string]interface{}) {
	if len(event.Channels) > 0 {
		for _, chID := range event.Channels {
			p.API.PublishWebSocketEvent(eventName, payload, &model.WebsocketBroadcast{
				ChannelId: chID,
			})
		}
		return
	}

	p.API.PublishWebSocketEvent(eventName, payload, &model.WebsocketBroadcast{
		TeamId: event.TeamID,
	})
}

func (p *Plugin) publishReactionUpdate(updated *Event, eventID, icon string, count int, userIDs []string) {
	reactionJSON, _ := json.Marshal(reactionUpdatedPayload{
		EventID: eventID,
		Icon:    icon,
		Count:   count,
		UserIDs: userIDs,
	})

	p.publishToEventAudience("reaction_updated", *updated, map[string]interface{}{
		"payload": string(reactionJSON),
	})
}
