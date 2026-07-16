# 2026-07-15 — Memory Center three-tab redesign

- Corrected the visual implementation brief after user clarification: Overview = generated Option 1, Topics = generated Option 2, All Memories = existing management view.
- Loaded the Product Design image-to-code/design-QA workflows, frontend design guidance, file-based planning workflow, and the Molibot macOS product-layer rules.
- Established projection, behavior-preservation, responsive/i18n/theme, build, screenshot, and final visual-QA gates before touching product code.
- Implemented separate Overview, Topics, and All Memories tabs; Pending remains inside Overview and Advanced opens as a secondary dialog.
- Added deterministic memory projections, topic grouping, cross-topic profile summaries, strict stable-preference detection, and storage-tag filtering for related entities.
- Preserved candidate confirmation, record edit/delete, source/version, injection eligibility, search, rejection, and maintenance behavior.
- Completed real-data browser QA in Chinese/English, light/dark, 1440×1024, and 860×620 states; final reference/implementation comparison is recorded in `design-qa.md` with Passed status.
- Final verification: projection 4/4, Desktop UI/HTTP 55/55, Desktop API 72/72, Svelte 0/0, `git diff --check`, and Desktop production build pass. Existing bundle-size/dynamic-import advisories remain unchanged.

---

# 2026-07-15 — PR #15 merge and release

- Loaded the explicitly requested release workflow and the required file-based planning workflow.
- Established a separate release boundary for PR #15 so unrelated primary-worktree changes and the older unfinished release plan are not silently included.
- Confirmed `master` and `origin/master` point to the already released `v2.4.9`; selected the next versions `2.5.0` and Desktop `0.4.7` under the skill's decimal carry rule.
- Confirmed the verified PR candidate is isolated at merge commit `45adc560`; no primary-worktree documentation change will enter the release.
- Pushed `45adc560` to `split_setting_api`, confirmed the PR became clean/mergeable, and merged PR #15. GitHub reports merge commit `cb3e6175`; remote `master` matches it.
- First release-worktree creation attempt failed because the new GitHub merge commit had not yet been fetched into the local object database; next action is a scoped `origin/master` fetch, not a repeated add.
- Fetched only `origin/master` and created clean branch/worktree `release-v2.5.0` at the PR merge commit.
- Applied root `2.5.0` and Desktop `0.4.7`, ran `scripts/sync-desktop-version.mjs`, and confirmed all five release identifiers plus a clean whitespace diff.
- Confirmed GitHub's merge commit and the locally verified conflict-resolution commit have the exact same product tree `291041d9`; prior 107/107, 197/197, 54/54, Svelte 0/0, and production-build evidence applies to the merged product tree.
- Offline dependency setup was blocked only by sandbox access to pnpm's cache SQLite database; retrying with scoped approval is required before a fresh release-worktree build.
- Offline frozen dependency installation completed without downloads or lockfile changes. Desktop UI/HTTP passed 54/54.
- The first API run passed 122 assertions but 12 test files could not start because the fresh worktree lacked generated SvelteKit `$lib` alias metadata; this is a setup failure, so the next run follows `svelte-kit sync`.
- Generated SvelteKit aliases and reran successfully: API 197/197, Settings 23/23, UI/HTTP 54/54, Svelte 0/0, root production build, and Tauri `cargo check` all pass.
- Completed the final five-file release diff and secret/machine-path/retired-caller review; candidate is ready to commit and tag.
- Created release commit `50b2a8e2`, tagged `v2.5.0`, pushed the commit to `origin/master`, and pushed only the intended tag.
- Published the final GitHub Release and removed the temporary release-notes file. Remote master/tag verification both resolve to `50b2a8e2`; PR #15 remains merged.

---

# 2026-07-14 — GitHub issue #13 completion re-audit

- Reopened completion status after the user reported that Settings dropdowns still
  look oversized and typographically inconsistent.
- Started a screenshot-first product audit and recorded that the previous “all done”
  wording was not supported by full PRD evidence.
- The catalogued Browser skill path had rotated; found the current installed version
  without using old screenshots or cached visual conclusions.
- Completed Product Design preflight: no saved context was found. Began checking the
  live Desktop/service entry points; one quoted-URL probe will replace the failed zsh glob.
- Confirmed the real Desktop dev surface at port 1420 and connected the required
  in-app audit browser. Browser guidance was loaded completely before page interaction.
- Opened a fresh Chinese Settings tab and captured its current accessible structure.
  Loaded the viewport control needed for the PRD's 860×620 breakpoint check.
- Saved and inspected `01-general-settings-860x620.png`. The screenshot already
  contradicts the previous blanket-completion claim on polish and control fidelity.
- Captured the light General state and started an isolated real-data preview on port
  1421 so Models/Providers can be audited with populated controls rather than empty shells.
- Connected the proxy-backed page to real data and navigated to Models. A combined
  screenshot/measurement call timed out during screenshot capture; the next attempt is
  split into a fresh state snapshot followed by bounded measurement and capture.
- Captured the populated Models DOM and confirmed engineering-first labels remain.
  A standalone screenshot also timed out; the final visual attempt will use an explicit clip.
- Measured all 12 populated Model controls and ended screenshot retries after the third
  timeout. Continued audit will use exact DOM/style evidence for Models and screenshots
  from other target pages.
- Audited populated Providers: documented raw engineering-first names, unequal select
  widths, and the 30-row/119-button main surface. The original “Providers complete” claim
  is not supportable.
- Provider screenshot capture timed out once and was not retried. Navigated to Trace and
  found checklist-level improvements embedded in an unresolved, unbounded raw-data list.
- Trace capture also timed out once. The live Automatic Tasks DOM then exposed the largest
  gap so far: users still receive expanded admin cards rather than the promised list/detail UI.
- Traced the task split: only Chat passes the workspace presentation; Settings retains the
  old command-deck/cards. Audited P2/interaction keywords and confirmed multiple explicit
  PRD enhancements have no implementation evidence.
- Diagnosed the saved screenshot rendering mismatch as JPEG bytes under PNG names; queued
  a lossless format conversion before final evidence inspection.
- Converted both General captures to real PNG and accepted the light image after visual
  inspection. The existing controlled tab then became stale before Chat navigation; recovery
  will obtain a fresh tab without reselecting the browser.
- Recovered with a fresh tab and opened the main Chat shell. A preview-origin first-launch
  modal is covering the workspace; the next audit step dismisses only that local preview state.
- Dismissed the preview-only modal and audited Chat Auto Tasks. The intended workspace exists,
  but raw cron remains primary and the same feature still has two incompatible presentations.
- Selected a real task at 860px and verified the right-side inspector plus separated status
  fields. Recorded the remaining raw technical content as a partial-completion gap.
- Audited the real Chat transcript and shared design-system source. Chat retains generic
  Agent/model metadata, most Settings routes lack descriptions, the proposed shared page
  primitives were not extracted, and radius/motion tokens are not globally enforced.
- Reset the temporary browser viewport, finalized all audit tabs, and stopped the isolated
  port-1421 audit server. The user's existing Desktop/service processes were not changed.
- Completed the re-audit with an explicit not-complete verdict. No product code or product
  documentation was edited in this audit pass; the current completion claims must be
  corrected when implementation resumes.

