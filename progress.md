# 2026-07-12 — Bot Project mode

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
