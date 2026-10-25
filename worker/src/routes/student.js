// 学生版のエンドポイント。
//   /sc/*: 学生版 Claude版（高校生）… Claude API だけを使う（フェーズ4で実装）
//   /sg/*: 学生版 Gemini版（18歳以上）… Gemini API を使う（フェーズ6で実装）
// どちらも、アプリ種別のチェック（index.js の ROUTES）を通ったリクエストだけがここに届く。
import { HttpError, MSG } from "../http.js";

export async function notImplemented() {
  throw new HttpError(501, MSG.notImplemented);
}
