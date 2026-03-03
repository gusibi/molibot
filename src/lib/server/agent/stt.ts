import { config } from "../app/env.js";
import { momLog, momWarn } from "./log.js";
import type { RuntimeSettings } from "../settings/index.js";

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
    const provider = settings.customProviders.find((p) => p.id === routed.provider);
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
  let lastErrorMessage: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    momLog(channel, "voice_transcription_target", {
      url,
      model: target.model,
      hasApiKey: Boolean(target.apiKey),
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
      new Blob([new Uint8Array(data)], { type: mimeType || "audio/ogg" }),
      filename
    );

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
        momWarn(channel, "voice_transcription_http_error", {
          url,
          status: resp.status,
          statusText: resp.statusText,
          body: body.slice(0, 240),
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
        model: target.model,
        transcriptLength: text.length,
        attempt,
        maxAttempts
      });
      return { text, errorMessage: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrorMessage = `语音转写请求异常：${message}`;
      momWarn(channel, "voice_transcription_failed", {
        error: message,
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
