// prompts/*.md と data/*.json を Worker に埋め込むためのファイル（src/generated/embedded.js）を作る。
// プロンプトやシナリオを変更したら、必ずこのスクリプトを実行してから Worker を配置する。
//   node tools/sync-embedded.js          … 生成する
//   node tools/sync-embedded.js --check  … 生成済みのファイルが最新か確かめる（テストでも確認している）
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WORKER_DIR, "..");
export const OUTPUT = join(WORKER_DIR, "src", "generated", "embedded.js");

// Markdown の「## 見出し」ごとに、コードブロックの中身を取り出す。
//   見出し直下のコードブロック               → blocks（書かれた順）
//   「- key:」「- key（…）：」の下のブロック → options.key
// 見出しの「（…）」以降は名前に含めない（例: 「WARMUP（…）」→「WARMUP」）。
export function parsePromptMarkdown(md) {
  const sections = {};
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let heading = null;
  let optionKey = null;
  let fence = null; // { indent, lines }

  for (const line of lines) {
    if (fence) {
      if (line.trim() === "```") {
        const text = fence.lines.map((l) => l.slice(Math.min(fence.indent, leadingSpaces(l)))).join("\n");
        addBlock(sections, heading, optionKey, text);
        fence = null;
        optionKey = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const fenceOpen = /^(\s*)```/.exec(line);
    if (fenceOpen) {
      fence = { indent: fenceOpen[1].length, lines: [] };
      continue;
    }
    const h = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (h) {
      heading = h[1].split("（")[0].trim();
      optionKey = null;
      continue;
    }
    const opt = /^- ([A-Za-z_]+)[^:：]*[:：]\s*$/.exec(line);
    if (opt) optionKey = opt[1];
  }
  return sections;
}

function leadingSpaces(s) {
  return s.length - s.trimStart().length;
}

function addBlock(sections, heading, optionKey, text) {
  if (!heading) return;
  const sec = (sections[heading] ??= { blocks: [], options: {} });
  if (optionKey) sec.options[optionKey] = text;
  else sec.blocks.push(text);
}

export function buildEmbedded() {
  const prompts = {};
  for (const f of readdirSync(join(ROOT, "prompts")).filter((f) => f.endsWith(".md")).sort()) {
    prompts[f.replace(/\.md$/, "")] = parsePromptMarkdown(readFileSync(join(ROOT, "prompts", f), "utf8"));
  }
  const data = {};
  for (const f of readdirSync(join(ROOT, "data")).filter((f) => f.endsWith(".json")).sort()) {
    data[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
  }
  return (
    "// 自動生成ファイル。直接編集しないこと。\n" +
    "// prompts/*.md と data/*.json を変更したら `node tools/sync-embedded.js` を実行する。\n\n" +
    `export const PROMPTS = ${JSON.stringify(prompts, null, 2)};\n\n` +
    `export const DATA = ${JSON.stringify(data, null, 2)};\n`
  );
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const content = buildEmbedded();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUTPUT, "utf8");
    } catch {}
    if (current.replace(/\r\n/g, "\n") !== content) {
      console.error("src/generated/embedded.js が古くなっています。node tools/sync-embedded.js を実行してください。");
      process.exit(1);
    }
    console.log("embedded.js は最新です。");
  } else {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, content);
    console.log("src/generated/embedded.js を更新しました。");
  }
}
