import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../../app/env.js";
import { buildPromptChannelSections } from "../../agent/prompt-channel.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "../../agent/prompt.js";
import { RunnerPool } from "../../agent/runner.js";
import { MomRuntimeStore } from "../../agent/store.js";
import { SessionStore } from "../../sessions/store.js";
import { AcpService } from "../../acp/service.js";
import type { RuntimeSettings } from "../../settings/index.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { ModelErrorTracker } from "../../usage/modelErrorTracker.js";
import { momLog, momWarn } from "../../agent/log.js";
import { SharedRuntimeCommandService, type SharedRuntimeCommandOptions } from "../../agent/channelCommands.js";
import { buildTextChannelContext, type ChannelResponseHandle, type ContextSentMessageRef } from "./contextBuilder.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import { ChannelQueue } from "./queue.js";
import type { PromptChannel } from "../../agent/prompt-channel.js";
import type { Channel } from "../../../shared/types/message.js";

interface BaseChannelRuntimeInit {
  channel: PromptChannel;
  defaultWorkspaceName: string;
  getSettings: () => RuntimeSettings;
  updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  sessionStore?: SessionStore;
  options?: {
    workspaceDir?: string;
    instanceId?: string;
    memory: MemoryGateway;
    usageTracker: AiUsageTracker;
    modelErrorTracker: ModelErrorTracker;
  };
}

export abstract class BaseChannelRuntime {
  private static readonly INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;

  protected readonly channelName: PromptChannel;
  protected readonly workspaceDir: string;
  protected readonly store: MomRuntimeStore;
  protected readonly sessions: SessionStore;
  protected readonly runners: RunnerPool;
  protected readonly memory: MemoryGateway;
  protected readonly instanceId: string;
  protected readonly acp: AcpService;
  protected readonly getSettings: () => RuntimeSettings;
  protected readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings;

  protected readonly chatQueues = new Map<string, ChannelQueue>();
  protected readonly running = new Set<string>();
  protected readonly inboundDedupe = new Map<string, number>();

  protected constructor(init: BaseChannelRuntimeInit) {
    const runtimeOptions = init.options;
    this.channelName = init.channel as PromptChannel;
    this.getSettings = init.getSettings;
    this.updateSettings = init.updateSettings;
    this.workspaceDir = runtimeOptions?.workspaceDir ?? resolve(config.dataDir, init.defaultWorkspaceName);
    this.instanceId = runtimeOptions?.instanceId ?? "default";
    this.store = new MomRuntimeStore(this.workspaceDir);
    this.sessions = init.sessionStore ?? new SessionStore();

    if (!runtimeOptions?.memory) {
      throw new Error(`${this.channelName} runtime requires MemoryGateway for unified memory operations.`);
    }
    this.memory = runtimeOptions.memory;
    this.runners = new RunnerPool(
      this.channelName,
      this.store,
      this.getSettings,
      this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
      runtimeOptions.usageTracker,
      runtimeOptions.modelErrorTracker,
      runtimeOptions.memory
    );
    this.acp = new AcpService(
      this.getSettings,
      this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
      { stateFilePath: join(this.workspaceDir, "acp_sessions.json") }
    );
  }

  protected markInboundMessageSeen(chatId: string, rawMessageId: string): boolean {
    const key = `${chatId}:${rawMessageId}`;
    const now = Date.now();
    const expiresAt = this.inboundDedupe.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    this.inboundDedupe.set(key, now + BaseChannelRuntime.INBOUND_DEDUPE_TTL_MS);

    if (this.inboundDedupe.size > 2048) {
      for (const [entryKey, entryExpiresAt] of this.inboundDedupe.entries()) {
        if (entryExpiresAt <= now) {
          this.inboundDedupe.delete(entryKey);
        }
      }
    }

    return true;
  }

  protected getQueue(scopeId: string): ChannelQueue {
    let queue = this.chatQueues.get(scopeId);
    if (!queue) {
      queue = new ChannelQueue(this.channelName);
      this.chatQueues.set(scopeId, queue);
      momLog(this.channelName, "queue_created", { chatId: scopeId });
    }
    return queue;
  }

  protected stopChatWork(scopeId: string): { aborted: boolean } {
    const activeSessionId = this.store.getActiveSession(scopeId);
    const aborted = this.runners.abort(scopeId, activeSessionId);
    if (!aborted) return { aborted: false };
    momLog(this.channelName, "stop_requested", { chatId: scopeId, sessionId: activeSessionId });
    return { aborted: true };
  }

  protected steerChatWork(scopeId: string, text: string): { queued: boolean } {
    const activeSessionId = this.store.getActiveSession(scopeId);
    const queued = this.runners.steer(scopeId, activeSessionId, text);
    if (queued) {
      momLog(this.channelName, "steer_requested", {
        chatId: scopeId,
        sessionId: activeSessionId,
        textLength: text.trim().length
      });
    }
    return { queued };
  }

