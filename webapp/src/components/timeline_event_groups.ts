import { useMemo } from "react";

import type { EventEntry } from "../types/timeline";


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

  const groupedEvents = useMemo(() => [{ label: "", events: displayEvents }], [displayEvents]);

  const renderedEvents = useMemo(
    () => groupedEvents.flatMap((group) => group.events),
    [groupedEvents],
  );

  return { groupedEvents, renderedEvents };
}
