import type {
  GateDecision,
  HookContext,
  HookError,
  HookEvent,
  HookKind,
  HookManager,
  HookPlugin,
  HookResult,
  HookStage,
  RuntimeHook,
  StagePayload
} from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

interface RegisteredHook {
  hook: RuntimeHook;
  effectiveId: string;
  order: number;
  pluginId?: string;
}

interface DefaultHookManagerOptions {
  /** Transform pipeline runs by default; pass false to make transform a pass-through. */
  transformEnabled?: boolean;
  defaultTimeoutMs?: Partial<Record<HookKind, number>>;
  settings?: RuntimeSettings;
}

type ErrorListener = (error: HookError) => void;

const DEFAULT_TIMEOUT_MS: Record<HookKind, number> = {
  observe: 3000,
  transform: 5000,
  gate: 10000
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function snapshotPayload<T>(payload: T): T {
  // Observe hooks run asynchronously after emit returns; snapshot so callers
  // mutating the payload object afterwards do not change what hooks see.
  try {
    return structuredClone(payload);
  } catch {
    return payload;
  }
}

export class DefaultHookManager implements HookManager {
  private hooks = new Map<string, RegisteredHook>();
  private plugins = new Map<string, { plugin: HookPlugin; hookIds: string[] }>();
  private order = 0;
  private observeTails = new Map<string, Promise<void>>();
  private stageIndex = new Map<string, RegisteredHook[]>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly transformEnabled: boolean;
  private readonly defaultTimeoutMs: Record<HookKind, number>;
  private readonly settings?: RuntimeSettings;

  constructor(options: DefaultHookManagerOptions = {}) {
    this.transformEnabled = options.transformEnabled !== false;
    this.settings = options.settings;
    this.defaultTimeoutMs = {
      ...DEFAULT_TIMEOUT_MS,
      ...(options.defaultTimeoutMs ?? {})
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  register(hook: RuntimeHook): void {
    this.registerInternal(hook);
  }

  unregister(id: string): boolean {
    const removed = this.hooks.delete(id);
    if (removed) this.stageIndex.clear();
    return removed;
  }

  list(): RuntimeHook[] {
    return this.sortedHooks().map((row) => row.hook);
  }

  async registerPlugin(plugin: HookPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Hook plugin already registered: ${plugin.id}`);
    }
    await plugin.init?.(this.settings ?? ({} as RuntimeSettings));
    const hookIds: string[] = [];
    try {
      for (const hook of plugin.getHooks()) {
        const effectiveId = this.registerInternal(hook, plugin.id);
        hookIds.push(effectiveId);
      }
    } catch (error) {
      for (const id of hookIds) this.unregister(id);
      throw error;
    }
    this.plugins.set(plugin.id, { plugin, hookIds });
  }

  async unregisterPlugin(id: string): Promise<boolean> {
    const row = this.plugins.get(id);
    if (!row) return false;
    for (const hookId of row.hookIds) this.unregister(hookId);
    // Drain in-flight observe events so the plugin's hooks are not invoked
    // (or mid-flight) after destroy() has torn down its resources.
    await this.flush({ timeoutMs: 5000 });
    await row.plugin.destroy?.();
    this.plugins.delete(id);
    return true;
  }

  emit<S extends HookStage>(stage: S, context: HookContext, payload: StagePayload<S>): void {
    const hooks = this.hooksFor(stage, "observe");
    if (hooks.length === 0) return;
    const snapshot = snapshotPayload(payload);
    const runId = context.runId;
    const tail = (this.observeTails.get(runId) ?? Promise.resolve())
      .catch(() => {
        // Critical observe hooks are reported by runHook, but the queue must
        // recover so later emits for this run are not starved.
      })
      .then(async () => {
        for (const row of hooks) {
          await this.runHook(row.hook, stage, "observe", context, snapshot);
        }
      });
    this.observeTails.set(runId, tail);
    tail
      .catch(() => {})
      .finally(() => {
        if (this.observeTails.get(runId) === tail) {
          this.observeTails.delete(runId);
        }
      });
  }

  async flush(options: { timeoutMs?: number; runId?: string } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const tails = options.runId
      ? [this.observeTails.get(options.runId)].filter((tail): tail is Promise<void> => Boolean(tail))
      : Array.from(this.observeTails.values());
    if (tails.length === 0) return;
    await timeout(Promise.all(tails).then(() => {}), timeoutMs, "hook flush").catch(() => {});
  }

  async transform<S extends HookStage>(
    stage: S,
    context: HookContext,
    payload: StagePayload<S>
  ): Promise<StagePayload<S>> {
    if (!this.transformEnabled) return payload;
    let current = payload;
    for (const row of this.hooksFor(stage, "transform")) {
      const result = await this.runHook(row.hook, stage, "transform", context, current);
      if (result && typeof result === "object" && "type" in result && result.type === "replace") {
        current = result.payload as StagePayload<S>;
      }
    }
    return current;
  }

  async gate<S extends HookStage>(
    stage: S,
    context: HookContext,
    payload: StagePayload<S>
  ): Promise<GateDecision> {
    for (const row of this.hooksFor(stage, "gate")) {
      let result: HookResult<StagePayload<S>>;
      try {
        result = await this.runHook(row.hook, stage, "gate", context, payload, { rethrow: true });
      } catch (error) {
        // Fail-closed by default: a broken or timed-out gate must not silently
        // allow the action it was guarding.
        if (row.hook.failMode === "open") continue;
        return {
          type: "deny",
          reason: `gate hook ${row.effectiveId} failed: ${toError(error).message}`,
          code: "HOOK_GATE_FAILURE"
        };
      }
      if (result && typeof result === "object" && "type" in result && result.type === "deny") {
        return result;
      }
    }
    return { type: "allow" };
  }

  private registerInternal(hook: RuntimeHook, pluginId?: string): string {
    // Namespace plugin hooks so two plugins can use the same local hook id.
    const effectiveId = pluginId && !hook.id.startsWith(`${pluginId}/`) ? `${pluginId}/${hook.id}` : hook.id;
    if (this.hooks.has(effectiveId)) {
      throw new Error(`Hook already registered: ${effectiveId}`);
    }
    this.hooks.set(effectiveId, {
      hook,
      effectiveId,
      order: this.order++,
      pluginId
    });
    this.stageIndex.clear();
    return effectiveId;
  }

  private sortedHooks(): RegisteredHook[] {
    return Array.from(this.hooks.values()).sort((a, b) => {
      const priorityOrder = (a.hook.priority ?? 50) - (b.hook.priority ?? 50);
      return priorityOrder !== 0 ? priorityOrder : a.order - b.order;
    });
  }

  private hooksFor(stage: HookStage, kind: HookKind): RegisteredHook[] {
    const key = `${stage} ${kind}`;
    let rows = this.stageIndex.get(key);
    if (!rows) {
      rows = this.sortedHooks().filter((row) => row.hook.kind === kind && row.hook.stages.includes(stage));
      this.stageIndex.set(key, rows);
    }
    return rows;
  }

  private async runHook<TPayload>(
    hook: RuntimeHook,
    stage: HookStage,
    kind: HookKind,
    context: HookContext,
    payload: TPayload,
    options: { rethrow?: boolean } = {}
  ): Promise<HookResult<TPayload>> {
    const event: HookEvent<TPayload> = {
      stage,
      kind,
      timestamp: new Date().toISOString(),
      context,
      payload
    };
    try {
      return await timeout(
        Promise.resolve(hook.handle(event)),
        hook.timeoutMs ?? this.defaultTimeoutMs[kind],
        `hook ${hook.id} ${stage}`
      ) as HookResult<TPayload>;
    } catch (error) {
      const normalized = toError(error);
      this.reportError({
        hookId: hook.id,
        stage,
        error: normalized,
        critical: hook.critical === true,
        timestamp: new Date().toISOString()
      });
      if (hook.critical || options.rethrow) throw normalized;
      return undefined;
    }
  }

  private reportError(error: HookError): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch {
        // Error listeners must not break hook execution.
      }
    }
  }
}
