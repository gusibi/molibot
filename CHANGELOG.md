# Molibot ChangeLog

## Archive Index / 归档索引
- [2026 Q2 Archive (Apr - Jun)](docs/archive/changelog-2026-Q2.md)
- [2026 Q1 Archive (Feb - Mar)](docs/archive/changelog-2026-Q1.md)

---
## 2026-07-18

### Style: Dark theme OKLCH color palette update
- Replaced the high-contrast Vercel dark theme with a new custom OKLCH color scheme, resolving contrast issues under the dark theme.
- Updated the `.dark` class block in `src/styles/theme.css` to use the new OKLCH colors and shadows, while keeping the light theme unchanged.
- Created `design.dark.md` to document the new dark theme OKLCH color values and shadow configurations, ensuring design consistency and preventing future styling regressions.

### Polish: Agent City floor details no longer obstruct the city
- Three.js Agent City no longer renders permanent floor circles, text, or panels. Pointing at the actual Global HQ or a floor raycasts that building and presents one static Agent, task, channel, routing, and Sub-agent detail card; moving away hides it.
- Working activity is rendered on the building itself: its floor-wall, roof, and base retain a dim blue outline while one long bright dashed segment continuously travels around that shell in Three.js. Reduced motion preserves a static bright segment, while the accessible 2D fallback keeps keyboard detail and static state contrast.
- Verified Agent City projection/scene tests 9/9, Desktop UI tests 80/80, Svelte diagnostics 0 errors / 0 warnings, and the Desktop production build. A cold native walkthrough remains pending because this environment cannot drive or capture the macOS window.

### Polish: Expanded Desktop Session lists are one density step smaller
- All expanded channel and Project Session rows now share the `DESIGN.md` compact-control height (32px), 4px spacing grid, and `label-12` typography (12px/16px), fitting more history in the sidebar without changing selection or management behavior.

### Fix: Desktop Settings can reopen and configure built-in AI providers
- Closing the Settings window now hides the reusable native window instead of destroying it, so subsequent Settings actions reopen the same window reliably.
- Desktop AI Providers now gives built-ins a compact API-key, enablement, default-model, and model-ID editor instead of reusing the full self-hosted capability form. The modal body scrolls independently while its actions remain visible, and page save bars stay fixed to the content-pane bottom.
- Built-in status badges now reflect the saved Web-compatible enablement configuration instead of marking every catalog entry green merely because it is built in; configured API-key state is also visible in the detail summary. Self-hosted provider creation remains separate and keeps its endpoint requirements.
- Retired the unused `/login` and `/logout` slash commands from shared suggestions, Telegram registration, Web handling, and shared channel execution.

### Fix: Chat Header search stays aligned and returns visible transcript matches
- Rebuilt transcript search as one shared Header control for regular Chat and Project Chat. It now expands inside the action row's normal flex layout instead of absolutely covering the title or adjacent buttons, with compact light/dark styling and focus restoration on close.
- Matching follows the text users actually see, including localized Assistant error fallbacks, while omitting messages without navigable IDs. Result indexes are clamped whenever the transcript changes, and both chat surfaces scroll/highlight the selected match safely.
- Added live result counts, previous/next controls, Enter/Shift+Enter navigation, and machine guards for normal-flow layout, shared Project wiring, rendered-text matching, and changing result counts. Svelte diagnostics pass with 0 errors / 0 warnings.

### Polish: Settings and Chat sidebars now float as a native macOS inset material
- Settings and Chat now share one DESIGN-defined sidebar surface with 10px outer breathing room, a 12px panel radius, a quiet hairline/highlight, restrained ambient depth, and adaptive translucent material. Navigation, scrolling, footer status, and content behavior are unchanged.
- Chat and Settings now also share an explicit native traffic-light inset: the macOS close/minimize/zoom controls sit 6px lower, clearing the rounded sidebar's top border without changing their horizontal alignment.
- Follow-up: Chat's exposed canvas now matches the Header/transcript primary surface instead of inheriting Settings' gray canvas, while Settings retains its secondary card canvas. Hidden project-row actions collapse to zero width and expand only on hover/focus, returning the previously reserved 78px to project names.
- Second follow-up: replaced the broad Chat shadow with compact depth shared by Chat and Settings. The full-strength shadow remains visible at rest; hover/focus keeps that elevation unchanged and adds only a low-opacity accent edge with short diffusion. Low-performance mode disables the glow. The standalone resize divider is gone while its invisible drag/keyboard hit area remains. Empty local Chat states now enter the existing default-Bot draft flow, so the composer is editable before any Web/Project Session is selected and the Session is created only on first send.
- Chat's resize handle follows the visible panel edge and pointer tracking starts from the current width instead of an uninitialized manipulation position. Keyboard resizing, narrow-window rules, and the file-panel collapse path remain intact.
- Reduced-transparency mode uses an opaque sidebar without blur; low-performance mode also removes the ambient shadow. Verified live at 1200×800 and the supported 860×620 minimum in light/dark and low-performance states with no horizontal overflow; Svelte diagnostics and production build pass.

### Fix: User bubbles no longer force-wrap every message; assistant copy action sits in flow
- Every user message wrapped ~12% short of its natural width ("hi" rendered as two one-character lines): `.user-message-shell` is a non-stretched grid item (`justify-items: end` on `.message-row`), so it shrank to the bubble's max-content width, and the bubble's `max-width: 88%` then resolved against that shrunken shell — clamping below natural width and forcing a wrap on every message. The shell now spans the full reading column (`width: 100%`), restoring 88%-of-column semantics.
- The assistant meta row's copy action was pushed to the far right by `margin-left: auto`; it now stays in flow directly after time · model · memory-trace, per expected left-to-right reading order.
- Root-cause class: percentage `max-width` resolved against a fit-content wrapper (CSS intrinsic-sizing circularity). Probed the live stylesheet: "hi" bubble = 1 line at 41px in a 720px shell; copy action at x≈232 immediately after the memory-trace chip. Verified Svelte diagnostics 0/0 and Vite build.

### Fix: Streaming replies no longer repaint the whole transcript per token; chat surfaces gain entrance motion
- Streaming felt like the page kept refreshing: every SSE token wrote directly to the reactive `streamingText`, re-running `{@html renderMarkdown(...)}` and replacing the streaming bubble's entire innerHTML per token, with `renderMarkdown` re-parsing the full reply and re-highlighting every code block (unlabeled blocks via `highlightAuto` across all 9 registered languages) on each write. `ConversationController` now buffers token/thinking deltas in plain fields and flushes them to reactive state at most once per animation frame (`setTimeout 16ms` fallback for node tests); buffers are cancelled/reset on replace, done, turn start, turn end, and `clearTurn()` so no stale delta can land on a later session. `renderMarkdown` gains a `{ streaming: true }` mode that skips highlight.js entirely during the stream (full highlighting on the final render) and a 300-entry LRU cache for completed messages.
- Entrance motion pass on chat (plans/001–002, tokens `--duration-fast/normal` + `--ease-standard/spring`, `@starting-style`, opacity/transform only): message rows crossfade in (opacity-only, 160ms — masks the end-of-turn streaming→persisted row swap), queued-messages bar and pending file chips fade/rise in, the approval card enters with the modal's spatial language, and `details` bodies (thinking card, run activity) fade in on open. Entrances are gated behind a `.messages.settled` class set by the new `settleEntrances` action two frames after mount/session-switch/load, so opening a session never replays every row's entrance. Deliberately not animated: slash-suggestion menu and conversation browser (keyboard-frequency), stickToBottom scrolling, file-panel grid. The existing global `prefers-reduced-motion` block disables all of it.
- Machine guard: the shared-composer regression in `chat-ui.test.mjs` now asserts tokens go through the buffered `pendingStreamText` + `scheduleStreamFlush()` path and fails if `onToken` ever writes `streamingText` directly again.
- Verified Svelte diagnostics 0 errors / 0 warnings, Vite build, tsx suites 46/46, Desktop UI/node suites 76/76 (cargo untouched). Live streaming feel-check pending a running service.

### Fix: Automation task cards fill the workspace and the detail pane stops covering the list
- Task cards in the automation workspace capped at 480px per grid track, leaving the right side of the pane empty; the list grid now stretches tracks to fill the full workspace width (`minmax(min(100%, 360px), 1fr)`).
- The detail pane switched to an absolute overlay via a `@media (max-width: 1099px)` viewport breakpoint, but the sidebar consumes ~220px, so common window sizes (~1000pt) triggered the overlay even though the content area fit side-by-side. `.automation-workspace` is now an inline-size container and the overlay applies via `@container (max-width: 679px)`, with the side-by-side grid relaxed to `minmax(250px, 320px) minmax(0, 1fr)`; Escape now closes the detail pane in both modes.
- Verified Svelte diagnostics 0 errors / 0 warnings, Vite build, Desktop UI tests 73/73, and probed the live stylesheet at 852px workspace width (side-by-side, detail `position: relative`) and 552px (overlay, `position: absolute`).

### Fix: Restore macOS-style switches across Desktop Settings
- Replaced the unstyled legacy `.switch` buttons on Skills, Search, Image, Video, Voice, Host Bash, Web Profile, Sandbox, and Plugins with the same shared `IosSwitch` used by General Settings, preserving existing toggle and save behavior.
- Added a structural regression covering every affected page. Verified Desktop UI 73/73, Svelte diagnostics 0/0, the production build, and the shared 38×22px full-radius rendering at the 860×620 minimum window.

