import React, { useEffect, useMemo, useReducer, useState } from "react";
import manifest from "../manifest";

type SanitizedWebhookToken = {
  name: string;
  enabled: boolean;
  team?: string;
  channels?: string[];
  require_signature: boolean;
};

type WebhookConfigResponse = {
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

type WebhookTokenValue = {
  rowId: string;
  name: string;
  secret: string;
  enabled: boolean;
  team: string;
  channels: string[];
  require_signature: boolean;
};

type WebhookTokensSettingProps = {
  value?: unknown;
  disabled?: boolean;
};

async function readResponseText(response: Response) {
  const text = await response.text();
  return text.trim() || `HTTP ${response.status}`;
}

function isTokenRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((channel) => {
    if (typeof channel !== "string") return [];
    const trimmedChannel = channel.trim();
    return trimmedChannel ? [trimmedChannel] : [];
  });
}

function channelsFromInput(value: string): string[] {
  return value.split(/[\n,]/).flatMap((channel) => {
    const trimmedChannel = channel.trim();
    return trimmedChannel ? [trimmedChannel] : [];
  });
}

let nextTokenRowId = 1;

function createTokenRowId() {
  const rowId = nextTokenRowId;
  nextTokenRowId += 1;
  return `token-${rowId}`;
}

function normalizeToken(value: unknown): WebhookTokenValue {
  const token = isTokenRecord(value) ? value : {};
  return {
    rowId: createTokenRowId(),
    name: typeof token.name === "string" ? token.name.trim() : "",
    secret: typeof token.secret === "string" ? token.secret.trim() : "",
    enabled: typeof token.enabled === "boolean" ? token.enabled : true,
    team: typeof token.team === "string" ? token.team.trim() : "",
    channels: normalizeChannels(token.channels),
    require_signature:
      typeof token.require_signature === "boolean"
        ? token.require_signature
        : false,
  };
}

function parseTokensValue(value: unknown): {
  tokens: WebhookTokenValue[];
  error: string;
} {
  const rawValue =
    typeof value === "string" && value.trim() === "" ? "[]" : value;
  try {
    const parsed =
      typeof rawValue === "string"
        ? (JSON.parse(rawValue) as unknown)
        : rawValue;
    if (!Array.isArray(parsed)) {
      return {
        tokens: [],
        error:
          "Invalid Webhook Tokens JSON: expected an array of token objects.",
      };
    }
    return { tokens: parsed.map(normalizeToken), error: "" };
  } catch {
    return {
      tokens: [],
      error:
        "Invalid Webhook Tokens JSON: fix the saved value before editing tokens.",
    };
  }
}

function tokenRowsFromSanitized(tokens: SanitizedWebhookToken[]) {
  return tokens.map((token) => ({
    rowId: createTokenRowId(),
    name: token.name.trim(),
    secret: "",
    enabled: token.enabled,
    team: token.team?.trim() || "",
    channels: normalizeChannels(token.channels),
    require_signature: token.require_signature,
  }));
}

