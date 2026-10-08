import type { Dispatch } from "redux";

import manifest from "./manifest";
import {
  errorKey,
  httpErrorKey,
  TimelineRequestError,
} from "./timeline_errors";
import {
  isEventEntry,
  isReactionSummaryMap,
  isRecord,
  isStringArray,
  isTimelineOrder,
} from "./timeline_validation";

import type {
  EventEntry,
  EventFeedState,
  HydratableEventFeedState,
  ReactionClientSummary,
  TimelineReadState,
} from "./types/timeline";

const pluginId = manifest.id as "ch.icorete.mattermost-timeline";

function actionType<const Suffix extends string>(
  suffix: Suffix,
): `${typeof pluginId}_${Suffix}` {
  return `${pluginId}_${suffix}`;
}

export const RECEIVED_EVENTS = actionType("received_events");
export const RECEIVED_NEW_EVENT = actionType("received_new_event");
export const RECEIVED_UPDATED_EVENT = actionType("received_updated_event");
export const CLEAR_NEW_EVENT_FLAG = actionType("clear_new_event_flag");
export const CLEAR_UPDATED_EVENT_FLAG = actionType("clear_updated_event_flag");
export const SET_LOADING = actionType("set_loading");
export const SET_ERROR = actionType("set_error");
export const RECEIVED_REACTION_UPDATED = actionType(
  "received_reaction_updated",
);
export const RECEIVED_EVENT_REACTIONS = actionType("received_event_reactions");
export const OPTIMISTIC_REACTION = actionType("optimistic_reaction");
export const CLEAR_EVENTS = actionType("clear_events");
export const SET_CURRENT_USER_ID = actionType("set_current_user_id");
export const SET_VIEW_CONTEXT = actionType("set_view_context");
export const HYDRATE_POPOUT_STATE = actionType("hydrate_popout_state");
export const RECEIVED_CONTEXT_UNREAD_EVENTS = actionType(
  "received_context_unread_events",
);
export const RECEIVED_UNREAD_EVENTS = actionType("received_unread_events");
export const MARK_EVENTS_READ = actionType("mark_events_read");

export type TimelineOrder = EventFeedState["timelineOrder"];

export type ReceivedEventsAction = {
  type: typeof RECEIVED_EVENTS;
  events: EventEntry[];
  total: number;
  append?: boolean;
  timelineOrder?: TimelineOrder;
  enableReactions?: boolean;
  unreadEventIds?: string[];
  teamId?: string;
  channelId?: string;
};
export type ReceivedNewEventAction = {
  type: typeof RECEIVED_NEW_EVENT;
  event: EventEntry;
};
export type ReceivedUpdatedEventAction = {
  type: typeof RECEIVED_UPDATED_EVENT;
  event: EventEntry;
};
export type ClearNewEventFlagAction = {
  type: typeof CLEAR_NEW_EVENT_FLAG;
  eventId: string;
};
export type ClearUpdatedEventFlagAction = {
  type: typeof CLEAR_UPDATED_EVENT_FLAG;
  eventId: string;
};
export type SetLoadingAction = { type: typeof SET_LOADING; loading: boolean };
export type SetErrorAction = { type: typeof SET_ERROR; error: string | null };
export type ReactionUpdatedAction = {
  type: typeof RECEIVED_REACTION_UPDATED;
  eventId: string;
  icon: string;
  count: number;
  userIds: string[];
  currentUserId?: string;
};
export type ReceivedEventReactionsAction = {
  type: typeof RECEIVED_EVENT_REACTIONS;
  eventId: string;
  reactions: Record<string, ReactionClientSummary>;
};
export type OptimisticReactionAction = {
  type: typeof OPTIMISTIC_REACTION;
  eventId: string;
  icon: string;
  optimisticAction: "add" | "remove";
};
export type ClearEventsAction = { type: typeof CLEAR_EVENTS };
export type SetCurrentUserIdAction = {
  type: typeof SET_CURRENT_USER_ID;
  currentUserId: string;
};
export type SetViewContextAction = {
  type: typeof SET_VIEW_CONTEXT;
  teamId: string;
  channelId: string;
};
export type HydratePopoutStateAction = {
  type: typeof HYDRATE_POPOUT_STATE;
  hydratedState: HydratableEventFeedState;
  teamId: string;
  channelId: string;
};
export type ReceivedContextUnreadEventsAction = {
  type: typeof RECEIVED_CONTEXT_UNREAD_EVENTS;
  teamId: string;
  channelId: string;
  visibleEventIds: string[];
  unreadEventIds: string[];
};
export type ReceivedUnreadEventsAction = {
  type: typeof RECEIVED_UNREAD_EVENTS;
  events: EventEntry[];
};
export type MarkEventsReadAction = {
  type: typeof MARK_EVENTS_READ;
  teamId: string;
  eventIds: string[];
};