  protected followUpChatWork(scopeId: string, text: string): { queued: boolean } {
    const activeSessionId = this.store.getActiveSession(scopeId);
    const queued = this.runners.followUp(scopeId, activeSessionId, text);
    if (queued) {
      momLog(this.channelName, "followup_requested", {
        chatId: scopeId,
        sessionId: activeSessionId,
        textLength: text.trim().length
      });
    }
    return { queued };
  }

  protected buildQueuedBusyNotice(queueId: number): string {
    return `Queued as #${queueId}. Send /steer ${queueId} to inject it into the current task.`;
  }

  protected async writePromptPreview(allowedChatIds: string[]): Promise<void> {
    const chatId = allowedChatIds[0] ?? "__preview__";
    const sessionId = allowedChatIds[0] ? this.store.getActiveSession(chatId) : "default";
    const memoryText = allowedChatIds[0]
      ? ((await this.memory.buildPromptContext(
          { channel: this.channelName, externalUserId: chatId },
          "",
          12
        )) || "(no working memory yet)")
      : "(no working memory yet)";
    const prompt = buildSystemPromptPreview(this.workspaceDir, chatId, sessionId, memoryText, {
      channel: this.channelName,
      settings: this.getSettings()
    });
    const channelSections = buildPromptChannelSections(this.channelName);
    const sources = getSystemPromptSources(this.workspaceDir, {
      channel: this.channelName,
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
      `- identity_sources: ${sources.identity.length > 0 ? sources.identity.join(", ") : "(none)"}`,
      `- project_context_sources: ${sources.projectContext.length > 0 ? sources.projectContext.join(", ") : "(none)"}`,
      "",
      "---",
      ""
    ].join("\n");

    writeFileSync(filePath, `${header}${prompt}\n`, "utf8");
    momLog(this.channelName, "system_prompt_preview_written", {
      botId: this.instanceId,
      workspaceDir: this.workspaceDir,
      filePath,
      chatId,
      sessionId,
      promptLength: prompt.length
    });
  }

  protected appendConversationMessage(
    channel: string,
    conversationKey: string,
    role: "user" | "assistant" | "system",
    text: string,
    warningCode: string,
    meta: Record<string, unknown>
  ): void {
    try {
      const conv = this.sessions.getOrCreateConversation(channel as Channel, conversationKey);
      this.sessions.appendMessage(conv.id, role, text);
    } catch (error) {
      momWarn(this.channelName, warningCode, {
        ...meta,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  protected createSharedCommandService<TTarget>(
    options: Omit<
      SharedRuntimeCommandOptions<TTarget>,
      "channel" | "instanceId" | "workspaceDir" | "store" | "runners" | "getSettings" | "updateSettings"
    >
  ): SharedRuntimeCommandService<TTarget> {
    return new SharedRuntimeCommandService<TTarget>({
      channel: this.channelName,
      instanceId: this.instanceId,
      workspaceDir: this.workspaceDir,
      store: this.store,
      runners: this.runners,
      getSettings: this.getSettings,
      updateSettings: this.updateSettings,
      ...options
    });
  }

  protected async runSharedTextTask<TSent extends ContextSentMessageRef>(
    scopeId: string,
    event: ChannelInboundMessage,
    options: {
      createBotMessageId: () => number;
      response: ChannelResponseHandle<TSent>;
      normalizeText?: (text: string) => string;
      replaceWithoutEdit?: Parameters<typeof buildTextChannelContext<TSent>>[0]["replaceWithoutEdit"];
      deleteWithoutHandle?: Parameters<typeof buildTextChannelContext<TSent>>[0]["deleteWithoutHandle"];
      uploadWithoutHandle?: Parameters<typeof buildTextChannelContext<TSent>>[0]["uploadWithoutHandle"];
      onSessionAppendWarning?: (error: unknown) => void;
      role?: "user" | "system";
    }
  ): Promise<void> {
    const activeSessionId = event.sessionId || this.store.getActiveSession(scopeId);
    this.running.add(scopeId);

    this.appendConversationMessage(
      this.channelName,
      `bot:${this.instanceId}:chat:${scopeId}:${activeSessionId}`,
      options.role ?? "user",
      event.text,
      "session_user_append_failed",
      { chatId: event.chatId, scopeId }
    );

    const runner = this.runners.get(scopeId, activeSessionId);
    const ctx = buildTextChannelContext({
      channel: this.channelName as Channel,
      event,
      workspaceDir: this.workspaceDir,
      chatDir: this.store.getChatDir(scopeId),
      store: this.store,
      sessions: this.sessions,
      instanceId: this.instanceId,
      activeSessionId,
      conversationKey: `bot:${this.instanceId}:chat:${scopeId}:${activeSessionId}`,
      response: options.response,
      createBotMessageId: options.createBotMessageId,
      normalizeText: options.normalizeText,
      replaceWithoutEdit: options.replaceWithoutEdit,
      deleteWithoutHandle: options.deleteWithoutHandle,
      uploadWithoutHandle: options.uploadWithoutHandle,
      onSessionAppendWarning: options.onSessionAppendWarning
    });

    try {
      await runner.run(ctx);
    } finally {
      this.running.delete(scopeId);
    }
  }
}
