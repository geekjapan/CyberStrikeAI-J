#!/usr/bin/env bash
# Stop the instance launch.sh started and delete its scratch state.
# Kills only the recorded pid.  Never touches evidence/.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
RUN=$HERE/.run

if [[ -f $RUN/server.pid ]]; then
    PID=$(cat "$RUN/server.pid")
    # Only kill it if it is still our binary (the pid may have been reused).
    if ps -p "$PID" -o command= 2>/dev/null | grep -q 'cyberstrike-ai --http -config config.yaml'; then
        kill "$PID"
        for _ in $(seq 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
        if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID"; echo "pid $PID ignored SIGTERM, sent SIGKILL"; fi
        echo "stopped pid $PID"
    else
        echo "pid $PID is not our server; nothing killed"
    fi
fi
rm -rf "$RUN"
echo "removed $RUN; evidence kept in $HERE/evidence"
