import { type RuntimeSettings } from "$lib/server/settings/index.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import { applyChannelPlugins } from "$lib/server/plugins/loader.js";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { configureMiniAppSettings, getMiniAppHost } from "$lib/server/miniapps/registry.js";
import { ensureBuiltinMiniApps } from "$lib/server/miniapps/bootstrap.js";
import { ensureBuiltinSkills } from "$lib/server/agent/skills/bootstrap.js";
import { getToolSandboxEnvStartupReport } from "$lib/server/agent/tools/sandbox.js";
import { reconcileMcpServers } from "$lib/server/agent/tools/mcp.js";
import { config, liveServicesDisabled } from "$lib/server/app/env.js";
import { type ChannelManager } from "$lib/server/channels/registry.js";
import { collectDailyMaterialsBackfillInternals, collectMemoryReflectionInternals, deliverMemoryReviewBatch, deliverMemoryTaskNotification, formatDailyMaterialsNotification, resolveMemoryReflectionNotificationTarget, TaskScheduler, type InternalTaskExecutionResult } from "$lib/server/agent/taskScheduler.js";
import { executeOwnerMemoryReflection, formatOwnerMemoryReflectionNotification, OwnerMemoryReflectionError, type OwnerMemoryReflectionResult } from "$lib/server/agent/ownerMemoryReflection.js";
import { MessageRouter } from "$lib/server/channels/shared/messageRouter.js";
import { initDb, storagePaths } from "$lib/server/infra/db/storage.js";
import { recordRuntimeInitFailure, recordRuntimeReady } from "$lib/server/app/runtimeHealth.js";
import { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { PluginCatalog, ProviderPlugin } from "$lib/server/plugins/types.js";
import { AssistantService } from "$lib/server/providers/assistantService.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { getSessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { SessionAutoArchiveStore } from "$lib/server/sessions/sessionAutoArchiveStore.js";
import { SessionAutoArchiveService } from "$lib/server/sessions/sessionAutoArchiveService.js";
import { SessionTrashCleanupService } from "$lib/server/sessions/sessionTrashCleanup.js";
import { buildProductionSessionLifecycle, buildSessionTrashCleanup } from "$lib/server/app/sessionMaintenance.js";
import { SessionBulkStore } from "$lib/server/sessions/sessionBulkStore.js";
import { SessionBulkService } from "$lib/server/sessions/sessionBulkService.js";
import { SessionExtractionStore } from "$lib/server/sessions/sessionExtractionStore.js";
import {
  SessionExtractionService,
  type ExtractionOutput,
  type SessionExtractionExtractor
} from "$lib/server/sessions/sessionExtractionService.js";
import { getConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { effectiveMcpServers } from "$lib/server/settings/openConnector.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";
import { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { getHostBashStore, type HostBashStore } from "$lib/server/hostBash/index.js";
import { getWorkspaceStore } from "$lib/server/workspaces/store.js";
import { getTurnOrchestrator, SqliteTurnCleanupStore } from "$lib/server/agent/core/turnOrchestrator.js";
import { createDefaultHookManager, type HookManager } from "$lib/server/agent/hooks/index.js";
import { ensureGlobalProfileDefaults } from "$lib/server/agent/prompts/profiles.js";
import { MemoryReflectionService, ReflectionStateStore, SessionReflectionSourceReader, previousReflectionLocalDate, recommendedCandidateNamespace, type ReflectionExtractor, type ReflectionTarget } from "$lib/server/memory/reflection.js";
import { MemoryCandidateReview, MemoryReviewStore } from "$lib/server/memory/review.js";
import { DailyMaterialsService, dailyMaterialsTargetId, type DailyMaterialsInternal } from "$lib/server/memory/dailyMaterials.js";
import { DailyMaterialsBackfillJob } from "$lib/server/app/dailyMaterialsBackfill.js";
import { MemoryMaintenanceService, MemoryMaintenanceStore, type MemoryMaintenanceTarget } from "$lib/server/memory/maintenance.js";
import type { MomEvent } from "$lib/server/agent/events.js";
import { DurableExecutionRuntime } from "$lib/server/agent/durable/runtime.js";
import { getMemoryTraceStore } from "$lib/server/memory/traceStore.js";
import {
  configureConversationProjectionRuntime,
  loadStoredConversationMessages
} from "$lib/server/web/conversationProjection.js";

interface RuntimeState {
  sessions: SessionStore;
  sessionLifecycle: SessionLifecycleService;
  router: MessageRouter;
  channelManagers: Map<string, Map<string, ChannelManager>>;
  pluginCatalog: PluginCatalog;
  providerPlugins: ProviderPlugin[];
  memory: MemoryGateway;
  memoryReviewStore: MemoryReviewStore;
  memoryReview: MemoryCandidateReview;
  memorySyncTimer: ReturnType<typeof setInterval> | null;
  settingsStore: SettingsStore;
  hostBashStore: HostBashStore;
  settings: RuntimeSettings;
  usageTracker: AiUsageTracker;
  modelErrorTracker: ModelErrorTracker;
  taskScheduler: TaskScheduler;
  reflectionState: ReflectionStateStore;
  reflectionService: MemoryReflectionService;
  maintenanceService: MemoryMaintenanceService;
  dailyMaterialsService: DailyMaterialsService;
  dailyMaterialsBackfill: DailyMaterialsBackfillJob;
  sessionAutoArchive: SessionAutoArchiveService;
  sessionTrashCleanup: SessionTrashCleanupService;
  sessionBulk: SessionBulkService;
  sessionExtraction: SessionExtractionService;
  runInternalEvent: (event: MomEvent, filename: string) => Promise<{ notificationText?: string } | void>;
  hookManager: HookManager;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

declare global {
  // eslint-disable-next-line no-var
  var __molibotRuntime: RuntimeState | undefined;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RED = "\x1b[31m";

function color(text: string, code: string): string {
  return `${code}${text}${ANSI_RESET}`;
}

function colorStatus(status: string): string {
  if (status === "active") return color(status, ANSI_GREEN);
  if (status === "error") return color(status, ANSI_RED);
  if (status === "discovered") return color(status, ANSI_YELLOW);
  return status;
}

function runtimeLabel(name: string): string {
  return color(`[${name}]`, `${ANSI_BOLD}${ANSI_CYAN}`);
}

function memoryLabel(name: string): string {
  return color(`[${name}]`, `${ANSI_BOLD}${ANSI_BLUE}`);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function logMemoryStartup(state: RuntimeState): void {
  console.log(
    `${memoryLabel("memory")} startup enabled=${state.memory.isEnabled() ? color("true", ANSI_GREEN) : color("false", ANSI_YELLOW)} selected_backend=${color(state.memory.getActiveBackendKey(), `${ANSI_BOLD}${ANSI_GREEN}`)} available_backends=[${formatList(state.memory.listAvailableBackendKeys())}] importers=[${formatList(state.memory.listImporterKeys())}]`
  );
}

function logSandboxEnvStartup(state: RuntimeState): void {
  const report = getToolSandboxEnvStartupReport(state.settings.toolSandbox, config.webWorkspaceDir);
  const prefix = `${runtimeLabel("runtime")} sandbox_env`;
  console.log(
    `${prefix} enabled=${report.enabled ? color("true", ANSI_GREEN) : color("false", ANSI_YELLOW)} env_file=${report.envFilePath} injected=[${formatList(report.envKeysInjected)}]`
  );
  if (report.envKeysMissing.length > 0) {
    console.warn(
      `${prefix} ${color("missing_allowlist", `${ANSI_BOLD}${ANSI_YELLOW}`)} keys=[${formatList(report.envKeysMissing)}]`
    );
  }
}

/**
 * Builds the runtime on first use and reports readiness.
 *
 * The wrapper exists so that *every* path into the runtime — an API request, a
 * channel callback, the health probe — records whether initialisation worked.
 * Without it a failed bootstrap is only visible as a 503 on whichever request
 * happened to trigger it, which is how a service could sit wedged behind a
 * green handshake for hours. Never call `initializeRuntime` directly.
 */
export function getRuntime(): RuntimeState {
  try {
    const state = initializeRuntime();
    recordRuntimeReady();
    return state;
  } catch (error) {
    recordRuntimeInitFailure(error);
    throw error;
  }
}

function initializeRuntime(): RuntimeState {
  if (!globalThis.__molibotRuntime) {
    initDb();
    ensureGlobalProfileDefaults();
    getWorkspaceStore().ensureDefaultWorkspace();

    try {
      const cleanupStore = new SqliteTurnCleanupStore();
      const cleaned = getTurnOrchestrator().cleanupStaleRunningTurns(cleanupStore, { forceAll: true });
      if (cleaned > 0) {
        console.log(`[runtime] Cleaned up ${cleaned} stale running turns on startup.`);
      }
      cleanupStore.close();
    } catch (e) {
      console.error("[runtime] Failed to cleanup stale running turns:", e);
    }

    const settingsStore = new SettingsStore();
    const settings = settingsStore.load();
    // Live settings holder: hooks and services must read the current snapshot,
    // not the one captured at boot (settings patches replace `state.settings`).
    const currentSettings = { value: settings };
    const hookManager = createDefaultHookManager({
      settings,
      getSettings: () => currentSettings.value
    });
    const hostBashStore = getHostBashStore();
    hostBashStore.migrateLegacySettings(settings.hostTools);
    if (
      settings.hostTools.pendingApprovals.length > 0 ||
      settings.hostTools.approvalHistory.length > 0 ||
      settings.hostTools.approvedTools.length > 0
    ) {
      settingsStore.save(settings);
    }

    const sessions = new SessionStore();
    sessions.setConversationSearchIndex(getConversationSearchIndex(storagePaths.moryDbFile), "web");
    // T9 managed extraction: receipts live in the Session-owned store
    // (sessions.db) so the managed list can derive per-Session status and
    // the processed-but-not-archived filter without a second index.
    const sessionExtractionStore = new SessionExtractionStore(storagePaths.sessionsDbFile);
    // Production lifecycle assembly: authorized search projection, read-only
    // external-channel projection and the real busy probe (live runner turns,
    // pending approvals, nonterminal linked tasks) — archive/delete genuinely
    // refuse busy targets instead of a constant-false probe.
    const sessionLifecycle = buildProductionSessionLifecycle({ sessions, extraction: sessionExtractionStore });
    sessions.setSessionActivitySink(sessionLifecycle);
    // T6 automatic archive: the sweep reuses the same mutation service as
    // manual archive and persists progress in the Session-owned store.
    const sessionAutoArchive = new SessionAutoArchiveService({
      lifecycle: sessionLifecycle,
      runs: new SessionAutoArchiveStore(storagePaths.sessionsDbFile)
    });
    // T7 management bulk engine: immutable all-matching selections plus
    // idempotent per-item execution through the same lifecycle service as
    // manual operations. Durable in the Session-owned store (sessions.db).
    const sessionBulk = new SessionBulkService({
      lifecycle: sessionLifecycle,
      lifecycleRows: getSessionLifecycleStore(),
      bulk: new SessionBulkStore(storagePaths.sessionsDbFile)
    });
    // T4 expired trash: purge + startup reconciliation ride the watched-event
    // JSON + Runtime dispatcher with the same mechanism as auto-archive, over
    // Session-owned data only (UI file, Agent Context, search projection).
    const sessionTrashCleanup = buildSessionTrashCleanup(sessions);
    // T5 inbound衔接:归档新消息同身份恢复、trash 走新建. Channel 只收发,
    // 决策统一在这里装配;浏览路径不经过该策略,不恢复归档.
    sessions.setInboundLifecyclePolicy({
      peekState: (conversationId, requesterExternalUserId) =>
        sessionLifecycle.peekLifecycleState(conversationId, requesterExternalUserId),
      resumeForInbound: (conversationId, requesterExternalUserId) => {
        sessionLifecycle.resumeForInboundMessage({ conversationId, requesterExternalUserId });
      }
    });
    const usageTracker = new AiUsageTracker();
    const modelErrorTracker = new ModelErrorTracker();
    const memory = new MemoryGateway(
      () => currentSettings.value,
      sessions,
      `${config.dataDir}/memory-governance/rejections.jsonl`
    );
    const assistant = new AssistantService(() => currentSettings.value, usageTracker, modelErrorTracker);
    // T9 managed extraction: same assistant-reply + JSON pattern as the
    // reflection extractor. The model proposes memories/artifact links; the
    // T8 service validates, routes namespaces and records durable receipts.
    // No document saver is wired: transcript-only artifact proposals fail
    // that sibling explicitly instead of claiming preservation, and the
    // archive gate blocks archiving while anything is unsaved or pending.
    const sessionExtractor: SessionExtractionExtractor = async (input) => {
      const transcript = input.messages
        .map((message) => `${message.role} [${message.createdAt}]: ${message.content}`)
        .join("\n");
      const prompt = [
        "Extract durable information from this Session transcript for long-term memory.",
        "Return JSON only: {\"noUsefulInformation\":false,\"memories\":[{\"domain\":\"owner|project|agent_self|content\",\"type\":\"user_preference|user_fact|skill|event|task|world_knowledge\",\"subject\":\"stable_snake_case\",\"value\":\"complete durable statement\",\"confidence\":0.0-1.0,\"reason\":\"why it matters\"}],\"artifactLinks\":[{\"artifactId\":\"existing artifact id\",\"title\":\"optional title\"}],\"artifactSaves\":[{\"title\":\"...\",\"content\":\"...\"}]}",
        "Rules: only stable preferences, facts, project decisions and complete artifacts — never reminders, transient execution state, guesses, or secrets. Reference existing artifacts via artifactLinks (never recopy them into a memory). Propose artifactSaves only when a complete result exists solely in the transcript and deserves its own document. When nothing is worth keeping, return exactly {\"noUsefulInformation\":true}.",
        `Session: ${input.sessionId} (channel ${input.channel}${input.projectId ? `, project ${input.projectId}` : ""})`,
        transcript || "(no eligible messages)"
      ].join("\n\n");
      const response = await assistant.reply(
        [
          {
            id: `session-extract:${input.conversationId}`,
            conversationId: input.conversationId,
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString()
          }
        ],
        prompt
      );
      const raw = response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? response;
      // A throw here is intentional: malformed model output must surface as
      // a failed extraction, never as proof of nothing-to-save.
      return JSON.parse(raw) as ExtractionOutput;
    };
    const sessionExtraction = new SessionExtractionService({
      sessions,
      lifecycle: sessionLifecycle,
      lifecycleRows: getSessionLifecycleStore(),
      store: sessionExtractionStore,
      gateway: {
        createCandidate: (candidateInput) => memory.createCandidate(candidateInput),
        maybeAutoConfirmCandidate: (id) => memory.maybeAutoConfirmCandidate(id),
        getCandidate: (id) => memory.getCandidate(id),
        isPrivacySuppressed: (candidateInput) => memory.isPrivacySuppressed(candidateInput)
      },
      extractor: sessionExtractor,
      ownerId: "owner",
      botId: "web"
    });
    memory.setProfileSummarizer(async (profile) => {
      const lines = [...profile.stablePreferences, ...profile.profileFacts, ...profile.currentFocus]
        .map((record) => `- [${record.type}] ${record.content.replace(/\s+/g, " ").trim()}`)
        .join("\n");
      const prompt = [
        "Synthesize the memory records below into a second-person user profile of 2-4 flowing sentences (\"你…\").",
        "Write in the language most of the records use (Simplified Chinese when mixed). Merge related records, keep concrete specifics such as names, numbers, and dates, and never invent information.",
        "Return only the profile text — no lists, no headings, no preamble.",
        lines
      ].join("\n\n");
      return assistant.reply([{
        id: `profile-summary:${profile.meta.fingerprint}`,
        conversationId: `profile-summary:${profile.meta.scope.botId}`,
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString()
      }], prompt);
    });
    const router = new MessageRouter(sessions, assistant, memory);
    const applySettingsPatch = (patch: Partial<RuntimeSettings>): RuntimeSettings => {
      // Always merge patches on top of the latest persisted settings snapshot.
      // This prevents stale in-memory runtime copies (for example another long-lived dev process)
      // from overwriting newer channel/provider data with historical values.
      const latestPersisted = state.settingsStore.load();
      state.settings = sanitizeSettings(patch, latestPersisted);
      currentSettings.value = state.settings;
      state.settingsStore.save(state.settings);
      if (!liveServicesDisabled()) {
        applyChannelPlugins(state, applySettingsPatch);
        state.taskScheduler.restart(state.channelManagers, state.settings);
      }
      return state.settings;
    };

    const reflectionState = new ReflectionStateStore(storagePaths.moryDbFile);
    const memoryReviewStore = new MemoryReviewStore(storagePaths.moryDbFile);
    const memoryReview = new MemoryCandidateReview(memory, memoryReviewStore);
    const reflectionExtractor: ReflectionExtractor = {
      extract: async ({ target, projection, relatedMemories }) => {
        const transcript = projection.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
        const related = relatedMemories.map((memory) =>
          `${memory.ref} | ${memory.namespace} | ${memory.type}/${memory.subject} | ${memory.path} | ${memory.summary}`
        ).join("\n");
        const prompt = [
          "Classify durable information as: a new fact, an evolution that supersedes one related memory, or a contradiction that disputes one related memory.",
          "Return JSON only: {\"memories\":[{\"domain\":\"owner|project|agent_self|content\",\"type\":\"user_preference|user_fact|skill|event|task|world_knowledge\",\"subject\":\"stable_snake_case\",\"value\":\"complete durable statement\",\"confidence\":0.0,\"reason\":\"why it matters\",\"supersedesRef\":\"R1 optional\",\"disputesRef\":\"R2 optional\"}]}",
          "Use only the supplied R tokens. Never copy or invent internal IDs. For supersedes, the server will inherit namespace, type, subject and canonical path from the referenced record.",
          "Do not extract reminders, transient execution state, guesses, or the summary itself.",
          related ? `Authorized related memories:\n${related}` : "Authorized related memories: (none)",
          projection.latestSummary ? `Recent summary (context only): ${projection.latestSummary}` : "",
          transcript
        ].filter(Boolean).join("\n\n");
        const response = await assistant.reply([{
          id: `reflection:${projection.conversationId}`,
          conversationId: projection.conversationId,
          role: "user",
          content: prompt,
          createdAt: new Date().toISOString()
        }], prompt);
        const raw = response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? response;
        const parsed = JSON.parse(raw) as { memories?: Array<Record<string, unknown>> };
        if (!Array.isArray(parsed.memories)) throw new Error("Reflection extractor returned invalid JSON.");
        return parsed.memories.map((item) => {
          const domain = String(item.domain ?? "owner") as "owner" | "project" | "agent_self" | "content";
          const type = String(item.type ?? "user_fact") as "user_preference" | "user_fact" | "skill" | "event" | "task" | "world_knowledge";
          const subject = String(item.subject ?? "").trim();
          return {
            namespace: recommendedCandidateNamespace(target, projection.scope, domain),
            domain,
            type,
            subject,
            path: `mory://${type}/${subject}`,
            value: String(item.value ?? ""),
            confidence: Number(item.confidence ?? 0.7),
            reason: String(item.reason ?? "reflection"),
            layer: type === "event" ? "daily" as const : "long_term" as const,
            supersedesRef: typeof item.supersedesRef === "string" ? item.supersedesRef : undefined,
            disputesRef: typeof item.disputesRef === "string" ? item.disputesRef : undefined
          };
        });
      }
    };
    const reflectionTrashExcluded = (conversationId: string): boolean =>
      getSessionLifecycleStore().get(conversationId)?.state === "trashed";
    const reflectionService = new MemoryReflectionService(
      memory,
      new SessionReflectionSourceReader(sessions, reflectionState, undefined, config.dataDir, undefined, reflectionTrashExcluded),
      reflectionState,
      reflectionExtractor
    );
    const maintenanceService = new MemoryMaintenanceService(
      memory,
      new MemoryMaintenanceStore(storagePaths.moryDbFile),
      (sourceEntryId) => Boolean(getMemoryTraceStore().getBySourceEntryId(sourceEntryId))
    );
    const dailyMaterialsService = new DailyMaterialsService(
      new SessionReflectionSourceReader(sessions, reflectionState, undefined, config.dataDir, dailyMaterialsTargetId, reflectionTrashExcluded),
      reflectionState,
      (prompt) => assistant.reply([{
        id: `daily-materials:${Date.now()}`,
        conversationId: "daily-materials",
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString()
      }], prompt, "", { modelKey: currentSettings.value.plugins.memory.dailyMaterials.scanModelKey })
    );
    let state!: RuntimeState;
    let durableExecutionRuntime!: DurableExecutionRuntime;
    const sendMemoryNotice = async (
      text: string,
      kind: "memory-reflection" | "daily-materials",
      filename: string
    ): Promise<void> => {
      await deliverMemoryTaskNotification(state.channelManagers, currentSettings.value, text, { kind, filename });
    };
    const deliverReflectionReview = async (result: OwnerMemoryReflectionResult, filename: string): Promise<void> => {
      const target = resolveMemoryReflectionNotificationTarget(currentSettings.value);
      if (!target) return;
      const localDate = result.localDate || previousReflectionLocalDate(new Date(), currentSettings.value.timezone);
      const batch = memoryReview.createDailyBatch({
        ownerId: "owner",
        localDate,
        target,
        candidateIds: result.pendingReviewCandidateIds
      });
      await sendMemoryNotice(formatOwnerMemoryReflectionNotification(result, {
        pendingReviewCount: batch.items.length,
        skillDraftCount: batch.skillDraftCount
      }), "memory-reflection", filename);
      const delivery = await deliverMemoryReviewBatch(state.channelManagers, memoryReview, batch);
      console.log(
        `${memoryLabel("reflection-review")} date=${localDate} delivered=${delivery.delivered} existing=${delivery.alreadyDelivered} skipped=${delivery.skipped} skill_drafts=${batch.skillDraftCount}`
      );
    };
    const runInternalEvent = async (event: MomEvent, filename: string): Promise<InternalTaskExecutionResult | void> => {
      if (event.internal?.kind === "durable-execution") {
        return durableExecutionRuntime.run(event, filename);
      }
      if (event.internal?.kind === "memory-reflection") {
        if (event.internal.target) {
          const result = await reflectionService.run(event.internal.target as ReflectionTarget);
          await maintenanceService.run(event.internal.target as MemoryMaintenanceTarget, { triggerKey: `reflection:${filename}:${event.internal.target.botId}` });
          console.log(`${memoryLabel("reflection")} completed file=${filename} candidates=${result.createdCandidates} messages=${result.scannedMessages}`);
          if (currentSettings.value.plugins.memory.reflectionNotifications) {
            await deliverReflectionReview({
              completedTargets: 1,
              scannedConversations: result.scannedConversations,
              scannedMessages: result.scannedMessages,
              createdCandidates: result.createdCandidates,
              pendingReviewCandidateIds: result.pendingReviewCandidateIds,
              localDate: result.localDate,
              failedTargets: 0
            }, filename);
          }
          return {
            kind: "memory-reflection",
            completedTargets: 1,
            scannedConversations: result.scannedConversations,
            scannedMessages: result.scannedMessages,
            createdCandidates: result.createdCandidates
          };
        }
        let result: OwnerMemoryReflectionResult;
        try {
          result = await executeOwnerMemoryReflection(
            collectMemoryReflectionInternals(currentSettings.value),
            async (internal) => {
              const targetResult = await reflectionService.run(internal.target as ReflectionTarget);
              if (internal.target) await maintenanceService.run(internal.target as MemoryMaintenanceTarget, { triggerKey: `reflection:${filename}:${internal.target.botId}` });
              console.log(`${memoryLabel("reflection")} completed file=${filename} target=${internal.target?.botId} candidates=${targetResult.createdCandidates} messages=${targetResult.scannedMessages}`);
              return targetResult;
            }
          );
        } catch (cause) {
          if (cause instanceof OwnerMemoryReflectionError && currentSettings.value.plugins.memory.reflectionNotifications) {
            await deliverReflectionReview(cause.result, filename);
          }
          throw cause;
        }
        if (currentSettings.value.plugins.memory.reflectionNotifications) await deliverReflectionReview(result, filename);
        return {
          kind: "memory-reflection",
          completedTargets: result.completedTargets,
          scannedConversations: result.scannedConversations,
          scannedMessages: result.scannedMessages,
          createdCandidates: result.createdCandidates
        };
      }
      if (event.internal?.kind === "memory-maintenance") {
        const internals = event.internal.target ? [event.internal] : collectMemoryReflectionInternals(currentSettings.value);
        let completedTargets = 0;
        let archivedCount = 0;
        let dormantCount = 0;
        let compactRemovedCount = 0;
        let reviewDuplicateCount = 0;
        for (const internal of internals) {
          if (!internal.target) continue;
          const result = await maintenanceService.run(internal.target as MemoryMaintenanceTarget, { triggerKey: `periodic:${filename}:${internal.target.botId}` });
          if (result.status !== "skipped") completedTargets += 1;
          archivedCount += result.archivedCount;
          dormantCount += result.dormantCount;
          compactRemovedCount += result.compactRemovedCount;
          reviewDuplicateCount += result.reviewDuplicateCount;
        }
        return { kind: "memory-maintenance", completedTargets, archivedCount, dormantCount, compactRemovedCount, reviewDuplicateCount };
      }
      if (event.internal?.kind === "daily-materials") {
        if (event.internal.target) {
          const result = await dailyMaterialsService.run(event.internal as DailyMaterialsInternal, { taskId: event.taskId });
          console.log(`${memoryLabel("daily-materials")} completed file=${filename} output=${result.createdFile ?? "(none)"} messages=${result.scannedMessages}`);
          const notificationText = formatDailyMaterialsNotification(result.createdFile ? [result.createdFile] : []);
          if (notificationText && currentSettings.value.plugins.memory.dailyMaterials.notifications) {
            await sendMemoryNotice(notificationText, "daily-materials", filename);
          }
          return {
            kind: "daily-materials",
            completedTargets: 1,
            scannedConversations: result.scannedConversations,
            scannedMessages: result.scannedMessages,
            createdFiles: result.createdFile ? [result.createdFile] : []
          };
        }
        const failures: unknown[] = [];
        let completedTargets = 0;
        let scannedConversations = 0;
        let scannedMessages = 0;
        const createdFiles: string[] = [];
        for (const internal of collectDailyMaterialsBackfillInternals(currentSettings.value)) {
          try {
            const result = await dailyMaterialsService.run(internal as DailyMaterialsInternal, { taskId: event.taskId });
            completedTargets += 1;
            scannedConversations += result.scannedConversations;
            scannedMessages += result.scannedMessages;
            if (result.createdFile) createdFiles.push(result.createdFile);
            console.log(`${memoryLabel("daily-materials")} completed file=${filename} target=${internal.target?.botId} output=${result.createdFile ?? "(none)"} messages=${result.scannedMessages}`);
          } catch (cause) {
            failures.push(cause);
          }
        }
        if (failures.length > 0) throw new AggregateError(failures, `${failures.length} daily materials target(s) failed.`);
        const notificationText = formatDailyMaterialsNotification(createdFiles);
        if (notificationText && currentSettings.value.plugins.memory.dailyMaterials.notifications) {
          await sendMemoryNotice(notificationText, "daily-materials", filename);
        }
        return { kind: "daily-materials", completedTargets, scannedConversations, scannedMessages, createdFiles };
      }
      if (event.internal?.kind === "session-auto-archive") {
        // Daily maintenance sweep: no user-visible session is created and no
        // per-session notification is sent — the last-run result is served to
        // management from the owning store. The switch governs archiving
        // only; trash expiry is never touched here.
        const result = sessionAutoArchive.runSweep(currentSettings.value.sessionAutoArchive);
        console.log(
          `[session-auto-archive] completed file=${filename} candidates=${result.candidateCount} archived=${result.archivedCount} skipped=${result.skippedCount} failed=${result.failedCount}`
        );
        return { kind: "session-auto-archive" };
      }
      if (event.internal?.kind === "session-trash-expiry") {
        // Expired-trash purge: same watched-event + dispatcher mechanism as
        // the auto-archive sweep. Reconciliation retries recorded cleanup
        // intents first, then purges trash past the 30-day recovery period.
        // Partial failures stay as recoverable work and never resurrect.
        const outcomes = sessionTrashCleanup.reconcilePending();
        const purged = outcomes.filter((item) => item.status === "succeeded").length;
        const failed = outcomes.filter((item) => item.status === "failed").length;
        console.log(
          `[session-trash-expiry] completed file=${filename} total=${outcomes.length} purged=${purged} failed=${failed}`
        );
        return { kind: "session-trash-expiry" };
      }
      throw new Error("Unsupported internal event.");
    };
    const dailyMaterialsBackfill = new DailyMaterialsBackfillJob(dailyMaterialsService);
    const taskScheduler = new TaskScheduler(runInternalEvent, (event, filename, reason) => {
      durableExecutionRuntime?.handleSkippedEvent(event, reason);
      momLog("runtime", "internal_event_skipped", { filename, reason, kind: event.internal?.kind });
    });
    state = {
      sessions,
      sessionLifecycle,
      router,
      channelManagers: new Map<string, Map<string, ChannelManager>>(),
      pluginCatalog: { channels: [], providers: [], features: [], memoryBackends: [], extensions: [], miniApps: [] },
      providerPlugins: [],
      memory,
      memoryReviewStore,
      memoryReview,
      memorySyncTimer: null,
      settingsStore,
      hostBashStore,
      settings,
      usageTracker,
      modelErrorTracker,
      taskScheduler,
      reflectionState,
      reflectionService,
      maintenanceService,
      dailyMaterialsService,
      dailyMaterialsBackfill,
      sessionAutoArchive,
      sessionBulk,
      sessionTrashCleanup,
      sessionExtraction,
      runInternalEvent,
      hookManager,
      getSettings: () => state.settings,
      updateSettings: applySettingsPatch
    };

    durableExecutionRuntime = new DurableExecutionRuntime({
      channelManagers: state.channelManagers,
      leaseDurationMs: state.settings.events.executionTimeoutMs
    });
    const recoveredDurableAttempts = durableExecutionRuntime.reconcile();
    const queuedDurableEvents = durableExecutionRuntime.ensureQueuedEvents("owner");
    if (recoveredDurableAttempts > 0 || queuedDurableEvents > 0) {
      console.log(`[runtime] durable_execution_reconciled attempts=${recoveredDurableAttempts} queued_events=${queuedDurableEvents}`);
    }
    // Startup reconciliation for expired trash: retries recorded cleanup
    // intents from an interrupted purge, then sweeps trash past the recovery
    // deadline — downtime never leaves expired sessions behind.
    try {
      const trashRecovered = state.sessionTrashCleanup.reconcilePending();
      if (trashRecovered.length > 0) {
        const purged = trashRecovered.filter((item) => item.status === "succeeded").length;
        console.log(`[runtime] session_trash_reconciled total=${trashRecovered.length} purged=${purged}`);
      }
    } catch (error) {
      console.error("[runtime] session_trash_reconcile_failed", error);
    }

    state.settings = sanitizeSettings({}, state.settings);
    currentSettings.value = state.settings;

    // Mini Apps belong to base runtime initialization, not to the live-services
    // branch: they are neither a network service nor a long-lived connection,
    // and tests need a fully usable host (catalog, tools, HTTP) without starting
    // channels or the scheduler.
    configureMiniAppSettings({
      getSettings: () => currentSettings.value,
      updateSettings: applySettingsPatch,
      usageTracker
    });
    // Bootstrap has to run *before* discovery, or the shipped Todo app would
    // only appear on the second start.
    try {
      const bootstrapped = ensureBuiltinMiniApps({
        codeRoot: storagePaths.miniAppCodeDir,
        getEnablement: () => currentSettings.value.plugins?.miniApps?.entries ?? {}
      });
      if (bootstrapped.installed.length > 0) {
        console.log(`${runtimeLabel("runtime")} miniapp_bootstrap installed=[${formatList(bootstrapped.installed)}]`);
      }
    } catch (error) {
      console.error("[runtime] Failed to bootstrap built-in Mini Apps:", error);
    }
    getMiniAppHost().refresh();

    // Built-in Skills are materialised for the same reason built-in Mini Apps
    // are: the Skill loader only reads the owner's workspace, so a Skill that
    // ships with Molibot is invisible until it exists on disk there.
    try {
      const bootstrappedSkills = ensureBuiltinSkills({ skillsRoot: storagePaths.globalSkillsDir });
      if (bootstrappedSkills.installed.length > 0) {
        console.log(`${runtimeLabel("runtime")} skill_bootstrap installed=[${formatList(bootstrappedSkills.installed)}]`);
      }
      for (const upgrade of bootstrappedSkills.upgraded) {
        // A backup means the owner's copy had diverged and was moved aside, not
        // deleted. That path is the only way back to their edits, so it must be
        // in the log rather than only in the return value.
        console.log(
          `${runtimeLabel("runtime")} skill_upgraded id=${upgrade.id} ${upgrade.from} -> ${upgrade.to}`
          + (upgrade.backupDir ? ` previous_copy_kept_at=${upgrade.backupDir}` : "")
        );
      }
    } catch (error) {
      console.error("[runtime] Failed to bootstrap built-in Skills:", error);
    }

    logMemoryStartup(state);
    logSandboxEnvStartup(state);
    // Skip every long-lived/networked subsystem when live services are disabled
    // (node:test runs, or an explicit MOLIBOT_DISABLE_LIVE_CHANNELS opt-out).
    // Tests still get a fully usable runtime (settings/sessions/memory) but no
    // channel websockets, scheduler, or keep-alive interval — so the process
    // can exit cleanly instead of hanging on a retrying Feishu/Telegram client.
    if (!liveServicesDisabled()) {
      void reconcileMcpServers(effectiveMcpServers(state.settings), {
        workspaceDir: config.webWorkspaceDir,
        connectEnabled: true
      }).catch((error) => {
        console.error(`${runtimeLabel("runtime")} mcp_startup_reconcile_failed`, error);
      });
      void state.memory.syncExternalMemories()
        .then((result) => {
          console.log(
            `${memoryLabel("memory")} startup_sync scanned_files=${color(String(result.scannedFiles), ANSI_CYAN)} imported=${color(String(result.importedCount), result.importedCount > 0 ? ANSI_GREEN : ANSI_YELLOW)}`
          );
        })
        .catch((error) => {
          console.error(`${memoryLabel("memory")} ${color("startup_sync_failed", `${ANSI_BOLD}${ANSI_RED}`)}`, error);
        });
      state.memorySyncTimer = setInterval(() => {
        void state.memory.syncExternalMemories()
          .then((result) => {
            if (result.scannedFiles > 0 || result.importedCount > 0) {
              console.log(
                `${memoryLabel("memory")} periodic_sync scanned_files=${color(String(result.scannedFiles), ANSI_CYAN)} imported=${color(String(result.importedCount), result.importedCount > 0 ? ANSI_GREEN : ANSI_YELLOW)}`
              );
            }
          })
          .catch((error) => {
            console.error(`${memoryLabel("memory")} ${color("periodic_sync_failed", `${ANSI_BOLD}${ANSI_RED}`)}`, error);
          });
      }, 60_000);
      applyChannelPlugins(state, applySettingsPatch);
      state.taskScheduler.start(state.channelManagers, state.settings);
    }

    // Third-party pi extensions load off the critical path: a slow or broken
    // extension must not delay startup. Deliberately outside the
    // liveServicesDisabled branch — extensions are not a network service, and a
    // turn that starts before this finishes would otherwise silently run
    // without their tools (the runner awaits the same promise as a backstop).
    void getPiExtensionHost().load()
      .then(() => getPiExtensionHost().applyFlagValues(currentSettings.value))
      .catch(() => undefined);

    globalThis.__molibotRuntime = state;
    configureConversationProjectionRuntime(() => state);
    sessions.setMessageProjector((conversationId) => loadStoredConversationMessages(conversationId));
  }

  return globalThis.__molibotRuntime;
}
