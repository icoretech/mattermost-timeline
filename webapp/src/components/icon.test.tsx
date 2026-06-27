import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import type { Store } from "redux";
import { vi } from "vitest";

import { RECEIVED_CONTEXT_UNREAD_EVENTS } from "../actions";
import manifest from "../manifest";
import Icon from "./icon";

type TestState = {
  entities: {
    users: { currentUserId: string };
    teams: { currentTeamId: string };
    channels: { currentChannelId: string };
  };
} & Record<string, unknown>;

function makeState({
  teamId = "team-1",
  channelId = "channel-1",
  unread = false,
}: {
  teamId?: string;
  channelId?: string;
  unread?: boolean;
} = {}): TestState {
  return {
    entities: {
      users: { currentUserId: "user-1" },
      teams: { currentTeamId: teamId },
      channels: { currentChannelId: channelId },
    },
    [`plugins-${manifest.id}`]: {
      unreadEventIdsByContext: unread
        ? { [`${teamId}:${channelId}`]: ["event-1"] }
        : {},
    },
  };
}

function makeStore(state: TestState) {
  const dispatch = vi.fn((action: unknown): unknown => {
    if (typeof action === "function") {
      return (action as (innerDispatch: typeof dispatch) => unknown)(dispatch);
    }
    return action;
  });

  return {
    dispatch,
    getState: () =>
      state as unknown as Store["getState"] extends () => infer T ? T : never,
    subscribe: () => () => undefined,
    replaceReducer: () => undefined,
    [Symbol.observable]: () => ({
      subscribe: () => ({ unsubscribe: () => undefined }),
    }),
  } as unknown as Store;
}

async function renderIcon(state: TestState) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const store = makeStore(state);

  await act(async () => {
    root.render(
      <Provider store={store}>
        <Icon />
      </Provider>,
    );
    await Promise.resolve();
  });

  return { container, root, store };
}

async function cleanup(root: Root, container: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("Icon", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          events: [
            {
              id: "event-1",
              team_id: "team-1",
              timestamp: 1000,
              title: "event",
              event_type: "info",
            },
          ],
          unread_events: [
            {
              id: "event-1",
              team_id: "team-1",
              timestamp: 1000,
              title: "event",
              event_type: "info",
            },
          ],
          total: 1,
        }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("refreshes unread state on the current team/channel", async () => {
    const { container, root, store } = await renderIcon(makeState());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/plugins/ch.icorete.mattermost-timeline/api/v1/events?team_id=team-1&offset=0&limit=50&channel_id=channel-1",
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: RECEIVED_CONTEXT_UNREAD_EVENTS }),
    );
    const icon = container.querySelector('[role="img"]');
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("aria-label")).toBe("Event Feed");
    expect(icon?.querySelector("circle")).toBeNull();

    await cleanup(root, container);
  });

  it("renders a red unread dot when current context has unread events", async () => {
    const { container, root } = await renderIcon(makeState({ unread: true }));

    const icon = container.querySelector('[role="img"]');
    const unreadDot = icon?.querySelector("circle");
    expect(unreadDot).not.toBeNull();
    expect(unreadDot?.getAttribute("cx")).toBe("19");
    expect(unreadDot?.getAttribute("cy")).toBe("5");
    expect(unreadDot?.getAttribute("r")).toBe("4");
    expect(unreadDot?.getAttribute("fill")).toBe("var(--error-text, #d24b4e)");
    expect(unreadDot?.getAttribute("stroke")).toBe(
      "var(--center-channel-bg, #fff)",
    );
    expect(icon?.getAttribute("aria-label")).toBe(
      "Event Feed has unread events",
    );

    await cleanup(root, container);
  });
});
