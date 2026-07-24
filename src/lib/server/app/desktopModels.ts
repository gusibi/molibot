import {
  buildModelOptions,
  currentModelKey,
  type ModelRoute
} from "$lib/server/settings/modelSwitch";
import type { RuntimeSettings } from "$lib/server/settings";
import type { DesktopModelRoutingSettings, DesktopModelRoutingUpdateRequest, DesktopModelState } from "$lib/shared/desktop";

export const desktopModelRoutes: readonly ModelRoute[] = [
  "text",
  "vision",
  "stt",
  "tts",
  "subagent"
];

export function sanitizeDesktopModelRoute(input: unknown): ModelRoute {
  const value = String(input ?? "").trim();
  return (desktopModelRoutes as readonly string[]).includes(value) ? (value as ModelRoute) : "text";
}

export function buildDesktopModelState(
  settings: RuntimeSettings,
  route: ModelRoute = "text"
): DesktopModelState {
  return {
    currentKey: currentModelKey(settings, route),
    options: buildModelOptions(settings, route).map((option) => ({
      key: option.key,
      label: option.label,
      contextWindow: option.contextWindow
    }))
  };
}

function textOptions(settings: RuntimeSettings) {
  return buildModelOptions(settings, "text").map((option) => ({
    key: option.key,
    label: option.label,
    contextWindow: option.contextWindow
  }));
}

/**
 * Validates a per-session text-model override key. An empty string is valid and
 * means "clear the override / follow the global default". A non-empty key must
 * match a currently-listed text option — this rejects stale/unresolvable keys up
 * front instead of letting the runner silently fall back to another model.
 */
export function isValidSessionTextModelKey(settings: RuntimeSettings, key: string): boolean {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) return true;
  return textOptions(settings).some((option) => option.key === trimmed);
}

export function buildDesktopModelRoutingSettings(settings: RuntimeSettings): DesktopModelRoutingSettings {
  return {
    compactionModelKey: settings.modelRouting.compactionModelKey ?? "",
    subagentHaikuModelKey: settings.modelRouting.subagentHaikuModelKey ?? "",
    subagentSonnetModelKey: settings.modelRouting.subagentSonnetModelKey ?? "",
    subagentOpusModelKey: settings.modelRouting.subagentOpusModelKey ?? "",
    subagentThinkingModelKey: settings.modelRouting.subagentThinkingModelKey ?? "",
    modelFallback: { ...settings.modelFallback },
    defaultThinkingLevel: settings.defaultThinkingLevel,
    compaction: { ...settings.compaction },
    timezone: settings.timezone,
    textOptions: textOptions(settings)
  };
}

export function buildDesktopModelRoutingPatch(
  settings: RuntimeSettings,
  request: DesktopModelRoutingUpdateRequest
): Pick<RuntimeSettings, "modelRouting" | "modelFallback" | "defaultThinkingLevel" | "compaction" | "timezone"> {
  const optionKeys = new Set(textOptions(settings).map((option) => option.key));
  const routeKey = (value: unknown): string => {
    const key = String(value ?? "").trim();
    return !key || optionKeys.has(key) ? key : "";
  };
  const fallbackMode = request.modelFallback?.mode;
  const thinking = request.defaultThinkingLevel;
  return {
    modelRouting: {
      ...settings.modelRouting,
      compactionModelKey: routeKey(request.compactionModelKey),
      subagentHaikuModelKey: routeKey(request.subagentHaikuModelKey),
      subagentSonnetModelKey: routeKey(request.subagentSonnetModelKey),
      subagentOpusModelKey: routeKey(request.subagentOpusModelKey),
      subagentThinkingModelKey: routeKey(request.subagentThinkingModelKey)
    },
    modelFallback: {
      mode: fallbackMode === "off" || fallbackMode === "any-enabled" ? fallbackMode : "same-provider",
      firstTokenTimeoutMs: Number(request.modelFallback?.firstTokenTimeoutMs)
    },
    defaultThinkingLevel: thinking === "off" || thinking === "low" || thinking === "high" ? thinking : "medium",
    compaction: {
      enabled: request.compaction?.enabled !== false,
      thresholdPercent: Number(request.compaction?.thresholdPercent),
      reserveTokens: Number(request.compaction?.reserveTokens),
      keepRecentTokens: Number(request.compaction?.keepRecentTokens),
      defaultContextWindow: Number(request.compaction?.defaultContextWindow)
    },
    timezone: String(request.timezone ?? "").trim()
  };
}
