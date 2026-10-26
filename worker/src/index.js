// 英会話アプリの Worker（API キーとシステムプロンプトをサーバー側で保持する中継）。
// 処理の順番: Origin の確認 → メソッド → パス → 本文の大きさ・形式 → パスワード → アプリ種別 → 各処理
import { APPS, CONFIG } from "../config.js";
import { findPassword } from "./auth.js";
import { HttpError, MSG, allowedOrigins, corsHeaders, errorJson, withHeaders } from "./http.js";
import { handleAdvReport, handleAdvToken } from "./routes/adv.js";
import { handleAuth } from "./routes/auth.js";
import { handleScSummary, handleScTurn, notImplemented } from "./routes/student.js";

// 各エンドポイントを呼べるアプリ種別。
// 高校生用（student-claude）のパスワードでは、Gemini を使うエンドポイント（/adv/*, /sg/*）に絶対に到達させない。
export const ROUTES = {
  "/auth": { apps: APPS, handler: handleAuth },
  "/adv/token": { apps: ["advanced"], handler: handleAdvToken },
  "/adv/report": { apps: ["advanced"], handler: handleAdvReport },
  "/sc/turn": { apps: ["student-claude"], handler: handleScTurn },
  "/sc/summary": { apps: ["student-claude"], handler: handleScSummary },
  "/sg/turn": { apps: ["student-gemini"], handler: notImplemented, maxBytes: CONFIG.maxAudioBodyBytes },
  "/sg/tts": { apps: ["student-gemini"], handler: notImplemented },
  "/sg/summary": { apps: ["student-gemini"], handler: notImplemented },
};

async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, MSG.tooLarge);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, MSG.tooLarge);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, MSG.badRequest);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, MSG.badRequest);
  return body;
}

async function route(request, env, url) {
  if (request.method !== "POST") throw new HttpError(405, MSG.method);
  const r = ROUTES[url.pathname];
  if (!r) throw new HttpError(404, MSG.notFound);

  const body = await readJsonBody(request, r.maxBytes ?? CONFIG.maxBodyBytes);
  const auth = await findPassword(env, body.password);
  if (!auth) throw new HttpError(401, MSG.password);
  if (!r.apps.includes(auth.app)) throw new HttpError(403, MSG.forbidden);

  return r.handler({ env, auth, body, now: Date.now(), url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (!origin || !allowedOrigins(env).includes(origin)) return errorJson(403, MSG.origin);
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      return withHeaders(await route(request, env, url), cors);
    } catch (e) {
      if (e instanceof HttpError) return errorJson(e.status, e.message, e.extra, cors);
      // 会話の内容を出さないよう、エラーの種類だけ記録する。
      console.error("予期しないエラー:", e?.name ?? "Error", String(e?.message ?? "").slice(0, 200));
      return errorJson(500, MSG.server, {}, cors);
    }
  },
};
