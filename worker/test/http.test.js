// Origin・メソッド・本文・パスワードの確認と CORS。
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../config.js";
import { ORIGIN, PW, call, makeEnv, passwordEntry } from "./helpers.js";

test("Origin がない・許可外の Origin は 403（CORS ヘッダーも付けない）", async () => {
  const env = await makeEnv();
  for (const origin of [null, "https://evil.example", "https://goldfish0824-web.github.io.evil.example"]) {
    const { res, data } = await call(env, "/auth", { password: PW.advanced, app: "advanced" }, { origin });
    assert.equal(res.status, 403);
    assert.equal(data.error, "許可されていない接続元です。");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("許可した Origin の OPTIONS（プリフライト）は 204 と CORS ヘッダー", async () => {
  const env = await makeEnv();
  const { res } = await call(env, "/adv/token", null, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("エラーの応答にも CORS ヘッダーが付く（ブラウザで日本語メッセージを読めるように）", async () => {
  const env = await makeEnv();
  const { res, data } = await call(env, "/auth", { password: "wrong", app: "advanced" });
  assert.equal(res.status, 401);
  assert.equal(data.error, "パスワードが正しくありません。");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("GET は 405、知らないパスは 404、壊れた JSON は 400、大きすぎる本文は 413", async () => {
  const env = await makeEnv();
  assert.equal((await call(env, "/auth", null, { method: "GET" })).res.status, 405);
  assert.equal((await call(env, "/nope", { password: PW.advanced })).res.status, 404);
  assert.equal((await call(env, "/auth", null, { raw: "{not json" })).res.status, 400);
  assert.equal((await call(env, "/auth", null, { raw: "[1,2]" })).res.status, 400);
  const big = JSON.stringify({ password: PW.advanced, app: "advanced", pad: "x".repeat(CONFIG.maxBodyBytes) });
  assert.equal((await call(env, "/auth", null, { raw: big })).res.status, 413);
});

test("パスワードが空・長すぎる・PASSWORDS が壊れているときは 401", async () => {
  const env = await makeEnv();
  assert.equal((await call(env, "/auth", { app: "advanced" })).res.status, 401);
  assert.equal((await call(env, "/auth", { password: "", app: "advanced" })).res.status, 401);
  assert.equal((await call(env, "/auth", { password: "x".repeat(200), app: "advanced" })).res.status, 401);
  const broken = await makeEnv({ PASSWORDS: "{broken" });
  assert.equal((await call(broken, "/auth", { password: PW.advanced, app: "advanced" })).res.status, 401);
});

test("PASSWORDS の不正な項目（アプリ種別が不明など）は無視される", async () => {
  const env = await makeEnv({
    entries: [
      await passwordEntry("bad-app", "pw1", "student-unknown"),
      { id: "bad-hash", hash: "1234", app: "advanced" },
      await passwordEntry("good", "pw2", "advanced"),
    ],
  });
  assert.equal((await call(env, "/auth", { password: "pw1", app: "student-unknown" })).res.status, 401);
  assert.equal((await call(env, "/auth", { password: "pw2", app: "advanced" })).res.status, 200);
});
