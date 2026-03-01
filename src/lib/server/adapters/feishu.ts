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
                const newId = await this.editText(currentMessageId, text, chatId);
                if (newId) {
                    currentMessageId = newId;
                }
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

    private async sendText(chatId: string, text: string): Promise<{ message_id: string } | null> {
        if (!this.client) return null;
        try {
            const res = await this.client.im.message.create({
                params: { receive_id_type: "chat_id" },
                data: {
                    receive_id: chatId,
                    msg_type: "text",
                    content: JSON.stringify({ text })
                }
            });
            return { message_id: res.data?.message_id || "" };
        } catch (e) {
            momWarn("feishu", "send_message_failed", { error: String(e) });
            return null;
        }
    }

    private async editText(messageId: string, text: string, chatId: string): Promise<string | null> {
        if (!this.client) return null;
        try {
            // Feishu only allows patching "interactive" messages (cards).
            // For standard text messages, we must send a new one and recall the old one.
            const newMsg = await this.sendText(chatId, text);
            if (!newMsg) return null;

            try {
                // Recall the previous message
                await this.client.im.message.delete({
                    path: { message_id: messageId }
                });
            } catch (e) {
                momWarn("feishu", "recall_message_failed", { error: String(e), messageId });
            }

            return newMsg.message_id;
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

    private startEventsWatchers(allowed: Set<string>): void {
        // stub
    }

    private async writePromptPreview(allowedChatIds: string[]): Promise<void> {
        // stub
    }
}
