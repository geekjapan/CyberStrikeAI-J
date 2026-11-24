# 設定リファレンス

[English](../en-US/configuration.md) | [中文](../zh-CN/configuration.md)

CyberStrikeAI のメイン設定ファイルは `config.yaml` です。ほとんどの設定は Web の「システム設定」からも変更でき、保存後に適用します。本番環境では、機密値を管理された設定システムに置き、`config.yaml` のファイル権限を制限することを推奨します。

## 基本設定

```yaml
version: "vX.Y.Z" # プレースホルダー；config.example.yaml にある現在のリリースバージョンの値を使用してください
server:
  host: 0.0.0.0
  port: 8080
  tls_enabled: true
  tls_auto_self_sign: true
  # オプション：その他の信頼できる Web 連携用。Chromium ブラウザープラグインでは設定不要
  # cors_allowed_origins:
  #   - https://trusted-integration.example
auth:
  session_duration_hours: 12
log:
  level: info
  output: stdout
```

- `version`：フロントエンドに表示するバージョン。
- `server.host/port`：Web サービスの待ち受けアドレスとポート。
- `server.tls_*`：HTTPS 設定。本番環境では `tls_cert_path` と `tls_key_path` の使用を推奨します。
- Chromium ブラウザープラグインの正規の `chrome-extension://<32桁のプラグインID>` Origin は自動的に認識されるため、設定は不要です。プラグインはドメインごとの認可が必要で、パスワードログインと Bearer トークンによる API 呼び出しを使用します。
- `server.cors_allowed_origins`：その他の信頼できる Web 連携専用の、追加 Origin の完全一致ホワイトリスト。`*` はサポートされず、変更後はサービスの再起動が必要です。
- `auth.session_duration_hours`：ログインセッションの有効期間（時間）。ログインパスワードは RBAC のユーザー管理で扱われ、初回起動時にコンソールへ `admin` の初期パスワードが出力されます。
- `log.output`：`stdout`、`stderr` またはファイルパスを指定でき、レベルは `log.level` で制御します。
- 追加の診断ログはデフォルトで有効で、`warn` 以上（リトライ、接続異常、エラーを含む）のみを記録します。`log.level` とは独立しており、通常の `info` / `debug` ログは保存しません。既存の構造化フィールド、時刻、コード位置、Error 以上のスタックトレースは保持され、リクエスト本文やツール出力は追加で収集しません。
- `log.diagnostic_dir`：デフォルトは `log`。プロセスの作業ディレクトリからの相対パスで、ファイル名は `diagnostic-YYYY-MM-DD.log`（JSON Lines、サーバーのローカル日付ごとに分割）です。診断ログが発生したときにのみディレクトリとファイルを作成し、日付が変わった後の最初の書き込みでファイルが切り替わります。
- `log.diagnostic_retention_days`：デフォルトは 14 日（当日を含む）。省略した場合や 0 以下の場合はデフォルト値を使用します。毎日最初の書き込み時に、このディレクトリ内の期限切れの `diagnostic-日付.log` を削除し、それ以外のファイルは削除しません。新しい診断ログがない場合はクリーンアップを実行しません。
- `log.diagnostic_disabled: true`：追加の診断ログのディスク書き込みを無効にします。上記のログ設定は変更後に再起動が必要です。ディレクトリに書き込めない場合は元の出力を維持し、Zap が書き込み失敗を stderr に報告します。

## AI チャネルとモデルの設定

```yaml
ai:
  default_channel: openai-main
  channels:
    openai-main:
      name: OpenAI Main
      provider: openai_compatible
      base_url: https://api.openai.com/v1
      api_key: sk-...
      model: gpt-4.1
      max_total_tokens: 120000
      max_completion_tokens: 16384
      reasoning:
        mode: on
        effort: high
        allow_client_reasoning: true
        profile: openai_compat
    claude-main:
      name: Claude Main
      provider: claude
      base_url: https://api.anthropic.com/v1
      api_key: sk-ant-...
      model: claude-sonnet-4-5
```

