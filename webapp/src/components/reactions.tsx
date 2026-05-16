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
import reactionContract from "./reactions.json";

export type ReactionDefinition = {
  icon: string;
  Icon: LucideIcon;
  label: string;
};

const REACTION_ICON_COMPONENTS: Record<string, LucideIcon> = {
  eyes: Eye,
  wrench: Wrench,
  check: CircleCheckBig,
  megaphone: Megaphone,
  "thumbs-up": ThumbsUp,
  hand: Hand,
  party: PartyPopper,
  heart: Heart,
};

function iconComponentFor(icon: string): LucideIcon {
  const Icon = REACTION_ICON_COMPONENTS[icon];
  if (!Icon) {
    throw new Error(`Missing icon component for reaction: ${icon}`);
  }
  return Icon;
}

export const REACTIONS: ReactionDefinition[] = reactionContract.map(
  (reaction) => ({
    ...reaction,
    Icon: iconComponentFor(reaction.icon),
  }),
);

export const REACTION_ICON_BY_NAME = REACTIONS.reduce<
  Record<string, LucideIcon>
>((icons, reaction) => {
  icons[reaction.icon] = reaction.Icon;
  return icons;
}, {});