---
- Started the post-Issue-#10 release workflow at the user's explicit request. Loaded the repository release instructions and established version, sync, verification, tag, push, and GitHub Release gates.
- Confirmed GitHub authentication, remote/tag availability, and selected root `2.4.9` plus Desktop `0.4.6`. Began version edits and corrected the Activity verification label/count in release-facing docs.
- Version synchronization completed across root package, Desktop package, Tauri config, Cargo manifest, and Cargo lock. Diff whitespace and identifier checks are clean.
- Release-candidate verification passed: Agent City 9/9, Agent Activity/Trace 9/9, Desktop UI/HTTP 54/54, Svelte diagnostics 0/0, Vite production build, and Tauri `cargo check` for Desktop 0.4.6. Only the existing bundle-size/dynamic-import advisory remains.


# 2026-07-14 — GitHub issue #13 PRD implementation

- Loaded the file-based planning workflow and established requirement, architecture,
  test, documentation, and adversarial-review gates before touching product code.
- Started Phase 1 discovery. No product implementation has been changed yet.
- Anonymous GitHub fetch failed with a cache miss; recorded it and changed the
  next approach to authenticated GitHub CLI/API access.
- Authenticated Issue read succeeded and confirmed an app-wide frontend redesign;
  the first output was truncated mid-body, so discovery continues in bounded sections.
- Loaded `frontend-design` and the complete current `DESIGN.md`. The chosen direction
  is a restrained, dense, native macOS Agent tool—not decorative visual novelty.
- Loaded the Issue heading map and the previously truncated sections 12–18,
  completing the requirements inventory for layouts, task status, icons, copy,
  responsiveness, shared primitives, and CSS tokens.
- Audited the Desktop file map, dependencies, shared UI sources, package scripts,
  and top-level settings/Chat shells. No pre-existing user changes were found.
- Inspected Tasks/Trace/Models/Providers markup and the relevant semantic CSS map.
  The audit shows substantial existing foundations plus focused PRD gaps, so the
  implementation can stay inside shared Desktop presentation seams.
- Audited the settings shell, shared tokens/theme/accessibility CSS, Models and Trace,
  and Chat transcript/composer primitives. Mapped the remaining P0 gaps to shared seams.
- Completed Phase 1 and selected five surgical implementation slices covering the shared
  foundation and Issue target pages without changing runtime/business contracts.
- Added Issue #13 structural and exact duration regressions. The UI suite is red on
  6 new contracts as expected; the API test was not reached because the command used
  fail-fast chaining. Product implementation begins from this reproducible baseline.
- Implemented the shared token/header/sidebar footer foundation and the five target-page
  presentation changes. Updated two superseded structural assertions after the first run.
- Focused verification is green: Desktop UI 49/49 and Desktop API 69/69.
- App-local Svelte diagnostics pass with 0 errors and 0 warnings. The package-manager
  wrapper itself could not open its cache SQLite database, so verification used the
  installed binary directly rather than changing package state.
- Browser QA covered minimum-window 860×620 plus a wider view, Chinese/English,
  light/dark, Models, and Trace. Shared header alignment and fixed-height English
  button wrapping were found and corrected; the duplicate Usage hint was removed.
- Final adversarial pass corrected model empty-selection semantics and propagated
  real Agent/Bot identity through persisted and streaming Message Units. Desktop
  build passes; Svelte diagnostics are 0/0; UI/HTTP tests are 51/51 and API tests
  are 69/69. `git diff --check` and machine-path/credential scans are clean.

---

# 2026-07-12 — Bot Project mode

## 2026-07-14 — Release v2.4.7 / Desktop v0.4.4

- Loaded the explicit release workflow and file-based planning workflow.
- Confirmed branch `master`, origin `gusibi/molibot`, root v2.4.6,
  Desktop v0.4.3, and latest tag v2.4.6.
- Confirmed the dirty worktree contains the just-verified issue batch and its
  tests/docs; no pre-existing user changes were present when that batch began.
- Bumped root to v2.4.7 and Desktop to v0.4.4, then ran the official sync script.
  Cargo.toml, Cargo.lock, and tauri.conf.json all report Desktop v0.4.4;
  `git diff --check` passes.
- Release verification passed: server/Runner tests 47/47 using temporary SQLite,
  Desktop UI 44/44, Desktop Svelte diagnostics 0/0, and production build.
- Adversarial file review found no out-of-scope file, machine-specific absolute
  path, private-key marker, or suspicious added credential. The CHANGELOG delta
  from v2.4.6 contains only the issue #6/#11/#12 release section and its updated
  historical deferral note.
- Fresh fetch confirms local HEAD equals `origin/master` and v2.4.7 is not
  present locally; the release can advance without overwriting remote work.
- Created release commit `8b983725`, tagged it `v2.4.7`, and pushed the commit
  to `origin/master`. The broad all-tags push was correctly rejected; retry is
  scoped to the single new tag.
- Pushed only tag `v2.4.7` and published the non-draft, non-prerelease GitHub
  Release at `https://github.com/gusibi/molibot/releases/tag/v2.4.7`.
- Closed issues #6, #11, and #12 with v2.4.7 implementation and verification
  evidence. Issue #8 had already been closed after its existing delivery audit.


## 2026-07-14 — GitHub issues #8, #6, #12, #11 audit

- Loaded the persistent planning and issue-triage workflows.
- Established evidence gates: full issue context, code-path mapping, focused
  executable verification, proportional regression checks, and adversarial review.
- Product code has not been changed yet.
- Read issue #8 successfully; anonymous reads for #6/#12/#11 failed with
  cache misses, recorded the error, and changed the next approach to the
  authenticated GitHub CLI/API.
- Approved GitHub API read succeeded for all four issues; loaded the Agent
  runtime review procedure and project design/PRD constraints.
- Mapped #11 through Desktop controller → stream stop → shared runner persistence
  and #12 through Trace UI → active-runs API → channel manager abort.
- Confirmed #6's duplicate transcript remains in the UI Session schema.
- Completed discovery/audit. Selected shared runtime fixes for #11/#12 and a
  single Agent-entry → UI transcript projection seam for #6.
- Focused server tests passed and the root production build passed.
- First combined verification found only a brittle Stop source-order assertion
  and a wrong root path for `svelte-check`; both verification issues were
  recorded and corrected without changing product behavior.
- Final focused verification passes: projection/session/Trace tests 22/22,
  Runner tests 25/25 against temporary SQLite, Desktop UI 44/44, Svelte
  diagnostics 0/0, root production build, and `git diff --check`.
- Updated `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` with the
  delivered #6/#11/#12 behavior and replaced the superseded #6 deferral text.
- Adversarial review replaced the Web-only Trace fallback with one registry for
  every shared RunnerPool, removed the last-message preview copy from persisted
  UI Sessions, and constrained legacy text migration to nearby matching entries.
- Closed GitHub issue #8 as completed. Kept #6/#11/#12 open because their fixes
  are verified locally but have not yet been committed or pushed to GitHub.


## 2026-07-14 — Owner memory notification target

- User selected a single authorized Feishu or Telegram chat as the desired destination and requested a notice for zero-output success, nonzero success, and failure.
- Audited the current Owner scheduler/runtime path and recorded the cross-layer plan; no production implementation has been changed yet.
- Added structured target persistence, authorized Feishu/Telegram target projection, one aggregate success/failure executor, and a bilingual Desktop selector using existing settings form/footbar semantics.
- Verification passed so far: focused server tests 33/33, Desktop UI 42/42, Svelte diagnostics 0/0, and production build.
- Restarted the managed service and verified the live Desktop plugins API exposes both authorized Telegram and Feishu chats, with a valid Telegram target selected in the settings projection.
- Final adversarial review confirmed one aggregate notification is emitted outside model/session context for zero-output success, nonzero success, or terminal failure; `git diff --check` passes.

