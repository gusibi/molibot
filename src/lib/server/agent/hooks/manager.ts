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
  RuntimeHook
} from "$lib/server/agent/hooks/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

interface RegisteredHook {
  hook: RuntimeHook;
  order: number;
  pluginId?: string;
}

interface DefaultHookManagerOptions {
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

export class DefaultHookManager implements HookManager {
  private hooks = new Map<string, RegisteredHook>();
  private plugins = new Map<string, { plugin: HookPlugin; hookIds: string[] }>();
  private order = 0;
  private observeTail: Promise<void> = Promise.resolve();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly transformEnabled: boolean;
  private readonly defaultTimeoutMs: Record<HookKind, number>;
  private readonly settings?: RuntimeSettings;

  constructor(options: DefaultHookManagerOptions = {}) {
    this.transformEnabled = options.transformEnabled === true;
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
    return this.hooks.delete(id);
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
        this.registerInternal(hook, plugin.id);
        hookIds.push(hook.id);
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
    await row.plugin.destroy?.();
    this.plugins.delete(id);
    return true;
  }

  emit<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): void {
    const hooks = this.hooksFor(stage, "observe");
    if (hooks.length === 0) return;
    this.observeTail = this.observeTail
      .catch(() => {
        // Critical observe hooks are reported by runHook, but the background
        // queue must recover so later emits are not starved.
      })
      .then(async () => {
        for (const row of hooks) {
          await this.runHook(row.hook, stage, "observe", context, payload);
        }
      });
    this.observeTail.catch(() => {});
  }

  async flush(options: { timeoutMs?: number } = {}): Promise<void> {
    await timeout(this.observeTail, options.timeoutMs ?? 5000, "hook flush").catch(() => {});
  }

  async transform<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<TPayload> {
    if (!this.transformEnabled) return payload;
    let current = payload;
    for (const row of this.hooksFor(stage, "transform")) {
      const result = await this.runHook(row.hook, stage, "transform", context, current);
      if (result && typeof result === "object" && "type" in result && result.type === "replace") {
        current = result.payload as TPayload;
      }
    }
    return current;
  }

  async gate<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<GateDecision> {
    for (const row of this.hooksFor(stage, "gate")) {
      const result = await this.runHook(row.hook, stage, "gate", context, payload);
      if (result && typeof result === "object" && "type" in result && result.type === "deny") {
        return result;
      }
    }
    return { type: "allow" };
  }

  private registerInternal(hook: RuntimeHook, pluginId?: string): void {
    if (this.hooks.has(hook.id)) {
      throw new Error(`Hook already registered: ${hook.id}`);
    }
    this.hooks.set(hook.id, {
      hook,
      order: this.order++,
      pluginId
    });
  }

  private sortedHooks(): RegisteredHook[] {
    return Array.from(this.hooks.values()).sort((a, b) => {
      const priorityOrder = (a.hook.priority ?? 50) - (b.hook.priority ?? 50);
      return priorityOrder !== 0 ? priorityOrder : a.order - b.order;
    });
  }

  private hooksFor(stage: HookStage, kind: HookKind): RegisteredHook[] {
    return this.sortedHooks().filter((row) => row.hook.kind === kind && row.hook.stages.includes(stage));
  }

  private async runHook<TPayload>(
    hook: RuntimeHook,
    stage: HookStage,
    kind: HookKind,
    context: HookContext,
    payload: TPayload
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
      if (hook.critical) throw normalized;
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
