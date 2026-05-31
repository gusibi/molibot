import {
  type AgentSettings,
  defaultRuntimeSettings,
  isKnownProvider,
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
  type ChannelInstanceSettings,
  sanitizeHostToolSettings,
  sanitizeToolSandboxSettings
} from "$lib/server/settings/index.js";

const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const DEFAULT_MODEL_TAGS: ModelCapabilityTag[] = ["text"];

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

export function sanitizeAgents(input: unknown): AgentSettings[] {
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
      sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled)
    });
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

  if (toolProgress === undefined && showReasoning === undefined && gatewayNotifyInterval === undefined) {
    return undefined;
  }
  return { toolProgress, showReasoning, gatewayNotifyInterval };
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
          agentId: String(item.agentId ?? "").trim(),
          credentials,
          allowedChatIds: Array.isArray(item.allowedChatIds)
            ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
            : [],
          sandboxEnabled: item.sandboxEnabled === undefined ? undefined : Boolean(item.sandboxEnabled),
          display: item.display ? sanitizeChannelInstanceDisplaySettings(item.display) : undefined
        };
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
            supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles)
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
        verification: Object.keys(verification ?? {}).length > 0 ? verification : undefined
      });
    }
    if (models.length === 0 && legacyModel) {
      models.push({
        id: legacyModel,
        tags: [...DEFAULT_MODEL_TAGS],
        supportedRoles: sanitizeRoles((row as { supportedRoles?: unknown }).supportedRoles),
        contextWindow: undefined
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
  next.modelFallback = {
    mode: fallbackMode === "off" || fallbackMode === "any-enabled" ? fallbackMode : "same-provider"
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
  next.agents = sanitizeAgents(next.agents ?? current.agents);
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
  next.toolSandbox = sanitizeToolSandboxSettings(next.toolSandbox ?? current.toolSandbox, current.toolSandbox);
  next.hostTools = sanitizeHostToolSettings(next.hostTools ?? current.hostTools);
  next.disabledSkillPaths = Array.isArray(next.disabledSkillPaths)
    ? next.disabledSkillPaths.map((v) => String(v).trim()).filter(Boolean)
    : current.disabledSkillPaths;
  next.channels = sanitizeChannels(next.channels, next.telegramBots, next.feishuBots, next.qqBots, current.channels);

  const displayInput = next.display ?? current.display;
  next.display = {
    toolProgress: displayInput && ["off", "new", "all", "verbose"].includes(String(displayInput.toolProgress)) ? (displayInput.toolProgress as any) : (current.display?.toolProgress ?? "all"),
    showReasoning: displayInput && ["off", "on", "stream", "new"].includes(String(displayInput.showReasoning)) ? (displayInput.showReasoning as any) : (current.display?.showReasoning ?? "off"),
    gatewayNotifyInterval: displayInput && !isNaN(Number(displayInput.gatewayNotifyInterval)) ? Number(displayInput.gatewayNotifyInterval) : (current.display?.gatewayNotifyInterval ?? 0)
  };

  next.telegramBotToken = next.telegramBots[0]?.token ?? "";
  next.telegramAllowedChatIds = next.telegramBots[0]?.allowedChatIds ?? [];
  const memoryPluginInput = next.plugins?.memory ?? current.plugins.memory;
  next.plugins = {
    memory: {
      enabled: memoryPluginInput?.enabled === undefined ? current.plugins.memory.enabled : Boolean(memoryPluginInput.enabled),
      backend: String(
        (memoryPluginInput as { backend?: string; core?: string } | undefined)?.backend ??
        (memoryPluginInput as { backend?: string; core?: string } | undefined)?.core ??
        ""
      ).trim() || current.plugins.memory.backend || defaultRuntimeSettings.plugins.memory.backend
    },
    cloudflareHtml: sanitizeCloudflareHtmlPluginSettings(
      next.plugins?.cloudflareHtml ?? current.plugins.cloudflareHtml,
      current.plugins.cloudflareHtml
    )
  };

  next.budget = sanitizeBudgetSettings(next.budget ?? current.budget, current.budget);

  const browserInput = next.browserAutomation ?? current.browserAutomation;
  const browserTimeoutRaw = browserInput?.defaultTimeoutMs;
  next.browserAutomation = {
    defaultTimeoutMs: browserTimeoutRaw != null && Number.isFinite(Number(browserTimeoutRaw))
      ? Math.max(5000, Math.min(300000, Math.round(Number(browserTimeoutRaw))))
      : current.browserAutomation.defaultTimeoutMs
  };

  return next;
}
