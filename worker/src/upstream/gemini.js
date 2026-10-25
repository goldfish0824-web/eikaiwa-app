// Gemini API の呼び出し。
// 18歳未満が使う学生版 Claude版（student-claude）からは、どの関数も絶対に呼べないようにする。
// ルーティングでも拒否しているが、ここでも二重に確認する。
import { CONFIG } from "../../config.js";
import { HttpError, MSG } from "../http.js";

const GEMINI_APPS = new Set(["advanced", "student-gemini"]);

export function assertGeminiAllowed(auth) {
  if (!auth || !GEMINI_APPS.has(auth.app)) throw new HttpError(403, MSG.forbidden);
}

function apiKey(env) {
  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY が設定されていません");
    throw new HttpError(500, MSG.serverConfig);
  }
  return env.GEMINI_API_KEY;
}

// 公式 SDK と同じ作り方のフィールドマスク（2階層目まで）。
// ここに挙げたフィールドはトークン側の値で上書きされ、ブラウザ側の setup では変えられない。
export function liveFieldMask(setup) {
  const fields = [];
  for (const [key, value] of Object.entries(setup)) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
      for (const sub of Object.keys(value)) fields.push(`${key}.${sub}`);
    } else {
      fields.push(key);
    }
  }
  return fields.join(",");
}

// Live API 用の一時トークンを作る（上級者版のみ）。
export async function createLiveToken(env, auth, { setup, expireTime, newSessionExpireTime }) {
  assertGeminiAllowed(auth);
  if (auth.app !== "advanced") throw new HttpError(403, MSG.forbidden);

  const body = {
    uses: 1,
    expireTime,
    newSessionExpireTime,
    bidiGenerateContentSetup: setup,
  };
  if (CONFIG.liveTokenLock === "fields") body.fieldMask = liveFieldMask(setup);

  let res;
  try {
    res = await fetch(`${CONFIG.geminiApiBase}/${CONFIG.geminiApiVersion}/auth_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey(env) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("auth_tokens: 通信エラー");
    throw new HttpError(502, MSG.upstream);
  }
  if (!res.ok) {
    // トークン作成の要求には会話の中身が含まれないので、原因調査のためにエラーの要旨だけ残す。
    let detail = "";
    try {
      detail = String((await res.json())?.error?.message ?? "").slice(0, 300);
    } catch {}
    console.error("auth_tokens: 失敗", res.status, detail);
    throw new HttpError(502, MSG.upstream);
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data.name !== "string" || !data.name) {
    console.error("auth_tokens: 応答に name がありません");
    throw new HttpError(502, MSG.upstream);
  }
  return data;
}
