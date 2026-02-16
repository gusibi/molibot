import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Bot, InputFile } from "grammy";
import type { RuntimeSettings } from "../config.js";
import { config } from "../config.js";
import { EventsWatcher, type MomEvent } from "../mom/events.js";
import { createRunId, momError, momLog, momWarn } from "../mom/log.js";
import { RunnerPool } from "../mom/runner.js";
import { loadSkillsFromWorkspace } from "../mom/skills.js";
import { TelegramMomStore } from "../mom/store.js";
import type { MomContext, TelegramInboundEvent } from "../mom/types.js";
import { SessionStore } from "../services/sessionStore.js";

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
          error: error instanceof Error ? error.message : String(error)
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

export class TelegramManager {
  private static readonly TELEGRAM_TEXT_SOFT_LIMIT = 3800;
  private bot: Bot | undefined;
  private currentToken = "";
  private botUsername = "";
  private readonly workspaceDir = resolve(config.dataDir, "telegram-mom");
  private readonly store = new TelegramMomStore(this.workspaceDir);
  private readonly sessions: SessionStore;
  private readonly runners: RunnerPool;
  private readonly chatQueues = new Map<string, ChannelQueue>();
  private readonly running = new Set<string>();
  private readonly events: EventsWatcher[] = [];
  private readonly watchedChatEventDirs = new Set<string>();

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    sessionStore?: SessionStore
  ) {
    this.sessions = sessionStore ?? new SessionStore();
    this.runners = new RunnerPool(this.store, this.getSettings);
  }

  apply(cfg: TelegramConfig): void {
    const token = cfg.token.trim();

    momLog("telegram", "apply", {
      hasToken: Boolean(token),
      allowedChatCount: cfg.allowedChatIds.length
    });

    if (!token) {
      this.stop();
      momWarn("telegram", "disabled_no_token");
      return;
    }

    if (this.bot && this.currentToken === token) {
      momLog("telegram", "apply_noop_same_token");
      return;
    }

    this.stop();

    const allowed = new Set(cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean));
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
      await ctx.reply(this.skillsText());
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
        const conv = this.sessions.getOrCreateConversation("telegram", `chat:${chatId}:${activeSessionId}`);
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
        await this.processEvent(event, bot);
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
    this.startEventsWatchers(allowed);
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
      this.botUsername = "";
      momLog("telegram", "adapter_stopped");
    }
  }

  private startEventsWatchers(allowed: Set<string>): void {
    this.addEventsWatcher(join(this.workspaceDir, "events"), "workspace", null);

    for (const chatId of allowed) {
      this.ensureChatEventsWatcher(chatId);
    }
  }

  private ensureChatEventsWatcher(chatId: string): void {
    const eventsDir = join(this.store.getScratchDir(chatId), "data", "telegram-mom", "events");
    if (this.watchedChatEventDirs.has(eventsDir)) return;
    this.watchedChatEventDirs.add(eventsDir);
    this.addEventsWatcher(eventsDir, "chat-scratch", chatId);
  }

  private addEventsWatcher(eventsDir: string, source: "workspace" | "chat-scratch", chatId: string | null): void {
    const watcher = new EventsWatcher(eventsDir, (event, filename) => {
      this.handleSyntheticEvent(event, filename);
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

  private handleSyntheticEvent(event: MomEvent, filename: string): void {
    if (!this.bot) return;

    const queue = this.getQueue(event.chatId);
    if (queue.size() >= 5) {
      momWarn("telegram", "event_dropped_queue_full", {
        chatId: event.chatId,
        filename,
        queueSize: queue.size()
      });
      return;
    }

    const syntheticMessageId = Date.now();
    const runId = createRunId(event.chatId, syntheticMessageId);

    momLog("telegram", "event_enqueued", {
      runId,
      chatId: event.chatId,
      filename,
      eventType: event.type
    });

    queue.enqueue(async () => {
      momLog("telegram", "event_job_start", { runId, chatId: event.chatId, filename });
      if (event.type === "one-shot" || event.type === "immediate") {
        await this.deliverDirectEventMessage(event, runId, filename);
      } else {
        const synthetic: TelegramInboundEvent = {
          chatId: event.chatId,
          chatType: "private",
          messageId: syntheticMessageId,
          userId: "EVENT",
          userName: "EVENT",
          text: `[EVENT:${filename}:${event.type}:${event.schedule}] ${event.text}`,
          ts: (Date.now() / 1000).toFixed(6),
          attachments: [],
          imageContents: [],
          isEvent: true
        };
        (synthetic as TelegramInboundEvent & { runId?: string }).runId = runId;
        await this.processEvent(synthetic, this.bot!);
      }
      momLog("telegram", "event_job_end", { runId, chatId: event.chatId, filename });
    });
  }

  private async deliverDirectEventMessage(event: MomEvent, runId: string, filename: string): Promise<void> {
    if (!this.bot) return;

    const sent = await this.bot.api.sendMessage(event.chatId, event.text);
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
      const conv = this.sessions.getOrCreateConversation("telegram", `chat:${event.chatId}`);
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
          await bot.api.editMessageText(chatId, status.statusMessageId, display);
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

      const sent = await bot.api.sendMessage(chatId, display);
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
        const sent = await bot.api.sendMessage(chatId, text, {
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
            await bot.api.sendMessage(chatId, text);
            return;
          }
        }

        const name = isText ? this.normalizeTextAttachmentName(rawName) : rawName;
        momLog("telegram", "ctx_upload_file", {
          runId,
          chatId,
          filePath,
          rawName,
          finalName: name,
          isText
        });
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
          const conv = this.sessions.getOrCreateConversation("telegram", `chat:${chatId}:${sessionId}`);
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
      "/skills - list currently loaded skills",
      "/help - show this help",
      "",
      "Suggested future commands:",
      "/rename_session <index|name> <new_name>",
      "/export_session <index|sessionId>",
      "/session_info - show message count and last update of active session"
    ].join("\n");
  }

  private skillsText(): string {
    const { skills, diagnostics } = loadSkillsFromWorkspace(this.workspaceDir);
    const lines = [
      `Workspace: ${this.workspaceDir}`,
      `Loaded skills: ${skills.length}`,
      ""
    ];

    if (skills.length === 0) {
      lines.push("(no skills loaded)");
    } else {
      for (let i = 0; i < skills.length; i += 1) {
        const skill = skills[i];
        lines.push(`${i + 1}. ${skill.name}`);
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
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return undefined;
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
    if (!cleaned && !msg.document && !msg.photo) {
      momLog("telegram", "message_ignored_empty", { chatId, messageId: msg.message_id });
      return null;
    }

    const ts = `${msg.date}.${String(msg.message_id).padStart(6, "0")}`;
    const attachments: TelegramInboundEvent["attachments"] = [];
    const imageContents: TelegramInboundEvent["imageContents"] = [];

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

    if (!cleaned) {
      cleaned = "(attachment)";
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
