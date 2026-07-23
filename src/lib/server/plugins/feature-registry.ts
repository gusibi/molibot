import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { cloudflareHtmlFeaturePlugin } from "$lib/server/plugins/cloudflareHtml/plugin.js";
import type { BuiltInFeaturePlugin, FeaturePluginContext, InstalledPluginCatalogEntry } from "$lib/server/plugins/types.js";

export const builtInFeaturePlugins: BuiltInFeaturePlugin[] = [
  cloudflareHtmlFeaturePlugin
];

export function createFeaturePluginCatalog(settings: RuntimeSettings): InstalledPluginCatalogEntry[] {
  return builtInFeaturePlugins.map((plugin) => ({
    kind: "feature",
    key: plugin.key,
    name: plugin.name,
    version: plugin.version ?? "built-in",
    description: plugin.description,
    source: "built-in",
    status: "active",
    enabled: plugin.isEnabled(settings),
    settingsKey: plugin.settingsKey,
    settingsFields: plugin.settingsFields
  }));
}

export function buildFeaturePluginPromptSections(settings: RuntimeSettings): string[] {
  return builtInFeaturePlugins
    .filter((plugin) => plugin.isEnabled(settings))
    .map((plugin) => plugin.buildPromptSection?.(settings) ?? "")
    .filter(Boolean);
}

export function createFeaturePluginTools(context: FeaturePluginContext): AgentTool<any>[] {
  const settings = context.getSettings();
  return builtInFeaturePlugins.flatMap((plugin) => {
    if (!plugin.isEnabled(settings)) return [];
    return plugin.createTools?.(context) ?? [];
  });
}
