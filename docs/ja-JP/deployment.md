# デプロイガイド

[English](../en-US/deployment.md)

本書では、CyberStrikeAI の一般的なデプロイ方法を説明します。本番環境にデプロイする前に、[セキュリティモデル](security-model.md) を読み、認可された範囲、認証、HITL、監査、高リスク機能のスイッチを確認してください。

## デプロイ前の準備

基本的な依存関係：

- Go：ソースからの実行またはバイナリのビルドに使用します。
- Python：一部の MCP サービスやツールスクリプトで Python 実行環境が必要です。
- SQLite：デフォルトではファイル型データベースを使用するため、別途サービスは不要です。
- セキュリティツール：`tools/` 内の YAML はツール定義にすぎません。`nmap`、`sqlmap`、`nuclei` などの実際のコマンドは、システムの PATH にインストールしておく必要があります。
- モデルサービス：`ai.channels` のチャネルを少なくとも 1 つ設定してください。`provider: openai_compatible` は OpenAI 互換 API 向け、`provider: claude` は Pi ネイティブの Claude コンポーネントを使用します。

推奨ディレクトリ：

```text
CyberStrikeAI-main/
  config.yaml
  data/
  tools/
  roles/
  skills/
  agents/
  knowledge_base/
```

`data/`、`config.yaml`、およびカスタマイズした `tools/roles/skills/agents/knowledge_base` は最も重要な永続化対象であり、アップグレード前にバックアップしてください。

## クイックスタート

リポジトリには `run.sh` が用意されており、ローカルでの試用や小規模なデプロイに適しています。

```bash
chmod +x run.sh && ./run.sh
```

デフォルト設定では `server.tls_enabled: true`、`tls_auto_self_sign: true` であり、アクセス先は通常次のとおりです。

```text
https://127.0.0.1:8080/
```

自己署名証明書はブラウザーのセキュリティ警告を引き起こしますが、ローカルテストでは正常な現象です。本番環境では正規の証明書を設定することを推奨します。

自動生成された証明書と秘密鍵は、設定ディレクトリ配下の `data/tls/self-signed.pem` に保存され、以降の起動とワンクリックアップデートでも再利用されます。メモリ上の自己署名版から初めてアップグレードしたときは、新しい証明書が生成されます。ローテーションが必要な場合は、まずサービスを停止してこのファイルを移動してください。次回の起動時に新しい証明書が生成されます。

`run.sh` は最もよく使われる起動の入口で、次の用途に適しています。

- ローカルでの試用。
- 開発とデバッグ。
- 小規模チームによる一時的な社内ネットワークでの利用。
- アップグレード後に、新バージョンが起動できるかを素早く検証する場合。

長期運用、起動時の自動開始、ログの管理、プロセスのクラッシュ時の自動復旧が必要な場合は、systemd でバイナリを管理することを推奨します。

## ソースからの実行

開発とデバッグに適しています。

```bash
go run ./cmd/server --config config.yaml
```

依存関係のダウンロードが遅い場合は、先に Go のプロキシを設定できます。

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

## バイナリのビルド

```bash
go build -o cyberstrike-ai ./cmd/server
./cyberstrike-ai --config config.yaml
```

バイナリを配布する際も、次のものを同梱する必要があります。

- `web/static/`
- `tools/`
- `roles/`
- `skills/`
- `agents/`
- `config.yaml`

## HTTPS

ローカルテストでは自己署名を使用できます。

```yaml
server:
  tls_enabled: true
  tls_auto_self_sign: true
```

本番環境では証明書ファイルの使用を推奨します。

```yaml
server:
  host: 0.0.0.0
  port: 8080
  tls_enabled: true
  tls_cert_path: /etc/letsencrypt/live/example.com/fullchain.pem
  tls_key_path: /etc/letsencrypt/live/example.com/privkey.pem
```

TLS を有効にすると、同じポートへの HTTP リクエストはデフォルトで 308 により HTTPS へリダイレクトされます。前段のリバースプロキシが TLS を担当する場合は、アプリ内の TLS を無効にして、プロキシ層で HTTPS を処理できます。

## リバースプロキシ

Nginx の例：

