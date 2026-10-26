// 「今日のフレーズ」の一致判定。厳密にはせず、フレーズの単語が順番どおりに大体含まれていれば OK にする。
// フレーズの「...」（自分の言葉を入れるところ）は判定から外す。

const CONTRACTIONS = [
  [/\bcan't\b/g, "can not"],
  [/\bwon't\b/g, "will not"],
  [/n't\b/g, " not"],
  [/'m\b/g, " am"],
  [/'re\b/g, " are"],
  [/'s\b/g, " is"],
  [/'ll\b/g, " will"],
  [/'ve\b/g, " have"],
  [/'d\b/g, " would"],
];

export function words(text) {
  let s = String(text ?? "")
    .toLowerCase()
    .replace(/[‘’`]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s
    .replace(/\.{2,}|…/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

// phrase の単語のうち、said に順番どおりに現れた割合（0〜1）。
export function phraseScore(phrase, said) {
  const target = words(phrase);
  const heard = words(said);
  if (!target.length) return 0;
  let j = 0;
  let hit = 0;
  for (const w of target) {
    const k = heard.indexOf(w, j);
    if (k >= 0) {
      hit += 1;
      j = k + 1;
    }
  }
  return hit / target.length;
}

export function phraseMatches(phrase, said, threshold = 0.7) {
  return phraseScore(phrase, said) >= threshold;
}

// 読み上げ用に「...」を取り除く（「Please call me ...」→「Please call me」）。
export function speakablePhrase(phrase) {
  return String(phrase).replace(/\s*(\.{2,}|…)\s*/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
