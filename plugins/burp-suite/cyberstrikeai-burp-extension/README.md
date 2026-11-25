## CyberStrikeAI Burp Suite Extension

### Overview

- In Burp's `CyberStrikeAI` tab, configure **Host, Port, HTTPS, Username, Password**
- Click **Validate**:
  - Calls `POST /api/auth/login` to exchange the username and password for a token
  - Calls `GET /api/auth/validate` to verify the token
  - After a successful validation the token is kept in the extension's memory (valid for the current Burp session)
- Right-click any HTTP message → **Send to CyberStrikeAI (stream test)**:
  - A send dialog opens where, for the **current traffic**, you can choose:
    - **Project** (`GET /api/projects`; `projectId` is bound when a new conversation is created)
    - **Role** (`GET /api/roles`)
    - **Conversation** mode (**Pi Single** / Deep / Plan-Execute / Supervisor, chosen per send; the last value is remembered; maps to `/api/eino-agent/stream` or `/api/multi-agent/stream`)
    - **Test instruction** (an editable prompt prefix)
  - The selections remember their last values, which makes it easy to test similar traffic repeatedly
- **Test history sidebar (searchable)**: every send adds an entry, so you can revisit and compare runs
- **Output split**: `Progress` (collapsible) + `Final Response` (main area)
- **Markdown rendering**: the final output can be rendered as rich text in the main Output area (can be toggled)
- **Request / Response review**: the right-hand tabs show the original request/response captured for that run
- **Stop**: once a task has created a conversation, the extension can call `/api/agent-loop/cancel` (using the `conversationId`) to stop the current conversation's task

### Build (no Gradle required)

> For end users: distribute the **prebuilt jar**. Users just load it in Burp and **do not need to build anything**.

#### Option A (recommended, general): build with Maven (no need to locate Burp)

Suitable for: developers/CI building once and releasing to all users.

Requirements:

- JDK 11+
- Maven (downloads the `burp-extender-api` dependency from Maven Central)

Build and package:

```bash
cd plugins/burp-suite/cyberstrikeai-burp-extension
./build-mvn.sh
```

Output:

- `dist/cyberstrikeai-burp-extension.jar`

#### Option B (offline): plain JDK build (needs Burp's API jar)

- JDK 11+
- The Burp Extender API jar (from your Burp installation directory)

#### Steps

1) Create `lib/` in the extension directory and copy `burp-extender-api.jar` into it:

```bash
cd plugins/burp-suite/cyberstrikeai-burp-extension
mkdir -p lib
# Copy the API jar that ships with Burp here, for example:
# cp "/path/to/burp-extender-api.jar" lib/
```

2) Build and package in one step:

```bash
cd plugins/burp-suite/cyberstrikeai-burp-extension
./build.sh
```

Output:

- `dist/cyberstrikeai-burp-extension.jar`

#### Option C: Gradle (optional)

If you already have Gradle available, you can still use `build.gradle` to build.

### Load in Burp Suite

- Burp Suite → **Extensions** → **Installed** → **Add**
- Extension type: **Java**
- Select `dist/cyberstrikeai-burp-extension.jar`

### Usage

1) Open the `CyberStrikeAI` tab at the top of Burp
2) Fill in:
   - **Host**: for example `127.0.0.1`
   - **Port**: for example `8080`
   - **HTTPS**: checked by default (matches `tls_enabled` in `config.yaml`). The extension does not verify TLS certificates for any host (see the TLS limitation under Notes), so a self-signed certificate works without an import
   - **Username**: the web login username, default `admin`; for a custom account, enter your own username
   - **Password**: that account's web login password; do not combine it with the username
3) Click **Validate**
   - Success: the status shows `OK (token saved)`
   - Failure: the status shows the error reason (for example wrong password, server unreachable, 401/403)
4) In one of Burp's Proxy / HTTP history / Repeater lists, select an HTTP message
5) Right-click → **Send to CyberStrikeAI (stream test)**
6) In the dialog, choose the **project, role, and conversation mode** as needed, edit the test instruction, and click OK
7) After each send, a test history entry (request title + mode/role + status) appears on the left of the `CyberStrikeAI` tab; click an entry to see that run's streaming output on the right

After you change the connection settings or the account credentials, click **Validate** again. The password is kept only in the current UI and is not persisted.

### Notes

- Default connection is `https://127.0.0.1:8080` (**HTTPS** checked).
- **TLS limitation: certificates are not verified.** `SslTrustAll.java` accepts every certificate chain and turns off hostname verification for every HTTPS host you enter, not only for local or self-signed ones. The username and password you type are sent over that connection (`POST /api/auth/login`), and so is the Bearer token on every later request. Anyone who can intercept the network path can impersonate the server and read them. Use the extension only against a server on `localhost` or on a network you trust.
- Uncheck **HTTPS** only if your server runs plain HTTP.
- It uses **Bearer Token** authentication obtained from the configured password.

### Troubleshooting

- **"Username is required and must not exceed 64 characters", but the UI only has Password**
  - An old extension that predates RBAC login. Rebuild and load a JAR that includes the Username field; editing the source does not update a JAR that is already loaded.


- **Validate fails / 401**
  - Confirm the username and password match the web login
  - Confirm the IP/port is reachable (for example, the browser can open `https://IP:PORT/`)
  - Check **HTTPS** when the server has TLS enabled (checked by default); a certificate import is not needed because certificates are not verified (see the TLS limitation under Notes)
  - If the deployment is still plain HTTP, uncheck **HTTPS**

- **After choosing Deep, Plan-Execute, or Supervisor, the server says "Multi-agent is not enabled"**
  - The server must enable it: `multi_agent.enabled: true` in `config.yaml`
  - Then restart the service (or enable it through your project's dynamic config-apply flow)

- **No streaming output after right-click send**
  - First confirm you have run Validate (obtained a token)
  - Confirm Burp can reach CyberStrikeAI (network / proxy / firewall)
  - The server's streaming endpoint is SSE and the extension parses `data: {json}` lines; middleware that buffers responses can hurt real-time output

### Authentication regression tests

From the repository root, run `bash scripts/test-plugin-auth.sh` (Node.js and JDK 11+). This tests both clients against local HTTP fixtures, username validation, credential escaping, settings migration, and Burp account-switch invalidation. The script downloads the compile-only Burp API; set `BURP_API_JAR` to an existing JAR for offline use.
