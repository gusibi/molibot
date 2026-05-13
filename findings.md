# Findings & Decisions: Chat Host Tool Approval

## Requirements
- Provide a chat-driven approval flow for external tools that need host execution.
- Avoid adding one-off services per external tool.
- Do not let AI decide or directly grant sandbox bypass.
- Keep the implementation compatible with later skill-provided manifests.

## Findings
- `createMomTools()` is the right place to expose a request-only approval tool because it already has `channel`, `chatId`, `getSettings`, and `updateSettings`.
- Runtime settings already persist static JSON fields through `SettingsStore.toStaticSettings()`, so a small `hostTools` setting is enough for pending approvals and approved registry without adding a database migration.
- `SharedRuntimeCommandService.handle()` can safely inspect non-slash messages first because it returns `false` when there is no pending host approval and no slash command.
- Telegram normal messages previously bypassed the shared command service except registered slash commands and `stop`; it needs one extra pre-run check so plain `安装` can approve a pending request.

## Decisions
| Decision | Rationale |
|----------|-----------|
| AI can request but not approve host tools | Approval changes the runtime security boundary and must stay operator-controlled. |
| Host capability is not host bash | A host tool must be a structured, allowlisted capability with schema and fixed command metadata. |
| First pass registers approvals but does not execute host tools | This adds the security/approval substrate without exposing a new host execution surface in the same change. |
| Host execution should use `spawn(command, args)` without shell | This allows approved external tools to run while avoiding shell interpolation and host bash exposure. |
