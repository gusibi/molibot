import {
  sanitizeCloudflareHtmlPluginSettings,
  sanitizeHookPluginEntries
} from "../sanitize.js";
import { defaultRuntimeSettings } from "../defaults.js";
import type { RuntimeSettings } from "../schema.js";
import { validatePluginSettings } from "../validators.js";
import type { SettingsAccessor } from "./locale.js";

export type PluginsConfig = RuntimeSettings["plugins"];

export function readPluginsConfig(runtime: SettingsAccessor): PluginsConfig {
  return runtime.getSettings().plugins;
}

export function updatePluginsConfig(
  runtime: SettingsAccessor,
  pluginsPatch: Record<string, unknown>
): PluginsConfig {
  const current = runtime.getSettings();
  const merged: Record<string, unknown> = { ...current.plugins };

  if (pluginsPatch.memory && typeof pluginsPatch.memory === "object") {
    const mem = pluginsPatch.memory as Record<string, unknown> & {
      enabled?: unknown;
      backend?: unknown;
      core?: unknown;
      dailyMaterials?: unknown;
    };
    const currentMem = current.plugins.memory;
    const memoryPatch = Object.fromEntries(Object.entries(mem).filter(([key]) => key !== "core"));
    merged.memory = {
      ...currentMem,
      ...memoryPatch,
      enabled: mem.enabled === undefined ? currentMem.enabled : Boolean(mem.enabled),
      backend: String(mem.backend ?? mem.core ?? currentMem.backend ?? "").trim()
        || currentMem.backend
        || defaultRuntimeSettings.plugins.memory.backend,
      dailyMaterials: mem.dailyMaterials && typeof mem.dailyMaterials === "object"
        ? { ...currentMem.dailyMaterials, ...mem.dailyMaterials as Record<string, unknown> }
        : currentMem.dailyMaterials
    };
  }

  if (pluginsPatch.cloudflareHtml !== undefined) {
    merged.cloudflareHtml = sanitizeCloudflareHtmlPluginSettings(
      pluginsPatch.cloudflareHtml,
      current.plugins.cloudflareHtml
    );
  }
  if (pluginsPatch.hooks !== undefined) {
    merged.hooks = sanitizeHookPluginEntries(pluginsPatch.hooks);
  }

  for (const [key, value] of Object.entries(pluginsPatch)) {
    if (key === "memory" || key === "cloudflareHtml" || key === "hooks") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = { ...((current.plugins as Record<string, unknown>)[key] as Record<string, unknown> | undefined) ?? {}, ...value as Record<string, unknown> };
    }
  }

  const plugins = merged as unknown as PluginsConfig;
  const validationError = validatePluginSettings(current, { plugins });
  if (validationError) throw new Error(validationError);

  return runtime.updateSettings({ plugins }).plugins;
}
