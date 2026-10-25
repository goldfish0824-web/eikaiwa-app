// Gemini Live API（WebSocket）のアダプター。
// Worker が発行した一時トークンで直接接続する。モデル・システムプロンプト・声・文字起こしの設定は
// トークン側で固定されているので、ここでは model とセッション再開（sessionResumption）だけを送る。
// 仕様: https://ai.google.dev/api/live
import { arrayBufferToBase64, base64ToArrayBuffer } from "../../shared/audio/base64.js";
import { RealtimeAdapter } from "./realtime-adapter.js";

const ALLOWED_WS_PREFIX = "wss://generativelanguage.googleapis.com/";
const CONNECT_TIMEOUT_MS = 15000;
const MAX_BUFFERED_BYTES = 512 * 1024;

export class GeminiLiveAdapter extends RealtimeAdapter {
  inputSampleRate = 16000;

  get canResume() {
    return Boolean(this.resumeHandle);
  }

  async connect({ token, model, wsUrl }) {
    if (typeof wsUrl !== "string" || !wsUrl.startsWith(ALLOWED_WS_PREFIX)) throw new Error("接続先が正しくありません。");
    this.token = token;
    this.model = model;
    this.wsUrl = wsUrl;
    this.resumeHandle = null;
    await this.#open(null);
  }

  async reconnect() {
    if (!this.resumeHandle) throw new Error("再接続できません。");
    await this.#open(this.resumeHandle);
  }

  #open(handle) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}?access_token=${encodeURIComponent(this.token)}`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.ready = false;
      this.closingByUs = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("接続がタイムアウトしました。"));
        try {
          ws.close();
        } catch {}
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: { model: this.model, sessionResumption: handle ? { handle } : {} } }));
      };
      ws.onmessage = (ev) => {
        const msg = parseMessage(ev.data);
        if (!msg || ws !== this.ws) return;
        if ("setupComplete" in msg) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.ready = true;
            resolve();
          }
          return;
        }
        this.#handle(msg);
      };
      ws.onerror = () => {}; // 続いて onclose が来るので、そちらで扱う
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (ws !== this.ws) return;
        const wasReady = this.ready;
        this.ready = false;
        if (!settled) {
          settled = true;
          const reason = ev.reason ? `（${ev.reason}）` : "";
          reject(new Error(`接続できませんでした${reason}`));
          return;
        }
        if (wasReady) this.emit("close", { expected: this.closingByUs, code: ev.code, reason: ev.reason });
      };
    });
  }

  #handle(msg) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) this.emit("interrupted");
      for (const part of sc.modelTurn?.parts ?? []) {
        const d = part.inlineData;
        if (!d?.data || part.thought || !String(d.mimeType ?? "").startsWith("audio/")) continue;
        let buf = base64ToArrayBuffer(d.data);
        if (buf.byteLength % 2) buf = buf.slice(0, buf.byteLength - 1);
        const rate = Number(/rate=(\d+)/.exec(d.mimeType)?.[1]) || 24000;
        this.emit("audio", { pcm: new Int16Array(buf), sampleRate: rate });
      }
      if (sc.inputTranscription?.text) this.emit("transcript", { speaker: "user", text: sc.inputTranscription.text });
      if (sc.outputTranscription?.text) this.emit("transcript", { speaker: "ai", text: sc.outputTranscription.text });
      if (sc.turnComplete) this.emit("turncomplete");
    }
    if (msg.usageMetadata) this.emit("usage", msg.usageMetadata);
    const upd = msg.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) this.resumeHandle = upd.newHandle;
    if (msg.goAway) this.emit("goaway", { timeLeft: msg.goAway.timeLeft });
  }

  #send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.ready) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  sendAudio(pcm) {
    // 回線が詰まっているときは古い音を溜めず捨てる（遅延が増え続けないように）
    if (this.ws?.bufferedAmount > MAX_BUFFERED_BYTES) return;
    this.#send({
      realtimeInput: {
        audio: { data: arrayBufferToBase64(pcm.buffer), mimeType: `audio/pcm;rate=${this.inputSampleRate}` },
      },
    });
  }

  sendControl(text) {
    return this.#send({ realtimeInput: { text } });
  }

  endAudioStream() {
    this.#send({ realtimeInput: { audioStreamEnd: true } });
  }

  close() {
    this.closingByUs = true;
    try {
      this.ws?.close(1000);
    } catch {}
  }
}

function parseMessage(data) {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
