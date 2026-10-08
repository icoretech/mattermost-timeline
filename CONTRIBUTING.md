# Contributing

For build requirements and development commands, see [Build from source](README.md#build-from-source). Describe the behavior your change addresses and include the checks you ran in your pull request.

## Translations

The plugin follows the user's Mattermost language preference. It uses Mattermost's React Intl provider and falls back to English. There is no separate plugin language selector.

Translations live in `webapp/src/i18n/<locale>/`:

| Locale | Language |
| --- | --- |
| `en` | English, the canonical catalog |
| `ko` | Korean |
| `it` | Italian |
| `es` | Spanish |
| `fr` | French |
| `de` | German |
| `pt-BR` | Brazilian Portuguese |

Each locale has `common.json`, `timeline.json` and `admin.json`. Edit the translated values while keeping the same keys as the corresponding English file. For new UI messages, add the English entry and translations to every locale. The catalog loader adds the plugin ID prefix to message IDs centrally; do not add that prefix to JSON keys.

Keep ICU placeholder names and types intact. Translate the text inside plural branches, use the plural categories needed by the target language, and always retain `other`. For example, this English message uses a text argument named `label` and a numeric plural argument named `count`:

```json
{
    "reaction.count": "{label}: {count, plural, one {# reaction} other {# reactions}}"
}
```

Translate UI copy, including labels, help text, tooltips, accessibility text and errors. Keep technical literals such as API paths, header names and configuration keys unchanged. Integration content stays as supplied: titles, messages, sources, environments, link labels, and custom field names, labels and values. Localized labels must not change the underlying event type, status or reaction identifiers sent to the server.

Run the catalog check from the repository root:

```bash
cd webapp && npm run i18n:check
```

The check validates matching keys, ICU syntax, argument types, plural handling and English fallback. For code changes, also run the frontend tests, lint/typecheck and build:

```bash
cd webapp
npm run test
npm run lint
npm run build
```

Review wording in Mattermost with the target language selected, including narrow sidebar layouts, filters, reactions and plugin settings. The initial translations welcome native-speaker review, especially Korean. For translation issues or proposed corrections, include the locale, the affected screen or control, the current wording and your suggested wording.
