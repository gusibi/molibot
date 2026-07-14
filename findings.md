# GitHub issue #13 completion re-audit (2026-07-14)

- The prior delivery statement conflated green structural tests for the selected
  P0 + coupled P1 slice with verification of all 33 PRD sections. The user correctly
  challenged that conclusion, specifically citing oversized/mismatched Settings selects.
- The re-audit must use screenshots captured in this run; old preview screenshots and
  prior narrative cannot serve as audit evidence.
- Product-design audit routing requires current Browser capture, saved/inspected images,
  step-specific findings, accessibility limits, and an explicit health rating per step.
- No saved Product Design context exists, so the current PRD, `DESIGN.md`, code, and
  newly captured Molibot pages are the only valid grounding sources for this audit.
- A Molibot service is responding on port 3000, although `/api/status` itself is not
  the valid status route. Vite is configured to proxy `/molibot-api` to that service,
  so a current Desktop dev page can exercise real settings data instead of fake preview HTML.
- Port 1420 is the active Tauri/Vite Desktop development surface, started with the
  real desktop host and Node service. It returned the current app HTML successfully.
- The current audit browser is the in-app surface required by the Product Design
  workflow. It has no prior controlled tab, so the audit will open a fresh local
  Settings tab and leave no browser state behind after evidence capture.
- Fresh Settings DOM evidence confirms the current General screen uses a native
  combobox for locale and retains every existing Settings navigation group. In the
  browser surface, the service is shown as disconnected because Tauri ownership/status
  APIs are not present; screenshot evidence for loaded model/provider data needs either
  a proxy-backed preview or the native Tauri window.
- The audit will explicitly use the PRD's 860×620 minimum viewport through the browser's
  supported viewport capability and reset it before cleanup.
- Screenshot 01 (General, Chinese, dark/system appearance, 860×620) is valid and shows
  the setting column fitting the minimum width. It also exposes visual mismatches that
  the prior audit missed: the page uses extremely small/dim sidebar and secondary copy,
  the title/content relationship is sparse rather than native-dense, and the select is
  visually a Web-style bordered capsule rather than a macOS popup control.
- The screenshot file was saved and reopened at original resolution. Dark rendering is
  readable in the browser capture but very low-contrast in the standalone image viewer,
  which itself reinforces a contrast risk and makes a light-theme evidence capture useful.
- The first light-theme capture makes the control problem clearer: General's select is
  32px-high by shared CSS and uses 13px text, but its native popup styling remains visually
  mismatched with other Settings controls; card rows and navigation text also read much
  smaller than the PRD's intended 13–14px hierarchy at 860px.
- Source inspection confirmed a plain browser at port 1420 intentionally reports the
  service disconnected. A separate proxy-backed audit server on port 1421 can use the
  real port-3000 data through the app's documented preview path, without changing product code.
- The proxy-backed Settings page reports Ready and loaded real configuration: text model
  `[Custom] CliProxyAPI / tencent/hy3` and two Web Profiles. This is the correct evidence
  surface for populated Models/Providers controls.
- The live Models DOM directly disproves a central PRD acceptance item: visible selected
  options still use engineering-first labels such as `[Custom] CliProxyAPI / tencent/hy3`,
  `[Custom] Moli-qiniu / doubao-seed-2.0-lite`, and raw provider/model paths. Adding the
  same raw key below the select made the technical exposure more prominent, not secondary.
- The page still contains long native selects with 16+ engineering-labelled options and
  a very large timezone select. Two screenshot calls timed out on this populated page;
  DOM evidence is valid, but a clipped capture is still required for visual audit evidence.
- Exact live measurements for all 12 Models selects: model selects are 260×32px,
  font 13px/400 using the system stack, padding `0 28px 0 11px`, radius 8px.
  The PRD specifies 260×30px and 13px, so the user's “large” perception is not mainly
  a raw height/font-token error. It is driven by long engineering-first labels, repeated
  raw IDs beneath controls, full-width 576px row framing, and inconsistent auto-width
  selects (67px/132px) alongside 260px selects. Therefore the visible complaint is valid,
  while the precise root cause differs from “all dropdowns have a huge font.”
