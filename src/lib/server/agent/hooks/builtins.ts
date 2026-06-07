import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { RuntimeLogHook } from "$lib/server/agent/hooks/runtimeLogHook.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookManager } from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export function createDefaultHookManager(_options: {
  settings: RuntimeSettings;
  store?: MomRuntimeStore;
}): HookManager {
  const manager = new DefaultHookManager({ settings: _options.settings });
  manager.register(new TraceRecorderHook(new SqliteTraceStore()));
  manager.register(new RuntimeLogHook());
  return manager;
}
