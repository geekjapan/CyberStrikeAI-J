---
name: verify-cyberstrikeai-preferences
description: Drive the CyberStrikeAI-J web UI in Chrome to verify sign-in, sign-out and persistent language and theme choices after changes to authentication, layout or appearance settings.
---

# Verify the web session and appearance settings

## Launch

From the repository root, run the executable below. It builds the current Go server, resolves the source-addressed Pi worker through the project's build command, and builds React into a temporary directory. A fresh SQLite database bootstraps the admin account. The server binds a dynamically selected loopback port. Its configuration, home directory, writable data and browser profile are separate for each run.

```sh
.cursor/skills/verify-cyberstrikeai-preferences/verify.mjs
```

Use the Go version required by go.mod, Node.js 22.19 or newer, npm, lsof and installed Google Chrome. Install the locked frontend dependencies with `npm ci --prefix web/frontend` on a fresh checkout. Building the Go or Pi dependencies for the first time may require package registry access. Verification itself uses an empty tool directory, a local model URL and a new browser session.

## Doctor

The helper checks that lsof attributes the selected loopback listener to the child PID and that Chrome sees the Username field. It writes the PID, origin and checkout commit to doctor.json. A successful form submission then confirms the seeded account is usable. On failure, rerun the command with fresh scratch state. While an instance is running, the read-only ownership check is `lsof -nP -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN`, using the PID and port in its doctor.json.

## Drive

The helper runs the three journeys in the [feature map](features/README.md) in one signed-in browser. It uses Playwright from web/frontend and imports the existing language journey from .claude/skills/verify-cyberstrikeai/journeys/language.mjs. The settings and header entry points both run against the real server.

## Evidence

The first output line names a private csai-ui-proof-* directory under the system temporary directory. Set VERIFY_EVIDENCE_DIR to an existing directory to keep proof elsewhere. Check the exit status and final PASS line. Inspect the screenshots, HTTP status checks and independently read browser storage values described in the feature map. JSON receipts contain selected observations. Passwords, tokens and raw HTTP bodies do not belong in evidence. A partial directory from a failed run shows how far the journey progressed.

## Cleanup

On success or an assertion failure the helper closes Chrome, stops its own server child and removes its private runtime directory. Proof stays in the separate evidence directory. The Go, npm and source-addressed Pi build caches are reusable. After a host crash, identify the exact scratch executable and its listener before cleaning up.

## Helpers

Run `VERIFY_EVIDENCE_DIR="$HOME/Documents" .cursor/skills/verify-cyberstrikeai-preferences/verify.mjs` to retain a run in Documents. Use /maintain-verification-skill when a mapped journey changes.
