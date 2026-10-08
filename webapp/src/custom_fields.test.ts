import { vi } from "vitest";
import {
  fetchEvents,
  parseNewEventWebSocket,
  parseUpdatedEventWebSocket,
  RECEIVED_EVENTS,
  RECEIVED_NEW_EVENT,
  RECEIVED_UPDATED_EVENT,
  SET_ERROR,
} from "./actions";
import { isEventEntry, isEventFeedState } from "./timeline_validation";
import type { EventEntry, EventFeedState } from "./types/timeline";

const event: EventEntry = {
  id: "sample-event",
  team_id: "sample-team",
  timestamp: 1000,
  title: "Sample event",
  event_type: "info",
};

const fields = [
  { name: "release", label: "Release", type: "string", value: "1.2" },
  { name: "attempts", type: "number", value: 0 },
  { name: "ready", type: "boolean", value: false },
  { name: "implicit", value: true },
] satisfies NonNullable<EventEntry["custom_fields"]>;

const invalidFields: ReadonlyArray<readonly [string, unknown]> = [
  ["null collection", null],
  ["object collection", {}],
  ["null field", [null]],
  ["missing name", [{ value: "ok" }]],
  ["blank name", [{ name: "  ", value: "ok" }]],
  ["long name", [{ name: "x".repeat(65), value: "ok" }]],
  ["name control", [{ name: "name\u0000", value: "ok" }]],
  ["long label", [{ name: "name", label: "x".repeat(81), value: "ok" }]],
  ["label control", [{ name: "name", label: "a\u0085b", value: "ok" }]],
  ["null label", [{ name: "name", label: null, value: "ok" }]],
  ["missing value", [{ name: "name" }]],
  ["null value", [{ name: "name", value: null }]],
  ["object value", [{ name: "name", value: { nested: true } }]],
  ["array value", [{ name: "name", value: [1] }]],
  ["non-finite value", [{ name: "name", value: Number.POSITIVE_INFINITY }]],
  ["long value", [{ name: "name", value: "x".repeat(1001) }]],
  ["value control", [{ name: "name", value: "first\nsecond" }]],
  ["unknown type", [{ name: "name", type: "integer", value: 1 }]],
  ["empty type", [{ name: "name", type: "", value: 1 }]],
  ["null type", [{ name: "name", type: null, value: 1 }]],
  ["mismatched type", [{ name: "name", type: "number", value: "1" }]],
  [
    "duplicate name",
    [
      { name: "same", value: 1 },
      { name: "same", value: 2 },
    ],
  ],
  [
    "too many fields",
    Array.from({ length: 21 }, (_, i) => ({ name: `n${i}`, value: i })),
  ],
];

describe("custom fields at event boundaries", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(invalidFields)(
    "rejects %s in the event validator",
    (_name, custom_fields) => {
      expect(isEventEntry({ ...event, custom_fields })).toBe(false);
    },
  );

  it.each([undefined, [], fields])(
    "accepts omitted, empty, and scalar fields: %j",
    (custom_fields) => {
      expect(isEventEntry({ ...event, custom_fields })).toBe(true);
    },
  );

  it("counts Unicode codepoints at maximum field lengths", () => {
    const custom_fields = Array.from({ length: 20 }, (_, i) => ({
      name: String.fromCodePoint(0x1f600 + i).repeat(64),
      label: "한".repeat(80),
      value: "😀".repeat(1000),
    }));

    expect(isEventEntry({ ...event, custom_fields })).toBe(true);
  });

  it.each([
    ["new", parseNewEventWebSocket, RECEIVED_NEW_EVENT],
    ["updated", parseUpdatedEventWebSocket, RECEIVED_UPDATED_EVENT],
  ] as const)(
    "preserves ordered scalar fields in %s websockets",
    (_name, parse, type) => {
      const incoming = { ...event, custom_fields: fields };

      expect(parse(JSON.stringify(incoming))).toEqual({
        type,
        event: incoming,
      });
    },
  );

  it.each(invalidFields)(
    "rejects %s in new and updated websockets",
    (_name, custom_fields) => {
      const payload = JSON.stringify({ ...event, custom_fields });

      expect(parseNewEventWebSocket(payload)).toBeNull();
      expect(parseUpdatedEventWebSocket(payload)).toBeNull();
    },
  );

  it("preserves fields from the event HTTP response", async () => {
    const incoming = { ...event, custom_fields: fields };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ events: [incoming], total: 1 })),
    );
    const dispatch = vi.fn();

    await fetchEvents(event.team_id)(dispatch);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: RECEIVED_EVENTS, events: [incoming] }),
    );
  });

  it.each(invalidFields)(
    "rejects %s from the event HTTP response",
    async (_name, custom_fields) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ events: [{ ...event, custom_fields }], total: 1 }),
          ),
      );
      const dispatch = vi.fn();

      await fetchEvents(event.team_id)(dispatch);

      expect(dispatch).toHaveBeenCalledWith({
        type: SET_ERROR,
        error: "error.invalidResponse",
      });
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: RECEIVED_EVENTS }),
      );
    },
  );

  it.each(invalidFields)(
    "rejects %s from popout hydration",
    (_name, custom_fields) => {
      const state: EventFeedState = {
        events: [event],
        isLoading: false,
        error: null,
        total: 1,
        newEventIds: [],
        updatedEventIds: [],
        unreadEventIdsByContext: {},
        timelineOrder: "newest_first",
        enableReactions: false,
        currentUserId: "",
        viewTeamId: event.team_id,
        viewChannelId: "",
      };

      expect(
        isEventFeedState({ ...state, events: [{ ...event, custom_fields }] }),
      ).toBe(false);
    },
  );
});
