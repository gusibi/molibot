# Molibot PRD (V1)

## 1. Product Goal
Build a minimal but real multi-channel AI assistant using pi-mono, with **Telegram + CLI + Web** in V1.

## 2. Target Users
- Solo builders and small teams who want one AI assistant across channels.
- Users who prefer simple interaction over complex automation.

## 3. V1 Scope

### Must Have (P0)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P0-01 | Unified message router | P0 | V1 | Incoming messages from Telegram/CLI/Web are normalized and processed by one core pipeline |
| P0-02 | Telegram adapter | P0 | V1 | Bot receives user text and returns assistant response with stable delivery/retry |
| P0-03 | CLI adapter | P0 | V1 | `molibot cli` supports interactive multi-turn conversation |
| P0-04 | Web chat | P0 | V1 | Browser chat supports send/receive and response streaming |
| P0-05 | Session persistence | P0 | V1 | Conversation history persists in SQLite and can be restored by session |
| P0-06 | Basic guardrails | P0 | V1 | Request size limit, rate limiting, and secrets via env vars |
| P0-07 | Operational baseline | P0 | V1 | Health endpoint, structured logs, and startup checks are implemented |

### Should Have (P1)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P1-01 | Conversation summary compression | P1 | Post V1 | Old turns summarized to keep prompt size bounded |
| P1-02 | Redis cache/rate state | P1 | Post V1 | Hot session and throttling moved from in-memory to Redis |
| P1-03 | Basic tool call wrapper | P1 | Post V1 | 1-2 tools can be called via normalized interface |
| P1-04 | Telegram mom parity core | P1 | V1.1 | Telegram bot supports per-chat runner, stop/cancel, tool-calling (`read/bash/edit/write/attach`), attachment ingestion, and event-file scheduling (immediate/one-shot/periodic) |
| P1-05 | Global skills registry for mom runtime | P1 | V1.1 | Runner loads reusable skills from `<workspace>/skills/**/SKILL.md` and exposes skill catalog/rules in system prompt |
| P1-06 | Pluggable memory plugin architecture | P1 | V1.1 | Provide stable memory gateway with replaceable core and unified interfaces (`add/search/flush/delete/update`) plus plugin on/off setting in UI |
| P1-07 | Memory retrieval strategy and lifecycle | P1 | V1.1 | Memory should support layered storage (`long_term` + `daily`), incremental flush from sessions, and hybrid retrieval (keyword + recency) for prompt injection |
| P1-08 | Memory governance and manual operations | P1 | V1.1 | Memory entries should support conflict labeling and TTL expiration, and operators should have a settings page to list/search/flush/edit/delete memories |
| P1-09 | Unified memory filesystem layout | P1 | V1.1 | All memory files must be stored under `${DATA_DIR}/memory`; channel/runtime-specific memory uses subdirectories under this root (no memory files directly in chat workspace folders) |
| P1-10 | Gateway-only memory contract for agent layer | P1 | V1.1 | Telegram agent memory operations must be routed through memory gateway interfaces/tools (not direct file edits), with periodic import from external memory files and unified management visibility |
| P1-11 | File-driven runner instruction stack | P1 | V1.1 | Telegram runner system prompt should load from workspace `AGENTS.md` in real time and optionally merge `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md`; fallback order must be `workspaceDir` -> project root -> bundled default template |
| P1-12 | Auto-maintained instruction profile files | P1 | V1.1 | Bot prompt should define automatic maintenance for `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md` based on explicit conversation triggers, with high-risk confirmation gate and deterministic priority conflict rules |
| P1-13 | AGENTS workspace-target enforcement | P1 | V1.1 | Any AGENTS update operation must target `${workspaceDir}/AGENTS.md` only; project-root `AGENTS.md` must remain unchanged during bot-runtime instruction edits |
| P1-14 | Workspace bootstrap CLI init command | P1 | V1.1 | Add `molibot init` to initialize `${DATA_DIR:-~/.molibot}`; initialize `AGENTS.md` from `src/lib/server/mom/prompts/AGENTS.default.md` and create empty `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md` for first-run setup |
| P1-15 | Profile files global-path guardrail | P1 | V1.1 | Enforce that `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md` are written only to `${DATA_DIR}` root-level files, preventing chat/workspace-scoped duplicates like `moli-t/bots/<bot>/<chatId>/soul.md` |

### Later (P2)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P2-01 | New channels (WhatsApp/Lark/Slack) | P2 | V2 | New adapters added without core pipeline change |
| P2-02 | Cross-channel identity linking | P2 | V2 | User can merge identities across channels |
| P2-03 | Long-term memory (vector DB) | P2 | V2 | Retrieval-augmented memory improves continuity |
| P2-04 | Admin dashboard | P2 | V2 | Operator can inspect sessions/errors and run controls |

## 4. Out of Scope (V1)
- WhatsApp/Lark/Slack production integration.
- Autonomous multi-step agent planning loops.
- Enterprise permission model and RBAC.

## 5. Technical Approach (Plain Language)
- Build one central backend that understands a single message format.
- Every channel gets a thin adapter: transform inbound message into unified format, then transform response back.
- Telegram adapter is implemented with `grammY` to reduce webhook/update handling complexity.
- Use pi-mono runtime for LLM interaction.
- Store conversations in SQLite so users can continue sessions.

