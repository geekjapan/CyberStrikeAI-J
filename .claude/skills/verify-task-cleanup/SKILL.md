---
name: verify-task-cleanup
description: Model-check how a task run ends (runlease.Scope, FinishTaskRun, CancelTask, tool execution leases) with TLA+. Use when a change touches internal/runlease, the seal/cancel/wait or status code in internal/handler/task_manager.go, or the lease handling in internal/mcp/execution_service.go, or when asked whether a tool can keep running after a task is reported finished or cancelled.
---

# Verify task-run cleanup

## What is verified

**Promise.** When a task run is reported as ended (`finished`, i.e. completed / cancelled / failed / timeout, or `cleanup_unconfirmed`), none of its tool executions is still in flight, and none can start afterwards.

**Harm if it breaks.** A scan or exploit tool keeps acting on a target after the operator saw the task end or pressed stop, with nothing in the UI showing it.

The check covers every order in which three tool executions, one `FinishTaskRun` (with retries) and `CancelTask` calls can interleave. Three properties:

| Property | Plain meaning |
| --- | --- |
| `NoWorkerOutlivesRun` | A run reported as ended has no tool execution running or still holding its lease. |
| `UnconfirmedIsReported` | A run reported as cleanly finished has no remote execution whose stop is unconfirmed. Such a run must end as `cleanup_unconfirmed`. |
| `NoLateAdmission` | Once the scope is sealed it stays sealed and accepts no new tool execution. |

## Run it

```bash
.claude/skills/verify-task-cleanup/check.sh
```

Needs Java 11+ and, on first run, network access: it downloads TLC (`tla2tools.jar` v1.7.4, pinned by sha256) into `.claude/skills/verify-task-cleanup/.cache/`. Takes about 5 seconds.

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | All properties hold, broken variants are caught, covered code unchanged since the sync commit. | Nothing. |
| 2 | The model still verifies, but covered code changed since the sync commit. The model may no longer describe the code. | Follow "When the covered code changed". |
| 1 | A line starts with `WRONG`. | Follow "When a check is WRONG". |
| 3 | Java or the TLC download failed. | Fix tooling; this says nothing about the code. |

The script runs three groups: `main` (the code as modelled, must pass), `bug-*` (three deliberately broken variants, each must be **violated**, which shows the properties can fail), and `reach-*` (each end status must be reachable, so the properties do not pass vacuously).

## What the model covers

`TaskCleanup.tla` has one action per mutex critical section or lock-free transition. Each maps to code a reviewer can open:

| Model action | Code | What it does |
| --- | --- | --- |
| `Register` | `Scope.Register` in `internal/runlease/scope.go`, called by `ExecutionService.StartExecution` in `internal/mcp/execution_service.go` | Admits a tool execution, or returns `ErrClosed` when sealed. |
| `EndWork` | `ExecutionService.runWorker` (the tool call returns) | The tool stops, on its own or after cancellation. |
| `MarkUnconfirmed` | `Scope.MarkUnconfirmed`, called by `ExecutionService.finishEntry` | Records that a remote MCP did not confirm it stopped. |
| `Release` | release func from `Scope.Register`, run by the deferred block of `runWorker` **after** `finishEntry` | Gives the lease back. |
| `FinishBegin` | first `m.mu` section of `AgentTaskManager.FinishTaskRun` in `internal/handler/task_manager.go` | Waits out a cancel in flight, sets `task.finishing`, seals. |
| `FinishCancel` | `task.workers.Cancel()` → locked part of `Scope.Cancel` | Seals and takes the cancel funcs. |
| `FinishWaitDone` / `FinishWaitTimeout` | `Scope.Wait` under the 3 second context | Returns when no worker is left, or gives up. |
| `FinishRecord` | last `m.mu` section of `FinishTaskRun` | Records `finalStatus`, `cleanup_unconfirmed` or `cleanup_failed` (retryable). |
| `StatusSeal` | `AgentTaskManager.UpdateTaskStatus` with an end status | Seals early, before `FinishTaskRun` is called. Not every caller of `FinishTaskRun` goes through it. |
| `CancelBegin` / `CancelFinish` | `AgentTaskManager.CancelTask` with `ErrTaskCancelled`, also used by `Shutdown` | Seals, cancels, closes `task.stopping`. |

**Sync commit:** the `SYNC_COMMIT` variable in `check.sh` (the only place it is recorded). The model was confirmed against the covered files (`COVERED` in `check.sh`) at that commit.

