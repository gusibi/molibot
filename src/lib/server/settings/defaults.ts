import type { KnownProvider } from "@earendil-works/pi-ai";
import {
  type AgentSettings,
  DEFAULT_AGENT_ID,
  defaultAgentSettings,
  isKnownProvider,
  type ChannelInstanceSettings,
  type CustomProviderConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  type McpServerConfig,
  type ProviderMode,
  type SessionAutoArchiveSettings,
  type SkillDraftSettings,
  type SkillSearchSettings,
  type WebSearchEngineId,
  type WebSearchSettings,
  type ImageGenerateEngineId,
  type ImageGenerateSettings,
  type ImageRecognitionSettings,
  type VideoGenerateEngineId,
  type VideoGenerateSettings,
  type TtsGenerateProviderId,
  type TtsGenerateSettings,
  type RuntimeSettings,
  type RunBudgetLimits,
  type TelegramBotConfig
} from "$lib/server/settings/schema.js";
import { defaultToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import { defaultHostToolSettings } from "$lib/server/settings/hostTools.js";
import { sanitizeRuntimeThinkingLevel } from "$lib/server/settings/thinking.js";
import { normalizeTimeZone } from "$lib/server/time.js";
import { deriveToolFailureBudget } from "$lib/server/agent/core/runtimeBudget.js";
import { DEFAULT_PERMISSION_MODE } from "$lib/server/agent/permissions/decidePermission.js";

function listFromEnv(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function boundedIntegerFromEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function providerFromEnv(name: string, fallback: KnownProvider): KnownProvider {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  if (isKnownProvider(raw)) return raw;
  console.warn(`[config] Unknown provider '${raw}' in ${name}; fallback to '${fallback}'.`);
  return fallback;
}

function parseEnvMcpServers(): McpServerConfig[] {
  const raw = String(process.env.MOLIBOT_MCP_SERVERS ?? "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows: Array<{ id: string; value: Record<string, unknown> }> = Array.isArray(parsed)
      ? parsed
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
        .map((row) => ({ id: String(row.id ?? "").trim(), value: row }))
      : (parsed && typeof parsed === "object")
        ? Object.entries(parsed as Record<string, unknown>)
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
  } catch {
    return [];
  }
}

function mapTelegramBotsToChannelSettings(bots: TelegramBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
    agentId: "",
    credentials: {
      token: bot.token
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

function mapFeishuBotsToChannelSettings(bots: FeishuBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
    agentId: "",
    credentials: {
      appId: bot.appId,
      appSecret: bot.appSecret
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

function mapQQBotsToChannelSettings(bots: QQBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
    agentId: "",
    credentials: {
      appId: bot.appId,
      clientSecret: bot.clientSecret
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

const modeRaw = (process.env.AI_PROVIDER_MODE ?? "pi").toLowerCase();
const providerMode: ProviderMode = modeRaw === "custom" ? "custom" : "pi";

const envCustomProvider: CustomProviderConfig = {
  id: "custom-env",
  name: "Custom (env)",
  enabled: true,
  protocol: "openai-compatible",
  baseUrl: process.env.CUSTOM_AI_BASE_URL ?? "",
  apiKey: process.env.CUSTOM_AI_API_KEY ?? "",
  models: (process.env.CUSTOM_AI_MODEL ?? "").trim()
    ? [{
      id: String(process.env.CUSTOM_AI_MODEL).trim(),
      tags: ["text", "vision", "stt", "tts"],
      enabled: true,
      supportedRoles: ["system", "user", "assistant", "tool", "developer"]
    }]
    : [],
  defaultModel: process.env.CUSTOM_AI_MODEL ?? "",
  path: process.env.CUSTOM_AI_PATH ?? "/v1/chat/completions"
};

const defaultCustomProviders =
  envCustomProvider.baseUrl || envCustomProvider.apiKey || envCustomProvider.models.length > 0
    ? [envCustomProvider]
    : [];

const defaultMaxToolCalls = Math.max(1, Number(process.env.MOLIBOT_MAX_TOOL_CALLS ?? 24) || 24);

const defaultTelegramBotToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const defaultTelegramAllowedChatIds = listFromEnv("TELEGRAM_ALLOWED_CHAT_IDS");
const defaultTelegramBots: TelegramBotConfig[] = defaultTelegramBotToken
  ? [{
    id: "default",
    name: "Default Bot",
    token: defaultTelegramBotToken,
    allowedChatIds: defaultTelegramAllowedChatIds
  }]
  : [];

const defaultFeishuAppId = (process.env.FEISHU_APP_ID ?? "").trim();
const defaultFeishuAppSecret = (process.env.FEISHU_APP_SECRET ?? "").trim();
const defaultFeishuAllowedChatIds = listFromEnv("FEISHU_ALLOWED_CHAT_IDS");
const defaultFeishuBots: FeishuBotConfig[] = defaultFeishuAppId && defaultFeishuAppSecret
  ? [{
    id: "default",
    name: "Default Feishu Bot",
    appId: defaultFeishuAppId,
    appSecret: defaultFeishuAppSecret,
    allowedChatIds: defaultFeishuAllowedChatIds
  }]
  : [];

const defaultQQAppId = (process.env.QQ_APP_ID ?? "").trim();
const defaultQQClientSecret = (process.env.QQ_CLIENT_SECRET ?? "").trim();
const defaultQQAllowedChatIds = listFromEnv("QQ_ALLOWED_CHAT_IDS");
const defaultQQBots: QQBotConfig[] = defaultQQAppId && defaultQQClientSecret
  ? [{
    id: "default",
    name: "Default QQ Bot",
    appId: defaultQQAppId,
    clientSecret: defaultQQClientSecret,
    allowedChatIds: defaultQQAllowedChatIds
  }]
  : [];

const defaultAgents: AgentSettings[] = [defaultAgentSettings()];
const defaultMcpServers = parseEnvMcpServers();
const defaultSkillSearchSettings: SkillSearchSettings = {
  local: {
    enabled: String(process.env.MOLIBOT_SKILL_SEARCH_LOCAL_ENABLED ?? "false").toLowerCase() === "true"
  },
  api: {
    enabled: String(process.env.MOLIBOT_SKILL_SEARCH_API_ENABLED ?? "false").toLowerCase() === "true",
    provider: String(process.env.MOLIBOT_SKILL_SEARCH_API_PROVIDER ?? "").trim(),
    baseUrl: String(process.env.MOLIBOT_SKILL_SEARCH_API_BASE_URL ?? "").trim(),
    apiKey: String(process.env.MOLIBOT_SKILL_SEARCH_API_KEY ?? "").trim(),
    model: String(process.env.MOLIBOT_SKILL_SEARCH_API_MODEL ?? "").trim(),
    path: String(process.env.MOLIBOT_SKILL_SEARCH_API_PATH ?? "/v1/chat/completions").trim() || "/v1/chat/completions",
    maxTokens: Math.max(128, Number(process.env.MOLIBOT_SKILL_SEARCH_API_MAX_TOKENS ?? 400) || 400),
    temperature: Math.min(1, Math.max(0, Number(process.env.MOLIBOT_SKILL_SEARCH_API_TEMPERATURE ?? 0) || 0)),
    timeoutMs: Math.max(1000, Number(process.env.MOLIBOT_SKILL_SEARCH_API_TIMEOUT_MS ?? 8000) || 8000),
    minConfidence: Math.min(1, Math.max(0, Number(process.env.MOLIBOT_SKILL_SEARCH_API_MIN_CONFIDENCE ?? 0.6) || 0.6))
  }
};
const defaultSkillDraftSettings: SkillDraftSettings = {
  autoSave: {
    enabled: true,
    minToolCalls: Math.max(1, Number(process.env.MOLIBOT_SKILL_DRAFT_MIN_TOOL_CALLS ?? 4) || 4),
    allowRecoveredToolFailures:
      String(process.env.MOLIBOT_SKILL_DRAFT_ALLOW_TOOL_FAILURES ?? "true").toLowerCase() !== "false",
    allowModelRetries:
      String(process.env.MOLIBOT_SKILL_DRAFT_ALLOW_MODEL_RETRIES ?? "true").toLowerCase() !== "false"
  },
  template: {
    skillPath: String(process.env.MOLIBOT_SKILL_DRAFT_TEMPLATE_PATH ?? "").trim()
  }
};

function webSearchEngineFromEnv(id: WebSearchEngineId, envKey: string, enabledFallback = false): WebSearchSettings["engines"][WebSearchEngineId] {
  const apiKey = String(process.env[envKey] ?? "").trim();
  const enabledRaw = String(process.env[`MOLIBOT_WEB_SEARCH_${id.toUpperCase()}_ENABLED`] ?? "").trim().toLowerCase();
  return {
    enabled: enabledRaw ? enabledRaw !== "false" : enabledFallback || Boolean(apiKey),
    apiKey
  };
}

const defaultWebSearchSettings: WebSearchSettings = {
  enabled: String(process.env.MOLIBOT_WEB_SEARCH_ENABLED ?? "true").toLowerCase() !== "false",
  defaultRoute: "auto",
  defaultEngine: "duckduckgo",
  engineSelectionStrategy: "priority",
  maxResults: Math.max(1, Math.min(20, Number(process.env.MOLIBOT_WEB_SEARCH_MAX_RESULTS ?? 5) || 5)),
  timeoutMs: Math.max(1000, Math.min(120000, Number(process.env.MOLIBOT_WEB_SEARCH_TIMEOUT_MS ?? 60000) || 60000)),
  retryTimeoutMs: Math.max(1000, Math.min(180000, Number(process.env.MOLIBOT_WEB_SEARCH_RETRY_TIMEOUT_MS ?? 120000) || 120000)),
  engines: {
    duckduckgo: {
      enabled: String(process.env.MOLIBOT_WEB_SEARCH_DUCKDUCKGO_ENABLED ?? "true").toLowerCase() !== "false",
      apiKey: ""
    },
    anysearch: webSearchEngineFromEnv("anysearch", "ANYSEARCH_API_KEY", true),
    brave: webSearchEngineFromEnv("brave", "BRAVE_API_KEY"),
    tavily: webSearchEngineFromEnv("tavily", "TAVILY_API_KEY"),
    exa: webSearchEngineFromEnv("exa", "EXA_API_KEY"),
    serper: webSearchEngineFromEnv("serper", "SERPER_API_KEY"),
    baidu: webSearchEngineFromEnv("baidu", "BAIDU_SEARCH_API_KEY"),
    baidu_fast: webSearchEngineFromEnv("baidu_fast", "BAIDU_SEARCH_API_KEY"),
    baidu_web: webSearchEngineFromEnv("baidu_web", "BAIDU_SEARCH_API_KEY"),
    ark: webSearchEngineFromEnv("ark", "ARK_API_KEY"),
    grok: webSearchEngineFromEnv("grok", "GROK_API_KEY"),
    bocha: webSearchEngineFromEnv("bocha", "BOCHA_API_KEY")
  }
};

function imageGenerateEngineFromEnv(
  id: ImageGenerateEngineId,
  envKey: string,
  defaultModel: string,
  protocol: ImageGenerateSettings["engines"][ImageGenerateEngineId]["protocol"]
): ImageGenerateSettings["engines"][ImageGenerateEngineId] {
  const apiKey = String(process.env[envKey] ?? "").trim();
  const envId = id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const enabledRaw = String(process.env[`MOLIBOT_IMAGE_GENERATE_${envId}_ENABLED`] ?? "").trim().toLowerCase();
  const model = String(process.env[`MOLIBOT_IMAGE_GENERATE_${envId}_MODEL`] ?? "").trim() || defaultModel;
  return {
    enabled: enabledRaw ? enabledRaw !== "false" : Boolean(apiKey),
    apiKey,
    model,
    protocol
  };
}

const defaultImageGenerateSettings: ImageGenerateSettings = {
  enabled: String(process.env.MOLIBOT_IMAGE_GENERATE_ENABLED ?? "true").toLowerCase() !== "false",
  defaultEngine: (process.env.MOLIBOT_IMAGE_GENERATE_DEFAULT_ENGINE ?? "auto") as ImageGenerateEngineId | "auto",
  engines: {
    agnes: imageGenerateEngineFromEnv("agnes", "AGNES_API_KEY", "agnes-image-2.0-flash", "images-generations"),
    openai: imageGenerateEngineFromEnv("openai", "OPENAI_API_KEY", "gpt-image-2", "images-generations"),
    "openai-chat": imageGenerateEngineFromEnv("openai-chat", "OPENAI_API_KEY", "gpt-4o", "chat-completions"),
    modelscope: imageGenerateEngineFromEnv("modelscope", "MODELSCOPE_API_KEY", "Tongyi-MAI/Z-Image-Turbo", "images-generations"),
    google: imageGenerateEngineFromEnv("google", "GOOGLE_API_KEY", "imagen-3.0-generate-001", "images-generations"),
    volcengine: imageGenerateEngineFromEnv("volcengine", "VOLCENGINE_API_KEY", "cv_vit_huge_p14_laion2b_s32b_b64_seedream", "images-generations")
  }
};

const defaultImageRecognitionSettings: ImageRecognitionSettings = {
  enabled: true,
  defaultEngine: "auto",
  engineOrder: [],
  engines: {}
};

function videoGenerateEngineFromEnv(id: VideoGenerateEngineId, envKey: string, defaultModel: string, enabledFallback = false): VideoGenerateSettings["engines"][VideoGenerateEngineId] {
  const apiKey = String(process.env[envKey] ?? "").trim();
  const enabledRaw = String(process.env[`MOLIBOT_VIDEO_GENERATE_${id.toUpperCase()}_ENABLED`] ?? "").trim().toLowerCase();
  const model = String(process.env[`MOLIBOT_VIDEO_GENERATE_${id.toUpperCase()}_MODEL`] ?? "").trim() || defaultModel;
  return {
    enabled: enabledRaw ? enabledRaw !== "false" : enabledFallback || Boolean(apiKey),
    apiKey,
    model
  };
}

const defaultVideoGenerateSettings: VideoGenerateSettings = {
  enabled: String(process.env.MOLIBOT_VIDEO_GENERATE_ENABLED ?? "true").toLowerCase() !== "false",
  defaultEngine: (process.env.MOLIBOT_VIDEO_GENERATE_DEFAULT_ENGINE ?? "auto") as VideoGenerateEngineId | "auto",
  engines: {
    agnes: videoGenerateEngineFromEnv("agnes", "AGNES_API_KEY", "agnes-video-v2.0"),
    volcengine: videoGenerateEngineFromEnv("volcengine", "VOLCENGINE_API_KEY", "doubao-seedance-2.0")
  }
};

function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\/+$/, "");
}

const defaultTtsGenerateSettings: TtsGenerateSettings = {
  enabled: String(process.env.MOLIBOT_TTS_GENERATE_ENABLED ?? "true").toLowerCase() !== "false",
  defaultProvider: (process.env.MOLIBOT_TTS_GENERATE_DEFAULT_PROVIDER ?? "macos") as TtsGenerateProviderId,
  providers: {
    macos: {
      enabled: String(process.env.MOLIBOT_TTS_MACOS_ENABLED ?? "true").toLowerCase() !== "false",
      voice: String(process.env.MOLIBOT_TTS_MACOS_VOICE ?? "").trim(),
      format: "aiff"
    },
    xiaomi: {
      enabled: String(process.env.MOLIBOT_TTS_XIAOMI_ENABLED ?? "").trim()
        ? String(process.env.MOLIBOT_TTS_XIAOMI_ENABLED).toLowerCase() !== "false"
        : Boolean(String(process.env.MOLIBOT_TTS_XIAOMI_API_KEY ?? "").trim()),
      apiKey: String(process.env.MOLIBOT_TTS_XIAOMI_API_KEY ?? "").trim(),
      baseUrl: normalizeBaseUrl(String(process.env.MOLIBOT_TTS_XIAOMI_BASE_URL ?? ""), "https://api.xiaomimimo.com/v1"),
      model: String(process.env.MOLIBOT_TTS_XIAOMI_MODEL ?? "mimo-v2-tts").trim() || "mimo-v2-tts",
      voice: String(process.env.MOLIBOT_TTS_XIAOMI_VOICE ?? "mimo_default").trim() || "mimo_default",
      format: "wav"
    }
  }
};


const defaultCloudflareHtmlPluginSettings: RuntimeSettings["plugins"]["cloudflareHtml"] = {
  enabled: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_ENABLED ?? "false").toLowerCase() === "true",
  accessMode: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_ACCESS_MODE ?? "worker").trim() === "direct"
    ? "direct"
    : "worker",
  workerBaseHost: String(
    process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_WORKER_BASE_HOST ??
    process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_BASE_URL ??
    ""
  ).trim(),
  publicBaseHost: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_PUBLIC_BASE_HOST ?? "").trim(),
  routePrefix: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_ROUTE_PREFIX ?? "/html").trim() || "/html",
  bucketName: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_BUCKET ?? "").trim(),
  accountId: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_ACCOUNT_ID ?? "").trim(),
  accessKeyId: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_ACCESS_KEY_ID ?? "").trim(),
  secretAccessKey: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_SECRET_ACCESS_KEY ?? "").trim(),
  objectPrefix: String(process.env.MOLIBOT_PLUGIN_CLOUDFLARE_HTML_OBJECT_PREFIX ?? "html/").trim() || "html/"
};

