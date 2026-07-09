# Molibot ChangeLog

## 2026-07-10

### Desktop settings synchronization and unsaved model pulling
- **Multi-window dynamic sync**: Integrated BroadcastChannel to broadcast settings changes from the Settings window to the main Chat window, avoiding app restarts when adding custom providers or updating model settings.
- **Pull models before saving**: Updated the `/api/desktop/provider-models` endpoint and UI disabled properties to support pulling model lists using transient form inputs (baseUrl and apiKey) before a provider is saved.

### Agent harness: prompt-cache stability, compaction accuracy, tool-call fidelity, turn heartbeat lease
- The per-turn working-memory snapshot moved out of the system prompt into a `<current-memory>` block inside the user-message envelope (model message only, never persisted). The system prompt no longer changes with each turn's memory/query, so provider prefix caching now covers the full prompt plus history across turns instead of being invalidated every message.
- Context-compaction triggering now prefers the exact token usage reported by the provider on the latest assistant response over the char-based estimate, with a compaction-summary timestamp barrier so pre-compaction usage cannot re-trigger compaction in a loop. The char estimator itself now weights CJK characters at ~1 token each instead of chars/4, which had under-counted Chinese conversations by 3-4x and effectively disabled threshold compaction.
- Fixed the ToolRuntime wrapper dropping per-call identity and progress: registry handlers now receive the real `toolCallId` (previously replaced by the shared `runId`, colliding across parallel calls) and the `onUpdate` streaming callback (previously discarded, silencing tool progress updates).
- Session turn locks are now heartbeat leases: running turns refresh `runs.last_heartbeat` every 30s, lock conflict/cleanup checks follow the heartbeat (2-minute timeout) instead of a fixed 10-minute wall clock, so legitimate long runs keep their lock for as long as the process lives while crashed runs free the session within ~2 minutes. Legacy rows without heartbeats keep the old 10-minute rule.
- Verified with the full agent test suite (378 passing; the one failure is a pre-existing skills text-locale assertion unrelated to these changes) and a clean `tsc` on all touched files.

### Agent harness follow-ups: Chinese injection patterns, DB hot path, mechanical videoGenerate guard
- The prompt-injection scanner for project context files now also matches common Chinese injection phrasings (ignore-previous-instructions, override-system-prompt, hide-from-user), mirroring the existing English patterns; ordinary Chinese project docs are covered by a regression test to avoid false positives.
- TurnOrchestrator now opens one SQLite connection per orchestrator with schema DDL ensured once at open, instead of an open/CREATE TABLE/close cycle inside every turn operation (prepareTurn, heartbeat, status updates).
- The "do not call videoGenerate again in the same turn" rule moved from prompt prose to a mechanical gate: after a successful video submission in a run, further submissions are blocked at beforeToolCall with a reason pointing at the existing taskId, while progress checks (calls carrying a taskId) stay allowed. The prompt sentence now just notes the runtime enforcement.

## 2026-07-09

### Desktop Chat / Project shared input and surface components
- Fixed macOS window dragging gaps in the Desktop app: Chat and Settings now mount a 52px transparent top drag mask that calls Tauri `startDragging()`, Chat/Project sidebar top chrome still exposes a drag strip, and action buttons remain above the mask and clickable.
- Fixed a startup deadlock where Chat could remain on "Connecting to local conversations..." while the service was already online: default-session/sidebar loading now happens in the background after core bootstrap, and the sidebar resize state is released on window blur or mouse-leave so it cannot leave the whole page click-blocked.
- Tightened the shared Chat/Project composer: focus now uses a subtle ring instead of a loud blue outline, vertical padding is reduced, the textarea shows multiple lines by default and auto-grows with content, and the send button is sized to match the nearby microphone control.
- Fixed missing icons for Feishu and QQ in the Desktop Chat sidebar by replacing unsupported icon-font names with bundled glyphs that render reliably.
- Fixed fresh automation task sessions leaking into the normal Desktop Chat Session list. The shared conversation query now classifies `origin:"automation"` and `task-*` Web sessions as automation, so they remain available through Automations history instead of the ordinary sidebar/browser.
- Fixed legacy external-channel automation contexts leaking into the normal Chat Session list. The external `contexts/` projection now also filters `origin:"automation"`, `task-*`, and old `[EVENT:...]` prompt sessions.
- Simplified the Chat header to one line: the avatar now uses the active Bot initial instead of the conversation-title initial, service status moved to the lower-left logo badge, and the redundant header settings button/status subtitle are gone.
- Extracted the complete Desktop chat input area into shared components and wired both Chat and Project Chat through it, so composer banners, queued messages, pending files, recording UI, model/thinking selectors, send/stop, and tool buttons now have one implementation.
- Project Chat now passes the actual model label and thinking-level label into the shared composer instead of showing static "Model / Thinking level" pills, without adding meaningless `@Default Web` or Project-name tokens to the input area.
- Added shared right-pane pieces for approval cards, message panes, headers, and Project sidebar building blocks while keeping business decisions in each caller instead of adding project/channel conditionals inside generic components. Project keeps project-specific navigation, uses a `+` action beside each project name for new sessions, hides local paths from the header, and has compact bottom actions for returning to Chat plus the logo-based settings entry.
- Verified with external-session projection tests, Desktop UI structure tests, Desktop `svelte-check`, and production build.

### Fixed: Project transcript blank on first open until a Chat round-trip
- On first launch, opening Projects and clicking a Session showed nothing on the right; leaving to Chat and back made it work. `ProjectDetail` gated the whole right pane on a legacy `$:` derivation (`project = projects.find(...)`), and in Svelte 5 a legacy `$:` does not subscribe to external rune `$state`, so it only ran once at init while `projectsStore.projects` was still loading and stayed `undefined`. Converted `ProjectDetail` to runes (`$props`/`$state`/`$derived`) so the derivation tracks the store; the pane now renders as soon as projects load. (`svelte-check` 0/0, desktop UI test 24/24.)

### Project conversations run in an isolated project workspace
- Project conversations now execute in a dedicated runtime workspace under `<dataRoot>/projects/<projectId>/runtime` instead of the shared bot workspace. Their agent context/transcript no longer leaks into `moli-*/bots/<bot>/…/contexts/`; a project's runtime, sessions, and scratch all live under its own project directory, isolated from every bot.
- Added `getProjectRuntimeContext`/`resolveRuntimeContext`/`getRuntimeContextForConversation` so send, stream, stop, `/compact`, and Host-Bash approval-resume all route a project conversation to its own store+pool. `SessionStore.getConversationProjectId` resolves the owning project by conversation id.
- Taught the workspace path resolver to recognize the `projects/<id>/runtime` marker (data root, memory root, and global skills dir resolve correctly for project runtimes), with a specific pattern so a stray `projects` ancestor segment can't hijack resolution. Note: conversations started before this change keep their old bot-dir context; displayed history (from the project session store) is unaffected.

### profileFiles can write the global/agent profile scope
- The `profileFiles` tool gained a `scope` parameter (`bot` default, `global`, `agent`). Global writes target the workspace-root profile shared by every bot/agent, so long-term identity/voice/user facts can finally be saved without the bash bypass that the global-write guard (correctly) blocks. `BOT.md` maps to `AGENTS.md` at global/agent scope; agent scope is limited to AGENTS/SOUL/IDENTITY/SONG and errors when no agent is bound. Updated the tool description and the global `TOOLS.md` guidance to steer long-term profile edits to `scope:"global"`.

### Desktop Projects creation and Session alignment
- Reworked Add Project into a name-first, two-step dialog with two explicit choices: create a unique managed directory under Documents/Molibot Projects, or select an existing folder through the native picker. The native picker is now invoked only by the existing-folder choice.
- Replaced Project's separate Session-row implementation with Chat's shared `ConversationRow`, including the same avatar, active state, timestamp, rename, and delete-confirm menu.
- Fixed the first-open/rapid-switch transcript failure by giving Project-list and transcript requests selection generations plus Project/Session ownership checks. Stale Project responses can no longer replace the active Session, and remounting Projects reloads the selected transcript with a visible loading state.

## 2026-07-08

### Desktop composer button & selector cleanup
- Swapped the composer send shortcut to avoid accidental sends: a bare Enter now inserts a newline and Shift+Enter sends (queues a follow-up while running); placeholder hints updated in both locales.
- The model pill now shows only the bare model name (last `/`-segment), with the full provider-qualified label kept in the dropdown and as the pill's hover tooltip.
- Dropped the composer's files-panel toggle button (the top-right header already opens the same file list), leaving the paperclip as the only left-side tool.
- Moved the microphone/record button to the right, immediately left of the send button.
- Unified send and stop into one blue action button — no more red stop; the two states are distinguished by icon only (paper-plane to send, square to stop), and the disliked up-arrow send glyph was replaced with a paper-plane.
- Model and thinking-level pills now display the *current selection* (e.g. the actual model name, or "高") instead of the static "模型" / "思考档位" labels.

### Desktop composer Bot picker as inline `@mention`
- Replaced the bulky "Bot" bar that sat above the composer textarea with a compact `@mention` token rendered *inside* the composer box, so the Bot selector now reads as part of the input rather than a separate strip.
- With a single Bot the token renders as a static, non-interactive `@<Bot>` label (nothing to pick); with multiple Bots a draft conversation shows `@<default Bot>` preselected and opens an upward avatar+name dropdown to switch. Once the first message is sent the token locks to a quiet `@<Bot>` with a lock affordance.
- Removed the now-dead `BotSelector.svelte`; added `BotMention.svelte` (runes, outside-click/Escape dismissal). Lightly refined the empty-conversation greeting (larger icon, tighter heading, fade-in). `svelte-check` 0/0.

### Desktop chat sidebar list polish
- Refined the chat sidebar conversation list to match the Geist reference: channel headers now read as quiet section labels, conversation rows use the `--fill`/`--accent-soft` token states with accent-highlighted active titles, and the busy per-section borders were dropped for a cleaner grouped look.
- Moved the sidebar nav up by reducing the oversized top padding (48→30px) so the list no longer sits below a large gap beneath the window controls.
- Added a per-conversation row menu (⋯) on Web sessions with Rename (inline edit) and Delete (confirm) actions, backed by new `PATCH`/`DELETE` desktop conversation endpoints. External-channel rows stay read-only and never show the menu.
- Made the channel groups (Web/Telegram/飞书/QQ/微信) independently collapsible — clicking the open group now closes it, so all groups can be collapsed at once instead of one always staying open.
- Compacted each conversation row to a single line: the status dot moved onto the avatar as a corner badge (no longer competing with the title), the title fills the middle, and the timestamp sits far right and swaps to the ⋯ menu only on hover.
- Sidebar timestamps now show the clock only for today's conversations; older rows show a bare date (no hour/minute). Transcript message timestamps are unchanged.
- Fixed Delete doing nothing: it relied on the native `window.confirm`, which is unreliable in the Tauri webview. Deletion now uses an inline two-step confirm inside the row menu.

### Clean-machine first-launch fixes
- Added a built-in `default` Agent and linked the default Web profile to it during settings bootstrap/sanitization, so a fresh data directory starts with a usable global Agent association.
- Expanded Desktop onboarding with a personalization step that asks the user's preferred name and AI response style, then writes a managed section into the selected Agent's `USER.md` / `SOUL.md` without replacing existing content.
- Fixed first-run model/provider freshness by refreshing Desktop model state immediately after onboarding provider creation and after provider settings mutations.
- Backfilled DuckDuckGo as the default no-key search engine and repaired legacy webSearch settings that were missing engine defaults.
- Exposed Web profiles as Desktop automation targets and registered a shared Web channel runtime so reminders/tasks created from Web can execute through watched event JSON.
- Added Tauri drag regions to Desktop title/header areas while keeping settings/search/action controls clickable.

### Desktop release versioning and Intel builds
- Synced the macOS App version from `apps/desktop/package.json` into Tauri config and the Rust crate so packaged Apps no longer stay at `0.1.0`.
- Extended the Desktop GitHub release workflow to build both Apple Silicon (`aarch64`) and Intel (`x86_64`) DMGs, each with the matching bundled Node sidecar.
- Final release artifacts are normalized to `Molibot_<version>_<arch>.dmg` with matching `.sha256` files, so downloaded DMGs carry both version and architecture in the filename.

### Desktop chat sidebar rewire + multi-session concurrency (Slice 3)
- Rewired `ChatView.svelte` onto the Slice 2 per-session registry through a new `lib/chat/chatSessionStore.svelte.ts` (runes). The old single `ConversationController` that followed whichever session was "active" is gone; each session keeps its own pinned controller, so different sessions now run truly in parallel while the same session stays serial with its own follow-up queue, approval, and abort (plan §7). The store bridges the active entry's live turn state to the legacy `$:` template through a single `state` store — the proven `$conversationView` pattern, generalized to whichever session is currently viewed (memory `desktop-controller-legacy-reactivity`).
- Replaced the old sidebar (horizontal channel switcher + per-Bot two-level tree) with the new `ChatSidebar` / `ChannelAccordion` / `ConversationRow` runes components: five mutually-exclusive channel accordions, a cross-Bot recent list (max 10) per channel, stable Bot avatars, and live status dots (running/waiting/completed/failed) that never cross sessions. Web Profile is shown everywhere as "Bot"; external channels stay read-only (plan §2/§3).
- "New chat" now enters a not-yet-persisted draft instead of creating an empty session on click; the session is only created on the first sent message, bound to the Bot chosen in the `BotSelector` (last-used Bot → default → none). Composer drafts (text/attachments/thinking/Bot) are isolated per session and restored on switch (plan §6/§10).
- Wired the "more conversations" `ConversationBrowserDialog` (per-Bot grouping, debounced search, independent per-group cursor pagination) and reconnect recovery: on service ready and via a 4s poll, `GET /api/desktop/session-runs` is queried and any orphaned server-side run left behind by a crash/disconnect (which holds the session lock and blocks new sends) is aborted via `/api/stream/stop`, so the user can start a new turn. Runs the Desktop is actively driving are left alone (plan §5/§11).
- Fixed the sidebar showing no conversations for existing installs: `listAllWebConversations` now migrates every legacy Web user's sessions into the Web workspace index before reading it (the per-profile `listConversations` already did this lazily), so conversations created before the Web-workspace migration are no longer invisible. The shared query layer also filters to `purpose === "conversation"`, keeping project/automation/test sessions out of the sidebar (plan §7/§16).
- `chat-ui.test.mjs` updated to assert the new sidebar/store design; `svelte-check` 0/0; desktop build clean; 25/25 desktop + 14/14 chat unit + 12/12 server-conversation tests pass.

### Desktop per-session runtime registry (multi-session sidebar, Slice 2)
- Introduces a per-session runtime registry (`lib/chat/sessionRuntimeRegistry.svelte.ts`) that gives each conversation its OWN `ConversationController` PINNED to a fixed `profileId`/`sessionId`, instead of the old single controller that followed whichever session was "active". A background turn now keeps streaming into its own state while the user views another session; switching sessions only rebinds the view and never repoints or disposes a running controller (plan §7.1/§7.4) — fixing the cross-talk where one session's tokens/approval could land in another.
- Each registry entry owns its transcript, error, status, and status-dot, with a self-contained pinned host adapter (so the controller never reads mutable "active" state). Turn-end transitions drive the sidebar status dot: a background run records `completed`/`failed` (unread green/red until opened), while the active session goes idle (its outcome shows inline, no unread dot — plan §8.2). `restoreFromRuns` rebuilds running/waiting status from `GET /api/desktop/session-runs` after a reconnect without clobbering a live client turn (plan §11).
- Adds `lib/chat/sessionDraftStore.ts` (per-session input text / attachments / thinking-level / selected-Bot, in-memory only per plan §10.3) and `lib/chat/sessionStatusDot.ts` (pure status + dot derivation). Pure logic is unit-tested (14 tests); the runes registry is `svelte-check` clean (0/0).

### Desktop shared conversation & session-run APIs (multi-session sidebar, Slice 1)
- New shared query layer (`src/lib/server/app/desktopConversations.ts`) powers the upcoming Desktop sidebar + multi-session navigator. It aggregates ordinary conversation sessions across all Web profiles and external Bot instances, resolves Bot identity/names (including deleted Bots), and offers stable `updatedAt + sessionId` cursor pagination plus title/Bot/preview search — all in the shared upper layer, never in a Channel.
- `GET /api/desktop/conversations` returns the newest-first cross-Bot list for a channel (default 10) with a cursor and `hasMore`; `GET /api/desktop/conversations/groups` returns per-Bot groups for the "more conversations" browser, each with its own cursor; `GET /api/desktop/session-runs` returns active running / waiting-for-approval runs from the runtime `runs` table (cross-referenced with the approval broker) with the Web profile id resolved server-side, so a restarted Desktop rebuilds true session state instead of trusting its own memory.
- Added `SessionStore.listAllWebConversations()` / `getWebConversationOwner()` and a `preview` field on `ExternalSessionEntry`. A `purpose` classification (`conversation | project | automation | diagnostic | test`) is computed in the shared layer; the sidebar filters to `conversation`, keeping project/automation/test sessions out of the list without duplicating that logic into channels or UI.
- Verified: 12 new unit tests (cursor stability on insert, no dup/omit, search, grouping, deleted-Bot grouping, cross-profile aggregation); `svelte-check` 0/0; `api.test.ts` 65/65.

## 2026-07-07

### Dynamic local service port fallback
- The configured server port is now a preferred starting port. If occupied at startup, both the Desktop supervisor and standalone server scan upward (`3000`, `3001`, `3002`, …) and use the first available loopback port.
- The selected endpoint remains discoverable through the runtime state file and Desktop handshake, without persisting a second fixed port.

### Desktop Chat sticks to the newest message
- The chat transcript now follows new content the way a chat should: while the reader is at the bottom, streamed tokens and appended messages keep the latest line in view; opening a conversation (or switching sessions) jumps to its newest message instead of showing the top of a long history.
- Following is suspended the moment the reader scrolls up to read history, so they are never yanked back down, and re-arms automatically once they scroll back to the bottom (48px threshold).
- Implemented as a shared `use:stickToBottom={sessionId}` Svelte action (`lib/chat/stickToBottom.ts`) used by both `ChatView` and `ProjectChat`: a scroll listener owns the pinned state, a `MutationObserver` follows subtree changes while pinned, and a key (conversation id) change forces a jump-to-latest. Replaced the previous unconditional `scrollToBottom()`/`afterMutate` calls that ignored reader position and never followed streaming growth.

### Desktop Chat streaming no longer waits for the whole turn
- Fixed Desktop chat rendering nothing during a turn — thinking and result tokens only appeared in one jump at the end. The SSE transport was streaming correctly (token/thinking events arrive individually over seconds); the regression was reactivity. `ChatView.svelte` and `ProjectChat.svelte` run in legacy mode (`export let` + `$:`), whose `$:` tracking is compile-time and only re-runs when a referenced top-level `let` is reassigned. Reading `chat.streamingText`/`.sending`/… there never updated, because the shared `ConversationController`'s runes `$state` mutate through Svelte's signal graph, invisible to the legacy tracker; only the post-turn `reload()` (which reassigns a legacy transcript `let`) painted, hence the one-shot appearance.
- Added `ConversationController.view` (`toStore(() => ({...}))`), a subscribable snapshot of the live turn state (`sending`, `streamingText`, `streamingThinking`, `activity`, `activities`, `pendingApproval`, `queue`). Both host surfaces now auto-subscribe via `$conversationView`, so streaming stays reactive. Any new legacy-mode chat surface must read live state through `$view` (or be runes-mode) rather than `controller.foo` in a `$:`.
- The live reasoning card now streams expanded while the model is thinking and auto-collapses (`open={!streamingText}`) once the result starts streaming, matching the intended thinking → collapse → answer flow.
- `svelte-check` clean (0 errors/warnings); `api.test.ts` 65/65 pass.

### macOS application icon packaging
- Reworked the Molibot pug icon with a warm light background, a macOS-style rounded-square silhouette, and real transparent outer corners while preserving the existing mascot composition.
- Generated the native PNG/ICNS assets and explicitly configured the Tauri bundle to use them, so Finder, Dock, the app bundle, tray, and DMG no longer fall back to an unrelated/default icon.

