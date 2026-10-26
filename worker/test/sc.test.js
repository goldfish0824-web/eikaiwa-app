// 学生版 Claude版（高校生）: /sc/turn・/sc/summary。Claude だけを呼び、Gemini には一切つながないこと。
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../config.js";
import { DATA } from "../src/generated/embedded.js";
import { buildSummarySystem, buildTurnSystem } from "../src/prompts/student-claude.js";
import { jstDate } from "../src/usage.js";
import { PW, call, claudeResponse, makeEnv, mockFetch, passwordEntry } from "./helpers.js";

const DEVICE = "device-0000-test";
const HS01 = DATA.scenarios_hs.scenarios.find((s) => s.id === "hs01");
const TURN = {
  reply_en: "Nice to meet you, Ken! What do you like to do?",
  reply_ja: "よろしくね、ケン！何をするのが好き？",
  hints: ["I like soccer.", "I'm into music.", "I'm into anime these days."],
  used_key_phrases: [0],
  goal_reached: false,
  should_end: false,
  safety_flag: "none",
  support_message_ja: "",
};
const body = (extra = {}) => ({
  password: PW["student-claude"],
  deviceId: DEVICE,
  scenarioId: "hs01",
  level: "easy",
  history: [],
  action: "start",
  ...extra,
});
const history1 = [
  { role: "ai", text: "Hi! I'm Emma. Nice to meet you! What should I call you?" },
  { role: "student", text: "Please call me Ken." },
  { role: "ai", text: "Nice to meet you, Ken! What do you like?" },
];
const headerOf = (c, name) => new Headers(c.init.headers).get(name);
const today = () => jstDate(Date.now());

test("start: Claude（Haiku 5.5）を1回呼び、キャッシュ付きのシステムプロンプトと構造化出力で返事を作る", async (t) => {
  const calls = mockFetch(t, () => claudeResponse(TURN));
  const env = await makeEnv();
  const { res, data, text } = await call(env, "/sc/turn", body());
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(headerOf(c, "authorization"), `Bearer ${env.ANTHROPIC_API_KEY}`); // SDK 1.x は API キーをこの形で送る
  assert.equal(c.body.model, "claude-haiku-5-5");
  assert.equal(c.body.output_config.effort, "low");
  assert.equal(c.body.output_config.format.type, "json_schema");
  assert.ok(c.body.output_config.format.schema.required.includes("reply_en"));
  for (const k of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(c.body[k], undefined, k);

  assert.equal(c.body.system.length, 2);
  for (const b of c.body.system) assert.deepEqual(b.cache_control, { type: "ephemeral" });
  assert.match(c.body.system[0].text, /role-play app for Japanese high school students/);
  assert.match(c.body.system[1].text, /Emma/);
  assert.match(c.body.system[1].text, new RegExp(HS01.opening.easy.replace(/[!?.]/g, "\\$&")));
  assert.deepEqual(c.body.messages, [{ role: "user", content: "action: start" }]);

  assert.equal(data.turn.reply_en, TURN.reply_en);
  assert.deepEqual(data.turn.hints, ["I like soccer.", "I'm into music.", "I'm into anime these days."]);
  assert.equal(data.exchange, 1);
  assert.equal(data.maxTurns, 6);
  assert.ok(data.costJpy > 0 && data.costJpy < 1);
  assert.ok(!text.includes(env.ANTHROPIC_API_KEY), "API キーを返さない");

  const d = today();
  assert.equal(await env.USAGE.get(`${d}:t-student-claude:${DEVICE}`), "1");
  assert.equal(await env.USAGE.get(`${d}:t-student-claude`), "1");
  assert.equal(await env.USAGE.get(`${d}:#all:student-claude`), "1");
});

test("reply: 履歴を user/assistant の交互に並べ、往復の番号は user メッセージに書く（過去の発言も同じ文字列）", async (t) => {
  const calls = mockFetch(t, () => claudeResponse(TURN));
  const env = await makeEnv();
  const { res } = await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "I'm into  soccer.\n" }));
  assert.equal(res.status, 200);
  const m = calls[0].body.messages;
  assert.deepEqual(
    m.map((x) => x.role),
    ["user", "assistant", "user", "assistant", "user"]
  );
  assert.equal(m[2].content, "action: reply\nexchange: 1 of about 6\nstudent: Please call me Ken.");
  assert.equal(m[4].content, "action: reply\nexchange: 2 of about 6\nstudent: I'm into soccer.");
  assert.doesNotMatch(calls[0].body.system[1].text, /exchange \d/, "システムプロンプトに往復の番号を入れない");
});

test("往復数の目安に達したら、会話を締めるよう伝える", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ ...TURN, should_end: true }));
  const env = await makeEnv();
  const history = [{ role: "ai", text: "Hi!" }];
  for (let i = 0; i < 5; i++) history.push({ role: "student", text: `line ${i}` }, { role: "ai", text: `ok ${i}` });
  const { data } = await call(env, "/sc/turn", body({ action: "reply", history, userText: "Bye!" }));
  const last = calls[0].body.messages.at(-1).content;
  assert.match(last, /exchange: 6 of about 6/);
  assert.match(last, /This is the last exchange/);
  assert.equal(data.turn.should_end, true);
});

