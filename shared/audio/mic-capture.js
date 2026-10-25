// マイク入力：getUserMedia → AudioWorklet → 16kHz・16bit・モノラル PCM（約100msごと）。
// AudioContext は呼び出し側が「開始」ボタンのタップ時に作って渡す（iOS の制限のため）。
// 上級者版のほか、学生版 Gemini版の録音でも使う。

export class MicCapture {
  constructor(ctx, { targetRate = 16000, chunkMs = 100 } = {}) {
    this.ctx = ctx;
    this.targetRate = targetRate;
    this.chunkMs = chunkMs;
    this.onChunk = null; // (pcm: Int16Array, rms: number) => void
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error("このブラウザではマイクを使えません。");
      err.name = "NotSupportedError";
      throw err;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    await this.ctx.audioWorklet.addModule(new URL("./pcm-capture-worklet.js", import.meta.url));
    // 準備の途中で stop() されたら、マイクを開いたままにしない
    if (this.stopped) return this.stop();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetRate: this.targetRate, chunkMs: this.chunkMs },
    });
    this.node.port.onmessage = (e) => this.onChunk?.(new Int16Array(e.data.pcm), e.data.rms);
    // 出力先につながっていないと処理が止まるブラウザがあるので、音量0でつなぐ。
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  stop() {
    this.stopped = true;
    this.onChunk = null;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {}
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// マイクのエラーを日本語の説明にする。
export function micErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "マイクの使用が許可されていません。ブラウザの設定でこのサイトのマイクを許可してください。";
    case "NotFoundError":
      return "マイクが見つかりません。";
    case "NotReadableError":
      return "マイクを使えません。ほかのアプリがマイクを使っていないか確認してください。";
    case "NotSupportedError":
      return "このブラウザではマイクを使えません。";
    default:
      return "マイクの準備に失敗しました。";
  }
}
