import { useMemo } from "react";

import type { EventEntry } from "../types/timeline";

import { isTimelineEventActive } from "./timeline_entry_helpers";

type TimelineEventGroup = {
  label: string;
  events: EventEntry[];
};

export function useTimelineEventGroups(
  events: EventEntry[],
  isOldestFirst: boolean,
): {
  groupedEvents: TimelineEventGroup[];
  renderedEvents: EventEntry[];
} {
  const displayEvents = useMemo(
    () => (isOldestFirst ? [...events].reverse() : events),
    [events, isOldestFirst],
  );

  const groupedEvents = useMemo(() => {
    const activeEvents = displayEvents.filter((event) =>
      isTimelineEventActive(event),
    );
    const activeIds = new Set(activeEvents.map((event) => event.id));
    const historyEvents = displayEvents.filter(
      (event) => !activeIds.has(event.id),
    );
    if (activeEvents.length === 0 || historyEvents.length === 0) {
      return [{ label: "", events: displayEvents }];
    }
    return [
      { label: "Active", events: activeEvents },
      { label: "History", events: historyEvents },
    ];
  }, [displayEvents]);

  const renderedEvents = useMemo(
    () => groupedEvents.flatMap((group) => group.events),
    [groupedEvents],
  );

  return { groupedEvents, renderedEvents };
}
