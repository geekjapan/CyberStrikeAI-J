# ビジョン分析（analyze_image）

[English](../en-US/VISION.md) | [中文](../zh-CN/VISION.md)

## 概要

- **ツール名**: `analyze_image`（MCP 組み込み）
- **動作**: ローカル画像を読み取り → `imaging` で縮小・JPEG 圧縮 → 独立した **Vision** モデルを呼び出し → **プレーンテキスト**をエージェントに返します
- **コンテキスト**: 画像のバイト列は会話履歴に**書き込まれません**。パスとテキストの要約のみがエージェントのコンテキストに入ります

## 設定（`config.yaml` → `vision`）

```yaml
vision:
  enabled: true
  model: qwen-vl-max   # 必須
  api_key:             # 空欄 → デフォルトの AI チャネルの api_key
  base_url:            # 空欄 → デフォルトの AI チャネルの base_url
  provider:            # 空欄 → デフォルトの AI チャネルの provider
  max_image_bytes: 5242880
  max_dimension: 2048
  jpeg_quality: 82
  max_payload_bytes: 524288
  skip_preprocess_below_bytes: 2097152  # 2MB 未満かつ長辺 <= max_dimension の場合は元画像をそのまま送信。0 = 常に JPEG 圧縮
  detail: low          # low | high | auto
  timeout_seconds: 60
```

`enabled: false` の場合、ツールは登録されません。

## Web 設定

**システム設定 → 基本設定 → ビジョン分析（analyze_image）** で、有効化スイッチ、ビジョンモデル、API Key / Base URL（空欄の場合はデフォルトの AI チャネルを再利用）、前処理パラメーターを設定できます。**保存して適用**すると `config.yaml` に書き込まれ、MCP ツールが再登録されます。

## パス

`analyze_image` は、サーバー上で読み取り可能な任意の画像ファイルパス（絶対パス、またはプロセスの作業ディレクトリからの相対パス）を読み取れます。画像の拡張子と通常ファイルであることは引き続き検証されます。

## エージェントでの利用

システムプロンプトには、画像に遭遇したら `analyze_image` を呼び出し、バイナリ画像に `read_file` を使わないよう記載されています。

`multi_agent.runtime.tool_search_always_visible_tools` には `analyze_image` を含めることを推奨します。

## コンプライアンス

有効にすると、画像は Vision API に設定されたアップストリームへ送信されます。機密性の高い環境では、信頼できるゲートウェイを使用するか、`enabled: false` のままにしてください。
