// パスワードなどを、画面に表示せずにターミナルから1行ずつ読み取る。
// Windows では、読み取りの途中で raw モードを切り替えると、Node（libuv）が読み取りを止めるために
// Enter を1回分送り込み、次の入力がいきなり空で終わってしまう。そのため raw モードは最初に1回だけ入れ、
// 終わるときは読み取りを止めてから（pause → setRawMode(false) の順で）戻す。
import { createInterface } from "node:readline";

function lineQueue() {
  const lines = [];
  let waiting = null;
  let ended = false;
  const deliver = () => {
    if (!waiting || (!lines.length && !ended)) return;
    const resolve = waiting;
    waiting = null;
    resolve(lines.length ? lines.shift() : "");
  };
  return {
    push(line) {
      lines.push(line);
      deliver();
    },
    end() {
      ended = true;
      deliver();
    },
    next() {
      return new Promise((resolve) => {
        waiting = resolve;
        deliver();
      });
    },
  };
}

// ターミナル以外（パイプなど）から渡された場合は、画面に何も出さずにそのまま1行ずつ読む。
function openPiped(input) {
  const queue = lineQueue();
  const rl = createInterface({ input });
  rl.on("line", (line) => queue.push(line));
  rl.on("close", () => queue.end());
  return { interactive: false, ask: () => queue.next(), close: () => rl.close() };
}

export function openHiddenInput(input = process.stdin, output = process.stdout) {
  if (!input.isTTY) return openPiped(input);
  const queue = lineQueue();
  let text = "";
  const close = () => {
    input.off("data", onData);
    input.pause();
    input.setRawMode(false);
  };
  const onData = (chunk) => {
    if (chunk.startsWith("\u001b")) return; // 矢印キーなどは無視する
    for (const c of chunk) {
      if (c === "\u0003") {
        close();
        output.write("\n");
        process.exit(1);
      }
      if (c === "\r" || c === "\n") {
        if (!text) continue; // 何も入力していない Enter（\r\n の \n など）は無視する
        output.write("\n");
        queue.push(text);
        text = "";
      } else if (c === "\u007f" || c === "\b") text = text.slice(0, -1);
      else text += c;
    }
  };
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.on("data", onData);
  input.resume();
  return {
    interactive: true,
    ask(prompt) {
      output.write(prompt);
      return queue.next();
    },
    close,
  };
}
