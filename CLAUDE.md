# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is **Molipibot** — a multi-channel bot framework with a settings UI. See [AGENTS.md](AGENTS.md) for the full set of collaboration rules, architecture boundaries, and coding conventions.

**Always read and follow [AGENTS.md](AGENTS.md)** before making any changes. It is the single source of truth for:

- Role & collaboration style (technical co-founder model)
- Architectural layering rules (Channel vs Agent vs shared upper logic)
- File update workflow (features.md, prd.md, CHANGELOG.md, README.md)
- Prompt/session hygiene (temporary control directives must not persist)
- Frontend rules (Shadcn-first, see also DESIGN.md for styling)
- Path & doc hygiene conventions

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Long-term collaboration rules & architecture boundaries |
| `DESIGN.md` | UI design system, component specs, CSS conventions |
| `prd.md` | Planned features, priorities, acceptance criteria (recent only; archived in `docs/archive/prd-archive-*.md`) |
| `features.md` | Delivered features, implementation log (recent only; archived in `docs/archive/features-archive-*.md`) |
| `CHANGELOG.md` | High-level release notes (recent only; archived in `docs/archive/changelog-*.md`) |

## Quick Rules

- Layer separation: Channel layer is **messaging only**; shared upper logic (queues, recovery, task orchestration) must not leak into channels.
- Frontend: use Shadcn components from `src/lib/components/ui`. Custom app-level styles must use semantic class names (see DESIGN.md).
- **All toggle/switch controls must use `IosSwitch`** (from `$lib/components/ui/ios-switch`). Do NOT use the generic `Switch` component — its styling does not clearly convey an on/off state. `IosSwitch` provides the expected iOS-style toggle appearance.
- Never hard-code absolute paths (`/Users/...`) into code, docs, or prompts.
- After any feature change, update `features.md` and `CHANGELOG.md`. (Old entries in `prd.md` / `CHANGELOG.md` / `features.md` are archived quarterly in `docs/archive/`).
- Bug fixes: BEFORE debugging, search `CHANGELOG.md` (+ archives) and the pitfalls below for prior occurrences of the same symptom/surface. BEFORE merging, answer the "Fix 收尾三问" in AGENTS.md §开发流程沉淀规则 (root-cause class → machine guard → pitfall entry). A second occurrence of the same root-cause class makes a machine guard mandatory.
- No band-aid-then-root-fix: if a fix needs caller-side gating/special-casing instead of a shared-layer solution, either do the root fix now or file it in `prd.md` with the band-aid's removal condition.

## Recurring Pitfalls (distilled from CHANGELOG.md / prd.md — read BEFORE touching these areas)

Each item below caused **multiple** shipped bugs. Check the relevant one before writing code.

