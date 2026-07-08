# Chat Workspace Design Audit

# Project Workspace Alignment — 2026-07-09

## Goal
Align Project creation and Session browsing with the current Chat workspace, while fixing the first-selection conversation rendering failure.

## Success Criteria
- Add Project first asks for a name, then offers automatic directory creation or one-time existing-folder selection.
- Existing-folder selection opens exactly one native directory picker; automatic creation opens none.
- Project and Chat render Sessions through the same shared UI component and interaction contract.
- Selecting a Project Session on first page entry immediately renders its conversation on the right.
- Focused regression tests, Svelte checks, build, responsive/theme/localization checks, and project documentation pass.

## Plan

### Phase 1: Inspect and reproduce
- Inspected product constraints and the current Chat/Project implementations; reproduced the selection race.
- **Status:** complete

### Phase 2: Define the shared design
- Chose Chat's existing Session row as the shared UI and defined the name-first creation flow.
- **Status:** complete

### Phase 3: Implement and regress
- Implemented managed/existing directory creation, shared Session rows, and request ownership with tests.
- **Status:** complete

### Phase 4: Verify and review
- Verified responsive UI, localization/theme tokens, focused tests, Svelte checks, and production builds.
- **Status:** complete

### Phase 5: Document and deliver
- Updated features, PRD, changelog, README, findings, and progress.
- **Status:** complete

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| zsh expanded SvelteKit `[id]` route paths as glob patterns | 1 | Quote bracketed paths on the next inspection; no source files changed. |
| First Svelte check found a dialog-role warning and test-only `$state` type conflict | 1 | Use a semantic-neutral `div[role=dialog]` and isolate the test shim behind `any`; production behavior unchanged. |
| Managed-directory test compared macOS `/var` with canonical `/private/var` | 1 | Compare against `realpathSync`; production code correctly stores canonical paths. |
| Two source assertions still encoded the superseded implicit-selection implementation | 1 | Updated them to assert generation ownership and explicit first-session selection. |
| In-app Browser DOM snapshot API was unavailable for the selected local tab | 1 | Reconnected through the documented Browser path and used its visible DOM plus screenshots; no product issue. |
| Planning completion helper was not executable | 1 | Run it explicitly with `bash`; no project artifact affected. |

## Adversarial Review
- Managed directory cleanup now also covers database-open/insert failures, so failed registration does not leave an empty orphan folder.
- Project and transcript mutations both require current request generation plus matching Project/Session identity.
- Project no longer carries orphaned picker helpers, Session DOM, copy, or CSS; the 40px row target lives in the shared component.
- Automatic-directory intent is asserted through the Desktop API request body and server-side temporary-store tests.

# macOS First-Launch Bootstrap

## Goal
Make a packaged Molibot desktop app start successfully on a Mac with no existing Molibot installation or data directory, while preserving existing user data on later launches.

## Success Criteria
- Packaged runtime contains every production dependency needed before server initialization.
- Starting with an isolated empty data root creates required settings, SQLite schema, directories, and bundled default profile files.
- Bootstrap is idempotent and never overwrites existing profile/config data.
- Focused regression tests, packaged-runtime verification, and relevant builds pass.
- Product documentation records the shipped behavior.

## Plan
- [complete] Reproduce the packaged-runtime failure and inventory bootstrap requirements.
- [complete] Add regression coverage for empty-data-root startup and packaged dependencies.
- [complete] Implement the smallest shared bootstrap/package fix.
- [complete] Verify first launch, repeat launch, builds, and adversarial failure cases.
- [complete] Update features, PRD, changelog, and README.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Packaged `start-server.mjs` cannot resolve `dotenv` | 1 | Under investigation; failure occurs before data initialization. |
| Real archive smoke found missing `scripts/runtime/service-port.mjs` | 1 | Release manifest copied `service-lease.mjs` only; added the second static startup dependency. |
| Real archive smoke found missing runtime `@sveltejs/kit` | 1 | Adapter Node imports `@sveltejs/kit/node` at runtime; moved the package from devDependencies to dependencies. |


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

---

# Periodic Schedule Builder

## Goal
Replace the primary raw Cron field in the Desktop automation editor with an accessible periodic schedule builder for daily, multi-select weekly, monthly-by-date, and custom Cron schedules, without changing the watched-event runtime format.

## Success Criteria
- Daily, weekly, monthly, and custom modes round-trip to valid five-field Cron strings.
- Existing Cron expressions open without data loss; unsupported expressions use custom mode.
- Create and edit use the same interaction, with Chinese/English, dark theme, and narrow-width styles.
- Focused tests, Svelte checks, and relevant API tests pass.
- Product documentation reflects the delivered behavior.

## Plan
- [complete] Define and test the Cron-to-form model and form-to-Cron conversion.
- [complete] Integrate the shared schedule builder into create/edit task flows.
- [complete] Add localized copy and responsive/theme-compatible semantic styles.
- [complete] Verify behavior, inspect the rendered UI, and fix regressions.
- [complete] Update features, PRD, changelog, and README; perform adversarial review.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| `svelte-check` rejected a `.ts` suffix in the new test import | 1 | Changed it to the repository's extensionless TypeScript import style. |

---

# Automation Target Picker Cleanup

## Goal
Expose only real, deliverable external conversations in the automation create picker and replace the raw channel/Bot/directory list with a clear Bot → conversation selection.

## Success Criteria
- Workspace and internal folders such as `skill-drafts` never appear as create targets.
- Targets are backed directly by enabled Bot `allowedChatIds` and grouped by channel/Bot.
- Recipient options display the configured Chat ID exactly, without Session-name inference.
- Existing workspace tasks remain readable/editable and no runtime event format changes.
- Focused tests, Svelte checks, builds, responsive checks, and documentation updates pass.

## Plan
- [complete] Trace target discovery and Bot allowed-chat configuration.
- [complete] Filter/project real task targets with regression tests.
- [complete] Replace the raw selector with Bot and conversation controls.
- [complete] Verify rendered desktop/narrow states and complete adversarial review.
- [complete] Update product documentation and final verification evidence.
