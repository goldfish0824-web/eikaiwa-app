// 学生版の画面と学習の流れ（Claude版・Gemini版で共通）。spec/02_student_common.md。
// 使うエンジンと、版ごとの文言（注意事項・使い方・相談先）は各版の app.js から渡す。
// ここにはエンジン固有の処理を書かない（spec/05_architecture.md「4.」のインターフェースだけを使う）。
import { post } from "../api.js";
import { deviceId, load, remove, save } from "../storage.js";
import { WORKER_URL } from "../worker-url.js";
import { clear, h } from "./dom.js";
import { phraseMatches, speakablePhrase } from "./phrase-match.js";
import { Roleplay } from "./roleplay.js";

export async function startStudentApp({ root, app, Engine, texts, scenariosUrl, storagePrefix }) {
  const KEYS = {
    password: `${storagePrefix}.password`,
    prefs: `${storagePrefix}.prefs`,
    attempts: `${storagePrefix}.attempts`,
  };
  const showCost = new URLSearchParams(location.search).has("cost"); // 開発者の費用確認用
  const prefs = { level: "easy", captions: true, ...load(KEYS.prefs, {}) };
  const savePrefs = () => save(KEYS.prefs, prefs);
  let data = null; // data/scenarios_*.json
  let password = "";
  let limits = null;
  let engine = null;
  let screenCleanup = null;

  const btn = (label, onclick, cls = "btn") => h("button", { class: cls, type: "button", onclick }, label);
  const title = (small) =>
    h("h1", { class: small ? "title small" : "title" }, "Sprout", h("span", {}, texts.appLabel));

  function show(...children) {
    screenCleanup?.();
    screenCleanup = null;
    clear(root, children);
    window.scrollTo(0, 0);
  }

  function disposeEngine() {
    engine?.dispose?.();
    engine = null;
  }

  // 新しいエンジンを作る。タップの処理の中で呼ぶ（iOS の音声の制限）。
  function newEngine(scenario) {
    disposeEngine();
    engine = new Engine({
      workerUrl: WORKER_URL,
      password,
      deviceId: deviceId(),
      scenario,
      level: prefs.level,
      ttsRate: data.levels[prefs.level]?.tts_rate,
    });
    Promise.resolve(engine.init?.()).catch(() => {});
    return engine;
  }

  const attempts = () => load(KEYS.attempts, {}) ?? {};
  function countAttempt(id) {
    const a = attempts();
    a[id] = (Number(a[id]) || 0) + 1;
    save(KEYS.attempts, a);
  }

  // ---- ログイン ----

  async function login(pw) {
    const res = await post("/auth", { password: pw, app });
    password = pw;
    limits = res.limits;
    save(KEYS.password, pw);
  }

  function showLogin(message = "") {
    const check = h("input", { type: "checkbox" });
    const input = h("input", {
      type: "password",
      autocomplete: "current-password",
      autocapitalize: "off",
      spellcheck: "false",
      required: true,
      id: "password",
    });
    const submit = h("button", { class: "btn primary", type: "submit", disabled: true }, "ログイン");
    const error = h("p", { class: "error", role: "alert" }, message);
    check.addEventListener("change", () => (submit.disabled = !check.checked));
    const form = h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          if (!check.checked) return;
          submit.disabled = true;
          error.textContent = "";
          try {
            await login(input.value.trim());
            showHome();
          } catch (err) {
            error.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      h("label", { for: "password" }, "パスワード（先生から配られたもの）"),
      input,
      submit,
      error
    );
    show(
      h(
        "section",
        { class: "screen" },
        title(false),
        h(
          "div",
          { class: "notice" },
          h("p", {}, h("strong", {}, "はじめに読んでください")),
          h("ul", {}, texts.loginNotice.map((t) => h("li", {}, t))),
          h("label", { class: "check" }, check, " 上の注意を読みました")
        ),
        form,
        h("p", {}, btn("使い方と注意を読む", () => showHelp(() => showLogin()), "link"))
      )
    );
  }

  // ---- ホーム（レベルとシナリオ） ----

  function showHome() {
    disposeEngine();
    const counts = attempts();
    const levelBox = h("div", { class: "segmented" });
    const renderLevels = () =>
      clear(
        levelBox,
        Object.entries(data.levels).map(([id, lv]) =>
          h(
            "button",
            {
              class: "btn",
              type: "button",
              "aria-pressed": String(prefs.level === id),
              onclick: () => {
                prefs.level = id;
                savePrefs();
                showHome();
              },
            },
            lv.name_ja,
            h("small", {}, `英検${lv.eiken}`)
          )
        )
      );
    renderLevels();

    const sections = data.categories.map((cat) => {
      const list = data.scenarios.filter((s) => s.category === cat);
      if (!list.length) return null;
      return [
        h("h2", {}, cat),
        h(
          "div",
          { class: "cards" },
          list.map((s) =>
            h(
              "button",
              { class: "card-btn", type: "button", onclick: () => showPhrases(s) },
              h("strong", {}, s.title_ja),
              h("small", {}, s.title_en),
              h(
                "span",
                { class: "meta" },
                `${s.max_turns[prefs.level]}往復・約5分`,
                counts[s.id] ? h("span", { class: "tries" }, `挑戦 ${counts[s.id]}回`) : null
              )
            )
          )
        ),
      ];
    });

    show(
      h(
        "section",
        { class: "screen" },
        h(
          "header",
          { class: "bar" },
          title(true),
          h("nav", {}, btn("使い方", () => showHelp(showHome), "link"), btn("ログアウト", logout, "link"))
        ),
        h("h2", {}, "レベル"),
        levelBox,
        sections,
        limits?.dailyTurnsPerDevice
          ? h("p", { class: "hint" }, `AI とのやりとりは、1台につき1日${limits.dailyTurnsPerDevice}回までです。`)
          : null
      )
    );
  }

  function logout() {
    remove(KEYS.password);
    password = "";
    showLogin();
  }

  // ---- 今日のフレーズ ----

  function showPhrases(scenario) {
    const eng = newEngine(scenario);
    let active = null; // { index, result }
    const canListen = eng.canListen;

    async function stopActive() {
      const cur = active;
      if (!cur) return;
      active = null;
      cur.button.textContent = "🎤 言ってみる";
      cur.button.classList.remove("stop");
      let text = "";
      try {
        text = (await eng.stopListening()).text ?? "";
      } catch (err) {
        cur.result.textContent = err.message;
        return;
      }
      const p = scenario.key_phrases[cur.index];
      if (!text.trim()) cur.result.textContent = "聞き取れませんでした。もう一度どうぞ。";
      else if (phraseMatches(p.en, text)) clear(cur.result, h("strong", { class: "ok" }, "OK! 👍"), ` 「${text}」`);
      else clear(cur.result, "おしい！もう一度言ってみよう。", h("br"), h("small", {}, `聞き取った文：${text}`));
    }

    eng.onInterim?.((text) => {
      if (active) active.result.textContent = text;
    });
    eng.onAutoEnd?.(() => stopActive());

    const rows = scenario.key_phrases.map((p, index) => {
      const result = h("p", { class: "result", "aria-live": "polite" });
      const sayBtn = h("button", { class: "btn", type: "button" }, "🎤 言ってみる");
      sayBtn.addEventListener("click", async () => {
        if (active?.index === index) return stopActive();
        if (active) await stopActive();
        active = { index, result, button: sayBtn };
        sayBtn.textContent = "■ 止める";
        sayBtn.classList.add("stop");
        result.textContent = "聞いています…";
        try {
          await eng.startListening({ lang: "en" });
        } catch (err) {
          if (active?.index === index) active = null;
          sayBtn.textContent = "🎤 言ってみる";
          sayBtn.classList.remove("stop");
          result.textContent = err.message;
        }
      });
      return h(
        "li",
        { class: "card phrase" },
        h("p", { class: "en", lang: "en" }, p.en),
        h("p", { class: "ja" }, p.ja),
        h(
          "div",
          { class: "row" },
          btn("🔊 聞く", () => {
            if (active) stopActive();
            eng.speak(speakablePhrase(p.en));
          }),
          canListen ? sayBtn : null
        ),
        result
      );
    });

    show(
      h(
        "section",
        { class: "screen" },
        h("header", { class: "bar" }, btn("← もどる", showHome, "link")),
        h("h1", { class: "title small" }, scenario.title_ja),
        h("p", { class: "muted" }, scenario.setting_ja),
        h("h2", {}, "今日のフレーズ"),
        h("p", { class: "hint" }, canListen ? "聞いて、まねして言ってみよう。言わずに会話に進んでもかまいません。" : "聞いて、まねして言ってみよう。（この端末では音声認識が使えないので、会話はキーボードで入力します）"),
        h("ol", { class: "phrases" }, rows),
        btn("会話をはじめる", () => startRoleplay(scenario), "btn primary big")
      )
    );
    screenCleanup = () => eng.cancelListening?.();
  }

  // ---- ロールプレイ ----

  function startRoleplay(scenario) {
    const eng = newEngine(scenario);
    countAttempt(scenario.id);
    const rp = new Roleplay({
      engine: eng,
      scenario,
      prefs,
      savePrefs,
      showCost,
      onSummary: (conversation) => showSummary(scenario, conversation),
      onSupport: (message) => showSupport(message),
      onHome: showHome,
    });
    rp.el.append(h("p", { class: "hint reminder" }, texts.roleplayReminder));
    show(rp.el);
    screenCleanup = () => rp.stop();
    rp.begin();
  }

  // ---- ふりかえり ----

  function showSummary(scenario, conversation) {
    const eng = engine;
    const body = h("div", {}, h("p", { class: "loading-inline" }, "ふりかえりを作っています…"));
    show(
      h(
        "section",
        { class: "screen" },
        h("h1", { class: "title small" }, "ふりかえり"),
        h("p", { class: "muted" }, scenario.title_ja),
        body,
        h(
          "div",
          { class: "stack" },
          btn("もう一度挑戦", () => startRoleplay(scenario), "btn primary"),
          btn("別のシナリオへ", showHome)
        )
      )
    );

    async function run() {
      clear(body, h("p", { class: "loading-inline" }, "ふりかえりを作っています…"));
      try {
        const s = await eng.summary(conversation.history, { pronunciationNotes: [] });
        renderSummary(s);
      } catch (err) {
        clear(body, h("p", { class: "error" }, err.message), err.status === 429 ? null : btn("もう一度試す", run));
      }
    }

    function renderSummary(s) {
      const used = new Set(conversation.usedKeyPhrases);
      const say = (text) => h("button", { type: "button", class: "say", onclick: () => eng.speak(text) }, "🔊 ", text);
      clear(
        body,
        h(
          "div",
          { class: "card" },
          h("h2", {}, "できたこと"),
          h("ul", {}, (s.canDo.length ? s.canDo : ["最後まで英語で会話に挑戦できました。"]).map((t) => h("li", {}, t)))
        ),
        s.tryNext
          ? h(
              "div",
              { class: "card" },
              h("h2", {}, "次はこう言ってみよう"),
              s.tryNext.youSaid ? h("p", { class: "muted", lang: "en" }, "あなた：", s.tryNext.youSaid) : null,
              h("p", { class: "en", lang: "en" }, "→ ", say(s.tryNext.better)),
              h("p", {}, s.tryNext.whyJa)
            )
          : null,
        h(
          "div",
          { class: "card" },
          h("h2", {}, "今日のフレーズ"),
          h(
            "ul",
            { class: "checks" },
            scenario.key_phrases.map((p, i) => {
              const ok = s.keyPhrasesUsed[i] || used.has(i);
              return h("li", { class: ok ? "ok" : "" }, ok ? "✓ 使えた：" : "－ 次は使ってみよう：", h("span", { lang: "en" }, p.en));
            })
          )
        ),
        engineCaps().pronunciation && s.pronunciationTips?.length
          ? h("div", { class: "card" }, h("h2", {}, "発音のポイント"), h("ul", {}, s.pronunciationTips.map((t) => h("li", {}, t))))
          : null,
        s.encouragementJa ? h("p", { class: "encourage" }, s.encouragementJa) : null,
        s.privacyNoteJa ? h("p", { class: "notice" }, s.privacyNoteJa) : null,
        showCost ? h("p", { class: "hint" }, `費用の目安（この会話）：${eng.costJpy.toFixed(2)}円`) : null
      );
    }

    const engineCaps = () => eng.capabilities ?? {};
    run();
  }

  // ---- 相談先・使い方 ----

  function showSupport(message) {
    disposeEngine();
    const sp = texts.support;
    show(
      h(
        "section",
        { class: "screen support" },
        h("h1", { class: "title small" }, sp.title),
        h("p", { class: "notice" }, message || sp.defaultMessage),
        h("p", {}, sp.lead),
        h(
          "ul",
          { class: "contacts" },
          sp.contacts.map((c) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, c.name),
              c.tel ? h("p", { class: "tel" }, h("a", { href: `tel:${c.tel.replace(/[^0-9]/g, "")}` }, c.tel)) : null,
              c.hours ? h("p", {}, c.hours) : null,
              c.note ? h("p", { class: "hint" }, c.note) : null,
              c.url ? h("p", {}, h("a", { href: c.url, target: "_blank", rel: "noopener" }, c.urlLabel ?? c.url)) : null
            )
          )
        ),
        sp.emergency ? h("p", { class: "strong" }, sp.emergency) : null,
        sp.checked ? h("p", { class: "hint" }, sp.checked) : null,
        btn("ホームにもどる", showHome, "btn big")
      )
    );
  }

  function showHelp(back) {
    show(
      h(
        "section",
        { class: "screen help" },
        h("header", { class: "bar" }, btn("← もどる", back, "link")),
        h("h1", { class: "title small" }, "使い方と注意"),
        texts.help.map((sec) =>
          h(
            "div",
            { class: "card" },
            h("h2", {}, sec.title),
            sec.paragraphs?.map((t) => h("p", {}, t)),
            sec.items ? h(sec.ordered ? "ol" : "ul", {}, sec.items.map((t) => h("li", {}, t))) : null
          )
        ),
        btn("もどる", back, "btn big")
      )
    );
  }

  // ---- 起動 ----

  window.addEventListener("pagehide", disposeEngine);
  try {
    const res = await fetch(scenariosUrl);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    return show(h("p", { class: "error" }, "シナリオを読み込めませんでした。ページを読み込み直してください。"));
  }
  if (!data.levels[prefs.level]) prefs.level = Object.keys(data.levels)[0];

  const saved = load(KEYS.password);
  if (!saved) return showLogin();
  try {
    await login(saved);
    showHome();
  } catch (err) {
    if (err.status === 401 || err.status === 403) remove(KEYS.password);
    showLogin(err.message);
  }
}
