import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import defaultAgentsTemplate from "./prompts/AGENTS.template.md?raw";
import {
  AGENT_PROFILE_FILES,
  BOT_PROFILE_FILES,
  getAgentDir
} from "./profiles.js";
import {
  buildPromptChannelSections,
  type PromptChannel,
} from "./prompt-channel.js";
import { formatSkillsForPrompt, loadSkillsFromWorkspace } from "./skills.js";
import type { RuntimeSettings } from "../settings/index.js";
import {
  resolveDataRootFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath,
  resolveWorkspaceRelativeFromWorkspacePath
} from "./workspace.js";

const DEFAULT_AGENTS_TEMPLATE = defaultAgentsTemplate;

const OPTIONAL_INSTRUCTION_FILES = [
  "SOUL.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
  "SONG.md"
] as const;

type PromptRenderVars = Record<string, string>;

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

function buildContextSection(vars: PromptRenderVars): string {
  return section("Context", [
    `- Server timezone: ${vars.timezone} — always include this timezone offset when computing event timestamps.`,
    "- For the exact current time, run: date",
    "- You have access to previous conversation context including tool results from prior turns.",
    `- For older history beyond your context, search ${vars.chatDir}/log.jsonl (contains user messages and your final responses, but not tool results).`,
  ]);
}

function buildEnvironmentSection(vars: PromptRenderVars): string {
  return section("Environment", [
    "You are running directly on the host machine.",
    `- Bash working directory for tools: ${vars.scratchDir}`,
    "- Be careful with system modifications",
    `- When writing files in scratch, use relative paths from scratch (do not prepend ${vars.scratchDir} again)`,
    `- Active bot runtime root: ${vars.workspaceDir}`,
    `- Global skills directory (canonical): ${vars.globalSkillsDir}`,
    `- Bot-level skills directory (bot-scoped): ${vars.botSkillsDir}`,
    `- Chat-local skills directory (session-specific): ${vars.chatSkillsDir}`,
    `- Never assume directories like /workspace or /workspace/testbed exist. Always use the exact absolute paths provided in this prompt.`,
    `- For reusable/general-purpose skills (web browsing, search, API wrappers, utilities), install under ${vars.globalSkillsDir}.`,
    `- For this bot's dedicated skills, install under ${vars.botSkillsDir}.`,
    `- For chat/session-specific one-off skills only, install under ${vars.chatSkillsDir}.`,
    `- Never install reusable skills under ${vars.workspaceDir} or ${vars.chatDir}; keep reusable skills in ${vars.globalSkillsDir}.`,
    `- Never create skills via relative path like data/${vars.workspaceName}/skills from scratch; it creates nested duplicate directories.`,
  ]);
}

function buildSafetySection(): string {
  return section("Runtime Safety & Truthfulness", [
    "- Do not claim an action succeeded unless it actually happened.",
    "- Do not claim a reminder is scheduled unless the event file was created successfully.",
    "- Do not invent file contents, tool outputs, or runtime state.",
    "- Do not claim a skill was used unless you actually read its SKILL.md and executed its scripts.",
    "- If instructions conflict with runtime constraints, explain the constraint and take the best valid fallback.",
  ]);
}

function buildFailureRecoverySection(): string {
  return section("Failure Recovery Protocol (Mandatory)", [
    '- Never stop at "I cannot do this". Continue with the best available recovery path.',
    "- If audio/image/tool/model/config fails:",
    "  1. State root cause in one sentence.",
    "  2. Propose the next executable fallback you can do now.",
    "  3. Provide exact fields user should adjust (provider/baseUrl/path/model/apiKey/route key).",
    "  4. Continue task with available inputs instead of ending the conversation.",
    "- For voice messages without transcript:",
    "  - Ask for a short text summary and offer concrete next steps.",
    "  - Do not end with a generic capability disclaimer only.",
    "- Do not ask the user to provide API keys/config files unless runtime explicitly reports a missing key/config.",
    '- Treat provider/key/path status as runtime-owned; avoid inventing "missing config file" diagnoses.',
    "- If input includes a [voice transcript] section, treat it as already-transcribed text.",
    '- In that case, never claim "cannot transcribe/play audio" and proceed with normal text reasoning.',
    "- If input includes a [image analysis #N: ...] section, treat it as already-processed image understanding.",
    '- In that case, never claim "cannot view/see the image" and proceed with normal reasoning based on that analysis.',
  ]);
}

