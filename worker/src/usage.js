// 利用回数のカウンター（KV: USAGE）。会話の中身は保存しない。
// キー: 「日付:パスワードID」「日付:パスワードID:端末ID」「日付:#all:アプリ種別」（日付は日本時間）
import { CONFIG } from "../config.js";

export function jstDate(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function globalKey(date, app) {
  return `${date}:#all:${app}`;
}

export async function readCount(kv, key) {
  const v = Number(await kv.get(key));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// items: [{ key, limit }]。すべての上限に収まるか確かめる。
// 収まるなら commit() で加算する（AI の呼び出しが成功してから呼ぶ）。
export async function checkLimits(kv, items, amount) {
  const current = await Promise.all(items.map((it) => readCount(kv, it.key)));
  const blockedIndex = items.findIndex((it, i) => current[i] + amount > it.limit);
  return {
    ok: blockedIndex < 0,
    current,
    blocked: blockedIndex < 0 ? null : { ...items[blockedIndex], used: current[blockedIndex] },
    commit: () =>
      Promise.all(
        items.map((it, i) =>
          kv.put(it.key, String(current[i] + amount), { expirationTtl: CONFIG.usageTtlSeconds })
        )
      ),
  };
}