```nginx
server {
    listen 443 ssl http2;
    server_name cyberstrike.example.com;

    ssl_certificate /etc/letsencrypt/live/cyberstrike.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cyberstrike.example.com/privkey.pem;

    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
    }
}
```

`proxy_buffering off` は、SSE のストリーミング出力と WebSocket ターミナルに適しています。

## systemd

サービスの例：

```ini
[Unit]
Description=CyberStrikeAI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/CyberStrikeAI
ExecStart=/opt/CyberStrikeAI/cyberstrike-ai --config /opt/CyberStrikeAI/config.yaml
Restart=on-failure
RestartSec=5
Environment=GIN_MODE=release

[Install]
WantedBy=multi-user.target
```

有効化：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cyberstrikeai
sudo journalctl -u cyberstrikeai -f
```

## データとバックアップ

重点的にバックアップする対象：

- `config.yaml`
- `data/conversations.db`
- `data/knowledge.db`
- `data/pi-sessions/`
- カスタマイズした `tools/roles/skills/agents/knowledge_base`
- アップロードファイルのディレクトリ `chat_uploads/`

SQLite のホットバックアップは、事前にサービスを停止するのが望ましく、少なくとも `*.db`、`*.db-wal`、`*.db-shm` の 3 種類のファイルをコピーしてください。

## アップグレード

**まずプラットフォーム標準の「ワンクリックアップデート」を使用してください**（コンソールの「システム設定 → ワンクリックアップデート」、`POST /api/system/update/apply`、
またはコマンドラインの `./cyberstrike-ai -update`）。これは**更新ソースリポジトリ**（デフォルトは公式リポジトリ
`https://github.com/AIPentest/CyberStrikeAI.git` で、1 か所の設定で自前の派生版やミラーに変更できます）から、そのリポジトリのデフォルトブランチの
最新コードを取得します。処理の流れは、fetch → ファストフォワードマージ → `go build` → バイナリのアトミックな差し替え（古いものは `cyberstrike-ai.prev` として残ります）で、さらに
`roles/ skills/ tools/ agents/ knowledge_base/ data/ config.yaml` などの運用者のコンテンツをいったん退避してから元に戻し、結果にはどのファイルを
保持したかが明記されます。ローカルのソースに変更がある場合や、ローカルの履歴が更新ソースと分岐している場合は、強行せず、理由を説明して拒否します。
ビルドに失敗した場合や、このマシンに Go ツールチェーンがない場合でも、ソースは更新され、バイナリはそのまま維持されます。ビルド未完了の状態はインストールディレクトリ（`.update-build-pending`）に記録され、
ページに表示されます。Go をインストールしたあとでもう一度「ワンクリックアップデート」をクリックすれば、ビルドが補完されます。
詳細は [開発者ガイド](developer-guide.md) の「ワンクリックアップデート」の節を参照してください。

macOS/Linux では、設定ファイルと同じディレクトリの `cyberstrike-ai` から起動している場合、「ワンクリックアップデート」をクリックすると、ビルドが成功した時点でコンソールが自動的に新しいバイナリへ切り替わります。
ビルド中は古いサービスが引き続き稼働します。切り替え時には接続が一時的に途切れ、ページは新しいサービスが応答した後に自動でリロードされ、まだ有効なログインセッションを引き継ぎます。
この手順は systemd や launchd に依存しません。長期的なデプロイでは、起動時の自動開始と異常時の復旧のために、引き続きデーモンプロセスの利用を推奨します。API やコマンドラインでバイナリを
入れ替えた場合は、自動切り替えに対応したインストールで、コンソールの「今すぐ再起動」を使ってディスク上のバージョンを有効にできます。

更新ソースは `config.yaml` の `update` セクションにある**1 つのリポジトリアドレス**（`repo`）で、コンソールの「ワンクリックアップデート」ページで直接入力して保存することもできます。
公式リポジトリ、自前の派生版、他者の派生版、ミラーのいずれに追従する場合でも、変更するのはこの 1 か所だけです。未設定の場合は公式リポジトリになります。**Release パッケージを展開してインストールし、
ディレクトリに git がない場合**は、同じページで「プレビューして接続」をクリックしてください（未設定でもデフォルトの公式リポジトリで使用できます）。プレビューでは、対象バージョンで置き換えられる
ファイルと保持される運用者のコンテンツが先に一覧表示され、置き換えられるものはすべて `.update-backup/<一意のバックアップディレクトリ>/overwritten/` にバックアップされます。確認後、そのディレクトリはワンクリックで
更新できる通常のインストールになります。

