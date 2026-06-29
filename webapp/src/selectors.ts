import type { GlobalState } from "@mattermost/types/store";
import type { UserProfile } from "@mattermost/types/users";
import { Preferences } from "mattermost-redux/constants";
import { getCurrentUserLocale } from "mattermost-redux/selectors/entities/i18n";
import { getBool } from "mattermost-redux/selectors/entities/preferences";
import { getUserCurrentTimezone } from "mattermost-redux/utils/timezone_utils";

import manifest from "./manifest";
import type { EventFeedState } from "./types/timeline";

const GLOBAL_TIMELINE_CONTEXT = "_global";
export type TimestampDisplayPreferences = {
  locale: string;
  timeZone: string;
  useMilitaryTime: boolean;
};

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function getTimelineContextKey(teamId: string, channelId = ""): string {
  return `${teamId}:${channelId || GLOBAL_TIMELINE_CONTEXT}`;
}

// Returns undefined before the plugin reducer is registered.
export function getPluginState(state: GlobalState): EventFeedState | undefined {
  return (state as GlobalState & Record<string, EventFeedState>)[
    `plugins-${manifest.id}`
  ];
}

// Returns empty string when no team is selected; callers use truthiness to guard.
export function getCurrentTeamId(state: GlobalState): string {
  return (
    state.entities.teams.currentTeamId ||
    getPluginState(state)?.viewTeamId ||
    ""
  );
}

export function getCurrentChannelId(state: GlobalState): string {
  return (
    state.entities.channels.currentChannelId ||
    getPluginState(state)?.viewChannelId ||
    ""
  );
}

export function getCurrentUserId(state: GlobalState): string {
  return (
    state.entities.users.currentUserId ||
    getPluginState(state)?.currentUserId ||
    ""
  );
}
function getCurrentUserProfile(state: GlobalState): UserProfile | undefined {
  return state.entities.users.profiles?.[getCurrentUserId(state)];
}

function hasMyPreferences(state: GlobalState): boolean {
  return Boolean(
    (
      state as GlobalState & {
        entities: GlobalState["entities"] & {
          preferences?: GlobalState["entities"]["preferences"];
        };
      }
    ).entities.preferences?.myPreferences,
  );
}

export function getTimestampDisplayPreferences(
  state: GlobalState,
): TimestampDisplayPreferences {
  const currentUser = getCurrentUserProfile(state);

  return {
    locale: currentUser?.locale || getCurrentUserLocale(state),
    timeZone: getUserCurrentTimezone(currentUser?.timezone),
    useMilitaryTime: hasMyPreferences(state)
      ? getBool(
          state,
          Preferences.CATEGORY_DISPLAY_SETTINGS,
          Preferences.USE_MILITARY_TIME,
          false,
        )
      : false,
  };
}

export function getCurrentTimelineUnreadEventIds(state: GlobalState): string[] {
  const pluginState = getPluginState(state);
  if (!pluginState) {
    return [];
  }

  const currentTeamId = getCurrentTeamId(state);
  const currentChannelId = getCurrentChannelId(state);
  const currentContextKey = getTimelineContextKey(
    currentTeamId,
    currentChannelId,
  );
  const globalContextKey = getTimelineContextKey(currentTeamId, "");

  const currentContextIds =
    pluginState.unreadEventIdsByContext[currentContextKey] || [];
  const globalContextIds = currentChannelId
    ? pluginState.unreadEventIdsByContext[globalContextKey] || []
    : [];

  return dedupeIds([...currentContextIds, ...globalContextIds]);
}

export function getCurrentTimelineUnreadCount(state: GlobalState): number {
  return getCurrentTimelineUnreadEventIds(state).length;
}

export function getHasCurrentTimelineUnread(state: GlobalState): boolean {
  return getCurrentTimelineUnreadCount(state) > 0;
}
