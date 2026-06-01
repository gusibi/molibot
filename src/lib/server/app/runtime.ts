import { type RuntimeSettings } from "$lib/server/settings/index.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import { applyChannelPlugins } from "$lib/server/plugins/loader.js";
import { getToolSandboxEnvStartupReport } from "$lib/server/agent/tools/sandbox.js";
import { config } from "$lib/server/app/env.js";
import { type ChannelManager } from "$lib/server/channels/registry.js";
import { TaskScheduler } from "$lib/server/agent/taskScheduler.js";
import { MessageRouter } from "$lib/server/channels/shared/messageRouter.js";
import { initDb } from "$lib/server/infra/db/storage.js";
import { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { PluginCatalog, ProviderPlugin } from "$lib/server/plugins/types.js";
import { AssistantService } from "$lib/server/providers/assistantService.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";
import { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { getHostBashStore, type HostBashStore } from "$lib/server/hostBash/index.js";
import { getWorkspaceStore } from "$lib/server/workspaces/store.js";
import { getTurnOrchestrator, SqliteTurnCleanupStore } from "$lib/server/agent/core/turnOrchestrator.js";

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
      applyChannelPlugins(state, applySettingsPatch);
      state.taskScheduler.restart(state.channelManagers, state.settings);
      return state.settings;
    };

    const state: RuntimeState = {
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
      taskScheduler: new TaskScheduler(),
      getSettings: () => state.settings,
      updateSettings: applySettingsPatch
    };

    state.settings = sanitizeSettings({}, state.settings);
    currentSettings.value = state.settings;
    logMemoryStartup(state);
    logSandboxEnvStartup(state);
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

    globalThis.__molibotRuntime = state;
  }

  return globalThis.__molibotRuntime;
}
