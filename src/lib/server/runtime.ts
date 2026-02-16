import {
  defaultRuntimeSettings,
  isKnownProvider,
  type ModelRole,
  type CustomProviderConfig,
  type ProviderMode,
  type RuntimeSettings
} from "./config.js";
import { TelegramManager } from "./adapters/telegram.js";
import { MessageRouter } from "./core/messageRouter.js";
import { initDb } from "./db/sqlite.js";
import { AssistantService } from "./services/assistant.js";
import { SessionStore } from "./services/sessionStore.js";
import { SettingsStore } from "./services/settingsStore.js";

interface RuntimeState {
  sessions: SessionStore;
  router: MessageRouter;
  telegram: TelegramManager;
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
    const models = rawModels.map((m) => String(m).trim()).filter(Boolean);
    if (models.length === 0 && legacyModel) models.push(legacyModel);
    const defaultModelRaw = String((row as { defaultModel?: unknown }).defaultModel ?? "").trim();
    const defaultModel = models.includes(defaultModelRaw) ? defaultModelRaw : (models[0] ?? "");
    customProviders.push({
      id,
      name: String(row.name ?? "").trim() || id,
      baseUrl: String(row.baseUrl ?? "").trim(),
      apiKey: String(row.apiKey ?? "").trim(),
      models,
      defaultModel,
      supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles),
      path: String(row.path ?? "").trim() || "/v1/chat/completions"
    });
  }
  next.customProviders = customProviders;
  next.defaultCustomProviderId = String(next.defaultCustomProviderId ?? "").trim();
  if (!next.customProviders.some((p) => p.id === next.defaultCustomProviderId)) {
    next.defaultCustomProviderId = next.customProviders[0]?.id ?? "";
  }

  next.systemPrompt = String(next.systemPrompt ?? "").trim() || defaultRuntimeSettings.systemPrompt;
  next.telegramBotToken = String(next.telegramBotToken ?? "").trim();

  if (Array.isArray(next.telegramAllowedChatIds)) {
    next.telegramAllowedChatIds = next.telegramAllowedChatIds
      .map((v) => String(v).trim())
      .filter(Boolean);
  } else {
    next.telegramAllowedChatIds = current.telegramAllowedChatIds;
  }

  return next;
}

export function getRuntime(): RuntimeState {
  if (!globalThis.__molibotRuntime) {
    initDb();

    const settingsStore = new SettingsStore();
    const settings = settingsStore.load();

    const sessions = new SessionStore();
    const currentSettings = { value: settings };
    const assistant = new AssistantService(() => currentSettings.value);
    const router = new MessageRouter(sessions, assistant);
    const telegram = new TelegramManager(() => currentSettings.value, sessions);

    const state: RuntimeState = {
      sessions,
      router,
      telegram,
      settingsStore,
      settings,
      getSettings: () => state.settings,
      updateSettings: (patch) => {
        state.settings = sanitizeSettings(patch, state.settings);
        currentSettings.value = state.settings;
        state.settingsStore.save(state.settings);
        state.telegram.apply({
          token: state.settings.telegramBotToken,
          allowedChatIds: state.settings.telegramAllowedChatIds
        });
        return state.settings;
      }
    };

    state.telegram.apply({
      token: state.settings.telegramBotToken,
      allowedChatIds: state.settings.telegramAllowedChatIds
    });

    globalThis.__molibotRuntime = state;
  }

  return globalThis.__molibotRuntime;
}
