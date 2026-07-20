import {
  type AgentSettings,
  DEFAULT_AGENT_ID,
  defaultAgentSettings,
  normalizeDefaultAgentSettings,
  defaultRuntimeSettings,
  isKnownProvider,
  sanitizeAgentModelRouting,
  resolveCustomProviderThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap,
  sanitizeRuntimeThinkingLevel,
  type ProviderModelConfig,
  type ModelRole,
  type ModelCapabilityTag,
  type ChannelSettingsMap,
  type CustomProviderConfig,
  type CustomProviderProtocol,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  type ProviderMode,
  type McpServerConfig,
  type RuntimeSettings,
  type WebSearchEngineId,
  type WebSearchEngineSelectionStrategy,
  type WebSearchRoute,
  type ImageGenerateEngineId,
  type ImageGenerateSettings,
  type VideoGenerateEngineId,
  type VideoGenerateSettings,
  type TtsGenerateAudioFormat,
  type TtsGenerateProviderId,
  type TtsGenerateSettings,
  type ChannelInstanceSettings,
  type CompactionSettings,
  type ModelFallbackSettings,
  type ModelRoutingConfig,
  sanitizeHostToolSettings,
  sanitizeToolSandboxSettings
} from "$lib/server/settings/index.js";
import { isAbsolute } from "node:path";

const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const DEFAULT_MODEL_TAGS: ModelCapabilityTag[] = ["text"];
const WEB_SEARCH_ENGINES: WebSearchEngineId[] = [
  "duckduckgo",
  "anysearch",
  "brave",
  "tavily",
  "exa",
  "serper",
  "baidu",
  "baidu_fast",
  "baidu_web",
  "ark",
  "grok",
  "bocha"
];
const WEB_SEARCH_ROUTES: WebSearchRoute[] = ["auto", "china", "global", "official_docs", "research"];
const WEB_SEARCH_ENGINE_SELECTION_STRATEGIES: WebSearchEngineSelectionStrategy[] = ["priority", "random", "round_robin"];
const IMAGE_GENERATE_ENGINES: ImageGenerateEngineId[] = ["agnes", "openai", "openai-chat", "modelscope", "google", "volcengine"];
const VIDEO_GENERATE_ENGINES: VideoGenerateEngineId[] = ["agnes", "volcengine"];
const TTS_GENERATE_PROVIDERS: TtsGenerateProviderId[] = ["macos", "xiaomi"];
const TTS_GENERATE_FORMATS: TtsGenerateAudioFormat[] = ["wav", "mp3", "aiff", "m4a", "caf"];
const LEGACY_WEB_SEARCH_ROUTE_MAP: Record<string, WebSearchRoute> = {
  domestic_news: "china",
  chinese_general: "china",
  international_news: "global",
  global_general: "global"
};

function clampNumber(value: unknown, fallback: number, min: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const lowerBound = Math.max(min, parsed);
  if (max === undefined) return lowerBound;
  return Math.min(max, lowerBound);
}

export function sanitizeSkillSearchSettings(
  input: unknown,
  fallback: RuntimeSettings["skillSearch"]
): RuntimeSettings["skillSearch"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const local = source.local && typeof source.local === "object"
    ? source.local as Record<string, unknown>
    : {};
  const api = source.api && typeof source.api === "object"
    ? source.api as Record<string, unknown>
    : {};
  return {
    local: {
      enabled: local.enabled === undefined ? fallback.local.enabled : Boolean(local.enabled)
    },
    api: {
      enabled: api.enabled === undefined ? fallback.api.enabled : Boolean(api.enabled),
      provider: String(api.provider ?? fallback.api.provider).trim(),
      baseUrl: String(api.baseUrl ?? fallback.api.baseUrl).trim(),
      apiKey: String(api.apiKey ?? fallback.api.apiKey).trim(),
      model: String(api.model ?? fallback.api.model).trim(),
      path: String(api.path ?? fallback.api.path).trim() || fallback.api.path,
      maxTokens: clampNumber(api.maxTokens, fallback.api.maxTokens, 128, 4096),
      temperature: clampNumber(api.temperature, fallback.api.temperature, 0, 1),
      timeoutMs: clampNumber(api.timeoutMs, fallback.api.timeoutMs, 1000, 60000),
      minConfidence: clampNumber(api.minConfidence, fallback.api.minConfidence, 0, 1)
    }
  };
}

export function sanitizeSkillDraftSettings(
  input: unknown,
  fallback: RuntimeSettings["skillDrafts"]
): RuntimeSettings["skillDrafts"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const autoSave = source.autoSave && typeof source.autoSave === "object"
    ? source.autoSave as Record<string, unknown>
    : {};
  const template = source.template && typeof source.template === "object"
    ? source.template as Record<string, unknown>
    : {};
  return {
    autoSave: {
      enabled: autoSave.enabled === undefined ? fallback.autoSave.enabled : Boolean(autoSave.enabled),
      minToolCalls: clampNumber(autoSave.minToolCalls, fallback.autoSave.minToolCalls, 1, 200),
      allowRecoveredToolFailures: autoSave.allowRecoveredToolFailures === undefined
        ? fallback.autoSave.allowRecoveredToolFailures
        : Boolean(autoSave.allowRecoveredToolFailures),
      allowModelRetries: autoSave.allowModelRetries === undefined
        ? fallback.autoSave.allowModelRetries
        : Boolean(autoSave.allowModelRetries)
    },
    template: {
      skillPath: String(template.skillPath ?? fallback.template.skillPath).trim()
    }
  };
}

