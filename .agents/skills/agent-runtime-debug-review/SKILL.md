---
name: agent-runtime-debug-review
description: Use this skill when reviewing or debugging an agent runtime that has queues, cancellation, steer/follow-up behavior, subagents, sandbox or host-tool approval, prompt/session persistence, tool-call limits, or execution logs. Trigger on requests about Agent 主流程, Sub Agent, sandbox, host bash approval, stop/abort/steer/followUp, queued tasks, prompt pollution, tool-call limits, runtime logs, or agent execution-flow review. Produces narrow findings or surgical fixes with verification steps.
---

# Agent Runtime Debug Review

This skill is for agent execution systems where bugs often cross several layers: message intake, queueing, run orchestration, tool dispatch, subagent delegation, sandbox approval, persistence, and user-visible status.

Use it to avoid treating a runtime symptom as a local UI or one-file bug.

## Repo Map (this project)

Skip re-discovery; the layers live here:

| Layer | Location |
|-------|----------|
| Runner / orchestrator | `src/lib/server/agent/core/runner.ts`, `turnOrchestrator.ts`, `runnerPool.ts` |
| Runtime notices / budget | `src/lib/server/agent/core/runtimeNotices.ts`, `runtimeBudget.ts` |
| Session store / compaction / workspace | `src/lib/server/agent/session/` (`store.ts`, `compaction.ts`, `workspace.ts`) |
| Tool dispatch | `src/lib/server/agent/tools/` (`bash.ts`, `bashPolicy.ts`, `edit.ts`, `mcpInvoke.ts`, ...) |
| Host bash / host tool approval | `src/lib/server/agent/hostBashExec.ts`, `hostToolExec.ts`, `src/lib/server/approval/` |
| Watched events / scheduler / leases | `src/lib/server/agent/events.ts`, `eventsLeaseStore.ts`, `taskScheduler.ts` |
| Subagents | `src/lib/server/agent/subagentProgress.ts`, `src/lib/server/agent/tools/` |
| Channel intake | `src/lib/server/channels/{telegram,feishu,qq,weixin,web}/`, `shared/`, `registry.ts` |
| Shared app/query layer | `src/lib/server/app/` |
| Prompts | `src/lib/server/agent/prompts/` |

## Known Past Failure Modes (check these first)

Bugs this codebase has already shipped; re-check the matching one before hunting elsewhere:

- `toolCallId` collision: a wrapper passing the shared `runId` instead of the per-call id breaks parallel tool calls; dropped `onUpdate` silences tool progress.
- Lock/lease staleness: session turn locks are heartbeat leases (30s refresh, 2-min timeout); orphaned `retry_wait` leases with a shared `taskId` can block every sibling task.
- Prompt-cache invalidation: anything per-turn injected into the *system prompt* (memory snapshot, query text) kills provider prefix caching — per-turn data belongs in the user-message envelope, unpersisted.
- CJK under-count: char/4 token estimation under-counts Chinese 3-4x and can disable threshold compaction; whitespace tokenization collapses CJK queries to one token.
- Automation-session leakage: sessions missing `origin:"automation"` (or matched only by `task-*` / legacy `[EVENT:...]`) leak into ordinary conversation lists — filter in the shared query layer.
- Duplicate concurrent automation runs: an active execution must cause new triggers to record `skipped`, not start a second agent.

## Inputs to Collect

Start from the smallest relevant set:

- User symptom, expected behavior, and actual behavior.
- Recent runtime logs around the failing run.
- Any flow docs, review docs, or sequence diagrams the repo already has.
- Current changed files if the user asks for review.
- Source files for these layers, when present:
  - channel command/message intake
  - queue store and run claim logic
  - runner/orchestrator
  - tool display and tool dispatch
  - subagent tool/runtime
  - sandbox or host-tool approval
  - prompt/session persistence
  - logging/telemetry

State assumptions before editing when the behavior can be interpreted in more than one way.

## Review Procedure

