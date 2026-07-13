# Bot Project mode (2026-07-12)

## Owner memory notification target (2026-07-14)

- Current Owner events intentionally have no fixed `internal.target`; runtime expands live settings into per-Bot scan targets at trigger time.
- Existing completion delivery selects the first authorized chat independently for every Bot and stays silent on zero output or failure.
- The smallest stable seam is one persisted Feishu/Telegram destination on the memory plugin, validated against enabled instances and `allowedChatIds`, with aggregate delivery after the Owner loop finishes.
- Human notification must remain separate from reflection prompts, Session transcript persistence, and structured execution history.

---

- `MomContext.project` already owns Project cwd, instructions, Skills, output
  layout, and tool guards; Channels only lack binding resolution and injection.
- `SharedRuntimeCommandService` and `BaseChannelRuntime` cover Feishu, Telegram,
  QQ, and Weixin, so no Project orchestration belongs in Channel adapters.
- Preserving the current channel session keeps queue/session/approval identity
  stable while changing execution mode for subsequent turns.

---

# Project-local Skill discovery fix (2026-07-12)

- The approved requirement already fixes the directory contract at
  `<projectRoot>/.agents/skills/` and precedence at project > bot > global > chat.
- The current `SkillScope`, Desktop scope projection, and loader roots only know
  global/bot/chat; the missing suggestion is therefore a runtime discovery gap,
  not just a Desktop filtering bug.
- The Project root must be resolved from server-owned `projectId`; Desktop must
  not receive or scan the absolute root path.

---

# Composer suggestions and Project defaults (2026-07-12)

- `ChatInputArea` and `ChatComposerShell` are already shared by ordinary Chat
  and Project Chat, so the suggestion interaction belongs at this seam.
- `ConversationTranscript` is likewise shared; presentation classification can
  be implemented once without Project-specific rendering.
- Web command discovery is currently embedded in `tryHandleWebCommand`, while
  channel runtime commands live in `SharedRuntimeCommandService`; UI must not
  introduce a third handwritten command inventory.
- `ProjectRecord` already persists instructions and reserves sandbox/approval
  profile fields, but has no model/thinking overrides.
- Project Chat currently loads and changes the global model route. Project
  defaults require a separate resolution path so local selection cannot mutate
  unrelated Chats or Projects.

---

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
# Agent workspace kickoff (2026-07-12)

- The supplied plan assumes a separate Tauri workbench window, but the user's
  current requirement supersedes that: this belongs in the main sidebar below
  Skills and should reuse the existing workspace switching seam.
- `DesktopAgentItem` already exposes the safe display fields needed for the
  first slice. Filtering `id === "default"` belongs in shared Desktop view
  logic so UI rendering and counts cannot drift.
- The current worktree contains substantial unrelated user changes. All edits
  must be surgical and avoid formatting or replacing nearby work.
# Trace active-run control (2026-07-12)

- Existing Trace pages report persisted facts but cannot prove a Runner is
  still alive. `started` facts can survive crashes and must be joined with a
  live RunnerPool snapshot before offering Stop.
- `BaseChannelRuntime.abortTaskRun(scopeId)` resolves the current active session,
  which is unsafe for a historical Trace row. Trace controls need an exact
  `chatId + sessionId` abort seam.
- Orphan cleanup should upsert the existing run fact as aborted rather than
  deleting it, preserving the audit trail while removing false active state.
# GitHub bug repair #1-#6 (2026-07-13)

