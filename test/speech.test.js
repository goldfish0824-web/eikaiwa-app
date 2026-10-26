import assert from "node:assert/strict";
import { test } from "node:test";
import { joinResults } from "../shared/speech/browser-recognizer.js";
import { pickEnglishVoice } from "../shared/speech/browser-tts.js";

test("認識結果の組み立て：重複して届いた結果を除く（iOS 対策）", () => {
  assert.equal(joinResults(["I like", "I like music"]), "I like music");
  assert.equal(joinResults(["Hello.", "Nice to meet you."]), "Hello. Nice to meet you.");
  assert.equal(joinResults(["I like music", "music"]), "I like music");
  assert.equal(joinResults(["", "  Yes  "]), "Yes");
});

test("読み上げの声：自然な英語の声を優先する", () => {
  const v = (name, lang = "en-US") => ({ name, lang });
  assert.equal(
    pickEnglishVoice([v("Microsoft Zira - English (United States)"), v("Microsoft Ava Online (Natural) - English (United States)"), v("Kyoko", "ja-JP")]).name,
    "Microsoft Ava Online (Natural) - English (United States)"
  );
  assert.equal(pickEnglishVoice([v("Fred"), v("Samantha"), v("Kyoko", "ja-JP")]).name, "Samantha");
  assert.equal(pickEnglishVoice([v("Kyoko", "ja-JP"), v("Daniel", "en-GB")]).name, "Daniel");
  assert.equal(pickEnglishVoice([v("Kyoko", "ja-JP")]), null);
});
