// Worker との通信。エラーは日本語のメッセージにして投げる。
import { WORKER_URL } from "../shared/worker-url.js";

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function post(path, body, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(WORKER_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(
      0,
      e?.name === "AbortError"
        ? "通信がタイムアウトしました。もう一度試してください。"
        : "通信できませんでした。ネットワークを確認してください。"
    );
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data?.ok) throw new ApiError(res.status, data?.error || `エラーが起きました（${res.status}）。`, data);
  return data;
}
