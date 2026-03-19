import { vi } from "vitest";

import {
  CLEAR_NEW_EVENT_FLAG,
  clearNewEventFlag,
  fetchEvents,
  parseNewEventWebSocket,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  receivedNewEvent,
  SET_ERROR,
  SET_LOADING,
} from "./actions";

describe("action creators", () => {
  it("receivedNewEvent creates correct action", () => {
    const event = {
      id: "e1",
      team_id: "t1",
      timestamp: 1000,
      title: "Test",
      event_type: "info",
    };
    const action = receivedNewEvent(event);
    expect(action.type).toBe(RECEIVED_NEW_EVENT);
    expect(action.event).toBe(event);
  });

  it("clearNewEventFlag creates correct action", () => {
    const action = clearNewEventFlag("e1");
    expect(action.type).toBe(CLEAR_NEW_EVENT_FLAG);
    expect(action.eventId).toBe("e1");
  });
});

describe("parseNewEventWebSocket", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses valid JSON and returns action", () => {
    const event = {
      id: "e1",
      team_id: "t1",
      timestamp: 1000,
      title: "Test",
      event_type: "info",
    };
    const result = parseNewEventWebSocket(JSON.stringify(event));
    expect(result).not.toBeNull();
    expect(result?.type).toBe(RECEIVED_NEW_EVENT);
    expect(result?.event?.id).toBe("e1");
  });

  it("returns null for invalid JSON", () => {
    const result = parseNewEventWebSocket("not-json");
    expect(result).toBeNull();
  });
});

describe("fetchEvents", () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
    globalThis.fetch = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches loading, then events on success", async () => {
    const events = [
      {
        id: "e1",
        team_id: "t1",
        timestamp: 1000,
        title: "Test",
        event_type: "info",
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events, total: 1 }),
    } as Response);

    await fetchEvents("t1")(mockDispatch);

    const types = mockDispatch.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types[0]).toBe(SET_LOADING);
    expect(types[1]).toBe(SET_ERROR);
    expect(types[2]).toBe(RECEIVED_EVENTS);
    expect(types[3]).toBe(SET_LOADING);
  });

  it("dispatches error on fetch failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network"));

    await fetchEvents("t1")(mockDispatch);

    const types = mockDispatch.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types).toContain(SET_ERROR);
    expect(types).toContain(SET_LOADING);
  });

  it("dispatches error on non-ok response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await fetchEvents("t1")(mockDispatch);

    const errorAction = mockDispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === SET_ERROR,
    );
    expect(errorAction).toBeDefined();
  });

  it("sets append=true when offset > 0", async () => {
    const events = [
      {
        id: "e2",
        team_id: "t1",
        timestamp: 2000,
        title: "Test2",
        event_type: "info",
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events, total: 2 }),
    } as Response);

    await fetchEvents("t1", 50)(mockDispatch);

    const receivedAction = mockDispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === RECEIVED_EVENTS,
    );
    expect(receivedAction).toBeDefined();
    expect((receivedAction?.[0] as { append: boolean }).append).toBe(true);
  });
});
