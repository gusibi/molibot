# Molibot PRD (V1)

## 1. Product Goal
Build a minimal but real multi-channel AI assistant using pi-mono, with **Telegram + CLI + Web** in V1.

## 2. Target Users
- Solo builders and small teams who want one AI assistant across channels.
- Users who prefer simple interaction over complex automation.

## 2.1 Scope Clarification (2026-02-27)
- 当前“定时任务 / 提醒 / 周期任务”能力仅接入 Telegram mom runtime 事件系统。
- Web chat 与普通 `/api/chat` 对话入口暂不具备自然语言落地 one-shot/periodic 事件的执行链路。
- Telegram 对“X 分钟/小时后提醒我 ……”这类明确相对提醒请求，必须由服务端直接兜底创建 one-shot event，不能完全依赖模型自行调用工具。
- Telegram runtime 的 system prompt 需要模块化构建，并在服务启动时输出一份实际拼装结果供人工检查，避免 prompt 变更后只有运行时隐式生效、无法快速验证。
- `bin/molibot-service.sh` 的 `status` 仅代表该脚本管理的后台实例，不等同于系统内不存在其他手动启动或开发模式运行中的 Molibot 进程。
- `periodic` 事件的正确语义是长期保留并按 cron 重复触发，不能在首次执行后写成 `status.state="completed"` 并从 watcher 调度表移除。
- `periodic` 事件除了长期保留外，还必须像 one-shot 一样持续写回执行元数据，至少包含最近一次触发时间、累计执行次数，以及最近一次错误状态，方便在设置页和事件文件里直接核对运行情况。
- `periodic` 事件在进入执行前必须先持久化 `status.state="running"`（包含开始时间与执行标识），同一 cron 时间槽位仅允许一次有效执行；执行完成后再回写 `pending/error`，并在运行超时后可释放陈旧锁，避免长任务导致同槽位重复触发。
- Bot 维度配置文件 `BOT.md` 必须参与系统提示词最终合并，不仅要出现在 source 列表；合并顺序至少应覆盖 `AGENTS.md -> BOT.md -> SOUL/IDENTITY/...`，确保 bot 级规则真实生效。
- 设置页任务清单不能只停留在只读展示；运维侧至少要支持单条删除、批量选择删除，并且删除动作必须通过受限后端接口校验目标路径属于 watched events 目录，不能直接把任意文件路径暴露给前端删。
- 事件发送层需要对瞬时网络故障具备有限自愈能力；至少应支持一次立即重试和短退避重试，并在设置页提供人工“立即触发/重试”入口，方便验证任务发送链路而不必等待下一个计划时间。
- Telegram agent 的调度落地必须唯一走 watched event JSON 文件；不得退化为 memory 记录，也不得绕过 runtime 事件系统直接写入 OS 级调度器（如 `crontab` / `at` / `launchctl` / `schtasks`）。
- `package/mory` 作为独立 SDK 应当自带可用数据库 driver 与安装依赖；不能只提供 `SqliteDriver` / `PgDriver` 接口再把真实驱动实现完全留给外部宿主。
- `package/mory/README.md` 必须按“独立 SDK 用户文档”编写，清晰覆盖安装要求、SQLite quick start、pgvector 接入、核心 API 用法（`ingest/commit/retrieve/readByPath`）以及宿主仍需提供的能力边界。
- 新增 Linus Torvalds 风格的人设模板 (`IDENTITY.linus.template.md`, `SOUL.linus.template.md`)，为 Agent 提供极致直接、技术至上的备选人格。

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
| P0-08 | Telegram image response media correctness | P0 | V1 | When bot returns image files, Telegram should render them as photos (not opaque data documents) whenever payload is an image |

