// 文字起こしを「話者・開始時刻・終了時刻」つきの発話のまとまりにする（spec/05 8.1）。
// Live API の文字起こしは少しずつ、順番も前後して届くので、次の決まりでまとめる。
//   - AI の発話は、最初の音声（または文字）から、ターン完了・割り込みまで
//   - ユーザーの発話は、AI が話し始めたら閉じる。閉じた直後に遅れて届いた文字は、閉じた発話に足す
//   - ユーザーの開始時刻は、マイクの入力レベルで声を検出した時刻を使う
// 時刻はすべて会話開始からの秒数。

const LATE_USER_SEC = 1.5;

export class TranscriptBuilder {
  constructor() {
    this.segments = [];
    this.user = null;
    this.ai = null;
    this.lastUser = null;
  }

  add(speaker, text, now, voiceOnset) {
    if (speaker === "ai") {
      const seg = this.#openAi(now);
      seg.text += text;
      if (!seg.hasAudio) seg.end = Math.max(seg.end, now);
      return;
    }
    let seg = this.user;
    if (!seg && this.lastUser && now - this.lastUser.closedAt < LATE_USER_SEC) seg = this.lastUser;
    if (!seg) {
      const start = voiceOnset != null && voiceOnset <= now && now - voiceOnset < 15 ? voiceOnset : now;
      seg = { speaker: "user", text: "", start, end: now };
      this.segments.push(seg);
      this.user = seg;
    }
    seg.text += text;
    seg.end = Math.max(seg.end, now);
  }

  // AI の音声を再生キューに入れたとき（start, end は再生される時刻）
  aiAudio(start, end) {
    const seg = this.#openAi(start);
    if (!seg.hasAudio) {
      seg.start = start;
      seg.hasAudio = true;
    }
    seg.end = Math.max(seg.end, end);
  }

  interruptAi(now) {
    if (!this.ai) return;
    this.ai.end = Math.max(this.ai.start, Math.min(this.ai.end, now));
    this.ai.interrupted = true;
    this.ai = null;
  }

  endAiTurn() {
    this.ai = null;
  }

  #openAi(t) {
    if (!this.ai) {
      if (this.user) {
        this.user.closedAt = t;
        this.lastUser = this.user;
        this.user = null;
      }
      this.ai = { speaker: "ai", text: "", start: t, end: t };
      this.segments.push(this.ai);
    }
    return this.ai;
  }

  // 字幕・結果用に整えた一覧（空の発話を除き、開始時刻の順）
  list() {
    return this.segments
      .map((s) => ({
        speaker: s.speaker,
        text: s.text.replace(/\s+/g, " ").trim(),
        start: round1(s.start),
        end: round1(Math.max(s.start, s.end)),
        ...(s.interrupted ? { interrupted: true } : {}),
      }))
      .filter((s) => s.text)
      .sort((a, b) => a.start - b.start);
  }
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
