# ツール設定ガイド

[English](README.md) | [日本語](README_JA.md)

## 概要

各ツールは `tools/` ディレクトリ内に独自の設定ファイルを持ちます。これによりツール定義が明確で保守・管理しやすくなります。システムは `tools/` 内のすべての `.yaml` および `.yml` ファイルを自動的に読み込みます。

## 設定ファイルの形式

各ツール設定ファイルは YAML ファイルです。以下の表はサポートされているトップレベルフィールドと必須かどうかを示しています。提出前に各項目を確認してください:

| フィールド | 必須 | 型 | 説明 |
|-------|----------|------|-------------|
| `name` | ✅ | string | ツールの一意識別子。小文字、数字、ハイフンを使用してください。 |
| `command` | ✅ | string | 実行するコマンドまたはスクリプト。システム PATH 上にあるか、絶対パスである必要があります。 |
| `enabled` | ✅ | bool | MCP に登録するかどうか。`false` にするとそのツールはスキップされます。 |
| `description` | ✅ | string | 完全な説明。複数行 Markdown 対応。AI および `resources/read` クエリで使用されます。 |
| `short_description` | 任意 | string | ツール一覧やトークン削減のための 20〜50 文字の要約。省略時は `description` の先頭が使われます。 |
| `args` | 任意 | string[] | コマンドラインの先頭に追加される固定引数。デフォルトのスキャンモードの指定によく使われます。 |
| `parameters` | 任意 | array | 実行時パラメータの一覧。後述の **パラメータ定義** を参照してください。 |
| `arg_mapping` | 任意 | string | パラメータマッピングモード(`auto`/`manual`/`template`)。デフォルトは `auto`。必要な場合のみ設定してください。 |

> フィールドに誤りがある、または必須フィールドが欠けている場合、ローダーはそのツールをスキップして警告をログに出力します。他のツールには影響しません。

## ツールの説明

### 短い説明 (`short_description`)

- **目的**: ツール一覧で使用し、モデルに送るトークン数を削減します。
- **ガイドライン**: ツールの主な用途を一文(20〜50 文字)で記述します。
- **例**: `"Network scanner for discovering hosts, open ports, and services"`

### 詳細な説明 (`description`)

複数行テキストを使い、以下を含めてください:

1. **機能**: ツールが何をするか。
2. **使用シナリオ**: いつ使うか。
3. **注意事項**: 注意点と安全上の留意事項。
4. **例**: 任意の使用例。

**補足**:
- ツール一覧では `short_description` が存在する場合それが使われます。
- `short_description` がない場合、システムは `description` の最初の行または先頭 100 文字を使用します。
- 完全な説明は MCP の `resources/read`(URI: `tool://tool_name`)で取得できます。

これにより特にツール数が多い場合(例: 100 個以上)のトークン使用量を大幅に削減できます。

## パラメータ定義

各パラメータには以下を含められます:

- `name`: パラメータ名。
- `type`: string、int、bool、array のいずれか。
- `description`: 完全な説明(複数行対応)。
- `required`: 必須かどうか(true/false)。
- `default`: デフォルト値。
- `flag`: CLI フラグ(例: `-u`、`--url`、`-p`)。
- `position`: 位置引数のゼロ始まりのインデックス。
- `format`: `"flag"`、`"positional"`、`"combined"`、`"template"` のいずれか。
- `template`: `format` が `"template"` の場合のテンプレート文字列。
- `options`: 列挙型で許可される値。

### パラメータ形式

- **`flag`**: フラグと値。例: `--flag value` または `-f value`
  - 例: `flag: "-u"` → `-u http://example.com`

- **`positional`**: position の順に追加されます。
  - 例: `position: 0` → 最初の位置引数。

- **`combined`**: `--flag=value` の単一トークン。
  - 例: `flag: "--level"`、`format: "combined"` → `--level=3`

- **`template`**: カスタムテンプレート。
  - 例: `template: "{flag} {value}"` → カスタム形式。

### 特殊パラメータ

#### `additional_args`

パラメータリストで定義されていない追加の CLI オプションを渡すために使用します。値はスペースで分割され、複数の引数になります。

**ユースケース:**
- ツールの高度なオプション。
- スキーマにないオプション。
- 複雑な引数の組み合わせ。

**例:**
```yaml
- name: "additional_args"
  type: "string"
  description: "Extra CLI arguments; separate multiple options with spaces"
  required: false
  format: "positional"
```

**使用例:**
- `additional_args: "--script vuln -O"` → `["--script", "vuln", "-O"]`
- `additional_args: "-T4 --max-retries 3"` → `["-T4", "--max-retries", "3"]`

**注意:**
- スペースで分割されます。引用符で囲まれた部分は保持されます。
- コマンドインジェクションを避けるため、有効な構文であることを確認してください。
- コマンドの末尾に追加されます。

#### `scan_type` (ツール固有)

一部のツール(例: `nmap`)は `scan_type` をサポートしており、デフォルトのスキャン引数を上書きできます。

**例 (nmap):**
```yaml
- name: "scan_type"
  type: "string"
  description: "Scan type options; overrides default scan arguments"
  required: false
  format: "positional"
```

