import { readFileSync } from "node:fs";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { getModels, type AssistantMessage, type Model } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildCustomProviderCompat, resolveCustomProviderReasoningSupport } from "$lib/server/providers/customThinking.js";
import {
  buildAnthropicBaseUrl,
  buildOpenAIBaseUrl,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { isKnownProvider } from "$lib/server/settings/index.js";
import { KNOWN_PROVIDER_LIST } from "$lib/server/settings/schema.js";
import { resolveProviderApiKey } from "$lib/server/agent/identity/auth.js";
import { momLog } from "$lib/server/agent/common/log.js";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";
import type { RunnerUiEvent } from "$lib/server/agent/core/types.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { createBashTool, type BashToolHostApprovalOptions } from "$lib/server/agent/tools/bash.js";
import { createEditTool } from "$lib/server/agent/tools/edit.js";
import { createReadTool } from "$lib/server/agent/tools/read.js";
import { createWriteTool } from "$lib/server/agent/tools/write.js";

const SUBAGENT_NAMES = ["scout", "planner", "worker", "reviewer", "skill-drafter"] as const;
type SubagentName = (typeof SUBAGENT_NAMES)[number];
const SUBAGENT_MODEL_LEVELS = ["haiku", "sonnet", "opus", "thinking"] as const;
type SubagentModelLevel = (typeof SUBAGENT_MODEL_LEVELS)[number];

const taskItemSchema = Type.Object({
  agent: Type.String(),
  task: Type.String()
});

const subagentSchema = Type.Object({
  agent: Type.Optional(Type.String()),
  task: Type.Optional(Type.String()),
  tasks: Type.Optional(Type.Array(taskItemSchema)),
  chain: Type.Optional(Type.Array(taskItemSchema)),
  maxConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 4 }))
});

type SingleTaskInput = {
  agent: string;
  task: string;
};

type SubagentInput = {
  agent?: string;
  task?: string;
  tasks?: SingleTaskInput[];
  chain?: SingleTaskInput[];
  maxConcurrency?: number;
};

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  turns: number;
}

export interface SubagentRunResult {
  agent: SubagentName;
  task: string;
  output: string;
  stopReason: string;
  errorMessage?: string;
  usage: UsageStats;
  model?: string;
}

interface SubagentToolDetails {
  mode: "single" | "parallel" | "chain";
  results: SubagentRunResult[];
}

export interface SubagentDefinition {
  name: SubagentName;
  description: string;
  tools?: string[];
  modelHint?: string;
  modelLevel?: SubagentModelLevel;
  systemPrompt: string;
}

export interface BuiltInSubagentInfo {
  name: SubagentName;
  description: string;
  tools: string[];
  modelHint?: string;
  modelLevel?: SubagentModelLevel;
}

const RUNTIME_PROMPT_APPEND = [
  "You are a delegated subagent running inside Molibot.",
  "- Another agent will consume your result. Do not address the end user directly.",
  "- Focus only on the delegated task and ignore unrelated work.",
  "- Stay inside the current workspace and avoid touching unrelated files.",
  "- If blocked, state the concrete blocker and the safest next step."
].join("\n");

const REVIEW_BASH_ALLOWLIST = [
  /^git\s+diff(?:\s|$)/,
  /^git\s+show(?:\s|$)/,
  /^git\s+log(?:\s|$)/,
  /^rg(?:\s|$)/,
  /^grep(?:\s|$)/,
  /^find(?:\s|$)/,
  /^ls(?:\s|$)/,
  /^pwd(?:\s|$)/,
  /^date(?:\s|$)/,
  /^cat(?:\s|$)/,
  /^head(?:\s|$)/,
  /^tail(?:\s|$)/,
  /^wc(?:\s|$)/,
  /^sed\s+-n(?:\s|$)/,
  /^stat(?:\s|$)/
];

const MODEL_REASONING_HINTS: Record<SubagentName, ThinkingLevel> = {
  scout: "low",
  planner: "medium",
  worker: "medium",
  reviewer: "medium",
  "skill-drafter": "low"
};

let cachedRegistry: Map<SubagentName, SubagentDefinition> | null = null;

