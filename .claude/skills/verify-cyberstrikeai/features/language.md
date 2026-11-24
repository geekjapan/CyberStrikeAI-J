# Interface language

The header has a language button. Choosing a language retranslates the whole UI at once and the choice survives a reload. Three languages are offered: English, 日本語, 简体中文. A new browser starts in English.

## Sub-features

- `lang-default`: a browser with no saved choice shows English.
- `lang-list`: the menu lists the three languages.
- `lang-switch`: choosing 日本語 translates the navigation and sets `<html lang="ja-JP">`.
- `lang-persist`: after a reload the UI is still Japanese (`localStorage['csai_lang']`).
- `lang-settings`: the select in Settings > Appearance switches the language too.

## How to get to it (user POV)

- Signed in, click the button in the top-right header that shows the current language code (`en-US`), then pick a language from the menu.
- Signed in, open `System settings`, the `Appearance` tab (`#/settings?section=appearance`), and pick a language in the language select.

## Driving it with drive.mjs

Preconditions:

- Baseline.

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/language.mjs`.
- **Default.** After sign-in the navigation shows `Dashboard`.
- **Open menu.** It clicks the header button named `en-US`. `result.json` lists the three menu items under `observed.menu`. Screenshot `01-language-menu.png`.
- **Switch.** It clicks the menu item `日本語`. The navigation shows `ダッシュボード` and `<html>` has `lang="ja-JP"`. Screenshot `02-japanese.png`.
- **Persist.** It reloads. `ダッシュボード` is still shown and `csai_lang` is `ja-JP`. Screenshot `03-japanese-after-reload.png`.
- **Settings entry.** It opens `#/settings?section=appearance`, opens the select that shows `日本語` and clicks the option `English`. The navigation shows `Dashboard` and `<html>` has `lang="en-US"`. Screenshot `04-english-from-settings.png`.

## Gotchas

- The journey proves Japanese and the switch back to English only. For another language, change the menu item and the expected navigation text (take it from `web/static/i18n/<lang>.json`, key `nav.dashboard`).
- The language button's accessible name is the current language code, so it changes after a switch.
- A missing key falls back to English, then Japanese, then Chinese. A screen can look translated while single strings are fallbacks; to prove a specific string, assert that string.
- Text that is data stays as stored (the admin's display name is `管理员`). Seeing that after switching is not a regression.
- The login page has no language button: the language can only be changed after sign-in.
