---
name: code-review
description: Use when reviewing a pull request or change in the molipibot repo — orients the reviewer to this codebase's standards (AGENTS.md conventions, document-layering rules, capability matrix, verification gates) and the review-specific checks that code alone can't show, especially keeping documentation in sync with code.
---

# Reviewing a Molibot Change

**This skill is guidance, not a complete checklist.** Read the diff and enough surrounding code to understand the design. Prioritize correctness, lifecycle, security, and broken required behavior over style; a short review with one substantiated blocker is better than a list of nits.

## Sources of truth

- [AGENTS.md](../../../AGENTS.md): standing repository rules — document layering, capability-matrix governance, verification conventions (tests + `svelte-check` + build), cold-start smoke walkthroughs, and the recurring-pitfalls process rules.
- [CLAUDE.md](../../../CLAUDE.md): Recurring Pitfalls and prior-fix history for the touched panels; a fix that repeats a documented root cause is a process failure.
- [DESIGN.md](../../../DESIGN.md): the design system for page, UI, and interaction changes; shadcn-svelte component reuse rules.
- [prose-standard](../prose-standard/SKILL.md): required coverage and editorial judgment for comments, docs, prompts, and visible strings.
- [doc-standards](../doc-standards/SKILL.md) and [doc-lifecycle](../doc-lifecycle/SKILL.md): document placement and lifecycle rules for plan/requirement/design documents.
- [docs/requirements/personal-assistant-capability-matrix.md](../../../docs/requirements/personal-assistant-capability-matrix.md): the single four-state view of capability status; never regenerate tasks from stale copy in `prd.md`, `features.md`, or `CHANGELOG.md`.

## Blocking requirements

1. **New prose receives semantic review.** Use [prose-standard](../prose-standard/SKILL.md) to critically review every added or changed Markdown passage, JSDoc, comment, prompt, description, diagnostic, and visible string. Verify required coverage, accuracy, placement, and editorial quality against the owning code or behavior; automated checks do not establish those properties.
2. **Docs match the code.** Config, defaults, errors, wire fields, events, and public behavior update the owning documentation (README, `features.md`, `docs/features/`, guides, JSDoc) in the same diff. Comments state non-obvious contracts; flag implementation narration, test walkthroughs, review history, and duplicated rationale for deletion or a link to their one home. Settings changes must round-trip: a settings field change requires a save → new store → load regression (temp database), per [AGENTS.md](../../../AGENTS.md).
3. **Capability status is shipped, not promised.** A change that alters a capability's status updates `personal-assistant-capability-matrix.md` (已交付 / 部分交付 / 待验证 / 未开始) in the same diff, with current evidence. `prd.md` entries and `features.md` lines are history, not status.
4. **Bundled content bumps its version.** Changes to built-in Skills (`src/lib/server/agent/skills/bootstrap.ts` descriptor), built-in Agent templates (`src/lib/server/agent/prompts/templates/<id>/`), or built-in Mini App templates bump the version so existing workspaces get the update; an owner-edited copy is backed up as `<id>.backup-<timestamp>` before overwrite, per [AGENTS.md](../../../AGENTS.md).
5. **Required evidence exists.** Verify the author ran the repository's verification convention (tests + `svelte-check` + build) and, for UI/desktop changes, the cold-start smoke path: restart → first open/click of affected panels → session/page switch → service interruption recovery. Review the semantic gaps automation cannot detect (first-open blank, click-no-response, config reset after restart).

## Manual checks

- **Intent and interface contracts:** trace both sides of every changed interface. Confirm the implementation matches the task and any document describing it, including errors, cancellation, ownership, and disposal.
- **Lifecycle and concurrency:** for async setup, callbacks, process scheduling, or teardown, check races before publication, cancellation during awaits, independent error reporting, callback containment, ownership before reentry, complete detach cleanup, and quiescent disposal. Cross-channel queue and runtime states must stay idempotent (busy retry, recovery, approval, stop, complete, fail, cancel must not duplicate tasks or retain terminal rows).
- **Layer discipline:** shared capability (queue, recovery, interleave, delete, task orchestration, session advancement) must live in the shared upper layer, not the Channel layer; a channel change that re-implements cross-channel capability is an architecture violation.
- **Scope, ownership, and necessity:** map each abstraction, state machine, option, defensive copy, and compatibility path to its current contract, production consumer, and owning module. Challenge unrelated features and speculative generality. No new dependency without a maintained reason; prefer existing dependencies first.
- **Configuration and public choices:** ask what current-consumer evidence or prior art supports each default, public operation set, format, or imported external concept. Require an explicit choice or deferral when that evidence is absent.
- **Model perspective:** inspect the exact prompts, tool schemas, results, and diagnostics the model receives across affected modes. Flag concepts outside the model's task; verify stable text verbatim and dynamic behavior through snapshots or end-to-end coverage. Temporary runtime control instructions (e.g. "no tools this round") must never persist into session transcripts or pollute later model context; troubleshooting facts persist as structured error codes/events, while user-facing channels get human-readable detail.
- **Enforcement:** follow every denial path to the operation that executes it; exercise direct and alternate callers that can bypass schemas, prompts, facades, wrappers, or listener ordering. Check sandbox/permission/host-approval boundaries and Host Bash approval paths.
- **Borrowed and derived state:** determine whether each retained value is borrowed or owned, then trace notifications and every cache, prompt, UI echo, replay, and query view to the documented success point and authoritative source.
- **Bounds cover the final operation:** locate the owner of the complete emitted or retained result, including wrappers and metadata. Probe tiny and exact limits, oversized single chunks, and multibyte text for byte limits.
- **Real entry path:** tests exercise the shipped runtime, sandbox, subprocess, or real UI entry where relevant. A hand-mounted fixture does not catch loader/registration defects.
- **Test strength:** assertions fail on the intended regression and verify external state, logs, events, or disposal rather than restating the implementation or trusting an agent's report. Persistence tests use temp databases or injectable stores, never the user's real data directory or settings db.
- **UI changes:** follow [DESIGN.md](../../../DESIGN.md), reuse `src/lib/components/ui` (shadcn-svelte) unless the system genuinely cannot express the need, respect the fixed settings footbar convention and adaptive/bilingual/theme requirements, and verify real pages at middle/wide/narrow widths in both languages and themes. Svelte 5 interactive state must flow through `$:` deriveds, stores, or explicit reactive state — no hidden helper functions that break dependency tracking.

## Reporting findings

State the defect, location, impact, and evidence. Place a localized defect inline on the tightest relevant diff range; use a PR-level comment for cross-cutting architecture, scope, or review-wide synthesis. Separate blockers from suggestions and omit issues already enforced by a green gate. When receiving review, verify each claim and fix or rebut it on technical grounds without performative agreement.