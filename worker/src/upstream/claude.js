// Claude API の呼び出し（公式 SDK @anthropic-ai/sdk）。
// 学生版 Claude版（高校生）は、外部の AI としてはこの経路だけを使う（Gemini には一切つながない）。
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../../config.js";
import { HttpError, MSG } from "../http.js";

// Claude を呼んでよいアプリ種別。上級者版のレポートを Claude で作る場合は "advanced" を加える。
const CLAUDE_APPS = new Set(["student-claude"]);

// 応答の形が崩れていた・応答を断られた（再試行や定型文への差し替えの対象）。
export class ClaudeOutputError extends Error {
  constructor(reason, usage) {
    super(reason);
    this.reason = reason; // "refusal" | "max_tokens" | "json"
    this.usage = usage;
  }
}

function makeClient(env) {
  if (!env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が設定されていません");
    throw new HttpError(500, MSG.serverConfig);
  }
  // fetch はリクエストのたびに読み直す（Workers での呼び出し方の違いと、テストの差し替えに対応するため）。
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: CONFIG.anthropicApiBase,
    timeout: CONFIG.claudeTimeoutMs,
    maxRetries: CONFIG.claudeMaxRetries,
    fetch: (url, init) => fetch(url, init),
  });
}

// 使ったトークン数から費用の目安（円）を出す。
export function claudeCostJpy(model, usage) {
  const p = CONFIG.claudePricingUsdPerMTokens[model];
  if (!p || !usage) return 0;
  const usd =
    ((usage.input_tokens ?? 0) * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.output_tokens ?? 0) * p.output) /
    1e6;
  return usd * CONFIG.usdJpy;
}

// JSON スキーマに沿った応答（構造化出力）を1つ受け取る。
// 戻り値: { data, usage }。形が崩れていたら ClaudeOutputError、通信や API のエラーは HttpError(502)。
export async function createJsonMessage(env, auth, { model, effort, maxTokens, system, messages, schema }) {
  if (!auth || !CLAUDE_APPS.has(auth.app)) throw new HttpError(403, MSG.forbidden);
  let res;
  try {
    res = await makeClient(env).messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort, format: { type: "json_schema", schema } },
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // 会話の内容を出さないよう、エラーの種類だけ記録する。
    if (e instanceof Anthropic.APIError) {
      console.error("Claude: 失敗", e.status ?? "-", e.error?.error?.type ?? e.name);
    } else {
      console.error("Claude: 通信エラー", e?.name ?? "Error");
    }
    throw new HttpError(502, MSG.upstream);
  }

  const usage = res.usage;
  if (res.stop_reason === "refusal") {
    console.error("Claude: 応答を断られました", res.stop_details?.category ?? "-");
    throw new ClaudeOutputError("refusal", usage);
  }
  if (res.stop_reason === "max_tokens") throw new ClaudeOutputError("max_tokens", usage);
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return { data: JSON.parse(text), usage };
  } catch {
    throw new ClaudeOutputError("json", usage);
  }
}
