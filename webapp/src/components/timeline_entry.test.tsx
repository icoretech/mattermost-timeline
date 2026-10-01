import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventEntry } from "../types/timeline";
import TimelineEntry from "./timeline_entry";
import {
  formatTimestamp,
  isTimelineEventActive,
  isTimelineEventExpired,
  renderMarkdown,
} from "./timeline_entry_helpers";

const defaultTimestampDisplayPreferences = {
  locale: "en",
  timeZone: "UTC",
  useMilitaryTime: false,
};

function queryStaticTimelineEntry(
  event: EventEntry,
  timestampDisplayPreferences = defaultTimestampDisplayPreferences,
): HTMLElement {
  const html = renderToStaticMarkup(
    React.createElement(TimelineEntry, {
      event,
      isNew: false,
      isUpdated: false,
      onAnimationEnd: () => undefined,
      onUpdateAnimationEnd: () => undefined,
      enableReactions: false,
      timestampDisplayPreferences,
      onAddReaction: () => undefined,
      onRemoveReaction: () => undefined,
      onFetchReactionUsers: async () => [],
      getUser: () => undefined,
    }),
  );
  const container = document.createElement("div");
  container.innerHTML = html;

  return container;
}

describe("formatTimestamp", () => {
  it("formats same-day timestamps with a 12-hour clock", () => {
    expect(
      formatTimestamp(
        Date.UTC(2026, 5, 25, 5, 0),
        defaultTimestampDisplayPreferences,
        new Date(Date.UTC(2026, 5, 25, 12, 0)),
      ),
    ).toBe("05:00 AM");
  });

  it("formats same-day timestamps with a 24-hour clock", () => {
    const result = formatTimestamp(
      Date.UTC(2026, 5, 25, 5, 0),
      { ...defaultTimestampDisplayPreferences, useMilitaryTime: true },
      new Date(Date.UTC(2026, 5, 25, 12, 0)),
    );

    expect(result).toContain("05:00");
    expect(result).not.toMatch(/AM|PM/);
  });

  it("includes the date for non-today timestamps", () => {
    expect(
      formatTimestamp(
        Date.UTC(2026, 5, 25, 5, 0),
        defaultTimestampDisplayPreferences,
        new Date(Date.UTC(2026, 5, 26, 12, 0)),
      ),
    ).toBe("Jun 25 05:00 AM");
  });

  it("compares today boundaries in the selected timezone", () => {
    const timestamp = Date.UTC(2026, 5, 25, 23, 30);
    const now = new Date(Date.UTC(2026, 5, 26, 0, 30));

    expect(
      formatTimestamp(timestamp, defaultTimestampDisplayPreferences, now),
    ).toContain("Jun 25");
    expect(
      formatTimestamp(
        timestamp,
        { ...defaultTimestampDisplayPreferences, timeZone: "Europe/Rome" },
        now,
      ),
    ).toBe("01:30 AM");
  });
});

describe("renderMarkdown", () => {
  it("returns plain text unchanged", () => {
    const result = renderMarkdown("hello world");
    expect(result).toEqual(["hello world"]);
  });

  it("returns empty array for empty string", () => {
    const result = renderMarkdown("");
    expect(result).toEqual([]);
  });

  it("renders bold text", () => {
    const result = renderMarkdown("**bold**");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("strong");
    expect(el.props.children).toBe("bold");
  });

  it("renders italic text", () => {
    const result = renderMarkdown("*italic*");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("em");
    expect(el.props.children).toBe("italic");
  });

  it("renders inline code", () => {
    const result = renderMarkdown("`code`");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{ children: string }>;
    expect(el.type).toBe("code");
    expect(el.props.children).toBe("code");
  });

  it("renders links", () => {
    const result = renderMarkdown("[click](https://example.com)");
    expect(result).toHaveLength(1);
    const el = result[0] as ReactElement<{
      href: string;
      children: string;
      target: string;
    }>;
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("https://example.com");
    expect(el.props.children).toBe("click");
    expect(el.props.target).toBe("_blank");
  });

  it("does not render unsafe markdown links as clickable anchors", () => {
    const result = renderMarkdown("[click](javascript:alert)");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("click");
  });

  it("renders newlines as br", () => {
    const result = renderMarkdown("line1\nline2");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("line1");
    const br = result[1] as ReactElement;
    expect(br.type).toBe("br");
    expect(result[2]).toBe("line2");
  });

  it("handles mixed markdown", () => {
    const result = renderMarkdown("hello **bold** and *italic*");
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result[0]).toBe("hello ");
    expect((result[1] as ReactElement).type).toBe("strong");
    expect((result[3] as ReactElement).type).toBe("em");
  });

  it("does not render unsafe event link pills as clickable anchors", () => {
    const event: EventEntry = {
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.now(),
      title: "danger",
      event_type: "info",
      links: [{ url: "data:text/html,alert(1)", label: "danger" }],
    };

    const html = renderToStaticMarkup(
      React.createElement(TimelineEntry, {
        event,
        isNew: false,
        isUpdated: false,
        onAnimationEnd: () => undefined,
        onUpdateAnimationEnd: () => undefined,
        enableReactions: false,
        onAddReaction: () => undefined,
        onRemoveReaction: () => undefined,
        onFetchReactionUsers: async () => [],
        getUser: () => undefined,
        timestampDisplayPreferences: defaultTimestampDisplayPreferences,
      }),
    );

    expect(html).toContain("danger");
    expect(html).not.toContain('href="data:text/html,alert(1)"');
  });
});

