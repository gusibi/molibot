import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModels, streamSimple, type Model } from "@mariozechner/pi-ai";
import defaultAgentsTemplate from "./prompts/AGENTS.default.md?raw";
import type { RuntimeSettings, CustomProviderConfig } from "../config.js";
import type { MemoryGateway } from "../memory/gateway.js";
import { momError, momLog, momWarn } from "./log.js";
import { formatSkillsForPrompt, loadSkillsFromWorkspace } from "./skills.js";
import { TelegramMomStore } from "./store.js";
import { createMomTools } from "./tools/index.js";
import type { MomContext, RunResult, RunnerLike } from "./types.js";

function resolvePiModel(settings: RuntimeSettings): Model<any> {
  const models = getModels(settings.piModelProvider);
  const found = models.find((m) => m.id === settings.piModelName);
  if (found) return found;
  if (models[0]) return models[0];
  throw new Error(
    `No models available for provider '${settings.piModelProvider}'`,
  );
}

function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = key.trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

function resolvePiModelByKey(provider: string, modelId: string): Model<any> | null {
  const models = getModels(provider as any);
  const found = models.find((m) => m.id === modelId);
  return found ?? null;
}

function isCustomProviderUsable(provider: CustomProviderConfig): boolean {
  return Boolean(provider.baseUrl?.trim() && provider.apiKey?.trim());
}

function pickCustomModelId(provider: CustomProviderConfig, useCase: "text" | "vision"): string {
  const rows = provider.models.filter((m) => Boolean(m.id?.trim()));
  if (rows.length === 0) return "";

  if (useCase === "vision") {
    const vision = rows.find((m) => Array.isArray(m.tags) && m.tags.includes("vision"));
    if (vision?.id) return vision.id;
  }

  const byDefault = rows.find((m) => m.id === provider.defaultModel);
  if (byDefault?.id) return byDefault.id;
  return rows[0]?.id ?? "";
}

function findFirstUsableCustom(settings: RuntimeSettings, useCase: "text" | "vision"): Model<any> | null {
  for (const provider of settings.customProviders) {
    if (!isCustomProviderUsable(provider)) continue;
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    return resolveCustomModel(provider, modelId);
  }
  return null;
}

function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models.map((m) => m.id).filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

function getSelectedCustomProvider(
  settings: RuntimeSettings,
): CustomProviderConfig | undefined {
  if (settings.customProviders.length === 0) return undefined;
  return (
    settings.customProviders.find(
      (p) => p.id === settings.defaultCustomProviderId,
    ) ?? settings.customProviders[0]
  );
}

function getCustomProviderById(settings: RuntimeSettings, providerId: string): CustomProviderConfig | undefined {
  return settings.customProviders.find((p) => p.id === providerId);
}

function getCustomModelRoles(settings: RuntimeSettings): string[] {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  if (routed?.mode === "custom") {
    const provider = getCustomProviderById(settings, routed.provider);
    const model = provider?.models.find((m) => m.id === routed.model);
    if (model?.supportedRoles?.length) return model.supportedRoles;
  }

  const selected = getSelectedCustomProvider(settings);
  if (!selected) return [];
  const modelId = getProviderModel(selected);
  const model = selected.models.find((m) => m.id === modelId);
  return model?.supportedRoles ?? [];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

function normalizePath(path: string | undefined): string {
  const raw = (path || "/v1/chat/completions").trim();
  if (!raw) return "/v1/chat/completions";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildOpenAIBaseUrl(baseUrl: string, path: string | undefined): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(path);
  const chatCompletionsSuffix = "/chat/completions";

  if (normalizedPath.endsWith(chatCompletionsSuffix)) {
    const prefix = normalizedPath.slice(0, -chatCompletionsSuffix.length);
    return `${base}${prefix}`;
  }

  const slash = normalizedPath.lastIndexOf("/");
  const dir = slash > 0 ? normalizedPath.slice(0, slash) : "";
  return `${base}${dir}`;
}

function resolveCustomModel(selected: CustomProviderConfig, modelId: string): Model<any> {
  const computedBaseUrl = buildOpenAIBaseUrl(
    selected.baseUrl,
    selected.path,
  );
  return {
    id: modelId,
    name: selected.name || modelId,
    api: "openai-completions",
    provider: selected.id || "custom-provider",
    baseUrl: computedBaseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

function resolveModel(settings: RuntimeSettings, useCase: "text" | "vision" = "text"): Model<any> {
  const routedKey = useCase === "vision"
    ? settings.modelRouting.visionModelKey
    : settings.modelRouting.textModelKey;
  const routed = parseModelKey(routedKey);
  if (routed) {
    if (routed.mode === "pi") {
      const pi = resolvePiModelByKey(routed.provider, routed.model);
      if (pi) return pi;
    } else {
      const provider = getCustomProviderById(settings, routed.provider);
      if (provider && isCustomProviderUsable(provider) && routed.model) {
        return resolveCustomModel(provider, routed.model);
      }
    }
  }

  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? pickCustomModelId(selected, useCase) : "";
    if (selected && isCustomProviderUsable(selected) && modelId) {
      return resolveCustomModel(selected, modelId);
    }
  }

  const anyCustom = findFirstUsableCustom(settings, useCase);
  if (anyCustom) return anyCustom;

  return resolvePiModel(settings);
}

function envVarForProvider(provider: string): string | null {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
    case "openai-codex":
      return "OPENAI_API_KEY";
    case "google":
    case "google-antigravity":
    case "google-gemini-cli":
      return "GOOGLE_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "zai":
      return "ZAI_API_KEY";
    case "minimax":
    case "minimax-cn":
      return "MINIMAX_API_KEY";
    case "huggingface":
      return "HUGGINGFACE_API_KEY";
    default:
      return null;
  }
}

function resolveApiKeyForModel(
  model: Model<any>,
  settings: RuntimeSettings,
): string | undefined {
  const mapped = settings.customProviders.find((p) => p.id === model.provider);
  if (mapped) {
    return mapped.apiKey?.trim() || undefined;
  }

  const envVar = envVarForProvider(model.provider);
  if (!envVar) return undefined;
  const value = process.env[envVar]?.trim();
  return value || undefined;
}

function redactBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/\/([^/@]+)@/, "//***@");
}

