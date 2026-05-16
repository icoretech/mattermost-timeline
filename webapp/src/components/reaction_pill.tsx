import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactionClientSummary, TimelineUser } from "../types/timeline";
import { REACTION_ICON_BY_NAME } from "./reactions";

const TOOLTIP_CACHE_TTL_MS = 30000;

function buildAvatarImageUrl(
  userId: string,
  lastPictureUpdate?: number,
): string {
  const baseUrl = `/api/v4/users/${userId}/image`;
  return lastPictureUpdate ? `${baseUrl}?_=${lastPictureUpdate}` : baseUrl;
}

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
  const [tooltipError, setTooltipError] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const cacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (cacheTimerRef.current) {
        clearTimeout(cacheTimerRef.current);
      }
    };
  }, []);

  const handleClick = useCallback(() => {
    onToggle(icon);
  }, [icon, onToggle]);

  const handleMouseEnter = useCallback(async () => {
    setShowTooltip(true);
    if (!tooltipUsers) {
      const requestSeq = ++requestSeqRef.current;
      setTooltipError(false);
      let users: string[];
      try {
        users = await onFetchUsers(icon);
      } catch {
        users = [];
        if (mountedRef.current && requestSeq === requestSeqRef.current) {
          setTooltipError(true);
        }
      }
      if (!mountedRef.current || requestSeq !== requestSeqRef.current) {
        return;
      }
      setTooltipUsers(users);
      if (cacheTimerRef.current) {
        clearTimeout(cacheTimerRef.current);
      }
      cacheTimerRef.current = setTimeout(() => {
        setTooltipUsers(null);
        setTooltipError(false);
        cacheTimerRef.current = null;
      }, TOOLTIP_CACHE_TTL_MS);
    }
  }, [icon, onFetchUsers, tooltipUsers]);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  const IconComponent = REACTION_ICON_BY_NAME[icon];
  if (!IconComponent) return null;

  const avatars = summary.recent_users.map((uid) => {
    const user = getUser(uid);
    const imageUrl = buildAvatarImageUrl(uid, user?.last_picture_update);
    return { uid, imageUrl, label: user?.username || uid };
  });

  const tooltipText = tooltipError
    ? "Unable to load users"
    : tooltipUsers
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
              <img
                src={a.imageUrl}
                alt={a.label}
                className="reaction-pill__avatar-img"
              />
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