function buildWorkspaceLayoutSection(vars: PromptRenderVars): string {
  return section("Bot Runtime Layout", [
    `${vars.workspaceDir}/`,
    "├── (bot runtime files, sessions, logs, skills, events)",
    "├── SYSTEM.md                    # Environment setup log",
    "├── skills/                      # Bot-scoped CLI skills for this bot",
    "├── events/                      # Bot-level events",
    `└── ${vars.chatId}/                   # This chat`,
    "    ├── log.jsonl                # Message history (no tool results)",
    "    ├── contexts/",
    `    │   └── ${vars.sessionId}.jsonl   # Active session entry log`,
    "    ├── attachments/             # User-shared files",
    "    └── scratch/                 # Tool working directory",
    "        └── events/              # Chat-local watched events",
  ]);
}

function buildSkillsProtocolSection(vars: PromptRenderVars): string {
  return [
    "## Skills (Custom CLI Tools)",
    "You can create reusable CLI tools for recurring tasks (APIs, data processing, automation, etc.).",
    "",
    "### Creating Skills",
    `Store reusable skills in \`${vars.globalSkillsDir}/<name>/\`.`,
    `Store bot-scoped skills in \`${vars.botSkillsDir}/<name>/\`.`,
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
    "### Skill usage protocol",
    "- Before replying, scan available skill names/descriptions and decide whether one clearly applies.",
    "- If exactly one skill clearly applies, read its SKILL.md and follow it.",
    "- If none clearly apply, do not read skills speculatively.",
    "- Before using any skill, read its SKILL.md in full.",
    "- Follow instructions in SKILL.md exactly.",
    "- Resolve relative paths against the skill directory.",
    "- Prefer invoking skill scripts via `bash` tool.",
    "- If two skills overlap, pick the one with the clearest description match.",
  ].join("\n");
}

function buildSkillsRuntimeStateSection(vars: PromptRenderVars): string {
  return [
    "## Available Skills",
    vars.availableSkills,
    "",
    "## Skill Diagnostics",
    vars.skillDiagText,
  ].join("\n");
}

