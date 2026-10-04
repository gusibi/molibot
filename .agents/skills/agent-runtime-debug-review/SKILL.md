---
name: agent-runtime-debug-review
description: Use when reviewing or debugging Molibot agent execution involving queues, stop/abort, steer/followUp, retries, subagents, approval suspension/resume, durable execution, prompt/session pollution, tool budgets, or inconsistent runtime status. Applies to execution-flow defects, not unrelated UI styling or general provider setup.
---

# Agent Runtime Debug Review

Trace the failing operation across its actual runtime boundaries. Fix the owning shared layer and verify both execution and user-visible outcomes. For review-only requests, report findings without changing code.

## Establish the contract and evidence

- Read applicable `AGENTS.md` rules. Before diagnosing a bug, search matching symptoms or panels in `CHANGELOG.md`, `docs/archive/changelog-*.md`, and `CLAUDE.md` Recurring Pitfalls. Start from the previous root cause and guard; explain why that guard missed this case.
- Define the expected observable outcome from existing requirements, tests, and the user's request. For assistant capability status, use `docs/requirements/personal-assistant-capability-matrix.md`; historical delivery notes do not authorize new work.
- For change reviews, establish the requested diff/base and distinguish pre-existing or unrelated working-tree changes. Review the changed behavior and necessary callers, not the whole runtime.
- Collect the smallest useful evidence: input, expected/actual behavior, run/session/scope/tool-call identities, relevant logs, and persisted state. Missing logs or a screenshot-only report calls for read-only investigation, not an automatic approval question.
- Reproduce in isolation when feasible. Treat suspected causes as hypotheses until a concrete failing path supports them. Never read or write real user databases from tests, and do not print credentials or unrelated conversation content.

## Locate the active execution path

These are entry points, not a frozen architecture map. Verify relevant paths and callers with `rg`; inspect only the branches implicated by the symptom.

| Concern | Entry points |
|---------|--------------|
| Intake, queue ownership, live controls | `src/lib/server/channels/shared/inboundCoordinator.ts`, `persistentTaskQueue.ts`, `src/lib/server/app/`, `src/lib/server/web/` |
| Runner, retries, notices, budgets | `src/lib/server/agent/core/runner.ts`, `turnOrchestrator.ts`, `runnerPool.ts`, `runtimeNotices.ts`, `runtimeBudget.ts` |
| Approval and host execution | `src/lib/server/approval/`, `src/lib/server/hostBash/`, `src/lib/server/agent/hostBashExec.ts`, `hostToolExec.ts`, `src/lib/server/channels/shared/brokerApprovalResume.ts` |
| Scheduled and durable work | `src/lib/server/agent/events.ts`, `eventsLeaseStore.ts`, `taskScheduler.ts`, `src/lib/server/agent/durable/` |
| Tools and delegated execution | `src/lib/server/agent/tools/`, `exec/`, `subagentProgress.ts`, `src/lib/server/plugins/externalSubagent/`, `package/external-subagent/`, `src/lib/server/rooms/` |
| Model context and persistence | `src/lib/server/agent/prompts/`, `session/`, `src/lib/server/providers/piRuntime.ts` |
| Status, transcript, trace | `src/lib/server/app/conversationProjection.ts`, `src/lib/server/web/conversationProjection.ts`, `src/lib/server/agent/hooks/` |

Follow intake → claim/control → runner/model → tool/effect → persistence → projection/delivery as relevant. Distinguish the production path from a new kernel, adapter, or isolated prototype that is not yet wired into it. A passing kernel test does not prove the real Runner uses that behavior.

## Check the relevant invariants

Choose by symptom; do not run every scenario for every change.

### Queue, cancellation, steer, and retries

- One accepted inbound task keeps a stable identity across busy retries, recovery, approval, and completion. Claims are atomic; duplicates and terminal queue rows do not accumulate.
- Bind controls to the intended run and scope. Recheck identity and cancellation after asynchronous waits and before effects start; an old Stop must not stop a newer run or delete unconfirmed work. Preserve the established command semantics.
- Steer is accepted once, in order, and survives an outer retry rollback without replaying later as another task. Keep accepted live controls in run-owned runtime state, not ordinary Session history. Clear them when the run ends.
- User follow-up follows the existing completion contract. Runtime corrective controls must not manufacture an extra closing reply by entering the follow-up queue.
- Cancellation reaches tools and child execution. Release owned locks/leases and settle related waits; late callbacks cannot revive terminal runs. Verify lease ownership and recovery from current code rather than copied timeout constants.

### Approval and side effects

Trace request → wait/suspend → decision → resume → execution → terminal state, including the persisted request and execution owner.

