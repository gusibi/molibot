import { extname } from "node:path";
import type { RuntimeSettings } from "../../settings/index.js";
import type { EventDeliveryMode, MomEvent } from "../../agent/events.js";
import type { ImageContent } from "@mariozechner/pi-ai";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage, FileAttachment } from "../../agent/types.js";
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
import { type ResolvedQQBotAccount, initApiConfig, clearTokenCache } from "./sdk-adapter.js";
import { sendText, sendMedia, type OutboundResult } from "#qqbot/src/outbound.js";
import { startGateway, type GatewayContext } from "#qqbot/src/gateway.js";

export interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
}

interface SendTarget {
  mode: "c2c" | "group" | "channel";
  id: string;
  replyToId?: string;
}

interface GatewayEvent {
  type: "c2c" | "guild" | "dm" | "group";
  senderId: string;
  senderName?: string;
  content: string;
  messageId: string;
  timestamp: string;
  channelId?: string;
  guildId?: string;
  groupOpenid?: string;
  attachments?: Array<{ content_type: string; url: string; filename?: string; voice_wav_url?: string }>;
}

interface QQQueuedTaskPayload {
  event: ChannelInboundMessage;
  target: SendTarget;
}

export class QQManager extends BaseChannelRuntime {
  private readonly acpTemplate: BasicChannelAcpTemplate<SendTarget>;
  private readonly commandService: SharedRuntimeCommandService<SendTarget>;
  private readonly outbox: SqliteOutbox<{ target: SendTarget; text: string; replyToId?: string }, OutboundResult>;
  private readonly inboundTasks: InboundTaskCoordinator<QQQueuedTaskPayload, SendTarget>;