test("ja2en: 日本語→英語。専用のスキーマを使い、生徒の日本語を最後の user メッセージにする", async (t) => {
  const calls = mockFetch(t, () =>
    claudeResponse({ en: "I'm into soccer.", en_simple: "I like soccer.", tip_ja: "be into は「はまっている」", safety_flag: "none", support_message_ja: "" })
  );
  const env = await makeEnv();
  const { res, data } = await call(env, "/sc/turn", body({ action: "ja2en", history: history1, userText: "サッカーにはまってる" }));
  assert.equal(res.status, 200);
  assert.ok(calls[0].body.output_config.format.schema.required.includes("en_simple"));
  assert.equal(calls[0].body.messages.at(-1).content, "action: ja2en\nstudent (in Japanese): サッカーにはまってる");
  assert.equal(data.ja2en.en, "I'm into soccer.");
  assert.equal(data.turn, undefined);
});

test("形が崩れた応答は1回だけ再試行し、それでもだめなら定型文（数えるのは1回）", async (t) => {
  let n = 0;
  const calls = mockFetch(t, () => claudeResponse(++n === 1 ? "not json" : { ...TURN, reply_en: "" }));
  const env = await makeEnv();
  const { res, data } = await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "Hello" }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(data.turn.reply_en, "Sorry, could you say that again?");
  assert.deepEqual(data.turn.hints, []);
  assert.equal(data.turn.fallback, true);
  assert.equal(await env.USAGE.get(`${today()}:t-student-claude:${DEVICE}`), "1");
});

test("1回目が崩れていても、2回目が正しければその応答を使う。最初の一言の定型文は opening", async (t) => {
  let n = 0;
  mockFetch(t, () => claudeResponse(++n === 1 ? "{" : TURN));
  const env = await makeEnv();
  const ok = await call(env, "/sc/turn", body());
  assert.equal(ok.data.turn.reply_en, TURN.reply_en);

  mockFetch(t, () => claudeResponse("broken"));
  const fb = await call(env, "/sc/turn", body());
  assert.equal(fb.data.turn.reply_en, HS01.opening.easy);
});

test("Claude が応答を断ったら再試行せず、定型文を redirect で返して件数を数える", async (t) => {
  const calls = mockFetch(t, () => claudeResponse("", { stopReason: "refusal" }));
  const env = await makeEnv();
  const { data } = await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "something" }));
  assert.equal(calls.length, 1);
  assert.equal(data.turn.safety_flag, "redirect");
  assert.equal(await env.USAGE.get(`${today()}:t-student-claude:#flag:redirect`), "1");
});

test("safety_flag: support は会話を終わらせ、相談のメッセージを必ず付ける。件数だけを30日残す", async (t) => {
  mockFetch(t, () => claudeResponse({ ...TURN, safety_flag: "support", should_end: false, support_message_ja: "" }));
  const env = await makeEnv();
  const { data } = await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "I feel bad" }));
  assert.equal(data.turn.should_end, true);
  assert.ok(data.turn.support_message_ja.includes("信頼できる大人"));
  const key = `${today()}:t-student-claude:#flag:support`;
  assert.equal(await env.USAGE.get(key), "1");
  const put = env.USAGE.puts.find((p) => p.key === key);
  assert.equal(put.opts.expirationTtl, CONFIG.safetyFlagTtlSeconds);
  assert.ok(!env.USAGE.puts.some((p) => p.value.includes("I feel bad")), "発言の内容を保存しない");
});

test("端末ごとの上限に達したら 429（Claude は呼ばない）", async (t) => {
  const calls = mockFetch(t, () => claudeResponse(TURN));
  const env = await makeEnv({
    entries: [await passwordEntry("sc-small", PW["student-claude"], "student-claude", { dailyTurnsPerDevice: 1 })],
  });
  assert.equal((await call(env, "/sc/turn", body())).res.status, 200);
  const { res, data } = await call(env, "/sc/turn", body());
  assert.equal(res.status, 429);
  assert.match(data.error, /今日の利用上限/);
  assert.equal(calls.length, 1);
  // 別の端末ならまだ使える
  assert.equal((await call(env, "/sc/turn", body({ deviceId: "device-1111-test" }))).res.status, 200);
});

