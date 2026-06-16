# Event Run Timeout, Abort, and Retry Design

## Status

- Draft
- Date: 2026-05-31
- Scope: shared runtime, event execution, runner lifecycle, stop semantics

## Background

Molibot currently supports periodic and one-shot event execution through watched event JSON files and channel runtime event watchers. In production, a periodic event can enter a stuck state where:

1. the event has already started execution,
2. the underlying agent run never finishes,
3. the channel command `/stop` reports `Nothing running.`,
4. later user messages trigger a second `prompt()` call and fail with `Agent is already processing a prompt.`

This creates two product failures:

- operators cannot reliably stop a stuck scheduled task,
- scheduled tasks have no bounded execution or controlled retry behavior.

The immediate user requirement is:

- scheduled tasks must support automatic retry,
- default timeout must be 10 minutes and configurable,
- timeout handling must forcibly abort the current run before retry,
- retries must be capped at 3 attempts,
- the stuck-state class of bugs must be structurally reduced rather than papered over in a single channel.

## Problem Statement

The current system has no single shared source of truth for an active scheduled event attempt.

Today there are at least three different state views:

1. channel-local event queue state,
2. runner in-memory `running` / agent `activeRun` state,
3. persisted turn status in the shared `runs` table.

These views can diverge. In the reported incident:

- the periodic event started via the Telegram event watcher,
- the model produced a `bash` tool call,
- no matching `toolResult` ever arrived,
- the agent remained busy internally,
- later `/stop` consulted a path that concluded no active runner was available,
- a later user message was processed as a fresh prompt and failed on the agent's concurrent prompt guard.

This is not a normal “long task” problem. It is a coordination problem between event ownership, runner ownership, and stop/recovery semantics.

## Goals

1. Scheduled tasks have a bounded maximum execution time.
2. Timeout expiry forcibly aborts the current run before any retry begins.
3. Retry behavior is shared across channels and event types, not reimplemented per channel.
4. `/stop` can stop a scheduled task even when channel-local runner state and event state disagree.
5. Restart recovery can detect and clean stale active scheduled attempts.
6. Operators can inspect why an event is running, retrying, failed, or stopped.

## Non-Goals

1. Redesigning all user-message queue semantics in this change.
2. Adding arbitrary retry policies per individual event file.
3. Building a generic distributed scheduler beyond the current watched event JSON model.
4. Solving every possible external tool hang source in one pass.

## Design Overview

Introduce a shared persisted **event execution lease** layer above channel event watchers and below runner execution. Every scheduled event attempt must acquire a lease before entering the runner. The lease becomes the canonical source of truth for:

- whether an event attempt is active,
- which session/run it owns,
- how long it has been running,
- how many attempts have already been used,
- whether it timed out, failed, or was manually stopped.

Timeout, retry, manual stop, and restart cleanup will all operate against this shared lease state.

At the same time, event-triggered tool execution paths should gain bounded tool-level timeout protection for common host commands like `curl`, so the runner is less likely to wait forever on a dead tool.

## Why This Approach

### Option A: shared event lease with timeout and retry

Pros:

- one source of truth for scheduled task execution,
- shared stop semantics,
- shared retry semantics,
- restart cleanup becomes deterministic,
- channel layer remains focused on transport and event delivery.

Cons:

- requires persisted coordination state and runner integration.

### Option B: channel watcher-only timeout and retry

Pros:

- less code initially.

Cons:

- `/stop` remains inconsistent,
- state still splits between watcher and runner,
- cross-channel duplication risk remains high.

### Option C: only add bash/tool timeout

Pros:

- cheap partial mitigation.

Cons:

- does not fix `Nothing running`,
- does not give retry behavior,
- does not unify event lifecycle.

### Recommendation

Implement Option A, and include a narrow tool-timeout hardening pass for known external command paths.

## Architecture Changes

### 1. Shared Event Execution Lease Store

Add a shared persisted store for scheduled event attempts. This can live in SQLite beside other runtime coordination data.

Suggested record shape:

- `id`
- `event_file`
- `event_type`
- `trigger_slot`
- `chat_id`
- `session_id`
- `channel`
- `run_id`
- `status`
- `attempt`
- `max_attempts`
- `timeout_ms`
- `started_at`
- `last_heartbeat_at`
- `finished_at`
- `stop_reason`
- `last_error`
- `retry_scheduled_at`
- `event_payload_json`

