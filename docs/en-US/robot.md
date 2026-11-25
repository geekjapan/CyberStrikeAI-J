# CyberStrikeAI Robot / Chatbot Guide

[日本語](../ja-JP/robot.md)

This guide covers **Personal WeChat, WeCom, DingTalk, Lark, Telegram, Slack, Discord, and QQ Bot**, including platform connectivity, RBAC identity binding, service-account allowlists, commands, verification, and troubleshooting.

---

## 1. Where to configure in CyberStrikeAI

The current web UI has no bot settings screen. Configure bots by editing the `robots` section of `config.yaml` and restarting CyberStrikeAI, or by calling `PUT /api/config`.

**Editing `config.yaml`**

- The file is read once at startup and is not watched, so restart the CyberStrikeAI process after every edit.
- A platform connects only when `enabled: true` and its credentials are non-empty. An enabled platform with empty credentials is silently skipped.
- `robots.<platform>.auth` is validated at startup: an unknown `mode`, a `service_account` without `service_user_id` or without senders in `allowed_external_users`, and duplicate or `*` entries all stop the server from starting.
- `config.example.yaml` has a commented `robots:` template.

**Calling `PUT /api/config`**

- `GET /api/config` returns the current `robots` block **including secrets** and needs `config:read`. `PUT /api/config` and `POST /api/config/apply` need `config:write`.
- `PUT /api/config` with a `robots` object validates it (WeCom token when enabled; `auth` rules; the service user must exist and be enabled), **replaces the whole `robots` object** in memory, and writes `config.yaml`. Send the full block, not just the platform you changed.
- `PUT` alone does **not** restart bot connections. `POST /api/config/apply` does (it restarts every long-lived bot connection and also reloads other settings such as tools).
- `PUT` does **not** write `auth` (`mode`, `service_user_id`, `allowed_external_users`) to `config.yaml`. Such a change lives only in the running process and is lost on restart. Edit `auth` in the YAML file.
- Every save (`PUT`, or a successful WeChat QR binding) rewrites the `robots` keys in `config.yaml` from the running process. If you edited the YAML by hand, restart before you call any of these APIs, or your edits are overwritten.

```bash
# Log in (see api-recipes.md, Recipe 1) and keep the token
curl -k https://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}'

# Example: turn on Telegram. Fetch robots, change two keys, send the full block back, apply.
curl -sk https://127.0.0.1:8080/api/config -H "Authorization: Bearer <token>" \
  | jq '{robots: (.robots | .telegram.enabled=true | .telegram.bot_token="<bot-token>")}' > robots.json
curl -k -X PUT https://127.0.0.1:8080/api/config \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d @robots.json
curl -k -X POST https://127.0.0.1:8080/api/config/apply -H "Authorization: Bearer <token>"
rm robots.json   # it contains secrets
```

The login response contains `token`. The commands below use the same `https://127.0.0.1:8080` base URL and `Authorization: Bearer <token>` header; adjust them for your deployment. "Restart" in the platform sections below means restarting the process, or `POST /api/config/apply` if you changed the settings through `PUT /api/config`.

### Shortest path to first use

After the platform connection works, configure the business identity before sending normal prompts.

**Only you (default path)**

1. Send `whoami` to the bot and copy the `Sender ID` line exactly. The ID format depends on the platform (Personal WeChat: `xxxx@im.wechat`; DingTalk, Lark, Slack: `t:<tenant>|u:<user>`; Telegram, Discord, QQ direct chat: `u:<id>`).
2. In `config.yaml`, set that platform's `auth` block:

   ```yaml
   robots:
     wechat:   # or dingtalk, lark, wecom, telegram, slack, discord, qq
       auth:
         mode: service_account
         service_user_id: admin          # RBAC user ID, not a display name
         allowed_external_users:
           - "<Sender ID copied from whoami>"
   ```

3. Restart CyberStrikeAI, then send `whoami` again.

