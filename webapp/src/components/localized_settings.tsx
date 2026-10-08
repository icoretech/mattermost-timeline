import React from "react";
import { useMessages } from "../i18n";

type SettingKey =
  | "RequireSignedWebhooks"
  | "WebhookSecret"
  | "MaxEventsStored"
  | "MaxEventsDisplayed"
  | "TimelineOrder"
  | "EnableReactions";

export type LocalizedSettingProps = {
  id: string;
  value?: unknown;
  disabled?: boolean;
  onChange: (id: string, value: unknown) => void;
};

type SettingControlProps = LocalizedSettingProps & { setting: SettingKey };

function BooleanSetting({
  setting,
  id,
  value,
  disabled,
  onChange,
}: SettingControlProps) {
  const { t } = useMessages();
  const booleanValue =
    typeof value === "boolean" ? value : setting === "EnableReactions";
  return (
    <fieldset disabled={disabled} aria-describedby={`${id}-help`}>
      <legend>{t(`settings.${setting}.label`)}</legend>
      {[true, false].map((option) => (
        <label key={String(option)}>
          <input
            type="radio"
            name={id}
            checked={booleanValue === option}
            onChange={() => onChange(id, option)}
          />
          {t(option ? "settings.true" : "settings.false")}
        </label>
      ))}
    </fieldset>
  );
}

function OrderSetting({
  id,
  value,
  disabled,
  onChange,
}: LocalizedSettingProps) {
  const { t } = useMessages();
  return (
    <select
      id={id}
      aria-label={t("settings.TimelineOrder.label")}
      disabled={disabled}
      aria-describedby={`${id}-help`}
      value={typeof value === "string" ? value : "oldest_first"}
      onChange={(event) => onChange(id, event.currentTarget.value)}
    >
      <option value="oldest_first">
        {t("settings.TimelineOrder.oldest_first")}
      </option>
      <option value="newest_first">
        {t("settings.TimelineOrder.newest_first")}
      </option>
    </select>
  );
}

function TextSetting({
  setting,
  id,
  value,
  disabled,
  onChange,
}: SettingControlProps) {
  const { t } = useMessages();
  const secret = setting === "WebhookSecret";
  const defaultValue = setting === "MaxEventsStored" ? "500" : "100";
  return (
    <input
      id={id}
      aria-label={t(`settings.${setting}.label`)}
      type={secret ? "password" : "text"}
      autoComplete={secret ? "new-password" : undefined}
      disabled={disabled}
      aria-describedby={`${id}-help`}
      value={typeof value === "string" ? value : secret ? "" : defaultValue}
      onChange={(event) => onChange(id, event.currentTarget.value)}
    />
  );
}

function SettingControl(props: SettingControlProps) {
  const { t } = useMessages();
  switch (props.setting) {
    case "RequireSignedWebhooks":
    case "EnableReactions":
      return <BooleanSetting {...props} />;
    case "TimelineOrder":
      return (
        <label htmlFor={props.id}>
          <span>{t("settings.TimelineOrder.label")}</span>
          <OrderSetting {...props} />
        </label>
      );
    case "WebhookSecret":
    case "MaxEventsStored":
    case "MaxEventsDisplayed":
      return (
        <label htmlFor={props.id}>
          <span>{t(`settings.${props.setting}.label`)}</span>
          <TextSetting {...props} />
        </label>
      );
  }
}

export function LocalizedSetting(props: SettingControlProps) {
  const { t, locale } = useMessages();
  return (
    <div className="timeline-localized-setting" lang={locale}>
      <SettingControl {...props} />
      <p id={`${props.id}-help`}>{t(`settings.${props.setting}.help`)}</p>
      {props.setting === "EnableReactions" && <p>{t("settings.footer")}</p>}
    </div>
  );
}