export type EventFeedAction =
  | ReceivedEventsAction
  | ReceivedNewEventAction
  | ReceivedUpdatedEventAction
  | ClearNewEventFlagAction
  | ClearUpdatedEventFlagAction
  | SetLoadingAction
  | SetErrorAction
  | ReactionUpdatedAction
  | ReceivedEventReactionsAction
  | OptimisticReactionAction
  | ClearEventsAction
  | SetCurrentUserIdAction
  | SetViewContextAction
  | HydratePopoutStateAction
  | ReceivedContextUnreadEventsAction
  | ReceivedUnreadEventsAction
  | MarkEventsReadAction;

export type EventFeedDispatch = Dispatch<EventFeedAction>;
export type EventFeedThunk<TReturn = void> = (
  dispatch: EventFeedDispatch,
) => Promise<TReturn> | TReturn;

export type EventFetchFilters = {
  q?: string;
  eventType?: string;
  source?: string;
  severity?: EventEntry["severity"] | "";
  status?: EventEntry["status"] | "";
  environment?: string;
  pinned?: boolean;
  active?: boolean;
  unread?: boolean;
};

type FetchEventsOptions = {
  offset?: number;
  limit?: number;
  channelId?: string;
  signal?: AbortSignal;
  filters?: EventFetchFilters;
};

type EventsResponse = {
  events: EventEntry[];
  unread_events?: EventEntry[];
  total: number;
  timeline_order?: TimelineOrder;
  enable_reactions?: boolean;
};

type ReactionUpdatedPayload = {
  event_id: string;
  icon: string;
  count: number;
  user_ids: string[];
};

type ReactionUsersResponse = {
  user_ids: string[];
};

function isFiniteNumberMap(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
  );
}

type TimelineReadStateResponse = {
  version: number;
  context_read_at?: Record<string, number>;
  seen_events?: Record<string, number>;
};

function isOptionalFiniteNumberMap(
  value: unknown,
): value is Record<string, number> | undefined {
  return value === undefined || isFiniteNumberMap(value);
}

function isTimelineReadStateResponse(
  value: unknown,
): value is TimelineReadStateResponse {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    Number.isFinite(value.version) &&
    isOptionalFiniteNumberMap(value.context_read_at) &&
    isOptionalFiniteNumberMap(value.seen_events)
  );
}

async function parseTimelineReadStateResponse(
  response: Response,
): Promise<TimelineReadState> {
  const data: unknown = await response.json();
  if (!isTimelineReadStateResponse(data)) {
    throw new TimelineRequestError("error.invalidResponse");
  }
  return {
    version: data.version,
    context_read_at: data.context_read_at || {},
    seen_events: data.seen_events || {},
  };
}

function isEventsResponse(value: unknown): value is EventsResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.events) &&
    value.events.every(isEventEntry) &&
    (value.unread_events === undefined ||
      (Array.isArray(value.unread_events) &&
        value.unread_events.every(isEventEntry))) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    (value.timeline_order === undefined ||
      isTimelineOrder(value.timeline_order)) &&
    (value.enable_reactions === undefined ||
      typeof value.enable_reactions === "boolean")
  );
}

function isReactionUpdatedPayload(
  value: unknown,
): value is ReactionUpdatedPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.event_id === "string" &&
    typeof value.icon === "string" &&
    typeof value.count === "number" &&
    Number.isFinite(value.count) &&
    isStringArray(value.user_ids)
  );
}

function isReactionUsersResponse(
  value: unknown,
): value is ReactionUsersResponse {
  if (!isRecord(value)) {
    return false;
  }

  return isStringArray(value.user_ids);
}

async function parseReactionMutationResponse(
  response: Response,
): Promise<Record<string, ReactionClientSummary>> {
  if (!response.ok) {
    throw new TimelineRequestError(
      httpErrorKey(response.status, "error.reaction"),
    );
  }

  const data: unknown = await response.json();
  if (!isReactionSummaryMap(data)) {
    throw new TimelineRequestError("error.invalidResponse");
  }

  return data;
}

