<div align="center">
  <img src="images/logo.png" alt="CyberStrikeAI Logo" width="200" >
</div>

# CyberStrikeAI


[English](README.md) | [日本語](README_JA.md)

**AI ネイティブなサイバーセキュリティのための実行基盤 ―― 意図は統制された実行に、証拠は運用の記憶になり、あらゆるオペレーションが次のオペレーションを改善します。**

CyberStrikeAI は、計画、実行、人による監督、証拠、振り返りを、監査可能な 1 つのワークスペースにつなぎます。Go で構築されており、Pi ベースのエージェント、MCP ネイティブのツール、RAG ナレッジ、ビジュアルワークフロー、攻撃チェーンのモデリングと分析を組み合わせ、許可されたセキュリティ業務を支援します。

**まずはこちら：** [クイックスタート](#クイックスタートワンコマンドデプロイ) · [ドキュメント](docs/ja-JP/README.md) · [セキュリティ強化](docs/ja-JP/security-hardening.md)

> [!IMPORTANT]
> CyberStrikeAI は、自身が所有するシステム、またはテストの明示的な許可を得たシステムに対してのみ使用してください。共有環境や本番環境では、高リスクのツール、WebShell、C2 の機能を有効にする前に、[セキュリティモデル](docs/ja-JP/security-model.md)と[セキュリティ強化ガイド](docs/ja-JP/security-hardening.md)を確認してください。

## 画面と連携のプレビュー

<div align="center">

### システムダッシュボードの概要

<table>
<tr>
<td width="50%" align="center">
<strong>ライトモード</strong><br/>
<img src="./images/dashboard.png" alt="システムダッシュボード（ライト）" width="100%">
</td>
<td width="50%" align="center">
<strong>ダークモード</strong><br/>
<img src="./images/dark.png" alt="システムダッシュボード（ダーク）" width="100%">
</td>
</tr>
</table>

*ダッシュボードでは、システムの稼働状況、セキュリティ脆弱性、ツールの利用状況、ナレッジベースを俯瞰でき、プラットフォームの中核機能と現在の状態をすばやく把握できます。*

<details>
<summary><strong>その他の画面スクリーンショット</strong></summary>

### 主な機能の概要

<table>
<tr>
<td width="33.33%" align="center">
<strong>Web コンソール</strong><br/>
<img src="./images/web-console.png" alt="Web コンソール" width="100%">
</td>
<td width="33.33%" align="center">
<strong>タスク管理</strong><br/>
<img src="./images/task-management.png" alt="タスク管理" width="100%">
</td>
<td width="33.33%" align="center">
<strong>脆弱性管理</strong><br/>
<img src="./images/vulnerability-management.png" alt="脆弱性管理" width="100%">
</td>
</tr>
<tr>
<td width="33.33%" align="center">
<strong>WebShell 管理</strong><br/>
<img src="./images/webshell-management.png" alt="WebShell 管理" width="100%">
</td>
<td width="33.33%" align="center">
<strong>MCP 管理</strong><br/>
<img src="./images/mcp-management.png" alt="MCP 管理" width="100%">
</td>
<td width="33.33%" align="center">
<strong>ナレッジベース</strong><br/>
<img src="./images/knowledge-base.png" alt="ナレッジベース" width="100%">
</td>
</tr>
<tr>
<td width="33.33%" align="center">
<strong>Skills 管理</strong><br/>
<img src="./images/skills.png" alt="Skills 管理" width="100%">
</td>
<td width="33.33%" align="center">
<strong>エージェント管理</strong><br/>
<img src="./images/agent-management.png" alt="エージェント管理" width="100%">
</td>
<td width="33.33%" align="center">
<strong>ロール管理</strong><br/>
<img src="./images/role-management.png" alt="ロール管理" width="100%">
</td>
</tr>
<tr>
<td width="33.33%" align="center">
<strong>システム設定</strong><br/>
<img src="./images/settings.png" alt="システム設定" width="100%">
</td>
<td width="33.33%" align="center">
<strong>MCP stdio モード</strong><br/>
<img src="./images/mcp-stdio2.png" alt="MCP stdio モード" width="100%">
</td>
<td width="33.33%" align="center">
<strong>Burp Suite プラグイン</strong><br/>
<img src="./images/plugins.png" alt="Burp Suite プラグイン" width="100%">
</td>
</tr>
</table>

</details>

</div>

## 主な特長

### エージェントとオーケストレーション

- 🤖 **エージェントによる実行**：自然言語の意図を、統制され監査可能なセキュリティアクションに変換します。
- 🧩 **Pi オーケストレーション**：単一エージェントの実行に加え、Deep、Plan-Execute、Supervisor のマルチエージェントモードに対応します。
- 🔀 **グラフワークフロー**：エージェント、ツール、条件、承認、出力を組み合わせて再利用可能なフローにします。
- 🎭 **ロールベースのテスト**：一般的なセキュリティシナリオ向けに、目的を絞ったプロンプトとツールポリシーを提供します。

### ツールとナレッジ

- 🧰 **セキュリティツール**：厳選した 100 以上の YAML レシピを同梱し、カスタム拡張とロール単位のアクセス制御に対応します。
- 🔌 **MCP 連携**：HTTP、stdio、SSE、外部フェデレーション、動的なツール検出に対応します。
- ⏱️ **堅牢なツール実行**：ブロッキングする MCP/ツール呼び出しをワーカーで実行し、エージェントの待機時間の上限、再開可能な `execution_id` ポーリング、キャンセル、サーバー単位のサーキットブレーカー、同時実行数の制限、統一された出力上限を備えます。
- 🎯 **Agent Skills**：標準の Skill レイアウトに従い、段階的なオンデマンド読み込みに対応します。
- 📚 **ナレッジベース**：クエリの書き換え、ベクトル検索、リランキング、結果の後処理を組み合わせます。
- 🖼️ **ビジョン分析**：スクリーンショット、CAPTCHA、UI の解析に専用のビジョンモデルを使用し、保持するのはテキストの要約のみです。

### ガバナンスと監査

- 🧑‍⚖️ **ヒューマンインザループ**：承認モード、ツールのホワイトリスト、監査エージェントによるレビュー、追跡可能な判断を提供します。
- 🛡️ **呼び出しブロック**：「セキュリティ」配下の機能で、MCP の実行前に設定可能な正規表現チェック、リマインダーテンプレート、ドライランを追加します。政府ドメインの保護はデフォルトで有効です。[呼び出しブロックルール](docs/ja-JP/tool-call-guard.md)を参照してください。
- 🔐 **プラットフォーム RBAC**：複数ユーザー、システムロールとカスタムロール、スコープ付きの権限、所有権、明示的な割り当てに対応します。
- 🔒 **セキュリティと監査**：認証付きアクセス、監査ログ、SQLite による永続化、運用証拠の保持を提供します。
- 📄 **結果ガバナンス**：エージェントが見たものと同じ上限付きのツール結果を保存し、過大な過去の出力から再開経路を保護し、大きな詳細表示に対する UI 上の安全策を追加します。[ツール実行ガバナンス](docs/ja-JP/tool-execution-governance.md)を参照してください。

### セキュリティオペレーション

- 📁 **会話管理**：ピン留め、名前の変更、一括整理ができます。
- 📂 **プロジェクトと攻撃チェーン**：セッションをまたぐファクト、リスクスコアリング、グラフ表示、ステップごとのリプレイを結び付けます。
- 🗂️ **資産管理**：ドメイン、IP アドレス、ポート、サービスを正規化して重複を排除します。CSV のインポートとエクスポート、高度なフィルターと保存済みビュー、所有者と業務メタデータ、ページをまたぐ一括メンテナンス、重複のマージに対応し、スキャンのカバレッジ、関連する脆弱性、リスク状態を追跡します。[資産管理ガイド](docs/ja-JP/asset-management.md)を参照してください。
- 🛡️ **脆弱性管理**：深刻度の分類、ライフサイクルの追跡、フィルタリング、統計を提供します。
- 📋 **バッチタスク**：キューによる実行、編集、状態の追跡、結果の保持ができます。
- 📱 **チャットボット**：個人 WeChat、WeCom、DingTalk、Lark、Telegram、Slack、Discord、QQ Bot と接続します。

### 許可されたセキュリティオペレーション

- 🐚 **WebShell 管理**：接続管理、仮想ターミナル、ファイル操作、AI 支援のワークフローを提供します。
- 📡 **内蔵 C2**：リスナー、暗号化されたビーコン、セッション、タスクキュー、ペイロードの補助機能、ライブイベントを提供します。

> WebShell、C2、その他の高リスク機能は、自身が所有するシステム、またはテストの明示的な許可を得たシステムのためのものです。[セキュリティモデル](docs/ja-JP/security-model.md)と[セキュリティ強化ガイド](docs/ja-JP/security-hardening.md)を参照してください。

## プラグイン

CyberStrikeAI は、`plugins/` 配下に任意で利用できる連携機能を同梱しています。

- **Burp Suite 拡張機能**：`plugins/burp-suite/cyberstrikeai-burp-extension/`  
  ビルド成果物：`plugins/burp-suite/cyberstrikeai-burp-extension/dist/cyberstrikeai-burp-extension.jar`  
  ドキュメント：`plugins/burp-suite/cyberstrikeai-burp-extension/README.md`
- **ブラウザー拡張機能（Chrome / Edge）**：`plugins/browser-extension/cyberstrikeai-browser-extension/`  
  DevTools でネットワークトラフィックをキャプチャし、CyberStrikeAI に送信して AI 支援のセキュリティテストを行います。Burp プラグインと同じ使い勝手です。  
  インストール：`chrome://extensions/` → パッケージ化されていない拡張機能を読み込む → F12 → **CyberStrikeAI** タブ  
  パッケージ成果物：`plugins/browser-extension/cyberstrikeai-browser-extension/dist/cyberstrikeai-browser-extension.zip`  
  ドキュメント：`plugins/browser-extension/cyberstrikeai-browser-extension/README.md`

## ツールの概要

CyberStrikeAI は、キルチェーン全体をカバーする厳選した 100 以上のツールを同梱しています。

<details>
<summary><strong>ツールカテゴリの一覧を表示</strong></summary>

- **ネットワークスキャナー** – nmap, masscan, rustscan, arp-scan, nbtscan
- **Web・アプリケーションスキャナー** – sqlmap, nikto, dirb, gobuster, feroxbuster, ffuf, httpx
- **脆弱性スキャナー** – nuclei, wpscan, wafw00f, dalfox, xsser
- **サブドメイン列挙** – subfinder, amass, findomain, dnsenum, fierce
- **ネットワーク空間検索エンジン** – fofa_search, zoomeye_search, quake_search, shodan_search
- **API セキュリティ** – graphql-scanner, arjun, api-fuzzer, api-schema-analyzer
- **コンテナセキュリティ** – trivy, clair, docker-bench-security, kube-bench, kube-hunter
- **クラウドセキュリティ** – prowler, scout-suite, cloudmapper, pacu, terrascan, checkov
- **バイナリ解析** – gdb, radare2, ghidra, objdump, strings, binwalk
- **エクスプロイト** – metasploit, msfvenom, pwntools, ropper, ropgadget
- **パスワードクラッキング** – hashcat, john, hashpump
- **フォレンジック** – volatility, volatility3, foremost, steghide, exiftool
- **ポストエクスプロイト** – linpeas, winpeas, mimikatz, bloodhound, impacket, responder
- **CTF ユーティリティ** – stegsolve, zsteg, hash-identifier, fcrackzip, pdfcrack, cyberchef
- **システムヘルパー** – exec, create-file, delete-file, list-files, modify-file

</details>

ツールの定義、カスタマイズ、使用上の注意については [tools/README_JA.md](tools/README_JA.md)を参照してください。

## 基本的な使い方

### クイックスタート（ワンコマンドデプロイ）

**前提条件：**
- Go 1.25 以上（[インストール](https://go.dev/dl/)。`go.mod` の要件）
- Python 3.10 以上（[インストール](https://www.python.org/downloads/)）

**ワンコマンドデプロイ：**
```bash
git clone https://github.com/Ed1s0nZ/CyberStrikeAI.git
cd CyberStrikeAI
chmod +x run.sh && ./run.sh
```

`run.sh` スクリプトは次の処理を自動で行います。
- ✅ Go と Python の環境の確認と検証
- ✅ Python 仮想環境の作成
- ✅ Python 依存関係のインストール
- ✅ Go 依存関係のダウンロード
- ✅ プロジェクトのビルド
- ✅ サーバーの起動

**起動の確認：**

1. ターミナルに `● ONLINE` と、続けて実際の Web UI の URL が表示されることを確認します。
2. その URL を開きます。デフォルトの HTTPS モードはローカルの自己署名証明書を使用するため、ブラウザーの警告を一度だけ許可してください。
3. 新規インストールの場合は、`ADMIN SETUP REQUIRED` の下に表示される一度限りの `admin` パスワードを控え、サインインしてすぐに変更してください。

**ネットワークの既定動作：** `run.sh` は **`--https`** とリポジトリの **`config.yaml`** でサーバーを起動します（ローカルの自己署名 TLS。多数の同時ストリームに適しています）。平文の HTTP を使う場合は **`./run.sh --http`** を使用します。本番環境では、**`config.yaml`** の **`server.tls_cert_path`** / **`server.tls_key_path`** を設定してください（同ファイルのコメントを参照）。手動で実行する場合は **`--https`** または **`CYBERSTRIKE_HTTPS=1`** を指定します。**`-config`** が誤っている場合、バイナリは標準エラー出力に短い使用方法のヒントを表示します。

**初回設定：**
1. **AI チャネルの設定**（初回利用前に必須）
   - 起動後、**`https://127.0.0.1:8080/`**（または **`https://localhost:8080/`**。**8080** は `config.yaml` の `server.port` に読み替えてください）を開き、自己署名証明書の警告を一度だけ許可します。`./run.sh --http` を使用した場合は、代わりに **`http://`** を使用します。
   - `システム設定` → `基本設定` → `AI チャネル設定` を開き、チャネルを追加または編集して、プロバイダー、Base URL、API Key、モデル、トークン上限を入力します。**変更を保存** をクリックします。左側のチャネル一覧では、デフォルトの設定、コピー、削除、一括プローブができます。
     ```yaml
     ai:
       default_channel: openai-main
       channels:
         openai-main:
           name: OpenAI Main
           provider: openai_compatible
           api_key: "${OPENAI_API_KEY}"
           base_url: "https://api.openai.com/v1"  # または https://api.deepseek.com/v1
           model: "gpt-4o"  # または deepseek-chat、qwen3-max など
           max_total_tokens: 120000
           max_completion_tokens: 16384
     ```
   - または、起動前に `config.yaml` を直接編集します。`ai.default_channel` は、チャネルを明示的に選択していない新しい会話とタスクで使用されます。チャットページでは、セッションごとに保存済みの任意のチャネルを選択することもできます。
2. **ログイン** - 初回起動時、コンソールに自動生成された `admin` の初期パスワードが出力されます。アカウントは **プラットフォーム権限 → ユーザー管理** から作成します。
3. **セキュリティツールのインストール（任意）** - 必要に応じて `tools/` のツールをインストールします。見つからないツールは実行時にスキップされるか、代替されます。よくある例：

   **macOS（Homebrew）：**
   ```bash
   brew install nmap masscan sqlmap nikto gobuster ffuf hydra hashcat nuclei subfinder
   ```

   **Linux（Kali / Debian / Ubuntu）：**
   ```bash
   sudo apt update
   sudo apt install -y nmap masscan sqlmap nikto gobuster hydra hashcat john binwalk
   # 一部のディストリビューションでは、ffuf/nuclei/subfinder を go install または公式ドキュメントの手順でインストールします
   ```

   全一覧は `tools/` ディレクトリを参照してください。インストールの詳細は各ツールの公式ドキュメントを参照してください。

**その他の起動方法：**
```bash
# Go で直接実行（環境は自分で用意）。run.sh の既定動作に合わせるには --https を付けます
go run ./cmd/server --https

# 手動ビルド
go build -o cyberstrike-ai ./cmd/server
./cyberstrike-ai --https
```

サーバーログに `client sent an HTTP request to an HTTPS server` と表示される場合、クライアントが TLS 専用ポートに対してまだ **`http://`** を使用しています。URL を **`https://`** に切り替えてください。

**注：** Python 仮想環境（`venv/`）は `run.sh` が自動的に作成・管理します。Python を必要とするツール（`api-fuzzer`、`http-framework-test` など）は、この環境を自動的に使用します。

### アップグレードと互換性

**プラットフォーム自身のワンクリックアップデートを優先してください**（コンソールの システム設定 → ワンクリックアップデート、または
`./cyberstrike-ai -update` / `-check-update` / `-update-rollback`）。**アップデート元リポジトリ**の
デフォルトブランチの最新コミットを取得し（デフォルトは公式リポジトリ。設定 1 つで自分のフォークやミラーに
向けられます）、fast-forward して再ビルドし、バイナリをアトミックに入れ替えます。
`roles/skills/tools/agents/data/config.yaml` には手を加えません（結果には保持したすべてのファイル名が表示されます。
`config.yaml` の `version` フィールドだけが新しいコードに同期されるため、ヘッダーのバッジと一致します）。
ソースがローカルで変更されている場合や、ローカルの履歴が分岐している場合は、上書きせずに拒否します。
[デプロイガイド](docs/ja-JP/deployment.md)を参照してください。

`upgrade.sh` も引き続き使用できます。このディレクトリが git の作業ツリーである場合は、上記コマンドの
薄いシェルラッパーとして動作します。git を使わない（tarball の）インストールの場合のみ、従来の「GitHub Release を
ダウンロードして rsync で反映する」経路にフォールバックします。このときソースリポジトリは `--repo owner/name` または
`GITHUB_REPO` から決まり、どちらも指定がない場合にのみ組み込みのデフォルトが適用されます（リポジトリ名を示す警告付き）。

アップデート元は 1 つの設定で、`config.yaml` の `update` セクション、またはコンソールのページで
リポジトリのアドレスを指定します。公式リポジトリ、自分のフォーク、他者のフォークのいずれも指定できます。
Release アーカイブから展開した（git のない）インストールも、同じページでプレビューして接続でき、
以降はワンクリックでアップデートできます。

**CyberStrikeAI のアップグレードスクリプト：**
1. （初回のみ）スクリプトを有効にします：`chmod +x upgrade.sh`
2. 次のコマンドでアップグレードします：`./upgrade.sh`（任意のフラグ：`--check`、`--tag vX.Y.Z`、`--repo owner/name`、`--no-venv`、`--yes`）。ローカルの `tools/`、`roles/`、`skills/`、`agents/` は常に保持されます。
3. スクリプトは `config.yaml` と `data/` をバックアップし、コードをアップグレードして、`config.yaml` の `version` を更新したうえでサーバーを再起動します。

推奨のワンライナー：
`chmod +x upgrade.sh && ./upgrade.sh --yes`

問題が発生した場合：git の作業ツリー内では `./cyberstrike-ai -update-rollback` を実行するだけです
（そのアップデートの前に保持していたコミットとバイナリに戻ります）。tarball インストールの場合は
`.upgrade-backup/` から復元し（または `data/` と `config.yaml` を手動でコピーして戻し）、`./run.sh` を再度実行します。

要件とヒント（tarball 経路のみ）：
* Release パッケージのダウンロードに `curl` または `wget` が必要です。
* コードを安全に同期するため、`rsync` を推奨します（実質的に必須です）。
* GitHub API のレート制限を受ける場合は、`./upgrade.sh` を実行する前に `export GITHUB_TOKEN="..."` を設定してください。

⚠️ **アップグレードの前に：** 対象リリースのリリースノートで、設定、データベース、API の変更を確認してください。パッチアップグレードでもバックアップは必須です。バージョン番号だけでは互換性は保証されません。


## 設定

[`config.example.yaml`](config.example.yaml) を設定テンプレートの正とし、環境に必要な値だけをコピーしてください。最低限、サーバーと AI チャネルを 1 つ設定します。

```yaml
server:
  host: "127.0.0.1"
  port: 8080
ai:
  default_channel: openai-main
  channels:
    openai-main:
      provider: openai_compatible
      api_key: "${OPENAI_API_KEY}"
      base_url: "https://api.openai.com/v1"
      model: "your-model"
```

`openai` は後方互換のための実行時フィールドです。新しいモデル設定は `ai.channels` で管理してください。実際の認証情報をコミットしないでください。サービスを localhost の外に公開する前に、[設定リファレンス](docs/ja-JP/configuration.md)、[推奨プロファイル](docs/ja-JP/configuration-profiles.md)、[セキュリティ強化ガイド](docs/ja-JP/security-hardening.md)を確認してください。

## 関連ドキュメント

- **初めての方：** [デプロイ](docs/ja-JP/deployment.md) → [設定](docs/ja-JP/configuration.md) → [トラブルシューティング](docs/ja-JP/troubleshooting.md)
- **運用担当者：** [設定プロファイル](docs/ja-JP/configuration-profiles.md) → [セキュリティ強化](docs/ja-JP/security-hardening.md) → [Runbooks](docs/ja-JP/runbooks.md)
- **連携担当者：** [API リファレンス](docs/ja-JP/api-reference.md) → [API Recipes](docs/ja-JP/api-recipes.md) → [MCP フェデレーション](docs/ja-JP/mcp-federation.md)
- **コントリビューター：** [開発者ガイド](docs/ja-JP/developer-guide.md) → [テスト](docs/ja-JP/testing.md) → [コントリビューション](docs/ja-JP/contributing-guide.md)
- **すべてのトピック：** [日本語ドキュメント](docs/ja-JP/README.md) · [ドキュメント索引](docs/README.md)

## プロジェクト構成

```
CyberStrikeAI/
├── cmd/                 # サーバー、MCP stdio のエントリーポイント、ツール類
├── internal/            # エージェント、MCP コア、ハンドラー、C2（`internal/c2`）、セキュリティ実行基盤
├── web/                 # React + Semi Design のソースとビルド済みアセット
├── tools/               # YAML ツールレシピ（100 以上のサンプルを同梱）
├── roles/               # ロール設定（12 以上の定義済みセキュリティテストロール）
├── skills/              # Agent Skills のディレクトリ（SKILL.md と任意のファイル。デモ: cyberstrike-pi-demo）
├── agents/              # マルチエージェントの Markdown（orchestrator.md とサブエージェントの *.md）
├── docs/                # トピック別ドキュメント（デプロイ、設定、セキュリティ、API、ナレッジベース、C2、WebShell など）
├── images/              # ドキュメント用のスクリーンショットと図
├── config.yaml          # 実行時の設定
├── run.sh               # 起動用スクリプト
└── README*.md
```

## 基本的な使用例

```
192.168.1.1 の開いているポートをスキャンして
192.168.1.1 に対して、80,443,22 を中心に包括的なポートスキャンを実行して
https://example.com/page?id=1 に SQL インジェクションの脆弱性がないか確認して
https://example.com の隠しディレクトリと古いソフトウェアをスキャンして
example.com のサブドメインを列挙し、その結果に対して nuclei を実行して
```

## 高度なプレイブック

```
recon-engagement テンプレートを読み込み、amass/subfinder を実行してから、稼働中のすべてのホストでディレクトリを総当たりして。
Burp ベースの外部 MCP サーバーを使って認証済みトラフィックをリプレイし、検出事項をグラフ化のために戻して。
5 MB の nuclei レポートを圧縮し、緊急の CVE を要約して、成果物を会話に添付して。
最新の案件の攻撃チェーンを構築し、深刻度が high 以上のノード一覧をエクスポートして。
```

## 404Starlink 

<img src="./images/404StarLinkLogo.png" width="30%">

CyberStrikeAI は [404Starlink](https://github.com/knownsec/404StarLink) に参加しています。

## TCH 上位入賞のインテリジェントペネトレーションテストプロジェクト  
<div align="left">
  <a href="https://zc.tencent.com/competition/competitionHackathon?code=cha004" target="_blank">
    <img src="./images/tch.png" alt="TCH 上位入賞のインテリジェントペネトレーションテストプロジェクト" width="30%">
  </a>
</div>



---

## コミュニティとサポート

- [Discord](https://discord.gg/8PjVCMu8Zw) のコミュニティに参加できます。

<details>
<summary><strong>WeCom グループ</strong></summary>

<img src="./images/wecom-group-cyberstrikeai-qr.png" alt="CyberStrikeAI WeCom グループの QR コード" width="280">

</details>

## ライセンス

CyberStrikeAI は Apache License 2.0 の下でライセンスされています。  
詳細は [LICENSE](LICENSE) ファイルを参照してください。

---

## ⚠️ 免責事項

**本ツールは、教育目的および許可されたテストのためだけのものです。**

CyberStrikeAI は、セキュリティ研究者、ペネトレーションテスター、IT 専門家が、**明示的な許可を得たうえで**セキュリティ評価と脆弱性調査を行うことを支援するために設計された、プロフェッショナル向けのセキュリティテストプラットフォームです。

**本ツールを使用することで、次の事項に同意したものとみなされます。**
- 書面による明確な許可を得たシステムに対してのみ本ツールを使用すること
- 適用されるすべての法律、規制、倫理基準を遵守すること
- 許可のない使用または誤用について全責任を負うこと
- 本ツールを違法または悪意のある目的に使用しないこと

**開発者は、いかなる誤用についても責任を負いません。** 使用にあたっては、現地の法令を遵守し、対象システムの所有者から明示的な許可を得ていることを確認してください。

脆弱性の報告とデプロイ時のセキュリティ強化の指針については、[SECURITY_JA.md](SECURITY_JA.md)を参照してください。

---

ヘルプが必要な場合やコントリビュートしたい場合は、Issue または PR を作成してください。コミュニティによるツールの追加を歓迎します。
