import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "../config.js";
import { config } from "../config.js";
import { EventsWatcher, type MomEvent, type EventDeliveryMode } from "../mom/events.js";
import { createRunId, momError, momLog, momWarn } from "../mom/log.js";
import { buildPromptChannelSections } from "../mom/prompt-channel.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "../mom/prompt.js";
import { RunnerPool } from "../mom/runner.js";
import { loadSkillsFromWorkspace } from "../mom/skills.js";
import { TelegramMomStore } from "../mom/store.js"; // We can reuse the same store logic for now as it just uses file system scratch dir
import type { MomContext, TelegramInboundEvent } from "../mom/types.js";
import { SessionStore } from "../services/sessionStore.js";
import type { MemoryGateway } from "../memory/gateway.js";

export interface FeishuConfig {
    appId: string;
    appSecret: string;
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
                momError("feishu", "queue_job_failed", {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
        }

        this.processing = false;
    }
}

export class FeishuManager {
    private static readonly CHAT_EVENTS_RELATIVE_DIR = ["events"] as const;
    private readonly workspaceDir: string;
    private readonly store: TelegramMomStore; // Reuse the file system based store
    private readonly sessions: SessionStore;
    private readonly runners: RunnerPool;
    private readonly memory: MemoryGateway;
    private readonly instanceId: string;

    private client: lark.Client | undefined;
    private wsClient: lark.WSClient | undefined;

    private currentAppId = "";
    private currentAppSecret = "";
    private currentAllowedChatIdsKey = "";

    private readonly chatQueues = new Map<string, ChannelQueue>();
    private readonly running = new Set<string>();
    private readonly events: EventsWatcher[] = [];
    private readonly watchedChatEventDirs = new Set<string>();

