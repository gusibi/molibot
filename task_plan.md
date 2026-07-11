# Unified conversation and project sidebar plan

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
