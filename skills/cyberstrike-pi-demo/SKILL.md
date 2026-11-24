---
name: cyberstrike-pi-demo
description: >-
  Full-featured example skill package: SKILL.md plus optional directories such as scripts/, references/, and assets/; verifies the Pi skill and HTTP in-package paths (authorized security testing and teaching only).
---

# CyberStrike x Pi Full-Featured Skill Demo

This package follows [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview): **`SKILL.md` is the manifest plus the main description** (there is no separate `SKILL.yaml`). The same directory may hold **`scripts/`**, **`references/`**, **`assets/`**, or any other subdirectory (as long as paths are safe and the package depth/file count limits are not exceeded), read through **`ListPackageFiles` / `resource_path`** and the local Pi tools. See also `FORMS.md` and `REFERENCE.md`.

## Overview

For one-shot verification of:

- The HTTP `GET /api/skills` list (`script_count`, `file_count`, `progressive`, etc. are derived/scanned results)
- `GET /api/skills/cyberstrike-pi-demo?depth=summary|full`
- `section=` maps to a **`##` heading** in `SKILL.md` or a short id for an ASCII heading (for example `## Payload Samples` usually maps to `section=payload`)
- The native **`skill`** tool in multi-agent mode (and optional local file tools) reading in-package relative path resources
- The native `skill` tool reading skill body text, scripts, and reference material

**Hard requirement**: any test needs written authorization and must stay within the agreed scope and time window.

## Authorized Testing Workflow

1. **Confirm scope**: domains / IPs, interface list, prohibited actions (DoS, data dumping, etc.).
2. **Record a baseline**: run read-only probes against the agreed assets, saving timestamps and summaries of the raw requests/responses.
3. **Test by category**: split tasks by vulnerability type; reconfirm the authorization boundary before high-risk actions.
4. **Evidence and report**: attach reproduction steps, impact, and remediation advice to each finding; redact sensitive data.
5. **Wrap up**: delete temporary accounts, clean up test data, hand over the report.

## Payload Samples

The following are **teaching placeholders**. Real testing must replace them with the target's context and must not be used against unauthorized systems:

- SQLi probe (error-based): `"'` (check whether it triggers a database error message leak)
- Reflected XSS (harmless): `<script>alert(1)</script>` → should be encoded or blocked by CSP in a lab target
- Path traversal (read-only check): `....//....//etc/passwd` (only in authorized file-read scenarios)

See `scripts/payloads.txt` for the full list.

## references/ and assets/

Used to verify that subdirectories other than `scripts/` are treated equally:

| Path | Purpose |
|------|---------|
| `references/citations.md` | Notes on citations and the HTTP `resource_path` test |
| `assets/README.txt` | Placeholder resource (can be swapped for a real binary to test the file read size limit) |

## Recommended Toolchain

| Stage | Example tools |
|------|-----------|
| Proxy and replay | Burp Suite, mitmproxy |
| Scanning and directories | ffuf, nuclei (lower concurrency to stay within authorization) |
| Vulnerability verification | Custom PoCs, official CLIs (sqlmap, etc.) only within the authorized scope |
| Records | Markdown + JSON snippet templates (see `scripts/report-snippet.json`) |

## Checklist and Verification

- [ ] Written authorization and test window saved
- [ ] Files under `scripts/` match the references in the body text
- [ ] The index can be checked on the web or via `GET /api/skills?...`; in a multi-agent session, load by package with the **`skill`** tool to save tokens
- [ ] For details, pull the full text through **`skill`**, or use HTTP `depth=full` and `section=<heading or short id>`
- [ ] For the raw script, use the local file tools or HTTP `resource_path=scripts/check-env.sh`
- [ ] `resource_path=references/citations.md` and `resource_path=assets/README.txt` can be read
