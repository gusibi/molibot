# PR #15 merge and release (2026-07-15)

- The user confirmed Desktop and server are bundled and upgraded together, so mixed old-client/new-server compatibility is outside the supported deployment model.
- A verified local merge candidate exists in the isolated scratch worktree; the primary worktree contains unrelated user changes and must not be used as the release staging area.
- Release discovery is in progress; remote PR/branch/tag state and the unfinished older release plan must be reconciled before any push.
- Primary `master` is already clean at the commit boundary `bc698627` / tag `v2.4.9`; only user-owned documentation and planning files are dirty.
- Current versions are root `2.4.9` and Desktop/Tauri `0.4.6`. The required base-10 increments are root `2.5.0` and Desktop `0.4.7`.
- The isolated PR candidate is merge commit `45adc560` with parents PR head `9736414b` and current master `bc698627`; its product tree is ready, while planning files and dependency directories remain out of release scope.
- PR #15 was merged by GitHub at `cb3e6175b300d90a14009a7ac084fd54b2a72ae0`; remote `master` now points to that commit and no `v2.5.0` tag exists.
- The isolated release worktree is clean at `cb3e6175` and tracks `origin/master`.
- Release source versions are confirmed as root `2.4.9` and Desktop/Tauri `0.4.6`; release edits are limited initially to the two package manifests before the official sync script.
- The top CHANGELOG date is 2026-07-15. Release notes must use only the delta after tag `v2.4.9`, not repeat the already-published Agent City section.
- Version sync changed exactly five identifiers: root package `2.5.0`, Desktop package/Cargo manifest/Cargo lock/Tauri config `0.4.7`; `git diff --check` is clean.
- The `v2.4.9..master` documentation delta contains the Settings API per-module split, shared Web/Desktop handlers, sanitizer/validator hardening, provider-model sharing, plugin-memory preservation, model-route isolation, and service-port migration. That delta is the release-note source.
- Final release verification passed: focused Settings 23/23, Desktop/server API 197/197, Desktop UI/HTTP 54/54, Svelte diagnostics 0/0, production build, and Tauri `cargo check` for Desktop 0.4.7.
- Adversarial scan found only the five intended version-file modifications, no whitespace errors, no added machine-specific absolute path/private-key marker, and no production caller of the retired exact `/api/settings` root.
- Release commit and tag are both `50b2a8e2217491d7eebb6fd18291d713d6fda526`; remote `master` and `refs/tags/v2.5.0` resolve to that exact OID.
- GitHub Release `v2.5.0` is published, non-draft, and non-prerelease at `https://github.com/gusibi/molibot/releases/tag/v2.5.0`; PR #15 is merged at `cb3e6175`.

---

# 2026-07-16 — Native experience developer board

## Tracker context
- The issue tracker is GitHub repository `gusibi/molibot` on `master`.
- The stable triage vocabulary includes `enhancement` and `ready-for-agent`; the latter explicitly means fully specified for autonomous implementation.
- Open Issue #13, “Molibot macOS App 界面改造报告”, is the correct parent for the follow-up board. It has no comments and remains open; the board must not edit or close it.
- Issue #13 is a broad visual/interaction report whose foundational Geist/macOS items are already marked Done in `prd.md`. New cards must cover only the verified native-behavior delta, not reopen completed visual convergence work.

## Architecture observations
- Native host behavior currently lives directly in `App.svelte`, `ChatView.svelte`, `ProjectChat.svelte`, `WindowDragMask.svelte`, and `src-tauri/src/lib.rs`; Tauri detection and `invoke` calls are duplicated.
- The Rust host already owns real macOS capabilities (window lifecycle, tray, autostart, native recording, dragging), while Svelte owns localization, command availability, current product state, and most user feedback. A small host port is therefore a real seam with production Tauri and in-memory/browser adapters.
- Timers and preference listeners are distributed across App, Chat, Tasks, Trace, Agent Studio, Agent City, Projects, and media stores. Performance/background policy cannot be fixed reliably page by page.
- Existing tests cover UI source contracts and product projections, but there is no focused test surface for command routing, startup state transitions, overlay semantics, gesture physics, host feedback, or window activity policy.
- The existing shared UI folder has no Dialog/Sheet or direct-manipulation primitive, confirming that these behaviors are currently caller knowledge rather than deep-module implementation.
- The repository root already uses `shadcn-svelte`/`bits-ui`, but Desktop owns a separate component directory and does not declare `bits-ui`. Desktop must gain a formal local primitive/dependency or an explicit package alias; it must not reach into the root UI through a long relative import.
- The installed Svelte runtime exposes the class-based `Spring` motion primitive and momentum-preservation support, so the gesture slice can begin without adding a second animation framework. Pointer sampling, release projection, bounds, and cancellation still belong behind a dedicated direct-manipulation Module.
- The installed Svelte `Spring` can preserve an already-running trajectory but cannot accept an arbitrary pointer-release velocity. A physically continuous drag therefore needs a small testable solver that accepts initial velocity; adding another public animation library is unnecessary.
- The current Tauri target already depends on the `objc2` family for macOS media integration. `objc2-app-kit` exposes `NSHapticFeedbackManager` behind its `NSHapticFeedback` feature, so a later hardware-feedback adapter can extend the existing bridge instead of introducing another native runtime.
- Apple limits trackpad haptics to user-initiated actions, recommends simultaneous visual feedback, and lets the system suppress feedback based on hardware/preferences. Haptics therefore belongs only on direct-manipulation commit/snap boundaries, never on background task completion.
- `prd.md` already contains an unrelated in-progress section numbered 2.79. The native-experience plan must preserve that user-owned change and use 2.80.

## Verified Tauri 2 capabilities
- Tauri 2 supports a real application menu through `app.set_menu(...)` and `app.on_menu_event(...)`; command IDs can therefore be stable across native menus and the Svelte command registry.
- Rust-to-frontend command events are appropriate for low-frequency menu actions. The JavaScript event listener returns an unlisten function that must be cleaned up with the owning Svelte lifecycle; high-throughput ordered data should not use this event path.
- `WindowEvent` exposes `Focused`, `ThemeChanged`, `ScaleFactorChanged`, `Resized`, and `CloseRequested`, which is sufficient for inactive-window styling, live theme/scale state, window telemetry, and explicit close behavior without polling.
- The official notification plugin exposes permission checks, request flow, notification grouping/actions, macOS system sounds, and cancellation. It should sit behind the host-feedback adapter and request permission only at the moment the user enables native notifications.
- Tauri event listen/emit permissions must be added narrowly to the Desktop capability configuration; no broad shell or unrelated host permission is required for command routing.

