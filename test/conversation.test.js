import assert from "node:assert/strict";
import { test } from "node:test";
import { Conversation, MAX_EXCHANGES } from "../shared/student-core/conversation.js";

const turn = (replyEn, extra = {}) => ({ replyEn, replyJa: "訳", hints: ["Yes."], usedKeyPhrases: [], shouldEnd: false, maxTurns: 6, ...extra });

test("履歴は AI から始まり交互に並ぶ。Worker には role と text だけを送る", () => {
  const c = new Conversation();
  c.start(turn("Hi! What should I call you?"));
  c.add("Please call me Ken.", turn("Nice to meet you, Ken!", { usedKeyPhrases: [0] }));
  assert.deepEqual(c.history, [
    { role: "ai", text: "Hi! What should I call you?" },
    { role: "student", text: "Please call me Ken." },
    { role: "ai", text: "Nice to meet you, Ken!" },
  ]);
  assert.equal(c.exchanges, 1);
  assert.equal(c.maxTurns, 6);
  assert.equal(c.lastAi.ja, "訳");
  assert.deepEqual(c.usedKeyPhrases, [0]);
});

test("やり直す：直前の自分の発言と AI の返答を取り消す", () => {
  const c = new Conversation();
  c.start(turn("Hi!"));
  assert.equal(c.canUndo, false);
  assert.equal(c.undo(), null);
  c.add("Hello.", turn("How are you?", { usedKeyPhrases: [1] }));
  c.add("I'm into music.", turn("Bye!", { shouldEnd: true, usedKeyPhrases: [2] }));
  assert.equal(c.ended, true);
  assert.deepEqual(c.usedKeyPhrases, [1, 2]);
  assert.equal(c.undo(), "I'm into music.");
  assert.equal(c.ended, false);
  assert.equal(c.lastAi.text, "How are you?");
  assert.deepEqual(c.usedKeyPhrases, [1]);
  assert.equal(c.entries.length, 3);
});

test("往復数が上限に達したら終わり", () => {
  const c = new Conversation();
  c.start(turn("Hi!"));
  for (let i = 0; i < MAX_EXCHANGES; i++) {
    assert.equal(c.ended, false);
    c.add(`line ${i}`, turn(`reply ${i}`));
  }
  assert.equal(c.ended, true);
  assert.equal(c.history.length, 1 + 2 * MAX_EXCHANGES);
});

test("MAX_EXCHANGES は Worker の設定と同じ", async () => {
  const { CONFIG } = await import("../worker/config.js");
  assert.equal(MAX_EXCHANGES, CONFIG.scMaxExchanges);
});
