# Skill Usage Tracking Progress

> Companion progress document for `docs/trace/skill-usage-tracking-plan.md`.
> This file tracks implementation status across Phase 1, Phase 2, and Phase 3.

## Status Summary

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Track implicit skill loading when the model reads a skill `SKILL.md` | Complete |
| Phase 2 | Track `skillSearch` candidates as triggered skill facts | Complete |
| Phase 3 | Attribute executed evidence from declared skill signals | Complete |

## Phase 1 Checklist

- [x] Create this progress checklist beside the tracking plan.
- [x] Export and reuse path comparison logic for skill file matching.
- [x] Add runner state for the active run skill manifest.
- [x] Add runner state for pending resolved read paths.
- [x] Cache resolved `read` paths only after hook gate, preflight, and budget allow execution.
- [x] Consume and clear pending read paths on `tool.call.after` and `tool.call.error`.
- [x] Emit `skill.loaded` with `reason: "read_skill_file"` when a successful read matches a loaded skill file.
- [x] Clear Phase 1 runner state in run cleanup.
- [x] Add monotonic `skill_usage` level/evidence merging in `TraceRecorderHook`.
- [x] Store evidence as `payload.evidenceCsv`, not an array.
- [x] Preserve triggered-only facts as `status: "info"` and loaded facts as `status: "success"`.
- [x] Add focused tests for success, error cleanup, blocked cleanup, non-mutating invalid paths, monotonic merge, evidence storage, path correction, and no false positives.
- [x] Run focused verification.
- [x] Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` if required.

## Phase 2 Checklist

- [x] In runner `afterToolCall`, detect successful `skillSearch` results.
- [x] Read `context.result.details.matches` defensively.
- [x] Emit `skill.selected` with `reason: "search_match"` for each matched skill.
- [x] Verify matched-only facts keep `payload.level === "triggered"` and `status === "info"`.
- [x] Add tests for candidate tracking and no downgrade after loaded.
- [x] Update documentation and this checklist.

## Phase 3 Checklist

- [x] Define optional `signals` metadata contract in `SKILL.md` frontmatter.
- [x] Parse supported signal types from loaded skills.
- [x] Attribute conservative post-load tool/bash evidence inside the same run.
- [x] Resolve overlapping signal ownership rules.
- [x] Emit or record `executed` evidence without presenting it as proof.
- [x] Add tests for conservative matching, overlap handling, and no false positives.
- [x] Update documentation and this checklist.

## Follow-up Notes

- Trace UI or analytics that wants to count actually used skills should filter `skill_usage.payload.level` to `loaded` / `executed`; `triggered` facts include `skillSearch` candidates and should be treated as discovery signals, not usage proof.

## Implementation Log

### 2026-06-13

- Started Phase 1 implementation.
- Created this progress checklist before code changes.
- Implemented the Phase 1 runner tracking path and trace recorder merge path.
- Added focused runner and trace recorder tests.
- Verification:
  - Passed: `node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts`
  - Blocked by existing loader issue: `runner.test.ts` cannot start under Node test/tsx because `AGENTS.template.md?raw` is not handled by that loader path.
  - Full `tsc` remains blocked by existing repository errors; filtered check for touched implementation files produced no output.
- Phase 1 implementation complete; remaining work is Phase 2/3.
- Started Phase 2 implementation.
- Implemented successful `skillSearch` match tracking in runner `afterToolCall`.
- `skillSearch` matches now emit `skill.selected` with `reason: "search_match"` after defensive `details.matches` parsing; malformed matches and failed tool calls are ignored.
- Added runner coverage for `skillSearch` candidate emission and retained trace recorder coverage for triggered-only facts plus no-downgrade merging.
- Verification:
  - Passed: `node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts`
  - Full `tsc` remains blocked by existing repository errors; filtered check for touched implementation files produced no output.
  - `runner.test.ts` remains blocked by the existing Node test/tsx `?raw` loader issue documented in Phase 1.
- Phase 2 implementation complete; remaining work is Phase 3.
- Started Phase 3 implementation.
- Implemented optional skill `signals` parsing for `cli`, `mcp`, and `tools` from nested `signals:` frontmatter and flat `signals_cli` / `signals_mcp` / `signals_tools` keys.
- Added runner attribution for successful post-load tool calls:
  - `cli` signals match successful `bash` command prefixes.
  - `tools` signals match successful tool names.
  - `mcp` signals match MCP server id/name/prefix from tool result details.
- `read` is excluded from executed attribution because reading `SKILL.md` is already the loaded signal and should not also count as execution evidence.
- Overlapping signal ownership is resolved conservatively by assigning the tool evidence to the most recently loaded matching skill in the same run.
- Signal evidence emits a `skill.loaded` event with `reason: "cli_signal"`, `reason: "tool_signal"`, or `reason: "mcp_signal"`; `TraceRecorderHook` records those reasons as `payload.level: "executed"` while preserving `status: "success"` and accumulated `payload.evidenceCsv`.
- Verification:
  - Passed: `node --import tsx --test src/lib/server/agent/hooks/traceRecorderHook.test.ts`
  - Passed: `node --import tsx --test --test-name-pattern "parses optional skill execution signals" src/lib/server/agent/skills/skills.test.ts`
  - Existing failures remain in full `skills.test.ts`: an older locale assertion expects Chinese default text while current output is English, and the workspace whitelist test cannot write the configured SQLite database in this sandbox.
  - Full `tsc` remains blocked by existing repository errors; filtered check for touched implementation files produced no output. Filtering tests still shows existing `runner.test.ts` provider model fixture errors for missing `enabled`.
- Phase 3 implementation complete. Executed remains heuristic evidence, not proof of skill execution.
