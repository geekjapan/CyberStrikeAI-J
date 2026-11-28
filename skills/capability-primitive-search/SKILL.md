---
name: capability-primitive-search
description: >-
  Capability primitives + state-space search: assemble read/write/exec/ssrf primitives into RCE equations A-F, map low-severity findings to primitives, search forward and backward, and cash out capabilities across domains. Use when no single RCE exists, when chaining low-severity vulnerabilities, or when deriving novel attack chains.
metadata:
  tags: [penetration-testing, red-team]
---

## Capability primitives + state-space search

```
Core idea: RCE is not a single "vulnerability". It emerges once a set of "capabilities" is assembled. Without one big hole, a few info-level or low-severity findings can still combine into code execution.
  Habit to break: "No RCE/deserialization/upload found → this site can't be broken". Your job is not to "find an RCE vulnerability". It is to "assemble the primitives that execution needs".
  Abstract every Fact into a capability primitive (don't record "found vulnerability X"; record "what capability I now hold + its limits"):
    read(path) write(path) exec(cmd) ssrf(url) sqli redirect(url) eval_expr idor(id) cred(svc,priv) coerce_auth write_acl

RCE needs only one of these equations to hold. Break it into obtainable primitives and assemble them:
  A. Can write a file + the file is executed as code                      = RCE
  B. Can control config/env + the config points at your code              = RCE
  C. Can reach an admin plane + the panel has a built-in execution feature = RCE (not a vulnerability, a feature!)
  D. Hold credentials + the service has a legitimate execution entry point = RCE (abusing a legitimate feature)
  E. Can read arbitrary files + read credentials + credentials log in to an execution point = RCE
  F. Can control data + the data flows into a dangerous sink (eval/template/SQL) = RCE

Low-severity → primitive mapping (translate "chicken-rib vulnerabilities" into puzzle pieces):
  info leak (.git/backups/stack traces)→source/paths/keys→feeds B/E/F | LFI/arbitrary read→read config keys→E, or log poisoning→A
  SSRF (even GET-only)→hit internal Redis/Consul/K8s/cloud metadata→C; cloud metadata yields temporary credentials→D
  weak/default/reused credentials→enter a backend with task/plugin/webhook/CI features→C | CORS/CSRF/XSS→use the admin's browser to call execution features→C
  controllable upload (even with extension limits)→combine with path traversal/parsing differences/.htaccess→A | config write→edit template/log/connection string→B
  SQLi (even read-only)→read hashes/keys→E, or OUTFILE→A | controllable template→SSTI→F | prototype pollution→pollute downstream properties→F

State-space search (when no ready-made chain exists, search for one yourself): state = current capability set, action = use a capability to unlock a new one, target = Goal.
  Forward: for each capability ask "what can it unlock?"; for each pair of capabilities ask "what do they combine into?"
    (read+write=edit config; ssrf+internal redis=RCE; sqli+FILE=webshell; coerce_auth+relay=domain SYSTEM; idor+massassign=make someone else admin)
  Backward (main method when stuck): fix Goal=execute commands→pick the equation closest to the current state as a template→set each missing primitive as a sub-goal→
    which low-severity finding/feature/info leak in hand can produce it?→if none, recurse into it or switch equations → forward and backward meet in the middle=the full chain emerges → verify segment by segment

Breakthroughs (don't walk past these):
  - "Feature as primitive": a backend's scheduled tasks/plugins/template editing/SQL console/file manager/import-export/webhook are legitimate features, but once logged in they are ready-made execution or read/write primitives. To a penetration tester there is no "feature vs vulnerability" split, only "capability".
  - Cross-protocol jumps: SSRF gopher/dict/file turns "can only send HTTP" into "hit Redis/send SMTP/read files".
  - Credential reuse is the universal glue: any password/key obtained anywhere is presumed reused across the whole network, so spray it everywhere. Lateral movement is often faster than vertical.
  - Parsing differences: when upload validation, routing, and the reverse proxy disagree, there is a bypass in the gap (double extension/encoding/Host confusion).
  - The time dimension: TOCTOU/predictable tokens/cache poisoning turn "occasionally" into "reliably" and unexploitable into exploitable.
  - Cross-domain cash-out: for every capability gained, ask "what is it worth in another domain?" Capability is a universal currency. Web SSRF→cloud metadata→account takeover; hardcoded APK secret→direct call to an internal API, bypassing frontend auth; supply chain→CI secrets→production.
  - Creative mode (when known combinations are exhausted): re-examine the capability boundary (can only read /var/log? what about /proc/self/environ?) | find sinks equivalent to RCE (writing crontab/.bashrc/CI config/LD_PRELOAD/authorized_keys/systemd unit all = RCE) | treat information (errors/timing/response length) as a side channel | invert assumptions: list "what I think is impossible" and ask of each "why is it impossible?"
> A derived chain is a hypothesis (it may be recorded tentatively as a note/chain). Write a confirmed Fact / record_vulnerability only after actual execution with evidence. The chain holds only when every step has been verified.
```