**使用例:**
- `scan_type: "-sV -sC"` → バージョン検出とスクリプトスキャン。
- `scan_type: "-A"` → アグレッシブスキャン。

**注意:**
- 設定すると、そのツールのデフォルトスキャン引数を置き換えます。
- 複数のオプションはスペースで区切ります。

### パラメータ説明のガイドライン

パラメータの説明には以下を含めてください:

1. **目的**: そのパラメータが何をするか。
2. **形式**: 期待される形式(例: URL、ポート範囲)。
3. **値の例**: 具体的な例(複数ある場合はリスト)。
4. **注意事項**: 権限、パフォーマンス、安全性など。

**スタイル:**
- 可読性のため Markdown を使用してください。
- 重要な点には **太字** を使用してください。
- 複数の例やオプションにはリストを使用してください。
- 複雑な形式にはコードブロックを使用してください。

**例:**
```yaml
description: |
  Target IP or domain. Can be a single IP, range, CIDR, or hostname.

  **Example values:**
  - Single IP: "192.168.1.1"
  - Range: "192.168.1.1-100"
  - CIDR: "192.168.1.0/24"
  - Domain: "example.com"

  **Notes:**
  - Format must be valid.
  - Required; cannot be empty.
```

## パラメータの型

### 真偽値 (`bool`)

- `true`: フラグのみを追加します(例: `--flag`)。
- `false`: 引数を追加しません。
- 受け付ける値: `true`/`false`、`1`/`0`、`"true"`/`"false"`。

**例:**
```yaml
- name: "verbose"
  type: "bool"
  description: "Enable verbose output"
  required: false
  default: false
  flag: "-v"
  format: "flag"
```

### 文字列 (`string`)

汎用型。任意の文字列値。

### 整数 (`int` / `integer`)

数値(ポート、レベルなど)用。

**例:**
```yaml
- name: "level"
  type: "int"
  description: "Test level, 1-5"
  required: false
  default: 3
  flag: "--level"
  format: "combined"  # --level=3
```

### 配列 (`array`)

カンマ区切り文字列に変換されます。

**例:**
```yaml
- name: "ports"
  type: "array"
  item_type: "number"
  description: "Port list"
  required: false
  # 入力: [80, 443, 8080]
  # 出力: "80,443,8080"
```

## 例

`tools/` 配下の既存設定を参照してください:

- `nmap.yaml`: ネットワークスキャナー(`scan_type` と `additional_args`)。
- `sqlmap.yaml`: SQL インジェクション(`additional_args`)。
- `nikto.yaml`: Web サーバースキャナー。
- `dirb.yaml`: ディレクトリスキャナー。
- `exec.yaml`: システムコマンド実行。

### 完全な例: nmap

```yaml
name: "nmap"
command: "nmap"
args: ["-sT", "-sV", "-sC"]  # デフォルトのスキャンタイプ
enabled: true

short_description: "Network scanner for discovering hosts, open ports, and services"

description: |
  Network mapping and port scanning for hosts, services, and open ports.

  **Capabilities:**
  - Host discovery
  - Port scanning
  - Service/version detection
  - OS detection
  - NSE-based vulnerability checks

parameters:
  - name: "target"
    type: "string"
    description: "Target IP or domain"
    required: true
    position: 0
    format: "positional"

  - name: "ports"
    type: "string"
    description: "Port range, e.g. 1-1000"
    required: false
    flag: "-p"
    format: "flag"

  - name: "scan_type"
    type: "string"
    description: "Scan type options, e.g. '-sV -sC'"
    required: false
    format: "positional"

  - name: "additional_args"
    type: "string"
    description: "Extra nmap arguments, e.g. '--script vuln -O'"
    required: false
    format: "positional"
```

## 新しいツールの追加

`tools/` 配下に新しい YAML ファイルを作成します。例: `my_tool.yaml`:

```yaml
name: "my_tool"
command: "my-command"
args: ["--default-arg"]  # 任意の固定引数
enabled: true

# 短い説明(推奨)– ツール一覧用、トークン削減
short_description: "One-line summary of what the tool does"

# 完全な説明 – ドキュメントと AI 用
description: |
  Full description; multi-line and Markdown supported.

  **Capabilities:**
  - Feature 1
  - Feature 2

  **Usage:**
  - Scenario 1
  - Scenario 2

  **Notes:**
  - Caveats
  - Permissions
  - Performance

parameters:
  - name: "target"
    type: "string"
    description: |
      Target parameter description.

      **Example values:**
      - "value1"
      - "value2"

      **Notes:**
      - Format and limits
    required: true
    position: 0
    format: "positional"

  - name: "option"
    type: "string"
    description: "Option parameter"
    required: false
    flag: "--option"
    format: "flag"

  - name: "verbose"
    type: "bool"
    description: "Verbose mode"
    required: false
    default: false
    flag: "-v"
    format: "flag"

  - name: "additional_args"
    type: "string"
    description: "Extra arguments; separate with spaces"
    required: false
    format: "positional"
```

新しいツールを読み込むにはサービスを再起動してください。

### ベストプラクティス

