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
import { buildCustomProviderCompat, resolveCustomProviderReasoningSupport } from "../../providers/customThinking.js";
import { currentModelKey } from "../../settings/modelSwitch.js";
import type { RuntimeSettings } from "../../settings/index.js";
import { isKnownProvider } from "../../settings/index.js";
import { KNOWN_PROVIDER_LIST } from "../../settings/schema.js";
import { resolveProviderApiKey } from "../auth.js";
import { momLog } from "../log.js";
import { parseSkillFrontmatter } from "../skillFrontmatter.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

const SUBAGENT_NAMES = ["scout", "planner", "worker", "reviewer"] as const;
type SubagentName = (typeof SUBAGENT_NAMES)[number];

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

interface SubagentRunResult {
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

interface SubagentDefinition {
  name: SubagentName;
  description: string;
  tools?: string[];
  modelHint?: string;
  systemPrompt: string;
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
  reviewer: "medium"
};

let cachedRegistry: Map<SubagentName, SubagentDefinition> | null = null;

function previewTask(text: string, max = 160): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
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
      systemPrompt: extractBody(raw)
    });
  }

  cachedRegistry = next;
  return next;
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

function normalizePath(path: string | undefined): string {
  const raw = String(path ?? "/v1/chat/completions").trim();
  if (!raw) return "/v1/chat/completions";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildOpenAIBaseUrl(baseUrl: string, path: string | undefined): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(path);
  const chatCompletionsSuffix = "/chat/completions";

  if (normalizedPath.endsWith(chatCompletionsSuffix)) {
    return `${base}${normalizedPath.slice(0, -chatCompletionsSuffix.length)}`;
  }

  const slash = normalizedPath.lastIndexOf("/");
  const dir = slash > 0 ? normalizedPath.slice(0, slash) : "";
  return `${base}${dir}`;
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
  const routed = resolveSubagentModelHint(modelHint, settings) ?? parseModelKey(currentModelKey(settings, "text"));

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
    if (customProvider?.enabled !== false && customProvider.baseUrl.trim() && routed.model) {
      const apiKey = await resolveProviderApiKey(customProvider.id, () => customProvider.apiKey.trim());
      if (apiKey) {
        authStorage.setRuntimeApiKey(customProvider.id, apiKey);
      }
      const configuredModel = customProvider.models.find((row) => row.id === routed.model);
      const model: Model<any> = {
        id: routed.model,
        name: customProvider.name || routed.model,
        api: "openai-completions",
        provider: customProvider.id,
        baseUrl: buildOpenAIBaseUrl(customProvider.baseUrl, customProvider.path),
        reasoning: resolveCustomProviderReasoningSupport(customProvider),
        input: configuredModel?.tags?.includes("vision") ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
        compat: buildCustomProviderCompat(customProvider)
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

function summarizeResults(mode: "single" | "parallel" | "chain", results: SubagentRunResult[]): string {
  if (results.length === 0) return "Subagent finished with no output.";

  if (mode === "single") {
    const [result] = results;
    if (!result) return "Subagent finished with no output.";
    return result.output || `${result.agent} finished without text output.`;
  }

  return results
    .map((result, index) => {
      const body = result.output || "(no text output)";
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

function createWriteDefinition(cwd: string, workspaceDir: string, chatId: string): ToolDefinition {
  const tool = createWriteTool({ cwd, workspaceDir, chatId });
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

function createBashDefinition(cwd: string, readOnly: boolean): ToolDefinition {
  const tool = createBashTool(cwd);
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
  options: { cwd: string; workspaceDir: string; chatId: string }
): ToolDefinition[] {
  const readOnlyShell = agent.name === "scout" || agent.name === "planner" || agent.name === "reviewer";
  const tools: ToolDefinition[] = [
    createReadDefinition(options.cwd, options.workspaceDir),
    createBashDefinition(options.cwd, readOnlyShell)
  ];
  if (agent.name === "worker") {
    tools.push(createEditDefinition(options.cwd, options.workspaceDir));
    tools.push(createWriteDefinition(options.cwd, options.workspaceDir, options.chatId));
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
    signal?: AbortSignal;
  }
): Promise<SubagentRunResult> {
  const { model, authStorage, modelRegistry } = await resolveSubagentModel(options.settings, agent.modelHint);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [RUNTIME_PROMPT_APPEND, agent.systemPrompt]
  });
  await resourceLoader.reload();

  const customTools = createCustomTools(agent, {
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    chatId: options.chatId
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

  const onAbort = () => {
    void session.abort();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await session.prompt(task);
    const messages = session.state.messages;
    const lastAssistant = getLastAssistant(messages);
    return {
      agent: agent.name,
      task,
      output: getAssistantText(lastAssistant),
      stopReason: lastAssistant?.stopReason ?? "stop",
      errorMessage: lastAssistant?.errorMessage,
      usage: buildUsage(messages),
      model: session.model?.id
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    session.dispose();
  }
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
  cwd: string;
  workspaceDir: string;
  chatId: string;
  getSettings: () => RuntimeSettings;
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

      onUpdate?.({
        content: [{ type: "text", text: buildStatusText(parsed.mode, 0, parsed.tasks.length) }]
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

      let results: SubagentRunResult[];
      if (parsed.mode === "single") {
        const item = parsed.tasks[0];
        if (!item) throw new Error("Missing subagent task.");
        const agent = getSubagentDefinition(item.agent);
        momLog("runner", "subagent_task_start", {
          chatId: options.chatId,
          mode: parsed.mode,
          agent: agent.name,
          taskIndex: 1,
          taskCount: parsed.tasks.length,
          taskPreview: previewTask(item.task)
        });
        const result = await runSingleSubagent(agent, item.task, {
          cwd: options.cwd,
          workspaceDir: options.workspaceDir,
          chatId: options.chatId,
          settings,
          signal
        });
        momLog("runner", "subagent_task_end", {
          chatId: options.chatId,
          mode: parsed.mode,
          agent: result.agent,
          taskIndex: 1,
          taskCount: parsed.tasks.length,
          taskPreview: previewTask(item.task),
          stopReason: result.stopReason,
          model: result.model,
          usageTotal: result.usage.total,
          outputPreview: previewTask(result.output, 200),
          errorMessage: result.errorMessage
        });
        finished.push(result);
        results = [result];
      } else if (parsed.mode === "parallel") {
        results = await mapWithConcurrency(parsed.tasks, parsed.maxConcurrency, async (item, index) => {
          const agent = getSubagentDefinition(item.agent);
          momLog("runner", "subagent_task_start", {
            chatId: options.chatId,
            mode: parsed.mode,
            agent: agent.name,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            taskPreview: previewTask(item.task)
          });
          const result = await runSingleSubagent(agent, item.task, {
            cwd: options.cwd,
            workspaceDir: options.workspaceDir,
            chatId: options.chatId,
            settings,
            signal
          });
          momLog("runner", "subagent_task_end", {
            chatId: options.chatId,
            mode: parsed.mode,
            agent: result.agent,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            taskPreview: previewTask(item.task),
            stopReason: result.stopReason,
            model: result.model,
            usageTotal: result.usage.total,
            outputPreview: previewTask(result.output, 200),
            errorMessage: result.errorMessage
          });
          finished.push(result);
          emitProgress();
          return result;
        });
      } else {
        const chainResults: SubagentRunResult[] = [];
        let previousOutput = "";
        for (const [index, item] of parsed.tasks.entries()) {
          const agent = getSubagentDefinition(item.agent);
          const task = item.task.includes("{previous}")
            ? item.task.replaceAll("{previous}", previousOutput)
            : item.task;
          momLog("runner", "subagent_task_start", {
            chatId: options.chatId,
            mode: parsed.mode,
            agent: agent.name,
            taskIndex: index + 1,
            taskCount: parsed.tasks.length,
            taskPreview: previewTask(task)
          });
          const result = await runSingleSubagent(agent, task, {
            cwd: options.cwd,
            workspaceDir: options.workspaceDir,
            chatId: options.chatId,
            settings,
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
          chainResults.push(result);
          finished.push(result);
          previousOutput = result.output;
          emitProgress();
        }
        results = chainResults;
      }

      const hasFailure = results.some((result) => result.stopReason === "error" || result.stopReason === "aborted");
      momLog("runner", "subagent_end", {
        chatId: options.chatId,
        mode: parsed.mode,
        taskCount: results.length,
        hasFailure,
        stopReasons: results.map((result) => result.stopReason)
      });

      return {
        content: [{ type: "text", text: summarizeResults(parsed.mode, results) }],
        details: {
          mode: parsed.mode,
          results
        }
      };
    }
  };
}
