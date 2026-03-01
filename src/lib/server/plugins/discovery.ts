import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { config, KNOWN_PROVIDER_LIST } from "../config.js";
import { builtInChannelPlugins } from "../channels/registry.js";
import { builtInMemoryBackends } from "../memory/registry.js";
import type {
  ExternalPluginLoadResult,
  InstalledPluginCatalogEntry,
  PluginCatalog,
  PluginManifest,
  ProviderPlugin
} from "./types.js";

function readManifest(filePath: string): PluginManifest | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PluginManifest;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.kind || !parsed.key || !parsed.name || !parsed.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

function listPluginDirs(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir)
    .map((name) => join(rootDir, name))
    .filter((full) => {
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    });
}

function discoverExternalCatalogEntries(kind: "channel" | "provider"): InstalledPluginCatalogEntry[] {
  const rootDir = resolve(config.dataDir, "plugins", kind === "channel" ? "channels" : "providers");
  const entries: InstalledPluginCatalogEntry[] = [];

  for (const pluginDir of listPluginDirs(rootDir)) {
    const manifestPath = join(pluginDir, "plugin.json");
    if (!existsSync(manifestPath)) {
      entries.push({
        kind,
        key: pluginDir.split("/").pop() ?? "unknown",
        name: pluginDir.split("/").pop() ?? "unknown",
        version: "unknown",
        source: "external",
        status: "error",
        manifestPath,
        error: "Missing plugin.json"
      });
      continue;
    }

    const manifest = readManifest(manifestPath);
    if (!manifest || manifest.kind !== kind) {
      entries.push({
        kind,
        key: pluginDir.split("/").pop() ?? "unknown",
        name: pluginDir.split("/").pop() ?? "unknown",
        version: "unknown",
        source: "external",
        status: "error",
        manifestPath,
        error: "Invalid plugin manifest"
      });
      continue;
    }

    const entryPath = manifest.entry ? resolve(pluginDir, manifest.entry) : undefined;
    entries.push({
      kind,
      key: manifest.key,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      source: "external",
      status: entryPath ? (existsSync(entryPath) ? "discovered" : "error") : "discovered",
      manifestPath,
      entryPath,
      error: entryPath && !existsSync(entryPath) ? `Missing entry module: ${manifest.entry}` : undefined
    });
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function buildBuiltInChannelCatalog(): InstalledPluginCatalogEntry[] {
  return builtInChannelPlugins.map((plugin) => ({
    kind: "channel",
    key: plugin.key,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    source: "built-in",
    status: "active"
  }));
}

function buildBuiltInProviderCatalog(): InstalledPluginCatalogEntry[] {
  return KNOWN_PROVIDER_LIST.map((provider) => ({
    kind: "provider",
    key: provider,
    name: provider,
    version: "built-in",
    source: "built-in",
    status: "active"
  }));
}

function buildBuiltInMemoryBackendCatalog(): InstalledPluginCatalogEntry[] {
  return builtInMemoryBackends.map((backend) => ({
    kind: "memory-backend",
    key: backend.key,
    name: backend.name,
    version: "built-in",
    description: backend.description,
    source: "built-in",
    status: "active"
  }));
}

export function discoverPlugins(): ExternalPluginLoadResult {
  const channels = [
    ...buildBuiltInChannelCatalog(),
    ...discoverExternalCatalogEntries("channel")
  ];

  const providers = [
    ...buildBuiltInProviderCatalog(),
    ...discoverExternalCatalogEntries("provider")
  ];

  const memoryBackends = buildBuiltInMemoryBackendCatalog();

  const catalog: PluginCatalog = { channels, providers, memoryBackends };

  const providerPlugins: ProviderPlugin[] = providers.map((provider) => ({
    key: provider.key,
    name: provider.name,
    version: provider.version,
    description: provider.description
  }));

  return {
    channelPlugins: builtInChannelPlugins,
    providerPlugins,
    catalog
  };
}