---

- Traced Feishu intake through shared commands, BaseChannelRuntime, RunnerPool,
  and the existing `MomContext.project` execution path.
- Selected a shared persisted binding plus shared context injection; no
  Channel-specific Project runtime will be added.
- Added `/project` list/select/off behavior and Telegram mobile command-menu
  discovery. Initial focused suite passes 32/32 tests.
- Final focused suite passes 33/33; full SvelteKit production build passes.
- Updated required product docs and completed adversarial boundary review.

---

# 2026-07-12 — Project runtime and display overrides

- Added inherited Sandbox, tool-progress, reasoning, and runlog-notice fields to Project persistence and Desktop settings.
- Project Sandbox resolves below Session and above Bot/Agent/global by passing the same boolean into the existing resolver; no new Sandbox or approval semantics were introduced.
- Applied Project display overrides to Desktop and Project-bound Telegram/Feishu/QQ/Weixin paths; runlog notice resolution includes Project scope.

---

# 2026-07-12 — Project-local Skill discovery fix

- User reported Project Chat slash suggestions omit Skills under the registered
  Project's `.agents/skills` directory.
- Loaded the debugging workflow and the existing approved Project Skill contract.
- Started a loader-level red regression before changing production discovery.
- Red test reproduced `scope=bot` instead of `scope=project`; it now passes with project-first discovery and ordinary-session isolation.
- Threaded projectRoot through Runner, prompt cache, skillSearch, Web `/skills`, and the server-owned Desktop suggestion endpoint.
- Real `momo-agent` probe found 26 valid Project Skills with project scope and zero diagnostics.
- Verification passed: focused Skill/Prompt/API tests 99/99, Desktop UI 39/39, Svelte 0/0, production build and diff check.

---

# 2026-07-12 — Composer suggestions and Project defaults

- User approved the four-stage implementation.
- Loaded planning, frontend design, and deep-module instructions.
- Confirmed existing uncommitted changes are user-owned and will be preserved.
- Started auditing shared composer/transcript seams and runtime persistence.
- Added the server-owned command/Skill suggestion catalog and shared Desktop menu.
- Added recognized Command/Skill transcript cards without styling unknown slash text.
- Added Project model/thinking persistence, settings dialog, per-Session temporary overrides, and per-turn Runner model resolution.
- First verification: focused server tests 5/5, Desktop UI 39/39, Desktop Svelte 0/0, production build pass.
- Adversarial review moved the model override from constructor initialization to the actual per-turn settings seam and removed non-Geist backdrop blur.
- Final focused verification passed: Desktop Svelte 0/0, Desktop UI 39/39, request/catalog/Project/model-routing tests 76/76, production build and diff check pass.
- Raw repository-wide `tsc --noEmit` remains red on unrelated pre-existing dependency/package/type errors; no reported diagnostic points to the delivered files.
- Final command-path review routed recognized Commands to the existing Web command executor and persisted both command and result; Skills retain streaming execution.

---

# Progress log

## 2026-07-11 — Configurable reflection schedule and completion notice

- Started tracing the existing internal watched-event path before changing
  settings or channel delivery.
- Added Memory settings, sanitizer/defaults, managed Cron rewrite with status
  preservation, conditional internal-result notification, Desktop controls, and
  bilingual copy.
- Focused settings/scheduler/Desktop/API regressions pass 84/84; Desktop Svelte
  check reports 0 errors and 0 warnings.
- Production build and `git diff --check` pass; required product documentation
  and the Memory plan status are synchronized.


## 2026-07-11 — Memory remaining plan completion

- Completed T1b, T3, T4, T5, T6b, and T7 without changing the approved C0
  contracts. Memory now defaults to enabled+mory after Candidate Inbox landed.
- Added internal daily reflection, source projection for Web/Project/external
  contexts, per-conversation watermarking, retry fingerprints, abort safety, and
  a provider-backed structured extractor that never persists its prompt.
- Added independent candidates/suppressions, governed imports and migration,
  embedding configuration/backfill/fallback, content and agent-self operations,
  versions/sources/pin/expiry/forgetting, and the Desktop management flow.
- Final verification: mory 184/184, focused host 19/19, product/audit suite
  14/14, full Desktop/API regression 181/181, Desktop Svelte check 0/0,
  production build pass, and `git diff --check` pass.

## 2026-07-11 — Memory batch 1 (T2 + T6a)

- Closed the Project Session delivery and deferred runtime cleanup as decided.
- Reviewed Memory Plan C0 against current code; no unresolved product decision
  remains. Started mapping gateway, mory schema, adapter, and ingestion seams.
- Added shared namespace/domain/semantic/source types plus namespace encoders and
  the automatic prompt query plan. Five namespace/classifier tests pass.
- Added optional domain persistence across mory canonical validation, in-memory,
  SQLite, and pgvector contracts. Legacy SQLite migration preserves existing
  rows and adds the column/index idempotently.
- Structured host writes now resolve stable `mory://<type>/<subject>` paths and
  domain namespaces; unstructured writes retain unique low-confidence paths.
  Prompt search merges owner/chat/agent/project namespaces plus legacy chat ids.
- Verification: mory 181/181, host namespace/path 7/7, root production build pass.
- Completed runtime scope propagation for prompt snapshots and the Agent Memory
  tool, including current Project identity. Cross-namespace get/update/delete,
  global search, and compact now operate on actual namespace rows.
- Adversarial review fixed structured default-domain writes falling back to chat
  and owner/project rows being skipped by global operations. Final verification:
  host scope/path tests 23/23, mory 181/181, production build pass, diff check pass.


## 2026-07-11 — Project Session output routing and inspection

- User approved implementation order: Project Session first, runtime cleanup later.
- Started Slice A investigation and established persistent implementation plan.
- Completed Slice A: added Project-mode Bash relocation and full-output routing
  controls, wired them from the shared runner, and passed all 21 focused Bash
  output/approval tests.
- Started Slice B with a shared `RunOutputLayout` and Project-aware `write`
  targets/details. The combined Bash/write suite passes 24 tests.
- `npm run check` is not defined in the root package; recorded this and switched
  verification to supported repository commands.
- Root production build completed successfully; only pre-existing Vite dynamic/static
  import warnings were reported.
- Added the first ProjectInspection implementation and four read-only Project
  routes for tree, preview, Git status, and per-path diff.
- Added coverage for bounded tree reads, `.git` hiding, outside symlinks,
  filenames with spaces, deleted/untracked files, non-Git directories, and a
  malicious repository `core.fsmonitor`; focused suite now passes 28 tests.
- Production build passes with the new generated routes; existing Vite import
  advisories remain unchanged.
- Completed Desktop Project panel integration with Files, Changes, and
  Attachments tabs; directory navigation, text preview, Git diff/untracked
  preview, media preview/download, refresh, errors, loading, and read-only copy.
- Added zh-CN/en-US copy, Geist semantic styles, focus-visible treatment, and a
  narrow-window overlay layout. `frontend-design` reinforced the restrained,
  developer-tool visual direction rather than introducing a second UI system.
- Verification: Desktop Svelte check 0/0, UI structure 34/34, Desktop API
  66/66, Tauri Rust 10/10, ProjectInspection 4/4, root production build pass.
