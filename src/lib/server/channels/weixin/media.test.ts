import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { MessageItemType, MessageType } from "#weixin-agent-sdk/src/api/types.js";
import { extractWeixinAttachments } from "./media.js";
import type { IncomingMessage } from "./sdk/client.js";

function encryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function buildIncomingMessage(overrides: IncomingMessage["raw"]["item_list"]): IncomingMessage {
  return {
    userId: "wx-user-1",
    text: "",
    type: "text",
    _contextToken: "ctx-1",
    timestamp: new Date("2026-03-26T12:00:00.000Z"),
    raw: {
      message_id: 1001,
      from_user_id: "wx-user-1",
      to_user_id: "bot-1",
      client_id: "client-1",
      create_time_ms: Date.parse("2026-03-26T12:00:00.000Z"),
      message_type: MessageType.USER,
      message_state: 0,
      context_token: "ctx-1",
      item_list: overrides
    }
  };
}

test("extractWeixinAttachments keeps voice when media.aes_key is missing", async () => {
  const originalFetch = globalThis.fetch;
  const voiceBytes = Buffer.from("plain-voice-data");
  const savedPayloads: Buffer[] = [];
  const store = {
    saveAttachment: (
      _chatId: string,
      filename: string,
      _ts: string,
      content: Buffer,
      meta?: { mediaType?: "image" | "audio" | "file"; mimeType?: string }
    ) => {
      savedPayloads.push(content);
      return {
        original: filename,
        local: filename,
        mediaType: meta?.mediaType ?? "file",
        mimeType: meta?.mimeType,
        isImage: meta?.mediaType === "image",
        isAudio: meta?.mediaType === "audio"
      };
    }
  };

  globalThis.fetch = async () => new Response(new Uint8Array(voiceBytes), { status: 200 });

  try {
    const result = await extractWeixinAttachments({
      chatId: "wx-user-1",
      ts: "1711454400.000",
      store: store as never,
      message: buildIncomingMessage([
        {
          type: MessageItemType.VOICE,
          voice_item: {
            media: {
              encrypt_query_param: "voice-download",
              aes_key: ""
            }
          }
        }
      ])
    });

    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0]?.isAudio, true);
    assert.deepEqual(savedPayloads[0], voiceBytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractWeixinAttachments accepts hex aeskey fallback for files", async () => {
  const originalFetch = globalThis.fetch;
  const key = randomBytes(16);
  const plaintext = Buffer.from("spreadsheet-data");
  const ciphertext = encryptAesEcb(plaintext, key);
  const savedPayloads: Buffer[] = [];
  const store = {
    saveAttachment: (
      _chatId: string,
      filename: string,
      _ts: string,
      content: Buffer,
      meta?: { mediaType?: "image" | "audio" | "file"; mimeType?: string }
    ) => {
      savedPayloads.push(content);
      return {
        original: filename,
        local: filename,
        mediaType: meta?.mediaType ?? "file",
        mimeType: meta?.mimeType,
        isImage: meta?.mediaType === "image",
        isAudio: meta?.mediaType === "audio"
      };
    }
  };

  globalThis.fetch = async () => new Response(new Uint8Array(ciphertext), { status: 200 });

  try {
    const result = await extractWeixinAttachments({
      chatId: "wx-user-1",
      ts: "1711454400.000",
      store: store as never,
      message: buildIncomingMessage([
        {
          type: MessageItemType.FILE,
          file_item: {
            file_name: "report.xlsx",
            aeskey: key.toString("hex"),
            media: {
              encrypt_query_param: "file-download",
              aes_key: ""
            }
          }
        }
      ])
    });

    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0]?.original, "report.xlsx");
    assert.deepEqual(savedPayloads[0], plaintext);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
