import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { momError } from "$lib/server/agent/common/log.js";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { applyConfiguredHookPlugins } from "$lib/server/agent/hooks/pluginRegistry.js";
import { RuntimeLogHook } from "$lib/server/agent/hooks/runtimeLogHook.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookManager } from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export function createDefaultHookManager(options: {
  settings: RuntimeSettings;
  store?: MomRuntimeStore;
}): HookManager {
  const manager = new DefaultHookManager({ settings: options.settings });
  manager.register(new TraceRecorderHook(new SqliteTraceStore()));
  manager.register(new RuntimeLogHook());
  // Configured plugins attach asynchronously; init failures are isolated per
  // plugin and must never block runtime startup.
  void applyConfiguredHookPlugins(manager, options.settings).catch((error) => {
    momError("hooks", "plugin_bootstrap_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return manager;
}
