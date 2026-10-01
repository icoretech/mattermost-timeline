import type { MutableRefObject, RefObject } from "react";
import { useEffect } from "react";

type TimelineScrollPositionArgs = {
  eventsCount: number;
  initialScrolledContextRef: MutableRefObject<{
    teamId: string;
    channelId: string;
  }>;
  isLoading: boolean;
  isOldestFirst: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  newEventCount: number;
  prefersReducedMotion: boolean;
  viewChannelId: string;
  viewTeamId: string;
};

export function useTimelineScrollPosition({
  eventsCount,
  initialScrolledContextRef,
  isLoading,
  isOldestFirst,
  listRef,
  newEventCount,
  prefersReducedMotion,
  viewChannelId,
  viewTeamId,
}: TimelineScrollPositionArgs) {
  useEffect(() => {
    if (!isOldestFirst || !listRef.current || newEventCount === 0) return;

    if (prefersReducedMotion) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      return;
    }

    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [newEventCount, isOldestFirst, prefersReducedMotion, listRef]);

  useEffect(() => {
    const alreadyScrolled =
      initialScrolledContextRef.current.teamId === viewTeamId &&
      initialScrolledContextRef.current.channelId === viewChannelId;

    if (
      !isOldestFirst ||
      !listRef.current ||
      eventsCount === 0 ||
      isLoading ||
      alreadyScrolled
    ) {
      return;
    }

    initialScrolledContextRef.current = {
      teamId: viewTeamId,
      channelId: viewChannelId,
    };
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [
    isLoading,
    eventsCount,
    isOldestFirst,
    viewTeamId,
    viewChannelId,
    listRef,
    initialScrolledContextRef,
  ]);
}
