import { DatabaseSync } from "node:sqlite";
import {
  type AgentSettings,
  DEFAULT_AGENT_ID,
  type ChannelSettingsMap,
  defaultRuntimeSettings,
  defaultAgentSettings,
  sanitizeAgentModelRouting,
  type ModelCapabilityTag,
  type ModelCapabilityVerification,
  type ProviderModelConfig,
  type McpServerConfig,
  type CustomProviderConfig,
  type CustomProviderProtocol,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  isKnownProvider,
  type ProviderMode,
  type RuntimeSettings,
  type WebSearchEngineId,
  type WebSearchEngineSelectionStrategy,
  type WebSearchRoute,
  type ImageGenerateEngineId,
  type ImageGenerateSettings,
  type VideoGenerateEngineId,
  type VideoGenerateSettings,
  type TtsGenerateSettings
} from "$lib/server/settings/index.js";
import { sanitizeHostToolSettings } from "$lib/server/settings/hostTools.js";
import { sanitizeToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import {
  sanitizeChannelInstanceDisplaySettings,
  sanitizeHookPluginEntries,
  sanitizeMemoryPluginSettings,
  sanitizeTtsGenerateSettings
} from "$lib/server/settings/sanitize.js";
import {
  resolveCustomProviderThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap,
  sanitizeRuntimeThinkingLevel
} from "$lib/server/settings/thinking.js";
import { ensureSqliteParentDir, readJsonFile, storagePaths, writeJsonFile } from "$lib/server/infra/db/storage.js";
import { normalizeTimeZone } from "$lib/server/time.js";

type DynamicSettingKey =
  | "customProviders"
  | "channels"
  | "agents"
  | "webSearch"
  | "imageGenerate"
  | "videoGenerate"
  | "ttsGenerate"
  | "toolSandbox";
const DYNAMIC_SETTING_KEYS: DynamicSettingKey[] = [
  "customProviders",
  "channels",
  "agents",
  "webSearch",
  "imageGenerate",
  "videoGenerate",
  "ttsGenerate",
  "toolSandbox"
];

interface RawSettings {
  providerMode?: string;
  piModelProvider?: string;
  piModelName?: string;
  defaultThinkingLevel?: string;
  customProviders?: unknown;
  defaultCustomProviderId?: string;
  modelRouting?: {
    textModelKey?: string;
    visionModelKey?: string;
    sttModelKey?: string;
    ttsModelKey?: string;
    compactionModelKey?: string;
    subagentModelKey?: string;
    subagentHaikuModelKey?: string;
    subagentSonnetModelKey?: string;
    subagentOpusModelKey?: string;
    subagentThinkingModelKey?: string;
  };
  modelFallback?: {
    mode?: string;
    firstTokenTimeoutMs?: number | string;
  };
  compaction?: {
    enabled?: boolean | string;
    thresholdPercent?: number | string;
    reserveTokens?: number | string;
    keepRecentTokens?: number | string;
    defaultContextWindow?: number | string;
  };
  systemPrompt?: string;
  locale?: string;
  serverPort?: number | string;
  plugins?: {
    memory?: {
      enabled?: boolean | string;
      backend?: string;
      core?: string;
      embeddingProviderId?: string;
      embeddingModel?: string;
      reflectionTime?: string;
      reflectionNotifications?: boolean;
      reflectionNotificationTarget?: unknown;
      dailyMaterials?: Record<string, unknown>;
    };
    hooks?: unknown;
    cloudflareHtml?: {
      enabled?: boolean | string;
      accessMode?: string;
      workerBaseHost?: string;
      publicBaseHost?: string;
      publicBaseUrl?: string;
      routePrefix?: string;
      bucketName?: string;
      accountId?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      objectPrefix?: string;
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
  qqBots?: unknown;
  mcpServers?: unknown;
  skillSearch?: unknown;
  skillDrafts?: unknown;
  webSearch?: unknown;
  imageGenerate?: unknown;
  videoGenerate?: unknown;
  ttsGenerate?: unknown;
  toolSandbox?: unknown;
  hostTools?: unknown;
  disabledSkillPaths?: unknown;
  budget?: {
    maxToolCalls?: number | string;
    maxToolFailures?: number | string;
    maxModelAttempts?: number | string;
  };
  events?: {
    executionTimeoutMs?: number | string;
    maxAttempts?: number | string;
    retryDelayMs?: number | string;
    taskSessionRetentionDays?: number | string;
  };
  display?: unknown;
  browserAutomation?: {
    defaultTimeoutMs?: number | string;
  };
}

type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
const DEFAULT_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const CAPABILITY_VERIFICATION_SET: ReadonlySet<string> = new Set(["untested", "passed", "failed"]);
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

function sanitizeSkillSearchSettings(input: unknown): RuntimeSettings["skillSearch"] {
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
      enabled: local.enabled === undefined
        ? defaultRuntimeSettings.skillSearch.local.enabled
        : Boolean(local.enabled)
    },
    api: {
      enabled: api.enabled === undefined
        ? defaultRuntimeSettings.skillSearch.api.enabled
        : Boolean(api.enabled),
      provider: String(api.provider ?? defaultRuntimeSettings.skillSearch.api.provider).trim(),
      baseUrl: String(api.baseUrl ?? defaultRuntimeSettings.skillSearch.api.baseUrl).trim(),
      apiKey: String(api.apiKey ?? defaultRuntimeSettings.skillSearch.api.apiKey).trim(),
      model: String(api.model ?? defaultRuntimeSettings.skillSearch.api.model).trim(),
      path: String(api.path ?? defaultRuntimeSettings.skillSearch.api.path).trim()
        || defaultRuntimeSettings.skillSearch.api.path,
      maxTokens: clampNumber(
        api.maxTokens,
        defaultRuntimeSettings.skillSearch.api.maxTokens,
        128,
        4096
      ),
      temperature: clampNumber(
        api.temperature,
        defaultRuntimeSettings.skillSearch.api.temperature,
        0,
        1
      ),
      timeoutMs: clampNumber(
        api.timeoutMs,
        defaultRuntimeSettings.skillSearch.api.timeoutMs,
        1000,
        60000
      ),
      minConfidence: clampNumber(
        api.minConfidence,
        defaultRuntimeSettings.skillSearch.api.minConfidence,
        0,
        1
      )
    }
  };
}

function sanitizeSkillDraftSettings(input: unknown): RuntimeSettings["skillDrafts"] {
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
      enabled: autoSave.enabled === undefined
        ? defaultRuntimeSettings.skillDrafts.autoSave.enabled
        : Boolean(autoSave.enabled),
      minToolCalls: clampNumber(
        autoSave.minToolCalls,
        defaultRuntimeSettings.skillDrafts.autoSave.minToolCalls,
        1,
        200
      ),
      allowRecoveredToolFailures: autoSave.allowRecoveredToolFailures === undefined
        ? defaultRuntimeSettings.skillDrafts.autoSave.allowRecoveredToolFailures
        : Boolean(autoSave.allowRecoveredToolFailures),
      allowModelRetries: autoSave.allowModelRetries === undefined
        ? defaultRuntimeSettings.skillDrafts.autoSave.allowModelRetries
        : Boolean(autoSave.allowModelRetries)
    },
    template: {
      skillPath: String(template.skillPath ?? defaultRuntimeSettings.skillDrafts.template.skillPath).trim()
    }
  };
}