`upgrade.sh` は引き続き利用できます。現在は、この実装の薄いラッパーにすぎず、インストール形態に応じて 2 つの経路に分かれます。

- **このディレクトリが git ワークツリーの場合**：`./cyberstrike-ai -update` を直接呼び出します（バイナリがまだない場合は、先に
  `go build -o cyberstrike-ai ./cmd/server` してから更新します。どちらもなければ、Go のインストール方法を示してエラーにします）。
  `--check` は確認のみで変更を加えず、`-check-update` を使用します。
- **このディレクトリが git ワークツリーではない場合**（Release tarball によるインストール）：従来の「Release パッケージのダウンロード + `rsync --delete`」の経路にフォールバックします。
  このとき、ソースリポジトリは `--repo owner/name` または環境変数 `GITHUB_REPO` から取得され、どちらも指定されていない場合にのみ組み込みのデフォルト値が使われ、
  コードがどのリポジトリから取得されるかを示す警告が 1 行出力されます。`config.yaml`、`data/`、`tools/`、`roles/`、`skills/`、
  `agents/`、`venv/`（`--no-venv` で無効化可能）、およびロールバックポイントの `.update-backup/`、`.update-state.json`、
  `cyberstrike-ai.prev` はいずれも rsync の保持リストに入っており、`--delete` で巻き添えに削除されることはありません。

推奨フロー：

1. サービスを停止する。
2. `config.yaml`、`data/`、カスタマイズしたディレクトリをバックアップする。
3. 新バージョンのコード／バイナリを取得または置き換える。
4. 元の設定を保持し、新バージョンの `config.yaml` のサンプルに従って追加されたフィールドを補う。
5. サービスを起動し、ログイン、モデルテスト、ツール一覧、ナレッジベースの状態を確認する。

ワンクリックアップデートが行うのは 3（および必要に応じたバイナリの差し替え）だけで、1/2/4/5 は引き続き運用者の判断です。データベーススキーマの変更は、バイナリを入れ替えただけでは
自動的に互換になりません。`upgrade.sh` は互換性の問題がない場合の素早いアップグレードに適していますが、本番環境ではやはりバックアップしてから実行することを推奨します。
Python の依存関係については、`venv/` は `run.sh` が自動的に作成・管理するため、残しておけばアップグレードで消されることはありません。`--no-venv` を使った場合のみ削除され、
`run.sh` によって再インストールされます。

## ロールバック

ワンクリックアップデートにはロールバックポイントが付属しています。`./cyberstrike-ai -update-rollback` またはページ上のロールバックボタンにより、そのアップデート前のコミットに戻し、
`cyberstrike-ai.prev` を元の場所に戻します。これは「HEAD がそのアップデートで書き込まれたコミットのままである」場合にのみ実行されるため、その後の作業が巻き添えで消されることはありません。
退避されていた内容も `.update-backup/<一意のバックアップディレクトリ>/` に残ります。

これ以外に、ロールバック時には次のものも併せて復元します。

- 前バージョンのバイナリまたはコード。
- アップグレード前の `config.yaml`。
- アップグレード前の `data/`。

新バージョンがすでにデータベーススキーマの変更を書き込んでいる場合、バイナリだけをロールバックしても不十分なことがあるため、バックアップ全体の復元を推奨します。

## 本番デプロイの判断表