function buildEventsSection(vars: PromptRenderVars): string {
  return [
    "## Events",
    "Use the `create_event` tool to schedule messages. Never write event JSON files manually via bash or write tool.",
    "",
    "### Event Types",
    "- `one-shot`: fires once at a specific datetime (for reminders). Requires `at` as ISO-8601 with timezone offset.",
    "- `periodic`: fires on a cron schedule. Requires `schedule` (5 fields) and optionally `timezone`.",
    "- `immediate`: fires as soon as it is created.",
    "",
    "### Event Delivery Mode",
    '- `delivery: "text"`: send `text` directly to the user (literal delivery). Use for plain reminders.',
    '- `delivery: "agent"`: run AI with `text` as the task instruction. Use for recurring summaries or actions.',
    '- Defaults: `one-shot`/`immediate` → `"text"`, `periodic` → `"agent"`.',
    "",
    "### Cron Format (`schedule` field)",
    "`minute hour day-of-month month day-of-week`",
    "- `0 9 * * *` = daily at 9:00",
    "- `0 9 * * 1-5` = weekdays at 9:00",
    "- `30 14 * * 1` = Mondays at 14:30",
    "",
    "### Time Rules",
    '- Any "N minutes/hours later" or "remind me at" request MUST use `create_event` with `type: one-shot`.',
    '- Any recurring request ("every day", "every weekday", "each morning") MUST use `create_event` with `type: periodic`.',
    "- NEVER implement delays via shell `sleep`, `crontab`, `at`, `launchctl`, or memory.",
    '- `at` must be a future ISO-8601 timestamp with timezone offset. If `create_event` rejects with "at must be in the future", recompute and retry.',
    "- When `create_event` succeeds, the tool will return the exact confirmation text. You MUST reply to the user using EXACTLY that text without any modifications, translations, or summaries.",
    "- If `create_event` fails, say scheduling failed. Do not claim the reminder is set.",
    "",
    "### Managing Events",
    `- List: \`ls ${vars.workspaceEventsDir}/\``,
    `- View: \`cat ${vars.workspaceEventsDir}/foo.json\``,
    "- Update periodic: call `create_event` again with the same `schedule` + `timezone`; runtime will update the existing task instead of creating a duplicate.",
    `- Cancel: \`rm ${vars.workspaceEventsDir}/foo.json\``,
    "",
    "### Event lifecycle",
    "- one-shot/immediate files are retained after execution with updated status (state/completedAt/runCount/reason).",
    "- periodic files persist until manually deleted.",
    "",
    "### Silent completion",
    "For periodic events with nothing actionable, respond with exactly `[SILENT]`.",
    "",
    "### Debouncing",
    "When automations may emit many immediate events, debounce and summarize into one event rather than flooding.",
  ].join("\n");
}

function buildMemoryContractSection(vars: PromptRenderVars): string {
  return [
    "## Memory",
    "Write to MEMORY.md files to persist context across conversations.",
    `- Global (${vars.globalMemoryPath}): skills, preferences, project info`,
    `- Chat (${vars.chatMemoryPath}): chat-specific decisions and ongoing work`,
    `- IMPORTANT: Do not store memory files directly under ${vars.workspaceDir} or ${vars.chatDir}; always use the memory root path above.`,
    "- Never read/write/edit MEMORY.md directly with file tools. Always use the memory tool (or gateway API) for memory operations.",
  ].join("\n");
}

function buildCurrentMemorySection(vars: PromptRenderVars): string {
  return ["## Current Memory", vars.memory].join("\n");
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
    "- load_mcp: List/load/unload MCP servers for this chat session. If required MCP is missing, this tool will return a clear error.",
    "- bash: Execute shell commands in scratch (primary execution tool)",
    "- read: Read files",
    "- write: Create/overwrite files",
    "- edit: Surgical file edits",
    "- create_event: Schedule events/reminders. Always use this instead of writing event JSON files manually.",
    "- attach: Send a local file through the active channel adapter (use only when direct text delivery is insufficient)",
    "- `TOOLS.md` is guidance about conventions and paths; it does not control actual tool availability.",
  ].join("\n");
}

function buildMcpAccessSection(settings?: RuntimeSettings): string {
  const servers = (settings?.mcpServers ?? []).filter((server) => server.enabled);
  const serverList =
    servers.length > 0
      ? servers.map((server) => `- ${server.id} (${server.transport})`).join("\n")
      : "(none)";
  return [
    "## MCP Access",
    "- MCP capability exists but is hidden unless you explicitly invoke a skill (`$skill-name`, `/skill skill-name`, `skill:skill-name`, `技能:skill-name`).",
    "- Skill files do not require any special MCP frontmatter fields.",
    "- If a task requires MCP but the required MCP server/tool is unavailable, clearly report the missing MCP server/tool in your response.",
    "- Enabled MCP servers:",
    serverList
  ].join("\n");
}

function buildBaseSystemPrompt(vars: PromptRenderVars): string {
  return buildBaseSystemPromptWithOptions(vars);
}

interface PromptBuildOptions {
  channel?: PromptChannel;
  settings?: RuntimeSettings;
}

