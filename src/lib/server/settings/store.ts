import { DatabaseSync } from "node:sqlite";
import { inferAcpAdapterKind } from "../acp/providers/index.js";
import {
  type AcpAdapterKind,
  type AgentSettings,
  type AcpApprovalMode,
  type AcpSettings,
  type ChannelSettingsMap,
  defaultRuntimeSettings,
  type ModelCapabilityTag,
  type ModelCapabilityVerification,
  type ProviderModelConfig,
  type McpServerConfig,
  type CustomProviderConfig,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  isKnownProvider,
  type ProviderMode,
  type RuntimeSettings
} from "../settings/index.js";
import {
  resolveCustomProviderThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap,
  sanitizeRuntimeThinkingLevel
} from "../settings/thinking.js";
import { readJsonFile, storagePaths, writeJsonFile } from "../infra/db/storage.js";

type DynamicSettingKey = "customProviders" | "channels" | "agents";
const DYNAMIC_SETTING_KEYS: DynamicSettingKey[] = ["customProviders", "channels", "agents"];

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
  };
  modelFallback?: {
    mode?: string;
  };
  compaction?: {
    enabled?: boolean | string;
    reserveTokens?: number | string;
    keepRecentTokens?: number | string;
  };
  systemPrompt?: string;
  plugins?: {
    memory?: {
      enabled?: boolean | string;
      backend?: string;
      core?: string;
    };
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
  disabledSkillPaths?: unknown;
  acp?: unknown;
}

type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
const DEFAULT_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const CAPABILITY_VERIFICATION_SET: ReadonlySet<string> = new Set(["untested", "passed", "failed"]);
const DEFAULT_MODEL_TAGS: ModelCapabilityTag[] = ["text"];

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