- Completed Slice C with opaque tree cursors/load-more, binary and oversized
  states, bounded partial Git output, empty-repository behavior, and parent-repo
  path projection. ProjectInspection coverage is now 8/8.
- Completed Slice B structured results for Project write/edit, generated image,
  video and speech files, and attachments. Focused output/inspection suite is
  40/40 and Desktop Svelte check remains 0/0.
- Final root production build passes. The full Desktop UI suite currently has
  one unrelated assertion failure: it expects `ph-chats-circle`, while the
  concurrently modified `ChatSidebar.svelte` no longer contains that icon.
  Project panel assertions pass; unrelated sidebar code was not changed.


## 2026-07-10 — planning

- Completed the `grill-me` interview and reached agreement on the navigation,
  draft, lifecycle, hierarchy, and naming rules.
- Inspected the desktop app's route switch, chat sidebar, and project store.
- Confirmed the visible empty-session bug is caused by an in-memory Web draft,
  not a missing server create-session endpoint.
- Logged two harmless read-command path errors and adjusted the inspection
  commands rather than retrying either form.
- Inspected the Web/project API and session storage boundaries; documented the
  required server-owned idempotent empty-session operation and unified sidebar
  design in `task_plan.md`.
- Completed the planning phase. Awaiting approval to begin implementation
  phase 2; no product code has been modified.
- User approved the plan. Began phases 2–3 after confirming the worktree
  already contains unrelated user changes; those changes will be preserved.
- Implemented the persisted empty-session contract, unified multi-expand
  sidebar, embedded project tree, contextual headers, and deletion fallback.
- Verification passed: Desktop `svelte-check`; Desktop UI/HTTP/Rust suite;
  Session Store + Desktop API suite. Updated required product docs.
- Completed the preview-driven sidebar refinement: compact primary headings,
  one Projects heading, hover-only controls, fixed-width Session text, padded
  right overlays, no horizontal scrolling, and Chat-matched project actions.
- No product code has been changed. Planning artifacts only.

## 2026-07-10 — automation workspace refresh

- Confirmed the request targets the chat-side Automation workspace, not the
  Settings task management page.
- Mapped the current implementation: it embeds the card-heavy `TasksSection`;
  sidebar shortcuts lack their active-pane state; the requested list/detail
  model can be introduced locally while preserving the existing Settings UI.
- Started implementation phase 2. No product code changed yet.
- First type-check caught one Svelte runes-mode prop error (`export let` is not
  allowed). Replaced it with the component's required `$props()` form before
  retrying; no runtime behavior was exercised on the failed check.
- The local desktop preview port was already occupied, so the verification
  step will reuse the existing preview instead of starting a second server.
- Completed the compact Automation list/detail workspace, sidebar active states,
  localized responsive styles, UI regression assertions, and required project
  documentation. `svelte-check` completed with 0 diagnostics and all 30
  Desktop chat UI tests passed. The running local preview showed the Automation
  and Skills active states with no browser-console warnings or errors.
- The in-app browser refreshed its tab identity during narrow-window checking;
  the next check will reacquire the existing local preview tab rather than
  retrying the stale handle.
- Final verification passed: `svelte-check` reported 0 diagnostics, the Vite
  production build completed, all 30 Desktop chat UI tests passed, and the
  600px in-app-browser check reported no horizontal overflow. The build kept
  its pre-existing dynamic-import/chunk-size advisory warnings only.

## 2026-07-10 — automation interaction and scheduling controls

- Began a focused regression pass for default-detail behavior, per-task busy
  state, automation-session leakage, and persistent pause/resume semantics.
- Confirmed the current global busy flag and missing event enabled field are
  direct causes of two reported problems. Session leakage remains under
  reproduction before a fix is selected.
- Added two red regression tests, then implemented their shared-layer fixes.
  The first type-check caught one missing translation key reference and one
  missing type import; both are corrected before rerunning the suite.
- Completed the list-first/default-closed detail behavior, per-task run and
  pause/resume controls, event watcher guard, session-origin propagation, and
  timestamp overlay background. Focused server tests, Desktop Svelte checks,
  UI regression tests, and the production build are now green; final diff and
  focused suite rerun remain.
- Final focused test suite passed (16 server/session tests, 65 Desktop API
  tests, and 31 Desktop UI checks), `svelte-check` reported 0 diagnostics, and
  production build completed. Scoped `git diff --check` is clean; the full
  worktree retains one unrelated trailing-blank-line warning in
  `webSearchTool.test.ts`, which was left untouched. Build emitted only its
  existing dynamic-import advisories.

## 2026-07-11 — Project session file/change visibility analysis

- Started a read-only design analysis after the user clarified the desired
  experience: every Project turn should expose generated artifacts, filesystem
  changes, a project tree, and Git diff without placing runtime metadata in the
  project root.
- Mapped the initial attachment and activity paths. No product code changed.
- Confirmed the Desktop file pane is attachment-only and does not resolve
  project sessions; current Runner UI events and persisted activities contain
  no changed-path or Git facts. No product code changed.
- Completed the current-state map. The remaining phase is to synthesize a
  shared turn-provenance module and Project inspection design; no product code
  changed.
- Completed the read-only design. Recommended one shared provenance module,
  one Project-only inspection module, two distinct UI views, and a staged
  verification plan. No product code changed.
- Wrote the expert-review specification and added the planned P1 requirement to
  `prd.md`. No product code changed.
- Performed a final design consistency pass: clarified shared run admission,
  neutral cross-channel table names, safe session-deletion retention, and
  read-only Git execution constraints. Scoped `git diff --check` is clean.
# Daily materials internal task (2026-07-11)

- Implemented event schema, isolated reader identity, DailyMaterialsService,
  runtime dispatch, managed scheduling, internal manual triggering, settings,
  Desktop controls, bilingual copy, and momo-agent templates/contracts.
- Core daily-material/reflection/scheduler suite passed 14/14; Desktop Svelte
  check passed 0/0 and the root production build passed.
- Initial Desktop plugin persistence test failed because its test catalog did
  not include `mory`; corrected only the fixture and retained backend validation.
- Final adversarial verification and documentation update are in progress.
- Final verification passed: focused server/settings/runtime 32/32, Desktop
  Svelte check 0/0, targeted UI test, root build, Desktop build, and both repos'
  `git diff --check`.
- Real runtime acceptance configured `daily-materials-default`, scanned 2
  authorized Web messages, and created momo-agent
  `content/daily-materials/2026-07-10.md` with the expected notification text.

---

# Memory review bug fixes — progress (2026-07-11)

- Read the supplied review and confirmed all five findings against their owning
  implementation seams.
- Started a test-first repair pass; no production fix has been applied yet.
- Added five regression tests and captured the expected red state: all five
  failed for the exact reviewed symptoms.
- Implemented the five focused fixes; the combined focused suite passes 10/10.
- Adversarial review narrowed candidate isolation to typed validation failures,
  preserving retry behavior for storage and other unexpected failures.
- Added an explicit storage-failure/watermark regression. Scheduler/Desktop/API
  regressions pass 71/71, production build passes, Desktop Svelte check reports
  0 errors and 0 warnings, and `git diff --check` is clean.
- Final Memory suite passes 24/24 after the safety regression.

---
# Owner-level memory automations and task tabs (2026-07-13)

- Confirmed product semantics with the user: one owner-level scheduler entry,
  dynamic discovery of future Bots, and separate User/System automation tabs.
