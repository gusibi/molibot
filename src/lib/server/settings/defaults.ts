import type { KnownProvider } from "@mariozechner/pi-ai";
import { createAcpTargetPreset } from "../acp/providers/index.js";
import {
  type AgentSettings,
  type AcpSettings,
  isKnownProvider,
  type ChannelInstanceSettings,
  type CustomProviderConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  type McpServerConfig,
  type ProviderMode,
  type SkillDraftSettings,
  type SkillSearchSettings,
  type RuntimeSettings,
  type TelegramBotConfig
} from "./schema.js";
import { sanitizeRuntimeThinkingLevel } from "./thinking.js";

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

      const transportRaw = String(item.transport ?? item.type ?? "stdio").trim().toLowerCase();
      const transport = transportRaw === "http" ? "http" : "stdio";

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
      const headersRaw = httpRaw.headers && typeof httpRaw.headers === "object"
        ? httpRaw.headers as Record<string, unknown>
        : {};
      const headers = Object.fromEntries(
        Object.entries(headersRaw)
          .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
          .filter(([key]) => Boolean(key))
      );
      const url = String(httpRaw.url ?? item.url ?? "").trim();
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
const defaultAcpSettings: AcpSettings = {
  enabled: true,
  targets: [
    createAcpTargetPreset("codex"),
    createAcpTargetPreset("claude-code")
  ],
  projects: []
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
    ttsModelKey: ""
  },
  compaction: {
    enabled: String(process.env.MOLIBOT_COMPACTION_ENABLED ?? "true").toLowerCase() !== "false",
    reserveTokens: Math.max(1024, Number(process.env.MOLIBOT_COMPACTION_RESERVE_TOKENS ?? 16384) || 16384),
    keepRecentTokens: Math.max(2048, Number(process.env.MOLIBOT_COMPACTION_KEEP_RECENT_TOKENS ?? 20000) || 20000)
  },
  systemPrompt:
    process.env.MOLIBOT_SYSTEM_PROMPT ??
    "You are Molibot, a concise and helpful assistant.",
  timezone:
    (process.env.MOLIBOT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone).trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  acp: defaultAcpSettings,
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
  disabledSkillPaths: [],
  telegramBots: defaultTelegramBots,
  qqBots: defaultQQBots,
  plugins: {
    memory: {
      enabled: String(process.env.MEMORY_ENABLED ?? "false").toLowerCase() === "true",
      backend: (process.env.MEMORY_BACKEND ?? process.env.MEMORY_CORE ?? "json-file").trim() || "json-file"
    }
  },
  telegramBotToken: defaultTelegramBotToken,
  telegramAllowedChatIds: defaultTelegramAllowedChatIds,
  feishuBots: defaultFeishuBots
};
