import { combineReducers } from "redux";
import type { EventFeedAction } from "./actions";
import {
  CLEAR_NEW_EVENT_FLAG,
  CLEAR_UPDATED_EVENT_FLAG,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  RECEIVED_UPDATED_EVENT,
  SET_ERROR,
  SET_LOADING,
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
    default:
      return state;
  }
}

function isLoading(state = false, action: EventFeedAction): boolean {
  switch (action.type) {
    case SET_LOADING:
      return action.loading ?? false;
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
});
