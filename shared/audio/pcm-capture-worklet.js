// AudioWorklet：マイクの音を 16kHz・16bit・モノラルの PCM に変換し、一定間隔でメインスレッドへ送る。
// iOS Safari では AudioContext が 48kHz（または 44.1kHz）になることが多いので、ここで間引く。
// 間引くときは区間の平均を取り、折り返し雑音を減らす。

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate = 16000, chunkMs = 100 } = options.processorOptions || {};
    this.step = sampleRate / targetRate; // 入力何サンプルで出力1サンプルか（小数もあり得る）
    this.chunkSamples = Math.round((targetRate * chunkMs) / 1000);
    this.buf = new Int16Array(this.chunkSamples);
    this.len = 0;
    this.pos = 0;
    this.acc = 0;
    this.accN = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.accN++;
      this.pos += 1;
      if (this.pos < this.step) continue;
      this.pos -= this.step;
      let s = this.acc / this.accN;
      this.acc = 0;
      this.accN = 0;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.buf[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      if (this.len === this.chunkSamples) {
        const rms = Math.sqrt(this.sumSq / this.len);
        this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(this.chunkSamples);
        this.len = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
