# Daily materials internal task (2026-07-11)

## Goal

Implement `docs/requirements/daily-materials-task-handoff.md` end to end without routing internal work through the ordinary Agent Runner.

## Phases

1. Audit seams and establish red tests — complete
2. Implement event contract, isolated watermark reader, and service — complete
3. Wire runtime dispatch, scheduling, and manual trigger — complete
4. Implement settings/API/Desktop controls — complete
5. Update momo-agent templates and docs — complete
6. Verify, adversarially review, and update product docs — complete

## Verification gates

- Daily-material and reflection watermarks remain isolated.
- Failure, abort, and path escape never advance watermark or write scratch fallback.
- Internal manual trigger never enters the ordinary Agent Runner.
- Old settings sanitize safely and Desktop saves preserve unrelated fields.
- Manual trigger writes the dated file inside the registered Project.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Planning/source patches failed to write | 1-3 | Disk had only ~101 MiB free at 100% usage; removed only the reproducible Desktop `dist` build output before retrying. |
| First Desktop plugin persistence fixture used an empty memory-backend catalog | 1 | Added the fixture's expected `mory` backend; production validation remains unchanged. |
| Parallel Desktop `corepack pnpm check` wrapper hung without diagnostics | 1 | Terminated only that check process and verified with installed `svelte-check` and `vite` binaries. |

---

# Unified conversation and project sidebar plan

# Configurable memory reflection schedule and completion notice (2026-07-11)

## Goal

Allow the daily memory reflection time to be configured from Desktop and emit a
separate human-facing completion notice after a successful run, without routing
the reflection itself through the chat Runner or persisting runtime controls as
conversation messages.

## Assumptions

- The schedule is a global Memory plugin setting in local `HH:mm` time and is
  applied per enabled Bot using the Bot timezone already used by reflection.
- A completion notice is sent only when at least one new candidate is created;
  zero-candidate runs remain quiet.
- The notification uses existing channel delivery infrastructure and is never
  appended to model/session context.

## Phases

1. **Trace settings → watched event → internal dispatch → channel notice** — complete
2. **Add regression tests for schedule persistence and notice separation** — complete
3. **Implement shared settings, scheduler, runtime notice, and Desktop UI** — complete
4. **Run focused/full regression, visual/type checks, and update docs** — complete

## Verification gates

- Valid `HH:mm` values survive granular settings save/reload; invalid values are
  sanitized without losing unrelated Memory fields.
- Scheduler rewrites only the managed reflection event when configured time
  changes and preserves the internal execution contract.
- Successful runs with candidates emit one user notice; empty, failed, aborted,
  or retried duplicate runs emit none.
- No reflection prompt/control text or notice becomes a conversation message or
  future model context.
- Desktop control is bilingual, theme-safe, responsive, and uses existing
  shared settings components and fixed save footbar behavior.

---

# Memory review bug fixes (2026-07-11)

## Goal

Fix the five confirmed review findings without expanding memory behavior:
complete-day reflection coverage, per-candidate isolation, embedding key rotation,
embedding failure cooldown, and linear-time compaction membership checks.

## Phases

1. **Add five red-capable regression tests** — complete
2. **Apply surgical fixes at the owning seams** — complete
3. **Run focused and memory-wide regression suites** — complete
4. **Adversarial review and required documentation updates** — complete

## Verification gates

- A 03:00 scheduled run reads the previous complete local calendar day.
- One rejected extracted candidate does not suppress valid siblings or prevent
  the projection watermark from advancing.
- Rotating an embedding API key reconfigures the backend without persisting or
  logging the secret.
- After one embedding failure, add/search use lexical fallback during a bounded
  cooldown instead of repeating network attempts.
- Compaction uses constant-time membership sets for expired and duplicate IDs.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| All five new regression cases failed against the reviewed implementation | Initial red run | Confirmed each root cause, then applied one owning-seam fix per finding. |
| Broad catch around candidate creation could hide storage failures | First adversarial review | Added `MemoryCandidateValidationError`; reflection skips only malformed extracted candidates and still propagates infrastructure failures. |

