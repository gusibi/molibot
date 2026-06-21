import type { KnownProvider } from "@mariozechner/pi-ai";
import {
  type AgentSettings,
  isKnownProvider,
  type ChannelInstanceSettings,
  type CustomProviderConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  type McpServerConfig,
  type ProviderMode,
  type SkillDraftSettings,
  type SkillSearchSettings,
  type WebSearchEngineId,
  type WebSearchSettings,
  type ImageGenerateEngineId,
  type ImageGenerateSettings,
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

function listFromEnv(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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

const defaultAgents: AgentSettings[] = [];
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
  defaultEngine: "auto",
  engineSelectionStrategy: "priority",
  maxResults: Math.max(1, Math.min(20, Number(process.env.MOLIBOT_WEB_SEARCH_MAX_RESULTS ?? 5) || 5)),
  timeoutMs: Math.max(1000, Math.min(120000, Number(process.env.MOLIBOT_WEB_SEARCH_TIMEOUT_MS ?? 60000) || 60000)),
  retryTimeoutMs: Math.max(1000, Math.min(180000, Number(process.env.MOLIBOT_WEB_SEARCH_RETRY_TIMEOUT_MS ?? 120000) || 120000)),
  engines: {
    duckduckgo: {
      enabled: String(process.env.MOLIBOT_WEB_SEARCH_DUCKDUCKGO_ENABLED ?? "true").toLowerCase() !== "false",
      apiKey: ""
    },
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

function imageGenerateEngineFromEnv(id: ImageGenerateEngineId, envKey: string, defaultModel: string): ImageGenerateSettings["engines"][ImageGenerateEngineId] {
  const apiKey = String(process.env[envKey] ?? "").trim();
  const envId = id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const enabledRaw = String(process.env[`MOLIBOT_IMAGE_GENERATE_${envId}_ENABLED`] ?? "").trim().toLowerCase();
  const model = String(process.env[`MOLIBOT_IMAGE_GENERATE_${envId}_MODEL`] ?? "").trim() || defaultModel;
  return {
    enabled: enabledRaw ? enabledRaw !== "false" : Boolean(apiKey),
    apiKey,
    model
  };
}

const defaultImageGenerateSettings: ImageGenerateSettings = {
  enabled: String(process.env.MOLIBOT_IMAGE_GENERATE_ENABLED ?? "true").toLowerCase() !== "false",
  defaultEngine: (process.env.MOLIBOT_IMAGE_GENERATE_DEFAULT_ENGINE ?? "auto") as ImageGenerateEngineId | "auto",
  engines: {
    agnes: imageGenerateEngineFromEnv("agnes", "AGNES_API_KEY", "agnes-image-2.0-flash"),
    openai: imageGenerateEngineFromEnv("openai", "OPENAI_API_KEY", "gpt-image-2"),
    "openai-chat": imageGenerateEngineFromEnv("openai-chat", "OPENAI_API_KEY", "gpt-4o"),
    modelscope: imageGenerateEngineFromEnv("modelscope", "MODELSCOPE_API_KEY", "Tongyi-MAI/Z-Image-Turbo"),
    google: imageGenerateEngineFromEnv("google", "GOOGLE_API_KEY", "imagen-3.0-generate-001"),
    volcengine: imageGenerateEngineFromEnv("volcengine", "VOLCENGINE_API_KEY", "cv_vit_huge_p14_laion2b_s32b_b64_seedream")
  }
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


export const defaultRuntimeSettings: RuntimeSettings = {
  providerMode,
  piModelProvider: providerFromEnv("PI_MODEL_PROVIDER", "anthropic"),
  piModelName: process.env.PI_MODEL_NAME ?? "claude-sonnet-4-20250514",
  defaultThinkingLevel: sanitizeRuntimeThinkingLevel(process.env.MOLIBOT_DEFAULT_THINKING_LEVEL, "off"),
  customProviders: defaultCustomProviders,
  defaultCustomProviderId: defaultCustomProviders[0]?.id ?? "",
  modelRouting: {
    textModelKey: "",
    visionModelKey: "",
    sttModelKey: "",
    ttsModelKey: "",
    subagentModelKey: "",
    subagentHaikuModelKey: "",
    subagentSonnetModelKey: "",
    subagentOpusModelKey: "",
    subagentThinkingModelKey: ""
  },
  modelFallback: {
    mode: "same-provider"
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
          agentId: "",
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
  skillSearch: defaultSkillSearchSettings,
  skillDrafts: defaultSkillDraftSettings,
  webSearch: defaultWebSearchSettings,
  imageGenerate: defaultImageGenerateSettings,
  videoGenerate: defaultVideoGenerateSettings,
  ttsGenerate: defaultTtsGenerateSettings,
  toolSandbox: defaultToolSandboxSettings,
  hostTools: defaultHostToolSettings,
  disabledSkillPaths: [],
  telegramBots: defaultTelegramBots,
  qqBots: defaultQQBots,
  plugins: {
    memory: {
      enabled: String(process.env.MEMORY_ENABLED ?? "false").toLowerCase() === "true",
      backend: (process.env.MEMORY_BACKEND ?? process.env.MEMORY_CORE ?? "json-file").trim() || "json-file"
    },
    cloudflareHtml: {
      ...defaultCloudflareHtmlPluginSettings
    },
    hooks: []
  },
  telegramBotToken: defaultTelegramBotToken,
  telegramAllowedChatIds: defaultTelegramAllowedChatIds,
  feishuBots: defaultFeishuBots,
  budget: {
    maxToolCalls: Math.max(1, Number(process.env.MOLIBOT_MAX_TOOL_CALLS ?? 24) || 24),
    maxToolFailures: Math.max(1, Number(process.env.MOLIBOT_MAX_TOOL_FAILURES ?? 6) || 6),
    maxModelAttempts: Math.max(1, Number(process.env.MOLIBOT_MAX_MODEL_ATTEMPTS ?? 6) || 6)
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
  display: {
    toolProgress: "all",
    showReasoning: "off",
    gatewayNotifyInterval: 0,
    runLogNotice: false
  }
};
