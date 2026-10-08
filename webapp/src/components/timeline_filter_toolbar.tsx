import React from "react";
import { useMessages } from "../i18n";

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
  const { t } = useMessages();
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
        {t("timeline.searchLabel")}
      </label>
      <input
        id="event-feed-search"
        className="event-feed-search"
        type="search"
        value={searchQuery}
        placeholder={t("timeline.searchPlaceholder")}
        aria-label={t("timeline.searchLabel")}
        onChange={(event) => setSearchQuery(event.currentTarget.value)}
      />
      <button
        type="button"
        className="event-feed-filter-toggle"
        aria-expanded={filtersOpen}
        aria-controls="event-feed-filter-panel"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {t("timeline.filters")}
      </button>
      {filtersOpen && (
        <div id="event-feed-filter-panel" className="event-feed-filters">
          <label className="event-feed-sr-only" htmlFor="event-type-filter">
            {t("timeline.eventType")}
          </label>
          <input
            id="event-type-filter"
            className="event-feed-filter-input"
            type="text"
            value={eventTypeFilter}
            placeholder={t("timeline.eventType")}
            onChange={(event) => setEventTypeFilter(event.currentTarget.value)}
          />
          <label className="event-feed-sr-only" htmlFor="source-filter">
            {t("timeline.source")}
          </label>
          <input
            id="source-filter"
            className="event-feed-filter-input"
            type="text"
            value={sourceFilter}
            placeholder={t("timeline.source")}
            onChange={(event) => setSourceFilter(event.currentTarget.value)}
          />
          <label className="event-feed-sr-only" htmlFor="environment-filter">
            {t("timeline.environment")}
          </label>
          <input
            id="environment-filter"
            className="event-feed-filter-input"
            type="text"
            value={environmentFilter}
            placeholder={t("timeline.environment")}
            onChange={(event) =>
              setEnvironmentFilter(event.currentTarget.value)
            }
          />
          <label className="event-feed-sr-only" htmlFor="severity-filter">
            {t("timeline.severity")}
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
            <option value="">{t("timeline.severity")}</option>
            <option value="info">{t("severity.info")}</option>
            <option value="warning">{t("severity.warning")}</option>
            <option value="critical">{t("severity.critical")}</option>
          </select>
          <label className="event-feed-sr-only" htmlFor="status-filter">
            {t("timeline.status")}
          </label>
          <select
            id="status-filter"
            className="event-feed-filter-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.currentTarget.value as typeof statusFilter)
            }
          >
            <option value="">{t("timeline.status")}</option>
            {TIMELINE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`event-feed-filter-chip${pinnedOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            {t("timeline.pinnedFilter")}
          </button>
          <button
            type="button"
            className={`event-feed-filter-chip${activeOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={activeOnly}
            onClick={() => setActiveOnly((value) => !value)}
          >
            {t("timeline.active")}
          </button>
          <button
            type="button"
            className={`event-feed-filter-chip${unreadOnly ? " event-feed-filter-chip--active" : ""}`}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((value) => !value)}
          >
            {t("timeline.unread")}
          </button>
        </div>
      )}
    </div>
  );
}