1. Classify the symptom.
   - `stop/abort`: current run cancellation, pending queue cleanup, callback timeout.
   - `steer/followUp`: injection timing, queued message identity, ordering, persistence.
   - `subagent`: prompt boundary, inherited context, tool permissions, result summarization, cache impact.
   - `sandbox/host approval`: approval scope, environment inheritance, command display, repeated prompts.
   - `tool-call limit`: partial output preservation, continuation behavior, user-visible boundary.
   - `prompt pollution`: runtime notices or control directives stored as normal conversation.
   - `scheduler/lease`: watched-event tasks not firing, firing twice, or permanently blocked; stale or orphaned leases; skipped-vs-concurrent semantics.
   - `observability`: logs cannot distinguish stuck, waiting, running, or blocked states.

2. Trace the execution path end to end.
   - Entry: channel/API receives the message or command.
   - Queue: item is enqueued, claimed, cancelled, steered, or followed up.
   - Runner: system prompt, session state, model request, tool loop, and completion.
   - Tools: local sandbox, host bash, MCP/browser, or subagent dispatch.
   - Persistence: session/context files, run summaries, logs, and user-facing messages.

3. Separate control planes.
   - Model instructions: temporary controls injected into the model.
   - User notifications: human-readable status sent to Telegram/Feishu/QQ/Weixin/Web.
   - Debug records: structured logs or run events that must not be fed back into the model unless explicitly intended.

4. Check invariants.
   - Stop cancels the active run and handles pending work consistently.
   - Steer injects into the intended active run and does not silently reorder unrelated messages.
   - Follow-up waits for completion and preserves user-visible ordering.
   - Subagents do not inherit accidental prompt or permission state, but do inherit explicitly approved runtime context when intended.
   - Host-approved tools execute with the same environment and display semantics promised to the user.
   - Runtime notices are not persisted as normal conversation turns.
   - Logs expose run id, scope id, tool/subagent start and end, approval wait, timeout, and failure.

5. Recommend the smallest fix.
   - Prefer a focused source change plus one verification path.
   - Do not refactor unrelated channel code or rewrite docs unless the change makes docs stale.
   - If the issue is architectural, write a short staged plan and mark what not to change now.

## Output Format

For review-only tasks:

```markdown
Findings
- [P1/P2/P3] Title - file:line
  Why it matters, the concrete failing path, and the narrow fix.

Open questions
- Only include blockers or ambiguous product decisions.

Verification
- Commands or manual scenario to confirm the behavior.
```

For implementation tasks:

```markdown
Plan
1. Change [layer] -> verify with [check].
2. Change [layer] -> verify with [check].

Result
- Files changed and behavior fixed.
- Verification run.
- Remaining risk, if any.
```

## Verification Scenarios

Baseline for any runtime change in this repo (node test runner, not vitest):

```bash
node --import ./scripts/register-loader.js --import tsx --test <touched .test.ts files, or a src/lib/server/agent/**/*.test.ts glob>
npx tsc --noEmit   # on touched files / project
```

Persistence-touching tests (SQLite, settings, queues, leases, approval) must use a temp database or injectable store — never the real user data dir (AGENTS.md rule).

Choose the scenario matching the symptom:

- `stop`: start a long-running tool call, send stop, confirm active run aborts and pending items are either cancelled or explicitly retained by design.
- `steer`: queue a second message during an active run, steer it by id, confirm it is injected once and not later replayed as a duplicate.
- `followUp`: submit follow-up during active run, confirm it executes after completion with clear status.
- `subagent`: run a delegated task, confirm parent logs show subagent start/end and only the intended summary returns to parent context.
- `sandbox/approval`: run a non-approved command and an approved host command, confirm approval prompts, environment, and displayed tool name match policy.
- `tool limit`: force or simulate a tool-call limit, confirm partial output is preserved and continuation is clearly separated.
- `prompt pollution`: inspect session/context persistence and confirm runtime notices are recorded as events or user messages, not model history.

## Stop Conditions

Stop and ask before editing when:

- The desired product behavior is ambiguous, such as whether pending queued items should be cancelled or preserved after stop.
- A fix would change security policy, approval scope, or command execution trust boundaries.
- The evidence is only a screenshot with no logs or source path and several layers could be responsible.
