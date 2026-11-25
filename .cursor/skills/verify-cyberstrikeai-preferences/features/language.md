# Language

## Sub-features

Switch to Japanese, retain it across reload and switch back to English through settings.

## How to get to it (user POV)

Open the language button in the header or visit Settings → Appearance and use the language selector.

## Driving it with Playwright

Open the en-US button and require the English and 日本語 menu entries. Choose 日本語, check the translated dashboard text and html lang, then reload and check the text and csai_lang storage value. Open /#/settings?section=appearance and choose English from the language combobox. Confirm English navigation and html lang=en-US. Inspect language-menu.png, japanese-after-reload.png, english-from-settings.png and language.json.

## Gotchas

The settings menu uses a combobox, while the header uses menu items. Wait for translated text to appear because language packs load asynchronously.