## A change touches this if

It edits any function in the table, the order of the deferred steps in `runWorker`, the order of `Seal` / `Cancel` / `Wait` in `FinishTaskRun`, how `cleanup_failed` / `cleanup_unconfirmed` are decided (`taskCleanupResult`, `taskCleanupStatus` in `internal/handler/task_lifecycle.go`), or adds a new place that starts tool work for a task. `check.sh` flags any edit to the covered files, including unrelated ones; unrelated edits need no model change, only a new sync commit.

## When the covered code changed (exit 2)

1. Read the drift: `.claude/skills/verify-task-cleanup/check.sh --drift` prints the diff of the covered files since the sync commit.
2. For each hunk inside a function from the table, ask: does it change what the mapped action reads, writes, or waits for, or the order of two actions? Edits to logging, events, status strings other than the end statuses, or code outside the table do not.
3. If yes, edit that action in `TaskCleanup.tla` so it says what the code now does, and update its row in the table above to match. Change the model to match the code, never to make the check pass. If one critical section was split in two, split the action too.
4. Run `check.sh` again.
   - `main` passes: the change keeps the promise.
   - `main` is `WRONG` with a violated property: the change breaks the promise. That is a finding about the Go code; go to the next section. Leave the sync commit where it is.
5. Move the sync commit only when all three hold: the model describes the code, `main` passes, and the change is committed. Then set `SYNC_COMMIT` in `check.sh` to that commit, and rerun to see exit 0. While the change is uncommitted, exit 2 is the expected result; say so in your report and leave the sync commit alone.

## When a check is WRONG (exit 1)

Open the file named on the `WRONG` line (`.cache/run-<label>/out.txt`).

Read `main` first. If `main` is `WRONG`, ignore `WRONG` on `bug-*` lines until it is fixed: TLC reports the shortest counterexample, so a broken `main` often makes a variant fail on a different property than the one expected.

- **`main` reports a violated invariant or property.** Read the steps: `grep -E '^(State|Error)|wpc|sealed|registered|unconfirmed|status' .claude/skills/verify-task-cleanup/.cache/run-main/out.txt` prints each action with the values that matter (`wpc` shows which worker moved); each `State N: <Action ...>` is one row of the table above. Retell it in the code's words, for example: "worker w1 registers, the tool returns, the lease is released, `FinishTaskRun` seals and `Wait` returns clean, then `finishEntry` calls `MarkUnconfirmed`: the run is reported `finished` although the remote stop is unconfirmed."
  - If each step is something the Go code can really do in that order, it is a **bug in the code**. Check the first step of each actor against its callers: for example `grep -rn "FinishTaskRun(" internal --include='*.go'` shows which callers reach `FinishBegin` without `UpdateTaskStatus` or `CancelTask` having sealed first. Report the sequence to the user. Do not weaken the property or the model, and do not change product code unless asked.
  - If a step cannot happen in the code (the model lets two things interleave that one lock makes atomic, or allows an action the code guards), it is a **modelling error**. Fix the action, note why in a comment, rerun.
- **A `bug-*` line is WRONG** (a broken variant passed): the property it guards can no longer fail, so `main` passing proves less than it claims. A model edit probably removed the behaviour the variant breaks. Restore it.
- **A `reach-*` line is WRONG**: an end status became unreachable in the model, so properties about it pass vacuously. Find the guard that blocks it.
- **Anything else in `out.txt`** (parse error, `TLC threw an unexpected exception`): the `.tla` does not parse. Fix the syntax.

TLC's deadlock check is switched off (`-deadlock`): a finished run with no step left is the normal end state, not a hang.

## What this does not cover

- **It checks a model, not the Go code.** The table is the link; the drift check only tells you the files changed. A pass means the design keeps the promise, if the model still describes the code.
- **Bound:** three tool executions and one task run. `MaxTaskWorkers` (256) and the duplicate-id check are not modelled.
- **Safety only.** It does not show that cleanup ever completes, that cancel funcs stop a tool, or that `Wait` wakes up. A tool that ignores cancellation ends as `cleanup_failed`, which the model allows.
- **Local processes** (`security.ProcessScope`, `task.processes.Close()`) are a separate mechanism and not modelled.
- **`ErrInterruptContinue`** cancels do not seal and are not modelled.
- **Untracked executions.** `Scope.Register` on a nil scope succeeds without tracking. A tool execution started from a context that did not pass through `AgentTaskManager.BindProcessScope` is outside this guarantee.
