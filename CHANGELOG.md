# Changelog

## Unreleased

### Removed

- Removed the Simplified Chinese (zh-CN) UI language, the Chinese server message translations and all Chinese documents: `docs/zh-CN/` (40 articles), `README_CN.md`, the Chinese section of `SECURITY.md` (there was no separate `SECURITY_CN.md`), `mcp-servers/README_CN.md`, `mcp-servers/pent_claude_agent/README_CN.md`, `mcp-servers/reverse_shell/README_CN.md`, and the `README.zh-CN.md` files of the browser extension and the Burp Suite extension. `tools/README_EN.md` is gone too: `tools/README.md` is now the English guide that it held, and the Chinese `tools/README.md` was replaced. The UI languages are English and Japanese. A browser that saved `zh-CN`, or a request with `Accept-Language: zh`, now gets English. Chinese bot command words and stored Chinese status texts of earlier versions are still recognized.
- Asset import no longer recognizes Chinese column headers or Chinese status, environment and criticality values (for example the Chinese labels for active/inactive, production and critical). Headers and values are accepted in English and Japanese, and the English codes (`active`, `production`, `critical`, ...) always work. A CSV exported from the Chinese UI of an earlier version must be re-exported in English or Japanese before you upgrade, or have its headers and values edited by hand; otherwise Chinese column headers are ignored (the import stops with "No template fields recognized" when none match) and rows with Chinese status, environment or criticality values are rejected.

### Added

- The source is now English: Go messages, comments and prompts, tool, role and configuration definitions, and frontend fallbacks. Japanese is served from `web/static/i18n` and `internal/apimsg/catalog.json` (now keyed by the English message). `TestRepositoryIsEnglish` guards this with `internal/handler/testdata/cjk_allowlist.txt`.
- Chat stream status and failure messages follow the UI language, live and when history is reloaded.
- Role files and names are English (`roles/default.yaml`, `Default`, `Penetration Testing`, ...). The legacy default role name is still accepted; conversations that reference another old role name fall back to the default behaviour unless the old role file is kept.
- Default `project.fact_index_max_runes` is 8000 (was 3500) and the resume supplement cap is 9400 characters (was 6500), sized for the English protocol text.
- Added Japanese documentation `docs/ja-JP/` (40 articles), added Japanese entries to the docs home page and each language index, and added the Japanese readme `README_JA.md`.

- Added Japanese (ja-JP) as a UI language: full Japanese strings and the Semi Japanese component locale pack, with Japanese support for notification summaries; Japanese is used by default when the browser language is Japanese. The default language when the browser language cannot be identified changed from Chinese to English (en-US), and missing strings fall back in the order "current language -> en-US -> ja-JP"; date and number formats now follow the UI language (previously fixed to Chinese), and notification summaries return English when no language is specified.
- Filled in 327 strings that the frontend references but the language packs lacked (en-US / ja-JP), fixing pages such as login, navigation groups, conversations, settings, vulnerabilities, C2 and WebShell that still showed Chinese in the English and Japanese UI; severity labels now follow the UI language; error messages from the login API are returned in the UI language (frontend requests carry `Accept-Language`).
- Removed the Russian (ru-RU) and Arabic (ar-SA) UI languages and the RTL handling; the UI languages are English / Japanese.
- API error messages are returned in the request language: added `internal/apimsg`, which translates `error` / `message` in JSON responses with status code >= 400 using `catalog.json` (about 990 entries, English source text -> ja); the frontend sends the UI language (`Accept-Language`), a request in any language other than Japanese, or without a language, gets English.
- About 850 hard-coded Chinese strings in the frontend now go through the string catalog (`ui.*`), and non-component `translate` / `lazyLabels` / `lazyOptions` were added; fixed dotted keys such as `settingsStorage.cat.*` not resolving in the English and Japanese UI; added a test ensuring strings referenced in the source exist in en-US.json.

- The default agent runtime migrated to Pi 1.5.2: the Go tool gateway still handles roles, approvals, monitoring and evidence; model proposals for chat and sub-agents go through Pi. Added a Node Worker published by source fingerprint, a streaming protocol, session recovery and native tool search. Deployment requires Node.js >=22.19; the Eino kernel, model adapters, bridges and all related dependencies were removed, and the runtime supports Pi only.
- Workflow now uses a native DAG and versioned checkpoints, and the knowledge base uses its own document, chunking, embedding and retrieval components. Old Eino Workflow checkpoints cannot be resumed directly by the new version; complete or export old tasks before upgrading. See the [Pi migration guide](docs/ja-JP/pi-runtime.md).

