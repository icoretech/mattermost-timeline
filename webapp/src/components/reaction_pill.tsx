import {
  CircleCheckBig,
  Eye,
  Hand,
  Heart,
  type LucideIcon,
  Megaphone,
  PartyPopper,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import type { ReactionClientSummary, TimelineUser } from "../types";

const ICON_MAP: Record<string, LucideIcon> = {
  eyes: Eye,
  wrench: Wrench,
  check: CircleCheckBig,
  megaphone: Megaphone,
  "thumbs-up": ThumbsUp,
  hand: Hand,
  party: PartyPopper,
  heart: Heart,
};

const TOOLTIP_CACHE_TTL_MS = 30000;

interface Props {
  icon: string;
  summary: ReactionClientSummary;
  onToggle: (icon: string) => void;
  onFetchUsers: (icon: string) => Promise<string[]>;
  getUser: (userId: string) => TimelineUser | undefined;
}

export default function ReactionPill({
  icon,
  summary,
  onToggle,
  onFetchUsers,
  getUser,
}: Props) {
  const [tooltipUsers, setTooltipUsers] = useState<string[] | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const cacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    onToggle(icon);
  }, [icon, onToggle]);

  const handleMouseEnter = useCallback(async () => {
    setShowTooltip(true);
    if (!tooltipUsers) {
      const users = await onFetchUsers(icon);
      setTooltipUsers(users);
      if (cacheTimerRef.current) {
        clearTimeout(cacheTimerRef.current);
      }
      cacheTimerRef.current = setTimeout(() => {
        setTooltipUsers(null);
        cacheTimerRef.current = null;
      }, TOOLTIP_CACHE_TTL_MS);
    }
  }, [icon, onFetchUsers, tooltipUsers]);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  const IconComponent = ICON_MAP[icon];
  if (!IconComponent) return null;

  const avatars = summary.recent_users.map((uid) => {
    const user = getUser(uid);
    const initial = user?.username?.[0]?.toUpperCase() || "?";
    const imageUrl = user?.last_picture_update
      ? `/api/v4/users/${uid}/image?_=${user.last_picture_update}`
      : user?.avatar_url || null;
    return { uid, initial, imageUrl };
  });

  const tooltipText = tooltipUsers
    ? tooltipUsers.map((uid) => getUser(uid)?.username || uid).join(", ")
    : "Loading...";

  return (
    <button
      type="button"
      className={`reaction-pill ${summary.self ? "reaction-pill--active" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={showTooltip ? tooltipText : undefined}
    >
      <IconComponent size={14} />
      <span className="reaction-pill__count">{summary.count}</span>
      {avatars.length > 0 && (
        <span className="reaction-pill__avatars">
          {avatars.map((a) => (
            <span key={a.uid} className="reaction-pill__avatar">
              {a.imageUrl ? (
                <img
                  src={a.imageUrl}
                  alt={a.initial}
                  className="reaction-pill__avatar-img"
                />
              ) : (
                a.initial
              )}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
