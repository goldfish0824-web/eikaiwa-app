# 05 技術設計

## 1. 全体構成

```
[ブラウザ（GitHub Pages）]
   │
   ├─ 上級者版 ──── ① パスワード送信 ──▶ [Worker] ── 一時トークン発行 ──▶ Gemini API
   │                ② 一時トークン受取 ◀──┘
   │                ③ 一時トークンで直接 WebSocket 接続 ──────────────▶ Gemini Live API
   │                ④ 会話後、文字起こしを送信 ──▶ [Worker] ── レポート生成 ──▶ Gemini（or Claude）
   │
   ├─ 学生版 Claude版（高校生）
   │                音声認識・読み上げはブラウザ内
   │                毎ターン、テキストを送信 ──▶ [Worker] ── 返答生成 ──▶ Claude API
   │
   └─ 学生版 Gemini版（18歳以上）
                    毎ターン、録音（WAV）を送信 ──▶ [Worker] ── 文字起こし＋返答 ──▶ Gemini API
                    返答テキストを送信 ──────────▶ [Worker] ── 音声合成 ─────────▶ Gemini TTS
```

- API キーは Worker の Secret にのみ保存する。ブラウザには渡さない。
- 上級者版は音声を Worker 経由で中継しない（遅延と Worker の負荷を避けるため）。代わりに Worker が**一時トークン**を発行し、ブラウザが Live API に直接接続する。
- 学生版 Claude版の通信先は Claude API だけ。**Gemini には一切つながない。**

## 2. フロントエンド

- 素の HTML / CSS / JavaScript（ES Modules）。ビルド工程なし。
- 配置：
  ```
  advanced/index.html          上級者版
  student-claude/index.html    学生版 Claude版（claude-engine.js だけを読み込む）
  student-gemini/index.html    学生版 Gemini版（gemini-engine.js だけを読み込む）
  shared/student-core/         学生版の画面・流れ（エンジンに依存しない）
  shared/engines/              claude-engine.js / gemini-engine.js
  shared/audio/                マイク入力（AudioWorklet・16kHz PCM）、WAV 変換、PCM 再生キュー
  ```
- 各学生版の `index.html` は、使うエンジンを1つだけ読み込んで `student-core` に渡す。
- Worker の URL は `shared/worker-url.js` に1か所だけ書く（localhost で開いたときはローカルの Worker `http://localhost:8787` を使う）。
- ローカル確認用に `tools/dev-server.js`（静的ファイルサーバー、`http://localhost:8000/`）と `.claude/launch.json` を置く。
- 上級者版は `?mock=1` を付けて開くと、API を使わない偽のアダプター（`advanced/adapters/mock-live.js`）で画面の流れを確認できる（開発用。通常は読み込まれない）。
- 学生版の共通部品（2026-10-26 作成）：
  ```
  shared/student-core/app.js           画面の遷移（ログイン・ホーム・今日のフレーズ・ふりかえり・使い方・相談先）
  shared/student-core/roleplay.js      ロールプレイ画面
  shared/student-core/conversation.js  会話履歴（往復数・やり直す・使えたフレーズ）
  shared/student-core/phrase-match.js  今日のフレーズの一致判定（単語が順番どおりに7割以上あれば OK）
  shared/student-core/style.css
  shared/speech/                       ブラウザの音声認識・読み上げ（Claude版のエンジンが使う）
  shared/api.js                        Worker との通信（全アプリ共通）
  student-claude/texts.js              Claude版の文言（注意事項・使い方・相談先）
  ```
