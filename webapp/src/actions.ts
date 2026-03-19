import type { Dispatch } from "redux";

import manifest from "./manifest";

import type { EventEntry } from "./types";

export const RECEIVED_EVENTS = `${manifest.id}_received_events`;
export const RECEIVED_NEW_EVENT = `${manifest.id}_received_new_event`;
export const RECEIVED_UPDATED_EVENT = `${manifest.id}_received_updated_event`;
export const CLEAR_NEW_EVENT_FLAG = `${manifest.id}_clear_new_event_flag`;
export const CLEAR_UPDATED_EVENT_FLAG = `${manifest.id}_clear_updated_event_flag`;
export const SET_LOADING = `${manifest.id}_set_loading`;
export const SET_ERROR = `${manifest.id}_set_error`;

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
  [key: string]: unknown;
}

export function fetchEvents(
  teamId: string,
  offset = 0,
  limit = 50,
): (dispatch: Dispatch<EventFeedAction>) => Promise<void> {
  return async (dispatch: Dispatch<EventFeedAction>) => {
    dispatch({ type: SET_LOADING, loading: true });
    try {
      const url = `/plugins/${manifest.id}/api/v1/events?team_id=${encodeURIComponent(teamId)}&offset=${offset}&limit=${limit}`;
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
