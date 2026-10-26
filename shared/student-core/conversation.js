// 会話の状態（履歴・往復数・使えたフレーズ）。画面から切り離して、Node でもテストできるようにしている。
// 履歴は spec/05_architecture.md「8.3 学生版の会話履歴」の形で Worker に送る（AI の発言から始まり、交互に並ぶ）。

export const MAX_EXCHANGES = 20; // Worker の scMaxExchanges と同じ値にする

export class Conversation {
  // AI:   { role: "ai", text, ja, hints, usedKeyPhrases, shouldEnd }
  // 生徒: { role: "student", text }
  entries = [];
  maxTurns = 0;

  start(turn) {
    this.entries = [aiEntry(turn)];
    this.maxTurns = turn.maxTurns || this.maxTurns;
  }

  add(studentText, turn) {
    this.entries.push({ role: "student", text: studentText }, aiEntry(turn));
    this.maxTurns = turn.maxTurns || this.maxTurns;
  }

  // 直前の自分の発言と AI の返答を取り消す。取り消した自分の発言を返す。
  undo() {
    if (!this.canUndo) return null;
    this.entries.pop();
    return this.entries.pop().text;
  }

  // Worker に送る形（画面用の情報を除く）
  get history() {
    return this.entries.map(({ role, text }) => ({ role, text }));
  }

  get exchanges() {
    return this.entries.filter((e) => e.role === "student").length;
  }

  get lastAi() {
    return this.entries.findLast((e) => e.role === "ai") ?? null;
  }

  get canUndo() {
    return this.entries.length >= 3 && this.entries.at(-1).role === "ai";
  }

  get ended() {
    return Boolean(this.lastAi?.shouldEnd) || this.exchanges >= MAX_EXCHANGES;
  }

  // 会話の中で使えたキーフレーズの番号（0〜2）
  get usedKeyPhrases() {
    const used = new Set();
    for (const e of this.entries) for (const i of e.usedKeyPhrases ?? []) used.add(i);
    return [...used].sort();
  }
}

function aiEntry(turn) {
  return {
    role: "ai",
    text: turn.replyEn,
    ja: turn.replyJa ?? "",
    hints: turn.hints ?? [],
    usedKeyPhrases: turn.usedKeyPhrases ?? [],
    shouldEnd: Boolean(turn.shouldEnd),
  };
}
