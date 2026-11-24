# 設定プロファイル

[English](../en-US/configuration-profiles.md) | [中文](../zh-CN/configuration-profiles.md)

本書では、よく使われる設定プロファイルをいくつか紹介します。これらは完全な `config.yaml` ではなく、デプロイ時にセキュリティと可用性に最も影響しやすい主要セクションです。

## ローカル開発プロファイル

目的：デバッグしやすくし、より多くのローカル機能を許可します。

よく使う起動方法：

```bash
chmod +x run.sh && ./run.sh
```

```yaml
server:
  host: 127.0.0.1
  port: 8080
  tls_enabled: true
  tls_auto_self_sign: true
auth:
  session_duration_hours: 12
audit:
  enabled: true
  retention_days: 7
c2:
  enabled: false
multi_agent:
  enabled: true
  skills:
    filesystem_tools: true
```

適している用途：

- ローカルでの機能開発。
- フロントエンドと Handler のデバッグ。
- Skills、ローカルファイルツールのデバッグ。

適していない用途：

- 複数人での共有。
- インターネットからのアクセス。

## イントラネットチーム向けプロファイル

目的：チームで共有し、監査を保持し、高リスクの機能を制限します。

```yaml
server:
  host: 127.0.0.1
  port: 8080
  tls_enabled: false
auth:
  session_duration_hours: 12
audit:
  enabled: true
  retention_days: 30
monitor:
  retention_days: 90
c2:
  enabled: false
mcp:
  enabled: false
hitl:
  default_reviewer: human
  tool_whitelist: [read_file, glob, grep, tool_search]
```

併用するもの：

- Nginx/Traefik での HTTPS 終端。
- リバースプロキシでの IP ホワイトリスト。
- `data/` の定期バックアップ。

## ナレッジベースのみ有効にするプロファイル

目的：CyberStrikeAI をナレッジ拡張アシスタントとして使用し、攻撃面を可能な限り閉じます。

```yaml
c2:
  enabled: false
mcp:
  enabled: false
knowledge:
  enabled: true
  base_path: knowledge_base
  retrieval:
    top_k: 5
    similarity_threshold: 0.4
multi_agent:
  skills:
    filesystem_tools: false
```

推奨事項：

- ロールにはナレッジベースと読み取り専用ツールのみをバインドします。
- 外部 MCP を無効にします。
- 実際の顧客の機密資料を保存しません。

## 高監査の本番プロファイル

目的：本番のレッドチーム、または長期運用のセキュリティプラットフォーム。

```yaml
auth:
  session_duration_hours: 8
audit:
  enabled: true
  retention_days: 90
  max_detail_bytes: 8192
monitor:
  retention_days: 180
hitl:
  default_reviewer: human
  retention_days: 180
  tool_whitelist: [read_file, glob, grep, tool_search]
c2:
  enabled: false
agent_runtime:
  engine: pi
```

併用するもの：

- リバースプロキシでの認証。
- 独立した実行ユーザー。
- ログ収集。
- バックアップの暗号化。
- プロジェクト終了時のクリーンアップ手順の明確化。

## C2 演習プロファイル

目的：認可された演習の期間中のみ、C2 を一時的に有効にします。

```yaml
c2:
  enabled: true
hitl:
  default_reviewer: human
  tool_whitelist: [read_file, glob, grep, tool_search]
audit:
  enabled: true
monitor:
  retention_days: 180
```

運用上の要件：

- 演習前に認可範囲を確認します。
- Listener のポートと Web 管理ポートを分離します。
- 演習終了後に C2 クリーンアップ Runbook を実行します。
- 終了後に `c2.enabled: false` に戻します。

## 外部 MCP 自動化プロファイル

目的：信頼できる社内ツールサービスを接続します。

```yaml
external_mcp:
  servers: {}
multi_agent:
  runtime:
    tool_search_enable: true
    tool_search_min_tools: 20
hitl:
  default_reviewer: audit_agent
  tool_whitelist: [read_file, glob, grep, tool_search]
```

推奨事項：

- すべての MCP ツールに schema を明記します。
- 高リスクの MCP ツールはホワイトリストに入れません。
- stdio MCP には独立した作業ディレクトリを使用します。
- HTTP MCP には必ず認証を設定します。

## プロファイル選択の判断

| 要件 | 選択 |
| --- | --- |
| 個人での開発 | ローカル開発プロファイル |
| 複数人でのイントラネット利用 | イントラネットチーム向けプロファイル |
| ドキュメント／ナレッジの Q&A | ナレッジベースのみ有効にするプロファイル |
| 長期運用の本番プラットフォーム | 高監査の本番プロファイル |
| 認可された C2 演習 | C2 演習プロファイル |
| 社内ツールプラットフォームとの接続 | 外部 MCP 自動化プロファイル |
