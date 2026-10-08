import React from "react";
import { useMessages } from "../i18n";
import { TimelineSignalIcon } from "./timeline_signal_icon";

export function TimelineTitle() {
  const { t } = useMessages();

  return (
    <span className="timeline-sidebar-title">
      <TimelineSignalIcon size={16} />
      <span>{t("chrome.title")}</span>
    </span>
  );
}
