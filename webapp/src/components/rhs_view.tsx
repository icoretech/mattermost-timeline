import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { Dispatch } from "redux";

import { clearNewEventFlag, fetchEvents } from "../actions";
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
    total = 0,
  } = pluginState || {};

  // Reversed: oldest first, newest at bottom
  const reversedEvents = useMemo(() => [...events].reverse(), [events]);

  useEffect(() => {
    if (currentTeamId) {
      dispatch(fetchEvents(currentTeamId));
    }
  }, [dispatch, currentTeamId]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (listRef.current && newEventIds.length > 0) {
      listRef.current.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [newEventIds.length]);

  // Scroll to bottom on initial load only
  useEffect(() => {
    if (
      listRef.current &&
      events.length > 0 &&
      !isLoading &&
      !initialLoadDone.current
    ) {
      initialLoadDone.current = true;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [isLoading, events.length]);

  const handleAnimationEnd = useCallback(
    (eventId: string) => {
      dispatch(clearNewEventFlag(eventId));
    },
    [dispatch],
  );

  const handleLoadMore = useCallback(() => {
    if (currentTeamId && events.length < total) {
      dispatch(fetchEvents(currentTeamId, events.length));
    }
  }, [dispatch, currentTeamId, events.length, total]);

  return (
    <div className="event-feed-timeline">
      <div className="event-feed-list" ref={listRef}>
        {!isLoading && events.length < total && (
          <button
            type="button"
            className="event-feed-load-more"
            onClick={handleLoadMore}
          >
            {"Load older events"}
          </button>
        )}
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
        {reversedEvents.map((event: EventEntry) => (
          <TimelineEntry
            key={event.id}
            event={event}
            isNew={newEventIds.includes(event.id)}
            onAnimationEnd={handleAnimationEnd}
          />
        ))}
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