1. **Session-list leakage** (fixed 4+ times): any surface that lists conversations (sidebar, browser dialog, external `contexts/` projection, more-conversations dialog) MUST filter out automation sessions — `origin: "automation"`, `task-*` session keys, legacy `[EVENT:...]` first-message sessions — and keep only `purpose === "conversation"`. Do the filtering in the shared query layer (`src/lib/server/app/desktopConversations.ts` / `externalSessionsFromContexts.ts`), never per-channel or in UI.
2. **Svelte 5 reactivity** (fixed 3+ times): a legacy `$:` derivation does NOT subscribe to runes `$state` from another module — it runs once and goes stale (symptom: blank on first open, works after a round-trip). New components use runes (`$props`/`$state`/`$derived`); legacy surfaces read live controller state only through its `view` store (`$conversationView` pattern). Never call a no-arg helper from a template and expect its internal state reads to be tracked — pass deps explicitly. Never trigger the same async load from both `onMount` and a `$:` block (they race on init). Corollary (fixed 2+ times, symptom: the composer advertises the global default model while the runtime uses the session's own): a `$:` reading a `toStore` projection re-runs on EVERY store tick because the projection returns a fresh object — gate such loads on the value actually changing (`if (x && x !== lastX)`), and never let a refresh handler reset per-session state (model/thinking selection) to a global default unconditionally. Guarded by `apps/desktop/src/chat-ui.test.mjs`.
3. **Stale async responses** (fixed 2+ times): list/transcript/detail fetches must carry a request generation plus owner IDs (projectId/sessionId) and be validated before mutating visible state; a late response must never replace the currently selected session.
4. **CSS token drift**: referencing an undefined `var(--token)` or keyframe fails silently (no error, just broken styling — e.g. `--shadow-card`, `animation: spin`). Desktop app uses Geist tokens per `DESIGN.vercel.md`; verify a token exists before using it, and snap sizes/spacing to the Geist scale (no 13.5px, no ad-hoc shadows outside the 3 elevation tiers).
5. **Path validation vs. external IDs**: external channel identifiers legitimately contain `@ : + %` (e.g. WeChat `...@im.wechat`). Don't tighten segment/path validation without covering these; conversely, never expose absolute host paths, secrets, or saved API keys to the WebView — return opaque IDs and replace/clear semantics for credentials.
6. **Reuse shared modules, no forked copies**: session rows use `ConversationRow`, composers use `ChatInputArea`, completed messages use the shared transcript renderer, turn logic goes through `ConversationController` with a host adapter. Generic shared components must not contain project/channel conditionals — callers inject differences.
7. **CJK handling**: any tokenizer, relevance scorer, or token estimator must handle Chinese explicitly (whitespace splitting collapses CJK to one token; chars/4 under-counts CJK ~3-4x and silently disabled compaction). Use `package/mory/src/moryTokenize.ts` for keyword scoring; weight CJK chars ≈ 1 token when estimating.
8. **Verification convention**: desktop UI changes = `svelte-check` 0 errors/0 warnings + `vite build` + desktop UI tests; agent/runtime changes = agent test suite + `tsc` on touched files. State the results in `CHANGELOG.md` entries.
9. **Cold-start smoke walk** (many shipped bugs were "first open blank / first click dead / reset after restart" — tests and builds passed): after UI/desktop changes, additionally exercise the real cold path — restart the service, first-open/first-click every affected pane, switch sessions, and recover from a service interruption — before claiming done.
10. **Settings round-trip** (fixed 2+ times): every new/changed settings field needs a save → fresh store → load round-trip regression against a temporary database; narrow serialization silently resets fields on restart.
11. **Out-of-band execution must reuse the in-run context**: an approved Host Bash command can execute from two places — inside the run (`bash.ts`, which holds the agent's real `ctx.cwd`) or from an approval handler after the run ended (`/api/chat` `_handleWebHostToolsCommand`, `baseRuntime`). The out-of-band callers must resolve cwd/project/model through the same helpers the runner uses (`resolveSessionWorkingDir`, `buildRunnerProjectContext`), never re-derive them; picking the chat scratch dir made a project session's `git push` fail with "not a git repository". Guarded by `src/lib/server/agent/hostBashExecContext.test.ts`. Corollary: when the out-of-band path fails, it must still rewrite the suspended toolResult and resume — a failure that only exists in an HTTP response body reaches neither the user nor the agent, and reads as "the button did nothing".
12. **Desktop settings invalidation** (fixed 2+ times): Settings and Chat share one WebView, so a successful Provider/Agent/Profile/model mutation must publish the shared same-document settings event; do not rely on `BroadcastChannel` for local cache freshness. A consumer that is connecting or already refreshing must retain one pending refresh and replay it after settlement instead of dropping the event. Guard the real save → Chat selector seam whenever a settings mutation changes model options.
13. **User cancellation is not an error, and Stop is not a queue reset** (Issue #24): an aborted request's rejection shape is transport-specific — Tauri's HTTP plugin throws a plain `Error("Request cancelled")`, `fetch` throws a `DOMException("AbortError")`, and the server may emit an SSE `error` frame before the client aborts at all. Decide "was this cancelled" from the *intent* flag plus the shared `apps/desktop/src/lib/chat/turnAbort.ts` helper, never from one error class. Equally, Stop ends the current turn only: it must not silently discard queued follow-ups (drain them once the aborted turn has unwound), and a running turn must always offer a way to inject a queued message (`/api/stream/steer` → shared `RunnerPool.steer`) rather than only wait. Guarded by `apps/desktop/src/lib/chat/turnAbort.test.ts`, `src/routes/api/stream/steer/server.test.ts`, and the queue/steer structural guard in `apps/desktop/src/chat-ui.test.mjs`.
14. **Enabled sandbox must fail closed**: unsupported platforms, missing dependencies, and provider initialization errors must never return the original Bash command or inherit the host environment. The shared Agent/Subagent sandbox boundary either produces a sandboxed command or a structured blocked result. Host execution is legal only after explicit sandbox disable or through the Host Bash approval path. Persisted legacy `warn-disable` values must normalize to `block`; guard provider-unavailable execution and settings round-trip behavior with machine tests.
