import type { GlobalState } from "@mattermost/types/store";
import React from "react";
import type { Reducer, Store } from "redux";
import {
  hydratePopoutState,
  markEventsRead,
  parseNewEventWebSocket,
  parseReactionWebSocket,
  parseUpdatedEventWebSocket,
  receivedUnreadEvents,
  setCurrentUserId,
  setViewContext,
} from "./actions";
import Icon from "./components/icon";
import RHSView from "./components/rhs_view";
import manifest from "./manifest";
import reducer from "./reducer";
import { getPluginState } from "./selectors";
import {
  isEventFeedState,
  isRecord,
  isStringArray,
} from "./timeline_validation";
import type { PluginRegistry } from "./types/mattermost-webapp";
import type {
  HydratableEventFeedState,
  NewEventWebSocketMessage,
  ReactionUpdatedWebSocketMessage,
} from "./types/timeline";

const REQUEST_POPOUT_STATE = "GET_TIMELINE_POPOUT_STATE";
const SEND_POPOUT_STATE = "SEND_TIMELINE_POPOUT_STATE";
const MARK_POPOUT_CONTEXT_READ = "TIMELINE_MARK_CONTEXT_READ";

type EventFeedPopoutPayload = {
  teamId: string;
  channelId: string;
  currentUserId: string;
  pluginState?: HydratableEventFeedState;
};

type MarkPopoutContextReadPayload = {
  teamId: string;
  eventIds: string[];
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
    typeof payload.currentUserId === "string" &&
    (payload.pluginState === undefined || isEventFeedState(payload.pluginState))
  );
}

function isMarkPopoutContextReadPayload(
  value: unknown,
): value is MarkPopoutContextReadPayload {
  return (
    isRecord(value) &&
    typeof value.teamId === "string" &&
    isStringArray(value.eventIds)
  );
}

export default class Plugin {
  public initialize(registry: PluginRegistry, store: Store<GlobalState>) {
    registry.registerReducer(reducer as Reducer);

    const currentUserId = store.getState().entities.users.currentUserId || "";
    if (currentUserId) {
      store.dispatch(setCurrentUserId(currentUserId));
    }

    if (registry.registerRHSPluginPopoutListener) {
      registry.registerRHSPluginPopoutListener(
        manifest.id,
        (_teamName, _channelName, listeners) => {
          listeners.onMessageFromPopout((channel, payload) => {
            if (channel === MARK_POPOUT_CONTEXT_READ) {
              if (isMarkPopoutContextReadPayload(payload)) {
                store.dispatch(
                  markEventsRead(payload.teamId, payload.eventIds),
                );
              }
              return;
            }

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
          store.dispatch(receivedUnreadEvents([action.event]));
        }
      },
    );

    registry.registerWebSocketEventHandler(
      `custom_${manifest.id}_updated_event`,
      (message: NewEventWebSocketMessage) => {
        const action = parseUpdatedEventWebSocket(message.data.event);
        if (action) {
          store.dispatch(action);
          store.dispatch(receivedUnreadEvents([action.event]));
        }
      },
    );

    registry.registerWebSocketEventHandler<{ payload: string }>(
      `custom_${manifest.id}_reaction_updated`,
      (msg: ReactionUpdatedWebSocketMessage) => {
        const action = parseReactionWebSocket(msg.data.payload);
        if (action) {
          const userId = store.getState().entities.users.currentUserId || "";
          const nextAction = {
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