export function sanitizeWebSearchSettings(
  input: unknown,
  fallback: RuntimeSettings["webSearch"]
): RuntimeSettings["webSearch"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const engines = Object.fromEntries(WEB_SEARCH_ENGINES.map((engine) => {
    const fallbackEngine = fallback.engines?.[engine] ?? defaultRuntimeSettings.webSearch.engines[engine];
    const raw = enginesSource[engine] && typeof enginesSource[engine] === "object"
      ? enginesSource[engine] as Record<string, unknown>
      : {};
    return [engine, {
      enabled: raw.enabled === undefined ? fallbackEngine.enabled : Boolean(raw.enabled),
      apiKey: String(raw.apiKey ?? fallbackEngine.apiKey ?? "").trim(),
      baseUrl: String(raw.baseUrl ?? fallbackEngine.baseUrl ?? "").trim() || undefined
    }];
  })) as RuntimeSettings["webSearch"]["engines"];
  const rawRoute = String(source.defaultRoute ?? fallback.defaultRoute).trim();
  const route = (LEGACY_WEB_SEARCH_ROUTE_MAP[rawRoute] ?? rawRoute) as WebSearchRoute;
  const engine = String(source.defaultEngine ?? fallback.defaultEngine).trim() as WebSearchEngineId | "auto";
  const engineSelectionStrategy = String(
    source.engineSelectionStrategy ?? fallback.engineSelectionStrategy
  ).trim() as WebSearchEngineSelectionStrategy;
  return {
    enabled: source.enabled === undefined ? fallback.enabled : Boolean(source.enabled),
    defaultRoute: WEB_SEARCH_ROUTES.includes(route) ? route : fallback.defaultRoute,
    defaultEngine: engine === "auto" || WEB_SEARCH_ENGINES.includes(engine) ? engine : fallback.defaultEngine,
    engineSelectionStrategy: WEB_SEARCH_ENGINE_SELECTION_STRATEGIES.includes(engineSelectionStrategy)
      ? engineSelectionStrategy
      : fallback.engineSelectionStrategy,
    maxResults: clampNumber(source.maxResults, fallback.maxResults, 1, 20),
    timeoutMs: clampNumber(source.timeoutMs, fallback.timeoutMs, 1000, 120000),
    retryTimeoutMs: clampNumber(source.retryTimeoutMs, fallback.retryTimeoutMs, 1000, 180000),
    engines
  };
}

export function sanitizeImageGenerateSettings(
  input: unknown,
  fallback: RuntimeSettings["imageGenerate"]
): RuntimeSettings["imageGenerate"] {
  const fallbackSettings = fallback ?? defaultRuntimeSettings.imageGenerate;
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const requestedDefaultEngine = String(source.defaultEngine ?? fallbackSettings.defaultEngine).trim() as ImageGenerateEngineId | "auto";
  const engines = Object.fromEntries(IMAGE_GENERATE_ENGINES.map((engine) => {
    const fallbackEngine = fallbackSettings.engines[engine];
    const raw = enginesSource[engine] && typeof enginesSource[engine] === "object"
      ? enginesSource[engine] as Record<string, unknown>
      : {};
    const apiKey = String(raw.apiKey ?? fallbackEngine.apiKey ?? "").trim();
    const enabled = raw.enabled === undefined
      ? fallbackEngine.enabled || Boolean(apiKey)
      : Boolean(raw.enabled) || (requestedDefaultEngine === engine && Boolean(apiKey));
    return [engine, {
      enabled,
      apiKey,
      model: String(raw.model ?? fallbackEngine.model ?? "").trim() || undefined,
      baseUrl: String(raw.baseUrl ?? fallbackEngine.baseUrl ?? "").trim() || undefined
    }];
  })) as RuntimeSettings["imageGenerate"]["engines"];
  return {
    enabled: source.enabled === undefined ? fallbackSettings.enabled : Boolean(source.enabled),
    defaultEngine: requestedDefaultEngine === "auto" || IMAGE_GENERATE_ENGINES.includes(requestedDefaultEngine) ? requestedDefaultEngine : fallbackSettings.defaultEngine,
    engines
  };
}

export function sanitizeVideoGenerateSettings(
  input: unknown,
  fallback: RuntimeSettings["videoGenerate"]
): RuntimeSettings["videoGenerate"] {
  const fallbackSettings = fallback ?? defaultRuntimeSettings.videoGenerate;
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const requestedDefaultEngine = String(source.defaultEngine ?? fallbackSettings.defaultEngine).trim() as VideoGenerateEngineId | "auto";
  const engines = Object.fromEntries(VIDEO_GENERATE_ENGINES.map((engine) => {
    const fallbackEngine = fallbackSettings.engines[engine];
    const raw = enginesSource[engine] && typeof enginesSource[engine] === "object"
      ? enginesSource[engine] as Record<string, unknown>
      : {};
    const apiKey = String(raw.apiKey ?? fallbackEngine.apiKey ?? "").trim();
    const enabled = raw.enabled === undefined
      ? fallbackEngine.enabled
      : Boolean(raw.enabled) || (requestedDefaultEngine === engine && Boolean(apiKey));
    const model = String(raw.model ?? fallbackEngine.model ?? "").trim();
    return [engine, {
      enabled,
      apiKey,
      model,
      baseUrl: String(raw.baseUrl ?? fallbackEngine.baseUrl ?? "").trim() || undefined
    }];
  })) as RuntimeSettings["videoGenerate"]["engines"];
  return {
    enabled: source.enabled === undefined ? fallbackSettings.enabled : Boolean(source.enabled),
    defaultEngine: requestedDefaultEngine === "auto" || VIDEO_GENERATE_ENGINES.includes(requestedDefaultEngine) ? requestedDefaultEngine : fallbackSettings.defaultEngine,
    engines
  };
}

function sanitizeTtsFormat(value: unknown, fallback: TtsGenerateAudioFormat): TtsGenerateAudioFormat {
  const format = String(value ?? fallback).trim().toLowerCase() as TtsGenerateAudioFormat;
  return TTS_GENERATE_FORMATS.includes(format) ? format : fallback;
}

function sanitizeTtsBaseUrl(value: unknown, fallback: string): string {
  const raw = String(value ?? fallback).trim();
  const cleaned = raw.replace(/\/+$/, "");
  return cleaned || fallback;
}