    constructor(
        private readonly getSettings: () => RuntimeSettings,
        private readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
        sessionStore?: SessionStore,
        options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway }
    ) {
        this.workspaceDir = options?.workspaceDir ?? resolve(config.dataDir, "moli-f");
        this.instanceId = options?.instanceId ?? "default";
        this.store = new TelegramMomStore(this.workspaceDir); // TelegramMomStore is just a wrapper around file storage
        this.sessions = sessionStore ?? new SessionStore();
        if (!options?.memory) {
            throw new Error("FeishuManager requires MemoryGateway for unified memory operations.");
        }
        this.memory = options.memory;
        this.runners = new RunnerPool(this.store, this.getSettings, options.memory);
    }

    apply(cfg: FeishuConfig): void {
        const appId = cfg.appId.trim();
        const appSecret = cfg.appSecret.trim();
        const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
        const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

        momLog("feishu", "apply", {
            hasAppId: Boolean(appId),
            hasAppSecret: Boolean(appSecret),
            allowedChatCount: allowedChatIds.length
        });

        if (!appId || !appSecret) {
            this.stop();
            momWarn("feishu", "disabled_no_credentials");
            return;
        }

        if (this.client && this.currentAppId === appId && this.currentAppSecret === appSecret && this.currentAllowedChatIdsKey === allowedChatIdsKey) {
            momLog("feishu", "apply_noop_same_credentials");
            return;
        }

        this.stop();

        const allowed = new Set(allowedChatIds);
        momLog("feishu", "allowed_chat_ids_loaded", {
            mode: allowed.size > 0 ? "whitelist" : "all_chats",
            allowedChatIds: Array.from(allowed)
        });

        this.client = new lark.Client({
            appId,
            appSecret,
            appType: lark.AppType.SelfBuild,
        });

        const handler = new lark.EventDispatcher({}).register({
            "im.message.receive_v1": async (data: any) => {
                await this.handleIncomingMessage(data.message, data.sender, allowed);
            }
        });

        this.wsClient = new lark.WSClient({
            appId,
            appSecret,
            logger: {
                trace: (msg) => momLog("feishu_ws", "trace", { msg }),
                debug: (msg) => momLog("feishu_ws", "debug", { msg }),
                info: (msg) => momLog("feishu_ws", "info", { msg }),
                warn: (msg) => momWarn("feishu_ws", "warn", { msg }),
                error: (msg) => momError("feishu_ws", "error", { msg })
            }
        });

        this.wsClient.start({
            eventDispatcher: handler
        });

        this.currentAppId = appId;
        this.currentAppSecret = appSecret;
        this.currentAllowedChatIdsKey = allowedChatIdsKey;

        // start event watchers and preview gen, just like telegram adapter
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
            momLog("feishu", "events_watcher_stopped");
        }

        if (this.wsClient) {
            // Unfortunately standard WS disconnect logic will need handling or just stop reference
            momLog("feishu", "adapter_stopped");
        }

        this.client = undefined;
        this.wsClient = undefined;
        this.currentAppId = "";
        this.currentAppSecret = "";
        this.currentAllowedChatIdsKey = "";
    }

    private async handleIncomingMessage(message: Record<string, any>, sender: Record<string, any>, allowed: Set<string>): Promise<void> {
        if (!this.client || !this.wsClient) return;

        const chatId = String(message.chat_id || "");
        const userId = String(sender.sender_id?.open_id || "unknown");
        const messageId = String(message.message_id || "");
        const chatType = message.chat_type === "p2p" ? "private" : "group";

        let rawText = "";
        if (message.message_type === "text" && message.content) {
            try {
                const contentObj = JSON.parse(message.content);
                rawText = contentObj.text || "";
            } catch {
                rawText = message.content;
            }
        }

        if (allowed.size > 0 && !allowed.has(chatId)) {
            momWarn("feishu", "message_blocked_chat", { chatId, userId, messageId });
            return;
        }

        if (chatType === "group" && !message.mentions?.some((m: any) => m.name === this.instanceId || m.id?.open_id)) {
            momLog("feishu", "group_message_ignored_no_mention", { chatId, messageId });
            return;
        }

        let cleaned = rawText.trim();
        if (chatType === "group") {
            cleaned = cleaned.replace(/@_user_[^\s]+\s*/g, "").trim();
        }

        if (!cleaned) {
            momLog("feishu", "message_ignored_empty", { chatId, messageId });
            return;
        }

        const lowered = cleaned.toLowerCase();
        if (lowered.startsWith("/")) {
            const isCommand = await this.handleCommand(chatId, cleaned);
            if (isCommand) {
                return;
            }
        }

        const ts = `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`;

        const event: TelegramInboundEvent = {
            chatId,
            chatType,
            messageId: Number(messageId.replace(/[^0-9]/g, "").slice(0, 10)) || Date.now(),
            userId,
            userName: sender.sender_id?.union_id || "User",
            text: cleaned,
            ts,
            attachments: [],
            imageContents: []
        };

        const runId = createRunId(chatId, event.messageId);
        (event as TelegramInboundEvent & { runId?: string }).runId = runId;

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
            momWarn("feishu", "message_dedup_skipped", { runId, chatId, messageId: event.messageId });
            return;
        }

        try {
            const activeSessionId = this.store.getActiveSession(chatId);
            const conv = this.sessions.getOrCreateConversation(
                "feishu",
                `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`
            );
            this.sessions.appendMessage(conv.id, "user", event.text);
        } catch (error) {
            momWarn("feishu", "session_user_append_failed", {
                runId,
                chatId,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        const queue = this.getQueue(chatId);
        if (this.running.has(chatId)) {
            momLog("feishu", "message_queued_while_busy", { runId, chatId });
        }

        queue.enqueue(async () => {
            try {
                await this.processEvent(event);
            } catch (error) {
                momError("feishu", "queue_job_uncaught", {
                    runId,
                    chatId,
                    error: error instanceof Error ? error.message : String(error)
                });
                await this.sendText(chatId, "Internal error.");
            }
        });
    }

    private async processEvent(event: TelegramInboundEvent): Promise<void> {
        if (!this.client) return;
        const chatId = event.chatId;
        const activeSessionId = event.sessionId || this.store.getActiveSession(chatId);
        this.running.add(chatId);

        const runner = this.runners.get(chatId, activeSessionId);

        let currentMessageId: string | null = null;
        let accumulatedText = "";

        const ctx: MomContext = {
            message: event,
            workspaceDir: this.store.getScratchDir(chatId),
            chatDir: this.store.getScratchDir(chatId),
            respond: async (text: string, shouldLog = true) => {
                if (!text.trim()) return;
                const resp = await this.sendText(chatId, text);
                if (resp && resp.message_id) {
                    currentMessageId = resp.message_id;
                }
                accumulatedText += text + "\n";

                if (shouldLog) {
                    this.store.logMessage(chatId, {
                        date: new Date().toISOString(),
                        ts: `${Math.floor(Date.now() / 1000)}.000`,
                        messageId: Date.now(),
                        user: this.instanceId,
                        userName: this.instanceId,
                        text,
                        attachments: [],
                        isBot: true
                    });
                    try {
                        const conv = this.sessions.getOrCreateConversation(
                            "feishu",
                            `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`
                        );
                        this.sessions.appendMessage(conv.id, "assistant", text);
                    } catch (error) {
                        momWarn("feishu", "session_assistant_append_failed", {
                            chatId,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            },
            replaceMessage: async (text: string) => {
                if (!currentMessageId) {
                    await ctx.respond(text);
                    return;
                }
                await this.editText(currentMessageId, text, chatId);
                accumulatedText = text;
            },
            respondInThread: async (text: string) => {
                await ctx.respond(text);
            },
            setTyping: async () => { },
            setWorking: async () => { },
            deleteMessage: async () => { },
            uploadFile: async () => { }
        };

        try {
            await runner.run(ctx);
        } finally {
            this.running.delete(chatId);
        }
    }

    private formatFeishuCard(text: string) {
        return {
            config: { wide_screen_mode: true },
            elements: [
                {
                    tag: "markdown",
                    content: text
                }
            ]
        };
    }

    private async sendText(chatId: string, text: string): Promise<{ message_id: string } | null> {
        if (!this.client || !text.trim()) return null;
        try {
            const res = await this.client.im.message.create({
                params: { receive_id_type: "chat_id" },
                data: {
                    receive_id: chatId,
                    msg_type: "interactive",
                    content: JSON.stringify(this.formatFeishuCard(text))
                }
            });
            return { message_id: res.data?.message_id || "" };
        } catch (e) {
            momWarn("feishu", "send_message_failed", { error: String(e) });
            return null;
        }
    }

    private async editText(messageId: string, text: string, chatId: string): Promise<string | null> {
        if (!this.client || !text.trim()) return null;
        try {
            await this.client.im.message.patch({
                path: { message_id: messageId },
                data: {
                    content: JSON.stringify(this.formatFeishuCard(text))
                }
            });
            return messageId;
        } catch (e) {
            momWarn("feishu", "edit_message_failed", { error: String(e) });
            return null;
        }
    }

    private getQueue(chatId: string): ChannelQueue {
        let queue = this.chatQueues.get(chatId);
        if (!queue) {
            queue = new ChannelQueue();
            this.chatQueues.set(chatId, queue);
            momLog("feishu", "queue_created", { chatId });
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

    private async handleCommand(chatId: string, text: string): Promise<boolean> {
        const parts = text.split(/\s+/);
        const cmd = parts[0]?.toLowerCase() || "";
        const rawArg = parts.slice(1).join(" ").trim();

        if (cmd === "/chatid") {
            await this.sendText(chatId, `chat_id: ${chatId}`);
            return true;
        }

        if (cmd === "/stop") {
            const activeSessionId = this.store.getActiveSession(chatId);
            if (this.running.has(chatId)) {
                const runner = this.runners.get(chatId, activeSessionId);
                runner.abort();
                momLog("feishu", "stop_requested", { chatId, sessionId: activeSessionId });
                await this.sendText(chatId, "Stopping...");
            } else {
                await this.sendText(chatId, "Nothing running.");
            }
            return true;
        }

        if (cmd === "/new") {
            if (this.running.has(chatId)) {
                await this.sendText(chatId, "Already working. Send /stop first, then /new.");
                return true;
            }
            const sessionId = this.store.createSession(chatId);
            this.runners.reset(chatId, sessionId);
            await this.sendText(chatId, `Created and switched to new session: ${sessionId}`);
            momLog("feishu", "session_new", { chatId, sessionId });
            return true;
        }

        if (cmd === "/clear") {
            if (this.running.has(chatId)) {
                await this.sendText(chatId, "Already working. Send /stop first, then /clear.");
                return true;
            }
            const sessionId = this.store.getActiveSession(chatId);
            this.store.clearSessionContext(chatId, sessionId);
            this.runners.reset(chatId, sessionId);
            await this.sendText(chatId, `Cleared context for session: ${sessionId}`);
            momLog("feishu", "session_clear", { chatId, sessionId });
            return true;
        }

        if (cmd === "/sessions") {
            if (this.running.has(chatId)) {
                await this.sendText(chatId, "Already working. Send /stop first, then switch sessions.");
                return true;
            }
            if (rawArg) {
                const picked = this.resolveSessionSelection(chatId, rawArg);
                if (!picked) {
                    await this.sendText(chatId, "Invalid session selector. Use /sessions to list available sessions.");
                    return true;
                }
                this.store.setActiveSession(chatId, picked);
                await this.sendText(chatId, `Switched to session: ${picked}`);
                return true;
            }
            await this.sendText(chatId, this.formatSessionsOverview(chatId));
            return true;
        }

        if (cmd === "/delete_sessions") {
            if (this.running.has(chatId)) {
                await this.sendText(chatId, "Already working. Send /stop first, then delete sessions.");
                return true;
            }
            if (!rawArg) {
                await this.sendText(chatId, `${this.formatSessionsOverview(chatId)}\n\nDelete usage: /delete_sessions <index|sessionId>`);
                return true;
            }
            const picked = this.resolveSessionSelection(chatId, rawArg);
            if (!picked) {
                await this.sendText(chatId, "Invalid session selector.");
                return true;
            }
            try {
                const result = this.store.deleteSession(chatId, picked);
                this.runners.reset(chatId, result.deleted);
                await this.sendText(chatId, `Deleted session: ${result.deleted}\nCurrent session: ${result.active}\nRemaining: ${result.remaining.length}`);
            } catch (error) {
                await this.sendText(chatId, error instanceof Error ? error.message : String(error));
            }
            return true;
        }

        if (cmd === "/models") {
            await this.sendText(chatId, "Feishu model switching via command is not fully implemented yet. Please use the Web UI or Telegram to switch active models.");
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
                "/delete_sessions <index|sessionId> - delete a session"
            ].join("\n");
            await this.sendText(chatId, help);
            return true;
        }

        return false;
    }

    private startEventsWatchers(allowed: Set<string>): void {
        // stub
    }

    private async writePromptPreview(allowedChatIds: string[]): Promise<void> {
        // stub
    }
}
