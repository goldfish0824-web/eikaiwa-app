// 上級者版 Live API のシステムプロンプトと接続設定を組み立てる（prompts/adv_live_system.md）。
// 組み立て順: BASE → MODE → SETTINGS（各項目から1つずつ）→ WARMUP（復習フレーズがあるときだけ）
import { CONFIG } from "../../config.js";
import { DATA, PROMPTS } from "../generated/embedded.js";

const P = PROMPTS.adv_live_system;
const MODES = DATA.adv_modes.modes;

export const MODE_IDS = MODES.map((m) => m.id);

export const SETTING_OPTIONS = {
  speed: { values: ["normal", "fast"], default: "normal" },
  register: { values: ["polite", "casual", "idiomatic"], default: "casual" },
  interruptions: { values: ["off", "on"], default: "off" },
  correction: { values: ["none", "recast"], default: "none" },
};

export function normalizeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const [key, { values, default: def }] of Object.entries(SETTING_OPTIONS)) {
    out[key] = values.includes(src[key]) ? src[key] : def;
  }
  return out;
}

// 復習フレーズ（利用者自身のフレーズ帳から）。改行・制御文字を除き、数と長さを制限する。
export function normalizeWarmup(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === "string")
    .map((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, CONFIG.maxPhraseChars))
    .filter(Boolean)
    .slice(0, CONFIG.maxWarmupPhrases);
}

function pickIndex(length, avoid, random) {
  const avoidSet = new Set(avoid);
  const all = [...Array(length).keys()];
  const pool = all.filter((i) => !avoidSet.has(i));
  const from = pool.length ? pool : all;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

function intList(v) {
  return Array.isArray(v) ? v.filter(Number.isInteger).slice(0, 30) : [];
}

// モードのデータから、今回のペルソナ・話題・場面を選ぶ。recent は直近に使ったもの（避ける）。
// 戻り値の public は画面に表示してよい情報（ロールプレイの「予想外の展開」は含めない）。
export function pickSession(modeId, recent = {}, random = Math.random) {
  const mode = MODES.find((m) => m.id === modeId);
  if (!mode) return null;
  const base = { mode: mode.id, modeNameJa: mode.name_ja, modeNameEn: mode.name_en };

  if (mode.id === "roleplay") {
    const recentScenes = Array.isArray(recent.scenes) ? recent.scenes.filter((s) => typeof s === "string") : [];
    const avoid = mode.scenes.map((s, i) => (recentScenes.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    const scene = mode.scenes[pickIndex(mode.scenes.length, avoid, random)];
    return {
      vars: {
        SCENE: scene.scene,
        AI_ROLE: scene.ai_role,
        USER_ROLE: scene.user_role,
        GOAL: scene.goal,
        COMPLICATION: scene.complication,
      },
      voiceHint: "any",
      public: {
        ...base,
        scene: {
          id: scene.id,
          titleJa: scene.title_ja,
          scene: scene.scene,
          aiRole: scene.ai_role,
          userRole: scene.user_role,
          goal: scene.goal,
        },
      },
    };
  }

  const personaIndex = pickIndex(mode.personas.length, [], random);
  const persona = mode.personas[personaIndex];
  const vars = { PERSONA_NAME: persona.name, PERSONA_DESCRIPTION: persona.description };
  const pub = { ...base, persona: { name: persona.name, description: persona.description } };
  if (Array.isArray(mode.topics)) {
    const topicIndex = pickIndex(mode.topics.length, intList(recent.topics), random);
    vars.TOPIC = mode.topics[topicIndex];
    pub.topic = vars.TOPIC;
    pub.topicIndex = topicIndex;
  }
  return { vars, voiceHint: persona.voice_hint, public: pub };
}

function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`プロンプトの変数 ${name} がありません`);
    return vars[name];
  });
}

export function buildAdvLiveSystemPrompt({ session, minutes, settings, warmupPhrases }) {
  const vars = { ...session.vars, SESSION_MINUTES: String(minutes) };
  const parts = [P.BASE.blocks[0], P[`MODE: ${session.public.mode}`].blocks[0]];
  for (const key of Object.keys(SETTING_OPTIONS)) parts.push(P[`SETTINGS: ${key}`].options[settings[key]]);
  if (warmupPhrases.length) {
    vars.WARMUP_PHRASES = warmupPhrases.map((p) => `- ${p}`).join("\n");
    parts.push(P.WARMUP.blocks[0]);
  }
  return parts.map((t) => fill(t, vars).trim()).join("\n\n");
}

export function chooseVoice(voiceHint) {
  const list = CONFIG.liveVoices[voiceHint] ?? CONFIG.liveVoices.any;
  return list[0];
}

// Live API の setup（BidiGenerateContentSetup）。一時トークンに埋め込んで固定する。
export function buildLiveSetup({ thinking, voiceName, systemPrompt }) {
  const model = thinking ? CONFIG.liveModelThinking : CONFIG.liveModel;
  const generationConfig = {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
  };
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: CONFIG.liveThinkingLevel };
  const setup = {
    model: `models/${model}`,
    generationConfig,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  if (CONFIG.liveRealtimeInputConfig) setup.realtimeInputConfig = CONFIG.liveRealtimeInputConfig;
  return setup;
}
