import assert from "node:assert/strict";
import { test } from "node:test";
import { phraseMatches, phraseScore, speakablePhrase, words } from "../shared/student-core/phrase-match.js";

test("単語に分ける：短縮形・記号・「...」をそろえる", () => {
  assert.deepEqual(words("I'm into ..."), ["i", "am", "into"]);
  assert.deepEqual(words("I’m into games!"), ["i", "am", "into", "games"]);
  assert.deepEqual(words("Can't you?"), ["can", "not", "you"]);
  assert.deepEqual(words("These days, I'm working hard on …"), ["these", "days", "i", "am", "working", "hard", "on"]);
});

test("フレーズの一致：自分の言葉を足しても OK", () => {
  assert.ok(phraseMatches("Please call me ...", "Please call me Ken."));
  assert.ok(phraseMatches("I'm into ...", "I am into soccer these days"));
  assert.ok(phraseMatches("I'm into ...", "i'm into anime"));
});

test("フレーズの一致：少しの聞き落としは許す", () => {
  // hard が抜けても 6/7
  assert.ok(phraseMatches("These days, I'm working hard on ...", "these days I'm working on English"));
});

test("フレーズの一致：違う文・順番が違う文は OK にしない", () => {
  assert.ok(!phraseMatches("Please call me ...", "I like music"));
  assert.ok(!phraseMatches("Please call me ...", ""));
  assert.ok(phraseScore("Could you tell me the way to ...?", "the way to tell me could you") < 0.7);
});

test("読み上げ用に「...」を取り除く", () => {
  assert.equal(speakablePhrase("Please call me ..."), "Please call me");
  assert.equal(speakablePhrase("Can I have ..., please?"), "Can I have, please?");
  assert.equal(speakablePhrase("I'm into …"), "I'm into");
});
