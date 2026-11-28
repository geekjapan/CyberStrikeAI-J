## CyberStrikeAI Browser Extension

**Current version: 0.3.11** (the UI is in English)

Chrome / Edge (Chromium) DevTools extension: capture **Network** traffic in the developer tools and send it to CyberStrikeAI for AI-assisted security testing. Its capabilities are aligned with the Burp Suite plugin, with performance and usability tuned for production use.

---

### Quick start

1. `chrome://extensions/` → Developer mode → **Load unpacked**
2. Select the directory: `plugins/browser-extension/cyberstrikeai-browser-extension/`
3. Open the target page → **F12** → top tab **CyberStrikeAI**
4. Fill in Host / Port / Username / Password → **Validate** (the first time, the browser asks for permission to access the server address)
5. Select a captured request on the left → **Send** → view the AI result in **Output**

Click the browser toolbar icon to see a **read-only connection status**; all configuration and operations are done inside the DevTools panel.

---

### UI overview

```
┌─ Connection bar (collapsible after Validate succeeds) ──────┐
│ Logo │ https://host:port │ Connection │ ● OK                │
├─ Action bar ────────────────────────────────────────────────┤
│ Send │ Latest XHR │ Stop │ Copy │ Clear Output │ ● Capturing / ○ Paused │
│                    XHR/Fetch only │ Debug events │ Markdown │
├──────────────┬──────────────────────────────────────────────┤
│ Test History │ Output │ Request │ Response                   │
│ Captured Req │ Progress + Final Response                    │
└──────────────┴──────────────────────────────────────────────┘
```

| Area | Description |
|------|-------------|
| **Connection bar** | Host, Port, HTTPS, Username, Password, Validate; after success it collapses to an `https://host:port` summary |
| **Test History** | Up to 50 Send records; review their Progress / Final output |
| **Captured Requests** | Captured list for the current tab, up to 200 entries, with search |
| **Output** | Default tab: streaming Progress + Final Response |
| **Request / Response** | The raw HTTP/1.1 text of the selected traffic |

---

### Features

#### Capture

- **Background hub**: `devtools.js` listens to Network → `service-worker` queue → Panel subscription
- **XHR/Fetch only** by default (turn it off to capture more types)
- Static-resource URLs / MIME types are **pre-filtered**; the response body is not read before a request passes the filter
- **● Capturing / ○ Paused**: zero overhead while paused, and the existing list can still be sent
- Per-entry truncation: request body **64KB**, response **4KB**

#### HTTP display and AI prompt

- **Storage**: the original HAR is kept in memory (including HTTP/2 pseudo-headers such as `:method`)
- **Display / Prompt**: normalized to **HTTP/1.1** (same as the Burp plugin)

```http
GET /api/foo HTTP/1.1
Host: example.com
Cookie: ...
```

#### Sending to CyberStrikeAI

- Dialog to choose the **project / role / agent** (loaded dynamically from the API) plus the test instruction
- Supports **Pi Single**, **Deep**, **Plan-Execute**, and **Supervisor**
- **Latest XHR**: one click selects the most recent API request and opens the send dialog
- **Stop**: aborts the local SSE stream and calls the server's `/api/agent-loop/cancel` (using the run's `conversationId`)

#### Streaming output

- The Progress log is capped at **512KB** (anything beyond is truncated)
- **Final Response is not truncated** (for the test currently in progress)
- After you switch to another run, a historical Final is soft-truncated to **100KB**
- **Markdown**: plain text while streaming; rendered with `requestIdleCallback` once finished; falls back to plain text above **100KB**
- **Copy**: copies the current Request / Response / Final

#### Security and permissions

- The token is stored in **chrome.storage.session** (it becomes invalid when the browser closes)
- After login, **`expires_at`** is saved and the status bar shows the **remaining time** (for example `OK · 11h 30m left`)
- **No automatic renewal**: after expiry you must Validate again (the Password is required)
- Local expiry check (every 30s) plus a server probe of `/api/auth/validate` (same interval; it also probes immediately when you switch back to the panel)
- When the server is unreachable the status shows **Cannot reach server — confirm CyberStrikeAI is running**; when the token is invalid after a restart it shows **Server restarted or token invalid — please Validate again**
- On **401/403** the token is cleared automatically and the connection bar expands
- The token is validated proactively before Send
- **optional_host_permissions**: access is granted on demand during Validate
- The permission request is tied directly to the Validate click and covers only the current CyberStrikeAI server origin; an address that is already authorized does not prompt again

