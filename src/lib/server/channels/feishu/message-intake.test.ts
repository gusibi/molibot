import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  buildFeishuThreadScopeId,
  isFeishuGroupMessageTriggered,
  toFeishuInboundEvent
} from "$lib/server/channels/feishu/message-intake.js";

function message(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    chat_id: "oc_chat",
    chat_type: "group",
    message_id: "om_user",
    message_type: "text",
    content: JSON.stringify({ text: "hello" }),
    mentions: [],
    create_time: "1710000000123",
    ...overrides
  };
}

const sender = {
  sender_id: {
    open_id: "ou_user",
    union_id: "on_user"
  }
};

test("isFeishuGroupMessageTriggered ignores ordinary group messages without bot mention or known thread", () => {
  assert.equal(isFeishuGroupMessageTriggered(message(), { botOpenId: "ou_bot" }), false);
});

test("isFeishuGroupMessageTriggered accepts group messages that mention the bot", () => {
  assert.equal(
    isFeishuGroupMessageTriggered(message({
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Molibot" }]
    }), { botOpenId: "ou_bot" }),
    true
  );
});

test("isFeishuGroupMessageTriggered ignores group messages that mention another bot", () => {
  assert.equal(
    isFeishuGroupMessageTriggered(message({
      mentions: [{ key: "@_user_1", id: { open_id: "ou_other_bot" }, name: "Other Bot" }]
    }), { botOpenId: "ou_bot" }),
    false
  );
});

test("isFeishuGroupMessageTriggered ignores group mentions when bot identity is unavailable", () => {
  assert.equal(
    isFeishuGroupMessageTriggered(message({
      mentions: [{ key: "@_user_1", id: { open_id: "ou_other_bot" }, name: "Other Bot" }]
    })),
    false
  );
});

test("isFeishuGroupMessageTriggered accepts known bot thread messages without mention", () => {
  const triggered = isFeishuGroupMessageTriggered(message({
    thread_id: "omt_thread",
    parent_id: "om_parent"
  }), {
    botOpenId: "ou_bot",
    isKnownBotThread: ({ chatId, threadId, parentMessageId }) => {
      assert.equal(chatId, "oc_chat");
      assert.equal(threadId, "omt_thread");
      assert.equal(parentMessageId, "om_parent");
      return true;
    }
  });

  assert.equal(triggered, true);
});

test("isFeishuGroupMessageTriggered ignores unknown thread messages without mention", () => {
  assert.equal(isFeishuGroupMessageTriggered(message({
    thread_id: "omt_thread"
  }), {
    botOpenId: "ou_bot",
    isKnownBotThread: () => false
  }), false);
});

test("toFeishuInboundEvent preserves Feishu platform ids and thread scope", async () => {
  const event = await toFeishuInboundEvent({
    client: {} as never,
    store: {
      saveAttachment: () => {
        throw new Error("saveAttachment should not be called for text-only messages");
      }
    } as never,
    message: message({
      message_id: "om_user_123",
      thread_id: "omt_thread",
      parent_id: "om_parent",
      root_id: "om_root",
      content: JSON.stringify({ text: "@_user_1 continue" })
    }),
    sender
  });

  assert.equal(event?.chatId, "oc_chat");
  assert.equal(event?.scopeId, buildFeishuThreadScopeId("oc_chat", "omt_thread"));
  assert.equal(event?.platformMessageId, "om_user_123");
  assert.equal(event?.platformThreadId, "omt_thread");
  assert.equal(event?.platformParentMessageId, "om_parent");
  assert.equal(event?.platformRootMessageId, "om_root");
  assert.equal(event?.text, "continue");
});

function collectingStore(saved: unknown[]) {
  return {
    saveAttachment: (_scopeId: string, filename: string, _ts: string, content: Buffer, meta: any) => {
      const record = {
        original: filename,
        local: filename,
        mediaType: meta.mediaType,
        mimeType: meta.mimeType,
        size: content.byteLength,
        isImage: meta.mediaType === "image",
        isAudio: meta.mediaType === "audio",
        isVideo: meta.mediaType === "video"
      };
      saved.push(record);
      return record;
    }
  } as never;
}

function imageClient(resourceCalls: unknown[], data: Buffer) {
  return {
    im: {
      messageResource: {
        get: async (payload: unknown) => {
          resourceCalls.push(payload);
          return {
            headers: { "content-type": "image/png" },
            getReadableStream: () => Readable.from([data])
          };
        }
      }
    }
  } as never;
}