describe("TimelineEntry", () => {
  it("uses timestamp display preferences for visible time and tooltip", () => {
    const event: EventEntry = {
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "event title",
      event_type: "info",
    };
    const container = queryStaticTimelineEntry(event, {
      locale: "en",
      timeZone: "UTC",
      useMilitaryTime: true,
    });
    const time = container.querySelector(".timeline-entry__time");

    expect(time?.textContent).toContain("05:00");
    expect(time?.textContent).not.toMatch(/AM|PM/);
    expect(time?.getAttribute("title")).not.toMatch(/AM|PM/);
  });

  it("renders compact metadata for present metadata", () => {
    const event: EventEntry = {
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "metadata event",
      event_type: "deploy",
      source: "github-actions",
      severity: "critical",
      status: "open",
      environment: "staging",
      pinned: true,
      expires_at: Date.now() - 1000,
      resolved_at: Date.now() - 500,
    };
    const container = queryStaticTimelineEntry(event);

    expect(container.querySelector(".timeline-entry__source")).toBeNull();
    expect(
      container.querySelector(".timeline-entry__type")?.getAttribute("title"),
    ).toContain("source: github-actions");
    expect(
      Array.from(container.querySelectorAll(".timeline-entry__meta-item")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["critical", "open", "staging", "pinned", "expired", "resolved"]);
    expect(
      container.querySelector(".timeline-entry__meta")?.getAttribute("title"),
    ).toContain("source: github-actions");

    const plain = queryStaticTimelineEntry({
      id: "event-2",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "plain event",
      event_type: "deploy",
    });
    expect(plain.querySelector(".timeline-entry__meta")).toBeNull();
  });

  it("omits successful info metadata from the compact row", () => {
    const container = queryStaticTimelineEntry({
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "quiet success event",
      event_type: "deploy",
      severity: "info",
      status: "success",
      environment: "production",
    });

    expect(
      Array.from(container.querySelectorAll(".timeline-entry__meta-item")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["production"]);
  });

  it("does not duplicate resolved when status already says resolved", () => {
    const container = queryStaticTimelineEntry({
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "resolved event",
      event_type: "deploy",
      status: "resolved",
      resolved_at: Date.now() - 1000,
    });

    expect(
      Array.from(container.querySelectorAll(".timeline-entry__meta-item")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["resolved"]);
  });

  it("keeps unknown event types readable while using the generic fallback icon", () => {
    const container = queryStaticTimelineEntry({
      id: "event-1",
      team_id: "team-1",
      timestamp: Date.UTC(2026, 5, 25, 5, 0),
      title: "custom event",
      event_type: "custom_deploy",
    });

    expect(container.querySelector(".timeline-entry__type")?.textContent).toBe(
      "custom deploy",
    );
    expect(container.querySelector(".timeline-entry__dot svg")).not.toBeNull();
  });
});

describe("timeline event activity helpers", () => {
  const now = 10_000;
  const baseEvent: EventEntry = {
    id: "event-1",
    team_id: "team-1",
    timestamp: now,
    title: "event",
    event_type: "info",
  };

  it.each([
    ["no expiration", {}, false],
    ["future expiration", { expires_at: now + 1 }, false],
    ["expiration at now", { expires_at: now }, true],
    ["past expiration", { expires_at: now - 1 }, true],
  ])("reports expired state for %s", (_name, patch, expected) => {
    expect(isTimelineEventExpired({ ...baseEvent, ...patch }, now)).toBe(
      expected,
    );
  });

  it.each([
    [
      "pinned terminal event remains active",
      { pinned: true, status: "resolved" as const },
      true,
    ],
    [
      "expired critical event is inactive",
      { severity: "critical" as const, expires_at: now },
      false,
    ],
    [
      "terminal critical event is inactive",
      { severity: "critical" as const, status: "failed" as const },
      false,
    ],
    ["open event is active", { status: "open" as const }, true],
    ["running event is active", { status: "running" as const }, true],
    ["critical event is active", { severity: "critical" as const }, true],
    ["plain info event is inactive", { severity: "info" as const }, false],
  ])("reports active state for %s", (_name, patch, expected) => {
    expect(isTimelineEventActive({ ...baseEvent, ...patch }, now)).toBe(
      expected,
    );
  });
});
