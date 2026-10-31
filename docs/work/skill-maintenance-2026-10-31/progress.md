# Progress

- Started maintenance feature; inspected prior consolidation fixes and existing dirty workspace.

- Implemented shared maintenance scan, comparison, preflight and apply transport. Added isolated filesystem tests; implementing UI next.

- Fixed two checks: null service endpoint passed to the component, and the Node test context type.
- Desktop svelte-check: 0 errors, 0 warnings. Initial desktop production build passed.
- First browser launch uses the compiled backend; rebuilding it before testing new maintenance endpoints.
- Existing root planning files were clean at task start; restored them after moving this task's notes to this dedicated docs/work directory.

## Verification

- Maintenance behavior tests: 15 passed, repeated five times with temporary SQLite and directories.
- Existing manager consolidation/removal regression selection: 8 passed.
- Dedicated WebKit maintenance flow: five consecutive passes after final UI changes. Covers actual file results, cold service restart, page entry, Chinese/dark/mobile layout, service interruption and recovery.
- Mutation evidence: disabling the stale-plan guard produces completed instead of stale and fails its regression. Faking a successful maintenance API result without filesystem writes fails the UI test's symbolic-link assertion. Temporary mutant sources were removed.
- Desktop svelte-check: zero errors and warnings; backend type check passed. Backend and desktop production builds passed; desktop build retains the existing large-chunk warning.
- Reviewed mobile screenshot. Corrected references-tab count to include valid entries, not only broken links.
- Adversarial review added guards for internal support-file references, backup symlink consumers, overlapping physical slots, malformed backup names and interrupted operation recovery.
- Updated feature/requirement/release records and the focused feature guide. Appended 6.5KB of unchanged older feature records to the existing Q4 archive; main features file is below 256KiB. No user-owned Skill directories or running user services were changed.
- Not run: native App or full regression. Reserved full command: `pnpm verify:feature`.

## Parent-root alias fix

- New link/keep/remove regressions reproduced the root-alias failure before the fix. Consolidation now returns already_shared without filesystem changes; removing an alias of the canonical entry is refused.
- Shared entry symlinks can be materialized without replacing the canonical entry with a self-link.
- UI shows the existing parent-directory link and a shared-state confirmation, rather than a conflict or a fictional write plan. The action label explicitly says the original path is replaced by a link.
- First UI validation caught two test-locator issues: duplicate Close buttons and the translated navigation landmark. Corrected accessible-label selection without widening timeouts or adding retries.
- Live backend remains unchanged pending explicit restart authorization, as required by the user's global working rules.

- Parent-root consolidation: 11 targeted cases passed five times. The full UI path passed five times before the final layout guard; a narrow-window layout regression then reproduced a 659px scroll width in a 341px body, fixed by wrapping direct preflight path text. Final UI repetition includes that guard.
- Prepared backend source rollback snapshots under `.test-tmp/skill-root-alias-rollback/` before any live restart. The live backend is owned by the desktop supervisor; `/api/system/restart` is the supported desktop-managed restart endpoint after authorization.

- Final parent-root UI path, including narrow-body overflow guard, passed five consecutive WebKit runs. Desktop check had zero errors/warnings; backend type check, backend build and final desktop build passed. No live restart was performed.

## Dialog interaction polish

- Applied redesign-existing-projects and apple-design guidance within DESIGN.md. Captured the existing root-alias dialog before changes, then reviewed light/desktop and dark/mobile renderings after two layout and copy passes.
- Added an isolated UI regression that fails on the original clear-and-rebuild preview. It holds an old removal request, delivers a newer selection, then verifies the old response cannot overwrite it; also covers failure/retry and fixed shell/footer geometry.
- Added a real independent-copy consolidation case: expanded full paths, actual symlink and backup, server state, and stable success shell.
- Keyboard review exposed missing focus restoration for programmatic Dialog opening on WebKit. Captured the actual initiating button and restored focus on close, with a grid fallback if success removed the detail pane.
- Updated the older broad UI scenario to explicitly expand full paths and check the real Codex source path. The broad scenario remains reserved; the new focused case covers this behavior.

- Final combined-suite review corrected shared worker fixture setup (verify an existing Claude root link instead of creating it twice) and labelled the native path disclosure explicitly; WebKit does not expose summary as a button consistently. A broad initial view was reset once while a concurrent build ran; final browser repetitions run after build completion with no source changes.

## Final polish review

- Reviewed the final light desktop preview, dark narrow preview, and real consolidation success rendering. Removed repeated status prose, aligned the moving selector, and kept the primary action's hit area in the same place through success. Footer text now describes the completed state rather than asking to review again.
- Final combined targeted WebKit run: 15 passed (three scenarios repeated five times), without retries. Explicit keyboard confirmation also preserves focus on the resulting Close action; an additional five-run check covers that assertion.
- Desktop svelte-check: zero errors/warnings; desktop production build and existing Skill UI source guard passed. No backend or native runtime changes, no user Skill mutations, and no production restart.
- Full/native regression was not run. Reserved overall command: `pnpm verify:feature`.
