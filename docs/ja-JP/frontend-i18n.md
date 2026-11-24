# フロントエンドの国際化

[English](../en-US/frontend-i18n.md) | [中文](../zh-CN/frontend-i18n.md)

フロントエンドは React + Semi Design のシングルページアプリケーションに移行済みで、国際化は `web/frontend/src/lib/i18n.jsx` が提供します。
辞書は、引き続きバックエンドと同じディレクトリの `web/static/i18n/*.json`（zh-CN / en-US / ja-JP）を再利用します。

## ランタイムの動作

- 言語の設定は `localStorage['csai_lang']` に保存されます。未設定の場合は `navigator.language` から推定し、デフォルトは `en-US` です。
- 起動時に、現在の言語と、フォールバック用の `en-US`、`ja-JP`、`zh-CN` の辞書を並行して読み込みます。欠落しているキーは「現在の言語 → en-US → ja-JP → zh-CN → 呼び出し元が指定する中国語のフォールバック」の順にフォールバックします。
- 言語を切り替えると `<html lang>` が更新され、Semi の `ConfigProvider` を通じてコンポーネントの言語パックも切り替わります。
- 言語の切り替えでページはリロードされません。`useT()` が返す `t` は、Provider の再レンダリングに合わせて更新されます。

## ページでの使い方

```jsx
const t = useT();
t('vulnerability.title');                       // 辞書にキーが存在する場合
t('common.minutesAgo', { n: 5 });               // {{n}} の補間に対応
t('chat.unknownKey', null, '中文兜底');          // キーが欠落している場合は第 3 引数を使用
```

要件：

1. 表示される文言はすべて `t(...)` を通し、第 3 引数に中国語のフォールバックを書いて、生のキーが表示されないようにします。
2. 辞書を追加する際は、`web/static/i18n/zh-CN.json`、`en-US.json`、`ja-JP.json` を同時に更新します。
3. フォームのバリデーション、Toast、空状態の文言も `t(...)` を通します。
4. 時刻のフォーマットには `src/lib/format.js` の `formatDateTime/relativeTime` を使用し、日付を手作業で組み立てないでください。
5. コンポーネントの外（ヘルパー、定数テーブル）では、`src/lib/i18n.jsx` の `translate(key, vars, fallback)`、`lazyLabels(prefix, map)`、`lazyOptions(prefix, options)` を使用します。`translate` をモジュールのトップレベルで呼び出さないでください。import 時点の言語に固定されます。
6. ソースで使用しているキーが `en-US.json` にない場合、または `ja-JP.json` が他の 2 ファイルを網羅していない場合、`go test ./internal/handler -run Locale` が失敗します。

## サーバーのメッセージ

ソースコードは英語で書きます(メッセージ、コメント、プロンプト、定義ファイル)。`internal/apimsg/catalog.json` は、サーバーがクライアントへ送る英語メッセージを中国語(`zh`)と日本語(`ja`)に対応付けます。`internal/apimsg` はこれを 3 か所で適用します。ステータス 400 以上の JSON 応答の `error` / `message`、サーバーが書いたチャットのストリームイベントの `message`(モデルやツールの出力は対象外)、会話履歴を読むときの同じメッセージです。フロントエンドは UI 言語を `Accept-Language` で送ります。`lang` クエリパラメータがあればそれを優先します。既定は英語で、英語のリクエストは変換しません。カタログに無い文言は英語のまま表示されます。`c2_disabled` のような機械判定用コードは翻訳しません。

メッセージを追加・変更するときは英語で書き、`catalog.json` に `zh` と `ja` を追加します。クライアントへ送るメッセージに訳が無いと `go test ./internal/apimsg` が失敗します。`APIMSG_DUMP=/tmp/missing.json go test ./internal/apimsg -run Covers` で、下位層のエラーを含む未翻訳の一覧を出力できます。翻訳リソースと `internal/handler/testdata/cjk_allowlist.txt` に挙げた行以外に中国語・日本語があると、`go test ./internal/handler -run TestRepositoryIsEnglish` が失敗します。

## 辞書の構成

`web/static/i18n/zh-CN.json` は、業務ドメインごとにグループ化されています。`common`、`nav`、`dashboard`、`vulnerability`、`chat`、
`settings`、`knowledge`、`skills`、`roles`、`auth`、`apiDocs` などです。新しいグループを追加する場合は、2 階層のキー名
（`<domain>.<key>`）を維持し、深いネストによって可読性が損なわれないようにします。
