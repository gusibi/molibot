import type { AdaptiveThinkingSettings, RuntimeSettings } from "$lib/server/settings/index.js";
import { sanitizeAdaptiveThinkingSettings } from "$lib/server/settings/sanitize.js";
import { TypeSafeJevProvider } from "$lib/server/agent/decision/adaptiveThinking.js";
import type { SettingsAccessor } from "./locale.js";

export interface AdaptiveThinkingConfig
  extends Omit<AdaptiveThinkingSettings, "apiKey"> {
  hasApiKey: boolean;
}

function project(settings: AdaptiveThinkingSettings): AdaptiveThinkingConfig {
  const { apiKey: _apiKey, ...safe } = settings;
  return { ...safe, hasApiKey: Boolean(settings.apiKey) };
}

export function readAdaptiveThinkingConfig(runtime: SettingsAccessor): AdaptiveThinkingConfig {
  return project(runtime.getSettings().adaptiveThinking);
}

export function updateAdaptiveThinkingConfig(
  runtime: SettingsAccessor,
  input: Record<string, unknown>
): AdaptiveThinkingConfig {
  const current = runtime.getSettings().adaptiveThinking;
  const requestedBaseUrl = input.baseUrl === undefined
    ? current.baseUrl
    : String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const baseUrlChanged = requestedBaseUrl !== current.baseUrl;
  const hasNewKey = typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
  const clearKey = input.clearApiKey === true;
  if (baseUrlChanged && current.apiKey && !hasNewKey && !clearKey) {
    throw new Error("Changing the Jev Host requires entering a new API key for that host.");
  }

  const patch: Partial<AdaptiveThinkingSettings> = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    baseUrl: requestedBaseUrl,
    defaultStrategy: input.defaultStrategy === "auto" || input.defaultStrategy === "fixed"
      ? input.defaultStrategy
      : undefined,
    maxThinkingLevel: input.maxThinkingLevel as RuntimeSettings["adaptiveThinking"]["maxThinkingLevel"],
    fallbackThinkingLevel: input.fallbackThinkingLevel as RuntimeSettings["adaptiveThinking"]["fallbackThinkingLevel"],
    confidenceThreshold: input.confidenceThreshold as number,
    timeoutMs: input.timeoutMs as number
  };
  if (hasNewKey) patch.apiKey = input.apiKey as string;
  else if (clearKey) patch.apiKey = "";
  else patch.apiKey = current.apiKey;

  const sanitized = sanitizeAdaptiveThinkingSettings(patch, current);
  const updated = runtime.updateSettings({ adaptiveThinking: sanitized });
  return project(updated.adaptiveThinking);
}

export async function testAdaptiveThinkingConnection(input: {
  baseUrl: unknown;
  apiKey: unknown;
  timeoutMs?: unknown;
}): Promise<{ provider?: string; model?: string }> {
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(input.apiKey ?? "").trim();
  if (!baseUrl || !apiKey) throw new Error("Jev Host and API key are required.");
  const timeoutRaw = Number(input.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(100, Math.min(5000, Math.round(timeoutRaw))) : 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await new TypeSafeJevProvider().testConnection({ baseUrl, apiKey, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