- 学生版も `?mock=1` で偽のエンジン（`shared/engines/mock-engine.js`）を使える。キーボードで「support」と送ると相談先画面、「error」と送るとエラー表示を確かめられる。
- 画面側のテストは、ルートで `node --test "test/*.test.js"`（`npm test`）。`test/student-claude-isolation.test.js` は、高校生版のページから読み込まれるファイルをすべてたどり、Gemini のコードや18歳以上向けのページへの参照がないことを確かめる。
- GitHub Pages で `_` から始まるファイル等が除外されないよう、ルートに `.nojekyll` を置く。
- GitHub Pages の URL 例：`https://goldfish0824-web.github.io/eikaiwa-app/student-claude/`
- HTTPS 必須（マイク利用のため。GitHub Pages は HTTPS なので問題なし）。

## 3. Cloudflare Worker

### 3.0 構成（2026-10-25 決定）
- 既存の中継を拡張せず、**このプロジェクト専用の新しい Worker（`eikaiwa-worker`）** を作った。アプリ種別によるエンドポイント制限（18歳未満に Gemini を使わせない仕組み）を、ほかの用途の中継と混ぜずに確実に保つため。
- ファイル構成：`worker/src/index.js`（ルーティングとアクセス制御。`ROUTES` に各エンドポイントの許可アプリを書く）、`src/auth.js`、`src/usage.js`、`src/routes/*`、`src/upstream/gemini.js`（Gemini 呼び出し。`student-claude` を二重に拒否）、`src/upstream/claude.js`（Claude 呼び出し。公式 SDK `@anthropic-ai/sdk` を使い、`student-claude` 以外を拒否。2026-10-26 追加）、`src/prompts/*`（プロンプトの組み立て）。
- `prompts/*.md` と `data/*.json` は、`node tools/sync-embedded.js` で `src/generated/embedded.js` に変換して Worker に埋め込む。Markdown の見出しごとにコードブロックを取り出す（`- key:` の下のブロックは選択肢として扱う）。変換を忘れるとテストと `npm run deploy` が止まる。
- テストは `node --test`。依存パッケージは Claude の公式 SDK（`@anthropic-ai/sdk`。版を固定）だけ。設定手順は `worker/README.md`。

### 3.1 Secret・設定
| 名前 | 内容 |
|---|---|
| `GEMINI_API_KEY` | 課金を有効にした Google AI Studio プロジェクトのキー（上級者版・学生版 Gemini版） |
| `ANTHROPIC_API_KEY` | Anthropic のキー（学生版 Claude版。上級者版のレポートを Claude で作る場合も） |
| `PASSWORDS` | パスワードの定義（JSON。下記）。KV に置いてもよい |
| KV `USAGE` | 利用回数・安全フラグ件数のカウンター |
| `ALLOWED_ORIGINS` | `https://goldfish0824-web.github.io` |

`PASSWORDS` の例（パスワードそのものではなく SHA-256 ハッシュで保存する）：
```json
[
  { "id": "adv-tomoaki",   "hash": "…", "app": "advanced",       "dailyMinutes": 40 },
  { "id": "sc-2026-2nen",  "hash": "…", "app": "student-claude", "dailyTurnsPerDevice": 80, "dailyTurnsTotal": 3000 },
  { "id": "sg-univ-2026",  "hash": "…", "app": "student-gemini", "dailyTurnsPerDevice": 80, "dailyTurnsTotal": 2000 }
]
```

