// 上級者版のエンドポイント（app: advanced のパスワードのみ）。
import { CONFIG } from "../../config.js";
import { HttpError, MSG, json } from "../http.js";
import {
  MODE_IDS,
  buildAdvLiveSystemPrompt,
  buildLiveSetup,
  chooseVoice,
  normalizeSettings,
  normalizeWarmup,
  pickSession,
} from "../prompts/adv-live.js";
import { createLiveToken } from "../upstream/gemini.js";
import { checkLimits, globalKey, jstDate, readCount } from "../usage.js";

export function advDailyMinutes(auth) {
  return Number.isFinite(auth.dailyMinutes) ? auth.dailyMinutes : CONFIG.defaultLimits.advanced.dailyMinutes;
}

export async function advUsage(env, auth, now) {
  const date = jstDate(now);
  const used = await readCount(env.USAGE, `${date}:${auth.id}`);
  const daily = advDailyMinutes(auth);
  return { dailyMinutes: daily, usedMinutes: used, remainingMinutes: Math.max(0, daily - used) };
}

// POST /adv/token
// 入力: { password, deviceId, minutes, thinking, mode, settings, warmupPhrases, recent }
// 出力: { token, model, wsUrl, expiresAt, session, pricing, usage }
export async function handleAdvToken({ env, auth, body, now }) {
  const minutes = Number(body.minutes);
  if (!CONFIG.sessionMinutesOptions.includes(minutes) || minutes > CONFIG.maxSessionMinutes) {
    throw new HttpError(400, MSG.badRequest);
  }
  const modeId = body.mode ?? "smalltalk";
  if (!MODE_IDS.includes(modeId)) throw new HttpError(400, MSG.badRequest);
  const thinking = body.thinking === true;
  const settings = normalizeSettings(body.settings);
  const warmupPhrases = normalizeWarmup(body.warmupPhrases);

  const date = jstDate(now);
  const daily = advDailyMinutes(auth);
  const limits = await checkLimits(
    env.USAGE,
    [
      { key: `${date}:${auth.id}`, limit: daily, scope: "password" },
      { key: globalKey(date, "advanced"), limit: CONFIG.globalDailyLimits.advanced, scope: "global" },
    ],
    minutes
  );
  if (!limits.ok) {
    const remaining = Math.max(0, limits.blocked.limit - limits.blocked.used);
    const message =
      remaining > 0 && limits.blocked.scope === "password"
        ? `今日の残りは${remaining}分です。短い会話を選んでください。`
        : MSG.limit;
    throw new HttpError(429, message, { remainingMinutes: limits.blocked.scope === "password" ? remaining : 0 });
  }

  const session = pickSession(modeId, body.recent && typeof body.recent === "object" ? body.recent : {});
  const systemPrompt = buildAdvLiveSystemPrompt({ session, minutes, settings, warmupPhrases });
  const setup = buildLiveSetup({ thinking, voiceName: chooseVoice(session.voiceHint), systemPrompt });

  const expireMs = now + (minutes + CONFIG.liveTokenExtraMinutes) * 60_000;
  const newSessionMs = now + CONFIG.liveTokenNewSessionSeconds * 1000;
  const token = await createLiveToken(env, auth, {
    setup,
    expireTime: new Date(expireMs).toISOString(),
    newSessionExpireTime: new Date(newSessionMs).toISOString(),
  });
  await limits.commit();

  const used = limits.current[0] + minutes;
  return json({
    ok: true,
    token: token.name,
    model: setup.model,
    wsUrl: CONFIG.geminiLiveWsUrl,
    expiresAt: new Date(expireMs).toISOString(),
    minutes,
    thinking,
    session: { ...session.public, voice: setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName },
    settings,
    pricing: { usdPerMTokens: CONFIG.livePricingUsdPerMTokens, usdJpy: CONFIG.usdJpy },
    usage: { dailyMinutes: daily, usedMinutes: used, remainingMinutes: Math.max(0, daily - used) },
  });
}

// POST /adv/report（フェーズ2で実装）
export async function handleAdvReport() {
  throw new HttpError(501, MSG.notImplemented);
}
