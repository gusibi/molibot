# Task Plan: Event Run Timeout, Abort, and Retry

## Goal
Implement a shared scheduled-event execution lease so stuck event runs can be timed out, aborted, retried up to three attempts, stopped reliably, and observed without moving orchestration into channel code.

## Current Phase
Phase 1

## Phases

### Phase 1: Discovery And Spec Tightening
- [x] Review user request and existing design document
- [x] Inspect current event watcher, shared runtime stop, runner pool, and turn orchestrator
- [x] Update the design document with concrete implementation constraints
- **Status:** complete

### Phase 2: Lease Store And Runtime Interfaces
- [x] Add persisted event execution lease store
- [x] Add shared event executor/watchdog interfaces
- [x] Add busy/stop helpers that consult leases and runs
- **Status:** complete

### Phase 3: Wire Event Watchers
- [x] Route watched event dispatch through the shared executor
- [x] Keep event JSON as an operator-facing mirror
- [x] Avoid channel-specific retry logic
- **Status:** complete

### Phase 4: Tests And Verification
- [x] Add unit tests for lease acquisition, timeout retry, stop suppression, and stale recovery
- [x] Run focused tests
- [x] Fix issues found
- **Status:** complete

### Phase 5: Project Documentation
- [x] Update features.md, prd.md, CHANGELOG.md, README.md as required by AGENTS.md
- [x] Summarize results and remaining risks
- **Status:** complete

## Key Questions
1. Can V1 solve the production stuck case without redesigning all queues? Answer: yes, by making scheduled-event ownership canonical in a SQLite lease and keeping channel queues as delivery only.
2. Should retry apply to manual stop? Answer: no, manual stop marks the lease aborted and suppresses retry.
3. Should event JSON remain authoritative? Answer: no, it becomes a mirror for operators; the lease store is authoritative.

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use SQLite lease store beside runs | Existing runtime coordination already uses SQLite; this gives transactional ownership and restart recovery. |
| Keep retry policy global for V1 | User asked for default 10 minute timeout, configurable, max 3 attempts; per-event policies are not needed now. |
| Keep orchestration in shared runtime | Project rule says queue/recovery/task execution orchestration must not live in channel layer. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Read-only sandbox blocks normal git temp cache writes | 1 | Continue with read-only inspection; use apply_patch for edits and escalate only if needed. |
| `npx tsx --test` could not create IPC pipe in sandbox | 1 | Switched to `node --import tsx --test`, which ran the focused test without IPC failure. |
| `eventsLeaseStore.test.ts` allowed a new same-slot lease after retry exhaustion | 1 | Added latest-terminal same-slot guard in `EventExecutionLeaseStore.acquire()`. |
| `turnOrchestrator.test.ts` cannot write settings SQLite in this sandbox | 1 | Recorded as environment limitation; focused lease tests passed. |

## Notes
- Do not persist temporary runtime control text into model history.
- Watched event JSON files remain the scheduling source, but active execution state must move to the lease store.
