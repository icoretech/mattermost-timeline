import { createIntl, createIntlCache, useIntl } from "react-intl";
import {
  getTranslations,
  isMessageKey,
  type MessageKey,
  messageDescriptor,
  resolveLocale,
} from "./i18n_catalogs";
import { TimelineRequestError } from "./timeline_errors";

export type { MessageKey, SupportedLocale } from "./i18n_catalogs";
export {
  catalogs,
  englishMessages,
  getTranslations,
  isMessageKey,
  messageDescriptor,
  resolveLocale,
} from "./i18n_catalogs";
export type MessageValues = Readonly<
  Record<string, string | number | boolean | Date | null | undefined>
>;

const englishFallbackIntl = createIntl(
  { locale: "en", messages: getTranslations("en") },
  createIntlCache(),
);

export function useMessages() {
  const intl = useIntl();
  const needsEnglishFallback =
    resolveLocale(intl.locale) === "en" &&
    intl.locale.toLowerCase().split(/[-_]/)[0] !== "en";
  const formatter = needsEnglishFallback ? englishFallbackIntl : intl;
  const t = (key: MessageKey, values?: MessageValues): string =>
    formatter.formatMessage(messageDescriptor(key), values);
  const formatError = (error: unknown, fallback: MessageKey): string => {
    if (error instanceof TimelineRequestError) return t(error.code);
    return t(isMessageKey(error) ? error : fallback);
  };
  return { t, formatError, locale: intl.locale };
}
