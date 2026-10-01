import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import type { EventFetchFilters } from "../actions";

export type TimelineSeverityFilter = "" | "info" | "warning" | "critical";
export type TimelineStatusFilter =
  | ""
  | "open"
  | "running"
  | "success"
  | "failed"
  | "resolved";

export type TimelineFilterState = {
  searchQuery: string;
  filtersOpen: boolean;
  eventTypeFilter: string;
  sourceFilter: string;
  severityFilter: TimelineSeverityFilter;
  statusFilter: TimelineStatusFilter;
  environmentFilter: string;
  pinnedOnly: boolean;
  activeOnly: boolean;
  unreadOnly: boolean;
};

export type TimelineFilterSetters = {
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  setEventTypeFilter: Dispatch<SetStateAction<string>>;
  setSourceFilter: Dispatch<SetStateAction<string>>;
  setSeverityFilter: Dispatch<SetStateAction<TimelineSeverityFilter>>;
  setStatusFilter: Dispatch<SetStateAction<TimelineStatusFilter>>;
  setEnvironmentFilter: Dispatch<SetStateAction<string>>;
  setPinnedOnly: Dispatch<SetStateAction<boolean>>;
  setActiveOnly: Dispatch<SetStateAction<boolean>>;
  setUnreadOnly: Dispatch<SetStateAction<boolean>>;
};

export function useTimelineFilters(): {
  eventFilters: EventFetchFilters;
  filterSetters: TimelineFilterSetters;
  filterSignature: string;
  filterState: TimelineFilterState;
  hasActiveFilters: boolean;
} {
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [severityFilter, setSeverityFilter] =
    useState<TimelineSeverityFilter>("");
  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>("");
  const [environmentFilter, setEnvironmentFilter] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const eventFilters = useMemo<EventFetchFilters>(() => {
    const filters: EventFetchFilters = {};
    if (searchQuery.trim()) filters.q = searchQuery.trim();
    if (eventTypeFilter.trim()) filters.eventType = eventTypeFilter.trim();
    if (sourceFilter.trim()) filters.source = sourceFilter.trim();
    if (severityFilter) filters.severity = severityFilter;
    if (statusFilter) filters.status = statusFilter;
    if (environmentFilter.trim()) {
      filters.environment = environmentFilter.trim();
    }
    if (pinnedOnly) filters.pinned = true;
    if (activeOnly) filters.active = true;
    if (unreadOnly) filters.unread = true;
    return filters;
  }, [
    searchQuery,
    eventTypeFilter,
    sourceFilter,
    severityFilter,
    statusFilter,
    environmentFilter,
    pinnedOnly,
    activeOnly,
    unreadOnly,
  ]);

  const filterSignature = useMemo(
    () => JSON.stringify(eventFilters),
    [eventFilters],
  );

  return {
    eventFilters,
    filterSetters: {
      setSearchQuery,
      setFiltersOpen,
      setEventTypeFilter,
      setSourceFilter,
      setSeverityFilter,
      setStatusFilter,
      setEnvironmentFilter,
      setPinnedOnly,
      setActiveOnly,
      setUnreadOnly,
    },
    filterSignature,
    filterState: {
      searchQuery,
      filtersOpen,
      eventTypeFilter,
      sourceFilter,
      severityFilter,
      statusFilter,
      environmentFilter,
      pinnedOnly,
      activeOnly,
      unreadOnly,
    },
    hasActiveFilters: filterSignature !== "{}",
  };
}
