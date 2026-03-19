export interface EventEntry {
  id: string;
  team_id: string;
  timestamp: number;
  title: string;
  message?: string;
  link?: string;
  event_type: string;
  source?: string;
}

export interface EventFeedState {
  events: EventEntry[];
  isLoading: boolean;
  error: string | null;
  total: number;
  newEventIds: string[];
  timelineOrder: "oldest_first" | "newest_first";
}

export interface NewEventWebSocketMessage {
  data: { event: string };
}