- The third clipped Model screenshot also timed out. This page has a named screenshot
  blocker; its current DOM and computed styles remain usable evidence, but not a visual
  accessibility-compliance claim.
- Providers is also materially incomplete against the PRD. The live page still exposes
  raw primary names such as `[Built-in] amazon-bedrock`, protocol URLs, raw default model
  IDs, and dozens of disabled built-ins in the main scan path. The PRD requires human names
  first and technical IDs/details in a secondary layer.
- Provider controls are inconsistent even within the same page: four selects measure
  106×32, 190×32, 156×32, and 160×32, all at 13px. This directly fails “同组 Select 等宽”
  and explains why the overall control rhythm feels wrong even though each height is near spec.
- The populated Provider screen renders 30 setting rows and 119 buttons in one DOM,
  producing a high-density admin list rather than the intended constrained Settings template.
  Switching the sort action to a Switch and moving Delete to overflow fixed two individual
  controls but did not complete the page-level information architecture.
- Provider screenshot capture also timed out because of the populated long list. This is
  a named evidence limit, not grounds to infer visual completion.
- Trace completed several isolated checklist items (human long duration, “未关联会话”,
  metric-dot treatment, overflow actions), but the live page remains an unbounded dashboard:
  it renders dozens of “current” rows, most marked unlinked, with raw user prompts, event
  payloads, absolute machine paths, and long URLs directly in the primary Settings scroll.
  This contradicts the PRD's restrained data template and “technical/raw detail secondary” rule.
- The Trace copy says it excludes raw fact content while the current-run list exposes raw
  task previews. Even if technically not a stored fact body, this is a user-facing trust and
  information-hierarchy mismatch that the prior structural test could not detect.
- Trace screenshot capture timed out once on the unbounded live list and was not retried.
- The live Settings → Automatic Tasks page is a decisive inconsistency against the PRD: at 860×620 it renders
  eight fully expanded `<article>` cards, each with checkbox, always-visible Run/Edit/Delete,
  raw task body, raw cron, channel/Bot/chat technical IDs, and three execution rows. It is not
  the specified 300–320px task list + selected Detail Inspector presentation.
- The task DOM shows raw absolute paths and internal skill invocation payloads in primary
  content, contradicting both technical-detail hierarchy and the project rule against
  leaking machine-specific absolute paths into UI examples/presentation.
- The earlier regression only asserted that `.automation-workspace-layout` CSS and an
  alternate list/detail markup fragment existed in source. It did not prove that the real
  user-task branch at runtime used that layout—this is exactly why 49/49 structural tests
  were insufficient evidence for completion.
- Source clarifies the split: Chat's Automations workspace passes `presentation="workspace"`
  and gets the new list/detail branch, while Settings renders `<TasksSection />` with the
  legacy expanded-card branch. Thus the three-column code exists, but the product still
  exposes two incompatible Automatic Tasks designs. A “unified App” acceptance claim fails
  until the duplicate Settings entry is removed, redirected, or migrated.
- Source-wide P2/Apple-interaction scan found reduced motion/transparency and some focus/
  Escape handling, but no global Command+F/Command+, undo deletion, scroll-edge state,
  gesture-close inspector, low-performance mode, or complete screen-reader verification.
  These PRD enhancements were not implemented or verified and must not be marked Done.
- The Browser backend returned JPEG screenshot bytes even though the internal evidence
  files were initially named `.png`; this caused the standalone inspector's black/missing
  rendering. The accepted General captures will be converted to true PNG before handoff.
- The converted light General screenshot was inspected successfully and accepted as the
  audit's visual evidence. It shows the compact control metrics but also the unfinished
  hierarchy: very small secondary copy, low-density empty space, Web-card framing, and a
  native select that does not visually belong to a unified macOS control set.
- A fresh Chat preview tab loads the main shell and Auto Tasks entry, but the browser-only
  origin shows the first-launch modal despite the Settings preview having real model/profile
  data. This is preview-state divergence, so the modal must be dismissed before the Chat
  Automations workspace can be audited; it is not evidence about the native app's onboarding.
