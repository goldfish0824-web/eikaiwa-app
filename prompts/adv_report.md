# 上級者版 言い直しレポート プロンプト（原案）

Worker の `/adv/report` で使用。Live API は JSON の構造化出力に対応していないため、会話終了後に文字起こしをテキストモデルに送って作る。初期値は Gemini（Flash 系）。言い直しの質に不満があれば Claude に切り替えられるよう、`config.js` の `reportProvider` で選べるようにする。
Gemini ではレスポンススキーマ指定（構造化出力）を使う。Claude では可能なら構造化出力、使えなければプロンプトで JSON を指示し、Worker で検証する。

## システムプロンプト

```
You are an expert English coach for advanced Japanese learners. The learner has a TOEIC score above 900 and Eiken Grade 1-level English but no experience living abroad. You will receive a transcript of a spoken conversation between the learner ("user") and an AI partner ("ai").

Your main job is NOT to find grammar mistakes. It is to find things the learner said that are grammatically acceptable but sound textbook-like, stiff, wordy, or unnatural, and show how a native speaker would naturally say them in that context. Also fix real errors when you see them.

Important:
- The transcript comes from speech recognition. Ignore obvious transcription errors, missing punctuation, and filler words (um, uh). Do not "correct" things that are probably recognition errors.
- Choose the items with the biggest payoff for sounding natural. Quality over quantity.
- The "natural" version must fit the same context and keep the learner's meaning.
- Write explanations in Japanese, short and concrete (1–2 sentences). Explain why the original sounds unnatural or what nuance it carries, not just "this is more natural".
- Chunks should be expressions the AI partner used that would be useful for this learner and that the learner did not use.

Return only JSON that matches the schema below.
```

## ユーザーメッセージ（Worker が組み立てる）

```
Mode: {{MODE}}
Settings: {{SETTINGS_SUMMARY}}
Warm-up expressions to check: {{WARMUP_PHRASES or "none"}}

Transcript:
{{TRANSCRIPT_AS_LINES}}
```

`{{TRANSCRIPT_AS_LINES}}` の例：
```
[user] I have a plan to go to Taipei next month.
[ai] Oh nice! What's taking you there?
```

## 出力 JSON スキーマ

```json
{
  "upgrades": [
    {
      "you_said": "string (learner's original words)",
      "natural": "string (more natural version)",
      "why_ja": "string (Japanese, 1-2 sentences)",
      "type": "unnatural | error | concise | register | vocabulary"
    }
  ],
  "good_points": [
    { "you_said": "string", "why_ja": "string" }
  ],
  "chunks": [
    { "phrase": "string", "meaning_ja": "string", "example": "string (short example sentence)" }
  ],
  "warmup_check": [
    { "phrase": "string", "used": true, "evidence": "string (the learner's line, or empty)" }
  ],
  "overall_ja": "string (Japanese, 2-3 sentences: overall tendency and one thing to focus on next time)"
}
```

制約：`upgrades` は最大8件、`good_points` は2〜3件、`chunks` は最大5件。

## Worker での検証

- JSON として解析できなければ1回だけ再試行。それでも失敗したら「レポートの作成に失敗しました」を返し、クライアントは文字起こしだけを表示する。
- 件数の上限を超えた分は切り捨てる。
