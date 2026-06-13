# Skill Usage Tracking Progress

> Companion progress document for `docs/trace/skill-usage-tracking-plan.md`.
> This file tracks implementation status across Phase 1, Phase 2, and Phase 3.

## Status Summary

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Track implicit skill loading when the model reads a skill `SKILL.md` | Complete |
| Phase 2 | Track `skillSearch` candidates as triggered skill facts | Not started |
| Phase 3 | Attribute executed evidence from declared skill signals | Not started |

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

- [ ] In runner `afterToolCall`, detect successful `skillSearch` results.
- [ ] Read `context.result.details.matches` defensively.
- [ ] Emit `skill.selected` with `reason: "search_match"` for each matched skill.
- [ ] Verify matched-only facts keep `payload.level === "triggered"` and `status === "info"`.
- [ ] Add tests for candidate tracking and no downgrade after loaded.
- [ ] Update documentation and this checklist.

## Phase 3 Checklist

- [ ] Define optional `signals` metadata contract in `SKILL.md` frontmatter.
- [ ] Parse supported signal types from loaded skills.
- [ ] Attribute conservative post-load tool/bash evidence inside the same run.
- [ ] Resolve overlapping signal ownership rules.
- [ ] Emit or record `executed` evidence without presenting it as proof.
- [ ] Add tests for conservative matching, overlap handling, and no false positives.
- [ ] Update documentation and this checklist.

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
