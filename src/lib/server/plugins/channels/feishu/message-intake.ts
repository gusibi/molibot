import type { Readable } from "node:stream";
import type * as lark from "@larksuiteoapi/node-sdk";
import { config, type RuntimeSettings } from "../../../config.js";
import { momLog, momWarn } from "../../../mom/log.js";
import type { ChannelInboundMessage } from "../../../mom/types.js";
import { MomRuntimeStore } from "../../../mom/store.js";

interface SttTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
}

interface TranscriptionResult {
  text: string | null;
  errorMessage: string | null;
}

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

function normalizeApiPath(path: string | undefined, fallback: string): string {
  const raw = String(path ?? fallback).trim() || fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildApiUrl(baseUrl: string, path: string | undefined, fallbackPath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const normalizedPath = normalizeApiPath(path, fallbackPath);
  return `${base}${normalizedPath}`;
}

function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = key.trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

function resolveSttTarget(getSettings: () => RuntimeSettings): SttTarget | null {
  const settings = getSettings();
  const routed = parseModelKey(settings.modelRouting.sttModelKey);
  if (routed?.mode === "custom") {
    const provider = settings.customProviders.find((p) => p.id === routed.provider);
    if (provider?.baseUrl && provider.apiKey && routed.model) {
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: routed.model,
        path: provider.path
      };
    }
  }

  for (const provider of settings.customProviders) {
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;
    const sttModel = provider.models.find((m) => m.id?.trim() && Array.isArray(m.tags) && m.tags.includes("stt"));
    if (!sttModel) continue;
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: sttModel.id,
      path: provider.path
    };
  }

  if (!config.telegramSttApiKey || !config.telegramSttModel) return null;
  return {
    baseUrl: config.telegramSttBaseUrl,
    apiKey: config.telegramSttApiKey,
    model: config.telegramSttModel,
    path: "/v1/audio/transcriptions"
  };
}

async function transcribeAudio(
  getSettings: () => RuntimeSettings,
  data: Buffer,
  filename: string,
  mimeType?: string
): Promise<TranscriptionResult> {
  const target = resolveSttTarget(getSettings);
  if (!target) {
    return {
      text: null,
      errorMessage: "STT 未配置。请在 AI Settings 里选择可用的 STT 模型并填写 API 配置。"
    };
  }

  const url = buildApiUrl(target.baseUrl, target.path, "/v1/audio/transcriptions");
  const form = new FormData();
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  const normalizedFilename = ensureAudioFilename(filename, normalizedMimeType);
  let lastErrorMessage: string | null = null;

  for (let attempt = 1; attempt <= FEISHU_STT_MAX_ATTEMPTS; attempt += 1) {
    momLog("feishu", "voice_transcription_target", {
      url,
      model: target.model,
      hasApiKey: Boolean(target.apiKey),
      attempt,
      maxAttempts: FEISHU_STT_MAX_ATTEMPTS
    });

    const form = new FormData();
    form.append("model", target.model);
    if (config.telegramSttLanguage) {
      form.append("language", config.telegramSttLanguage);
    }
    if (config.telegramSttPrompt) {
      form.append("prompt", config.telegramSttPrompt);
    }
    form.append("file", new Blob([data], { type: normalizedMimeType }), normalizedFilename);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.apiKey}`
        },
        body: form
      });
      if (!resp.ok) {
        const body = await resp.text();
        const hint = resp.status === 404
          ? "端点可能不正确，请检查 provider baseUrl/path（例如是否缺少 /v1）。"
          : "请检查 API Key、模型名、以及 provider 路径配置。";
        lastErrorMessage = `语音转写失败（HTTP ${resp.status} ${resp.statusText}）。${hint}`;
        momWarn("feishu", "voice_transcription_http_error", {
          url,
          status: resp.status,
          statusText: resp.statusText,
          body: body.slice(0, 240),
          attempt,
          maxAttempts: FEISHU_STT_MAX_ATTEMPTS
        });
        if (attempt < FEISHU_STT_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, FEISHU_STT_RETRY_DELAY_MS * attempt));
          continue;
        }
        return {
          text: null,
          errorMessage: lastErrorMessage
        };
      }

      const payload = (await resp.json()) as { text?: unknown };
      const text = String(payload.text ?? "").trim();
      if (!text) {
        lastErrorMessage = "语音转写接口返回成功，但没有返回文本内容。请检查模型兼容性。";
        if (attempt < FEISHU_STT_MAX_ATTEMPTS) {
          momWarn("feishu", "voice_transcription_empty_retry", {
            attempt,
            maxAttempts: FEISHU_STT_MAX_ATTEMPTS
          });
          await new Promise((resolve) => setTimeout(resolve, FEISHU_STT_RETRY_DELAY_MS * attempt));
          continue;
        }
        return {
          text: null,
          errorMessage: lastErrorMessage
        };
      }
      momLog("feishu", "voice_transcription_success", {
        model: target.model,
        transcriptLength: text.length,
        attempt,
        maxAttempts: FEISHU_STT_MAX_ATTEMPTS
      });
      return { text, errorMessage: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrorMessage = `语音转写请求异常：${message}`;
      momWarn("feishu", "voice_transcription_failed", {
        error: message,
        attempt,
        maxAttempts: FEISHU_STT_MAX_ATTEMPTS
      });
      if (attempt < FEISHU_STT_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, FEISHU_STT_RETRY_DELAY_MS * attempt));
        continue;
      }
      return {
        text: null,
        errorMessage: lastErrorMessage
      };
    }
  }

  return {
    text: null,
    errorMessage: lastErrorMessage || "语音转写失败。"
  };
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
