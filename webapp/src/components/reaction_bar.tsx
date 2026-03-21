import {
  CircleCheckBig,
  Eye,
  Hand,
  Heart,
  Megaphone,
  PartyPopper,
  SmilePlus,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactionClientSummary, TimelineUser } from "../types";
import ReactionPill from "./reaction_pill";

const REACTIONS = [
  { icon: "eyes", Icon: Eye, label: "I've seen this" },
  { icon: "wrench", Icon: Wrench, label: "Working on it" },
  { icon: "check", Icon: CircleCheckBig, label: "Handled" },
  { icon: "megaphone", Icon: Megaphone, label: "Needs attention" },
  { icon: "thumbs-up", Icon: ThumbsUp, label: "Acknowledged" },
  { icon: "hand", Icon: Hand, label: "I'll take this" },
  { icon: "party", Icon: PartyPopper, label: "Celebrate" },
  { icon: "heart", Icon: Heart, label: "Appreciate" },
];

interface Props {
  reactions?: Record<string, ReactionClientSummary>;
  onAddReaction: (icon: string) => void;
  onRemoveReaction: (icon: string) => void;
  onFetchUsers: (icon: string) => Promise<string[]>;
  getUser: (userId: string) => TimelineUser | undefined;
}

export default function ReactionBar({
  reactions,
  onAddReaction,
  onRemoveReaction,
  onFetchUsers,
  getUser,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(
    (icon: string) => {
      const existing = reactions?.[icon];
      if (existing?.self) {
        onRemoveReaction(icon);
      } else {
        onAddReaction(icon);
      }
    },
    [reactions, onAddReaction, onRemoveReaction],
  );

  const handlePickerSelect = useCallback(
    (icon: string) => {
      setPickerOpen(false);
      const existing = reactions?.[icon];
      if (existing?.self) {
        onRemoveReaction(icon);
      } else {
        onAddReaction(icon);
      }
    },
    [reactions, onAddReaction, onRemoveReaction],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  const reactionEntries = reactions
    ? Object.entries(reactions).filter(([, s]) => s.count > 0)
    : [];

  return (
    <div className="reaction-bar" ref={barRef}>
      <button
        type="button"
        className={`reaction-bar__toggle ${pickerOpen ? "reaction-bar__toggle--active" : ""}`}
        onClick={() => setPickerOpen(!pickerOpen)}
        title={pickerOpen ? "Close" : "Add reaction"}
      >
        {pickerOpen ? <X size={14} /> : <SmilePlus size={14} />}
      </button>
      <div
        className={`reaction-bar__tray ${pickerOpen ? "reaction-bar__tray--open" : ""}`}
      >
        {REACTIONS.map(({ icon, Icon, label }) => (
          <button
            type="button"
            key={icon}
            className="reaction-bar__tray-btn"
            title={label}
            onClick={() => handlePickerSelect(icon)}
            tabIndex={pickerOpen ? 0 : -1}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      {reactionEntries.map(([icon, summary]) => (
        <ReactionPill
          key={icon}
          icon={icon}
          summary={summary}
          onToggle={handleToggle}
          onFetchUsers={onFetchUsers}
          getUser={getUser}
        />
      ))}
    </div>
  );
}