---

### Buttons and options

| Control | Action |
|---------|--------|
| **Validate** | Log in and validate the token; clicking it again while it is running cancels (the button shows Cancel) |
| **Connection / Collapse** | Expand or collapse the Host/Port/Username/Password form |
| **Send** | Send the selected capture to CyberStrikeAI |
| **Latest XHR** | Select the most recent XHR/Fetch request and Send it |
| **Stop** | Stop the current AI stream (local + server) |
| **Clear Output** | Clear the Progress / Final of the current run |
| **● Capturing / ○ Paused** | Enable or pause Network capture |
| **XHR/Fetch only** | Capture only API-type requests |
| **Debug events** | Show more SSE events in Progress |
| **Markdown** | Render rich text after Final completes |
| **Clear All** | Clear Test History |
| **Clear** | Clear the capture list of the current tab |

---

### Data and memory (no unbounded growth)

| Data | Limit | Location | When it is cleared |
|------|-------|----------|--------------------|
| Captured requests | 200 / tab | Background + Panel memory | Oldest dropped when exceeded; manual Clear |
| Tab capture slots | 20 tabs | Background memory | Non-current tabs dropped when exceeded |
| Test history | 50 entries | Panel memory | Oldest dropped when exceeded; Clear All |
| Progress | 512KB / run | Panel memory | Truncated when exceeded |
| Final (in progress) | No hard limit | Panel memory | — |
| Final (historical) | 100KB soft truncation | Panel memory | When you switch to another run |
| Config + token | Very small | chrome.storage | When you change the config manually |

- Closing **DevTools** → Panel memory is cleared  
- Closing the **browser** → the session token becomes invalid  
- Service Worker reclaimed → the Background capture queue is cleared  

---

### Performance

| Scenario | Impact |
|----------|--------|
| DevTools closed | **No impact** (Network is not listened to) |
| DevTools open + capture paused | **Almost no impact** |
| DevTools open + capturing + XHR only | Slight overhead only for matching requests |
| High-traffic SPA | Keep **XHR/Fetch only** on, and click **○ Paused** when you do not need capture |

Optimizations in place: in-memory filter cache, no body reads for static resources, incremental list insertion, debounced search, rAF-throttled streaming UI.

---

### FAQ

**After an extension update I get the error `chrome.runtime.connect` undefined?**  
After the extension reloads, the old DevTools panel context is invalidated. **Close DevTools → reload the extension → open F12 again.**

**Does an expired token refresh automatically?**  
**No automatic renewal** (there is no refresh token). The extension saves `expires_at` and shows the remaining time; it validates against the server every 30s, and immediately when you switch back to DevTools. After a server restart the session is cleared, and you are prompted to Validate again.

**The status still shows OK after I restarted the server?**  
Since v0.3.7 the extension probes `/api/auth/validate` every 30s. If the server is unreachable a yellow warning is shown; if the token is invalid it is cleared and the connection bar expands. After reloading the extension, close DevTools and open F12 again.

**Why did the Request once contain `:authority` and `:method`?**  
These are HTTP/2 pseudo-headers. The display and the AI prompt are now normalized to HTTP/1.1; the original HAR is still kept in the in-memory entry.

**Are the localhost CORS errors in the Console caused by the extension?**  
No. Those come from the page's own request to a local service being blocked by the browser, and have nothing to do with the extension.

**Validate shows `cross-origin request denied`?**  
Upgrade and restart the CyberStrikeAI server. Current server versions automatically recognize well-formed Chrome/Edge extension origins, so you do not need to copy the extension ID or configure a CORS allowlist. On the first Validate the extension still asks for browser permission to access the target server address.

