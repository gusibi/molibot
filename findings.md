# Findings & Decisions: Subagent Sandbox Research

## Current Molibot Baseline
- Molibot already has built-in subagents: `scout`, `planner`, `worker`, `reviewer`, and `skill-drafter`.
- Subagents are defined as checked-in Markdown files with frontmatter and are exposed through `/api/settings/subagents` plus the Agents settings page.
- Model routing is abstracted through subagent levels: `haiku`, `sonnet`, `opus`, and `thinking`, with fallback to a generic subagent route and then text route.
- The current sandbox applies only to main Agent `bash` and built-in subagent `bash`; Browser, Computer Use, ACP, MCP, and channel I/O remain host-access surfaces.
- Host Bash approvals support persistent, one-time, and session-only approval modes, backed by SQLite tables for records and whitelist entries.
- `/settings/sandbox` handles sandbox policy and diagnostics; `/settings/host-bash` handles audit/whitelist management but keeps approval decisions in chat.

## Competitor Patterns
- Claude Code treats subagents as Markdown + YAML frontmatter, with scoped prompts, model selection, tool allow/deny, permissions, memory, hooks, background execution, and optional worktree isolation.
- Codex CLI separates sandbox modes from approval policy. It uses read-only/workspace-write/full-access style boundaries and supports approve-on-request/on-failure/session/policy escalation patterns.
- GitHub Copilot cloud agent pushes work into a GitHub Actions-powered ephemeral environment, works on branches/PRs, exposes custom agents as repository/org/enterprise agent profiles, and adds network firewall governance.
- Replit Agent emphasizes product safety through checkpoints and rollback: project files, environment config, AI conversation context, memory, and optional database state can be restored together.
- Devin's strongest lesson is environment readiness: declarative blueprints build snapshots so every session starts from a known-good VM image.
- OpenHands is the clearest open-source sandbox baseline: Docker sandbox is recommended; process mode is faster but unsafe; remote sandbox supports hosted deployments.
- Cursor emphasizes mode-level permissions and developer flow: Agent/Ask/Manual/Custom modes map tool access to the intent of the task.

## Initial Product Decisions
| Decision | Rationale |
|----------|-----------|
| Keep sandbox boundary at shared Agent/tool layer, not Channel layer | This matches existing Molibot architecture and prevents each channel from reimplementing security semantics. |
| Treat host approval as a run pause, not a chat message | Existing rules already require transient controls and user-facing notices to stay out of persisted model context. |
| Add checkpoints/recovery as a product concept before broadening sandbox powers | Competitors show that recovery is what makes autonomy tolerable; without it, broader sandbox/host access is too risky. |
| Prefer named policy profiles over free-form toggles only | Users need understandable modes like observe/build/restricted/full-host more than raw filesystem/network controls. |
| Make subagent runs inspectable but summarized | Full logs belong in run details; parent context and chat streams need compact summaries. |
