# HookManager Runtime Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pluggable HookManager layer on top of `pi-agent-core` callbacks so trace, audit, stats, debug logging, and future export hooks can be registered without hard-coding new behavior into Runner or channel code.

**Architecture:** Add a small shared hook subsystem under `src/lib/server/agent/hooks`. It exposes stable hook types, a non-blocking observe queue, awaited gate hooks, pass-through transform hooks, built-in plugin registration, and SQLite-backed trace recording. `MomRunner` bridges `pi-agent-core` callbacks into HookManager and emits only the Molibot-specific stages the core does not provide.

**Tech Stack:** TypeScript, SvelteKit server modules, `node:test`, `node:sqlite`, `@mariozechner/pi-agent-core`, existing Molibot `RuntimeSettings`, `MomRuntimeStore`, and runtime dependency injection.

---

## File Structure

- Create: `src/lib/server/agent/hooks/types.ts`
  - Defines `HookKind`, `HookStage`, `HookContext`, `HookEvent`, `GateDecision`, `RuntimeHook`, `HookPlugin`, and `HookManager`.
- Create: `src/lib/server/agent/hooks/manager.ts`
  - Implements `DefaultHookManager` with registration, plugin lifecycle, non-blocking `emit`, bounded `flush`, awaited `gate`, pass-through `transform`, timeout handling, priority ordering, and non-critical error isolation.
- Create: `src/lib/server/agent/hooks/index.ts`
  - Re-exports public hook APIs and factory functions.
- Create: `src/lib/server/agent/hooks/manager.test.ts`
  - Unit tests for ordering, duplicate ids, non-blocking emit, flush, gate deny, plugin lifecycle, timeout, and non-critical error isolation.
- Create: `src/lib/server/agent/hooks/debugLogHook.ts`
  - Built-in observe hook that logs concise hook diagnostics through `momLog`/`momWarn`.
- Create: `src/lib/server/agent/hooks/traceStore.ts`
  - SQLite table and write/read helpers for trace events.
- Create: `src/lib/server/agent/hooks/traceRecorderHook.ts`
  - Built-in observe hook that writes sanitized trace events and keeps per-run state isolated by `runId`.
- Create: `src/lib/server/agent/hooks/builtins.ts`
  - `createDefaultHookManager()` factory and built-in hook plugin registration.
- Create: `src/lib/server/agent/hooks/traceRecorderHook.test.ts`
  - Tests SQLite trace writes, sensitive field redaction, per-run state cleanup on `run.finished`, and no memory-tool special stage.
- Modify: `src/lib/server/app/runtime.ts`
  - Add `hookManager` to `RuntimeState`, initialize it once, and pass it through channel/runtime dependencies.
- Modify: `src/lib/server/channels/registry.ts`
  - Add `hookManager` to `ChannelRuntimeDeps`.
- Modify: `src/lib/server/plugins/loader.ts`
  - Include `hookManager` in `ChannelRuntimeDeps` passed to channel plugins.
- Modify: `src/lib/server/channels/shared/baseRuntime.ts`
  - Accept `hookManager`, pass it into `RunnerPool`.
- Modify: `src/lib/server/channels/telegram/index.ts`
  - Pass `deps.hookManager` into `TelegramManager`.
- Modify: `src/lib/server/channels/feishu/index.ts`
  - Pass `deps.hookManager` into `FeishuManager`.
- Modify: `src/lib/server/channels/qq/index.ts`
  - Pass `deps.hookManager` into `QqManager`.
- Modify: `src/lib/server/channels/weixin/index.ts`
  - Pass `deps.hookManager` into `WeixinManager`.
- Modify: `src/lib/server/web/runtimeContext.ts`
  - Pass `runtime.hookManager` into Web `RunnerPool`.
- Modify: `src/lib/server/agent/core/runnerPool.ts`
  - Accept and pass `hookManager` into `MomRunner`.
- Modify: `src/lib/server/agent/core/runner.ts`
  - Bridge `beforeToolCall`, `afterToolCall`, `subscribe`, `onPayload`, and `onResponse`; emit `run.beforeStart`, `model.select.before/after`, `skill.selected`, and `skill.loaded`.
- Modify: `src/lib/server/agent/core/types.ts`
  - If needed, extend `RunnerUiEvent` only for existing UI behavior. Do not add hook-specific events here unless implementation proves unavoidable.
- Modify: `src/lib/server/agent/core/runner.test.ts`
  - Add integration tests for bridge events using the existing mocked Agent pattern.
- Modify: `src/lib/server/channels/telegram/runtime.test.ts`
  - Update runtime constructor mocks to include `hookManager`.
- Modify: `features.md`
  - Record the delivered HookManager runtime extension.
- Modify: `prd.md`
  - Move HookManager from planned/research to implementation status or add a completed milestone.
- Modify: `CHANGELOG.md`
  - Add high-level release note for the new runtime hook extension point.
- Modify: `README.md`
  - Add or update documentation navigation to point to the HookManager design and plan.

## Verification Commands

Use these commands throughout the plan:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
node --import tsx --test src/lib/server/agent/core/runner.test.ts
node --import tsx --test src/lib/server/agent/tools/toolRuntime.test.ts
node --import tsx --test src/lib/server/channels/telegram/runtime.test.ts
npm run build
```

Expected successful test output from `node --import tsx --test ...` includes `# pass` and no failing subtests. `npm run build` should complete without TypeScript or SvelteKit errors.

---

### Task 1: Hook Core Types and Manager

**Files:**
- Create: `src/lib/server/agent/hooks/types.ts`
- Create: `src/lib/server/agent/hooks/manager.ts`
- Create: `src/lib/server/agent/hooks/index.ts`
- Create: `src/lib/server/agent/hooks/manager.test.ts`

- [ ] **Step 1: Write failing tests for HookManager behavior**

