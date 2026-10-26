// Worker の URL（2026-10-26 配置）。Worker の名前やアカウントを変えたら書き換える（worker/README.md）。
// localhost で開いたときは、ローカルの Worker（npm run dev）を使う。
const PRODUCTION_URL = "https://eikaiwa-worker.goldfish0824.workers.dev";

const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

export const WORKER_URL = isLocal ? "http://localhost:8787" : PRODUCTION_URL;
