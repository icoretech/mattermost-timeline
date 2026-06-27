import type { GlobalState } from "@mattermost/types/store";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import type { Dispatch } from "redux";

import {
  addReaction,
  clearEvents,
  clearNewEventFlag,
  clearUpdatedEventFlag,
  type EventFeedThunk,
  fetchEvents,
  fetchReactionUsers,
  markVisibleEventsRead,
  removeReaction,
  SET_ERROR,
} from "../actions";
import {
  getCurrentChannelId,
  getCurrentTeamId,
  getCurrentTimelineUnreadEventIds,
  getPluginState,
} from "../selectors";
import type { EventEntry, TimelineUser } from "../types/timeline";

import TimelineEntry from "./timeline_entry";

import "../styles/timeline.scss";

// Mattermost host store supports thunk dispatch
type AppDispatch = Dispatch &
  ((thunk: EventFeedThunk<unknown>) => Promise<unknown> | unknown);

const MARK_POPOUT_CONTEXT_READ = "TIMELINE_MARK_CONTEXT_READ";

const RHSView: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const listRef = useRef<HTMLDivElement>(null);
  const initialScrolledContextRef = useRef({ teamId: "", channelId: "" });
  const loadedContextRef = useRef({ teamId: "", channelId: "" });
  const readMarkedSignatureRef = useRef("");

  const store = useStore<GlobalState>();
  const currentTeamId = useSelector(getCurrentTeamId);
  const currentChannelId = useSelector(getCurrentChannelId);
  const currentUnreadEventIds = useSelector(getCurrentTimelineUnreadEventIds);
  const pluginState = useSelector(getPluginState);

  const {
    events = [],
    isLoading = false,
    error = null,
    newEventIds = [],
    updatedEventIds = [],
    total = 0,
    timelineOrder = "oldest_first",
    enableReactions = true,
    viewTeamId = "",
    viewChannelId = "",
  } = pluginState || {};

  const isOldestFirst = timelineOrder === "oldest_first";

  useEffect(() => {
    loadedContextRef.current = {
      teamId: viewTeamId,
      channelId: viewChannelId,
    };
  }, [viewTeamId, viewChannelId]);

  // oldest_first: reverse store order (store has newest first) so oldest is at top
  // newest_first: use store order as-is (newest at top)
  const displayEvents = useMemo(
    () => (isOldestFirst ? [...events].reverse() : events),
    [events, isOldestFirst],
  );

  useEffect(() => {
    if (currentTeamId) {
      const controller = new AbortController();
      const sameContext =
        loadedContextRef.current.teamId === currentTeamId &&
        loadedContextRef.current.channelId === (currentChannelId || "");

      if (!sameContext) {
        initialScrolledContextRef.current = { teamId: "", channelId: "" };
        dispatch(clearEvents());
      }

      dispatch(
        fetchEvents(currentTeamId, {
          channelId: currentChannelId || undefined,
          signal: controller.signal,
        }),
      );

      return () => controller.abort();
    }
  }, [dispatch, currentTeamId, currentChannelId]);

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
    const alreadyScrolled =
      initialScrolledContextRef.current.teamId === viewTeamId &&
      initialScrolledContextRef.current.channelId === viewChannelId;

    if (
      isOldestFirst &&
      listRef.current &&
      events.length > 0 &&
      !isLoading &&
      !alreadyScrolled
    ) {
      initialScrolledContextRef.current = {
        teamId: viewTeamId,
        channelId: viewChannelId,
      };
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [isLoading, events.length, isOldestFirst, viewTeamId, viewChannelId]);

  useEffect(() => {
    const visibleEventIds = events.map((event) => event.id);
    const unreadIdSet = new Set(currentUnreadEventIds);
    const eventIdsToMark = visibleEventIds.filter((id) => unreadIdSet.has(id));
    const eventSignature = events
      .map((event) => `${event.id}:${event.timestamp}`)
      .join("|");
    const markSignature = `${viewTeamId}:${viewChannelId}:${eventSignature}:${eventIdsToMark.join(",")}`;

    if (
      !viewTeamId ||
      viewTeamId !== currentTeamId ||
      viewChannelId !== (currentChannelId || "") ||
      isLoading ||
      error ||
      eventIdsToMark.length === 0 ||
      readMarkedSignatureRef.current === markSignature
    ) {
      return;
    }

    readMarkedSignatureRef.current = markSignature;
    void Promise.resolve(
      dispatch(
        markVisibleEventsRead(viewTeamId, viewChannelId, eventIdsToMark),
      ),
    )
      .then(() => {
        if (window.WebappUtils?.popouts?.isPopoutWindow()) {
          window.WebappUtils.popouts.sendToParent(MARK_POPOUT_CONTEXT_READ, {
            teamId: viewTeamId,
            eventIds: eventIdsToMark,
          });
        }
      })
      .catch((markReadError: unknown) => {
        console.error("Event Feed: failed to mark events read", markReadError);
      });
  }, [
    dispatch,
    events,
    currentUnreadEventIds,
    viewTeamId,
    viewChannelId,
    currentTeamId,
    currentChannelId,
    isLoading,
    error,
  ]);

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
      dispatch(
        fetchEvents(currentTeamId, {
          offset: events.length,
          channelId: currentChannelId || undefined,
        }),
      );
    }
  }, [dispatch, currentTeamId, currentChannelId, events.length, total]);

  const getUser = useCallback(
    (userId: string): TimelineUser | undefined => {
      const state = store.getState();
      return state.entities.users.profiles[userId];
    },
    [store],
  );

  const handleReactionMutationFailure = useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Failed to update reaction";
      console.error("Event Feed: failed to update reaction", error);
      dispatch({ type: SET_ERROR, error: message });
    },
    [dispatch],
  );

  const handleAddReaction = useCallback(
    (eventId: string, icon: string) => {
      void Promise.resolve(dispatch(addReaction(eventId, icon))).catch(
        handleReactionMutationFailure,
      );
    },
    [dispatch, handleReactionMutationFailure],
  );

  const handleRemoveReaction = useCallback(
    (eventId: string, icon: string) => {
      void Promise.resolve(dispatch(removeReaction(eventId, icon))).catch(
        handleReactionMutationFailure,
      );
    },
    [dispatch, handleReactionMutationFailure],
  );

  const handleFetchReactionUsers = useCallback(
    (eventId: string, icon: string): Promise<string[]> => {
      return fetchReactionUsers(eventId, icon);
    },
    [],
  );

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
            enableReactions={enableReactions}
            onAddReaction={handleAddReaction}
            onRemoveReaction={handleRemoveReaction}
            onFetchReactionUsers={handleFetchReactionUsers}
            getUser={getUser}
          />
        ))}
        {!isOldestFirst && loadMoreButton}
        {!isLoading && events.length === 0 && (
          <div className="event-feed-empty">
            <span className="event-feed-empty__icon">{"📡"}</span>
            <p className="event-feed-empty__title">{"No events yet"}</p>
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
