---
name: verify-formal-principal
description: Verify bounded authorization principal grant snapshots and permission scope precedence when internal/authctx/principal.go or its identity propagation callers change.
---

# Principal data protection verification

A principal must retain its original grants and permission-specific scopes after its input maps change; a granted permission's nonblank scope must take precedence over the global fallback. Otherwise a background operation may acquire another role's broader data access.

Run from the repository root:

```sh
python3 .cursor/skills/verify-formal-principal/scripts/verify.py --mutation
```

The command needs Python 3 (standard library only) and Go. Last verified with Python 3.13.12 and Go 1.26.4 on darwin/arm64; it disables module resolution, network dependency downloads and automatic Go toolchain downloads. The source uses only the Go standard library. Temporary directories are removed on exit. No repository source is rewritten.

## Coverage and bounds

This is **bounded exhaustive actual-code verification**, not an SMT proof or an unbounded proof of the application. No Gobra, Dafny or TLC executable was available. Instead of proving a hand-translated model, the runner copies the current `internal/authctx/principal.go` unchanged to a temporary directory and executes it with [principal_test.go](scripts/principal_test.go).

The state space exhausts 17,496 combinations: three distinct permission keys, each absent/false/true; each associated scope absent/empty/ASCII whitespace/`assigned`/`all`/padded `assigned`; and global scope empty/`assigned`/padded `all`. Every state checks all three keys with exact and whitespace-padded queries, before and after changing every caller-owned input-map entry. Both `HasPermission` and `ScopeFor` are checked (24 method calls per state). An additional case covers nil input maps. Test failures print the phase, global scope, grant-state and scope-state indices, query and expected/actual values; decode indices in radix 3 and 6 respectively, in the test's key order.

| Property | Real code covered | Broken real-source variant required to fail |
| --- | --- | --- |
| `GRANT_SNAPSHOT` | `NewPrincipalWithScopes` grant filtering/map copy; `Principal.HasPermission` lookup | Treat false grants as true; alias input permissions |
| `SCOPE_SNAPSHOT_PRECEDENCE` | `NewPrincipalWithScopes` scope filtering/map copy; `Principal.ScopeFor` | Alias input scopes; prefer global scope |

Coverage synchronized at commit `a5f0e5e0478c761a32e2bf257f4496b653893aa6`, with `internal/authctx/principal.go` SHA256 `fbdea08748180ad9378962d26334b6c5669cc7a5a4feef5a81a18d71305e40df`.

Affected integration paths to inspect when this promise changes: `internal/security/auth_middleware.go` (`AuthMiddleware`), `internal/handler/robot.go` (`robotPrincipal`), `internal/handler/batch_queue_executor.go` (principal construction), and `internal/app/mcp_authorization.go` (permission and scope consumers). These callers are context for impact analysis; this command does not execute them.

## Read the result

Baseline and restored baseline must pass. Each of the four named mutations must fail specifically in its expected property; a compilation/tool failure does not count. Mutation anchors must each match once or the command stops for source drift.

For example, with global scope `all` and granted `chat:read` scoped `assigned`, preferring the global scope yields `all` where `assigned` was required. With an aliased permissions map, constructing a denied `chat:read` then changing the caller's map to true grants it on the existing principal. These are defensive counterexamples; no service or external tool is invoked.

If baseline fails, retain the printed counterexample and inspect the real constructor/lookup functions. Decide whether this is a product defect or an intentionally changed contract. Report defects without changing product code as part of this skill. Do not weaken the expected result to make a failure pass. A missing mutation anchor means the check must be adapted to the source before claiming mutation coverage.

After relevant code changes, use `/maintain-formal-verification-skill`: compare the covered functions and callers with the synchronization commit, update bounds/properties and mutation anchors as needed, rerun this command, and move the commit/hash forward only after confirming that the check still describes the code.

## Limits

The finite domain does not prove arbitrary map sizes, arbitrary permission names or Unicode whitespace, concurrency, context propagation, HTTP/MCP enforcement, database ownership or complete RBAC policy. It does not prove an immutable exported `Principal`: callers can directly mutate its public maps. `ScopeFor` deliberately returns the legacy fallback even for an ungranted permission; authorization must also call `HasPermission`. Neither behavior is silently redefined by this check.
