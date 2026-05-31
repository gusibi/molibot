import { readFileSync } from "node:fs";
import * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { buildHostBashApprovalPrompt, getHostBashStore, type HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import { type MomEvent, type EventDeliveryMode } from "$lib/server/agent/events.js";
import { createRunId, momError, momLog, momWarn } from "$lib/server/agent/common/log.js";
import { SharedRuntimeCommandService } from "$lib/server/agent/commands/channelCommands.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { formatRunArchiveNotice } from "$lib/server/agent/session/runDetail.js";
import type { ChannelInboundMessage, MomContext, RunResult } from "$lib/server/agent/core/types.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import {
    buildFeishuHostToolApprovalCard,
    buildFeishuHostToolApprovalResultCard,
    deleteFeishuMessage,
    editFeishuText,
    sendFeishuCard,
    sendFeishuFile,
    sendFeishuText
} from "$lib/server/channels/feishu/messaging.js";
import { isFeishuGroupMessageTriggered, toFeishuInboundEvent } from "$lib/server/channels/feishu/message-intake.js";
import { BaseChannelRuntime } from "$lib/server/channels/shared/baseRuntime.js";
import { rebuildImageContentsFromAttachments } from "$lib/server/channels/shared/attachmentImageContents.js";
import { FeishuStreamingSession } from "$lib/server/channels/feishu/streamingSession.js";
import { InboundTaskCoordinator } from "$lib/server/channels/shared/inboundCoordinator.js";
import { SqliteOutbox } from "$lib/server/channels/shared/outbox.js";

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
            steerRun: (scopeId, text) => this.steerChatWork(scopeId, text),
            followUpRun: (scopeId, text) => this.followUpChatWork(scopeId, text),
            sendText: async (chatId, text) => {
                await this.sendText(chatId, text);
            },
            uploadFile: async (chatId, filePath, title) => {
                if (!this.client) {
                    throw new Error("Feishu client is not running.");
                }
                const filename = title || filePath.split("/").pop() || "runlog.txt";
                const bytes = readFileSync(filePath);
                await sendFeishuFile(this.client, chatId, bytes, filename);
            },
            onSessionMutation: (scopeId) => {
                void this.writePromptPreview([scopeId]);
            },
            ...this.inboundTasks.toCommandOptions()
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

        void this.writePromptPreview(Array.from(allowed));
    }

    stop(): void {
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
    }

    private async sendHostToolApprovalCard(chatId: string, prompt: HostBashApprovalPrompt): Promise<void> {
        await sendFeishuCard(this.client, chatId, buildFeishuHostToolApprovalCard(prompt, {
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
        if (String(value.kind ?? "").trim() === "host_bash_approval") {
            if (String(value.botId ?? "").trim() !== this.instanceId) return undefined;
            const chatId = String(value.chatId ?? "").trim();
            const requestId = String(value.requestId ?? "").trim();
            const action = String(value.action ?? "").trim();
            if (!chatId || !requestId || !action) return undefined;
            const input = { chatId, scopeId: chatId, text: "", target: chatId };
            const request = getHostBashStore().getPendingApproval(chatId, requestId);
            const prompt: HostBashApprovalPrompt = request ? buildHostBashApprovalPrompt(request) : {
                type: "host_bash_approval" as const,
                requestId,
                title: "Host Bash approval",
                body: "Request no longer available.",
                options: [],
                request: {
                    toolId: "",
                    displayName: "",
                    command: "",
                    args: [],
                    approvalMode: "persistent",
                    reason: "",
                    permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
                    requestedAt: new Date().toISOString()
                }
            };
            try {
                if (action === "approve") {
                    const result = await this.commandService.approveHostTool(input, requestId);
                    return buildFeishuHostToolApprovalResultCard(prompt, result.message, result.ok ? "green" : "red");
                }
                if (action === "approve_session") {
                    const result = await this.commandService.approveHostToolForSession(input, requestId);
                    return buildFeishuHostToolApprovalResultCard(prompt, result.message, result.ok ? "green" : "red");
                }
                if (action === "reject") {
                    const result = await this.commandService.rejectHostTool(input, requestId);
                    await this.sendText(chatId, result.message);
                    return buildFeishuHostToolApprovalResultCard(prompt, result.message, result.ok ? "red" : "red");
                }
                return buildFeishuHostToolApprovalResultCard(prompt, `Unsupported action: ${action}`, "red");
            } catch (error) {
                return buildFeishuHostToolApprovalResultCard(
                    prompt,
                    error instanceof Error ? error.message : String(error),
                    "red"
                );
            }
        }
        return undefined;
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

        const commandText = lowered === "stop" ? "/stop" : event.text;
        const isCommand = await this.handleCommand(chatId, commandText);
        if (isCommand) {
            return;
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

        const queueId = this.inboundTasks.enqueue(chatId, queuedEvent, { preview: queuedEvent.text });
        const queueState = this.inboundTasks.peek(chatId, queueId);
        if (queueState.status === "pending") {
            momLog("feishu", "message_queued_while_busy", { runId, chatId, queueId });
            await this.sendText(chatId, this.buildQueuedBusyNotice(queueId));
        }
    }

    private async processEvent(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        if (!this.isStreamingOutputEnabled()) {
            await this.runSharedFeishuTextTask(event);
            return;
        }

        const chatId = event.chatId;
        event.workspaceId = event.workspaceId || this.workspaceId;
        const activeSessionId = event.sessionId || this.store.getActiveSession(chatId);
        const turn = getTurnOrchestrator().prepareTurn({
            chatId,
            sessionId: activeSessionId,
            message: event
        });
        const runId = turn.runId;

        this.running.add(chatId);
        this.appendConversationMessage(
            this.channelName,
            `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`,
            event.isEvent ? "system" : "user",
            event.text,
            "session_user_append_failed",
            { chatId, scopeId: chatId }
        );

        const runner = this.runners.get(chatId, activeSessionId);
        const settings = this.getSettings();
        const feishuInstance = settings.channels?.feishu?.instances?.find((item) => item.id === this.instanceId);
        const displayConfig = {
            toolProgress: feishuInstance?.display?.toolProgress ?? settings.display?.toolProgress ?? "all",
            showReasoning: feishuInstance?.display?.showReasoning ?? settings.display?.showReasoning ?? "off",
            gatewayNotifyInterval: feishuInstance?.display?.gatewayNotifyInterval ?? settings.display?.gatewayNotifyInterval ?? 0
        };
        const streaming = new FeishuStreamingSession({
            client: this.client,
            chatId,
            runId,
            title: "Molibot",
            displayConfig
        });
        let threadEventCount = 0;
        let result: RunResult | null = null;

        const ctx: MomContext = {
            channel: "feishu",
            message: event,
            workspaceDir: this.workspaceDir,
            chatDir: this.store.getChatDir(chatId),
            respond: async (text, shouldLog = true) => {
                await streaming.respond(text, shouldLog);
            },
            replaceMessage: async (text) => {
                await streaming.replaceAnswer(text);
            },
            commitMainAnswer: async (text) => {
                await streaming.commitMainAnswer(text);
            },
            sendSupplement: async (text) => {
                await streaming.sendSupplement(text);
            },
            beginContinuationResponse: async (partialText, notice) => {
                await streaming.beginContinuationResponse(partialText, notice);
            },
            respondInThread: async (text) => {
                threadEventCount += 1;
                await streaming.respondInThread(text);
            },
            setTyping: async () => {},
            setWorking: async () => {},
            deleteMessage: async () => {},
            uploadFile: async (filePath, title) => {
                const filename = title || filePath.split("/").pop() || "file";
                const bytes = readFileSync(filePath);
                await sendFeishuFile(this.client, chatId, bytes, filename);
            },
            onRunnerEvent: async (runnerEvent) => {
                if (runnerEvent.type === "tool_execution_end" && runnerEvent.hostBashApproval) {
                    await this.sendHostToolApprovalCard(chatId, runnerEvent.hostBashApproval);
                }
                await streaming.handleRunnerEvent(runnerEvent);
            }
        };

        try {
            result = await runner.run(ctx);
        } catch (error) {
            getTurnOrchestrator().failRunIfRunning(
                runId,
                error instanceof Error ? error.message : String(error)
            );
            throw error;
        } finally {
            this.running.delete(chatId);
            await streaming.finalize(result ?? { runId, stopReason: "error", errorMessage: "Run did not complete." });
        }

        const finalText = streaming.finalText;
        if (finalText) {
            const numericMessageId = Number(streaming.sentMessageId || Date.now());
            this.store.logBotResponse(chatId, finalText, Number.isFinite(numericMessageId) ? numericMessageId : Date.now());
            this.appendConversationMessage(
                this.channelName,
                `bot:${this.instanceId}:chat:${chatId}:${activeSessionId}`,
                "assistant",
                finalText,
                "session_assistant_append_failed",
                { chatId, scopeId: chatId }
            );
        }

        if (result?.stopReason === "stop" && threadEventCount > 0 && result.runId) {
            await this.sendText(chatId, formatRunArchiveNotice(result.runId));
        }
    }

    private async runSharedFeishuTextTask(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        const chatId = event.chatId;
        await this.runSharedTextTask(chatId, event, {
            response: {
                sendText: async (text) => {
                    const resp = await this.sendText(chatId, text);
                    return resp?.message_id ? { messageId: resp.message_id } : null;
                },
                respondInThread: async (text) => {
                    await this.sendText(chatId, text);
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
            onRunnerEvent: async (runnerEvent) => {
                if (runnerEvent.type === "tool_execution_end" && runnerEvent.hostBashApproval) {
                    await this.sendHostToolApprovalCard(chatId, runnerEvent.hostBashApproval);
                }
            },
            onRunComplete: async (result, meta) => {
                if (result.stopReason === "stop" && meta.threadEventCount > 0 && result.runId) {
                    await this.sendText(chatId, formatRunArchiveNotice(result.runId));
                }
            },
            createBotMessageId: () => Date.now(),
            onSessionAppendWarning: (error) => {
                momWarn("feishu", "session_assistant_append_failed", {
                    chatId,
                    error: error instanceof Error ? error.message : String(error)
                });
            },
            role: event.isEvent ? "system" : "user"
        });
    }

    private isStreamingOutputEnabled(): boolean {
        const instance = this.getSettings().channels?.feishu?.instances?.find((item) => item.id === this.instanceId);
        const raw = String(instance?.credentials?.streamOutput ?? "").trim().toLowerCase();
        if (!raw) return true;
        return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
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
            imageContents: rebuildImageContentsFromAttachments(event.attachments, this.workspaceDir, (attachment, error) => {
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
            momWarn("feishu", "trigger_task_invalid_payload", { filename: _filename });
            throw new Error("Invalid task payload");
        }
        if (!this.client) {
            momWarn("feishu", "trigger_task_bot_not_running", {
                filename: _filename,
                chatId: task.chatId,
                eventType: task.type
            });
            throw new Error("Feishu bot is not running.");
        }

        const delivery = this.resolveEventDeliveryMode(task);
        momLog("feishu", "trigger_task_start", {
            filename: _filename,
            chatId: task.chatId,
            eventType: task.type,
            delivery
        });

        try {
            if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
                await this.sendText(task.chatId, task.text);
                momLog("feishu", "trigger_task_text_done", { filename: _filename, chatId: task.chatId });
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
            momLog("feishu", "trigger_task_agent_done", { filename: _filename, chatId: task.chatId });
        } catch (error) {
            momError("feishu", "trigger_task_failed", {
                filename: _filename,
                chatId: task.chatId,
                eventType: task.type,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

}
