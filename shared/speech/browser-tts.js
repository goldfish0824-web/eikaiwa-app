// ブラウザの読み上げ（speechSynthesis）。学生版 Claude版の AI の声に使う。
// 将来ほかの音声合成に差し替えるときは、同じ形（unlock / speak / stop）のクラスを作る。
const synth = globalThis.speechSynthesis ?? null;

// 端末で使える英語の声から、自然に聞こえるものを優先して選ぶ（上ほど優先）。
const PREFERRED = [
  /Microsoft (Ava|Emma|Jenny|Aria|Andrew|Brian|Guy).*Natural/i, // Edge・Windows の自然な声
  /\b(Ava|Zoe|Allison|Samantha|Evan|Nathan|Susan|Tom)\b.*\((Premium|Enhanced)\)/i, // iPhone・Mac の高品質な声
  /\((Premium|Enhanced)\)/i,
  /^Google US English$/i,
  /\bSamantha\b/i,
  /\bAva\b/i,
  /^Google UK English Female$/i,
  /\b(Daniel|Karen|Moira|Serena)\b/i,
  /Microsoft (Zira|Aria|Jenny|Mark|David)/i,
];

export function pickEnglishVoice(voices) {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
  for (const re of PREFERRED) {
    const hit = en.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return en.find((v) => /^en[-_]US$/i.test(v.lang)) ?? en[0] ?? null;
}

export class BrowserTts {
  static get supported() {
    return Boolean(synth);
  }

  unlocked = false;
  #voice = null;
  #current = null; // { utterance, done }

  constructor() {
    if (!synth) return;
    const load = () => (this.#voice = pickEnglishVoice(synth.getVoices()));
    load();
    synth.addEventListener?.("voiceschanged", load);
  }

  get voiceName() {
    return this.#voice?.name ?? "";
  }

  // iOS では最初の読み上げをタップ操作の中で行う必要がある。タップの処理の最初に呼ぶ。
  unlock() {
    if (!synth || this.unlocked) return;
    this.unlocked = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
  }

  // 読み上げが終わったら resolve する（止めた場合も resolve）。
  speak(text, { rate = 0.95 } = {}) {
    if (!synth || !text) return Promise.resolve();
    this.stop();
    if (!this.#voice) this.#voice = pickEnglishVoice(synth.getVoices());
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.#voice?.lang ?? "en-US";
      if (this.#voice) u.voice = this.#voice;
      u.rate = rate;
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        if (this.#current?.utterance === u) this.#current = null;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      // 終わりの合図が来ない不具合に備えて、文の長さから計算した時間で打ち切る。
      timer = setTimeout(done, 4000 + (text.length * 110) / rate);
      this.#current = { utterance: u, done };
      synth.speak(u);
    });
  }

  stop() {
    if (!synth) return;
    const cur = this.#current;
    this.#current = null;
    synth.cancel();
    cur?.done();
  }
}