function keyFingerprint(key: string | undefined): string {
  if (!key) return "none";
  if (key.length <= 8) return `len=${key.length}`;
  return `${key.slice(0, 4)}...${key.slice(-2)}(len=${key.length})`;
}

function validateRuntimeSettings(settings: RuntimeSettings): string | null {
  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? getProviderModel(selected) : "";
    if (!selected) {
      return "AI settings error: providerMode=custom but no custom provider configured.";
    }
    if (!selected.baseUrl?.trim() || !selected.apiKey?.trim() || !modelId) {
      return "AI settings error: custom provider requires baseUrl, apiKey, and at least one model.";
    }
    return null;
  }

  const model = resolvePiModel(settings);
  const envVar = envVarForProvider(model.provider);
  if (envVar && !process.env[envVar]?.trim()) {
    return `AI settings error: missing ${envVar} for provider '${model.provider}'.`;
  }
  return null;
}

function extractTextFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const obj = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);
  const parts = obj.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  return parts.join("\n") || JSON.stringify(result);
}

function mapUnsupportedDeveloperRole(
  settings: RuntimeSettings,
  context: any,
): any {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  const shouldCheckCustom = settings.providerMode === "custom" || routed?.mode === "custom";
  if (!shouldCheckCustom) return context;
  const roles = getCustomModelRoles(settings);
  if (roles.includes("developer")) return context;

  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;
  const mappedMessages = context.messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    if (msg.role !== "developer") return msg;
    return { ...msg, role: "system" };
  });

  // For some OpenAI-compatible adapters, systemPrompt can be emitted as a "developer" message.
  // Move it into explicit system message to force compatible role shape.
  const prompt =
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  if (!prompt) {
    return { ...context, messages: mappedMessages };
  }

  return {
    ...context,
    systemPrompt: "",
    messages: [{ role: "system", content: prompt }, ...mappedMessages],
  };
}

function buildSystemPrompt(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
): string {
  const renderVars = buildPromptRenderVariables(
    workspaceDir,
    chatId,
    sessionId,
    memory,
  );
  const sections = [buildBaseSystemPrompt(renderVars)];
  const globalSections = buildPromptSectionsFromInstructionFiles(renderVars.dataRoot, renderVars);
  const workspaceSections =
    renderVars.dataRoot === workspaceDir
      ? []
      : buildPromptSectionsFromInstructionFiles(workspaceDir, renderVars);

  if (globalSections.length > 0) {
    sections.push(...globalSections);
  }
  if (workspaceSections.length > 0) {
    sections.push(...workspaceSections);
  }

  if (globalSections.length === 0 && workspaceSections.length === 0) {
    sections.push(renderPromptTemplate(DEFAULT_AGENTS_TEMPLATE, renderVars));
  }
  return sections.join("\n\n").trim();
}

export function buildSystemPromptPreview(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
): string {
  return buildSystemPrompt(workspaceDir, chatId, sessionId, memory);
}

export function getSystemPromptSources(workspaceDir: string): {
  global: string[];
  workspace: string[];
} {
  const normalizedWorkspace = workspaceDir.replace(/\\/g, "/");
  const dataRoot = normalizedWorkspace.includes("/moli-t/")
    ? normalizedWorkspace.slice(0, normalizedWorkspace.indexOf("/moli-t/"))
    : normalizedWorkspace;
  const collect = (baseDir: string): string[] => {
    const out: string[] = [];
    const agentPath = resolveInstructionFilePath(baseDir, "AGENTS.md");
    if (agentPath) out.push(agentPath);
    for (const fileName of OPTIONAL_INSTRUCTION_FILES) {
      const filePath = resolveInstructionFilePath(baseDir, fileName);
      if (filePath) out.push(filePath);
    }
    return out;
  };
  return {
    global: collect(dataRoot),
    workspace: dataRoot === workspaceDir ? [] : collect(workspaceDir),
  };
}

const DEFAULT_AGENTS_TEMPLATE = defaultAgentsTemplate;

const OPTIONAL_INSTRUCTION_FILES = [
  "SOUL.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
] as const;

