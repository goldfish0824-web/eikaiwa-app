// パスワードの SHA-256 ハッシュと、PASSWORDS に入れる1項目（JSON）を作る。
//   node tools/hash-password.js --id adv-tomoaki --app advanced
//       → パスワードを入力すると、PASSWORDS 用の JSON が表示される
//   node tools/hash-password.js --id sc-2026-2nen --app student-claude --generate
//       → 配布用のパスワードを自動で作る（紛らわしい文字を使わない）
// 追加の上限は --daily-minutes 40 / --turns-per-device 80 / --turns-total 3000 で指定できる。
import { createHash, randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { APPS } from "../config.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generatePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("");
  return `${group()}-${group()}-${group()}`;
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = (await rl.question("パスワードを入力してください: ")).trim();
  rl.close();
}
if (!password) {
  console.error("パスワードが空です。");
  process.exit(1);
}

const entry = { id, hash: createHash("sha256").update(password, "utf8").digest("hex"), app };
const num = (name) => (arg(name) === undefined ? undefined : Number(arg(name)));
if (num("daily-minutes") !== undefined) entry.dailyMinutes = num("daily-minutes");
if (num("turns-per-device") !== undefined) entry.dailyTurnsPerDevice = num("turns-per-device");
if (num("turns-total") !== undefined) entry.dailyTurnsTotal = num("turns-total");

console.log("\nPASSWORDS の配列に、次の1行を追加してください:");
console.log(JSON.stringify(entry));
