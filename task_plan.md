# Automation Sessions Implementation

## Goal
Build a complete Automations area for periodic watched-event tasks, persist future task executions and session links, and hide fresh automation sessions from the normal chat session list.

## Plan
- [complete] Inspect task/runtime/session/navigation seams and current tests.
- [complete] Add stable task identity, execution persistence, and runtime lifecycle recording.
- [complete] Add macOS Automations API/UI projection with task actions and run history.
- [complete] Hide automation-origin sessions and add read-only session detail from execution history.
- [complete] Update product docs and run focused verification.

## Decisions
- Only periodic tasks appear in Automations; all task types may be recorded.
- Existing periodic event files receive a taskId; historical sessions are not backfilled.
- Fresh automation sessions are hidden; chat-mode sessions remain visible.
- One active execution per task; retries are attempts under one execution.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Mis-scoped UI target to Web `/settings/tasks` | 1 | User clarified the target is macOS app; no page edits had been written, implementation moved to Desktop `/api/desktop/tasks` and `apps/desktop`. |
| `node --test` cannot run TS test directly | 1 | Re-ran with project loader: `node --import ./scripts/register-loader.js --import tsx --test ...`. |
| Root `tsc --noEmit` blocked by existing repo errors | 1 | Filtered diagnostics to changed files and ran focused Desktop checks/tests. |
