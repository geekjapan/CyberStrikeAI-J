---
name: attack-surface-recon
description: >-
  Recon / attack surface mapping: passive whois/amass/crt.sh/FOFA/Shodan, active subfinder/httpx/naabu/katana/nuclei, DNS regional differences / CDN / Nginx catch-all / BT Panel / UniApp fingerprints. First action of an engagement; findings go to the project blackboard. Use when starting recon, asset mapping, fingerprinting, or CDN/DNS bypass discovery.
metadata:
  tags: [penetration-testing, red-team]
---

## Recon / Attack Surface Mapping

```
=== Recon / attack surface mapping (first action of an engagement, 60% of the time is spent here, don't rush into exploitation blind; upsert_project_fact ports/fingerprints immediately) ===
Passive first (does not touch the target, run all):
  terminal: whois {domain} | grep -iE 'org|name|email|registrant'
  terminal: amass intel -asn {ASN} -d {domain}
  browser_navigate: https://crt.sh/?q=%.{domain} (certificate transparency for subdomains)
  terminal: curl -s "https://crt.sh/?q=%.{domain}&output=json" | python3 -c "import sys,json;[print(x['name_value']) for x in json.load(sys.stdin)]" | sort -u
  terminal: dig +short {domain} @114.114.114.114; dig +short {domain} @8.8.8.8 (a difference = CDN)
  terminal: curl -s "https://web.archive.org/cdx/search/cdx?url=*.{domain}/*&output=text&fl=original&collapse=urlkey" | head -100
  browser_navigate: https://fofa.info/result?qbase64=$(echo -n 'domain="{domain}"' | base64)
  browser_navigate: https://www.shodan.io/search?query=hostname:{domain}
Active pipeline (step by step):
  terminal: subfinder -d {domain} -silent | tee subs.txt; amass enum -d {domain} -passive >> subs.txt; sort -u subs.txt -o subs.txt
  terminal: cat subs.txt | dnsx -silent | tee alive_subs.txt
  terminal: cat alive_subs.txt | httpx -silent -title -status-code -tech-detect -cdn | tee httpx_out.txt
  terminal: naabu -l alive_subs.txt -top-ports 1000 -silent | tee ports.txt; nmap -sCV -iL <(head -20 alive_subs.txt) -oN nmap_out.txt
  terminal: katana -list alive_subs.txt -silent -d 3 | tee urls.txt; gau {domain} >> urls.txt
  terminal: cat urls.txt | grep -iE '\.(js|json)$' | httpx -silent -mc 200 | while read u; do curl -s "$u" | grep -oiE '(api|secret|key|token|password|aws|endpoint)[^"]*'; done
  terminal: ffuf -u https://{target}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt -mc 200,301,302,403 -fs {catch-all-size}
  terminal: nuclei -l alive_subs.txt -t /root/nuclei-templates/ -severity medium,high,critical -o nuclei_results.txt
  → httpx output identifies a framework/version → immediately trigger the `component-vuln-intel` search sequence
🚨DNS regional restriction bypass: domestic Chinese CDNs (987dns/dnspod/Alibaba Cloud) often return 0.0.0.0 to overseas DNS; resolve with 114.114.114.114 to get the real IP. Compare multiple DNS: dig @1.1.1.1 vs @114.114.114.114 vs @8.8.8.8, a difference is the CDN regional policy. The real IP is hidden in the domestic DNS result.
🚨CDN response filtering bypass (GCCDN/PWS etc.): the CDN returns 502 instead of forwarding the backend response for specific URL patterns (admin paths/actuator):
  Fingerprint: Server: PWS/x.x.x.x | Via: 1.1 PS-XXX-XXXX:N (W) | X-Px: ms CS-XXX-XXXXnone(origin) | wildcard *.gccdn.net CNAME
  502≠does not exist: 502=backend response filtered by the CDN, 404=path really does not exist, 403=CDN routing rejection. Use the 502/404/403 differences to enumerate live endpoints
  Path traversal confirmation: /api/v1/v/..;/..;/actuator/env → 502 (exists, filtered) vs /api/v1/v/..;/..;/xxxx → 404 (natively nonexistent in Tomcat)
  CDN node multiple ports: scan ports 3000-9200 on the CDN IP (8000/8080/9090 often proxy the same backend but the rules may differ, 9200 may be a separate nginx)
  Bypass attempt matrix (all tested in this session and failed, recorded to avoid repetition): URL encoding/double encoding/case/semicolon suffix/TE whitespace smuggling/HTTP pipelining/Accept-Encoding/Range
  Useful information extraction: even on 502, a POST to actuator/env may still be executed by the backend (blind property write) → needs a refresh trigger (if refresh returns 404 the chain is broken)
🚨Nginx catch-all trap: a PHP CMS with a rewrite for all routes → every path returns 200 with the same size = catch-all (not that the file exists!). Identify: 3 random paths with identical size = catch-all. To find truly live paths, test with a .php suffix (nginx `location ~ \.php$` passes straight to FastCGI, nonexistent returns a real 404).
🚨Pure-FTPd puredb corruption ≠ authentication bypass: "Unable to read the indexed puredb file" = the virtual user db is broken, all usernames (including anonymous) trigger a 421 disconnect. PAM system user authentication also goes through puredb first → all fail. Not an attack surface, skip.
🚨Same-IP multi-site lateral movement: reverse-lookup the IP (SecurityTrails/ThreatBook/VirusTotal) to find other domains on the same server → break in through a weak site (independent nginx config returning real 404 = enumerable) → BT Panel manages everything uniformly = lateral access to all sites.
Fingerprint priority: once httpx/wappalyzer identifies a framework version → immediately switch to `component-vuln-intel` online intelligence. Map the attack surface first, then Reason to pick the fattest edge, don't dive in headfirst when you see one hole.
🚨DNS wildcard CDN identification: all subdomains (including nonexistent random ones) resolve to the CDN = wildcard DNS (*.domain → CDN CNAME). Enumerating subdomains is pointless then, all IPs are CDN nodes.
  Verify: dig random123456.target.com → if it also has an A record pointing to a known CDN IP = wildcard. The real origin IP must come from other channels (historical DNS/certificate transparency/other domains on the same server/email headers/SSRF)
🚨BT Panel (Baota) identification: cookie name is a 32-character hex hash (e.g. 789d6d2de16419a1e8bbfea926c8996e) + 302 redirect to /login + nginx reverse proxy + "入口校验失败" (entry verification failed) page = BT Panel random security entrance
  Windows version: IIS and nginx coexist, panel on port 8888, phpMyAdmin on port 888 (possibly), /index.html may leak site configuration (reverse proxy target URL/site name)
  Attacks: entrance path brute force (8 random alphanumeric characters) | historical CVEs (API key unauthorized access/phar deserialization) | reuse of the panel's default FTP/MySQL accounts
🚨Nginx 404 differential fingerprint: when an nginx catch-all rewrite masks the real paths, compare response sizes: a real nginx 404 (146B) = the file exists on disk but a location block denies it, catch-all (large page) = route not matched. Probe CMS marker paths in batch (/caches/configs/, /phpcms/modules/, /statics/, etc.) and distinguish response sizes to confirm the CMS type. See references/nginx-404-differential-fingerprinting.md
🚨UniApp/DCloud APK reversing quick path: assets/apps/__UNI__*/www/app-service.js = all business logic (obfuscated JS); assets/zlsioh.dat = encrypted config (API domain); lib/arm64-v8a/libirzlemnr.so = decryption library. Deobfuscate the JS with RC4+base64 (extract the a0G array + the a0m decoder); in the .so, strings for a random 16-character string = possible key, strings for the `x digits.digits.digits.digitsx` format = hardcoded IP (usually DCloud HTTPDNS infrastructure rather than the target API). See references/uniapp-dcloud-apk-reversing.md
```
