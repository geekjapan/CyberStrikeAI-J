# ツール実行ガバナンス

[English](../en-US/tool-execution-governance.md)

[日本語ドキュメントに戻る](README.md)

本書では、長時間実行されるツール、MCP のブロック、大きな出力、キャンセル、コンテキストの復元に対する CyberStrikeAI のガバナンス方針を説明します。目的は、Agent が標準的なツールセマンティクスを維持しつつ、ツールのハング、コンテキストの肥大化、データベースの膨張、復元時の過去の大きな出力の再注入を防ぐことです。

## 設計目標

- **Agent がツールに縛られない**：ツール呼び出しが遅くても、現在の runner が待機するのは限られた時間だけです。
- **長時間タスクを継続して観察できる**：タイムアウト時に `execution_id` を返し、以降は `wait_tool_execution` で複数回にわたって待機できます。
- **ユーザーも Agent もキャンセルできる**：現在の会話が終了した場合やユーザーがタスクを停止した場合、実行中のツールをキャンセルします。
- **データベースと Agent のビューが一致する**：DB に保存されるのは Agent が実際に受け取ったフォールバック処理後の結果であり、元の大きな出力を別途保存することはありません。
- **復元でコンテキストが溢れない**：再開には model-facing trace を使用し、過去に保存された異常に大きな tool trace も復元時に再度トリミングされます。
- **外部 MCP の分離保護**：server ごとの同時実行数制限とグローバルな同時実行数制限を設け、連続して失敗した server に対してはサーキットブレーカーが作動します。

## 実行モデル

通常のツール呼び出しは、Pi/Agent からは従来どおり 1 回の標準的な tool call に見えますが、内部の実行は 2 段階に分かれます。

```text
Agent がツールを呼び出す
  -> ExecutionService が execution を作成
  -> worker が実際の MCP/ツール呼び出しを実行
  -> Agent bounded wait
       -> 完了：ツール結果を返す
       -> 未完了：execution_id を返し、worker はバックグラウンドで実行を継続
```

これにより、MCP server、`exec`、`sqlmap`、`nmap`、`nuclei` などの長時間タスクが現在の runner をブロックする問題を解決します。

## ツールの状態セマンティクス

| 状態 | 意味 |
|---|---|
| `queued` | execution が作成済みで、worker または同時実行スロットを待機中 |
| `running` | worker が実行中 |
| `background_running` | フロントエンドの表示状態。今回の Agent は待機を打ち切ったが、バックグラウンドでは実行が続いていることを示す |
| `completed` | この tool call 自体が完了した |
| `failed` | ツールが実際に失敗した |
| `cancelled` | ユーザー、Agent、または会話のクリーンアップによって能動的にキャンセルされた |
| `hard_timeout` | ハードタイムアウトを超過し、システムによって終了された |
| `orphaned` | 再起動や異常の後、DB 上は running のままだが、ランタイムに対応する worker が存在しないことが判明した |

注意：`wait_tool_execution` が `timeout_seconds` に達した時点で対象の execution がまだ実行中の場合、**この wait 呼び出し自体は完了した観察アクション**であり、ツール実行の失敗ではありません。レスポンスには対象がなお `running` であることが記載され、フロントエンドは赤い失敗表示にしてはいけません。

## 制御ツール

| ツール | 用途 |
|---|---|
| `get_tool_execution` | execution の現在の状態を読み取る |
| `wait_tool_execution` | 指定した execution を一定時間待機する |
| `cancel_tool_execution` | 指定した execution を能動的にキャンセルする |

`get_tool_execution` と `wait_tool_execution` は、実行中の出力プレビューを返すことをサポートしています。

- `include_partial_output`：partial output を返すかどうか。デフォルトは `true` です。
- `partial_output_max_bytes`：今回返す末尾プレビューの上限。デフォルトは `4096`、最大は `65536` です。

partial output は「これまでに生成された出力の上限付きプレビュー」であり、最終的な `result` と同じではありません。最終的な `result` は、ツール終了時にのみ canonical execution レコードへ書き込まれます。ストリーミング出力をサポートしないツールは partial フィールドを返しません。

典型的なフロー：

