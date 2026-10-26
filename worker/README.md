# Worker の設定と配置（eikaiwa-worker）

この Worker は、API キーとシステムプロンプトをサーバー側で持ち、パスワードの種類（アプリ種別）ごとに呼べるエンドポイントを制限します。既存の中継とは別の、**このプロジェクト専用の新しい Worker** です。

コマンドはすべて `worker` フォルダで実行します（ターミナルで `cd worker`）。

> **PowerShell で「スクリプトの実行が無効になっている」と出るとき**：`npm` を `npm.cmd`、`npx` を `npx.cmd` に置き換えて実行します（例：`npm.cmd run deploy`）。Windows のセキュリティ設定は変えなくて大丈夫です。

## 現在の状態（2026-10-26）

| 項目 | 状態 |
|---|---|
| Worker | 配置済み：`https://eikaiwa-worker.goldfish0824.workers.dev`（`shared/worker-url.js` に設定済み） |
| KV | `eikaiwa-usage` を作成し、`wrangler.toml` に設定済み |
| Secret | `GEMINI_API_KEY`・`ANTHROPIC_API_KEY`・`PASSWORDS` を登録（パスワードは上級者版 `adv-tomoaki`、高校生版のお試し用 `sc-test`） |

別のパソコンで作業するときは、1-1 から順に確認します（KV の作成と URL の書き込みは不要）。

## 1. はじめての準備（1回だけ）

### 1-1. wrangler を入れて、Cloudflare にログイン

```bash
npm install
npx wrangler login
```

`npm install` で、このフォルダ専用の wrangler（Cloudflare のコマンド）が入ります。ログインではブラウザが開くので、Cloudflare のアカウントで許可します。

### 1-2. KV（利用回数のカウンター）を作る ※作成済み

作り直すときだけ実行します。

```bash
npx wrangler kv namespace create eikaiwa-usage
```

表示された `id = "…"` の値を、`wrangler.toml` の `[[kv_namespaces]]` の `id` に書き込みます。

### 1-3. パスワードを作る

上級者版（自分用）のパスワード：

```bash
node tools/hash-password.js --id adv-tomoaki --app advanced
```

パスワードを2回入力します（画面には表示されません）。パスワードのハッシュが `passwords.local.json`（Git には入らない）に追加されます。パスワードそのものはどこにも保存されません。

学生に配布するパスワードは `--generate` を付けると、紛らわしい文字を使わないパスワードを自動で作って表示します（例：学生版 Claude版）。

```bash
node tools/hash-password.js --id sc-2026-2nen --app student-claude --generate
```

- `--app` は `advanced`（上級者版）／`student-claude`（高校生）／`student-gemini`（18歳以上の学生のみ）のどれか。
- **高校生に配るパスワードは必ず `student-claude` にしてください。** このパスワードでは Gemini を使う機能（`/adv/*`・`/sg/*`）が Worker で必ず拒否されます。
- 1日の上限を変えたいときは `--daily-minutes 40`（上級者版）、`--turns-per-device 80`・`--turns-total 3000`（学生版）を付けます。
- 同じ ID でもう一度実行すると、その ID のパスワードを置き換えます。削除は `node tools/hash-password.js --remove sc-2025-2nen`。

### 1-4. Secret を登録する

```bash
npx wrangler secret put GEMINI_API_KEY
npm run passwords
```

- `GEMINI_API_KEY`：聞かれたら、Google AI Studio で**課金を有効にしたプロジェクト**のキーを貼り付けます（無料枠のキーは、送った内容が Google の改善に使われるため使わない）。
- `npm run passwords`：`passwords.local.json` の一覧を、そのまま `PASSWORDS` として登録します。
- `ANTHROPIC_API_KEY`：学生版 Claude版で使います。登録のしかたは 1-7。

パスワードを追加・削除したときは、もう一度 `npm run passwords` を実行します（数秒で反映。配置し直す必要はありません）。

### 1-5. 配置する

```bash
npm run deploy
```

