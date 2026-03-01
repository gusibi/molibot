import { resolve } from "node:path";
import {
  config,
  defaultRuntimeSettings,
  isKnownProvider,
  type ProviderModelConfig,
  type ModelRole,
  type ModelCapabilityTag,
  type CustomProviderConfig,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type ProviderMode,
  type RuntimeSettings
} from "./config.js";
import { TelegramManager } from "./adapters/telegram.js";
import { FeishuManager } from "./adapters/feishu.js";
import { MessageRouter } from "./core/messageRouter.js";
import { initDb } from "./db/sqlite.js";
import { MemoryGateway } from "./memory/gateway.js";
import { AssistantService } from "./services/assistant.js";
import { SessionStore } from "./services/sessionStore.js";
import { SettingsStore } from "./services/settingsStore.js";

interface RuntimeState {
  sessions: SessionStore;
  router: MessageRouter;
  telegramManagers: Map<string, TelegramManager>;
  feishuManagers: Map<string, FeishuManager>;
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

  next.telegramBotToken = next.telegramBots[0]?.token ?? "";
  next.telegramAllowedChatIds = next.telegramBots[0]?.allowedChatIds ?? [];
  next.plugins = {
    memory: {
      enabled: Boolean(next.plugins?.memory?.enabled),
      core: String(next.plugins?.memory?.core ?? "").trim() || defaultRuntimeSettings.plugins.memory.core
    }
  };

  return next;
}

function applyTelegramBots(state: RuntimeState, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const bots = state.settings.telegramBots.filter((bot) => bot.token.trim());
  const expectedIds = new Set(bots.map((bot) => bot.id));

  for (const [id, manager] of state.telegramManagers.entries()) {
    if (expectedIds.has(id)) continue;
    manager.stop();
    state.telegramManagers.delete(id);
  }

  for (const bot of bots) {
    let manager = state.telegramManagers.get(bot.id);
    if (!manager) {
      manager = new TelegramManager(
        () => state.settings,
        applySettingsPatch,
        state.sessions,
        {
          instanceId: bot.id,
          workspaceDir: resolve(config.dataDir, "moli-t", "bots", bot.id),
          memory: state.memory
        }
      );
      state.telegramManagers.set(bot.id, manager);
    }

    manager.apply({
      token: bot.token,
      allowedChatIds: bot.allowedChatIds
    });
  }
}

function applyFeishuBots(state: RuntimeState, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const bots = state.settings.feishuBots.filter((bot) => bot.appId.trim() && bot.appSecret.trim());
  const expectedIds = new Set(bots.map((bot) => bot.id));

  for (const [id, manager] of state.feishuManagers.entries()) {
    if (expectedIds.has(id)) continue;
    manager.stop();
    state.feishuManagers.delete(id);
  }

  for (const bot of bots) {
    let manager = state.feishuManagers.get(bot.id);
    if (!manager) {
      manager = new FeishuManager(
        () => state.settings,
        applySettingsPatch,
        state.sessions,
        {
          instanceId: bot.id,
          workspaceDir: resolve(config.dataDir, "moli-f", "bots", bot.id),
          memory: state.memory
        }
      );
      state.feishuManagers.set(bot.id, manager);
    }

    manager.apply({
      appId: bot.appId,
      appSecret: bot.appSecret,
      allowedChatIds: bot.allowedChatIds
    });
  }
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
      applyTelegramBots(state, applySettingsPatch);
      applyFeishuBots(state, applySettingsPatch);
      return state.settings;
    };

    const state: RuntimeState = {
      sessions,
      router,
      telegramManagers: new Map<string, TelegramManager>(),
      feishuManagers: new Map<string, FeishuManager>(),
      memory,
      memorySyncTimer: null,
      settingsStore,
      settings,
      getSettings: () => state.settings,
      updateSettings: applySettingsPatch
    };

    state.settings = sanitizeSettings({}, state.settings);
    currentSettings.value = state.settings;
    void state.memory.syncExternalMemories();
    state.memorySyncTimer = setInterval(() => {
      void state.memory.syncExternalMemories();
    }, 60_000);
    applyTelegramBots(state, applySettingsPatch);
    applyFeishuBots(state, applySettingsPatch);

    globalThis.__molibotRuntime = state;
  }

  return globalThis.__molibotRuntime;
}