Create `src/lib/server/agent/hooks/manager.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import type { HookContext, RuntimeHook } from "$lib/server/agent/hooks/types.js";

const context: HookContext = {
  runId: "run-1",
  channel: "web",
  chatId: "chat-1",
  sessionId: "session-1",
  workspaceId: "personal",
  actorId: "user-1"
};

test("register rejects duplicate hook ids", () => {
  const manager = new DefaultHookManager();
  const hook: RuntimeHook = {
    id: "dup",
    kind: "observe",
    stages: ["run.started"],
    handle: () => {}
  };

  manager.register(hook);
  assert.throws(() => manager.register(hook), /already registered/i);
});

test("emit is non-blocking and flush drains observe hooks by priority", async () => {
  const manager = new DefaultHookManager();
  const calls: string[] = [];

  manager.register({
    id: "slow",
    kind: "observe",
    stages: ["run.started"],
    priority: 20,
    async handle() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      calls.push("slow");
    }
  });
  manager.register({
    id: "fast",
    kind: "observe",
    stages: ["run.started"],
    priority: 10,
    handle() {
      calls.push("fast");
    }
  });

  manager.emit("run.started", context, { textLength: 5 });
  assert.deepEqual(calls, [], "emit should not run observe hooks synchronously");
  await manager.flush({ timeoutMs: 1000 });
  assert.deepEqual(calls, ["fast", "slow"]);
});

test("non-critical observe hook failures are captured and do not reject flush", async () => {
  const manager = new DefaultHookManager();
  const errors: string[] = [];

  manager.onError((error) => {
    errors.push(`${error.hookId}:${error.stage}:${error.error.message}`);
  });
  manager.register({
    id: "bad-observer",
    kind: "observe",
    stages: ["run.started"],
    handle() {
      throw new Error("boom");
    }
  });

  manager.emit("run.started", context, {});
  await manager.flush({ timeoutMs: 1000 });
  assert.deepEqual(errors, ["bad-observer:run.started:boom"]);
});

test("gate returns first deny decision in priority order", async () => {
  const manager = new DefaultHookManager();

  manager.register({
    id: "allow-first",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 1,
    handle: () => ({ type: "allow" })
  });
  manager.register({
    id: "deny-second",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 2,
    handle: () => ({ type: "deny", reason: "blocked by test", code: "TEST_BLOCK" })
  });
  manager.register({
    id: "deny-third",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 3,
    handle: () => ({ type: "deny", reason: "should not be reached" })
  });

  const decision = await manager.gate("tool.call.before", context, { toolName: "bash" });
  assert.deepEqual(decision, { type: "deny", reason: "blocked by test", code: "TEST_BLOCK" });
});

test("transform is pass-through while disabled", async () => {
  const manager = new DefaultHookManager({ transformEnabled: false });

  manager.register({
    id: "replace-transform",
    kind: "transform",
    stages: ["prompt.build.after"],
    handle: () => ({ type: "replace", payload: { value: "changed" } })
  });

  const original = { value: "original" };
  const transformed = await manager.transform("prompt.build.after", context, original);
  assert.equal(transformed, original);
});

test("plugin registration initializes hooks and unregister destroys plugin hooks", async () => {
  const manager = new DefaultHookManager();
  let initialized = false;
  let destroyed = false;

  await manager.registerPlugin({
    id: "plugin-1",
    name: "Plugin 1",
    init() {
      initialized = true;
    },
    getHooks() {
      return [{
        id: "plugin-1:observer",
        kind: "observe",
        stages: ["run.started"],
        handle: () => {}
      }];
    },
    destroy() {
      destroyed = true;
    }
  });

  assert.equal(initialized, true);
  assert.equal(manager.list().some((hook) => hook.id === "plugin-1:observer"), true);

  const removed = await manager.unregisterPlugin("plugin-1");
  assert.equal(removed, true);
  assert.equal(destroyed, true);
  assert.equal(manager.list().some((hook) => hook.id === "plugin-1:observer"), false);
});

test("flush returns after timeout even when observe hook is slow", async () => {
  const manager = new DefaultHookManager();

  manager.register({
    id: "very-slow",
    kind: "observe",
    stages: ["run.started"],
    async handle() {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  manager.emit("run.started", context, {});
  const startedAt = Date.now();
  await manager.flush({ timeoutMs: 20 });
  assert.ok(Date.now() - startedAt < 150);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
```

Expected: FAIL because `src/lib/server/agent/hooks/manager.js` and `types.js` do not exist.

- [ ] **Step 3: Create hook type definitions**

Create `src/lib/server/agent/hooks/types.ts`:

```ts
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export type HookKind = "observe" | "transform" | "gate";

export type HookStage =
  | "run.started"
  | "run.finished"
  | "model.call.before"
  | "model.call.after"
  | "assistant.message.stream"
  | "tool.call.before"
  | "tool.call.after"
  | "tool.call.error"
  | "tool.call.blocked"
  | "run.beforeStart"
  | "input.enrich.before"
  | "input.enrich.after"
  | "prompt.build.before"
  | "prompt.build.after"
  | "model.select.before"
  | "model.select.after"
  | "skill.selected"
  | "skill.loaded"
  | "approval.requested"
  | "approval.resolved"
  | "sandbox.prepare.before"
  | "sandbox.prepare.after"
  | "sandbox.prepare.error"
  | "subagent.run.before"
  | "subagent.run.after"
  | "subagent.task.before"
  | "subagent.task.after"
  | "context.persist.before"
  | "context.persist.after"
  | "runtime.notice";

export interface HookContext {
  runId: string;
  channel: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  actorId?: string;
  signal?: AbortSignal;
  span?: { id: string; parentId?: string };
}

export interface HookEvent<TPayload = unknown> {
  stage: HookStage;
  kind: HookKind;
  timestamp: string;
  context: HookContext;
  payload: TPayload;
}

export type GateDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string; code?: string };

export type HookResult<TPayload = unknown> =
  | void
  | { type: "continue" }
  | { type: "replace"; payload: TPayload }
  | GateDecision;

export interface RuntimeHook<TPayload = unknown> {
  id: string;
  name?: string;
  stages: HookStage[];
  kind: HookKind;
  priority?: number;
  critical?: boolean;
  timeoutMs?: number;
  includeSensitiveData?: boolean;
  handle(event: HookEvent<TPayload>): Promise<HookResult<TPayload>> | HookResult<TPayload>;
}

export interface HookPlugin {
  id: string;
  name: string;
  description?: string;
  init?(settings: RuntimeSettings): Promise<void> | void;
  getHooks(): RuntimeHook[];
  destroy?(): Promise<void> | void;
}

export interface HookError {
  hookId: string;
  stage: HookStage;
  error: Error;
  critical: boolean;
  timestamp: string;
}

export interface HookManager {
  register(hook: RuntimeHook): void;
  unregister(id: string): boolean;
  list(): RuntimeHook[];
  registerPlugin(plugin: HookPlugin): Promise<void>;
  unregisterPlugin(id: string): Promise<boolean>;
  emit<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): void;
  flush(options?: { timeoutMs?: number }): Promise<void>;
  transform<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<TPayload>;
  gate<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<GateDecision>;
}
```