`ai` はモデル設定の推奨エントリーポイントです。システム設定ページでの対応パスは **システム設定 → 基本設定 → AI チャネル設定** で、保存すると `ai.default_channel` と `ai.channels` に書き込まれます。旧版の `openai` フィールドは互換用のランタイムフィールドとして残されています。設定の読み込み時に少なくとも 1 つのデフォルトチャネルが確保され、`ai.default_channel` を解決した設定がランタイムの `openai` に同期されます。

チャネルのフィールド：

| フィールド | 説明 |
| --- | --- |
| `ai.default_channel` | デフォルトチャネル ID。新しい会話、ボット、バッチタスク、およびチャネルを明示的に選択していないリクエストで使用されます。 |
| `ai.channels.<id>` | チャネル設定。ID は小文字、数字、ハイフンに正規化されます。例：`Qwen_Max` は `qwen-max` になります。 |
| `name` | Web UI での表示名。空の場合はチャネル ID を使用します。 |
| `provider` | `openai_compatible` または `claude`。`openai_compatible` はランタイムで `openai` にマッピングされ、`claude` は Pi ネイティブの Anthropic Messages API を使用します。 |
| `base_url/api_key/model` | 必須。Base URL には通常、OpenAI/互換ゲートウェイの `/v1` のようなバージョンパスを含める必要があります。 |
| `max_total_tokens` | コンテキスト圧縮、攻撃チェーン構築、マルチエージェントの要約などで共有される総予算。 |
| `max_completion_tokens` | 1 回のモデル出力の上限。未指定の場合はデフォルト値を使用します。 |
| `context_window` | ランタイムのコンテキストウィンドウ。0 は不明を表します。チャネル保存時にサービスが報告するウィンドウを自動入力でき、入力済みのより小さいウィンドウが優先されます。 |
| `context_profile` | バックグラウンドのポリシー。デフォルトは `auto`。ローカルサービスを認識すると `local_auto` を記録します。設定ファイルでは、手動の `local`、明示的な節約の `economy`、ランタイムパラメーターを使用する `custom` をサポートします。 |
| `reasoning` | このチャネルのデフォルトの推論拡張フィールド。ゲートウェイによってサポート状況が大きく異なるため、異常があればまず `mode: off` を試してください。 |

### 自動入力最適化

DeepSeek の公式アドレス、明確な DeepSeek の推論ライン、または DeepSeek を含むモデル名では、入力節約が自動的に有効になります。ツールが 16 個に達するとオンデマンド検出を使用し、デフォルトでは先頭 6 個のツール、コアツール、および明示的な常駐リストを常駐させます。JSON レスポンスは書式用の空白を削減します。認可されたローカル読み取りツールがある場合、8,000 バイトを超える結果は全文を保存し、読み戻し可能なプレビューを返します。推論トークンは別枠で集計され、出力の合計に含まれます。

チャネルの保存と接続テストでは、Ollama、llama.cpp、LM Studio、vLLM、oMLX のメタデータを検出します。oMLX は `owned_by: omlx` で識別され、`/v1/models/status` の一致するモデルまたはエイリアスのウィンドウを優先的に読み取り、権限が不足している場合はモデル一覧にフォールバックします。通常の互換レスポンスやイントラネットの IP だけでは、ローカルポリシーのトリガーには不十分です。検出に失敗しても保存を続行できます。

ローカルの入力予算はウィンドウの 60% で、上限は 131,072 トークンとし、出力用の余地を確保します。ウィンドウが不明な場合は、保守的な 32,768 のウィンドウを使用します。ツール検出とレスポンスの上限はローカルウィンドウに応じて絞り込まれ、出力フィールドには `max_tokens` を使用します。モデルがアーキテクチャ上の上限のみを報告する場合、新しいチャネルはウィンドウ不明の状態を維持します。モデルやサービスを切り替えると、以前の自動判定はクリアされます。ページはこれらのポリシーをバックグラウンドで適用します。

コストを検証する際は、タスク全体の入力、キャッシュヒット、出力、呼び出し回数を比較してください。ツール検索と分割読み戻しにより、呼び出しが増える場合があります。既存の設定ファイルでの明示的なオーバーライドは引き続き有効です。

### プロバイダーとモデルごとの推論の無効化

`reasoning.mode: off` を使用するか、会話で「推論 → オフ」を選択します。実際のリクエストパラメーターはチャネルごとに異なります。

