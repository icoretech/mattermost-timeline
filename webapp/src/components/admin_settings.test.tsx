import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import manifest from "../manifest";
import { withIntl } from "../test_utils";

function renderIntl(root: Root, children: React.ReactNode) {
  root.render(withIntl(children));
}

import AdminSettings, { WebhookTokensSetting } from "./admin_settings";

async function renderAdminSettings() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    renderIntl(root, <AdminSettings />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return { container, root };
}

type RenderWebhookTokensSettingOptions = {
  value?: string;
  disabled?: boolean;
};

async function flushAsyncUpdates(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function renderWebhookTokensSetting({
  value = "[]",
  disabled = false,
}: RenderWebhookTokensSettingOptions = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    renderIntl(
      root,
      <WebhookTokensSetting value={value} disabled={disabled} />,
    );
    await flushAsyncUpdates();
  });

  return { container, root };
}

async function cleanup(root: Root, container: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function changeInputValue(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  if (!input) return;
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function lastFetchBody() {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  const [, init] = calls[calls.length - 1] as [string, RequestInit];
  return JSON.parse(String(init.body)) as unknown;
}

function tokenInput(container: HTMLElement, label: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[aria-label="${label}"], textarea[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`Missing field ${label}`);
  return input;
}

function tokenButton(container: HTMLElement, text: string) {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  return button;
}

function mockWebhookConfigResponse(
  tokens: unknown[] = [],
  requireSignedWebhooks = false,
) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        legacy_secret_configured: false,
        require_signed_webhooks: requireSignedWebhooks,
        tokens,
        webhook_path: "/webhook",
        batch_webhook_path: "/webhook/batch",
      }),
  } as Response;
}

function mockTextResponse(ok: boolean, text: string) {
  return {
    ok,
    status: ok ? 200 : 500,
    text: () => Promise.resolve(text),
  } as Response;
}

