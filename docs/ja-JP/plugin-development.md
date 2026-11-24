# プラグイン開発

[English](../en-US/plugin-development.md) | [中文](../zh-CN/plugin-development.md)

CyberStrikeAI の現在のリポジトリでは、プラグインは主に `plugins/` 配下にあり、**Burp Suite 拡張**と **Chromium ブラウザー拡張**の 2 つのリファレンス実装があります。プラグインは通常、HTTP API、MCP、またはローカルファイルを通じてメインアプリケーションと連携します。

## ディレクトリ

```text
plugins/
  README.md
  burp-suite/
    cyberstrikeai-burp-extension/
      src/main/java/burp/
      README.md
      README.zh-CN.md
      build.gradle
      pom.xml
  browser-extension/
    cyberstrikeai-browser-extension/
      manifest.json
      devtools.js
      background/service-worker.js
      panel/
      popup/
      lib/
      README.md
      README.zh-CN.md
      package.sh
```

## プラグインの種類

一般的な連携方式:

- ブラウザーやセキュリティツールの拡張: CyberStrikeAI API を呼び出します。
- MCP Server: CyberStrikeAI に新しいツールを公開します。
- ファイル型の拡張: tools、roles、skills、agents を提供します。
- Webhook/ボット: プラットフォームのコールバックを通じて CyberStrikeAI と会話します。

## Burp Suite 拡張

Burp プラグインのディレクトリには、Java ソースコードとビルドスクリプトが含まれます。典型的な機能:

- Burp 内の HTTP リクエスト/レスポンスを読み取る。
- メッセージを整形する。
- CyberStrikeAI API を呼び出す。
- Burp のタブに AI の分析結果を表示する。

ビルド前に次を確認してください。

- JDK が利用できること。
- Gradle または Maven が利用できること。
- CyberStrikeAI のサービスアドレスと認証設定が正しいこと。

## ブラウザー拡張（Chromium DevTools）

ブラウザー拡張のディレクトリは MV3 DevTools 拡張で、Burp プラグインと機能を揃えています。HTTP トラフィックのキャプチャ → プロンプトの整形 → SSE ストリーミングによる AI 結果の出力、という流れです。完全なインストール方法と UI の説明は `plugins/browser-extension/cyberstrikeai-browser-extension/README.zh-CN.md` を参照してください。

典型的な機能:

- DevTools の **Network** で XHR/Fetch をキャプチャする（一時停止可能）。
- 元の HAR はメモリに保存し、表示と AI プロンプトは **HTTP/1.1** に正規化する（Burp と同様）。
- CyberStrikeAI のログイン、Validate、Agent Stream API を呼び出す。
- DevTools パネルに Progress / Final を表示し、Popup では接続状態を読み取り専用で表示する。

ビルドと読み込み:

- コンパイル不要: `chrome://extensions/` → パッケージ化されていない拡張機能を読み込む → `cyberstrikeai-browser-extension/` を選択。
- パッケージ化: `bash package.sh` → `dist/cyberstrikeai-browser-extension.zip`。

### ブラウザープラグインの認証のベストプラクティス

サーバー側の `POST /api/auth/login` は `{ token, expires_at }` を返し、**refresh token はありません**。プラグインはトークンが自動更新されると想定してはいけません。リファレンス実装は `lib/auth-session.js`、`lib/api.js`、`panel/panel.js` を参照してください。

| プラクティス | 説明 |
| --- | --- |
| セッションストレージ | トークンと `expires_at` は `chrome.storage.session` に保存する（ブラウザーを閉じると無効になる）。パスワードはディスクに保存しない |
| 残り時間 | ステータスバーに `OK · 残り 11h 30m` と表示する。残りが 30 分未満になったら警告する |
| ローカル検出 | 30 秒ごとに `expires_at` を確認し、`GET /api/auth/validate` を呼び出す |
| サーバー側の探索 | DevTools パネルに切り替えたとき、またはウィンドウがフォーカスされたときに直ちに探索する |
| サービスに到達できない | 「サービスに接続できません」と表示し、トークンはクリアしない（サービス再起動中でも使えるようにするため） |
| 401/403 | トークンをクリアし、接続バーを展開する（サービス再起動後はセッションのメモリが空になるため） |
| 送信前の検証 | `ensureAuthReady()` を呼び出し、期限切れのトークンで SSE を開始しないようにする |
| オンデマンドの認可 | `optional_host_permissions` を使用し、Validate 時に対象の origin を要求する |

拡張機能のリロード後、DevTools パネルのコンテキストが無効になることがあります。その場合は **DevTools を閉じる → 拡張機能をリロード → もう一度 F12 を開く** の手順を行ってください。

### ブラウザープラグインのデータとパフォーマンスの境界

プラグイン側ではメモリ上限を設け、DevTools を長時間開いたままにしてブラウザーが重くなることを避けてください。

- キャプチャ: 1 タブあたり 200 件、タブスロットは 20 個、Progress は 1 回の実行あたり 512KB。
- デフォルトは **XHR/Fetch only** で、静的リソースを事前にフィルタリングする。キャプチャが不要なときは **一時停止中** にする。
- 大きなレスポンスは、切り詰めまたは要約してからプロンプトに入れ、メッセージにそのまま詰め込まない。

## API 連携の推奨事項

