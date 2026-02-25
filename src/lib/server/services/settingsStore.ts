import {
  defaultRuntimeSettings,
  type ModelCapabilityTag,
  type ProviderModelConfig,
  type CustomProviderConfig,
  type TelegramBotConfig,
  isKnownProvider,
  type ProviderMode,
  type RuntimeSettings
} from "../config.js";
import { readJsonFile, storagePaths, writeJsonFile } from "../db/sqlite.js";

interface RawSettings {
  providerMode?: string;
  piModelProvider?: string;
  piModelName?: string;
  customProviders?: unknown;
  defaultCustomProviderId?: string;
  modelRouting?: {
    textModelKey?: string;
    visionModelKey?: string;
    sttModelKey?: string;
    ttsModelKey?: string;
  };
  systemPrompt?: string;
  plugins?: {
    memory?: {
      enabled?: boolean | string;
      core?: string;
    };
  };
  telegramBots?: unknown;
  telegramBotToken?: string;
  telegramAllowedChatIds?: string[] | string;
  customAiBaseUrl?: string;
  customAiApiKey?: string;
  customAiModel?: string;
  customAiPath?: string;
}

type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
const DEFAULT_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "stt", "tts", "tool"]);
const DEFAULT_MODEL_TAGS: ModelCapabilityTag[] = ["text"];

function sanitizeRoles(input: unknown): ModelRole[] {
  if (!Array.isArray(input)) return [...DEFAULT_ROLES];
  const out: ModelRole[] = [];
  const dedup = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim();
    if (!ROLE_SET.has(value) || dedup.has(value)) continue;
    dedup.add(value);
    out.push(value as ModelRole);
  }
  return out.length > 0 ? out : [...DEFAULT_ROLES];
}

function sanitizeModelTags(input: unknown): ModelCapabilityTag[] {
  if (!Array.isArray(input)) return [...DEFAULT_MODEL_TAGS];
  const out: ModelCapabilityTag[] = [];
  const dedup = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim();
    if (!CAPABILITY_SET.has(value) || dedup.has(value)) continue;
    dedup.add(value);
    out.push(value as ModelCapabilityTag);
  }
  return out.length > 0 ? out : [...DEFAULT_MODEL_TAGS];
}

function sanitizeModels(
  item: Record<string, unknown>,
  providerRoles: ModelRole[]
): { models: ProviderModelConfig[]; defaultModel: string } {
  const legacySingle = String(item.model ?? "").trim();
  const rawModels = Array.isArray(item.models) ? item.models : [];
  const models: ProviderModelConfig[] = [];
  for (const row of rawModels) {
    if (typeof row === "string") {
      const id = row.trim();
      if (id) models.push({ id, tags: [...DEFAULT_MODEL_TAGS], supportedRoles: [...providerRoles] });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const id = String(obj.id ?? obj.model ?? "").trim();
    if (!id) continue;
    models.push({
      id,
      tags: sanitizeModelTags(obj.tags),
      supportedRoles: sanitizeRoles(obj.supportedRoles ?? providerRoles)
    });
  }

  if (models.length === 0 && legacySingle) {
    models.push({ id: legacySingle, tags: [...DEFAULT_MODEL_TAGS], supportedRoles: [...providerRoles] });
  }

  const defaultModelRaw = String(item.defaultModel ?? "").trim();
  const ids = models.map((m) => m.id);
  const defaultModel = ids.includes(defaultModelRaw) ? defaultModelRaw : (ids[0] ?? "");
  return { models, defaultModel };
}

function sanitizeMode(input: unknown): ProviderMode {
  return String(input ?? "").toLowerCase() === "custom" ? "custom" : "pi";
}

function sanitizeCustomProviders(input: unknown): CustomProviderConfig[] {
  if (!Array.isArray(input)) return [];

  const out: CustomProviderConfig[] = [];
  const dedup = new Set<string>();

  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id ?? "").trim() || `custom-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);

    const providerRoles = sanitizeRoles(item.supportedRoles);
    const { models, defaultModel } = sanitizeModels(item, providerRoles);

    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      baseUrl: String(item.baseUrl ?? "").trim(),
      apiKey: String(item.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(item.path ?? "").trim() || "/v1/chat/completions"
    });
  }

  return out;
}

function sanitizeList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeTelegramBots(input: unknown): TelegramBotConfig[] {
  if (!Array.isArray(input)) return [];

  const out: TelegramBotConfig[] = [];
  const dedup = new Set<string>();

  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const token = String(item.token ?? "").trim();
    if (!token) continue;

    const idRaw = String(item.id ?? "").trim();
    const id = idRaw || `bot-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);

    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      token,
      allowedChatIds: sanitizeList(item.allowedChatIds)
    });
  }

  return out;
}