test("toFeishuInboundEvent extracts image and text from a post message", async () => {
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const resourceCalls: unknown[] = [];
  const saved: unknown[] = [];
  const event = await toFeishuInboundEvent({
    client: imageClient(resourceCalls, data),
    store: collectingStore(saved),
    message: message({
      message_type: "post",
      content: JSON.stringify({
        title: "",
        content: [
          [{ tag: "img", image_key: "img_v3_abc", width: 555, height: 400 }],
          [{ tag: "text", text: "这张图片是什么内容", style: [] }]
        ]
      })
    }),
    sender
  });

  // The image must be downloaded and surfaced as vision input, not left as an
  // `image_key` inside a JSON blob standing in for the user's text.
  assert.equal(event?.text, "这张图片是什么内容");
  assert.equal(event?.attachments.length, 1);
  assert.equal(event?.imageContents?.length, 1);
  assert.equal(event?.imageContents?.[0].mimeType, "image/png");
  assert.equal(event?.imageContents?.[0].data, data.toString("base64"));
  assert.deepEqual(resourceCalls[0], {
    path: { message_id: "om_user", file_key: "img_v3_abc" },
    params: { type: "image" }
  });
});

test("toFeishuInboundEvent never leaks raw post JSON into the message text", async () => {
  const event = await toFeishuInboundEvent({
    client: imageClient([], Buffer.from([0x89])),
    store: collectingStore([]),
    message: message({
      message_type: "post",
      content: JSON.stringify({
        title: "周报",
        content: [[{ tag: "text", text: "本周进展" }]]
      })
    }),
    sender
  });

  assert.equal(event?.text, "周报\n本周进展");
  assert.equal(event?.text.includes("image_key"), false);
  assert.equal(event?.text.includes("\"tag\""), false);
});

test("toFeishuInboundEvent strips the mentioned bot name from a post message", async () => {
  const event = await toFeishuInboundEvent({
    client: imageClient([], Buffer.from([0x89])),
    store: collectingStore([]),
    message: message({
      message_type: "post",
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Molibot" }],
      content: JSON.stringify({
        content: [[
          { tag: "at", user_id: "ou_bot", user_name: "Molibot" },
          { tag: "text", text: " 帮我看看" }
        ]]
      })
    }),
    sender
  });

  assert.equal(event?.text, "帮我看看");
});

test("toFeishuInboundEvent collects every image in a multi-image post", async () => {
  const data = Buffer.from([0x89, 0x50]);
  const resourceCalls: unknown[] = [];
  const event = await toFeishuInboundEvent({
    client: imageClient(resourceCalls, data),
    store: collectingStore([]),
    message: message({
      message_type: "post",
      content: JSON.stringify({
        content: [
          [{ tag: "img", image_key: "img_a" }, { tag: "img", image_key: "img_b" }],
          [{ tag: "text", text: "对比这两张" }]
        ]
      })
    }),
    sender
  });

  assert.equal(event?.imageContents?.length, 2);
  assert.equal(resourceCalls.length, 2);
  assert.equal(event?.text, "对比这两张");
});

test("toFeishuInboundEvent labels an unsupported message type instead of dumping its JSON", async () => {
  const event = await toFeishuInboundEvent({
    client: imageClient([], Buffer.from([0x89])),
    store: collectingStore([]),
    message: message({
      message_type: "sticker",
      content: JSON.stringify({ file_key: "", sticker_id: "abc" })
    }),
    sender
  });

  assert.equal(event?.text, "(unsupported Feishu message type: sticker)");
  assert.equal(event?.text.includes("sticker_id"), false);
});

test("toFeishuInboundEvent preserves mp4 messages as video attachments", async () => {
  const data = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const resourceCalls: unknown[] = [];
  const savedAttachments: unknown[] = [];
  const event = await toFeishuInboundEvent({
    client: {
      im: {
        messageResource: {
          get: async (payload: unknown) => {
            resourceCalls.push(payload);
            return {
              headers: { "content-type": "video/mp4" },
              getReadableStream: () => Readable.from([data])
            };
          }
        }
      }
    } as never,
    store: {
      saveAttachment: (_scopeId: string, filename: string, _ts: string, content: Buffer, meta: any) => {
        const saved = {
          original: filename,
          local: filename,
          mediaType: meta.mediaType,
          mimeType: meta.mimeType,
          size: content.byteLength,
          isImage: meta.mediaType === "image",
          isAudio: meta.mediaType === "audio",
          isVideo: meta.mediaType === "video"
        };
        savedAttachments.push(saved);
        return saved;
      }
    } as never,
    message: message({
      message_type: "media",
      content: JSON.stringify({ file_key: "file_video", file_name: "clip.mp4" })
    }),
    sender
  });

  assert.deepEqual(resourceCalls[0], {
    path: {
      message_id: "om_user",
      file_key: "file_video"
    },
    params: {
      type: "media"
    }
  });
  assert.equal(event?.text, "clip.mp4");
  assert.equal(event?.attachments.length, 1);
  assert.deepEqual(savedAttachments[0], {
    original: "clip.mp4",
    local: "clip.mp4",
    mediaType: "video",
    mimeType: "video/mp4",
    size: data.byteLength,
    isImage: false,
    isAudio: false,
    isVideo: true
  });
});
