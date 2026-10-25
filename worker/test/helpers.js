// テスト用の共通部品（KV のモック、リクエストの作成、fetch のモック）。
import { sha256Hex } from "../src/auth.js";
import worker from "../src/index.js";

export const ORIGIN = "https://goldfish0824-web.github.io";
export const PW = {
  advanced: "pw-advanced",
  "student-claude": "pw-student-claude",
  "student-gemini": "pw-student-gemini",
};
export const GEMINI_KEY = "test-gemini-key-SECRET";

export class MemoryKV {
  constructor() {
    this.map = new Map();
    this.puts = [];
  }
  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  async put(key, value, opts) {
    this.map.set(key, value);
    this.puts.push({ key, value, opts });
  }
}

export async function passwordEntry(id, password, app, extra = {}) {
  return { id, hash: await sha256Hex(password), app, ...extra };
}

export async function makeEnv({ entries, ...extra } = {}) {
  const list =
    entries ?? (await Promise.all(Object.entries(PW).map(([app, pw]) => passwordEntry(`t-${app}`, pw, app))));
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
    PASSWORDS: JSON.stringify(list),
    GEMINI_API_KEY: GEMINI_KEY,
    ANTHROPIC_API_KEY: "test-anthropic-key-SECRET",
    USAGE: new MemoryKV(),
    ...extra,
  };
}

export function request(path, body, { origin = ORIGIN, method = "POST", raw, headers = {} } = {}) {
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...headers },
  };
  if (method !== "GET" && method !== "OPTIONS") init.body = raw ?? JSON.stringify(body ?? {});
  return new Request(`https://worker.example${path}`, init);
}

export async function call(env, path, body, opts) {
  const res = await worker.fetch(request(path, body, opts), env);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { res, data, text };
}

// fetch をモックに差し替える。呼ばれた内容を記録して返す。
export function mockFetch(t, handler = () => tokenResponse()) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return handler(url, init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

export function tokenResponse(name = "auth_tokens/test-ephemeral-token") {
  return new Response(JSON.stringify({ name }), { status: 200, headers: { "Content-Type": "application/json" } });
}
