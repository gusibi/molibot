# HookManager Runtime Extension Design

## Goal

Introduce a pluggable HookManager as a thin multiplexer layer mounted on top of `pi-agent-core`'s existing Agent callbacks. The HookManager does not replace or duplicate the Agent's lifecycle — it fans out the Agent's single-slot callbacks (`beforeToolCall`, `afterToolCall`, `subscribe`, `onPayload`, `onResponse`) into a multi-plugin registration system.

Trace recording, usage statistics, audit logs, result export, notifications, and future integrations such as S3 upload should be implemented as hook plugins registered with the HookManager, instead of being hard-coded into Runner, ToolRuntime, channel adapters, or skill loading logic.

The first implementation should define and implement the hook interface, manager, execution semantics, and built-in registration path. Detailed trace recording is the first built-in hook consumer, not the foundation of the system.

## Architecture

HookManager is a **multiplexer**, not a replacement for `pi-agent-core`:

```
┌─────────────────────────────────────────────────────────┐
│  pi-agent-core  Agent                                   │
│                                                         │
│  beforeToolCall ──┐                                     │
│  afterToolCall  ──┤                                     │
│  onPayload      ──┼──→  HookManager (multiplexer)       │
│  onResponse     ──┤         │                           │
│  subscribe()    ──┘         ├── TraceRecorderHook        │
│                             ├── DebugLogHook             │
│                             ├── UsageStatsHook (future)  │
│                             └── S3ExportHook (future)    │
│                                                         │
│  Molibot-only lifecycle (no pi-agent-core equivalent):  │
│                                                         │
│  Runner          ──emit──→  HookManager                 │
│    run.beforeStart, input.enrich.*, prompt.build.*,     │
│    skill.*, context.persist.*, runtime.notice           │
│                                                         │
│  ToolRuntime     ──emit──→  HookManager                 │
│    approval.*, sandbox.*                                │
└─────────────────────────────────────────────────────────┘
```

### Event source categories

Stages are divided into two categories based on where the event originates:

**Category A — Bridged from `pi-agent-core` Agent events.**
These stages have a direct `pi-agent-core` event or callback that drives them. The HookManager wires into the existing single-slot callback and fans out to registered plugins. No manual `emit()` calls are needed in Runner or ToolRuntime for these.

**Category B — Custom emit points.**
These stages have no `pi-agent-core` equivalent. The molibot code must call `hookManager.emit()` (or `gate()`) explicitly at the appropriate locations.

## Non-Goals

- Do not reimplement lifecycle events that `pi-agent-core` already provides. Mount on them.
- Do not create a separate `memory.*` hook family. Memory is already exposed as a tool, so memory activity is observed through `tool.call.*` with `toolName: "memory"`.
- Do not put HookManager logic in Channel runtimes. Channels should keep normalizing inbound messages and delivering outbound messages.
- Do not allow arbitrary external JavaScript hook plugins in the first version. External runnable hooks need a later security design for permissions, secrets, sandboxing, and timeout behavior.
- Do not persist hook events as normal conversation messages or feed them back into model context by default.

## Design Principles

1. HookManager is a thin multiplexer on `pi-agent-core` callbacks.
   - It does not own lifecycle. The Agent does.
   - For stages that map to Agent events, HookManager receives events from the Agent's single-slot callbacks and fans them out.
   - For molibot-only stages, Runner/ToolRuntime call `hookManager.emit()` directly.

2. Hook plugins use one stable interface.
   - Built-in trace hooks and future hooks such as S3 export use the same `RuntimeHook` contract.
   - Adding a new hook plugin should not require modifying existing Runner or ToolRuntime logic if the stage already exists.

3. Hooks have explicit capability classes.
   - `observe`: receives events but cannot change runtime data.
   - `transform`: may return a changed payload for approved stages such as prompt/input/model selection. Defined in v1 but not enabled until observe hooks are stable.
   - `gate`: may allow or deny for controlled stages such as tool execution and sandbox preparation. `wait` semantics are deferred to a future version.

