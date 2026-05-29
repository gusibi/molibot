# Task Plan: Agent v2.2 Optimization

## Goal
Complete the optimization work described in `v2.2.md`: reduce active ACP runtime coupling, strengthen the logical Workspace boundary, introduce incremental turn/tool/approval runtime modules, migrate dynamic configuration toward SQLite, and eventually remove legacy code once the new path is proven.

## Assumptions
- `v2.2.md` is the approved design and execution spec for this goal.
- Workspace IDs are logical permission/audit boundaries only. They must not move, rename, or rewrite existing physical `workspaceDir`, `chatDir`, or `scratch` directories.
- ACP source code must not be physically deleted until the later cleanup phase; active runtime references should be isolated first.
- Existing delivered behavior must be preserved unless it directly conflicts with `v2.2.md`.
- Phase 5 cannot be truthfully marked complete until the new path has been stable long enough to satisfy the spec's stabilization requirement.

## Success Criteria
1. ACP active runtime/configuration paths are inactive, while legacy source remains isolated until final cleanup.
2. Default `personal` workspace is created, resolved, and attached to sessions/runs without changing physical directories.
3. `TurnOrchestrator` exists and incrementally owns turn metadata, run lifecycle status, lock cleanup, and future channel migration entry points.
4. `ToolRuntime` and shared tool types exist, with policy decisions and audit metadata shaped around `runId`, `sessionId`, and `workspaceId`.
5. `ApprovalBroker` and approval types exist, with once/turn/session/workspace/persistent scopes and SQLite request/grant persistence.
6. Dynamic settings migration has a clear first SQLite-backed slice without breaking existing users.
7. Focused tests or type checks verify each implemented slice.
8. `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` reflect completed work and remaining gates.

## Phases

### Phase 0: Current-State Gap Audit
- [x] Read `v2.2.md` and current project docs.
- [x] Inspect Workspace, runner, channel, settings, and approval-related code.
- [x] Record the gap audit in `findings.md`.
- **Status:** complete

### Phase 1: ACP Active Path Isolation + Workspace Hardening
- [x] Remove active ACP settings surface from settings schema/store/defaults or make it inert without deleting `src/lib/server/acp/`.
- [x] Keep `/acp`, `/approve`, and `/deny` commands returning inactive-path guidance.
- [x] Add focused tests proving default Workspace resolution and no directory migration.
- **Status:** complete for this slice; legacy ACP source remains by design

### Phase 2: Incremental TurnOrchestrator
- [x] Add `src/lib/server/agent/turnOrchestrator.ts`.
- [x] Centralize run/session/workspace metadata and dead-run cleanup helpers.
- [x] Add tests for metadata preparation and stale running cleanup.
- [x] Migrate full channel pipeline and session lock/memory/skill/run-event lifecycle (runner and baseRuntime status/metadata transitions).
- **Status:** complete

### Phase 3: ToolRuntime + ApprovalBroker Foundations
- [x] Add shared tool and approval type modules.
- [x] Add `ToolRuntime` skeleton with policy decisions, registry lookup, and audit event metadata.
- [x] Add `ApprovalBroker` skeleton with grant/request matching and expiration helpers.
- [x] Add SQLite-backed approval request/grant store.
- [x] Add focused unit tests for low-risk behavior.
- [x] Migrate built-in tools, Host Bash, MCP, plugin tools, debounce, and subagent approval bubbling (all tools wrapped by ToolRuntime, HostBashStore migrated to approval tables).
- **Status:** complete

### Phase 4: Settings SQLite Split First Slice
- [x] Identify the smallest dynamic-settings slice to migrate safely.
- [x] Implement migration without losing existing `settings.json` users.
- [x] Verify settings load/save compatibility.
- **Status:** complete (Fully supported by SQLite settings_dynamic / channel_instances / custom_providers tables)

### Phase 5: Legacy Cleanup Gate
- [ ] Remove legacy ACP source and fallback paths only after the new path has passed stabilization gates.
- [ ] Verify `runner.ts` reaches the target simplification threshold.
- **Status:** blocked by required stabilization period

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `git status` emitted macOS temp/xcrun cache warnings under read-only sandbox | Checked dirty worktree before edits | Treat as non-blocking sandbox noise; use file-level inspection and later rerun status if needed |
| `npm run build` failed with `EPERM` writing `.svelte-kit/tsconfig.json` | Ran production build in read-only shell sandbox | Logged as environment blocker for build verification; focused Node tests pass |