describe("WebhookTokensSetting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("retranslates a validation notice on locale change without losing token drafts", async () => {
    const value = JSON.stringify([
      { name: "sample-token", secret: "sample-secret" },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTextResponse(
        false,
        JSON.stringify({
          code: "token_name_duplicate",
          params: { name: "edited-token" },
        }),
      ),
    );
    const { container, root } = await renderWebhookTokensSetting({ value });
    await act(async () => {
      changeInputValue(tokenInput(container, "Token 1 name"), "edited-token");
      await flushAsyncUpdates();
    });
    await act(async () => {
      tokenButton(container, "Save tokens").click();
      await flushAsyncUpdates();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "A token named edited-token already exists.",
    );
    await act(async () => {
      root.render(withIntl(<WebhookTokensSetting value={value} />, "ko"));
      await flushAsyncUpdates();
    });
    const alert = container.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain("edited-token");
    expect(alert).not.toContain("A token named");
    expect(
      container.querySelector<HTMLInputElement>('input[type="text"]')?.value,
    ).toBe("edited-token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await cleanup(root, container);
  });

  it("cancels a pending token save when the editor unmounts", async () => {
    const pending = Promise.withResolvers<Response>();
    globalThis.fetch = vi.fn().mockReturnValue(pending.promise);
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        { name: "sample-token", secret: "sample-secret" },
      ]),
    });
    await act(async () => {
      changeInputValue(tokenInput(container, "Token 1 name"), "edited-token");
      await flushAsyncUpdates();
    });
    await act(async () => tokenButton(container, "Save tokens").click());
    const signal = vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await cleanup(root, container);
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(mockWebhookConfigResponse());
      await flushAsyncUpdates();
    });
    expect(container.childElementCount).toBe(0);
  });

  it("connects scope hints to the fields and provides expandable sending instructions", async () => {
    globalThis.fetch = vi.fn();
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        { name: "sample-token", secret: "sample-secret" },
      ]),
    });

    for (const field of ["name", "secret", "team", "channels"]) {
      const input = tokenInput(container, `Token 1 ${field}`);
      const descriptionId = input.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(
        document.getElementById(descriptionId || "")?.textContent,
      ).toBeTruthy();
    }

    const guide = container.querySelector("details");
    expect(guide?.open).toBe(false);
    await act(async () => {
      guide?.querySelector("summary")?.click();
      await flushAsyncUpdates();
    });
    expect(guide?.open).toBe(true);
    expect(guide?.textContent).toContain("X-Webhook-Secret");
    expect(guide?.textContent).toContain("X-Timeline-Timestamp");
    expect(guide?.textContent).toContain("X-Timeline-Signature");
    expect(guide?.textContent).toContain("HMAC-SHA256");

    await cleanup(root, container);
  });

  it("renders non-empty saved token JSON as structured credential fields", async () => {
    globalThis.fetch = vi.fn();
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        {
          name: "github-actions",
          secret: "token-secret",
          enabled: true,
          team: "example-org",
          channels: ["town-square", "deployments"],
          require_signature: true,
        },
      ]),
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Token 1");
    expect(tokenInput(container, "Token 1 name").value).toBe("github-actions");
    expect(tokenInput(container, "Token 1 secret").value).toBe("token-secret");
    expect(tokenInput(container, "Token 1 team").value).toBe("example-org");
    expect(tokenInput(container, "Token 1 channels").value).toBe(
      "town-square\ndeployments",
    );
    expect(
      (tokenInput(container, "Token 1 enabled") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (tokenInput(container, "Token 1 require signature") as HTMLInputElement)
        .checked,
    ).toBe(true);

    await cleanup(root, container);
  });

  it("loads sanitized token rows from the admin config API when the saved value is empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockWebhookConfigResponse([
        {
          name: "deploy-bot",
          enabled: true,
          team: "example-org",
          channels: ["town-square", "deployments"],
          require_signature: true,
        },
      ]),
    );

    const { container, root } = await renderWebhookTokensSetting({
      value: "[]",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/plugins/${manifest.id}/api/v1/admin/webhook-config`,
      {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(tokenInput(container, "Token 1 name").value).toBe("deploy-bot");
    expect(tokenInput(container, "Token 1 secret").value).toBe("");
    expect(tokenInput(container, "Token 1 team").value).toBe("example-org");
    expect(tokenInput(container, "Token 1 channels").value).toBe(
      "town-square\ndeployments",
    );
    expect(
      (tokenInput(container, "Token 1 require signature") as HTMLInputElement)
        .checked,
    ).toBe(true);

    await cleanup(root, container);
  });

  it("saves added, edited, and removed credentials with normalized PUT JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockWebhookConfigResponse([
        {
          name: "deploy-prod",
          enabled: false,
          team: "example-org",
          channels: ["town-square", "deployments", "alerts"],
          require_signature: true,
        },
      ]),
    );
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        {
          name: "old-token",
          secret: "old-secret",
          enabled: true,
          team: "old-team",
          channels: ["old-channel"],
          require_signature: false,
        },
      ]),
    });

    await act(async () => {
      tokenButton(container, "Add token").click();
      await flushAsyncUpdates();
    });

    await act(async () => {
      changeInputValue(tokenInput(container, "Token 2 name"), " deploy-prod ");
      changeInputValue(tokenInput(container, "Token 2 secret"), " new-secret ");
      changeInputValue(tokenInput(container, "Token 2 team"), " example-org ");
      changeInputValue(
        tokenInput(container, "Token 2 channels"),
        "town-square, deployments\nalerts",
      );
      tokenInput(container, "Token 2 enabled").click();
      tokenInput(container, "Token 2 require signature").click();
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove token 1"]')
        ?.click();
      await flushAsyncUpdates();
    });

    await act(async () => {
      tokenButton(container, "Save tokens").click();
      await flushAsyncUpdates();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/plugins/${manifest.id}/api/v1/admin/webhook-tokens`,
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      }),
    );
    expect(lastFetchBody()).toEqual({
      tokens: [
        {
          name: "deploy-prod",
          secret: "new-secret",
          enabled: false,
          team: "example-org",
          channels: ["town-square", "deployments", "alerts"],
          require_signature: true,
        },
      ],
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Tokens saved",
    );
    expect(tokenInput(container, "Token 1 name").value).toBe("deploy-prod");
    expect(tokenInput(container, "Token 1 secret").value).toBe("");
    expect(tokenInput(container, "Token 1 channels").value).toBe(
      "town-square\ndeployments\nalerts",
    );

    await cleanup(root, container);
  });

  it("saves once for repeated clicks and allows retry after a failed save", async () => {
    const pendingSave = Promise.withResolvers<Response>();
    globalThis.fetch = vi.fn().mockReturnValueOnce(pendingSave.promise);
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        { name: "sample-token", secret: "sample-secret" },
      ]),
    });
    await act(async () => {
      changeInputValue(tokenInput(container, "Token 1 name"), "renamed-token");
      await flushAsyncUpdates();
    });
    const button = tokenButton(container, "Save tokens");
    await act(async () => {
      button.click();
      button.click();
      await flushAsyncUpdates();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await act(async () => {
      pendingSave.resolve(mockTextResponse(false, "temporary failure"));
      await flushAsyncUpdates();
    });
    expect(button.disabled).toBe(false);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockWebhookConfigResponse([
        { name: "renamed-token", enabled: true, require_signature: false },
      ]),
    );
    await act(async () => {
      button.click();
      await flushAsyncUpdates();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Tokens saved");
    await cleanup(root, container);
  });

  it("renders structured token-save validation as a localized alert", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTextResponse(
        false,
        JSON.stringify({
          code: "token_name_duplicate",
          params: { name: "deploy-prod" },
        }),
      ),
    );
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        {
          name: "deploy",
          secret: "deploy-secret",
          enabled: true,
          channels: [],
          require_signature: false,
        },
      ]),
    });

    await act(async () => {
      changeInputValue(tokenInput(container, "Token 1 name"), "deploy-prod");
      await flushAsyncUpdates();
    });

    await act(async () => {
      tokenButton(container, "Save tokens").click();
      await flushAsyncUpdates();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "A token named deploy-prod already exists.",
    );

    await cleanup(root, container);
  });

  it("shows invalid current JSON and refuses to fetch or save credentials", async () => {
    globalThis.fetch = vi.fn();
    const { container, root } = await renderWebhookTokensSetting({
      value: "{not valid json",
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid Webhook Tokens JSON",
    );

    await act(async () => {
      tokenButton(container, "Add token").click();
      tokenButton(container, "Save tokens").click();
      await flushAsyncUpdates();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();

    await cleanup(root, container);
  });

  it("preserves unsaved edits when an equivalent saved value is rendered again", async () => {
    const savedTokens = [{ name: "sample-token", secret: "sample-secret" }];
    const value = JSON.stringify(savedTokens);
    globalThis.fetch = vi.fn();
    const { container, root } = await renderWebhookTokensSetting({ value });
    const nameInput = tokenInput(container, "Token 1 name");

    await act(async () => {
      changeInputValue(nameInput, "edited-token");
      await flushAsyncUpdates();
    });
    await act(async () => {
      renderIntl(
        root,
        <WebhookTokensSetting
          value={JSON.stringify(savedTokens, null, 2)}
          disabled={true}
        />,
      );
      await flushAsyncUpdates();
    });

    expect(tokenInput(container, "Token 1 name")).toBe(nameInput);
    expect(nameInput.value).toBe("edited-token");
    expect(nameInput.disabled).toBe(true);
    expect(container.textContent).toContain("Unsaved token changes");

    await act(async () => {
      renderIntl(root, <WebhookTokensSetting value={value} />);
      await flushAsyncUpdates();
    });

    expect(nameInput.disabled).toBe(false);
    expect(tokenButton(container, "Save tokens").disabled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await cleanup(root, container);
  });

  it("resets drafts and save errors when the saved credentials change", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTextResponse(
        false,
        JSON.stringify({
          code: "token_name_duplicate",
          params: { name: "deploy-prod" },
        }),
      ),
    );
    const { container, root } = await renderWebhookTokensSetting({
      value: JSON.stringify([
        { name: "sample-token", secret: "sample-secret" },
      ]),
    });

    await act(async () => {
      changeInputValue(tokenInput(container, "Token 1 name"), "edited-token");
      await flushAsyncUpdates();
    });
    await act(async () => {
      tokenButton(container, "Save tokens").click();
      await flushAsyncUpdates();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "A token named deploy-prod already exists.",
    );

    await act(async () => {
      renderIntl(
        root,
        <WebhookTokensSetting
          value={JSON.stringify([{ name: "replacement-token" }])}
        />,
      );
      await flushAsyncUpdates();
    });

    expect(tokenInput(container, "Token 1 name").value).toBe(
      "replacement-token",
    );
    expect(tokenInput(container, "Token 1 secret").value).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Unsaved token changes");
    expect(tokenButton(container, "Save tokens").disabled).toBe(true);

    await cleanup(root, container);
  });

  it("ignores an earlier token load after the saved credentials change", async () => {
    const pendingLoad = Promise.withResolvers<Response>();
    globalThis.fetch = vi.fn().mockReturnValue(pendingLoad.promise);
    const { container, root } = await renderWebhookTokensSetting();

    expect(container.textContent).toContain("Loading token credentials...");
    expect(tokenButton(container, "Add token").disabled).toBe(true);
    const signal = vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      renderIntl(
        root,
        <WebhookTokensSetting
          value={JSON.stringify([{ name: "replacement-token" }])}
        />,
      );
      await flushAsyncUpdates();
    });
    await act(async () => {
      pendingLoad.resolve(
        mockWebhookConfigResponse([
          { name: "stale-token", enabled: true, require_signature: false },
        ]),
      );
      await flushAsyncUpdates();
    });

    expect(signal?.aborted).toBe(true);
    expect(tokenInput(container, "Token 1 name").value).toBe(
      "replacement-token",
    );
    expect(container.textContent).not.toContain("Loading token credentials...");
    expect(tokenButton(container, "Add token").disabled).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await cleanup(root, container);
  });

  it("leaves loading state and displays token-load errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockTextResponse(false, "configuration unavailable"));
    const { container, root } = await renderWebhookTokensSetting();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Request failed (HTTP 500).",
    );
    expect(container.textContent).not.toContain("Loading token credentials...");
    expect(tokenButton(container, "Add token").disabled).toBe(false);

    await cleanup(root, container);
  });
});

