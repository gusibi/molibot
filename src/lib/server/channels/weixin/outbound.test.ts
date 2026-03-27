import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { sendWeixinFile } from "./outbound.js";
import { sendMessage } from "./sdk/api.js";

test("sendWeixinFile keeps voice replies as a single voice item without caption text", async () => {
  const fixturesDir = join(process.cwd(), "src/lib/server/channels/weixin/test-fixtures");
  const credentialsPath = join(fixturesDir, "credentials.json");
  const voicePath = join(fixturesDir, "reply.silk");

  const originalFetch = globalThis.fetch;
  const sendBodies: unknown[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.example.test/ilink/bot/getuploadurl") {
      return new Response(JSON.stringify({ ret: 0, upload_param: "upload-param-1" }), { status: 200 });
    }
    if (url.startsWith("https://cdn.example.test/upload?")) {
      return new Response("", {
        status: 200,
        headers: {
          "x-encrypted-param": "download-param-1"
        }
      });
    }
    if (url === "https://api.example.test/ilink/bot/sendmessage") {
      sendBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const result = await sendWeixinFile({
      filePath: voicePath,
      credentialsPath,
      toUserId: "wx-user-1",
      contextToken: "ctx-1",
      caption: "新冷笑话语音",
      cdnBaseUrl: "https://cdn.example.test"
    });

    assert.equal(result, "voice");
    assert.equal(sendBodies.length, 1);

    const payload = sendBodies[0] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          text_item?: { text?: string };
          voice_item?: { text?: string; media?: { encrypt_query_param?: string } };
        }>;
      };
    };
    const itemList = payload.msg?.item_list ?? [];
    assert.equal(itemList.length, 1);
    assert.equal(itemList[0]?.type, 3);
    assert.equal(itemList[0]?.text_item?.text, undefined);
    assert.equal(itemList[0]?.voice_item?.text, undefined);
    assert.equal(itemList[0]?.voice_item?.media?.encrypt_query_param, "download-param-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendMessage throws when weixin sendmessage returns a business error", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    ret: 1,
    errcode: 9001,
    errmsg: "voice rejected"
  }), { status: 200 });

  try {
    await assert.rejects(
      () => sendMessage("https://api.example.test", "token-1", {
        from_user_id: "",
        to_user_id: "wx-user-1",
        client_id: "client-1",
        message_type: 2,
        message_state: 2,
        context_token: "ctx-1",
        item_list: []
      }),
      /voice rejected/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
