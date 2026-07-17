import { type RuntimeSettings } from "$lib/server/settings/index.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import { applyChannelPlugins } from "$lib/server/plugins/loader.js";
import { getToolSandboxEnvStartupReport } from "$lib/server/agent/tools/sandbox.js";
import { config, liveServicesDisabled } from "$lib/server/app/env.js";
import { type ChannelManager } from "$lib/server/channels/registry.js";
import { collectDailyMaterialsBackfillInternals, collectMemoryReflectionInternals, resolveMemoryReflectionNotificationTarget, TaskScheduler, type InternalTaskExecutionResult } from "$lib/server/agent/taskScheduler.js";
import { executeOwnerMemoryReflection } from "$lib/server/agent/ownerMemoryReflection.js";
import { MessageRouter } from "$lib/server/channels/shared/messageRouter.js";
import { initDb, storagePaths } from "$lib/server/infra/db/storage.js";
import { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { PluginCatalog, ProviderPlugin } from "$lib/server/plugins/types.js";
import { AssistantService } from "$lib/server/providers/assistantService.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { getConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";
import { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { getHostBashStore, type HostBashStore } from "$lib/server/hostBash/index.js";
import { getWorkspaceStore } from "$lib/server/workspaces/store.js";
import { getTurnOrchestrator, SqliteTurnCleanupStore } from "$lib/server/agent/core/turnOrchestrator.js";
import { createDefaultHookManager, type HookManager } from "$lib/server/agent/hooks/index.js";
import { ensureGlobalProfileDefaults } from "$lib/server/agent/prompts/profiles.js";
import { MemoryReflectionService, ReflectionStateStore, SessionReflectionSourceReader, recommendedCandidateNamespace, type ReflectionExtractor, type ReflectionTarget } from "$lib/server/memory/reflection.js";
import { DailyMaterialsService, dailyMaterialsTargetId, type DailyMaterialsInternal } from "$lib/server/memory/dailyMaterials.js";
import { DailyMaterialsBackfillJob } from "$lib/server/app/dailyMaterialsBackfill.js";
import { MemoryMaintenanceService, MemoryMaintenanceStore, type MemoryMaintenanceTarget } from "$lib/server/memory/maintenance.js";
import type { MomEvent } from "$lib/server/agent/events.js";
import { getMemoryTraceStore } from "$lib/server/memory/traceStore.js";
import {
  configureConversationProjectionRuntime,
  loadStoredConversationMessages
} from "$lib/server/web/conversationProjection.js";

interface RuntimeState {
  sessions: SessionStore;
  router: MessageRouter;
  channelManagers: Map<string, Map<string, ChannelManager>>;
  pluginCatalog: PluginCatalog;
  providerPlugins: ProviderPlugin[];
  memory: MemoryGateway;
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

export function getRuntime(): RuntimeState {
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
    const hookManager = createDefaultHookManager({ settings });
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
    const currentSettings = { value: settings };
    const usageTracker = new AiUsageTracker();
    const modelErrorTracker = new ModelErrorTracker();
    const memory = new MemoryGateway(
      () => currentSettings.value,
      sessions,
      `${config.dataDir}/memory-governance/rejections.jsonl`
    );
    const assistant = new AssistantService(() => currentSettings.value, usageTracker, modelErrorTracker);
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
    const reflectionService = new MemoryReflectionService(
      memory,
      new SessionReflectionSourceReader(sessions, reflectionState, undefined, config.dataDir),
      reflectionState,
      reflectionExtractor
    );
    const maintenanceService = new MemoryMaintenanceService(
      memory,
      new MemoryMaintenanceStore(storagePaths.moryDbFile),
      (sourceEntryId) => Boolean(getMemoryTraceStore().getBySourceEntryId(sourceEntryId))
    );
    const dailyMaterialsService = new DailyMaterialsService(
      new SessionReflectionSourceReader(sessions, reflectionState, undefined, config.dataDir, dailyMaterialsTargetId),
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
    const sendInternalNotice = async (internal: NonNullable<MomEvent["internal"]>, text: string, filename: string, index: number): Promise<void> => {
      if (!internal.notificationChatId || !internal.target) return;
      const channel = internal.target.sourceScopes[0]?.channel;
      const manager = channel ? state.channelManagers.get(channel)?.get(internal.target.botId) : undefined;
      if (!manager?.triggerTask) return;
      await manager.triggerTask({ type: "immediate", chatId: internal.notificationChatId, text, delivery: "text" }, `${filename}:notification:${index}`);
    };
    const sendOwnerReflectionNotice = async (text: string, filename: string): Promise<void> => {
      const target = resolveMemoryReflectionNotificationTarget(currentSettings.value);
      if (!target) throw new Error("No authorized Feishu or Telegram reflection notification target is available.");
      const manager = state.channelManagers.get(target.channel)?.get(target.botId);
      if (!manager?.triggerTask) throw new Error(`Reflection notification target is unavailable: ${target.channel}/${target.botId}`);
      await manager.triggerTask({ type: "immediate", chatId: target.chatId, text, delivery: "text" }, `${filename}:owner-notification`);
    };
    const runInternalEvent = async (event: MomEvent, filename: string): Promise<InternalTaskExecutionResult | void> => {
      if (event.internal?.kind === "memory-reflection") {
        if (event.internal.target) {
          const result = await reflectionService.run(event.internal.target as ReflectionTarget);
          await maintenanceService.run(event.internal.target as MemoryMaintenanceTarget, { triggerKey: `reflection:${filename}:${event.internal.target.botId}` });
          console.log(`${memoryLabel("reflection")} completed file=${filename} candidates=${result.createdCandidates} messages=${result.scannedMessages}`);
          return {
            kind: "memory-reflection",
            completedTargets: 1,
            scannedConversations: result.scannedConversations,
            scannedMessages: result.scannedMessages,
            createdCandidates: result.createdCandidates,
            notificationText: result.createdCandidates > 0 ? `记忆反思完成：新增 ${result.createdCandidates} 条待确认记忆。` : undefined
          };
        }
        const result = await executeOwnerMemoryReflection(
          collectMemoryReflectionInternals(currentSettings.value),
          async (internal) => {
            const result = await reflectionService.run(internal.target as ReflectionTarget);
            if (internal.target) await maintenanceService.run(internal.target as MemoryMaintenanceTarget, { triggerKey: `reflection:${filename}:${internal.target.botId}` });
            console.log(`${memoryLabel("reflection")} completed file=${filename} target=${internal.target?.botId} candidates=${result.createdCandidates} messages=${result.scannedMessages}`);
            return result;
          },
          currentSettings.value.plugins.memory.reflectionNotifications
            ? (text) => sendOwnerReflectionNotice(text, filename)
            : undefined
        );
        return { kind: "memory-reflection", ...result };
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
          return {
            kind: "daily-materials",
            completedTargets: 1,
            scannedConversations: result.scannedConversations,
            scannedMessages: result.scannedMessages,
            createdFiles: result.createdFile ? [result.createdFile] : [],
            notificationText: result.createdFile ? `今日素材已生成：${result.createdFile}` : undefined
          };
        }
        const failures: unknown[] = [];
        let completedTargets = 0;
        let scannedConversations = 0;
        let scannedMessages = 0;
        const createdFiles: string[] = [];
        for (const [index, internal] of collectDailyMaterialsBackfillInternals(currentSettings.value).entries()) {
          try {
            const result = await dailyMaterialsService.run(internal as DailyMaterialsInternal, { taskId: event.taskId });
            completedTargets += 1;
            scannedConversations += result.scannedConversations;
            scannedMessages += result.scannedMessages;
            if (result.createdFile) createdFiles.push(result.createdFile);
            console.log(`${memoryLabel("daily-materials")} completed file=${filename} target=${internal.target?.botId} output=${result.createdFile ?? "(none)"} messages=${result.scannedMessages}`);
            if (result.createdFile) await sendInternalNotice(internal, `今日素材已生成：${result.createdFile}`, filename, index);
          } catch (cause) {
            failures.push(cause);
          }
        }
        if (failures.length > 0) throw new AggregateError(failures, `${failures.length} daily materials target(s) failed.`);
        return { kind: "daily-materials", completedTargets, scannedConversations, scannedMessages, createdFiles };
      }
      throw new Error("Unsupported internal event.");
    };
    const dailyMaterialsBackfill = new DailyMaterialsBackfillJob(dailyMaterialsService);
    const taskScheduler = new TaskScheduler(runInternalEvent);
    state = {
      sessions,
      router,
      channelManagers: new Map<string, Map<string, ChannelManager>>(),
      pluginCatalog: { channels: [], providers: [], features: [], memoryBackends: [] },
      providerPlugins: [],
      memory,
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
      runInternalEvent,
      hookManager,
      getSettings: () => state.settings,
      updateSettings: applySettingsPatch
    };

    state.settings = sanitizeSettings({}, state.settings);
    currentSettings.value = state.settings;
    logMemoryStartup(state);
    logSandboxEnvStartup(state);
    // Skip every long-lived/networked subsystem when live services are disabled
    // (node:test runs, or an explicit MOLIBOT_DISABLE_LIVE_CHANNELS opt-out).
    // Tests still get a fully usable runtime (settings/sessions/memory) but no
    // channel websockets, scheduler, or keep-alive interval — so the process
    // can exit cleanly instead of hanging on a retrying Feishu/Telegram client.
    if (!liveServicesDisabled()) {
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

    globalThis.__molibotRuntime = state;
    configureConversationProjectionRuntime(() => state);
    sessions.setMessageProjector((conversationId) => loadStoredConversationMessages(conversationId));
  }

  return globalThis.__molibotRuntime;
}
