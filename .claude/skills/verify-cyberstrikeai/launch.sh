#!/usr/bin/env bash
# Build the server from this checkout and start one isolated instance for
# verification.  Everything it creates lives under .run/ next to this script.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
RUN=$HERE/.run
PORT=${VERIFY_PORT:-18080}
[[ $PORT =~ ^[0-9]+$ ]] || { echo "VERIFY_PORT must be a number" >&2; exit 2; }
# The example config points chat at a public model gateway with a placeholder
# key.  Default to a closed local port so no prompt leaves this machine.
AI_URL=${VERIFY_AI_BASE_URL:-http://127.0.0.1:9/v1}
AI_KEY=${VERIFY_AI_API_KEY:-sk-none}
AI_MODEL=${VERIFY_AI_MODEL:-qwen3-max}
[[ $AI_URL =~ ^https?://[A-Za-z0-9._:/-]+$ && $AI_KEY =~ ^[A-Za-z0-9._-]+$ && $AI_MODEL =~ ^[A-Za-z0-9._:/-]+$ ]] ||
    { echo "VERIFY_AI_BASE_URL / VERIFY_AI_API_KEY / VERIFY_AI_MODEL contain unsupported characters" >&2; exit 2; }

if [[ -f $RUN/server.pid ]] && kill -0 "$(cat "$RUN/server.pid")" 2>/dev/null; then
    echo "already running (pid $(cat "$RUN/server.pid")). Run cleanup.sh first." >&2
    exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $PORT is in use by another process. Set VERIFY_PORT to a free port." >&2
    exit 1
fi

rm -rf "$RUN"
mkdir -p "$RUN/bin" "$RUN/instance"
echo "$PORT" > "$RUN/port"

echo "building server..."
(cd "$REPO" && go build -o "$RUN/bin/cyberstrike-ai" ./cmd/server)

# The server resolves tools/, roles/, data/ ... relative to the config file.
# Copy what the UI can edit, link what is large and only read.
for d in agents knowledge_base mcp-servers plugins roles scripts skills tools; do
    cp -R "$REPO/$d" "$RUN/instance/$d"
done
cp "$REPO/requirements.txt" "$REPO/config.example.yaml" "$RUN/instance/"
ln -s "$REPO/web" "$RUN/instance/web"
ln -s "$REPO/runtime" "$RUN/instance/runtime"

sed -e 's/^  host: 0\.0\.0\.0 /  host: 127.0.0.1 /' \
    -e "s/^  port: 8080 /  port: $PORT /" \
    -e "/^    qwen-max:\$/,/^      model: /{
          s|^      base_url: .*|      base_url: $AI_URL|
          s|^      api_key: .*|      api_key: $AI_KEY|
          s|^      model: .*|      model: $AI_MODEL|
        }" \
    "$REPO/config.example.yaml" > "$RUN/instance/config.yaml"
chmod 600 "$RUN/instance/config.yaml"
grep -q '^  host: 127\.0\.0\.1 ' "$RUN/instance/config.yaml" &&
    grep -q "^  port: $PORT " "$RUN/instance/config.yaml" &&
    grep -qxF "      base_url: $AI_URL" "$RUN/instance/config.yaml" &&
    ! grep -q 'dashscope' <(sed -n '/^ai:/,/^vision:/p' "$RUN/instance/config.yaml" | grep -v '^ *#') ||
    { echo "config.example.yaml changed: server.host/port or ai.channels were not rewritten" >&2; exit 3; }

cd "$RUN/instance"
nohup ../bin/cyberstrike-ai --http -config config.yaml > ../server.log 2>&1 &
echo $! > "$RUN/server.pid"

for _ in $(seq 60); do
    if ! kill -0 "$(cat "$RUN/server.pid")" 2>/dev/null; then
        echo "server exited during startup:" >&2
        tail -20 "$RUN/server.log" >&2
        exit 1
    fi
    if grep -q "ONLINE   http://127.0.0.1:$PORT/" "$RUN/server.log" &&
        grep -q '^  Password  ' "$RUN/server.log"; then
        # First start on an empty data dir prints a one-time admin password.
        (umask 077; awk '/^  Password  /{print $2; exit}' "$RUN/server.log" > "$RUN/admin-password")
        echo "ready: http://127.0.0.1:$PORT/  (user admin, password in $RUN/admin-password)"
        exec "$HERE/doctor.sh"
    fi
    sleep 1
done
echo "no ONLINE line after 60 s; see $RUN/server.log. Run cleanup.sh." >&2
exit 1