## 6. Dependencies and Decisions Needed
- Telegram Bot token and webhook URL.
- Telegram bot library: `grammY` (`grammy` npm package).
- LLM provider/API key configuration.
- Deployment environment (single VM or container platform).

## 7. Complexity Assessment
- Overall: **Medium**.
- Highest risk: stable channel delivery and production error handling.

## 8. Release Definition (V1)
V1 is complete when a user can chat with Molibot from Telegram, CLI, and Web with consistent behavior and persisted session history.

## 9. Documentation Structure (Current)
- `readme.md`: project entry and document navigation.
- `prd.md`: product scope, priority, and acceptance criteria.
- `architecture.md`: V1 architecture and sprint plan.
- `features.md`: implementation status and change log.
- `AGENTS.md`: collaboration and process constraints.

## 10. Implementation Status (2026-02-11)
- Completed:
  - Shared message router with validation and rate limit.
  - Telegram adapter using `grammY`.
  - CLI adapter and Web adapter (HTTP API + static page).
  - SQLite persistence for conversations and messages.
  - Real pi-mono assistant runtime wiring (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`), no mock branch.
- Remaining for full V1 quality:
  - Add automated tests and deployment packaging.

## 11. Current Blocker
- Build verification is blocked in current environment because npm registry hosts are unreachable (`ENOTFOUND`), so dependencies cannot be installed locally in this session.

## 12. Compatibility Update (2026-02-11)
- SQLite implementation switched from `better-sqlite3` to Node built-in `node:sqlite` to avoid native addon compile failures on modern Node versions (for example Node 25 on arm64 macOS).

## 13. Provider & Telegram Config (2026-02-11)
- Model response can now be controlled via `.env` in two modes:
  - `AI_PROVIDER_MODE=pi`: use pi-mono provider/model settings.
  - `AI_PROVIDER_MODE=custom`: use custom OpenAI-compatible host/key/model.
- Telegram access control can be configured via `.env`:
  - `TELEGRAM_BOT_TOKEN` for bot auth.
  - `TELEGRAM_ALLOWED_CHAT_IDS` for optional chat whitelist.

## 14. Web UI Decision (2026-02-11)
- Replaced custom hand-written web chat page with official `@mariozechner/pi-web-ui` based page.
- Web UI now uses provider keys from browser-side prompt/storage (IndexedDB), while Telegram/CLI continue using server `.env` provider settings.

## 15. Web UI Runtime Diagnostics (2026-02-11)
- Added explicit startup diagnostics in Web UI page so failures no longer appear as blank/black screen.
- If `pi-web-ui` module load/init fails, the page now displays actionable checks and logs error details to console.

## 16. Web UI Delivery Path Update (2026-02-11)
- Switched Web UI delivery from browser CDN dynamic imports to local Vite app build, aligned with `pi-web-ui` example workflow.
- This removes runtime MIME/CDN resolution failures and makes Web UI behavior deterministic.

## 17. Build & Dev Fixes (2026-02-11)
- Type fixes:
  - `PI_MODEL_PROVIDER` now validated against `KnownProvider` set before calling `getModel`.
  - SQLite row mapping now uses explicit runtime conversion instead of unsafe direct cast.
- Developer workflow:
  - `npm run dev` now launches backend and Web dev server together.
- Dev workflow now uses managed parallel startup (`concurrently`) for backend + web, avoiding orphaned background processes from shell ampersand startup.
- Backend startup now reports clear `EADDRINUSE` guidance for port conflicts.

## 18. SvelteKit Migration (2026-02-11)
- Web app migrated from custom Vite-only entry to SvelteKit.
- `pi-web-ui` is mounted in SvelteKit client page (`+page.svelte`, SSR disabled).
- Build output target is `build` via root `adapter-node` config.
- SvelteKit frontend/backend now use a single root `package.json`; install/build run from repository root.
- Verification note: web dependency install/build in this environment is currently blocked by npm registry DNS/network failures (`ENOTFOUND registry.npmjs.org`).

## 19. Single-Process SvelteKit Unification (2026-02-11)
- Development runtime unified to one process (`npm run dev` -> SvelteKit only).
- API endpoints moved into SvelteKit server routes (`/api/chat`, `/api/stream`, `/health`).
- Telegram bootstrap moved into SvelteKit server lifecycle (`hooks.server.ts` + shared runtime).
- Web build switched to SvelteKit `adapter-node` for server-side API support in production.
- Web runtime stabilization: switched `pi-web-ui` page integration from dynamic imports to static imports and explicitly optimized related deps in Vite to avoid Lit class-field runtime issues in dev.
- Added compatibility workaround for current `pi-web-ui` + Lit runtime: clear known shadowing fields on `ChatPanel` instance before first update to prevent crash.
- Web scripts now run `svelte-kit sync` before `vite dev/build` to ensure generated tsconfig is present.
- Runtime compatibility fix: disable Lit `class-field-shadowing` warning at component-constructor level for `pi-web-ui` elements (`pi-chat-panel`, `agent-interface`, `artifacts-panel`, etc.) to prevent white-screen crash in dev.
- Web dev runtime now runs in production mode to prevent Lit dev build hard-throw behavior (`class-field-shadowing`) triggered by current `pi-web-ui` package output.

## 20. Settings Management UI (2026-02-11)
- Added Web settings page at `/settings`.
- Added settings API (`GET/PUT /api/settings`) for AI provider and Telegram bot config.
- Settings are persisted in SQLite (`app_settings`) and applied to runtime.
- AI provider changes apply to new requests immediately; Telegram config triggers runtime reload attempt.

## 21. Chat Model UX Constraint (2026-02-11)
- Web chat should not expose the full built-in `pi-web-ui` model catalog.
- V1 behavior: hide model selector in chat and keep model selection controlled through Molibot settings/config only.
- Web chat inference path should proxy through backend runtime APIs so the configured provider/model in Settings (including custom provider mode) is actually used.
- UX correction: keep model/thinking controls available in chat UI, while ensuring backend runtime settings remain the effective inference source.
- Reliability correction: Web chat must initialize custom provider storage and degrade gracefully when editor refs are temporarily unavailable (no silent send failure).

## 22. Settings UX & Provider Management (2026-02-11)
- Settings IA split:
  - `/settings`: hub page.
  - `/settings/ai`: AI provider mode, default provider/model, and custom provider list management.
  - `/settings/telegram`: Telegram-only settings.
- AI provider requirements:
  - PI provider must be selectable via dropdown (not free text).
  - Support multiple custom providers (add/remove/edit).
  - Support explicit default custom provider selection.
  - Runtime inference must use selected defaults immediately after save.
- Data compatibility requirement:
  - Web local storage schema upgrades must be versioned so newly added object stores are created for existing users without manual data reset.
  - When client cache/state is stale, rollout may require DB namespace bump to guarantee deterministic schema recreation.

## 23. Persistence Strategy Update (2026-02-11)
- Backend persistence is file-based JSON only (no SQLite/database runtime dependency).
- Settings persistence:
  - Single file: `data/settings.json`.
- Session/message persistence:
  - Session index file: `data/sessions/index.json`.
  - One session per file: `data/sessions/<conversationId>.json`.
- Browser persistence:
  - Do not use IndexedDB for Molibot state; Web UI storage is in-memory only and backend is source of truth.
- Web session UX:
  - Session list and session detail must be read from backend JSON session files via server APIs.
  - Web chat must support selecting an existing backend session and creating a new backend session.
  - Session title should be derived from the first user message summary and stored server-side.
- Model selector UX:
  - Chat-page model switcher must be sourced only from backend-configured providers/models.
  - Built-in third-party model catalogs that are not backend-configured must not be shown.
- Response UX:
  - Assistant response should enter visible streaming state immediately after send, with perceptible incremental rendering instead of delayed one-shot appearance.
  - Chat UI must remain realtime even if underlying UI-library subscriptions are unstable; app-level fallback update hooks are required.

## 24. Telegram Mom Parity Track (2026-02-11)
- Objective:
  - Upgrade Telegram adapter from simple chat relay to a full per-chat agent runtime aligned with `example/pi-mono/packages/mom` core behavior.
- Current implementation status:
  - Core modules are implemented under `src/lib/server/mom/*` (runner/store/tools/events/tools).
  - Default runtime path in `src/lib/server/adapters/telegram.ts` now runs mom-t flow with `grammy`.
  - Runtime config is still sourced from Web settings (`telegramBotToken`, `telegramAllowedChatIds`) and hot-reloaded through existing settings update path.
  - Added structured server observability logs across telegram adapter + runner to make each request traceable end-to-end in runtime logs.
  - Added operator-facing chat-id introspection via Telegram `/chatid` command and startup whitelist logs.
  - Dev server startup now actively bootstraps runtime once (ping `/api/settings`) to avoid missing Telegram status logs before first manual request.
  - Runner now performs provider/config preflight and returns human-readable Telegram errors (no process panic) when API key/provider config is missing.
  - Runner now emits AI call trace telemetry (model/api/baseUrl/path/key presence, stream start, assistant usage/content counts) for provider-call debugging.
  - Custom provider request URL assembly now honors configured `path` when deriving SDK `baseURL` (fixes OpenRouter-style `/v1/chat/completions` routing).
  - Telegram response UX cleanup: suppress duplicate status fallbacks on no-op edits, reduce tool-detail chatter to error-only, and sanitize ANSI escape sequences in tool outputs.
  - Runtime logs now default to key events only; full verbose tracing remains available via `MOM_LOG_VERBOSE=1`.
  - Event watcher now listens to both global workspace events and per-chat scratch events (`data/telegram-mom/<chatId>/scratch/data/telegram-mom/events`) to match local reminder write paths.
  - Telegram system prompt is upgraded with mom-style operational guidance (environment, Telegram formatting, event creation guarantees, and reminder scheduling rules).
  - One-shot/immediate scheduled events now deliver the event `text` directly to Telegram chat, avoiding LLM paraphrase/confirmation drift.
  - Event files are retained after execution and updated with `status` metadata (completed/skipped/error, completion time, run count) instead of being deleted.
  - Tool path resolution now guards against duplicated scratch prefixes to avoid nested directories like `.../scratch/data/telegram-mom/<chatId>/scratch/...`.
  - Existing duplicated nested scratch data for active chat(s) can be safely migrated in-place to canonical scratch root without overwriting conflicts.
  - AI custom provider config now supports multi-model per provider (`models[]`) with explicit `defaultModel` and `supportedRoles` metadata.
  - Added provider capability test endpoint to verify provider connectivity and detect whether the target model supports `developer` role.
  - Telegram mom stream path now performs role-compatibility fallback: if provider does not support `developer`, map `developer` messages to `system` before upstream request.
  - AI settings UI is upgraded to split-pane workflow: left searchable provider list and right detail panel for provider fields, multi-model editing, default model selection, and capability testing.
  - Role-compatibility fallback now also handles `systemPrompt` by lowering it into explicit `system` message when provider lacks `developer` support, eliminating adapter-internal developer-role injection risks.
  - Added global skills support aligned to mom model: runner now discovers `data/telegram-mom/skills/**/SKILL.md` and injects available skills plus usage protocol into system prompt each run.
  - Skill storage is unified at workspace scope (`<workspace>/skills`), removing chat-level skill location guidance from Telegram prompt.
  - Installed initial workspace skill `find-skills` at `data/telegram-mom/skills/find-skills/SKILL.md` to validate runtime discovery path.
  - Under current root-start runtime (cwd=`/Users/zongxiaocheng/github/molipibot`), active workspace resolves to `data/telegram-mom`; skill files must exist under `data/telegram-mom/skills/` to be discovered at runtime.
  - Path semantics clarification:
    - Service process cwd: `/Users/zongxiaocheng/github/molipibot`
    - Telegram workspace dir: `/Users/zongxiaocheng/github/molipibot/data/telegram-mom`
    - Per-chat tool cwd: `/Users/zongxiaocheng/github/molipibot/data/telegram-mom/<chatId>/scratch`
    - Per-chat scratch as tool cwd is intentional and kept as-is for chat-level workspace isolation.
- Remaining parity gaps (next round):
  - Rich context compaction/retry controls equivalent to mom `AgentSession` settings.
  - Telegram history backfill equivalent to Slack channel backfill flow.
  - Add deeper observability and staged rollback toggles for safer production iteration.

## 25. Backend Full Merge into SvelteKit (2026-02-12)
- Code layout decision:
  - Backend source is fully hosted inside SvelteKit project at `src/lib/server/*`.
  - Legacy `web/` app directory is removed to avoid dual-tree drift.
- Integration decision:
  - SvelteKit server routes/hooks import backend modules via `$lib/server/*` only.
  - Root `svelte.config.js` no longer defines `$backend` alias to parent directory.
- Runtime workflow:
  - Root runtime/build commands are unified (`npm run dev`, `npm run build`, `npm run start`).
  - Root CLI command runs merged backend entry (`tsx src/lib/server/index.ts --cli`).
- Expected impact:
  - Eliminates split-brain project layout (root + `web/`).
  - Reduces cross-project path coupling and future refactor risk for server code.

## 26. Web Build Compatibility Update (2026-02-12)
- Problem:
  - Browser build pulled Node-only dependencies via client imports of `@mariozechner/pi-ai`/`@mariozechner/pi-agent-core`/`@mariozechner/pi-web-ui`, causing Vite/Rollup failure around `@smithy/node-http-handler`.
- Decision:
  - Web chat page is implemented as pure Svelte UI that calls backend APIs (`/api/chat`, `/api/sessions`, `/api/settings`) directly.
  - Keep provider/runtime complexity on server side (`src/lib/server/*`), not in browser bundle.
- Outcome:
  - `npm run build` succeeds in root SvelteKit layout.

## 27. Telegram Session Commands (2026-02-12)
- New command set:
  - `/new`: create and switch to a new Telegram chat session context.
  - `/clear`: clear current active session context only.
  - `/sessions`: list current sessions and active session; support switching via `/sessions <index|sessionId>`.
  - `/delete_sessions`: list deletable sessions and support deletion via `/delete_sessions <index|sessionId>`.
  - `/help`: show command catalog and session usage.
- Context storage model:
  - Per-chat multi-session contexts are stored under `data/telegram-mom/<chatId>/contexts/<sessionId>.json`.
  - Active session pointer is stored in `data/telegram-mom/<chatId>/active_session.txt`.
  - Legacy single-context file `data/telegram-mom/<chatId>/context.json` is auto-migrated to `contexts/default.json`.
- Runtime behavior:
  - Runner instances are keyed by `chatId + sessionId`.
  - Switching session changes which context file is loaded/saved for subsequent prompts.

## 28. Telegram Busy Handling Update (2026-02-12)
- Behavior change:
  - When a message arrives while Telegram runner is processing, it is queued instead of being rejected.
  - User receives queue feedback with pending count.
- Control:
  - `/stop` still aborts current running task.
  - Queued tasks continue to execute in per-chat FIFO order.

## 29. Telegram Text Attachment Format Rule (2026-02-12)
- Rule:
  - Text attachments sent to Telegram must use `.txt`, `.md`, or `.html` extension only.
  - Other text-like extensions are not allowed for outbound Telegram attachments.
- Enforcement:
  - Runtime upload path detects likely text files and auto-normalizes unsupported suffixes to `.txt` before sending.
  - Runner system prompt now explicitly instructs agent to use only `.txt/.md/.html` for text files.

## 30. Telegram Skills Inspection Command (2026-02-12)
- New command:
  - `/skills`: list currently loaded skills from workspace skill registry.
- Output content:
  - skill count
  - each skill's `name`, `description`, and `SKILL.md` file path
  - loader diagnostics (missing/duplicate/invalid metadata) when present
- Source of truth:
  - Reuses `loadSkillsFromWorkspace()` in `src/lib/server/mom/skills.ts`.

## 31. Delayed Reminder Execution Policy (2026-02-12)
- Policy:
  - Any delayed reminder request (for example "2 minutes later") must be implemented by creating a one-shot event file in watched events directories.
  - Runtime must not execute delayed reminders by waiting in-process.
- Enforcement:
  - Runner system prompt explicitly forbids wait/sleep style shell waiting for delayed tasks.
  - `bash` tool rejects wait commands (`sleep`, `timeout`, `wait`, ping-loop pattern) and returns guidance to create one-shot events.

## 32. Telegram Text-First Output Policy (2026-02-12)
- Policy:
  - Non-essential file sending should be avoided.
  - If generated output is text and fits Telegram message size constraints, bot should send it as normal text message.
- Enforcement:
  - Telegram upload path detects likely-text buffers and sends plain text first.
  - File upload (`sendDocument`) is reserved for non-text/binary content or oversized text payloads.

## 33. Runner Prompt Baseline Alignment (2026-02-12)
- Goal:
  - Align Telegram mom runner prompt to upstream baseline from `example/pi-mono/packages/mom/src/agent.ts` to reduce prompt drift.
- Scope:
  - Keep upstream structure and instructions as primary baseline.
  - Only adapt environment-specific details:
    - Slack semantics -> Telegram semantics.
    - channel path model -> chat/session path model.
    - watched event locations include workspace + chat-scratch directories.
    - one-shot/immediate lifecycle follows current runtime behavior (status retained, not auto-delete).
    - text-first Telegram output policy remains enforced.

## 34. Workspace Path Safety Guard (2026-02-12)
- Problem:
  - LLM tool calls could write absolute paths outside runtime workspace roots (example: `/tmp/events/...`), causing "scheduled" reminders that are never watched.
- Requirement:
  - Mom file tools must only operate inside allowed workspace roots.
- Enforcement:
  - `read/write/edit/attach` reject resolved paths outside chat scratch dir and workspace dir.
  - Prompt explicitly forbids writing reminder/event files to `/tmp` or other external directories.

## 35. Mom Tools Architecture Upgrade (2026-02-12)
- Goal:
  - Align local mom tool implementation style with upstream `example/pi-mono/packages/mom/src/tools` to improve maintainability and behavior consistency.
- Scope:
  - Replace monolithic tool file with modular structure:
    - `bash.ts`, `read.ts`, `write.ts`, `edit.ts`, `attach.ts`
    - shared `path.ts` and `truncate.ts`
  - Keep existing Telegram/runtime-specific constraints (workspace path guard, delayed-wait prohibition, text-first Telegram output policy).
- Behavior upgrades:
  - `read` supports image payload return and richer truncation/continuation hints.
  - `bash` provides structured tail truncation details and stores full output when truncated.

## 36. Reminder Event Normalization (2026-02-12)
- Problem:
  - Model may write reminder content as plain text (for example `2026-... 你好`) instead of valid event JSON, leading to non-triggering reminders.
- Requirement:
  - Reminder writes must end as valid one-shot JSON event files in watched events directories.
- Enforcement:
  - `write` tool detects reminder shorthand content and normalizes it into one-shot event JSON.
  - Normalized files are written under workspace events directory with `.json` extension.

## 37. Skills Install Path Canonicalization (2026-02-15)
- Problem:
  - When tools run in per-chat scratch (`data/telegram-mom/<chatId>/scratch`), writing skills with relative path `data/telegram-mom/skills/...` can create nested duplicate paths under scratch.
- Requirement:
  - Skills must be installed only in workspace-level directory `data/telegram-mom/skills`.
- Enforcement:
  - Runner system prompt explicitly requires absolute path usage for skills (`<workspace>/skills/<name>`).
  - Tool path resolver normalizes mistaken `data/telegram-mom/skills/...` relative inputs (from scratch) back to canonical workspace skills path.

## 38. Workspace Absolute Path Semantics (2026-02-15)
- Problem:
  - If runtime workspace root is stored as relative path (`data/telegram-mom`), assistant output may claim "absolute path" while still showing relative text.
- Requirement:
  - Runtime workspace root used by Telegram mom components must be absolute.
- Enforcement:
  - Telegram manager resolves workspace root via `resolve(config.dataDir, "telegram-mom")` before initializing store, prompt context, and skills listing.

## 39. Repository Ignore Hygiene (2026-02-16)
- Goal:
  - Keep repository commits clean and reproducible by excluding generated artifacts and local-only files.
- Scope:
  - Ignore dependency directories, build outputs, local env variants, runtime data outputs, logs, and editor/OS transient files.
- Acceptance:
  - Fresh local runs do not pollute git status with generated runtime/build files.

## 40. Home Workspace + Global Launch Command (2026-02-16)
- Problem:
  - Local startup is coupled to repository scripts (`npm run dev`) and runtime data defaults to repo-local `data/`, which is inconvenient for global usage.
- Requirement:
  - Support startup via global `molibot` command after `npm link`.
  - Default runtime data root must be `~/.molibot`.
  - Telegram workspace path must be `~/.molibot/moli-t` (future channels follow same pattern, e.g. Lark `~/.molibot/moli-l`).
- Enforcement:
  - Add npm `bin` entry for `molibot` command with subcommands `dev/start/build/cli`.
  - Change config defaults (`DATA_DIR`, settings/sessions files) to resolve under `~/.molibot` with `~` expansion.
  - Set Telegram manager workspace root to `<DATA_DIR>/moli-t` and align prompt/path docs accordingly.

## 41. Legacy Telegram Data Migration (2026-02-16)
- Goal:
  - Preserve existing Telegram runtime state while switching workspace from repo-local path to home workspace path.
- Scope:
  - Migrate old directory `/Users/zongxiaocheng/github/molipibot/data/telegram-mom/` to `~/.molibot/moli-t/`.
- Acceptance:
  - Migrated directory includes chats/events/skills and passes basic parity check (source vs target file count).

## 42. Legacy Settings Migration Completion (2026-02-16)
- Problem:
  - Previous migration covered only Telegram sub-workspace and missed root runtime settings file.
- Requirement:
  - Keep existing runtime settings when moving default data root to `~/.molibot`.
- Enforcement:
  - Copy legacy `/Users/zongxiaocheng/github/molipibot/data/settings.json` to `~/.molibot/settings.json` and verify content parity.

## 43. Telegram Native Formatting Compatibility (2026-02-16)
- Problem:
  - Assistant outputs may contain generic markdown that Telegram clients do not render correctly when sent as plain text.
- Requirement:
  - Outbound Telegram messages should use Telegram-supported rich-text format and remain readable even when formatting parse fails.
- Enforcement:
  - Convert common markdown patterns to Telegram HTML before sending/editing (`parse_mode=HTML`).
  - If Telegram rejects formatted payload, automatically resend/edit as plain text fallback.

## 44. Startup Readiness Without First Web Request (2026-02-16)
- Problem:
  - In dev mode, Telegram runtime initialization could be deferred until first HTTP page/API request, delaying bot availability.
- Requirement:
  - Service startup should make Telegram bot immediately usable without opening web pages.
- Enforcement:
  - Initialize runtime directly during Vite server bootstrap via SSR module loading (`ssrLoadModule`) instead of relying on a self-HTTP ping endpoint.

## 45. In-Chat Model Switch Command (2026-02-16)
- Problem:
  - Switching active model currently depends on web settings workflow, which is inefficient for Telegram-first operation.
- Requirement:
  - Telegram users can inspect configured models and switch active model directly in chat.
- Enforcement:
  - Add `/models` command to list all configured model choices and current active selection.
  - Add `/models <index|key>` to switch model via runtime settings update path (persisted settings + immediate effect).

## 46. Telegram Voice Message Recognition (2026-02-16)
- Problem:
  - Voice/audio messages are received as attachments but not converted into usable text for assistant reasoning.
- Requirement:
  - Telegram voice/audio messages should be transcribed into text and treated as normal user input when STT config is available.
- Enforcement:
  - Add `voice`/`audio` handling in Telegram inbound parser.
  - Integrate OpenAI-compatible transcription API (`/audio/transcriptions`) with configurable base URL/API key/model.
  - Keep graceful fallback when STT is not configured or transcription fails.

## 47. Multimodal Model Capability Registry (2026-02-16)
- Problem:
  - Existing provider config stores only plain model strings, lacking capability metadata needed for modality-specific routing.
- Requirement:
  - Model records must support capability tags (text, vision, stt, tts, tool) and allow multiple models per provider.
- Enforcement:
  - Upgrade custom provider model schema to object records (`id + tags`) with backward compatibility for legacy string arrays.

## 48. Capability-Based Model Routing Controls (2026-02-16)
- Problem:
  - Runtime cannot deterministically choose the right model for text, image understanding, speech-to-text, and text-to-speech tasks.
- Requirement:
  - Add explicit routing configuration for key use cases and expose controls in settings UI.
- Enforcement:
  - Add route keys: `textModelKey`, `visionModelKey`, `sttModelKey`, `ttsModelKey`.
  - AI settings page must provide dedicated selectors for these routes and persist them.
  - Runtime should consume route keys when choosing execution model (for example image requests use vision route).

## 49. Explicit Per-Model Test Selection (2026-02-16)
- Problem:
  - Provider-level test button can be ambiguous when a provider has multiple models.
- Requirement:
  - Operator must be able to choose the exact model being tested at click time.
- Enforcement:
  - Add per-model test actions in settings UI so each model row can be tested independently.

## 50. Supported Roles Must Be Model-Scoped (2026-02-19)
- Problem:
  - Provider-level `supportedRoles` cannot represent different role compatibility when one provider has multiple models.
- Requirement:
  - `supportedRoles` must be stored on each model record (`customProviders[].models[].supportedRoles`), and runtime role checks must read from the selected model.
- Enforcement:
  - Remove provider-level `supportedRoles` from canonical schema.
  - Keep backward-compatible migration for old settings by copying legacy provider roles into models when model roles are missing.
  - AI settings page displays and updates supported roles per model (from per-model test action).

## 51. STT Endpoint Path Must Respect Provider Config (2026-02-19)
- Problem:
  - Some OpenAI-compatible providers (for example Groq) require base URL plus explicit versioned path; hardcoded STT suffix can generate wrong URLs.
- Requirement:
  - Telegram voice transcription requests must use configured provider path when STT route points to a custom provider model.
- Enforcement:
  - Build STT request URL from `baseUrl + path` (fallback to `/v1/audio/transcriptions` only when path is absent).
  - On queue/event uncaught failures, log error stack for deterministic debugging.

## 52. Voice STT Failure Must Reply to User (2026-02-19)
- Problem:
  - When voice transcription fails, user may receive no actionable feedback and cannot quickly correct settings.
- Requirement:
  - Telegram bot must always send a clear failure message to user for voice/audio STT errors, including next-step hints.
- Enforcement:
  - On STT HTTP/transport/config failure, send immediate chat reply with failure reason and configuration guidance.
  - Keep a non-blocking fallback so message flow continues even when transcription is unavailable.

## 53. Runner Must Not Access Message Context in Constructor (2026-02-19)
- Problem:
  - Constructor-time access to per-message context (`ctx`) can crash runner creation and block all queued jobs.
- Requirement:
  - Runner constructor must remain context-free; message-specific logic only executes in `run(ctx)`.
- Enforcement:
  - Initialize constructor model with deterministic baseline (text route).
  - Keep vision/text switch in runtime path based on actual inbound message payload.

## 54. Missing Active Model API Key Must Not Crash Process (2026-02-19)
- Problem:
  - If routing points to a provider without available API key, current runtime can throw deep in provider SDK and terminate Node process.
- Requirement:
  - Before prompting, runner must validate API key availability for the actual selected model and return actionable user feedback.
- Enforcement:
  - Add active-model key preflight in `run(ctx)` and return readable settings error via Telegram message.
  - Resolve API keys by requested provider identity directly (custom provider id or provider env var), avoiding mismatch-based false negatives.

## 55. Prompt-Guided Continuation + Route Auto-Heal (2026-02-19)
- Problem:
  - If model/tool/media handling fails, assistant may stop at generic capability disclaimer instead of progressing task.
- Requirement:
  - System prompt must enforce a recovery workflow (diagnose, fallback, exact config hints, continue task).
  - Runtime should auto-select usable configured models when explicit route/default selection is missing or invalid.
- Enforcement:
  - Add mandatory failure-recovery protocol into Telegram runner system prompt.
  - For text/vision: auto-fallback to first usable custom provider model.
  - For STT: when `sttModelKey` is unavailable, auto-fallback to first custom model tagged `stt`.

## 56. Runtime-First Diagnostics for STT Claims (2026-02-19)
- Problem:
  - Assistant text may claim missing provider config even when runtime has valid STT routing, causing user confusion.
- Requirement:
  - STT execution path must be verifiable from runtime logs, and assistant responses should avoid fabricated config diagnosis.
- Enforcement:
  - Emit explicit STT target/success logs (URL/model/key-presence metadata-safe).
  - Prompt rules must require runtime-first diagnosis and prohibit asking for API keys/config files unless runtime emitted corresponding error.

## 57. Transcribed Voice Must Be Treated as Text Input (2026-02-19)
- Problem:
  - Even when STT succeeds, assistant may still respond with “cannot process audio” disclaimers.
- Requirement:
  - Successful voice transcription must be explicitly marked and handled as normal text reasoning input.
- Enforcement:
  - Prefix transcribed content with `[voice transcript]` marker in inbound message text.
  - Add prompt rule: when transcript marker exists, assistant must not claim inability to transcribe/play audio.

## 58. AI Settings Editor Must Have Deterministic Interaction (2026-02-19)
- Problem:
  - Nested state mutations in settings UI can fail to trigger stable reactive updates, making actions like `+ Add Model` appear unavailable or ineffective.
- Requirement:
  - Provider/model CRUD and per-model edits must always apply immediately in UI with deterministic reactivity.
- Enforcement:
  - Replace nested in-place mutation with immutable updates keyed by provider id.
  - Apply the same update path to add/delete model, tag toggles, and per-model test result writes.

## 59. Add-Model Must Show Editable Draft Row Immediately (2026-02-19)
- Problem:
  - UI normalization removed empty model ids too early, so clicking `+ Add Model` appeared to do nothing.
- Requirement:
  - Adding a model must immediately render an editable empty row for model name input.
- Enforcement:
  - Keep empty-id draft rows in UI state until user fills model id or deletes the row.
  - Default-model selection should derive from non-empty ids only.

## 60. Web Chat UI Modernization with Tailwind (2026-02-23)
- Problem:
  - Existing web chat page style is functional but visually outdated and CSS is page-scoped/custom, which slows future UI iteration consistency.
- Requirement:
  - Keep existing chat/session/model/settings/send behavior unchanged while upgrading to a modern UI style implemented with Tailwind CSS utilities only.
- Enforcement:
  - Wire Tailwind through Vite (`@tailwindcss/vite`) and global entry (`src/app.css` via `src/routes/+layout.svelte`).
  - Replace `src/routes/+page.svelte` custom CSS block with utility-class based layout/components.
  - Preserve all existing page logic and API interactions (`/api/chat`, `/api/sessions`, `/api/settings`) with no behavior change.

## 61. Unified ChatGPT-Style Shell Across Web Pages (2026-02-23)
- Problem:
  - Chat and settings pages used different layouts and interaction framing, resulting in inconsistent navigation and visual hierarchy.
- Requirement:
  - Use one consistent ChatGPT-style shell for chat and settings surfaces, with Tailwind-only styling and no behavior regression.
- Enforcement:
  - Adopt left navigation + right content workspace layout for `/`, `/settings`, `/settings/ai`, `/settings/telegram`.
  - Replace settings page legacy `<style>` blocks with Tailwind utility classes.
  - Keep all existing runtime actions unchanged (session switching/new chat, model selection, provider CRUD, provider test, telegram settings save).

## 62. Telegram Command-Level Route Model Switching (2026-02-23)
- Problem:
  - Telegram `/models` previously only switched text route, while runtime supports multiple route models (`text/vision/stt/tts`).
- Requirement:
  - Operators must be able to inspect and switch each route model directly in Telegram without opening Web settings.
- Enforcement:
  - Extend `/models` command syntax to support route target:
    - `/models <text|vision|stt|tts>` for listing route options
    - `/models <text|vision|stt|tts> <index|key>` for switching route model
  - Keep backward compatibility:
    - `/models` and `/models <index|key>` continue to target text route.

## 63. Server One-Command Background Start Script (2026-02-25)
- Problem:
  - Manual background startup command is easy to mistype and inconvenient to repeat on server operations.
- Requirement:
  - Provide a reusable script that starts `molibot` in background and writes runtime logs to a deterministic file path.
- Enforcement:
  - Add executable script `bin/start-molibot.sh`.
  - Script uses `nohup` and `disown`, with stdin detached and stdout/stderr redirected to one log file.
  - Default log path is `~/logs/molibot.log`, overridable via env `MOLIBOT_LOG_FILE`.
  - Script prints PID and active log path after startup for quick verification.

## 64. Server Process Lifecycle Scripts + Runtime Docs (2026-02-25)
- Problem:
  - Background startup alone is insufficient for daily operations; manual process checks/stops/restarts are error-prone.
- Requirement:
  - Provide complete lifecycle scripts (`stop/status/restart`) and document practical usage commands in project docs.
- Enforcement:
  - Add executable scripts:
    - `bin/stop-molibot.sh`: graceful stop by PID with stale-pid cleanup.
    - `bin/status-molibot.sh`: running/stopped check via PID file.
    - `bin/restart-molibot.sh`: stop then start.
  - Upgrade `bin/start-molibot.sh` with PID file write and duplicate-run guard.
  - Standardize PID path default as `~/.molibot/molibot.pid` (overridable by `MOLIBOT_PID_FILE`).
  - Add operation guide to `readme.md` (start/stop/status/restart, tail log, env override).

## 65. Unified Service Script UX (2026-02-25)
- Problem:
  - Multiple separate scripts increase cognitive overhead and make command recall inconsistent.
- Requirement:
  - Provide one command entry with subcommands for all service lifecycle actions.
- Enforcement:
  - Add `bin/molibot-service.sh` with subcommands:
    - `start`
    - `stop`
    - `status`
    - `restart`
  - Keep existing per-action scripts as wrappers to preserve backward compatibility.
  - Update `readme.md` to recommend unified entry as the default operations path.

## 66. Telegram Multi-Bot Configuration (2026-02-25)
- Problem:
  - `/settings/telegram` currently supports only one bot token, but operations may require multiple Telegram bots running in parallel.
- Requirement:
  - Support configuring and running multiple Telegram bots from one Molibot runtime process.
  - Keep backward compatibility with legacy single-bot settings (`telegramBotToken`, `telegramAllowedChatIds`).
- Enforcement:
  - Add runtime settings schema `telegramBots[]` where each item contains:
    - `id`
    - `name`
    - `token`
    - `allowedChatIds[]`
  - Update `/settings/telegram` UI to manage bot list (add/remove/edit).
  - Runtime should apply all configured bots concurrently:
    - One `TelegramManager` instance per bot.
    - Isolated bot workspace path: `<DATA_DIR>/moli-t/bots/<botId>`.
  - Keep legacy fields readable/writable via migration fallback to first bot for old data compatibility.

## 67. Event Delivery Mode: Text vs Agent Execution (2026-02-25)
- Problem:
  - One-shot/immediate events are currently delivered as literal text by default, so task-like events (e.g. weather query instructions) cannot trigger agent execution.
- Requirement:
  - Event system must distinguish between:
    - literal text delivery
    - task execution via AI agent before replying
- Enforcement:
  - Add optional event field `delivery`:
    - `text`: send `text` directly to Telegram.
    - `agent`: treat `text` as task instruction and run AI agent first.
  - For `one-shot` / `immediate`, default `delivery` to `agent` when omitted.
  - Event watcher should normalize missing `delivery` to `agent` and persist it back into the event file.
  - `write` tool must reject one-shot events whose `at` is not in the future, so invalid schedule time is corrected before file commit.
  - Keep periodic events on agent execution path.
  - Update runner prompt examples and event-writing guidance to include `delivery` explicitly.