- [ ] **Step 4: Implement DefaultHookManager**

Create `src/lib/server/agent/hooks/manager.ts`:

```ts
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

interface RegisteredHook {
  hook: RuntimeHook;
  order: number;
  pluginId?: string;
}

interface DefaultHookManagerOptions {
  transformEnabled?: boolean;
  defaultTimeoutMs?: Partial<Record<HookKind, number>>;
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

  constructor(options: DefaultHookManagerOptions = {}) {
    this.transformEnabled = options.transformEnabled === true;
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
    await plugin.init?.({} as any);
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
    this.observeTail = this.observeTail.then(async () => {
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
```

- [ ] **Step 5: Add public exports**

Create `src/lib/server/agent/hooks/index.ts`:

```ts
export * from "$lib/server/agent/hooks/types.js";
export { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
```

- [ ] **Step 6: Run HookManager tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Before committing, inspect unrelated user changes:

```bash
git status --short
```

Stage only files from this task:

```bash
git add src/lib/server/agent/hooks/types.ts src/lib/server/agent/hooks/manager.ts src/lib/server/agent/hooks/index.ts src/lib/server/agent/hooks/manager.test.ts
git commit -m "feat: add agent hook manager core"
```

---

### Task 2: Built-In Debug and Trace Hooks

**Files:**
- Create: `src/lib/server/agent/hooks/debugLogHook.ts`
- Create: `src/lib/server/agent/hooks/traceStore.ts`
- Create: `src/lib/server/agent/hooks/traceRecorderHook.ts`
- Create: `src/lib/server/agent/hooks/builtins.ts`
- Create: `src/lib/server/agent/hooks/traceRecorderHook.test.ts`
- Modify: `src/lib/server/agent/hooks/index.ts`

- [ ] **Step 1: Write failing tests for TraceRecorderHook**

Create `src/lib/server/agent/hooks/traceRecorderHook.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";

function context(runId: string): HookContext {
  return {
    runId,
    channel: "web",
    chatId: "chat-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "user-1"
  };
}

test("TraceRecorderHook writes sanitized trace events to SQLite", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));

  manager.emit("run.started", context("run-1"), {
    textLength: 12,
    secret: "should-not-be-captured",
    apiKey: "sk-test"
  });
  await manager.flush({ timeoutMs: 1000 });

  const rows = store.listByRunId("run-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stage, "run.started");
  assert.equal(rows[0]?.payload.textLength, 12);
  assert.equal(rows[0]?.payload.secret, undefined);
  assert.equal(rows[0]?.payload.apiKey, undefined);
  store.close();
});

test("TraceRecorderHook isolates run state and purges it on run.finished", async () => {
  const store = new SqliteTraceStore(":memory:");
  const hook = new TraceRecorderHook(store);
  const manager = new DefaultHookManager();
  manager.register(hook);

  manager.emit("tool.call.before", context("run-a"), { toolName: "memory", toolCallId: "tool-a" });
  manager.emit("tool.call.before", context("run-b"), { toolName: "bash", toolCallId: "tool-b" });
  await manager.flush({ timeoutMs: 1000 });

  assert.equal(hook.getActiveRunCountForTest(), 2);

  manager.emit("run.finished", context("run-a"), { status: "success" });
  await manager.flush({ timeoutMs: 1000 });

  assert.equal(hook.getActiveRunCountForTest(), 1);
  assert.equal(store.listByRunId("run-a").some((row) => row.stage === "run.finished"), true);
  assert.equal(store.listByRunId("run-b").some((row) => row.payload.toolName === "bash"), true);
  store.close();
});

test("TraceRecorderHook records memory as a normal tool event", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));

  manager.emit("tool.call.before", context("run-memory"), {
    toolName: "memory",
    source: "builtin",
    toolCallId: "tool-memory"
  });
  await manager.flush({ timeoutMs: 1000 });

  const rows = store.listByRunId("run-memory");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stage, "tool.call.before");
  assert.equal(rows[0]?.payload.toolName, "memory");
  store.close();
});
```

- [ ] **Step 2: Run trace hook tests and verify they fail**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
```

Expected: FAIL because `traceRecorderHook.js` and `traceStore.js` do not exist.

- [ ] **Step 3: Implement SQLite trace store**

Create `src/lib/server/agent/hooks/traceStore.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { HookStage } from "$lib/server/agent/hooks/types.js";

