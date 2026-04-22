import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, extname } from "node:path";
import * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "../../settings/index.js";
import { EventsWatcher, type MomEvent, type EventDeliveryMode } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { ModelErrorTracker } from "../../usage/modelErrorTracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import {
    buildFeishuAcpPermissionResultCard,
    buildFeishuAcpPermissionCard,
    deleteFeishuMessage,
    editFeishuStatusCard,
    editFeishuText,
    sendFeishuCard,
    sendFeishuFile,
    sendFeishuStatusCard,
    sendFeishuText
} from "./messaging.js";
import { isFeishuGroupMessageTriggered, toFeishuInboundEvent } from "./message-intake.js";
import { BasicChannelAcpTemplate } from "../shared/acp.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import { rebuildImageContentsFromAttachments } from "../shared/attachmentImageContents.js";
import { InboundTaskCoordinator } from "../shared/inboundCoordinator.js";
import { SqliteOutbox } from "../shared/outbox.js";

export interface FeishuConfig {
    appId: string;
    appSecret: string;
    verificationToken?: string;
    encryptKey?: string;
    allowedChatIds: string[];
}

// Orchestrates Feishu-specific inbound handling, command flow, and runner lifecycle.
// Leaf concerns like queueing, message send/edit, and intake parsing live in sibling files.
export class FeishuManager extends BaseChannelRuntime {
    private static readonly CHAT_EVENTS_RELATIVE_DIR = ["events"] as const;
    private readonly acpTemplate: BasicChannelAcpTemplate<void>;
    private readonly commandService: SharedRuntimeCommandService<string>;
    private readonly outbox: SqliteOutbox<{ chatId: string; text: string }, { messageId: string | null }>;
    private readonly inboundTasks: InboundTaskCoordinator<ChannelInboundMessage, string>;

    private client: lark.Client | undefined;
    private wsClient: lark.WSClient | undefined;
    private cardActionHandler: lark.CardActionHandler | undefined;

    private currentAppId = "";
    private currentAppSecret = "";
    private currentVerificationToken = "";
    private currentEncryptKey = "";
    private currentAllowedChatIdsKey = "";