function buildEventsURL(
  teamId: string,
  offset: number,
  limit: number,
  channelId?: string,
  filters: EventFetchFilters = {},
) {
  const params = new URLSearchParams({
    team_id: teamId,
    offset: String(offset),
    limit: String(limit),
  });
  if (channelId) {
    params.set("channel_id", channelId);
  }
  if (filters.q) params.set("q", filters.q);
  if (filters.eventType) params.set("event_type", filters.eventType);
  if (filters.source) params.set("source", filters.source);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.status) params.set("status", filters.status);
  if (filters.environment) params.set("environment", filters.environment);
  if (filters.pinned !== undefined)
    params.set("pinned", String(filters.pinned));
  if (filters.active !== undefined)
    params.set("active", String(filters.active));
  if (filters.unread !== undefined)
    params.set("unread", String(filters.unread));
  return `/plugins/${manifest.id}/api/v1/events?${params.toString()}`;
}

export function fetchEvents(
  teamId: string,
  {
    offset = 0,
    limit = 50,
    channelId,
    signal,
    filters = {},
  }: FetchEventsOptions = {},
): EventFeedThunk {
  return async (dispatch: EventFeedDispatch) => {
    dispatch({ type: SET_LOADING, loading: true });
    try {
      const url = buildEventsURL(teamId, offset, limit, channelId, filters);
      const response = await fetch(url, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal,
      });
      if (!response.ok) {
        throw new TimelineRequestError(httpErrorKey(response.status));
      }
      const data: unknown = await response.json();
      if (!isEventsResponse(data)) {
        throw new TimelineRequestError("error.invalidResponse");
      }
      if (signal?.aborted) {
        return;
      }
      dispatch({ type: SET_ERROR, error: null });
      dispatch({
        type: RECEIVED_EVENTS,
        events: data.events,
        total: data.total,
        append: offset > 0,
        timelineOrder: data.timeline_order || "oldest_first",
        enableReactions: data.enable_reactions,
        unreadEventIds: (data.unread_events || []).map((event) => event.id),
        teamId,
        channelId: channelId || "",
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        return;
      }
      const message = errorKey(error, "error.load");
      console.error("Event Feed: failed to fetch events", error);
      dispatch({ type: SET_ERROR, error: message });
    } finally {
      if (!signal?.aborted) {
        dispatch({ type: SET_LOADING, loading: false });
      }
    }
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function receivedNewEvent(event: EventEntry): ReceivedNewEventAction {
  return { type: RECEIVED_NEW_EVENT, event };
}

export function receivedUpdatedEvent(
  event: EventEntry,
): ReceivedUpdatedEventAction {
  return { type: RECEIVED_UPDATED_EVENT, event };
}

function parseWebSocketPayload<TPayload, TAction extends EventFeedAction>(
  rawPayload: string,
  validate: (value: unknown) => value is TPayload,
  buildAction: (payload: TPayload) => TAction,
  labels: { invalid: string; parseFailure: string },
): TAction | null {
  try {
    const payload: unknown = JSON.parse(rawPayload);
    if (!validate(payload)) {
      console.error(labels.invalid, payload);
      return null;
    }
    return buildAction(payload);
  } catch (e) {
    console.error(labels.parseFailure, e);
    return null;
  }
}

function parseEventWebSocket<TAction extends EventFeedAction>(
  rawEvent: string,
  buildAction: (event: EventEntry) => TAction,
): TAction | null {
  return parseWebSocketPayload(rawEvent, isEventEntry, buildAction, {
    invalid: "Event Feed: invalid WebSocket event payload",
    parseFailure: "Event Feed: failed to parse WebSocket event",
  });
}

export function parseNewEventWebSocket(
  rawEvent: string,
): ReceivedNewEventAction | null {
  return parseEventWebSocket(rawEvent, receivedNewEvent);
}

export function parseUpdatedEventWebSocket(
  rawEvent: string,
): ReceivedUpdatedEventAction | null {
  return parseEventWebSocket(rawEvent, receivedUpdatedEvent);
}

export function clearNewEventFlag(eventId: string): ClearNewEventFlagAction {
  return { type: CLEAR_NEW_EVENT_FLAG, eventId };
}

export function clearUpdatedEventFlag(
  eventId: string,
): ClearUpdatedEventFlagAction {
  return { type: CLEAR_UPDATED_EVENT_FLAG, eventId };
}

export function receivedUnreadEvents(
  events: EventEntry[],
): ReceivedUnreadEventsAction {
  return { type: RECEIVED_UNREAD_EVENTS, events };
}

export function markEventsRead(
  teamId: string,
  eventIds: string[],
): MarkEventsReadAction {
  return { type: MARK_EVENTS_READ, teamId, eventIds };
}

export function refreshUnreadEvents(
  teamId: string,
  channelId = "",
): EventFeedThunk {
  return async (dispatch: EventFeedDispatch) => {
    if (!teamId) {
      return;
    }

    try {
      let url = `/plugins/${manifest.id}/api/v1/events?team_id=${encodeURIComponent(teamId)}&offset=0&limit=50`;
      if (channelId) {
        url += `&channel_id=${encodeURIComponent(channelId)}`;
      }
      const response = await fetch(url, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!response.ok) {
        throw new Error("Failed to refresh unread events");
      }
      const data: unknown = await response.json();
      if (!isEventsResponse(data)) {
        throw new Error("Invalid events response");
      }
      dispatch({
        type: RECEIVED_CONTEXT_UNREAD_EVENTS,
        teamId,
        channelId,
        visibleEventIds: data.events.map((event) => event.id),
        unreadEventIds: (data.unread_events || []).map((event) => event.id),
      });
    } catch (error) {
      console.error("Event Feed: failed to refresh unread events", error);
    }
  };
}

export function markVisibleEventsRead(
  teamId: string,
  channelId: string,
  eventIds: string[],
): EventFeedThunk<Promise<void>> {
  return async (dispatch: EventFeedDispatch) => {
    if (!teamId || eventIds.length === 0) {
      return;
    }

    const response = await fetch(`/plugins/${manifest.id}/api/v1/events/read`, {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        team_id: teamId,
        channel_id: channelId || undefined,
        event_ids: eventIds,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to mark events read");
    }
    await parseTimelineReadStateResponse(response);
    dispatch(markEventsRead(teamId, eventIds));
  };
}

export function addReaction(eventId: string, icon: string) {
  return async (
    dispatch: EventFeedDispatch,
  ): Promise<Record<string, ReactionClientSummary>> => {
    dispatch({
      type: OPTIMISTIC_REACTION,
      eventId,
      icon,
      optimisticAction: "add",
    });
    try {
      const resp = await fetch(
        `/plugins/${manifest.id}/api/v1/events/${eventId}/reactions/${icon}`,
        { method: "PUT", headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      const reactions = await parseReactionMutationResponse(resp);
      dispatch(receivedEventReactions(eventId, reactions));
      return reactions;
    } catch (err) {
      dispatch({
        type: OPTIMISTIC_REACTION,
        eventId,
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
      eventId,
      icon,
      optimisticAction: "remove",
    });
    try {
      const resp = await fetch(
        `/plugins/${manifest.id}/api/v1/events/${eventId}/reactions/${icon}`,
        { method: "DELETE", headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      const reactions = await parseReactionMutationResponse(resp);
      dispatch(receivedEventReactions(eventId, reactions));
      return reactions;
    } catch (err) {
      dispatch({
        type: OPTIMISTIC_REACTION,
        eventId,
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
    .then((r) => {
      if (!r.ok) {
        throw new Error("Failed to fetch reaction users");
      }
      return r.json();
    })
    .then((data: unknown) => {
      if (!isReactionUsersResponse(data)) {
        throw new Error("Invalid reaction users response");
      }
      return data.user_ids;
    });
}

export function receivedReactionUpdated(
  payload: ReactionUpdatedPayload,
): ReactionUpdatedAction {
  return {
    type: RECEIVED_REACTION_UPDATED,
    eventId: payload.event_id,
    icon: payload.icon,
    count: payload.count,
    userIds: payload.user_ids,
  };
}

export function receivedEventReactions(
  eventId: string,
  reactions: Record<string, ReactionClientSummary>,
): ReceivedEventReactionsAction {
  return {
    type: RECEIVED_EVENT_REACTIONS,
    eventId,
    reactions,
  };
}

export function parseReactionWebSocket(
  rawPayload: string,
): ReactionUpdatedAction | null {
  return parseWebSocketPayload(
    rawPayload,
    isReactionUpdatedPayload,
    receivedReactionUpdated,
    {
      invalid: "Event Feed: invalid reaction WebSocket payload",
      parseFailure: "Event Feed: failed to parse reaction WebSocket payload",
    },
  );
}

export function clearEvents(): ClearEventsAction {
  return { type: CLEAR_EVENTS };
}

export function setCurrentUserId(userId: string): SetCurrentUserIdAction {
  return { type: SET_CURRENT_USER_ID, currentUserId: userId };
}

export function setViewContext(
  teamId: string,
  channelId = "",
): SetViewContextAction {
  return { type: SET_VIEW_CONTEXT, teamId, channelId };
}

export function hydratePopoutState(
  hydratedState: HydratableEventFeedState,
  teamId: string,
  channelId = "",
): HydratePopoutStateAction {
  return {
    type: HYDRATE_POPOUT_STATE,
    hydratedState,
    teamId,
    channelId,
  };
}
