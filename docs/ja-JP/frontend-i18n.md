# フロントエンドの国際化

[English](../en-US/frontend-i18n.md) | [中文](../zh-CN/frontend-i18n.md)

フロントエンドは React + Semi Design のシングルページアプリケーションに移行済みで、国際化は `web/frontend/src/lib/i18n.jsx` が提供します。
辞書は、引き続きバックエンドと同じディレクトリの `web/static/i18n/*.json`（zh-CN / en-US / ja-JP / ru-RU / ar-SA）を再利用します。

## ランタイムの動作

- 言語の設定は `localStorage['csai_lang']` に保存されます。未設定の場合は `navigator.language` から推定し、デフォルトは `en-US` です。
- 起動時に、現在の言語と、フォールバック用の `en-US`、`ja-JP`、`zh-CN` の辞書を並行して読み込みます。欠落しているキーは「現在の言語 → en-US → ja-JP → zh-CN → 呼び出し元が指定する中国語のフォールバック」の順にフォールバックします。
- 言語を切り替えると `<html lang>` が更新されます。アラビア語では `<html dir>` が自動的に `rtl` に設定され、Semi の `ConfigProvider` を通じてコンポーネントの言語パックも切り替わります。
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
2. 辞書を追加する際は、`web/static/i18n/zh-CN.json`、`en-US.json`、`ja-JP.json` を同時に更新します。`ru-RU` / `ar-SA` は一時的に欠落していても構わず、フォールバックチェーンに任せます。
3. フォームのバリデーション、Toast、空状態の文言も `t(...)` を通します。
4. 時刻のフォーマットには `src/lib/format.js` の `formatDateTime/relativeTime` を使用し、日付を手作業で組み立てないでください。

## 辞書の構成

`web/static/i18n/zh-CN.json` は、業務ドメインごとにグループ化されています。`common`、`nav`、`dashboard`、`vulnerability`、`chat`、
`settings`、`knowledge`、`skills`、`roles`、`auth`、`apiDocs` などです。新しいグループを追加する場合は、2 階層のキー名
（`<domain>.<key>`）を維持し、深いネストによって可読性が損なわれないようにします。
