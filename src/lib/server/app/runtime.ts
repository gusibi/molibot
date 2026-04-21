import {
  type AgentSettings,
  type AcpApprovalMode,
  type AcpSettings,
  defaultRuntimeSettings,
  isKnownProvider,
  sanitizeOptionalThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap,
  sanitizeRuntimeThinkingLevel,
  type ProviderModelConfig,
  type ModelRole,
  type ModelCapabilityTag,
  type ChannelSettingsMap,
  type CustomProviderConfig,
  type TelegramBotConfig,
  type FeishuBotConfig,
  type QQBotConfig,
  type ProviderMode,
  type McpServerConfig,
  type RuntimeSettings
} from "../settings/index.js";
import { config } from "./env.js";
import { builtInChannelPlugins, type ChannelManager, type ChannelRuntimeDeps } from "../channels/registry.js";
import { MessageRouter } from "../channels/shared/messageRouter.js";
import { initDb } from "../infra/db/storage.js";
import { MemoryGateway } from "../memory/gateway.js";
import { discoverPlugins } from "../plugins/discovery.js";
import type { PluginCatalog, ProviderPlugin } from "../plugins/types.js";
import { AssistantService } from "../providers/assistantService.js";
import { SessionStore } from "../sessions/store.js";
import { SettingsStore } from "../settings/store.js";
import { AiUsageTracker } from "../usage/tracker.js";

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
  usageTracker: AiUsageTracker;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

declare global {
  // eslint-disable-next-line no-var
  var __molibotRuntime: RuntimeState | undefined;
}

const ROLE_SET: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool", "developer"]);
const CAPABILITY_SET: ReadonlySet<string> = new Set(["text", "vision", "audio_input", "stt", "tts", "tool"]);
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

function clampNumber(value: unknown, fallback: number, min: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const lowerBound = Math.max(min, parsed);
  if (max === undefined) return lowerBound;
  return Math.min(max, lowerBound);
}

