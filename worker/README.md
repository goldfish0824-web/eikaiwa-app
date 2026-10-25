# Worker の設定と配置（eikaiwa-worker）

この Worker は、API キーとシステムプロンプトをサーバー側で持ち、パスワードの種類（アプリ種別）ごとに呼べるエンドポイントを制限します。既存の中継とは別の、**このプロジェクト専用の新しい Worker** です。

コマンドはすべて `worker` フォルダで実行します（ターミナルで `cd worker`）。

## 1. はじめての準備（1回だけ）

### 1-1. Cloudflare にログイン

```bash
npx wrangler login
```

ブラウザが開くので、Cloudflare のアカウントで許可します。

### 1-2. KV（利用回数のカウンター）を作る

```bash
npx wrangler kv namespace create USAGE
```

表示された `id = "…"` の値を、`wrangler.toml` の `REPLACE_WITH_KV_NAMESPACE_ID` と置き換えます。

### 1-3. パスワードを作る

上級者版（自分用）のパスワード：

```bash
node tools/hash-password.js --id adv-tomoaki --app advanced
```

パスワードを入力すると、`{"id":"adv-tomoaki","hash":"…","app":"advanced"}` のような1行が表示されます。パスワードそのものは Worker に保存されず、ハッシュだけが保存されます。

学生に配布するパスワードは `--generate` を付けると、紛らわしい文字を使わないパスワードを自動で作れます（例：学生版 Claude版）。

```bash
node tools/hash-password.js --id sc-2026-2nen --app student-claude --generate
```

- `--app` は `advanced`（上級者版）／`student-claude`（高校生）／`student-gemini`（18歳以上の学生のみ）のどれか。
- **高校生に配るパスワードは必ず `student-claude` にしてください。** このパスワードでは Gemini を使う機能（`/adv/*`・`/sg/*`）が Worker で必ず拒否されます。
- 1日の上限を変えたいときは `--daily-minutes 40`（上級者版）、`--turns-per-device 80`・`--turns-total 3000`（学生版）を付けます。

表示された行を `[ ]` の中にカンマ区切りで並べたものが `PASSWORDS` です。

```json
[{"id":"adv-tomoaki","hash":"…","app":"advanced"},{"id":"sc-2026-2nen","hash":"…","app":"student-claude"}]
```

### 1-4. Secret を登録する

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put PASSWORDS
```

それぞれ、聞かれたら値を貼り付けます。

- `GEMINI_API_KEY`：Google AI Studio で**課金を有効にしたプロジェクト**のキー（無料枠のキーは、送った内容が Google の改善に使われるため使わない）。
- `PASSWORDS`：1-3 で作った JSON（1行）。
- `ANTHROPIC_API_KEY` は学生版 Claude版（フェーズ4）から使います。そのときに `npx wrangler secret put ANTHROPIC_API_KEY` で登録します。

パスワードを追加・削除するときは、`PASSWORDS` 全体を作り直して、もう一度 `npx wrangler secret put PASSWORDS` を実行します。

### 1-5. 配置する

```bash
npm run deploy
```

テスト（`node --test`）と、プロンプトの埋め込みが最新かの確認が通ってから配置されます。最後に表示される `https://eikaiwa-worker.＜あなたのサブドメイン＞.workers.dev` を、`shared/worker-url.js` の `PRODUCTION_URL` に書き込みます。

### 1-6. 費用の安全装置を設定する（手作業）

- **Google Cloud の予算アラート**：Google Cloud コンソール →「お支払い」→「予算とアラート」→「予算を作成」。対象を Gemini API のキーがあるプロジェクトにして、金額（例：月3,000円）と通知のしきい値（50%・90%・100%）を設定します。
- **Anthropic の利用上限**（フェーズ4から）：Anthropic Console →「Settings」→「Limits」で月の上限額を設定します。
- Worker 側でも、1日の全体上限（上級者版60分など。`config.js` の `globalDailyLimits`）で止まるようになっています。

## 2. ふだんの作業

| やりたいこと | コマンド |
|---|---|
| テスト | `npm test` |
| `prompts/` や `data/` を変更した後 | `npm run sync`（Worker に埋め込むファイルを作り直す。忘れるとテストと配置が止まる） |
| 配置 | `npm run deploy` |
| ローカルで動かす | `.dev.vars.example` を `.dev.vars` にコピーしてから `npm run dev` |
| 配置した Worker のログを見る | `npx wrangler tail` |

ローカルで動かすときのテスト用パスワードは `.dev.vars.example` に書いてあります（本番では使わない）。ローカルの Worker はダミーのキーなので、実際に AI と話すには `.dev.vars` の `GEMINI_API_KEY` に本物のキーを入れます。

## 3. モデル名・単価の変更

`config.js` にまとめてあります。変更するときは、ファイルの先頭にある公式ドキュメントで最新の情報を確認し、「確認日」も更新してください。

## 4. うまく接続できないとき（上級者版）

- 画面に「AI に接続できませんでした」と出る場合、`npx wrangler tail` で Worker のログを見ながら試します。`auth_tokens: 失敗 400 …` と出ていれば、一時トークンの作成で Google に断られています（キーの間違い、課金未設定、モデル名の変更など）。
- トークンは作れているのに接続できない場合は、`config.js` の `liveTokenLock` を `"all"` に変えて配置し直して試してください（接続条件の固定のしかたを変えます）。
