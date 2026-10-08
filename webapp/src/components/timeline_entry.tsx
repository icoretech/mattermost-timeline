import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  GitPullRequest,
  Info,
  MapPin,
  MessageSquare,
  Rocket,
  ShieldAlert,
  Siren,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
  XCircle,
} from "lucide-react";
import React, { useCallback } from "react";
import type { TimestampDisplayPreferences } from "../selectors";
import type { EventEntry, EventLink, TimelineUser } from "../types/timeline";
import { CustomFields } from "./custom_fields";
import ReactionBar from "./reaction_bar";
import {
  formatTimestamp,
  formatTimestampTooltip,
  isSafeUrl,
  isTimelineEventExpired,
  TimelineMarkdown,
} from "./timeline_entry_helpers";

interface Props {
  event: EventEntry;
  isNew: boolean;
  isUpdated: boolean;
  onAnimationEnd: (eventId: string) => void;
  onUpdateAnimationEnd: (eventId: string) => void;
  enableReactions: boolean;
  timestampDisplayPreferences: TimestampDisplayPreferences;
  onAddReaction: (eventId: string, icon: string) => void;
  onRemoveReaction: (eventId: string, icon: string) => void;
  onFetchReactionUsers: (eventId: string, icon: string) => Promise<string[]>;
  getUser: (userId: string) => TimelineUser | undefined;
}

const ICON_SIZE = 18;

const EVENT_TYPE_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  host_online: { icon: CircleCheck, color: "#2dc26b" },
  host_offline: { icon: CircleX, color: "#e03131" },
  deploy: { icon: Rocket, color: "#1c7ed6" },
  alert: { icon: AlertTriangle, color: "#f59f00" },
  error: { icon: XCircle, color: "#e03131" },
  info: { icon: Info, color: "#1c7ed6" },
  success: { icon: CircleDot, color: "#2dc26b" },
  money_in: { icon: TrendingUp, color: "#2dc26b" },
  money_out: { icon: TrendingDown, color: "#e03131" },
  security: { icon: ShieldAlert, color: "#f59f00" },
  incident: { icon: Siren, color: "#e03131" },
  user_joined: { icon: UserPlus, color: "#2dc26b" },
  user_left: { icon: UserMinus, color: "#868e96" },
  scheduled: { icon: CalendarClock, color: "#868e96" },
  review: { icon: GitPullRequest, color: "#9c36b5" },
  message: { icon: MessageSquare, color: "#1c7ed6" },
  generic: { icon: MapPin, color: "#868e96" },
};

function timelineMetadataItems(event: EventEntry) {
  const items: string[] = [];

  if (event.severity && event.severity !== "info") items.push(event.severity);
  if (event.status && event.status !== "success") items.push(event.status);
  if (event.environment) items.push(event.environment);
  if (event.pinned) items.push("pinned");
  if (isTimelineEventExpired(event)) items.push("expired");
  if (event.resolved_at && event.status !== "resolved") items.push("resolved");

  return items;
}

function timelineMetadataTitle(event: EventEntry) {
  const parts: string[] = [];
  if (event.source) parts.push(`source: ${event.source}`);
  if (event.severity) parts.push(`severity: ${event.severity}`);
  if (event.status) parts.push(`status: ${event.status}`);
  if (event.environment) parts.push(`environment: ${event.environment}`);
  if (event.pinned) parts.push("pinned");
  if (isTimelineEventExpired(event)) parts.push("expired");
  if (event.resolved_at && event.status !== "resolved") parts.push("resolved");
  return parts.join(" · ");
}

const HIGHLIGHTED_METADATA_ITEMS: Record<string, true> = {
  critical: true,
  warning: true,
  open: true,
  running: true,
  failed: true,
  pinned: true,
  expired: true,
};

function timelineMetadataClassName(item: string) {
  return HIGHLIGHTED_METADATA_ITEMS[item]
    ? `timeline-entry__meta-item timeline-entry__meta-item--${item}`
    : "timeline-entry__meta-item";
}

const TimelineEntry: React.FC<Props> = ({
  event,
  isNew,
  isUpdated,
  onAnimationEnd,
  onUpdateAnimationEnd,
  enableReactions,
  timestampDisplayPreferences,
  onAddReaction,
  onRemoveReaction,
  onFetchReactionUsers,
  getUser,
}) => {
  const config =
    EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.generic;
  const IconComponent = config.icon;

  const handleAnimationEnd = useCallback(() => {
    if (isNew) {
      onAnimationEnd(event.id);
    } else if (isUpdated) {
      onUpdateAnimationEnd(event.id);
    }
  }, [onAnimationEnd, onUpdateAnimationEnd, event.id, isNew, isUpdated]);

  let className = "timeline-entry";
  if (isNew) className += " timeline-entry--new";
  else if (isUpdated) className += " timeline-entry--updated";

  const links: EventLink[] =
    event.links && event.links.length > 0
      ? event.links
      : event.link
        ? [{ url: event.link }]
        : [];

  const metadataItems = timelineMetadataItems(event);
  const metadataTitle = timelineMetadataTitle(event);
  const eventTypeLabel = event.event_type.replace(/_/g, " ");
  const eventTypeTitle = event.source
    ? `${eventTypeLabel} · source: ${event.source}`
    : eventTypeLabel;

  return (
    <div
      className={className}
      onAnimationEnd={isNew || isUpdated ? handleAnimationEnd : undefined}
    >
      <div className="timeline-entry__gutter">
        <div className="timeline-entry__dot">
          <IconComponent
            size={ICON_SIZE}
            color={config.color}
            strokeWidth={2}
          />
        </div>
        <div
          className="timeline-entry__connector"
          style={{ borderColor: config.color }}
        />
      </div>
      <div className="timeline-entry__content">
        <div className="timeline-entry__header">
          <span
            className="timeline-entry__type"
            style={{ color: config.color }}
            title={eventTypeTitle}
          >
            {eventTypeLabel}
          </span>
          <span
            className="timeline-entry__time"
            title={formatTimestampTooltip(
              event.timestamp,
              timestampDisplayPreferences,
            )}
          >
            {formatTimestamp(event.timestamp, timestampDisplayPreferences)}
          </span>
        </div>
        {metadataItems.length > 0 && (
          <div className="timeline-entry__meta" title={metadataTitle}>
            {metadataItems.map((item) => (
              <span key={item} className={timelineMetadataClassName(item)}>
                {item}
              </span>
            ))}
          </div>
        )}
        <div className="timeline-entry__title">{event.title}</div>
        {event.message && (
          <div className="timeline-entry__message">
            <TimelineMarkdown text={event.message} />
          </div>
        )}
        <CustomFields fields={event.custom_fields} />
        {links.length > 0 && (
          <div className="timeline-entry__links">
            {links.map((l: EventLink) =>
              isSafeUrl(l.url) ? (
                <a
                  key={l.url}
                  className="timeline-entry__link-icon"
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.label || l.url}
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  <span>{l.label || "Link"}</span>
                </a>
              ) : (
                <span
                  key={l.url}
                  className="timeline-entry__link-icon"
                  title={l.label || l.url}
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  <span>{l.label || "Link"}</span>
                </span>
              ),
            )}
          </div>
        )}
        {enableReactions && (
          <ReactionBar
            reactions={event.client_reactions}
            onAddReaction={(icon) => onAddReaction(event.id, icon)}
            onRemoveReaction={(icon) => onRemoveReaction(event.id, icon)}
            onFetchUsers={(icon) => onFetchReactionUsers(event.id, icon)}
            getUser={getUser}
          />
        )}
      </div>
    </div>
  );
};

export default TimelineEntry;
