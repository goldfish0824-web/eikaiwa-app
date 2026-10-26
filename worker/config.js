// Worker の設定。モデル名・API のバージョン・単価は変わりやすいので、ここに集める。
// 変更するときは必ず公式ドキュメントで最新を確認し、下の「確認日」も更新すること。
//   Gemini モデル一覧: https://ai.google.dev/gemini-api/docs/models
//   Gemini 料金:       https://ai.google.dev/gemini-api/docs/pricing
//   一時トークン:      https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
//   Claude:            https://docs.claude.com
//   Claude 料金:       https://platform.claude.com/docs/en/about-claude/pricing
// 確認日: 2026-10-25（Claude の項目は 2026-10-26）

export const APPS = ["advanced", "student-claude", "student-gemini"];

export const CONFIG = {
  // ---- API の接続先 ----
  geminiApiBase: "https://generativelanguage.googleapis.com",
  geminiApiVersion: "v1beta", // 一時トークンと Live API の一時トークン接続は v1beta のみ
  geminiLiveWsUrl:
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
  anthropicApiBase: "https://api.anthropic.com", // API のバージョンは公式 SDK（package.json で固定）が決める
  claudeTimeoutMs: 30_000,
  claudeMaxRetries: 1,

  // ---- 上級者版（Gemini Live API） ----
  liveModel: "gemini-3.8-live", // 通常版（Stable）
  liveModelThinking: "gemini-3.8-live-extended-thinking", // じっくり考える版（Stable）
  // じっくり考える版だけに付ける。low | medium | high（minimal は不可）。通常版には thinkingLevel を付けてはいけない。
  liveThinkingLevel: "low",
  // AI の声（Live API はTTS と同じ声が使える）。ペルソナの voice_hint で選ぶ。先頭が既定。
  liveVoices: {
    female: ["Aoede", "Kore", "Leda", "Zephyr"],
    male: ["Puck", "Charon", "Fenrir", "Orus"],
    any: ["Puck", "Aoede"],
  },
  // 発話の区切りの検出など。null ならサーバーの既定値。
  // 例: { automaticActivityDetection: { silenceDurationMs: 800 } }
  liveRealtimeInputConfig: null,
  // 一時トークンで固定する範囲。
  //   "fields": モデル・システムプロンプト・音声などを固定し、セッション再開（sessionResumption）だけはブラウザ側の設定を使う。
  //   "all":    ブラウザ側の setup をすべて無視する（再接続でのセッション再開は使えなくなる）。
  // "fields" で接続できない場合は "all" に切り替えて試す。
  liveTokenLock: "fields",
  liveTokenNewSessionSeconds: 60, // 発行から新しいセッションを開始できる期限
  liveTokenExtraMinutes: 2, // トークンの有効期限 = 会話時間 + この分数
  sessionMinutesOptions: [5, 10],
  maxSessionMinutes: 10,

  // レポート（フェーズ2）
  reportProvider: "gemini", // "gemini" | "claude"
  reportModelGemini: "gemini-3.8-flash",
  reportModelClaude: "claude-sonnet-5-5",

  // 費用の目安（米ドル／100万トークン、有料枠）。画面で会話ごとの概算を出すのに使う。
  livePricingUsdPerMTokens: {
    inputText: 0.75,
    inputAudio: 3.0,
    outputText: 4.5, // 思考トークンを含む
    outputAudio: 12.0,
  },
  usdJpy: 150,

  // ---- 学生版 Claude版（高校生）。Gemini は使わない ----
  scModel: "claude-haiku-5-5",
  // Haiku 5.5 は思考（adaptive thinking）が既定で有効。effort で量を決める（既定は medium）。
  // temperature などのサンプリング設定は送らない（送ると 400 になる）。
  scTurnEffort: "low", // 会話の返答・日本語→英語は待ち時間を短く
  scSummaryEffort: "medium", // ふりかえりは1回だけなので、少していねいに
  scTurnMaxTokens: 4000, // 思考の分も含む
  scSummaryMaxTokens: 6000,
  scMaxExchanges: 20, // 1回の会話の往復数の上限
  scMaxUtteranceChars: 300, // 1発言の文字数の上限
  // 費用の目安（米ドル／100万トークン。プロンプトが10万トークン以下の場合）。
  claudePricingUsdPerMTokens: {
    "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  },

  // ---- 学生版 Gemini版（18歳以上のみ）。フェーズ6で再確認する ----
  sgTurnModel: "gemini-3.1-flash-lite",
  sgSummaryModel: "gemini-3.8-flash",
  sgTtsModel: "gemini-3.8-flash-tts",
  sgMaxAudioSeconds: 30,

  // ---- 利用上限（PASSWORDS の各項目で上書きできる） ----
  defaultLimits: {
    advanced: { dailyMinutes: 40 },
    "student-claude": { dailyTurnsPerDevice: 80, dailyTurnsTotal: 3000 },
    "student-gemini": { dailyTurnsPerDevice: 80, dailyTurnsTotal: 2000, dailyTtsPerDevice: 200 },
  },
  // 全体の上限（安全装置）。上級者版は分、学生版は往復数。
  globalDailyLimits: {
    advanced: 60,
    "student-claude": 5000,
    "student-gemini": 3000,
  },
  usageTtlSeconds: 3 * 24 * 60 * 60, // カウンターは3日で自動削除
  safetyFlagTtlSeconds: 30 * 24 * 60 * 60, // 安全フラグの件数は、開発者が確かめられるよう30日残す

  // ---- 入力の制限 ----
  maxBodyBytes: 64 * 1024,
  maxAudioBodyBytes: 1536 * 1024, // 16kHz・16bit・モノラル30秒の WAV（約960KB）を Base64 にした大きさ＋余裕
  maxWarmupPhrases: 3,
  maxPhraseChars: 120,
};
