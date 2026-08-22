import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { isValidPluginId, pluginPackageDir } from "$lib/server/plugins/contract/paths.js";
import { readMolibotPluginManifest } from "$lib/server/plugins/contract/manifest.js";
import { getPluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import type { ValidatedPluginManifest, MolibotPluginManifest } from "$lib/server/plugins/contract/types.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

/**
 * Public catalog representation of an installable Molibot plugin (issue #34).
 *
 * Exposes opaque identity, metadata, status, health, and settings capabilities
 * only - never absolute filesystem paths, internal stack traces, or secret
 * values.
 */
export interface PluginCatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  source: {
    kind: "builtin" | "directory" | "npm" | "git";
    label?: string;
  };
  status: "active" | "disabled" | "error" | "incompatible";
  enabled: boolean;
  error?: string;
  hasSettings: boolean;
  settingsMode?: "schema" | "custom";
  iconUri?: string;
  capabilities: string[];
}

export interface PluginDetailResponse {
  item: PluginCatalogItem;
  manifest?: MolibotPluginManifest;
  /** Present for schema-mode plugins only. */
  schema?: Record<string, unknown>;
  presentation?: import("$lib/server/plugins/contract/types.js").PluginSchemaFieldPresentation[];
  /** Non-secret settings values from disk. */
  settingsValues?: Record<string, unknown>;
  /** Presence metadata for secrets (never raw values). */
  secretsPresence?: Record<string, { present: boolean }>;
  /** Retained state flags for the lifecycle cards. */
  retainedState: {
    hasConfig: boolean;
    hasData: boolean;
    hasCache: boolean;
  };
}

export class PluginContractCatalog {
  /**
   * Discovers and validates all packages under `<dataDir>/plugins/packages/`.
   * Invalid packages remain visible in the catalog with status: "error" so the
   * owner can diagnose or uninstall them.
   */
  listPlugins(settings?: RuntimeSettings): PluginCatalogItem[] {
    const packagesDir = storagePaths.pluginsPackagesDir;
    if (!fs.existsSync(packagesDir)) return [];

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(packagesDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const items: PluginCatalogItem[] = [];
    const entries = settings?.plugins?.entries ?? {};

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const pluginId = dirent.name;
      if (!isValidPluginId(pluginId)) continue;

      const packageDir = pluginPackageDir(pluginId);
      if (packageDir === null) continue;

      const entrySettings = entries[pluginId];
      const enabled = entrySettings?.enabled ?? false;
      const source = entrySettings?.source ?? { kind: "directory", label: "packages" };

      const validated = readMolibotPluginManifest(packageDir, pluginId);
      if (!validated.ok) {
        items.push({
          id: pluginId,
          name: pluginId,
          version: "0.0.0",
          description: "Invalid plugin manifest",
          source: { kind: source.kind, label: (source as any).label ?? (source as any).package ?? (source as any).repo },
          status: "error",
          enabled,
          error: validated.error,
          hasSettings: false,
          capabilities: []
        });
        continue;
      }

      const manifest = validated.value.manifest;
      const hasSettings = manifest.settings !== undefined;
      const settingsMode = manifest.settings?.mode;
      const iconUri = manifest.settings?.mode === "custom" && manifest.settings.ui.icon
        ? `/plugins/${pluginId}/ui/${manifest.settings.ui.icon.replace(/^ui\//, "")}`
        : undefined;

      items.push({
        id: pluginId,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        source: { kind: source.kind, label: (source as any).label ?? (source as any).package ?? (source as any).repo },
        status: enabled ? "active" : "disabled",
        enabled,
        hasSettings,
        settingsMode,
        iconUri,
        capabilities: manifest.capabilities ?? []
      });
    }

    // Sort by name
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Retrieves full details for a single plugin.
   */
  getPluginDetail(pluginId: string, settings?: RuntimeSettings): PluginDetailResponse | null {
    if (!isValidPluginId(pluginId)) return null;
    const packageDir = pluginPackageDir(pluginId);
    if (packageDir === null) return null;

    const validated = readMolibotPluginManifest(packageDir, pluginId);
    const entrySettings = settings?.plugins?.entries?.[pluginId];
    const enabled = entrySettings?.enabled ?? false;
    const source = entrySettings?.source ?? { kind: "directory", label: "packages" };

    const configStore = getPluginConfigStore();
    const configDir = path.join(storagePaths.pluginsConfigDir, pluginId);
    const dataDir = path.join(storagePaths.pluginsDataDir, pluginId);
    const cacheDir = path.join(storagePaths.pluginsCacheDir, pluginId);

    const retainedState = {
      hasConfig: fs.existsSync(configDir),
      hasData: fs.existsSync(dataDir),
      hasCache: fs.existsSync(cacheDir)
    };

    if (!validated.ok) {
      return {
        item: {
          id: pluginId,
          name: pluginId,
          version: "0.0.0",
          description: "Invalid plugin manifest",
          source: { kind: source.kind, label: (source as any).label },
          status: "error",
          enabled,
          error: validated.error,
          hasSettings: false,
          capabilities: []
        },
        retainedState
      };
    }

    const manifest = validated.value.manifest;
    const hasSettings = manifest.settings !== undefined;
    const settingsMode = manifest.settings?.mode;
    const iconUri = manifest.settings?.mode === "custom" && manifest.settings.ui.icon
      ? `/plugins/${pluginId}/ui/${manifest.settings.ui.icon.replace(/^ui\//, "")}`
      : undefined;

    let settingsValues: Record<string, unknown> | undefined;
    let schema: Record<string, unknown> | undefined;
    let presentation: import("$lib/server/plugins/contract/types.js").PluginSchemaFieldPresentation[] | undefined;

    if (manifest.settings?.mode === "schema") {
      schema = manifest.settings.schema;
      presentation = manifest.settings.presentation;
    }
    if (manifest.settings) {
      const readRes = configStore.readConfig(pluginId, manifest.config.schemaVersion);
      if (readRes.status === "ok") {
        settingsValues = readRes.values;
      }
    }

    const secretsPresence = configStore.listSecrets(pluginId);

    return {
      item: {
        id: pluginId,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        source: { kind: source.kind, label: (source as any).label },
        status: enabled ? "active" : "disabled",
        enabled,
        hasSettings,
        settingsMode,
        iconUri,
        capabilities: manifest.capabilities ?? []
      },
      manifest,
      schema,
      presentation,
      settingsValues,
      secretsPresence,
      retainedState
    };
  }
}

let catalogInstance: PluginContractCatalog | null = null;

export function getPluginContractCatalog(): PluginContractCatalog {
  if (catalogInstance === null) catalogInstance = new PluginContractCatalog();
  return catalogInstance;
}
