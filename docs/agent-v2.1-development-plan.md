# Agent v2.1 Development Plan

**Date:** 2026-05-27
**Source:** `v2.1.md`
**Purpose:** Convert the Agent 精简优化架构改造方案 into an executable TODO list.

## Assumptions

- The goal is to regain control of the current Agent runtime, not to design a new platform.
- Short-term work should reduce complexity before adding new runtime capability.
- Channel code should stay thin: receive/send/adapter logic only.
- Shared runtime layers own queueing, run orchestration, tool execution, approval, memory calls, and session progression.
- Transient model-control instructions, user-visible status, and persistent debug records must stay separate.

## Short-Term Fast Plan

The first short-term execution target is **Phase 1: remove ACP from the main product path and introduce the minimum Workspace boundary**.

Why this comes first:

1. ACP is called out in `v2.1.md` as the largest removable complexity source.
2. Removing ACP narrows settings, permissions, UI, channel commands, and runtime branching before we touch the core run loop.
3. A minimum Workspace gives later TurnOrchestrator / ToolRuntime / Approval scope work a clean boundary without forcing a full settings rewrite.
4. The phase can be verified with startup, Web/CLI runs, and workspace id run/session records before deeper channel migration begins.

Success criteria for the first execution slice:

1. No active ACP main path remains in runtime/channel/settings code.
2. Existing Web and CLI conversations still run under a default workspace.
3. A default `personal` workspace exists after startup or migration.
4. New runs can record `workspaceId` in JSONL run archives.
5. README / PRD / Features / CHANGELOG stay explicit that ACP removal is planned until code actually ships.

## Execution Checklist

### A. Discovery and Safety Baseline

- [ ] 1. Inventory all ACP source files, routes, settings entries, UI links, channel commands, tests, and docs references.
- [ ] 2. Inventory current session/run persistence points and identify where workspace id can be added with the smallest change.
- [ ] 3. Identify the current Web, CLI, Telegram, Feishu, QQ, and Weixin entry paths and mark which ones directly touch ACP.
- [ ] 4. Identify current approval, Host Bash, sandbox, subagent, and runlog stores that mention ACP or ACP target/project concepts.
- [ ] 5. Write the before-change verification list: build, unit tests, startup smoke, Web chat smoke, CLI chat smoke.
- [ ] 6. Decide the exact default workspace id and name; default proposal is `personal`.
- [ ] 7. Confirm no user data migration requires deleting existing ACP records in the first slice; prefer leaving old data inert until cleanup.

### B. Phase 1: Remove ACP Main Path

- [x] 8. Remove ACP from the runtime feature surface list and active settings navigation.
- [x] 9. Remove ACP channel command registration from shared/channel-specific command paths.
- [ ] 10. Remove ACP provider/target selection from runtime settings schema only after identifying all readers.
- [ ] 11. Remove `RuntimeSettings.acp` reads from live runtime code.
- [x] 12. Remove ACP permission bridge calls from approval or channel code.
- [x] 13. Remove ACP task tracking from normal run detail or channel progress flows.
- [ ] 14. Delete or quarantine `src/lib/server/acp/` only after imports are gone.
- [x] 15. Remove ACP UI routes and navigation entries after confirming no settings route still imports them.
- [ ] 16. Update tests that expected ACP settings or ACP navigation.
- [ ] 17. Verify the app starts without ACP settings present.
- [ ] 18. Verify Web chat can send one normal text request.
- [ ] 19. Verify CLI can send one normal text request.

### C. Phase 1: Minimum Workspace Boundary

- [x] 20. Add a `workspaces` table or equivalent migration with the minimum v2.1 fields.
- [x] 21. Add a default workspace bootstrap path that creates `personal` if none exists.
- [x] 22. Add a small `WorkspaceResolver` that resolves workspace from incoming context and falls back to `personal`.
- [x] 23. Add workspace id to new run records (`workspaceId` in run JSONL).
- [ ] 24. Add workspace id to session metadata where the existing session store can support it safely.
- [x] 25. Keep `enabledSkillPaths`, `enabledToolIds`, `sandboxProfileId`, and `approvalProfileId` optional in the first slice.
- [x] 26. Keep memory behavior unchanged except for carrying the workspace id through the run context.
- [x] 27. Add tests for default workspace creation and workspace resolution fallback.
- [ ] 28. Add tests or smoke coverage that a new run records `workspaceId`.
- [ ] 29. Verify Web chat runs under the default workspace.
- [ ] 30. Verify CLI runs under the default workspace.

### D. Phase 2: TurnOrchestrator Main-Path Convergence

