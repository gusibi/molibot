import { createDecipheriv } from "node:crypto";
import { extname } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { IncomingMessage, MessageItem } from "./sdk/index.js";
import { MessageItemType } from "./sdk/index.js";
import type { FileAttachment } from "../../agent/types.js";
import { MomRuntimeStore } from "../../agent/store.js";

const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".silk": "audio/silk",
  ".tar": "application/x-tar",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip"
};

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function getMimeFromFilename(filename: string): string {
  return EXTENSION_TO_MIME[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function detectImageMimeType(data: Buffer): string {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

function buildCdnDownloadUrl(encryptedQueryParam: string): string {
  return `${WEIXIN_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function isMediaItem(item: MessageItem | undefined | null): item is MessageItem {
  return Boolean(
    item &&
      (item.type === MessageItemType.IMAGE ||
        item.type === MessageItemType.VOICE ||
        item.type === MessageItemType.FILE ||
        item.type === MessageItemType.VIDEO)
  );
}

function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return String(item.voice_item.text);
    }
  }
  return "";
}

function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Unsupported aes_key length: ${decoded.length}`);
}

async function fetchCdnBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`CDN download failed ${response.status} ${response.statusText}: ${body}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadEncryptedMedia(encryptedQueryParam: string, aesKeyBase64: string): Promise<Buffer> {
  const encrypted = await fetchCdnBytes(buildCdnDownloadUrl(encryptedQueryParam));
  return decryptAesEcb(encrypted, parseAesKey(aesKeyBase64));
}

async function downloadPlainMedia(encryptedQueryParam: string): Promise<Buffer> {
  return fetchCdnBytes(buildCdnDownloadUrl(encryptedQueryParam));
}

function normalizeAesKeyBase64(
  rawValue: string | undefined | null,
  fallbackHexValue?: string | undefined | null
): string | undefined {
  const value = String(rawValue ?? "").trim();
  if (value) return value;

  const fallbackHex = String(fallbackHexValue ?? "").trim();
  if (/^[0-9a-fA-F]{32}$/.test(fallbackHex)) {
    return Buffer.from(fallbackHex, "hex").toString("base64");
  }

  return undefined;
}

async function downloadMaybeEncryptedMedia(encryptedQueryParam: string, aesKeyBase64?: string): Promise<Buffer> {
  if (aesKeyBase64) {
    return downloadEncryptedMedia(encryptedQueryParam, aesKeyBase64);
  }
  return downloadPlainMedia(encryptedQueryParam);
}

function mediaIdentity(item: MessageItem): string {
  const imageKey = item.image_item?.media?.encrypt_query_param;
  const voiceKey = item.voice_item?.media?.encrypt_query_param;
  const fileKey = item.file_item?.media?.encrypt_query_param;
  const videoKey = item.video_item?.media?.encrypt_query_param;
  return `${item.type}:${imageKey ?? voiceKey ?? fileKey ?? videoKey ?? item.file_item?.file_name ?? "unknown"}`;
}

function collectMediaItems(itemList?: MessageItem[]): MessageItem[] {
  const items: MessageItem[] = [];
  const seen = new Set<string>();
  const push = (item: MessageItem | undefined | null) => {
    if (!isMediaItem(item)) return;
    const key = mediaIdentity(item);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const item of itemList ?? []) {
    push(item);
    if (item.type === MessageItemType.TEXT) {
      push(item.ref_msg?.message_item);
    }
  }
  return items;
}

function extensionFromMime(mimeType: string): string {
  const match = Object.entries(EXTENSION_TO_MIME).find(([, mime]) => mime === mimeType);
  return match?.[0] ?? ".bin";
}

function buildImageFilename(messageId: number, index: number, mimeType: string): string {
  return `weixin_${messageId}_${index}${extensionFromMime(mimeType)}`;
}

function buildVoiceFilename(messageId: number, index: number): string {
  return `weixin_${messageId}_${index}.silk`;
}

function buildVideoFilename(messageId: number, index: number): string {
  return `weixin_${messageId}_${index}.mp4`;
}

export function extractWeixinText(message: IncomingMessage): string {
  return bodyFromItemList(message.raw.item_list).trim();
}

export function hasWeixinInlineVoiceTranscript(message: IncomingMessage): boolean {
  return (message.raw.item_list ?? []).some(
    (item) => item.type === MessageItemType.VOICE && typeof item.voice_item?.text === "string" && item.voice_item.text.trim().length > 0
  );
}

export async function extractWeixinAttachments(input: {
  chatId: string;
  ts: string;
  store: MomRuntimeStore;
  message: IncomingMessage;
  onWarning?: (warning: string) => void;
}): Promise<{ attachments: FileAttachment[]; imageContents: ImageContent[] }> {
  const { chatId, ts, store, message } = input;
  const attachments: FileAttachment[] = [];
  const imageContents: ImageContent[] = [];
  const mediaItems = collectMediaItems(message.raw.item_list);

  for (let index = 0; index < mediaItems.length; index += 1) {
    const item = mediaItems[index];
    try {
      if (item.type === MessageItemType.IMAGE) {
        const encryptedQueryParam = item.image_item?.media?.encrypt_query_param;
        if (!encryptedQueryParam) continue;
        const aesKeyBase64 = item.image_item?.aeskey
          ? Buffer.from(item.image_item.aeskey, "hex").toString("base64")
          : item.image_item?.media?.aes_key;
        const data = aesKeyBase64
          ? await downloadEncryptedMedia(encryptedQueryParam, aesKeyBase64)
          : await downloadPlainMedia(encryptedQueryParam);
        const mimeType = detectImageMimeType(data);
        const saved = store.saveAttachment(chatId, buildImageFilename(message.raw.message_id, index, mimeType), ts, data, {
          mediaType: "image",
          mimeType
        });
        attachments.push(saved);
        imageContents.push({ type: "image", mimeType: saved.mimeType || mimeType, data: data.toString("base64") });
        continue;
      }

      if (item.type === MessageItemType.VOICE) {
        const encryptedQueryParam = item.voice_item?.media?.encrypt_query_param;
        const aesKeyBase64 = normalizeAesKeyBase64(item.voice_item?.media?.aes_key, item.voice_item?.aeskey);
        if (!encryptedQueryParam) continue;
        const data = await downloadMaybeEncryptedMedia(encryptedQueryParam, aesKeyBase64);
        attachments.push(
          store.saveAttachment(chatId, buildVoiceFilename(message.raw.message_id, index), ts, data, {
            mediaType: "audio",
            mimeType: "audio/silk"
          })
        );
        continue;
      }

      if (item.type === MessageItemType.FILE) {
        const encryptedQueryParam = item.file_item?.media?.encrypt_query_param;
        const aesKeyBase64 = normalizeAesKeyBase64(item.file_item?.media?.aes_key, item.file_item?.aeskey);
        if (!encryptedQueryParam) continue;
        const filename = String(item.file_item?.file_name || `weixin_${message.raw.message_id}_${index}.bin`).trim();
        const data = await downloadMaybeEncryptedMedia(encryptedQueryParam, aesKeyBase64);
        attachments.push(
          store.saveAttachment(chatId, filename, ts, data, {
            mediaType: "file",
            mimeType: getMimeFromFilename(filename)
          })
        );
        continue;
      }

      if (item.type === MessageItemType.VIDEO) {
        const encryptedQueryParam = item.video_item?.media?.encrypt_query_param;
        const aesKeyBase64 = normalizeAesKeyBase64(item.video_item?.media?.aes_key, item.video_item?.aeskey);
        if (!encryptedQueryParam) continue;
        const data = await downloadMaybeEncryptedMedia(encryptedQueryParam, aesKeyBase64);
        attachments.push(
          store.saveAttachment(chatId, buildVideoFilename(message.raw.message_id, index), ts, data, {
            mediaType: "file",
            mimeType: "video/mp4"
          })
        );
      }
    } catch (error) {
      input.onWarning?.(
        `Failed to download inbound media type=${String(item.type)} messageId=${String(message.raw.message_id)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { attachments, imageContents };
}