export const defaultSessionAutoArchiveSettings: SessionAutoArchiveSettings = {
  enabled: false,
  inactiveDays: 30,
  bots: {}
};

export const defaultRuntimeSettings: RuntimeSettings = {
  providerMode,
  piModelProvider: providerFromEnv("PI_MODEL_PROVIDER", "anthropic"),
  piModelName: process.env.PI_MODEL_NAME ?? "claude-sonnet-4-20250514",
  defaultThinkingLevel: sanitizeRuntimeThinkingLevel(process.env.MOLIBOT_DEFAULT_THINKING_LEVEL, "off"),
  customProviders: defaultCustomProviders,
  defaultCustomProviderId: defaultCustomProviders[0]?.id ?? "",
  modelRouting: {
    textModelKey: "",
    sttModelKey: "",
    ttsModelKey: "",
    compactionModelKey: "",
    subagentModelKey: "",
    subagentHaikuModelKey: "",
    subagentSonnetModelKey: "",
    subagentOpusModelKey: "",
    subagentThinkingModelKey: ""
  },
  modelFallback: {
    mode: "same-provider",
    firstTokenTimeoutMs: Math.max(
      0,
      Number(process.env.MOLIBOT_MODEL_FIRST_TOKEN_TIMEOUT_MS ?? 60000) || 60000
    )
  },
  compaction: {
    enabled: String(process.env.MOLIBOT_COMPACTION_ENABLED ?? "true").toLowerCase() !== "false",
    thresholdPercent: Math.max(10, Math.min(95, Number(process.env.MOLIBOT_COMPACTION_THRESHOLD_PERCENT ?? 75) || 75)),
    reserveTokens: Math.max(1024, Number(process.env.MOLIBOT_COMPACTION_RESERVE_TOKENS ?? 8192) || 8192),
    keepRecentTokens: Math.max(2048, Number(process.env.MOLIBOT_COMPACTION_KEEP_RECENT_TOKENS ?? 20000) || 20000),
    defaultContextWindow: Math.max(1024, Number(process.env.MOLIBOT_COMPACTION_DEFAULT_CONTEXT_WINDOW ?? 200000) || 200000)
  },
  systemPrompt:
    process.env.MOLIBOT_SYSTEM_PROMPT ??
    "You are Molibot, a concise and helpful assistant.",
  locale: process.env.MOLIBOT_LOCALE === "zh-CN" ? "zh-CN" : "en-US",
  serverPort: Math.max(1024, Math.min(65535, Math.round(Number(process.env.PORT ?? 3040) || 3040))),
  timezone: normalizeTimeZone(
    String(process.env.MOLIBOT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  ),
  agents: defaultAgents,
  channels: {
    web: {
      instances: [
        {
          id: "default",
          name: "Default Web",
          enabled: true,
          agentId: DEFAULT_AGENT_ID,
          credentials: {},
          allowedChatIds: []
        }
      ]
    },
    telegram: {
      instances: mapTelegramBotsToChannelSettings(defaultTelegramBots)
    },
    feishu: {
      instances: mapFeishuBotsToChannelSettings(defaultFeishuBots)
    },
    qq: {
      instances: mapQQBotsToChannelSettings(defaultQQBots)
    },
    weixin: {
      instances: []
    }
  },
  mcpServers: defaultMcpServers,
  openConnector: {
    enabled: false,
    baseUrl: "https://opc.eztoolab.com",
    runtimeToken: "",
    consoleUrl: "https://opc.eztoolab.com/providers"
  },
  skillSearch: defaultSkillSearchSettings,
  skillDrafts: defaultSkillDraftSettings,
  webSearch: defaultWebSearchSettings,
  imageGenerate: defaultImageGenerateSettings,
  imageRecognition: defaultImageRecognitionSettings,
  videoGenerate: defaultVideoGenerateSettings,
  ttsGenerate: defaultTtsGenerateSettings,
  toolSandbox: defaultToolSandboxSettings,
  permissionMode: DEFAULT_PERMISSION_MODE,
  hostTools: defaultHostToolSettings,
  disabledSkillPaths: [],
  telegramBots: defaultTelegramBots,
  qqBots: defaultQQBots,
  plugins: {
    entries: {},
    memory: {
      enabled: String(process.env.MEMORY_ENABLED ?? "true").toLowerCase() === "true",
      backend: (process.env.MEMORY_BACKEND ?? process.env.MEMORY_CORE ?? "mory").trim() || "mory",
      embeddingProviderId: String(process.env.MEMORY_EMBEDDING_PROVIDER_ID ?? "").trim(),
      embeddingModel: String(process.env.MEMORY_EMBEDDING_MODEL ?? "").trim(),
      reflectionTime: String(process.env.MEMORY_REFLECTION_TIME ?? "03:00").trim() || "03:00",
      reflectionNotifications: String(process.env.MEMORY_REFLECTION_NOTIFICATIONS ?? "true").toLowerCase() !== "false",
      reflectionNotificationTarget: null,
      autoConfirm: {
        enabled: false,
        occurrenceThreshold: 3,
        confidenceThreshold: 0.85,
        allowProjectTasks: false
      },
      dailyMaterials: {
        enabled: false,
        time: "23:30",
        projectId: "",
        dir: "content/daily-materials",
        promptPath: "templates/daily-material-prompt.md",
        notifications: true,
        scanTokenBudget: 120000,
        scanModelKey: ""
      }
    },
    cloudflareHtml: {
      ...defaultCloudflareHtmlPluginSettings
    },
    hooks: [],
    piExtensions: {
      enabled: String(process.env.PI_EXTENSIONS_ENABLED ?? "true").toLowerCase() !== "false",
      entries: {}
    },
    miniApps: {
      entries: {},
      ai: {
        textModelKey: "",
        transcriptionModelKey: ""
      }
    }
  },
  telegramBotToken: defaultTelegramBotToken,
  telegramAllowedChatIds: defaultTelegramAllowedChatIds,
  feishuBots: defaultFeishuBots,
  budget: {
    maxToolCalls: defaultMaxToolCalls,
    // Only an explicit env var pins the failure budget; otherwise it follows the
    // tool-call budget, so raising one limit no longer leaves the other behind.
    maxToolFailures: process.env.MOLIBOT_MAX_TOOL_FAILURES != null
      ? Math.max(1, Number(process.env.MOLIBOT_MAX_TOOL_FAILURES) || 6)
      : deriveToolFailureBudget(defaultMaxToolCalls),
    maxModelAttempts: Math.max(1, Number(process.env.MOLIBOT_MAX_MODEL_ATTEMPTS ?? 6) || 6)
  },
  subagentRuntime: {
    maxToolCalls: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_MAX_TOOL_CALLS", 100, 1, 500),
    maxToolFailures: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_MAX_TOOL_FAILURES", 6, 1, 100),
    maxModelTurns: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_MAX_MODEL_TURNS", 12, 1, 100),
    deadlineMs: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_DEADLINE_MS", 1_800_000, 1000, 24 * 60 * 60 * 1000),
    maxTasks: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_MAX_TASKS", 4, 1, 16),
    maxConcurrency: boundedIntegerFromEnv("MOLIBOT_SUBAGENT_MAX_CONCURRENCY", 2, 1, 4),
    compactionEnabled: String(process.env.MOLIBOT_SUBAGENT_COMPACTION_ENABLED ?? "true").toLowerCase() !== "false",
    persistSessions: String(process.env.MOLIBOT_SUBAGENT_PERSIST_SESSIONS ?? "true").toLowerCase() !== "false"
  },
  events: {
    executionTimeoutMs: Math.max(1000, Number(process.env.MOLIBOT_EVENT_EXECUTION_TIMEOUT_MS ?? 600_000) || 600_000),
    maxAttempts: Math.max(1, Number(process.env.MOLIBOT_EVENT_MAX_ATTEMPTS ?? 3) || 3),
    retryDelayMs: Math.max(0, Number(process.env.MOLIBOT_EVENT_RETRY_DELAY_MS ?? 5000) || 5000),
    taskSessionRetentionDays: (() => {
      const raw = Number(process.env.MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS ?? 7);
      return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 7;
    })()
  },
  browserAutomation: {
    defaultTimeoutMs: Math.max(5000, Number(process.env.AGENT_BROWSER_DEFAULT_TIMEOUT ?? 60000) || 60000)
  },
  sessionAutoArchive: { ...defaultSessionAutoArchiveSettings, bots: {} },
  display: {
    toolProgress: "all",
    showReasoning: "off",
    gatewayNotifyInterval: 0,
    runLogNotice: false
  }
};