function previewTask(text: string, max = 160): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function normalizeSubagentStopReason(
  stopReason: string | undefined
): "stop" | "aborted" | "error" | "waiting_for_approval" {
  return stopReason === "stop" ||
    stopReason === "aborted" ||
    stopReason === "error" ||
    stopReason === "waiting_for_approval"
    ? stopReason
    : "error";
}

export function summarizeSubagentStopReason(
  results: Array<{ stopReason?: string }>
): "stop" | "aborted" | "error" | "waiting_for_approval" {
  if (results.some((result) => result.stopReason === "error")) return "error";
  if (results.some((result) => result.stopReason === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (results.some((result) => result.stopReason === "aborted")) return "aborted";
  return "stop";
}

function parseSubagentMode(input: SubagentInput): {
  mode: "single" | "parallel" | "chain";
  tasks: SingleTaskInput[];
  maxConcurrency: number;
} {
  const hasSingle = Boolean(input.agent?.trim() && input.task?.trim());
  const hasParallel = Array.isArray(input.tasks) && input.tasks.length > 0;
  const hasChain = Array.isArray(input.chain) && input.chain.length > 0;
  const modeCount = [hasSingle, hasParallel, hasChain].filter(Boolean).length;

  if (modeCount !== 1) {
    throw new Error("Provide exactly one subagent mode: {agent, task}, {tasks}, or {chain}.");
  }

  if (hasSingle) {
    return {
      mode: "single",
      tasks: [{ agent: input.agent!.trim(), task: input.task!.trim() }],
      maxConcurrency: 1
    };
  }

  if (hasParallel) {
    return {
      mode: "parallel",
      tasks: input.tasks!.map((item) => ({
        agent: String(item.agent ?? "").trim(),
        task: String(item.task ?? "").trim()
      })),
      maxConcurrency: Math.max(1, Math.min(4, Math.floor(input.maxConcurrency ?? 2)))
    };
  }

  return {
    mode: "chain",
    tasks: input.chain!.map((item) => ({
      agent: String(item.agent ?? "").trim(),
      task: String(item.task ?? "").trim()
    })),
    maxConcurrency: 1
  };
}

function extractBody(content: string): string {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
}

function loadSubagentRegistry(): Map<SubagentName, SubagentDefinition> {
  if (cachedRegistry) return cachedRegistry;

  const next = new Map<SubagentName, SubagentDefinition>();
  for (const name of SUBAGENT_NAMES) {
    const filePath = new URL(`./subagent-agents/${name}.md`, import.meta.url);
    const raw = readFileSync(filePath, "utf8");
    const frontmatter = parseSkillFrontmatter(raw);
    if (!frontmatter) {
      throw new Error(`Missing frontmatter for subagent '${name}'.`);
    }
    next.set(name, {
      name,
      description: String(frontmatter.description ?? "").trim(),
      tools: String(frontmatter.tools ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      modelHint: String(frontmatter.model ?? "").trim() || undefined,
      modelLevel: parseSubagentModelLevel(frontmatter.model),
      systemPrompt: extractBody(raw)
    });
  }

  cachedRegistry = next;
  return next;
}

export function listBuiltInSubagents(): BuiltInSubagentInfo[] {
  return Array.from(loadSubagentRegistry().values()).map((agent) => ({
    name: agent.name,
    description: agent.description,
    tools: agent.tools ?? [],
    modelHint: agent.modelHint,
    modelLevel: agent.modelLevel
  }));
}

function getSubagentDefinition(agent: string): SubagentDefinition {
  const registry = loadSubagentRegistry();
  const normalized = String(agent ?? "").trim().toLowerCase() as SubagentName;
  const found = registry.get(normalized);
  if (!found) {
    throw new Error(`Unknown subagent '${agent}'. Available: ${SUBAGENT_NAMES.join(", ")}.`);
  }
  return found;
}

function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

function parseSubagentModelLevel(value: unknown): SubagentModelLevel | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "haiku" || normalized.includes("haiku")) return "haiku";
  if (normalized === "sonnet" || normalized.includes("sonnet")) return "sonnet";
  if (normalized === "opus" || normalized.includes("opus")) return "opus";
  if (normalized === "thinking" || normalized.includes("thinking")) return "thinking";
  return undefined;
}

function subagentModelLevelKey(settings: RuntimeSettings, level: SubagentModelLevel | undefined): string {
  if (level === "haiku") return settings.modelRouting.subagentHaikuModelKey;
  if (level === "sonnet") return settings.modelRouting.subagentSonnetModelKey;
  if (level === "opus") return settings.modelRouting.subagentOpusModelKey;
  if (level === "thinking") return settings.modelRouting.subagentThinkingModelKey;
  return "";
}

export function resolveSubagentModelHint(
  modelHint: string | undefined,
  settings: RuntimeSettings
): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const normalized = String(modelHint ?? "").trim();
  if (!normalized) return null;

  const explicit = parseModelKey(normalized);
  if (explicit) {
    return explicit;
  }

  const customMatches = settings.customProviders
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) =>
      provider.models
        .filter((row) => row.id === normalized)
        .map(() => ({ mode: "custom" as const, provider: provider.id, model: normalized }))
    );
  if (customMatches.length === 1) {
    return customMatches[0] ?? null;
  }

  const builtInMatches = KNOWN_PROVIDER_LIST.flatMap((provider) =>
    getModels(provider)
      .filter((row) => row.id === normalized)
      .map(() => ({ mode: "pi" as const, provider, model: normalized }))
  );
  if (builtInMatches.length === 1) {
    return builtInMatches[0] ?? null;
  }
  if (builtInMatches.length > 1) {
    const preferred = builtInMatches.find((row) => row.provider === settings.piModelProvider);
    return preferred ?? builtInMatches[0] ?? null;
  }

  return null;
}

