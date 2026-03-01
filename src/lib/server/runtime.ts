import {
  config,
  defaultRuntimeSettings,
  isKnownProvider,
  type ProviderModelConfig,
  type ModelRole,
  type ModelCapabilityTag,
  type ChannelSettingsMap,
  type CustomProviderConfig,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type ProviderMode,
  type RuntimeSettings
} from "./config.js";
import { builtInChannelPlugins, type ChannelManager, type ChannelRuntimeDeps } from "./channels/registry.js";
import { MessageRouter } from "./core/messageRouter.js";
import { initDb } from "./db/sqlite.js";
import { MemoryGateway } from "./memory/gateway.js";
import { discoverPlugins } from "./plugins/discovery.js";
import type { PluginCatalog, ProviderPlugin } from "./plugins/types.js";
import { AssistantService } from "./services/assistant.js";
import { SessionStore } from "./services/sessionStore.js";
import { SettingsStore } from "./services/settingsStore.js";

interface RuntimeState {
  sessions: SessionStore;
  router: MessageRouter;
  channelManagers: Map<string, Map<string, ChannelManager>>;
  pluginCatalog: PluginCatalog;
  providerPlugins: ProviderPlugin[];
  memory: MemoryGateway;
  memorySyncTimer: ReturnType<typeof setInterval> | null;
  settingsStore: SettingsStore;
  settings: RuntimeSettings;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

declare global {
  // eslint-disable-next-line no-var
  var __molibotRuntime: RuntimeState | undefined;
}

const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "stt", "tts", "tool"]);
const DEFAULT_MODEL_TAGS: ModelCapabilityTag[] = ["text"];
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RED = "\x1b[31m";

function color(text: string, code: string): string {
  return `${code}${text}${ANSI_RESET}`;
}

function colorStatus(status: string): string {
  if (status === "active") return color(status, ANSI_GREEN);
  if (status === "error") return color(status, ANSI_RED);
  if (status === "discovered") return color(status, ANSI_YELLOW);
  return status;
}

function runtimeLabel(name: string): string {
  return color(`[${name}]`, `${ANSI_BOLD}${ANSI_CYAN}`);
}

function memoryLabel(name: string): string {
  return color(`[${name}]`, `${ANSI_BOLD}${ANSI_BLUE}`);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function logPluginCatalog(state: RuntimeState): void {
  const channelSummary = state.pluginCatalog.channels
    .map((plugin) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const providerSummary = state.pluginCatalog.providers
    .map((plugin) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const memoryBackendSummary = state.pluginCatalog.memoryBackends
    .map((backend) => `${backend.key}:${colorStatus(backend.status)}`)
    .join(", ");

  console.log(
    `${runtimeLabel("runtime")} plugin_catalog channels=[${channelSummary || "(none)"}] providers=[${providerSummary || "(none)"}] memory_backends=[${memoryBackendSummary || "(none)"}]`
  );
}

function logMemoryStartup(state: RuntimeState): void {
  console.log(
    `${memoryLabel("memory")} startup enabled=${state.memory.isEnabled() ? color("true", ANSI_GREEN) : color("false", ANSI_YELLOW)} selected_backend=${color(state.memory.getActiveBackendKey(), `${ANSI_BOLD}${ANSI_GREEN}`)} available_backends=[${formatList(state.memory.listAvailableBackendKeys())}] importers=[${formatList(state.memory.listImporterKeys())}]`
  );
}

function logChannelPluginApplication(state: RuntimeState, applied: Array<{ key: string; instances: string[] }>): void {
  const summary = applied
    .map(({ key, instances }) => `${color(key, `${ANSI_BOLD}${ANSI_GREEN}`)}(${instances.length}):[${formatList(instances)}]`)
    .join(" ");
  console.log(`${runtimeLabel("runtime")} channel_plugins_applied ${summary || "(none)"}`);
}

function sanitizeRoles(input: unknown): ModelRole[] {
  if (!Array.isArray(input)) return ["system", "user", "assistant", "tool"];
  const out: ModelRole[] = [];
  const dedup = new Set<string>();
  for (const row of input) {
    const role = String(row ?? "").trim();
    if (!ROLE_SET.has(role) || dedup.has(role)) continue;
    dedup.add(role);
    out.push(role as ModelRole);
  }
  return out.length > 0 ? out : ["system", "user", "assistant", "tool"];
}

function sanitizeModelTags(input: unknown): ModelCapabilityTag[] {
  if (!Array.isArray(input)) return [...DEFAULT_MODEL_TAGS];
  const out: ModelCapabilityTag[] = [];
  const dedup = new Set<string>();
  for (const row of input) {
    const value = String(row ?? "").trim();
    if (!CAPABILITY_SET.has(value) || dedup.has(value)) continue;
    dedup.add(value);
    out.push(value as ModelCapabilityTag);
  }
  return out.length > 0 ? out : [...DEFAULT_MODEL_TAGS];
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
      allowedChatIds: Array.isArray(item.allowedChatIds)
        ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
        : []
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
      allowedChatIds: Array.isArray(item.allowedChatIds)
        ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
        : []
    });
  }
  return out;
}

