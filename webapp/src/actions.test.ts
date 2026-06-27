import { vi } from "vitest";

import {
  addReaction,
  CLEAR_NEW_EVENT_FLAG,
  clearNewEventFlag,
  fetchEvents,
  fetchReactionUsers,
  MARK_EVENTS_READ,
  markVisibleEventsRead,
  OPTIMISTIC_REACTION,
  parseNewEventWebSocket,
  parseReactionWebSocket,
  parseUpdatedEventWebSocket,
  RECEIVED_CONTEXT_UNREAD_EVENTS,
  RECEIVED_EVENT_REACTIONS,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  RECEIVED_REACTION_UPDATED,
  receivedNewEvent,
  refreshUnreadEvents,
  removeReaction,
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

  it("returns null for valid JSON with the wrong event shape", () => {
    const result = parseNewEventWebSocket(
      JSON.stringify({ id: "e1", title: "missing required fields" }),
    );
    expect(result).toBeNull();
  });

  it("validates updated event payloads before creating an action", () => {
    const result = parseUpdatedEventWebSocket(
      JSON.stringify({ id: "e1", team_id: "t1", timestamp: "1000" }),
    );
    expect(result).toBeNull();
  });
});

describe("parseReactionWebSocket", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses valid reaction payloads and returns an action", () => {
    const result = parseReactionWebSocket(
      JSON.stringify({
        event_id: "e1",
        icon: "eyes",
        count: 2,
        user_ids: ["u1", "u2"],
      }),
    );

    expect(result).toEqual({
      type: RECEIVED_REACTION_UPDATED,
      eventId: "e1",
      icon: "eyes",
      count: 2,
      userIds: ["u1", "u2"],
    });
  });

  it("returns null for invalid reaction payloads", () => {
    expect(parseReactionWebSocket("not-json")).toBeNull();
  });

  it("returns null when parsed reaction payloads have the wrong shape", () => {
    expect(
      parseReactionWebSocket(
        JSON.stringify({
          event_id: "e1",
          icon: "eyes",
          count: "2",
          user_ids: ["u1", "u2"],
        }),
      ),
    ).toBeNull();
  });
});

describe("fetchReactionUsers", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns reaction user IDs from successful responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user_ids: ["u1", "u2"] }),
    } as Response);

    await expect(fetchReactionUsers("e1", "eyes")).resolves.toEqual([
      "u1",
      "u2",
    ]);
  });

  it("rejects failed responses before parsing the body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      json: vi.fn(),
    } as unknown as Response);

    await expect(fetchReactionUsers("e1", "eyes")).rejects.toThrow(
      "Failed to fetch reaction users",
    );
  });

  it("rejects successful responses with the wrong body shape", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user_ids: [42] }),
    } as Response);

    await expect(fetchReactionUsers("e1", "eyes")).rejects.toThrow(
      "Invalid reaction users response",
    );
  });
});