- AI channels support custom HTTP request headers, environment variables and session ID placeholders; saved auth headers can be used safely for connection tests, the standalone audit identity isolates the main channel request headers, and custom headers do not follow cross-origin redirects.

- Added `agent.task_timeout_minutes` to configure the execution timeout of single-agent, multi-agent, workflow and async tasks: the default is 600 minutes when unset, `0` means no limit, and negative values are rejected at load; resumed runs keep the restart-the-timer behavior, and the per-tool timeout still applies independently.

- The single-item download button in the vulnerability list now opens a format selection dialog supporting Markdown and Word (.docx); Word download reuses the vulnerability read permission and contains only the selected vulnerabilities (#365).

- Added async conversation APIs for single-agent and multi-agent: a task receipt is returned on acceptance and the run continues if the client disconnects; supports per-user idempotent submission, persistent status and result queries, explicit cancellation, and an interrupted status after a service restart. The synchronous APIs remain compatible.

- At startup, all project management tables are checked against a single latest SQLite definition, creating missing tables and adding missing columns, so no per-column migration list needs to be maintained; existing data and extra tables/columns are preserved, and a failed schema completion rolls back and blocks startup. HITL and notification tables are part of the unified initialization, and the legacy vulnerability foreign-key migration preserves extra columns, indexes, triggers and dependent records.

### Removed

- Retired the classic web UI; the workbench now uses Semi Design throughout. The old `/classic` bookmark redirects to the workbench, and `/api-docs` opens the Semi API docs. The role and agent pages are view-only, and the old edit forms and the online API debugging console were removed with the classic UI.

### Fixed

- Fixed WebShell batch liveness checks staying in "checking" because of a request construction error; saved credentials are now read by the connection's own ID, and after a failed check the button is restored and the other connections continue to be processed.

- Fixed audit agent requests failing against compatible gateways that do not support the thinking field; a standalone compatibility profile is supported, and default behavior is identified by model and address.

- Fixed official OpenAI models known to support `none` still using the server's default reasoning after reasoning was turned off (#366): the explicit off parameter is sent and preserved per provider, endpoint and model, covering the Planner and forced tool selection; DeepSeek and third-party compatible gateway behavior is preserved, and the tool-call limitation that requires Responses is now stated explicitly.

- Prevented the built-in administrator from losing privileges: deactivating the built-in `admin` or removing its system administrator role is rejected, the original profile, permissions and sessions are kept on failure, and the UI disables the corresponding actions.

- Fixed asset management information gathering failing because FOFA was requested with the `province` return field it does not support by default; `region` is now used throughout, old form/API field aliases remain compatible, the province of imported assets is preserved, and the intelligence field preset was corrected to `asn/org`.

- Fixed single-agent, multi-agent, role workflows and batch tasks misreporting a lower-level call timeout as a whole-task timeout: the task is marked timed out only when the task context's own deadline expires, lower-level failures keep their original diagnostics, and the total time limit and existing retry policy are unchanged.

- Deleting a nonexistent C2 Profile or WebShell now consistently returns 404, delete database failures return a generic 500 message and no longer expose SQL errors; vulnerability and batch task lists now consistently return `[]` when no records match, and HTTP contract regression checks were added.

- Fixed stale drafts overwriting other people's changes when several people edit call interception rules: only one save succeeds for the same version, conflicts keep the draft and prompt a refresh; API saves must carry the ETag/If-Match from the read.

- Fixed updating/deleting a platform role logging out all users: only sessions of members of the affected role are revoked; updates to name, description and equivalent permission sets keep sessions valid.

- Fixed overflow of dashboard status cards, risk badges and queue labels caused by long text such as Russian; the sidebar and risk names wrap fully, and the layout adapts to the available card width.

- Self-update recovery strictly verifies the recovery record, State, commit and binary pairing before rewriting files; missing, duplicate or contradictory evidence is rejected and the recoverable state is preserved.
- Editing a stopped external MCP no longer starts the connection unexpectedly; start/stop, config edits and app restarts keep a consistent running state.

- The login password show/hide button is now an eye icon inside the input, with consistent input width and height, keyboard focus, a 44px touch target, accessible labels in English and Japanese, and light/dark theme support.
