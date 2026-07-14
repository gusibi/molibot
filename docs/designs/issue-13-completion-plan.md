# Issue #13 completion plan

Status: complete

This plan turns every unfinished or weakly verified requirement in GitHub Issue #13
into an executable goal. A checkbox is closed only with implementation, regression
coverage, a populated runtime check, and visual evidence where presentation is involved.

## G0 — Baseline and evidence

- [x] Re-audit the live General, Models, Providers, Trace, Automations, and Chat surfaces.
- [x] Record the false-positive source-only test gap.
- [x] Add focused behavior contracts and exercise the real populated preview/runtime rather than relying on source assertions alone.
- [x] Capture and inspect each target route at 860×620 and wide width.

## G1 — Shared foundation

- [x] Create shared `PageHeader`, `SettingGroup`, `SettingRow`, `Select`, `SearchField`,
  `StatusBadge`, `OverflowMenu`, `EmptyState`, and `Skeleton` primitives.
- [x] Move target pages away from page-private copies of those controls.
- [x] Make the macOS system UI font stack authoritative throughout Desktop.
- [x] Restrict product surface radii to 6 / 8 / 12 / full (illustrative mascot geometry is exempt).
- [x] Replace scattered interactive durations with 100 / 160 / 240 / 300ms motion tokens.
- [x] Add common immediate pressed feedback and visible focus behavior.
- [x] Keep ordinary cards shadowless and reserve elevation for overlays.
- [x] Add one human-readable model/provider display projection with technical IDs secondary.
- [x] Add shared human time, duration, and cron schedule presentation.

## G2 — Settings shell and General

- [x] Give every Settings section the same title, localized description, and top position.
- [x] Keep the stable sidebar, selected state, service footer, and 52px drag toolbar aligned.
- [x] Add a sticky-header scroll edge that appears only after scrolling.
- [x] Ensure every save-capable section uses the fixed `.settings-footbar` or its entity-editor fixed footer.
- [x] State the scope of settings changes where it matters.
- [x] Make General controls compact and visually identical to shared controls.
- [x] Verify no clipping at 860×620, Chinese/English, light/dark, and native control semantics.

## G3 — Models

- [x] Always show a meaningful transcription selection or explicit unconfigured state.
- [x] Show human-readable provider/model names as the primary select value.
- [x] Move provider ID, model ID, context, pricing, and capability flags to secondary detail.
- [x] Replace Haiku/Sonnet/Opus-first task-level language with product-level capability names.
- [x] Use equal-width compact selects within each group.
- [x] Keep primary model routes visible in the first 860×620 viewport.
- [x] Normalize section spacing, advanced disclosure, save feedback, and rollback on failure.

## G4 — Providers

- [x] Rename provider mode and protocol language for users.
- [x] Use a constrained provider list with a selected detail/editor rather than 30 expanded rows.
- [x] Keep search, category, sort, and add actions next to the provider list.
- [x] Align section actions with section headers.
- [x] Show provider/model human names first and protocols/IDs/URLs as secondary details.
- [x] Use shared equal-width controls for related fields.
- [x] Keep enable/default as Switch/selection controls; move rare/delete actions to overflow.
- [x] Add immediate save/verify/discover feedback, retry, and safe confirmation where irreversible.

## G5 — Trace

- [x] Keep restrained semantic KPI cards without strong top bars or decorative color dependency.
- [x] Use product wording for current, stuck, and unlinked runs.
- [x] Keep time and duration human-readable and localized.
- [x] Bound or virtualize long active-run/fact lists.
- [x] Put raw prompts, URLs, paths, IDs, events, and payloads behind row detail disclosure.
- [x] Keep range controls near metrics/charts and row actions in anchored overflow menus.
- [x] Preserve exact Stop and orphan-cleanup behavior with immediate feedback and retry.
- [x] Provide Empty and Skeleton states and accessible chart/status alternatives.

## G6 — Automations

