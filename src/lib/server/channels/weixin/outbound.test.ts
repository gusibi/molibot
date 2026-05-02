import test from "node:test";
import assert from "node:assert/strict";
import { sendWeixinFile, sendWeixinImageReferenceText } from "./outbound.js";
import { filterWeixinMarkdown } from "#weixin-agent-sdk/src/messaging/send.js";

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
          file_item?: { file_name?: string; media?: { encrypt_query_param?: string; aes_key?: string } };
        }>;
      };
    };
    const filePayload = sendBodies[1] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          text_item?: { text?: string };
          file_item?: { file_name?: string; media?: { encrypt_query_param?: string; aes_key?: string } };
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
    assert.ok(String(fileItems[0]?.file_item?.media?.aes_key ?? "").length > 0);
    assert.equal(fileItems[0]?.file_item?.media?.encrypt_query_param, "download-param-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWeixinFile sends local images as IMAGE messages using the sdk media protocol", async () => {
  const imagePath = `${process.cwd()}/assets/test-images/vision-smoke.png`;

  const originalFetch = globalThis.fetch;
  const sendBodies: unknown[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.example.test/ilink/bot/getuploadurl") {
      return new Response(JSON.stringify({ ret: 0, upload_param: "upload-param-image" }), { status: 200 });
    }
    if (url.startsWith("https://cdn.example.test/upload?")) {
      return new Response("", {
        status: 200,
        headers: {
          "x-encrypted-param": "download-param-image"
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
      filePath: imagePath,
      toUserId: "wx-user-1",
      contextToken: "ctx-1",
      baseUrlOverride: "https://api.example.test",
      cdnBaseUrl: "https://cdn.example.test"
    });

    assert.equal(result, "image");
    assert.equal(sendBodies.length, 1);

    const imagePayload = sendBodies[0] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          image_item?: { aeskey?: string; media?: { encrypt_query_param?: string; aes_key?: string; encrypt_type?: number } };
        }>;
      };
    };

    const imageItems = imagePayload.msg?.item_list ?? [];
    assert.equal(imageItems.length, 1);
    assert.equal(imageItems[0]?.type, 2);
    assert.equal(imageItems[0]?.image_item?.aeskey, undefined);
    assert.equal(imageItems[0]?.image_item?.media?.encrypt_query_param, "download-param-image");
    assert.equal(imageItems[0]?.image_item?.media?.encrypt_type, 1);
    assert.ok(String(imageItems[0]?.image_item?.media?.aes_key ?? "").length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWeixinImageReferenceText converts markdown image links to image messages", async () => {
  const originalFetch = globalThis.fetch;
  const sendBodies: unknown[] = [];
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://example.test/generated.png") {
      return new Response(new Uint8Array(pngBytes), {
        status: 200,
        headers: { "content-type": "image/png" }
      });
    }
    if (url === "https://api.example.test/ilink/bot/getuploadurl") {
      return new Response(JSON.stringify({ ret: 0, upload_param: "upload-param-remote-image" }), { status: 200 });
    }
    if (url.startsWith("https://cdn.example.test/upload?")) {
      return new Response("", {
        status: 200,
        headers: {
          "x-encrypted-param": "download-param-remote-image"
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
    const sent = await sendWeixinImageReferenceText({
      text: "生成好了\n![result](https://example.test/generated.png)",
      toUserId: "wx-user-1",
      contextToken: "ctx-1",
      baseUrlOverride: "https://api.example.test",
      cdnBaseUrl: "https://cdn.example.test"
    });

    assert.equal(sent, true);
    assert.equal(sendBodies.length, 2);

    const captionPayload = sendBodies[0] as {
      msg?: { item_list?: Array<{ type?: number; text_item?: { text?: string } }> };
    };
    assert.equal(captionPayload.msg?.item_list?.[0]?.type, 1);
    assert.equal(captionPayload.msg?.item_list?.[0]?.text_item?.text, "生成好了");

    const imagePayload = sendBodies[1] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          image_item?: { media?: { encrypt_query_param?: string } };
        }>;
      };
    };
    assert.equal(imagePayload.msg?.item_list?.[0]?.type, 2);
    assert.equal(imagePayload.msg?.item_list?.[0]?.image_item?.media?.encrypt_query_param, "download-param-remote-image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendWeixinFile preserves supported markdown in visible text", async () => {
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
    await sendWeixinFile({
      filePath: voicePath,
      toUserId: "wx-user-1",
      contextToken: "ctx-1",
      text: [
        "# 日报",
        "",
        "| 项目 | 状态 |",
        "| --- | --- |",
        "| Alpha | **进行中** |",
        "",
        "English *italic* ok",
        "中文 *强调* 会去掉星号",
        "![img](https://example.com/x.png)"
      ].join("\n"),
      baseUrlOverride: "https://api.example.test",
      cdnBaseUrl: "https://cdn.example.test"
    });

    assert.equal(sendBodies.length, 2);
    const textPayload = sendBodies[0] as {
      msg?: {
        item_list?: Array<{
          type?: number;
          text_item?: { text?: string };
        }>;
      };
    };

    const textItems = textPayload.msg?.item_list ?? [];
    assert.equal(textItems.length, 1);
    assert.equal(textItems[0]?.type, 1);
    assert.equal(
      textItems[0]?.text_item?.text,
      filterWeixinMarkdown(
        [
          "# 日报",
          "",
          "| 项目 | 状态 |",
          "| --- | --- |",
          "| Alpha | **进行中** |",
          "",
          "English *italic* ok",
          "中文 *强调* 会去掉星号",
          "![img](https://example.com/x.png)"
        ].join("\n")
      ).trim()
    );
    assert.match(String(textItems[0]?.text_item?.text ?? ""), /\| 项目 \| 状态 \|/);
    assert.match(String(textItems[0]?.text_item?.text ?? ""), /English \*italic\* ok/);
    assert.match(String(textItems[0]?.text_item?.text ?? ""), /中文 强调 会去掉星号/);
    assert.doesNotMatch(String(textItems[0]?.text_item?.text ?? ""), /!\[img\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
