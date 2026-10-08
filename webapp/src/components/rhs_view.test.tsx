import type { GlobalState } from "@mattermost/types/store";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import {
  applyMiddleware,
  createStore,
  type Middleware,
  type Store,
} from "redux";
import { vi } from "vitest";
import {
  CLEAR_EVENTS,
  type EventFeedAction,
  MARK_EVENTS_READ,
  receivedUpdatedEvent,
  SET_ERROR,
} from "../actions";
import manifest from "../manifest";
import reducer from "../reducer";
import { withIntl } from "../test_utils";
import { isEventFeedState } from "../timeline_validation";
import type { EventEntry, EventFeedState } from "../types/timeline";
import RHSView from "./rhs_view";

type TestState = {
  entities: {
    users: {
      currentUserId: string;
      profiles: Record<string, unknown>;
    };
    preferences: {
      myPreferences: Record<string, unknown>;
    };
    teams: {
      currentTeamId: string;
    };
    channels: {
      currentChannelId: string;
    };
  };
} & Record<string, unknown>;

function makeEvent(id: string): EventEntry {
  return {
    id,
    team_id: "team-1",
    timestamp: 1000,
    title: `event ${id}`,
    event_type: "info",
  };
}

function eventTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".timeline-entry__title")).map(
    (element) => element.textContent || "",
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function changeInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function makePluginState(
  overrides: Partial<EventFeedState> = {},
): EventFeedState {
  return {
    events: [],
    isLoading: false,
    error: null,
    total: 0,
    newEventIds: [],
    updatedEventIds: [],
    unreadEventIdsByContext: {},
    timelineOrder: "oldest_first",
    enableReactions: true,
    currentUserId: "",
    viewTeamId: "team-1",
    viewChannelId: "channel-1",
    ...overrides,
  };
}

function makeState({
  teamId = "team-1",
  channelId = "channel-1",
  pluginState = makePluginState(),
  preferences = {},
}: {
  teamId?: string;
  channelId?: string;
  pluginState?: EventFeedState;
  preferences?: Record<string, unknown>;
} = {}): TestState {
  return {
    entities: {
      users: {
        currentUserId: "user-1",
        profiles: {
          "user-1": {
            id: "user-1",
            locale: "en",
            timezone: {
              useAutomaticTimezone: "true",
              automaticTimezone: "UTC",
              manualTimezone: "",
            },
          },
        },
      },
      preferences: {
        myPreferences: preferences,
      },
      teams: {
        currentTeamId: teamId,
      },
      channels: {
        currentChannelId: channelId,
      },
    },
    [`plugins-${manifest.id}`]: pluginState,
  };
}

function makeStore(state: TestState) {
  const actions: unknown[] = [];
  const dispatch = vi.fn((action: unknown): unknown => {
    if (typeof action === "function") {
      return (action as (innerDispatch: typeof dispatch) => unknown)(dispatch);
    }
    actions.push(action);
    return action;
  });

  const store = {
    dispatch,
    getState: () => state as unknown as GlobalState,
    subscribe: () => () => undefined,
    replaceReducer: () => undefined,
    [Symbol.observable]: () => ({
      subscribe: () => ({ unsubscribe: () => undefined }),
    }),
  } as unknown as Store<GlobalState>;

  return { store, actions };
}

async function renderRHS(state: TestState) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const { store, actions } = makeStore(state);

  await act(async () => {
    root.render(<Provider store={store}>{withIntl(<RHSView />)}</Provider>);
    await Promise.resolve();
  });

  return { actions, container, root };
}

