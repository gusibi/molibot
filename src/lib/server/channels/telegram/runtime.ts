import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { RuntimeSettings } from "../../settings/index.js";
import { EventsWatcher, type MomEvent, type EventDeliveryMode } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage, MomContext } from "../../agent/types.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { applyTelegramAcpProgressEvent, createTelegramAcpProgressState } from "./acpProgress.js";
import { describeTelegramError, editTelegramMessage, editTelegramText, sendTelegramChatAction, sendTelegramText, sendTelegramTextSafely } from "./formatting.js";
import { ACP_CONTROL_HELP_LINES, handleSharedAcpApprovalCommand, handleSharedAcpCommand, shouldProxyToAcpSession, type SharedAcpPromptKind } from "../shared/acp.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import type { ParsedRelativeReminder, StatusSession } from "./types.js";

export interface TelegramConfig {
  token: string;
  allowedChatIds: string[];
}

interface TelegramCommandTarget {
  chatId: string;
  scopeId: string;
  messageThreadId?: number;
}

// Orchestrates Telegram-specific command flow, event handling, and runner lifecycle.
// Leaf concerns like queueing and text formatting live in sibling files.
export class TelegramManager extends BaseChannelRuntime {
  private static readonly TELEGRAM_TEXT_SOFT_LIMIT = 3800;
  private static readonly STREAM_RENDER_INTERVAL_MS = 1000;
  private static readonly STREAM_EDIT_RETRY_AFTER_CAP_MS = 1500;
  private static readonly STREAM_EDIT_REQUEST_TIMEOUT_MS = 5000;
  private static readonly CHAT_EVENTS_RELATIVE_DIR = ["events"] as const;
  private static readonly LEGACY_CHAT_EVENTS_RELATIVE_DIRS = [
    ["data", "moli-t", "events"],
    ["data", "molipi_bot", "events"],
    ["data", "telegram-mom", "events"]
  ] as const;
  private readonly commandService: SharedRuntimeCommandService<TelegramCommandTarget>;
  private bot: Bot | undefined;
  private currentToken = "";
  private currentAllowedChatIdsKey = "";
  private botUsername = "";
  private readonly acpPermissionActions = new Map<string, {
    scopeId: string;
    requestId: string;
    action: "select" | "deny" | "deny_with_note";
    optionId?: string;
  }>();
  private readonly acpPermissionInputs = new Map<string, { requestId: string }>();
  private readonly events: EventsWatcher[] = [];
  private readonly watchedChatEventDirs = new Set<string>();
  private authDisabled = false;

  private splitTelegramMessageText(text: string, chunkSize = 3500): string[] {
    const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const chunks: string[] = [];
    let remaining = normalized;
    while (remaining.length > chunkSize) {
      let splitAt = remaining.lastIndexOf("\n", chunkSize);
      if (splitAt < Math.floor(chunkSize / 2)) splitAt = chunkSize;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  private buildChatScopeId(chatId: string, messageThreadId?: number | null): string {
    return Number.isFinite(messageThreadId) && Number(messageThreadId) > 0
      ? `${chatId}__topic_${messageThreadId}`
      : chatId;
  }

  private parseChatScopeId(scopeId: string): { chatId: string; messageThreadId?: number } {
    const match = String(scopeId).match(/^(.*)__topic_(\d+)$/);
    if (!match) return { chatId: scopeId };
    return {
      chatId: match[1],
      messageThreadId: Number.parseInt(match[2], 10)
    };
  }

  private resolveEventScopeId(event: Pick<ChannelInboundMessage, "chatId" | "scopeId" | "messageThreadId">): string {
    return event.scopeId || this.buildChatScopeId(event.chatId, event.messageThreadId);
  }

  private buildTelegramSendOptions(messageThreadId?: number | null): Record<string, unknown> | undefined {
    return Number.isFinite(messageThreadId) && Number(messageThreadId) > 0
      ? { message_thread_id: messageThreadId }
      : undefined;
  }

  private mergeTelegramSendOptions(
    base: Record<string, unknown> | undefined,
    extra: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    if (base && extra) return { ...base, ...extra };
    return extra ?? base;
  }

  private getScopeIdFromTelegramContext(ctx: { chat?: { id?: string | number }; msg?: { message_thread_id?: number } }): string {
    const chatId = String(ctx.chat?.id ?? "");
    const messageThreadId = Number.isFinite(ctx.msg?.message_thread_id) ? Number(ctx.msg?.message_thread_id) : undefined;
    return this.buildChatScopeId(chatId, messageThreadId);
  }

  private buildTelegramCommandTarget(ctx: { chat?: { id?: string | number }; msg?: { message_thread_id?: number } }): TelegramCommandTarget {
    const chatId = String(ctx.chat?.id ?? "");
    const messageThreadId = Number.isFinite(ctx.msg?.message_thread_id) ? Number(ctx.msg?.message_thread_id) : undefined;
    return {
      chatId,
      scopeId: this.buildChatScopeId(chatId, messageThreadId),
      messageThreadId
    };
  }


  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore?: SessionStore,
    options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway; usageTracker: AiUsageTracker }
  ) {
    super({
      channel: "telegram",
      defaultWorkspaceName: "moli-t",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });
    this.commandService = new SharedRuntimeCommandService<TelegramCommandTarget>({
      channel: "telegram",
      instanceId: this.instanceId,
      workspaceDir: this.workspaceDir,
      authScopePrefix: "telegram",
      store: this.store,
      runners: this.runners,
      getSettings,
      updateSettings,
      getAuthScopeKey: (input) => `telegram:${input.chatId}`,
      isRunning: (scopeId) => this.running.has(scopeId),
      stopRun: (scopeId) => this.stopChatWork(scopeId),
      cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
      maybeHandleAcpCommand: (scopeId, cmd, rawArg, target) =>
        this.maybeHandleTelegramAcpCommand(scopeId, cmd, rawArg, target),
      sendText: (target, text) => this.sendTelegramCommandText(target, text),
      onSessionMutation: (scopeId) => {
        void this.writePromptPreview([this.parseChatScopeId(scopeId).chatId]);
      },
      getQueueSize: (scopeId) => this.chatQueues.get(scopeId)?.size() ?? 0,
      getStatusExtras: (_scopeId, target) => this.getTelegramStatusExtras(target),
      helpLines: ACP_CONTROL_HELP_LINES
    });
  }

