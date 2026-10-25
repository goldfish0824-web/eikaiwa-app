// 上級者版の画面の制御（ログイン → ホーム → 会話 → 結果）。
// ?mock=1 で開くと、API を使わない偽の AI で画面の流れを確かめられる（開発用）。
import { load, remove, save, deviceId } from "../shared/storage.js";
import { GeminiLiveAdapter } from "./adapters/gemini-live.js";
import { post } from "./api.js";
import { ConversationSession } from "./session.js";

const MOCK = new URLSearchParams(location.search).has("mock");
const MockLiveAdapter = MOCK ? (await import("./adapters/mock-live.js")).MockLiveAdapter : null;

const ENABLED_MODES = ["smalltalk"]; // 残りのモードはフェーズ3で追加
const KEYS = {
  password: "adv.password",
  age: "adv.ageConfirmed",
  prefs: "adv.prefs",
  recent: "adv.recent",
  settings: "adv.settings",
};
const STATUS_TEXT = {
  idle: "「開始」を押すと AI に接続します",
  preparing: "マイクを準備しています…",
  connecting: "AI に接続しています…",
  listening: "聞いています — どうぞ話してください",
  speaking: "AI が話しています",
  paused: "一時停止中（マイクの音を送っていません）",
  reconnecting: "接続が切れたので、つなぎ直しています…",
  finishing: "時間です。AI の話が終わったら終了します…",
  ended: "",
};
const END_TEXT = {
  timeup: "時間になったので終了しました。",
  user: "会話を終了しました。",
  disconnected: "通信が切れたため終了しました。",
};

const $ = (id) => document.getElementById(id);
const prefs = { minutes: 5, captions: false, echoGuard: false, mode: "smalltalk", ...load(KEYS.prefs, {}) };
let limits = null;
let modes = [];
let session = null;
let lastResult = null;
let wakeLock = null;

const savePrefs = () => save(KEYS.prefs, prefs);
const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function show(name) {
  $("loading").hidden = true;
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

// ---- ログイン ----

async function login(password) {
  const data = await post("/auth", { password, app: "advanced" });
  save(KEYS.password, password);
  limits = data.limits;
}

function showLogin(message = "") {
  const confirmed = load(KEYS.age) === true;
  $("age-row").hidden = confirmed;
  $("age-check").checked = confirmed;
  $("password").value = load(KEYS.password) ?? "";
  $("login-error").textContent = message;
  show("login");
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("age-check").checked) {
    $("login-error").textContent = "18歳以上であることと、注意事項を確認してチェックを入れてください。";
    return;
  }
  $("login-btn").disabled = true;
  $("login-error").textContent = "";
  try {
    await login($("password").value.trim());
    save(KEYS.age, true);
    showHome();
  } catch (err) {
    $("login-error").textContent = err.message;
  } finally {
    $("login-btn").disabled = false;
  }
});

$("logout-btn").addEventListener("click", () => {
  remove(KEYS.password);
  showLogin();
});

// ---- ホーム ----

function renderRemaining() {
  $("remaining").textContent = limits
    ? `今日の残り ${limits.remainingMinutes}分（1日 ${limits.dailyMinutes}分まで）`
    : "";
}

