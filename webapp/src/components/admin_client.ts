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
    const message = (await response.text()).trim();
    throw new Error(message || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchWebhookConfig(signal: AbortSignal) {
  return requestAdminJSON<WebhookConfigResponse>("webhook-config", { signal });
}

export function updateWebhookTokens(tokens: WebhookTokenInput[]) {
  return requestAdminJSON<WebhookConfigResponse>("webhook-tokens", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

export function createTimelineTestEvent(teamId: string, channelId: string) {
  return requestAdminJSON<TestEventResponse>("test-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      channel_id: channelId || undefined,
    }),
  });
}