---

# Memory improvement remaining delivery — T1b/T3/T4/T5/T6b/T7 (2026-07-11)

## Goal

Complete every remaining in-scope task in
`docs/requirements/memory-improvement-plan.md` without pausing for intermediate
approval. T8/T9 and Project runtime automatic cleanup remain out of scope.

## Assumptions

- The approved v2.2 C0 contracts are authoritative; implementation will not
  silently change identity, candidate, reflection, or prompt-injection policy.
- Reflection and Candidate Inbox ship together before memory defaults flip.
- Provider-backed embeddings must degrade cleanly; no API key is required for
  lexical operation or repository tests.
- All persistent tests use temporary/injectable storage, never user runtime DBs.

## Phases

1. **Map remaining seams and close T1b tokenizer consistency** — complete
2. **Implement T3 + T5 candidate/reflection state machine and importer governance** — complete
3. **Flip safe defaults and add json-file → mory migration** — complete
4. **Implement T4 semantic retrieval, namespace filters, and resumable backfill** — complete
5. **Implement T6b content/agent-self applications** — complete
6. **Implement T7 audit details, pinning, versions, and forgetting** — complete
7. **Complete Desktop Inbox/audit UI and APIs** — complete
8. **Run four end-to-end scenarios, adversarial review, full regression, docs** — complete

## Verification gates

- Pending candidates never enter prompt retrieval; confirm is atomic/idempotent.
- Reflection retries and aborts preserve watermark/fingerprint invariants and
  never write conversation messages or send channel output.
- Semantic retrieval is namespace-filtered and lexical fallback stays available.
- Content duplicate checks are explicit-only; content never leaks into chat.
- Pinned records survive compact/forgetting; versions/sources are inspectable.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Unified tokenizer made changed same-path values fall below the old similarity threshold and insert | First T1b regression | Stable-path records now always follow their update policy after exact duplicate detection; wording similarity no longer decides path identity. |
| New retrieval fixture was filtered by planner/type interaction | First T1b regression | Kept the tokenizer assertion focused by using a profile-compatible semantic type and asserting the write succeeded before retrieval. |
| Candidate confirmation fixture was shorter than the existing governance minimum | First Candidate Store test | Changed the fixture to a complete durable statement; retained production governance instead of weakening it for tests. |
| Narrowing per-message extraction removed a hint table still used by write governance | Combined focused regression | Restored the governance-only table while keeping automatic classification restricted to explicit remember intent. |
| Pin/expiry fixture hit mory's quality threshold before exercising retention | First T7 end-to-end run | Made the test memories explicit high-confidence event records so the test isolates pin/expiry behavior. |

---

# Memory improvement batch 1 — T2 + T6a (2026-07-11)

## Goal

Activate mory stable-path version chains and introduce the namespace/domain
model in one compatible schema batch. Do not implement reflection or Candidate
Inbox early.

## Contract status

- C0.1–C0.6 reviewed against current code — approved.
- mory is the only formal backend for new capabilities; json-file remains
  readable and compatible without receiving the new behavior.
- Namespace is the storage/version-chain isolation key; domain is audit and
  injection policy metadata; type remains mory's closed semantic type.

## Phases

1. **Map current gateway/mory schema and ingestion seams** — complete
2. **Add namespace/domain and stable-path contracts with migration** — complete
3. **Activate version-chain behavior and query plans** — complete
4. **Add focused namespace/version/migration tests** — complete
5. **Adversarial review, regression, and documentation** — complete

## Verification gates

- Same namespace + type + subject updates one version chain.
- Different subjects and different namespaces never overwrite each other.
- Unstructured text keeps a unique path and `lowConfidencePath: true`.
- Ordinary prompt lookup merges only owner/current-chat/current-agent; Project
  lookup additionally includes current project; content is never auto-injected.