describe("reaction mutation thunks", () => {
  const mockDispatch = vi.fn();
  const validReactionMap = {
    eyes: {
      count: 1,
      self: true,
      recent_users: ["u1"],
    },
  };

  beforeEach(() => {
    mockDispatch.mockClear();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the validated reaction map after adding a reaction", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validReactionMap),
    } as Response);

    await expect(addReaction("e1", "eyes")(mockDispatch)).resolves.toEqual(
      validReactionMap,
    );
    expect(mockDispatch).toHaveBeenLastCalledWith({
      type: RECEIVED_EVENT_REACTIONS,
      eventId: "e1",
      reactions: validReactionMap,
    });
  });

  it("rejects and rolls back addReaction when the response shape is invalid", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    } as Response);

    await expect(addReaction("e1", "eyes")(mockDispatch)).rejects.toThrow(
      "Invalid reaction response",
    );

    expect(mockDispatch).toHaveBeenLastCalledWith({
      type: OPTIMISTIC_REACTION,
      eventId: "e1",
      icon: "eyes",
      optimisticAction: "remove",
    });
  });

  it("returns the validated reaction map after removing a reaction", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validReactionMap),
    } as Response);

    await expect(removeReaction("e1", "eyes")(mockDispatch)).resolves.toEqual(
      validReactionMap,
    );
    expect(mockDispatch).toHaveBeenLastCalledWith({
      type: RECEIVED_EVENT_REACTIONS,
      eventId: "e1",
      reactions: validReactionMap,
    });
  });

  it("rejects and rolls back removeReaction when the response shape is invalid", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ eyes: { count: "1" } }),
    } as Response);

    await expect(removeReaction("e1", "eyes")(mockDispatch)).rejects.toThrow(
      "Invalid reaction response",
    );

    expect(mockDispatch).toHaveBeenLastCalledWith({
      type: OPTIMISTIC_REACTION,
      eventId: "e1",
      icon: "eyes",
      optimisticAction: "add",
    });
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

    const receivedAction = mockDispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === RECEIVED_EVENTS,
    );
    expect(receivedAction?.[0]).toMatchObject({ unreadEventIds: [] });
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

  it("ignores aborted event fetches without overwriting state", async () => {
    const controller = new AbortController();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.mocked(globalThis.fetch).mockRejectedValue(abortError);

    const thunk = fetchEvents("t1", {
      signal: controller.signal,
    });
    controller.abort();
    await thunk(mockDispatch);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: SET_LOADING,
      loading: true,
    });
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

  it("dispatches error when the events response shape is invalid", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [{ id: "e1" }], total: 1 }),
    } as Response);

    await fetchEvents("t1")(mockDispatch);

    const errorAction = mockDispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === SET_ERROR,
    );
    expect(errorAction?.[0]).toMatchObject({
      type: SET_ERROR,
      error: "Invalid events response",
    });
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

    await fetchEvents("t1", { offset: 50 })(mockDispatch);

    const receivedAction = mockDispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === RECEIVED_EVENTS,
    );
    expect(receivedAction).toBeDefined();
    expect((receivedAction?.[0] as { append: boolean }).append).toBe(true);
  });
});

describe("unread thunks", () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
    globalThis.fetch = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshUnreadEvents dispatches context unread ids without SET_ERROR", async () => {
    const events = [
      {
        id: "e1",
        team_id: "t1",
        timestamp: 1000,
        title: "visible",
        event_type: "info",
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events, unread_events: events, total: 1 }),
    } as Response);

    await refreshUnreadEvents("t1", "c1")(mockDispatch);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/plugins/ch.icorete.mattermost-timeline/api/v1/events?team_id=t1&offset=0&limit=50&channel_id=c1",
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: RECEIVED_CONTEXT_UNREAD_EVENTS,
      teamId: "t1",
      channelId: "c1",
      visibleEventIds: ["e1"],
      unreadEventIds: ["e1"],
    });
    expect(
      mockDispatch.mock.calls.some(
        (c: unknown[]) => (c[0] as { type: string }).type === SET_ERROR,
      ),
    ).toBe(false);
  });

  it("refreshUnreadEvents logs failures without dispatching", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false } as Response);

    await refreshUnreadEvents("t1")(mockDispatch);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Event Feed: failed to refresh unread events",
      expect.any(Error),
    );
  });

  it("markVisibleEventsRead posts to the server before clearing locally", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          context_read_at: { c1: 1000 },
          seen_events: { e1: 1000 },
        }),
    } as Response);

    await markVisibleEventsRead("t1", "c1", ["e1"])(mockDispatch);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/plugins/ch.icorete.mattermost-timeline/api/v1/events/read",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          team_id: "t1",
          channel_id: "c1",
          event_ids: ["e1"],
        }),
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: MARK_EVENTS_READ,
      teamId: "t1",
      eventIds: ["e1"],
    });
  });

  it("markVisibleEventsRead accepts omitted empty read-state maps", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1 }),
    } as Response);

    await markVisibleEventsRead("t1", "", ["e1"])(mockDispatch);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: MARK_EVENTS_READ,
      teamId: "t1",
      eventIds: ["e1"],
    });
  });

  it("markVisibleEventsRead rejects invalid read state responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ version: 1, context_read_at: { c1: Number.NaN } }),
    } as Response);

    await expect(
      markVisibleEventsRead("t1", "", ["e1"])(mockDispatch),
    ).rejects.toThrow("Invalid read state response");
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
