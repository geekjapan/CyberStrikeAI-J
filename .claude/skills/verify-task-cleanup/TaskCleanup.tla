---------------------------- MODULE TaskCleanup ----------------------------
(***************************************************************************)
(* Model of how one task run ends: runlease.Scope plus the callers that   *)
(* seal, cancel and wait on it.  Every action is one mutex critical       *)
(* section (or one lock-free transition) in the Go code named next to it. *)
(* Paths are relative to the repository root.                             *)
(*                                                                         *)
(* Bug selects a deliberately broken variant, so each property can be     *)
(* shown to fail.  Bug = "none" is the code as written.                   *)
(***************************************************************************)
EXTENDS FiniteSets

CONSTANTS Workers,  \* tool executions that may be started inside the run
          Bug

BugNames == {"none", "register_ignores_seal", "release_before_mark",
             "timeout_reported_clean"}

ASSUME Bug \in BugNames

VARIABLES
    sealed,       \* Scope.sealed
    registered,   \* keys of Scope.workers
    unconfirmed,  \* keys of Scope.unconfirmed
    wpc,          \* per tool execution: where its worker goroutine is
    marked,       \* per tool execution: MarkUnconfirmed already called
    fpc,          \* FinishTaskRun: idle / cancel / wait / record
    fresult,      \* what Scope.Wait returned to FinishTaskRun
    cpc,          \* CancelTask: idle / stopping
    status        \* what the task manager reports for the run

vars == <<sealed, registered, unconfirmed, wpc, marked, fpc, fresult, cpc, status>>

WorkerStates == {"new", "rejected", "running", "ended", "released"}
Statuses     == {"running", "cleaning", "finished", "cleanup_unconfirmed", "cleanup_failed"}

TypeOK ==
    /\ sealed \in BOOLEAN
    /\ registered \subseteq Workers
    /\ unconfirmed \subseteq Workers
    /\ wpc \in [Workers -> WorkerStates]
    /\ marked \in [Workers -> BOOLEAN]
    /\ fpc \in {"idle", "cancel", "wait", "record"}
    /\ fresult \in {"none", "clean", "unconfirmed", "failed"}
    /\ cpc \in {"idle", "stopping"}
    /\ status \in Statuses

Init ==
    /\ sealed = FALSE
    /\ registered = {}
    /\ unconfirmed = {}
    /\ wpc = [w \in Workers |-> "new"]
    /\ marked = [w \in Workers |-> FALSE]
    /\ fpc = "idle"
    /\ fresult = "none"
    /\ cpc = "idle"
    /\ status = "running"

---------------------------------------------------------------------------
(* Tool execution workers                                                  *)

\* Scope.Register, internal/runlease/scope.go.  Called from
\* ExecutionService.StartExecution in internal/mcp/execution_service.go
\* before the worker goroutine is started.
Register(w) ==
    /\ wpc[w] = "new"
    /\ IF sealed /\ Bug # "register_ignores_seal"
       THEN /\ wpc' = [wpc EXCEPT ![w] = "rejected"]      \* ErrClosed
            /\ UNCHANGED registered
       ELSE /\ wpc' = [wpc EXCEPT ![w] = "running"]
            /\ registered' = registered \cup {w}
    /\ UNCHANGED <<sealed, unconfirmed, marked, fpc, fresult, cpc, status>>

\* The tool call returns inside ExecutionService.runWorker, on its own or
\* because its context was cancelled.  No lock is held.
EndWork(w) ==
    /\ wpc[w] = "running"
    /\ wpc' = [wpc EXCEPT ![w] = "ended"]
    /\ UNCHANGED <<sealed, registered, unconfirmed, marked, fpc, fresult, cpc, status>>

\* Scope.MarkUnconfirmed, called from ExecutionService.finishEntry when a
\* remote MCP did not confirm that it stopped.  finishEntry runs before the
\* deferred entry.releaseLease() in runWorker.
MarkUnconfirmed(w) ==
    /\ \/ wpc[w] = "ended"
       \/ Bug = "release_before_mark" /\ wpc[w] = "released"
    /\ ~marked[w]
    /\ marked' = [marked EXCEPT ![w] = TRUE]
    /\ unconfirmed' = unconfirmed \cup {w}
    /\ UNCHANGED <<sealed, registered, wpc, fpc, fresult, cpc, status>>

\* The release func returned by Scope.Register, run by the deferred block of
\* ExecutionService.runWorker.
Release(w) ==
    /\ wpc[w] = "ended"
    /\ wpc' = [wpc EXCEPT ![w] = "released"]
    /\ registered' = registered \ {w}
    /\ UNCHANGED <<sealed, unconfirmed, marked, fpc, fresult, cpc, status>>

---------------------------------------------------------------------------
(* AgentTaskManager.FinishTaskRun, internal/handler/task_manager.go         *)

TaskExists == status \in {"running", "cleanup_failed"}

