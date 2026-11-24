# Frontend i18n

[中文](../zh-CN/frontend-i18n.md) | [日本語](../ja-JP/frontend-i18n.md)

The web UI is a React + Semi Design single-page app. Translations come from
`web/frontend/src/lib/i18n.jsx`, backed by the same JSON files the backend ships.

## Files

```text
web/static/i18n/zh-CN.json
web/static/i18n/en-US.json
web/static/i18n/ja-JP.json
web/frontend/src/lib/i18n.jsx
```

## Runtime behavior

- Preference is stored in `localStorage['csai_lang']`; otherwise it follows `navigator.language`, defaulting to `en-US`.
- The provider loads the active language plus the `en-US`, `ja-JP` and `zh-CN` fallbacks; lookups fall back `active → en-US → ja-JP → zh-CN → caller default`.
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

1. Every visible string goes through `t(...)` with a Chinese fallback as the third argument.
2. Add new keys to `zh-CN.json`, `en-US.json` and `ja-JP.json` together.
3. Format dates with `formatDateTime`/`relativeTime` from `src/lib/format.js`.
4. Keep keys two levels deep (`<domain>.<key>`) and stable across releases.
5. Outside components (helpers, constant tables) use `translate(key, vars, fallback)`, `lazyLabels(prefix, map)` or `lazyOptions(prefix, options)` from `src/lib/i18n.jsx`. Never call `translate` at module top level: the language would be fixed at import.
6. `go test ./internal/handler -run Locale` fails when a key used in the source is missing from `en-US.json` or when `ja-JP.json` does not cover the other two files.

## Server messages

The source code is written in English: messages, comments, prompts and definition files. `internal/apimsg/catalog.json` maps each English message the server sends to a client to Chinese (`zh`) and Japanese (`ja`). `internal/apimsg` applies it in three places: the `error` / `message` fields of JSON responses with status 400 or higher, the `message` of chat stream events that the server writes (not model or tool output), and the same server-written messages when a conversation's history is read. The frontend sends the UI language as `Accept-Language`; a `lang` query parameter wins; the default is English, and English requests pass through unchanged. Text that has no catalog entry is shown in English. Machine-readable codes such as `c2_disabled` are never translated.

When you add or change a message, write it in English and add its `zh` and `ja` to `catalog.json`. `go test ./internal/apimsg` fails for any message sent to a client that has no entry; `APIMSG_DUMP=/tmp/missing.json go test ./internal/apimsg -run Covers` lists everything untranslated, including lower-level errors. `go test ./internal/handler -run TestRepositoryIsEnglish` fails when Chinese or Japanese text appears outside the translation resources and the lines listed in `internal/handler/testdata/cjk_allowlist.txt`.
