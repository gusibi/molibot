# Findings & Decisions

## Requirements
- Add OS-level sandbox support for Agent shell execution only.
- Keep sandbox disabled by default.
- Soft-disable and warn when sandbox initialization fails.
- Load skill/API environment variables from a workspace env file and inject only allowed keys.
- Prevent sandboxed bash from directly reading the env file.
- Add full Settings UI and diagnostics for sandbox policy.
- Update project documentation after implementation.

## Research Findings
- Main Agent `bash` is implemented in `src/lib/server/agent/tools/bash.ts` and currently calls `execCommand`.
- `execCommand` currently merges `process.env` into all child processes.
- Subagents create their own bash tool in `src/lib/server/agent/tools/subagent.ts`; sandbox must be passed there explicitly.
- Runtime settings are typed in `src/lib/server/settings/schema.ts`, defaulted in `defaults.ts`, and sanitized in both `settings/store.ts` and `app/runtime.ts`.
- Settings already uses shadcn-svelte components under `src/lib/components/ui`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Keep `execCommand` default env inheritance | Avoid changing read/write/edit and unrelated shell helpers. |
| Add an explicit non-inheriting exec option for sandbox bash | Prevent full host env leakage when sandbox is active. |
| Store `toolSandbox` in static settings JSON | It is stable runtime policy, not high-churn dynamic domain data. |
| Use workspace-relative `.env.sandbox.local` by default | Matches user preference and avoids machine-specific absolute paths in defaults. |
| Never return env values from diagnostics | Diagnostics should expose key names/status only. |
| Do not parse workspace env files when sandbox is disabled | The default-off path should preserve legacy behavior and avoid touching secret files unless the sandbox path or diagnostics explicitly needs them. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Settings enum sanitizer did not explicitly accept `warn-disable` and `minimal` when a non-default fallback was passed. | Fixed sanitizer to accept all valid enum literals before falling back, and covered it in targeted tests. |