| シナリオ | 推奨デプロイ | 主な設定 | 非推奨 |
| --- | --- | --- | --- |
| 個人のローカルテスト | `./run.sh` + 自己署名 HTTPS | `tls_auto_self_sign: true` | インターネットへの公開 |
| 小規模チームの社内ネットワーク | バイナリ + systemd + 社内ネットワークの HTTPS | 強力なパスワード、監査、バックアップ、接続元 IP の制限 | 全員で弱いパスワードを共有すること |
| 本番のレッドチームプラットフォーム | リバースプロキシ + 専用の実行ユーザー + ログ収集 | 正規の証明書、リバースプロキシでの認証、C2 は必要時のみ有効化 | Web 管理画面をインターネットへ直接公開 |
| ナレッジベース／会話のみ利用 | C2 を無効化し、不要な外部 MCP を無効にする | `c2.enabled: false` | デフォルトで高リスクのモジュールをすべて有効にすること |
| 複数ツールの自動化 | 独立した作業ディレクトリ + HITL + ツールのホワイトリスト | `workspace_root_dir`、`hitl`、`monitor` | Agent にグローバルな Shell 権限を承認なしで与えること |

## ランタイムファイルの階層

デプロイで最も問題が起きやすいのは「コード、設定、ランタイムデータが混在している」ことです。次のように整理して理解することを推奨します。

- 置き換え可能：バイナリ、`web/`、デフォルトの `tools/roles/skills/agents/docs`。
- 保持が必須：`config.yaml`、`data/`、カスタマイズしたツール／ロール／スキル／サブエージェント、`knowledge_base/`、`chat_uploads/`。
- `data/pi-sessions/` はセッションデータであり、データベースと併せてバックアップし、会話の削除の仕組みを通じて整理する必要があります。キャッシュとして直接削除してはいけません。一時的な workspace、古い payload、ツールの記録は、保持ポリシーに従って処理されます。

アップグレード時にディレクトリ全体を上書きする場合は、先にカスタマイズしたディレクトリと `data/` を退避またはバックアップしてください。「アップグレード後に設定が消えた」という問題の多くは、本質的には、ランタイムの状態ファイルをリリースパッケージの一部とみなして上書きしてしまったことが原因です。

## 起動後の受け入れチェックリスト

起動に成功したことは、使えることを意味しません。少なくとも次の点を確認してください。

1. `/` を開き、HTTPS／リバースプロキシでリダイレクトのループが発生していないことを確認する。
2. ログイン後に `/api/auth/validate` へアクセスし、セッションが利用可能であることを確認する。
3. システム設定でモデルテストを実行する。
4. ツール一覧を開き、`tools/` が読み込まれ、主要ツールの schema が正常であることを確認する。
5. ナレッジベースを有効にしている場合は、ナレッジベースのページを開き、`index-status` が正常であることを確認する。
6. 外部 MCP を有効にしている場合は、外部 MCP の状態を確認し、そのツールが会話側に表示されているかを確認する。
7. C2 を有効にしている場合は、認可されたネットワーク内でのみテスト用の listener を 1 つ起動し、停止／削除が正常に動作することを確認する。
8. 監査ページを開き、ログインと設定の読み取りが記録されていることを確認する。

## リバースプロキシで陥りやすい落とし穴

- SSE がバッファリングされる：Agent がずっと出力せず、終了時に一度にまとめて出力される症状として現れます。`proxy_buffering` を無効にしてください。
- WebSocket の失敗：ターミナルやイベントストリームが異常になります。`Upgrade` ヘッダーと `Connection` ヘッダーを確認してください。
- HTTPS の混在：アプリ内の TLS と Nginx の TLS を同時に有効にした場合、`proxy_pass` のプロトコルを一致させる必要があります。
- アップロードの失敗：`client_max_body_size` を大きくし、アプリ側のアップロード制限も確認してください。
- 308 ループ：アプリが同一ポートでの HTTPS リダイレクトを有効にしている一方で、プロキシがオリジンへ HTTP でアクセスしている場合は、アプリの TLS を無効にするか、プロキシのオリジンへのアクセスを HTTPS に変更する必要があります。

## ソースコードのアンカー

- サービスの組み立てとルーティング：`internal/app/app.go`
- HTTPS と自己署名証明書：`internal/app/main_server_tls.go`
- HTTP から HTTPS へのリダイレクト：`internal/app/main_server_http_redirect.go`
- 設定の構造とデフォルト値：`internal/config/config.go`
- 設定の適用ロジック：`internal/handler/config.go`
