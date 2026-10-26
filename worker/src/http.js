// レスポンス・CORS・エラーの共通処理。利用者に返す文言は日本語。

export const MSG = {
  origin: "許可されていない接続元です。",
  method: "POST で送ってください。",
  notFound: "見つかりません。",
  badRequest: "リクエストの形式が正しくありません。",
  tooLarge: "データが大きすぎます。",
  password: "パスワードが正しくありません。",
  wrongApp: "このアプリでは使えないパスワードです。",
  forbidden: "このパスワードでは利用できない機能です。",
  limit: "今日の利用上限に達しました。また明日使ってください。",
  upstream: "AIの応答に失敗しました。もう一度試してください。",
  ja2enFailed: "英語の言い方を作れませんでした。もう一度試してください。",
  tooManyExchanges: "会話の往復数の上限に達しました。ふりかえりに進んでください。",
  notImplemented: "この機能はまだ準備中です。",
  serverConfig: "サーバーの設定が終わっていません。管理者に連絡してください。",
  server: "サーバーでエラーが起きました。もう一度試してください。",
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function errorJson(status, message, extra = {}, headers = {}) {
  return json({ ok: false, error: message, ...extra }, status, headers);
}

export function withHeaders(response, headers) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