export function sanitizeTtsGenerateSettings(
  input: unknown,
  fallback: TtsGenerateSettings = defaultRuntimeSettings.ttsGenerate
): TtsGenerateSettings {
  const fallbackSettings = fallback ?? defaultRuntimeSettings.ttsGenerate;
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const providersSource = source.providers && typeof source.providers === "object"
    ? source.providers as Record<string, unknown>
    : {};
  const requestedDefaultProvider = String(
    source.defaultProvider ?? fallbackSettings.defaultProvider
  ).trim() as TtsGenerateProviderId;

  const macosRaw = providersSource.macos && typeof providersSource.macos === "object"
    ? providersSource.macos as Record<string, unknown>
    : {};
  const xiaomiRaw = providersSource.xiaomi && typeof providersSource.xiaomi === "object"
    ? providersSource.xiaomi as Record<string, unknown>
    : {};

  return {
    enabled: source.enabled === undefined ? fallbackSettings.enabled : Boolean(source.enabled),
    defaultProvider: TTS_GENERATE_PROVIDERS.includes(requestedDefaultProvider)
      ? requestedDefaultProvider
      : fallbackSettings.defaultProvider,
    providers: {
      macos: {
        enabled: macosRaw.enabled === undefined ? fallbackSettings.providers.macos.enabled : Boolean(macosRaw.enabled),
        voice: String(macosRaw.voice ?? fallbackSettings.providers.macos.voice ?? "").trim(),
        format: sanitizeTtsFormat(macosRaw.format, fallbackSettings.providers.macos.format)
      },
      xiaomi: {
        enabled: xiaomiRaw.enabled === undefined ? fallbackSettings.providers.xiaomi.enabled : Boolean(xiaomiRaw.enabled),
        apiKey: String(xiaomiRaw.apiKey ?? fallbackSettings.providers.xiaomi.apiKey ?? "").trim(),
        baseUrl: sanitizeTtsBaseUrl(xiaomiRaw.baseUrl, fallbackSettings.providers.xiaomi.baseUrl),
        model: String(xiaomiRaw.model ?? fallbackSettings.providers.xiaomi.model ?? "mimo-v2-tts").trim() || "mimo-v2-tts",
        voice: String(xiaomiRaw.voice ?? fallbackSettings.providers.xiaomi.voice ?? "mimo_default").trim() || "mimo_default",
        format: sanitizeTtsFormat(xiaomiRaw.format, fallbackSettings.providers.xiaomi.format)
      }
    }
  };
}


export function sanitizeHookPluginEntries(input: unknown): RuntimeSettings["plugins"]["hooks"] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const entries: RuntimeSettings["plugins"]["hooks"] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const source = raw as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      enabled: Boolean(source.enabled),
      options: source.options && typeof source.options === "object" && !Array.isArray(source.options)
        ? source.options as Record<string, unknown>
        : undefined
    });
  }
  return entries;
}

/**
 * Sanitizes the full plugins.memory block (backend, embedding, reflection, and
 * daily-materials). Shared by sanitizeSettings and the SettingsStore load path
 * so every field survives a save → restart round-trip.
 */
export function sanitizeMemoryPluginSettings(
  input: unknown,
  current: RuntimeSettings["plugins"]["memory"]
): RuntimeSettings["plugins"]["memory"] {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const dailyInput = source.dailyMaterials && typeof source.dailyMaterials === "object"
    ? source.dailyMaterials as Record<string, unknown>
    : current.dailyMaterials as unknown as Record<string, unknown> | undefined;
  const autoConfirmInput = source.autoConfirm && typeof source.autoConfirm === "object"
    ? source.autoConfirm as Record<string, unknown>
    : current.autoConfirm as unknown as Record<string, unknown> | undefined;
  const safeRelativePath = (value: unknown, fallback: string): string => {
    const normalized = String(value ?? "").trim();
    if (!normalized || isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) return fallback;
    return normalized;
  };
  const validTime = (value: unknown): value is string => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ""));
  const notificationTarget = (() => {
    if (source.reflectionNotificationTarget === undefined) return current.reflectionNotificationTarget ?? null;
    if (!source.reflectionNotificationTarget || typeof source.reflectionNotificationTarget !== "object") return null;
    const candidate = source.reflectionNotificationTarget as Record<string, unknown>;
    const channel = String(candidate.channel ?? "").trim();
    const botId = String(candidate.botId ?? "").trim();
    const chatId = String(candidate.chatId ?? "").trim();
    if ((channel !== "telegram" && channel !== "feishu") || !botId || !chatId) return null;
    return { channel, botId, chatId } as RuntimeSettings["plugins"]["memory"]["reflectionNotificationTarget"];
  })();
  return {
    enabled: source.enabled === undefined ? current.enabled : Boolean(source.enabled),
    backend: String((source as { backend?: string; core?: string }).backend ?? (source as { backend?: string; core?: string }).core ?? "").trim()
      || current.backend
      || defaultRuntimeSettings.plugins.memory.backend,
    embeddingProviderId: String(source.embeddingProviderId ?? current.embeddingProviderId ?? "").trim(),
    embeddingModel: String(source.embeddingModel ?? current.embeddingModel ?? "").trim(),
    reflectionTime: validTime(source.reflectionTime)
      ? String(source.reflectionTime)
      : (current.reflectionTime || "03:00"),
    reflectionNotifications: source.reflectionNotifications === undefined
      ? (current.reflectionNotifications ?? true)
      : Boolean(source.reflectionNotifications),
    reflectionNotificationTarget: notificationTarget,
    autoConfirm: {
      enabled: autoConfirmInput?.enabled === undefined ? false : Boolean(autoConfirmInput.enabled),
      occurrenceThreshold: Math.max(2, Math.min(20, Math.round(Number(autoConfirmInput?.occurrenceThreshold) || 3))),
      confidenceThreshold: Math.max(0.5, Math.min(0.99, Number(autoConfirmInput?.confidenceThreshold) || 0.85)),
      allowProjectTasks: Boolean(autoConfirmInput?.allowProjectTasks)
    },
    dailyMaterials: {
      enabled: dailyInput?.enabled === undefined ? false : Boolean(dailyInput.enabled),
      time: validTime(dailyInput?.time) ? String(dailyInput?.time) : "23:30",
      projectId: String(dailyInput?.projectId ?? "").trim(),
      dir: safeRelativePath(dailyInput?.dir, "content/daily-materials"),
      promptPath: safeRelativePath(dailyInput?.promptPath, "templates/daily-material-prompt.md"),
      notifications: dailyInput?.notifications === undefined ? true : Boolean(dailyInput.notifications),
      scanTokenBudget: (() => {
        const n = Number(dailyInput?.scanTokenBudget);
        if (!Number.isFinite(n) || n <= 0) return 120000;
        return Math.min(900000, Math.max(8000, Math.round(n)));
      })(),
      scanModelKey: String(dailyInput?.scanModelKey ?? "").trim()
    }
  };
}