- [x] Use one canonical list/detail workspace; remove the legacy Settings expanded-card UI from both live entry points.
- [x] Keep user/system tabs, search, statistics, and filters only in the list workspace.
- [x] Convert cron to localized natural-language schedules in primary UI.
- [x] Separate enabled, schedule, current execution, and latest result everywhere.
- [x] Make list statistics and selected-detail status use the same projection.
- [x] Keep wide inspector fixed without a close button; use right overlay below 1100px.
- [x] Add overlay close, drag/gesture close, and interruptible right-edge transitions.
- [x] Keep Run visible, distinguish Starting/Running, refresh continuously, and expose Stop.
- [x] Move owner, IDs, cron, payload, session IDs, and paths to advanced technical detail.
- [x] Add optimistic disable feedback and Undo; protect irreversible deletion with confirmation.
- [x] Bound task/history lists and preserve watched-event runtime contracts.

## G7 — Chat

- [x] Render every assistant response as a flat Message Unit with the actual Agent identity.
- [x] Keep body and composer at or below 720px.
- [x] Keep the composer at one compact row by default and auto-grow without layout jumps.
- [x] Show human model name, time, tools, and sources as quiet secondary metadata.
- [x] Collapse thinking/tool detail by default and anchor detail near message metadata.
- [x] Keep search as an icon that expands left from its trigger and can be interrupted/reversed.
- [x] Keep model selection inside Composer and group attachment/model/send controls clearly.
- [x] Preserve Stop for long runs, retry/recovery, queue behavior, and message actions.
- [x] Verify the 260px resizable sidebar follows the pointer 1:1 and remains keyboard usable.

## G8 — Cross-app interaction, accessibility, and performance

- [x] Provide visible feedback within 100ms for buttons and asynchronous actions.
- [x] Make Inspector, Popover, Search, and menu transitions reversible without click lockout.
- [x] Anchor popovers to triggers and keep inspector movement tied to the right edge.
- [x] Support Tab/Shift+Tab, Enter/Space, Escape, arrow-key menus, Command+F,
  Command+,, Command+K, and a consistent Command+Return action.
- [x] Verify visible focus rings and screen-reader names/roles/live regions.
- [x] Ensure status always includes text or a symbol, never color alone.
- [x] Verify Reduced Motion, Reduced Transparency, and Increased Contrast.
- [x] Add automatic material degradation and a user-facing low-performance preference.
- [x] Keep fewer than three large blur regions and unload closed popovers.
- [x] Avoid scroll jump and layout-moving hover actions; bound genuinely long lists.
- [x] Use the real browser accessibility tree for diagnostics; no permanent development panel was needed.
- [x] Complete a VoiceOver-oriented semantics pass and document the platform smoke step below.

## G9 — Final acceptance and truthful documentation

- [x] Run focused component/API tests with temporary or injected persistence.
- [x] Run Svelte diagnostics, production build, and `git diff --check`.
- [x] Capture and inspect populated screenshots for every target page across both themes,
  both locales, 860×620, and a wide window.
- [x] Adversarially attack and fix the 3–5 likeliest failures.
- [x] Change `prd.md`, `features.md`, `CHANGELOG.md`, and `readme.md` only after the
  implementation evidence is complete; remove the current premature completion claims.

## Final evidence

- Browser measurements: shared selects 260×30px, switches 38×22px, Chat composer 50px at rest, content/composer capped at 720px, and no horizontal overflow at 860px or 1280px.
- Keyboard behavior: Command+F, Command+K, Command+comma, Command+Return, arrow-key menus, Escape dismissal, and keyboard sidebar resizing are wired; runtime checks confirmed focus movement and popover unmounting.
- Accessibility: dialogs receive focus, statuses include text/symbols, live regions remain present, and reduced-motion/transparency/contrast plus low-performance CSS paths are active.
- macOS VoiceOver smoke step for release QA: enable VoiceOver, traverse the Settings sidebar and one row per target page with Control+Option+Arrow, open/close a menu and destructive confirmation, then send from Chat with Command+Return. The browser accessibility tree was verified in this pass; this final OS speech-output check belongs to packaged-App release QA.
- Focused verification: Desktop UI/HTTP 53/53, API/presentation 74/74, Svelte diagnostics 0 errors/0 warnings, production build succeeds, and `git diff --check` is clean.
