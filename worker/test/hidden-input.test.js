// パスワードの入力（tools/hidden-input.js）。
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { openHiddenInput } from "../tools/hidden-input.js";

function fakeTerminal() {
  const calls = [];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = (on) => calls.push(`raw:${on}`);
  const pause = input.pause.bind(input);
  input.pause = () => {
    calls.push("pause");
    return pause();
  };
  let shown = "";
  const output = new Writable({
    write(chunk, _enc, done) {
      shown += chunk;
      done();
    },
  });
  return { input, output, calls, shown: () => shown };
}

test("ターミナル：2回続けて読める。間にまぎれ込んだ空の Enter は無視し、入力した文字は表示しない", async () => {
  const t = fakeTerminal();
  const reader = openHiddenInput(t.input, t.output);
  const first = reader.ask("1: ");
  t.input.write("abcd1234\r");
  t.input.write("\r\n");
  assert.equal(await first, "abcd1234");
  const second = reader.ask("2: ");
  t.input.write("ab");
  t.input.write("x\u007fcd1234\r");
  assert.equal(await second, "abcd1234");
  reader.close();
  assert.ok(!t.shown().includes("abcd"), "入力した文字が画面に出ている");
  // raw モードは最初に1回だけ入れ、最後は読み取りを止めてから戻す
  assert.deepEqual(t.calls, ["raw:true", "pause", "raw:false"]);
});

test("パイプ：1行ずつ読み、入力がなくなったら空文字を返す", async () => {
  const input = new PassThrough();
  const reader = openHiddenInput(input, new PassThrough());
  input.end("secret-1\n");
  assert.equal(reader.interactive, false);
  assert.equal(await reader.ask(), "secret-1");
  assert.equal(await reader.ask(), "");
  reader.close();
});
