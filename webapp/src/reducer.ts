import { combineReducers } from "redux";
import type { EventFeedAction } from "./actions";
import {
  CLEAR_EVENTS,
  CLEAR_NEW_EVENT_FLAG,
  CLEAR_UPDATED_EVENT_FLAG,
  HYDRATE_POPOUT_STATE,
  MARK_EVENTS_READ,
  OPTIMISTIC_REACTION,
  RECEIVED_CONTEXT_UNREAD_EVENTS,
  RECEIVED_EVENT_REACTIONS,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  RECEIVED_REACTION_UPDATED,
  RECEIVED_UNREAD_EVENTS,
  RECEIVED_UPDATED_EVENT,
  SET_CURRENT_USER_ID,
  SET_ERROR,
  SET_LOADING,
  SET_VIEW_CONTEXT,
} from "./actions";
import { getTimelineContextKey } from "./selectors";
import type { EventEntry, TimelineUnreadState } from "./types/timeline";

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function eventContextKeys(event: EventEntry): string[] {
  if (!event.channels || event.channels.length === 0) {
    return [getTimelineContextKey(event.team_id, "")];
  }

  return event.channels.map((channelId) =>
    getTimelineContextKey(event.team_id, channelId),
  );
}

function removeIdsForTeam(
  state: TimelineUnreadState,
  teamId: string,
  eventIds: string[],
): TimelineUnreadState {
  if (eventIds.length === 0) {
    return state;
  }

  const idsToRemove = new Set(eventIds);
  const teamPrefix = `${teamId}:`;
  let changed = false;
  const nextState: TimelineUnreadState = { ...state };

  for (const [contextKey, ids] of Object.entries(state)) {
    if (!contextKey.startsWith(teamPrefix)) {
      continue;
    }
    const filtered = ids.filter((id) => !idsToRemove.has(id));
    if (filtered.length !== ids.length) {
      changed = true;
      nextState[contextKey] = filtered;
    }
  }

  return changed ? nextState : state;
}

function reconcileUnreadContext(
  state: TimelineUnreadState,
  teamId: string,
  channelId: string,
  visibleEventIds: string[],
  unreadEventIds: string[],
): TimelineUnreadState {
  return {
    ...removeIdsForTeam(state, teamId, visibleEventIds),
    [getTimelineContextKey(teamId, channelId)]: dedupeIds(unreadEventIds),
  };
}

function events(
  state: EventEntry[] = [],
  action: EventFeedAction,
): EventEntry[] {
  switch (action.type) {
    case RECEIVED_EVENTS:
      if (action.append) {
        return [...state, ...action.events];
      }
      return action.events;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.events;
    case RECEIVED_NEW_EVENT:
      return [action.event, ...state];
    case RECEIVED_UPDATED_EVENT: {
      const existing = state.find((e) => e.id === action.event.id);
      const updated = {
        ...action.event,
        client_reactions:
          action.event.client_reactions ?? existing?.client_reactions,
      };
      const filtered = state.filter((e) => e.id !== updated.id);
      return [updated, ...filtered];
    }
    case RECEIVED_REACTION_UPDATED: {
      const { eventId, icon, count, userIds } = action;
      return state.map((ev) => {
        if (ev.id !== eventId || !icon) return ev;
        const reactions = { ...(ev.client_reactions || {}) };
        if (count === 0) {
          delete reactions[icon];
        } else {
          const recentCount = Math.min(userIds.length, 3);
          reactions[icon] = {
            count,
            self: userIds.includes(action.currentUserId ?? ""),
            recent_users: userIds.slice(-recentCount),
          };
        }
        return {
          ...ev,
          client_reactions:
            Object.keys(reactions).length > 0 ? reactions : undefined,
        };
      });
    }
    case RECEIVED_EVENT_REACTIONS: {
      return state.map((ev) => {
        if (ev.id !== action.eventId) return ev;
        return {
          ...ev,
          client_reactions:
            Object.keys(action.reactions).length > 0
              ? action.reactions
              : undefined,
        };
      });
    }
    case OPTIMISTIC_REACTION: {
      const { eventId, icon, optimisticAction } = action;
      return state.map((ev) => {
        if (ev.id !== eventId || !icon) return ev;
        const reactions = { ...(ev.client_reactions || {}) };
        const existing = reactions[icon] || {
          count: 0,
          self: false,
          recent_users: [],
        };
        if (optimisticAction === "add") {
          reactions[icon] = {
            ...existing,
            count: existing.count + 1,
            self: true,
          };
        } else if (optimisticAction === "remove") {
          const newCount = Math.max(0, existing.count - 1);
          if (newCount === 0) {
            delete reactions[icon];
          } else {
            reactions[icon] = {
              ...existing,
              count: newCount,
              self: false,
            };
          }
        }
        return {
          ...ev,
          client_reactions:
            Object.keys(reactions).length > 0 ? reactions : undefined,
        };
      });
    }
    case CLEAR_EVENTS:
      return [];
    default:
      return state;
  }
}

