// 最重要：パスワードのアプリ種別によるエンドポイント制限。
// 高校生用（student-claude）のパスワードでは、Gemini を使うエンドポイントが必ず拒否されること。
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROUTES } from "../src/index.js";
import { assertGeminiAllowed, createLiveToken } from "../src/upstream/gemini.js";
import { PW, call, makeEnv, mockFetch } from "./helpers.js";

const GEMINI_ENDPOINTS = ["/adv/token", "/adv/report", "/sg/turn", "/sg/tts", "/sg/summary"];
const validBody = { deviceId: "device-0000-test", minutes: 5, mode: "smalltalk", scenarioId: "hs01", level: "easy" };

test("student-claude のパスワードで Gemini 系エンドポイントを呼ぶと 403（Gemini への通信も発生しない）", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  for (const path of GEMINI_ENDPOINTS) {
    const { res, data } = await call(env, path, { ...validBody, password: PW["student-claude"] });
    assert.equal(res.status, 403, path);
    assert.equal(data.ok, false);
  }
  assert.equal(calls.length, 0, "外部 API が呼ばれてはいけない");
  assert.equal(env.USAGE.puts.length, 0, "利用回数も加算しない");
});

test("student-gemini のパスワードで /sc/*・/adv/* を呼ぶと 403", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  for (const path of ["/sc/turn", "/sc/summary", "/adv/token", "/adv/report"]) {
    const { res } = await call(env, path, { ...validBody, password: PW["student-gemini"] });
    assert.equal(res.status, 403, path);
  }
  assert.equal(calls.length, 0);
});

test("advanced のパスワードで /sc/*・/sg/* を呼ぶと 403", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  for (const path of ["/sc/turn", "/sc/summary", "/sg/turn", "/sg/tts", "/sg/summary"]) {
    const { res } = await call(env, path, { ...validBody, password: PW.advanced });
    assert.equal(res.status, 403, path);
  }
  assert.equal(calls.length, 0);
});

test("すべてのアプリ種別 × すべてのエンドポイントで、許可外は 403・許可内は 403 にならない", async (t) => {
  mockFetch(t);
  for (const [app, pw] of Object.entries(PW)) {
    for (const [path, route] of Object.entries(ROUTES)) {
      const env = await makeEnv();
      const body = { ...validBody, password: pw, app };
      const { res } = await call(env, path, body);
      if (route.apps.includes(app)) assert.notEqual(res.status, 403, `${app} ${path}`);
      else assert.equal(res.status, 403, `${app} ${path}`);
    }
  }
});

test("Gemini を呼ぶ関数は student-claude を二重に拒否する", async (t) => {
  const calls = mockFetch(t);
  const env = await makeEnv();
  assert.throws(() => assertGeminiAllowed({ app: "student-claude" }), { status: 403 });
  assert.throws(() => assertGeminiAllowed(null), { status: 403 });
  assert.doesNotThrow(() => assertGeminiAllowed({ app: "student-gemini" }));
  await assert.rejects(
    createLiveToken(env, { id: "x", app: "student-claude" }, { setup: {}, expireTime: "", newSessionExpireTime: "" }),
    { status: 403 }
  );
  await assert.rejects(
    createLiveToken(env, { id: "x", app: "student-gemini" }, { setup: {}, expireTime: "", newSessionExpireTime: "" }),
    { status: 403 },
    "Live の一時トークンは上級者版だけ"
  );
  assert.equal(calls.length, 0);
});

test("Gemini 系エンドポイントは student-claude を許可リストに含まない", () => {
  for (const path of GEMINI_ENDPOINTS) assert.ok(!ROUTES[path].apps.includes("student-claude"), path);
});
