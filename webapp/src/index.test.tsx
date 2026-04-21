import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HYDRATE_POPOUT_STATE,
  SET_CURRENT_USER_ID,
  SET_VIEW_CONTEXT,
} from "./actions";
import manifest from "./manifest";

describe("plugin entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, "registerPlugin");
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
  });
});
