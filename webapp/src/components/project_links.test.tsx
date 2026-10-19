import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import pluginManifest from "../../../plugin.json";
import { ProjectLinks } from "./project_links";

it("places the custom project links before configuration fields without a legacy header", () => {
  const { header, settings } = pluginManifest.settings_schema;

  expect(header).toBe("");
  expect(settings[0]).toEqual({
    key: "ProjectLinks",
    display_name: "Project links",
    type: "custom",
    help_text: "",
    default: "",
  });
});

it("renders accessible external project links with isolated browsing contexts", () => {
  const container = document.createElement("div");

  container.innerHTML = renderToStaticMarkup(<ProjectLinks />);

  const section = container.querySelector(
    'section[aria-label="Project links"]',
  );
  const links = Array.from(section?.querySelectorAll("a") ?? []);
  expect(links.map((link) => [link.textContent, link.href])).toEqual([
    ["@icoretech_inc", "https://x.com/icoretech_inc"],
    [
      "icoretech/mattermost-timeline",
      "https://github.com/icoretech/mattermost-timeline",
    ],
  ]);
  for (const link of links) {
    expect(link.target).toBe("_blank");
    expect(link.relList.contains("noopener")).toBe(true);
    expect(link.relList.contains("noreferrer")).toBe(true);
  }
});

it.each([false, true])(
  "keeps links available without changing settings when host disabled is %s",
  async (disabled) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const HostComponent: React.ComponentType<{
      readonly id: string;
      readonly value: string;
      readonly disabled: boolean;
      readonly onChange: (id: string, value: string) => void;
    }> = ProjectLinks;

    try {
      await act(async () =>
        root.render(
          <HostComponent
            id="PluginSettings.Plugins.timeline.ProjectLinks"
            value=""
            disabled={disabled}
            onChange={onChange}
          />,
        ),
      );

      expect(container.querySelectorAll("a[href]")).toHaveLength(2);
      expect(
        container.querySelector("input, select, textarea, button"),
      ).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