4. Hook failures must not silently break Agent execution.
   - Non-critical hook failures are recorded as hook errors and execution continues.
   - Critical hooks may fail the current operation, but should be used only for security, approval, and strict policy hooks.

5. Sensitive data is opt-in.
   - Hook payloads should default to metadata and summaries.
   - Full prompt, tool input/output, file content, API keys, credentials, and raw user attachments must be excluded unless a specific hook and setting opts into them.

6. Observe hooks are asynchronous and non-blocking by default.
   - Observe hooks (`emit`) are enqueued into a non-blocking queue/promise chain.
   - Runtime call sites should not `await hookManager.emit(...)` on the critical path.
   - HookManager may expose a separate `flush()` method for shutdown, tests, and best-effort run-finalization.
   - Writing traces to SQLite or sending debug logs must not block the agent's main turn execution or increase LLM response latency.

7. TraceRecorder state isolation.
   - Global hook singletons must remain stateless or store execution state (like active span stacks) strictly keyed by `runId`.
   - When a run finishes (`run.finished`), its corresponding in-memory state must be purged to prevent memory leaks and state contamination.

## Core Types

```ts
export type HookKind = "observe" | "transform" | "gate";

export type HookStage =
  // ── Category A: Bridged from pi-agent-core ──
  | "run.started"            // ← Agent subscribe: agent_start
  | "run.finished"           // ← Agent subscribe: agent_end
  | "model.call.before"      // ← Agent onPayload
  | "model.call.after"       // ← Agent onResponse
  | "assistant.message.stream" // ← Agent subscribe: message_start / message_end (deferred)
  | "tool.call.before"       // ← Agent beforeToolCall
  | "tool.call.after"        // ← Agent afterToolCall
  | "tool.call.error"        // ← Agent afterToolCall (isError === true)
  | "tool.call.blocked"      // ← beforeToolCall bridge when gate/preflight/budget blocks execution
  // ── Category B: Custom emit points (molibot-only) ──
  | "run.beforeStart"
  | "input.enrich.before"
  | "input.enrich.after"
  | "prompt.build.before"
  | "prompt.build.after"
  | "model.select.before"
  | "model.select.after"
  | "skill.selected"
  | "skill.loaded"           // Represents a skill loaded & compiled for execution in this run, not workspace scanning.
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
  /** Span info is maintained by individual hooks (e.g. TraceRecorderHook), not forced on all consumers. */
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
  // "wait" is deferred to a future version.

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
```

### Changes from v0 draft

- `HookContext` simplified: removed `traceId`, `turnId`, `spanId`, `parentSpanId`. Span tracking is the responsibility of `TraceRecorderHook` internally, not a universal context field.
- `GateDecision.wait` removed from first version. Existing approval polling in ToolRuntime stays as-is; it is not generalized into gate hooks yet.
- `HookStage` split into Category A (bridged) and Category B (custom emit). Removed `skill.listed` and `skill.injected` — these require a SkillRuntime refactor that is out of scope.

## HookManager API

```ts
export interface HookManager {
  register(hook: RuntimeHook): void;
  unregister(id: string): boolean;
  list(): RuntimeHook[];

  registerPlugin(plugin: HookPlugin): Promise<void>;
  unregisterPlugin(id: string): Promise<boolean>;

  /** Enqueue all observe hooks for a stage. Never blocks the caller for non-critical hooks. */
  emit<TPayload>(
    stage: HookStage,
    context: HookContext,
    payload: TPayload
  ): void;

  /** Best-effort drain for tests, shutdown, and bounded run-finalization. */
  flush(options?: { timeoutMs?: number }): Promise<void>;

  /**
   * Run all transform hooks and pipe payload through them in priority order.
   * Defined in v1 but disabled by default — returns the original payload unchanged.
   * Enable via RuntimeSettings when observe hooks are proven stable.
   */
  transform<TPayload>(
    stage: HookStage,
    context: HookContext,
    payload: TPayload
  ): Promise<TPayload>;

  /** Run gate hooks and return the first non-allow decision, or allow. Gate hooks are awaited. */
  gate<TPayload>(
    stage: HookStage,
    context: HookContext,
    payload: TPayload
  ): Promise<GateDecision>;
}
```

