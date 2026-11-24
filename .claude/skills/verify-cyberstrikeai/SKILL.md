---
name: verify-cyberstrikeai
description: Drive the real CyberStrikeAI web UI (Go server + React frontend) in an isolated local instance and capture proof. Use to prove a UI, API or i18n change works the way a user sees it, to reproduce a UI bug, or when asked to "verify", "prove" or "show" behaviour of the app.
---

# Verify CyberStrikeAI

The user touches one surface: the web UI served by the Go server (`cmd/server`), which calls the JSON API under `/api`. This skill starts a throwaway instance on `127.0.0.1`, signs in as `admin`, drives the UI in Chrome through Playwright, and saves screenshots plus the API writes it saw.

All paths below are relative to the repository root. Everything the skill creates is under `.claude/skills/verify-cyberstrikeai/` in `.run/` (instance) and `evidence/` (proof). Both are git-ignored.

## Launch

```bash
.claude/skills/verify-cyberstrikeai/launch.sh
```

It builds `./cmd/server` from the current checkout, creates `.run/instance/` (own `config.yaml`, own empty `data/`, copies of `roles/ skills/ agents/ tools/ knowledge_base/ plugins/ mcp-servers/ scripts/`), starts the server with `--http` on `127.0.0.1:18080`, waits for the `● ONLINE` log line, saves the one-time admin password to `.run/admin-password`, and runs the doctor. About 10 seconds. The first start on an empty data dir creates the schema and the `admin` user by itself; there is no seed step.

- Needs: Go, Node, `lsof`, `curl`, Google Chrome, and `npm ci` done once in `web/frontend` (Playwright lives there).
- Port taken: `VERIFY_PORT=18090 .claude/skills/verify-cyberstrikeai/launch.sh`. The scripts read the port back from `.run/port`.
- Only one instance at a time. `launch.sh` refuses to start a second one; it never touches a server the user runs from the repository root (that one uses `./config.yaml` and `./data/`).
- **Frontend changes:** the server serves the built files in `web/static/app/`, not `web/frontend/src`. After editing the frontend, run `npm run build` in `web/frontend` before launching, or you verify the old UI. Translation files in `web/static/i18n/` are served directly.
- **Chat model:** by default the instance has no reachable model (it points at a closed local port), so nothing is sent to a model provider. To verify chat, see `features/chat.md`.

## Doctor

```bash
.claude/skills/verify-cyberstrikeai/doctor.sh
```

Run it first whenever something looks off. It prints one `ok` / `FAIL` line each for: our process is alive, the port is held by our pid, no file under `cmd/`, `internal/`, `go.mod` or `go.sum` is newer than the binary, `GET /` returns 200, and `admin` can sign in. Exit 0 means the instance is worth driving. On `FAIL`, run cleanup and launch again; do not drive a stale build.

It writes nothing to disk. The login check opens one session, and the server allows 10 logins per minute per IP: a burst of doctor and drive runs can get `429`.

## Drive

A journey is a small module that acts as a user. Run one:

```bash
node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/projects.mjs
```

`drive.mjs` opens Chrome (headless, locale `en-US`, 1440×900), signs in through the login form, calls the journey, and exits 0 on `PASS`, 1 on `FAIL`. Shipped journeys: `login`, `language`, `projects`, `vulnerabilities`, `chat`. `features/` says what each proves.

To verify something new, copy the closest journey and change it. A journey gets:

| Argument | Use |
| --- | --- |
| `page` | Playwright page, already signed in. `export const login = false` starts signed out. |
| `expect` | Playwright assertions (5 s default; pass `{ timeout }` for slow steps). |
| `shot(label)` | Numbered screenshot into the evidence folder. Take one before the action and one after. |
| `api(path)` | `GET` on the API as the signed-in user, to check what the server stored. |
| `base` | `http://127.0.0.1:<port>`. Pages are hash routes: `${base}/#/projects`. |
| `login()` | Signs in through the form (for `login = false` journeys). |

Return a small object with what you observed; it lands in `result.json`.

Handles that hold in this app:

