import { readFileSync } from "node:fs";
import * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
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
    buildFeishuHostToolApprovalProcessingCard,
    buildFeishuHostToolApprovalResultCard,
    deleteFeishuMessage,
    editFeishuCard,
    editFeishuText,
    sendFeishuCard,
    sendFeishuFile,
    sendFeishuText
} from "$lib/server/channels/feishu/messaging.js";
import { isFeishuGroupMessageTriggered, toFeishuInboundEvent } from "$lib/server/channels/feishu/message-intake.js";
import { FeishuThreadRegistry } from "$lib/server/channels/feishu/threadRegistry.js";
import { BaseChannelRuntime } from "$lib/server/channels/shared/baseRuntime.js";
import { rebuildImageContentsFromAttachments } from "$lib/server/channels/shared/attachmentImageContents.js";
import { FeishuCardActionCoordinator, normalizeFeishuWsCardActionEvent } from "$lib/server/channels/feishu/cardAction.js";
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

interface FeishuCardActionOutcome {
    chatId: string;
    message: string;
    card: lark.InteractiveCard;
}

interface FeishuApprovalActionResult {
    ok: boolean;
    message: string;
}

const FEISHU_CARD_ACTION_BACKGROUND_DELAY_MS = 1000;

function waitForFeishuCardCallbackResponse(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, FEISHU_CARD_ACTION_BACKGROUND_DELAY_MS));
}

// Orchestrates Feishu-specific inbound handling, command flow, and runner lifecycle.
// Leaf concerns like queueing, message send/edit, and intake parsing live in sibling files.
export class FeishuManager extends BaseChannelRuntime {
    private readonly commandService: SharedRuntimeCommandService<string>;
    private readonly outbox: SqliteOutbox<{ chatId: string; text: string }, { messageId: string | null }>;
    private readonly inboundTasks: InboundTaskCoordinator<ChannelInboundMessage, string>;
    private readonly cardActions = new FeishuCardActionCoordinator<FeishuCardActionOutcome | undefined>();
    private readonly threadRegistry: FeishuThreadRegistry;

    private client: lark.Client | undefined;
    private wsClient: lark.WSClient | undefined;
    private cardActionHandler: lark.CardActionHandler | undefined;

