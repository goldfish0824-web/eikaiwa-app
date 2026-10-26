// ブラウザの音声認識（Web Speech API）。学生版 Claude版の「話す」に使う。
// 将来 OpenAI などの文字起こしに差し替えるときは、同じ形（start / stop / onInterim / onAutoEnd）のクラスを作る。
//
// iOS Safari・Android Chrome への対処:
//   - 認識のたびに新しいオブジェクトを作る（使い回すと止まらない・始まらないことがある）
//   - 結果が重複して届くことがあるので、前の結果を含む結果が来たら前のものを捨てる
//   - 終わりの合図（end）が来ないことがあるので、無音が続いたら自分で止める・停止後も一定時間で打ち切る
const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const LANGS = { en: "en-US", ja: "ja-JP" };
const SILENCE_MS = 1800; // 話し終わってからこの時間、新しい言葉がなければ終わりにする
const MAX_MS = 30000; // 1回の最長
const STOP_WAIT_MS = 1500;

export class RecognizerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "denied" | "unsupported" | "network" | "failed"
  }
}

// 結果の一覧から文を組み立てる（重複して届いた結果を除く）。テストのために外に出している。
export function joinResults(parts) {
  const out = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const prev = out.at(-1);
    if (prev !== undefined && p.toLowerCase().startsWith(prev.toLowerCase())) out[out.length - 1] = p;
    else if (prev === undefined || !prev.toLowerCase().endsWith(p.toLowerCase())) out.push(p);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export class BrowserRecognizer {
  static get supported() {
    return Boolean(SR);
  }

  onInterim = null; // (text) => void
  onAutoEnd = null; // () => void 無音などで自然に終わったとき
  #rec = null;
  #text = "";
  #ended = null; // 終わったら resolve される Promise
  #stopping = false;
  #maxTimer = null;
  #silenceTimer = null;

  start(lang = "en") {
    if (!SR) return Promise.reject(new RecognizerError("unsupported", "この端末では音声認識が使えません。"));
    this.#cleanup();
    const rec = new SR();
    rec.lang = LANGS[lang] ?? LANGS.en;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    this.#rec = rec;
    this.#text = "";
    this.#stopping = false;

    let resolveEnded;
    this.#ended = new Promise((r) => (resolveEnded = r));
    let error = null;

    return new Promise((resolve, reject) => {
      let started = false;
      rec.onstart = () => {
        started = true;
        this.#maxTimer = setTimeout(() => this.#autoEnd(), MAX_MS);
        resolve();
      };
      rec.onresult = (e) => {
        const parts = [];
        for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? "");
        this.#text = joinResults(parts);
        this.onInterim?.(this.#text);
        this.#resetSilenceTimer();
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          error = new RecognizerError("denied", "マイクが使えません。ブラウザの設定でマイクを許可するか、キーボードで入力してください。");
        } else if (e.error === "network") {
          error = new RecognizerError("network", "音声認識の通信に失敗しました。もう一度試すか、キーボードで入力してください。");
        } else {
          error = new RecognizerError("failed", "音声認識がうまく動きませんでした。もう一度試してください。");
        }
        if (!started) reject(error);
      };
      rec.onend = () => {
        if (!started) reject(error ?? new RecognizerError("failed", "音声認識を始められませんでした。"));
        resolveEnded({ text: this.#text, error });
        if (!this.#stopping && started) this.onAutoEnd?.();
      };
      try {
        rec.start();
      } catch {
        reject(new RecognizerError("failed", "音声認識を始められませんでした。もう一度試してください。"));
      }
    });
  }

  // 認識を止めて、聞き取った文を返す。
  async stop() {
    if (!this.#rec) return "";
    this.#stopping = true;
    try {
      this.#rec.stop();
    } catch {}
    const result = await Promise.race([
      this.#ended,
      new Promise((r) => setTimeout(() => r({ text: this.#text, error: null }), STOP_WAIT_MS)),
    ]);
    this.#cleanup();
    if (result.error && !result.text) throw result.error;
    return result.text;
  }

  abort() {
    this.#stopping = true;
    try {
      this.#rec?.abort();
    } catch {}
    this.#cleanup();
  }

  #resetSilenceTimer() {
    clearTimeout(this.#silenceTimer);
    this.#silenceTimer = setTimeout(() => this.#autoEnd(), SILENCE_MS);
  }

  #autoEnd() {
    if (this.#stopping || !this.#rec) return;
    this.onAutoEnd?.();
  }

  #cleanup() {
    clearTimeout(this.#maxTimer);
    clearTimeout(this.#silenceTimer);
    if (this.#rec) {
      this.#rec.onstart = this.#rec.onresult = this.#rec.onerror = this.#rec.onend = null;
    }
    this.#rec = null;
  }
}
