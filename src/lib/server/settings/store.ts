import { DatabaseSync } from "node:sqlite";
import {
  type AgentSettings,
  type ChannelSettingsMap,
  defaultRuntimeSettings,
  type ModelCapabilityTag,
  type ModelCapabilityVerification,
  type ProviderModelConfig,
  type CustomProviderConfig,
  type TelegramBotConfig,
  type FeishuBotConfig,
  isKnownProvider,
  type ProviderMode,
  type RuntimeSettings
} from "../settings/index.js";
import { readJsonFile, storagePaths, writeJsonFile } from "../infra/db/storage.js";

type DynamicSettingKey = "customProviders" | "channels" | "agents";
const DYNAMIC_SETTING_KEYS: DynamicSettingKey[] = ["customProviders", "channels", "agents"];

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
      backend?: string;
      core?: string;
    };
  };
  telegramBots?: unknown;
  agents?: unknown;
  channels?: unknown;
  telegramBotToken?: string;
  telegramAllowedChatIds?: string[] | string;
  customAiBaseUrl?: string;
  customAiApiKey?: string;
  customAiModel?: string;
  customAiPath?: string;
  timezone?: string;
  feishuBots?: unknown;
}

type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
const DEFAULT_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const CAPABILITY_VERIFICATION_SET: ReadonlySet<string> = new Set(["untested", "passed", "failed"]);
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

function sanitizeVerification(
  input: unknown
): Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const out: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey).trim();
    const value = String(rawValue ?? "").trim();
    if (!CAPABILITY_SET.has(key) || !CAPABILITY_VERIFICATION_SET.has(value)) continue;
    out[key as ModelCapabilityTag] = value as ModelCapabilityVerification;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
      supportedRoles: sanitizeRoles(obj.supportedRoles ?? providerRoles),
      verification: sanitizeVerification(obj.verification)
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
      enabled: item.enabled === undefined ? !isKnownProvider(id) : Boolean(item.enabled),
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

function sanitizeAgents(input: unknown): AgentSettings[] {
  if (!Array.isArray(input)) return [];

  const out: AgentSettings[] = [];
  const dedup = new Set<string>();

  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    if (!id || dedup.has(id)) continue;
    dedup.add(id);
    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      description: String(item.description ?? "").trim(),
      enabled: item.enabled === undefined ? true : Boolean(item.enabled)
    });
  }

  return out;
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

