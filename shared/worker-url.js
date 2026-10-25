// Worker の URL。Worker を配置したら、表示された URL に書き換える（worker/README.md）。
// localhost で開いたときは、ローカルの Worker（npx wrangler dev）を使う。
const PRODUCTION_URL = "https://eikaiwa-worker.REPLACE_ME.workers.dev";

const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

export const WORKER_URL = isLocal ? "http://localhost:8787" : PRODUCTION_URL;