## Board constraints
- Use Issue #13 as `Parent` for every new card.
- Publish in dependency order only after the user approves the draft breakdown.
- Every approved issue should receive `enhancement` + `ready-for-agent` and use the to-issues template.
- Avoid file paths in published issue bodies; keep precise module interfaces and file-level rollout in the repository technical board where they can be reviewed together.

## Board result
- The draft contains 15 end-to-end cards. Four are no-blocker foundations: unified commands/App Menu, recoverable startup, shared Dialog semantics, and velocity-aware Tasks direct manipulation.
- Dependent cards converge Project/Settings overlays, user-controlled close behavior, searchable commands, gesture reuse, window materials, contextual notifications, user-action-only haptics, and window-aware activity budgets.
- The architecture deliberately uses seven deep Modules and domain-specific Adapters instead of a single NativeHost facade.
- Adversarial review found the original all-Settings modal card too broad, so it was split into Tasks, Provider/media/entity-editor, and Memory workflow cards before handoff.
- This turn changes planning/design documents only. No product capability is delivered, so `features.md`, `CHANGELOG.md`, and `README.md` should not be updated yet.

---

# 2026-07-16 — Apple-like native experience audit

## Requirements
- Analyze how Molibot Desktop can achieve a full native-app feel, including platform behavior, interaction, motion, UI, feedback, accessibility, and performance—not only animation or click effects.
- Use the Apple Design principles supplied by the user.
- Ground the report in the current product rather than offering generic Apple-style advice.
- Keep this turn read-only with respect to product code.

## Initial evaluation model
- Structural layer: window/chrome, navigation model, command system, persistence, offline/error behavior, platform conventions.
- Interaction layer: pointer-down feedback, keyboard, focus, direct manipulation, interruptibility, velocity handoff, undo and destructive-action recovery.
- Sensory layer: material hierarchy, typography, icons, sound/haptics where the host permits, and state feedback.
- Adaptation layer: macOS/Windows/Linux differences, touch vs pointer, responsive layout, light/dark, reduced motion/transparency/contrast, dynamic type.
- Performance layer: input-to-paint latency, frame stability, compositor-only motion, startup/loading continuity, and perceived responsiveness.

## Product and code findings — pass 1
- The product already has an explicit macOS layer in `DESIGN.md`: system typography, a 52px drag region, quiet opaque surfaces, fixed settings footbars, a 260px resizable chat sidebar, keyboard focus, short 120–240ms transitions, reduced motion, and an 860×620 minimum window.
- This is a strong consistency baseline, but it deliberately follows restrained Geist styling. “Apple-native” should extend this behavioral contract; replacing tokens with glass and larger radii would conflict with the existing product direction and would not solve interaction continuity.
- Desktop is a Tauri + Svelte application, so the host can support platform integration beyond ordinary browser CSS; the current visible shell already marks custom drag regions.
- Current motion is predominantly CSS transitions/keyframes driven by fixed durations and easing tokens. This is appropriate for hover/focus/color state, but the code search found no general spring/velocity system for gesture-driven surfaces.
- Direct-manipulation evidence is narrow: the Tasks detail surface uses Pointer Events and pointer capture; the Chat sidebar resize path still uses `mousemove`/`mouseup`. There is no broad gesture primitive for velocity history, momentum projection, rubber-banding, or interruption.
- Existing accessibility foundations include `:focus-visible`, `aria-live`, keyboard handlers, and reduced-motion checks. The audit still needs live keyboard/focus and reduced-transparency/contrast verification.

## Audit environment
- Product Design saved context is absent, so the current repository, its `DESIGN.md`, and screenshots from this run are the grounding sources.
- The in-app audit browser had no existing tab to claim. A fresh local-only tab is required; it will target the current Desktop dev surface and avoid the live service port.
- A temporary 860×620 viewport is justified because that is the product's documented minimum Desktop window and a required responsive verification state; it must be reset before browser cleanup.

## Visual finding — Step 1: chat startup/disconnected state (1120×760, dark)
- Accepted screenshot: `01-chat-starting.jpg`.
- Strengths: the layout is calm and legible; the sidebar-to-content hierarchy is clear; the app communicates that it is checking a local dependency instead of showing a blank screen; status is text plus motion, not color alone.
- UX risk: the center is dominated by an indefinite looping activity ring while `App.svelte` polls every second. There is no visible elapsed-time threshold, recovery action, diagnostic disclosure, or transition to a stable “still working / needs help” state. A native app should turn prolonged startup into a controllable state, not endless ambient motion.
- Consistency risk: identity is split among a generic “B” header avatar, the illustrated Molibot icon in the startup indicator, and another Molibot avatar in the sidebar. Native polish depends on one coherent identity and predictable state mapping.
- Evidence limit: the browser capture cannot show actual macOS traffic lights, inactive-window appearance, vibrancy, native menu behavior, or dock/tray feedback. Those require a packaged Tauri run.

## Visual finding — Step 2: global command palette (1120×760, dark)
- Accepted screenshot: `02-command-palette.jpg`; an earlier mid-transition capture was rejected and overwritten after the 120ms entrance motion settled.
- Strengths: `⌘K` works globally; the first command receives a strong visible focus state; arrow-key navigation and Escape are implemented; the palette floats without a modal scrim, preserving context for a parallel task. This is one of the app's strongest native-feeling foundations.
- Consistency risk visible in the same state: the sidebar says “自动任务 / 技能” while the palette says “自动化 / Skills”. A system-quality app cannot let the same destinations change vocabulary or language between surfaces.
- Capability gap: the palette exposes only four fixed commands and no type-to-filter input. It behaves more like a shortcut menu than a native command system; it cannot yet surface current-context actions, recent destinations, app-wide search, disabled-state reasons, or full shortcut discovery.
- Motion assessment: a short fixed CSS entrance is appropriate here because the palette is not directly dragged. Native improvement should focus on origin, focus restoration, context-aware commands, and consistent language—not add bounce.