function isLoading(state = false, action: EventFeedAction): boolean {
  switch (action.type) {
    case SET_LOADING:
      return action.loading;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.isLoading;
    default:
      return state;
  }
}

function total(state = 0, action: EventFeedAction): number {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.total;
    case RECEIVED_NEW_EVENT:
      return state + 1;
    case CLEAR_EVENTS:
      return 0;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.total;
    default:
      return state;
  }
}

function newEventIds(state: string[] = [], action: EventFeedAction): string[] {
  switch (action.type) {
    case RECEIVED_NEW_EVENT:
      return [...state, action.event.id];
    case CLEAR_NEW_EVENT_FLAG:
      return action.eventId
        ? state.filter((id) => id !== action.eventId)
        : state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.newEventIds;
    default:
      return state;
  }
}

function updatedEventIds(
  state: string[] = [],
  action: EventFeedAction,
): string[] {
  switch (action.type) {
    case RECEIVED_UPDATED_EVENT:
      return [...state, action.event.id];
    case CLEAR_UPDATED_EVENT_FLAG:
      return action.eventId
        ? state.filter((id) => id !== action.eventId)
        : state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.updatedEventIds;
    default:
      return state;
  }
}

function unreadEventIdsByContext(
  state: TimelineUnreadState = {},
  action: EventFeedAction,
): TimelineUnreadState {
  switch (action.type) {
    case RECEIVED_EVENTS:
      if (!action.teamId) {
        return state;
      }
      return reconcileUnreadContext(
        state,
        action.teamId,
        action.channelId || "",
        action.events.map((event) => event.id),
        action.unreadEventIds || [],
      );
    case RECEIVED_CONTEXT_UNREAD_EVENTS:
      return reconcileUnreadContext(
        state,
        action.teamId,
        action.channelId,
        action.visibleEventIds,
        action.unreadEventIds,
      );
    case RECEIVED_UNREAD_EVENTS: {
      const nextState: TimelineUnreadState = { ...state };
      for (const event of action.events) {
        for (const contextKey of eventContextKeys(event)) {
          nextState[contextKey] = dedupeIds([
            ...(nextState[contextKey] || []),
            event.id,
          ]);
        }
      }
      return nextState;
    }
    case MARK_EVENTS_READ:
      return removeIdsForTeam(state, action.teamId, action.eventIds);
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.unreadEventIdsByContext || {};
    default:
      return state;
  }
}

function error(
  state: string | null = null,
  action: EventFeedAction,
): string | null {
  switch (action.type) {
    case SET_ERROR:
      return action.error;
    case RECEIVED_EVENTS:
      return null;
    case CLEAR_EVENTS:
      return null;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.error;
    default:
      return state;
  }
}

function timelineOrder(
  state: "oldest_first" | "newest_first" = "oldest_first",
  action: EventFeedAction,
): "oldest_first" | "newest_first" {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return (action.timelineOrder as "oldest_first" | "newest_first") || state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.timelineOrder;
    default:
      return state;
  }
}

function enableReactions(state = true, action: EventFeedAction): boolean {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.enableReactions ?? state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.enableReactions;
    default:
      return state;
  }
}

function currentUserId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case SET_CURRENT_USER_ID:
      return action.currentUserId;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState.currentUserId;
    default:
      return state;
  }
}

function viewTeamId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.teamId ?? state;
    case HYDRATE_POPOUT_STATE:
    case SET_VIEW_CONTEXT:
      return action.teamId;
    case CLEAR_EVENTS:
      return "";
    default:
      return state;
  }
}

function viewChannelId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.channelId ?? state;
    case HYDRATE_POPOUT_STATE:
    case SET_VIEW_CONTEXT:
      return action.channelId;
    case CLEAR_EVENTS:
      return "";
    default:
      return state;
  }
}

const eventFeedReducer = combineReducers({
  events,
  isLoading,
  error,
  total,
  newEventIds,
  updatedEventIds,
  unreadEventIdsByContext,
  timelineOrder,
  enableReactions,
  currentUserId,
  viewTeamId,
  viewChannelId,
});

export default function reducer(
  state: ReturnType<typeof eventFeedReducer> | undefined,
  action: EventFeedAction,
): ReturnType<typeof eventFeedReducer> {
  if (action.type === RECEIVED_NEW_EVENT) {
    if (state?.events.some((event) => event.id === action.event.id)) {
      return state;
    }
  }

  return eventFeedReducer(state, action);
}
