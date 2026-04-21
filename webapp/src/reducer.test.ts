import type { EventFeedAction } from "./actions";
import {
  CLEAR_EVENTS,
  CLEAR_NEW_EVENT_FLAG,
  HYDRATE_POPOUT_STATE,
  OPTIMISTIC_REACTION,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  SET_ERROR,
  SET_LOADING,
} from "./actions";
import reducer from "./reducer";
import type { EventEntry } from "./types";

function makeEvent(overrides: Partial<EventEntry> = {}): EventEntry {
  return {
    id: "e1",
    team_id: "t1",
    timestamp: 1000,
    title: "Test",
    event_type: "info",
    ...overrides,
  };
}

describe("reducer", () => {
  const initial = reducer(undefined, {
    type: "@@INIT",
  } as unknown as EventFeedAction);

  it("returns initial state", () => {
    expect(initial).toEqual({
      events: [],
      isLoading: false,
      error: null,
      total: 0,
      newEventIds: [],
      updatedEventIds: [],
      timelineOrder: "oldest_first",
      enableReactions: true,
      currentUserId: "",
      viewTeamId: "",
      viewChannelId: "",
    });
  });

  it("hydrates popout state and context", () => {
    const state = reducer(initial, {
      type: HYDRATE_POPOUT_STATE,
      teamId: "team123",
      channelId: "channel123",
      hydratedState: {
        events: [makeEvent({ id: "e2" })],
        isLoading: false,
        error: null,
        total: 1,
        newEventIds: ["e2"],
        updatedEventIds: [],
        timelineOrder: "newest_first",
        enableReactions: false,
        currentUserId: "user123",
        viewTeamId: "",
        viewChannelId: "",
      },
    } as EventFeedAction);

    expect(state.events[0].id).toBe("e2");
    expect(state.timelineOrder).toBe("newest_first");
    expect(state.enableReactions).toBe(false);
    expect(state.currentUserId).toBe("user123");
    expect(state.viewTeamId).toBe("team123");
    expect(state.viewChannelId).toBe("channel123");
  });

  describe("events", () => {
    it("replaces events on RECEIVED_EVENTS with append=false", () => {
      const action: EventFeedAction = {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e1" }), makeEvent({ id: "e2" })],
        total: 5,
        append: false,
      };
      const state = reducer(initial, action);
      expect(state.events).toHaveLength(2);
      expect(state.events[0].id).toBe("e1");
    });

    it("appends events on RECEIVED_EVENTS with append=true", () => {
      const existing = reducer(initial, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e1" })],
        total: 2,
        append: false,
      });
      const state = reducer(existing, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e2" })],
        total: 2,
        append: true,
      });
      expect(state.events).toHaveLength(2);
      expect(state.events[0].id).toBe("e1");
      expect(state.events[1].id).toBe("e2");
    });

    it("prepends new event on RECEIVED_NEW_EVENT", () => {
      const existing = reducer(initial, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e1" })],
        total: 1,
        append: false,
      });
      const state = reducer(existing, {
        type: RECEIVED_NEW_EVENT,
        event: makeEvent({ id: "e2" }),
      });
      expect(state.events[0].id).toBe("e2");
      expect(state.events[1].id).toBe("e1");
    });

    it("deduplicates on RECEIVED_NEW_EVENT", () => {
      const existing = reducer(initial, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e1" })],
        total: 1,
        append: false,
      });
      const state = reducer(existing, {
        type: RECEIVED_NEW_EVENT,
        event: makeEvent({ id: "e1" }),
      });
      expect(state.events).toHaveLength(1);
    });
  });

  describe("isLoading", () => {
    it("sets loading on SET_LOADING", () => {
      const state = reducer(initial, { type: SET_LOADING, loading: true });
      expect(state.isLoading).toBe(true);
    });

    it("clears loading on SET_LOADING false", () => {
      const loading = reducer(initial, { type: SET_LOADING, loading: true });
      const state = reducer(loading, { type: SET_LOADING, loading: false });
      expect(state.isLoading).toBe(false);
    });
  });

  describe("total", () => {
    it("updates on RECEIVED_EVENTS", () => {
      const state = reducer(initial, {
        type: RECEIVED_EVENTS,
        events: [],
        total: 42,
        append: false,
      });
      expect(state.total).toBe(42);
    });

    it("increments on RECEIVED_NEW_EVENT", () => {
      const state = reducer(initial, {
        type: RECEIVED_NEW_EVENT,
        event: makeEvent(),
      });
      expect(state.total).toBe(1);
    });
  });

  describe("newEventIds", () => {
    it("tracks new event ids", () => {
      const state = reducer(initial, {
        type: RECEIVED_NEW_EVENT,
        event: makeEvent({ id: "e1" }),
      });
      expect(state.newEventIds).toContain("e1");
    });

    it("clears event id on CLEAR_NEW_EVENT_FLAG", () => {
      const withNew = reducer(initial, {
        type: RECEIVED_NEW_EVENT,
        event: makeEvent({ id: "e1" }),
      });
      const state = reducer(withNew, {
        type: CLEAR_NEW_EVENT_FLAG,
        eventId: "e1",
      });
      expect(state.newEventIds).not.toContain("e1");
    });
  });

  describe("error", () => {
    it("sets error on SET_ERROR", () => {
      const state = reducer(initial, { type: SET_ERROR, error: "fail" });
      expect(state.error).toBe("fail");
    });

    it("clears error on RECEIVED_EVENTS", () => {
      const withError = reducer(initial, { type: SET_ERROR, error: "fail" });
      const state = reducer(withError, {
        type: RECEIVED_EVENTS,
        events: [],
        total: 0,
        append: false,
      });
      expect(state.error).toBeNull();
    });
  });

  describe("CLEAR_EVENTS", () => {
    it("resets events, total, and error", () => {
      const stateWithEvents = reducer(undefined, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "1" })],
        total: 1,
        timelineOrder: "oldest_first",
        enableReactions: true,
      } as EventFeedAction);
      const cleared = reducer(stateWithEvents, {
        type: CLEAR_EVENTS,
      } as unknown as EventFeedAction);
      expect(cleared.events).toEqual([]);
      expect(cleared.total).toBe(0);
      expect(cleared.error).toBeNull();
    });
  });

  describe("OPTIMISTIC_REACTION", () => {
    it("optimistically adds a reaction", () => {
      const stateWithEvent = reducer(undefined, {
        type: RECEIVED_EVENTS,
        events: [makeEvent({ id: "e1" })],
        total: 1,
        append: false,
      } as EventFeedAction);
      const state = reducer(stateWithEvent, {
        type: OPTIMISTIC_REACTION,
        event_id: "e1",
        icon: "eyes",
        optimisticAction: "add",
      } as unknown as EventFeedAction);
      expect(state.events[0].client_reactions?.eyes?.count).toBe(1);
      expect(state.events[0].client_reactions?.eyes?.self).toBe(true);
    });

    it("optimistically removes a reaction", () => {
      const stateWithEvent = reducer(undefined, {
        type: RECEIVED_EVENTS,
        events: [
          {
            ...makeEvent({ id: "e1" }),
            client_reactions: {
              eyes: { count: 2, self: true, recent_users: ["u1", "u2"] },
            },
          },
        ],
        total: 1,
        append: false,
      } as EventFeedAction);
      const state = reducer(stateWithEvent, {
        type: OPTIMISTIC_REACTION,
        event_id: "e1",
        icon: "eyes",
        optimisticAction: "remove",
      } as unknown as EventFeedAction);
      expect(state.events[0].client_reactions?.eyes?.count).toBe(1);
      expect(state.events[0].client_reactions?.eyes?.self).toBe(false);
    });
  });
});
