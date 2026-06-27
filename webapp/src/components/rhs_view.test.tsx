import type { GlobalState } from "@mattermost/types/store";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import type { Store } from "redux";
import { vi } from "vitest";

import { CLEAR_EVENTS, MARK_EVENTS_READ, SET_ERROR } from "../actions";
import manifest from "../manifest";
import type { EventEntry, EventFeedState } from "../types/timeline";
import RHSView from "./rhs_view";

type TestState = {
  entities: {
    users: {
      profiles: Record<string, unknown>;
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
}: {
  teamId?: string;
  channelId?: string;
  pluginState?: EventFeedState;
} = {}): TestState {
  return {
    entities: {
      users: {
        profiles: {},
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
    root.render(
      <Provider store={store}>
        <RHSView />
      </Provider>,
    );
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
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0 }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
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
      error: "Failed to add reaction",
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
        <Provider store={firstStore}>
          <RHSView />
        </Provider>,
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
        <Provider store={secondStore}>
          <RHSView />
        </Provider>,
      );
      await Promise.resolve();
    });

    expect(list?.scrollTop).toBe(240);

    await cleanup(root, container);
  });
});