export interface TraceEventRecord {
  id: string;
  runId: string;
  stage: HookStage;
  channel: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export class SqliteTraceStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_trace_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_run_id ON agent_trace_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_stage ON agent_trace_events(stage);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_created_at ON agent_trace_events(created_at);
    `);
  }

  append(record: TraceEventRecord): void {
    this.db.prepare(`
      INSERT INTO agent_trace_events (
        id, run_id, stage, channel, chat_id, session_id, workspace_id, created_at, payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.stage,
      record.channel,
      record.chatId,
      record.sessionId,
      record.workspaceId ?? null,
      record.createdAt,
      JSON.stringify(record.payload)
    );
  }

  listByRunId(runId: string): TraceEventRecord[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, stage, channel, chat_id, session_id, workspace_id, created_at, payload_json
      FROM agent_trace_events
      WHERE run_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(runId) as Array<{
      id: string;
      run_id: string;
      stage: HookStage;
      channel: string;
      chat_id: string;
      session_id: string;
      workspace_id: string | null;
      created_at: string;
      payload_json: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      stage: row.stage,
      channel: row.channel,
      chatId: row.chat_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id ?? undefined,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Implement TraceRecorderHook**

Create `src/lib/server/agent/hooks/traceRecorderHook.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "credentials",
  "secret",
  "token",
  "password",
  "fullPrompt",
  "fullText",
  "fileContent"
]);

function sanitizePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === "string" && value.length > 1000) {
      out[key] = `${value.slice(0, 1000)}...[truncated]`;
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

interface RunTraceState {
  startedAt: string;
  eventCount: number;
}

export class TraceRecorderHook implements RuntimeHook {
  readonly id = "built-in:trace-recorder";
  readonly name = "Trace Recorder";
  readonly kind = "observe" as const;
  readonly priority = 10;
  readonly stages: HookStage[] = [
    "run.started",
    "run.finished",
    "model.call.before",
    "model.call.after",
    "tool.call.before",
    "tool.call.after",
    "tool.call.error",
    "tool.call.blocked",
    "skill.selected",
    "skill.loaded",
    "runtime.notice"
  ];

  private readonly runStates = new Map<string, RunTraceState>();

  constructor(private readonly store = new SqliteTraceStore()) {}

  handle(event: HookEvent): void {
    const state = this.runStates.get(event.context.runId) ?? {
      startedAt: event.timestamp,
      eventCount: 0
    };
    state.eventCount += 1;
    this.runStates.set(event.context.runId, state);

    this.store.append({
      id: randomUUID(),
      runId: event.context.runId,
      stage: event.stage,
      channel: event.context.channel,
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      createdAt: event.timestamp,
      payload: sanitizePayload(event.payload)
    });

    if (event.stage === "run.finished") {
      this.runStates.delete(event.context.runId);
    }
  }

  getActiveRunCountForTest(): number {
    return this.runStates.size;
  }
}
```

- [ ] **Step 5: Implement DebugLogHook and built-in factory**

Create `src/lib/server/agent/hooks/debugLogHook.ts`:

```ts
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";

export class DebugLogHook implements RuntimeHook {
  readonly id = "built-in:debug-log";
  readonly name = "Debug Log";
  readonly kind = "observe" as const;
  readonly priority = 90;
  readonly stages: HookStage[] = [
    "run.started",
    "run.finished",
    "tool.call.blocked",
    "runtime.notice"
  ];

  handle(event: HookEvent): void {
    const data = {
      runId: event.context.runId,
      channel: event.context.channel,
      chatId: event.context.chatId,
      stage: event.stage
    };
    if (event.stage === "tool.call.blocked") {
      momWarn("hooks", "tool_call_blocked", { ...data, payload: event.payload });
      return;
    }
    momLog("hooks", event.stage.replace(/\./g, "_"), data);
  }
}
```

Create `src/lib/server/agent/hooks/builtins.ts`:

```ts
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
```

Modify `src/lib/server/agent/hooks/index.ts`:

```ts
export * from "$lib/server/agent/hooks/types.js";
export { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
export { createDefaultHookManager } from "$lib/server/agent/hooks/builtins.js";
export { DebugLogHook } from "$lib/server/agent/hooks/debugLogHook.js";
export { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
export { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
```

- [ ] **Step 6: Run hook tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/lib/server/agent/hooks/debugLogHook.ts src/lib/server/agent/hooks/traceStore.ts src/lib/server/agent/hooks/traceRecorderHook.ts src/lib/server/agent/hooks/builtins.ts src/lib/server/agent/hooks/index.ts src/lib/server/agent/hooks/traceRecorderHook.test.ts
git commit -m "feat: add built-in agent hook plugins"
```

---

### Task 3: Runtime Dependency Injection

**Files:**
- Modify: `src/lib/server/app/runtime.ts`
- Modify: `src/lib/server/channels/registry.ts`
- Modify: `src/lib/server/plugins/loader.ts`
- Modify: `src/lib/server/channels/shared/baseRuntime.ts`
- Modify: `src/lib/server/channels/telegram/index.ts`
- Modify: `src/lib/server/channels/feishu/index.ts`
- Modify: `src/lib/server/channels/qq/index.ts`
- Modify: `src/lib/server/channels/weixin/index.ts`
- Modify: `src/lib/server/web/runtimeContext.ts`
- Modify: `src/lib/server/agent/core/runnerPool.ts`
- Modify: `src/lib/server/channels/telegram/runtime.test.ts`

- [ ] **Step 1: Write failing type-level wiring test through existing runtime tests**

Run:

```bash
node --import tsx --test src/lib/server/channels/telegram/runtime.test.ts
```

Expected before code changes: PASS. After adding required `hookManager` constructor fields in this task, this same test will fail until mocks are updated. Keep this command as the wiring regression check.

- [ ] **Step 2: Add HookManager to runtime state**

Modify `src/lib/server/app/runtime.ts` imports:

```ts
import { createDefaultHookManager, type HookManager } from "$lib/server/agent/hooks/index.js";
```

Add to `RuntimeState`:

```ts
  hookManager: HookManager;
```

After `const memory = new MemoryGateway(...)`, add:

```ts
    const hookManager = createDefaultHookManager({ settings });
```

Add to the `state` object:

```ts
      hookManager,
```

- [ ] **Step 3: Pass HookManager through channel deps**

Modify `src/lib/server/channels/registry.ts`:

```ts
import type { HookManager } from "$lib/server/agent/hooks/index.js";
```

Add to `ChannelRuntimeDeps`:

```ts
  hookManager: HookManager;
```

Modify `src/lib/server/plugins/loader.ts` in `const deps: ChannelRuntimeDeps = { ... }`:

```ts
    hookManager: state.hookManager
```

- [ ] **Step 4: Pass HookManager into shared channel runtime RunnerPool**

Modify `src/lib/server/channels/shared/baseRuntime.ts`:

```ts
import type { HookManager } from "$lib/server/agent/hooks/index.js";
```

Add to the runtime options type near `memory`, `usageTracker`, and `modelErrorTracker`:

```ts
    hookManager: HookManager;
```

Add constructor validation:

```ts
    if (!runtimeOptions?.hookManager) {
      throw new Error(`${this.channelName} runtime requires HookManager for runtime hook dispatch.`);
    }
```

Update the `new RunnerPool(...)` call:

```ts
      runtimeOptions.memory,
      runtimeOptions.hookManager
```

- [ ] **Step 5: Pass HookManager through built-in channel plugin entries**

In each file below, add `hookManager: deps.hookManager` to the manager options object passed in `createManager`:

```ts
// src/lib/server/channels/telegram/index.ts
hookManager: deps.hookManager

// src/lib/server/channels/feishu/index.ts
hookManager: deps.hookManager

// src/lib/server/channels/qq/index.ts
hookManager: deps.hookManager

// src/lib/server/channels/weixin/index.ts
hookManager: deps.hookManager
```

- [ ] **Step 6: Pass HookManager into Web RunnerPool**

Modify `src/lib/server/web/runtimeContext.ts` `new RunnerPool(...)` call:

```ts
    runtime.memory,
    runtime.hookManager
```

- [ ] **Step 7: Update RunnerPool constructor**

Modify `src/lib/server/agent/core/runnerPool.ts`:

```ts
import type { HookManager } from "$lib/server/agent/hooks/index.js";
```

Add constructor parameter:

```ts
    private readonly hookManager: HookManager,
```

Pass to `new MomRunner(...)`:

```ts
      this.memory,
      this.hookManager,
```

- [ ] **Step 8: Update channel tests and mocks**

Modify `src/lib/server/channels/telegram/runtime.test.ts` mock runtime options to include:

```ts
    hookManager: {
      register: () => {},
      unregister: () => false,
      list: () => [],
      registerPlugin: async () => {},
      unregisterPlugin: async () => false,
      emit: () => {},
      flush: async () => {},
      transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
      gate: async () => ({ type: "allow" })
    } as any
```

- [ ] **Step 9: Run wiring tests**

Run:

```bash
node --import tsx --test src/lib/server/channels/telegram/runtime.test.ts
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
npm run build
```

Expected: PASS for tests; build succeeds.

- [ ] **Step 10: Commit**

```bash
git status --short
git add src/lib/server/app/runtime.ts src/lib/server/channels/registry.ts src/lib/server/plugins/loader.ts src/lib/server/channels/shared/baseRuntime.ts src/lib/server/channels/telegram/index.ts src/lib/server/channels/feishu/index.ts src/lib/server/channels/qq/index.ts src/lib/server/channels/weixin/index.ts src/lib/server/web/runtimeContext.ts src/lib/server/agent/core/runnerPool.ts src/lib/server/channels/telegram/runtime.test.ts
git commit -m "feat: inject agent hook manager into runtimes"
```

---

### Task 4: Runner Bridge for pi-agent-core Hooks

**Files:**
- Modify: `src/lib/server/agent/core/runner.ts`
- Modify: `src/lib/server/agent/core/runner.test.ts`

- [ ] **Step 1: Add failing Runner bridge tests**

Append to `src/lib/server/agent/core/runner.test.ts`:

```ts
test("runner hook bridge emits tool blocked when gate denies tool execution", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "deny", reason: "blocked by test hook" })
  } as any;

  const runner = new MomRunner(
    "telegram",
    "chat-hook-gate",
    `session-hook-gate-${Date.now()}`,
    new (await import("$lib/server/agent/session/store.js")).MomRuntimeStore(process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    hookManager
  );

  const agent = (runner as any).agent;
  const result = await agent.beforeToolCall({
    toolCall: { id: "tool-1", name: "bash", input: {} },
    args: { command: "date" },
    assistantMessage: { role: "assistant", content: [], timestamp: Date.now() },
    context: { systemPrompt: "", messages: [], tools: [] }
  });

  assert.deepEqual(result, { block: true, reason: "blocked by test hook" });
  assert.equal(events.some((event) => event.stage === "tool.call.blocked"), true);
  assert.equal(events.find((event) => event.stage === "tool.call.blocked")?.payload.blockedBy, "hook_gate");
});

