import type { ImageContent } from "@mariozechner/pi-ai";
import type { CustomProviderProtocol, RuntimeSettings } from "../settings/index.js";
import { normalizeProviderBaseUrl, normalizeProviderPath, resolveCustomProviderProtocol } from "../providers/customProtocol.js";
import { momLog, momWarn } from "./log.js";

export interface VisionFallbackTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
  protocol: CustomProviderProtocol;
  providerId: string;
  verification: "untested" | "passed" | "failed" | "missing";
  declared: boolean;
}

export interface VisionAnalysisResult {
  text: string | null;
  errorMessage: string | null;
}

interface VisionFallbackOptions {
  channel: string;
  settings: RuntimeSettings;
  image: ImageContent;
  label?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
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

function buildApiUrl(baseUrl: string, path: string | undefined, protocol: CustomProviderProtocol): string {
  return `${normalizeProviderBaseUrl(baseUrl)}${normalizeProviderPath(path, protocol)}`;
}

function findCustomVisionTarget(
  settings: RuntimeSettings,
  routeKey: string,
): VisionFallbackTarget | null {
  const routed = parseModelKey(routeKey);
  if (routed?.mode !== "custom") return null;
  const provider = settings.customProviders.find((row) => row.id === routed.provider && row.enabled !== false);
  const configuredModel = provider?.models.find((row) => row.id === routed.model);
  if (!provider?.baseUrl?.trim() || !provider.apiKey?.trim() || !routed.model) return null;
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: routed.model,
    path: provider.path,
    protocol: resolveCustomProviderProtocol(provider.protocol),
    providerId: provider.id,
    verification: configuredModel?.verification?.vision ?? "missing",
    declared: Boolean(configuredModel?.tags?.includes("vision"))
  };
}

export function resolveVisionFallbackTarget(settings: RuntimeSettings): VisionFallbackTarget | null {
  const candidates = [
    findCustomVisionTarget(settings, settings.modelRouting.visionModelKey),
    findCustomVisionTarget(settings, settings.modelRouting.textModelKey)
  ].filter((item): item is VisionFallbackTarget => Boolean(item));

  for (const candidate of candidates) {
    if (candidate.declared) return candidate;
  }

  for (const provider of settings.customProviders) {
    if (provider.enabled === false) continue;
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;
    const visionModel = provider.models.find((row) => row.id?.trim() && Array.isArray(row.tags) && row.tags.includes("vision"));
    if (!visionModel) continue;
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: visionModel.id,
      path: provider.path,
      protocol: resolveCustomProviderProtocol(provider.protocol),
      providerId: provider.id,
      verification: visionModel.verification?.vision ?? "missing",
      declared: true
    };
  }

  return candidates[0] ?? null;
}

function extractText(payload: any): string {
  if (Array.isArray(payload?.content)) {
    return payload.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  const message = payload?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export async function describeImageViaConfiguredProvider({
  channel,
  settings,
  image,
  label,
  maxAttempts = 1,
  retryDelayMs = 0
}: VisionFallbackOptions): Promise<VisionAnalysisResult> {
  const target = resolveVisionFallbackTarget(settings);
  if (!target || !target.declared) {
    return {
      text: null,
      errorMessage: "图片理解 fallback 未配置。请在 AI Settings 里声明并选择可用的 vision 模型。"
    };
  }

  const url = buildApiUrl(target.baseUrl, target.path, target.protocol);
  let lastErrorMessage: string | null = null;
  const imageLabel = String(label ?? "image").trim() || "image";
  const mimeType = String(image.mimeType || "image/jpeg").trim() || "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${image.data}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    momLog(channel, "image_analysis_target", {
      url,
      model: target.model,
      providerId: target.providerId,
      verification: target.verification,
      attempt,
      maxAttempts
    });

    try {
      const isAnthropic = target.protocol === "anthropic";
      const resp = await fetch(url, {
        method: "POST",
        headers: isAnthropic
          ? {
              "Content-Type": "application/json",
              "x-api-key": target.apiKey,
              "anthropic-version": "2023-06-01"
            }
          : {
              "Content-Type": "application/json",
              Authorization: `Bearer ${target.apiKey}`
            },
        body: JSON.stringify(isAnthropic
          ? {
              model: target.model,
              system: "You are an image understanding bridge for a text-only assistant. Be factual, concise, and avoid guessing beyond visible evidence.",
              max_tokens: 600,
              messages: [{
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      `Analyze ${imageLabel} for a text-only assistant.`,
                      "Return exactly these sections in plain text:",
                      "Description: <brief visual summary>",
                      "Visible text: <OCR text, or (none)>",
                      "Important details: <objects, UI state, errors, charts, or cues the assistant should know>",
                      "If something is uncertain, say uncertain instead of guessing."
                    ].join("\n")
                  },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType,
                      data: image.data
                    }
                  }
                ]
              }]
            }
          : {
              model: target.model,
              temperature: 0,
              max_tokens: 600,
              messages: [
                {
                  role: "system",
                  content: "You are an image understanding bridge for a text-only assistant. Be factual, concise, and avoid guessing beyond visible evidence."
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: [
                        `Analyze ${imageLabel} for a text-only assistant.`,
                        "Return exactly these sections in plain text:",
                        "Description: <brief visual summary>",
                        "Visible text: <OCR text, or (none)>",
                        "Important details: <objects, UI state, errors, charts, or cues the assistant should know>",
                        "If something is uncertain, say uncertain instead of guessing."
                      ].join("\n")
                    },
                    {
                      type: "image_url",
                      image_url: { url: dataUrl }
                    }
                  ]
                }
              ]
            })
      });

      if (!resp.ok) {
        const body = await resp.text();
        const hint = resp.status === 404
          ? "端点可能不正确，请检查 provider baseUrl/path（例如是否缺少 /v1/chat/completions）。"
          : "请检查 API Key、模型名、vision 能力声明，以及 provider 路径配置。";
        lastErrorMessage = `图片分析失败（HTTP ${resp.status} ${resp.statusText}）。${hint}`;
        momWarn(channel, "image_analysis_http_error", {
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

      const payload = await resp.json();
      const text = extractText(payload);
      if (!text) {
        lastErrorMessage = "图片分析接口返回成功，但没有返回文本内容。请检查 vision 模型兼容性。";
        if (attempt < maxAttempts) {
          momWarn(channel, "image_analysis_empty_retry", {
            attempt,
            maxAttempts
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
          continue;
        }
        return { text: null, errorMessage: lastErrorMessage };
      }

      momLog(channel, "image_analysis_success", {
        model: target.model,
        providerId: target.providerId,
        textLength: text.length,
        attempt,
        maxAttempts
      });
      return { text, errorMessage: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrorMessage = `图片分析请求异常：${message}`;
      momWarn(channel, "image_analysis_failed", {
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
    errorMessage: lastErrorMessage || "图片分析失败。"
  };
}
