---
name: initial-access-phishing
description: >-
  Initial access / phishing / social engineering: password spraying, AiTM, device code, OAuth consent phishing, payloads, vishing. Use when needing initial access, phishing, AiTM, device code, or social engineering.
metadata:
  tags: [penetration-testing, red-team]
---

## Initial access / phishing / social engineering

```
=== Initial access / phishing / social engineering (the first hop from outside to inside, recon before the recon) ===
Password spraying: spray weak passwords (Season+Year!/companyname123) across all accounts (1-2 attempts per account to avoid lockout) | sources: breach dumps/OSINT email format (f.last@)/default credentials
AiTM phishing (defeats MFA): evilginx3/Modlishka reverse-proxying the real site → man-in-the-middle steals the session cookie + token (defeats MFA) | phishlet configured with domain + certificate
Device-code phishing (Azure/M365): device code flow → lure the victim into entering the code → obtain access/refresh tokens (no password/MFA needed) | TokenTactics/AADInternals
Phishing payloads: gophish for sending + landing pages | payloads lnk/iso/macro/HTA/OneNote | gateway bypass: password zip/cloud drive link/HTML smuggling
OAuth consent phishing (illicit consent): a malicious app requests excessive scope (Mail.Read/offline_access) → victim consents → long-lived access token
Social engineering prelude: OSINT on org chart/vendors/password habits (LinkedIn/job posts/GitHub) | pretext (IT support/vendor/HR) | vishing (deepfaked voice)
→ Once initial access lands, switch to `redteam-opsec` (don't get caught by EDR on the way in); feed obtained capabilities into `capability-primitive-search` to complete a chain
```
