import { config } from "$lib/server/app/env.js";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export interface SttTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
  providerId: string;
  verification: "untested" | "passed" | "failed" | "missing";
  declared: boolean;
}

export interface TranscriptionResult {
  text: string | null;
  errorMessage: string | null;
}

interface SttOptions {
  channel: string;
  settings: RuntimeSettings;
  data: Buffer;
  filename: string;
  mimeType?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const STT_DIAGNOSTIC_RESPONSE_HEADERS = new Set([
  "cf-ray",
  "content-length",
  "content-type",
  "request-id",
  "retry-after",
  "server",
  "trace-id",
  "x-request-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "x-siliconcloud-trace-id"
]);

function redactDiagnosticText(value: string, secrets: string[]): string {
  let text = value.trim().replace(/\s+/g, " ");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("<redacted>");
  }
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/([?&](?:api_?key|client_secret|token|access_token|refresh_token)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/("(?:api_?key|client_secret|access_token|refresh_token|token)"\s*:\s*")[^"]+("?)/gi, "$1<redacted>$2")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "<redacted-token>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted-token>")
    .slice(0, 400);
}

function collectDiagnosticResponseHeaders(headers: Headers, secrets: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (STT_DIAGNOSTIC_RESPONSE_HEADERS.has(normalizedName)) {
      result[normalizedName] = redactDiagnosticText(value, secrets);
    }
  }
  return result;
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

export function resolveSttTarget(settings: RuntimeSettings): SttTarget | null {
  const routed = parseModelKey(settings.modelRouting.sttModelKey);
  if (routed?.mode === "custom") {
    const provider = settings.customProviders.find((p) => p.id === routed.provider && p.enabled !== false);
    const configuredModel = provider?.models.find((m) => m.id === routed.model);
    if (provider?.baseUrl && provider.apiKey && routed.model) {
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: routed.model,
        path: provider.path,
        providerId: provider.id,
        verification: configuredModel?.verification?.stt ?? "missing",
        declared: Boolean(configuredModel?.tags?.includes("stt"))
      };
    }
  }

  for (const provider of settings.customProviders) {
    if (provider.enabled === false) continue;
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;
    const sttModel = provider.models.find((m) => m.id?.trim() && Array.isArray(m.tags) && m.tags.includes("stt"));
    if (!sttModel) continue;
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: sttModel.id,
      path: provider.path,
      providerId: provider.id,
      verification: sttModel.verification?.stt ?? "missing",
      declared: true
    };
  }

  if (!config.telegramSttApiKey || !config.telegramSttModel) return null;
  return {
    baseUrl: config.telegramSttBaseUrl,
    apiKey: config.telegramSttApiKey,
    model: config.telegramSttModel,
    path: "/v1/audio/transcriptions",
    providerId: "builtin-telegram-stt",
    verification: "untested",
    declared: true
  };
}

export async function transcribeAudioViaConfiguredProvider({
  channel,
  settings,
  data,
  filename,
  mimeType,
  maxAttempts = 1,
  retryDelayMs = 0
}: SttOptions): Promise<TranscriptionResult> {
  const target = resolveSttTarget(settings);
  if (!target) {
    return {
      text: null,
      errorMessage: "STT 未配置。请在 AI Settings 里选择可用的 STT 模型并填写 API 配置。"
    };
  }

  const url = buildApiUrl(target.baseUrl, target.path, "/v1/audio/transcriptions");
  const safeUrl = redactDiagnosticText(url, [target.apiKey]);
  const effectiveMimeType = mimeType || "audio/ogg";
  const safeFilename = redactDiagnosticText(filename, [target.apiKey]) || "<empty>";
  const safeMimeType = redactDiagnosticText(effectiveMimeType, [target.apiKey]) || "<unknown>";
  let lastErrorMessage: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    momLog(channel, "voice_transcription_target", {
      url: safeUrl,
      providerId: target.providerId,
      model: target.model,
      hasApiKey: Boolean(target.apiKey),
      filename: safeFilename,
      mimeType: safeMimeType,
      audioBytes: data.byteLength,
      attempt,
      maxAttempts
    });

    const form = new FormData();
    form.append("model", target.model);
    if (config.telegramSttLanguage) {
      form.append("language", config.telegramSttLanguage);
    }
    if (config.telegramSttPrompt) {
      form.append("prompt", config.telegramSttPrompt);
    }
    form.append(
      "file",
      new Blob([new Uint8Array(data)], { type: effectiveMimeType }),
      filename
    );

    const requestStartedAt = Date.now();
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.apiKey}`
        },
        body: form
      });

      if (!resp.ok) {
        const rawBody = await resp.text();
        const responseBody = redactDiagnosticText(rawBody, [target.apiKey]) || "<empty>";
        const hint = resp.status === 404
          ? "端点可能不正确，请检查 provider baseUrl/path（例如是否缺少 /v1）。"
          : "请检查 API Key、模型名、以及 provider 路径配置。";
        lastErrorMessage = `语音转写失败（HTTP ${resp.status} ${resp.statusText}）。${hint}`;
        momWarn(channel, "voice_transcription_http_error", {
          url: safeUrl,
          providerId: target.providerId,
          model: target.model,
          filename: safeFilename,
          mimeType: safeMimeType,
          audioBytes: data.byteLength,
          requestDurationMs: Date.now() - requestStartedAt,
          status: resp.status,
          statusText: resp.statusText,
          responseBody,
          responseBodyEmpty: rawBody.trim().length === 0,
          responseHeaders: collectDiagnosticResponseHeaders(resp.headers, [target.apiKey]),
          attempt,
          maxAttempts
        });
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
          continue;
        }
        return { text: null, errorMessage: lastErrorMessage };
      }

      const payload = (await resp.json()) as { text?: unknown };
      const text = String(payload.text ?? "").trim();
      if (!text) {
        lastErrorMessage = "语音转写接口返回成功，但没有返回文本内容。请检查模型兼容性。";
        if (attempt < maxAttempts) {
          momWarn(channel, "voice_transcription_empty_retry", {
            attempt,
            maxAttempts
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
          continue;
        }
        return { text: null, errorMessage: lastErrorMessage };
      }

      momLog(channel, "voice_transcription_success", {
        providerId: target.providerId,
        model: target.model,
        filename: safeFilename,
        mimeType: safeMimeType,
        audioBytes: data.byteLength,
        requestDurationMs: Date.now() - requestStartedAt,
        transcriptLength: text.length,
        attempt,
        maxAttempts
      });
      return { text, errorMessage: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = redactDiagnosticText(message, [target.apiKey]) || "unknown error";
      lastErrorMessage = `语音转写请求异常：${safeMessage}`;
      momWarn(channel, "voice_transcription_failed", {
        url: safeUrl,
        providerId: target.providerId,
        model: target.model,
        filename: safeFilename,
        mimeType: safeMimeType,
        audioBytes: data.byteLength,
        requestDurationMs: Date.now() - requestStartedAt,
        error: safeMessage,
        attempt,
        maxAttempts
      });
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }
      return { text: null, errorMessage: lastErrorMessage };
    }
  }

  return {
    text: null,
    errorMessage: lastErrorMessage || "语音转写失败。"
  };
}