The lease store must enforce atomic ownership. V1 should use a SQLite transaction and a partial/semantic uniqueness rule equivalent to:

- only one active lease for the same `event_file + session_id + trigger_slot`,
- active statuses are `pending`, `running`, and `retry_wait`,
- a retry creates a new attempt row or advances the same logical cycle only after the previous attempt has transitioned out of `running`.

For periodic events, `trigger_slot` is the cron minute slot already computed by the watcher. Attempts 1-3 belong to that single slot. The next cron slot starts a new retry budget.

Suggested status values:

- `pending`
- `running`
- `retry_wait`
- `completed`
- `failed`
- `aborted`

### 2. Event Attempt Lifecycle

For each watched event execution:

1. watcher resolves the event file and payload,
2. runtime asks the lease store to acquire or resume the event attempt,
3. if no attempt is active, create attempt 1 with `running`,
4. if a retryable failed/timeout attempt exists and retry budget remains, create the next attempt,
5. start the runner with a bound `runId`, `sessionId`, `eventFile`, and timeout policy,
6. while running, keep the lease heartbeat fresh,
7. on successful completion, mark `completed`,
8. on manual stop, mark `aborted`,
9. on timeout, force abort and either move to `retry_wait` or final `failed`,
10. on non-timeout failure, evaluate whether the event should retry or finish failed.

The watched event JSON file is no longer the execution lock. It remains the scheduling input and operator-facing mirror. Active execution ownership comes only from the lease store.

For `delivery=text` events, V1 still records a lease so stop/status/retry accounting is consistent. The abort path is a no-op after the outbound send has returned or failed, because no agent runner exists. For `delivery=agent`, timeout must abort the runner before retry.

### 3. Timeout Watchdog

Each active scheduled event attempt must be monitored by a timeout watchdog keyed by lease id or run id.

Default behavior:

- default timeout: `600000` ms,
- configurable globally,
- per-event override is optional future work, not required now.

When timeout expires:

1. mark the lease as timed out in persistent state,
2. call shared abort against the current runner/session/run,
3. revoke the stale running turn if needed,
4. wait for cleanup boundary or perform forced cleanup,
5. if `attempt < max_attempts`, create next retry attempt,
6. otherwise mark final `failed`.

The abort boundary must update all logical owners before retry starts:

- abort the in-memory runner if it is available,
- mark the corresponding `runs` row `aborted` or `failed` with a timeout reason,
- reset the runner pool entry when the runner handle is stale,
- mark the lease `retry_wait` or final `failed`,
- mirror timeout metadata back to the event JSON file.

This avoids the dangerous state where the next attempt starts while the old attempt still owns the agent session.

### 4. Retry Policy

Default retry policy for scheduled tasks:

- `maxAttempts = 3`
- retry trigger includes timeout
- retry delay can be immediate for V1, or a short backoff such as `5s`, `15s`

Recommended V1 policy:

- attempt 1 timeout -> abort -> retry 2 after short delay
- attempt 2 timeout -> abort -> retry 3 after short delay
- attempt 3 timeout -> abort -> final failed

Manual `/stop` must not schedule a retry.

### 5. `/stop` Semantics

Current `/stop` behavior is too dependent on in-memory runner availability. The new behavior must consult both:

1. active runner state,
2. active event execution lease state.

Desired logic:

1. resolve active session,
2. attempt normal runner abort,
3. check persisted running turn records for the session,
4. check event execution lease for active scheduled attempts,
5. if any of the above are active, force-stop them and mark state,
6. only return `Nothing running.` if all sources agree there is no active work.

This ensures scheduled tasks are stoppable even if the channel-local runner handle is stale or missing.

### 6. Busy Message Handling During Stuck Event Runs

The root stuck state should be fixed, but user messages arriving during an event run should still behave safely.

The runtime should not rely on channel queue state alone when deciding whether fresh user input can start a new prompt. Shared busy checks should consider:

- active runner,
- active running turn in persistent store,
- active event execution lease for the same session/scope.

If any are active, user input must be queued or converted into a follow-up path instead of attempting a fresh `prompt()`.

### 7. Tool Timeout Hardening

The event lease layer fixes coordination, but not the original hang source. Narrow tool hardening should be included:

