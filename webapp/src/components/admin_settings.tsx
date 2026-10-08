import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { type MessageKey, useMessages } from "../i18n";
import adminMessages from "../i18n/en/admin.json";
import {
  AdminAPIError,
  createTimelineTestEvent,
  fetchWebhookConfig,
  type SanitizedWebhookToken,
  updateWebhookTokens,
  type WebhookConfigResponse,
} from "./admin_client";

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
  error: Notice;
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
        error: { key: "admin.invalidArray" },
      };
    }
    return { tokens: parsed.map(normalizeToken), error: "" };
  } catch {
    return {
      tokens: [],
      error: { key: "admin.invalidJSON" },
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

type Notice =
  | ""
  | { key: MessageKey; values?: Record<string, string | number> };

function isAdminMessageKey(key: string): key is keyof typeof adminMessages {
  return Object.hasOwn(adminMessages, key);
}

function messageFromError(error: unknown, fallback: MessageKey): Notice {
  if (error instanceof AdminAPIError) {
    if (error.status === 401) return { key: "admin.error.unauthorized" };
    if (error.status === 403) return { key: "admin.error.forbidden" };
    const key = `admin.error.${error.code}`;
    if (isAdminMessageKey(key)) return { key, values: error.params };
    if (error.code !== "unknown") {
      console.error("Unrecognized timeline admin error", {
        status: error.status,
        code: error.code,
      });
    }
    return { key: "admin.httpError", values: { status: error.status } };
  }
  return { key: fallback };
}

function useNotice() {
  const { t } = useMessages();
  return (notice: Notice) => (notice ? t(notice.key, notice.values) : "");
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
  loadError: Notice;
  saveError: Notice;
  saveMessage: Notice;
};

type TokenEditorAction =
  | { type: "loaded" | "saved"; tokens: WebhookTokenValue[] }
  | { type: "loadFailed" | "saveFailed"; error: Notice }
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
        saveMessage: action.type === "saved" ? { key: "admin.saved" } : "",
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
  const { t } = useMessages();
  return (
    <fieldset className="timeline-token-settings__row">
      <legend className="timeline-token-settings__row-header">
        <span>{t("admin.token", { number: tokenNumber })}</span>
        <button
          aria-label={t("admin.removeToken", { number: tokenNumber })}
          className="timeline-token-settings__button timeline-token-settings__button--danger"
          type="button"
          disabled={disabled}
          onClick={onRemove}
        >
          {t("admin.remove")}
        </button>
      </legend>
      <div className="timeline-token-settings__grid">
        <label className="timeline-token-settings__field">
          <span>{t("admin.name")}</span>
          <input
            aria-label={t("admin.tokenName", { number: tokenNumber })}
            aria-describedby={`${token.rowId}-name-help`}
            placeholder={t("admin.namePlaceholder")}
            disabled={disabled}
            type="text"
            value={token.name}
            onChange={(event) => onChange({ name: event.currentTarget.value })}
          />
          <small
            id={`${token.rowId}-name-help`}
            className="timeline-token-settings__help"
          >
            {t("admin.nameHelp")}
          </small>
        </label>
        <label className="timeline-token-settings__field">
          <span>{t("admin.secret")}</span>
          <input
            aria-label={t("admin.tokenSecret", { number: tokenNumber })}
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
            {t("admin.secretHelp")}
          </small>
        </label>
        <label className="timeline-token-settings__field timeline-token-settings__field--wide">
          <span>{t("admin.allowedTeam")}</span>
          <input
            aria-label={t("admin.tokenTeam", { number: tokenNumber })}
            aria-describedby={`${token.rowId}-team-help`}
            disabled={disabled}
            placeholder={t("admin.teamPlaceholder")}
            type="text"
            value={token.team}
            onChange={(event) => onChange({ team: event.currentTarget.value })}
          />
          <small
            id={`${token.rowId}-team-help`}
            className="timeline-token-settings__help"
          >
            {t("admin.teamHelp")}
          </small>
        </label>
        <label className="timeline-token-settings__field timeline-token-settings__field--wide">
          <span>{t("admin.allowedChannels")}</span>
          <textarea
            aria-label={t("admin.tokenChannels", { number: tokenNumber })}
            aria-describedby={`${token.rowId}-channels-help`}
            disabled={disabled}
            placeholder={t("admin.channelsPlaceholder")}
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
            {t("admin.channelsHelp")}
          </small>
        </label>
      </div>
      <div className="timeline-token-settings__checks">
        <label>
          <input
            aria-label={t("admin.tokenEnabled", { number: tokenNumber })}
            checked={token.enabled}
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              onChange({
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span>{t("admin.acceptEvents")}</span>
        </label>
        <label>
          <input
            aria-label={t("admin.tokenSignature", { number: tokenNumber })}
            checked={token.require_signature}
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              onChange({
                require_signature: event.currentTarget.checked,
              })
            }
          />
          <span>{t("admin.requireSigned")}</span>
        </label>
      </div>
      <small className="timeline-token-settings__help">
        {t("admin.pauseHelp")}
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
  const { t } = useMessages();
  return (
    <details className="timeline-token-settings__guide">
      <summary>{t("admin.sendHelp")}</summary>
      <p>{t("admin.sendIntro")}</p>
      <pre>
        <code>
          {JSON.stringify({
            title: t("admin.exampleTitle"),
            status: "success",
          })}
        </code>
      </pre>
      <p>{t("admin.unsignedHelp")}</p>
      <p>{t("admin.signedHelp")}</p>
      <pre>
        <code>
          {`X-Timeline-Timestamp: <unix-seconds>\nX-Timeline-Signature: sha256=<hex-hmac>\n\n${t("admin.signatureMessage")}`}
        </code>
      </pre>
      <p>{t("admin.timestampHelp")}</p>
    </details>
  );
}

function useWebhookTokenEditor(
  initialTokens: WebhookTokenValue[],
  parseError: Notice,
) {
  const requests = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    return () => controller.abort();
  }, []);
  const shouldLoadTokens = !parseError && initialTokens.length === 0;
  const [state, dispatch] = useReducer(tokenEditorReducer, {
    tokens: initialTokens,
    dirty: false,
    request: shouldLoadTokens ? "loading" : "idle",
    loadError: "",
    saveError: "",
    saveMessage: "",
  });

  useEffect(() => {
    if (!shouldLoadTokens) return;
    const controller = new AbortController();

    void fetchWebhookConfig(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "loaded",
          tokens: tokenRowsFromSanitized(data.tokens),
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "loadFailed",
          error: messageFromError(error, "admin.loadTokensFailed"),
        });
      },
    );
    return () => {
      controller.abort();
    };
  }, [shouldLoadTokens]);

  const savingRef = useRef(false);
  const saveTokens = async () => {
    if (savingRef.current) return;
    const signal = requests.current?.signal;
    savingRef.current = true;
    dispatch({ type: "saveStarted" });
    try {
      const data = await updateWebhookTokens(
        tokensForRequest(state.tokens),
        signal,
      );
      if (signal?.aborted) return;
      dispatch({ type: "saved", tokens: tokenRowsFromSanitized(data.tokens) });
    } catch (error) {
      if (signal?.aborted) return;
      dispatch({
        type: "saveFailed",
        error: messageFromError(error, "admin.saveTokensFailed"),
      });
    } finally {
      savingRef.current = false;
    }
  };

  return { state, dispatch, saveTokens };
}

