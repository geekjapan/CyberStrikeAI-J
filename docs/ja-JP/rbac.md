# CyberStrikeAI RBAC 利用・管理ガイド

[English](../en-US/rbac.md)

CyberStrikeAI は、Agent、MCP、WebShell、C2、バッチタスクを実行できるセキュリティ自動化プラットフォームです。RBAC はページの表示可否を制御するだけでなく、HTTP API、リソース照会、Agent コンテキスト、組み込み／外部 MCP ツール、バックグラウンドタスク、ボットの実行経路まで一貫して適用されます。

---

## 一、2 種類の「ロール」を区別する

| 概念 | 管理画面 | 役割 |
|------|----------|------|
| **プラットフォームロール（RBAC Role）** | 左側の **プラットフォームアクセス** | ユーザーが呼び出せる機能とアクセスできるリソースを決定する |
| **AI テストロール（Agent Role）** | 左側の **ロール** / `roles/*.yaml` | Agent のプロンプト、テスト手法、選択可能なツールセットを決定する |

AI テストロールは、セキュリティ上の認可境界ではありません。「ペネトレーションテスト」ロールを選択しても、ユーザーは対応するプラットフォーム権限を持っている必要があります。逆に、RBAC で権限があっても Agent のプロンプトが自動的に変わることはありません。

---

## 二、認可モデル

次の条件をすべて満たした場合にのみ、アクセスが許可されます。

```text
有効なアカウント
  + ルート/ツールに必要な permission
  + その permission に対応する scope
  + 対象リソースの owner / 明示的な付与 / 親リソースからの継承
  + グローバル操作に対する追加の制限
```

処理の流れ：

1. ログイン後に Bearer トークンが発行されます。セッションにはユーザー、ロール、権限、権限ごとの Scope が含まれます。
2. HTTP ミドルウェアがルートを権限にマッピングします。例：`GET /api/projects` → `project:read`。
3. リソース ID を伴うリクエストでは、さらに owner、明示的なリソース付与、親リソースからの継承を検証します。
4. Agent の起動時に、変更不可の Principal が `context.Context` に書き込まれます。
5. 組み込み MCP ツールは、ツールとパラメーターに基づいて権限とリソースを再度チェックします。外部 MCP にも独立した制限があります。
6. 拒否イベントは RBAC／監査ログに書き込まれます。

フロントエンドでボタンを非表示にするのは使い勝手を高めるためだけであり、セキュリティ境界ではありません。実際の拒否はサーバー側で行われます。

---

## 三、組み込みプラットフォームロール

| ロール | Scope | デフォルトの機能 |
|------|-------|----------|
| **管理者 `admin`** | `all` | RBAC、設定、ターミナル、監査削除、グローバル定義の管理を含む、既知のすべての権限 |
| **オペレーター `operator`** | `assigned` | 日常的な読み書きと実行の機能。RBAC、コア設定、ターミナル、監査管理、外部 MCP の実行、一部のグローバル定義の書き込み権限は含まない |
| **監査担当 `auditor`** | `all` | 各モジュールの読み取り専用権限と `audit:read`。書き込み操作は行わない |
| **読み取り専用ユーザー `viewer`** | `assigned` | 各モジュールの読み取り専用権限。認可された範囲のみ閲覧できる |

システムロールは変更も削除もできません。アップグレード時には、現行バージョンの権限カタログに基づいて認可が再構築され、旧バージョンの権限が残らないようにします。別の組み合わせが必要な場合は、カスタムロールを作成してください。

組み込みの管理者アカウント `admin` は最後の砦となる管理入口であり、無効化、削除、システム管理者ロールの解除はできません。画面や API からこのような更新を送信しても拒否され、元のアカウント情報、権限、有効なセッションは変更されません。表示名やパスワードの変更、`admin` ロールを保持したままのその他のロール設定の変更は引き続き可能です。通常アカウントの有効状態とロールは、これまでどおり必要に応じて調整できます。この保護は、過去に失われたロールの紐付けを自動的に修復するものではありません。

ロールが 1 つも割り当てられていないアカウントでもログインはできますが、業務権限はほぼありません。「ロールなし」を完全な職務設定として当てにしないでください。

---

## 四、権限の命名とカタログ

権限は `モジュール:アクション` の形式で命名されます。主なアクション：

