import {
  type EventCustomField,
  type EventEntry,
  type EventFeedState,
  type ReactionClientSummary,
  TIMELINE_SEVERITIES,
  TIMELINE_STATUSES,
  type TimelineUnreadState,
} from "./types/timeline";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isTimelineUnreadState(
  value: unknown,
): value is TimelineUnreadState {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isStringArray);
}

export function isTimelineOrder(
  value: unknown,
): value is EventFeedState["timelineOrder"] {
  return value === "oldest_first" || value === "newest_first";
}

function isTimelineSeverity(value: unknown): value is EventEntry["severity"] {
  return (
    typeof value === "string" &&
    TIMELINE_SEVERITIES.includes(value as (typeof TIMELINE_SEVERITIES)[number])
  );
}

function isTimelineStatus(value: unknown): value is EventEntry["status"] {
  return (
    typeof value === "string" &&
    TIMELINE_STATUSES.includes(value as (typeof TIMELINE_STATUSES)[number])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isEventLink(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.url === "string" &&
    (value.label === undefined || typeof value.label === "string")
  );
}

function isReactionSummary(value: unknown): value is ReactionClientSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.count === "number" &&
    Number.isFinite(value.count) &&
    typeof value.self === "boolean" &&
    isStringArray(value.recent_users)
  );
}

export function isReactionSummaryMap(
  value: unknown,
): value is Record<string, ReactionClientSummary> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isReactionSummary);
}

function isCustomFieldText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    [...value].length <= maxLength &&
    !/\p{Cc}/u.test(value)
  );
}

function isCustomField(value: unknown): value is EventCustomField {
  if (
    !isRecord(value) ||
    !isCustomFieldText(value.name, 64) ||
    value.name.trim().length === 0 ||
    (value.label !== undefined && !isCustomFieldText(value.label, 80)) ||
    (value.type !== undefined && value.type !== typeof value.value)
  ) {
    return false;
  }

  return (
    isCustomFieldText(value.value, 1000) ||
    isFiniteNumber(value.value) ||
    typeof value.value === "boolean"
  );
}

function isCustomFields(value: unknown): value is readonly EventCustomField[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(isCustomField) &&
    new Set(value.map((field) => field.name)).size === value.length
  );
}

export function isEventEntry(value: unknown): value is EventEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.team_id === "string" &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    typeof value.title === "string" &&
    typeof value.event_type === "string" &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.link === undefined || typeof value.link === "string") &&
    (value.links === undefined ||
      (Array.isArray(value.links) && value.links.every(isEventLink))) &&
    (value.source === undefined || typeof value.source === "string") &&
    (value.external_id === undefined ||
      typeof value.external_id === "string") &&
    (value.severity === undefined || isTimelineSeverity(value.severity)) &&
    (value.status === undefined || isTimelineStatus(value.status)) &&
    (value.environment === undefined ||
      typeof value.environment === "string") &&
    (value.expires_at === undefined || isFiniteNumber(value.expires_at)) &&
    (value.pinned === undefined || typeof value.pinned === "boolean") &&
    (value.resolved_at === undefined || isFiniteNumber(value.resolved_at)) &&
    (value.custom_fields === undefined ||
      isCustomFields(value.custom_fields)) &&
    (value.client_reactions === undefined ||
      isReactionSummaryMap(value.client_reactions)) &&
    (value.channels === undefined || isStringArray(value.channels))
  );
}

export function isEventFeedState(value: unknown): value is EventFeedState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.events) &&
    value.events.every(isEventEntry) &&
    typeof value.isLoading === "boolean" &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.total === "number" &&
    isStringArray(value.newEventIds) &&
    isStringArray(value.updatedEventIds) &&
    (value.websocketRevision === undefined ||
      isFiniteNumber(value.websocketRevision)) &&
    (value.unreadEventIdsByContext === undefined ||
      isTimelineUnreadState(value.unreadEventIdsByContext)) &&
    isTimelineOrder(value.timelineOrder) &&
    typeof value.enableReactions === "boolean" &&
    typeof value.currentUserId === "string" &&
    typeof value.viewTeamId === "string" &&
    typeof value.viewChannelId === "string"
  );
}