## Visual finding — Step 3: General Settings (860×650, dark)
- Accepted screenshot: `03-settings-general.jpg`.
- Strengths: this is already close to a well-crafted macOS settings surface—stable sidebar, compact grouped rows, restrained separators, system-scale typography, clear switches, an explicit system theme choice, and a fixed action bar. The hierarchy is stronger than a generic web dashboard.
- Structural risk: the Settings navigation contains 22 destinations in seven groups. At the app's own 860×650 default, the sidebar becomes a long independent scroll region while the content also scrolls. The search field mitigates this, but the experience still feels like a control panel inventory rather than a task-oriented native preferences app.
- Visual risk: the persistent bottom action bar visibly overlays the content region. The fixed-save requirement is correct, but it needs scroll-edge material/separation and guaranteed bottom content inset so it reads as attached chrome rather than a rectangle covering rows.
- Language consistency risk: Chinese mode mixes translated destination names with “Agent”, “Skills”, “MCP”, “Web Profile”, “Host Bash”, and “Trace”. Some are product terms, but the rule must be deliberate and identical in navigation, command palette, headings, help text, and search results.
- Native opportunity: keep the quiet card system, but make the sidebar and bottom bar platform-aware materials, including inactive-window, reduced-transparency, and increased-contrast variants. Do not apply glass to every card.
- Evidence limit: screenshot inspection supports visible hierarchy and density findings only; actual focus order, VoiceOver labels, zoom resilience, scroll physics, and inactive-window states need interactive/platform testing.

## Product and code findings — pass 2
- Immediate press feedback already exists globally (`button:active` scales to `.98`, compact actions to `.95`). This is a useful baseline, but it is CSS `:active`; it does not implement the fuller native tap model of press-down highlight, drag-away cancellation, re-entry, and enlarged hysteresis.
- Keyboard foundations are stronger than the visual audit alone shows: command palette focus is placed on open and restored on close; sidebar resize supports arrow keys; the shared overflow menu supports Arrow Up/Down and Escape with focus restoration.
- There is no shared Dialog/Sheet/Button/Switch/Tabs interaction primitive in `lib/components/ui`; only nine shared UI components exist. Modal focus behavior is implemented ad hoc, and the inspected task dialogs focus the container but do not show a general focus trap or inert-background contract. This makes consistent native modal behavior hard to guarantee.
- The only explicit content gesture found is the narrow-screen Tasks detail drag. It tracks horizontal movement 1:1 and captures the pointer, but closes at a hard 96px threshold, discards release velocity, has no projected endpoint, no rubber-band resistance, and snaps the offset back to zero. It is functional but not physically continuous.
- Sidebar resizing is accessible by keyboard and persists its width, but pointer handling uses mouse events instead of Pointer Events/capture. Window dragging also uses a mouse-only handler. A shared pointer primitive would cover mouse, trackpad/stylus/touch and cancellation consistently.
- Motion is broad but tokenized: 70 transitions, 33 animations, 18 keyframe definitions, with 100/160/240/300ms duration tokens. There is no spring/gesture dependency. The `--ease-spring` token is an overshooting cubic Bézier, not an interruptible velocity-aware spring.
- Accessibility adaptation is uneven: eight reduced-motion references and one increased-contrast block exist, but reduced transparency is only sampled inside the performance-mode decision. There is no dedicated visual contract for `prefers-reduced-transparency`, nor evidence that preference changes are observed live.
- Platform integration exists for overlay titlebars, tray, autostart, single-instance handling, native recording, reopen, and close-to-background. However, the host code builds only a tray menu; it does not expose a full localized macOS application menu with standard roles (About, Preferences, Services, Hide, Window, Help) or native command discoverability.
- The tray menu renders bilingual labels simultaneously (`中文 / English`) instead of following the active locale, which reads as utility/debug chrome rather than native macOS menu copy.
- Tauri window constraints contradict the design contract: Chat permits 720×520 and Settings 620×480, while `DESIGN.md` declares 860×620 as the minimum supported Desktop window. Either the product must truly support the smaller sizes or the host minimums must be raised; native quality requires one enforceable contract.
- The packaged target is macOS 13+ and DMG-only, so a macOS-first implementation is a reasonable product choice. Platform-specific native behavior can be prioritized without building a premature cross-platform abstraction.

## Live layout measurements — Settings at 860×650
- No horizontal overflow was present, and the effective UI font stack correctly begins with `-apple-system` / `system-ui` / `SF Pro Text` / `PingFang SC`.
- The navigation's visible height was 502px against 1031px of scroll content—slightly more than half the destinations fit at once. This confirms that Settings information architecture, not raw pixel polish, is the main density issue.
- The content pane had 737px of content in a 542px viewport. Its sticky footbar occupied 57px beginning at y=553, so content needs an explicit bottom safe area and scroll-edge treatment to prevent perceived occlusion.
- The visible switches were 38×22px. That is visually consistent with compact macOS controls, but the interactive hit area should be enlarged invisibly to at least 28–32px high and verified with pointer/assistive input; the visible knob does not need to grow.
- Current environment signals were standard motion, standard transparency, and standard contrast; alternate preference behavior remains source-inspected rather than visually captured.

## Visual finding — Step 4: switch to Light theme (860×650)
- Accepted screenshot: `04-settings-light.jpg`.
- Strengths: the theme change is immediate and keeps spatial position; selected state is visible through more than color; light surfaces retain the same hierarchy and spacing as dark mode.
- Polish risk: the 300ms whole-tree theme transition applies color/background/border changes to every descendant. It looks smooth in a simple view, but on dense screens it can cause unnecessary style work and brightness motion. A native theme transition should be short, scope to stable surfaces, and cross-fade only where it improves continuity.
- Visible confirmation: the sidebar and content preserve structure across themes, while the bottom footbar remains visually detached/overlaid in both themes; this is a system-chrome issue rather than a dark-theme artifact.

