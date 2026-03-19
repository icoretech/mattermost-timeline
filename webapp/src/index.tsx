import type { GlobalState } from "@mattermost/types/store";
import React from "react";
import type { Store } from "redux";
import type { PluginRegistry } from "types/mattermost-webapp";
import { parseNewEventWebSocket } from "./actions";
import Icon from "./components/icon";
import RHSView from "./components/rhs_view";
import manifest from "./manifest";
import reducer from "./reducer";
import type { NewEventWebSocketMessage } from "./types";

export default class Plugin {
  public initialize(registry: PluginRegistry, store: Store<GlobalState>) {
    registry.registerReducer(reducer);

    const { toggleRHSPlugin } = registry.registerRightHandSidebarComponent(
      RHSView,
      "Event Feed",
    );

    registry.registerChannelHeaderButtonAction(
      Icon,
      () => store.dispatch(toggleRHSPlugin),
      "Event Feed",
      "Toggle Event Feed",
    );

    registry.registerWebSocketEventHandler(
      `custom_${manifest.id}_new_event`,
      (message: NewEventWebSocketMessage) => {
        const action = parseNewEventWebSocket(message.data.event);
        if (action) {
          store.dispatch(action);
        }
      },
    );
  }
}

declare global {
  interface Window {
    registerPlugin(pluginId: string, plugin: Plugin): void;
  }
}

window.registerPlugin(manifest.id, new Plugin());
