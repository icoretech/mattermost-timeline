import type {
  EventEntry,
  EventFeedState,
  ReactionClientSummary,
} from "./types/timeline";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isTimelineOrder(
  value: unknown,
): value is EventFeedState["timelineOrder"] {
  return value === "oldest_first" || value === "newest_first";
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
    (value.client_reactions === undefined ||
      isReactionSummaryMap(value.client_reactions)) &&
    (value.channels === undefined || isStringArray(value.channels))
  );
}