- Chat → Auto Tasks does use the new workspace branch and is healthier than the Settings
  duplicate: tabs, search, summary, and a listbox are present, with separated “待触发/已暂停”
  and last-trigger text. However, every task row still shows raw cron (`0 8,20 * * *`,
  `10 19 * * *`) instead of the PRD's human schedule (“每天 03:00” style).
- At the 860px breakpoint the unselected list correctly occupies the available content and
  a selected inspector should overlay from the right. That behavior still needs one selected
  task check; the Settings/Chat design duplication remains regardless.
- Selecting a Chat task confirms the 860px right-side inspector behavior and the four
  separated dimensions (enabled, current execution, schedule state, latest result). Those
  are genuine completed requirements. The detail still promotes channel/Bot/chat IDs,
  raw cron, `agent`, raw session IDs, full task payload, and absolute paths, so its content
  hierarchy remains only partially migrated.
- The inspector retains the correct overlay close affordance at the narrow breakpoint;
  source CSS hides it for fixed wide mode. This acceptance item is complete.
- The Chat Message Unit is only partially complete: flat assistant presentation and
  compact composer widths exist, but identity falls back to generic `Molibot` and the
  raw model key remains primary metadata instead of a human-readable model name.
- Shared Settings coverage is incomplete. `sectionDescription()` returns descriptions
  for only Models, Providers, Trace, Tasks, and Usage; most Settings routes still have
  a title without the PRD's consistent explanatory hierarchy.
- The proposed shared `AppShell`, `PageHeader`, `SettingGroup`, and `SettingRow`
  primitives do not exist as source components. The implementation relies mostly on
  one large semantic stylesheet; eight Svelte files still contain local style blocks.
- The radius system is not globally converged to the PRD tokens: product CSS still
  contains 9px, 10px, 15px, and 18px radii, plus many decorative one-offs. It also
  contains 50 hard-coded transition declarations rather than a fully tokenized motion
  system. These facts disprove an app-wide design-system completion claim.
- Final health: General Settings partial; Models fail; Providers fail; Trace partial;
  Automatic Tasks partial in Chat and fail in Settings; Chat partial; P2/Apple interaction
  mostly missing or unverified. Therefore Issue #13 is not complete and the product docs
  that currently mark it delivered overstate the implementation status.

---

# GitHub issue #13 PRD implementation (2026-07-14)

- The source of truth is GitHub issue #13 plus its comments; implementation
  decisions remain open until that context is loaded and reconciled with `prd.md`.
- Project rules require the minimum surgical change, red regressions for confirmed
  gaps, shared-layer ownership for cross-channel behavior, and synchronized docs.
- Resource: https://github.com/gusibi/molibot/issues/13
- Anonymous web open returned a cache miss; authenticated repository API access is
  the next distinct read path.
- Authenticated Issue #13 is open, has no comments, and defines a comprehensive
  macOS App redesign: shared shell/sidebar/tokens/components; Chat, Models,
  Providers, Trace, and Automation page changes; consistent status/copy/time;
  interaction, material, accessibility, keyboard, and performance requirements.
- The issue explicitly rejects a rewrite of business logic or technology. Its
  implementation order starts with shared design foundations, then page templates,
  then complex pages and detail consistency.
- `frontend-design` is being applied as restrained native-tool refinement. Its
  generic preference for distinctive fonts/decoration is subordinate to Issue #13
  and `DESIGN.md`, which require system Chinese typography, restraint, accessibility,
  tokenized CSS, responsive behavior, and semantic rather than decorative motion.
- Current `DESIGN.md` is a 498-line Geist light-theme specification. Issue #13
  proposes upgrading it to a Molibot macOS product spec while retaining Geist as
  a local component/content reference; existing focus, contrast, responsive,
  semantic-state, low-shadow, and reduced-motion rules remain compatible.
- The full Issue has 33 sections. Automatic Tasks is explicitly a three-column
  Global Sidebar + 300–320px Task List + flexible Detail layout; tabs/search/stats
  belong only to the list, cron is humanized, and enabled/schedule/execution/latest
  result/history are separate presentation dimensions.