- Read runtime-debug, frontend-design, planning, and repository design guidance.
- Completed read-only root-cause validation against source, local event layout,
  and the existing 10-test scheduler/reflection suite. No runtime data changed.
- Chose a shared owner watched-events directory rather than anchoring the event
  to a "first" Bot, so Bot additions/removals cannot orphan the automation.
- Confirmed daily-material execution must aggregate current scopes before the
  service call; moving the loop alone would retain duplicate file appends.
- Added red regressions for one owner event, dynamic future-Bot discovery,
  legacy managed-file migration, explicit system classification, and accessible
  User/System tabs. The focused run failed only on the intentionally absent
  implementation seams.
- Owner scheduler/migration and Desktop projection tests now pass 15/15. The
  first UI/type pass found one class-contract mismatch and one narrowed-union
  error; both received localized fixes.
- Desktop UI regressions pass 42/42 and Svelte diagnostics report 0 errors and
  0 warnings. Root TypeScript remains red on broad pre-existing dependency and
  package errors; touched-file filtering exposed three new local typing issues,
  which were corrected.
- Implemented the shared system owner watcher, dynamic per-run target
  collection, target-isolated reflection/material orchestration, direct
  per-target notifications, and idempotent legacy managed-file removal.
- Added explicit managed metadata through the task API/Desktop contract and a
  responsive bilingual User Tasks/System Tasks segmented navigation. System
  entries use localized titles and cannot be edited or deleted as custom tasks.
- Adversarial review moved legacy cleanup ahead of channel-manager lookup and
  confirmed system edit/delete protection exists in both UI and API. The
  remaining daily-material content aggregation question is explicitly out of
  scope; scheduler duplication is removed without changing its watermark model.
- Final verification passed 32 focused scheduler/event/reflection/material/task
  tests, 44 Desktop UI/HTTP-scope tests, Desktop Svelte diagnostics with 0 errors and 0
  warnings, Desktop Vite production build, root SvelteKit production build,
  and `git diff --check`. Updated features, PRD, changelog, and README.

---
# Agent workspace (2026-07-12)

- Read the approved workbench concept, frontend-design guidance, planning skill,
  and repository design system.
- Confirmed the revised product direction is a main-app workspace directly below
  Skills, named Agent/Agents, with user-created agents represented as pugs.
- Began mapping navigation, Agent API, and existing Desktop verification seams.
- Added the `agents` main workspace directly below Skills, wired it to the
  existing safe Desktop Agent endpoint, and filtered the built-in `default`.
- Built a responsive, theme-aware office scene with per-Agent desks and walking
  CSS pug characters, plus empty/loading/error states and reduced-motion rules.
- Added source-level UI regression coverage for placement, data filtering,
  Agent loading, animation, and accessibility preferences.
- Verification passed: Svelte diagnostics 0/0, all 36 Desktop UI tests passed,
  and the Vite production build succeeded (only the pre-existing chunk warning).
- Adversarial review confirmed `default` filtering, background polling pause,
  active navigation isolation, narrow layout, and reduced-motion fallback.
- Updated features, PRD, changelog, and README with the delivered slice and the
  explicitly deferred live run/subagent telemetry milestone.
- Added a credential-safe Trace run projection keyed by channel Bot binding,
  with focused tests for active, recent terminal, and expired terminal states.
- Agent Studio now polls activity every 2.5 seconds and renders a Boss station,
  working/completed/error labels, and animated file-transfer links.

# Trace active-run controls (2026-07-12)

- Added exact live Runner snapshots and channel/session abort delegation.
- Added a shared credential-safe active-run projection and action endpoint.
- Added bilingual responsive controls to Web and Desktop Trace pages.
- Verified 7 active/trace cases, 37 Desktop UI cases, zero Desktop Svelte
  diagnostics, and the full SvelteKit production build.
# 2026-07-13 — GitHub bug repair #1-#6

- User chose to prioritize the six issues labeled bug and defer #7-#9.
- Loaded the grilling, diagnosis, runtime-review, and file-planning workflows.
- Read every issue body, current PRD claims, branch state, and overlapping
  uncommitted diff. No product code has been changed in this pass yet.
- Started Phase 1: establish one fast red-capable feedback loop per issue before
  selecting or editing production seams.
- Confirmed #3's server-side empty-Session reuse seam and temp-storage regression
  test. Mapped #1's route/raw URL/Tauri permission path and #6's two distinct
  persistence consumers.
- One read-only shell inspection partially aborted because zsh treated `[id]` as
  a glob; reran with the filename quoted and recorded the error in the plan.
- Existing focused feedback loops pass: Session/workspace/activity 11/11,
  Desktop UI/HTTP contracts 41/41, Project inspection 8/8.
- Checked the official Tauri v2 configuration reference: `acceptFirstMouse`
  addresses the exact inactive-window first-click symptom but requires enabling
  macOS private API support, so this is a product/distribution decision before
  editing #4.
- User challenged the click-through diagnosis. Confirmed the config experiment
  alone was not causal proof; Cargo also rejected it without the matching
  feature. Reverted the experiment and returned #4 to diagnosis.
- Audited all three workspace loaders. No common permanent request latch was
  found. Kept #4 open pending a real UI/request discriminator.
- Detected new concurrent/untracked Project per-session registry work in the
  shared worktree; preserved it and switched #2 review to that stronger design.
- Instrumented the real Desktop page through Chrome DevTools: all three first clicks were delivered and switched panes; request failures, not click-through, caused the apparent no-op.
- Added a red-first Desktop UI contract, then gated workspace requests on successful bootstrap, added same-endpoint retry, and added localized actionable errors for bootstrap, Skills, and Automations failures.
- Ran stop-service/reload/restart fault injection: the UI showed an error instead of eternal Loading while offline, then the next navigation click reconnected and loaded Auto tasks, Skills, and Agents.
- Adversarially tightened Project Chat's registry singleton so existing session entries resolve the latest mounted project/model/thinking dependencies rather than stale component closures.
- Added/verified the Project raw-file route test and persisted-activity transcript tests; confirmed scoped empty-Session reuse.
- Updated features, PRD, changelog, and README. #6 is recorded as decision-pending because its two stores preserve different required data.
- Final verification passed: Desktop Svelte diagnostics 0/0, Desktop UI 40/40, transcript 2/2, conversation activity + Session Store 8/8, Project raw route 1/1, settings sanitize/store 13/13, and both root and Desktop production builds. Only existing Vite chunk/dynamic-import warnings remain.
- Reproduced the reported Skills state in a real browser (26 total, 0 cards), added a failing component contract, and migrated `InstalledSkillsPane` from stale legacy `$:` derivations to Svelte 5 runes.
- Browser recheck passed with 26/26 cards and exact-name search narrowing to one card; Desktop UI 41/41 and Svelte diagnostics 0/0 pass.
- Desktop production build passed; adversarial review confirmed endpoint changes still reload once, request failures remain recoverable through the existing retry action, search and description expansion remain reactive, and no debug harness/process was left behind.

---

# 2026-07-13 — Issue #6 UI Session storage

- User approved renaming the misleading Web `users` persistence directory to
  `ui-sessions` and synchronizing UI Session deletion with Agent context deletion.
- Recorded the UI Session / Agent Context boundary in `CONTEXT.md`.
- Added red-first temporary-directory regressions for new-layout writes, legacy
  layout migration, and deleting the last UI-linked Agent context.
- Implemented lazy order-preserving migration to `ui-sessions`, with cleanup
  retry semantics that retain the legacy index whenever an old file cannot yet
  be removed.
