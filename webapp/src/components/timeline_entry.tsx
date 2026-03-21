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
import type { EventEntry, EventLink, TimelineUser } from "../types";
import ReactionBar from "./reaction_bar";

interface Props {
  event: EventEntry;
  isNew: boolean;
  isUpdated: boolean;
  onAnimationEnd: (eventId: string) => void;
  onUpdateAnimationEnd: (eventId: string) => void;
  enableReactions: boolean;
  onAddReaction: (eventId: string, icon: string) => void;
  onRemoveReaction: (eventId: string, icon: string) => void;
  onFetchReactionUsers: (eventId: string, icon: string) => Promise<string[]>;
  getUser: (userId: string) => TimelineUser | undefined;
}

const ICON_SIZE = 18;
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

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

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) {
    return time;
  }

  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return `${dateStr} ${time}`;
}

function isSafeUrl(url: string): boolean {
  const trimmedUrl = url.trim();
  const schemeMatch = trimmedUrl.match(/^([a-zA-Z][a-zA-Z\d+\-.]*:)/);

  if (!schemeMatch) {
    return true;
  }

  return SAFE_URL_PROTOCOLS.has(schemeMatch[1].toLowerCase());
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Links: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      if (isSafeUrl(linkMatch[2])) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="timeline-entry__md-link"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="timeline-entry__md-code">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Newline
    if (remaining[0] === "\n") {
      parts.push(<br key={key++} />);
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text — consume until next special character
    const nextSpecial = remaining.slice(1).search(/[[*`\n]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    }
    parts.push(remaining.slice(0, nextSpecial + 1));
    remaining = remaining.slice(nextSpecial + 1);
  }

  return parts;
}

const TimelineEntry: React.FC<Props> = ({
  event,
  isNew,
  isUpdated,
  onAnimationEnd,
  onUpdateAnimationEnd,
  enableReactions,
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

  // Normalize: prefer links array, fall back to single link
  const links: EventLink[] =
    event.links && event.links.length > 0
      ? event.links
      : event.link
        ? [{ url: event.link }]
        : [];

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
          <span className="timeline-entry__header-left">
            <span
              className="timeline-entry__type"
              style={{ color: config.color }}
            >
              {event.event_type.replace(/_/g, " ")}
            </span>
            {event.source && (
              <span className="timeline-entry__source">
                {`via ${event.source}`}
              </span>
            )}
          </span>
          <span
            className="timeline-entry__time"
            title={new Date(event.timestamp).toLocaleString()}
          >
            {formatTime(event.timestamp)}
          </span>
        </div>
        <div className="timeline-entry__title">{event.title}</div>
        {event.message && (
          <div className="timeline-entry__message">
            {renderMarkdown(event.message)}
          </div>
        )}
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