## Existing work that the new roadmap must not duplicate
- Issue #13 already delivered the important “native polish” baseline: shared page/row/select/search/status/menu/empty/skeleton components, system font, fixed settings chrome, pressed feedback, keyboard shortcuts, text-plus-color status, bounded lists, low-performance mode, and screenshot/accessibility checks.
- The 2026-07-16 Geist convergence pass deliberately removed Liquid Glass remnants and standardized focus, radii, shadows, scrims, type, and symmetric modal/drawer entrance/exit. Reintroducing widespread translucency or a new visual system would undo freshly verified work.
- Therefore the next meaningful phase is not another visual reskin. It is a **native behavior layer** above the current Geist/macOS visual foundation: application menu, window state, command registry, shared modal semantics, direct-manipulation physics, feedback orchestration, recovery/offline behavior, and packaged-app QA.
- Two earlier completion claims should be narrowed in future docs: (1) the Tasks right-edge gesture is interruptible while the pointer is down but does not preserve velocity or animation continuity after release; (2) reduced transparency currently triggers a broad performance fallback, not a dedicated material adaptation contract.
- The new plan should preserve the intentional rule “quiet opaque surfaces by default”; use translucency only for platform chrome and floating hierarchy where it remains legible under reduced-transparency, contrast, dark, and inactive-window states.

## Prioritized recommendation
- P0: one command registry plus standard macOS menu/tray/window behavior, an explicit startup/recovery state machine, a single minimum-window contract, and shared Dialog/Popover/Sheet semantics.
- P1: a small direct-manipulation engine (Pointer Events, capture, velocity history, projection, rubber-band, interruptible spring) piloted only on Tasks detail, right inspector/file drawer, and sidebar resize.
- P2: restricted platform materials, active/inactive window states, and a capability-gated feedback orchestrator for visual/sound/notification/optional haptic output.
- P3: command/settings discovery, progressive disclosure, startup/input/frame instrumentation, background-work reduction, and packaged macOS QA across language/theme/accessibility/window states.

## Adversarial conclusions
- Do not replace the current Geist system with Liquid Glass; the likely result is lower legibility and another style split.
- Do not add bounce to ordinary UI; springs belong only to touchable/movable surfaces and default to critically damped behavior.
- Do not call Tauri host APIs directly from every Svelte page; introduce one shared native-experience/capability layer above product flows and outside Channel adapters.
- Do not reorganize all 22 Settings destinations before unified search, deep links, and usage evidence exist.
- Do not accept browser screenshots as final native proof; menus, windows, inactive appearance, VoiceOver, scroll physics, notifications, sound, haptics, and performance require a packaged Tauri run.

## Resources
- `DESIGN.md`
- `apps/desktop/`
- Apple Design skill supplied for this audit

---

# 2026-07-15 — Memory Center three-tab redesign

- The selected visual truth is two independent states: generated Option 1 is the Overview tab and generated Option 2 is the Topics tab. They must not be merged into one composition.
- The third top-level tab is All Memories and should preserve the existing real management surface rather than inventing a new mock.
- Pending confirmation belongs in Overview content; Advanced Management remains a quiet secondary entry rather than a fourth peer tab.
- The worktree already contains uncommitted memory trace, feedback, candidate, source/version, and allow-injection changes. All implementation must be incremental and preserve them.
- Formal stored memories are not automatically “user confirmed”. Current truthful state fields include pending candidates, conflicts, expiry, pinning, injection eligibility, sources, versions, domain/type/subject/tags, and update time.
- The browser preview must set both `VITE_MOLIBOT_PREVIEW=1` and `MOLIBOT_DESKTOP_PREVIEW_TARGET=http://127.0.0.1:3000`; otherwise the shell reports ready while `/molibot-api` is not proxied and Memory remains loading.
- `class:lifestyle` exposed a substring-classification trap: matching `style` inside arbitrary tags falsely classified workout records as stable preferences. Preference tags now require exact semantic prefixes, while explicit preference language remains supported.
- A useful profile summary must not select the three highest-scoring records from one theme. The Overview summary now takes at most one retained record per topic, keeping the real-data result multidimensional without generating new facts.
- Generated visual truth and real Desktop screenshots were compared side by side. The final app intentionally preserves the product's wider existing Settings sidebar, while matching the reference hierarchy inside the Memory content area.

---

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
- Release request explicitly authorizes the normal version bump, tag, remote push, and GitHub Release creation sequence. Current versions and remote tag availability still require inspection before mutation.
- Root is `2.4.8`, Desktop is `0.4.5`, so the base-10 patch targets are `2.4.9` and `0.4.6`. Remote `master` is still `194a5629` (`v2.4.8`); no `v2.4.9` tag or GitHub Release exists.
- The top Agent City release note incorrectly called an unrelated 6/6 Agent-settings suite the server data contract. The actual Activity/Trace projection suite is 9/9 and will be named accurately before release.
- The release candidate compiles across both frontend and Tauri boundaries. Existing Vite chunk-size/dynamic-import warnings are unchanged and non-blocking; no new diagnostic, test, or Rust compilation failure was found.


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

# GitHub issue #10 completion audit (2026-07-15)