function sanitizeChannels(
  input: unknown,
  telegramBots: TelegramBotConfig[],
  feishuBots: FeishuBotConfig[],
  current: ChannelSettingsMap
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
        const credentials = Object.fromEntries(
          Object.entries(credentialsSource)
            .map(([credKey, credValue]) => [credKey, String(credValue ?? "").trim()])
            .filter(([, credValue]) => Boolean(credValue))
        );
        return {
          id,
          name: String(item.name ?? "").trim() || id,
          enabled: item.enabled === undefined ? true : Boolean(item.enabled),
          credentials,
          allowedChatIds: Array.isArray(item.allowedChatIds)
            ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
            : []
        };
      })
      .filter(Boolean) as ChannelSettingsMap[string]["instances"];

    channels[key] = { instances };
  }

  channels.telegram = channels.telegram ?? (hasExplicitTelegram ? current.telegram : undefined) ?? {
    instances: telegramBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      credentials: { token: bot.token },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.feishu = channels.feishu ?? (hasExplicitFeishu ? current.feishu : undefined) ?? {
    instances: feishuBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      credentials: { appId: bot.appId, appSecret: bot.appSecret },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  return channels;
}

function sanitizeSettings(input: Partial<RuntimeSettings>, current: RuntimeSettings): RuntimeSettings {
  const next: RuntimeSettings = {
    ...current,
    ...input
  };

  const mode = String(next.providerMode ?? "pi").toLowerCase();
  next.providerMode = (mode === "custom" ? "custom" : "pi") as ProviderMode;

  if (!isKnownProvider(String(next.piModelProvider))) {
    next.piModelProvider = current.piModelProvider;
  }

  next.piModelName = String(next.piModelName ?? "").trim() || current.piModelName;
  const rows = Array.isArray(next.customProviders) ? next.customProviders : current.customProviders;
  const dedup = new Set<string>();
  const customProviders: CustomProviderConfig[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id ?? "").trim() || `custom-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);
    const rawModels = Array.isArray((row as { models?: unknown }).models)
      ? ((row as { models: unknown[] }).models ?? [])
      : [];
    const legacyModel = String((row as { model?: unknown }).model ?? "").trim();
    const models: ProviderModelConfig[] = [];
    for (const m of rawModels) {
      if (typeof m === "string") {
        const id = m.trim();
        if (id) {
          models.push({
            id,
            tags: [...DEFAULT_MODEL_TAGS],
            supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles)
          });
        }
        continue;
      }
      if (!m || typeof m !== "object") continue;
      const modelObj = m as { id?: unknown; model?: unknown; tags?: unknown; supportedRoles?: unknown };
      const id = String(modelObj.id ?? modelObj.model ?? "").trim();
      if (!id) continue;
      models.push({
        id,
        tags: sanitizeModelTags(modelObj.tags),
        supportedRoles: sanitizeRoles(modelObj.supportedRoles ?? (row as { supportedRoles?: unknown }).supportedRoles)
      });
    }
    if (models.length === 0 && legacyModel) {
      models.push({
        id: legacyModel,
        tags: [...DEFAULT_MODEL_TAGS],
        supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles)
      });
    }
    const modelIds = models.map((m) => m.id);
    const defaultModelRaw = String((row as { defaultModel?: unknown }).defaultModel ?? "").trim();
    const defaultModel = modelIds.includes(defaultModelRaw) ? defaultModelRaw : (modelIds[0] ?? "");
    customProviders.push({
      id,
      name: String(row.name ?? "").trim() || id,
      baseUrl: String(row.baseUrl ?? "").trim(),
      apiKey: String(row.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(row.path ?? "").trim() || "/v1/chat/completions"
    });
  }
  next.customProviders = customProviders;
  next.defaultCustomProviderId = String(next.defaultCustomProviderId ?? "").trim();
  if (!next.customProviders.some((p) => p.id === next.defaultCustomProviderId)) {
    next.defaultCustomProviderId = next.customProviders[0]?.id ?? "";
  }

  next.modelRouting = {
    textModelKey: String((next as { modelRouting?: { textModelKey?: unknown } }).modelRouting?.textModelKey ?? "").trim(),
    visionModelKey: String((next as { modelRouting?: { visionModelKey?: unknown } }).modelRouting?.visionModelKey ?? "").trim(),
    sttModelKey: String((next as { modelRouting?: { sttModelKey?: unknown } }).modelRouting?.sttModelKey ?? "").trim(),
    ttsModelKey: String((next as { modelRouting?: { ttsModelKey?: unknown } }).modelRouting?.ttsModelKey ?? "").trim()
  };

  next.systemPrompt = String(next.systemPrompt ?? "").trim() || defaultRuntimeSettings.systemPrompt;
  const sanitizedTelegramBots = sanitizeTelegramBots(next.telegramBots);
  const sanitizedFeishuBots = sanitizeFeishuBots(next.feishuBots);
  const legacyToken = String(next.telegramBotToken ?? "").trim();
  const legacyAllowed = Array.isArray(next.telegramAllowedChatIds)
    ? next.telegramAllowedChatIds.map((v) => String(v).trim()).filter(Boolean)
    : current.telegramAllowedChatIds;
  next.telegramBots = sanitizedTelegramBots.length > 0
    ? sanitizedTelegramBots
    : (legacyToken
      ? [{
        id: "default",
        name: "Default Bot",
        token: legacyToken,
        allowedChatIds: legacyAllowed
      }]
      : []);

  next.feishuBots = sanitizedFeishuBots;
  next.channels = sanitizeChannels(next.channels, next.telegramBots, next.feishuBots, current.channels);

  next.telegramBotToken = next.telegramBots[0]?.token ?? "";
  next.telegramAllowedChatIds = next.telegramBots[0]?.allowedChatIds ?? [];
  next.plugins = {
    memory: {
      enabled: Boolean(next.plugins?.memory?.enabled),
      backend: String(
        (next.plugins?.memory as { backend?: string; core?: string } | undefined)?.backend ??
        (next.plugins?.memory as { backend?: string; core?: string } | undefined)?.core ??
        ""
      ).trim() || defaultRuntimeSettings.plugins.memory.backend
    }
  };

  return next;
}

function applyChannelPlugins(state: RuntimeState, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const deps: ChannelRuntimeDeps = {
    getSettings: () => state.settings,
    updateSettings: applySettingsPatch,
    sessions: state.sessions,
    memory: state.memory
  };

  const loaded = discoverPlugins();
  state.pluginCatalog = loaded.catalog;
  state.providerPlugins = loaded.providerPlugins;
  logPluginCatalog(state);

  const applied: Array<{ key: string; instances: string[] }> = [];

  for (const plugin of loaded.channelPlugins) {
    const instances = plugin.listInstances(state.settings);
    const expectedIds = new Set(instances.map((instance) => instance.id));
    const managers = state.channelManagers.get(plugin.key) ?? new Map<string, ChannelManager>();
    state.channelManagers.set(plugin.key, managers);

    for (const [id, manager] of managers.entries()) {
      if (expectedIds.has(id)) continue;
      manager.stop();
      managers.delete(id);
    }

    for (const instance of instances) {
      let manager = managers.get(instance.id);
      if (!manager) {
        manager = plugin.createManager(instance, deps);
        managers.set(instance.id, manager);
      }
      manager.apply(instance.config);
    }

    applied.push({
      key: plugin.key,
      instances: instances.map((instance) => instance.id)
    });
  }

  logChannelPluginApplication(state, applied);
}

export function getRuntime(): RuntimeState {
  if (!globalThis.__molibotRuntime) {
    initDb();

    const settingsStore = new SettingsStore();
    const settings = settingsStore.load();

    const sessions = new SessionStore();
    const currentSettings = { value: settings };
    const memory = new MemoryGateway(() => currentSettings.value, sessions);
    const assistant = new AssistantService(() => currentSettings.value);
    const router = new MessageRouter(sessions, assistant, memory);
    const applySettingsPatch = (patch: Partial<RuntimeSettings>): RuntimeSettings => {
      state.settings = sanitizeSettings(patch, state.settings);
      currentSettings.value = state.settings;
      state.settingsStore.save(state.settings);
      applyChannelPlugins(state, applySettingsPatch);
      return state.settings;
    };

    const state: RuntimeState = {
      sessions,
      router,
      channelManagers: new Map<string, Map<string, ChannelManager>>(),
      pluginCatalog: { channels: [], providers: [], memoryBackends: [] },
      providerPlugins: [],
      memory,
      memorySyncTimer: null,
      settingsStore,
      settings,
      getSettings: () => state.settings,
      updateSettings: applySettingsPatch
    };

    state.settings = sanitizeSettings({}, state.settings);
    currentSettings.value = state.settings;
    logMemoryStartup(state);
    void state.memory.syncExternalMemories()
      .then((result) => {
        console.log(
          `${memoryLabel("memory")} startup_sync scanned_files=${color(String(result.scannedFiles), ANSI_CYAN)} imported=${color(String(result.importedCount), result.importedCount > 0 ? ANSI_GREEN : ANSI_YELLOW)}`
        );
      })
      .catch((error) => {
        console.error(`${memoryLabel("memory")} ${color("startup_sync_failed", `${ANSI_BOLD}${ANSI_RED}`)}`, error);
      });
    state.memorySyncTimer = setInterval(() => {
      void state.memory.syncExternalMemories()
        .then((result) => {
          if (result.scannedFiles > 0 || result.importedCount > 0) {
            console.log(
              `${memoryLabel("memory")} periodic_sync scanned_files=${color(String(result.scannedFiles), ANSI_CYAN)} imported=${color(String(result.importedCount), result.importedCount > 0 ? ANSI_GREEN : ANSI_YELLOW)}`
            );
          }
        })
        .catch((error) => {
          console.error(`${memoryLabel("memory")} ${color("periodic_sync_failed", `${ANSI_BOLD}${ANSI_RED}`)}`, error);
        });
    }, 60_000);
    applyChannelPlugins(state, applySettingsPatch);

    globalThis.__molibotRuntime = state;
  }

  return globalThis.__molibotRuntime;
}
