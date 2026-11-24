---
name: proxy-tool-bootstrap
description: >-
  Find your own proxies and bootstrap your own tools: SOCKS5/HTTP/Tor rerouting sequence, Python tool bootstrapping, self-generated wordlists, OOB infrastructure. Use when blocked by 403/429/WAF/timeout, missing tools, or needing OOB confirmation.
metadata:
  tags: [penetration-testing, red-team]
---

## Find your own proxy + bootstrap your own tools (reroute when blocked, write the tool yourself when missing)

```
🔴Proxy (on a denial/rate limit/timeout, the first reaction is not to retry but to reroute. Not rerouting = giving up = violating blackboard trigger 2 (see `pentest-blackboard`)):
  Execution sequence (in order; go to the next step only if the previous one fails):
  ①Probe the target region: terminal: curl -s "http://ip-api.com/json/{target IP}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['country'],d['countryCode'])"
  ②Get SOCKS5 proxies for that region: terminal: curl -s "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&country={countryCode}&timeout=5000" | head -20
  ③Verify the proxy can reach the target: terminal: curl --socks5 {PROXY_IP:PORT} --connect-timeout 8 -s -o /dev/null -w "%{http_code}" {target URL}
  ④200 = usable; immediately re-run the blocked request through this proxy; non-200 = try the next proxy and repeat ③
  ⑤All SOCKS5 failed → get HTTP proxies: terminal: curl -s "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&country={countryCode}&timeout=5000" | head -20
  ⑥Verify the HTTP proxy: terminal: curl --proxy http://{PROXY_IP:PORT} --connect-timeout 8 -s -o /dev/null -w "%{http_code}" {target URL}
  ⑦All proxies failed → Tor: terminal: curl --socks5 127.0.0.1:9050 --connect-timeout 15 {target URL}
  Add the proxy option to every tool: curl --socks5 / sqlmap --proxy=socks5://{P} / nmap --proxies socks5://{P} / nuclei -proxy socks5://{P} / ffuf -x socks5://{P}
  Rotation strategy: 429/403 → switch to the next proxy immediately, and rotate proactively every 20 requests (so the new IP does not get banned too) | Cloudflare → proxy pool + random 2-5s delay between requests
  🚨HTTP proxy vs SOCKS5: an HTTP proxy inserts its own error pages (502 / "this page cannot be displayed"), making it impossible to tell the target's real response → use SOCKS5 (--socks5) whenever you need to probe
    ProxyScrape SOCKS5: https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&country=CN,JP&timeout=5000
    Verify SOCKS5: curl --socks5 IP:PORT --connect-timeout 5 target | HTTP proxies are only suitable for anonymity/rotation against targets already confirmed reachable
Tool bootstrapping (which X || implement it in Python):
  No nmap → scan ports with sockets | No ffuf → brute-force directories with requests | No sqlmap → manual payload detection | No hydra → brute-force with requests | No nuclei → fire known payloads with requests
  Emulate complex tools in Python: crawler with requests+bs4 / encoding with base64/hex / hashing with hashlib / crypto with pycryptodome / sniffing with scapy
Self-generated wordlists: build variants from the target domain/company name | extract keywords from web pages | username+year+special-character combinations | service default credentials
OOB infrastructure (blind vulnerabilities all depend on it): interactsh-client to get an oast.fun domain | or on a VPS python3 -m http.server/nc to watch for callbacks | ngrok/cloudflared tunnels
  → An OOB callback (DNS query/HTTP request) must be seen before it counts as confirmed → write a Fact
```