export function isSafeReadOnlySubagentCommand(command: string): boolean {
  const normalized = String(command ?? "").trim();
  if (!normalized) return false;
  if (hasShellControlOperator(normalized)) return false;
  return REVIEW_BASH_ALLOWLIST.some((pattern) => pattern.test(normalized));
}

function hasShellControlOperator(command: string): boolean {
  let quote: "'" | "\"" | "`" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const current = command[index];
    const next = command[index + 1];

    if (quote) {
      if (current === "\\" && quote !== "'") {
        index += 1;
        continue;
      }
      if (current === quote) {
        quote = null;
      }
      continue;
    }

    if (current === "'" || current === "\"" || current === "`") {
      quote = current;
      continue;
    }

    if (current === ";") return true;
    if (current === "|") return true;
    if (current === "&") return true;
    if (current === ">" || current === "<") return true;
    if (current === "$" && next === "(") return true;
  }

  return false;
}

async function resolveSubagentModel(
  settings: RuntimeSettings,
  modelHint?: string
): Promise<{ model: Model<any>; authStorage: AuthStorage; modelRegistry: ModelRegistry }> {
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const routed = resolveSubagentModelRoute(settings, modelHint);

  if (routed) {
    if (routed.mode === "pi" || isKnownProvider(routed.provider)) {
      const providerId = routed.provider;
      const found = getModels(providerId as any).find((row) => row.id === routed.model);
      if (found) {
        const configured = settings.customProviders.find((provider) => provider.id === providerId);
        const apiKey = await resolveProviderApiKey(providerId, () => configured?.apiKey?.trim() || undefined);
        if (apiKey) {
          authStorage.setRuntimeApiKey(providerId, apiKey);
        }
        return { model: found, authStorage, modelRegistry };
      }
    }

    const customProvider = settings.customProviders.find((provider) => provider.id === routed.provider);
    if (customProvider && customProvider.enabled !== false && customProvider.baseUrl.trim() && routed.model) {
      const apiKey = await resolveProviderApiKey(customProvider.id, () => customProvider.apiKey.trim());
      if (apiKey) {
        authStorage.setRuntimeApiKey(customProvider.id, apiKey);
      }
      const configuredModel = customProvider.models.find((row) => row.id === routed.model);
      const protocol = resolveCustomProviderProtocol(customProvider.protocol);
      const model: Model<any> = {
        id: routed.model,
        name: customProvider.name || routed.model,
        api: protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
        provider: customProvider.id,
        baseUrl: protocol === "anthropic"
          ? buildAnthropicBaseUrl(customProvider.baseUrl, customProvider.path)
          : buildOpenAIBaseUrl(customProvider.baseUrl, customProvider.path),
        reasoning: resolveCustomProviderReasoningSupport(customProvider),
        input: configuredModel?.tags?.includes("vision") ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: configuredModel?.contextWindow || 200000,
        maxTokens: 8192,
        compat: protocol === "anthropic" ? undefined : buildCustomProviderCompat(customProvider)
      };
      return { model, authStorage, modelRegistry };
    }
  }

  const fallbackProvider = settings.piModelProvider;
  const fallbackModel = getModels(fallbackProvider).find((row) => row.id === settings.piModelName) ?? getModels(fallbackProvider)[0];
  if (!fallbackModel) {
    throw new Error(`No fallback model available for provider '${fallbackProvider}'.`);
  }
  const fallbackConfigured = settings.customProviders.find((provider) => provider.id === fallbackProvider);
  const apiKey = await resolveProviderApiKey(fallbackProvider, () => fallbackConfigured?.apiKey?.trim() || undefined);
  if (apiKey) {
    authStorage.setRuntimeApiKey(fallbackProvider, apiKey);
  }
  return { model: fallbackModel, authStorage, modelRegistry };
}