- A suspended run cannot start another tool or model round, including steering or mixed tool batches. Preserve its partial transcript and request identity instead of treating empty final text as a failed attempt.
- Approval remains bound to actor, scope, Session, capability, and approved arguments. Atomically claim execution so inline and out-of-band handlers cannot both execute it.
- Stop, rejection, expiry, restart, and late decisions have explicit outcomes. Recheck cancellation and permission after asynchronous preparation and immediately before execution.
- If execution may already have happened but its outcome is unknown, inspect receipts/state; do not blindly retry the effect or promise exactly-once behavior without evidence.
- Distinguish interactive, unattended event, and durable approval policies from the active implementation. An unattended task must not wait forever for a human; a durable deferred approval must retain a valid resume owner.

### Prompt, Session, and subagent boundaries

- Keep temporary model controls, human notifications, and structured debug events separate. Temporary runtime directives must never persist as ordinary user/assistant messages or re-enter context after reload/compaction.
- Inspect the final rendered system prompt and actual model request, not just source lists or previews. Check effective Bot/profile precedence, duplicate sections, and deferred tool descriptions.
- Keep changing time, memory, query, and skill data out of the cache-stable prefix. Verify placement and provider behavior; do not assume every dynamic suffix invalidates every cached prefix.
- Check child context, owner/scope, permission propagation, cancellation, approval identity, and intended result delivery. Distinguish internal subagents, external adapters, and Rooms; do not infer equivalent guarantees from a common label.

### Budgets, scheduling, and displayed state

- Tool limits, retry exhaustion, and timeouts preserve completed output/effects and expose a truthful terminal or suspended state. Continuation must not repeat completed writes.
- Scheduled work goes through watched event JSON and runtime events. Check duplicate triggers, skipped runs, stale leases, and restart recovery in the shared owner.
- Correlate run, scope, tool-call, approval, and child identities across logs and stored state. Parallel same-name tools need distinct call IDs and paired progress/end events.
- Compare execution truth with transcript projection and delivery. Waiting is not completed; an empty final string is not proof that no output exists; delivery failure is distinct from execution failure.

## Implement the smallest complete root fix

For implementation requests, fix cross-channel orchestration in the shared upper layer; channel adapters own transport and message conversion. Do not add per-panel/channel gating to conceal a shared defect. Complete an authorized root fix rather than stopping at a staged plan. If it materially expands scope or changes an undecided product/security contract, present the decision and continue independent work. Temporary patches require the explicit exception in `AGENTS.md`.

Before finishing a Fix, answer: what root-cause family caused it; which meaningful machine guard prevents recurrence; whether a lasting Pitfalls/rule update is warranted. For a repeated family, a machine guard is required. Update affected documentation by its existing responsibility, without copying incident narratives into permanent rules.

## Verify and report

Use temporary databases/directories or injectable stores for persistence, queues, leases, trace, and approval tests. Prefer deterministic barriers and real shared runtime/store integration over sleeps or tests that merely match source wording.

Run the relevant existing tests using the Node runner, for example:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/core/runner.test.ts
corepack pnpm run check
```

Select actual affected test files; the example is not a mandatory full-suite command. Confirm current scripts in `package.json` and `apps/desktop/package.json`. UI/desktop changes additionally require the applicable tests, Svelte checks, builds, and the project's cold path: restart an isolated service → first open/click → switch Session/page → disconnect and recover. Settings field changes require whole-object save → fresh store → load round-trip. Do not interrupt a live user service without existing authorization; report that check as incomplete and finish independent checks.

For the implicated lifecycle, cover the failing case and meaningful boundaries: retry rollback for steer; run replacement for Stop; approval rejection/expiry/late decision and concurrent execution claims; restart recovery for leases/durable work; persisted reload and real model input for prompt pollution. Test mixed batches or child approval when those branches participate in the defect.

Perform an adversarial final review: challenge ownership, race windows, effect replay, actual production wiring, and whether a simpler complete fix exists. Fix issues introduced by the change.

Report in the user's language:

- Review: prioritized findings with verified file/line, concrete trigger, impact, evidence, and proposed root fix. Separate confirmed defects from hypotheses; do not invent findings to fill a quota.
- Implementation: changed behavior, root cause, regression guard, checks actually run, and remaining relevant risk.
- Distinguish passed, failed, unperformed, and proposed checks. Isolated verification proves only that instance; claim live-service effectiveness only after verifying its build/process and runtime behavior.

Ask only for materially unresolved behavior, scope, trust boundaries, or missing authorization. Pause only dependent actions. Deliver when acceptance and required checks are met; disclose any required check that remains blocked.
