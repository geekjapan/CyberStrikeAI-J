# API Recipes

[English](../en-US/api-recipes.md) | [中文](../zh-CN/api-recipes.md)

本書では、外部スクリプトやプラグインでよく使われる API 呼び出しのレシピを紹介します。完全なフィールドについては、`/api-docs` と `/api/openapi/spec` を正としてください。

## Recipe 1：ログインと検証

```bash
curl -k https://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<password>"}'
```

以降のリクエストでは、次のヘッダーの使用を推奨します。

```bash
Authorization: Bearer <token>
```

検証：

```bash
curl -k https://127.0.0.1:8080/api/auth/validate \
  -H "Authorization: Bearer <token>"
```

## Recipe 2：会話の作成とメッセージの送信

最も簡単な方法は、空の会話を先に作成せず、Agent を直接呼び出すことです。

```bash
curl -k https://127.0.0.1:8080/api/agent \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"127.0.0.1 に対して、認可された基本的な情報収集を、読み取り専用の操作のみで実施してください"}'
```

先に会話を作成する必要がある場合：

```bash
curl -k https://127.0.0.1:8080/api/conversations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Web テスト"}'
```

その後、返された `conversationId` を Agent のリクエストに含めます。

## Recipe 3：Agent のストリーミング呼び出し

```bash
curl -k -N https://127.0.0.1:8080/api/agent/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"現在のプロジェクトのファクトを要約し、次のステップを挙げてください。読み取り専用で"}'
```

注意：

- `-N` は curl のバッファリングを無効にします。
- リバースプロキシ側でもバッファリングを無効にしてください。
- `done` を受信して初めて、そのターンが終了したことになります。

## Recipe 4：マルチエージェントの呼び出し

```bash
curl -k -N https://127.0.0.1:8080/api/multi-agent/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"認可されたターゲットに対して段階的な Web セキュリティテストを行い、先に計画を立ててから読み取り専用のステップを実行してください",
    "orchestration":"plan_execute"
  }'
```

指定可能な `orchestration`：

- `deep`
- `plan_execute`
- `supervisor`

## Recipe 5：添付ファイルのアップロード

```bash
curl -k https://127.0.0.1:8080/api/chat-uploads \
  -H "Authorization: Bearer <token>" \
  -F "file=@./request.txt"
```

大きなファイルは、アップロードしたうえでメッセージ内で参照することを推奨します。prompt に直接埋め込まないでください。

## Recipe 6：脆弱性の書き込み

```bash
curl -k https://127.0.0.1:8080/api/vulnerabilities \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"SQL インジェクションの例",
    "severity":"high",
    "target":"https://example.com/item?id=1",
    "description":"パラメーター id に検証可能な SQL インジェクションが存在する",
    "evidence":"読み取り専用の検証の出力...",
    "remediation":"パラメーター化クエリを使用する"
  }'
```

フィールドは OpenAPI を正としてください。

## Recipe 7：ナレッジベースの検索

```bash
curl -k https://127.0.0.1:8080/api/knowledge/search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "query":"SQL インジェクションでカラム数を判断する方法",
    "riskType":"SQL Injection",
    "topK":5,
    "threshold":0.4
  }'
```

結果が空の場合は、まず categories を呼び出して、リスクタイプの名前が一致しているかを確認してください。

## Recipe 8：外部 MCP の状態の確認

```bash
curl -k https://127.0.0.1:8080/api/external-mcp/stats \
  -H "Authorization: Bearer <token>"
```

サービスが running なのに Agent がツールを見つけられない場合は、ロールのツール制限と `tool_search` を確認してください。

## Recipe 9：ツールの schema の取得

```bash
curl -k https://127.0.0.1:8080/api/config/tools/nmap/schema \
  -H "Authorization: Bearer <token>"
```

プラグインや自動化スクリプトは、schema に基づいてパラメーターを組み立ててください。フィールド名を推測してはいけません。

## Recipe 10：監査ログのエクスポート

```bash
curl -k "https://127.0.0.1:8080/api/audit/logs/export" \
  -H "Authorization: Bearer <token>" \
  -o audit.csv
```

エクスポートしたファイルには機密性の高い操作の情報が含まれる可能性があるため、暗号化して保存してください。

## Recipe 11：資産の一括インポート

まず `assets.json` を用意します。

```json
{
  "source": "api-import",
  "source_query": "cmdb-export-2026-07",
  "assets": [
    {
      "domain": "app.example.com",
      "port": 443,
      "protocol": "https",
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

送信：

```bash
curl -k https://127.0.0.1:8080/api/assets/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  --data-binary @assets.json
```

レスポンスの例：

```json
{"created":2,"updated":0,"skipped":0}
```

注意：

- 呼び出し元には `asset:write` 権限が必要です。
- 各資産には、少なくとも `host`、`ip`、`domain` のいずれかを指定してください。
- 1 回あたり最大 100000 件です。大量のリクエストでは、JSON をコマンドラインに直接書かず、ファイルと `--data-binary` を組み合わせて使用してください。
- 既に存在する「ターゲット + ポート + プロトコル」は、マージして更新され、`updated` に計上されます。
- XLSX/CSV から操作する場合は、Web 側の **資産ライブラリ → 一括インポート** を使用してください。API 自体は JSON を受け付け、multipart ファイルは受け付けません。