test("入力の検証（シナリオ・レベル・端末ID・履歴の順番・往復数の上限）", async (t) => {
  const calls = mockFetch(t, () => claudeResponse(TURN));
  const env = await makeEnv();
  const bad = [
    body({ scenarioId: "nope" }),
    body({ level: "hard" }),
    body({ deviceId: "x" }),
    body({ action: "chat" }),
    body({ history: history1 }), // start なのに履歴がある
    body({ action: "reply", history: [], userText: "hi" }),
    body({ action: "reply", history: history1, userText: "   " }),
    body({ action: "reply", history: [{ role: "student", text: "hi" }], userText: "hi" }),
    body({ action: "reply", history: history1.slice(0, 2), userText: "hi" }), // 最後が生徒の発言
  ];
  for (const b of bad) assert.equal((await call(env, "/sc/turn", b)).res.status, 400, JSON.stringify(b).slice(0, 120));

  const full = [{ role: "ai", text: "Hi!" }];
  for (let i = 0; i < CONFIG.scMaxExchanges; i++) full.push({ role: "student", text: "a" }, { role: "ai", text: "b" });
  const over = await call(env, "/sc/turn", body({ action: "reply", history: full, userText: "more" }));
  assert.equal(over.res.status, 400);
  assert.match(over.data.error, /往復数の上限/);
  assert.equal(calls.length, 0);

  // 長い発言は300文字に切る
  await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "a".repeat(1000) }));
  assert.equal(calls[0].body.messages.at(-1).content.split("student: ")[1].length, CONFIG.scMaxUtteranceChars);
});

test("Claude の API エラーは詳細を隠して 502（利用回数は数えない）。キー未設定は 500", async (t) => {
  mockFetch(t, () => claudeResponse(null, { status: 400 }));
  const env = await makeEnv();
  const { res, data } = await call(env, "/sc/turn", body());
  assert.equal(res.status, 502);
  assert.equal(data.error, "AIの応答に失敗しました。もう一度試してください。");
  assert.equal(env.USAGE.puts.length, 0);

  const noKey = await makeEnv({ ANTHROPIC_API_KEY: "" });
  assert.equal((await call(noKey, "/sc/turn", body())).res.status, 500);
});

test("summary: 会話全体を [ai]/[student] の行で送り、ふりかえりを返す（発音の項目は入れない）", async (t) => {
  const calls = mockFetch(t, () =>
    claudeResponse({
      can_do: ["呼んでほしい名前を自分から伝えられました", "好きなことを話せました", "3つ目"],
      try_next: { you_said: "I like soccer.", better: "I'm into soccer these days.", why_ja: "be into で気持ちが伝わります" },
      key_phrases_used: [true, false],
      privacy_note_ja: "",
      encouragement_ja: "次はヒントを少なめに挑戦しよう！",
    })
  );
  const env = await makeEnv();
  const { res, data } = await call(env, "/sc/summary", body({ history: history1 }));
  assert.equal(res.status, 200);
  const c = calls[0].body;
  assert.equal(c.output_config.effort, "medium");
  assert.doesNotMatch(c.system, /\{\{|pronunciation/i);
  assert.match(c.system, /Japanese high school student/);
  const user = c.messages[0].content;
  assert.match(user, /\[ai\] Hi! I'm Emma\.[^\n]*\n\[student\] Please call me Ken\.\n\[ai\] /);
  assert.doesNotMatch(user, /\{\{|Pronunciation/);
  assert.equal(data.summary.can_do.length, 2);
  assert.deepEqual(data.summary.key_phrases_used, [true, false, false]);
  assert.equal(data.summary.try_next.better, "I'm into soccer these days.");
});

test("summary: 生徒の発言がなければ 400。形が崩れ続けたら定型文", async (t) => {
  const calls = mockFetch(t, () => claudeResponse("oops"));
  const env = await makeEnv();
  assert.equal((await call(env, "/sc/summary", body({ history: history1.slice(0, 1) }))).res.status, 400);
  assert.equal(calls.length, 0);
  const { data } = await call(env, "/sc/summary", body({ history: history1 }));
  assert.equal(data.summary.fallback, true);
  assert.match(data.summary.encouragement_ja, /ふりかえりを作れませんでした/);
});

test("12シナリオ×2レベルすべてで、プロンプトに埋め残しがない", () => {
  for (const s of DATA.scenarios_hs.scenarios) {
    for (const level of Object.keys(DATA.scenarios_hs.levels)) {
      const text = buildTurnSystem(s, level).map((b) => b.text).join("\n");
      assert.doesNotMatch(text, /\{\{|\}\}/, `${s.id} ${level}`);
    }
  }
  assert.doesNotMatch(buildSummarySystem(), /\{\{|\}\}/);
});

test("student-claude の通信先は Claude だけ（Gemini の URL を一度も呼ばない）", async (t) => {
  const SUMMARY = { can_do: ["a"], try_next: { you_said: "", better: "", why_ja: "" }, key_phrases_used: [], privacy_note_ja: "", encouragement_ja: "" };
  const calls = mockFetch(t, (url, init) =>
    claudeResponse(JSON.parse(init.body).output_config.format.schema.required.includes("can_do") ? SUMMARY : TURN)
  );
  const env = await makeEnv();
  await call(env, "/sc/turn", body());
  await call(env, "/sc/turn", body({ action: "reply", history: history1, userText: "Hi" }));
  await call(env, "/sc/summary", body({ history: history1 }));
  assert.equal(calls.length, 3);
  for (const c of calls) assert.ok(c.url.startsWith("https://api.anthropic.com/"), c.url);
});
