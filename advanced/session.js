// 1回の会話の制御：マイク → アダプター → 再生キュー、タイマー、制御メッセージ、文字起こし、使用量。
// 画面（app.js）はこのクラスのイベントだけを見る。音声 API の違いはアダプターが吸収する。
//
// イベント（detail）
//   status   { status }    preparing | connecting | listening | speaking | paused | reconnecting | finishing | ended
//   info     { ...token }  /adv/token の応答（相手・話題など）
//   tick     { remaining, elapsed }
//   level    { rms }
//   caption  { segments }
//   ended    { result }    result: { reason, durationSec, segments, usage, info } / 中止したときは { aborted: true }
//   error    { message }
import { MicCapture, micErrorMessage } from "../shared/audio/mic-capture.js";
import { PcmPlayer } from "../shared/audio/pcm-player.js";
import { TranscriptBuilder } from "./transcript.js";
import { UsageMeter } from "./usage-meter.js";

const VOICE_RMS = 0.02; // マイクの入力がこれより大きければ「話している」とみなす（字幕の開始時刻・発話時間の目安）
const CHUNK_SEC = 0.1;
const ECHO_TAIL_SEC = 0.35; // イヤホンなしモード：AI の発話が終わってからマイクを戻すまでの間
const WRAP_UP_BEFORE_SEC = 30;
const FINISH_GRACE_SEC = 8; // 時間切れのとき、AI の話の切りがつくまで待つ最長時間
const RECONNECT_MIN_REMAINING_SEC = 20;

export class ConversationSession extends EventTarget {
  constructor({ requestToken, createAdapter, echoGuard = false, allowNoMic = false }) {
    super();
    this.requestToken = requestToken;
    this.createAdapter = createAdapter;
    this.echoGuard = echoGuard;
    this.allowNoMic = allowNoMic;
    this.state = "idle";
    this.paused = false;
    this.transcript = new TranscriptBuilder();
    this.userSpeechSec = 0;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // 「開始」ボタンのタップの中で呼ぶ（iOS：AudioContext の作成・再開はユーザー操作の中で行う）。
  async start() {
    if (this.state !== "idle") return;
    this.#setState("preparing");
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const resumed = this.ctx.resume().catch(() => {});
    this.player = new PcmPlayer(this.ctx);
    this.player.addEventListener("playing", () => this.#emitStatus());
    this.player.addEventListener("idle", () => {
      this.#emitStatus();
      this.#flushControl();
      this.#maybeFinish();
    });

    this.mic = new MicCapture(this.ctx);
    try {
      await this.mic.start();
    } catch (e) {
      if (this.#aborted()) return;
      if (!this.allowNoMic) return this.#fail(micErrorMessage(e));
    }
    await resumed;
    // iOS ではマイクを開いたときに AudioContext が止まることがあるので、もう一度動かす
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    if (this.#aborted()) return;

    this.#setState("connecting");
    try {
      this.info = await this.requestToken();
    } catch (e) {
      return this.#fail(e.message);
    }
    if (this.#aborted()) return;
    this.emit("info", this.info);
    this.usage = new UsageMeter(this.info.pricing);

    this.adapter = this.createAdapter();
    this.#wireAdapter();
    try {
      await this.adapter.connect(this.info);
    } catch (e) {
      return this.#fail(`AI に接続できませんでした。${e.message ?? ""}`);
    }
    if (this.#aborted()) return;

    this.t0 = this.ctx.currentTime;
    this.endAt = this.t0 + this.info.minutes * 60;
    this.mic.onChunk = (pcm, rms) => this.#onMic(pcm, rms);
    this.#setState("active");
    this.adapter.sendControl("[START]");
    this.timer = setInterval(() => this.#tick(), 250);
    this.#tick();
  }

  // 「終了」ボタン。準備中なら中止する。
  stop() {
    if (this.state === "preparing" || this.state === "connecting") {
      this.abortRequested = true;
      this.adapter?.close();
      this.#aborted();
      return;
    }
    if (this.state === "active" || this.state === "finishing") this.#end("user");
  }

  pause() {
    if (this.state !== "active" || this.paused) return;
    this.paused = true;
    this.adapter.endAudioStream();
    this.#emitStatus();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.#emitStatus();
  }

  // 「今の発言をもう一度」
  repeat() {
    if (this.state !== "active") return;
    if (this.player.isPlaying) {
      this.player.clear();
      this.transcript.interruptAi(this.#clock());
    }
    this.aiTurnOpen = false;
    this.adapter.sendControl("[REPEAT]");
  }

  // ---- 内部 ----

  #clock() {
    return this.t0 === undefined ? 0 : this.ctx.currentTime - this.t0;
  }

  #setState(state) {
    this.state = state;
    this.#emitStatus();
  }

  #status() {
    if (this.state === "active") {
      if (this.reconnecting) return "reconnecting";
      if (this.paused) return "paused";
      return this.player?.isPlaying ? "speaking" : "listening";
    }
    return this.state;
  }

  #emitStatus() {
    this.emit("status", { status: this.#status() });
  }

  #aiAudible() {
    return this.player.isPlaying || this.ctx.currentTime < this.player.lastEnd + ECHO_TAIL_SEC;
  }

  #onMic(pcm, rms) {
    const now = this.#clock();
    this.emit("level", { rms });
    const aiAudible = this.#aiAudible();
    if (rms >= VOICE_RMS && !aiAudible && !this.paused) {
      if (!this.voiceActive) this.voiceOnset = Math.max(0, now - CHUNK_SEC);
      this.voiceActive = true;
      this.lastVoiceAt = now;
      this.userSpeechSec += CHUNK_SEC;
    } else if (this.voiceActive && now - this.lastVoiceAt > 0.5) {
      this.voiceActive = false;
    }
    if (this.state !== "active" || this.paused) return;
    if (this.echoGuard && aiAudible) return;
    this.adapter.sendAudio(pcm);
  }

  #wireAdapter() {
    const a = this.adapter;
    const on = (type, fn) => a.addEventListener(type, (e) => this.state !== "ended" && fn(e.detail));
    on("audio", ({ pcm, sampleRate }) => {
      if (this.state !== "active" && this.state !== "finishing") return;
      this.aiTurnOpen = true;
      const t = this.player.enqueue(pcm, sampleRate);
      if (t) this.transcript.aiAudio(t.start - this.t0, t.end - this.t0);
    });
    on("interrupted", () => {
      this.player.clear();
      this.transcript.interruptAi(this.#clock());
      this.aiTurnOpen = false;
      this.#emitCaption();
    });
    on("turncomplete", () => {
      this.aiTurnOpen = false;
      this.transcript.endAiTurn();
      this.usage.commitTurn();
      this.#flushControl();
      this.#maybeFinish();
    });
    on("transcript", ({ speaker, text }) => {
      this.transcript.add(speaker, text, this.#clock(), speaker === "user" ? this.voiceOnset : undefined);
      this.#emitCaption();
    });
    on("usage", (meta) => this.usage.add(meta));
    on("close", ({ expected }) => {
      if (!expected) this.#onUnexpectedClose();
    });
  }

  #emitCaption() {
    this.emit("caption", { segments: this.transcript.list() });
  }

  // 制御メッセージは、AI が話していない・ユーザーが話していないときに送る
  #queueControl(text) {
    this.pendingControl = text;
    this.#flushControl();
  }

  #flushControl() {
    if (!this.pendingControl || this.state !== "active") return;
    if (this.aiTurnOpen || this.player.isPlaying || this.voiceActive) return;
    if (this.adapter.sendControl(this.pendingControl) !== false) this.pendingControl = null;
  }

  #tick() {
    if (this.state !== "active" && this.state !== "finishing") return;
    const now = this.ctx.currentTime;
    const remaining = Math.max(0, this.endAt - now);
    this.emit("tick", { remaining, elapsed: now - this.t0 });
    if (this.state === "active") {
      if (remaining <= WRAP_UP_BEFORE_SEC && !this.wrapUpSent) {
        this.wrapUpSent = true;
        this.#queueControl("[WRAP_UP]");
      }
      this.#flushControl();
      if (remaining <= 0) this.#beginFinish("timeup");
    } else if (now >= this.finishDeadline) {
      this.#end(this.endReason);
    }
  }

  #beginFinish(reason) {
    this.endReason = reason;
    this.finishDeadline = this.ctx.currentTime + FINISH_GRACE_SEC;
    this.#setState("finishing");
    this.#maybeFinish();
  }

