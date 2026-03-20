import {
  CircleCheckBig,
  Eye,
  Hand,
  Heart,
  Megaphone,
  PartyPopper,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import React, { useEffect, useRef } from "react";

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
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export default function ReactionPicker({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="reaction-picker" ref={ref}>
      {REACTIONS.map(({ icon, Icon, label }) => (
        <button
          type="button"
          key={icon}
          className="reaction-picker__btn"
          title={label}
          onClick={() => onSelect(icon)}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
