import type {
  DesktopPluginItem,
  DesktopPluginKind,
  DesktopPluginSource,
  DesktopPluginStatus,
  DesktopPluginsSummary
} from "$lib/shared/desktop";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { PluginCatalog, PluginSettingField } from "$lib/server/plugins/types";
import { getProjectStore } from "$lib/server/projects/store";
import { buildModelOptions } from "$lib/server/settings/modelSwitch";
import { isAbsolute } from "node:path";

const KNOWN_KINDS: readonly DesktopPluginKind[] = ["channel", "provider", "feature", "memory-backend"];
const KNOWN_STATUSES: readonly DesktopPluginStatus[] = ["active", "error", "discovered"];

/**
 * The slice of an installed plugin catalog entry the Desktop mapper reads. The
 * `manifestPath`/`entryPath` (absolute on-disk paths) and `settingsFields`
 * (field definitions that can describe credential inputs) exist on the source
 * entry but are intentionally untyped here so they are dropped.
 */
interface SharedPluginEntry {
  kind?: string;
  key: string;
  name: string;
  version?: string;
  description?: string;
  source?: string;
  status?: string;
  enabled?: boolean;
  error?: string;
  settingsKey?: string;
  settingsFields?: PluginSettingField[];
}

interface SharedPluginCatalog {
  channels?: SharedPluginEntry[];
  providers?: SharedPluginEntry[];
  features?: SharedPluginEntry[];
  memoryBackends?: SharedPluginEntry[];
}

function coerceKind(value: unknown): DesktopPluginKind {
  return (KNOWN_KINDS as readonly string[]).includes(value as string)
    ? (value as DesktopPluginKind)
    : "feature";
}

function coerceStatus(value: unknown): DesktopPluginStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value as string)
    ? (value as DesktopPluginStatus)
    : "discovered";
}

/**
 * Maps an installed plugin catalog entry into a path-safe Desktop view. The
 * absolute `manifestPath`/`entryPath` and the `settingsFields` definitions are
 * dropped — the desktop list only needs identity, version, source, status, and
 * enabled state.
 */
export function buildDesktopPluginItem(entry: SharedPluginEntry, kindHint: DesktopPluginKind): DesktopPluginItem {
  return {
    kind: entry.kind ? coerceKind(entry.kind) : kindHint,
    key: entry.key,
    name: entry.name || entry.key,
    version: entry.version ?? "",
    description: entry.description ?? "",
    source: entry.source === "external" ? "external" : "built-in",
    status: coerceStatus(entry.status),
    enabled: entry.enabled !== false,
    error: entry.error ?? ""
  };
}

// Text-model options for the daily-materials scan-model picker. Tolerant of a
// partial settings object (buildModelOptions can throw on incomplete input).
function scanModelOptions(settings?: RuntimeSettings): Array<{ value: string; label: string }> {
  if (!settings) return [];
  try {
    return buildModelOptions(settings, "text").map((option) => ({ value: option.key, label: option.label }));
  } catch {
    return [];
  }
}

export function buildDesktopPluginsSummary(catalog: SharedPluginCatalog, settings?: RuntimeSettings, projects: Array<{ value: string; label: string }> = []): DesktopPluginsSummary {
  const groups: Array<[DesktopPluginKind, SharedPluginEntry[] | undefined]> = [
    ["channel", catalog.channels],
    ["provider", catalog.providers],
    ["feature", catalog.features],
    ["memory-backend", catalog.memoryBackends]
  ];

  const items: DesktopPluginItem[] = [];
  for (const [kind, entries] of groups) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) items.push(buildDesktopPluginItem(entry, kind));
  }

  return {
    items,
    counts: {
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      external: items.filter((item) => item.source === "external").length
    },
    memory: {
      enabled: settings?.plugins.memory.enabled ?? false,
      backend: settings?.plugins.memory.backend ?? "json-file",
      embeddingProviderId: settings?.plugins.memory.embeddingProviderId ?? "",
      embeddingModel: settings?.plugins.memory.embeddingModel ?? "",
      reflectionTime: settings?.plugins.memory.reflectionTime ?? "03:00",
      reflectionNotifications: settings?.plugins.memory.reflectionNotifications ?? true,
      dailyMaterials: settings?.plugins.memory.dailyMaterials ?? { enabled: false, time: "23:30", projectId: "", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true, scanTokenBudget: 120000, scanModelKey: "" },
      projects,
      scanModels: scanModelOptions(settings),
      embeddingProviders: (settings?.customProviders ?? []).filter((provider) => provider.enabled).map((provider) => ({ value: provider.id, label: provider.name || provider.id })),
      backends: [
        { value: "json-file", label: "json-file" },
        ...((catalog.memoryBackends ?? []).filter((entry) => entry.key !== "json-file").map((entry) => ({ value: entry.key, label: entry.name || entry.key })))
      ]
    },
    featureSettings: (catalog.features ?? []).filter((entry) => entry.settingsKey && entry.settingsFields?.length).map((entry) => {
      const pluginSettings = settings ? (settings.plugins as unknown as Record<string, Record<string, unknown>>)[entry.settingsKey!] ?? {} : {};
      return {
        pluginKey: entry.key,
        name: entry.name || entry.key,
        description: entry.description ?? "",
        fields: (entry.settingsFields ?? []).map((field) => {
          const raw = pluginSettings[field.key] ?? field.defaultValue ?? (field.type === "boolean" ? false : "");
          return {
            pluginKey: entry.key,
            key: field.key,
            label: field.label,
            type: field.type,
            description: field.description ?? "",
            placeholder: field.placeholder ?? "",
            required: field.required === true,
            options: field.options?.map((option) => ({ ...option })) ?? [],
            value: field.type === "password" ? "" : field.type === "boolean" ? Boolean(raw) : String(raw ?? ""),
            configured: field.type === "password" && Boolean(raw)
          };
        })
      };
    })
  };
}

