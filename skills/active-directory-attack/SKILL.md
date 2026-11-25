---
name: active-directory-attack
description: >-
  Internal domain attacks: BloodHound, Kerberoast, ADCS ESC1/ESC8, NTLM relay, coercion, DACL, DCSync, Zerologon/NoPac/PrintNightmare, mitm6, LLMNR, Linux internal networks. Use when attacking Active Directory, ADCS, NTLM relay, or internal domain.
metadata:
  tags: [penetration-testing, red-team]
---

## Internal domain attacks

```
=== Internal domain (the real 2023+ main battlefield) ===
Recon: BloodHound (SharpHound collection → attack paths) | Kerberos: GetNPUsers (AS-REP)/GetUserSPNs (Kerberoast)
🚨ADCS (one-shot with Certipy): certipy find -vulnerable | ESC1 request a domain admin cert with an arbitrary SAN | ESC8 relay to the CA and get a DC certificate
🚨NTLM relay (more important than PtH, which EDR often blocks): ntlmrelayx -t ldap --escalate-user / -t http CA --adcs (ESC8) / RBCD
🚨Coerced authentication: PetitPotam (MS-EFSRPC)/coercer spraying all protocols/printerbug → feed the relay
🚨DACL abuse: WriteDACL → grant yourself DCSync | shadow credentials certipy shadow (GenericWrite is enough, no password change, no trace)
DCSync: secretsdump -just-dc → krbtgt hash → Golden Ticket
🚨One-shot domain-killer CVEs (test these first; a hit is a direct domain admin): Zerologon (CVE-2020-1472, blank the DC machine account password → DCSync) | NoPac (CVE-2021-42278/42287, rename a machine account and request a DC TGT) | PrintNightmare (CVE-2021-34527, spooler RCE/load a malicious driver) | EternalBlue (MS17-010, direct RCE on old SMBv1)
🚨IPv6/mitm6 (must-try on default dual-stack internal networks): mitm6 hijacks DHCPv6+DNS → WPAD → ntlmrelayx to LDAP/ADCS (stealthier than LLMNR, first choice on modern internal networks)
LLMNR/NBT-NS poisoning: responder captures NetNTLMv2 → hashcat crack or relay
Linux internal: unauthenticated Redis (CONFIG SET dir to write an SSH key) | NFS showmount | Docker 2375
```
