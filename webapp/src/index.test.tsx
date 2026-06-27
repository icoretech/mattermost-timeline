import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HYDRATE_POPOUT_STATE,
  MARK_EVENTS_READ,
  RECEIVED_UNREAD_EVENTS,
  SET_CURRENT_USER_ID,
  SET_VIEW_CONTEXT,
} from "./actions";
import manifest from "./manifest";

describe("plugin entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, "registerPlugin");
    Reflect.deleteProperty(window, "WebappUtils");
  });

  it("registers the plugin on load", async () => {
    const registerPlugin = vi.fn();
    window.registerPlugin = registerPlugin;

    await import("./index");

    expect(registerPlugin).toHaveBeenCalledTimes(1);
    expect(registerPlugin).toHaveBeenCalledWith(
      manifest.id,
      expect.any(Object),
    );
  });

  it("registers RHS popout support and hydrates popout state", async () => {
    const registerPlugin = vi.fn();
    const dispatch = vi.fn();
    const pluginState = {
      events: [],
      isLoading: false,
      error: null,
      total: 0,
      newEventIds: [],
      updatedEventIds: [],
      timelineOrder: "oldest_first",
      enableReactions: true,
      currentUserId: "user123",
      viewTeamId: "team123",
      viewChannelId: "channel123",
    };

    let popoutListener:
      | ((
          teamName: string,
          channelName: string | undefined,
          listeners: {
            sendToPopout: (channel: string, data?: unknown) => void;
            onMessageFromPopout: (
              callback: (channel: string, data?: unknown) => void,
            ) => void;
          },
        ) => void)
      | undefined;
    let parentListener: ((channel: string, data?: unknown) => void) | undefined;

    window.registerPlugin = registerPlugin;
    window.WebappUtils = {
      popouts: {
        isPopoutWindow: vi.fn(() => true),
        onMessageFromParent: vi.fn((callback) => {
          parentListener = callback;
        }),
        sendToParent: vi.fn(),
      },
    };

    await import("./index");

    const plugin = registerPlugin.mock.calls[0][1] as {
      initialize: (registry: unknown, store: unknown) => void;
    };

    const store = {
      dispatch,
      getState: () => ({
        entities: {
          users: { currentUserId: "user123" },
          teams: { currentTeamId: "team123" },
          channels: { currentChannelId: "channel123" },
        },
        [`plugins-${manifest.id}`]: pluginState,
      }),
    };

    const registry = {
      registerReducer: vi.fn(),
      registerRightHandSidebarComponent: vi.fn(() => ({
        toggleRHSPlugin: { type: "toggle_rhs" },
      })),
      registerChannelHeaderButtonAction: vi.fn(),
      registerWebSocketEventHandler: vi.fn(),
      registerRHSPluginPopoutListener: vi.fn((_pluginId, listener) => {
        popoutListener = listener;
      }),
    };

    plugin.initialize(registry, store);

    expect(registry.registerRHSPluginPopoutListener).toHaveBeenCalledWith(
      manifest.id,
      expect.any(Function),
    );
    expect(window.WebappUtils?.popouts?.sendToParent).toHaveBeenCalledWith(
      "GET_TIMELINE_POPOUT_STATE",
    );

    parentListener?.("SEND_TIMELINE_POPOUT_STATE", {
      teamId: "team123",
      channelId: "channel123",
      currentUserId: "user123",
      pluginState,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SET_VIEW_CONTEXT,
        teamId: "team123",
        channelId: "channel123",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HYDRATE_POPOUT_STATE,
        teamId: "team123",
        channelId: "channel123",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SET_CURRENT_USER_ID,
        currentUserId: "user123",
      }),
    );

    const sendToPopout = vi.fn();
    popoutListener?.("team-name", "channel-name", {
      sendToPopout,
      onMessageFromPopout: (callback) => callback("GET_TIMELINE_POPOUT_STATE"),
    });

    expect(sendToPopout).toHaveBeenCalledWith(
      "SEND_TIMELINE_POPOUT_STATE",
      expect.objectContaining({
        teamId: "team123",
        channelId: "channel123",
        currentUserId: "user123",
        pluginState,
      }),
    );

    popoutListener?.("team-name", "channel-name", {
      sendToPopout,
      onMessageFromPopout: (callback) =>
        callback("TIMELINE_MARK_CONTEXT_READ", {
          teamId: "team123",
          eventIds: ["event-1"],
        }),
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: MARK_EVENTS_READ,
      teamId: "team123",
      eventIds: ["event-1"],
    });
  });

  it("ignores invalid popout plugin state instead of hydrating it", async () => {
    const registerPlugin = vi.fn();
    const dispatch = vi.fn();
    let parentListener: ((channel: string, data?: unknown) => void) | undefined;

    window.registerPlugin = registerPlugin;
    window.WebappUtils = {
      popouts: {
        isPopoutWindow: vi.fn(() => true),
        onMessageFromParent: vi.fn((callback) => {
          parentListener = callback;
        }),
        sendToParent: vi.fn(),
      },
    };

    await import("./index");

    const plugin = registerPlugin.mock.calls[0][1] as {
      initialize: (registry: unknown, store: unknown) => void;
    };
    const store = {
      dispatch,
      getState: () => ({
        entities: {
          users: { currentUserId: "user123" },
          teams: { currentTeamId: "team123" },
          channels: { currentChannelId: "channel123" },
        },
      }),
    };
    const registry = {
      registerReducer: vi.fn(),
      registerRightHandSidebarComponent: vi.fn(() => ({
        toggleRHSPlugin: { type: "toggle_rhs" },
      })),
      registerChannelHeaderButtonAction: vi.fn(),
      registerWebSocketEventHandler: vi.fn(),
      registerRHSPluginPopoutListener: vi.fn(),
    };

    plugin.initialize(registry, store);

    parentListener?.("SEND_TIMELINE_POPOUT_STATE", {
      teamId: "team123",
      channelId: "channel123",
      currentUserId: "user123",
      pluginState: {
        events: [
          {
            id: "event-1",
            team_id: "team123",
            timestamp: 1000,
            title: "malformed event",
            event_type: "info",
            links: [{ url: "https://example.com", label: 123 }],
          },
        ],
        isLoading: false,
        error: null,
        total: 1,
        newEventIds: [],
        updatedEventIds: [],
        timelineOrder: "oldest_first",
        enableReactions: true,
        currentUserId: "user123",
        viewTeamId: "team123",
        viewChannelId: "channel123",
      },
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: HYDRATE_POPOUT_STATE }),
    );
  });

  it("routes timeline websocket events to unread state and ignores reactions", async () => {
    const registerPlugin = vi.fn();
    const dispatch = vi.fn();
    const handlers = new Map<
      string,
      (message: { data: Record<string, string> }) => void
    >();

    window.registerPlugin = registerPlugin;

    await import("./index");

    const plugin = registerPlugin.mock.calls[0][1] as {
      initialize: (registry: unknown, store: unknown) => void;
    };
    const store = {
      dispatch,
      getState: () => ({
        entities: {
          users: { currentUserId: "user123" },
          teams: { currentTeamId: "team123" },
          channels: { currentChannelId: "channel123" },
        },
      }),
    };
    const registry = {
      registerReducer: vi.fn(),
      registerRightHandSidebarComponent: vi.fn(() => ({
        toggleRHSPlugin: { type: "toggle_rhs" },
      })),
      registerChannelHeaderButtonAction: vi.fn(),
      registerRHSPluginPopoutListener: undefined,
      registerWebSocketEventHandler: vi.fn((eventName, handler) => {
        handlers.set(eventName, handler);
      }),
    };

    plugin.initialize(registry, store);

    const newEvent = {
      id: "event-1",
      team_id: "team123",
      timestamp: 1000,
      title: "new event",
      event_type: "info",
      channels: ["channel123"],
    };
    handlers.get(`custom_${manifest.id}_new_event`)?.({
      data: { event: JSON.stringify(newEvent) },
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RECEIVED_UNREAD_EVENTS,
        events: [newEvent],
      }),
    );

    dispatch.mockClear();
    const updatedEvent = { ...newEvent, timestamp: 2000 };
    handlers.get(`custom_${manifest.id}_updated_event`)?.({
      data: { event: JSON.stringify(updatedEvent) },
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RECEIVED_UNREAD_EVENTS,
        events: [updatedEvent],
      }),
    );

    dispatch.mockClear();
    handlers.get(`custom_${manifest.id}_reaction_updated`)?.({
      data: {
        payload: JSON.stringify({
          event_id: "event-1",
          icon: "eyes",
          count: 1,
          user_ids: ["user123"],
        }),
      },
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: RECEIVED_UNREAD_EVENTS }),
    );
  });
});
