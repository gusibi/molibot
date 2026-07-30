# Molibot handoff — Sandbox fail-closed

Date: 2026-07-30 (Asia/Shanghai)

## Current state

The approved Sandbox fail-open remediation is complete and verified. The repository worktree was clean when this handoff was generated.

Do not reimplement the change. Start by reading the existing records and current source:

- Implementation plan and verification gates: `/Users/gusi/Github/molipibot/task_plan.md` → `Sandbox fail-closed hardening (2026-07-30)`
- Investigation conclusions: `/Users/gusi/Github/molipibot/findings.md` → same section
- Execution and verification log: `/Users/gusi/Github/molipibot/progress.md` → same section
- Product decision and acceptance criteria: `/Users/gusi/Github/molipibot/prd.md` → `3.20 Fail-closed Agent Bash sandbox`
- Release/user-facing records: `/Users/gusi/Github/molipibot/CHANGELOG.md`, `features.md`, `readme.md`
- Long-term regression rule: `/Users/gusi/Github/molipibot/CLAUDE.md` → Recurring Pitfall 13

## Delivered behavior

- When Sandbox is enabled, unsupported platforms, missing dependencies, or provider initialization failures block Bash instead of executing the original command on the host.
- The blocked result is observable as `sandbox_unavailable` / `Sandbox blocked`.
- Explicit Sandbox-off and approved Host Bash remain the only intentional host-execution paths.
- Persisted legacy `warn-disable` values normalize to `block`.
- Defaults use minimal environment inheritance; Build presets use an allowlist.
- Web and Desktop no longer expose the fail-open option.
- Main Agent and built-in Subagents cross the same shared enforcement seam.

Primary code entry points:

- `/Users/gusi/Github/molipibot/src/lib/server/agent/tools/sandbox.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/agent/tools/bash.ts`
- `/Users/gusi/Github/molipibot/src/lib/server/settings/toolSandbox.ts`
- `/Users/gusi/Github/molipibot/src/routes/settings/sandbox/+page.svelte`
- `/Users/gusi/Github/molipibot/apps/desktop/src/lib/settings/SandboxSection.svelte`

## Verification already completed

- Agent tests: 540/540
- Desktop UI/TypeScript tests: 102/102
- Desktop Rust tests: 26/26
- Desktop `svelte-check`: 0 errors, 0 warnings
- Web and Desktop production builds passed
- Temporary SQLite save → fresh store → load regression passed
- Isolated cold path passed: first open → switch settings page → stop/restart service; values remained `block` and `minimal`
- `git diff --check` passed

The successful full Agent command required an isolated absolute `HOME`/database and serial test execution. The repository `.env` contains a `DB_DIR` override, so future isolated runs must override both the data/home location and database location to avoid touching real runtime data. Do not copy machine-specific paths into source or documentation.

## Next-session guidance

There is no known unfinished implementation from this request. If the next session is a review or release session:

1. Confirm `git status --short` before acting.
2. Inspect the referenced records/diff or commit rather than repeating the investigation.
3. Preserve the security invariant: enabled means sandboxed or blocked.
4. Treat any proposal that returns the raw command after sandbox failure as a release-blocking regression.
5. Keep Host Bash approval behavior distinct from implicit fallback.

Potential follow-up, only if explicitly requested: broader containment for MCP/browser/ACP tools. That was intentionally out of scope; this change hardens Bash execution only.

## Suggested skills

- `agent-runtime-debug-review` — for any follow-up audit of sandbox, Host Bash approval, main/Subagent execution, Trace, or runtime error propagation.
- `tdd` — for any regression or behavioral modification; begin from a public-interface failing test.
- `codebase-design` — if changing the shared sandbox/host-execution boundary rather than making a local fix.
- `release` — only if asked to version, tag, or publish these completed changes.
- `diagnosing-bugs` — if a real platform reports a new sandbox startup or execution failure.

## Safety notes

- No credentials or user data are included in this handoff.
- Do not run persistence tests against the user's normal settings database.
- Do not weaken the migration merely because the public type still accepts the legacy `warn-disable` literal; compatibility input is intentionally normalized to `block`.
