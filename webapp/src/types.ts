export interface EventLink {
  url: string;
  label?: string;
}

export interface ReactionClientSummary {
  count: number;
  self: boolean;
  recent_users: string[];
}

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
  client_reactions?: Record<string, ReactionClientSummary>;
  channels?: string[];
}

export interface EventFeedState {
  events: EventEntry[];
  isLoading: boolean;
  error: string | null;
  total: number;
  newEventIds: string[];
  updatedEventIds: string[];
  timelineOrder: "oldest_first" | "newest_first";
  enableReactions: boolean;
  currentUserId: string;
}

export interface NewEventWebSocketMessage {
  data: { event: string };
}
