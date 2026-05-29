# Findings & Decisions: Agent v2.2 Optimization

## Current v2.2 Baseline
- `src/lib/server/workspaces/store.ts` already creates a `workspaces` table and default `personal` workspace.
- `src/lib/server/agent/runner.ts` already resolves `ctx.message.workspaceId`, writes it into run detail entries, and includes it in run summary metadata.
- `src/lib/server/channels/shared/baseRuntime.ts` stores a default `workspaceId`, but still constructs physical `workspaceDir` from the channel default workspace name. This matches the v2.2 rule that logical Workspace must not migrate physical directories.
- `src/lib/server/agent/channelCommands.ts` already intercepts `/acp`, `/approve`, and `/deny` with an inactive runtime message.
- Host Bash approvals already have SQLite-backed storage and support pending/history/whitelist concepts, but they are still in the Host Bash-specific model rather than the generalized `ApprovalBroker` model.

## Resolved In This Slice
- `src/lib/server/settings/defaults.ts` no longer imports ACP provider presets and now defaults ACP to disabled with no targets.
- `src/lib/server/settings/store.ts` no longer imports ACP adapter inference from the legacy ACP provider module.
- `src/routes/settings/acp/+page.svelte` is now a read-only inactive notice instead of an editable ACP target/project manager.
- `src/lib/server/agent/turnOrchestrator.ts` exists and `runner.ts` delegates run/session/workspace metadata preparation to it.
- `src/lib/server/agent/tools/toolTypes.ts` and `toolRuntime.ts` define the first unified tool execution boundary.
- `src/lib/server/approval/approvalTypes.ts` and `approvalBroker.ts` define the first shared approval scope boundary.

## Remaining Gaps Against v2.2
- `src/lib/server/settings/schema.ts` still includes `AcpSettings` in `RuntimeSettings` for compatibility; final removal belongs to the later legacy cleanup phase.
- `src/lib/server/app/runtime.ts` still contains ACP sanitization helpers for old config compatibility.
- `TurnOrchestrator` has not yet migrated the full channel pipeline, session lock, memory, skill loading, or run event archival responsibilities.
- `ToolRuntime` has not yet migrated the existing built-in tools, Host Bash path, MCP tools, or plugin tools.
- `ApprovalBroker` is not yet backed by SQLite `approval_requests` / `approval_grants`, and debounce/subagent bubbling are still pending.
- `messageRouter.ts` still exists under shared channels, even though v2.2 marks it as a later deletion target.

## Implementation Decisions
- Do not physically delete `src/lib/server/acp/` in early phases.
- Prefer additive modules and focused tests first, because `runner.ts` is large and existing behavior is broad.
- Treat Phase 5 as a real gate, not a paper-complete item; it needs stabilization evidence before ACP source deletion.