function sanitizeWebSearchSettings(input: unknown): RuntimeSettings["webSearch"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const engines = Object.fromEntries(WEB_SEARCH_ENGINES.map((engine) => {
    const fallbackEngine = defaultRuntimeSettings.webSearch.engines[engine];
    const raw = enginesSource[engine] && typeof enginesSource[engine] === "object"
      ? enginesSource[engine] as Record<string, unknown>
      : {};
    return [engine, {
      enabled: raw.enabled === undefined ? fallbackEngine.enabled : Boolean(raw.enabled),
      apiKey: String(raw.apiKey ?? fallbackEngine.apiKey ?? "").trim(),
      baseUrl: String(raw.baseUrl ?? fallbackEngine.baseUrl ?? "").trim() || undefined
    }];
  })) as RuntimeSettings["webSearch"]["engines"];
  const rawRoute = String(source.defaultRoute ?? defaultRuntimeSettings.webSearch.defaultRoute).trim();
  const route = (LEGACY_WEB_SEARCH_ROUTE_MAP[rawRoute] ?? rawRoute) as WebSearchRoute;
  const engine = String(source.defaultEngine ?? defaultRuntimeSettings.webSearch.defaultEngine).trim() as WebSearchEngineId | "auto";
  const engineSelectionStrategy = String(
    source.engineSelectionStrategy ?? defaultRuntimeSettings.webSearch.engineSelectionStrategy
  ).trim() as WebSearchEngineSelectionStrategy;
  return {
    enabled: source.enabled === undefined ? defaultRuntimeSettings.webSearch.enabled : Boolean(source.enabled),
    defaultRoute: WEB_SEARCH_ROUTES.includes(route) ? route : defaultRuntimeSettings.webSearch.defaultRoute,
    defaultEngine: engine === "auto" || WEB_SEARCH_ENGINES.includes(engine) ? engine : defaultRuntimeSettings.webSearch.defaultEngine,
    engineSelectionStrategy: WEB_SEARCH_ENGINE_SELECTION_STRATEGIES.includes(engineSelectionStrategy)
      ? engineSelectionStrategy
      : defaultRuntimeSettings.webSearch.engineSelectionStrategy,
    maxResults: clampNumber(source.maxResults, defaultRuntimeSettings.webSearch.maxResults, 1, 20),
    timeoutMs: clampNumber(source.timeoutMs, defaultRuntimeSettings.webSearch.timeoutMs, 1000, 120000),
    retryTimeoutMs: clampNumber(source.retryTimeoutMs, defaultRuntimeSettings.webSearch.retryTimeoutMs, 1000, 180000),
    engines
  };
}

function sanitizeImageGenerateSettings(input: unknown): RuntimeSettings["imageGenerate"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const requestedDefaultEngine = String(source.defaultEngine ?? defaultRuntimeSettings.imageGenerate.defaultEngine).trim() as ImageGenerateEngineId | "auto";
  const engines = Object.fromEntries(IMAGE_GENERATE_ENGINES.map((engine) => {
    const fallbackEngine = defaultRuntimeSettings.imageGenerate.engines[engine];
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
    enabled: source.enabled === undefined ? defaultRuntimeSettings.imageGenerate.enabled : Boolean(source.enabled),
    defaultEngine: requestedDefaultEngine === "auto" || IMAGE_GENERATE_ENGINES.includes(requestedDefaultEngine) ? requestedDefaultEngine : defaultRuntimeSettings.imageGenerate.defaultEngine,
    engines
  };
}

function sanitizeVideoGenerateSettings(input: unknown): RuntimeSettings["videoGenerate"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enginesSource = source.engines && typeof source.engines === "object"
    ? source.engines as Record<string, unknown>
    : {};
  const requestedDefaultEngine = String(source.defaultEngine ?? defaultRuntimeSettings.videoGenerate.defaultEngine).trim() as VideoGenerateEngineId | "auto";
  const engines = Object.fromEntries(VIDEO_GENERATE_ENGINES.map((engine) => {
    const fallbackEngine = defaultRuntimeSettings.videoGenerate.engines[engine];
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
    enabled: source.enabled === undefined ? defaultRuntimeSettings.videoGenerate.enabled : Boolean(source.enabled),
    defaultEngine: requestedDefaultEngine === "auto" || VIDEO_GENERATE_ENGINES.includes(requestedDefaultEngine) ? requestedDefaultEngine : defaultRuntimeSettings.videoGenerate.defaultEngine,
    engines
  };
}


function sanitizeBudgetSettings(input: unknown): RuntimeSettings["budget"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const maxToolCallsRaw = Number(source.maxToolCalls ?? defaultRuntimeSettings.budget.maxToolCalls);
  const maxToolFailuresRaw = Number(source.maxToolFailures ?? defaultRuntimeSettings.budget.maxToolFailures);
  const maxModelAttemptsRaw = Number(source.maxModelAttempts ?? defaultRuntimeSettings.budget.maxModelAttempts);

  const maxToolCalls = Number.isFinite(maxToolCallsRaw)
    ? Math.max(1, Math.min(500, Math.round(maxToolCallsRaw)))
    : defaultRuntimeSettings.budget.maxToolCalls;
  const maxToolFailures = Number.isFinite(maxToolFailuresRaw)
    ? Math.max(1, Math.min(100, Math.round(maxToolFailuresRaw)))
    : defaultRuntimeSettings.budget.maxToolFailures;
  const maxModelAttempts = Number.isFinite(maxModelAttemptsRaw)
    ? Math.max(1, Math.min(100, Math.round(maxModelAttemptsRaw)))
    : defaultRuntimeSettings.budget.maxModelAttempts;

  return {
    maxToolCalls,
    maxToolFailures,
    maxModelAttempts
  };
}

function sanitizeBrowserAutomationSettings(input: unknown): RuntimeSettings["browserAutomation"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const defaultTimeoutMsRaw = Number(source.defaultTimeoutMs ?? defaultRuntimeSettings.browserAutomation.defaultTimeoutMs);
  const defaultTimeoutMs = Number.isFinite(defaultTimeoutMsRaw)
    ? Math.max(5000, Math.min(300000, Math.round(defaultTimeoutMsRaw)))
    : defaultRuntimeSettings.browserAutomation.defaultTimeoutMs;
  return { defaultTimeoutMs };
}

function sanitizeEventExecutionSettings(input: unknown): RuntimeSettings["events"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const executionTimeoutMsRaw = Number(source.executionTimeoutMs ?? defaultRuntimeSettings.events.executionTimeoutMs);
  const maxAttemptsRaw = Number(source.maxAttempts ?? defaultRuntimeSettings.events.maxAttempts);
  const retryDelayMsRaw = Number(source.retryDelayMs ?? defaultRuntimeSettings.events.retryDelayMs);
  const taskSessionRetentionDaysRaw = Number(
    source.taskSessionRetentionDays ?? defaultRuntimeSettings.events.taskSessionRetentionDays
  );
  return {
    executionTimeoutMs: Number.isFinite(executionTimeoutMsRaw)
      ? Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.round(executionTimeoutMsRaw)))
      : defaultRuntimeSettings.events.executionTimeoutMs,
    maxAttempts: Number.isFinite(maxAttemptsRaw)
      ? Math.max(1, Math.min(20, Math.round(maxAttemptsRaw)))
      : defaultRuntimeSettings.events.maxAttempts,
    retryDelayMs: Number.isFinite(retryDelayMsRaw)
      ? Math.max(0, Math.min(60 * 60 * 1000, Math.round(retryDelayMsRaw)))
      : defaultRuntimeSettings.events.retryDelayMs,
    taskSessionRetentionDays: Number.isFinite(taskSessionRetentionDaysRaw)
      ? Math.max(0, Math.min(365, Math.round(taskSessionRetentionDaysRaw)))
      : defaultRuntimeSettings.events.taskSessionRetentionDays
  };
}

function sanitizeCloudflareHtmlPluginSettings(input: unknown): RuntimeSettings["plugins"]["cloudflareHtml"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const enabledRaw = source.enabled;
  return {
    enabled: typeof enabledRaw === "boolean"
      ? enabledRaw
      : enabledRaw === undefined
        ? defaultRuntimeSettings.plugins.cloudflareHtml.enabled
        : String(enabledRaw).toLowerCase() === "true",
    accessMode: String(
      source.accessMode ?? defaultRuntimeSettings.plugins.cloudflareHtml.accessMode
    ).trim() === "direct"
      ? "direct"
      : "worker",
    workerBaseHost: String(
      source.workerBaseHost ??
      source.publicBaseUrl ??
      defaultRuntimeSettings.plugins.cloudflareHtml.workerBaseHost
    ).trim(),
    publicBaseHost: String(
      source.publicBaseHost ?? defaultRuntimeSettings.plugins.cloudflareHtml.publicBaseHost
    ).trim(),
    routePrefix: String(
      source.routePrefix ?? defaultRuntimeSettings.plugins.cloudflareHtml.routePrefix
    ).trim() || defaultRuntimeSettings.plugins.cloudflareHtml.routePrefix,
    bucketName: String(
      source.bucketName ?? defaultRuntimeSettings.plugins.cloudflareHtml.bucketName
    ).trim(),
    accountId: String(
      source.accountId ?? defaultRuntimeSettings.plugins.cloudflareHtml.accountId
    ).trim(),
    accessKeyId: String(
      source.accessKeyId ?? defaultRuntimeSettings.plugins.cloudflareHtml.accessKeyId
    ).trim(),
    secretAccessKey: String(
      source.secretAccessKey ?? defaultRuntimeSettings.plugins.cloudflareHtml.secretAccessKey
    ).trim(),
    objectPrefix: String(
      source.objectPrefix ?? defaultRuntimeSettings.plugins.cloudflareHtml.objectPrefix
    ).trim() || defaultRuntimeSettings.plugins.cloudflareHtml.objectPrefix
  };
}

function sanitizeMcpServers(input: unknown): McpServerConfig[] {
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
      if (id) models.push({ id, tags: [...DEFAULT_MODEL_TAGS], supportedRoles: [...providerRoles], enabled: true });
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
      contextWindow: typeof obj.contextWindow === "number" && obj.contextWindow > 0 ? obj.contextWindow : undefined,
      enabled: obj.enabled !== false,
      verification: sanitizeVerification(obj.verification)
    });
  }

  if (models.length === 0 && legacySingle) {
    models.push({ id: legacySingle, tags: [...DEFAULT_MODEL_TAGS], supportedRoles: [...providerRoles], enabled: true });
  }

  const defaultModelRaw = String(item.defaultModel ?? "").trim();
  const ids = models.map((m) => m.id);
  const defaultModel = ids.includes(defaultModelRaw) ? defaultModelRaw : (ids[0] ?? "");
  return { models, defaultModel };
}

