# Findings & Decisions

## Requirements
- Update `docs/agent-execution/event-run-timeout-retry-design.md` so the design is implementation-ready.
- Implement scheduled task automatic retry with default timeout 10 minutes, configurable, capped at 3 attempts.
- Timeout must abort the current run before retrying.
- `/stop` must stop scheduled runs even when in-memory channel runner state is stale.
- Keep queue/retry/recovery/orchestration in shared runtime, not channel-specific code.
- Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` after functional changes.

## Research Findings
- `EventsWatcher` currently writes `status.state = running` into event JSON and uses a TTL, but that only gates periodic dispatch and does not abort the underlying runner/tool.
- `BaseChannelRuntime.stopChatWork()` aborts active runner if found, otherwise marks running turns aborted. It does not consult event execution ownership.
- `TurnOrchestrator.prepareTurn()` auto-releases running turns older than 10 minutes, but this only changes the `runs` table and does not stop the actual agent.
- `RunnerPool.abort()` can abort only if the current runner instance is found and running.
- Existing direct event delivery and agent event delivery enter through channel-specific event handlers; V1 should add shared execution ownership without duplicating retry logic per channel.
- `TaskScheduler` owns workspace/bot event watchers; Telegram also starts chat-scratch watchers. Both now need to pass shared event execution settings and timeout abort hooks into `EventsWatcher`.
- Channel `triggerTask()` methods need to honor the run id assigned by the lease, otherwise timeout/retry cannot correlate the lease with the `runs` row.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Add an `event_execution_leases` table | Event JSON alone cannot provide atomic ownership, bounded retries, or reliable stop semantics. |
| Use lease status transitions as canonical state | Prevents drift between watcher JSON status, runner memory, and `runs`. |
| Use event JSON as mirror | Operators can inspect status without letting JSON become the source of truth for active execution. |
| Treat attempts as belonging to one trigger cycle | Periodic retries must reset on the next cron slot. |
| Add `RuntimeSettings.events` | Makes timeout, max attempts, and retry delay configurable without per-channel divergence. |
| Add `abortTaskRun()` separately from `stopTask()` | Timeout abort must not mark the lease as manually stopped, because manual stop suppresses retry. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `git status` emitted sandbox temp-cache warnings | It still reported the worktree status; no retry needed. |
| `npx tsx --test` could not create a local IPC pipe under sandbox | Used `node --import tsx --test` for focused tests. |
| Same trigger slot could be reacquired after final failure | `EventExecutionLeaseStore.acquire()` now refuses any existing terminal same-slot lease; next periodic cron slot uses a different `triggerSlot`. |
| Existing `TurnOrchestrator` tests cannot write the configured SQLite DB in this read-only sandbox | Recorded as verification limitation; new lease store tests use in-memory SQLite and passed. |

## Resources
- `/Users/gusi/Github/molipibot/docs/agent-execution/event-run-timeout-retry-design.md`
- `/Users/gusi/Github/molipibot/src/lib/server/agent/events.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/channels/shared/baseRuntime.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/agent/core/turnOrchestrator.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/agent/core/runnerPool.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/agent/eventsLeaseStore.ts`

## Visual/Browser Findings
- None.