- Routed both Web and Desktop deletion through one shared lifecycle that checks
  live runners and removes Agent context before the retryable UI cleanup.
- Adversarial review fixed two partial-failure gaps: a failed old-file unlink no
  longer drops the migration index, and an already-missing context still clears
  a stale active-session pointer.
- Verification passed 31 focused temp-store/query/lifecycle tests, the full
  SvelteKit production build, and `git diff --check`.

---

# 2026-07-14 — Desktop Trace delete feedback

- Read the project design system and the diagnosis/runtime-review workflows.
- Traced the action from Desktop Trace through `stopDesktopActiveRun` to the
  shared active-runs endpoint and SQLite Trace fact update.
- Preserved the existing dirty worktree and limited the planned patch to the
  Trace confirmation/action seam plus focused tests and required docs.
- Added and ran the focused Desktop UI action contract red; it failed because
  `TraceSection` still called `window.confirm()` and had no visible dialog state.
- Replaced that native confirmation with the shared modal pattern while keeping
  the existing run-scoped API and audit-preserving behavior unchanged.
- Focused verification passed: Desktop UI action contract 50/50, API/Trace tests
  79/79 using in-memory SQLite, and Svelte diagnostics 0 errors / 0 warnings.
- Updated features, PRD, changelog, and README with the delivered behavior.
- Full release checks passed: 52 Desktop UI/HTTP contracts, Svelte diagnostics
  0/0, and the Desktop production build. The build emitted only the existing
  dynamic-import and chunk-size warnings.
- Adversarial review covered double-submit, focus/Escape, refresh races, error
  visibility, and audit retention; no further production change was required.
# 2026-07-14 — GitHub issue #13 full completion execution

- User requested an uninterrupted goal-by-goal completion pass for all gaps found by the
  re-audit. Created an active goal and a nine-goal execution matrix from shared foundation
  through page implementations, cross-app accessibility, and final adversarial verification.
- Loaded the file-planning and frontend implementation procedures. Chose the existing
  Molibot macOS product layer over the frontend skill's generic aesthetic suggestions.
- Reloaded the live open Issue #13 and began reading the authoritative `DESIGN.md` to EOF.
  The first combined read was truncated and is recorded; bounded reads will complete it.
- Completed `DESIGN.md` and inventoried the Desktop source tree plus the current Issue #13
  diff. Confirmed that the next safe seam is a small shared UI primitive layer adopted
  sequentially by the target pages, while preserving the existing stores and APIs.
- Inspected Models, Providers, Automations, Trace, transcript, live-message, and composer
  implementations. Recorded the smallest page seams and shared projection need before
  adding tests or editing production behavior.
- Added `docs/designs/issue-13-completion-plan.md`, listing every known missing or weakly
  verified acceptance item under G0–G9.
- Established a green migration baseline: Desktop structural UI/HTTP 53/53, API 70/70,
  Svelte diagnostics 0 errors and 0 warnings, and clean diff whitespace checks.
- Mapped the exact model/provider contracts, existing task schedule parser, and global CSS
  tokens. Selected presentation-only helpers as the safe seam for human labels and schedules.
- Added red-first presentation tests, implemented shared model/provider humanization and
  natural schedule formatting, and passed the focused suite 3/3.
- Created and styled the G1 shared UI primitives. Fixed one Svelte-local type declaration
  error; diagnostics now pass 0/0 and presentation tests remain 3/3.
- Migrated the Settings shell and General page to the shared primitives, added descriptions
  for every Settings route and scroll-edge state, then updated superseded source contracts.
  Desktop UI/HTTP tests pass 53/53 and Svelte diagnostics remain 0/0.
- Browser-verified G2 at 860×620 and 1280×800. Fixed a real 48px select-collapse bug,
  humanized the readiness model label, and accepted Chinese/light plus English/dark screenshots.
  Wide layout has no horizontal overflow and the sticky header edge responds to scroll.
- Completed G3 Models: migrated the page to shared primitives, humanized populated values,
  collapsed technical IDs, renamed task tiers, added advanced disclosure and optimistic
  rollback. Accepted zh/light and en/dark 860px screenshots; selectors measure 260×30px.
  Verification passes UI/HTTP 53/53, API/presentation 73/73, and Svelte diagnostics 0/0.
- Completed G4 Providers after confirming the earlier large patch had not landed. Replaced
  the expanded provider rows with a bounded master-detail browser, shared 260×30px selects,
  human names, collapsed IDs/protocol/URL details, anchored overflow actions, and an in-app
  destructive confirmation. Verified populated zh/light and en/dark at 860×620 plus wide
  width with no horizontal overflow; UI/HTTP 53/53, API/presentation 73/73, diagnostics 0/0.
- Completed G5 Trace: normalized the range control and product wording, localized active-run
  timestamps, bounded the live list, moved task summaries/run IDs behind technical disclosure,
  and adopted shared Empty/Skeleton/Status/Overflow components without changing stop/orphan
  API behavior. Verified zh/light and en/dark at 860×620 plus 1280×800 with no overflow;
  UI/HTTP 53/53, API/presentation 74/74, diagnostics 0/0.
- Completed G6 Automations: both Settings and Chat now render the same list/detail workspace;
  schedules are localized natural language, wide/narrow inspector behavior matches the PRD,
  execution state distinguishes Starting/Running and can Stop through the existing active-run
  API, reversible enable changes are optimistic with Undo, and IDs/cron/targets/session IDs are
  secondary technical data. Verified populated user/system lists, history modal, zh/light wide,
  zh/light and en/dark 860px overlay states with no overflow; tests 53/53 + 74/74, diagnostics 0/0.
- Completed G7 Chat: assistant units use actual Agent identity, thinking/tool detail is opt-in,
  message models are humanized with raw keys collapsed, search persists for reversible leftward
  expansion and gains Command+F/Escape handling, and the shared Composer is a stable 50px single
  row at rest. Verified populated zh/light and en/dark at 860×620 and 1280×800: content/composer
  cap at 720px, no horizontal overflow, zero thinking panels open; tests 53/53 + 74/74, 0/0.
- Completed G8 and G9. Added persistent and automatic low-performance degradation,
  Command+F/K/comma/Return behavior, a keyboard-navigable quick-action palette, arrow/Escape
  overflow menus that unmount while closed, and reliable focus/Escape handling for Provider
  and Automation dialogs. Browser checks confirmed the 260×30px General select, 38×22px
  Switch, low-performance root state, command-palette focus cycling, menu unmounting, and
  keyboard sidebar resizing. The adversarial pass fixed background-focus Escape failures and
  the still-mounted closed-menu content before acceptance. Final verification is UI/HTTP 53/53,
  API/presentation 74/74, Svelte 0/0, production build green, and clean diff whitespace.

# 2026-07-15 — GitHub issue #10 audit and merge