export function buildDesktopPluginsSettings(settings: RuntimeSettings, catalog: PluginCatalog, input: import("$lib/shared/desktop").DesktopPluginsUpdateRequest, projects = getProjectStore()): RuntimeSettings["plugins"] {
  const allowedBackends = new Set(["json-file", ...catalog.memoryBackends.map((entry) => entry.key)]);
  if (!allowedBackends.has(input.memoryBackend)) throw new Error("Unknown memory backend");
  const next = structuredClone(settings.plugins) as unknown as Record<string, unknown>;
  const dailyMaterials = input.memoryDailyMaterials ?? settings.plugins.memory.dailyMaterials ?? { enabled: false, time: "23:30", projectId: "", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true, scanTokenBudget: 120000, scanModelKey: "" };
  const projectId = String(dailyMaterials?.projectId ?? "").trim();
  if (projectId && !projects.get(projectId)) throw new Error("Unknown daily materials project");
  const relativeSetting = (value: unknown, fallback: string): string => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return fallback;
    if (isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) throw new Error("Daily materials paths must stay relative to the project");
    return normalized;
  };
  next.memory = {
    enabled: input.memoryEnabled,
    backend: input.memoryBackend,
    embeddingProviderId: String(input.memoryEmbeddingProviderId ?? "").trim(),
    embeddingModel: String(input.memoryEmbeddingModel ?? "").trim(),
    reflectionTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.memoryReflectionTime) ? input.memoryReflectionTime : "03:00",
    reflectionNotifications: Boolean(input.memoryReflectionNotifications),
    dailyMaterials: {
      enabled: Boolean(dailyMaterials?.enabled),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(dailyMaterials?.time ?? "")) ? dailyMaterials.time : "23:30",
      projectId,
      dir: relativeSetting(dailyMaterials?.dir, "content/daily-materials"),
      promptPath: relativeSetting(dailyMaterials?.promptPath, "templates/daily-material-prompt.md"),
      notifications: Boolean(dailyMaterials?.notifications),
      scanTokenBudget: (() => {
        const n = Number(dailyMaterials?.scanTokenBudget);
        if (!Number.isFinite(n) || n <= 0) return 120000;
        return Math.min(900000, Math.max(8000, Math.round(n)));
      })(),
      scanModelKey: String(dailyMaterials?.scanModelKey ?? "").trim()
    }
  };

  for (const plugin of catalog.features) {
    if (!plugin.settingsKey || !plugin.settingsFields?.length) continue;
    const current = { ...((next[plugin.settingsKey] as Record<string, unknown> | undefined) ?? {}) };
    const values = input.values[plugin.key] ?? {};
    const secrets = input.secretValues?.[plugin.key] ?? {};
    const clearSecrets = new Set(input.clearSecrets?.[plugin.key] ?? []);
    for (const field of plugin.settingsFields) {
      if (field.type === "password") {
        if (clearSecrets.has(field.key)) current[field.key] = "";
        else if (String(secrets[field.key] ?? "").trim()) current[field.key] = String(secrets[field.key]).trim();
        continue;
      }
      if (!(field.key in values)) continue;
      const value = values[field.key];
      if (field.type === "boolean") current[field.key] = Boolean(value);
      else if (field.type === "select") {
        const normalized = String(value ?? "").trim();
        if (!(field.options ?? []).some((option) => option.value === normalized)) throw new Error(`Invalid value for ${field.key}`);
        current[field.key] = normalized;
      } else current[field.key] = String(value ?? "").trim();
    }
    next[plugin.settingsKey] = current;
  }
  return next as unknown as RuntimeSettings["plugins"];
}