function sanitizeFeishuBots(input: unknown): FeishuBotConfig[] {
  if (!Array.isArray(input)) return [];

  const out: FeishuBotConfig[] = [];
  const dedup = new Set<string>();

  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const appId = String(item.appId ?? "").trim();
    const appSecret = String(item.appSecret ?? "").trim();
    if (!appId || !appSecret) continue;

    const idRaw = String(item.id ?? "").trim();
    const id = idRaw || `feishu-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);

    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      appId,
      appSecret,
      allowedChatIds: sanitizeList(item.allowedChatIds)
    });
  }

  return out;
}

function sanitizeChannels(
  input: unknown,
  telegramBots: TelegramBotConfig[],
  feishuBots: FeishuBotConfig[]
): ChannelSettingsMap {
  const channels: ChannelSettingsMap = {};
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const hasExplicitTelegram = Object.prototype.hasOwnProperty.call(source, "telegram");
  const hasExplicitFeishu = Object.prototype.hasOwnProperty.call(source, "feishu");

  for (const [key, rawValue] of Object.entries(source)) {
    if (!rawValue || typeof rawValue !== "object") continue;
    const rawInstances = Array.isArray((rawValue as { instances?: unknown }).instances)
      ? ((rawValue as { instances: unknown[] }).instances ?? [])
      : [];
    const instances = rawInstances
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const id = String(item.id ?? "").trim();
        if (!id) return null;
        const credentialsSource = item.credentials && typeof item.credentials === "object"
          ? item.credentials as Record<string, unknown>
          : {};
        return {
          id,
          name: String(item.name ?? "").trim() || id,
          enabled: item.enabled === undefined ? true : Boolean(item.enabled),
          agentId: String(item.agentId ?? "").trim(),
          credentials: Object.fromEntries(
            Object.entries(credentialsSource)
              .map(([credKey, credValue]) => [credKey, String(credValue ?? "").trim()])
              .filter(([, credValue]) => Boolean(credValue))
          ),
          allowedChatIds: sanitizeList(item.allowedChatIds)
        };
      })
      .filter(Boolean) as ChannelSettingsMap[string]["instances"];

    channels[key] = { instances };
  }

  channels.telegram = channels.telegram ?? (hasExplicitTelegram ? channels.telegram : undefined) ?? {
    instances: telegramBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      agentId: "",
      credentials: { token: bot.token },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.feishu = channels.feishu ?? (hasExplicitFeishu ? channels.feishu : undefined) ?? {
    instances: feishuBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      agentId: "",
      credentials: { appId: bot.appId, appSecret: bot.appSecret },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  return channels;
}

function deriveTelegramBotsFromChannels(channels: ChannelSettingsMap): TelegramBotConfig[] {
  const instances = channels.telegram?.instances ?? [];
  const out: TelegramBotConfig[] = [];
  for (const instance of instances) {
    const token = String(instance.credentials?.token ?? "").trim();
    if (!token) continue;
    out.push({
      id: instance.id,
      name: instance.name || instance.id,
      token,
      allowedChatIds: Array.isArray(instance.allowedChatIds) ? instance.allowedChatIds : []
    });
  }
  return out;
}

function deriveFeishuBotsFromChannels(channels: ChannelSettingsMap): FeishuBotConfig[] {
  const instances = channels.feishu?.instances ?? [];
  const out: FeishuBotConfig[] = [];
  for (const instance of instances) {
    const appId = String(instance.credentials?.appId ?? "").trim();
    const appSecret = String(instance.credentials?.appSecret ?? "").trim();
    if (!appId || !appSecret) continue;
    out.push({
      id: instance.id,
      name: instance.name || instance.id,
      appId,
      appSecret,
      allowedChatIds: Array.isArray(instance.allowedChatIds) ? instance.allowedChatIds : []
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
      enabled: true,
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
  const enabledCustomProviders = customProviders.filter((p) => p.enabled !== false);
  if (!enabledCustomProviders.some((p) => p.id === defaultCustomProviderId)) {
    defaultCustomProviderId = enabledCustomProviders[0]?.id ?? customProviders[0]?.id ?? "";
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
  const memoryEnabledRaw = raw.plugins?.memory?.enabled;
  const memoryEnabled = typeof memoryEnabledRaw === "boolean"
    ? memoryEnabledRaw
    : String(memoryEnabledRaw ?? "").toLowerCase() === "true";
  const memoryBackend = String(raw.plugins?.memory?.backend ?? raw.plugins?.memory?.core ?? "").trim() ||
    defaultRuntimeSettings.plugins.memory.backend;

  const feishuBotsFromList = sanitizeFeishuBots(raw.feishuBots);
  const feishuBots = feishuBotsFromList.length > 0 ? feishuBotsFromList : [];
  const channels = sanitizeChannels(raw.channels, telegramBots, feishuBots);
  const effectiveTelegramBots = telegramBots.length > 0 ? telegramBots : deriveTelegramBotsFromChannels(channels);
  const effectiveFeishuBots = feishuBots.length > 0 ? feishuBots : deriveFeishuBotsFromChannels(channels);
  const primaryBot = effectiveTelegramBots[0];
  const agents = sanitizeAgents(raw.agents);

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
    agents,
    channels,
    telegramBots: effectiveTelegramBots,
    plugins: {
      memory: {
        enabled: memoryEnabled,
        backend: memoryBackend
      }
    },
    timezone: String(raw.timezone ?? "").trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
    telegramBotToken: primaryBot?.token ?? "",
    telegramAllowedChatIds: primaryBot?.allowedChatIds ?? [],
    feishuBots: effectiveFeishuBots
  };
}

export class SettingsStore {
  private openDynamicDb(): DatabaseSync {
    const db = new DatabaseSync(storagePaths.settingsDbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings_dynamic (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_channel_instances (
        channel_key TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        credentials_json TEXT NOT NULL,
        allowed_chat_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_key, id)
      );
      CREATE TABLE IF NOT EXISTS settings_custom_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        default_model TEXT NOT NULL,
        path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_custom_provider_models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        supported_roles_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE INDEX IF NOT EXISTS idx_settings_channel_instances_channel ON settings_channel_instances(channel_key);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_provider ON settings_custom_provider_models(provider_id);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_order ON settings_custom_provider_models(provider_id, order_index);
    `);
    return db;
  }

  private parseDynamicValue<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private loadLegacyDynamicSettings(db: DatabaseSync): Partial<RawSettings> {
    const dynamic: Partial<RawSettings> = {};
    const rows = db.prepare("SELECT key, value_json FROM settings_dynamic").all() as Array<{ key: string; value_json: string }>;
    for (const row of rows) {
      if (row.key === "customProviders") {
        dynamic.customProviders = this.parseDynamicValue(row.value_json, []);
      } else if (row.key === "channels") {
        dynamic.channels = this.parseDynamicValue(row.value_json, {});
      } else if (row.key === "agents") {
        dynamic.agents = this.parseDynamicValue(row.value_json, []);
      }
    }
    return dynamic;
  }

  private loadDynamicSettings(): Partial<RawSettings> {
    const db = this.openDynamicDb();
    try {
      const legacy = this.loadLegacyDynamicSettings(db);

      const agentsRows = db.prepare("SELECT id, name, description, enabled FROM settings_agents ORDER BY id ASC").all() as Array<{
        id: string;
        name: string;
        description: string;
        enabled: number;
      }>;
      const agents = agentsRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: Boolean(row.enabled)
      }));

      const channelRows = db.prepare(`
        SELECT channel_key, id, name, enabled, agent_id, credentials_json, allowed_chat_ids_json
        FROM settings_channel_instances
        ORDER BY channel_key ASC, id ASC
      `).all() as Array<{
        channel_key: string;
        id: string;
        name: string;
        enabled: number;
        agent_id: string;
        credentials_json: string;
        allowed_chat_ids_json: string;
      }>;
      const channels: ChannelSettingsMap = {};
      for (const row of channelRows) {
        channels[row.channel_key] = channels[row.channel_key] ?? { instances: [] };
        channels[row.channel_key].instances.push({
          id: row.id,
          name: row.name || row.id,
          enabled: Boolean(row.enabled),
          agentId: row.agent_id || "",
          credentials: this.parseDynamicValue(row.credentials_json, {}),
          allowedChatIds: this.parseDynamicValue(row.allowed_chat_ids_json, [])
        });
      }

      const providerRows = db.prepare(`
        SELECT id, name, enabled, base_url, api_key, default_model, path
        FROM settings_custom_providers
        ORDER BY id ASC
      `).all() as Array<{
        id: string;
        name: string;
        enabled: number;
        base_url: string;
        api_key: string;
        default_model: string;
        path: string;
      }>;
      const modelRows = db.prepare(`
        SELECT provider_id, model_id, tags_json, supported_roles_json, verification_json
        FROM settings_custom_provider_models
        ORDER BY provider_id ASC, order_index ASC, model_id ASC
      `).all() as Array<{
        provider_id: string;
        model_id: string;
        tags_json: string;
        supported_roles_json: string;
        verification_json: string;
      }>;
      const modelsByProvider = new Map<string, ProviderModelConfig[]>();
      for (const row of modelRows) {
        const list = modelsByProvider.get(row.provider_id) ?? [];
        list.push({
          id: row.model_id,
          tags: this.parseDynamicValue(row.tags_json, []),
          supportedRoles: this.parseDynamicValue(row.supported_roles_json, []),
          verification: this.parseDynamicValue(row.verification_json, undefined)
        });
        modelsByProvider.set(row.provider_id, list);
      }
      const customProviders = providerRows.map((row) => ({
        id: row.id,
        name: row.name || row.id,
        enabled: Boolean(row.enabled),
        baseUrl: row.base_url,
        apiKey: row.api_key,
        models: modelsByProvider.get(row.id) ?? [],
        defaultModel: row.default_model,
        path: row.path
      }));

      return {
        agents: agents.length > 0 ? agents : legacy.agents,
        channels: Object.keys(channels).length > 0 ? channels : legacy.channels,
        customProviders: customProviders.length > 0 ? customProviders : legacy.customProviders
      };
    } finally {
      db.close();
    }
  }

  private saveDynamicSettings(settings: RuntimeSettings, keys: DynamicSettingKey[] = DYNAMIC_SETTING_KEYS): void {
    const db = this.openDynamicDb();
    try {
      const now = new Date().toISOString();
      db.exec("BEGIN");

      if (keys.includes("agents")) {
        db.exec("DELETE FROM settings_agents");
        const insertAgent = db.prepare(`
          INSERT INTO settings_agents (id, name, description, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const agent of settings.agents) {
          insertAgent.run(agent.id, agent.name, agent.description ?? "", agent.enabled ? 1 : 0, now);
        }
      }

      if (keys.includes("channels")) {
        db.exec("DELETE FROM settings_channel_instances");
        const insertChannel = db.prepare(`
          INSERT INTO settings_channel_instances
            (channel_key, id, name, enabled, agent_id, credentials_json, allowed_chat_ids_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [channelKey, channel] of Object.entries(settings.channels ?? {})) {
          for (const instance of channel.instances ?? []) {
            insertChannel.run(
              channelKey,
              instance.id,
              instance.name || instance.id,
              instance.enabled ? 1 : 0,
              instance.agentId ?? "",
              JSON.stringify(instance.credentials ?? {}),
              JSON.stringify(instance.allowedChatIds ?? []),
              now
            );
          }
        }
      }

      if (keys.includes("customProviders")) {
        db.exec("DELETE FROM settings_custom_provider_models");
        db.exec("DELETE FROM settings_custom_providers");
        const insertProvider = db.prepare(`
          INSERT INTO settings_custom_providers
            (id, name, enabled, base_url, api_key, default_model, path, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertModel = db.prepare(`
          INSERT INTO settings_custom_provider_models
            (provider_id, model_id, tags_json, supported_roles_json, verification_json, order_index, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const provider of settings.customProviders) {
          insertProvider.run(
            provider.id,
            provider.name || provider.id,
            provider.enabled ? 1 : 0,
            provider.baseUrl,
            provider.apiKey,
            provider.defaultModel,
            provider.path,
            now
          );
          for (let index = 0; index < provider.models.length; index += 1) {
            const model = provider.models[index];
            insertModel.run(
              provider.id,
              model.id,
              JSON.stringify(model.tags ?? []),
              JSON.stringify(model.supportedRoles ?? []),
              JSON.stringify(model.verification ?? null),
              index,
              now
            );
          }
        }
      }

      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private toStaticSettings(settings: RuntimeSettings): RawSettings {
    return {
      providerMode: settings.providerMode,
      piModelProvider: settings.piModelProvider,
      piModelName: settings.piModelName,
      defaultCustomProviderId: settings.defaultCustomProviderId,
      modelRouting: {
        textModelKey: settings.modelRouting.textModelKey,
        visionModelKey: settings.modelRouting.visionModelKey,
        sttModelKey: settings.modelRouting.sttModelKey,
        ttsModelKey: settings.modelRouting.ttsModelKey
      },
      systemPrompt: settings.systemPrompt,
      plugins: {
        memory: {
          enabled: settings.plugins.memory.enabled,
          backend: settings.plugins.memory.backend
        }
      },
      timezone: settings.timezone,
      telegramBotToken: settings.telegramBotToken,
      telegramAllowedChatIds: settings.telegramAllowedChatIds
    };
  }

  load(): RuntimeSettings {
    const rawStatic = readJsonFile<RawSettings>(storagePaths.settingsFile, {});
    const rawDynamic = this.loadDynamicSettings();
    const merged: RawSettings = {
      ...rawStatic,
      customProviders: rawDynamic.customProviders ?? rawStatic.customProviders,
      channels: rawDynamic.channels ?? rawStatic.channels,
      agents: rawDynamic.agents ?? rawStatic.agents
    };
    const settings = sanitize(merged);
    this.saveDynamicSettings(settings);
    return settings;
  }

  save(settings: RuntimeSettings): void {
    writeJsonFile(storagePaths.settingsFile, this.toStaticSettings(settings));
    this.saveDynamicSettings(settings);
  }
}
