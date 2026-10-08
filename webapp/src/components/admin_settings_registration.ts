import React from "react";
import type { PluginRegistry } from "../types/mattermost-webapp";
import AdminSettings, { WebhookTokensSetting } from "./admin_settings";
import {
  LocalizedSetting,
  type LocalizedSettingProps,
} from "./localized_settings";

const settings = [
  "RequireSignedWebhooks",
  "WebhookSecret",
  "MaxEventsStored",
  "MaxEventsDisplayed",
  "TimelineOrder",
  "EnableReactions",
] as const;

export function registerLocalizedAdminSettings(
  registry: Pick<PluginRegistry, "registerAdminConsoleCustomSetting">,
) {
  registry.registerAdminConsoleCustomSetting(
    "WebhookTokens",
    WebhookTokensSetting,
    { showTitle: false },
  );
  registry.registerAdminConsoleCustomSetting("WebhookTools", AdminSettings, {
    showTitle: false,
  });
  for (const setting of settings) {
    registry.registerAdminConsoleCustomSetting(
      setting,
      (props: LocalizedSettingProps) =>
        React.createElement(LocalizedSetting, { ...props, setting }),
      { showTitle: false },
    );
  }
}