type PromptRenderVars = Record<string, string>;

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

function buildContextSection(vars: PromptRenderVars): string {
  return section("Context", [
    "- For current date/time, use: date",
    "- You have access to previous conversation context including tool results from prior turns.",
    `- For older history beyond your context, search ${vars.chatDir}/log.jsonl (contains user messages and your final responses, but not tool results).`,
  ]);
}

function buildFormattingSection(): string {
  return section("Telegram Formatting (Markdown, not HTML)", [
    "Bold: *text*, Italic: _text_, Code: `code`, Block: ```code```",
    "Do NOT use HTML formatting.",
  ]);
}

function buildEnvironmentSection(vars: PromptRenderVars): string {
  return section("Environment", [
    "You are running directly on the host machine.",
    `- Bash working directory for tools: ${vars.scratchDir}`,
    "- Be careful with system modifications",
    `- When writing files in scratch, use relative paths from scratch (do not prepend ${vars.scratchDir} again)`,
    `- Global workspace root: ${vars.workspaceDir}`,
    `- Global skills directory (canonical): ${vars.globalSkillsDir}`,
    `- Chat-local skills directory (session-specific): ${vars.chatSkillsDir}`,
    `- For reusable/general-purpose skills (web browsing, search, API wrappers, utilities), install under ${vars.globalSkillsDir}.`,
    `- For chat/session-specific one-off skills only, install under ${vars.chatSkillsDir}.`,
    `- Never install reusable skills under ${vars.workspaceDir} or ${vars.chatDir}; keep reusable skills in ${vars.globalSkillsDir}.`,
    `- Never create skills via relative path like data/${vars.workspaceName}/skills from scratch; it creates nested duplicate directories.`,
  ]);
}

function buildResponseRulesSection(): string {
  return section("Telegram Response Rules", [
    "- Keep the main reply concise and user-facing.",
    "- Only send tool/error details in thread replies when something fails.",
    "- If periodic checks have nothing actionable, reply exactly [SILENT].",
    "- Prefer normal text replies. Do not send files unless necessary.",
    "- If content fits Telegram message limits, send text directly instead of attachments.",
    "- If sending a text file, file extension must be .txt, .md, or .html.",
    "- Do not send text attachments as .json/.log/.csv/.yaml or other extensions.",
    "- Do not promise a reminder is scheduled unless the event file is actually created.",
    "- When a reminder/event is created, include scheduled time and filename.",
    "- Do not claim a skill was used unless you actually read its SKILL.md and executed its scripts.",
  ]);
}

function buildToolCallStyleSection(): string {
  return section("Tool Call Style", [
    "- Default: do not narrate routine, low-risk tool calls.",
    "- Narrate only when it helps: multi-step work, risky actions, real blockers, or when the user explicitly asks.",
    "- Keep narration brief and useful; avoid repeating obvious steps.",
    "- When a first-class tool exists, use it instead of telling the user to run an equivalent shell command.",
  ]);
}

function buildSafetySection(): string {
  return section("Safety & Boundaries", [
    "- Do not claim an action succeeded unless it actually happened.",
    "- Do not claim a reminder is scheduled unless the event file was created successfully.",
    "- Do not invent file contents, tool outputs, or runtime state.",
    "- If instructions conflict with runtime constraints, explain the constraint and take the best valid fallback.",
  ]);
}

function buildFailureRecoverySection(): string {
  return section("Failure Recovery Protocol (Mandatory)", [
    `- Never stop at "I can't do this". You must continue with a best-effort recovery path.`,
    "- If audio/image/tool/model/config fails:",
    "  1. State root cause in one sentence.",
    "  2. Propose the next executable fallback you can do now.",
    "  3. Provide exact fields user should adjust (provider/baseUrl/path/model/apiKey/route key).",
    "  4. Continue task with available inputs instead of ending the conversation.",
    "- For voice messages without transcript:",
    "  - Ask for short text summary and offer concrete next steps.",
    "  - Do not end with a generic capability disclaimer only.",
    "- Do not ask user to provide API keys/config files unless runtime explicitly reports missing key/config.",
    '- Treat provider/key/path status as runtime-owned; avoid inventing "missing config file" diagnoses.',
    "- If input includes a [voice transcript] section, treat it as already-transcribed text.",
    '- In that case, never claim "cannot transcribe/play audio" and proceed with normal text reasoning.',
  ]);
}

function buildWorkspaceLayoutSection(vars: PromptRenderVars): string {
  return section("Workspace Layout", [
    `${vars.workspaceDir}/`,
    "├── (runtime workspace files, sessions, logs, skills, events)",
    "├── SYSTEM.md                    # Environment setup log",
    "├── skills/                      # Global CLI tools you create",
    "├── events/                      # Workspace-level events",
    `└── ${vars.chatId}/                   # This chat`,
    "    ├── log.jsonl                # Message history (no tool results)",
    "    ├── contexts/",
    `    │   └── ${vars.sessionId}.json    # Active session context`,
    "    ├── attachments/             # User-shared files",
    "    └── scratch/                 # Tool working directory",
    `        └── data/${vars.workspaceName}/events/   # Chat-local watched events`,
  ]);
}