```text
1. exec/sqlmap/nmap などの長時間タスクを呼び出す
2. tool_wait_timeout_seconds を超えると execution_id を受け取る
3. Agent は推論を続ける、他のツールに切り替える、または wait_tool_execution を呼び出せる
4. なお未完了の場合は、待機を続けるか、cancel_tool_execution を呼び出せる
```

`tool_wait_timeout_seconds` は、内部 MCP、外部 MCP、および Pi filesystem のストリーミング `execute` に適用されます。Pi の `ls/read_file/write_file/edit_file/glob/grep` などの非ストリーミング filesystem ツールは execution 監視レコードに書き込まれますが、バックグラウンド worker としてソフト待機や再開を行うことはありません。

## キャンセルと会話のクリーンアップ

- ユーザーが「タスクを停止」をクリックすると、現在の会話でまだ実行中のツールをキャンセルします。
- 会話が正常に終了すると、現在の会話でまだ `running` のツールを一括でキャンセルします。
- 「中断して続行」系のフローでは、後から待機が必要な worker を誤って停止させないよう、会話単位の一括キャンセルは行いません。
- キャンセルの対象は、現在の conversation に紐づく execution のみです。他の会話のツールを誤って停止することはありません。

## 外部 MCP の分離

外部 MCP は、リモート server のハング、切断、異常な応答によって Agent を遅くする可能性があります。システムは 3 層の保護を提供します。

| 機能 | 設定 | 説明 |
|---|---|---|
| server ごとの同時実行数制限 | `external_mcp_max_concurrent_per_server` | 同一の外部 MCP server 上で同時に実行されるツールの数 |
| グローバルな同時実行数制限 | `external_mcp_max_concurrent_total` | すべての外部 MCP ツールの合計同時実行数 |
| サーキットブレーカー | `external_mcp_circuit_failure_threshold` / `external_mcp_circuit_cooldown_seconds` | 単一の server で連続して失敗した後、短期間は即座に失敗させ、server への繰り返しの負荷を避ける |

推奨デフォルト：

```yaml
agent:
  external_mcp_max_concurrent_per_server: 2
  external_mcp_max_concurrent_total: 16
  external_mcp_circuit_failure_threshold: 3
  external_mcp_circuit_cooldown_seconds: 60
```

## 出力のフォールバック

システムは `multi_agent.runtime.reduction_max_length_for_trunc` を、ツール結果の統一上限として使用します。現在のサンプル設定は 50000 bytes です。

```yaml
multi_agent:
  runtime:
    reduction_enable: true
    reduction_max_length_for_trunc: 50000
```

フォールバックの対象範囲：

| チャネル | 動作 |
|---|---|
| Agent が実際に受け取るツール結果 | フォールバック後の canonical result を使用する |
| DB/監視ストレージ | 同じ canonical result を保存する |
| `get_tool_execution` / `wait_tool_execution` | 同じ canonical result を読み取る |
| Pi `execute` / filesystem 監視レコード | レコードの完了前に統一してフォールバックする |
| 非ストリーミング `exec` の stdout/stderr | 出力元で bounded buffer を使用する |
| ストリーミング `exec` の stdout/stderr | フロントエンドへ送信する累積出力にも上限が適用される |
| PTY 実行パス | 同様に上限が適用される |
| フロントエンドの詳細ダイアログ | さらに UI 表示用の切り詰め保護がある |

上限に達すると、完全な出力はまずローカルの trunc ファイルに書き込まれ、Agent 側にはバジェットに算入される `<persisted-output>` プレビュー（絶対パスを含む）だけが残ります。したがって、しきい値が 50000 の場合、コンテキストのテキストがこの上限を超えることはありません。

例：

```text
<persisted-output>
Output too large (200000). Full output saved to: /path/to/tmp/reduction/conversations/<id>/trunc/<execution_id>
Use read_file with offset/limit to read parts of the file.
Preview (first …):
…

Preview (last …):
…

</persisted-output>
```

