import deAdmin from "./i18n/de/admin.json";
import deCommon from "./i18n/de/common.json";
import deTimeline from "./i18n/de/timeline.json";
import enAdmin from "./i18n/en/admin.json";
import enCommon from "./i18n/en/common.json";
import enTimeline from "./i18n/en/timeline.json";
import esAdmin from "./i18n/es/admin.json";
import esCommon from "./i18n/es/common.json";
import esTimeline from "./i18n/es/timeline.json";
import frAdmin from "./i18n/fr/admin.json";
import frCommon from "./i18n/fr/common.json";
import frTimeline from "./i18n/fr/timeline.json";
import itAdmin from "./i18n/it/admin.json";
import itCommon from "./i18n/it/common.json";
import itTimeline from "./i18n/it/timeline.json";
import koAdmin from "./i18n/ko/admin.json";
import koCommon from "./i18n/ko/common.json";
import koTimeline from "./i18n/ko/timeline.json";
import ptAdmin from "./i18n/pt-BR/admin.json";
import ptCommon from "./i18n/pt-BR/common.json";
import ptTimeline from "./i18n/pt-BR/timeline.json";
import manifest from "./manifest";

export const englishMessages = { ...enAdmin, ...enCommon, ...enTimeline };
export type MessageKey = keyof typeof englishMessages;
export type ErrorKey = Extract<MessageKey, `error.${string}`>;
export const catalogs = {
  en: englishMessages,
  ko: { ...koAdmin, ...koCommon, ...koTimeline },
  it: { ...itAdmin, ...itCommon, ...itTimeline },
  es: { ...esAdmin, ...esCommon, ...esTimeline },
  fr: { ...frAdmin, ...frCommon, ...frTimeline },
  de: { ...deAdmin, ...deCommon, ...deTimeline },
  "pt-BR": { ...ptAdmin, ...ptCommon, ...ptTimeline },
} satisfies Record<string, Record<string, string>>;

export type SupportedLocale = keyof typeof catalogs;

export function resolveLocale(locale: string): SupportedLocale {
  const base = locale.replaceAll("_", "-").toLowerCase().split("-")[0];
  switch (base) {
    case "ko":
      return "ko";
    case "it":
      return "it";
    case "es":
      return "es";
    case "fr":
      return "fr";
    case "de":
      return "de";
    case "pt":
      return "pt-BR";
    default:
      return "en";
  }
}

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && Object.hasOwn(englishMessages, value);
}

export function messageDescriptor(key: MessageKey) {
  return { id: `${manifest.id}.${key}`, defaultMessage: englishMessages[key] };
}

export function getTranslations(locale: string): Record<string, string> {
  const messages = { ...englishMessages, ...catalogs[resolveLocale(locale)] };
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      `${manifest.id}.${key}`,
      value,
    ]),
  );
}