function buildSkillsSection(vars: PromptRenderVars): string {
  return [
    "## Skills (Custom CLI Tools)",
    "You can create reusable CLI tools for recurring tasks (APIs, data processing, automation, etc.).",
    "",
    "### Creating Skills",
    `Store in absolute path \`${vars.globalSkillsDir}/<name>/\` for reusable skills.`,
    `Use \`${vars.chatSkillsDir}/<name>/\` only for chat-specific temporary skills.`,
    "Each skill directory needs a `SKILL.md` with YAML frontmatter:",
    "",
    "```markdown",
    "---",
    "name: skill-name",
    "description: Short description of what this skill does",
    "---",
    "",
    "# Skill Name",
    "",
    "Usage instructions, examples, etc.",
    "Scripts are in: {baseDir}/",
    "```",
    "",
    "`name` and `description` are required. Use `{baseDir}` as placeholder for the skill directory path.",
    "",
    "### Available Skills",
    vars.availableSkills,
    "",
    "### Skill usage protocol",
    "- Before replying, scan available skill names/descriptions and decide whether one clearly applies.",
    "- If exactly one skill clearly applies, read its SKILL.md and follow it.",
    "- If none clearly apply, do not read skills speculatively.",
    "- Before using any skill, read its SKILL.md in full.",
    "- Follow instructions in SKILL.md exactly.",
    "- Resolve relative paths against the skill directory.",
    "- Prefer invoking skill scripts via `bash` tool.",
    "- If two skills overlap, pick the one with the clearest description match.",
    "",
    "### Skill diagnostics",
    vars.skillDiagText,
  ].join("\n");
}

function buildEventsSection(vars: PromptRenderVars): string {
  return [
    "## Events",
    "You can schedule events via JSON files in watched directories:",
    `- Workspace events: ${vars.workspaceEventsDir}/*.json`,
    `- Chat scratch events: ${vars.scratchEventsDir}/*.json`,
    "",
    "### Event Types",
    "Immediate - Triggers as soon as watcher sees the file.",
    "```json",
    `{"type":"immediate","chatId":"${vars.chatId}","delivery":"agent","text":"请总结今天深圳天气并给出穿衣建议"}`,
    "```",
    "",
    "One-shot - Triggers once at a specific time (for reminders).",
    "```json",
    `{"type":"one-shot","chatId":"${vars.chatId}","delivery":"text","text":"提醒：喝水","at":"2026-03-01T09:00:00+08:00"}`,
    "```",
    "",
    "Periodic - Triggers on a cron schedule.",
    "```json",
    `{"type":"periodic","chatId":"${vars.chatId}","delivery":"agent","text":"生成今天的晨会简报","schedule":"0 9 * * 1-5","timezone":"Asia/Shanghai"}`,
    "```",
    "",
    "### Event Delivery Mode",
    '- `delivery: "text"`: send `text` to Telegram directly (literal delivery).',
    '- `delivery: "agent"`: run AI agent with `text` as task instruction, then send generated result.',
    '- For `one-shot`/`immediate`, if `delivery` is missing, runtime defaults to `agent`.',
    '- For plain reminders that must be sent literally, always set `delivery: "text"`.',
    "",
    "### Cron Format",
    "`minute hour day-of-month month day-of-week`",
    "- `0 9 * * *` = daily at 9:00",
    "- `0 9 * * 1-5` = weekdays at 9:00",
    "- `30 14 * * 1` = Mondays at 14:30",
    "- `0 0 1 * *` = first day of month at midnight",
    "",
    "### Time Rules",
    '- Any "N minutes later / later / remind me at" task MUST be implemented by writing a one-shot event file.',
    '- Any recurring request such as "every day / every weekday / every Monday / each morning at 7:30" MUST be implemented by writing a `periodic` event JSON file.',
    "- NEVER implement delayed tasks by running long wait commands in shell (sleep/timeout/wait/ping loops).",
    "- NEVER implement reminders or recurring tasks via `crontab`, `at`, `launchctl`, `schtasks`, or any external OS scheduler.",
    "- NEVER store reminders, timers, countdowns, or recurring schedules in memory as a substitute for scheduling.",
    '- One-shot event field "at" must be an absolute ISO-8601 timestamp in the future and include timezone offset.',
    "- Before writing one-shot events, compute and verify target time from current time (must be later than now).",
    '- If one-shot `write` fails with "at must be in the future", recompute time and rewrite event file immediately.',
    "- Do not write reminder/event files to /tmp or other external directories; use watched events directories only.",
    "- Reminder files must be valid JSON event objects, not plain text lines.",
    "- If you did not create an event JSON file successfully, you must say scheduling failed; do not claim the task was recorded or will run later.",
    "",
    "### Creating Events",
    "Use unique filenames to avoid overwriting:",
    "```bash",
    `cat > ${vars.workspaceEventsDir}/reminder-$(date +%s).json << 'EOF'`,
    `{"type":"one-shot","chatId":"${vars.chatId}","delivery":"text","text":"Reminder text","at":"2026-03-01T09:00:00+08:00"}`,
    "EOF",
    "```",
    "",
    "### Managing Events",
    `- List: \`ls ${vars.workspaceEventsDir}/\``,
    `- View: \`cat ${vars.workspaceEventsDir}/foo.json\``,
    `- Cancel: \`rm ${vars.workspaceEventsDir}/foo.json\``,
    "",
    "### Event lifecycle",
    "- one-shot/immediate files are retained after execution and updated with status (state/completedAt/runCount/reason).",
    "- periodic files persist until manually deleted.",
    "",
    "### Silent completion",
    "For periodic events with nothing actionable, respond with exactly `[SILENT]`.",
    "",
    "### Debouncing",
    "When automations may emit many immediate events, debounce and summarize into one event rather than flooding.",
  ].join("\n");
}

