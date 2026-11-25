# API リファレンス

[English](../en-US/api-reference.md)

CyberStrikeAI には OpenAPI 仕様と API ドキュメントページが組み込まれています。サービスの起動後、次のパスにアクセスします。

```text
/api-docs
```

OpenAPI JSON:

```text
GET /api/openapi/spec
```

`/api/openapi/spec` はログイン認証が必要です。未認可のユーザーがインターフェース構造を直接列挙することを防ぎます。

## 認証

ログイン:

```http
POST /api/auth/login
Content-Type: application/json

{"password":"your-password"}
```

認証に成功すると、フロントエンドは通常 Cookie セッションを使用します。外部クライアントは、OpenAPI にある Bearer Token の記述も参考にし、実際に返されるフィールドに合わせて接続してください。

よく使う認証インターフェース:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/auth/validate`

## 会話と Agent

シングルエージェント:

- `POST /api/agent`
- `POST /api/agent/stream`

マルチエージェント:

- `POST /api/multi-agent`
- `POST /api/multi-agent/stream`

マルチエージェントのリクエストボディでは `orchestration` で方式を指定します。

- `deep`
- `plan_execute`
- `supervisor`

よく使うリクエストボディのフィールド:

| フィールド | 説明 |
| --- | --- |
| `message` | ユーザーのメッセージ。必須です。 |
| `conversationId` | 既存の会話を継続します。空の場合は新しい会話を作成します。 |
| `projectId` | 新しい会話をバインドするプロジェクト。空の場合は `config.project.default_project_id` に従うことがあります。 |
| `role` | 指定したロールを使用します。 |
| `aiChannelId` | `ai.channels` 内のチャネル ID を選択します。空の場合は `ai.default_channel` を使用します。 |
| `reasoning` | 会話単位の推論の上書き。チャネルの `reasoning.allow_client_reasoning` により制御されます。 |
| `hitl` | 会話単位のヒューマンインザループ設定。 |

会話管理:

- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `PUT /api/conversations/:id`
- `DELETE /api/conversations/:id`
- `POST /api/conversations/:id/delete-turn`
- `GET /api/messages/:id/process-details`

## ファイル管理のソース

ファイル管理ページと `/api/chat-uploads` の一覧インターフェースは、会話に関連するファイルをソース別に分類します。下層のディレクトリは引き続きプロジェクト ID または会話 ID を使用して安定性を保ちます。画面ではプロジェクト名や会話タイトルが優先して表示され、完全な ID はヒントやパスで確認できます。

| ソース | `source` | 典型的なディレクトリ | 説明 | 変更可否 |
| --- | --- | --- | --- | --- |
| 作業ディレクトリ | `workspace` | `tmp/workspace/projects/<projectId>/...`、`tmp/workspace/conversations/<conversationId>/...` | Agent がタスク実行時に保存するダウンロードファイル、分析スクリプト、中間結果、生成された CSV/XLSX/Markdown などです。ユーザーから「AI が生成したファイルが見つからない」と報告された場合は、通常まずここを確認します。 | 読み取り専用で表示。パスのコピー、ダウンロード、エクスポートに対応。 |
| 会話成果物 | `conversation_artifact` | `data/conversation_artifacts/<conversationId>/...` | システムが会話ごとにアーカイブした成果物や会話単位の生成物です。たとえば要約、レポート、モデルミドルウェアが生成したアーカイブ内容などです。 | 読み取り専用で表示。パスのコピー、ダウンロード、エクスポートに対応。 |
| ツール出力 | `reduction` | `tmp/reduction/projects/<projectId>/...`、`tmp/reduction/conversations/<conversationId>/...` | 長大なツール出力、スキャンの原文、切り詰められる前にディスクへ保存された結果キャッシュです。ツール出力の全文を見返すのに適しています。 | 読み取り専用で表示。パスのコピー、ダウンロード、エクスポートに対応。 |
| 会話添付ファイル | `upload` | `chat_uploads/<date>/<conversationId>/...` | ユーザーが会話またはファイル管理ページで手動アップロードした添付ファイルです。AI に特定のファイルを参照させたい場合は、サーバー上の絶対パスをコピーして会話に貼り付けます。 | アップロード、ディレクトリ作成、テキストファイルの編集、名前変更、削除、パスのコピー、ダウンロード、エクスポートが可能。 |

関連インターフェース:

- `GET /api/chat-uploads`: ソース、プロジェクト、会話、ファイル名でファイルを絞り込みます。
- `GET /api/chat-uploads/path`: ファイル管理内の相対パスまたは内部の仮想パスをサーバー上の絶対パスに解決します。ファイルやディレクトリのパスをコピーするために使用します。
- `GET /api/chat-uploads/download`: 指定したファイルをダウンロードします。
- `GET /api/chat-uploads/export`: 現在の絞り込み結果を ZIP としてエクスポートします。
- `POST /api/chat-uploads`: 会話添付ファイルのディレクトリにアップロードします。

## プロジェクト、脆弱性、攻撃チェーン

プロジェクト:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/facts`
- `POST /api/projects/:id/facts`
- `GET /api/projects/:id/fact-graph`

