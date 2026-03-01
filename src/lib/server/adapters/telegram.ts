import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Bot, InputFile } from "grammy";
import type { RuntimeSettings } from "../config.js";
import { config } from "../config.js";
import { EventsWatcher, type MomEvent, type EventDeliveryMode } from "../mom/events.js";
import { createRunId, momError, momLog, momWarn } from "../mom/log.js";
import { buildPromptChannelSections } from "../mom/prompt-channel.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "../mom/prompt.js";
import { RunnerPool } from "../mom/runner.js";
import { loadSkillsFromWorkspace } from "../mom/skills.js";
import { TelegramMomStore } from "../mom/store.js";
import type { MomContext, TelegramInboundEvent } from "../mom/types.js";
import { SessionStore } from "../services/sessionStore.js";
import type { MemoryGateway } from "../memory/gateway.js";

export interface TelegramConfig {
  token: string;
  allowedChatIds: string[];
}

class ChannelQueue {
  private readonly queue: Array<() => Promise<void>> = [];
  private processing = false;

  enqueue(job: () => Promise<void>): void {
    this.queue.push(job);
    void this.run();
  }

  size(): number {
    return this.queue.length;
  }

  private async run(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      try {
        await job();
      } catch (error) {
        momError("telegram", "queue_job_failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    this.processing = false;
  }
}

interface StatusSession {
  statusMessageId: number | null;
  threadMessageIds: number[];
  accumulatedText: string;
  isWorking: boolean;
}

interface ModelOption {
  key: string;
  label: string;
  patch: Partial<RuntimeSettings>;
}

type ModelRoute = "text" | "vision" | "stt" | "tts";

interface SttTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
}

interface TranscriptionResult {
  text: string | null;
  errorMessage: string | null;
}

interface ParsedRelativeReminder {
  delayMs: number;
  reminderText: string;
  sourceText: string;
}

export class TelegramManager {
  private static readonly TELEGRAM_TEXT_SOFT_LIMIT = 3800;
  private static readonly CHAT_EVENTS_RELATIVE_DIR = ["events"] as const;
  private static readonly LEGACY_CHAT_EVENTS_RELATIVE_DIRS = [
    ["data", "moli-t", "events"],
    ["data", "molipi_bot", "events"],
    ["data", "telegram-mom", "events"]
  ] as const;
  private readonly workspaceDir: string;
  private readonly store: TelegramMomStore;
  private readonly sessions: SessionStore;
  private readonly runners: RunnerPool;
  private readonly memory: MemoryGateway;
  private readonly instanceId: string;
  private bot: Bot | undefined;
  private currentToken = "";
  private currentAllowedChatIdsKey = "";
  private botUsername = "";
  private readonly chatQueues = new Map<string, ChannelQueue>();
  private readonly running = new Set<string>();
  private readonly events: EventsWatcher[] = [];
  private readonly watchedChatEventDirs = new Set<string>();


  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private escapeHtmlAttr(value: string): string {
    return this.escapeHtml(value).replace(/"/g, "&quot;");
  }

  private markdownToTelegramHtml(input: string): string {
    const normalized = input.replace(/\r\n?/g, "\n");
    const tokens: string[] = [];
    const saveToken = (content: string): string => {
      const idx = tokens.push(content) - 1;
      return `\u0000${idx}\u0000`;
    };

    let out = normalized;

    out = out.replace(/```(?:[^\n`]*)\n([\s\S]*?)```/g, (_m, code: string) =>
      saveToken(`<pre><code>${this.escapeHtml(code.replace(/\n$/, ""))}</code></pre>`)
    );

    out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
      saveToken(`<code>${this.escapeHtml(code)}</code>`)
    );

    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
      saveToken(`<a href="${this.escapeHtmlAttr(url)}">${this.escapeHtml(label)}</a>`)
    );

    out = this.escapeHtml(out);

    out = out.replace(/^\s*#{1,6}\s+(.+)$/gm, "<b>$1</b>");
    out = out.replace(/^\s*[-*]\s+/gm, "• ");
    out = out.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<b>$1</b>");
    out = out.replace(/(^|[^\w])_([^_\n][^_\n]*?)_/g, "$1<i>$2</i>");
    out = out.replace(/(^|[^\*])\*([^*\n][^*\n]*?)\*/g, "$1<i>$2</i>");
    out = out.replace(/~~([^~\n][^~\n]*?)~~/g, "<s>$1</s>");

    out = out.replace(/\u0000(\d+)\u0000/g, (_m, rawIdx: string) => tokens[Number(rawIdx)] ?? "");
    return out;
  }

  private formatTelegramText(text: string): { text: string; parseMode?: "HTML" } {
    const normalized = text.replace(/\r\n?/g, "\n");
    const looksLikeMarkdown =
      /```|`|\*\*|~~|\[[^\]]+\]\(https?:\/\/|^\s*#{1,6}\s+/m.test(normalized) ||
      /(^|[^\*])\*[^*\n][^*\n]*\*/.test(normalized) ||
      /(^|[^\w])_[^_\n][^_\n]*_/.test(normalized);

    if (!looksLikeMarkdown) {
      return { text: normalized };
    }

    return { text: this.markdownToTelegramHtml(normalized), parseMode: "HTML" };
  }

  private async sendText(
    bot: Bot,
    chatId: string,
    text: string,
    options?: Record<string, unknown>
  ): Promise<{ message_id: number }> {
    const payload = this.formatTelegramText(text);
    try {
      const sendOptions = payload.parseMode
        ? { ...(options ?? {}), parse_mode: payload.parseMode }
        : { ...(options ?? {}) };
      return (await bot.api.sendMessage(chatId, payload.text, sendOptions as never)) as { message_id: number };
    } catch (error) {
      if (payload.parseMode) {
        momWarn("telegram", "send_message_parse_fallback_plain", {
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
        return (await bot.api.sendMessage(chatId, text, (options ?? {}) as never)) as { message_id: number };
      }
      throw error;
    }
  }

  private async editText(bot: Bot, chatId: string, messageId: number, text: string): Promise<void> {
    const payload = this.formatTelegramText(text);
    try {
      if (payload.parseMode) {
        await bot.api.editMessageText(chatId, messageId, payload.text, { parse_mode: payload.parseMode } as never);
        return;
      }
      await bot.api.editMessageText(chatId, messageId, payload.text);
    } catch (error) {
      if (payload.parseMode) {
        momWarn("telegram", "edit_message_parse_fallback_plain", {
          chatId,
          messageId,
          error: error instanceof Error ? error.message : String(error)
        });
        await bot.api.editMessageText(chatId, messageId, text);
        return;
      }
      throw error;
    }
  }

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore?: SessionStore,
    options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway }
  ) {
    this.workspaceDir = options?.workspaceDir ?? resolve(config.dataDir, "moli-t");
    this.instanceId = options?.instanceId ?? "default";
    this.store = new TelegramMomStore(this.workspaceDir);
    this.sessions = sessionStore ?? new SessionStore();
    if (!options?.memory) {
      throw new Error("TelegramManager requires MemoryGateway for unified memory operations.");
    }
    this.memory = options.memory;
    this.runners = new RunnerPool(this.store, this.getSettings, options.memory);
  }

  private async writePromptPreview(allowedChatIds: string[]): Promise<void> {
    const chatId = allowedChatIds[0] ?? "__preview__";
    const sessionId = allowedChatIds[0] ? this.store.getActiveSession(chatId) : "default";
    const memoryText = allowedChatIds[0]
      ? ((await this.memory.buildPromptContext(
        { channel: "telegram", externalUserId: chatId },
        "",
        12,
      )) || "(no working memory yet)")
      : "(no working memory yet)";
    const prompt = buildSystemPromptPreview(this.workspaceDir, chatId, sessionId, memoryText, {
      channel: "telegram"
    });
    const channelSections = buildPromptChannelSections("telegram");
    const sources = getSystemPromptSources(this.workspaceDir);
    const filePath = join(this.workspaceDir, "SYSTEM_PROMPT.preview.md");
    const header = [
      "# System Prompt Preview",
      "",
      `- generated_at: ${new Date().toISOString()}`,
      `- bot_instance: ${this.instanceId}`,
      `- workspace_dir: ${this.workspaceDir}`,
      `- chat_id: ${chatId}`,
      `- session_id: ${sessionId}`,
      `- channel_sections: ${channelSections.length}`,
      `- global_sources: ${sources.global.length > 0 ? sources.global.join(", ") : "(none)"}`,
      `- workspace_sources: ${sources.workspace.length > 0 ? sources.workspace.join(", ") : "(none)"}`,
      "",
      "---",
      "",
    ].join("\n");
    writeFileSync(
      filePath,
      `${header}${prompt}\n`,
      "utf8"
    );
    momLog("telegram", "system_prompt_preview_written", {
      botId: this.instanceId,
      workspaceDir: this.workspaceDir,
      filePath,
      chatId,
      sessionId,
      promptLength: prompt.length,
    });
  }

  apply(cfg: TelegramConfig): void {
    const token = cfg.token.trim();
    const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
    const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

    momLog("telegram", "apply", {
      hasToken: Boolean(token),
      allowedChatCount: allowedChatIds.length
    });

    if (!token) {
      this.stop();
      momWarn("telegram", "disabled_no_token");
      return;
    }

    if (this.bot && this.currentToken === token && this.currentAllowedChatIdsKey === allowedChatIdsKey) {
      momLog("telegram", "apply_noop_same_token");
      return;
    }

    this.stop();

    const allowed = new Set(allowedChatIds);
    momLog("telegram", "allowed_chat_ids_loaded", {
      mode: allowed.size > 0 ? "whitelist" : "all_chats",
      allowedChatIds: Array.from(allowed)
    });
    const bot = new Bot(token);

    bot.command("chatid", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const chatType = ctx.chat.type;
      const allowedNow = allowed.size === 0 || allowed.has(chatId);
      await ctx.reply(
        [
          `chat_id: ${chatId}`,
          `chat_type: ${chatType}`,
          `allowed: ${allowedNow ? "yes" : "no"}`,
          allowed.size > 0 ? `whitelist_count: ${allowed.size}` : "whitelist_count: 0 (all chats allowed)"
        ].join("\n")
      );
      momLog("telegram", "chatid_command", { chatId, chatType, allowed: allowedNow });
    });

    bot.command("stop", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) {
        momWarn("telegram", "stop_blocked_chat", { chatId });
        return;
      }

      const activeSessionId = this.store.getActiveSession(chatId);
      if (this.running.has(chatId)) {
        const runner = this.runners.get(chatId, activeSessionId);
        runner.abort();
        momLog("telegram", "stop_requested", { chatId, sessionId: activeSessionId });
        await ctx.reply("Stopping...");
      } else {
        momLog("telegram", "stop_nothing_running", { chatId, sessionId: activeSessionId });
        await ctx.reply("Nothing running.");
      }
    });

    bot.command("new", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      if (this.running.has(chatId)) {
        await ctx.reply("Already working. Send /stop first, then /new.");
        return;
      }

      const sessionId = this.store.createSession(chatId);
      this.runners.reset(chatId, sessionId);
      await ctx.reply(`Created and switched to new session: ${sessionId}`);
      momLog("telegram", "session_new", { chatId, sessionId });
    });

    bot.command("clear", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      if (this.running.has(chatId)) {
        await ctx.reply("Already working. Send /stop first, then /clear.");
        return;
      }

      const sessionId = this.store.getActiveSession(chatId);
      this.store.clearSessionContext(chatId, sessionId);
      this.runners.reset(chatId, sessionId);
      await ctx.reply(`Cleared context for session: ${sessionId}`);
      momLog("telegram", "session_clear", { chatId, sessionId });
    });

    bot.command("sessions", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      if (this.running.has(chatId)) {
        await ctx.reply("Already working. Send /stop first, then switch sessions.");
        return;
      }

      const rawArg = this.readCommandArg(ctx.msg?.text, "/sessions");
      if (rawArg) {
        const picked = this.resolveSessionSelection(chatId, rawArg);
        if (!picked) {
          await ctx.reply("Invalid session selector. Use /sessions to list available sessions.");
          return;
        }
        this.store.setActiveSession(chatId, picked);
        await ctx.reply(`Switched to session: ${picked}`);
        momLog("telegram", "session_switch", { chatId, sessionId: picked, selector: rawArg });
        return;
      }

      await ctx.reply(this.formatSessionsOverview(chatId));
    });

    bot.command("delete_sessions", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      if (this.running.has(chatId)) {
        await ctx.reply("Already working. Send /stop first, then delete sessions.");
        return;
      }

      const rawArg = this.readCommandArg(ctx.msg?.text, "/delete_sessions");
      if (!rawArg) {
        await ctx.reply(
          `${this.formatSessionsOverview(chatId)}\n\nDelete usage: /delete_sessions <index|sessionId>`
        );
        return;
      }

      const picked = this.resolveSessionSelection(chatId, rawArg);
      if (!picked) {
        await ctx.reply("Invalid session selector. Use /delete_sessions to list available sessions.");
        return;
      }

      try {
        const result = this.store.deleteSession(chatId, picked);
        this.runners.reset(chatId, result.deleted);
        await ctx.reply(
          `Deleted session: ${result.deleted}\nCurrent session: ${result.active}\nRemaining: ${result.remaining.length}`
        );
        momLog("telegram", "session_deleted", {
          chatId,
          deleted: result.deleted,
          active: result.active,
          remaining: result.remaining.length
        });
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : String(error));
      }
    });

    bot.command("help", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      await ctx.reply(this.helpText());
    });

    bot.command("skills", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      await ctx.reply(this.skillsText(chatId));
    });

    bot.command("models", async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (allowed.size > 0 && !allowed.has(chatId)) return;
      if (this.running.has(chatId)) {
        await ctx.reply("Already working. Send /stop first, then switch models.");
        return;
      }

      const rawArg = this.readCommandArg(ctx.msg?.text, "/models");
      if (!rawArg) {
        await ctx.reply(this.modelsText("text"));
        return;
      }

      if (!this.updateSettings) {
        await ctx.reply("Model switching is unavailable in current runtime.");
        return;
      }

      const [firstArg = "", secondArg = ""] = rawArg
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const maybeRoute = this.parseModelRoute(firstArg);
      const route: ModelRoute = maybeRoute ?? "text";
      const selector = maybeRoute ? secondArg : rawArg;

      const settings = this.getSettings();
      const options = this.buildModelOptions(settings, route);
      if (!selector) {
        await ctx.reply(this.modelsText(route));
        return;
      }
      const selected = this.resolveModelSelection(selector, options);
      if (!selected) {
        await ctx.reply(`Invalid model selector: ${selector}\n\n${this.modelsText(route)}`);
        return;
      }

      const updated = this.updateSettings(selected.patch);
      await ctx.reply(
        [
          `Switched ${route} model to: ${selected.label}`,
          `Mode: ${updated.providerMode}`,
          `Use /models ${route} to check current active ${route} model.`
        ].join("\n")
      );
      momLog("telegram", "model_switched_via_command", {
        chatId,
        route,
        selector,
        selectedKey: selected.key,
        providerMode: updated.providerMode
      });
    });

    bot.on("message", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const userId = String(ctx.msg?.from?.id ?? "unknown");
      const messageId = Number(ctx.msg?.message_id ?? Date.now());

      momLog("telegram", "message_received", {
        chatId,
        userId,
        messageId,
        chatType: ctx.chat.type,
        hasText: Boolean(ctx.msg?.text || ctx.msg?.caption),
        hasDocument: Boolean(ctx.msg?.document),
        hasPhoto: Array.isArray(ctx.msg?.photo) && ctx.msg.photo.length > 0
      });

      if (allowed.size > 0 && !allowed.has(chatId)) {
        momWarn("telegram", "message_blocked_chat", { chatId, userId, messageId });
        return;
      }

      const event = await this.toInboundEvent(ctx as any, token);
      if (!event) {
        momLog("telegram", "message_ignored_after_parse", { chatId, userId, messageId });
        return;
      }

      const runId = createRunId(chatId, event.messageId);
      (event as TelegramInboundEvent & { runId?: string }).runId = runId;

      const logged = this.store.logMessage(chatId, {
        date: new Date((ctx.msg?.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        ts: event.ts,
        messageId: event.messageId,
        user: event.userId,
        userName: event.userName,
        text: event.text,
        attachments: event.attachments,
        isBot: false
      });

      momLog("telegram", "message_logged", {
        runId,
        chatId,
        messageId: event.messageId,
        dedupeAccepted: logged,
        textLength: event.text.length,
        attachmentCount: event.attachments.length,
        imageCount: event.imageContents.length
      });

      if (!logged && !event.isEvent) {
        momWarn("telegram", "message_dedup_skipped", { runId, chatId, messageId: event.messageId });
        return;
      }

      try {
        const activeSessionId = this.store.getActiveSession(chatId);
        const conv = this.sessions.getOrCreateConversation(
          "telegram",
          this.getSessionConversationKey(chatId, activeSessionId)
        );
        this.sessions.appendMessage(conv.id, event.isEvent ? "system" : "user", event.text);
        momLog("telegram", "session_user_appended", {
          runId,
          chatId,
          sessionId: activeSessionId,
          conversationId: conv.id,
          role: event.isEvent ? "system" : "user"
        });
      } catch (error) {
        momWarn("telegram", "session_user_append_failed", {
          runId,
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const lowered = event.text.trim().toLowerCase();
      if (this.running.has(chatId) && (lowered === "stop" || lowered === "/stop")) {
        const activeSessionId = this.store.getActiveSession(chatId);
        const runner = this.runners.get(chatId, activeSessionId);
        runner.abort();
        momLog("telegram", "stop_text_requested", { runId, chatId, sessionId: activeSessionId });
        await ctx.reply("Stopping...");
        return;
      }



      const queue = this.getQueue(chatId);
      const queueBefore = queue.size();
      momLog("telegram", "queue_enqueue", { runId, chatId, queueBefore });
      if (this.running.has(chatId) && !event.isEvent) {
        const pendingCount = queueBefore + 1;
        momLog("telegram", "message_queued_while_busy", { runId, chatId, pendingCount });
        await ctx.reply(`Queued. Pending: ${pendingCount}. Send /stop to cancel current task.`);
      }

      queue.enqueue(async () => {
        momLog("telegram", "queue_job_start", { runId, chatId });
        try {
          await this.processEvent(event, bot);
        } catch (error) {
          momError("telegram", "queue_job_uncaught", {
            runId,
            chatId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          await this.sendText(bot, chatId, "Internal error.");
        }
        momLog("telegram", "queue_job_end", { runId, chatId });
      });
    });

    bot.catch((err) => {
      const e = err as { error?: unknown };
      const raw = e.error;
      const message = raw instanceof Error ? raw.message : String(raw);
      momError("telegram", "bot_error", { error: message });
    });

    bot
      .start()
      .then(async () => {
        const me = await bot.api.getMe();
        this.botUsername = me.username || "";
        if (this.botUsername) {
          writeFileSync(join(this.workspaceDir, "BOT_USERNAME.txt"), this.botUsername, "utf8");
        }
        momLog("telegram", "adapter_started", { botUsername: this.botUsername || "unknown" });
      })
      .catch((error) => {
        momError("telegram", "adapter_start_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });

    this.bot = bot;
    this.currentToken = token;
    this.currentAllowedChatIdsKey = allowedChatIdsKey;
    this.startEventsWatchers(allowed);
    void this.writePromptPreview(Array.from(allowed));
  }

  stop(): void {
    if (this.events.length > 0) {
      for (const watcher of this.events) {
        watcher.stop();
      }
      this.events.length = 0;
      this.watchedChatEventDirs.clear();
      momLog("telegram", "events_watcher_stopped");
    }

    if (this.bot) {
      this.bot.stop();
      this.bot = undefined;
      this.currentToken = "";
      this.currentAllowedChatIdsKey = "";
      this.botUsername = "";
      momLog("telegram", "adapter_stopped");
    }
  }

  private getSessionConversationKey(chatId: string, sessionId: string): string {
    return `bot:${this.instanceId}:chat:${chatId}:${sessionId}`;
  }

  private getEventConversationKey(chatId: string): string {
    return `bot:${this.instanceId}:chat:${chatId}`;
  }

  private startEventsWatchers(allowed: Set<string>): void {
    this.addEventsWatcher(join(this.workspaceDir, "events"), "workspace", null);

    for (const chatId of allowed) {
      this.ensureChatEventsWatcher(chatId);
    }
  }

  private ensureChatEventsWatcher(chatId: string): void {
    this.migrateLegacyChatEventDirs(chatId);
    const eventsDir = join(this.store.getScratchDir(chatId), ...TelegramManager.CHAT_EVENTS_RELATIVE_DIR);
    if (this.watchedChatEventDirs.has(eventsDir)) return;
    this.watchedChatEventDirs.add(eventsDir);
    this.addEventsWatcher(eventsDir, "chat-scratch", chatId);
  }

  private migrateLegacyChatEventDirs(chatId: string): void {
    const scratchDir = this.store.getScratchDir(chatId);
    const canonicalDir = join(scratchDir, ...TelegramManager.CHAT_EVENTS_RELATIVE_DIR);
    mkdirSync(canonicalDir, { recursive: true });

    for (const legacySegments of TelegramManager.LEGACY_CHAT_EVENTS_RELATIVE_DIRS) {
      const legacyDir = join(scratchDir, ...legacySegments);
      if (!existsSync(legacyDir) || legacyDir === canonicalDir) continue;

      let moved = 0;
      try {
        for (const name of readdirSync(legacyDir)) {
          if (!name.endsWith(".json")) continue;
          const from = join(legacyDir, name);
          let to = join(canonicalDir, name);
          if (existsSync(to)) {
            const stem = basename(name, ".json");
            to = join(canonicalDir, `${stem}-migrated-${Date.now()}.json`);
          }
          renameSync(from, to);
          moved += 1;
        }
      } catch (error) {
        momWarn("telegram", "legacy_chat_events_migration_failed", {
          chatId,
          legacyDir,
          canonicalDir,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      try {
        rmSync(legacyDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures after successful migration.
      }

      if (moved > 0) {
        momLog("telegram", "legacy_chat_events_migrated", {
          chatId,
          legacyDir,
          canonicalDir,
          moved
        });
      }
    }
  }

  private addEventsWatcher(eventsDir: string, source: "workspace" | "chat-scratch", chatId: string | null): void {
    const watcher = new EventsWatcher(eventsDir, (event, filename) => {
      return this.handleSyntheticEvent(event, filename);
    });
    watcher.start();
    this.events.push(watcher);
    momLog("telegram", "events_watcher_started", { eventsDir, source, chatId });
  }

  private getQueue(chatId: string): ChannelQueue {
    let queue = this.chatQueues.get(chatId);
    if (!queue) {
      queue = new ChannelQueue();
      this.chatQueues.set(chatId, queue);
      momLog("telegram", "queue_created", { chatId });
    }
    return queue;
  }

  private resolveEventDeliveryMode(event: MomEvent): EventDeliveryMode {
    const raw = String((event as { delivery?: unknown }).delivery ?? "")
      .trim()
      .toLowerCase();
    if (raw === "text" || raw === "direct" || raw === "raw") return "text";
    if (raw === "agent" || raw === "task" || raw === "ai") return "agent";
    if (event.type === "periodic") return "agent";
    // Default upgraded to agent for one-shot/immediate unless explicitly marked as text.
    return "agent";
  }

  private buildEventSyntheticText(event: MomEvent, filename: string): string {
    const timePart = event.type === "one-shot"
      ? event.at
      : (event.type === "periodic" ? event.schedule : "immediate");
    return `[EVENT:${filename}:${event.type}:${timePart}] ${event.text}`;
  }

  private handleSyntheticEvent(event: MomEvent, filename: string): Promise<void> {
    if (!this.bot) return Promise.resolve();

    const queue = this.getQueue(event.chatId);
    if (queue.size() >= 5) {
      momWarn("telegram", "event_dropped_queue_full", {
        chatId: event.chatId,
        filename,
        queueSize: queue.size()
      });
      return Promise.reject(new Error("Event dropped: queue full"));
    }

    const syntheticMessageId = Date.now();
    const runId = createRunId(event.chatId, syntheticMessageId);
    const delivery = this.resolveEventDeliveryMode(event);

    momLog("telegram", "event_enqueued", {
      runId,
      chatId: event.chatId,
      filename,
      eventType: event.type,
      delivery
    });

    return new Promise<void>((resolve, reject) => {
      queue.enqueue(async () => {
        momLog("telegram", "event_job_start", { runId, chatId: event.chatId, filename, delivery });
        try {
          if (delivery === "text" && (event.type === "one-shot" || event.type === "immediate")) {
            await this.deliverDirectEventMessage(event, runId, filename);
          } else {
            const synthetic: TelegramInboundEvent = {
              chatId: event.chatId,
              chatType: "private",
              messageId: syntheticMessageId,
              userId: "EVENT",
              userName: "EVENT",
              text: this.buildEventSyntheticText(event, filename),
              ts: (Date.now() / 1000).toFixed(6),
              attachments: [],
              imageContents: [],
              isEvent: true
            };
            (synthetic as TelegramInboundEvent & { runId?: string }).runId = runId;
            await this.processEvent(synthetic, this.bot!);
          }
          resolve();
        } catch (error) {
          momError("telegram", "event_job_uncaught", {
            runId,
            chatId: event.chatId,
            filename,
            delivery,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          reject(error);
        } finally {
          momLog("telegram", "event_job_end", { runId, chatId: event.chatId, filename, delivery });
        }
      });
    });
  }

  private async deliverDirectEventMessage(event: MomEvent, runId: string, filename: string): Promise<void> {
    if (!this.bot) return;

    const sent = await this.sendText(this.bot, event.chatId, event.text);
    this.store.logBotResponse(event.chatId, event.text, sent.message_id);

    momLog("telegram", "event_direct_sent", {
      runId,
      chatId: event.chatId,
      filename,
      eventType: event.type,
      messageId: sent.message_id,
      textLength: event.text.length
    });

    try {
      const conv = this.sessions.getOrCreateConversation("telegram", this.getEventConversationKey(event.chatId));
      this.sessions.appendMessage(conv.id, "assistant", event.text);
      momLog("telegram", "session_event_direct_appended", {
        runId,
        chatId: event.chatId,
        conversationId: conv.id,
        textLength: event.text.length
      });
    } catch (error) {
      momWarn("telegram", "session_event_direct_append_failed", {
        runId,
        chatId: event.chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async processEvent(event: TelegramInboundEvent, bot: Bot): Promise<void> {
    const chatId = event.chatId;
    this.ensureChatEventsWatcher(chatId);
    const sessionId = event.sessionId || this.store.getActiveSession(chatId);
    const runner = this.runners.get(chatId, sessionId);
    const runId = (event as TelegramInboundEvent & { runId?: string }).runId ?? createRunId(chatId, event.messageId);
    this.running.add(chatId);

    momLog("telegram", "process_start", {
      runId,
      chatId,
      sessionId,
      messageId: event.messageId,
      userId: event.userId,
      isEvent: Boolean(event.isEvent)
    });

    const status: StatusSession = {
      statusMessageId: null,
      threadMessageIds: [],
      accumulatedText: "",
      isWorking: true
    };

    const render = async (text: string): Promise<void> => {
      const display = status.isWorking ? `${text} ...` : text;
      if (status.statusMessageId) {
        try {
          await this.editText(bot, chatId, status.statusMessageId, display);
          momLog("telegram", "status_edited", {
            runId,
            chatId,
            statusMessageId: status.statusMessageId,
            displayLength: display.length
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("message is not modified")) {
            momLog("telegram", "status_edit_ignored_not_modified", {
              runId,
              chatId,
              statusMessageId: status.statusMessageId
            });
            return;
          }
          momWarn("telegram", "status_edit_failed_fallback_send", {
            runId,
            chatId,
            statusMessageId: status.statusMessageId,
            error: message
          });
        }
      }

      const sent = await this.sendText(bot, chatId, display);
      status.statusMessageId = sent.message_id;
      momLog("telegram", "status_sent", {
        runId,
        chatId,
        statusMessageId: status.statusMessageId,
        displayLength: display.length
      });
    };

    const ctx: MomContext = {
      message: event,
      workspaceDir: this.workspaceDir,
      chatDir: this.store.getChatDir(chatId),
      respond: async (text, shouldLog = true) => {
        status.accumulatedText = status.accumulatedText ? `${status.accumulatedText}\n${text}` : text;
        momLog("telegram", "ctx_respond", {
          runId,
          chatId,
          deltaLength: text.length,
          accumulatedLength: status.accumulatedText.length,
          shouldLog
        });
        await render(status.accumulatedText);
        if (shouldLog && status.statusMessageId) {
          this.store.logBotResponse(chatId, text, status.statusMessageId);
          momLog("telegram", "ctx_respond_logged", { runId, chatId, statusMessageId: status.statusMessageId });
        }
      },
      replaceMessage: async (text) => {
        status.accumulatedText = text;
        momLog("telegram", "ctx_replace", { runId, chatId, textLength: text.length });
        await render(status.accumulatedText);
      },
      respondInThread: async (text) => {
        if (!status.statusMessageId) return;
        const sent = await this.sendText(bot, chatId, text, {
          reply_parameters: { message_id: status.statusMessageId }
        });
        status.threadMessageIds.push(sent.message_id);
        momLog("telegram", "ctx_thread_reply", {
          runId,
          chatId,
          replyTo: status.statusMessageId,
          threadMessageId: sent.message_id,
          textLength: text.length
        });
      },
      setTyping: async (isTyping) => {
        momLog("telegram", "ctx_set_typing", { runId, chatId, isTyping });
        if (!isTyping) return;
        await bot.api.sendChatAction(chatId, "typing");
        if (!status.statusMessageId) {
          status.accumulatedText = event.isEvent ? "Starting event" : "Thinking";
          await render(status.accumulatedText);
        }
      },
      setWorking: async (isWorking) => {
        status.isWorking = isWorking;
        momLog("telegram", "ctx_set_working", { runId, chatId, isWorking });
        if (status.statusMessageId) {
          await render(status.accumulatedText);
        }
      },
      deleteMessage: async () => {
        momLog("telegram", "ctx_delete_message", {
          runId,
          chatId,
          statusMessageId: status.statusMessageId,
          threadCount: status.threadMessageIds.length
        });
        for (let i = status.threadMessageIds.length - 1; i >= 0; i--) {
          try {
            await bot.api.deleteMessage(chatId, status.threadMessageIds[i]);
          } catch {
            // ignore
          }
        }
        if (status.statusMessageId) {
          try {
            await bot.api.deleteMessage(chatId, status.statusMessageId);
          } catch {
            // ignore
          }
        }
      },
      uploadFile: async (filePath, title) => {
        const rawName = title || filePath.split("/").pop() || "file";
        const bytes = readFileSync(filePath);
        const isText = this.isLikelyTextBuffer(bytes);
        if (isText) {
          const text = bytes.toString("utf8");
          if (this.canSendAsTelegramText(text)) {
            momLog("telegram", "ctx_upload_file_as_text", {
              runId,
              chatId,
              filePath,
              rawName,
              textLength: Array.from(text).length
            });
            await this.sendText(bot, chatId, text);
            return;
          }
        }

        const name = isText ? this.normalizeTextAttachmentName(rawName) : rawName;
        const imageMime = this.detectImageMime(name, bytes);
        momLog("telegram", "ctx_upload_file", {
          runId,
          chatId,
          filePath,
          rawName,
          finalName: name,
          isText,
          imageMime: imageMime ?? null
        });
        if (imageMime) {
          try {
            await bot.api.sendPhoto(chatId, new InputFile(bytes, name), {
              caption: name
            });
            return;
          } catch (error) {
            momWarn("telegram", "ctx_upload_image_as_photo_failed_fallback_document", {
              runId,
              chatId,
              filePath,
              name,
              imageMime,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        await bot.api.sendDocument(chatId, new InputFile(bytes, name), {
          caption: name
        });
      }
    };

    try {
      const result = await runner.run(ctx);
      momLog("telegram", "process_runner_done", {
        runId,
        chatId,
        stopReason: result.stopReason,
        hasError: Boolean(result.errorMessage)
      });

      const finalAssistantText = status.accumulatedText.trim();
      if (finalAssistantText) {
        try {
          const conv = this.sessions.getOrCreateConversation(
            "telegram",
            this.getSessionConversationKey(chatId, sessionId)
          );
          this.sessions.appendMessage(conv.id, "assistant", finalAssistantText);
          momLog("telegram", "session_assistant_appended", {
            runId,
            chatId,
            sessionId,
            conversationId: conv.id,
            textLength: finalAssistantText.length
          });
        } catch (error) {
          momWarn("telegram", "session_assistant_append_failed", {
            runId,
            chatId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        momWarn("telegram", "session_assistant_skipped_empty", { runId, chatId });
      }

      if (result.stopReason === "aborted") {
        await bot.api.sendMessage(chatId, "Stopped.");
      }
    } catch (error) {
      momError("telegram", "process_failed", {
        runId,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      await bot.api.sendMessage(chatId, "Internal error.");
    } finally {
      this.running.delete(chatId);
      momLog("telegram", "process_end", { runId, chatId });
    }
  }

  private readCommandArg(text: string | undefined, command: string): string {
    if (!text) return "";
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(command.toLowerCase())) return "";
    const rest = trimmed.slice(command.length).trim();
    return rest;
  }

  private resolveSessionSelection(chatId: string, selector: string): string | null {
    const sessions = this.store.listSessions(chatId);
    const raw = selector.trim();
    if (!raw) return null;

    const asIndex = Number.parseInt(raw, 10);
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= sessions.length) {
      return sessions[asIndex - 1] ?? null;
    }

    return sessions.includes(raw) ? raw : null;
  }

  private formatSessionsOverview(chatId: string): string {
    const sessions = this.store.listSessions(chatId);
    const active = this.store.getActiveSession(chatId);
    const lines = [
      `Current session: ${active}`,
      `Total sessions: ${sessions.length}`,
      "",
      "Sessions:"
    ];
    for (let i = 0; i < sessions.length; i += 1) {
      const id = sessions[i];
      lines.push(`${i + 1}. ${id}${id === active ? " (current)" : ""}`);
    }
    lines.push("");
    lines.push("Switch: /sessions <index|sessionId>");
    lines.push("Delete: /delete_sessions <index|sessionId>");
    return lines.join("\n");
  }

  private helpText(): string {
    return [
      "Available commands:",
      "/chatid - show current chat id and whitelist status",
      "/stop - stop current running task",
      "/new - create and switch to a new session",
      "/clear - clear context of current session",
      "/sessions - list sessions and current active session",
      "/sessions <index|sessionId> - switch active session",
      "/delete_sessions - list sessions and delete usage",
      "/delete_sessions <index|sessionId> - delete a session",
      "/models - list text-model options and active text model",
      "/models <index|key> - switch text model",
      "/models <text|vision|stt|tts> - list options for a specific route",
      "/models <text|vision|stt|tts> <index|key> - switch route model",
      "/skills - list currently loaded skills",
      "/help - show this help",
      "",
      "Suggested future commands:",
      "/rename_session <index|name> <new_name>",
      "/export_session <index|sessionId>",
      "/session_info - show message count and last update of active session"
    ].join("\n");
  }

  private skillsText(chatId: string): string {
    const { skills, diagnostics } = loadSkillsFromWorkspace(this.workspaceDir, chatId);
    const dataRoot = this.workspaceDir.includes("/moli-t/")
      ? this.workspaceDir.slice(0, this.workspaceDir.indexOf("/moli-t/"))
      : this.workspaceDir;
    const globalSkillsDir = `${dataRoot}/skills`;
    const chatSkillsDir = `${this.workspaceDir}/${chatId}/skills`;
    const scopeLabel: Record<string, string> = {
      chat: "chat",
      global: "global",
      "workspace-legacy": "workspace-legacy"
    };
    const lines = [
      `Workspace: ${this.workspaceDir}`,
      `Global skills dir: ${globalSkillsDir}`,
      `Chat skills dir: ${chatSkillsDir}`,
      `Loaded skills: ${skills.length}`,
      ""
    ];

    if (skills.length === 0) {
      lines.push("(no skills loaded)");
    } else {
      for (let i = 0; i < skills.length; i += 1) {
        const skill = skills[i];
        lines.push(`${i + 1}. ${skill.name}`);
        lines.push(`   - scope: ${scopeLabel[skill.scope] ?? skill.scope}`);
        lines.push(`   - description: ${skill.description}`);
        lines.push(`   - file: ${skill.filePath}`);
      }
    }

    if (diagnostics.length > 0) {
      lines.push("");
      lines.push("Diagnostics:");
      for (const row of diagnostics) {
        lines.push(`- ${row}`);
      }
    }

    return lines.join("\n");
  }

  private parseModelRoute(value: string): ModelRoute | null {
    if (value === "text" || value === "vision" || value === "stt" || value === "tts") return value;
    return null;
  }

  private currentModelKey(settings: RuntimeSettings, route: ModelRoute): string {
    const routed = route === "text"
      ? settings.modelRouting.textModelKey?.trim()
      : route === "vision"
        ? settings.modelRouting.visionModelKey?.trim()
        : route === "stt"
          ? settings.modelRouting.sttModelKey?.trim()
          : settings.modelRouting.ttsModelKey?.trim();
    if (routed) return routed;
    if (route !== "text") return "";
    if (settings.providerMode === "custom") {
      const id = settings.defaultCustomProviderId || settings.customProviders[0]?.id || "";
      const provider = settings.customProviders.find((p) => p.id === id) ?? settings.customProviders[0];
      const modelIds = (provider?.models ?? []).map((m) => m.id).filter(Boolean);
      const model = provider?.defaultModel || modelIds[0] || "";
      return id ? `custom|${id}|${model}` : `pi|${settings.piModelProvider}|${settings.piModelName}`;
    }
    return `pi|${settings.piModelProvider}|${settings.piModelName}`;
  }

  private buildModelOptions(settings: RuntimeSettings, route: ModelRoute): ModelOption[] {
    const patchKey = route === "text"
      ? "textModelKey"
      : route === "vision"
        ? "visionModelKey"
        : route === "stt"
          ? "sttModelKey"
          : "ttsModelKey";

    const supportsRoute = (tags: string[]): boolean => {
      if (route === "text") return tags.includes("text");
      return tags.includes(route);
    };

    const options: ModelOption[] = [
      ...(route === "text" || route === "vision"
        ? [{
          key: `pi|${settings.piModelProvider}|${settings.piModelName}`,
          label: `[PI] ${settings.piModelProvider} / ${settings.piModelName}`,
          patch: {
            providerMode: route === "text" ? "pi" : settings.providerMode,
            piModelProvider: settings.piModelProvider,
            piModelName: settings.piModelName,
            modelRouting: {
              ...settings.modelRouting,
              [patchKey]: `pi|${settings.piModelProvider}|${settings.piModelName}`
            }
          } as Partial<RuntimeSettings>
        }]
        : [])
    ];

    for (const provider of settings.customProviders) {
      const models = provider.models.filter((m) => m.id?.trim() && supportsRoute(Array.isArray(m.tags) ? m.tags : ["text"]));
      for (const model of models) {
        const modelId = model.id.trim();
        const updatedProviders = settings.customProviders.map((row) =>
          row.id === provider.id ? { ...row, defaultModel: modelId } : row
        );
        options.push({
          key: `custom|${provider.id}|${modelId}`,
          label: `[Custom] ${provider.name} / ${modelId}`,
          patch: {
            providerMode: route === "text" ? "custom" : settings.providerMode,
            defaultCustomProviderId: route === "text" ? provider.id : settings.defaultCustomProviderId,
            customProviders: route === "text" ? updatedProviders : settings.customProviders,
            modelRouting: {
              ...settings.modelRouting,
              [patchKey]: `custom|${provider.id}|${modelId}`
            }
          }
        });
      }
    }

    return options;
  }

  private resolveModelSelection(selector: string, options: ModelOption[]): ModelOption | null {
    const raw = selector.trim();
    if (!raw) return null;

    const asIndex = Number.parseInt(raw, 10);
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= options.length) {
      return options[asIndex - 1] ?? null;
    }

    return options.find((o) => o.key === raw) ?? null;
  }

  private modelsText(route: ModelRoute): string {
    const settings = this.getSettings();
    const options = this.buildModelOptions(settings, route);
    const activeKey = this.currentModelKey(settings, route);
    const lines = [
      `Route: ${route}`,
      `Provider mode: ${settings.providerMode}`,
      `Configured model options: ${options.length}`,
      ""
    ];

    if (options.length === 0) {
      lines.push("(no configured models)");
    } else {
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        const marker = option.key === activeKey ? " (active)" : "";
        lines.push(`${i + 1}. ${option.label}${marker}`);
        lines.push(`   - key: ${option.key}`);
      }
    }

    lines.push("");
    lines.push(`Switch ${route} model:`);
    lines.push(`/models ${route} <index>`);
    lines.push(`/models ${route} <key>`);
    if (route === "text") {
      lines.push("");
      lines.push("Quick text switch:");
      lines.push("/models <index>");
      lines.push("/models <key>");
    }
    return lines.join("\n");
  }

  private isLikelyTextBuffer(data: Buffer): boolean {
    if (data.length === 0) return true;
    const sample = data.subarray(0, Math.min(data.length, 4096));
    let controlCount = 0;

    for (const byte of sample) {
      if (byte === 0) return false;
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
        controlCount += 1;
      }
    }

    return controlCount / sample.length < 0.1;
  }

  private normalizeTextAttachmentName(name: string): string {
    const ext = extname(name).toLowerCase();
    if (ext === ".txt" || ext === ".md" || ext === ".html" || ext === ".htm") {
      return name;
    }

    const safeBase = basename(name, ext).replace(/[^\w.-]/g, "_") || "attachment";
    return `${safeBase}.txt`;
  }

  private canSendAsTelegramText(text: string): boolean {
    const normalized = text.replace(/\u0000/g, "");
    if (!normalized.trim()) return false;
    return Array.from(normalized).length <= TelegramManager.TELEGRAM_TEXT_SOFT_LIMIT;
  }

  private shouldTriggerGroupMessage(text: string, replyToBot: boolean): boolean {
    if (replyToBot) return true;
    if (!this.botUsername) return false;
    const mention = new RegExp(`@${this.botUsername}(\\b|$)`, "i");
    return mention.test(text);
  }

  private stripMention(text: string): string {
    if (!this.botUsername) return text.trim();
    return text.replace(new RegExp(`@${this.botUsername}(\\b|$)`, "ig"), "").trim();
  }

  private mimeFromFilename(filename: string): string | undefined {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return undefined;
  }

  private detectImageMime(filename: string, data: Buffer): string | undefined {
    const fromExt = this.mimeFromFilename(filename);
    if (fromExt?.startsWith("image/")) {
      return fromExt;
    }

    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    ) {
      return "image/png";
    }
    if (
      data.length >= 6 &&
      data[0] === 0x47 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x38 &&
      (data[4] === 0x37 || data[4] === 0x39) &&
      data[5] === 0x61
    ) {
      return "image/gif";
    }
    if (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      return "image/webp";
    }

    return undefined;
  }

  private resolveAudioExt(mimeType?: string): string {
    const lower = String(mimeType || "").toLowerCase();
    if (lower.includes("ogg")) return ".ogg";
    if (lower.includes("mpeg") || lower.includes("mp3")) return ".mp3";
    if (lower.includes("wav")) return ".wav";
    if (lower.includes("mp4") || lower.includes("m4a")) return ".m4a";
    return ".ogg";
  }

  private normalizeApiPath(path: string | undefined, fallback: string): string {
    const raw = String(path ?? fallback).trim() || fallback;
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  private buildApiUrl(baseUrl: string, path: string | undefined, fallbackPath: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    const normalizedPath = this.normalizeApiPath(path, fallbackPath);
    return `${base}${normalizedPath}`;
  }

  private parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
    const raw = key.trim();
    if (!raw) return null;
    const [mode, provider, ...rest] = raw.split("|");
    if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
    const model = rest.join("|").trim();
    if (!model) return null;
    return { mode, provider: provider.trim(), model };
  }

  private resolveSttTarget(): SttTarget | null {
    const settings = this.getSettings();
    const routed = this.parseModelKey(settings.modelRouting.sttModelKey);
    if (routed?.mode === "custom") {
      const provider = settings.customProviders.find((p) => p.id === routed.provider);
      if (provider?.baseUrl && provider.apiKey && routed.model) {
        return {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: routed.model,
          path: provider.path
        };
      }
    }

    // Auto-heal fallback: if stt route is missing/invalid, pick first custom model tagged as stt.
    for (const provider of settings.customProviders) {
      if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;
      const sttModel = provider.models.find((m) => m.id?.trim() && Array.isArray(m.tags) && m.tags.includes("stt"));
      if (!sttModel) continue;
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: sttModel.id,
        path: provider.path
      };
    }

    if (!config.telegramSttApiKey || !config.telegramSttModel) return null;
    return {
      baseUrl: config.telegramSttBaseUrl,
      apiKey: config.telegramSttApiKey,
      model: config.telegramSttModel,
      path: "/v1/audio/transcriptions"
    };
  }

  private async transcribeAudio(data: Buffer, filename: string, mimeType?: string): Promise<TranscriptionResult> {
    const target = this.resolveSttTarget();
    if (!target) {
      return {
        text: null,
        errorMessage: "STT 未配置。请在 AI Settings 里选择可用的 STT 模型并填写 API 配置。"
      };
    }

    const url = this.buildApiUrl(target.baseUrl, target.path, "/v1/audio/transcriptions");
    momLog("telegram", "voice_transcription_target", {
      url,
      model: target.model,
      hasApiKey: Boolean(target.apiKey)
    });
    const form = new FormData();
    form.append("model", target.model);
    if (config.telegramSttLanguage) {
      form.append("language", config.telegramSttLanguage);
    }
    if (config.telegramSttPrompt) {
      form.append("prompt", config.telegramSttPrompt);
    }
    form.append("file", new Blob([data], { type: mimeType || "audio/ogg" }), filename);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.apiKey}`
        },
        body: form
      });
      if (!resp.ok) {
        const body = await resp.text();
        const hint = resp.status === 404
          ? "端点可能不正确，请检查 provider baseUrl/path（例如是否缺少 /v1）。"
          : "请检查 API Key、模型名、以及 provider 路径配置。";
        momWarn("telegram", "voice_transcription_http_error", {
          url,
          status: resp.status,
          statusText: resp.statusText,
          body: body.slice(0, 240)
        });
        return {
          text: null,
          errorMessage: `语音转写失败（HTTP ${resp.status} ${resp.statusText}）。${hint}`
        };
      }

      const payload = (await resp.json()) as { text?: unknown };
      const text = String(payload.text ?? "").trim();
      if (!text) {
        return {
          text: null,
          errorMessage: "语音转写接口返回成功，但没有返回文本内容。请检查模型兼容性。"
        };
      }
      momLog("telegram", "voice_transcription_success", {
        model: target.model,
        transcriptLength: text.length
      });
      return { text, errorMessage: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      momWarn("telegram", "voice_transcription_failed", {
        error: message
      });
      return {
        text: null,
        errorMessage: `语音转写请求异常：${message}`
      };
    }
  }

  private async downloadTelegramFile(token: string, fileId: string): Promise<Buffer | null> {
    if (!this.bot) return null;
    try {
      const info = await this.bot.api.getFile(fileId);
      const filePath = info.file_path;
      if (!filePath) return null;

      const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        momWarn("telegram", "file_download_http_error", { fileId, status: resp.status, statusText: resp.statusText });
        return null;
      }
      const arr = await resp.arrayBuffer();
      return Buffer.from(arr);
    } catch (error) {
      momWarn("telegram", "file_download_failed", { fileId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async toInboundEvent(ctx: any, token: string): Promise<TelegramInboundEvent | null> {
    const msg = ctx.msg;
    if (!msg) return null;

    const chatId = String(ctx.chat.id);
    const chatType = (ctx.chat.type || "private") as TelegramInboundEvent["chatType"];
    const rawText = String(msg.text || msg.caption || "");

    const replyToBot = Boolean(msg.reply_to_message?.from?.is_bot);
    if ((chatType === "group" || chatType === "supergroup") && !this.shouldTriggerGroupMessage(rawText, replyToBot)) {
      momLog("telegram", "group_message_ignored_no_mention", { chatId, messageId: msg.message_id });
      return null;
    }

    let cleaned = (chatType === "group" || chatType === "supergroup") ? this.stripMention(rawText) : rawText.trim();
    if (!cleaned && !msg.document && !msg.photo && !msg.voice && !msg.audio) {
      momLog("telegram", "message_ignored_empty", { chatId, messageId: msg.message_id });
      return null;
    }

    const ts = `${msg.date}.${String(msg.message_id).padStart(6, "0")}`;
    const attachments: TelegramInboundEvent["attachments"] = [];
    const imageContents: TelegramInboundEvent["imageContents"] = [];
    let voiceTranscript: string | null = null;
    let voiceTranscriptionError: string | null = null;

    if (msg.document?.file_id) {
      const filename = msg.document.file_name || `${msg.document.file_id}.bin`;
      const data = await this.downloadTelegramFile(token, msg.document.file_id);
      if (data) {
        const saved = this.store.saveAttachment(chatId, filename, ts, data);
        attachments.push(saved);

        const mime = this.mimeFromFilename(filename);
        if (mime) {
          imageContents.push({ type: "image", mimeType: mime, data: data.toString("base64") });
        }
      }
    }

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      if (largest?.file_id) {
        const filename = `${largest.file_id}.jpg`;
        const data = await this.downloadTelegramFile(token, largest.file_id);
        if (data) {
          const saved = this.store.saveAttachment(chatId, filename, ts, data);
          attachments.push(saved);
          imageContents.push({ type: "image", mimeType: "image/jpeg", data: data.toString("base64") });
        }
      }
    }

    if (msg.voice?.file_id) {
      const ext = this.resolveAudioExt(msg.voice.mime_type);
      const filename = `${msg.voice.file_id}${ext}`;
      const data = await this.downloadTelegramFile(token, msg.voice.file_id);
      if (data) {
        const saved = this.store.saveAttachment(chatId, filename, ts, data);
        attachments.push(saved);
        const transcription = await this.transcribeAudio(data, filename, msg.voice.mime_type);
        voiceTranscript = transcription.text;
        voiceTranscriptionError = transcription.errorMessage;
      }
    }

    if (msg.audio?.file_id) {
      const ext = this.resolveAudioExt(msg.audio.mime_type);
      const filename = msg.audio.file_name || `${msg.audio.file_id}${ext}`;
      const data = await this.downloadTelegramFile(token, msg.audio.file_id);
      if (data) {
        const saved = this.store.saveAttachment(chatId, filename, ts, data);
        attachments.push(saved);
        if (!voiceTranscript) {
          const transcription = await this.transcribeAudio(data, filename, msg.audio.mime_type);
          voiceTranscript = transcription.text;
          voiceTranscriptionError = transcription.errorMessage;
        }
      }
    }

    if (voiceTranscript) {
      cleaned = cleaned
        ? `${cleaned}\n\n[voice transcript]\n${voiceTranscript}`
        : `[voice transcript]\n${voiceTranscript}`;
    }

    if (!cleaned) {
      if (msg.voice || msg.audio) {
        cleaned = "(voice message received; transcription unavailable)";
        if (voiceTranscriptionError) {
          await ctx.reply(
            [
              "语音识别失败，已降级为未转写消息。",
              voiceTranscriptionError,
              "建议：检查 STT provider 的 baseUrl/path/model 是否正确。"
            ].join("\n")
          );
        }
      } else {
        cleaned = "(attachment)";
      }
    }

    return {
      chatId,
      chatType,
      messageId: msg.message_id,
      userId: String(msg.from?.id ?? "unknown"),
      userName: msg.from?.username || msg.from?.first_name,
      text: cleaned,
      ts,
      attachments,
      imageContents
    };
  }
}
