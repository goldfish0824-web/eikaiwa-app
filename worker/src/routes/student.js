// 学生版のエンドポイント。
//   /sc/*: 学生版 Claude版（高校生）… Claude API だけを使う
//   /sg/*: 学生版 Gemini版（18歳以上）… Gemini API を使う（フェーズ6で実装）
// どちらも、アプリ種別のチェック（index.js の ROUTES）を通ったリクエストだけがここに届く。
import { CONFIG } from "../../config.js";
import { HttpError, MSG, json } from "../http.js";
import {
  JA2EN_SCHEMA,
  SC_LEVELS,
  SC_SCENARIOS,
  SUMMARY_SCHEMA,
  TURN_SCHEMA,
  buildSummarySystem,
  buildSummaryUser,
  buildTurnMessages,
  buildTurnSystem,
  cleanText,
  fallbackSummary,
  fallbackTurn,
  normalizeHistory,
  normalizeJa2en,
  normalizeSummary,
  normalizeTurn,
} from "../prompts/student-claude.js";
import { ClaudeOutputError, claudeCostJpy, createJsonMessage } from "../upstream/claude.js";
import { checkLimits, globalKey, jstDate, readCount } from "../usage.js";

const DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/;
const SC_ACTIONS = ["start", "reply", "ja2en"];

export async function notImplemented() {
  throw new HttpError(501, MSG.notImplemented);
}

function limitOf(auth, name) {
  return Number.isFinite(auth[name]) ? auth[name] : CONFIG.defaultLimits["student-claude"][name];
}

// 1回の Claude 呼び出し（ターン・日本語→英語・ふりかえり）を1回と数える。
function scLimitItems(auth, deviceId, date) {
  return [
    { key: `${date}:${auth.id}:${deviceId}`, limit: limitOf(auth, "dailyTurnsPerDevice"), scope: "device" },
    { key: `${date}:${auth.id}`, limit: limitOf(auth, "dailyTurnsTotal"), scope: "password" },
    { key: globalKey(date, "student-claude"), limit: CONFIG.globalDailyLimits["student-claude"], scope: "global" },
  ];
}

// 安全フラグの件数だけを数える（内容は保存しない）。キーの「#」は端末IDと区別するため。
async function countSafetyFlag(env, auth, date, flag) {
  const key = `${date}:${auth.id}:#flag:${flag}`;
  const n = await readCount(env.USAGE, key);
  await env.USAGE.put(key, String(n + 1), { expirationTtl: CONFIG.safetyFlagTtlSeconds });
}

function parseCommon(body) {
  const scenario = SC_SCENARIOS.get(body.scenarioId);
  const history = normalizeHistory(body.history ?? []);
  if (!DEVICE_RE.test(String(body.deviceId ?? "")) || !scenario || !SC_LEVELS.includes(body.level) || !history) {
    throw new HttpError(400, MSG.badRequest);
  }
  return { deviceId: body.deviceId, scenario, level: body.level, history };
}

// 形が崩れていたら1回だけ再試行する。断られた（refusal）ときは再試行しない。
async function callWithRetry(env, auth, request, normalize) {
  let costJpy = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, usage } = await createJsonMessage(env, auth, request);
      costJpy += claudeCostJpy(request.model, usage);
      const result = normalize(data);
      if (result) return { result, costJpy, refused: false };
      console.error("Claude: 応答の項目が足りません");
    } catch (e) {
      if (!(e instanceof ClaudeOutputError)) throw e;
      costJpy += claudeCostJpy(request.model, e.usage);
      if (e.reason === "refusal") return { result: null, costJpy, refused: true };
      console.error("Claude: 応答の形が崩れています", e.reason);
    }
  }
  return { result: null, costJpy, refused: false };
}

// POST /sc/turn
// 入力: { password, deviceId, scenarioId, level, history[], userText, action: "start" | "reply" | "ja2en" }
// 出力: { ok, action, exchange, maxTurns, turn | ja2en, costJpy }
export async function handleScTurn({ env, auth, body, now }) {
  const { deviceId, scenario, level, history } = parseCommon(body);
  const action = body.action;
  if (!SC_ACTIONS.includes(action)) throw new HttpError(400, MSG.badRequest);
  let userText = "";
  if (action === "start") {
    if (history.length) throw new HttpError(400, MSG.badRequest);
  } else {
    userText = cleanText(body.userText, CONFIG.scMaxUtteranceChars);
    if (!userText || history.at(-1)?.role !== "ai") throw new HttpError(400, MSG.badRequest);
    const done = history.filter((e) => e.role === "student").length;
    if (action === "reply" && done >= CONFIG.scMaxExchanges) throw new HttpError(400, MSG.tooManyExchanges);
  }

  const date = jstDate(now);
  const limits = await checkLimits(env.USAGE, scLimitItems(auth, deviceId, date), 1);
  if (!limits.ok) throw new HttpError(429, MSG.limit);

  const maxTurns = scenario.max_turns[level];
  const { messages, exchange } = buildTurnMessages(history, action, userText, maxTurns);
  const ja2en = action === "ja2en";
  const { result, costJpy, refused } = await callWithRetry(
    env,
    auth,
    {
      model: CONFIG.scModel,
      effort: CONFIG.scTurnEffort,
      maxTokens: CONFIG.scTurnMaxTokens,
      system: buildTurnSystem(scenario, level),
      messages,
      schema: ja2en ? JA2EN_SCHEMA : TURN_SCHEMA,
    },
    ja2en ? normalizeJa2en : normalizeTurn
  );
  await limits.commit();
  if (refused) await countSafetyFlag(env, auth, date, "redirect");

  if (ja2en) {
    if (!result) throw new HttpError(502, MSG.ja2enFailed);
    if (result.safety_flag !== "none") await countSafetyFlag(env, auth, date, result.safety_flag);
    return json({ ok: true, action, exchange, maxTurns, ja2en: result, costJpy });
  }
  const turn = result ?? fallbackTurn({ action, scenario, level, safetyFlag: refused ? "redirect" : "none" });
  if (result && turn.safety_flag !== "none") await countSafetyFlag(env, auth, date, turn.safety_flag);
  return json({ ok: true, action, exchange, maxTurns, turn, costJpy });
}

// POST /sc/summary
// 入力: { password, deviceId, scenarioId, level, history[] }  出力: { ok, summary, costJpy }
export async function handleScSummary({ env, auth, body, now }) {
  const { deviceId, scenario, level, history } = parseCommon(body);
  if (!history.some((e) => e.role === "student")) throw new HttpError(400, MSG.badRequest);

  const date = jstDate(now);
  const limits = await checkLimits(env.USAGE, scLimitItems(auth, deviceId, date), 1);
  if (!limits.ok) throw new HttpError(429, MSG.limit);

  const { result, costJpy } = await callWithRetry(
    env,
    auth,
    {
      model: CONFIG.scModel,
      effort: CONFIG.scSummaryEffort,
      maxTokens: CONFIG.scSummaryMaxTokens,
      system: buildSummarySystem(),
      messages: [{ role: "user", content: buildSummaryUser(scenario, level, history) }],
      schema: SUMMARY_SCHEMA,
    },
    normalizeSummary
  );
  await limits.commit();
  return json({ ok: true, summary: result ?? fallbackSummary(), costJpy });
}
