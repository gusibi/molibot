import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import { buildPromptChannelSections } from "$lib/server/agent/prompts/prompt-channel.js";
import { executeHostBashApproval, rewriteApprovalToolResultInContext } from "$lib/server/agent/hostBashExec.js";
import { buildSystemPromptPreview, getSystemPromptSources } from "$lib/server/agent/prompts/prompt.js";
import { RunnerPool } from "$lib/server/agent/core/runnerPool.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { getEventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";
import { resolveEventSessionMode, resolveEventTargetSessionId, taskSessionRetentionMs, type MomEvent } from "$lib/server/agent/events.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { getWorkspaceStore } from "$lib/server/workspaces/store.js";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import { SharedRuntimeCommandService, type SharedRuntimeCommandOptions } from "$lib/server/agent/commands/channelCommands.js";
import { buildTextChannelContext, type ChannelResponseHandle, type ContextSentMessageRef } from "$lib/server/channels/shared/contextBuilder.js";
import type { ChannelInboundMessage, RunnerUiEvent } from "$lib/server/agent/core/types.js";
import {
  retryApprovalAutoResume,
  APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
  APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS
} from "$lib/server/channels/shared/approvalAutoResume.js";
import { ChannelQueue } from "$lib/server/channels/shared/queue.js";
import type { PromptChannel } from "$lib/server/agent/prompts/prompt-channel.js";
import type { Channel } from "$lib/shared/types/message.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { ProjectAwareRunnerPool } from "$lib/server/channels/shared/projectRunnerRouter.js";

import type { HookManager } from "$lib/server/agent/hooks/index.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

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
    hookManager: HookManager;
  };
}

export function appendDirectEventContextMessage(
  store: MomRuntimeStore,
  chatId: string,
  sessionId: string,
  text: string,
  timestamp = Date.now(),
  runId?: string
): void {
  store.appendContextMessage(chatId, {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp
  } as AgentMessage, sessionId, { runId });
}

export abstract class BaseChannelRuntime {
  private static readonly INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;

  protected readonly channelName: PromptChannel;
  protected readonly workspaceId: string;
  protected readonly workspaceDir: string;
  protected readonly store: MomRuntimeStore;
  protected readonly sessions: SessionStore;
  protected readonly runners: ProjectAwareRunnerPool;
  protected readonly memory: MemoryGateway;
  protected readonly hookManager: HookManager;
  protected readonly instanceId: string;
  protected readonly getSettings: () => RuntimeSettings;
  protected readonly updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings;

  protected readonly chatQueues = new Map<string, ChannelQueue>();
  protected readonly running = new Set<string>();
  protected readonly inboundDedupe = new Map<string, number>();

