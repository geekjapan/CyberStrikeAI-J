#!/usr/bin/env bash
# Model-check task-run cleanup (TaskCleanup.tla) and report drift of the covered Go code.
# Usage: .claude/skills/verify-task-cleanup/check.sh            run every check
#        .claude/skills/verify-task-cleanup/check.sh --drift    only print the diff of covered code since SYNC_COMMIT
# Exit: 0 verified and in sync | 1 a check gave the wrong answer | 2 verified, but covered code changed since SYNC_COMMIT | 3 tooling
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

# Commit at which TaskCleanup.tla was last confirmed to describe the covered code.
# Move it forward only after re-reading the covered functions against the model.
SYNC_COMMIT=30908361432ac5ab59b5129ad431b6812daa73dc
COVERED=(internal/runlease/scope.go internal/handler/task_manager.go internal/handler/task_lifecycle.go internal/mcp/execution_service.go)

if [ "${1:-}" = "--drift" ]; then git -C "$ROOT" diff "$SYNC_COMMIT" -- "${COVERED[@]}"; exit 0; fi

TLA_VERSION=v1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
CACHE="$HERE/.cache"; JAR="$CACHE/tla2tools.jar"

command -v java >/dev/null || { echo "TOOLING: java not found (TLC needs Java 11+)"; exit 3; }
mkdir -p "$CACHE"
sha() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
if [ ! -f "$JAR" ] || [ "$(sha "$JAR")" != "$TLA_SHA256" ]; then
  curl -fsSL -o "$JAR" "https://github.com/tlaplus/tlaplus/releases/download/$TLA_VERSION/tla2tools.jar" \
    || { echo "TOOLING: could not download tla2tools.jar $TLA_VERSION"; exit 3; }
  [ "$(sha "$JAR")" = "$TLA_SHA256" ] || { echo "TOOLING: tla2tools.jar checksum mismatch"; exit 3; }
fi

fail=0
# run <label> <bug> <expect: pass|violate> <property line for the cfg> <name that must be reported when violating>
run() {
  local label="$1" bug="$2" expect="$3" props="$4" must="$5" dir="$CACHE/run-$1"
  rm -rf "$dir"; mkdir -p "$dir"; cp "$HERE/TaskCleanup.tla" "$dir/"
  printf 'SPECIFICATION Spec\nCONSTANTS\n  Workers = {w1, w2, w3}\n  Bug = "%s"\n%s\n' "$bug" "$props" > "$dir/TaskCleanup.cfg"
  # -deadlock turns deadlock checking off: a finished run with no step left is the normal end state.
  (cd "$dir" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -deadlock -workers 1 -metadir "$dir/states" TaskCleanup > out.txt 2>&1)
  if grep -q "Model checking completed. No error has been found" "$dir/out.txt"; then got=pass
  elif grep -Eq "is violated|was violated" "$dir/out.txt"; then got=violate
  else got=error; fi
  local states; states="$(grep -Eo '[0-9]+ distinct states found' "$dir/out.txt" | tail -1)"
  if [ "$got" = "$expect" ] && { [ "$expect" = pass ] || grep -Eq "(Invariant|property) $must (is|was) violated" "$dir/out.txt"; }; then
    echo "ok    $label: $got as expected ${must:+($must) }[$states]"
  else
    echo "WRONG $label: expected $expect${must:+ of $must}, got $got -- see $dir/out.txt"; fail=1
  fi
}

SAFETY=$'INVARIANTS\n  TypeOK\n  NoWorkerOutlivesRun\n  UnconfirmedIsReported\nPROPERTY NoLateAdmission'
echo "== the code as modelled: every property must hold"
run main none pass "$SAFETY" ""
echo "== broken variants: each must be caught"
run bug-register-ignores-seal register_ignores_seal violate $'PROPERTY NoLateAdmission' "NoLateAdmission"
run bug-release-before-mark   release_before_mark   violate "$SAFETY" "UnconfirmedIsReported"
run bug-timeout-reported-clean timeout_reported_clean violate "$SAFETY" "NoWorkerOutlivesRun"
echo "== witnesses: each end status must be reachable"
run reach-finished     none violate $'INVARIANT NeverFinished'      "NeverFinished"
run reach-unconfirmed  none violate $'INVARIANT NeverUnconfirmed'   "NeverUnconfirmed"
run reach-failed       none violate $'INVARIANT NeverCleanupFailed' "NeverCleanupFailed"

echo "== drift of covered code since ${SYNC_COMMIT:0:12} (full diff: check.sh --drift)"
drift="$(git -C "$ROOT" diff --stat "$SYNC_COMMIT" -- "${COVERED[@]}")"
if [ -n "$drift" ]; then echo "$drift"; else echo "none"; fi

if [ "$fail" -ne 0 ]; then echo "RESULT: FAILED"; exit 1; fi
if [ -n "$drift" ]; then echo "RESULT: model verified, but covered code changed -- re-read it against the model (SKILL.md, 'When the covered code changed')"; exit 2; fi
echo "RESULT: verified, model in sync with the code"