現在の方針は「全文をディスクへ保存 + コンテキストにはプレビュー」です。`reduction_max_length_for_trunc` を超えると、完全な出力がローカルファイル（デフォルトは `tmp/reduction/conversations/<conversationId>/trunc/<execution_id>`）に書き込まれ、Agent/DB/監視が受け取るのは絶対パス付きの `<persisted-output>` プレビューになります。`read_file` で offset/limit を指定して全文を読み戻せます。

## DB と復元コンテキスト

新しい実行結果の書き込みパスは次のとおりです。

```text
ツール完了
  -> NormalizeToolResultForStorage
  -> メモリ上の execution に書き込み
  -> DB に書き込み
  -> Agent に返却
```

そのため、通常は DB に保存されているものが、Agent が受け取った結果そのものになります。

再開時には、システムは `LastAgentTraceInput` 内の model-facing trace、つまり実際に ChatModel へ送られたメッセージのスナップショットを使用し、元のイベントストリームの累積は使用しません。復元の入口では、過去の tool コンテンツにも再度上限を適用し、次のような場合にコンテキストが溢れるのを防ぎます。

- アップグレード前の DB に、元の大きな出力がすでに保存されている。
- 手動での移行やインポートされたデータが、現在の書き込みパスを迂回している。
- 設定がより大きなしきい値から 50000 に変更された。
- 将来、ある迂回的な書き込みで canonicalize が漏れた。

## 主要な設定の推奨

長時間タスクのシナリオでの推奨設定：

```yaml
agent:
  max_iterations: 800
  tool_timeout_minutes: 60
  tool_wait_timeout_seconds: 30
  external_mcp_max_concurrent_per_server: 2
  external_mcp_max_concurrent_total: 16
  external_mcp_circuit_failure_threshold: 3
  external_mcp_circuit_cooldown_seconds: 60
  shell_no_output_timeout_seconds: 1200

multi_agent:
  runtime:
    reduction_enable: true
    reduction_max_length_for_trunc: 50000
```

パラメータの説明：

| パラメータ | 推奨 | 説明 |
|---|---:|---|
| `max_iterations` | `300-1000` | 大きすぎるとループ保護を放棄するのと同じ |
| `tool_timeout_minutes` | `60` | 単一ツールのハードタイムアウト。sqlmap などの長時間タスク向け |
| `tool_wait_timeout_seconds` | `30-60` | Agent が今回の待機に使う上限。到達すると `execution_id` を返す |
| `shell_no_output_timeout_seconds` | `600-1200` | 出力がない状態が続いた場合に終了し、無言のハングを防ぐ |
| `reduction_max_length_for_trunc` | `50000` | ツール結果の統一上限 |

`tool_wait_timeout_seconds` を非常に大きく設定することは推奨しません。長時間タスクは worker がバックグラウンドで実行し、Agent は `execution_id` を通じて観察を続けるべきであり、1 回の待機で数分間も待つべきではありません。

## テストの推奨

次の会話で、長時間タスクのセマンティクスをテストできます。

```text
exec で sleep 120 を実行してください。10 秒を超えても完了しない場合は、待ち続けずに execution_id を教えてください。その後 wait_tool_execution で 5 秒待機し、それでも未完了であれば cancel_tool_execution を呼び出し、最後に状態を説明してください。
```

次のコマンドで、大きな出力のフォールバックをテストできます。

```text
exec で次を実行してください：python3 - <<'PY'
print("A" * 200000)
PY
その後、ツール結果の長さと、切り詰めの表示が含まれているかどうかを示してください。
```

期待される結果：

- 最初の長時間タスクは `execution_id` を返し、状態は `running`、またはフロントエンドでは `background_running` と表示されます。
- `wait_tool_execution` が上限まで待機しても対象が未完了の場合、この wait 呼び出しは実行失敗として表示されるべきではありません。
- 大きな出力の結果が `reduction_max_length_for_trunc` を超えることはありません。
- DB、監視の詳細、Agent が推論を続ける際に見るものは、同じフォールバック後の結果です。

## 現在の制約

