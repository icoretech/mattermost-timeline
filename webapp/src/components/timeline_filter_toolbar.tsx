import React from "react";

import { TIMELINE_STATUSES } from "../types/timeline";
import type {
  TimelineFilterSetters,
  TimelineFilterState,
} from "./timeline_filters";

type TimelineFilterToolbarProps = {
  filterSetters: TimelineFilterSetters;
  filterState: TimelineFilterState;
};

export default function TimelineFilterToolbar({
  filterSetters,
  filterState,
}: TimelineFilterToolbarProps) {
  const {
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
  } = filterState;
  const {
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
  } = filterSetters;

  return (
    <div className="event-feed-toolbar">
      <label className="event-feed-sr-only" htmlFor="event-feed-search">
        {"Search timeline events"}
      </label>
      <input
        id="event-feed-search"
        className="event-feed-search"
        type="search"
        value={searchQuery}
        placeholder="Search timeline"
        aria-label="Search timeline events"
        onChange={(event) => setSearchQuery(event.currentTarget.value)}
      />
      <button
        type="button"
        className="event-feed-filter-toggle"
        aria-expanded={filtersOpen}
        aria-controls="event-feed-filter-panel"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {"Filters"}
      </button>
      {filtersOpen && (
        <div id="event-feed-filter-panel" className="event-feed-filters">
          <label className="event-feed-sr-only" htmlFor="event-type-filter">
            {"Event type"}
          </label>
          <input
            id="event-type-filter"
            className="event-feed-filter-input"
            type="text"
            value={eventTypeFilter}
            placeholder="Event type"
            onChange={(event) => setEventTypeFilter(event.currentTarget.value)}
          />
          <label className="event-feed-sr-only" htmlFor="source-filter">
            {"Source"}
          </label>
          <input
            id="source-filter"
            className="event-feed-filter-input"
            type="text"
            value={sourceFilter}
            placeholder="Source"
            onChange={(event) => setSourceFilter(event.currentTarget.value)}
          />
          <label className="event-feed-sr-only" htmlFor="environment-filter">
            {"Environment"}
          </label>
          <input
            id="environment-filter"
            className="event-feed-filter-input"
            type="text"
            value={environmentFilter}
            placeholder="Environment"
            onChange={(event) =>
              setEnvironmentFilter(event.currentTarget.value)
            }
          />
          <label className="event-feed-sr-only" htmlFor="severity-filter">
            {"Severity"}
          </label>
          <select
            id="severity-filter"
            className="event-feed-filter-select"
            value={severityFilter}
            onChange={(event) =>
              setSeverityFilter(
                event.currentTarget.value as typeof severityFilter,
              )
            }
          >
            <option value="">{"Severity"}</option>
            <option value="info">{"info"}</option>
            <option value="warning">{"warning"}</option>
            <option value="critical">{"critical"}</option>
          </select>
          <label className="event-feed-sr-only" htmlFor="status-filter">
            {"Status"}
          </label>
          <select
            id="status-filter"
            className="event-feed-filter-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.currentTarget.value as typeof statusFilter)
            }
          >
            <option value="">{"Status"}</option>
            {TIMELINE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`event-feed-filter-chip${pinnedOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            {"Pinned"}
          </button>
          <button
            type="button"
            className={`event-feed-filter-chip${activeOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={activeOnly}
            onClick={() => setActiveOnly((value) => !value)}
          >
            {"Active"}
          </button>
          <button
            type="button"
            className={`event-feed-filter-chip${unreadOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((value) => !value)}
          >
            {"Unread"}
          </button>
        </div>
      )}
    </div>
  );
}
