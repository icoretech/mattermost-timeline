import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createIntl, createIntlCache } from "react-intl";
import { describe, expect, it } from "vitest";
import {
  catalogs,
  englishMessages,
  getTranslations,
  messageDescriptor,
  resolveLocale,
  useMessages,
} from "./i18n";
import manifest from "./manifest";
import { withIntl } from "./test_utils";

function argumentSignature(message: string): string[] {
  const signature = new Set<string>();
  const visit = (elements: readonly MessageFormatElement[]) => {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.literal:
        case TYPE.pound:
          break;
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          signature.add(`${element.value}:${element.type}`);
          break;
        case TYPE.tag:
          signature.add(`tag:${element.value}`);
          visit(element.children);
          break;
        case TYPE.select:
          signature.add(
            `${element.value}:select:${Object.keys(element.options).sort().join(",")}`,
          );
          for (const option of Object.values(element.options))
            visit(option.value);
          break;
        case TYPE.plural:
          signature.add(
            `${element.value}:plural:${element.pluralType}:${element.offset}`,
          );
          for (const option of Object.values(element.options))
            visit(option.value);
          break;
        default: {
          const unreachable: never = element;
          throw new TypeError(`Unexpected ICU element: ${unreachable}`);
        }
      }
    }
  };
  visit(parse(message));
  return [...signature].sort();
}

describe("translation catalog contracts", () => {
  it.each(Object.entries(catalogs))(
    "%s has exactly the canonical English keys and valid ICU arguments",
    (_locale, catalog) => {
      expect(Object.keys(catalog).sort()).toEqual(
        Object.keys(englishMessages).sort(),
      );
      for (const [key, message] of Object.entries(englishMessages)) {
        const translated = Object.entries(catalog).find(
          ([candidate]) => candidate === key,
        )?.[1];
        expect(translated, `${_locale}:${key}`).toEqual(expect.any(String));
        if (typeof translated !== "string")
          throw new TypeError(`Missing translation ${_locale}:${key}`);
        expect(translated.trim().length, `${_locale}:${key}`).toBeGreaterThan(
          0,
        );
        expect(argumentSignature(translated), `${_locale}:${key}`).toEqual(
          argumentSignature(message),
        );
      }
    },
  );

  it.each([
    ["ko-KR", "ko"],
    ["IT_it", "it"],
    ["es-MX", "es"],
    ["fr-CA", "fr"],
    ["de-AT", "de"],
    ["pt_BR", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["ja-JP", "en"],
    ["", "en"],
  ])("resolves %s to supported catalog %s", (requested, expected) => {
    expect(resolveLocale(requested)).toBe(expected);
    expect(getTranslations(requested)).toEqual(getTranslations(expected));
  });

  it("uses namespaced native host messages with English fallback", () => {
    const translations = getTranslations("ja");
    expect(translations[`${manifest.id}.chrome.title`]).toBe("Events");
    expect(translations["chrome.title"]).toBeUndefined();
    expect(Object.keys(translations)).toHaveLength(
      Object.keys(englishMessages).length,
    );
  });

  it.each(Object.keys(catalogs))(
    "%s formats real ICU plurals and technical literals",
    (locale) => {
      const intl = createIntl(
        {
          locale,
          defaultLocale: "en",
          messages: getTranslations(locale),
          onError: (error) => {
            throw error;
          },
        },
        createIntlCache(),
      );
      for (const count of [0, 1, 2, 5]) {
        const message = intl.formatMessage(
          messageDescriptor("reaction.count"),
          { label: "sample-label", count },
        );
        expect(message).toContain("sample-label");
        expect(message).toContain(String(count));
      }
      expect(
        intl.formatMessage(messageDescriptor("admin.signatureMessage")),
      ).toContain("<unix-seconds>.<request-body>");
    },
  );

  it("keeps English plural grammar for an unsupported host locale", () => {
    function FallbackMessage() {
      const { t } = useMessages();
      return React.createElement(
        "span",
        null,
        t("reaction.count", { label: "Acknowledged", count: 1 }),
      );
    }
    const rendered = renderToStaticMarkup(
      withIntl(React.createElement(FallbackMessage), "ja"),
    );
    expect(rendered).toBe("<span>Acknowledged: 1 reaction</span>");
  });
});
