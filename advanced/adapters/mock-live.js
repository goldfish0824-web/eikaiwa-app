// 開発用の偽アダプター（?mock=1 で開いたときだけ読み込む）。
// API を使わずに、画面の流れ・タイマー・字幕・文字起こし・費用表示を確かめるためのもの。
// AI の声の代わりに小さな音を鳴らす。マイクに話しかけると、話し終わったところで AI が返事をする。
import { RealtimeAdapter } from "./realtime-adapter.js";

const LINES = [
  "Hey, good to see you! So, how was your weekend? Do anything fun?",
  "Oh, nice. That sounds like a pretty relaxing way to spend it. What made you pick that?",
  "Ha, I totally get that. I've been meaning to try something like that myself.",
  "Interesting. So would you say that's become a regular thing for you now?",
];
const RATE = 24000;
const CHUNK_SEC = 0.1;

export class MockLiveAdapter extends RealtimeAdapter {
  async connect() {
    await wait(400);
    this.open = true;
    this.line = 0;
    this.lastText = "";
    this.voiceChunks = 0;
    this.silentChunks = 0;
    this.userTalking = false;
    this.turnNo = 0;
  }

  sendAudio(pcm) {
    if (!this.open) return;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
    const rms = Math.sqrt(sum / pcm.length);
    if (rms > 0.03) {
      this.voiceChunks++;
      this.silentChunks = 0;
      if (this.voiceChunks >= 3 && !this.userTalking) {
        this.userTalking = true;
        if (this.speaking) this.#interrupt();
        this.emit("transcript", { speaker: "user", text: "(mock) I" });
      }
    } else {
      this.silentChunks++;
      if (this.userTalking && this.silentChunks >= 8) {
        this.userTalking = false;
        this.voiceChunks = 0;
        this.emit("transcript", { speaker: "user", text: " said something into the microphone." });
        this.#speak(LINES[1 + (this.line++ % (LINES.length - 1))]);
      }
      if (!this.userTalking) this.voiceChunks = 0;
    }
  }

  sendControl(text) {
    if (!this.open) return false;
    if (text === "[START]") this.#speak(LINES[0]);
    else if (text === "[REPEAT]") this.#speak(this.lastText || LINES[0]);
    else if (text === "[WRAP_UP]") this.#speak("Anyway, I should probably get going. It was really great chatting with you!");
    else if (text === "[NEXT]") this.#speak("Okay, next one! What's something you've changed your mind about recently?");
    return true;
  }

  async reconnect() {
    await wait(300);
  }

  close() {
    this.open = false;
    clearTimeout(this.timer);
    this.speaking = false;
    this.emit("close", { expected: true, code: 1000, reason: "" });
  }

  #interrupt() {
    clearTimeout(this.timer);
    this.speaking = false;
    this.emit("interrupted");
    this.emit("turncomplete");
  }

  // 1語あたり約0.3秒の音を、実際の再生より速いペースで少しずつ送る（本物の API と同じ流れ）。
  #speak(text) {
    clearTimeout(this.timer);
    this.lastText = text;
    this.speaking = true;
    const words = text.split(" ");
    const turn = ++this.turnNo;
    let i = 0;
    const step = () => {
      if (!this.open || !this.speaking || turn !== this.turnNo) return;
      if (i < words.length) {
        this.emit("transcript", { speaker: "ai", text: (i ? " " : "") + words[i] });
        for (let k = 0; k < 3; k++) this.emit("audio", { pcm: tone(i * 3 + k), sampleRate: RATE });
        i++;
        this.timer = setTimeout(step, 60);
      } else {
        this.speaking = false;
        const audioTokens = Math.round(words.length * 0.3 * 25);
        this.emit("usage", {
          promptTokenCount: 600 + turn * 400,
          responseTokenCount: audioTokens,
          totalTokenCount: 600 + turn * 400 + audioTokens,
          promptTokensDetails: [
            { modality: "TEXT", tokenCount: 600 },
            { modality: "AUDIO", tokenCount: turn * 400 },
          ],
          responseTokensDetails: [{ modality: "AUDIO", tokenCount: audioTokens }],
        });
        this.emit("turncomplete");
      }
    };
    this.timer = setTimeout(step, 300);
  }
}

function tone(n) {
  const len = Math.round(RATE * CHUNK_SEC);
  const pcm = new Int16Array(len);
  const freq = 170 + (n % 3) * 15;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.sin((Math.PI * i) / len);
    pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * env * 2500);
  }
  return pcm;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
