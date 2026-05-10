# Task Plan: Agent Bash Sandbox Support

## Goal
Add OS-level sandbox support for Molibot Agent shell execution while keeping browser, ACP, MCP, and channel delivery outside this sandbox.

## Current Phase
Complete

## Phases

### Phase 1: Discovery
- [x] Confirm bash execution path
- [x] Confirm subagent bash path
- [x] Confirm settings persistence and UI entry points
- **Status:** complete

### Phase 2: Core Runtime
- [x] Add sandbox settings schema/defaults/sanitization
- [x] Add sandbox runtime helper for platform support, env loading, diagnostics, and command wrapping
- [x] Add dependency and preserve existing non-sandbox exec behavior
- **Status:** complete

### Phase 3: Tool Integration
- [x] Wire main bash tool to sandbox runtime
- [x] Wire subagent bash to the same sandbox config
- [x] Preserve artifact routing and Python venv behavior
- **Status:** complete

### Phase 4: Settings UI/API
- [x] Add read-only diagnostics API
- [x] Add `/settings/sandbox` policy UI
- [x] Add Settings navigation entry
- **Status:** complete

### Phase 5: Tests & Documentation
- [x] Add targeted tests for settings, env injection, bash, and diagnostics
- [x] Run targeted tests and production build
- [x] Update features.md, prd.md, CHANGELOG.md, README.md
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Default sandbox disabled | Avoid breaking existing skills and local workflows during first rollout. |
| Init failure soft-disables sandbox with warnings | Keeps bash usable when OS support or dependencies are missing. |
| Workspace env file source | User prefers a project-local env file; Molibot will parse and inject allowed keys instead of letting sandboxed commands read the file directly. |
| Scope only bash and subagent bash | Browser, ACP, MCP, Computer Use, and channel delivery need different host-access/external-runtime policies. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Enum sanitization fallback kept old `warn-disable`/`minimal` values incorrectly when fallback differed | Reviewed settings sanitizer before final build | Explicitly accept all valid enum values before using fallback |
