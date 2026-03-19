import type { EventFeedAction } from "./actions";
import {
  CLEAR_NEW_EVENT_FLAG,
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
      timelineOrder: "oldest_first",
    });
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
});
