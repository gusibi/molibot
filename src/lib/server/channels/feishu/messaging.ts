import type * as lark from "@larksuiteoapi/node-sdk";
import { momWarn } from "../../agent/log.js";

export function formatFeishuCard(text: string) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "markdown",
        content: text
      }
    ]
  };
}

export async function sendFeishuText(
  client: lark.Client | undefined,
  chatId: string,
  text: string
): Promise<{ message_id: string } | null> {
  if (!client || !text.trim()) return null;
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(formatFeishuCard(text))
      }
    });
    return { message_id: res.data?.message_id || "" };
  } catch (error) {
    momWarn("feishu", "send_message_failed", { error: String(error) });
    return null;
  }
}

export async function editFeishuText(
  client: lark.Client | undefined,
  messageId: string,
  text: string
): Promise<string | null> {
  if (!client || !text.trim()) return null;
  try {
    await client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(formatFeishuCard(text))
      }
    });
    return messageId;
  } catch (error) {
    momWarn("feishu", "edit_message_failed", { error: String(error) });
    return null;
  }
}

function detectImageMime(filename: string, bytes: Buffer): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  if (lower.endsWith(".ico")) return "image/x-icon";

  if (bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47) {
    return "image/png";
  }

  if (bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 6 &&
    bytes.toString("ascii", 0, 6) === "GIF89a") {
    return "image/gif";
  }

  return null;
}

function detectAudioMime(filename: string, bytes: Buffer): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";

  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }

  return null;
}

function resolveFeishuFileType(filename: string, bytes: Buffer): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "doc";
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) return "xls";
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) return "ppt";
  if (lower.endsWith(".mp4")) return "mp4";

  const audioMime = detectAudioMime(filename, bytes);
  if (audioMime === "audio/ogg") return "opus";

  return "stream";
}

function isLikelyTextBuffer(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const printable =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte < 0x7f);
    if (!printable) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.15;
}

function canSendAsFeishuText(text: string): boolean {
  return text.trim().length > 0 && Array.from(text).length <= 4000;
}

async function sendFeishuMessageByType(
  client: lark.Client,
  chatId: string,
  msgType: string,
  content: Record<string, unknown>
): Promise<{ message_id: string } | null> {
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content)
    }
  });
  return { message_id: res.data?.message_id || "" };
}

export async function sendFeishuFile(
  client: lark.Client | undefined,
  chatId: string,
  bytes: Buffer,
  filename: string
): Promise<{ message_id: string } | null> {
  if (!client || !filename.trim() || bytes.length === 0) return null;

  if (isLikelyTextBuffer(bytes)) {
    const text = bytes.toString("utf8");
    if (canSendAsFeishuText(text)) {
      return sendFeishuText(client, chatId, text);
    }
  }

  const imageMime = detectImageMime(filename, bytes);
  if (imageMime) {
    try {
      const uploaded = await client.im.image.create({
        data: {
          image_type: "message",
          image: bytes
        }
      });
      if (uploaded?.image_key) {
        return await sendFeishuMessageByType(client, chatId, "image", { image_key: uploaded.image_key });
      }
    } catch (error) {
      momWarn("feishu", "send_image_failed_fallback_file", {
        filename,
        imageMime,
        error: String(error)
      });
    }
  }

  try {
    const fileType = resolveFeishuFileType(filename, bytes);
    const uploaded = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: filename,
        file: bytes
      }
    });
    const fileKey = uploaded?.file_key;
    if (!fileKey) return null;

    if (fileType === "opus") {
      try {
        return await sendFeishuMessageByType(client, chatId, "audio", { file_key: fileKey });
      } catch (error) {
        momWarn("feishu", "send_audio_failed_fallback_file", {
          filename,
          error: String(error)
        });
      }
    }

    if (fileType === "mp4") {
      try {
        return await sendFeishuMessageByType(client, chatId, "media", { file_key: fileKey });
      } catch (error) {
        momWarn("feishu", "send_media_failed_fallback_file", {
          filename,
          error: String(error)
        });
      }
    }

    return await sendFeishuMessageByType(client, chatId, "file", { file_key: fileKey });
  } catch (error) {
    momWarn("feishu", "send_file_failed", { filename, error: String(error) });
    return null;
  }
}

export async function deleteFeishuMessage(
  client: lark.Client | undefined,
  messageId: string | null | undefined
): Promise<void> {
  if (!client || !messageId) return;
  try {
    await client.im.message.delete({
      path: { message_id: messageId }
    });
  } catch (error) {
    momWarn("feishu", "delete_message_failed", {
      messageId,
      error: String(error)
    });
  }
}
