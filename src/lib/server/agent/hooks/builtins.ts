import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { DebugLogHook } from "$lib/server/agent/hooks/debugLogHook.js";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookManager } from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export function createDefaultHookManager(_options: {
  settings: RuntimeSettings;
  store?: MomRuntimeStore;
}): HookManager {
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(new SqliteTraceStore()));
  manager.register(new DebugLogHook());
  return manager;
}