function tokensForRequest(tokens: WebhookTokenValue[]) {
  return tokens.map((token) => ({
    name: token.name.trim(),
    secret: token.secret.trim(),
    enabled: token.enabled,
    team: token.team.trim(),
    channels: token.channels.flatMap((channel) => {
      const trimmedChannel = channel.trim();
      return trimmedChannel ? [trimmedChannel] : [];
    }),
    require_signature: token.require_signature,
  }));
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const emptyToken = (): WebhookTokenValue => ({
  rowId: createTokenRowId(),
  name: "",
  secret: "",
  enabled: true,
  team: "",
  channels: [],
  require_signature: false,
});

type TokenEditorState = {
  tokens: WebhookTokenValue[];
  dirty: boolean;
  request: "idle" | "loading" | "saving";
  loadError: string;
  saveError: string;
  saveMessage: string;
};

type TokenEditorAction =
  | { type: "loaded" | "saved"; tokens: WebhookTokenValue[] }
  | { type: "loadFailed" | "saveFailed"; error: string }
  | { type: "add"; token: WebhookTokenValue }
  | { type: "update"; rowId: string; updates: Partial<WebhookTokenValue> }
  | { type: "remove"; rowId: string }
  | { type: "saveStarted" };

function tokenEditorReducer(
  state: TokenEditorState,
  action: TokenEditorAction,
): TokenEditorState {
  switch (action.type) {
    case "loaded":
    case "saved":
      return {
        tokens: action.tokens,
        dirty: false,
        request: "idle",
        loadError: "",
        saveError: "",
        saveMessage: action.type === "saved" ? "Tokens saved" : "",
      };
    case "loadFailed":
      return { ...state, request: "idle", loadError: action.error };
    case "saveFailed":
      return { ...state, request: "idle", saveError: action.error };
    case "saveStarted":
      return { ...state, request: "saving", saveError: "", saveMessage: "" };
    case "add":
    case "update":
    case "remove": {
      const tokens =
        action.type === "add"
          ? [...state.tokens, action.token]
          : action.type === "remove"
            ? state.tokens.filter((token) => token.rowId !== action.rowId)
            : state.tokens.map((token) =>
                token.rowId === action.rowId
                  ? { ...token, ...action.updates }
                  : token,
              );
      return { ...state, tokens, dirty: true, saveError: "", saveMessage: "" };
    }
  }
}

function WebhookTokenRow({
  token,
  tokenNumber,
  disabled,
  onChange,
  onRemove,
}: {
  token: WebhookTokenValue;
  tokenNumber: number;
  disabled: boolean;
  onChange: (updates: Partial<WebhookTokenValue>) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="timeline-token-settings__row">
      <legend className="timeline-token-settings__row-header">
        <span>{`Token ${tokenNumber}`}</span>
        <button
          aria-label={`Remove token ${tokenNumber}`}
          className="timeline-token-settings__button timeline-token-settings__button--danger"
          type="button"
          disabled={disabled}
          onClick={onRemove}
        >
          {"Remove"}
        </button>
      </legend>
      <div className="timeline-token-settings__grid">
        <label className="timeline-token-settings__field">
          <span>{"Name"}</span>
          <input
            aria-label={`Token ${tokenNumber} name`}
            aria-describedby={`${token.rowId}-name-help`}
            placeholder="e.g. deploy-bot"
            disabled={disabled}
            type="text"
            value={token.name}
            onChange={(event) => onChange({ name: event.currentTarget.value })}
          />
          <small
            id={`${token.rowId}-name-help`}
            className="timeline-token-settings__help"
          >
            {
              "A unique name for this integration. Used as the event source when the sender omits source."
            }
          </small>
        </label>
        <label className="timeline-token-settings__field">
          <span>{"Secret"}</span>
          <input
            aria-label={`Token ${tokenNumber} secret`}
            aria-describedby={`${token.rowId}-secret-help`}
            autoComplete="new-password"
            disabled={disabled}
            type="password"
            value={token.secret}
            onChange={(event) =>
              onChange({ secret: event.currentTarget.value })
            }
          />
          <small
            id={`${token.rowId}-secret-help`}
            className="timeline-token-settings__help"
          >
            {
              "New or renamed tokens need a secret before they can be enabled. Leave blank to keep an existing token's secret."
            }
          </small>
        </label>
        <label className="timeline-token-settings__field timeline-token-settings__field--wide">
          <span>{"Allowed team (optional)"}</span>
          <input
            aria-label={`Token ${tokenNumber} team`}
            aria-describedby={`${token.rowId}-team-help`}
            disabled={disabled}
            placeholder="e.g. example-org"
            type="text"
            value={token.team}
            onChange={(event) => onChange({ team: event.currentTarget.value })}
          />
          <small
            id={`${token.rowId}-team-help`}
            className="timeline-token-settings__help"
          >
            {"Leave blank for any team, or enter one team name or ID."}
          </small>
        </label>
        <label className="timeline-token-settings__field timeline-token-settings__field--wide">
          <span>{"Allowed channels (optional)"}</span>
          <textarea
            aria-label={`Token ${tokenNumber} channels`}
            aria-describedby={`${token.rowId}-channels-help`}
            disabled={disabled}
            placeholder="e.g. town-square, alerts"
            rows={2}
            value={token.channels.join("\n")}
            onChange={(event) =>
              onChange({
                channels: channelsFromInput(event.currentTarget.value),
              })
            }
          />
          <small
            id={`${token.rowId}-channels-help`}
            className="timeline-token-settings__help"
          >
            {
              "Leave blank for all channels and team-wide events. To restrict delivery, list channel names or IDs separated by commas or new lines. The sender must include allowed channels in its payload."
            }
          </small>
        </label>
      </div>
      <div className="timeline-token-settings__checks">
        <label>
          <input
            aria-label={`Token ${tokenNumber} enabled`}
            checked={token.enabled}
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              onChange({
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span>{"Accept events"}</span>
        </label>
        <label>
          <input
            aria-label={`Token ${tokenNumber} require signature`}
            checked={token.require_signature}
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              onChange({
                require_signature: event.currentTarget.checked,
              })
            }
          />
          <span>{"Require signed requests"}</span>
        </label>
      </div>
      <small className="timeline-token-settings__help">
        {
          "Uncheck Accept events to pause this integration without deleting its token."
        }
      </small>
    </fieldset>
  );
}

export function WebhookTokensSetting({
  value = "[]",
  disabled = false,
}: WebhookTokensSettingProps) {
  const parsed = useMemo(() => parseTokensValue(value), [value]);
  const savedValueKey = JSON.stringify({
    tokens: tokensForRequest(parsed.tokens),
    error: parsed.error,
  });

  return (
    <WebhookTokensEditor
      key={savedValueKey}
      initialTokens={parsed.tokens}
      parseError={parsed.error}
      disabled={disabled}
    />
  );
}

function WebhookRequestHelp() {
  return (
    <details className="timeline-token-settings__guide">
      <summary>{"How to send events"}</summary>
      <p>
        {
          "Copy a webhook URL below and replace its team_id value with a team name or ID. Send a JSON body with a title, for example:"
        }
      </p>
      <pre>
        <code>{'{"title":"Deployment completed","status":"success"}'}</code>
      </pre>
      <p>
        {"For unsigned requests, send the token's secret in the "}
        <code>{"X-Webhook-Secret"}</code>
        {" header."}
      </p>
      <p>
        {"When signatures are required, send "}
        <code>{"X-Timeline-Timestamp"}</code>
        {" (Unix seconds) and "}
        <code>{"X-Timeline-Signature"}</code>
        {
          ". Sign the timestamp, a dot and the exact request body with HMAC-SHA256 and the token secret:"
        }
      </p>
      <pre>
        <code>
          {
            "X-Timeline-Timestamp: <unix-seconds>\nX-Timeline-Signature: sha256=<hex-hmac>\n\nmessage to sign = <unix-seconds>.<request-body>"
          }
        </code>
      </pre>
      <p>
        {
          "Use a fresh timestamp for each request. Timestamps outside a five-minute window and repeated signatures are rejected."
        }
      </p>
    </details>
  );
}

function WebhookTokensEditor({
  initialTokens,
  parseError,
  disabled,
}: {
  initialTokens: WebhookTokenValue[];
  parseError: string;
  disabled: boolean;
}) {
  const shouldLoadTokens = !parseError && initialTokens.length === 0;
  const [state, dispatch] = useReducer(tokenEditorReducer, {
    tokens: initialTokens,
    dirty: false,
    request: shouldLoadTokens ? "loading" : "idle",
    loadError: "",
    saveError: "",
    saveMessage: "",
  });
  const { tokens, dirty, loadError, saveError, saveMessage } = state;
  const isLoading = state.request === "loading";
  const isSaving = state.request === "saving";

  useEffect(() => {
    if (!shouldLoadTokens) return;
    let cancelled = false;

    async function loadTokens() {
      try {
        const response = await fetch(
          `/plugins/${manifest.id}/api/v1/admin/webhook-config`,
          { headers: { "X-Requested-With": "XMLHttpRequest" } },
        );
        if (!response.ok) {
          throw new Error(await readResponseText(response));
        }
        const data = (await response.json()) as WebhookConfigResponse;
        if (!cancelled) {
          dispatch({
            type: "loaded",
            tokens: tokenRowsFromSanitized(data.tokens),
          });
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "loadFailed",
            error: messageFromError(
              error,
              "Failed to load webhook token credentials",
            ),
          });
        }
      }
    }

    void loadTokens();
    return () => {
      cancelled = true;
    };
  }, [shouldLoadTokens]);

  const saveTokens = async () => {
    dispatch({ type: "saveStarted" });
    try {
      const response = await fetch(
        `/plugins/${manifest.id}/api/v1/admin/webhook-tokens`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ tokens: tokensForRequest(tokens) }),
        },
      );
      if (!response.ok) {
        throw new Error(await readResponseText(response));
      }
      const data = (await response.json()) as WebhookConfigResponse;
      dispatch({ type: "saved", tokens: tokenRowsFromSanitized(data.tokens) });
    } catch (error) {
      dispatch({
        type: "saveFailed",
        error: messageFromError(
          error,
          "Failed to save webhook token credentials",
        ),
      });
    }
  };

  const controlsDisabled =
    disabled || Boolean(parseError) || isLoading || isSaving;
  const canSave = dirty && !controlsDisabled;

  return (
    <div className="timeline-token-settings">
      <p className="timeline-token-settings__intro">
        {
          "Create one token per integration. Give it a name and secret, then choose which teams and channels it can publish to."
        }
      </p>
      {isLoading && (
        <div className="timeline-token-settings__message" role="status">
          {"Loading token credentials..."}
        </div>
      )}
      {parseError && (
        <div className="timeline-token-settings__error" role="alert">
          {parseError}
        </div>
      )}
      {loadError && (
        <div className="timeline-token-settings__error" role="alert">
          {loadError}
        </div>
      )}
      <div className="timeline-token-settings__rows">
        {tokens.map((token, index) => (
          <WebhookTokenRow
            key={token.rowId}
            token={token}
            tokenNumber={index + 1}
            disabled={controlsDisabled}
            onChange={(updates) =>
              dispatch({ type: "update", rowId: token.rowId, updates })
            }
            onRemove={() => dispatch({ type: "remove", rowId: token.rowId })}
          />
        ))}
      </div>
      {tokens.length === 0 && !parseError && !isLoading && (
        <div className="timeline-token-settings__empty">
          {"No tokens yet. Select Add token to connect your first integration."}
        </div>
      )}
      <div className="timeline-token-settings__actions">
        <button
          className="timeline-token-settings__button"
          type="button"
          disabled={controlsDisabled}
          onClick={() => dispatch({ type: "add", token: emptyToken() })}
        >
          {"Add token"}
        </button>
        <button
          className="timeline-token-settings__button timeline-token-settings__button--primary"
          type="button"
          disabled={!canSave}
          onClick={saveTokens}
        >
          {isSaving ? "Saving..." : "Save tokens"}
        </button>
        {dirty && !isSaving && !saveMessage && (
          <span className="timeline-token-settings__note" role="status">
            {"Unsaved token changes"}
          </span>
        )}
      </div>
      {saveMessage && (
        <div className="timeline-token-settings__message" role="status">
          {saveMessage}
        </div>
      )}
      {saveError && (
        <div className="timeline-token-settings__error" role="alert">
          {saveError}
        </div>
      )}
      <WebhookRequestHelp />
    </div>
  );
}

