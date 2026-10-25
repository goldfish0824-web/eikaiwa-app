// POST /adv/token（Live API の一時トークン発行）と利用上限。
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../config.js";
import { DATA } from "../src/generated/embedded.js";
import { jstDate } from "../src/usage.js";
import { GEMINI_KEY, PW, call, makeEnv, mockFetch, passwordEntry, tokenResponse } from "./helpers.js";

const body = (extra = {}) => ({ password: PW.advanced, deviceId: "device-0000-test", minutes: 5, ...extra });
const promptOf = (c) => c.body.bidiGenerateContentSetup.systemInstruction.parts[0].text;

test("一時トークンを作って返す（キーは Worker の中だけ・接続条件を固定）", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  const before = Date.now();
  const { res, data, text } = await call(env, "/adv/token", body());
  assert.equal(res.status, 200);

  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
  assert.equal(c.init.headers["x-goog-api-key"], GEMINI_KEY);
  assert.equal(c.body.uses, 1);
  const exp = Date.parse(c.body.expireTime) - before;
  assert.ok(exp >= 7 * 60_000 - 1000 && exp <= 7 * 60_000 + 5000, "有効期限は会話時間＋2分");
  const start = Date.parse(c.body.newSessionExpireTime) - before;
  assert.ok(start >= 59_000 && start <= 65_000, "新しいセッションの開始期限は1分");

  const setup = c.body.bidiGenerateContentSetup;
  assert.equal(setup.model, "models/gemini-3.8-live");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.ok(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName);
  assert.equal(setup.generationConfig.thinkingConfig, undefined, "通常版に thinkingLevel を付けない");
  assert.deepEqual(setup.inputAudioTranscription, {});
  assert.deepEqual(setup.outputAudioTranscription, {});
  for (const f of ["model", "systemInstruction.parts", "generationConfig.speechConfig", "inputAudioTranscription"]) {
    assert.ok(c.body.fieldMask.split(",").includes(f), `fieldMask に ${f}`);
  }
  assert.ok(!c.body.fieldMask.includes("sessionResumption"), "セッション再開はブラウザ側で指定できる");

  const prompt = promptOf(c);
  assert.match(prompt, /English conversation partner/);
  assert.match(prompt, /Mode: Casual small talk/);
  assert.match(prompt, /lasts about 5 minutes/);
  assert.match(prompt, /\[START\]/);
  assert.match(prompt, /natural conversational pace/); // speed: normal
  assert.match(prompt, /relaxed, casual register/); // register: casual
  assert.doesNotMatch(prompt, /\{\{|\}\}/);
  assert.doesNotMatch(prompt, /Warm-up/);

  assert.equal(data.token, "auth_tokens/test-ephemeral-token");
  assert.equal(data.model, "models/gemini-3.8-live");
  assert.ok(data.wsUrl.startsWith("wss://generativelanguage.googleapis.com/"));
  assert.equal(data.session.mode, "smalltalk");
  assert.ok(data.session.persona.name);
  assert.ok(data.session.topic);
  assert.equal(data.usage.usedMinutes, 5);
  assert.equal(data.usage.remainingMinutes, 35);
  assert.ok(data.pricing.usdPerMTokens.inputAudio > 0);
  assert.ok(!text.includes(GEMINI_KEY), "API キーを返さない");
  assert.ok(!text.includes("English conversation partner"), "システムプロンプトを返さない");
});

test("じっくり考える版を選ぶと、モデルと thinkingLevel が変わる", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  const { res } = await call(env, "/adv/token", body({ thinking: true }));
  assert.equal(res.status, 200);
  const setup = calls[0].body.bidiGenerateContentSetup;
  assert.equal(setup.model, "models/gemini-3.8-live-extended-thinking");
  assert.equal(setup.generationConfig.thinkingConfig.thinkingLevel, "low");
});

test("設定をプロンプトに反映し、不正な値は初期値にする", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  await call(
    env,
    "/adv/token",
    body({ settings: { speed: "fast", register: "idiomatic", interruptions: "on", correction: "recast" } })
  );
  const p1 = promptOf(calls[0]);
  assert.match(p1, /Speak quickly and casually/);
  assert.match(p1, /idioms, phrasal verbs/);
  assert.match(p1, /jump in before the learner finishes/);
  assert.match(p1, /recast/);

  await call(env, "/adv/token", body({ settings: { speed: "warp", register: "<script>" } }));
  const p2 = promptOf(calls[1]);
  assert.match(p2, /natural conversational pace/);
  assert.match(p2, /relaxed, casual register/);
  assert.match(p2, /Wait until the learner has finished speaking/);
  assert.match(p2, /Do not correct the learner's mistakes/);
});

test("復習フレーズは WARMUP として最大3件・改行を除いて入れる", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  await call(
    env,
    "/adv/token",
    body({ warmupPhrases: ["I'm planning to ...", "That's easier\nsaid than done.", "c", "d", 42] })
  );
  const p = promptOf(calls[0]);
  assert.match(p, /Warm-up:/);
  assert.match(p, /- I'm planning to \.\.\.\n- That's easier said than done\.\n- c\n/);
  assert.doesNotMatch(p, /- d\n/);
});