- wrap external shell/network calls with explicit process timeout,
- add bounded timeout to `curl`-like network fetches where Molibot directly constructs commands,
- surface timeout as a structured tool failure,
- ensure timed-out tools yield a `toolResult`/error path rather than leaving the runner waiting forever.

This change should stay focused:

- no broad shell framework redesign,
- only harden known event-path external commands enough to avoid infinite waits.

## Persistence Design

### SQLite Table

Suggested new table:

`event_execution_leases`

Core indexes:

- by `event_file`
- by `event_file`, `session_id`, `trigger_slot`, and active status
- by `session_id` and `status`
- by `run_id`
- by `status` and `last_heartbeat_at`

This store is operational state, not normal conversation memory.

### Event File Status Synchronization

The watched event JSON file already carries execution metadata today. That metadata must remain consistent with the lease store.

At minimum, event file status should include:

- current state,
- last started time,
- last finished time,
- last error,
- current or last attempt number,
- total attempts used in the current trigger cycle,
- timeout config in effect if needed for debugging.

The lease store is the coordinator. Event JSON is the operator-facing mirror.

If mirror update fails, the lease transition still wins. The runtime should log the mirror failure as an operational event and continue from the lease state.

## Failure Semantics

### Success

- lease -> `completed`
- event file status -> `pending` for next periodic cycle, or terminal completed for one-shot
- running turn -> completed

### Timeout

- lease -> `retry_wait` or final `failed`
- run -> aborted/failed with timeout reason
- event file -> error metadata with timeout reason and attempt count

### Manual Stop

- lease -> `aborted`
- no retry
- event file -> stopped/aborted metadata

### Process Restart

On startup:

1. scan running turns,
2. scan running event leases,
3. if a lease or turn is stale beyond timeout, mark and release it,
4. if retry budget remains and policy allows retry on restart recovery, requeue the attempt,
5. otherwise mark final failed.

V1 recommendation:

- stale running event attempt on startup should be treated as failed timeout and, if retry budget remains, requeued once through the normal retry path.

## Configuration

Add shared runtime settings for scheduled event retry control:

- `events.executionTimeoutMs`
- `events.maxAttempts`
- optional `events.retryDelayMs`

Default values:

- `executionTimeoutMs = 600000`
- `maxAttempts = 3`
- `retryDelayMs = 5000`

These settings should be global first. Channel-specific divergence is not needed for this work.

## Channel Boundary

This design intentionally keeps event orchestration out of channel-specific business logic.

Channel responsibilities remain:

- watch input/events,
- normalize inbound messages,
- display human-readable progress and errors,
- convert platform commands to shared runtime calls.

Shared upper-layer responsibilities become:

- event lease creation and ownership,
- timeout watchdog,
- retry scheduling,
- stop semantics,
- stale lock cleanup,
- retry budget handling.

This matches the existing project rule that queueing, recovery, insertion, deletion, orchestration, and cross-channel execution control must live above the channel layer.

## Observability

Add structured runtime events for:

- event attempt started
- heartbeat refreshed
- timeout triggered
- forced abort requested
- retry scheduled
- retry started
- retry exhausted
- manual stop applied
- stale lease recovered on startup

These events should be persisted as runtime events or run details, not injected into model history.

## Risks

1. Forced abort may not instantly kill every external subprocess
   Mitigation:
   - keep runner/turn cleanup and event lease cleanup independent,
   - if subprocess termination is imperfect, do not let stale logical ownership block retries forever.

2. Retrying a timed-out task may duplicate side effects
   Mitigation:
   - accept this tradeoff for scheduled tasks that already imply idempotent or operator-tolerant workflows,
   - make timeout, abort, and retry visible in logs and event status.

3. Multiple coordination stores can drift again
   Mitigation:
   - define lease store as canonical for event execution ownership,
   - treat event JSON as mirror and runner state as execution detail.

## Decision Summary

The correct fix is not “just add a timeout” and not “just patch Telegram `/stop`”. The system needs a shared event execution lease that coordinates:

- active scheduled attempt ownership,
- timeout-based forced abort,
- bounded retry,
- restart cleanup,
- manual stop semantics,
- safe busy detection for later user input.

This is the minimum design that solves both the visible symptom and the underlying coordination failure.