  private currentAppId = "";
  private currentClientSecret = "";
  private currentAllowedChatIdsKey = "";
  private gatewayAbortController: AbortController | null = null;
  private gatewayRunning = false;
  private aborted = false;
  private sdkAccount: ResolvedQQBotAccount | null = null;

  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore: SessionStore,
    options: {
      instanceId: string;
      workspaceDir: string;
      memory: MemoryGateway;
      usageTracker: AiUsageTracker;
      modelErrorTracker: ModelErrorTracker;
      sdkAccount?: ResolvedQQBotAccount;
    }
  ) {
    super({
      channel: "qq",
      defaultWorkspaceName: "moli-q",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });

    this.sdkAccount = options.sdkAccount ?? null;
    if (this.sdkAccount) {
      initApiConfig({
        appId: this.sdkAccount.appId,
        markdownSupport: this.sdkAccount.markdownSupport ?? true
      });
    }

    this.acpTemplate = new BasicChannelAcpTemplate<SendTarget>({
      acp: this.acp,
      sendText: async (_chatId, target, text) => {
        await this.replyCommand(target, text);
      },
      runPrompt: async (chatId, target, request) => {
        await this.runAcpPrompt(chatId, request.prompt, target, request.startText);
      }
    });

    this.inboundTasks = new InboundTaskCoordinator<QQQueuedTaskPayload, SendTarget>({
      channel: "qq",
      instanceId: this.instanceId,
      process: async (payload) => {
        try {
          const event = this.rehydrateQueuedEvent(payload.event);
          await this.processEvent(event, payload.target);
        } catch (error) {
          momError("qq", "queue_job_uncaught", {
            botId: this.instanceId,
            chatId: payload.event.chatId,
            queueId: payload.event.messageId,
            error: error instanceof Error ? error.message : String(error)
          });
          await this.replyCommand(payload.target, "Internal error.");
          throw error;
        }
      },
      enqueueFrontFromCommand: async (input, text) => this.enqueueSyntheticTask(input.scopeId, input.target, text, true)
    });
    this.commandService = this.createSharedCommandService<SendTarget>({
      authScopePrefix: "qq",
      isRunning: (scopeId) => this.running.has(scopeId),
      stopRun: (scopeId) => this.stopChatWork(scopeId),
      cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
      maybeHandleAcpCommand: (scopeId, cmd, rawArg, target) =>
        this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, target),
      sendText: (target, text) => this.replyCommand(target, text),
      onSessionMutation: (scopeId) => {
        void this.writePromptPreview([scopeId]);
      },
      ...this.inboundTasks.toCommandOptions(),
      helpLines: this.acpTemplate.helpLines()
    });
    this.outbox = new SqliteOutbox<{ target: SendTarget; text: string; replyToId?: string }, OutboundResult>({
      channel: "qq",
      instanceId: this.instanceId,
      deliver: async (payload) => {
        const result = await this.sendTextNow(payload.target, payload.text, payload.replyToId);
        if (result.error) {
          throw new Error(result.error);
        }
        return result;
      }
    });
  }

  apply(cfg: QQConfig): void {
    const appId = cfg.appId.trim();
    const clientSecret = cfg.clientSecret.trim();
    const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
    const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

    momLog("qq", "apply", {
      hasAppId: Boolean(appId),
      hasClientSecret: Boolean(clientSecret),
      allowedChatCount: allowedChatIds.length
    });

    if (!appId || !clientSecret) {
      this.stop();
      momWarn("qq", "disabled_no_credentials");
      return;
    }

    if (
      this.gatewayRunning &&
      this.currentAppId === appId &&
      this.currentClientSecret === clientSecret &&
      this.currentAllowedChatIdsKey === allowedChatIdsKey
    ) {
      momLog("qq", "apply_noop_same_credentials");
      return;
    }

    this.stop();
    this.currentAppId = appId;
    this.currentClientSecret = clientSecret;
    this.currentAllowedChatIdsKey = allowedChatIdsKey;
    this.aborted = false;

    if (this.sdkAccount) {
      this.sdkAccount.appId = appId;
      this.sdkAccount.clientSecret = clientSecret;
      initApiConfig({ appId, markdownSupport: this.sdkAccount.markdownSupport ?? true });
    }

    void this.outbox.resume();
    void this.inboundTasks.resumeAll();
    void this.connect(new Set(allowedChatIds));
    void this.writePromptPreview(allowedChatIds);
  }

  stop(): void {
    this.aborted = true;
    if (this.gatewayAbortController) {
      this.gatewayAbortController.abort();
      this.gatewayAbortController = null;
    }
    this.gatewayRunning = false;
    clearTokenCache();
    void this.acp.dispose();
    momLog("qq", "adapter_stopped");
  }

  async sendText(target: SendTarget, text: string, replyToId?: string): Promise<OutboundResult> {
    const normalized = String(text ?? "").trim();
    if (!normalized) {
      return { channel: "qqbot", error: "Message text cannot be empty." };
    }
    return this.outbox.enqueue(target.id, {
      target,
      text: normalized,
      replyToId: replyToId ?? undefined
    });
  }

  private async sendTextNow(target: SendTarget, text: string, replyToId?: string): Promise<OutboundResult> {
    if (!this.sdkAccount) {
      return { channel: "qqbot", error: "SDK account not initialized" };
    }

    const to = this.buildTargetAddress(target);
    return sendText({
      to,
      text,
      accountId: this.sdkAccount.accountId,
      replyToId: replyToId ?? null,
      account: this.sdkAccount
    });
  }

  private async connect(allowed: Set<string>): Promise<void> {
    if (!this.sdkAccount) {
      momError("qq", "connect_failed_no_account", { error: "SDK account not initialized" });
      return;
    }

    try {
      const gatewayAbortController = new AbortController();
      this.gatewayAbortController = gatewayAbortController;

      const gatewayContext: GatewayContext = {
        account: this.sdkAccount,
        abortSignal: gatewayAbortController.signal,
        cfg: this.getSettings(),
        log: {
          info: (msg) => momLog("qq", "gateway_info", { botId: this.instanceId, msg }),
          error: (msg) => momError("qq", "gateway_error_log", { botId: this.instanceId, msg }),
          debug: (msg) => momLog("qq", "gateway_debug", { botId: this.instanceId, msg })
        },
        onEvent: async (event) => {
          await this.handleGatewayEvent(event, allowed);
        },
        onError: (error) => {
          momError("qq", "gateway_error", { botId: this.instanceId, error: error.message });
        },
        onReady: () => {
          this.gatewayRunning = true;
          momLog("qq", "gateway_ready", { botId: this.instanceId });
        }
      };

      await startGateway(gatewayContext);
    } catch (error) {
      this.gatewayRunning = false;
      momError("qq", "connect_failed", {
        botId: this.instanceId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleGatewayEvent(event: GatewayEvent, allowed: Set<string>): Promise<void> {
    const chatId = this.resolveChatId(event);
    const chatType = event.type === "c2c" || event.type === "dm" ? "private" : "group";
    const userId = event.senderId;

    if (allowed.size > 0 && !allowed.has(chatId)) {
      momWarn("qq", "message_blocked_chat", {
        botId: this.instanceId,
        chatId,
        userId,
        messageId: event.messageId
      });
      return;
    }

    const messageId = toNumericId(event.messageId);
    if (!this.markInboundMessageSeen(chatId, String(messageId))) {
      momWarn("qq", "message_dedup_skipped", {
        botId: this.instanceId,
        chatId,
        messageId
      });
      return;
    }

    const attachmentResult = await this.extractInboundAttachments(chatId, event);
    const text = String(event.content ?? "").trim() || fallbackTextForAttachments(event.attachments ?? []);
    const inboundEvent: ChannelInboundMessage = {
      chatId,
      chatType,
      messageId,
      userId,
      userName: event.senderName,
      text,
      ts: normalizeTimestamp(event.timestamp),
      attachments: attachmentResult.attachments,
      imageContents: attachmentResult.imageContents
    };

    try {
      if (await this.acpTemplate.maybeProxy(chatId, text, this.toSendTarget(event))) {
        return;
      }
    } catch (error) {
      await this.replyCommand(this.toSendTarget(event), error instanceof Error ? error.message : String(error));
      return;
    }

    const lowered = text.toLowerCase();
    const commandText = lowered === "stop" ? "/stop" : text;
    if (lowered.startsWith("/") || lowered === "stop") {
      const handled = await this.handleCommand(chatId, commandText, event);
      if (handled) {
        return;
      }
    }

    const runId = createRunId(chatId, messageId);
    (inboundEvent as ChannelInboundMessage & { runId?: string }).runId = runId;

    const logged = this.store.logMessage(chatId, {
      date: new Date().toISOString(),
      ts: inboundEvent.ts,
      messageId: inboundEvent.messageId,
      user: inboundEvent.userId,
      userName: inboundEvent.userName,
      text: inboundEvent.text,
      attachments: inboundEvent.attachments,
      isBot: false
    });

    if (!logged) {
      return;
    }

    const queuedEvent: ChannelInboundMessage = {
      ...inboundEvent,
      sessionId: this.store.getActiveSession(chatId),
      imageContents: []
    };

    if (this.inboundTasks.size(chatId) > 0 || this.running.has(chatId)) {
      momLog("qq", "message_queued_while_busy", { botId: this.instanceId, chatId, runId });
    }
    this.inboundTasks.enqueue(chatId, {
      event: queuedEvent,
      target: this.toSendTarget(event)
    }, { preview: queuedEvent.text });
  }

  private async processEvent(event: ChannelInboundMessage, target: SendTarget): Promise<void> {
    const chatId = event.chatId;
    await this.runSharedTextTask(chatId, event, {
      response: {
        sendText: async (text) => {
          const result = await this.sendText(target, text, target.replyToId);
          return result.messageId ? { messageId: result.messageId } : null;
        },
        uploadFile: async (filePath, title, text) => {
          if (!this.sdkAccount) {
            throw new Error("SDK account not initialized");
          }
          const result = await sendMedia({
            to: this.buildTargetAddress(target),
            mediaUrl: filePath,
            text: text ?? title ?? "",
            accountId: this.sdkAccount.accountId,
            replyToId: target.replyToId ?? null,
            account: this.sdkAccount
          });
          if (result.error) {
            throw new Error(result.error);
          }
        }
      },
      createBotMessageId: () => Date.now(),
      onSessionAppendWarning: (error) => {
        momWarn("qq", "session_assistant_append_failed", {
          botId: this.instanceId,
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      },
      replaceWithoutEdit: async (text, state) => {
        if (!state.hasResponded || text !== state.accumulatedText.trim()) {
          await this.sendText(target, text, target.replyToId);
          state.hasResponded = true;
          state.accumulatedText = text;
        }
      }
    });
  }

  async triggerTask(event: unknown, _filename: string): Promise<void> {
    const task = event as MomEvent;
    if (!task || typeof task !== "object" || typeof task.chatId !== "string" || typeof task.text !== "string") {
      throw new Error("Invalid task payload");
    }

    const delivery = this.resolveEventDeliveryMode(task);
    const target: SendTarget = {
      mode: "c2c",
      id: task.chatId
    };

    if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
      await this.replyCommand(target, task.text);
      return;
    }

    const now = Date.now();
    const synthetic: ChannelInboundMessage = {
      chatId: task.chatId,
      chatType: "private",
      messageId: now,
      userId: "EVENT",
      userName: "EVENT",
      text: task.text,
      ts: normalizeTimestamp(new Date(now).toISOString()),
      attachments: [],
      imageContents: [],
      isEvent: true
    };

    await this.processEvent(synthetic, target);
  }

  private resolveEventDeliveryMode(task: MomEvent): EventDeliveryMode {
    return task.delivery === "text" ? "text" : "agent";
  }

  private async handleCommand(chatId: string, text: string, source: GatewayEvent): Promise<boolean> {
    if (text.split(/\s+/)[0]?.toLowerCase() === "/chatid") {
      await this.replyCommand(this.toSendTarget(source), `chat_id: ${chatId}`);
      return true;
    }
    return this.commandService.handle({
      chatId,
      scopeId: chatId,
      text,
      target: this.toSendTarget(source)
    });
  }

  private async replyCommand(target: SendTarget, text: string): Promise<void> {
    await this.sendText(target, text, target.replyToId);
  }

  private rehydrateQueuedEvent(event: ChannelInboundMessage): ChannelInboundMessage {
    return {
      ...event,
      imageContents: rebuildImageContentsFromAttachments(event.attachments, (attachment, error) => {
        momWarn("qq", "queued_image_restore_failed", {
          botId: this.instanceId,
          chatId: event.chatId,
          file: attachment.local,
          error: error instanceof Error ? error.message : String(error)
        });
      })
    };
  }

  private async enqueueSyntheticTask(chatId: string, target: SendTarget, text: string, front: boolean): Promise<number | null> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return null;
    return this.inboundTasks.enqueue(chatId, {
      event: {
        chatId,
        scopeId: chatId,
        chatType: target.mode === "c2c" ? "private" : "group",
        messageId: Date.now(),
        userId: "QUEUE",
        userName: "QUEUE",
        text: normalized,
        ts: normalizeTimestamp(new Date().toISOString()),
        attachments: [],
        imageContents: [],
        sessionId: this.store.getActiveSession(chatId)
      },
      target
    }, { front, preview: normalized });
  }

  private buildTargetAddress(target: SendTarget): string {
    if (target.mode === "c2c") {
      return target.id;
    }
    return `${target.mode}:${target.id}`;
  }

  private async sendAcpPermissionCard(target: SendTarget, permission: AcpPendingPermissionView): Promise<void> {
    await this.replyCommand(target, buildAcpPermissionText(permission));
  }

  private async runAcpPrompt(chatId: string, prompt: string, target: SendTarget, startText: string): Promise<void> {
    await this.replyCommand(target, startText);
    const result = await this.acp.runTask(chatId, prompt, {
      onStatus: async (text) => {
        await this.replyCommand(target, text);
      },
      onEvent: async (text) => {
        await this.replyCommand(target, text);
      },
      onPermissionRequest: async (permission) => {
        await this.sendAcpPermissionCard(target, permission);
      }
    });
    if (result.assistantText.trim()) {
      await this.replyCommand(target, result.assistantText.trim());
    }
  }

  private resolveChatId(event: GatewayEvent): string {
    if (event.type === "group") return event.groupOpenid ?? event.senderId;
    if (event.type === "guild") return event.channelId ?? event.senderId;
    return event.senderId;
  }

  private toSendTarget(event: GatewayEvent): SendTarget {
    if (event.type === "group") {
      return { mode: "group", id: event.groupOpenid ?? event.senderId, replyToId: event.messageId };
    }
    if (event.type === "guild") {
      return { mode: "channel", id: event.channelId ?? event.senderId, replyToId: event.messageId };
    }
    return { mode: "c2c", id: event.senderId, replyToId: event.messageId };
  }

  private async extractInboundAttachments(
    chatId: string,
    event: GatewayEvent
  ): Promise<{ attachments: FileAttachment[]; imageContents: ImageContent[] }> {
    const attachments: FileAttachment[] = [];
    const imageContents: ImageContent[] = [];

    for (let index = 0; index < (event.attachments?.length ?? 0); index += 1) {
      const attachment = event.attachments?.[index];
      if (!attachment) continue;

      const sourceUrl = normalizeAttachmentUrl(attachment.voice_wav_url || attachment.url);
      if (!sourceUrl) continue;

      try {
        const bytes = await downloadAttachment(sourceUrl);
        const filename = guessAttachmentFilename(event.messageId, index, attachment);
        const saved = this.store.saveAttachment(chatId, filename, normalizeTimestamp(event.timestamp), bytes, {
          mediaType: inferAttachmentMediaType(attachment),
          mimeType: attachment.content_type || undefined
        });
        attachments.push(saved);

        if (saved.isImage) {
          const mimeType = saved.mimeType || attachment.content_type || inferImageMimeType(filename);
          if (mimeType) {
            imageContents.push({
              type: "image",
              mimeType,
              data: bytes.toString("base64")
            });
          }
        }
      } catch (error) {
        momWarn("qq", "attachment_download_failed", {
          botId: this.instanceId,
          chatId,
          messageId: event.messageId,
          sourceUrl,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { attachments, imageContents };
  }
}

function normalizeTimestamp(value: string): string {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    return `${Math.floor(Date.now() / 1000)}.000`;
  }
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}`;
}

function toNumericId(value: string): number {
  const direct = Number.parseInt(value, 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash || Date.now();
}

function mapAttachments(
  attachments: Array<{ content_type: string; url: string; filename?: string; voice_wav_url?: string }>
): FileAttachment[] {
  return attachments.map((attachment) => {
    const mimeType = attachment.content_type || "";
    const mediaType = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "file";
    return {
      original: attachment.url,
      local: attachment.voice_wav_url || attachment.url,
      mediaType,
      mimeType,
      isImage: mediaType === "image",
      isAudio: mediaType === "audio"
    };
  });
}

async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function normalizeAttachmentUrl(url?: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
}

function inferAttachmentMediaType(attachment: {
  content_type: string;
  filename?: string;
  voice_wav_url?: string;
}): FileAttachment["mediaType"] {
  const mimeType = attachment.content_type || "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "voice" || mimeType.startsWith("audio/") || attachment.voice_wav_url) return "audio";

  const extension = extname(String(attachment.filename ?? "").toLowerCase());
  if ([".amr", ".silk", ".slk", ".opus", ".ogg", ".mp3", ".wav", ".m4a", ".aac"].includes(extension)) {
    return "audio";
  }
  return "file";
}

function guessAttachmentFilename(
  messageId: string,
  index: number,
  attachment: { content_type: string; filename?: string; voice_wav_url?: string; url: string }
): string {
  const provided = String(attachment.filename ?? "").trim();
  if (provided) return provided;

  if (attachment.voice_wav_url) {
    return `qq_${messageId}_${index}.wav`;
  }

  const extension = inferAttachmentExtension(attachment.content_type, attachment.url);
  return `qq_${messageId}_${index}${extension}`;
}

function inferAttachmentExtension(contentType: string, sourceUrl: string): string {
  const cleanUrl = sourceUrl.split("?")[0] ?? "";
  const urlExtension = extname(cleanUrl);
  if (urlExtension) return urlExtension;

  const mimeType = String(contentType ?? "").toLowerCase();
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return ".ogg";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("aac")) return ".aac";
  return ".bin";
}

function inferImageMimeType(filename: string): string | undefined {
  const extension = extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return undefined;
}

function fallbackTextForAttachments(
  attachments: Array<{ content_type: string; url: string; filename?: string; voice_wav_url?: string }>
): string {
  if (attachments.length === 0) return "";
  if (attachments.some((attachment) => attachment.content_type?.startsWith("audio/"))) {
    return "(voice message)";
  }
  if (attachments.some((attachment) => attachment.content_type?.startsWith("image/"))) {
    return "(image attachment)";
  }
  return "(attachment)";
}

export type { ResolvedQQBotAccount };
export { initApiConfig, clearTokenCache };
