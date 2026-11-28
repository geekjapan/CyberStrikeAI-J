#!/usr/bin/env bash
# Is the verification instance worth driving?  Changes nothing on disk.
# (The login check opens one server session; logins are limited to 10/minute.)
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
RUN=$HERE/.run
bad=0
ok()   { echo "ok    $*"; }
fail() { echo "FAIL  $*"; bad=1; }

[[ -f $RUN/server.pid && -f $RUN/port ]] || { echo "FAIL  no instance: run launch.sh"; exit 1; }
PID=$(cat "$RUN/server.pid"); PORT=$(cat "$RUN/port"); BASE=http://127.0.0.1:$PORT

if kill -0 "$PID" 2>/dev/null; then ok "process $PID alive"; else fail "process $PID is gone (see $RUN/server.log)"; fi

if lsof -nP -a -p "$PID" -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    ok "port $PORT is held by our process"
else
    fail "port $PORT is not held by pid $PID: something else may be answering"
fi

# Any server source newer than the binary means the instance runs old code.
# (web/static is served live through a symlink and needs no relaunch.)
newer=$(find "$REPO/cmd" "$REPO/internal" "$REPO/go.mod" "$REPO/go.sum" -newer "$RUN/bin/cyberstrike-ai" -print -quit)
if [[ -z $newer ]]; then
    ok "binary is newer than the server sources ($(git -C "$REPO" rev-parse --short HEAD))"
else
    fail "server code changed since launch (${newer#"$REPO"/}): run cleanup.sh, then launch.sh"
fi

if [[ -n $(git -C "$REPO" status --porcelain -- web/frontend/src) ]]; then
    echo "note  web/frontend/src has uncommitted changes; the server serves web/static/app, so run 'npm run build' in web/frontend if they should be visible"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)
if [[ $code == 200 ]]; then ok "GET / -> 200"; else fail "GET / -> $code"; fi

if VERIFY_BASE=$BASE VERIFY_PW_FILE=$RUN/admin-password node -e '
    const pw = require("fs").readFileSync(process.env.VERIFY_PW_FILE, "utf8").trim();
    fetch(process.env.VERIFY_BASE + "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: pw }),
    }).then(async r => { const j = await r.json(); if (!r.ok || !j.token) { console.error(r.status, j.error || ""); process.exit(1); }
        console.log("ok    admin login works, app_version " + j.app_version); })
      .catch(e => { console.error(String(e)); process.exit(1); });'
then :; else fail "admin login with $RUN/admin-password"; fi

exit $bad