function sanitizeMode(input: unknown): ProviderMode {
  return String(input ?? "").toLowerCase() === "custom" ? "custom" : "pi";
}

function sanitizeModelFallbackSettings(input: unknown): RuntimeSettings["modelFallback"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const mode = String(source.mode ?? defaultRuntimeSettings.modelFallback.mode).trim();
  const firstTokenTimeoutRaw = Number(source.firstTokenTimeoutMs);
  // 0 (or a falsy value) disables the first-token guard; any positive value is
  // clamped to a sane 1s–10min window.
  const firstTokenTimeoutMs = !Number.isFinite(firstTokenTimeoutRaw)
    ? defaultRuntimeSettings.modelFallback.firstTokenTimeoutMs
    : firstTokenTimeoutRaw <= 0
      ? 0
      : clampNumber(firstTokenTimeoutRaw, defaultRuntimeSettings.modelFallback.firstTokenTimeoutMs, 1000, 600000);
  return {
    mode: mode === "off" || mode === "any-enabled" ? mode : "same-provider",
    firstTokenTimeoutMs
  };
}

function normalizeBuiltInRouteKey(value: unknown): string {
  const raw = String(value ?? "").trim();
  const [mode, provider, ...rest] = raw.split("|");
  if (mode !== "custom" || !provider || rest.length === 0) return raw;
  const providerId = provider.trim();
  if (!isKnownProvider(providerId)) return raw;
  const model = rest.join("|").trim();
  return model ? `pi|${providerId}|${model}` : raw;
}

function sanitizeCustomProviderProtocol(input: unknown): CustomProviderProtocol {
  return String(input ?? "").trim() === "anthropic" ? "anthropic" : "openai-compatible";
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
    const name = String(item.name ?? "").trim() || id;
    const baseUrl = String(item.baseUrl ?? "").trim();
    const protocol = sanitizeCustomProviderProtocol(item.protocol);

    out.push({
      id,
      name,
      enabled: item.enabled === undefined ? !isKnownProvider(id) : Boolean(item.enabled),
      protocol,
      baseUrl,
      apiKey: String(item.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(item.path ?? "").trim() || (protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions"),
      supportsThinking: sanitizeOptionalThinkingSupport(item.supportsThinking),
      thinkingFormat: resolveCustomProviderThinkingFormat(item.thinkingFormat, { id, name, baseUrl }),
      reasoningEffortMap: sanitizeReasoningEffortMap(item.reasoningEffortMap)
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
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled),
      modelRouting: sanitizeAgentModelRouting(item.modelRouting)
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

function sanitizeQQBots(input: unknown): QQBotConfig[] {
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
      allowedChatIds: sanitizeList(item.allowedChatIds)
    });
  }

  return out;
}

function sanitizeChannels(
  input: unknown,
  telegramBots: TelegramBotConfig[],
  feishuBots: FeishuBotConfig[],
  qqBots: QQBotConfig[]
): ChannelSettingsMap {
  const channels: ChannelSettingsMap = {};
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const hasExplicitTelegram = Object.prototype.hasOwnProperty.call(source, "telegram");
  const hasExplicitFeishu = Object.prototype.hasOwnProperty.call(source, "feishu");
  const hasExplicitQQ = Object.prototype.hasOwnProperty.call(source, "qq");

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
          allowedChatIds: sanitizeList(item.allowedChatIds),
          sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled),
          display: item.display ? sanitizeChannelInstanceDisplaySettings(item.display) : undefined
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
      credentials: {
        appId: bot.appId,
        appSecret: bot.appSecret,
        verificationToken: bot.verificationToken ?? "",
        encryptKey: bot.encryptKey ?? ""
      },
      allowedChatIds: bot.allowedChatIds
    }))
  };

  channels.qq = channels.qq ?? (hasExplicitQQ ? channels.qq : undefined) ?? {
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
      verificationToken: String(instance.credentials?.verificationToken ?? "").trim() || undefined,
      encryptKey: String(instance.credentials?.encryptKey ?? "").trim() || undefined,
      allowedChatIds: Array.isArray(instance.allowedChatIds) ? instance.allowedChatIds : []
    });
  }
  return out;
}

