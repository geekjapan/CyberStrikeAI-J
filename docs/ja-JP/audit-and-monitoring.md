# 監査と監視

[English](../en-US/audit-and-monitoring.md) | [中文](../zh-CN/audit-and-monitoring.md)

CyberStrikeAI には、よく使われる 2 種類の可観測性データがあります。プラットフォーム操作の監査と、ツール実行の監視です。両者は用途が異なるため、同時に有効にすることを推奨します。

## プラットフォーム監査

設定：

```yaml
audit:
  enabled: true
  retention_days: 15
  max_detail_bytes: 8192
  auth_failure_cooldown_seconds: 60
```

監査記録は、ログイン、設定、リソース管理などのプラットフォーム操作を対象とします。会話の本文を完全に記録することはなく、すべてのツール呼び出しの本文を 1 件ずつ記録することもありません。

エンドポイント：

- `GET /api/audit/meta`
- `GET /api/audit/summary`
- `GET /api/audit/logs`
- `GET /api/audit/logs/:id`
- `GET /api/audit/logs/export`

注目すべき点：

- ログイン失敗と不審な送信元 IP。
- パスワードの変更。
- 設定の変更。
- 外部 MCP の追加・削除・変更。
- C2/WebShell/ナレッジベースなど、高リスクなリソースの操作。

## ツール実行監視

設定：

```yaml
monitor:
  retention_days: 90
```

ツール実行監視は、MCP ツールの呼び出し、コマンドの状態、所要時間、キャンセル、結果の要約を確認するためのものです。

エンドポイント：

- `GET /api/monitor`
- `GET /api/monitor/execution/:id`
- `POST /api/monitor/execution/:id/cancel`
- `DELETE /api/monitor/execution/:id`
- `DELETE /api/monitor/executions`
- `GET /api/monitor/stats`
- `GET /api/monitor/calls-timeline`
- `POST /api/monitor/executions/names`

## 通知サマリー

エンドポイント：

- `GET /api/notifications/summary`
- `POST /api/notifications/read`

通知は、対応待ちの事項、未読の状態、実行中のタスクの概況を知らせるためのものです。具体的な表示はフロントエンドのページに依存します。

## HITL ログ

HITL の判断ログは独立して管理されます。

- `GET /api/hitl/pending`
- `GET /api/hitl/logs`
- `GET /api/hitl/logs/:id`
- `DELETE /api/hitl/logs`
- `POST /api/hitl/decision`
- `POST /api/hitl/dismiss`

HITL ログをプラットフォーム監査と組み合わせ、Agent があるツールを実行した、または実行しなかった理由の振り返りに活用することを推奨します。

## 保持ポリシー

推奨：

- 監査ログは 15 日から 90 日保持し、組織の要件に応じて調整します。
- ツール実行記録は 30 日から 180 日保持します。
- C2、WebShell、アップロードされた添付ファイル、タスクの結果は、プロジェクトの期間に合わせて個別に整理します。
- ログをエクスポートする際は、マスキングとアクセス権限に注意します。

## 運用点検

毎週確認する項目：

- 異常なログイン失敗がないか。
- 未認可の設定変更がないか。
- 長時間実行されている、または失敗率の高いツール。
- 外部 MCP の接続状態。
- データベースファイルのサイズとディスク容量。

演習が終わるたびに行うこと：

- 必要な監査証拠をエクスポートする。
- 不要な WebShell/C2 のセッションと payload を削除する。
- アップロードされた添付ファイルと一時ワークスペースを整理する。
- レポート、脆弱性、プロジェクトのファクトをアーカイブする。

## 監査と監視の境界

両者はしばしば混同されますが、意味は異なります。

- 監査は「誰がプラットフォーム上でどのような管理操作を行ったか」に答えます。
- 監視は「ツール呼び出しがどのように実行されているか」に答えます。
- HITL ログは「あるツール呼び出しがなぜ許可、変更、拒否されたか」に答えます。
- 会話のプロセス詳細は「Agent がそのときどのように推論し、手順をつなげたか」に答えます。

セキュリティの振り返りでは、通常この 4 種類の情報を合わせて確認します。監査だけを見ると具体的なツールの出力を見落とし、監視だけを見ると誰が設定を変更したかを見落とします。

## 主要イベントの解説

次のイベントの種類に特に注目することを推奨します。

| イベント | 重要な理由 |
| --- | --- |
| ログイン失敗 | ブルートフォース、パスワード漏えい、または設定ミス |
| パスワード変更 | 以前のセッションがすべて失効し、利用中の人に影響する可能性がある |
| 設定の更新 | モデル、ツール、C2、ナレッジベース、監査ポリシーが変わる可能性がある |
| 外部 MCP の変更 | 新しいツールが、ローカルまたはリモートでの実行能力を持つ可能性がある |
| C2 listener/task | 認可されたターゲットとネットワーク公開面に直接影響する |
| WebShell 接続の変更 | 実際の業務システムへの実行チャネルが持ち込まれる可能性がある |
| HITL の拒否 | Agent またはユーザーのリクエストがリスク境界に触れたことを示す |

## ログは長く保持すればよいわけではない

セキュリティツールのログには、ターゲット、脆弱性、パス、コマンド出力、組織内部の情報が含まれていることがよくあります。保持期間は、振り返りの価値と漏えいリスクのバランスで決めてください。

- 短期の演習：15〜30 日。
- 継続的なレッドチームプラットフォーム：90〜180 日。
- コンプライアンス要件がある場合：組織の規定に従ってアーカイブしますが、エクスポート後は暗号化します。

専用のログプラットフォームがない場合は、SQLite 内のすべての明細を無期限に保持しないでください。

## ソースコードの参照先

- 監査サービス：`internal/audit/service.go`
- 監査のマスキング：`internal/audit/sanitize.go`
- 監査の保持：`internal/audit/retention.go`
- 監査エンドポイント：`internal/handler/audit.go`
- 監視 reconcile：`internal/monitor/reconcile.go`
- 監視エンドポイント：`internal/handler/monitor.go`
- HITL ログ：`internal/handler/hitl_logs.go`
