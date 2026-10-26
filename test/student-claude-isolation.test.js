// 学生版 Claude版（高校生向け）の配置物に、Gemini を使うコードや 18歳以上向けのページへのリンクが入っていないことを確かめる。
// student-claude/index.html から読み込まれるファイルを（動的 import も含めて）すべてたどる。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  /generativelanguage/i, // Gemini API のホスト
  /gemini[-_]?(engine|live)/i, // Gemini のエンジン・アダプター
  /Gemini(Engine|Live|Adapter)/,
  /["'`]\/sg\//, // 学生版 Gemini版のエンドポイント
  /["'`]\/adv\//, // 上級者版のエンドポイント
  /student-gemini/i, // 18歳以上向けのページ
  /advanced\//i, // 上級者版（18歳以上向け）
];

async function collect(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, "utf8");
    const refs = [];
    if (file.endsWith(".html")) {
      for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(m[1]);
    } else if (file.endsWith(".js")) {
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) refs.push(m[1]);
      for (const m of text.matchAll(/["'](\.\.?\/[^"']+\.json)["']/g)) refs.push(m[1]);
    }
    for (const ref of refs) {
      if (/^(https?:|tel:|mailto:|#)/.test(ref)) continue;
      queue.push(resolve(dirname(file), ref));
    }
  }
  return [...seen];
}

test("高校生版から読み込むファイルに Gemini のコードや18歳以上向けのページが含まれない", async () => {
  const files = await collect(join(ROOT, "student-claude", "index.html"));
  const names = files.map((f) => relative(ROOT, f).replaceAll("\\", "/"));

  // たどれていることの確認（エンジン・共通画面・偽のエンジン・シナリオ）
  for (const must of [
    "student-claude/app.js",
    "shared/engines/claude-engine.js",
    "shared/engines/mock-engine.js",
    "shared/student-core/app.js",
    "shared/student-core/roleplay.js",
    "shared/speech/browser-recognizer.js",
    "data/scenarios_hs.json",
  ]) {
    assert.ok(names.includes(must), `${must} がたどれていない`);
  }

  for (const [i, file] of files.entries()) {
    assert.ok(!/gemini|advanced\//i.test(names[i]), `${names[i]} を読み込んでいる`);
    const text = await readFile(file, "utf8");
    for (const re of FORBIDDEN) assert.ok(!re.test(text), `${names[i]} に ${re} が含まれる`);
  }
});

test("Worker の URL の設定にも Gemini の接続先が含まれない", async () => {
  const text = await readFile(join(ROOT, "shared", "worker-url.js"), "utf8");
  assert.ok(!/generativelanguage|googleapis/i.test(text));
});