- Existing json-file and legacy mory records remain readable.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Combined runtime-scope patch missed an already-clean formatting context | First scope-wiring patch | Split the patch into surgical edits; no partial changes were produced by the failed patch. |
| New default-domain test referenced an undefined timestamp constant | First focused regression run | Replaced it with the explicit fixed timestamp used by the surrounding tests. |

---

# Project Session output routing and inspection implementation (2026-07-11)

## Goal

Implement `docs/requirements/project-session-provenance-and-inspection.md` in
four verified slices. Runtime automatic cleanup is explicitly deferred.

## Implementation phases

1. **Slice A — P0 output safety** — complete
   - Disable Project-mode Bash mtime artifact relocation.
   - Store truncated Bash full output under Project runtime `tool-output`.
   - Preserve ordinary Bot behavior and add focused regression tests.
2. **Slice B — shared output routing** — complete
   - Introduce `RunOutputLayout`, explicit project/scratch targets, and
     structured file-tool details without filename-based routing guesses.
3. **Slice C — read-only ProjectInspection** — complete
   - Add bounded tree/file preview and hardened scoped Git status/diff routes.
4. **Slice D — Desktop project file panel** — complete
   - Add localized Files/Changes/Attachments tabs using existing shared UI.
   - Verify light/dark themes, keyboard behavior, and narrow widths.
5. **Documentation and adversarial verification** — complete
   - Run focused and regression tests; update features/prd/changelog/readme.

## Success criteria

- Project commands never relocate concurrently edited project files.
- Project root receives no Molibot scratch, attachment, or full-output metadata.
- Project inspection is bounded, read-only, root-confined, and does not invoke
  Agent Bash.
- The Desktop accurately labels project-global Files/Changes and session-local
  Attachments.
- Runtime automatic cleanup remains out of scope.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Root package has no `check` script | `npm run check -- --output human` | Use the repository's available build/test scripts and direct focused Node tests instead. |
| Desktop API test command doubled the `apps/desktop` path | Combined `--dir apps/desktop` with an `apps/desktop` working directory | Run pnpm from the repository root or omit `--dir` when already inside the package. |
| Desktop UI suite expects removed `ph-chats-circle` sidebar icon | Full Desktop test run; failure is in concurrent/pre-existing `ChatSidebar.svelte` changes outside Project inspection | Leave unrelated sidebar code untouched; retain passing Svelte check and Project-specific UI assertion evidence, and report the unrelated regression separately. |

---

## Goal

Move Projects out of their separate desktop page and into the chat sidebar as a
collapsible first-level group, while fixing creation and display of empty
sessions. The existing project directory and Agent-context behavior remains
unchanged.

## Confirmed product decisions

- The sidebar has two first-level groups: **Conversations** and **Projects**.
- Conversations contain channels as second-level nodes; projects contain
  projects as second-level nodes. Sessions are third-level nodes in both.
- First- and second-level groups are independently expandable; several may be
  open simultaneously. Their expansion state persists locally across restarts.
- Toggling a group is navigation-only: it must never change the active right
  pane or interrupt an Agent run.
- Project rows only expand/collapse. Clicking a project session selects it in
  the shared chat pane. There is no Projects page.
- Top-level New Conversation creates/reuses the Web empty draft. A project has
  its own New Conversation action; it creates/reuses that project's empty
  draft. Each scope has at most one empty draft.
- Empty drafts are saved immediately and only appear once persistence succeeds.
  On failure, preserve the active chat and present a retryable error.
- Project sessions never duplicate into the Conversations group.
- Ordering is newest activity first within every second-level node.
- Header format is `source-or-project / session name`.
- Creation of a project expands it but changes neither the active right pane
  nor session selection. Existing project directory behavior and management
  actions remain.
- Deleting an active session opens the next most-recent session in its group;
  if none remains, show an unselected empty state without recreating a draft.

## Implementation phases

