import { discoverPlugins } from "$lib/server/plugins/discovery.js";
import type { ChannelManager, ChannelRuntimeDeps } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import {
  describeServiceOwnership,
  ensureServiceOwnership,
  verifyServiceOwnership
} from "$lib/server/app/serviceOwnership.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
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

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

export function logPluginCatalog(state: { pluginCatalog: any }): void {
  const channelSummary = state.pluginCatalog.channels
    .map((plugin: any) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const providerSummary = state.pluginCatalog.providers
    .map((plugin: any) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const featureSummary = state.pluginCatalog.features
    .map((plugin: any) => `${plugin.key}:${colorStatus(plugin.status)}`)
    .join(", ");
  const memoryBackendSummary = state.pluginCatalog.memoryBackends
    .map((backend: any) => `${backend.key}:${colorStatus(backend.status)}`)
    .join(", ");

  const extensionSummary = (state.pluginCatalog.extensions ?? [])
    .map((extension: any) => `${extension.key}:${colorStatus(extension.status)}`)
    .join(", ");

  const miniAppSummary = (state.pluginCatalog.miniApps ?? [])
    .map((app: any) => `${app.key}:${colorStatus(app.status)}`)
    .join(", ");

  console.log(
    `${runtimeLabel("runtime")} plugin_catalog channels=[${channelSummary || "(none)"}] providers=[${providerSummary || "(none)"}] features=[${featureSummary || "(none)"}] memory_backends=[${memoryBackendSummary || "(none)"}] extensions=[${extensionSummary || "(none)"}] miniapps=[${miniAppSummary || "(none)"}]`
  );
}

export function logChannelPluginApplication(state: any, applied: Array<{ key: string; instances: string[] }>): void {
  const summary = applied
    .map(({ key, instances }) => `${color(key, `${ANSI_BOLD}${ANSI_GREEN}`)}(${instances.length}):[${formatList(instances)}]`)
    .join(" ");
  console.log(`${runtimeLabel("runtime")} channel_plugins_applied ${summary || "(none)"}`);
}

/**
 * How often the runtime re-checks that it still holds the data directory's
 * lease. Acquiring ownership once is not enough: the lock can be swept with a
 * `/tmp` data dir, deleted by an operator, or taken over by a replacement
 * instance, and a channel that keeps polling after that is precisely the
 * invisible orphan §3.41 describes.
 */
const OWNERSHIP_WATCHDOG_INTERVAL_MS = 30_000;

let ownershipWatchdog: NodeJS.Timeout | null = null;
let lastOwnershipVerdict: boolean | null = null;

function armOwnershipWatchdog(
  state: any,
  applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings
): void {
  lastOwnershipVerdict = verifyServiceOwnership();
  if (ownershipWatchdog) return;
  ownershipWatchdog = setInterval(() => {
    const stillOwned = verifyServiceOwnership();
    if (stillOwned === lastOwnershipVerdict) return;
    lastOwnershipVerdict = stillOwned;
    if (stillOwned) return;
    console.error(
      `${runtimeLabel("runtime")} ${color("service_lease_lost", `${ANSI_BOLD}${ANSI_RED}`)} ` +
        `stopping live channels; another process now owns this data directory.`
    );
    // Re-running the shared apply path is the whole teardown: ownership is
    // re-evaluated, every ownership-requiring plugin yields an empty instance
    // list, and the reconcile loop stops and drops its managers.
    applyChannelPlugins(state, applySettingsPatch);
  }, OWNERSHIP_WATCHDOG_INTERVAL_MS);
  // Never hold the process open for this: a supervisor shutdown must not wait
  // on a diagnostic timer.
  ownershipWatchdog.unref?.();
}

/**
 * Whether one channel plugin may run in this process.
 *
 * Fails closed by default: a plugin that does not declare
 * `requiresServiceOwnership` is treated as carrying an external bot identity,
 * so a third-party channel cannot opt itself into running unowned by omission.
 */
export function channelPluginMayRun(
  plugin: { requiresServiceOwnership?: boolean },
  ownership: { owned: boolean }
): boolean {
  if (ownership.owned) return true;
  return plugin.requiresServiceOwnership === false;
}

/** Test seam: stop the watchdog so a test run can exit. */
export function stopOwnershipWatchdog(): void {
  if (!ownershipWatchdog) return;
  clearInterval(ownershipWatchdog);
  ownershipWatchdog = null;
  lastOwnershipVerdict = null;
}

export function applyChannelPlugins(state: any, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const deps: ChannelRuntimeDeps = {
    getSettings: () => state.settings,
    updateSettings: applySettingsPatch,
    sessions: state.sessions,
    memory: state.memory,
    memoryReview: state.memoryReview,
    usageTracker: state.usageTracker,
    modelErrorTracker: state.modelErrorTracker,
    hookManager: state.hookManager
  };

  const loaded = discoverPlugins(state.settings);
  state.pluginCatalog = loaded.catalog;
  state.providerPlugins = loaded.providerPlugins;
  logPluginCatalog(state);

  const applied: Array<{ key: string; instances: string[] }> = [];

  // One gate for every channel, present and future. A plugin that reaches an
  // external network as this deployment's bot identity may only run in the
  // process that owns the data directory; anything else is a second voice on
  // the same account (prd.md §3.41). The exemption is declared by the plugin,
  // so this stays a shared rule with the difference injected by the caller
  // rather than a per-channel conditional (CLAUDE.md pitfall 7).
  const ownership = ensureServiceOwnership();
  if (!ownership.owned) {
    console.error(
      `${runtimeLabel("runtime")} ${color("channel_plugins_suppressed", `${ANSI_BOLD}${ANSI_RED}`)} ` +
        `${describeServiceOwnership(ownership)} — live channels stay stopped in this process.`
    );
  }
  armOwnershipWatchdog(state, applySettingsPatch);

  for (const plugin of loaded.channelPlugins) {
    const mayRun = channelPluginMayRun(plugin, ownership);
    // An empty instance list drives the existing reconcile loop below, so an
    // ownership loss tears live managers down through the same path a settings
    // change uses — no second shutdown implementation.
    const instances = mayRun ? plugin.listInstances(state.settings) : [];
    const expectedIds = new Set(instances.map((instance) => instance.id));
    const managers = state.channelManagers.get(plugin.key) ?? new Map<string, ChannelManager>();
    state.channelManagers.set(plugin.key, managers);

    for (const [id, manager] of managers.entries()) {
      if (expectedIds.has(id)) continue;
      manager.stop();
      managers.delete(id);
    }

    for (const instance of instances) {
      let manager = managers.get(instance.id);
      if (!manager) {
        manager = plugin.createManager(instance, deps);
        managers.set(instance.id, manager);
      }
      manager.apply(instance.config);
    }

    applied.push({
      key: plugin.key,
      instances: instances.map((instance) => instance.id)
    });
  }

  logChannelPluginApplication(state, applied);
}
