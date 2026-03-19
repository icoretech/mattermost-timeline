import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { Dispatch } from "redux";

import {
  clearNewEventFlag,
  clearUpdatedEventFlag,
  fetchEvents,
} from "../actions";
import { getCurrentTeamId, getPluginState } from "../selectors";
import type { EventEntry } from "../types";

import TimelineEntry from "./timeline_entry";

import "../styles/timeline.scss";

// Mattermost host store supports thunk dispatch
type AppDispatch = Dispatch &
  ((thunk: (dispatch: Dispatch) => Promise<void> | void) => void);

const RHSView: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const listRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  const currentTeamId = useSelector(getCurrentTeamId);
  const pluginState = useSelector(getPluginState);

  const {
    events = [],
    isLoading = false,
    error = null,
    newEventIds = [],
    updatedEventIds = [],
    total = 0,
    timelineOrder = "oldest_first",
  } = pluginState || {};

  const isOldestFirst = timelineOrder === "oldest_first";

  // oldest_first: reverse store order (store has newest first) so oldest is at top
  // newest_first: use store order as-is (newest at top)
  const displayEvents = useMemo(
    () => (isOldestFirst ? [...events].reverse() : events),
    [events, isOldestFirst],
  );

  useEffect(() => {
    if (currentTeamId) {
      dispatch(fetchEvents(currentTeamId));
    }
  }, [dispatch, currentTeamId]);

  // Auto-scroll to bottom when new events arrive (only in oldest_first mode)
  useEffect(() => {
    if (isOldestFirst && listRef.current && newEventIds.length > 0) {
      listRef.current.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [newEventIds.length, isOldestFirst]);

  // Scroll to bottom on initial load (only in oldest_first mode)
  useEffect(() => {
    if (
      isOldestFirst &&
      listRef.current &&
      events.length > 0 &&
      !isLoading &&
      !initialLoadDone.current
    ) {
      initialLoadDone.current = true;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [isLoading, events.length, isOldestFirst]);

  const handleAnimationEnd = useCallback(
    (eventId: string) => {
      dispatch(clearNewEventFlag(eventId));
    },
    [dispatch],
  );

  const handleUpdateAnimationEnd = useCallback(
    (eventId: string) => {
      dispatch(clearUpdatedEventFlag(eventId));
    },
    [dispatch],
  );

  const handleLoadMore = useCallback(() => {
    if (currentTeamId && events.length < total) {
      dispatch(fetchEvents(currentTeamId, events.length));
    }
  }, [dispatch, currentTeamId, events.length, total]);

  const loadMoreButton = !isLoading && events.length < total && (
    <button
      type="button"
      className="event-feed-load-more"
      onClick={handleLoadMore}
    >
      {"Load older events"}
    </button>
  );

  return (
    <div className="event-feed-timeline">
      <div className="event-feed-list" ref={listRef}>
        {isOldestFirst && loadMoreButton}
        {isLoading && (
          <div className="event-feed-loading">
            <div className="event-feed-loading__spinner" />
            <span>{"Loading events..."}</span>
          </div>
        )}
        {error && !isLoading && (
          <div className="event-feed-error">
            <span>{error}</span>
          </div>
        )}
        {displayEvents.map((event: EventEntry) => (
          <TimelineEntry
            key={event.id}
            event={event}
            isNew={newEventIds.includes(event.id)}
            isUpdated={updatedEventIds.includes(event.id)}
            onAnimationEnd={handleAnimationEnd}
            onUpdateAnimationEnd={handleUpdateAnimationEnd}
          />
        ))}
        {!isOldestFirst && loadMoreButton}
        {!isLoading && events.length === 0 && (
          <div className="event-feed-empty">
            <span className="event-feed-empty__icon">{"📡"}</span>
            <p>{"No events yet"}</p>
            <p className="event-feed-empty__hint">
              {"Events will appear here when webhooks are received."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RHSView;
