import type { Readable } from "node:stream";
import type * as lark from "@larksuiteoapi/node-sdk";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

interface ParsedFeishuContent {
  rawText: string;
  fileKey: string | null;
  fileName: string | null;
  resourceType: "file" | "image" | "media" | null;
}

export type FeishuInboundEvent = ChannelInboundMessage;

export interface FeishuGroupTriggerOptions {
  botOpenId?: string;
  isKnownBotThread?: (input: { chatId: string; threadId?: string; parentMessageId?: string }) => boolean;
}

function parseJsonContent(raw: unknown): Record<string, any> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function parseFeishuContent(message: Record<string, any>): ParsedFeishuContent {
  const payload = parseJsonContent(message.content) ?? {};
  const messageType = String(message.message_type || "").trim();

  if (messageType === "text") {
    return {
      rawText: String(payload.text ?? message.content ?? ""),
      fileKey: null,
      fileName: null,
      resourceType: null
    };
  }

  if (messageType === "image") {
    return {
      rawText: "",
      fileKey: typeof payload.image_key === "string" ? payload.image_key : null,
      fileName: typeof payload.file_name === "string" ? payload.file_name : null,
      resourceType: "image"
    };
  }

  if (messageType === "audio" || messageType === "media" || messageType === "video") {
    const fileKey =
      typeof payload.file_key === "string"
        ? payload.file_key
        : typeof payload.audio_key === "string"
          ? payload.audio_key
          : typeof payload.media_key === "string"
            ? payload.media_key
            : null;
    const resourceType: ParsedFeishuContent["resourceType"] = messageType === "media" || messageType === "video"
      ? "media"
      : "file";
    return {
      rawText: String(payload.text ?? payload.file_name ?? ""),
      fileKey,
      fileName: typeof payload.file_name === "string" ? payload.file_name : null,
      resourceType
    };
  }

  if (messageType === "file") {
    return {
      rawText: String(payload.text ?? payload.file_name ?? ""),
      fileKey: typeof payload.file_key === "string" ? payload.file_key : null,
      fileName: typeof payload.file_name === "string" ? payload.file_name : null,
      resourceType: "file"
    };
  }

  return {
    rawText: String(payload.text ?? message.content ?? ""),
    fileKey: typeof payload.file_key === "string" ? payload.file_key : null,
    fileName: typeof payload.file_name === "string" ? payload.file_name : null,
    resourceType: typeof payload.file_key === "string" ? "file" : null
  };
}

function mimeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return null;
}

function resolveAudioExt(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("opus")) return ".opus";
  if (value.includes("ogg")) return ".ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return ".mp3";
  if (value.includes("wav")) return ".wav";
  if (value.includes("mp4") || value.includes("m4a")) return ".m4a";
  if (value.includes("aac")) return ".aac";
  if (value.includes("webm")) return ".webm";
  if (value.includes("flac")) return ".flac";
  return ".opus";
}

