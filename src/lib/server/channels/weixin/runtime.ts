import { appendFileSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { filterWeixinMarkdown } from "#weixin-agent-sdk/src/messaging/send.js";
import { type IncomingMessage, WeixinBot } from "./client.js";
import type { RuntimeSettings } from "../../settings/index.js";
import type { EventDeliveryMode, MomEvent } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { ModelErrorTracker } from "../../usage/modelErrorTracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { BasicChannelAcpTemplate } from "../shared/acp.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import { rebuildImageContentsFromAttachments } from "../shared/attachmentImageContents.js";
import { InboundTaskCoordinator } from "../shared/inboundCoordinator.js";
import { SqliteOutbox } from "../shared/outbox.js";
import { extractWeixinAttachments, extractWeixinText, hasWeixinInlineVoiceTranscript } from "./media.js";
import { sendWeixinFile } from "./outbound.js";

export interface WeixinConfig {
  baseUrl?: string;
  allowedChatIds: string[];
}

interface WeixinInboundEvent extends ChannelInboundMessage {
  sourceMessage: IncomingMessage;
}

interface WeixinTextOutboxPayload {
  chatId: string;
  text: string;
  preferReply: boolean;
  sourceMessageId: string;
  contextToken: string;
}

interface WeixinQueuedTaskPayload {
  event: Omit<WeixinInboundEvent, "imageContents" | "sourceMessage">;
  sourceMessage: {
    userId: string;
    text: string;
    type: IncomingMessage["type"];
    rawMessageId: number;
    contextToken: string;
    timestamp: string;
  };
}

function hashNumber(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function normalizeTimestamp(value: Date): string {
  const millis = Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
  return `${Math.floor(millis / 1000)}.${String(millis % 1000).padStart(3, "0")}`;
}

function normalizeText(text: string): string {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

function isInlineTextFile(filePath: string): boolean {
  return [".txt", ".md", ".json", ".csv", ".log"].includes(extname(filePath).toLowerCase());
}

export class WeixinManager extends BaseChannelRuntime {
  private readonly acpTemplate: BasicChannelAcpTemplate<IncomingMessage>;
  private readonly commandService: SharedRuntimeCommandService<IncomingMessage>;

  private bot: WeixinBot | undefined;
  private startSequence = 0;
  private startPromise: Promise<void> | null = null;
  private currentBaseUrl = "";
  private currentAllowedChatIdsKey = "";
  private stopped = true;
  private readonly outbox: SqliteOutbox<WeixinTextOutboxPayload, { delivered: true }>;
  private readonly inboundTasks: InboundTaskCoordinator<WeixinQueuedTaskPayload, IncomingMessage>;

  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore?: SessionStore,
    options?: {
      workspaceDir?: string;
      instanceId?: string;
      memory: MemoryGateway;
      usageTracker: AiUsageTracker;
      modelErrorTracker: ModelErrorTracker;
    }
  ) {
    super({
      channel: "weixin",
      defaultWorkspaceName: "moli-wx",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });
    this.acpTemplate = new BasicChannelAcpTemplate<IncomingMessage>({
      acp: this.acp,
      sendText: async (chatId, sourceMessage, text) => {
        await this.replyCommand(chatId, sourceMessage, text);
      },
      runPrompt: async (chatId, sourceMessage, request) => {
        await this.runAcpPrompt(chatId, sourceMessage, request.prompt, request.startText);
      }
    });
    this.inboundTasks = new InboundTaskCoordinator<WeixinQueuedTaskPayload, IncomingMessage>({
      channel: "weixin",
      instanceId: this.instanceId,
      process: async (payload) => {
        try {
          await this.processEvent(this.rehydrateQueuedEvent(payload));
        } catch (error) {
          momError("weixin", "queue_job_uncaught", {
            botId: this.instanceId,
            chatId: payload.event.chatId,
            queueId: payload.event.messageId,
            error: error instanceof Error ? error.message : String(error)
          });
          await this.sendText(
            payload.event.chatId,
            this.rehydrateSourceMessage(payload.sourceMessage),
            "Internal error."
          );
          throw error;
        }
      },
      enqueueFrontFromCommand: async (input, text) => this.enqueueSyntheticTask(input.scopeId, input.target, text, true)
    });
    this.commandService = this.createSharedCommandService<IncomingMessage>({
      authScopePrefix: "weixin",
      isRunning: (scopeId) => this.running.has(scopeId),
      stopRun: (scopeId) => this.stopChatWork(scopeId),
      cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
      maybeHandleAcpCommand: (scopeId, cmd, rawArg, sourceMessage) =>
        this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, sourceMessage),
      sendText: (sourceMessage, text) => this.replyCommand((sourceMessage as IncomingMessage).userId, sourceMessage, text),
      onSessionMutation: (scopeId) => {
        void this.writePromptPreview([scopeId]);
      },
      ...this.inboundTasks.toCommandOptions(),
      helpLines: this.acpTemplate.helpLines()
    });
    this.outbox = new SqliteOutbox<WeixinTextOutboxPayload, { delivered: true }>({
      channel: "weixin",
      instanceId: this.instanceId,
      deliver: async (payload, record) => {
        await this.deliverTextNow(payload, record.id);
        return { delivered: true };
      }
    });
  }

  apply(cfg: WeixinConfig): void {
    const baseUrl = String(cfg.baseUrl ?? "").trim();
    const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
    const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

    momLog("weixin", "apply", {
      botId: this.instanceId,
      hasBaseUrl: Boolean(baseUrl),
      allowedChatCount: allowedChatIds.length
    });

    if (
      this.bot &&
      this.currentBaseUrl === baseUrl &&
      this.currentAllowedChatIdsKey === allowedChatIdsKey
    ) {
      momLog("weixin", "apply_noop_same_config", { botId: this.instanceId });
      return;
    }

    this.stop();

    this.currentBaseUrl = baseUrl;
    this.currentAllowedChatIdsKey = allowedChatIdsKey;
    this.stopped = false;

    const allowed = new Set(allowedChatIds);
    momLog("weixin", "allowed_chat_ids_loaded", {
      mode: allowed.size > 0 ? "whitelist" : "all_chats",
      allowedChatIds: Array.from(allowed)
    });

    const startId = ++this.startSequence;
    this.startPromise = this.startBot(startId, allowed, baseUrl);
    void this.writePromptPreview(allowedChatIds);
  }

  stop(): void {
    this.stopped = true;
    this.startSequence += 1;
    this.startPromise = null;
    if (this.bot) {
      try {
        this.bot.stop();
      } catch (error) {
        momWarn("weixin", "adapter_stop_failed", {
          botId: this.instanceId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.bot = undefined;
    this.currentBaseUrl = "";
    this.currentAllowedChatIdsKey = "";
    void this.acp.dispose();
    momLog("weixin", "adapter_stopped", { botId: this.instanceId });
  }

  private async startBot(startId: number, allowed: Set<string>, baseUrl: string): Promise<void> {
    const bot = new WeixinBot({
      ...(baseUrl ? { baseUrl } : {}),
      onError: (error) => {
        momWarn("weixin", "sdk_error", {
          botId: this.instanceId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    bot.onMessage((message) => {
      void this.handleIncomingMessage(startId, allowed, message);
    });

    this.bot = bot;

    try {
      momLog("weixin", "login_start", {
        botId: this.instanceId,
        workspaceDir: this.workspaceDir
      });
      await bot.login();
      if (this.stopped || startId !== this.startSequence || this.bot !== bot) {
        bot.stop();
        return;
      }

      momLog("weixin", "adapter_started", {
        botId: this.instanceId,
        allowedChatCount: allowed.size
      });

      await this.outbox.resume();
      await this.inboundTasks.resumeAll();

      await bot.run();
    } catch (error) {
      if (this.stopped || startId !== this.startSequence) {
        return;
      }
      momError("weixin", "adapter_start_failed", {
        botId: this.instanceId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (this.bot === bot) {
        this.bot = undefined;
      }
      if (!this.stopped && startId === this.startSequence) {
        momWarn("weixin", "adapter_stopped_unexpectedly", { botId: this.instanceId });
      }
    }
  }

  private async sendAcpPermissionCard(chatId: string, sourceMessage: IncomingMessage, permission: AcpPendingPermissionView): Promise<void> {
    await this.replyCommand(chatId, sourceMessage, buildAcpPermissionText(permission));
  }

  private async runAcpPrompt(chatId: string, sourceMessage: IncomingMessage, prompt: string, startText: string): Promise<void> {
    await this.replyCommand(chatId, sourceMessage, startText);
    let lastStatus = startText;
    const result = await this.acp.runTask(chatId, prompt, {
      onStatus: async (text) => {
        lastStatus = text;
      },
      onEvent: async (text) => {
        await this.replyCommand(chatId, sourceMessage, text);
      },
      onPermissionRequest: async (permission) => {
        await this.sendAcpPermissionCard(chatId, sourceMessage, permission);
      }
    });

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
    const summaryLines = [
      "ACP result:",
      `Stop reason: ${result.stopReason}`,
      `Tool calls: ${result.toolCalls.length}`,
      lastStatus ? `Last status: ${lastStatus}` : ""
    ].filter(Boolean);
    if (completedTools.length > 0) summaryLines.push(`Completed tools: ${completedTools.length}`);
    if (failedTools.length > 0) summaryLines.push(`Failed tools: ${failedTools.length}`);
    if (touchedLocations.length > 0) summaryLines.push(`Touched: ${touchedLocations.slice(0, 8).join(", ")}`);
    await this.replyCommand(chatId, sourceMessage, summaryLines.join("\n"));
    if (result.assistantText.trim()) {
      await this.replyCommand(chatId, sourceMessage, result.assistantText.trim());
    }
  }

  private async handleIncomingMessage(startId: number, allowed: Set<string>, message: IncomingMessage): Promise<void> {
    if (this.stopped || startId !== this.startSequence || !this.bot) return;

    const chatId = String(message.userId ?? "").trim();
    const messageId = String(message.raw.message_id ?? "").trim();
    const ts = normalizeTimestamp(message.timestamp);
    const rawText = extractWeixinText(message);
    const text = normalizeText(rawText);
    const hasInlineAudioTranscript = hasWeixinInlineVoiceTranscript(message);

    if (!chatId || !messageId) {
      momWarn("weixin", "message_ignored_missing_identity", {
        botId: this.instanceId,
        chatId,
        messageId
      });
      return;
    }

    if (allowed.size > 0 && !allowed.has(chatId)) {
      momWarn("weixin", "message_blocked_chat", { botId: this.instanceId, chatId, messageId });
      return;
    }

    if (!this.markInboundMessageSeen(chatId, messageId)) {
      momWarn("weixin", "message_dedup_skipped_raw", { botId: this.instanceId, chatId, messageId });
      return;
    }

    const { attachments, imageContents } = await extractWeixinAttachments({
      chatId,
      ts,
      store: this.store,
      message,
      onWarning: (warning) => {
        momWarn("weixin", "media_extract_failed", {
          botId: this.instanceId,
          chatId,
          messageId,
          warning
        });
      }
    });

    momLog("weixin", "message_received_raw", {
      botId: this.instanceId,
      chatId,
      messageId,
      type: message.type,
      textLength: text.length,
      attachmentCount: attachments.length,
      imageCount: imageContents.length
    });

    if (!text && attachments.length === 0 && imageContents.length === 0) {
      momLog("weixin", "message_ignored_empty", { botId: this.instanceId, chatId, messageId });
      return;
    }

    const lowered = text.toLowerCase();
    try {
      if (await this.acpTemplate.maybeProxy(chatId, text, message)) {
        return;
      }
    } catch (error) {
      await this.replyCommand(chatId, message, error instanceof Error ? error.message : String(error));
      return;
    }

    const commandText = lowered === "stop" ? "/stop" : text;
    if (lowered.startsWith("/") || lowered === "stop") {
      const handled = await this.handleCommand(chatId, commandText, message);
      if (handled) {
        return;
      }
    }

    const event: WeixinInboundEvent = {
      chatId,
      chatType: "private",
      messageId: Number(message.raw.message_id ?? Date.now()),
      userId: chatId,
      text: text || (attachments.some((item) => item.isAudio) ? "(voice message received; transcription unavailable)" : "(attachment)"),
      ts,
      attachments,
      imageContents,
      hasInlineAudioTranscript,
      sourceMessage: message
    };

    const runId = createRunId(chatId, event.messageId);
    (event as WeixinInboundEvent & { runId?: string }).runId = runId;

    const logged = this.store.logMessage(chatId, {
      date: new Date().toISOString(),
      ts: event.ts,
      messageId: event.messageId,
      user: event.userId,
      userName: event.userName,
      text: event.text,
      attachments: event.attachments,
      isBot: false
    });

    if (!logged) {
      momWarn("weixin", "message_dedup_skipped", { botId: this.instanceId, runId, chatId, messageId: event.messageId });
      return;
    }

    const queuedEvent: WeixinInboundEvent = {
      ...event,
      sessionId: this.store.getActiveSession(chatId),
      imageContents: []
    };

    const pendingCount = this.inboundTasks.size(chatId);
    if (pendingCount > 0 || this.running.has(chatId)) {
      momLog("weixin", "message_queued_while_busy", {
        botId: this.instanceId,
        runId,
        chatId,
        pendingCount
      });
    }
    this.inboundTasks.enqueue(chatId, this.serializeQueuedEvent(queuedEvent), { preview: queuedEvent.text });
  }

  private async processEvent(event: WeixinInboundEvent, preferReplyInitial = true): Promise<void> {
    const chatId = event.chatId;
    let preferReply = preferReplyInitial;
    await this.runSharedTextTask(chatId, event, {
      response: {
        sendText: async (text) => {
          await this.sendText(chatId, event.sourceMessage, text, preferReply);
          preferReply = false;
          return null;
        },
        setTyping: async (isTyping) => {
          if (!this.bot) return;
          try {
            if (isTyping) {
              await this.bot.sendTyping(chatId);
            } else {
              await this.bot.stopTyping(chatId);
            }
          } catch (error) {
            momWarn("weixin", "typing_update_failed", {
              botId: this.instanceId,
              chatId,
              isTyping,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      },
      createBotMessageId: () => hashNumber(`${Date.now()}-${Math.random()}`),
      normalizeText,
      onSessionAppendWarning: (error) => {
        momWarn("weixin", "session_assistant_append_failed", {
          botId: this.instanceId,
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      },
      replaceWithoutEdit: async (text, state) => {
        if (!state.hasResponded) {
          await this.sendText(chatId, event.sourceMessage, text, preferReply);
          preferReply = false;
          state.hasResponded = true;
          state.accumulatedText = text;
          return;
        }
        if (text === state.accumulatedText.trim()) return;
        await this.sendText(chatId, event.sourceMessage, text, preferReply);
        preferReply = false;
        state.hasResponded = true;
        state.accumulatedText = text;
      },
      uploadWithoutHandle: async (filePath, title, text, fallbackCtx) => {
        try {
          await sendWeixinFile({
            filePath,
            toUserId: chatId,
            contextToken: event.sourceMessage._contextToken,
            caption: title,
            text,
            baseUrlOverride: this.currentBaseUrl || undefined
          });
          return;
        } catch (error) {
          momWarn("weixin", "upload_file_failed", {
            botId: this.instanceId,
            chatId,
            filePath,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        if (isInlineTextFile(filePath)) {
          try {
            const inlineText = readFileSync(filePath, "utf8").trim();
            if (inlineText) {
              await fallbackCtx.respond(inlineText);
              return;
            }
          } catch {
            // Fall through to plain failure notice.
          }
        }
        await fallbackCtx.respond(`微信这边回文件失败了：${filePath.split("/").pop() || "附件"}`);
      }
    });
  }

  private resolveEventDeliveryMode(task: MomEvent): EventDeliveryMode {
    return task.delivery === "text" ? "text" : "agent";
  }

  async triggerTask(event: unknown, _filename: string): Promise<void> {
    const task = event as MomEvent;
    if (!task || typeof task !== "object" || typeof task.chatId !== "string" || typeof task.text !== "string") {
      throw new Error("Invalid task payload");
    }

    const now = Date.now();
    const syntheticMessage: IncomingMessage = {
      userId: task.chatId,
      text: task.text,
      type: "text",
      raw: ({ message_id: now } as unknown) as IncomingMessage["raw"],
      _contextToken: "",
      timestamp: new Date(now)
    };

    const delivery = this.resolveEventDeliveryMode(task);
    if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
      await this.sendText(task.chatId, syntheticMessage, task.text, false);
      return;
    }

    const syntheticEvent: WeixinInboundEvent = {
      chatId: task.chatId,
      chatType: "private",
      messageId: now,
      userId: task.chatId,
      userName: "EVENT",
      text: task.text,
      ts: normalizeTimestamp(new Date(now)),
      attachments: [],
      imageContents: [],
      sourceMessage: syntheticMessage,
      isEvent: true
    };

    await this.processEvent(syntheticEvent, false);
  }

  private async sendText(chatId: string, sourceMessage: IncomingMessage, text: string, preferReply = false): Promise<void> {
    const normalized = normalizeText(filterWeixinMarkdown(String(text ?? "")));
    if (!normalized) return;

    const payload: WeixinTextOutboxPayload = {
      chatId,
      text: normalized,
      preferReply,
      sourceMessageId: String(sourceMessage.raw.message_id ?? ""),
      contextToken: String(sourceMessage._contextToken ?? "")
    };
    await this.outbox.enqueue(chatId, payload);
  }

  private async deliverTextNow(payload: WeixinTextOutboxPayload, queueId: number): Promise<void> {
    if (!this.bot) {
      throw new Error("Weixin bot is not running.");
    }
    if (!payload.contextToken) {
      throw new Error("Missing Weixin context token for outbound delivery.");
    }

    const deliveryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const logPayload = {
      deliveryId,
      queueId,
      chatId: payload.chatId,
      preferReply: payload.preferReply,
      sourceMessageId: payload.sourceMessageId,
      textPreview: payload.text.slice(0, 200)
    };

    this.recordDelivery(payload.chatId, "attempt", logPayload);
    momLog("weixin", "outbound_text_attempt", logPayload);

    try {
      await this.bot.sendText(payload.chatId, payload.text, payload.contextToken);
      this.recordDelivery(payload.chatId, "success", logPayload);
      momLog("weixin", "outbound_text_success", logPayload);
    } catch (error) {
      const failurePayload = {
        ...logPayload,
        error: error instanceof Error ? error.message : String(error)
      };
      this.recordDelivery(payload.chatId, "failure", failurePayload);
      momError("weixin", "outbound_text_failure", failurePayload);
      throw error;
    }
  }

  private recordDelivery(chatId: string, stage: "attempt" | "success" | "failure", payload: Record<string, unknown>): void {
    const filePath = join(this.store.getChatDir(chatId), "delivery.jsonl");
    appendFileSync(filePath, `${JSON.stringify({
      ts: new Date().toISOString(),
      stage,
      ...payload
    })}\n`, "utf8");
  }

  private async replyCommand(chatId: string, sourceMessage: IncomingMessage, text: string): Promise<void> {
    await this.sendText(chatId, sourceMessage, text, true);
  }

  private serializeQueuedEvent(event: WeixinInboundEvent): WeixinQueuedTaskPayload {
    const {
      sourceMessage,
      imageContents: _imageContents,
      ...serializableEvent
    } = event;
    return {
      event: serializableEvent,
      sourceMessage: {
        userId: sourceMessage.userId,
        text: sourceMessage.text,
        type: sourceMessage.type,
        rawMessageId: Number(sourceMessage.raw.message_id ?? event.messageId),
        contextToken: String(sourceMessage._contextToken ?? ""),
        timestamp: sourceMessage.timestamp.toISOString()
      }
    };
  }

  private rehydrateQueuedEvent(payload: WeixinQueuedTaskPayload): WeixinInboundEvent {
    return {
      ...payload.event,
      imageContents: rebuildImageContentsFromAttachments(payload.event.attachments, (attachment, error) => {
        momWarn("weixin", "queued_image_restore_failed", {
          botId: this.instanceId,
          chatId: payload.event.chatId,
          file: attachment.local,
          error: error instanceof Error ? error.message : String(error)
        });
      }),
      sourceMessage: this.rehydrateSourceMessage(payload.sourceMessage)
    };
  }

  private rehydrateSourceMessage(source: WeixinQueuedTaskPayload["sourceMessage"]): IncomingMessage {
    return {
      userId: source.userId,
      text: source.text,
      type: source.type,
      raw: ({ message_id: source.rawMessageId } as unknown) as IncomingMessage["raw"],
      _contextToken: source.contextToken,
      timestamp: new Date(source.timestamp)
    };
  }

  private async enqueueSyntheticTask(chatId: string, sourceMessage: IncomingMessage, text: string, front: boolean): Promise<number | null> {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    return this.inboundTasks.enqueue(chatId, this.serializeQueuedEvent({
      chatId,
      scopeId: chatId,
      chatType: "private",
      messageId: Date.now(),
      userId: chatId,
      userName: "QUEUE",
      text: normalized,
      ts: normalizeTimestamp(new Date()),
      attachments: [],
      imageContents: [],
      sessionId: this.store.getActiveSession(chatId),
      sourceMessage,
      hasInlineAudioTranscript: false
    }), { front, preview: normalized });
  }

  private async handleCommand(chatId: string, text: string, sourceMessage: IncomingMessage): Promise<boolean> {
    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";

    if (cmd === "/chatid") {
      await this.replyCommand(chatId, sourceMessage, `chat_id: ${chatId}`);
      return true;
    }
    return this.commandService.handle({
      chatId,
      scopeId: chatId,
      text,
      target: sourceMessage
    });
  }

}
