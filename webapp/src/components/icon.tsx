import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { Dispatch } from "redux";

import { type EventFeedThunk, refreshUnreadEvents } from "../actions";
import {
  getCurrentChannelId,
  getCurrentTeamId,
  getHasCurrentTimelineUnread,
} from "../selectors";

// Mattermost host store supports thunk dispatch
type AppDispatch = Dispatch &
  ((thunk: EventFeedThunk<unknown>) => Promise<unknown> | unknown);

const Icon = () => {
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: "16px", height: "16px" }}
      role="img"
      aria-label={hasUnread ? "Event Feed has unread events" : "Event Feed"}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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
    </svg>
  );
};

export default Icon;
