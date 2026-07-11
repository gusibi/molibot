# Findings

## Configurable reflection schedule and completion notice (2026-07-11)

- Work started at the scheduler/settings/runtime boundary. The implementation
  must keep model controls, human notifications, and persisted debug state as
  three separate planes.
- `applySettingsPatch` already restarts `TaskScheduler`, so a granular Plugins
  save can update managed reflection JSON immediately without a new lifecycle.
- Internal events carry an artificial chat id; notification routing must use an
  explicit destination. The managed event now selects the first allowed chat to
  avoid broadcasting candidate counts to every configured conversation.


## Memory remaining delivery (2026-07-11)

- A stable path is the identity seam: once records are fetched by exact path,
  changed wording must obey update policy even when lexical similarity is zero.
- Reflection can share the existing watched-event lease/retry machinery only if
  dispatch checks `execution: internal` before any Channel trigger. The model
  prompt is an ephemeral provider input and never a ConversationMessage write.
- External-channel transcripts now live in Agent context JSONL rather than the
  legacy SessionStore; ReflectionSourceReader therefore needs a read-only
  projection over both stores to satisfy cross-channel reflection.
- Candidate confirmation needs three defenses together: compare-and-set reserve,
  edit revalidation including namespace/domain consistency, and stable mory
  ingest so a crash/retry cannot duplicate the final version chain.
- Embedding configuration belongs to the existing custom Provider seam. Missing
  credentials or request failures must not block writes or lexical retrieval.

## Memory batch 1 kickoff (2026-07-11)

- C0 is implementation-ready: all identity, schema, write-state, reflection,
  and Summary boundaries have explicit decisions in v2.2.
- Batch 1 will not flip memory defaults; that remains coupled to T3+T5 so an
  Inbox exists before automatic extraction becomes the default.
- T2 and T6a must share one schema migration because stable paths are only safe
  when version chains are isolated by namespace and carry domain metadata.
- Current mory already versions by `userId + path`; the host defeats it by
  generating a timestamped path for every write and encoding only
  `channel::externalUserId` as userId.
- `domain` is absent from both SDK rows and host metadata. The migration must be
  additive and idempotent for existing SQLite files; merely changing CREATE
  TABLE is insufficient because `CREATE TABLE IF NOT EXISTS` does not add a
  column to an existing database.
- SQLite migration order matters: creating the domain index before ALTER fails
  on a legacy table. The verified order is schema bootstrap, PRAGMA inspection,
  additive ALTER when absent, then idempotent index creation.
- Canonical subjects need a dedicated normalizer. Reusing the content slugger
  changed `answer_length` into `answer-length`, which would fork version chains;
  subject normalization now preserves `_`, `.`, and `-`.
- The runtime already has a stable bot identity at the runner/tool seam and the
  active Project id in `MomContext`; passing one `MemoryScope` through that seam
  keeps namespace policy out of Channel adapters.
- Global search and compaction must enumerate indexed namespace keys directly.
  Reconstructing only `chatNamespace(scope)` silently omits owner/project/agent
  rows even when the scope index knows they exist.


## Project Session implementation kickoff (2026-07-11)

- The approved order is Slice A, B, C, D; runtime automatic cleanup is deferred.
- The working tree already contains unrelated/uncommitted memory and automation
  changes. Project Session edits must avoid overwriting or reformatting them.
- The earlier provenance proposal in this file is superseded by the final
  requirement: no turn ledger or manifest; Files/Changes are live Project-global
  views, while attachments remain Session-scoped.
- Project runs expose `ctx.project` in the shared runner. Its `rootPath` is the
  tool cwd and its `scratchDir` is inside the Project runtime, so output routing
  can be explicit without putting Project logic into a Channel adapter.
- Ordinary Bot artifact relocation remains enabled; Project runs now disable it
  and use an absolute runtime scratch date directory plus sibling `tool-output`.
- Image/video/TTS tools already share `artifactDir`; making that directory
  absolute for Project runs routes their default output into runtime scratch.
  Their remaining Slice B work is structured path-detail normalization.
- ProjectInspection now has a direct fixed-argv Git seam with config/pager
  isolation and process-group timeout/output caps. It never calls Agent Bash.
- The old Desktop file pane always called `/api/web/files` against the ordinary
  Web runtime, even while Project Chat was active. Project attachments now use
  the same endpoint with a server-verified `projectId + sessionId` association
  and resolve bytes only from that Project runtime.
- The Project panel is intentionally read-only and separates Project-global
  Files/Changes from Session-local Attachments in its labels and data loaders.
- Adversarial review found and fixed a parent-repository disclosure: porcelain
  paths from a Project nested in a larger repository are now stripped back to
  Project-relative paths; a rename source outside the Project is represented by
  a boolean marker without returning its parent path.