- [ ] 31. Design the smallest `TurnOrchestrator` interface around normalized inbound message, actor, session, workspace, run id, stream sink, and cancellation hooks.
- [ ] 32. Move run id creation into TurnOrchestrator.
- [ ] 33. Move session/conversation resolution into TurnOrchestrator where it is currently duplicated.
- [ ] 34. Move workspace resolution into TurnOrchestrator.
- [ ] 35. Move session lock acquisition/release into TurnOrchestrator.
- [ ] 36. Move run event start/end recording into TurnOrchestrator.
- [ ] 37. Move memory retrieve/writeback call sites into turn start/end where possible.
- [ ] 38. Connect Web to TurnOrchestrator behind a fallback flag or narrow adapter.
- [ ] 39. Connect CLI to TurnOrchestrator after Web is stable.
- [ ] 40. Connect Telegram to TurnOrchestrator without moving Telegram transport-specific send/edit logic.
- [ ] 41. Connect Feishu/QQ/Weixin after Telegram regressions are understood.
- [ ] 42. Verify every user request has a run id across migrated channels.

### E. Phase 2: ToolRuntime Convergence

- [ ] 43. Inventory all tool sources: built-in tools, MCP tools, Host Bash, sandbox bash, subagent tools, plugin tools.
- [ ] 44. Create a small `ToolRuntime.executeToolCall()` entrypoint.
- [ ] 45. Add a lightweight `PolicyDecision` type without creating a full PolicyEngine.
- [ ] 46. Route built-in tool calls through ToolRuntime first.
- [ ] 47. Route Host Bash and sandbox bash through ToolRuntime.
- [ ] 48. Route MCP tool calls through ToolRuntime.
- [ ] 49. Route subagent tool calls through ToolRuntime while preserving parent-run ownership.
- [ ] 50. Route plugin tools through ToolRuntime via the existing plugin system.
- [ ] 51. Add run/session/workspace ids to tool events.
- [ ] 52. Disable or test-guard direct tool execution paths once replacement paths pass.
- [ ] 53. Verify tool events are auditable for one normal command, one sandboxed command, and one subagent command.

### F. Phase 2: Approval Scope and Sandbox Rules

- [ ] 54. Add `ApprovalScope` values: `once`, `turn`, `session`, `workspace`, `persistent`.
- [ ] 55. Add `approval_requests` storage with selected scope and scope options.
- [ ] 56. Add `approval_grants` storage with actor/session/workspace/run binding.
- [ ] 57. Map current persistent Host Bash approvals into `persistent` or a compatible legacy grant.
- [ ] 58. Map current session-only approvals into `session`.
- [ ] 59. Keep high/critical operations restricted to `once` until a stricter policy is designed.
- [ ] 60. Add simple same-run approval debounce for similar low/medium requests.
- [ ] 61. Ensure subagent approval requests belong to the parent run.
- [ ] 62. Ensure sandbox failure never executes on host unless an existing grant allows it.
- [ ] 63. Verify approval grant revoke or expiry path exists before broad workspace/persistent use.

### G. Phase 3: Settings Split

- [ ] 64. Move Workspace and Approval settings/storage out of `settings.json` first.
- [ ] 65. Add `plugin_settings` storage without rewriting the plugin system.
- [ ] 66. Add `channel_settings` storage without changing channel runtime behavior.
- [ ] 67. Keep `settings.json` readable during migration.
- [ ] 68. Make SQLite values win over legacy settings where both exist.
- [ ] 69. Make UI writes target the new tables for migrated entities.
- [ ] 70. Add migration backup or idempotent startup migration safeguards.
- [ ] 71. Confirm editing channel/plugin settings no longer overwrites model/sandbox settings.
- [ ] 72. Only after the first batch is stable, plan `model_settings`, `mcp_servers`, `sandbox_profiles`, and `skill_settings`.

### H. Explicit Non-Goals for This Plan

- [ ] 73. Do not create a new PluginManager.
- [ ] 74. Do not rewrite the Skill system.
- [ ] 75. Do not rewrite MemoryRuntime.
- [ ] 76. Do not introduce a full PolicyEngine.
- [ ] 77. Do not introduce a full SandboxRuntime.
- [ ] 78. Do not redesign subagent roles/types.
- [ ] 79. Do not move queueing, approval, or run orchestration into Channel code.
- [ ] 80. Do not persist temporary model-control prompts into session conversation history.

## Recommended First Sprint

1. Discovery and safety baseline: tasks 1-7.
2. Remove ACP main path: tasks 8-19.
3. Add default Workspace boundary: tasks 20-30.

Exit check:

```text
npm run build
targeted tests for settings/runtime/session migration
manual Web chat smoke under workspace personal
manual CLI smoke under workspace personal
rg confirms no active ACP imports in runtime/channel/settings main paths
```