  #maybeFinish() {
    if (this.state === "finishing" && !this.aiTurnOpen && !this.player.isPlaying) this.#end(this.endReason);
  }

  async #onUnexpectedClose() {
    const remaining = this.endAt - this.ctx.currentTime;
    if (this.state === "finishing") return this.#end(this.endReason);
    if (
      this.state !== "active" ||
      this.reconnectTried ||
      !this.adapter.canResume ||
      remaining < RECONNECT_MIN_REMAINING_SEC
    ) {
      return this.#end("disconnected");
    }
    this.reconnectTried = true;
    this.reconnecting = true;
    this.player.clear();
    this.aiTurnOpen = false;
    this.#emitStatus();
    try {
      await this.adapter.reconnect();
      this.reconnecting = false;
      this.#emitStatus();
    } catch {
      this.reconnecting = false;
      this.#end("disconnected");
    }
  }

  #aborted() {
    if (!this.abortRequested || this.state === "ended") return this.state === "ended";
    this.#cleanup();
    this.emit("ended", { result: { aborted: true } });
    return true;
  }

  #fail(message) {
    if (this.#aborted()) return;
    this.#cleanup();
    this.emit("error", { message });
  }

  #end(reason) {
    if (this.state === "ended") return;
    const durationSec = Math.min(this.#clock(), (this.info?.minutes ?? 0) * 60);
    this.#cleanup();
    const segments = this.transcript.list();
    this.emit("ended", {
      result: {
        reason,
        durationSec,
        userSpeechSec: this.userSpeechSec,
        segments,
        usage: this.usage.summary(),
        info: this.info,
      },
    });
  }

  #cleanup() {
    clearInterval(this.timer);
    this.state = "ended";
    try {
      this.adapter?.close();
    } catch {}
    this.mic?.stop();
    this.player?.close();
    this.ctx?.close().catch(() => {});
    this.emit("status", { status: "ended" });
  }
}
