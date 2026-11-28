# ヒューマンインザループ（HITL）のベストプラクティス

[English](../en-US/hitl-best-practices.md)

ヒューマンインザループは、Agent がツールを実行する前に承認によるブロックを行うための仕組みです。高リスクの操作を制御し、監査の痕跡を残すのに適しています。また、人による監査の負担が大きすぎる場合に、監査 Agent に通常の承認を引き継がせることができます。

## 設定の入口

Web 画面で **システム設定 → ヒューマンインザループ** を開くと、次の項目を設定できます。

- グローバルなデフォルトの承認者: `human` または `audit_agent`
- 承認エンジン: `hitl.audit_backend`（`openai` または `typesafe`）
- 監査 Agent 専用のモデル: `hitl.audit_model`
- 判定済み監査ログの保持日数
- 承認不要ツールのホワイトリスト: `hitl.tool_whitelist`
- 承認モードとレビュー編集モードの監査プロンプト

対応する `config.yaml` の例:

```yaml
hitl:
  default_reviewer: human
  audit_backend: openai
  audit_model:
    provider: ""
    base_url: ""
    api_key: ""
    model: "" # 小規模モデルを指定可能。空の場合はデフォルトの AI チャネルのモデルを再利用する
  retention_days: 90
  tool_whitelist: [read_file, ls, glob, grep, tool_search, get_project_fact, list_project_facts, search_project_facts, list_vulnerabilities, get_vulnerability, get_asset, query_assets, list_knowledge_risk_types, get_tool_execution, wait_tool_execution, batch_task_list, batch_task_get, manage_webshell_list, c2_event, c2_file]
```

`audit_backend` はどちらか一方を選びます。`openai`（デフォルト）は互換プロトコルのチャットモデルを使用し、プロンプトにより JSON を出力させます。`typesafe` は TypeSafe Jev を使用します。カスタムの承認ポリシーは `operatorPolicy` として構造化された問いに組み込まれ、組み込みの破壊的操作のルールは引き続き絶対的な下限です。Jev はパラメーターを変更できず、レビュー編集モードでも承認/拒否のみを返します。組み込みのデフォルトプロンプトは Jev の問いと重複するため、state には再びコピーされません。

`audit_model` は openai バックエンドでは一部だけ入力でき、空のフィールドはデフォルトの AI チャネルから継承されます。typesafe バックエンドの `api_key` は必須で、メインモデルのキーは再利用**されません**。`base_url` を空にすると `https://api.typesafe.ai`、`model` を空にすると `jev-latest` になります。

## 推奨される承認ポリシー

### 1. デフォルトは人による承認とし、段階的に権限を委譲する

開始当初は次を推奨します。

- `default_reviewer: human`
- 明らかに読み取り専用のツールだけを `tool_whitelist` に追加する
- ファイル書き込み、コマンド実行、C2 タスク、WebShell 操作は人による承認を維持する

しばらく運用したら監査ログを確認し、繰り返し発生する低リスクで誤検知の少ないツールをホワイトリストに追加します。

### 2. 人による承認が追いつかない場合は、小規模モデルに通常の承認を引き継がせる

承認待ちの滞留が目立つ場合は、次のように切り替えられます。

```yaml
hitl:
  default_reviewer: audit_agent
  audit_model:
    model: "your-small-reviewer-model"
```

小規模モデルには次を処理させることを推奨します。

- 読み取り専用のクエリ
- 情報収集
- ポートとサービスのスキャン
- ディレクトリの列挙
- 破壊的でない検証コマンド

次は引き続き人が処理することを推奨します。

- データの削除、上書き、クリア
- 権限、パスワード、アカウントの変更
- 永続化、横展開、C2 の高リスクなタスク
- 本番ターゲットへの書き込み操作

### 3. プロンプトで組織のポリシーを定義する

監査 Agent のプロンプトは、漠然と「慎重に承認する」と書くのではなく、ポリシーとして書く必要があります。次を明確にすることを推奨します。

