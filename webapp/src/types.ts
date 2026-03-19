export interface EventLink {
  url: string;
  label?: string;
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
}

export interface EventFeedState {
  events: EventEntry[];
  isLoading: boolean;
  error: string | null;
  total: number;
  newEventIds: string[];
  updatedEventIds: string[];
  timelineOrder: "oldest_first" | "newest_first";
}

export interface NewEventWebSocketMessage {
  data: { event: string };
}
