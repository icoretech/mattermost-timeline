import type { GlobalState } from "@mattermost/types/store";
import { getCurrentTeamId, getPluginState } from "./selectors";

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
        "plugins-ch.icoretech.mattermost-timeline": pluginState,
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
  });
});