- Issue #10 is OPEN and specifies a Three.js fixed-isometric Agent City with 10 stable ordinary-Agent plots, an independent Global HQ, an owner dispatch center, 1–100 deterministic floors, overflow disclosure, real Activity semantics, Sub-agent collaboration pods, automatic quality/fallback behavior, DOM accessibility, bilingual themes, resource cleanup, and visual/performance verification.
- The matching worktree is `.claude/worktrees/issue-10-agent-page` on branch `worktree-issue-10-agent-page`.
- The branch commit `28a98bea` is the exact parent of current `master` (`194a5629`); all issue implementation is currently uncommitted in the worktree.
- Modified/new files cover the Desktop Agent Studio shell, a Three.js canvas and scene, a 2D fallback, projection/scene tests, i18n/CSS, dependencies, and an implementation plan. Completion is not yet established.
- The visual direction is a refined, playful desktop miniature city constrained by Molibot's native macOS product layer: fixed camera, quiet materials/motion, semantic HTML overlays, theme tokens, and no game controls.
- Baseline implementation checks are green: projection/scene tests 8/8, Desktop structural/HTTP tests 47/47, Svelte diagnostics 0 errors/0 warnings, and Vite production build. This proves the current slice is mergeable, not that the full PRD or visual quality is complete.
- Confirmed delivery gaps before merge: no required `features.md`/`prd.md`/`CHANGELOG.md`/`README.md` updates; no current screenshot-based visual QA; no full requirement matrix; and no evidence yet for real hover details, sustained-fps fallback behavior, mount/unmount leak checks, or representative 1/10/40/100 rendered scenes.
- Merge compatibility finding: current `master` adds a persisted low-performance mode and Settings scroll state in `App.svelte`; the Agent City preview pane must be combined with those variables rather than choosing either branch wholesale. The old CSS office and new Agent City are mutually exclusive by PRD, so the city block correctly replaces only that conflicted section.
- First current-page screenshot at 1280×800 reached the Agent route but remained on “正在加载…” with the app offline. This preview URL does not yet provide visual evidence of the city; a real/proxied Activity endpoint or deterministic visual fixture is required before making any polish claim.
- The existing Desktop-owned service is healthy at the runtime-state endpoint (`127.0.0.1:3000`, v2.4.7); the preview can connect through Vite when started with the documented proxy flags. The first proxied load was covered by the preview-only onboarding modal, which was dismissed locally without changing service settings.
- The real Agent page now exposes 5 residents (Global plus 4 ordinary Agents), all names/statuses as semantic DOM buttons, an independent owner dispatch label, Global HQ label, summary counts, and full-3D quality status. This validates the data/DOM seam at the common <10-Agent scale.
- Page screenshot capture timed out twice while the live WebGL scene was rendering, including a bounded content clip. Do not claim composed visual acceptance from those calls; switch to a canvas read plus separate DOM measurements or another supported visual surface.
- Real 1280×800 layout metrics are healthy at the common scale: city shell 972×560, canvas bitmap 970×560, zero horizontal overflow, and all 5 Agent labels are visible 108×38 DOM controls within the scene.
- Confirmed source defect: full→low performance fallback disposes the renderer and calls `forceContextLoss()`, then immediately constructs another renderer on the same canvas. A forced-lost canvas may not provide a new context, so downgrade must happen in-place before any eventual 2D fallback.
- Confirmed acceptance gap: `AgentCityFallback` exposes only name/status and Sub-agent count; it drops Bot, channel, start time, task summary, model routing, and detailed Sub-agent identities that the 3D DOM layer preserves.
- Confirmed coverage/documentation gaps: projection tests omit explicit 0/1-Agent cases, and required docs still describe the old CSS office as delivered while marking Three.js Agent City planned.
- Current Settings exposes the shared Chinese General page, low-performance switch, and unique Light/Dark/System controls. Dark theme was selected through the real UI for the Agent City check.
- In Dark mode, the Agent route completes its real API load after the normal bootstrap/poll window and retains all 5 semantic Agent controls, owner dispatch label, Global HQ, and full-3D quality status.
- The in-app browser's viewport capability did not apply the requested 860×620 override on two checks; the measured page remained 1280×800. Narrow-window behavior remains covered by source/CSS contracts but is not claimed as live visual evidence in this run.
- At the actual 1280×800 Dark viewport, the city background resolves to `rgb(16, 24, 32)`, all labels are visible, horizontal overflow is zero, and the workspace scroll region is 740px high with 822px content—confirming intentional vertical scrolling instead of scene shrinkage.
- Browser console inspection found no runtime errors. It did expose Three.js 0.185's deprecation warning for `PCFSoftShadowMap`; the renderer now uses supported `PCFShadowMap` so the Agent page is console-clean after reload.
- Fresh-tab verification after the shadow-map fix loaded the real Agent City and returned zero browser warnings/errors. The temporary viewport override was reset before browser cleanup.
- Final adversarial finding: the 2D details became keyboard-visible, but their tooltip semantics lacked an explicit relationship to each floor control. Stable `aria-describedby` IDs now connect every Global/floor button to its information-equivalent detail panel.
- Final acceptance evidence is green for deterministic capacity boundaries, real Activity projection, safe in-place quality degradation, 2D detail parity, lifecycle cleanup contracts, diagnostics, server projection, and build. Formal Blender GLB art remains the issue's explicit P2 milestone rather than a blocker for the completed procedural first phase.

---
# Memory Center and per-turn Memory Trace findings (2026-07-15)

- The current memory pipeline selects up to 12 records in `MemoryGateway.createPromptSnapshot`, but `compactPromptMemory` later trims the serialized prompt to at most 5 lines and 220 characters. Therefore `MemoryPromptSnapshot.selected` is not the answer-reference source of truth.
- The final materialization seam is `buildPromptInputEnvelope`: it currently receives only a string. The implementation needs a structured injection snapshot whose `promptText` and item list are generated together.
- `MomRuntimeStore.appendContextMessage` currently creates but does not return its context entry ID. Returning it allows `RunResult` and UI metadata to bind a trace to the exact final visible Assistant entry without heuristic text matching.
- Conversation projection already retains `sourceEntryId`, and UI message metadata already accepts it as a field; the missing work is carrying the ID through Runner result and message persistence.
- Memory tool `afterToolCall` receives structured `args` and raw `result`, while generic activity hooks store only a preview. Write receipts must be captured at this structured shared seam, not reconstructed from visible text.
- The existing Memory Settings page already contains record editing, source/version/rejection tools. The safest UI change is to reorganize and reuse those capabilities rather than replace the underlying APIs.
- The memory tool returns written records under `result.details.item` for `add`, `update`, `add_content`, and `set_agent_self`; `flush` returns `details.result.memories`. These shapes allow exact write receipts without changing tool output text.
- Existing operational traces share `settings.sqlite`. Memory Trace can use the same database with dedicated tables and an injectable constructor, avoiding another lifecycle/configuration surface while keeping tests on `:memory:` or temp files.
- `RunResult` currently returns only run/workspace/stop/error. It is the narrowest shared place to add `assistantSourceEntryId` and lightweight memory outcome data for the caller that persists visible UI metadata.
- The existing Desktop session detail endpoint already consumes shared conversation projection. Enriching that projection with batched trace metadata makes every Desktop chat load receive only `traceId`, `injectedCount`, and `writeCount`; full snapshots remain lazy-loaded.
- `allowInjection` fits the existing memory metadata/versioning path: Mory stores it in record detail, JSON fallback stores it on the row, and prompt selection filters only at injection time so disabled memories remain visible/searchable.
- The Memory page's existing technical tools remain useful, but their prior top-level ordering made them the primary experience. A three-view structure reuses all existing operations while making saved memories and pending confirmation the default user concepts.
- Browser verification exposed a duplicated Memory-page description because both the Settings shell and section rendered the hint. The inner duplicate was removed and the offline copy was normalized from “内存” to “记忆”.
- At an actual 600px viewport, the Chinese and English/Dark Memory settings routes had zero document-level horizontal overflow. The populated tabs/cards and Chat trace drawer could not be live-rendered without connecting the preview to user runtime data, so their data states are covered by contracts, diagnostics, and responsive CSS rather than a fabricated fixture.