### 3.2 モデル設定（`worker/config.js`）
モデル名は変わりやすいので一か所にまとめ、実装時に公式ドキュメントで最新を確認する。実際の値は `worker/config.js` を正とする。
2026-10-25 に公式のモデル一覧・料金ページで確認した主な値：
```js
export const CONFIG = {
  // 上級者版
  liveModel: "gemini-3.8-live",                         // Stable
  liveModelThinking: "gemini-3.8-live-extended-thinking", // Stable。thinkingLevel は low/medium/high（通常版には付けない）
  reportProvider: "gemini",                              // "gemini" | "claude"
  reportModelGemini: "gemini-3.8-flash",                 // 旧案 gemini-3-flash は preview のみのため変更
  reportModelClaude: "claude-sonnet-5-5",
  maxSessionMinutes: 10,

  // 学生版 Claude版（高校生）
  scModel: "claude-haiku-5-5",

  // 学生版 Gemini版（18歳以上）※フェーズ6で再確認
  sgTurnModel: "gemini-3.1-flash-lite",                  // Stable。gemini-3.5-flash-lite も候補
  sgSummaryModel: "gemini-3.8-flash",
  sgTtsModel: "gemini-3.8-flash-tts",                    // 旧案 gemini-3.1-flash-tts-preview は legacy 扱いのため変更
  sgMaxAudioSeconds: 30,
};
```
- このほか、Live API の声・接続先 URL・API バージョン・単価（費用の概算用）・利用上限も `config.js` に置く。
- 学生版 Claude版の呼び出し方（2026-10-26 決定）：
  - 公式 SDK で Messages API を呼ぶ。返答は構造化出力（`output_config.format` に JSON Schema）で受け取り、Worker でも値を確かめてから返す。おかしな出力は1回だけ作り直し、それでもだめなら決まった返答（`fallback`）にする。
  - 思考（adaptive thinking）は既定のまま。待ち時間を短くするため、`output_config.effort` を会話は `low`、ふりかえりは `medium` にする（`scTurnEffort`・`scSummaryEffort`）。temperature などは指定しない。
  - システムプロンプトは「共通部分」「シナリオ部分」の2つに分けてキャッシュする（`cache_control`）。往復の番号はシステムプロンプトではなく生徒の発言の側に書く（キャッシュが効くように）。
  - Claude が答えを断った場合（`stop_reason: "refusal"`）は、`redirect` の決まった返答にして安全フラグの件数に数える。

### 3.3 エンドポイントとアクセス制御
すべて POST、JSON。全リクエストで Origin を確認し、許可外は 403。
**パスワードのアプリ種別と、エンドポイントの「許可するアプリ」が一致しなければ 403 を返す。** 高校生用（`student-claude`）のパスワードでは、Gemini を呼ぶエンドポイントに絶対に到達できないこと。

| パス | 許可するアプリ | 用途 | 入力 | 出力 |
|---|---|---|---|---|
| `/auth` | すべて | パスワード確認 | `{password, app}` | `{ok, passwordId, app, limits}` |
| `/adv/token` | advanced | Live API 一時トークン発行 | `{password, deviceId, minutes, thinking, mode, settings, warmupPhrases[], recent}` | `{token, model, wsUrl, expiresAt, session, pricing, usage}` |
| `/adv/report` | advanced | 言い直しレポート | `{password, mode, settings, transcript[], warmupPhrases[]}` | レポート JSON |
| `/sc/turn` | student-claude | 1往復（Claude） | `{password, deviceId, scenarioId, level, history[], userText, action}` | ターン JSON |
| `/sc/summary` | student-claude | ふりかえり（Claude） | `{password, deviceId, scenarioId, level, history[]}` | ふりかえり JSON |
| `/sg/turn` | student-gemini | 1往復（Gemini・音声入力） | `{password, deviceId, scenarioId, level, history[], audioBase64, mimeType, action}` | ターン JSON（`user_transcript` 付き） |
| `/sg/tts` | student-gemini | 読み上げ音声 | `{password, deviceId, text, level, slow}` | WAV 音声 |
| `/sg/summary` | student-gemini | ふりかえり（Gemini） | `{password, deviceId, scenarioId, level, history[], pronunciationNotes[]}` | ふりかえり JSON |

- `/adv/token` の補足（2026-10-25 追加）：
  - `mode`（`smalltalk` など）・`settings`（速さ・くだけ具合・割り込み・訂正。不正な値は初期値）・`warmupPhrases`（最大3件・各120文字。改行は除く）を受け取り、Worker がシステムプロンプトを組み立ててトークンに固定する。
  - ペルソナ・話題・場面は Worker が `data/adv_modes.json` から選ぶ。`recent`（`{topics: [番号], scenes: [ID]}`。直近に使ったもの）は避ける。
  - 応答の `session` は画面に表示してよい情報（相手・話題・場面）。ロールプレイの「予想外の展開」は返さない。`wsUrl` は接続先（API バージョンを `config.js` だけで管理するため）。`pricing` は費用の概算用の単価、`usage` は今日の使用分数。
  - 利用分数は「上限の確認 → トークン作成 → 成功したら加算」の順。トークン作成に失敗したら加算しない。上限に足りないときは「今日の残りは◯分です。短い会話を選んでください。」と返す。
