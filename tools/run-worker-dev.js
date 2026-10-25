// worker/ でローカルの Worker（npx wrangler dev --port 8787）を起動する。
// 先に worker/.dev.vars.example を worker/.dev.vars にコピーしておくこと。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../worker/", import.meta.url));
const child = spawn("npx wrangler dev --port 8787", { cwd, shell: true, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
