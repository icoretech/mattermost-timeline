import type { Dispatch } from "redux";

import manifest from "./manifest";

import type {
  EventEntry,
  ReactionClientSummary,
  ReactionUpdatedWebSocketMessage,
} from "./types";

export const RECEIVED_EVENTS = `${manifest.id}_received_events`;
export const RECEIVED_NEW_EVENT = `${manifest.id}_received_new_event`;
export const RECEIVED_UPDATED_EVENT = `${manifest.id}_received_updated_event`;
export const CLEAR_NEW_EVENT_FLAG = `${manifest.id}_clear_new_event_flag`;
export const CLEAR_UPDATED_EVENT_FLAG = `${manifest.id}_clear_updated_event_flag`;
export const SET_LOADING = `${manifest.id}_set_loading`;
export const SET_ERROR = `${manifest.id}_set_error`;
export const RECEIVED_REACTION_UPDATED = `${manifest.id}_received_reaction_updated`;
export const OPTIMISTIC_REACTION = `${manifest.id}_optimistic_reaction`;
export const CLEAR_EVENTS = `${manifest.id}_clear_events`;
export const SET_CURRENT_USER_ID = `${manifest.id}_set_current_user_id`;

export interface EventFeedAction {
  type: string;
  events?: EventEntry[];
  total?: number;
  append?: boolean;
  event?: EventEntry;
  eventId?: string;
  loading?: boolean;
  error?: string | null;
  timelineOrder?: string;
  enableReactions?: boolean;
  currentUserId?: string;
  event_id?: string;
  icon?: string;
  count?: number;
  user_ids?: string[];
  optimisticAction?: "add" | "remove";
  [key: string]: unknown;
}

export type EventFeedDispatch = Dispatch<EventFeedAction>;
export type EventFeedThunk<TReturn = void> = (
  dispatch: EventFeedDispatch,
) => Promise<TReturn> | TReturn;

export function fetchEvents(
  teamId: string,
  offset = 0,
  limit = 50,
  channelId?: string,
): EventFeedThunk {
  return async (dispatch: EventFeedDispatch) => {
    dispatch({ type: SET_LOADING, loading: true });
    try {
      let url = `/plugins/${manifest.id}/api/v1/events?team_id=${encodeURIComponent(teamId)}&offset=${offset}&limit=${limit}`;
      if (channelId) {
        url += `&channel_id=${encodeURIComponent(channelId)}`;
      }
      const response = await fetch(url, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      dispatch({ type: SET_ERROR, error: null });
      dispatch({
        type: RECEIVED_EVENTS,
        events: data.events || [],
        total: data.total || 0,
        append: offset > 0,
        timelineOrder: data.timeline_order || "oldest_first",
        enableReactions: data.enable_reactions,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load events";
      console.error("Event Feed: failed to fetch events", error);
      dispatch({ type: SET_ERROR, error: message });
    } finally {
      dispatch({ type: SET_LOADING, loading: false });
    }
  };
}

export function receivedNewEvent(event: EventEntry): EventFeedAction {
  return { type: RECEIVED_NEW_EVENT, event };
}

export function receivedUpdatedEvent(event: EventEntry): EventFeedAction {
  return { type: RECEIVED_UPDATED_EVENT, event };
}

export function parseNewEventWebSocket(
  rawEvent: string,
): EventFeedAction | null {
  try {
    const event: EventEntry = JSON.parse(rawEvent);
    return receivedNewEvent(event);
  } catch (e) {
    console.error("Event Feed: failed to parse WebSocket event", e);
    return null;
  }
}

export function parseUpdatedEventWebSocket(
  rawEvent: string,
): EventFeedAction | null {
  try {
    const event: EventEntry = JSON.parse(rawEvent);
    return receivedUpdatedEvent(event);
  } catch (e) {
    console.error("Event Feed: failed to parse WebSocket event", e);
    return null;
  }
}

export function clearNewEventFlag(eventId: string): EventFeedAction {
  return { type: CLEAR_NEW_EVENT_FLAG, eventId };
}

export function clearUpdatedEventFlag(eventId: string): EventFeedAction {
  return { type: CLEAR_UPDATED_EVENT_FLAG, eventId };
}

export function addReaction(eventId: string, icon: string) {
  return async (
    dispatch: EventFeedDispatch,
  ): Promise<Record<string, ReactionClientSummary>> => {
    dispatch({
      type: OPTIMISTIC_REACTION,
      event_id: eventId,
      icon,
      optimisticAction: "add",
    });
    try {
      const resp = await fetch(
        `/plugins/${manifest.id}/api/v1/events/${eventId}/reactions/${icon}`,
        { method: "PUT", headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      if (!resp.ok) throw new Error("Failed to add reaction");
      return resp.json();
    } catch (err) {
      dispatch({
        type: OPTIMISTIC_REACTION,
        event_id: eventId,
        icon,
        optimisticAction: "remove",
      });
      throw err;
    }
  };
}

export function removeReaction(eventId: string, icon: string) {
  return async (
    dispatch: EventFeedDispatch,
  ): Promise<Record<string, ReactionClientSummary>> => {
    dispatch({
      type: OPTIMISTIC_REACTION,
      event_id: eventId,
      icon,
      optimisticAction: "remove",
    });
    try {
      const resp = await fetch(
        `/plugins/${manifest.id}/api/v1/events/${eventId}/reactions/${icon}`,
        { method: "DELETE", headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      if (!resp.ok) throw new Error("Failed to remove reaction");
      return resp.json();
    } catch (err) {
      dispatch({
        type: OPTIMISTIC_REACTION,
        event_id: eventId,
        icon,
        optimisticAction: "add",
      });
      throw err;
    }
  };
}

export function fetchReactionUsers(
  eventId: string,
  icon: string,
): Promise<string[]> {
  return fetch(
    `/plugins/${manifest.id}/api/v1/events/${eventId}/reactions/${icon}`,
    { headers: { "X-Requested-With": "XMLHttpRequest" } },
  )
    .then((r) => r.json())
    .then((data) => data.user_ids || []);
}

export function receivedReactionUpdated(payload: {
  event_id: string;
  icon: string;
  count: number;
  user_ids: string[];
}) {
  return { type: RECEIVED_REACTION_UPDATED, ...payload };
}

export function parseReactionWebSocket(
  msg: ReactionUpdatedWebSocketMessage,
): EventFeedAction | null {
  try {
    const payload = JSON.parse(msg.data.payload);
    return receivedReactionUpdated(payload);
  } catch {
    return null;
  }
}

export function clearEvents() {
  return { type: CLEAR_EVENTS };
}

export function setCurrentUserId(userId: string) {
  return { type: SET_CURRENT_USER_ID, currentUserId: userId };
}
