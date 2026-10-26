// 学生版 Claude版（高校生）のプロンプトの組み立てと、応答の検証。
//   ターン:     prompts/student_turn_claude.md
//   ふりかえり: prompts/student_summary.md
// システムプロンプトは「共通部分」「シナリオ部分」の2ブロックで、どちらもプロンプトキャッシュの対象にする。
// クライアントから受け取るのはシナリオID・レベル・履歴・発言だけ（プロンプト本文は受け取らない）。
import { CONFIG } from "../../config.js";
import { DATA, PROMPTS } from "../generated/embedded.js";

const T = PROMPTS.student_turn_claude;
const S = PROMPTS.student_summary;
const HS = DATA.scenarios_hs;
const MSG_TEMPLATES = T["会話履歴の渡し方"].options;

export const SC_LEVELS = Object.keys(HS.levels);
export const SC_SCENARIOS = new Map(HS.scenarios.map((s) => [s.id, s]));
export const SAFETY_FLAGS = ["none", "redirect", "support"];

export const DEFAULT_SUPPORT_JA =
  "話してくれてありがとう。つらい気持ちは、ひとりでかかえこまなくて大丈夫です。担任の先生や保健室の先生、スクールカウンセラー、家族など、信頼できる大人に話してみてください。";

export function fill(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

// 制御文字・改行を空白にして、連続する空白をまとめ、長さを制限する。
export function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// 会話履歴 [{ role: "ai" | "student", text }] を検証する。
// AI の最初の一言から始まり、交互に並び、往復数が上限以内であること。不正なら null。
export function normalizeHistory(list) {
  if (!Array.isArray(list) || list.length > 1 + 2 * CONFIG.scMaxExchanges) return null;
  const out = [];
  for (const [i, e] of list.entries()) {
    const role = i % 2 === 0 ? "ai" : "student";
    const text = cleanText(e?.text, CONFIG.scMaxUtteranceChars);
    if (e?.role !== role || !text) return null;
    out.push({ role, text });
  }
  return out;
}

function keyPhraseVars(scenario) {
  return Object.fromEntries(scenario.key_phrases.map((p, i) => [`KEY_PHRASE_${i}`, p.en]));
}

// ---- ターン（/sc/turn） ----

export function buildTurnSystem(scenario, level) {
  const [common, scenarioTemplate] = T["システムプロンプト"].blocks;
  const scenarioText = fill(scenarioTemplate, {
    LEVEL_NAME: HS.levels[level].name_en,
    LEVEL_RULES: T.LEVEL_RULES.options[level],
    TITLE_EN: scenario.title_en,
    SETTING_EN: scenario.setting_en,
    AI_ROLE_EN: scenario.ai_role_en,
    USER_ROLE_EN: scenario.user_role_en,
    GOAL_EN: scenario.goal_en,
    ...keyPhraseVars(scenario),
    NOTES_FOR_AI: scenario.notes_for_ai || "(none)",
    MAX_TURNS: scenario.max_turns[level],
    OPENING: scenario.opening[level],
  });
  return [
    { type: "text", text: common, cache_control: { type: "ephemeral" } },
    { type: "text", text: scenarioText, cache_control: { type: "ephemeral" } },
  ];
}

// 生徒の k 回目の発言。過去の発言も毎回同じ文字列になるので、会話の途中までキャッシュが効く。
function studentMessage(k, maxTurns, text) {
  const s = fill(MSG_TEMPLATES.reply, { TURN_NUMBER: k, MAX_TURNS: maxTurns, USER_TEXT: text });
  return k >= maxTurns ? `${s}\n\n${MSG_TEMPLATES.last_turn}` : s;
}

// 戻り値の exchange は、今回の生徒の発言が何往復目か（start と ja2en では次の往復の番号）。
export function buildTurnMessages(history, action, userText, maxTurns) {
  const messages = [{ role: "user", content: MSG_TEMPLATES.start }];
  let k = 0;
  for (const e of history) {
    if (e.role === "ai") messages.push({ role: "assistant", content: e.text });
    else messages.push({ role: "user", content: studentMessage(++k, maxTurns, e.text) });
  }
  if (action === "reply") messages.push({ role: "user", content: studentMessage(k + 1, maxTurns, userText) });
  if (action === "ja2en") messages.push({ role: "user", content: fill(MSG_TEMPLATES.ja2en, { USER_TEXT: userText }) });
  return { messages, exchange: k + 1 };
}

const str = { type: "string" };
const flag = { type: "string", enum: SAFETY_FLAGS };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const TURN_SCHEMA = object({
  reply_en: str,
  reply_ja: str,
  hints: { type: "array", items: str },
  used_key_phrases: { type: "array", items: { type: "integer", enum: [0, 1, 2] } },
  goal_reached: { type: "boolean" },
  should_end: { type: "boolean" },
  safety_flag: flag,
  support_message_ja: str,
});

export const JA2EN_SCHEMA = object({
  en: str,
  en_simple: str,
  tip_ja: str,
  safety_flag: flag,
  support_message_ja: str,
});

function supportFields(d) {
  const support = d.safety_flag === "support";
  return {
    safety_flag: d.safety_flag,
    support_message_ja: support ? cleanText(d.support_message_ja, 400) || DEFAULT_SUPPORT_JA : "",
  };
}

// 必須項目がそろっていれば整えて返す。足りなければ null（再試行する）。
export function normalizeTurn(d) {
  if (!d || typeof d !== "object" || !SAFETY_FLAGS.includes(d.safety_flag)) return null;
  const replyEn = cleanText(d.reply_en, 600);
  if (!replyEn) return null;
  const hints = (Array.isArray(d.hints) ? d.hints : [])
    .map((h) => cleanText(h, 160))
    .filter(Boolean)
    .slice(0, 3)
    .sort((a, b) => a.length - b.length);
  const used = [...new Set((Array.isArray(d.used_key_phrases) ? d.used_key_phrases : []).filter((i) => [0, 1, 2].includes(i)))];
  const safety = supportFields(d);
  return {
    reply_en: replyEn,
    reply_ja: cleanText(d.reply_ja, 600),
    hints,
    used_key_phrases: used.sort(),
    goal_reached: d.goal_reached === true,
    should_end: d.should_end === true || safety.safety_flag === "support",
    ...safety,
  };
}

export function normalizeJa2en(d) {
  if (!d || typeof d !== "object" || !SAFETY_FLAGS.includes(d.safety_flag)) return null;
  const en = cleanText(d.en, 300);
  if (!en && d.safety_flag === "none") return null;
  return {
    en,
    en_simple: cleanText(d.en_simple, 300) || en,
    tip_ja: cleanText(d.tip_ja, 300),
    ...supportFields(d),
  };
}

// 形の崩れた応答が続いたときの定型文。最初の一言はシナリオの opening を使う。
export function fallbackTurn({ action, scenario, level, safetyFlag = "none" }) {
  const start = action === "start";
  return {
    reply_en: start ? scenario.opening[level] : "Sorry, could you say that again?",
    reply_ja: start ? "" : "ごめんなさい、もう一度言ってもらえますか？",
    hints: [],
    used_key_phrases: [],
    goal_reached: false,
    should_end: false,
    safety_flag: safetyFlag,
    support_message_ja: "",
    fallback: true,
  };
}

// ---- ふりかえり（/sc/summary） ----

const SUMMARY_VARS = {
  AUDIENCE: "a Japanese high school student",
  TRANSCRIPT_SOURCE: "browser speech recognition",
  TONE: "simple, friendly Japanese that a high school student reads easily",
};

export function buildSummarySystem() {
  // 発音のポイント（Gemini版のみ）の行は消す。
  return fill(S["システムプロンプト"].blocks[0], SUMMARY_VARS).replace(/^[ \t]*\{\{PRONUNCIATION_BLOCK\}\}[ \t]*\n/m, "");
}

export function buildSummaryUser(scenario, level, history) {
  return fill(S["ユーザーメッセージ"].blocks[0], {
    LEVEL_NAME: HS.levels[level].name_en,
    TITLE_EN: scenario.title_en,
    GOAL_EN: scenario.goal_en,
    ...keyPhraseVars(scenario),
    CONVERSATION: history.map((e) => `[${e.role}] ${e.text}`).join("\n"),
    PRONUNCIATION_NOTES: "",
  }).trimEnd();
}

export const SUMMARY_SCHEMA = object({
  can_do: { type: "array", items: str },
  try_next: object({ you_said: str, better: str, why_ja: str }),
  key_phrases_used: { type: "array", items: { type: "boolean" } },
  privacy_note_ja: str,
  encouragement_ja: str,
});

export function normalizeSummary(d) {
  if (!d || typeof d !== "object") return null;
  const canDo = (Array.isArray(d.can_do) ? d.can_do : []).map((s) => cleanText(s, 200)).filter(Boolean).slice(0, 2);
  if (!canDo.length) return null;
  const t = d.try_next && typeof d.try_next === "object" ? d.try_next : {};
  const tryNext = { you_said: cleanText(t.you_said, 300), better: cleanText(t.better, 300), why_ja: cleanText(t.why_ja, 300) };
  const used = Array.isArray(d.key_phrases_used) ? d.key_phrases_used : [];
  return {
    can_do: canDo,
    try_next: tryNext.better ? tryNext : null,
    key_phrases_used: [0, 1, 2].map((i) => used[i] === true),
    privacy_note_ja: cleanText(d.privacy_note_ja, 200),
    encouragement_ja: cleanText(d.encouragement_ja, 200),
  };
}

export function fallbackSummary() {
  return {
    can_do: [],
    try_next: null,
    key_phrases_used: [false, false, false],
    privacy_note_ja: "",
    encouragement_ja: "ふりかえりを作れませんでした。会話の練習はしっかりできています！",
    fallback: true,
  };
}