- Loaded the full issue through authenticated GitHub access after anonymous and sandboxed reads failed.
- Located the exact issue worktree and confirmed its implementation is uncommitted and based one commit behind `master`.
- Loaded the required file-planning and frontend-design workflows plus the complete `DESIGN.md` product rules.
- Established explicit audit, merge, implementation, documentation, and adversarial verification gates. No product code has been changed in this session yet.
- The first focused-test invocation did not start because the orchestration object was malformed; recorded it and corrected the invocation without changing the test command or repository.
- The corrected focused test reached `tsx` but the sandbox denied its temporary IPC socket; the next attempt uses scoped host execution as required.
- Baseline verification passed: projection/scene 8/8, Desktop UI/HTTP 47/47, Svelte diagnostics 0/0, and production build. The build reports only existing-style chunk-size/dynamic-import warnings.
- Concluded the issue is incomplete but the current implementation slice is safe to preserve and merge. Began Phase 2 as the user explicitly requested.
- The first add/commit attempt was blocked before staging because the sandbox cannot write `.git/worktrees/.../index.lock`; product files remain unchanged and the same scoped operation will be retried with approval.
- Saved the pre-existing issue implementation as branch commit `7d37f272`.
- Began the merge into `master`. Resolved 5 conflicts surgically: App keeps v2.4.8 low-performance/settings state plus the Agent preview route; CSS replaces only the superseded office block with Agent City; planning logs retain both histories. Conflict markers and whitespace checks are clean.
- First post-merge run passed projection/scene 8/8 and Desktop UI/HTTP 54/54. The parallel diagnostic started before pnpm finished linking the newly merged Three.js dependency, and the sandboxed pnpm build hit its cache SQLite restriction; both are environment/order failures, so verification will rerun sequentially with the installed binaries.
- Sequential rerun passed Svelte diagnostics 0/0 and the direct Vite production build. The merge result is green and ready to commit before remaining implementation work continues on `master`.
- Started current-page visual QA. Port 1422 was already in use, so the existing process is untouched and the isolated preview will use another port.
- Port 1423 was occupied as well; moved the preview away from the existing Tauri/Vite port range rather than disturbing those processes.
- Opened the isolated 1280×800 Agent route in the in-app browser. The shell renders, but the app is offline and the pane stays in its loading state, so this screenshot is not valid Agent City acceptance evidence yet.
- Reconnected the preview to the already-running Desktop-managed service through the documented local proxy. The app now reports Online; dismissed only the preview browser's first-use overlay so the Agent surface can be inspected.
- The first combined post-onboarding observation timed out only at screenshot capture. Following browser recovery rules, the next observation is a fresh DOM snapshot without repeating the same composite call.
- Fresh DOM evidence confirms the common-scale city is live with Global + 4 regular Agents and real accessible name/status buttons. A bounded screenshot timed out as well; ended repeated screenshot attempts and changed visual evidence strategy.
- The first canvas-read invocation did not execute because its wrapper contained an unescaped display template literal. Recorded it and switched to plain concatenation without changing the inspection itself.
- Measured the live common-scale layout: 972×560 city, zero horizontal overflow, and all Global/Agent labels visible as 108×38 DOM controls.
- Completed the narrow source audit and selected four surgical completion gaps: safe in-place quality downgrade, information-equivalent 2D details, explicit 0/1 projection coverage, and required product documentation correction.
- Added red UI contracts for fallback detail parity and in-place quality downgrade plus explicit 0/1 projection coverage. Implemented the two fixes; Agent City tests pass 9/9, UI 52/52, and Svelte diagnostics 0/0.
- Replaced stale CSS-office product documentation across `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md`, leaving formal Blender GLB assets explicitly planned.
- Switched the real preview to Dark theme through Settings and returned to Agent City. After the expected bootstrap poll, the complete 5-Agent semantic city is present.
- Detected that the browser viewport override did not apply: both checks remained 1280×800. Corrected the evidence rather than claiming a narrow live pass. At the actual size, Dark background, visible labels, zero horizontal overflow, and intentional vertical workspace scrolling were verified.
- Browser console had no errors but reported deprecated `PCFSoftShadowMap`; replaced it with supported `PCFShadowMap` and queued a clean reload check.
- Fresh Agent-page reload is console-clean and still exposes the semantic city. Reset the temporary viewport override and completed browser QA.
- Confirmed no service is listening on port 3000. The previously used `service/server.mjs` path no longer exists in this checkout; stopped guessing and switched to repository script discovery.
- Found the current `npm start` entrypoint. Its first run reached the server but the sandbox denied binding 127.0.0.1:3000; the next run uses scoped host execution.
- Host start then reported data ownership by PID 99675, while `molibot-service.sh status` reports stopped/no pid file. No process was changed; a read-only PID inspection is required to distinguish a stale lease from a live alternate instance.
- Final verification passed: Agent City projection/scene 9/9, Desktop UI/HTTP 54/54, server Agent data contract 6/6, Svelte diagnostics 0/0, production build, and `git diff --check`.
- The adversarial pass checked stable 0/1/100/101 projection, Canvas-safe full→low→2D downgrade, fallback information parity, rendering lifecycle cleanup, and theme/viewport evidence. It added explicit tooltip relationships for keyboard/screen-reader users and retained the honest limitation that live narrow-viewport and composed WebGL screenshot acceptance were unavailable in this browser run.

---
# 2026-07-15 — Memory Center and per-turn Memory Trace

- Started implementation from the approved PRD scope with explicit gates for exact final-injection accounting, immutable history, non-blocking tracing, and separate reference/write semantics.
- Loaded the required file-planning and frontend-design workflows. Molibot's `DESIGN.md` remains the controlling visual system; no generic redesign is being introduced.
- Confirmed the critical correctness gap: selected memory metadata can overstate what the prompt compactor actually injects. Phase 1 begins at this final serialization seam with focused tests.
- Mapped the implementation seams end to end: final prompt envelope, Runner raw tool results, Agent context entry persistence, UI metadata projection, and Desktop lazy-loading contracts.
- Final-injection, SQLite trace, write-receipt, and context-entry focused tests are green (9/9). The Runner now records only successful-turn traces and catches trace-store failures without changing the answer path.
- Completed the Chat path: lightweight per-message counts, lazy trace API, reference/write sections, feedback submission, immutable snapshots, and responsive keyboard-dismissible drawer.
- Completed the Memory center path: Saved/Pending/Advanced views, content-first saved cards, search, existing edit/source/version/delete tools, fixed save footers, and an `allowInjection` control enforced by shared prompt selection.
- Current focused verification is green: memory/injection suites 14/14 and Desktop Svelte diagnostics 0 errors/0 warnings.
- Broader projection/session coverage passed 13/13. Six unrelated Runner cases attempted to initialize the real read-only approval/settings database; the run was stopped as invalid evidence and will not be retried against user data.
- Full Desktop service/API regression passed 197/197; the updated API client file passes 71/71 including lazy Trace load and feedback request paths. Final focused server/projection/session coverage passes 27/27.
- Browser QA verified one non-duplicated Memory heading/description in Chinese and English, Dark theme, a 600px viewport with `scrollWidth === clientWidth`, and corrected the duplicate hint discovered in the first real render.
- Adversarial review fixed five likely failures: selected-vs-injected count drift, trace failures blocking answers, disabled-memory loss on duplicate merge, feedback errors hiding loaded trace content, and dialog focus escaping/not returning to the trigger.
- Final gates: Svelte diagnostics 0/0, Server production build green, Desktop production build green, and documentation synchronized across `features.md`, `prd.md`, `CHANGELOG.md`, `readme.md`, and the detailed PRD.

---
# 2026-07-15 — Project Chat blank transcript fix

- Reproduced the reported session from live data: Project API returned 13 messages for `momo-agent / 当前这是一个什么项目`.
- Identified two independent transcript requests and one visible Runtime authority as the failure mechanism.
- Added a focused regression requiring one request and matching Store/Runtime content; it passes 2/2 with the existing Project Session switching regression.
- Real browser verification renders 13 Project Chat articles, the expected header, and no empty state.
- Desktop API tests pass 71/71, Svelte diagnostics report 0 errors/0 warnings, production build passes, and `git diff --check` is clean.
# 一次性提醒任务收件箱：进度（2026-07-15）

