import { readFileSync } from "node:fs";
import WebSocket from "ws";
import type { RuntimeSettings } from "../../settings/index.js";
import type { EventDeliveryMode, MomEvent } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { BasicChannelAcpTemplate } from "../shared/acp.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import { buildTextChannelContext } from "../shared/contextBuilder.js";
import {
  clearTokenCache,
  getAccessToken,
  getGatewayUrl,
  safeSend,
  sendC2CMessage,
  sendChannelMessage,
  sendGroupMessage
} from "./api.js";

export interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
}

interface QqPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

interface QqAuthor {
  id?: string;
  user_openid?: string;
  member_openid?: string;
  username?: string;
}

interface QqInboundRaw {
  id?: string;
  content?: string;
  timestamp?: string;
  channel_id?: string;
  guild_id?: string;
  group_openid?: string;
  author?: QqAuthor;
  attachments?: QqAttachment[];
}

interface QqAttachment {
  content_type?: string;
  filename?: string;
  url?: string;
  voice_wav_url?: string;
}

interface SendTarget {
  mode: "c2c" | "group" | "channel";
  id: string;
  replyToId?: string;
}

function hashNumber(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function extensionFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("png")) return ".png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("gif")) return ".gif";
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return ".mp3";
  if (lower.includes("ogg") || lower.includes("opus")) return ".ogg";
  if (lower.includes("mp4")) return ".mp4";
  if (lower.includes("aac")) return ".aac";
  return ".bin";
}

function looksLikeAudioAttachment(row: QqAttachment, mime: string): boolean {
  if (mime.startsWith("audio/")) return true;
  const filename = String(row.filename ?? "").toLowerCase();
  const url = String(row.voice_wav_url ?? row.url ?? "").toLowerCase();
  return (
    filename.endsWith(".amr") ||
    filename.endsWith(".silk") ||
    filename.endsWith(".opus") ||
    filename.endsWith(".ogg") ||
    filename.endsWith(".mp3") ||
    filename.endsWith(".wav") ||
    url.includes(".amr") ||
    url.includes(".silk") ||
    Boolean(row.voice_wav_url)
  );
}

