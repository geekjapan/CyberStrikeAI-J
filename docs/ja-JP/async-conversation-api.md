# 非同期会話 API

[English](../en-US/async-conversation-api.md) | [中文](../zh-CN/async-conversation-api.md)

長時間タスクには、`POST /api/agent/runs`（シングルエージェント）または `POST /api/multi-agent/runs`（マルチエージェント。設定での有効化が必要）を使用します。リクエストボディは対応する同期インターフェースと同じです。既存の conversationId を指定でき、省略すると会話が作成されます。従来の同期インターフェースは引き続き最終結果を待ち、接続が切断されると同期実行はキャンセルされます。

```sh
curl -X POST "$CSAI_URL/api/agent/runs" \
  -H "Authorization: Bearer $CSAI_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-task-001' \
  -d '{"message":"今回のタスクの計画を整理してください"}'
```

HTTP 202 の例：

```json
{"runId":"...","conversationId":"...","assistantMessageId":"...","status":"running","statusUrl":"/api/agent/runs/..."}
```

受領通知を受け取った後は、接続を閉じて構いません。`GET statusUrl` は `status`、`result`、識別子、タイムスタンプを返します。`result` は元の実行入口の最終レスポンスまたはエラーであり、タスクが終了していない間は空のオブジェクトです。1 回のタスクの合計予算は 600 分で、個別のツールとモデルの制限も引き続き有効です。成否の判断は、照会で得られた終了状態を基準とし、token usage summary では判断しないでください。

- 冪等キーは必須で、1〜200 バイト、認証済みユーザーごとに分離されます。同じキーで同じリクエストの場合は元の受領通知を返し、同じキーで異なるリクエストの場合は 409 を返します。受領通知を受け取れなかった場合は、元のキーと元のリクエストでリトライしてください。新しいラウンドの実行には、新しいキーを使用します。
- 同じ会話にすでにタスクがある場合は 409 を返し、その競合したリクエストのメッセージは追加されません。
- 現在の会話のタスクを明示的にキャンセルするには、`POST /api/agent-loop/cancel` と `{"conversationId":"..."}` を使用します。キャンセルは会話単位の操作です。現在実行中のものとキャンセル対象の受領通知が一致していることを先に確認してください。
- 会話は `/api/conversations/{conversationId}` で確認し、保存されたプロセスは `/api/messages/{assistantMessageId}/process-details` で読み取ります。アクティブなタスクは `/api/agent-loop/task-events?conversationId=...` を購読することもできます。購読では履歴は再生されません。
- ステータスは、running、completed、failed、cancelled、timeout、interrupted のほか、納品チェックまたはリソースクリーンアップのステータスになり得ます。実行レスポンスの finalized=true だけが、最終納品の成功を意味します。
- 送信には agent:execute と chat:write が必要です。照会には引き続きインターフェースの権限と会話へのアクセス権限が必要で、バックグラウンド実行は送信者の Principal を保持します。
- 受領通知と結果はサーバー側のデータベースに保存されます。現在の実行モデルは、単一インスタンスがデータベースを占有する方式です。サービスの起動時に、残っていた running は interrupted にマークされます。未完了のツールが自動的に再実行されることはありません。元の会話で続行するかどうかは、ユーザーが判断します。
- 非同期機能は、外部ツールが決して失敗しないことを保証するものではなく、プロセスのクラッシュ後の自動再開も約束しません。データベースに書き込めない場合、送信はエラーを返します。これを受理されたものと見なしてはいけません。