function sanitizeModelFallbackSettings(input: unknown): RuntimeSettings["modelFallback"] {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const mode = String(source.mode ?? defaultRuntimeSettings.modelFallback.mode).trim();
  return {
    mode: mode === "off" || mode === "any-enabled" ? mode : "same-provider"
  };
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

    out.push({
      id,
      name,
      enabled: item.enabled === undefined ? !isKnownProvider(id) : Boolean(item.enabled),
      baseUrl,
      apiKey: String(item.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(item.path ?? "").trim() || "/v1/chat/completions",
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

function sanitizeAcpApprovalMode(input: unknown, fallback: AcpApprovalMode = "manual"): AcpApprovalMode {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "manual" || value === "auto-safe" || value === "auto-all") {
    return value;
  }
  return fallback;
}

function sanitizeAcpAdapterKind(input: unknown, fallback: AcpAdapterKind = "custom"): AcpAdapterKind {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "codex" || value === "claude-code" || value === "custom") {
    return value;
  }
  return fallback;
}

function sanitizeAcpSettings(input: unknown): AcpSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawTargets = Array.isArray(source.targets) ? source.targets : [];
  const targets: AcpSettings["targets"] = rawTargets
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const id = String(item.id ?? "").trim();
      const name = String(item.name ?? id).trim() || id;
      const command = String(item.command ?? "").trim();
      if (!id || !command) return null;
      return {
        id,
        name,
        adapter: sanitizeAcpAdapterKind(
          item.adapter,
          inferAcpAdapterKind({
            id,
            name,
            command,
            args: Array.isArray(item.args)
              ? item.args.map((value) => String(value ?? "").trim()).filter(Boolean)
              : []
          })
        ),
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
        command,
        args: Array.isArray(item.args)
          ? item.args.map((value) => String(value ?? "").trim()).filter(Boolean)
          : [],
        env: item.env && typeof item.env === "object"
          ? Object.fromEntries(
            Object.entries(item.env as Record<string, unknown>)
              .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
              .filter(([key]) => Boolean(key))
          )
          : {},
        cwd: String(item.cwd ?? "").trim()
      };
    })
    .filter((value): value is AcpSettings["targets"][number] => value !== null);

  const rawProjects = Array.isArray(source.projects) ? source.projects : [];
  const projects: AcpSettings["projects"] = rawProjects
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const id = String(item.id ?? "").trim();
      const path = String(item.path ?? "").trim();
      if (!id || !path) return null;
      return {
        id,
        name: String(item.name ?? id).trim() || id,
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
        path,
        allowedTargetIds: Array.isArray(item.allowedTargetIds)
          ? item.allowedTargetIds.map((value) => String(value ?? "").trim()).filter(Boolean)
          : [],
        defaultApprovalMode: sanitizeAcpApprovalMode(item.defaultApprovalMode, "manual")
      };
    })
    .filter((value): value is AcpSettings["projects"][number] => value !== null);

  return {
    enabled: source.enabled === undefined ? defaultRuntimeSettings.acp.enabled : Boolean(source.enabled),
    targets: targets.length > 0
      ? targets
      : defaultRuntimeSettings.acp.targets.map((target) => ({
        ...target,
        args: [...target.args],
        env: { ...target.env }
      })),
    projects
  };
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
    : String(memoryEnabledRaw ?? "").toLowerCase() === "true";
  const memoryBackend = String(raw.plugins?.memory?.backend ?? raw.plugins?.memory?.core ?? "").trim() ||
    defaultRuntimeSettings.plugins.memory.backend;
  const cloudflareHtml = sanitizeCloudflareHtmlPluginSettings(raw.plugins?.cloudflareHtml);

  const feishuBotsFromList = sanitizeFeishuBots(raw.feishuBots);
  const feishuBots = feishuBotsFromList.length > 0 ? feishuBotsFromList : [];
  const qqBotsFromList = sanitizeQQBots(raw.qqBots);
  const qqBots = qqBotsFromList.length > 0 ? qqBotsFromList : [];
  const channels = sanitizeChannels(raw.channels, telegramBots, feishuBots, qqBots);
  const effectiveTelegramBots = telegramBots.length > 0 ? telegramBots : deriveTelegramBotsFromChannels(channels);
  const effectiveFeishuBots = feishuBots.length > 0 ? feishuBots : deriveFeishuBotsFromChannels(channels);
  const effectiveQQBots = qqBots.length > 0 ? qqBots : deriveQQBotsFromChannels(channels);
  const primaryBot = effectiveTelegramBots[0];
  const acp = sanitizeAcpSettings(raw.acp ?? defaultRuntimeSettings.acp);
  const agents = sanitizeAgents(raw.agents);
  const mcpServers = sanitizeMcpServers(raw.mcpServers ?? defaultRuntimeSettings.mcpServers);
  const skillSearch = sanitizeSkillSearchSettings(raw.skillSearch ?? defaultRuntimeSettings.skillSearch);
  const skillDrafts = sanitizeSkillDraftSettings(raw.skillDrafts ?? defaultRuntimeSettings.skillDrafts);
  const disabledSkillPaths = sanitizeList(raw.disabledSkillPaths);
  const compactionEnabledRaw = raw.compaction?.enabled;
  const compactionEnabled =
    typeof compactionEnabledRaw === "boolean"
      ? compactionEnabledRaw
      : compactionEnabledRaw === undefined
        ? defaultRuntimeSettings.compaction.enabled
        : String(compactionEnabledRaw).toLowerCase() === "true";
  const reserveTokensRaw = Number(raw.compaction?.reserveTokens ?? defaultRuntimeSettings.compaction.reserveTokens);
  const keepRecentTokensRaw = Number(raw.compaction?.keepRecentTokens ?? defaultRuntimeSettings.compaction.keepRecentTokens);
  const reserveTokens = Number.isFinite(reserveTokensRaw)
    ? Math.max(1024, Math.round(reserveTokensRaw))
    : defaultRuntimeSettings.compaction.reserveTokens;
  const keepRecentTokens = Number.isFinite(keepRecentTokensRaw)
    ? Math.max(2048, Math.round(keepRecentTokensRaw))
    : defaultRuntimeSettings.compaction.keepRecentTokens;

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
      textModelKey: String(raw.modelRouting?.textModelKey ?? "").trim(),
      visionModelKey: String(raw.modelRouting?.visionModelKey ?? "").trim(),
      sttModelKey: String(raw.modelRouting?.sttModelKey ?? "").trim(),
      ttsModelKey: String(raw.modelRouting?.ttsModelKey ?? "").trim()
    },
    modelFallback: sanitizeModelFallbackSettings(raw.modelFallback),
    compaction: {
      enabled: compactionEnabled,
      reserveTokens,
      keepRecentTokens
    },
    systemPrompt:
      String(raw.systemPrompt ?? defaultRuntimeSettings.systemPrompt).trim() ||
      defaultRuntimeSettings.systemPrompt,
    acp,
    agents,
    channels,
    mcpServers,
    skillSearch,
    skillDrafts,
    disabledSkillPaths,
    telegramBots: effectiveTelegramBots,
    qqBots: effectiveQQBots,
    plugins: {
      memory: {
        enabled: memoryEnabled,
        backend: memoryBackend
      },
      cloudflareHtml
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
        verification_json TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE INDEX IF NOT EXISTS idx_settings_channel_instances_channel ON settings_channel_instances(channel_key);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_provider ON settings_custom_provider_models(provider_id);
      CREATE INDEX IF NOT EXISTS idx_settings_provider_models_order ON settings_custom_provider_models(provider_id, order_index);
    `);
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
        SELECT id, name, enabled, base_url, api_key, default_model, path, supports_thinking, thinking_format, reasoning_effort_map_json
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
        supports_thinking: number | null;
        thinking_format: string;
        reasoning_effort_map_json: string;
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
        path: row.path,
        supportsThinking: row.supports_thinking === null ? undefined : Boolean(row.supports_thinking),
        thinkingFormat: resolveCustomProviderThinkingFormat(row.thinking_format, {
          id: row.id,
          name: row.name || row.id,
          baseUrl: row.base_url
        }),
        reasoningEffortMap: sanitizeReasoningEffortMap(this.parseDynamicValue(row.reasoning_effort_map_json, {}))
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
            (id, name, enabled, base_url, api_key, default_model, path, supports_thinking, thinking_format, reasoning_effort_map_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            provider.supportsThinking === undefined ? null : (provider.supportsThinking ? 1 : 0),
            provider.thinkingFormat ?? "",
            JSON.stringify(provider.reasoningEffortMap ?? {}),
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
      defaultThinkingLevel: settings.defaultThinkingLevel,
      defaultCustomProviderId: settings.defaultCustomProviderId,
      modelRouting: {
        textModelKey: settings.modelRouting.textModelKey,
        visionModelKey: settings.modelRouting.visionModelKey,
        sttModelKey: settings.modelRouting.sttModelKey,
        ttsModelKey: settings.modelRouting.ttsModelKey
      },
      modelFallback: {
        mode: settings.modelFallback.mode
      },
      compaction: {
        enabled: settings.compaction.enabled,
        reserveTokens: settings.compaction.reserveTokens,
        keepRecentTokens: settings.compaction.keepRecentTokens
      },
      systemPrompt: settings.systemPrompt,
      plugins: {
        memory: {
          enabled: settings.plugins.memory.enabled,
          backend: settings.plugins.memory.backend
        },
        cloudflareHtml: {
          enabled: settings.plugins.cloudflareHtml.enabled,
          accessMode: settings.plugins.cloudflareHtml.accessMode,
          workerBaseHost: settings.plugins.cloudflareHtml.workerBaseHost,
          publicBaseHost: settings.plugins.cloudflareHtml.publicBaseHost,
          routePrefix: settings.plugins.cloudflareHtml.routePrefix,
          bucketName: settings.plugins.cloudflareHtml.bucketName,
          accountId: settings.plugins.cloudflareHtml.accountId,
          accessKeyId: settings.plugins.cloudflareHtml.accessKeyId,
          secretAccessKey: settings.plugins.cloudflareHtml.secretAccessKey,
          objectPrefix: settings.plugins.cloudflareHtml.objectPrefix
        }
      },
      timezone: settings.timezone,
      acp: settings.acp,
      mcpServers: settings.mcpServers,
      skillSearch: settings.skillSearch,
      skillDrafts: settings.skillDrafts,
      disabledSkillPaths: settings.disabledSkillPaths,
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