**Multiple users**: leave `auth` out (the default is `user_binding`). Each user gets a binding code, sends the `bind` command to the bot, and runs `whoami`. Without a screen, the code comes from `POST /api/auth/robot-binding-code`; see [Section 4.2](#42-user-binding-mode-default).

Start normal AI chat only after the response shows `Auth status: authorized` and the expected effective identity.

---

## 2. Supported platforms (long-lived / callback)

| Platform       | Description |
|----------------|-------------|
| Personal WeChat| WeChat iLink protocol; request a QR code through the API and scan it to bind, then long-poll for messages—**no public callback URL needed** |
| DingTalk       | Stream long-lived connection; the app connects to DingTalk to receive messages |
| Lark (Feishu)  | Long-lived connection; the app connects to Lark to receive messages |
| WeCom (Qiye WX)| HTTP callback to receive messages; CyberStrikeAI replies via WeCom’s message sending API |
| Telegram       | Bot API long polling (`getUpdates`); **no public callback URL needed** |
| Slack          | Socket Mode (outbound WebSocket); **no public callback URL needed** |
| Discord        | Gateway WebSocket; **no public callback URL needed** |
| QQ Bot         | QQ Open Platform WebSocket (C2C / group @); **no public callback URL needed** |

Section 3 below describes, per platform, what to do in the developer console and which `config.yaml` keys to fill in.

---

## 3. Configuration and step-by-step setup

### 3.1 DingTalk

**Important: two types of DingTalk bots**

| Type | Where it’s created | Can do “user sends message → bot replies”? | Supported here? |
|------|-------------------|-------------------------------------------|------------------|
| **Custom bot (Webhook)** | In a DingTalk group: Group settings → Add robot → Custom (Webhook) | No; you can only post to the group | No |
| **Enterprise internal app bot** | [DingTalk Open Platform](https://open.dingtalk.com): create an app and enable the bot | Yes | Yes |

If you only have a **custom bot** Webhook URL (`oapi.dingtalk.com/robot/send?access_token=...`) and sign secret (`SEC...`), **do not** put them into CyberStrikeAI. You must create an **enterprise internal app** in the open platform and obtain **Client ID** and **Client Secret** as below.

---

**DingTalk setup (in order)**

1. **Open DingTalk Open Platform**  
   Go to [https://open.dingtalk.com](https://open.dingtalk.com) and log in with an **enterprise admin** account.

2. **Create or select an app**  
   In the left menu: **Application development** → **Enterprise internal development** → **Create application** (or choose an existing app). Fill in the app name and create.

3. **Get Client ID and Client Secret**  
   - In the left menu open **Credentials and basic info** (under “Basic information”).  
   - Copy **Client ID (formerly AppKey)** and **Client Secret (formerly AppSecret)**.  
   - Use copy/paste; avoid typing by hand. Watch for **0** vs **o** and **1** vs **l** (e.g. `ding9gf9tiozuc504aer` has the digits **504**, not 5o4).

4. **Enable the bot and choose Stream mode**  
   - Left menu: **Application capabilities** → **Robot**.  
   - Turn on “Robot configuration”.  
   - Fill in robot name, description, etc. as required.  
   - **Critical**: set message reception to **“Stream mode”**. If you only enable “HTTP callback” or do not select Stream, CyberStrikeAI will not receive messages.
   - Save.

5. **Permissions and release**  
   - Left menu: **Permission management** — search for “robot”, “message”, etc., and enable **receive message**, **send message**, and other bot-related permissions; confirm.  
   - Left menu: **Version management and release** — if there are unpublished changes, click **Release new version** / **Publish**; otherwise changes do not take effect.

6. **Fill in CyberStrikeAI**  
   - In `config.yaml`, set `robots.dingtalk` (see below): enable it and paste the Client ID and Client Secret from step 3.  
   - Restart CyberStrikeAI (Section 1).

```yaml
robots:
  dingtalk:
    enabled: true
    client_id: "<Client ID>"
    client_secret: "<Client Secret>"
```

---

**Field mapping (DingTalk)**

| Key in `config.yaml` | Source in DingTalk Open Platform |
|----------------------|----------------------------------|
| `robots.dingtalk.enabled` | `true` to enable |
| `robots.dingtalk.client_id` | Credentials and basic info → **Client ID (formerly AppKey)** |
| `robots.dingtalk.client_secret` | Credentials and basic info → **Client Secret (formerly AppSecret)** |

---

### 3.2 Lark (Feishu)

| Key in `config.yaml` | Description |
|----------------------|-------------|
| `robots.lark.enabled` | `true` starts the Lark long-lived connection |
| `robots.lark.app_id` | From Lark open platform app credentials |
| `robots.lark.app_secret` | From Lark open platform app credentials |
| `robots.lark.verify_token` | Optional; for event subscription |

```yaml
robots:
  lark:
    enabled: true
    app_id: "<App ID>"
    app_secret: "<App Secret>"
    verify_token: ""   # optional
```

**Lark setup in short**: Log in to [Lark Open Platform](https://open.feishu.cn) → Create an enterprise app → In “Credentials and basic info” get **App ID** and **App Secret** → In “Application capabilities” enable **Robot** and the right permissions → Add **event subscription** and **permissions** below → Publish the app → Put App ID and App Secret into `robots.lark` in `config.yaml` → restart CyberStrikeAI.

**Event subscription**  
The long-lived connection only receives message events if you subscribe to them. In the app’s **Events and callbacks** → **Event subscription**, add the event **Receive message** (**im.message.receive_v1**). Without it, the connection succeeds but no message events are delivered (no logs when users send messages).

**Lark permissions (required)**  
In **Permission management**, enable the following (identifiers match the Lark console). After changes, **publish a new version** in Version management and release so they take effect.

| Permission name (as shown in console) | Identifier | Notes |
|--------------------------------------|------------|-------|
| Get and send direct & group messages | `im:message` | Base permission for sending and receiving; **required**. |
| Receive @bot messages in group chat | `im:message.group_at_msg:readonly` | Required for group chat when users @ the bot. |
| Read direct messages from users to bot | `im:message.p2p_msg:readonly` | **Required** for 1:1 chat; otherwise no response in private chat. |
| Get direct & group messages | `im:message:readonly` | **Required** to read message content. |

**Event subscription** (configured separately): In **Event subscription**, add **Receive message** (**im.message.receive_v1**). Without it, the long-lived connection will not receive message events.

- **1:1 chat**: Open the bot’s private chat in Lark and send e.g. “help”; no @ needed.
- **Group chat**: Only messages that **@ the bot** are received and replied to.

---

### 3.3 WeCom (Enterprise WeChat)

> WeCom uses a **“HTTP callback + active message send API”** model:  
> - User sends a message → WeCom sends an **encrypted XML callback** to your server (CyberStrikeAI’s `/api/robot/wecom`).  
> - CyberStrikeAI decrypts it, calls the AI, then uses WeCom’s `message/send` API to **actively push the reply** to the user.

**Configuration overview:**

- In the WeCom admin console, create or select a **custom app**.
- In that app’s settings, configure the message **callback URL**, **Token**, and **EncodingAESKey**.
- In CyberStrikeAI’s `config.yaml`, set `robots.wecom.enabled: true` (a `token` is required when enabled) and fill in:
  - `robots.wecom.corp_id`: your CorpID
  - `robots.wecom.agent_id`: the app’s AgentId
  - `robots.wecom.token`: the Token used for message callbacks
  - `robots.wecom.encoding_aes_key`: the EncodingAESKey used for callbacks
  - `robots.wecom.secret`: the app’s Secret (used when calling WeCom APIs to send messages)
- Restart CyberStrikeAI (Section 1).

```yaml
robots:
  wecom:
    enabled: true
    corp_id: "<CorpID>"
    agent_id: 1000002
    token: "<Token>"
    encoding_aes_key: "<EncodingAESKey>"
    secret: "<App Secret>"
```

> **Important: IP allowlist (errcode 60020)**  
> CyberStrikeAI calls `https://qyapi.weixin.qq.com/cgi-bin/message/send` to actively send AI replies.  
> If logs show `errcode 60020 not allow to access from your ip`:
>
> - Your server’s outbound IP is **not in WeCom’s IP allowlist**.  
> - In the WeCom admin console, open the custom app’s **Security / IP allowlist** settings (name may vary slightly), and add the public IP of the machine running CyberStrikeAI (e.g. `110.xxx.xxx.xxx`).  
> - Save and wait for it to take effect, then test again.
>
> If the IP is not whitelisted, WeCom will reject active message sending. You will see that `/api/robot/wecom` receives and processes callbacks, but users **never see AI replies**, and logs contain `not allow to access from your ip`.

---

### 3.4 Personal WeChat (WeChat / iLink)

> Personal WeChat uses **“QR binding + iLink long polling”**:  
> - Request a QR code from the CyberStrikeAI API → scan and confirm with **WeChat on your phone**;  
> - On success, `robots.wechat` in `config.yaml` is updated automatically and iLink long polling starts (the app connects outbound to `ilinkai.weixin.qq.com`);  
> - **No** public callback URL on your server and **no** WeChat Open Platform app registration required.

**Personal WeChat vs WeCom**

| Item | Personal WeChat (iLink) | WeCom (Enterprise WeChat) |
|------|-------------------------|---------------------------|
| Use case | Private chat in personal WeChat | Custom app in WeCom |
| Setup | QR scan (QR code requested through the API) | Admin console callback URL + Token |
| Public IP needed? | No (outbound long poll only) | Yes (HTTPS callback reachable by WeCom) |
| Config key | `robots.wechat` | `robots.wecom` |

**Binding steps (in order)**

No step needs the web UI. The only thing that needs a screen is showing the QR image so your phone can scan it. The calls need `robot:write` with global scope (status: `robot:read`), and the QR session lives only in the server's memory for about 5 minutes (do not restart CyberStrikeAI in between).

1. **Request a QR code**

   ```bash
   curl -sk -X POST https://127.0.0.1:8080/api/robot/wechat/qrcode \
     -H "Authorization: Bearer <token>" > qr.json
   ```

   An optional body `{"bot_type":"3"}` overrides the bot type; by default `robots.wechat.bot_type` or `3` is used. The response contains:

   | Field | Meaning |
   |-------|---------|
   | `session_key` | Identifies this binding attempt in the next calls |
   | `qrcode` | iLink's QR token |
   | `qrcode_open_url` | The content to encode in a QR code (a link, **not** an image URL) |
   | `qrcode_image_data_url` | The same content as a ready-made PNG data URL (omitted if the server could not render it) |
   | `message` | Human-readable hint |

   If the server cannot reach `https://ilinkai.weixin.qq.com`, the call returns `502`.

2. **Turn it into a scannable QR code and scan it**

   ```bash
   jq -r .qrcode_image_data_url qr.json | sed 's#^data:image/png;base64,##' | base64 -d > wechat-qr.png
   ```

   Open `wechat-qr.png` in any image viewer and scan it with WeChat on your phone (use `base64 -D` on older macOS; on a headless server copy the file to your workstation). Alternatively, encode `qrcode_open_url` with any QR tool, for example `qrencode -t ANSIUTF8 "<qrcode_open_url>"` if installed. Delete `qr.json` and `wechat-qr.png` afterwards.

3. **Poll the status until it is `confirmed`**

   ```bash
   curl -sk "https://127.0.0.1:8080/api/robot/wechat/qrcode/status?session_key=<session_key>" \
     -H "Authorization: Bearer <token>"
   ```

   Each call waits up to about 35 seconds for a change, then returns `{"status":"..."}`. Call it again until it changes:

   | `status` | Meaning / what to do |
   |----------|----------------------|
   | `wait` | Not scanned yet (also returned when the wait times out); poll again |
   | `scaned` | Scanned; confirm on the phone, keep polling |
   | `scaned_but_redirect` | iLink asked for a different host; the server follows it itself, keep polling |
   | `need_verifycode` | WeChat shows a **pairing code** (only some accounts); do step 4 |
   | `binded_redirect` | The account is already bound (`already_connected: true`); nothing is written and the session ends |
   | `confirmed` | Done; see step 5 |

   Errors: `400` missing `session_key`; `404` unknown or expired session; `410` the QR code is older than 5 minutes (start again at step 1); `502` iLink error.

4. **Submit the pairing code (only if requested)**

   ```bash
   curl -sk -X POST https://127.0.0.1:8080/api/robot/wechat/qrcode/verify \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"session_key":"<session_key>","verify_code":"<digits shown in WeChat>"}'
   ```

   Then keep polling step 3; the server reuses the submitted code (you can also append `&verify_code=<digits>` to the status call).

5. **Binding completes**  
   The `confirmed` response contains `message`, `ilink_bot_id` and `ilink_user_id`. The server then sets `robots.wechat` to `enabled: true` plus `bot_token`, `ilink_bot_id`, `ilink_user_id`, `base_url`, and (if empty) `bot_type` and `bot_agent`, writes `config.yaml`, and restarts the bot connections—**no manual restart needed**. It does not touch `auth`. Check with `GET /api/robot/wechat/status` (`enabled`, `bound`, `ilink_bot_id`, `ilink_user_id`, `base_url`).

6. **Test in WeChat**  
   Open the **private chat** with the CyberStrikeAI bot in WeChat and send `whoami` or `help`.

**Keys under `robots.wechat`**

| Key | Description |
|-----|-------------|
| `enabled` | Starts iLink long polling; set to `true` automatically after bind (needs a non-empty `bot_token`) |
| `bot_token`, `ilink_bot_id`, `ilink_user_id` | Filled in by the bind; do not edit by hand |
| `base_url` | Default `https://ilinkai.weixin.qq.com` |
| `bot_type` | Default `3` |
| `bot_agent` | Default `CyberStrikeAI/1.0` |

**How to use**

- **Private chat only**—send text directly; **no @ needed**.  
- Group @-bot is **not** supported (unlike DingTalk/Lark groups).  
- **Text messages only**; images, voice, etc. are ignored or not supported.

**Re-bind**

- To bind a different WeChat account, run steps 1–5 again. The current `bot_token` is sent along with the QR request, and a successful bind overwrites the stored token and IDs.  
- If the status is `binded_redirect` (“This WeChat account is already bound”), that account was bound before and nothing is changed.

**Common issues**

| Symptom | What to do |
|---------|------------|
| QR code expired (`410` or `404`) | Request a new one (~5 min TTL) |
| Status is `need_verifycode` | Submit the digits shown in WeChat (step 4) |
| Bound but no replies | Check logs for `WeChat iLink long polling started` and `WeChat message received`; ensure `robots.wechat.enabled` is `true` |
| No reply after sleep / network drop | Auto-reconnect in ~5–60 s; restart CyberStrikeAI if still stuck |
| Cannot get a QR code (`502`) | Ensure outbound HTTPS to `https://ilinkai.weixin.qq.com` |

---

### 3.5 Telegram

> Telegram uses **Bot API long polling** (`getUpdates`): the app connects outbound to `api.telegram.org`—**no public callback URL needed**.

1. Create a bot via **@BotFather** (`/newbot`) and copy the **Bot Token**.  
2. In `config.yaml`, set `robots.telegram`: enable it and paste the token. `bot_username` is optional (without `@`; if empty, the app calls `getMe` at startup). `allow_group_messages: true` optionally allows groups, where the bot answers only when @-mentioned. Then restart CyberStrikeAI.

```yaml
robots:
  telegram:
    enabled: true
    bot_token: "<Bot Token>"
    bot_username: ""
    allow_group_messages: false
```

---

### 3.6 Slack

> Slack uses **Socket Mode** (outbound WebSocket): requires **Bot Token (xoxb-)** and **App-Level Token (xapp-)** with `connections:write`.

1. Create an app at [api.slack.com](https://api.slack.com/apps) → enable **Socket Mode**.  
2. Create an App-Level Token; install the app to get a Bot Token.  
3. Subscribe to `message.im` and `app_mention` events.  
4. Put both tokens into `robots.slack` in `config.yaml` and restart CyberStrikeAI.

```yaml
robots:
  slack:
    enabled: true
    bot_token: "<xoxb- Bot Token>"
    app_token: "<xapp- App-Level Token>"
```

---

### 3.7 Discord

> Discord uses **Gateway WebSocket**—**no public callback URL needed**.

1. [Discord Developer Portal](https://discord.com/developers/applications) → create app → **Bot** → copy **Token**.  
2. Enable **Message Content Intent** under Privileged Gateway Intents.  
3. Invite the bot with `Send Messages` permission.  
4. Put the token into `robots.discord` in `config.yaml` and restart CyberStrikeAI. `allow_guild_messages: true` optionally allows server channels, where the bot answers only when @-mentioned.

```yaml
robots:
  discord:
    enabled: true
    bot_token: "<Bot Token>"
    allow_guild_messages: false
```

---

### 3.8 QQ Bot

> QQ Bot uses **QQ Open Platform WebSocket** (official `botgo` SDK) for C2C and group @—**no public callback URL needed**.

1. Create a bot at [q.qq.com](https://q.qq.com) → get **App ID** and **Client Secret**.  
2. Add sandbox testers before going live.  
3. Subscribe to C2C and group @ events (WebSocket).  
4. Fill in `robots.qq` in `config.yaml`; keep `sandbox: true` for testing, then restart CyberStrikeAI.

```yaml
robots:
  qq:
    enabled: true
    app_id: "<App ID>"
    client_secret: "<Client Secret>"
    sandbox: true
```

---

## 4. RBAC authorization and bot commands

Platform credentials and callback signatures authenticate the messaging platform. CyberStrikeAI RBAC determines what the sender can actually do. Each bot instance uses one authorization mode.

### 4.1 Choose an authorization mode

| Scenario | Recommended mode | Identity and data behavior |
|----------|------------------|----------------------------|
| Shared WeCom, Lark, DingTalk, or Slack bot | `user_binding` | Each sender binds their own Web user; permissions and resources remain isolated |
| Personal WeChat, single-user bot, fixed automation entry | `service_account` | Allowlisted senders share the configured RBAC user's permissions and owned resources |

Both modes resolve user status, roles, per-permission scope, and resource assignments before every message. Basic AI chat requires:

```text
agent:execute
chat:read
chat:write
```

Grant project, role, local execution, WebShell, C2, or MCP permissions only when those features are required. Conversation deletion also requires `chat:delete`.

### 4.2 User-binding mode (default)

Administrator: nothing to configure. Omitting `auth`, or setting `mode: user_binding`, selects this mode.

Each user:

1. Log in as themselves (Section 1) and request a binding code. The call needs only the `auth:self` permission, and the code belongs to the user who is logged in:

   ```bash
   curl -k -X POST https://127.0.0.1:8080/api/auth/robot-binding-code \
     -H "Authorization: Bearer <token>"
   ```

   ```json
   {"code":"7C6E-BD4C","expires_at":"<RFC 3339 UTC time>","expires_in_seconds":300}
   ```

2. Within five minutes, send the full command to the target bot, for example `bind 7C6E-BD4C`.
3. Send `whoami` and confirm the effective RBAC identity is their own user.

Codes are stored only as hashes and are single-use. The server rejects an expired or used code; generating a new code immediately invalidates the previous unused code. Users can send `unbind` (then `confirm`), or list and revoke bindings through the API: `GET /api/auth/robot-bindings` returns `{"bindings":[{"id","platform","external_user_hint","enabled","created_at","updated_at"}]}` and `DELETE /api/auth/robot-bindings/<id>` removes one. Both need `auth:self`.

### 4.3 Service-account mode

1. Connect the bot to its messaging platform.
2. Have each intended sender run `whoami` and copy the exact `Sender ID`. For Personal WeChat it usually resembles `xxxx@im.wechat`; never substitute `ilink_bot_id` or configured `ilink_user_id`.
3. In `config.yaml`, set `auth.mode: service_account` under that platform.
4. Set `service_user_id` to the RBAC **user ID**, not its display name. `admin` is allowed; every allowlisted sender then receives full platform permissions.
5. Add one exact sender ID per item in `allowed_external_users`. Matching is case-sensitive; `*` wildcards, empty items, and duplicates are rejected.
6. Restart CyberStrikeAI and run `whoami` again to verify the effective user, roles, and scope. If the service user does not exist or is disabled, startup does not complain, but every sender is denied (`PUT /api/config` rejects such a configuration).

Example:

```yaml
robots:
  wechat:
    auth:
      mode: service_account
      service_user_id: admin
      allowed_external_users:
        - "o9cq806s32Sm2_kyOmkyaV7Rn1lU@im.wechat"
```

Service-account mode rejects `bind` and `unbind`. All allowlisted senders share conversations, projects, and other resources owned by the service account. Use `user_binding` when that sharing is undesirable.

### 4.4 Inspect the effective identity

Send `whoami`. The response includes platform, exact sender ID, authorization mode and status, effective RBAC user and ID, roles, scope, and permission count. A non-allowlisted sender sees only the denial status and no service-account details.

### 4.5 Command list

Send these **text commands** to the bot on any connected platform (text only):

| Command | Description |
|---------|-------------|
| `help` (or `?`) | Show command help; the list adapts to the sender's permissions |
| `version` | Show the current CyberStrikeAI version |
| `whoami` | Show sender ID, authorization mode, binding status, and the effective RBAC user, roles, and scope |
| `bind <code>` | Bind the verified platform sender to the RBAC user that generated the code (`user_binding` mode only) |
| `unbind` | Request removal of the current platform identity binding; send `confirm` within 2 minutes to complete it (`user_binding` mode only) |
| `list` | List conversation titles and IDs (the first 20) |
| `switch <ID>` or `continue <ID>` | Continue in the given conversation |
| `new` | Start a new conversation |
| `clear` | Clear the current context (same effect as `new`) |
| `status` | Show the current conversation, mode, role, and project |
| `task` | Show the status and elapsed time of the current task |
| `rename <name>` | Rename the current conversation |
| `delete <ID>` | Delete the given conversation; send `confirm` within 2 minutes to complete it |
| `stop` | Abort the currently running task |
| `roles` | List the enabled roles (for example `Default`, `Penetration Testing`, `Information Gathering`) |
| `role <name>` | Switch to the named role, for example `role Penetration Testing` |
| `modes` | List the conversation modes and the current selection |
| `mode <name>` | Switch the conversation mode (`single`, `deep`, `plan_execute`, `supervisor`); modes other than `single` require multi-agent to be enabled |
| `permissions` | Show the current business permissions |
| `doctor` | Check the status of key bot-related configuration (requires `config:read`) |
| `confirm` / `cancel` | Confirm or cancel a pending high-risk operation (`unbind`, `delete`) |
| `projects` | List projects (only when the project feature is enabled) |
| `new project <name>` | Create a project and bind it to the current conversation |
| `bind project <ID\|name>` | Bind the current conversation to an existing project |
| `unbind project` | Remove the project binding from the current conversation |
| `vuln alerts` | Show the vulnerability alert subscription; `vuln alerts on`, `vuln alerts off`, and `vuln alerts critical\|high\|medium` change it |

Commands other than `help`, `version`, `whoami`, `permissions`, `confirm`, `cancel`, `bind`, and `unbind` require an RBAC permission, for example `chat:read` for `list`, `switch`, `status`, and `task`, `chat:write` for `new`, `clear`, and `rename`, `chat:delete` for `delete`, `agent:execute` for `stop`, `modes`, and `mode`, `roles:read` for `roles` and `role`, `project:read` / `project:write` for the project commands, and `vulnerability:read` for `vuln alerts`. A missing permission is reported in the reply.

The Chinese command words used by earlier versions still work as aliases for these commands.

Any other text is sent to the AI as a user message, same as in the web UI (e.g. penetration testing, security analysis).

Group messages are authorized as the actual sender, never as a group ID. In service-account mode, explicitly allowlisted senders intentionally share the configured account.

---

## 5. How to use (do I need to @ the bot?)

- **Personal WeChat**: Send directly in the **private chat** with the bot; **no @ needed** (group chat not supported).  
- **DingTalk / Lark direct chat (recommended)**: **Search for the bot and open a direct chat**. Type “help” or any message; **no @ needed**.
- **DingTalk / Lark group chat**: If the bot is in a group, only messages that **@ the bot** are received and answered; other group messages are ignored.

Summary: **Personal WeChat and direct chat**—just send; **DingTalk/Lark in a group**—@ the bot first, then send.

---

## 6. Recommended flow (so you don’t skip steps)

**Personal WeChat (simplest—no open platform)**

1. Request a QR code with `POST /api/robot/wechat/qrcode`, save the PNG, and scan it with WeChat; submit the pairing code if asked (Section 3.4).  
2. Send `whoami` in the WeChat private chat and copy the sender ID.
3. Leave `auth` out for `user_binding`, or set `service_account` with the RBAC user and exact sender allowlist in `config.yaml`.
4. Restart CyberStrikeAI, run `whoami` again, then send a normal message.

**DingTalk / Lark**

1. **In the open platform**: Complete app creation, copy credentials, enable the bot (DingTalk: **Stream mode**), set permissions, and publish (Section 3).  
2. **In CyberStrikeAI**: Set `enabled: true` and the Client ID/App ID and Client Secret/App Secret under `robots.dingtalk` or `robots.lark` in `config.yaml`.  
3. **Choose authorization**: leave `auth` out for multiple users (`user_binding`), or configure a service account and exact allowlist for a dedicated bot.
4. **Restart** CyberStrikeAI.
5. **On your phone**: Open the bot, run `whoami` first, then send a normal message.

If the bot does not respond, see **Section 9 (troubleshooting)** and **Section 10 (common pitfalls)**.

---

## 7. Config file example

Example `robots` section in `config.yaml`:

```yaml
robots:
  wechat: # Personal WeChat iLink (token and IDs are filled in by the QR bind; do not edit by hand)
    enabled: true
    auth:
      mode: service_account
      service_user_id: admin
      allowed_external_users:
        - "exact sender ID copied from whoami"
    bot_token: "your_bot_token@im.bot:..."
    ilink_bot_id: "your_bot_id@im.bot"
    ilink_user_id: "your_user_id@im.wechat"
    base_url: "https://ilinkai.weixin.qq.com"
    bot_type: "3"
    bot_agent: "CyberStrikeAI/1.0"
  dingtalk:
    enabled: true
    auth:
      mode: user_binding
    client_id: "your_dingtalk_app_key"
    client_secret: "your_dingtalk_app_secret"
  lark:
    enabled: true
    auth:
      mode: user_binding
    app_id: "your_lark_app_id"
    app_secret: "your_lark_app_secret"
    verify_token: ""
  wecom:
    enabled: false
    corp_id: ""
    agent_id: 0
    token: ""
    encoding_aes_key: ""
    secret: ""
  telegram:
    enabled: false
    bot_token: ""
    allow_group_messages: false
  slack:
    enabled: false
    bot_token: ""
    app_token: ""
  discord:
    enabled: false
    bot_token: ""
    allow_guild_messages: false
  qq:
    enabled: false
    app_id: ""
    client_secret: ""
    sandbox: true
```

Authorization is configured independently per platform; omitting `auth` defaults to `user_binding`. Restart the process after editing the YAML (Section 1). Personal WeChat QR binding saves and restarts the connections automatically.

---

## 8. Testing without DingTalk/Lark installed

You can verify bot logic with the **test API** (no DingTalk/Lark client needed):

1. Sign in (Section 1) with an account that has `robot:write` permission with global scope, and get a token.
2. Call the test endpoint with curl:

```bash
curl -k -X POST https://127.0.0.1:8080/api/robot/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"platform":"dingtalk","user_id":"test_user","text":"help"}'
```

If the JSON response contains `"reply":"[CyberStrikeAI bot commands]..."`, command handling works. `help`, `version`, and `whoami` work before binding. `list`, `status`, and normal AI messages enforce RBAC: the test `platform + user_id` must already be bound or exactly match the service-account allowlist.

API: `POST /api/robot/test` (requires `robot:write` with global scope). Body: `{"platform":"optional","user_id":"optional","text":"required"}`; `platform` defaults to `test` and `user_id` to `test_user`, and a body that is not JSON returns `400`. Response: `{"reply":"..."}`. It runs the same message handling as a real bot message, including the platform's `auth` settings (use the real platform name, such as `wechat`, to test its allowlist; the default `test` platform always uses `user_binding`) and real AI runs for normal text. It does not validate a third-party callback signature or long-lived connection.

---

## 9. Troubleshooting: no response when sending messages

### 9.1 Personal WeChat

Check in this order:

1. **Binding completed?**  
   `GET /api/robot/wechat/status` should return `"bound": true` with an `ilink_bot_id`; `robots.wechat.bot_token` in `config.yaml` must not be empty.

2. **Enabled?**  
   Confirm `robots.wechat.enabled: true` in `config.yaml` (and restart if you edited it by hand).

3. **Application logs**  
   - On startup: `WeChat iLink long polling started`;  
   - After sending a message: `WeChat message received`; if missing, binding may have failed or `bot_token` is invalid—bind again (Section 3.4).  
   - `WeChat iLink long polling error, will reconnect automatically`: wait for auto-reconnect or restart.

4. **Network**  
   The server must reach `https://ilinkai.weixin.qq.com` (outbound HTTPS). If the QR request fails with `502`, check this first.

5. **After sleep or network drop**  
   Same as DingTalk/Lark: **auto-reconnect** in ~5–60 s; restart if still no response.

### 9.2 DingTalk

Check in this order:

0. **After laptop sleep or network drop**  
   DingTalk and Lark both use long-lived connections; they break when the machine sleeps or the network drops. The app **auto-reconnects** (retries within about 5–60 seconds). After wake or network recovery, wait a moment before sending; if there is still no response, restart the CyberStrikeAI process.

1. **Client ID / Client Secret match the open platform exactly**  
   Copy from “Credentials and basic info”; avoid typing. Watch **0** vs **o** and **1** vs **l** (e.g. `ding9gf9tiozuc504aer` has **504**, not 5o4).

2. **Did you restart after the change?**  
   After editing `config.yaml`, restart the process. After `PUT /api/config`, call `POST /api/config/apply`; `PUT` alone does not restart connections.

3. **Application logs**  
   - On startup you should see `DingTalk Stream connecting...`.  
   - If `DingTalk Stream long connection dropped (e.g. sleep/network loss), will reconnect automatically` appears with an error right after startup and keeps repeating, it’s usually wrong **Client ID / Client Secret** or **Stream not enabled** in the open platform. After sleep or a network drop the same line is expected, and the app reconnects by itself.  
   - After sending a message in DingTalk, you should see `DingTalk message received` in the logs; if not, the platform is not pushing to this app (check that the bot is enabled and **Stream mode** is selected).

4. **Open platform**  
   The app must be **published**. Under “Robot” you must enable **Stream** for receiving messages (HTTP callback only is not enough). Permission management must include robot receive/send message permissions.

### 9.3 Reply says unbound, sender denied, or permission missing

1. Run `whoami` and inspect the authorization mode and status.
2. In `user_binding`, request a code with `POST /api/auth/robot-binding-code` (Section 4.2) and send the complete bind command from the same platform identity. Regenerate expired or already-used codes.
3. In `service_account`, copy the exact sender ID from `whoami` into that platform's allowlist. Preserve case, tenant prefixes, and suffixes such as `@im.wechat`.
4. If an effective user is shown but permissions are missing, grant at least `agent:execute`, `chat:read`, and `chat:write` for normal AI chat.
5. If the service user (`service_user_id`) is missing or disabled, `PUT /api/config` rejects the configuration, while a hand-edited `config.yaml` starts normally and every sender is denied.
6. If `admin` is denied, the usual cause is an allowlist mismatch—not insufficient admin permissions.

---

## 10. Common pitfalls

- **Personal WeChat vs WeCom**: Personal WeChat uses `robots.wechat` + QR bind; WeCom uses `robots.wecom` + admin callback URL—they are completely different.  
- **WeChat QR expired**: QR codes last ~5 minutes; regenerate instead of reusing an old one.  
- **Wrong bot type**: The “Custom” bot added in a DingTalk **group** (Webhook + sign secret) **cannot** be used for two-way chat. Only the **enterprise internal app** bot from the open platform is supported.  
- **Configuration not applied**: Restart the process after editing `config.yaml`; after `PUT /api/config`, also call `POST /api/config/apply` (`PUT` alone does not restart connections, and it does not persist `auth`).  
- **Bot ID used as sender ID**: Copy the sender ID from `whoami`; do not use `ilink_bot_id`, configured `ilink_user_id`, a group ID, or a display name.  
- **Reusing an expired code**: Codes last five minutes and are single-use; generating a new code immediately invalidates the old one.  
- **Assuming service-account users are isolated**: All allowlisted senders share that account's conversations and owned resources. Use `user_binding` for isolation.  
- **Assuming admin removes the allowlist**: It does not. The sender must still match exactly, but every matching sender gets full permissions.  
- **Client ID typo**: If the platform shows `504`, use `504` (not `5o4`); prefer copy/paste.  
- **DingTalk: only HTTP callback, no Stream**: This app receives messages via **Stream**. In the open platform, message reception must be **Stream mode**.  
- **App not published**: After changing the bot or permissions in the open platform, **publish a new version** under “Version management and release”, or changes won’t apply.

---

## 11. Notes

- All platforms: **text messages only**; other types (e.g. image, voice) are not supported and may be ignored.  
- Personal WeChat: **private chat only**—group @-bot is not supported.  
- Bot data is shared with the web UI: under `user_binding` it belongs to the bound user; under `service_account` it belongs to the service account and is shared by allowlisted senders.  
- Bot execution uses the same **Pi single/multi-agent** path as the web UI (`ProcessMessageForRobot`, with progress callbacks and process details stored in the DB); only the final reply is sent back to personal WeChat/DingTalk/Lark/WeCom in one message (no SSE). Default: `robot_default_agent_mode: single`.
