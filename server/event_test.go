package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type reactionContractEntry struct {
	Icon  string `json:"icon"`
	Label string `json:"label"`
}

func TestEventReactionsToClientSummariesEmptyMap(t *testing.T) {
	result := EventReactions(nil).ToClientSummaries("user1")

	assert.NotNil(t, result)
	assert.Empty(t, result)
}

func TestClientEventFromProjectsReactionsWithoutRawUserIDs(t *testing.T) {
	event := Event{
		ID:        "evt-1",
		TeamID:    "team-1",
		Title:     "deploy",
		EventType: "deploy",
		Reactions: EventReactions{
			"eyes": ReactionSummary{
				Count:   2,
				UserIDs: []string{"user-1", "user-2"},
			},
		},
	}

	clientEvent := clientEventFrom(event, "user-2")
	assert.Equal(t, ReactionClientSummary{
		Count:       2,
		Self:        true,
		RecentUsers: []string{"user-1", "user-2"},
	}, clientEvent.ClientReactions["eyes"])

	data, err := json.Marshal(clientEvent)
	assert.NoError(t, err)
	assert.NotContains(t, string(data), `"reactions":`)
	assert.NotContains(t, string(data), "user_ids")
	assert.Contains(t, string(data), "client_reactions")
}

func TestClientEventFromProjectsMetadataAndOmitsRawReactionUsers(t *testing.T) {
	event := Event{
		ID:          "evt-1",
		TeamID:      "team-1",
		Title:       "incident",
		EventType:   "alert",
		Severity:    "critical",
		Status:      "open",
		Environment: "staging",
		ExpiresAt:   4102444800000,
		Pinned:      true,
		ResolvedAt:  12345,
		Reactions: EventReactions{
			"eyes": ReactionSummary{Count: 1, UserIDs: []string{"user-1"}},
		},
	}

	clientEvent := clientEventFrom(event, "user-1")
	assert.Equal(t, "critical", clientEvent.Severity)
	assert.Equal(t, "open", clientEvent.Status)
	assert.Equal(t, "staging", clientEvent.Environment)
	assert.Equal(t, int64(4102444800000), clientEvent.ExpiresAt)
	assert.True(t, clientEvent.Pinned)
	assert.Equal(t, int64(12345), clientEvent.ResolvedAt)

	data, err := json.Marshal(clientEvent)
	require.NoError(t, err)
	assert.NotContains(t, string(data), `"reactions":`)
	assert.NotContains(t, string(data), "user_ids")
	assert.Contains(t, string(data), `"severity":"critical"`)
}

func TestApplyWebhookUpdateMetadataRetainsOmittedAndAppliesExplicitChanges(t *testing.T) {
	existing := &Event{
		ID:          "evt-1",
		Timestamp:   100,
		Title:       "old",
		EventType:   "deploy",
		Severity:    "critical",
		Status:      "open",
		Environment: "prod",
		ExpiresAt:   1000,
		Pinned:      true,
		ResolvedAt:  500,
		Channels:    []string{"old-channel"},
	}

	oldChannels := applyWebhookUpdate(existing, WebhookPayload{Title: "new"}, "generic", nil)
	assert.Equal(t, []string{"old-channel"}, oldChannels)
	assert.Equal(t, "critical", existing.Severity)
	assert.Equal(t, "open", existing.Status)
	assert.Equal(t, "prod", existing.Environment)
	assert.Equal(t, int64(1000), existing.ExpiresAt)
	assert.True(t, existing.Pinned)
	assert.Equal(t, int64(500), existing.ResolvedAt)

	emptySeverity := ""
	resolvedStatus := "resolved"
	emptyEnvironment := ""
	zeroExpiresAt := int64(0)
	clearedPinned := false
	zeroResolvedAt := int64(0)
	applyWebhookUpdate(existing, WebhookPayload{
		Title:       "resolved",
		Severity:    &emptySeverity,
		Status:      &resolvedStatus,
		Environment: &emptyEnvironment,
		ExpiresAt:   &zeroExpiresAt,
		Pinned:      &clearedPinned,
		ResolvedAt:  &zeroResolvedAt,
	}, "generic", nil)

	assert.Empty(t, existing.Severity)
	assert.Equal(t, "resolved", existing.Status)
	assert.Empty(t, existing.Environment)
	assert.Zero(t, existing.ExpiresAt)
	assert.False(t, existing.Pinned)
	assert.Greater(t, existing.ResolvedAt, int64(0), "resolved status without a non-zero resolved_at stamps resolution time")

	runningStatus := "running"
	zeroResolvedAt = int64(0)
	applyWebhookUpdate(existing, WebhookPayload{Title: "running", Status: &runningStatus, ResolvedAt: &zeroResolvedAt}, "generic", nil)
	assert.Equal(t, "running", existing.Status)
	assert.Zero(t, existing.ResolvedAt)
}

func TestAllowedReactionIconsMatchFrontendContract(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "webapp", "src", "components", "reactions.json"))
	require.NoError(t, err)

	var contract []reactionContractEntry
	require.NoError(t, json.Unmarshal(data, &contract))

	contractIcons := make([]string, 0, len(contract))
	for _, reaction := range contract {
		contractIcons = append(contractIcons, reaction.Icon)
		assert.NotEmpty(t, reaction.Label)
		assert.True(t, isAllowedReaction(reaction.Icon), "contract icon %q must be accepted by the server", reaction.Icon)
	}

	assert.ElementsMatch(t, allowedReactionIcons, contractIcons)
	assert.False(t, isAllowedReaction("unknown"))
}
