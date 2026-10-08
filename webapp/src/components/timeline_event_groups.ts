import { useMemo } from "react";
import { useMessages } from "../i18n";

import type { EventEntry } from "../types/timeline";

import { isTimelineEventActive } from "./timeline_entry_helpers";

export type TimelineEventGroup = {
  id: "events" | "active" | "history";
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
  const { t } = useMessages();
  const displayEvents = useMemo(
    () => (isOldestFirst ? [...events].reverse() : events),
    [events, isOldestFirst],
  );

  const groupedEvents = useMemo<TimelineEventGroup[]>(() => {
    const activeEvents = displayEvents.filter((event) =>
      isTimelineEventActive(event),
    );
    const activeIds = new Set(activeEvents.map((event) => event.id));
    const historyEvents = displayEvents.filter(
      (event) => !activeIds.has(event.id),
    );
    if (activeEvents.length === 0 || historyEvents.length === 0) {
      return [{ id: "events", label: "", events: displayEvents }];
    }
    return [
      { id: "active", label: t("timeline.active"), events: activeEvents },
      { id: "history", label: t("timeline.history"), events: historyEvents },
    ];
  }, [displayEvents, t]);

  const renderedEvents = useMemo(
    () => groupedEvents.flatMap((group) => group.events),
    [groupedEvents],
  );

  return { groupedEvents, renderedEvents };
}