function buildBaseSystemPromptWithOptions(
  vars: PromptRenderVars,
  options?: PromptBuildOptions,
): string {
  const channelSections = options?.channel
    ? buildPromptChannelSections(options.channel)
    : [];
  return [
    "You are an assistant operating through the active channel runtime.",
    "",
    buildContextSection(vars),
    "",
    buildEnvironmentSection(vars),
    "",
    buildSafetySection(),
    "",
    buildFailureRecoverySection(),
    "",
    buildWorkspaceLayoutSection(vars),
    "",
    buildEventsSection(vars),
    "",
    buildMemoryContractSection(vars),
    "",
    buildSystemLogSection(vars),
    "",
    buildLogQuerySection(vars),
    "",
    buildToolsSection(),
    "",
    buildMcpAccessSection(options?.settings),
    ...(channelSections.length > 0 ? ["", ...channelSections] : []),
    "",
    buildSkillsProtocolSection(vars),
    "",
    buildSkillsRuntimeStateSection(vars),
    "",
    buildCurrentMemorySection(vars),
  ].join("\n");
}

function buildPromptRenderVariables(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
  timezone: string,
  settings?: RuntimeSettings,
): PromptRenderVars {
  const dataRoot = resolveDataRootFromWorkspacePath(workspaceDir);
  const memoryRoot = resolveMemoryRootFromWorkspacePath(workspaceDir);
  const memoryWorkspaceRel = resolveWorkspaceRelativeFromWorkspacePath(workspaceDir);
  const globalMemoryPath = `${memoryRoot}/MEMORY.md`;
  const chatMemoryPath = `${memoryRoot}/${memoryWorkspaceRel}/${chatId}/MEMORY.md`;
  const workspaceName =
    memoryWorkspaceRel || (workspaceDir.split("/").filter(Boolean).at(-1) ?? "bot-root");
  const chatDir = `${workspaceDir}/${chatId}`;
  const scratchDir = `${chatDir}/scratch`;
  const chatScratchEventsDir = `${scratchDir}/events`;
  const sessionContextFile = `${chatDir}/contexts/${sessionId}.jsonl`;
  const workspaceEventsDir = `${workspaceDir}/events`;
  const globalSkillsDir = `${dataRoot}/skills`;
  const botSkillsDir = `${workspaceDir}/skills`;
  const chatSkillsDir = `${chatDir}/skills`;
  const { skills, diagnostics } = loadSkillsFromWorkspace(workspaceDir, chatId, {
    disabledSkillPaths: settings?.disabledSkillPaths ?? []
  });
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
    chatScratchEventsDir,
    sessionContextFile,
    workspaceEventsDir,
    globalSkillsDir,
    botSkillsDir,
    chatSkillsDir,
    availableSkills,
    skillDiagText,
    memoryRoot,
    dataRoot,
    memoryWorkspaceRel,
    globalMemoryPath,
    chatMemoryPath,
    timezone,
  };
}

function renderPromptTemplate(
  template: string,
  vars: PromptRenderVars,
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
    const matched = readdirSync(root).find(
      (entry) => entry.toLowerCase() === fileName.toLowerCase(),
    );
    return matched ? join(root, matched) : null;
  } catch {
    return null;
  }
}

function readInstructionFile(baseDir: string, fileName: string): string | null {
  const filePath = resolveInstructionFilePath(baseDir, fileName);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, "utf8")
      .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
      .trim();
    return content || null;
  } catch {
    return null;
  }
}

function buildPromptSectionsFromInstructionFiles(
  baseDir: string,
  vars: PromptRenderVars,
  files?: readonly string[],
): Map<string, string> {
  const sections = new Map<string, string>();
  const orderedFiles = files ?? ["AGENTS.md", ...OPTIONAL_INSTRUCTION_FILES];
  for (const fileName of orderedFiles) {
    const text = readInstructionFile(baseDir, fileName);
    if (!text) continue;
    if (fileName === "AGENTS.md") {
      sections.set(fileName, renderPromptTemplate(text, vars));
      continue;
    }
    sections.set(fileName, `\n# ${fileName}\n${renderPromptTemplate(text, vars)}`);
  }
  return sections;
}