Execution rules:

- `emit` only enqueues `observe` hooks and returns immediately.
- `flush` drains queued observe hooks with a bounded timeout. It is intended for tests, graceful shutdown, and best-effort finalization, not normal runtime stages.
- `transform` only runs `transform` hooks and pipes the returned payload from one hook into the next. Disabled by default in v1 (pass-through).
- `gate` only runs `gate` hooks and returns the first non-allow decision.
- Hooks are ordered by ascending `priority` (default 50), then by registration order.
- Duplicate hook ids are rejected.
- Every hook call has a timeout:
  - `observe`: 3 seconds default
  - `transform`: 5 seconds default
  - `gate`: 10 seconds default
- `AbortSignal` from the runtime context is passed through to hook handlers. Observe hooks should NOT be cancelled by AbortSignal (they record data that should survive user cancellation). Gate/transform hooks should respect AbortSignal.
- Non-critical failures produce a `hook.error` diagnostic event and continue.
- Critical failures return deny/error behavior appropriate to the caller.

## pi-agent-core Bridge Wiring

This section describes how the HookManager connects to `pi-agent-core`'s single-slot callbacks. The bridge is set up once in Runner during Agent construction.

### beforeToolCall bridge

The Agent's `beforeToolCall` callback already handles preflight validation and budget checking. The HookManager is added as additional steps within this same callback, with gate checks running first to block execution before spending budget/validating:

```ts
this.agent = new Agent({
  // ...
  beforeToolCall: async (context, signal) => {
    // 1. NEW: gate hooks (policy enforcement) - run first to block dangerous actions early
    const gateResult = await hookManager.gate("tool.call.before", hookCtx, {
      toolName: context.toolCall.name,
      toolCallId: context.toolCall.id,
    });
    if (gateResult.type === "deny") {
      hookManager.emit("tool.call.blocked", hookCtx, {
        toolName: context.toolCall.name,
        toolCallId: context.toolCall.id,
        blockedBy: "hook_gate",
        reason: gateResult.reason,
      });
      return { block: true, reason: gateResult.reason };
    }

    // 2. Existing logic: preflight + budget (unchanged)
    const blockedReason = validateToolCallPreflight(context, { ... });
    const budgetResult = this.activeRunBudget?.tryStartTool() ?? { ok: true };
    const finalBlockedReason = blockedReason ?? budgetResult.reason;
    if (finalBlockedReason) {
      if (!budgetResult.ok) this.agent.state.tools = [];
      hookManager.emit("tool.call.blocked", hookCtx, {
        toolName: context.toolCall.name,
        toolCallId: context.toolCall.id,
        blockedBy: blockedReason ? "preflight" : "budget",
        reason: finalBlockedReason,
      });
      return { block: true, reason: finalBlockedReason };
    }

    // 3. NEW: observe hooks (trace, audit)
    hookManager.emit("tool.call.before", hookCtx, {
      toolName: context.toolCall.name,
      toolCallId: context.toolCall.id,
      argsPreview: summarizeArgs(context.args),
    });

    return undefined; // allow execution
  },
});
```

### afterToolCall bridge

The Agent's `afterToolCall` slot is currently unused. The HookManager occupies it:

```ts
this.agent = new Agent({
  // ...
  afterToolCall: async (context, signal) => {
    const stage = context.isError ? "tool.call.error" : "tool.call.after";
    hookManager.emit(stage, hookCtx, {
      toolName: context.toolCall.name,
      toolCallId: context.toolCall.id,
      isError: context.isError,
      resultPreview: summarizeResult(context.result),
    });
    return undefined; // do not modify result
  },
});
```

### subscribe bridge

A second subscriber is added alongside the existing UI event subscriber:

```ts
// Existing UI subscriber (unchanged)
const unsubUI = this.agent.subscribe((event: AgentEvent) => {
  // ... existing UI event handling logic stays exactly as-is ...
});

// NEW: HookManager subscriber
const unsubHooks = this.agent.subscribe(async (event: AgentEvent, signal) => {
  switch (event.type) {
    case "agent_start":
      hookManager.emit("run.started", hookCtx, {
        messageId: ctx.message.messageId,
        textLength: ctx.message.text.length,
        attachmentCount: ctx.message.attachments.length,
      });
      break;

    case "agent_end":
      hookManager.emit("run.finished", hookCtx, {
        status: resolveStatus(event.messages),
        durationMs: Date.now() - turnStartedAt,
        messageCount: event.messages.length,
      });
      await hookManager.flush({ timeoutMs: 500 });
      break;

    case "turn_start":
      // Per-LLM-turn event (within one agent run, there can be multiple turns)
      // Useful for model.call tracking
      break;

    case "turn_end":
      // Complements turn_start
      break;
  }
});
```

### onPayload / onResponse bridge

The existing `onPayload` callback already handles UI events. HookManager emits are added to it:

```ts
this.agent = new Agent({
  // ...
  onPayload: async (payload) => {
    // Existing UI event logic (unchanged)
    if (this.activeRunnerEventSink && this.activePayloadContext) {
      await this.activeRunnerEventSink({ type: "payload", ... });
    }

    // NEW: emit to HookManager
    hookManager.emit("model.call.before", hookCtx, {
      modelAttemptId,
      candidateIndex,
      attemptIndex,
      modelCallSeq,
      provider: this.activePayloadContext?.provider,
      model: this.activePayloadContext?.model,
      api: this.activePayloadContext?.api,
    });

    return undefined;
  },

  onResponse: async (response) => {
    // NEW: emit model.call.after with usage info
    hookManager.emit("model.call.after", hookCtx, {
      modelAttemptId,
      candidateIndex,
      attemptIndex,
      modelCallSeq,
      provider: this.activePayloadContext?.provider,
      model: this.activePayloadContext?.model,
      usage: response.usage,
      stopReason: response.stopReason,
    });
    return undefined;
  },
});
```

### Summary: what is bridged vs. what is explicit

| Stage | Source | How it reaches HookManager |
|-------|--------|---------------------------|
| `run.started` | `agent_start` event | subscribe bridge |
| `run.finished` | `agent_end` event | subscribe bridge |
| `model.call.before` | `onPayload` callback | onPayload bridge |
| `model.call.after` | `onResponse` callback | onResponse bridge |
| `tool.call.before` | `beforeToolCall` callback | beforeToolCall bridge |
| `tool.call.after` | `afterToolCall` callback | afterToolCall bridge |
| `tool.call.error` | `afterToolCall` (isError) | afterToolCall bridge |
| `tool.call.blocked` | `beforeToolCall` block result | beforeToolCall bridge |
| All other stages | No pi-agent-core equivalent | Explicit `hookManager.emit()` in molibot code |

## Built-In Hook Registration

Create a shared factory:

```ts
export function createDefaultHookManager(options: {
  settings: RuntimeSettings;
  store: MomRuntimeStore;
}): HookManager;
```

The HookManager is a **global singleton**, created once in `RuntimeState` (app/runtime.ts) and injected into Runner and ToolRuntime via constructor or shared dependencies.

### First built-in hooks (v1)

- `TraceRecorderHook`
  - Listens to runtime stages and writes structured events to SQLite.
  - Internally maintains its own span stack for building trace trees.
  - It is implemented as a normal `RuntimeHook` — Runner does not know whether trace recording is enabled.

- `DebugLogHook`
  - Optional bridge for concise internal diagnostics.
  - Useful while migrating from scattered `momLog` calls.
  - Can be toggled on/off via settings.

### Future built-in hooks

- `UsageStatsHook` for model and tool usage aggregation.
- `AuditHook` for approval, sandbox, and high-risk tool history.
- `ResultExportHook` for configurable S3 or object storage upload after `run.finished`.
- `WebhookHook` for user-configured callbacks after selected stages.