- Tree pagination uses an opaque directory/file sort cursor and the Desktop can
  load subsequent pages. Git status and diff now preserve bounded partial output
  with an explicit truncation flag instead of turning size limits into generic
  failures or silently dropping content.
- Binary and oversized files never render raw bytes. Empty repositories,
  deleted large files, spaces in names, non-Git directories, and malicious
  fsmonitor config all have focused coverage.


## Product-design interview (2026-07-10)

The user approved all decisions recorded in `task_plan.md`, including the
three-level tree, multi-expand behavior, persisted expansion state, draft reuse
rules, and contextual header format.

## Current desktop structure

- `apps/desktop/src/App.svelte` owns a `mainView: "chat" | "projects"` switch
  and renders `ProjectsView` independently. This must be removed as part of
  unification.
- `apps/desktop/src/lib/chat/ChatSidebar.svelte` currently renders top-level
  new-chat, projects, automation, and skills actions, followed by channel
  accordions. It supports exactly one expanded channel via `expandedChannel`.
- `apps/desktop/src/lib/projects/ProjectList.svelte` already reuses the shared
  session-row component for project sessions, but has a separate selection
  store and a dedicated view.
- `apps/desktop/src/lib/stores/projects.svelte.ts` automatically selects a
  project and creates a session when a project has none. Both behaviors conflict
  with the agreed navigation-only project toggle and must be changed.
- The project store also currently recreates an empty project session after
  deletion of the final active session; the agreed rule is to show an
  unselected empty state instead.
- The normal web API already offers a create-session endpoint returning a
  `New Session` summary, so the sidebar bug is likely client-side draft/list
  synchronization rather than a missing server capability.
- `ChatView.svelte` confirms the cause: `newConversation()` calls
  `chatStore.newConversationDraft(...)` rather than the create-session API.
  Its current channel state holds one expanded channel and one corresponding
  item list, so it cannot represent several independently expanded nodes.
- `ChatSessionStore.newConversationDraft()` is an in-memory draft operation.
  The implementation must replace it with a persisted-and-reused Web draft
  flow before changing the selected state.
- One search command included a non-existent `packages` path. No source was
  changed; subsequent searches will target existing roots only.
- A direct shell read of a bracketed Svelte route path failed because zsh
  treated brackets as glob syntax; all later route reads will quote these paths.

## Server and lifecycle detail

- Project session GET currently returns only id/title/time/origin and POST
  always creates a new session. It needs a server-owned idempotent
  create-or-reuse operation; the client cannot safely decide whether a session
  is empty from the current summary.
- Web session POST likewise always creates; its desktop client is only reached
  when the user sends the first message because `ChatSessionStore` maintains an
  unsaved draft.
- The shared desktop conversation query already filters project sessions out of
  ordinary Web conversations, exactly matching the required non-duplication
  rule.
- Project execution ownership is derived from session storage via
  `getConversationProjectId`, so keeping project sessions in the project store
  preserves the Agent's working directory context.

## Design constraints

- `DESIGN.md` identifies Geist and theme tokens; desktop UI changes need use
  existing shared UI/component patterns, support both themes, Chinese/English,
  keyboard focus, and mobile widths.
- Project rules require shared cross-channel logic to stay above channel
  adapters; only message transport and conversions belong in channels.

## Automation workspace refresh (2026-07-10)

- The chat Automation workspace currently embeds `TasksSection.svelte`, which
  was designed as a detailed settings surface: summary deck plus large cards
  and inline execution history. That is the source of the low list density.
- `ChatWorkspacePane.svelte` owns the workspace header and can replace only
  the Automation content without changing the separate Settings task surface.
- `ChatSidebar.svelte` does not receive the active workspace pane, so its
  Automation and Skills shortcut buttons cannot currently reflect selection.
- The existing desktop token set already supplies neutral surfaces, borders,
  focus treatment, and both themes. The new workspace should use those shared
  values and existing shadcn controls rather than introduce page-local styles.
- `TasksSection.svelte` is already in Svelte runes mode, so its new display
  variant must be received through `$props()` rather than legacy `export let`.

## Automation interaction and scheduling controls (2026-07-10)

- The workspace currently selects the first task through a derived fallback,
  which makes the detail pane open by default instead of behaving as an
  explicit selection.
- A single `tasksStore.busy` string gates every task action and every task-row
  control. This explains why pressing one task's Run button freezes all other
  tasks in the UI.
- Periodic task JSON has no persisted enabled flag and the scheduler has no
  paused-task guard, so pause/resume requires a small shared event contract
  extension rather than a UI-only switch.
- Fresh automation sessions are supposed to be classified from `origin` or a
  `task-` id in the shared desktop conversation query. The user screenshot
  shows an `[EVENT:...]` Web session leaking despite that invariant, so the
  execution/session creation path must be reproduced before changing filters.

