# ネイティブエージェント実行の終了処理とタスク検収

[English](../en-US/agent-finalization-best-practices.md) | [中文](../zh-CN/agent-finalization-best-practices.md)

Pi の `agent_settled` は、今回のモデル実行がこれ以上自動的に継続しないことを示します。業務タスクが完了したかどうかは、引き続き Go の実行状態、ツール記録、検収条件によって決まります。

## 単一の実行

`internal/agentfinalizer` は、シングルエージェント、マルチエージェント、ボット、および関連するタスクの入口を統一的に処理します。アシスタントのテキストは、成果物の候補にすぎません。

- 反復回数の上限、失敗、キャンセル、待機状態を、通常のテキストで完了に上書きしてはなりません。
- 未完了のツール execution ID は保持し、処理しなければなりません。
- 実際の実行が必要なリクエストには、完了済みのツール実行の証拠が必要です。
- 空のテキストやプレースホルダーの返信を、成功した成果物として扱ってはなりません。
- メインエージェントがサブエージェントの結果を集約します。サブエージェントの「完了」の一言は、元の実行記録の代わりにはなりません。

プロセスイベント、思考、ツール出力、最終成果物は分けて記録されます。終了ツールの final_result も、ホストによる検収を経由し、これらのルールを回避することはできません。

実装：`internal/agentfinalizer/decision.go`、`internal/multiagent/pi_runner.go`。SDK のライフサイクルについては [Pi SDK](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/sdk.md) を参照してください。
