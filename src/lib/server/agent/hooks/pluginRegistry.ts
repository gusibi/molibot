import { momError, momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import type { HookPlugin } from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export type HookPluginFactory = (options: Record<string, unknown>) => HookPlugin;

const factories = new Map<string, HookPluginFactory>();

/**
 * Code-level registry of pluggable hook plugins. A plugin module calls
 * registerHookPluginFactory once at import time; whether the plugin is
 * actually attached to the runtime is controlled by settings
 * (settings.plugins.hooks: [{ id, enabled, options }]).
 */
export function registerHookPluginFactory(id: string, factory: HookPluginFactory): void {
  if (factories.has(id)) {
    throw new Error(`Hook plugin factory already registered: ${id}`);
  }
  factories.set(id, factory);
}

export function unregisterHookPluginFactory(id: string): boolean {
  return factories.delete(id);
}

export function listHookPluginFactoryIds(): string[] {
  return Array.from(factories.keys());
}

/**
 * Instantiate and register every enabled, known plugin from settings.
 * One plugin failing to init never blocks the others.
 */
export async function applyConfiguredHookPlugins(
  manager: DefaultHookManager,
  settings: RuntimeSettings
): Promise<void> {
  const entries = settings.plugins?.hooks ?? [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const factory = factories.get(entry.id);
    if (!factory) {
      momWarn("hooks", "plugin_factory_missing", { pluginId: entry.id });
      continue;
    }
    try {
      await manager.registerPlugin(factory(entry.options ?? {}));
      momLog("hooks", "plugin_registered", { pluginId: entry.id });
    } catch (error) {
      momError("hooks", "plugin_register_failed", {
        pluginId: entry.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
