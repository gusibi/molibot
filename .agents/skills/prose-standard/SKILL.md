---
name: prose-standard
description: Use when writing, reviewing, restoring, trimming, or auditing prose in the molipibot repo, including deciding where documentation is required across Markdown, JSDoc, code and test comments, prompts, descriptions, diagnostics, and CLI or UI strings.
---

# Molibot Prose Standard

Write enough to preserve the contract, then remove reasoning transcripts, repetition, and decoration. A contract is an obligation, invariant, precondition, postcondition, or compatibility promise that a caller, callee, implementer, producer, or consumer relies on. This skill owns editorial judgment and required prose coverage; use [doc-standards](../doc-standards/SKILL.md) for placement and hierarchy across the repository's feature/PRD/changelog/guide documents, and [trim-cot-leakage](../trim-cot-leakage/SKILL.md) for hunting and fixing reasoning-transcript leakage. It is guidance, not a script.

Treat `contract`, `boundary`, `shape`, `surface`, `seam`, `gate`, and `vocabulary` as terms to check before use, not banned words. First ask whether the exact rule, API, field set, type, validation, timing point, component split, or failure states state the fact better. Keep a term when it names the exact technical subject, including caller/callee contracts and security/process boundaries.

Comments describe non-obvious contracts or rationale that code cannot express; they do not restate what code already implies.

## Inputs and exclusions

Require an explicit `scope`. If it is missing, report the required input and stop; do not infer a repository-wide scope or begin an interview.

Always exclude `node_modules/`, `.git/`, `build/`, `dist/`, `.svelte-kit/`, `.tmp/`, `.test-tmp/`, and generated fixtures from discovery, review, and edits, even when the requested scope is the whole repository. Put exclusions after inclusion globs so a later include cannot re-admit them: for example, end ripgrep commands with `--glob '!node_modules/**' --glob '!build/**'`, and give Git commands explicit `:(exclude)node_modules/**` pathspecs. If the requested scope contains only excluded paths, report that no eligible files remain.

Treat generated output (screenshots, fixture transcripts, snapshot files, archives in `docs/archive/`) as derivative. Edit the owning process or source first, then regenerate or re-archive the artifact. Archived quarterly records (`docs/archive/`) are frozen historical snapshots: inspect an exact target only to understand a historical citation, never to modernize its prose.

## Preserve the complete proposition

Before editing, identify every proposition in the passage. Preserve each relevant:

- actor and action;
- condition, timing, and ordering;
- modality such as must, may, or never;
- negative guarantee and exception;
- ownership, side effect, failure mode, and consequence.

Remove adjectives, repetition, and narration only when every factual clause survives and the result is clearer. A smaller word count alone is not an improvement.

Keep a complete local contract at the point of use: behavior, failure, ownership, and consequence that a caller or maintainer needs there. Aggressively link to the owning document for architecture, rationale, algorithms, history, or extended examples. One explanation has one home; essential contract facts may repeat locally.

Keep non-obvious rationale when omitting it could plausibly cause misuse or an incorrect simplification. Otherwise state the consequence and link the rationale home.

## Required coverage by prose location

This is not a one-way shortening pass. Add or restore prose when code, types, and structure do not communicate a required contract below. Do not add a comment when those facts are already obvious locally.

- **Public JSDoc:** document caller-visible return distinctions, throws or rejections, side effects, ownership, timing, cancellation, and durability.
- **Internal comments:** orient non-local structure and obviously complicated local structure, including invariants, race ordering, ownership, security boundaries, and surprising failure behavior. Delete control-flow narration and code restatement.
- **Module comments:** state the module's role, dependencies, responsibilities, and non-obvious architecture choices; link architecture choices to their owning ADR or design document (`docs/adr/`, `docs/designs/`).
- **Tests:** explain only non-obvious test design—why a fixture, assertion, platform accommodation, real entry path, or indirect observation is necessary. Delete walkthroughs and inventories.
- **Guides (`docs/guides/`):** include prerequisites, required actions, the real entry path, observable verification, and concise warnings.
- **READMEs (`readme.md`, `readme.zh-CN.md`, `docs/README.md`):** include the consumer contract: configuration, semantics, failures, limitations, extension points, and model-visible effects. Keep durable gaps and maintainer traps, not ordinary cleanup inventories.
- **Features (`features.md`, `docs/features/`):** user-facing capability explanations in the present tense, with their current boundaries; link to relevant guides and durable designs. Do not duplicate acceptance-task checklists from `prd.md` or plans in `docs/requirements/`.
- **ADR and design documents:** retain unique rationale, mechanisms, alternatives, consequences, and shipped verification evidence. State shipped reality in the present tense; remove planning checklists, not evidence of what pins the decision.
- **Skills and agent instructions:** state behavioral guardrails and explicit scope limitations such as "guidance, not a script/checklist." Keep the workflow concise and link its source of truth.
- **Examples and configuration comments:** explain access limits, non-obvious wiring or load order, security stance, replay behavior, exceptions, and likely misuse. Do not narrate entries that the configuration already shows.
- **Prompts and visible strings (chat UI, settings pages, bot messages):** treat wording as behavior. Settings UI must stay bilingual (中文/English) and theme-adaptive per `AGENTS.md`; inspect generated output and state why no snapshot applies when there is none.
- **Diagnostics:** name the failing subject or path, violated rule, and correction when it is non-obvious. Remove internal execution narration.

Preserve searchable mechanism names and meaningful modal, temporal, or negative emphasis. Normalize decorative emphasis only.

## Workflow

1. Confirm the scope, mode, current branch, and the applicable document-layering rules in [AGENTS.md](../../../AGENTS.md) and [docs/README.md](../../../docs/README.md). Do not inspect unrelated branches.
2. Read the owning code or document before judging a passage. For calibration or unfamiliar cases, read [the distilled examples](references/examples.md).
3. Inspect the requested scope, not only the largest files. Use searches and word counts to find candidates, then judge passages semantically.
4. Classify each candidate as keep, add, trim, restore, restructure, or defer. Apply clear changes only when the task authorizes edits; do not manufacture edits to satisfy a deletion target.
5. Update the owner before derivative artifacts. Re-check analogous passages after learning a new rule.
6. Run the narrow relevant checks (`svelte-check`, tests, `git diff --check`), and verify the final diff contains no excluded path. Report any accidental match rather than claiming a clean exclusion history.
7. Report the inspected scope, clear changes, deliberate keeps, deferred cases, and checks actually run.

## Borderline decisions

A case is borderline only when at least two versions satisfy the complete-proposition rule but trade accepted principles, and this skill does not already resolve the tradeoff. A rewrite with one proposition-preserving answer is not borderline.

In automatic mode, apply clear edits when authorized and report genuine borderline cases without asking questions. Do not weaken a proposition to make progress.

In interactive mode, group analogous passages under the governing principle. Present two or three viable versions, recommend one, and state the factual or structural difference. Do not offer inferior distractors.

After the user decides, distill the principle and versions into [the examples](references/examples.md), without PR history or reviewer narration, and apply the learned rule to every analogous passage in scope.