## Automation interaction and scheduling controls — resolution (2026-07-10)

- The leaking `[EVENT:...]` rows came from the shared direct-event projection:
  it created a normal Web conversation without forwarding the `automation`
  origin. Persisting that origin at conversation creation lets the existing
  shared filter hide every automation session, regardless of its id format.
- A task's `enabled: false` value now remains in its watched event JSON. The
  watcher cancels any existing schedule and skips dispatch for that file;
  the task API rejects manual triggers while paused as an additional guard.

## Project session file provenance and change visibility (2026-07-11)

- Current assistant attachments are explicit uploads only: the stream/chat routes
  call `saveWebResponseAttachment` when a tool invokes `uploadFile`, then append
  them to the assistant conversation message.
- Tool activity persists labels and summaries, but no structured changed-path or
  Git-diff facts. A project-session replay therefore cannot reconstruct which
  project files a turn created, edited, deleted, or renamed.
- Project runs use the external project root as tool cwd while their runtime
  context lives under `projects/<projectId>/runtime`; this provides the correct
  seam for storing provenance outside the user project root.
- `/api/web/files` is an attachment browser, not a project-file browser: it
  resolves only ordinary Web conversations and only attachment copies stored
  inside that conversation workspace. It cannot list project-root files, nor
  project-session attachments.
- The Desktop Project header opens the same `filePanelOpen` state as normal
  chat, but the backing file query is still scoped to the active ordinary Web
  profile/session. Project files therefore have no working backing adapter.
- No server module exposes a project tree, filesystem snapshot/diff, Git
  status, or Git diff. `git` currently exists only as an agent bash command,
  whose textual output is reduced to an activity summary.
- `RunnerUiEvent.tool_execution_end` carries only a display summary and error
  state. Tool results discard structured changed paths, so even a successful
  write/edit/bash call cannot be attributed to a user turn after replay.
- Generated output is only visible when a tool explicitly calls `uploadFile`.
  That path copies bytes into the runtime attachment directory and attaches the
  copy to an assistant message; it loses the source project's relative path and
  does not cover ordinary write/edit/bash changes.
- The existing `runId`, run-detail archive, and SQLite trace facts already give
  each execution a stable identity, but neither the conversation messages nor
  the archived run details expose a turn-to-file record. They are the natural
  integration points; a second parallel session store is unnecessary.
- Recommended design: retain `runId` as the provenance key; add a shared
  turn-file ledger for every channel/session plus a Project-only read-only
  inspection module for the live file tree and scoped Git view. The UI must
  label filesystem results as "observed during this turn", because a user or
  external process can change files concurrently.
- The review-ready contract is recorded in
  `docs/requirements/project-session-provenance-and-inspection.md`; it rejects
  unbounded snapshots, generic filesystem browsing, and false Agent-authorship
  claims while preserving durable session/run provenance.
- The frontend now separates page-level destructive busy state from per-task
  running and update sets. This keeps concurrent task controls responsive and
  provides a stable local spinner for the task whose request is pending.
# Daily materials internal task (2026-07-11)

- `SessionReflectionSourceReader` previously hard-coded `reflectionTargetId`, so
  sharing it would have coupled daily-material and reflection watermarks. It now
  accepts a target-id strategy with the reflection hash as the compatible default.
- The manual task trigger API directly invoked `manager.triggerTask` in both
  periodic and non-periodic branches. Internal events now go through the same
  `dispatchTaskEvent` boundary as scheduled runs.
- Project options are injected into the Desktop summary by the route; tests do
  not enumerate or mutate the real Project store.
- `momo-assets/` and `docs/asset-catalog.md` already agree on all documented
  reference, avatar, pose, scene, and template paths; no catalog rewrite needed.
- Adversarial path review found lexical containment alone allowed an existing
  in-project symlink to point outside the Project. The service now checks the
  deepest existing ancestor with `realpath`, covered by regression.
- The real run exposed outer Markdown fences and missing per-message IDs. The
  service now strips only a whole-output fence, includes message IDs, and the
  Project prompt embeds the exact daily-material skeleton.

---

# Memory review bug-fix findings (2026-07-11)

- `MemoryReflectionService.run()` currently derives the reader date directly
  from `now`; at the 03:00 schedule this selects the incomplete current day.
- Candidate validation exceptions escape the extracted-item loop, so a single
  malformed LLM item aborts its projection and prevents watermark advancement.
- `MemoryGateway.embeddingConfigKey` records only configured/missing state, so
  a provider API-key rotation is invisible to backend reconfiguration.
- `MoryMemoryBackend` retries its configured embedder on every add/search after
  failures; lexical fallback exists but has no temporary failure state.
- `compact()` builds ID arrays and repeatedly calls `includes()` while scanning
  records, yielding quadratic membership work at large record counts.

---
