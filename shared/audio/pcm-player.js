// PCM の再生キュー。届いた音声のかたまりを途切れないように順番に再生する。
// clear() でキューをすぐに空にする（ユーザーが話し始めて AI の発話が割り込まれたとき）。
// イベント: "playing"（再生が始まった）、"idle"（キューが空になった）

export class PcmPlayer extends EventTarget {
  constructor(ctx, { startDelay = 0.08 } = {}) {
    super();
    this.ctx = ctx;
    this.startDelay = startDelay; // 発話の始めに少し待って、通信の揺らぎで途切れないようにする（秒）
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.sources = new Set();
    this.nextTime = 0;
    this.lastEnd = 0;
  }

  get isPlaying() {
    return this.sources.size > 0;
  }

  // pcm: Int16Array（モノラル）。戻り値は再生の開始・終了時刻（AudioContext の時刻）。
  enqueue(pcm, sampleRate) {
    if (!pcm.length) return null;
    const buffer = this.ctx.createBuffer(1, pcm.length, sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + this.startDelay;
    const start = this.nextTime;
    src.start(start);
    this.nextTime = start + buffer.duration;
    this.lastEnd = this.nextTime;

    const wasIdle = this.sources.size === 0;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.dispatchEvent(new Event("idle"));
    };
    if (wasIdle) this.dispatchEvent(new Event("playing"));
    return { start, end: this.nextTime };
  }

  clear() {
    const had = this.sources.size > 0;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
    this.lastEnd = this.ctx.currentTime;
    if (had) this.dispatchEvent(new Event("idle"));
  }

  close() {
    this.clear();
    try {
      this.out.disconnect();
    } catch {}
  }
}
