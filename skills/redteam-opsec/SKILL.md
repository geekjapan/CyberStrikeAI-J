---
name: redteam-opsec
description: >-
  OPSEC covert-operations discipline: IP blacklist bypass, rate/timing, traffic blending, minimal footprint, anti-forensics, gradual exposure. Use when maintaining stealth, bypassing IP bans, or planning covert red-team ops.
metadata:
  tags: [penetration-testing, red-team]
---

## OPSEC / covert-operations discipline (evasion / stability / stealth)

```
Core: getting in ≠ staying in. Being spotted zeroes the operation. Before every action ask "how does this step look to the defender".
🚨IP blacklist bypass (try first thing after being banned): X-Forwarded-For: random IP (when the CDN trusts this header it bypasses the app-layer blacklist outright; on code:10010/blacklist try XFF/X-Real-IP/CF-Connecting-IP/True-Client-IP one by one)
  Verify: a normal request returns "blacklisted" + your IP → adding the XFF header returns a normal 200 → carry XFF on all subsequent requests
  Advanced: rotate the XFF value every N requests (so the new IP doesn't get banned too) | some CDNs trust only the first XFF value, others only the last
Rate and timing: throttle scans (nuclei -rl / nmap -T2 --max-rate / ffuf -p delay) to avoid WAF bans + IDS threshold alerts | run high-risk actions rarely with random jitter | avoid business peak hours and also late night (matching the target's schedule is least conspicuous)
Traffic blending: mimic normal business (common UA/Referer/legitimate paths) | probe defenses before heavy tooling (process list/known EDR/SIEM agent signatures) → if present prefer quiet techniques, only use automated bulk when nothing is monitoring
Minimal footprint: prefer in-memory execution with no disk writes (DDexec/memfd/reflective loading) | webshell with a strong password + uncommon path + disguised functionality | tunnel over 443/DNS and blend with common egress | delete tools as soon as done (/dev/shm memory disk, leave no residue)
Anti-forensics: shell history via unset HISTFILE / set +o history | delete only your own log lines (a full truncate itself triggers alerts) | preserve mtime with touch -r against a neighbouring file | do not touch monitoring/audit services (stopping them is an alert)
Gradual exposure: passive recon (certificate transparency/passive DNS/search engines/asset engines) → confirm no strong monitoring → only then active scanning → only then exploitation and footholds. Never actively touch the target for anything public intel can give you. At every escalation ask "is it worth the exposure".
> Stealth is not fussiness, it is a red team's survival trait. One reckless full-port full-speed scan can zero the whole operation.
```