  private summarizeForTelegram(text: string, max = 280): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1))}…`;
  }

  private async sendTelegramCommandText(target: TelegramCommandTarget, text: string): Promise<void> {
    if (!this.bot) return;
    const chunks = this.chunkTelegramText(text);
    const sendOptions = this.buildTelegramSendOptions(target.messageThreadId);
    for (const chunk of chunks) {
      await sendTelegramText(this.bot, target.chatId, chunk, sendOptions);
    }
  }

  private async maybeHandleTelegramAcpCommand(
    scopeId: string,
    cmd: string,
    rawArg: string,
    target: TelegramCommandTarget
  ): Promise<boolean> {
    if (!this.bot) return false;

    if (cmd === "/acp") {
      await handleSharedAcpCommand({
        acp: this.acp,
        chatId: scopeId,
        cmd,
        rawArg,
        sendText: async (replyText) => {
          await this.sendTelegramCommandText(target, replyText);
        },
        runPrompt: async ({ prompt, startText, kind }) => {
          await this.runAcpPrompt(this.bot!, scopeId, prompt, startText, kind);
        }
      });
      return true;
    }

    if (cmd === "/approve" || cmd === "/deny") {
      await handleSharedAcpApprovalCommand({
        acp: this.acp,
        chatId: scopeId,
        cmd,
        rawArg,
        sendText: async (replyText) => {
          await this.sendTelegramCommandText(target, replyText);
        }
      });
      return true;
    }

    return false;
  }

  private getTelegramStatusExtras(target: TelegramCommandTarget): string[] {
    return [
      `Stream output: ${this.isStreamingOutputEnabled() ? "on" : "off"}`,
      `Reply mode: ${target.messageThreadId ? "topic" : "chat"}`
    ];
  }

  private async handleTelegramSharedCommand(
    ctx: { chat: { id: string | number }; msg?: { text?: string; message_thread_id?: number } },
    allowed: Set<string>
  ): Promise<void> {
    const target = this.buildTelegramCommandTarget(ctx);
    if (allowed.size > 0 && !allowed.has(target.chatId)) return;
    await this.commandService.handle({
      chatId: target.chatId,
      scopeId: target.scopeId,
      text: String(ctx.msg?.text ?? ""),
      target
    });
  }

  private async runAcpPrompt(
    bot: Bot,
    scopeId: string,
    prompt: string,
    startText: string,
    kind: SharedAcpPromptKind
  ): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    const target = this.parseChatScopeId(scopeId);
    const chatId = target.chatId;
    const sendOptions = this.buildTelegramSendOptions(target.messageThreadId);
    const sent = await sendTelegramText(bot, chatId, startText, sendOptions);
    const progressState = createTelegramAcpProgressState(startText);
    let statusText = startText;
    let pendingStatusText: string | null = null;
    let statusFlush: Promise<void> | null = null;
    let lastStatusEditAt = 0;
    const statusEditIntervalMs = 1500;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const flushStatus = async () => {
      while (pendingStatusText && pendingStatusText !== statusText) {
        const nextText = pendingStatusText;
        pendingStatusText = null;
        const waitMs = Math.max(0, statusEditIntervalMs - (Date.now() - lastStatusEditAt));
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        try {
          await editTelegramText(bot, chatId, sent.message_id, nextText);
          lastStatusEditAt = Date.now();
        } catch (error) {
          momWarn("telegram", "acp_status_edit_failed", {
            chatId,
            messageId: sent.message_id,
            error: error instanceof Error ? error.message : String(error),
            errorDetails: describeTelegramError(error)
          });
        }
        statusText = nextText;
      }
      statusFlush = null;
    };
    const setStatus = async (text: string) => {
      if (text === statusText || text === pendingStatusText) return;
      pendingStatusText = text;
      if (!statusFlush) {
        statusFlush = flushStatus().catch((error) => {
          momWarn("telegram", "acp_status_flush_failed", {
            chatId,
            messageId: sent.message_id,
            error: error instanceof Error ? error.message : String(error),
            errorDetails: describeTelegramError(error)
          });
          statusFlush = null;
        });
      }
      await statusFlush;
    };

    const result = await this.acp.runTask(scopeId, trimmedPrompt, {
      onStatus: async () => undefined,
      onEvent: async (text) => {
        await sendTelegramText(
          bot,
          chatId,
          text,
          this.mergeTelegramSendOptions(sendOptions, {
            reply_parameters: { message_id: sent.message_id }
          })
        );
      },
      onProgress: async (event) => {
        await setStatus(applyTelegramAcpProgressEvent(progressState, event));
      },
      onPermissionRequest: async (permission) => {
        await this.sendAcpPermissionCard(bot, scopeId, permission, sent.message_id);
      }
    });

    const summaryLines = [
      kind === "remote" ? "## ACP Remote Result" : "## ACP Result",
      `- Stop reason: \`${result.stopReason}\``,
      `- Tool calls: ${result.toolCalls.length}`,
      result.lastStatus ? `- Last status: ${result.lastStatus}` : ""
    ].filter(Boolean);
    const completedTools = result.toolCalls.filter((tool) => tool.status === "completed");
    const failedTools = result.toolCalls.filter((tool) => tool.status === "failed");
    const touchedLocations = Array.from(
      new Set(
        completedTools
          .flatMap((tool) => tool.locations)
          .map((location) => location.trim())
          .filter(Boolean)
      )
    );
    if (completedTools.length > 0) {
      summaryLines.push(`- Completed tools: ${completedTools.length}`);
    }
    if (failedTools.length > 0) {
      summaryLines.push(`- Failed tools: ${failedTools.length}`);
    }
    if (touchedLocations.length > 0) {
      summaryLines.push(`- Touched: ${touchedLocations.slice(0, 8).map((location) => `\`${location}\``).join(", ")}`);
    }
    await sendTelegramText(
      bot,
      chatId,
      summaryLines.join("\n"),
      this.mergeTelegramSendOptions(sendOptions, {
        reply_parameters: { message_id: sent.message_id }
      })
    );
    if (result.assistantText) {
      const chunks = this.chunkTelegramText(result.assistantText);
      for (const chunk of chunks) {
        await sendTelegramText(
          bot,
          chatId,
          chunk,
          this.mergeTelegramSendOptions(sendOptions, {
            reply_parameters: { message_id: sent.message_id }
          })
        );
      }
    }
  }

  private async runAcpProxyPrompt(bot: Bot, scopeId: string, prompt: string): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    await this.runAcpPrompt(bot, scopeId, trimmedPrompt, `ACP proxy started\n${trimmedPrompt}`, "task");
  }

  private formatAcpPermissionOptionLabel(optionId: string, fallback: string): string {
    const normalized = optionId.toLowerCase();
    if (normalized.includes("execpolicy") || normalized.includes("dont") || normalized.includes("always")) {
      return "Always approve";
    }
    if (normalized.includes("approve") || normalized.includes("allow") || normalized.includes("yes")) {
      return "Approve";
    }
    if (normalized.includes("deny") || normalized.includes("reject") || normalized.includes("cancel") || normalized.includes("abort")) {
      return "Deny";
    }
    return fallback.length <= 28 ? fallback : `${fallback.slice(0, 27)}…`;
  }

  private registerAcpPermissionAction(
    scopeId: string,
    requestId: string,
    action: "select" | "deny" | "deny_with_note",
    optionId?: string
  ): string {
    const token = randomUUID().replace(/-/g, "").slice(0, 24);
    this.acpPermissionActions.set(token, { scopeId, requestId, action, optionId });
    return `acp:${token}`;
  }

  private buildAcpPermissionKeyboard(scopeId: string, permission: AcpPendingPermissionView): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    let buttonsInRow = 0;
    for (const option of permission.options.slice(0, 4)) {
      keyboard.text(
        this.formatAcpPermissionOptionLabel(option.optionId, option.name || option.optionId),
        this.registerAcpPermissionAction(scopeId, permission.id, "select", option.optionId)
      );
      buttonsInRow += 1;
      if (buttonsInRow >= 2) {
        keyboard.row();
        buttonsInRow = 0;
      }
    }

    if (buttonsInRow > 0) {
      keyboard.row();
    }

    keyboard
      .text("Deny", this.registerAcpPermissionAction(scopeId, permission.id, "deny"))
      .text("Deny with note", this.registerAcpPermissionAction(scopeId, permission.id, "deny_with_note"));

    return keyboard;
  }

  private async sendAcpPermissionCard(
    bot: Bot,
    scopeId: string,
    permission: AcpPendingPermissionView,
    replyTo?: number | null
  ): Promise<void> {
    const target = this.parseChatScopeId(scopeId);
    const keyboard = this.buildAcpPermissionKeyboard(scopeId, permission);
    await sendTelegramText(
      bot,
      target.chatId,
      buildAcpPermissionText(permission),
      {
        reply_markup: keyboard,
        ...this.buildTelegramSendOptions(target.messageThreadId),
        ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {})
      }
    );
  }

  apply(cfg: TelegramConfig): void {
    this.authDisabled = false;
    const token = cfg.token.trim();
    const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
    const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

    momLog("telegram", "apply", {
      botId: this.instanceId,
      hasToken: Boolean(token),
      allowedChatCount: allowedChatIds.length
    });

    if (!token) {
      this.stop();
      momWarn("telegram", "disabled_no_token", { botId: this.instanceId });
      return;
    }

    if (this.bot && this.currentToken === token && this.currentAllowedChatIdsKey === allowedChatIdsKey) {
      momLog("telegram", "apply_noop_same_token", { botId: this.instanceId });
      void this.writePromptPreview(allowedChatIds);
      return;
    }

    this.stop();

    const allowed = new Set(allowedChatIds);
    momLog("telegram", "allowed_chat_ids_loaded", {
      botId: this.instanceId,
      mode: allowed.size > 0 ? "whitelist" : "all_chats",
      allowedChatIds: Array.from(allowed)
    });
    const bot = new Bot(token);
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method !== "sendMessage") {
        return await prev(method, payload, signal);
      }

      const body = payload as Record<string, unknown>;
      const rawText = typeof body.text === "string" ? body.text : "";
      if (!rawText) {
        return await prev(method, payload, signal);
      }
      const chunks = this.splitTelegramMessageText(rawText);
      if (chunks.length <= 1) {
        return await prev(method, payload, signal);
      }

      let lastResult: unknown = null;
      for (let i = 0; i < chunks.length; i += 1) {
        const nextPayload =
          i === 0
            ? { ...body, text: chunks[i] }
            : { ...body, text: chunks[i], reply_parameters: undefined };
        lastResult = await prev(method, nextPayload as never, signal);
      }
      return lastResult;
    });

    bot.use(async (ctx, next) => {
      const message = ctx.msg;
      const chatId = String(ctx.chat?.id ?? "");
      const scopeId = this.getScopeIdFromTelegramContext(ctx);
      if (!message || !chatId) {
        await next();
        return;
      }
      if (allowed.size > 0 && !allowed.has(chatId)) {
        await next();
        return;
      }
      if (this.acpPermissionInputs.has(scopeId)) {
        await next();
        return;
      }
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        await next();
        return;
      }

      if (!await shouldProxyToAcpSession(this.acp, scopeId, text)) {
        await next();
        return;
      }

      try {
        await this.runAcpProxyPrompt(bot, scopeId, text);
      } catch (error) {
        await sendTelegramText(
          bot,
          chatId,
          error instanceof Error ? error.message : String(error),
          this.buildTelegramSendOptions(this.parseChatScopeId(scopeId).messageThreadId)
        );
      }
    });

    bot.command("chatid", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const scopeId = this.getScopeIdFromTelegramContext(ctx);
      const messageThreadId = Number.isFinite(ctx.msg?.message_thread_id) ? Number(ctx.msg.message_thread_id) : null;
      const chatType = ctx.chat.type;
      const allowedNow = allowed.size === 0 || allowed.has(chatId);
      await ctx.reply(
        [
          `chat_id: ${chatId}`,
          `scope_id: ${scopeId}`,
          `message_thread_id: ${messageThreadId ?? "none"}`,
          `chat_type: ${chatType}`,
          `allowed: ${allowedNow ? "yes" : "no"}`,
          allowed.size > 0 ? `whitelist_count: ${allowed.size}` : "whitelist_count: 0 (all chats allowed)"
        ].join("\n")
      );
      momLog("telegram", "chatid_command", { chatId, scopeId, chatType, allowed: allowedNow });
    });

    const sharedTelegramCommands = [
      "stop",
      "new",
      "clear",
      "sessions",
      "delete_sessions",
      "acp",
      "approve",
      "deny",
      "help",
      "start",
      "skills",
      "compact",
      "login",
      "logout",
      "models",
      "status",
      "state",
      "thinking"
    ] as const;

    for (const command of sharedTelegramCommands) {
      bot.command(command, async (ctx) => {
        await this.handleTelegramSharedCommand(ctx, allowed);
      });
    }

    bot.callbackQuery(/^acp:/, async (ctx) => {
      const callbackMessage = ctx.callbackQuery.message;
      const chatId = String(callbackMessage?.chat.id ?? "");
      const messageThreadId =
        callbackMessage && "message_thread_id" in callbackMessage && Number.isFinite(callbackMessage.message_thread_id)
          ? Number(callbackMessage.message_thread_id)
          : undefined;
      const scopeId = this.buildChatScopeId(chatId, messageThreadId);
      const sendOptions = this.buildTelegramSendOptions(messageThreadId);
      if (!chatId) {
        await ctx.answerCallbackQuery({ text: "Chat context is unavailable." });
        return;
      }
      if (allowed.size > 0 && !allowed.has(chatId)) {
        await ctx.answerCallbackQuery({ text: "Chat not allowed." });
        return;
      }

      const token = ctx.callbackQuery.data.slice(4);
      const action = this.acpPermissionActions.get(token);
      if (!action || action.scopeId !== scopeId) {
        await ctx.answerCallbackQuery({ text: "This permission request is no longer available." });
        return;
      }

      const messageId = callbackMessage?.message_id;
      const currentText =
        (callbackMessage && "text" in callbackMessage && typeof callbackMessage.text === "string")
          ? callbackMessage.text
          : null;

      try {
        if (action.action === "deny_with_note") {
          const permission = this.acp.getPendingPermission(scopeId, action.requestId);
          if (!permission) {
            this.acpPermissionActions.delete(token);
            await ctx.answerCallbackQuery({ text: "Request already resolved." });
            return;
          }
          this.acpPermissionInputs.set(scopeId, { requestId: action.requestId });
          await ctx.answerCallbackQuery({ text: "Send your note in the next message." });
          await sendTelegramText(
            bot,
            chatId,
            [
              `Reply with your note for ACP request \`${action.requestId}\`.`,
              "Your next text message will be recorded as an operator note and the request will be denied.",
              "Send `cancel` to keep the permission request pending."
            ].join("\n"),
            sendOptions
          );
          return;
        }

        const result = action.action === "select" && action.optionId
          ? await this.acp.respondToPermission(scopeId, action.requestId, action.optionId)
          : await this.acp.deny(scopeId, action.requestId);
        this.acpPermissionActions.delete(token);
        this.acpPermissionInputs.delete(scopeId);
        await ctx.answerCallbackQuery({
          text: action.action === "select" ? "Submitted." : "Denied."
        });
        if (messageId && currentText) {
          await editTelegramMessage(
            bot,
            chatId,
            messageId,
            `${currentText}\n\nResolved: ${result}`,
            { reply_markup: { inline_keyboard: [] } }
          );
        } else {
          await sendTelegramText(bot, chatId, result, sendOptions);
        }
      } catch (error) {
        this.acpPermissionActions.delete(token);
        await ctx.answerCallbackQuery({
          text: error instanceof Error ? this.summarizeForTelegram(error.message, 180) : "ACP action failed."
        });
      }
    });

    bot.on("message", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const messageThreadId = Number.isFinite(ctx.msg?.message_thread_id) ? Number(ctx.msg.message_thread_id) : undefined;
      const scopeId = this.buildChatScopeId(chatId, messageThreadId);
      const userId = String(ctx.msg?.from?.id ?? "unknown");
      const messageId = Number(ctx.msg?.message_id ?? Date.now());
      const rawText = typeof ctx.msg?.text === "string" ? ctx.msg.text.trim() : "";
      const initialStatusText = this.buildInboundRecognitionStatus(ctx.msg);
      let initialStatusMessageId: number | null = null;

      momLog("telegram", "message_received", {
        chatId,
        scopeId,
        userId,
        messageId,
        messageThreadId: messageThreadId ?? null,
        chatType: ctx.chat.type,
        hasText: Boolean(ctx.msg?.text || ctx.msg?.caption),
        hasDocument: Boolean(ctx.msg?.document),
        hasPhoto: Array.isArray(ctx.msg?.photo) && ctx.msg.photo.length > 0
      });

      if (allowed.size > 0 && !allowed.has(chatId)) {
        momWarn("telegram", "message_blocked_chat", { chatId, userId, messageId });
        return;
      }

      const pendingPermissionInput = this.acpPermissionInputs.get(scopeId);
      if (pendingPermissionInput && rawText) {
        if (/^cancel$/i.test(rawText)) {
          this.acpPermissionInputs.delete(scopeId);
          await ctx.reply(`Cancelled note entry for ACP request ${pendingPermissionInput.requestId}. Permission is still pending.`);
          return;
        }

        try {
          const result = await this.acp.deny(scopeId, pendingPermissionInput.requestId);
          this.acpPermissionInputs.delete(scopeId);
          await ctx.reply(
            [
              result,
              `Operator note: ${this.summarizeForTelegram(rawText, 500)}`,
              "If you want the ACP agent to try a different approach, send a new `/acp task ...` instruction."
            ].join("\n")
          );
        } catch (error) {
          this.acpPermissionInputs.delete(scopeId);
          await ctx.reply(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      if (initialStatusText) {
        try {
          const threadSendOptions = this.buildTelegramSendOptions(messageThreadId);
          await sendTelegramChatAction(bot, chatId, this.resolveInboundRecognitionAction(ctx.msg), threadSendOptions);
          const sent = await sendTelegramText(bot, chatId, initialStatusText, threadSendOptions);
          initialStatusMessageId = sent.message_id;
          momLog("telegram", "preprocess_status_sent", {
            chatId,
            userId,
            messageId,
            initialStatusMessageId,
            initialStatusText
          });
        } catch (error) {
          momWarn("telegram", "preprocess_status_failed", {
            chatId,
            userId,
            messageId,
            initialStatusText,
            error: error instanceof Error ? error.message : String(error),
            errorDetails: describeTelegramError(error)
          });
        }
      }

      const event = await this.toInboundEvent(ctx as any, token);
      if (!event) {
        if (initialStatusMessageId) {
          try {
            await bot.api.deleteMessage(chatId, initialStatusMessageId);
          } catch {
            // ignore
          }
        }
        momLog("telegram", "message_ignored_after_parse", { chatId, userId, messageId });
        return;
      }

      if (initialStatusText) {
        event.initialStatusText = initialStatusText;
      }
      if (initialStatusMessageId) {
        event.initialStatusMessageId = initialStatusMessageId;
      }

      const eventScopeId = this.resolveEventScopeId(event);
      const runId = createRunId(eventScopeId, event.messageId);
      (event as ChannelInboundMessage & { runId?: string }).runId = runId;

      const logged = this.store.logMessage(eventScopeId, {
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
        scopeId: eventScopeId,
        messageId: event.messageId,
        dedupeAccepted: logged,
        textLength: event.text.length,
        attachmentCount: event.attachments.length,
        imageCount: event.imageContents.length
      });

      if (!logged && !event.isEvent) {
        momWarn("telegram", "message_dedup_skipped", { runId, chatId, scopeId: eventScopeId, messageId: event.messageId });
        return;
      }

      try {
        const activeSessionId = this.store.getActiveSession(eventScopeId);
        const conv = this.sessions.getOrCreateConversation(
          "telegram",
          this.getSessionConversationKey(eventScopeId, activeSessionId)
        );
        this.sessions.appendMessage(conv.id, event.isEvent ? "system" : "user", event.text);
        momLog("telegram", "session_user_appended", {
          runId,
          chatId,
          scopeId: eventScopeId,
          sessionId: activeSessionId,
          conversationId: conv.id,
          role: event.isEvent ? "system" : "user"
        });
      } catch (error) {
        momWarn("telegram", "session_user_append_failed", {
          runId,
          chatId,
          scopeId: eventScopeId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const lowered = event.text.trim().toLowerCase();
      if (lowered === "stop" || lowered === "/stop") {
        const result = this.stopChatWork(eventScopeId);
        momLog("telegram", "stop_text_requested", { runId, chatId, scopeId: eventScopeId, aborted: result.aborted });
        if (result.aborted) {
          await ctx.reply("Stopping...");
        } else {
          await ctx.reply("Nothing running.");
        }
        return;
      }

      const queue = this.getQueue(eventScopeId);
      const queueBefore = queue.size();
      momLog("telegram", "queue_enqueue", { runId, chatId, scopeId: eventScopeId, queueBefore });
      if (this.running.has(eventScopeId) && !event.isEvent) {
        const pendingCount = queueBefore + 1;
        momLog("telegram", "message_queued_while_busy", { runId, chatId, scopeId: eventScopeId, pendingCount });
        await ctx.reply(`Queued. Pending: ${pendingCount}. Send /stop to cancel current task.`);
      }

      queue.enqueue(async () => {
        momLog("telegram", "queue_job_start", { runId, chatId, scopeId: eventScopeId });
        try {
          await this.processEvent(event, bot);
        } catch (error) {
          momError("telegram", "queue_job_uncaught", {
            runId,
            chatId,
            scopeId: eventScopeId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          await sendTelegramTextSafely(bot, chatId, "Internal error.", undefined, {
            runId,
            scopeId: eventScopeId,
            source: "queue_job_uncaught"
          });
        }
        momLog("telegram", "queue_job_end", { runId, chatId, scopeId: eventScopeId });
      });
    });

    bot.catch((err) => {
      const e = err as { error?: unknown };
      const raw = e.error;
      const message = raw instanceof Error ? raw.message : String(raw);
      momError("telegram", "bot_error", {
        error: message,
        errorDetails: describeTelegramError(raw)
      });
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
        const message = error instanceof Error ? error.message : String(error);
        momError("telegram", "adapter_start_failed", {
          botId: this.instanceId,
          error: message
        });
        this.disableInstanceOnAuthFailure(message);
      });

    this.bot = bot;
    this.currentToken = token;
    this.currentAllowedChatIdsKey = allowedChatIdsKey;
    this.startEventsWatchers(allowed);
    void this.writePromptPreview(Array.from(allowed));
  }

  private disableInstanceOnAuthFailure(errorMessage: string): void {
    if (this.authDisabled) return;
    if (!this.updateSettings) return;
    if (!/401/i.test(errorMessage) || !/unauthorized/i.test(errorMessage)) return;

    const settings = this.getSettings();
    const telegram = settings.channels?.telegram;
    if (!telegram || !Array.isArray(telegram.instances)) return;

    const nextInstances = telegram.instances.map((instance) => {
      if (instance.id !== this.instanceId) return instance;
      if (instance.enabled === false) return instance;
      return { ...instance, enabled: false };
    });

    const changed = nextInstances.some(
      (instance, index) => instance.enabled !== telegram.instances[index]?.enabled
    );
    if (!changed) return;

    this.authDisabled = true;
    this.updateSettings({
      channels: {
        ...settings.channels,
        telegram: {
          instances: nextInstances
        }
      }
    });

    momWarn("telegram", "instance_disabled_auth_failed", {
      botId: this.instanceId,
      reason: "telegram_api_401_unauthorized"
    });
  }

  stop(): void {
    void this.acp.dispose();
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

  private ensureChatEventsWatcher(scopeId: string): void {
    this.migrateLegacyChatEventDirs(scopeId);
    const eventsDir = join(this.store.getScratchDir(scopeId), ...TelegramManager.CHAT_EVENTS_RELATIVE_DIR);
    if (this.watchedChatEventDirs.has(eventsDir)) return;
    this.watchedChatEventDirs.add(eventsDir);
    this.addEventsWatcher(eventsDir, "chat-scratch", scopeId);
  }

  private migrateLegacyChatEventDirs(scopeId: string): void {
    const scratchDir = this.store.getScratchDir(scopeId);
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
          chatId: scopeId,
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
        chatId: scopeId,
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

  private isStreamingOutputEnabled(): boolean {
    const instance = this.getSettings().channels?.telegram?.instances?.find((item) => item.id === this.instanceId);
    const raw = String(instance?.credentials?.streamOutput ?? "").trim().toLowerCase();
    if (!raw) return true;
    return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
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
            const synthetic: ChannelInboundMessage = {
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
            (synthetic as ChannelInboundMessage & { runId?: string }).runId = runId;
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

  async triggerTask(event: unknown, filename: string): Promise<void> {
    const task = event as MomEvent;
    if (!task || typeof task !== "object" || typeof task.chatId !== "string" || typeof task.text !== "string") {
      throw new Error("Invalid task payload");
    }
    return this.handleSyntheticEvent(task, filename);
  }

  private async deliverDirectEventMessage(event: MomEvent, runId: string, filename: string): Promise<void> {
    if (!this.bot) return;
    const target = this.parseChatScopeId(event.chatId);
    const sent = await sendTelegramText(
      this.bot,
      target.chatId,
      event.text,
      this.buildTelegramSendOptions(target.messageThreadId)
    );
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

  private async processEvent(event: ChannelInboundMessage, bot: Bot): Promise<void> {
    const scopeId = this.resolveEventScopeId(event);
    const parsedScope = this.parseChatScopeId(scopeId);
    const chatId = parsedScope.chatId;
    const messageThreadId = event.messageThreadId ?? parsedScope.messageThreadId;
    const sendOptions = this.buildTelegramSendOptions(messageThreadId);
    this.ensureChatEventsWatcher(scopeId);
    const sessionId = event.sessionId || this.store.getActiveSession(scopeId);
    const sessionThinkingLevelOverride = this.store.getSessionThinkingLevelOverride(scopeId, sessionId);
    const runner = this.runners.get(scopeId, sessionId);
    const runId = (event as ChannelInboundMessage & { runId?: string }).runId ?? createRunId(scopeId, event.messageId);
    const streamOutputEnabled = this.isStreamingOutputEnabled();
    this.running.add(scopeId);

    momLog("telegram", "process_start", {
      runId,
      chatId,
      scopeId,
      messageThreadId: messageThreadId ?? null,
      sessionId,
      sessionThinkingLevelOverride: sessionThinkingLevelOverride ?? "default",
      messageId: event.messageId,
      userId: event.userId,
      isEvent: Boolean(event.isEvent),
      streamOutputEnabled
    });

    const status: StatusSession = {
      statusMessageId: event.initialStatusMessageId ?? null,
      threadMessageIds: [],
      accumulatedText: event.initialStatusText ?? "",
      isWorking: true
    };
    const seededStatusText = event.initialStatusText?.trim() || "";
    let hasAssistantDelta = false;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const isTelegramRateLimitError = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error ?? "");
      return message.includes("Too Many Requests") || message.includes("(429:");
    };
    const isTelegramMissingEditTargetError = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error ?? "");
      return (
        message.includes("message to edit not found") ||
        message.includes("message identifier is not specified")
      );
    };
    let lastRenderAt = 0;
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let renderPending = false;
    let forceNextRender = false;
    let renderInFlight: Promise<void> | null = null;

    const performRender = async (text: string): Promise<void> => {
      const display = status.isWorking ? `${text} ...` : text;
      if (status.statusMessageId) {
        try {
          await editTelegramText(bot, chatId, status.statusMessageId, display, {
            maxRetryAfterMs: TelegramManager.STREAM_EDIT_RETRY_AFTER_CAP_MS,
            requestTimeoutMs: TelegramManager.STREAM_EDIT_REQUEST_TIMEOUT_MS
          });
          lastRenderAt = Date.now();
          momLog("telegram", "status_edited", {
            runId,
            chatId,
            statusMessageId: status.statusMessageId,
            displayLength: display.length
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isTelegramRateLimitError(error)) {
            momWarn("telegram", "status_edit_skipped_rate_limited", {
              runId,
              chatId,
              statusMessageId: status.statusMessageId,
              error: message,
              errorDetails: describeTelegramError(error)
            });
            return;
          }
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
            error: message,
            errorDetails: describeTelegramError(error)
          });
          if (isTelegramMissingEditTargetError(error)) {
            status.statusMessageId = null;
          } else {
            return;
          }
        }
      }

      const sent = await sendTelegramText(bot, chatId, display, sendOptions);
      status.statusMessageId = sent.message_id;
      lastRenderAt = Date.now();
      momLog("telegram", "status_sent", {
        runId,
        chatId,
        statusMessageId: status.statusMessageId,
        displayLength: display.length
      });
    };

    const clearRenderTimer = () => {
      if (!renderTimer) return;
      clearTimeout(renderTimer);
      renderTimer = null;
    };

    const flushQueuedRender = async (): Promise<void> => {
      clearRenderTimer();
      if (renderInFlight || !renderPending) return;
      renderPending = false;
      const forceRender = forceNextRender;
      forceNextRender = false;

      renderInFlight = (async () => {
        if (!forceRender && status.statusMessageId && lastRenderAt > 0) {
          const waitMs = Math.max(0, TelegramManager.STREAM_RENDER_INTERVAL_MS - (Date.now() - lastRenderAt));
          if (waitMs > 0) {
            await sleep(waitMs);
          }
        }
        await performRender(status.accumulatedText);
      })().finally(() => {
        renderInFlight = null;
        if (renderPending) {
          scheduleRender(forceNextRender);
        }
      });

      await renderInFlight;
    };

    const scheduleRender = (force = false): void => {
      renderPending = true;
      forceNextRender = forceNextRender || force;
      if (force) {
        clearRenderTimer();
      }
      if (renderInFlight || renderTimer) return;

      const delayMs = forceNextRender || !status.statusMessageId || lastRenderAt === 0
        ? 0
        : Math.max(0, TelegramManager.STREAM_RENDER_INTERVAL_MS - (Date.now() - lastRenderAt));

      renderTimer = setTimeout(() => {
        renderTimer = null;
        void flushQueuedRender();
      }, delayMs);
    };

    const forceRenderNow = async (): Promise<void> => {
      renderPending = true;
      forceNextRender = true;
      clearRenderTimer();
      if (renderInFlight) {
        await renderInFlight;
      }
      if (renderPending) {
        await flushQueuedRender();
      }
    };

    const ctx: MomContext = {
      channel: "telegram",
      message: event,
      workspaceDir: this.workspaceDir,
      chatDir: this.store.getChatDir(scopeId),
      thinkingLevelOverride: sessionThinkingLevelOverride ?? undefined,
      respond: async (text, shouldLog = true) => {
        status.accumulatedText = status.accumulatedText ? `${status.accumulatedText}\n${text}` : text;
        momLog("telegram", "ctx_respond", {
          runId,
          chatId,
          deltaLength: text.length,
          accumulatedLength: status.accumulatedText.length,
          shouldLog
        });
        if (streamOutputEnabled) {
          scheduleRender();
        }
        if (streamOutputEnabled && shouldLog && status.statusMessageId) {
          this.store.logBotResponse(scopeId, text, status.statusMessageId);
          momLog("telegram", "ctx_respond_logged", { runId, chatId, scopeId, statusMessageId: status.statusMessageId });
        }
      },
      replaceMessage: async (text) => {
        status.accumulatedText = text;
        momLog("telegram", "ctx_replace", { runId, chatId, textLength: text.length });
        if (streamOutputEnabled) {
          scheduleRender();
        }
      },
      respondInThread: async (text) => {
        const sent = status.statusMessageId
          ? await sendTelegramText(
            bot,
            chatId,
            text,
            this.mergeTelegramSendOptions(sendOptions, {
              reply_parameters: { message_id: status.statusMessageId }
            })
          )
          : await sendTelegramText(bot, chatId, text, sendOptions);
        status.threadMessageIds.push(sent.message_id);
        momLog("telegram", "ctx_thread_reply", {
          runId,
          chatId,
          replyTo: status.statusMessageId ?? null,
          threadMessageId: sent.message_id,
          textLength: text.length
        });
      },
      setTyping: async (isTyping) => {
        momLog("telegram", "ctx_set_typing", { runId, chatId, isTyping });
        if (!isTyping) return;
        await sendTelegramChatAction(bot, chatId, "typing", sendOptions);
        if (
          streamOutputEnabled &&
          (!status.statusMessageId || (seededStatusText && status.accumulatedText.trim() === seededStatusText))
        ) {
          status.accumulatedText = event.isEvent ? "Starting event" : "Thinking";
          await forceRenderNow();
        }
      },
      setWorking: async (isWorking) => {
        status.isWorking = isWorking;
        momLog("telegram", "ctx_set_working", { runId, chatId, isWorking });
        if (streamOutputEnabled && status.statusMessageId) {
          await forceRenderNow();
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
            await sendTelegramText(bot, chatId, text, sendOptions);
            return;
          }
        }

        const name = isText ? this.normalizeTextAttachmentName(rawName) : rawName;
        const imageMime = this.detectImageMime(name, bytes);
        const audioMime = this.detectAudioMime(name, bytes);
        momLog("telegram", "ctx_upload_file", {
          runId,
          chatId,
          filePath,
          rawName,
          finalName: name,
          isText,
          imageMime: imageMime ?? null,
          audioMime: audioMime ?? null
        });
        if (imageMime) {
          try {
            await bot.api.sendPhoto(chatId, new InputFile(bytes, name), {
              ...(sendOptions ?? {}),
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

        if (audioMime) {
          try {
            if (audioMime === "audio/ogg") {
              await bot.api.sendVoice(chatId, new InputFile(bytes, name), {
                ...(sendOptions ?? {}),
                caption: name
              });
            } else {
              await bot.api.sendAudio(chatId, new InputFile(bytes, name), {
                ...(sendOptions ?? {}),
                caption: name,
                title: name
              });
            }
            return;
          } catch (error) {
            momWarn("telegram", "ctx_upload_audio_failed_fallback_document", {
              runId,
              chatId,
              filePath,
              name,
              audioMime,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        await bot.api.sendDocument(chatId, new InputFile(bytes, name), {
          ...(sendOptions ?? {}),
          caption: name
        });
      },
      onRunnerEvent: async (runnerEvent) => {
        if (runnerEvent.type === "thinking_config") {
          momLog("telegram", "runner_thinking_config", {
            runId,
            chatId,
            scopeId,
            provider: runnerEvent.provider,
            model: runnerEvent.model,
            requestedThinkingLevel: runnerEvent.requestedThinkingLevel,
            effectiveThinkingLevel: runnerEvent.effectiveThinkingLevel,
            reasoningSupported: runnerEvent.reasoningSupported
          });
          return;
        }

        if (runnerEvent.type === "payload") {
          momLog("telegram", "runner_payload_reasoning", {
            runId,
            chatId,
            scopeId,
            provider: runnerEvent.provider,
            model: runnerEvent.model,
            requestedThinkingLevel: runnerEvent.requestedThinkingLevel,
            effectiveThinkingLevel: runnerEvent.effectiveThinkingLevel,
            summary: runnerEvent.summary
          });
          return;
        }

        if (runnerEvent.type !== "assistant_message_event") return;
        if (runnerEvent.event.type !== "text_delta" || !streamOutputEnabled) return;

        status.accumulatedText = hasAssistantDelta
          ? `${status.accumulatedText}${runnerEvent.event.delta}`
          : runnerEvent.event.delta;
        hasAssistantDelta = true;
        scheduleRender();
      }
    };

    try {
      const result = await runner.run(ctx);
      if (streamOutputEnabled && status.accumulatedText.trim()) {
        await forceRenderNow();
      }
      if (!streamOutputEnabled && status.accumulatedText.trim()) {
        await performRender(status.accumulatedText.trim());
      }
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
            this.getSessionConversationKey(scopeId, sessionId)
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
        await sendTelegramTextSafely(bot, chatId, "Stopped.", sendOptions, {
          runId,
          scopeId,
          source: "process_aborted"
        });
      }
    } catch (error) {
      momError("telegram", "process_failed", {
        runId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
        errorDetails: describeTelegramError(error)
      });
      await sendTelegramTextSafely(bot, chatId, "Internal error.", sendOptions, {
        runId,
        scopeId,
        source: "process_failed"
      });
    } finally {
      clearRenderTimer();
      this.running.delete(scopeId);
      momLog("telegram", "process_end", { runId, chatId, scopeId });
    }
  }

  private chunkTelegramText(text: string, chunkSize = 3500): string[] {
    const normalized = text.trim();
    if (!normalized) return [];
    const chunks: string[] = [];
    let remaining = normalized;
    while (remaining.length > chunkSize) {
      let splitAt = remaining.lastIndexOf("\n", chunkSize);
      if (splitAt < Math.floor(chunkSize / 2)) splitAt = chunkSize;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
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

  private shouldTriggerGroupMessage(text: string, replyToBot: boolean, messageThreadId?: number): boolean {
    if (Number.isFinite(messageThreadId) && Number(messageThreadId) > 0) return true;
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

  private detectAudioMime(filename: string, data: Buffer): string | undefined {
    const fromExt = this.mimeFromFilename(filename);
    if (fromExt?.startsWith("audio/")) {
      return fromExt;
    }

    // OGG container ("OggS"), used by Telegram voice notes.
    if (
      data.length >= 4 &&
      data[0] === 0x4f &&
      data[1] === 0x67 &&
      data[2] === 0x67 &&
      data[3] === 0x53
    ) {
      return "audio/ogg";
    }

    // ID3-tagged MP3.
    if (
      data.length >= 3 &&
      data[0] === 0x49 &&
      data[1] === 0x44 &&
      data[2] === 0x33
    ) {
      return "audio/mpeg";
    }

    // MP3 frame sync without ID3.
    if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
      return "audio/mpeg";
    }

    // RIFF/WAVE.
    if (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x41 &&
      data[10] === 0x56 &&
      data[11] === 0x45
    ) {
      return "audio/wav";
    }

    // MP4/M4A family.
    if (
      data.length >= 12 &&
      data[4] === 0x66 &&
      data[5] === 0x74 &&
      data[6] === 0x79 &&
      data[7] === 0x70
    ) {
      return "audio/mp4";
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

  private async toInboundEvent(ctx: any, token: string): Promise<ChannelInboundMessage | null> {
    const msg = ctx.msg;
    if (!msg) return null;

    const chatId = String(ctx.chat.id);
    const chatType = (ctx.chat.type || "private") as ChannelInboundMessage["chatType"];
    const messageThreadId = Number.isFinite(msg.message_thread_id) ? Number(msg.message_thread_id) : undefined;
    const scopeId = this.buildChatScopeId(chatId, messageThreadId);
    const rawText = String(msg.text || msg.caption || "");

    const replyToBot = Boolean(msg.reply_to_message?.from?.is_bot);
    if ((chatType === "group" || chatType === "supergroup") && !this.shouldTriggerGroupMessage(rawText, replyToBot, messageThreadId)) {
      momLog("telegram", "group_message_ignored_no_mention", { chatId, messageId: msg.message_id });
      return null;
    }

    let cleaned = (chatType === "group" || chatType === "supergroup") ? this.stripMention(rawText) : rawText.trim();
    if (!cleaned && !msg.document && !msg.photo && !msg.voice && !msg.audio) {
      momLog("telegram", "message_ignored_empty", { chatId, messageId: msg.message_id });
      return null;
    }

    const ts = `${msg.date}.${String(msg.message_id).padStart(6, "0")}`;
    const attachments: ChannelInboundMessage["attachments"] = [];
    const imageContents: ChannelInboundMessage["imageContents"] = [];

    if (msg.document?.file_id) {
      const filename = msg.document.file_name || `${msg.document.file_id}.bin`;
      const data = await this.downloadTelegramFile(token, msg.document.file_id);
      if (data) {
        const mime = msg.document.mime_type || this.mimeFromFilename(filename);
        const saved = this.store.saveAttachment(scopeId, filename, ts, data, {
          mediaType: mime?.startsWith("image/")
            ? "image"
            : mime?.startsWith("audio/")
              ? "audio"
              : "file",
          mimeType: mime
        });
        attachments.push(saved);

        if (saved.isImage && mime) {
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
          const saved = this.store.saveAttachment(scopeId, filename, ts, data, {
            mediaType: "image",
            mimeType: "image/jpeg"
          });
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
        const saved = this.store.saveAttachment(scopeId, filename, ts, data, {
          mediaType: "audio",
          mimeType: this.detectAudioMime(filename, data) || msg.voice.mime_type || "audio/ogg"
        });
        attachments.push(saved);
      }
    }

    if (msg.audio?.file_id) {
      const ext = this.resolveAudioExt(msg.audio.mime_type);
      const filename = msg.audio.file_name || `${msg.audio.file_id}${ext}`;
      const data = await this.downloadTelegramFile(token, msg.audio.file_id);
      if (data) {
        const saved = this.store.saveAttachment(scopeId, filename, ts, data, {
          mediaType: "audio",
          mimeType: this.detectAudioMime(filename, data) || msg.audio.mime_type || this.mimeFromFilename(filename)
        });
        attachments.push(saved);
      }
    }

    if (!cleaned) {
      if (msg.voice || msg.audio) {
        cleaned = "(voice message received; transcription unavailable)";
      } else {
        cleaned = "(attachment)";
      }
    }

    return {
      chatId,
      scopeId,
      chatType,
      messageId: msg.message_id,
      messageThreadId,
      userId: String(msg.from?.id ?? "unknown"),
      userName: msg.from?.username || msg.from?.first_name,
      text: cleaned,
      ts,
      attachments,
      imageContents
    };
  }

  private buildInboundRecognitionStatus(msg: any): string | null {
    const hasImage = this.hasInboundImage(msg);
    const hasAudio = this.hasInboundAudio(msg);
    if (hasImage && hasAudio) return "Recognizing image and audio";
    if (hasImage) return "Recognizing image";
    if (hasAudio) return "Recognizing audio";
    return null;
  }

  private resolveInboundRecognitionAction(msg: any): "typing" | "upload_photo" | "record_voice" {
    const hasImage = this.hasInboundImage(msg);
    const hasAudio = this.hasInboundAudio(msg);
    if (hasImage && !hasAudio) return "upload_photo";
    if (hasAudio && !hasImage) return "record_voice";
    return "typing";
  }

  private hasInboundImage(msg: any): boolean {
    if (Array.isArray(msg?.photo) && msg.photo.length > 0) return true;
    if (!msg?.document?.file_id) return false;
    const mime = String(msg.document.mime_type || "");
    const filename = String(msg.document.file_name || "");
    return mime.startsWith("image/") || Boolean(this.detectImageMime(filename, Buffer.alloc(0)));
  }

  private hasInboundAudio(msg: any): boolean {
    if (msg?.voice?.file_id || msg?.audio?.file_id) return true;
    if (!msg?.document?.file_id) return false;
    const mime = String(msg.document.mime_type || "");
    const filename = String(msg.document.file_name || "");
    return mime.startsWith("audio/") || Boolean(this.detectAudioMime(filename, Buffer.alloc(0)));
  }
}
