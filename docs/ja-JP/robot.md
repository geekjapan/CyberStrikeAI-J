# CyberStrikeAI ボット利用ガイド

[English](../en-US/robot.md)

本ドキュメントでは、**個人 WeChat、WeCom、DingTalk、Lark、Telegram、Slack、Discord、QQ ボット**から CyberStrikeAI を利用する方法を説明します。プラットフォームとの接続、RBAC ID の紐付け、サービスアカウントのホワイトリスト、コマンド、動作確認、トラブルシューティングを扱います。

---

## 1. CyberStrikeAI での設定場所

現在の Web 画面には、ボット設定画面はありません。ボットの設定は、`config.yaml` の `robots` セクションを編集して CyberStrikeAI を再起動するか、`PUT /api/config` を呼び出して行います。

**`config.yaml` を編集する場合**

- ファイルは起動時に一度だけ読み込まれ、変更は監視されません。編集したら必ず CyberStrikeAI のプロセスを再起動してください。
- プラットフォームが接続されるのは、`enabled: true` で、かつ認証情報が空でない場合だけです。有効にしても認証情報が空だと、エラーも出ずに接続がスキップされます。
- `robots.<platform>.auth` は起動時に検証されます。未知の `mode`、`service_user_id` または `allowed_external_users` のない `service_account`、重複する項目や `*` を含む項目があると、サーバーは起動しません。
- `config.example.yaml` に、コメントアウトされた `robots:` のひな形があります。

**`PUT /api/config` を呼び出す場合**

- `GET /api/config` は、現在の `robots` ブロックを**シークレットを含めて**返します（`config:read` が必要）。`PUT /api/config` と `POST /api/config/apply` には `config:write` が必要です。
- `robots` を含む `PUT /api/config` は、内容を検証したうえで（有効時の WeCom Token、`auth` のルール、サービスユーザーが存在し有効であること）、メモリ上の **`robots` オブジェクト全体を置き換え**、`config.yaml` に書き込みます。変更したプラットフォームだけでなく、ブロック全体を送ってください。
- `PUT` だけではボットの接続は再起動**されません**。再起動するのは `POST /api/config/apply` です（長時間接続しているすべてのボット接続を再起動し、ツールなどほかの設定も再読み込みします）。
- `PUT` は `auth`（`mode`、`service_user_id`、`allowed_external_users`）を `config.yaml` に書き込み**ません**。API で変更した `auth` は実行中のプロセスにだけ反映され、再起動すると失われます。`auth` は YAML ファイルで編集してください。
- 保存（`PUT`、または WeChat の QR 連携の成功）のたびに、`config.yaml` の `robots` のキーが実行中のプロセスの値で書き直されます。YAML を手で編集した場合は、これらの API を呼ぶ前に再起動してください。そうしないと、編集内容が上書きされます。

```bash
# ログインしてトークンを取得します（api-recipes.md の Recipe 1 を参照）
curl -k https://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}'

# 例: Telegram を有効にします。robots を取得し、2 つのキーを変更し、ブロック全体を送り返してから適用します。
curl -sk https://127.0.0.1:8080/api/config -H "Authorization: Bearer <token>" \
  | jq '{robots: (.robots | .telegram.enabled=true | .telegram.bot_token="<bot-token>")}' > robots.json
curl -k -X PUT https://127.0.0.1:8080/api/config \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d @robots.json
curl -k -X POST https://127.0.0.1:8080/api/config/apply -H "Authorization: Bearer <token>"
rm robots.json   # シークレットが含まれています
```

ログインのレスポンスには `token` が含まれます。以降のコマンドも同じベース URL `https://127.0.0.1:8080` と `Authorization: Bearer <token>` ヘッダーを使います。環境に合わせて読み替えてください。以降のプラットフォーム別の節にある「再起動」は、プロセスの再起動を指します。`PUT /api/config` で設定を変更した場合は `POST /api/config/apply` を呼び出します。

### 最短の利用手順

プラットフォームへの接続が成功したら、すぐに通常の会話を始めず、先に業務上の ID 設定を完了してください。

**自分だけで利用する場合（デフォルトの手順）**

1. ボットに `whoami` を送信し、`Sender ID` の行をそのままコピーします。ID の形式はプラットフォームによって異なります（個人 WeChat は `xxxx@im.wechat`、DingTalk / Lark / Slack は `t:<tenant>|u:<user>`、Telegram / Discord / QQ の個別チャットは `u:<id>`）。
2. `config.yaml` で、そのプラットフォームの `auth` ブロックを設定します。

   ```yaml
   robots:
     wechat:   # dingtalk、lark、wecom、telegram、slack、discord、qq も同様です
       auth:
         mode: service_account
         service_user_id: admin          # 表示名ではなく RBAC ユーザー ID
         allowed_external_users:
           - "<whoami からコピーした Sender ID>"
   ```

3. CyberStrikeAI を再起動し、もう一度 `whoami` を送信します。