describe("AdminSettings", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          legacy_secret_configured: true,
          require_signed_webhooks: true,
          tokens: [
            {
              name: "github-actions",
              enabled: true,
              team: "example-org",
              channels: ["town-square"],
              require_signature: true,
            },
          ],
          webhook_path:
            "/plugins/ch.icorete.mattermost-timeline/webhook?team_id=<team-id-or-name>",
          batch_webhook_path:
            "/plugins/ch.icorete.mattermost-timeline/webhook/batch?team_id=<team-id-or-name>",
        }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("uses localized HTTP fallback and metadata diagnostics for unknown error codes", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTextResponse(
        false,
        JSON.stringify({
          code: "future_server_error",
          message: "internal diagnostic must not appear in the UI",
        }),
      ),
    );
    const { container, root } = await renderAdminSettings();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Request failed (HTTP 500).",
    );
    expect(container.textContent).not.toContain("internal diagnostic");
    expect(diagnostic).toHaveBeenCalledWith(
      "Unrecognized timeline admin error",
      { status: 500, code: "future_server_error" },
    );
    await cleanup(root, container);
  });

  it("renders sanitized webhook config status without exposing secrets", async () => {
    const { container, root } = await renderAdminSettings();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/plugins/${manifest.id}/api/v1/admin/webhook-config`,
      {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(container.querySelector("dt")?.textContent).toBe(
      "Shared secret Legacy",
    );
    expect(container.textContent).toContain("configured");
    expect(container.textContent).toContain("Signed webhooks");
    expect(container.textContent).toContain("required");
    expect(container.textContent).toContain("Configured tokens");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("github-actions");
    expect(container.textContent).toContain("signature required");
    expect(container.textContent).not.toContain("replace-with-secret");

    await cleanup(root, container);
  });

  it("shows the global signature requirement on tokens without an individual requirement", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockWebhookConfigResponse(
          [{ name: "sample-token", enabled: true, require_signature: false }],
          true,
        ),
      );
    const { container, root } = await renderAdminSettings();

    expect(
      container.querySelector('[aria-label="Configured webhook tokens"]')
        ?.textContent,
    ).toContain("signature required");
    expect(container.textContent).toContain("required for all");

    await cleanup(root, container);
  });

  it("copies absolute webhook URLs with the team placeholder intact", async () => {
    const { container, root } = await renderAdminSettings();
    const [copyWebhook, copyBatch] = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );

    await act(async () => {
      copyWebhook.click();
      await Promise.resolve();
    });
    const webhookURL = new URL(
      vi.mocked(navigator.clipboard.writeText).mock.calls[0][0],
    );
    expect(webhookURL.origin).toBe(window.location.origin);
    expect(webhookURL.pathname).toBe(`/plugins/${manifest.id}/webhook`);
    expect(webhookURL.searchParams.get("team_id")).toBe("<team-id-or-name>");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Webhook URL copied",
    );

    await act(async () => {
      copyBatch.click();
      await Promise.resolve();
    });
    const batchURL = new URL(
      vi.mocked(navigator.clipboard.writeText).mock.calls[1][0],
    );
    expect(batchURL.origin).toBe(window.location.origin);
    expect(batchURL.pathname).toBe(`/plugins/${manifest.id}/webhook/batch`);
    expect(batchURL.searchParams.get("team_id")).toBe("<team-id-or-name>");

    await cleanup(root, container);
  });

  it("reports an unavailable clipboard instead of claiming that a URL was copied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { container, root } = await renderAdminSettings();
    const copyWebhook = tokenButton(container, "Copy webhook URL");

    await act(async () => {
      copyWebhook.click();
      await flushAsyncUpdates();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Clipboard is not available in this browser",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();

    await cleanup(root, container);
  });

  it("posts test event input and renders the created event", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            legacy_secret_configured: false,
            require_signed_webhooks: false,
            tokens: [],
            webhook_path: "/webhook",
            batch_webhook_path: "/webhook/batch",
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "event-1",
            title: "Mattermost Timeline test event",
          }),
      } as Response);
    const { container, root } = await renderAdminSettings();
    const [teamInput, channelInput] = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    );
    const sendButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Send test event");

    await act(async () => {
      changeInputValue(teamInput, "example-org");
      changeInputValue(channelInput, "town-square");
      await Promise.resolve();
    });

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      `/plugins/${manifest.id}/api/v1/admin/test-event`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          team_id: "example-org",
          channel_id: "town-square",
        }),
      }),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Created Mattermost Timeline test event (event-1)",
    );

    await cleanup(root, container);
  });

  it("cancels a pending configuration request when the tools unmount", async () => {
    const pendingLoad = Promise.withResolvers<Response>();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(pendingLoad.promise);
    const { container, root } = await renderAdminSettings();
    const signal = vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await cleanup(root, container);
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pendingLoad.resolve(mockWebhookConfigResponse());
      await flushAsyncUpdates();
    });
    expect(container.childElementCount).toBe(0);
  });

  it("sends one event for repeated clicks and allows retry after a failed request", async () => {
    const { container, root } = await renderAdminSettings();
    const pendingSend = Promise.withResolvers<Response>();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(pendingSend.promise);
    const button = tokenButton(container, "Send test event");
    await act(async () => {
      button.click();
      button.click();
      await flushAsyncUpdates();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    await act(async () => {
      pendingSend.resolve(mockTextResponse(false, "temporary failure"));
      await flushAsyncUpdates();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Request failed (HTTP 500).",
    );
    expect(button.disabled).toBe(false);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "retried-event", title: "Test event" }),
    } as Response);
    await act(async () => {
      button.click();
      await flushAsyncUpdates();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Created Test event (retried-event)",
    );
    await cleanup(root, container);
  });

  it("renders server errors from test-event submission", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            legacy_secret_configured: false,
            require_signed_webhooks: false,
            tokens: [],
            webhook_path: "/webhook",
            batch_webhook_path: "/webhook/batch",
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("System admin permission required"),
      } as Response);
    const { container, root } = await renderAdminSettings();
    const sendButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Send test event");

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "System admin permission required",
    );

    await cleanup(root, container);
  });
});
