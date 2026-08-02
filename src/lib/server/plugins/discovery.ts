import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import { defaultRuntimeSettings, KNOWN_PROVIDER_LIST, type RuntimeSettings } from "$lib/server/settings/index.js";
import { builtInChannelPlugins } from "$lib/server/channels/registry.js";
import { builtInMemoryBackends } from "$lib/server/memory/registry.js";
import { builtInFeaturePlugins, createFeaturePluginCatalog } from "$lib/server/plugins/feature-registry.js";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";
import type {
  ExternalPluginLoadResult,
  InstalledPluginCatalogEntry,
  PluginCatalog,
  PluginManifest,
  FeaturePlugin,
  ProviderPlugin
} from "$lib/server/plugins/types.js";

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

/**
 * Third-party pi extensions, projected into the shared catalog shape. Rows only
 * appear once the async host load finished; a still-loading host yields none.
 */
function buildPiExtensionCatalog(settings: RuntimeSettings): InstalledPluginCatalogEntry[] {
  return getPiExtensionHost().listCatalog(settings).map((entry) => ({
    kind: "extension" as const,
    key: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    source: "external" as const,
    status: entry.error ? "error" : entry.enabled ? "active" : "discovered",
    enabled: entry.enabled,
    entryPath: entry.entryPath,
    error: entry.error
  }));
}

/**
 * Mini Apps, projected from the live MiniAppHost at read time.
 *
 * Deliberately not snapshotted: a lazy-load failure or an enable toggle must be
 * visible on the very next catalog read, and the generic catalog row carries
 * only identity + status — never a manifest path, entry path or data path.
 */
function buildMiniAppCatalog(): InstalledPluginCatalogEntry[] {
  try {
    return getMiniAppHost().listCatalog().map((entry) => ({
      kind: "miniapp" as const,
      key: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      source: entry.builtin ? ("built-in" as const) : ("external" as const),
      status: entry.status === "active" ? "active" : entry.status === "error" ? "error" : "discovered",
      enabled: entry.enabled,
      error: entry.error
    }));
  } catch {
    return [];
  }
}

export function discoverPlugins(settings: RuntimeSettings = defaultRuntimeSettings): ExternalPluginLoadResult {
  const channels = [
    ...buildBuiltInChannelCatalog(),
    ...discoverExternalCatalogEntries("channel")
  ];

  const providers = [
    ...buildBuiltInProviderCatalog(),
    ...discoverExternalCatalogEntries("provider")
  ];

  const features = createFeaturePluginCatalog(settings);
  const memoryBackends = buildBuiltInMemoryBackendCatalog();

  const extensions = buildPiExtensionCatalog(settings);

  const miniApps = buildMiniAppCatalog();

  const catalog: PluginCatalog = { channels, providers, features, memoryBackends, extensions, miniApps };

  const providerPlugins: ProviderPlugin[] = providers.map((provider) => ({
    key: provider.key,
    name: provider.name,
    version: provider.version,
    description: provider.description
  }));

  const featurePlugins: FeaturePlugin[] = builtInFeaturePlugins.map((plugin) => ({
    key: plugin.key,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description
  }));

  return {
    channelPlugins: builtInChannelPlugins,
    providerPlugins,
    featurePlugins,
    catalog
  };
}