function migrateLegacyCustomProvider(raw: RawSettings): CustomProviderConfig[] {
  const baseUrl = String(raw.customAiBaseUrl ?? "").trim();
  const apiKey = String(raw.customAiApiKey ?? "").trim();
  const model = String(raw.customAiModel ?? "").trim();
  const path = String(raw.customAiPath ?? "").trim() || "/v1/chat/completions";
  if (!baseUrl && !apiKey && !model) return [];

  return [
    {
      id: "custom-legacy",
      name: "Custom (legacy)",
      baseUrl,
      apiKey,
      models: model ? [{ id: model, tags: ["text"], supportedRoles: [...DEFAULT_ROLES] }] : [],
      defaultModel: model,
      path
    }
  ];
}

function sanitize(raw: RawSettings): RuntimeSettings {
  const piProviderRaw = String(raw.piModelProvider ?? defaultRuntimeSettings.piModelProvider).trim();
  const providers = sanitizeCustomProviders(raw.customProviders);
  const customProviders = providers.length > 0 ? providers : migrateLegacyCustomProvider(raw);

  let defaultCustomProviderId = String(raw.defaultCustomProviderId ?? "").trim();
  if (!customProviders.some((p) => p.id === defaultCustomProviderId)) {
    defaultCustomProviderId = customProviders[0]?.id ?? "";
  }

  const telegramBotsFromList = sanitizeTelegramBots(raw.telegramBots);
  const fallbackToken = String(raw.telegramBotToken ?? defaultRuntimeSettings.telegramBotToken).trim();
  const fallbackAllowed = sanitizeList(raw.telegramAllowedChatIds);
  const telegramBots = telegramBotsFromList.length > 0
    ? telegramBotsFromList
    : (fallbackToken
        ? [{
            id: "default",
            name: "Default Bot",
            token: fallbackToken,
            allowedChatIds: fallbackAllowed
          }]
        : []);
  const primaryBot = telegramBots[0];
  const memoryEnabledRaw = raw.plugins?.memory?.enabled;
  const memoryEnabled = typeof memoryEnabledRaw === "boolean"
    ? memoryEnabledRaw
    : String(memoryEnabledRaw ?? "").toLowerCase() === "true";
  const memoryCore = String(raw.plugins?.memory?.core ?? "").trim() ||
    defaultRuntimeSettings.plugins.memory.core;

  return {
    providerMode: sanitizeMode(raw.providerMode ?? defaultRuntimeSettings.providerMode),
    piModelProvider: isKnownProvider(piProviderRaw)
      ? piProviderRaw
      : defaultRuntimeSettings.piModelProvider,
    piModelName: String(raw.piModelName ?? defaultRuntimeSettings.piModelName).trim() ||
      defaultRuntimeSettings.piModelName,
    customProviders,
    defaultCustomProviderId,
    modelRouting: {
      textModelKey: String(raw.modelRouting?.textModelKey ?? "").trim(),
      visionModelKey: String(raw.modelRouting?.visionModelKey ?? "").trim(),
      sttModelKey: String(raw.modelRouting?.sttModelKey ?? "").trim(),
      ttsModelKey: String(raw.modelRouting?.ttsModelKey ?? "").trim()
    },
    systemPrompt:
      String(raw.systemPrompt ?? defaultRuntimeSettings.systemPrompt).trim() ||
      defaultRuntimeSettings.systemPrompt,
    telegramBots,
    plugins: {
      memory: {
        enabled: memoryEnabled,
        core: memoryCore
      }
    },
    telegramBotToken: primaryBot?.token ?? "",
    telegramAllowedChatIds: primaryBot?.allowedChatIds ?? []
  };
}

export class SettingsStore {
  load(): RuntimeSettings {
    const raw = readJsonFile<RawSettings>(storagePaths.settingsFile, {});
    return sanitize(raw);
  }

  save(settings: RuntimeSettings): void {
    writeJsonFile(storagePaths.settingsFile, settings);
  }
}
