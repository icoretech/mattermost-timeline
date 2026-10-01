import type { MutableRefObject } from "react";
import { useEffect } from "react";
import { type EventFeedThunk, markVisibleEventsRead } from "../actions";
import type { EventEntry } from "../types/timeline";

type TimelineReadTrackingDispatch = (
  thunk: EventFeedThunk<unknown>,
) => Promise<unknown> | unknown;

type TimelineReadTrackingArgs = {
  currentChannelId: string;
  currentTeamId: string;
  currentUnreadEventIds: string[];
  dispatch: TimelineReadTrackingDispatch;
  error: string | null;
  isLoading: boolean;
  markPopoutContextRead: string;
  readMarkedSignatureRef: MutableRefObject<string>;
  renderedEvents: EventEntry[];
  viewChannelId: string;
  viewTeamId: string;
};

export function useTimelineReadTracking({
  currentChannelId,
  currentTeamId,
  currentUnreadEventIds,
  dispatch,
  error,
  isLoading,
  markPopoutContextRead,
  readMarkedSignatureRef,
  renderedEvents,
  viewChannelId,
  viewTeamId,
}: TimelineReadTrackingArgs) {
  useEffect(() => {
    const visibleEventIds = renderedEvents.map((event) => event.id);
    const unreadIdSet = new Set(currentUnreadEventIds);
    const eventIdsToMark = visibleEventIds.filter((id) => unreadIdSet.has(id));
    const eventSignature = renderedEvents
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
          window.WebappUtils.popouts.sendToParent(markPopoutContextRead, {
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
    renderedEvents,
    currentUnreadEventIds,
    viewTeamId,
    viewChannelId,
    currentTeamId,
    currentChannelId,
    isLoading,
    error,
    markPopoutContextRead,
    readMarkedSignatureRef,
  ]);
}
