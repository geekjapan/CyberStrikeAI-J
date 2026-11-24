# 前端国际化

[English](../en-US/frontend-i18n.md) | [日本語](../ja-JP/frontend-i18n.md)

前端已迁移为 React + Semi Design 单页应用，国际化由 `web/frontend/src/lib/i18n.jsx` 提供，
词条继续复用后端同目录 `web/static/i18n/*.json`（zh-CN / en-US / ja-JP）。

## 运行时行为

- 语言偏好保存在 `localStorage['csai_lang']`，未设置时按 `navigator.language` 推断，默认 `en-US`。
- 启动时并行加载当前语言与 `en-US`、`ja-JP`、`zh-CN` 兜底词条；缺失的键按「当前语言 → en-US → ja-JP → zh-CN → 调用方兜底中文」回退。
- 切换语言会更新 `<html lang>`，并通过 Semi `ConfigProvider` 切换组件语言包。
- 语言切换不会刷新页面；`useT()` 返回的 `t` 会随 Provider 重新渲染。

## 在页面里使用

```jsx
const t = useT();
t('vulnerability.title');                       // 词条里存在键
t('common.minutesAgo', { n: 5 });               // 支持 {{n}} 插值
t('chat.unknownKey', null, '中文兜底');          // 键缺失时用第三参数
```

要求：

1. 可见文案统一走 `t(...)`，第三个参数写中文兜底，避免出现原始 key。
2. 新增词条时同时更新 `web/static/i18n/zh-CN.json`、`en-US.json` 与 `ja-JP.json`。
3. 表单校验、Toast、空态文案同样走 `t(...)`。
4. 时间格式化使用 `src/lib/format.js` 的 `formatDateTime/relativeTime`，不要手拼日期。
5. 组件之外（工具函数、常量表）使用 `src/lib/i18n.jsx` 的 `translate(key, vars, fallback)`、`lazyLabels(prefix, map)`、`lazyOptions(prefix, options)`。不要在模块顶层调用 `translate`，否则语言会固定为导入时的语言。
6. 源码引用的词条在 `en-US.json` 中缺失，或 `ja-JP.json` 未覆盖另外两个文件时，`go test ./internal/handler -run Locale` 会失败。

## 服务端消息

源代码使用英文编写（消息、注释、提示词、定义文件）。`internal/apimsg/catalog.json` 把服务端发给客户端的英文消息对应到中文（`zh`）和日文（`ja`）。`internal/apimsg` 在三处应用它：状态码 400 及以上的 JSON 响应的 `error` / `message` 字段、由服务端写入的对话流事件的 `message`（不含模型和工具输出），以及读取对话历史时的同类消息。前端通过 `Accept-Language` 发送界面语言；`lang` 查询参数优先；默认英文，英文请求原样返回。目录中没有的文本显示英文。`c2_disabled` 这类机器可读代码不翻译。

新增或修改消息时用英文书写，并在 `catalog.json` 中补上 `zh` 和 `ja`。发给客户端的消息缺少条目时 `go test ./internal/apimsg` 会失败；`APIMSG_DUMP=/tmp/missing.json go test ./internal/apimsg -run Covers` 可列出包括底层错误在内的全部未翻译消息。翻译资源和 `internal/handler/testdata/cjk_allowlist.txt` 所列行之外出现中文或日文时，`go test ./internal/handler -run TestRepositoryIsEnglish` 会失败。

## 词条组织

`web/static/i18n/zh-CN.json` 按业务域分组：`common`、`nav`、`dashboard`、`vulnerability`、`chat`、
`settings`、`knowledge`、`skills`、`roles`、`auth`、`apiDocs` 等。新增分组时保持两级键名
（`<domain>.<key>`），避免深层嵌套影响可读性。
