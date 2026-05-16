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
