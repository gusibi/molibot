# Chat Workspace Audit Findings

## Project Workspace Alignment — 2026-07-09

- The user confirmed the implementation brief: preserve the current product design system, make Project match Chat's Session UI and behavior, and keep every control fully functional.
- Creation must be a staged flow: enter project name first; then choose automatic directory creation or an existing folder. Only the existing-folder branch may open a native directory picker, and only once.
- The first-entry defect requires a deterministic regression signal asserting that selecting a Project Session immediately populates the right-side conversation.
- Product Design saved context is not configured; `DESIGN.md` and the current Chat implementation are the authoritative visual sources.
- Project currently owns a hand-built Session row, inline rename controls, and a separate delete popover, while Chat already centralizes these in `chat/ConversationRow.svelte`; this duplication explains the visible drift.
- Clicking Add Project currently calls the native picker before rendering any name UI (`beginAdding -> chooseProjectDirectory`), exactly matching the reported double/early picker behavior.
- `projectsStore.loadProjectSessions` automatically selects the first Session while Project rows can concurrently select another; the store has a response guard, but the page still depends on async selection side effects and has no loading/selection generation model.
- Existing Project layout/styles are semantic shared CSS, but the creation form is inline in the sidebar. The requested Codex-like branch choice is better represented by the existing modal pattern and existing semantic button/input tokens.
- All Project implementation landed in one initial commit, including comments claiming first-load race protection; there is no behavioral regression test behind those claims, only source-regex assertions.
- Automatic directory creation is not implemented in either the Desktop host or Projects API. The server store already owns path validation and Project registration, making it the safest seam for atomic create-and-register behavior without a second native dialog.
- The deterministic race reproduced as expected: after selecting Project B, Project A's delayed Session-list response changed `selectedSessionId` from `b-1` to `a-1`. Project ID + request-generation ownership is the necessary guard; Session ID alone is insufficient.
- Real rendered QA confirmed the name-only first step and two directory choices in dark theme. At 540×720 the dialog measured 440px inside a 540px body with no horizontal overflow. No project or directory was created during visual verification.
- The local QA service had no registered Projects, so populated Session-row identity is verified at the real shared-component seam (`ProjectList -> ConversationRow`) plus the runnable selection-state regression, not by fabricating production data.


## macOS First-Launch Bootstrap — 2026-07-07

- Supplied desktop sidecar log deterministically fails before server initialization: Node cannot resolve `dotenv` imported by the packaged `molibot-runtime/scripts/start-server.mjs`.
- Because module linking fails before script execution, creating DB/settings/profile files alone cannot repair this build; packaged dependency completeness must be fixed first.
- Existing `~/.molibot` is evidence for data shape only. User-specific settings, credentials, histories, queues, and profile contents must not be copied as defaults.
- Tauri's installed resource tree omitted the entire `node_modules` directory even though the prepared release directory contains it. The server build retains many external package imports, so removing only the top-level `dotenv` import would merely reveal the next missing package.
- The release runtime must therefore travel as an opaque archive and be materialized into the writable data-root runtime cache. A version marker makes this idempotent and refreshes it after an app/runtime update.
- The correct shared profile bootstrap seam is immediately after `initDb()` and before runtime services load settings or prompts. Six bundled templates exist (`AGENTS`, `BOOTSTRAP`, `IDENTITY`, `SOUL`, `TOOLS`, `USER`); `SONG.md` has no bundled default and remains optional.
- The generated Adapter Node `build/handler.js` imports `@sveltejs/kit/node` at runtime. Keeping `@sveltejs/kit` in devDependencies makes every `pnpm install --prod` release incomplete even when `node_modules` itself is packaged.
- Adapter Node loads `hooks.server.ts` lazily on the first HTTP request. The sidecar now performs an internal `/health` request after the listener binds and before publishing `ready`, so DB/profile/settings initialization is complete at the service-ready boundary rather than depending on the Desktop UI's first API call.