脆弱性:

- `GET /api/vulnerabilities`
- `POST /api/vulnerabilities`
- `GET /api/vulnerabilities/:id`
- `PUT /api/vulnerabilities/:id`
- `DELETE /api/vulnerabilities/:id`
- `GET /api/vulnerabilities/export`

攻撃チェーン:

- `GET /api/attack-chain/:conversationId`
- `POST /api/attack-chain/:conversationId/regenerate`

## 資産管理と一括インポート

資産インターフェース:

- `GET /api/assets`: 資産をページング付きで検索します。
- `GET /api/assets/selection`: 現在の絞り込み条件に基づいて、ページをまたぐ選択を解決します。最大 10000 件を返します。
- `GET /api/assets/stats`: 資産統計を取得します。`days` は `7`、`30`、`90` のみ指定できます。
- `POST /api/assets/import`: 資産を追加、または重複排除して更新します。1 回あたり最大 100000 件です。
- `POST /api/assets/scan-links`: スキャンとの関連付けを一括で記録します。1 回あたり最大 10000 件です。
- `PUT /api/assets/bulk`: 最大 10000 件の資産をアトミックに一括更新します。
- `PUT /api/assets/project-binding`: プロジェクトを一括でバインドします。1 回あたり最大 10000 件の資産 ID を指定できます。
- `POST /api/assets/batch-delete`: 最大 10000 件の資産をアトミックに一括削除します。
- `POST /api/assets/merge`: 共通の識別情報を持つ 2〜100 件の重複資産を統合します。
- `PUT /api/assets/:id`: 資産を更新します。
- `DELETE /api/assets/:id`: 資産を削除します。

`GET /api/assets` と `GET /api/assets/selection` は同じ絞り込み・並べ替えパラメーターを使用します。`selection` はページングパラメーターを無視し、一致するすべての項目（最大 10000 件）を返します。

| カテゴリ | パラメーター |
| --- | --- |
| ページング（一覧のみ） | `page`、`page_size`（最大 100） |
| よく使うもの | `q`、`status`、`project_id`、`risk_level`、`min_vulnerabilities`、`max_vulnerabilities` |
| ターゲットとソース | `host`、`ip`、`domain`、`port`、`protocol`、`source`、`tag` |
| 責任者と業務 | `responsible_person`、`department`、`business_system`、`environment`、`criticality` |
| 地理 | `country`、`province`、`city` |
| スキャン | `scan_state=never|scanned`、`scan_overdue_days`、`last_scan_before`、`last_scan_after` |
| 発見時刻 | `first_seen_before`、`first_seen_after`、`last_seen_before`、`last_seen_after` |
| 並べ替え | `sort_by`、`sort_order=asc|desc` |

時刻パラメーターは RFC3339 または `YYYY-MM-DD` を受け付けます。`sort_by` は `last_seen_at`、`last_scan_at`、`first_seen_at`、`created_at`、`updated_at`、`host`、`port`、`risk_level`、`vulnerability_count` をサポートします。

`POST /api/assets/import` は CSV ファイルではなく JSON を受け取ります。Web 側はブラウザー内でテンプレートを解析し、プレビューしたうえで、このリクエスト形式に変換します。

```http
POST /api/assets/import
Authorization: Bearer <token>
Content-Type: application/json

{
  "source": "manual-import",
  "source_query": "asset-import-2026-07.csv",
  "assets": [
    {
      "host": "https://app.example.com:443",
      "domain": "app.example.com",
      "port": 443,
      "protocol": "https",
      "title": "Example App",
      "server": "nginx",
      "project_id": "<project-id>",
      "responsible_person": "Alice",
      "department": "Security",
      "business_system": "Customer Portal",
      "environment": "production",
      "criticality": "critical",
      "tags": ["production", "internet"],
      "status": "active"
    },
    {
      "ip": "192.0.2.10",
      "port": 22,
      "protocol": "ssh",
      "status": "active"
    }
  ]
}
```

リクエストのルール:

- `assets` には `1-100000` 件を含める必要があります。
- 各資産の `host`、`ip`、`domain` のうち少なくとも 1 つは空でない必要があります。
- `port` の範囲は `0-65535` です。
- `status` は `active` または `inactive` のみ指定できます。
- `environment` は空、または `production`、`staging`、`testing`、`development`、`other` を指定できます。
- `criticality` は空、または `critical`、`high`、`medium`、`low` を指定できます。
- タグは最大 30 個、1 個あたり最大 64 文字です。
- `project_id` が空でない場合、呼び出し元はそのプロジェクトにアクセスする権限を持っている必要があります。
- `asset:write` 権限が必要です。
- サーバーは「ターゲット + ポート + プロトコル」で重複排除し、今回のリクエストを同一トランザクション内で処理します。

成功時のレスポンス:

```json
{
  "created": 120,
  "updated": 8,
  "skipped": 2
}
```

- `created`: 新規作成された件数。
- `updated`: 重複排除キーに一致し、統合して更新された件数。
- `skipped`: 空のレコード、またはリソースの所属上更新できないためスキップされた件数。

フィールドの検証に失敗すると `400` を返し、レスポンスの `error` にはエラーのあった資産の順番が含まれます。プロジェクトへのアクセス権がない場合は `403` を返します。一括インポートのテンプレートフィールドと UI 操作については、[資産管理ガイド](asset-management.md#表計算ファイルからの一括インポート)を参照してください。

一括編集の例:

```http
PUT /api/assets/bulk
Content-Type: application/json

{
  "asset_ids": ["<asset-id-1>", "<asset-id-2>"],
  "responsible_person": "Alice",
  "department": "Security",
  "environment": "production",
  "criticality": "high",
  "add_tags": ["internet-facing"],
  "remove_tags": ["untriaged"]
}
```

一括更新のフィールドはすべて任意です。指定しなかったフィールドは元の値のままです。`add_tags` と `remove_tags` はトランザクション内で重複排除して処理されます。一括編集、プロジェクトのバインド、一括削除では、まずすべての資産へのアクセス可否を検証します。存在しない ID やアクセス権のない ID が 1 つでもあれば、バッチ全体が失敗します。

重複資産の統合例:

```http
POST /api/assets/merge
Content-Type: application/json

{
  "asset_ids": ["<primary-id>", "<duplicate-id>"],
  "primary_id": "<primary-id>"
}
```

削除対象の各レコードは、主資産とドメイン、IP、または Host を共有している必要があります。主資産に既にあるフィールドが優先され、空のフィールドは他のレコードから補完され、タグは和集合になります。呼び出し元には、主資産を更新する権限と、残りの資産を削除する権限が必要です。

## ツール、MCP、設定

設定:

- `GET /api/config`
- `PUT /api/config`
- `POST /api/config/apply`
- `GET /api/config/tools`
- `GET /api/config/tools/:name/schema`
- `POST /api/config/test-openai`
- `POST /api/config/test-vision`
- `POST /api/config/list-models`

MCP:

- `POST /api/mcp`
- `GET /api/external-mcp`
- `PUT /api/external-mcp/:name`
- `POST /api/external-mcp/:name/start`
- `POST /api/external-mcp/:name/stop`
- `DELETE /api/external-mcp/:name`

## ナレッジベース、Skills、ロール、Agent

ナレッジベース:

- `GET /api/knowledge/categories`
- `GET /api/knowledge/items`
- `POST /api/knowledge/scan`
- `POST /api/knowledge/index`
- `POST /api/knowledge/search`

ロール:

- `GET /api/roles`
- `POST /api/roles`
- `GET /api/roles/:name`
- `PUT /api/roles/:name`
- `DELETE /api/roles/:name`

Skills:

- `GET /api/skills`
- `POST /api/skills`
- `GET /api/skills/:name`
- `PUT /api/skills/:name`
- `DELETE /api/skills/:name`
- `GET /api/skills/:name/files`
- `GET /api/skills/:name/file`
- `PUT /api/skills/:name/file`

Markdown サブエージェント:

- `GET /api/multi-agent/markdown-agents`
- `POST /api/multi-agent/markdown-agents`
- `GET /api/multi-agent/markdown-agents/:filename`
- `PUT /api/multi-agent/markdown-agents/:filename`
- `DELETE /api/multi-agent/markdown-agents/:filename`

## 高リスクの機能

WebShell:

- `GET /api/webshell/connections`
- `POST /api/webshell/connections`
- `POST /api/webshell/exec`
- `POST /api/webshell/file`

C2:

- `GET /api/c2/listeners`
- `POST /api/c2/listeners`
- `GET /api/c2/sessions`
- `POST /api/c2/tasks`
- `POST /api/c2/payloads/build`

ターミナル:

- `POST /api/terminal/run`
- `POST /api/terminal/run/stream`
- `GET /api/terminal/ws`

これらのインターフェースは信頼できる管理者にのみ公開し、HTTPS、強力なパスワード、ネットワーク分離、監査と組み合わせて運用してください。

## 利用上の推奨事項

- 完全なパラメーターとレスポンス構造は、まず `/api-docs` で確認してください。
- ストリーミングインターフェースは SSE を使用します。リバースプロキシではバッファリングを無効にする必要があります。
- すべての変更系インターフェースで 401、403、404、409、500 を処理してください。
- 外部連携では、最小権限のネットワーク経路を作成することを推奨します。Web 管理画面を直接パブリックインターネットに公開しないでください。

## 認証の詳細

認証ミドルウェアは、次の順序でトークンを取り出します。

1. `Authorization: Bearer <token>`
2. `Authorization: <token>`
3. クエリパラメーター `?token=<token>`
4. Cookie `auth_token`

つまり、外部スクリプトでは `Authorization: Bearer` を使用するのが最も確実です。クエリパラメーターもサポートされていますが、プロキシのログに残りやすいため、本番環境での使用は推奨しません。

## SSE クライアントの注意事項

`/api/agent/stream` と `/api/multi-agent/stream` は長時間接続です。クライアントは次の点に対応する必要があります。

- ネットワークが中断した後、破壊的なリクエストを無差別に再送しないこと。
- `error` イベントを受信したら、エラー本文を読み取ること。
- `done` を受信して初めて、今回のターンが終了したとみなすこと。
- プロキシ層ではバッファリングしないこと。
- リクエストボディの `conversationId` により、既存の会話を継続するかどうかが決まること。

## API の安定性レベル

| API の種類 | 安定性 | 連携の推奨事項 |
| --- | --- | --- |
| `/api/auth/*` | 高 | 直接連携可能 |
| `/api/agent*` | 高 | 外部からの会話入口として推奨 |
| `/api/openapi/spec` | 高 | クライアント生成に使用 |
| `/api/assets/*` | 高 | 資産管理と一括インポート |
| `/api/config*` | 中 | 管理ツールでの使用向け。自動化は慎重に |
| `/api/c2/*`、`/api/webshell/*` | 中 | 高リスク。権限境界を必ず設けること |
| フロントエンド固有の呼び出しの詳細 | 低 | プラグインが依存することは推奨しません |

## Curl の例

ログインしてトークンを取り出す際の戻りフィールドは、実装の調整により変わる可能性があります。まず `/api-docs` を確認することを推奨します。すでにトークンがある場合:

```bash
curl -k https://127.0.0.1:8080/api/conversations \
  -H "Authorization: Bearer <token>"
```

非ストリーミングのシングルエージェントリクエストを送信する例:

```bash
curl -k https://127.0.0.1:8080/api/agent \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"127.0.0.1 に対して許可された基本的な情報収集を行い、高リスクの操作はまだ実行しないでください"}'
```

## ソースコードのアンカー

- ルーティング: `internal/app/app.go`
- 認証: `internal/security/auth_middleware.go`
- OpenAPI: `internal/handler/openapi.go`
- シングルエージェント: `internal/handler/single_agent.go`
- マルチエージェント: `internal/handler/multi_agent.go`
- 資産インターフェース: `internal/handler/asset.go`
- 資産ストレージと重複排除: `internal/database/asset.go`

## 削除と空リストのレスポンス規約

リクエストが認証と権限チェックを通過し、モジュールが利用可能な場合:

- `DELETE /api/c2/profiles/:id` と `DELETE /api/webshell/connections/:id` は、存在しない、または削除済みのオブジェクトに対して `404` を返します。エラーメッセージにはそれぞれ `profile not found` と `connection not found` を使用します。実際のデータベース障害では `500` と汎用のエラーメッセージを返し、下層の SQL エラーはサービスログにのみ記録されます。
- `GET /api/vulnerabilities` と `GET /api/batch-tasks` は、クエリに成功しても一致するレコードがない場合は `200` を返します。コレクションフィールドはそれぞれ `"vulnerabilities": []` と `"queues": []`、通常の件数は `"total": 0` です。

クライアントは HTTP ステータスにより、呼び出しの失敗と、成功した空の結果を区別できます。これら 2 つの一覧の空コレクションは、`null` から `[]` に変更されました。