function buildMemorySection(vars: PromptRenderVars): string {
  return [
    "## Memory",
    "Write to MEMORY.md files to persist context across conversations.",
    `- Global (${vars.globalMemoryPath}): skills, preferences, project info`,
    `- Chat (${vars.chatMemoryPath}): chat-specific decisions and ongoing work`,
    `- IMPORTANT: Do not store memory files directly under ${vars.workspaceDir} or ${vars.chatDir}; always use the memory root path above.`,
    "- Never read/write/edit MEMORY.md directly with file tools. Always use the memory tool (or gateway API) for memory operations.",
    "",
    "### Current Memory",
    vars.memory,
  ].join("\n");
}

function buildSystemLogSection(vars: PromptRenderVars): string {
  return [
    "## System Configuration Log",
    `Maintain ${vars.workspaceDir}/SYSTEM.md for environment-level changes:`,
    "- installed packages",
    "- credentials/config changes",
    "- global runtime setup steps",
    "",
    "Update this file whenever environment setup changes.",
  ].join("\n");
}

function buildLogQuerySection(vars: PromptRenderVars): string {
  return [
    "## Log Queries (for older history)",
    "```bash",
    "# Recent chat messages",
    `tail -30 ${vars.chatDir}/log.jsonl`,
    "",
    "# Search specific topic",
    `grep -i "topic" ${vars.chatDir}/log.jsonl`,
    "```",
  ].join("\n");
}

function buildToolsSection(): string {
  return [
    "## Tools",
    "- memory: Memory gateway operations (add/search/list/update/delete/flush/sync). Use this for all memory changes.",
    "- bash: Execute shell commands in scratch (primary execution tool)",
    "- read: Read files",
    "- write: Create/overwrite files",
    "- edit: Surgical file edits",
    "- attach: Send a local file to Telegram (use only when text message is insufficient)",
    "- `TOOLS.md` is guidance about conventions and paths; it does not control actual tool availability.",
  ].join("\n");
}

function buildBaseSystemPrompt(vars: PromptRenderVars): string {
  return [
    "You are moli, a Telegram bot assistant. Be concise. No emojis.",
    "",
    buildContextSection(vars),
    "",
    buildFormattingSection(),
    "",
    buildEnvironmentSection(vars),
    "",
    buildResponseRulesSection(),
    "",
    buildToolCallStyleSection(),
    "",
    buildSafetySection(),
    "",
    buildFailureRecoverySection(),
    "",
    buildWorkspaceLayoutSection(vars),
    "",
    buildSkillsSection(vars),
    "",
    buildEventsSection(vars),
    "",
    buildMemorySection(vars),
    "",
    buildSystemLogSection(vars),
    "",
    buildLogQuerySection(vars),
    "",
    buildToolsSection(),
  ].join("\n");
}

function buildPromptRenderVariables(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
): Record<string, string> {
  const normalizedWorkspace = workspaceDir.replace(/\\/g, "/");
  const dataRoot = normalizedWorkspace.includes("/moli-t/")
    ? normalizedWorkspace.slice(0, normalizedWorkspace.indexOf("/moli-t/"))
    : normalizedWorkspace;
  const memoryRoot =
    normalizedWorkspace.includes("/moli-t/")
      ? `${dataRoot}/memory`
      : `${normalizedWorkspace}/memory`;
  const memoryWorkspaceRel =
    normalizedWorkspace.includes("/moli-t/")
      ? normalizedWorkspace.slice(normalizedWorkspace.indexOf("/moli-t/") + 1)
      : "workspace";
  const globalMemoryPath = `${memoryRoot}/MEMORY.md`;
  const chatMemoryPath = `${memoryRoot}/${memoryWorkspaceRel}/${chatId}/MEMORY.md`;
  const workspaceName = workspaceDir.split("/").filter(Boolean).at(-1) ?? "moli-t";
  const chatDir = `${workspaceDir}/${chatId}`;
  const scratchDir = `${chatDir}/scratch`;
  const sessionContextFile = `${chatDir}/contexts/${sessionId}.json`;
  const workspaceEventsDir = `${workspaceDir}/events`;
  const scratchEventsDir = `${scratchDir}/data/${workspaceName}/events`;
  const globalSkillsDir = `${dataRoot}/skills`;
  const chatSkillsDir = `${chatDir}/skills`;
  const { skills, diagnostics } = loadSkillsFromWorkspace(workspaceDir, chatId);
  const availableSkills = formatSkillsForPrompt(skills);
  const skillDiagText =
    diagnostics.length > 0
      ? diagnostics.map((d) => `- ${d}`).join("\n")
      : "(none)";

  return {
    workspaceDir,
    workspaceName,
    chatId,
    sessionId,
    memory,
    chatDir,
    scratchDir,
    sessionContextFile,
    workspaceEventsDir,
    scratchEventsDir,
    globalSkillsDir,
    chatSkillsDir,
    availableSkills,
    skillDiagText,
    memoryRoot,
    dataRoot,
    memoryWorkspaceRel,
    globalMemoryPath,
    chatMemoryPath,
  };
}

