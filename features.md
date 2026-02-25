# Molibot Features

## Implemented Features
| ID | Feature | Status | Notes |
|---|---|---|---|
| DOC-01 | V1 PRD baseline | Done | Must/Later scope and acceptance criteria defined |
| DOC-02 | V1 architecture baseline | Done | Architecture aligned to Telegram + CLI + Web only |
| DOC-03 | Two-week sprint plan | Done | Week-by-week deliverables and checkpoints defined |
| DOC-04 | Telegram tech decision (`grammY`) | Done | V1 Telegram adapter library fixed as `grammY` |
| DOC-05 | Persistence tech decision (`SQLite`) | Done | V1 session/message persistence changed to SQLite |
| DOC-06 | Documentation cleanup | Done | Removed redundant docs and added file-purpose navigation in `readme.md` |
| ENG-01 | Unified message router implementation | Done | `src/core/messageRouter.ts` with validation, rate limit, and shared pipeline |
| ENG-02 | Telegram adapter implementation | Done | `src/adapters/telegram.ts` built with `grammY` |
| ENG-03 | Web chat implementation | Done | SvelteKit chat page + API (`src/routes/+page.svelte`, `src/routes/api/chat/+server.ts`) with `pi-web-ui` |
| ENG-04 | CLI adapter implementation | Done | `src/adapters/cli.ts` interactive loop |
| ENG-05 | SQLite session/message persistence | Done | `src/db/sqlite.ts` + `src/services/sessionStore.ts` |
| ENG-06 | pi-mono runtime integration | Done | `src/services/assistant.ts` now calls `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` directly |
| ENG-07 | SQLite driver compatibility fix | Done | Replaced `better-sqlite3` with built-in `node:sqlite` for Node 25 compatibility |
| ENG-08 | Web chat model selector scope control | Done | Chat page disables model selector dropdown and avoids showing unconfigured model catalog |
| ENG-09 | Web chat uses backend runtime model settings | Done | Web `pi-web-ui` stream now proxies to `/api/chat`, so custom provider/model from Settings is applied |
| ENG-10 | Web chat send reliability and controls restore | Done | Restored model/thinking selectors and changed stream error handling to render visible error message instead of silent failure |
| ENG-11 | Web chat custom-provider store initialization fix | Done | Initialized `CustomProvidersStore` in AppStorage to fix model selector `getAll` runtime error |
| ENG-12 | Web chat editor-null send fallback | Done | Added send fallback when `message-editor` reference is missing to prevent crash on send |
| ENG-13 | AI settings multi-provider architecture | Done | Runtime settings now support multiple custom providers and default custom provider selection |
| ENG-14 | Settings information architecture split | Done | Settings split into hub (`/settings`), AI page (`/settings/ai`), Telegram page (`/settings/telegram`) |
| ENG-15 | PI provider selectable dropdown | Done | Added server-provided PI provider/model metadata and dropdown selector for PI provider/models |
| ENG-16 | Web IndexedDB store migration fix | Done | Bumped Web UI IndexedDB version to create `custom-providers` store and fix store-not-found runtime error |
| ENG-17 | Web IndexedDB forced clean schema rollout | Done | Switched Web UI local DB name to `molibot-web-ui-v2` to avoid stale schema from old browser cache/state |
| ENG-18 | Backend settings JSON persistence | Done | Runtime settings are now stored in `data/settings.json` (single file) instead of SQLite |
| ENG-19 | Backend session-per-file persistence | Done | Each chat session is now stored as one JSON file under `data/sessions/<conversationId>.json` with index mapping |
| ENG-20 | Web storage backend without IndexedDB | Done | Replaced browser IndexedDB backend with in-memory storage backend to avoid browser DB persistence |
| ENG-21 | Web session list from backend JSON | Done | Added backend session APIs and chat-page session selector/new-session actions backed by JSON files |
| ENG-22 | Session title from first user message | Done | Session title now persists in backend JSON and auto-updates from first user message summary |
| ENG-23 | Chat model dropdown from backend config | Done | Disabled built-in model catalog selector and added model switcher sourced only from backend settings |
| ENG-24 | Chat response streaming UX improvement | Done | Assistant stream now enters immediate streaming state and outputs at a visible incremental cadence |
| ENG-25 | Chat real-time render fallback hook | Done | Added page-level agent event subscription to force UI updates for user/assistant messages and streaming container |
| ENG-26 | Telegram mom-t core modules | Done | Added `src/mom/*` core modules (runner/store/tools/events) for Telegram mom implementation |
| ENG-27 | Telegram mom-t scheduler | Done | Added file-based events watcher (`immediate`/`one-shot`/`periodic`) under `data/telegram-mom/events` |
| ENG-28 | Telegram mom-t attachment pipeline | Done | Added Telegram attachment download + image-context injection into agent prompt |
| ENG-29 | Telegram default path switched to mom-t | Done | `src/adapters/telegram.ts` now uses mom runner/queue/stop/events by default, still driven by Web settings token/chat id |
| ENG-30 | Telegram mom-t observability logs | Done | Added structured run-level server logs for inbound message, queue lifecycle, runner/tool stages, context updates, and error paths |
| ENG-31 | Telegram chat-id visibility | Done | Added `/chatid` command and startup whitelist logs so operators can verify which chat ids are allowed/listened |
| ENG-32 | Dev runtime auto-bootstrap | Done | Added Vite dev bootstrap ping to `/api/settings` so runtime/telegram status logs appear immediately after dev server starts |
| ENG-33 | Telegram runner config preflight & no-panic error path | Done | Runner now validates provider/key config, returns readable Telegram errors instead of crashing process, and supports custom provider mode model selection |
| ENG-34 | Telegram sessions mirror + empty-response guard | Done | mom-t now mirrors telegram turns into `data/sessions` and returns explicit user-facing message when provider returns empty assistant content |
| ENG-35 | AI call trace logs | Done | Added runner-level AI invocation trace logs: model/api/baseUrl/path/key presence, api-key resolve, stream start, and assistant usage/content stats |
| ENG-36 | Custom provider path/baseUrl mapping fix | Done | Custom provider now maps `baseUrl + path` to OpenAI SDK `baseURL` prefix correctly (e.g. OpenRouter `/api/v1`) |
| ENG-37 | Telegram output cleanup | Done | Ignored non-modified status edit errors (no duplicate fallback sends), disabled normal tool thread spam (error-only), and stripped ANSI escapes from bash output |
| ENG-38 | Mom-t key-log mode | Done | Reduced default `[mom-t]` logs to key execution events via whitelist; full verbose logs can be re-enabled with `MOM_LOG_VERBOSE=1` |
| ENG-39 | Telegram dual events watcher | Done | Added watcher support for both workspace events and chat scratch events (`<chatId>/scratch/data/telegram-mom/events`) |
| ENG-40 | Mom-style system prompt optimization | Done | Upgraded Telegram runner system prompt with mom-style structure: environment, formatting, event scheduling constraints, and watched event paths |
| ENG-41 | Event reminder direct-delivery fix | Done | One-shot/immediate events now send event `text` directly to Telegram instead of relying on LLM-generated phrasing |
| ENG-42 | Event file status persistence | Done | Event files are no longer deleted after execution; watcher now writes `status` (completed/skipped/error, timestamps, run count) |
| ENG-43 | Scratch path duplication guard | Done | Tool path resolver now normalizes accidental `data/telegram-mom/<chatId>/scratch/...` prefixes to prevent nested duplicate directories |
| ENG-44 | Telegram scratch nested-path data migration | Done | Safely migrated existing files from duplicated nested scratch path back to canonical chat scratch root |
| ENG-45 | Custom provider multi-model schema | Done | Upgraded custom provider config to `models[] + defaultModel + supportedRoles[]` with legacy `model` backward compatibility |
| ENG-46 | Provider capability test API | Done | Added `/api/settings/provider-test` to verify connectivity and detect `developer` role support per model |
| ENG-47 | Developer-role compatibility fallback | Done | Telegram mom stream now maps `developer -> system` when selected custom provider does not support `developer` role |
| ENG-48 | AI settings split-pane provider UI | Done | Rebuilt `/settings/ai` into left searchable provider list + right detail panel with model management, role display, and inline provider testing |
| ENG-49 | SystemPrompt role-compat fallback | Done | When custom provider lacks `developer` support, runner now also flattens `systemPrompt` into explicit `system` message to avoid adapter-level developer-role injection |
| ENG-50 | Telegram global skills support + prompt upgrade | Done | Runner now discovers skills from `data/telegram-mom/skills/**/SKILL.md`, injects them into system prompt, and upgrades prompt with skill protocol/system-log guidance |
| ENG-51 | Workspace find-skills skill installed | Done | Installed `find-skills` into `data/telegram-mom/skills/find-skills/SKILL.md` so mom runtime can discover it |
| ENG-52 | Runtime skills path alignment | Done | Active runtime skill path is `data/telegram-mom/skills/find-skills/SKILL.md` under root-start mode |
| ENG-53 | Runtime path knowledge documented | Done | Current runtime paths: workspace `data/telegram-mom`, per-chat tool cwd `data/telegram-mom/<chatId>/scratch` |
| ENG-54 | Backend source fully merged into SvelteKit | Done | Backend source is fully hosted at `src/lib/server/*` and imported via `$lib/server/*` in SvelteKit server routes/hooks |
| ENG-55 | Svelte app flattened to repository root | Done | Removed standalone `web/` app layout; SvelteKit app now runs from root with one `package.json` and one command set (`dev/build/start/cli`) |
| ENG-56 | Web build Node-only dependency isolation | Done | Replaced chat page runtime dependencies (`pi-web-ui`/`pi-ai` client imports) with pure Svelte + backend API integration to avoid browser bundle pulling Node-only packages and to restore successful `npm run build` |
| ENG-57 | Telegram multi-session commands | Done | Added `/new`, `/clear`, `/sessions`, `/delete_sessions`, `/help`; Telegram runner/context now supports per-chat multiple contexts with active session switching |
| ENG-58 | Telegram busy-message queue support | Done | While a run is in progress, new inbound messages are now queued (with pending count feedback) instead of rejected; `/stop` still aborts current task |
| ENG-59 | Telegram text attachment extension guard | Done | Enforced Telegram text-file upload extensions to `.txt/.md/.html` (auto-normalize text attachments with unsupported suffix to `.txt`) and updated runner prompt rules accordingly |
| ENG-60 | Telegram skills listing command | Done | Added `/skills` command to list currently loaded workspace skills (name/description/path) and loader diagnostics from `src/lib/server/mom/skills.ts` |
| ENG-61 | Delayed-reminder event enforcement | Done | For Telegram mom runtime, delayed tasks now explicitly require event-file scheduling; `bash` tool blocks wait/sleep-style commands and instructs creating one-shot events instead |
| ENG-62 | Telegram text-first delivery policy | Done | `uploadFile` now sends likely-text content as normal Telegram message when within limit; falls back to document only for oversized text or non-text/binary files |
| ENG-63 | Runner prompt aligned to upstream mom agent baseline | Done | Rebased Telegram runner system prompt on `example/pi-mono/packages/mom/src/agent.ts` structure and adapted only environment-specific parts (Telegram, workspace/session paths, event lifecycle, text-first output rules) |
| ENG-64 | Tool path sandbox for workspace roots | Done | `read/write/edit/attach` now reject file paths outside allowed roots (`scratch` + workspace), preventing incorrect writes to `/tmp` and other external directories |
| ENG-65 | Mom tools modularized with upstream-aligned capabilities | Done | Refactored tools into per-tool modules (`bash/read/write/edit/attach`) plus shared `path` and `truncate` utilities; added richer read/image handling and bash truncation diagnostics aligned with mom example design |
| ENG-66 | Reminder shorthand auto-normalization | Done | `write` now detects reminder shorthand (`<ISO_TIME> <text>`) and normalizes it into one-shot event JSON under workspace watched events directory, preventing non-JSON reminder files |
| ENG-67 | Skills canonical install path guard | Done | Runner prompt now enforces absolute workspace skills path and tool path resolver normalizes mistaken `data/telegram-mom/skills` relative paths from scratch into canonical `data/telegram-mom/skills` |
| ENG-68 | Telegram workspace absolute-path normalization | Done | Telegram runtime now resolves workspace dir with `path.resolve`, so prompt/skills listing report true absolute paths (not `data/telegram-mom` relative form) |
| ENG-69 | Repository `.gitignore` baseline refresh | Done | Added complete ignore rules for Node/SvelteKit build artifacts, local env files, runtime data outputs, logs, and editor/OS noise |
| ENG-70 | Global `molibot` launcher + home workspace migration | Done | Added npm-linkable `molibot` command, moved default runtime data root to `~/.molibot`, and switched Telegram workspace to `~/.molibot/moli-t` |
| ENG-71 | Legacy Telegram workspace data migration | Done | Copied legacy runtime data from repo-local `data/telegram-mom` into new home workspace `~/.molibot/moli-t` with file-count parity verification |
| ENG-72 | Legacy settings file migration | Done | Copied `data/settings.json` to `~/.molibot/settings.json` so runtime settings continue from previous repo-local storage |
| ENG-73 | Telegram markdown-to-native formatting delivery | Done | Added outbound text formatting adapter that converts common markdown to Telegram HTML (`parse_mode=HTML`) with automatic fallback to plain text on parse errors |
| ENG-74 | Dev startup eager runtime bootstrap | Done | Replaced dev HTTP ping bootstrap with direct runtime module initialization via Vite `ssrLoadModule`, so Telegram bot starts without opening any web page |
| ENG-75 | Telegram `/models` command for in-chat model switching | Done | Added `/models` command to list configured model options and switch active model by index/key, with runtime settings persistence via `updateSettings` |
| ENG-76 | Telegram voice message transcription support | Done | Added `voice/audio` ingestion and optional OpenAI-compatible transcription (`/audio/transcriptions`) so voice messages can be converted to text for chat processing |
| ENG-77 | AI provider multimodal model registry + routing | Done | Upgraded provider model schema to per-model objects with capability tags and added routing config for text/vision/stt/tts model selection |
| ENG-78 | AI settings page capability-tag and routing UI | Done | Rebuilt `/settings/ai` to support provider CRUD, multi-model management with tags (text/vision/stt/tts/tool), and dedicated routing selectors for text/image/stt/tts |
| ENG-79 | Per-model provider capability test action | Done | AI settings now tests the exact clicked model (per-row Test button) instead of implicitly using provider default model |
| ENG-80 | Per-model supported-roles schema migration | Done | Moved `supportedRoles` from provider level to model level, added backward-compatible migration, and updated runtime role fallback to read selected model roles |
| ENG-81 | STT custom path routing fix + queue error stack logs | Done | Telegram STT now uses configured provider `path` (e.g. `/v1/audio/transcriptions`) when building transcription URL, and queue uncaught errors now log stack traces for faster root-cause analysis |
| ENG-82 | Voice-transcription failure user feedback | Done | When Telegram voice/audio transcription fails, bot now sends immediate actionable feedback to user (not silent failure), including config hints |
| ENG-83 | Runner constructor `ctx` reference crash fix | Done | Removed invalid `ctx` usage from `TelegramMomRunner` constructor; constructor now initializes with text-model baseline and per-message vision routing remains in `run()` |
| ENG-84 | Active-model API key preflight + robust key resolver | Done | Runner now validates API key for the actual selected model before prompt, returns user-visible settings error instead of process crash, and resolves API keys by requested provider directly |
| ENG-85 | Prompt-driven failure recovery + model route auto-heal | Done | Added mandatory failure-recovery protocol in runner system prompt, enabled automatic custom model fallback when route/default is invalid, and added STT tagged-model auto fallback when stt route is missing |
| ENG-86 | STT observability + anti-hallucination prompt guard | Done | Added STT target/success logs for deterministic verification and strengthened prompt to forbid fabricated “missing config file/API key” claims unless runtime explicitly reports them |
| ENG-87 | Voice-transcript marker + hard anti-disclaimer rule | Done | Voice transcripts are now explicitly prefixed with `[voice transcript]`, and prompt now forbids claiming “cannot transcribe/play audio” when transcript section is present |
| ENG-88 | AI settings model editor reactivity fix | Done | Reworked provider/model mutations to immutable-by-id updates so `+ Add Model` / delete / tag toggle / per-model test updates always trigger UI state refresh reliably |
| ENG-89 | AI settings empty-model draft row support | Done | `+ Add Model` now keeps unsaved empty model rows visible (input appears immediately) instead of being filtered out during defaults normalization |
| ENG-90 | Web app ChatGPT-style Tailwind layout refactor | Done | Rebuilt chat + settings pages (`/`, `/settings`, `/settings/ai`, `/settings/telegram`) into unified ChatGPT-style shell with Tailwind-only styling while preserving all existing behavior |
| ENG-91 | Telegram route-scoped model switching command | Done | Upgraded `/models` to support route-specific model listing/switching for `text/vision/stt/tts` in Telegram chat |
| ENG-92 | Server background startup script with fixed log output | Done | Added `bin/start-molibot.sh` to run `molibot` with `nohup` in background and persist logs to configurable file path |
| ENG-93 | Server lifecycle scripts + ops docs | Done | Added `bin/stop-molibot.sh`, `bin/status-molibot.sh`, `bin/restart-molibot.sh`; upgraded start script with PID file management; documented all commands in `readme.md` |
| ENG-94 | Unified service-control script with subcommands | Done | Added `bin/molibot-service.sh` (`start/stop/status/restart`) as single operational entrypoint; legacy scripts now forward to the unified script |
| ENG-95 | Telegram multi-bot runtime + settings UI | Done | Added `telegramBots[]` settings schema and `/settings/telegram` multi-bot editor; runtime now starts one Telegram manager per bot with isolated workspace path and legacy single-bot migration fallback |

