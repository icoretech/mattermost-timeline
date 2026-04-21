import type { GlobalState } from "@mattermost/types/store";
import React from "react";
import type { Store } from "redux";
import {
  type EventFeedAction,
  hydratePopoutState,
  parseNewEventWebSocket,
  parseReactionWebSocket,
  parseUpdatedEventWebSocket,
  setCurrentUserId,
  setViewContext,
} from "./actions";
import Icon from "./components/icon";
import RHSView from "./components/rhs_view";
import manifest from "./manifest";
import reducer from "./reducer";
import { getPluginState } from "./selectors";
import type {
  EventFeedState,
  NewEventWebSocketMessage,
  ReactionUpdatedWebSocketMessage,
} from "./types";
import type { PluginRegistry } from "./types/mattermost-webapp";

const REQUEST_POPOUT_STATE = "GET_TIMELINE_POPOUT_STATE";
const SEND_POPOUT_STATE = "SEND_TIMELINE_POPOUT_STATE";

type EventFeedPopoutPayload = {
  teamId: string;
  channelId: string;
  currentUserId: string;
  pluginState?: EventFeedState;
};

function isEventFeedPopoutPayload(
  value: unknown,
): value is EventFeedPopoutPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.teamId === "string" &&
    typeof payload.channelId === "string" &&
    typeof payload.currentUserId === "string"
  );
}

export default class Plugin {
  public initialize(registry: PluginRegistry, store: Store<GlobalState>) {
    registry.registerReducer(reducer);

    const currentUserId = store.getState().entities.users.currentUserId || "";
    if (currentUserId) {
      store.dispatch(setCurrentUserId(currentUserId));
    }

    if (registry.registerRHSPluginPopoutListener) {
      registry.registerRHSPluginPopoutListener(
        manifest.id,
        (_teamName, _channelName, listeners) => {
          listeners.onMessageFromPopout((channel) => {
            if (channel !== REQUEST_POPOUT_STATE) {
              return;
            }

            const state = store.getState();
            listeners.sendToPopout(SEND_POPOUT_STATE, {
              teamId: state.entities.teams.currentTeamId || "",
              channelId: state.entities.channels.currentChannelId || "",
              currentUserId: state.entities.users.currentUserId || "",
              pluginState: getPluginState(state),
            } satisfies EventFeedPopoutPayload);
          });
        },
      );

      if (window.WebappUtils?.popouts?.isPopoutWindow()) {
        window.WebappUtils.popouts.onMessageFromParent(
          (channel: string, payload?: unknown) => {
            if (
              channel !== SEND_POPOUT_STATE ||
              !isEventFeedPopoutPayload(payload)
            ) {
              return;
            }

            store.dispatch(setViewContext(payload.teamId, payload.channelId));

            if (payload.pluginState) {
              store.dispatch(
                hydratePopoutState(
                  payload.pluginState,
                  payload.teamId,
                  payload.channelId,
                ),
              );
            }

            if (payload.currentUserId) {
              store.dispatch(setCurrentUserId(payload.currentUserId));
            }
          },
        );

        window.WebappUtils.popouts.sendToParent(REQUEST_POPOUT_STATE);
      }
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
