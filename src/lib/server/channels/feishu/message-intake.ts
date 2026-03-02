import type { Readable } from "node:stream";
import type * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "../../settings/index.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import { MomRuntimeStore } from "../../agent/store.js";
import { transcribeAudioViaConfiguredProvider, type TranscriptionResult } from "../shared/stt.js";

const FEISHU_STT_MAX_ATTEMPTS = 3;
const FEISHU_STT_RETRY_DELAY_MS = 800;

interface ParsedFeishuContent {
  rawText: string;
  fileKey: string | null;
  fileName: string | null;
  resourceType: "file" | "image" | "media" | null;
}

export type FeishuInboundEvent = ChannelInboundMessage & {
  transcriptionError?: string | null;
};

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
    const resourceType: ParsedFeishuContent["resourceType"] =
      typeof payload.media_key === "string" && !String(fileKey || "").toLowerCase().startsWith("file_")
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

function normalizeAudioMimeType(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase().trim();
  if (!value || value === "application/octet-stream") return "audio/ogg";
  if (value.includes("opus")) return "audio/ogg";
  if (value.includes("ogg")) return "audio/ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return "audio/mpeg";
  if (value.includes("wav")) return "audio/wav";
  if (value.includes("mp4") || value.includes("m4a")) return "audio/mp4";
  if (value.includes("aac")) return "audio/aac";
  if (value.includes("webm")) return "audio/webm";
  if (value.includes("flac")) return "audio/flac";
  return "audio/ogg";
}

function ensureAudioFilename(filename: string, mimeType?: string | null): string {
  const trimmed = filename.trim() || "feishu-audio";
  const lower = trimmed.toLowerCase();
  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm)$/.test(lower)) {
    return trimmed;
  }
  return `${trimmed}${resolveAudioExt(mimeType)}`;
}

async function transcribeAudio(
  getSettings: () => RuntimeSettings,
  data: Buffer,
  filename: string,
  mimeType?: string
): Promise<TranscriptionResult> {
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  const normalizedFilename = ensureAudioFilename(filename, normalizedMimeType);
  return transcribeAudioViaConfiguredProvider({
    channel: "feishu",
    settings: getSettings(),
    data,
    filename: normalizedFilename,
    mimeType: normalizedMimeType,
    maxAttempts: FEISHU_STT_MAX_ATTEMPTS,
    retryDelayMs: FEISHU_STT_RETRY_DELAY_MS
  });
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

  if (msg === "audio" || msg === "file" || key.startsWith("file_")) {
    push("file");
    return ordered;
  }

  if (msg === "media" || msg === "video") {
    push("media");
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

export function isFeishuGroupMessageTriggered(message: Record<string, any>): boolean {
  if (message.chat_type === "p2p") return true;
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  return mentions.length > 0;
}

export async function toFeishuInboundEvent(input: {
  client: lark.Client;
  getSettings: () => RuntimeSettings;
  store: MomRuntimeStore;
  message: Record<string, any>;
  sender: Record<string, any>;
}): Promise<FeishuInboundEvent | null> {
  const { client, getSettings, store, message, sender } = input;
  const chatId = String(message.chat_id || "");
  const messageId = String(message.message_id || "");
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
  let voiceTranscript: string | null = null;
  let transcriptionError: string | null = null;

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
          : parsed.resourceType === "media"
            ? resolveAudioExt(resource.contentType)
            : ".bin"
        }`;
      const saved = store.saveAttachment(chatId, guessedName, ts, resource.data);
      attachments.push(saved);

      const imageMime = resource.contentType || mimeFromFilename(guessedName);
      if (parsed.resourceType === "image" && imageMime) {
        imageContents.push({ type: "image", mimeType: imageMime, data: resource.data.toString("base64") });
      }

      const shouldTranscribe =
        parsed.resourceType === "media" ||
        message.message_type === "audio" ||
        message.message_type === "media";
      if (shouldTranscribe) {
        const transcription = await transcribeAudio(
          getSettings,
          resource.data,
          ensureAudioFilename(guessedName, resource.contentType),
          normalizeAudioMimeType(resource.contentType)
        );
        voiceTranscript = transcription.text;
        transcriptionError = transcription.errorMessage;
      }
    }
  }

  if (voiceTranscript) {
    cleaned = cleaned
      ? `${cleaned}\n\n[voice transcript]\n${voiceTranscript}`
      : `[voice transcript]\n${voiceTranscript}`;
  }

  if (!cleaned) {
    if (message.message_type === "audio" || message.message_type === "media") {
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
    chatType,
    messageId: Number(messageId.replace(/[^0-9]/g, "").slice(0, 10)) || Date.now(),
    userId: String(sender.sender_id?.open_id || "unknown"),
    userName: sender.sender_id?.union_id || "User",
    text: cleaned,
    ts,
    attachments,
    imageContents,
    transcriptionError
  };
}