- Shared-component requirements prohibit page-local copies of search, select,
  badge, setting row, page title, sidebar item, card, and icon button. Suggested
  primitives include AppShell/PageHeader/SettingGroup/ListPane/DetailInspector,
  MetricCard, OverflowMenu, Composer, MessageItem, and EmptyState.
- Desktop responsiveness is window-oriented: minimum 860×620, three-column task
  layout preferred above 1100px, inspector overlays below the threshold, settings
  content 576px, data 640–720px, message/composer 720px, inspector at least 420px.
- Statuses must combine readable text/icon/shape with color; technical IDs and raw
  cron remain secondary detail/tooltip content, never the primary visible label.
- The Desktop is Svelte 5 with one 2,303-line shared `styles.css`, a 619-line
  settings shell, and a 2,177-line Chat shell. Existing shadcn-svelte sources live
  in root `src/lib/components/ui`, including Button/Select/Switch/Tabs/Badge/Card,
  but Desktop sections mostly use shared semantic class names rather than imports.
- Current shared seams already exist for Chat sidebar/composer/transcript, while
  Models, Providers, Trace, and Tasks are extracted sections. This makes a shared
  token/primitives + targeted markup migration viable without touching business logic.
- The worktree was clean before this task; only the three planning files are now
  modified, all by this implementation session.
- Chat already has a continuously resizable 220–420px sidebar with keyboard arrows,
  persisted width, and shared `ChatSidebar`; this satisfies part of the interaction
  model and should be normalized to the Issue's 260px default rather than replaced.
- Existing Desktop scripts support Svelte diagnostics, structural UI tests, Tauri
  tests, and production build. Root also has a focused `test:desktop-chat` API suite.
- Automatic Tasks already has a Workspace presentation with category tabs, search,
  summary, list/detail layout, 30-second visible polling, and separate `enabled`,
  runtime status, execution history fields. Confirmed gaps: the detail still has a
  close button in fixed mode; list/detail widths are fluid rather than 300–320px +
  flexible; row copy combines schedule/status; destructive actions are always visible;
  narrow mode stacks detail rather than using a right-side overlay.
- Chat already renders assistant content without a bubble, hover-only message actions,
  model/time metadata, and a sidebar resize interaction. Current assistant content can
  grow to 820px, exceeding Issue #13's 720px target; identity must be checked in markup.
- Shared settings CSS already provides 260px-ish sidebars, 576–640px sections, 260px
  selects, 50px rows, low-shadow cards, dark theme, reduced transparency/motion, and
  sticky save footbars. This is an evolutionary token/semantics alignment, not a fresh UI.
- Provider filtering currently uses handwritten tab buttons and an outlined button as
  a persistent sort toggle—the exact control misuse identified by the PRD. Provider
  delete actions are also visibly inline rather than overflow-menu actions.
- Settings shell already uses the prescribed 228px sidebar and sticky scroll content,
  but its PageHeader contains only a title; every section separately emits hints.
  A shared section description map in `App.svelte` can produce one consistent title +
  description header without rewriting section business logic.
- The root font stack currently prefers Geist before Apple/system fonts, directly
  conflicting with the PRD's Chinese-first system UI stack. Tokens use 6/12/16 radii,
  while the PRD requires 6/8/12/full. Existing accessibility includes focus-visible,
  dark/system themes, reduced motion, and reduced transparency; increased contrast is missing.
- Models routes can show human-readable `option.label`, but rows lack route descriptions,
  empty options, and technical secondary text. Task-strength labels are currently
  Haiku/Sonnet/Opus-first and need user-facing light/balanced/powerful/deep labels.
- Trace uses a product hint and semantic chart colors already, but orphan wording remains,
  stop/delete is a persistent danger button, and KPI styling must be checked for the strong
  top accent. `formatDurationMs` is shared and is the right seam for human-readable duration.
- Assistant messages still lack an explicit identity header. Their content is flat rather
  than bubble-styled and actions are hover-revealed, so adding an Agent identity line plus
  narrowing the shared message width completes the Message Unit without changing transcripts.