test("runner hook bridge emits model call pairing fields", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "allow" })
  } as any;

  const runner = new MomRunner(
    "telegram",
    "chat-model-hook",
    `session-model-hook-${Date.now()}`,
    new (await import("$lib/server/agent/session/store.js")).MomRuntimeStore(process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    hookManager
  );

  (runner as any).activeHookContext = {
    runId: "run-model-hook",
    channel: "telegram",
    chatId: "chat-model-hook",
    sessionId: "session-model-hook"
  };
  (runner as any).activePayloadContext = {
    provider: "provider-1",
    model: "model-1",
    api: "openai-compatible",
    requestedThinkingLevel: "off",
    effectiveThinkingLevel: "off"
  };
  (runner as any).activeModelCallContext = {
    modelAttemptId: "run-model-hook:0:0",
    candidateIndex: 0,
    attemptIndex: 0,
    modelCallSeq: 1
  };

  const agent = (runner as any).agent;
  await agent.onPayload?.({});
  await agent.onResponse?.({ usage: { input: 1, output: 2, totalTokens: 3 }, stopReason: "stop" } as any);

  const before = events.find((event) => event.stage === "model.call.before");
  const after = events.find((event) => event.stage === "model.call.after");
  assert.equal(before?.payload.modelAttemptId, "run-model-hook:0:0");
  assert.equal(after?.payload.modelCallSeq, 1);
});
```

- [ ] **Step 2: Run Runner tests and verify they fail**

Run:

```bash
node --import tsx --test src/lib/server/agent/core/runner.test.ts
```

Expected: FAIL because `MomRunner` does not accept `hookManager` and does not expose the bridge behavior.

- [ ] **Step 3: Add HookManager dependencies and runner state**

Modify `src/lib/server/agent/core/runner.ts` imports:

```ts
import type { HookContext, HookManager } from "$lib/server/agent/hooks/index.js";
```

Add private fields to `MomRunner`:

```ts
  private activeHookContext: HookContext | undefined;
  private activeModelCallContext:
    | {
        modelAttemptId: string;
        candidateIndex: number;
        attemptIndex: number;
        modelCallSeq: number;
      }
    | undefined;
  private modelCallSeq = 0;
