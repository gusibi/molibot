# Task Plan: Chat Host Tool Approval

## Goal
Add a chat-first approval flow and controlled runner for host-executed external tools so skills can request and use a specific host capability without exposing unsandboxed bash.

## Assumptions
- AI may request approval but must not approve host tools itself.
- First implementation should be configuration/runtime only; no Settings page is required.
- Host tool approval should persist under runtime settings or data-root managed storage, not in source code.
- `bash` remains sandboxed when sandbox is enabled and must not auto-upgrade to host.

## Success Criteria
1. Add a tool that lets the model create a pending host-tool approval request with structured permissions.
2. Add a controlled approval path that requires an approval id and persists an approved host tool entry.
3. Update the system prompt so the model asks for approval instead of attempting sandbox bypass.
4. Add focused tests for request/approval behavior and prompt guidance.
5. Update required project docs: `features.md`, `prd.md`, `CHANGELOG.md`, and README entry docs.
6. After approval, allow the model to run only the approved fixed host command through a non-shell host runner.

## Phases

### Phase 1: Trace Existing Extension Points
- [x] Inspect runtime settings persistence and tool creation patterns
- [x] Inspect channel command handling for user-confirmation hooks
- [x] Decide where pending and approved host tools should live
- **Status:** complete

### Phase 2: Implement Minimal Approval Store and Tool
- [x] Add host tool settings/schema/defaults/sanitization
- [x] Add request-only runtime tool
- [x] Wire tool into `createMomTools`
- **Status:** complete

### Phase 3: Prompt and Confirmation Flow
- [x] Add prompt rules for host tool approval
- [x] Add shared chat command handling for approval confirmation
- **Status:** complete

### Phase 4: Verify and Document
- [x] Add focused tests
- [x] Run focused tests
- [x] Update docs and changelog
- **Status:** complete

### Phase 5: Controlled Host Tool Runner
- [x] Add `hostToolRun` tool for approved host capabilities
- [x] Execute fixed command with structured args via `spawn`, never shell
- [x] Add focused runner tests
- [x] Update prompt and docs
- **Status:** complete

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