export function resolveSubagentModelRoute(
  settings: RuntimeSettings,
  modelHint?: string
): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const level = parseSubagentModelLevel(modelHint);
  return parseModelKey(subagentModelLevelKey(settings, level))
    ?? parseModelKey(settings.modelRouting.subagentModelKey)
    ?? (level ? null : resolveSubagentModelHint(modelHint, settings))
    ?? parseModelKey(currentModelKey(settings, "text"));
}

function buildUsage(messages: AgentMessage[]): UsageStats {
  const usage: UsageStats = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    turns: 0
  };

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const assistant = message as AssistantMessage;
    usage.turns += 1;
    if (!assistant.usage) continue;
    usage.input += assistant.usage.input ?? 0;
    usage.output += assistant.usage.output ?? 0;
    usage.cacheRead += assistant.usage.cacheRead ?? 0;
    usage.cacheWrite += assistant.usage.cacheWrite ?? 0;
    usage.total += assistant.usage.totalTokens ?? 0;
    usage.cost += assistant.usage.cost?.total ?? 0;
  }

  return usage;
}

function getLastAssistant(messages: AgentMessage[]): AssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message as AssistantMessage;
    }
  }
  return null;
}

function getAssistantText(message: AssistantMessage | null): string {
  if (!message) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

export function summarizeSubagentResultsForParent(mode: "single" | "parallel" | "chain", results: SubagentRunResult[]): string {
  if (results.length === 0) return "Subagent finished with no output.";

  const compressOutput = (text: string): string => {
    const body = text || "(no text output)";
    const max = 6000;
    if (body.length <= max) return body;
    const head = body.slice(0, 4000).trimEnd();
    const tail = body.slice(-1500).trimStart();
    return [
      head,
      "",
      `[... subagent output compressed for parent context; omitted ${body.length - head.length - tail.length} characters ...]`,
      "",
      tail
    ].join("\n");
  };

  if (mode === "single") {
    const [result] = results;
    if (!result) return "Subagent finished with no output.";
    return compressOutput(result.output || `${result.agent} finished without text output.`);
  }

  return results
    .map((result, index) => {
      const body = compressOutput(result.output);
      return `## ${index + 1}. ${result.agent}\n\n${body}`;
    })
    .join("\n\n");
}

function buildStatusText(mode: "single" | "parallel" | "chain", completed: number, total: number): string {
  if (mode === "single") return "Subagent running...";
  return `Subagents running: ${completed}/${total} completed.`;
}

function createReadDefinition(cwd: string, workspaceDir: string): ToolDefinition {
  const tool = createReadTool({ cwd, workspaceDir });
  const schema = Type.Object({
    path: Type.String(),
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number())
  });
  return defineTool({
    name: "read",
    label: "read",
    description: "Read text or image files from the current workspace.",
    promptSnippet: "Read file contents",
    promptGuidelines: ["Use read to inspect files instead of shelling out to cat or sed."],
    parameters: schema,
    execute: (toolCallId, params, signal) => tool.execute(toolCallId, { label: "read", ...params }, signal)
  });
}

