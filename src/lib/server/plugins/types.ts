import type { ChannelPlugin } from "../channels/registry.js";

export type InstalledPluginKind = "channel" | "provider";
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

export interface InstalledPluginCatalogEntry {
  kind: InstalledPluginKind;
  key: string;
  name: string;
  version: string;
  description?: string;
  source: InstalledPluginSource;
  status: InstalledPluginStatus;
  manifestPath?: string;
  entryPath?: string;
  error?: string;
}

export interface PluginCatalog {
  channels: InstalledPluginCatalogEntry[];
  providers: InstalledPluginCatalogEntry[];
}

export interface ExternalPluginLoadResult {
  channelPlugins: ChannelPlugin<any>[];
  providerPlugins: ProviderPlugin[];
  catalog: PluginCatalog;
}
