// パスワードの確認。PASSWORDS（Secret）には SHA-256 のハッシュだけを置く。
//   [{ "id": "adv-tomoaki", "hash": "…", "app": "advanced", "dailyMinutes": 40 }, …]
import { APPS } from "../config.js";

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

let cache = { raw: null, entries: [] };

export function loadPasswords(env) {
  const raw = env.PASSWORDS ?? "";
  if (cache.raw === raw) return cache.entries;
  let list = [];
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    console.error("PASSWORDS が JSON として読めません");
  }
  const entries = (Array.isArray(list) ? list : []).filter((e) => {
    const ok = e && ID_RE.test(e.id) && HASH_RE.test(String(e.hash).toLowerCase()) && APPS.includes(e.app);
    if (!ok) console.error("PASSWORDS の項目が不正なので無視します:", e?.id ?? "(id なし)");
    return ok;
  });
  cache = { raw, entries: entries.map((e) => ({ ...e, hash: e.hash.toLowerCase() })) };
  return cache.entries;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 一致したパスワードの項目を返す。なければ null。
export async function findPassword(env, password) {
  if (typeof password !== "string" || password.length < 1 || password.length > 128) return null;
  const hash = await sha256Hex(password);
  let found = null;
  for (const e of loadPasswords(env)) {
    if (sameHex(e.hash, hash) && !found) found = e;
  }
  return found;
}
