import test from "node:test";
import assert from "node:assert/strict";
import { sendMedia } from "./outbound.js";
import type { ResolvedQQBotAccount } from "./types.js";

const account: ResolvedQQBotAccount = {
  accountId: "qq-test",
  enabled: true,
  appId: "app-1",
  clientSecret: "secret-1",
  secretSource: "config",
  markdownSupport: false,
  config: {}
};

test("sendMedia routes remote mp3 URLs through QQ voice media upload", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: any }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const rawBody = init?.body ? String(init.body) : undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({ url, body });

    if (url === "https://bots.qq.com/app/getAppAccessToken") {
      return new Response(JSON.stringify({ access_token: "token-1", expires_in: 7200 }), { status: 200 });
    }
    if (url === "https://api.sgroup.qq.com/v2/users/user-1/files") {
      return new Response(JSON.stringify({ file_info: "voice-file-info", file_uuid: "file-1", ttl: 300 }), { status: 200 });
    }
    if (url === "https://api.sgroup.qq.com/v2/users/user-1/messages") {
      return new Response(JSON.stringify({ id: "msg-1", timestamp: 1234567890 }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const result = await sendMedia({
      to: "qqbot:c2c:user-1",
      text: "语音说明",
      mediaUrl: "https://cdn.example.com/audio/reply.mp3?sig=abc",
      account
    });

    assert.equal(result.error, undefined);
    const uploadRequest = requests.find((entry) => entry.url.endsWith("/v2/users/user-1/files"));
    assert.ok(uploadRequest);
    assert.equal(uploadRequest?.body?.file_type, 3);
    assert.equal(uploadRequest?.body?.url, "https://cdn.example.com/audio/reply.mp3?sig=abc");

    const messageRequests = requests.filter((entry) => entry.url.endsWith("/v2/users/user-1/messages"));
    assert.equal(messageRequests.length, 2);
    assert.equal(messageRequests[0]?.body?.msg_type, 7);
    assert.equal(messageRequests[0]?.body?.media?.file_info, "voice-file-info");
    assert.equal(messageRequests[1]?.body?.content, "语音说明");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendMedia routes remote aiff URLs through QQ voice media upload", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: any }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const rawBody = init?.body ? String(init.body) : undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({ url, body });

    if (url === "https://bots.qq.com/app/getAppAccessToken") {
      return new Response(JSON.stringify({ access_token: "token-1", expires_in: 7200 }), { status: 200 });
    }
    if (url === "https://api.sgroup.qq.com/v2/users/user-2/files") {
      return new Response(JSON.stringify({ file_info: "voice-file-info-aiff", file_uuid: "file-2", ttl: 300 }), { status: 200 });
    }
    if (url === "https://api.sgroup.qq.com/v2/users/user-2/messages") {
      return new Response(JSON.stringify({ id: "msg-2", timestamp: 1234567891 }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const result = await sendMedia({
      to: "qqbot:c2c:user-2",
      text: "AIFF语音说明",
      mediaUrl: "https://cdn.example.com/audio/reply.aiff?sig=def",
      account
    });

    assert.equal(result.error, undefined);
    const uploadRequest = requests.find((entry) => entry.url.endsWith("/v2/users/user-2/files"));
    assert.ok(uploadRequest);
    assert.equal(uploadRequest?.body?.file_type, 3);
    assert.equal(uploadRequest?.body?.url, "https://cdn.example.com/audio/reply.aiff?sig=def");

    const messageRequests = requests.filter((entry) => entry.url.endsWith("/v2/users/user-2/messages"));
    assert.equal(messageRequests.length, 2);
    assert.equal(messageRequests[0]?.body?.msg_type, 7);
    assert.equal(messageRequests[0]?.body?.media?.file_info, "voice-file-info-aiff");
    assert.equal(messageRequests[1]?.body?.content, "AIFF语音说明");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
