# CLAUDE.md — Sprout（英会話アプリ・仮称）開発ガイド

このファイルは Claude Code が最初に読む指示書です。作業を始める前に必ず `spec/` 以下の仕様書を読んでください。

## プロジェクトの概要

Speak のような AI 英会話学習アプリを、次の3つのアプリとして作る。

| アプリ | フォルダ | 対象 | 会話方式 | AIエンジン | 仕様書 |
|---|---|---|---|---|---|
| 上級者版 | `advanced/` | TOEIC900点超・英検1級レベルの大人（主な利用者は開発者本人） | リアルタイム音声対話 | Gemini Live API | `spec/01_advanced.md` |
| 学生版 Claude版 | `student-claude/` | **高校生**（18歳未満を含む） | ターン制 | Claude API＋ブラウザの音声認識・読み上げ | `spec/03_student_claude.md` |
| 学生版 Gemini版 | `student-gemini/` | **大学生など18歳以上の学生のみ** | ターン制 | Gemini API（音声を直接理解）＋Gemini TTS | `spec/04_student_gemini.md` |

学生版の2つは、画面と学習の流れ（`spec/02_student_common.md`）を共通にし、**AIエンジンだけを差し替える**設計にする。

## 最重要ルール：18歳未満に Gemini を使わせない

- Gemini API の利用規約は、18歳未満を対象とする、または18歳未満が利用する可能性が高いアプリでの利用を禁止している（`spec/06_terms_safety.md`）。
- **学生版 Claude版（高校生向け）から Gemini API を呼び出すコードを絶対に書かない。** 共通部品を作るときも、Claude版のビルド・配置物に Gemini 用のエンジンが含まれないようにする。
- Worker は、パスワードに紐づくアプリ種別で呼び出せるエンドポイントを制限する。高校生用のパスワードでは Gemini を使うエンドポイントが**必ず拒否**されること。これはテストで確認する。
- 学生版 Gemini版と上級者版は、高校生向けの資料やページからリンクしない。

## 開発者について

- 開発者（Tomoaki）は高校の英語教員。説明・報告・質問は**日本語**で行う。
- 開発環境は Windows 11。動作確認は PC の Chrome と iPhone の Safari が中心。
- 公開先は GitHub Pages（`goldfish0824-web.github.io`）。
- APIキーは Cloudflare Workers に置き、フロントエンドには絶対に置かない。既存の Workers 中継（Anthropic APIキーとシステムプロンプトをサーバー側で保持する仕組み）を拡張するか、本プロジェクト用に新しい Worker を作る（`spec/05_architecture.md`）。

## フォルダ構成（目標）

```
eikaiwa-app/
├── CLAUDE.md                ← このファイル
├── README.md
├── spec/                    ← 仕様書（変更したら更新する）
├── prompts/                 ← システムプロンプト原案（Worker に埋め込む）
├── data/                    ← モード・シナリオ定義（JSON）
├── advanced/                ← 上級者版（これから作る）
├── student-claude/          ← 学生版 Claude版・高校生向け（これから作る）
├── student-gemini/          ← 学生版 Gemini版・18歳以上向け（これから作る）
├── shared/                  ← 共通部品（これから作る）
│   ├── student-core/        ←   学生版の画面・学習の流れ（エンジンに依存しない）
│   ├── engines/             ←   claude-engine.js / gemini-engine.js
│   └── audio/               ←   マイク入力（16kHz PCM）・WAV変換・PCM再生
└── worker/                  ← Cloudflare Worker（これから作る）
```

## 実装のルール

1. **ビルド工程なし**の素の HTML / CSS / JavaScript（ES Modules）で作る。外部ライブラリは CDN から読み込む。
2. **モデル名・APIのバージョン・単価は変わりやすい。** コードに直書きせず `worker/config.js` にまとめ、実装時に必ず公式ドキュメントで最新を確認する。
   - Gemini API（Live・音声入力・TTS・構造化出力）: https://ai.google.dev/gemini-api/docs
   - Gemini 一時トークン: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
   - Claude API: https://docs.claude.com
3. 利用者の会話内容・音声を**サーバー側に保存しない**。Worker に残すのは利用回数のカウンターと、安全フラグの件数だけ。
4. スマホ（iPhone Safari）で必ず動くこと。マイクと音声再生はユーザーのタップを起点に開始する（iOS の自動再生制限）。
5. UI の文言は日本語。英会話の中身は英語。
6. 学生版のエンジンは `spec/05_architecture.md` の「エンジンの共通インターフェース」に従う。画面側のコードにエンジン固有の処理を書かない。
7. 上級者版の音声エンジンも、将来ほかの会社のリアルタイム音声 API に差し替えられるよう、接続・音声形式・割り込み処理をアダプター層に分ける。
8. 仕様にない判断をした場合は、該当する `spec/` のファイルに追記し、開発者に一言報告する。
9. `prompts/` のプロンプトを変更したら、Worker 側の埋め込みも更新する。

## 進め方

`spec/08_roadmap.md` のフェーズ順に進める。各フェーズの終わりに、開発者が実機で試せる状態にしてから次へ進む。最初は **フェーズ0（Worker の土台）→ フェーズ1（上級者版の最小構成）** から。