## In Progress
| ID | Feature | Status | Notes |
|---|---|---|---|
| N/A | N/A | N/A | No active in-progress item in docs; next is tests + deployment packaging |

## Backlog
| ID | Feature | Status | Notes |
|---|---|---|---|
| BL-01 | WhatsApp adapter | Backlog | Post V1 |
| BL-02 | Lark adapter | Backlog | Post V1 |
| BL-03 | Slack adapter | Backlog | Post V1 |
| BL-04 | Vector memory | Backlog | Post V1 |

## Update Log
- 2026-02-25: Added Telegram multi-bot support end-to-end: settings schema now supports `telegramBots[]`, Telegram settings page supports add/remove/edit multiple bots, runtime applies all bots concurrently, and each bot uses isolated workspace state under `~/.molibot/moli-t/bots/<botId>`.
- 2026-02-25: Consolidated server process management into single script `bin/molibot-service.sh` with subcommands (`start/stop/status/restart`) and kept legacy per-action scripts as compatibility wrappers.
- 2026-02-25: Added server lifecycle scripts (`start/stop/status/restart`) for Molibot background process management, introduced PID file control (`~/.molibot/molibot.pid`), and documented all operations in `readme.md`.
- 2026-02-25: Added `bin/start-molibot.sh` for one-command background startup (`nohup + disown`) with default log file `~/logs/molibot.log` and optional `MOLIBOT_LOG_FILE` override.
- 2026-02-23: Migrated web chat page UI to Tailwind CSS with modern visual refresh (toolbar, message list, composer), removed local `<style>` from `src/routes/+page.svelte`, and added Tailwind runtime wiring (`@tailwindcss/vite`, `src/app.css`, `src/routes/+layout.svelte`).
- 2026-02-23: Upgraded web app layout to ChatGPT-style structure across chat and settings pages (left navigation shell + main workspace), removed legacy page-scoped CSS from settings pages, and kept existing settings/chat logic unchanged.
- 2026-02-23: Added Telegram route-scoped model switch support in `/models` command: `text/vision/stt/tts` can be listed and switched independently by index or key.
- 2026-02-11: Created `features.md` with V1 baseline status tracking.
- 2026-02-11: Added implemented/planned/backlog sections aligned with `prd.md`.
- 2026-02-11: Recorded documentation milestones for Must/Later scope and sprint plan.
- 2026-02-11: Confirmed Telegram adapter implementation will use `grammY` and synced `prd.md` + `architecture.md`.
- 2026-02-11: Changed V1 persistence from PostgreSQL to SQLite and synced `prd.md` + `architecture.md` + `notes.md`.
- 2026-02-11: Removed `task_plan.md`, `notes.md`, `feasibility-report-v2.md`; updated `readme.md` with remaining file purposes; synced `prd.md`.
- 2026-02-11: Implemented V1 code skeleton for Telegram (`grammY`), CLI, Web, unified router, and SQLite persistence.
- 2026-02-11: Added startup/config files (`package.json`, `tsconfig.json`, `.env.example`, `.gitignore`) and updated `readme.md` quickstart.
- 2026-02-11: Added `.npmrc` to use npmjs registry; local dependency installation remains blocked due to network DNS (`ENOTFOUND`).
- 2026-02-11: Removed `better-sqlite3` due to Node 25 native build failure; migrated to built-in `node:sqlite` and updated setup docs.
- 2026-02-11: Removed all mock assistant logic and switched to real pi-mono runtime calls in `AssistantService`.
- 2026-02-11: Added configurable model selection (`AI_PROVIDER_MODE`) with custom provider support (`CUSTOM_AI_BASE_URL`, `CUSTOM_AI_API_KEY`, `CUSTOM_AI_MODEL`).
- 2026-02-11: Added Telegram chat whitelist config via `TELEGRAM_ALLOWED_CHAT_IDS` and documented exact `.env` locations in `readme.md`.
- 2026-02-11: Replaced custom Web chat UI with official `@mariozechner/pi-web-ui`-based page (`public/index.html`).
- 2026-02-11: Documented separate config behavior: Web UI provider key is browser-side, Telegram/CLI provider config remains server-side `.env`.
- 2026-02-11: Updated `public/index.html` bootstrap flow with explicit error surface; black screen now shows concrete init failure reason and checks.
- 2026-02-11: Reworked Web UI integration to local Vite app (`web/`) based on pi-web-ui example; removed CDN dynamic import path that caused MIME/module load failures.
- 2026-02-11: Backend web adapter now serves `web/dist` when available and returns clear setup instructions when frontend is not built.
- 2026-02-11: Fixed TypeScript build errors in `assistant.ts` (`KnownProvider`) and `sessionStore.ts` (safe SQLite row mapping).
- 2026-02-11: Updated `npm run dev` to start backend + web concurrently (`concurrently`).
- 2026-02-11: Changed `npm run dev` to shell-based parallel startup (`dev:backend` + `web:dev`) without extra process manager dependency.
- 2026-02-11: Switched `npm run dev` back to managed parallel startup via `concurrently` to avoid orphaned dev processes.
- 2026-02-11: Improved backend startup diagnostics for `EADDRINUSE` with actionable message.
- 2026-02-11: Migrated Web frontend to SvelteKit (`web/`), replaced old Vite hand-rolled entry files.
- 2026-02-11: Integrated `pi-web-ui` mount in SvelteKit client page (`web/src/routes/+page.svelte`) with SSR disabled.
- 2026-02-11: Updated root scripts to run SvelteKit via `npm --prefix web ...` and preserved backend static hosting from `web/dist`.
- 2026-02-11: Added standalone `web/package.json`; SvelteKit web build now requires running `npm --prefix web install` before `web:dev/web:build`.
- 2026-02-11: Attempted `npm --prefix web install`; blocked by DNS/network (`ENOTFOUND registry.npmjs.org`) in current environment.
- 2026-02-11: Unified dev runtime to single-process SvelteKit (`npm run dev` now launches only web/SvelteKit process).
- 2026-02-11: Moved backend API into SvelteKit server routes (`web/src/routes/api/*`) and health route (`web/src/routes/health/+server.ts`).
- 2026-02-11: Added shared runtime bootstrap (`src/runtime.ts`) and SvelteKit server hook (`web/src/hooks.server.ts`) to start Telegram in same process.
- 2026-02-11: Switched SvelteKit adapter to `@sveltejs/adapter-node` for server API support in production.
- 2026-02-11: Fixed `pi-web-ui` mount path to static ESM imports in SvelteKit page (`+page.svelte`) so Vite can prebundle dependencies correctly.
- 2026-02-11: Added `optimizeDeps.include` for `pi-web-ui`/`pi-ai`/`pi-agent-core`/`lit` in `web/vite.config.ts` to stabilize dev dependency optimization.
- 2026-02-11: Added Lit shadow-field cleanup workaround before `ChatPanel.setAgent()` to avoid runtime `class-field-shadowing` crash with current `pi-web-ui` build.
- 2026-02-11: Updated SvelteKit web scripts to run `svelte-kit sync` before dev/build, removing `.svelte-kit/tsconfig.json` warning.
- 2026-02-11: Expanded Lit warning workaround to disable `class-field-shadowing` on all relevant `pi-web-ui` custom element constructors (not only `ChatPanel`).
- 2026-02-11: Forced SvelteKit dev server to production mode (`vite dev --mode production`) and set resolver conditions to avoid Lit development export path that throws `class-field-shadowing` errors.
- 2026-02-11: Added runtime settings store (`app_settings` table + `SettingsStore`) and runtime update flow (`src/runtime.ts`).
- 2026-02-11: Added settings API (`web/src/routes/api/settings/+server.ts`) for reading/updating AI and Telegram configuration.
- 2026-02-11: Added Web settings page (`web/src/routes/settings/+page.svelte`) and chat-page settings entry link.
- 2026-02-11: Refactored Telegram integration to managed runtime service (`TelegramManager`) supporting config reload.
- 2026-02-11: Refactored `AssistantService` to use runtime settings instead of static env snapshot.
- 2026-02-11: Updated chat page to hide model selector in `pi-web-ui`, so chat no longer displays large built-in model list unrelated to current configuration.
- 2026-02-11: Updated Web chat runtime to use backend `/api/chat` stream function, so Web replies follow runtime settings (`providerMode`, custom host/key/model) instead of browser-side provider keys.
- 2026-02-11: Restored Web chat model/thinking selectors and hardened send flow to show explicit assistant-side error text when backend call fails.
- 2026-02-11: Fixed Web model selector crash by wiring `CustomProvidersStore` into IndexedDB/AppStorage (`customProviders.getAll` no longer undefined).
- 2026-02-11: Added defensive send fallback for missing `message-editor` ref to avoid `Cannot set properties of undefined (setting 'value')`.
- 2026-02-11: Refactored runtime settings schema from single custom provider fields to `customProviders[] + defaultCustomProviderId` with legacy migration support.
- 2026-02-11: Added AI metadata API (`/api/settings/ai-meta`) and upgraded AI settings UI to dropdown PI provider/model selection.
- 2026-02-11: Reorganized settings UX into entry page and dedicated AI/Telegram subpages to avoid crowded single-page form.
- 2026-02-11: Bumped Web UI IndexedDB schema version from `1` to `2` to migrate existing local DB and create missing `custom-providers` object store.
- 2026-02-11: Changed Web UI IndexedDB database name to `molibot-web-ui-v2` for deterministic fresh schema creation on clients with stale local DB state.
- 2026-02-11: Replaced SQLite persistence with backend JSON-file persistence (`data/settings.json` + `data/sessions/index.json` + per-session JSON files).
- 2026-02-11: Replaced Web `IndexedDBStorageBackend` with in-memory backend (`web/src/lib/memoryStorageBackend.ts`) so browser no longer uses IndexedDB.
- 2026-02-11: Added backend session APIs (`/api/sessions`, `/api/sessions/:id`) and wired Web chat session list/switch/create to backend JSON sessions.
- 2026-02-11: Upgraded session title strategy from timestamp labels to first-user-message summary and persisted title in conversation JSON.
- 2026-02-11: Switched chat model selector source from `pi-web-ui` built-in model catalog to backend settings data; model switching now updates `/api/settings` and takes effect immediately.
- 2026-02-11: Improved chat UI responsiveness by emitting assistant `start/text_start` immediately and slowing text delta cadence for visible progressive rendering.
- 2026-02-11: Added page-level realtime render fallback by subscribing to agent events and explicitly requesting `agent-interface` updates.
- 2026-02-11: Reworked `src/adapters/telegram.ts` into a mom-style runtime with per-chat queue, cancellable runs, progressive status updates, and tool-result thread replies.
- 2026-02-11: Added Telegram mom core modules under `src/mom/` (`types`, `store`, `runner`, `events`, `tools`) and wired them into runtime settings.
- 2026-02-11: Added filesystem event scheduling for Telegram mom workspace (`data/telegram-mom/events/*.json`) with support for immediate, one-shot, and periodic events.
- 2026-02-11: Added Telegram attachment ingestion/download and image injection into agent prompt context.
- 2026-02-11: Rolled back Telegram adapter runtime entry to stable router path after regression; mom-t modules remain in repository as prototype and are not default-enabled.
- 2026-02-11: Re-enabled Telegram default runtime as mom-t with `grammy`, per-chat queue/stop, event watcher, attachment ingestion, and Web settings-driven token/chat-id allowlist.
- 2026-02-11: Fixed mom-t `read` tool range command generation (`sed` line range expansion bug), improving tool-call reliability.
- 2026-02-11: Added structured `[mom-t]` logs (`src/mom/log.ts`) and wired logging through `src/adapters/telegram.ts` + `src/mom/runner.ts` for end-to-end request tracing (received/enqueued/started/tools/responded/completed/errors).
- 2026-02-11: Added Telegram `/chatid` command and startup `allowed_chat_ids_loaded` log to make whitelist/debug of polling chat ids explicit.
- 2026-02-11: Added Vite dev bootstrap plugin to ping `/api/settings` at server startup so runtime initialization and Telegram status logs are visible without manual first request.
- 2026-02-11: Added runner provider preflight validation and graceful error-return path for missing API keys/config so Telegram requests fail with explicit messages instead of process panic.
- 2026-02-11: Added Telegram -> session store mirror writes (user/assistant) so `data/sessions` continues updating under mom-t path.
- 2026-02-11: Added empty assistant output guard: when provider returns empty content, bot now sends clear diagnostic response instead of silent completion.
- 2026-02-11: Added detailed AI call trace logs in runner (`model_selected`, `api_key_resolve`, `llm_stream_start`, `assistant_message_end`) to verify whether/how each Telegram message reaches provider APIs.
- 2026-02-11: Fixed custom provider URL assembly for OpenAI-compatible chat completions so configured path (e.g. `/v1/chat/completions`) is reflected in effective `baseURL` used by SDK calls.
- 2026-02-11: Cleaned Telegram message noise: no duplicate message sends on `message is not modified`, tool details only posted on failures, and ANSI color codes stripped from bash tool outputs.
- 2026-02-11: Added default key-log filtering for `[mom-t]` logs; non-critical debug events are suppressed unless `MOM_LOG_VERBOSE=1`.
- 2026-02-11: Extended Telegram events watcher to include per-chat scratch event directory (`data/telegram-mom/<chatId>/scratch/data/telegram-mom/events`) in addition to workspace events.
- 2026-02-11: Optimized Telegram system prompt by referencing mom agent prompt structure (context, formatting, runtime behavior, event guarantees, and scheduling guidance).
- 2026-02-11: Fixed one-shot/immediate event delivery to send exact event text directly, retained event files with execution status updates instead of deletion, and added scratch-path normalization to prevent duplicated nested `.../scratch/data/telegram-mom/<chatId>/scratch` directories.
- 2026-02-11: Performed safe one-time data migration for chat `7706709760`, moving files from duplicated nested path `scratch/data/telegram-mom/7706709760/scratch/` back to canonical `scratch/` and cleaning obsolete empty directories.
- 2026-02-11: Upgraded AI settings custom provider model from single `model` to multi-model (`models/defaultModel`), added provider test endpoint for connectivity + developer-role detection, and added Telegram runner fallback to map unsupported `developer` role into `system`.
- 2026-02-11: Redesigned AI settings page into two-pane workspace (provider list + detail editor), improving provider selection flow and model/role operations.
- 2026-02-11: Hardened Telegram custom-provider role fallback by moving `systemPrompt` into a `system` message when provider does not support `developer`, preventing residual `developer` role 400s.
- 2026-02-11: Added unified global skills discovery (`data/telegram-mom/skills`) and upgraded Telegram mom system prompt with richer mom-style sections (skills contract/usage protocol, workspace/system log, and operational query snippets).
- 2026-02-12: Installed `find-skills` skill file into workspace runtime directory `data/telegram-mom/skills/find-skills/` (in addition to Codex global skill directory).
- 2026-02-12: Corrected runtime skill location for current web-start mode; `find-skills` is now present at `data/telegram-mom/skills/find-skills/SKILL.md`.
- 2026-02-12: Added explicit runtime-path documentation: in current web-start mode, Telegram workspace resolves to `data/telegram-mom` and tool execution cwd resolves to `data/telegram-mom/<chatId>/scratch`.
- 2026-02-12: Completed backend full-merge into SvelteKit by moving `src/*` to `web/src/lib/server/*`, updating API/hook imports to `$lib/server/*`, removing `$backend` alias, and unifying root commands (`dev/build/start`) to web package entrypoints.
- 2026-02-12: Updated top-level docs and config for merged layout (`readme.md` paths/commands and `tsconfig.json` server include path).
- 2026-02-12: Flattened SvelteKit app from `web/` to repository root (`src/`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`), merged dependencies into root `package.json`, and removed cross-directory app startup paths.
- 2026-02-12: Fixed production build failure (`@smithy/node-http-handler` browser export error) by replacing `src/routes/+page.svelte` with a pure Svelte chat client that talks to existing `/api/chat`, `/api/sessions`, and `/api/settings` endpoints without importing Node-only runtime packages in browser code.
- 2026-02-12: Added Telegram session management commands and storage model: context now stored as `data/telegram-mom/<chatId>/contexts/<sessionId>.json` with `active_session.txt`; legacy `context.json` is auto-migrated to `contexts/default.json`.
- 2026-02-12: Changed Telegram busy behavior from hard-reject to queue mode: incoming messages during active run are enqueued and user receives `Queued. Pending: N...` feedback instead of `Already working`.
- 2026-02-12: Added text attachment format guard for Telegram uploads: if output file is detected as text and extension is not `.txt/.md/.html`, it is renamed to `.txt` before sending.
- 2026-02-12: Added Telegram `/skills` command for inspecting currently loaded skills and skill loader diagnostics from workspace `data/telegram-mom/skills/**/SKILL.md`.
- 2026-02-12: Hardened delayed reminder behavior by strengthening runner event rules and adding `bash` wait-command guard (`sleep/timeout/wait/ping`) to prevent in-process waiting and force one-shot event creation.
- 2026-02-12: Changed Telegram attachment behavior to text-first delivery: likely text outputs are sent as plain messages when short enough; file upload is used only for oversized text or non-text content.
- 2026-02-12: Rebased Telegram mom runner system prompt to upstream `mom` agent prompt style and content, with minimal local adaptations for Telegram runtime paths, event status-retention behavior, and text-first response policy.
- 2026-02-12: Added workspace-root path guard for mom file tools (`read/write/edit/attach`): absolute/escaped paths outside `scratch` and workspace are now blocked, preventing miswrites like `/tmp/events/*`.
- 2026-02-12: Reworked `src/lib/server/mom/tools` from single-file implementation to modular upstream-style layout (`bash.ts/read.ts/write.ts/edit.ts/attach.ts/path.ts/truncate.ts`) and upgraded tool behavior (image-capable read, structured truncation metadata, bash full-output capture path, shared path guard).
- 2026-02-12: Added reminder shorthand normalization in `write` tool: inputs like `2026-02-12T04:11:09.000Z 你好` are auto-converted to valid one-shot event JSON and written to `data/telegram-mom/events/*.json`.
- 2026-02-15: Enforced canonical workspace skills install path in Telegram runner prompt and added path normalization so mistaken `data/telegram-mom/skills/...` writes from chat scratch resolve to workspace `data/telegram-mom/skills/...` instead of nested scratch duplicates.
- 2026-02-15: Changed Telegram workspace root initialization to absolute path resolution (`resolve(config.dataDir, "telegram-mom")`), so skill path guidance/output now shows full absolute filesystem paths.
- 2026-02-16: Refreshed root `.gitignore` for current mono-root SvelteKit layout; now ignores local env variants, build artifacts (`build/.svelte-kit/dist`), runtime data outputs, logs, and common OS/editor transient files while explicitly keeping `data/telegram-mom/skills/**` versioned.
- 2026-02-16: Added global launcher command `molibot` via npm `bin` + `bin/molibot.js` (supports `dev/start/build/cli`) so project can be started after `npm link` without `npm run dev`.
- 2026-02-16: Migrated default runtime storage root from repo-local `data/` to `~/.molibot` (supports `~` expansion in env paths), and switched Telegram workspace directory from `telegram-mom` to `moli-t` (target path `~/.molibot/moli-t`).
- 2026-02-16: Updated Telegram mom prompt/path conventions to `moli-t` naming for scratch events and skill-path guidance; kept legacy `data/telegram-mom` and new `data/moli-t` prefixes compatible in tool path normalization.
- 2026-02-16: Executed one-time data migration from `/Users/zongxiaocheng/github/molipibot/data/telegram-mom/` to `~/.molibot/moli-t/` using `rsync -a`; verified file-count parity (`2701 -> 2701`).
- 2026-02-16: Completed missing settings migration by copying `/Users/zongxiaocheng/github/molipibot/data/settings.json` to `/Users/zongxiaocheng/.molibot/settings.json`; verified same SHA1 hash on source and target.
- 2026-02-16: Added Telegram outbound formatting bridge in `src/lib/server/adapters/telegram.ts`: common markdown (code block/inline code/bold/italic/strike/heading/link/list) is converted to Telegram-supported HTML and sent with `parse_mode=HTML`; on parse failure, message auto-falls back to plain text to prevent delivery loss.
- 2026-02-16: Optimized dev boot path in `vite.config.ts`: startup now initializes runtime by `server.ssrLoadModule('/src/lib/server/runtime.ts').getRuntime()` directly after Vite listens, removing dependency on first browser request for Telegram activation.
- 2026-02-16: Added Telegram `/models` command: `/models` lists current/configured model options and `/models <index|key>` switches active model in chat, persisting to runtime settings and re-applying Telegram runtime without requiring web settings page.
- 2026-02-16: Added Telegram voice/audio support in `src/lib/server/adapters/telegram.ts`: bot now downloads `voice`/`audio` files, stores them as attachments, and (when STT is configured) transcribes audio to text via OpenAI-compatible `audio/transcriptions` endpoint, appending transcript into inbound message text.
- 2026-02-16: Added STT runtime config in `src/lib/server/config.ts` and `.env.example`: `TELEGRAM_STT_BASE_URL`, `TELEGRAM_STT_API_KEY`, `TELEGRAM_STT_MODEL`, optional `TELEGRAM_STT_LANGUAGE` / `TELEGRAM_STT_PROMPT`.
- 2026-02-16: Upgraded runtime settings model schema to `CustomProvider.models[]` object format (`{id,tags}`) with backward-compatible migration from legacy string arrays, and added `modelRouting` keys (`textModelKey/visionModelKey/sttModelKey/ttsModelKey`) in config + settings store + runtime sanitizer.
- 2026-02-16: Updated Telegram model switching to write `modelRouting.textModelKey` and updated mom runner model resolution to prefer route-based model selection by use case (vision route when image content exists, text route otherwise).
- 2026-02-16: Rebuilt AI settings page into multimodal control center: provider CRUD, model tags, and explicit routing selectors for text model, image recognition model, speech-to-text model, and text-to-speech model.
- 2026-02-16: Updated AI settings model testing UX to per-model granularity: each model row now has its own Test action so the selected target model is explicit; removed ambiguous provider-level default-model test behavior.
- 2026-02-19: Completed `supportedRoles` migration to model-level schema (`customProviders[].models[].supportedRoles`), removed provider-level role dependency in runtime fallback logic, and updated AI settings UI/metadata template to read and display roles per model with legacy provider-level compatibility fallback.
- 2026-02-19: Fixed Telegram STT URL assembly to honor configured provider `path` (for example Groq `/openai` + `/v1/audio/transcriptions`), and added richer uncaught queue/event error logs including stack traces.
- 2026-02-19: Added user-visible Telegram fallback reply for voice STT failures: bot now proactively reports transcription failure reason and suggested config checks instead of failing silently.
- 2026-02-19: Fixed `ReferenceError: ctx is not defined` in `TelegramMomRunner` constructor by removing constructor-time access to message context; runner now resolves initial model with text route and keeps vision selection in request-time path.
- 2026-02-19: Hardened runner API-key handling for routed models: missing active-model key now returns Telegram-visible settings guidance (no Node crash), and provider key lookup no longer depends on fragile provider-mismatch guard.
- 2026-02-19: Added system-prompt "Failure Recovery Protocol" so agent must continue with diagnosis + fallback steps instead of stopping at capability disclaimers; implemented runtime auto-heal to pick first usable custom model (text/vision) and first `stt`-tagged custom model when explicit routing is absent or invalid.
- 2026-02-19: Added STT observability logs (`voice_transcription_target`/`voice_transcription_success`) and prompt guardrails to reduce config hallucinations (assistant should not claim missing GROQ config/API key unless runtime explicitly reports it).
- 2026-02-19: Fixed false “cannot process audio” replies after successful STT by marking transcript payload as `[voice transcript]` in inbound text and adding explicit prompt rule to treat transcript as ready-to-reason text.
- 2026-02-19: Fixed `/settings/ai` model editor interaction reliability by switching nested provider/model edits to immutable updates keyed by provider id, resolving `+ Add Model` and related controls not reflecting changes.
- 2026-02-19: Fixed `+ Add Model` still showing no input by removing empty-id filtering in provider defaults normalization, so draft model rows remain editable before assigning model id.
