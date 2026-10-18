import test from "node:test";
import assert from "node:assert/strict";
import { isAudioSource, isNativeQqVoiceFormat, sendQqVoice } from "./voice.js";
import type { ResolvedQQBotAccount } from "#qqbot/src/types.js";

const account: ResolvedQQBotAccount = {
  accountId: "qq-test",
  enabled: true,
  appId: "",
  clientSecret: "",
  secretSource: "none",
  markdownSupport: false,
  config: {},
};

test("isNativeQqVoiceFormat: wav/mp3/silk extensions pass, others need SILK magic", () => {
  assert.equal(isNativeQqVoiceFormat("/tmp/a.wav"), true);
  assert.equal(isNativeQqVoiceFormat("/tmp/a.mp3"), true);
  assert.equal(isNativeQqVoiceFormat("/tmp/a.silk"), true);

  assert.equal(isNativeQqVoiceFormat("/tmp/a.ogg"), false);
  // ogg 扩展名但文件头是 SILK → 仍可直传
  assert.equal(isNativeQqVoiceFormat("/tmp/a.ogg", Buffer.from("#!SILK_V3\0\0")), true);
  assert.equal(isNativeQqVoiceFormat("/tmp/a.ogg", Buffer.from("OggS\0\0\0\0")), false);
});

test("isAudioSource: MIME first, then extension; documents are not audio", () => {
  assert.equal(isAudioSource("/x/file", "audio/ogg"), true);
  assert.equal(isAudioSource("/x/voice.opus"), true);
  assert.equal(isAudioSource("/x/voice.silk"), true);
  assert.equal(isAudioSource("/x/report.md"), false);
  assert.equal(isAudioSource("/x/report.pdf", "application/pdf"), false);
});

test("sendQqVoice falls back to file send when the source cannot be read or converted", async () => {
  // 无凭证账户 + 不存在的文件：转码前置的读取失败 → 走文件降级路径，
  // 文件路径最终因缺少凭证在触网前返回错误，证明降级链路被走到。
  const result = await sendQqVoice({
    account,
    to: "user-1",
    filePath: "/nonexistent/voice.opus",
    replyToId: null,
    text: "hi"
  });

  assert.equal(result.channel, "qqbot");
  assert.match(result.error ?? "", /missing appId or clientSecret/);
});