async function cleanup(root: Root, container: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("RHSView", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0 }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.WebappUtils = undefined;
  });

  it("performs an initial channel-scoped fetch", async () => {
    const { container, root } = await renderRHS(makeState());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("team_id=team-1"),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toContain(
      "channel_id=channel-1",
    );

    await cleanup(root, container);
  });

  it("updates translated controls on locale changes while retaining filter values and integration content", async () => {
    const state = makeState({
      pluginState: makePluginState({
        events: [
          {
            ...makeEvent("locale-event"),
            title: "Integration title",
            status: "closed",
            custom_fields: [
              { name: "release", label: "Release label", value: "v2" },
            ],
          },
        ],
      }),
    });
    const { store } = makeStore(state);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Provider store={store}>{withIntl(<RHSView />)}</Provider>);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".event-feed-filter-toggle")
        ?.click();
    });
    await act(async () => {
      const status =
        container.querySelector<HTMLSelectElement>("#status-filter");
      if (!status) throw new Error("Missing status filter");
      status.value = "closed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const englishLabel = container.querySelector(
      ".event-feed-filter-toggle",
    )?.textContent;
    const requestCount = vi.mocked(globalThis.fetch).mock.calls.length;

    await act(async () => {
      root.render(
        <Provider store={store}>{withIntl(<RHSView />, "it")}</Provider>,
      );
    });

    expect(
      container.querySelector(".event-feed-filter-toggle")?.textContent,
    ).toBe("Filtri");
    expect(
      container.querySelector(".event-feed-filter-toggle")?.textContent,
    ).not.toBe(englishLabel);
    expect(
      container.querySelector<HTMLSelectElement>("#status-filter")?.value,
    ).toBe("closed");
    expect(eventTitles(container)).toEqual(["Integration title"]);
    expect(container.querySelector("dl dt")?.textContent).toBe("Release label");
    expect(container.querySelector("dl dd")?.textContent).toBe("v2");
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(requestCount);
    await cleanup(root, container);
  });

  it("renders the compact search toolbar with filters collapsed", async () => {
    const { container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({ events: [makeEvent("e1")] }),
      }),
    );

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search timeline events"]',
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      ".event-feed-filter-toggle",
    );

    expect(search?.placeholder).toBe("Search timeline");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe(
      "event-feed-filter-panel",
    );
    expect(container.querySelector("#event-feed-filter-panel")).toBeNull();
    expect(eventTitles(container)).toEqual(["event e1"]);

    await cleanup(root, container);
  });

  it("keeps reaction picker state when translated group headings change", async () => {
    const { store } = makeStore(
      makeState({
        pluginState: makePluginState({
          events: [
            { ...makeEvent("active"), status: "open" },
            { ...makeEvent("history"), status: "closed" },
          ],
        }),
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Provider store={store}>{withIntl(<RHSView />)}</Provider>);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".reaction-bar__toggle")
        ?.click();
    });
    const picker = container.querySelector(".reaction-bar__tray--open");
    const headings = Array.from(
      container.querySelectorAll(".event-feed-section-heading"),
      (node) => node.textContent,
    );
    expect(headings).toEqual(["Active", "History"]);
    expect(picker).not.toBeNull();

    await act(async () => {
      root.render(
        <Provider store={store}>{withIntl(<RHSView />, "it")}</Provider>,
      );
    });

    expect(
      Array.from(
        container.querySelectorAll(".event-feed-section-heading"),
        (node) => node.textContent,
      ),
    ).not.toEqual(headings);
    expect(container.querySelector(".reaction-bar__tray--open")).toBe(picker);
    await cleanup(root, container);
  });

  it("exposes keyboard-focusable filter controls when expanded", async () => {
    const { container, root } = await renderRHS(makeState());
    const toggle = container.querySelector<HTMLButtonElement>(
      ".event-feed-filter-toggle",
    );

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const controls = Array.from(
      container.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >(
        "#event-feed-filter-panel input, #event-feed-filter-panel select, #event-feed-filter-panel button",
      ),
    );
    expect(controls).toHaveLength(8);
    expect(
      controls.map(
        (control) => control.getAttribute("id") || control.textContent,
      ),
    ).toEqual([
      "event-type-filter",
      "source-filter",
      "environment-filter",
      "severity-filter",
      "status-filter",
      "Pinned",
      "Active",
      "Unread",
    ]);
    for (const control of controls) {
      expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      expect(control.disabled).toBe(false);
    }

    await cleanup(root, container);
  });

  it("fetches closed events when the closed status filter is selected", async () => {
    const { actions, container, root } = await renderRHS(makeState());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".event-feed-filter-toggle")
        ?.click();
    });
    const status = container.querySelector<HTMLSelectElement>("#status-filter");
    expect(status?.querySelector('option[value="closed"]')).not.toBeNull();
    actions.length = 0;
    vi.mocked(globalThis.fetch).mockClear();

    await act(async () => {
      if (status) {
        status.value = "closed";
        status.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(actions).toContainEqual({ type: CLEAR_EVENTS });
    const filterURL = String(
      vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0],
    );
    expect(filterURL).toContain("offset=0");
    expect(filterURL).toContain("status=closed");
    await cleanup(root, container);
  });

  it("refetches active filters when a closed item is unpinned by websocket", async () => {
    const pinned = {
      ...makeEvent("closed"),
      status: "closed" as const,
      pinned: true,
    };
    let serverEvents = [pinned];
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            events: serverEvents,
            total: serverEvents.length,
          }),
        ),
    );
    const pluginKey = `plugins-${manifest.id}`;
    const thunk: Middleware<Record<string, never>, TestState> =
      (api) => (next) => (action) =>
        typeof action === "function"
          ? action(api.dispatch, api.getState)
          : next(action);
    const store = createStore(
      (state: TestState = makeState(), action: EventFeedAction) => {
        const pluginState = state[pluginKey];
        return {
          ...state,
          [pluginKey]: reducer(
            isEventFeedState(pluginState) ? pluginState : undefined,
            action,
          ),
        };
      },
      applyMiddleware(thunk),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Provider store={store}>{withIntl(<RHSView />)}</Provider>);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".event-feed-filter-toggle")
        ?.click();
    });
    await act(async () => {
      const status =
        container.querySelector<HTMLSelectElement>("#status-filter");
      if (status) {
        status.value = "closed";
        status.dispatchEvent(new Event("change", { bubbles: true }));
      }
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".event-feed-filter-chip",
        ),
      )
        .find((button) => button.textContent === "Active")
        ?.click();
    });
    expect(eventTitles(container)).toEqual(["event closed"]);
    vi.mocked(globalThis.fetch).mockClear();
    serverEvents = [];

    await act(async () => {
      store.dispatch(receivedUpdatedEvent({ ...pinned, pinned: false }));
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("status=closed"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0][0])).toContain(
      "active=true",
    );
    expect(eventTitles(container)).toEqual([]);
    await cleanup(root, container);
  });

  it("clears stale events and refetches offset zero when filters change", async () => {
    const { actions, container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({ events: [makeEvent("e1")] }),
      }),
    );
    actions.length = 0;
    vi.mocked(globalThis.fetch).mockClear();
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search timeline events"]',
    );

    await act(async () => {
      changeInputValue(search || null, "deploy");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(actions).toContainEqual({ type: CLEAR_EVENTS });
    const filterURL = String(
      vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0],
    );
    expect(filterURL).toContain("offset=0");
    expect(filterURL).toContain("q=deploy");

    await cleanup(root, container);
  });

  it("preserves filters when loading more and keeps order placement", async () => {
    const events = [makeEvent("e1"), makeEvent("e2")];
    const oldest = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events,
          total: 3,
          timelineOrder: "oldest_first",
        }),
      }),
    );
    const oldestSearch = oldest.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search timeline events"]',
    );
    expect(
      oldest.container
        .querySelector(".event-feed-list")
        ?.firstElementChild?.classList.contains("event-feed-load-more"),
    ).toBe(true);

    await act(async () => {
      changeInputValue(oldestSearch || null, "critical");
      await Promise.resolve();
      await Promise.resolve();
    });
    const filteredButton = oldest.container.querySelector<HTMLButtonElement>(
      ".event-feed-load-more",
    );
    await act(async () => {
      filteredButton?.click();
      await Promise.resolve();
    });

    const oldestURL = String(
      vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0],
    );
    expect(oldestURL).toContain("offset=2");
    expect(oldestURL).toContain("q=critical");
    await cleanup(oldest.root, oldest.container);

    const newest = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events,
          total: 3,
          timelineOrder: "newest_first",
        }),
      }),
    );
    expect(
      newest.container
        .querySelector(".event-feed-list")
        ?.lastElementChild?.classList.contains("event-feed-load-more"),
    ).toBe(true);
    await cleanup(newest.root, newest.container);
  });

  it.each(["success", "closed"] as const)(
    "groups %s critical events in history",
    async (status) => {
      const active = { ...makeEvent("active"), status: "open" as const };
      const history = {
        ...makeEvent("history"),
        status,
        severity: "critical" as const,
      };
      const both = await renderRHS(
        makeState({
          pluginState: makePluginState({
            events: [history, active],
            total: 2,
            timelineOrder: "newest_first",
          }),
        }),
      );

      expect(
        Array.from(
          both.container.querySelectorAll(".event-feed-section-heading"),
        ).map((element) => element.textContent),
      ).toEqual(["Active", "History"]);
      expect(eventTitles(both.container)).toEqual([
        "event active",
        "event history",
      ]);
      await cleanup(both.root, both.container);

      const onlyHistory = await renderRHS(
        makeState({
          pluginState: makePluginState({
            events: [history],
            total: 1,
            timelineOrder: "newest_first",
          }),
        }),
      );
      expect(
        onlyHistory.container.querySelector(".event-feed-section-heading"),
      ).toBeNull();
      expect(eventTitles(onlyHistory.container)).toEqual(["event history"]);
      await cleanup(onlyHistory.root, onlyHistory.container);
    },
  );

  it("threads timestamp display preferences into timeline entries", async () => {
    const state = makeState({
      pluginState: makePluginState({
        events: [
          {
            ...makeEvent("e1"),
            timestamp: Date.UTC(2026, 5, 25, 5, 0),
          },
        ],
        total: 1,
      }),
      preferences: {
        "display_settings--use_military_time": {
          category: "display_settings",
          name: "use_military_time",
          user_id: "user-1",
          value: "true",
        },
      },
    });
    const { container, root } = await renderRHS(state);
    const time = container.querySelector(".timeline-entry__time");

    expect(time?.textContent).toContain("05:00");
    expect(time?.textContent).not.toMatch(/AM|PM/);

    await cleanup(root, container);
  });

  it("clears stale events before fetching after a context change", async () => {
    const state = makeState({
      teamId: "team-2",
      channelId: "channel-2",
      pluginState: makePluginState({
        viewTeamId: "team-1",
        viewChannelId: "channel-1",
        events: [makeEvent("e1")],
      }),
    });
    const { actions, container, root } = await renderRHS(state);

    expect(actions[0]).toEqual({ type: CLEAR_EVENTS });
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toContain(
      "team_id=team-2",
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toContain(
      "channel_id=channel-2",
    );

    await cleanup(root, container);
  });

  it("propagates offset and channel when loading more", async () => {
    const state = makeState({
      pluginState: makePluginState({
        events: [makeEvent("e1"), makeEvent("e2")],
        total: 3,
      }),
    });
    const { container, root } = await renderRHS(state);
    const button = container.querySelector<HTMLButtonElement>(
      ".event-feed-load-more",
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const loadMoreURL = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0];
    expect(loadMoreURL).toContain("offset=2");
    expect(loadMoreURL).toContain("channel_id=channel-1");

    await cleanup(root, container);
  });

  it("places the load-more control according to timeline order", async () => {
    const events = [makeEvent("e1")];
    const oldest = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events,
          total: 2,
          timelineOrder: "oldest_first",
        }),
      }),
    );
    const oldestList = oldest.container.querySelector(".event-feed-list");
    expect(
      oldestList?.firstElementChild?.classList.contains("event-feed-load-more"),
    ).toBe(true);
    await cleanup(oldest.root, oldest.container);

    const newest = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events,
          total: 2,
          timelineOrder: "newest_first",
        }),
      }),
    );
    const newestList = newest.container.querySelector(".event-feed-list");
    expect(
      newestList?.lastElementChild?.classList.contains("event-feed-load-more"),
    ).toBe(true);
    await cleanup(newest.root, newest.container);
  });

  it("dispatches an error action when a reaction mutation fails", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 0 }),
      } as Response)
      .mockRejectedValueOnce(new Error("Failed to add reaction"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const state = makeState({
      pluginState: makePluginState({
        events: [
          {
            ...makeEvent("e1"),
            client_reactions: {
              eyes: { count: 1, self: false, recent_users: [] },
            },
          },
        ],
        total: 1,
      }),
    });

    const { actions, container, root } = await renderRHS(state);
    const reaction =
      container.querySelector<HTMLButtonElement>(".reaction-pill");

    await act(async () => {
      reaction?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(actions).toContainEqual({
      type: SET_ERROR,
      error: "error.reaction",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Event Feed: failed to update reaction",
      expect.any(Error),
    );

    await cleanup(root, container);
  });

  it("marks visible unread events read after loaded render", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).endsWith("/api/v1/events/read")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              version: 1,
              context_read_at: { "channel-1": 1000 },
              seen_events: { e1: 1000 },
            }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 0 }),
      } as Response);
    });
    const state = makeState({
      pluginState: makePluginState({
        events: [makeEvent("e1")],
        total: 1,
        viewTeamId: "team-1",
        viewChannelId: "channel-1",
        unreadEventIdsByContext: { "team-1:channel-1": ["e1"] },
      }),
    });

    const { actions, container, root } = await renderRHS(state);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/plugins/${manifest.id}/api/v1/events/read`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          team_id: "team-1",
          channel_id: "channel-1",
          event_ids: ["e1"],
        }),
      }),
    );
    expect(actions).toContainEqual({
      type: MARK_EVENTS_READ,
      teamId: "team-1",
      eventIds: ["e1"],
    });

    await cleanup(root, container);
  });

  it("sends popout read clears to the parent after local mark succeeds", async () => {
    window.WebappUtils = {
      popouts: {
        isPopoutWindow: vi.fn(() => true),
        onMessageFromParent: vi.fn(),
        sendToParent: vi.fn(),
      },
    };
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).endsWith("/api/v1/events/read")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              version: 1,
              context_read_at: { "channel-1": 1000 },
              seen_events: { e1: 1000 },
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 0 }),
      } as Response);
    });

    const { container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events: [makeEvent("e1")],
          total: 1,
          viewTeamId: "team-1",
          viewChannelId: "channel-1",
          unreadEventIdsByContext: { "team-1:channel-1": ["e1"] },
        }),
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.WebappUtils.popouts?.sendToParent).toHaveBeenCalledWith(
      "TIMELINE_MARK_CONTEXT_READ",
      { teamId: "team-1", eventIds: ["e1"] },
    );

    await cleanup(root, container);
  });

  it("logs mark-read failures and leaves unread state intact", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).endsWith("/api/v1/events/read")) {
        return Promise.resolve({ ok: false } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 0 }),
      } as Response);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { actions, container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events: [makeEvent("e1")],
          total: 1,
          viewTeamId: "team-1",
          viewChannelId: "channel-1",
          unreadEventIdsByContext: { "team-1:channel-1": ["e1"] },
        }),
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(actions).not.toContainEqual({
      type: MARK_EVENTS_READ,
      teamId: "team-1",
      eventIds: ["e1"],
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Event Feed: failed to mark events read",
      expect.any(Error),
    );

    await cleanup(root, container);
  });

  it("marks only rendered unread event IDs after grouping", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).endsWith("/api/v1/events/read")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: 1 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ events: [], total: 0 }),
      } as Response);
    });
    const visibleActive = {
      ...makeEvent("visible-active"),
      status: "open" as const,
    };
    const visibleHistory = {
      ...makeEvent("visible-history"),
      status: "success" as const,
    };

    const { actions, container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events: [visibleHistory, visibleActive],
          total: 2,
          viewTeamId: "team-1",
          viewChannelId: "channel-1",
          unreadEventIdsByContext: {
            "team-1:channel-1": [
              "hidden-by-filter",
              "visible-active",
              "visible-history",
            ],
          },
        }),
      }),
    );
    await flushEffects();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/plugins/${manifest.id}/api/v1/events/read`,
      expect.objectContaining({
        body: JSON.stringify({
          team_id: "team-1",
          channel_id: "channel-1",
          event_ids: ["visible-active", "visible-history"],
        }),
      }),
    );
    expect(actions).toContainEqual({
      type: MARK_EVENTS_READ,
      teamId: "team-1",
      eventIds: ["visible-active", "visible-history"],
    });
    expect(eventTitles(container)).toEqual([
      "event visible-active",
      "event visible-history",
    ]);

    await cleanup(root, container);
  });

  it("exposes loading, error, and empty state semantics", async () => {
    const loading = await renderRHS(
      makeState({ pluginState: makePluginState({ isLoading: true }) }),
    );
    expect(
      loading.container
        .querySelector(".event-feed-timeline")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      loading.container
        .querySelector(".event-feed-loading")
        ?.getAttribute("role"),
    ).toBe("status");
    expect(
      loading.container
        .querySelector(".event-feed-loading")
        ?.getAttribute("aria-live"),
    ).toBe("polite");
    await cleanup(loading.root, loading.container);

    const error = await renderRHS(
      makeState({ pluginState: makePluginState({ error: "Failed" }) }),
    );
    expect(
      error.container.querySelector(".event-feed-error")?.getAttribute("role"),
    ).toBe("alert");
    await cleanup(error.root, error.container);

    const empty = await renderRHS(makeState());
    expect(
      empty.container.querySelector(".event-feed-empty")?.getAttribute("role"),
    ).toBe("status");
    expect(
      empty.container.querySelector(".event-feed-empty__endpoint")?.textContent,
    ).toBe("/plugins/ch.icorete.mattermost-timeline/webhook");
    await cleanup(empty.root, empty.container);
  });

  it("does not request smooth scrolling when reduced motion is preferred", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 480,
    });
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    const { container, root } = await renderRHS(
      makeState({
        pluginState: makePluginState({
          events: [makeEvent("e1")],
          total: 1,
          newEventIds: ["e1"],
        }),
      }),
    );
    await flushEffects();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLDivElement>(".event-feed-list")?.scrollTop,
    ).toBe(480);

    await cleanup(root, container);
  });

  it("runs the initial scroll once per loaded context", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const firstStore = makeStore(
      makeState({
        pluginState: makePluginState({
          events: [makeEvent("e1")],
          total: 1,
          viewTeamId: "team-1",
          viewChannelId: "channel-1",
        }),
      }),
    ).store;

    await act(async () => {
      root.render(
        <Provider store={firstStore}>{withIntl(<RHSView />)}</Provider>,
      );
      await Promise.resolve();
    });

    const list = container.querySelector<HTMLDivElement>(".event-feed-list");
    expect(list?.scrollTop).toBe(240);
    if (list) {
      list.scrollTop = 0;
    }

    const secondStore = makeStore(
      makeState({
        teamId: "team-2",
        channelId: "channel-2",
        pluginState: makePluginState({
          events: [makeEvent("e2")],
          total: 1,
          viewTeamId: "team-2",
          viewChannelId: "channel-2",
        }),
      }),
    ).store;

    await act(async () => {
      root.render(
        <Provider store={secondStore}>{withIntl(<RHSView />)}</Provider>,
      );
      await Promise.resolve();
    });

    expect(list?.scrollTop).toBe(240);

    await cleanup(root, container);
  });
});