- `read`：閲覧、一覧、照会、エクスポート。
- `write`：作成、更新、実行、管理。
- `delete`：削除。
- `execute`：Agent、ターミナル、ワークフロー、特定の機能の実行。

現在の権限をモジュール別にまとめると次のとおりです。実行中のバージョンにおける正式なカタログは、「プラットフォーム権限」ページまたは `GET /api/rbac/metadata` を基準としてください。

| モジュール | 権限 |
|------|------|
| アカウント | `auth:self` |
| ダッシュボード | `dashboard:read` |
| 会話 | `chat:read`、`chat:write`、`chat:delete` |
| Agent | `agent:execute`、`agent:local-execute` |
| HITL | `hitl:read`、`hitl:write` |
| タスク | `tasks:read`、`tasks:write`、`tasks:delete` |
| プロジェクト | `project:read`、`project:write`、`project:delete` |
| 脆弱性 | `vulnerability:read`、`vulnerability:write`、`vulnerability:delete` |
| WebShell | `webshell:read`、`webshell:write`、`webshell:delete` |
| C2 | `c2:read`、`c2:write`、`c2:delete` |
| MCP | `mcp:read`、`mcp:execute`、`mcp:write`、`mcp:external:execute` |
| ワンクリックアップデート（ローカルソース） | `update:read`、`update:apply` |
| ナレッジベース | `knowledge:read`、`knowledge:write`、`knowledge:delete` |
| Skills | `skills:read`、`skills:write`、`skills:delete` |
| Markdown Agents | `agents:read`、`agents:write`、`agents:delete` |
| AI テストロール | `roles:read`、`roles:write`、`roles:delete` |
| ワークフロー | `workflow:read`、`workflow:execute`、`workflow:write`、`workflow:delete` |
| システム設定 | `config:read`、`config:write` |
| ターミナル | `terminal:execute` |
| 監査 | `audit:read`、`audit:delete` |
| RBAC | `rbac:read`、`rbac:write` |
| 通知 | `notification:read`、`notification:write` |
| ボット | `robot:read`、`robot:write` |
| ファイル | `files:read`、`files:write`、`files:delete` |
| 攻撃チェーン | `attackchain:read`、`attackchain:write` |
| サイバー空間マッピング / 情報収集 | `fofa:execute` |
| OpenAPI | `openapi:read` |
| 実行監視 | `monitor:read`、`monitor:write`、`monitor:delete` |

特別な権限についての説明：

- `fofa:execute` は旧バージョンとの互換性のために権限名を残しているもので、現在は **情報収集** ページでの FOFA、ZoomEye、Quake、Shodan の照会を保護します。

- `agent:execute` は Agent の実行を許可しますが、ローカルファイルシステム、Shell、任意の設定コマンドは自動的には許可しません。
- `agent:local-execute` はローカル実行のフォールバック権限であり、信頼できるオペレーターにのみ付与してください。
- `mcp:execute` は、認証後の MCP HTTP エンドポイントへのアクセスに使用します。
- `mcp:external:execute` は Agent が外部 MCP ツールを呼び出すために使用し、現在はこの権限の Scope が `all` であることも必要です。
- 外部 MCP の設定管理には `mcp:write` を使用します。外部ツールの実行とは別の権限です。
- ワンクリックアップデートは**2 つ**の権限に分かれます。`update:read` はローカルにインストールされたバージョンとアップデートソースとの差分を確認します。`update:apply` はアップデートソースのリポジトリ（デフォルトは公式リポジトリ）
  のデフォルトブランチを取得し、再ビルドして、プラットフォームのバイナリを入れ替えます。書き込み側ではセッションの scope が `all` であることも必要です。1 台のマシンにソースは 1 つだけであり、`assigned`/`own` が他者の実行中のコードを動かせてはならないためです。
- `robot:write` はボットの設定とテスト入口を管理します。ボットのチャット自体は、紐付けられたユーザーまたはサービスアカウントの業務権限を使用します。

---

## 五、リソース Scope

各ロールには 1 つの Scope が含まれます。

