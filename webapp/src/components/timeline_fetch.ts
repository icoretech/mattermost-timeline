import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import type { Dispatch } from "redux";

import type { EventFetchFilters } from "../actions";
import { clearEvents, type EventFeedThunk, fetchEvents } from "../actions";

type TimelineFetchDispatch = Dispatch &
  ((thunk: EventFeedThunk<unknown>) => Promise<unknown> | unknown);

type TimelineFetchArgs = {
  currentChannelId: string;
  currentTeamId: string;
  dispatch: TimelineFetchDispatch;
  eventFilters: EventFetchFilters;
  eventRevision: number;
  filterSignature: string;
  initialScrolledContextRef: MutableRefObject<{
    teamId: string;
    channelId: string;
  }>;
  lastFilterSignatureRef: MutableRefObject<string>;
  loadedContextRef: MutableRefObject<{ teamId: string; channelId: string }>;
};

export function useTimelineFetch({
  currentChannelId,
  currentTeamId,
  dispatch,
  eventFilters,
  eventRevision,
  filterSignature,
  initialScrolledContextRef,
  lastFilterSignatureRef,
  loadedContextRef,
}: TimelineFetchArgs) {
  const lastEventRevisionRef = useRef(eventRevision);

  useEffect(() => {
    if (!currentTeamId) return undefined;

    const controller = new AbortController();
    const sameContext =
      loadedContextRef.current.teamId === currentTeamId &&
      loadedContextRef.current.channelId === (currentChannelId || "");
    const sameFilters = lastFilterSignatureRef.current === filterSignature;
    const sameEvents = lastEventRevisionRef.current === eventRevision;

    if (!sameContext || !sameFilters) {
      initialScrolledContextRef.current = { teamId: "", channelId: "" };
    }
    if (!sameContext || !sameFilters || !sameEvents) {
      dispatch(clearEvents());
    }
    lastFilterSignatureRef.current = filterSignature;
    lastEventRevisionRef.current = eventRevision;

    dispatch(
      fetchEvents(currentTeamId, {
        channelId: currentChannelId || undefined,
        filters: eventFilters,
        signal: controller.signal,
      }),
    );

    return () => controller.abort();
  }, [
    dispatch,
    currentTeamId,
    currentChannelId,
    eventFilters,
    eventRevision,
    filterSignature,
    initialScrolledContextRef,
    lastFilterSignatureRef,
    loadedContextRef,
  ]);
}
