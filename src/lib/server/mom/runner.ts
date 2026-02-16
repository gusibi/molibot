import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModels, streamSimple, type Model } from "@mariozechner/pi-ai";
import type { RuntimeSettings, CustomProviderConfig } from "../config.js";
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

function getProviderModel(provider: CustomProviderConfig): string {
  const selected = provider.defaultModel?.trim();
  if (selected && provider.models.includes(selected)) return selected;
  return provider.models[0]?.trim() || "";
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

function resolveModel(settings: RuntimeSettings): Model<any> {
  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? getProviderModel(selected) : "";
    if (selected?.baseUrl && modelId) {
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
  }

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
  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    if (selected && model.provider === selected.id) {
      return selected.apiKey?.trim() || undefined;
    }
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
  if (settings.providerMode !== "custom") return context;
  const selected = getSelectedCustomProvider(settings);
  if (!selected) return context;
  const roles = Array.isArray(selected.supportedRoles)
    ? selected.supportedRoles
    : [];
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
  const chatDir = `${workspaceDir}/${chatId}`;
  const scratchDir = `${chatDir}/scratch`;
  const sessionContextFile = `${chatDir}/contexts/${sessionId}.json`;
  const workspaceEventsDir = `${workspaceDir}/events`;
  const scratchEventsDir = `${scratchDir}/data/telegram-mom/events`;
  const skillsDir = `${workspaceDir}/skills`;
  const { skills, diagnostics } = loadSkillsFromWorkspace(workspaceDir);
  const availableSkills = formatSkillsForPrompt(skills);
  const skillDiagText =
    diagnostics.length > 0
      ? diagnostics.map((d) => `- ${d}`).join("\n")
      : "(none)";

  return `You are moli, a Telegram bot assistant. Be concise. No emojis.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search ${chatDir}/log.jsonl (contains user messages and your final responses, but not tool results).

## Telegram Formatting (Markdown, not HTML)
Bold: *text*, Italic: _text_, Code: \`code\`, Block: \`\`\`code\`\`\`
Do NOT use HTML formatting.

## Environment
You are running directly on the host machine.
- Bash working directory for tools: ${scratchDir}
- Be careful with system modifications
- When writing files in scratch, use relative paths from scratch (do not prepend data/telegram-mom/${chatId}/scratch again)
- Global workspace root: ${workspaceDir}
- Global skills directory (canonical): ${skillsDir}
- For skill installation/updates, always use absolute paths under ${skillsDir}.
- Never create skills via relative path like data/telegram-mom/skills from scratch; it creates nested duplicate directories.

## Telegram Response Rules
- Keep the main reply concise and user-facing.
- Only send tool/error details in thread replies when something fails.
- If periodic checks have nothing actionable, reply exactly [SILENT].
- Prefer normal text replies. Do not send files unless necessary.
- If content fits Telegram message limits, send text directly instead of attachments.
- If sending a text file, file extension must be .txt, .md, or .html.
- Do not send text attachments as .json/.log/.csv/.yaml or other extensions.
- Do not promise a reminder is scheduled unless the event file is actually created.
- When a reminder/event is created, include scheduled time and filename.
- Do not claim a skill was used unless you actually read its SKILL.md and executed its scripts.

## Workspace Layout
${workspaceDir}/
├── MEMORY.md                    # Global memory (all chats)
├── SYSTEM.md                    # Environment setup log
├── skills/                      # Global CLI tools you create
├── events/                      # Workspace-level events
└── ${chatId}/                   # This chat
    ├── MEMORY.md                # Chat-specific memory
    ├── log.jsonl                # Message history (no tool results)
    ├── contexts/
    │   └── ${sessionId}.json    # Active session context
    ├── attachments/             # User-shared files
    └── scratch/                 # Tool working directory
        └── data/telegram-mom/events/   # Chat-local watched events

## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks (APIs, data processing, automation, etc.).

### Creating Skills
Store in absolute path \`${skillsDir}/<name>/\` only.
Each skill directory needs a \`SKILL.md\` with YAML frontmatter:

\`\`\`markdown
---
name: skill-name
description: Short description of what this skill does
---

# Skill Name

Usage instructions, examples, etc.
Scripts are in: {baseDir}/
\`\`\`

\`name\` and \`description\` are required. Use \`{baseDir}\` as placeholder for the skill directory path.

### Available Skills
${availableSkills}

### Skill usage protocol
- Before using any skill, read its SKILL.md in full.
- Follow instructions in SKILL.md exactly.
- Resolve relative paths against the skill directory.
- Prefer invoking skill scripts via \`bash\` tool.
- If two skills overlap, pick the one with the clearest description match.

### Skill diagnostics
${skillDiagText}

## Events
You can schedule events via JSON files in watched directories:
- Workspace events: ${workspaceEventsDir}/*.json
- Chat scratch events: ${scratchEventsDir}/*.json

### Event Types
Immediate - Triggers as soon as watcher sees the file.
\`\`\`json
{"type":"immediate","chatId":"${chatId}","text":"New activity detected"}
\`\`\`

One-shot - Triggers once at a specific time (for reminders).
\`\`\`json
{"type":"one-shot","chatId":"${chatId}","text":"Remind me to drink water","at":"2026-03-01T09:00:00+08:00"}
\`\`\`

Periodic - Triggers on a cron schedule.
\`\`\`json
{"type":"periodic","chatId":"${chatId}","text":"Daily check-in","schedule":"0 9 * * 1-5","timezone":"Asia/Shanghai"}
\`\`\`

### Cron Format
\`minute hour day-of-month month day-of-week\`
- \`0 9 * * *\` = daily at 9:00
- \`0 9 * * 1-5\` = weekdays at 9:00
- \`30 14 * * 1\` = Mondays at 14:30
- \`0 0 1 * *\` = first day of month at midnight

### Time Rules
- Any "N minutes later / later / remind me at" task MUST be implemented by writing a one-shot event file.
- NEVER implement delayed tasks by running long wait commands in shell (sleep/timeout/wait/ping loops).
- One-shot event field "at" must be an absolute ISO-8601 timestamp in the future and include timezone offset.
- Before writing one-shot events, compute and verify target time from current time (must be later than now).
- Do not write reminder/event files to /tmp or other external directories; use watched events directories only.
- Reminder files must be valid JSON event objects, not plain text lines.

### Creating Events
Use unique filenames to avoid overwriting:
\`\`\`bash
cat > ${workspaceEventsDir}/reminder-$(date +%s).json << 'EOF'
{"type":"one-shot","chatId":"${chatId}","text":"Reminder text","at":"2026-03-01T09:00:00+08:00"}
EOF
\`\`\`

### Managing Events
- List: \`ls ${workspaceEventsDir}/\`
- View: \`cat ${workspaceEventsDir}/foo.json\`
- Cancel: \`rm ${workspaceEventsDir}/foo.json\`

### Event lifecycle
- one-shot/immediate files are retained after execution and updated with status (state/completedAt/runCount/reason).
- periodic files persist until manually deleted.

### Silent completion
For periodic events with nothing actionable, respond with exactly \`[SILENT]\`.

### Debouncing
When automations may emit many immediate events, debounce and summarize into one event rather than flooding.

## Memory
Write to MEMORY.md files to persist context across conversations.
- Global (${workspaceDir}/MEMORY.md): skills, preferences, project info
- Chat (${chatDir}/MEMORY.md): chat-specific decisions and ongoing work

### Current Memory
${memory}

## System Configuration Log
Maintain ${workspaceDir}/SYSTEM.md for environment-level changes:
- installed packages
- credentials/config changes
- global runtime setup steps

Update this file whenever environment setup changes.

## Log Queries (for older history)
\`\`\`bash
# Recent chat messages
tail -30 ${chatDir}/log.jsonl

# Search specific topic
grep -i "topic" ${chatDir}/log.jsonl
\`\`\`

## Tools
- bash: Execute shell commands in scratch (primary execution tool)
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits
- attach: Send a local file to Telegram (use only when text message is insufficient)
`;
}

export class TelegramMomRunner implements RunnerLike {
  private readonly agent: Agent;
  private running = false;

  constructor(
    private readonly chatId: string,
    private readonly sessionId: string,
    private readonly store: TelegramMomStore,
    private readonly getSettings: () => RuntimeSettings,
  ) {
    const settings = this.getSettings();
    const model = resolveModel(settings);
    const initialPrompt = buildSystemPrompt(
      this.store.getWorkspaceDir(),
      this.chatId,
      this.sessionId,
      this.store.readMemory(this.chatId),
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
        const modelNow = resolveModel(settingsNow);
        const selectedCustom =
          settingsNow.providerMode === "custom"
            ? getSelectedCustomProvider(settingsNow)
            : undefined;
        if (modelNow.provider !== provider) {
          momWarn("runner", "api_key_provider_mismatch", {
            chatId: this.chatId,
            requestedProvider: provider,
            modelProvider: modelNow.provider,
          });
          return undefined;
        }
        const key = resolveApiKeyForModel(modelNow, settingsNow);
        momLog("runner", "api_key_resolve", {
          chatId: this.chatId,
          provider,
          providerMode: settingsNow.providerMode,
          hasKey: Boolean(key),
          keyFingerprint: keyFingerprint(key),
          customProviderId: selectedCustom?.id,
          customProviderName: selectedCustom?.name,
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

    const selectedModel = resolveModel(settings);
    const selectedCustom =
      settings.providerMode === "custom"
        ? getSelectedCustomProvider(settings)
        : undefined;
    const resolvedKey = resolveApiKeyForModel(selectedModel, settings);
    this.agent.setModel(resolveModel(settings));
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
    this.agent.setSystemPrompt(
      buildSystemPrompt(
        this.store.getWorkspaceDir(),
        this.chatId,
        this.sessionId,
        this.store.readMemory(this.chatId),
      ),
    );

    this.agent.setTools(
      createMomTools({
        cwd: this.store.getScratchDir(this.chatId),
        workspaceDir: this.store.getWorkspaceDir(),
        chatId: this.chatId,
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

      momLog("runner", "prompt_start", {
        runId,
        chatId: this.chatId,
        promptLength: userMessage.length,
        imageCount: ctx.message.imageContents.length,
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
      });

      while (queueRunning || queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      momLog("runner", "queue_flushed", { runId, chatId: this.chatId });

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

      const finalText = (lastAssistant?.content || [])
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
      });

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
        const emptyResponseMessage =
          "Model returned empty response. Please check custom provider baseUrl/path/model/apiKey or try another model.";
        momWarn("runner", "final_empty_response", {
          runId,
          chatId: this.chatId,
        });
        await ctx.replaceMessage(emptyResponseMessage);
        await ctx.respondInThread(
          "Empty assistant output detected (no text content).",
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
  ) {}

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