\* First m.mu section: waits for a CancelTask in flight (task.stopping),
\* sets task.finishing and Status "cleaning", calls task.workers.Seal().
FinishBegin ==
    /\ fpc = "idle"
    /\ cpc = "idle"
    /\ TaskExists
    /\ sealed' = TRUE
    /\ status' = "cleaning"
    /\ fpc' = "cancel"
    /\ UNCHANGED <<registered, unconfirmed, wpc, marked, fresult, cpc>>

\* task.workers.Cancel(): the locked part of Scope.Cancel seals and takes
\* the cancel funcs.  Calling them only makes workers end sooner, which
\* EndWork already allows at any time, so the calls are not a separate step.
FinishCancel ==
    /\ fpc = "cancel"
    /\ sealed' = TRUE
    /\ fpc' = "wait"
    /\ UNCHANGED <<registered, unconfirmed, wpc, marked, fresult, cpc, status>>

\* Scope.Wait reads workers and unconfirmed under one lock and returns when
\* no worker is left.
FinishWaitDone ==
    /\ fpc = "wait"
    /\ registered = {}
    /\ fresult' = IF unconfirmed = {} THEN "clean" ELSE "unconfirmed"
    /\ fpc' = "record"
    /\ UNCHANGED <<sealed, registered, unconfirmed, wpc, marked, cpc, status>>

\* Scope.Wait gives up after the 3 second context in FinishTaskRun while
\* workers are still registered.
FinishWaitTimeout ==
    /\ fpc = "wait"
    /\ registered # {}
    /\ fresult' = IF Bug = "timeout_reported_clean" THEN "clean" ELSE "failed"
    /\ fpc' = "record"
    /\ UNCHANGED <<sealed, registered, unconfirmed, wpc, marked, cpc, status>>

\* Last m.mu section: records the outcome.  "cleanup_failed" keeps the task
\* and clears task.finishing, so FinishTaskRun can be retried.
FinishRecord ==
    /\ fpc = "record"
    /\ status' = CASE fresult = "clean"       -> "finished"
                   [] fresult = "unconfirmed" -> "cleanup_unconfirmed"
                   [] OTHER                   -> "cleanup_failed"
    /\ fpc' = "idle"
    /\ fresult' = "none"
    /\ UNCHANGED <<sealed, registered, unconfirmed, wpc, marked, cpc>>

\* AgentTaskManager.UpdateTaskStatus with an end status (completed,
\* cancelled, failed, timeout): seals before FinishTaskRun is called.  It
\* does not set task.finishing, so FinishTaskRun still runs afterwards.
StatusSeal ==
    /\ fpc = "idle"
    /\ TaskExists
    /\ sealed' = TRUE
    /\ UNCHANGED <<registered, unconfirmed, wpc, marked, fpc, fresult, cpc, status>>

---------------------------------------------------------------------------
(* AgentTaskManager.CancelTask with ErrTaskCancelled (also Shutdown)        *)

\* m.mu section: returns early when task.finishing is set; otherwise calls
\* task.workers.Seal() and opens task.stopping.  The code also returns early
\* while Status is "cancelling"; the model allows the repeat, which only
\* adds behaviours.
CancelBegin ==
    /\ cpc = "idle"
    /\ fpc = "idle"
    /\ TaskExists
    /\ sealed' = TRUE
    /\ cpc' = "stopping"
    /\ UNCHANGED <<registered, unconfirmed, wpc, marked, fpc, fresult, status>>

\* task.workers.Cancel(), then task.stopping is closed on return.
CancelFinish ==
    /\ cpc = "stopping"
    /\ sealed' = TRUE
    /\ cpc' = "idle"
    /\ UNCHANGED <<registered, unconfirmed, wpc, marked, fpc, fresult, status>>

---------------------------------------------------------------------------
Next ==
    \/ \E w \in Workers : Register(w) \/ EndWork(w) \/ MarkUnconfirmed(w) \/ Release(w)
    \/ FinishBegin \/ FinishCancel \/ FinishWaitDone \/ FinishWaitTimeout \/ FinishRecord
    \/ StatusSeal \/ CancelBegin \/ CancelFinish

Spec == Init /\ [][Next]_vars

---------------------------------------------------------------------------
(* Properties                                                              *)

Ended == {"finished", "cleanup_unconfirmed"}

\* A run that is reported as ended has no tool execution still in flight.
NoWorkerOutlivesRun ==
    status \in Ended => \A w \in Workers : wpc[w] \in {"new", "rejected", "released"}

\* A run reported as cleanly finished has no unconfirmed remote execution,
\* now or later.
UnconfirmedIsReported ==
    status = "finished" => unconfirmed = {}

\* Once the scope is sealed it stays sealed and admits no new execution.
NoLateAdmission ==
    [][sealed => (sealed' /\ registered' \subseteq registered)]_vars

\* Witnesses: each must be VIOLATED, which shows the status is reachable and
\* the properties above are not passing vacuously.
NeverFinished    == status # "finished"
NeverUnconfirmed == status # "cleanup_unconfirmed"
NeverCleanupFailed == status # "cleanup_failed"
=============================================================================
