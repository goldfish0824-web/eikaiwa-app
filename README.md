# 英会話アプリ（仮称）

Speak のような AI 英会話学習アプリを、API を組み込んで自作するプロジェクトです。3つのアプリを作ります。

| アプリ | 対象 | AIエンジン | 特徴 |
|---|---|---|---|
| **上級者版** | TOEIC900点・英検1級レベルで留学経験がない大人 | Gemini Live API | リアルタイムで AI と話し、会話後に「より自然な言い方」のレポートを受け取る |
| **学生版 Claude版** | 高校生 | Claude API＋ブラウザの音声機能 | 場面ごとのロールプレイを、ヒントや日本語サポートを使いながらターン制で練習する |
| **学生版 Gemini版** | 大学生など18歳以上の学生 | Gemini API＋Gemini TTS | Claude版と同じ画面・流れ。AI が声を直接聞くので音声認識が正確で、発音のポイントも伝えられる |

> 高校生には Gemini 版を使わせないでください（Gemini API の利用規約で、18歳未満が使うアプリへの組み込みが禁止されているため）。詳細は `spec/06_terms_safety.md`。

## Claude Code での始め方

1. このフォルダを任意の場所（例：`Documents\eikaiwa-app`）に置く。
2. フォルダでターミナルを開き、`claude` を起動する。
3. 最初にこう伝える：

   > CLAUDE.md と spec フォルダの仕様書を読んで、ロードマップのフェーズ0から始めてください。

## 進み具合

フェーズ0（Worker の土台）とフェーズ1（上級者版の最小構成）のコードができています。チェック状況は `spec/08_roadmap.md`。

### 実機で試すまでの手順

1. **Worker を配置する**：`worker/README.md` の手順（KV の作成 → パスワード作成 → Secret 登録 → `npm run deploy`）。
2. **Worker の URL を書く**：表示された URL を `shared/worker-url.js` の `PRODUCTION_URL` に書き込む。
3. **GitHub Pages に公開する**：このフォルダを `eikaiwa-app` リポジトリとして push し、Pages を有効にする。
4. **試す**：`https://goldfish0824-web.github.io/eikaiwa-app/advanced/` を PC の Chrome と iPhone の Safari で開く。

### パソコンだけで画面を確かめる（API なし）

```bash
node tools/dev-server.js
```

`http://localhost:8000/advanced/?mock=1` を開くと、偽の AI で画面の流れ（タイマー・字幕・結果画面）を確かめられます。ログインにはローカルの Worker（`worker` フォルダで `npm run dev`）が必要です。テスト用パスワードは `worker/.dev.vars.example` にあります。

## フォルダの中身

| パス | 内容 |
|---|---|
| `CLAUDE.md` | Claude Code への指示（最初に読まれる） |
| `spec/00_overview.md` | 目的・3つのアプリの位置づけ・全体方針・未決事項 |
| `spec/01_advanced.md` | 上級者版の機能仕様 |
| `spec/02_student_common.md` | 学生版の共通仕様（画面・学習の流れ） |
| `spec/03_student_claude.md` | 学生版 Claude版（高校生向け）の仕様 |
| `spec/04_student_gemini.md` | 学生版 Gemini版（18歳以上向け）の仕様 |
| `spec/05_architecture.md` | 技術設計（Worker・エンジンの共通インターフェース・音声処理・データ） |
| `spec/06_terms_safety.md` | 利用規約と安全対策 |
| `spec/07_cost_limits.md` | 費用の目安と利用制限 |
| `spec/08_roadmap.md` | 開発フェーズと動作確認チェックリスト |
| `prompts/` | システムプロンプトの原案 |
| `data/adv_modes.json` | 上級者版のモード・話題・場面 |
| `data/scenarios_hs.json` | 学生版 Claude版（高校生）のシナリオ12本 |
| `data/scenarios_univ.json` | 学生版 Gemini版（大学生）のシナリオ12本 |
| `advanced/` | 上級者版（画面・会話の制御・Live API のアダプター） |
| `shared/` | 共通部品（マイク入力・PCM 再生・Worker の URL・端末内の保存） |
| `worker/` | Cloudflare Worker（設定手順は `worker/README.md`） |
| `tools/` | ローカル確認用のサーバーなど |

## 事前に用意するもの

- Google AI Studio の API キー（**課金を有効にしたプロジェクト**のもの。上級者版と学生版 Gemini版で使用）
- Anthropic の API キー（既存のものを流用可。学生版 Claude版で使用）
- Cloudflare アカウント（Workers と KV を使用）
- GitHub Pages のリポジトリ