- 学生版の `action` は `"start"`（最初の一言）／`"reply"`（通常の返答）／`"ja2en"`（日本語→英語）。
- システムプロンプトは**Worker 側で組み立てる**（`prompts/` の原案を埋め込む）。クライアントからはシナリオIDとレベルだけを受け取り、プロンプト本文は受け取らない。シナリオデータ（`data/*.json`）は Worker にも同梱する。
- 学生版の `history` は最大20往復・1発言あたり最大300文字。`history` はテキストのみ（過去の音声は送らない）。
  - **2026-10-26 変更**：上限を超えた `history` は切り詰めずに 400 を返す（画面側が20往復で会話を終えるので、超えるのは不正なリクエストだけ）。`reply` で生徒の発言がすでに20回あれば「会話の往復数の上限に達しました。ふりかえりに進んでください。」を返す。
  - `/sc/turn` の出力は `{ ok, action, exchange, maxTurns, turn | ja2en, costJpy }`、`/sc/summary` は `{ ok, summary, costJpy }`。`costJpy` はその呼び出しの費用の目安（円）で、画面では `?cost=1` を付けたときだけ表示する（開発者の確認用）。
- `/sg/turn` の音声は WAV（16kHz・モノラル）で最長30秒。サイズ超過は 413。
- `/sg/tts` のテキストは最大400文字。利用回数に加算する（無料の読み上げサービスとして悪用されないように）。Gemini TTS が返す PCM に WAV ヘッダーを付けて返す（出力形式は公式ドキュメントで確認）。

### 3.4 一時トークンの発行（上級者版）
Gemini API の一時トークン機能を使う。要点：
- Worker がキーを使ってトークンを作成し、ブラウザに渡す。ブラウザはそれを API キーの代わりに使って Live API に接続する。
- トークンは Live API 専用。
- 設定項目（名前は公式ドキュメントで確認）：
  - 使用回数：1回
  - 有効期限：会話時間＋2分
  - 新しいセッションを開始できる期限：発行から1分
  - 接続条件の固定：モデル名、応答形式（音声）など。可能ならシステムプロンプトも固定する。
- API のバージョン（v1alpha / v1beta）はドキュメントで確認する。
- 実装（2026-10-25 確認）：
  - 作成：`POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`（ヘッダー `x-goog-api-key`）。本文は `{uses: 1, expireTime, newSessionExpireTime, bidiGenerateContentSetup: {model, generationConfig, systemInstruction, inputAudioTranscription, outputAudioTranscription}, fieldMask}`。応答の `name` がトークン。
  - 固定のしかた：`fieldMask` に挙げた項目（モデル・システムプロンプト・声・文字起こしなど）はトークン側の値で上書きされ、ブラウザからは変えられない。セッション再開（`sessionResumption`）は再接続のときにブラウザが指定する必要があるので固定しない。`fieldMask` を付けない（`config.js` の `liveTokenLock: "all"`）と、ブラウザ側の setup はすべて無視される。
  - 接続：`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=トークン`。最初に `{setup: {model, sessionResumption}}` を送り、`setupComplete` を待つ。
  - セッション再開はトークンの使用回数に数えられない（有効期限内なら同じトークンで再接続できる）。

### 3.5 CORS とエラー
- `Access-Control-Allow-Origin` は許可した Origin のみ。
- 上限超過は 429 と日本語メッセージ（「今日の利用上限に達しました。また明日使ってください。」）。
- API 側のエラーは詳細を隠し、「AIの応答に失敗しました。もう一度試してください。」を返す。
- 会話内容・音声をログに出力しない（`console.log` で本文を出さない）。

