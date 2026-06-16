---
name: agent-runtime-debug-review
description: Use this skill when reviewing or debugging an agent runtime that has queues, cancellation, steer/follow-up behavior, subagents, sandbox or host-tool approval, prompt/session persistence, tool-call limits, or execution logs. Trigger on requests about Agent 主流程, Sub Agent, sandbox, host bash approval, stop/abort/steer/followUp, queued tasks, prompt pollution, tool-call limits, runtime logs, or agent execution-flow review. Produces narrow findings or surgical fixes with verification steps.
---

# Agent Runtime Debug Review

This skill is for agent execution systems where bugs often cross several layers: message intake, queueing, run orchestration, tool dispatch, subagent delegation, sandbox approval, persistence, and user-visible status.

Use it to avoid treating a runtime symptom as a local UI or one-file bug.

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
