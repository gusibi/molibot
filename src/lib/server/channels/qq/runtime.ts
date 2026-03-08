import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { config } from "../../app/env.js";
import type { RuntimeSettings } from "../../settings/index.js";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  switchModelSelection,
  type ModelRoute
} from "../../settings/modelSwitch.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildPromptChannelSections } from "../../agent/prompt-channel.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "../../agent/prompt.js";
import { RunnerPool } from "../../agent/runner.js";
import { loadSkillsFromWorkspace } from "../../agent/skills.js";
import { MomRuntimeStore } from "../../agent/store.js";
import type { ChannelInboundMessage, MomContext } from "../../agent/types.js";
import { resolveGlobalSkillsDirFromWorkspacePath } from "../../agent/workspace.js";
import { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import { ChannelQueue } from "../shared/queue.js";
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

export class QQManager {
  private static readonly INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;

  private readonly workspaceDir: string;
  private readonly store: MomRuntimeStore;
  private readonly sessions: SessionStore;
  private readonly runners: RunnerPool;
  private readonly memory: MemoryGateway;
  private readonly instanceId: string;

  private currentAppId = "";
  private currentClientSecret = "";
  private currentAllowedChatIdsKey = "";

  private accessToken = "";
  private ws: WebSocket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSeq: number | null = null;
  private aborted = false;

  private readonly chatQueues = new Map<string, ChannelQueue>();
  private readonly running = new Set<string>();
  private readonly inboundDedupe = new Map<string, number>();

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore?: SessionStore,
    options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway; usageTracker: AiUsageTracker }
  ) {
    this.workspaceDir = options?.workspaceDir ?? resolve(config.dataDir, "moli-q");
    this.instanceId = options?.instanceId ?? "default";
    this.store = new MomRuntimeStore(this.workspaceDir);
    this.sessions = sessionStore ?? new SessionStore();
    if (!options?.memory) {
      throw new Error("QQManager requires MemoryGateway for unified memory operations.");
    }
    this.memory = options.memory;
    this.runners = new RunnerPool(
      "qq",
      this.store,
      this.getSettings,
      this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
      options.usageTracker,
      options.memory
    );
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

  private markInboundMessageSeen(chatId: string, rawMessageId: string): boolean {
    const key = `${chatId}:${rawMessageId}`;
    const now = Date.now();
    const expiresAt = this.inboundDedupe.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    this.inboundDedupe.set(key, now + QQManager.INBOUND_DEDUPE_TTL_MS);

    if (this.inboundDedupe.size > 2048) {
      for (const [entryKey, entryExpiresAt] of this.inboundDedupe.entries()) {
        if (entryExpiresAt <= now) {
          this.inboundDedupe.delete(entryKey);
        }
      }
    }

    return true;
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

    if (text.startsWith("/")) {
      const handled = await this.handleCommand(chatId, text, { mode: kind, id: chatId, replyToId: messageId });
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
    (inbound as ChannelInboundMessage & { qqTarget?: SendTarget }).qqTarget = { mode: kind, id: chatId, replyToId: messageId };

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

    let accumulatedText = "";
    const inboundReplyToId = (event as ChannelInboundMessage & { rawMessageId?: string }).rawMessageId;
    const initialTarget = (event as ChannelInboundMessage & { qqTarget?: SendTarget }).qqTarget;

    const ctx: MomContext = {
      channel: "qq",
      message: event,
      workspaceDir: this.workspaceDir,
      chatDir: this.store.getChatDir(chatId),
      respond: async (text: string, shouldLog = true) => {
        if (!text.trim() || !initialTarget) return;
        await this.sendText(initialTarget, text, inboundReplyToId);
        accumulatedText += `${text}\n`;

        if (shouldLog) {
          this.store.logMessage(chatId, {
            date: new Date().toISOString(),
            ts: `${Math.floor(Date.now() / 1000)}.000`,
            messageId: hashNumber(`${Date.now()}-${Math.random()}`),
            user: this.instanceId,
            userName: this.instanceId,
            text,
            attachments: [],
            isBot: true
          });
          try {
            const conv = this.sessions.getOrCreateConversation(
              "qq",
              `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`
            );
            this.sessions.appendMessage(conv.id, "assistant", text);
          } catch (error) {
            momWarn("qq", "session_assistant_append_failed", {
              chatId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      },
      replaceMessage: async (text: string) => {
        if (!text.trim()) return;
        if (!initialTarget) return;
        if (!accumulatedText.trim()) {
          await ctx.respond(text);
          accumulatedText = text;
          return;
        }
        // QQ API has no generic edit endpoint in this flow.
        // Ignore replace updates after first send to prevent duplicated full replies.
        if (text.trim() === accumulatedText.trim()) return;
        accumulatedText = text;
      },
      respondInThread: async (text: string) => {
        await ctx.respond(text);
      },
      setTyping: async () => { },
      setWorking: async () => { },
      deleteMessage: async () => {
        accumulatedText = "";
      },
      uploadFile: async (filePath: string) => {
        const text = readFileSync(filePath, "utf8").trim();
        if (text) {
          await ctx.respond(text);
          return;
        }
        await ctx.respond(`[file] ${filePath}`);
      }
    };

    try {
      await runner.run(ctx);
      if (!accumulatedText.trim()) {
        momWarn("qq", "session_assistant_skipped_empty", { chatId });
      }
    } finally {
      this.running.delete(chatId);
    }
  }

  private async sendText(target: SendTarget, text: string, replyToId?: string) {
    if (!this.accessToken) {
      this.accessToken = await getAccessToken(this.currentAppId, this.currentClientSecret);
    }

    const sendWithReply = () => {
      if (target.mode === "group") return sendGroupMessage(this.accessToken, target.id, text, replyToId);
      if (target.mode === "channel") return sendChannelMessage(this.accessToken, target.id, text, replyToId);
      return sendC2CMessage(this.accessToken, target.id, text, replyToId);
    };

    const sendProactive = () => {
      if (target.mode === "group") return sendGroupMessage(this.accessToken, target.id, text);
      if (target.mode === "channel") return sendChannelMessage(this.accessToken, target.id, text);
      return sendC2CMessage(this.accessToken, target.id, text);
    };

    return safeSend(sendWithReply, sendProactive);
  }

  private getQueue(chatId: string): ChannelQueue {
    let queue = this.chatQueues.get(chatId);
    if (!queue) {
      queue = new ChannelQueue("qq");
      this.chatQueues.set(chatId, queue);
      momLog("qq", "queue_created", { chatId });
    }
    return queue;
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

  private async replyCommand(target: SendTarget, text: string): Promise<void> {
    await this.sendText(target, text, target.replyToId);
  }

  private async handleCommand(chatId: string, text: string, target: SendTarget): Promise<boolean> {
    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";
    const rawArg = parts.slice(1).join(" ").trim();

    if (cmd === "/chatid") {
      await this.replyCommand(target, `chat_id: ${chatId}`);
      return true;
    }

    if (cmd === "/stop") {
      const activeSessionId = this.store.getActiveSession(chatId);
      if (this.running.has(chatId)) {
        const runner = this.runners.get(chatId, activeSessionId);
        runner.abort();
        momLog("qq", "stop_requested", { chatId, sessionId: activeSessionId });
        await this.replyCommand(target, "Stopping...");
      } else {
        await this.replyCommand(target, "Nothing running.");
      }
      return true;
    }

    if (cmd === "/new") {
      if (this.running.has(chatId)) {
        await this.replyCommand(target, "Already working. Send /stop first, then /new.");
        return true;
      }
      const sessionId = this.store.createSession(chatId);
      this.runners.reset(chatId, sessionId);
      await this.replyCommand(target, `Created and switched to new session: ${sessionId}`);
      momLog("qq", "session_new", { chatId, sessionId });
      return true;
    }

    if (cmd === "/clear") {
      if (this.running.has(chatId)) {
        await this.replyCommand(target, "Already working. Send /stop first, then /clear.");
        return true;
      }
      const sessionId = this.store.getActiveSession(chatId);
      this.store.clearSessionContext(chatId, sessionId);
      this.runners.reset(chatId, sessionId);
      await this.replyCommand(target, `Cleared context for session: ${sessionId}`);
      momLog("qq", "session_clear", { chatId, sessionId });
      return true;
    }

    if (cmd === "/sessions") {
      if (this.running.has(chatId)) {
        await this.replyCommand(target, "Already working. Send /stop first, then switch sessions.");
        return true;
      }
      if (rawArg) {
        const picked = this.resolveSessionSelection(chatId, rawArg);
        if (!picked) {
          await this.replyCommand(target, "Invalid session selector. Use /sessions to list available sessions.");
          return true;
        }
        this.store.setActiveSession(chatId, picked);
        await this.replyCommand(target, `Switched to session: ${picked}`);
        return true;
      }
      await this.replyCommand(target, this.formatSessionsOverview(chatId));
      return true;
    }

    if (cmd === "/delete_sessions") {
      if (this.running.has(chatId)) {
        await this.replyCommand(target, "Already working. Send /stop first, then delete sessions.");
        return true;
      }
      if (!rawArg) {
        await this.replyCommand(target, `${this.formatSessionsOverview(chatId)}\n\nDelete usage: /delete_sessions <index|sessionId>`);
        return true;
      }
      const picked = this.resolveSessionSelection(chatId, rawArg);
      if (!picked) {
        await this.replyCommand(target, "Invalid session selector.");
        return true;
      }
      try {
        const result = this.store.deleteSession(chatId, picked);
        this.runners.reset(chatId, result.deleted);
        await this.replyCommand(
          target,
          `Deleted session: ${result.deleted}\nCurrent session: ${result.active}\nRemaining: ${result.remaining.length}`
        );
      } catch (error) {
        await this.replyCommand(target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/models") {
      if (this.running.has(chatId)) {
        await this.replyCommand(target, "Already working. Send /stop first, then switch models.");
        return true;
      }
      if (!rawArg) {
        await this.replyCommand(target, this.modelsText("text"));
        return true;
      }
      if (!this.updateSettings) {
        await this.replyCommand(target, "Model switching is unavailable in current runtime.");
        return true;
      }
      const [firstArg = "", secondArg = ""] = rawArg
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const maybeRoute = parseModelRoute(firstArg);
      const route: ModelRoute = maybeRoute ?? "text";
      const selector = maybeRoute ? secondArg : rawArg;
      const settings = this.getSettings();
      const options = buildModelOptions(settings, route);
      if (!selector) {
        await this.replyCommand(target, this.modelsText(route));
        return true;
      }
      const selected = options.find((option, index) => String(index + 1) === selector || option.key === selector);
      if (!selected) {
        await this.replyCommand(target, `Invalid model selector: ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      const switched = switchModelSelection({
        settings,
        route,
        selector,
        updateSettings: this.updateSettings
      });
      if (!switched) {
        await this.replyCommand(target, `Invalid model selector: ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      await this.replyCommand(
        target,
        [
          `Switched ${route} model to: ${switched.selected.label}`,
          `Mode: ${switched.settings.providerMode}`,
          `Use /models ${route} to check current active ${route} model.`
        ].join("\n")
      );
      momLog("qq", "model_switched_via_command", {
        chatId,
        route,
        selector,
        selectedKey: switched.selected.key,
        providerMode: switched.settings.providerMode
      });
      return true;
    }

    if (cmd === "/skills") {
      await this.replyCommand(target, this.skillsText(chatId));
      return true;
    }

    if (cmd === "/help" || cmd === "/start") {
      const help = [
        "Available commands:",
        "/chatid - show current chat id",
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
        "/skills - list currently loaded skills"
      ].join("\n");
      await this.replyCommand(target, help);
      return true;
    }

    return false;
  }

  private modelsText(route: ModelRoute): string {
    const settings = this.getSettings();
    const options = buildModelOptions(settings, route);
    const activeKey = currentModelKey(settings, route);
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

  private skillsText(chatId: string): string {
    const { skills, diagnostics } = loadSkillsFromWorkspace(this.workspaceDir, chatId);
    const globalSkillsDir = resolveGlobalSkillsDirFromWorkspacePath(this.workspaceDir);
    const botSkillsDir = `${this.workspaceDir}/skills`;
    const chatSkillsDir = `${this.workspaceDir}/${chatId}/skills`;
    const scopeLabel: Record<string, string> = {
      chat: "chat",
      global: "global",
      bot: "bot"
    };
    const lines = [
      `Workspace: ${this.workspaceDir}`,
      `Global skills dir: ${globalSkillsDir}`,
      `Bot skills dir: ${botSkillsDir}`,
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

  private async writePromptPreview(allowedChatIds: string[]): Promise<void> {
    const chatId = allowedChatIds[0] ?? "__preview__";
    const sessionId = allowedChatIds[0] ? this.store.getActiveSession(chatId) : "default";
    const memoryText = allowedChatIds[0]
      ? ((await this.memory.buildPromptContext(
        { channel: "qq", externalUserId: chatId },
        "",
        12,
      )) || "(no working memory yet)")
      : "(no working memory yet)";
    const prompt = buildSystemPromptPreview(this.workspaceDir, chatId, sessionId, memoryText, {
      channel: "qq",
      settings: this.getSettings()
    });
    const channelSections = buildPromptChannelSections("qq");
    const sources = getSystemPromptSources(this.workspaceDir, {
      channel: "qq",
      settings: this.getSettings()
    });
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
      `- agent_sources: ${sources.agent.length > 0 ? sources.agent.join(", ") : "(none)"}`,
      `- bot_sources: ${sources.bot.length > 0 ? sources.bot.join(", ") : "(none)"}`,
      "",
      "---",
      "",
    ].join("\n");
    writeFileSync(filePath, `${header}${prompt}\n`, "utf8");
    momLog("qq", "system_prompt_preview_written", {
      botId: this.instanceId,
      workspaceDir: this.workspaceDir,
      filePath,
      chatId,
      sessionId,
      promptLength: prompt.length,
    });
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