## Stage Semantics

### Run

- `run.beforeStart` (Category B): channel has normalized input; run record may not exist yet. Emitted by Runner before `agent.prompt()`.
- `run.started` (Category A): bridged from `agent_start`. Run id, workspace id, session id exist.
- `run.finished` (Category A): bridged from `agent_end`. Final status and summary are available.

Expected payload examples:

```ts
type RunStartedPayload = {
  messageId: number;
  textLength: number;
  attachmentCount: number;
  imageCount: number;
  isEvent: boolean;
};

type RunFinishedPayload = {
  status: "success" | "failed" | "aborted" | "waiting_for_approval";
  stopReason: string;
  durationMs: number;
  finalTextLength: number;
  errorMessage?: string;
};
```

### Input and Prompt (Category B)

- `input.enrich.before/after` covers STT, vision routing, attachment preparation, and prompt input envelope construction.
- `prompt.build.before/after` covers system prompt/profile/bot rule merging.
- Prompt hooks must not store full prompt by default.

### Skill (Category B — v1 only selected + loaded)

- `skill.selected`: user or selector matched a skill.
- `skill.loaded`: full `SKILL.md` content was loaded or resolved from cache. Note that this refers only to skills explicitly loaded and used in this run, not the scanning of the workspace skills directory.
- `skill.listed` and `skill.injected` are deferred until a SkillRuntime abstraction exists.

### Model

- `model.select.before/after` (Category B): model routing decision, emitted by Runner before/after `resolveModelSelection()`.
- `model.call.before` (Category A): bridged from `onPayload`.
- `model.call.after` (Category A): bridged from `onResponse`.
- `assistant.message.stream` (Category A): bridged from `subscribe(message_start/message_end)` — optional, for streaming-level trace (deferred).

Model hook payloads should include provider, model id, API type, route, thinking level, message count, tool count, usage, and error classification. Full messages should be excluded by default.

Model call payloads must include stable pairing fields so TraceRecorder can deduplicate and match before/after events even if a provider callback fires more than once:

- `modelAttemptId`: stable id for one model attempt.
- `candidateIndex`: index in the model fallback candidate list.
- `attemptIndex`: retry index for the current candidate.
- `modelCallSeq`: monotonic sequence number within the run.

### Tool (Category A — all bridged)

All tool stages are bridged from `pi-agent-core` callbacks:

- `tool.call.before` ← `beforeToolCall`
- `tool.call.after` ← `afterToolCall` (isError === false)
- `tool.call.error` ← `afterToolCall` (isError === true)
- `tool.call.blocked` ← `beforeToolCall` when hook gate, preflight, or budget blocks execution

Memory is represented as:

```ts
{
  toolName: "memory",
  source: "builtin"
}
```

Tool payloads should include tool name, display name, source, risk, input summary, result summary, error status, and approval metadata when applicable. Raw input/output is sensitive and opt-in.

Blocked tool payloads should include:

```ts
{
  toolName: string;
  toolCallId: string;
  blockedBy: "hook_gate" | "preflight" | "budget";
  reason: string;
}
```

### Approval and Sandbox (Category B)

- `approval.requested`: approval request was created or surfaced.
- `approval.resolved`: approval was approved, rejected, or expired.
- `sandbox.prepare.before/after/error`: host/sandbox execution plan was prepared or failed.

Emitted explicitly by ToolRuntime at the appropriate locations.

### Subagent (Category B — deferred)

- `subagent.run.before/after`: one logical subagent tool invocation.
- `subagent.task.before/after`: each task in single, parallel, or chain mode.

Deferred from v1. Will be enabled when subagent runner receives parent hook context.

### Context Persistence (Category B — deferred)

- `context.persist.before/after`: before and after writing session context.

These stages are important for preventing prompt pollution. Deferred from v1 but the stage names are reserved.

## Pluggable Hook Example

An S3 result export should be possible without modifying Runner:

