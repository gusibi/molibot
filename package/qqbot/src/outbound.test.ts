import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEDIA_SEND_ERROR,
  OUTBOUND_ERROR_CODES,
  inferMediaFileType,
  parseTarget,
  resolveProactiveMode,
  resolveUserFacingMediaError,
  sendMedia,
  sendText,
  sendTextWithKeyboard,
} from "./outbound.js";
import { MediaFileType } from "./api.js";
import type { ResolvedQQBotAccount } from "./types.js";

const account: ResolvedQQBotAccount = {
  accountId: "qq-test",
  enabled: true,
  appId: "",
  clientSecret: "",
  secretSource: "none",
  markdownSupport: false,
  config: {},
};

test("sendMedia reports missing credentials before touching network", async () => {
  const result = await sendMedia({
    to: "qqbot:c2c:user-1",
    text: "",
    mediaUrl: "https://cdn.example.com/audio/reply.mp3",
    account,
  });

  assert.equal(result.channel, "qqbot");
  assert.match(result.error ?? "", /missing appId or clientSecret/);
});

test("sendText reports missing credentials before touching network", async () => {
  const result = await sendText({ to: "user-1", text: "hello", account });

  assert.equal(result.channel, "qqbot");
  assert.match(result.error ?? "", /missing appId or clientSecret/);
});

test("media errors expose only stable user-facing messages", () => {
  assert.equal(
    resolveUserFacingMediaError({ error: "internal upload stack" }),
    DEFAULT_MEDIA_SEND_ERROR,
  );
  assert.equal(
    resolveUserFacingMediaError({
      error: "文件超过 QQ Bot 限制",
      errorCode: OUTBOUND_ERROR_CODES.FILE_TOO_LARGE,
    }),
    "文件超过 QQ Bot 限制",
  );
});

test("parseTarget accepts all historical address formats", () => {
  assert.deepEqual(parseTarget("user-1"), { type: "c2c", id: "user-1" });
  assert.deepEqual(parseTarget("c2c:user-1"), { type: "c2c", id: "user-1" });
  assert.deepEqual(parseTarget("qqbot:c2c:user-1"), { type: "c2c", id: "user-1" });
  assert.deepEqual(parseTarget("group:ABC123"), { type: "group", id: "ABC123" });
  assert.deepEqual(parseTarget("channel:CH1"), { type: "channel", id: "CH1" });

  assert.throws(() => parseTarget("c2c:"), /missing user ID/);
  assert.throws(() => parseTarget("qqbot:"));
});

test("inferMediaFileType routes by MIME first, then extension", () => {
  assert.equal(inferMediaFileType("https://x.com/a", "image/png"), MediaFileType.IMAGE);
  assert.equal(inferMediaFileType("https://x.com/a", "video/mp4"), MediaFileType.VIDEO);
  assert.equal(inferMediaFileType("https://x.com/a", "audio/ogg"), MediaFileType.VOICE);

  assert.equal(inferMediaFileType("/tmp/plot.png"), MediaFileType.IMAGE);
  assert.equal(inferMediaFileType("/tmp/clip.mov?query=1"), MediaFileType.VIDEO);
  assert.equal(inferMediaFileType("/tmp/voice.silk"), MediaFileType.VOICE);
  // 未知扩展名（如 agent 生成的文档）必须走文件通道而不是媒体通道
  assert.equal(inferMediaFileType("/workspace/report.md"), MediaFileType.FILE);
  assert.equal(inferMediaFileType("/workspace/数据.pdf"), MediaFileType.FILE);
});

test("resolveProactiveMode: passive with msgId, wakeup for c2c pushes, proactive for groups", () => {
  assert.equal(resolveProactiveMode(parseTarget("user-1"), "msg-1"), "passive");
  assert.equal(resolveProactiveMode(parseTarget("c2c:user-1"), null), "wakeup");
  assert.equal(resolveProactiveMode(parseTarget("group:g1"), null), "proactive");
  assert.equal(resolveProactiveMode(parseTarget("group:g1"), "msg-1"), "passive");
});

test("sendTextWithKeyboard reports missing credentials before touching network", async () => {
  const result = await sendTextWithKeyboard({
    to: "user-1",
    text: "请审批",
    account,
    keyboard: { content: { rows: [] } },
  });

  assert.equal(result.channel, "qqbot");
  assert.match(result.error ?? "", /missing appId or clientSecret/);
});