- 外部 MCP のリモート server が内部でどのように出力を収集するかは CyberStrikeAI の管理下にありません。CyberStrikeAI は、結果が本システムに入った後で、統一的にフォールバック、同時実行数の制限、サーキットブレーカーを適用します。
- 非常に長いツール出力は、切り詰める前にローカルの `tmp/reduction/.../trunc/<id>`（または `reduction_root_dir`）へ書き込まれ、bounded result には `read_file` で読み取れる絶対パスが含まれます。

## 今回のタスクのプロセスライフサイクル

各タスクには独立した `runId` があり、ローカルプロセスと非同期 MCP worker はどちらも context を通じて所属を保持します。context のキャンセル、ツールの返却、SSE の切断は、リソースが回収されたことを意味しません。

- `exec ... &` と Pi のバックグラウンド実行は即座に返りますが、引き続き今回のタスクに属します。タスクへの所属がないバックグラウンド起動は拒否されます。フォアグラウンドのツールは終了時に残存する子プロセスをクリーンアップします。ツール呼び出しをまたいで実行されるタスクには、明示的なバックグラウンドの入口を使用してください。
- 完了、失敗、タイムアウトによる終了処理、ユーザーによる停止、サービスの正常なシャットダウンのいずれでも、起動の入口を閉じ、worker をキャンセルし、プロセスを終了させ、回収を待機します。「中断して続行」では今回のタスクへの所属を維持します。
- Unix ではまずプロセスグループが自発的に終了するのを待ち、その後に強制終了して検証します。環境変数 `CS_CLEANUP_GRACE`、`CS_CLEANUP_KILL`、`CS_CLEANUP_GUARD` は、それぞれ自発的な終了、SIGKILL 後の回収、分離バックエンドの待機時間を制御します。正の Go duration（例：`10s`）を受け付け、未設定または無効な場合は、それぞれ 3 秒を使用します。通常のクリーンアップに失敗した場合は `cleanup_failed` とプロセスグループ/worker ID を保持し、15 秒ごとの巡回で再試行します。
- ツール worker の登録とタスクのクローズは排他制御されます。MCP が `WithoutCancel` を使用していても、タスクはその終了を待機します。古いタスクの遅延コールバックが、新しいタスクのプロセスを引き継いだり、新しい worker を送信したりすることはできません。

Linux では、直接の子プロセスを回収した後、ゾンビプロセスだけが残ったグループは終了済みとみなされます。プロセスグループ watchdog を使用している場合、クリーンアップがタイムアウトし、かつグループ内で生存しているメンバーがすべて D 状態で、すでに配信待ちの SIGKILL がある場合は、ローカル worker の終了を待った後、タスクは `cleanup_unconfirmed` として記録されます。サービスログには run ID と PGID が記録され、プロセスのブロックが解除された後、カーネルが保留中のシグナルを処理します。cgroup と Windows Job Object は、引き続きバックエンド自身の仕組みでクリーンアップを検証します。

### オペレーティングシステムによる分離とクラッシュ時の回収

| プラットフォーム | 実装 | クラッシュ時の回収と制限 |
| --- | --- | --- |
| Linux、cgroup v2 設定済み | タスクごとに独立した cgroup を作成し、`clone3(CLONE_INTO_CGROUP)` で作成時にグループへ所属させる。プロセス数、メモリ、CPU の上限を設定する | 独立したデーモンが、メインプログラムのパイプの EOF 後に `cgroup.kill` を書き込み、`populated=0` を検証する。起動時に委譲されたルートを排他的に取得し、残存したタスクグループを回収する。`setsid` では cgroup から離脱できない |
| Windows | タスクごとの Job Object。デーモンが先に Job に参加し、タスクはアトミックな親プロセス属性によって Job を継承する。起動後に割り当てる際の競合を回避する | `KILL_ON_JOB_CLOSE`、能動的な `TerminateJobObject`、アクティブなプロセス数の検証。プロセス数、メモリ、オプションの CPU 上限 |
| macOS／cgroup 未設定の Unix | 独立したプロセスグループとデーモン。子プロセスは、登録の確認前はパイプで待機する | メインプログラムが強制終了された後は、パイプの EOF によりグループ全体のクリーンアップが作動する。能動的な `setsid` による脱出は制限できず、強い分離が必要なデプロイには使用できない |

