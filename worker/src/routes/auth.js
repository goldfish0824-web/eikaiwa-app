// POST /auth  入力: { password, app }  出力: { ok, passwordId, app, limits }
// パスワードの種類と、ログインしようとしているアプリが一致しなければ拒否する。
import { APPS, CONFIG } from "../../config.js";
import { HttpError, MSG, json } from "../http.js";
import { advUsage } from "./adv.js";

export async function handleAuth({ env, auth, body, now }) {
  if (!APPS.includes(body.app)) throw new HttpError(400, MSG.badRequest);
  if (auth.app !== body.app) throw new HttpError(403, MSG.wrongApp);

  let limits;
  if (auth.app === "advanced") {
    limits = {
      ...(await advUsage(env, auth, now)),
      sessionMinutesOptions: CONFIG.sessionMinutesOptions,
      maxSessionMinutes: CONFIG.maxSessionMinutes,
    };
  } else {
    const d = CONFIG.defaultLimits[auth.app];
    limits = { dailyTurnsPerDevice: auth.dailyTurnsPerDevice ?? d.dailyTurnsPerDevice };
  }
  return json({ ok: true, passwordId: auth.id, app: auth.app, limits });
}
