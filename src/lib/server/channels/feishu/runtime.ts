import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import * as lark from "@larksuiteoapi/node-sdk";
import { config } from "../../app/env.js";
import type { RuntimeSettings } from "../../settings/index.js";
import { EventsWatcher, type MomEvent, type EventDeliveryMode } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildPromptChannelSections } from "../../agent/prompt-channel.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "../../agent/prompt.js";
import { AcpService } from "../../acp/service.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import { RunnerPool } from "../../agent/runner.js";
import { MomRuntimeStore } from "../../agent/store.js";
import type { MomContext, ChannelInboundMessage } from "../../agent/types.js";
import { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { deleteFeishuMessage, editFeishuText, sendFeishuFile, sendFeishuText } from "./messaging.js";
import { isFeishuGroupMessageTriggered, toFeishuInboundEvent } from "./message-intake.js";
import { BasicChannelAcpTemplate } from "../shared/acp.js";
import { ChannelQueue } from "../shared/queue.js";

export interface FeishuConfig {
    appId: string;
    appSecret: string;
    allowedChatIds: string[];
}

// Orchestrates Feishu-specific inbound handling, command flow, and runner lifecycle.
// Leaf concerns like queueing, message send/edit, and intake parsing live in sibling files.
export class FeishuManager {
    private static readonly CHAT_EVENTS_RELATIVE_DIR = ["events"] as const;
    private static readonly INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;
    private readonly workspaceDir: string;
    private readonly store: MomRuntimeStore;
    private readonly sessions: SessionStore;
    private readonly runners: RunnerPool;
    private readonly memory: MemoryGateway;
    private readonly instanceId: string;
    private readonly acp: AcpService;
    private readonly acpTemplate: BasicChannelAcpTemplate<void>;
    private readonly commandService: SharedRuntimeCommandService<string>;

    private client: lark.Client | undefined;
    private wsClient: lark.WSClient | undefined;

    private currentAppId = "";
    private currentAppSecret = "";
    private currentAllowedChatIdsKey = "";

    private readonly chatQueues = new Map<string, ChannelQueue>();
    private readonly running = new Set<string>();
    private readonly inboundDedupe = new Map<string, number>();
    private readonly events: EventsWatcher[] = [];
    private readonly watchedChatEventDirs = new Set<string>();

    constructor(
        private readonly getSettings: () => RuntimeSettings,
        private readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
        sessionStore?: SessionStore,
        options?: { workspaceDir?: string; instanceId?: string; memory: MemoryGateway; usageTracker: AiUsageTracker }
    ) {
        this.workspaceDir = options?.workspaceDir ?? resolve(config.dataDir, "moli-f");
        this.instanceId = options?.instanceId ?? "default";
        this.store = new MomRuntimeStore(this.workspaceDir);
        this.sessions = sessionStore ?? new SessionStore();
        if (!options?.memory) {
            throw new Error("FeishuManager requires MemoryGateway for unified memory operations.");
        }
        this.memory = options.memory;
        this.runners = new RunnerPool(
            "feishu",
            this.store,
            this.getSettings,
            this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
            options.usageTracker,
            options.memory
        );
        this.acp = new AcpService(
            this.getSettings,
            this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
            { stateFilePath: join(this.workspaceDir, "acp_sessions.json") }
        );
        this.acpTemplate = new BasicChannelAcpTemplate<void>({
            acp: this.acp,
            sendText: async (chatId, _context, text) => {
                await sendFeishuText(this.client, chatId, text);
            },
            runPrompt: async (chatId, _context, request) => {
                await this.runAcpPrompt(chatId, request.prompt, request.startText);
            }
        });
        this.commandService = new SharedRuntimeCommandService<string>({
            channel: "feishu",
            instanceId: this.instanceId,
            workspaceDir: this.workspaceDir,
            authScopePrefix: "feishu",
            store: this.store,
            runners: this.runners,
            getSettings: this.getSettings,
            updateSettings: this.updateSettings,
            isRunning: (scopeId) => this.running.has(scopeId),
            stopRun: (scopeId) => this.stopChatWork(scopeId),
            cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
            maybeHandleAcpCommand: (scopeId, cmd, rawArg) =>
                this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, undefined),
            sendText: async (chatId, text) => {
                await sendFeishuText(this.client, chatId, text);
            },
            onSessionMutation: (scopeId) => {
                void this.writePromptPreview([scopeId]);
            },
            getQueueSize: (scopeId) => this.chatQueues.get(scopeId)?.size() ?? 0,
            helpLines: this.acpTemplate.helpLines()
        });
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

        momLog("feishu", "adapter_started", {
            allowedChatCount: allowed.size
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
            try {
                this.wsClient.close({ force: true });
            } catch (error) {
                momWarn("feishu", "adapter_stop_close_failed", {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
            momLog("feishu", "adapter_stopped");
        }

        this.client = undefined;
        this.wsClient = undefined;
        this.currentAppId = "";
        this.currentAppSecret = "";
        this.currentAllowedChatIdsKey = "";
        void this.acp.dispose();
    }

    private markInboundMessageSeen(chatId: string, rawMessageId: string): boolean {
        const key = `${chatId}:${rawMessageId}`;
        const now = Date.now();
        const expiresAt = this.inboundDedupe.get(key);
        if (expiresAt && expiresAt > now) {
            return false;
        }

        this.inboundDedupe.set(key, now + FeishuManager.INBOUND_DEDUPE_TTL_MS);

        if (this.inboundDedupe.size > 2048) {
            for (const [entryKey, entryExpiresAt] of this.inboundDedupe.entries()) {
                if (entryExpiresAt <= now) {
                    this.inboundDedupe.delete(entryKey);
                }
            }
        }

        return true;
    }

    private async sendAcpPermissionCard(chatId: string, permission: AcpPendingPermissionView): Promise<void> {
        await sendFeishuText(this.client, chatId, buildAcpPermissionText(permission));
    }

    private async runAcpPrompt(chatId: string, prompt: string, startText: string): Promise<void> {
        const started = await sendFeishuText(this.client, chatId, startText);
        const statusMessageId = started?.message_id ?? null;
        let lastStatus = startText;
        const setStatus = async (text: string) => {
            if (!statusMessageId || !text.trim() || text === lastStatus) return;
            await editFeishuText(this.client, statusMessageId, text);
            lastStatus = text;
        };

        const result = await this.acp.runTask(chatId, prompt, {
            onStatus: async (text) => {
                await setStatus(text);
            },
            onEvent: async (text) => {
                await sendFeishuText(this.client, chatId, text);
            },
            onPermissionRequest: async (permission) => {
                await this.sendAcpPermissionCard(chatId, permission);
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
            result.lastStatus ? `Last status: ${result.lastStatus}` : ""
        ].filter(Boolean);
        if (completedTools.length > 0) summaryLines.push(`Completed tools: ${completedTools.length}`);
        if (failedTools.length > 0) summaryLines.push(`Failed tools: ${failedTools.length}`);
        if (touchedLocations.length > 0) summaryLines.push(`Touched: ${touchedLocations.slice(0, 8).join(", ")}`);
        await sendFeishuText(this.client, chatId, summaryLines.join("\n"));
        if (result.assistantText.trim()) {
            await sendFeishuText(this.client, chatId, result.assistantText.trim());
        }
    }

    private async handleIncomingMessage(message: Record<string, any>, sender: Record<string, any>, allowed: Set<string>): Promise<void> {
        if (!this.client || !this.wsClient) return;

        const chatId = String(message.chat_id || "");
        const userId = String(sender.sender_id?.open_id || "unknown");
        const messageId = String(message.message_id || "");

        if (allowed.size > 0 && !allowed.has(chatId)) {
            momWarn("feishu", "message_blocked_chat", { chatId, userId, messageId });
            return;
        }

        if (!messageId) {
            momWarn("feishu", "message_ignored_missing_id", { chatId, userId });
            return;
        }

        if (!this.markInboundMessageSeen(chatId, messageId)) {
            momWarn("feishu", "message_dedup_skipped_raw", { chatId, userId, messageId });
            return;
        }

        if (!isFeishuGroupMessageTriggered(message)) {
            momLog("feishu", "group_message_ignored_no_mention", { chatId, messageId });
            return;
        }

        const event = await toFeishuInboundEvent({
            client: this.client,
            store: this.store,
            message,
            sender
        });
        if (!event) {
            momLog("feishu", "message_ignored_empty", { chatId, messageId });
            return;
        }

        const lowered = event.text.trim().toLowerCase();
        try {
            if (await this.acpTemplate.maybeProxy(chatId, event.text, undefined)) {
                return;
            }
        } catch (error) {
            await sendFeishuText(this.client, chatId, error instanceof Error ? error.message : String(error));
            return;
        }

        const commandText = lowered === "stop" ? "/stop" : event.text;
        if (lowered.startsWith("/") || lowered === "stop") {
            const isCommand = await this.handleCommand(chatId, commandText);
            if (isCommand) {
                return;
            }
        }

        const runId = createRunId(chatId, event.messageId);
        (event as ChannelInboundMessage & { runId?: string }).runId = runId;

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
                await sendFeishuText(this.client, chatId, "Internal error.");
            }
        });
    }

    private async processEvent(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        const chatId = event.chatId;
        const activeSessionId = event.sessionId || this.store.getActiveSession(chatId);
        this.running.add(chatId);

        const runner = this.runners.get(chatId, activeSessionId);

        let currentMessageId: string | null = null;
        let accumulatedText = "";

        const ctx: MomContext = {
            channel: "feishu",
            message: event,
            workspaceDir: this.workspaceDir,
            chatDir: this.store.getChatDir(chatId),
            respond: async (text: string, shouldLog = true) => {
                if (!text.trim()) return;
                const resp = await sendFeishuText(this.client, chatId, text);
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
                await editFeishuText(this.client, currentMessageId, text);
                accumulatedText = text;
            },
            respondInThread: async (text: string) => {
                await ctx.respond(text);
            },
            setTyping: async () => { },
            setWorking: async () => { },
            deleteMessage: async () => {
                await deleteFeishuMessage(this.client, currentMessageId);
                currentMessageId = null;
                accumulatedText = "";
            },
            uploadFile: async (filePath: string, title?: string) => {
                const filename = title || filePath.split("/").pop() || "file";
                const bytes = readFileSync(filePath);
                await sendFeishuFile(this.client, chatId, bytes, filename);
            }
        };

        try {
            await runner.run(ctx);
        } finally {
            this.running.delete(chatId);
        }
    }

    private getQueue(chatId: string): ChannelQueue {
        let queue = this.chatQueues.get(chatId);
        if (!queue) {
            queue = new ChannelQueue("feishu");
            this.chatQueues.set(chatId, queue);
            momLog("feishu", "queue_created", { chatId });
        }
        return queue;
    }

    private stopChatWork(chatId: string): { aborted: boolean } {
        const activeSessionId = this.store.getActiveSession(chatId);
        if (!this.running.has(chatId)) return { aborted: false };
        const runner = this.runners.get(chatId, activeSessionId);
        runner.abort();
        // Release command-side busy guard immediately; queued jobs are kept intact.
        this.running.delete(chatId);
        momLog("feishu", "stop_requested", { chatId, sessionId: activeSessionId });
        return { aborted: true };
    }

    private async handleCommand(chatId: string, text: string): Promise<boolean> {
        const parts = text.split(/\s+/);
        const cmd = parts[0]?.toLowerCase() || "";

        if (cmd === "/chatid") {
            await sendFeishuText(this.client, chatId, `chat_id: ${chatId}`);
            return true;
        }
        return this.commandService.handle({
            chatId,
            scopeId: chatId,
            text,
            target: chatId
        });
    }

    private startEventsWatchers(allowed: Set<string>): void {
        // stub
    }

    private async writePromptPreview(allowedChatIds: string[]): Promise<void> {
        const chatId = allowedChatIds[0] ?? "__preview__";
        const sessionId = allowedChatIds[0] ? this.store.getActiveSession(chatId) : "default";
        const memoryText = allowedChatIds[0]
            ? ((await this.memory.buildPromptContext(
                { channel: "feishu", externalUserId: chatId },
                "",
                12,
            )) || "(no working memory yet)")
            : "(no working memory yet)";
        const prompt = buildSystemPromptPreview(this.workspaceDir, chatId, sessionId, memoryText, {
            channel: "feishu",
            settings: this.getSettings()
        });
        const channelSections = buildPromptChannelSections("feishu");
        const sources = getSystemPromptSources(this.workspaceDir, {
            channel: "feishu",
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
        writeFileSync(
            filePath,
            `${header}${prompt}\n`,
            "utf8"
        );
        momLog("feishu", "system_prompt_preview_written", {
            botId: this.instanceId,
            workspaceDir: this.workspaceDir,
            filePath,
            chatId,
            sessionId,
            promptLength: prompt.length,
        });
    }
}