function createWriteDefinition(cwd: string, workspaceDir: string, chatId: string, artifactDir?: string): ToolDefinition {
  const tool = createWriteTool({ cwd, workspaceDir, chatId, artifactDir });
  const schema = Type.Object({
    path: Type.String(),
    content: Type.String()
  });
  return defineTool({
    name: "write",
    label: "write",
    description: "Create or overwrite a file inside the current workspace.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write when creating new files or replacing whole-file contents."],
    parameters: schema,
    execute: (toolCallId, params, signal) => tool.execute(toolCallId, { label: "write", ...params }, signal)
  });
}

function createEditDefinition(cwd: string, workspaceDir: string): ToolDefinition {
  const tool = createEditTool({ cwd, workspaceDir });
  const schema = Type.Object({
    path: Type.String(),
    oldText: Type.String(),
    newText: Type.String()
  });
  return defineTool({
    name: "edit",
    label: "edit",
    description: "Replace an exact text snippet in an existing file.",
    promptSnippet: "Edit existing files",
    promptGuidelines: ["Use edit for targeted in-place changes to existing files."],
    parameters: schema,
    execute: (toolCallId, params, signal) => tool.execute(toolCallId, { label: "edit", ...params }, signal)
  });
}

function createBashDefinition(
  cwd: string,
  workspaceDir: string,
  settings: RuntimeSettings,
  readOnly: boolean,
  artifactDir?: string,
  hostApproval?: BashToolHostApprovalOptions
): ToolDefinition {
  const tool = createBashTool(cwd, {
    artifactDir,
    hostApproval,
    sandbox: {
      settings: settings.toolSandbox,
      workspaceDir
    }
  });
  const schema = Type.Object({
    command: Type.String(),
    timeout: Type.Optional(Type.Number())
  });
  return defineTool({
    name: "bash",
    label: "bash",
    description: readOnly
      ? "Execute a read-only shell command for inspection."
      : "Execute a shell command in the current scratch workspace.",
    promptSnippet: "Run shell commands when file tools are insufficient",
    promptGuidelines: ["Use bash only when dedicated file tools cannot complete the task directly."],
    parameters: schema,
    execute: async (toolCallId, params, signal) => {
      const command = String(params.command ?? "").trim();
      if (readOnly && !isSafeReadOnlySubagentCommand(command)) {
        throw new Error(
          "This subagent only allows read-only bash commands such as git diff/show/log, rg, grep, find, ls, cat, head, tail, wc, sed -n, pwd, date, or stat."
        );
      }
      return tool.execute(toolCallId, { label: "bash", ...params }, signal);
    }
  });
}

function createCustomTools(
  agent: SubagentDefinition,
  options: {
    cwd: string;
    workspaceDir: string;
    chatId: string;
    settings: RuntimeSettings;
    artifactDir?: string;
    hostApproval?: BashToolHostApprovalOptions;
  }
): ToolDefinition[] {
  const readOnlyShell = agent.name === "scout" || agent.name === "planner" || agent.name === "reviewer";
  const tools: ToolDefinition[] = [
    createReadDefinition(options.cwd, options.workspaceDir),
    createBashDefinition(
      options.cwd,
      options.workspaceDir,
      options.settings,
      readOnlyShell,
      options.artifactDir,
      options.hostApproval
    )
  ];
  if (agent.name === "worker") {
    tools.push(createEditDefinition(options.cwd, options.workspaceDir));
    tools.push(createWriteDefinition(options.cwd, options.workspaceDir, options.chatId, options.artifactDir));
  }
  return tools;
}

