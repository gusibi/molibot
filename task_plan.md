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

---

# Task Plan: Skill Usage Tracking Phase 1

## Goal
Implement Phase 1 of `docs/trace/skill-usage-tracking-plan.md`: record implicit skill loading when a successful `read` tool call opens a loaded skill's `SKILL.md`, while preserving monotonic `skill_usage` facts and avoiding runtime behavior changes.

## Current Phase
Phase 1

## Phases

### Phase 1: Documentation And Checklist
- [x] Create `docs/trace/skill-usage-tracking-progress.md`
- [x] Add Phase 1/2/3 checklist
- **Status:** complete

### Phase 2: Runner Tracking
- [x] Export path comparison helper
- [x] Store active run skill manifest on the runner
- [x] Cache resolved read paths after all block checks
- [x] Consume and clear read paths on after/error
- [x] Emit `skill.loaded` for successful matching skill reads
- **Status:** complete

### Phase 3: Trace Fact Merge
- [x] Add skill usage merge state
- [x] Derive level/status/evidence from skill signals
- [x] Store `evidenceCsv` in fact payload
- [x] Keep skill merge state until run cleanup/TTL
- **Status:** complete

### Phase 4: Tests And Verification
- [x] Add focused runner tests
- [x] Add focused trace recorder tests
- [x] Run focused tests
- **Status:** complete

### Phase 5: Project Documentation
- [x] Update required project docs
- [x] Update progress checklist
- [x] Summarize remaining risk
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Implement only Phase 1 now | User explicitly asked to start Phase 1 first; Phase 2/3 remain checklist items. |
| Keep matching logic in runner | Runner has the active hook context, cwd/workspaceDir, and loaded skill manifest. |
| Use `evidenceCsv` | Existing sanitizer collapses arrays. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `runner.test.ts` cannot load `AGENTS.template.md?raw` under Node test/tsx | 1 | Recorded as existing loader limitation; trace recorder tests pass and filtered implementation type check shows no touched implementation errors. |
| Full `tsc` reports many unrelated repository errors | 1 | Filtered the output to touched implementation files; no output was produced. |

## Remaining Risk
- Runner-level tests were added but could not execute in the current Node test/tsx path because the existing runner test imports Vite `?raw` markdown templates. The implementation path is covered by code review and touched implementation-file type filtering; trace fact merge behavior is covered by executable tests.

---

# Task Plan: Skill Usage Tracking Phase 2

## Goal
Implement Phase 2 of `docs/trace/skill-usage-tracking-plan.md`: record successful `skillSearch` matches as triggered skill candidates without claiming the skill was loaded or executed.

## Current Phase
Phase 2 complete; Phase 3 not started.

## Phases

### Phase 1: Runner Candidate Emission
- [x] Detect successful `skillSearch` calls in runner `afterToolCall`.
- [x] Defensively read `context.result.details.matches`.
- [x] Emit `skill.selected` with `reason: "search_match"` for structurally valid matches.
- **Status:** complete

### Phase 2: Trace Semantics
- [x] Keep matched-only facts at `payload.level: "triggered"`.
- [x] Keep matched-only facts at `status: "info"`.
- [x] Preserve no-downgrade behavior when a search match follows a loaded fact.
- **Status:** complete

### Phase 3: Tests And Documentation
- [x] Add runner coverage for `skillSearch` candidate emission.
- [x] Reuse executable trace recorder tests for triggered-only and no-downgrade behavior.
- [x] Update `docs/trace/skill-usage-tracking-progress.md` and project docs.
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Emit `skill.selected`, not `skill.loaded` | A search match is only a candidate signal. |
| Validate match fields before emitting | Tool result details are diagnostic data and should not break runtime flow if malformed. |
| Keep Phase 3 out of scope | Executed attribution needs a separate signal contract and false-positive review. |

## Remaining Risk
- Runner-level Phase 2 test coverage was added but still cannot execute in the current Node test/tsx path because of the existing `?raw` markdown loader issue in `runner.test.ts`.