### macOS Desktop clean-machine first launch
- Fixed packaged Desktop builds omitting the production `node_modules` tree, which caused the bundled service to fail immediately on a Mac without an existing Molibot installation. The prepared runtime is now shipped as a versioned archive and atomically materialized under the writable data directory before launch.
- Completed the release runtime manifest by including `service-port.mjs` and classifying `@sveltejs/kit` as a production dependency required by Adapter Node.
- Empty data roots now receive the bundled `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, and `USER.md` defaults during shared runtime initialization. Existing files are never overwritten; settings and SQLite stores continue to initialize through the shared server layer.

### External sessions viewer derives from the Agent `contexts/` store
- The Desktop "External sessions" read-only viewer (telegram/feishu/qq/weixin) now derives its list and transcripts directly from the Agent `contexts/` store instead of a separate legacy `~/.molibot/sessions` flat copy. External-channel turns no longer double-write that redundant, unbounded store; web and project conversations are unaffected.
- Added `src/lib/server/app/externalSessionsFromContexts.ts` — a read-only, app-layer projection that enumerates each visible Agent session per channel workspace, projects it into the existing `ExternalSessionEntry`/transcript shapes, excludes `automation` (`task-*`) sessions, and carries identity in an opaque base64url id. The two `/api/desktop/external-sessions` routes now use it; the Desktop UI needs no change (the id was already opaque end-to-end).
- Made the legacy `SessionStore` external write path inert (`writeLegacySession` no-ops; the external branch of `createConversation` no longer persists a file/index) and removed the now-dead `listExternalSessions()` / `getExternalSession()` readers. No data migration is needed — `contexts/` already holds the full history; existing `~/.molibot/sessions/*.json` files are orphaned and can be archived/removed after verification.
- Coverage: new `externalSessionsFromContexts.test.ts` (list projection, automation/empty-session exclusion, content-block extraction, malformed/traversal/missing id handling) and updated `sessions/store.test.ts` (external channels no longer persist; web/project storage intact). Typecheck clean.

## 2026-07-06

### Desktop Chat continuous conversation flow
- Replaced the assistant avatar/card treatment with one continuous content column for reasoning, tool activity, and the final response. Reasoning and tool details remain collapsible but no longer render as separate cards.
- Changed right-aligned user messages from the blue accent fill to Geist neutral gray tokens for both light and dark themes.
- Fixed reasoning disappearing after a completed response reload. The Desktop session projection now enriches final assistant messages from the structured Agent context, matching by user turn and aggregating reasoning segments across intervening tool calls, including existing history without data migration.
- Updated shared transcript regression coverage; Desktop Svelte checks and all 23 chat UI tests pass.

### Easier recurring-task schedules
- Replaced the primary raw Cron field in Desktop Automations with daily, multi-select weekly, monthly-by-date, and custom schedule modes while preserving the existing five-field Cron runtime format.
- Existing complex Cron expressions fall back to custom mode without being rewritten; create and edit now share the same responsive, localized schedule builder with human-readable delivery and session options.
- Fixed the task editor's intended 720px width being overridden by the base modal rule, and added 40px keyboard-focusable schedule controls with narrow-window reflow.
- Replaced the raw target-directory list with separate Bot and Chat ID selectors backed directly by each enabled channel instance's `allowedChatIds`. Empty/duplicate IDs, disabled Bots, Web, internal folders, and recipient-less workspace targets are excluded, while existing workspace tasks remain compatible.

### Scheduled task stuck-in-running fix
- Fixed periodic (cron) tasks getting permanently stuck in the `running` state. When a triggered run was skipped because a sibling task sharing the same `taskId` was already active (`task_already_running`), `dispatchEvent` had already flipped the event file to `running` via the periodic run-lock, but the skip path returned without releasing it — leaving the file frozen at `running` forever. The skip path now releases the run-lock (`releasePeriodicRunLock`) and marks the slot consumed, so the file returns to `pending`.
- Fixed startup recovery ignoring orphaned `retry_wait` leases. `recoverStaleRunning()` only recovered `running` leases, so a `retry_wait` lease whose retry was never picked up (e.g. the process died mid-retry) stayed "active" indefinitely and — because `taskId` can be shared across events — permanently blocked every sibling task via `hasActiveForTask`. Recovery now also abandons `retry_wait` leases that are overdue by more than a full timeout window (`stop_reason = 'retry_abandoned'`).
- Note: sharing a generic `taskId` (e.g. `"explicit"`) across unrelated periodic events makes them mutually exclusive through `hasActiveForTask`; give each independent task a distinct `taskId` to avoid false "already running" skips.

### Globally-unique, readable task ids
- Task ids are now minted in the readable form `<slug>-<4-char-random>` (e.g. `ai-news-daily-8x2k`) instead of `task_<uuid>`. `createEventTaskId(slug?)` slugifies an optional name and appends a random suffix.
- `createEvent` now stamps a unique `taskId` on every newly created event and guarantees it does not collide with any existing event file in the same bot's `events/` directory. A new optional `name` parameter lets the caller choose the readable slug; updating an existing periodic task (matched by chatId + schedule + timezone) preserves its current `taskId` so execution history stays linked.
- `createEvent` filenames now include a random suffix (`event-<ts>-<rand>.json`) so two events created in the same millisecond no longer overwrite each other.
- Migrated the existing `moli_news_bot` tasks off the shared/generic labels: `explicit`/`explicit`/`news` → `ai-news-daily-*`, `ai-daily-report-*`, `news-daily-*`. (Past execution history recorded under the old ids stays in the lease store but is no longer shown under the renamed task.)
- Fixed the pre-existing failing unit test `late successful event completion suppresses timeout retry outcome`: it requested a 5ms lease timeout but `acquire()` clamps `timeoutMs` to a 1000ms floor (which predates the test), so the 20ms run always finished before the timeout and `onTimeout` never fired. The test now passes an explicit sub-run-duration timeout to `runAttemptWithTimeout` to genuinely exercise the "timeout fires first, run succeeds later" race; no production code changed.
- The lease store now warns (`momWarn` `eventLease/timeout_below_floor` and `eventLease/max_attempts_below_floor`) whenever a caller requests a `timeoutMs` under the 1000ms floor or `maxAttempts` under 1, instead of silently clamping. This surfaces the exact footgun behind the stale test — passing milliseconds where the floor swallows them — in both `acquire()` and `recordSkipped()`.

### Desktop release automation
- The Desktop DMG workflow now triggers on the actual release tag convention (`v*`, e.g. `v2.2.5`) in addition to the legacy `molibot-v*` tag, so pushing a release tag automatically builds the Apple Silicon DMG, checksum, and build-info manifest and publishes them to the tag's GitHub Release.
- Fixed a CI ordering bug where `actions/setup-node` requested the pnpm cache before corepack had enabled pnpm; corepack now runs first so the cache step can resolve the pnpm store.
- Declared `rollup` and `@rollup/plugin-{node-resolve,commonjs,json}` as root devDependencies. The custom `scripts/svelte-adapter-node-sqlite.js` adapter imports them at module load, but they were only present via a dirty local install; a clean `pnpm install --frozen-lockfile` (as on CI) failed the desktop build with `Cannot find package 'rollup'` during Svelte config load. They are now in `package.json` and the lockfile.

## 2026-07-05

### Desktop Projects
- Added a Projects workspace for registering real external directories and running multiple isolated conversations directly against project files.
- Project session metadata stays inside Molibot's Workspace while tools use the registered root as cwd; deleting a project never deletes or modifies that directory.
- Project AGENTS.md, AGENT.md, or CLAUDE.md conventions participate in the final prompt without overriding bot identity, runtime safety, sandbox, or approval rules.
- Fixed the Desktop HTTP capability scope so project registry and nested session requests are allowed on configured loopback ports.
- Project creation now asks for a name first, then either creates a unique managed directory or invokes the native macOS folder picker once for an existing folder.
- Project conversations now expand directly below the active project, and a newly added empty project immediately creates and opens its first conversation.
- Project and regular Chat now share one conversation controller (the send/stream/queue/stop/approval turn engine), streaming renderer, and composer shell instead of maintaining a separate project chat implementation.
- Fixed project session conversations not appearing in the detail pane after selection: selecting a session now surfaces load errors instead of failing silently, and finishing a turn reloads the current session in place rather than jumping back to the most recent one.
- Project sessions now use Chat's shared `ConversationRow` implementation for selection, rename, and delete confirmation instead of maintaining similar markup and behavior.
- Chat and Project session delete share the same explicit confirmation menu.
- Projects reloads once per component mount/endpoint and shows a transcript loading state instead of an unexplained empty detail pane.
- Project composer now matches the Chat composer: model selector, thinking level, file attachments, and voice recording are all available on the project surface, with shared composer styling.
- Fixed the first click on a Project Session not switching the message pane: Project-list and transcript requests now validate request generation, Project ID, and Session ID before mutating visible state.
- Project page now shares Chat's actual Session-row component in addition to the existing shared sidebar/header/layout chrome.
- Refined the sidebar group/session hierarchy (shared by Project, Bot, and Agent groups): the disclosure caret moved from the left of the group header to the right, the session list is indented with a vertical guide line so it clearly belongs to its group, and the per-session icon was removed (the indented, guide-lined title alone conveys grouping).

### Configurable service port and managed restart
- Added a persisted service-port setting (default 3000) to Web System Settings and Desktop General Settings, with validation for ports 1024–65535.
- Standalone startup and the Desktop supervisor now honor the saved port on the next launch; an explicit `PORT` environment variable still takes precedence for managed deployments.
- Desktop users can save and restart the managed service in one action. Restart controls reject external services instead of terminating a process that Molibot cannot bring back.
- Fixed the Desktop HTTP capability scope so the new port setting can read and write `/api/settings` on loopback endpoints instead of failing before the request reaches Molibot.
- Port updates now reject occupied loopback ports with a clear conflict response instead of persisting a value the supervisor cannot bind.
- Fixed Desktop restart adoption: a rediscovered Desktop-managed sidecar remains managed and its PID is adopted into the new supervisor control loop, so Save and Restart stays available after relaunching the app.

## 2026-07-04

### Desktop Chat workspace design compliance
- Audited Chat, Automations, and Skills against `DESIGN.md` using supplied production screenshots, then fixed confirmed hierarchy, localization, recovery, responsive, and keyboard-focus gaps.
- Skills now supports search, compact expandable descriptions, content-height cards, and accurate inventory naming instead of implying an unavailable marketplace.
- Chat keeps media failures on retryable attachment states, localizes the generic assistant fallback, presents dismissible alert errors, and applies the shared two-layer focus ring across workspace controls.
- Automations now uses the shared 6px/12px Geist radius family and restrained elevation, avoids duplicated single-line task text, and localizes execution states. The compact breakpoint now activates above the app’s real minimum window width.

### Desktop Automations: complete management and paginated history
- Upgraded the recurring automation workspace with safe task creation, compact management cards, search, edit/delete, batch actions, and manual runs while keeping one-shot/immediate events out of the product-facing list.
- Task cards now show only the last execution time and three recent results by default. Full execution history loads on demand from SQLite in newest-first pages of ten, retaining links to read-only run transcripts.
- Creation uses validated channel/Bot/chat/scope targets and the shared watched-event JSON runtime without exposing host paths to the WebView.
- Refined the workspace into a Geist operations console with a unified command deck, stronger task/schedule hierarchy, consistent create/edit dialogs, and a dedicated paginated history modal instead of inline expansion.

### Desktop Sessions: hide automation runs from navigation
- Fixed fresh automation conversations still appearing in external-channel Session groups. The shared session listing now recognizes the persisted `task-*` session-key suffix and excludes those records from ordinary navigation without deleting transcripts or breaking execution-history links.
- `make desktop-dev` and the root `desktop:dev` script now build the shared Server before launching Tauri dev, preventing the managed service from silently loading a stale `build/index.js` after backend edits.

### Desktop Chat: shared inline media and tool execution
- The shared `ConversationTranscript` now renders protected image, audio, and video attachments inline: images use the existing preview flow, audio/video use native controls, and generic files retain the compact download treatment. Media is loaded through the guarded Desktop file endpoint as revocable Blob URLs rather than exposing local paths.
- Replaced duplicate start/end diagnostic chips with a shared collapsible vertical execution view. Streaming and multipart Chat routes now use the same activity collector, merge each tool start/end pair, truncate oversized summaries, and persist the structured result with the assistant message so live Chat, history, external transcripts, and automation details keep one presentation path.
- Attachment-only messages no longer expose internal `(attachment)` / `(empty response)` placeholders or render empty text bubbles, and failed tool runs now use a distinct attention state instead of the completed label.
- Added focused media, activity reducer/collector, persistence, and shared-renderer regression coverage; Desktop Svelte diagnostics report 0 errors and 0 warnings.

## 2026-07-03

### Desktop Automations: Chat-style execution transcript
- Fixed automation execution sessions displaying Agent content blocks as raw JSON, including historical records where the entire block/object array was itself stored as a JSON string. Both server and Desktop client now extract user/assistant text, omit internal thinking/system/tool content, preserve ordinary user-authored JSON, and tolerate a temporarily older local service.
- Removed the parallel task-session message styling. The modal now uses the actual Chat page `message-row`, `message-avatar`, `message-stack`, `message-bubble`, Markdown, and timestamp structure, so Molibot no longer has two visual identities.
- Extracted that structure into the shared `ConversationTranscript` module, now used by local Chat history, external read-only transcripts, and automation sessions. Markdown, roles, thinking, attachments, audio/preview/download actions, search highlights, read state, and timestamps have one implementation; realtime streaming/approval/composer state remains in the Chat shell.

### Desktop Chat: in-workspace navigation and idempotent New Chat
- “New Chat” now expands the active Web Profile, focuses the fresh Session, and reuses it while it remains empty instead of creating duplicate empty Sessions.
- Automations and Skills now switch the Chat right pane without opening the separate Settings window. The Skills pane lists the complete installed/discovered skill projection, including Bot/chat-scoped generated skills, while marketplace and installation flows remain deferred.
- Began decomposing the 2,000+ line Chat view with dedicated workspace routing, installed-skills presentation, and pure New Chat decision modules; added focused regression coverage and responsive bilingual/theme-token styling.

### Desktop Settings: split the monolithic App into per-domain modules
- The macOS Settings UI lived in one 3,953-line `App.svelte` (~258 state variables, 147 functions, all 24 sections in a single if/else chain), which was effectively unmaintainable by hand. Refactored it — with no behavior change — into an industry-standard per-domain layout: a shared Svelte 5 runes `session` store for cross-section state, one runes state module per domain under `lib/stores/`, and one presentational component per section under `lib/settings/`. Each store wraps the unchanged pure transport layer (`lib/api.ts`) and owns its own loading/dirty state; each section owns its load effect and its own save bar. Shared SVG chart geometry, timezone options, and profile-file helpers moved to small `lib/settings/` modules. `App.svelte` is now a ~540-line shell (nav, General/Diagnostics, status polling, theme/locale, section dispatch). Verified: `svelte-check` 0/0, production build (213 modules), `chat-ui.test.mjs` 9/9 (repointed at the new files), and a vite runtime transform check of every new module.

## 2026-07-02

### Desktop Chat: calmer Session navigation
- Rebalanced Bot/Profile headers and Session rows to a consistent compact density, changed every group to start collapsed and expand only on click, and made Web/external Session ordering explicitly follow latest `updatedAt` so recently continued conversations return to the top.

### Desktop Settings: consistent, dirty-gated save bars
- Standardized where and when a Save affordance appears across every Settings page. The sticky bottom save bar is now dirty-gated everywhere: Skills, Plugins, and Sandbox previously showed it permanently (keyed off a draft object that exists from load), so it now compares the working draft against a pristine snapshot and appears only when something actually changed — the phantom Skills save bar is gone. Every save bar now uses one layout — a left "有未保存的更改 / Unsaved changes" label with right-aligned Discard + Save — and Skills/Plugins/Sandbox/Models gained a Discard that reverts to the loaded values. Read-only pages (Usage/Trace/Run History/Diagnostics), instant-apply pages (General), and per-entity editors (Agents/MCP/Channels/Profiles/Memory/Tasks) are unchanged by design.

### Agent engineering methodology
- Added first-principles problem decomposition and mandatory adversarial pre-delivery review to the repository's long-lived `AGENTS.md` collaboration rules, including explicit rationale, 3–5 likely failure points, and evidence-based verification.

### Service process: clean exit on Ctrl+C / SIGTERM
- `scripts/start-server.mjs` now force-exits on `SIGINT`, `SIGTERM`, and SvelteKit's `sveltekit:shutdown` after releasing the `service.lock` lease. Previously the process released the lock but stayed alive (EventsWatcher timers, sqlite, `fs.watch` kept the event loop drained-empty from never happening), so each `make desktop-dev` Ctrl+C left an orphaned node process and the next run spawned a fresh one — accumulating multiple live server processes on one data directory. The existing single-instance lock (`~/.molibot/runtime/service.lock`) now actually enforces one-process-per-data-dir again, since orphans no longer linger.

### Desktop Settings UI: full Geist conformance pass
- Swept the Desktop Settings surface for Geist design-system conformance (`DESIGN.vercel.md`). Removed the 6-color macOS accent picker and the per-nav-item tinted sidebar icons — Geist uses a single blue-700 accent owned by the theme tokens — so the settings sidebar is now monochrome.
- Replaced every hardcoded macOS system color in the settings styles with Geist tokens (iOS red/green/blue/purple/gray and Material reds → `--danger` / `--online` / `--accent` / `--chart-purple` / `--gray-*`); status dots, switches, status badges, model-chip verify states, the external-channel / onboarding / health-check views, and the sidebar footer now derive color from tokens in both light and dark.
- Consolidated radii to the Geist 6/12/16/9999 family (controls 6px, cards 12px, pills 9999px), replacing ad-hoc 4/5/7/8/9/10/11/18px values across the whole stylesheet.
- Aligned typography to the Geist scale: font weights are now only 400/500/600 (was 450/550/650/680/700) and half-pixel sizes (13.5/12.5/11.5/10.5/9.5/14.5px) snapped to whole pixels.
- Unified button variants — primary (gray-1000), secondary (white + border), tertiary (transparent), and a new error button (red-800) — all 32px with 6px radius; destructive secondary buttons now share a consistent red-tint hover. Simplified the popup select to a single Geist chevron with proper disabled styling (gray-100 fill, gray-700 text, not-allowed).
- Verified: Desktop `svelte-check` 0/0, `chat-ui.test.mjs` 8/8, production build green. Chat-view color literals (conversation / message / composer / file) still hold the old macOS values and are the next slice.

### Desktop Chat UI: Geist color alignment
- Finished the Geist alignment on the Chat surface (`apps/desktop/src/styles.css` + `ChatView.svelte`). Every iOS chrome literal is now a Geist token: the `rgb(60 60 67 / X%)` label-gray scale maps to `--label-primary`/`--label-secondary`/`--label-tertiary` by opacity (95/85→primary, 65–80→secondary, 30–55→tertiary); `rgb(120 120 128 / X%)` system-gray hovers/fills map to `--fill`/`--fill-hover`; iOS red `rgb(255 59 48 / X%)` and orange `rgb(255 149 0 / X%)` map to `color-mix` tints of `--danger`/`--warning`.
- File-type tints (image/video/audio/file) now derive from `--online`/`--accent`/`--chart-purple` via `color-mix` instead of raw iOS blue/green/purple. De-blued the chart-KPI and entity-editor shadows (`rgb(28 38 68)`/`rgb(12 16 26)` → neutral `rgba(0,0,0,X)`) and softened the conversation-tile shadow.
- Introduced explicit `--code-bg`/`--code-text` tokens (fixed dark in both themes) so the markdown code block and approval-field code render correctly in dark mode too, replacing the iOS `#f2f2f7` text literal. Cleaned the 10 dead `var(--sidebar-surface, rgba(...))` fallbacks down to the token.
- `ChatView.svelte`: replaced the inline-styled read-only notice with a semantic `.external-readonly-notice` class, and toned the generic channel-tile fallback palette from iOS system tints to Geist accent scales (blue-700/purple-700/pink-700/amber-700/green-700/teal-700). Channel brand identity colors (`CHANNEL_COLORS`: Telegram/WeChat/Discord/Slack/QQ…) are kept as legitimate semantic identity, not chrome.
- Verified: Desktop `svelte-check` 0/0, `chat-ui.test.mjs` 8/8, production build green. Remaining: install the Geist Sans / Geist Mono fonts.

### macOS Automations: recurring task history and session detail
- Added a macOS Automations view for recurring watched-event tasks: Desktop now projects only periodic tasks, keeps one-shot/immediate tasks out of this app page, and preserves `/settings/tasks` as the full diagnostics surface.
- Fixed the Automations page getting stuck during a frontend/local-service version mismatch by normalizing older task responses and stopping automatic retry loops after a failed load.
- Added stable task ids for future periodic executions, SQLite-backed execution history with session links, skipped records, retry attempt counts, and task-level non-concurrency for scheduled and manual runs.
- Fresh automation sessions now carry explicit automation origin metadata and are hidden from ordinary session listings; execution records can open a read-only session detail view, with a cleaned-session state when retention has already removed the transcript.

## 2026-07-01

### Desktop app: adopt Geist design system (foundation + Chat + interaction)
- Began migrating the whole desktop app (Chat + Settings) from the Liquid-Glass macOS aesthetic to Vercel's Geist system (`DESIGN.vercel.md`) per product decision. Re-based the entire token layer to Geist light/dark (gray scale, blue-700 accent, background-100/200 surfaces, 6/12/16 radii, subtle shadows), removed all glass blur/wallpaper/translucency, and converted core controls: flat bordered cards, secondary buttons, 6px selects/inputs with the two-layer focus ring, Geist status badges, and neutral (monochrome) settings-nav selection.
- Second pass: converted the Chat surface (message bubbles → flat 12px bordered, composer → flat with Geist focus ring, ghost square icon buttons), the shared chips/inputs/model-chips to 6px Geist, made the primary button a solid `gray-1000` (Geist primary, inverts correctly in dark), fixed avatar/brand marks that went invisible in dark, and normalized modal/card radii. Interaction fix on `/settings/tasks`: replaced the flat 4-button bulk bar with a hierarchy (selection count + low-emphasis 全选/清除 helpers, then the real 触发/删除 actions), and the per-row 3 text buttons with compact ghost icon actions. Verified light + dark; remaining detail pages (providers/sandbox/media) still to sweep.

### macOS Desktop local service startup
- Fixed the Desktop-managed local service repeatedly exiting after a production build by keeping the custom SQLite-aware Node adapter aligned with the current adapter-node runtime placeholders.

### pnpm workspace migration
- Migrated the root application and macOS Desktop package from separate npm lockfiles to one pnpm workspace and lockfile. Local development, CI, Docker, Tauri, and release-bundle commands now use the pinned pnpm toolchain and shared content-addressable package store.
- Fixed `make desktop-dev`, `make desktop-check`, and `make dmg` on systems without a global pnpm executable by invoking the pinned package manager through Corepack at both the Make and nested package-script layers.

### macOS Settings layout rhythm polish
- Reworked the Settings page vertical spacing so modules stop crowding each other: roomier page header, section hints now separated from the first card, stronger group-title section breaks (theme-adaptive color for dark mode), a larger card-to-card gap, and proper margins around the chart blocks so KPI tiles / trend cards / split rows no longer touch neighbouring cards.

### macOS Settings Usage & Trace chart dashboards
- Rebuilt the Desktop **Usage** and **Trace** settings pages from plain stat rows into chart dashboards: KPI tiles plus hand-rolled SVG charts (no chart library). Usage gets a 30-day token/request trend area chart with a peak marker, a token-type distribution donut, and a stacked time-window comparison; Trace gets an activity bar chart, a tool-outcome donut (succeeded/failed/blocked), coverage tiles, and a tool-vs-model average-duration comparison.
- Extended the credential-safe desktop usage contract with a `daily` series (date + token/request totals only, projected from the existing shared daily buckets) to power the trend chart, and added a macOS-derived `--chart-*` palette with light/dark variants. No fabricated metrics — only data the runtime already records.

### macOS Settings dropdown polish
- Replaced the inconsistent mix of custom-triangle and raw native `<select>` controls on the Desktop Settings pages with a single macOS-style popup button: soft surface, faint depth shadow, a clean stroked double-chevron (light/dark variants), and hover / accent-focus / disabled states. Added shared `--control-*` tokens, matched form-grid selects to adjacent input height, and gave settings rows a bit more breathing room for a calmer, more system-native rhythm.

## 2026-06-30

### macOS chat sidebar: channel → Bot → session navigation
- Rebuilt the Chat sidebar as a unified two-column navigation: a horizontal channel switcher (Web / telegram / feishu / qq / weixin — compact avatars separated from the nav menu by a hairline divider) sits above the Bot list; selecting a channel lists all of its configured Bot instances (including zero-session ones), expanding a Bot reveals its sessions, and selecting a session opens the chat on the right. Web Bots are Web Profiles (editable sessions); external-channel Bots are read-only.
- Fixed every external session collapsing into "未指定 Bot 实例": the projection only read the (unpopulated) `external.botInstanceName`. In real data the Bot identity is encoded in the legacy index `externalUserId` (`bot:<instanceId>:chat:...`, e.g. `bot:moli_news_bot:chat:...`), while the conversation `id` is an opaque UUID. The server now recovers `botInstanceId` from `externalUserId` and the client joins it against channel settings (instance id = slug, name = display name) to resolve Bot names and the full list — 269 of 272 external sessions now attribute correctly (telegram fans out to ~10 bots, feishu 8, qq 2, weixin 1); the 3 older `chat:<chatId>:...` keys with no Bot prefix fall back to an "unspecified bot" entry.
- Added the pure `parseBotInstanceId` helper (parsing `externalUserId`) and the `DesktopExternalSession.botInstanceId` contract field, threading `externalUserId` through the projection; added the pure `buildExternalChannelNav` / `externalSessionsForBot` helpers and `.channel-switch` / `.channel-chip` semantic classes. Verified with `api.test.ts` (60/60), `desktopExternalSessions.test.ts` (9/9), Desktop `svelte-check` (0/0), the Desktop production build, and a dry-run over the real `~/.molibot/sessions/index.json`.

### macOS Settings navigation and editor workflow
- Aligned the Desktop sidebar with the Web settings taxonomy: General, AI Engine, Channels, Agent Data, and System.
- Moved Agent, MCP, external channel, Web Profile, Memory record, and task forms into centered scrollable editor panels with their own sticky title/action bars while preserving narrow save APIs.
- Standardized entity-enabled controls on the DESIGN-defined 38×22 switch instead of falling back to native checkboxes inside editors.
- Audited all 22 Desktop settings destinations and fixed card rhythm, TTS disclosure defaults, image-size and timezone selectors, run-history filtering, localized channel labels, narrow command wrapping, and the remaining inline Web Profile rename flow.
- Fixed partial live locale switching in Desktop Settings by making every translated helper explicitly depend on the current translation/locale; validated all 22 pages in English dark mode at the 620×480 minimum window without horizontal overflow.

### Scheduled tasks: session isolation dropdown + consistent default fix
- The session-isolation control on `/settings/tasks` is now a `fresh` / `chat` dropdown (`NativeSelect`) instead of an `IosSwitch` toggle, so the two modes are explicit rather than an ambiguous on/off. Fixed the bug where a task that looked like `chat` reverted to `fresh` after running once: the edit toggle treated an unset `sessionMode` as `chat` (switch off) while the badge and runtime resolve unset + `periodic` → `fresh`, so saving without touching the toggle persisted an empty value that displayed as `fresh`. The editor now seeds the dropdown with the *effective* mode via a shared `effectiveSessionMode` helper (also reused by the display badge) and always saves an explicit `fresh`/`chat`, so the selection no longer drifts.

### macOS Sandbox policy parity
- Replaced the Desktop Sandbox read-only summary with Web-parity Observe/Build/Strict presets and full environment, network, and filesystem policy editing.
- Added draft-only preset application, reset, a fixed save footer, saved-policy diagnostics refresh, and a narrow Desktop PATCH contract.
- Kept environment values and resolved absolute paths outside the WebView; existing external env-file paths are preserved until explicitly replaced by a relative path.
- Verified 61 focused server/client tests, 6 UI structural tests, zero Svelte diagnostics, Desktop/Web builds, and isolated standard/640px save-and-reload flows.

### macOS AI Provider editor workflow
- Moved the complete self-hosted Provider create/edit form from the bottom of the Settings page into a wide, scrollable Liquid Glass modal with a persistent action footer and Escape/backdrop close behavior.
- Split the UI terminology and hierarchy into built-in providers, self-hosted providers, and custom models without changing the existing credential-safe provider contract.
- Verified the modal against an isolated temporary service at standard and 640px widths; frontend tests, Desktop type checks/build, and the Web production build pass.

### macOS Settings liquid-glass visual alignment
- Reworked the standalone Settings composition to match the Momo macOS reference: native titlebar spacing, a functional bilingual sidebar filter, compact category navigation, a fixed right-pane title, an independently scrolling grouped-content area, and 46px native-density rows.
- Strengthened the material hierarchy with distinct sidebar/content/card translucency, saturation blur, specular highlights, glass hairlines, theme-safe depth, and translucent sticky save footbars while preserving all existing settings behavior.
- Desktop `svelte-check`, frontend tests (4/4), Rust tests (8/8), and the production build pass. Per request, no screenshot or browser visual validation was performed; final visual acceptance is on macOS.

### macOS Settings i18n standardization and tool/provider parity polish
- Replaced hardcoded English across Desktop Settings with bilingual `text.*` keys: tool `Base URL`, Provider protocol option labels (`OpenAI 兼容` / `Anthropic`), Search route and strategy enums, Search/Image/Video engine names, TTS format labels (uppercase), and TTS provider display names. Added matching zh-CN/en-US strings.
- Added a reusable show/hide API-key reveal control (Phosphor eye toggle, `.secret-input` / `.secret-reveal` semantic classes) across Web Search, Image, Video, and TTS engine/provider credential fields.
- Search: added a per-engine test-target selector so unsaved configs can be tested against a chosen engine, not just the default.
- TTS: added a test-provider selector, a Xiaomi MiMo voice dropdown (mirroring the web's fixed voice list) replacing free-text entry, and uppercase audio format labels.
- Provider: added a per-row "Set as default" button, per-model verification result badges (passed/failed/untested), and an editable supported-roles chip row; both verification and roles already round-trip through the existing Desktop contract.
- Image and Video generation: added a task-detail modal (image/video preview + download + status/progress/prompt/error/timestamps) and 5s polling that auto-starts while tasks are processing and stops when none remain. Engine names in the task list and default-engine selector are now localized (Agnes Image, OpenAI Images, Volcengine, etc.) matching the web.
- Model routing: added a live compaction-trigger preview callout (computes the firing token count from the current text model's context window vs threshold/reserve) and replaced the free-text timezone field with a native `<select>` populated from `Intl.supportedValuesOf("timeZone")`.
- Final i18n sweep: localized the remaining hardcoded strings — header language `aria-label`, Memory channel/userId placeholders, Runtime Environment "total" count, Diagnostics service-connection state (ready/disconnected/incompatible/error), the Weixin QR-login link placeholder, and the onboarding sidebar-resize `aria-label`.
- Preserved the existing Desktop privacy boundary: the `DesktopMediaTask` projection still omits local filesystem paths, session ids, and provider request parameters (which may carry secrets); the new task modal renders only public URLs and status. The matching `desktopMediaTasks` regression test still passes.
- Kept all changes inside the existing Liquid Glass token/semantic-class system (DESIGN.md); zero new raw Tailwind or ad-hoc color values.
- Verified zero Svelte diagnostics via `svelte-check` and the full 155-test Desktop regression suite.

## 2026-06-29

### macOS Settings Provider, routing, and generation-tool parity
- Unified Provider creation and onboarding with the full multi-model editor, including capability tags, context windows, endpoint paths, and thinking/reasoning configuration.
- Added advanced model routing for tiered subagents, fallback/timeouts, default thinking, compaction, and timezone through a narrow Desktop API.
- Upgraded Web Search, Image, Video, and TTS from read-only summaries to credential-safe save/test flows; added sanitized image/video task management and macOS voice selection plus TTS test playback.
- Preserved the existing DESIGN-driven macOS grouped-card UI, bilingual/theme-aware rendering, narrow-window layout, and fixed save footer.
- Verified 155 Desktop regression tests, zero Svelte diagnostics, Desktop/Web production builds, and normal/680px rendered layouts.

### macOS Settings actionable Tasks management
- Added full task text/filtering, editing, single/batch triggering, and single/batch deletion to Desktop Settings.
- Replaced watched-event JSON paths with opaque ids and delegated mutations to the existing path-validated runtime handler.
- Verified 98 Settings regression tests, zero Desktop Svelte diagnostics, and Desktop/Web production builds.

### macOS Settings actionable Memory management
- Added scoped/all-scope memory list and search, sync, flush, compact, record edit/delete, and governance-rejection filtering to Desktop Settings.
- Kept governance-log filesystem paths and diagnostics outside the Desktop contract.
- Verified 93 Settings regression tests, zero Desktop Svelte diagnostics, and Desktop/Web production builds.

### macOS Settings actionable Plugins configuration
- Added memory enable/backend controls and dynamic feature-plugin setting fields with a fixed Desktop save footer.
- Kept plugin passwords replacement-only or explicitly clearable, while preserving omitted settings and hiding catalog filesystem paths.
- Verified 90 Settings regression tests, zero Desktop Svelte diagnostics, and Desktop/Web production builds.

### macOS Settings actionable Skills configuration
- Added per-Skill enable/disable controls using opaque server-resolved identifiers, without exposing absolute Skill paths.
- Added editable local/API skill-search settings for Provider, model, token, temperature, timeout, and confidence controls while preserving hidden server credentials.
- Verified 84 Settings regression tests, zero Desktop Svelte diagnostics, and Desktop/Web production builds.

### macOS Settings actionable MCP management
- Added structured stdio/HTTP MCP server create, edit, delete, and enable controls in Desktop Settings.
- Kept saved args, env values, headers, and cwd server-side while supporting explicit replacement and clearing from the Desktop form.
- Verified the 79-test Settings regression suite, zero Desktop Svelte diagnostics, and Desktop/Web production builds.

### macOS Settings actionable external-channel management
- Migrated Telegram, Feishu, QQ, and Weixin instance CRUD, credentials, Agent/sandbox/allowlist configuration, and Bot Markdown files into the new macOS UI through shared credential-safe APIs.
- Added Feishu connection testing with saved or unsaved credentials and a local Weixin login QR tool; saved secret values never return to the WebView.
- Verified 56 focused tests, Desktop Svelte check with zero diagnostics, and Desktop/Web production builds.

### Molibot macOS App native microphone recording and audio playback
- Fixed voice recording always failing with "microphone recording is not supported in this environment": Tauri's macOS WKWebView does not expose `navigator.mediaDevices`, so the renderer's `getUserMedia` path could never run (in both dev and packaged builds).
- Added a native capture path: new Rust module `audio.rs` opens the default input device via `cpal`, buffers samples on a dedicated thread (cpal's `Stream` is `!Send`), and on stop encodes an in-memory 16-bit PCM WAV with `hound`, returned as base64 through `start_recording`/`stop_recording`/`cancel_recording` commands.
- Fixed capture returning only silence: the device was opened without ever requesting microphone authorization, so macOS silently denied it. Added `ensure_microphone_access()` which uses `objc2-av-foundation` to check `AVCaptureDevice` authorization and trigger the system permission prompt, surfacing clear denied/restricted/timeout errors.
- Rewired `ChatView.svelte` to drive the native commands when running inside Tauri (detected via `__TAURI_INTERNALS__`), turning the returned WAV back into a pending audio attachment, while keeping the browser `MediaRecorder` fallback for plain `npm run dev`.
- Added audio playback: pending (not-yet-sent) recordings get an inline `<audio>` player for instant review, and sent audio messages gain a Play button that lazily fetches the file and plays it inline. Object URLs are created/revoked alongside their files and on session switch/teardown.
- Fixed sending an attachment (e.g. a recorded voice message) failing in the packaged app with "Cross-site POST form submissions are forbidden": the multipart `/api/chat` POST arrives from the `tauri://localhost` WebView origin, which SvelteKit's CSRF check rejects against the loopback server origin. Added `tauri://localhost` to `kit.csrf.trustedOrigins` in the server config, keeping full CSRF protection for the web deployment while allowing that single fixed desktop origin.
- `cargo check` passes; Desktop `svelte-check` is clean (0 errors/0 warnings). Native recording, playback, and attachment send verified in a packaged build.

### macOS Settings actionable Provider, Profile, and Agent management
- Upgraded AI Providers from a read-only summary to credential-safe editing, deletion, global/default selection, model registry management, model discovery/testing, and thinking configuration.
- Added complete Web Profile CRUD, Agent linkage, sandbox overrides, and Profile Markdown file editing while preserving server-owned credentials and allowlists.
- Added complete Agent CRUD, dedicated text/vision/STT routes, sandbox overrides, Agent Markdown file editing, and linked-agent deletion protection.
- Added narrow Desktop entity/profile-file APIs and Tauri loopback scopes; 70 targeted tests, Web/Desktop builds, and Desktop type checks pass.

## Version 1.0

## 2026-06-28

### Molibot macOS App Settings functional parity kickoff
- Started Desktop Settings functional parity with the existing Web settings: AI Providers now supports creating credential-bearing custom providers and testing saved providers without returning API keys to the WebView.
- Removed the unconditional “Check again” footer from every Desktop Settings section. A clearly named service reconnect action now appears only while the local service is disconnected.
- Added responsive, bilingual, theme-aware provider form styling with a fixed save footer; targeted tests, Desktop type checks, and both Desktop/Web production builds pass.

### Molibot macOS App Chat composer, recording, and Markdown polish
- Moved the Enter/Shift+Enter guidance into the localized chat textarea placeholder and removed the separate toolbar hint.
- Rewired the microphone control from TTS Settings to the existing voice recorder, adding a visible recording timer with cancel/finish actions and the macOS microphone usage declaration.
- Updated assistant Markdown code blocks to wrap long content within the message bubble without horizontal scrolling, with focused UI contract tests plus clean Desktop check/build validation.

### Molibot macOS App desktop Settings — Voice/TTS, Video, Image, Web Search, Plugins (read-only)
- Completed the §8 "preserve all settings capabilities" set in Desktop Settings with five more read-only sections, each backed by a new credential-safe `/api/desktop/*` route and a field-by-field mapper that never leaks keys or disk paths:
  - **Voice (TTS)** — `desktopTtsGenerate.ts`: macOS system-voice provider (voice/format, no key) + Xiaomi MiMo provider (`apiKey`→`hasApiKey`, keeps baseUrl/model/voice/format). Covered by `desktopTtsGenerate.test.ts` (4 cases).
  - **Video & Image** — one shared `desktopMediaGenerate.ts` mapper (image and video share the same shape): per-engine `apiKey`→`hasApiKey`, keeps enabled/baseUrl/model + counts. Covered by `desktopMediaGenerate.test.ts` (4 cases).
  - **Web Search** — `desktopWebSearch.ts`: routing config + per-engine `apiKey`→`hasApiKey` (keeps baseUrl) + total/enabled/configured counts. Covered by `desktopWebSearch.test.ts` (4 cases).
  - **Plugins** — wired the previously-orphaned `desktopPlugins.ts` mapper end-to-end (route + test + loader + UI): loaded plugins by kind/source/status, dropping `manifestPath`/`entryPath`/`settingsFields`. Covered by `desktopPlugins.test.ts` (4 cases).
- Added each route to the Tauri loopback capability scope and a client loader. With these, **every §8 settings capability is now surfaced in Desktop Settings** (22 sections). desktop-chat suite 128/128, Desktop Svelte check 0 errors/0 warnings, Desktop + Web production builds pass. Live smoke against a running service with real config remains pending for each.

### Molibot macOS App Phase 3 external sessions — Bot-instance hierarchy
- The read-only external-channel sidebar now adds a "channel → bot instance → session" tier only when a channel has more than one distinct bot instance (plan §7.2); single-instance and legacy (no-metadata) channels stay flat. Legacy sessions bucket under a null instance, shown with an "Unspecified bot instance" heading only when the channel is actually split. Added the pure `groupExternalSessionsByInstance` helper (3 new tests); reuses the existing `/api/desktop/external-sessions` contract, so the hierarchy appears automatically once channel adapters populate `botInstanceName`. desktop-chat 112/112, Desktop check/build green.

### Molibot macOS App Phase 4 onboarding — channels & diagnostics steps
- Replaced the last two §9.2 guided-flow placeholders with working read-only steps: the **channels** step shows configured external channels (enabled/total per channel + connected count, routing to Settings → Channels) and the **diagnostics** step shows runtime diagnostics (service ready state + dependency installed/total + missing dependency names, routing to Settings → Runtime environment). Both are informational, never gate Finish, and reuse existing credential-safe endpoints via the new pure `summarizeOnboardingChannels`/`summarizeOnboardingDiagnostics` helpers (4 new tests). With these, **all five §9.2 guided steps are implemented** (provider/agent/channels/launch/diagnostics). desktop-chat 109/109, Desktop check/build green.

### Molibot macOS App Phase 4 onboarding Provider submit & verification step
- Relocated the external channel transcript panel from the narrow sidebar to the main right-hand content view (`.messages` element). Selecting an external session renders its transcript messages (including Markdown and attachments) in the central pane, shows a localized read-only composer banner, and renders a proper empty state when no session is selected.
- Pinned the chat composer to the bottom of the viewport by upgrading the main `.chat-content` container layout to a flex column with `height: 100%; min-height: 0;` (preventing flex-parent overflow expansion) and `.messages` to `flex: 1; min-height: 0;`, resolving layout scrolling issues when messages grow or when the search bar is toggled.
- Fixed scrolling behavior across all list views: enabled scrollbar scrolling in settings content container with sticky footer position, enabled vertical scrollbar overflow in sidebars, and set explicit max-height and flex grow bounds on sidebar list items and onboarding cards.
- Replaced the guided onboarding Provider placeholder with a fully functional custom Provider save and connection test flow.
- Added `/api/desktop/providers` [POST] endpoint and a secure, no-spread `buildNewCustomProvider` mapper to configure and register the custom provider and switch the providerMode to "custom". API keys are saved locally and never exposed in any route responses.
- Added `/api/desktop/provider-test` [POST] endpoint to perform remote connectivity checks. The endpoint reads the API key from the local config and runs the test, ensuring credentials never travel back to the WebView.
- Added client-side wrappers `submitDesktopProvider` and `testDesktopProvider` in `api.ts`, mapped scopes in Tauri's default capabilities, updated i18n localization, and wired reactive UI status buttons in `ChatView.svelte` to require submission before advancing.
- Covered by server-side tests in `desktopProviderSubmit.test.ts` (5 cases) and client-side mocks in `api.test.ts` (2 cases). All tests pass.

### Molibot macOS App Phase 4 onboarding launch-at-login step
- Replaced the guided onboarding Launch placeholder with a bilingual, default-off switch backed by the existing official Tauri autostart/LaunchAgent command. App owns the native call and passes Chat an explicit async state setter; browser preview changes only in-memory state and never writes an OS scheduler.
- Fixed the compact repair flow to start at Agent when a model exists but no Web Profile is enabled, then latch the initial onboarding mode and missing prerequisite so a successful Agent/Profile repair does not exit the guide or flip its explanation before Channels, Launch, and Diagnostics. Desktop-chat 98/98, Rust 8/8, Desktop/Web builds, and an isolated page flow through step 4 pass.

### Molibot macOS App Phase 4 onboarding Agent/Profile confirmation
- Replaced the guided onboarding Agent-step placeholder with working Web Profile and enabled-Agent selection, explicit confirmation states, and a successful-save gate before Next. The onboarding title/hint/step labels are now explicit reactive values instead of no-argument template helpers.
- Extended the credential-safe `/api/desktop/profiles` PATCH with optional `agentId`; the server validates the target Agent and updates only the selected Web Profile while preserving credentials, allowlists, sandbox/display fields, sibling Profiles, and other channels. The full desktop-chat regression passes 96/96 alongside Desktop checks/build, the existing Web build, and an isolated-data guided-shell page smoke. Profile creation and the remaining guided steps are still pending.

### Molibot macOS App Phase 4 onboarding health-check summary
- The onboarding `usable` branch (existing-but-usable config) now shows a compact migration/health-check summary card per plan §9.1: detected text model, Web Profile count, and a ready/not-ready status line. Built by a new pure `buildOnboardingHealthCheck(readiness, labels)` helper (locale-agnostic, injectable labels); card border/status color reflects readiness with text labels carrying the meaning (§14).
- Covered by 1 new api unit test (ready + missing-model + missing-profile branches); desktop-chat suite 93/93, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build re-confirmed, desktop machine-path guard clean. Desktop-only change; no Web/server source touched. Reuses already-loaded readiness data — no new endpoint.

### Molibot macOS App Phase 4 guided onboarding provider step
- The first-launch onboarding overlay is now a 5-step §9.2 guided flow for new/broken configs: provider → agent → channels → launch → diagnostics, with a step indicator, ordered step list (active/done), Back/Next/Finish navigation, and a credential-blind provider draft form (name, protocol, baseUrl, model, API-key) validated live by a new pure `validateProviderDraft`. The API key is never stored in the draft — only an `apiKeyPresent` boolean — and submit/verify is explicitly deferred (it needs the desktop capability token). `usable` configs keep the simple summary.
- Added pure helpers `ONBOARDING_STEPS`/`advanceOnboardingStep`/`validateProviderDraft`/`ProviderDraft`, bilingual i18n, and semantic CSS.
- Covered by 3 new api unit tests; desktop-chat suite 92/92, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build re-confirmed, desktop machine-path guard clean. Desktop-only change; no Web/server source touched. Provider submit/verify, the agent/channels/launch/diagnostics step forms, and on-device smoke are deferred to later slices.

### Molibot macOS App Phase 4 Runtime environment settings section
- Added Settings → Runtime environment: a read-only dependency list (ffmpeg, git, python3) with a counts card and one row per tool showing status badge, purpose, version, source, estimated size, and the exact install command. A footer notes per-item authorized installation arrives later — detection/display only, no install execution (plan §10).
- Server side: `desktopRuntimeEnv.ts` declares the optional deps, detects each via `command -v` (injectable resolver, never throws), classifies homebrew vs system source, and projects a credential/path-safe summary via `buildDesktopRuntimeEnvSummary` (drops the resolved binary path; install commands are `brew install` or `pip install --target ~/.molibot/tooling` — never `sudo`/`npm -g`). Node is omitted because the bundled sidecar already satisfies it. Added `/api/desktop/runtime-env` GET + contract types.
- Covered by 7 new server tests + 1 client helper test; desktop-chat suite 89/89, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build passed (server code touched, Web regression re-run), desktop machine-path guard clean. `/api/desktop/runtime-env` added to the Tauri HTTP capability scope. Live detection smoke and per-item authorized install execution (PATH recovery, real-time logs, cancel/retry) are deferred to a later §10 slice.

### Molibot macOS App Phase 4 first-launch onboarding overlay
- ChatView now shows a one-time, localStorage-gated onboarding overlay once the service is ready. It classifies readiness via a new pure `classifyFirstLaunch` helper into the three plan §9.1 branches: `new` (no model and no profile → full-setup guidance), `usable` (both present → ready-to-chat summary), `broken` (one but not the other → lightweight repair naming the missing piece, without overwriting config). Each branch has an Open Settings button; `usable` offers Continue, `new`/`broken` offer "Don't show again". Dismissing writes a seen-flag so it does not reappear.
- Added bilingual i18n strings and semantic CSS (`.onboarding-overlay`/`.onboarding-card`/`.primary-button`) per DESIGN.md.
- Covered by 1 new api unit test (all four classification branches); desktop-chat suite 81/81, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build re-confirmed, desktop machine-path guard clean. Desktop-only change; no Web/server source touched. Full §9.2 guided provider/agent/channel setup and the §9 migration summary are deferred to later slices.

### Molibot macOS App Phase 3 read-only external transcript pane
- Clicking an external session in the External tab now loads a read-only transcript via a new `/api/desktop/external-sessions/[id]` GET and renders it in a sidebar panel: title · chat-type · channel header, then one block per message (role label, rendered markdown, attachment names). No input, rename, delete, or archive — the external transcript stays read-only per plan §7.2.
- Server side: added `SessionStore.getExternalSession(id)` and `buildDesktopExternalTranscript` + `buildDesktopExternalTranscriptMessage`, which reuse the list session projection, drop the on-disk attachment `local` path (external attachments can't preview through the Web file endpoint), and filter out `system` control-directive messages per plan §12. Added `DesktopExternalTranscript`/`DesktopExternalTranscriptMessage`/`DesktopExternalTranscriptResponse` to the shared contract.
- Covered by 2 new server tests + 1 client helper test; desktop-chat suite 80/80, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build passed (server code touched, Web regression re-run), desktop machine-path guard clean. `/api/desktop/external-sessions/*` added to the Tauri HTTP capability scope. Live transcript smoke and the §7.3 real-time event stream / unified approvals are deferred to later Phase 3 slices.

### Molibot macOS App Phase 3 read-only external-channel view
- ChatView now has a Local/External sidebar tab. The External tab loads `/api/desktop/external-sessions` and renders grouped read-only external sessions (channel badge, chat-type, optional bot-instance/sender, time) with no input box, rename, delete, or archive — the external transcript stays read-only per plan §7.2. Loaded once on connect and lazily on tab switch; empty/loading/error states handled inline.
- Added `loadDesktopExternalSessions` client loader and pure helpers `groupExternalSessionsForView` (flattens the grouped summary into an ordered view list) and `formatExternalSessionPreview` (compact bot-instance · thread · sender one-liner), plus bilingual labels and semantic CSS per DESIGN.md.
- Covered by 3 new api unit tests; desktop-chat suite 77/77, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build re-confirmed, desktop machine-path guard clean. Desktop-only change; no Web/server source touched. Live external-session list smoke and the read-only transcript pane / real-time events (§7.3) are deferred to later Phase 3 slices.

### Molibot macOS App Phase 3 external-session aggregation (list/contract)
- Started Phase 3 external-channel read-only aggregation (plan §7.2). Extended the shared `Conversation` type with a backward-compatible optional `ExternalSessionMetadata` (bot instance id/name, sender id/name/avatar, chat type private·group·channel, thread id/title, platform) so channel adapters can populate it later; old records omit it.
- Added `SessionStore.listExternalSessions()` enumerating non-web legacy sessions newest-first (skips `web` and stale index entries).
- Added a credential-safe `/api/desktop/external-sessions` GET backed by `buildDesktopExternalSessionsSummary` that groups sessions by telegram/feishu/qq/weixin in known order (excluding `web` and `cli`), projecting only display fields. The raw externalUserId is masked to an 8-char preview, message content is never loaded, and old records without metadata fall back to `chatType=private` / `senderName=masked id` / `platform=channel` per plan §7.2.
- Covered by server `desktopExternalSessions.test.ts` (7/7) and a new `listExternalSessions` store test; desktop-chat suite 74/74, Desktop Svelte check 0 errors/0 warnings, Desktop production build passed, Web production build passed (server code touched, Web regression re-run), desktop machine-path guard clean. `/api/desktop/external-sessions` added to the Tauri HTTP capability scope. Live external-session smoke and the read-only transcript view / real-time event stream (§7.3) / unified approvals are deferred to later Phase 3 slices.

### Molibot macOS App Phase 5 GitHub Actions unsigned-DMG release workflow
- Added `.github/workflows/desktop-release.yml`, the first CI pipeline in the repo, producing the reproducible Apple Silicon unsigned-beta DMG per plan §16.1 / Phase 5. Triggered by `molibot-v*` tag pushes (publishes a prerelease GitHub Release) and `workflow_dispatch` (build-only smoke).
- On a `macos-14` runner it sets up Node 22 + stable Rust, caches Cargo, installs root and desktop deps, and runs `npm run desktop:build` (prepare pinned Node 22.23.1 sidecar runtime → `tauri build --ci` → checksum finalizer). It then writes a BUILD-INFO manifest (version, git commit/ref, build time, runner OS/arch, Node/Rust versions, macOS 13.0 deployment target, bundled sidecar Node version, explicit unsigned/no-notarization note), uploads a `molibot-desktop-dmg` workflow artifact, and on tag push publishes the DMG + `.sha256` + manifest with auto-generated release notes.
- Config-only change: no Web/server runtime code touched, so no Web regression applies. YAML validated. Actual DMG production still requires a real macOS runner (the restricted sandbox cannot run `hdiutil`/`tauri build`); end-to-end verification is deferred to a real `molibot-v*` tag build.

### Molibot macOS App Phase 4 Channels settings section
- Added a read-only Settings → Channels section grouping external channels (Telegram/Feishu/QQ/Weixin; web excluded) with per-bot-instance rows showing name, linked agent, allowed-chat count, sandbox override, and an enabled/disabled status badge, plus total/enabled instance counts.
- Backed by a new credential-safe `/api/desktop/channels` GET and `buildDesktopChannelsSummary` that drops each instance's `credentials` (bot tokens / app secrets) entirely and reduces `allowedChatIds` to a count — no channel secret reaches the WebView. Covered by server unit tests; desktop checks/build and the existing Web production build pass. Editing channel instances and live connection status are deferred (the latter to Phase 3).

### Molibot macOS App Phase 4 Memory settings section
- Added a read-only Settings → Memory section showing runtime/config enabled flags, the backend name, and backend capability flags (hybrid search, vector search, incremental flush, layered memory).
- Backed by a new `/api/desktop/memory` GET and `buildDesktopMemorySummary` that combines the memory backend config with the live `memory.isEnabled()`/`capabilities()` — it never reads memory record content (that is user data). Covered by server unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Skills settings section
- Added a read-only Settings → Skills section showing a counts card (total / enabled / by scope) plus skill-search status, and a per-skill list: name, description, scope, owner bot/chat, MCP-server count, and an enabled/disabled status badge.
- Backed by a new path/credential-safe `/api/desktop/skills` GET that reuses the shared skills route's GET and projects it through `buildDesktopSkillsSummary`, dropping each skill's `filePath`/`baseDir` (absolute paths) and the skill-search api key, and reducing `mcpServers` to a count. Covered by server unit tests; desktop checks/build and the existing Web production build pass. Enabling/disabling skills and viewing SKILL.md content are deferred to a later slice.

### Molibot macOS App Phase 4 MCP settings section
- Added a read-only Settings → MCP section showing a counts card (total / enabled / stdio / http) and a per-server list: transport, command (stdio) or URL (http), arg/env-key/header counts, an optional tool-name prefix, and an enabled/disabled status badge.
- Backed by a new credential-safe `/api/desktop/mcp` GET and `buildDesktopMcpSummary` that reads runtime settings but reduces every secret-bearing field to a count — stdio `env` values, `cwd`, and `args`, plus http `headers` — so no MCP credential reaches the WebView (the identifying command/URL is kept). Covered by server unit tests; desktop checks/build and the existing Web production build pass. Adding/editing/removing MCP servers is deferred to a later slice.

### Molibot macOS App Phase 4 Agents settings section
- Added a read-only Settings → Agents section showing a counts card (total + enabled) and a per-agent list: name, description, sandbox override (inherit/on/off), per-agent model-routing override count, and an enabled/disabled status badge.
- Backed by a new `/api/desktop/agents` GET and `buildDesktopAgentsSummary`. Agents hold no provider secrets, so the mapper projects a narrow display shape (id/name/description/enabled, a tri-state sandbox override, and a model-override count) rather than handing the WebView the full settings object. Covered by server unit tests; desktop checks/build and the existing Web production build pass. Creating/editing/deleting agents is deferred to a later slice.

### Molibot macOS App Phase 4 persisted language selection
- The Settings language choice is now validated by `normalizeLocale`, persisted to localStorage, and synced live across the Chat and Settings windows via a `storage` event, so the language survives restarts and stays consistent between windows (previously it only changed in-memory and did not propagate). Covered by a `normalizeLocale` unit test; desktop checks/build pass and no Web/server code was changed.

### Molibot macOS App Phase 4 AI Providers settings section
- Added a read-only Settings → AI Providers section showing the provider mode + built-in (Pi) provider/model and a per-custom-provider list: name (with a default badge), protocol + base URL, model count + default model, an API-key-configured flag, and an enabled/disabled status badge.
- Backed by a new credential-safe `/api/desktop/providers` GET and `buildDesktopProvidersSummary` that reads runtime settings but drops each provider's `apiKey` (replaced by a `hasApiKey` boolean) along with per-model verification details and reasoning maps — no provider secret reaches the WebView. Covered by server unit tests; desktop checks/build and the existing Web production build pass. Creating/editing/testing/deleting providers is deferred to a later slice.

### Molibot macOS App Phase 4 Tasks settings section
- Added a read-only Settings → Tasks section showing task counts (total, by type/status/scope) and a per-task list: channel/bot/chat, type, schedule + timezone, status, run count, last-triggered time, and last error.
- Backed by a new credential/path-safe `/api/desktop/tasks` GET that reuses the shared tasks route's GET and projects it through `buildDesktopTaskSummary`, dropping the task `text` (prompt content) and `filePath` (absolute disk path). Covered by server unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Host Bash settings section
- Added a Settings → Host Bash section with a counts card (pending, whitelist enabled/total, history) and a whitelist list. Each whitelist row shows tool id, display name, reason, approval mode, and a permission summary (filesystem/network/env-allowlist count) with an enable/disable toggle.
- Backed by a new credential-safe `/api/desktop/host-bash` GET + POST (toggle) and `buildDesktopHostBashSummary` that reuses `hostBashStore` but drops the `command`, raw env-allowlist key names, and channel/chat/scope ids — pending/history are reduced to counts. Covered by server unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Sandbox settings section
- Added a Settings → Sandbox section with an enable/disable toggle, the init-failure and env-inherit modes, a diagnostics card (platform supported, deps available, sandbox initialized + error, env file presence + injected/available key counts), and a network/filesystem rules card.
- Backed by a new credential/path-safe `/api/desktop/sandbox` GET + PATCH and `buildDesktopSandboxSummary` that reuses `getToolSandboxDiagnostics` but drops `envFilePath` (absolute path) and env variable key names (reduced to counts). PATCH toggles only `enabled`, preserving all other fields. Covered by server unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Trace settings section
- Added a read-only Settings → Trace section showing aggregate run-trace counts for a selectable time window (today / yesterday / last 7 / last 30 days): facts, runs, tool calls (failed/blocked), model calls (total tokens), skill usages (distinct), average tool/model durations, and coverage (bots/channels/chats/sessions).
- Backed by a new credential-safe `/api/desktop/trace` GET and `computeDesktopTraceTotals` that reads `SqliteTraceStore` but derives only aggregate counts/averages — raw fact records (payloads, args/result/error previews) and per-entity breakdowns are dropped so only counts reach the WebView. Self-contained mapper (no web code touched). Covered by server unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Run history settings section
- Added a read-only Settings → Run history section listing recent runs: a stats card (success/partial/failed counts) and one row per run with outcome badge, bot/chat id, created-at + duration + stop reason, reflection summary, and tool/failed-tool lists.
- Backed by a new credential-safe `/api/desktop/run-history` GET and `buildDesktopRunHistoryItem` mapper that reuses `readRunHistory` but drops absolute workspace/file/draft paths, the `finalText` model output, model-failure summaries, and skill-draft info — only outcome/timing/tool/summary fields reach the WebView. Covered by server and desktop unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Usage settings section
- Added a read-only Settings → Usage section showing aggregate AI usage: a totals card (requests, input/output/cache-read/cache-write/total tokens) and four time-window rows (today, yesterday, last 7 days, last 30 days) with request counts, total tokens, and date ranges.
- Backed by a new credential-safe `/api/desktop/usage` GET and `buildDesktopUsageSummary` mapper that reuses `usageTracker.getStats` but drops raw records, breakdowns, and per-model/per-bot arrays — only aggregate token/request counts reach the WebView. Covered by server and desktop unit tests; desktop checks/build and the existing Web production build pass.

### Molibot macOS App Phase 4 Web Profile settings section
- Added a Settings → Web Profiles section that lists every configured Web Profile (including disabled ones) with its linked agent name, an inline rename, and an enable/disable toggle. When no profile is enabled it shows an explicit error card — the actionable fix behind Chat's existing "Enable a Web Profile" empty state.
- Backed by a new credential-safe `/api/desktop/profiles` GET (id/name/enabled/agentId/agentName/sandboxEnabled only) and PATCH that accepts only `name`/`enabled` for a given id and preserves agentId, credentials, allowed-chat list, sandbox override, and display settings server-side via `patchDesktopWebProfile`. Covered by server and desktop unit tests; desktop checks/build and the existing Web production build pass. Create/delete and agent-linking are deferred to a later slice.

### Molibot macOS App Phase 4 Desktop Settings start: model routing
- Expanded Desktop Settings from a single General pane into a sectioned navigation and added a Models section that switches the text/vision/stt/tts/subagent model routes via the existing `/api/desktop/models` endpoint (now accepting a backward-compatible `route` parameter).
- Model options expose only key/label/context window — no provider keys or base URLs reach the WebView. Covered by `sanitizeDesktopModelRoute` and per-route `buildDesktopModelState` unit tests; desktop checks/build and the existing Web production build pass. The endpoint change is additive and backward-compatible.

### Molibot macOS App Phase 4 environment readiness summary
- Added an "Environment readiness" card to Settings → General that reports text-model and Web Profile status with ready/not-configured badges (text plus color), seeding the §9 first-launch triage signal.
- Readiness is derived purely client-side via `summarizeDesktopReadiness` from the existing `/api/desktop/bootstrap` and `/api/desktop/models` data — no new endpoint and no provider credentials reach the WebView. Covered by unit tests; desktop checks/build pass and no Web/server code was changed.

### Molibot macOS App Phase 4 Chat first-launch triage (no usable model)
- When the service is ready and a Web Profile exists but no usable text model is configured, Chat shows a non-blocking guidance banner above the composer with an Open Settings action and disables sending (composer, attach, send), while keeping existing transcript history visible.
- Reuses the tested `summarizeDesktopReadiness` for the `modelReady` signal and adds a `!modelReady` guard in `sendMessage`. No new endpoint, no credential exposure; desktop checks/build pass and no Web/server code was changed.

### Molibot macOS App Phase 4 diagnostics settings section
- Added a read-only Settings → Diagnostics section showing service version, ownership, loopback endpoint, and connection state from the existing `desktop_status`, with a sanitized "Copy diagnostics" button (no provider credentials or tokens).
- Covered by a `buildDiagnosticsSummary` unit test; desktop checks/build pass and no Web/server code was changed. Full rotating logs and diagnostic-bundle export (§11.3) remain a follow-up needing native file writing.

### Molibot macOS App Phase 4 explicit theme switch (System/Light/Dark)
- Added an Appearance selector to Settings → General (System/Light/Dark, default System), fulfilling the §8 explicit theme requirement that was previously only honored via the OS `prefers-color-scheme` media query.
- The choice is validated by `normalizeTheme`, persisted to localStorage, applied via a `data-theme` attribute, and synced live across the Chat and Settings windows through a `storage` event. Covered by a unit test; desktop checks/build pass and no Web/server code was changed.


### Molibot macOS App Phase 1 service runtime
- Added a shared data-directory service lease and versioned loopback handshake so standalone, development, and Desktop-managed launches obey the same single-owner rule.
- Added a checksum-pinned Apple Silicon Node 22.23.1 runtime and production resources, plus Tauri discovery and supervision for external/managed ownership, bounded restart, logs, menu restart, and graceful managed-child shutdown.
- Verified the packaged runtime independently, set the App minimum to macOS 13+, and added a non-interactive DMG build plus tested automatic `.sha256` finalization. The compressed DMG artifact and full App lifecycle smoke still need verification outside the restricted build environment, so this is not an installable beta release yet.

### Molibot macOS App Phase 2 local Chat slice
- Connected the independent Desktop Chat UI to enabled Web Profiles and the existing `channel=web` session store through a narrow bootstrap contract and a loopback-scoped Tauri HTTP transport.
- Added real local session list/create/select/rename/delete behavior, per-Profile last-session restoration, persisted transcript rendering, thinking-level selection, SSE token/thinking/tool-state consumption, and stop wiring to the shared Web runner.
- Added sanitized GFM message rendering and a narrow Desktop text-model selector that never returns full settings or provider credentials.
- Added temporary-data tests for Profile sanitization and session deletion, arbitrary-chunk SSE coverage, and model-response credential exclusion. Desktop Rust/Svelte builds and the existing Web production build remain green; live model streaming and the rest of the Phase 2 feature surface are still pending.

### Molibot macOS App Phase 2 current-session file panel
- Added a toggleable, read-only Desktop Chat file panel that lists the current local session's persisted attachments via the existing `/api/web/files` endpoint, with media-type filtering and automatic refresh on session switch and after each run.
- Added in-app preview (image/audio/video via loopback object URLs) and original-filename download, scoping the new HTTP capability to `/api/web/files*` on loopback only without exposing absolute disk paths. Native Finder reveal and Quick Look remain a follow-up slice.
- Added pure-function unit tests for file filtering and content-URL scoping; desktop checks/tests pass and no Web/server code was changed.

### Molibot macOS App Phase 2 run-progress timeline
- Added a collapsible live run-progress timeline inside the streaming reply that shows tool start/finish (with success/error states), subagent progress, and thread notes from the existing `runner_event`/`thread_note` SSE events, with no new server or native capability.
- The timeline is per-run and resets on send and session switch; diagnostics are never written into the persisted transcript. Covered by `parseDesktopActivity` unit tests; desktop checks/tests pass and no Web/server code was changed.

### Molibot macOS App Phase 2 inline message attachments
- Added inline attachment chips beneath each Desktop Chat message, sourced from the `attachments` already returned by `/api/sessions/[id]`, with media-type icons and the original filename.
- Matched each attachment to the loaded `/api/web/files` list by relative path to reuse the same loopback preview overlay and in-app download; agent-produced reply attachments appear after the run persists and reloads. Contract-only/desktop-only change — desktop checks/tests pass and no Web/server code was changed.

### Molibot macOS App Phase 2 file upload
- Added a composer attach control (hidden file input, removable selected-file chips) so Desktop Chat can send attachments through the existing `/api/chat` multipart endpoint and the shared Agent runner, with optimistic message echo and a reload after the turn persists.
- Routed multipart through the Tauri HTTP client (forwarding the generated boundary), scoping a new loopback-only `/api/chat*` capability. File-bearing turns use the non-streaming `/api/chat`; plain-text turns keep streaming via `/api/stream`. Covered by a `sendDesktopChatWithFiles` multipart unit test; live upload smoke is still pending outside the restricted sandbox. Desktop-only change with no Web/server code touched.

### Molibot macOS App Phase 2 Host Bash approval
- Added an in-transcript Host Bash approval card driven by the existing `host_bash_approval` SSE event, with localized just-once / session / persistent / reject actions and the pending command and reason.
- Resolved approvals through the shared `/api/chat` `/hosttools` command path (never persisted as a chat message); the server executes the decision and resumes the original run in the background, which the Desktop polls for and reloads. Covered by `parseDesktopApproval` and `hostBashApprovalSubcommand` unit tests; live approval/resume smoke is still pending outside the restricted sandbox. Desktop-only change with no Web/server code touched.

### Molibot macOS App Phase 2 session filter and transcript search
- Added a sidebar session-title filter and an in-conversation find bar that searches the current transcript with a match counter and previous/next navigation, highlighting matched bubbles and scrolling the active match into view.
- First version covers the current conversation only (no cross-session full-text index). Fully client-side, covered by `filterSessionsByTitle`/`findTranscriptMatches` unit tests; desktop checks/tests pass and no Web/server code was changed.

### Molibot macOS App Phase 2 follow-up queue and media-preview CSP fix
- Added a local follow-up queue: the composer stays usable during a run and Enter queues messages (shown as removable chips with a count) that auto-send in order once the current turn finishes; Stop clears the queue.
- Fixed the desktop CSP, which omitted `blob:` from `img-src` and had no `media-src`, so the already-shipped file-panel and inline-attachment object-URL previews would have been blocked on-device. Covered by `addToFollowUpQueue`/`nextFollowUp` unit tests; desktop checks/tests pass and no Web/server code was changed. Voice recording (§7.1) is deferred pending native WKWebView microphone permission wiring.

## 2026-06-27

### Molibot macOS App Phase 1 foundation
- Added an independent `apps/desktop` Svelte 5 + Tauri 2 workspace with real Chat and Settings windows, single-instance focus, close-to-background behavior, Dock reopen, menu-bar actions, explicit quit, and opt-in macOS login start.
- Added testable service ownership and discovery decisions for managed vs external services, compatible handshakes, occupied-port fallback, and safe quit behavior. Four Rust tests lock the rule that the App must never stop an external Molibot service.
- Added the first DESIGN-driven desktop shell with system light/dark behavior, reduced-transparency/motion support, a fixed Settings action bar, live Chinese/English switching, compact-window verification, and a pug-based Molibot macOS icon.
- This is an engineering foundation only; subsequent Node sidecar progress is recorded under 2026-06-28, and the unsigned DMG remains unreleased.
## 2026-06-23

### Per-agent dedicated models (text / vision / stt)
- Each agent can now override the text, vision, and speech-to-text model routes; everything else (TTS, compaction, subagent levels) keeps following the global routing at `/settings/ai/routing`. `AgentSettings.modelRouting` is optional and any empty key transparently follows global. The override is layered in one place — the runner wraps its `getSettings()` with `applyAgentModelRoutingOverride`, which resolves the bound agent from the workspace botId and replaces only the non-empty text/vision/stt keys — so all downstream model resolution (turn orchestration, compaction, media fallbacks) uses the agent's model without per-call-site changes, and the global settings object is never mutated. Configurable on the `/settings/agents` page (a "Dedicated Models" card reusing the `/api/settings/model-switch` route options, with a "Follow global" empty default), persisted end-to-end through the agent PUT API, sanitize, and a new `settings_agents.model_routing_json` column with an idempotent migration. The `/status` and `/models` chat commands are agent-aware too: `/status` shows the *effective* model with a `(agent: <id>)` / `(global)` source tag, and `/models` switching writes to the bound agent's override for text/vision/stt (affecting every bot linked to that agent) while tts/subagent and unbound bots still switch global — `/models <route> global` clears an override back to follow-global. Covered by new `applyAgentModelRoutingOverride` unit tests (4/4) and channelCommands `/models` agent-scope tests (25/25); store/settings suites stay green and the build passes.

### Dedicated compaction model
- Session context compaction (summarization) can now run on a model separate from the primary text model. A new `modelRouting.compactionModelKey` route lets you point summaries at a cheaper/faster model while the conversation keeps running on a stronger one; empty reuses the primary text model (unchanged default behavior). The compaction trigger threshold still keys off the *primary text model's* context window — only the summary call uses the dedicated model (`resolveCompactionSelection` in `routing/modelRouting.ts`, wired through `turnOrchestrator.compactSessionContext`). Configurable on the `/settings/ai/routing` page under the compaction settings, and persisted through schema/defaults/sanitize. Compaction/modelRouting suites stay green.

### Stream first-token timeout with model fallback
- Agent streaming runs no longer hang when an upstream model accepts the request but never starts responding. A new first-token timeout bounds the wait for the first *content* token: pi-ai's `start` (stream opened) and bare `*_start` (content block announced, no bytes yet) events keep the timer armed — the gap up to the first `*_delta` is exactly the time-to-first-token we guard — and only a real `*_delta`/`*_end`/`done`/`error` clears it, so a slow-but-alive model streams to completion untouched. On timeout the request is aborted and a retryable error is thrown, so the existing model-fallback loop switches to the next candidate, and if every candidate is exhausted the run returns an error instead of getting stuck. Default 60s (`MOLIBOT_MODEL_FIRST_TOKEN_TIMEOUT_MS`), configurable per deployment under `modelFallback.firstTokenTimeoutMs` and on the `/settings/ai/routing` page (`0` disables). Covered by `firstTokenStreamTimeout.test.ts` (5/5); runner/modelRouting suites stay green.

## 2026-06-21

### Bot Profile layering
- `BOT.md` now stacks on top of the linked agent/global `AGENTS.md` instead of replacing it, and both render in the upper operator-directives block before the default `<system-prompt>`. `AGENTS.md` renders first as the reusable base, then `BOT.md` adds bot-specific rules. Same-name identity files such as `SOUL.md`, `IDENTITY.md`, and `SONG.md` keep the existing bot > agent > global override behavior. Covered by rendered prompt regression tests, including a Feishu bot linked to an agent.

### Feishu: emoji status reactions, no card title, quoted replies
- Removed the streaming/final card header (the Thinking/Processing/Completed title). Run status now appears as an emoji reaction on the user's own triggering message: `OnIt` while working, swapped to `DONE` on success, `CrossMark` on error, `No` on abort. Added `addFeishuReaction`/`removeFeishuReaction` helpers (`im.messageReaction.*`, fixed Feishu `emoji_type` keys) — best-effort and wrapped in try/catch so a missing reaction scope never breaks a run. The card `summary` is kept for notification previews.
- Replies now always quote the user's message (not only in thread mode): `replyOptionsForEvent` sets `replyToMessageId` whenever `platformMessageId` exists, with `reply_in_thread` only for topic-sourced messages — so back-to-back questions in plain group/p2p chats are easy to match to their answers. Requires the bot's message-reaction permission scope. Covered by cardkit (6/6) and streamingSession (4/4) suites.

### Approval Convergence — Phase 2 (b): single approvals table
- Merged the two approval persistence tables (`approval_requests` + `approval_grants`) into one `approvals` table with a `type` discriminator (`request` / `grant`), and switched both access classes — `SqliteApprovalStore` (broker) and `HostBashStore` (bash-domain workflow) — to read/write it. An idempotent migration copies any existing legacy rows into the unified table on startup; the legacy tables are left in place for reversibility and are no longer created or referenced by application code. Bash-domain rows remain tagged by `capability LIKE 'bash:%'`. Covered by the approval/hostBash/channelCommands/toolRuntime/turnOrchestrator suites (61/61).

### Approval Convergence — Phase 2 (a): removed the dead broker bridge
- Removed `resolvePendingBrokerRequests` and its call sites from `channelCommands.ts`. This cross-store bridge resolved a pending ApprovalBroker request whenever a Host Bash approval was answered, but with `bash` opting out of the broker and `bash` being the only high-risk built-in classification, no built-in tool ever creates a broker request — so the bridge never reconciled a real co-pending pair. A lock test (`toolClassification.test.ts`) pins this invariant and will fail if a future non-bash high-risk tool is added, signaling that its approval must be wired explicitly. The ApprovalBroker grant model itself (used by ToolRuntime and TurnOrchestrator) is unchanged.

### Image Generation Diagnostics
- `imageGenerate` now logs provider HTTP request URLs, redacted headers, request bodies, response status, and response body previews for both settings-page tests and Agent calls. Sensitive API keys are redacted, including Google `?key=` query params and authorization headers.

### OpenAI Images Provider
- Added an `openai` image generation engine using `OPENAI_API_KEY`, `https://api.openai.com`, and default model `gpt-image-2`. `/settings/image` now includes an OpenAI Images card and backfills old image settings with the new engine key so existing saved configs keep loading.
- Added an `openai-chat` image generation engine for OpenAI-compatible `/v1/chat/completions` services. It posts a chat-completions payload and extracts image results from JSON fields, Markdown image links, plain image URLs, data URLs, or Base64 returned in the assistant message.
- `/settings/image` now gives every image provider an explicit enable/disable switch matching `/settings/video`; runtime routing ignores disabled engines even when an API key is present. Legacy image settings without per-engine `enabled` fields are backfilled from existing API keys.

## 2026-06-20

### Approval Convergence — Phase 2 first cut (ApprovalService façade, no behavior change)
- Added a unified `ApprovalService` interface (`approval/approvalService.ts`) with a broker-backed `BrokerApprovalService` adapter whose `waitForDecision` reuses the shared `pollUntilResolved` waiter. `ToolRuntime` now depends on `ApprovalService` instead of poking the `ApprovalBroker` directly (existing `approvalBroker` callers are unchanged — the option is wrapped in the adapter). Underlying stores are untouched; the Host Bash adapter and the removal of the cross-store bridge are later steps.

### Randomized Session Names
- `/new` Agent runtime sessions now use readable date-scoped IDs with a four-letter random suffix, such as `s-20260622-yush`, avoiding repeated numeric tails across different bots.
- Fresh scheduled task sessions use the same rule with a `task` prefix, for example `task-20260622-yush`, while retaining existing task-session pruning behavior.

### Web Tool Attachment Metadata
- Fixed Web Chat tool-generated attachments, such as screenshots sent via `attach`, being lost as structured session attachments. `/api/chat` and `/api/stream` now persist files uploaded through the runner `uploadFile` callback and attach their metadata to the final assistant message.
- Web attachment filenames now preserve the source extension when the display title has none, so a PNG screenshot titled without `.png` is still saved with `mediaType: image` and `mimeType: image/png`.

### Test Isolation — Runtime No Longer Boots Live Channels Under `node --test`
- Fixed agent tool/unit suites hanging after their assertions passed. Several tests transitively reach `getRuntime()` (for example the Host Bash path reads runtime settings through `buildHostEnv`), and `getRuntime()` is the full production bootstrap — it applied every channel plugin, started the task scheduler, and a 60s memory-sync interval. On a developer machine with real channel credentials this started a live Feishu websocket that retried forever (`[ws] Maximum number of redirects exceeded`), pinning the `node:test` process open so it never printed its summary or exited (affected `bash-output.test.ts`, `index.test.ts`, and any suite sharing the chain).
- Added `liveServicesDisabled()` (`app/env.ts`), gated on the `NODE_TEST_CONTEXT` runner flag (auto-detects `node --test`; never set in production) plus an explicit `MOLIBOT_DISABLE_LIVE_CHANNELS` opt-out. `getRuntime()` now skips channel application, the task scheduler, and the keep-alive memory-sync interval when live services are disabled, while still returning a fully usable runtime (settings/sessions/memory). `buildHostEnv` short-circuits to the `process.env` fallback under the same flag so host-bash unit tests don't boot the runtime singleton at all.
- Production behavior is unchanged (`NODE_TEST_CONTEXT` is never set outside the test runner). Regression covered by `app/runtime.test.ts`.

### MCP Settings Save Compatibility
- Fixed `/settings/mcp` dropping common HTTP MCP configs that provide a `url` without an explicit `type` / `transport`; these entries are now inferred as HTTP services instead of being filtered as invalid stdio services.
- Top-level MCP `headers` are now accepted and normalized into the persisted HTTP headers.
- Added `mcpInvoke`, a stable MCP dispatcher exposed only in explicit MCP scenarios. After `loadMcp` loads a server, agents can list loaded MCP tools and invoke them through `mcpInvoke` without relying on mid-run dynamic tool schema injection.
- Tool runtime wrapping now forwards abort signals and result details to wrapped tools, preserving MCP metadata such as server and remote tool names.

### Run Budget Degradation Fixes
- Fixed a cascade where hitting the tool-call budget overflowed into the tool-failure budget: budget-blocked tool calls were counted as tool failures, so a single over-budget turn (especially batched parallel tool calls) tripped the failure budget and hard-aborted the run with a generic error, bypassing the graceful no-tool continuation. Budget-blocked calls are now tracked by tool-call id and excluded from the failure count, and their repeated "budget exceeded" notices no longer spam the chat thread.
- When a run ends in an error after streaming a partial answer, the runner no longer replaces the whole message with "Sorry, something went wrong" (which discarded the visible partial). It now keeps the partial answer and appends a concise interruption note; the generic message is only used when nothing was shown to the user.

### Approval Convergence — Phase 1 (shared waiter + consolidated broker prompt, no behavior change)
- Extracted the duplicated approval polling loop shared by the two approval paths (the ApprovalBroker path in `ToolRuntime.pollApprovalRequest` and the Host Bash path in `waitForHostBashApprovalAndExecute`) into a single `pollUntilResolved<T>` primitive (`approval/approvalWaiter.ts`). Each path keeps its own store access and terminal handling in a `poll()` callback; timeouts, poll intervals, abort semantics, and inline execution are unchanged.
- Consolidated the two hand-built "broker approval card" construction sites inside `ToolRuntime` into one `buildBrokerApprovalRecord` helper (the pending card and the rejected/expired result previously duplicated the same envelope). Zero behavior change.
- First steps of the staged approval-convergence plan (see `docs/designs/agent-runtime/approval-convergence-plan-2026-06-20.md`).

### Subagent Runtime Hardening
- Subagents now run under an execution guard that reuses the parent runner's `RunBudget` and adds a wall-clock deadline. When a delegated task exceeds its tool/model budget or times out, the session is aborted and a structured stop reason (`budget_exceeded` / `timeout`) is returned instead of hanging or silently stopping. The deadline is enforced by an independent per-attempt timer (not only on session events), so an idle/stalled `session.prompt` is aborted too.
- Subagents now fall back across model candidates: `runSingleSubagent` resolves an ordered, de-duplicated candidate list (preferred route first, host model appended as a final fallback) and retries the next model on a plain model error — but not on success, abort, approval, or a budget/timeout stop. The single-route resolver is preserved for backward compatibility.
- Subagent results carry a budget snapshot, runtime stop kind, and duration, and these are threaded into the run summary (`RunSummary.subagent.tasks`) so each delegated task's budget, model, duration, and stop reason are visible in traces.

### Read Tool Schema Compatibility
- Made the built-in `read` tool's `label` input optional. File reads now validate with `path` alone, while runner hook logs still fall back to the tool name and `SKILL.md` reads continue to emit `skill.loaded` with `reason: read_skill_file`.

## 2026-06-19

### Settings Data Visibility Fix
- Fixed `/settings/agents` under production `node build` when started through the control/service path: built-in Subagent metadata now falls back to the source `subagent-agents` directory if the build chunk resource is absent, so `/api/settings/subagents` no longer 500s and the Agents page can render saved agents.
- Fixed `/settings/host-bash` for legacy persistent Host Bash grants whose `action_fingerprint` is `NULL`; whitelist rows now fall back to the capability tool id instead of throwing on `metadata.displayName`.

## 2026-06-18

### Stop Command Busy-State Release
- `/stop` now releases the channel busy marker immediately when it aborts an active runner or clears stale running state. It also marks the active run lock aborted and resets the runner instance, so the next user message starts normally instead of being queued behind a task that the user was already told had stopped.

## 2026-06-17

### Independent Control Daemon
- Added `bin/molibot-control.js`, an independent Telegram control daemon that can start/stop/restart the bare-metal service from a dedicated bot. It imports nothing from the main app, so it stays up when the main service is down and can bring a fully stopped service back online from chat.
- Control commands restricted to an admin allow-list (`MOLIBOT_CONTROL_ADMIN_IDS`); non-admin chats are silently ignored (their chat id is logged for setup). With an empty allow-list the daemon starts in discovery mode (authorizes nothing, logs chat ids) instead of refusing to start, avoiding a bootstrap deadlock.
- Two service sources: `/start` runs the release flow (`molibot-update.sh`: build latest git ref → deploy to `current` → start), `/start dev` and `/restart dev` target the local dev working tree. Dev commands run `npm run build` first (via a login shell so node/npm resolve from profile PATH) and abort on build failure; `/build` runs the build alone. `/stop`, `/status`, `/restart`, `/logs [n]` round out the set. Each command shells out to the relevant script and reports its output back to chat.
- Added `bin/molibot-control-service.sh`, a nohup-based supervisor (start/stop/status/restart, crash auto-restart) mirroring `molibot-service.sh`, to keep the control daemon alive.
- `molibot manage` now reads/writes `MOLIBOT_CONTROL_TG_TOKEN` / `MOLIBOT_CONTROL_ADMIN_IDS` in `deploy.env`, and `molibot-release.sh` bundles both new scripts into releases.
- Documented the design in `docs/designs/operations/control-daemon.md` with quick-start steps linked from the README.

### Telegram Command Menu Cleanup
- Telegram now registers a curated `setMyCommands` menu exposing only 8 everyday commands (`/new`, `/clear`, `/stop`, `/sessions`, `/status`, `/models`, `/skills`, `/help`), localized by runtime locale; registration failure warns without blocking startup.
- `/help` is now split into "Common commands" / "Advanced commands" groups, with advanced entries condensed into compact optional-argument rows.
- Non-destructive: every command handler still works (`TELEGRAM_SHARED_COMMANDS` unchanged); only the menu surface and help presentation changed.

### Telegram Rich Messages
- Upgraded `grammy` to `^1.44.0` (`@grammyjs/types@3.28.0`), which exposes Bot API 10.1 rich message methods and types.
- Telegram outbound text now prefers grammY `sendRichMessage` / rich `editMessageText` with `InputRichMessage.markdown`; rich failures fall back directly to grammY plain text sending instead of local Markdown-to-HTML conversion or local Markdown detection.
- Shared commands now emit one canonical Markdown shape across channels instead of Telegram-specific plain text: `/status` uses grouped Markdown lists, while `/help`, `/queue`, and `/skills` use standard Markdown table blocks that are handed directly to grammY/Telegram for rich rendering.
- Cleaned up the remaining multi-line command replies, including runlog, sandbox, thinking, model switching, login, sessions, queue, compact, and Host Bash approval messages, so command output uses Markdown headings, lists, command lists, and tables instead of plain single-newline paragraphs that Telegram rich Markdown can fold together.

## 2026-06-16

### Feishu Streaming Card Status Label
- The in-progress Feishu card header now shows a semantic status — "Thinking" while the model is reasoning and "Processing" otherwise — instead of the static product name "Molibot". The finalized card still switches to "Completed"/"Stopped"/"Error".

### Feishu Attachment File Type Fix
- Fixed Feishu attachments (e.g. generated `.mp4` videos) being sent as untyped generic files when a display `title` without an extension was provided. The upload filename now preserves the real file extension from the source path so videos send as native video messages, voice as audio, etc.
- Applied the fix to all three Feishu `uploadFile` paths via a shared `resolveFeishuUploadFilename` helper.

### Runlog Notice Controls
- Automatic archived-run notices are now disabled by default while run details continue to be stored.
- Added session, bot, and global controls via `/runlog on|off|reset`, `/runlog bot on|off|reset`, and `/runlog global on|off|reset`; `/runlog` still opens the latest record, while `/runlog status` is the status command.
- Added `/runlog list` for recent archived runs and expanded `/status` with runlog notice, sandbox, tool progress, and reasoning-display state.

### Feishu Topic Runlog Notice Threading
- Feishu streaming runs now send the archived runlog notice back into the originating topic/thread instead of the parent group chat.
- Added a Feishu runtime regression test covering topic-scoped archive notices.

### AGENTS Repeated-Fix Guardrails
- Analyzed recurring correction themes in `CHANGELOG.md` and extracted evergreen prevention rules into `AGENTS.md`, covering prompt/profile final-render checks, settings-page reactivity/design constraints, fine-grained settings persistence, isolated persistence tests, and cross-channel queue idempotency.
- Updated the documentation tracking files with a concise governance summary while keeping one-off bug history out of long-lived rules.

### Documentation Taxonomy
- Reorganized `docs/` by durable document purpose: requirements, designs, reviews, research, guides, and reference material now have separate top-level folders.
- Removed process-only execution plans, migration checklists, progress trackers, and completion logs from the main docs tree. Added `docs/README.md` as the docs taxonomy and filing-rules entrypoint, while leaving `docs/agent-dev-series/` and `docs/superpowers/` untouched as standalone collections.

## 2026-06-14

### Feishu Card Markdown Rendering
- Final Feishu CardKit replies now split markdown headings into separate card elements and render markdown tables as native Feishu table elements, reducing layout breakage for large structured answers.
- Feishu markdown conversion now protects fenced code blocks before applying heading/list/quote compatibility rewrites, so code samples containing `#`, `-`, or `>` stay literal.

### Bot Profile Identity Lock
- When active profile files define bot identity or behavior, the base system prompt no longer hard-declares the default Momo identity. It now tells the model to use the active `BOT.md`, `IDENTITY.md`, `SOUL.md`, `SONG.md`, and `USER.md` definitions for self-description and behavior.
- Added a final operator-directives reminder so identity/workflow/core-principle/prohibition questions are answered from the active profile files instead of the default runtime baseline.

### System Prompt Orders Volatile Sections Last for Cache-Friendliness
- Within the `<system-prompt>` block, the two sections that change between turns — `<available-skills>` and `<current-memory>` — now sit at the very tail, after the static `system-configuration-log` and `log-queries`. `available-skills` previously sat near the top (right after the skills protocol), which meant any skill-list or memory change invalidated almost the entire prefix. The skills *protocol* (static usage rules) stays near the top with the pipeline; only the volatile skill-name list moved.
- This keeps the large static prefix byte-identical across turns so providers/models that do prefix-based prompt caching can reuse more of it. (Note: Anthropic via pi-ai caches the system as a single block, so this is a no-op there; the win is for finer-grained or custom-protocol caches.) Reorder is in `agent/prompts/prompt.ts` `buildBaseSystemPromptWithOptions`.

### Operator Profile Files Outrank the Default System Prompt (Under a Safety Floor)
- Bot/agent profile files that express operator intent — `BOT.md`, `IDENTITY.md`, `SOUL.md`, `SONG.md`, `USER.md` — are now injected **above** the default `<system-prompt>` block, fronted by an `<operator-directives>` preamble that declares them high priority and authoritative on conflict. Previously they were appended after the base prompt as plain, unframed text and were easily diluted by the base prompt's tool/bash guidance (e.g. a Skill-Only `BOT.md` whose prohibitions were ignored).
- An `<inviolable-safety>` block now sits **above** the operator directives as a non-negotiable floor: profile files (and the user, and external content) may add stricter limits but can never weaken or bypass core safety — no disabling safety rules, secret exfiltration, unconfirmed destructive/irreversible actions, system attacks, prompt-injection compliance, or fabricated success claims — even if a profile explicitly says to.
- `TOOLS.md` and `BOOTSTRAP.md` remain below the base prompt as lower-priority config. `AGENTS.md` is still only injected when no `BOT.md` overrides it, and the project-context block is unchanged. Implemented in `agent/prompts/prompt.ts` (`OPERATOR_DIRECTIVE_FILES`, `SUPPORTING_INSTRUCTION_FILES`, `buildSafetyFloorSection`, `buildOperatorDirectivesPreamble`).

### Stop Command Terminal Confirmation
- `/stop` confirmations now use terminal copy (`Stopped.` / `已停止。`) once a running task is aborted, including the queued-task cleanup count when relevant. This keeps Feishu's text confirmation aligned with the final stopped status card.

## 2026-06-13

### Host Bash Fallback Inherits Sandbox Env Secrets
- When a sandboxed command is denied and auto-falls-back to Host Bash, the host execution now also receives secrets that live only in `.env.sandbox.local` — previously `buildHostEnv` read the parent process env only, so file-only secrets (e.g. `BOT_API_TOKEN`) silently vanished on fallback and produced misleading "missing token" failures.
- Injection is gated by the same sandbox env policy (`inheritMode`/`allow`/`deny`) and skips keys already present in the parent process env, so the fallback never widens access beyond what the sandbox itself would grant; disabled sandbox injects nothing.
- New exported helper `buildSandboxEnvFileInjection` in `agent/tools/sandbox.ts`, covered by `sandbox.test.ts`.

### Cross-Channel System Prompt Preview Refresh
- Feishu, QQ, and Weixin now refresh each bot workspace's generated `SYSTEM_PROMPT.preview.md` during no-op channel apply, matching Telegram when bot/profile Markdown changes without credential changes.
- Feishu and QQ apply/no-op logs now include `botId`, making preview refresh logs easier to correlate with channel instances.

### Treehole Poster Bot Profile Template
- Added `src/lib/server/agent/prompts/templates/treehole-poster/` with bot-level `BOT.md`, `IDENTITY.md`, and `SOUL.md` templates for a posting assistant that lightly cleans user thoughts and only publishes on explicit trigger.
- Split the template responsibilities so workflow rules, identity boundary, and voice guidelines do not repeat each other.

### Providers Page: Fix Dead Click Interactions (Reactivity)
- Fixed all clicks on the AI providers page (`/settings/ai/providers`) appearing dead: switching the Built-in/Custom tab did not change the sidebar list, and selecting a sidebar provider did not update the detail pane. Root cause was a Svelte 5 legacy-mode reactivity gap — the template rendered lists via bare no-argument helper calls (`{#each filteredCustomProviders()}`, `{#if getSelectedProviderInActiveTab()}`), which do not track the `activeProviderTab` / `selectedProviderId` / `providerSearch` reads happening *inside* those functions, so the blocks never recomputed.
- Introduced `$:`-derived `filteredProviders`, `selectedProviderDetail`, and `visibleModels` that reference their reactive dependencies explicitly, and switched the template to use them. The model registry also now reacts to the show-more/collapse toggle.

### Providers Page: Fix Selection Jump and Built-in Persistence
- Fixed the AI providers page (`/settings/ai/providers`) jumping to the first provider while editing a provider's **Provider ID**: the ID field is now synced with the selected provider key (and default-provider reference) instead of silently desyncing `selectedProviderId`, which previously caused the detail pane to fall back to the first listed provider and dropped the edited/new provider on save.
- `save()` now persists the currently selected provider even when it is a built-in one, so enabling a built-in provider and editing its model registry (capability tags, context window, per-model enabled toggle) actually takes effect instead of reverting on reload.

### AI Usage and Trace Pagination
- Implemented pagination for the "Request Event Details" table at the bottom of `/settings/ai/usage` and the "Recent Trace Facts" table at `/settings/ai/trace`.
- Added customizable page sizing (10, 20, 30, 50, 100 entries, defaulting to 20).
- Fully localized pagination information, selectors, and navigation buttons into both Chinese and English, reactively updating on language switch.
- Linked pagination state to filter controls so page numbers automatically reset to 1 when filters are changed.

### Trace Skill Usage Statistics
- `/settings/ai/trace` now surfaces skill calls alongside tool and model calls: added a "Skill 调用" metric card (total skill_usage facts, executed count, distinct skills) and a "技能使用排行" ranking table aggregated by skill name with triggered / loaded / executed / run / avg-duration columns.
- The trace stats API (`/api/settings/trace`) now aggregates `skill_usage` facts into per-skill summaries and totals (`skillUsages`, `executedSkills`, `distinctSkills`), reading level from `payload.level` and scope from `payload.scope`.

### CLI Readline Shutdown Guard
- Added a shared readline shutdown guard for the local CLI adapter so Ctrl+C or TTY `read EIO` closes quietly instead of throwing an unhandled Node `Interface` error.
- The CLI no longer calls `prompt()` after readline has already closed during an async message handler.

### Skill Usage Trace Phase 1
- Trace facts now record implicit skill loads when a successful `read` call opens a loaded skill's `SKILL.md`, using `reason: read_skill_file`.
- `skill_usage` facts now merge monotonically with `payload.level` and `payload.evidenceCsv`, so later weaker signals cannot downgrade a loaded skill fact.
- The durable Skill Usage Trace behavior is now documented through the product docs and Trace design notes instead of a separate progress checklist.

### Skill Usage Trace Phase 2
- Successful `skillSearch` results now emit `skill.selected` with `reason: search_match` for structurally valid matches from `details.matches`.
- Search-only skill candidates are recorded as informational triggered facts, while already loaded skill facts remain loaded and are not downgraded.
- Updated the skill usage tracking checklist to mark Phase 2 complete and keep executed attribution scoped to Phase 3.

### Skill Usage Trace Phase 3
- Skill frontmatter can now declare optional execution signals for `cli`, `mcp`, and `tools`, using either nested `signals:` metadata or flat `signals_cli` / `signals_mcp` / `signals_tools` fields.
- Runner now attributes successful post-load bash/tool/MCP calls to the most recently loaded matching skill and upgrades the skill fact to `payload.level: executed` with `cli_signal`, `tool_signal`, or `mcp_signal` evidence.
- Executed attribution is recorded as heuristic evidence only; triggered, loaded, and executed facts continue to merge monotonically through `payload.evidenceCsv`.

### Sidebar Emojis & Label Toggle
- Upgraded the 5 abstract primary sidebar symbols to intuitive high-fidelity Emojis (`🏠`, `🤖`, `💬`, `💾`, `⚙️`).
- Added a labels toggle button (`🏷️`) at the bottom of the sidebar to collapse/expand menu names alongside the icons.
- Persisted layout options in `localStorage` and added a CSS transition for smooth sidebar expansion, matching footer offsets.

### Reactive Multi-Language (i18n) Settings Support
- Fully migrated all 24 settings sub-pages to support complete reactive translation (English/Chinese) driven by the `$locale` store.
- Replaced MutationObserver-based translation (`localizeSettings`), resolving bugs where dynamic inputs, modals, and tables did not update on language switch.
- Standardized toggles to use the `IosSwitch` component and fixed footbars (`.settings-footbar`) across all migrated pages.

### Settings UI Redesign & Design System Alignment
- Refactored 11 settings sub-pages (`/settings/agents`, `/settings/memory`, `/settings/memory-rejections`, `/settings/skills`, `/settings/skill-drafts`, `/settings/run-history`, `/settings/tasks`, `/settings/host-bash`, `/settings/system`, `/settings/sandbox`, `/settings/plugins`) to align with Warm Shadcn theme and `/settings/web` style standard.
- Replaced custom layout styles and raw Tailwind CSS classes with semantic custom classes (`channel-page`, `channel-card`, etc.) to match `DESIGN.md`.
- Converted all configuration toggles to use the `IosSwitch` component instead of native input elements.
- Pinned configuration save/reset buttons to the sticky bottom footer bar (`.settings-footbar`) to simplify long form interactions.

### Scheduled Task Fresh Sessions & Auto Cleanup
- Scheduled events now support `sessionMode: "fresh" | "chat"`; periodic tasks default to fresh, so each run starts in a new `task-` session without accumulated chat history (big input-token saving for daily reports), while replies in the chat still land in that session for follow-up tweaks.
- Expired task sessions are pruned automatically on each fresh-session creation, controlled by `events.taskSessionRetentionDays` (default 7 days, 0 disables; env `MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS`). Active and user-created sessions are never pruned.
- `createEvent` tool accepts `sessionMode`; all four channels (telegram/feishu/weixin/qq) route event runs through a shared session resolver.

## 2026-06-12

### Subagent Trigger Observability & Scenario Widening
- Run summaries now persist subagent telemetry (delegation notice sent, invoked, per-task agent/mode/stopReason/duration/error), making subagent usage auditable from `run-summaries.jsonl` instead of console logs only.
- Subagent trigger guidance widened from "codebase-heavy" to "file/shell-heavy" (log/data analysis, long documents, multi-file artifacts) in the system prompt and delegation runtime notice, with an explicit rule not to delegate steps needing parent-only tools (webSearch, imageGenerate, attach).

### Feishu Video Attachment Delivery
- Feishu outbound `.mp4` files now upload as `file_type: mp4` and send as native `media` messages instead of being transcoded into OPUS voice messages.
- Feishu inbound `media`/video resources now download through the media resource path and are saved as video attachments; `.mp4`, `.webm`, and `.mov` filenames no longer infer audio MIME types.

### Video Generation Response Logging
- `videoGenerate` now logs provider response status and response body for both successful and failed HTTP calls, so provider-side errors can be diagnosed from runtime logs.
- Video provider request headers are now redacted before logging, preventing Bearer/API keys from being printed in terminal logs.

### File Tool Hardening (read/write/edit/bash)
- edit: fixed silent corruption when newText contains `$&`/`$'`/`` $` `` (JS replacement patterns are now inserted literally); added `replaceAll` parameter; ambiguous matches now report the match count; identical oldText/newText is rejected early; CRLF files are matched LF-normalized and written back with their original line endings.
- read: rewritten to read via fs instead of spawning `wc`/`cat`/`tail`; fixed off-by-one total line count for files with trailing newlines; binary files are rejected with a clear error; images larger than 5MB are rejected instead of flooding the context.
- write: reported byte count now uses actual UTF-8 bytes instead of character count; removed dead path-normalization condition.
- bash policy: hard gate added — standalone shell file reads (`cat`/`head`/`tail`/`less`), shell file writes (`echo > f`, heredocs, `echo | tee`), and in-place editors (`sed -i`/`perl -i`/`awk -i inplace`) are denied with a redirect message to the read/write/edit tools; compound pipelines and concatenation remain allowed.
- bash tool description now instructs the model to prefer the dedicated read/write/edit tools over shell equivalents (`cat`, heredocs, `sed -i`, etc.), reserving bash for operations those tools cannot express.
- Removed dead duplicate `truncateTail` from tool helpers (the UTF-8-safe version in truncate.ts is the single implementation).

### Sandbox Writable Roots & Idempotent Approval Replies
- Sandbox now allows writes to the whole molibot data dir (`~/.molibot` by default) and the workspace dir, so scheduled tasks and services that write inside the data dir are no longer blocked; per-bot scratch remains the working directory.
- Temp directories are now allowed via their resolved real paths too (`/tmp` → `/private/tmp`, `os.tmpdir()` → `/private/var/folders/...`), fixing "Operation not permitted" for tools with hard-coded temp paths (e.g. longbridge's `/tmp/longbridge-logs`).
- Clicking an approval card again (or re-sending an approval reply) after the request is resolved now reports the actual outcome (approved/executing/executed/failed/rejected/expired) instead of "No matching pending Host Bash approval found."

### Host Bash Approval Interaction Fixes (Blocking Approval Gate)
- Approval cards/prompts now show at most the first 100 characters of the command instead of the full text (up to 4000 chars).
- Host approval is now a true blocking gate inside the agent run: the bash tool call waits on the approval store (up to 10 minutes), and once approved it executes the host command inline and returns the real output as the tool result — the run keeps streaming instead of ending with "waiting for approval" and resuming later. Rejection/expiry resolve the tool call immediately; only a wait timeout falls back to the old approve→execute→resume flow.
- Removed the double approval gate: bash `hostApproval` requests no longer also pass through the ApprovalBroker, so one approval click/reply is enough.
- Approval replies/clicks settle immediately: the card flips state right away while the waiting run (or, with no active run, a claimed background executor) runs the command; results and failures are reported to the chat.
- Added an atomic execution claim (`executing` status + `claimExecution`) so the in-run waiter and the channel approval handler can never both execute the same approved command.
- Fixed `isRunActive` to look up running runs by session (run ids are `chatId-sessionId-messageId`, so the old scope-id lookup never matched), plus a delayed fallback executor so approvals landing after the wait timeout are not dropped.
- Bridged Host Bash approvals to the agent ApprovalBroker for the remaining broker-gated tools; text approval replies (本会话允许 / 永久允许 / 拒绝 …) now work even when only a broker request is pending — fixing runs that ended in "User approval timeout" despite the user approving.

### Sandbox Host Bash Approval UX Overhaul
- Tightened sandbox-failure detection to OS-sandbox signatures only, eliminating spurious auto host-approval requests from ordinary command failures.
- Unified approval prompts to explicit scopes: once / session / persistent / reject, identical semantics across Feishu cards, Telegram keyboards, text replies, and `/hosttools` (new `approve-once` subcommand). Plain "approve" is now least-privilege (run once, no whitelist).
- Persistent approval of a compound command now whitelists every capability it contains in one click.
- Pending approvals expire after 60 minutes, and a new request for the same capability retires the older pending card; identical commands still dedupe to the existing request.
- Generic tool-approval path now shows the real command and uses collision-free request IDs.

### Profile Scope Consistency (bot > agent > global)
- Made `BOT.md` a true bot-level override of `AGENTS.md` in system prompt assembly: when a bot defines `BOT.md`, the agent/global `AGENTS.md` section is no longer injected alongside it, eliminating duplicated content after bootstrap.
- Restricted the `profileFiles` tool's agent-scope fallback to files the agent scope actually carries (`AGENTS/SOUL/IDENTITY/SONG`); `USER.md` and `TOOLS.md` now fall back straight to global, matching prompt assembly.
- Deduplicated profile file-name lists: the tool reuses `BOT_PROFILE_FILES`, prompt assembly reuses `GLOBAL_PROFILE_FILES`, and the editable-body normalizer is shared from `profiles.ts`.
- Hardened bot-root resolution in `profileFiles` to truncate paths to `/bots/<botId>`, and documented the per-file fallback chain (incl. global-only `BOOTSTRAP.md`) in the tool description.
### Agent Hook Framework Hardening & Pluggability
- Gate hooks now fail closed: a gate hook that throws or times out denies the guarded action (`HOOK_GATE_FAILURE`) instead of silently allowing it; hooks can opt into `failMode: "open"`.
- Observe event queues are now isolated per run, so a slow hook in one run no longer delays others; `flush()` accepts a `runId` and the runner drains its own queue with a longer timeout at run end. Emit payloads are snapshotted via `structuredClone`.
- Enabled the transform pipeline by default and wired it into the runner: transform hooks can rewrite enriched input text (`input.enrich.after`) and the system prompt (`prompt.build.after`).
- Fixed TraceRecorderHook state leaks with per-run nested maps plus a 1-hour TTL sweep for runs that never receive `run.finished`.
- Added a hook plugin registry (`registerHookPluginFactory` + `settings.plugins.hooks`) so external observe/transform/gate plugins can be enabled per settings entry; plugin hook ids are namespaced and unregistering flushes in-flight events before destroy.
- Added typed stage payloads (`StagePayloadMap`), a cached stage→hooks index, a shared `NOOP_HOOK_MANAGER`, and marked not-yet-emitted stages as reserved.

## 2026-06-11

### Adapter-node SQLite Build Warning Cleanup
- Added a project-local adapter-node variant that marks `node:sqlite` as external during the adapter's final Rollup pass, removing the unresolved-import notices at the end of `npm run build`.
- Tightened the declared Node requirement to `>=22.5.0`, matching Molibot's use of built-in `node:sqlite`.

### Centralized DB Directory
- Added `${DATA_DIR}/db` as the default SQLite database directory and moved default settings, inbound queue, outbox, and Mory SQLite paths under it.
- Added startup migration for legacy root-level SQLite files, including WAL/SHM sidecar files, while preserving explicit operator-provided database paths.

### Feishu Multi-Bot Mention Ownership
- Tightened Feishu group mention gating so a bot instance only responds when the message mentions that bot's resolved identity. Mentions of other bots are ignored, and missing bot identity no longer falls back to responding to any group mention.
- Switched Feishu bot identity probing to `POST /open-apis/bot/v1/openclaw_bot/ping` first, matching the openclaw-lark SDK path. The old `bot/v3/info` endpoint remains a fallback because it can return `code: 0` with empty identity fields for these apps.
- Stopped Feishu queue workers from duplicating inbound tasks when a stale/busy run blocks processing, preventing runaway inbound queue growth and reducing SQLite lock pressure on startup.
- Restored shared inbound queue cleanup so completed, failed, cancelled, and startup-abandoned tasks are deleted from SQLite instead of retained as terminal rows.
- Kept private chat and bot-participated thread continuation behavior unchanged, with focused intake regression coverage for current-bot mentions, other-bot mentions, missing identity, and known-thread continuation.

## 2026-06-10

### Global Profile File Write Guard
- Removed `resolveGlobalProfilePath` auto-rerouting from `resolveToolPath` so profile file names (e.g., `SOUL.md`) are resolved relative to the caller's base directory rather than unconditionally routed to `dataRoot/`.
- Hardened `createPathGuard` to **block** direct read/write/edit tool access to global profile paths (`dataRoot/{AGENTS,SOUL,TOOLS,BOOTSTRAP,IDENTITY,USER,SONG}.md`), requiring the dedicated `profileFiles` tool for any profile file management. This prevents bot-scoped edits from accidentally landing on global profile files.

## 2026-06-08

### Feishu Bot Health Check & Thread Continuation
- Added `POST /api/settings/feishu/test` and a `/settings/feishu` connection test panel that validates current Bot credentials against Feishu Bot info without sending test messages or requiring a permission matrix.
- Added conservative Feishu group thread continuation: main group messages still require `@bot`, while threads the Bot has participated in can continue without mentions and keep their own session/queue/log scope.
- Routed Feishu thread replies through `im.message.reply` with `reply_in_thread` for text, cards, CardKit streaming, and outbound file fallback paths.

### Built-in TTS Generation
- Added a built-in deferred `ttsGenerate` tool with a dedicated TTS settings page (`/settings/tts`), macOS system voice support, Xiaomi MiMo TTS support, configurable voices/models, artifact saving, and automatic chat upload.

## 2026-06-07

### System Prompt Skill Routing Cleanup
- Merged the duplicated `Skill Routing (Mandatory)` prompt section into the existing message pipeline and skills protocol while preserving explicit skill invocation, authoritative skill file paths, output-medium handling, and fallback rules.
- Replaced the stale static `SYSTEM_PROMPT.preview.md` sample with a placeholder pointing auditors to the live generated prompt preview, preventing old manual event-JSON scheduling guidance from being reused.
- Added rendered prompt length regression coverage, corrected the refactor plan's verification commands to the actual Node test runner, and isolated ToolRuntime workspace whitelist tests from the real settings database.

### Runtime Log Hook Consolidation
- Replaced the built-in `DebugLogHook` with `RuntimeLogHook`, a HookManager observer dedicated to centralized runtime log output.
- Moved duplicate runner lifecycle/tool logs (`run_start`, `run_end`, `tool_start`, `tool_end`, `tool_call_blocked`) behind hook events while preserving run detail archives and UI runner events.
- Enriched tool hook payloads with display labels so terminal logs keep the same readable tool names after hook-based logging.

### Expanded Trace Fact Coverage
- Extended trace facts beyond `tool_call` and `model_call` to include `run`, `skill_usage`, `subagent_task`, `runtime_notice`, `approval`, and `input_enrichment`.
- Added runner hook emissions for input enrichment, subagent task progress, Host Bash approval requests, and key runtime notices so those facts have real runtime sources.
- Updated `/settings/ai/trace` filtering and summaries so new fact types appear in recent facts without being counted as model requests.

### Trace Facts Model Usage Alignment
- Added a runner-level fallback that emits `model.call.after` with assistant `usage` at message completion, so `/settings/ai/trace` model facts now retain input/output/cache/total token details even when provider response hooks did not carry usage.
- Split trace model attempt IDs per real model API request inside one Agent prompt, so tool-result continuation calls are stored as separate `model_call` facts instead of overwriting the first request.
- Kept `/settings/ai/usage` and `/settings/ai/trace` as separate data stores while aligning them through run/session/model-attempt trace facts.
- Added total-token fallback calculation in TraceRecorder when providers omit explicit totals.

## 2026-06-06

### Channel Settings Pages Restyling & Fixed Footer
- **Semantic CSS Classes**: Replaced all inline Tailwind utility classes in channel settings pages (web, telegram, weixin, feishu, qq) with `.channel-*` semantic CSS classes defined in `settings-custom.css`, following DESIGN.md CSS class naming conventions.
- **Fixed Footer Bar**: Added `.settings-footbar` fixed footer to all channel pages with save/reset buttons pinned to viewport bottom, matching the MCP page pattern.
- **Switch Conversion**: Converted Checkbox toggles to Switch components for enable and streaming output controls across all channel pages.
- **MCP Footer Cleanup**: Removed remaining Tailwind utility classes from MCP settings page footer, adding `.settings-footbar-saving`, `.settings-footbar-pulse`, and `.settings-footbar-actions` semantic classes.

### SQLite Settings Migration & Fine-grained APIs
- **Database Migration**: Moved `webSearch` (search configurations), `imageGenerate` (image settings), `videoGenerate` (video settings), and `toolSandbox` (sandbox directories allowlist/denylist) from `settings.json` to the key-value SQLite table `settings_dynamic`.
- **Merged Key-Value Store**: Abandoned the creation of 7 separate tables in favor of serializing settings as JSON strings stored under keys: `settings_web_search`, `settings_image_generate`, `settings_video_generate`, and `settings_sandbox`.
- **One-off Configuration & Table Migration**: Implemented automatic migration in `SettingsStore` during startup. Legacy configs in `settings.json` as well as any existing legacy SQLite tables (e.g., `settings_web_search`, `settings_sandbox`, etc.) are read, converted to key-value rows in `settings_dynamic`, and cleaned up.
- **Unified Dynamic API Route**: Added a unified, parameter-driven dynamic settings endpoint at `/api/settings/dynamic/[key]` supporting `GET` (read), `PUT`/`POST`/`PATCH` (write/update). Frontend settings pages (search, image, video, sandbox) are refactored to fetch and save their individual configurations via this targeted route, completely bypassing the obsolete monolithic query and individual PUT routers.

### AI Providers Page Switches & Model Enable Save Fix
- **Independent custom-providers Endpoint**: Extended `/api/settings/custom-providers` with `GET` and `PUT` methods. Refactored the AI Providers settings page (`/settings/ai/providers`) to fetch and save its configurations using this dedicated endpoint, completely removing monolithic settings API queries and updates from the page.
- **Shadcn iOS Switch Toggles**: Replaced the custom HTML checkbox elements for provider enabled status and individual model enabled status on the AI Providers page (`/settings/ai/providers`) with unified iOS-style `Switch` components from the shadcn-svelte UI library.
- **Model Enable Save Bug Fix**: Resolved an issue where toggling individual models off in the list would not persist. Extended `ProviderModelConfig` in `schema.ts`, added proper mappings inside the page Svelte `save()` function, and updated sanitization and store logic in the server settings modules (`sanitize.ts`, `store.ts`) to carry and persist the `enabled` field. Also corrected `ensureProviderDefaults` to prevent dropping the `enabled` field during mapping normalization, and updated `addModel`, `confirmAddModel`, and `addDiscoveredModel` to default-initialize `enabled: true`.
- **Model Selection & Routing Filter**: Implemented `enabled !== false` filters in `modelRouting.ts` and `modelSwitch.ts` to ensure that custom models toggled off are excluded from routing alternatives, default selections, and settings routing dropdown options.
- **Svelte 5 a11y & Compiler Warnings Fixed**: Resolved Svelte compiler accessibility (a11y) warnings on `providers/+page.svelte`, `image/+page.svelte`, and `video/+page.svelte` by making modal backdrops self-targeted dialogs, removing click handlers from static modal cards, labeling icon-only close buttons, and adding a valid captions track to the video preview.

### Agent HookManager Runtime Extension & Trace System
- **Pluggable HookManager**: Implemented a multiplexed `HookManager` layer on top of `pi-agent-core` callbacks to dispatch hook events asynchronously (non-blocking) to observe, gate, and transform hooks.
- **Built-in Telemetry Plugins**: Added `DebugLogHook` for console diagnostic logging and `TraceRecorderHook` backing event traces into a local SQLite store (`agent_trace_events` table with sequential `seq` auto-increment ordering) isolating states by `runId`.
- **Unified Trace Facts**: Added `agent_trace_facts` as a single analysis table for both `tool_call` and `model_call` facts, with queryable columns for session/run counts, tool names, statuses, model identity, durations, and token usage.
- **Trace Analytics Settings Page**: Added `/settings/ai/trace` and `/api/settings/trace` to inspect trace facts with time-window, Bot, channel, chat ID, session ID, run ID, fact type, and source-limit filters, plus tool/model token/Bot/channel-chat/session/run summaries and recent fact rows.
- **Preflight Gate Interceptions**: Supported gate net interceptions in `MomRunner` before tool preflight and execution budget checks, emitting `tool.call.blocked` with `blockedBy: "hook_gate"`.
- **Clean Registry Integration**: Injected `hookManager` dependency throughout all channels (Telegram, Feishu, QQ, WeChat, Web) and wired up runner pools/runtimes without introducing API regressions.
- **Lifecycle Hardening**: Ensured `run.finished` is emitted once for early Runner exits, passed real runtime settings into plugin initialization, and kept the observe queue alive after critical observer failures.

### Settings Pages Hero Header Compact Unification
- **Header Size Reduction**: Reduced title size from `2rem`/`1.875rem` to `1.375rem`, description text to `0.8125rem` (13px), and inner gap from `0.75rem` to `0.375rem` across all settings pages (including the 8 core AI pages and 16 Tailwind inline pages) to yield a much cleaner and space-efficient viewport layout.
- **Top Spacing Fix**: Adjusted Svelte container wrappers inside `.settings-viewport` to override default padding-top values (from `5rem` or `2.5rem` down to a unified `0.5rem`), eliminating redundant top empty areas.

### Settings Pages Footer Full-Width Fix & Style Extraction
- **Full-Width Footer**: Converted footer divs (`<div class="settings-footbar">`) to HTML5 semantic footers (`<footer class="settings-footbar">`) on all AI-related settings pages (Routing, Providers, Errors, MCP, Search, Video), resolving the narrow width issue caused by `.settings-viewport > div` overrides.
- **CSS Style Extraction**: Removed all Svelte `<style>` scoped blocks from settings page `.svelte` files and consolidated them into the global stylesheet `src/styles/settings-custom.css`, which is imported globally in `src/app.css` to prevent inline head generation.
- **Inline Style Cleanup**: Replaced inline styles on the Search settings page test alert with a `.search-test-result[data-tone="success"]` utility class.

### AI Settings Pages Styling Unification & Center Alignment
- **Centered Layout**: Refactored the page content containers for all AI-related settings pages (`routing`, `providers`, `usage`, `errors`, `mcp`, `search`, `image`, `video`) to align centered (`margin: 0 auto;`) in the viewport.
- **Full-Width Fixed Footer**: Relocated the sticky bottom save/reset fixed footer (`.settings-footbar`) outside the centered page container wrappers, allowing it to stretch across the full width of the viewport.
- **Hero Headers Unification**: Removed `SettingsSection` layout wrappers from the Providers (`/settings/ai/providers`) and Image (`/settings/image`) settings pages, replacing them with custom serif hero headers (`.providers-hero`, `.image-hero`) matching the AI Routing page's look and feel.
- **Video Settings Page Refactor**: Restructured `/settings/video` to wrap parameters in a `<form id="video-form" ...>` and relocated the save button from the card bottom to the sticky bottom fixed footer (`.settings-footbar`) aligned with other settings pages.

### Telegram Video Attachment Filename Preservation
- Preserved source file extensions for Telegram media uploads when `attach` supplies a title without an extension, so generated MP4 videos upload as names like `title.mp4` instead of extensionless titles.
- Added `supports_streaming: true` to native Telegram `sendVideo` uploads.
- Added regression coverage for extension preservation in `runtime.test.ts`.

### Settings Pages Styling Refactor (errors/mcp/search)
- Refactored `/settings/ai/errors`, `/settings/mcp`, and `/settings/search` to match the custom Warm Shadcn design system, removing the legacy `.wb-` styling classes in favor of serif headings, `var(--card)` backgrounds, and `var(--border)` borders.
- Replaced the `SettingsSection` layout wrappers on these pages with custom scoped Hero header structures.
- Implemented sticky bottom save/reset bars (`.settings-footbar`) for MCP and Search routes linked to `<form>` submit events, and moved the refresh action in the Errors page to the bottom footer.
- Switched manual toggle switches in the MCP servers list and search engines list to the native `<Switch>` component with Svelte 5 bindability.

### Image Generation SQLite Logging, Settings History & Sticky Footbar
- Added a new `image_tasks` SQLite table storing image generation records (Task ID, engine, session ID, status, prompt, local path, remote URL, request parameters, error message, and timestamps).
- Modified the `imageGenerate` tool to generate a unique UUID and record task creation as `processing` before executing, updating the record to `completed` or `failed` at completion.
- Added `/api/settings/image-generate/tasks` API endpoint to retrieve recent tasks and delete records by Task ID.
- Added `/api/settings/image-generate/image` serving endpoint to stream local image files or redirect playback/download to the provider's remote `imageUrl` if local files are missing.
- Added a "Recent Generations" table to `/settings/image` showing creation time, Task ID, engine, prompt, and status.
- Added "View Result" (pop-up displaying metadata and image with download functionality), "View Params" (displaying request parameters), and "Delete" actions to the task list.
- Refactored the image settings submission form to use a sticky bottom bar (`.settings-footbar`) to house the save button and status message in accordance with `DESIGN.md` design principles.
- Updated unit tests in `imageGenerateTool.test.ts` to mock database initialization, verify tool execution writes task records to SQLite, and assert properties of the task record.

### Remote Video URL Storage, Redirect Streaming & Request Parameters Logging
- Removed automatic client-side video file downloading from both the SvelteKit background task poller and the `videoGenerate` tool query execution to prevent connection reset failures (like `ECONNRESET` on Google Cloud Storage) from marking successful tasks as failed.
- Dynamically migrated the SQLite settings database to add `video_url` and `request_params` columns to the `video_tasks` table.
- Made `videoGenerate(taskId, engine)` treat SQLite as the first status source: completed records return the cached remote URL immediately, fresh processing records return cached progress for 30 seconds, and stale processing records perform one provider status query before writing the result back to the database.
- Logged the exact request parameters (prompt, model, images) sent by the Agent/tester upon task creation.
- Added a `302 Found` HTTP redirect in the SvelteKit video streaming endpoint `/api/settings/video-generate/video` to transparently route playback/download requests to the remote `videoUrl` if the local file is missing.
- Updated `/settings/video` page UI tasks table list and details modal to render inline previews, handle direct downloads using the redirect endpoint and `videoUrl`, provide a "View Params" (查看参数) action button directly in the table actions list, and display request parameters inside a scrollable copyable JSON block.
- Updated unit tests in `videoGenerateTool.test.ts` to assert that completion updates the database with `videoUrl`, returns `Remote URL` instead of `unknown` local paths, skips remote video downloads, and normalizes string/JSON-string `images` inputs.


### Image Path Visibility & Robust Parameter Normalization
- Added `Remote URL: https://...` to the successful return text and details of `imageGenerate` whenever the provider returns a public image URL, while keeping local saved paths for archive/debug use.
- Made automatic chat upload failures non-fatal for `imageGenerate`: generated images now still return their Remote URL/local path plus an upload error note when Telegram or another channel fails to send the file.
- Upgraded `videoGenerateSchema` to support both `Type.Array(Type.String())` and `Type.String()` for the `images` parameter.
- Normalizes `params.images` at runtime: JSON-stringified arrays (e.g. `'["/path/to/img"]'`) are parsed, and single strings are wrapped in arrays, preventing iteration errors on characters of a string.
- Changed `videoGenerate` image references to require public HTTP(S) URLs and reject local paths or Base64/data URLs before submitting to providers. This matches Agnes Video's public-image-URL requirement and lets the Agent use the `Remote URL` from `imageGenerate` for image-to-video.
- Added comprehensive unit tests in `imageGenerateTool.test.ts` and `videoGenerateTool.test.ts` to assert Remote URL output, stringified URL arrays, single URL strings, and pre-submit rejection of local/data URL image references.

### Video Generate Public URL Validation & Poller Fault Tolerance
- Fixed a bug where remote video generation services (Agnes AI and Volcengine/Doubao) failed to generate videos from local reference images or Base64/data URLs because video providers require publicly reachable image URLs.
- `videoGenerate` now rejects local paths and Base64/data URLs before submitting the task payload, and tells the Agent to use the `Remote URL` returned by `imageGenerate`.
- Added strict public URL checks for reference images, preventing invalid requests from being sent to the cloud.
- Formatted structured error objects returned by Agnes AI (containing both code and message) into serialized strings, avoiding SQLite parameter binding crashes when updating failed task records.
- Implemented poller fault tolerance in the background tasks SvelteKit poller, marking the task as `failed` in the SQLite database after 3 consecutive failures (or when hitting a terminal HTTP 4xx response) to prevent infinite loops of failing requests.
- Added test coverage in `videoGenerateTool.test.ts` to verify remote image URL passthrough plus local path and Base64/data URL rejection before provider submission.

### Telegram Streaming Long-Message Chunk Reuse
- Fixed Telegram streaming answers repeatedly creating a new second message after the answer crossed the text limit.
- The answer lane now retains all chunk message IDs, edits existing chunks on later stream refreshes, creates only newly required chunks, and removes obsolete trailing chunks when the answer becomes shorter.
- Added regression coverage for consecutive chunk refreshes and chunk-count reduction.

### Video Query Bypass Optimization
- Optimized the `videoGenerate` tool execution path when querying status: the tool now performs a pre-check query on the local SQLite task database.
- If the task record is already in a finalized state (`completed` or `failed`), the tool immediately returns the cached state and locally saved video file path (performing a channel file upload if `uploadFile` is available) instead of making a redundant query to the third-party provider API. This prevents errors like `fetch failed` from interrupting the session when completed tasks expire on third-party servers.
- Added comprehensive unit test coverage in `videoGenerateTool.test.ts` to assert that completed tasks return the cached status immediately without invoking the remote HTTP client.

### Telegram Native Video Message Support & MIME Optimization
- Fixed a bug where MP4 videos containing audio tracks were mistakenly classified as `audio/mp4` during binary header sniffing (which looks for the `ftyp` signature). This caused videos to be sent via the `sendAudio` pathway, rendering them as audio-only messages in Telegram.
- Introduced `detectVideoMime` in `TelegramManager` to extract video MIME types for `.mp4`, `.webm`, and `.mov` extensions, and updated `detectAudioMime` to exclude files ending in these extensions.
- Configured `uploadFile` to send identified video MIME files using Telegram's native `bot.api.sendVideo` API, ensuring inline video playback and native downloads in the chat, falling back to `sendDocument` upon failure.
- Added test coverage in `src/lib/server/channels/telegram/runtime.test.ts` to verify accurate detection of both audio and video files.

### Video Settings Task ID Display
- Added a new "Task ID" column to the "Recent Generation Tasks" table on the `/settings/video` page.
- Rendered task IDs using a compact, copy-friendly `font-mono` format and the `select-all` helper class, so operators can quickly select and copy the identifier to query task progress manually inside chat threads.

### Video Results Inspection & Test Isolation
- Isolated the unit test SQLite database for `videoGenerateTool.test.ts` by adding a `taskStore` option to `createVideoGenerateTool`. This directs mock task creations to a temporary SQLite file inside the test's scratch directory, preventing the real user `settings.sqlite` database from being polluted with test entries during dev/build cycles.
- Created `/api/settings/video-generate/video` endpoint to stream saved local video files safely by task ID.
- Added a "View Result" button for completed and failed tasks on the `/settings/video` page, triggering a dialog summarizing task ID, prompt, engine, local file path, or error logs, and featuring a built-in HTML5 video player to play generated videos inline.

### Compact Tool Progress Copy
- Shortened `toolProgress = "new"` running-state text from `⏳ 正在运行: <tool>...` to `⏳ <tool>...`, leaving more horizontal space for the actual tool name.
- Added a focused `displayFormatter.test.ts` regression test to lock the compact output format.

### Image Generation Settings Optimization
- Added support for custom Model ID configurations per provider (Agnes, Google Imagen, Volcengine, ModelScope) in the `/settings/image` UI and the backend `imageGenerate` tool context.
- Removed individual engine `enabled` flags from the schema and UI. Engines are now dynamically resolved as enabled simply by detecting a configured, non-empty API key, aligning backend routing with simplified user experience.
- Implemented full `zh-CN` / `en-US` translation support, responsiveness, and dark-mode adaptation for the entire `/settings/image` interface.
- Updated unit tests in `imageGenerateTool.test.ts` to assert that settings routing correctly ignores explicit engine-level enablement checks and routes traffic based purely on API key configuration presence.

## 2026-06-05

### Settings Overview Redesign
- Redesigned the `/settings` overview page from a flat 14-card grid to a grouped 4-card dashboard (AI Intelligence, Messaging, Knowledge, System) matching the Warm Shadcn design sample.
- Added Lucide icons (Cpu, MessageSquare, BookOpen, Settings) and Shadcn Badge section counts to each feature card.
- Used serif typography for the page title and feature card headings per DESIGN.md editorial style.
- Added compact subsection links inside each card with hover-reveal arrow navigation.
- Full zh-CN/en-US localization and dark mode support for the new layout.

### Settings Layout Header Redesign
- Replaced the sidebar header from "Configuration Workspace + Settings" large text to a centered brand dot + serif "Settings" title + compact "Back to Chat" pill button, matching the Warm Shadcn design sample's primary sidebar style.
- Changed the top bar from "workspace title + page name" to a breadcrumb pattern "Settings › [Current Page]" with theme/language selectors and "Open Chat" on the right.
- Added semantic CSS classes (`.settings-sidebar-header`, `.settings-topbar-breadcrumb`, etc.) following DESIGN.md naming conventions.
- Preserved mobile collapsible navigation dropdown with updated styling.
- Removed unused `workspaceTitle` i18n key.

### Settings Navigation Menu Restyle
- Changed nav link style from `rounded-xl border text-xs` card-like to `rounded-sm text-sm` borderless list matching the design sample's `nav-item` pattern.
- Updated active state to use `accent-soft` background + `accent` text color + inset border shadow, matching the design sample's active icon style.
- Replaced group title `uppercase tracking` with normal-case 12px labels and a ▾ chevron that rotates on collapse.
- Moved all nav styles to semantic CSS classes (`.settings-nav-link`, `.settings-nav-group-title`, etc.) in the `<style>` block, removing Tailwind inline strings from `navLinkClass()`.

### Built-In Video Generation Tool
- Introduced native Agent-layer tool `videoGenerate` supporting Agnes Video and Volcengine (Doubao Seedance) engines.
- Implemented a dedicated configuration UI at `/settings/video` supporting custom model configurations per provider, enable toggles, API keys, custom base URLs, and en-US/zh-CN localization.
- Added live testing console to `/settings/video` coupled with the `/api/settings/video-generate/test` backend endpoint to validate credentials and render generated videos in the web interface.
- Integrated the video settings entry under the "AI Engine" group of the settings workspace layout.
- Added async polling handlers for task-based video generation with aspect-ratio mappings, duration limits, download automation, sandbox path-guard controls, and automatic channel media upload routing.
- Added comprehensive unit tests in `videoGenerateTool.test.ts` covering task creation, status polling, file downloads, and parameter verification.
- Implemented non-blocking asynchronous task execution: immediately registers tasks in SQLite database upon submission, returns the taskId to the Agent, and releases the turn without holding the connection.
- Added background polling API that performs periodic queries, downloads finished videos, updates task records, and outputs detailed HTTP request and response logs (including URL, request body, and response body) to the server console.
- Configured frontend settings UI to trigger background polling at a 30-second interval instead of 4 seconds to optimize traffic while keeping status indicators updated.

### Feishu Approval Card Terminal State
- Changed completed Feishu approvals to edit the original button card into a terminal result card, avoiding Feishu withdrawal time limits for approvals handled minutes or hours later; text is sent only when editing fails.
- Deduplicated concurrent HTTP/WebSocket callbacks and later repeated clicks by request ID so one approval action executes once and all callbacks reuse the same button-free result card.
- Replaced the pending-confirmation title with a clear processed-approval title on terminal cards.
- Returned a button-free processing card within Feishu's three-second long-connection callback window, then edited the original card to the final result after background execution.
- Extended shared approval auto-resume waiting from about five seconds to one hour so approvals wait for an active session to finish instead of immediately asking for another user message.
- Stopped sending approved Bash stdout/stderr and resume progress as standalone chat messages; command results now return through the Agent tool context and appear only in the Agent's final response.

### Reliable Bash Stop Finalization
- Fixed `/stop` so an aborted bash/Agent prompt terminates the current run instead of being retried as an empty model response or continued through model fallback.
- Skipped blocked UI queue flushing after abort and cleared pending progress updates so sessions return to idle after the command process is killed.
- Preserved partial assistant text produced before cancellation without converting the cancelled run into a generic error.

### Concise Approval Confirmation Copy
- Reduced Host Bash approval prompts to the action, complete command, and three clear decisions: approve, allow for this session, or reject.
- Removed internal request IDs, classifier details, permission dumps, and implementation explanations from chat approval prompts while retaining them in the approval records.
- Reused the same concise prompt across interactive approval cards and non-interactive text channels.

### Global Command Response i18n
- Persisted the Settings language selection as a global runtime locale.
- Localized shared channel commands and Web Chat command responses for `zh-CN` and `en-US`.
- Added locale-aware help, status, model, skill, session, queue, runtime-control, sandbox, and display-control responses.
- Removed OAuth login/logout entries from shared-channel and Web Chat help catalogs without removing the commands.

## 2026-06-04

### Built-In Image Generation Tool
- Added native `imageGenerate` tool in `imageGenerateTool.ts` and registered it as a deferred agent tool.
- Supported multi-engine API integrations: Agnes-Image-2.0-Flash, Google Imagen, Volcengine (Seedream), and ModelScope.
- Standardized settings configurations mapping `AGNES_API_KEY`, `GOOGLE_API_KEY`, `VOLCENGINE_API_KEY`, and `MODELSCOPE_API_KEY` environment variables.
- Configured automated download, sandbox path validation, and channel upload integrations, making generated images instantly viewable in chat interfaces.
- Added `/settings/image` dedicated settings UI and a live test generation panel mapping to `/api/settings/image-generate/test` backend endpoint.
- Added comprehensive unit tests in `imageGenerateTool.test.ts` covering provider execution, base64 decoding, task polling, and file saving.
- Fixed legacy settings startup compatibility, honored the configured default image engine, and routed settings-page test outputs to Molibot data storage instead of the project directory.
- Fixed Agent routing so image generation/editing requests in any language are recognized by intent and load `imageGenerate` through `toolSearch select:imageGenerate` before skill search, bash scripts, or ad-hoc skill creation.
- Fixed image settings normalization so a configured default image engine with an API key is treated as enabled even when older settings carried `enabled: false`; clarified the per-engine enabled switch in `/settings/image`.


### Host Bash URL and Helper Classification Fix
- Fixed Host Bash classification so quoted URL query strings such as `agent-browser open "https://example.com/search?q=..."` no longer trigger the glob-expansion one-time approval path.
- Treated static `cd <path>` wrappers and simple `echo DONE` markers as safe helpers around approved capabilities, while dynamic paths such as `cd "$HOME"` remain one-time scripts.
- Added focused regression tests for quoted URL queries, unquoted glob tokens, safe `cd` / `echo` wrappers, and dynamic `cd` degradation.

### Telegram Overlong Edit Chunking
- Unified Telegram text chunking and formatting fallback logic in the shared formatting layer instead of keeping separate send/edit implementations.
- When `editMessageText` now fails with `MESSAGE_TOO_LONG`, Molibot edits the first chunk in place and sends the remaining chunks as follow-up messages instead of terminating the run.
- Thread-aware Telegram send options are forwarded into the follow-up path so forum-topic replies stay in the same thread.

### System Prompt Boundary Refactor (P0 & Sandbox Cleanup)
- Compressed event management, scheduler, and tool-search details in the system prompt (`prompt.ts`), routing cron and confirm rules to the deferred tool schemas.
- Merged the previously scattered global behavioral guardrails into one `Core Directives` section, including processed-input handling for pre-transcribed voice and pre-analyzed images.
- Refactored sandbox descriptions from low-level OS implementation details (like `sandbox-exec` and `bubblewrap` paths) to concise model decision boundaries.
- Aligned `bash` tool description and parameter schema metadata to reflect runtime-managed sandbox boundaries and hostApproval reason instructions.
- Added regression tests in `prompt.test.ts` and `bash-output.test.ts` to enforce the refactored system prompt rules and prevent sandbox implementation detail leaks.

## 2026-06-03

### Deferred Web Search Deduplication
- Kept `webSearch` in the deferred registry but stopped exposing its lightweight top-level stub, so loading it through `toolSearch` no longer produces duplicate `webSearch` tool names in provider requests.
- Added a focused regression assertion for the deferred-only `webSearch` exposure path.

### Cloudflare HTML File-Path Uploads
- Changed the built-in `publishHtml` plugin tool to accept a local file path instead of raw HTML content.
- Runtime now reads and validates the HTML file internally before uploading to Cloudflare R2, reducing token/context pressure for large pages.
- Kept normal workspace path-guard enforcement and added focused regression coverage for file-based uploads.

### Deferred Tool Registry Alignment
- Added `webSearch` to the runtime deferred tool registry so `deferredEntries` now matches the prompt's `<available-deferred-tools>` list.
- Added a prompt-source regression assertion to keep `webSearch` listed in the deferred-tools block.

### Shared Python Tooling Runtime
- Moved the Agent bash shared Python environment to `~/.molibot/tooling/python/venv`, with pip, uv, and temp directories contained under `~/.molibot/tooling/python`.
- Updated sandbox write allowances and runtime prompt guidance so Python tasks reuse the shared environment instead of creating per-skill `.venv` directories.
- Updated the onlinestool runner script to self-anchor to its skill directory and use the shared Python environment.

### Web Search Query Robustness
- Stopped prepending full current date/time text to every provider query; live lookups now keep concise user keywords unless a date is explicitly useful.
- Added tolerance for weak model tool arguments such as `route: "\n\"auto\"\n"` and `engine: "\n\"auto\"\n"` to prevent repeated webSearch validation failures.
- Changed China-local search fallback to prefer webpage references before provider-generated summaries, reducing the risk of uncited summaries driving final answers.
- Updated prompt wording and regression tests around date-aware search guidance, concise queries, and route ordering.

## 2026-06-02

### Host Bash Compound Command Classification
- Added a conservative Host Bash command classifier that distinguishes reusable capabilities from safe shell glue/helpers and one-time-only scripts.
- Reduced unnecessary one-time approvals for compound commands such as `longbridge ... 2>&1 | head -30` and same-tool chains like `agent-browser ... && sleep 3 && agent-browser ...`.
- Persisted classification metadata into Host Bash approval audit records and surfaced it on `/settings/host-bash` so operators can see the capability, ignored safe helpers/glue, or one-time degradation reason.
- Added focused regression coverage for classifier behavior and approved compound Host Bash execution paths.

## 2026-06-01

### Host Bash Auto-Resume Lock Recovery
- Hardened shared Host Bash approval auto-resume so a transient `Another run is currently active in this session.` conflict no longer crashes Telegram or other shared-text runtimes.
- Added short retry/release polling before the background resume turn is abandoned, plus a user-visible busy fallback message when the session lock does not clear in time.
- Added focused regression coverage for retry-on-lock-conflict and fail-fast behavior on non-lock resume errors.

### Built-In Web Search Tool
- Added a shared Agent-layer `webSearch` tool so current-information lookups no longer depend on loading a reusable skill.
- Added configurable provider settings for DuckDuckGo, Brave, Tavily, Exa, Serper, Baidu Qianfan, and Bocha, with route-based fallback now centered on China-local, global, official-docs, and research search intents.
- Extended the built-in provider list to match the local `web-search` skill scripts by adding `baidu_fast`, `baidu_web`, `ark`, and `grok` to shared settings, routing, and runtime provider execution.
- Added `/settings/search` with shadcn-svelte controls for tool enablement, default routing, engine credentials, timeouts, max results, and live test queries.
- Added automatic engine selection strategies for `engine=auto`: priority order, random, and in-process round-robin across configured engines.
- Added redacted request diagnostics to `/settings/search` test results so operators can inspect the actual provider URL, method, headers, and body used by a search attempt.
- Exposed each provider's effective default base URL in `/settings/search` when the custom base URL field is left empty, using the same shared constants as the runtime providers.
- Added focused tests for search routing, result normalization, and runtime tool risk classification.
- Refined the `webSearch` tool prompt so model answers include a mandatory `Sources:` section, use current-year queries for recent information, and prefer automatic routing unless a specific source or region is needed.
- Upgraded normalized search responses with source-level citations, per-result citation ids, provider metadata, and summary source tracking while preserving the existing `summary` text contract.
- Preserved richer provider fields such as request ids, usage credits, site names, favicons, publication dates, and Baidu/Bocha provider reference ids when available.
- Fixed Baidu Fast search normalization so provider answers are retained even when source references are also returned.
- Updated `/settings/search` Test Query to let operators force a specific engine and inspect the exact `WebSearchResponse` payload returned by `runWebSearch()`.
- Removed Ark from the visible search settings UI while keeping the shared runtime/provider support unchanged underneath.
- Added automatic current date/time context to every runtime web search provider request while preserving the user's original query in `WebSearchResponse.query`, improving relative-time searches such as tomorrow weather, latest prices, and today's news.
- Updated the system prompt Tools Priority Table and tool parameter guidance so current web lookups use the dedicated `webSearch` tool instead of bash curl, browser search, or legacy skill scripts.

### Feishu Local Approval Buttons
- Added `card.action.trigger` handling to the Feishu WebSocket runtime so Host Bash approval buttons work for local-only Molibot instances without exposing `/api/feishu/card` publicly.
- Kept the existing HTTP card callback route for public deployments while reusing the same shared Host Bash approval command path, with a generic Approval Broker fallback for tool approval cards that are not backed by Host Bash records.
- Accepted common Chinese approval replies such as `审批通过` and `通过` as direct approval commands instead of queuing them as normal chat messages.
- Logged Feishu card button delivery with `card_action_received` so callback delivery/configuration issues are easier to distinguish from approval resolver failures.
- Added fallback behavior that edits the original approval card to the result state, or sends a text result when card editing fails.
- Added focused test coverage for Feishu card action payload normalization.

### Local Runtime Persistence
- Added a LaunchAgent plist template for running Molibot under macOS `launchd` with `RunAtLoad` and `KeepAlive`, avoiding foreground terminal session shutdowns.

## 2026-06-04

### Scheduled Event Late-Success Retry Suppression
- Stopped `EventsWatcher` from emitting a duplicate retry for the same periodic slot when the first attempt exceeds the nominal timeout but still finishes successfully before the watcher fully unwinds.
- Added a regression test covering the timeout callback plus late-success completion path so long-running scheduled jobs do not produce a second synthetic event after already delivering output.

## 2026-05-31

### Scheduled Event Timeout, Abort, and Retry
- Added a SQLite-backed event execution lease store so scheduled tasks have shared ownership state across watcher, runner, and persisted run records.
- Added configurable event execution controls: 10 minute default timeout, 3 max attempts, and 5 second retry delay.
- Wrapped watched event execution with a timeout watchdog that aborts the current runner/turn before scheduling a retry.
- Added stale running lease recovery on watcher startup so a process restart does not permanently block a scheduled event slot.
- Scoped event leases by channel/bot, reconciled recovered leases back to event JSON state, and made timeout retry wait for the previous runner attempt to release before starting the next attempt.
- Updated `/stop` shared runtime handling to clear active event leases, reducing false `Nothing running.` responses for stuck scheduled runs.
- Passed lease run ids through Telegram, Feishu, QQ, and Weixin event-trigger paths for consistent run/lease correlation.

### Host Bash Full Access When Sandbox Is Off
- Changed the `bash` policy so an effective `/sandbox off` state means Host Bash full access: ordinary bash commands and model-supplied `hostApproval` parameters now run directly on the host without creating a Host Bash approval request.
- Kept the existing sandbox-on approval model: explicit Host Bash requests and sandbox permission failures still produce approval prompts while sandboxing is enabled.
- Added regression coverage for the sandbox on/off policy split, sandbox-disabled host execution, and approved Host Bash paths bypassing sandbox shell execution.
- Updated the session-control guide and README to make the sandbox/approval boundary explicit.

### Separate Reasoning Messages & Latest Progress Mode
- Added `/showreasoning new` across settings, sanitization, commands, and the System settings UI.
- Split reasoning display from final answer rendering for Telegram and Feishu, so visible thinking no longer prefixes or buries the actual answer.
- Updated Telegram streaming so `thinking_delta` refreshes only the reasoning message while `text_delta` refreshes the answer message; `new` mode shows only the latest reasoning sentence and deletes the temporary progress message at completion.
- Updated Feishu streaming so reasoning uses a separate editable text message while the answer remains in the CardKit streaming card; `new` mode closes the temporary reasoning message with a short completion notice.
- Added a Feishu streaming regression test for separate reasoning messages.

### Main Answer Lifecycle & Display Commit
- Added explicit main-answer commit semantics to the runner/channel context boundary. If a model returns multiple terminal assistant messages in one turn, Molibot now shows them as separate user-visible messages instead of letting the last one overwrite the earlier full answer.
- Updated shared text channels, Telegram, and Feishu streaming paths to freeze committed main answers and route later text as supplements instead of replacing the original answer.
- Added a shared context regression test covering committed-answer replacement behavior for non-editable channels.

## 2026-05-30

### Weixin SDK Upstream Upgrade & Context Token Persistence
- **SDK Protocol Sync**: Upgraded vendored `package/weixin-agent-sdk` to match the latest `openclaw-weixin` upstream, selectively migrating messaging-related improvements while keeping the SDK free of OpenClaw plugin dependencies.
- **Context Token Disk Persistence**: Context tokens (required for every outbound Weixin message) are now persisted to `{accountId}.context-tokens.json` on disk and restored automatically on startup, surviving gateway restarts.
- **Account Cleanup Enhancement**: `clearWeixinAccount` now removes associated `.sync.json` and `.context-tokens.json` files alongside the main credentials file.
- **Already-Connected Login Handling**: QR login now gracefully handles the `binded_redirect` status (bot already bound), resolving existing local credentials instead of throwing a login failure.
- **Markdown Filter No-Op**: `filterWeixinMarkdown` is now a transparent pass-through since Weixin natively supports Markdown rendering.
- **Node 24 Compatibility**: Removed manual `Content-Length` header from `buildHeaders` in `apiPostFetch` to avoid conflicts with Node 24 / undici's automatic content-length calculation.
- **Weixin Long-Poll Abort Completion**: Completed the remaining `apiPostFetch` abort merge path so `getUpdates` now honors external `AbortSignal` cancellation immediately during channel stop or hot reload, instead of waiting for the long-poll timeout.

### Browser Automation Timeout Configuration
- **Settings UI**: Added a "Browser Automation" configuration card in Settings → System. Users can now adjust the `agent-browser` (Playwright) default timeout directly via the Web UI without editing `.env` or restarting the service.
- **Display, Reasoning, & Sandbox Settings Configuration**:
  - **Display & Reasoning**: Added a "Display & Reasoning" card in Settings → System to configure model thinking process display (`showReasoning`), tool progress details level (`toolProgress`), and notification limits (`gatewayNotifyInterval`) globally.
  - **Sandbox Security Toggle**: Added a "Tool Sandbox Security" card in Settings → System to easily toggle the OS sandbox for bash command execution (`toolSandbox.enabled`), along with a quick link to the detailed Sandbox Policy page.
- **Environment Variable Injection**: `buildHostEnv` in `hostBashExec.ts` now automatically injects the configured timeout as `AGENT_BROWSER_DEFAULT_TIMEOUT`, so all `agent-browser` commands inherit the setting.
- **Default Changed**: Default timeout increased from 25s to 60s to resolve timeouts on slower-loading sites (e.g. feishu.cn). Range clamped to 5s–300s.

### Message Return & Display Layout Optimization
- **Unified DisplayFormatter logic**: Extracted a centralized Markdown message formatter class [displayFormatter.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/displayFormatter.ts) supporting thinking/reasoning blocks, tool progress, and subagent state outputs.
- **Bot Instance Display Settings & Commands**: Added `display` settings configuration (`toolProgress`, `showReasoning`, `gatewayNotifyInterval`) to the global and channel instance schemas. Developed two new independent commands `/toolprogress` and `/showreasoning` in [channelCommands.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/commands/channelCommands.ts) to read and write database-backed configurations scoped to the active Bot/Channel instance. Implemented SQLite table migrations (`display_json` column) and static settings serialization mapping to ensure configurations are fully reboot-resistant. Documented both display settings and sandbox overrides in the new unified user guide [session-control-commands.md](docs/guides/session-control/session-control-commands.md).
  - Refactored Telegram runner and Feishu card streaming session to consume the new `DisplayFormatter`. Integrated progress overrides into QQ and Weixin `processEvent` execution loops: if `toolProgress` is configured as `"off"`, the transient runner progress messages (`_→ tool_` logs) are entirely discarded. Introduced a memory `messagesBuffer` in WeChat and QQ runtimes to batch all progress updates, running state details, run archive notifications, errors, and final response blocks. The buffer is concatenated with double newlines and sent in a single consolidated chat bubble once the execution finishes, or when a file is uploaded or sensitive approval is triggered, avoiding multiple bubble spam.
  - Added sandbox override controls (`/sandbox [session|bot|agent] [on|off|reset]`), `/toolprogress`, and `/showreasoning` commands to the default `/help` command text.
  - Restored Telegram and Feishu auto-resume flow by returning execution orchestration to `baseRuntime.ts`'s unified `executeApprovedHostBash` wrapper. Enhanced session approval regex support for natural Chinese variations (e.g. "允许本轮", "本会话允许", "本轮允许").
  - Fixed a Telegram bug where the final progress message (e.g. `⏳ 正在运行: bash...`) remained permanently visible in `"new"` mode; it is now deleted automatically when the runner completes.
- **Host Bash Approval Scope Resolution Bug Fix**: Fixed a critical bug where approvals for plugins/MCP tools (like `agent-browser`) written by `ToolRuntime` under a UUID `run_id` could not be matched by channel command queries filtering strictly on the chat's `scopeId`. `HostBashStore` now dynamically queries using active `sessionId` fallbacks, resolving execution freezes across Web and IM channels.

### Subagent Depth Propagation & Authentication Boundary Documentation (Review Optimization Tasks 4 & 5)
- **Subagent Approval Depth Propagation**: Added `requestedByDepth` parameters to `createSubagentTool()` and propagated it dynamically by incrementing depth `(options.requestedByDepth ?? 0) + 1` in host approval payloads to ensure correct subagent caller depth visibility.
- **Actor Authentication Boundary Clarified**: Added descriptive inline documentation inside `TurnOrchestrator.prepareTurn()` to define the auth boundaries of turn operations. Clarifies that external actors are authenticated/authorized at the channel runtime level, and TurnOrchestrator only archives their normalized `message.userId` as `actor_id` for session auditing.
- **Test Session Isolation & Mock Alignment**: Resolved runner unit test flakiness caused by hardcoded `"session-1"` collisions on the persistent sqlite settings database by using randomized test session IDs. Fixed mock store signatures in unit tests to include `getSessionSandboxOverride: () => null`.

### Sandbox Multi-Level Control & Approval Auto-Resume
- **Granular Control Chain**: Introduced override resolution hierarchy supporting `Session Override > Bot Instance Override > Agent Override > Global Default`. Allows enabling or disabling sandboxing on specific sessions, bots, and agents dynamically.
- **SQLite Settings Migrations & Storage**: Added `sandboxEnabled` flags to schemas, sanitizers, and settings routes, implementing automatic SQLite database table column updates (`ALTER TABLE ... ADD COLUMN sandbox_enabled INTEGER`) for channels and agents upon server startup. Full configuration load/save mapping and Switch override UIs have been implemented across Web, Telegram, Feishu, QQ, and Weixin settings pages to avoid silent data loss when saving configurations.
- **Terminal Control Command**: Implemented the `/sandbox` chat command supporting real-time status diagnostics and scope configuration overrides (e.g. `/sandbox session off`, `/sandbox bot on`, etc.).
- **Automatic Resume Flow**: Completed automatic resumption flow for approved commands. Re-writes message history (replacing the temporary approval result placeholder with the real stdout/stderr) and fires a background runner execution (using `isEvent: true` flags) once a sensitive bash command is approved.
- **Dedicated Environment isolation**: Integrated tooling path resolution under `MOLIBOT_TOOLING_DIR` (defaulting to `~/.molibot/tooling`). Built-in shell runner dynamically isolates venv, GOPATH, and GOCACHE within this directory instead of creating temporary virtual environments for every single session.

### Named Sandbox Profiles (Sandbox Profiles)
- **Defined Sandbox Templates**: Introduced three pre-defined sandbox configuration templates (`Observe` read-only mode, `Build` read-write compilation mode, and `Strict` maximum isolation mode) mapping security settings onto environment, network, and filesystem policies.
- **Dynamic Profile Matching & Detection**: Implemented client-side detection to dynamically match active settings with standard profiles. Automatically displays a "Custom Profile" notice if the user alters any individual configuration field in the form.
- **Interactive UI Preset Selector**: Embedded a styled three-card selector group at the top of the `/settings/sandbox` page with smooth hover focus scales, subtle elevation shadows, and active outlines using shadcn-svelte conventions.
- **Chinese & English Localization**: Supported full translation mappings for preset titles, configuration descriptions, custom badges, and status labels in both `zh-CN` and `en-US`.

### Configurable Agent Run Budget Limits
- **Schema & Configuration Store Expansion**: Added `budget: RunBudgetLimits` property to `RuntimeSettings` interface and `schema.ts`. Introduced support for environment variables `MOLIBOT_MAX_TOOL_CALLS`, `MOLIBOT_MAX_TOOL_FAILURES`, and `MOLIBOT_MAX_MODEL_ATTEMPTS`.
- **Sanitization & Clamping Protection**: Implemented custom validation/clamping rules inside settings store and `sanitizeSettings` to automatically restrict user-configured variables to safe ranges (e.g. tool call limits between `1` and `500`).
- **Agent Runner Budget Integration**: Updated `runner.ts` to instantiate `RunBudget` dynamically using the SvelteKit settings store's configured limits instead of the hardcoded `DEFAULT_RUN_BUDGET` constant.
- **Web UI & Localizations**: Created a dedicated "Agent Budget Limits" configuration panel under `/settings/system` settings, allowing administrators to modify limits via the browser with full en-US and zh-CN localizations.

### Agent runner.ts Slimming & Input Enrichment Extraction (v2.2 Phase 5)
- **Top-Level Helper Functions Extraction**: Extracted 16 utility/helper functions from `runner.ts` into a new modular file `runnerHelpers.ts`.
- **Inbound Message Enrichment Extraction**: Extracted audio transcription (STT) routing, vision/image routing fallbacks, and model candidate fallback resolution logic into `runnerInputEnricher.ts`.
- **`runner.ts` Footprint Reduction**: Refactored `MomRunner` to import helper utilities and delegate input preparation to `prepareEnrichedInput`. Completely removed the legacy `blockedOnHostBashApproval` pausing and agent abort logic to transition fully to the new coroutine-blocking model, shrinking `runner.ts` to 1693 lines.
- **`RunnerPool` Isolation**: Decoupled `RunnerPool` from `runner.ts` into `runnerPool.ts` and updated imports in `channelCommands.ts`, `baseRuntime.ts`, and `runtimeContext.ts`.
- **Type Integration & Safety**: Added explicit exported TypeScript interfaces (`AudioRouteDecision`, `VisionRouteDecision`, `ImageFallbackRouteDecision`) to `mediaFallback.ts` to ensure type-safe interfaces across core runner modules.

### Approval Integration & Compatibility Hardening (v2.2 Phase 3D)
- **Tool Coroutine Blocking & Polling**: Implemented a 5-minute timeout polling loop inside `executeToolCall` in `toolRuntime.ts` to suspend the coroutine while waiting for user approval.
- **1.5s Debounce Aggregation**: Added 1.5-second debounce aggregation for `low` and `medium` risk approvals in `toolRuntime.ts` to combine high-frequency operations into a single card prompt.
- **Compatibility Prefix Mapping**: Adjusted host bash tool capability to start with `bash:` (e.g. `bash:${toolId}`), aligning with the old `LIKE 'bash:%'` SQLite filters to restore correct rendering in control commands and setting pages.
- **Parallel Execution Prevention**: Updated `channelCommands.ts` (`approveHostTool` and `approveHostToolForSession`) to verify if the runner is currently active (`status = 'running'`) before executing approved commands, preventing duplicate execution.
- **Abort Signal Integration**: Added `signal` to `ToolExecutionContext` and updated `tools/index.ts` to propagate it, allowing blocked tool coroutines to abort immediately if the runner is canceled.
- **Approval-Pause Decoupling**: Decoupled the old `waiting_for_approval` abort mechanism from `runner.ts`, allowing the runner to stay active (`running = true`) and properly hold the turn lock while suspended in-coroutine. Rewrote `runner.test.ts` to verify event forwarding under this non-aborting flow.

---

## 2026-05-29

### Legacy ACP Cleanup & Workspace Policy Enforcement (Sprint A)
- **Legacy ACP Physical Deletion**: Moved the legacy ACP (Agent-Channel Proxy) module to `package/acp/` as a relocatable external dependency. Deleted the `src/lib/server/acp/` and `src/routes/settings/acp/` directories, and the `src/lib/server/channels/telegram/acpProgress.ts` file from the main application paths.
- **Config & Settings Decoupling**: Removed all ACP targets, projects, and approval mode schemas, sanitizers, default values, and serialization properties from SettingsStore and the RuntimeSettings interface.
- **Subpath Imports Mapping**: Registered `#acp/*` mapping to `./package/acp/src/*` in `package.json` imports.
- **Feishu Logic Cleanup**: Cleaned up the unused `AcpPendingPermissionView` import and card generators (`buildFeishuAcpPermissionCard`/`buildFeishuAcpPermissionResultCard`) from Feishu messaging.
- **Workspace Security Policies**: Implemented runtime workspace policy checks for tool executions and skill loading. `ToolRuntime.executeToolCall` validates toolId against the workspace's `enabledToolIds` whitelist, and `loadSkillsFromWorkspace` filters skills according to `enabledSkillPaths`.
- **Regression Verification**: Added unit tests in `toolRuntime.test.ts` and `skills.test.ts` to verify whitelist enforcement. All 25/25 agent tests passed successfully.

### Pluggable Sandbox Runtime Module Refactoring
- **Decoupled Sandbox Interface**: Introduced the `SandboxProvider` interface and generic config type shapes (`SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxRuntimeConfig`) inside `sandbox.ts` to decouple sandbox executions from the Anthropic Sandbox SDK.
- **Anthropic Sandbox Wrapper**: Enclosed the default `@anthropic-ai/sandbox-runtime` SDK integration inside `AnthropicSandboxProvider`, which implements the new `SandboxProvider` interface.
- **Registry and Dynamic Selection**: Added getter and setter helper registration functions (`getSandboxProvider()` and `setSandboxProvider()`) to support dynamic switching of sandbox runtimes. Refactored preparation and diagnostics helpers in `sandbox.ts` to delegate actions to the active provider.
- **Mock Verification Test**: Added unit test in `sandbox.test.ts` to verify mock provider registration, execution interception, config propagation, and restore isolation. Verified 100% green tests in the agent regression suite.

### ToolRuntime & ApprovalBroker Integration (v2.2 Phase 3)
- **MCP Tool Safety Wrapping**: Modified MCP tool loader in `runner.ts` and `index.ts` to dynamically wrap loaded MCP tools under `ToolRuntime`. Labeled their source as `"mcp"` when their name is prefixed with `mcp__`.
- **Subagent Approval Bubbling**: Propagated parent `runId` from `createMomTools` down to subagents in `subagent.ts` as the `scopeId`. Set `requestedByDepth: 1` during subagent tool approval creation to bubble up permissions.
- **Approval Depth Tracking**: Updated `HostBashStore` SQLite wrapper and `bash.ts` to accept and persist `requestedByDepth` into the `approval_requests` SQLite table, facilitating context tracking of subagent execution vs parent run execution.
- **Verification**: Verified zero compilation errors and full 100% pass rate in both the 25/25 agent test suite and the 5/5 approval/broker test suites.

### TurnOrchestrator Lifecycle Delegation & runner.ts Slimming (v2.2 Phase 2)
- **Lifecycle Delegation**: Delegated turn lifecycle duties—specifically session concurrency locking, memory sync/snapshots preparation, and context compaction—to `TurnOrchestrator`.
- **Session Locking**: Implemented database-backed session locking in `TurnOrchestrator.prepareTurn()` to prevent concurrent active turns in the same session, with a 10-minute auto-release timeout.
- **Memory Snapshot Integration**: Extracted memory sync (`syncExternalMemories`) and snapshot fingerprinting to `TurnOrchestrator.prepareTurnMemory()`.
- **Context Compaction**: Extracted context compaction flow (calculation, model completion, and saving results to session store) to `TurnOrchestrator.compactSessionContext()`.
- **Turn Summary Committing**: Relocated `commitTurn()` to `TurnOrchestrator` to log `RunSummary` and update SQLite run statuses (`completed`, `aborted`, `waiting_for_approval`, `failed`).
- **`runner.ts` Refactoring**: Refactored `MomRunner` to delete these helper functions, reducing its codebase footprint while keeping the client interfaces (`MomRunner.run` and `RunnerPool`) intact.
- **Test Coverage**: Added robust unit tests in `turnOrchestrator.test.ts` verifying concurrent locking, expiration timeouts, memory prep, and status committing. Passed the entire regression suite (25/25 suites green).

### Agent Module Restructuring & Verification (Step 5)
- **Folder Clustering & Modularization**: Relocated and grouped all 60+ cluttered files in `src/lib/server/agent/` into dedicated functional subdirectories: `core/`, `routing/`, `prompts/`, `tools/`, `skills/`, `session/`, `identity/`, `common/`, and `commands/`.
- **Absolute and Relative Path Updates**: Corrected all module imports in JS/TS and Svelte pages workspace-wide to use the structured paths via the SvelteKit `$lib` alias.
- **Node.js ESM Test Loader Hook**: Created `scripts/md-loader.js` and `scripts/register-loader.js` to register a custom Node.js ESM load hook during testing, converting Vite `?raw` markdown templates into valid JS ESM modules on the fly to bypass `ERR_UNKNOWN_FILE_EXTENSION` crashes.
- **Regression Bugs Resolved**:
  - Implemented automatic directory creation (`mkdir(..., { recursive: true })`) in `write.ts` to prevent `ENOENT` crashes when writing scratch artifacts.
  - Adjusted context compaction threshold check from strictly greater than (`>`) to greater than or equal to (`>=`) in `compaction.ts`, resolving compaction tests.
  - Fixed relative URL depth for templates loading in `self-evolution.test.ts` (updated `../../../../` to `../../../../../` due to nested directory depth).
  - Aligned mock error trackers (`modelErrorTracker` and `usageTracker`) in `runner.test.ts` to fix `tracker.record is not a function` mock failures.
- **Verification**: Verified the refactored architecture with `npx node scripts/run-all-agent-tests.js` executing all 25 test suites, obtaining **100% green test results** (25/25 passed).

### Agent Module Refactoring (Step 1, Step 2, and Step 4)
- **Model & Media Helpers Extraction**: Decanted provider/model selection, model routing fallbacks, STT routing, and image description fallbacks from `runner.ts` into new modules `modelRouting.ts` and `mediaFallback.ts`.
- **Double prepareTurn Call Prevention**: Adjusted `turnOrchestrator.ts` to set `input.message.runId` and optimized `runner.ts` to skip redundant DB writes if `runId` is already resolved.
- **ToolRegistry & ToolRuntime Standardized Integration**: Completely refactored built-in tools (`read`, `write`, `edit`, `bash`) to export `ToolDefinition` schemas. Integrated them into the unified `ToolRegistry` and executed them strictly via `ToolRuntime.executeToolCall`.
- **Sandbox & Host Approvals Centralization**: Replaced mock stubs in `ToolExecutionContext` with functional path-guarded filesystem APIs (`fs.readText`, `fs.writeText`, `fs.readBuffer`) and sandbox-wrapped shell runner (`shell.run`). Centralized sandbox permission failures and approval routing in `decidePolicy`.
- **Backward Compatibility**: Introduced a legacy bridge wrapper `toolDefToAgentTool` to keep `subagent.ts` and legacy callers fully functional with zero regressions.

## 2026-05-28

### Agent v2.2 Runtime Integration
- **TurnOrchestrator 完整整合**: 新增 `src/lib/server/agent/turnOrchestrator.ts`；在 `runner.ts` 包含的所有执行出口路径下调用 `updateRunStatus` 将 run 状态置为非 running；并在 `runtime.ts` 启动时通过 `cleanupStaleRunningTurns` 清理挂起的死锁任务；在 `baseRuntime.ts` 中直接由渠道层预备 turn 状态。
- **ToolRuntime 拦截所有工具**: 所有由 `createMomTools()` 返回的活跃本地工具通过 `wrapWithToolRuntime` 动态接入 `ToolRegistry` 并委托给 `ToolRuntime.executeToolCall()`，以进行鉴权、安全性策略拦截和审批检查。
- **SQLite 审批流融合**: 独立的 `ApprovalBroker` 已完全重写并打通 SQLite 表 `approval_requests` 与 `approval_grants` 的持久化支持。`HostBashStore` 现已映射在该共享表上。
- **Runtime 模块化解耦**: 将包含 650+ 行配置清洗逻辑的 sanitizers 从 `runtime.ts` 提取至 `src/lib/server/settings/sanitize.ts`；将 channel 插件热装载逻辑 `applyChannelPlugins` 提取至 `src/lib/server/plugins/loader.ts`。`runtime.ts` 文件体积大幅缩减至 150 行以内。
- **验证**: 单元测试和聚焦测试完全通过，并在 `turnOrchestrator` 中增加了测试环境下的自动创建表机制。

### Agent v2.2 Refactoring Design Spec (Refined)
- **输出可执行架构规范**: 整合 v2.0 与 v2.1 方案优点，设计并撰写了 `v2.2.md`，确立了由 TurnOrchestrator, PiAgentRuntime, ToolRuntime, ApprovalBroker 和 Workspace 构成的分层重构路线。
- **融入技术评审与安全性收窄**: 吸收 `v2.2-review.md` 建议，明确 Workspace ID 的逻辑属性，决不碰物理目录；将 ACP 下线解耦为第一阶段清引用、最后阶段物理清理；将 TurnOrchestrator 切流灰度化并逐步压缩 runner.ts；在 ToolRuntime/ApprovalBroker 中划分子任务切片、细化 `runs` 状态与索引，提升重构稳定性和安全性。


### Minimum Workspace boundary
- **默认 Workspace registry**: 新增 `workspaces` SQLite 表与默认 `personal` bootstrap，Web/shared channel/runner 路径会解析并携带 `workspaceId`。
- **运行归档可追踪 Workspace**: 新 run summary 和 run detail JSONL 写入 `workspaceId`，为后续 TurnOrchestrator、ToolRuntime 和 Approval scope 收口提供最小边界；本批不迁移既有 session/chat 数据。


## 2026-05-27

### Agent v2.1 simplification planning
- **开发计划落地**: 当时曾将 `v2.1.md` 转成可执行 TODO 清单；该过程计划现已从主 docs 树清理，长期架构结论保留在 Agent redesign 设计文档中。

### ACP active runtime path removal
- **ACP 主路径下线**: Channel runtime 不再实例化 ACP service，Telegram/Feishu/QQ/Weixin 移除 ACP 自动代理和权限回调，`/acp` / `/approve` / `/deny` 改为返回 inactive-path 提示；Settings 与 README 不再把 ACP 展示为活跃能力。

### Agent session persistence hardening
- **失败轮次上下文隔离修正**: 自动 compaction 现在先完成摘要再追加本轮用户消息；无内容的 assistant error 仍保留在 session 审计历史，但不会作为空 assistant turn 回灌到后续模型上下文。
- **Sandbox 写权限收窄**: 移除 Longbridge 日志目录的全局 sandbox 写入放行，避免所有 sandbox 命令都继承额外宿主目录写权限。

## 2026-05-26

### Agent session persistence parity
- **失败轮次持久化对齐 Pi/Pae**: Agent session 现在按消息边界保存用户消息、assistant 失败/partial 输出和工具结果，避免工具预算超限或模型中途报错后继续对话时丢失本轮上下文。

### Host Bash display accuracy
- **工具进度标签修正**: 已批准 Host Bash 直达执行和 session-approved host bash fallback 现在显示为 `Host Bash`，避免 sandbox 开启时在 Web/Telegram/run detail 中误提示为 `Sandbox`。

## 2026-05-25

### Subagent sandbox research
- **竞品与产品边界文档**: 新增 `docs/research/sandbox/subagent-sandbox.md`，对 Claude Code、Codex、GitHub Copilot cloud agent、Replit Agent、Devin、OpenHands、Cursor 的 subagent/sandbox/审批/恢复设计做对比，并转化为 Molibot 下一阶段的用户、边界、数据结构、页面交互和验收标准。

### Host approval environment hotfix
- **审批后环境变量恢复**: approved Host Bash / legacy host tool 执行恢复继承宿主 `process.env`，避免 API key、PATH、HOME 等变量在审批后丢失。
- **安全收窄改为后续设计**: `envAllowlist` 字段继续保留兼容，但本次不再默认用它清空宿主环境；更细粒度的敏感 env 审批另行设计。
- **Subagent 等待审批不再误收尾**: 子 Agent 触发 Host Bash 审批时，`waiting_for_approval` 会贯穿 subagent 汇总和 chain 执行；Web chat / streaming API 不再把临时等待提示写成普通助手历史。
- **审批自动执行恢复**: Host Bash 新审批记录现在保留正确 pending action 类型，批准后按原始 scratch 工作目录自动执行，避免批准成功但命令未继续运行。
- **等待审批不再误报停止**: Host Bash 权限请求触发的内部中断不再覆盖 `waiting_for_approval`，Telegram 不会在审批卡后追加 `Stopped.`。
- **空输出审批执行减噪**: 审批后自动执行成功但没有命令输出时，不再额外发送 `(no output)`，保留成功执行确认并继续展示真实失败输出。
- **Telegram 审批按钮即时响应**: Host Bash 审批按钮会先回复 callback 并更新卡片为执行中，再运行审批后的命令，避免长命令导致 Telegram 报 callback query 过期且用户误以为按钮无效。

## 2026-05-24

### Host Bash approval and context hygiene
- **审批执行跨渠道一致**: QQ / Weixin 现在继承共享 Host Bash pending action 执行路径，Web Chat 也可用 `/hosttools approve|approve-session|reject` 完成审批闭环。
- **Session-only 审批可立即执行**: `approve-session` 不创建长期白名单时，也能基于审批记录自身权限执行当前 pending action，避免批准后自动执行失败。
- **Host Bash 审批链路补齐**: approved Host Bash 执行路径支持 pending action 闭环，环境变量行为在 2026-05-25 热修复中恢复为继承宿主进程环境。
- **运行上下文减噪**: 等待审批时不会把审批卡和长 sandbox 错误写回模型上下文；subagent 超长输出会压缩后再返回父 Agent。

### Subagent artifact routing
- **Subagent 产物路径统一**: 子 Agent 现在继承主 Agent 的日期产物目录，`bash/write` 默认把普通生成文件放入 `scratch/YYYY/MM/DD/`，避免日报文件落在 scratch 根目录导致父 Agent 读取错路径。
- **根目录产物覆盖修复**: `bash` 现在会识别新建或修改过的根目录 HTML/PNG/JSON 等产物，并移动到日期产物目录，避免重复文件名时仍读取旧版本。
- **Subagent 权限审批继承**: 子 Agent 的 `bash` 现在使用主 Agent 的 Host Bash 审批上下文，同一 chat/session 下已批准或本 session 放行的权限会直接生效；子 Agent 新触发审批时也会复用现有 channel 审批卡片。

## 2026-05-20

### Telegram group mention trigger
- **启动时先拿 bot username**: Telegram 运行时现在先通过 `getMe()` 初始化 bot username，再开始 polling，避免运行期间 username 为空导致直接 `@bot` 被误判为未提及。
- **直接 @ 可触发**: Telegram 群聊和超群现在会同时识别 message entities 与纯文本 `@username`，避免直接 `@bot` 的消息已经入站却被当成未提及 bot 丢弃。
- **回复路径保持不变**: 回复 bot 消息仍然继续放行，只是 direct mention 的入口补齐到同等可靠。

## 2026-05-19

### Approved host tool shell parity
- **已批准命令回到 shell 语义**: reusable approved host tool 命中后现在执行原始命令字符串，不再把命令拆成 `command + argv` 直接 `spawn`。
- **环境变量展开一致**: `curl -H "Authorization: Bearer $WEREAD_API_KEY"` 这类命令会按普通 shell 规则展开环境变量，避免把 `$WEREAD_API_KEY` 字面量发给远端服务。
- **sandbox 分支保持清晰**: 未命中 approved host tool 时仍按设置走 sandbox；未开启 sandbox 时继续走普通 bash/shell。

### Sandbox env precedence and missing-key audit
- **env 文件优先，系统变量兜底**: sandbox allowlist 变量现在同时从宿主进程环境变量和 `.env.sandbox.local` 解析，同名 key 仍以 `.env.sandbox.local` 为准。
- **启动期缺失告警**: runtime 启动时会检查 sandbox allowlist 中声明但两处都未提供的变量，并把缺失 key 名打印到日志，方便尽早发现配置漏项。
- **诊断面补齐**: `/settings/sandbox` 与诊断 API 现在会额外返回缺失的 allowlist key，只显示变量名，不暴露值。

### WeRead skill env/error discipline
- **先验环境再下结论**: 全局 WeRead skill 现在必须先执行 `printenv WEREAD_API_KEY`，只有检查为空时才允许提示用户重新 `export WEREAD_API_KEY=...`。
- **失败必须回显真实调用**: WeRead 请求失败时，skill 现在必须带上实际 `api_name` 和最终请求体上下文，不再只给笼统的“环境变量缺失”判断。
- **服务端业务错不再误判成本地缺 env**: 对 `用户不存在`、鉴权失败、`errcode != 0` 这类 WeRead 服务端返回，skill 现在默认视为真实业务/鉴权错误，而不是自动归因到 sandbox 注入失败。

### Host approval waiting-state semantics
- **等待不再伪装成停止**: sandbox host approval 挂起当前轮次时，runner 现在返回专门的 `waiting_for_approval` 状态，不再复用通用 `aborted`。
- **Telegram 不再误报已停止**: Telegram 运行时不再把这条路径当成手动停止处理，因此不会在审批尚未发生时额外发送误导性的 `Stopped.` 收尾消息。
- **等待提示不写回会话**: Telegram 不再把“Waiting for your decision”这类临时等待提示持久化成正常 assistant 会话内容，避免审批后续跑时带着伪最终答案污染上下文。

## 2026-05-23

### Added
- Added a session-scoped host approval option (`This Session` / `/hosttools approve-session`) that approves the current blocked command without registering a reusable global host tool.
- Added automatic plain-bash fallback for later sandbox permission denials within that same active session only.
- Added a dedicated `/settings/host-bash` management page and `/api/settings/host-bash` backend for reviewing pending approvals, durable whitelist entries, and Host Bash approval history.

### Changed
- Host approval prompts and channel-native approval UIs now expose three choices: approve permanently, approve for this session, or reject.
- Session-only sandbox bypass state now persists in session preferences and expires naturally when the operator creates a new session or switches bot scope.
- Host Bash approval persistence now lives in SQLite tables (`host_bash_approval_records`, `host_bash_whitelist`) instead of being appended into settings JSON payloads; legacy `hostTools` settings are migrated once at runtime startup.
- Fixed the new `/settings/host-bash` management page so whitelist and history action buttons now fire correctly from the shared Button component.

## 2026-05-16

### Layered skills command output
- **默认先看索引**: `/skills` 现在只返回已加载技能的名字和路径，不再默认把 description、aliases 等完整元数据全部刷出来。
- **摘要改成表格**: `/skills` 的默认索引视图现在使用和 `/models` 一样的 Markdown 表格输出，按 `编号 / 名称 / 路径` 展示，扫读更稳定。
- **按需下钻详情**: 新增 `/skills <id>` 单项详情查看，按技能名或 alias 命中后返回 scope、description、aliases、MCP servers、file/base dir 等完整信息。
- **保留完整清单入口**: 新增 `/skills-detail`，用于查看所有已加载技能的完整详情列表；共享聊天命令和 Web chat 的本地命令处理已经统一到同一套输出规则。

### Archived run details and success-path chat cleanup
- **成功后不再挂着大段运行详情**: 成功执行后，Telegram 会把原 `运行详情` 消息收尾替换成一条简短归档提示；QQ / Weixin / Feishu 会补发同样的归档提示，而不是把成功路径的长执行记录一直留在聊天流里。
- **完整记录转为按 run 归档**: runner 现在会把结构化执行明细按 run 写入每个 chat 工作区的 `run-details/*.jsonl`，保留工具开始/结束、重要说明和最终状态，便于之后追查“前几次失败、最后一次成功”的整条执行轨迹。
- **按需查看入口**: 共享命令层新增 `/runlog latest` 与 `/runlog <runId>`，会优先把归档执行记录作为 `.txt` 文件返回到支持文件发送的聊天渠道，避免再次把超长日志刷进会话；Web 现有诊断视图保持不变。
- **Telegram 结果默认引用原消息**: Telegram 最终答案首发和必要时单独发送的成功归档提示，现在都会默认引用用户原始提问消息，便于在聊天流里快速看出“这条结果是回复哪一句”的对应关系。

### Weixin / QQ host approval text fallback
- **无按钮渠道改明示指令**: 微信和 QQ 在收到 host tool approval 时，不再提示用户去点不存在的按钮；现在会发送共享的纯文本降级说明，明确告诉操作者可以直接回复 `批准` / `安装` / `approve` 或 `拒绝` / `reject`。
- **多待审批也可拒绝**: 共享命令层补上 `/hosttools reject <approvalId>`，让无按钮渠道在存在多条 pending approval 时也能像 approve 一样按 id 精确拒绝。
- **共享层收口**: 非交互渠道的 host approval 提示文案现在由共享 formatter 统一生成，QQ/Weixin 只负责消费运行时事件，不再各自复写一套审批说明。

### Single vs one-time host approval
- **两层审批模型**: host approval 现在明确区分“单命令持久授权”和“多命令一次性授权”。像 `mv` / `pip` / `mkdir` 这类单 executable 命令，审批一次后会继续进入 `approvedTools` 复用；带换行、`&&`、管道或其他复合 shell 语法的安装脚本，则只会生成一条精确的一次性 host action 审批。
- **不再伪装成单命令**: 多步骤 shell 流程不再被错误塞进 `mkdir` 之类的持久 host tool 记录里执行，避免“批准的是 mkdir，实际执行的是整段安装脚本”这种语义错位。
- **待审批列表收紧**: 已批准/已拒绝请求现在会从 `pendingApprovals` 挪到独立 history；`pendingApprovals` 只保留真正还在等待操作员处理的请求。

## 2026-05-15

### DESIGN.md 页面改动治理
- **AGENTS 规则补充**: 新增长期协作规则，凡是页面、界面、交互样式等前端展示改动，都必须先遵循 `DESIGN.md`，但不把具体设计细节重复搬进 `AGENTS.md`。
- **文档分工对齐**: `README.md` 与 `prd.md` 现在都把 `DESIGN.md` 标记为页面设计事实来源，避免后续 UI 改动时只看协作规则、不看设计规范。
- **流程约束落地**: `README.md` 的 Documentation Workflow 新增一步，要求页面/UI 改动先校对 `DESIGN.md` 再动代码或样式。

### shadcn-first 页面组件原则
- **组件优先级明确**: 新增长期规则，页面/UI 改动默认优先使用 `shadcn-svelte` 和 `src/lib/components/ui`，除非现有组件体系确实无法实现需求，否则不要回退到非 shadcn 组件。
- **流程同步**: `README.md` 的文档流程与 `prd.md` 的文档结构说明已同步这条原则，后续前端改动会按同一口径执行。

### Settings 首屏框架统一
- **共享壳层收口**: `src/routes/settings/+layout.svelte` 现在统一了暖色设置工作台外壳、左侧导航层级、顶部工具条和移动端导航折叠样式。
- **首屏层级统一**: `src/styles/workbench.css` 新增一套针对 settings 的共享画布、hero、卡片和按钮规则，让各设置页进入后的第一屏先具备一致的宽度节奏、视觉层级和主操作气质，而不需要先重写各页业务逻辑。
- **范围控制**: 这次主要统一框架与首屏，不重写各页面深层表单和保存流；后续如果继续打磨，会按页面逐个清理内部结构。

### Settings 视觉收敛回调
- **页头收紧**: 普通 settings 页面 header 不再被强行包装成大面积 hero，大标题区改回更紧凑的进入节奏，避免首屏空耗高度。
- **卡片边框降噪**: 共享 settings card 边框整体降对比，尤其暗色模式不再出现发白、发硬的简陋描边。
- **Providers 页面补齐**: `/settings/ai/providers` 旧的自定义 `div + header + action` 首屏结构也已改成紧凑 header，避免它继续保留一块明显更大的页头。
- **Card 基础组件去硬描边**: 共享 `Card` 组件默认不再使用 `ring-foreground/10 ring-1`，改成更柔和的边框和轻阴影，避免卡片出现生硬的黑边或亮边。
- **Tasks 页面防溢出**: `/settings/tasks` 现在会对长路径、长 id、错误文本和状态说明自动换行，并把表格列宽和操作按钮收进固定节奏里，不再被长文本顶出页面。

## 2026-05-13

### Concise sandbox labels and Weixin tool batches
- **展示文案收短**: 所有用户可见的 sandboxed bash 工具展示统一改为 `Sandbox`，初始化失败软降级时显示 `Sandbox disabled`，不再使用冗长的 `bash (sandbox)` / `bash (sandbox disabled)`。
- **微信批量工具进度可读性**: Weixin channel 现在会先聚合原始工具进度，再一次性格式化成多行列表发送，避免 5 次工具调用挤成一行。
- **回归覆盖**: 新增 Weixin runtime tests 覆盖多行工具进度格式化与批量发送行为，并同步更新 sandbox 展示名测试。

### Bash-routed host approval
- **入口收敛**: 移除单独的 `hostToolApproval` agent 工具，把 host capability 审批申请收回到 `bash` 入口。
- **审批保持不变**: `bash.hostApproval` 继续写入同一套 pending/approved host tool registry，聊天里的 `安装` / `批准` / `approve` 确认流程保持不变。
- **执行面内收**: `hostToolRun` 也已移除；审批通过后由运行时直接执行保存下来的受控 host action，不暴露第二个 agent 工具，也不会退化成 host shell。
- **结构化审批**: host approval 现在会产出结构化审批 payload，包含标题、正文、选项和请求元数据，供 API/Web/Telegram/Feishu 渲染原生按钮或卡片。
- **自动续跑**: 审批通过后会立刻执行挂起的 host action，不再停在“已批准、等待继续”这一步。
- **白名单直达**: `bash` 现在会先检查已批准 host capability 白名单；命中后直接执行内部 host action，不再先走 sandbox 再失败一次。
- **失败自动提审**: 对可解析成单个 executable + argv 的命令，sandbox 权限失败会直接创建结构化审批请求，而不是等模型再显式补发一次 `bash.hostApproval`。

### Interactive manager TTY disconnect guard
- **交互兜底**: `molibot manage` 现在会把 `readline` 上来自 TTY 断开的 `EIO` 读错误当成正常关闭处理，不再抛出未处理的 `Interface` error。
- **等待态收尾**: 菜单选择和“Press Enter to continue”这类挂起中的 prompt 会在接口关闭时自行结束，避免卡死在未完成的 `rl.question()`。
- **运维体验**: 关闭终端、断开附着会话，或其他导致 stdin 消失的场景下，管理器会安静退出而不是打印 Node 崩溃堆栈。

---

## 2026-05-14

### Host approval rejection acknowledgement
- **拒绝可见回执**: Telegram 和 Feishu 的 host approval 拒绝动作现在会额外发送一条普通文本回复，明确告知该审批已被拒绝，不再只依赖卡片/原消息状态变化。
- **审批阻塞当前轮次**: sandbox 权限失败自动触发 host approval 时，runner 现在会立刻中止本轮并停在“等待审批”状态，不再把“已发起审批”当成成功工具结果继续生成后续答案。

### Cross-channel subagent execution notices
- **统一事件层**: 共享 `subagent` 工具现在会发出 `subagent_execution` 运行事件，覆盖 run start/end 与 task start/end，不再只写 pretty log。
- **共享展示链路**: parent runner 会把这些事件转成与工具调用同级的 transient progress 提示，保持 delegation 能力在共享上层实现，而不是在各 Channel 里各写一套 subagent 逻辑。
- **各端可见性**: Telegram 直播进度块原生显示 Sub Agent 生命周期；Web SSE 把这些事件流式送到聊天诊断面板；Feishu/Weixin/QQ 通过共享文本运行时自动收到“Sub Agent started / task started / task finished / finished”提示。
- **失败隔离与收口**: subagent UI 事件现在走 runner 的 best-effort UI 队列，前端/通道 sink 抛错不再中断实际 delegation；同时 delegated run 失败时会补发终态 `end` 事件，避免跨端进度面板停在 started 状态。

---

## 2026-05-12

### Chat-first host tool approval
- **bash 入口路由**: host tool 审批申请现在由 `bash` 入口承接；模型在 sandbox 权限失败后通过 `bash.hostApproval` 创建 pending approval，不再暴露单独的 `hostToolApproval` agent 工具。
- **聊天确认**: Telegram/Feishu/QQ/Weixin 的共享命令层会拦截同一会话里的 `安装` / `批准` / `approve`，把对应 pending request 写入 approved host tool registry。
- **受控执行**: 审批后只能执行登记时固定的 command，并通过结构化 argv 传参；不使用 shell。
- **沙箱边界**: `bash` 不会自动升级成 host；已批准项是受控 host capability，不是通用 host shell。
- **提示词约束**: 系统提示词要求模型遇到 host-only 工具时通过 `bash.hostApproval` 申请审批，而不是继续用 sandbox bash 绕行。

---

### Manual `/compact` force behavior
- **Keep-window false negative fixed**: Manual `/compact` can now summarize older context even when `keepRecentTokens` is configured larger than the current session context.
- **Auto behavior preserved**: Threshold/overflow compaction still respects the configured keep-recent window; only explicit manual compaction gets force semantics.
- **Root cause clarified**: The previous runner/store sync fix worked for stale runner memory, but this case was caused by the keep-recent setting making the summarizable slice empty.

---

## 2026-05-11

### Manual `/compact` session-state sync
- **Idle runner reload**: Manual `/compact` now reloads the latest persisted session into the idle runner before summarizing.
- **False negative removed**: Fixes cases where `/status` reported a large live context but `/compact` incorrectly returned `Nothing to compact yet.` because runner memory was older than the session log.

### Telegram live-control 命令修复
- **命令入口补齐**: Telegram 现在会把 `/steer`、`/followup`、`/follow_up` 和 `/queue` 先交给共享命令处理器，而不是在忙碌时当成普通消息入队。
- **队列注入恢复**: `/steer <queueId>` 会按已有队列 ID 注入当前任务，不再出现 `/steer 352` 被重新排成 `#353` 的问题。
- **回归覆盖**: 新增 Telegram 命令注册测试，并继续覆盖共享 `/steer <queueId>` 提升逻辑。

---

## 2026-05-10

### Agent Bash OS Sandbox
- **默认关闭**: 新增 `toolSandbox` runtime settings，第一版只覆盖主 Agent `bash` 和内置 subagent `bash`，初始化失败默认软降级并告警。
- **环境变量 allowlist 注入**: Molibot 宿主解析 workspace `.env.sandbox.local`，只把 allowlisted key 注入 sandbox 子进程；诊断与 UI 只显示 key，不暴露 value。
- **边界清晰**: Browser、Computer Use、ACP、MCP、Channel 收发消息不进入该 sandbox；sandbox 开启时会阻断 `open`、`osascript`、直接启动浏览器等明显绕行命令。
- **设置与诊断**: 新增 `/settings/sandbox` 和只读诊断 API，可检查平台、依赖、env 文件、可注入 key、初始化状态、网络和文件系统策略。
- **输出标记**: sandbox 路径生效时，Web/Telegram/tool thread 展示为 `bash (sandbox)`；初始化失败软降级时展示为 `bash (sandbox disabled)`。
- **回归覆盖**: 新增 settings sanitization、env 注入、env 文件 denyRead/denyWrite、host app bypass、sandbox 关闭旧行为保持等 focused tests。

### Scratch 生成物日期归档
- **默认日期目录**: 每轮模型输入新增 transient `scratch_artifact_dir`，普通会话生成物默认进入 `scratch/YYYY/MM/DD/`，不再继续堆在 chat scratch 根目录。
- **工具层兜底**: `write` 工具会把普通文件名自动路由到当天目录；`bash` 暴露 `$MOLIBOT_SCRATCH_ARTIFACT_DIR`，并在命令结束后把新生成在 scratch 根目录的普通产物搬进当天目录。
- **运行时目录不动**: `scratch` 仍是工具 cwd，`scratch/events` 等 watched event/control 路径保持原语义，显式路径不会被日期规则改写。
- **附件兼容**: 如果模型随后仍按旧根路径 attach，`attach` 会查找当天目录里的同名文件，避免 bash 自动归档后发送失败。
- **回归覆盖**: 新增测试覆盖 transient env 字段、`write` basename 路由、显式 `events/...` 路径保持不变、bash artifact env 变量、bash 根目录产物归档，以及 attach 兼容查找。

---

## 2026-05-06

### Skill Draft metadata 规范化
- **skill-creator 规则落地**: 自动 Skill Draft 生成现在会在配置的 workflow `SKILL.md` 使用 skill-creator 规则时，按“功能标识符 + 触发描述”生成 frontmatter metadata，不再把用户原话直接写成 `name`。
- **专用子代理生成**: 新增内置 `skill-drafter` subagent；自动保存草稿前会优先用隔离子代理生成 metadata，失败时回退到本地规范化逻辑。
- **重试类消息兜底**: “重试一下 / 再试一次”这类泛化消息不会成为草稿名；系统会优先从最终结果和工具路径推断可复用功能名。
- **回归覆盖**: 新增自演化测试覆盖昨日数据回顾命名和重试消息命名，保证草稿 `name` 保持可用。

### Settings shadcn-svelte 迁移基线
- **组件体系切换起点**: 新增 shadcn-svelte `components.json`，并生成 Settings 后续会复用的 Button、Card、Alert、Badge、Input、NativeSelect、Separator、Table、Tabs 等源码组件。
- **系统配置页样板**: `/settings/system` 已从旧本地 UI wrapper 和 workbench 页面样式迁移到 shadcn 风格的语义组件组合，作为后续 Settings 页面迁移模板。
- **Web Profiles 表单样板**: `/settings/web` 已迁移为 shadcn 风格的 profile 列表 + 配置表单，覆盖 Switch、NativeSelect、Textarea、Skeleton loading 和 Alert feedback 等更常见的管理页控件。
- **Providers/Tasks 补齐**: `/settings/ai/providers` 的 provider/model 表单、状态反馈和模型发现控件已切到 shadcn-svelte 组件；`/settings/tasks` 行选择框改用共享 Checkbox；旧 providers-page 全局样式钩子已移除。
- **Skill Drafts 扫读优化**: `/settings/skill-drafts` 的长草稿内容默认只显示前 10 行，完整内容通过弹窗表单编辑并保存。
- **聊天页不变**: 本轮只迁移 Settings 基础组件、系统配置页和 Web Profiles 页，主聊天页未改动。

---

## 2026-05-04

### Telegram typing 超时非阻塞化
- **非关键动作降级**: `setTyping` 中 `sendChatAction(typing)` 在超时重试耗尽后改为仅记录 `ctx_set_typing_failed_non_blocking` 告警日志，不再抛错中断整轮运行。
- **运行连续性修复**: typing 指示与最终消息发送解耦；即使 typing API 失败，本轮最终正文或错误提示仍可继续发送给用户。

### Weixin 工具进度发送修复
- **纯文本进度**: Weixin 工具进度批次不再发送 `_→ ..._` Markdown 样式，改为微信更稳的 `工具调用：...` 纯文本格式。
- **停止坏消息重试**: 已经进入 outbox 的旧工具进度批次会在重试时自动改写；如果微信仍返回 `code=-2`，这类非关键进度消息会被丢弃，不再无限重试。

### AI Providers 模型拉取体验
- **批量拉取入口**: `/settings/ai/providers` 的 Custom Provider 新增“开始”按钮，可直接请求远端 provider 的 `/models` 列表。
- **逐条确认加入**: 拉取结果列表在每个模型右侧提供 `+` 按钮，点击后将该模型加入当前 provider 的 Attached Models，避免手动逐条输入模型 ID。
- **新接口**: 新增 `/api/settings/provider-models`，按 provider 协议（OpenAI-compatible / Anthropic）自动拼装模型列表请求并返回去重排序后的模型 ID。
- **保存去重兜底**: 修复 `/api/settings` 在同一 provider 出现重复模型 ID 时触发 SQLite 唯一键冲突的问题；保存时会忽略空模型 ID 和重复 model_id，避免 500。

---

## 2026-05-02

### Weixin 图片消息修复
- **原生图片发送**: Weixin 本地图片附件现在复用 `package/weixin-agent-sdk` 的媒体上传与 `IMAGE` 消息协议，避免维护两套图片 payload 实现。
- **图片链接转发**: 当 Weixin 回复内容是单个图片 URL 或 Markdown 图片引用时，channel 会下载图片并转发为原生图片消息，不再只把链接作为文本发给用户。
- **Weixin 进度压缩**: Weixin channel 现在首条工具进度单独发送，后续工具进度每 5 条合并发送；成功运行不发送中间错误，整轮没有正常答案时才发送最后一条错误说明。
- **QQ 进度压缩**: QQ channel 现在使用同样的 channel-local 压缩策略，首条工具进度单独发送，后续工具进度每 5 条合并发送；中间错误仍只保留最后一条兜底发送。
- **回归覆盖**: 新增 Weixin outbound 测试，覆盖本地图片文件发送和 Markdown 图片链接转图片消息。

---

## 2026-05-01

### Subagent 路由与可见性
- **Subagent 模型级别路由**: `/settings/ai/routing` 新增 subagent fallback route，并支持把 `haiku` / `sonnet` / `opus` / `thinking` 四个抽象级别映射到任意已配置文本模型；内置 scout/planner/worker/reviewer 不再展示未配置的具体 Claude 型号作为默认模型。
- **设置持久化修复**: 修复 runtime settings 更新路径丢弃 subagent 路由字段的问题，保存后的 DeepSeek/Sub2API 等 subagent 路由现在会真实参与后续运行与页面展示。
- **Agents 页面只读清单**: `/settings/agents` 新增单独的 Subagents 侧边入口，右侧展示 role、描述、工具、模型级别和当前真实生效模型来源，不提供编辑入口。
- **提前委派策略**: 代码库任务现在会被明确要求在预计 8 次以上直接工具调用时提前使用 subagent；父 run 连续使用 12 次工具且还没用过 subagent 时，runtime 会插入一次临时委派提示，避免等到 24 次硬上限才进入无工具续写。
- **运行可见性**: Web trace 现在记录工具 start/end，Telegram 工具进度可识别 subagent 调用，并将工具结果摘要限制到 20 个字符。

### Weixin SDK 协议同步
- **生命周期通知**: `package/weixin-agent-sdk` 新增 `notifyStart` / `notifyStop`，高层 SDK 启停流程会尽力通知 Weixin 后端。
- **BotAgent 元数据**: 所有 SDK API 请求的 `base_info` 现在带有经过格式清洗的 `bot_agent`，便于后端日志归因；非法值会安全降级为 `OpenClaw`。
- **扫码登录升级**: QR 登录改为 POST 本地 token hint，支持手机配对码、验证码锁定、已绑定提示和 IDC redirect 状态。
- **回归覆盖**: 新增 API 测试覆盖 `bot_agent` 清洗、生命周期通知请求体，以及已有发送失败/长轮询 abort 行为。

### QQ SDK 上游能力同步
- **SDK 对齐 v1.7.1**: `package/qqbot` 升级到上游 QQ Bot SDK v1.7.1 源码形态，补齐群策略、引用消息上下文、Slash 命令、审批交互、输入状态、流式消息、STT 附件处理等模块。
- **媒体发送增强**: QQ 出站媒体现在包含分片上传、上传缓存、受保护的远程下载、图片/语音/视频/文件统一发送队列，以及更稳定的用户可见错误映射。
- **Molibot 边界适配**: 保留 molibot 的共享队列、会话推进和任务编排职责在上层，QQ SDK 只承担平台协议、消息转换和媒体传输；同时移除了对不存在的 `openclaw/plugin-sdk/core` 运行时入口依赖，并把 `/bot-upgrade` 默认保持为文档指引模式。
- **直连模式修复**: Molibot 通过 `onEvent` 接管 QQ 入站时，SDK 不再触发 OpenClaw runtime 预检、审批 gateway、SDK slash 拦截或消息处理时的 `getQQBotRuntime()`，避免 `QQBot runtime not initialized` 引发重连风暴和 QQ `/gateway` 限频。
- **回归覆盖**: 更新 `package/qqbot` 媒体出站测试，覆盖缺失凭证短路和稳定错误文案映射；`package/qqbot` 编译与主工程生产构建均已通过。

### 生产部署与自动更新
- **Release Bundle**: 新增 `npm run release` / `bin/molibot-release.sh`，可构建 `dist/molibot-release`，包含 `build/`、生产依赖、运行所需模板资源和 service 脚本，生产运行不再需要源码目录。
- **GitHub 自动更新**: 新增 `bin/molibot-update.sh`，支持拉取 GitHub 仓库、构建 timestamped release、原子切换 `current`，并用 `MOLIBOT_APP_DIR` 重启托管进程。
- **Service 启动目录控制**: `bin/molibot-service.sh` 支持 `MOLIBOT_APP_DIR` / `MOLIBOT_START_COMMAND`，可以从 release bundle 或其他构建产物目录启动。
- **Docker 运行路径**: 新增多阶段 `Dockerfile`、`.dockerignore` 和 `docker-compose.yml`，支持镜像化生产部署。
- **生产依赖补齐**: 将 Weixin QR 登录运行时会动态导入的 `qrcode-terminal` 提升为根包直接依赖，避免 release/Docker 环境缺失外置依赖。
- **交互式管理器**: 新增 `molibot manage`，用轻量菜单完成 GitHub 部署配置、安装/更新、启动、停止、重启、状态、日志查看和受保护的运行文件卸载。
- **目录覆盖保护**: 自动更新现在要求非空部署目录带有 `.molibot-deploy` 标记，release 打包也拒绝覆盖非 release 目录，避免误把已有开发 workspace 或配置目录清空。
- **Web 版本检查**: Web 右上角现在显示当前版本，并通过只读 `/api/version` 检查 GitHub 是否有新版本；浏览器只提示，不执行自动更新或重启。
- **系统配置页**: 新增 `/settings/system`，集中配置界面语言、运行时时区，并只读展示 GitHub 地址/ref 和版本状态；右上角版本徽标同步放大，避免版本文字不可见。
- **GitHub 默认来源**: 部署更新、管理器和版本检查默认使用 `https://github.com/gusibi/molibot` 的 `master` 分支，未配置时也能显示和检查默认仓库。
- **旧仓库安装兼容**: 自动更新在拉到的源码还没有 release 管理脚本时，会从当前安装器注入必要脚本后再构建；后续如果源码目录里残留旧的未跟踪注入脚本，也会刷新为当前安装器版本，避免首次安装旧提交时报 `./bin/molibot-release.sh` 不存在或继续复用 stale 脚本。
- **生产依赖自愈**: release 构建会在源码构建前补齐根包缺失的运行依赖（当前包括 `qrcode-terminal` 和 `mpg123-decoder`），避免旧源码 checkout 因子包动态依赖未提升到根包而构建失败。
- **Release 资源完整性**: release bundle 现在包含内置 subagent Markdown 定义，避免生产环境 `/api/settings/subagents` 因缺少 `scout.md` 等文件报 500 并影响 Agents 设置页显示。
- **轻量进程守护**: `bin/molibot-service.sh start` 现在启动脚本级 supervisor，Molibot 子进程异常退出后会自动延迟重启；`stop` 会写入停止标记，确保人工停止不会被守护循环重新拉起。

---

## 2026-04-30

### 图片识别传输格式修复
- **自定义视觉直传加验证门槛**: 自定义 provider 只有在模型 `vision` 能力验证通过后，图片消息才会走原生多模态 streaming transport；未验证但已声明 `vision` 的模型和备用候选不再宣告原生图片输入，改走 direct image-understanding fallback。
- **队列图片恢复修复**: Telegram/QQ/Weixin/Feishu 入队消息仍会清空大体积 base64，但出队处理时现在会用 workspace-relative 附件路径恢复 `imageContents`，避免图片只以文件路径形式进入模型而绕过 fallback。
- **MiMo Anthropic 角色格式修复**: 显式配置为 Anthropic 的 custom provider，其 runner 与图片 fallback 请求会把 `system`/`developer` 内容移到顶层 `system` 字段，不再发送 `messages[].role=system`；fallback 默认打印脱敏后的 `image_analysis_request`，请求头同时兼容 MiMo 的 `api-key`。
- **图片 payload 更可控**: fallback 路径继续使用显式 OpenAI-compatible `image_url` 或 Anthropic-compatible `image/source` 请求体，避免图片消息在未确认兼容的 SDK transport 中失效。
- **安装级图片测试资源**: `molibot init` 现在会把随包携带的 68-byte `vision-smoke.png` 复制到 `<DATA_DIR>/fixtures/vision-smoke.png`，provider vision 测试从用户工作区读取真实图片字节再发请求。
- **回归覆盖**: 新增 custom protocol helper、queued attachment rehydration 与 image fallback 请求体测试，覆盖 Anthropic baseUrl 推导、图片请求头构造、相对附件路径读回 base64，以及 OpenAI-compatible `image_url` / Anthropic `image/source` 两种真实图片 payload。

---

## 2026-04-29

### 自定义 Provider Anthropic 协议
- **协议选择持久化**: 自定义 AI provider 新增 `openai-compatible` / `anthropic` 协议配置，旧配置自动按 OpenAI-compatible 迁移，SQLite 设置表同步保存协议字段。
- **Anthropic Messages API 支持**: `/settings/ai/providers` 可选择 Anthropic Messages，默认路径切到 `/v1/messages`；连接测试使用 `x-api-key` 与 `anthropic-version` 请求头，并支持文本/视觉能力验证。
- **运行时协议分流**: Web custom-provider 直连、主 runner、自定义 subagent 模型构建、图片理解 fallback 都会按协议选择 OpenAI Chat Completions 或 Anthropic Messages payload/transport。
- **思考参数体验修正**: 协议切换现在会立即更新默认 endpoint 和 thinking format；Reasoning Effort Mapping 默认使用按格式内置的自动映射，只在选择 Custom override 时显示下拉覆盖值。
- **测试错误详情增强**: Provider 测试接口会格式化 JSON 错误并返回更长的上游响应片段，Providers 页面也不再把长状态压成单行省略号。
- **模型行内测试反馈**: 单个模型的 Test Connection 结果现在显示在对应模型卡片内，不再占用保存按钮旁边的页面级状态区。
- **Anthropic 运行时 endpoint 修复**: Runner/subagent 传给 Anthropic transport 的 base URL 现在与 `/v1/messages` endpoint 语义匹配，避免测试成功但实际对话请求到重复 `/v1` 路径而 404；模型错误日志同步展示推导后的 endpoint。
- **图片路由优先级修复**: 当 `visionModelKey` 单独配置了图片模型时，图片消息会优先使用该 vision 路由，而不是被同样声明 `vision` 的 text 路由抢走；如果 vision 请求失败但 fallback 恢复成功，会先发送一条独立失败提醒再继续输出结果。

---

## 2026-04-26

### 文档治理整理
- **AGENTS 规则提炼**: 从 `prd.md` / `features.md` 中抽出了长期有效的协作与架构规则，补充到 `AGENTS.md`，包括文档职责分层、事件调度落地边界、以及 prompt/profile 规则必须真实生效而不只是出现在 source 列表。
- **README 文档分工说明**: 更新 `README.md` 的文档说明区，明确 `README` / `AGENTS` / `prd` / `features` / `CHANGELOG` 各自职责，并补充统一的文档维护流程。
- **变更记录对齐**: 将这次文档治理调整同步记录到 `features.md`、`prd.md` 和 `CHANGELOG.md`，让规则、计划、已交付事实三者保持分层一致。

### 对话时间感知
- **每轮消息注入当前时间**: Runner 现在会在发送给模型的实时用户消息前注入结构化 `<env>` 块，包含 `message_received_at`、`timezone` 和 `today`，让模型能直接感知当前时间并更稳定地处理“今天/明天/下周”这类时间表达。
- **不污染持久化上下文**: 这段时间元数据只用于实时模型输入，保存到 session context 的仍是原始用户文本加附件标记，避免把临时环境信息塞进长期会话历史。
- **设置页时区入口**: `/settings/ai/routing` 新增 runtime timezone 下拉选择，优先展示常用时区并保留完整 IANA 列表；后端保存前仍会校验时区名，确保调度、用量统计和消息时间上下文使用同一时区基准。
- **系统提示词去时间化**: 运行时 system prompt 里原先的 `Server timezone` / `run: date` 提示已移除。当前时间感知只保留在每轮实时 `<env>` 注入里，避免把时间相关内容继续留在期望缓存的系统提示词层。

### Workbench UI 统一
- **共享 Workbench 样式层**: 新增 `src/styles/workbench.css`，把 hero、panel、toolbar、config shell、table、status line 等视觉规则收敛到共享层，不再让 Settings 页面各自携带一套私有样式。
- **AI 设置页去本地样式化**: `/settings/ai/usage`、`/settings/ai/errors`、`/settings/ai/routing`、`/settings/ai/providers` 已移除页面内 `<style>`，改由共享 workbench 体系统一接管。
- **Settings 全区同一产品语言**: Agents、Web Profiles、Telegram、Feishu、Weixin、QQ、MCP、Tasks、Skills、Skill Drafts、Run History、Memory Rejections、Plugins、ACP、Memory 等页面统一到同一套材质、间距和表单反馈规则。
- **主聊天页材质统一**: Web chat 保留对话优先的安静节奏，但侧边栏、顶部栏、Composer、Files pane、Prompt Preview / New Chat 弹层已切到同一套 workbench 材质体系，和 Settings 看起来像同一个产品。

### 缓存命中率可视化
- **缓存命中比例 KPI**: `/settings/ai/usage` 顶部新增缓存命中比例卡片，直接显示当前筛选范围内的 prompt cache 命中比例。
- **缓存命中趋势折线图**: 同页新增缓存命中比例趋势图，按当前时间窗口（小时或天）展示命中率变化，方便判断缓存是否持续有效。
- **口径明确**: 命中率统一按 `cache read / (input + cache read)` 计算，只看 prompt 侧 token，不把 output 或 cache write 混进去。

### Usage 时间窗自动刷新
- **点击时间范围即重拉数据**: `/settings/ai/usage` 的 `今天 / 昨天 / 最近 7 天 / 最近 30 天` 现在会在切换标签时立即调用后端重新拉取 usage 数据，不再只改本地 tab 状态。
- **无需二次点击刷新**: 切换时间范围后，顶部日期窗、`更新于` 时间和所有 KPI / 趋势图都会跟着同一轮新数据更新，不需要再手动点一次“刷新”。

### Web Chat 文件工作区
- **通用文件上传**: Web chat 输入区不再限制为仅图片上传；现在可以直接附加 PDF、Markdown、代码、JSON、音频、视频和其他常见文档文件。
- **右侧文件面板产品化**: 右侧 Files pane 从占位块升级成真实的当前会话附件工作区，支持搜索、类型筛选、待发送 / 已发送分组，以及会话切换联动刷新。
- **常见格式预览**: 图片、音频、视频、PDF、Markdown、文本/代码、JSON/CSV/YAML 现在可以内嵌预览；Office 和未知二进制格式会降级为元信息 + 下载。
- **安全浏览动作**: 面板提供下载和复制相对存储路径，不引入删除、重命名、移动这类高风险文件管理动作。

---

## 2026-03-29

### 核心功能优化
- **Python Sandbox 执行强化**: `bash` 工具现在强制所有 Python 命令使用统一的 sandbox 虚拟环境 (`~/.molibot/tooling/python/venv`)，自动修复缺失的 pip，禁用 `--break-system-packages` 标志，确保技能脚本依赖安装不污染全局 Python
- **Telegram 网络超时重试修复**: 添加每尝试 12 秒超时机制，防止 `editMessageText`/`sendMessage`/`sendChatAction` 在网络卡顿时无限挂起，超时会自动重试而非永久等待
- **Bot Profile 文件管理工具**: 新增 `profile_files` 工具，支持运行时读取/初始化/覆盖/编辑 bot 级别的 `BOT.md`/`SOUL.md`/`USER.md`/`TOOLS.md`/`IDENTITY.md`/`SONG.md`，继承链为 `bot -> agent -> global`

---

## 2026-03-28

### 系统提示词架构优化
- **Skill-First 路由优化**: 合并 Task Framing + Capability Use Order + Skill Routing 为统一的 Message Processing Pipeline，Skill 匹配提升为 Step 0，工具部分增强映射表，Skills Protocol 从 60 行精简到 15 行
- **模板简化**: TOOLS.template.md 从 91 行精简到 31 行，IDENTITY.template.md 从 34 行精简到 23 行

---

## 2026-03-26

### Weixin 迁移修复
- **Slash 命令回复修复**: 修复 Weixin 迁移后 `userId` 字段不匹配导致的 `/help`, `/new`, `/status` 等命令崩溃问题
- **SDK 迁移完成**: 完全移除 `@pinixai/weixin-bot` 依赖，使用项目本地 Weixin SDK bridge，基于 `weixin-agent-sdk` 风格的 login/polling 流程

---

## 2026-03-25

### 语音和架构优化
- **Weixin OGG 语音自动转码**: Weixin 出站语音现在检测 Telegram 风格的 `ogg/opus` 文件，自动转换为 `mp3` 后上传，支持原生 Weixin 语音投递
- **共享文本渠道运行时框架**: 添加共享运行时骨架/helpers，Feishu/QQ/Weixin 迁移到共享 queue/dedupe/stop/prompt-preview/context 路径，Telegram 使用共享安全骨架
- **Weixin 出站投递审计和重试**: 结构化 Weixin 出站发送尝试/成功/失败日志，自动重试瞬时 `sendmessage` 失败，按聊天 `delivery.jsonl` 记录

---

## 2026-03-22

### WeChat 渠道集成
- **WeChat 渠道集成**: 通过 npm 包 `@pinixai/weixin-bot` 添加内置 WeChat 渠道插件和设置页面
- **Vite 别名修复**: 添加 Vite 别名将 `@pinixai/weixin-bot/src/index` 解析到 npm 安装的包源文件，解决包导出检查失败问题
- **QR 生成器**: 在 `/settings/weixin` 添加 QR 工具，操作员可以粘贴 SDK 登录链接即时渲染可扫描 QR 码

---

## 2026-03-21

### ACP (Agent Control Plane) 增强
- **Provider/Profile 分层**: 新增 `src/lib/server/acp/providers/`，拆分 `codex.ts` 与 `claude-code.ts`
- **Preset 管理**: Preset / auth hint / adapter 识别集中管理
- **Schema 扩展**: 扩展 ACP target schema，新增 `adapter` 字段
- **默认配置**: 默认设置改为内置 Codex + Claude Code 两个 preset
- **配置兼容**: 旧配置自动推断 adapter，保持向后兼容
- **Telegram ACP 统一**: 统一 Telegram ACP 帮助文案与状态展示
- **远端 Adapter 命令**: 远端 adapter 命令改为带 provider 前缀显示（如 `codex:/...`、`claude-code:/...`）
- **设置页更新**: 更新 `/settings/acp`，新增 adapter 字段与 Codex / Claude Code / Custom 三种 target 添加入口
- **文档更新**: 更新 `features.md` 与 `prd.md` 记录本次交付

---

## 2026-03-20

### 内存和设置改进
- **Periodic 事件状态持久化**: 修复 watcher，periodic 事件每次执行时持久化 `lastTriggeredAt`, `runCount` 和错误状态
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **设置 Patch 合并**: 运行时设置更新路径现在重新加载最新 `settings.json` 后才应用 patch，防止陈旧的内存进程快照回滚配置
- **混合设置存储**: 动态设置迁移到 `settings.sqlite` 行存储，稳定引导字段保留在 `settings.json`
- **Channel Patch 合并**: 修复运行时 channel sanitizer 合并 patch 而非替换整个 map，保存 `channels.web` 不再清除 Telegram/Feishu
- **关系型设置表**: 替换单行动态 JSON 存储为规范化 SQLite 表 (`settings_agents`, `settings_channel_instances`, `settings_custom_providers`, `settings_custom_provider_models`)
- **设置单实体保存流**: 添加单记录设置 API，迁移 Agents/Web/Telegram/Feishu 页面仅保存选定行，选择变更时提示未保存编辑

---

## 2026-03-15

### ACP 增强和命令
- **ACP 会话命令**: 添加 `/acp sessions` 命令和 ACP service 支持 `session/list`，支持 project-aware 过滤和格式化
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落，打印 `pwd`, `ls -la`, python/uv 解析, DB env 值, 命令 + 退出码
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名
- **ACP 可用命令对象渲染修复**: 修复 ACP 命令解析，支持对象形式命令条目，消除 `[object Object]` 输出
- **ACP 会话持久化和恢复**: 添加持久化 ACP 聊天会话元数据，支持服务重启后自动恢复远程会话
- **ACP 最终结果 Markdown 结构化**: 更新 Telegram ACP 任务分发，自动附加 Markdown 格式要求，本地完成摘要转为 Markdown 子弹列表
- **ACP 工具事件噪音减少**: 停止为每个完成的 ACP 工具调用发送 Telegram 消息，汇总到最终任务摘要
- **ACP 状态洪泛保护**: 强化 Telegram 429 重试逻辑，ACP 状态更新节流和降级
- **ACP 认证预检提示**: 改进 ACP 启动错误报告，Codex-like target 超时且无 API key 时附加认证提示

---

## 2026-03-14

### 集成和兼容性
- **pi-ai 0.62 OAuth 导入兼容性修复**: 将 OAuth helper 导入从 `@mariozechner/pi-ai` 移到 `@mariozechner/pi-ai/oauth`，恢复生产构建兼容性
- **Codex auth.json 重用 + ACP 启动超时调整**: 验证 Codex ACP 可在非交互进程重用本地 `~/.codex/auth.json`，增加 ACP 启动超时 (`initialize` 30s, `session/new` 60s)
- **共享 Button 点击事件转发**: 修复 `src/lib/ui/Button.svelte` 转发原生点击事件，恢复 ACP `Add Project` 等设置页面操作
- **ACP stdio 帧兼容性修复**: 修复 ACP stdio 传输帧发送换行分隔 JSON 而非 `Content-Length` 帧，解决 Codex ACP 初始化解析失败
- **Linus Torvalds 风格人设模板**: 添加 `IDENTITY.linus.template.md` 和 `SOUL.linus.template.md`，提供直率技术至上代理人格选项

---

## 2026-03-10

### 稳定性和路由优化
- **Periodic 事件更新 + 重复取代**: 更新 `create_event`，periodic 任务按 `chatId + schedule + timezone` 更新而非创建新文件，旧重复项标记 `completed` (`superseded_by_update`)
- **跨 Provider 模型回退**: Runner 和 assistant service 保留失败 context，自动重试替代 provider，聚合失败详情
- **声明优先的视觉路由**: 更新 runner，自定义文本/视觉模型声明 `vision` 后即使验证 `untested`/`failed` 也信任原生图像输入
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态保持 `untested`
- **验证感知的音频回退路由**: Runner 根据 `audio_input` 和 `stt` 元数据计算显式音频决策，记录回退原因
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据

---

## 2026-03-08

### UI/UX 主题和设置
- **主题和 i18n 基础**: 添加可替换主题令牌文件，切换聊天 + 设置 shell 到主题令牌渲染，添加 `system/light/dark` 切换和 `zh-CN`/`en-US` 语言切换
- **设置概览暗模式对比修复**: 更新 `/settings` 概览介绍和卡片描述，从硬编码 `text-slate-400` 到主题令牌 `text-[var(--muted-foreground)]`
- **Feishu 入站媒体解析和 Runner 就绪接收**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **Mory 支持的内存网关核心切换**: 添加可选 `mory` provider 在内存网关中，保持 `json-file` 为默认
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，Telegram + Feishu `/models` 命令使用共享流
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 现在显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分

---

## 2026-03-03

### 内存系统核心实现
- **内存 V2 分层 + 增量检索管道**: 添加分层内存 (`long_term`/`daily`)，后端能力协商，增量 `flush` 光标，混合搜索 (keyword+recency)
- **内存治理和操作控制台**: 添加事实键冲突检测 (`hasConflict`)，TTL 支持 (`expiresAt`)，API `list` 动作，`/settings/memory` 管理 UI
- **Telegram 内存统一到内存根**: Telegram mom 内存不再存在于聊天工作区目录，全局/聊天内存文件从统一 `memory/` 根迁移/读取
- **统一内存网关用于 Telegram Agent 操作**: 添加 Telegram `memory` 工具，阻止通过 `read/write/edit/bash` 工具直接内存文件访问
- **外部化 Telegram Runner 指令文件**: `runner.ts` 现在从代码构建运行时系统提示，然后从 data-root `~/.molibot` 合并指令/配置文件
- **Bot 提示自动维护协议**: 在捆绑的 AGENTS 模板中添加显式自动更新治理，用于 `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md`
- **AGENTS.md 工作区目标护栏**: 添加显式 bot 提示规则：编辑 AGENTS 指令时，始终目标 `${workspaceDir}/AGENTS.md`，永远不要项目根 `AGENTS.md`
- **`molibot init` 工作区引导命令**: 添加启动器子命令 `molibot init` 来初始化 `${DATA_DIR:-~/.molibot}` 并从捆绑的提示模板引导配置文件
- **全局配置文件路径强制执行**: 强化工具路径解析/保护，因此配置文件 (`SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md`) 被规范化为 data-root 全局路径

---

## 2026-02-28

### 系统提示词和架构
- **全局提示源强制执行和源预览**: 提示文件加载器现在从 `${DATA_DIR}` (`~/.molibot`) 解析指令/配置文件，大小写不敏感文件名匹配
- **全局配置文件模板升级**: 使用受 OpenClaw 启发的模板样式 frontmatter 和更清晰的章节重构 `~/.molibot/AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md`
- **Init 配置文件模板包**: 从升级的全局配置文件添加 `src/lib/server/agent/prompts/*.template.md`，切换 `molibot init` 为复制这些模板
- **移除遗留 AGENTS.default 回退文件**: 删除 `src/lib/server/agent/prompts/AGENTS.default.md`，运行时回退/导入指向 `AGENTS.template.md`
- **提示构建器提取和运行时/配置文件拆分清理**: 将 Telegram mom 提示构建从 `runner.ts` 移到 `src/lib/server/agent/prompt.ts`，代码拥有的合约章节保留在代码中
- **提示预览动态章节排序清理**: 重新排序 `prompt.ts`，稳定的运行时合约章节保持在高变动运行时有效负载之前
- **配置文件注入清理**: 在将配置文件注入运行时提示前剥离 YAML frontmatter，重写 AGENTS 注入措辞
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，在 `src/lib/server/agent/prompt-channel.ts` 引入适配器可选渠道提示章节

---

## 2026-02-27

### 核心架构和内存系统
- **mory README 能力清单**: 更新 `package/mory/README.md` 为功能状态清单，按 `完成` / `TODO` 标注 mory 当前能力与未实现项
- **mory TODO 功能全量落地**: 添加 `moryEngine` 编排 (`ingest/retrieve/commit/readByPath/readMemory`)，`read_memory` 工具 API，异步 commit 管道，严格提取验证器，存储适配器 (`InMemory`/`SQLite`/`pgvector`)，版本化 schema 字段，检索执行器，遗忘/归档策略引擎，可观测性指标，全循环 E2E 测试
- **mory 认知控制模块**: 扩展 `package/mory`，添加纯逻辑模块用于写入评分门 (`moryScoring`)，冲突解决/版本控制 (`moryConflict`)，检索意图路由 (`moryPlanner`)，情景整合 (`moryConsolidation`)，任务范围工作区内存助手 (`moryWorkspace`)
- **定期事件生命周期修复**: `periodic` 任务首次执行后不再标记 `completed` 并从调度表移除，watcher 保持它们跨运行调度并记录 `lastTriggeredAt` 同时保留 `runCount`
- **Molibot 服务脚本状态说明**: 确认 `bin/molibot-service.sh` 仅反映其管理的后台实例状态，不能代表系统内不存在其他手动或开发模式运行中的 Molibot 进程
- **mory README 功能点状态清单**: 将 mory 全量功能点写入 `package/mory/README.md`，按 `完成` / `TODO` 明确当前实现边界
- **硬调度护栏**: 为 Telegram mom 运行时添加硬调度护栏，提示明确要求所有延迟/重复任务使用 watched event JSON 文件，`bash` 阻止外部调度器，`memory add` 拒绝提醒/计划类内容
- **mory 独立 SDK 完成**: 完成 `package/mory` 作为独立 Node 包，标准结构 (`src/`, `test/`, `README.md`, `package.json`, `tsconfig.build.json`)，可运行构建/测试/smoke 脚本
- **mory SQL 持久化模板**: 添加 `@molibot/mory` SQL 持久化模板，SQLite schema/upsert SQL 加 PostgreSQL pgvector schema/upsert/vector-search SQL
- **mory 写入门批量行为**: 改进 `mory` 写入门批量行为，批量缓存反映插入和更新决策，待处理 ID 现在是碰撞安全的
- **技能提供策略澄清**: README 澄清 `molibot init` 保持手动安装行为，添加从项目 `skills/` 到 `${DATA_DIR}/skills` 的显式手动安装命令
- **README 渠道状态措辞**: 修正 README 渠道状态措辞，Telegram 标记为实际使用中验证，Web Chat/CLI 标记为实现但尚未在此项目使用上下文中亲自验证
- **mory 写入时分类**: 添加共享内存分类，新内存写入时自动标记，flush/import 路径重用相同分类器，提示注入优先 collaboration/project/reference 内存
- **通用代理提示强化**: 填补非编码提示空白，添加任务框架、新鲜度验证、外部内容注入抵抗、更广泛的动作确认规则
- **Weixin 入站语音/文件媒体回退强化**: Weixin 入站媒体接收不再在 `media.aes_key` 缺失或 SDK payload 仅提供 hex `aeskey` 时丢弃语音/文件/视频项目，回退到纯 CDN 下载或 hex-key 规范化

---

## 2026-02-25

### 渠道和内存系统
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，引入适配器可选渠道提示章节
- **Mory 支持的内存网关核心切换**: 添加 `src/lib/server/memory/moryCore.ts`，注册可选 `mory` provider 在内存网关中
- **Feishu 入站媒体解析**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，窄 API `/api/settings/model-switch`
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **Agent 拥有的音频转录边界**: 将 STT 目标解析/转录流移到 `src/lib/server/agent/stt.ts`，附件元数据扩展 `mediaType`/`mimeType`
- **Provider 能力验证状态**: 添加每模型 `verification` 状态 (`untested`/`passed`/`failed`)，扩展 provider 测试 API
- **验证感知的视觉路由**: 更新 runner，图像输入仅在选定的自定义文本模型或专用视觉路由模型声明并验证通过 `vision` 时才通过原生多模态提示
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态故意保持 `untested`
- **验证感知的音频回退路由**: 更新 runner 从 `audio_input` 和 `stt` 能力元数据计算显式音频决策
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据
- **声明优先的视觉路由**: 显式声明 `vision` 的自定义文本/视觉模型现在即使验证 `untested` 或 `failed` 也被信任用于原生图像输入
- **AI 使用 Bot 维度分析和过滤**: 扩展使用记录添加 `botId`，在使用跟踪器窗口/细分中添加 bot 级聚合，升级 `/settings/ai/usage` 支持 bot 过滤 + bot 排名表
- **Runner 流日志安全修复**: 从 `runner.ts` 移除不安全的低级流包装器，将 first-token 日志移到真实 assistant delta 事件，停止自动启用 pretty stdout 日志除非显式设置 `MOM_LOG_PRETTY=1`

---

## 2026-02-23

### Web UI 重构
- **Web 应用 ChatGPT 风格 Tailwind 布局重构**: 重建聊天 + 设置页面 (`/`, `/settings`, `/settings/ai`, `/settings/telegram`) 为统一 ChatGPT 风格 shell，纯 Tailwind 样式
- **服务器生命周期脚本 + 运维文档**: 添加 `bin/start-molibot.sh`, `bin/stop-molibot.sh`, `bin/status-molibot.sh`, `bin/restart-molibot.sh`
- **统一服务控制脚本**: 添加 `bin/molibot-service.sh` (`start/stop/status/restart`) 作为单一运维入口
- **全局 `molibot` 启动器 + 家工作区迁移**: 添加 npm-linkable `molibot` 命令，将默认运行时数据根移到 `~/.molibot`，Telegram 工作区切换到 `~/.molibot/moli-t`

---

## 2026-02-20

### 核心功能实现
- **记忆网关 API 完成**: 实现稳定的记忆网关 API，支持可替换后端（JSON 文件默认），`add/search/flush/delete/update` API 端点
- **记忆 V2 分层 + 增量检索管道**: 添加分层记忆（`long_term`/`daily`），后端能力协商，增量 `flush` 光标，混合搜索（keyword+recency）
- **记忆治理和操作控制台**: 添加事实键冲突检测（`hasConflict`），TTL 支持（`expiresAt`），`/settings/memory` 管理 UI
- **Telegram 多 Bot 运行时 + 设置 UI**: 添加 `telegramBots[]` 设置 schema 和 `/settings/telegram` 多 bot 编辑器
- **事件交付模式拆分**: 添加可选事件字段 `delivery`，one-shot/immediate 默认 agent 执行，`delivery:"text"` 保持字面推送

---

## 2026-02-15

### ACP 和渠道增强
- **Telegram ACP 命令路径 MVP**: 添加 ACP 设置 + Codex target preset，Telegram `/acp` / `/approve` / `/deny` 命令，项目注册，聊天范围的 ACP 会话生命周期
- **ACP Web 设置工作区**: 添加 `/settings/acp`，结构化 ACP target/project 管理，批准模式默认值，绝对路径项目允许列表编辑
- **ACP 会话命令**: 添加 `/acp sessions` 命令，支持 ACP `session/list`，包括 target/project 上下文和当前会话标记
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名

---

## 2026-02-11

### 项目启动和基础架构
- **V1 PRD 基线**: Must/Later 范围和验收标准定义
- **V1 架构基线**: 架构对齐到仅 Telegram + CLI + Web
- **双周冲刺计划**: 按周交付物和检查点定义
- **Telegram 技术决策**: V1 Telegram 适配器库固定为 `grammY`
- **持久化技术决策**: V1 会话/消息持久化改为 SQLite
- **文档清理**: 移除冗余文档，在 `readme.md` 中添加文件用途导航
- **代码骨架实现**: 实现 V1 代码骨架：Telegram (`grammY`), CLI, Web, 统一路由器, SQLite 持久化
- **运行时集成**: `assistantService.ts` 直接调用 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`
- **驱动兼容性修复**: 用内置 `node:sqlite` 替换 `better-sqlite3`，支持 Node 25 兼容性

---

## 总结

### 主要成就 (2026-02-11 至 2026-03-29)

#### 1. 架构重构 (3次重大重构)
- **模块重组**: 后端重组为 7 个显式模块（app, agent, channels, memory, sessions, settings, providers）
- **分层重构**: 共享命令层抽取，渠道 Runtime 清理，代码和文档同步
- **ACP 增强**: 完整的 Agent Control Plane，支持 Codex 和 Claude Code 双 preset

#### 2. 渠道支持 (4个主要渠道)
- **Telegram**: 完整入站和出站媒体支持，多 bot 运行时，ACP 集成
- **Feishu**: 完整入站媒体解析和出站文件/图像/音频交付
- **Weixin**: SDK 迁移完成，OGG 语音自动转码，媒体投递审计
- **QQ**: 基础运行时支持

#### 3. 内存系统 (30+ 相关功能项)
- **核心架构**: 分层内存 (`long_term`/`daily`)，混合检索 (keyword+recency)
- **网关 API**: 稳定的记忆网关，支持可替换后端（JSON 文件默认，Mory 可选）
- **治理控制台**: 事实键冲突检测，TTL 支持，`/settings/memory` 管理 UI
- **mory SDK**: 独立 Node 包，支持 SQLite/pgvector，完整认知控制模块

#### 4. 设置和配置 (25+ 功能项)
- **AI 设置**: 多 provider 架构，每模型能力标签和验证，可视化 provider 测试
- **模型路由**: 文本/视觉/STT/TTS 模型选择，跨 provider 自动回退
- **关系型设置**: 规范化 SQLite 表，单实体保存流，未保存变更提示
- **主题和 i18n**: Solar Dusk 调色板，`system/light/dark` 模式，`zh-CN`/`en-US` 切换

#### 5. 开发者体验和工具 (20+ 功能项)
- **Python Sandbox**: 统一虚拟环境，自动依赖管理，禁止系统包污染
- **Bash 工具强化**: 路径沙箱，命令白名单，输出压缩，超时处理
- **MCP 集成**: stdio 和 HTTP 传输支持，技能门控注入，动态加载工具
- **性能优化**: 提示刷新策略（仅变更时重建），流日志安全修复，定期事件锁机制

### 统计数据
- **总功能项**: 250+ 个已交付功能项
- **架构重构**: 3 次重大重构（模块重组、分层重构、ACP 增强）
- **渠道支持**: 4 个主要渠道（Telegram、Feishu、Weixin、QQ）完整媒体支持
- **内存系统**: 30+ 相关功能项，完整的记忆层实现
- **设置和配置**: 25+ 功能项，完整的设置架构
- **开发者工具**: 20+ 功能项，完整的开发体验

### 时间跨度
- **开始日期**: 2026-02-11
- **当前版本日期**: 2026-03-29
- **总开发周期**: 7 周
- **主要发布**: V1.0 (当前)