## 4. 学生版エンジンの共通インターフェース

`shared/student-core/` はこのインターフェースだけを使い、エンジン固有の処理を知らない。

```js
// shared/engines/claude-engine.js と gemini-engine.js が実装する（2026-10-26 実装に合わせて更新）
class StudentEngine {
  constructor({ workerUrl, password, deviceId, scenario, level, ttsRate }) {}

  // 能力の宣言（画面の出し分けに使う）
  capabilities = {
    confirmBeforeSend: true,   // Claude版: 認識結果を確認してから送る / Gemini版: false
    pronunciation: false,      // Gemini版: true
    interimText: true,         // 話している途中の文字を出せるか（Claude版: true）
  };
  costJpy = 0;                          // この会話で使った費用の目安（Worker が返す costJpy の合計）
  get canListen()                       // 声で話せるか（false ならキーボード入力にする）

  async init()                          // 音声の準備。iOS対策としてタップ操作の中で呼ぶ（await しなくてよい）
  async startListening({ lang })        // lang: "en" | "ja"
  async stopListening()                 // → { kind: "text", text } | { kind: "audio", wavBase64, durationSec }
  cancelListening()                     // 結果を捨てて止める
  onLevel(callback)                     // 入力レベル 0〜1
  onInterim(callback)                   // 途中経過テキスト（対応するエンジンのみ）
  onAutoEnd(callback)                   // 無音などで自然に話し終わったとき（画面は stopListening を呼ぶ）

  async start()                         // → TurnResult（AIの最初の一言）
  async reply(utterance, { history })   // → TurnResult
  async ja2en(utterance, { history })   // → Ja2EnResult
  async speak(text, { slow })           // 再生終了で resolve
  stopSpeaking()
  async summary(history, { pronunciationNotes })  // → SummaryResult
  dispose()                             // 画面を離れるときに呼ぶ
}
```

- 変更点（2026-10-26）：会話履歴は画面側（`conversation.js`）が持つので、`reply`・`ja2en` に `{ history }` を渡す（エンジンは履歴を持たない）。`onAutoEnd`・`cancelListening`・`dispose`・`canListen`・`costJpy` を追加した。
- `Ja2EnResult`：`{ en, enSimple, tipJa, safetyFlag, supportMessageJa }`。`SummaryResult`：`{ canDo, tryNext: { youSaid, better, whyJa } | null, keyPhrasesUsed: [true, false, …], privacyNoteJa, encouragementJa, pronunciationTips }`。
- エラーは `ApiError`（`status` と日本語の `message`）として投げる。画面はメッセージをそのまま表示し、429 のときは会話を続けさせない。

`TurnResult`（Worker の JSON をキャメルケースに変換したもの）：
```js
{
  userTranscript,      // Gemini版のみ：AIが聞き取った生徒の発言
  replyEn, replyJa,
  hints,               // 3つ（短い順）
  usedKeyPhrases,      // [0, 2] など
  goalReached, shouldEnd,
  safetyFlag,          // "none" | "redirect" | "support"
  supportMessageJa,
  pronunciationNoteJa, // Gemini版のみ（なければ空文字）
  exchange, maxTurns,  // 何往復目か・往復数の目安
  fallback             // AI の出力が使えず、決まった返答にしたとき true
}
```

## 5. 上級者版の音声処理