# Project Chat blank transcript findings (2026-07-15)

- The reported Project Session exists and its API returns 13 messages; the data was never deleted.
- The same session renders all 13 messages in a stable browser preview, excluding Memory Trace markup and message-role filtering as causes.
- Project selection previously issued the same transcript request twice: `projectsStore` retained one result, while the visible `projectChatStore` Runtime depended on the other. Runtime reload failures were swallowed, allowing a successful Store response and an empty visible transcript to coexist.
- The fix makes the Store request authoritative and hydrates the pinned Runtime directly. Component remounts reuse cached Runtime messages so a background/live transcript is not overwritten by stale Store data.
- External Feishu/Telegram transcript APIs and render paths are untouched.
# 一次性提醒任务收件箱：调查记录（2026-07-15）

- 共享任务类型已经包含 `one-shot | periodic | immediate`，无需创造第二套提醒模型。
- 当前 Desktop 自动任务产品列表有意只展示 `periodic`；`one-shot` 仍存在于 watched event JSON 和运行时状态中，因此应扩展产品投影而不是迁移存储。
- 现有 PRD/功能记录明确写过“一次性任务不展示”，本需求会只推翻 `one-shot` 的排除规则，`immediate` 仍保留为诊断/内部类型。
- 未读若仅用“completed 且没有 readAt”推导，会把所有历史提醒误算成未读；实现应在未来成功触发时显式写入未读标记，旧记录默认已读。
- 侧边栏角标需要在未进入自动任务工作区时也能加载，不能只依赖该页面挂载后的本地状态。
- 一次性任务成功完成的统一落盘点是 `EventsWatcher.markDone`；只在这里给 `one-shot` 写 `reminderUnread: true`，可以覆盖 Web、Telegram、飞书等所有渠道且不会影响周期任务。
- Desktop API 与 Desktop 客户端目前各自过滤了一次 `periodic`；两处都必须放开 `one-shot`，但继续排除 `immediate`。
- 页面现有两类 Tab 实际是“用户周期任务 / 系统周期任务”。第三个视图应按 `type` 与 `category` 双重筛选，避免系统内部事件混入提醒列表。
- 侧边栏需要独立的轻量未读刷新；自动任务页面已有 3 秒轮询，侧边栏可用更低频的摘要轮询并由页面回调即时清零。
- 对抗检查发现角标轮询曾被 `startReconnectPoll` 误清理；已改为只在 `onDestroy` 清理，连接建立后保持 15 秒轻量刷新。
- 对抗检查发现已读写回失败若直接恢复 unread，Svelte effect 会立即再次提交；已用 unread ID 集合做单次尝试门控，避免失败风暴，离开再进入 Tab 可人工重试。
- 未读汇总必须同时限定 `type === one-shot` 与 `category === user`；否则未来系统 one-shot 可能制造用户看不到也无法清除的角标。
- 失败或 skipped 的 one-shot 不显示“已提醒”，保留失败文字和非纯颜色状态；只有 completed 使用“已提醒”。

---
# 系统任务执行会话不可打开：调查记录（2026-07-15）

- 截图证据：系统任务最近执行记录存在、执行次数为 1，点击“打开会话”后详情 API/界面返回“会话可能已清理”；问题不是“没有 execution row”，而是 execution → session transcript 的解析失败。
- 系统任务属于 Molibot Owner 级内部 watched event；需要验证它与普通 channel/bot watched event 是否使用不同 workspace/session 存储边界。
- 当前运行服务 `127.0.0.1:3000` 可稳定复现数据前提：`daily-materials-owner` 有 1 条 completed execution，`sessionId=internal-daily-materials`；`memory-reflection-owner` 有 2 条 completed execution，`sessionId=internal-memory-reflection`。
- 两个系统任务的投影均为 `channel=system, botId=owner, scope=workspace`。这与普通渠道任务的 workspace 推导很可能不同，可直接用 `/api/desktop/tasks` 的 session action 构造原始症状反馈循环。
- 红色反馈循环已建立并连续运行两次：读取真实系统任务及最新 execution，再 POST `{action:"session"}`，要求 `session.messages.length > 0`。两次均稳定得到 HTTP 200 但 messages=0，精确复现“记录存在、会话详情为空”。
- 反馈命令是秒级、确定性、无人值守且会以 exit 1 表示原始症状，满足诊断 Phase 1/2。
- 仓库存在 `CONTEXT.md`，下一步需先读取其模块边界；未发现独立 ADR 路径命中。
- Owner 系统任务的执行入口是 `runtime.runInternalEvent`，由 `TaskScheduler`/settings task trigger 直接调用；事件 `chatId` 固定为 `internal-memory-reflection` 或 `internal-daily-materials`，但这还不能证明它们是实际持久化的 Agent session ID。

---
## 2026-07-15：系统任务执行详情为空（继续）

