---
name: doc-standards
description: Use when writing, moving, reviewing, or auditing documentation in the molipibot repo — choosing the right document home (features.md, prd.md, CHANGELOG.md, README.md, docs/, ADR), separating tutorials from references, checking placement and hierarchy, trimming doc slop, or responding to requests like "improve the docs", "audit the docs", "where should this be documented", or "this doc is too long".
---

# Applying the Molibot Documentation Standard

The repository's document-layering rules live in [AGENTS.md](../../../AGENTS.md) (the file-update rule table and the doc-responsibility layering) and [docs/README.md](../../../docs/README.md) (the `docs/` directory map). This workflow covers placement, corpus audits, and pruning across Markdown, JSDoc, and code comments. It is guidance, not a script; use [prose-standard](../prose-standard/SKILL.md) for required prose coverage and editorial judgment, and never treat length alone as a defect.

## Sources of truth (read, don't re-summarize)

- [AGENTS.md](../../../AGENTS.md) — which root document owns which purpose: `features.md` for shipped facts, `prd.md` for planned/priority work, `CHANGELOG.md` for release summaries, `README.md` for entry/navigation, `docs/` for topical documentation; plus the archive rule (256KB cap, quarterly archive into `docs/archive/`).
- [docs/README.md](../../../docs/README.md) — the purpose-first directory map (`features/`, `guides/`, `requirements/`, `adr/`, `designs/`, `research/`, `reviews/`, `work/`, `reference/`, `articles/`, `images/`, `archive/`) and the filing rules.
- [docs/adr/](../../../docs/adr/) — accepted architecture decisions and the reasoning behind them; the home for "why this design won".
- [features.md](../../../features.md) and [docs/requirements/personal-assistant-capability-matrix.md](../../../docs/requirements/personal-assistant-capability-matrix.md) — the current capability status (交付/部分交付/待验证/未开始); never regenerate tasks from stale copy in `prd.md`, `features.md`, or `CHANGELOG.md`.

## Classify the document's home before prose

Apply the layering rules to every human-facing document in scope:

1. Decide root level vs `docs/`. Time-bound, planning, or acceptance-tracking material belongs in `prd.md` or `docs/requirements/`; shipped, user-visible capability explanations belong in `features.md` or `docs/features/`; durable decisions that outlive any feature belong in `docs/adr/`; technical design and system proposals belong in `docs/designs/`; operator and developer guides belong in `docs/guides/`.
2. Locate the document in the repository and navigation trees. State its own subject and identify its direct children; set the permitted level of detail: keep full detail about the document's subject, summarize direct children by purpose and high-level behavior, and move deeper explanations to their owning descendants with links. Treat test infrastructure as descendant-owned unless it is the document's subject.
3. Classify the document from its intended use, not its path or title. A tutorial must lead through ordered work to an observable outcome; a reference must support lookup within an explicit scope without requiring sequential reading.
4. For a tutorial, privately classify the starting reader and concepts as beginner, intermediate, or advanced. Trace each concept to its prerequisites, reorder premature material, and move optional advanced detail to a later tutorial or reference.
5. Split substantial mixed forms. Put a small secondary form in a clearly labeled section.
6. Check the file-size rule before appending: `AGENTS.md` caps the root record files (`features.md`, `prd.md`, `CHANGELOG.md`) at ~256KB with quarterly archive into `docs/archive/`; a change that would blow the cap should trigger the archive step first, not a new sibling file.

Before renaming or moving any doc, grep for inbound references (`grep -rn 'old-name' --include='*.md' .` plus Markdown link targets and `#fragment` anchors), then fix every inbound link in the same change. A move is atomic: remove from the old home, add to the new home, update every inbound link, and never leave a stub.

## Audit the corpus

After the structural pass, hunt the slop checklist with the cheapest probes first:

1. Measure: `git ls-files '*.md' | xargs wc -l | sort -rn | head -30` to spot outliers; for the root record files, compare against the 256KB archive cap (`ls -lh features.md prd.md CHANGELOG.md`).
2. Hunt reasoning-transcript leakage — narrated history, dead design-session citations, review choreography, control-flow narration, test walkthroughs — with [trim-cot-leakage](../trim-cot-leakage/SKILL.md), which defines the taxonomy, recall batteries, and rules for what to keep or delete. Preserve only a non-obvious contract or durable rationale; the same rationale repeated beside sibling features keeps one home.
3. Hunt duplication by grepping distinctive phrases. Keep one home and replace other copies with links.
4. Replace hand-written catalogs and status inventories with the authoritative source: capability status comes from [the capability matrix](../../../docs/requirements/personal-assistant-capability-matrix.md), release history from `CHANGELOG.md`, shipped facts from `features.md`.
5. In `features.md` and `docs/features/`, keep present-tense, user-facing capability explanations with current boundaries; move planning language, acceptance-task checklists, and future-tense spec language to `prd.md`/`docs/requirements/`. Keep concise verification statements that identify behaviors pinning a shipped feature, plus named coverage gaps.
6. If removing prose changes a promised behavior rather than its explanation, update the owning requirement (`prd.md` / `docs/requirements/`) or file an ADR instead.

Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale. Cut stories, duplicates, status notes, and the path used to derive the rule. Do not create a new explanation merely to relocate disposable reasoning.

## When a record file exceeds the archive cap

Apply the archive rule in [AGENTS.md](../../../AGENTS.md): move old entries into `docs/archive/features-archive-YYYY-QN.md`, `docs/archive/changelog-YYYY-QN.md`, and `docs/archive/prd-archive-YYYY-QN.md`, keeping only the recent 1-2 months of active entries plus index links in the main files. Add to the main files only; never rewrite archive files.

## Validation and PR hygiene

Run at least `git diff --check` and the repository's lint/typecheck gates; if code comments or JSDoc changed, keep the touched behavior tests green. The PR body should state which documents were touched, where new content was placed and why, any deliberately long exception, and the checks run.