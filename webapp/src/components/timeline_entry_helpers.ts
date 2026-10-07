import { createElement, Fragment, type ReactNode } from "react";
import type { TimestampDisplayPreferences } from "../selectors";
import type { EventEntry } from "../types/timeline";

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function getHourCycle(useMilitaryTime: boolean): "h23" | "h12" {
  return useMilitaryTime ? "h23" : "h12";
}

function getDateKeyFormatter(
  preferences: TimestampDisplayPreferences,
): Intl.DateTimeFormat {
  const formatterKey = `${preferences.locale}|${preferences.timeZone}`;
  const cachedFormatter = dateKeyFormatters.get(formatterKey);
  if (cachedFormatter) return cachedFormatter;

  const formatter = Intl.DateTimeFormat(preferences.locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: preferences.timeZone,
  });
  dateKeyFormatters.set(formatterKey, formatter);
  return formatter;
}

function getDateKeyForTimeZone(
  date: Date,
  preferences: TimestampDisplayPreferences,
): string {
  return getDateKeyFormatter(preferences).format(date);
}

export function formatTimestamp(
  timestamp: number,
  preferences: TimestampDisplayPreferences,
  now = new Date(),
): string {
  const date = new Date(timestamp);
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: getHourCycle(preferences.useMilitaryTime),
    timeZone: preferences.timeZone,
  };
  const time = date.toLocaleTimeString(preferences.locale, timeOptions);

  if (
    getDateKeyForTimeZone(date, preferences) ===
    getDateKeyForTimeZone(now, preferences)
  ) {
    return time;
  }

  const dateStr = date.toLocaleDateString(preferences.locale, {
    month: "short",
    day: "numeric",
    timeZone: preferences.timeZone,
  });

  return `${dateStr} ${time}`;
}

export function formatTimestampTooltip(
  timestamp: number,
  preferences: TimestampDisplayPreferences,
): string {
  return new Date(timestamp).toLocaleString(preferences.locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: getHourCycle(preferences.useMilitaryTime),
    timeZone: preferences.timeZone,
  });
}

export function isSafeUrl(url: string): boolean {
  if (/\p{Cc}/u.test(url)) return false;
  const trimmedUrl = url.trim();
  const schemeMatch = trimmedUrl.match(/^([a-zA-Z][a-zA-Z\d+\-.]*:)/);

  if (!schemeMatch) {
    return true;
  }

  return SAFE_URL_PROTOCOLS.has(schemeMatch[1].toLowerCase());
}

export function isTimelineEventExpired(
  event: EventEntry,
  now = Date.now(),
): boolean {
  return Boolean(event.expires_at && event.expires_at <= now);
}

function hasTimelineTerminalStatus(event: EventEntry): boolean {
  return ["success", "failed", "resolved", "closed"].includes(
    event.status || "",
  );
}

export function isTimelineEventActive(
  event: EventEntry,
  now = Date.now(),
): boolean {
  if (event.pinned) return true;
  if (isTimelineEventExpired(event, now) || hasTimelineTerminalStatus(event)) {
    return false;
  }
  return (
    event.status === "open" ||
    event.status === "running" ||
    event.severity === "critical"
  );
}

export function renderMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Links: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      if (isSafeUrl(linkMatch[2])) {
        parts.push(
          createElement(
            "a",
            {
              key: key++,
              href: linkMatch[2],
              target: "_blank",
              rel: "noopener noreferrer",
              className: "timeline-entry__md-link",
            },
            linkMatch[1],
          ),
        );
      } else {
        parts.push(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(createElement("strong", { key: key++ }, boldMatch[1]));
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(createElement("em", { key: key++ }, italicMatch[1]));
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        createElement(
          "code",
          { key: key++, className: "timeline-entry__md-code" },
          codeMatch[1],
        ),
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Newline
    if (remaining[0] === "\n") {
      parts.push(createElement("br", { key: key++ }));
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text — consume until next special character
    const nextSpecial = remaining.slice(1).search(/[[*`\n]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    }
    parts.push(remaining.slice(0, nextSpecial + 1));
    remaining = remaining.slice(nextSpecial + 1);
  }

  return parts;
}

type TimelineMarkdownProps = {
  text: string;
};

export function TimelineMarkdown({ text }: TimelineMarkdownProps): ReactNode {
  return createElement(Fragment, null, ...renderMarkdown(text));
}
