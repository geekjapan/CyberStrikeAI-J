---
name: source-code-hunting
description: >-
  Source code hunting: .git leaks, dangerous-function grep, JS RC4 deobfuscation, semgrep/CodeQL, trufflehog, patch diff, supply chain/CI. Use when hunting source leaks, secrets, JS deobfuscation, or supply-chain issues.
metadata:
  tags: [penetration-testing, red-team]
---

## Source Code Hunting

```
=== Source Code Hunting ===
.git leaks: git-dumper → git log -p --all (deleted sensitive files) | .svn/.DS_Store/composer.lock
Dangerous-function grep: exec/system/eval/unserialize/pickle.loads/render/curl_exec + hardcoded keys (sk-/ghp_/BEGIN RSA)
JS deobfuscation (RC4 + base64 string-array pattern): 1) extract the string array (var a0G=[...]) 2) find the decode function (a0m(idx,key) → RC4 decrypt + base64) 3) find the rotation IIFE (target offset) 4) rebuild the decoder in Node.js and batch-decode all strings → plaintext variable names/API paths/config
  UniApp signatures: app-service.js (business logic, often 800KB+ obfuscated) + zlsioh.dat (encrypted config, decrypted by native .so) + dcloud_uniplugins.json (plugin manifest)
Static scanning: semgrep --config=auto for a quick scan / CodeQL: build a database and write queries (taint solving + variant analysis methodology in `zero-day-discovery`)
Secrets deep dive: trufflehog/gitleaks scan full git history + docker image layers + npm/PyPI tarballs + frontend bundles (--only-verified separates live keys from dead ones)
Framework patch diff: clone and diff versions before/after a fix → what was fixed = where the vulnerability is | dependency chain: composer.json/npm audit/pip-audit
Supply chain/CI: dependency confusion (squatting internal package names on public registries) | GHA command injection ${{github.event.issue.title}} | self-hosted runner takeover | .npmrc/.pypirc credentials
```
