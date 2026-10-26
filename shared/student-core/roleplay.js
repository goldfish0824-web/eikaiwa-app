// ロールプレイ画面（spec/02_student_common.md「3.2 ロールプレイ」）。
// エンジンの共通インターフェース（spec/05_architecture.md「4.」）だけを使い、エンジン固有の処理は書かない。
import { Conversation } from "./conversation.js";
import { clear, h } from "./dom.js";
import { speakablePhrase } from "./phrase-match.js";

const MAX_CHARS = 300; // Worker の scMaxUtteranceChars と同じ

export class Roleplay {
  conversation = new Conversation();
  el;

  #engine;
  #scenario;
  #prefs;
  #savePrefs;
  #showCost;
  #on; // { summary(conversation), support(message), home() }
  #ui = {};
  #s = {
    busy: null, // "starting" | "sending" | "stopping"
    listening: null, // "en" | "ja"
    pending: null, // { text, lang } 送る前の確認中
    panel: null, // "hints" | "translation" | "ja2en"
    ja2en: null, // { stage: "ask" } | { stage: "result", ja, result }
    speaking: false,
    keyboard: false,
    micBlocked: false,
    limitReached: false,
    asking: false, // 「終了」の確認中
    note: "",
    error: "",
    retry: null,
    stopped: false,
  };
  #speakToken = 0;
  #onHidden = () => {
    if (document.visibilityState !== "hidden") return;
    if (this.#s.listening) this.#cancelListening();
    this.#engine.stopSpeaking();
  };

  constructor({ engine, scenario, prefs, savePrefs, showCost = false, onSummary, onSupport, onHome }) {
    this.#engine = engine;
    this.#scenario = scenario;
    this.#prefs = prefs;
    this.#savePrefs = savePrefs;
    this.#showCost = showCost;
    this.#on = { summary: onSummary, support: onSupport, home: onHome };
    this.#s.keyboard = !engine.canListen;
    this.#s.micBlocked = !engine.canListen;
    engine.onInterim?.((text) => (this.#ui.interim.textContent = text));
    engine.onAutoEnd?.(() => {
      if (this.#s.listening) this.#finishListening();
    });
    this.#build();
    document.addEventListener("visibilitychange", this.#onHidden);
  }

  // ---- 外から呼ぶもの ----

  async begin() {
    const s = this.#s;
    s.busy = "starting";
    s.error = "";
    this.#update();
    try {
      const turn = await this.#engine.start();
      if (s.stopped) return;
      s.busy = null;
      if (turn.safetyFlag === "support") return this.#support(turn.supportMessageJa);
      this.conversation.start(turn);
      this.#afterAiTurn();
    } catch (err) {
      if (s.stopped) return;
      s.busy = null;
      this.#fail(err, () => this.begin());
    }
  }

  stop() {
    this.#s.stopped = true;
    document.removeEventListener("visibilitychange", this.#onHidden);
    this.#engine.cancelListening?.();
    this.#engine.stopSpeaking();
  }

  // ---- 画面の組み立て ----

  #build() {
    const sc = this.#scenario;
    const ui = this.#ui;
    const row = (label, text) => [h("dt", {}, label), h("dd", {}, text)];

    ui.counter = h("span", { class: "counter" });
    ui.situation = h(
      "details",
      { class: "situation", open: true },
      h("summary", {}, "場面とゴール"),
      h("dl", {}, row("場面", sc.setting_ja), row("あなた", sc.user_role_ja), row("相手（AI）", sc.ai_role_ja), row("ゴール", sc.goal_ja))
    );
    ui.chips = h("ul", { class: "chips", "aria-label": "今日のフレーズ" });
    ui.log = h("ol", { class: "log" });
    ui.panel = h("div", { class: "panel", hidden: true });
    ui.exitBox = h(
      "div",
      { class: "box", hidden: true },
      h("p", {}, "ここで会話を終わりにしますか？"),
      (ui.exitSummary = h("button", { class: "btn primary", type: "button", onclick: () => this.#finish() }, "ふりかえりへ")),
      h("button", { class: "btn", type: "button", onclick: () => this.#goHome() }, "ふりかえりをしないでホームへ"),
      h("button", { class: "btn", type: "button", onclick: () => this.#setAsking(false) }, "会話をつづける")
    );
    ui.endBox = h(
      "div",
      { class: "box done", hidden: true },
      h("p", {}, "会話が終わりました。おつかれさま！"),
      h("button", { class: "btn primary big", type: "button", onclick: () => this.#finish() }, "ふりかえりを見る")
    );

    ui.status = h("p", { class: "status", "aria-live": "polite" });
    ui.interim = h("p", { class: "interim", "aria-live": "off" });
    ui.confirmText = h("textarea", { rows: 2, maxlength: MAX_CHARS, "aria-label": "聞き取った文（直せます）" });
    ui.confirm = h(
      "div",
      { class: "confirm", hidden: true },
      ui.confirmText,
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", type: "button", onclick: () => this.#redo() }, "言い直す"),
        h("button", { class: "btn primary", type: "button", onclick: () => this.#sendPending() }, "送る")
      )
    );
    ui.mic = h("button", { class: "mic", type: "button", onclick: () => this.#micTap() });
    ui.kbToggle = h("button", { class: "link small", type: "button", onclick: () => this.#toggleKeyboard() });
    ui.kbInput = h("input", { type: "text", maxlength: MAX_CHARS, autocomplete: "off", enterkeyhint: "send" });
    ui.kbSend = h("button", { class: "btn primary", type: "submit" }, "送る");
    ui.keyboard = h(
      "form",
      { class: "keyboard", hidden: true, onsubmit: (e) => (e.preventDefault(), this.#sendKeyboard()) },
      ui.kbInput,
      ui.kbSend
    );
    const aux = (label, onclick) => h("button", { class: "btn", type: "button", onclick }, label);
    ui.hintsBtn = aux("ヒント", () => this.#togglePanel("hints"));
    ui.jaBtn = aux("日本語で言う", () => this.#startJa2en());
    ui.slowBtn = aux("もう一度", () => this.#speakLast(true));
    ui.transBtn = aux("和訳", () => this.#togglePanel("translation"));
    ui.undoBtn = aux("やり直す", () => this.#undo());
    ui.capBtn = aux("", () => this.#toggleCaptions());
    ui.error = h("p", { class: "error", role: "alert" });
    ui.retry = h("button", { class: "btn", type: "button", hidden: true, onclick: () => this.#s.retry?.() }, "もう一度試す");

    this.el = h(
      "section",
      { class: "screen roleplay" },
      h(
        "header",
        { class: "bar" },
        h("button", { class: "link", type: "button", onclick: () => this.#setAsking(true) }, "← 終了"),
        ui.counter
      ),
      h("h1", { class: "title small" }, sc.title_ja),
      ui.situation,
      ui.chips,
      ui.log,
      ui.exitBox,
      ui.endBox,
      (ui.dock = h(
        "div",
        { class: "dock" },
        ui.panel,
        ui.status,
        ui.interim,
        ui.error,
        ui.retry,
        ui.confirm,
        (ui.micRow = h("div", { class: "mic-row" }, ui.mic, ui.kbToggle)),
        ui.keyboard,
        h("div", { class: "aux" }, ui.hintsBtn, ui.jaBtn, ui.slowBtn, ui.transBtn, ui.undoBtn, ui.capBtn)
      ))
    );
    this.#renderChips();
    this.#update();
  }

  #renderChips() {
    const used = new Set(this.conversation.usedKeyPhrases);
    clear(
      this.#ui.chips,
      this.#scenario.key_phrases.map((p, i) =>
        h(
          "li",
          {},
          h(
            "button",
            { type: "button", class: used.has(i) ? "chip used" : "chip", onclick: () => this.#speak(speakablePhrase(p.en)) },
            used.has(i) ? "✓ " : "",
            p.en
          )
        )
      )
    );
  }

  #renderLog() {
    const captions = this.#prefs.captions;
    const items = this.conversation.entries.map((e) =>
      e.role === "ai"
        ? h(
            "li",
            { class: "ai" },
            h("span", { class: "who" }, "AI"),
            h(
              "button",
              { type: "button", class: "say", onclick: () => this.#speak(e.text), "aria-label": captions ? null : "AI の発言をもう一度聞く" },
              captions ? e.text : "🔊 字幕オフ（タップでもう一度聞く）"
            )
          )
        : h("li", { class: "student" }, h("span", { class: "who" }, "あなた"), h("span", {}, e.text))
    );
    clear(this.#ui.log, items);
  }

  // 最新の発言と操作ボタンが見えるようにする
  #scrollToDock() {
    this.#ui.dock.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }

  #renderPanel() {
    const { panel, ja2en } = this.#s;
    const ui = this.#ui;
    ui.panel.hidden = !panel;
    if (!panel) return;
    const last = this.conversation.lastAi;
    const close = h("button", { class: "link small close", type: "button", onclick: () => this.#closePanel() }, "閉じる");
    if (panel === "hints") {
      const hints = last?.hints ?? [];
      clear(
        ui.panel,
        h("div", { class: "panel-head" }, h("strong", {}, "ヒント（タップで聞けます）"), close),
        hints.length
          ? h("ul", { class: "hints" }, hints.map((t) => h("li", {}, h("button", { type: "button", class: "say", onclick: () => this.#speak(t) }, "🔊 ", t))))
          : h("p", { class: "hint" }, "このターンのヒントはありません。和訳を見て考えてみよう。")
      );
    } else if (panel === "translation") {
      clear(
        ui.panel,
        h("div", { class: "panel-head" }, h("strong", {}, "AI の発言の和訳"), close),
        h("p", {}, last?.ja || "和訳はありません。")
      );
    } else if (ja2en?.stage === "ask") {
      clear(
        ui.panel,
        h("div", { class: "panel-head" }, h("strong", {}, "日本語で言う"), close),
        h("p", {}, this.#s.keyboard ? "言いたいことを日本語で入力してね。英語の言い方を教えます。" : "言いたいことを日本語で話してね。英語の言い方を教えます。")
      );
    } else {
      const r = ja2en.result;
      const sayBtn = (text) => h("button", { type: "button", class: "say", onclick: () => this.#speak(text) }, "🔊 ", text);
      clear(
        ui.panel,
        h("div", { class: "panel-head" }, h("strong", {}, "英語ではこう言えます"), close),
        h("p", { class: "muted" }, "「", ja2en.ja, "」"),
        h("p", { class: "en" }, sayBtn(r.en)),
        r.enSimple && r.enSimple !== r.en ? h("p", {}, h("small", {}, "もっとかんたんに："), sayBtn(r.enSimple)) : null,
        r.tipJa ? h("p", { class: "hint" }, r.tipJa) : null,
        h("p", { class: "strong" }, "まねして、英語で言ってみよう！")
      );
    }
  }

  #update() {
    const s = this.#s;
    const ui = this.#ui;
    const c = this.conversation;
    const started = c.entries.length > 0;
    const ended = started && c.ended;
    const idle = !s.busy && !s.listening;
    const jaAsk = s.ja2en?.stage === "ask";
    const canTalk = started && !ended && !s.limitReached && !s.asking;

    ui.counter.textContent =
      (started && c.maxTurns ? `${c.exchanges} / ${c.maxTurns}往復` : "") +
      (this.#showCost ? `　費用の目安 ${this.#engine.costJpy.toFixed(2)}円` : "");

    ui.status.textContent =
      s.busy === "starting"
        ? "AI が最初の一言を準備しています…"
        : s.busy === "sending"
          ? "AI が考えています…"
          : s.busy === "stopping"
            ? "聞き取った文を確かめています…"
            : s.listening === "ja"
              ? "日本語でどうぞ。話し終わったら、もう一度押してね"
              : s.listening
                ? "聞いています。話し終わったら、もう一度押してね（少し黙っても止まります）"
                : !canTalk
                  ? ""
                  : s.pending
                    ? "この文で送りますか？ まちがっていたら直してから送れます"
                    : s.speaking
                      ? "AI が話しています（マイクを押すと止めて話せます）"
                      : s.note ||
                        (jaAsk
                          ? s.keyboard
                            ? "日本語で入力して「送る」を押してね"
                            : "マイクを押して、日本語で話してね"
                          : s.keyboard
                            ? "英語で入力して「送る」を押してね"
                            : "マイクを押して、英語で答えてみよう");
    if (!s.listening) ui.interim.textContent = "";

    ui.error.textContent = s.error;
    ui.retry.hidden = !s.retry || Boolean(s.busy);

    ui.confirm.hidden = !s.pending || !canTalk;
    ui.micRow.hidden = !canTalk;
    ui.mic.hidden = s.keyboard || !canTalk || Boolean(s.pending);
    ui.mic.disabled = Boolean(s.busy);
    ui.mic.className = s.listening ? "mic stop" : s.busy ? "mic busy" : "mic";
    ui.mic.textContent = s.listening ? "■ 止める" : s.busy ? "…" : jaAsk ? "🎤 日本語で話す" : "🎤 話す";
    ui.kbToggle.hidden = s.micBlocked || !canTalk || Boolean(s.pending) || Boolean(s.listening);
    ui.kbToggle.textContent = s.keyboard ? "🎤 マイクで話す" : "⌨ キーボードで入力";
    ui.keyboard.hidden = !s.keyboard || !canTalk;
    ui.kbInput.placeholder = jaAsk ? "日本語で入力" : "英語で入力";
    ui.kbInput.lang = jaAsk ? "ja" : "en";
    ui.kbSend.disabled = Boolean(s.busy);

    ui.hintsBtn.disabled = !started || ended || !idle;
    ui.jaBtn.disabled = !canTalk || !idle;
    ui.slowBtn.disabled = !started || !idle;
    ui.transBtn.disabled = !started || !idle;
    ui.undoBtn.disabled = !c.canUndo || !idle || s.asking;
    ui.capBtn.textContent = this.#prefs.captions ? "字幕 オン" : "字幕 オフ";
    ui.capBtn.setAttribute("aria-pressed", String(this.#prefs.captions));
    for (const [btn, name] of [
      [ui.hintsBtn, "hints"],
      [ui.transBtn, "translation"],
      [ui.jaBtn, "ja2en"],
    ])
      btn.setAttribute("aria-pressed", String(s.panel === name));

    ui.exitBox.hidden = !s.asking;
    ui.exitSummary.hidden = c.exchanges < 1;
    ui.endBox.hidden = !ended || s.asking;
  }

  // ---- 話す・送る ----

  async #micTap() {
    const s = this.#s;
    if (s.listening) return this.#finishListening();
    if (s.busy) return;
    this.#startListening(s.ja2en?.stage === "ask" ? "ja" : "en");
  }

  async #startListening(lang) {
    const s = this.#s;
    s.pending = null;
    s.note = "";
    this.#clearError();
    s.listening = lang;
    this.#ui.interim.textContent = "";
    this.#update();
    // iOS 対策：音声の準備と認識の開始は、タップの処理の中で（await をはさまずに）行う
    Promise.resolve(this.#engine.init?.()).catch(() => {});
    try {
      await this.#engine.startListening({ lang });
    } catch (err) {
      if (s.listening !== lang) return;
      s.listening = null;
      if (err.code === "denied" || err.code === "unsupported") {
        s.micBlocked = true;
        s.keyboard = true;
      }
      s.error = err.message || "マイクを使えませんでした。キーボードで入力してください。";
      this.#renderPanel();
      this.#update();
    }
  }

  async #finishListening() {
    const s = this.#s;
    const lang = s.listening;
    s.listening = null;
    s.busy = "stopping";
    this.#update();
    let utterance = null;
    try {
      utterance = await this.#engine.stopListening();
    } catch (err) {
      s.error = err.message;
    }
    s.busy = null;
    if (s.stopped) return;
    if (utterance?.kind === "text" || !utterance) {
      const text = (utterance?.text ?? "").trim().slice(0, MAX_CHARS);
      if (!text) {
        s.note = "聞き取れませんでした。もう一度話すか、キーボードで入力してね。";
        return this.#update();
      }
      if (this.#engine.capabilities.confirmBeforeSend) {
        s.pending = { text, lang };
        this.#ui.confirmText.value = text;
        return this.#update();
      }
      return lang === "ja" ? this.#askJa2en({ kind: "text", text }) : this.#reply({ kind: "text", text });
    }
    // 音声のまま送るエンジン（Gemini版）
    return lang === "ja" ? this.#askJa2en(utterance) : this.#reply(utterance);
  }

  #cancelListening() {
    this.#s.listening = null;
    this.#engine.cancelListening?.();
    this.#update();
  }

  #redo() {
    const lang = this.#s.pending?.lang ?? "en";
    this.#s.pending = null;
    this.#startListening(lang);
  }

  #sendPending() {
    const s = this.#s;
    const text = this.#ui.confirmText.value.trim().slice(0, MAX_CHARS);
    if (!text || s.busy) return;
    const lang = s.pending?.lang ?? "en";
    return lang === "ja" ? this.#askJa2en({ kind: "text", text }) : this.#reply({ kind: "text", text });
  }

  async #sendKeyboard() {
    const s = this.#s;
    const text = this.#ui.kbInput.value.trim().slice(0, MAX_CHARS);
    if (!text || s.busy) return;
    Promise.resolve(this.#engine.init?.()).catch(() => {});
    const ok = s.ja2en?.stage === "ask" ? await this.#askJa2en({ kind: "text", text }) : await this.#reply({ kind: "text", text });
    if (ok) this.#ui.kbInput.value = "";
  }

  async #reply(utterance) {
    const s = this.#s;
    s.busy = "sending";
    s.note = "";
    this.#clearError();
    this.#update();
    try {
      const turn = await this.#engine.reply(utterance, { history: this.conversation.history });
      if (s.stopped) return false;
      s.busy = null;
      s.pending = null;
      if (turn.safetyFlag === "support") {
        this.#support(turn.supportMessageJa);
        return true;
      }
      const said = utterance.kind === "text" ? utterance.text : turn.userTranscript;
      this.conversation.add(said, turn);
      s.panel = null;
      s.ja2en = null;
      if (this.conversation.exchanges === 1) this.#ui.situation.open = false;
      this.#afterAiTurn();
      return true;
    } catch (err) {
      if (s.stopped) return false;
      s.busy = null;
      this.#fail(err, s.pending ? () => this.#sendPending() : null);
      return false;
    }
  }

  async #askJa2en(utterance) {
    const s = this.#s;
    s.busy = "sending";
    s.note = "";
    this.#clearError();
    this.#update();
    try {
      const result = await this.#engine.ja2en(utterance, { history: this.conversation.history });
      if (s.stopped) return false;
      s.busy = null;
      s.pending = null;
      if (result.safetyFlag === "support") {
        this.#support(result.supportMessageJa);
        return true;
      }
      const ja = utterance.kind === "text" ? utterance.text : result.userTranscript ?? "";
      s.ja2en = { stage: "result", ja, result };
      s.panel = "ja2en";
      this.#renderPanel();
      this.#update();
      this.#scrollToDock();
      this.#speak(result.en);
      return true;
    } catch (err) {
      if (s.stopped) return false;
      s.busy = null;
      this.#fail(err, s.pending ? () => this.#sendPending() : null);
      return false;
    }
  }

  #afterAiTurn() {
    this.#renderLog();
    this.#renderChips();
    this.#renderPanel();
    this.#update();
    this.#scrollToDock();
    const last = this.conversation.lastAi;
    if (last) this.#speak(last.text);
  }

  async #speak(text, opts = {}) {
    if (!text || this.#s.listening) return;
    const token = ++this.#speakToken;
    this.#s.speaking = true;
    this.#update();
    try {
      await this.#engine.speak(text, opts);
    } catch {}
    if (token !== this.#speakToken || this.#s.stopped) return;
    this.#s.speaking = false;
    this.#update();
  }

  #speakLast(slow) {
    const last = this.conversation.lastAi;
    if (last) this.#speak(last.text, { slow });
  }

  // ---- 補助ボタン ----

  #togglePanel(name) {
    const s = this.#s;
    this.#leaveJa2en();
    s.panel = s.panel === name ? null : name;
    this.#renderPanel();
    this.#update();
    if (s.panel) this.#scrollToDock();
  }

  #closePanel() {
    this.#leaveJa2en();
    this.#s.panel = null;
    this.#renderPanel();
    this.#update();
  }

  // 「日本語で言う」をやめる（日本語の確認中の文も捨てる）
  #leaveJa2en() {
    const s = this.#s;
    s.ja2en = null;
    if (s.pending?.lang === "ja") s.pending = null;
  }

  #startJa2en() {
    const s = this.#s;
    if (s.panel === "ja2en" && s.ja2en?.stage === "ask") return this.#closePanel();
    s.panel = "ja2en";
    s.ja2en = { stage: "ask" };
    s.pending = null;
    this.#renderPanel();
    this.#update();
    this.#scrollToDock();
    if (s.keyboard) this.#ui.kbInput.focus();
    else this.#startListening("ja");
  }

  #undo() {
    const s = this.#s;
    if (s.busy || s.listening) return;
    this.#engine.stopSpeaking();
    const said = this.conversation.undo();
    if (said === null) return;
    s.pending = null;
    s.panel = null;
    s.ja2en = null;
    s.note = "直前のやりとりを取り消しました。もう一度言ってみよう。";
    if (s.keyboard) this.#ui.kbInput.value = said;
    this.#renderLog();
    this.#renderChips();
    this.#renderPanel();
    this.#update();
  }

  #toggleCaptions() {
    this.#prefs.captions = !this.#prefs.captions;
    this.#savePrefs();
    this.#renderLog();
    this.#update();
  }

  #toggleKeyboard() {
    const s = this.#s;
    s.keyboard = !s.keyboard;
    s.note = "";
    this.#renderPanel();
    this.#update();
    if (s.keyboard) this.#ui.kbInput.focus();
  }

  // ---- 終わり方 ----

  #setAsking(on) {
    const s = this.#s;
    if (on) {
      if (s.listening) this.#cancelListening();
      this.#engine.stopSpeaking();
      if (this.conversation.entries.length === 0 && !s.busy) return this.#goHome();
    }
    s.asking = on;
    this.#update();
    if (on) this.#ui.exitBox.scrollIntoView?.({ block: "center" });
  }

  #finish() {
    this.stop();
    this.#on.summary(this.conversation);
  }

  #goHome() {
    this.stop();
    this.#on.home();
  }

  #support(message) {
    this.stop();
    this.#on.support(message);
  }

  #fail(err, retry) {
    const s = this.#s;
    s.error = err?.message || "エラーが起きました。もう一度試してください。";
    if (err?.status === 429) {
      s.limitReached = true;
      s.retry = null;
    } else {
      s.retry = retry;
    }
    this.#update();
  }

  #clearError() {
    this.#s.error = "";
    this.#s.retry = null;
  }
}