function normalizeQqTimestamp(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`;
  }

  if (/^\d+$/.test(value)) {
    if (value.length >= 13) {
      const millis = Number.parseInt(value.slice(0, 13), 10);
      return `${Math.floor(millis / 1000)}.${String(millis % 1000).padStart(3, "0")}`;
    }
    const seconds = Number.parseInt(value, 10);
    return `${seconds}.000`;
  }

  const dateMillis = Date.parse(value);
  if (Number.isFinite(dateMillis)) {
    return `${Math.floor(dateMillis / 1000)}.${String(dateMillis % 1000).padStart(3, "0")}`;
  }

  return `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`;
}

/**
 * Convert markdown-formatted model reply to plain text for QQ delivery.
 * Preserves newlines; strips markdown syntax.
 */
function markdownToPlainText(text: string): string {
  let result = text;
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Tables: remove separator rows, then strip leading/trailing pipes and convert inner pipes to spaces
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner: string) =>
    inner
      .split("|")
      .map((cell) => cell.trim())
      .join("  ")
  );
  // Strip inline markdown formatting
  result = result
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1");
  return result;
}

function normalizeOutgoingText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export class QQManager extends BaseChannelRuntime {
  private readonly acpTemplate: BasicChannelAcpTemplate<SendTarget>;
  private readonly commandService: SharedRuntimeCommandService<SendTarget>;

  private currentAppId = "";
  private currentClientSecret = "";
  private currentAllowedChatIdsKey = "";

  private accessToken = "";
  private ws: WebSocket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSeq: number | null = null;
  private aborted = false;

  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore?: SessionStore,
    options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway; usageTracker: AiUsageTracker }
  ) {
    super({
      channel: "qq",
      defaultWorkspaceName: "moli-q",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });
    this.acpTemplate = new BasicChannelAcpTemplate<SendTarget>({
      acp: this.acp,
      sendText: async (_chatId, target, text) => {
        await this.replyCommand(target, text);
      },
      runPrompt: async (chatId, target, request) => {
        await this.runAcpPrompt(chatId, request.prompt, target, request.startText);
      }
    });
    this.commandService = new SharedRuntimeCommandService<SendTarget>({
      channel: "qq",
      instanceId: this.instanceId,
      workspaceDir: this.workspaceDir,
      authScopePrefix: "qq",
      store: this.store,
      runners: this.runners,
      getSettings,
      updateSettings,
      isRunning: (scopeId) => this.running.has(scopeId),
      stopRun: (scopeId) => this.stopChatWork(scopeId),
      cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
      maybeHandleAcpCommand: (scopeId, cmd, rawArg, target) =>
        this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, target),
      sendText: (target, text) => this.replyCommand(target, text),
      onSessionMutation: (scopeId) => {
        void this.writePromptPreview([scopeId]);
      },
      getQueueSize: (scopeId) => this.chatQueues.get(scopeId)?.size() ?? 0,
      helpLines: this.acpTemplate.helpLines()
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
      this.ws &&
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

    void this.connect(new Set(allowedChatIds));
    void this.writePromptPreview(allowedChatIds);
  }

  stop(): void {
    this.aborted = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (error) {
        momWarn("qq", "adapter_stop_close_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.ws = undefined;
    this.lastSeq = null;
    this.accessToken = "";
    clearTokenCache();
    void this.acp.dispose();
    momLog("qq", "adapter_stopped");
  }

  private async connect(allowed: Set<string>): Promise<void> {
    try {
      this.accessToken = await getAccessToken(this.currentAppId, this.currentClientSecret);
      const gateway = await getGatewayUrl(this.accessToken);
      this.openWebsocket(gateway, allowed);
    } catch (error) {
      momError("qq", "connect_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.scheduleReconnect(5000, allowed);
    }
  }

  private scheduleReconnect(delayMs: number, allowed: Set<string>): void {
    if (this.aborted) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(allowed);
    }, delayMs);
  }

  private openWebsocket(gateway: string, allowed: Set<string>): void {
    const ws = new WebSocket(gateway);
    this.ws = ws;

    ws.on("open", () => {
      momLog("qq", "adapter_started", { allowedChatCount: allowed.size });
    });

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(String(raw)) as QqPayload;
        if (typeof payload.s === "number") {
          this.lastSeq = payload.s;
        }
        this.handlePayload(payload, allowed);
      } catch (error) {
        momWarn("qq", "payload_parse_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    ws.on("close", (code, reason) => {
      momWarn("qq", "ws_closed", { code, reason: reason.toString() });
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
      this.ws = undefined;
      if (!this.aborted) {
        if (code === 4004) {
          clearTokenCache();
        }
        this.scheduleReconnect(code === 4008 ? 60000 : 3000, allowed);
      }
    });

    ws.on("error", (error) => {
      momWarn("qq", "ws_error", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private handlePayload(payload: QqPayload, allowed: Set<string>): void {
    if (!this.ws) return;

    if (payload.op === 10) {
      const interval = Number((payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 30000);
      const identify = {
        op: 2,
        d: {
          token: `QQBot ${this.accessToken}`,
          intents: (1 << 30) | (1 << 12) | (1 << 25),
          shard: [0, 1]
        }
      };
      this.ws.send(JSON.stringify(identify));

      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
      }, interval);
      return;
    }

    if (payload.op !== 0 || !payload.t) return;

    if (payload.t === "C2C_MESSAGE_CREATE") {
      void this.handleIncoming("c2c", payload.d as QqInboundRaw, allowed);
      return;
    }
    if (payload.t === "GROUP_AT_MESSAGE_CREATE") {
      void this.handleIncoming("group", payload.d as QqInboundRaw, allowed);
      return;
    }
    if (payload.t === "AT_MESSAGE_CREATE" || payload.t === "DIRECT_MESSAGE_CREATE") {
      void this.handleIncoming("channel", payload.d as QqInboundRaw, allowed);
    }
  }

  private async sendAcpPermissionCard(target: SendTarget, permission: AcpPendingPermissionView): Promise<void> {
    await this.replyCommand(target, buildAcpPermissionText(permission));
  }

  private async runAcpPrompt(chatId: string, prompt: string, target: SendTarget, startText: string): Promise<void> {
    await this.replyCommand(target, startText);
    let lastStatus = startText;
    const result = await this.acp.runTask(chatId, prompt, {
      onStatus: async (text) => {
        lastStatus = text;
      },
      onEvent: async (text) => {
        await this.replyCommand(target, text);
      },
      onPermissionRequest: async (permission) => {
        await this.sendAcpPermissionCard(target, permission);
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
    await this.replyCommand(target, summaryLines.join("\n"));
    if (result.assistantText.trim()) {
      await this.replyCommand(target, result.assistantText.trim());
    }
  }

  private async handleIncoming(kind: "c2c" | "group" | "channel", event: QqInboundRaw, allowed: Set<string>): Promise<void> {
    const messageId = String(event.id ?? "").trim();
    if (!messageId) return;

    const chatId = kind === "group"
      ? String(event.group_openid ?? "").trim()
      : kind === "channel"
        ? String(event.channel_id ?? "").trim()
        : String(event.author?.user_openid ?? "").trim();
    if (!chatId) return;

    const userId = String(event.author?.member_openid ?? event.author?.user_openid ?? event.author?.id ?? "unknown");
    momLog("qq", "message_received_raw", {
      botId: this.instanceId,
      kind,
      chatId,
      userId,
      groupOpenid: String(event.group_openid ?? ""),
      channelId: String(event.channel_id ?? ""),
      guildId: String(event.guild_id ?? ""),
      messageId,
      textPreview: String(event.content ?? "").slice(0, 120)
    });

    if (allowed.size > 0 && !allowed.has(chatId)) {
      momWarn("qq", "message_blocked_chat", { chatId, messageId });
      return;
    }

    if (!this.markInboundMessageSeen(chatId, messageId)) {
      momWarn("qq", "message_dedup_skipped_raw", { chatId, messageId });
      return;
    }

    let text = this.cleanContent(String(event.content ?? ""), kind).trim();
    const { attachments, imageContents } = await this.extractAttachments(chatId, event, messageId);
    if (!text && attachments.length === 0 && imageContents.length === 0) {
      momLog("qq", "message_ignored_empty", { chatId, messageId });
      return;
    }

    if (!text) {
      if (attachments.some((it) => it.isAudio)) {
        text = "(voice message received; transcription pending)";
      } else if (attachments.length > 0 || imageContents.length > 0) {
        text = "(attachment)";
      }
    }

    const loweredText = text.trim().toLowerCase();
    const target = { mode: kind, id: chatId, replyToId: messageId } satisfies SendTarget;
    try {
      if (await this.acpTemplate.maybeProxy(chatId, text, target)) {
        return;
      }
    } catch (error) {
      await this.replyCommand(target, error instanceof Error ? error.message : String(error));
      return;
    }

    const commandText = loweredText === "stop" ? "/stop" : text;
    if (commandText.startsWith("/")) {
      const handled = await this.handleCommand(chatId, commandText, target);
      if (handled) return;
    }

    const inbound: ChannelInboundMessage = {
      chatId,
      chatType: kind === "group" ? "group" : kind === "channel" ? "channel" : "private",
      messageId: hashNumber(messageId),
      userId,
      userName: String(event.author?.username ?? ""),
      text,
      ts: normalizeQqTimestamp(event.timestamp),
      attachments,
      imageContents
    };

    const runId = createRunId(chatId, inbound.messageId);
    (inbound as ChannelInboundMessage & { runId?: string; rawMessageId?: string; qqTarget?: SendTarget }).runId = runId;
    (inbound as ChannelInboundMessage & { rawMessageId?: string }).rawMessageId = messageId;
    (inbound as ChannelInboundMessage & { qqTarget?: SendTarget }).qqTarget = target;

    const logged = this.store.logMessage(chatId, {
      date: new Date().toISOString(),
      ts: inbound.ts,
      messageId: inbound.messageId,
      user: inbound.userId,
      userName: inbound.userName,
      text: inbound.text,
      attachments: inbound.attachments,
      isBot: false
    });

    if (!logged) {
      momWarn("qq", "message_dedup_skipped", { runId, chatId, messageId: inbound.messageId });
      return;
    }

    try {
      const activeSessionId = this.store.getActiveSession(chatId);
      const conv = this.sessions.getOrCreateConversation(
        "qq",
        `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`
      );
      this.sessions.appendMessage(conv.id, "user", inbound.text);
    } catch (error) {
      momWarn("qq", "session_user_append_failed", {
        runId,
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const queue = this.getQueue(chatId);
    if (this.running.has(chatId)) {
      momLog("qq", "message_queued_while_busy", { runId, chatId });
    }

    queue.enqueue(async () => {
      try {
        await this.processEvent(inbound);
      } catch (error) {
        momError("qq", "queue_job_uncaught", {
          runId,
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  private cleanContent(content: string, kind: "c2c" | "group" | "channel"): string {
    const normalized = content.replace(/\r\n/g, "\n").trim();
    if (kind === "group" || kind === "channel") {
      return normalized.replace(/<@!?\w+>/g, "").trim();
    }
    return normalized;
  }

  private async processEvent(event: ChannelInboundMessage): Promise<void> {
    const chatId = event.chatId;
    const activeSessionId = event.sessionId || this.store.getActiveSession(chatId);
    this.running.add(chatId);

    const runner = this.runners.get(chatId, activeSessionId);
    const inboundReplyToId = (event as ChannelInboundMessage & { rawMessageId?: string }).rawMessageId;
    const initialTarget = (event as ChannelInboundMessage & { qqTarget?: SendTarget }).qqTarget;
    const ctx = buildTextChannelContext({
      channel: "qq",
      event,
      workspaceDir: this.workspaceDir,
      chatDir: this.store.getChatDir(chatId),
      store: this.store,
      sessions: this.sessions,
      instanceId: this.instanceId,
      activeSessionId,
      conversationKey: `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`,
      response: {
        sendText: async (text) => {
          if (!initialTarget) return null;
          await this.sendText(initialTarget, text, inboundReplyToId);
          return null;
        }
      },
      createBotMessageId: () => hashNumber(`${Date.now()}-${Math.random()}`),
      onSessionAppendWarning: (error) => {
        momWarn("qq", "session_assistant_append_failed", {
          chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      },
      replaceWithoutEdit: async (text, state, fallbackCtx) => {
        if (!initialTarget) return;
        if (!state.accumulatedText.trim()) {
          await fallbackCtx.respond(text);
          state.accumulatedText = text;
          return;
        }
        if (text.trim() === state.accumulatedText.trim()) return;
        await this.sendText(initialTarget, text, inboundReplyToId);
        state.hasResponded = true;
        state.accumulatedText = text;
      },
      uploadWithoutHandle: async (filePath, _title, _text, fallbackCtx) => {
        const fileText = readFileSync(filePath, "utf8").trim();
        if (fileText) {
          await fallbackCtx.respond(fileText);
          return;
        }
        await fallbackCtx.respond(`[file] ${filePath}`);
      }
    });

    try {
      await runner.run(ctx);
    } finally {
      this.running.delete(chatId);
    }
  }

  private async sendText(target: SendTarget, text: string, replyToId?: string) {
    if (!this.accessToken) {
      this.accessToken = await getAccessToken(this.currentAppId, this.currentClientSecret);
    }
    const normalized = normalizeOutgoingText(markdownToPlainText(String(text ?? "")));
    if (!normalized) return null;

    const sendWithReply = () => {
      if (target.mode === "group") return sendGroupMessage(this.accessToken, target.id, normalized, replyToId);
      if (target.mode === "channel") return sendChannelMessage(this.accessToken, target.id, normalized, replyToId);
      return sendC2CMessage(this.accessToken, target.id, normalized, replyToId);
    };

    const sendProactive = () => {
      if (target.mode === "group") return sendGroupMessage(this.accessToken, target.id, normalized);
      if (target.mode === "channel") return sendChannelMessage(this.accessToken, target.id, normalized);
      return sendC2CMessage(this.accessToken, target.id, normalized);
    };

    return safeSend(sendWithReply, sendProactive);
  }

  private async replyCommand(target: SendTarget, text: string): Promise<void> {
    await this.sendText(target, text, target.replyToId);
  }

  private async handleCommand(chatId: string, text: string, target: SendTarget): Promise<boolean> {
    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";

    if (cmd === "/chatid") {
      await this.replyCommand(target, `chat_id: ${chatId}`);
      return true;
    }
    return this.commandService.handle({
      chatId,
      scopeId: chatId,
      text,
      target
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

    const delivery = this.resolveEventDeliveryMode(task);
    const target: SendTarget = { mode: "c2c", id: task.chatId };
    if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
      await this.sendText(target, task.text);
      return;
    }

    const now = Date.now();
    const synthetic: ChannelInboundMessage = {
      chatId: task.chatId,
      chatType: "private",
      messageId: hashNumber(`event-${now}`),
      userId: "EVENT",
      userName: "EVENT",
      text: task.text,
      ts: `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, "0")}`,
      attachments: [],
      imageContents: [],
      isEvent: true
    };
    (synthetic as ChannelInboundMessage & { qqTarget?: SendTarget }).qqTarget = target;
    await this.processEvent(synthetic);
  }

  private async extractAttachments(chatId: string, event: QqInboundRaw, messageId: string): Promise<{
    attachments: ChannelInboundMessage["attachments"];
    imageContents: ChannelInboundMessage["imageContents"];
  }> {
    const rows = Array.isArray(event.attachments) ? event.attachments : [];
    const attachments: ChannelInboundMessage["attachments"] = [];
    const imageContents: ChannelInboundMessage["imageContents"] = [];
    if (rows.length === 0) return { attachments, imageContents };

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] ?? {};
      const mime = String(row.content_type ?? "").trim().toLowerCase();
      const sourceUrl = String(row.voice_wav_url ?? row.url ?? "").trim();
      if (!sourceUrl) continue;

      try {
        const bytes = await this.downloadAttachment(sourceUrl);
        if (!bytes) continue;
        const mediaType = mime.startsWith("image/")
          ? "image"
          : looksLikeAudioAttachment(row, mime)
            ? "audio"
            : "file";
        const guessedName = String(row.filename ?? "").trim() || `qq_${messageId}_${index}${extensionFromMime(mime || "application/octet-stream")}`;
        const saved = this.store.saveAttachment(chatId, guessedName, String(event.timestamp ?? `${Math.floor(Date.now() / 1000)}.000`), bytes, {
          mediaType,
          mimeType: mime || undefined
        });
        attachments.push(saved);

        if (saved.isImage) {
          const imageMime = saved.mimeType || (mime.startsWith("image/") ? mime : "");
          if (imageMime) {
            imageContents.push({ type: "image", mimeType: imageMime, data: bytes.toString("base64") });
          }
        }
      } catch (error) {
        momWarn("qq", "attachment_download_failed", {
          chatId,
          messageId,
          sourceUrl,
          mime,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { attachments, imageContents };
  }

  private async downloadAttachment(url: string): Promise<Buffer | null> {
    const headers = this.accessToken
      ? ({ Authorization: `QQBot ${this.accessToken}` } as Record<string, string>)
      : undefined;

    const first = await fetch(url, { headers }).catch(() => null);
    if (first?.ok) {
      const data = await first.arrayBuffer();
      return Buffer.from(data);
    }

    const fallback = await fetch(url).catch(() => null);
    if (fallback?.ok) {
      const data = await fallback.arrayBuffer();
      return Buffer.from(data);
    }

    return null;
  }
}
