import { combineReducers } from "redux";
import type { EventFeedAction } from "./actions";
import {
  CLEAR_EVENTS,
  CLEAR_NEW_EVENT_FLAG,
  CLEAR_UPDATED_EVENT_FLAG,
  HYDRATE_POPOUT_STATE,
  OPTIMISTIC_REACTION,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  RECEIVED_REACTION_UPDATED,
  RECEIVED_UPDATED_EVENT,
  SET_CURRENT_USER_ID,
  SET_ERROR,
  SET_LOADING,
  SET_VIEW_CONTEXT,
} from "./actions";
import type { EventEntry } from "./types";

function events(
  state: EventEntry[] = [],
  action: EventFeedAction,
): EventEntry[] {
  switch (action.type) {
    case RECEIVED_EVENTS:
      if (action.append) {
        return [...state, ...(action.events ?? [])];
      }
      return action.events ?? [];
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.events ?? state;
    case RECEIVED_NEW_EVENT:
      if (!action.event || state.some((e) => e.id === action.event?.id)) {
        return state;
      }
      return [action.event, ...state];
    case RECEIVED_UPDATED_EVENT: {
      if (!action.event) return state;
      const updated = action.event;
      // Replace the event in place, then move to front (newest)
      const filtered = state.filter((e) => e.id !== updated.id);
      return [updated, ...filtered];
    }
    case RECEIVED_REACTION_UPDATED: {
      const { event_id, icon, count, user_ids } = action;
      return state.map((ev) => {
        if (ev.id !== event_id || !icon) return ev;
        const reactions = { ...(ev.client_reactions || {}) };
        const reactionUserIds = user_ids ?? [];
        const reactionCount = count ?? 0;
        if (reactionCount === 0) {
          delete reactions[icon];
        } else {
          const recentCount = Math.min(reactionUserIds.length, 3);
          reactions[icon] = {
            count: reactionCount,
            self: reactionUserIds.includes(action.currentUserId ?? ""),
            recent_users: reactionUserIds.slice(-recentCount),
          };
        }
        return {
          ...ev,
          client_reactions:
            Object.keys(reactions).length > 0 ? reactions : undefined,
        };
      });
    }
    case OPTIMISTIC_REACTION: {
      const { event_id, icon, optimisticAction } = action;
      return state.map((ev) => {
        if (ev.id !== event_id || !icon) return ev;
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
      return action.loading ?? false;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.isLoading ?? state;
    default:
      return state;
  }
}

function total(state = 0, action: EventFeedAction): number {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.total ?? 0;
    case RECEIVED_NEW_EVENT:
      return state + 1;
    case CLEAR_EVENTS:
      return 0;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.total ?? state;
    default:
      return state;
  }
}

function newEventIds(state: string[] = [], action: EventFeedAction): string[] {
  switch (action.type) {
    case RECEIVED_NEW_EVENT:
      return action.event ? [...state, action.event.id] : state;
    case CLEAR_NEW_EVENT_FLAG:
      return action.eventId
        ? state.filter((id) => id !== action.eventId)
        : state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.newEventIds ?? state;
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
      return action.event ? [...state, action.event.id] : state;
    case CLEAR_UPDATED_EVENT_FLAG:
      return action.eventId
        ? state.filter((id) => id !== action.eventId)
        : state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.updatedEventIds ?? state;
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
      return action.error ?? null;
    case RECEIVED_EVENTS:
      return null;
    case CLEAR_EVENTS:
      return null;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.error ?? state;
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
      return action.hydratedState?.timelineOrder ?? state;
    default:
      return state;
  }
}

function enableReactions(state = true, action: EventFeedAction): boolean {
  switch (action.type) {
    case RECEIVED_EVENTS:
      return action.enableReactions ?? state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.enableReactions ?? state;
    default:
      return state;
  }
}

function currentUserId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case SET_CURRENT_USER_ID:
      return action.currentUserId ?? state;
    case HYDRATE_POPOUT_STATE:
      return action.hydratedState?.currentUserId ?? state;
    default:
      return state;
  }
}

function viewTeamId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case RECEIVED_EVENTS:
    case SET_VIEW_CONTEXT:
    case HYDRATE_POPOUT_STATE:
      return action.teamId ?? state;
    case CLEAR_EVENTS:
      return "";
    default:
      return state;
  }
}

function viewChannelId(state = "", action: EventFeedAction): string {
  switch (action.type) {
    case RECEIVED_EVENTS:
    case SET_VIEW_CONTEXT:
    case HYDRATE_POPOUT_STATE:
      return action.channelId ?? state;
    case CLEAR_EVENTS:
      return "";
    default:
      return state;
  }
}

export default combineReducers({
  events,
  isLoading,
  error,
  total,
  newEventIds,
  updatedEventIds,
  timelineOrder,
  enableReactions,
  currentUserId,
  viewTeamId,
  viewChannelId,
});