function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (raw, key: string) => {
    const value = vars[key];
    return typeof value === "string" ? value : raw;
  });
}

function resolveInstructionFilePath(
  baseDir: string,
  fileName: string,
): string | null {
  const root = String(baseDir ?? "").trim();
  if (!root) return null;
  const directPath = join(root, fileName);
  if (existsSync(directPath)) return directPath;
  try {
    const matched = readdirSync(root).find((entry) => entry.toLowerCase() === fileName.toLowerCase());
    return matched ? join(root, matched) : null;
  } catch {
    return null;
  }
}

function readInstructionFile(
  baseDir: string,
  fileName: string,
): string | null {
  const filePath = resolveInstructionFilePath(baseDir, fileName);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

function buildPromptSectionsFromInstructionFiles(
  baseDir: string,
  vars: Record<string, string>,
): string[] {
  const sections: string[] = [];
  const agentsRaw = readInstructionFile(baseDir, "AGENTS.md");
  if (agentsRaw) {
    sections.push(renderPromptTemplate(agentsRaw, vars));
  }
  for (const fileName of OPTIONAL_INSTRUCTION_FILES) {
    const text = readInstructionFile(baseDir, fileName);
    if (!text) continue;
    sections.push(`\n# ${fileName}\n${renderPromptTemplate(text, vars)}`);
  }
  return sections;
}

export class TelegramMomRunner implements RunnerLike {
  private readonly agent: Agent;
  private running = false;

  constructor(
    private readonly chatId: string,
    private readonly sessionId: string,
    private readonly store: TelegramMomStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly memory: MemoryGateway,
  ) {
    const settings = this.getSettings();
    const model = resolveModel(settings, "text");
    const initialPrompt = buildSystemPrompt(
      this.store.getWorkspaceDir(),
      this.chatId,
      this.sessionId,
      "(memory will be loaded via gateway before each run)",
    );

    this.agent = new Agent({
      initialState: {
        systemPrompt: initialPrompt,
        model,
        thinkingLevel: "off",
        tools: [],
      },
      streamFn: (selectedModel, context, opts) => {
        const settingsNow = this.getSettings();
        const patchedContext = mapUnsupportedDeveloperRole(
          settingsNow,
          context,
        );
        momLog("runner", "llm_stream_start", {
          chatId: this.chatId,
          provider: selectedModel.provider,
          api: selectedModel.api,
          modelId: selectedModel.id,
          baseUrl: redactBaseUrl(selectedModel.baseUrl),
          messageCount: patchedContext.messages.length,
          hasSystemPrompt: Boolean(patchedContext.systemPrompt),
          hasTools:
            Array.isArray(patchedContext.tools) &&
            patchedContext.tools.length > 0,
        });
        return streamSimple(
          selectedModel as any,
          patchedContext as any,
          opts as any,
        );
      },
      getApiKey: async (provider: string) => {
        const settingsNow = this.getSettings();
        const selectedCustom = settingsNow.customProviders.find((p) => p.id === provider);
        let key: string | undefined;
        if (selectedCustom) {
          key = selectedCustom.apiKey?.trim() || undefined;
        } else {
          const envVar = envVarForProvider(provider);
          key = envVar ? process.env[envVar]?.trim() || undefined : undefined;
        }
        momLog("runner", "api_key_resolve", {
          chatId: this.chatId,
          provider,
          providerMode: settingsNow.providerMode,
          hasKey: Boolean(key),
          keyFingerprint: keyFingerprint(key),
          customProviderId: selectedCustom?.id
        });
        return key;
      },
    });

    const saved = this.store.loadContext(this.chatId, this.sessionId);
    if (saved.length > 0) {
      this.agent.replaceMessages(saved);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.agent.abort();
  }

  async run(ctx: MomContext): Promise<RunResult> {
    const runId =
      (ctx.message as { runId?: string }).runId ??
      `${this.chatId}-${this.sessionId}-${ctx.message.messageId}`;
    this.running = true;
    momLog("runner", "run_start", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      messageId: ctx.message.messageId,
      textLength: ctx.message.text.length,
      attachments: ctx.message.attachments.length,
      images: ctx.message.imageContents.length,
      isEvent: Boolean(ctx.message.isEvent),
    });

    const queue: Array<() => Promise<void>> = [];
    let queueRunning = false;
    const enqueue = (job: () => Promise<void>): void => {
      queue.push(job);
      if (!queueRunning) {
        void runQueue();
      }
    };

    const runQueue = async (): Promise<void> => {
      queueRunning = true;
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        try {
          await job();
        } catch {
          // ignore UI update errors
        }
      }
      queueRunning = false;
    };

    const settings = this.getSettings();
    const settingsError = validateRuntimeSettings(settings);
    if (settingsError) {
      momWarn("runner", "settings_error", {
        runId,
        chatId: this.chatId,
        settingsError,
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(settingsError);
      return { stopReason: "error", errorMessage: settingsError };
    }

    const prefersVision = Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0;
    const selectedModel = resolveModel(settings, prefersVision ? "vision" : "text");
    const selectedCustom = settings.customProviders.find((p) => p.id === selectedModel.provider);
    const resolvedKey = resolveApiKeyForModel(selectedModel, settings);
    if (!resolvedKey) {
      const keyError =
        `AI settings error: missing API key for active model provider '${selectedModel.provider}'. ` +
        "Please check current model routing and provider key configuration.";
      momWarn("runner", "active_model_missing_api_key", {
        runId,
        chatId: this.chatId,
        providerMode: settings.providerMode,
        modelProvider: selectedModel.provider,
        modelId: selectedModel.id
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(keyError);
      return { stopReason: "error", errorMessage: keyError };
    }
    this.agent.setModel(resolveModel(settings, prefersVision ? "vision" : "text"));
    momLog("runner", "model_selected", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      providerMode: settings.providerMode,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.id,
      modelApi: selectedModel.api,
      modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
      customProviderId: selectedCustom?.id,
      customProviderName: selectedCustom?.name,
      customProviderPath: selectedCustom?.path,
      customProviderComputedBaseUrl: selectedCustom
        ? redactBaseUrl(
          buildOpenAIBaseUrl(selectedCustom.baseUrl, selectedCustom.path),
        )
        : undefined,
      hasApiKey: Boolean(resolvedKey),
      apiKeyFingerprint: keyFingerprint(resolvedKey),
    });
    await this.memory.syncExternalMemories();
    const memoryText =
      (await this.memory.buildPromptContext(
        { channel: "telegram", externalUserId: this.chatId },
        ctx.message.text,
        12,
      )) || "(no working memory yet)";
    this.agent.setSystemPrompt(
      buildSystemPrompt(
        this.store.getWorkspaceDir(),
        this.chatId,
        this.sessionId,
        memoryText,
      ),
    );

    this.agent.setTools(
      createMomTools({
        cwd: this.store.getScratchDir(this.chatId),
        workspaceDir: this.store.getWorkspaceDir(),
        chatId: this.chatId,
        memory: this.memory,
        uploadFile: async (filePath, title) => {
          await ctx.uploadFile(filePath, title);
        },
      }),
    );

    let stopReason: "stop" | "aborted" | "error" = "stop";
    let errorMessage: string | undefined;

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_start") {
        const args = event.args as { label?: string };
        const label = args.label || event.toolName;
        momLog("runner", "tool_start", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          label,
        });
        enqueue(() => ctx.respond(`_→ ${label}_`, false));
      }

      if (event.type === "tool_execution_end") {
        const body = extractTextFromResult(event.result);
        const status = event.isError ? "✗" : "✓";
        momLog("runner", "tool_end", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          isError: event.isError,
          resultPreview: body.slice(0, 160),
        });
        const text = `*${status} ${event.toolName}*\n\`\`\`\n${body}\n\`\`\``;
        if (event.isError) {
          enqueue(() => ctx.respondInThread(text));
          enqueue(() => ctx.respond(`_Error: ${body.slice(0, 200)}_`, false));
        }
      }

      if (
        event.type === "message_end" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const msg = event.message as {
          stopReason?: "stop" | "aborted" | "error";
          errorMessage?: string;
          content?: Array<{ type: string; text?: string }>;
          api?: string;
          provider?: string;
          model?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            totalTokens?: number;
          };
        };
        if (msg.stopReason) stopReason = msg.stopReason;
        if (msg.errorMessage) errorMessage = msg.errorMessage;
        if (msg.errorMessage) {
          momWarn("runner", "assistant_error_message", {
            runId,
            chatId: this.chatId,
            errorMessage: msg.errorMessage,
          });
        }
        momLog("runner", "assistant_message_end", {
          runId,
          chatId: this.chatId,
          stopReason: msg.stopReason,
          api: msg.api,
          provider: msg.provider,
          model: msg.model,
          contentCount: Array.isArray(msg.content) ? msg.content.length : 0,
          usage: msg.usage,
        });

        const text = (msg.content || [])
          .filter(
            (part) => part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text as string)
          .join("\n");

        if (text.trim()) {
          momLog("runner", "assistant_text_chunk", {
            runId,
            chatId: this.chatId,
            textLength: text.length,
          });
          enqueue(() => ctx.respond(text));
        }
      }
    });

    const MAX_EMPTY_RETRIES = 2;

    try {
      await ctx.setTyping(true);
      await ctx.setWorking(true);

      const now = new Date();
      const timestamp = now.toISOString();

      let userMessage = `[${timestamp}] [${ctx.message.userName || ctx.message.userId}]: ${ctx.message.text}`;
      const nonImage = ctx.message.attachments
        .filter((a) => !a.isImage)
        .map((a) => `${ctx.workspaceDir}/${a.local}`);
      if (nonImage.length > 0) {
        userMessage += `\n\n<telegram_attachments>\n${nonImage.join("\n")}\n</telegram_attachments>`;
      }

      let finalText = "";
      let attemptCount = 0;

      while (attemptCount <= MAX_EMPTY_RETRIES) {
        if (attemptCount > 0) {
          momWarn("runner", "empty_response_retry", {
            runId,
            chatId: this.chatId,
            attempt: attemptCount,
          });
          // Brief delay before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        momLog("runner", "prompt_start", {
          runId,
          chatId: this.chatId,
          promptLength: userMessage.length,
          imageCount: ctx.message.imageContents.length,
          attempt: attemptCount,
        });
        await this.agent.prompt(
          userMessage,
          ctx.message.imageContents.length > 0
            ? ctx.message.imageContents
            : undefined,
        );
        momLog("runner", "prompt_end", {
          runId,
          chatId: this.chatId,
          stopReason,
          attempt: attemptCount,
        });

        while (queueRunning || queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        momLog("runner", "queue_flushed", { runId, chatId: this.chatId, attempt: attemptCount });

        const messages = this.agent.state.messages as AgentMessage[];
        const sessionContextFile = `${this.store.getWorkspaceDir()}/${this.chatId}/contexts/${this.sessionId}.json`;
        this.store.saveContext(this.chatId, messages, this.sessionId);
        momLog("runner", "context_saved", {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          sessionContextFile,
          messageCount: messages.length,
        });

        const lastAssistant = [...messages]
          .reverse()
          .find((item) => (item as { role?: string }).role === "assistant") as
          | { content?: Array<{ type: string; text?: string }> }
          | undefined;

        finalText = (lastAssistant?.content || [])
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join("\n")
          .trim();
        const lastAssistantContentCount = Array.isArray(lastAssistant?.content)
          ? lastAssistant.content.length
          : 0;
        momLog("runner", "final_text_evaluated", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
          lastAssistantContentCount,
          attempt: attemptCount,
        });

        // If we got a non-empty response, break out of retry loop
        if (finalText) break;

        attemptCount++;
      }

      if (finalText.startsWith("[SILENT]")) {
        momLog("runner", "final_silent", { runId, chatId: this.chatId });
        await ctx.deleteMessage();
      } else if (finalText) {
        momLog("runner", "final_replace", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
        });
        await ctx.replaceMessage(finalText);
      } else {
        const modelInfo = [
          `provider: ${selectedModel.provider}`,
          `model: ${selectedModel.id}`,
          selectedModel.baseUrl ? `baseUrl: ${redactBaseUrl(selectedModel.baseUrl)}` : null,
        ].filter(Boolean).join(", ");
        const emptyResponseMessage =
          `Model returned empty response after ${attemptCount} attempt(s). ` +
          `(${modelInfo}) — Please check baseUrl/path/model/apiKey or try another model.`;
        momWarn("runner", "final_empty_response_after_retries", {
          runId,
          chatId: this.chatId,
          totalAttempts: attemptCount,
          modelProvider: selectedModel.provider,
          modelId: selectedModel.id,
          modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
        });
        await ctx.replaceMessage(emptyResponseMessage);
        await ctx.respondInThread(
          `Empty assistant output detected after ${attemptCount} attempt(s). ` +
          `Model info — ${modelInfo}`,
        );
      }

      await ctx.setWorking(false);

      if (errorMessage) {
        momWarn("runner", "final_error", {
          runId,
          chatId: this.chatId,
          errorMessage,
        });
        await ctx.replaceMessage("Sorry, something went wrong.");
        await ctx.respondInThread(`Error: ${errorMessage}`);
      }

      momLog("runner", "run_end", {
        runId,
        chatId: this.chatId,
        stopReason,
        hasError: Boolean(errorMessage),
      });
      return { stopReason, errorMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      momError("runner", "run_exception", {
        runId,
        chatId: this.chatId,
        error: message,
      });
      try {
        await ctx.setWorking(false);
        await ctx.replaceMessage(`Run failed: ${message}`);
        await ctx.respondInThread(`Error: ${message}`);
      } catch {
        // ignore secondary UI errors
      }
      return { stopReason: "error", errorMessage: message };
    } finally {
      unsubscribe();
      this.running = false;
    }
  }
}

export class RunnerPool {
  private readonly map = new Map<string, TelegramMomRunner>();

  constructor(
    private readonly store: TelegramMomStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly memory: MemoryGateway,
  ) { }

  private key(chatId: string, sessionId: string): string {
    return `${chatId}::${sessionId}`;
  }

  get(chatId: string, sessionId: string): TelegramMomRunner {
    const key = this.key(chatId, sessionId);
    const existing = this.map.get(key);
    if (existing) return existing;
    const runner = new TelegramMomRunner(
      chatId,
      sessionId,
      this.store,
      this.getSettings,
      this.memory,
    );
    this.map.set(key, runner);
    return runner;
  }

  reset(chatId: string, sessionId: string): void {
    this.map.delete(this.key(chatId, sessionId));
  }
}

export function readBotUsernameFromMemory(workspaceDir: string): string | null {
  const path = join(workspaceDir, "BOT_USERNAME.txt");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