デーモン自身が異常終了した場合も、生存しているホストが対応するリソースを終了させます。IPC にはタイムアウトがあります。Linux での残存の回収は、排他的なディレクトリとランダムなタスク識別子に基づき、過去の PID を再生しません。

これはライフサイクルの分離であり、同一権限の悪意あるコードに対する完全なセキュリティサンドボックスではありません。cgroup を変更できる、外部の親プロセスのハンドルを取得できる、あるいはホストとデーモンを強制終了できるプログラムに対しては、コンテナ/異なる OS ID および権限ポリシーによる制限が引き続き必要です。Linux のコンテナ環境にデプロイする場合は、init を使用して孤児プロセスを回収してください。`required` モードでは、対応するカーネル機能や権限が不足している場合は実行を拒否し、黙ってダウングレードすることはありません。

### 設定とリリース

デフォルトの `auto` は、Windows では Job Object を使用します。Unix では、cgroup のルートが指定されていない場合はプロセスグループ watchdog を使用します。Linux の本番デプロイでは、独立した systemd サービスを設定し、`Delegate=cpu memory pids`、`KillMode=control-group`、`Restart=on-failure` を設定したうえで、次の厳格な分離設定を **既存の設定にマージ** してください。

```yaml
security:
  process_isolation:
    mode: required
    cgroup_root: auto
    max_processes: 256
    memory_max_bytes: 2147483648
    cpu_quota_micros: 200000
```

Linux 5.14 以上、cgroup v2、`clone3` の許可、および `Delegate=cpu memory pids` が必要です。`cgroup_root: auto` は、systemd の独立した委譲ユニット用です。管理された絶対パスを指定することもできますが、ホスト全体の階層ルートの使用は禁止されています。設定の変更には再起動が必要です。Windows では `cgroup_root` を空のままにして `required` を使用できます。macOS の `required` は明確にエラーを返します。

サービスの起動時には、実際に検証用プロセスを作成して回収し、権限とカーネルのサポートを検証します。HTTP/MCP サービスを起動せずに単独で実行することもできます。

```sh
./cyberstrike-ai --check-process-isolation -config config.yaml
```

出力は `cgroup_v2`、`windows_job`、`process_group_watchdog` のいずれかです。実行中/履歴タスク API の `isolationBackend` フィールドは、タスクごとに実際に採用されたバックエンドを示します。systemd の `KillMode=control-group` と失敗時の再起動は、サービス全体に対する追加のバックストップとなり、タスクごとの cgroup と併用されます。

### リモート MCP のキャンセル

通常の MCP キャンセル通知には、リモート側での終了を確認する受領通知がありません。アダプターは `ExternalCancellationConfirmer` を実装でき、サーバー側のタスク状態、リース、またはキャンセルの受領通知を使って終了を確認します。確認がない場合は、「終了済み」とは記録されません。ツールレコードは理由を付けて `orphaned` として永続化され、ローカル worker とプロセスのクリーンアップが完了した後、タスク履歴には `cleanup_unconfirmed` が残り、レスポンスにはリモートの状態が確認待ちであることが明示されます。これは自動再試行の成功ではなく、リモートに残存物がゼロであることの保証でもありません。まだ戻っていないローカル worker は `cleanup_failed` のままとなり、引き続き追跡されます。

### 回帰検証

```sh
go test -race ./internal/processguard ./internal/mcp ./internal/handler ./internal/security
```

`Process isolation` GitHub Actions ワークフローは、Linux cgroup の統合テストも実行します。コマンドは `.github/workflows/process-isolation.yml` に直接保存されています。このテストは、使い捨てで専用の cgroup 名前空間を持つ Docker コンテナを使用し、ホストの cgroup や Docker socket はマウントしません。テストは、ホストの `SIGKILL`、起動登録の競合、`setsid`、リソース上限、起動時の残存回収、worker のキャンセル、リモートの未確認状態を対象としています。Windows Job Object のテストはクロスプラットフォーム CI に組み込まれています。クロスコンパイルは Windows 実機でのテストと同じではありません。

参考：[Go os/exec](https://pkg.go.dev/os/exec)、[Linux cgroup v2](https://cdn.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)、[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)。
