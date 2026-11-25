# セキュリティ強化ガイド

[English](../en-US/security-hardening.md)

本書では、CyberStrikeAI の本番稼働前および継続運用中のセキュリティ強化チェックリストを示します。

## 本番稼働前に必ず行うこと

- 初回デプロイ後、直ちに `admin` の初期パスワードを変更します（Web 画面、またはプラットフォーム権限 → ユーザー管理）。
- HTTPS を使用するか、信頼できるリバースプロキシの背後に配置します。
- アクセス元 IP、VPN、または踏み台サーバー経由のアクセスに制限します。
- `audit.enabled` を有効にします。
- C2 が不要な場合は `c2.enabled: false` を設定します。
- 強力な認証とネットワーク分離を設定しない限り、独立した HTTP MCP を公開しません。
- 外部 MCP は信頼できるサービスのみを接続します。
- `config.yaml`、`data/`、カスタムリソースディレクトリをバックアップします。

## リバースプロキシの推奨設定

Nginx のベースライン：

```nginx
client_max_body_size 200m;
proxy_buffering off;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

追加で次の設定を推奨します。

```nginx
add_header X-Content-Type-Options nosniff;
add_header Referrer-Policy no-referrer;
add_header X-Frame-Options DENY;
```

## HITL ホワイトリストのベースライン

推奨される最小のホワイトリスト：

```yaml
hitl:
  tool_whitelist:
    - read_file
    - glob
    - grep
    - tool_search
```

デフォルトで追加しないもの：

- `execute`
- WebShell の書き込み/実行ツール
- C2 のタスクおよび payload ツール
- 外部 MCP の高リスクなツール
- 削除、書き込み、アップロード、永続化に関連するツール

## ファイル権限

推奨事項：

```bash
chmod 600 config.yaml
chmod 700 data
```

本番環境では、専用のシステムユーザーで実行します。

```text
cyberstrike-ai:cyberstrike-ai
```

低いポートへのバインドや特殊なリソースへのアクセスが明確に必要な場合を除き、root での実行は避けてください。

## 外部 MCP のレビュー

接続前に次を確認します。

- ツールがコマンドを実行できるか。
- ローカルファイルを読み書きできるか。
- データをサードパーティに送信するか。
- 独自の認証があるか。
- 信頼できない Web ページやモデルのコンテンツを返す可能性があるか。
- コンテナによる分離が必要か。

接続後：

- 高リスクなツールはホワイトリストに入れません。
- ツール一覧の変更を定期的に確認します。
- 設定変更を監査します。

## C2 と WebShell

C2：

- デフォルトでは無効にします。
- 演習の期間中のみ一時的に有効にします。
- Listener のポートと管理用ポートを分離します。
- 終了後に payload、session、task、event をクリーンアップします。

WebShell：

- 認可されたターゲットのみを保存します。
- わかりやすい名前を付けます。
- 書き込み/削除/実行には承認が必須です。
- プロジェクト終了時に接続を削除します。

## データ保持

推奨事項：

- 監査：30〜90 日。
- ツール監視：90〜180 日。
- アップロードされた添付ファイル：プロジェクト終了時にクリーンアップ。
- C2/WebShell の出力：レポートに必要な証拠のみを保持。
- ナレッジベース：実際の認証情報や顧客の機密データを入れない。

## 定期点検

毎週：

- ログイン失敗と異常な IP。
- 設定変更。
- 外部 MCP の追加・削除・変更。
- 長時間実行されているツール。
- C2 が意図せず有効になっていないか。
- WebShell の接続が期限切れになっていないか。
- ディスク容量とデータベースのサイズ。

各プロジェクトの終了時：

- 一時的な workspace をクリーンアップします。
- 不要な添付ファイルを削除します。
- 必要な証拠をアーカイブします。
- 期限切れの WebShell/C2 リソースを削除します。
- 監査記録をエクスポートします。
