# Review Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前分支相对 main 的 review 中真正需要合并前处理的安全、审批和可维护性问题，并明确哪些 review 建议应推迟或不采纳。

**Architecture:** 保持现有边界：Channel 负责鉴权和消息适配，TurnOrchestrator 负责 turn 生命周期，Runner/ToolRuntime 负责推理和工具执行，ApprovalBroker/ApprovalStore 负责审批请求与授权。优先做小而确定的修复，不在本轮引入大型重构或未来阶段功能。

**Tech Stack:** SvelteKit server-side TypeScript, Node SQLite `DatabaseSync`, Vitest, existing agent runtime modules.

---

## Context

`docs/superpowers/reviews/review.md` 汇总了当前分支与 main 的 review 结果。核对代码后，核心实现方向是正确的：TurnOrchestrator、ToolRuntime、ApprovalBroker、channel shared runtime 已经形成主干，现有测试也覆盖了不少基础路径。

但 review 中有几类问题需要区分处理：

1. **合并前应优化**：审批授权无法撤销、过期/短作用域 grant 不清理、MCP 工具风险默认过低、subagent 审批深度硬编码。
2. **需要文档化边界**：actor authentication 当前由 channel 层负责，TurnOrchestrator 信任 channel 传入的 `userId`；这是可接受的边界，但需要显式说明。
3. **推迟到后续阶段**：RunlogRuntime、PolicyEngine 独立模块、PluginManager、settings sanitizer 拆分、runner 继续拆分、sandbox provider workspace 化、host bash 新旧存储迁移、完整 pipeline 集成测试。
4. **不建议本轮修改**：把 tool/skill selection 移入 TurnOrchestrator、移动 `channelCommands.ts`、抽象 Feishu approval polling、把 `baseRuntime` 的 runner/session glue 强行移入 TurnOrchestrator、处理 `write.ts mkdir`。这些要么是边界判断问题，要么 review 已确认当前实现安全。

## Critical files

- Modify: `src/lib/server/approval/approvalBroker.ts` — 给 store/broker 增加 grant revoke 与 cleanup API，并在内存 store 实现。
- Modify: `src/lib/server/approval/approvalStore.ts` — SQLite 实现 revoke/cleanup，复用现有 `revoked_at` 字段。
- Modify: `src/lib/server/agent/core/turnOrchestrator.ts` — turn 完成/中止后清理 turn-scoped grants；补充 actor 边界说明。
- Modify: `src/lib/server/agent/tools/index.ts` — MCP tool 默认风险从 `low` 提升到 `medium`，确保进入审批策略。
- Modify: `src/lib/server/agent/tools/subagent.ts` — 将 `requestedByDepth: 1` 改为可传递并递增。
- Test: existing approval/tool/subagent/turn orchestrator tests under `src/lib/server/**/__tests__` or colocated `*.test.ts` — 按现有项目测试布局添加/更新。

## Recommended scope for this optimization pass

### Task 1: Add approval grant revocation API

**Files:**
- Modify: `src/lib/server/approval/approvalBroker.ts`
- Modify: `src/lib/server/approval/approvalStore.ts`
- Test: existing approval broker/store tests

- [ ] Add `revokeGrant(grantId: string, revokedAt?: Date): boolean` to `ApprovalBrokerStore`.
- [ ] Implement it in `MemoryApprovalBrokerStore` by copying the grant with `revokedAt: now.toISOString()` and returning `false` when the id is unknown.
- [ ] Implement it in `SqliteApprovalStore` with `UPDATE approval_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL` and return `changes > 0`.
- [ ] Add `ApprovalBroker.revokeGrant(grantId: string, revokedAt?: Date): boolean` as a thin wrapper.
- [ ] Add tests proving a revoked grant no longer matches `checkGrant()` for both memory and SQLite-backed paths if the existing tests cover both stores; otherwise cover the store currently tested and keep SQLite behavior verified at store level.

### Task 2: Add scoped grant cleanup hooks

**Files:**
- Modify: `src/lib/server/approval/approvalBroker.ts`
- Modify: `src/lib/server/approval/approvalStore.ts`
- Modify: `src/lib/server/agent/core/turnOrchestrator.ts`
- Test: approval store/broker tests and TurnOrchestrator tests

- [ ] Add store methods for scoped cleanup, preferably revoking rather than hard-deleting so history remains queryable:
  - `revokeTurnGrants(runId: string, revokedAt?: Date): number`
  - `revokeSessionGrants(sessionId: string, revokedAt?: Date): number`
- [ ] In SQLite, update `revoked_at` where `revoked_at IS NULL` and:
  - turn cleanup: `scope IN ('turn', 'once') AND run_id = ?`
  - session cleanup: `scope = 'session' AND session_id = ?`