```ts
export const s3ResultHook: RuntimeHook<RunFinishedPayload> = {
  id: "s3-result-export",
  name: "S3 Result Export",
  kind: "observe",
  stages: ["run.finished"],
  priority: 100,
  timeoutMs: 5000,
  async handle(event) {
    if (event.stage !== "run.finished") return;
    await uploadResultToS3({
      runId: event.context.runId,
      sessionId: event.context.sessionId,
      status: event.payload.status,
      finalTextLength: event.payload.finalTextLength
    });
  }
};

// Registration — no Runner changes needed:
hookManager.register(s3ResultHook);
```

If a future result export needs full final text, that should be enabled by explicit setting and marked as sensitive data.

## Integration Points

Integration is divided into bridge wiring (one-time, in Runner constructor) and explicit emit calls (scattered, in molibot-specific code).

### One-time bridge wiring (in MomRunner)

The following changes are made once in `runner.ts` when constructing the Agent:

1. Extend `beforeToolCall` callback to call `hookManager.gate()` before existing preflight/budget logic. Emit `tool.call.blocked` when hook gate, preflight, or budget blocks execution. Emit `tool.call.before` only for tool calls that will execute.
2. Add `afterToolCall` callback (currently unused) that calls `hookManager.emit()`.
3. Extend `onPayload` callback to call `hookManager.emit("model.call.before")` after existing UI event logic.
4. Add `onResponse` callback (currently unused) that calls `hookManager.emit("model.call.after")`.
5. Add a second `agent.subscribe()` listener that bridges `agent_start` → `run.started` and `agent_end` → `run.finished`.

### Existing ToolRuntime `context.emit()` — not replaced

The existing `context.emit()` calls in ToolRuntime serve the UI event pipeline (`RunnerUiEvent` → channel display). These are **not replaced** by HookManager. The two systems serve different purposes:

- `context.emit()` → UI rendering (status updates, streaming display)
- `hookManager.emit()` → trace, audit, stats, export (backend recording)

In the future, a `UiEventHook` could unify them, but this is not a v1 goal.

### Explicit emit calls (Category B stages)

These require adding `hookManager.emit()` calls at specific locations in molibot code:

| Stage | Location | When to emit |
|-------|----------|-------------|
| `run.beforeStart` | Runner.run(), before prepareTurn() | Channel has normalized input |
| `input.enrich.before/after` | Runner.run(), around prepareEnrichedInput() | Before/after STT, vision, attachments |
| `prompt.build.before/after` | Runner.run(), around buildSystemPrompt() | Before/after prompt construction |
| `model.select.before/after` | Runner.run(), around resolveModelSelection() | Before/after model routing |
| `skill.selected` | Runner.run(), after findExplicitlyInvokedSkills() | Skill matched |
| `skill.loaded` | Runner.run(), after explicit skill file content is loaded for prompt injection | Skill content loaded only for explicitly invoked and actually used skills |
| `approval.requested` | ToolRuntime, after createRequest() | Approval surfaced |
| `approval.resolved` | ToolRuntime, after poll resolves | Approval decided |
| `sandbox.prepare.*` | ToolRuntime, around sandbox prep | Sandbox lifecycle |
| `runtime.notice` | Runner, at runtime notice injection | Notice emitted |

### App runtime

- Create the HookManager singleton once in `RuntimeState` initialization (app/runtime.ts).
- Register built-in hooks (`TraceRecorderHook`, `DebugLogHook`) during startup.
- Pass the HookManager instance to Runner via constructor or shared dependencies.

## Data Privacy

Default hook payloads should avoid:

- Full user prompt.
- Full system prompt.
- Full tool input/output.
- File contents.
- Attachment contents.
- API keys, tokens, credentials, cookies, and auth headers.
- Absolute local machine paths in user-facing exports.

Allowed by default:

- ids, timestamps, status, durations.
- provider/model ids.
- token usage numbers.
- tool names and risk/source classification.
- content hashes.
- short summaries and bounded previews after redaction.