- Composer is a shared auto-growing shell with separated tools/selectors/action slots; its
  textarea starts at two rows and must be normalized to a ≤64px compact default via shared CSS.
- Task and Trace contracts already expose enough data for the PRD presentation without
  persistence or runtime changes. `DesktopTaskItem` has enabled, scheduling text/timezone,
  task status, executions, count, and last error; active Trace runs have running/stuck/orphan,
  start time and duration.
- `formatDurationMs` currently emits unbounded minutes (`6927m 53s`). A separate locale-aware
  long-duration presentation helper is safer than changing compact durations used elsewhere.
- Existing structural `chat-ui.test.mjs` is the established regression seam for shared markup
  and CSS contracts; `api.test.ts` is appropriate for exact duration behavior.
- Live preview checks at 860×620 and a wider desktop width confirmed that Models,
  Trace, Chinese/English copy, and light/dark themes retain readable hierarchy and
  usable controls. The model selector remains legible at the minimum target width.
- Visual QA found two shared-shell defects: wide PageHeader content did not align with
  centered setting/data cards, and the English “Save and restart” label could wrap in
  a fixed-height button. Both belong in shared shell/button CSS, not page overrides.
- The preview flag intentionally points API requests at a fake `/molibot-api` endpoint;
  the large General-page error body observed in the browser is Vite's HTML fallback,
  not a runtime/API regression. Other inspected pages render independently of that body.
- Usage still emitted its own hint after the shared PageHeader gained descriptions;
  removing the duplicate keeps one stable information hierarchy.
- Adversarial review found that an unconfigured route with available model options
  could still select the browser's first option visually, and that the first Message
  Unit pass labeled every assistant as Molibot. The empty route option now follows
  `currentKey`, and Chat passes the active Agent/Bot name through the shared live and
  persisted transcript components (including streaming messages).

---

# Bot Project mode (2026-07-12)

## Release v2.4.7 / Desktop v0.4.4 (2026-07-14)

- Base-10 patch increment resolves root 2.4.6 to 2.4.7 and Desktop 0.4.3 to 0.4.4.
- Tag v2.4.7 does not exist locally; v2.4.6 is the newest matching local tag.
- The release should make Agent entries the durable transcript owner, preserve
  partial output on Stop, and make shared RunnerPool activity stoppable from Trace.
- HEAD, origin/master, and tag v2.4.6 initially resolve to the same commit;
  a fresh remote fetch is still required immediately before commit/push.
- Release notes must use the CHANGELOG delta from v2.4.6, not every entry under
  the shared 2026-07-14 date heading.
- GitHub reports v2.4.7 as published, non-draft, and non-prerelease on master at
  2026-07-14T12:43:00Z. Issues #6, #11, and #12 are closed against that release.


## GitHub issues #8, #6, #12, #11 audit (2026-07-14)

- Audit started from the issue tracker before selecting any implementation.
- The user authorized closing issues that are already complete and implementing
  missing behavior for those that are not.
- Issue #8 is open and contains eleven concrete Desktop/Web UX requests:
  startup progress, first-reply session rename, compact message metadata/actions,
  assistant model display, code copy/highlighting, long-user-message folding,
  Project Enter behavior, Agent rather than Profile mentions, queued-message
  presentation, Skill invocation presentation, and a log page.
- Direct anonymous GitHub reads for #6, #12, and #11 returned cache-miss errors;
  use the authenticated GitHub CLI/API next to gather their full bodies/comments.
- Planning-file update attempt 1 missed a stale template table context; the
  retry is split into exact top-of-file hunks and did not touch product code.
- Authenticated issue context confirms #6 is intentionally still open after a
  v2.4.4 first stage: UI Sessions still retain a compatibility transcript and
  must become UI-metadata-only without losing attachments, activities, or edit/resend.
- Issue #11 requires Stop to preserve already streamed assistant content.
- Issue #12 reports that the Trace page's running orphan-process kill action is inert.
- `prd.md` section 2.65 already marks every stated #8 item as delivered, including
  model metadata, code UX, folding, queue presentation, Agent-facing mention UI,
  Shift+Enter Project send behavior, startup progress, and a bounded log page.
