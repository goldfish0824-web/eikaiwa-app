// 開発用の偽のエンジン（?mock=1 のときだけ読み込む）。AI・マイク・読み上げを使わずに画面の流れを確かめる。
// 「話す」を押すと決まった英文が少しずつ聞き取れたことにする。キーボードで「support」「redirect」と送ると、その安全フラグを返す。
import { speakablePhrase } from "../student-core/phrase-match.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const REPLIES = [
  "That sounds great! Can you tell me more about it?",
  "Oh, really? Why do you like it?",
  "I see. That's interesting! What else do you enjoy?",
  "Nice! I like that too.",
];

export class MockEngine {
  capabilities = { confirmBeforeSend: true, pronunciation: false, interimText: true };
  costJpy = 0;
  spoken = []; // 読み上げた文（確認用）

  #scenario;
  #level;
  #interim = null;
  #autoEnd = null;
  #listen = null; // { text, timer }
  #sayIndex = 0;
  #speakTimer = null;
  #speakDone = null;

  constructor({ scenario, level }) {
    this.#scenario = scenario;
    this.#level = level;
  }

  get canListen() {
    return true;
  }

  async init() {}
  onLevel() {}
  onInterim(cb) {
    this.#interim = cb;
  }
  onAutoEnd(cb) {
    this.#autoEnd = cb;
  }

  async startListening({ lang = "en" } = {}) {
    this.stopSpeaking();
    this.cancelListening();
    const phrases = this.#scenario.key_phrases.map((p) => speakablePhrase(p.en.replace(/\.{2,}|…/g, "music")));
    const target = lang === "ja" ? "サッカーが好きだと言いたいです" : phrases[this.#sayIndex++ % phrases.length];
    const words = lang === "ja" ? [...target] : target.split(" ");
    const state = { text: "", timer: null };
    let i = 0;
    state.timer = setInterval(() => {
      if (i < words.length) {
        state.text = lang === "ja" ? state.text + words[i++] : words.slice(0, ++i).join(" ");
        this.#interim?.(state.text);
      } else {
        clearInterval(state.timer);
        state.timer = setTimeout(() => this.#autoEnd?.(), 600);
      }
    }, 180);
    this.#listen = state;
  }

  async stopListening() {
    const st = this.#listen;
    this.cancelListening();
    return { kind: "text", text: st?.text ?? "" };
  }

  cancelListening() {
    if (this.#listen) {
      clearInterval(this.#listen.timer);
      clearTimeout(this.#listen.timer);
    }
    this.#listen = null;
  }

  #turn(replyEn, extra = {}) {
    this.costJpy += 0.03;
    return {
      userTranscript: "",
      replyEn,
      replyJa: `（和訳）${replyEn}`,
      hints: ["Yes!", "I like music.", "I like music because it makes me happy."],
      usedKeyPhrases: [],
      goalReached: false,
      shouldEnd: false,
      safetyFlag: "none",
      supportMessageJa: "",
      pronunciationNoteJa: "",
      exchange: 0,
      maxTurns: this.#scenario.max_turns[this.#level],
      fallback: false,
      ...extra,
    };
  }

  async start() {
    await wait(500);
    return this.#turn(this.#scenario.opening[this.#level]);
  }

  async reply(utterance, { history }) {
    await wait(700);
    const text = utterance.text.toLowerCase();
    if (text.includes("support")) {
      return this.#turn("", { safetyFlag: "support", supportMessageJa: "（テスト）話してくれてありがとう。信頼できる大人に相談してみてね。", shouldEnd: true });
    }
    if (text.includes("error")) throw Object.assign(new Error("（テスト）AIの応答に失敗しました。もう一度試してください。"), { status: 502 });
    const exchange = history.filter((e) => e.role === "student").length + 1;
    const maxTurns = this.#scenario.max_turns[this.#level];
    const used = this.#scenario.key_phrases
      .map((p, i) => (text.includes(speakablePhrase(p.en).toLowerCase().split(" ").slice(0, 2).join(" ")) ? i : -1))
      .filter((i) => i >= 0);
    if (text.includes("redirect")) return this.#turn("Let's get back to our talk. What do you like to do?", { safetyFlag: "redirect", exchange, usedKeyPhrases: used });
    if (exchange >= maxTurns) return this.#turn("It was really nice talking with you. See you next time!", { shouldEnd: true, goalReached: true, exchange, usedKeyPhrases: used, hints: [] });
    return this.#turn(REPLIES[exchange % REPLIES.length], { exchange, usedKeyPhrases: used });
  }

  async ja2en(utterance) {
    await wait(600);
    this.costJpy += 0.02;
    if (utterance.text.includes("support")) return { en: "", enSimple: "", tipJa: "", safetyFlag: "support", supportMessageJa: "（テスト）相談先を表示します。" };
    return { en: "I want to say that I like soccer.", enSimple: "I like soccer.", tipJa: "「〜が好き」は I like 〜 で言えます。", safetyFlag: "none", supportMessageJa: "" };
  }

  speak(text) {
    this.stopSpeaking();
    this.spoken.push(text);
    return new Promise((resolve) => {
      this.#speakDone = resolve;
      this.#speakTimer = setTimeout(resolve, Math.min(4000, 300 + text.length * 30));
    });
  }

  stopSpeaking() {
    clearTimeout(this.#speakTimer);
    this.#speakDone?.();
    this.#speakDone = null;
  }

  async summary(history) {
    await wait(800);
    this.costJpy += 0.05;
    const said = history.find((e) => e.role === "student")?.text ?? "";
    return {
      canDo: ["相手の質問に、自分のことを英語で答えられました。", "最後まで会話を続けられました。"],
      tryNext: { youSaid: said, better: `${said.replace(/[.!?]$/, "")}, because it's fun.`, whyJa: "理由を足すと、会話が広がります。" },
      keyPhrasesUsed: [true, false, false],
      privacyNoteJa: "",
      encouragementJa: "よくがんばりました！次は今日のフレーズをもう1つ使ってみよう。",
      pronunciationTips: [],
      fallback: false,
    };
  }

  dispose() {
    this.cancelListening();
    this.stopSpeaking();
  }
}
