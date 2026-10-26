// パスワードの SHA-256 ハッシュを作り、PASSWORDS の一覧（passwords.local.json）に追加・更新する。
// パスワードそのものはどこにも保存しない。passwords.local.json はハッシュだけの一覧で、Git には入れない。
//   node tools/hash-password.js --id adv-tomoaki --app advanced
//       → パスワードを2回入力する（画面には表示されない）
//   node tools/hash-password.js --id sc-2026-2nen --app student-claude --generate
//       → 配布用のパスワードを自動で作って表示する（紛らわしい文字を使わない）
//   node tools/hash-password.js --remove sc-2025-2nen
//       → 一覧から削除する
// 追加の上限は --daily-minutes 40 / --turns-per-device 80 / --turns-total 3000 で指定できる。
// 一覧を Worker に登録するには: npm run passwords
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APPS } from "../config.js";
import { openHiddenInput } from "./hidden-input.js";

const LIST_FILE = fileURLToPath(new URL("../passwords.local.json", import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generatePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

// パスワードを画面に出さずに2回入力してもらう（一致しなければ3回までやり直す）。
// ターミナル以外から渡された場合は、確認なしで1行だけ読む。
async function askPassword() {
  const input = openHiddenInput();
  try {
    if (!input.interactive) return (await input.ask()).trim();
    for (let tries = 0; tries < 3; tries++) {
      const first = (await input.ask("パスワードを入力してください（画面には表示されません）: ")).trim();
      if (first.length < 8) {
        console.error("パスワードは8文字以上にしてください。");
        continue;
      }
      const again = (await input.ask("確認のため、もう一度入力してください: ")).trim();
      if (again === first) return first;
      console.error("2回の入力が一致しません。もう一度入力してください。");
    }
    return null;
  } finally {
    input.close();
  }
}

function loadList() {
  if (!existsSync(LIST_FILE)) return [];
  const list = JSON.parse(readFileSync(LIST_FILE, "utf8"));
  return Array.isArray(list) ? list : [];
}

function saveList(list) {
  writeFileSync(LIST_FILE, JSON.stringify(list) + "\n");
  console.log(`passwords.local.json を更新しました（${list.length}件: ${list.map((e) => e.id).join(", ")}）。`);
  console.log("Worker に登録するには: npm run passwords");
}

const removeId = arg("remove");
if (removeId) {
  saveList(loadList().filter((e) => e.id !== removeId));
  process.exit(0);
}

const id = arg("id");
const app = arg("app");
if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !APPS.includes(app)) {
  console.error("使い方: node tools/hash-password.js --id <英数字のID> --app <" + APPS.join(" | ") + "> [--generate]");
  process.exit(1);
}

let password;
if (process.argv.includes("--generate")) {
  password = generatePassword();
  console.log(`作成したパスワード: ${password}`);
} else {
  password = await askPassword();
  if (password === null) {
    console.error("登録できませんでした。もう一度コマンドを実行してください。");
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error("パスワードは8文字以上にしてください。");
  process.exit(1);
}

const entry = { id, hash: createHash("sha256").update(password, "utf8").digest("hex"), app };
const num = (name) => (arg(name) === undefined ? undefined : Number(arg(name)));
if (num("daily-minutes") !== undefined) entry.dailyMinutes = num("daily-minutes");
if (num("turns-per-device") !== undefined) entry.dailyTurnsPerDevice = num("turns-per-device");
if (num("turns-total") !== undefined) entry.dailyTurnsTotal = num("turns-total");

saveList([...loadList().filter((e) => e.id !== id), entry]);