- 已建立稳定红灯：对所有已有执行记录的系统任务调用 `POST /api/desktop/tasks { action: "session" }`，接口均为 HTTP 200，但 `session.messages.length === 0`。
- Desktop 当前假设每条执行租约都对应一个 `MomRuntimeStore` context，并按事件文件所在 workspace + `chatId/sessionId` 加载。
- Owner 内部任务并不经过普通会话入口：`runInternalEvent` 直接调用 memory reflection / daily materials service；daily materials 的模型调用直接走 `assistant.reply(...)`，未见会话存储写入。
- 因此“会话可能已清理”很可能是误导性兜底文案：该次内部执行从一开始就没有可加载的对话 context。
- 下一步核对内部 service 返回值、execution lease 可持久化字段及 watcher 对返回结果的处理，再决定最小修复边界。
- 已确认 service 本身有结构化结果：记忆反思返回扫描会话/消息数与新增候选数；每日素材返回扫描数、输出文件等。
- `EventsWatcher` 的 `onEvent` 目前声明为 `Promise<void> | void`，`runAttemptWithTimeout` 在成功时主动丢弃返回值；`EventExecutionLeaseStore.markCompleted` 也只写状态和时间。
- 当前根因排序：① 执行结果未被 watcher/lease 持久化（已证实）；② Desktop 对系统任务错误复用普通会话读取（已证实）；③ 历史记录已清理（不是这批记录为空的主因）。
- 最小产品修复方向：为 execution lease 增加可选、结构化且面向人的执行详情；系统任务详情直接投影该记录，普通用户任务仍读取真实 Agent Context。
- 兼容策略：新执行保存 service 汇总；旧执行无法补回已丢弃的业务指标，但可用租约元数据生成真实的状态、起止时间、尝试次数与“旧版本未保存详细输出”说明，避免继续误报“会话已清理”。
- 事件结果应是共享上层的可选结构，而不是写进某个 Channel；普通任务返回 `void` 不受影响。
- 红灯证据：lease 测试把结构化 result 传给现有 `markCompleted` 时被当成 Date 并抛错；Desktop projection 测试因 `buildDesktopSystemTaskExecution` 尚不存在而加载失败。
- 实现采用可选 `result_json` 数据库迁移，旧库启动时自动加列；重试会清空上次 attempt 的 result，避免串用陈旧结果。
- Desktop API 只允许两种已知系统结果并将数字归一化；每日素材只暴露 service 已返回的项目相对路径，不暴露机器绝对路径。
- 对抗式复查的主要风险与处理：旧库缺列→自动迁移测试；retry 串结果→重新进入 running 时清空；历史无业务结果→lease 元数据 fallback；失败详情缺错误→投影并展示 `lastError`；未知/损坏 result→安全降级为 legacy fallback。
- 当前 live API 复测仍返回旧的 `messages=0` 且无 `execution`，原因是 3000 端口服务进程尚未重启加载新 build；隔离测试和构建均已验证新链路，未擅自中断用户正在运行的服务。
## 2026-07-15：内部审批 / Event Session 归属与侧栏标题修复

- 用户指定固定实施顺序，当前先只处理审批链路。
- 待建立三条核心红灯：审批命令是否进入普通 Session；Event 是否保留来源 Session；侧栏标题宽度是否被固定上限截断。
- 历史兼容必须采用元数据分类/投影隐藏，不允许删除 `/hosttools...` 或 `[EVENT:...]` 原始数据。
- 第 1 项初步边界：Desktop `resolveDesktopHostBashApproval` 当前仍 POST `/api/chat`，消息正文是 `/hosttools <decision> <requestId>`；现有注释声称不持久化，但用户数据已证明该假设不成立。
- 服务端 `/api/chat` 内部确有 `/hosttools` 解析逻辑，说明审批尚未拥有 Desktop 专用细粒度 endpoint。
- 最小修复 seam：复用现有 `/api/desktop/host-bash`，新增 `resolve_approval` action；客户端只提交 profile/session/request/decision 结构，不再构造聊天 message。
- `/api/chat` 的 legacy `/hosttools` 命令仍可保留给用户主动输入，但 Desktop 审批按钮必须绕开它。
- 已证实 `/api/chat` 命令分支会显式 `getOrCreateConversation` 并 append 用户命令与 Assistant 响应；“命令不持久化”的客户端注释与真实实现相反，这正是授权 Session 的直接原因。
- 专用 endpoint 可用现有 `profileId + sessionId` 找到 runtime；SessionStore 已维护 conversation→externalUserId 所有权索引，可在服务端自行恢复 scope，无需客户端传 userId 或聊天文本。
- Plain Web Session 可通过 `getWebConversationOwner(sessionId)` 恢复 externalUserId；Project Session 则由 `resolveRunnerChatId` 根据项目 Session 元数据恢复原渠道 scope，owner 缺失时可使用 Web profile 默认 identity 作为 fallback。
- 最小共享方式：导出已有的 Web HostTools resolver 给专用 endpoint 调用；专用 endpoint 不触碰 `getOrCreateConversation/appendMessage`，legacy 用户命令仍走 `/api/chat` 并保留原行为。
- 第 1 项已修复：Desktop 不再包含 hosttools subcommand mapper；专用 API 根据 Session owner 恢复 scope 并复用审批执行逻辑，不创建或追加 UI Session 消息。
- 第 2 项当前链路：`MomEvent` 只有 `chatId/sessionMode`，没有来源 `sessionId`；Watcher 创建 execution lease 时也把 `sessionId` 错填成 `event.chatId`。
- 触发侧 `BaseChannelRuntime.resolveInboundSessionId` 对非 fresh Event 直接读取“触发当时的 active session”，因此创建提醒后用户一旦切换 Session，提醒就会落入错误 Session；Web/Channel UI 还可能据此生成 `[EVENT:...]` 内部记录。
- `createEventTool` 构造时只接收 workspace/chat/timezone；工具注册处其实已有当前 `options.sessionId`，但没有传入 Event 工具，这是来源 Session 丢失的创建点。
- 各 Channel 会把 MomEvent 转成 synthetic inbound message；共享 `BaseChannelRuntime` 当前让 inbound `event.sessionId` 无条件优先，需调整为：fresh 仍新建 task Session，chat 才使用持久化来源 Session，legacy 缺字段再回退 active。
- `delivery=text` 的直接提醒可能绕过共享 runner，Web 需要单独确认 append 目标；其余 agent Event 可由 shared runtime 统一保证。
- 第 2 项红灯连续两次复现：新建 one-shot Event JSON 的 `sessionId` 均为 `undefined`。
- 修复覆盖完整链路：工具注册传入当前 Session、Event JSON 持久化、execution lease 记录目标 Session、各渠道 synthetic Event 继续携带、shared runtime 对 chat Event 优先使用来源 Session；旧 Event 缺字段时仍回退当前 active Session。
- `fresh` 周期任务仍由共享 runtime 新建独立 task Session，不会被持久化来源 Session 覆盖。
- 构建验证发现并立即修复 SvelteKit endpoint 普通命名导出限制；辅助导出改为 `_handleWebHostToolsCommand` 后 Server production build 通过。
- 第 3 项采用惰性、幂等、可逆回填：只有无 project/origin 且标题从开头严格匹配 `/hosttools` 或 `[EVENT:` 的 Web Session 才写入内部 origin；普通对话中间提到这些字符串不会命中，原消息和索引均保留。
- 第 4 项根因是 `.row-title { max-width: min(30ch, 100%) }`；移除上限并让时间成为 `flex: 0 0 auto` 后，标题随侧栏宽度增长且不会与时间争抢布局计算。
- 对抗式复查：Project 优先级高于内部分类；periodic fresh 分支先于来源 Session 解析；legacy Event 缺 sessionId 回退 active；hover 菜单仍使用原右侧固定槽且时间在 hover 时让位。