    private readonly events: EventsWatcher[] = [];
    private readonly watchedChatEventDirs = new Set<string>();

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
            channel: "feishu",
            defaultWorkspaceName: "moli-f",
            getSettings,
            updateSettings,
            sessionStore,
            options
        });
        this.acpTemplate = new BasicChannelAcpTemplate<void>({
            acp: this.acp,
            sendText: async (chatId, _context, text) => {
                await this.sendText(chatId, text);
            },
            runPrompt: async (chatId, _context, request) => {
                await this.runAcpPrompt(chatId, request.prompt, request.startText);
            }
        });
        this.inboundTasks = new InboundTaskCoordinator<ChannelInboundMessage, string>({
            channel: "feishu",
            instanceId: this.instanceId,
            process: async (payload) => {
                try {
                    const event = this.rehydrateQueuedEvent(payload);
                    await this.processEvent(event);
                } catch (error) {
                    momError("feishu", "queue_job_uncaught", {
                        chatId: payload.chatId,
                        queueId: payload.messageId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    await this.sendText(payload.chatId, "Internal error.");
                    throw error;
                }
            },
            enqueueFrontFromCommand: async (input, text) => this.enqueueSyntheticTask(input.scopeId, text, true)
        });
        this.commandService = this.createSharedCommandService<string>({
            authScopePrefix: "feishu",
            isRunning: (scopeId) => this.running.has(scopeId),
            stopRun: (scopeId) => this.stopChatWork(scopeId),
            cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
            maybeHandleAcpCommand: (scopeId, cmd, rawArg) =>
                this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, undefined),
            sendText: async (chatId, text) => {
                await this.sendText(chatId, text);
            },
            onSessionMutation: (scopeId) => {
                void this.writePromptPreview([scopeId]);
            },
            ...this.inboundTasks.toCommandOptions(),
            helpLines: this.acpTemplate.helpLines()
        });
        this.outbox = new SqliteOutbox<{ chatId: string; text: string }, { messageId: string | null }>({
            channel: "feishu",
            instanceId: this.instanceId,
            deliver: async (payload) => {
                const result = await sendFeishuText(this.client, payload.chatId, payload.text);
                if (!result) {
                    throw new Error("Feishu text delivery failed.");
                }
                return { messageId: result?.message_id ?? null };
            }
        });
    }

    apply(cfg: FeishuConfig): void {
        const appId = cfg.appId.trim();
        const appSecret = cfg.appSecret.trim();
        const verificationToken = String(cfg.verificationToken ?? "").trim();
        const encryptKey = String(cfg.encryptKey ?? "").trim();
        const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
        const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

        momLog("feishu", "apply", {
            hasAppId: Boolean(appId),
            hasAppSecret: Boolean(appSecret),
            hasVerificationToken: Boolean(verificationToken),
            hasEncryptKey: Boolean(encryptKey),
            allowedChatCount: allowedChatIds.length
        });

        if (!appId || !appSecret) {
            this.stop();
            momWarn("feishu", "disabled_no_credentials");
            return;
        }

        if (
            this.client &&
            this.currentAppId === appId &&
            this.currentAppSecret === appSecret &&
            this.currentVerificationToken === verificationToken &&
            this.currentEncryptKey === encryptKey &&
            this.currentAllowedChatIdsKey === allowedChatIdsKey
        ) {
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

        this.cardActionHandler = new lark.CardActionHandler(
            {
                verificationToken,
                encryptKey,
                loggerLevel: lark.LoggerLevel.info
            },
            async (event: lark.InteractiveCardActionEvent) => this.handleCardActionEvent(event)
        );

        momLog("feishu", "adapter_started", {
            allowedChatCount: allowed.size
        });

        void this.outbox.resume();
        void this.inboundTasks.resumeAll();

        this.currentAppId = appId;
        this.currentAppSecret = appSecret;
        this.currentVerificationToken = verificationToken;
        this.currentEncryptKey = encryptKey;
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
        this.cardActionHandler = undefined;
        this.currentAppId = "";
        this.currentAppSecret = "";
        this.currentVerificationToken = "";
        this.currentEncryptKey = "";
        this.currentAllowedChatIdsKey = "";
        void this.acp.dispose();
    }

    private async sendAcpPermissionCard(chatId: string, permission: AcpPendingPermissionView): Promise<void> {
        await sendFeishuCard(this.client, chatId, buildFeishuAcpPermissionCard(permission, {
            botId: this.instanceId,
            chatId
        }));
    }

    private async sendText(chatId: string, text: string): Promise<{ message_id: string } | null> {
        const normalized = String(text ?? "").trim();
        if (!normalized) return null;
        const result = await this.outbox.enqueue(chatId, { chatId, text: normalized });
        return result.messageId ? { message_id: result.messageId } : null;
    }

    public async handleCardCallbackRequest(payload: unknown): Promise<lark.InteractiveCard | undefined> {
        if (!this.cardActionHandler) return undefined;
        const result = await this.cardActionHandler.invoke(payload);
        if (result && typeof result === "object") {
            return result as lark.InteractiveCard;
        }
        return undefined;
    }

    private async handleCardActionEvent(event: lark.InteractiveCardActionEvent): Promise<lark.InteractiveCard | undefined> {
        const rawValue = event.action?.value;
        const value = rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : {};
        if (String(value.kind ?? "").trim() !== "acp_permission") return undefined;
        if (String(value.botId ?? "").trim() !== this.instanceId) return undefined;

        const chatId = String(value.chatId ?? "").trim();
        const requestId = String(value.requestId ?? "").trim();
        const action = String(value.action ?? "").trim();
        const optionId = String(value.optionId ?? "").trim();
        if (!chatId || !requestId || !action) return undefined;

        const permission = this.acp.getPendingPermission(chatId, requestId) ?? {
            id: requestId,
            title: "Approval Request",
            kind: "permission",
            options: [],
            createdAt: new Date().toISOString()
        };

        try {
            let outcome = "";
            if (action === "approve") {
                if (!optionId) {
                    throw new Error("Missing optionId for approve action.");
                }
                outcome = await this.acp.approve(chatId, requestId, optionId);
                return buildFeishuAcpPermissionResultCard(permission, outcome, "green");
            }
            if (action === "deny") {
                outcome = await this.acp.deny(chatId, requestId);
                return buildFeishuAcpPermissionResultCard(permission, outcome, "red");
            }
            return buildFeishuAcpPermissionResultCard(permission, `Unsupported action: ${action}`, "red");
        } catch (error) {
            return buildFeishuAcpPermissionResultCard(
                permission,
                error instanceof Error ? error.message : String(error),
                "red"
            );
        }
    }

    private async runAcpPrompt(chatId: string, prompt: string, startText: string): Promise<void> {
        const started = await sendFeishuStatusCard(this.client, chatId, {
            title: "ACP Running",
            body: startText,
            tone: "blue"
        });
        const statusMessageId = started?.message_id ?? null;
        let lastStatus = startText;
        const setStatus = async (text: string) => {
            if (!statusMessageId || !text.trim() || text === lastStatus) return;
            await editFeishuStatusCard(this.client, statusMessageId, {
                title: "ACP Running",
                body: text,
                tone: "blue"
            });
            lastStatus = text;
        };

        const result = await this.acp.runTask(chatId, prompt, {
            onStatus: async (text) => {
                await setStatus(text);
            },
            onEvent: async (text) => {
                await this.sendText(chatId, text);
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
        await sendFeishuStatusCard(this.client, chatId, {
            title: result.stopReason === "completed" ? "ACP Finished" : "ACP Stopped",
            body: summaryLines.join("\n"),
            tone: result.stopReason === "completed" ? "green" : "orange"
        });
        if (result.assistantText.trim()) {
            await this.sendText(chatId, result.assistantText.trim());
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
            await this.sendText(chatId, error instanceof Error ? error.message : String(error));
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

        const queuedEvent: ChannelInboundMessage = {
            ...event,
            sessionId: this.store.getActiveSession(chatId),
            imageContents: []
        };

        if (this.inboundTasks.size(chatId) > 0 || this.running.has(chatId)) {
            momLog("feishu", "message_queued_while_busy", { runId, chatId });
        }
        this.inboundTasks.enqueue(chatId, queuedEvent, { preview: queuedEvent.text });
    }

    private async processEvent(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        const chatId = event.chatId;
        await this.runSharedTextTask(chatId, event, {
            response: {
                sendText: async (text) => {
                    const resp = await this.sendText(chatId, text);
                    return resp?.message_id ? { messageId: resp.message_id } : null;
                },
                editText: async (message, text) => {
                    await editFeishuText(this.client, String(message.messageId), text);
                    return true;
                },
                deleteMessage: async (message) => {
                    await deleteFeishuMessage(this.client, String(message.messageId));
                    return true;
                },
                uploadFile: async (filePath, title) => {
                    const filename = title || filePath.split("/").pop() || "file";
                    const bytes = readFileSync(filePath);
                    await sendFeishuFile(this.client, chatId, bytes, filename);
                }
            },
            createBotMessageId: () => Date.now(),
            onSessionAppendWarning: (error) => {
                momWarn("feishu", "session_assistant_append_failed", {
                    chatId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    private async handleCommand(chatId: string, text: string): Promise<boolean> {
        const parts = text.split(/\s+/);
        const cmd = parts[0]?.toLowerCase() || "";

        if (cmd === "/chatid") {
            await this.sendText(chatId, `chat_id: ${chatId}`);
            return true;
        }
        return this.commandService.handle({
            chatId,
            scopeId: chatId,
            text,
            target: chatId
        });
    }

    private rehydrateQueuedEvent(event: ChannelInboundMessage): ChannelInboundMessage {
        return {
            ...event,
            imageContents: rebuildImageContentsFromAttachments(event.attachments, (attachment, error) => {
                momWarn("feishu", "queued_image_restore_failed", {
                    chatId: event.chatId,
                    file: attachment.local,
                    error: error instanceof Error ? error.message : String(error)
                });
            })
        };
    }

    private async enqueueSyntheticTask(chatId: string, text: string, front: boolean): Promise<number | null> {
        const normalized = String(text ?? "").trim();
        if (!normalized) return null;
        return this.inboundTasks.enqueue(chatId, {
            chatId,
            scopeId: chatId,
            chatType: "private",
            messageId: Date.now(),
            userId: "QUEUE",
            userName: "QUEUE",
            text: normalized,
            ts: `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`,
            attachments: [],
            imageContents: [],
            sessionId: this.store.getActiveSession(chatId)
        }, { front, preview: normalized });
    }

    private resolveEventDeliveryMode(task: MomEvent): EventDeliveryMode {
        return task.delivery === "text" ? "text" : "agent";
    }

    async triggerTask(event: unknown, _filename: string): Promise<void> {
        const task = event as MomEvent;
        if (!task || typeof task !== "object" || typeof task.chatId !== "string" || typeof task.text !== "string") {
            throw new Error("Invalid task payload");
        }
        if (!this.client) {
            throw new Error("Feishu bot is not running.");
        }

        const delivery = this.resolveEventDeliveryMode(task);
        if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
            await this.sendText(task.chatId, task.text);
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
            ts: `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, "0")}`,
            attachments: [],
            imageContents: [],
            isEvent: true
        };
        await this.processEvent(synthetic);
    }

    private startEventsWatchers(allowed: Set<string>): void {
        // stub
    }
}