function deriveQQBotsFromChannels(channels: ChannelSettingsMap): QQBotConfig[] {
  const instances = channels.qq?.instances ?? [];
  const out: QQBotConfig[] = [];
  for (const instance of instances) {
    const appId = String(instance.credentials?.appId ?? "").trim();
    const clientSecret = String(instance.credentials?.clientSecret ?? "").trim();
    if (!appId || !clientSecret) continue;
    out.push({
      id: instance.id,
      name: instance.name || instance.id,
      appId,
      clientSecret,
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
      protocol: "openai-compatible",
      baseUrl,
      apiKey,
      models: model ? [{ id: model, tags: ["text"], enabled: true, supportedRoles: [...DEFAULT_ROLES] }] : [],
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
  const selectableCustomProviders = customProviders.filter((p) =>
    !isKnownProvider(p.id) &&
    p.models.some((model) => Array.isArray(model.tags) ? model.tags.includes("text") : true)
  );
  const enabledCustomProviders = selectableCustomProviders.filter((p) => p.enabled !== false);
  if (!enabledCustomProviders.some((p) => p.id === defaultCustomProviderId)) {
    defaultCustomProviderId = enabledCustomProviders[0]?.id ?? selectableCustomProviders[0]?.id ?? "";
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
    : memoryEnabledRaw == null
      ? defaultRuntimeSettings.plugins.memory.enabled
      : String(memoryEnabledRaw).toLowerCase() === "true";
  // Full memory plugin block (reflection + daily materials included) so a
  // restart never resets fields the save path persisted.
  const memoryPlugin = sanitizeMemoryPluginSettings(
    { ...(raw.plugins?.memory ?? {}), enabled: memoryEnabled },
    defaultRuntimeSettings.plugins.memory
  );
  const cloudflareHtml = sanitizeCloudflareHtmlPluginSettings(raw.plugins?.cloudflareHtml);
  const hookPlugins = sanitizeHookPluginEntries(raw.plugins?.hooks);
  // Feature-plugin settings blobs (keyed by settingsKey) round-trip untouched.
  const pluginExtras = raw.plugins && typeof raw.plugins === "object"
    ? Object.fromEntries(
        Object.entries(raw.plugins as Record<string, unknown>)
          .filter(([key, value]) => !["memory", "cloudflareHtml", "hooks"].includes(key) && value && typeof value === "object")
      )
    : {};

  const feishuBotsFromList = sanitizeFeishuBots(raw.feishuBots);
  const feishuBots = feishuBotsFromList.length > 0 ? feishuBotsFromList : [];
  const qqBotsFromList = sanitizeQQBots(raw.qqBots);
  const qqBots = qqBotsFromList.length > 0 ? qqBotsFromList : [];
  const sanitizedAgents = sanitizeAgents(raw.agents);
  const agents = sanitizedAgents.length > 0 ? sanitizedAgents : [defaultAgentSettings()];
  const channels = sanitizeChannels(raw.channels, telegramBots, feishuBots, qqBots);
  if (agents.some((agent) => agent.id === DEFAULT_AGENT_ID)) {
    const webInstances = Array.isArray(channels.web?.instances) ? channels.web.instances : [];
    channels.web = {
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
  const effectiveTelegramBots = telegramBots.length > 0 ? telegramBots : deriveTelegramBotsFromChannels(channels);
  const effectiveFeishuBots = feishuBots.length > 0 ? feishuBots : deriveFeishuBotsFromChannels(channels);
  const effectiveQQBots = qqBots.length > 0 ? qqBots : deriveQQBotsFromChannels(channels);
  const primaryBot = effectiveTelegramBots[0];
  const mcpServers = sanitizeMcpServers(raw.mcpServers ?? defaultRuntimeSettings.mcpServers);
  const skillSearch = sanitizeSkillSearchSettings(raw.skillSearch ?? defaultRuntimeSettings.skillSearch);
  const skillDrafts = sanitizeSkillDraftSettings(raw.skillDrafts ?? defaultRuntimeSettings.skillDrafts);
  const webSearch = sanitizeWebSearchSettings(raw.webSearch ?? defaultRuntimeSettings.webSearch);
  const imageGenerate = sanitizeImageGenerateSettings(raw.imageGenerate ?? defaultRuntimeSettings.imageGenerate);
  const videoGenerate = sanitizeVideoGenerateSettings(raw.videoGenerate ?? defaultRuntimeSettings.videoGenerate);
  const ttsGenerate = sanitizeTtsGenerateSettings(raw.ttsGenerate ?? defaultRuntimeSettings.ttsGenerate);
  const toolSandbox = sanitizeToolSandboxSettings(raw.toolSandbox ?? defaultRuntimeSettings.toolSandbox);
  const hostTools = sanitizeHostToolSettings(raw.hostTools ?? defaultRuntimeSettings.hostTools);
  const disabledSkillPaths = sanitizeList(raw.disabledSkillPaths);
  const budget = sanitizeBudgetSettings(raw.budget);
  const events = sanitizeEventExecutionSettings(raw.events);
  const browserAutomation = sanitizeBrowserAutomationSettings(raw.browserAutomation);
  const displayInput = raw.display ?? defaultRuntimeSettings.display;
  const display = {
    toolProgress: displayInput && ["off", "new", "all", "verbose"].includes(String((displayInput as any).toolProgress)) ? ((displayInput as any).toolProgress as any) : (defaultRuntimeSettings.display?.toolProgress ?? "all"),
    showReasoning: displayInput && ["off", "on", "stream", "new"].includes(String((displayInput as any).showReasoning)) ? ((displayInput as any).showReasoning as any) : (defaultRuntimeSettings.display?.showReasoning ?? "off"),
    gatewayNotifyInterval: displayInput && !isNaN(Number((displayInput as any).gatewayNotifyInterval)) ? Number((displayInput as any).gatewayNotifyInterval) : (defaultRuntimeSettings.display?.gatewayNotifyInterval ?? 0),
    runLogNotice: (displayInput as any)?.runLogNotice === undefined ? (defaultRuntimeSettings.display?.runLogNotice ?? false) : Boolean((displayInput as any).runLogNotice)
  };
  const compactionEnabledRaw = raw.compaction?.enabled;
  const compactionEnabled =
    typeof compactionEnabledRaw === "boolean"
      ? compactionEnabledRaw
      : compactionEnabledRaw === undefined
        ? defaultRuntimeSettings.compaction.enabled
        : String(compactionEnabledRaw).toLowerCase() === "true";
  const reserveTokensRaw = Number(raw.compaction?.reserveTokens ?? defaultRuntimeSettings.compaction.reserveTokens);
  const keepRecentTokensRaw = Number(raw.compaction?.keepRecentTokens ?? defaultRuntimeSettings.compaction.keepRecentTokens);
  const thresholdPercentRaw = Number(raw.compaction?.thresholdPercent ?? defaultRuntimeSettings.compaction.thresholdPercent);
  const reserveTokens = Number.isFinite(reserveTokensRaw)
    ? Math.max(1024, Math.round(reserveTokensRaw))
    : defaultRuntimeSettings.compaction.reserveTokens;
  const keepRecentTokens = Number.isFinite(keepRecentTokensRaw)
    ? Math.max(2048, Math.round(keepRecentTokensRaw))
    : defaultRuntimeSettings.compaction.keepRecentTokens;
  const thresholdPercent = Number.isFinite(thresholdPercentRaw)
    ? Math.max(10, Math.min(95, Math.round(thresholdPercentRaw)))
    : defaultRuntimeSettings.compaction.thresholdPercent;
  const defaultContextWindowRaw = Number(raw.compaction?.defaultContextWindow ?? defaultRuntimeSettings.compaction.defaultContextWindow);
  const defaultContextWindow = Number.isFinite(defaultContextWindowRaw)
    ? Math.max(1024, Math.round(defaultContextWindowRaw))
    : defaultRuntimeSettings.compaction.defaultContextWindow;

  return {
    providerMode: sanitizeMode(raw.providerMode ?? defaultRuntimeSettings.providerMode),
    piModelProvider: isKnownProvider(piProviderRaw)
      ? piProviderRaw
      : defaultRuntimeSettings.piModelProvider,
    piModelName: String(raw.piModelName ?? defaultRuntimeSettings.piModelName).trim() ||
      defaultRuntimeSettings.piModelName,
    defaultThinkingLevel: sanitizeRuntimeThinkingLevel(
      raw.defaultThinkingLevel,
      defaultRuntimeSettings.defaultThinkingLevel
    ),
    customProviders,
    defaultCustomProviderId,
    modelRouting: {
      textModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.textModelKey),
      visionModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.visionModelKey),
      sttModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.sttModelKey),
      ttsModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.ttsModelKey),
      compactionModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.compactionModelKey),
      subagentModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.subagentModelKey),
      subagentHaikuModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.subagentHaikuModelKey),
      subagentSonnetModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.subagentSonnetModelKey),
      subagentOpusModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.subagentOpusModelKey),
      subagentThinkingModelKey: normalizeBuiltInRouteKey(raw.modelRouting?.subagentThinkingModelKey)
    },
    modelFallback: sanitizeModelFallbackSettings(raw.modelFallback),
    compaction: {
      enabled: compactionEnabled,
      thresholdPercent,
      reserveTokens,
      keepRecentTokens,
      defaultContextWindow
    },
    systemPrompt:
      String(raw.systemPrompt ?? defaultRuntimeSettings.systemPrompt).trim() ||
      defaultRuntimeSettings.systemPrompt,
    locale: raw.locale === "en-US" ? "en-US" : "zh-CN",
    serverPort: Math.round(clampNumber(raw.serverPort, defaultRuntimeSettings.serverPort, 1024, 65535)),
    agents,
    channels,
    mcpServers,
    skillSearch,
    skillDrafts,
    webSearch,
    imageGenerate,
    videoGenerate,
    ttsGenerate,
    toolSandbox,
    hostTools,
    disabledSkillPaths,
    telegramBots: effectiveTelegramBots,
    qqBots: effectiveQQBots,
    plugins: {
      ...pluginExtras,
      memory: memoryPlugin,
      cloudflareHtml,
      hooks: hookPlugins
    } as RuntimeSettings["plugins"],
    timezone: normalizeTimeZone(
      String(raw.timezone ?? ""),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    ),
    telegramBotToken: primaryBot?.token ?? "",
    telegramAllowedChatIds: primaryBot?.allowedChatIds ?? [],
    feishuBots: effectiveFeishuBots,
    budget,
    events,
    browserAutomation,
    display
  };
}