function mergePromptSectionMaps(
  ...maps: Array<Map<string, string>>
): string[] {
  const orderedFiles = ["AGENTS.md", ...OPTIONAL_INSTRUCTION_FILES];
  const merged = new Map<string, string>();

  for (const fileName of orderedFiles) {
    for (const map of maps) {
      const value = map.get(fileName);
      if (value) {
        merged.set(fileName, value);
        break;
      }
    }
  }

  return orderedFiles
    .map((fileName) => merged.get(fileName))
    .filter((value): value is string => Boolean(value));
}

function resolveAgentIdForWorkspace(
  workspaceDir: string,
  settings: RuntimeSettings | undefined,
  channel: PromptChannel | undefined
): string {
  if (!settings || !channel) return "";
  const botId = basename(resolve(workspaceDir));
  const instances = settings.channels?.[channel]?.instances ?? [];
  return instances.find((instance) => instance.id === botId)?.agentId?.trim() ?? "";
}

export function buildSystemPrompt(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
  options?: PromptBuildOptions & { timezone?: string },
): string {
  const timezone =
    options?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const renderVars = buildPromptRenderVariables(
    workspaceDir,
    chatId,
    sessionId,
    memory,
    timezone,
    options?.settings,
  );
  const sections = [buildBaseSystemPromptWithOptions(renderVars, options)];
  const globalSections = buildPromptSectionsFromInstructionFiles(
    renderVars.dataRoot,
    renderVars,
  );
  const agentId = resolveAgentIdForWorkspace(workspaceDir, options?.settings, options?.channel);
  const agentSections = agentId
    ? buildPromptSectionsFromInstructionFiles(
      getAgentDir(agentId),
      renderVars,
      AGENT_PROFILE_FILES
    )
    : new Map<string, string>();
  const botSections =
    renderVars.dataRoot === workspaceDir
      ? new Map<string, string>()
      : buildPromptSectionsFromInstructionFiles(workspaceDir, renderVars, BOT_PROFILE_FILES);
  const resolvedSections = mergePromptSectionMaps(
    botSections,
    agentSections,
    globalSections
  );

  if (resolvedSections.length > 0) {
    sections.push(...resolvedSections);
  }

  if (resolvedSections.length === 0) {
    sections.push(renderPromptTemplate(DEFAULT_AGENTS_TEMPLATE, renderVars));
  }
  return sections.join("\n\n").trim();
}

export function buildSystemPromptPreview(
  workspaceDir: string,
  chatId: string,
  sessionId: string,
  memory: string,
  options?: PromptBuildOptions & { timezone?: string },
): string {
  return buildSystemPrompt(workspaceDir, chatId, sessionId, memory, options);
}

export function getSystemPromptSources(
  workspaceDir: string,
  options?: PromptBuildOptions
): {
  global: string[];
  agent: string[];
  bot: string[];
} {
  const dataRoot = resolveDataRootFromWorkspacePath(workspaceDir);
  const collect = (baseDir: string, files?: readonly string[]): string[] => {
    const out: string[] = [];
    const orderedFiles = files ?? ["AGENTS.md", ...OPTIONAL_INSTRUCTION_FILES];
    for (const fileName of orderedFiles) {
      const filePath = resolveInstructionFilePath(baseDir, fileName);
      if (filePath) out.push(filePath);
    }
    return out;
  };
  const agentId = resolveAgentIdForWorkspace(workspaceDir, options?.settings, options?.channel);
  return {
    global: collect(dataRoot),
    agent: agentId ? collect(getAgentDir(agentId), AGENT_PROFILE_FILES) : [],
    bot: dataRoot === workspaceDir ? [] : collect(workspaceDir, BOT_PROFILE_FILES),
  };
}