function TokenEditorActions({
  dirty,
  isSaving,
  saveMessage,
  controlsDisabled,
  onAdd,
  onSave,
}: {
  dirty: boolean;
  isSaving: boolean;
  saveMessage: Notice;
  controlsDisabled: boolean;
  onAdd: () => void;
  onSave: () => void;
}) {
  const { t } = useMessages();
  const canSave = dirty && !controlsDisabled;
  return (
    <div className="timeline-token-settings__actions">
      <button
        className="timeline-token-settings__button"
        type="button"
        disabled={controlsDisabled}
        onClick={onAdd}
      >
        {t("admin.addToken")}
      </button>
      <button
        className="timeline-token-settings__button timeline-token-settings__button--primary"
        type="button"
        disabled={!canSave}
        onClick={onSave}
      >
        {isSaving ? t("admin.saving") : t("admin.saveTokens")}
      </button>
      {dirty && !isSaving && !saveMessage && (
        <span className="timeline-token-settings__note" role="status">
          {t("admin.unsaved")}
        </span>
      )}
    </div>
  );
}

function TokenEditorMessage({
  kind,
  message,
}: {
  kind: "error" | "message";
  message: Notice;
}) {
  const notice = useNotice();
  if (!message) return null;
  return (
    <div
      className={`timeline-token-settings__${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {notice(message)}
    </div>
  );
}

function WebhookTokensEditor({
  initialTokens,
  parseError,
  disabled,
}: {
  initialTokens: WebhookTokenValue[];
  parseError: Notice;
  disabled: boolean;
}) {
  const { t, locale } = useMessages();
  const { state, dispatch, saveTokens } = useWebhookTokenEditor(
    initialTokens,
    parseError,
  );
  const { tokens, dirty, loadError, saveError, saveMessage } = state;
  const isLoading = state.request === "loading";
  const isSaving = state.request === "saving";
  const controlsDisabled =
    disabled || Boolean(parseError) || isLoading || isSaving;

  return (
    <div className="timeline-token-settings" lang={locale}>
      <p>{t("settings.intro")}</p>
      <h3>{t("settings.WebhookTokens.label")}</h3>
      <p className="timeline-token-settings__intro">{t("admin.tokensIntro")}</p>
      <TokenEditorMessage
        kind="message"
        message={isLoading ? { key: "admin.loadingTokens" } : ""}
      />
      <TokenEditorMessage kind="error" message={parseError || loadError} />
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
          {t("admin.noTokens")}
        </div>
      )}
      <TokenEditorActions
        dirty={dirty}
        isSaving={isSaving}
        saveMessage={saveMessage}
        controlsDisabled={controlsDisabled}
        onAdd={() => dispatch({ type: "add", token: emptyToken() })}
        onSave={saveTokens}
      />
      <TokenEditorMessage kind="message" message={saveMessage} />
      <TokenEditorMessage kind="error" message={saveError} />
      <WebhookRequestHelp />
    </div>
  );
}

export default function AdminSettings() {
  const { t, locale } = useMessages();
  const notice = useNotice();
  const [loadState, setLoadState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; config: WebhookConfigResponse }
    | { kind: "failed" }
  >({ kind: "loading" });
  const config = loadState.kind === "ready" ? loadState.config : null;
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState<Notice>("");
  const [error, setError] = useState<Notice>("");
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const requests = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    void fetchWebhookConfig(controller.signal).then(
      (config) => {
        if (!controller.signal.aborted) setLoadState({ kind: "ready", config });
      },
      (loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFromError(loadError, "admin.loadConfigFailed"));
          setLoadState({ kind: "failed" });
        }
      },
    );
    return () => controller.abort();
  }, []);

  const copyPath = async (path: string) => {
    const signal = requests.current?.signal;
    setError("");
    setMessage("");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      const url = new URL(path, window.location.origin);
      await navigator.clipboard.writeText(url.toString());
      if (signal?.aborted) return;
      setMessage({ key: "admin.copied" });
    } catch {
      if (signal?.aborted) return;
      setError({ key: "admin.clipboardFailed" });
    }
  };

  const sendTestEvent = async () => {
    if (sendingRef.current) return;
    const signal = requests.current?.signal;
    sendingRef.current = true;
    setError("");
    setMessage("");
    setIsSending(true);
    try {
      const event = await createTimelineTestEvent(teamId, channelId, signal);
      if (signal?.aborted) return;
      setMessage({
        key: "admin.created",
        values: { title: event.title, id: event.id },
      });
    } catch (sendError) {
      if (signal?.aborted) return;
      setError(messageFromError(sendError, "admin.sendFailed"));
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  if (loadState.kind === "loading") {
    return (
      <div className="timeline-admin-settings" lang={locale} role="status">
        {t("admin.loadingTools")}
      </div>
    );
  }

  return (
    <div className="timeline-admin-settings" lang={locale}>
      <h3>{t("settings.WebhookTools.label")}</h3>
      {config && (
        <section
          aria-label={t("admin.configurationStatus")}
          className="timeline-admin-settings__section"
        >
          <div className="timeline-admin-settings__section-header">
            <strong>{t("admin.endpoints")}</strong>
            <span>{t("admin.endpointsHelp")}</span>
          </div>
          <dl className="timeline-admin-settings__status-grid">
            <div>
              <dt>
                {t("admin.sharedSecret")}{" "}
                <span className="timeline-admin-settings__legacy">
                  {t("admin.legacy")}
                </span>
              </dt>
              <dd>
                {config.legacy_secret_configured
                  ? t("admin.configured")
                  : t("admin.notConfigured")}
              </dd>
            </div>
            <div>
              <dt>{t("admin.signedWebhooks")}</dt>
              <dd>
                {config.require_signed_webhooks
                  ? t("admin.requiredAll")
                  : t("admin.perToken")}
              </dd>
            </div>
            <div>
              <dt>{t("admin.configuredTokens")}</dt>
              <dd>{config.tokens.length}</dd>
            </div>
          </dl>
          {config.tokens.length > 0 && (
            <ul
              aria-label={t("admin.configuredTokensLabel")}
              className="timeline-admin-settings__tokens"
            >
              {config.tokens.map((token) => (
                <li key={token.name || t("admin.unnamed")}>
                  <span className="timeline-admin-settings__token-name">
                    {token.name || t("admin.unnamed")}
                  </span>
                  {!token.enabled && <span>{t("admin.disabled")}</span>}
                  {(config.require_signed_webhooks ||
                    token.require_signature) && (
                    <span>{t("admin.signatureRequired")}</span>
                  )}
                  <span>
                    {token.team
                      ? t("admin.teamScope", { team: token.team })
                      : t("admin.anyTeam")}
                  </span>
                  {token.channels?.length ? (
                    <span>
                      {t("admin.channelScope", {
                        channels: token.channels.join(", "),
                      })}
                    </span>
                  ) : (
                    <span>{t("admin.allChannels")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="timeline-admin-settings__actions">
            <button type="button" onClick={() => copyPath(config.webhook_path)}>
              {t("admin.copyWebhook")}
            </button>
            <button
              type="button"
              onClick={() => copyPath(config.batch_webhook_path)}
            >
              {t("admin.copyBatch")}
            </button>
          </div>
        </section>
      )}
      <section
        aria-label={t("admin.testLabel")}
        className="timeline-admin-settings__section timeline-admin-settings__section--test"
      >
        <div className="timeline-admin-settings__section-header">
          <strong>{t("admin.testTitle")}</strong>
          <span>{t("admin.testHelp")}</span>
        </div>
        <div className="timeline-admin-settings__form">
          <label>
            <span>{t("admin.teamInput")}</span>
            <input
              placeholder="example-org"
              type="text"
              value={teamId}
              onChange={(event) => setTeamId(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>{t("admin.channelInput")}</span>
            <input
              placeholder={t("admin.channelInputPlaceholder")}
              type="text"
              value={channelId}
              onChange={(event) => setChannelId(event.currentTarget.value)}
            />
          </label>
          <button type="button" disabled={isSending} onClick={sendTestEvent}>
            {isSending ? t("admin.sending") : t("admin.sendTest")}
          </button>
        </div>
      </section>
      {message && (
        <div className="timeline-admin-settings__message" role="status">
          {notice(message)}
        </div>
      )}
      {error && (
        <div className="timeline-admin-settings__error" role="alert">
          {notice(error)}
        </div>
      )}
    </div>
  );
}
