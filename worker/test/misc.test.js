// 日付の切り替え・埋め込みファイルの同期・フィールドマスク。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DATA, PROMPTS } from "../src/generated/embedded.js";
import { SETTING_OPTIONS } from "../src/prompts/adv-live.js";
import { liveFieldMask } from "../src/upstream/gemini.js";
import { jstDate } from "../src/usage.js";
import { OUTPUT, buildEmbedded, parsePromptMarkdown } from "../tools/sync-embedded.js";

test("日付は日本時間0時で切り替わる", () => {
  assert.equal(jstDate(Date.parse("2026-10-25T14:59:59Z")), "2026-10-25");
  assert.equal(jstDate(Date.parse("2026-10-25T15:00:00Z")), "2026-10-26");
});

test("src/generated/embedded.js が prompts/・data/ と一致している（変更後に sync を忘れていない）", () => {
  const current = readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(current, buildEmbedded(), "node tools/sync-embedded.js を実行してください");
});

test("上級者版のプロンプトに、全モード・全設定のブロックがある", () => {
  const P = PROMPTS.adv_live_system;
  assert.ok(P.BASE.blocks[0]);
  assert.ok(P.WARMUP.blocks[0].includes("{{WARMUP_PHRASES}}"));
  for (const m of DATA.adv_modes.modes) assert.ok(P[`MODE: ${m.id}`]?.blocks[0], m.id);
  for (const [key, { values }] of Object.entries(SETTING_OPTIONS)) {
    for (const v of values) assert.ok(P[`SETTINGS: ${key}`].options[v], `${key}.${v}`);
  }
});

test("Markdown の解析：見出しの（…）を除き、字下げしたコードブロックも読める", () => {
  const md =
    "## A（説明）\n\n```\nline1\n  line2\n```\n\n## B\n\n- x:\n  ```\n  hello\n    world\n  ```\n- y（説明）：\n  ```\n  bye\n  ```\n- ja2en（数字入り）:\n  ```\n  hi\n  ```\n";
  const s = parsePromptMarkdown(md);
  assert.deepEqual(s.A.blocks, ["line1\n  line2"]);
  assert.deepEqual(s.B.options, { x: "hello\n  world", y: "bye", ja2en: "hi" });
});

test("フィールドマスクは公式 SDK と同じく2階層目まで", () => {
  const mask = liveFieldMask({
    model: "models/m",
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: {} },
    systemInstruction: { parts: [] },
    inputAudioTranscription: {},
  });
  assert.equal(
    mask,
    "model,generationConfig.responseModalities,generationConfig.speechConfig,systemInstruction.parts,inputAudioTranscription"
  );
});