- 公式の `https://api.openai.com/v1`、OpenAI 互換プロバイダー、`auto` または `openai_compat` プロファイルでは、`none` のサポートが確認されているモデルに `reasoning_effort: "none"` を送信します。対象は GPT-5.5、GPT-5.6（Sol/Terra/Luna および `gpt-5.6` エイリアス）、GPT-6 Sol/Luna と、対応する日付付きスナップショットです。これらのモデルは、設定またはリクエスト内の `reasoning.effort: none` も受け付けます。Planner の強制ツール選択でも、明示的な `none` を保持します。
- DeepSeek は `auto` または `deepseek_compat` プロファイルで、無効化時にも `thinking: {type: disabled}` を送信します。明示的なプロファイルは自動認識より優先されます。
- その他のモデルやサードパーティの互換ゲートウェイは従来の動作を維持し、無効化時は推論フィールドを省略します。サードパーティのゲートウェイが OpenAI と同名のモデルを使用していても、公式サービスとは自動的にみなされません。

GPT-5.6 と GPT-6 Sol/Luna で Chat Completions の関数ツールを使用する場合は、明示的に「オフ」を選択する必要があります。強度を指定しないとモデルのデフォルトの推論が採用され、無効化とは同じではありません。ツールと推論が互換でない場合は推論をオフにするよう案内され、ユーザーが選択した強度が暗黙のうちに書き換えられることはありません。GPT-6.1 Sol と GPT-6 Astra は `none` をサポートせず、ツール呼び出しには Responses を使用する必要があります。現在の Chat Completions バックエンドはこの制限を明示的に通知するため、互換性のあるモデルを選択してください。`base_url` を Responses の URL に変更しただけでは、プロトコルの適合は完了しません。詳細は [OpenAI 公式の推論に関する説明](https://developers.openai.com/api/docs/guides/reasoning) を参照してください。

`allow_client_reasoning: false` の場合、会話またはリクエストでの推論のオーバーライドは無視され、チャネルの設定に従って実行されます。

会話ページの「AI チャネル」ドロップダウンは、保存済みのチャネルを読み込みます。リクエストボディの `aiChannelId` が空でない場合、今回／この会話の実行設定にのみ有効となり、API Key がモデルへ送信されることはありません。空の場合は `ai.default_channel` に従います。

よく使う操作：

- 追加：左側の `+` をクリックし、必須フィールドを入力して保存します。
- デフォルトに設定：チャネルを選択して「デフォルトに設定」をクリックし、保存して適用すると新しいリクエストから有効になります。
- 複製：現在のフォーム内容でコピーを作成します。同じサービスプロバイダーで別のモデルを設定する場合に便利です。
- 削除：デフォルトチャネルは一括削除の対象にできません。削除後も少なくとも 1 つのチャネルを残す必要があります。
- 疎通確認：単一チャネルの「接続テスト」または左側の「一括疎通確認」はモデルのテスト API を呼び出し、Key、Base URL、モデル名の検証に適しています。

## Agent

```yaml
agent:
  max_iterations: 12000
  tool_timeout_minutes: 60
  shell_no_output_timeout_seconds: 1200
  workspace_root_dir: ""
  system_prompt_path: ""
```

- `max_iterations`：シングルエージェント、マルチエージェントのメイン実行器、およびサブエージェントのデフォルトの反復上限。
- `tool_timeout_minutes`：ツール 1 回あたりの最長実行時間。
- `shell_no_output_timeout_seconds`：Shell が長時間出力しない場合に終了します。
- `workspace_root_dir`：セッションのワークスペースのルートディレクトリ。システムの `/tmp` には設定しないことを推奨します。
- `system_prompt_path`：シングルエージェントのシステムプロンプトを上書きするファイル。

## HITL

```yaml
hitl:
  default_reviewer: audit_agent
  audit_backend: openai
  retention_days: 90
  tool_whitelist: [read_file, list_dir, glob, grep, tool_search]
  audit_model:
    provider: ""
    base_url: ""
    api_key: ""
    model: ""
```

- `default_reviewer`：`human` または `audit_agent`。
- `audit_backend`：`openai`（デフォルト、互換プロトコルのチャットモデル）または `typesafe`（TypeSafe Jev）。
- `tool_whitelist`：グローバルな承認不要ツールのリスト。セッションのホワイトリストとマージされます。
- `audit_model`：openai バックエンドでは空にするとメインモデルを再利用します。typesafe バックエンドでは TypeSafe の API Key の入力が必要で、メインモデルのキーは継承されません。
- `audit_agent_prompt` / `audit_agent_prompt_review_edit`：openai バックエンドではチャットのプロンプトとして、typesafe バックエンドでは Jev の組織ポリシー（`operatorPolicy`）として使用されます。組み込みのデフォルトプロンプトは Jev の質問と重複するため、state にはコピーされなくなりました。

さらなるポリシーについては [ヒューマンインザループ（HITL）のベストプラクティス](hitl-best-practices.md) を参照してください。

## マルチエージェント

```yaml
multi_agent:
  enabled: true
  robot_default_agent_mode: single
  batch_use_multi_agent: false
  skills:
    disable: false
    filesystem_tools: true
    skill_tool_name: skill
```

サポートされるモード：

- `single`：Pi シングルエージェント。
- `deep`：DeepAgent スタイルのマルチエージェント。
- `plan_execute`：計画、実行、再計画。
- `supervisor`：スーパーバイザーエージェントがサブエージェントへ引き継ぎます。

`agents_dir` は Markdown サブエージェントのディレクトリを指します。個々のエージェントは front matter で `tools`、`bind_role`、`max_iterations` を設定できます。

## ツールと MCP

```yaml
security:
  tools_dir: tools
  tool_description_mode: full
mcp:
  enabled: false
  host: 0.0.0.0
  port: 8081
  auth_header: "X-MCP-Token"
  auth_header_value: ""
external_mcp:
  servers: {}
```

- `security.tools_dir`：組み込みツールの YAML ディレクトリ。
- `tool_description_mode`：`short` はトークンをより節約し、`full` はより詳細です。
- `mcp.enabled`：独立した HTTP MCP サービスを起動するかどうか。
- `mcp.auth_header_value`：外部から MCP を呼び出す際の共有シークレット。本番環境では必ず設定してください。
- `external_mcp.servers`：外部 MCP フェデレーションの設定。

ツール YAML のルールは `tools/README.md` を参照してください。

## ナレッジベース

```yaml
knowledge:
  enabled: false
  base_path: knowledge_base
  embedding:
    provider: openai
    model: text-embedding-v4
    base_url: ""
    api_key: ""
  retrieval:
    top_k: 5
    similarity_threshold: 0.4
  indexing:
    chunk_size: 512
    chunk_overlap: 50
    batch_size: 10
```

有効にすると、ナレッジベース検索ツールが登録され、管理 API が公開されます。詳細は [ナレッジベース](knowledge-base.md) を参照してください。

## データベース

```yaml
database:
  path: data/conversations.db
  knowledge_db_path: data/knowledge.db
```

デフォルトでは SQLite を使用します。`knowledge_db_path` が空の場合は会話データベースを再利用できます。独立したファイルの方が、ナレッジベースの移行が容易です。

## 監査と監視

```yaml
audit:
  enabled: true
  retention_days: 15
  max_detail_bytes: 8192
monitor:
  retention_days: 90
```

- `audit` はプラットフォームの操作を記録し、会話本文や各ツール呼び出しの本文は記録しません。
- `monitor` はツール実行記録の保持期間を管理します。

## ストレージのクリーンアップ

```yaml
storage:
  auto_clean: false
  interval_minutes: 60
  orphan_grace_days: 1
  active_grace_hours: 24
  categories:
    workspace:
      enabled: true
      retention_days: 30
```

実行中に発生したディスク上の不要データをクリーンアップします。入口は「システム設定 → ストレージのクリーンアップ」で、`POST /api/storage/cleanup` でも実行できます。

- `auto_clean` はデフォルトで無効です。アップグレード後に、管理者が知らないうちに既存データが削除されることはありません。無効の場合でも、手動でプレビューとクリーンアップができます。
- `interval_minutes` はバックグラウンドクリーンアップの間隔で、最小値は 5 です。`orphan_grace_days` は、セッション／プロジェクトが削除済みでもディレクトリが残っている場合の最小保持日数です。`active_grace_hours` 以内のアクティブなセッションは、すべてスキップされます。
- 各カテゴリーの `retention_days` が 0 の場合は保持期間によるクリーンアップを行いませんが、**孤立ディレクトリは引き続き回収されます**（セッションが削除されたディレクトリには保持する価値がありません）。
- 削除は元に戻せません。API 層では、実際の削除に `dry_run=false` と `confirm=true` の両方の指定が必要で、`dry_run` を省略するとプレビューとして扱われます。

| カテゴリー | デフォルトの保持期間 | 対象ディレクトリ |
| --- | --- | --- |
| `workspace` | 30 日 | Agent ワークスペース `tmp/workspace` |
| `reduction` | 7 日 | 超長ツール出力のディスク保存先 `tmp/reduction` |
| `conversation_artifacts` | 30 日 | 要約と超長入力の台帳 `data/conversation_artifacts` |
| `plantask` | 30 日 | マルチエージェントの計画ボード `skills/.pi/plantask` |
| `c2_artifacts` | 30 日 | C2 の返却／アップロード／配信／payload `tmp/c2`（payload をクリーンアップするとダウンロードリンクは無効になります） |
| `chat_uploads` | 90 日 | 会話でアップロードされた添付ファイル `chat_uploads` |
| `workflow_checkpoints` | 7 日 | ワークフローのチェックポイント `data/workflow-checkpoints` |
| `diagnostic_logs` | 14 日 | 診断ログ `log/diagnostic-*.log` |

## C2、WebShell、プロジェクト

```yaml
c2:
  enabled: true
project:
  enabled: true
  context_checkpoints: true
  # 継続用の補足はファクトインデックスの予算内に含まれます；作業ファイル候補リストには別途最大 4000 文字の予算があります
  fact_index_max_runes: 65000
```

- `c2.enabled`：無効にすると C2 リスナーを起動せず、C2 MCP ツールも登録しません。
- WebShell の接続設定は SQLite に保存され、メイン設定に独立したスイッチはありません。
- `project` は、会話をまたぐファクトブラックボードの注入予算を制御します。[プロジェクトでの会話継続と成果の再利用](project-resume.md) で、スクリプトの登録、テスト結果、継続フローを説明しています。
- `project.context_checkpoints` はデフォルトで有効です。プロジェクトにバインドされたセッションが正常に圧縮されると、継続用の要約が `note/context-*`（tentative）として自動保存されます。セッションおよびメイン／サブエージェントごとに別々に更新され、確認済みファクトは上書きされません。完全な元の記録は不変スナップショットとして保存され、後から `get_project_fact` と `read_file` で復元できます。これを無効にしても停止するのは自動ブラックボード記録のみで、元のコンテキストスナップショットは引き続き保持されます。詳細は [長いコンテキストの継続のための保存](blackboard-context-memory.md) を参照してください。

## ボット

`robots` は、個人 WeChat iLink、WeCom、DingTalk、Feishu、Telegram、Slack、Discord、QQ をサポートします。詳細な設定手順は [ボットの使い方](robot.md) を参照してください。

## 設定変更のヒント

- まずテスト環境で、モデル、MCP、ナレッジベース、高リスクツールを検証してください。
- `tools_dir`、`roles_dir`、`skills_dir`、`agents_dir` を変更した後は、Web ページで対応するリソースが一覧表示されるか確認してください。
- 本番環境では、不要な C2、WebShell、ターミナル、外部 MCP を有効にしないでください。
- 機密設定を変更した後は、監査ページに異常なログインや設定変更の記録がないか確認してください。

## 設定の適用メカニズム

設定のすべてのフィールドが同じように「ホットアップデート」されるわけではありません。`/api/config/apply` は一連の調整動作を行います。モデル設定の更新、ツール説明モードの更新、一部の MCP ツールの再登録、ナレッジベースの初期化または更新、ボット接続の再起動、設定に応じた C2 の起動・停止です。このロジックは `internal/handler/config.go` の `ConfigHandler` が調整します。

実務上の判断：

| 設定セクション | 適用後に通常すぐ有効になるもの | 追加で必要な操作 |
| --- | --- | --- |
| `ai.default_channel` / `ai.channels` | 新しいリクエストは、解決後のデフォルトまたは選択したチャネルを使用 | 実行中のストリーミングリクエストは強制的に切り替わりません。フロントエンドのチャネル一覧は設定の再読み込みが必要 |
| `openai` | 互換フィールド。通常はデフォルトの AI チャネルから同期 | 新しい設定では `ai.channels` を優先して管理 |
| `agent.max_iterations` | 新しい Agent タスクで有効 | 実行中のタスクは開始時の状態のまま継続 |
| `security.tool_description_mode` | ツールが再公開されたときに有効 | モデルの既存コンテキストはロールバックされません |
| `hitl.tool_whitelist` | 新しいツール呼び出しの承認判定で有効 | 保留中の承認は自動的に再判定されません |
| `knowledge.enabled` | コンポーネントの初期化／更新を試みます | 有効化後もスキャンとインデックス作成が必要 |
| `knowledge.embedding` | リトリーバー／インデクサーの設定を更新 | 既存のベクトルは通常、インデックスの再構築が必要 |
| `robots` | 接続の再起動をトリガー | プラットフォーム側のコールバック設定が正しい必要があります |
| `c2.enabled` | C2 ランタイムを調整 | 公開済みのポートとセッションは手動で確認が必要 |
| `server.port/tls` | 通常はプロセスの再起動が必要 | 待ち受けアドレスは通常のホットアップデートの対象外 |

## 設定の優先順位と派生関係

いくつかのフィールドには「空にすると再利用」の関係があります。

- `vision.api_key/base_url/provider` が空の場合は `openai` を再利用します。
- `hitl.audit_model` は、`audit_backend=openai` で空の場合にデフォルトの AI チャネルを再利用します。typesafe バックエンドはメインモデルのキーを継承しません。
- `knowledge.embedding.base_url/api_key` が空の場合は、メインモデルまたは embedding のデフォルト設定を再利用します。
- `knowledge.retrieval.rerank.base_url/api_key` が空の場合は embedding/openai を再利用します。
- `database.knowledge_db_path` が空の場合はメインの会話データベースを再利用できますが、独立したファイルの方がバックアップに適しています。

このような設定のトラブルシューティングでは、子の設定セクションだけでなく、どの上位設定にフォールバックするかも確認してください。

## パラメーター値の目安

| パラメーター | 保守的な値 | 積極的な値 | 判断の根拠 |
| --- | --- | --- | --- |
| `agent.tool_timeout_minutes` | 10-30 | 60+ | スキャンツールが長時間のタスクを頻繁に実行するか |
| `shell_no_output_timeout_seconds` | 300-600 | 1200+ | ツールが長時間無出力になるか |
| `knowledge.indexing.batch_size` | 5-10 | 20+ | embedding サービスのバッチ制限 |
| `knowledge.indexing.rate_limit_delay_ms` | 300-800 | 0-100 | サービスプロバイダーの RPM と 429 の発生状況 |
| `retrieval.top_k` | 3-5 | 8-12 | コンテンツの品質とコンテキスト予算 |
| `similarity_threshold` | 0.35-0.45 | 0.5+ | 再現率優先か精度優先か |
| `audit.retention_days` | 15-30 | 90+ | コンプライアンス要件とディスク容量 |
| `monitor.retention_days` | 30-90 | 180+ | 長期間の振り返りが必要か |

## 変更前後の検証テンプレート

設定を変更する前に記録します。

```text
変更目的：
関係する設定セクション：
想定される影響：
ロールバック方法：
検証用 API：
```

変更後の検証：

```bash
curl -k https://127.0.0.1:8080/api/auth/validate \
  -H "Authorization: Bearer <token>"
```

その後、設定の種類に応じて、モデル、ツール、ナレッジベース、C2 またはボットを検証します。Web の保存成功メッセージだけで判断しないでください。

## ソースコード上の参照先

- 設定の構造：`internal/config/config.go`
- 環境変数の展開：`internal/config/envexpand.go`
- Web 設定 API：`internal/handler/config.go`
- ルート登録：`internal/app/app.go`
- C2 設定の調整：`internal/app/c2_lifecycle.go`