### Fix: Tray "Open Web" / "Restart Service" stayed permanently disabled
- The tray/menu enablement context in `ChatView` was derived via `$: commandContext = commandContextSnapshot()` — a no-arg helper whose internal reads of `serviceEndpoint` / `serviceOwnership` are not tracked by legacy `$:` (Recurring Pitfall #2), so the context computed once at init (service not yet started) and `sync_native_command_menu` disabled both items forever. Inlined the context object into the reactive statement so its dependencies (`locale`, workspace pane, service endpoint/ownership) are referenced directly and the native menu re-syncs when the managed service comes up.
- Machine guard (this is a repeat of the pitfall-#2 root-cause class): new `src/reactive-statement-guard.test.mjs` in the desktop test suite fails on any `$: x = helper()` no-arg derivation in a Svelte file (escape hatch: `// reactive-guard-ok` for genuinely static helpers); confirmed it matches the original defective line.
- Verified Svelte diagnostics 0 errors / 0 warnings, Vite build, native command tests 13/13, Desktop UI tests 73/73, new guard test 1/1.

### Docs: codify development-process rules distilled from rework analysis
- Analyzed ~3 weeks of CHANGELOG entries (~140, roughly half fixes) plus session history and distilled the recurring rework patterns into standing rules: search prior fixes before debugging, close every fix with a root-cause-class / machine-guard / pitfall triage ("Fix 收尾三问"), no band-aid-then-root-fix two-step, cold-start smoke walk for UI changes, mandatory settings round-trip regressions, and spec-first batched cross-pane UI concepts.
- Added `AGENTS.md` §开发流程沉淀规则 (six long-term process rules), extended CLAUDE.md Quick Rules and Recurring Pitfalls (new §9 cold-start smoke walk, §10 settings round-trip). Documentation-only change; no code touched.

### Changed: Reuse one archive Session without carrying fresh automation context
- Fresh recurring automations now reuse one hidden transcript archive per stable task while every execution still starts with empty model context. Persisted messages carry their `runId`, so each execution detail remains isolated and legacy per-run Sessions stay readable.
- Completed fresh runs restore the prior active chat Session, shared archives avoid aggregate snapshot rewrites, and execution-scoped Memory/tool/Subagent identity prevents prior runs from becoming implicit runtime context.
- Delayed Host Bash approval now keeps the owning `runId`, rewrites and resumes only that execution inside the shared archive, restores the suspended Turn lifecycle, and returns the chat to its prior active Session after completion.

### Fix: Keep memory task completion notices out of Chat Sessions
- Memory reflection and daily materials now share one authorized Telegram/Feishu Bot chat destination while retaining independent notification switches.
- Added a dedicated channel internal-notice path that sends human-facing completion text without running an Agent, appending Agent Context, or changing the active Session. User-created one-shot reminders keep their source-Session behavior.
- Daily materials now sends one owner-level aggregate after all Bot scopes finish and deduplicates repeated project-relative output paths instead of notifying every source Bot's first allowed chat.
- Updated bilingual Desktop settings copy and target availability. Verified focused Server/settings tests 33/33, Desktop UI 72/72, and Svelte diagnostics 0/0.

### Feature: Memory learns faster from repetition, review, and synthesis
- Daily reflection now reinforces an existing active memory (confidence +0.02, capped at 0.99, freshness refreshed) when the same durable fact is mentioned again, instead of silently dropping the repetition; utility remains owned by trace feedback, and a failed reinforcement never blocks sibling candidates or the watermark.
- The pending-review queue groups owner/project candidates first under "About you" and collapses agent_self/content candidates into an expandable "Agent learnings" section with a count badge, so runtime lessons stop drowning out profile signals.
- The digital-profile summary is now LLM-synthesized into flowing second-person prose, cached per profile fingerprint in `memory_profile_summaries` (re-synthesized only when the underlying records change), with the concatenated summary as automatic fallback on failure.
- Verified memory server tests 22/22 (new reinforcement, cache, fallback, and grouping cases), Desktop UI 46/46 + HTTP 74/74, Svelte diagnostics 0/0, the production Desktop build, and clean `tsc` on touched files.

### Polish: Clarify memory candidate action labels
- Renamed the pending-candidate buttons from “确认记忆 / 不准确” to “保存记忆 / 不保存” (EN: “Save memory / Don't save”) so the destructive semantics are explicit — the second action discards the candidate (`status: ignored`) rather than adjusting any score.
- Verified Svelte diagnostics 0 errors / 0 warnings.

---
## 2026-07-17

### Feature: Desktop native behavior layer
- Unified application menus, tray actions, and the command palette behind one localized typed command catalog. Empty command-palette searches now prioritize successful local recent commands, the active workspace, and catalog recommendations; text searches retain relevance-first ordering. The versioned local history stores only stable command IDs, successful-run counts, and local timestamps (20 entries, 90 days), never query text, labels, parameters, session/profile data, errors, or user content. Added recoverable startup, persisted close behavior, shared dialog semantics, direct manipulation, native window-state chrome, activity scheduling, and focused feedback/haptics coordinators without adding channel-specific orchestration.
- Native notifications request permission only from the explicit setting, deduplicate terminal events, keep foreground updates in an accessible live region, and restore the main Chat window when acted on. Haptics remain restricted to completed user pointer gestures.
- Desktop release builds now recover from a Finder AppleEvent timeout by producing a functional non-custom-layout DMG, and target-aware finalization no longer selects an obsolete DMG from a different target directory.
- Verified native/unit 45/45, Desktop UI/HTTP 74/74, Rust 19/19, Svelte diagnostics 0/0, Vite build, `cargo check`, whitespace check, and a complete Apple Silicon DMG build with checksum, `hdiutil` validation, and mount inspection. A separately compiled, isolated QA bundle also launched as a foreground native app, resolved its resources, started a managed sidecar on port 3001, and retained its own single-instance process without modifying the user debug host or port-3000 service. macOS denied accessibility automation and display capture, so menu/tray interaction, VoiceOver/focus, window visuals, notification actions, and Force-Touch behavior remain accurately unverified; the local keychain also has no Developer ID signing identity.

### Fix: Paste screenshots into Desktop Chat and keep image turns live
- Desktop Chat and Project Chat now turn pasted clipboard images into pending attachments while preserving ordinary text paste behavior. Multiple clipboard formats for the same screenshot are collapsed to the first valid image, preventing duplicate attachments.
- Attachment turns use multipart SSE instead of the non-streaming Chat fallback, so the UI progresses from Uploading to Recognizing image and then updates the Assistant response token by token.
- The shared stream endpoint remains backward compatible with JSON-only turns and now persists uploaded files and forwards image contents through the existing Agent runtime.
- Verified Desktop API 76/76, multipart stream parsing 2/2, Desktop UI 63/63, and clean Svelte diagnostics.

### Polish: Give Desktop Settings a secondary canvas and quieter cards
- Kept the Settings navigation on its existing sidebar surface while moving the right-side Header and content onto the Geist secondary canvas, with primary-surface setting cards above it.
- Reduced card-border and row-divider contrast using existing theme tokens only, preserving explicit/system light and dark modes, compact windows, and fixed save footbars.
- Added a Desktop Settings surface regression and verified all 61 UI tests, clean Svelte diagnostics, and the production Desktop build.

### Fix: Apply the surface hierarchy to Desktop Chat
- Kept the Desktop navigation and file panes on the sidebar surface while unifying the central Header and transcript on one design-derived workspace surface with shared separators.
- Preserved the Settings secondary canvas/card hierarchy and automatic light/dark theme adaptation without adding hardcoded color values.
- Added a Desktop UI regression and verified all 60 UI tests, clean Svelte diagnostics, and the production Desktop build; live browser inspection was unavailable because the sandbox denied local port binding.

### Polish: Clarify Web Chat and Settings surface hierarchy
- Kept the Web Chat navigation and file sidebars on their existing sidebar surface while unifying the central header and transcript on the primary card surface with quiet separators.
- Gave Web Settings a secondary canvas with primary-surface cards and softer card/divider borders, using theme tokens only so light and dark modes remain aligned.
- Verified computed light/dark surfaces in the live Web UI, confirmed no new hardcoded color literals, and completed the production Server build.

### Feature: Memory v3.2 closes the profile, feedback, maintenance, search, and Skill-review loops
- Replaced recency-shaped “profiles” with one server-built, scope-authorized profile used by both Desktop and prompt injection, including restart-stable Session snapshots and immediate governance revocations.
- Added explicit memory lifecycle/usage metadata, durable privacy suppression, append-only verified feedback effects, evolution-aware reflection, cross-run candidate evidence, guarded default-off auto-confirm, and safe version revocation.
- Added independent watched-event maintenance and the authorized `conversation_search` Agent tool with Jieba search-mode CJK indexing, bigram fallback for unknown words, resumable projection, SQL scope filters, and deletion/truncation tombstones. Memory lexical retrieval uses the same tokenizer.
- Added deterministic immediate-correction quarantine and trace-backed Skill draft suggestions that always require the existing human review/promotion flow.
- Verified mory 186/186, focused Server memory/Session tests 93/93, Desktop Chat/API 206/206, Svelte diagnostics 0/0, and a production Server build.

## 2026-07-16

### Refactor: Converge Desktop UI on Geist consistency rules
- Repaired silent CSS variable/keyframe failures and dark-theme conversation chrome, then standardized focus treatments, radius roles, elevation, scrims, modal/drawer motion, and reduced-motion behavior without redesigning existing surfaces.
- Established an 11px functional type floor with an explicit Agent City artwork exception, normalized weights and mono typography, improved warning-text contrast, and added recursive CSS guards for undefined variables, undefined keyframes, and undersized text.
- Verified Desktop UI/HTTP 61/61, projections 13/13, Tauri 13/13, and Svelte diagnostics at 0 errors / 0 warnings.

### Feature: Live running indicator on the streaming status; composer shows an invocation chip
- The streaming status line now carries a breathing accent dot next to the backend-pushed run status (elapsed time · token count · phase, e.g. "3m 39s · 3.7k tokens · almost done thinking…"), giving a Claude-Code-style at-a-glance signal that the turn is actively running. The pulse is disabled under `prefers-reduced-motion` and the app's low-performance mode.
- Typing (or picking) a recognized command/skill now highlights the token **in place**: a colored pill is painted behind the `/token` at the start of the input (accent for commands, purple for skills). The highlight is an overlay that mirrors the textarea's text metrics; the textarea stays opaque on top, so the caret and CJK IME composition remain fully native and the following glyphs never shift. No extra chip row is added.
- Verified: `svelte-check` 0/0, production Desktop build, desktop UI tests (13 + 58), plus a live render check confirming the pulse animation, pixel-aligned inline token pill (skill + command variants), and single-line layout against the shipped stylesheet.

### Fix: Explicit skill invocation no longer inlines the whole SKILL.md into context or the chat view
- Explicitly invoking a skill (`/name`, `$name`, `skill:name`) previously injected the **entire SKILL.md content** into the turn — it was both sent to the model and rendered verbatim as the user message in the transcript. The runner now passes only the compact `[$name](/abs/path/SKILL.md)` reference (name + absolute path); the agent reads the file itself per the Skill Execution Protocol ("read its `SKILL.md` in full"). Removed the now-dead `injectExplicitSkillFileContext` helper. This trims model context and de-clutters the chat view for skill messages.
- Verified: agent runner/helpers/prompt tests (35 + prompt suite), `tsc` clean on the touched runtime files.

### Fix: Chat streaming shows one "Thinking…"; assistant meta reads time-left / copy-right; composer isn't flush to pane edges
- The streaming placeholder no longer renders twice: the message bubble only appears once real streamed text exists, so the status line ("Thinking…"/activity) is the single indicator before the first token.
- Assistant message meta row now leads with the timestamp on the far left and pushes the copy action to the far right (model/memory-trace sit in between).
- The composer (`.composer-wrap`) now carries the same `clamp(20px, 5vw, 56px)` horizontal inset as `.messages`, so it no longer sits flush against the edges on narrower surfaces like Project Chat, while its content column still caps at the 720px reading width.
- Verified: `svelte-check` 0/0, production Desktop build, and the desktop UI test suite (13 + 58) including the updated issue-13 composer assertion.

### Fix: Desktop runtime upgrades no longer break lazy APIs; new chats can choose a Web Profile
- Bundled Desktop runtimes now install into immutable versioned directories. Updating the app no longer removes hashed server chunks that an adopted or still-running previous sidecar may lazy-import, preventing the broad `ERR_MODULE_NOT_FOUND` 500 failures reported across Project, Provider, Plugin, Diagnostics, Sandbox, Trace, Usage, and Host Bash endpoints.
- New Desktop chats now start as a Profile-selectable draft instead of eagerly creating an empty Session with the default or last Profile. The first message creates the Session with the selected Web Profile and pins that Profile to its Runtime.
- Added regression coverage for cross-generation chunk retention and the no-eager-session client contract. Verified with Rust 13/13, Desktop Chat/API 206/206, Desktop UI 56/56, Profile bootstrap/draft 8/8, clean Svelte diagnostics, and production Server/Desktop builds.

### Fix: Desktop Issue #16 provider, automation, diagnostics, and Skill regressions
- Restored built-in AI providers by rendering the server's built-in provider summary directly, while keeping built-ins read-only and custom-provider management unchanged.
- Automation and system records now render as bounded task cards. One-shot reminders expose their linked execution, and direct text deliveries across Web, Telegram, Feishu, QQ, and Weixin are persisted into the execution-linked Agent Context so session details contain the delivered message.
- Removed the duplicate Automation destination from Settings, added the Desktop App version to Diagnostics, and removed the duplicate in-page Agent Studio title and excess top spacing.
- Explicit Skill invocations now persist as a readable `[$skill-name](.../SKILL.md)` reference without embedding Skill contents or temporary control blocks in the user message. Verified with 206/206 Desktop Chat/API tests, 22/22 additional runtime/prompt tests, 56/56 Desktop UI tests, clean Svelte diagnostics, Server/Desktop production builds, and live Desktop-page inspection.

### Fix: Desktop Usage and Trace no longer loop on first load
- Fixed both observability pages remaining on loading skeletons because their Svelte effects accidentally tracked request-generation/loading/query state that the request itself mutated, continuously superseding every response.
- The initial-load effects now track only service readiness and endpoint while reading request-store state through `untrack`. Trace also has one active-run initialization path instead of firing from both `onMount` and the endpoint effect; its three-second polling remains unchanged.
- Added regression assertions for the dependency boundary. Verified with observability/API tests 88/88, Desktop UI 53/53, Svelte diagnostics 0 errors/0 warnings, and a production Desktop build.

### Feature: Desktop Usage and Trace are complete observability dashboards
- Usage now supports today/yesterday/7-day/30-day ranges, model/Bot/channel filters, filtered KPI and request/token/cache trends, model/API/Bot/channel rankings, refresh controls, and paginated request metadata.
- Trace now supports fact-type, Bot, channel, Chat, Session, Run, and source-limit filters plus tool/skill/model/Bot/Chat/Session/Run rankings and paginated facts. Existing running/stuck/orphan controls remain below the analytics dashboard.
- Filtering, aggregation, and pagination happen behind Desktop-specific APIs, with stale-response generations on the client. Usage exposes only local diagnostic identifiers; Trace strips payloads, tool argument/result/error previews, blocked-by data, and all message or command content before it reaches the WebView.
- The bilingual Geist UI adapts tables into compact records at narrow widths and retains light/dark theme support. Verified with Desktop Chat aggregate tests 206/206, Desktop JS/UI 55/55, Rust 12/12, Svelte diagnostics 0 errors/0 warnings, and production Server/Desktop builds. Interactive visual inspection was unavailable in the current environment.

### Fix + Polish: Service log tail is 2000 clean lines, scrolls to newest, opens the full file
- The Logs page now shows the last **2000 lines** (was a raw 256 KB byte tail). The byte-tail seek that could slice a multi-byte UTF-8 character now drops the first partial line, and **ANSI colour/control escapes are stripped** server-side (`strip_ansi`), so CJK text and coloured `[mom-t] telegram …` lines render as plain readable text instead of `^[[33m…` garble.
- Added an **Open log file** button that opens `~/.molibot/runtime/desktop-sidecar.log` in the system default viewer (new Rust commands `open_desktop_log` / `desktop_log_path`, called directly through the opener plugin like the tray's Open Web — no new WebView capability), so the full, live log is one click away.
- The log pane auto-scrolls to the newest lines after every load/refresh.
- Verified: new Rust unit tests for line-tailing and ANSI stripping, full desktop test suite (13 + 55 JS, 12 Rust), `svelte-check` 0/0, and a production Desktop build.

### Polish: Settings sidebar regrouped by function
- The Settings left-nav groups were a grab-bag (e.g. "AI Engine" mixed core model config, tool capabilities, and observability). Regrouped by actual function into: **General** (general), **Models** (models, providers), **Assistant** (agents, skills, memory), **Tools** (mcp, webSearch, imageGenerate, videoGenerate, ttsGenerate, hostBash), **Channels** (profiles, channels), **Activity** (tasks, runHistory, usage, trace, logs), **System** (runtimeEnv, sandbox, plugins, diagnostics).
- Pure nav-taxonomy change in `App.svelte` (`SETTINGS_GROUPS` + `settingsGroupLabel`); no sections added/removed and section routing is unchanged. Verified with `svelte-check` (0 errors/0 warnings) and a production Desktop build.

---
## 2026-07-15

### Polish: Image/Video record delete is an icon; test-result type on-scale
- The per-record delete is now a low-emphasis trash icon (`row-icon-btn danger-action`) instead of a heavy red text button, matching the destructive-action treatment used elsewhere and lightening each row (Geist: destructive actions shouldn't dominate a list).
- `.tool-test-result` no longer sets an off-scale `11px` size with an ad-hoc mono stack; it uses `var(--font-mono)` at 12px (a Geist type-scale step). Verified with 53 Desktop UI tests and clean Svelte diagnostics on the touched files.

### Fix: Image/Video record detail shows the result and parameters; dead "View result" button removed
- Removed the non-functional "查看结果" button from every Image/Video record row — the detail modal already carries the result.
- The detail modal now renders the actual image/video: it fetches the completed result from the local service by taskId (the same file the web settings page serves) and shows it via a blob URL, so it renders inside the WebView CSP. Raw provider result URLs — which are blocked by `img-src` and expire — are no longer used for display. Added a loading/failed state with retry.
- Added a sanitized **request parameters** block (model, size, seed, aspect ratio, etc.) plus a readable full-width prompt. Params are projected through a primitive allow-list so secrets (apiKey), host paths, session ids, and poll tokens can never reach the WebView (pitfall §5).
- Download now targets the served local file. Added the two serving endpoints to the Tauri HTTP capability allow-list (image-generate/image, video-generate/video).
- Verified with the desktop-media-tasks projection test (safe params kept, secrets/paths/ids stripped), 53 Desktop UI tests, clean Svelte diagnostics, a production Desktop build, and a live render of the rebuilt detail modal (preview frame, params panel, prompt block).

### Fix: internal approvals and reminders no longer create stray Chat sessions
- Desktop Host Bash approvals now use a dedicated structured endpoint instead of submitting `/hosttools...` through Chat. Watched one-shot Events retain their source Session and deliver back to it, while recurring `fresh` task behavior remains unchanged.
- Historical `/hosttools...` and `[EVENT:...]` Web sessions are safely tagged as internal and omitted from ordinary Chat without deleting any session or message data. Resizable sidebar titles now grow with the available width instead of stopping at 30 characters.
- Added regressions for the dedicated approval request, internal-session filtering with data preservation, source-Session reminder routing, and flexible sidebar titles.

### Fix: Image/Video generation records collapse to one dense line
- Each record in the Image and Video settings pages now renders as a single scannable row — a status badge, the prompt truncated to one line with an ellipsis, and muted `engine · time` (video keeps inline `%` only while processing) — instead of stacking engine/status, prompt, timestamp, and error across three or four lines. Full detail (prompt, timestamps, error, preview, download) stays one click away in the existing task detail modal via 查看.
- Verified with a live browser render of completed/processing/failed rows (single line, prompt ellipsis, all actions inline), 53 Desktop UI tests, clean Svelte diagnostics, and a production Desktop build.

### Fix: Settings pages align every block to one centered column
- All Settings content — page title, product description, section heads, action rows, status messages, and cards — now shares a single centered column and width, instead of mixing full-width `28px`-margin blocks with centered cards. The shared width is exposed as `--settings-col`; the regular column was widened to match the data pages (720px).
- The page header was mis-centering because `.settings-page-header > div` also matched the (empty) `.page-header-actions` div, so the two split the row and pushed the title to the left; the rule is now scoped to the text column and the header gap is removed. The scroll area uses `scrollbar-gutter: stable both-edges` so cards stay symmetric with the gutter-less header.
- Each section no longer re-renders its header hint as a duplicate in-page paragraph (the `PageHeader` description is the single source). Removed from 15 section components.
- Verified with 53 Desktop UI tests, clean Svelte diagnostics on touched files, a production Desktop build, and a live browser check confirming title/description/cards center at the same pixel.

### Fix: system task execution details no longer open nonexistent sessions
- Owner memory-reflection and daily-material runs now retain structured execution results and open a localized execution-record view; legacy runs show available lease metadata instead of a misleading cleaned-session message.

### Feature: one-shot reminders have a dedicated inbox and unread badge
- Desktop Automations now has separate Automations, One-time Tasks, and System Tasks tabs. One-time reminders use a compact todo list with localized trigger times and clear Reminder / Reminded states; delivery failures remain visibly distinct.
- Newly completed one-shot watched events set an explicit unread flag and increment the Chat sidebar badge. Opening One-time Tasks marks those reminders read through a one-shot-only API and clears the badge immediately.
- Legacy completed reminders default to read, preventing upgrade-time notification floods. Recurring and immediate diagnostic tasks never participate in the unread mechanism.
- Verified with 86 focused runtime/projection/Desktop API tests, 53 Desktop UI tests, clean Svelte diagnostics, and production Server/Desktop builds.

### Fix: Project Chat history no longer opens blank
- Project Session selection now performs one authoritative transcript request and hydrates the pinned Project runtime from that response, instead of racing two independent requests and rendering only the second result.
- A successful Project transcript response can no longer be discarded because a duplicate request hit a transient service restart; external Feishu/Telegram transcript paths are unchanged. Verified against the reported session with 13 rendered messages plus a focused regression test.

### Memory Trace and a user-facing Memory Center
- Assistant messages now disclose the exact long-term memories placed in that turn's model context, separately from memories added or updated during the turn. Full immutable snapshots load on demand in a responsive drawer with retrieval feedback.
- Trace persistence is bound to the final Agent source entry and is non-blocking: an observability failure never interrupts the answer. Conversation lists carry only lightweight counts.
- Desktop Memory now has three separate product tabs: Overview for the user profile and pending review, Topics for grouped summaries and related facts, and All memories for search and record management. Advanced backend operations live in a secondary dialog rather than a fourth tab.
- Overview and Topics are deterministic projections of stored memory fields; records remain editable and can be excluded from future answer injection. Verified with 4 projection tests, 55 Desktop UI tests, 72 Desktop API tests, clean Svelte diagnostics, and Server/Desktop production builds.

### Desktop Agent Studio upgraded to a Three.js pug micro-city
- Replaced the CSS office with a fixed-isometric Three.js city containing 10 stable ordinary-Agent plots, a separate Global headquarters, and an owner dispatch center. Ordinary Agents grow round-robin from 1 floor to 10×10 floors; Agent 101+ is reported without extending the scene.
- Added a pure Agent City projection boundary for stable slots, five real Activity states, exact building/floor task routes, and parent-run Sub-agent pods capped at 3 visible helpers. The projection never infers tool actions from task text and does not change Channel code.
- Kept names/statuses and hover/focus details in semantic Svelte DOM. Automatic full→low→2D quality handling, context-loss fallback, reduced motion, offscreen pause, dark/light scenes, responsive vertical growth, and GPU/listener cleanup keep the page usable across devices.
- The polished 2D fallback now preserves Bot, channel, start time, task summary, model routing, and Sub-agent details instead of degrading to name/status only. Performance downgrade happens in place so forcing the old WebGL context closed cannot black-screen the replacement renderer.
- Current delivery uses procedural buildings and proxy pug models; formal Blender GLB models, rigging, animations, and materials remain a later asset milestone.
- Verification: Agent City projection/scene tests 9/9, server Agent Activity/Trace tests 9/9, Desktop UI/HTTP 54/54, Svelte diagnostics 0/0, production build, and a real 1280×800 Agent page check with Global + 4 regular Agents visible and no horizontal overflow.

## 2026-07-14

### Feature: Agent avatar moves left of the message and the transcript gains a centered reading column
- The Agent avatar now sits to the left of each assistant message (a dedicated `.assistant-layout` flex column with a 28px `.assistant-avatar`) instead of stacked above the name; the identity row keeps just name + role. Applied to both the persisted transcript and the live streaming row so they match.
- All message rows now share one centered reading column capped at `--message-content-width` (720px, the same width as the composer) via `margin-inline: auto`, instead of sprawling to the full pane width on wide windows. User bubbles right-align within the column (max 88%), assistant content fills it.
- Pure markup/CSS; message content, actions, and attachment rendering are unchanged. Note on inline images: the attachment media path (message `attachments` → `/api/web/files` session listing → `filesByLocal`) was verified end-to-end (endpoint returns the images with matching `local` keys); the earlier "images show as filename chips" report was a downstream symptom of the projection mismatch fixed above, not a media-path bug.
- Verification (desktop UI change): `svelte-check` 0 errors / 0 warnings, `vite build` passes, Desktop UI tests 53/53 (updated the issue-13 assertion to the centered-column + left-avatar layout).

### Fix: Chat transcript no longer scrambles replies in hybrid legacy sessions
- The Web/Desktop conversation projection paired each UI metadata row to an Agent message by "first unused of the same role," so a single pre-migration display-only assistant row (`contextBacked:false` with its own content) broke 1:1 alignment and shifted every later reply by one. Symptom: the last turns rendered as user, user, AI, AI with stale bodies, and a context-backed row that found no match was silently dropped.
- Matching is now anchored on the Agent `sourceEntryId`: a new `sourceEntryId` field on `UiMessageMetadata` is resolved by the projection and persisted (`SessionStore.recordMessageSourceEntries`, mirroring `markMessagesContextBacked`), so subsequent loads pair by stable id, not list position. Rows without a stored id yet fall back to an order-respecting scan (a cursor forbids a later row from stealing an earlier Agent row), and an unmatched context-backed row now keeps an empty placeholder instead of vanishing.
- Existing sessions self-migrate on their next open (no manual step); ids re-resolve gracefully if the Agent log is ever rewritten/compacted.
- Verification (agent/runtime change): `conversationProjection` 5/5 (added hybrid-session regression + stored-id pairing tests) and `sessions/store` 8/8 pass; `tsc` on the three touched server files reports 0 errors (repo baseline of 154 unrelated errors unchanged); replaying the real reported session through the fixed projection restores the correct 开始生成图片 → reply → 帮我返回文案 → reply order.

### Fix: Desktop sidebar footer and session list now bleed to the divider
- The settings footer's hover highlight and top border now span the full sidebar width. Previously the sidebar's 12px horizontal padding left both ends of the highlight bare, so only the middle segment appeared selected on hover.
- The conversation/session scroll region now extends to the sidebar's inner right edge, so its scrollbar sits flush against the vertical divider instead of leaving a 12px gap.
- The sidebar resizer handle now highlights in a soft gray (`--gray-600`) on hover/drag instead of the deep `--accent` blue, which read as jarring against the neutral chrome; it still adapts for light and dark.
- All three are pure CSS adjustments (full-bleed via negative horizontal margins compensated by padding, plus a token swap); content alignment is unchanged. Verification: `svelte-check` 0 errors / 0 warnings, `vite build` passes, Desktop UI tests 51/51.

### Fix: Desktop Trace delete action now responds visibly
- Reordered the Desktop Trace page so the range control, KPI cards, and analytical charts remain the primary dashboard; active and orphan run records now appear beneath the dashboard.
- Replaced the Desktop Trace action's browser-native confirmation with the shared in-app confirmation dialog, so Delete record and Stop run always provide immediate visible feedback and support cancel, backdrop, and Escape dismissal.
- Confirming still posts only the selected run ID. Orphan runs are marked aborted and disappear from the active list while their audit facts remain available.
- Verification covers the UI action contract, client POST payload, in-memory SQLite transition, and active-list filtering.

### Feature: implement GitHub Issue #13 macOS interface redesign
- Unified the Desktop shell around a native macOS product layer: system-first typography, 52px toolbars, consistent 6/8/12/full radii, aligned 576px settings and 720px data/message columns, semantic status treatment, and accessibility fallbacks.
- Models, Providers, Trace, and Automations now lead with human language, separate technical details, use the correct switch/menu controls, and keep destructive actions out of persistent primary chrome. Tasks use a 320px list plus flexible inspector with a right-side overlay below 1100px.
- Chat now defaults to a 260px sidebar, a compact single-line composer, 720px message width, and visible assistant identity. The product rules are recorded in `DESIGN.md`; API, runtime, and persistence contracts are unchanged.
- Added shared semantic UI primitives and human-readable model/provider/schedule projections, then migrated the target pages to them. General Settings now includes a persistent low-performance mode with automatic reduced-effects fallback.
- Completed keyboard and accessibility behavior: Command+F, Command+K, Command+comma, consistent Command+Return, arrow-key/Escape menus that unmount when closed, focused destructive dialogs, semantic live regions, and non-color-only statuses.
- Verification: Desktop UI/HTTP 53/53, API/presentation 74/74, Svelte diagnostics 0/0, production build, and populated bilingual light/dark browser checks at 860×620 and wide widths.

### Fix: complete issues #6, #11, and #12 across Session and runtime layers
- UI Session files now persist `messageMetadata` instead of a second normal transcript. A shared projection reconstructs Web/Desktop/Project messages from append-only Agent entries and merges UI-only attachments, activity, model, platform IDs, and reasoning. Matching legacy rows migrate to metadata-only storage; unmatched display-only command history remains intact.
- Edit-and-resend truncates the selected UI projection and the corresponding Agent entry log, then rebuilds the model context snapshot so display and continuation state cannot diverge.
- Desktop Stop keeps SSE attached while the server aborts and finalizes, waits for Runner quiescence, then reloads the persisted partial answer. Trace controls now enumerate and abort ordinary Web and Desktop Project RunnerPools in addition to channel managers, instead of misclassifying them as orphan records.
- Verification: focused projection/session/Trace tests 22/22, Runner tests 25/25 against temporary SQLite, Desktop UI tests 44/44, `svelte-check` 0 errors / 0 warnings, and the production build passes.

### Feature: AnySearch and reliable Desktop search/media tests
- Added AnySearch to shared Agent search routing and both Web/Desktop settings using the documented `/v1/search` protocol, optional Bearer authentication, anonymous quota support, normalized results, and request IDs.
- Desktop search, image, and video tests now preserve server-side saved credentials when the credential-safe UI draft contains no replacement key. Image and video tests also expose an explicit engine selector matching Web behavior.
- Verification covers AnySearch anonymous/authenticated protocol calls and credential-preserving Desktop payloads, plus focused server/Desktop tests and UI diagnostics.

### Fix: running Project sessions no longer block workspace navigation
- Skill、Agent 和任务菜单现在会明确退出 Project 详情并显示目标工作区；正在运行的 Session 继续由原有 per-Session runtime 在后台执行，输出、队列、停止与审批不会串台。
- 完成 GitHub Issue #8 的剩余桌面体验项：启动阶段反馈、回复模型标识、消息元数据布局、代码高亮/复制、长消息折叠、Project Enter 行为、Agent `@` 展示、纵向待发队列和只读服务日志页。首条消息自动命名与 Skill 标识此前已交付，未重复实现。
- Verification: navigation/store/bootstrap regressions 13/13, Desktop UI 45/45, Desktop chat suite 192/192, Svelte diagnostics 0/0, Rust tests 11/11, and both production builds pass.

### Feature: selectable Feishu/Telegram destination for daily reflection notices
- Desktop Plugins → Memory now lists authorized chats from enabled Feishu and Telegram Bot instances and persists one selected destination for the Owner-level daily memory reflection task.
- Each Owner reflection run sends exactly one aggregate human notice to that destination after success, including zero-output runs; terminal failures send one failure summary before the task is marked failed. Per-Bot scanning and watermarks remain unchanged, and notices stay outside model/session context.
- Verification: focused settings/plugin/scheduler tests 33/33, Desktop UI 42/42, Svelte diagnostics 0/0, and the production build pass.

### Test: plugin memory settings now have a real restart regression
- Replaced serialization-only confidence with a temporary-file/temporary-SQLite round-trip that saves memory reflection and daily-material settings, creates a fresh `SettingsStore`, and verifies every value after reload.
- This locks in the 2026-07-12 fix for `dailyMaterials.enabled` and related memory sub-settings being reset to defaults after a Desktop service restart without reading or writing the user's real settings database.

### Fix: Project Session selection now switches the visible transcript
- Fixed Project Chat updating the selected sidebar row while leaving the detail pane bound to the previous `projectChatStore` runtime entry, which made every Session appear to contain the same conversation.
- The shared `selectProjectSession` action now activates the matching per-Session runtime directly. `ProjectChat` only restores an existing selection on mount and no longer relies on a legacy reactive statement observing imported rune-store mutations.
- Verification: real API responses for 4 Sessions were distinct; the new A → B runtime/transcript regression passes; Desktop UI tests 42/42 and `svelte-check` reports 0 errors and 0 warnings.

## 2026-07-13

### Fix: production rebuilds no longer break lazy-loaded settings routes
- The custom Svelte adapter now builds into an isolated staging directory instead of deleting the live `build/` tree at build start. Completed output publishes server chunks before atomically replacing the manifest and retains hashed chunks still needed by a running process.
- This prevents `/api/desktop/model-routing` and other not-yet-loaded routes from failing with `ERR_MODULE_NOT_FOUND` while a production rebuild is in progress; failed or interrupted builds leave the current runtime intact.
- Verification: adapter tests 2/2, production build succeeds, and 150 model-routing requests completed with zero failures during a concurrent full build.

### Fix: explicit UI Session storage and synchronized deletion
- Renamed the Web presentation store from `users/<scope>/sessions` to `ui-sessions/<scope>` with its index at `ui-sessions/index.json`. Existing layouts migrate lazily and idempotently, preserve ordering, and are removed only after the replacement files exist.
- Web and Desktop deletion now share one lifecycle that rejects live runs and removes both the UI Session and its Agent context artifacts, including the last context. External channels remain context-only.
- This change established the UI Session / Agent Context boundary; the remaining transcript-copy removal and lossless projection were completed on 2026-07-14.

### Fix: owner-level memory automations and separated system tasks
- Replaced per-channel/per-Bot memory reflection and daily-material watched events with one Molibot-managed owner event for each feature. Every run resolves the current enabled Bot scopes from live settings, so adding a Bot does not create another automation and the new Bot participates on the next run.
- Scheduler startup removes only recognized legacy managed memory-event files and retains user-created events. Desktop Automations now separates User Tasks and System Tasks; owner tasks have localized names, remain manually runnable, and are protected from edit/delete because plugin settings own their schedules and enabled state.
- Verification covers stable owner identity, future-Bot discovery, idempotent migration, task classification, responsive bilingual tabs, focused runtime tests, Desktop diagnostics/tests, and production builds.
- Hardened managed-event idempotency checks to ignore JSON object key order while still excluding runtime status, preventing semantically unchanged legacy or manually reordered event files from being rewritten. Verification: scheduler tests 7/7, Desktop UI tests 44/44, `svelte-check` 0 errors / 0 warnings, and production `vite build` succeeds.

### Fix: Desktop first-click loading failures and GitHub bug regression coverage
- Live browser instrumentation confirmed the first Agents/Skills/Automations click was delivered and switched panes; the apparent no-op came from failed bootstrap/API requests being rendered forever as `Loading`, while an attempted endpoint was latched before bootstrap succeeded and therefore never retried.
- Workspace children now mount only after bootstrap succeeds. A repeated navigation click or the localized retry action reconnects the same endpoint; failed Skills/Automations requests render an actionable error instead of an eternal loading state. No macOS private click-through API is enabled.
- Fixed a second Skills first-load failure where the summary updated to 26 but the card grid stayed at 0: the imported rune store was read through legacy `$:` derivations that never recomputed after async data arrived. The pane now uses Svelte 5 `$state`/`$derived`/`$effect`; live browser verification renders all 26 cards and filters to one matching card on search.
- Hardened the same bug pass with a real Project raw-file route test (media bytes/MIME, not HTML 404), scoped empty-Session reuse coverage, per-Session Project runtime ownership, and terminalization of interrupted persisted tool activities.
- Verification: browser first-click checks passed for all three panes; a stop-service/reload/restart fault injection showed an explicit error followed by successful recovery on the next click; Desktop UI 40/40, Svelte diagnostics 0/0, and 24 focused route/session/activity/settings tests passed.

### Refactor: project chat migrated to the per-session runtime registry (concurrent project turns)
- Project chat drove a **single** `ConversationController` whose host `sessionId`/`modelKey`/`thinkingLevel` followed the current selection, so only one project-session turn could run at a time and `stop`/`resolveApproval`/queue cross-wired to whichever session was viewed. The 2026-07-12 fix band-aided this with a pinned `turnSessionId` + `liveTurnVisible` gating + a non-switching `refreshProjectSessionMessages`; this change removes the band-aid by giving project chat the same architecture the main chat already uses.
- Generalized the shared `SessionRuntimeRegistry` (`sessionRuntimeRegistry.svelte.ts`) with three **optional** per-entry resolvers — `projectId`/`modelKey`/`thinkingLevel` keyed by `(profileId, sessionId)` — wired into each pinned host. The main chat's `ChatSessionStore` leaves them unset, so its hosts keep `projectId`/`modelKey` undefined and read thinking from the draft store exactly as before (no behavior change).
- Added `projectChatStore` (`lib/projects/projectChatStore.svelte.ts`), a **module singleton** mirroring `ChatSessionStore`: every project session gets its OWN pinned controller (fixed `personal` profile + sessionId + working directory), so background turns keep streaming into their own transcript while the user views another session, and stop/approval/queue always target the turn's own session. Being a singleton, a project turn survives ProjectChat unmount/remount (pane/project switch); it is torn down only by the host (`ChatView` disconnect reset + `onDestroy`) and per-session on delete (`removeProjectSession` → `disposeSession`).
- Rewrote `ProjectChat.svelte` to drive `projectChatStore` (subscribe to its single `state` store, pin the selected session, send/stop/queue/approval/edit-resend through the store); the transcript now comes from the registry entry, not `projectsStore.messages`. Removed the dead band-aid `refreshProjectSessionMessages` and the `liveTurnVisible` gating. Media/attachment previews, voice recording, and edit-and-resend are unchanged.
- Verification: `svelte-check` 0 errors / 0 warnings; `vite build` succeeds; desktop UI tests 41/41 (`chat-ui.test.mjs` + `http-scope.test.mjs`) and cargo tests 10/10 pass. The two structural assertions in `chat-ui.test.mjs` were updated from the old single-controller design (`createConversationController`/`chat.send`/`modelKey: () => activeModelKey`) to the registry architecture (`projectChatStore.state`/`projectChatStore.send`/`resolveSessionModel`). Behavioral trace: a turn in project session A and a turn in session B now stream concurrently into their own transcripts; Stop in B stops only B; an approval in A resolves against A after viewing B.

### Hardening: pin the full turn context for queued follow-ups in ConversationController
- `ConversationController.send()` pinned only the `sessionId` for a queued follow-up (`drainQueue`), while `profileId`/`projectId`/`modelKey`/`thinkingLevel` were still read live from the host at drain time. With a *mutable* host (the pre-migration single project controller), switching project/session/model before the queue drained could submit the pinned session under a different project or model — cross-project/cross-model wiring. The per-session registry migration above fixes the reported case at the root (each pinned host now returns fixed values), so this is defense-in-depth: the controller now snapshots the whole turn context at `send()` start and a queued follow-up reuses that snapshot, so queue correctness no longer depends on the caller happening to pin its host. `stop()`/`resolveApproval()` resolve `profileId` from the same snapshot for consistency.
- No behavior change for any current caller: every host today (main-chat registry, project registry) is already pinned, so the snapshot equals the live read. Verification: `svelte-check` 0 errors / 0 warnings, `vite build` succeeds, desktop tests 42/42 (`chat-ui.test.mjs` + `http-scope.test.mjs`).

### Fix: model-attempt retries duplicated persisted steps and could re-run non-idempotent tools
- The runner's model-attempt retry loop (`src/lib/server/agent/core/runner.ts`) rolled the in-memory agent context back to `beforeAttempt` on retryable errors but never rolled back the *store*. Because the `message_end` subscriber had already `appendContextMessage`'d the failed attempt's assistant/toolResult steps, and the `finally` block reloads the persisted session log into memory, every retry left duplicated steps in the session and the next turn inherited them.
- Added session-scoped checkpoints to `MomRuntimeStore`: `createContextCheckpoint` snapshots the persisted log length at attempt start, and `restoreContextCheckpoint` truncates the append-only entries log **and** the context snapshot back to it (returns the number of dropped entries). The runner now captures a checkpoint alongside `beforeAttempt` and, on every retry/give-up path (retryable error, empty-response retry, context-overflow compact retry, thrown model error, final-empty exhaustion), rolls back memory and store together via a single `rollbackAttempt()` helper, resetting `assistantMessagePersisted` when steps are dropped. The store call is optional-chained so runner test doubles without the method still work.
- Guarded non-idempotent re-execution: a full re-run would re-fire tool steps already completed in the failed attempt (sending messages, writing files). `resolvePromptAttemptDecision` now takes `attemptExecutedTools`; an otherwise-retryable error is downgraded to `terminal_error` when the failed attempt already produced a `toolResult`, so the run surfaces the error instead of silently repeating side effects. A checkpoint-continue that resumes from the last complete toolResult would also solve this but requires SDK-level turn resumption; the lockstep store rollback is the contained fix.
- Verification: `tsc -p tsconfig.json` reports no new errors in the touched files (pre-existing `hostBash/store.ts` + `settings/store.ts` errors are unrelated); `runnerRetryState.test.ts` 8/8, new `storeContextCheckpoint.test.ts` 3/3, `runner.test.ts` 24/24 all pass.

---
## 2026-07-12

### Fix: four chat stability bugs (session cross-wiring, eternal spinner, plugin settings reset, lost partial output)
- **Project chat session cross-wiring**: the project surface still used a single `ConversationController` whose host `sessionId` followed the selection; a finishing turn's `reload` went through `selectProjectSession` and yanked the user back to the running session, and the live stream/approval card rendered on every session. The controller now records a pinned `turnSessionId` per turn (also used by `stop`, `resolveApproval`, and queue draining); ProjectChat gates all live-turn UI on `turnSessionId === selectedSessionId` and reloads via a new non-switching `refreshProjectSessionMessages`.
- **Eternal tool spinner**: interrupted runs (abort, crash, missing tool end event) persisted activities stuck in `running`, so transcripts spun forever. Server-side `ConversationActivityCollector.finalSnapshot()` closes running entries as errors at persist time (`/api/stream`, `/api/chat`); client-side `finalizeTranscriptActivities` applies the same rule to persisted messages (covers legacy data) while leaving live activity lists untouched.
- **Plugin settings reset on restart**: `SettingsStore` save/load only serialized four `plugins.memory` fields, silently dropping `reflectionTime`, `reflectionNotifications`, `dailyMaterials`, `plugins.hooks`, and dynamic feature-plugin settings blobs on every restart. Save now serializes the whole `plugins` block; load restores it via a new shared `sanitizeMemoryPluginSettings` and passes hooks/dynamic keys through; `sanitizeSettings` preserves dynamic plugin keys too.
- **Lost partial output on mid-run failure**: in `/api/stream`, a client disconnect/stop made `controller.enqueue` throw, killing the whole persistence path so all prior streamed text and tool steps vanished from the transcript. `writeEvent` now tolerates a closed stream so end-of-run persistence always executes, and the catch branch persists the partial text + finalized activities + attachments as an assistant message with an interruption notice, so "继续" has visible anchors (the runner already reloads agent context from the store in its finally). A `assistantPersisted` guard prevents the catch from ever double-appending after the success path already wrote. (Channels were unaffected: `MomRunner.run` returns `stopReason:"error"` instead of throwing, so channel runtimes still persist accumulated text.)
- **Follow-up robustness audit** of the chat surface: (a) input-side cross-wiring — ProjectChat's `handleComposerKeydown`/`queuedMessages` read the raw shared-controller `sending`/`queue`, so a follow-up typed while viewing an idle session was delivered to the *running* background session and that session's pending queue rendered on the wrong session; both are now gated on `liveTurnVisible`. (b) The main ChatView already uses the per-session `SessionRuntimeRegistry`, so it is immune to the bug-1 class; ProjectChat's remaining single-controller design (no concurrent project-session turns) is documented for a future registry migration.
- Verification: `svelte-check` 0 errors / 0 warnings, `vite build` succeeds, desktop UI tests 39/39; settings sanitize/store, conversationActivity, sessions store, and desktop api suites 89/89 (103/103 including desktopPlugins earlier); `tsc` clean on touched files.

### Desktop: inline image and media preview for local project files
- Fixed local project files in the right-hand file panel showing "Binary files cannot be previewed" (for files under 256KB) or "File exceeds the preview limit" (for files over 256KB) instead of showing the actual image/media content.
- Added support for the `raw=true` query parameter on the `/api/settings/projects/[id]/inspection/file` endpoint, allowing it to bypass the 256KB text preview limit and stream the raw file content directly in a native Response with correct MIME types and Cache-Control headers.
- Updated `ProjectFilePanel.svelte` to resolve the `@molibot/shared/filePreview` alias (configured in the desktop Vite and TSConfig paths) and use `mediaTypeFromName` to identify image, audio, or video files. If matched, it dynamically renders the media natively via `<img />` / `<audio />` / `<video />` elements powered by the raw endpoint, enabling large image previews (e.g. 647KB) to render smoothly.
- Verification: `svelte-check` passes with 0 errors / 0 warnings, `vite build` succeeds, desktop UI tests pass.

### Fix: Volcengine reference images were silently ignored
- The Volcengine image provider now forwards `imageGenerate.images` as the official Ark ImageGenerations `image` array. Seedream requests that declare character/reference images are now actual image-conditioned requests instead of silent text-to-image fallbacks.
- Added a provider request regression test covering two reference URLs, model selection, and output size; the image tool suite passes 11/11.

### Fix: Project chat attachments showed only the filename
- Project chat never wired `attachmentActions` into `ChatMessagesPane`, so `TranscriptAttachments` fell back to the bare `attachment-chip` branch and rendered image/audio/video attachments as a name + download button with no preview. The shared transcript renderer needs `filesByLocal` + `loadMedia`/`preview`/`download` hooks to fetch blob URLs and show inline media.
- `ProjectChat` now loads its session file list via `listDesktopSessionFiles` (with `projectId`), keeps a `fileByLocal` map, owns `messageMediaUrls`/`mediaLoading`/`mediaFailed` state, and provides `loadProjectMessageMedia`/`openProjectPreview`/`downloadProjectFile` that call `fetchDesktopFileBlob` with the project id. Switching sessions revokes the cached blob URLs and clears the media state; a preview overlay mirrors ChatView's. `ChatMessagesPane` now receives `attachmentActions={transcriptAttachmentActions}`.
- Verification: `svelte-check` 0 errors / 0 warnings, `vite build` succeeds, desktop UI tests 39/39.

### Desktop: fix project file-panel close button + large image preview
- The Project file panel's top-right close button was unclickable: `.file-panel-head` sat under the 52px-tall `.window-drag-mask` (z-index 30) that overlays the window title bar, so mousedown events were swallowed by the drag region before they reached the button. Lifted the head to `position: relative; z-index: 31` (same trick `.header-actions` already used) so the close/refresh buttons are reachable.
- Large (~1MB+) image previews failed silently because the desktop client used `response.blob()` on a Tauri `plugin-http` streaming `Response`, which truncates on larger transfers; and the server `GET /api/web/files` `readFileSync`-into-`Buffer`-into-`Response` path put the whole file in memory at once. The server now streams the file via `createReadStream` + `Readable.toWeb` with an authoritative `content-length`, and the client reads the body stream chunk-by-chunk into a single `Blob`, so mid-stream errors throw instead of producing a truncated image.
- Verification: `svelte-check` 0 errors / 0 warnings, `vite build` succeeds, desktop UI tests 39/39, desktop API tests 74/74.

### Desktop chat: per-message copy + edit-and-resend
- Added hover-revealed action buttons on every chat message: a copy button that writes the raw Markdown (`message.content`) to the clipboard on both user and assistant messages, and an edit button on the user's own messages. External read-only transcripts surface copy only.
- Edit-and-resend truncates the server transcript at the picked message before re-running the turn, so the history stays coherent instead of accumulating duplicate user/assistant pairs. The composer shows an "editing" banner with a cancel button and the active edited message is highlighted in the transcript.
- New `DELETE /api/sessions/:id/messages?fromMessageId=...` endpoint + `SessionStore.truncateMessagesFrom(conversationId, fromMessageId)` drop the message and everything that follows it; works for both Web and Project sessions via `resolveSessionStorage`. Running sessions reject the edit (409); unknown message ids return 404.
- Front-end client `truncateDesktopMessages` + a per-session edit state in `ChatView` / `ProjectChat`; truncate failures restore the composer so the user can retry.
- Verification: `svelte-check` 0 errors / 0 warnings; `vite build` succeeds; sessions store tests 6/6 (incl. new `truncateMessagesFrom` case); desktop API tests 68/68; desktop UI tests 39/39.

### Fix: Web Host Bash approval auto-resume crashed the sidecar (503 + lost turn data)
- The Web `/hosttools approve` path resumed the session with a bare fire-and-forget `runner.run(...)`. When the approving turn still held the session lock, `prepareTurn` threw `ACTIVE_TURN_CONFLICT` as an unhandled promise rejection, which killed the whole sidecar process — the desktop app surfaced it as a 503 and the in-flight run's tool output was lost. It now reuses the shared `retryApprovalAutoResume` helper (same 1s × 3600 retry policy as channel runtimes), with a busy notice appended to the session if retries are exhausted.
- Hoisted the retry constants into `channels/shared/approvalAutoResume.ts` so Web and channel runtimes share one policy instead of forked copies.
- Added a process-level `unhandledRejection` guard in `hooks.server.ts`: log and keep serving instead of Node's default process kill, so one leaked rejection can no longer take down every in-flight run.
- Verification: `tsc` clean on touched files; approvalAutoResume 3/3, contextBuilder 6/6, turnOrchestrator 15/15 tests pass.

### Bot Project mode: shared agent context with Desktop
- Fixed the Feishu streaming path ignoring the `/project` binding entirely: `processEvent` hand-built its `MomContext` without `project`/model/thinking overrides, so bound chats still ran in the bot scratch directory. Both Feishu paths now resolve the binding.
- Introduced `ProjectAwareRunnerPool`, a project-aware router wrapped around every channel's `RunnerPool`: when a scope has an active Project binding, `get`/`abort`/`steer`/`followUp`/`reset`/`compact` all reroute to the project runtime pool (`<dataRoot>/projects/<id>/runtime`) keyed by the channel conversation key and a real project conversation uuid. Automation `task-*` sessions always stay on the bot pool so scheduled runs never leak into project session lists.
- Project runtime {store, pool} handles now live in a process-wide cache (`projects/runtimeCache.ts`) shared by the Web/Desktop router and the channel router, guaranteeing one `MomRunner` per project conversation across surfaces — a chat started in Feishu Project mode continues on the Mac app with the exact same agent context, and vice versa.
- Channel session messages in Project mode are persisted into the project session store (`projects/<id>/sessions/`), so bound-channel conversations appear in the Desktop project session list. Project conversations opened by id are no longer gated on matching `externalUserId` (projects are owner-scoped), and Desktop runner keys/attachments/host-bash/compact/stop now follow the conversation's own `externalUserId` for cross-surface continuation.
- Verification: `tsc` clean on all touched files; sessions/commands/contextBuilder/router/feishu/telegram/weixin suites 48/48; desktop-chat suite 187/187.

### Desktop plugin settings page collapsed-card refactor
- Reworked the macOS app Plugins section into accordion-style collapsible cards: each plugin (Memory backend settings, Daily materials, Cloudflare HTML Publish, and any other feature plugin) defaults to a single row showing name, description, status badge, enabled toggle, and an Edit button. The full form is revealed only when Edit is clicked; only one card is expanded at a time.
- Removed the bottom “all plugins” list and the total/active/external counts card from this page. Channels (web/telegram/feishu/qq/weixin), providers, and memory backends are not product plugins from the user’s perspective and are surfaced in their own dedicated settings sections, so they no longer pollute the plugin page.
- Split the daily-materials config out of the memory-backend form into its own collapsible card (with its own enabled toggle and the existing backfill action) so each plugin is independently editable.
- Verification: `svelte-check` 0 errors / 0 warnings, all 39 desktop UI tests pass, `vite build` succeeds.

### Bot Project mode
- Added shared `/project` list/select/off commands for Feishu, Telegram, QQ, and Weixin so mobile conversations can enter registered Projects without the macOS app.
- Persisted selection per channel/Bot/conversation and routed following turns through the existing Project-aware Runner context, including Project instructions, Skills, cwd, model, and thinking defaults.
- Added idle-only switching, binding cleanup on Project deletion, and Telegram command-menu discovery.

### Desktop slash suggestions and Project defaults
- Added shared slash-command and enabled-Skill suggestions to Chat and Project Chat, including keyboard, mouse, IME, and accessible listbox interaction.
- Added distinct command and Skill invocation presentation in the shared transcript renderer.
- Added Project settings for instructions, inherited model, and thinking defaults without mutating global model routing.
- Added per-turn model overrides and Session → Project → Global resolution for Project conversations.
- Added end-to-end Project-local Skill discovery from `.agents/skills`, including slash suggestions, explicit invocation, prompt manifests, skillSearch, `/skills`, project-first precedence, and per-Project cache isolation.
- Added inherited Project overrides for Sandbox, tool progress, reasoning display, and automatic runlog notices across Desktop and Project-bound channels; Sandbox reuses the existing runtime semantics unchanged.

### Web and Desktop Trace active-run controls
- Added a shared Active Runs section to both Trace surfaces, refreshed every three seconds and backed by a join between persisted run facts and actual RunnerPool snapshots.
- Distinguishes running, possibly stuck (live beyond ten minutes), and orphaned started records while showing Agent, Bot, channel, task preview, start time, and elapsed duration.
- Stop targets the exact channel/Bot/chat/session runner. Orphan cleanup marks the existing run fact aborted instead of deleting audit history.
- Added narrow shared runtime seams for read-only Runner snapshots and exact-session abort; Channel implementations remain transport-only delegates.

### Desktop Agent Studio
- Added an Agents workspace directly below Skills in the macOS app sidebar, keeping the existing main-window navigation context.
- Displays a single Global/default workstation even when no `settings.agents.default` entity exists, without writing a synthetic Agent back to settings; Bots without an explicit Agent binding report activity there.
- Introduced a responsive isometric office with one desk and animated walking pug per Agent, plus status, description, model-routing summaries, empty/error states, bilingual copy, dark-theme support, and reduced-motion behavior.
- Compacted desks into a responsive 4-column layout that keeps up to eight Agents visible in the standard viewport, stepping down to 3/2/1 columns as width narrows and scrolling naturally beyond eight.
- Added real-time Trace-backed Agent activity: recent run facts are mapped from channel Bot instances to their bound Agents every 2.5 seconds, showing working and short-lived completed/error states without exposing trace payloads or message content.
- Added a “Boss · You” station above the office. Active Agents connect to it through animated dashed links carrying file packets, making live collaboration visible at a glance.
- Reworked the Boss from a floating badge into a complete manager workstation below the windows, with its own rug, desk, chair, monitor, mug, character, and nameplate; the back wall was rebalanced so the station belongs to the office floor rather than overlapping the windows.
- Split pug motion by Agent state: idle pugs lie on cushions and browse glowing phones, while working pugs stand at their computers, alternate both paws on the keyboard, bounce subtly, and pulse the monitor.
- Replaced the static single-file connector with a continuously scrolling dashed data track carrying three staggered file packets; reduced-motion mode disables all loops.
- Nested live Subagent stations under the Agent that delegated them by joining Trace `subagent_task` facts to the parent `runId`. Up to three temporary mini desks and typing pugs render directly, with overflow summarized as `+N` and terminal states expiring automatically.
- Added compact Bot badges to active workstations. Hovering or keyboard-focusing a badge reveals the full Bot name, channel, start time, and a bounded current-task summary; run lifecycle facts persist only a whitespace-normalized 160-character preview for this purpose.
- Prevented orphaned `started` Trace facts from leaving Global permanently busy: runs with no fact updates beyond the 10-minute runtime ceiling plus a 2-minute grace are ignored. Tooltips now state the activity status explicitly, distinguish legacy missing summaries, and raise the active card above neighboring desks.
- Verified with zero Svelte diagnostics, all 36 Desktop UI tests passing, and a successful production build.

### Model routing and AI provider UI optimizations
- Removed the "tts" (Text-to-speech) routing select option from the global capability routing choices, focusing the Models setting page on text, vision, speech-to-text, and subagent core configurations.
- Categorized custom provider models into "Built-in Models" and "Custom Models" tabs, reducing clutter when editing providers (such as OpenAI or Google) with preloaded lists.
- Grouped the custom providers list on the main settings page into "Built-in Providers" and "Custom Providers" tabs, and integrated a search box (fuzzy search by provider ID or name) and an "Active First" sort toggle to simplify list navigation.
- Integrated a search input for matching model IDs and a sorting toggle (Active First vs Default) in the model list. Active models are sorted to the top by default to improve readability.
- Aligned these optimizations across both Svelte 5 Tauri desktop setting views and Svelte 4 web UI pages.
- Fixed a bug where Svelte's reactive statement/effect reset the modelTab and modelSearch states upon any model details modification. State reset is now strictly guarded by changes to the provider ID.
- Changed the newly introduced buttons in the Svelte Web App (+page.svelte) to use on:click instead of onclick, restoring proper Svelte legacy invalidation and redraw capability.
- Verification: svelte-check reports 0 errors and 0 warnings, and all desktop unit/e2e tests pass.

### Daily materials dedicated scan model
- Added an optional per-feature scan model for daily materials: extraction and synthesis calls can run on a smaller/cheaper model, independent of the main chat model. Configured via `dailyMaterials.scanModelKey` (empty = follow main model) with a Desktop dropdown under Memory → Daily materials, populated from `buildModelOptions(settings, "text")`.
- Implemented as a per-call override: `AssistantService.reply` now accepts `{ modelKey }` and `overrideSettingsForModelKey` derives a settings snapshot (pi or custom provider/model) for that one call without mutating global settings. Both the nightly task and the history backfill use it, including every batch/synthesis call.
- Verification: `modelKeyOverride.test.ts` (3), `dailyMaterials.test.ts` (9), `sanitize.test.ts` (9), `desktopPlugins.test.ts` (7), `taskScheduler.test.ts` (5) pass; desktop `svelte-check` 0/0; production `vite build` succeeds.

### Daily materials token-budget batching (replaces 60k-char truncation)
- Replaced the hardcoded 60,000-character tail-truncation (which silently dropped older sessions on busy days) with a token-budget-aware hybrid: within budget → one model call; over budget → pack conversations into batches, extract each, then a synthesis call merges/dedups them into the day's file. No session is dropped; an individual over-budget conversation is tail-truncated in isolation.
- Budget is estimated in tokens with a CJK-aware estimator (CJK≈1 token, else ≈¼) and is configurable via `dailyMaterials.scanTokenBudget` (default 120000, range 8000–900000) with a Desktop number input under Memory → Daily materials.
- Documented what the scan actually sees: only final `content` for user/assistant roles — thinking and tool-call activity live in a separate `activities`/parts channel and never reach the model. New guide: `docs/guides/daily-materials.md`.
- Verification: `dailyMaterials.test.ts` (9, +1 batching/synthesis), `taskScheduler.test.ts` (5), `sanitize.test.ts` (9), `desktopPlugins.test.ts` (7) pass; desktop `svelte-check` 0/0; production `vite build` succeeds.

### Daily materials history backfill
- Added a one-off "Backfill history" action for the daily-materials automation: it scans the full history of authorized sessions and produces one material file per past day, so a project that has already run for weeks starts with a complete corpus instead of only yesterday's file.
- `DailyMaterialsService.run` was refactored into `runForDate` + `runBackfill`; backfill iterates days ascending so the isolated daily-materials watermark advances per day, making the pass idempotent and safely resumable after an interruption. The start date auto-scans the earliest authorized message (`SessionReflectionSourceReader.earliestLocalDate`).
- Exposed as an in-memory background job (`DailyMaterialsBackfillJob`) with a polled progress endpoint (`/api/desktop/plugins/daily-materials-backfill`) and a Desktop button under Memory → Daily materials showing live progress. No CLI required.
- Verification: `dailyMaterials.test.ts` (8, +2 backfill), `taskScheduler.test.ts` (5), `sanitize.test.ts` (9), `desktopPlugins.test.ts` (7) all pass; desktop `svelte-check` 0 errors/0 warnings; production `vite build` succeeds.

### Desktop Chat reasoning, tool activity disclosure, and approval fixes
- Expanded thinking by default across live and historical Desktop Chat messages, while keeping tool activity collapsed until explicitly opened.
- Stopped structured runner diagnostics from also rendering as raw `tool_start=...` / `tool_end=...` message status text.
- Fixed a bug where permission approval buttons (e.g. Host Bash authorization cards) were rendered disabled during active streaming turns due to conflict with the active `sending` flag.
- Refactored `conversationController` to support inline decision submissions that seamlessly resume ongoing SSE streams without hitting process locks or requiring manual poll fallback.

## 2026-07-11

### macOS compliant desktop icon and avatar processing
- Processed the raw square `momo-happy-icon.png` into a macOS-compliant squircle (corner radius 225px on a centered 824x824 body within 1024x1024 canvas) complete with custom dual drop shadows and a subtle border.
- Replaced the default `molibot-icon.png` in the public directory and regenerated the Tauri PNG, ICNS, and ICO app icon bundles for macOS desktop build.

### Daily materials internal automation
- Added a managed `daily-materials` internal event that turns authorized read-only conversation projections into dated Markdown inside a registered Project using a Project-owned prompt template. It has an independent watermark, strict path/symlink and credential guards, no scratch fallback, and never enters ordinary Agent chat history.
- Desktop Memory settings now configure schedule, Project, output directory, prompt path, and completion notices. Manual Automation triggers share the internal runtime dispatcher, and momo-agent includes the extraction/monthly-review templates and updated operating contract.

### Desktop project file panel header alignment
- Aligned the file panel header with the middle chat header by removing the top padding from the panel layout and adjusting the header height to 60px.

### Desktop project creation confirmation
- Fixed the existing-directory flow so selecting a folder shows the chosen path and an explicit Create Project button instead of leaving only Back and Cancel actions. Failed submissions preserve the selection for retry, with matching behavior across both Desktop project entry points.
- Added an ellipsis menu to each Desktop project row with Rename and Delete actions. Removal never deletes the working directory; users may separately opt in to deleting that project's Molibot conversation history.

### Configurable memory reflection schedule and notice
- Added a bilingual Desktop Memory schedule control (`HH:mm`, default 03:00) and completion-notice switch; saving restarts the shared scheduler and safely updates managed reflection events while preserving their status.
- Successful internal reflections notify the Bot's first allowed chat only when new candidates were created. Reflection execution itself continues to bypass the normal Agent Runner.

### Memory reflection and embedding resilience
- Fixed the daily 03:00 reflection window to process the previous complete local day, and isolated malformed extracted candidates without hiding storage failures.
- Embedding API-key rotation now reconfigures the backend using a non-secret digest cache identity; provider failures open a 60-second lexical-fallback cooldown for add/search.
- Replaced quadratic compaction ID membership scans with sets. Covered all five review findings plus infrastructure-failure safety; memory tests pass 24/24 and scheduler/Desktop/API regressions pass 71/71.

### Documentation Archiving
- Implemented a quarterly archiving scheme for CHANGELOG.md and prd.md.
- Moved historical entries from Q1 (Feb-Mar) and Q2 (Apr-Jun) 2026 to docs/archive/ to keep main files under 256KB for better agent readability.
- Added archive index links at the top of CHANGELOG.md and prd.md.
- Documented the archiving conventions in AGENTS.md and CLAUDE.md.

### Memory stable versions and namespace isolation
- Completed Memory Plan T2 + T6a with shared owner/chat/project/agent/content namespace encoding, domain-aware contracts, and an explicit prompt namespace plan that excludes content memory from ordinary chat injection.
- Added additive legacy-safe domain persistence to mory and activated stable canonical paths for structured writes, while preserving unique low-confidence paths for unstructured text and legacy namespace reads.
- Propagated bot/project scope through prompt snapshots and the Agent Memory tool, and made record management, global search, and compaction operate on the record's actual namespace. Verified with 181 mory tests, 23 focused host tests, and a production build.

### Memory reflection, Candidate Inbox, and semantic retrieval
- Completed the remaining Memory v2.2 plan: unified CJK tokenization across retrieval/write decisions, internal daily reflection with per-conversation watermarks, an independent candidate/suppression store, and the single validated confirmation path into mory.
- Added governed importer/json-file migration, configurable embedding retrieval with model-version backfill and lexical fallback, explicit content/agent-self tools, and pin-aware expiry/forgetting.
- Desktop Memory now includes a bilingual Candidate Inbox plus reason, source conversation, version, conflict, expiry, and pin inspection.

### Desktop Project File Panel - Inline Accordion + diff2html + .gitignore
- Replaced the overlay "preview page" with a GitHub-style inline accordion: clicking a file/change row expands its content inline below; click again to collapse. Fixes the preview scrolling away with the list and the fixed-dark overlay not respecting light/dark theme.
- Diff rendering now uses `diff2html` (line numbers, +/- coloring, hunk structure) instead of hand-rolled per-line spans; theme-aware overrides map diff2html's `.d2h-*` to Geist tokens so it follows light/dark.
- Backend tree scan now respects `.gitignore` (via the `ignore` lib) - node_modules/dist/build no longer clutter the file list.
- File rows show per-type Phosphor icons (`ph-file-ts/js/css/py/...`) with GitHub-ish per-language colors. (`vscode-material-icon-theme` is a VS Code extension, not npm-importable, so Phosphor's file-type set is used instead.)
- Change-list status badges are now colored by status (modified=amber, added=green, deleted=red, renamed=blue, untracked=gray) and compact.
- Added thin global scrollbars (10px track / 6px thumb) and `min-height:0` on the panel so long file lists scroll.
- Scope: `apps/desktop` + `src/lib/server/projects/inspection.ts`. Verified: `svelte-check` 0/0, `vite build` clean (diff2html CSS bundled), 8/8 inspection tests pass.
- Deferred (per the IDE-stack discussion): monaco (read-only, no editing), chokidar/fast-glob/fdir/@tanstack/virtual (no matching features yet). simple-git rejected in favor of the existing hardened `runGit`.

### Desktop Project File Panel Overhaul
- Fixed undefined-token bugs: `var(--background)`/`var(--background-secondary)` (active tab, preview overlay, code block, media, focus ring) now map to `--card-bg`/`--surface-secondary`/`--code-bg`; the loading spinner's `animation: spin` referenced a non-existent keyframe and now uses `project-spin`.
- Restructured the file/code/diff/attachment preview into a non-scrolling `.project-panel-body` so the overlay pins to the viewport instead of scrolling away with the file list.
- Replaced 0.5px panel borders with 1px `--separator`.
- Normalized the panel shell and `.project-*` content onto the Geist scale: 32/48px padding, 32/40/48px heights, `--rounded-sm`, >=12px fonts, code on `--code-bg` at 12/16.
- Diff view now renders line-by-line with +/- added/removed/hunk coloring (was a plain `<pre>` with no styling).
- File rows get a copy-path action (clipboard) on hover; empty states get icons; breadcrumb uses a caret separator instead of a raw "/".
- Note: download for project tree files needs a backend blob endpoint (not present); attachments already had download. Scope: `apps/desktop`. Verified: `svelte-check` 0/0, `vite build` clean.

### Desktop Geist Typography & Elevation Polish
- Loaded the actual Geist Sans (400/500/600) and Geist Mono (400) webfonts via Fontsource so the `DESIGN.vercel.md` type system renders instead of silently falling back to San Francisco; CJK still falls back to PingFang SC through the existing font stack.
- Converged letter-spacing onto the Geist spec: headings now use negative tracking (page/empty-state h2 at `-0.04em`, brand title at `-0.02em`) instead of loose positives, and the loosest tracked caps (`0.08em`/`0.07em`) were brought down to a standard `0.04em`.
- Reduced ad-hoc box-shadows to the three Geist elevation tiers (raised card / popover / modal) plus functional focus and selection rings: removed decorative avatar and inset-highlight shadows, fixed an undefined `--shadow-card` reference that left the active project-file tab with no shadow, and replaced heavy 30-72% opacity dialogs/popovers with the spec token values (added a `--popover-shadow` tier for menus and floating bars, with dark-theme variants).
- Removed the half-pixel `13.5px` empty-state body size (Geist has no 13.5px; snapped to `14px` / copy-14).
- Verified: `vite build` bundles the Geist woff2 assets and `svelte-check` reports 0 errors / 0 warnings. Scope: `apps/desktop` only.

### Desktop Sidebar Hierarchy & Spacing
- Inverted the sidebar's 3-level color hierarchy: the expandable section headers (对话/项目) are now `label-secondary` (lighter, since they only collapse) and their channel/project entries are `label-primary` (darker, the actual targets).
- Removed the leading icons from the 对话/项目 section headers (text + caret only) so level-1 and level-2 no longer share an aligned icon row; channels keep their icons.
- Indented level-2 (channels and project sub-groups) by 8px relative to the level-1 headers.
- Normalized sidebar spacing onto the Geist 4/8/12/16 scale: nav-to-tree gap 14px→8px, section padding, tree-title/header min-heights 34→32.
- Footer spec fix: height 46→48px, padding 22→8px (content now aligns with the nav items), and removed the full-width horizontal bleed so the footer and its top border sit within the sidebar's content box like the rest of the chrome.
- Verified: `svelte-check` 0 errors / 0 warnings, `vite build` clean. Scope: `apps/desktop`.

### Support Files and Media Preview for External Sessions
- Fixed an issue where files generated in the `scratch/` directory of external sessions (such as Feishu, Telegram, WeChat) could not be listed in the "Files" pane, and inline media files could not be previewed or downloaded from the conversation transcript.
- Updated the external session view to pass `attachmentActions` to `ConversationTranscript`, allowing Svelte message bubbles to correctly load and display inline images/media below their conversation turns.
- Updated `openSession` in Svelte desktop front-end to trigger `refreshFiles` for read-only external sessions, resolving the real profileId (botId) and the base64-encoded sessionId to pass correct context to the backend.
- Updated `buildDesktopExternalTranscriptMessage` to preserve the relative `local` path of attachments, and updated `buildMessages` in `externalSessionsFromContexts.ts` to decode attachments from the message JSONL. This allows the frontend Svelte components to match message attachments against the list of session files.
- Fixed generated images/videos not appearing inline in the external transcript: `imageGenerate`/`videoGenerate` never write `message.attachments`, so `buildMessages` now recovers the produced file from the toolResult `details` (`filePath`/`videoPath`) and attaches it to the following assistant message, with `local` resolved relative to the session workspace so it matches the Files-pane scan.
- Fixed user-sent images/voice not previewing inline in the external transcript: external channels fold inbound attachment paths into the user message's `<channel_attachments>` block instead of `message.attachments`, so `buildMessages` now parses that block, recovers each attachment (path-relative `local`, extension-derived `mediaType`/`mimeType`), and strips the raw block from the displayed text. The `/api/web/files` endpoint now scans the per-session `attachments/` directory alongside `scratch/` so user-sent files appear in the Files pane and are servable.
- Derived a real `mimeType` from the filename extension for externally scanned files (previously always `undefined`, which served `application/octet-stream` with `nosniff`); shared the lookup via `mimeFromFilename`/`mediaTypeFromName` in `$lib/shared/filePreview`.
- Enhanced the `/api/web/files` endpoint to decode external session references, recursively scan files in their `scratch/` directory, and serve external resources directly from the respective channel's bot directory.
- Tightened the external-session file filter to match the scanned relative path only (previously also matched bare basenames, which could surface unrelated files whose name happened to appear in the transcript). Also fixed the Project branch of that endpoint to use `getProjectConversation(projectId, sessionId)` instead of a malformed single-arg `getConversationById` call.

### WeChat/External Session Loading Fix
- Fixed an issue where clicking a WeChat or other external channel session prompted "Session not found". The SvelteKit desktop backend was overly strict when validating the decoded opaque session reference path segments, treating any segment containing `@` (such as `o9cq803dQf4bT1KSlE1f0Bb8sxmc@im.wechat`) or other special symbols as path traversal and returning null.
- Relaxed the safety boundaries in `isSafeSegment` to allow safe characters: `@`, `:`, `+`, `%`. This maintains full path-traversal resilience while enabling correct parsing of all third-party channel identifiers.

### Project Session output safety
- Project Bash no longer relocates project-root files based on mtime, and full truncated output is stored under the Project runtime instead of `.mom-tool-output` in the project.
- Started explicit Project output routing: `write` defaults to the project root, supports a scratch target, and returns structured relative-path details.
- Fixed `write` absolute-path root classification to check the scratch root before the project root, so a scratch path nested under the project root is correctly classified as `scratch` (previously the project-root check won first and produced a wrong relative path).
- Removed the unused `toolOutputRoot` field from `RunOutputLayout` (write never read it; bash already receives its tool-output dir separately via `toolOutputDir`).
- Fixed a pre-existing crash in Host Bash approval lookup/auto-reason: the `one-time-script` command classification has no `capabilities` array, so accessing it in the non-persistent-capability branch threw. One-time scripts now short-circuit (no persistent pre-approval) with a tailored reason string.
- Added the first bounded, read-only Project tree/file/Git inspection routes with root-confinement and hardened Git subprocess execution.
- Replaced the unusable Project attachment-only pane with a working Files / Changes / Attachments inspector, including directory navigation, file and diff previews, Project-aware session attachments, bilingual copy, and responsive Geist styling.
- Completed Project inspection hardening with cursor pagination, explicit truncation, binary/oversized handling, empty-repository behavior, and parent-repository path isolation; file-producing tools now return consistent structured path details.

### Desktop automation state auto-refresh and sidebar leak fix
- Fixed an issue where scheduled task runs executed with `sessionMode: "chat"` would leak event conversations into the left sidebar's chat tree due to missing `origin: "automation"` flags on reused conversations.
- Introduced an auto-refresh workflow for the Desktop automation workspace page (`TasksSection.svelte`). It integrates automatic reloading `onMount`, page-visible revalidation via the browser Page Visibility API, and a 30-second interval poll to ensure task statuses are dynamically updated when tasks fire background triggers.

## 2026-07-10

### Memory search CJK tokenization (Memory Plan T1a)
- Added a shared CJK-aware tokenizer to the mory SDK (`moryTokenize.ts`: initially Intl.Segmenter, upgraded to Jieba search mode on 2026-07-17, plus CJK character bigrams, stopword filtering, and query-weight normalization) and switched all three host keyword-scoring sites to it (mory backend, json-file backend, prompt memory-row selection). Chinese queries previously collapsed into a single whitespace token, degrading memory search to whole-sentence substring matching.

### DuckDuckGo / Web Search UX polish
- Polished the built-in search tool response summary to distinguish between successful queries with no search results and configuration errors. When a search engine successfully queries but returns 0 results, the system now returns "No search results found." instead of "No configured search engine returned results.".

### Desktop automation watched-event routing
- Fixed Desktop Automation task creation to store events in the bot-level watched `events/` directory while preserving the selected chat as the delivery target. At scheduler startup, legacy Web events found in chat scratch directories are moved into the watched directory, so previously created tasks resume running without manual recreation.

### Desktop Automations
- Reworked the Chat Automation workspace into a compact task list with a selected-task detail and execution-history pane, substantially increasing list density for larger task collections.
- Added visible active states for the Automation and Skills sidebar shortcuts, with localized, themed, keyboard-focusable, narrow-window behavior preserved.

### Desktop settings synchronization and unsaved model pulling
- **Multi-window dynamic sync**: Integrated BroadcastChannel to broadcast settings changes from the Settings window to the main Chat window, avoiding app restarts when adding custom providers or updating model settings.
- **Pull models before saving**: Updated the `/api/desktop/provider-models` endpoint and UI disabled properties to support pulling model lists using transient form inputs (baseUrl and apiKey) before a provider is saved.

### Unified Desktop conversation and project navigation
- Projects no longer open a separate Desktop page. The Chat sidebar now has independently persistent Conversations and Projects trees; channels/projects and their Session children can be expanded concurrently without changing the active chat.
- New Web and project conversations are now saved immediately through a shared create-or-reuse-empty Session Store contract. Each Web Profile/project scope reuses its single empty Session, preventing missing `New Session` rows and duplicate blank sessions. Headers show `source or project / session` and active-session deletion selects the next sibling or clears selection.
- Follow-up visual pass: removed the duplicate Projects subheading, promoted Conversations/Projects to icon-led primary sidebar headings, hid expand/add affordances until hover/focus, removed sidebar horizontal scrolling, constrained Session titles to a 30-character visual width, and gave right-side timestamps/menus safe padded overlay positions. Project headers now omit the avatar and use the same Search/Files actions as Chat.

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

### Fixed: stale skills-locale test and repo-wide ProviderModelConfig `enabled` type debt
- Fixed the long-failing `skills.test.ts` formatter test: the June command-i18n change made formatters default to English with opt-in `locale: "zh-CN"`, but the test still asserted the old hard-coded Chinese output. The test now asserts the English default and adds an explicit zh-CN case; the agent suite is fully green again (380/380). Also passed `locale` through the one `/skills <id>`-not-found branch in channelCommands that had missed it.
- Cleared every `Property 'enabled' is missing` TypeScript error against `ProviderModelConfig` (22 sites across 6 test files plus 3 production spots: the ai-meta custom-provider template, the env-provider default model, and the legacy provider migration). Runtime consumers treat missing `enabled` as enabled (`!== false`), so `enabled: true` is behavior-preserving; tests run through tsx (no typecheck), which is why these never failed at runtime.

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

### Settings API split into per-module endpoints, Desktop/Web persistence dedup
- Retired the monolithic `GET/PUT /api/settings` (full `RuntimeSettings` round-trip) and the unsanitized `dynamic/[key]` catch-all. Each settings page now reads and writes only its own slice via dedicated, validated endpoints: `/api/settings/locale`, `/api/settings/mcp`, `/api/settings/skills`, `/api/settings/skill-drafts`, `/api/settings/plugins`, `/api/settings/system`, `/api/settings/sandbox`, `/api/settings/web-search`, `/api/settings/image-generate`, `/api/settings/video-generate`, `/api/settings/tts-generate`, `/api/settings/agent`, `/api/settings/channel-instance?channel=xx`, `/api/settings/ai-routing`, `/api/settings/custom-providers`, `/api/settings/model-switch`, `/api/settings/profile-files`. This closes the unsanitized `runtime.updateSettings({[key]: rawBody})` write path that web-search/image/video/tts/sandbox pages were previously using.
- All per-slice persistence now runs through pure handlers under `src/lib/server/settings/handlers/` that take a `SettingsAccessor` (`{getSettings, updateSettings}`), enabling unit tests without touching real storage and eliminating the previous Desktop/Web drift where desktop routes bypassed the web validators. Shared validators (agent references, skill-draft path, cloudflare-plugin config, timezone) moved to `src/lib/server/settings/validators.ts`.
- Extracted reusable sanitizers from the old monolith path: `sanitizeSingleAgent`, `sanitizeSingleChannelInstance`, `sanitizeModelRoutingConfig`, `sanitizeModelFallback`, `sanitizeCompaction`, and `sanitizeAiRoutingConfig`. `sanitizeSingleAgent` and `sanitizeSingleChannelInstance` now throw typed errors instead of silently skipping rows, which improves diagnostics during bulk replace.
- Custom-providers hardening: `POST/PUT/DELETE /api/settings/custom-providers` now route through the same sanitizer as the rest of settings (models, tags, verification, defaultModel, path, thinking/reasoning config), fixing the earlier drift where ad-hoc provider objects could be persisted with missing fields or string-shaped models. Desktop `providers` route now applies the same sanitization before persisting.
- The root Chat model switcher now calls `POST /api/settings/model-switch` and writes the selected route without overwriting the independently configured global `providerMode`; runtime reads compose three narrow endpoints instead of pulling the whole settings object, and the model-routing page no longer echoes `customProviders` back on save.
- Desktop routes (`/api/desktop/{plugins,skills,agents,channels,profiles,providers,model-routing,mcp,sandbox}`) keep their credential-safe `buildDesktop*Summary` projection DTOs but share persistence through the new handlers, ensuring validation runs on both surfaces. Plugin memory writes preserve embedding, reflection, notification, and daily-material fields. Desktop service-port controls now use `/api/settings/system`, including range and port-availability validation. `upsertCustomProvider` now accepts `{activateAsDefault, switchToCustomMode}` options so desktop can create-and-activate without inline persistence logic.
- The full `/models` fetch/parse/error pipeline (URL+headers, HTTP errors, JSON parsing) is now shared between web and desktop via `listProviderModels()` in `providers/customProtocol.ts`, with a typed `ProviderModelsError` carrying the status code.

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

### macOS Automations: list-first execution controls
- Made the Automation workspace list-first: details now open only after selecting a task and can be closed, while compact header totals and per-row execution count/last-run metadata preserve scan density.
- Replaced the page-wide manual-run lock with task-scoped running indicators, so unrelated tasks remain selectable and actionable while another run is pending.
- Added persisted pause/resume for periodic watched events and a scheduler guard for disabled events. Also fixed the non-`task-*` automation-session origin path and the overlapping Session timestamp overlay.

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
