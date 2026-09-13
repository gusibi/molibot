import type { ChannelPlugin } from "$lib/server/channels/registry.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export type InstalledPluginKind = "channel" | "provider" | "feature" | "memory-backend" | "extension" | "miniapp";
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
  replyToMessageId?: string;
  resolveMessageRunIds?: (messageId: string) => string[];
  traceScope?: { channel: string; botId?: string; chatId: string; sessionId: string };
  runId?: string;
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  /**
   * The creating attempt's effective execution mode. Plugins whose tools
   * delegate to external runtimes translate it instead of keeping their own
   * permission settings; absent (direct construction outside a run) they fall
   * back to the global default mode.
   */
  executionMode?: "plan" | "manual" | "accept_edits" | "auto";
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
  /** Third-party pi extensions installed under `${DATA_DIR}/extensions`. */
  extensions: InstalledPluginCatalogEntry[];
  /** Mini Apps installed under `${DATA_DIR}/miniapps/apps`. */
  miniApps: InstalledPluginCatalogEntry[];
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