---
## 2026-07-16：Issue #16 关键发现

- 内置服务商 API 正常；前端先只取 `customProviders` 再按 builtin id 过滤，导致内置 tab 必为空。
- 一次性 direct-text Event 只写渠道/UI conversation，Desktop task detail 却读取 `MomRuntimeStore` Agent Context，因此 session 有 execution id 但无消息；修复必须位于共享 Channel Runtime。
- 一次性任务 UI 没有展示 `task.executions[0]`，即便 execution 已存在也无法从对应任务打开 Session。
- Skill 正文污染已有工作区修复正在移除全文注入，但 `[explicit skill invocation]` 控制块仍被当作 persisted user text；应改为单个可见 Markdown Skill 引用。
- 设置页自动化入口和聊天工作区自动化是两个入口；仅移除设置页入口，保留聊天主工作区。
- Agent 页重复标题来自 `ChatWorkspacePane` header 与 `AgentStudioPane` 内部 h2；应移除内部标题并收紧 padding。
- 红色基线：Skill helper 1/1 失败；Desktop 静态契约 51/56 通过、5 项失败。


---
## 2026-07-16：Issue #17 / #18 关键发现

### GitHub 事实
- #17「desktop 500 问题」：Project 删除/Session 增删查、Providers、Plugins、Diagnostics、Sandbox、Trace、Active Runs、Usage、Host Bash 等大量 Desktop API 均返回 500；共同错误是运行中的 `desktop-runtime/build/server/manifest.js` 动态 import 已不存在的哈希 chunk（`ERR_MODULE_NOT_FOUND`）。无评论。
- #18「web/app 无法选择多 bot/profile」：设置中添加多个 Web Profile 后，新 Session 的 Chat 输入区仍只能使用 default；期望在输入框上方的 Chat 区选择 Profile/Bot。无评论。

### 初步验收口径
- #17 必须证明发布/更新 Desktop runtime 时，manifest 与全部哈希 chunks 始终来自同一构建代次；运行中旧进程与更新后新进程都不能引用被覆盖/删除的 chunk。
- #18 必须让 Web 与 Desktop 的新会话显式选择已启用 Web Profile，并把选中的 profileId 贯穿会话创建、消息发送、Session 列表/恢复，而不是仅改变显示文本。

### 代码证据
- #17 Desktop supervisor 解压新版 runtime 到 staging 后，直接 `remove_dir_all(runtime/desktop-runtime)` 再把新版 rename 到同一路径。若旧 Desktop sidecar 仍在运行，它已加载旧 manifest，但后续懒加载会从这个已被删除/替换的固定路径读取旧哈希 chunk，完全吻合 issue 的 `manifest.js → missing _server.ts-<old hash>.js`。
- Server 构建自身已有 staged publish + “旧 chunk 保留”测试，但它只保护同一 build 目录内的热构建；Desktop supervisor 的整目录删除绕过了这层保护。
- #18 Desktop 已存在 `BotMention`：draft 时可选 Web Profile，已有 Session 时 locked；`ChatSessionStore` 也以 `profileId:sessionId` 固定 runtime。需要继续确认 newConversation 是否真正进入 draft，以及 Web 浏览器端是否缺少等价选择器。
- 用户工作区里的 Deferred 设计稿讨论的是“只保留 default Profile、改为 Session 级 Agent 选择”，而 #18 当前明确要求选择多个 Web Profile/Bot。此次不应偷偷采用那个尚未决策的 Agent 模型，也不修改该未跟踪文档。

### 假设验证
- H1（#17）命中：runtime 改为 `desktop-runtime-<version>` 不可变代次目录后，升级回归测试确认 v1/v2 路径分离且旧 chunk 仍存在。
- H2（#18）命中：Desktop 新对话改走现有 `newConversationDraft(defaultBot())` 后，输入框上方 `BotMention` 进入 select mode；第一条消息仍由 `ChatSessionStore.send` 使用选中 profileId 创建并固定 Session。
- H3（发布包漏 chunks）未命中：Server adapter 已覆盖 staged chunks-first/manifest-last，Desktop archive直接打包完整 release build；故障发生在安装后固定目录被替换。
- H4（bootstrap 只返回 default）未命中：多 Profile bootstrap 定向测试通过，服务端会投影全部 enabled Web Profile。
- H5（选择仅改显示）未命中：DraftStore 与 SessionRuntimeRegistry 的 profileId 测试通过，运行 key 是 `profileId:sessionId`，后续 stop/approval/send 均使用固定 binding。
# 2026-07-16 — Desktop UI Geist consistency convergence

- The active goal already matches the supplied plan; no new goal should replace it.
- The worktree contains pre-existing changes in `styles.css`, `chat-ui.test.mjs`, Chat input/live/transcript components, `features.md`, and `CHANGELOG.md`.
- Existing changes add composer invocation chips, live status pulse, assistant-meta layout, and composer insets. These are outside the new plan but overlap files in scope and must be preserved.
- The accepted visual direction is restrained Geist flat UI. The supplied plan explicitly forbids redesign and new component forms.
- The main logic risk is symmetric modal/drawer exit animation because Svelte conditional unmounting can remove the element before the animation completes.
- P0 diagnostics initially exposed the missing top-level close-label caller; after adding a dedicated bilingual key, diagnostics and all focused Desktop tests pass.
- P0 verification evidence: Svelte 0/0; Desktop UI/HTTP 58/58; projection tests 13/13; Tauri tests 13/13.
- Final browser QA at 860×620 covered light/dark and Chinese/English controls: no horizontal overflow, no unnamed buttons, and no functional text below 11px outside Agent City artwork.
- Browser QA exposed a fixed-English document language despite Chinese visible copy. The root `lang` now follows the active locale so assistive technology receives the same language state as the UI.
- Final verification evidence: Svelte 0/0, production build succeeded, Desktop UI/HTTP 61/61, projection tests 13/13, Tauri tests 13/13, and `git diff --check` passed.

---
