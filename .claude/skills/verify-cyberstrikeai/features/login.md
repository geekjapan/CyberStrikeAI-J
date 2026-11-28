# Sign in

A signed-out visitor sees only the login form. A wrong password shows an error and stays on the form; the right one opens the dashboard and keeps the session in the browser.

## Sub-features

- `login-reject`: a wrong password shows an error and does not open the app.
- `login-accept`: the right password lands on `#/dashboard`.
- `login-session`: the token is stored in `localStorage['cyberstrike-auth']`.

## How to get to it (user POV)

- Open the base URL in a browser that is not signed in. Every route shows the login form until sign-in.

## Driving it with drive.mjs

Preconditions:

- Baseline. Fewer than 8 logins in the last minute (see Gotchas).

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/login.mjs`.
- **Reject.** The journey types `admin` and a wrong password into `.cs-login-form` and submits. An error message appears in the form, `#main-content` is absent, and `writes` has `401 POST /api/auth/login`. Screenshot `01-rejected.png`.
- **Accept.** It signs in with the password from `.run/admin-password`. The URL ends in `#/dashboard`, `#main-content` is visible, `writes` has `200 POST /api/auth/login`. Screenshot `02-dashboard.png`.
- **Session.** It reads the token from `localStorage` and fails if it is missing.

## Gotchas

- The login page follows `localStorage['csai_lang']`, then the browser language (Japanese for `ja*`, otherwise English). It has no language button, so to see it in another language set that key and reload.
- The rejection text comes from the server in the UI language (`Incorrect username or password` in English). English and Japanese exist (`ユーザー名またはパスワードが正しくありません`); every other language gets English.
- Logins are limited to 10 per minute per IP. Every `drive.mjs` run of a journey that signs in, and every `doctor.sh` run, is one login. This journey opts out of the automatic sign-in and makes two logins itself. On `429`, wait a minute.
- The admin password exists only for this instance and is printed once in `.run/server.log`. A changed password is not saved anywhere by the skill; cleanup and launch to get a new instance.
