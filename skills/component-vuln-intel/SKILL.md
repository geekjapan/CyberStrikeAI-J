---
name: component-vuln-intel
description: >-
  Online intelligence gathering: once a component is identified, always run CVE / search engines / Chinese communities / GitHub PoC / asset engines / real-time intel / dependency expansion, plus a reroute when blocked. Use when a framework/component/version is identified and must search before exploit.
metadata:
  tags: [penetration-testing, red-team]
---

## Online intelligence gathering (component identified -> search the whole web immediately; results = leads/tentative, not a confirmed Fact until verified)

```
🔴As soon as a framework/component/version is identified -> stop local scanning and go online immediately (exploiting without searching = blind attack = violates the iron rule).
🔴Run ALL of the following sequence (not optional). Substitute {C} = component name, {V} = version. Every step must actually be visited with browser_navigate or terminal:

1.CVE databases (mandatory, find known vulnerabilities):
  terminal: searchsploit {C} {V}
  terminal: curl -s "https://cve.circl.lu/api/search/{C}/{V}" | python3 -c "import sys,json;[print(x['id'],x.get('summary','')[:80]) for x in json.load(sys.stdin)[:10]]"
  browser_navigate: https://github.com/advisories?query={C}+{V}
  browser_navigate: https://www.cvedetails.com/google-search-results.php?q={C}+{V}&sa=Search

2.Search engines (run at least 3, find vulnerability analyses + PoC):
  browser_navigate: https://www.google.com/search?q={C}+{V}+exploit+PoC+RCE+site:github.com
  browser_navigate: https://www.google.com/search?q={C}+{V}+漏洞+利用+复现
  browser_navigate: https://www.baidu.com/s?wd={C}+{V}+漏洞+利用+poc+getshell
  browser_navigate: https://www.bing.com/search?q={C}+{V}+CVE+exploit+poc
  browser_navigate: https://duckduckgo.com/?q={C}+{V}+vulnerability+exploit

3.Chinese security communities (mandatory, many Chinese-first disclosures with good in-depth analysis):
  browser_navigate: https://xz.aliyun.com/search?keyword={C}+漏洞
  browser_navigate: https://www.seebug.org/search/?keywords={C}
  browser_navigate: https://paper.seebug.org/search/?keyword={C}
  browser_navigate: https://www.freebuf.com/search?search={C}+{V}
  browser_navigate: https://ti.qianxin.com/vulnerability?keyword={C}
  browser_navigate: https://www.anquanke.com/search?s={C}

4.Search GitHub for PoC/exploit code (mandatory, the most direct way to get exploit code):
  terminal: curl -s "https://api.github.com/search/repositories?q={C}+{V}+exploit+OR+poc+OR+CVE&sort=updated&per_page=10" | python3 -c "import sys,json;d=json.load(sys.stdin);[print(x['full_name'],x['html_url'],x.get('description','')[:60]) for x in d.get('items',[])]"
  terminal: curl -s "https://api.github.com/search/code?q={C}+RCE+OR+shell+OR+exploit+language:python&per_page=5" | python3 -c "import sys,json;d=json.load(sys.stdin);[print(x['html_url']) for x in d.get('items',[])]"
  terminal: curl -s "https://api.github.com/search/repositories?q={C}+CVE&sort=stars&per_page=5" | python3 -c "import sys,json;d=json.load(sys.stdin);[print(x['full_name'],x['stargazers_count'],'★',x.get('description','')[:50]) for x in d.get('items',[])]"
  After finding a repository: curl -s "https://api.github.com/repos/{owner}/{repo}/readme" | python3 -c "import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)['content']).decode())"

5.Asset engines (find similar targets/exposure surface):
  browser_navigate: https://fofa.info/result?qbase64=$(echo -n 'app="{C}"' | base64)
  browser_navigate: https://www.shodan.io/search?query={C}+{V}
  browser_navigate: https://www.zoomeye.org/searchResult?q={C}
  browser_navigate: https://search.censys.io/search?resource=hosts&q=services.software.product:{C}

6.Real-time intel (latest 0day/in-the-wild exploitation):
  browser_navigate: https://x.com/search?q={C}+CVE+OR+0day+OR+exploit&f=live
  browser_navigate: https://www.reddit.com/r/netsec/search/?q={C}&sort=new&t=month
  browser_navigate: https://www.exploit-db.com/search?q={C}

7.Expansion chain (mandatory): after searching {C}, extract its dependency manifest (package.json/pom.xml/requirements.txt/go.mod) -> repeat 1-6 for each dependency

🔴Blocked-search handling sequence (on 403/CAPTCHA/empty results/timeout -> execute in order, do not give up):
  ①Change UA: curl -H "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "{URL}"
  ②Jina reader: browser_navigate: https://r.jina.ai/{original URL}
  ③Google cache: browser_navigate: https://webcache.googleusercontent.com/search?q=cache:{domain}+{keywords}
  ④Archive: browser_navigate: https://web.archive.org/web/{URL}
  ⑤GitHub API fallback (GitHub pages blocked but the API is not): use the curl commands from step 4 above
  ⑥Switch engine: Google blocked -> run Bing/DuckDuckGo/Baidu; Baidu blocked -> run Google/Bing
  ⑦Use a proxy: obtain a SOCKS5 proxy via the `proxy-tool-bootstrap` sequence and retry
  If all channels are blocked and there are still no results -> write a negative Fact "searched {C} {V} across all channels, no public vulnerabilities" -> switch to `zero-day-discovery`
```
