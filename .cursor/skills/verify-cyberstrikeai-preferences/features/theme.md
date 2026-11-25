# Theme

## Sub-features

Select dark in the header and light in settings. Each choice survives reload.

## How to get to it (user POV)

Open the header's current-theme button or visit Settings → Appearance.

## Driving it with Playwright

Click the System button and choose the Dark menu item. Reload and require the Dark button, body theme-mode=dark and cyberstrike-theme=dark in localStorage. After restoring English in Appearance, check the Light radio. Reload and verify the selected radio, body mode and storage all say light. Inspect theme-menu.png, dark-after-reload.png, settings-light.png and the two theme JSON receipts.

## Gotchas

Use a new profile with a light OS preference. The header button names the current preference. System can look like Light even though their stored values differ.
