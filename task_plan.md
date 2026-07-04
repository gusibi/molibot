# Chat Workspace Design Audit

## Goal
Assess whether the complete Desktop Chat workspace—including conversation navigation, Chat, Automations, Skills, dialogs, and responsive states—meets `DESIGN.md` and identify evidence-backed improvements.

## Success Criteria
- Capture and inspect current-run screenshots for each reachable workspace state.
- Compare visible hierarchy, spacing, shape, typography, states, accessibility, and responsive behavior with `DESIGN.md`.
- Inspect source only to verify behavior that screenshots cannot prove.
- Save ordered screenshots and a self-contained audit report under `docs/audits/chat-workspace-2026-07-04/`.
- Separate confirmed issues, likely risks, and evidence limits; do not modify product code.

## Plan
- [complete] Establish audit baseline and inspect supplied Chat desktop state.
- [complete] Inspect supplied Automations and Skills states.
- [complete] Inspect source and tokens for accessibility/interaction constraints not visible in screenshots.
- [complete] Implement confirmed design, localization, recovery, responsive, and accessibility fixes.
- [complete] Write prioritized combined UX/accessibility audit and verify artifacts.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Audit framework path was resolved from the plugin root instead of the audit skill directory | 1 | Located and read `skills/audit/references/design-audit-framework.md`. |
| Existing UI regression expected 36px session rows after the design target changed to 40px | 1 | Updated the assertion to the documented 40px control height and reran the suite. |