async function runSingleSubagent(
  agent: SubagentDefinition,
  task: string,
  options: {
    cwd: string;
    workspaceDir: string;
    chatId: string;
    settings: RuntimeSettings;
    artifactDir?: string;
    hostApproval?: BashToolHostApprovalOptions;
    emitRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
    signal?: AbortSignal;
  }
): Promise<SubagentRunResult> {
  const { model, authStorage, modelRegistry } = await resolveSubagentModel(options.settings, agent.modelHint);
  momLog("runner", "subagent_model_resolved", {
    chatId: options.chatId,
    agent: agent.name,
    modelId: model.id,
    provider: model.provider,
    api: model.api
  });

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }
  });
  const artifactPrompt = options.artifactDir
    ? [
      `Default generated artifact directory: ${options.artifactDir}`,
      "- Put ordinary generated files in that directory, relative to the scratch working directory.",
      "- Plain file names passed to write and new root-level bash artifacts are automatically routed there.",
      "- Report output paths using the routed relative path so the parent agent can read them."
    ].join("\n")
    : "";
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [RUNTIME_PROMPT_APPEND, artifactPrompt, agent.systemPrompt].filter(Boolean)
  });
  await resourceLoader.reload();

  const customTools = createCustomTools(agent, {
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    chatId: options.chatId,
    settings: options.settings,
    artifactDir: options.artifactDir,
    hostApproval: options.hostApproval
  });

  momLog("runner", "subagent_session_creating", {
    chatId: options.chatId,
    agent: agent.name,
    modelId: model.id,
    toolNames: agent.tools && agent.tools.length > 0 ? agent.tools : ["read", "bash", "edit", "write"]
  });

  const sessionManager = SessionManager.inMemory(options.cwd);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.cwd,
    model,
    thinkingLevel: MODEL_REASONING_HINTS[agent.name],
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
    tools: agent.tools && agent.tools.length > 0 ? agent.tools : ["read", "bash", "edit", "write"],
    customTools
  });

  momLog("runner", "subagent_session_created", {
    chatId: options.chatId,
    agent: agent.name,
    modelId: model.id
  });

  const onAbort = () => {
    void session.abort();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let hostBashApproval: HostBashApprovalPrompt | undefined;
  let subagentToolCallCount = 0;
  let subagentLlmCallCount = 0;
  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_start" && event.message?.role === "assistant") {
      subagentLlmCallCount += 1;
      momLog("runner", "subagent_llm_call_start", {
        chatId: options.chatId,
        agent: agent.name,
        callIndex: subagentLlmCallCount
      });
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const msg = event.message as { stopReason?: string; usage?: { input?: number; output?: number; totalTokens?: number } };
      momLog("runner", "subagent_llm_call_end", {
        chatId: options.chatId,
        agent: agent.name,
        callIndex: subagentLlmCallCount,
        stopReason: msg.stopReason,
        usageTotal: msg.usage?.totalTokens
      });
      return;
    }

    if (event.type === "tool_execution_start") {
      subagentToolCallCount += 1;
      momLog("runner", "subagent_tool_start", {
        chatId: options.chatId,
        agent: agent.name,
        tool: event.toolName,
        toolIndex: subagentToolCallCount,
        llmCallIndex: subagentLlmCallCount
      });
      return;
    }

    if (event.type !== "tool_execution_end") return;

    const toolName = String((event as { toolName?: unknown }).toolName ?? "unknown");
    const isError = Boolean((event as { isError?: unknown }).isError);
    momLog("runner", "subagent_tool_end", {
      chatId: options.chatId,
      agent: agent.name,
      tool: toolName,
      isError,
      toolIndex: subagentToolCallCount
    });

    const prompt = extractHostBashApprovalPrompt(event.result);
    if (!prompt) return;
    hostBashApproval = prompt;
    void options.emitRunnerEvent?.({
      type: "tool_execution_end",
      toolName,
      displayName: "subagent bash",
      isError: true,
      summary: extractTextFromToolResult(event.result),
      hostBashApproval: prompt
    });
    void session.abort();
  });

  try {
    momLog("runner", "subagent_prompt_start", {
      chatId: options.chatId,
      agent: agent.name,
      taskPreview: previewTask(task, 200)
    });
    await session.prompt(task);
    momLog("runner", "subagent_prompt_end", {
      chatId: options.chatId,
      agent: agent.name,
      llmCalls: subagentLlmCallCount,
      toolCalls: subagentToolCallCount
    });

    const messages = session.state.messages;
    const lastAssistant = getLastAssistant(messages);
    return {
      agent: agent.name,
      task,
      output: getAssistantText(lastAssistant),
      stopReason: hostBashApproval ? "waiting_for_approval" : lastAssistant?.stopReason ?? "stop",
      errorMessage: hostBashApproval ? undefined : lastAssistant?.errorMessage,
      usage: buildUsage(messages),
      model: session.model?.id
    };
  } catch (error) {
    momLog("runner", "subagent_prompt_error", {
      chatId: options.chatId,
      agent: agent.name,
      llmCalls: subagentLlmCallCount,
      toolCalls: subagentToolCallCount,
      error: error instanceof Error ? error.message : String(error)
    });
    if (hostBashApproval) {
      const messages = session.state.messages;
      const lastAssistant = getLastAssistant(messages);
      return {
        agent: agent.name,
        task,
        output: getAssistantText(lastAssistant),
        stopReason: "waiting_for_approval",
        usage: buildUsage(messages),
        model: session.model?.id
      };
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    session.dispose();
    momLog("runner", "subagent_session_disposed", {
      chatId: options.chatId,
      agent: agent.name,
      llmCalls: subagentLlmCallCount,
      toolCalls: subagentToolCallCount
    });
  }
}

