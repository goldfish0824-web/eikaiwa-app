import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ClaudeEngine, toJa2EnResult, toSummaryResult, toTurnResult } from "../shared/engines/claude-engine.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const scenario = { id: "hs01" };
const turnJson = {
  reply_en: "Nice to meet you!",
  reply_ja: "はじめまして！",
  hints: ["Me too.", "Nice to meet you too."],
  used_key_phrases: [0],
  goal_reached: false,
  should_end: false,
  safety_flag: "none",
  support_message_ja: "",
};

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const data = responses.shift();
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("Worker の JSON を画面用の形（キャメルケース）に変える", () => {
  const t = toTurnResult({ turn: turnJson, exchange: 2, maxTurns: 6 });
  assert.deepEqual(t, {
    userTranscript: "",
    replyEn: "Nice to meet you!",
    replyJa: "はじめまして！",
    hints: ["Me too.", "Nice to meet you too."],
    usedKeyPhrases: [0],
    goalReached: false,
    shouldEnd: false,
    safetyFlag: "none",
    supportMessageJa: "",
    pronunciationNoteJa: "",
    exchange: 2,
    maxTurns: 6,
    fallback: false,
  });
  assert.deepEqual(toJa2EnResult({ ja2en: { en: "I like soccer.", en_simple: "I like soccer.", tip_ja: "ヒント", safety_flag: "none", support_message_ja: "" } }), {
    en: "I like soccer.",
    enSimple: "I like soccer.",
    tipJa: "ヒント",
    safetyFlag: "none",
    supportMessageJa: "",
  });
  const s = toSummaryResult({
    summary: {
      can_do: ["a", "b"],
      try_next: { you_said: "I like soccer.", better: "I love soccer.", why_ja: "理由" },
      key_phrases_used: [true, false, false],
      privacy_note_ja: "",
      encouragement_ja: "がんばったね",
    },
  });
  assert.deepEqual(s.tryNext, { youSaid: "I like soccer.", better: "I love soccer.", whyJa: "理由" });
  assert.deepEqual(s.keyPhrasesUsed, [true, false, false]);
  assert.equal(toSummaryResult({ summary: { ...s, try_next: null, can_do: [], key_phrases_used: [] } }).tryNext, null);
});

test("エンジンは Worker の /sc/turn・/sc/summary だけに送り、費用の目安を足していく", async () => {
  const calls = mockFetch([
    { ok: true, action: "start", exchange: 1, maxTurns: 6, turn: turnJson, costJpy: 0.05 },
    { ok: true, action: "reply", exchange: 1, maxTurns: 6, turn: turnJson, costJpy: 0.06 },
    { ok: true, action: "ja2en", exchange: 2, maxTurns: 6, ja2en: { en: "x", en_simple: "x", tip_ja: "", safety_flag: "none", support_message_ja: "" }, costJpy: 0.02 },
    { ok: true, summary: { can_do: [], try_next: null, key_phrases_used: [false, false, false], privacy_note_ja: "", encouragement_ja: "" }, costJpy: 0.1 },
  ]);
  const engine = new ClaudeEngine({ workerUrl: "https://worker.test", password: "pw", deviceId: "dev-12345678", scenario, level: "easy" });
  const history = [{ role: "ai", text: "Hi!" }];
  await engine.start();
  await engine.reply({ kind: "text", text: "Hello." }, { history });
  await engine.ja2en({ kind: "text", text: "こんにちは" }, { history });
  await engine.summary([...history, { role: "student", text: "Hello." }]);

  assert.deepEqual(
    calls.map((c) => c.url),
    ["https://worker.test/sc/turn", "https://worker.test/sc/turn", "https://worker.test/sc/turn", "https://worker.test/sc/summary"]
  );
  assert.deepEqual(calls[0].body, { password: "pw", deviceId: "dev-12345678", scenarioId: "hs01", level: "easy", action: "start", history: [] });
  assert.deepEqual(calls[1].body.history, history);
  assert.equal(calls[1].body.userText, "Hello.");
  assert.equal(calls[1].body.action, "reply");
  assert.equal(calls[2].body.action, "ja2en");
  assert.equal(calls[3].body.history.length, 2);
  assert.ok(Math.abs(engine.costJpy - 0.23) < 1e-9);
  assert.equal(engine.capabilities.confirmBeforeSend, true);
  assert.equal(engine.capabilities.pronunciation, false);
});

test("Worker のエラーは日本語のメッセージのまま投げる", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "今日の利用上限に達しました。また明日使ってください。" }), { status: 429 });
  const engine = new ClaudeEngine({ workerUrl: "https://worker.test", password: "pw", deviceId: "dev-12345678", scenario, level: "easy" });
  await assert.rejects(engine.start(), (err) => err.status === 429 && err.message.includes("上限"));
});