### Should Have (P1)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P1-01 | Conversation summary compression | P1 | Delivered (2026-03-13) | Runtime auto-compacts old turns when context nears model limits, exposes manual `/compact [instructions]` commands, and allows operators to configure reserve/keep token thresholds in AI Routing settings |
| P1-02 | Redis cache/rate state | P1 | Post V1 | Hot session and throttling moved from in-memory to Redis |
| P1-03 | Basic tool call wrapper | P1 | Post V1 | 1-2 tools can be called via normalized interface |
| P1-04 | Telegram mom parity core | P1 | V1.1 | Telegram bot supports per-chat runner, stop/cancel, tool-calling (`read/bash/edit/write/attach`), attachment ingestion, and event-file scheduling (immediate/one-shot/periodic) |
| P1-05 | Global skills registry for mom runtime | P1 | V1.1 | Runner loads reusable skills from `<workspace>/skills/**/SKILL.md` and exposes skill catalog/rules in system prompt |
| P1-06 | Pluggable memory backend architecture | P1 | Delivered (2026-03-01) | Stable memory gateway now supports replaceable backend selection (`json-file` default, optional `mory`) with unified interfaces (`add/search/flush/delete/update`) and UI/backend setting control |
| P1-15 | Memory backend/source separation | P1 | Delivered (2026-03-01) | Memory storage backends and external sync sources should be separate extension points, so legacy file import or future external memory systems do not have to masquerade as the primary storage backend |
| P1-16 | Startup diagnostics for runtime plugin state | P1 | Delivered (2026-03-01) | Server startup logs should show discovered plugin catalog entries, applied channel plugin instances, selected memory backend, available memory importers, and initial sync results so operators can verify runtime state quickly |
| P1-07 | Memory retrieval strategy and lifecycle | P1 | V1.1 | Memory should support layered storage (`long_term` + `daily`), incremental flush from sessions, and hybrid retrieval (keyword + recency) for prompt injection |
| P1-08 | Memory governance and manual operations | P1 | V1.1 | Memory entries should support conflict labeling and TTL expiration, and operators should have a settings page to list/search/flush/edit/delete memories |
| P1-09 | Unified memory filesystem layout | P1 | V1.1 | All memory files must be stored under `${DATA_DIR}/memory`; channel/runtime-specific memory uses subdirectories under this root (no memory files directly in chat workspace folders) |
| P1-10 | Gateway-only memory contract for agent layer | P1 | V1.1 | Telegram agent memory operations must be routed through memory gateway interfaces/tools (not direct file edits), with periodic import from external memory files and unified management visibility |
| P1-11 | File-driven runner instruction stack | P1 | V1.1 | Telegram runner system prompt should be code-owned at runtime, then merge instruction/profile files from `${DATA_DIR}` (`~/.molibot`) and optional workspace-local overlays; fallback order must be `data-root global files` -> `workspace-local overlays` -> bundled default template |
| P1-12 | Auto-maintained instruction profile files | P1 | V1.1 | Bot prompt should define automatic maintenance for `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md` based on explicit conversation triggers, with high-risk confirmation gate and deterministic priority conflict rules |
| P1-13 | AGENTS workspace-target enforcement | P1 | V1.1 | Any AGENTS update operation must target `${workspaceDir}/AGENTS.md` only; project-root `AGENTS.md` must remain unchanged during bot-runtime instruction edits |
| P1-14 | Workspace bootstrap CLI init command | P1 | V1.1 | Add `molibot init` to initialize `${DATA_DIR:-~/.molibot}`; bootstrap `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `BOOTSTRAP.md` / `IDENTITY.md` / `USER.md` from bundled `src/lib/server/agent/prompts/*.template.md` files |
| P1-15 | Profile files global-path guardrail | P1 | V1.1 | Enforce that `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md` are written only to `${DATA_DIR}` root-level files, preventing chat/workspace-scoped duplicates like `moli-t/bots/<bot>/<chatId>/soul.md` |
| P1-16 | Global profile path compatibility | P1 | V1.1 | Global profile path guard should accept normalized absolute targets (including case variants on case-insensitive filesystems) and avoid false blocking when writing to `${DATA_DIR}/*.md` |
| P1-17 | Multi-scope skills architecture | P1 | V1.1 | Skills should be loaded from `${DATA_DIR}/skills` (global reusable) + `${workspaceDir}/skills` (bot-scoped) + optional `${workspaceDir}/${chatId}/skills` (chat-specific), with deterministic precedence and no startup cleanup of bot-scoped skills |
| P1-18 | Skills inventory in settings UI | P1 | V1.1 | Provide `/settings/skills` to inspect currently installed skills across scopes (`global`/`bot`/`chat`) with explicit file paths and bot/chat context, backed by a server inventory endpoint |
| P1-19 | Standalone mory memory SDK package | P1 | V1.1 | `package/mory` should be independently buildable/testable as a Node package, include path normalization + write-gate APIs, and provide SQLite/pgvector schema/query templates for storage integration |
| P1-21 | Mory cognitive control modules | P1 | V1.1 | `package/mory` should provide non-integration logic modules for write scoring (`importance/novelty/utility/confidence`), conflict resolution/versioning, retrieval intent planning, episodic-to-semantic consolidation, and task-scoped workspace memory helpers with unit tests |
| P1-20 | SOUL tone baseline governance | P1 | V1.1 | Global `SOUL.md` should enforce decisive opinions, anti-corporate phrasing, direct-answer openings, mandatory brevity, and bounded humor/profanity rules for consistent assistant voice |
| P1-22 | Mory README capability checklist | P1 | V1.1 | `package/mory/README.md` should maintain a complete capability matrix with explicit `完成` / `TODO` status so integration work can track SDK readiness without reading source code |
| P1-23 | Mory engine orchestration and executable API | P1 | V1.1 | `package/mory` should provide unified `moryEngine` methods (`ingest/retrieve/commit/readByPath`) and executable `read_memory(path)` tool API for runtime integration |
| P1-24 | Mory async commit execution pipeline | P1 | V1.1 | Commit flow should support async extraction-to-persistence pipeline: extraction result validation, scoring gate, conflict resolution/versioning, and storage write outcomes |
| P1-25 | Mory concrete storage adapters | P1 | V1.1 | In addition to SQL templates, provide concrete adapter contracts and executors for in-memory, SQLite, and pgvector drivers so SDK can be wired without rewriting persistence layer |
| P1-26 | Mory retrieval execution stack | P1 | V1.1 | Retrieval should include planner routing, optional vector recall, reranking, and prompt injection output grouped as L0/L1/L2 memory context |
| P1-27 | Mory forgetting/archive policy engine | P1 | V1.1 | SDK should support retention scoring and capacity-based archive planning/execution with recency/frequency/importance-aware policy |
| P1-28 | Mory extraction validation and observability | P1 | V1.1 | SDK should include strict extraction payload validators and lightweight observability metrics for write outcomes, conflicts, retrieval hit/miss, and token cost |
| P1-29 | Mory full-loop composition E2E | P1 | V1.1 | Add composition-level E2E tests that cover commit -> read -> retrieve -> forgetting loop to ensure module interoperability |
| P1-30 | Global profile template governance | P1 | V1.1 | `${DATA_DIR}` profile files (`AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md`) should keep a stable template structure with clear per-file ownership, lightweight frontmatter metadata, and preserved user-specific content during future rewrites |
| P1-31 | Init bootstrap from bundled profile templates | P1 | V1.1 | `molibot init` should bootstrap `${DATA_DIR}` by copying bundled `src/lib/server/agent/prompts/*.template.md` files instead of creating empty companion profiles, with `AGENTS.template.md` also serving as the runtime fallback AGENTS context when no profile files exist |
| P1-32 | Remove duplicated AGENTS template artifact | P1 | V1.1 | Runtime fallback and install-time bootstrap should converge on a single bundled `AGENTS.template.md`, and the legacy duplicated `AGENTS.default.md` file should be removed |
| P1-33 | Prompt builder module isolation | P1 | V1.1 | Telegram mom system prompt assembly should live in a dedicated module (`src/lib/server/agent/prompt.ts`) rather than inside `runner.ts`, and code-owned prompt sections should focus on runtime contract instead of repeating editable persona/style rules |
| P1-34 | Prompt preview stable-before-dynamic ordering | P1 | V1.1 | System prompt output should place stable runtime contract sections before high-churn payload sections like current memory and skill inventory, so prompt previews are easier to inspect and diff |
| P1-35 | Runtime profile injection sanitization | P1 | V1.1 | Profile file injection should strip YAML frontmatter, avoid injecting human-only meta guidance that conflicts with runtime reality, and normalize path placeholders such as `${dataRoot}` before insertion into the system prompt |
| P1-36 | Adapter-selectable channel prompt sections | P1 | V1.1 | Core prompt assembly should remain channel-agnostic, while each adapter supplies its own channel-specific prompt sections (Telegram/Slack/Feishu/WhatsApp) so adding a client does not require rewriting core prompt rules |
| P1-37 | Settings task inventory UI | P1 | V1.1 | Provide `/settings/tasks` to inspect event-file tasks across workspace and chat scopes, grouped by task type and showing status, delivery, schedule, run count, and file path |
| P1-38 | Channel plugin registry architecture | P1 | V1.1 | New messaging channels should be installable via a manifest/adapter plugin contract without modifying `runtime.ts`, runner core, prompt core, or settings persistence schema beyond plugin registration |
| P1-39 | Feishu inbound media parity core | P1 | Delivered (2026-03-01) | Feishu channel should normalize image/audio/file messages into the same runner input contract as Telegram: attachments persisted, images injected for vision, and audio/media optionally transcribed through configured STT routing |
| P1-40 | Core-owned workspace prompt and skills semantics | P1 | Delivered (2026-03-01) | Data root, memory root, prompt source loading, and skills directory resolution should live in `mom` core and work for all channel workspaces (for example `moli-t`, `moli-f`) so plugins only add optional bot/channel-specific prompt sections |
| P1-41 | Memory import deduplication and prompt hygiene | P1 | Delivered (2026-03-01) | Periodic external memory sync must not re-ingest identical content for the same scope/layer, and prompt rendering must hide repeated memory lines if historical duplicates already exist |
| P1-42 | Memory update dedupe semantics and tool parity | P1 | Delivered (2026-03-02) | Editing a memory into content that already exists must merge rather than create a duplicate, and both web/API and agent memory tools must expose the same dedupe cleanup capability |
| P1-43 | Explicit all-scope query control | P1 | Delivered (2026-03-02) | Cross-scope memory search/list/compact must happen only when explicitly requested; default behavior should stay limited to the current scope |
| P1-44 | Memory settings operator-first default view | P1 | Delivered (2026-03-02) | `/settings/memory` should default to an operator-friendly all-scope view and clearly label the source scope/session of each memory item |
| P1-45 | Backend module structure realignment | P1 | Delivered (2026-03-02) | Server code should be reorganized into explicit modules (`app`, `agent`, `channels`, `sessions`, `settings`, `providers`, `memory`) so ownership is readable without upstream-specific naming like `mom` or generic buckets like `services` |
| P1-46 | Settings/bootstrap boundary split | P1 | Delivered (2026-03-02) | Runtime env/path config should live under `app`, runtime setting schema/defaults should live under `settings`, and the shared web/CLI router path should be explicitly owned under `channels/shared` instead of generic `config.ts` and `core/` buckets |
| P1-47 | Infra and shared-type extraction | P1 | Delivered (2026-03-02) | Cross-cutting storage helpers, rate limiting, and shared message types should move out of generic `db/services/types` buckets into explicit `infra` and `shared` homes so business modules depend on stable foundations |
| P1-48 | Remove dead local web storage backend | P1 | Delivered (2026-03-02) | Unused leftover files from earlier web-storage experiments should be deleted once no runtime or route imports remain, so root `src/lib` does not accumulate misleading dead modules |
| P1-49 | Telegram runtime low-risk modularization | P1 | Delivered (2026-03-02) | Oversized Telegram runtime should first extract low-risk leaf concerns such as queueing, text formatting, STT integration, and local helper types into sibling files before any deeper command-flow split |
| P1-50 | Feishu runtime low-risk modularization | P1 | Delivered (2026-03-02) | Feishu runtime should follow the same shallow-split rule as Telegram: keep orchestration in `runtime.ts`, but move queueing and message send/edit leaf concerns into sibling files |
| P1-51 | Shared channel queue and STT primitives | P1 | Delivered (2026-03-02) | Telegram and Feishu should stop carrying duplicated queue and STT core logic; common queueing and transcription target/HTTP flow should live in `channels/shared`, while channel-specific wrappers keep only transport-local normalization and retry differences |
| P1-52 | Feishu outbound media parity baseline | P1 | Delivered (2026-03-03) | Feishu runtime should no longer drop agent-generated files; it must support outbound file delivery, native image send, audio/media best-effort delivery with safe fallback to file messages, and silent-response message deletion via the channel context |
| P1-53 | README information architecture cleanup | P1 | Delivered (2026-03-03) | Project README should use a conventional GitHub structure and present setup, status, usage, architecture, project layout, API, and limitations in a concise, scannable order |
| P1-54 | README branding polish | P1 | Delivered (2026-03-03) | README should include the project logo in a restrained, well-spaced header treatment so the page has a recognizable identity without hurting readability |
| P1-55 | README positioning aligned to product lineage | P1 | Delivered (2026-03-03) | README introduction should describe Molibot as a simplified OpenClaw-style personal AI assistant so the project framing matches its real origin and intent |
| P1-56 | README first-screen copy polish | P1 | Delivered (2026-03-03) | The README opening should read like a concise product positioning statement, not a loose explanatory paragraph, while preserving the OpenClaw lineage framing |
| P1-57 | README header slogan | P1 | Delivered (2026-03-03) | README header should include a short slogan under the logo to complete the brand presentation without adding visual clutter |
| P1-58 | Unified safe runtime model switching | P1 | Delivered (2026-03-03) | Model switching should be exposed through one validated runtime update path shared by channels/API/agent tools, with Feishu command parity and explicit guardrails against direct settings-file edits by the agent |
| P1-59 | Runtime token usage accounting and settings visibility | P1 | Delivered (2026-03-03) | Each AI request should persist token usage with provider/model metadata, and `/settings/ai` should show today/yesterday/7-day/30-day totals plus daily/weekly/monthly breakdowns and per-model usage summaries |
| P1-60 | Mory backend first-run bootstrap robustness | P1 | Delivered (2026-03-03) | New-machine startup must not fail just because `${DATA_DIR}/memory` or the SQLite parent directory does not exist before the Mory backend initializes |
| P1-61 | Agent-owned multimodal preprocessing boundary | P1 | Delivered (2026-03-03) | Channel adapters should normalize raw text/image/audio/file inputs only; the agent runner should decide STT execution, transcript injection, model routing, and recognition-failure fallback |
| P1-62 | Provider capability verification states | P1 | Delivered (2026-03-03) | Custom model configuration should preserve manual capability tags as the routing source of truth while storing lightweight per-capability verification status (`untested` / `passed` / `failed`) from provider probes for operator review |
| P1-63 | Agent-level identity layer and bot linkage | P1 | Delivered (2026-03-03) | Settings should expose reusable `agents`, allow Telegram/Feishu bot instances to bind an `agentId`, edit agent/bot Markdown prompt files in-page, and load prompt sources in `global -> agent -> bot` order |
| P1-64 | Prompt profile override semantics | P1 | Delivered (2026-03-03) | Profile files with the same logical slot should resolve by override, not concatenation: `bot` overrides `agent`, and `agent` overrides `global`, so only one version of each file participates in the final prompt |
| P1-64 | Verification-aware native vision routing | P1 | Delivered (2026-03-03) | Agent routing should send image payloads natively only when the selected custom text model or dedicated vision-route model has `vision` both declared and verification-passed; otherwise it should fall back to attachment-based handling instead of blindly invoking native vision |
| P1-65 | Audio-input capability groundwork | P1 | Delivered (2026-03-03) | Model configuration should support an explicit `audio_input` capability tag and verification placeholder state even before native audio prompt transport is wired, so later audio routing can build on declared capability metadata without another schema migration |
| P1-66 | Core prompt identity neutrality | P1 | Delivered (2026-03-04) | The base system prompt should not hardcode a bot/persona name; assistant identity must come from configured profile files (`IDENTITY.md`, `SOUL.md`) so agent personas are not overridden by runtime boilerplate |
| P1-67 | Verification-aware audio fallback routing | P1 | Delivered (2026-03-04) | Agent routing should make audio handling explicit from `audio_input` and `stt` metadata: until native audio transport exists, the runner must log why direct audio is unavailable, prefer declared STT fallback routes, and otherwise preserve voice-placeholder behavior with a visible notice |
| P1-68 | Provider settings enable control and built-in/custom split | P1 | Delivered (2026-03-06) | Settings should allow enabling/disabling providers per entry, separate built-in provider management from custom OpenAI-compatible providers, ensure built-in providers default to disabled, and ensure routing/default/model options only use enabled providers while keeping agent runtime flow unchanged |
| P1-69 | Settings navigation active-state correctness | P1 | Delivered (2026-03-06) | Settings sidebar tab highlight should always follow the current page route, with normalized path matching and exact-tab matching for sibling pages to avoid stale active colors when switching tabs |
| P1-70 | Provider enable state persistence on save | P1 | Delivered (2026-03-06) | Saving settings must preserve `customProviders[].enabled` in runtime persistence path so built-in/custom provider toggle state survives refresh and default custom provider resolution remains consistent with enabled providers |
| P1-71 | Vision-to-text fallback for unsupported image models | P1 | Delivered (2026-03-06) | When the active reply model cannot accept native image input, the agent runner should mirror the voice-transcript fallback path: resolve a usable vision route, convert each image into structured text analysis, inject that text into the user prompt, emit explicit notices instead of letting text-only models guess from attachment paths, and strip any historical `image` parts from session context before calling a text-only model |
| P1-72 | Settings single-entity save and unsaved-switch guard | P1 | Delivered (2026-03-07) | Agents/Web Profiles/Telegram/Feishu settings pages should save only the selected entity (single agent/bot/profile), switching selection with unsaved edits must prompt the operator to save first, editing a new entity ID must keep selection bound to that draft (no fallback save to `default`), and New Chat profile selection should show Web Profile names instead of opaque internal user IDs |
| P1-73 | Web chat identity model simplification (profile-only) | P1 | Delivered (2026-03-07) | Web chat should remove user-ID selection entirely and use Web Profile as the only session identity dimension in UI flow, so New Chat only picks profile and no opaque user-id input appears |
| P1-74 | README visual information architecture polish | P1 | Delivered (2026-03-08) | README should present a clear first-screen story with hero, concise highlights, architecture diagram, feature snapshot, and quick-start-first onboarding while keeping all capability claims grounded in actual implementation status |
| P1-75 | README scannability and navigation polish | P1 | Delivered (2026-03-08) | README should add fast navigation and status cues (table of contents, badges, and concise surface matrix) so first-time readers can locate setup/usage sections in seconds |
| P1-76 | README architecture rendering compatibility fallback | P1 | Delivered (2026-03-08) | Architecture section should remain visible even in environments without Mermaid rendering by keeping Mermaid syntax compatibility-friendly and providing a local static diagram fallback |
| P1-77 | Web UI theme tokenization + i18n switch foundation | P1 | Delivered (2026-03-08) | Web chat and settings UI should support light/dark/system theme switching and zh/en language switching with local persistence, while visual colors are driven by one replaceable theme token file (`src/styles/theme.css`) so future theme swaps do not require page-level code rewrites; themed light/dark modes must keep readable text/input contrast across all settings subpages, including AI Engine / Channels / Agent Data / System sections, and should allow palette refreshes such as Solar Dusk without touching page business logic; selection states (selected vs unselected) and form borders must remain visually distinguishable under both themes |
| P1-78 | MCP server integration for agent toolchain | P1 | Delivered (2026-03-08) | Runtime settings should support configurable MCP stdio servers, runner should automatically load MCP tools and merge them with built-in tools, and MCP failures should degrade gracefully without breaking normal chat execution |
| P1-79 | Skill-gated MCP exposure and settings panel | P1 | Delivered (2026-03-08) | MCP configuration should be manageable in Settings UI, and MCP tools must remain hidden by default: only skills that explicitly declare MCP dependencies and are explicitly invoked may enable scoped MCP tools for a run |
| P1-80 | Settings Overview dark-mode accessibility contrast | P1 | Delivered (2026-03-08) | Settings Overview cards should keep WCAG-friendly readable description contrast in dark mode by using theme-aware text tokens instead of fixed low-contrast slate grays, while preserving existing layout and palette behavior |
| P1-81 | Telegram media recognition pre-status and transient action retry | P1 | Delivered (2026-03-10) | When users send image/audio messages, Telegram should immediately show a reusable `Recognizing ...` status before runner thinking starts, and transient network failures on `sendChatAction` / status edits should retry instead of aborting the handling path |
| P1-82 | Telegram transport error root-cause visibility | P1 | Delivered (2026-03-10) | Telegram retry/failure logs should include nested fetch/HTTP cause metadata (`code`, `errno`, `syscall`, `address`, `port`, inner cause message) so operators can distinguish DNS, timeout, reset, and upstream reachability failures without blind reproduction |
| P1-83 | Declared-capability-first native vision routing | P1 | Delivered (2026-03-10) | If the active custom text model explicitly declares `vision`, runtime should send image inputs directly to that model by default; verification state remains advisory/observable and must not force a separate fallback vision API call against operator intent |
| P1-84 | Periodic task in-place update semantics | P1 | Delivered (2026-03-10) | Repeating `create_event` for periodic tasks with the same `chatId + schedule + timezone` must update the existing event in place (not create a duplicate); when duplicates already exist, runtime should keep the newest one active and mark older matches as superseded/non-runnable |
| P1-85 | Cross-provider fallback for retryable model failures | P1 | Delivered (2026-03-13) | When the active model request fails with retryable upstream errors such as `429` / rate limit / timeout / upstream `5xx`, runtime should automatically retry another configured provider before surfacing failure, and final operator-visible errors must include provider/model/baseUrl context for each failed attempt |
| P1-86 | Web config commands should bypass LLM | P1 | Delivered (2026-03-13) | In web chat, operator commands like `/models`, `/skills`, and route-specific model switching should be handled directly by runtime settings/skill data APIs instead of relying on LLM interpretation, so configuration inspection and switching still work when the active model is failing |
| P1-87 | Session entry log substrate and context rebuild | P1 | Delivered (2026-03-14) | Per-chat runtime context should persist as append-only session entries (`message` / `compaction`) in `contexts/<sessionId>.jsonl`, rebuild runnable context from those entries on load, and migrate legacy snapshot-only `.json` context files without losing active sessions |
| P1-88 | Chat-driven OAuth login and auth.json resolver | P1 | Delivered (2026-03-14) | Runtime should resolve built-in provider credentials from `${DATA_DIR}/auth.json` (or `PI_AI_AUTH_FILE`), refresh OAuth-backed credentials automatically when needed, and expose `/login <provider>` plus `/logout <provider>` commands across web and chat channels so auth can be completed from product surfaces rather than manual file editing |
| P1-89 | Compaction overflow recovery retry | P1 | Delivered (2026-03-14) | When an upstream model rejects a request for context/window overflow, runner should compact the current session, persist a structured compaction entry with token metadata, rebuild context from that compacted state, and retry the active request automatically before surfacing failure |
| P1-90 | Bot-level AI usage observability and filtering | P1 | Delivered (2026-03-14) | Usage tracking should include bot identity, and `/settings/ai/usage` should support bot-level filtering and ranking so operators can compare token/request consumption across different bot instances |
| P1-91 | Telegram streaming output mode switch | P1 | Delivered (2026-03-14) | Telegram settings should provide a per-bot stream output switch (default enabled), and runtime should support both incremental streaming edits and final one-shot output when disabled |
| P1-92 | Telegram Codex ACP control path MVP | P1 | Delivered (2026-03-14) | Telegram should support a first ACP-based coding control flow for Codex via explicit `/acp` commands: register allowlisted projects, open a chat-scoped Codex ACP session against a chosen project path, stream back session updates, surface ACP permission requests for operator approval via Telegram, and keep the normal chat runner path unchanged |
| P1-93 | ACP web settings workspace | P1 | Delivered (2026-03-14) | Operators should be able to configure ACP from `/settings/acp`: toggle ACP globally, manage adapter targets (command/args/env/cwd), register allowlisted projects with absolute paths and target bindings, and set each project's default approval mode without editing settings JSON manually |
| P1-94 | Shared settings button interaction reliability | P1 | Delivered (2026-03-14) | Shared UI `Button` must forward native click events so settings actions wired through `<Button on:click={...}>` remain functional across ACP, MCP, channel bot forms, memory operations, and task management pages |
| P1-95 | Codex ACP startup diagnostics and auth hinting | P1 | Delivered (2026-03-14) | When a Codex ACP session fails during adapter startup, runtime should distinguish transport mismatch from adapter-side startup stalls and explicitly hint when no `OPENAI_API_KEY` / `CODEX_API_KEY` is available, because Telegram ACP cannot complete interactive Codex login flows |
| P1-96 | Codex file-auth reuse and startup timeout resilience | P1 | Delivered (2026-03-15) | Codex ACP startup should recognize existing file-based login state from `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) as valid authentication, avoid misleading API-key-only warnings, and allow longer adapter warm-up before failing `initialize` / `session/new` |
| P1-97 | Telegram ACP rate-limit crash hardening | P1 | Delivered (2026-03-15) | ACP task execution over Telegram must tolerate status-edit rate limiting by honoring `retry_after`, suppressing non-fatal edit errors, and throttling status updates so `editMessageText` failures cannot terminate the entire bot process |
| P1-98 | ACP Telegram tool-event consolidation | P1 | Delivered (2026-03-15) | Telegram ACP should not send one chat message per completed tool call; low-value tool completion noise must be consolidated into the final task summary while preserving high-value plan and permission events |
| P1-99 | ACP final-result structured formatting | P1 | Delivered (2026-03-15) | Telegram ACP final answers should render as readable Markdown reports instead of plain-text walls by adding default output-format instructions to `/acp task` and formatting the local completion summary with sections and bullets |
| P1-100 | ACP session restore across Molibot restarts | P1 | Delivered (2026-03-15) | Telegram ACP should persist chat-to-remote-session metadata and automatically restore prior Codex sessions via ACP `session/load` after a Molibot restart, so operators can continue with `/acp status` or `/acp task` instead of always re-running `/acp new` |
| P1-101 | ACP available command list readability | P1 | Delivered (2026-03-15) | `/acp status` should display human-readable available command names when ACP adapters return object-form command entries, instead of leaking `[object Object]` strings |
| P1-102 | ACP sessions inspection command | P1 | Delivered (2026-03-15) | Telegram ACP should expose an explicit `/acp sessions` command that lists available remote sessions (with current marker and project-aware filtering) to support controlled manual session recovery after restarts |
| P1-103 | Telegram ACP permission card interaction | P1 | Delivered (2026-03-15) | ACP permission requests in Telegram should render as clickable action cards with inline approve/deny actions and a guided “deny with note” flow, instead of forcing operators to manually type `/approve` or `/deny` commands from raw text blobs |
| P1-104 | ACP task execution-context diagnostics | P1 | Delivered (2026-03-15) | `/acp task` should always return a structured execution-context snapshot (cwd, directory listing, python/uv path and versions, DB-related env values, exact command and exit code) so “works in local terminal but fails in Codex ACP” issues can be diagnosed from one response |
| P1-105 | ACP immediate stop command alias | P1 | Delivered (2026-03-15) | Telegram ACP should support `/acp stop` as a first-class immediate-stop command (alias of task cancel) so operators can quickly terminate a running ACP task without remembering `/acp cancel` |
| P1-106 | Skill protocol simplification and YAML multiline frontmatter support | P1 | Delivered (2026-03-17) | When global `~/.molibot/skills/skill-creator/SKILL.md` exists, prompt should prioritize this skill for skill creation/update instructions; prompt skills runtime section should remove non-actionable diagnostics and redundant `base_dir` output; skill metadata parser must accept YAML block-style multiline `description` (`>` / `|`) in both runtime loading and settings inventory |
| P1-107 | Explicit slash skill invocation semantics | P1 | Delivered (2026-03-17) | Users should be able to force a skill via direct slash form such as `/skill-name` or `/skill-name@bot`; matching must be case-insensitive and normalize spaces, `_`, and `-`; runner should pass an authoritative explicit-skill marker into the model input so prompt behavior and MCP skill-gating follow the same invocation decision |
| P1-108 | Bot-scope skill path authority and SKILL.md execution safety | P1 | Delivered (2026-03-18) | When explicit skill invocation targets a bot-scoped skill, runner context must include the exact resolved `skill_file` path so the model does not fall back to guessed global paths; skill protocol must explicitly forbid executing `SKILL.md` itself via shell and require reading it before running declared scripts |
| P1-109 | Periodic running lock and slot-level dedupe | P1 | Delivered (2026-03-20) | Events watcher must acquire a persistent `running` lock before dispatching periodic jobs, dedupe per cron minute slot (`lastSlotKey` / `runningSlotKey`), and guard completion/error writes by run id so file status updates cannot re-trigger the same slot repeatedly |
| P1-110 | BOT.md prompt merge enforcement | P1 | Delivered (2026-03-20) | Prompt builder must merge `BOT.md` into final system prompt output (not only source discovery), preserving bot-scope instruction precedence and ensuring bot-level guardrails are active at runtime |
| P1-111 | Settings task edit workflow | P1 | Delivered (2026-03-20) | `/settings/tasks` should support inline editing and save-back of task config (`text`, `delivery`, and type-specific schedule fields) through a validated backend update API, so operators can adjust existing tasks without manual JSON file edits |
| P1-112 | Settings task edit textarea build compliance | P1 | Delivered (2026-03-20) | `/settings/tasks` inline edit input must use explicit `<textarea></textarea>` markup (not self-closing form) so Svelte SSR/client production builds are warning-free and standards-compliant |
| P1-113 | WeChat channel integration | P1 | Delivered (2026-03-22) | Operators can configure `/settings/weixin`, enable a WeChat bot instance, complete QR login through the npm-installed SDK, and reuse the shared chat runtime (sessions, model switching, skills, compaction, OAuth commands) for inbound WeChat conversations without touching core runner architecture |
| P1-114 | WeChat login QR helper in settings | P1 | Delivered (2026-03-22) | Operators can paste the WeChat SDK login URL from runtime logs into `/settings/weixin` and immediately render a scannable QR code in the browser, so phone login does not depend on opening or forwarding the raw link manually |
| P1-115 | Telegram forum topic intake and topic-scoped reply continuity | P1 | Delivered (2026-03-24) | Telegram forum-topic messages should be accepted without mandatory `@bot` mention gating, runtime should preserve `message_thread_id` on status/messages/media replies so responses stay inside the originating topic, and each topic should maintain an isolated runtime/session scope instead of sharing one supergroup context |
| P1-116 | Custom provider controllable thinking support | P1 | Delivered (2026-03-24) | Runtime should stop treating `reasoning: true` as a fake thinking switch, read a real default thinking level from settings, map `off/low/medium/high` into provider-specific request fields for custom providers, and keep the legacy assistant path behavior aligned with the main agent runner |
| P1-117 | ACP settled-history progress display and ACP-first proxy routing | P1 | Delivered (2026-03-24) | ACP channel progress should preserve recent completed/failed history without persisting transient `pending` chatter, Telegram should keep a compact single edited progress message plus separate final summary, and active ACP sessions should proxy slash-style input to the remote agent unless the message is a reserved ACP control command |
| P1-118 | Web chat visible thinking controls and traceability | P1 | Delivered (2026-03-24) | Web chat should expose a per-send thinking selector (`off` / `low` / `medium` / `high`), pass that choice into the runner request, and display enough request/payload/thinking trace information for operators to verify whether reasoning was requested and whether any thinking stream was actually returned |
| P1-119 | Runner-level delta streaming parity for Web and Telegram | P1 | Delivered (2026-03-24) | The shared runner should consume assistant `message_update` deltas from the upgraded agent runtime so Web text chat can stream through the real runner path with a collapsible thinking panel above the answer, and Telegram can render incremental output with batched edits, no duplicate fallback sends, and observable thinking diagnostics instead of per-delta updates that trigger rate-limit stalls |
| P1-120 | Telegram session status command and session-local thinking control | P1 | Delivered (2026-03-25) | Telegram should expose `/status` and `/state` for current session/runtime/model visibility, and `/thinking <default|off|low|medium|high>` must override thinking depth only for the active session so future new sessions still inherit the global default |
| P1-121 | Shared public channel-command ownership | P1 | Delivered (2026-03-25) | Public text-channel commands and session-control behavior should be owned by agent core instead of being reimplemented in each channel runtime; Telegram/Feishu/QQ/Weixin must keep only channel-local parsing, attachment handling, and reply transport while shared command/session/model/thinking flows live in one reusable layer |
| P1-122 | Skill-first prompt rules and slash skill alias resolution | P1 | Delivered (2026-03-25) | The runtime prompt should use generic skill-loading semantics instead of hardcoded skill names, treat slash skill forms as authoritative explicit invocation, and resolve them against both frontmatter `name` and runtime alias forms such as the skill directory name so the model receives the exact `skill_file` path rather than guessing |
| P1-123 | Dedicated-tool-first execution and memory governance prompt policy | P1 | Delivered (2026-03-25) | Runtime/system prompt guidance should prefer dedicated runtime tools over bash when equivalent, require parallel execution for independent tool calls, and define practical memory governance (what to store, what not to store, stale-memory verification/update) so behavior stays predictable across long-lived sessions |
| P1-124 | Prompt mainline prioritization and dynamic payload trimming | P1 | Delivered (2026-03-25) | The live runtime prompt should front-load stable high-value behavior rules before environment/detail sections, compress skill inventory into an index instead of long prose, and trim injected current-memory payloads so dynamic noise does not drown the core instructions that drive task execution |
| P1-125 | Memory write-time classification and prompt eligibility filtering | P1 | Delivered (2026-03-26) | Memory should be classified when written, not only when displayed: long-term collaboration/project/reference memories must be tagged automatically, temporary and lifestyle records must be isolated by default, and prompt injection should prefer high-value classes while still allowing relevant lifestyle memory to surface when the current query actually concerns it |
| P1-126 | General-purpose agent prompt hardening | P1 | Delivered (2026-03-26) | The runtime prompt should not assume a coding-only workload. It must explicitly frame task types, verify fresh/current information before answering, resist prompt injection from fetched content, and require confirmation for broader high-impact actions such as external posting, credential/config changes, and destructive runtime edits |
| P1-127 | Profile template responsibility cleanup | P1 | Delivered (2026-03-26) | Long-term profile templates should have clean boundaries: AGENTS for collaboration contract, IDENTITY for stable role, SOUL for communication style, USER for collaboration-relevant user facts, BOOTSTRAP for minimal init residue only. Repeated runtime rules and low-value personal noise should be removed so these files stop competing with the main system prompt |
| P1-128 | Existing-capability-first routing | P1 | Delivered (2026-03-26) | The agent must treat requests for voice/image/search/reminder output as result requests first, not as implementation asks. Installed skills and dedicated runtime tools must be attempted before any code-writing or workspace modification is considered, and a missed first guess must not immediately escalate into development work |

### P1-117 Implementation Note (2026-03-24)
- Telegram ACP middleware must not keep any stale direct reference to the old local control-command helper once proxy gating is centralized through the shared ACP proxy rule, otherwise bot startup can fail before ACP routing is reached.
- Telegram ACP session identity and permission handling must use the same topic-scoped Telegram conversation key as the main runtime. Using only the raw `chatId` is not sufficient for forum topics because it merges distinct topic sessions, approvals, and progress replies back into one supergroup-level ACP state.

### P1-119 Implementation Note (2026-03-24)
- Web-side visible thinking is only trustworthy if the trace block stays attached to the assistant reply itself, above the final answer, and remains operator-controllable via collapse/expand instead of always-open raw text.
- Telegram live streaming must batch intermediate edits on a fixed cadence and skip over long server-requested retry waits for non-final status edits; otherwise one over-eager delta stream can degrade into multi-minute reply lag after a single 429.
- Telegram stream rendering must not treat every edit failure as permission to send a brand-new copy of the same answer; only a genuinely missing edit target should reopen a fresh message, otherwise one transient edit error can multiply a single reply into several duplicate Telegram messages.

### P1-120 Implementation Note (2026-03-25)
- Session-local thinking changes must persist with the session itself, not in global runtime settings, otherwise switching one Telegram conversation would silently mutate every other session and every future new session.
- `/status` needs to report the next-request reality, not just raw config fragments: active session id, queue/running state, active route models, global default thinking, session override, and the effective next-request thinking level after model capability downgrade.

### P1-121 Implementation Note (2026-03-25)
- Text-channel runtimes should keep only channel-specific concerns: inbound message parsing, attachment/media normalization, transport-local reply/edit behavior, and platform-only commands such as `/chatid`.
- Shared public commands (`/new`, `/clear`, session switching, model switching, OAuth auth commands, status, thinking depth, help, skills, compaction) must be implemented once in agent core and reused by Telegram, Feishu, QQ, and Weixin.
- Session mutations triggered through shared commands must still allow each channel to run local side effects such as prompt-preview refresh, but that callback must stay optional and channel-owned.

### P1-122 Implementation Note (2026-03-25)
- Skill routing prompt rules must stay generic. They should describe how to honor installed skills and explicit invocation, but must not hardcode project-specific skill names into the runtime prompt builder.
- Slash skill invocation must not depend only on `SKILL.md` frontmatter `name`. Directory-name aliases are part of operator reality, so matching and prompt context should carry both the canonical name and aliases, along with the exact resolved `skill_file` path.

### P1-123 Implementation Note (2026-03-25)
- Tool policy should mirror the real runtime surface: `read/edit/write/create_event/memory/attach` are first-class operations; bash is the fallback when those tools cannot complete the task directly.
- Memory policy should be operational rather than abstract: only durable cross-session facts should be stored, ephemeral execution detail should stay out, and stale memory must be verified against current workspace/runtime state before being used.

### P1-124 Implementation Note (2026-03-25)
- Prompt ordering should reflect decision impact, not implementation categories. “How to work” and “when to use skills/tools” must appear before path maps, scheduler detail, or long environment notes.
- Dynamic sections must behave like indexes, not mini-manuals. Skills should expose short descriptions plus aliases/paths, while current memory should inject a bounded summary instead of long raw records.

### P1-125 Implementation Note (2026-03-26)
- Classification should happen at the memory gateway boundary so both supported backends benefit without forking behavior.
- Prompt-memory filtering should be tag-aware rather than content-blind. Collaboration rules, user preferences, project context, and external references deserve priority; lifestyle and temporary notes should remain searchable but stay out of the default prompt unless the active query makes them relevant.

### P1-126 Implementation Note (2026-03-26)
- Claude Code’s strongest portable ideas are not the coding-specific ones but the behavioral ones: classify the task first, verify fresh information, distrust external content as instructions, and confirm high-impact actions.
- For Molibot, these rules must be written in a tool-agnostic and artifact-oriented way so they help with search, media generation, reminders, and other non-coding tasks instead of overfitting to repository editing workflows.

### P1-127 Implementation Note (2026-03-26)
- Profile templates are long-term context, not a second system prompt. If the same rule already lives in runtime prompt assembly, it should not also be repeated in AGENTS/SOUL/USER unless the file owns a different higher-level responsibility.
- USER context should bias toward facts that change collaboration quality. Generic lifestyle details should stay available but visually de-emphasized so they do not compete with task-relevant guidance in every session.

### P1-128 Implementation Note (2026-03-26)
- For a general-purpose agent, “write code” is not a neutral default action. It should be the last resort after existing skills and dedicated runtime tools have been checked against the requested outcome.
- The prompt must explicitly stop the agent from misreading output-format requests as feature-building requests; otherwise it will keep trying to implement voice/image/search support instead of simply using the already-installed capability.

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

## 4.1 Prompt Architecture Clarification (2026-02-28)
- Telegram mom runtime uses split ownership:
  - Runtime-owned system prompt lives in code and is rebuilt each run from current workspace, chat, session, skills, and memory state.
  - `AGENTS.md` and related profile files under `${DATA_DIR}` (`~/.molibot`) are user-editable bootstrap/profile context, not the source of truth for runtime protocol details.
- Default prompt files should stay narrow in responsibility:
  - `AGENTS.template.md`: durable operating rules and file-governance defaults.
  - `SOUL.md` / `TOOLS.md` / `IDENTITY.md` / `USER.md` / `BOOTSTRAP.md`: single-purpose profile/bootstrap files.
- Prompt source resolution rules:
  - Global/default editable source is `${DATA_DIR}` (`~/.molibot`), not repository-root `AGENTS.md`.
  - Workspace-specific prompt files are overlays only; they must not replace the global source convention accidentally.
  - Filename matching should tolerate case variants on case-insensitive filesystems.
  - Global skills live under `${DATA_DIR}/skills`; chat-local skills live under `${workspaceDir}/${chatId}/skills`, regardless of channel plugin.
  - Plugin runtimes must pass the bot workspace root into core prompt/tooling APIs; they must not substitute chat scratch directories as `workspaceDir`.
- Future prompt work must preserve this split and avoid pushing environment/tool/event protocol details back into editable `AGENTS.md`.

## 4.2 Task Inventory Visibility (2026-02-28)
- Operators need a settings view for runtime event tasks without shell access.
- Task inventory should read both workspace event files and chat-local scratch event files under `${DATA_DIR}/moli-t/bots/**`.
- UI should group tasks by event `type` (`one-shot` / `periodic` / `immediate`) and show table-friendly operational fields: status, delivery mode, schedule/`at`, run count, file path, and last error.

## 4.3 Channel Plugin Refactor Staging (2026-03-01)
- Stage 1 focuses on removing Telegram-specific naming from mom runtime core (`types/store/runner/tools`) without changing channel behavior.
- Stage 2 replaces platform-specific runtime lifecycle branches with a unified channel registry, while temporarily keeping built-in Telegram/Feishu plugins and existing settings schema.
- Stage 3 introduces a generic persisted `channels` configuration shape as the internal source of truth, while retaining compatibility with legacy `telegramBots` / `feishuBots` payloads during migration.
- Stage 4 keeps built-in channel plugins in the repository under dedicated plugin directories, and each plugin instance must support explicit enable/disable control so runtime only loads configured active instances at startup.
- A later stage will move channel/provider registration and persistence to fully pluggable manifests so adding a new channel/provider no longer requires editing runtime core files.

## 4.4 Multimodal Boundary Clarification (2026-03-03)
- Channel adapters own transport concerns only: platform intake, trigger checks, file download, attachment persistence, and outbound delivery.
- Channel adapters must not perform content-understanding steps such as STT, OCR, or model-route choice.
- The agent runner owns multimodal interpretation:
  - whether audio should be transcribed,
  - which text/vision/STT model path to use,
  - how transcripts are injected into prompts,
  - and how recognition failures are surfaced or degraded.
- The inbound contract should preserve raw multimodal inputs instead of eagerly collapsing audio into channel-generated text.

## 4.5 Capability Verification Policy (2026-03-03)
- Manual model tags remain the routing source of truth in V1.1.
- Automatic provider tests are advisory: they annotate declared capabilities with verification state, but do not silently rewrite operator intent.
- First-stage automatic verification is intentionally shallow:
  - `text`: connectivity probe,
  - `vision`: lightweight image-input probe,
  - `tool` / `stt` / `tts`: remain `untested` until dedicated probes are implemented.
- Future runtime fallback decisions may use verification state, but initial rollout is operator-facing visibility only.

## 4.6 Verification-Aware Vision Routing (2026-03-03)
- Stage 2 applies verification to `vision` only.
- Image-routing order:
  - If the active text model is custom and `vision` is both declared and `passed`, send images directly to that main model.
  - Else, if the dedicated `vision` route model is custom and `vision` is both declared and `passed`, use that route for native image input.
  - Else, do not send native image payloads; expose image files as normal attachments so the agent can degrade through file/tool-based handling.
- Audio/STT routing remains unchanged in this stage.

## 4.7 Audio Routing Staging (2026-03-03)
- `audio_input` is now a first-class model capability tag in settings, but runtime transport is not yet wired to send raw audio parts into the main model.
- Until native audio prompt transport exists, audio handling remains:
  - declared `audio_input`: informational/config-only,
  - actual execution: existing STT-first fallback path.
- A later stage should enable native audio routing only after the SDK/runtime can pass audio content end-to-end.

## 4.8 Verification-Aware Audio Fallback Routing (2026-03-04)
- `runner.ts` now computes audio routing before any transcription starts.
- Decision order:
  - no audio attachments: do nothing;
  - active text model has `audio_input=passed`: treat native audio as desired, but still fall back because runtime transport is unavailable;
  - declared STT route with `passed`: use it;
  - declared STT route with `untested`/missing verification: still use it as best-effort fallback;
  - no STT target: keep the existing voice placeholder text and emit a user-facing notice instead of pretending transcription happened.

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
- `docs/plugin-development.md`: plugin development contract, lifecycle, config shape, and current discovery/runtime boundaries.
- `AGENTS.md`: collaboration and process constraints.
- Documentation sync rule: `readme.md` must reflect current implemented behavior; when implementation and docs diverge, use `features.md` + actual code/runtime behavior as source of truth and refresh README accordingly.
- Validation status rule: distinguish clearly between `implemented` and `validated in real usage`; do not describe channels/features as “stable/available” unless they have been actually verified in this project usage context.
- Skills provisioning rule: default behavior is manual installation by user; if project-local reusable skills are provided, README must include explicit copy/install commands to `${DATA_DIR}/skills`.

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
  - Core modules are implemented under `src/lib/server/agent/*` (runner/store/tools/events/tools).
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
  - Under current root-start runtime (cwd=`/Users/gusi/github/molipibot`), active workspace resolves to `data/telegram-mom`; skill files must exist under `data/telegram-mom/skills/` to be discovered at runtime.
  - Path semantics clarification:
    - Service process cwd: `/Users/gusi/github/molipibot`
    - Telegram workspace dir: `/Users/gusi/github/molipibot/data/telegram-mom`
    - Per-chat tool cwd: `/Users/gusi/github/molipibot/data/telegram-mom/<chatId>/scratch`
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
  - Root CLI command runs merged backend entry (`tsx src/lib/server/app/index.ts --cli`).
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
  - Reuses `loadSkillsFromWorkspace()` in `src/lib/server/agent/skills.ts`.

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
  - Migrate old directory `/Users/gusi/github/molipibot/data/telegram-mom/` to `~/.molibot/moli-t/`.
- Acceptance:
  - Migrated directory includes chats/events/skills and passes basic parity check (source vs target file count).

## 42. Legacy Settings Migration Completion (2026-02-16)
- Problem:
  - Previous migration covered only Telegram sub-workspace and missed root runtime settings file.
- Requirement:
  - Keep existing runtime settings when moving default data root to `~/.molibot`.
- Enforcement:
  - Copy legacy `/Users/gusi/github/molipibot/data/settings.json` to `~/.molibot/settings.json` and verify content parity.

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

## 68. Channel-Specific Prompt Layering (2026-02-28)
- Problem:
  - Core system prompt still leaks Telegram-specific wording, making future Slack/Feishu/WhatsApp adapters harder to add cleanly.
- Requirement:
  - Keep runtime-owned prompt sections channel-neutral by default.
  - Inject channel-specific formatting or delivery guidance only from the active adapter/channel layer.
- Enforcement:
  - Core prompt must not hard-code a specific client name in identity, tool descriptions, or event delivery explanations.
  - Adapter-specific sections may describe channel formatting/capabilities, but should remain isolated from core runtime sections.
  - Global profile templates should avoid channel-specific wording unless the note is intentionally tied to one adapter.
  - If a channel's output formatting is already enforced by adapter code, do not repeat that formatting guide in the prompt.

## 69. Feishu Inbound Delivery Idempotency (2026-03-01)
- Priority: P1
- Problem:
  - 用户现场出现 Feishu 同一条消息被重复响应，现有实现既依赖进程内通用日志去重，也没有在适配器 stop 阶段真正关闭旧的 WebSocket 连接。
  - Feishu `message_id` 当前在进入通用 `ChannelInboundMessage` 前被压成数字，适配器层缺少基于原始 `message.message_id` 的幂等保护。
- Requirement:
  - Feishu 渠道必须保证同一条入站消息在单实例内只会被处理一次。
  - 配置重载、runtime re-apply、实例切换时不能留下旧的事件订阅连接。
- Enforcement:
  - `FeishuManager.stop()` 必须显式关闭当前 `WSClient`，不能只清空引用。
  - Feishu 适配器在下载资源/STT/入队前，必须基于原始 `chat_id + message.message_id` 做本地幂等去重。
  - 对重复投递应记录专门日志，便于区分“真实重复消息”和“重复订阅/重复回调”。

## 70. Web Settings + Chat UX Productization (2026-03-07)
- Priority: P1
- Stage: Phase 3 (Building) -> Phase 4 (Polish)
- Problem:
  - 设置页把 `Chat` 放在左侧设置导航顶部，交互语义像“设置内部菜单跳转”，用户点击后直接离开设置，体验生硬且容易误触。
  - Chat 页当前在交互和布局上接近草稿态，移动端会话操作弱、消息发送和状态反馈不完整，难以作为稳定主工作台。
- Requirement:
  - 设置页必须把“返回 Chat”从设置菜单中解耦，改为明确的工作区返回动作，并在移动端提供可达的设置导航。
  - Chat 页必须升级为可持续使用的工作台：会话导航、输入体验、状态反馈、信息层级要完整且一致。
- Enforcement:
  - `src/routes/settings/+layout.svelte`：
    - 删除侧栏 `General` 中的 `Chat` 导航项。
    - 在设置壳层提供显式 `Back To Chat` 入口（桌面与移动端均可用）。
    - 增加粘性页面头部，展示当前设置子页面上下文。
    - 在 `lg` 以下提供可展开的设置导航，避免移动端“无导航”问题。
  - `src/routes/+page.svelte`：
    - 完整重构布局为可用的 Chat 工作区（桌面主区 + 移动端抽屉会话列表）。
    - 增加会话搜索、快捷提示词、加载/思考状态、自动滚动。
  - 输入框支持 `Enter` 发送、`Shift+Enter` 换行，并自适应高度。
  - 保持现有后端 API 合约不变（`/api/chat`、`/api/sessions`、`/api/settings`）。

## 71. Web Channel Workspace Unification with Telegram/Feishu (2026-03-07)
- Priority: P1
- Stage: Phase 3 (Building)
- Problem:
  - 当前 Web 会话数据仍落在通用 `sessions/` 目录，缺乏像 `moli-t` / `moli-f` 这样明确的 channel workspace 边界。
  - 用户希望 Web 只是统一 runtime 的一个入口，而不是特殊逻辑分支；Web 也应具备独立目录承载 session/context 等数据。
- Requirement:
  - 为 Web 渠道建立独立 workspace（默认 `~/.molibot/moli-w`），并将 Web session/context 数据统一落在该目录下。
  - 历史 Web 数据需平滑迁移，不可丢失现有对话。
- Enforcement:
  - 增加可配置项 `WEB_WORKSPACE_DIR`（默认 `${DATA_DIR}/moli-w`）。
  - `SessionStore` 对 `channel=web` 的读写必须改用 `moli-w` 目录（按用户分层）和独立 index 文件。
  - 保留 Telegram/Feishu 当前路径策略不变，避免跨渠道回归。
  - 旧 `sessions/` 中 Web 记录在访问时自动迁移到 `moli-w`，迁移后继续保持 API 行为一致。

## 72. Web Feature Parity with Telegram Runtime (2026-03-07)
- Priority: P1
- Stage: Phase 3 (Building) -> Phase 4 (Polish)
- Problem:
  - 当前 Web 聊天入口虽然可用，但和 Telegram 渠道能力不一致：缺少语音/图片输入链路、缺少 profile-agent 绑定入口、缺少 system prompt 可视化预览、缺少运营视角的 user/profile 切换。
  - Web 在会话分桶上仅按 user 维度，无法像 bot 渠道那样按“实例 + 用户”隔离上下文。
- Requirement:
  - Web 入口必须具备与 Telegram 关键运营能力一致的基础集：语音/图片输入、agent 选择、prompt 预览、用户切换。
  - Web 会话维度改为 `profile + user`，避免不同 profile 互相污染。
- Enforcement:
  - `/api/chat` 对 Web 请求改为 runner 路径，支持 multipart 文件（image/audio）并复用 runner 的 STT/vision 路由行为。
  - 新增 `settings.channels.web.instances[]` 的默认实例和 agent 绑定能力，Web profile 的 `agentId` 与 prompt 构建保持同一机制。
  - 新增 `/api/web/system-prompt` 用于返回 prompt 文本及来源文件列表（global/agent/bot）。
  - `/api/sessions` 和 `/api/chat` 的 Web externalUserId 必须包含 `profileId + userId` 组合键。
  - Chat 页新增操作控件：profile 切换、user 切换/新增、agent 选择、附件上传、prompt 预览面板。

## 73. Dedicated Web Profiles Settings Page (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 虽然 Web profile 能力已接入 runtime/chat，但缺少专门设置页，运营只能在聊天页临时调整，配置不可视化且不稳定。
- Requirement:
  - 在 `/settings` 体系中提供独立 `Web Profiles` 页面，体验与 Telegram/Feishu 配置页一致，支持 profile 生命周期管理和 profile-level Markdown 文件管理。
- Enforcement:
  - 新增 `/settings/web` 页面，支持：
    - profile 列表、选择、新增、删除。
    - profile 字段编辑（id/name/enabled/agentId）。
    - profile markdown 文件编辑与保存（`BOT.md`/`SOUL.md`/`IDENTITY.md`/`SONG.md`）。
  - `settings` 左侧导航和 overview 卡片必须出现 `Web Profiles` 入口。
  - profile 文件路径映射必须与 Web workspace 一致（`moli-w/bots/<profileId>`）。

## 74. Chat User Identity Locking (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - Chat 页允许在会话进行中直接切换/新增 user，会导致同一会话上下文身份漂移（A/B 用户混写），影响会话语义一致性与数据可信度。
  - Chat 页控制项过多（user、agent、session 并列操作），核心聊天路径认知成本过高。
- Requirement:
  - 会话进行中不得随意切换 user；user 只能在创建新对话（New Chat）时选择。
  - Chat 页主交互聚焦为：选 session / 新建 session；不在主面板暴露 user 切换与 profile-agent 操作。
- Enforcement:
  - 移除 Chat 页常驻 `user switch/add user` 控件。
  - 新增 `New Chat` 弹窗，支持输入或选择 user，并在确认后创建新 session。
  - 当前会话期间 user 视为锁定，仅显示不允许直接切换。
  - 在 Chat UI 中增加高可见性的 `Locked User` 状态条（侧栏与主头部），避免误判当前会话身份归属。

## 75. Web Session Naming and Ownership Clarity (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 左侧 session 列表缺少明确归属信息，运营视角无法快速判断当前会话属于哪个 user。
  - session 名称目前依赖初始标题，缺少对“对话主题变化”的可维护能力，且缺少手动更正入口。
- Requirement:
  - session 名称应作为“对话摘要标题”展示，并允许手动修改。
  - Chat 展示层应优先显示 profile name（人类可读），而不是内部复合 userId/externalUserId。
- Enforcement:
  - 会话创建后继续保留首轮消息生成标题逻辑，作为默认摘要标题基线。
  - 新增后端 session 重命名 API（按 `conversationId + channel + externalUserId` 校验归属后更新 title）。
  - Chat 左侧列表支持 inline rename（键盘 Enter 保存 / Escape 取消），避免额外跳转。
  - 左侧 session 列表和 Chat 头部身份状态条必须展示 profile name，并可附带 profileId 作为技术标识。
  - raw userId 仅用于会话分桶与 API 参数，不作为主要 UI 身份标签暴露。

## 76. Telegram Multi-Bot Startup Error Attribution (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 多 Telegram 实例并行时，`adapter_start_failed` 仅记录错误文本（例如 `401 Unauthorized`），缺少实例归属，难以快速定位是哪个 bot token 失效。
- Requirement:
  - Telegram 启动/配置相关关键日志必须包含 bot 实例标识，支持运维快速定界。
- Enforcement:
  - `apply`、`disabled_no_token`、`apply_noop_same_token`、`allowed_chat_ids_loaded`、`adapter_start_failed` 日志统一附带 `botId`。
  - 排障流程要求先按 `botId` 定位实例，再校验该实例 token（`getMe`）与 enabled 状态。

## 77. Telegram Per-Bot Fault Isolation on Auth Failure (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 多 bot 运行时，单个 token 失效会持续产生启动失败噪音，运维感知上接近“整个 Telegram 渠道都坏了”。
- Requirement:
  - 单 bot 启动认证失败必须按实例隔离处理，只禁用故障 bot，不影响其余 bot 与主服务。
- Enforcement:
  - 当 Telegram 启动错误命中 `401 Unauthorized` 时，运行时自动将对应 `botId` 的 `channels.telegram.instances[].enabled` 置为 `false` 并持久化。
  - 自动禁用后输出结构化告警日志（含 `botId` 和 reason），用于后续人工修复 token 后再手动启用。
  - 不得因为单实例认证失败而停止其他已启用且凭证有效的 Telegram 实例启动流程。

## 78. Web Chat Realtime Voice Input Control (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - Chat 页将音频入口设计成“选择音频文件上传”，对真实对话场景不友好；用户很难在外部文件系统管理语音附件。
- Requirement:
  - Web Chat 必须提供实时录音控件，语音交互走“录音即发送”路径，而非音频文件选择路径。
  - 图片仍保留附件选择方式。
- Enforcement:
  - Chat composer 的文件选择器仅接受 `image/*`，不再接受 `audio/*`。
  - 新增录音按钮：第一次点击开始录音，第二次点击停止录音并自动发送当前语音。
  - 录音过程需有明显状态反馈（录音中/时长），并在组件销毁时释放麦克风资源。
  - 发送链路继续复用现有 `/api/chat` multipart 流程，确保 runner 的 STT/语音处理路径不变。

## 79. Settings Save Consistency Across Concurrent Runtime Processes (2026-03-07)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 在多运行进程并存（例如多个 dev/server 实例）时，设置保存若基于旧内存快照整份写回，可能把其他页面刚改过的配置回滚到历史版本（典型表现：保存 Web Profiles 后 Telegram bots 数量和内容回退）。
- Requirement:
  - 设置 patch 保存必须基于磁盘最新状态合并，避免“旧进程快照覆盖新数据”。
- Enforcement:
  - `updateSettings` 每次执行时先读取最新 `settings.json`，再应用 patch 并保存。
  - 禁止用进程启动时的长期内存副本直接作为唯一 merge 基线。
  - 对跨页面局部 patch（如仅 `channels.web`）必须保证其他 channel/provider 配置保持最新值不被回退。

## 80. Hybrid Settings Persistence Strategy (2026-03-07)
- Priority: P1
- Stage: Phase 3 (Building) -> Phase 4 (Polish)
- Problem:
  - 单一 `settings.json` 在配置规模增长后会持续膨胀，且全量读写放大并发覆盖风险。
  - 像 providers / channels / agents 这类高频增删改、数量不可控的数据不适合继续放在整文件里。
- Requirement:
  - 采用混合存储：
    - 稳定引导字段保留在 `settings.json`；
    - 高动态域迁移到 SQLite，按域或按记录更新，避免全量覆盖。
- Enforcement:
  - SQLite 动态域至少包含：`customProviders`、`channels`、`agents`。
  - `settings.json` 仅保留 bootstrap 级字段（provider mode、pi defaults、routing、systemPrompt、plugins、timezone、legacy fallback）。
  - 设置读取路径必须执行 “DB 覆盖 JSON 动态域” 合并逻辑。
  - 设置保存路径必须避免动态大对象整文件写回，动态域走 SQLite upsert。

## 81. Channel-Scoped Patch Isolation in Settings Updates (2026-03-07)
- Priority: P0
- Stage: Phase 4 (Polish)
- Problem:
  - 保存单个 channel 子域（如 `channels.web`）时，若后端把 `channels` 当整对象替换，会误删其他 channel（如 Telegram/Feishu）实例。
- Requirement:
  - settings patch 必须按 channel key 级别合并，不能因局部 patch 清空同级其他 channel 数据。
- Enforcement:
  - `channels` sanitize/merge 逻辑必须以当前完整 channel map 为基线，仅覆盖 patch 中出现的 channel key。
  - 对 `channels.web` 和 `channels.telegram` 的单独保存应互不影响，回归测试需覆盖双向场景。

## 82. Relational Dynamic Settings Schema (2026-03-07)
- Priority: P1
- Stage: Phase 3 (Building)
- Problem:
  - 将动态域塞成单条 JSON（即使在 SQLite）仍有“读写放大”和局部更新不透明的问题。
- Requirement:
  - 动态配置改为关系表按实体存储，读取时组装，写入时按实体批量事务更新。
- Enforcement:
  - 至少落地以下表：
    - `settings_agents`（每个 agent 一行）
    - `settings_channel_instances`（每个 channel instance 一行，含 `channel_key` 区分 web/telegram/feishu）
    - `settings_custom_providers`（每个 provider 一行）
    - `settings_custom_provider_models`（每个 provider model 一行）
  - Runtime load 必须支持“表 -> 内存对象”重建；保存必须在事务中完成，防止半写状态。
  - 允许保留 legacy 动态 JSON 表作为迁移 fallback，但不能继续作为主存储路径。

## 83. QQ Channel Parity and Progressive Enhancement (2026-03-08)
- Priority: P1
- Stage: Phase 3 (Building) -> Phase 4 (Polish)
- Problem:
  - 当前内置渠道缺少 QQ，无法覆盖国内常见即时通信场景。
  - 需要先保证 QQ 与 Telegram 的基础使用一致性，再逐步接入 QQ 特有能力。
- Requirement:
  - 提供内置 QQ channel runtime，能力基线与 Telegram/Feishu 对齐：消息接收、回复、会话命令、runner 调度、设置页多实例配置、bot profile 文件覆盖。
  - QQ 基线接入必须走现有 channel plugin registry + `channels.<key>.instances[]` 配置结构，不可破坏现有 Telegram/Feishu/Web 行为。
  - 后续迭代支持 QQ 特有能力（群/频道细粒度消息策略、媒体能力、输入状态提示）作为增强项，不阻塞基础可用性上线。
- Enforcement:
  - 必须新增 `channels.qq` 内置插件并在 runtime 启动流程中自动加载。
  - 设置页必须新增 `/settings/qq`，支持 `appId/clientSecret/allowedChatIds/agentId` 与 Bot Markdown 覆盖文件编辑。
  - 内存/会话/prompt channel 类型必须包含 `qq`，确保 runner 与 memory flush 路径一致。
  - QQ 增强能力（媒体上传、语音转写、消息编辑/撤回替代策略）单独列入后续迭代，不得以“增强未完成”为由阻塞基础文本链路交付。

## 84. QQ ID Discovery and Whitelist Operability (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 首次接入 QQ 时，操作者通常不知道 `chatId/groupOpenid/channelId`，若提前配置错误白名单会导致“收不到消息 -> 无法发现 ID”死循环。
- Requirement:
  - QQ runtime 必须提供可检索的入站日志字段，支持从日志直接提取可用 ID。
  - 默认不配置白名单时应允许通过所有已授权场景消息，便于首轮握手和 ID 发现。
- Enforcement:
  - 每条入站 QQ 事件需输出结构化日志，至少包含：`kind/chatId/userId/groupOpenid/channelId/guildId/messageId` 与文本预览。
  - 运营手册需明确“先空白名单跑通，后回填 allowedChatIds”的接入顺序。

## 85. QQ Media Inbound No-Drop Baseline (2026-03-08)
- Priority: P1
- Stage: Phase 3 (Building)
- Problem:
  - QQ 语音/图片常以附件事件入站，若仅按文本处理会被判空丢弃，导致“收不到语音/图片”的体感故障。
- Requirement:
  - QQ channel 必须把附件事件纳入标准 runner 输入：附件落盘、图片进入 `imageContents`、音频进入 `attachments`，并对无文本的媒体消息提供可处理占位文本。
- Enforcement:
  - 入站解析不得因为 `content` 为空而直接丢弃带附件的事件。
  - 语音附件应优先使用 `voice_wav_url` 下载，图片附件应写入 `imageContents` 供视觉模型路径使用。
  - 无原生消息编辑能力时，`replaceMessage` 不得触发重复完整发送。

## 86. QQ Reply-ID Correctness and Audio Extension Coverage (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - QQ 被动回复对 `msg_id` 有严格约束，错误复用 bot 回包 ID 会触发 `40034024 msg_id invalid/unauthorized`。
  - 语音附件若扩展名为 `.amr/.silk` 且 MIME 不标准，容易被误判为普通文件，导致 STT 链路判定 `no_audio`。
- Requirement:
  - QQ 回复链路必须仅使用入站原始消息 ID 作为被动回复目标，禁止链式替换为 bot 回包 ID。
  - 附件分类需覆盖 QQ 常见语音扩展名（至少 `.amr/.silk`），确保音频路由可见。
- Enforcement:
  - QQ channel 发送逻辑中，`replyToId` 应固定为当前入站消息 ID（或降级主动消息），不得动态覆盖为 bot 输出消息 ID。
  - 通用附件分类层必须把 `.amr/.silk` 归入 audio，保持跨 channel STT 判定一致性。

## 87. Credential Field Visibility Toggle in Settings (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 凭证输入框默认掩码会阻碍人工核对，输入错误时难以快速定位（尤其是长 token/secret）。
- Requirement:
  - Bot 渠道设置页应支持凭证字段一键 `Show/Hide`，在不离开页面的情况下校验输入值。
- Enforcement:
  - Telegram token、Feishu App Secret、QQ App Secret 字段均需提供可切换可见性的按钮。
  - 切换逻辑仅影响前端显示，不改变保存 payload、后端存储和日志脱敏策略。

## 88. Bot-Scoped Skills Persistence and Prompt Consistency (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 服务启动时 bot 工作区 `skills` 目录被自动迁移/搬空，会破坏 bot 维度技能管理预期。
  - system prompt 与技能枚举在命名和目录语义上不一致（`workspace-legacy` vs `bot`），容易误导运维操作。
- Requirement:
  - 技能加载语义应明确为：`global + bot` 为主，`chat` 为可选临时补充；启动时不得清空 bot 目录。
  - system prompt、`/skills` 命令、设置页 `/settings/skills`、`TOOLS.md` 的目录声明和 scope 命名必须一致。
- Enforcement:
  - bot 工作区（`${DATA_DIR}/moli-*/bots/<botId>`）启动时禁止执行会移动/清空 `${workspaceDir}/skills` 的迁移操作。
  - 统一 scope 命名为 `global` / `bot` / `chat`，移除对 `workspace-legacy` 的对外展示。
- `buildSystemPrompt` 中必须同时声明并展示 `global` 与 `bot` skills 目录，避免“只看得到一个目录”的误导。

## 89. Agent MCP Toolchain Support (2026-03-08)
- Priority: P1
- Stage: Phase 3 (Building) -> Phase 4 (Polish)
- Problem:
  - 当前 agent 仅支持内置工具（`read/bash/edit/write/...`），无法直接接入 MCP server 工具生态。
  - 许多第三方工具链以 MCP 提供，缺少 MCP 会导致功能扩展成本高、重复造轮子。
- Requirement:
  - Runtime settings 支持配置多个 MCP server（至少支持 `stdio` 传输）。
  - Runner 在每次执行前自动加载可用 MCP tools，并与本地工具一起注入 agent。
  - MCP server 连接/调用失败时应降级为告警，不得阻断基础对话与本地工具执行。
- Enforcement:
  - 新增 `mcpServers` 配置结构并持久化到 settings。
  - MCP tool 名称必须做本地唯一化前缀，避免与内置工具重名冲突。
- MCP 工具返回内容需标准化到 agent 可渲染内容块（至少文本，支持图片直传）。

## 90. Skill-Gated MCP Exposure Model (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 即使接入 MCP，如果在每轮默认加载所有 MCP 工具，agent 会在无显式意图时获得过宽能力面，且与“skills 扩展”定位冲突。
  - 运营上需要可视化管理 MCP server，避免手改 JSON。
- Requirement:
  - MCP server 提供设置页可视化增删改（ID、启用状态、stdio command/args/cwd/env、tool 前缀）。
  - MCP 工具默认不暴露；只有当 skill frontmatter 显式声明 MCP 依赖，且本轮输入显式调用该 skill 时，才按 skill 声明的 server 范围注入 MCP tools。
  - 未命中 skill 或未显式调用 skill 时，agent 不得看到/调用 MCP tools。
- Enforcement:
  - skill frontmatter 支持 `mcpServers` / `mcp_servers` 字段。
  - runner 在 `setTools` 前按“显式 skill 调用 -> skill 声明 server id -> settings 中对应 server”链路选择性注入。
  - `/settings/skills` 应显示 skill 的 MCP 绑定信息，便于审计。

## 91. MCP Settings JSON-First UX + HTTP Server Support (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - MCP 设置页若拆分太多字段（command/args/env 等）会显著增加使用门槛，用户更常见的输入方式是直接粘贴可复用 JSON。
  - 仅支持 stdio 传输不够，常见 MCP 部署形态包含 HTTP endpoint，需要原生支持。
- Requirement:
  - `/settings/mcp` 以单一 JSON 输入为主，支持粘贴 `{ "mcpServers": { ... } }` 或直接 server object map。
  - 页面需要自动解析 JSON 并展示 server 列表，列表中提供每个 server 的启用/关闭开关。
  - settings/runtime/MCP client 需同时支持 `stdio` 与 `http` 传输类型。
- Enforcement:
  - settings sanitize/store/API 必须兼容 array 与 object-map 两种 `mcpServers` 结构并归一化存储。
  - MCP client 在 `transport=http` 时使用 HTTP transport 连接，并保留失败降级（warning-only）语义。
  - UI 不再强制用户逐字段编辑 MCP 参数，避免复杂配置流程。

## 92. MCP Use Via Skill Prompt (No Skill Schema Changes) (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 让 skills frontmatter 承担 MCP 声明（如 `mcpServers`）会改变现有 skill 使用习惯与格式预期，违背“skills 逻辑保持稳定”的目标。
- Requirement:
  - 保持现有 skills 框架与 `SKILL.md` 必填字段不变（仅 `name` / `description`）。
  - 当用户显式调用 skill 时，系统可用已启用 MCP 工具；不要求 skill frontmatter 提前绑定 MCP server。
  - 当任务/skill 要求使用的 MCP server/tool 不存在或不可用时，需给出明确错误提示（指出缺失项）。
- Enforcement:
  - runner 的 MCP 注入不依赖 frontmatter MCP 字段。
  - system prompt 明确声明“缺失 MCP 必须报错”规则，避免静默失败。
  - 未显式调用 skill 时，MCP 保持隐藏，不默认暴露。

## 93. Runtime MCP Loader Tool (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 仅靠被动注入策略，agent 在“需要某个 MCP 时”缺少显式控制入口，不利于按 server 精准启用与排障。
- Requirement:
  - 新增内置工具 `load_mcp`，支持 `list/load/unload/clear`。
  - `load` 时可按 `serverId` 精准启用 MCP；`unload/clear` 可关闭已加载 MCP。
  - 如果 `serverId` 不存在或被禁用，必须直接返回明确错误信息。
- Enforcement:
  - `load_mcp` 操作后应刷新当前会话的 MCP 工具可用集，避免“已加载但不可调用”状态。
  - 不修改 skills 文件格式与 frontmatter 约束。

## 94. Skills Temporary Disable Toggle (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 当前 skills 仅支持“存在即加载”，想临时停用某个 skill 只能删文件，操作重且不可逆。
- Requirement:
  - `/settings/skills` 为每个 skill 提供 `Enable` 开关。
  - 关闭后 skill 文件保留，但运行时加载需忽略该 skill。
  - 开关状态持久化，重启后仍生效。
- Enforcement:
  - runtime settings 增加 `disabledSkillPaths`（按 `SKILL.md` 绝对路径标识）。
  - runner/system prompt/channel `/skills` 命令都必须基于 `disabledSkillPaths` 过滤。
  - API/UI 必须可视化展示当前启用状态并可即时切换。

## 95. Stop Should Abort Current Run Immediately (Keep Queue) (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 当前 stop 行为在长任务（如安装软件）时表现为“等待任务自然结束/报错后才停”，不符合用户预期。
  - 另一个误区是 stop 不应清空后续排队消息；用户希望仅中断当前执行中的那一条。
- Requirement:
  - `stop`/`/stop` 必须立即中断当前正在执行的 runner 任务。
  - stop 只影响当前执行中的任务，不清空队列中已排队的后续消息。
  - 对 Feishu/QQ，纯文本 `stop`（无 `/`）也应识别为 stop 命令。
- Enforcement:
  - stop 实现必须直达 `runner.abort()`，不能依赖排队执行。
  - 队列实现不得在 stop 时批量清空。

## 96. Stop Responsiveness Under In-flight MCP Calls (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 即使已触发 `runner.abort()`，若当前在执行 MCP tool 调用且未绑定 abort signal，stop 仍会表现为“等待工具自己超时/返回”。
  - 命令层 `running` guard 只有在 run finally 才解除，会导致 `/new` 被短时阻塞。
- Requirement:
  - MCP tool 调用必须透传 abort signal，确保 stop 可中断 in-flight MCP 请求。
  - stop 触发后应立即解除命令层 busy 状态；但不得清空队列。
- Enforcement:
  - `client.callTool` 必须接收 `RequestOptions.signal`。
  - 各 channel stop handler 在 `runner.abort()` 后立即释放 chat running guard。

## 97. Prompt Refresh Policy: On-Change + New Session (2026-03-08)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 每条消息都重建 system prompt 会增加缓存失效率。
  - 但 settings 中与 prompt 相关的变更（如 skill 启停）若不及时生效，会导致行为与配置不一致。
- Requirement:
  - `/new` 后必须刷新 system prompt。
  - 常规消息仅在“prompt 相关配置发生变化”时刷新 system prompt。
  - 对不影响 prompt 的配置变更，不应触发 prompt 重建。
- Enforcement:
  - runner 维护 prompt-refresh key（指纹）并在每次 run 前比对。
  - 指纹至少包含：`systemPrompt`、`timezone`、`disabledSkillPaths`、`mcpServers`、当前 bot 的 channel agent 绑定信息。

## 98. Web Chat Productization UI Refresh (Phase A/B Kickoff) (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 当前 Web Chat 已可用，但视觉层次与信息密度仍偏“工程界面”，难以作为公开展示产品首页面。
  - Chat 与 Settings 风格存在割裂，缺少统一产品化体验基线。
- Requirement:
  - 先完成 Chat 页第一轮产品化重构：侧栏、消息区、输入区、弹窗统一为同一视觉语言。
  - 在不重写后端聊天链路的前提下，提升可读性与状态可感知度（如消息时间、活跃状态、层级分区）。
  - 保留现有会话管理、模型切换、语音/图片上传、系统提示预览等功能可用性。
- Enforcement:
  - 第一轮改造以 `src/routes/+page.svelte` 为主，避免引入后端行为变更。
  - 之后按页面顺序推进 Settings 统一重构，最终形成可对外演示的完整产品表面。

## 99. Chat Surface Style Baseline = Shadcn Standard (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 产品化改造后如果继续叠加项目个性化视觉效果，会偏离“先用标准框架风格统一”的目标，后续 Settings 也难保持一致。
- Requirement:
  - Chat 页先回归 shadcn 风格基线：标准 card / muted / border / focus / hover 语义，不增加装饰性特效。
  - 继续保留现有业务交互和后端链路，只替换视觉呈现层。
- Enforcement:
  - 页面禁止额外氛围背景、重阴影、非必要渐变。
  - 交互态优先使用中性状态与语义色，不做品牌化“艺术风格”强化，待全站统一后再考虑二次主题定制。

## 100. Full Settings Surface Theme Unification via Global Mapping (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - Settings 页面数量多、历史样式差异大，逐页改 class 成本高且容易漏页，导致“改了一部分但整体不统一”。
- Requirement:
  - 在不改业务逻辑的前提下，让 `/settings` 所有子页面统一到默认 shadcn 语义风格。
  - 将主题启动默认值统一为 light，避免首次进入时受旧本地状态影响出现偏色。
- Enforcement:
  - 通过全局样式映射层统一处理旧页面中常见的 `text-slate*/bg-[#]/border-white*` 组合。
  - `Chat` 与 `Settings` 共享同一套主题 token（`src/styles/theme.css`）。

## 101. Settings IA + Interaction Consistency Pass (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 仅有主题变量统一还不够，Settings 总览页与外壳交互语义仍不够一致，影响“已完成产品界面”的观感。
- Requirement:
  - 统一 Settings 外壳导航激活态、悬停态、头部背景语义。
  - 重构 Overview 为标准化目录卡片页，明确各配置域入口。
  - 补齐 settings 全局交互控件（button/link/input）的一致性规则。
- Enforcement:
  - 保持默认 shadcn 风格语义（card/muted/border），不引入额外视觉特效。
  - 不改 API 与业务逻辑，只改 UI 呈现层与信息架构层。

## 102. Every Settings Page Must Opt-In to Shared UI Contract (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 即使有全局主题映射，如果页面没有统一的结构挂载点，后续样式升级会出现“有些页生效、有些页不生效”的碎片化风险。
- Requirement:
  - `settings` 下每个页面都必须显式声明统一页面容器标识（`settings-page`），确保后续设计系统规则可稳定覆盖全部页面。
- Enforcement:
  - 每个 `src/routes/settings/**/+page.svelte` 入口容器必须挂载 `settings-page`。
  - 共享样式定义集中在 `src/app.css`，禁止再引入页面级随机主题偏移。

## 103. Final Visual De-noise Pass for Legacy Settings Classes (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 历史页面中仍存在大量渐变、重阴影、emerald 强色 class，导致虽然主题 token 统一了，但视觉观感仍有“局部旧风格残留”。
- Requirement:
  - 在不重写业务模板的情况下，把 legacy class 的视觉输出收敛到 shadcn 默认语义。
  - 保证 hover/focus/ring/border 统一，不出现页面间交互态差异。
- Enforcement:
  - 在 `src/app.css` 增加针对 legacy class 的全局覆盖映射（gradient/shadow/emerald/black-layer/focus variants）。
  - 优先保证一致性和可维护性，不再继续叠加页面级视觉特效。

## 104. Shared Component Entry Migration for All Settings Pages (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 仅靠主题映射仍会让页面结构层保持“各写各的”，后续演进时不利于统一。
- Requirement:
  - 引入共享 UI 基础组件（Button/Card/Alert/PageShell）。
  - 将所有 settings 页面入口容器迁移到统一 `PageShell` 组件，避免各页面自行维护根容器布局。
  - 在总览页与典型页面中开始替换为共享组件（如 Card/Alert），形成可持续迁移路径。
- Enforcement:
  - `src/routes/settings/**/+page.svelte` 必须使用 `<PageShell ...>` 作为页面根容器。
  - 新增页面默认从共享 UI 组件构建，不再直接复制旧 class 模板。

## 105. Replace High-frequency Native Controls with Shared UI Components (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 即使页面入口统一，内部仍有大量原生 `button` 和告警块，造成交互状态与文案反馈表现不一致。
- Requirement:
  - 将 settings 高交互页面中的核心操作按钮与状态提示迁移到共享 `Button` / `Alert` 组件。
  - 保持业务逻辑不变，仅替换展示层实现。
- Enforcement:
  - 优先覆盖 `memory/tasks/channel-settings/mcp/plugins/skills` 等高频操作页。
  - 迁移后继续使用同一主题 token，不允许页面自行引入新的视觉分支。

## 106. Migrate Remaining Critical CTA Buttons in AI/Agent Pages (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - `agents` 与 `ai/*` 页面仍保留部分历史自定义 CTA 按钮样式，导致关键保存/删除操作在视觉和交互反馈上与其它页面不一致。
- Requirement:
  - 将核心提交/删除/测试操作按钮迁移到共享 `Button` 组件，统一语义 variant（default/outline/destructive/secondary）。
- Enforcement:
  - 不允许关键操作继续使用页面级硬编码 CTA 样式。
  - 按钮状态（disabled/loading）统一依赖组件行为，减少手写样式分叉。

## 107. Shared Migration Build-Stability Gate (2026-03-14)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - 在批量替换页面结构为共享组件时，容易出现标签边界错误（例如 `PageShell` 下的多余闭合标签），导致整站构建失败。
- Requirement:
  - 所有 settings 页面在共享组件迁移后必须通过 Svelte 编译检查，确保标签层级和根容器边界合法。
- Enforcement:
  - 每次迁移提交必须执行一次完整构建校验。
  - 对 `src/routes/settings/**/+page.svelte` 出现的标签闭合错误优先修复，避免阻塞后续页面改造。

## 108. Telegram 超长消息自动分段发送基线 (2026-03-15)
- Priority: P0
- Stage: Phase 3 (Build) -> Phase 4 (Polish)
- Problem:
  - Telegram `sendMessage` 单条消息长度上限导致运行时出现 `400: Bad Request: message is too long`，在 `/skills`、模型列表或长文本输出场景下会直接报错。
- Requirement:
  - 所有 Telegram 文本发送链路在消息过长时必须自动分段发送，避免单条超限失败。
  - 分段逻辑优先按换行切分，保证可读性；必要时按固定长度硬切。
  - 高风险命令输出（如 `/skills`、`/models`）必须显式走分段发送流程。
- Enforcement:
  - `sendTelegramText` 作为统一发送入口，内置分段逻辑并顺序发送 chunks。
  - 运行时中直接调用 `bot.api.sendMessage` 的路径需迁移到 `sendTelegramText`。
  - 长文本命令回复不得直接一次性 `ctx.reply(超长文本)`，应先 chunk 再发送。

## 109. MCP 工具暴露收敛，避免非必要自动加载 (2026-03-15)
- Priority: P0
- Stage: Phase 3 (Build)
- Problem:
  - `load_mcp` 工具默认常驻可用，模型在普通任务（如图片生成）中会误调用 MCP 加载流程，出现“把 skill 名称当作 MCP serverId”的无效尝试与噪音报错。
- Requirement:
  - `load_mcp` 不应默认暴露给所有请求；仅在明确需要 MCP 的回合才开放。
  - 明确禁止将 skill 名称等同于 MCP server ID。
- Enforcement:
  - 运行时仅在“显式 skill 调用”或“会话已有已选 MCP server”时注入 `load_mcp` 工具。
  - 系统提示词 MCP 章节增加防误用规则（仅在任务明确需要 MCP 时调用，且不得将 skill 名称当作 serverId）。

## 110. MCP 与 Skill 彻底解耦的触发边界 (2026-03-15)
- Priority: P0
- Stage: Phase 3 (Build)
- Problem:
  - 仅凭“提到 skill”就触发 MCP 会造成概念混淆：skill 是 skill，MCP 是 MCP；二者不应模糊联动。
- Requirement:
  - MCP 仅允许在两类白名单场景启用：
    1. 用户明确提到“使用 MCP / 加载 MCP / use MCP”等 MCP 关键词；
    2. 用户显式调用某个 skill，且该 skill 明确声明 MCP 依赖（`mcpServers`）。
  - 除上述场景外，禁止启用/调用 MCP。
- Enforcement:
  - `load_mcp` 暴露条件从“任意显式 skill 调用”收紧为“显式 MCP 意图 or skill 声明 MCP 依赖 or 会话已有已选 MCP server”。
  - 默认不因普通 skill 调用自动开放 MCP，避免把 skill 名称误当 `serverId`。

## 111. /models 命令当前模型可见性增强 (2026-03-15)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - `/models` 虽然会列出候选模型，但当前活跃模型仅通过列表中的 `(active)` 标记呈现，不够直观；同时 `/help` 文案对 `/models` 的行为说明不够明确。
- Requirement:
  - `/models` 输出顶部必须单独显示“当前活跃模型”和“当前活跃 key”，避免用户在长列表中反复查找。
  - `/help` 中 `/models` 相关描述必须与真实行为一致，并强调会显示当前活跃模型。
- Enforcement:
  - `modelsText(route)` 增加显式 `Current active model` / `Current active key` 字段。
  - `helpText()` 中 `/models` 描述统一改为 show + current active 语义。

## 112. System Prompt Preview 实时刷新一致性 (2026-03-15)
- Priority: P1
- Stage: Phase 4 (Polish)
- Problem:
  - `SYSTEM_PROMPT.preview.md` 在部分高频操作后不刷新（如 `/new` 或设置页仅切 skill 开关后触发的 no-op apply），导致“运行时已更新但预览文件未更新”的观测偏差。
- Requirement:
  - 只要 prompt 相关状态可能变化，preview 文件应及时重写，避免使用旧快照误判。
  - 会话切换与重置类命令也要触发 preview 重写，保持 `chat_id/session_id` 元信息同步。
- Enforcement:
  - Telegram `apply_noop_same_token` 分支必须调用 preview 重写。
  - `/new`、`/clear`、`/sessions <selector>` 执行成功后必须调用 preview 重写。

## 113. ACP 多 Provider 统一接入层 (2026-03-21)
- Priority: P1
- Stage: Delivered (2026-03-21)
- Problem:
  - 当前 ACP 虽然协议层通用，但默认 preset、auth hint、项目 allowlist 默认值、帮助文案与状态展示都偏向 Codex，导致接入 Claude Code 时会出现行为不一致和代码层散落特判。
- Requirement:
  - ACP target 必须显式声明 `adapter` 类型，至少支持 `codex` / `claude-code` / `custom`。
  - Codex 与 Claude Code 的默认命令、认证提示、命令前缀展示必须下沉到独立 provider 文件中管理，不能继续散落在 `service.ts`。
  - Telegram 对外控制面保持统一 `/acp ...` 命令，不为不同 provider 分叉；如远端 adapter 自带命令不一致，则在展示层用 provider 前缀区分。
  - 新建项目的默认 allowlist 不能再硬编码只允许 `codex`，而应默认允许当前启用的 ACP targets。
- Enforcement:
  - `src/lib/server/acp/providers/codex.ts` 与 `src/lib/server/acp/providers/claude-code.ts` 分别承载 provider 细节。
  - `src/lib/server/settings/schema.ts` 中的 ACP target schema 必须带 `adapter` 字段，并对旧配置做自动推断兼容。
  - `/settings/acp` 必须能看见/编辑 target adapter，并内置 Codex / Claude Code preset。
  - `/acp status` 等输出必须明确区分 provider-specific remote commands，例如 `codex:/...`、`claude-code:/...`。
  - 当 operator 明确把 target 标记为 `custom` 时，运行时必须尊重该选择，不能再根据命令行内容把它自动重判回 Codex 或 Claude Code。

## 114. ACP 远端命令执行入口 (2026-03-22)
- Priority: P1
- Stage: Delivered (2026-03-22)
- Problem:
  - 虽然 `/acp status` 已经能展示 provider-specific remote commands，但 operator 还缺少一个统一入口去直接触发这些远端命令，只能把命令手动拼到 `/acp task` 文本里，交互不稳定且难以区分命令前缀。
- Requirement:
  - Telegram 必须提供 `/acp remote <command> [args]`，用于直接执行 ACP 会话暴露的远端命令。
  - 远端命令解析需要支持可选 provider 前缀（如 `codex:/...`、`claude-code:/...`），并在前缀与当前 active target 不匹配时给出明确报错。
  - 当会话返回了 `availableCommands` 时，运行时必须优先按该列表校验远端命令，避免执行未知命令。
- Enforcement:
  - `src/lib/server/channels/telegram/runtime.ts` 的 `/acp` 路由必须新增 `remote` 子命令并写入 `/acp help`。
  - `src/lib/server/acp/service.ts` 必须提供统一的远端命令解析接口，负责 prefix 处理和命令校验，而不是把 provider 逻辑散落在 Telegram 层。
  - Telegram 子命令参数提取必须兼容“仅输入子命令名”的场景（如 `/acp remote`、`/acp task`），此时应返回 usage，而不能把子命令名本身当作 payload 执行。

## 115. ACP 活跃会话默认直通代理模式 (2026-03-22)
- Priority: P1
- Stage: Delivered (2026-03-22)
- Problem:
  - 当前 operator 在 ACP 会话中仍需要每条任务使用 `/acp task ...`，交互割裂，不符合“进入会话后直接与 Codex/Claude 对话”的预期。
- Requirement:
  - 当 chat 存在活跃 ACP 会话时，默认把用户文本直接转发到该会话执行，不再要求 `/acp task` 前缀。
  - 在代理模式下，slash 文本（如 `/help`）也应作为普通输入转发给 ACP，而不是优先命中本地 Telegram 命令。
  - 仅保留 ACP 控制面命令：`/acp ...`、`/approve ...`、`/deny ...`。
  - 执行 `/acp close` 后，代理模式必须立即退出并恢复到普通 Molibot 对话流。
- Enforcement:
  - `src/lib/server/channels/telegram/runtime.ts` 必须在命令分发前增加 ACP 会话检测中间件，并在满足条件时短路到 ACP 执行流。
  - ACP 代理执行路径应复用现有状态刷新、权限卡片与结果汇总机制，避免单独实现一套不一致的行为。

## 116. ACP 渠道级通用能力 (2026-03-22)
- Priority: P1
- Stage: Delivered (2026-03-22)
- Problem:
  - ACP 现在只在 Telegram runtime 生效，导致“coding 是 Agent 能力而不是某个 bot 能力”这个产品定义落空。QQ 和 Feishu 用户无法使用同样的 ACP 会话、控制命令和默认直通模式。
- Requirement:
  - ACP 必须成为渠道通用能力，至少 Telegram、Feishu、QQ 三个 runtime 都要支持相同的 `/acp`、`/approve`、`/deny` 控制面。
  - 活跃 ACP 会话下的默认直通代理模式不能只存在于 Telegram，Feishu 和 QQ 也必须一致。
  - ACP 任务提示词和帮助文案不能继续绑在 Telegram runtime 内部，应该放到 ACP 公共模块，由各渠道复用。
- Enforcement:
  - `src/lib/server/acp/prompt.ts` 必须承载 ACP 共享提示词/帮助文案/权限提示。
  - `src/lib/server/channels/feishu/runtime.ts` 与 `src/lib/server/channels/qq/runtime.ts` 必须各自持有 `AcpService`，并接入 `/acp`、`/approve`、`/deny` 以及活跃会话默认代理。
  - ACP operator 文档不能再写成 Telegram-only；必须按渠道通用能力描述。

## 117. Weixin ACP 对齐 (2026-03-22)
- Priority: P1
- Stage: Delivered (2026-03-22)
- Problem:
  - 虽然 ACP 已经从 Telegram 扩展到了 Feishu 和 QQ，但 `weixin` runtime 仍停留在普通命令流，导致四个主渠道里只有微信不能进入同样的 coding 会话体验。
- Requirement:
  - Weixin 必须支持与其他渠道一致的 `/acp`、`/approve`、`/deny`。
  - 活跃 ACP 会话下，Weixin 也必须默认把消息直通到 ACP，而不是继续走普通 runner。
  - ACP 文档里的支持渠道列表必须包含 Weixin。
- Enforcement:
  - `src/lib/server/channels/weixin/runtime.ts` 必须持有 `AcpService`，并接入 ACP 命令、权限回传、远端命令和默认直通。
  - `docs/acp-codex-mvp.md` 的 operator 说明必须更新为 Telegram、Feishu、QQ、Weixin 四个渠道。

## 118. ACP 渠道共享控制层 (2026-03-22)
- Priority: P1
- Stage: Delivered (2026-03-22)
- Problem:
  - 虽然 ACP 已经覆盖 Telegram、Feishu、QQ、Weixin，但 `/acp`、`/approve`、`/deny`、默认直通和帮助文案仍分散复制在各自 runtime 里。每新增一个渠道，都要再手抄一整段 ACP 控制逻辑，后续很容易行为再次跑偏。
- Requirement:
  - ACP 的命令解析、授权处理、保留控制命令判断和帮助文案必须抽到渠道共享层。
  - Telegram、Feishu、QQ、Weixin 四个 runtime 都必须改为复用这套共享 ACP 控制器。
  - 未来新增渠道时，ACP 接入应收敛为“渠道只提供收发消息能力，ACP 规则复用公共层”，而不是继续复制整段 `/acp` 路由。
- Enforcement:
  - 新增 `src/lib/server/channels/shared/acp.ts` 作为 ACP 渠道共享入口。
  - 四个现有渠道 runtime 必须通过共享入口处理 ACP 命令、授权命令和活跃会话默认代理的控制判断。

## 119. ACP 新渠道模板化接入 (2026-03-23)
- Priority: P1
- Stage: Delivered (2026-03-23)
- Problem:
  - 即使 ACP 已经有共享控制层，新渠道接入时仍需要手动拼装多段调用，容易让“未来少改”停留在口头上，而不是形成一套可直接套用的模板。
- Requirement:
  - 必须提供一个适合文本型渠道复用的 ACP 接入模板，让未来新增渠道时只需要对接消息收发，而不是再实现一遍 ACP 代理和控制流。
  - 微信、QQ、飞书需要先切到这套模板，验证模板不是纸面设计。
  - ACP 文档要明确写出：未来文本渠道优先复用模板，不要继续复制 `/acp` 逻辑。
- Enforcement:
  - `src/lib/server/channels/shared/acp.ts` 必须提供可复用的渠道 ACP 模板接口。
  - `src/lib/server/channels/weixin/runtime.ts`、`src/lib/server/channels/qq/runtime.ts`、`src/lib/server/channels/feishu/runtime.ts` 必须改为调用该模板。
  - `docs/acp-codex-mvp.md` 必须补充新渠道接入优先复用模板的说明。

## 120. Weixin 入站媒体解析补齐 (2026-03-23)
- Priority: P1
- Stage: Delivered (2026-03-23)
- Problem:
  - 当前 Weixin runtime 只读取旧 SDK 暴露出来的 `message.text`，并且把 `attachments` / `imageContents` 固定写成空数组，所以图片、文件、语音、视频即使已经从微信进来了，也会在 Molibot 入口层被当成“只有文本”甚至“空消息”直接丢掉。
- Requirement:
  - Weixin 必须像 Telegram / Feishu / QQ 一样，把入站图片、文件、语音、视频落成附件，并把图片送进视觉输入链路。
  - 纯附件消息不能再因为没有正文文本就被 runtime 当作空消息忽略。
  - Weixin 文本提取不能只信任旧 SDK 的 `message.text` 占位结果；需要直接从原始 `item_list` 还原真实文本和引用语境。
- Enforcement:
  - `src/lib/server/channels/weixin/runtime.ts` 必须改为从 `raw.item_list` 构造文本、附件和 `imageContents`，而不是把附件硬编码为空数组。
  - Weixin CDN 媒体下载与 AES-ECB 解密必须在 Molibot 侧补齐，至少覆盖图片、文件、语音、视频四类入站附件。
  - `features.md` 必须记录这次 Weixin 媒体解析补齐及验证结果，方便后续回溯。

## 121. Weixin 语音自带文字时跳过二次转写 (2026-03-23)
- Priority: P1
- Stage: Delivered (2026-03-23)
- Problem:
  - 真实 Weixin 语音消息有时会同时带上语音附件和平台原生识别出来的文字。当前 runtime 虽然已经拿到了这段文字，但后续 runner 仍会因为看到音频附件而再走一次 STT，导致重复处理、无意义报错，甚至让模型把已经有答案的问题又折腾一遍。
- Requirement:
  - 当 Weixin 入站语音消息已经自带文字时，Molibot 必须直接信任这段文字，不再对同一条消息做第二次语音转写。
  - 这个跳过规则要尽量精确，只针对“语音项自带文字”的场景，不能误伤其他渠道或“音频 + 额外文本说明”的正常流程。
- Enforcement:
  - `src/lib/server/channels/weixin/runtime.ts` 必须把“这条语音已自带文字”这个事实带进标准消息对象。
  - `src/lib/server/agent/runner.ts` 必须在进入语音转写前检查该标记，并直接复用现有文本。
  - `features.md` 必须记录这次行为收敛，方便后续排查“为什么没再走 STT”。

## 122. pi-ai 升级后 OAuth 入口兼容修复 (2026-03-23)
- Priority: P1
- Stage: Delivered (2026-03-23)
- Problem:
  - 项目升级到 `@mariozechner/pi-ai 0.62.x` 后，运行时仍从旧入口读取 OAuth 登录能力，导致生产构建阶段直接报错，连基础构建都无法完成。
- Requirement:
  - 升级 `pi-ai` 后，Molibot 必须继续支持现有登录与鉴权流程，不能因为上游入口调整而让构建失败。
  - 修复应尽量收敛在鉴权层，不要扩散到聊天、设置或渠道运行逻辑。
- Enforcement:
  - `src/lib/server/agent/auth.ts` 必须改为从 `@mariozechner/pi-ai/oauth` 读取 OAuth 相关能力，同时保留普通 API key 读取逻辑不变。
  - 修复后必须重新通过 `npm run build` 验证，确认升级后的正式构建恢复正常。
  - `features.md` 必须记录这次升级兼容修复，方便后续依赖升级时回溯。

## 123. 升级后工具执行安全层与高风险串行化 (2026-03-24)
- Priority: P1
- Stage: Delivered (2026-03-24)
- Problem:
  - 依赖升级后，底层已经支持工具执行前检查和执行模式控制，但 Molibot 运行时还没有把这层能力真正接起来，导致高风险工具仍可能并发修改文件、切模型、切 MCP，或者直接执行明显危险的命令。
- Requirement:
  - Molibot 必须在工具真正执行前统一拦截危险动作，而不是把安全判断散落到每个工具里。
  - 高风险或会修改系统状态的工具必须串行执行，避免并发写文件、并发切配置、并发调度带来的竞态。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 必须接入统一的工具执行前检查。
  - `src/lib/server/agent/tools/index.ts` 必须对高风险工具增加串行执行包装，而不是继续让所有工具共享默认并发行为。
  - `features.md` 必须记录这次工具安全层与串行化落地。

## 124. 升级后模型职责拆分收紧 (2026-03-24)
- Priority: P1
- Stage: Delivered (2026-03-24)
- Problem:
  - 现有自定义模型挑选逻辑对“文本模型”和“视觉模型”的边界不够严格，文本主对话存在误选到非文本模型的风险，升级后新增的会话与传输能力也没有跟着当前激活模型同步。
- Requirement:
  - 文本主对话、视觉输入、语音转写等不同职责必须走各自匹配的模型路线，不能只靠“默认模型排在前面”碰运气。
  - Agent 的会话标识和传输偏好要跟当前实际使用的模型同步，才能真正吃到升级后的稳定性收益。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 必须按能力标签收紧文本/视觉模型选择和回退。
  - 运行中的 Agent 必须在切换当前模型时同步更新会话标识与传输偏好。
  - `features.md` 必须记录这次模型职责拆分与路由收紧。

## 125. 升级后 Agent 传输与重试上限统一接入 (2026-03-24)
- Priority: P1
- Stage: Delivered (2026-03-24)
- Problem:
  - 升级后 `pi-agent-core` 已支持更细的传输偏好和最长重试等待控制，但 Molibot 只有主运行器接了一部分，其他 Agent 调用点还没有统一使用，导致不同入口的连接行为和卡顿上限不一致。
- Requirement:
  - 所有直接创建 `Agent` 的入口都要复用同一套底层运行参数，避免一个入口走新能力、另一个入口还停在旧默认值。
  - 新增能力必须只做工程层接入，不加入新的业务判断。
- Enforcement:
  - `src/lib/server/agent/runtimeOptions.ts` 必须成为共享的 Agent 运行参数来源。
  - `src/lib/server/agent/runner.ts` 和 `src/lib/server/providers/assistantService.ts` 必须统一接入传输偏好与 `maxRetryDelayMs`。
  - `features.md` 必须记录这次统一接入，方便后续升级时对照。

## 126. Weixin 出站图片与语音媒体补齐 (2026-03-25)
- Priority: P1
- Stage: Delivered (2026-03-25)
- Problem:
  - 当前 Weixin runtime 的 `uploadFile` 只是“文本文件就回文本，否则回一条 `[file] /绝对路径` 提示”，根本没有把图片、语音或其他二进制文件真正上传到微信。所以用户看到的现象就是微信能聊文字，但一到图片和语音回复就失效。
- Requirement:
  - Weixin 必须像 Telegram/Feishu 一样，真正把 agent 产出的图片和附件发回微信，而不是只回本地文件路径。
  - 图片至少要走原生图片消息；音频至少要先尝试原生语音消息，失败时也要退回成可下载文件，不能静默丢失。
  - 这次补齐不能继续依赖当前 `@pinixai/weixin-bot` 只会发文本的表层封装，必须在 Molibot 侧把 CDN 上传和媒体消息发送补上。
- Enforcement:
  - `src/lib/server/channels/weixin/runtime.ts` 的 `uploadFile` 不能再把二进制文件降级成 `[file] ${path}` 文本。
  - `src/lib/server/channels/weixin/` 下必须提供实际的出站媒体上传与发送逻辑，覆盖图片、音频和普通文件三类。
  - `features.md` 必须记录这次根因和出站修复结果，方便后续排查“为什么微信只能回文字”。

## 127. 跨渠道语音格式基线与 Weixin OGG 兼容修复 (2026-03-25)
- Priority: P1
- Stage: Delivered (2026-03-25)
- Problem:
  - 当前 TTS 默认产出的 `ogg/opus` 更偏向 Telegram 语音消息格式，但 Weixin 这条出站链路并不适合直接吃这个格式，导致微信回复语音时要么失败，要么只能退回成普通文件提示。
  - 飞书、Telegram、Weixin、QQ 在“原生语音消息”上的格式能力并不一致，不能假设生成一种文件就能在四个渠道里都显示成原生语音气泡。
- Requirement:
  - Weixin 出站语音必须识别 Telegram 风格的 `ogg/opus` 文件，并在发送前自动转成更适合 Weixin 原生语音的格式，再尝试语音发送。
  - 产品文档必须明确记录当前渠道语音交集并不存在，后续若要统一体验，应按渠道分别做格式适配，而不是继续强推单一源格式。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在语音发送前处理 `ogg/opus -> mp3` 的自动转换。
  - `features.md` 必须记录这次语音兼容修复，方便后续排查“为什么 Telegram 正常而微信不行”。

## 128. Weixin SDK 引用清理与安装修复 (2026-03-25)
- Priority: P1
- Stage: Delivered (2026-03-25)
- Problem:
  - 当前项目为了绕过 `@pinixai/weixin-bot` 已发布包的导出声明问题，直接在业务代码里写了 `../../../../node_modules/...` 这类长相对路径，导致代码难看、难维护，也违背正常依赖使用方式。
  - 如果后续重新安装依赖，之前靠构建配置兜底的特殊处理也容易再次漂移，继续把 SDK 接入搞脏。
- Requirement:
  - 业务代码里的 Weixin SDK 引用必须改成正常的包名导入，不能再出现直接钻进 `node_modules` 的长路径。
  - 项目必须在安装依赖后自动修复这个 SDK 缺失的导出声明，避免每次都靠手工兜底。
- Enforcement:
  - `src/lib/server/channels/weixin/*.ts` 不能再出现 `node_modules/@pinixai/weixin-bot` 的相对路径导入。
  - `package.json` 与配套脚本必须保证重新安装依赖后，Weixin SDK 仍可被正常导入。
  - `features.md` 必须记录这次清理结果，方便后续排查“为什么 import 看起来正常却加载失败”。

## 129. Weixin 旧 SDK 下线与本地桥接迁移 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 旧的 `@pinixai/weixin-bot` 包本身有发布和行为问题，已经不适合作为项目的长期微信依赖。
  - 即使通过补丁或安装后修复把它勉强跑起来，也会让微信通道继续受制于外部坏包，后续维护成本很高。
- Requirement:
  - 项目必须彻底移除 `@pinixai/weixin-bot` 依赖，不再让微信 runtime、媒体收发和登录流程建立在这个旧包之上。
  - 微信通道应改为使用项目内的本地桥接层，桥接逻辑参考新版 `weixin-agent-sdk` 的登录与轮询方式，并继续兼容 Molibot 现有的会话、命令和媒体处理。
- Enforcement:
  - `package.json` / `package-lock.json` 中不能再保留 `@pinixai/weixin-bot` 作为运行依赖。
  - `src/lib/server/channels/weixin/` 必须改为依赖本地 `sdk/` 桥接层。
  - `features.md` 必须记录这次迁移，避免后续误以为微信还绑定在旧包上。

## 130. Weixin 迁移后命令回复字段修正 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 微信切到本地桥接层后，命令回复逻辑里还有一处沿用了旧消息结构，错误地去读 `sender.id`，导致一收到 `/help`、`/new` 这类命令就直接抛错。
- Requirement:
  - 微信命令回复必须统一使用迁移后真实存在的用户标识字段，不能再依赖旧 SDK 才有的对象结构。
- Enforcement:
  - `src/lib/server/channels/weixin/runtime.ts` 的共享命令 `sendText` 入口必须使用 `IncomingMessage.userId`。
  - `features.md` 必须记录这次修正，方便后续排查迁移后“为什么命令一发就崩”。

## 131. Weixin 入站语音/文件密钥兼容修复 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 微信这条入站媒体链路之前把语音和文件写得过于死板：只有在 `media.aes_key` 这个字段按预期出现时才会继续下载，其它合法变体会被直接跳过。
  - 参考 SDK 文档里 `aes_key` 本来就是可选的，而且实际负载里还可能给十六进制的 `aeskey`。这就导致真实用户发来的语音和文件，在 Molibot 里经常被当成“空消息”或“没有附件”。
- Requirement:
  - 入站语音、文件、视频消息不能再强依赖单一密钥字段格式。只要有下载参数，就应该优先尝试正确解密；没有密钥时也要尝试普通下载，而不是静默丢弃。
  - 对于只提供十六进制 `aeskey` 的负载，运行时必须先做格式转换，再走原有解密流程。
- Enforcement:
  - `src/lib/server/channels/weixin/media.ts` 必须把 voice/file/video 的下载逻辑改成“可选 `aes_key` + hex `aeskey` 兼容 + 无密钥普通下载回退”。
  - `features.md` 必须记录这次根因和修复结果，方便后续排查“为什么微信能收图片却收不到语音/文件”。

## 132. 多渠道附件回复能力文案纠偏 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 运行时给模型看的附件发送工具说明还写着“发到 Telegram”，这会把模型误导成别的渠道没有附件回复能力。
  - 在微信会话里，这种误导会直接表现成模型先自己下结论说“图片/语音发不了”，甚至不去尝试真实可用的回复链路。
- Requirement:
  - 附件发送工具的说明必须明确它是“通过当前渠道发送”，不能把 Telegram 写死在通用工具定义里。
- Enforcement:
  - `src/lib/server/agent/tools/attach.ts` 的工具说明必须改成渠道无关表述。
  - `features.md` 必须记录这次修正，方便后续排查“为什么明明有发送能力，模型却先说不支持”。

## 133. Weixin 出站媒体上传诊断增强 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 微信出站图片/语音/文件上传一旦在 CDN 这一步返回空白 `400`，当前日志几乎没有有效线索，无法分辨到底是地址、参数还是上传体格式不对。
- Requirement:
  - 出站媒体上传失败时，日志必须带出足够的现场信息，至少包括源文件、媒体类型、目标主机/路径、上传参数长度，以及明文/密文大小，避免继续在“空 400”上盲猜。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 的 CDN 上传错误必须补充这些诊断字段。
  - `features.md` 必须记录这次增强，方便后续继续定位微信媒体回复失败的真正根因。

## 134. 显式 Skill 调用必须走共享硬约束 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 当前显式 `/skill-name` 调用虽然能在共享层识别出来，但只向模型注入一个轻量的技能名字和路径标记，仍然允许模型临场违背规则，跳过 skill 自己乱用通用工具。
  - 这会制造“像是某个渠道命令识别坏了”的错觉，但根因其实是共享执行层对显式 skill 的约束不够硬。
- Requirement:
  - 只要用户明确点名某个 skill，共享 runner 就必须把该 `SKILL.md` 的实际内容一起注入当前回合，而不是只传名字和路径。
  - 这个约束必须对 Telegram、Weixin、Feishu、QQ 一视同仁，不能再让某个渠道靠模型运气是否听话。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 必须在显式 skill 调用时注入 `[explicit skill file]` 内容块。
  - `src/lib/server/agent/prompt.ts` 必须明确 `[explicit skill file]` 是本轮已加载且必须优先遵循的技能上下文。
  - `features.md` 必须记录这次修正，方便后续排查“为什么明明识别出了 skill，却还是没真正执行”。

## 135. 图片 Skill 输出目录与 Bash 日志压缩修正 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 图片 skill 之前没有把输出目录约束说死，模型会把图片写到 `/tmp` 或 skill 目录，随后被路径保护或附件发送流程卡住。
  - bash 工具对长输出只保留最后一段，像 `curl` 这种先输出关键诊断、后面再刷进度条的命令，会把真正有用的信息挤掉，形成“截断得很离谱”的体感。
- Requirement:
  - 图片生成 skill 必须明确要求输出文件位于当前聊天工作目录，不能写到 `/tmp`，也不能写回 skill 目录。
  - bash 长输出必须改成保留开头和结尾，并尽量清掉重复的进度条噪音，而不是只留尾巴。
- Enforcement:
  - `/Users/gusi/.molibot/skills/image-generate/SKILL.md` 必须写明输出目录规则和正确命令格式。
  - `src/lib/server/agent/tools/bash.ts` / `truncate.ts` / `helpers.ts` 必须实现更合理的输出压缩。
  - `features.md` 必须记录这次修正，方便后续排查“为什么图片明明生成了却发不出去”以及“为什么 bash 日志看不见结论”。

## 136. 共享 Skill 禁止硬编码本机绝对路径 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 共享 skill 一旦写死某个人机器上的绝对路径，别的用户拿去就不能直接用，等于把本该复用的 skill 绑死在单机环境里。
- Requirement:
  - 共享 skill 必须通过“调用方传参”或“相对 skill 目录定位”的方式工作，不能把本机绝对路径直接写进示例和规则里。
- Enforcement:
  - `/Users/gusi/.molibot/skills/image-generate/SKILL.md` 必须改成由调用方显式传入输出路径。
  - `features.md` 必须记录这次修正，方便后续排查“为什么 skill 到别人机器上就不能用”。

## 137. Weixin 出站上传参数必须可完整审计 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 当前微信媒体上传失败时，即使已经知道文件路径和大小，仍然看不到完整实参，无法判断是 `getuploadurl` 请求体错了，还是 CDN 上传时 query/header/body 形状不对。
- Requirement:
  - 本地日志必须能完整还原这次上传的关键实参，包括申请上传地址的请求体、返回的上传参数、最终 CDN 请求地址与请求头，以及原始响应内容。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在本地日志中输出这些完整诊断信息。
  - `features.md` 必须记录这次增强，方便后续继续定位微信图片/语音/文件回复失败。

## 138. Weixin CDN 上传必须严格按协议字段执行 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 微信 CDN 上传之前没有严格照协议实现，把核心查询参数名传成了错误字段，还按 JSON body 取返回值，导致即使本地文件正常也会在 CDN 这一步直接吃空白 `400`。
- Requirement:
  - CDN 上传必须使用协议要求的 `encrypted_query_param` 查询参数。
  - 成功上传后的媒体标识必须优先从响应头 `x-encrypted-param` 读取，不能假设响应 body 一定是 JSON。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须按协议修正上传 URL 和返回值读取方式。
  - `features.md` 必须记录这次修正，方便后续排查“为什么文件存在但微信仍然回空 400”。

## 139. Weixin 必须明确依赖第三方 SDK 底层 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 仓库里已经有第三方 `weixin-agent-sdk`，但微信通道看起来仍像是在继续维护一套自己的独立 SDK，目录归属和依赖边界都不清楚。
  - 这样会让后续维护方向继续漂移，也会让外部看起来像是 Molibot 又养了一套自研微信底层。
- Requirement:
  - 微信通道必须明确把 `package/weixin-agent-sdk` 当作第三方底层来源。
  - 项目内保留的微信代码只能承担当前运行时兼容和统一 Agent 适配，不再继续充当一套自研微信 SDK。
  - README 必须显式说明 `package/weixin-agent-sdk` 的第三方身份和用途。
- Enforcement:
  - `src/lib/server/channels/weixin/sdk/` 必须缩成兼容转接层，并直接复用 `package/weixin-agent-sdk` 的登录流程和协议类型。
  - `README.md` 必须声明 `package/weixin-agent-sdk` 是 vendored 第三方包。
  - `features.md` 必须记录这次边界调整，避免后续又把这层误当成自研 SDK 继续扩张。
  - 业务代码里不得再通过超长相对路径直接引用 `package/weixin-agent-sdk`；必须使用统一别名入口，避免后续构建和迁移继续出问题。

## 140. Weixin 出站图片不能再显示灰色占位图 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 现在图片上传到 CDN 已经成功，但微信里收到的仍然只是灰色占位，不是真图。这说明问题不在文件路径或 CDN 上传，而在后续 `sendmessage` 里塞回去的媒体描述字段。
  - 协议要求的 `aes_key` 出站编码格式和当前实现不一致时，客户端会拿到文件引用却无法正确解图，表现就是一张不能点开的假图。
- Requirement:
  - 微信出站图片、语音、文件消息里使用的媒体解锁字段必须严格按协议要求编码，不能再沿用入站解密时那种“另一种也能兼容”的写法。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须统一按协议要求编码出站 `aes_key`。
  - `features.md` 必须记录这次修正，方便后续排查“为什么 CDN 200 了但微信里仍然是灰图”。

## 141. Weixin 音频回复不能再退回成死文件附件 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 当前有些音频格式例如 `AIFF/AIF` 没被识别成语音消息候选，结果运行时直接走了文件上传，微信里只收到一个不能播放的附件，而不是语音气泡。
- Requirement:
  - 只要输入本质上是音频，就应该优先走语音消息链路；对微信不直接支持的音频格式，应先转成可发送语音的格式，而不是直接降级成文件。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须把 `AIFF/AIF` 之类音频纳入语音判断，并在需要时先转码再发送语音消息。
  - `features.md` 必须记录这次修正，方便后续排查“为什么明明是音频却只收到文件附件”。

## 142. Weixin 语音消息必须带完整播放元信息 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 当前出站语音虽然已经走到 `media_type=4` 上传，但发送消息时只带了最基础的语音字段，缺少时长、采样率、位深这些播放元信息，客户端可能直接忽略语音气泡，只留下前面的文字。
- Requirement:
  - 出站语音消息必须尽量补齐播放元信息，至少包括 `playtime`、`sample_rate`、`bits_per_sample`。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在发送语音前读取音频元信息并写入语音消息。
  - `features.md` 必须记录这次修正，方便后续排查“为什么上传成功了却只显示文字”。

## 143. Weixin 回复语音不能再伪装成 mp3 语音 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 当前环境没有 SILK/AMR 编码器，而 vendored SDK 里的 `silk-transcode.ts` 只负责把入站 SILK 解码成 WAV，不能反向生成出站 SILK。
  - 在这种情况下把所有待发送音频一律转成 `mp3` 并标成微信语音，兼容性并不稳，容易出现“上传成功了，但客户端不显示语音气泡”的情况。
- Requirement:
  - 对无法直接作为微信语音发送的音频，必须优先转成协议里更基础的 PCM/WAV 语音形式，而不是继续伪装成 `mp3` 语音。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须把通用音频转成单声道 24k WAV/PCM 后再走语音消息链路。
  - `features.md` 必须记录这次修正，方便后续排查“为什么日志里看着像语音，客户端却不认”。

## 144. Weixin 语音失败回退时也必须把音频真正发出去 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 在当前环境无法产出微信稳妥原生语音格式时，如果仍硬发“伪语音消息”，客户端可能把语音部分直接忽略，只剩一段文字。
- Requirement:
  - 这类情况下不能让结果静默丢失。即便退回，也必须把音频作为附件真正发给用户，而不是只留文字说明。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在无法可靠构造原生语音消息时，回退到真实音频文件发送。
  - `features.md` 必须记录这次修正，方便后续排查“为什么看起来发了语音，用户却只看到文字”。

## 145. Weixin 出站语音应携带语音转文字结果 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 协议允许 `VOICE` 消息携带 `text` 字段，作为语音转文字结果。但当前发送链路没把这项带上，导致语音回复就算成功，也缺少与协议一致的文本结果承载。
- Requirement:
  - 出站语音消息应补齐 `voice_item.text`，把本轮用于朗读的文字结果一起带上。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在语音消息里写入 `voice_item.text`。
  - `features.md` 必须记录这次修正，方便后续继续对齐协议字段。

## 146. Weixin 回复语音必须具备真实 SILK 编码能力 (2026-03-26)
- Priority: P1
- Stage: Delivered (2026-03-26)
- Problem:
  - 仅靠补字段或把音频伪装成 `mp3`/`wav` 语音，客户端兼容性仍然不稳。要稳定命中微信原生语音气泡，需要真正产出更贴近微信生态的 `SILK` 音频。
- Requirement:
  - 项目必须引入可用的 SILK 编码能力，把通用音频先整理成 24k 单声道 WAV，再编码成 `.silk` 后发送给微信。
- Enforcement:
  - `package.json` 必须包含 `silk-wasm` 依赖。
  - `src/lib/server/channels/weixin/outbound.ts` 必须使用 `silk-wasm` 进行出站 SILK 编码。
  - `features.md` 必须记录这次修正，方便后续排查“为什么语音上传成功了但还不是微信原生语音”。

## 147. Telegram 短暂网络错误应显著增加重试次数 (2026-03-27)
- Priority: P1
- Stage: Delivered (2026-03-27)
- Problem:
  - 当前 Telegram 发送链路在 `ECONNRESET`、`socket hang up` 这类短暂网络抖动下只会重试很少几次，容易过早把一次本可恢复的发送判成失败。
- Requirement:
  - Telegram 发送相关操作，尤其是 `sendChatAction`，必须拥有更高的重试预算，至少覆盖 5 次以上的尝试。
- Enforcement:
  - `src/lib/server/channels/telegram/formatting.ts` 必须把发送重试次数提高到不少于 5 次。
  - `features.md` 必须记录这次修正，方便后续排查“为什么只是瞬时网络抖动却直接失败了”。

## 148. Weixin 语音回复不能混入标题文字且必须校验真实发送结果 (2026-03-27)
- Priority: P1
- Stage: Delivered (2026-03-27)
- Problem:
  - 当前 `attach` 工具传入的标题会被当成语音说明文字，先单独发成一条文本，再塞进 `voice_item.text`。这样一来，用户可能先看到一小段标题字，日志和回环解析也会把它误判成纯文字，看起来像“根本没发语音”。
  - 同时，发送消息这一步只检查了 HTTP 是否成功，没有检查微信返回的 `ret/errcode`。结果可能是标题文字发出去了，但真正的语音已被微信拒绝，代码却误以为成功。
- Requirement:
  - 微信语音回复必须只走真正的语音消息形态，不能再把附件标题混成单独文本或伪装成语音转文字内容。
  - 发送消息必须严格检查微信业务返回值，只要微信明确拒绝，就必须立刻报错，不能静默吞掉。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须在语音消息路径禁用标题文本前置发送，也不能再把附件标题写入 `voice_item.text`。
  - `src/lib/server/channels/weixin/sdk/api.ts` 必须把 `/ilink/bot/sendmessage` 的 `ret/errcode` 当成真实成功判定的一部分。
  - `src/lib/server/channels/weixin/outbound.test.ts` 必须覆盖“只发单条语音项”和“微信业务失败要抛错”这两个场景。
  - `features.md` 必须记录这次修正，方便后续排查“为什么看到标题字却没有语音气泡”。

## 149. Weixin 语音消息体必须同时带上 hex aeskey 与媒体引用，避免静默消失 (2026-03-27)
- Priority: P1
- Stage: Delivered (2026-03-27)
- Problem:
  - 现场日志显示，去掉单独标题文字后，用户端直接变成“什么都没有”。这说明当前问题不只是标题串台，还可能是媒体消息体本身缺少某个微信侧更偏好的字段，导致语音被静默吃掉。
  - 本地入站解析已经兼容 `voice_item.aeskey/file_item.aeskey/image_item.aeskey` 这类 hex 字段，但出站消息此前只带了 `media.aes_key`，两边并不对称。
- Requirement:
  - 出站媒体消息除了 CDN 引用外，还应同时补上 hex 形式的 `aeskey`，尽量贴近微信现网消息形态，降低“上传成功但客户端完全不显示”的概率。
  - 语音标题不能再单独作为文本发出，但可以保留在语音项内部，避免再次出现只看到标题字、看不到媒体本体的回退体验。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须为 image/file/voice 的消息体补上 hex `aeskey` 字段。
  - `src/lib/server/channels/weixin/outbound.ts` 必须记录本次实际走的是 `voice` 还是 `file` 路径，方便后续对照真实微信表现。
  - `features.md` 必须记录这次修正，方便后续排查“为什么这次连标题字都没有了”。

## 150. Weixin 语音消息的可见文字必须优先使用全文 (2026-03-27)
- Priority: P1
- Stage: Delivered (2026-03-27)
- Problem:
  - 之前语音附件只有一个短标题，像“笑话语音”“天气语音”。一旦语音本体没有正常显示，用户看到的就只有几个没意义的字，根本无法知道原本要说什么。
- Requirement:
  - 发送语音时，可见文字必须优先使用完整台词全文，而不是附件标题。
  - 短标题仍可保留给文件名或内部展示，但用户侧看到的应是完整内容，至少在语音显示异常时还能直接看文字。
- Enforcement:
  - `src/lib/server/agent/tools/attach.ts` 必须支持显式传入语音全文。
  - `src/lib/server/channels/weixin/outbound.ts` 必须优先把这份全文写入语音消息的文字部分；没有全文时才退回标题。
  - `src/lib/server/channels/weixin/outbound.test.ts` 必须覆盖“全文优先于标题”的场景。
  - `features.md` 必须记录这次修正，方便后续排查“为什么用户只看到一个短标题”。

## 151. Weixin 音频回复改为“全文文字 + MP3 附件”双消息模式 (2026-03-27)
- Priority: P1
- Stage: Delivered (2026-03-27)
- Problem:
  - 现场验证表明，微信当前这条通道并不能稳定显示所谓的语音消息。继续拼语音气泡只会出现“日志看着成功，用户端什么都没有”。
- Requirement:
  - 微信收到需要语音回复的场景时，不再尝试发送原生语音消息。
  - 统一改成两条回复：
    第一条发完整文字内容。
    第二条发一个真正可下载的 `MP3` 附件。
- Enforcement:
  - `src/lib/server/channels/weixin/outbound.ts` 必须停用当前原生语音消息发送分支。
  - `src/lib/server/channels/weixin/outbound.ts` 必须把所有音频统一转成或保留为 `MP3` 附件发送。
  - `src/lib/server/channels/weixin/outbound.ts` 必须先发全文文字，再发附件，不能再只发标题。
  - `src/lib/server/channels/weixin/outbound.test.ts` 必须覆盖“双消息：文字 + MP3 附件”的场景。
  - `features.md` 必须记录这次修正，方便后续排查“为什么微信里没有语音气泡但仍能正常收到内容”。