export default function AdminSettings() {
  const [config, setConfig] = useState<WebhookConfigResponse | null>(null);
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/plugins/${manifest.id}/api/v1/admin/webhook-config`,
          { headers: { "X-Requested-With": "XMLHttpRequest" } },
        );
        if (!response.ok) {
          throw new Error(await readResponseText(response));
        }
        const data = (await response.json()) as WebhookConfigResponse;
        if (!cancelled) setConfig(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load webhook configuration",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyPath = async (path: string) => {
    setError("");
    setMessage("");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      const url = new URL(path, window.location.origin);
      await navigator.clipboard.writeText(url.toString());
      setMessage("Webhook URL copied");
    } catch {
      setError("Clipboard is not available in this browser");
    }
  };

  const sendTestEvent = async () => {
    setError("");
    setMessage("");
    setIsSending(true);
    try {
      const response = await fetch(
        `/plugins/${manifest.id}/api/v1/admin/test-event`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({
            team_id: teamId,
            channel_id: channelId || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readResponseText(response));
      }
      const event = (await response.json()) as TestEventResponse;
      setMessage(`Created ${event.title} (${event.id})`);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Failed to send test event",
      );
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="timeline-admin-settings" role="status">
        {"Loading webhook tools..."}
      </div>
    );
  }

  return (
    <div className="timeline-admin-settings">
      {config && (
        <section
          aria-label="Webhook configuration status"
          className="timeline-admin-settings__section"
        >
          <div className="timeline-admin-settings__section-header">
            <strong>{"Webhook endpoints"}</strong>
            <span>
              {
                "Use the webhook URL for one event, or the batch URL for up to 50 events."
              }
            </span>
          </div>
          <dl className="timeline-admin-settings__status-grid">
            <div>
              <dt>
                {"Shared secret "}
                <span className="timeline-admin-settings__legacy">
                  {"Legacy"}
                </span>
              </dt>
              <dd>
                {config.legacy_secret_configured
                  ? "configured"
                  : "not configured"}
              </dd>
            </div>
            <div>
              <dt>{"Signed webhooks"}</dt>
              <dd>
                {config.require_signed_webhooks
                  ? "required for all"
                  : "set per token"}
              </dd>
            </div>
            <div>
              <dt>{"Configured tokens"}</dt>
              <dd>{config.tokens.length}</dd>
            </div>
          </dl>
          {config.tokens.length > 0 && (
            <ul
              aria-label="Configured webhook tokens"
              className="timeline-admin-settings__tokens"
            >
              {config.tokens.map((token) => (
                <li key={token.name || "unnamed"}>
                  <span className="timeline-admin-settings__token-name">
                    {token.name || "unnamed"}
                  </span>
                  {!token.enabled && <span>{"disabled"}</span>}
                  {(config.require_signed_webhooks ||
                    token.require_signature) && (
                    <span>{"signature required"}</span>
                  )}
                  <span>{token.team ? `team: ${token.team}` : "any team"}</span>
                  {token.channels?.length ? (
                    <span>{`channels: ${token.channels.join(", ")}`}</span>
                  ) : (
                    <span>{"all channels"}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="timeline-admin-settings__actions">
            <button type="button" onClick={() => copyPath(config.webhook_path)}>
              {"Copy webhook URL"}
            </button>
            <button
              type="button"
              onClick={() => copyPath(config.batch_webhook_path)}
            >
              {"Copy batch URL"}
            </button>
          </div>
        </section>
      )}
      <section
        aria-label="Send a timeline test event"
        className="timeline-admin-settings__section timeline-admin-settings__section--test"
      >
        <div className="timeline-admin-settings__section-header">
          <strong>{"Send a test event"}</strong>
          <span>
            {
              "Create an event in the selected team or channel. This checks timeline delivery, not webhook authentication or signatures."
            }
          </span>
        </div>
        <div className="timeline-admin-settings__form">
          <label>
            <span>{"Team name or ID"}</span>
            <input
              placeholder="example-org"
              type="text"
              value={teamId}
              onChange={(event) => setTeamId(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>{"Channel name or ID (optional)"}</span>
            <input
              placeholder="optional, e.g. town-square"
              type="text"
              value={channelId}
              onChange={(event) => setChannelId(event.currentTarget.value)}
            />
          </label>
          <button type="button" disabled={isSending} onClick={sendTestEvent}>
            {isSending ? "Sending..." : "Send test event"}
          </button>
        </div>
      </section>
      {message && (
        <div className="timeline-admin-settings__message" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="timeline-admin-settings__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
