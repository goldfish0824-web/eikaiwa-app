// リアルタイム音声 API のアダプター層。
// 会話の制御（session.js）は、このクラスのメソッドとイベントだけを使う。
// ほかの会社のリアルタイム音声 API を試すときは、このクラスを継承したアダプターを追加する。
//
// プロパティ
//   inputSampleRate    sendAudio に渡す PCM のサンプルレート（Hz）
//   canResume          切断後に reconnect() で同じ会話を続けられるか
// メソッド
//   connect(info)      接続して、会話を始められる状態になったら resolve。info は /adv/token の応答
//   sendAudio(pcm)     マイクの PCM（Int16Array, inputSampleRate, モノラル）
//   sendControl(text)  制御メッセージ（[START] [WRAP_UP] [REPEAT] [NEXT]）
//   endAudioStream()   一時停止したとき。マイク入力が止まったことを伝える
//   reconnect()        切断後、同じ会話に再接続
//   close()
// イベント（detail に内容）
//   audio         { pcm: Int16Array, sampleRate }   AI の音声
//   interrupted   {}                               ユーザーが話し始めて AI の発話が止まった
//   turncomplete  {}                               AI の1回の発話が終わった
//   transcript    { speaker: "user" | "ai", text } 文字起こし（少しずつ届く）
//   usage         { ...トークン使用量 }
//   goaway        { timeLeft }                     まもなくサーバーから切断される
//   close         { expected, code, reason }       切断された（expected: こちらから閉じた）

export class RealtimeAdapter extends EventTarget {
  inputSampleRate = 16000;

  get canResume() {
    return false;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect() {
    throw new Error("not implemented");
  }
  sendAudio() {}
  sendControl() {}
  endAudioStream() {}
  async reconnect() {
    throw new Error("not implemented");
  }
  close() {}
}
