import test from "node:test";
import assert from "node:assert/strict";
import { sendWeixinFile } from "./outbound.js";

test("sendWeixinFile sends audio replies as text plus mp3 file attachment", async () => {
  const voicePath = `${process.cwd()}/src/lib/server/channels/weixin/test-fixtures/reply.mp3`;

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
      toUserId: "wx-user-1",
      contextToken: "ctx-1",
      caption: "新冷笑话语音",
      text: "给你讲个超可爱的小笑话哦，小企鹅问妈妈：我真的是企鹅吗？",
      baseUrlOverride: "https://api.example.test",
      cdnBaseUrl: "https://cdn.example.test"
    });

    assert.equal(result, "file");
    assert.equal(sendBodies.length, 2);

    const textPayload = sendBodies[0] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          text_item?: { text?: string };
          file_item?: { file_name?: string; aeskey?: string; media?: { encrypt_query_param?: string } };
        }>;
      };
    };
    const filePayload = sendBodies[1] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          text_item?: { text?: string };
          file_item?: { file_name?: string; aeskey?: string; media?: { encrypt_query_param?: string } };
        }>;
      };
    };

    const textItems = textPayload.msg?.item_list ?? [];
    assert.equal(textItems.length, 1);
    assert.equal(textItems[0]?.type, 1);
    assert.equal(textItems[0]?.text_item?.text, "给你讲个超可爱的小笑话哦，小企鹅问妈妈：我真的是企鹅吗？");

    const fileItems = filePayload.msg?.item_list ?? [];
    assert.equal(fileItems.length, 1);
    assert.equal(fileItems[0]?.type, 4);
    assert.equal(fileItems[0]?.text_item?.text, undefined);
    assert.equal(fileItems[0]?.file_item?.file_name, "reply.mp3");
    assert.match(String(fileItems[0]?.file_item?.aeskey ?? ""), /^[0-9a-f]{32}$/i);
    assert.equal(fileItems[0]?.file_item?.media?.encrypt_query_param, "download-param-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
