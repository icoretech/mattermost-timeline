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
import { type MessageKey, useMessages } from "../i18n";
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
const EVENT_TYPE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  host_online: "eventType.host_online",
  host_offline: "eventType.host_offline",
  deploy: "eventType.deploy",
  alert: "eventType.alert",
  error: "eventType.error",
  info: "eventType.info",
  success: "eventType.success",
  money_in: "eventType.money_in",
  money_out: "eventType.money_out",
  security: "eventType.security",
  incident: "eventType.incident",
  user_joined: "eventType.user_joined",
  user_left: "eventType.user_left",
  scheduled: "eventType.scheduled",
  review: "eventType.review",
  message: "eventType.message",
  generic: "eventType.generic",
};

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

function timelineMetadataItems(
  event: EventEntry,
  t: ReturnType<typeof useMessages>["t"],
) {
  const items: { key: string; label: string }[] = [];

  if (event.severity && event.severity !== "info")
    items.push({ key: event.severity, label: t(`severity.${event.severity}`) });
  if (event.status && event.status !== "success")
    items.push({ key: event.status, label: t(`status.${event.status}`) });
  if (event.environment)
    items.push({ key: "environment", label: event.environment });
  if (event.pinned) items.push({ key: "pinned", label: t("timeline.pinned") });
  if (isTimelineEventExpired(event))
    items.push({ key: "expired", label: t("timeline.expired") });
  if (event.resolved_at && event.status !== "resolved")
    items.push({ key: "resolved", label: t("status.resolved") });

  return items;
}

function timelineMetadataTitle(
  event: EventEntry,
  t: ReturnType<typeof useMessages>["t"],
) {
  const parts: string[] = [];
  if (event.source)
    parts.push(t("timeline.sourceValue", { value: event.source }));
  if (event.severity)
    parts.push(
      t("timeline.severityValue", { value: t(`severity.${event.severity}`) }),
    );
  if (event.status)
    parts.push(
      t("timeline.statusValue", { value: t(`status.${event.status}`) }),
    );
  if (event.environment)
    parts.push(t("timeline.environmentValue", { value: event.environment }));
  if (event.pinned) parts.push(t("timeline.pinned"));
  if (isTimelineEventExpired(event)) parts.push(t("timeline.expired"));
  if (event.resolved_at && event.status !== "resolved")
    parts.push(t("status.resolved"));
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
  const { t } = useMessages();
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

  const metadataItems = timelineMetadataItems(event, t);
  const metadataTitle = timelineMetadataTitle(event, t);
  const eventTypeKey = EVENT_TYPE_MESSAGES[event.event_type];
  const eventTypeLabel = eventTypeKey
    ? t(eventTypeKey)
    : event.event_type.replace(/_/g, " ");
  const eventTypeTitle = event.source
    ? `${eventTypeLabel} · ${t("timeline.sourceValue", { value: event.source })}`
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
              <span
                key={item.key}
                className={timelineMetadataClassName(item.key)}
              >
                {item.label}
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
                  <span>{l.label || t("timeline.link")}</span>
                </a>
              ) : (
                <span
                  key={l.url}
                  className="timeline-entry__link-icon"
                  title={l.label || l.url}
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  <span>{l.label || t("timeline.link")}</span>
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
