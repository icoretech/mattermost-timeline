import React from "react";

import type { TimestampDisplayPreferences } from "../selectors";
import type { EventEntry, TimelineUser } from "../types/timeline";

import TimelineEntry from "./timeline_entry";

type TimelineEventGroup = {
  label: string;
  events: EventEntry[];
};

type TimelineLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type TimelineReactionHandlers = {
  onAddReaction: (eventId: string, icon: string) => void;
  onFetchReactionUsers: (eventId: string, icon: string) => Promise<string[]>;
  onRemoveReaction: (eventId: string, icon: string) => void;
};

type TimelineEventListProps = {
  emptyEndpoint?: string;
  eventsCount: number;
  getUser: (userId: string) => TimelineUser | undefined;
  groupedEvents: TimelineEventGroup[];
  loadMoreButton: React.ReactNode;
  loadState: TimelineLoadState;
  listRef: React.RefObject<HTMLDivElement | null>;
  newEventIds: string[];
  onAnimationEnd: (eventId: string) => void;
  onUpdateAnimationEnd: (eventId: string) => void;
  reactions?: TimelineReactionHandlers;
  timestampDisplayPreferences: TimestampDisplayPreferences;
  timelineOrder: "oldest_first" | "newest_first";
  updatedEventIds: string[];
};

export default function TimelineEventList({
  emptyEndpoint,
  eventsCount,
  getUser,
  groupedEvents,
  loadMoreButton,
  loadState,
  listRef,
  newEventIds,
  onAnimationEnd,
  onUpdateAnimationEnd,
  reactions,
  timestampDisplayPreferences,
  timelineOrder,
  updatedEventIds,
}: TimelineEventListProps) {
  const isOldestFirst = timelineOrder === "oldest_first";
  const isLoading = loadState.kind === "loading";
  const renderEvent = (event: EventEntry) => (
    <TimelineEntry
      key={event.id}
      event={event}
      isNew={newEventIds.includes(event.id)}
      isUpdated={updatedEventIds.includes(event.id)}
      onAnimationEnd={onAnimationEnd}
      onUpdateAnimationEnd={onUpdateAnimationEnd}
      enableReactions={Boolean(reactions)}
      timestampDisplayPreferences={timestampDisplayPreferences}
      onAddReaction={reactions?.onAddReaction ?? (() => undefined)}
      onRemoveReaction={reactions?.onRemoveReaction ?? (() => undefined)}
      onFetchReactionUsers={reactions?.onFetchReactionUsers ?? (async () => [])}
      getUser={getUser}
    />
  );

  return (
    <div className="event-feed-list" ref={listRef}>
      {isOldestFirst && loadMoreButton}
      {isLoading && (
        <div className="event-feed-loading" role="status" aria-live="polite">
          <div className="event-feed-loading__spinner" />
          <span>{"Loading events..."}</span>
        </div>
      )}
      {loadState.kind === "error" && (
        <div className="event-feed-error" role="alert">
          <span>{loadState.message}</span>
        </div>
      )}
      {groupedEvents.map((group) => (
        <React.Fragment key={group.label || "events"}>
          {group.label && (
            <div className="event-feed-section-heading">{group.label}</div>
          )}
          {group.events.map(renderEvent)}
        </React.Fragment>
      ))}
      {!isOldestFirst && loadMoreButton}
      {!isLoading && eventsCount === 0 && (
        <div className="event-feed-empty" role="status">
          <span className="event-feed-empty__icon">{"📡"}</span>
          <p className="event-feed-empty__title">{"No events yet"}</p>
          <p className="event-feed-empty__hint">
            {
              "Send a webhook to this team or channel; new events appear here automatically."
            }
          </p>
          {emptyEndpoint && (
            <code className="event-feed-empty__endpoint">{emptyEndpoint}</code>
          )}
        </div>
      )}
    </div>
  );
}