- デフォルトで許可する低リスクの操作
- 必ず拒否すべき破壊的な操作
- 人へのエスカレーションが必要なケース
- レビュー編集モードでどのようなパラメーターの絞り込みを許可するか

ポリシーの記述例:

```text
通常の情報収集、読み取り専用のクエリ、ポートスキャンはデフォルトで approve とする。
ファイルの削除、データベースの全消去、アカウント権限の変更、永続化バックドアの書き込み、重要なサービスの停止を伴う場合は必ず reject とする。
ターゲットの範囲がユーザーの許可範囲を超える場合は reject とする。
レビュー編集モードでは、パス、ターゲット、コマンド引数を絞り込んだうえで approve できるが、攻撃対象領域を広げてはならない。
```

OpenAI プロトコルのバックエンドは、この文章をチャットのプロンプトとして扱います。TypeSafe Jev はこれを `operatorPolicy` として構造化された問いに組み込みます。組み込みの破壊的操作のルールは引き続き絶対的な下限であり、Jev はパラメーターを変更しません。空にした場合、または組み込みのデフォルトと同じ場合、Jev は組み込みの問いのみを使用し、長いプロンプトを state に再びコピーすることはありません。

### 4. ホワイトリストには安定した低リスクのツールだけを入れる

ホワイトリストのツールは承認をスキップするため、保守的に管理する必要があります。次を入れることを推奨します。

- `read_file`
- `ls`
- `glob`
- `grep`
- `tool_search`
- プロジェクトと脆弱性のクエリ: `get_project_fact`、`list_project_facts`、`search_project_facts`、`list_vulnerabilities`、`get_vulnerability`
- 資産とナレッジのメタデータのクエリ: `get_asset`、`query_assets`、`list_knowledge_risk_types`
- 実行とタスク状態のクエリ: `get_tool_execution`、`wait_tool_execution`、`batch_task_list`、`batch_task_get`
- ローカル管理メタデータのクエリ: `manage_webshell_list`、`c2_event`、`c2_file`

上記の組み込み MCP クエリは引き続き RBAC とリソース範囲の制約を受けます。ホワイトリストは HITL の承認をスキップするだけで、アクセス権限は拡大しません。`list_dir` は、実際のツール名がその値である場合にのみ有効です。Pi ファイルシステムのディレクトリ一覧ツールの名前は `ls` です。

次はグローバルなホワイトリストに直接入れることを推奨しません。

- 任意の shell 実行ツール
- ファイルの書き込み/削除ツール
- C2 タスクツール
- WebShell コマンド実行ツール
- ターゲットや外部サービスにリクエストを送る「読み取り専用」ツール。たとえば `webshell_file_read`、`webshell_file_list`、`search_knowledge_base`
- 同一のツール名に読み取りと書き込みの action の両方が含まれる複合ツール。たとえば `c2_session`、`c2_listener`、`c2_profile`、`c2_task_manage`

## モードの選択

| モード | 適用シーン |
|------|----------|
| オフ | ローカルでの実験、ツールチェーンを完全に信頼している場合 |
| 承認 | 承認/拒否だけが必要な場合 |
| レビューと編集 | 監査 Agent にパラメーターを絞り込ませたうえで許可したい場合 |

すでに小規模モデルによる監査を設定している場合は、**承認** から始めることを推奨します。AI にパスやターゲット範囲、コマンドパラメーターを自動で絞り込ませたい場合にのみ、**レビューと編集** を有効にしてください。

## 運用上の推奨事項

- **HITL(人間の承認) → 監査ログ** を定期的に確認し、ホワイトリストとプロンプトを調整する。
- 高リスクの環境では `default_reviewer: human` を維持し、監査 Agent には提案の提示のみを補助させる。
- 小規模モデルによる承認が失敗した場合、デフォルトでは保守的に拒否します。これは想定された動作です。
- `hitl.audit_model` を変更した後は、まず画面で **監査モデルをテスト** をクリックする。
- 本番環境、顧客環境、実際の業務システムを操作する前には、人による最終確認を残す。