function extractHostBashApprovalPrompt(result: unknown): HostBashApprovalPrompt | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const prompt = (details as { hostBashApproval?: unknown }).hostBashApproval;
  if (!prompt || typeof prompt !== "object") return undefined;
  return prompt as HostBashApprovalPrompt;
}

function extractTextFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n") || JSON.stringify(result);
}

export async function runBuiltInSubagentTask(options: {
  agent: string;
  task: string;
  cwd: string;
  workspaceDir: string;
  chatId: string;
  settings: RuntimeSettings;
  artifactDir?: string;
  signal?: AbortSignal;
}): Promise<SubagentRunResult> {
  const agent = getSubagentDefinition(options.agent);
  return runSingleSubagent(agent, options.task, {
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    chatId: options.chatId,
    settings: options.settings,
    artifactDir: options.artifactDir,
    signal: options.signal
  });
}

async function mapWithConcurrency<TIn, TOut>(
  rows: TIn[],
  concurrency: number,
  fn: (row: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  if (rows.length === 0) return [];
  const out: TOut[] = new Array(rows.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, rows.length));

  await Promise.all(
    new Array(workerCount).fill(null).map(async () => {
      while (true) {
        const current = cursor;
        cursor += 1;
        if (current >= rows.length) return;
        out[current] = await fn(rows[current], current);
      }
    })
  );

  return out;
}

