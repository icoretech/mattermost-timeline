import type { BaseWebSocketMessage } from "@mattermost/client";
import type { UserProfile } from "@mattermost/types/users";

export interface EventLink {
  url: string;
  label?: string;
}

export type EventCustomField = {
  readonly name: string;
  readonly label?: string;
} & (
  | { readonly type?: "string"; readonly value: string }
  | { readonly type?: "number"; readonly value: number }
  | { readonly type?: "boolean"; readonly value: boolean }
);

export interface ReactionClientSummary {
  count: number;
  self: boolean;
  recent_users: string[];
}

export const TIMELINE_SEVERITIES = ["info", "warning", "critical"] as const;
export const TIMELINE_STATUSES = [
  "open",
  "running",
  "success",
  "failed",
  "resolved",
  "closed",
] as const;

export type TimelineSeverity = (typeof TIMELINE_SEVERITIES)[number];
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];

export interface EventEntry {
  id: string;
  team_id: string;
  timestamp: number;
  title: string;
  message?: string;
  link?: string;
  links?: EventLink[];
  event_type: string;
  source?: string;
  external_id?: string;
  severity?: TimelineSeverity;
  status?: TimelineStatus;
  environment?: string;
  expires_at?: number;
  pinned?: boolean;
  resolved_at?: number;
  custom_fields?: readonly EventCustomField[];
  client_reactions?: Record<string, ReactionClientSummary>;
  channels?: string[];
}

export type TimelineReadState = {
  version: number;
  context_read_at: Record<string, number>;
  seen_events: Record<string, number>;
};

export type TimelineUnreadState = Record<string, string[]>;

export interface EventFeedState {
  events: EventEntry[];
  isLoading: boolean;
  error: string | null;
  total: number;
  newEventIds: string[];
  updatedEventIds: string[];
  websocketRevision?: number;
  unreadEventIdsByContext: TimelineUnreadState;
  timelineOrder: "oldest_first" | "newest_first";
  enableReactions: boolean;
  currentUserId: string;
  viewTeamId: string;
  viewChannelId: string;
}

export type HydratableEventFeedState = Omit<
  EventFeedState,
  "unreadEventIdsByContext"
> & {
  unreadEventIdsByContext?: TimelineUnreadState;
};

export type TimelineUser = Pick<
  UserProfile,
  "username" | "last_picture_update"
> & {
  avatar_url?: string;
};

export type PluginWebSocketMessage<T> = BaseWebSocketMessage<string, T>;

export type NewEventWebSocketMessage = PluginWebSocketMessage<{
  event: string;
}>;

export type ReactionUpdatedWebSocketMessage = PluginWebSocketMessage<{
  payload: string;
}>;