Sensitive but opt-in via `includeSensitiveData`:

| Field | Default | Opt-in |
|-------|---------|--------|
| Full system prompt | hash only | full text |
| Full user message | textLength only | full text |
| Tool input | args summary | full JSON |
| Tool output | result summary | full result |
| Model response | token count only | full text |
| File attachment content | filename + size | content (with size cap) |
| API keys/tokens | never | never (not opt-in-able) |

## Verification

### Unit tests

- Register/unregister/list hooks.
- Reject duplicate hook ids.
- Execute hooks by stage and priority.
- Non-critical hook failure does not throw.
- Critical hook failure returns caller-visible failure.
- Hook timeout is handled.
- Transform hooks pipe payload changes in order (when enabled).
- Gate hooks stop on first deny.

### Integration tests

- Agent `agent_start` event triggers `run.started` observe hooks via bridge.
- Agent `agent_end` event triggers `run.finished` observe hooks via bridge.
- `afterToolCall` bridge emits `tool.call.after` for a normal tool.
- `afterToolCall` bridge emits `tool.call.error` when tool fails.
- `beforeToolCall` bridge runs gate hooks before preflight.
- `beforeToolCall` bridge emits `tool.call.blocked` for hook-gate, preflight, and budget blocks.
- Memory tool activity appears only as `toolName: "memory"`.
- `model.call.before` and `model.call.after` include modelAttemptId/candidateIndex/attemptIndex/modelCallSeq.
- `skill.loaded` is not emitted by workspace scanning; it is emitted only when explicit skill content is loaded for the current run.
- Runtime notices are emitted as hook events and are not persisted as normal model messages.

### Manual verification

- Register a test hook that listens to `run.finished` and writes a local JSONL line.
- Run one Web Chat request.
- Confirm the hook receives run id, status, duration, and final text length without changing Runner logic beyond the initial bridge wiring.

## Design Decisions (resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Code-only or config-loadable plugins? | Code-only built-ins in v1 | Security design for external plugins is out of scope |
| Trace storage: JSONL or SQLite? | SQLite first | Project already uses SQLite everywhere; supports queries by runId/stage |
| Transform hooks enabled in v1? | Defined but disabled (pass-through) | Let observe hooks stabilize first |
| Default timeouts? | observe: 3s, transform: 5s, gate: 10s | Observe slightly longer than v0 draft (trace writes may be slow); gate longest for policy queries |
| gate.wait semantics? | Deferred | Existing approval polling stays as-is; generalizing wait is complex and not needed yet |
| HookManager scope? | Global singleton in RuntimeState | All chats share the same hook set; per-chat differentiation via HookContext fields |
| Span tracking ownership? | TraceRecorderHook internal | HookContext stays lean; only trace consumers need span trees |

## V1 Implementation Scope

### Included in v1

- HookManager core: `register`, `unregister`, `list`, non-blocking `emit`, bounded `flush`, `gate` (allow/deny only), `transform` (pass-through stub).
- Bridge wiring: `beforeToolCall`, `afterToolCall`, `subscribe`, `onPayload`, `onResponse` → HookManager.
- Built-in hooks: `TraceRecorderHook`, `DebugLogHook`.
- Category B emit points: `run.beforeStart`, `model.select.before/after`, `skill.selected`, `skill.loaded`.
- Timeout and error handling for all hook executions.
- Unit tests for HookManager core.
- Integration tests for bridge wiring.

### Deferred from v1

- Transform hook execution (interface defined, implementation pass-through).
- `gate.wait` semantics.
- `skill.listed`, `skill.injected` (need SkillRuntime refactor).
- `subagent.*` stages (need parent hook context propagation).
- `context.persist.*` stages (need context management refactor).
- `input.enrich.*`, `prompt.build.*` (lower priority, add when trace coverage is needed).
- `approval.*`, `sandbox.*` (keep existing ToolRuntime logic, add emit points when audit hook is built).
- External plugin loading.
- UI event unification via `UiEventHook`.