1. **パラメータ設計**
   - よく使うパラメータを明示的に定義し、AI が利用できるようにします。
   - 高度なケースには `additional_args` を使用します。
   - 明確な説明と例を提供します。

2. **説明**
   - `short_description` を使ってトークンを削減します。
   - `description` は AI とドキュメントのために詳細に保ちます。
   - 可読性のため Markdown を使用します。

3. **デフォルト値**
   - よく使うパラメータに適切なデフォルトを設定します。
   - 真偽値は多くの場合 `false` がデフォルトです。
   - 数値はツールの動作に合わせます。

4. **検証**
   - 形式と制約を文書化します。
   - 複数の値の例を示します。
   - 制限や注意点を明記します。

5. **安全性**
   - 危険な操作や特権操作には警告を追加します。
   - 権限要件を文書化します。
   - 許可された環境でのみ使用するよう利用者に注意喚起します。

6. **実行時間とタイムアウト**
   - ツールが頻繁に長時間実行される場合(例: 10〜30 分経っても「実行中」のまま)、異常とみなし以下を行います:
     - **config.yaml** → `agent.tool_timeout_minutes`(デフォルト 10)を設定し、長時間の実行を停止してリソースを解放します。
     - より長い実行が必要な場合のみ値を増やします(例: 20、30)。`0`(無制限)は避けてください。
     - タスクモニターの「Stop task」で実行全体をキャンセルします。
     - キャンセルや内部タイムアウトをサポートするツールを優先し、グローバルタイムアウトと整合させます。

## ツールの無効化

ツールの設定で `enabled: false` にするか、ファイルを削除/リネームします。無効化されたツールは一覧に表示されず、AI からも呼び出せません。

## ツール設定の検証

読み込み時にシステムは以下を確認します:

- ✅ 必須フィールド: `name`、`command`、`enabled`。
- ✅ パラメータの構造と型。

無効な設定は起動時に警告を出しますが、サーバーの起動は妨げません。無効なツールはスキップされ、他のツールは通常通り読み込まれます。

## FAQ

### Q: 複数のパラメータ値を渡すには?

A: 配列パラメータはカンマ区切り文字列に変換されます。複数の独立した引数が必要な場合は `additional_args` を使用してください。

### Q: ツールのデフォルト引数を上書きするには?

A: 一部のツール(例: `nmap`)は `scan_type` パラメータをサポートしています。それ以外の場合は `additional_args` を使用してください。

### Q: ツールが 30 分以上「実行中」のままです。どうすればいいですか?

A: 通常は停止していることを意味します。以下が可能です:
1. **config.yaml** の `agent.tool_timeout_minutes`(デフォルト 10)を設定し、その分数を超えた単一のツール実行を停止します。
2. タスクモニターの「Stop task」で実行を即座に停止します。
3. ツールが正当により多くの時間を必要とする場合は `tool_timeout_minutes` を増やします(0 にするのは避けてください)。

### Q: ツールの実行が失敗した場合は?

A: 以下を確認してください:
1. ツールがインストールされ PATH 上にあること。
2. ツール設定が正しいこと。
3. パラメータ形式がツールの期待に合っていること。
4. 正確なエラーについてサーバーログを確認すること。

### Q: ツール設定をテストするには?

A: 設定テストユーティリティを使用します:
```bash
go run cmd/test-config/main.go
```

### Q: パラメータの順序はどう制御されますか?

A: 位置引数には `position` フィールドを使用します。**position 0**(例: gobuster の `dir` サブコマンド)はコマンドの直後、フラグ引数より前に配置されるため、「サブコマンド + オプション」を期待する CLI が動作します。その他のフラグは `parameters` に記載された順に追加され、続いて position 1、2、… の順に追加されます。`additional_args` は最後に追加されます。

## ツール設定テンプレート

### 基本テンプレート

```yaml
name: "tool_name"
command: "command"
enabled: true

short_description: "Short description (20-50 chars)"

description: |
  Full description: what it does, when to use it, and caveats.

parameters:
  - name: "target"
    type: "string"
    description: "Target parameter"
    required: true
    position: 0
    format: "positional"

  - name: "additional_args"
    type: "string"
    description: "Extra CLI arguments"
    required: false
    format: "positional"
```

### フラグパラメータ付きテンプレート

```yaml
name: "tool_name"
command: "command"
enabled: true

short_description: "Short description"

description: |
  Full description.

parameters:
  - name: "target"
    type: "string"
    description: "Target"
    required: true
    flag: "-t"
    format: "flag"

  - name: "option"
    type: "bool"
    description: "Option"
    required: false
    default: false
    flag: "--option"
    format: "flag"

  - name: "level"
    type: "int"
    description: "Level"
    required: false
    default: 3
    flag: "--level"
    format: "combined"

  - name: "additional_args"
    type: "string"
    description: "Extra arguments"
    required: false
    format: "positional"
```

## 関連ドキュメント

- メインプロジェクト README: プロジェクトルートの `README.md` を参照してください。
- ツール一覧: `tools/` 配下のすべての YAML 設定。
- API: 詳細はメイン README を参照してください。
