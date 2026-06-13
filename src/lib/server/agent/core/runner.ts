import { basename } from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple, type Model } from "@mariozechner/pi-ai";
import { type RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import { NOOP_HOOK_MANAGER, type HookContext, type HookManager } from "$lib/server/agent/hooks/index.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import { momError, momLog, momWarn } from "$lib/server/agent/common/log.js";
import { buildSystemPrompt } from "$lib/server/agent/prompts/prompt.js";
import { buildRunReflection, formatRunClosingNote, type RunSummary } from "$lib/server/agent/session/runSummary.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";
import { saveSkillDraft, shouldSuggestSkillDraft } from "$lib/server/agent/skills/skillDraft.js";
import { buildSkillDraftMetadataViaSubagent } from "$lib/server/agent/skills/skillDraftSubagent.js";
import { DEFAULT_RUN_BUDGET, RunBudget } from "$lib/server/agent/core/runtimeBudget.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { applyAssistantStreamEvent } from "$lib/server/agent/core/assistantStream.js";
import { buildPromptInputEnvelope } from "$lib/server/agent/prompts/promptInput.js";
import { createMomTools } from "$lib/server/agent/tools/index.js";
import { getMcpToolsForRuntime } from "$lib/server/agent/tools/mcp.js";
import { resolveEffectiveSandboxSettings } from "$lib/server/agent/tools/sandbox.js";
import { findExplicitlyInvokedSkills, loadSkillsFromWorkspace, type LoadedSkill } from "$lib/server/agent/skills/skills.js";
import { pathCompareKey, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { compactContextMessages, shouldCompactContext } from "$lib/server/agent/session/compaction.js";
import { isRetryableModelError, resolvePromptAttemptDecision, shouldEmitFinalRunnerError } from "$lib/server/agent/core/runnerRetryState.js";
import { formatSubagentProgressLabel } from "$lib/server/agent/subagentProgress.js";
import type { MomContext, RunResult, RunnerLike, ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { resolvePlannedBashDisplayName, resolveToolDisplayName } from "$lib/server/agent/tools/toolDisplay.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { resolveThinkingLevel } from "$lib/server/providers/customThinking.js";
import {
  DEFAULT_AGENT_MAX_RETRY_DELAY_MS,
  resolvePreferredTransport
} from "$lib/server/agent/core/runtimeOptions.js";
import {
  getPreferredToolExecutionMode,
  validateToolCallPreflight
} from "$lib/server/agent/tools/toolPolicy.js";
import {
  SUBAGENT_DELEGATION_RUNTIME_NOTICE,
  stripTransientRuntimeNoticesFromMessages,
  TOOL_BUDGET_RUNTIME_NOTICE
} from "$lib/server/agent/core/runtimeNotices.js";
import { getHostBashStore, type HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import {
  type ResolvedModelSelection,
  resolveModelSelection,
  resolveModel,
  buildModelFallbackSelections,
  toModelAttemptFailure,
  formatModelAttemptFailure,
  recordModelFailure,
  redactBaseUrl,
  resolveApiKeyForModel,
  keyFingerprint,
  buildAgentSessionId,
  sameModelSelection,
  getCustomProviderById,
  type ModelAttemptFailure,
  getCustomModelRoles
} from "$lib/server/agent/routing/modelRouting.js";
import { hasConfiguredAuth, resolveProviderApiKey } from "$lib/server/agent/identity/auth.js";
import {
  buildAnthropicBaseUrl,
  buildOpenAIBaseUrl,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol.js";
import { stripImagePartsForTextOnlyModel } from "$lib/server/agent/routing/mediaFallback.js";

// Imported helpers from extracted runnerHelpers.ts and runnerInputEnricher.ts
import {
  rewritePromptUserMessage,
  getMessageText,
  rewritePromptUserMessageForPersistence,
  createPersistedUserMessage,
  createAssistantErrorMessage,
  prepareMessagesForModelContext,
  formatPayloadReasoningSummary,
  removeOrphanToolResultsFromContext,
  hasExplicitMcpInvocation,
  injectExplicitSkillInvocationContext,
  injectExplicitSkillFileContext,
  buildPromptRefreshKey,
  validateRuntimeSettings,
  isContextOverflowError,
  extractTextFromResult,
  extractHostBashApprovalPrompt,
  mapUnsupportedDeveloperRole,
  moveAnthropicSystemMessagesToTopLevel
} from "$lib/server/agent/core/runnerHelpers.js";

import { prepareEnrichedInput } from "$lib/server/agent/core/runnerInputEnricher.js";

const TOOL_BUDGET_EXHAUSTED_CODE = "RUN_TOOL_BUDGET_EXHAUSTED";
const SUBAGENT_DELEGATION_NOTICE_TOOL_CALLS = 12;

type ToolCallTrackingContext = {
  toolCall: { id: string; name: string };
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

type LoadedSkillState = {
  skill: LoadedSkill;
  loadedSeq: number;
};

type PendingToolSignalContext = {
  toolName: string;
  command?: string;
};

export class MomRunner implements RunnerLike {
  private readonly agent: Agent;
  private running = false;
  private abortRequested = false;
  private selectedMcpServerIds = new Set<string>();
  private promptRefreshKey = "";
  private systemPromptReady = false;
  private activeRunnerEventSink: NonNullable<MomContext["onRunnerEvent"]> | undefined;
  private activeRunBudget: RunBudget | undefined;
  private activePayloadContext:
    | {
        provider: string;
        model: string;
        api: string;
        requestedThinkingLevel: RuntimeSettings["defaultThinkingLevel"];
        effectiveThinkingLevel: RuntimeSettings["defaultThinkingLevel"];
      }
    | undefined;

  private getEffectiveSandboxEnabled(): boolean {
    const botId = basename(this.store.getWorkspaceDir()) || "unknown";
    return resolveEffectiveSandboxSettings({
      getSettings: this.getSettings,
      chatId: this.chatId,
      sessionId: this.sessionId,
      store: this.store,
      channel: this.channel,
      botId
    }).enabled;
  }

  private activeHookContext: HookContext | undefined;
  private activeModelPromptContext:
    | {
        candidateIndex: number;
        attemptIndex: number;
      }
    | undefined;
  private activeModelCallContext:
    | {
        modelAttemptId: string;
        candidateIndex: number;
        attemptIndex: number;
        modelCallSeq: number;
      }
    | undefined;
  private modelCallSeq = 0;
  private activeRunSkillManifest = new Map<string, LoadedSkill>();
  private readonly pendingReadPaths = new Map<string, string>();
  private readonly activeRunLoadedSkills = new Map<string, LoadedSkillState>();
  private readonly pendingToolSignals = new Map<string, PendingToolSignalContext>();
  private activeSkillLoadSeq = 0;

  private readonly hookManager: HookManager;

  constructor(
    private readonly channel: string,
    private readonly chatId: string,
    private readonly sessionId: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly modelErrorTracker: ModelErrorTracker,
    private readonly memory: MemoryGateway,
    hookManager?: HookManager,
  ) {
    this.hookManager = hookManager ?? NOOP_HOOK_MANAGER;
    const settings = this.getSettings();
    const model = resolveModel(settings, "text");
    const initialPrompt = buildSystemPrompt(
      this.store.getWorkspaceDir(),
      this.chatId,
      this.sessionId,
      "(memory will be loaded via gateway before each run)",
      {
        channel: this.channel as "telegram" | "feishu" | "qq" | "weixin" | "web",
        timezone: settings.timezone,
        settings
      },
    );

    this.agent = new Agent({
      initialState: {
        systemPrompt: initialPrompt,
        model,
        thinkingLevel: resolveThinkingLevel(settings, model.reasoning),
        tools: [],
      },
      sessionId: buildAgentSessionId(this.channel, this.chatId, this.sessionId, "text", resolveModelSelection(settings, "text")),
      transport: resolvePreferredTransport(model),
      maxRetryDelayMs: DEFAULT_AGENT_MAX_RETRY_DELAY_MS,
      toolExecution: getPreferredToolExecutionMode(),
      onPayload: async (payload) => {
        if (this.activeRunnerEventSink && this.activePayloadContext) {
          await this.activeRunnerEventSink({
            type: "payload",
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            requestedThinkingLevel: this.activePayloadContext.requestedThinkingLevel,
            effectiveThinkingLevel: this.activePayloadContext.effectiveThinkingLevel,
            summary: formatPayloadReasoningSummary(payload)
          });
        }
        const modelCallContext = this.startActiveModelCallTrace();
        if (this.activeHookContext && this.activePayloadContext && modelCallContext) {
          this.hookManager.emit("model.call.before", this.activeHookContext, {
            ...modelCallContext,
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            requestedThinkingLevel: this.activePayloadContext.requestedThinkingLevel,
            effectiveThinkingLevel: this.activePayloadContext.effectiveThinkingLevel
          });
        }
        return undefined;
      },
      onResponse: async (response) => {
        this.emitActiveModelCallAfter((response as any)?.usage, (response as any)?.stopReason);
        return undefined;
      },
      beforeToolCall: async (context, _signal) => {
        const hookContext = this.activeHookContext;
        const args = context.args as { command?: unknown; label?: string };
        const displayName = context.toolCall.name === "bash"
          ? resolvePlannedBashDisplayName({
              command: args.command,
              hostBashStore: getHostBashStore(),
              sandboxAttempted: this.getEffectiveSandboxEnabled()
            })
          : resolveToolDisplayName(context.toolCall.name);
        const rawLabel = args.label || context.toolCall.name;
        const label = displayName !== context.toolCall.name
          ? rawLabel && rawLabel !== context.toolCall.name
            ? `${displayName}: ${rawLabel}`
            : displayName
          : rawLabel;
        if (hookContext) {
          const decision = await this.hookManager.gate("tool.call.before", hookContext, {
            toolName: context.toolCall.name,
            toolCallId: context.toolCall.id,
            displayName,
            label,
            argsPreview: JSON.stringify(context.args ?? {}).slice(0, 500)
          });
          if (decision.type === "deny") {
            this.hookManager.emit("tool.call.blocked", hookContext, {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              displayName,
              label,
              blockedBy: "hook_gate",
              reason: decision.reason
            });
            return { block: true, reason: decision.reason };
          }
        }

        const blockedReason = validateToolCallPreflight(context, {
          cwd: this.store.getScratchDir(this.chatId),
          workspaceDir: this.store.getWorkspaceDir()
        });
        const budgetResult = this.activeRunBudget?.tryStartTool() ?? { ok: true };
        const finalBlockedReason = blockedReason ?? budgetResult.reason;
        if (finalBlockedReason) {
          if (!budgetResult.ok) {
            this.agent.state.tools = [];
          }
          if (hookContext) {
            this.hookManager.emit("tool.call.blocked", hookContext, {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              displayName,
              label,
              blockedBy: blockedReason ? "preflight" : "budget",
              reason: finalBlockedReason
            });
          }
          return { block: true, reason: finalBlockedReason };
        }
        this.cacheResolvedReadPath(context);
        this.cacheToolSignalContext(context);
        if (hookContext) {
          this.hookManager.emit("tool.call.before", hookContext, {
            toolName: context.toolCall.name,
            toolCallId: context.toolCall.id,
            displayName,
            label,
            argsPreview: JSON.stringify(context.args ?? {}).slice(0, 500)
          });
        }
        return undefined;
      },
      afterToolCall: async (context) => {
        const displayName = resolveToolDisplayName(context.toolCall.name, {
          result: context.result,
          sandboxAttempted: this.getEffectiveSandboxEnabled()
        });
        if (this.activeHookContext) {
          this.hookManager.emit(
            context.isError ? "tool.call.error" : "tool.call.after",
            this.activeHookContext,
            {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              displayName,
              isError: context.isError,
              resultPreview: extractTextFromResult(context.result).slice(0, 1000)
            }
          );
        }
        this.emitSkillLoadedForReadTool(context);
        this.emitSkillSearchMatches(context);
        this.emitSkillExecutedForToolSignals(context);
        return undefined;
      },
      streamFn: (selectedModel, context, opts) => {
        const settingsNow = this.getSettings();
        const rolePatchedContext = selectedModel.api === "anthropic-messages"
          ? moveAnthropicSystemMessagesToTopLevel(context)
          : mapUnsupportedDeveloperRole(
              settingsNow,
              context,
            );
        const contextWithoutOrphanTools = removeOrphanToolResultsFromContext(
          rolePatchedContext,
        );
        const patchedContext = stripImagePartsForTextOnlyModel(
          selectedModel as Model<any>,
          contextWithoutOrphanTools,
        );
        momLog("runner", "llm_stream_start", {
          chatId: this.chatId,
          provider: selectedModel.provider,
          api: selectedModel.api,
          modelId: selectedModel.id,
          baseUrl: redactBaseUrl(selectedModel.baseUrl),
          messageCount: patchedContext.messages.length,
          hasSystemPrompt: Boolean(patchedContext.systemPrompt),
          hasTools:
            Array.isArray(patchedContext.tools) &&
            patchedContext.tools.length > 0,
        });
        momLog("runner", "llm_request_sent", {
          chatId: this.chatId,
          modelId: selectedModel.id,
          provider: selectedModel.provider
        });
        return streamSimple(
          selectedModel as any,
          patchedContext as any,
          opts as any,
        );
      },
      getApiKey: async (provider: string) => {
        const settingsNow = this.getSettings();
        const selectedCustom = settingsNow.customProviders.find((p) => p.id === provider);
        const key = await resolveProviderApiKey(provider, () => selectedCustom?.apiKey?.trim() || undefined);
        momLog("runner", "api_key_resolve", {
          chatId: this.chatId,
          provider,
          providerMode: settingsNow.providerMode,
          hasKey: Boolean(key),
          keyFingerprint: keyFingerprint(key),
          customProviderId: selectedCustom?.id
        });
        return key;
      },
    });

    const saved = this.store.loadContext(this.chatId, this.sessionId);
    if (saved.length > 0) {
      this.agent.state.messages = prepareMessagesForModelContext(saved);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.abortRequested = true;
    this.agent.clearAllQueues();
    momLog("runner", "abort_requested", {
      chatId: this.chatId,
      sessionId: this.sessionId
    });
    this.agent.abort();
  }

  steer(text: string): boolean {
    return this.enqueueLiveMessage("steer", text);
  }

  followUp(text: string): boolean {
    return this.enqueueLiveMessage("follow_up", text);
  }

  private enqueueLiveMessage(mode: "steer" | "follow_up", text: string): boolean {
    const normalized = text.trim();
    if (!normalized || !this.running) return false;

    const message: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: normalized }],
      timestamp: Date.now()
    };

    if (mode === "steer") {
      this.agent.steer(message);
    } else {
      this.agent.followUp(message);
    }

    momLog("runner", "live_message_queued", {
      chatId: this.chatId,
      sessionId: this.sessionId,
      mode,
      textLength: normalized.length
    });
    return true;
  }

  async compact(options?: {
    reason?: "threshold" | "manual";
    customInstructions?: string;
    notify?: (text: string) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
  }> {
    if (!this.running) {
      const saved = this.store.loadContext(this.chatId, this.sessionId);
      if (saved.length > 0) {
        this.agent.state.messages = prepareMessagesForModelContext(saved);
      }
    }

    const result = await getTurnOrchestrator().compactSessionContext({
      channel: this.channel,
      chatId: this.chatId,
      sessionId: this.sessionId,
      currentMessages: [...(this.agent.state.messages as AgentMessage[])],
      store: this.store,
      settings: this.getSettings(),
      options
    });

    if (result.changed) {
      this.agent.state.messages = result.messages;
    }

    return {
      changed: result.changed,
      summary: result.summary,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summarizedMessages: result.summarizedMessages,
      keptMessages: result.keptMessages
    };
  }

  async run(ctx: MomContext): Promise<RunResult> {
    const messageWithRun = ctx.message as ChannelInboundMessage & { runId?: string };
    let runId = messageWithRun.runId;
    let workspaceId = messageWithRun.workspaceId;
    let runStartedAt = Date.now();

    if (!runId || !workspaceId) {
      const turn = getTurnOrchestrator().prepareTurn({
        chatId: this.chatId,
        sessionId: this.sessionId,
        message: ctx.message
      });
      runId = turn.runId;
      workspaceId = turn.workspaceId;
      runStartedAt = turn.startedAt;
    }

    const botId = basename(this.store.getWorkspaceDir()) || "unknown";
    this.modelCallSeq = 0;
    this.activeHookContext = {
      runId,
      channel: ctx.channel,
      botId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      workspaceId,
      actorId: ctx.message.userId,
      signal: undefined
    };
    this.hookManager.emit("run.beforeStart", this.activeHookContext, {
      messageId: ctx.message.messageId,
      textLength: ctx.message.text.length,
      attachmentCount: ctx.message.attachments.length,
      imageCount: ctx.message.imageContents.length,
      isEvent: Boolean(ctx.message.isEvent)
    });
    let stopReason: "stop" | "aborted" | "error" | "waiting_for_approval" = "stop";
    let errorMessage: string | undefined;
    let hookRunFinished = false;
    const finishHookRun = async (): Promise<void> => {
      const hookContext = this.activeHookContext;
      if (!hookContext) return;
      if (!hookRunFinished) {
        hookRunFinished = true;
        this.hookManager.emit("run.finished", hookContext, {
          status: stopReason === "stop" ? "success" : stopReason,
          stopReason,
          durationMs: Date.now() - runStartedAt,
          errorMessage
        });
      }
      await this.hookManager.flush({ timeoutMs: 2000, runId: hookContext.runId });
    };

    const logRunDetail = (entry: Omit<RunDetailEntry, "timestamp" | "workspaceId">): void => {
      this.store.appendRunDetail(this.chatId, runId, {
        timestamp: new Date().toISOString(),
        ...entry,
        workspaceId
      });
    };
    const respondInThread = async (text: string): Promise<void> => {
      const normalized = String(text ?? "").trim();
      if (!normalized) return;
      logRunDetail({ type: "info", summary: normalized });
      await ctx.respondInThread(normalized);
    };
    let mainAnswerCommitted = false;
    const commitMainAnswer = async (text: string): Promise<void> => {
      const normalized = String(text ?? "").trim();
      if (!normalized) return;
      if (ctx.commitMainAnswer) {
        await ctx.commitMainAnswer(normalized);
      } else {
        await ctx.replaceMessage(normalized);
      }
      mainAnswerCommitted = true;
    };
    const sendSupplement = async (text: string): Promise<void> => {
      const normalized = String(text ?? "").trim();
      if (!normalized) return;
      if (ctx.sendSupplement) {
        await ctx.sendSupplement(normalized);
        return;
      }
      await respondInThread(normalized);
    };
    const budget = new RunBudget(this.getSettings().budget ?? DEFAULT_RUN_BUDGET);
    const usedToolNames: string[] = [];
    const failedToolNames: string[] = [];
    let subagentDelegationNoticeSent = false;
    const subagentTaskRecords: NonNullable<RunSummary["subagent"]>["tasks"] = [];
    const subagentTaskStartTimes = new Map<string, number>();
    let subagentInvoked = false;
    const buildSubagentSummary = (): RunSummary["subagent"] =>
      subagentDelegationNoticeSent || subagentInvoked
        ? {
          delegationNoticeSent: subagentDelegationNoticeSent,
          invoked: subagentInvoked,
          taskCount: subagentTaskRecords.length,
          tasks: subagentTaskRecords
        }
        : undefined;
    this.running = true;
    this.abortRequested = false;
    this.activeRunnerEventSink = ctx.onRunnerEvent;
    this.activePayloadContext = undefined;
    logRunDetail({
      type: "run_start",
      summary: `Run started for session ${this.sessionId}.`
    });

    const queue: Array<() => Promise<void>> = [];
    let queueRunning = false;
    const enqueue = (job: () => Promise<void>): void => {
      queue.push(job);
      if (!queueRunning) {
        void runQueue();
      }
    };

    const runQueue = async (): Promise<void> => {
      queueRunning = true;
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        try {
          await job();
        } catch {
          // ignore UI update errors
        }
      }
      queueRunning = false;
    };

    const settings = this.getSettings();
    const settingsError = validateRuntimeSettings(settings);
    if (settingsError) {
      stopReason = "error";
      errorMessage = settingsError;
      momWarn("runner", "settings_error", {
        runId,
        chatId: this.chatId,
        settingsError,
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(settingsError);
      logRunDetail({ type: "final", summary: settingsError, isError: true });
      getTurnOrchestrator().updateRunStatus(runId, "failed", settingsError);
      await finishHookRun();
      return { runId, stopReason: "error", errorMessage: settingsError };
    }

    if (this.activeHookContext) {
      this.hookManager.emit("input.enrich.before", this.activeHookContext, {
        textLength: ctx.message.text.length,
        attachmentCount: ctx.message.attachments.length,
        imageCount: ctx.message.imageContents.length,
        hasInlineAudioTranscript: Boolean(ctx.message.hasInlineAudioTranscript)
      });
    }
    let { enrichedText, activeSelection, modelCandidates, modelUseCase, audioDecision, visionDecision } = await prepareEnrichedInput({
      ctx,
      settings,
      respondInThread,
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId
    });
    if (this.activeHookContext) {
      const transformed = await this.hookManager.transform("input.enrich.after", this.activeHookContext, {
        text: enrichedText,
        textLength: enrichedText.length,
        modelUseCase,
        audioRoutingMode: audioDecision.mode,
        audioRoutingReason: audioDecision.reason,
        visionRoutingMode: visionDecision.mode,
        visionRoutingReason: visionDecision.reason,
        modelCandidateCount: modelCandidates.length
      });
      if (typeof transformed.text === "string" && transformed.text !== enrichedText) {
        enrichedText = transformed.text;
      }
      this.hookManager.emit("input.enrich.after", this.activeHookContext, {
        textLength: enrichedText.length,
        modelUseCase,
        audioRoutingMode: audioDecision.mode,
        audioRoutingReason: audioDecision.reason,
        visionRoutingMode: visionDecision.mode,
        visionRoutingReason: visionDecision.reason,
        modelCandidateCount: modelCandidates.length
      });
    }

    const memorySnapshot = await getTurnOrchestrator().prepareTurnMemory(
      this.channel,
      this.chatId,
      enrichedText,
      this.memory
    );
    const nextPromptKey = buildPromptRefreshKey(settings, this.channel, this.store.getWorkspaceDir());
    const runPromptKey = JSON.stringify({
      base: nextPromptKey,
      memory: memorySnapshot.fingerprint,
      query: memorySnapshot.query
    });
    if (!this.systemPromptReady || this.promptRefreshKey !== runPromptKey) {
      const memoryText = memorySnapshot.promptText || "(no working memory yet)";
      let systemPrompt = buildSystemPrompt(
        this.store.getWorkspaceDir(),
        this.chatId,
        this.sessionId,
        memoryText,
        {
          channel: this.channel as "telegram" | "feishu" | "qq" | "weixin" | "web",
          timezone: settings.timezone,
          settings
        },
      );
      if (this.activeHookContext) {
        // Transform hooks run only when the prompt is (re)built; the result is
        // then cached under promptRefreshKey like the untransformed prompt.
        const transformed = await this.hookManager.transform("prompt.build.after", this.activeHookContext, {
          systemPrompt
        });
        if (typeof transformed.systemPrompt === "string" && transformed.systemPrompt.trim()) {
          systemPrompt = transformed.systemPrompt;
        }
      }
      this.agent.state.systemPrompt = systemPrompt;
      this.promptRefreshKey = runPromptKey;
      this.systemPromptReady = true;
      momLog("runner", "system_prompt_refreshed", {
        runId,
        chatId: this.chatId,
        sessionId: this.sessionId
      });
    } else {
      momLog("runner", "system_prompt_reused", {
        runId,
        chatId: this.chatId,
        sessionId: this.sessionId
      });
    }

    const { skills } = loadSkillsFromWorkspace(this.store.getWorkspaceDir(), this.chatId, {
      disabledSkillPaths: settings.disabledSkillPaths,
      workspaceId
    });
    this.activeRunSkillManifest = new Map(
      skills.map((skill) => [pathCompareKey(skill.filePath), skill])
    );
    const explicitlyInvokedSkills = findExplicitlyInvokedSkills(skills, enrichedText);
    this.emitSkillSelection(explicitlyInvokedSkills);
    const skillExplicitlyInvoked = explicitlyInvokedSkills.length > 0;
    const mcpExplicitlyInvoked = hasExplicitMcpInvocation(enrichedText);
    const skillRequiresMcp = explicitlyInvokedSkills.some((skill) => skill.mcpServers.length > 0);
    const effectiveInputText = injectExplicitSkillFileContext(
      injectExplicitSkillInvocationContext(enrichedText, explicitlyInvokedSkills),
      explicitlyInvokedSkills
    );
    if (this.activeHookContext) {
      for (const skill of explicitlyInvokedSkills) {
        this.markSkillLoaded(skill);
        this.hookManager.emit("skill.loaded", this.activeHookContext, {
          name: skill.name,
          scope: skill.scope,
          filePath: skill.filePath,
          reason: "explicit_invocation"
        });
      }
    }
    const resolveScopedMcpServers = (): RuntimeSettings["mcpServers"] => {
      const settingsNow = this.getSettings();
      const selectedIds = this.selectedMcpServerIds;
      if (selectedIds.size > 0) {
        return (settingsNow.mcpServers ?? []).filter((server) =>
          server.enabled && selectedIds.has(server.id)
        );
      }
      return [];
    };

    let localTools: ReturnType<typeof createMomTools> = [];
    let loadedMcpTools: Awaited<ReturnType<typeof getMcpToolsForRuntime>> = [];
    const refreshLoadedMcpTools = async (): Promise<{ serverCount: number; toolCount: number }> => {
      const scoped = resolveScopedMcpServers();
      const mcpTools = await getMcpToolsForRuntime(scoped, {
        workspaceDir: this.store.getWorkspaceDir(),
        onWarn: (event, extra) => {
          momWarn("runner", event, {
            runId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            ...extra
          });
        }
      });
      const wrapHelper = (localTools as any).wrapTool;
      const wrappedMcpTools = wrapHelper
        ? mcpTools.map((t) => wrapHelper(t))
        : mcpTools;
      loadedMcpTools = wrappedMcpTools;
      this.agent.state.tools = [...localTools, ...wrappedMcpTools];
      return {
        serverCount: scoped.length,
        toolCount: mcpTools.length
      };
    };

    const exposeLoadMcpTool =
      mcpExplicitlyInvoked || skillRequiresMcp || this.selectedMcpServerIds.size > 0;
    let currentModelPromptMessage = "";
    let currentPersistedPromptMessage = "";
    let promptUserPersisted = false;
    let assistantMessagePersisted = false;
    const emittedHostBashApprovalIds = new Set<string>();
    const shouldForwardHostBashApproval = (approval: HostBashApprovalPrompt | undefined): boolean => {
      if (!approval) return true;
      if (emittedHostBashApprovalIds.has(approval.requestId)) return false;
      emittedHostBashApprovalIds.add(approval.requestId);
      return true;
    };
    localTools = createMomTools({
      channel: ctx.channel,
      cwd: this.store.getScratchDir(this.chatId),
      workspaceDir: this.store.getWorkspaceDir(),
      chatId: this.chatId,
      sessionId: this.sessionId,
      runId,
      workspaceId,
      timezone: settings.timezone,
      messageTimestamp: ctx.message.ts,
      store: this.store,
      memory: this.memory,
      getSettings: this.getSettings,
      updateSettings: this.updateSettings,
      getSelectedMcpServerIds: () => new Set(this.selectedMcpServerIds),
      setSelectedMcpServerIds: (next) => {
        this.selectedMcpServerIds = new Set(next);
      },
      refreshLoadedMcpTools,
      onLocalToolsChanged: (nextTools) => {
        localTools = nextTools;
        this.agent.state.tools = [...localTools, ...loadedMcpTools];
      },
      exposeLoadMcpTool,
      uploadFile: async (filePath, title, text) => {
        await ctx.uploadFile(filePath, title, text);
      },
      emitRunnerEvent: async (event) => {
        if (event.type === "tool_execution_end" && event.hostBashApproval) {
          if (!shouldForwardHostBashApproval(event.hostBashApproval)) return;
          if (this.activeHookContext) {
            this.hookManager.emit("approval.requested", this.activeHookContext, {
              requestId: event.hostBashApproval.requestId,
              displayName: event.hostBashApproval.request.displayName,
              toolId: event.hostBashApproval.request.toolId,
              command: event.hostBashApproval.request.command,
              reason: event.hostBashApproval.request.reason,
              approvalMode: event.hostBashApproval.request.approvalMode
            });
          }
        }
        if (event.type === "subagent_execution") {
          subagentInvoked = true;
          const taskKey = `${event.taskIndex ?? 0}:${event.agent ?? ""}`;
          if (event.phase === "task_start") {
            subagentTaskStartTimes.set(taskKey, Date.now());
          } else if (event.phase === "task_end") {
            const startedAt = subagentTaskStartTimes.get(taskKey);
            subagentTaskStartTimes.delete(taskKey);
            subagentTaskRecords.push({
              mode: event.mode,
              agent: event.agent,
              taskIndex: event.taskIndex,
              taskCount: event.taskCount,
              taskPreview: String(event.task ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || undefined,
              stopReason: event.stopReason,
              errorMessage: event.errorMessage,
              durationMs: startedAt ? Date.now() - startedAt : undefined
            });
          }
        }
        if (event.type === "subagent_execution" && this.activeHookContext) {
          if (event.phase === "task_start") {
            this.hookManager.emit("subagent.task.before", this.activeHookContext, {
              mode: event.mode,
              agent: event.agent,
              task: event.task,
              taskIndex: event.taskIndex,
              taskCount: event.taskCount
            });
          } else if (event.phase === "task_end") {
            this.hookManager.emit("subagent.task.after", this.activeHookContext, {
              mode: event.mode,
              agent: event.agent,
              task: event.task,
              taskIndex: event.taskIndex,
              taskCount: event.taskCount,
              stopReason: event.stopReason,
              errorMessage: event.errorMessage
            });
          }
        }
        const sink = this.activeRunnerEventSink;
        if (sink) {
          enqueue(() => sink(event));
        }
        if (event.type === "tool_execution_end" && event.hostBashApproval) {
          return;
        }
        if (event.type === "subagent_execution") {
          enqueue(() => ctx.respond(`_→ ${formatSubagentProgressLabel(event)}_`, false));
        }
      },
    });
    const scopedMcpServers = resolveScopedMcpServers();

    const mcpTools = await getMcpToolsForRuntime(scopedMcpServers, {
      workspaceDir: this.store.getWorkspaceDir(),
      onWarn: (event, extra) => {
        momWarn("runner", event, {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          ...extra
        });
      }
    });
    const wrapHelper = (localTools as any).wrapTool;
    const wrappedMcpTools = wrapHelper
      ? mcpTools.map((t) => wrapHelper(t))
      : mcpTools;
    loadedMcpTools = wrappedMcpTools;
    momLog("runner", "mcp_tools_loaded", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      skillExplicitlyInvoked,
      mcpExplicitlyInvoked,
      skillRequiresMcp,
      exposeLoadMcpTool,
      mcpServerCount: scopedMcpServers.filter((server) => server.enabled).length,
      mcpToolCount: mcpTools.length
    });
    this.agent.state.tools = [...localTools, ...wrappedMcpTools];

    let finalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    };
    let assistantTextStreamed = false;
    let streamedAssistantText = "";
    let firstAssistantTokenLogged = false;
    let promptStartedAt = 0;
     const unsubscribeHooks = this.agent.subscribe(async (event: AgentEvent) => {
      const hookContext = this.activeHookContext;
      if (!hookContext) return;
      if (event.type === "agent_start") {
        this.hookManager.emit("run.started", hookContext, {
          messageId: ctx.message.messageId,
          textLength: ctx.message.text.length,
          attachmentCount: ctx.message.attachments.length,
          imageCount: ctx.message.imageContents.length,
          isEvent: Boolean(ctx.message.isEvent)
        });
        return;
      }
      if (event.type === "agent_end") {
        await finishHookRun();
      }
    });

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (
        event.type === "message_start" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const next = applyAssistantStreamEvent(
          { assistantTextStreamed, streamedAssistantText },
          { type: "message_start", role: (event.message as { role?: string }).role }
        );
        assistantTextStreamed = next.assistantTextStreamed;
        streamedAssistantText = next.streamedAssistantText;
      }

      if (event.type === "message_update") {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
          const next = applyAssistantStreamEvent(
            { assistantTextStreamed, streamedAssistantText },
            { type: "text_delta", delta: assistantEvent.delta }
          );
          assistantTextStreamed = next.assistantTextStreamed;
          streamedAssistantText = next.streamedAssistantText;
          if (!firstAssistantTokenLogged) {
            firstAssistantTokenLogged = true;
            momLog("runner", "llm_first_token", {
              runId,
              chatId: this.chatId,
              modelId: activeSelection.model.id,
              latency: promptStartedAt > 0 ? Date.now() - promptStartedAt : undefined
            });
          }
        }
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "assistant_message_event",
            event: assistantEvent
          }));
        }
      }

      if (event.type === "tool_execution_start") {
        const args = event.args as { command?: unknown; label?: string };
        const displayName = event.toolName === "bash"
          ? resolvePlannedBashDisplayName({
              command: args.command,
              hostBashStore: getHostBashStore(),
              sandboxAttempted: this.getEffectiveSandboxEnabled()
            })
          : resolveToolDisplayName(event.toolName);
        const rawLabel = args.label || event.toolName;
        const label = displayName !== event.toolName
          ? rawLabel && rawLabel !== event.toolName
            ? `${displayName}: ${rawLabel}`
            : displayName
          : rawLabel;
        usedToolNames.push(event.toolName);
        logRunDetail({
          type: "tool_start",
          toolName: event.toolName,
          displayName,
          summary: label
        });
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "tool_execution_start",
            toolName: event.toolName,
            displayName,
            label
          }));
        }
        enqueue(() => ctx.respond(`_→ ${label}_`, false));
      }

      if (event.type === "tool_execution_end") {
        const body = extractTextFromResult(event.result);
        const displayName = resolveToolDisplayName(event.toolName, {
          result: event.result,
          sandboxAttempted: this.getEffectiveSandboxEnabled()
        });
        const status = event.isError ? "✗" : "✓";
        const budgetResult = budget.recordToolResult(event.isError);
        if (event.isError) {
          failedToolNames.push(event.toolName);
        }
        const hostBashApproval = extractHostBashApprovalPrompt(event.result);
        const forwardHostBashApproval = shouldForwardHostBashApproval(hostBashApproval);
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "tool_execution_end",
            toolName: event.toolName,
            displayName,
            isError: event.isError,
            summary: body,
            hostBashApproval: forwardHostBashApproval ? hostBashApproval : undefined
          }));
        }
        const text = `*${status} ${displayName}*\n\`\`\`\n${body}\n\`\`\``;
        logRunDetail({
          type: "tool_end",
          toolName: event.toolName,
          displayName,
          summary: body,
          isError: event.isError
        });
        if (event.isError) {
          enqueue(() => respondInThread(text));
          enqueue(() => ctx.respond(`_Error: ${body.slice(0, 200)}_`, false));
        }
        if (!budgetResult.ok) {
          enqueue(() => respondInThread(budgetResult.reason ?? "Run budget exceeded."));
          this.agent.abort();
        } else if (!hostBashApproval) {
          const currentBudget = budget.snapshot();
          const shouldRecommendSubagent =
            !subagentDelegationNoticeSent &&
            currentBudget.toolCalls >= SUBAGENT_DELEGATION_NOTICE_TOOL_CALLS &&
            !usedToolNames.includes("subagent") &&
            this.agent.state.tools.some((tool) => tool.name === "subagent");
          if (shouldRecommendSubagent) {
            subagentDelegationNoticeSent = true;
            this.agent.followUp({
              role: "user",
              content: [{ type: "text", text: SUBAGENT_DELEGATION_RUNTIME_NOTICE }],
              timestamp: Date.now()
            });
            if (this.activeHookContext) {
              this.hookManager.emit("runtime.notice", this.activeHookContext, {
                code: "SUBAGENT_DELEGATION_RECOMMENDED",
                severity: "warn",
                message: "Parent run has used many tools without delegating to subagent.",
                toolCalls: currentBudget.toolCalls,
                maxToolCalls: budget.limitsSnapshot().maxToolCalls
              });
            }
            momWarn("runner", "subagent_delegation_notice", {
              runId,
              chatId: this.chatId,
              sessionId: this.sessionId,
              toolCalls: currentBudget.toolCalls,
              maxToolCalls: budget.limitsSnapshot().maxToolCalls
            });
          }
        }
      }

      if (event.type === "message_end") {
        const message = event.message as AgentMessage & { role?: string };
        if (message.role === "user") {
          const persisted = rewritePromptUserMessageForPersistence(
            message,
            currentModelPromptMessage,
            currentPersistedPromptMessage
          );
          const isCurrentPrompt = getMessageText(message).trim() === currentModelPromptMessage.trim();
          const isTransientRuntimeNotice = stripTransientRuntimeNoticesFromMessages([message]).length === 0;
          if (!isCurrentPrompt && !isTransientRuntimeNotice) {
            this.store.appendContextMessage(this.chatId, persisted, this.sessionId);
          }
        } else if (message.role === "assistant" || message.role === "toolResult") {
          this.store.appendContextMessage(this.chatId, message, this.sessionId);
          if (message.role === "assistant") assistantMessagePersisted = true;
        }
      }

      if (
        event.type === "message_end" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const msg = event.message as {
          stopReason?: "stop" | "aborted" | "error" | "waiting_for_approval";
          errorMessage?: string;
          content?: Array<{ type: string; text?: string }>;
          api?: string;
          provider?: string;
          model?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            totalTokens?: number;
          };
        };
        if (msg.stopReason) {
          stopReason = msg.stopReason;
        }
        if (msg.errorMessage) errorMessage = msg.errorMessage;
        if (msg.errorMessage) {
          momWarn("runner", "assistant_error_message", {
            runId,
            chatId: this.chatId,
            errorMessage: msg.errorMessage,
          });
        }
        momLog("runner", "assistant_message_end", {
          runId,
          chatId: this.chatId,
          stopReason: msg.stopReason,
          api: msg.api,
          provider: msg.provider,
          model: msg.model,
          contentCount: Array.isArray(msg.content) ? msg.content.length : 0,
          usage: msg.usage,
        });
        if (msg.usage) {
          finalUsage = {
            inputTokens: Number(msg.usage.input ?? 0),
            outputTokens: Number(msg.usage.output ?? 0),
            cacheReadTokens: Number(msg.usage.cacheRead ?? 0),
            cacheWriteTokens: Number(msg.usage.cacheWrite ?? 0),
            totalTokens: Number(msg.usage.totalTokens ?? 0)
          };
          this.usageTracker.record({
            channel: this.channel,
            botId,
            provider: msg.provider ?? activeSelection.model.provider,
            model: msg.model ?? activeSelection.model.id,
            api: msg.api ?? activeSelection.model.api,
            inputTokens: msg.usage.input,
            outputTokens: msg.usage.output,
            cacheReadTokens: msg.usage.cacheRead,
            cacheWriteTokens: msg.usage.cacheWrite,
            totalTokens: msg.usage.totalTokens
          });
          this.emitActiveModelCallAfter(msg.usage, msg.stopReason);
        }

        const text = (msg.content || [])
          .filter(
            (part) => part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text as string)
          .join("\n");

        if (text.trim() && !assistantTextStreamed && msg.stopReason !== "stop") {
          momLog("runner", "assistant_text_chunk", {
            runId,
            chatId: this.chatId,
            textLength: text.length,
          });
          enqueue(() => ctx.respond(text));
        }
      }
    });

    const MAX_EMPTY_RETRIES = 2;
    const modelFailures: ModelAttemptFailure[] = [];
    let savedSkillDraft:
      | {
          filePath: string;
          fileName: string;
          name: string;
          content: string;
        }
      | undefined;

    try {
      this.activeRunBudget = budget;
      this.agent.state.messages = prepareMessagesForModelContext(
        this.agent.state.messages as AgentMessage[]
      );
      await ctx.setTyping(true);
      await ctx.setWorking(true);

      const nonImage = ctx.message.attachments
        .filter((a) => !a.isImage || !visionDecision.sendImagesNatively)
        .map((a) => `${ctx.workspaceDir}/${a.local}`);
      const promptInput = buildPromptInputEnvelope({
        messageText: effectiveInputText,
        attachmentPaths: nonImage,
        messageTimestamp: ctx.message.ts,
        timezone: settings.timezone
      });
      const userMessage = promptInput.modelMessage;
      currentModelPromptMessage = userMessage;
      currentPersistedPromptMessage = promptInput.persistedMessage;

      let finalText = "";
      let finalSupplements: string[] = [];
      let finalAttemptCount = 0;
      let successfulCandidateIndex = -1;
      let runAborted = false;
      const pendingModelErrorEvents: Array<{
        selection: ResolvedModelSelection;
        failure: ModelAttemptFailure;
        candidateIndex: number;
      }> = [];

      for (let candidateIndex = 0; candidateIndex < modelCandidates.length; candidateIndex += 1) {
        const budgetAttempt = budget.tryRecordModelAttempt();
        if (!budgetAttempt.ok) {
          stopReason = "error";
          errorMessage = budgetAttempt.reason;
          break;
        }
        const selection = modelCandidates[candidateIndex];
        if (this.activeHookContext) {
          this.hookManager.emit("model.select.before", this.activeHookContext, {
            candidateIndex,
            candidateCount: modelCandidates.length,
            route: modelUseCase
          });
        }
        activeSelection = selection;
        stopReason = "stop";
        errorMessage = undefined;

        const selectedModel = selection.model;
        if (this.activeHookContext) {
          this.hookManager.emit("model.select.after", this.activeHookContext, {
            candidateIndex,
            candidateCount: modelCandidates.length,
            route: modelUseCase,
            provider: selectedModel.provider,
            model: selectedModel.id,
            api: selectedModel.api
          });
        }
        const selectedCustom = settings.customProviders.find((p) => p.id === selectedModel.provider);
        const resolvedKey = await resolveApiKeyForModel(selectedModel, settings);
        if (!resolvedKey) {
          if (!promptUserPersisted) {
            this.store.appendContextMessage(
              this.chatId,
              createPersistedUserMessage(promptInput.persistedMessage, ctx.message.ts),
              this.sessionId
            );
            promptUserPersisted = true;
          }
          const keyError =
            `AI settings error: missing API key for active model provider '${selectedModel.provider}'. ` +
            "Please check current model routing and provider key configuration.";
          const failure = toModelAttemptFailure(selection, keyError, "missing_api_key");
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "active_model_missing_api_key", {
            runId,
            chatId: this.chatId,
            providerMode: settings.providerMode,
            modelProvider: selectedModel.provider,
            modelId: selectedModel.id
          });
          if (candidateIndex === modelCandidates.length - 1) {
            for (const item of pendingModelErrorEvents) {
              recordModelFailure(this.modelErrorTracker, {
                channel: this.channel,
                botId,
                chatId: this.chatId,
                sessionId: this.sessionId,
                runId,
                route: "text",
                selection: item.selection,
                failure: item.failure,
                candidateIndex: item.candidateIndex,
                recovered: false,
                fallbackUsed: false
              });
            }
            await ctx.setWorking(false);
            await ctx.replaceMessage(keyError);
            this.store.appendContextMessage(
              this.chatId,
              createAssistantErrorMessage({
                errorMessage: keyError,
                model: selectedModel
              }),
              this.sessionId
            );
            assistantMessagePersisted = true;
            logRunDetail({ type: "final", summary: keyError, isError: true });
            getTurnOrchestrator().updateRunStatus(runId, "failed", keyError);
            stopReason = "error";
            errorMessage = keyError;
            return { runId, stopReason: "error", errorMessage: keyError };
          }
          continue;
        }

        this.agent.state.model = selectedModel;
        const requestedThinkingLevel = ctx.thinkingLevelOverride ?? settings.defaultThinkingLevel;
        const effectiveThinkingLevel = resolveThinkingLevel(
          { defaultThinkingLevel: requestedThinkingLevel },
          selectedModel.reasoning
        );
        this.agent.state.thinkingLevel = effectiveThinkingLevel;
        this.activePayloadContext = {
          provider: selectedModel.provider,
          model: selectedModel.id,
          api: selectedModel.api,
          requestedThinkingLevel,
          effectiveThinkingLevel
        };
        if (ctx.onRunnerEvent) {
          await ctx.onRunnerEvent({
            type: "thinking_config",
            requestedThinkingLevel,
            effectiveThinkingLevel,
            provider: selectedModel.provider,
            model: selectedModel.id,
            reasoningSupported: selectedModel.reasoning
          });
        }
        this.agent.sessionId = buildAgentSessionId(
          this.channel,
          this.chatId,
          this.sessionId,
          modelUseCase,
          selection
        );
        this.agent.transport = resolvePreferredTransport(selectedModel);
        if (candidateIndex === 0) {
          try {
            await this.compact({
              reason: "threshold",
              notify: async (text) => {
                await respondInThread(text);
              }
            });
          } catch (error) {
            momWarn("runner", "context_compaction_failed", {
              runId,
              chatId: this.chatId,
              provider: selectedModel.provider,
              model: selectedModel.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        if (!promptUserPersisted) {
          this.store.appendContextMessage(
            this.chatId,
            createPersistedUserMessage(promptInput.persistedMessage, ctx.message.ts),
            this.sessionId
          );
          promptUserPersisted = true;
        }
        momLog("runner", "model_selected", {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          providerMode: settings.providerMode,
          modelProvider: selectedModel.provider,
          modelId: selectedModel.id,
          modelApi: selectedModel.api,
          modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
          customProviderId: selectedCustom?.id,
          customProviderName: selectedCustom?.name,
          customProviderPath: selectedCustom?.path,
          customProviderProtocol: selectedCustom?.protocol ?? "openai-compatible",
          customProviderComputedBaseUrl: selectedCustom
            ? redactBaseUrl(
              resolveCustomProviderProtocol(selectedCustom.protocol) === "anthropic"
                ? buildAnthropicBaseUrl(selectedCustom.baseUrl, selectedCustom.path)
                : buildOpenAIBaseUrl(selectedCustom.baseUrl, selectedCustom.path),
            )
            : undefined,
          visionRoutingMode: visionDecision.mode,
          visionRoutingReason: visionDecision.reason,
          nativeVisionEnabled: visionDecision.sendImagesNatively,
          visionRouteKey: currentModelKey(settings, "vision"),
          audioRoutingMode: audioDecision.mode,
          audioRoutingReason: audioDecision.reason,
          sttRouteKey: currentModelKey(settings, "stt"),
          modelFallbackMode: settings.modelFallback?.mode ?? "same-provider",
          hasApiKey: Boolean(resolvedKey),
          apiKeyFingerprint: keyFingerprint(resolvedKey),
          candidateIndex,
          candidateCount: modelCandidates.length
        });

        const beforeAttempt = [...(this.agent.state.messages as AgentMessage[])];
        let attemptCount = 0;
        let candidateFinalText = "";
        let overflowRetryUsed = false;
        let toolBudgetContinuationUsed = false;

        let candidateHadAttemptError = false;
        try {
          while (attemptCount <= MAX_EMPTY_RETRIES) {
            if (attemptCount > 0) {
              momWarn("runner", "empty_response_retry", {
                runId,
                chatId: this.chatId,
                attempt: attemptCount,
                provider: selectedModel.provider,
                model: selectedModel.id
              });
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            momLog("runner", "prompt_start", {
              runId,
              chatId: this.chatId,
              promptLength: userMessage.length,
              imageCount: visionDecision.sendImagesNatively ? ctx.message.imageContents.length : 0,
              rawImageCount: ctx.message.imageContents.length,
              visionRoutingMode: visionDecision.mode,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });
            promptStartedAt = Date.now();
            firstAssistantTokenLogged = false;
            stopReason = "stop";
            errorMessage = undefined;

            this.activeModelPromptContext = {
              candidateIndex,
              attemptIndex: attemptCount
            };
            this.activeModelCallContext = undefined;

            await this.agent.prompt(
              userMessage,
              visionDecision.sendImagesNatively && ctx.message.imageContents.length > 0
                ? ctx.message.imageContents
                : undefined,
            );
            if (this.abortRequested) {
              stopReason = "aborted";
            }
            momLog("runner", "prompt_end", {
              runId,
              chatId: this.chatId,
              stopReason,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });

            while (!this.abortRequested && (queueRunning || queue.length > 0)) {
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (this.abortRequested) {
              queue.length = 0;
            }
            momLog("runner", "queue_flushed", {
              runId,
              chatId: this.chatId,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });



            const messages = this.agent.state.messages as AgentMessage[];
            const attemptMessages = messages.slice(beforeAttempt.length);
            const terminalAssistants = attemptMessages
              .filter((item) => {
                const row = item as { role?: string; stopReason?: string };
                return row.role === "assistant" && row.stopReason === "stop" && getMessageText(item).trim();
              })
              .map((message) => ({
                message,
                text: getMessageText(message).trim()
              }));
            const lastAssistant = [...messages]
              .reverse()
              .find((item) => (item as { role?: string }).role === "assistant") as AgentMessage | undefined;

            finalSupplements = [];
            if (terminalAssistants.length > 1) {
              candidateFinalText = terminalAssistants[0]?.text ?? "";
              finalSupplements = terminalAssistants.slice(1).map((item) => item.text).filter(Boolean);
            } else {
              candidateFinalText = lastAssistant ? getMessageText(lastAssistant).trim() : "";
            }
            const lastAssistantContentCount = Array.isArray((lastAssistant as { content?: unknown } | undefined)?.content)
              ? ((lastAssistant as { content?: unknown[] }).content?.length ?? 0)
              : 0;
            momLog("runner", "final_text_evaluated", {
              runId,
              chatId: this.chatId,
              finalTextLength: candidateFinalText.length,
              lastAssistantContentCount,
              terminalAssistantCount: terminalAssistants.length,
              supplementCount: finalSupplements.length,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });

            if (
              !toolBudgetContinuationUsed &&
              budget.getExceededReason()?.includes("too many tool calls")
            ) {
              const continuationBudget = budget.tryRecordModelAttempt();
              if (!continuationBudget.ok) {
                stopReason = "error";
                errorMessage = continuationBudget.reason;
              } else {
                toolBudgetContinuationUsed = true;
                const toolBudgetNotice = budget.getExceededReason() ?? "Run budget exceeded: too many tool calls.";
                this.store.appendRuntimeEvent(this.chatId, {
                  code: TOOL_BUDGET_EXHAUSTED_CODE,
                  level: "warn",
                  summary: "Run hit the tool-call budget and switched to one no-tool continuation attempt.",
                  details: {
                    reason: toolBudgetNotice,
                    budget: budget.snapshot(),
                    limits: budget.limitsSnapshot(),
                    candidateIndex,
                    attempt: attemptCount
                  }
                }, this.sessionId);
                const partialBeforeContinuation = candidateFinalText || streamedAssistantText.trim();
                if (ctx.beginContinuationResponse) {
                  await ctx.beginContinuationResponse(partialBeforeContinuation, toolBudgetNotice);
                  if (partialBeforeContinuation.trim()) {
                    mainAnswerCommitted = true;
                  }
                } else if (partialBeforeContinuation.trim()) {
                  await commitMainAnswer([partialBeforeContinuation, toolBudgetNotice].filter(Boolean).join("\n\n"));
                } else {
                  await respondInThread(toolBudgetNotice);
                }
                streamedAssistantText = "";
                assistantTextStreamed = false;
                candidateFinalText = "";
                const previousTools = this.agent.state.tools;
                this.agent.state.tools = [];
                await respondInThread(
                  "工具调用已达到本轮上限，正在自动发起一次无工具续写，尽量保留已有结果并给出当前最佳答案。"
                );
                if (this.activeHookContext) {
                  this.hookManager.emit("runtime.notice", this.activeHookContext, {
                    code: "TOOL_BUDGET_CONTINUATION",
                    severity: "warn",
                    message: "Tool call budget reached; starting one no-tool continuation.",
                    provider: selectedModel.provider,
                    model: selectedModel.id,
                    candidateIndex,
                    attempt: attemptCount,
                    reason: budget.getExceededReason()
                  });
                }
                momWarn("runner", "tool_budget_continuation_prompt", {
                  runId,
                  chatId: this.chatId,
                  provider: selectedModel.provider,
                  model: selectedModel.id,
                  candidateIndex,
                  attempt: attemptCount,
                  reason: budget.getExceededReason()
                });
                promptStartedAt = Date.now();
                firstAssistantTokenLogged = false;
                stopReason = "stop";
                errorMessage = undefined;

                this.activeModelPromptContext = {
                  candidateIndex,
                  attemptIndex: attemptCount
                };
                this.activeModelCallContext = undefined;

                try {
                  await this.agent.prompt(TOOL_BUDGET_RUNTIME_NOTICE);
                } finally {
                  this.agent.state.tools = previousTools;
                }
                this.agent.state.messages = prepareMessagesForModelContext(
                  this.agent.state.messages as AgentMessage[]
                );
                while (queueRunning || queue.length > 0) {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
                const continuationMessages = this.agent.state.messages as AgentMessage[];
                const continuationAssistant = [...continuationMessages]
                  .reverse()
                  .find((item) => (item as { role?: string }).role === "assistant") as
                  | { content?: Array<{ type: string; text?: string }> }
                  | undefined;
                candidateFinalText = (continuationAssistant?.content || [])
                  .filter((part) => part.type === "text" && typeof part.text === "string")
                  .map((part) => part.text as string)
                  .join("\n")
                  .trim();
                if (!candidateFinalText && streamedAssistantText.trim()) {
                  candidateFinalText = streamedAssistantText.trim();
                }
                const manualContinueNotice =
                  "自动续写最多执行一次；如果这条回复仍然不完整或再次触发上限，请手动发送“继续”，我会基于当前上下文接着处理。";
                candidateFinalText = candidateFinalText
                  ? `${candidateFinalText}\n\n${manualContinueNotice}`
                  : manualContinueNotice;
                momLog("runner", "tool_budget_continuation_evaluated", {
                  runId,
                  chatId: this.chatId,
                  finalTextLength: candidateFinalText.length,
                  provider: selectedModel.provider,
                  model: selectedModel.id
                });
              }
            }

            const decision = resolvePromptAttemptDecision({
              stopReason,
              errorMessage,
              finalText: candidateFinalText,
              attemptCount,
              maxEmptyRetries: MAX_EMPTY_RETRIES
            });
            if (decision.kind === "aborted") {
              runAborted = true;
              this.agent.state.messages = beforeAttempt;
              break;
            }
            if (decision.kind === "retryable_error" || decision.kind === "terminal_error") {
              candidateHadAttemptError = true;
              const failure = toModelAttemptFailure(selection, decision.message, "request_error");
              modelFailures.push(failure);
              pendingModelErrorEvents.push({ selection, failure, candidateIndex });
              momWarn("runner", "model_attempt_retryable_error", {
                runId,
                chatId: this.chatId,
                provider: selectedModel.provider,
                model: selectedModel.id,
                candidateIndex,
                attempt: attemptCount,
                error: decision.message
              });
              this.agent.state.messages = beforeAttempt;
              if (decision.kind === "retryable_error") {
                attemptCount += 1;
                continue;
              }
              attemptCount += 1;
              break;
            }

            if (candidateFinalText) {
              const sessionContextFile = this.store.getSessionEntriesPath(this.chatId, this.sessionId);
              const finalMessages = rewritePromptUserMessage(
                this.agent.state.messages as AgentMessage[],
                beforeAttempt.length,
                promptInput.persistedMessage
              );
              this.agent.state.messages = finalMessages;
              momLog("runner", "context_saved", {
                runId,
                chatId: this.chatId,
                sessionId: this.sessionId,
                sessionContextFile,
                messageCount: finalMessages.length,
              });
              break;
            }
            this.agent.state.messages = beforeAttempt;
            attemptCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!overflowRetryUsed && isContextOverflowError(message)) {
            overflowRetryUsed = true;
            momWarn("runner", "context_overflow_detected", {
              runId,
              chatId: this.chatId,
              provider: selectedModel.provider,
              model: selectedModel.id,
              candidateIndex,
              error: message
            });
            this.agent.state.messages = beforeAttempt;
            try {
              const compacted = await this.compact({
                reason: "threshold",
                notify: async (text) => {
                  await respondInThread(text);
                }
              });
              if (compacted.changed) {
                momLog("runner", "context_overflow_retrying_after_compact", {
                  runId,
                  chatId: this.chatId,
                  provider: selectedModel.provider,
                  model: selectedModel.id,
                  candidateIndex,
                  beforeTokens: compacted.beforeTokens,
                  afterTokens: compacted.afterTokens
                });
                continue;
              }
            } catch (compactError) {
              momWarn("runner", "context_overflow_compaction_failed", {
                runId,
                chatId: this.chatId,
                provider: selectedModel.provider,
                model: selectedModel.id,
                candidateIndex,
                error: compactError instanceof Error ? compactError.message : String(compactError)
              });
            }
          }
          const failure = toModelAttemptFailure(selection, message, "request_error");
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "model_attempt_failed", {
            runId,
            chatId: this.chatId,
            provider: selectedModel.provider,
            model: selectedModel.id,
            candidateIndex,
            error: message
          });
          this.agent.state.messages = beforeAttempt;
          if (candidateIndex < modelCandidates.length - 1 && isRetryableModelError(message)) {
            continue;
          }
          for (const item of pendingModelErrorEvents) {
            recordModelFailure(this.modelErrorTracker, {
              channel: this.channel,
              botId,
              chatId: this.chatId,
              sessionId: this.sessionId,
              runId,
              route: "text",
              selection: item.selection,
              failure: item.failure,
              candidateIndex: item.candidateIndex,
              recovered: false,
              fallbackUsed: false
            });
          }
          throw new Error(
            `Run failed after model attempts: ${modelFailures.map(formatModelAttemptFailure).join(" | ")}`
          );
        }

        finalAttemptCount = attemptCount;
        if (runAborted) {
          break;
        }
        if (candidateFinalText) {
          finalText = candidateFinalText;
          successfulCandidateIndex = candidateIndex;
          break;
        }

        if (!candidateHadAttemptError) {
          const failure = toModelAttemptFailure(
            selection,
            `empty response after ${attemptCount} attempt(s)`,
            "empty_response"
          );
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "final_empty_response_after_retries", {
            runId,
            chatId: this.chatId,
            totalAttempts: attemptCount,
            modelProvider: selectedModel.provider,
            modelId: selectedModel.id,
            modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
            candidateIndex
          });
        }
        this.agent.state.messages = beforeAttempt;
      }

      if (successfulCandidateIndex >= 0 && pendingModelErrorEvents.length > 0) {
        const finalSelection = modelCandidates[successfulCandidateIndex];
        for (const item of pendingModelErrorEvents) {
          recordModelFailure(this.modelErrorTracker, {
            channel: this.channel,
            botId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            runId,
            route: "text",
            selection: item.selection,
            failure: item.failure,
            candidateIndex: item.candidateIndex,
            recovered: true,
            fallbackUsed: successfulCandidateIndex > 0,
            finalSelection
          });
        }
      }
      if (successfulCandidateIndex < 0 && pendingModelErrorEvents.length > 0) {
        for (const item of pendingModelErrorEvents) {
          recordModelFailure(this.modelErrorTracker, {
            channel: this.channel,
            botId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            runId,
            route: "text",
            selection: item.selection,
            failure: item.failure,
            candidateIndex: item.candidateIndex,
            recovered: false,
            fallbackUsed: false
          });
        }
      }

      if (!finalText && streamedAssistantText.trim()) {
        finalText = streamedAssistantText.trim();
        if (stopReason !== "aborted") {
          stopReason = "error";
          errorMessage = errorMessage ?? budget.getExceededReason();
          momWarn("runner", "partial_stream_preserved_after_error", {
            runId,
            chatId: this.chatId,
            finalTextLength: finalText.length,
            errorMessage
          });
        }
      }

      if (finalText.startsWith("[SILENT]")) {
        momLog("runner", "final_silent", { runId, chatId: this.chatId });
        await ctx.deleteMessage();
      } else if (finalText) {
        if (successfulCandidateIndex > 0 && modelFailures.length > 0) {
          const recoveredFailureTitle = modelUseCase === "vision"
            ? "图片识别模型请求失败，已自动切换到备用模型继续处理。"
            : "主模型请求失败，已自动切换到备用模型。";
          await respondInThread(
            [
              recoveredFailureTitle,
              ...modelFailures.map((failure, index) => `${index + 1}. ${formatModelAttemptFailure(failure)}`),
              `active=provider=${activeSelection.model.provider}, model=${activeSelection.model.id}`
            ].join("\n")
          );
        }
        momLog("runner", "final_replace", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
          mainAnswerCommitted,
        });
        if (mainAnswerCommitted) {
          await sendSupplement(finalText);
        } else {
          await ctx.replaceMessage(finalText);
        }
        for (const supplement of finalSupplements) {
          if (supplement.trim() && supplement.trim() !== finalText.trim()) {
            await sendSupplement(supplement);
          }
        }
      } else if (stopReason === "aborted") {
        momLog("runner", "run_aborted", { runId, chatId: this.chatId });
      } else {
        const modelInfo = [
          `provider: ${activeSelection.model.provider}`,
          `model: ${activeSelection.model.id}`,
          activeSelection.model.baseUrl ? `baseUrl: ${redactBaseUrl(activeSelection.model.baseUrl)}` : null,
        ].filter(Boolean).join(", ");
        const emptyResponseMessage =
          `All model attempts failed. Last model returned empty response after ${finalAttemptCount} attempt(s). ` +
          `(${modelInfo}) — ${modelFailures.map(formatModelAttemptFailure).join(" | ")}`;
        await ctx.replaceMessage(emptyResponseMessage);
        await respondInThread(
          [
            `All model attempts failed. Last model info — ${modelInfo}`,
            ...modelFailures.map((failure, index) => `${index + 1}. ${formatModelAttemptFailure(failure)}`)
          ].join("\n")
        );
        stopReason = "error";
        if (!errorMessage) errorMessage = emptyResponseMessage;
      }

      await ctx.setWorking(false);

      if (shouldEmitFinalRunnerError(errorMessage, finalText)) {
        momWarn("runner", "final_error", {
          runId,
          chatId: this.chatId,
          errorMessage,
        });
        await ctx.replaceMessage("Sorry, something went wrong.");
        await respondInThread(`Error: ${errorMessage}`);
      }

      if (stopReason === "error" && errorMessage && !assistantMessagePersisted) {
        this.store.appendContextMessage(
          this.chatId,
          createAssistantErrorMessage({
            text: finalText || streamedAssistantText.trim(),
            errorMessage,
            model: activeSelection.model
          }),
          this.sessionId
        );
        assistantMessagePersisted = true;
      }

      if (
        shouldSuggestSkillDraft({
          stopReason,
          finalText,
          toolCalls: budget.snapshot().toolCalls,
          toolFailures: budget.snapshot().toolFailures,
          modelAttempts: budget.snapshot().modelAttempts,
          explicitSkillCount: explicitlyInvokedSkills.length,
          settings: settings.skillDrafts
        })
      ) {
        const templateSkillPath = String(settings.skillDrafts.template.skillPath ?? "").trim();
        const draftMetadata = await buildSkillDraftMetadataViaSubagent({
          userMessage: effectiveInputText,
          finalAnswer: finalText,
          toolNames: usedToolNames,
          templateSkillPath
        }, {
          cwd: this.store.getScratchDir(this.chatId),
          workspaceDir: this.store.getWorkspaceDir(),
          chatId: this.chatId,
          settings
        });
        savedSkillDraft = saveSkillDraft({
          workspaceDir: this.store.getWorkspaceDir(),
          chatId: this.chatId,
          userMessage: effectiveInputText,
          finalAnswer: finalText,
          toolNames: usedToolNames,
          failedToolNames,
          explicitSkillNames: explicitlyInvokedSkills.map((skill) => skill.name),
          modelFailures: modelFailures.map(formatModelAttemptFailure),
          draftMetadata: draftMetadata ?? undefined,
          settings: settings.skillDrafts
        });
      }

      const runSummary: RunSummary = {
        runId,
        workspaceId,
        sessionId: this.sessionId,
        stopReason,
        durationMs: Date.now() - runStartedAt,
        finalText,
        toolNames: usedToolNames,
        failedToolNames,
        explicitSkillNames: explicitlyInvokedSkills.map((skill) => skill.name),
        usedFallbackModel: successfulCandidateIndex > 0,
        modelFailureSummaries: modelFailures.map(formatModelAttemptFailure),
        budget: budget.snapshot(),
        budgetLimits: budget.limitsSnapshot(),
        usage: finalUsage,
        memorySnapshot: {
          createdAt: memorySnapshot.createdAt,
          fingerprint: memorySnapshot.fingerprint,
          query: memorySnapshot.query,
          selectedCount: memorySnapshot.selected.length,
          longTermCount: memorySnapshot.longTerm.length,
          dailyCount: memorySnapshot.daily.length
        },
        subagent: buildSubagentSummary(),
        skillDraft: savedSkillDraft,
        reflection: buildRunReflection({
          stopReason,
          finalText,
          failedToolNames,
          usedFallbackModel: successfulCandidateIndex > 0,
          errorMessage,
          skillDraftSaved: Boolean(savedSkillDraft)
        }),
        errorMessage
      };
      getTurnOrchestrator().commitTurn(this.chatId, runSummary, this.store);
      logRunDetail({
        type: "final",
        summary: stopReason === "stop"
          ? "Run finished successfully."
          : errorMessage || `Run finished with stopReason=${stopReason}.`,
        isError: stopReason !== "stop"
      });

      if (!finalText.startsWith("[SILENT]") && Boolean(savedSkillDraft)) {
        await respondInThread(formatRunClosingNote(runSummary));
      }
      return { runId, workspaceId, stopReason, errorMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partialText = streamedAssistantText.trim();
      if (!assistantMessagePersisted) {
        this.store.appendContextMessage(
          this.chatId,
          createAssistantErrorMessage({
            text: partialText,
            errorMessage: message,
            model: activeSelection.model
          }),
          this.sessionId
        );
        assistantMessagePersisted = true;
      }
      momError("runner", "run_exception", {
        runId,
        chatId: this.chatId,
        error: message,
        partialTextLength: partialText.length
      });
      const failedSummary: RunSummary = {
        runId,
        workspaceId,
        sessionId: this.sessionId,
        stopReason: "error",
        durationMs: Date.now() - runStartedAt,
        finalText: partialText,
        toolNames: usedToolNames,
        failedToolNames,
        explicitSkillNames: [],
        usedFallbackModel: false,
        modelFailureSummaries: [],
        budget: budget.snapshot(),
        budgetLimits: budget.limitsSnapshot(),
        usage: finalUsage,
        subagent: buildSubagentSummary(),
        reflection: buildRunReflection({
          stopReason: "error",
          finalText: "",
          failedToolNames,
          usedFallbackModel: false,
          errorMessage: message,
          skillDraftSaved: false
        }),
        errorMessage: message
      };
      getTurnOrchestrator().commitTurn(this.chatId, failedSummary, this.store);
      logRunDetail({ type: "final", summary: message, isError: true });
      try {
        await ctx.setWorking(false);
        if (!partialText) {
          await ctx.replaceMessage(`Run failed: ${message}`);
        }
        await respondInThread(`Error: ${message}`);
      } catch {
        // ignore secondary UI errors
      }
      return { runId, workspaceId, stopReason: "error", errorMessage: message };
    } finally {
      unsubscribe();
      unsubscribeHooks();
      await finishHookRun();
      this.activeHookContext = undefined;
      this.activeModelPromptContext = undefined;
      this.activeModelCallContext = undefined;
      try {
        const saved = this.store.loadContext(this.chatId, this.sessionId);
        this.agent.state.messages = prepareMessagesForModelContext(saved);
      } catch {
        // keep in-memory state if session reload fails
      }
      this.activeRunBudget = undefined;
      this.activeRunnerEventSink = undefined;
      this.activePayloadContext = undefined;
      this.activeRunSkillManifest.clear();
      this.pendingReadPaths.clear();
      this.activeRunLoadedSkills.clear();
      this.pendingToolSignals.clear();
      this.activeSkillLoadSeq = 0;
      this.abortRequested = false;
      this.running = false;
    }
  }

  private cacheResolvedReadPath(context: ToolCallTrackingContext): void {
    if (context.toolCall.name !== "read") return;
    const rawPath = (context.args as { path?: unknown } | undefined)?.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) return;
    try {
      const resolvedPath = resolveToolPath(this.store.getScratchDir(this.chatId), rawPath);
      this.pendingReadPaths.set(context.toolCall.id, resolvedPath);
    } catch {
      // Skill tracking must never change tool execution behavior.
    }
  }

  private cacheToolSignalContext(context: ToolCallTrackingContext): void {
    const pending: PendingToolSignalContext = {
      toolName: context.toolCall.name
    };
    if (context.toolCall.name === "bash") {
      const command = (context.args as { command?: unknown } | undefined)?.command;
      if (typeof command === "string" && command.trim()) {
        pending.command = command;
      }
    }
    this.pendingToolSignals.set(context.toolCall.id, pending);
  }

  private markSkillLoaded(skill: LoadedSkill): void {
    this.activeRunLoadedSkills.set(pathCompareKey(skill.filePath), {
      skill,
      loadedSeq: ++this.activeSkillLoadSeq
    });
  }

  private emitSkillLoadedForReadTool(context: ToolCallTrackingContext): void {
    if (context.toolCall.name !== "read") return;
    const resolvedPath = this.pendingReadPaths.get(context.toolCall.id);
    this.pendingReadPaths.delete(context.toolCall.id);
    if (!resolvedPath || context.isError || !this.activeHookContext) return;
    const skill = this.activeRunSkillManifest.get(pathCompareKey(resolvedPath));
    if (!skill) return;
    this.markSkillLoaded(skill);
    this.hookManager.emit("skill.loaded", this.activeHookContext, {
      name: skill.name,
      scope: skill.scope,
      filePath: skill.filePath,
      reason: "read_skill_file"
    });
  }

  private emitSkillExecutedForToolSignals(context: ToolCallTrackingContext): void {
    const pending = this.pendingToolSignals.get(context.toolCall.id) ?? { toolName: context.toolCall.name };
    this.pendingToolSignals.delete(context.toolCall.id);
    if (pending.toolName === "read") return;
    if (context.isError || !this.activeHookContext || this.activeRunLoadedSkills.size === 0) return;
    const match = this.findBestExecutedSkillSignal(pending, context.result);
    if (!match) return;
    this.hookManager.emit("skill.loaded", this.activeHookContext, {
      name: match.skill.name,
      scope: match.skill.scope,
      filePath: match.skill.filePath,
      reason: match.reason,
      signalType: match.signalType,
      signal: match.signal,
      toolName: pending.toolName,
      ...(match.mcpServerId ? { mcpServerId: match.mcpServerId } : {})
    });
  }

  private findBestExecutedSkillSignal(
    pending: PendingToolSignalContext,
    result: unknown
  ): { skill: LoadedSkill; reason: string; signalType: "cli" | "mcp" | "tool"; signal: string; mcpServerId?: string } | null {
    const candidates: Array<{
      state: LoadedSkillState;
      reason: string;
      signalType: "cli" | "mcp" | "tool";
      signal: string;
      mcpServerId?: string;
    }> = [];
    const mcpDetails = this.extractMcpSignalDetails(result);

    for (const state of this.activeRunLoadedSkills.values()) {
      const { signals } = state.skill;
      if (pending.toolName === "bash" && pending.command) {
        const signal = signals.cli.find((item) => this.commandMatchesCliSignal(pending.command ?? "", item));
        if (signal) {
          candidates.push({ state, reason: "cli_signal", signalType: "cli", signal });
        }
      }
      const toolSignal = signals.tools.find((item) => item.toLowerCase() === pending.toolName.toLowerCase());
      if (toolSignal) {
        candidates.push({ state, reason: "tool_signal", signalType: "tool", signal: toolSignal });
      }
      const mcpSignal = signals.mcp.find((item) => this.mcpSignalMatches(pending.toolName, mcpDetails, item));
      if (mcpSignal) {
        candidates.push({
          state,
          reason: "mcp_signal",
          signalType: "mcp",
          signal: mcpSignal,
          mcpServerId: mcpDetails.serverId
        });
      }
    }

    candidates.sort((a, b) => b.state.loadedSeq - a.state.loadedSeq);
    const winner = candidates[0];
    if (!winner) return null;
    return {
      skill: winner.state.skill,
      reason: winner.reason,
      signalType: winner.signalType,
      signal: winner.signal,
      mcpServerId: winner.mcpServerId
    };
  }

  private commandMatchesCliSignal(command: string, signal: string): boolean {
    const normalizedCommand = command.trim().replace(/\s+/g, " ");
    const normalizedSignal = signal.trim().replace(/\s+/g, " ");
    if (!normalizedCommand || !normalizedSignal) return false;
    if (!normalizedCommand.startsWith(normalizedSignal)) return false;
    const next = normalizedCommand.charAt(normalizedSignal.length);
    if (!next) return true;
    if (!/[a-z0-9_-]$/i.test(normalizedSignal)) return true;
    return /[\s;&|)]/.test(next);
  }

  private extractMcpSignalDetails(result: unknown): { serverId?: string; serverName?: string; remoteToolName?: string } {
    if (!result || typeof result !== "object") return {};
    const details = (result as { details?: unknown }).details;
    if (!details || typeof details !== "object") return {};
    const source = details as Record<string, unknown>;
    return {
      serverId: typeof source.serverId === "string" ? source.serverId : undefined,
      serverName: typeof source.serverName === "string" ? source.serverName : undefined,
      remoteToolName: typeof source.remoteToolName === "string" ? source.remoteToolName : undefined
    };
  }

  private mcpSignalMatches(
    toolName: string,
    details: { serverId?: string; serverName?: string; remoteToolName?: string },
    signal: string
  ): boolean {
    const normalizedSignal = signal.trim().toLowerCase();
    if (!normalizedSignal) return false;
    const toolParts = toolName.startsWith("mcp__") ? toolName.split("__") : [];
    const candidates = [
      details.serverId,
      details.serverName,
      details.remoteToolName,
      toolParts[1],
      toolName
    ];
    return candidates
      .map((item) => item?.trim().toLowerCase())
      .some((item) => item === normalizedSignal);
  }

  private emitSkillSearchMatches(context: ToolCallTrackingContext): void {
    if (context.toolCall.name !== "skillSearch" || context.isError || !this.activeHookContext) return;
    const result = context.result;
    if (!result || typeof result !== "object") return;
    const details = (result as { details?: unknown }).details;
    if (!details || typeof details !== "object") return;
    const matches = (details as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) return;

    for (const match of matches) {
      if (!match || typeof match !== "object") continue;
      const { name, scope, filePath, score } = match as {
        name?: unknown;
        scope?: unknown;
        filePath?: unknown;
        score?: unknown;
      };
      if (typeof name !== "string" || typeof scope !== "string" || typeof filePath !== "string") continue;
      this.hookManager.emit("skill.selected", this.activeHookContext, {
        name,
        scope,
        filePath,
        reason: "search_match",
        ...(typeof score === "number" ? { score } : {})
      });
    }
  }

  private emitSkillSelection(skills: Array<{ name: string; scope: string; filePath: string; aliases?: string[] }>): void {
    if (!this.activeHookContext) return;
    for (const skill of skills) {
      this.hookManager.emit("skill.selected", this.activeHookContext, {
        name: skill.name,
        scope: skill.scope,
        filePath: skill.filePath,
        aliases: skill.aliases ?? []
      });
    }
  }

  emitSkillSelectionForTest(skills: Array<{ name: string; scope: string; filePath: string; aliases?: string[] }>): void {
    this.emitSkillSelection(skills);
  }

  setActiveRunSkillManifestForTest(skills: LoadedSkill[]): void {
    this.activeRunSkillManifest = new Map(
      skills.map((skill) => [pathCompareKey(skill.filePath), skill])
    );
  }

  markSkillLoadedForTest(skill: LoadedSkill): void {
    this.markSkillLoaded(skill);
  }

  getPendingReadPathCountForTest(): number {
    return this.pendingReadPaths.size;
  }

  private emitActiveModelCallAfter(
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    },
    stopReason?: string
  ): void {
    if (!this.activeHookContext || !this.activePayloadContext) return;
    const modelCallContext = this.activeModelCallContext ?? this.startActiveModelCallTrace();
    if (!modelCallContext) return;
    this.hookManager.emit("model.call.after", this.activeHookContext, {
      ...modelCallContext,
      provider: this.activePayloadContext.provider,
      model: this.activePayloadContext.model,
      api: this.activePayloadContext.api,
      usage,
      stopReason
    });
  }

  private startActiveModelCallTrace():
    | {
        modelAttemptId: string;
        candidateIndex: number;
        attemptIndex: number;
        modelCallSeq: number;
      }
    | undefined {
    if (!this.activeHookContext || !this.activeModelPromptContext) return undefined;
    this.modelCallSeq += 1;
    this.activeModelCallContext = {
      modelAttemptId: `${this.activeHookContext.runId}:${this.activeModelPromptContext.candidateIndex}:${this.activeModelPromptContext.attemptIndex}:${this.modelCallSeq}`,
      candidateIndex: this.activeModelPromptContext.candidateIndex,
      attemptIndex: this.activeModelPromptContext.attemptIndex,
      modelCallSeq: this.modelCallSeq
    };
    return this.activeModelCallContext;
  }
}
