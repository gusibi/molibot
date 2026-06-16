# Findings

## Source Material To Review

- `CHANGELOG.md`
- `features.md`
- `prd.md`
- `README.md`
- Existing `docs/` topic folders
- Representative `src/lib/server/agent`, `src/lib/server/channels/shared`, channel runtimes, approval, provider routing, settings APIs and pages

## Key Findings

- Product direction: Molibot has evolved from a V1 multi-channel assistant into a local-first, multi-channel Agent runtime with profile-driven prompts, tool governance, sandbox/approval, trace observability, scheduled tasks, and built-in media/search tools.
- Major shipped themes from `CHANGELOG.md` / `features.md` / `prd.md`:
  - Multi-channel runtime and shared channel layer: Web, Telegram, Feishu, Weixin, QQ, CLI.
  - Runtime lifecycle: `TurnOrchestrator`, runner pool, session locks, run summaries/details, stop/cancel, approval waiting states.
  - Sandbox and Host Bash approval: command classification, blocking approval gate, fallback inheritance, idempotent approvals.
  - Tool hardening: read/write/edit/bash guardrails, path safety, binary/image limits, literal replacement bugs, CRLF preservation.
  - Prompt/profile governance: system prompt boundary refactor, operator profile priority, safety floor, volatile sections last for prompt caching.
  - HookManager and trace: observe/gate/transform hooks, SQLite trace facts, skill usage facts, runtime logs.
  - Built-in deferred tools: webSearch, imageGenerate, videoGenerate, ttsGenerate.
  - Settings system: SQLite dynamic settings, fine-grained APIs, i18n, design system, fixed footbar.
  - Scheduled tasks: watched event JSON, runtime event system, fresh task sessions, cleanup, leases/retries.
  - Multi-channel rendering: Telegram chunk reuse, Feishu CardKit markdown/table/code rendering, video media handling.
  - Skills/subagents: multi-scope skills, skill usage tracing, subagent telemetry and delegated run visibility.

## Implementation Anchors

- Runtime lifecycle and concurrency:
  - `src/lib/server/agent/core/turnOrchestrator.ts`: SQLite `runs` table, session lock, stale lock cleanup, run status updates, memory prep/commit hooks.
  - `src/lib/server/agent/core/runner.ts`: model/tool loop, HookManager emission, tool budget notices, skill tracing fields, model attempt tracking.
  - `src/lib/server/channels/shared/baseRuntime.ts`: shared channel execution path, fresh event sessions, `/stop`, approval auto-resume retry, runner pool.
  - `src/lib/server/channels/shared/inboundCoordinator.ts` and `persistentTaskQueue.ts`: channel-agnostic queue operations exposed to commands.
- Tool governance and sandbox:
  - `src/lib/server/agent/tools/toolRuntime.ts`: workspace whitelist, policy decisions, approval waiting loop, debounce aggregation.
  - `src/lib/server/agent/tools/bashPolicy.ts`: file read/write/edit shell redirects denied in favor of structured tools.
  - `src/lib/server/agent/tools/sandbox.ts`: sandbox provider abstraction, env allow/deny injection, diagnostics.
  - `src/lib/server/approval/approvalStore.ts`: SQLite-backed requests/grants.
- Prompt/profile/session:
  - `src/lib/server/agent/prompts/prompt.ts`: operator directives above system prompt, safety floor, injection scan, pipeline, volatile prompt sections.
  - `src/lib/server/agent/prompts/profiles.ts`: global/agent/bot profile file definitions and safe write normalization.
  - `src/lib/server/agent/core/runtimeNotices.ts`: transient notices stripped from persistent model context.
  - `src/lib/server/agent/session/compaction.ts`: context summarization with fallback.
- Observability:
  - `src/lib/server/agent/hooks/manager.ts`: observe/transform/gate separation, fail-closed gates, per-run observe tails, plugin lifecycle.
  - `src/lib/server/agent/hooks/traceRecorderHook.ts`: event sanitization, fact upserts, skill usage confidence levels, stale run sweep.
  - `src/lib/server/agent/hooks/traceStore.ts`: `agent_trace_events` and `agent_trace_facts`.
  - `src/routes/api/settings/trace/+server.ts`: trace stats aggregation including skill usage.
- Deferred/media tools:
  - `src/lib/server/agent/search/webSearchTool.ts`: route-based search, engine fallback, citations, diagnostics.
  - `src/lib/server/agent/imageGenerate/imageGenerateTool.ts`: provider selection, artifact path guard, SQLite task logging, upload failure separation.
  - `src/lib/server/agent/videoGenerate/videoGenerateTool.ts`: async task flow, JSON/string image normalization, public URL validation, remote URL cache.
  - `src/routes/api/settings/dynamic/[key]/+server.ts`: focused dynamic settings endpoint.
- Channel rendering and events:
  - `src/lib/server/channels/feishu/cardkit.ts` and `formatting.ts`: final card markdown block splitting, native tables, fenced code protection.
  - `src/lib/server/channels/telegram/formatting.ts`: chunked text delivery, edit fallback, message id reuse.
  - `src/lib/server/agent/eventsLeaseStore.ts`: watched-event runtime leases, retry, timeout, abort.

## Article Series Shape

- Avoid duplicating internal docs. Each article should be written as a public-facing engineering story.
- Recommended structure per article:
  - Problem that appeared in real use.
  - Why the naive implementation failed.
  - Design constraints and tradeoffs.
  - Final architecture and important code paths.
  - Pitfalls/regressions/tests.
  - Takeaways that apply to other Agent projects.
- Follow-up adjustment: the series should read as a systematic tutorial, not only a topic library. Added a 00-series foundation layer covering the full Agent service map, chatbot vs Agent service, minimal run loop, runtime object model, tool-calling fundamentals, and context/memory/persistence boundaries.
- Added curriculum/project scaffolding so the series can be consumed as a course:
  - `CURRICULUM.md`: staged learning goals, reading order, exercises, acceptance criteria.
  - `PROJECT-ROADMAP.md`: V0-V9 practical build path from CLI Agent to token-aware Agent system.
- User requested removing topics 16/17/18 because settings UI/dynamic config/local-first data layout felt less directly related to Agent development. Replaced them with `16-token-saving-agent-systems.md`, focused on `publishHtml(filePath)`, Markdown DSL via `momo-paper`, and scheduled task fresh sessions.
- Follow-up request: restore the missing advanced/productization topics, but keep the tutorial as a serial publication path rather than only a numbered file list. Added five article outlines:
  - `17-model-routing-and-provider-abstraction.md`
  - `18-runtime-control-commands.md`
  - `25-multimodal-agent-input-output.md`
  - `26-agent-settings-and-operations.md`
  - `27-agent-deployment-and-maintenance.md`
- Publishing decision: keep existing file names to avoid breaking links, and add an explicit 33-part serial publication table in `docs/agent-dev-series/README.md`.
