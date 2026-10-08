import {
  HYDRATE_POPOUT_STATE,
  RECEIVED_EVENTS,
  RECEIVED_UPDATED_EVENT,
} from "./actions";
import reducer from "./reducer";
import { isEventFeedState } from "./timeline_validation";
import type { EventEntry } from "./types/timeline";

const event: EventEntry = {
  id: "sample-event",
  team_id: "sample-team",
  timestamp: 1000,
  title: "Sample event",
  event_type: "info",
  status: "closed",
  custom_fields: [{ name: "attempts", value: 0 }],
};

describe("custom fields in event state", () => {
  it("replaces fields on a same-ID update without duplicating the event", () => {
    const state = reducer(undefined, {
      type: RECEIVED_EVENTS,
      events: [event],
      total: 1,
    });
    const updatedEvent: EventEntry = {
      ...event,
      custom_fields: [{ name: "ready", value: false }],
    };

    const updated = reducer(state, {
      type: RECEIVED_UPDATED_EVENT,
      event: updatedEvent,
    });

    expect(updated.events).toEqual([updatedEvent]);
    expect(updated.total).toBe(1);
  });

  it("clears old fields when the updated canonical event omits them", () => {
    const state = reducer(undefined, {
      type: RECEIVED_EVENTS,
      events: [event],
      total: 1,
    });
    const updatedEvent: EventEntry = { ...event, custom_fields: undefined };

    const updated = reducer(state, {
      type: RECEIVED_UPDATED_EVENT,
      event: updatedEvent,
    });

    expect(updated.events).toEqual([updatedEvent]);
    expect(updated.events[0].custom_fields).toBeUndefined();
  });

  it("validates and hydrates scalar fields in popout state", () => {
    const state = reducer(undefined, {
      type: RECEIVED_EVENTS,
      events: [event],
      total: 1,
    });

    const hydrated = reducer(undefined, {
      type: HYDRATE_POPOUT_STATE,
      hydratedState: state,
      teamId: event.team_id,
      channelId: "",
    });

    expect(isEventFeedState(state)).toBe(true);
    expect(hydrated.events).toEqual([event]);
    expect(hydrated.viewTeamId).toBe(event.team_id);
  });
});
