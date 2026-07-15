import {
  sanitizeAiRoutingConfig,
  sanitizeCompaction,
  sanitizeModelFallback,
  sanitizeModelRoutingConfig
} from "../sanitize.js";
import { isKnownProvider, type RuntimeSettings } from "../schema.js";
import { validateTimezonePatch } from "../validators.js";
import type { SettingsAccessor } from "./locale.js";

export interface AiRoutingConfig {
  providerMode: RuntimeSettings["providerMode"];
  piModelProvider: RuntimeSettings["piModelProvider"];
  piModelName: RuntimeSettings["piModelName"];
  defaultThinkingLevel: RuntimeSettings["defaultThinkingLevel"];
  defaultCustomProviderId: RuntimeSettings["defaultCustomProviderId"];
  modelRouting: RuntimeSettings["modelRouting"];
  modelFallback: RuntimeSettings["modelFallback"];
  compaction: RuntimeSettings["compaction"];
  systemPrompt: RuntimeSettings["systemPrompt"];
  timezone: RuntimeSettings["timezone"];
}

export function readAiRoutingConfig(runtime: SettingsAccessor): AiRoutingConfig {
  const s = runtime.getSettings();
  return {
    providerMode: s.providerMode,
    piModelProvider: s.piModelProvider,
    piModelName: s.piModelName,
    defaultThinkingLevel: s.defaultThinkingLevel,
    defaultCustomProviderId: s.defaultCustomProviderId,
    modelRouting: s.modelRouting,
    modelFallback: s.modelFallback,
    compaction: s.compaction,
    systemPrompt: s.systemPrompt,
    timezone: s.timezone
  };
}

export function updateAiRoutingConfig(runtime: SettingsAccessor, patch: Partial<AiRoutingConfig> & Record<string, unknown>): AiRoutingConfig {
  const current = runtime.getSettings();
  const sanitized = sanitizeAiRoutingConfig(patch, current);

  const selectable = (current.customProviders ?? []).filter((p) =>
    !isKnownProvider(p.id) &&
    p.models.some((m) => Array.isArray(m.tags) ? m.tags.includes("text") : true)
  );
  const enabledCustom = selectable.filter((p) => p.enabled !== false);
  if (sanitized.defaultCustomProviderId !== undefined) {
    const target = String(sanitized.defaultCustomProviderId ?? "").trim();
    if (target && !enabledCustom.some((p) => p.id === target)) {
      sanitized.defaultCustomProviderId = enabledCustom[0]?.id ?? selectable[0]?.id ?? "";
    }
  }

  const tzError = validateTimezonePatch(current, sanitized);
  if (tzError) throw new Error(tzError);

  const updated = runtime.updateSettings(sanitized);
  return {
    providerMode: updated.providerMode,
    piModelProvider: updated.piModelProvider,
    piModelName: updated.piModelName,
    defaultThinkingLevel: updated.defaultThinkingLevel,
    defaultCustomProviderId: updated.defaultCustomProviderId,
    modelRouting: updated.modelRouting,
    modelFallback: updated.modelFallback,
    compaction: updated.compaction,
    systemPrompt: updated.systemPrompt,
    timezone: updated.timezone
  };
}

export { sanitizeModelRoutingConfig, sanitizeModelFallback, sanitizeCompaction };