- 已读取并采用 `planning-with-files` 与 `frontend-design` skill；视觉方案服从项目既有 Geist、语义 token 与 shadcn 组件体系。
- 已建立独立实施计划和验收标准。
- 已确认当前工作区存在大量无关未提交修改，本次将只做外科式增量修改。
- 当前：核对 `DESIGN.md`、PRD、任务投影、触发落盘和 Desktop 页面结构。
- 已完成数据与 UI 链路核对；开始实现共享契约、事件未读落盘和已读 API。
- 已完成共享契约、one-shot 未读落盘、已读 API、第三个 Tab、todo 列表、侧边栏角标、双语和响应式样式。
- 验证通过：聚焦运行时/投影/Desktop API 86/86，Desktop UI 53/53，Svelte 0 错误 0 警告，Server 与 Desktop production build，`git diff --check`。
- 对抗式复查完成并修正：轮询生命周期、失败重试风暴、隐藏系统未读计数；历史未读洪水、周期任务误标和失败误报均有明确防线。
- 状态：完成，未提交且未触碰用户现有的记忆中心等其它改动。

---
# 系统任务执行会话不可打开：进度（2026-07-15）

- 已读取并采用 `diagnosing-bugs` 与 `planning-with-files` skill。
- 当前阶段：优先建立可捕获用户原始症状的红色反馈循环，尚未修改业务代码。
- 已确认本机运行服务健康，并从真实 Desktop tasks API 捕获两个存在 completed execution 的系统任务夹具。
- Phase 1/2 完成：真实 API 反馈循环连续两次红灯；最小必要元素为 system task + completed lease + session action，两个不同系统任务均复现。
- Phase 3 开始：已向用户展示 5 个可证伪假设，开始检查内部 runtime 与存储边界。

---
## 2026-07-15：系统任务执行详情为空（继续）

- [x] 用真实 Desktop API 复现：两个系统任务详情均返回空消息，退出码为 1。
- [x] 排除单纯前端弹窗故障：空数据来自后端 session projection。
- [x] 初步确认内部任务绕过普通会话/context 写入链路。
- [ ] 核对内部任务实际返回结果与租约存储能力。
- [x] 核对内部任务实际返回结果与租约存储能力：service 有结果，但 watcher 丢弃、lease 无字段。
- [ ] 先补失败回归测试，再实现持久化与详情展示修复。
- [x] 确定兼容边界：新记录保存业务结果；旧记录展示真实租约摘要，不伪造已丢失内容。
- [x] 添加两条失败回归测试：租约结构化结果持久化失败；系统任务执行详情 projection 尚不存在。
- [x] 实现 lease `result_json` 迁移、执行结果透传、Owner 系统任务指标聚合与 Desktop 安全 projection。
- [x] 系统任务 UI 改为“查看执行记录”，弹窗展示状态、时间、尝试次数与业务指标；中英文均已补齐。
- [x] 定向回归 108 项中 107 项通过；剩余 1 项仅为新增测试期望漏写 `scannedConversations: 0`，实现结果正确，已修正测试。
- [x] 修正后定向服务端测试 36/36 通过。
- [x] Desktop `svelte-check`：0 errors，0 warnings。
- [x] 对抗式复查补齐失败执行错误文本、旧记录 fallback 与旧 SQLite `result_json` 自动迁移测试。
- [x] 最终定向测试 38/38、Server production build、Desktop production build、Desktop Svelte check 全部通过。
- [ ] 当前 3000 端口仍是构建前旧进程；避免中断用户会话，本轮不擅自重启，需在交付后重启一次 Molibot 服务加载新代码。
## 2026-07-15：内部审批 / Event Session 归属与侧栏标题修复

- [x] 读取 debugging 与文件化计划 skill，登记严格修复顺序和不可删除约束。
- [x] 第 1 项：Desktop 审批改为 `/api/desktop/host-bash { action: resolve_approval }`；客户端 `/hosttools` mapper 已删除，红灯转绿。
- [x] 第 1 项反馈循环：Desktop API 单测断言审批必须请求专用 endpoint 且 body 不含聊天 `message`。
- [x] 第 1 项已找到正确测试 seam：Desktop client request contract。
- [x] 第 1 项红灯连续两次稳定复现：实际请求 `/api/chat` 且 body 含 `/hosttools approve-session ...`。
- [x] 第 1 项服务端 scope 恢复方式确认，不需要扩大客户端请求字段。
- [x] 第 2 项：Event 来源 Session 红灯连续两次稳定失败，修复后持久化与目标解析两条回归均通过。
- [x] 第 2 项根因入口确认：Event JSON 未持久化来源 Session，运行时只能退化到 active session。
- [x] 第 2 项创建点与执行点确认：工具注册已有 sessionId；fresh/chat 优先级需在共享 runtime 修正。
- [x] Event 来源 Session 已贯穿 Web/Telegram/飞书/QQ/微信 synthetic event；legacy 文件保持兼容回退。
- [x] 用户报告的 SvelteKit 非法 endpoint export 已立即修复；Server production build 已通过。
- [x] 第 3 项：历史内部记录高置信度回填为 `internal:approval` / `internal:event`，普通 Chat 隐藏；测试确认原消息仍逐字可读。
- [x] 第 4 项：移除标题 `30ch` 固定上限并让时间进入独立 flex 列；宽度回归红灯转绿。
- [x] 第 5 项完成：核心验收 5/5、相关完整测试 111/111、Desktop UI 53/53、Svelte 0/0、Server 与 Desktop production build、`git diff --check` 全部通过。


---
## 2026-07-16：Issue #16 修复进度

- [x] GitHub connector 读取 issue #16（7 项、无评论）。
- [x] 读取 `DESIGN.md`、diagnosing-bugs、agent-runtime-debug-review、frontend-design 与 planning-with-files 规范。
- [x] 建立 Skill 引用与 Desktop 7 项症状的红色回归信号。
- [x] 第一轮实现：内置服务商、任务卡片/Session 入口、设置导航、App 版本、Skill 链接、Agent 标题、跨渠道 direct Event Context。
- [x] Desktop `svelte-check` 第一轮从 4 errors 修正到 0 errors / 0 warnings。
- [x] 完整测试：Desktop Chat/API 206/206、额外 runtime/prompt 定向 22/22、Desktop UI 56/56，Svelte 0 errors / 0 warnings；Server/Desktop production build 通过。
- [x] 真实页面检查：Settings 无自动任务入口、Diagnostics 显示 App 版本、Agent 仅保留一层标题；服务商空态正常。
- [x] 对抗式审查覆盖投递后持久化失败、execution 关联、内置/自定义服务商操作隔离、Skill 链接污染和窄窗口卡片布局；未发现未处理的阻断项。
- [x] 同步 `features.md`、`prd.md`、`CHANGELOG.md` 与 `README.md`。

### 错误记录
- 首次创建文件化计划时未发现 Git index 中已有同名大文件，错误覆盖了工作区副本；已从 HEAD 恢复全部原内容，仅追加本节，避免 3,000+ 行无关删除。
- direct event 测试固定 epoch 的期望 ISO 写错；已按实际 ISO 修正。
- provider 条件数组被 TS 推断成互斥数组联合；已显式声明 discriminated union。