| Scope | 意味 | 適した場面 |
|-------|------|-----------|
| `all` | その権限が対象とするすべてのリソースにアクセスできる | 管理者、全体の監査担当 |
| `assigned` | 管理者が指定したリソースと、システムがサポートする親リソースからの継承範囲にアクセスできる | プロジェクトメンバー、特定資産のオペレーター |
| `own` | 自分が作成した／自分に帰属するリソースが中心。一部のリソースは、明示的な付与や親リソースとの関係を通じてもアクセスできる | 個人ワークスペース、ボット専用の ID |

権限と Scope は組にして計算されます。1 人のユーザーが複数のロールを持つ場合、権限は和集合になり、**同じ権限**の Scope は最も広い値が採用されます。

```text
all > assigned > own
```

例：

- 「全体監査」ロール：`project:read` + `all`
- 「個人プロジェクト編集」ロール：`project:write` + `own`

最終的な結果は次のとおりです。

```text
project:read  → all
project:write → own
```

グローバルな読み取り権限があっても、無関係な書き込み権限がグローバルな書き込みに拡大されることはありません。サーバー側の認可では `ScopeFor(permission)` を使用する必要があり、ユーザーの最も広い総合 Scope を使用してはいけません。

### グローバルオブジェクトの制限

一部のオブジェクトは、owner を持たないプロセスレベルの共有定義です。ユーザーが `write` を持っていても、その権限の Scope が `all` でなければ、サーバー側は変更を拒否します。例：

- AI テストロール、Skills、Markdown Agents。
- 外部 MCP の設定。
- ボットの設定。
- ワークフロー定義。
- ナレッジベースの書き込み操作（検索を除く）。
- HITL のグローバルホワイトリスト、デフォルトのレビュー担当、監査ポリシー。
- C2 Profile の書き込み操作。
- ワンクリックアップデートの書き込み操作（`check`/`apply`/`rollback`、すなわち `update:apply`）。
- 一部のグローバルな監視統計。

---

## 六、リソースの帰属、明示的な付与、継承

「プラットフォームアクセス → メンバー詳細 → リソース付与」で、ユーザーにリソースを割り当てられます。現在直接選択できる主な種類：

- プロジェクト `project`
- 会話 `conversation`
- 脆弱性 `vulnerability`
- WebShell `webshell`
- バッチタスクキュー `batch_task`
- C2 Listener `c2_listener`

一度の一括付与で指定できるリソースは最大 100 件です。重複した付与はスキップされ、重複レコードは作成されません。

一部の子リソースは、親リソースのアクセス権を継承します。

| 子リソース | 継承元となる親リソース |
|--------|----------------|
| 会話 | 所属するプロジェクト |
| 脆弱性 | 所属するプロジェクトまたは関連する会話 |
| メッセージ、プロセス詳細、攻撃チェーン | 所属する会話 |
| C2 Session | Listener |
| C2 Task / ファイル / イベント | Session、Task、または Listener の連鎖 |

そのため、ユーザーに 1 つのプロジェクトを付与すれば、通常はそのプロジェクト内の各会話や脆弱性を個別に付与する必要はありません。それでも、具体的なページ／API のサーバー側チェックの結果を最終的な基準としてください。

---

## 七、Web 管理の流れ

### 7.1 ユーザーの作成

1. 管理者で左側の **プラットフォームアクセス** を開きます。
2. プラットフォームユーザーを作成し、ユーザー名、表示名、8 文字以上のパスワード、有効状態を設定します。
3. 1 つ以上のプラットフォームロールを割り当てます。
4. ロールの Scope が `assigned` の場合は、続けてリソース付与を設定します。
5. ユーザーに再ログインしてもらい、結果を確認します。管理者は、プラットフォームアクセスの **プラットフォームユーザー** タブでユーザーのロールを、**ロール権限** タブで各ロールのデータ範囲と権限数を確認できます。ユーザー本人は、`GET /api/rbac/me`（または `GET /api/auth/validate`）で、自分のロール、権限、Scope を取得できます。右上のユーザーメニューには、これらは表示されません。表示されるのは、パスワードの変更、セッション権限の更新、ログアウトだけです。

### 7.2 カスタムロールの作成

1. プラットフォームロールを新規作成し、わかりやすい職務名と説明を記入します。
2. `all`、`assigned`、`own` のいずれかを選択します。
3. 職務で実際に必要な権限だけにチェックを入れます。
4. まずテストアカウントで、一覧、詳細、書き込み操作、削除、Agent のツール呼び出しを検証します。
5. その後、本番ユーザーに一括で割り当てます。

