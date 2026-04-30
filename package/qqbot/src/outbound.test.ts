import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEDIA_SEND_ERROR,
  OUTBOUND_ERROR_CODES,
  resolveUserFacingMediaError,
  sendMedia,
} from "./outbound.js";
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