- Page ids are the route: `#/dashboard`, `#/chat`, `#/projects`, `#/vulnerabilities`, `#/tasks`, `#/settings`, … (folder names in `web/frontend/src/pages/`). Page content is inside `#main-content`.
- Prefer `getByRole('button', { name })`, `getByPlaceholder`, and `getByRole('dialog')`. Names are the en-US strings in `web/static/i18n/en-US.json`.
- Give `getByRole('dialog')` a name whenever a dropdown may be open inside it: Semi popovers are `role="dialog"` too.
- Dropdowns are Semi Design selects, not `<select>`: click the combobox, then `page.locator('.semi-select-option', { hasText: /^High$/ })`.
- Server text is English in the source and translated per request: API errors, chat stream status and failure lines, and the same lines in reloaded history follow the UI language (`Accept-Language`). Assert on status codes or on the en-US text.
- Some text is not translated and stays as stored: the admin's display name, audit records and conversations written by an earlier version, and the sub-agent prompts, skill bodies and C2 texts that are still Chinese in the repository.
- Never wait on translated status wording to detect that something finished; wait on a response, a URL, or an element's presence.
- The token is in `localStorage['cyberstrike-auth']`, the language in `localStorage['csai_lang']`.

## Evidence

Each run writes `.claude/skills/verify-cyberstrikeai/evidence/<UTC time>-<journey>/`:

- `NN-<label>.png`: screenshots in order. A failed run ends with `NN-FAILED.png`.
- `result.json`: `ok`, the journey's returned observations, the commit, the error if any, and `writes`, every non-GET API call with its status.

What counts as proof:

- Go through the UI path a user takes. `api()` is for reading the result, not for doing the action.
- Show the action and the state after it: a screenshot before submit, one after, and the matching line in `writes`.
- Check the side effect on the server, not only the screen: read it back with `api()`, or query `.run/instance/data/conversations.db` with `sqlite3` while the instance is up.
- Do not stub the API. The only stand-in is the model endpoint, which is outside the app.
- Report `commit` and `dirty` from `result.json`. `dirty: true` means tracked files had uncommitted changes when the journey ran.

Read a screenshot before you cite it. A `PASS` only says the assertions held.

## Cleanup

```bash
.claude/skills/verify-cyberstrikeai/cleanup.sh
```

Stops the recorded pid (only if it is still our server binary) and deletes `.run/`, including the instance database and the admin password. `evidence/` is kept. Run it after every session and after every failed launch. To keep the instance's database as proof, copy it into the evidence folder first.

## Helpers

| File | Invocation | Does |
| --- | --- | --- |
| `launch.sh` | `.claude/skills/verify-cyberstrikeai/launch.sh` | Build, create the instance, start, wait until ready, run doctor. Env: `VERIFY_PORT`, `VERIFY_AI_BASE_URL`, `VERIFY_AI_API_KEY`, `VERIFY_AI_MODEL`. |
| `doctor.sh` | `.claude/skills/verify-cyberstrikeai/doctor.sh` | Health check, exit 0 when drivable. |
| `drive.mjs` | `node .claude/skills/verify-cyberstrikeai/drive.mjs <journey.mjs>` | Run one journey, write evidence. |
| `cleanup.sh` | `.claude/skills/verify-cyberstrikeai/cleanup.sh` | Stop and delete the instance, keep evidence. |
| `journeys/*.mjs` | via `drive.mjs` | One journey per mapped feature. |

## Limits

- **Not isolated:** `web/` and `runtime/` are symlinks into the repository, so the instance reads them live. Tool executions started from chat run as local processes on this machine with the user's permissions. Do not point a journey at a host you are not allowed to test.
- **Secrets:** `.run/admin-password` and `.run/instance/config.yaml` (mode 600) hold the instance's password and any model key. Never copy them into evidence, a journey, or a report.
- **Not covered:** HTTPS (the instance runs `--http`), the robot integrations, external MCP servers, and anything that needs a model unless one is configured.
- Proven on macOS only. `lsof` and `ps` flags may differ elsewhere.

## Feature map

`features/README.md` lists the features this skill knows how to reach and prove. A change to a feature with several entry points is proven only when each listed entry point was driven.