    private currentAppId = "";
    private currentAppSecret = "";
    private currentVerificationToken = "";
    private currentEncryptKey = "";
    private currentAllowedChatIdsKey = "";
    private currentBotOpenId = "";
    private botIdentityReady: Promise<void> = Promise.resolve();
    private botIdentityResolved = false;

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
        this.threadRegistry = new FeishuThreadRegistry(this.workspaceDir);
        this.inboundTasks = new InboundTaskCoordinator<ChannelInboundMessage, string>({
            channel: "feishu",
            instanceId: this.instanceId,
            process: async (payload) => {
                momLog("feishu", "queue_job_starting", { payload });
                try {
                    const event = this.rehydrateQueuedEvent(payload);
                    momLog("feishu", "queue_job_event_rehydrated", { event });
                    await this.processEvent(event);
                    momLog("feishu", "queue_job_completed");
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    if (errorMessage.includes("Another run is currently active")) {
                        momWarn("feishu", "queue_job_busy_not_duplicated", {
                            chatId: payload.chatId,
                            queueId: payload.messageId
                        });
                        throw error;
                    }

                    momError("feishu", "queue_job_uncaught", {
                        chatId: payload.chatId,
                        queueId: payload.messageId,
                        error: errorMessage,
                        stack: error instanceof Error ? error.stack : undefined
                    });
                    try {
                        momLog("feishu", "queue_job_sending_error_message");
                        // Don't use replyOptions when sending error message, just send to chat
                        await sendFeishuText(this.client, payload.chatId, "Internal error.");
                        momLog("feishu", "queue_job_error_message_sent");
                    } catch (_sendError) {
                        momError("feishu", "queue_job_error_message_send_failed", {
                            error: _sendError instanceof Error ? _sendError.message : String(_sendError)
                        });
                        // Ignore send failures during error recovery.
                    }
                    // Do not rethrow — the error is already logged and the user notified.
                }
            },
            enqueueFrontFromCommand: async (input, text) => this.enqueueSyntheticTask(input.scopeId, text, true)
        });
        this.commandService = this.createSharedCommandService<string>({
            authScopePrefix: "feishu",
            isRunning: (scopeId) => this.isScopeBusy(scopeId),
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
        momLog("feishu", "apply_called", { cfg });

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
        this.currentBotOpenId = "";
        this.botIdentityResolved = false;
        this.botIdentityReady = this.resolveBotOpenId(appId);

        momLog("feishu", "setting_up_event_dispatcher");

        const handler = new lark.EventDispatcher({}).register({
            "im.message.receive_v1": async (data: any) => {
                momLog("feishu_ws", "im.message.receive_v1_received", { data });
                await this.handleIncomingMessage(data.message, data.sender, allowed);
            },
            "card.action.trigger": async (data: any) => {
                momLog("feishu_ws", "card.action.trigger_received", { data });
                return this.handleWsCardAction(data, allowed);
            }
        });

        momLog("feishu", "setting_up_ws_client");

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

        // Start WS immediately so no messages are missed.
        // handleIncomingMessage awaits botIdentityReady before the mention check,
        // so by the time it evaluates isFeishuBotMention, currentBotOpenId is set.
        momLog("feishu", "starting_ws_client");
        this.wsClient.start({ eventDispatcher: handler });
        momLog("feishu", "ws_client_start_called");

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
        this.currentBotOpenId = "";
        this.botIdentityResolved = false;
        this.botIdentityReady = Promise.resolve();
    }

    private async resolveBotOpenId(appId: string): Promise<void> {
        if (!this.client) {
            momWarn("feishu", "bot_identity_probe_skipped_no_client", { appId });
            this.botIdentityResolved = true;
            return;
        }
        momLog("feishu", "bot_identity_probe_start", { appId });
        try {
            const client = this.client as unknown as { request: (input: unknown) => Promise<any> };
            const response = await client.request({
                method: "POST",
                url: "/open-apis/bot/v1/openclaw_bot/ping",
                data: { needBotInfo: true }
            });
            momLog("feishu", "bot_identity_probe_response", {
                appId,
                endpoint: "bot/v1/openclaw_bot/ping",
                code: response?.code,
                hasData: !!response?.data,
                botOpenId: response?.data?.pingBotInfo?.botID,
                botName: response?.data?.pingBotInfo?.botName,
                data: JSON.stringify(response?.data)
            });
            if (response?.code !== 0) {
                momWarn("feishu", "bot_identity_probe_failed", {
                    appId,
                    endpoint: "bot/v1/openclaw_bot/ping",
                    code: response?.code,
                    msg: response?.msg
                });
            }

            function readString(value: unknown): string {
                return String(value ?? "").trim();
            }
            const pingBotInfo = response?.data?.pingBotInfo && typeof response.data.pingBotInfo === "object"
                ? response.data.pingBotInfo as Record<string, any>
                : {};
            let botOpenId = readString(pingBotInfo.botID);
            let botName = readString(pingBotInfo.botName);

            if (!botOpenId) {
                const fallback = await client.request({
                    method: "GET",
                    url: "/open-apis/bot/v3/info"
                });
                momLog("feishu", "bot_identity_probe_response", {
                    appId,
                    endpoint: "bot/v3/info",
                    code: fallback?.code,
                    hasData: !!fallback?.data,
                    rawOpenId: fallback?.data?.open_id,
                    botOpenId: fallback?.data?.bot?.open_id,
                    rawBotId: fallback?.data?.bot_id,
                    botBotId: fallback?.data?.bot?.bot_id,
                    data: JSON.stringify(fallback?.data)
                });
                if (fallback?.code !== 0) {
                    momWarn("feishu", "bot_identity_probe_failed", {
                        appId,
                        endpoint: "bot/v3/info",
                        code: fallback?.code,
                        msg: fallback?.msg
                    });
                    return;
                }
                const data = fallback?.data;
                const bot = data?.bot && typeof data.bot === "object" ? data.bot as Record<string, any> : {};
                botOpenId = readString(data?.open_id || bot.open_id || data?.bot_id || bot.bot_id);
                botName = readString(data?.name || bot.name || data?.bot_name || bot.bot_name);
            }

            if (!botOpenId) {
                momWarn("feishu", "bot_identity_probe_empty_identity", { appId, botName });
                return;
            }

            this.currentBotOpenId = botOpenId;
            momLog("feishu", "bot_identity_probe_ok", {
                appId,
                botOpenId,
                botName
            });
        } catch (error) {
            momWarn("feishu", "bot_identity_probe_failed", {
                appId,
                error: error instanceof Error ? error.message : String(error)
            });
        } finally {
            this.botIdentityResolved = true;
        }
    }

    private async sendHostToolApprovalCard(
        event: ChannelInboundMessage,
        prompt: HostBashApprovalPrompt
    ): Promise<void> {
        const sent = await sendFeishuCard(this.client, event.chatId, buildFeishuHostToolApprovalCard(prompt, {
            botId: this.instanceId,
            chatId: event.chatId,
            scopeId: event.scopeId || event.chatId
        }), this.replyOptionsForEvent(event));
        this.recordFeishuBotMessage(event, sent?.message_id);
    }

    private async sendText(chatId: string, text: string): Promise<{ message_id: string } | null> {
        const normalized = String(text ?? "").trim();
        if (!normalized) return null;
        const result = await this.outbox.enqueue(chatId, { chatId, text: normalized });
        return result.messageId ? { message_id: result.messageId } : null;
    }

    private recordFeishuBotMessage(event: ChannelInboundMessage, messageId: string | null | undefined): void {
        this.threadRegistry.recordBotMessage({
            messageId,
            chatId: event.chatId,
            threadId: event.platformThreadId
        });
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
        const outcome = await this.resolveCardAction(event);
        return outcome?.card;
    }

    private async handleWsCardAction(raw: unknown, allowed: Set<string>): Promise<lark.InteractiveCard | undefined> {
        momLog("feishu", "card_action_received");
        const normalized = normalizeFeishuWsCardActionEvent(raw);
        if (!normalized) {
            momWarn("feishu", "card_action_ignored_invalid_payload");
            return undefined;
        }
        if (allowed.size > 0 && !allowed.has(normalized.chatId)) {
            momWarn("feishu", "card_action_blocked_chat", { chatId: normalized.chatId, messageId: normalized.messageId });
            return undefined;
        }

        const outcome = await this.resolveCardAction(normalized.event);
        return outcome?.card;
    }

    private resolveGenericApprovalAction(requestId: string, action: string): FeishuApprovalActionResult {
        const broker = getApprovalBroker();
        if (action === "approve" || action === "approve_once" || action === "approve_session" || action === "approve_persistent") {
            const selectedScope = action === "approve_session" ? "session" : action === "approve_persistent" ? "persistent" : "once";
            const result = broker.resolveRequest({
                requestId,
                status: "approved",
                selectedScope
            });
            if (!result.request) {
                return { ok: false, message: "No matching pending approval found." };
            }
            const toolName = result.request.action.toolName || result.request.action.command || result.request.capability;
            return {
                ok: true,
                message: [
                    action === "approve_session"
                        ? "Approved for current session."
                        : action === "approve_persistent"
                            ? "Approved persistently."
                            : "Approved one-time tool request.",
                    `Request ID: ${result.request.id}`,
                    `Tool: ${toolName}`,
                    `Scope: ${selectedScope}`
                ].join("\n")
            };
        }

        if (action === "reject") {
            const result = broker.resolveRequest({
                requestId,
                status: "rejected"
            });
            if (!result.request) {
                return { ok: false, message: "No matching pending approval found." };
            }
            const toolName = result.request.action.toolName || result.request.action.command || result.request.capability;
            return {
                ok: true,
                message: [
                    "Rejected tool approval.",
                    `Request ID: ${result.request.id}`,
                    `Tool: ${toolName}`
                ].join("\n")
            };
        }

        return { ok: false, message: `Unsupported action: ${action}` };
    }

    private async resolveApprovalAction(
        input: { chatId: string; scopeId: string; text: string; target: string },
        requestId: string,
        action: string
    ): Promise<FeishuApprovalActionResult> {
        if (action === "approve" || action === "approve_once") {
            const hostResult = await this.commandService.approveHostTool(input, requestId, "once");
            return hostResult.ok ? hostResult : this.resolveGenericApprovalAction(requestId, action);
        }
        if (action === "approve_persistent") {
            const hostResult = await this.commandService.approveHostTool(input, requestId, "persistent");
            return hostResult.ok ? hostResult : this.resolveGenericApprovalAction(requestId, action);
        }
        if (action === "approve_session") {
            const hostResult = await this.commandService.approveHostToolForSession(input, requestId);
            return hostResult.ok ? hostResult : this.resolveGenericApprovalAction(requestId, action);
        }
        if (action === "reject") {
            const hostResult = await this.commandService.rejectHostTool(input, requestId);
            return hostResult.ok ? hostResult : this.resolveGenericApprovalAction(requestId, action);
        }
        return { ok: false, message: `Unsupported action: ${action}` };
    }

    private async resolveCardAction(event: lark.InteractiveCardActionEvent): Promise<FeishuCardActionOutcome | undefined> {
        const rawValue = event.action?.value;
        const value = rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : {};
        if (String(value.kind ?? "").trim() === "host_bash_approval") {
            if (String(value.botId ?? "").trim() !== this.instanceId) return undefined;
            const chatId = String(value.chatId ?? "").trim();
            const scopeId = String(value.scopeId ?? chatId).trim() || chatId;
            const requestId = String(value.requestId ?? "").trim();
            const action = String(value.action ?? "").trim();
            if (!chatId || !requestId || !action) return undefined;
            const input = { chatId, scopeId, text: "", target: chatId };
            const request = getHostBashStore().getApprovalRecord(requestId);
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
            const state = this.cardActions.start(requestId, async () => {
                await waitForFeishuCardCallbackResponse();
                let outcome: FeishuCardActionOutcome;
                try {
                    const result = await this.resolveApprovalAction(input, requestId, action);
                    const card = buildFeishuHostToolApprovalResultCard(prompt, result.message, result.ok ? "green" : "red");
                    outcome = {
                        chatId,
                        message: result.message,
                        card
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const card = buildFeishuHostToolApprovalResultCard(prompt, message, "red");
                    outcome = {
                        chatId,
                        message,
                        card
                    };
                }
                if (event.open_message_id) {
                    const edited = await editFeishuCard(this.client, event.open_message_id, outcome.card);
                    if (edited) {
                        momLog("feishu", "approval_card_updated", { chatId, messageId: edited, requestId });
                    } else {
                        await this.sendText(chatId, outcome.message);
                    }
                }
                return outcome;
            });
            if (state.status === "completed") return state.value;
            void state.promise.catch((error) => {
                momWarn("feishu", "approval_card_action_failed", {
                    chatId,
                    requestId,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
            return {
                chatId,
                message: "Approval is being processed.",
                card: buildFeishuHostToolApprovalProcessingCard(prompt)
            };
        }
        return undefined;
    }

    private async handleIncomingMessage(message: Record<string, any>, sender: Record<string, any>, allowed: Set<string>): Promise<void> {
        if (!this.client || !this.wsClient) {
            momLog("feishu", "handleIncomingMessage_skip_no_client", { hasClient: !!this.client, hasWsClient: !!this.wsClient });
            return;
        }

        const chatId = String(message.chat_id || "");
        const userId = String(sender.sender_id?.open_id || "unknown");
        const messageId = String(message.message_id || "");
        const chatType = String(message.chat_type || "");
        const mentions = Array.isArray(message.mentions) ? message.mentions : [];

        // Wait for bot identity to be resolved before checking mentions.
        // This ensures currentBotOpenId is set so we can accurately match
        // @mentions in multi-bot groups.
        if (!this.botIdentityResolved) {
            momLog("feishu", "handleIncomingMessage_waiting_for_identity", { chatId, messageId });
            await this.botIdentityReady;
        }

        momLog("feishu", "handleIncomingMessage_enter", {
            chatId, userId, messageId, chatType,
            mentionCount: mentions.length,
            mentions: mentions.map((m: any) => ({
                key: m?.key,
                name: m?.name,
                id: m?.id
            })),
            botOpenId: this.currentBotOpenId || "(empty)"
        });

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

        const triggered = isFeishuGroupMessageTriggered(message, {
            botOpenId: this.currentBotOpenId,
            isKnownBotThread: (input) => this.threadRegistry.match(input).allowed
        });

        momLog("feishu", "handleIncomingMessage_trigger_result", {
            chatId, messageId, chatType, triggered,
            botOpenId: this.currentBotOpenId || "(empty)",
            mentions: mentions.map((m: any) => ({
                key: m?.key,
                name: m?.name,
                id: m?.id
            })),
            threadId: message.thread_id || "(none)",
            parentId: message.parent_id || "(none)"
        });

        if (!triggered) {
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

        const scopeId = event.scopeId || chatId;
        const lowered = event.text.trim().toLowerCase();

        const commandText = lowered === "stop" ? "/stop" : event.text;
        const isCommand = await this.handleCommand(scopeId, chatId, commandText);
        if (isCommand) {
            return;
        }

        const runId = createRunId(scopeId, event.messageId);
        (event as ChannelInboundMessage & { runId?: string }).runId = runId;

        const logged = this.store.logMessage(scopeId, {
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
            momWarn("feishu", "message_dedup_skipped", { runId, chatId, scopeId, messageId: event.messageId });
            return;
        }

        const queuedEvent: ChannelInboundMessage = {
            ...event,
            sessionId: this.store.getActiveSession(scopeId),
            imageContents: []
        };

        const queueId = this.inboundTasks.enqueue(scopeId, queuedEvent, { preview: queuedEvent.text });
        const queueState = this.inboundTasks.peek(scopeId, queueId);
        if (queueState.status === "pending") {
            momLog("feishu", "message_queued_while_busy", { runId, chatId, scopeId, queueId });
            await sendFeishuText(this.client, chatId, this.buildQueuedBusyNotice(queueId), this.replyOptionsForEvent(event));
        }
    }

    private replyOptionsForEvent(event: ChannelInboundMessage): { replyToMessageId?: string; replyInThread?: boolean } {
        if (!event.platformThreadId || !event.platformMessageId) return {};
        return {
            replyToMessageId: event.platformMessageId,
            replyInThread: true
        };
    }

    private async processEvent(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        if (!this.isStreamingOutputEnabled()) {
            await this.runSharedFeishuTextTask(event);
            return;
        }

        const chatId = event.chatId;
        const scopeId = event.scopeId || chatId;
        event.workspaceId = event.workspaceId || this.workspaceId;
        const activeSessionId = event.sessionId || this.store.getActiveSession(scopeId);
        const turn = getTurnOrchestrator().prepareTurn({
            chatId: scopeId,
            sessionId: activeSessionId,
            message: event
        });
        const runId = turn.runId;

        this.running.add(scopeId);
        this.appendConversationMessage(
            this.channelName,
            `bot:${this.instanceId}:chat:${scopeId}:${activeSessionId}`,
            event.isEvent ? "system" : "user",
            event.text,
            "session_user_append_failed",
            { chatId: scopeId, scopeId }
        );

        const runner = this.runners.get(scopeId, activeSessionId);
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
            displayConfig,
            ...this.replyOptionsForEvent(event),
            onMessageSent: (messageId) => this.recordFeishuBotMessage(event, messageId)
        });
        let threadEventCount = 0;
        let result: RunResult | null = null;

        const ctx: MomContext = {
            channel: "feishu",
            message: event,
            workspaceDir: this.workspaceDir,
            chatDir: this.store.getChatDir(scopeId),
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
                const sent = await sendFeishuFile(this.client, chatId, bytes, filename, this.replyOptionsForEvent(event));
                this.recordFeishuBotMessage(event, sent?.message_id);
            },
            onRunnerEvent: async (runnerEvent) => {
                if (runnerEvent.type === "tool_execution_end" && runnerEvent.hostBashApproval) {
                    await this.sendHostToolApprovalCard(event, runnerEvent.hostBashApproval);
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
            this.running.delete(scopeId);
            await streaming.finalize(result ?? { runId, stopReason: "error", errorMessage: "Run did not complete." });
        }

        const finalText = streaming.finalText;
        if (finalText) {
            const numericMessageId = Number(streaming.sentMessageId || Date.now());
            this.store.logBotResponse(scopeId, finalText, Number.isFinite(numericMessageId) ? numericMessageId : Date.now());
            this.appendConversationMessage(
                this.channelName,
                `bot:${this.instanceId}:chat:${scopeId}:${activeSessionId}`,
                "assistant",
                finalText,
                "session_assistant_append_failed",
                { chatId: scopeId, scopeId }
            );
        }

        if (result?.stopReason === "stop" && threadEventCount > 0 && result.runId) {
            await this.sendText(chatId, formatRunArchiveNotice(result.runId));
        }
    }

    private async runSharedFeishuTextTask(event: ChannelInboundMessage): Promise<void> {
        if (!this.client) return;
        const chatId = event.chatId;
        const scopeId = event.scopeId || chatId;
        const replyOptions = this.replyOptionsForEvent(event);
        const scopedEvent: ChannelInboundMessage = { ...event, chatId: scopeId, scopeId };
        await this.runSharedTextTask(scopeId, scopedEvent, {
            response: {
                sendText: async (text) => {
                    const resp = Object.keys(replyOptions).length > 0
                        ? await sendFeishuText(this.client, chatId, text, replyOptions)
                        : await this.sendText(chatId, text);
                    this.recordFeishuBotMessage(event, resp?.message_id);
                    return resp?.message_id ? { messageId: resp.message_id } : null;
                },
                respondInThread: async (text) => {
                    const resp = await sendFeishuText(this.client, chatId, text, replyOptions);
                    this.recordFeishuBotMessage(event, resp?.message_id);
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
                    const sent = await sendFeishuFile(this.client, chatId, bytes, filename, replyOptions);
                    this.recordFeishuBotMessage(event, sent?.message_id);
                }
            },
            onRunnerEvent: async (runnerEvent) => {
                if (runnerEvent.type === "tool_execution_end" && runnerEvent.hostBashApproval) {
                    await this.sendHostToolApprovalCard(event, runnerEvent.hostBashApproval);
                }
            },
            onRunComplete: async (result, meta) => {
                if (result.stopReason === "stop" && meta.threadEventCount > 0 && result.runId) {
                    await sendFeishuText(this.client, chatId, formatRunArchiveNotice(result.runId), replyOptions);
                }
            },
            createBotMessageId: () => Date.now(),
            onSessionAppendWarning: (error) => {
                momWarn("feishu", "session_assistant_append_failed", {
                    chatId: scopeId,
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

    private async handleCommand(scopeId: string, chatId: string, text: string): Promise<boolean> {
        const parts = text.split(/\s+/);
        const cmd = parts[0]?.toLowerCase() || "";

        if (cmd === "/chatid") {
            await this.sendText(chatId, `chat_id: ${chatId}`);
            return true;
        }
        return this.commandService.handle({
            chatId,
            scopeId,
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
            (synthetic as ChannelInboundMessage & { runId?: string }).runId = task.status?.runId;
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
