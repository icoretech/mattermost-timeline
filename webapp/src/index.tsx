import type { GlobalState } from "@mattermost/types/store";
import React from "react";
import type { Store } from "redux";
import {
  type EventFeedAction,
  parseNewEventWebSocket,
  parseReactionWebSocket,
  parseUpdatedEventWebSocket,
  setCurrentUserId,
} from "./actions";
import Icon from "./components/icon";
import RHSView from "./components/rhs_view";
import manifest from "./manifest";
import reducer from "./reducer";
import type {
  NewEventWebSocketMessage,
  ReactionUpdatedWebSocketMessage,
} from "./types";
import type { PluginRegistry } from "./types/mattermost-webapp";

export default class Plugin {
  public initialize(registry: PluginRegistry, store: Store<GlobalState>) {
    registry.registerReducer(reducer);

    const currentUserId = store.getState().entities.users.currentUserId || "";
    if (currentUserId) {
      store.dispatch(setCurrentUserId(currentUserId));
    }

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

    registry.registerWebSocketEventHandler(
      `custom_${manifest.id}_updated_event`,
      (message: NewEventWebSocketMessage) => {
        const action = parseUpdatedEventWebSocket(message.data.event);
        if (action) {
          store.dispatch(action);
        }
      },
    );

    registry.registerWebSocketEventHandler<{ payload: string }>(
      `custom_${manifest.id}_reaction_updated`,
      (msg: ReactionUpdatedWebSocketMessage) => {
        const action = parseReactionWebSocket(msg);
        if (action) {
          const userId = store.getState().entities.users.currentUserId || "";
          const nextAction: EventFeedAction = {
            ...action,
            currentUserId: userId,
          };
          store.dispatch(nextAction);
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
