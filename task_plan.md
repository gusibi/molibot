# Task Plan: Subagent Sandbox Research

## Goal
Research user needs, competitor patterns, functional boundaries, data structures, page interactions, and acceptance criteria for Molibot's agent/subagent sandbox product direction without changing business code.

## Assumptions
- "先不要改代码" means no runtime/source implementation changes; documentation updates are allowed.
- The current first version already includes subagent delegation, shell sandbox settings, Host Bash approvals, session-only bypass, and audit UI.
- The next useful output is a decision-grade research/spec document, not another feature implementation.
- Official product documentation should be the primary competitor source.

## Success Criteria
1. Summarize the current Molibot baseline from existing docs and source structure.
2. Compare relevant products: Claude Code, Codex CLI/Cloud, GitHub Copilot cloud agent, Replit Agent, Devin, OpenHands, and Cursor.
3. Define target users and jobs-to-be-done for this capability.
4. Propose functional boundaries and explicit non-goals.
5. Sketch durable data structures for sandbox policy, delegated runs, approvals, diagnostics, and checkpoints.
6. Specify page interactions for settings, live run visibility, approval handling, and audit/recovery.
7. Write concrete acceptance criteria and phased priorities.
8. Update required project documentation at a high level.

## Phases

### Phase 1: Local Baseline Review
- [x] Read existing PRD/features/README/changelog entries for subagent, sandbox, and Host Bash approval.
- [x] Inspect relevant settings, tools, API, and UI files without editing code.
- **Status:** complete

### Phase 2: Competitor Research
- [x] Gather official docs for Claude Code, OpenAI Codex, GitHub Copilot cloud agent, Replit Agent, Devin, OpenHands, and Cursor.
- [x] Extract implementation patterns relevant to Molibot.
- **Status:** complete

### Phase 3: Product Spec Draft
- [x] Create a research/spec document under `docs/`.
- [x] Capture users, competitors, boundaries, data model, UI flows, and acceptance criteria.
- **Status:** complete

### Phase 4: Documentation Sync
- [x] Add high-level doc links/status to `features.md`, `prd.md`, `CHANGELOG.md`, and README/readme.
- [x] Record final verification.
- **Status:** complete

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `git status` emitted macOS temp/xcrun cache warnings under read-only sandbox | Checked dirty worktree before edits | Treated as non-blocking; status output still listed changed files |
| Placeholder scan found older placeholder wording in historical changelog/features/prd entries | Ran repository-doc scan | Confirmed the matches are pre-existing historical mory entries, not placeholders in the new research document |
