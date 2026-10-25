// localStorage の読み書き。プライベートブラウズなどで使えなくても動き続けるようにする。

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

// 端末ID（利用回数の端末ごとの集計だけに使う。個人の情報とは結びつけない）。
export function deviceId() {
  let id = load("eikaiwa.deviceId");
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID() : fallbackUuid();
    save("eikaiwa.deviceId", id);
  }
  return id;
}

function fallbackUuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("").replace(/(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");
}
