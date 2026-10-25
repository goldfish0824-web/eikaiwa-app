// POST /auth
import assert from "node:assert/strict";
import { test } from "node:test";
import { PW, call, makeEnv } from "./helpers.js";

test("正しいパスワードとアプリ種別ならログインできる", async () => {
  const env = await makeEnv();
  const { res, data } = await call(env, "/auth", { password: PW.advanced, app: "advanced" });
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.passwordId, "t-advanced");
  assert.equal(data.app, "advanced");
  assert.equal(data.limits.dailyMinutes, 40);
  assert.equal(data.limits.remainingMinutes, 40);
  assert.deepEqual(data.limits.sessionMinutesOptions, [5, 10]);
  assert.ok(!("hash" in data));
});

test("学生版のパスワードでも、自分のアプリにはログインできる", async () => {
  const env = await makeEnv();
  for (const app of ["student-claude", "student-gemini"]) {
    const { res, data } = await call(env, "/auth", { password: PW[app], app });
    assert.equal(res.status, 200, app);
    assert.equal(data.limits.dailyTurnsPerDevice, 80);
  }
});

test("別のアプリのパスワードでは 403（高校生用パスワードで Gemini版・上級者版に入れない）", async () => {
  const env = await makeEnv();
  for (const app of ["student-gemini", "advanced"]) {
    const { res, data } = await call(env, "/auth", { password: PW["student-claude"], app });
    assert.equal(res.status, 403, app);
    assert.equal(data.error, "このアプリでは使えないパスワードです。");
  }
  assert.equal((await call(env, "/auth", { password: PW.advanced, app: "student-claude" })).res.status, 403);
});

test("アプリ種別がない・不明なときは 400", async () => {
  const env = await makeEnv();
  assert.equal((await call(env, "/auth", { password: PW.advanced })).res.status, 400);
  assert.equal((await call(env, "/auth", { password: PW.advanced, app: "other" })).res.status, 400);
});
