package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
)

func (p *Plugin) handleAddReaction(w http.ResponseWriter, r *http.Request) {
	req, ok := p.prepareReactionRequest(w, r)
	if !ok {
		return
	}

	updated, err := p.store.AddReaction(req.eventID, req.icon, req.userID)
	if err != nil {
		p.API.LogError("Failed to add reaction", "error", err.Error())
		http.Error(w, "Failed to add reaction", http.StatusInternalServerError)
		return
	}

	summary := updated.Reactions[req.icon]
	p.publishReactionUpdate(updated, req.eventID, req.icon, summary.Count, summary.UserIDs)

	clientReactions := updated.Reactions.ToClientSummaries(req.userID)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(clientReactions); err != nil {
		p.API.LogError("Failed to encode reactions response", "error", err.Error())
	}
}

func (p *Plugin) handleRemoveReaction(w http.ResponseWriter, r *http.Request) {
	req, ok := p.prepareReactionRequest(w, r)
	if !ok {
		return
	}

	updated, err := p.store.RemoveReaction(req.eventID, req.icon, req.userID)
	if err != nil {
		p.API.LogError("Failed to remove reaction", "error", err.Error())
		http.Error(w, "Failed to remove reaction", http.StatusInternalServerError)
		return
	}

	var broadcastUserIDs []string
	count := 0
	if summary, ok := updated.Reactions[req.icon]; ok {
		broadcastUserIDs = summary.UserIDs
		count = summary.Count
	}
	p.publishReactionUpdate(updated, req.eventID, req.icon, count, broadcastUserIDs)

	clientReactions := updated.Reactions.ToClientSummaries(req.userID)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(clientReactions); err != nil {
		p.API.LogError("Failed to encode reactions response", "error", err.Error())
	}
}

func (p *Plugin) handleGetReactionUsers(w http.ResponseWriter, r *http.Request) {
	req, ok := p.prepareReactionRequest(w, r)
	if !ok {
		return
	}

	userIDs, err := p.store.GetReactionUsers(req.eventID, req.icon)
	if err != nil {
		http.Error(w, "Failed to get reaction users", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"user_ids": userIDs,
	}); err != nil {
		p.API.LogError("Failed to encode reaction users response", "error", err.Error())
	}
}

type reactionRequest struct {
	eventID string
	icon    string
	userID  string
}

func (p *Plugin) prepareReactionRequest(w http.ResponseWriter, r *http.Request) (reactionRequest, bool) {
	config := p.getConfiguration()
	if !config.enableReactions() {
		http.Error(w, "Reactions are disabled", http.StatusForbidden)
		return reactionRequest{}, false
	}

	vars := mux.Vars(r)
	eventID := vars["eventId"]
	icon := vars["icon"]

	if !isAllowedReaction(icon) {
		http.Error(w, "Invalid reaction icon", http.StatusBadRequest)
		return reactionRequest{}, false
	}

	userID := r.Header.Get("Mattermost-User-ID")

	if !p.authorizeReactionEventAccess(w, eventID, userID) {
		return reactionRequest{}, false
	}

	return reactionRequest{eventID: eventID, icon: icon, userID: userID}, true
}

func (p *Plugin) authorizeReactionEventAccess(w http.ResponseWriter, eventID, userID string) bool {
	event, err := p.store.GetEvent(eventID)
	if err != nil {
		p.API.LogError("Failed to get event for reaction", "event_id", eventID, "error", err.Error())
		http.Error(w, "Failed to get event", http.StatusInternalServerError)
		return false
	}
	if event == nil {
		http.Error(w, "Event not found", http.StatusNotFound)
		return false
	}

	if ok, message := p.canUserAccessEvent(userID, *event); !ok {
		http.Error(w, message, http.StatusForbidden)
		return false
	}

	return true
}

func (p *Plugin) canUserAccessEvent(userID string, event Event) (bool, string) {
	if _, appErr := p.API.GetTeamMember(event.TeamID, userID); appErr != nil {
		return false, "Not a member of this team"
	}

	if len(event.Channels) == 0 {
		return true, ""
	}

	for _, chID := range event.Channels {
		if _, appErr := p.API.GetChannelMember(chID, userID); appErr == nil {
			return true, ""
		}
	}

	return false, "Not a member of the event's channel"
}