function resolveResourceExt(contentType?: string | null): string {
  const value = String(contentType || "").toLowerCase();
  if (value.startsWith("audio/")) return resolveAudioExt(value);
  if (value.includes("mp4")) return ".mp4";
  if (value.includes("webm")) return ".webm";
  if (value.includes("quicktime")) return ".mov";
  return ".bin";
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function filenameFromHeaders(headers: Record<string, any> | undefined): string | null {
  const raw = String(headers?.["content-disposition"] ?? headers?.["Content-Disposition"] ?? "");
  if (!raw) return null;
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = raw.match(/filename="?([^\";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

function contentTypeFromHeaders(headers: Record<string, any> | undefined): string | null {
  const raw = String(headers?.["content-type"] ?? headers?.["Content-Type"] ?? "").trim();
  return raw ? raw.split(";")[0].trim() : null;
}

function guessResourceTypes(
  messageType: string,
  fileKey: string,
  preferred: "file" | "image" | "media"
): Array<"file" | "image" | "media"> {
  const ordered: Array<"file" | "image" | "media"> = [];
  const push = (type: "file" | "image" | "media") => {
    if (!ordered.includes(type)) ordered.push(type);
  };

  const key = fileKey.toLowerCase();
  const msg = messageType.toLowerCase();

  if (msg === "image" || key.startsWith("img_")) {
    push("image");
    push("file");
    push("media");
    return ordered;
  }

  if (msg === "media" || msg === "video") {
    push("media");
    return ordered;
  }

  if (msg === "audio" || msg === "file" || key.startsWith("file_")) {
    push("file");
    return ordered;
  }

  push(preferred);
  push("file");
  push("media");
  push("image");
  return ordered;
}

async function downloadFeishuMessageResource(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  type: "file" | "image" | "media",
  messageType?: string
): Promise<{ data: Buffer; filename: string | null; contentType: string | null } | null> {
  const candidates = guessResourceTypes(messageType || "", fileKey, type);
  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      const resp = await client.im.messageResource.get({
        path: {
          message_id: messageId,
          file_key: fileKey
        },
        params: {
          type: candidate
        }
      });
      const data = await streamToBuffer(resp.getReadableStream() as Readable);
      if (candidate !== type) {
        momLog("feishu", "file_download_type_fallback_hit", {
          messageId,
          fileKey,
          requestedType: type,
          resolvedType: candidate
        });
      }
      return {
        data,
        filename: filenameFromHeaders(resp.headers as Record<string, any> | undefined),
        contentType: contentTypeFromHeaders(resp.headers as Record<string, any> | undefined)
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      momWarn("feishu", "file_download_attempt_failed", {
        messageId,
        fileKey,
        requestedType: type,
        attemptedType: candidate,
        error: lastError
      });
    }
  }

  momWarn("feishu", "file_download_failed", {
    messageId,
    fileKey,
    type,
    triedTypes: candidates,
    error: lastError
  });
  return null;
}

export function getFeishuThreadId(message: Record<string, any>): string {
  return String(message.thread_id || message.root_id || "").trim();
}

export function buildFeishuThreadScopeId(chatId: string, threadId?: string | null): string {
  const normalizedThreadId = String(threadId ?? "").trim();
  return normalizedThreadId ? `${chatId}__thread_${encodeURIComponent(normalizedThreadId)}` : chatId;
}

function isFeishuBotMention(message: Record<string, any>, botOpenId?: string): boolean {
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const normalizedBotOpenId = String(botOpenId ?? "").trim();

  if (!normalizedBotOpenId) {
    momWarn("feishu", "isFeishuBotMention_missing_bot_identity_ignore_mentions", {
      mentionCount: mentions.length
    });
    return false;
  }

  momLog("feishu", "isFeishuBotMention_checking_mentions", {
    botOpenId: normalizedBotOpenId,
    mentions: mentions.map((m: any) => ({
      key: m?.key,
      name: m?.name,
      id: m?.id
    }))
  });

  // Check against multiple possible ID fields in the mention, since Feishu
  // might use open_id, bot_id, or union_id depending on the context.
  const matched = mentions.some((mention) => {
    const idObj = mention?.id && typeof mention.id === "object" ? mention.id : {};
    const mentionOpenId = String(idObj.open_id ?? "").trim();
    const mentionUnionId = String(idObj.union_id ?? "").trim();
    const mentionUserId = String(idObj.user_id ?? "").trim();
    const mentionBotId = String(idObj.bot_id ?? "").trim();

    const matches = mentionOpenId === normalizedBotOpenId ||
           mentionUnionId === normalizedBotOpenId ||
           mentionUserId === normalizedBotOpenId ||
           mentionBotId === normalizedBotOpenId;

    if (matches) {
      momLog("feishu", "isFeishuBotMention_match_found", { mention });
    }

    return matches;
  });

  momLog("feishu", "isFeishuBotMention_result", { matched });
  return matched;
}

export function isFeishuGroupMessageTriggered(message: Record<string, any>, options: FeishuGroupTriggerOptions = {}): boolean {
  if (message.chat_type === "p2p") return true;
  if (isFeishuBotMention(message, options.botOpenId)) return true;

  const chatId = String(message.chat_id || "").trim();
  const threadId = getFeishuThreadId(message);
  const parentMessageId = String(message.parent_id || "").trim();
  if (!threadId && !parentMessageId) return false;

  return Boolean(options.isKnownBotThread?.({ chatId, threadId, parentMessageId }));
}

export async function toFeishuInboundEvent(input: {
  client: lark.Client;
  store: MomRuntimeStore;
  message: Record<string, any>;
  sender: Record<string, any>;
}): Promise<FeishuInboundEvent | null> {
  const { client, store, message, sender } = input;
  const chatId = String(message.chat_id || "");
  const messageId = String(message.message_id || "");
  const threadId = getFeishuThreadId(message);
  const parentMessageId = String(message.parent_id || "").trim();
  const rootMessageId = String(message.root_id || "").trim();
  const scopeId = buildFeishuThreadScopeId(chatId, threadId);
  const chatType = message.chat_type === "p2p" ? "private" : "group";
  const parsed = parseFeishuContent(message);

  let cleaned = parsed.rawText.trim();
  if (chatType === "group") {
    cleaned = cleaned.replace(/@_user_[^\s]+\s*/g, "").trim();
  }

  const ts = message.create_time
    ? `${String(message.create_time).slice(0, 10)}.${String(message.create_time).slice(10, 13).padEnd(3, "0")}`
    : `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`;

  const attachments: ChannelInboundMessage["attachments"] = [];
  const imageContents: ChannelInboundMessage["imageContents"] = [];

  if (parsed.fileKey && parsed.resourceType) {
    const resource = await downloadFeishuMessageResource(
      client,
      messageId,
      parsed.fileKey,
      parsed.resourceType,
      String(message.message_type || "")
    );

    if (resource) {
      const guessedName =
        parsed.fileName ||
        resource.filename ||
        `${parsed.fileKey}${parsed.resourceType === "image"
          ? ".png"
          : resolveResourceExt(resource.contentType)
        }`;
      const mimeType = resource.contentType || mimeFromFilename(guessedName) || undefined;
      const mediaType = parsed.resourceType === "image"
        ? "image"
        : mimeType?.startsWith("audio/") || message.message_type === "audio"
          ? "audio"
          : mimeType?.startsWith("video/") || message.message_type === "media" || message.message_type === "video"
            ? "video"
            : "file";
      const saved = store.saveAttachment(scopeId, guessedName, ts, resource.data, {
        mediaType,
        mimeType
      });
      attachments.push(saved);

      if (saved.isImage && mimeType) {
        imageContents.push({ type: "image", mimeType, data: resource.data.toString("base64") });
      }
    }
  }

  if (!cleaned) {
    if (attachments.some((item) => item.isAudio)) {
      cleaned = "(voice message received; transcription unavailable)";
    } else if (attachments.length > 0) {
      cleaned = "(attachment)";
    }
  }

  if (!cleaned && attachments.length === 0 && imageContents.length === 0) {
    return null;
  }

  return {
    chatId,
    scopeId,
    chatType,
    messageId: Number(messageId.replace(/[^0-9]/g, "").slice(0, 10)) || Date.now(),
    platformMessageId: messageId,
    platformThreadId: threadId || undefined,
    platformParentMessageId: parentMessageId || undefined,
    platformRootMessageId: rootMessageId || undefined,
    userId: String(sender.sender_id?.open_id || "unknown"),
    userName: sender.sender_id?.union_id || "User",
    text: cleaned,
    ts,
    attachments,
    imageContents
  };
}
