import { SmilePlus } from "lucide-react";
import React, { useCallback, useState } from "react";
import type { ReactionClientSummary } from "../types";
import ReactionPicker from "./reaction_picker";
import ReactionPill from "./reaction_pill";

interface Props {
  reactions?: Record<string, ReactionClientSummary>;
  onAddReaction: (icon: string) => void;
  onRemoveReaction: (icon: string) => void;
  onFetchUsers: (icon: string) => Promise<string[]>;
  // biome-ignore lint/suspicious/noExplicitAny: Mattermost user profile shape
  getUser: (userId: string) => any;
}

export default function ReactionBar({
  reactions,
  onAddReaction,
  onRemoveReaction,
  onFetchUsers,
  getUser,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const reactionEntries = reactions
    ? Object.entries(reactions).filter(([, s]) => s.count > 0)
    : [];

  return (
    <div className="reaction-bar">
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
      <div className="reaction-bar__add-wrapper">
        <button
          type="button"
          className="reaction-bar__add-btn"
          onClick={() => setPickerOpen(!pickerOpen)}
          title="Add reaction"
        >
          <SmilePlus size={14} />
        </button>
        {pickerOpen && (
          <ReactionPicker
            onSelect={handlePickerSelect}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
