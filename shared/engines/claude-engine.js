// 学生版 Claude版（高校生）のエンジン。spec/05_architecture.md「4. 学生版エンジンの共通インターフェース」の実装。
//   認識:   ブラウザの音声認識（shared/speech/browser-recognizer.js）
//   AI:     Worker の /sc/turn・/sc/summary（Claude）
//   読み上げ: ブラウザの読み上げ（shared/speech/browser-tts.js）
// このファイルと、ここから読み込むファイルに Gemini を使うコードを入れないこと。
import { post } from "../api.js";
import { BrowserRecognizer } from "../speech/browser-recognizer.js";
import { BrowserTts } from "../speech/browser-tts.js";

export function toTurnResult(data) {
  const t = data.turn;
  return {
    userTranscript: "",
    replyEn: t.reply_en,
    replyJa: t.reply_ja,
    hints: t.hints,
    usedKeyPhrases: t.used_key_phrases,
    goalReached: t.goal_reached,
    shouldEnd: t.should_end,
    safetyFlag: t.safety_flag,
    supportMessageJa: t.support_message_ja,
    pronunciationNoteJa: "",
    exchange: data.exchange,
    maxTurns: data.maxTurns,
    fallback: t.fallback === true,
  };
}

export function toJa2EnResult(data) {
  const j = data.ja2en;
  return { en: j.en, enSimple: j.en_simple, tipJa: j.tip_ja, safetyFlag: j.safety_flag, supportMessageJa: j.support_message_ja };
}

export function toSummaryResult(data) {
  const s = data.summary;
  return {
    canDo: s.can_do,
    tryNext: s.try_next ? { youSaid: s.try_next.you_said, better: s.try_next.better, whyJa: s.try_next.why_ja } : null,
    keyPhrasesUsed: s.key_phrases_used,
    privacyNoteJa: s.privacy_note_ja,
    encouragementJa: s.encouragement_ja,
    pronunciationTips: [],
    fallback: s.fallback === true,
  };
}

export class ClaudeEngine {
  capabilities = {
    confirmBeforeSend: true, // ブラウザの誤認識をその場で直せるよう、送る前に確認する
    pronunciation: false, // ブラウザの認識は発音を直してしまうので、発音の評価はしない
    interimText: true,
  };
  costJpy = 0; // この会話で使った費用の目安（開発者の確認用）

  #opts;
  #recognizer = new BrowserRecognizer();
  #tts = new BrowserTts();
  #listening = false;
  #starting = null;

  constructor({ workerUrl, password, deviceId, scenario, level, ttsRate = 0.95 }) {
    this.#opts = { workerUrl, password, deviceId, scenario, level, ttsRate };
  }

  get canListen() {
    return BrowserRecognizer.supported;
  }

  // タップ操作の中で呼ぶ（iOS の読み上げの制限）。マイクの許可は最初の startListening で求められる。
  async init() {
    this.#tts.unlock();
  }

  onLevel() {} // ブラウザの音声認識は入力レベルを返さない
  onInterim(callback) {
    this.#recognizer.onInterim = callback;
  }
  onAutoEnd(callback) {
    this.#recognizer.onAutoEnd = callback;
  }

  async startListening({ lang = "en" } = {}) {
    this.stopSpeaking();
    this.#starting = this.#recognizer.start(lang);
    try {
      await this.#starting;
      this.#listening = true;
    } finally {
      this.#starting = null;
    }
  }

  async stopListening() {
    if (this.#starting) {
      try {
        await this.#starting; // 始まる前に止められた場合は、始まるのを待ってから止める
      } catch {
        return { kind: "text", text: "" };
      }
    }
    if (!this.#listening) return { kind: "text", text: "" };
    this.#listening = false;
    return { kind: "text", text: await this.#recognizer.stop() };
  }

  cancelListening() {
    this.#listening = false;
    this.#recognizer.abort();
  }

  async #post(path, extra) {
    const { workerUrl, password, deviceId, scenario, level } = this.#opts;
    const data = await post(
      path,
      { password, deviceId, scenarioId: scenario.id, level, ...extra },
      { baseUrl: workerUrl, timeoutMs: 40000 }
    );
    this.costJpy += Number(data.costJpy) || 0;
    return data;
  }

  async start() {
    return toTurnResult(await this.#post("/sc/turn", { action: "start", history: [] }));
  }

  async reply(utterance, { history }) {
    return toTurnResult(await this.#post("/sc/turn", { action: "reply", history, userText: utterance.text }));
  }

  async ja2en(utterance, { history }) {
    return toJa2EnResult(await this.#post("/sc/turn", { action: "ja2en", history, userText: utterance.text }));
  }

  speak(text, { slow = false } = {}) {
    return this.#tts.speak(text, { rate: slow ? 0.75 : this.#opts.ttsRate });
  }

  stopSpeaking() {
    this.#tts.stop();
  }

  async summary(history) {
    return toSummaryResult(await this.#post("/sc/summary", { history }));
  }

  dispose() {
    this.cancelListening();
    this.stopSpeaking();
  }
}
