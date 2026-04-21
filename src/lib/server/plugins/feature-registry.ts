import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../settings/index.js";
import { cloudflareHtmlFeaturePlugin } from "./cloudflareHtml/plugin.js";
import type { BuiltInFeaturePlugin, FeaturePluginContext, InstalledPluginCatalogEntry } from "./types.js";

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
