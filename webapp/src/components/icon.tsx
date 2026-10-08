import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { Dispatch } from "redux";

import { type EventFeedThunk, refreshUnreadEvents } from "../actions";
import { useMessages } from "../i18n";
import {
  getCurrentChannelId,
  getCurrentTeamId,
  getHasCurrentTimelineUnread,
} from "../selectors";
import { TimelineSignalIcon } from "./timeline_signal_icon";

// Mattermost host store supports thunk dispatch
type AppDispatch = Dispatch &
  ((thunk: EventFeedThunk<unknown>) => Promise<unknown> | unknown);

const Icon = () => {
  const { t } = useMessages();
  const dispatch = useDispatch<AppDispatch>();
  const currentTeamId = useSelector(getCurrentTeamId);
  const currentChannelId = useSelector(getCurrentChannelId);
  const hasUnread = useSelector(getHasCurrentTimelineUnread);

  useEffect(() => {
    if (currentTeamId) {
      dispatch(refreshUnreadEvents(currentTeamId, currentChannelId || ""));
    }
  }, [dispatch, currentTeamId, currentChannelId]);

  return (
    <TimelineSignalIcon
      size={16}
      label={t(hasUnread ? "chrome.unread" : "chrome.title")}
    >
      {hasUnread && (
        <circle
          cx="19"
          cy="5"
          r="4"
          fill="var(--error-text, #d24b4e)"
          stroke="var(--center-channel-bg, #fff)"
          strokeWidth="2"
        />
      )}
    </TimelineSignalIcon>
  );
};

export default Icon;
