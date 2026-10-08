import React from "react";
import { IntlProvider } from "react-intl";
import { getTranslations } from "./i18n_catalogs";

export function withIntl(children: React.ReactNode, locale = "en") {
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={getTranslations(locale)}
    >
      {children}
    </IntlProvider>
  );
}
