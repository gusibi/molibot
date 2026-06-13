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

---

# Findings & Decisions: Skill Usage Tracking Phase 1

## Requirements
- Implement Phase 1 from `docs/trace/skill-usage-tracking-plan.md`.
- Track implicit skill loading when a successful `read` tool opens a loaded skill `SKILL.md`.
- Do not change tool execution behavior or Channel layer orchestration.
- Keep Phase 2 and Phase 3 out of this implementation, but track them in a nearby checklist document.
- Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` after functional changes if required.

## Research Findings
- `afterToolCall` does not include tool args, so the resolved read path must be cached from `beforeToolCall`.
- The cache must be set after hook gate, preflight, and budget checks so blocked reads do not leave pending paths.
- `sanitizePayload` collapses arrays, so evidence must not be stored as a raw array.
- `TraceRecorderHook` currently overwrites `skill_usage` payload/status without level/evidence merging.
- `pathCompareKey` exists in `tools/path.ts` but is not exported yet.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Cache resolved read paths in runner | Avoids changing `read` tool result semantics. |
| Match exact compare keys | Avoids fuzzy path false positives. |
| Use in-memory skill usage state in the recorder | Keeps Phase 1 small and avoids DB reads per skill signal. |
| Store evidence as CSV | Works with existing payload sanitizer. |

---

# Findings & Decisions: Skill Usage Tracking Phase 2

## Requirements
- Implement Phase 2 from `docs/trace/skill-usage-tracking-plan.md`.
- Track successful `skillSearch` matches as triggered candidate skill facts.
- Do not claim candidate matches are loaded or executed.
- Do not change Channel-layer behavior.
- Update progress and project documentation after the functional change.

## Research Findings
- Runner `afterToolCall` receives the `skillSearch` result payload, so candidate tracking can be added without changing the `skillSearch` tool implementation.
- `TraceRecorderHook` already treats `skill.selected` with `reason: "search_match"` as `payload.level: "triggered"` and `status: "info"`.
- Existing monotonic merging already prevents later `search_match` signals from downgrading an earlier loaded fact.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Read only `context.result.details.matches` | This keeps Phase 2 coupled to the existing structured tool detail output rather than parsing display text. |
| Skip malformed matches | Trace enrichment must not alter or fail tool execution. |
| Include optional numeric score | It is useful diagnostic metadata and harmless when absent. |
| Leave `reasons` out of the emitted payload | Existing payload sanitization collapses arrays, and `reason: search_match` is the stable evidence token needed by facts. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Full `tsc` still reports existing unrelated repository errors | Re-ran the touched implementation-file filter; it produced no output. |
| `runner.test.ts` remains blocked by the existing `?raw` loader issue | Added future runner coverage but relied on executable trace recorder tests plus implementation-file type filtering for current verification. |

---

# Findings & Decisions: Skill Usage Tracking Phase 3

## Requirements
- Implement Phase 3 from `docs/trace/skill-usage-tracking-plan.md`.
- Let skill authors optionally declare execution signals.
- Attribute executed evidence only after the skill has been loaded in the same run.
- Keep executed as heuristic evidence, not proof.
- Avoid Channel-layer changes.

## Research Findings
- The current skill frontmatter parser only returns flat string keys, so nested `signals:` metadata needs a small dedicated parser or flat key fallback.
- Runner has the active run skill manifest and hook context, so it is still the right place for conservative signal attribution.
- `tool.call.after` has result details for MCP tools, while bash command text is only reliable from `beforeToolCall`; a small per-tool-call cache is needed.
- `TraceRecorderHook` already has monotonic skill usage state; it only needs to classify signal reasons as `executed`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Parse `signals:` plus flat `signals_*` keys | Keeps metadata author-friendly without replacing the project parser. |
| Match `cli` only against successful bash command prefixes | This is conservative and avoids parsing arbitrary shell internals. |
| Match `tools` by exact tool name | Avoids fuzzy matches against unrelated tool names. |
| Match `mcp` by server id/name/prefix from tool result details | MCP local tool names are generated, so server identity is the stable signal. |
| Attribute overlap to the most recently loaded skill | This gives one owner per tool call and matches the "loaded before use" timeline. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Full `skills.test.ts` has existing failures unrelated to Phase 3 | Ran the new signal parsing test by name; it passed. |
| Full `tsc` remains blocked by existing repository errors | Filtered touched implementation files; no output was produced. |
| Filtering touched tests still shows existing runner fixture errors for missing `enabled` | Recorded as pre-existing test fixture issue; implementation files type-filter clean. |