- GitHub currently has six open issues labeled `bug` (#1-#6); #7-#9 are a
  behavior proposal, enhancement bundle, and new search-provider request.
- The worktree is already dirty and overlaps #2 and #5: per-turn Session
  ownership, Project reload isolation, terminal activity snapshots, and stream
  failure persistence are partially implemented and require verification.
- `prd.md` already claims one-empty-Session-per-scope and Project large-media
  preview are done, so #1 and #3 are regressions or incomplete acceptance paths,
  not greenfield features.
- Branch `master` is two commits ahead of `origin/master`; no history rewrite or
  unrelated cleanup is in scope.
- #3 already has a shared server invariant in `SessionStore`: Web and Project
  creation return the newest empty conversation with `reused: true`. Its tests
  use temporary storage paths. Desktop calls the idempotent API directly.
- #1's current source includes the Project inspection route, raw-media response,
  wildcard Tauri HTTP permission, and a raw URL builder. The open report may
  describe a released-build mismatch or a previously fixed path; route-level
  and packaged-capability checks are still required before closure.
- #6's two files are not byte-for-byte equivalent stores: `users/.../sessions`
  is the canonical Web UI conversation (titles, attachments, activity timeline),
  while `bots/.../contexts` is the Agent/model context log (tool/model entries,
  compaction and retry semantics). Ordinary Web runs currently append to both.
  Removing either without a projection/migration contract would lose behavior.
- #4 sidebar callbacks are direct, but the workspace is hosted inside a large
  legacy-mode `ChatView`; an actual first-click DOM feedback loop is needed to
  distinguish event wiring from first-load/service-ready state.
- #4 matches the macOS inactive-window click-through contract exactly. Tauri's
  `acceptFirstMouse` window option makes a click on an inactive window reach the
  WebView, but the official config reference says it requires the
  `macOSPrivateApi` feature/config. The current app sets `macOSPrivateApi:false`
  and has no `acceptFirstMouse` on either window.
- `acceptFirstMouse` remains only a hypothesis: enabling the config requires a
  matching Cargo private-API feature and does not prove whether the reported
  first click was swallowed or whether the destination page failed to load.
  The experimental config/test were reverted pending a UI-level discriminator.
- Project inspection's focused filesystem suite passes 8/8, including bounded
  tree reads, large/binary states, Git isolation, and symlink escape rejection.
  A route-level raw-response test is still missing.
- During diagnosis, the worktree changed further outside this task's own edits:
  a new untracked `projectChatStore.svelte.ts` and matching ProjectChat/ChatView
  edits appeared. They migrate Project Chat from one mutable controller to the
  existing per-session registry, which is a stronger #2 boundary than the
  earlier `turnSessionId` UI gate. Treat these as user/concurrent work: preserve,
  review, and verify without reverting or silently rewriting them.
- #4 request-path audit found no shared one-shot failure latch: Skills clears
  its endpoint on failure, Agent polls every 2.5 seconds, and Automations reacts
  to shared service readiness. This weakens (but does not disprove) the theory
  that all three fail because their HTTP request never retries.

---
## Confirmed findings

- #4 is not click-through: CDP instrumentation showed the first click changed the active nav item and workspace pane and emitted API requests. Failed requests were rendered forever as Loading, while `connectedEndpoint` was latched before bootstrap success and blocked same-endpoint retry.
- #4 recovery now gates workspace children on a successful bootstrap, retries on repeated navigation/retry action, and renders localized actionable errors. Browser fault injection passed with backend available, unavailable, and restored.
- #1's raw Project file route exists and returns bytes/MIME; a route-level temp-store test now prevents an HTML 404 regression.
- #2 is owned by per-session runtime registries in both main Chat and Project Chat. Project registry dependencies resolve through the latest mounted host to avoid stale cross-project/model closures.
- #3's shared Session Store reuses one empty conversation per Web Profile or Project; the temp-store regression passes.
- #5 now terminalizes persisted running activities and preserves partial stream output on failure; server and client regressions pass.
- #6 contains two semantically different stores: Agent context owns tool/model/compaction/retry history; UI Session owns title/attachments/activity presentation. Removing either without a migration loses required data, so this remains a product architecture decision rather than a surgical bug deletion.

## Skills first-load card reactivity

- CDP reproduced the screenshot exactly against the real Desktop/API path: `{total:26,cards:0,empty:"No matching skills"}` with an empty search box.
- The summary reads `skillsStore.skills.counts` directly and updated correctly; `filteredSkills` was a legacy `$:` reading an imported `$state` store and remained at its initial empty value.
- Converting the component to `$props`/`$state`/`$effect`/`$derived` produced `{total:26,cards:26}`; entering the first exact Skill name produced one card.

---
# Owner-level memory automations (2026-07-13)

- Current scheduler creation is nested under channel and Bot directory loops,
  producing one reflection and one daily-materials JSON per runnable Bot.
- Cross-session behavior exists only inside a target: the reader enumerates all
  conversations for that target's source scopes, while the target identity
  still contains one `botId`.
- The local runtime currently has 18 active 03:00 reflection files and 18
  paused 23:30 daily-material files, confirming physical task fan-out rather
  than a Desktop rendering duplicate.
- Managed events have empty `text`, and Desktop uses `text` as their title;
  system metadata must provide a stable localized display identity.
- Daily-material disable preserves every per-Bot JSON as paused; reflection
  disable returns early and can leave an existing managed event enabled.
- A true owner event cannot be hosted inside an arbitrary Bot directory: Bot
  deletion would remove its scheduler/watch boundary. It needs a shared owner
  watched-events directory and a watcher that does not depend on one channel
  manager.
- Daily materials still processes each target with its existing independent
  watermark and may append supplements to the same dated output. Consolidating
  its content-generation algorithm is separate from removing duplicate
  scheduler entries and is intentionally outside this task.
- System/user task classification needs explicit persisted metadata. File-name
  inference would misclassify migrated or manually copied events and would not
  give the UI a localized display name.
- Hosting the owner event under `system/bots/owner/events` lets the existing
  watcher, lease, task-list, and manual-trigger machinery keep one storage
  contract without pretending the task belongs to a delivery channel.
- System task edits/deletes cannot be durable because scheduler reconciliation
  owns their payload. The UI exposes inspection and manual Run only; plugin
  settings remain the source of truth for enablement and schedules.
- Adversarial review found migration originally sat after the no-manager early
  exit. It now runs first, so disabled or temporarily unavailable channels do
  not retain stale managed task rows.

---
# Issue #6 UI Session storage

- `users/<scope>/sessions` contains Web UI presentation data, not a user-domain
  aggregate. The agreed canonical term is **UI Session**, with filesystem root
  `ui-sessions`.
- Web and Desktop expose separate delete entrypoints, and both currently delete
  only the UI Session. `RunnerPool.reset` clears memory but leaves the Agent
  `.json`, `.jsonl`, and `.meta.json` context artifacts on disk.
- External channels are intentionally context-only and do not write this UI
  Session layout, so the rename/migration must remain Web-specific.
- Agent Store's ordinary `deleteSession` rejects deletion of the last context;
  UI lifecycle deletion needs a distinct idempotent artifact-removal operation
  that may remove the last UI-linked context and clear its active pointer.