1. **Map and test current data flows** — complete
   - Verify Web draft creation, project session API behavior, current title
     ownership, and existing test coverage.
2. **Unify sidebar and selection state** — complete
   - Replace the separate Projects view with the shared sidebar tree and
     selection-aware shared chat pane.
3. **Correct draft lifecycle** — complete
   - Persist/reuse blank Web and project sessions and update ordering safely.
4. **Apply the responsive, bilingual themed UI** — complete
   - Build the three-level navigation using existing UI patterns/tokens.
5. **Verify and document** — complete
   - Unit/integration checks, desktop visual checks in light/dark and Chinese/
     English, then update project documentation required by AGENTS.md.

## Verification gates

- New Web and project sessions appear immediately after a successful save.
- Repeated creation reopens the scope's existing empty session.
- Existing sessions, management actions, channel transport, project working
  directory behavior, and active Agent runs remain intact.
- Collapsing/expanding multiple groups persists across restart and never alters
  the right pane.
- The Projects page and its sidebar shortcut no longer exist.

## Proposed technical design

### Session persistence contract

- Add a shared session-store operation that returns the existing message-less
  conversation for a scope, or creates exactly one when none exists. Its scope
  is a Web profile or a single project id.
- Expose it through the existing granular Web-session and project-session
  endpoints. Both responses return the full session summary and whether the
  result was reused; do not make the client infer emptiness from a title.
- Keep project ownership in the session store so project sessions stay excluded
  from the normal Web query and retain their project execution workspace.

### Sidebar and active-pane model

- Replace the single `expandedChannel` and its single item array with a
  persisted tree state plus per-node loading/cache records. Expansion is wholly
  independent from selection.
- Merge the project list into `ChatSidebar`; remove the `mainView` switch,
  `ProjectsView`, and the Projects navigation shortcut.
- Treat the active target as a discriminated source (Web, project, or
  read-only external channel). Reuse the chat shell, transcript and composer
  primitives; source-specific data loading and runtime context stay behind the
  existing Web/project adapters rather than leaking project logic into channel
  adapters.
- The active header derives from the selected target as
  `source name / session title`. Unselected state has no synthetic session.

### Lifecycle and recovery

- New-conversation actions await the idempotent persistence result before
  changing selection or list state. They then expand only the parent required
  to reveal the newly selected session.
- Successful sends refresh only the owning node to maintain newest-first order.
- A deleted active session selects the next item from its own loaded node; if
  none exists it clears selection without creating a replacement.
- Failed loads/creates retain the existing active target, show a scoped,
  retryable error, and never insert an optimistic phantom row.

## Expected implementation surface

- Desktop: `App.svelte`, `ChatView.svelte`, `ChatSidebar.svelte`, the existing
  channel accordion/session-row components, project list/store/chat adapters,
  and desktop i18n/tests.
- Service: session-store scope helpers, Web and project session routes, their
  API client contracts, and tests using temporary session/project storage.
- Documentation after implementation: `features.md`, `prd.md`,
  `CHANGELOG.md`, and `README.md` as required by the repository instructions.

## Errors encountered

| Error | Resolution |
| --- | --- |
| Search included absent `packages/` directory | Restrict subsequent searches to verified workspace roots. |
| zsh expanded bracketed Svelte route path as a glob | Quote literal route paths in subsequent reads. |

## Planning status

Implementation started after user approval. Phases 2 and 3 proceed together:
the persisted draft contract must exist before the unified sidebar can select it.

## Delivery result

All planned phases are complete. The Desktop sidebar and project pane passed
`svelte-check`, the Desktop UI/HTTP/Rust suite, and server/client Session tests.

---

# Project session file provenance and change visibility analysis (2026-07-11)

## Goal

Define the smallest shared design that lets a user inspect, from a Project
conversation, (1) files intentionally attached to that turn, (2) files created
or changed by tools during that turn, and (3) the resulting project tree and
Git diff. This is analysis only; no product code is changed in this phase.