**複数人で利用する場合**: `auth` は記述しません（デフォルトは `user_binding` です）。各利用者が紐付けコードを取得し、ボットに `bind` コマンドを送信して、`whoami` で確認します。画面がないため、紐付けコードは `POST /api/auth/robot-binding-code` で取得します。詳しくは [4.2 ユーザー単位の紐付けモード](#42-ユーザー単位の紐付けモードデフォルト) を参照してください。

`Auth status: authorized` が表示され、`Effective identity` の行が期待どおりであることを確認できたら、そのまま通常のテキストを送信して AI と会話できます。

---

## 2. 対応プラットフォーム（ロングコネクション / コールバック）

| プラットフォーム | 説明 |
|----------|------|
| 個人 WeChat | WeChat iLink プロトコルを使用します。API で QR コードを取得してスキャンし連携した後、ロングポーリングでメッセージを受信するため、**公開コールバックは不要**です |
| DingTalk | Stream ロングコネクションを使用します。プログラムが DingTalk に接続してメッセージを受信します |
| Lark | ロングコネクションを使用します。プログラムが Lark に接続してメッセージを受信します |
| WeCom | HTTP コールバックでメッセージを受信します。パッシブ返信と、WeCom のメッセージ送信 API の呼び出しによる能動送信を併用します |
| Telegram | Bot API ロングポーリング（getUpdates）。**公開コールバックは不要**です |
| Slack | Socket Mode（アウトバウンド WebSocket）。**公開コールバックは不要**です |
| Discord | Gateway WebSocket。**公開コールバックは不要**です |
| QQ ボット | QQ オープンプラットフォームの WebSocket（C2C / グループ @）。**公開コールバックは不要**です |

次の第 3 節では、プラットフォームごとに、オープンプラットフォームで行う作業と、`config.yaml` のどのキーに何を入力するかを説明します。

---

## 3. プラットフォーム別の設定項目と詳細手順

### 3.1 DingTalk

**最初に確認: 2 種類の DingTalk ボットは別物です**

| 種類 | 作成場所 | 「ユーザーがメッセージを送信 → ボットが返信」は可能か | 本プログラムでの対応 |
|------|------------|----------------------------------|----------------|
| **カスタムボット** | DingTalk のグループ内: グループ設定 → ボットを追加 → カスタム（Webhook） | ❌ 不可。グループにメッセージを送信することしかできません | ❌ 非対応 |
| **企業内部アプリのボット** | [DingTalk オープンプラットフォーム](https://open.dingtalk.com)でアプリを作成し、ボットを有効化 | ✅ 可能 | ✅ 対応 |

お手元にあるのが「カスタムボット」の Webhook URL（`oapi.dingtalk.com/robot/send?access_token=xxx`）と署名用シークレット（`SEC...`）の場合、**本プログラムに直接入力することはできません**。以下の手順に従い、オープンプラットフォームで「企業内部アプリ」を作成し、**Client ID** と **Client Secret** を取得してください。

---

**DingTalk 設定の全手順（順番に実施してください）**

1. **DingTalk オープンプラットフォームを開く**  
   ブラウザーで [https://open.dingtalk.com](https://open.dingtalk.com) にアクセスし、**企業管理者**アカウントでログインします。

2. **アプリ開発に進む**  
   左側で **アプリ開発** → **企業内部開発** を選び、**アプリを作成**（または既存のアプリを選択）をクリックします。アプリ名などの基本情報を入力して作成します。

3. **Client ID と Client Secret を取得する**  
   - 左側の **認証情報と基本情報**（「基本情報」の下）をクリックします。  
   - ページに **Client ID（旧 AppKey）** と **Client Secret（旧 AppSecret）** が表示されています。  
   - コピーボタンでコピーし、**手入力しないでください**。数字の **0** とアルファベットの **o**、数字の **1** とアルファベットの **l** は書き間違えやすいので注意してください（例: `ding9gf9tiozuc504aer` の途中は数字の **504** であり、5o4 ではありません）。

4. **ボットを有効化し、Stream モードを選択する**  
   - 左側の **アプリ機能** → **ボット** を開きます。  
   - 「ボット設定」のスイッチをオンにします。  
   - ボット名や説明などを入力します（必須項目は画面の指示に従って入力します）。  
   - **重要**: メッセージ受信方式は **「Stream モード」**（ストリーム接続）を選択してください。「HTTP コールバック」のみ、または Stream を選択していない場合、本プログラムはメッセージを受信できません。  
   - 保存します。

5. **権限とリリース**  
   - 左側の **権限管理** で「ボット」「メッセージ」などを検索し、**メッセージの受信**、**メッセージの送信** などボット関連の権限にチェックを入れ、認可を確認します。  
   - 左側の **バージョン管理とリリース** で、未リリースの設定がある場合は **新バージョンをリリース** / **公開** をクリックしてください。そうしないと変更は反映されません。

6. **CyberStrikeAI に入力する**  
   - `config.yaml` の `robots.dingtalk` を設定します（下記）。有効にして、手順 3 でコピーした Client ID と Client Secret を貼り付けます。  
   - CyberStrikeAI を再起動します（第 1 節）。

```yaml
robots:
  dingtalk:
    enabled: true
    client_id: "<Client ID>"
    client_secret: "<Client Secret>"
```

---

**`config.yaml` のキーと DingTalk の取得元の対応表**

| `config.yaml` のキー | DingTalk オープンプラットフォームでの取得元 |
|------------------------|------------------------|
| `robots.dingtalk.enabled` | `true` で有効になります |
| `robots.dingtalk.client_id` | 認証情報と基本情報 → **Client ID（旧 AppKey）** |
| `robots.dingtalk.client_secret` | 認証情報と基本情報 → **Client Secret（旧 AppSecret）** |

---

### 3.2 Lark (Feishu)

| `config.yaml` のキー | 説明 |
|--------|------|
| `robots.lark.enabled` | `true` にすると Lark のロングコネクションが起動します |
| `robots.lark.app_id` | Lark オープンプラットフォームのアプリ認証情報にある App ID |
| `robots.lark.app_secret` | Lark オープンプラットフォームのアプリ認証情報にある App Secret |
| `robots.lark.verify_token` | イベントサブスクリプション用（任意） |

```yaml
robots:
  lark:
    enabled: true
    app_id: "<App ID>"
    app_secret: "<App Secret>"
    verify_token: ""   # 任意
```

**Lark の設定手順（概要）**: [Lark オープンプラットフォーム](https://open.feishu.cn)にログイン → 企業向けカスタムアプリを作成 → 「認証情報と基本情報」で **App ID** と **App Secret** を取得 → 「アプリ機能」で**ボット**を有効化し、必要な権限を有効にする → **「イベントサブスクリプション」でイベントを追加**（下記参照）→ アプリをリリース → App ID と App Secret を `config.yaml` の `robots.lark` に入力 → CyberStrikeAI を再起動します。

**重要: イベントサブスクリプション**  
Lark のロングコネクションは、オープンプラットフォームで「メッセージの受信」イベントをサブスクライブしている場合にのみ、ユーザーのメッセージを受信します。該当アプリの **イベントサブスクリプション** ページで「イベントを追加」をクリックし、「メッセージとグループ」の下にある **メッセージを受信（im.message.receive_v1）** または同種のイベントにチェックを入れてください。追加していない場合、接続自体は確立されますがメッセージは一切届かず、メッセージを送信してもローカルにログが出力されず、ボットが返信しない状態になります。

**Lark の権限設定（必読）**  
**権限管理** で以下の権限を有効にしてください（名称と識別子は、オープンプラットフォームの一覧と一致しています）。変更後は **バージョン管理とリリース** で新バージョンをリリースしないと反映されません。

| 権限名（オープンプラットフォームでの表示） | 権限識別子 | 説明 |
|----------------------------|----------|------|
| 個別チャット・グループメッセージの取得と送信 | `im:message` | メッセージ送受信の基本権限です。**必ず有効にしてください**。 |
| グループチャットでボットへの @ メンションを受信するイベント | `im:message.group_at_msg:readonly` | グループチャットでボットに @ したときのメッセージを受信するために必要です。 |
| ユーザーがボットに送信した個別チャットメッセージの読み取り | `im:message.p2p_msg:readonly` | 個別チャットでのメッセージ受信用です。**必ず有効にしてください**。無効だと、プライベートチャットで送信しても反応しません。 |
| 個別チャット・グループメッセージの取得 | `im:message:readonly` | メッセージ内容の読み取り用です。**必ず有効にしてください**。 |

**イベントサブスクリプション**（権限とは別に設定します）: **イベントサブスクリプション** で **メッセージを受信（im.message.receive_v1）** を追加してください。追加しないと、ロングコネクションでメッセージのプッシュを受信できません。

- **個別チャット**: Lark でボットとのプライベートチャットを開き、`help` または任意のテキストを直接送信するだけで利用できます。@ は不要です。  
- **グループチャット**: グループでは、**ボットに @ して**送信した内容のみがボットに受信され、返信されます。

---

### 3.3 WeCom

> WeCom は現在、「HTTP コールバック + 能動メッセージ送信 API」の方式で動作します。  
> - ユーザーがメッセージを送信 → WeCom が暗号化された XML を **お使いのサーバーにコールバック**します（本プログラムの `/api/robot/wecom`）。  
> - CyberStrikeAI が復号して AI を呼び出し → WeCom の `message/send` インターフェースを使って**ユーザーに能動的にメッセージを送信**します。

**設定の概要:**

- WeCom の管理コンソールで**カスタムアプリ**を作成するか、既存のものを選択します。
- そのアプリの「メッセージ受信」で、コールバック URL、Token、EncodingAESKey を設定します。
- CyberStrikeAI の `config.yaml` で `robots.wecom.enabled: true` を設定し（有効にする場合は `token` が必須です）、次の値を入力します。
  - `robots.wecom.corp_id`: 企業 ID（CorpID）
  - `robots.wecom.agent_id`: アプリの AgentId
  - `robots.wecom.token`: メッセージコールバックで使用する Token
  - `robots.wecom.encoding_aes_key`: メッセージコールバックで使用する EncodingAESKey
  - `robots.wecom.secret`: そのアプリの Secret（WeCom の能動メッセージ送信インターフェースの呼び出しに使用します）
- CyberStrikeAI を再起動します（第 1 節）。

```yaml
robots:
  wecom:
    enabled: true
    corp_id: "<CorpID>"
    agent_id: 1000002
    token: "<Token>"
    encoding_aes_key: "<EncodingAESKey>"
    secret: "<アプリの Secret>"
```

> **重要: IP ホワイトリスト（errcode 60020）**  
> CyberStrikeAI は `https://qyapi.weixin.qq.com/cgi-bin/message/send` を使用して AI の返信を能動的に送信します。  
> WeCom のログまたは本プログラムのログに `errcode 60020 not allow to access from your ip` が出力された場合は、次のとおりです。
>
> - サーバーの送信元 IP が **WeCom の IP ホワイトリストに追加されていません**。  
> - WeCom の管理コンソールで、該当カスタムアプリの**「セキュリティ設定 / IP ホワイトリスト」**（正確な場所はバージョンによって若干異なる場合があります）を探し、CyberStrikeAI を実行しているサーバーのパブリック IP（例: `110.xxx.xxx.xxx`）をホワイトリストに追加してください。  
> - 保存後、反映されるまで待ってから、もう一度メッセージを送信してテストします。
>
> IP がホワイトリストに追加されていない場合、WeCom は能動的なメッセージ送信を拒否し、次のような症状になります。  
> - コールバックインターフェース `/api/robot/wecom` ではメッセージを正常に受信・処理できる。  
> - しかし、スマートフォン側では**いつまでも AI の返信が届かず**、ログに `not allow to access from your ip` というメッセージが出ている。

---

### 3.4 個人 WeChat (iLink)

> 個人 WeChat は、「QR コードによる連携 + iLink ロングポーリング」の方式で動作します。  
> - CyberStrikeAI の API で QR コードを取得 → **スマートフォンの WeChat** でスキャンして連携を確認します。  
> - 連携に成功すると `config.yaml` の `robots.wechat` に自動的に書き込まれ、iLink ロングポーリングが開始されます（プログラムが `ilinkai.weixin.qq.com` に接続してメッセージを受信します）。  
> - サーバーで公開コールバック URL を設定する必要は**なく**、WeChat オープンプラットフォームでアプリを登録する必要も**ありません**。

**WeCom との違い**

| 項目 | 個人 WeChat (iLink) | WeCom |
|------|------------------|------------------|
| 利用シーン | 個人 WeChat のプライベートチャット | WeCom のカスタムアプリ |
| 設定方法 | QR コードをスキャンして連携（QR コードは API で取得） | 管理コンソールでコールバック URL + Token を設定 |
| 公開ネットワークの要否 | 不要（アウトバウンドのロングポーリングのみ） | 必要（WeCom からアクセス可能な HTTPS コールバック） |
| 設定セクション | `robots.wechat` | `robots.wecom` |

**連携手順（順番に実施してください）**

Web 画面を使う手順はありません。画面が必要なのは、スマートフォンでスキャンできるように QR 画像を表示するときだけです。以下の API 呼び出しには、グローバルスコープの `robot:write` 権限が必要です（状態の確認は `robot:read`）。QR のセッションはサーバーのメモリ上にだけ約 5 分間保持されるため、その間は CyberStrikeAI を再起動しないでください。

1. **QR コードを取得する**

   ```bash
   curl -sk -X POST https://127.0.0.1:8080/api/robot/wechat/qrcode \
     -H "Authorization: Bearer <token>" > qr.json
   ```

   リクエストボディに `{"bot_type":"3"}` を付けると Bot Type を上書きできます。省略した場合は `robots.wechat.bot_type`、それもなければ `3` が使われます。レスポンスには次のフィールドが含まれます。

   | フィールド | 意味 |
   |-------|---------|
   | `session_key` | 以降の呼び出しで、この連携の試行を識別するキー |
   | `qrcode` | iLink の QR トークン |
   | `qrcode_open_url` | QR コードにエンコードする内容（リンクであり、画像の URL では**ありません**） |
   | `qrcode_image_data_url` | 同じ内容を PNG の data URL にしたもの（サーバーで生成できなかった場合は含まれません） |
   | `message` | 案内メッセージ |

   サーバーが `https://ilinkai.weixin.qq.com` に接続できない場合、`502` が返ります。

2. **スキャンできる QR コードにしてスキャンする**

   ```bash
   jq -r .qrcode_image_data_url qr.json | sed 's#^data:image/png;base64,##' | base64 -d > wechat-qr.png
   ```

   `wechat-qr.png` を任意の画像ビューアーで開き、スマートフォンの WeChat でスキャンします（古い macOS では `base64 -D` を使います。画面のないサーバーの場合は、ファイルを手元の PC にコピーしてください）。別の方法として、`qrcode_open_url` を任意の QR ツールでエンコードしても構いません（`qrencode` がインストールされていれば `qrencode -t ANSIUTF8 "<qrcode_open_url>"`）。終わったら `qr.json` と `wechat-qr.png` を削除してください。

3. **ステータスが `confirmed` になるまでポーリングする**

   ```bash
   curl -sk "https://127.0.0.1:8080/api/robot/wechat/qrcode/status?session_key=<session_key>" \
     -H "Authorization: Bearer <token>"
   ```

   1 回の呼び出しで、変化があるまで最大約 35 秒待ってから `{"status":"..."}` が返ります。状態が変わるまで繰り返し呼び出します。

   | `status` | 意味 / 対処 |
   |----------|----------------------|
   | `wait` | まだスキャンされていません（待機がタイムアウトした場合も返ります）。もう一度ポーリングします |
   | `scaned` | スキャン済みです。スマートフォンで確認を完了し、ポーリングを続けます |
   | `scaned_but_redirect` | iLink が別のホストを指示しました。サーバーが自動で切り替えるので、ポーリングを続けます |
   | `need_verifycode` | WeChat に**ペアリング用の数字**が表示されています（一部のアカウントのみ）。手順 4 に進みます |
   | `binded_redirect` | このアカウントはすでに連携済みです（`already_connected: true`）。何も書き込まれず、セッションは終了します |
   | `confirmed` | 完了です。手順 5 を参照してください |

   エラー: `400` は `session_key` がない場合、`404` はセッションが存在しないか期限切れの場合、`410` は QR コードの発行から 5 分以上経過した場合（手順 1 からやり直します）、`502` は iLink のエラーです。

4. **ペアリング用の数字を送信する（求められた場合のみ）**

   ```bash
   curl -sk -X POST https://127.0.0.1:8080/api/robot/wechat/qrcode/verify \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"session_key":"<session_key>","verify_code":"<WeChat に表示された数字>"}'
   ```

   その後、手順 3 のポーリングを続けます。サーバーは送信済みの数字を再利用します（ステータスの呼び出しに `&verify_code=<数字>` を付けて渡すこともできます）。

5. **連携の完了**  
   `confirmed` のレスポンスには `message`、`ilink_bot_id`、`ilink_user_id` が含まれます。サーバーは続けて `robots.wechat` に `enabled: true`、`bot_token`、`ilink_bot_id`、`ilink_user_id`、`base_url` を設定し（空の場合は `bot_type` と `bot_agent` も設定します）、`config.yaml` に書き込み、ボット接続を再起動します。**手動での再起動は不要です**。`auth` は変更されません。`GET /api/robot/wechat/status`（`enabled`、`bound`、`ilink_bot_id`、`ilink_user_id`、`base_url`）で確認できます。

6. **スマートフォンの WeChat でテストする**  
   CyberStrikeAI ボットとの**プライベートチャット**を開き（連携後、WeChat 内に対応する会話が表示されます）、`whoami` または `help` を送信してテストします。

**`robots.wechat` のキー**

| キー | 説明 |
|-----|------|
| `enabled` | iLink ロングポーリングを起動します。連携に成功すると自動的に `true` になります（`bot_token` が空でないことが必要です） |
| `bot_token`、`ilink_bot_id`、`ilink_user_id` | 連携によって書き込まれます。手で編集しないでください |
| `base_url` | デフォルトは `https://ilinkai.weixin.qq.com` |
| `bot_type` | デフォルトは `3` |
| `bot_agent` | デフォルトは `CyberStrikeAI/1.0` |

**使い方**

- ボットとの**プライベートチャット**でのみ会話でき、テキストを直接送信するだけで利用できます。**@ は不要**です。  
- グループチャットでのボットへの @ には対応していません（DingTalk / Lark のグループチャットとは異なります）。  
- **テキストメッセージ**のみ処理されます。画像や音声などは無視されるか、未対応である旨が通知されます。

**再連携**

- 連携する WeChat アカウントを変更したい場合は、手順 1〜5 をもう一度実行します。QR コードの取得時に現在の `bot_token` が一緒に送信され、連携に成功すると、保存されているトークンと ID が上書きされます。  
- ステータスが `binded_redirect`（「この WeChat アカウントはすでに連携済みです」）の場合は、そのアカウントが以前に連携を完了していることを意味し、設定は何も変更されません。

**よくある問題**

| 症状 | 対処 |
|------|------|
| QR コードの期限切れ（`410` または `404`） | 新しい QR コードを取得します（有効期間は約 5 分） |
| ステータスが `need_verifycode` になる | WeChat に表示されているペアリング用の数字を送信します（手順 4） |
| 連携は成功したが、メッセージを送信しても返信がない | プログラムのログに `WeChat iLink long polling started` と `WeChat message received` が出力されているか確認します。`robots.wechat.enabled` が `true` であることも確認してください |
| ネットワーク切断やスリープ後に返信がない | プログラムが自動的に再接続します（約 5〜60 秒）。それでも返信がない場合は CyberStrikeAI を再起動してください |
| QR コードを取得できない（`502`） | サーバーが `https://ilinkai.weixin.qq.com` にアクセスできること（アウトバウンド HTTPS）を確認します |

---

### 3.5 Telegram

> Telegram は **Bot API ロングポーリング**（`getUpdates`）を使用します。プログラムが `api.telegram.org` に接続してメッセージを受信するため、**公開コールバックは不要**です。

**設定手順:**

1. Telegram で **@BotFather** を探し、`/newbot` を送信してボットを作成し、**Bot Token** を取得します。  
2. `config.yaml` の `robots.telegram` で `enabled: true` にし、**Bot Token** を貼り付けます。  
3. （任意）`bot_username`（`@` を除く）を入力します。空欄の場合は、プログラムが起動時に自動的に `getMe` で取得します。  
4. （任意）`allow_group_messages: true` にするとグループチャットを許可します。グループチャットでは、**ボットに @ した**メッセージにのみ応答します。  
5. CyberStrikeAI を再起動します。

```yaml
robots:
  telegram:
    enabled: true
    bot_token: "<Bot Token>"
    bot_username: ""
    allow_group_messages: false
```

**使い方:** ボットとのプライベートチャットではそのままメッセージを送信します。グループチャットではボットに @ する必要があります（かつ、`allow_group_messages: true` になっていること）。

---

### 3.6 Slack

> Slack は **Socket Mode**（アウトバウンド WebSocket）を使用します。**Bot Token** と **App-Level Token** が必要で、**公開コールバックは不要**です。

**設定手順:**

1. [Slack API](https://api.slack.com/apps) で App を作成 → **Socket Mode** を有効にします。  
2. **Basic Information** → **App-Level Tokens** → トークンを作成します（scope: `connections:write`）。これが **xapp-** で始まるトークンです。  
3. **OAuth & Permissions** → Bot Token Scopes（`app_mentions:read`、`chat:write`、`im:history`、`im:read` など）を追加 → ワークスペースにインストールして、**xoxb-** で始まる Bot Token を取得します。  
4. **Event Subscriptions** → `message.im`、`app_mention` などをサブスクライブします（Socket Mode ではアプリ内で設定します）。  
5. 2 つのトークンを `config.yaml` の `robots.slack` に入力し、CyberStrikeAI を再起動します。

```yaml
robots:
  slack:
    enabled: true
    bot_token: "<xoxb- の Bot Token>"
    app_token: "<xapp- の App-Level Token>"
```

**使い方:** Bot とのプライベートチャットではそのまま送信します。チャンネルではボットに @ する必要があります。

---

### 3.7 Discord

> Discord は **Gateway WebSocket** を使用します。プログラムが Discord Gateway に接続するため、**公開コールバックは不要**です。

**設定手順:**

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成 → **Bot** → **Token** をコピーします。  
2. **Privileged Gateway Intents** の **Message Content Intent** を有効にします（有効にしないとメッセージ本文を読み取れません）。  
3. OAuth2 → URL Generator → scopes: `bot` → 権限で **Send Messages**、**Read Message History** などにチェックを入れ → Bot をサーバーに招待します。  
4. Token を `config.yaml` の `robots.discord` に入力し、CyberStrikeAI を再起動します。  
5. （任意）`allow_guild_messages: true` にするとサーバーのチャンネルを許可します。チャンネルでは、**ボットに @ した**メッセージにのみ応答します。

```yaml
robots:
  discord:
    enabled: true
    bot_token: "<Bot Token>"
    allow_guild_messages: false
```

**使い方:** Bot とのプライベートチャットではそのまま送信します。サーバーのチャンネルではボットに @ する必要があります（かつ、`allow_guild_messages: true` になっていること）。

---

### 3.8 QQ ボット

> QQ ボットは **QQ オープンプラットフォームの WebSocket**（公式の `botgo` SDK）を使用します。C2C のプライベートチャットとグループ @ に対応し、**公開コールバックは不要**です（WebSocket のアウトバウンド接続）。

**設定手順:**

1. [QQ ボットオープンプラットフォーム](https://q.qq.com)でボットを作成し、**App ID** と **Client Secret** を取得します。  
2. サンドボックスにテストメンバーを追加します（本番公開前は、サンドボックスでのみ会話できます）。  
3. **C2C メッセージ**、**グループ @ メッセージ** などのイベントをサブスクライブします（WebSocket モード）。  
4. `config.yaml` の `robots.qq` に App ID と Client Secret を入力します。  
5. テスト段階では `sandbox: true` にします。本番公開後は `false` にしてリリースします。  
6. CyberStrikeAI を再起動します。

```yaml
robots:
  qq:
    enabled: true
    app_id: "<App ID>"
    client_secret: "<Client Secret>"
    sandbox: true
```

**使い方:** ボットとの C2C プライベートチャットではそのまま送信します。QQ グループではボットに @ する必要があります。

> 注意: QQ 公式は Webhook コールバックを段階的に推進していますが、現在の実装は WebSocket を使用しています（DingTalk / Lark と同様のロングコネクション方式）。

---

## 4. RBAC 認可とボットコマンド

プラットフォームのトークン、署名、ロングコネクションの認証情報は、「メッセージがそのプラットフォームから届いたこと」を証明するだけです。どの操作を実行できるかは、CyberStrikeAI の RBAC によって決まります。各ボットインスタンスでは、必ず業務認可モードを 1 つ選択する必要があります。

### 4.1 どのモードを選ぶべきか

| 利用シーン | 推奨モード | ID とデータ範囲 |
|----------|----------|----------------|
| WeCom、Lark、DingTalk、Slack など、複数人で共有するボット | `user_binding` | 各送信者が自分の Web ユーザーに紐付けられ、権限とデータは互いに分離されます |
| 個人 WeChat、個人専用ボット、固定の自動化入口 | `service_account` | ホワイトリストの送信者は、設定された RBAC ユーザーを共通で使用し、そのアカウントのデータを共有します |

どちらのモードも、**メッセージごと**の実行前に、ユーザーの状態、ロール、権限ごとのスコープ、リソースの認可を再読み込みします。ユーザーが無効化されたり権限が取り消されたりした場合、次のメッセージから直ちに無効になります。

ボットが通常の AI 会話を実行するには、最低でも次の権限が必要です。

```text
agent:execute
chat:read
chat:write
```

プロジェクト、ロール、ローカルコマンド、WebShell、C2、外部 MCP を使用する場合は、機能に応じて対応する権限を追加する必要があります。会話の削除には `chat:delete` が必要です。

### 4.2 ユーザー単位の紐付けモード（デフォルト）

管理者の操作: 設定は不要です。`auth` を省略するか `mode: user_binding` と書くと、このモードになります。

各利用者の操作:

1. 自分のアカウントでログインし（第 1 節）、紐付けコードを取得します。この呼び出しに必要な権限は `auth:self` だけで、コードはログインしているユーザーに紐付きます。

   ```bash
   curl -k -X POST https://127.0.0.1:8080/api/auth/robot-binding-code \
     -H "Authorization: Bearer <token>"
   ```

   ```json
   {"code":"7C6E-BD4C","expires_at":"<RFC 3339 の UTC 時刻>","expires_in_seconds":300}
   ```

2. 5 分以内に、対象のボットで完全なコマンドを送信します。例: `bind 7C6E-BD4C`。
3. `whoami` を送信し、`Auth status: authorized` が表示され、`Effective identity` の行が自分のユーザーであることを確認します。

紐付けコードはハッシュのみが保存され、一度しか使用できません。サーバーは期限切れや使用済みのコードを拒否します。再生成すると、それ以前に未使用だった古いコードは直ちに無効になります。紐付けの解除は、`unbind` を送信して（続けて `confirm`）行うか、API で一覧の取得と取り消しを行います。`GET /api/auth/robot-bindings` は `{"bindings":[{"id","platform","external_user_hint","enabled","created_at","updated_at"}]}` を返し、`DELETE /api/auth/robot-bindings/<id>` で 1 件を削除できます。どちらも `auth:self` が必要です。

### 4.3 専用サービスアカウントモード

1. まず、ボットをプラットフォームに正常に接続します。
2. 対象の利用者がボットに `whoami` を送信し、返された `Sender ID` をコピーします。個人 WeChat の ID は通常 `xxxx@im.wechat` の形式です。必ずコマンドの返り値を使用してください。`ilink_bot_id` や設定内の `ilink_user_id` で代用してはいけません。
3. `config.yaml` の該当プラットフォームで `auth.mode: service_account` を設定します。
4. `service_user_id` に、RBAC の**ユーザー ID** を入力します（表示名ではありません）。`admin` を入力することもできます。この場合、ホワイトリストの送信者はプラットフォームの全権限を持つことになります。
5. `allowed_external_users` に、1 項目につき 1 つ、完全な ID を入力します。完全一致で、大文字と小文字が区別されます。`*` ワイルドカード、空の項目、重複は受け付けられません。
6. CyberStrikeAI を再起動し、もう一度 `whoami` を送信して、実際のユーザー、ロール、リソース範囲が正しいことを確認します。サービスユーザーが存在しない、または無効化されている場合、起動時にはエラーになりませんが、すべての送信者が拒否されます（`PUT /api/config` ではこのような設定は拒否されます）。

例:

```yaml
robots:
  wechat:
    auth:
      mode: service_account
      service_user_id: admin
      allowed_external_users:
        - "o9cq806s32Sm2_kyOmkyaV7Rn1lU@im.wechat"
```

サービスアカウントモードでは、`bind` / `unbind` コマンドは受け付けられません。複数のホワイトリスト送信者は、サービスアカウントが作成した会話、プロジェクト、その他の `own` スコープのリソースを共有します。共有を避けたい場合は、ユーザー単位の紐付けを使用してください。

### 4.4 現在の ID を確認する方法

次を送信します。

```text
whoami
```

返される内容には、プラットフォーム、実際の送信者 ID、認可モード、認可状態、実際の RBAC ユーザー、RBAC User ID、プラットフォームロール、リソース範囲、有効な権限の数が含まれます。サービスアカウントのホワイトリストに含まれていない送信者には、拒否された状態のみが表示され、サービスアカウントの詳細は表示されません。

### 4.5 コマンド一覧

接続済みの任意のプラットフォーム（DingTalk / Lark / WeChat / Telegram / Slack / Discord / QQ など）で、ボットに次の**テキストコマンド**を送信します（テキストのみ対応）。

| コマンド | 説明 |
|------|------|
| **`help`**（または `?`） | コマンドのヘルプを表示します。表示内容は送信者の権限に応じて変わります |
| **`version`** | 現在の CyberStrikeAI のバージョン番号を表示します |
| **`whoami`** | プラットフォーム送信者 ID、認可モード、紐付け状態、および現在の実際の RBAC ユーザー、ロール、リソース範囲を表示します |
| **`bind <紐付けコード>`** | 現在のプラットフォーム送信者を、紐付けコードを生成した RBAC ユーザーに紐付けます（`user_binding` モードのみ） |
| **`unbind`** | 現在のプラットフォームアカウントの紐付け解除を要求します。2 分以内に `confirm` を送信すると解除されます（`user_binding` モードのみ）。API からも取り消せます（4.2 を参照） |
| **`list`** | 会話のタイトルと会話 ID を一覧表示します（先頭の 20 件） |
| **`switch <会話ID>`** または **`continue <会話ID>`** | 会話 ID を指定し、以降のメッセージをその会話で続けます |
| **`new`** | 新しい会話を開始し、以降のメッセージを新しい会話で送ります |
| **`clear`** | 現在の会話のコンテキストをクリアします（`new` と同じ効果です） |
| **`status`** | 現在の会話、モード、ロール、プロジェクトを表示します |
| **`task`** | 現在のタスクの状態と経過時間を表示します |
| **`rename <名前>`** | 現在の会話のタイトルを変更します |
| **`delete <会話ID>`** | 指定した会話を削除します。2 分以内に `confirm` を送信すると削除されます |
| **`stop`** | 現在実行中のタスクを中断します |
| **`roles`** | 有効なロールを一覧表示します（`Default`、`Penetration Testing`、`Information Gathering` など） |
| **`role <ロール名>`** | 現在使用するロールを切り替えます。例: `role Penetration Testing` |
| **`modes`** | 会話モードと現在の選択を一覧表示します |
| **`mode <モード名>`** | 会話モード（`single`、`deep`、`plan_execute`、`supervisor`）を切り替えます。`single` 以外はマルチエージェントを有効にしている必要があります |
| **`permissions`** | 現在有効な業務権限を表示します |
| **`doctor`** | ボット関連の主要な設定の状態を確認します（`config:read` が必要です） |
| **`confirm`** / **`cancel`** | 保留中のリスクの高い操作（`unbind`、`delete`）を確定またはキャンセルします |
| **`projects`** | プロジェクトを一覧表示します（プロジェクト機能が有効な場合のみ） |
| **`new project <名前>`** | プロジェクトを作成し、現在の会話に紐付けます |
| **`bind project <ID\|名前>`** | 現在の会話を既存のプロジェクトに紐付けます |
| **`unbind project`** | 現在の会話のプロジェクト紐付けを解除します |
| **`vuln alerts`** | 脆弱性アラートの購読状態を表示します。`vuln alerts on`、`vuln alerts off`、`vuln alerts critical\|high\|medium` で変更します |

`help`、`version`、`whoami`、`permissions`、`confirm`、`cancel`、`bind`、`unbind` 以外のコマンドには RBAC 権限が必要です。たとえば `list`、`switch`、`status`、`task` には `chat:read`、`new`、`clear`、`rename` には `chat:write`、`delete` には `chat:delete`、`stop`、`modes`、`mode` には `agent:execute`、`roles`、`role` には `roles:read`、プロジェクト関連のコマンドには `project:read` / `project:write`、`vuln alerts` には `vulnerability:read` が必要です。権限が不足している場合は、その旨が返信されます。

以前のバージョンで使われていた中国語のコマンドも、これらのコマンドの別名として引き続き使えます。

上記のコマンド以外の**任意のテキストを入力する**と、ユーザーメッセージとして AI に送信されます。Web 画面での会話と同じロジックです（ペネトレーションテスト / セキュリティ分析など）。

グループチャットのメッセージは、実際の送信者で認可され、グループ ID は業務 ID として使用されません。ただしサービスアカウントモードは例外で、ホワイトリストの送信者は、設定されたサービスアカウントの権限とリソースを明示的に共有します。

---

## 5. 使い方（ボットに @ する必要はありますか?）

- **個人 WeChat**: CyberStrikeAI ボットとの**プライベートチャット**でそのまま送信すれば利用でき、**@ は不要**です（グループチャットには非対応）。  
- **DingTalk / Lark の個別チャット（推奨）**: **ボットを検索して開き**、**プライベートチャット**で`help` または任意のテキストを直接入力するだけで利用でき、**@ は不要**です。  
- **DingTalk / Lark のグループチャット**: ボットがグループに追加されている場合、グループ内では**ボットに @ して**送信したメッセージのみがボットに受信され、返信されます。@ しないグループメッセージではボットは反応しません。

まとめ: **個人 WeChat と個別チャットでは直接送信**します。**DingTalk / Lark でグループ内で使う場合は、ボットに @ して**から内容を送信する必要があります。

---

## 6. 推奨フロー（手順の抜け漏れを防ぐ）

**個人 WeChat（最も簡単で、オープンプラットフォームは不要）**

1. `POST /api/robot/wechat/qrcode` で QR コードを取得して PNG を保存し、WeChat でスキャンします。ペアリング用の数字を求められたら送信します（3.4 を参照）。  
2. スマートフォンの WeChat のプライベートチャットで `whoami` を送信し、送信者 ID をコピーします。  
3. `user_binding` にする場合は `auth` を記述しません。`service_account` にする場合は、`config.yaml` にサービスアカウントと送信者のホワイトリストを設定します。  
4. CyberStrikeAI を再起動し、WeChat でもう一度 `whoami` を送信して、実際の RBAC ID を確認してから、通常のメッセージを送信します。

**DingTalk / Lark**

1. **オープンプラットフォームで**: 第 3 節に従い、アプリの作成、認証情報のコピー、ボットの有効化（DingTalk では必ず **Stream モード**を選択）、権限設定とリリースを完了します。  
2. **CyberStrikeAI で**: `config.yaml` の `robots.dingtalk` または `robots.lark` で、`enabled: true` にし、Client ID / App ID と Client Secret / App Secret を入力します。  
3. **認可モードを選択する**: 複数人で利用する場合は `auth` を記述しない（`user_binding`）のがおすすめです。専用ボットの場合は、サービスアカウントと送信者のホワイトリストを設定します。  
4. **CyberStrikeAI を再起動**します。  
5. **スマートフォンの DingTalk / Lark で**: ボットを見つけ（個別チャットでは直接送信、グループチャットでは @ が必要）、まず `whoami` を送信して認可を確認してから、通常の内容を送信してテストします。

メッセージを送信しても反応がない場合は、まず **第 9 節のトラブルシューティング** と **第 10 節のよくある遠回り** を確認してください。

---

## 7. 設定ファイルの例

`config.yaml` のボット関連部分の例:

```yaml
robots:
  wechat: # 個人 WeChat iLink（トークンと ID は QR コードによる連携で書き込まれます。手で編集しないでください）
    enabled: true
    auth:
      mode: service_account
      service_user_id: admin
      allowed_external_users:
        - "whoami からコピーした完全な送信者 ID"
    bot_token: "your_bot_token@im.bot:..."
    ilink_bot_id: "your_bot_id@im.bot"
    ilink_user_id: "your_user_id@im.wechat"
    base_url: "https://ilinkai.weixin.qq.com"
    bot_type: "3"
    bot_agent: "CyberStrikeAI/1.0"
  dingtalk:
    enabled: true
    auth:
      mode: user_binding
    client_id: "your_dingtalk_app_key"
    client_secret: "your_dingtalk_app_secret"
  lark:
    enabled: true
    auth:
      mode: user_binding
    app_id: "your_lark_app_id"
    app_secret: "your_lark_app_secret"
    verify_token: ""
  wecom:
    enabled: false
    corp_id: ""
    agent_id: 0
    token: ""
    encoding_aes_key: ""
    secret: ""
  telegram:
    enabled: false
    bot_token: ""
    allow_group_messages: false
  slack:
    enabled: false
    bot_token: ""
    app_token: ""
  discord:
    enabled: false
    bot_token: ""
    allow_guild_messages: false
  qq:
    enabled: false
    app_id: ""
    client_secret: ""
    sandbox: true
```

各プラットフォームの `auth` は個別に設定します。省略した場合のデフォルトは `user_binding` です。YAML を編集した後はプロセスを再起動してください（第 1 節）。個人 WeChat は QR コードによる連携に成功すると、自動的に書き込まれ、ボット接続も再起動されます。

---

## 8. 動作確認の方法（DingTalk / Lark クライアントは不要）

DingTalk や Lark をインストールしていない場合は、**テスト用インターフェース**でボットのロジックが正常かどうかを確認できます。

1. グローバルスコープの `robot:write` 権限を持つアカウントでログインし（第 1 節）、トークンを取得します。  
2. curl でテスト用インターフェースを呼び出します。

```bash
curl -k -X POST https://127.0.0.1:8080/api/robot/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"platform":"dingtalk","user_id":"test_user","text":"help"}'
```

返された JSON に `"reply":"[CyberStrikeAI bot commands]..."` が含まれていれば、コマンド処理は正常です。`help`、`version`、`whoami` は未紐付けの状態でも実行できます。`list`、`status`、および通常の AI メッセージは実際の RBAC を経由するため、テスト用の `platform + user_id` はすでに紐付けられているか、サービスアカウントモードの送信者ホワイトリストと完全に一致している必要があります。

インターフェースの説明: `POST /api/robot/test`（グローバルスコープの `robot:write` が必要）、リクエストボディ `{"platform":"任意","user_id":"任意","text":"必須"}`。`platform` のデフォルトは `test`、`user_id` のデフォルトは `test_user` で、JSON でないボディには `400` が返ります。レスポンスは `{"reply":"返信内容"}` です。実際のボットメッセージと同じ処理が実行されるため、そのプラットフォームの `auth` 設定も適用され（ホワイトリストを試す場合は `wechat` など実際のプラットフォーム名を指定してください。デフォルトの `test` は常に `user_binding` として扱われます）、通常のテキストでは AI が実際に実行されます。サードパーティプラットフォームの署名やロングコネクションは検証しません。

---

## 9. メッセージを送信しても反応がない場合のトラブルシューティング

### 9.1 個人 WeChat

次の順に確認します。

1. **QR コードによる連携が完了しているか**  
   `GET /api/robot/wechat/status` が `"bound": true` と `ilink_bot_id` を返すはずです。`config.yaml` の `robots.wechat.bot_token` が空であってはいけません。

2. **有効になっているか**  
   `config.yaml` で `robots.wechat.enabled: true` になっていることを確認します（手動で編集した場合は再起動してください）。

3. **プログラムのログを確認する**  
   - 起動後に `WeChat iLink long polling started` が出力されているはずです。  
   - メッセージ送信後に `WeChat message received` が出力されるはずです。出力されない場合は、多くは連携が成功していないか `bot_token` が無効になっているため、もう一度連携してください（3.4 を参照）。  
   - `WeChat iLink long polling error, will reconnect automatically` が出力された場合は、自動再接続を待つか、プロセスを再起動してください。

4. **ネットワーク**  
   サーバーが `https://ilinkai.weixin.qq.com`（アウトバウンド HTTPS）にアクセスできる必要があります。QR コードの取得が `502` で失敗する場合は、まずこの項目を確認してください。

5. **ネットワーク切断やスリープの後**  
   DingTalk / Lark と同様に、プログラムは**自動的に再接続**します（約 5〜60 秒）。それでも返信がない場合は CyberStrikeAI を再起動してください。

### 9.2 DingTalk

次の順に確認します。

0. **ノート PC のスリープ（蓋閉じ）やネットワーク切断の後**  
   DingTalk と Lark はいずれもロングコネクションでメッセージを受信するため、スリープやネットワーク切断の後は接続が切断されます。プログラムは**自動的に再接続**します（約 5 秒〜60 秒以内にリトライします）。復帰またはネットワーク回復後、少し待ってからメッセージを送信してください。それでも反応がない場合は、CyberStrikeAI のプロセスを再起動してください。

1. **Client ID / Client Secret がオープンプラットフォームと完全に一致しているか**  
   「認証情報と基本情報」から**コピー＆ペースト**し、手入力しないでください。数字の **0** とアルファベットの **o**、数字の **1** とアルファベットの **l** に注意してください（例: `ding9gf9tiozuc504aer` の途中は **504** であり、5o4 ではありません）。

2. **変更後に再起動したか**  
   `config.yaml` を編集した場合は、プロセスを再起動してください。`PUT /api/config` で変更した場合は `POST /api/config/apply` を呼び出してください。`PUT` だけでは接続は再起動されません。

3. **プログラムのログを確認する**  
   - 起動後に `DingTalk Stream connecting...` が出力されているはずです。  
   - `DingTalk Stream long connection dropped (e.g. sleep/network loss), will reconnect automatically` がエラー情報付きで、起動直後から繰り返し出力される場合は、多くは **Client ID / Client Secret の誤り**か、**オープンプラットフォームでストリーム接続が有効になっていない**ことが原因です。スリープやネットワーク切断の後に同じ行が出力されるのは想定どおりで、プログラムが自動的に再接続します。  
   - DingTalk でメッセージを 1 件送信した後、受信できていれば `DingTalk message received` というログが出力されるはずです。出力されない場合は、DingTalk が本プログラムにメッセージをプッシュしていないということです（オープンプラットフォームで「ボット」が有効になっているか、**Stream モード**を選択しているかを見直してください）。

4. **オープンプラットフォーム側**  
   アプリが**リリース済み**である必要があります。「ボット」機能で、メッセージ受信用に**ストリーム接続（Stream）**を有効にする必要があります（HTTP コールバックだけでは不十分です）。権限管理で、ボットのメッセージ受信・送信などの権限が付与されている必要があります。

### 9.3 返信は届くが、未紐付け、ホワイトリストによる拒否、権限不足と表示される場合

1. まず `whoami` を送信し、「認可モード」と「認可状態」を確認します。
2. `user_binding` で未紐付けと表示される場合: `POST /api/auth/robot-binding-code` で紐付けコードを取得し（4.2 を参照）、同じプラットフォームアカウントで完全な紐付けコマンドを送信します。紐付けコードが期限切れ、または使用済みの場合は再生成してください。
3. `service_account` でホワイトリストによる拒否と表示される場合: `whoami` が返した完全な送信者 ID を、そのまま現在のプラットフォームのホワイトリストに追加します。大文字と小文字、テナントのプレフィックス、`@im.wechat` などのサフィックスに注意してください。
4. 実際の ID は表示されるが権限不足と表示される場合: その RBAC ユーザーのロールと権限を確認します。通常の AI 会話には、最低でも `agent:execute`、`chat:read`、`chat:write` が必要です。
5. サービスアカウント（`service_user_id`）が存在しない、または無効化されている場合: `PUT /api/config` はその設定を拒否しますが、手動で編集した `config.yaml` は問題なく起動し、すべての送信者が拒否されます。ユーザーを復旧するか、有効化されている別の RBAC ユーザーを選択してください。
6. `admin` を使用しているのに拒否される場合: 多くは admin の権限不足ではなく、送信者が完全一致のホワイトリストに含まれていないことが原因です。

---

## 10. よくある遠回り（落とし穴を避ける）

- **個人 WeChat と WeCom の混同**: 個人 WeChat は `robots.wechat` + QR コードによる連携、WeCom は `robots.wecom` + 管理コンソールでのコールバック URL です。両者はまったく別物です。  
- **個人 WeChat の QR コードの期限切れ**: QR コードの有効期間は約 5 分です。期限が切れたら再生成し、古いコードをスキャンし続けないでください。  
- **ボットの種類の取り違え**: DingTalk の**グループ内**で追加した「カスタム」ボット（Webhook + 署名）は、会話には**使用できません**。本プログラムは **オープンプラットフォームの「企業内部アプリ」** のボットのみに対応しています。  
- **変更後に再起動していない**: `config.yaml` を編集したらプロセスを再起動してください。`PUT /api/config` で変更した場合は、続けて `POST /api/config/apply` も呼び出してください（`PUT` だけでは接続は再起動されず、`auth` も保存されません）。  
- **Bot ID を送信者 ID と取り違える**: サービスアカウントのホワイトリストには、`whoami` コマンドが返す「送信者 ID」を入力する必要があります。`ilink_bot_id`、`ilink_user_id`、グループ ID、表示ニックネームは入力しないでください。  
- **紐付けコードの期限切れ後に使い続ける**: 紐付けコードの有効期間は 5 分で、一度しか使用できません。新しく生成したコードにより、古いコードは直ちに無効になります。  
- **サービスアカウントでデータが分離されると誤解する**: 同じサービスアカウントのホワイトリストに含まれる送信者は、そのアカウントの会話と `own` スコープのリソースを共有します。分離が必要な場合は `user_binding` を使用してください。  
- **admin を設定すると誰でも使えるようになる**: そうはなりません。サービスアカウントが `admin` であっても、送信者はホワイトリストと完全に一致している必要があります。ただし、ホワイトリストに含まれる人は全権限を持つことになります。  
- **Client ID の書き写しミス**: オープンプラットフォームで `504` なら `504` と入力し、`5o4` と入力しないでください。できるだけコピー＆ペーストを使用してください。  
- **DingTalk で HTTP コールバックだけを有効にして Stream を有効にしていない**: 本プログラムは **Stream ロングコネクション**でメッセージを受信します。オープンプラットフォームのボットのメッセージ受信方式で **Stream モード**を選択する必要があります。  
- **アプリをリリースしていない**: オープンプラットフォームでボットや権限を変更した後は、「バージョン管理とリリース」で**新バージョンをリリース**してください。そうしないと反映されません。

---

## 11. 注意事項

- どのプラットフォームも**テキストメッセージのみ**を処理します。その他の種類（画像、音声など）は、未対応である旨が通知されるか、無視されます。  
- 個人 WeChat は**プライベートチャットのみ**に対応しており、グループチャットでのボットへの @ には対応していません。  
- 会話は Web 画面と同じデータを共用します。`user_binding` では紐付けられたユーザーに帰属し、`service_account` ではサービスアカウントに帰属して、ホワイトリストの送信者が共有します。  
- ボットの実行は **Pi シングル / マルチエージェント** と同じロジック（`ProcessMessageForRobot`、進捗コールバックとプロセス詳細の保存を含む）で行われます。ただしクライアントへの SSE プッシュは行わず、最後に個人 WeChat / DingTalk / Lark / WeCom へ一括で返信します。デフォルトは `robot_default_agent_mode: single` です。