**Validate asks me to allow access to the CyberStrikeAI server?**  
Allow access to the current server address in the permission dialog the browser shows. The extension requests only the server origin you entered and does not need all-site access. If no permission dialog appears, reload the extension at `chrome://extensions/`, close DevTools completely, reopen it, and click Validate.

**HTTPS shows "cannot connect", but Burp works?**  
The Burp plugin trusts self-signed certificates; a browser extension cannot bypass Chromium's TLS validation. First open the server address in the browser and trust the certificate; for production, use a trusted certificate whose SAN includes the server IP/domain.

**Can a long Test History cover Captured Requests?**  
No. The history area takes at most **42%** of the sidebar and scrolls within itself beyond that; the capture area takes the remaining space.

**Will it slow down web pages?**  
Everyday browsing (DevTools closed) is not affected. While debugging, use **○ Paused** to stop capture completely.

---

### Popup vs DevTools

| Location | Purpose |
|----------|---------|
| **DevTools panel** | Connection, Validate, capture, Send, Output (the main workspace) |
| **Extension popup** | Read-only connection status + version number + guide to opening DevTools |

The popup does not duplicate the full configuration form, so it cannot drift away from the main workflow.

---

### Packaging

```bash
bash plugins/browser-extension/cyberstrikeai-browser-extension/package.sh
# → dist/cyberstrikeai-browser-extension.zip
```

The icons are generated from the project root `images/logo.png`:

```bash
LOGO="images/logo.png"
ICONS="plugins/browser-extension/cyberstrikeai-browser-extension/icons"
for size in 16 48 128; do
  sips -z $size $size "$LOGO" --out "$ICONS/icon${size}.png"
done
```

---

### Limitations

- Chrome **does not provide** an API for the Network panel's right-click menu → use **Latest XHR** plus the extension's own list
- Firefox needs a temporary load through `about:debugging`; when `storage.session` is unavailable the token falls back to `local`
- The popup cannot jump straight to a specific DevTools panel (Chrome API limitation)

---

### Directory layout

```text
manifest.json                 # MV3 manifest
background/service-worker.js  # capture queue, Panel Port, global switch
devtools.js                   # Network listener (earliest filtering)
devtools.html
panel/
  panel.html / panel.js / panel.css   # main UI
popup/
  popup.html / popup.js / popup.css   # read-only status
lib/
  auth-session.js     # token expiry detection and remaining-time hint
  api.js              # login, SSE, project/role APIs
  storage.js          # config + session token + expires_at
  capture.js          # HAR summary, static filtering
  http-normalize.js   # HTTP/2 → HTTP/1.1 for display/Prompt
  formatter.js        # toPrompt assembly
  markdown.js         # Final Markdown rendering
  catalog-cache.js    # project/role 5-minute cache
  constants.js        # limit constants
icons/                # 16 / 48 / 128
package.sh
```

---

### Comparison with the Burp plugin

| Capability | Burp plugin | Browser extension |
|------------|-------------|-------------------|
| Traffic source | Proxy history | DevTools Network |
| Connection config | In the tab | In the tab (collapsible) |
| HTTP format | HTTP/1.1 | Display/Prompt normalized to HTTP/1.1 |
| Project/role/mode | Send dialog | Send dialog |
| SSE output | Progress + Final | Progress + Final |
| Capture toggle | — | ● Capturing / ○ Paused |

### RBAC username and password

Enter the web login username in Username (default `admin`; for a custom account, enter your own username) and that account's password in Password. Do not combine them as `username:password`. The username is saved locally; the password is not persisted. After you change the connection settings or the account credentials, the old token is cleared and you must Validate again.

If you see "Username is required and must not exceed 64 characters" and the panel only has Password, reload the updated extension at `chrome://extensions/`, then close DevTools completely and reopen it.

### Authentication regression tests

From the repository root, run `bash scripts/test-plugin-auth.sh` (Node.js and JDK 11+). This tests both clients against local HTTP fixtures, username validation, credential escaping, settings migration, and Burp account-switch invalidation. The script downloads the compile-only Burp API; set `BURP_API_JAR` to an existing JAR for offline use.
