// 会話ごとのトークン使用量と費用の目安（費用の実測用。spec/07）。
// Live API の usageMetadata は応答ごとに届く。1回の応答（ターン）の中で複数届いた場合は最後の値を使い、
// ターンごとの値を合計する。実際の請求額は Google Cloud の請求画面で照らし合わせて確かめる。

export class UsageMeter {
  constructor(pricing) {
    this.pricing = pricing;
    this.turns = [];
    this.pending = null;
    this.reports = 0;
  }

  add(meta) {
    this.reports++;
    this.pending = meta;
  }

  commitTurn() {
    if (this.pending) this.turns.push(this.pending);
    this.pending = null;
  }

  summary() {
    this.commitTurn();
    const t = { inputText: 0, inputAudio: 0, outputText: 0, outputAudio: 0, thoughts: 0, total: 0 };
    let unknownModality = false;
    for (const m of this.turns) {
      t.total += m.totalTokenCount ?? 0;
      t.thoughts += m.thoughtsTokenCount ?? 0;
      const input = byModality(m.promptTokensDetails);
      const output = byModality(m.responseTokensDetails);
      if (input) {
        t.inputAudio += input.AUDIO;
        t.inputText += input.other;
      } else if (m.promptTokenCount) {
        t.inputAudio += m.promptTokenCount; // 内訳がないときは高いほう（音声）で見積もる
        unknownModality = true;
      }
      if (output) {
        t.outputAudio += output.AUDIO;
        t.outputText += output.other;
      } else if (m.responseTokenCount) {
        t.outputAudio += m.responseTokenCount;
        unknownModality = true;
      }
    }
    const p = this.pricing?.usdPerMTokens ?? {};
    const usd =
      (t.inputText * (p.inputText ?? 0) +
        t.inputAudio * (p.inputAudio ?? 0) +
        (t.outputText + t.thoughts) * (p.outputText ?? 0) +
        t.outputAudio * (p.outputAudio ?? 0)) /
      1e6;
    return { turns: this.turns.length, reports: this.reports, tokens: t, usd, jpy: usd * (this.pricing?.usdJpy ?? 150), unknownModality };
  }
}

function byModality(details) {
  if (!Array.isArray(details) || !details.length) return null;
  const out = { AUDIO: 0, other: 0 };
  for (const d of details) {
    if (d.modality === "AUDIO") out.AUDIO += d.tokenCount ?? 0;
    else out.other += d.tokenCount ?? 0;
  }
  return out;
}
