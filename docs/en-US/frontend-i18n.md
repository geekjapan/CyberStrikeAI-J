# Frontend i18n

[日本語](../ja-JP/frontend-i18n.md)

The web UI is a React + Semi Design single-page app. Translations come from
`web/frontend/src/lib/i18n.jsx`, backed by the same JSON files the backend ships.

## Files

```text
web/static/i18n/en-US.json
web/static/i18n/ja-JP.json
web/frontend/src/lib/i18n.jsx
```

## Runtime behavior

- Preference is stored in `localStorage['csai_lang']`; otherwise it follows `navigator.language`, defaulting to `en-US`.
- The provider loads the active language plus the `en-US` and `ja-JP` fallbacks; lookups fall back `active → en-US → ja-JP → caller default`.
- Switching language updates `<html lang>` and swaps Semi's `ConfigProvider` locale.
- No page reload is required; `useT()` re-renders consumers.

## Usage

```jsx
const t = useT();
t('vulnerability.title');
t('common.minutesAgo', { n: 5 });          // {{n}} interpolation
t('chat.unknownKey', null, 'English fallback');     // explicit English fallback
```

Rules:

1. Every visible string goes through `t(...)` with an English fallback as the third argument.
2. Add new keys to `en-US.json` and `ja-JP.json` together.
3. Format dates with `formatDateTime`/`relativeTime` from `src/lib/format.js`.
4. Keep keys two levels deep (`<domain>.<key>`) and stable across releases.
5. Outside components (helpers, constant tables) use `translate(key, vars, fallback)`, `lazyLabels(prefix, map)` or `lazyOptions(prefix, options)` from `src/lib/i18n.jsx`. Never call `translate` at module top level: the language would be fixed at import.
6. `go test ./internal/handler -run Locale` fails when a key used in the source is missing from `en-US.json` or when `ja-JP.json` does not cover `en-US.json`.

## Server messages

The source code is written in English: messages, comments, prompts and definition files. `internal/apimsg/catalog.json` maps each English message the server sends to a client to Japanese (`ja`). `internal/apimsg` applies it in three places: the `error` / `message` fields of JSON responses with status 400 or higher, the `message` of chat stream events that the server writes (not model or tool output), and the same server-written messages when a conversation's history is read. The frontend sends the UI language as `Accept-Language`; a `lang` query parameter wins. Only a Japanese request gets Japanese; a request in any other language gets English, which passes through unchanged. Text that has no catalog entry is shown in English. Machine-readable codes such as `c2_disabled` are never translated.

When you add or change a message, write it in English and add its `ja` to `catalog.json`. `go test ./internal/apimsg` fails for any message sent to a client that has no entry; `APIMSG_DUMP=/tmp/missing.json go test ./internal/apimsg -run Covers` lists everything untranslated, including lower-level errors. `go test ./internal/handler -run TestRepositoryIsEnglish` fails when Chinese or Japanese characters (Han script, such as kanji) appear outside the translation resources and the lines listed in `internal/handler/testdata/cjk_allowlist.txt`.