システムロールは編集できません。その考え方を参考にして、カスタムロールを作成してください。

### 7.3 権限変更はいつ反映されるか

- ユーザー、パスワード、有効状態、ロールを更新すると、そのユーザーの既存セッションは失効し、再ログインが必要になります。
- カスタムロールの権限や Scope を変更した場合、またはカスタムロールを削除した場合は、そのロールのメンバーの既存セッションのみが失効し、再ログインが必要になります。無関係なユーザーはオンラインのままです。名前や説明の変更、権限の並び順の調整だけではセッションは失効しません。メンバーがいないロールの削除も、既存セッションには影響しません。
- ボットはメッセージごとに、紐付けられたユーザー／サービスアカウントの権限をリアルタイムで解決します。ユーザーの無効化やロールの調整は、次のメッセージから即座に影響します。
- バックグラウンドのバッチタスクは、タスクの owner に基づいて Principal を再解決します。タスク作成時のフロントエンドの状態に依存してはいけません。

---

## 八、推奨ロールテンプレート

以下は出発点であり、固定のポリシーではありません。

### 読み取り専用プロジェクトメンバー

```text
Scope: assigned
dashboard:read
chat:read
project:read
vulnerability:read
files:read
attackchain:read
```

### 日常のセキュリティオペレーター

```text
Scope: assigned
agent:execute
chat:read / chat:write
project:read / project:write
vulnerability:read / vulnerability:write
tasks:read / tasks:write
files:read / files:write
hitl:read / hitl:write
```

`agent:local-execute` や `terminal:execute` は、ローカルマシンでのコマンドが本当に必要な場合にのみ追加します。削除が必要な場合に、対応する `:delete` を追加します。

### ボット専用アカウント

```text
Scope: own（独立したワークスペース）または assigned（指定したプロジェクト）
agent:execute
chat:read / chat:write
必要に応じて project、vulnerability、knowledge などの権限を追加
```

`admin` をボットのサービスアカウントとして使うこともできますが、送信者は引き続き厳密なホワイトリストで制限する必要があります。ホワイトリストに載っている全員が完全な権限を得て、admin のデータを共有することになります。詳細は[ボットガイド](robot.md)を参照してください。

---

## 九、Agent、MCP、ボットの境界

### Agent

HTTP ログインユーザーは変更不可の Principal に変換され、シングル Agent、マルチ Agent、ワークフロー、ツール実行のコンテキストに渡されます。長時間タスクが SSE 接続から切り離された後も ID は保持されますが、フロントエンドのボタンが見えているからといって、サーバー側の権限を回避できるわけではありません。

### 組み込み MCP

組み込みの各ツールには、明示的な認可ポリシーが必要です。たとえば WebShell ツールは、`webshell:read/write/delete` と `connection_id` のリソースアクセスを同時にチェックします。脆弱性、プロジェクト、タスク、C2 の各ツールも、パラメーターが指すリソースをチェックします。

認可ポリシーが登録されていない組み込みツールは、デフォルトで拒否されます。通常のローカル／設定系ツールには `agent:local-execute` が必要です。

### 外部 MCP

Agent が外部 MCP ツールを呼び出すには `mcp:external:execute` が必要で、現在は Scope が `all` であることも求められます。外部サービスのリソースモデルは、通常ローカルの owner／割り当てによる制約を受けないためです。

### ボット

- `user_binding`：プラットフォーム上の送信者が、自身の RBAC ユーザーに紐付けられます。
- `service_account`：厳密なホワイトリストの送信者が、1 つの RBAC ユーザーを共通で使用します。
- プラットフォームの署名検証は送信元の認証のみを行い、業務上の認可の代わりにはなりません。
- `whoami` を送信すると、実際の Principal を確認できます。

---

## 十、RBAC API

すべてのエンドポイントで次を使用します。

```http
Authorization: Bearer <token>
```

管理系エンドポイントには `rbac:read` または `rbac:write` が必要で、リソースセレクターには `rbac:write` が必要です。

