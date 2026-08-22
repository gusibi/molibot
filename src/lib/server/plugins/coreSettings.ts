import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { updatePluginsConfig, type PluginsConfig } from "$lib/server/settings/handlers/plugins.js";
import type { SettingsAccessor } from "$lib/server/settings/handlers/locale.js";

export type CoreSettingsPluginId = "memory" | "daily-materials";

export interface CoreSettingsPluginItem {
  id: CoreSettingsPluginId;
  name: string;
  description: string;
  version: "built-in";
  enabled: boolean;
  settingsHref: string;
  source: { kind: "builtin" };
}

export function isCoreSettingsPluginId(value: string): value is CoreSettingsPluginId {
  return value === "memory" || value === "daily-materials";
}

export function listCoreSettingsPlugins(settings: RuntimeSettings): CoreSettingsPluginItem[] {
  return [
    {
      id: "memory",
      name: "Memory Backend",
      description: "Configure memory storage, reflection, and embedding behavior.",
      version: "built-in",
      enabled: settings.plugins.memory.enabled,
      settingsHref: "/settings/plugins/memory",
      source: { kind: "builtin" }
    },
    {
      id: "daily-materials",
      name: "Daily Materials",
      description: "Review authorized conversations and write daily material into a project.",
      version: "built-in",
      enabled: settings.plugins.memory.dailyMaterials.enabled,
      settingsHref: "/settings/plugins/daily-materials",
      source: { kind: "builtin" }
    }
  ];
}

export function setCoreSettingsPluginEnabled(
  runtime: SettingsAccessor,
  pluginId: CoreSettingsPluginId,
  enabled: boolean
): PluginsConfig {
  if (pluginId === "memory") {
    return updatePluginsConfig(runtime, { memory: { enabled } });
  }
  return updatePluginsConfig(runtime, { memory: { dailyMaterials: { enabled } } });
}