### 5.1 入力（マイク → Live API）
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`
- AudioWorklet で 16kHz・16bit・モノラルの PCM（リトルエンディアン）に変換し、約100msごとに送信。MIME は `audio/pcm;rate=16000`。
- iOS Safari では AudioContext のサンプルレートが48kHzになることが多いので、Worklet 内でダウンサンプリングする。
- AudioContext の作成・再開は「開始」ボタンのタップ時に行う。
- この入力処理は `shared/audio/` に置き、学生版 Gemini版の録音でも使う。

### 5.2 出力（Live API → スピーカー）
- 24kHz・16bit・モノラルの PCM を受け取り、AudioContext で途切れないように順番に再生（再生キュー）。
- サーバーから割り込み（ユーザーが話し始めた）の通知が来たら、キューをすぐに空にする。割り込み通知なしでターン完了が届く場合があるとの報告があるため、その場合も再生状態が崩れないようにする。
- イヤホンの使用を推奨する（エコー・誤検出の防止）。画面にも表示。
- イヤホンがないとき用に「イヤホンなしで使う」オプションを置く（初期値：オフ）。オンにすると、AI の音声を再生している間と終わってから0.35秒は、マイクの音を送らない（AI が自分の声に反応し続けるのを防ぐ代わりに、AI の発話中に割り込めなくなる）。2026-10-25 追加。

### 5.3 文字起こし
- 入力・出力の両方の音声文字起こしを有効にする。
- 受け取った文字起こしを、話者・開始時刻・終了時刻つきで配列に保存（レポートと数値計算に使用）。
- 長時間の連続ストリームでは文字起こしが不安定になる報告があるため、1回の会話は10分以内にする。

### 5.4 セッション管理
- 接続時に設定（システムプロンプト、音声、文字起こし有効化）を送る。
- クライアントから送る制御メッセージ（テキスト。`realtimeInput.text` で送る）：
  - `[START]`：接続直後。AI から挨拶して会話を始める（Live API は相手の入力を待つため。2026-10-25 追加）。
  - `[WRAP_UP]`：終了30秒前。AI が自然に会話を締める。AI やユーザーが話している途中なら、切れ目まで待ってから送る。
  - `[REPEAT]`：「今の発言をもう一度」ボタン。
  - `[NEXT]`：Quick Response モードで、AI の発話終了後にユーザーが一定時間（`data/adv_modes.json` の `silence_seconds_before_next`）話さなかったとき。無音はマイクの入力レベルから判定する。
- 「一時停止」ボタン：マイク入力の送信を止める。再開で送信を戻す。
- 接続が切れた場合は、残り時間があれば一度だけ再接続（セッション再開機能があれば利用）を試み、だめなら終了してレポートへ進む。
- 会話ごとに Live API が返すトークン使用量を記録する（費用の実測用）。`usageMetadata` が1回の応答の中で複数届いた場合は最後の値を使い、応答ごとの値を合計する。入力・出力をモダリティ（音声・テキスト）別に集計し、`/adv/token` の `pricing` で概算する。合計の数え方が実際の請求と合うかは、フェーズ1の実測で Google Cloud の請求額と照らし合わせて確かめる。
- 時間切れのときは、マイクの送信を止め、AI の話の切りがつくまで最長8秒待ってから終了する。
- 会話中は Screen Wake Lock で画面が消えないようにする（iOS で画面が消えると音声が止まるため。非対応の端末では何もしない）。

### 5.5 アダプター層
- 「接続」「音声の送信」「音声の受信」「割り込み」「文字起こし」「制御メッセージ」をアダプターのメソッドとして定義し、画面側はアダプターだけを使う。
- 将来ほかの会社のリアルタイム音声 API を試す場合は、アダプターを追加するだけで済むようにする（音声のサンプルレートや割り込みの扱いは会社ごとに異なる）。
- 実装：インターフェースは `advanced/adapters/realtime-adapter.js`、Gemini 用は `advanced/adapters/gemini-live.js`。会話の制御（タイマー・制御メッセージ・再生キュー・文字起こし・使用量）は `advanced/session.js` で、アダプターのメソッドとイベントだけを使う。

## 6. 学生版 Claude版の音声処理（ブラウザ）

### 6.1 音声認識
- `webkitSpeechRecognition` / `SpeechRecognition`。`lang="en-US"`、`interimResults=true`。「日本語で言う」のときだけ `lang="ja-JP"`。
- 非対応ブラウザ・マイク拒否時はテキスト入力欄を表示。マイクがあってもキーボード入力に切り替えられる。
- 実装（`shared/speech/browser-recognizer.js`。2026-10-26）：認識のたびに新しいオブジェクトを作る。重複して届いた結果は前のものを捨てる。話し終わってから1.8秒新しい言葉がなければ自動で終わる（1回の最長30秒）。止めても終わりの合図が来ないときは1.5秒で打ち切る。
- 認識の開始はタップの処理の中で、await をはさまずに呼ぶ（iOS の制限）。

### 6.2 読み上げ
- `speechSynthesis`。英語の声から端末で使える最も自然な声を選ぶ（優先リスト：Edge・Windows の Natural の声 → iPhone・Mac の Premium／Enhanced の声 → Google US English → Samantha など）。
- 速度はレベルに応じて設定。「もう一度」は 0.75。
- iOS 対策：シナリオを選ぶタップの中で、音量0の空の読み上げを1回行う（`unlock`）。終わりの合図が来ない不具合に備え、文の長さから計算した時間で打ち切る。

## 7. 学生版 Gemini版の音声処理

### 7.1 録音
- `shared/audio/` の入力処理で 16kHz PCM を取得し、録音終了時に WAV（ヘッダー付き）に変換して Base64 で送る。
- 無音判定（約1.5秒）で自動終了、最長30秒、0.5秒未満は送信しない。

### 7.2 Gemini への送り方（Worker 内）
- `generateContent` に、システムプロンプト、テキストの会話履歴、最新の発話の音声（inline data、`audio/wav`）を渡す。
- レスポンススキーマを指定して JSON で受け取る（`prompts/student_turn_gemini.md`）。

### 7.3 読み上げ
- 返答テキストを `/sg/tts` に送り、WAV を受け取って再生。失敗時はブラウザ読み上げに切り替え。
- 同じテキスト・同じ速さの音声はメモリにキャッシュして再利用。

## 8. データ形式

### 8.1 上級者版の文字起こし
```json
[
  { "speaker": "user", "text": "I think it depends on the situation.", "start": 12.3, "end": 15.1 },
  { "speaker": "ai", "text": "Fair enough. What kind of situation?", "start": 15.4, "end": 17.0 }
]
```

### 8.2 上級者版のフレーズ帳（localStorage キー `adv.phrases`）
```json
[
  {
    "id": "p_20261025_01",
    "original": "I have a plan to go to Taipei.",
    "natural": "I'm planning to go to Taipei.",
    "noteJa": "予定は be planning to が自然。have a plan to は堅く不自然。",
    "type": "unnatural",
    "savedAt": "2026-10-25",
    "box": 1,
    "nextReview": "2026-10-26"
  }
]
```

### 8.3 学生版の会話履歴（クライアント内）
```json
[
  { "role": "ai", "text": "Hello! Welcome! What would you like?" },
  { "role": "student", "text": "What do you recommend?" }
]
```
Gemini版では `student` の `text` に Gemini が返した `user_transcript` を入れる。

## 9. 端末ID

- 初回起動時にランダムな ID（UUID）を作って localStorage に保存し、利用回数の端末ごとの集計に使う。個人を特定する情報とは結びつけない。

## 10. 安全フラグの件数

- 学生版で `safety_flag` が `redirect` / `support` になった回数を、`日付:パスワードID:#flag:フラグ` のキーで KV に数える（内容は保存しない）。利用回数のカウンターより長く、30日で自動削除する（`config.js` の `safetyFlagTtlSeconds`。2026-10-26 決定）。
- 開発者が Cloudflare のダッシュボードまたは簡単な確認用エンドポイント（管理用パスワード付き）で件数を見られるようにする。`support` が出た場合に学年全体へ相談窓口を周知するなど、運用で対応するため。