test("モードごとにプロンプトを組み立てられる（ロールプレイの「予想外の展開」は画面に返さない）", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv({ entries: [await passwordEntry("a", PW.advanced, "advanced", { dailyMinutes: 999 })] });
  for (const mode of ["smalltalk", "discussion", "roleplay", "quickfire"]) {
    const { res, data } = await call(env, "/adv/token", body({ mode }));
    assert.equal(res.status, 200, mode);
    const p = promptOf(calls.at(-1));
    assert.doesNotMatch(p, /\{\{/, mode);
    if (mode === "roleplay") {
      assert.ok(data.session.scene.titleJa);
      assert.equal(data.session.scene.complication, undefined);
      assert.ok(p.includes(DATA.adv_modes.modes[2].scenes.find((s) => s.id === data.session.scene.id).complication));
    }
    if (mode === "discussion") assert.ok(p.includes(data.session.topic));
  }
});

test("直近に使った話題は避ける", async (t) => {
  mockFetch(t);
  const env = await makeEnv({ entries: [await passwordEntry("a", PW.advanced, "advanced", { dailyMinutes: 999 })] });
  const topics = DATA.adv_modes.modes[0].topics;
  const recent = topics.map((_, i) => i).filter((i) => i !== 3);
  for (let n = 0; n < 5; n++) {
    const { data } = await call(env, "/adv/token", body({ recent: { topics: recent } }));
    assert.equal(data.session.topicIndex, 3);
  }
});

test("会話時間・モードが不正なら 400", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  for (const extra of [{ minutes: 7 }, { minutes: "10x" }, { minutes: 60 }, { mode: "freetalk" }]) {
    assert.equal((await call(env, "/adv/token", body(extra))).res.status, 400, JSON.stringify(extra));
  }
  assert.equal(calls.length, 0);
});

test("パスワードごとの1日の上限（40分）を超えると 429 と日本語メッセージ", async (t) => {
  mockFetch(t);
  const env = await makeEnv();
  for (let i = 0; i < 4; i++) assert.equal((await call(env, "/adv/token", body({ minutes: 10 }))).res.status, 200);
  const { res, data } = await call(env, "/adv/token", body({ minutes: 5 }));
  assert.equal(res.status, 429);
  assert.equal(data.error, "今日の利用上限に達しました。また明日使ってください。");

  const key = `${jstDate(Date.now())}:t-advanced`;
  assert.equal(env.USAGE.map.get(key), "40");
  assert.equal(env.USAGE.puts.find((p) => p.key === key).opts.expirationTtl, CONFIG.usageTtlSeconds);
});

test("残りが足りないときは、残りの分数を伝える", async (t) => {
  mockFetch(t);
  const env = await makeEnv();
  for (let i = 0; i < 7; i++) await call(env, "/adv/token", body({ minutes: 5 }));
  const { res, data } = await call(env, "/adv/token", body({ minutes: 10 }));
  assert.equal(res.status, 429);
  assert.equal(data.error, "今日の残りは5分です。短い会話を選んでください。");
  assert.equal(data.remainingMinutes, 5);
  assert.equal((await call(env, "/adv/token", body({ minutes: 5 }))).res.status, 200);
});

test("全体の上限（60分）で止まる", async (t) => {
  mockFetch(t);
  const env = await makeEnv({
    entries: [await passwordEntry("a1", "pw-a1", "advanced"), await passwordEntry("a2", "pw-a2", "advanced")],
  });
  for (let i = 0; i < 4; i++) await call(env, "/adv/token", body({ password: "pw-a1", minutes: 10 }));
  for (let i = 0; i < 2; i++) await call(env, "/adv/token", body({ password: "pw-a2", minutes: 10 }));
  const { res, data } = await call(env, "/adv/token", body({ password: "pw-a2", minutes: 5 }));
  assert.equal(res.status, 429);
  assert.equal(data.error, "今日の利用上限に達しました。また明日使ってください。");
});

test("Gemini 側のエラーは詳細を隠して 502、利用回数は加算しない", async (t) => {
  mockFetch(t, () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }));
  const env = await makeEnv();
  const { res, data, text } = await call(env, "/adv/token", body());
  assert.equal(res.status, 502);
  assert.equal(data.error, "AIの応答に失敗しました。もう一度試してください。");
  assert.ok(!text.includes("API key"));
  assert.equal(env.USAGE.puts.length, 0);
});

test("Gemini の応答に name がない・通信できないときも 502", async (t) => {
  let mode = "noname";
  mockFetch(t, () => {
    if (mode === "noname") return new Response("{}", { status: 200 });
    throw new TypeError("network");
  });
  const env = await makeEnv();
  assert.equal((await call(env, "/adv/token", body())).res.status, 502);
  mode = "network";
  assert.equal((await call(env, "/adv/token", body())).res.status, 502);
  assert.equal(env.USAGE.puts.length, 0);
});

test("GEMINI_API_KEY が未設定なら 500（設定が終わっていない旨）", async (t) => {
  const calls = mockFetch(t, () => tokenResponse());
  const env = await makeEnv({ GEMINI_API_KEY: "" });
  const { res, data } = await call(env, "/adv/token", body());
  assert.equal(res.status, 500);
  assert.match(data.error, /設定が終わっていません/);
  assert.equal(calls.length, 0);
});
