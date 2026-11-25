# Session

## Sub-features

Sign in with the seeded admin account, keep the session through reload and sign out.

## How to get to it (user POV)

Open the instance root. Once signed in, open the user menu in the header to sign out.

## Driving it with Playwright

Fill Username and Password in the sign-in form and submit. Require POST /api/auth/login to return 200 and the application header to appear. After the preference journeys reload the page, choose Sign out. Require POST /api/auth/logout to return 200, the Username field to reappear and cyberstrike-auth to be absent from localStorage. Inspect signed-in.png, signed-out.png and session.json.

## Gotchas

The fresh database creates a new password on each run. The helper reads its own bootstrap output in memory. A screenshot of a login form alone does not establish that a session was cleared.