export class SettingsStore {
  private openDynamicDb(): DatabaseSync {
    ensureSqliteParentDir(storagePaths.settingsDbFile);
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
        model_routing_json TEXT,
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
        sandbox_enabled INTEGER,
        display_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_key, id)
      );
      CREATE TABLE IF NOT EXISTS settings_custom_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'openai-compatible',
        default_model TEXT NOT NULL,
        path TEXT NOT NULL,
        supports_thinking INTEGER,
        thinking_format TEXT NOT NULL DEFAULT '',
        reasoning_effort_map_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_custom_provider_models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        supported_roles_json TEXT NOT NULL,
        context_window INTEGER,
        verification_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        order_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        enabled_skill_paths TEXT NOT NULL DEFAULT '[]',
        enabled_tool_ids TEXT NOT NULL DEFAULT '[]',
        sandbox_profile_id TEXT,
        approval_profile_id TEXT,
        memory_scope TEXT NOT NULL DEFAULT 'workspace',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_settings_channel_instances_channel ON settings_channel_instances(channel_key);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_provider ON settings_custom_provider_models(provider_id);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_order ON settings_custom_provider_models(provider_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at);
    `);
    try {
      db.exec("ALTER TABLE settings_custom_providers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai-compatible'");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_custom_providers ADD COLUMN supports_thinking INTEGER");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_custom_providers ADD COLUMN thinking_format TEXT NOT NULL DEFAULT ''");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_custom_providers ADD COLUMN reasoning_effort_map_json TEXT NOT NULL DEFAULT '{}'");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_custom_provider_models ADD COLUMN context_window INTEGER");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_custom_provider_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_agents ADD COLUMN sandbox_enabled INTEGER");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_agents ADD COLUMN model_routing_json TEXT");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_channel_instances ADD COLUMN sandbox_enabled INTEGER");
    } catch {
      // column already exists
    }
    try {
      db.exec("ALTER TABLE settings_channel_instances ADD COLUMN display_json TEXT");
    } catch {
      // column already exists
    }

    this.migrateLegacyTables(db);

    return db;
  }

  private migrateLegacyTables(db: DatabaseSync): void {
    const now = new Date().toISOString();

    let hasWebSearchTable = false;
    try {
      const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings_web_search'").get();
      hasWebSearchTable = !!row;
    } catch {}

    if (hasWebSearchTable) {
      try {
        const row = db.prepare("SELECT enabled, default_route, default_engine, engine_selection_strategy, max_results, timeout_ms, retry_timeout_ms FROM settings_web_search WHERE id = ?").get("global") as any;
        if (row) {
          const engineRows = db.prepare("SELECT engine_id, enabled, api_key, base_url FROM settings_web_search_engines").all() as any[];
          const engines: Record<string, any> = {};
          for (const e of engineRows) {
            engines[e.engine_id] = {
              enabled: Boolean(e.enabled),
              apiKey: e.api_key,
              baseUrl: e.base_url || undefined
            };
          }
          const webSearch = {
            enabled: Boolean(row.enabled),
            defaultRoute: row.default_route,
            defaultEngine: row.default_engine,
            engineSelectionStrategy: row.engine_selection_strategy,
            maxResults: row.max_results,
            timeoutMs: row.timeout_ms,
            retryTimeoutMs: row.retry_timeout_ms,
            engines
          };
          db.prepare(`
            INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
            VALUES ('settings_web_search', ?, ?)
          `).run(JSON.stringify(webSearch), now);
        }
      } catch (e) {
        console.error("Migration of legacy settings_web_search failed:", e);
      }
    }

    let hasImageGenerateTable = false;
    try {
      const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings_image_generate'").get();
      hasImageGenerateTable = !!row;
    } catch {}

    if (hasImageGenerateTable) {
      try {
        const row = db.prepare("SELECT enabled, default_engine FROM settings_image_generate WHERE id = ?").get("global") as any;
        if (row) {
          const engineRows = db.prepare("SELECT engine_id, api_key, base_url, model FROM settings_image_generate_engines").all() as any[];
          const engines: Record<string, any> = {};
          for (const e of engineRows) {
            engines[e.engine_id] = {
              apiKey: e.api_key,
              baseUrl: e.base_url || undefined,
              model: e.model || undefined
            };
          }
          const imageGenerate = {
            enabled: Boolean(row.enabled),
            defaultEngine: row.default_engine,
            engines
          };
          db.prepare(`
            INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
            VALUES ('settings_image_generate', ?, ?)
          `).run(JSON.stringify(imageGenerate), now);
        }
      } catch (e) {
        console.error("Migration of legacy settings_image_generate failed:", e);
      }
    }

    let hasVideoGenerateTable = false;
    try {
      const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings_video_generate'").get();
      hasVideoGenerateTable = !!row;
    } catch {}

    if (hasVideoGenerateTable) {
      try {
        const row = db.prepare("SELECT enabled, default_engine FROM settings_video_generate WHERE id = ?").get("global") as any;
        if (row) {
          const engineRows = db.prepare("SELECT engine_id, enabled, api_key, base_url, model FROM settings_video_generate_engines").all() as any[];
          const engines: Record<string, any> = {};
          for (const e of engineRows) {
            engines[e.engine_id] = {
              enabled: Boolean(e.enabled),
              apiKey: e.api_key,
              baseUrl: e.base_url || undefined,
              model: e.model || undefined
            };
          }
          const videoGenerate = {
            enabled: Boolean(row.enabled),
            defaultEngine: row.default_engine,
            engines
          };
          db.prepare(`
            INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
            VALUES ('settings_video_generate', ?, ?)
          `).run(JSON.stringify(videoGenerate), now);
        }
      } catch (e) {
        console.error("Migration of legacy settings_video_generate failed:", e);
      }
    }

    let hasSandboxTable = false;
    try {
      const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings_sandbox'").get();
      hasSandboxTable = !!row;
    } catch {}

    if (hasSandboxTable) {
      try {
        const row = db.prepare(`
          SELECT enabled, init_failure_mode, env_file_path, env_inherit_mode,
                 env_allow_json, env_deny_json, network_allowed_domains_json, network_denied_domains_json,
                 fs_deny_read_json, fs_allow_write_json, fs_deny_write_json
          FROM settings_sandbox
          WHERE id = ?
        `).get("global") as any;
        if (row) {
          const toolSandbox = {
            enabled: Boolean(row.enabled),
            initFailureMode: row.init_failure_mode,
            envFilePath: row.env_file_path,
            env: {
              inheritMode: row.env_inherit_mode,
              allow: this.parseDynamicValue(row.env_allow_json, []),
              deny: this.parseDynamicValue(row.env_deny_json, [])
            },
            network: {
              allowedDomains: this.parseDynamicValue(row.network_allowed_domains_json, []),
              deniedDomains: this.parseDynamicValue(row.network_denied_domains_json, [])
            },
            filesystem: {
              denyRead: this.parseDynamicValue(row.fs_deny_read_json, []),
              allowWrite: this.parseDynamicValue(row.fs_allow_write_json, []),
              denyWrite: this.parseDynamicValue(row.fs_deny_write_json, [])
            }
          };
          db.prepare(`
            INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
            VALUES ('settings_sandbox', ?, ?)
          `).run(JSON.stringify(toolSandbox), now);
        }
      } catch (e) {
        console.error("Migration of legacy settings_sandbox failed:", e);
      }
    }

    db.exec(`
      DROP TABLE IF EXISTS settings_web_search;
      DROP TABLE IF EXISTS settings_web_search_engines;
      DROP TABLE IF EXISTS settings_image_generate;
      DROP TABLE IF EXISTS settings_image_generate_engines;
      DROP TABLE IF EXISTS settings_video_generate;
      DROP TABLE IF EXISTS settings_video_generate_engines;
      DROP TABLE IF EXISTS settings_sandbox;
    `);
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

      const agentsRows = db.prepare("SELECT id, name, description, enabled, sandbox_enabled, model_routing_json FROM settings_agents ORDER BY id ASC").all() as Array<{
        id: string;
        name: string;
        description: string;
        enabled: number;
        sandbox_enabled: number | null;
        model_routing_json: string | null;
      }>;
      const agents = agentsRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: Boolean(row.enabled),
        sandboxEnabled: row.sandbox_enabled === null ? undefined : Boolean(row.sandbox_enabled),
        modelRouting: sanitizeAgentModelRouting(
          row.model_routing_json ? this.parseDynamicValue(row.model_routing_json, undefined) : undefined
        )
      }));

      const channelRows = db.prepare(`
        SELECT channel_key, id, name, enabled, agent_id, credentials_json, allowed_chat_ids_json, sandbox_enabled, display_json
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
        sandbox_enabled: number | null;
        display_json: string | null;
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
          allowedChatIds: this.parseDynamicValue(row.allowed_chat_ids_json, []),
          sandboxEnabled: row.sandbox_enabled === null ? undefined : Boolean(row.sandbox_enabled),
          display: row.display_json ? this.parseDynamicValue(row.display_json, undefined) : undefined
        });
      }

      const providerRows = db.prepare(`
        SELECT id, name, enabled, base_url, api_key, protocol, default_model, path, supports_thinking, thinking_format, reasoning_effort_map_json
        FROM settings_custom_providers
        ORDER BY id ASC
      `).all() as Array<{
        id: string;
        name: string;
        enabled: number;
        base_url: string;
        api_key: string;
        protocol: string;
        default_model: string;
        path: string;
        supports_thinking: number | null;
        thinking_format: string;
        reasoning_effort_map_json: string;
      }>;
      const modelRows = db.prepare(`
        SELECT provider_id, model_id, tags_json, supported_roles_json, context_window, verification_json, enabled
        FROM settings_custom_provider_models
        ORDER BY provider_id ASC, order_index ASC, model_id ASC
      `).all() as Array<{
        provider_id: string;
        model_id: string;
        tags_json: string;
        supported_roles_json: string;
        context_window: number | null;
        verification_json: string;
        enabled: number;
      }>;
      const modelsByProvider = new Map<string, ProviderModelConfig[]>();
      for (const row of modelRows) {
        const list = modelsByProvider.get(row.provider_id) ?? [];
        list.push({
          id: row.model_id,
          tags: this.parseDynamicValue(row.tags_json, []),
          supportedRoles: this.parseDynamicValue(row.supported_roles_json, []),
          contextWindow: row.context_window && row.context_window > 0 ? row.context_window : undefined,
          enabled: row.enabled !== 0,
          verification: this.parseDynamicValue(row.verification_json, undefined)
        });
        modelsByProvider.set(row.provider_id, list);
      }
      const customProviders = providerRows.map((row) => ({
        id: row.id,
        name: row.name || row.id,
        enabled: Boolean(row.enabled),
        protocol: sanitizeCustomProviderProtocol(row.protocol),
        baseUrl: row.base_url,
        apiKey: row.api_key,
        models: modelsByProvider.get(row.id) ?? [],
        defaultModel: row.default_model,
        path: row.path,
        supportsThinking: row.supports_thinking === null ? undefined : Boolean(row.supports_thinking),
        thinkingFormat: resolveCustomProviderThinkingFormat(row.thinking_format, {
          id: row.id,
          name: row.name || row.id,
          baseUrl: row.base_url
        }),
        reasoningEffortMap: sanitizeReasoningEffortMap(this.parseDynamicValue(row.reasoning_effort_map_json, {}))
      }));

      const webSearch = this.loadWebSearchSettings(db);
      const imageGenerate = this.loadImageGenerateSettings(db);
      const videoGenerate = this.loadVideoGenerateSettings(db);
      const ttsGenerate = this.loadTtsGenerateSettings(db);
      const toolSandbox = this.loadSandboxSettings(db);

      return {
        agents: agents.length > 0 ? agents : legacy.agents,
        channels: Object.keys(channels).length > 0 ? channels : legacy.channels,
        customProviders: customProviders.length > 0 ? customProviders : legacy.customProviders,
        webSearch,
        imageGenerate,
        videoGenerate,
        ttsGenerate,
        toolSandbox
      };
    } finally {
      db.close();
    }
  }

  private saveWebSearchSettings(db: DatabaseSync, webSearch: RuntimeSettings["webSearch"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_web_search', ?, ?)
    `).run(JSON.stringify(webSearch), now);
  }

  private loadWebSearchSettings(db: DatabaseSync): RuntimeSettings["webSearch"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_web_search") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["webSearch"]>(row.value_json, undefined as any);
  }

  private saveImageGenerateSettings(db: DatabaseSync, imageGenerate: RuntimeSettings["imageGenerate"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_image_generate', ?, ?)
    `).run(JSON.stringify(imageGenerate), now);
  }

  private loadImageGenerateSettings(db: DatabaseSync): RuntimeSettings["imageGenerate"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_image_generate") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["imageGenerate"]>(row.value_json, undefined as any);
  }

  private saveVideoGenerateSettings(db: DatabaseSync, videoGenerate: RuntimeSettings["videoGenerate"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_video_generate', ?, ?)
    `).run(JSON.stringify(videoGenerate), now);
  }

  private loadVideoGenerateSettings(db: DatabaseSync): RuntimeSettings["videoGenerate"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_video_generate") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["videoGenerate"]>(row.value_json, undefined as any);
  }

  private saveTtsGenerateSettings(db: DatabaseSync, ttsGenerate: RuntimeSettings["ttsGenerate"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_tts_generate', ?, ?)
    `).run(JSON.stringify(ttsGenerate), now);
  }

  private loadTtsGenerateSettings(db: DatabaseSync): RuntimeSettings["ttsGenerate"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_tts_generate") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["ttsGenerate"]>(row.value_json, undefined as any);
  }

  private saveSandboxSettings(db: DatabaseSync, toolSandbox: RuntimeSettings["toolSandbox"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_sandbox', ?, ?)
    `).run(JSON.stringify(toolSandbox), now);
  }

  private loadSandboxSettings(db: DatabaseSync): RuntimeSettings["toolSandbox"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_sandbox") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["toolSandbox"]>(row.value_json, undefined as any);
  }

  private saveDynamicSettings(settings: RuntimeSettings, keys: DynamicSettingKey[] = DYNAMIC_SETTING_KEYS): void {
    const db = this.openDynamicDb();
    try {
      const now = new Date().toISOString();
      db.exec("BEGIN");

      if (keys.includes("agents")) {
        db.exec("DELETE FROM settings_agents");
        const insertAgent = db.prepare(`
          INSERT INTO settings_agents (id, name, description, enabled, sandbox_enabled, model_routing_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const agent of settings.agents) {
          insertAgent.run(
            agent.id,
            agent.name,
            agent.description ?? "",
            agent.enabled ? 1 : 0,
            agent.sandboxEnabled === undefined ? null : (agent.sandboxEnabled ? 1 : 0),
            agent.modelRouting ? JSON.stringify(agent.modelRouting) : null,
            now
          );
        }
      }

      if (keys.includes("channels")) {
        db.exec("DELETE FROM settings_channel_instances");
        const insertChannel = db.prepare(`
          INSERT INTO settings_channel_instances
            (channel_key, id, name, enabled, agent_id, credentials_json, allowed_chat_ids_json, sandbox_enabled, display_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              instance.sandboxEnabled === undefined ? null : (instance.sandboxEnabled ? 1 : 0),
              instance.display ? JSON.stringify(instance.display) : null,
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
            (id, name, enabled, base_url, api_key, protocol, default_model, path, supports_thinking, thinking_format, reasoning_effort_map_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertModel = db.prepare(`
          INSERT INTO settings_custom_provider_models
            (provider_id, model_id, tags_json, supported_roles_json, context_window, verification_json, enabled, order_index, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const provider of settings.customProviders) {
          insertProvider.run(
            provider.id,
            provider.name || provider.id,
            provider.enabled ? 1 : 0,
            provider.baseUrl,
            provider.apiKey,
            provider.protocol ?? "openai-compatible",
            provider.defaultModel,
            provider.path,
            provider.supportsThinking === undefined ? null : (provider.supportsThinking ? 1 : 0),
            provider.thinkingFormat ?? "",
            JSON.stringify(provider.reasoningEffortMap ?? {}),
            now
          );
          const seenModelIds = new Set<string>();
          let orderIndex = 0;
          for (let index = 0; index < provider.models.length; index += 1) {
            const model = provider.models[index];
            const modelId = String(model.id ?? "").trim();
            if (!modelId || seenModelIds.has(modelId)) continue;
            seenModelIds.add(modelId);
            insertModel.run(
              provider.id,
              modelId,
              JSON.stringify(model.tags ?? []),
              JSON.stringify(model.supportedRoles ?? []),
              model.contextWindow && model.contextWindow > 0 ? model.contextWindow : null,
              JSON.stringify(model.verification ?? null),
              model.enabled === false ? 0 : 1,
              orderIndex,
              now
            );
            orderIndex += 1;
          }
        }
      }

      if (keys.includes("webSearch")) {
        this.saveWebSearchSettings(db, settings.webSearch);
      }

      if (keys.includes("imageGenerate")) {
        this.saveImageGenerateSettings(db, settings.imageGenerate);
      }

      if (keys.includes("videoGenerate")) {
        this.saveVideoGenerateSettings(db, settings.videoGenerate);
      }

      if (keys.includes("ttsGenerate")) {
        this.saveTtsGenerateSettings(db, settings.ttsGenerate);
      }

      if (keys.includes("toolSandbox")) {
        this.saveSandboxSettings(db, settings.toolSandbox);
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
      defaultThinkingLevel: settings.defaultThinkingLevel,
      defaultCustomProviderId: settings.defaultCustomProviderId,
      modelRouting: {
        textModelKey: settings.modelRouting.textModelKey,
        visionModelKey: settings.modelRouting.visionModelKey,
        sttModelKey: settings.modelRouting.sttModelKey,
        ttsModelKey: settings.modelRouting.ttsModelKey,
        compactionModelKey: settings.modelRouting.compactionModelKey,
        subagentModelKey: settings.modelRouting.subagentModelKey,
        subagentHaikuModelKey: settings.modelRouting.subagentHaikuModelKey,
        subagentSonnetModelKey: settings.modelRouting.subagentSonnetModelKey,
        subagentOpusModelKey: settings.modelRouting.subagentOpusModelKey,
        subagentThinkingModelKey: settings.modelRouting.subagentThinkingModelKey
      },
      modelFallback: {
        mode: settings.modelFallback.mode,
        firstTokenTimeoutMs: settings.modelFallback.firstTokenTimeoutMs
      },
      compaction: {
        enabled: settings.compaction.enabled,
        thresholdPercent: settings.compaction.thresholdPercent,
        reserveTokens: settings.compaction.reserveTokens,
        keepRecentTokens: settings.compaction.keepRecentTokens,
        defaultContextWindow: settings.compaction.defaultContextWindow
      },
      systemPrompt: settings.systemPrompt,
      locale: settings.locale,
      serverPort: settings.serverPort,
      // Serialize the whole plugins block (memory reflection/daily-materials,
      // hooks, and dynamic feature-plugin settings) — a narrow field list here
      // silently reset those settings on every restart.
      plugins: settings.plugins,
      timezone: settings.timezone,
      mcpServers: settings.mcpServers,
      skillSearch: settings.skillSearch,
      skillDrafts: settings.skillDrafts,
      disabledSkillPaths: settings.disabledSkillPaths,
      telegramBotToken: settings.telegramBotToken,
      telegramAllowedChatIds: settings.telegramAllowedChatIds,
      budget: {
        maxToolCalls: settings.budget.maxToolCalls,
        maxToolFailures: settings.budget.maxToolFailures,
        maxModelAttempts: settings.budget.maxModelAttempts
      },
      events: {
        executionTimeoutMs: settings.events.executionTimeoutMs,
        maxAttempts: settings.events.maxAttempts,
        retryDelayMs: settings.events.retryDelayMs,
        taskSessionRetentionDays: settings.events.taskSessionRetentionDays
      },
      display: settings.display ? {
        toolProgress: settings.display.toolProgress,
        showReasoning: settings.display.showReasoning,
        gatewayNotifyInterval: settings.display.gatewayNotifyInterval,
        runLogNotice: settings.display.runLogNotice
      } : undefined,
      browserAutomation: {
        defaultTimeoutMs: settings.browserAutomation.defaultTimeoutMs
      }
    };
  }

  load(): RuntimeSettings {
    const rawStatic = readJsonFile<RawSettings>(storagePaths.settingsFile, {});
    const rawDynamic = this.loadDynamicSettings();

    const db = this.openDynamicDb();
    try {
      db.exec("BEGIN");
      let migrated = false;

      if (!rawDynamic.webSearch && rawStatic.webSearch) {
        this.saveWebSearchSettings(db, sanitizeWebSearchSettings(rawStatic.webSearch));
        migrated = true;
      }
      if (!rawDynamic.imageGenerate && rawStatic.imageGenerate) {
        this.saveImageGenerateSettings(db, sanitizeImageGenerateSettings(rawStatic.imageGenerate));
        migrated = true;
      }
      if (!rawDynamic.videoGenerate && rawStatic.videoGenerate) {
        this.saveVideoGenerateSettings(db, sanitizeVideoGenerateSettings(rawStatic.videoGenerate));
        migrated = true;
      }
      if (!rawDynamic.ttsGenerate && rawStatic.ttsGenerate) {
        this.saveTtsGenerateSettings(db, sanitizeTtsGenerateSettings(rawStatic.ttsGenerate));
        migrated = true;
      }
      if (!rawDynamic.toolSandbox && rawStatic.toolSandbox) {
        this.saveSandboxSettings(db, sanitizeToolSandboxSettings(rawStatic.toolSandbox));
        migrated = true;
      }

      if (migrated) {
        db.exec("COMMIT");
      } else {
        db.exec("ROLLBACK");
      }
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      console.error("Settings migration to SQLite failed:", e);
    } finally {
      db.close();
    }

    const rawDynamicAfterMigration = this.loadDynamicSettings();
    const merged: RawSettings = {
      ...rawStatic,
      customProviders: rawDynamicAfterMigration.customProviders ?? rawStatic.customProviders,
      channels: rawDynamicAfterMigration.channels ?? rawStatic.channels,
      agents: rawDynamicAfterMigration.agents ?? rawStatic.agents,
      webSearch: rawDynamicAfterMigration.webSearch ?? rawStatic.webSearch,
      imageGenerate: rawDynamicAfterMigration.imageGenerate ?? rawStatic.imageGenerate,
      videoGenerate: rawDynamicAfterMigration.videoGenerate ?? rawStatic.videoGenerate,
      ttsGenerate: rawDynamicAfterMigration.ttsGenerate ?? rawStatic.ttsGenerate,
      toolSandbox: rawDynamicAfterMigration.toolSandbox ?? rawStatic.toolSandbox
    };
    const settings = sanitize(merged);
    this.saveDynamicSettings(settings);
    // Overwrite settings.json to clean up migrated keys
    writeJsonFile(storagePaths.settingsFile, this.toStaticSettings(settings));
    return settings;
  }

  save(settings: RuntimeSettings): void {
    writeJsonFile(storagePaths.settingsFile, this.toStaticSettings(settings));
    this.saveDynamicSettings(settings);
  }
}
