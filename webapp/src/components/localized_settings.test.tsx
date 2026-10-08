import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import pluginManifest from "../../../plugin.json";
import { withIntl } from "../test_utils";
import { registerLocalizedAdminSettings } from "./admin_settings_registration";
import { LocalizedSetting } from "./localized_settings";

afterEach(() => document.body.replaceChildren());

it("keeps server configuration defaults and secret flags in the custom manifest schema", () => {
  expect(pluginManifest.settings_schema.header).toBe("");
  expect(pluginManifest.settings_schema.footer).toBe("");
  expect(
    pluginManifest.settings_schema.settings.map(
      ({ key, type, default: value }) => ({ key, type, value }),
    ),
  ).toEqual([
    { key: "WebhookTokens", type: "custom", value: "[]" },
    { key: "RequireSignedWebhooks", type: "custom", value: false },
    { key: "WebhookSecret", type: "custom", value: "" },
    { key: "WebhookTools", type: "custom", value: "" },
    { key: "MaxEventsStored", type: "custom", value: "500" },
    { key: "MaxEventsDisplayed", type: "custom", value: "100" },
    { key: "TimelineOrder", type: "custom", value: "oldest_first" },
    { key: "EnableReactions", type: "custom", value: true },
  ]);
  expect(
    pluginManifest.settings_schema.settings
      .filter((setting) => setting.secret)
      .map(({ key }) => key),
  ).toEqual(["WebhookTokens", "WebhookSecret"]);
});

it("registers all eight settings with component-owned translated titles", () => {
  const registerAdminConsoleCustomSetting = vi.fn();
  registerLocalizedAdminSettings({ registerAdminConsoleCustomSetting });
  expect(
    registerAdminConsoleCustomSetting.mock.calls.map(([key]) => key).sort(),
  ).toEqual([
    "EnableReactions",
    "MaxEventsDisplayed",
    "MaxEventsStored",
    "RequireSignedWebhooks",
    "TimelineOrder",
    "WebhookSecret",
    "WebhookTokens",
    "WebhookTools",
  ]);
  for (const [, component, options] of registerAdminConsoleCustomSetting.mock
    .calls) {
    expect(typeof component).toBe("function");
    expect(options).toEqual({ showTitle: false });
  }
});

it("passes actual host ids and primitive boolean/string values through the native save callback", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      withIntl(
        <>
          <LocalizedSetting
            setting="EnableReactions"
            id="PluginSettings.Plugins.timeline.EnableReactions"
            value={true}
            onChange={onChange}
          />
          <LocalizedSetting
            setting="MaxEventsStored"
            id="PluginSettings.Plugins.timeline.MaxEventsStored"
            value="500"
            onChange={onChange}
          />
          <LocalizedSetting
            setting="TimelineOrder"
            id="PluginSettings.Plugins.timeline.TimelineOrder"
            value="oldest_first"
            onChange={onChange}
          />
          <LocalizedSetting
            setting="WebhookSecret"
            id="PluginSettings.Plugins.timeline.WebhookSecret"
            value="existing-secret"
            onChange={onChange}
          />
        </>,
      ),
    ),
  );
  await act(async () => {
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    radios[1].click();
    const input =
      container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error("Missing event count input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "750");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const select = container.querySelector("select");
    if (!select) throw new Error("Missing order select");
    select.value = "newest_first";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange.mock.calls).toEqual([
    ["PluginSettings.Plugins.timeline.EnableReactions", false],
    ["PluginSettings.Plugins.timeline.MaxEventsStored", "750"],
    ["PluginSettings.Plugins.timeline.TimelineOrder", "newest_first"],
  ]);
  expect(
    container.querySelector<HTMLInputElement>('input[type="password"]')?.value,
  ).toBe("existing-secret");
  expect(container.textContent).not.toContain("existing-secret");
  await act(async () => root.unmount());
});

it("translates labels, help and options using the host locale while honoring disabled state", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      withIntl(
        <LocalizedSetting
          setting="TimelineOrder"
          id="order"
          value="newest_first"
          disabled={true}
          onChange={onChange}
        />,
        "ko",
      ),
    ),
  );
  expect(container.querySelector("select")?.disabled).toBe(true);
  const select = container.querySelector("select");
  expect(select?.getAttribute("aria-label")).toBe("타임라인 순서");
  expect(container.querySelector("#order-help")?.textContent).toBe(
    "새 이벤트를 타임라인 상단 또는 하단 중 어디에 표시할지 선택하세요.",
  );
  expect(select?.selectedOptions[0]?.textContent).toBe(
    "최신순 (최신 이벤트가 상단에 표시됨)",
  );
  expect(container.textContent).not.toContain("Timeline Order");
  expect(container.textContent).not.toContain("Choose whether");
  expect(container.querySelector("option")?.textContent).not.toContain(
    "Oldest first",
  );
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("uses primitive boolean defaults before the host supplies stored settings", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      withIntl(
        <>
          <LocalizedSetting
            setting="EnableReactions"
            id="reactions"
            onChange={onChange}
          />
          <LocalizedSetting
            setting="RequireSignedWebhooks"
            id="signatures"
            onChange={onChange}
          />
        </>,
      ),
    ),
  );
  const radios = container.querySelectorAll<HTMLInputElement>(
    'input[type="radio"]',
  );
  expect(Array.from(radios, (radio) => radio.checked)).toEqual([
    true,
    false,
    false,
    true,
  ]);
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("shows count defaults for omitted host values and preserves explicitly empty saved strings", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      withIntl(
        <>
          <LocalizedSetting
            setting="MaxEventsStored"
            id="stored"
            onChange={onChange}
          />
          <LocalizedSetting
            setting="MaxEventsDisplayed"
            id="displayed"
            onChange={onChange}
          />
          <LocalizedSetting
            setting="WebhookSecret"
            id="secret"
            onChange={onChange}
          />
        </>,
      ),
    ),
  );
  expect(container.querySelector<HTMLInputElement>("#stored")?.value).toBe(
    "500",
  );
  expect(container.querySelector<HTMLInputElement>("#displayed")?.value).toBe(
    "100",
  );
  expect(container.querySelector<HTMLInputElement>("#secret")?.value).toBe("");
  expect(onChange).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      withIntl(
        <>
          <LocalizedSetting
            setting="MaxEventsStored"
            id="stored"
            value=""
            onChange={onChange}
          />
          <LocalizedSetting
            setting="MaxEventsDisplayed"
            id="displayed"
            value=""
            onChange={onChange}
          />
        </>,
      ),
    ),
  );
  expect(container.querySelector<HTMLInputElement>("#stored")?.value).toBe("");
  expect(container.querySelector<HTMLInputElement>("#displayed")?.value).toBe(
    "",
  );
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
