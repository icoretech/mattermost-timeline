import type { GlobalState } from "@mattermost/types/store";

import manifest from "./manifest";
import type { EventFeedState } from "./types";

// Returns undefined before the plugin reducer is registered.
export function getPluginState(state: GlobalState): EventFeedState | undefined {
  return (state as GlobalState & Record<string, EventFeedState>)[
    `plugins-${manifest.id}`
  ];
}

// Returns empty string when no team is selected; callers use truthiness to guard.
export function getCurrentTeamId(state: GlobalState): string {
  return state.entities.teams.currentTeamId || "";
}

export function getCurrentChannelId(state: GlobalState): string {
  return state.entities.channels.currentChannelId || "";
}
