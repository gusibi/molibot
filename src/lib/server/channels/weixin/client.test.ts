import test from "node:test";
import assert from "node:assert/strict";
import { WeixinBot } from "./client.js";

test("WeixinBot sendText splits long text into independent FINISH messages", async () => {
  const originalFetch = globalThis.fetch;
  const sendBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.example.test/ilink/bot/sendmessage") {
      sendBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const bot = new WeixinBot({ baseUrl: "https://api.example.test" }) as unknown as {
      credentials: { token: string; baseUrl: string; accountId: string; userId: string };
      sendText: (userId: string, text: string, contextToken: string) => Promise<void>;
    };
    bot.credentials = {
      token: "token-1",
      baseUrl: "https://api.example.test",
      accountId: "wx-account-1",
      userId: "wx-bot-1",
    };

    await bot.sendText("wx-user-1", "A".repeat(2_100), "ctx-1");

    assert.equal(sendBodies.length, 2);
    const firstMsg = (sendBodies[0]?.msg ?? {}) as Record<string, unknown>;
    const secondMsg = (sendBodies[1]?.msg ?? {}) as Record<string, unknown>;

    assert.notEqual(firstMsg.client_id, secondMsg.client_id);
    assert.equal(firstMsg.message_state, 2);
    assert.equal(secondMsg.message_state, 2);
    assert.equal(((firstMsg.item_list as Array<{ text_item?: { text?: string } }>)?.[0]?.text_item?.text ?? "").length, 2_000);
    assert.equal(((secondMsg.item_list as Array<{ text_item?: { text?: string } }>)?.[0]?.text_item?.text ?? "").length, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WeixinBot sendText throws when Weixin sendmessage business code is non-zero", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.example.test/ilink/bot/sendmessage") {
      return new Response(JSON.stringify({ ret: -1001, errmsg: "mock send failure" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const bot = new WeixinBot({ baseUrl: "https://api.example.test" }) as unknown as {
      credentials: { token: string; baseUrl: string; accountId: string; userId: string };
      sendText: (userId: string, text: string, contextToken: string) => Promise<void>;
    };
    bot.credentials = {
      token: "token-1",
      baseUrl: "https://api.example.test",
      accountId: "wx-account-1",
      userId: "wx-bot-1",
    };

    await assert.rejects(
      () => bot.sendText("wx-user-1", "hello", "ctx-1"),
      /sendMessage failed: code=-1001/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