```

Add constructor parameter after `memory`:

```ts
    private readonly hookManager: HookManager,
```

- [ ] **Step 4: Bridge `onPayload` and add `onResponse`**

In the `new Agent({ ... })` options in `runner.ts`, update `onPayload`:

```ts
      onPayload: async (payload) => {
        if (this.activeRunnerEventSink && this.activePayloadContext) {
          await this.activeRunnerEventSink({
            type: "payload",
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            requestedThinkingLevel: this.activePayloadContext.requestedThinkingLevel,
            effectiveThinkingLevel: this.activePayloadContext.effectiveThinkingLevel,
            summary: formatPayloadReasoningSummary(payload)
          });
        }
        if (this.activeHookContext && this.activePayloadContext && this.activeModelCallContext) {
          this.hookManager.emit("model.call.before", this.activeHookContext, {
            ...this.activeModelCallContext,
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            requestedThinkingLevel: this.activePayloadContext.requestedThinkingLevel,
            effectiveThinkingLevel: this.activePayloadContext.effectiveThinkingLevel
          });
        }
        return undefined;
      },
      onResponse: async (response) => {
        if (this.activeHookContext && this.activePayloadContext && this.activeModelCallContext) {
          this.hookManager.emit("model.call.after", this.activeHookContext, {
            ...this.activeModelCallContext,
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            usage: (response as any)?.usage,
            stopReason: (response as any)?.stopReason
          });
        }
        return undefined;
      },
```

- [ ] **Step 5: Bridge `beforeToolCall` and `afterToolCall`**

Replace the existing `beforeToolCall` block with this sequence, preserving the existing preflight and budget code:

```ts
      beforeToolCall: async (context, signal) => {
        const hookContext = this.activeHookContext;
        if (hookContext) {
          const decision = await this.hookManager.gate("tool.call.before", hookContext, {
            toolName: context.toolCall.name,
            toolCallId: context.toolCall.id,
            argsPreview: JSON.stringify(context.args ?? {}).slice(0, 500)
          });
          if (decision.type === "deny") {
            this.hookManager.emit("tool.call.blocked", hookContext, {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              blockedBy: "hook_gate",
              reason: decision.reason
            });
            return { block: true, reason: decision.reason };
          }
        }

        const blockedReason = validateToolCallPreflight(context, {
          cwd: this.store.getScratchDir(this.chatId),
          workspaceDir: this.store.getWorkspaceDir()
        });
        const budgetResult = this.activeRunBudget?.tryStartTool() ?? { ok: true };
        const finalBlockedReason = blockedReason ?? budgetResult.reason;
        if (finalBlockedReason) {
          if (!budgetResult.ok) {
            this.agent.state.tools = [];
          }
          if (hookContext) {
            this.hookManager.emit("tool.call.blocked", hookContext, {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              blockedBy: blockedReason ? "preflight" : "budget",
              reason: finalBlockedReason
            });
          }
          momWarn("runner", "tool_call_blocked", {
            chatId: this.chatId,
            sessionId: this.sessionId,
            tool: context.toolCall.name,
            reason: finalBlockedReason
          });
          return { block: true, reason: finalBlockedReason };
        }
        if (hookContext) {
          this.hookManager.emit("tool.call.before", hookContext, {
            toolName: context.toolCall.name,
            toolCallId: context.toolCall.id,
            argsPreview: JSON.stringify(context.args ?? {}).slice(0, 500)
          });
        }
        return undefined;
      },
      afterToolCall: async (context) => {
        if (this.activeHookContext) {
          this.hookManager.emit(
            context.isError ? "tool.call.error" : "tool.call.after",
            this.activeHookContext,
            {
              toolName: context.toolCall.name,
              toolCallId: context.toolCall.id,
              isError: context.isError,
              resultPreview: extractTextFromResult(context.result).slice(0, 1000)
            }
          );
        }
        return undefined;
      },
```

- [ ] **Step 6: Set active hook context at run start and clear it at cleanup**

In `run(ctx)` after `runId` and `workspaceId` are known:

```ts
    this.activeHookContext = {
      runId,
      channel: ctx.channel,
      chatId: this.chatId,
      sessionId: this.sessionId,
      workspaceId,
      actorId: ctx.message.userId,
      signal: undefined
    };
    this.hookManager.emit("run.beforeStart", this.activeHookContext, {
      messageId: ctx.message.messageId,
      textLength: ctx.message.text.length,
      attachmentCount: ctx.message.attachments.length,
      imageCount: ctx.message.imageContents.length,
      isEvent: Boolean(ctx.message.isEvent)
    });
```

In the `finally` cleanup block near `unsubscribe();`, add:

```ts
      if (this.activeHookContext) {
        await this.hookManager.flush({ timeoutMs: 500 });
      }
      this.activeHookContext = undefined;
      this.activeModelCallContext = undefined;
```

- [ ] **Step 7: Add hook subscriber for run.started/run.finished**

After the existing `const unsubscribe = this.agent.subscribe(...)` block, add a second subscription:

```ts
    const unsubscribeHooks = this.agent.subscribe(async (event: AgentEvent) => {
      const hookContext = this.activeHookContext;
      if (!hookContext) return;
      if (event.type === "agent_start") {
        this.hookManager.emit("run.started", hookContext, {
          messageId: ctx.message.messageId,
          textLength: ctx.message.text.length,
          attachmentCount: ctx.message.attachments.length,
          imageCount: ctx.message.imageContents.length,
          isEvent: Boolean(ctx.message.isEvent)
        });
        return;
      }
      if (event.type === "agent_end") {
        this.hookManager.emit("run.finished", hookContext, {
          status: stopReason === "stop" ? "success" : stopReason,
          stopReason,
          durationMs: Date.now() - runStartedAt,
          errorMessage
        });
        await this.hookManager.flush({ timeoutMs: 500 });
      }
    });