テスト（`node --test`）と、プロンプトの埋め込みが最新かの確認が通ってから配置されます。Worker の名前やアカウントを変えたときは、最後に表示される URL を `shared/worker-url.js` の `PRODUCTION_URL` に書き込みます。

### 1-6. 費用の安全装置を設定する（手作業）

- **Google Cloud の予算アラート**：Google Cloud コンソール →「お支払い」→「予算とアラート」→「予算を作成」。対象を Gemini API のキーがあるプロジェクトにして、金額（例：月3,000円）と通知のしきい値（50%・90%・100%）を設定します。
- **Anthropic の利用上限**（フェーズ4から）：Anthropic Console →「Settings」→「Limits」で月の上限額を設定します。
- Worker 側でも、1日の全体上限（上級者版60分など。`config.js` の `globalDailyLimits`）で止まるようになっています。

### 1-7. 学生版 Claude版（高校生向け）を使えるようにする

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY
node tools/hash-password.js --id sc-test --app student-claude --generate
npm run passwords
npm run deploy
```

1. `npm install`：Claude の公式 SDK（`@anthropic-ai/sdk`）が入ります（フェーズ4で追加）。
2. `ANTHROPIC_API_KEY`：聞かれたら、Anthropic Console（https://console.anthropic.com/）の「API Keys」で作ったキーを貼り付けます。
3. 高校生用のパスワードを作ります。表示されたパスワードを控えておき、生徒に配ります。ID（例：`sc-test`、`sc-2026-2nen`）はクラスや学年ごとに分けると、利用回数や安全フラグの件数を分けて見られます。
4. `npm run passwords` で登録し、`npm run deploy` で配置し直します（SDK を入れたので配置し直しが必要）。

使い始める前に、1-6 の Anthropic の利用上限も設定してください。

## 2. ふだんの作業

| やりたいこと | コマンド |
|---|---|
| テスト | `npm test` |
| `prompts/` や `data/` を変更した後 | `npm run sync`（Worker に埋め込むファイルを作り直す。忘れるとテストと配置が止まる） |
| 配置 | `npm run deploy` |
| ローカルで動かす | `.dev.vars.example` を `.dev.vars` にコピーしてから `npm run dev` |
| 配置した Worker のログを見る | `npm run tail` |

ローカルで動かすときのテスト用パスワードは `.dev.vars.example` に書いてあります（本番では使わない）。ローカルの Worker はダミーのキーなので、実際に AI と話すには `.dev.vars` の `GEMINI_API_KEY`（学生版 Claude版は `ANTHROPIC_API_KEY`）に本物のキーを入れます。

## 3. モデル名・単価の変更

`config.js` にまとめてあります。変更するときは、ファイルの先頭にある公式ドキュメントで最新の情報を確認し、「確認日」も更新してください。

## 4. うまく接続できないとき（上級者版）

- 画面に「AI に接続できませんでした」と出る場合、`npm run tail` で Worker のログを見ながら試します。`auth_tokens: 失敗 400 …` と出ていれば、一時トークンの作成で Google に断られています（キーの間違い、課金未設定、モデル名の変更など）。
- トークンは作れているのに接続できない場合は、`config.js` の `liveTokenLock` を `"all"` に変えて配置し直して試してください（接続条件の固定のしかたを変えます）。

## 5. うまく動かないとき（学生版 Claude版）

- 画面に「AIの応答に失敗しました」と出る場合、`npm run tail` で Worker のログを見ながら試します。
  - `Claude: 失敗 401 authentication_error`：`ANTHROPIC_API_KEY` が違います。登録し直してください。
  - `Claude: 失敗 400 …`：モデル名の変更などが考えられます。`config.js` の `scModel` を公式ドキュメントで確認します。
  - `Claude: 失敗 429`・`529`：Anthropic 側の混雑や上限です。しばらく待つか、Anthropic Console の上限を確認します。
- ログには会話の内容は出しません（エラーの種類だけ）。
