import type { GlobalState } from "@mattermost/types/store";
import {
  getCurrentChannelId,
  getCurrentTeamId,
  getCurrentTimelineUnreadCount,
  getCurrentTimelineUnreadEventIds,
  getCurrentUserId,
  getHasCurrentTimelineUnread,
  getPluginState,
  getTimelineContextKey,
} from "./selectors";

describe("selectors", () => {
  describe("getPluginState", () => {
    it("returns plugin state when present", () => {
      const pluginState = {
        events: [],
        isLoading: false,
        error: null,
        total: 0,
        newEventIds: [],
      };
      const state = {
        "plugins-ch.icorete.mattermost-timeline": pluginState,
      } as unknown as GlobalState;
      expect(getPluginState(state)).toBe(pluginState);
    });

    it("returns undefined when plugin state is missing", () => {
      const state = {} as unknown as GlobalState;
      expect(getPluginState(state)).toBeUndefined();
    });
  });

  describe("getCurrentTeamId", () => {
    it("returns team id from state", () => {
      const state = {
        entities: { teams: { currentTeamId: "team123" } },
      } as unknown as GlobalState;
      expect(getCurrentTeamId(state)).toBe("team123");
    });

    it("returns empty string when no team selected", () => {
      const state = {
        entities: { teams: { currentTeamId: "" } },
      } as unknown as GlobalState;
      expect(getCurrentTeamId(state)).toBe("");
    });

    it("falls back to hydrated plugin team id", () => {
      const state = {
        entities: { teams: { currentTeamId: "" } },
        "plugins-ch.icorete.mattermost-timeline": { viewTeamId: "team123" },
      } as unknown as GlobalState;
      expect(getCurrentTeamId(state)).toBe("team123");
    });
  });

  describe("getCurrentChannelId", () => {
    it("returns channel id from state", () => {
      const state = {
        entities: { channels: { currentChannelId: "channel123" } },
      } as unknown as GlobalState;
      expect(getCurrentChannelId(state)).toBe("channel123");
    });

    it("falls back to hydrated plugin channel id", () => {
      const state = {
        entities: { channels: { currentChannelId: "" } },
        "plugins-ch.icorete.mattermost-timeline": {
          viewChannelId: "channel123",
        },
      } as unknown as GlobalState;
      expect(getCurrentChannelId(state)).toBe("channel123");
    });
  });

  describe("current timeline unread selectors", () => {
    it("builds stable context keys", () => {
      expect(getTimelineContextKey("team-1")).toBe("team-1:_global");
      expect(getTimelineContextKey("team-1", "channel-1")).toBe(
        "team-1:channel-1",
      );
    });

    it("dedupes current context and team-wide unread ids", () => {
      const state = {
        entities: {
          teams: { currentTeamId: "team-1" },
          channels: { currentChannelId: "channel-1" },
          users: { currentUserId: "user-1" },
        },
        "plugins-ch.icorete.mattermost-timeline": {
          unreadEventIdsByContext: {
            "team-1:channel-1": ["channel-event", "shared"],
            "team-1:_global": ["global-event", "shared"],
            "team-1:channel-2": ["other-channel"],
          },
        },
      } as unknown as GlobalState;

      expect(getCurrentTimelineUnreadEventIds(state)).toEqual([
        "channel-event",
        "shared",
        "global-event",
      ]);
      expect(getCurrentTimelineUnreadCount(state)).toBe(3);
      expect(getHasCurrentTimelineUnread(state)).toBe(true);
      expect(getCurrentUserId(state)).toBe("user-1");
    });

    it("does not include global unread twice when current context is global", () => {
      const state = {
        entities: {
          teams: { currentTeamId: "team-1" },
          channels: { currentChannelId: "" },
          users: { currentUserId: "" },
        },
        "plugins-ch.icorete.mattermost-timeline": {
          currentUserId: "hydrated-user",
          unreadEventIdsByContext: {
            "team-1:_global": ["global-event"],
          },
        },
      } as unknown as GlobalState;

      expect(getCurrentTimelineUnreadEventIds(state)).toEqual(["global-event"]);
      expect(getCurrentUserId(state)).toBe("hydrated-user");
    });
  });
});