```

In cleanup, call both:

```ts
      unsubscribe();
      unsubscribeHooks();
```

- [ ] **Step 8: Set model call pairing context inside model attempt loop**

Immediately before `await this.agent.prompt(...)`, add:

```ts
            this.modelCallSeq += 1;
            this.activeModelCallContext = {
              modelAttemptId: `${runId}:${candidateIndex}:${attemptCount}`,
              candidateIndex,
              attemptIndex: attemptCount,
              modelCallSeq: this.modelCallSeq
            };
```

Before tool-budget continuation `await this.agent.prompt(TOOL_BUDGET_RUNTIME_NOTICE);`, add:

```ts
                this.modelCallSeq += 1;
                this.activeModelCallContext = {
                  modelAttemptId: `${runId}:${candidateIndex}:${attemptCount}:tool-budget-continuation`,
                  candidateIndex,
                  attemptIndex: attemptCount,
                  modelCallSeq: this.modelCallSeq
                };
```

- [ ] **Step 9: Run Runner bridge tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/core/runner.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run hook tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git status --short
git add src/lib/server/agent/core/runner.ts src/lib/server/agent/core/runner.test.ts
git commit -m "feat: bridge pi agent core events to hooks"
```

---

### Task 5: Molibot-Specific Emit Points for Model Selection and Skills

**Files:**
- Modify: `src/lib/server/agent/core/runner.ts`
- Modify: `src/lib/server/agent/core/runner.test.ts`

- [ ] **Step 1: Add failing test for skill hook semantics**

Append to `src/lib/server/agent/core/runner.test.ts`:

```ts
test("runner emits skill.selected without treating workspace scan as skill.loaded", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "allow" })
  } as any;

  const runner = new MomRunner(
    "telegram",
    "chat-skill-hook",
    `session-skill-hook-${Date.now()}`,
    new (await import("$lib/server/agent/session/store.js")).MomRuntimeStore(process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    hookManager
  );

  (runner as any).activeHookContext = {
    runId: "run-skill-hook",
    channel: "telegram",
    chatId: "chat-skill-hook",
    sessionId: "session-skill-hook"
  };

  (runner as any).emitSkillSelectionForTest([
    { name: "example-skill", scope: "bot", filePath: "/tmp/SKILL.md", aliases: [] }
  ]);

  assert.equal(events.some((event) => event.stage === "skill.selected"), true);
  assert.equal(events.some((event) => event.stage === "skill.loaded"), false);
});
```

- [ ] **Step 2: Run Runner tests and verify they fail**

Run:

```bash
node --import tsx --test src/lib/server/agent/core/runner.test.ts
```

Expected: FAIL because `emitSkillSelectionForTest` does not exist.

- [ ] **Step 3: Emit model selection hooks in the candidate loop**

In `runner.ts`, before setting `activeSelection = selection;` inside the model candidate loop:

```ts
        if (this.activeHookContext) {
          this.hookManager.emit("model.select.before", this.activeHookContext, {
            candidateIndex,
            candidateCount: modelCandidates.length,
            route: modelUseCase
          });
        }
```

After `const selectedModel = selection.model;`, add:

```ts
        if (this.activeHookContext) {
          this.hookManager.emit("model.select.after", this.activeHookContext, {
            candidateIndex,
            candidateCount: modelCandidates.length,
            route: modelUseCase,
            provider: selectedModel.provider,
            model: selectedModel.id,
            api: selectedModel.api
          });
        }
```

- [ ] **Step 4: Add helper for skill selected hook**

Add private method to `MomRunner`:

```ts
  private emitSkillSelection(skills: Array<{ name: string; scope: string; filePath: string; aliases?: string[] }>): void {
    if (!this.activeHookContext) return;
    for (const skill of skills) {
      this.hookManager.emit("skill.selected", this.activeHookContext, {
        name: skill.name,
        scope: skill.scope,
        filePath: skill.filePath,
        aliases: skill.aliases ?? []
      });
    }
  }

  emitSkillSelectionForTest(skills: Array<{ name: string; scope: string; filePath: string; aliases?: string[] }>): void {
    this.emitSkillSelection(skills);
  }
```

After `const explicitlyInvokedSkills = findExplicitlyInvokedSkills(skills, enrichedText);`, add:

```ts
    this.emitSkillSelection(explicitlyInvokedSkills);
```

- [ ] **Step 5: Emit skill.loaded only after explicit skill content is injected**

Do not emit `skill.loaded` immediately after `loadSkillsFromWorkspace()`.

Replace:

```ts
    const effectiveInputText = injectExplicitSkillFileContext(
      injectExplicitSkillInvocationContext(enrichedText, explicitlyInvokedSkills),
      explicitlyInvokedSkills
    );
```

with:

```ts
    const effectiveInputText = injectExplicitSkillFileContext(
      injectExplicitSkillInvocationContext(enrichedText, explicitlyInvokedSkills),
      explicitlyInvokedSkills
    );
    if (this.activeHookContext) {
      for (const skill of explicitlyInvokedSkills) {
        this.hookManager.emit("skill.loaded", this.activeHookContext, {
          name: skill.name,
          scope: skill.scope,
          filePath: skill.filePath,
          reason: "explicit_invocation"
        });
      }
    }
```

This is a narrow v1 implementation. It records actual explicit skill use without changing `injectExplicitSkillFileContext()` yet.

- [ ] **Step 6: Run tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/core/runner.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/lib/server/agent/core/runner.ts src/lib/server/agent/core/runner.test.ts
git commit -m "feat: emit molibot-specific agent hook stages"
```

---

### Task 6: End-to-End Trace Smoke Test

**Files:**
- Create: `src/lib/server/agent/hooks/hookIntegration.test.ts`

- [ ] **Step 1: Write integration test for built-in trace recording through HookManager**

Create `src/lib/server/agent/hooks/hookIntegration.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";

