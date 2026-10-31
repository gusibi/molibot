# Skill maintenance implementation

- [complete] Inspect existing manager, API, desktop components, and targeted test harness.
- [complete] Implement explicit maintenance scan, duplicate comparison, selected canonical consolidation, backup actions and broken-link handling.
- [complete] Add bilingual, responsive maintenance UI using existing components and semantic styles.
- [complete] Run isolated behavior regressions, desktop checks/build and targeted browser cold-path validation.
- [complete] Review safety and update affected documentation.

Scope: four maintenance improvements authorized on 2026-10-31. Preserve existing unrelated edits. Do not mutate real skill directories during development.

Errors resolved: old compiled backend lacked new endpoints; rebuilt isolated backend. SelectControl exposes a labelled button; UI test now locates that accessible label. Null endpoint and Node TestContext type errors were corrected.

## Consolidation dialog polish

- [complete] Capture baseline and add continuity/race/error UI guards.
- [complete] Refine stable shell, action selector, path disclosure and feedback.
- [complete] Review screenshots and transitions, iterate, and run targeted checks.