  protected constructor(init: BaseChannelRuntimeInit) {
    const runtimeOptions = init.options;
    this.channelName = init.channel as PromptChannel;
    this.workspaceId = getWorkspaceStore().ensureDefaultWorkspace().id;
    this.getSettings = init.getSettings;
    this.updateSettings = init.updateSettings;
    this.workspaceDir = runtimeOptions?.workspaceDir ?? resolve(config.dataDir, init.defaultWorkspaceName);
    this.instanceId = runtimeOptions?.instanceId ?? "default";
    this.store = new MomRuntimeStore(this.workspaceDir);
    this.sessions = init.sessionStore ?? new SessionStore();

    if (!runtimeOptions?.memory) {
      throw new Error(`${this.channelName} runtime requires MemoryGateway for unified memory operations.`);
    }
    if (!runtimeOptions?.hookManager) {
      throw new Error(`${this.channelName} runtime requires HookManager for runtime hook dispatch.`);
    }
    this.memory = runtimeOptions.memory;
    this.hookManager = runtimeOptions.hookManager;
    const botRunners = new RunnerPool(
      this.channelName,
      this.store,
      this.getSettings,
      this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
      runtimeOptions.usageTracker,
      runtimeOptions.modelErrorTracker,
      runtimeOptions.memory,
      runtimeOptions.hookManager
    );
    this.runners = new ProjectAwareRunnerPool(botRunners, {
      channel: this.channelName,
      instanceId: this.instanceId,
      sessions: this.sessions,
      botStore: this.store,
      getSettings: this.getSettings,
      updateSettings: this.updateSettings ?? ((patch) => ({ ...this.getSettings(), ...patch })),
      usageTracker: runtimeOptions.usageTracker,
      modelErrorTracker: runtimeOptions.modelErrorTracker,
      memory: runtimeOptions.memory,
      hookManager: runtimeOptions.hookManager
    });
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

  public stopTask(scopeId: string): { aborted: boolean; clearedStale?: boolean } {
    return this.stopChatWork(scopeId);
  }

  protected getEventLeaseScope(): string {
    return `${this.channelName}:${this.instanceId}`;
  }

  /**
   * Scheduled-event runs marked sessionMode=fresh reuse a task transcript
   * archive (legacy tasks without an id keep per-run Sessions); everything else
   * uses the chat's active Session.
   */
  protected resolveInboundSessionId(scopeId: string, event: ChannelInboundMessage): string {
    if (event.isEvent && event.sessionMode === "fresh") {
      const sessionId = this.store.beginTaskArchiveSession(
        scopeId,
        String((event as ChannelInboundMessage & { taskId?: string }).taskId ?? ""),
        taskSessionRetentionMs(this.getSettings().events?.taskSessionRetentionDays),
      );
      if (event.runId) {
        getEventExecutionLeaseStore().attachSessionByRunId(event.runId, sessionId);
      }
      momLog(this.channelName, "event_fresh_archive_resolved", { chatId: scopeId, sessionId, taskId: event.taskId });
      return sessionId;
    }
    const sessionId = resolveEventTargetSessionId(event, this.store.getActiveSession(scopeId));
    if (event.isEvent && event.runId) {
      getEventExecutionLeaseStore().attachSessionByRunId(event.runId, sessionId);
    }
    return sessionId;
  }

  /** Persist a direct text automation in the same Agent Context linked by its execution lease. */
  protected persistDirectEventMessage(event: MomEvent, runId?: string): string {
    const now = Date.now();
    const previousActiveSessionId = resolveEventSessionMode(event) === "fresh"
      ? this.store.getActiveSession(event.chatId)
      : undefined;
    const sessionId = this.resolveInboundSessionId(event.chatId, {
      chatId: event.chatId,
      chatType: "private",
      messageId: now,
      userId: "EVENT",
      userName: "EVENT",
      text: event.text,
      ts: (now / 1000).toFixed(6),
      attachments: [],
      imageContents: [],
      isEvent: true,
      taskId: event.taskId,
      sessionId: event.sessionId,
      sessionMode: resolveEventSessionMode(event),
      runId
    });
    appendDirectEventContextMessage(this.store, event.chatId, sessionId, event.text, now, runId);
    if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
      this.store.setActiveSession(event.chatId, previousActiveSessionId);
    }
    return sessionId;
  }

  public abortTaskRun(scopeId: string, reason = "Aborted by runtime."): { aborted: boolean; clearedStale?: boolean } {
    const activeSessionId = this.store.getActiveSession(scopeId);
    const aborted = this.runners.abort(scopeId, activeSessionId);
    if (aborted) {
      getTurnOrchestrator().abortRunningTurnsForSession(activeSessionId, reason);
      this.runners.reset(scopeId, activeSessionId);
      momLog(this.channelName, "abort_requested", { chatId: scopeId, sessionId: activeSessionId, reason });
      return { aborted: true };
    }

    const cleared = getTurnOrchestrator().abortRunningTurnsForSession(
      activeSessionId,
      reason
    );
    if (cleared > 0) {
      this.runners.reset(scopeId, activeSessionId);
      this.running.delete(scopeId);
      momWarn(this.channelName, "stale_turn_lock_cleared", { chatId: scopeId, sessionId: activeSessionId, cleared, reason });
      return { aborted: false, clearedStale: true };
    }

    return { aborted: false };
  }

