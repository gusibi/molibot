import type { ChannelPlugin } from "../channels/registry.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../settings/index.js";

export type InstalledPluginKind = "channel" | "provider" | "feature" | "memory-backend";
export type InstalledPluginSource = "built-in" | "external";
export type InstalledPluginStatus = "active" | "error" | "discovered";

export interface PluginManifest {
  kind: InstalledPluginKind;
  key: string;
  name: string;
  version: string;
  entry?: string;
  description?: string;
}

export interface ProviderPlugin {
  key: string;
  name: string;
  version?: string;
  description?: string;
}

export interface FeaturePlugin {
  key: string;
  name: string;
  version?: string;
  description?: string;
}

export interface FeaturePluginContext {
  getSettings: () => RuntimeSettings;
}

export type PluginSettingFieldType = "boolean" | "text" | "password" | "select";

export interface PluginSettingFieldOption {
  value: string;
  label: string;
}

export interface PluginSettingField {
  key: string;
  label: string;
  type: PluginSettingFieldType;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | boolean;
  options?: PluginSettingFieldOption[];
}

export interface InstalledPluginCatalogEntry {
  kind: InstalledPluginKind;
  key: string;
  name: string;
  version: string;
  description?: string;
  source: InstalledPluginSource;
  status: InstalledPluginStatus;
  enabled?: boolean;
  manifestPath?: string;
  entryPath?: string;
  error?: string;
  settingsKey?: string;
  settingsFields?: PluginSettingField[];
}

export interface PluginCatalog {
  channels: InstalledPluginCatalogEntry[];
  providers: InstalledPluginCatalogEntry[];
  features: InstalledPluginCatalogEntry[];
  memoryBackends: InstalledPluginCatalogEntry[];
}

export interface ExternalPluginLoadResult {
  channelPlugins: ChannelPlugin<any>[];
  providerPlugins: ProviderPlugin[];
  featurePlugins: FeaturePlugin[];
  catalog: PluginCatalog;
}

export interface BuiltInFeaturePlugin extends FeaturePlugin {
  settingsKey: keyof RuntimeSettings["plugins"];
  settingsFields?: PluginSettingField[];
  isEnabled: (settings: RuntimeSettings) => boolean;
  buildPromptSection?: (settings: RuntimeSettings) => string | null;
  createTools?: (context: FeaturePluginContext) => AgentTool<any>[];
}
