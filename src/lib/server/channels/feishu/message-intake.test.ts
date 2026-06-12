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