function sanitizeSkillSearchSettings(
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

function sanitizeSkillDraftSettings(
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

function sanitizeCloudflareHtmlPluginSettings(
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

function logPluginCatalog(state: RuntimeState): void {
  const channelSummary = state.pluginCatalog.channels
    .map((plugin) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const providerSummary = state.pluginCatalog.providers
    .map((plugin) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const featureSummary = state.pluginCatalog.features
    .map((plugin) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const memoryBackendSummary = state.pluginCatalog.memoryBackends
    .map((backend) => `${backend.key}:${colorStatus(backend.status)}`)
    .join(", ");

  console.log(
    `${runtimeLabel("runtime")} plugin_catalog channels=[${channelSummary || "(none)"}] providers=[${providerSummary || "(none)"}] features=[${featureSummary || "(none)"}] memory_backends=[${memoryBackendSummary || "(none)"}]`
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

function sanitizeAcpApprovalMode(input: unknown, fallback: AcpApprovalMode = "manual"): AcpApprovalMode {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "manual" || value === "auto-safe" || value === "auto-all") {
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
      const command = String(item.command ?? "").trim();
      if (!id || !command) return null;
      return {
        id,
        name: String(item.name ?? id).trim() || id,
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
      allowedChatIds: Array.isArray(item.allowedChatIds)
        ? item.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
        : []
    });
  }
  return out;
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
          allowedChatIds: [...(instance.allowedChatIds ?? [])]
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
            : []
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
      const modelObj = m as {
        id?: unknown;
        model?: unknown;
        tags?: unknown;
        supportedRoles?: unknown;
        verification?: unknown;
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
        verification: Object.keys(verification ?? {}).length > 0 ? verification : undefined
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
      enabled: row.enabled === undefined ? !isKnownProvider(id) : Boolean(row.enabled),
      baseUrl: String(row.baseUrl ?? "").trim(),
      apiKey: String(row.apiKey ?? "").trim(),
      models,
      defaultModel,
      path: String(row.path ?? "").trim() || "/v1/chat/completions",
      supportsThinking: sanitizeOptionalThinkingSupport((row as { supportsThinking?: unknown }).supportsThinking),
      thinkingFormat: sanitizeOptionalThinkingFormat((row as { thinkingFormat?: unknown }).thinkingFormat),
      reasoningEffortMap: sanitizeReasoningEffortMap((row as { reasoningEffortMap?: unknown }).reasoningEffortMap)
    });
  }
  next.customProviders = customProviders;
  next.defaultCustomProviderId = String(next.defaultCustomProviderId ?? "").trim();
  const selectableCustomProviders = next.customProviders.filter((p) => !isKnownProvider(p.id));
  const enabledCustomProviders = selectableCustomProviders.filter((p) => p.enabled !== false);
  if (!enabledCustomProviders.some((p) => p.id === next.defaultCustomProviderId)) {
    next.defaultCustomProviderId = enabledCustomProviders[0]?.id ?? selectableCustomProviders[0]?.id ?? "";
  }

  next.modelRouting = {
    textModelKey: String((next as { modelRouting?: { textModelKey?: unknown } }).modelRouting?.textModelKey ?? "").trim(),
    visionModelKey: String((next as { modelRouting?: { visionModelKey?: unknown } }).modelRouting?.visionModelKey ?? "").trim(),
    sttModelKey: String((next as { modelRouting?: { sttModelKey?: unknown } }).modelRouting?.sttModelKey ?? "").trim(),
    ttsModelKey: String((next as { modelRouting?: { ttsModelKey?: unknown } }).modelRouting?.ttsModelKey ?? "").trim()
  };
  next.defaultThinkingLevel = sanitizeRuntimeThinkingLevel(
    (next as { defaultThinkingLevel?: unknown }).defaultThinkingLevel,
    current.defaultThinkingLevel
  );
  const compactionInput = next.compaction ?? current.compaction;
  const reserveTokensRaw = Number(compactionInput?.reserveTokens ?? current.compaction.reserveTokens);
  const keepRecentTokensRaw = Number(compactionInput?.keepRecentTokens ?? current.compaction.keepRecentTokens);
  next.compaction = {
    enabled: compactionInput?.enabled === undefined ? current.compaction.enabled : Boolean(compactionInput.enabled),
    reserveTokens: Number.isFinite(reserveTokensRaw) ? Math.max(1024, Math.round(reserveTokensRaw)) : current.compaction.reserveTokens,
    keepRecentTokens: Number.isFinite(keepRecentTokensRaw) ? Math.max(2048, Math.round(keepRecentTokensRaw)) : current.compaction.keepRecentTokens
  };

  next.systemPrompt = String(next.systemPrompt ?? "").trim() || defaultRuntimeSettings.systemPrompt;
  next.acp = sanitizeAcpSettings(next.acp ?? current.acp);
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
  next.disabledSkillPaths = Array.isArray(next.disabledSkillPaths)
    ? next.disabledSkillPaths.map((v) => String(v).trim()).filter(Boolean)
    : current.disabledSkillPaths;
  next.channels = sanitizeChannels(next.channels, next.telegramBots, next.feishuBots, next.qqBots, current.channels);

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

  return next;
}

function applyChannelPlugins(state: RuntimeState, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const deps: ChannelRuntimeDeps = {
    getSettings: () => state.settings,
    updateSettings: applySettingsPatch,
    sessions: state.sessions,
    memory: state.memory,
    usageTracker: state.usageTracker
  };

  const loaded = discoverPlugins(state.settings);
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
    const usageTracker = new AiUsageTracker();
    const memory = new MemoryGateway(
      () => currentSettings.value,
      sessions,
      `${config.dataDir}/memory-governance/rejections.jsonl`
    );
    const assistant = new AssistantService(() => currentSettings.value, usageTracker);
    const router = new MessageRouter(sessions, assistant, memory);
    const applySettingsPatch = (patch: Partial<RuntimeSettings>): RuntimeSettings => {
      // Always merge patches on top of the latest persisted settings snapshot.
      // This prevents stale in-memory runtime copies (for example another long-lived dev process)
      // from overwriting newer channel/provider data with historical values.
      const latestPersisted = state.settingsStore.load();
      state.settings = sanitizeSettings(patch, latestPersisted);
      currentSettings.value = state.settings;
      state.settingsStore.save(state.settings);
      applyChannelPlugins(state, applySettingsPatch);
      return state.settings;
    };

    const state: RuntimeState = {
      sessions,
      router,
      channelManagers: new Map<string, Map<string, ChannelManager>>(),
      pluginCatalog: { channels: [], providers: [], features: [], memoryBackends: [] },
      providerPlugins: [],
      memory,
      memorySyncTimer: null,
      settingsStore,
      settings,
      usageTracker,
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
