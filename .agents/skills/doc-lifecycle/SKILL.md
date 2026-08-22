---
name: doc-lifecycle
description: Use when adding, auditing, pruning, archiving, or reviewing plan/requirement/design documents in the molipibot repo (docs/requirements/, docs/designs/, prd.md) — checking new proposals for superseded older docs, classifying shipped plans by future value, deleting obsolete proposals, and applying the docs/archive/ archival rules.
---

# Molibot Document Lifecycle

Reduce the active document corpus without erasing history that can still guide work. Judge every document semantically; word count and age are discovery aids, never archive criteria.

## Read the contracts

Read [docs/README.md](../../../docs/README.md) (the directory map and filing rules), the document-layering rules in [AGENTS.md](../../../AGENTS.md) (which root document owns which purpose, the 256KB archive cap, and the capability-matrix rule), and the target document itself before classifying. Use current code, configuration, newer documents, and inbound links to establish whether a document's rationale still owns or constrains anything.

## Check supersession when adding a document

Every new plan/PRD/design document triggers a scoped audit of existing `docs/requirements/` and `docs/designs/` documents covering the same capability, mechanism, or rejected alternative. Classify each full or partial supersession while writing the new document: archive qualifying shipped predecessors in the same change, retain and cross-link partial supersessions or independently useful rationale, reject obsolete proposals, and delete rejected documents that no longer prevent a plausible mistake. Do not defer a known match to a later corpus audit.

Known overlap cases in this repo (verify before editing, do not assume): `memory-improvement-plan.md` vs `memory-improvement-plan-v3.md`, the multiple Mini App plans, and the multiple sandbox research/design documents — each pair needs an explicit current/obsolete ruling, not coexistence by silence.

## Classify by future value

Apply these lifecycle-specific outcomes:

- **Planned — keep active:** retain a plan/PRD in `docs/requirements/` while its capability is not yet shipped and the document still states the intended scope, priorities, and acceptance criteria. Keep it current with decisions made since it was written.
- **Shipped — keep active:** keep a design or requirement document active when its rationale, alternatives, negative guarantees, durable/wire semantics, ownership boundary, security rule, or reintroduction condition is likely to guide a future change. Shipped, user-visible capability explanations belong in `features.md`/`docs/features/`; link from there to the active design document.
- **Shipped — archive:** archive (or extract-and-archive) a requirement/design document when the shipped decision is complete and its body is unlikely to guide future work, such as one-off UI chrome, a narrow adapter, a closed bug, superseded implementation detail, or process history whose current behavior is obvious elsewhere. Preserve its durable decision content as an ADR in `docs/adr/` or a `docs/designs/` page before archiving the plan body.
- **Rejected — keep only as a guardrail:** retain a rejected plan only when the losing approach remains a tempting, meaningful mistake and the document explains why it loses. Note the rejection in the capability matrix (`docs/requirements/personal-assistant-capability-matrix.md`) only when it defines a capability boundary.
- **Rejected — delete:** delete the whole document when the rejected idea is obsolete, superseded, no longer plausible, or unlikely to prevent re-litigation. Repair or delete inbound links.

Do not archive toward a quota. Inspect every document in scope, classify analogous groups under one principle, use best judgment for close cases, and record genuinely borderline decisions for the handoff.

## Archive mechanics

Archive files live in `docs/archive/` (`docs/archive/prd-archive-YYYY-QN.md`, `features-archive-YYYY-QN.md`, `changelog-YYYY-QN.md`). For a standalone plan/requirement document, move it under `docs/archive/` with a YYYY-QN prefix or, when it fits an existing archive collection, append its content to the matching archive file:

1. Move the complete document; if the root record files (`prd.md`, `features.md`, `CHANGELOG.md`) exceed ~256KB, move their old entries into the quarterly archive files first, keeping only the recent 1-2 months of active entries plus index links, per [AGENTS.md](../../../AGENTS.md).
2. Do not rewrite the archived body; it is a historical snapshot. Add only an `Archived: YYYY-MM-DD` line at the top when the archive file is a collection with dated entries.
3. Search for inbound links from active prose. Redirect them to current authority, retarget them to the archived path only when the historical snapshot is intentionally cited, or delete them.
4. Update the capability matrix in the same change when a document's status affects a capability's state (已交付 / 部分交付 / 待验证 / 未开始).

Archived documents remain valid inbound-link targets but are historical snapshots, never authority for current behavior.

## Validate and report

Run at least `git diff --check`, verify the updated capability matrix keeps its four-state vocabulary, and grep the moved document's filename to confirm no active doc still links to the old home. Report active documents kept, documents archived, rejected documents kept/deleted, every capability-matrix status changed, and every genuinely borderline case with its chosen outcome.