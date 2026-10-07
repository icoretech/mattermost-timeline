import type { GlobalState } from "@mattermost/types/store";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import type { Dispatch } from "redux";

import {
  addReaction,
  clearNewEventFlag,
  clearUpdatedEventFlag,
  type EventFeedThunk,
  fetchEvents,
  fetchReactionUsers,
  removeReaction,
  SET_ERROR,
} from "../actions";
import {
  getCurrentChannelId,
  getCurrentTeamId,
  getCurrentTimelineUnreadEventIds,
  getPluginState,
  getTimestampDisplayPreferences,
} from "../selectors";
import type { TimelineUser } from "../types/timeline";
import { useTimelineEventGroups } from "./timeline_event_groups";
import TimelineEventList from "./timeline_event_list";
import { useTimelineFetch } from "./timeline_fetch";
import TimelineFilterToolbar from "./timeline_filter_toolbar";
import { useTimelineFilters } from "./timeline_filters";
import { useTimelineReadTracking } from "./timeline_read_tracking";
import { useTimelineScrollPosition } from "./timeline_scroll";

import "../styles/timeline.scss";

// Mattermost host store supports thunk dispatch
type AppDispatch = Dispatch &
  ((thunk: EventFeedThunk<unknown>) => Promise<unknown> | unknown);

const MARK_POPOUT_CONTEXT_READ = "TIMELINE_MARK_CONTEXT_READ";

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

const RHSView: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const listRef = useRef<HTMLDivElement>(null);
  const initialScrolledContextRef = useRef({ teamId: "", channelId: "" });
  const loadedContextRef = useRef({ teamId: "", channelId: "" });
  const readMarkedSignatureRef = useRef("");
  const lastFilterSignatureRef = useRef("");
  const prefersReducedMotion = usePrefersReducedMotion();

  const store = useStore<GlobalState>();
  const currentTeamId = useSelector(getCurrentTeamId);
  const currentChannelId = useSelector(getCurrentChannelId);
  const currentUnreadEventIds = useSelector(getCurrentTimelineUnreadEventIds);
  const {
    events = [],
    isLoading = false,
    error = null,
    newEventIds = [],
    updatedEventIds = [],
    websocketRevision = 0,
    total = 0,
    timelineOrder = "oldest_first",
    enableReactions = true,
    viewTeamId = "",
    viewChannelId = "",
  } = useSelector(getPluginState) || {};
  const timestampDisplayPreferences = useSelector(
    getTimestampDisplayPreferences,
  );

  const isOldestFirst = timelineOrder === "oldest_first";

  const {
    eventFilters,
    filterSetters,
    filterSignature,
    filterState,
    hasActiveFilters,
  } = useTimelineFilters();

  useEffect(() => {
    loadedContextRef.current = {
      teamId: viewTeamId,
      channelId: viewChannelId,
    };
  }, [viewTeamId, viewChannelId]);

  const { groupedEvents, renderedEvents } = useTimelineEventGroups(
    events,
    isOldestFirst,
  );

  useTimelineFetch({
    currentChannelId,
    currentTeamId,
    dispatch,
    eventFilters,
    eventRevision: hasActiveFilters ? websocketRevision : 0,
    filterSignature,
    initialScrolledContextRef,
    lastFilterSignatureRef,
    loadedContextRef,
  });

  useTimelineScrollPosition({
    eventsCount: events.length,
    initialScrolledContextRef,
    isLoading,
    isOldestFirst,
    listRef,
    newEventCount: newEventIds.length,
    prefersReducedMotion,
    viewChannelId,
    viewTeamId,
  });

  useTimelineReadTracking({
    currentChannelId,
    currentTeamId,
    currentUnreadEventIds,
    dispatch,
    error,
    isLoading,
    markPopoutContextRead: MARK_POPOUT_CONTEXT_READ,
    readMarkedSignatureRef,
    renderedEvents,
    viewChannelId,
    viewTeamId,
  });

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
          filters: eventFilters,
        }),
      );
    }
  }, [
    dispatch,
    currentTeamId,
    currentChannelId,
    events.length,
    total,
    eventFilters,
  ]);

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
    <div
      className="event-feed-timeline"
      aria-busy={isLoading ? "true" : undefined}
    >
      <TimelineFilterToolbar
        filterSetters={filterSetters}
        filterState={filterState}
      />
      <TimelineEventList
        emptyEndpoint={
          hasActiveFilters
            ? undefined
            : "/plugins/ch.icorete.mattermost-timeline/webhook"
        }
        eventsCount={events.length}
        getUser={getUser}
        groupedEvents={groupedEvents}
        loadMoreButton={loadMoreButton}
        loadState={
          isLoading
            ? { kind: "loading" }
            : error
              ? { kind: "error", message: error }
              : { kind: "ready" }
        }
        listRef={listRef}
        newEventIds={newEventIds}
        onAnimationEnd={handleAnimationEnd}
        onUpdateAnimationEnd={handleUpdateAnimationEnd}
        reactions={
          enableReactions
            ? {
                onAddReaction: handleAddReaction,
                onFetchReactionUsers: handleFetchReactionUsers,
                onRemoveReaction: handleRemoveReaction,
              }
            : undefined
        }
        timestampDisplayPreferences={timestampDisplayPreferences}
        timelineOrder={timelineOrder}
        updatedEventIds={updatedEventIds}
      />
    </div>
  );
};

export default RHSView;