- No `.out-of-scope/*.md` file was found, so none of the four requests matches a
  recorded prior rejection.
- Runtime-review invariants require #11/#12 to be traced end-to-end through the
  shared app/runtime layer; UI-only patches are insufficient evidence.
- Current HEAD already contains the full #8 implementation set in v2.4.5 and
  the matching PRD/feature/release documentation; executable regressions still
  need to be run before closing.
- The Trace UI polls active runs and POSTs the selected `runId`; the server joins
  persisted Trace facts with live `RunnerPool` snapshots. Live runs call the
  exact manager's `abortRun(chatId, sessionId)`, while non-live rows only mark
  the audit fact aborted. There is no focused POST-route regression, so #12's
  inert-click report is not disproved by the current structural code.
- Desktop Stop aborts the client SSE, calls the shared `/api/stream/stop`, then
  reloads the transcript in the send catch path. The Runner has partial-output
  persistence tests, but there is no Desktop controller regression proving an
  abort reload preserves the visible partial answer; #11 remains unverified.
- #6 remains structurally incomplete: `src/lib/server/sessions/store.ts` still
  persists `messages` arrays in `ui-sessions`, so UI and Agent context retain
  duplicate transcript ownership despite the directory migration.
- #12 root cause: the Trace route enumerated only `runtime.channelManagers`.
  Ordinary Web profiles and Desktop-created Project pools live outside that map,
  so a real live run was labeled `orphan` and the button only updated its audit fact.
- #11 root cause: Desktop aborted its SSE before requesting the shared runner
  stop, while the send catch reloaded immediately. That reload could win the race
  against server-side partial-answer persistence and then hide the live bubble.
- #6 is now implemented through one shared projection module. Agent JSONL entry
  IDs own normal content and edit truncation; UI files store `messageMetadata`.
  Legacy rows are blanked only when role/content mapping proves Agent recovery;
  unmatched display-only command rows remain intact.
- The Session Store projector is configured once at runtime, so memory,
  reflection, file lists, Web, Desktop, and Project callers keep one transcript
  interface rather than reimplementing Agent-entry reads.
- Final Trace coverage is a shared RunnerPool registry, not a Web special case;
  snapshots use the active hook's real channel/Bot identity and therefore also
  cover channel-bound Project runs.
- UI Session files no longer persist a last-message text preview. Sidebar
  previews are derived through the Agent projection, so ordinary content has a
  single durable owner. Legacy content is migrated only on a role/text match
  within five minutes, preventing old display-only commands from being consumed
  by unrelated later Agent messages.


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

---

# Desktop Trace delete feedback (2026-07-14)

- The screenshot maps to `apps/desktop/src/lib/settings/TraceSection.svelte`.
- The server already exposes a run-scoped POST action and updates orphan run
  facts from `started`/`waiting` to `aborted`; refresh filters terminal facts.
- The Trace action is the only Desktop Svelte action using `window.confirm()`;
  other destructive settings flows use a visible application modal.
- The smallest UI fix is therefore confirmation-state ownership inside
  `TraceSection`, without changing Channel code, the runtime API, or Trace
  persistence semantics.
- The final dialog explicitly receives focus after Svelte renders it; without
  this, focus would remain on the covered overflow-menu button and Escape would
  not reach the modal overlay.
- Focused client and in-memory persistence tests confirm the remaining API and
  terminal-state filtering path already behaved correctly.
- Agent Store's ordinary `deleteSession` rejects deletion of the last context;
  UI lifecycle deletion needs a distinct idempotent artifact-removal operation
  that may remove the last UI-linked context and clear its active pointer.
# GitHub issue #13 full completion execution (2026-07-14)

- The user explicitly authorized uninterrupted sequential implementation of every
  missing requirement; completion must be tracked as goals rather than one blanket status.
- The existing audit establishes the starting gaps: shared primitives and global tokens,
  Settings hierarchy, Models/Providers human labels and select rhythm, Trace bounded detail,
  duplicate Automations presentations, Chat identity/metadata, and most Apple/P2 interactions.
