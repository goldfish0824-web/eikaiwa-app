// 画面を組み立てる小さな道具。文字は textContent で入れる（AI の返答を HTML として扱わない）。
//   h("button", { class: "btn", onclick: fn }, "送る")

const PROPS = new Set(["value", "checked", "disabled", "hidden", "open"]);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el, ...children) {
  el.textContent = "";
  return append(el, children);
}