- `DESIGN.md` requires a 4px spacing scale, 8/16/32–40px grouping rhythm, compact cards at 16px and standard cards at 24px, mobile/desktop reflow, restrained tonal elevation, one tight radius family (6/12/16), 40px medium controls, visible two-layer focus rings, and concise sentence-case copy.
- Audit destination: `docs/audits/chat-workspace-2026-07-04/`.
- Screenshot 01 (`01-chat.png`) shows the normal Chat workspace. Strengths: stable two-pane structure, clear selected session, restrained neutral surfaces, centered transcript column, and a persistent composer. Risks: header and composer icon-only controls appear around 32px rather than the 40px medium-control target; “Failed to load file (404)” is separated from the affected attachment and exposes technical English without retry/remove guidance; the assistant failure bubble is generic English in a Chinese UI; channel label truncation (`Teleg...`) happens despite a very wide window; the composer has many equal-weight controls and weak grouping between attachment/tools/voice and model/reasoning/send.
- Screenshot 02 (`02-automations.png`) shows populated Automations. Strengths: clear workspace header, visible create/search actions, task status, schedule, recent history, session links, and consistent left navigation. Risks: the command deck, nested task cards, inner task-text panels, schedule panel, and recent-run table create four surface levels; `DESIGN.md` asks hierarchy to come from restrained tonal surfaces and a tight radius family, while this screen mixes 16px hero, ~14px cards, 9px inner panels, pills, multiple shadows, and decorative rings. The task title repeats the first line of the task body, raw Cron dominates over a human schedule/next run, `COMPLETED` remains English in Chinese UI, task-level `待执行` conflicts perceptually with recent completed runs, and 28–38px action targets are smaller than the 40px medium-control standard. The page is functional but visually and semantically dense.
- Screenshot 03 (`03-skills.png`) shows populated Skills. Strengths: visible total/enabled counts, consistent status badges, scope metadata, and a straightforward two-column inventory. Critical layout issue: CSS Grid rows inherit the tallest card, so long descriptions create large blank areas in neighboring cards. There is no search/filter despite 26 entries, descriptions are unbounded, mixed-language metadata dominates the screen, and “技能广场” promises discovery/installation while the page only inventories installed/generated skills. Repeated identical icons and pills provide little scanning value.
- Source verification confirms several `DESIGN.md` mismatches: primary nav rows are 34px, composer tools 32px, selectors 28px, send 36px, and automation actions 28–38px versus the documented 40px medium control; most interactive Chat controls lack explicit `:focus-visible` rings; skill cards use unrestricted description height; automation uses multiple custom radii and shadows beyond the intended tight family.
- Adversarial review found that changing the breakpoint alone was insufficient: the sidebar width is stored in an inline CSS custom property, so a media-query custom-property assignment would lose the cascade. The compact rule now overrides `grid-template-columns` and the resizer position directly.

## Periodic Schedule Builder — 2026-07-06

- Desktop task creation is already periodic-only end to end; the create API accepts `schedule` and always writes a periodic watched-event JSON file.
- The UX problem is isolated to direct Cron entry and edit-state parsing. No runtime scheduler or channel-layer change is needed.
- Existing arbitrary Cron expressions must fall back to custom mode so editing never rewrites or drops unsupported ranges, steps, months, or mixed fields.
- The project has no `src/lib/components/ui` shadcn-svelte tree. This task must therefore reuse existing semantic controls and shared CSS rather than introduce a parallel component system.
- Rendered comparison exposed an existing CSS cascade issue: the later base `.modal-card` width overrode `.task-editor-modal`, shrinking the editor to about 560px. The task-specific selector now has sufficient specificity to preserve its intended 720px width.

## Automation Target Picker — 2026-07-06

- The old target list treated every Bot child directory as a chat and separately added a Bot-level workspace target. That directly exposed internal storage topology as product choices.
- External session keys encode the real Bot and scope as `bot:<instance>:chat:<scope>:<session>`, while conversation metadata carries Bot name, sender name, thread title, and chat type. These are the correct source for user-facing targets.
- The correct source of truth is each enabled channel instance's `allowedChatIds`, not filesystem directories or historical external-session metadata. Existing workspace tasks remain in task summaries but workspace is no longer offered for creation.
