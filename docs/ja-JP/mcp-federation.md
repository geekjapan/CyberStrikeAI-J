# MCP フェデレーション

[English](../en-US/mcp-federation.md) | [中文](../zh-CN/mcp-federation.md)

CyberStrikeAI は、組み込みの MCP ツール、独立した HTTP MCP サービス、外部 MCP フェデレーションを同時にサポートします。MCP は、エージェントがツールを呼び出すための主要なプロトコル層です。

## 組み込み MCP

Web サービスの内部で MCP Server が作成され、次のものが登録されます。

- YAML コマンドツール。
- 組み込みのセキュリティ実行ツール。
- ナレッジベースツール。
- プロジェクトファクトツール。
- C2 ツール。
- WebShell ツール。
- バッチタスクツール。
- ビジョン分析ツール。

フロントエンドとエージェントは通常、アプリケーション内部から呼び出すため、追加の設定は不要です。

## HTTP MCP サービス

設定：

```yaml
mcp:
  enabled: true
  host: 0.0.0.0
  port: 8081
  auth_header: "X-MCP-Token"
  auth_header_value: "random-secret"
```

本番環境では `auth_header_value` を必ず設定し、ネットワークアクセスを制限してください。

## Web 内の MCP エンドポイント

ログイン後、次のエンドポイントを利用できます。

```text
POST /api/mcp
```

このエンドポイントは Web 認証を再利用するため、内部ページや管理された連携に適しています。

## 外部 MCP

外部 MCP は次の場所で設定します。

```yaml
external_mcp:
  servers: {}
```

Web の MCP 管理ページから、追加、起動、停止、削除を行うこともできます。

API：

- `GET /api/external-mcp`
- `GET /api/external-mcp/stats`
- `GET /api/external-mcp/:name`
- `PUT /api/external-mcp/:name`
- `POST /api/external-mcp/:name/start`
- `POST /api/external-mcp/:name/stop`
- `DELETE /api/external-mcp/:name`

## stdio

stdio MCP は、ローカルマシンのコマンドで起動するツールサービスに適しています。

注意点：

- コマンドのパスが存在すること。
- 作業ディレクトリが正しいこと。
- 環境変数が揃っていること。
- プロセスが終了すると、ツールが利用できなくなる。
- 起動失敗の原因は、ログで確認する。

## HTTP / SSE

HTTP または SSE の MCP は、リモートまたは長期稼働のサービスに適しています。

注意点：

- URL に到達できること。
- 認証ヘッダーが正しいこと。
- TLS 証明書が信頼できること。
- プロキシとファイアウォールで許可されていること。
- サーバー側のプロトコルバージョンに互換性があること。

## ツール公開ポリシー

ツールが多すぎると、コンテキストのコストが増え、誤選択の確率も高まります。マルチエージェントでは、次の設定が使えます。

```yaml
multi_agent:
  runtime:
    tool_search_enable: true
    tool_search_min_tools: 20
    tool_search_always_visible: 12
    tool_search_always_visible_tools:
      - read_file
      - glob
      - grep
      - tool_search
```

よく使うツールを常駐させ、残りのツールは `tool_search` によって動的にアンロックします。

## セキュリティ上の推奨事項

- 外部 MCP には、信頼できるサービスだけを接続する。
- リモート MCP は必ず認証する。
- 高リスクのツールをコンテキストに常駐させない。
- 外部 MCP のファイルシステムとコマンド実行の能力は、個別に評価する。
- 外部 MCP を変更した後は、監査ログを確認する。

## デバッグ

調査の順序：

1. `/api/external-mcp/stats` で状態を確認する。
2. サービスログを確認する。
3. stdio のコマンドを単独で実行する。
4. curl で HTTP/SSE のアドレスをテストする。
5. ツールがロールまたは tool_search のポリシーによって隠されていないか確認する。

## MCP のライフサイクル

外部 MCP のライフサイクルは、単純な「URL を追加する」ものではありません。

1. 設定の登録：名前、種類、コマンドまたは URL、環境変数。
2. 接続の起動：stdio ではプロセスを起動し、HTTP/SSE ではクライアントを確立する。
3. ツール一覧の取得：ツール名、説明、schema がプラットフォームに取り込まれる。
4. エージェントへの公開：ロール、tool_search、HITL の影響を受ける。
5. ツールの実行：パラメーターの検証、呼び出し、監視の記録。
6. 接続の復旧：プロセスの終了やネットワーク障害の後、復旧を試みる。
7. 停止/削除：ランタイムと設定から削除される。

トラブルシューティングでは、どの段階で止まっているかを確認する必要があります。

## ツール命名規則

ツール名は次の条件を満たすべきです。

- 安定していること。
- 小文字または snake_case であること。
- 動作と対象を表していること。
- 組み込みツールと名前が重複しないこと。

推奨されない例：

```text
run
execute
scan
tool1
```

推奨される例：

```text
burp_send_to_repeater
asset_lookup_domain
cloud_list_public_buckets
```

良いツール名は、tool_search のヒット率を高め、誤呼び出しも減らします。

## 外部 MCP のセキュリティレビューチェックリスト

接続する前に、次の点を確認します。

- ローカルマシンのファイルを読み書きできるか。
- コマンドを実行できるか。
- どのネットワークにアクセスするか。
- リクエストをサードパーティに送信するか。
- ツールの説明は信頼できるか。
- 出力に prompt injection が含まれる可能性はないか。
- 独立した実行ユーザーまたはコンテナによる分離が必要か。

答えが不明確なものは、本番環境の常駐ツールプールに入れないでください。

## ソースコードのアンカー

- 外部 MCP Manager：`internal/mcp/external_manager.go`
- 接続の復旧：`internal/mcp/connection_recovery.go`
- MCP ツールのアダプター：`internal/agentruntime/mcp_tools.go`
- 外部 MCP Handler：`internal/handler/external_mcp.go`
- ツール呼び出しの通知：`internal/agentruntime/tool_invoke_notify.go`
