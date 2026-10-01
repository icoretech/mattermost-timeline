import type { MutableRefObject } from "react";
import { useEffect } from "react";
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
  filterSignature,
  initialScrolledContextRef,
  lastFilterSignatureRef,
  loadedContextRef,
}: TimelineFetchArgs) {
  useEffect(() => {
    if (!currentTeamId) return undefined;

    const controller = new AbortController();
    const sameContext =
      loadedContextRef.current.teamId === currentTeamId &&
      loadedContextRef.current.channelId === (currentChannelId || "");
    const sameFilters = lastFilterSignatureRef.current === filterSignature;

    if (!sameContext || !sameFilters) {
      initialScrolledContextRef.current = { teamId: "", channelId: "" };
      dispatch(clearEvents());
    }
    lastFilterSignatureRef.current = filterSignature;

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
    filterSignature,
    initialScrolledContextRef,
    lastFilterSignatureRef,
    loadedContextRef,
  ]);
}
