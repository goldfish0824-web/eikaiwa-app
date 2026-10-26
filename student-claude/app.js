// 学生版 Claude版（高校生向け）。共通の画面（shared/student-core）に Claude のエンジンを渡して起動する。
// 18歳未満が使うため、ここから Gemini 用のエンジンを読み込まないこと（CLAUDE.md・spec/06_terms_safety.md）。
// ?mock=1 で開くと、API を使わない偽のエンジンで画面の流れを確かめられる（開発用。通常は読み込まれない）。
import { ClaudeEngine } from "../shared/engines/claude-engine.js";
import { startStudentApp } from "../shared/student-core/app.js";
import { TEXTS } from "./texts.js";

const MOCK = new URLSearchParams(location.search).has("mock");
const Engine = MOCK ? (await import("../shared/engines/mock-engine.js")).MockEngine : ClaudeEngine;

startStudentApp({
  root: document.getElementById("app"),
  app: "student-claude",
  Engine,
  texts: TEXTS,
  scenariosUrl: "../data/scenarios_hs.json",
  storagePrefix: "sc",
});