export function sanitizeCloudflareHtmlPluginSettings(
  input: unknown,
  fallback: RuntimeSettings["plugins"]["cloudflareHtml"]
): RuntimeSettings["plugins"]["cloudflareHtml"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  return {
    enabled: source.enabled === undefined ? fallback.enabled : Boolean(source.enabled),
    accessMode: String(source.accessMode ?? fallback.accessMode).trim() === "direct" ? "direct" : "worker",
    workerBaseHost: String(source.workerBaseHost ?? source.publicBaseUrl ?? fallback.workerBaseHost).trim(),
    publicBaseHost: String(source.publicBaseHost ?? fallback.publicBaseHost).trim(),
    routePrefix: String(source.routePrefix ?? fallback.routePrefix).trim() || fallback.routePrefix,
    bucketName: String(source.bucketName ?? fallback.bucketName).trim(),
    accountId: String(source.accountId ?? fallback.accountId).trim(),
    accessKeyId: String(source.accessKeyId ?? fallback.accessKeyId).trim(),
    secretAccessKey: String(source.secretAccessKey ?? fallback.secretAccessKey).trim(),
    objectPrefix: String(source.objectPrefix ?? fallback.objectPrefix).trim() || fallback.objectPrefix
  };
}

export function sanitizeRoles(input: unknown): ModelRole[] {
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

export function sanitizeModelTags(input: unknown): ModelCapabilityTag[] {
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

export function sanitizeTelegramBots(input: unknown): TelegramBotConfig[] {
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

export function sanitizeFeishuBots(input: unknown): FeishuBotConfig[] {
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

export function sanitizeSingleAgent(input: unknown): AgentSettings {
  if (!input || typeof input !== "object") throw new Error("agent is required");
  const item = input as Record<string, unknown>;
  const id = String(item.id ?? "").trim();
  if (!id) throw new Error("agent.id is required");
  return normalizeDefaultAgentSettings({
    id,
    name: String(item.name ?? "").trim() || id,
    description: String(item.description ?? "").trim(),
    enabled: item.enabled === undefined ? true : Boolean(item.enabled),
    sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled),
    modelRouting: sanitizeAgentModelRouting(item.modelRouting)
  });
}

export function sanitizeAgents(input: unknown): AgentSettings[] {
  if (!Array.isArray(input)) return [];
  const out: AgentSettings[] = [];
  const dedup = new Set<string>();
  for (const row of input) {
    let agent: AgentSettings;
    try {
      agent = sanitizeSingleAgent(row);
    } catch {
      continue;
    }
    if (dedup.has(agent.id)) continue;
    dedup.add(agent.id);
    out.push(agent);
  }
  return out;
}


export function sanitizeQQBots(input: unknown): QQBotConfig[] {
  if (!Array.isArray(input)) return [];

  const out: QQBotConfig[] = [];
  const dedup = new Set<string>();
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const appId = String(item.appId ?? "").trim();
    const clientSecret = String(item.clientSecret ?? "").trim();
    if (!appId || !clientSecret) continue;
    const idRaw = String(item.id ?? "").trim();
    const id = idRaw || `qq-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);
    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      appId,
      clientSecret,
      allowedChatIds: Array.isArray(item.allowedChatIds)
        ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
        : []
    });
  }
  return out;
}

export function sanitizeMcpServers(input: unknown): McpServerConfig[] {
  const rows: Array<{ id: string; value: Record<string, unknown> }> = Array.isArray(input)
    ? input
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => ({ id: String(row.id ?? "").trim(), value: row }))
    : (input && typeof input === "object")
      ? Object.entries(input as Record<string, unknown>)
        .filter(([, row]) => Boolean(row) && typeof row === "object")
        .map(([id, row]) => ({ id: String(id).trim(), value: row as Record<string, unknown> }))
      : [];
  if (rows.length === 0) return [];

  const out: McpServerConfig[] = [];
  const dedup = new Set<string>();
  for (const row of rows) {
    const item = row.value;
    const id = row.id || String(item.id ?? "").trim() || `mcp-${Math.random().toString(36).slice(2, 8)}`;
    if (dedup.has(id)) continue;
    dedup.add(id);

    const stdioRaw = item.stdio && typeof item.stdio === "object"
      ? item.stdio as Record<string, unknown>
      : {};
    const command = String(stdioRaw.command ?? item.command ?? "").trim();

    const args = Array.isArray(stdioRaw.args)
      ? stdioRaw.args.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const envRaw = stdioRaw.env && typeof stdioRaw.env === "object"
      ? stdioRaw.env as Record<string, unknown>
      : {};
    const env = Object.fromEntries(
      Object.entries(envRaw)
        .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key))
    );
    const httpRaw = item.http && typeof item.http === "object"
      ? item.http as Record<string, unknown>
      : {};
    const topLevelHeadersRaw = item.headers && typeof item.headers === "object"
      ? item.headers as Record<string, unknown>
      : {};
    const headersRaw = httpRaw.headers && typeof httpRaw.headers === "object"
      ? httpRaw.headers as Record<string, unknown>
      : topLevelHeadersRaw;
    const url = String(httpRaw.url ?? item.url ?? "").trim();
    const transportRaw = String(item.transport ?? item.type ?? (url ? "http" : "stdio")).trim().toLowerCase();
    const transport = transportRaw === "http" ? "http" : "stdio";
    const headers = Object.fromEntries(
      Object.entries(headersRaw)
        .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key))
    );
    if (transport === "stdio" && !command) continue;
    if (transport === "http" && !url) continue;

    out.push({
      id,
      name: String(item.name ?? "").trim() || id,
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      transport,
      stdio: {
        command,
        args,
        env,
        cwd: String(stdioRaw.cwd ?? "").trim()
      },
      http: {
        url,
        headers
      },
      toolNamePrefix: String(item.toolNamePrefix ?? "").trim()
    });
  }

  return out;
}

export function sanitizeChannelInstanceDisplaySettings(input: unknown): ChannelInstanceSettings["display"] {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const toolProgress = raw.toolProgress !== undefined && ["off", "new", "all", "verbose"].includes(String(raw.toolProgress))
    ? (raw.toolProgress as any)
    : undefined;
  const showReasoning = raw.showReasoning !== undefined && ["off", "on", "stream", "new"].includes(String(raw.showReasoning))
    ? (raw.showReasoning as any)
    : undefined;
  const gatewayNotifyInterval = raw.gatewayNotifyInterval !== undefined && !isNaN(Number(raw.gatewayNotifyInterval))
    ? Number(raw.gatewayNotifyInterval)
    : undefined;
  const runLogNotice = raw.runLogNotice === undefined ? undefined : Boolean(raw.runLogNotice);

  if (toolProgress === undefined && showReasoning === undefined && gatewayNotifyInterval === undefined && runLogNotice === undefined) {
    return undefined;
  }
  return { toolProgress, showReasoning, gatewayNotifyInterval, runLogNotice };
}

export function sanitizeSingleChannelInstance(input: unknown): ChannelInstanceSettings {
  if (!input || typeof input !== "object") throw new Error("instance is required");
  const item = input as Record<string, unknown>;
  const id = String(item.id ?? "").trim();
  if (!id) throw new Error("instance.id is required");
  const credentialsSource = item.credentials && typeof item.credentials === "object"
    ? item.credentials as Record<string, unknown>
    : {};
  const credentials = Object.fromEntries(
    Object.entries(credentialsSource)
      .map(([credKey, credValue]) => [String(credKey).trim(), String(credValue ?? "").trim()])
      .filter(([credKey, credValue]) => Boolean(credKey) && Boolean(credValue))
  );
  return {
    id,
    name: String(item.name ?? "").trim() || id,
    enabled: item.enabled === undefined ? true : Boolean(item.enabled),
    agentId: String(item.agentId ?? "").trim(),
    credentials,
    allowedChatIds: Array.isArray(item.allowedChatIds)
      ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
      : [],
    sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled),
    display: item.display ? sanitizeChannelInstanceDisplaySettings(item.display) : undefined
  };
}

function sanitizeChannels(
  input: unknown,
  telegramBots: TelegramBotConfig[],
  feishuBots: FeishuBotConfig[],
  qqBots: QQBotConfig[],
  current: ChannelSettingsMap
): ChannelSettingsMap {
  const channels: ChannelSettingsMap = Object.fromEntries(
    Object.entries(current ?? {}).map(([key, value]) => [
      key,
      {
        instances: (value?.instances ?? []).map((instance) => ({
          ...instance,
          credentials: { ...(instance.credentials ?? {}) },
          allowedChatIds: [...(instance.allowedChatIds ?? [])],
          display: instance.display ? sanitizeChannelInstanceDisplaySettings(instance.display) : undefined
        }))
      }
    ])
  );
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};

  for (const [key, rawValue] of Object.entries(source)) {
    if (!rawValue || typeof rawValue !== "object") continue;
    const rawInstances = Array.isArray((rawValue as { instances?: unknown }).instances)
      ? ((rawValue as { instances: unknown[] }).instances ?? [])
      : [];
    const instances = rawInstances
      .map((row) => {
        try {
          return sanitizeSingleChannelInstance(row);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ChannelSettingsMap[string]["instances"];

    channels[key] = { instances };
  }

  channels.telegram = channels.telegram ?? {
    instances: telegramBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      agentId: "",
      credentials: { token: bot.token },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.feishu = channels.feishu ?? {
    instances: feishuBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      agentId: "",
      credentials: { appId: bot.appId, appSecret: bot.appSecret },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.qq = channels.qq ?? {
    instances: qqBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      enabled: true,
      agentId: "",
      credentials: { appId: bot.appId, clientSecret: bot.clientSecret },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.weixin = channels.weixin ?? {
    instances: []
  };

  return channels;
}

export function sanitizeCustomProviderProtocol(input: unknown): CustomProviderProtocol {
  return String(input ?? "").trim() === "anthropic" ? "anthropic" : "openai-compatible";
}

export function sanitizeBudgetSettings(
  input: unknown,
  fallback: RuntimeSettings["budget"]
): RuntimeSettings["budget"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  return {
    maxToolCalls: clampNumber(source.maxToolCalls, fallback.maxToolCalls, 1, 500),
    maxToolFailures: clampNumber(source.maxToolFailures, fallback.maxToolFailures, 1, 100),
    maxModelAttempts: clampNumber(source.maxModelAttempts, fallback.maxModelAttempts, 1, 100)
  };
}

export function sanitizeEventExecutionSettings(
  input: unknown,
  fallback: RuntimeSettings["events"]
): RuntimeSettings["events"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  return {
    executionTimeoutMs: clampNumber(source.executionTimeoutMs, fallback.executionTimeoutMs, 1000, 24 * 60 * 60 * 1000),
    maxAttempts: clampNumber(source.maxAttempts, fallback.maxAttempts, 1, 20),
    retryDelayMs: clampNumber(source.retryDelayMs, fallback.retryDelayMs, 0, 60 * 60 * 1000),
    taskSessionRetentionDays: clampNumber(source.taskSessionRetentionDays, fallback.taskSessionRetentionDays, 0, 365)
  };
}

export function sanitizeModelRoutingConfig(input: unknown, fallback: ModelRoutingConfig): ModelRoutingConfig {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    textModelKey: String(source.textModelKey ?? "").trim() || fallback.textModelKey,
    visionModelKey: String(source.visionModelKey ?? "").trim() || fallback.visionModelKey,
    sttModelKey: String(source.sttModelKey ?? "").trim() || fallback.sttModelKey,
    ttsModelKey: String(source.ttsModelKey ?? "").trim() || fallback.ttsModelKey,
    compactionModelKey: String(source.compactionModelKey ?? "").trim(),
    subagentModelKey: String(source.subagentModelKey ?? "").trim() || fallback.subagentModelKey,
    subagentHaikuModelKey: String(source.subagentHaikuModelKey ?? "").trim(),
    subagentSonnetModelKey: String(source.subagentSonnetModelKey ?? "").trim(),
    subagentOpusModelKey: String(source.subagentOpusModelKey ?? "").trim(),
    subagentThinkingModelKey: String(source.subagentThinkingModelKey ?? "").trim()
  };
}

export function sanitizeModelFallback(input: unknown, fallback: ModelFallbackSettings): ModelFallbackSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const mode = String(source.mode ?? fallback.mode).trim();
  const firstTokenTimeoutRaw = Number(source.firstTokenTimeoutMs);
  const firstTokenTimeoutMs = !Number.isFinite(firstTokenTimeoutRaw)
    ? fallback.firstTokenTimeoutMs
    : firstTokenTimeoutRaw <= 0
      ? 0
      : clampNumber(firstTokenTimeoutRaw, fallback.firstTokenTimeoutMs, 1000, 600000);
  return {
    mode: mode === "off" || mode === "any-enabled" ? mode : "same-provider",
    firstTokenTimeoutMs
  } as ModelFallbackSettings;
}

export function sanitizeCompaction(input: unknown, fallback: CompactionSettings): CompactionSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const reserveTokensRaw = Number(source.reserveTokens);
  const keepRecentTokensRaw = Number(source.keepRecentTokens);
  const thresholdPercentRaw = Number(source.thresholdPercent);
  const defaultContextWindowRaw = Number(source.defaultContextWindow);
  return {
    enabled: source.enabled === undefined ? fallback.enabled : Boolean(source.enabled),
    thresholdPercent: Number.isFinite(thresholdPercentRaw) ? Math.max(10, Math.min(95, Math.round(thresholdPercentRaw))) : fallback.thresholdPercent,
    reserveTokens: Number.isFinite(reserveTokensRaw) ? Math.max(1024, Math.round(reserveTokensRaw)) : fallback.reserveTokens,
    keepRecentTokens: Number.isFinite(keepRecentTokensRaw) ? Math.max(2048, Math.round(keepRecentTokensRaw)) : fallback.keepRecentTokens,
    defaultContextWindow: Number.isFinite(defaultContextWindowRaw) ? Math.max(1024, Math.round(defaultContextWindowRaw)) : fallback.defaultContextWindow
  };
}

export interface AiRoutingInput {
  providerMode?: unknown;
  piModelProvider?: unknown;
  piModelName?: unknown;
  defaultThinkingLevel?: unknown;
  defaultCustomProviderId?: unknown;
  modelRouting?: unknown;
  modelFallback?: unknown;
  compaction?: unknown;
  systemPrompt?: unknown;
  timezone?: unknown;
}

export function sanitizeAiRoutingConfig(input: AiRoutingInput, current: RuntimeSettings): Partial<RuntimeSettings> {
  const patch: Partial<RuntimeSettings> = {};
  if (input.providerMode !== undefined) {
    const mode = String(input.providerMode ?? "pi").toLowerCase();
    patch.providerMode = (mode === "custom" ? "custom" : "pi") as ProviderMode;
  }
  if (input.piModelProvider !== undefined) {
    const candidate = String(input.piModelProvider ?? "").trim();
    if (isKnownProvider(candidate)) patch.piModelProvider = candidate;
  }
  if (input.piModelName !== undefined) {
    patch.piModelName = String(input.piModelName ?? "").trim() || current.piModelName;
  }
  if (input.defaultThinkingLevel !== undefined) {
    patch.defaultThinkingLevel = sanitizeRuntimeThinkingLevel(input.defaultThinkingLevel, current.defaultThinkingLevel);
  }
  if (input.defaultCustomProviderId !== undefined) {
    patch.defaultCustomProviderId = String(input.defaultCustomProviderId ?? "").trim();
  }
  if (input.modelRouting !== undefined) {
    patch.modelRouting = sanitizeModelRoutingConfig(input.modelRouting, current.modelRouting);
  }
  if (input.modelFallback !== undefined) {
    patch.modelFallback = sanitizeModelFallback(input.modelFallback, current.modelFallback);
  }
  if (input.compaction !== undefined) {
    patch.compaction = sanitizeCompaction(input.compaction, current.compaction);
  }
  if (input.systemPrompt !== undefined) {
    patch.systemPrompt = String(input.systemPrompt ?? "").trim() || defaultRuntimeSettings.systemPrompt;
  }
  if (input.timezone !== undefined) {
    patch.timezone = String(input.timezone ?? "").trim();
  }
  return patch;
}

export function sanitizeSettings(input: Partial<RuntimeSettings>, current: RuntimeSettings): RuntimeSettings {
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
            supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles),
            enabled: true
          });
        }
        continue;
      }
      if (!m || typeof m !== "object") continue;
      const modelObj = m as {
        id?: unknown;
        model?: unknown;
        tags?: unknown;
        supportedRoles?: unknown;
        verification?: unknown;
        contextWindow?: unknown;
        enabled?: unknown;
      };
      const id = String(modelObj.id ?? modelObj.model ?? "").trim();
      if (!id) continue;
      const rawVerification = modelObj.verification && typeof modelObj.verification === "object"
        ? modelObj.verification as Record<string, unknown>
        : {};
      const verification = Object.fromEntries(
        Object.entries(rawVerification)
          .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
          .filter(([key, value]) =>
            ["text", "vision", "audio_input", "stt", "tts", "tool"].includes(key) &&
            ["untested", "passed", "failed"].includes(value)
          )
      ) as ProviderModelConfig["verification"];
      models.push({
        id,
        tags: sanitizeModelTags(modelObj.tags),
        supportedRoles: sanitizeRoles(modelObj.supportedRoles ?? (row as { supportedRoles?: unknown }).supportedRoles),
        contextWindow: typeof modelObj.contextWindow === "number" && modelObj.contextWindow > 0 ? modelObj.contextWindow : undefined,
        enabled: modelObj.enabled !== false,
        verification: Object.keys(verification ?? {}).length > 0 ? verification : undefined
      });
    }
    if (models.length === 0 && legacyModel) {
      models.push({
        id: legacyModel,
        tags: [...DEFAULT_MODEL_TAGS],
        supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles),
        contextWindow: undefined,
        enabled: true
      });
    }
    const modelIds = models.map((m) => m.id);
    const defaultModelRaw = String((row as { defaultModel?: unknown }).defaultModel ?? "").trim();
    const defaultModel = modelIds.includes(defaultModelRaw) ? defaultModelRaw : (modelIds[0] ?? "");
    const name = String(row.name ?? "").trim() || id;
    const baseUrl = String(row.baseUrl ?? "").trim();
    const protocol = sanitizeCustomProviderProtocol((row as { protocol?: unknown }).protocol);
    customProviders.push({
      id,
      name,
      enabled: row.enabled === undefined ? !isKnownProvider(id) : Boolean(row.enabled),
      protocol,
      baseUrl,
      apiKey: String(row.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(row.path ?? "").trim() || (protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions"),
      supportsThinking: sanitizeOptionalThinkingSupport((row as { supportsThinking?: unknown }).supportsThinking),
      thinkingFormat: resolveCustomProviderThinkingFormat(
        (row as { thinkingFormat?: unknown }).thinkingFormat,
        { id, name, baseUrl }
      ),
      reasoningEffortMap: sanitizeReasoningEffortMap((row as { reasoningEffortMap?: unknown }).reasoningEffortMap)
    });
  }
  next.customProviders = customProviders;
  next.defaultCustomProviderId = String(next.defaultCustomProviderId ?? "").trim();
  const selectableCustomProviders = next.customProviders.filter((p) =>
    !isKnownProvider(p.id) &&
    p.models.some((model) => Array.isArray(model.tags) ? model.tags.includes("text") : true)
  );
  const enabledCustomProviders = selectableCustomProviders.filter((p) => p.enabled !== false);
  if (!enabledCustomProviders.some((p) => p.id === next.defaultCustomProviderId)) {
    next.defaultCustomProviderId = enabledCustomProviders[0]?.id ?? selectableCustomProviders[0]?.id ?? "";
  }

  next.modelRouting = {
    textModelKey: String((next as { modelRouting?: { textModelKey?: unknown } }).modelRouting?.textModelKey ?? "").trim(),
    visionModelKey: String((next as { modelRouting?: { visionModelKey?: unknown } }).modelRouting?.visionModelKey ?? "").trim(),
    sttModelKey: String((next as { modelRouting?: { sttModelKey?: unknown } }).modelRouting?.sttModelKey ?? "").trim(),
    ttsModelKey: String((next as { modelRouting?: { ttsModelKey?: unknown } }).modelRouting?.ttsModelKey ?? "").trim(),
    compactionModelKey: String((next as { modelRouting?: { compactionModelKey?: unknown } }).modelRouting?.compactionModelKey ?? "").trim(),
    subagentModelKey: String((next as { modelRouting?: { subagentModelKey?: unknown } }).modelRouting?.subagentModelKey ?? "").trim(),
    subagentHaikuModelKey: String((next as { modelRouting?: { subagentHaikuModelKey?: unknown } }).modelRouting?.subagentHaikuModelKey ?? "").trim(),
    subagentSonnetModelKey: String((next as { modelRouting?: { subagentSonnetModelKey?: unknown } }).modelRouting?.subagentSonnetModelKey ?? "").trim(),
    subagentOpusModelKey: String((next as { modelRouting?: { subagentOpusModelKey?: unknown } }).modelRouting?.subagentOpusModelKey ?? "").trim(),
    subagentThinkingModelKey: String((next as { modelRouting?: { subagentThinkingModelKey?: unknown } }).modelRouting?.subagentThinkingModelKey ?? "").trim()
  };
  const fallbackMode = String(
    (next as { modelFallback?: { mode?: unknown } }).modelFallback?.mode ??
    current.modelFallback.mode
  ).trim();
  const firstTokenTimeoutRaw = Number(
    (next as { modelFallback?: { firstTokenTimeoutMs?: unknown } }).modelFallback?.firstTokenTimeoutMs
  );
  // 0 (or a falsy value) disables the guard; any positive value is clamped to a
  // sane 1s–10min window so a typo can't make it fire after one millisecond.
  const firstTokenTimeoutMs = !Number.isFinite(firstTokenTimeoutRaw)
    ? current.modelFallback.firstTokenTimeoutMs
    : firstTokenTimeoutRaw <= 0
      ? 0
      : clampNumber(firstTokenTimeoutRaw, current.modelFallback.firstTokenTimeoutMs, 1000, 600000);
  next.modelFallback = {
    mode: fallbackMode === "off" || fallbackMode === "any-enabled" ? fallbackMode : "same-provider",
    firstTokenTimeoutMs
  };
  next.defaultThinkingLevel = sanitizeRuntimeThinkingLevel(
    (next as { defaultThinkingLevel?: unknown }).defaultThinkingLevel,
    current.defaultThinkingLevel
  );
  const compactionInput = next.compaction ?? current.compaction;
  const reserveTokensRaw = Number(compactionInput?.reserveTokens ?? current.compaction.reserveTokens);
  const keepRecentTokensRaw = Number(compactionInput?.keepRecentTokens ?? current.compaction.keepRecentTokens);
  const thresholdPercentRaw = Number(compactionInput?.thresholdPercent ?? current.compaction.thresholdPercent);
  const defaultContextWindowRaw = Number(compactionInput?.defaultContextWindow ?? current.compaction.defaultContextWindow);
  next.compaction = {
    enabled: compactionInput?.enabled === undefined ? current.compaction.enabled : Boolean(compactionInput.enabled),
    thresholdPercent: Number.isFinite(thresholdPercentRaw) ? Math.max(10, Math.min(95, Math.round(thresholdPercentRaw))) : current.compaction.thresholdPercent,
    reserveTokens: Number.isFinite(reserveTokensRaw) ? Math.max(1024, Math.round(reserveTokensRaw)) : current.compaction.reserveTokens,
    keepRecentTokens: Number.isFinite(keepRecentTokensRaw) ? Math.max(2048, Math.round(keepRecentTokensRaw)) : current.compaction.keepRecentTokens,
    defaultContextWindow: Number.isFinite(defaultContextWindowRaw) ? Math.max(1024, Math.round(defaultContextWindowRaw)) : current.compaction.defaultContextWindow
  };

  next.systemPrompt = String(next.systemPrompt ?? "").trim() || defaultRuntimeSettings.systemPrompt;
  next.locale = next.locale === "zh-CN" ? "zh-CN" : "en-US";
  const sanitizedAgents = sanitizeAgents(next.agents ?? current.agents);
  next.agents = sanitizedAgents.length > 0 ? sanitizedAgents : [defaultAgentSettings()];
  const sanitizedTelegramBots = sanitizeTelegramBots(next.telegramBots);
  const sanitizedFeishuBots = sanitizeFeishuBots(next.feishuBots);
  const sanitizedQQBots = sanitizeQQBots(next.qqBots);
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
  next.qqBots = sanitizedQQBots;
  next.mcpServers = sanitizeMcpServers(next.mcpServers ?? current.mcpServers);
  next.skillSearch = sanitizeSkillSearchSettings(next.skillSearch ?? current.skillSearch, current.skillSearch);
  next.skillDrafts = sanitizeSkillDraftSettings(next.skillDrafts ?? current.skillDrafts, current.skillDrafts);
  next.webSearch = sanitizeWebSearchSettings(next.webSearch ?? current.webSearch, current.webSearch);
  next.imageGenerate = sanitizeImageGenerateSettings(next.imageGenerate ?? current.imageGenerate, current.imageGenerate);
  next.videoGenerate = sanitizeVideoGenerateSettings(next.videoGenerate ?? current.videoGenerate, current.videoGenerate);
  next.ttsGenerate = sanitizeTtsGenerateSettings(next.ttsGenerate ?? current.ttsGenerate, current.ttsGenerate);
  next.toolSandbox = sanitizeToolSandboxSettings(next.toolSandbox ?? current.toolSandbox, current.toolSandbox);
  next.hostTools = sanitizeHostToolSettings(next.hostTools ?? current.hostTools);
  next.disabledSkillPaths = Array.isArray(next.disabledSkillPaths)
    ? next.disabledSkillPaths.map((v) => String(v).trim()).filter(Boolean)
    : current.disabledSkillPaths;
  next.channels = sanitizeChannels(next.channels, next.telegramBots, next.feishuBots, next.qqBots, current.channels);
  if (next.agents.some((agent) => agent.id === DEFAULT_AGENT_ID)) {
    const webInstances = Array.isArray(next.channels.web?.instances) ? next.channels.web.instances : [];
    next.channels.web = {
      instances: webInstances.length > 0
        ? webInstances.map((instance) =>
          instance.id === "default" && !String(instance.agentId ?? "").trim()
            ? { ...instance, agentId: DEFAULT_AGENT_ID }
            : instance
        )
        : [{
          id: "default",
          name: "Default Web",
          enabled: true,
          agentId: DEFAULT_AGENT_ID,
          credentials: {},
          allowedChatIds: []
        }]
    };
  }

  const displayInput = next.display ?? current.display;
  next.display = {
    toolProgress: displayInput && ["off", "new", "all", "verbose"].includes(String(displayInput.toolProgress)) ? (displayInput.toolProgress as any) : (current.display?.toolProgress ?? "all"),
    showReasoning: displayInput && ["off", "on", "stream", "new"].includes(String(displayInput.showReasoning)) ? (displayInput.showReasoning as any) : (current.display?.showReasoning ?? "off"),
    gatewayNotifyInterval: displayInput && !isNaN(Number(displayInput.gatewayNotifyInterval)) ? Number(displayInput.gatewayNotifyInterval) : (current.display?.gatewayNotifyInterval ?? 0),
    runLogNotice: displayInput?.runLogNotice === undefined ? (current.display?.runLogNotice ?? false) : Boolean(displayInput.runLogNotice)
  };

  next.telegramBotToken = next.telegramBots[0]?.token ?? "";
  next.telegramAllowedChatIds = next.telegramBots[0]?.allowedChatIds ?? [];
  const memoryPluginInput = next.plugins?.memory ?? current.plugins.memory;
  // Dynamic feature-plugin settings live as extra keys on plugins (keyed by
  // each plugin's settingsKey); carry them through so a save never drops them.
  const currentPluginExtras = Object.fromEntries(
    Object.entries(current.plugins as unknown as Record<string, unknown>)
      .filter(([key]) => !["memory", "cloudflareHtml", "hooks"].includes(key))
  );
  const nextPluginExtras = next.plugins
    ? Object.fromEntries(
        Object.entries(next.plugins as unknown as Record<string, unknown>)
          .filter(([key]) => !["memory", "cloudflareHtml", "hooks"].includes(key))
      )
    : {};
  next.plugins = {
    ...currentPluginExtras,
    ...nextPluginExtras,
    memory: sanitizeMemoryPluginSettings(memoryPluginInput, current.plugins.memory),
    cloudflareHtml: sanitizeCloudflareHtmlPluginSettings(
      next.plugins?.cloudflareHtml ?? current.plugins.cloudflareHtml,
      current.plugins.cloudflareHtml
    ),
    hooks: sanitizeHookPluginEntries(next.plugins?.hooks ?? current.plugins.hooks)
  } as RuntimeSettings["plugins"];

  next.budget = sanitizeBudgetSettings(next.budget ?? current.budget, current.budget);
  next.events = sanitizeEventExecutionSettings(next.events ?? current.events, current.events);

  const browserInput = next.browserAutomation ?? current.browserAutomation;
  const browserTimeoutRaw = browserInput?.defaultTimeoutMs;
  next.browserAutomation = {
    defaultTimeoutMs: browserTimeoutRaw != null && Number.isFinite(Number(browserTimeoutRaw))
      ? Math.max(5000, Math.min(300000, Math.round(Number(browserTimeoutRaw))))
      : current.browserAutomation.defaultTimeoutMs
  };

  return next;
}