- [ ] Add broker wrappers with the same names.
- [ ] Inject or obtain `ApprovalBroker` in `TurnOrchestrator` with minimal disruption to current singleton pattern.
- [ ] Call `revokeTurnGrants(runSummary.runId)` from `commitTurn()` after `updateRunStatus()`.
- [ ] Call `revokeSessionGrants(sessionId)` from `abortRunningTurnsForSession()` only for aborted/stopped running sessions; do not revoke session grants on normal turn completion.
- [ ] Add tests that a `turn` grant is inactive after commit and a `session` grant remains active across normal turn commits.

### Task 3: Raise MCP tool default risk classification

**Files:**
- Modify: `src/lib/server/agent/tools/index.ts`
- Test: existing tool runtime/index tests

- [ ] In `wrapWithToolRuntime`, change MCP tool default risk from `low` to `medium` while preserving existing risk values for `bash`, `write`, `edit`, and other built-in tools.
- [ ] Ensure `source: "mcp"` remains unchanged for `name.startsWith("mcp__")` tools.
- [ ] Add a focused test that wraps a fake `mcp__...` tool and verifies its registered `ToolDefinition.risk` is `medium`.
- [ ] Do not make all `medium` tools require approval unless that is already the current policy. The immediate issue is incorrect MCP classification, not a broad policy expansion.

### Task 4: Fix subagent approval depth propagation

**Files:**
- Modify: `src/lib/server/agent/tools/subagent.ts`
- Modify: `src/lib/server/agent/tools/index.ts`
- Test: existing subagent tests

- [ ] Add `requestedByDepth?: number` to `createSubagentTool()` options.
- [ ] Replace the hardcoded `requestedByDepth: 1` with `(options.requestedByDepth ?? 0) + 1`.
- [ ] Pass the parent depth from the tool creation context if an existing context field already exists; if not, leave the root call at the default `0` and document the follow-up needed to propagate depth from nested agent runtimes.
- [ ] Add a test that constructs `createSubagentTool({ requestedByDepth: 2, ... })` and verifies the host approval payload uses depth `3`.

### Task 5: Document actor authentication boundary in TurnOrchestrator

**Files:**
- Modify: `src/lib/server/agent/core/turnOrchestrator.ts`

- [ ] Add a short comment immediately before writing `actor_id` in `prepareTurn()` explaining that channel runtimes authenticate/authorize external actors before calling the shared turn pipeline, and TurnOrchestrator persists the already-normalized `message.userId` for audit/session records.
- [ ] Do not add a new central auth check in this pass unless the codebase already has a reusable channel-agnostic actor verifier. Adding one ad hoc would duplicate channel-specific allowlist logic.

## Deferred items to track separately

These are valid observations but should not be part of this optimization pass:

- `RunlogRuntime` structured lifecycle events: larger observability feature.
- `PolicyEngine` extraction: useful refactor, but current callback-based policy path works and is testable enough for this pass.
- `PluginManager`: explicitly later-phase work beyond current channel loader.
- `settings/sanitize.ts` decomposition: later settings cleanup, not blocking current safety fixes.
- `runner.ts` further split: maintainability work; avoid mixing with approval/security changes.
- workspace-level sandbox provider registry: design work tied to workspace policy resolution.
- HostBash legacy JSON to SQLite migration: important migration plan, should be handled as a separate compatibility task.
- Full message-to-tool integration test: valuable but broad; schedule after approval cleanup stabilizes.

## Pushback / do-not-change items

- Keep tool/skill selection in Runner for now; TurnOrchestrator should own lifecycle, not LLM reasoning/tool selection.
- Keep `channelCommands.ts` where it is; moving it is cosmetic churn.
- Do not extract Feishu approval polling in this pass; card polling/rendering is platform-specific and current shared approval broker already owns the approval state.
- Do not move `baseRuntime` runner/session glue into TurnOrchestrator now; current `baseRuntime -> TurnOrchestrator -> Runner` boundary is reasonable.
- Do not change `write.ts mkdir` based only on the review note; current writes go through `ToolExecutionContext.fs.writeText` path validation.

## Verification

- [ ] Run the approval-related test files after Tasks 1-2.
- [ ] Run the tool runtime/index tests after Task 3.
- [ ] Run the subagent tests after Task 4.
- [ ] Run the TurnOrchestrator tests after Tasks 2 and 5.
- [ ] Run the broader agent/server test subset that currently covers the 25/25 passing suites mentioned in the review.
- [ ] Manually inspect that no new feature flags, compatibility shims, or broad refactors were introduced.
- [ ] If UI/channel approval cards are affected by changed approval cleanup behavior, run the app and verify one approval flow from request to approval/rejection in the browser or target channel before reporting completion.