test("hook manager records a representative run trace timeline", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const context: HookContext = {
    runId: "run-e2e",
    channel: "web",
    chatId: "chat-e2e",
    sessionId: "session-e2e",
    workspaceId: "personal"
  };

  manager.emit("run.started", context, { textLength: 20 });
  manager.emit("model.call.before", context, {
    modelAttemptId: "run-e2e:0:0",
    candidateIndex: 0,
    attemptIndex: 0,
    modelCallSeq: 1,
    provider: "test",
    model: "fake-model"
  });
  manager.emit("tool.call.before", context, {
    toolName: "memory",
    toolCallId: "tool-1",
    source: "builtin"
  });
  manager.emit("tool.call.after", context, {
    toolName: "memory",
    toolCallId: "tool-1",
    isError: false
  });
  manager.emit("model.call.after", context, {
    modelAttemptId: "run-e2e:0:0",
    modelCallSeq: 1,
    usage: { input: 10, output: 5, totalTokens: 15 }
  });
  manager.emit("run.finished", context, { status: "success", durationMs: 42 });
  await manager.flush({ timeoutMs: 1000 });

  const stages = store.listByRunId("run-e2e").map((row) => row.stage);
  assert.deepEqual(stages, [
    "run.started",
    "model.call.before",
    "tool.call.before",
    "tool.call.after",
    "model.call.after",
    "run.finished"
  ]);
  store.close();
});
```

- [ ] **Step 2: Run integration test**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/hookIntegration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the hook and runner test set**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
node --import tsx --test src/lib/server/agent/hooks/hookIntegration.test.ts
node --import tsx --test src/lib/server/agent/core/runner.test.ts
node --import tsx --test src/lib/server/agent/tools/toolRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git status --short
git add src/lib/server/agent/hooks/hookIntegration.test.ts
git commit -m "test: cover agent hook trace integration"
```

---

### Task 7: Documentation and Product Records

**Files:**
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update `features.md`**

Add a concise delivered feature entry under the relevant Agent/runtime or update-log section. Use this content:

```md
### Agent HookManager runtime extension

- Status: delivered
- Added a pluggable HookManager layer on top of `pi-agent-core` callbacks.
- Added non-blocking observe hooks, awaited gate hooks, pass-through transform hooks, and built-in hook plugin registration.
- Added built-in trace and debug hook plugins with SQLite trace event storage.
- Bridged run, model, tool, blocked-tool, and explicit skill usage stages into the hook system.
```

- [ ] **Step 2: Update `prd.md`**

Add or update the HookManager requirement to show it is implemented. Use this content:

```md
### Agent HookManager observability extension

- Priority: P1
- Phase: delivered
- Acceptance:
  - Runtime exposes a stable `RuntimeHook` and `HookPlugin` interface.
  - Observe hooks are non-blocking and drain through bounded `flush()`.
  - Gate hooks can deny tool execution before budget is consumed.
  - Memory is tracked as `toolName: "memory"` through normal tool hooks.
  - Trace recording is implemented as a hook plugin, not as Runner-specific trace code.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add a high-level entry:

```md
## Unreleased

- Added a pluggable Agent HookManager extension layer for trace recording, debug logs, tool gate policies, and future export hooks.
```

If `CHANGELOG.md` already has an `Unreleased` heading, add only the bullet under that existing heading.

- [ ] **Step 4: Update `README.md`**

Add or update documentation navigation with this bullet:

```md
- Agent HookManager design: `docs/superpowers/specs/2026-06-06-hookmanager-design.md`
- Agent HookManager implementation plan: `docs/superpowers/plans/2026-06-06-hookmanager-runtime-extension.md`
```

- [ ] **Step 5: Run final verification**

Run:

```bash
node --import tsx --test src/lib/server/agent/hooks/manager.test.ts
node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts
node --import tsx --test src/lib/server/agent/hooks/hookIntegration.test.ts
node --import tsx --test src/lib/server/agent/core/runner.test.ts
node --import tsx --test src/lib/server/agent/tools/toolRuntime.test.ts
node --import tsx --test src/lib/server/channels/telegram/runtime.test.ts
npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 6: Commit**

```bash
git status --short
git add features.md prd.md CHANGELOG.md README.md
git commit -m "docs: document agent hook manager delivery"
```

---

## Self-Review

Spec coverage:

- Pluggable HookManager interface: Task 1.
- HookPlugin registration and lifecycle: Task 1.
- Non-blocking observe hook queue and bounded flush: Task 1.
- Gate hooks before preflight/budget and blocked tool events: Task 4.
- Transform hooks defined but pass-through in v1: Task 1.
- Built-in TraceRecorderHook and DebugLogHook: Task 2.
- SQLite trace storage: Task 2.
- Runtime singleton and dependency injection: Task 3.
- `pi-agent-core` callback bridge: Task 4.
- Model call pairing fields: Task 4.
- Memory represented as normal `toolName: "memory"`: Tasks 2 and 6.
- `skill.loaded` only for explicit run usage, not workspace scanning: Task 5.
- Documentation and project record updates: Task 7.

Known deferred items from the spec that this plan intentionally does not implement:

- `gate.wait` semantics.
- External JavaScript hook plugin loading.
- Transform hook execution.
- `skill.listed` and `skill.injected`.
- `subagent.*`, `context.persist.*`, `approval.*`, and `sandbox.*` emit points.
- UI event unification through `UiEventHook`.

Placeholder scan:

- The plan contains no `TBD`, `TODO`, or undefined task placeholders.
- Code snippets use concrete paths, function names, stage names, and expected commands.

Type consistency:

- `HookStage`, `HookContext`, `RuntimeHook`, `HookPlugin`, and `HookManager` names match across tasks.
- `emit()` returns `void`; only `gate()` and `flush()` are awaited.
- `tool.call.blocked` uses `blockedBy: "hook_gate" | "preflight" | "budget"` consistently.
- Model pairing fields are `modelAttemptId`, `candidateIndex`, `attemptIndex`, and `modelCallSeq` consistently.