## Phases

1. Map current attachment, tool-event, project-session, and Git integration paths — complete.
2. Identify the gaps against turn-scoped provenance and project change visibility — complete.
3. Propose the shared module/interface, data model, UI surfaces, migration, and verification plan — complete.

## Decision constraints

- Project roots remain the user's files. Never write Molibot metadata into them.
- Scratch artifacts remain outside the project root and must retain session/run provenance.
- Project tree and Git state are views of the real filesystem; do not cache them as the source of truth.
- Cross-channel/runtime orchestration remains shared; Project UI only renders shared facts.

## Proposed design

- Add one shared `TurnFileProvenance` module. It records emitted artifacts for
  every session/run and, for Project runs, compares a pre/post project manifest
  to record observed created/modified/deleted paths. It stores durable facts by
  `runId` and `sessionId` outside the project root.
- Add a read-only `ProjectInspection` module. It lazily lists a bounded project
  tree and returns Git status/diff scoped to the registered project root. It
  never shells through the Agent and never exposes parent-repository paths.
- Present two deliberately distinct views: `This turn` (run-scoped artifacts
  and observed changes) and `Project changes` (live tree/Git working state).
  This avoids falsely claiming that every current Git change was made by the
  Agent.

## Review-ready specification

The complete review specification is now
`docs/requirements/project-session-provenance-and-inspection.md`. It covers
storage, privacy, concurrency, Git/non-Git behavior, lifecycle, UI, delivery
slices, and verification. `prd.md` records the feature as planned P1.

---

# Automation workspace density refresh (2026-07-10)

## Goal

Make the desktop Automation workspace compact and scan-friendly: a selected
sidebar shortcut must be visible, task rows must remain dense, and selecting a
row must reveal its execution details in a dedicated right-hand pane.

## Implementation phases

1. **Map existing workspace, task actions, and style primitives** — complete
2. **Build the compact two-pane Automation workspace** — complete
3. **Wire sidebar active state and preserve task actions** — complete
4. **Verify localized, themed, responsive behavior and document** — complete

## Verification gates

- Automation and Skills show a visible selected state in the chat sidebar.
- Automation rows show title, schedule, state, and next/last run without
  expanding into cards; selecting a row opens its full detail and run history.
- Existing create, edit, run, and delete behavior remains available.
- Light/dark, Chinese/English, keyboard focus, and narrow-window layouts remain usable.

## Delivery result

The Automation workspace now uses the requested dense list/detail structure.
`svelte-check` and all Desktop chat UI checks pass; the existing local preview
confirmed both sidebar active states and reported no console errors. Its service
was not connected, so live task rows could not be populated during that preview.

---

# Automation interaction and scheduling controls (2026-07-10)

## Goal

Keep Automations list-first by default, reveal a closable detail pane only for
the selected task, show per-task execution activity without globally blocking
the workspace, prevent automation runs from leaking into ordinary sessions,
and support pausing individual periodic tasks.

## Implementation phases

1. **Reproduce the automation-session leak and map task execution state** — complete
2. **Add persisted task enabled/paused state and scheduler guard** — complete
3. **Refine list-first workspace interactions and per-task execution UI** — complete
4. **Verify focused regressions, UI behavior, and documentation** — complete

## Verification gates

- A fresh periodic automation run never appears in normal Web/Channel session navigation.
- Triggering task A leaves task B runnable and selectable while A alone shows running state.
- Paused tasks do not dispatch through the watcher and can be resumed without recreation.
- The default workspace shows only search, compact summary, and list; detail opens and closes predictably.

## Delivery result

All requested interaction fixes are complete. Focused server/session tests,
Desktop Svelte diagnostics, Desktop UI regression tests, production build, and
the scoped `git diff --check` passed. The worktree has one pre-existing,
unrelated trailing-blank-line warning in `webSearchTool.test.ts`; it was left
untouched. Production build keeps only its existing dynamic-import advisories.