function renderModes() {
  const box = $("modes");
  box.textContent = "";
  for (const m of modes) {
    const enabled = ENABLED_MODES.includes(m.id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode";
    b.disabled = !enabled;
    b.setAttribute("aria-pressed", String(prefs.mode === m.id));
    b.innerHTML = `<strong></strong><small></small>`;
    b.querySelector("strong").textContent = `${m.name_en}（${m.name_ja}）`;
    if (!enabled) b.querySelector("strong").insertAdjacentHTML("beforeend", `<span class="soon">準備中</span>`);
    b.querySelector("small").textContent = m.description_ja;
    b.addEventListener("click", () => {
      prefs.mode = m.id;
      savePrefs();
      renderModes();
    });
    box.append(b);
  }
}

function renderMinutes() {
  const box = $("minutes");
  box.textContent = "";
  for (const min of limits?.sessionMinutesOptions ?? [5, 10]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = `${min}分`;
    b.setAttribute("aria-pressed", String(prefs.minutes === min));
    b.addEventListener("click", () => {
      prefs.minutes = min;
      savePrefs();
      renderMinutes();
    });
    box.append(b);
  }
}

function showHome() {
  if (!ENABLED_MODES.includes(prefs.mode)) prefs.mode = ENABLED_MODES[0];
  renderRemaining();
  renderModes();
  renderMinutes();
  show("home");
}

$("go-btn").addEventListener("click", showTalk);

// ---- 会話 ----

function showTalk() {
  const mode = modes.find((m) => m.id === prefs.mode);
  $("talk-mode").textContent = mode ? `${mode.name_en}・${prefs.minutes}分` : "";
  $("timer").textContent = fmt(prefs.minutes * 60);
  $("partner").hidden = true;
  $("talk-error").textContent = "";
  $("captions").textContent = "";
  $("echo-check").checked = prefs.echoGuard;
  $("echo-check").disabled = false;
  setCaptions(prefs.captions);
  setStatus("idle");
  show("talk");
}

function setStatus(status) {
  $("status").textContent = STATUS_TEXT[status] ?? "";
  const btn = $("talk-btn");
  btn.classList.remove("stop", "busy", "speaking");
  const active = ["listening", "speaking", "paused", "reconnecting"].includes(status);
  if (status === "preparing" || status === "connecting") {
    btn.textContent = "中止";
    btn.classList.add("busy");
  } else if (active) {
    btn.textContent = "終了";
    btn.classList.add("stop");
    if (status === "speaking") btn.classList.add("speaking");
  } else if (status === "finishing") {
    btn.textContent = "すぐ終了";
    btn.classList.add("stop");
  } else {
    btn.textContent = "開始";
  }
  $("pause-btn").disabled = !active || status === "reconnecting";
  $("pause-btn").textContent = status === "paused" ? "再開" : "一時停止";
  $("repeat-btn").disabled = !(status === "listening" || status === "speaking");
  $("back-btn").disabled = status !== "idle" && status !== "ended";
  $("echo-check").disabled = status !== "idle" && status !== "ended";
  if (status === "idle" || status === "ended") $("meter-bar").style.width = "0%";
}

function setCaptions(visible) {
  prefs.captions = visible;
  savePrefs();
  $("captions").hidden = !visible;
  $("caption-btn").textContent = visible ? "字幕を隠す" : "字幕を表示";
}

function renderCaptions(segments) {
  const box = $("captions");
  box.textContent = "";
  for (const s of segments.slice(-8)) box.append(segmentItem(s, false));
  if (!box.hidden) box.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function segmentItem(s, withTime) {
  const li = document.createElement("li");
  if (withTime) li.insertAdjacentHTML("beforeend", `<span class="time">${fmt(s.start)}</span>`);
  const who = document.createElement("span");
  who.className = `who ${s.speaker}`;
  who.textContent = s.speaker === "user" ? "あなた" : "AI";
  li.append(who, document.createTextNode(s.text));
  if (s.interrupted) li.insertAdjacentHTML("beforeend", ` <span class="cut">（途中で切れました）</span>`);
  return li;
}

function renderPartner(info) {
  const s = info.session;
  const box = $("partner");
  box.textContent = "";
  const line = (label, text) => {
    const p = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = `${label}：`;
    p.append(b, document.createTextNode(text));
    box.append(p);
  };
  if (s.persona) line("相手", `${s.persona.name} — ${s.persona.description}`);
  if (s.topic) line("話題", s.topic);
  if (s.scene) line("場面", s.scene.titleJa);
  box.hidden = false;
}

function rememberRecent(info) {
  const s = info.session;
  if (s.topicIndex === undefined && !s.scene) return;
  const recent = load(KEYS.recent, {});
  const r = (recent[s.mode] ??= {});
  if (s.topicIndex !== undefined) r.topics = [s.topicIndex, ...(r.topics ?? []).filter((i) => i !== s.topicIndex)].slice(0, 5);
  if (s.scene) r.scenes = [s.scene.id, ...(r.scenes ?? []).filter((i) => i !== s.scene.id)].slice(0, 5);
  save(KEYS.recent, recent);
}

function requestToken() {
  const mode = prefs.mode;
  return post("/adv/token", {
    password: load(KEYS.password),
    deviceId: deviceId(),
    minutes: prefs.minutes,
    mode,
    thinking: false,
    settings: load(KEYS.settings, {}),
    warmupPhrases: [],
    recent: load(KEYS.recent, {})[mode] ?? {},
  });
}

function mockToken() {
  return Promise.resolve({
    ok: true,
    token: "mock",
    model: "models/mock",
    wsUrl: "wss://generativelanguage.googleapis.com/mock",
    minutes: prefs.minutes,
    session: {
      mode: "smalltalk",
      persona: { name: "Alex", description: "a friendly American coworker (mock)" },
      topic: "what you did last weekend",
      topicIndex: 0,
      voice: "Puck",
    },
    pricing: { usdPerMTokens: { inputText: 0.75, inputAudio: 3, outputText: 4.5, outputAudio: 12 }, usdJpy: 150 },
    usage: limits,
  });
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function startSession() {
  $("talk-error").textContent = "";
  prefs.echoGuard = $("echo-check").checked;
  savePrefs();
  const s = new ConversationSession({
    requestToken: MOCK ? mockToken : requestToken,
    createAdapter: () => (MOCK ? new MockLiveAdapter() : new GeminiLiveAdapter()),
    echoGuard: prefs.echoGuard,
    allowNoMic: MOCK,
  });
  session = s;
  const on = (type, fn) => s.addEventListener(type, (e) => fn(e.detail));
  on("status", ({ status }) => setStatus(status));
  on("info", (info) => {
    renderPartner(info);
    rememberRecent(info);
    if (info.usage) limits = { ...limits, ...info.usage };
  });
  on("tick", ({ remaining }) => ($("timer").textContent = fmt(remaining)));
  on("level", ({ rms }) => ($("meter-bar").style.width = `${Math.min(100, rms * 600)}%`));
  on("caption", ({ segments }) => renderCaptions(segments));
  on("error", ({ message }) => {
    session = null;
    releaseWakeLock();
    setStatus("idle");
    $("talk-error").textContent = message;
  });
  on("ended", ({ result }) => {
    session = null;
    releaseWakeLock();
    if (result.aborted) return showTalk();
    lastResult = result;
    showResult(result);
  });
  requestWakeLock();
  s.start();
}

$("talk-btn").addEventListener("click", () => (session ? session.stop() : startSession()));
$("pause-btn").addEventListener("click", () => (session?.paused ? session.resume() : session?.pause()));
$("repeat-btn").addEventListener("click", () => session?.repeat());
$("caption-btn").addEventListener("click", () => setCaptions($("captions").hidden));
$("back-btn").addEventListener("click", () => !session && showHome());
window.addEventListener("pagehide", () => session?.stop());

// ---- 結果 ----

function showResult(r) {
  const users = r.segments.filter((s) => s.speaker === "user").length;
  const ais = r.segments.length - users;
  const ratio = r.durationSec > 0 ? Math.round((r.userSpeechSec / r.durationSec) * 100) : 0;
  $("result-summary").textContent =
    `${END_TEXT[r.reason] ?? ""} 会話時間 ${fmt(r.durationSec)}・あなたが話した時間（目安）約${ratio}%・発話 あなた${users}回／AI ${ais}回`;

  const u = r.usage;
  const t = u.tokens;
  const rows = [
    ["入力（音声）", t.inputAudio],
    ["入力（テキスト）", t.inputText],
    ["出力（音声）", t.outputAudio],
    ["出力（テキスト・思考）", t.outputText + t.thoughts],
    ["合計トークン", t.total],
  ];
  $("usage").innerHTML =
    `<table class="usage"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v.toLocaleString()}</td></tr>`).join("")}` +
    `<tr class="total"><td>費用の目安</td><td>$${u.usd.toFixed(4)}（約${u.jpy.toFixed(1)}円）</td></tr></tbody></table>` +
    `<p class="hint">応答 ${u.turns}回・使用量の報告 ${u.reports}件。単価は Worker の設定値による概算です。` +
    `${u.unknownModality ? "内訳が届かなかった分は音声の単価で見積もっています。" : ""}` +
    `実際の請求額は Google Cloud の請求画面で確かめてください。</p>`;

  const list = $("transcript");
  list.textContent = "";
  if (!r.segments.length) list.innerHTML = `<li>文字起こしはありません。</li>`;
  for (const s of r.segments) list.append(segmentItem(s, true));
  show("result");
}

$("copy-btn").addEventListener("click", async () => {
  if (!lastResult) return;
  const text = lastResult.segments.map((s) => `[${fmt(s.start)}] ${s.speaker}: ${s.text}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    $("copy-btn").textContent = "コピーしました";
  } catch {
    $("copy-btn").textContent = "コピーできませんでした";
  }
  setTimeout(() => ($("copy-btn").textContent = "文字起こしをコピー"), 2000);
});

$("home-btn").addEventListener("click", showHome);

// ---- 起動 ----

async function boot() {
  try {
    const res = await fetch("../data/adv_modes.json");
    modes = (await res.json()).modes;
  } catch {
    modes = [{ id: "smalltalk", name_en: "Small Talk", name_ja: "雑談", description_ja: "" }];
  }
  const saved = load(KEYS.password);
  if (!saved || load(KEYS.age) !== true) return showLogin();
  try {
    await login(saved);
    showHome();
  } catch (err) {
    if (err.status === 401 || err.status === 403) remove(KEYS.password);
    showLogin(err.message);
  }
}

boot();
