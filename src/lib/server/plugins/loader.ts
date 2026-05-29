import { discoverPlugins } from "$lib/server/plugins/discovery.js";
import type { ChannelManager, ChannelRuntimeDeps } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

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

  console.log(
    `${runtimeLabel("runtime")} plugin_catalog channels=[${channelSummary || "(none)"}] providers=[${providerSummary || "(none)"}] features=[${featureSummary || "(none)"}] memory_backends=[${memoryBackendSummary || "(none)"}]`
  );
}

export function logChannelPluginApplication(state: any, applied: Array<{ key: string; instances: string[] }>): void {
  const summary = applied
    .map(({ key, instances }) => `${color(key, `${ANSI_BOLD}${ANSI_GREEN}`)}(${instances.length}):[${formatList(instances)}]`)
    .join(" ");
  console.log(`${runtimeLabel("runtime")} channel_plugins_applied ${summary || "(none)"}`);
}

export function applyChannelPlugins(state: any, applySettingsPatch: (patch: Partial<RuntimeSettings>) => RuntimeSettings): void {
  const deps: ChannelRuntimeDeps = {
    getSettings: () => state.settings,
    updateSettings: applySettingsPatch,
    sessions: state.sessions,
    memory: state.memory,
    usageTracker: state.usageTracker,
    modelErrorTracker: state.modelErrorTracker
  };

  const loaded = discoverPlugins(state.settings);
  state.pluginCatalog = loaded.catalog;
  state.providerPlugins = loaded.providerPlugins;
  logPluginCatalog(state);

  const applied: Array<{ key: string; instances: string[] }> = [];

  for (const plugin of loaded.channelPlugins) {
    const instances = plugin.listInstances(state.settings);
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