- `DESIGN.md` is authoritative over generic frontend aesthetics: this product must use a
  restrained macOS system stack, compact 6/8/12/full geometry, opaque content hierarchy,
  and technical identifiers only as secondary information.
- Issue #13 remains open and has no comments. Its sections 1–33 make P2 and the Apple
  interaction additions explicit acceptance work, not optional future suggestions for this run.
- Completed the authoritative 546-line `DESIGN.md` read. Its Molibot layer explicitly
  requires shared semantic components, system-first typography, 6/8/12/full radii,
  120–240ms state/panel motion, human labels first, fixed save footbars, and the
  860×620 minimum window; these are implementation contracts for G1–G8.
- The current source has domain-level Settings sections and shared Chat pieces but no
  shared UI component directory. The prior patch adds semantic CSS and branch-specific
  markup inside existing pages, which explains why visual rules exist without consistent
  runtime usage. G1 should create small reusable primitives rather than another broad CSS-only pass.
- Existing uncommitted Issue #13 work must be treated as the baseline and refined in
  place. No destructive reset or unrelated formatting is allowed.
- Models currently renders raw option labels directly and then repeats the full key in
  a visible `<small>`; fixing this requires one shared model display projection used by
  Models, Providers, Automations, and Chat rather than page-specific string cleanup.
- Providers mixes global configuration, filtering, a 30-row provider list, and a large
  edit overlay in one component. Its existing store/API can remain; the presentation
  needs a constrained list/detail hierarchy and reusable controls.
- Automations already contains a healthier `presentation="workspace"` branch while the
  Settings branch still renders legacy expanded cards. The simplest consistent product
  seam is to make the workspace presentation canonical and remove the duplicate legacy UI,
  not maintain two full task interfaces.
- Chat's assistant identity prop exists, but the UI labels it generically as “Agents”,
  displays raw `message.model`, and expands thinking by default. G7 must fix the content
  hierarchy without changing transcript persistence.
- Trace's KPI semantics improved, but active runs and trace details remain an unbounded
  primary scroll. G5 needs disclosure/pagination or virtualization plus raw-detail
  containment, not cosmetic card changes.
- Baseline verification is green (53 structural UI/HTTP tests, 70 API tests, Svelte
  diagnostics 0/0), but the UI suite explicitly encodes obsolete behavior such as
  “thinking starts expanded” and the legacy Automation command deck. These passing tests
  are a migration baseline, not Issue #13 completion evidence; G0/G1 must replace the
  contradictory contracts with behavior-level acceptance tests.
- The current worktree contains only the in-progress Issue #13 implementation/audit and
  required documentation files from this task chain. `git diff --check` is clean.
- Model API options expose only `key`, `label`, and optional context window. Humanization
  therefore belongs in a credential-safe presentation helper that strips source prefixes
  and separates provider/model identifiers without changing the shared server contract.
- Provider items already contain a real user-facing `name`; their `id`, protocol, base URL,
  path, and model IDs can move to secondary disclosure without API work.
- Task schedule parsing already recognizes daily, weekly, and monthly cron patterns. G1 can
  add localized natural-language formatting on top of the existing parser and preserve
  unsupported expressions as technical fallback.
- Core motion and accessibility tokens exist at the top of `styles.css`, but 50 scattered
  hard-coded transitions and unsupported radii remain. G1 is a convergence/migration task,
  not a brand-new token system.
- A pure presentation seam now produces human model/provider names while retaining opaque
  identifiers separately, and localizes common daily/weekly/monthly cron schedules including
  multiple daily times. This lets every page share the same product language without changing APIs.
- Added the shared UI source layer under `lib/components/ui`: PageHeader, SettingGroup,
  SettingRow, SelectControl, SearchField, StatusBadge, OverflowMenu, EmptyState, and
  SkeletonRows. They contain no page-local styles and compile cleanly with Svelte 5.
- Shared control CSS now uses a 30px compact select height, system font, tokenized transitions,
  unified focus rings, accessible status symbols, and reusable empty/skeleton semantics.