export function createSubagentTool(options: {
  channel?: string;
  cwd: string;
  workspaceDir: string;
  chatId: string;
  sessionId?: string;
  store?: MomRuntimeStore;
  artifactDir?: string;
  getSettings: () => RuntimeSettings;
  emitRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
}): AgentTool<typeof subagentSchema> {
  return {
    name: "subagent",
    label: "subagent",
    description:
      "Delegate codebase-heavy work to an isolated pi-mono subagent. Use roles `scout`, `planner`, `worker`, or `reviewer`. Supports one task, parallel tasks, or a chain with `{previous}` placeholder.",
    parameters: subagentSchema,
    execute: async (_toolCallId, params, signal, onUpdate): Promise<AgentToolResult<SubagentToolDetails>> => {
      const parsed = parseSubagentMode(params as SubagentInput);
      const settings = options.getSettings();
      let endEventSent = false;
      momLog("runner", "subagent_start", {
        chatId: options.chatId,
        mode: parsed.mode,
        taskCount: parsed.tasks.length,
        agents: parsed.tasks.map((item) => item.agent),
        tasksPreview: parsed.tasks.map((item) => ({
          agent: item.agent,
          task: previewTask(item.task, 120)
        }))
      });
      await options.emitRunnerEvent?.({
        type: "subagent_execution",
        phase: "start",
        mode: parsed.mode,
        taskCount: parsed.tasks.length
      });

      onUpdate?.({
        content: [{ type: "text", text: buildStatusText(parsed.mode, 0, parsed.tasks.length) }],
        details: {
          mode: parsed.mode,
          results: []
        }
      });

      const finished: SubagentRunResult[] = [];
      const emitProgress = (): void => {
        onUpdate?.({
          content: [{ type: "text", text: buildStatusText(parsed.mode, finished.length, parsed.tasks.length) }],
          details: {
            mode: parsed.mode,
            results: [...finished]
          }
        });
      };

      const emitEndEvent = async (
        stopReason: "stop" | "aborted" | "error" | "waiting_for_approval"
      ): Promise<void> => {
        endEventSent = true;
        await options.emitRunnerEvent?.({
          type: "subagent_execution",
          phase: "end",
          mode: parsed.mode,
          taskCount: parsed.tasks.length,
          stopReason
        });
      };

      const runTask = async (item: SingleTaskInput, index: number, task: string): Promise<SubagentRunResult> => {
        const agent = getSubagentDefinition(item.agent);
        let started = false;
        try {
          momLog("runner", "subagent_task_start", {
            chatId: options.chatId,
            mode: parsed.mode,
            agent: agent.name,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            taskPreview: previewTask(task)
          });
          await options.emitRunnerEvent?.({
            type: "subagent_execution",
            phase: "task_start",
            mode: parsed.mode,
            agent: agent.name,
            task,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length
          });
          started = true;
          const result = await runSingleSubagent(agent, task, {
            cwd: options.cwd,
            workspaceDir: options.workspaceDir,
            chatId: options.chatId,
            settings,
            artifactDir: options.artifactDir,
            hostApproval: options.channel && options.sessionId && options.store
              ? {
                channel: options.channel,
                chatId: options.chatId,
                scopeId: options.chatId,
                sessionId: options.sessionId,
                store: options.store
              }
              : undefined,
            emitRunnerEvent: options.emitRunnerEvent,
            signal
          });
          momLog("runner", "subagent_task_end", {
            chatId: options.chatId,
            mode: parsed.mode,
            agent: result.agent,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            taskPreview: previewTask(task),
            stopReason: result.stopReason,
            model: result.model,
            usageTotal: result.usage.total,
            outputPreview: previewTask(result.output, 200),
            errorMessage: result.errorMessage
          });
          await options.emitRunnerEvent?.({
            type: "subagent_execution",
            phase: "task_end",
            mode: parsed.mode,
            agent: result.agent,
            task,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            stopReason: normalizeSubagentStopReason(result.stopReason),
            errorMessage: result.errorMessage
          });
          return result;
        } catch (error) {
          if (started) {
            await options.emitRunnerEvent?.({
              type: "subagent_execution",
              phase: "task_end",
              mode: parsed.mode,
              agent: agent.name,
              task,
              taskIndex: index + 1,
              taskCount: parsed.tasks.length,
              stopReason: signal?.aborted ? "aborted" : "error",
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
          throw error;
        }
      };

      try {
        let results: SubagentRunResult[];
        if (parsed.mode === "single") {
          const item = parsed.tasks[0];
          if (!item) throw new Error("Missing subagent task.");
          const result = await runTask(item, 0, item.task);
          finished.push(result);
          results = [result];
        } else if (parsed.mode === "parallel") {
          results = await mapWithConcurrency(parsed.tasks, parsed.maxConcurrency, async (item, index) => {
            const result = await runTask(item, index, item.task);
            finished.push(result);
            emitProgress();
            return result;
          });
        } else {
          const chainResults: SubagentRunResult[] = [];
          let previousOutput = "";
          for (const [index, item] of parsed.tasks.entries()) {
            const task = item.task.includes("{previous}")
              ? item.task.replaceAll("{previous}", previousOutput)
              : item.task;
            const result = await runTask(item, index, task);
            chainResults.push(result);
            finished.push(result);
            previousOutput = result.output;
            emitProgress();
            if (result.stopReason !== "stop") {
              break;
            }
          }
          results = chainResults;
        }

        const endStopReason = summarizeSubagentStopReason(results);
        momLog("runner", "subagent_end", {
          chatId: options.chatId,
          mode: parsed.mode,
          taskCount: results.length,
          hasFailure: endStopReason !== "stop",
          stopReasons: results.map((result) => result.stopReason)
        });
        await emitEndEvent(endStopReason);

        return {
          content: [{ type: "text", text: summarizeSubagentResultsForParent(parsed.mode, results) }],
          details: {
            mode: parsed.mode,
            results
          }
        };
      } catch (error) {
        if (!endEventSent) {
          await emitEndEvent(signal?.aborted ? "aborted" : "error");
        }
        throw error;
      }
    }
  };
}
