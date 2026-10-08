import manifest from "../manifest";

export type SanitizedWebhookToken = {
  name: string;
  enabled: boolean;
  team?: string;
  channels?: string[];
  require_signature: boolean;
};

export type WebhookConfigResponse = {
  legacy_secret_configured: boolean;
  require_signed_webhooks: boolean;
  tokens: SanitizedWebhookToken[];
  webhook_path: string;
  batch_webhook_path: string;
};

type TestEventResponse = {
  id: string;
  title: string;
};

export class AdminAPIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params: Record<string, string> = {},
  ) {
    super(code);
  }
}

export type WebhookTokenInput = {
  name: string;
  secret: string;
  enabled: boolean;
  team: string;
  channels: string[];
  require_signature: boolean;
};

async function requestAdminJSON<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/plugins/${manifest.id}/api/v1/admin/${path}`, {
    ...options,
    headers: { "X-Requested-With": "XMLHttpRequest", ...options.headers },
  });
  if (!response.ok) {
    let code = "unknown";
    const params: Record<string, string> = {};
    const text = await response.text();
    try {
      const body: unknown = JSON.parse(text);
      if (
        body &&
        typeof body === "object" &&
        "code" in body &&
        typeof body.code === "string"
      ) {
        code = body.code;
        if (
          "params" in body &&
          body.params &&
          typeof body.params === "object"
        ) {
          for (const [key, value] of Object.entries(body.params)) {
            if (typeof value === "string") params[key] = value;
          }
        }
      }
    } catch (error) {
      // Older servers may return plain-text errors; use the HTTP status.
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new AdminAPIError(response.status, code, params);
  }
  return (await response.json()) as T;
}

export function fetchWebhookConfig(signal: AbortSignal) {
  return requestAdminJSON<WebhookConfigResponse>("webhook-config", { signal });
}

export function updateWebhookTokens(
  tokens: WebhookTokenInput[],
  signal?: AbortSignal,
) {
  return requestAdminJSON<WebhookConfigResponse>("webhook-tokens", {
    method: "PUT",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

export function createTimelineTestEvent(
  teamId: string,
  channelId: string,
  signal?: AbortSignal,
) {
  return requestAdminJSON<TestEventResponse>("test-event", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      channel_id: channelId || undefined,
    }),
  });
}