- Every Settings route now resolves a localized description from existing domain copy;
  General adds explicit local/shared scope language. The shared PageHeader owns the scroll
  edge and General now uses shared SettingGroup/SettingRow/Select/Status primitives.
- G2 runtime verification passed. At 860×620 the language select measures 240×30px with
  full visible text, there is no horizontal overflow, Chinese/light and English/dark are
  legible, and the first service group remains visible. At 1280×800 the content remains
  bounded and the toolbar edge changes from hidden to opacity 1 after scrolling.
- The first G2 capture exposed the select collapsing to 48px because its parent used
  intrinsic sizing and a later max-width rule. A shared width/cascade fix corrected it;
  the second screenshot confirms the full 240px control.
- G3 is complete. Models now shows four compact 260×30px capability selectors in the
  first 860×620 viewport, with humanized values and collapsed technical IDs. Speech
  transcription has an explicit selected value, task tiers no longer lead with Anthropic
  names, and advanced runtime settings are opt-in.
- Real populated screenshots passed in Chinese/light and English/dark. Humanization was
  tightened after the first view to remove redundant vendor path segments and duplicate
  brand names while preserving the full opaque key under technical details.
- The model route switch now applies an immediate optimistic selection and restores the
  previous route on request failure; advanced edits continue to use the fixed save footbar.
- The original Providers surface was still materially unfinished: its four selects had no
  shared sizing and its 30-row list exposed protocol, URL, key state, and four actions per
  row. The completed master-detail surface bounds the list at 360px, measures every primary
  select at 260×30px/13px, and moves identifiers, protocol, and URL behind technical detail.
- Provider deletion no longer invokes a native browser confirmation from the store. The
  page owns an accessible in-app alert dialog, while the fine-grained provider delete API
  and store behavior remain unchanged.
- Trace already had the correct dashboard-before-active-runs information hierarchy and a
  tested in-app stop/orphan confirmation. Its remaining gaps were presentation seams: raw
  task/run details, an unbounded live list, engineering-first labels, non-localized start
  times, and page-private loading/status/menu UI. Those are now resolved without API changes.
- Automations really had two product surfaces: the Settings route still rendered a large
  card deck while the Chat workspace rendered the intended 320px list/detail layout. Both
  live entry points now use the latter. Existing watched-event JSON and task APIs remain the
  source of truth; Stop reuses the active run's runId and the existing active-runs abort API.
- Polling was shortened to 3 seconds for execution state, but the refresh path no longer sets
  the initial-loading flag. This avoids a full-page skeleton flash every polling interval.
- Chat's shared transcript and composer seams were sufficient. The actual Agent name was already
  passed for configured profiles, but the fallback and generic plural role were wrong; raw model
  values and default-open Thinking were also presentation bugs. The corrected populated DOM shows
  `Global · Agent`, human model names, collapsed details, and a 50px one-row Composer.
- The first compact Composer grid exposed a real regression: its 480px control rail left only 94px
  for the textarea, so the placeholder expanded the row to 110px. Hiding the redundant locked Bot
  mention in established conversations, shortening the model pill, and resetting empty textarea
  height produces a 287px input and 50px total height at 860px.
- Cross-app review found that writing `onkeydown` on an overlay is insufficient when focus stays
  on the covered trigger: Escape bubbles through the focused element's ancestor chain, not a
  visually covering sibling. Provider and Automation overlays now take focus after rendering.
- Native `<details>` hides a menu visually but keeps its slot mounted. The shared OverflowMenu now
  renders the menu only while open; browser verification observed one menu after ArrowDown and
  zero after Escape, with focus restored to the summary trigger.
- The final General runtime measurement is 260×30px for the language select and 38×22px for the
  low-performance Switch, with no horizontal overflow. This directly addresses the user's report
  that Settings dropdowns remained oversized.
- The OS-level VoiceOver speech-output pass cannot be represented by the browser tree alone, so
  the release smoke sequence is documented in the completion plan. Names, roles, focus order,
  dialog focus, live regions, and non-color status alternatives were verified in the browser tree.

---
