import test from "node:test";
import assert from "node:assert/strict";

import { buildBaseInfo, getUpdates, notifyStart, sanitizeBotAgent, sendMessage } from "./api.js";

test("sanitizeBotAgent keeps valid UA-style tokens and drops invalid tokens", () => {
  assert.equal(sanitizeBotAgent("MyBot/1.2.0"), "MyBot/1.2.0");
  assert.equal(
    sanitizeBotAgent("bad-token MyBot/1.2.0 (region=cn; env=prod) 中文/1"),
    "MyBot/1.2.0 (region=cn; env=prod)",
  );
  assert.equal(sanitizeBotAgent("中文"), "OpenClaw");
});

test("buildBaseInfo includes sanitized bot_agent", () => {
  const info = buildBaseInfo("MyBot/1.2.0 invalid");
  assert.equal(info.bot_agent, "MyBot/1.2.0");
  assert.equal(typeof info.channel_version, "string");
});

test("sendMessage throws when Weixin business ret is non-zero", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/ilink/bot/sendmessage")) {
      return new Response(JSON.stringify({ ret: -1001, errmsg: "mock send failure" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    await assert.rejects(
      () => sendMessage({
        baseUrl: "https://api.example.test",
        token: "token-1",
        body: {
          msg: {
            from_user_id: "",
            to_user_id: "wx-user-1",
            client_id: "client-1",
            message_type: 2,
            message_state: 2,
            context_token: "ctx-1",
            item_list: [{ type: 1, text_item: { text: "hello" } }]
          }
        }
      }),
      /sendMessage failed: code=-1001/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getUpdates returns empty success payload when externally aborted", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        (err as Error & { name: string }).name = "AbortError";
        reject(err);
      }, { once: true });
    });
  };

  try {
    const externalController = new AbortController();
    setTimeout(() => externalController.abort(), 20);
    const started = Date.now();

    const resp = await getUpdates({
      baseUrl: "https://api.example.test",
      token: "token-1",
      get_updates_buf: "cursor-1",
      timeoutMs: 5_000,
      abortSignal: externalController.signal
    });

    const elapsed = Date.now() - started;
    assert.ok(elapsed < 500, `expected abort to resolve quickly, elapsed=${elapsed}ms`);
    assert.equal(resp.ret, 0);
    assert.deepEqual(resp.msgs, []);
    assert.equal(resp.get_updates_buf, "cursor-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notifyStart posts lifecycle notification with bot_agent", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  };

  try {
    await notifyStart({
      baseUrl: "https://api.example.test",
      token: "token-1",
      botAgent: "MoliBot/1.5.0",
    });
    assert.equal(capturedUrl, "https://api.example.test/ilink/bot/msg/notifystart");
    assert.equal(JSON.parse(capturedBody).base_info.bot_agent, "MoliBot/1.5.0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