| メソッド | パス | 説明 |
|------|------|------|
| GET | `/api/rbac/me` | 現在のユーザー、ロール、権限、総合 Scope、権限ごとの Scope |
| GET | `/api/rbac/metadata` | 権限カタログ、ロール、ロールの権限、Scope の一覧 |
| GET/POST | `/api/rbac/users` | ユーザーの一覧／作成 |
| PUT/DELETE | `/api/rbac/users/:id` | ユーザーの更新／削除 |
| GET/POST | `/api/rbac/roles` | ロールの一覧／作成 |
| PUT/DELETE | `/api/rbac/roles/:id` | カスタムロールの更新／削除 |
| GET | `/api/rbac/resources?type=project&q=...` | 付与可能なリソースのページング検索 |
| GET/POST | `/api/rbac/resource-assignments` | リソース付与の一覧／作成 |
| DELETE | `/api/rbac/resource-assignments/:id` | リソース付与の取り消し |

ユーザー作成の例：

```bash
curl -X POST http://localhost:8080/api/rbac/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator01",
    "display_name": "セキュリティオペレーター 01",
    "password": "change-me-123",
    "enabled": true,
    "roles": ["operator"]
  }'
```

カスタムロール作成の例：

```bash
curl -X POST http://localhost:8080/api/rbac/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "プロジェクト監査員",
    "description": "指定したプロジェクトを読み取り専用で閲覧",
    "scope": "assigned",
    "permissions": ["chat:read", "project:read", "vulnerability:read"]
  }'
```

プロジェクトの一括付与の例：

```bash
curl -X POST http://localhost:8080/api/rbac/resource-assignments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "USER_ID",
    "resource_type": "project",
    "resource_ids": ["PROJECT_ID_1", "PROJECT_ID_2"]
  }'
```

---

## 十一、監査と運用の推奨事項

- 個人アカウントでプラットフォームを管理し、複数人で管理者パスワードを共有しないようにします。
- カスタムロールには職務に沿った名前を付け、説明に用途と責任者を記載します。
- 高リスクの権限は個別に承認します：`terminal:execute`、`agent:local-execute`、`c2:write/delete`、`webshell:write/delete`、`rbac:write`、`config:write`。
- `all` Scope のロール、サービスアカウント、ボットのホワイトリスト、長期間使われていないユーザーを定期的に確認します。
- ユーザーが退職する際は、まずアカウントを無効化し、その後ボットの紐付け、リソース付与、セッションを取り消します。
- ログ監査では、`rbac/access_denied`、ロール／ユーザーの変更、リソース付与、ボットのサービスアカウントによる実行に注目します。
- HITL と組み合わせて高リスクのツールを制御します。RBAC で呼び出しが許可されていても、承認を省略してよいことにはなりません。

---

## 十二、よくある質問

### ページのボタンが表示されない

ユーザーが対応する権限を持っているか確認してください。フロントエンドは `/api/rbac/me` に基づいて、権限のない操作を非表示にします。API を直接呼び出しても、サーバー側で拒否されます。

### 権限があるのに「このリソースへのアクセス権がありません」と返される

ユーザーの総合 Scope だけでなく、その権限の Scope を確認してください。そのうえで、リソースの owner、明示的な付与、親リソースへの付与を確認します。

### ロールを変更したのにユーザーの権限が古いまま

ロールの権限や Scope を変更すると、そのロールのメンバーのセッションが失効します。影響を受けるユーザーに再ログインしてもらってください。ボットは次のメッセージで権限を再解決します。

### 組み込みの `admin` のパスワードを忘れた

まず、`rbac:write` 権限を持つ別の管理者アカウントでリセットすることを推奨します。利用可能な管理者セッションがない場合は、[トラブルシューティングガイドの管理者パスワード復旧手順](troubleshooting.md#admin-のパスワードを忘れた場合)に従って、サーバー上で緊急リセットしてください。

### `write` 権限があるのにグローバル設定が拒否される

グローバルオブジェクトの書き込みには、対応する権限の Scope が `all` であることが必要です。無関係な権限を広げるのではなく、`all` Scope の専用管理ロールを作成してください。

### Agent は会話できるがコマンドを実行できない

`agent:execute` と `agent:local-execute` は分離されています。必要に応じてローカル実行権限を付与し、HITL、ツールのホワイトリスト、監査と組み合わせてください。

### 外部 MCP で global scope が必要と表示される

`mcp:external:execute` に加えて、その権限の Scope も `all` である必要があります。外部 MCP のデータ境界は、ローカルのリソース付与では自動的に保護されません。