プラグインからメインアプリケーションを呼び出す場合:

- まず `POST /api/auth/login` を呼び出し、その後 `GET /api/auth/validate` でセッションを確認する。
- `expires_at` を保存し、期限が切れたら再ログインする（サイレントリフレッシュはありません）。
- `/api/agent/stream` または `/api/multi-agent/stream`（SSE）を優先して呼び出す。
- 大きなファイルは `/api/chat-uploads` でアップロードし、メッセージ内で参照する。
- 照会結果や脆弱性は `/api/vulnerabilities` に書き込める。
- プロジェクト情報は `/api/projects/:id/facts` に書き込める。

完全なインターフェースは `/api-docs` が正となります。

## MCP プラグイン

プラグインの目的が Agent にツールを追加することである場合は、MCP Server の実装を優先してください。その後、外部 MCP 管理で接続します。

- stdio: ローカルで起動する。
- HTTP/SSE: 長期稼働のサービス。

MCP ツール設計の推奨事項:

- スキーマを明確にする。
- パラメーターを最小限にする。
- 出力構造を安定させる。
- エラーメッセージを読みやすくする。
- 高リスクの操作は独立したツールに分け、HITL の承認をしやすくする。

## ファイル型の拡張

プラグインは次のものを提供することもできます。

- `tools/*.yaml`
- `roles/*.yaml`
- `skills/<name>/SKILL.md`
- `agents/*.md`

この方式はシンプルで確実であり、社内の方法論やツールチェーンの蓄積に適しています。

## リリース前のチェック

プラグインをリリースする前に、次を確認してください。

- API Key、Cookie、ターゲット情報が含まれていない。
- README にインストール、設定、アンインストールの説明がある。
- エラー表示が明確である。
- 現在の CyberStrikeAI の API バージョンと互換性がある。
- 高リスクの機能について明確な説明がある。

## バージョン互換性

プラグインは、非公開のフロントエンド内部実装への依存を避けてください。次のものへの依存を優先します。

- `/api/openapi/spec`
- 安定した HTTP API。
- MCP プロトコル。
- ファイルディレクトリの規約。

内部インターフェースへの依存が避けられない場合は、プラグインの README に互換性のあるバージョンを明記してください。

## プラグイン設計の 3 つの層

| 層 | 例 | 利点 | コスト |
| --- | --- | --- | --- |
| API プラグイン | Burp / ブラウザー拡張が Agent Stream を呼び出す | 実装が容易で、UI 連携に適している | 認証と API の安定性に依存する |
| MCP プラグイン | Agent に新しいツールを提供する | Agent が主体的に呼び出せる | スキーマとセキュリティの設計が必要 |
| リソースパックプラグイン | tools/roles/skills/agents を提供する | 最もシンプルで、バージョン管理できる | 対話機能が弱い |

プラグインを最初から MCP にする必要はありません。「Burp / ブラウザー内の HTTP リクエストを AI に渡して分析させる」だけであれば、API プラグインの方が直接的です。Agent に Burp のスキャンを主体的に呼び出させたり、結果を照会させたりしたい場合に、MCP を作ります。

## API プラグインのリクエスト設計

Agent に送る内容には、次を含めてください。

- 発信元のツールとコンテキスト。
- ターゲット URL、メソッド、主要な header。
- リクエストボディとレスポンスボディの切り詰め方針。
- ユーザーが AI に何をしてほしいか。
- 認可の境界。

完全な大きなレスポンスをそのままメッセージに詰め込まないでください。大きなファイルはアップロードインターフェースを使うか、要約してください。

## MCP プラグインのスキーマ設計

悪いスキーマ:

```json
{"cmd":{"type":"string"}}
```

良いスキーマ:

```json
{
  "target_url": {"type":"string","description":"許可されたターゲット URL"},
  "scan_profile": {"type":"string","enum":["passive","active-safe"]},
  "max_requests": {"type":"integer","description":"最大リクエスト数"}
}
```

スキーマが具体的であるほど、HITL がリスクを判断しやすくなり、Agent も脱線しにくくなります。

## プラグインのセキュリティ境界

プラグインはプラットフォームのセキュリティ制御を迂回してはいけません。

- ローカルの高リスクなコマンドを、HITL に公開せずに直接実行しない。
- プラグイン内に平文の長期的な認証情報を保存しない（パスワードはログインにのみ使用し、トークンはセッションストレージを使用する）。
- デフォルトでターゲットデータをサードパーティのサービスに送信しない。
- ブラウザーのローカル状態に依存してログインを迂回しない。
- 401/403 を受け取ったらセッションをクリアして再認証を促す。黙って再試行したり無視したりしない。

## ソースコードのアンカー

- Burp プラグインの Java コード: `plugins/burp-suite/cyberstrikeai-burp-extension/src/main/java/burp/`
- ブラウザー拡張: `plugins/browser-extension/cyberstrikeai-browser-extension/`
  - 認証: `lib/auth-session.js`、`lib/api.js`、`lib/storage.js`
  - メイン UI: `panel/panel.js`
  - キャプチャ: `devtools.js`、`background/service-worker.js`
- OpenAPI: `internal/handler/openapi.go`
- 外部 MCP: `internal/handler/external_mcp.go`
- Web 側の認証リファレンス: `web/frontend/src/lib/auth.jsx`
