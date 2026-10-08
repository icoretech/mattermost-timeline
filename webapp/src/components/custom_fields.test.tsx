import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "../test_utils";
import type { EventEntry } from "../types/timeline";
import TimelineEntry from "./timeline_entry";

function renderFields(custom_fields?: EventEntry["custom_fields"]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    withIntl(
      <TimelineEntry
        event={{
          id: "sample-event",
          team_id: "sample-team",
          timestamp: 1000,
          title: "Sample event",
          event_type: "info",
          message: "Message",
          status: "closed",
          custom_fields,
          links: [{ url: "https://example.com", label: "Details" }],
        }}
        isNew={false}
        isUpdated={false}
        onAnimationEnd={() => undefined}
        onUpdateAnimationEnd={() => undefined}
        enableReactions={true}
        timestampDisplayPreferences={{
          locale: "en",
          timeZone: "UTC",
          useMilitaryTime: true,
        }}
        onAddReaction={() => undefined}
        onRemoveReaction={() => undefined}
        onFetchReactionUsers={async () => []}
        getUser={() => undefined}
      />,
    ),
  );
  return container;
}

describe("custom field rendering", () => {
  it("renders labels and native scalars in supplied order", () => {
    const container = renderFields([
      { name: "version", label: "Release version", value: "v1.2" },
      { name: "attempts", label: "", value: 0 },
      { name: "ready", value: false },
      { name: "approved", value: true },
    ]);

    expect(
      Array.from(container.querySelectorAll("dl dt, dl dd"), (node) => [
        node.tagName,
        node.textContent,
      ]),
    ).toEqual([
      ["DT", "Release version"],
      ["DD", "v1.2"],
      ["DT", "attempts"],
      ["DD", "0"],
      ["DT", "ready"],
      ["DD", "false"],
      ["DT", "approved"],
      ["DD", "true"],
    ]);
  });

  it("places fields after message and before links and reactions", () => {
    const container = renderFields([{ name: "version", value: "v1.2" }]);

    expect(
      Array.from(
        container.querySelector(".timeline-entry__content")?.children || [],
        (node) => node.className,
      ),
    ).toEqual([
      "timeline-entry__header",
      "timeline-entry__meta",
      "timeline-entry__title",
      "timeline-entry__message",
      "timeline-entry__custom-fields",
      "timeline-entry__links",
      "reaction-bar",
    ]);
    expect(container.querySelector(".timeline-entry__meta")?.textContent).toBe(
      "closed",
    );
  });

  it("renders HTML, Markdown, and URLs as literal text", () => {
    const label = '<img src=x onerror="alert(1)">';
    const value =
      "<script>alert(1)</script> **bold** [link](https://example.com) https://example.com";
    const container = renderFields([{ name: "unsafe", label, value }]);
    const list = container.querySelector("dl");

    expect(list?.querySelector("dt")?.textContent).toBe(label);
    expect(list?.querySelector("dd")?.textContent).toBe(value);
    expect(list?.querySelector("img, script, a, strong")).toBeNull();
  });

  it.each([undefined, []])("omits the block when fields are %j", (fields) => {
    expect(renderFields(fields).querySelector("dl")).toBeNull();
  });
});
