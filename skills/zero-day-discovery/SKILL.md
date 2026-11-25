---
name: zero-day-discovery
description: >-
  Autonomous 0day discovery engine: variant analysis / patch gaps / differential / fuzzing / taint reasoning / N-day weaponization / hunter mindset. Use when public vulns not found and need to discover 0day or weaponize N-day.
metadata:
  tags: [penetration-testing, red-team]
---

## Autonomous 0day discovery engine (dig your own when nothing is findable on the web)

```
Core shift: from "match a known vulnerability database" → "understand how the code/protocol works and infer where it breaks". 0day is method, not luck.
Five main paths:
  1. Variant analysis (most productive): take a CVE patch → distill the vulnerability pattern → grep the whole codebase for the same pattern elsewhere → what the patch did not cover = 0day
  2. Patch gaps: read the patch's filter logic; a blacklist can almost always be bypassed (some encoding/equivalent function/alias is missed) → new CVE
  3. Differential testing: two components disagree about the same input (WAF vs backend / validator vs executor) → smuggling/SSRF bypass
  4. Fuzzing: write a harness (wrapping the function that handles untrusted input) + build corpus/dictionary + crash triage (reproducible/controllable/exploitable)
     AFL++/libFuzzer (coverage-guided memory corruption) boofuzz (protocols) radamsa (black box) restler (REST API)
  5. Taint reasoning (strongest with source): source (parameter/Header/deserialized field) reaching a sink (exec/SQL/template) with no effective sanitizer = 0day
     Write CodeQL queries to compute data-flow reachability automatically / Semgrep / Joern
N-day weaponization (advisory is out but no public PoC): reconstruct the exploit backwards from the patch diff (bindiff/diaphora binary comparison;
  the vendor's regression test is often a PoC in embryo) → get it working in a local lab → hit the target. Maximizes the vulnerability window; one of the most valuable red-team skills.
Hunter mindset (interrogate any code/endpoint/protocol layer by layer; every "yes" is a 0day candidate):
  Trust boundary: is this input assumed trustworthy? When does that break? | State timing: can state change between two steps (TOCTOU)? Can order be scrambled?
  Parse/normalize: how many times is it parsed? Is normalize before or after validation? | Boundary extremes: negative/0/huge/type confusion/encoding/null byte?
  Implicit capability: what does this feature hand me "for free"? | Uniqueness: are IDs/tokens predictable? Is the "secret" really secret?
Turn each component into a list of assumptions and break them one by one: file upload implicitly assumes "images only / extension is trusted / filename has no path / content is only data" → breaking each one = vulnerability, combining them = chain.
0day validation (a higher bar than for a CVE): reproducible (minimal PoC) + clear root cause (which line/which assumption) + provable impact (actual read/write/execute) + false positives ruled out.
```