  public snapshotRuns(): Array<{ chatId: string; sessionId: string }> {
    return this.runners.snapshotRunning();
  }

  public abortRun(chatId: string, sessionId: string, reason = "Stopped from Trace controls."): { aborted: boolean } {
    const aborted = this.runners.abort(chatId, sessionId);
    if (!aborted) return { aborted: false };
    getTurnOrchestrator().abortRunningTurnsForSession(sessionId, reason);
    this.runners.reset(chatId, sessionId);
    this.running.delete(chatId);
    momLog(this.channelName, "trace_stop_requested", { chatId, sessionId, reason });
    return { aborted: true };
  }

  protected stopChatWork(scopeId: string): { aborted: boolean; clearedStale?: boolean } {
    const activeSessionId = this.store.getActiveSession(scopeId);
    const stopped = this.abortTaskRun(scopeId, "Stopped stale running turn after active runner was unavailable.");
    const abortedLeases = getEventExecutionLeaseStore().markAbortedForChat(
      scopeId,
      "Stopped by user.",
      new Date(),
      this.getEventLeaseScope()
    );
    if (stopped.aborted) {
      this.running.delete(scopeId);
      momLog(this.channelName, "stop_requested", { chatId: scopeId, sessionId: activeSessionId, eventLeases: abortedLeases });
      return stopped;
    }

    if (stopped.clearedStale) {
      this.running.delete(scopeId);
      momWarn(this.channelName, "stale_turn_lock_cleared", { chatId: scopeId, sessionId: activeSessionId, eventLeases: abortedLeases });
      return stopped;
    }

    if (abortedLeases > 0) {
      this.runners.reset(scopeId, activeSessionId);
      this.running.delete(scopeId);
      momWarn(this.channelName, "event_lease_stopped", { chatId: scopeId, sessionId: activeSessionId, eventLeases: abortedLeases });
      return { aborted: false, clearedStale: true };
    }

    return { aborted: false };
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

  protected getApprovalAutoResumeRetryConfig(): { delayMs: number; maxAttempts: number } {
    return {
      delayMs: APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
      maxAttempts: APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS
    };
  }

  protected resumeApprovedHostBashTask<TSent extends ContextSentMessageRef>(
    scopeId: string,
    event: ChannelInboundMessage,
    options: {
      createBotMessageId: () => number;
      response: ChannelResponseHandle<TSent>;
      notifyRetryExhausted?: () => Promise<void>;
    }
  ): void {
    const retry = this.getApprovalAutoResumeRetryConfig();
    void retryApprovalAutoResume({
      run: () => this.runSharedTextTask(scopeId, event, {
        createBotMessageId: options.createBotMessageId,
        response: options.response
      }),
      maxAttempts: retry.maxAttempts,
      delayMs: retry.delayMs,
      onWarn: (warningCode, meta) => {
        if (warningCode === "approval_auto_resume_retrying" && meta.attempt !== 1 && meta.attempt % 60 !== 0) {
          return;
        }
        momWarn(this.channelName, warningCode, {
          chatId: scopeId,
          ...meta
        });
      },
      onRetryExhausted: options.notifyRetryExhausted
    });
  }

  protected buildQueuedBusyNotice(queueId: number): string {
    return `Queued as #${queueId}. Send /steer ${queueId} to inject it into the current task.`;
  }

  protected isScopeBusy(scopeId: string): boolean {
    return this.running.has(scopeId) || getEventExecutionLeaseStore().hasActiveForChat(scopeId, this.getEventLeaseScope());
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
    meta: Record<string, unknown>,
    origin?: "automation",
    platformMessageId?: string,
    projectTarget?: { projectId: string; conversationId: string }
  ): void {
    try {
      const conv = this.sessions.getOrCreateConversation(
        channel as Channel,
        conversationKey,
        projectTarget?.conversationId,
        origin || projectTarget ? { origin, projectId: projectTarget?.projectId } : undefined
      );
      this.sessions.appendMessage(conv.id, role, text, { platformMessageId });
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
      listProjects: () => getProjectStore().list(),
      getActiveProject: (scopeId) => getProjectStore().getChannelBinding(this.channelName, this.instanceId, scopeId),
      setActiveProject: (scopeId, projectId) => getProjectStore().setChannelBinding(this.channelName, this.instanceId, scopeId, projectId),
      executeApprovedHostBash: options.executeApprovedHostBash ?? (async (input, approved, request) => {
        if (!request.pendingAction) return;
        const executed = await executeHostBashApproval({
          record: request,
          approvedTool: approved,
          cwd: this.store.getScratchDir(input.scopeId)
        });

        try {
          const sessionId = request.sessionId || this.store.getActiveSession(input.scopeId);
          const contextRunId = String(request.pendingAction.runId ?? "").trim();
          const origin = this.store.readSessionOrigin(input.scopeId, sessionId);
          const messages = origin?.archiveMode === "shared" && contextRunId
            ? this.store.loadContextForRun(input.scopeId, sessionId, contextRunId)
            : this.store.loadContext(input.scopeId, sessionId);
          const rewritten = rewriteApprovalToolResultInContext(messages, request.command, executed.rendered);

          if (rewritten) {
            if (origin?.archiveMode === "shared" && contextRunId) {
              this.store.replaceContextForRun(input.scopeId, sessionId, contextRunId, messages);
            } else {
              this.store.saveContext(input.scopeId, messages, sessionId);
            }
            this.store.setActiveSession(input.scopeId, sessionId);
            this.runners.reset(input.scopeId, sessionId);

            const isEnglishChannel = this.channelName === "telegram" || this.channelName === "feishu";
            const event: ChannelInboundMessage = {
              chatId: input.chatId,
              chatType: "private",
              userId: "system",
              messageId: Date.now(),
              text: "",
              ts: (Date.now() / 1000).toFixed(6),
              attachments: [],
              imageContents: [],
              isEvent: true,
              sessionId,
              runId: contextRunId || undefined,
              contextRunId: contextRunId || undefined,
              restoreSessionId: origin?.returnSessionId
            };
            this.resumeApprovedHostBashTask(input.scopeId, event, {
              createBotMessageId: () => Math.floor(Math.random() * 1000000),
              response: {
                sendText: async (text) => {
                  await options.sendText(input.target, text);
                  return null;
                },
                respondInThread: async (text) => {
                  await options.sendText(input.target, text);
                }
              },
              notifyRetryExhausted: async () => {
                await options.sendText(
                  input.target,
                  isEnglishChannel
                    ? "Command executed, but the session is still busy. Send any message to continue the task."
                    : "命令已执行，但当前会话仍处于忙碌状态。发送任意消息可继续刚才的任务。"
                );
              }
            });
          }
        } catch (error) {
          momWarn(this.channelName, "auto_resume_rewrite_failed", {
            chatId: input.scopeId,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        return "Approved and executed immediately.";
      }),
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
      onRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
      onRunComplete?: (result: {
        runId?: string;
        stopReason: "stop" | "aborted" | "error" | "waiting_for_approval";
        errorMessage?: string;
      }, meta: {
        activeSessionId: string;
        threadEventCount: number;
      }) => Promise<void>;
      onSessionAppendWarning?: (error: unknown) => void;
      role?: "user" | "system";
    }
  ): Promise<void> {
    event.workspaceId = event.workspaceId || this.workspaceId;
    const previousActiveSessionId = event.isEvent && event.sessionMode === "fresh"
      ? this.store.getActiveSession(scopeId)
      : event.restoreSessionId;
    const activeSessionId = event.isEvent
      ? this.resolveInboundSessionId(scopeId, event)
      : event.sessionId || this.resolveInboundSessionId(scopeId, event);
    if (
      event.isEvent
      && event.sessionMode === "fresh"
      && previousActiveSessionId
      && previousActiveSessionId !== activeSessionId
    ) {
      this.store.setTaskArchiveReturnSession(scopeId, activeSessionId, previousActiveSessionId);
    }
    const restorePreviousActiveSession = (): void => {
      if (!previousActiveSessionId || previousActiveSessionId === activeSessionId) return;
      this.store.setActiveSession(scopeId, previousActiveSessionId);
      this.store.setTaskArchiveReturnSession(scopeId, activeSessionId);
    };

    // Prepare turn metadata via TurnOrchestrator
    try {
      getTurnOrchestrator().prepareTurn({
        chatId: scopeId,
        sessionId: activeSessionId,
        message: event
      });
    } catch (error) {
      restorePreviousActiveSession();
      throw error;
    }

    this.running.add(scopeId);

    const target = this.runners.resolveTarget(scopeId, activeSessionId);
    const selectedProject = target.project;

    this.appendConversationMessage(
      this.channelName,
      target.conversationKey,
      options.role ?? "user",
      event.text,
      "session_user_append_failed",
      { chatId: event.chatId, scopeId },
      event.isEvent ? "automation" : undefined,
      event.platformMessageId,
      selectedProject && target.conversationId
        ? { projectId: selectedProject.id, conversationId: target.conversationId }
        : undefined
    );

    const runner = target.pool.get(target.chatId, target.sessionId);
    let threadEventCount = 0;
    const ctx = buildTextChannelContext({
      channel: this.channelName as Channel,
      event,
      workspaceDir: this.workspaceDir,
      chatDir: target.store.getChatDir(target.chatId),
      store: this.store,
      sessions: this.sessions,
      instanceId: this.instanceId,
      activeSessionId,
      project: selectedProject ? {
        id: selectedProject.id,
        name: selectedProject.name,
        rootPath: selectedProject.rootPath,
        instructions: selectedProject.instructions,
        sandboxEnabled: selectedProject.sandboxEnabled,
        toolProgress: selectedProject.toolProgress,
        showReasoning: selectedProject.showReasoning,
        runLogNotice: selectedProject.runLogNotice,
        scratchDir: target.store.getScratchDir(target.chatId)
      } : undefined,
      modelKeyOverride: selectedProject?.modelKey,
      thinkingLevelOverride: selectedProject?.thinkingLevel,
      projectConversation: selectedProject && target.conversationId
        ? { projectId: selectedProject.id, conversationId: target.conversationId }
        : undefined,
      conversationKey: target.conversationKey,
      response: {
        ...options.response,
        respondInThread: options.response.respondInThread
          ? async (text) => {
            threadEventCount += 1;
            await options.response.respondInThread!(text);
          }
          : undefined
      },
      createBotMessageId: options.createBotMessageId,
      normalizeText: options.normalizeText,
      replaceWithoutEdit: options.replaceWithoutEdit,
      deleteWithoutHandle: options.deleteWithoutHandle,
      uploadWithoutHandle: options.uploadWithoutHandle,
      onRunnerEvent: options.onRunnerEvent,
      onSessionAppendWarning: options.onSessionAppendWarning
    });

    let runStopReason: "stop" | "aborted" | "error" | "waiting_for_approval" | undefined;
    try {
      const result = await runner.run(ctx);
      runStopReason = result.stopReason;
      await options.onRunComplete?.(result, { activeSessionId, threadEventCount });
    } finally {
      this.running.delete(scopeId);
      if (
        previousActiveSessionId
        && previousActiveSessionId !== activeSessionId
        && runStopReason !== "waiting_for_approval"
      ) {
        try {
          restorePreviousActiveSession();
        } catch (error) {
          momWarn(this.channelName, "event_active_session_restore_failed", {
            chatId: scopeId,
            sessionId: previousActiveSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }
}
