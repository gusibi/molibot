# Molibot Docs

This directory is organized by document purpose first, then by topic. Start with [the feature overview](features/) when you want to understand what Molibot can do today.

`docs/agent-dev-series/` and `docs/superpowers/` are maintained as standalone collections and keep their existing internal structure.

Archived material lives under `archive/`: quarterly root-record archives (`prd-archive-YYYY-QN.md`, `features-archive-YYYY-QN.md`, `changelog-YYYY-QN.md`) plus subdirectories for superseded/delivered standalone documents (`archive/requirements/`, `archive/designs/`, `archive/guides/`). Archived content is frozen history, not authority for current behavior.

## Directory map

| Directory | Use for |
| --- | --- |
| `features/` | User-facing capability explanations, starting points, and current boundaries. |
| `guides/` | Operator and developer guides for using, configuring, deploying, and extending Molibot. |
| `requirements/` | Planned product scope, MVP boundaries, and acceptance-oriented requirements. |
| `adr/` | Accepted architecture decisions and the reasoning behind them, for decisions that outlive any one feature. |
| `designs/` | Durable architecture, technical designs, and system proposals. |
| `research/` | External research, market notes, competitor analysis, and background investigation. |
| `reviews/` | Durable technical review conclusions and post-analysis reports. |
| `work/` | Time-bound implementation plans, handoffs, progress trackers, implementation-linked reviews, and audit evidence. Not a stable product-documentation entrypoint. |
| `reference/` | Raw provider documentation, prompt captures, API examples, and other source material. |
| `articles/` | Long-form publishable articles and drafts. |
| `images/` | Shared diagrams and image assets. |
| `archive/` | Historical changelog, feature, and PRD records. |
| `agent-dev-series/` | Agent development article series. |
| `superpowers/` | Superpowers planning, specification, and review documents. |

## Common entrypoints

### Features

- [Personal Agent and Memory](features/personal-agent-and-memory.md)
- [Channels and Surfaces](features/channels-and-surfaces.md)
- [Tools, Skills, and MCP](features/tools-skills-and-mcp.md)
- [Automation, Approvals, and Sandbox](features/automation-approvals-and-sandbox.md)
- [Scheduled Task Execution and Recovery](features/scheduled-task-execution-and-recovery.md)
- [Desktop Project Workspace](features/desktop-project-workspace.md)

### Planned and requirements

- [Assistant Capability Matrix](requirements/personal-assistant-capability-matrix.md) — the single four-state current-status source
- [Automatic Durable Execution PRD](requirements/automatic-durable-execution-prd.md) — long-task foundation, partially delivered
- [Permission Modes PRD](requirements/permission-modes-prd.md) — Plan/Manual/Accept/Auto session scope
- [Project Automations PRD](requirements/project-automations-prd.md) — Project-scoped periodic Runtime Tasks
- [Artifact Panel PRD](requirements/artifact-panel-prd.md) — shared artifact registry and inspection
- [Plugin-owned Settings PRD](requirements/plugin-owned-settings-prd.md) — plugin contract reference migration
- [Mini App Platform Roadmap](requirements/miniapp-platform-extension-roadmap.md) — platform extension direction
- [OpenConnector plan](requirements/openconnector-cloudflare-and-molibot-plan.md) — third-party integration gateway
- [Realtime avatar conversation plan](requirements/realtime-avatar-conversation-plan.md) — draft proposal, not scheduled

### Architecture and operation

- [Architecture decisions (ADR)](adr/)
- [pi-mono upgrade assessment](reviews/pi-mono-upgrade-assessment.md)
- [Market positioning research](research/market-positioning.md)
- [V1 architecture (archived)](archive/designs/v1-architecture.md)
- [Agent redesign](designs/architecture/agent-redesign-v2.2.md) (earlier revisions archived: [v2.0](archive/designs/agent-redesign-v2.0.md), [v2.1](archive/designs/agent-redesign-v2.1.md))
- [Agent runtime designs](designs/agent-runtime/) — execution flow, event timeout/retry, approval convergence
- [Memory design](designs/memory/memory-usage-trace-and-feedback.md)
- [Channel message architecture](designs/channels/message-architecture-and-presentation.md)
- [Prompt designs](designs/prompt/)
- [Sandbox research](research/sandbox/) — subagent sandbox, sandbox approval optimization
- [Research](research/) — memory systems, market positioning, Hermes/OpenClaw notes
- [Sandbox designs](designs/sandbox/)
- [Plugin guides](guides/plugins/) — [manifest design](designs/plugins/plugin-manifest.md), [plugin contract](guides/plugins/authoring.md), [plugin authoring](guides/plugins/plugin-authoring.md)
- [Deferred tool guide](guides/tools/deferred-tool-authoring.md)
- [Permission modes × sandbox policy](guides/permission-and-sandbox-modes.md)
- [Trace design](designs/trace/)
- [Operations / remote control](designs/operations/control-daemon.md)

## Filing rules

- Put new stable documentation in the directory that matches its current purpose, not only its feature area.
- Put explanations of shipped, user-visible behavior in `features/`; link from those pages to relevant guides and durable designs.
- Put time-bound execution plans, handoffs, progress trackers, screenshot audits, and implementation-linked review material in `work/`.
- If a process document becomes a durable decision, extract or move the durable conclusion to `requirements/`, `designs/`, `reviews/`, or `features.md`; do not make `work/` a dependency for normal use.
- If a document changes purpose, move it instead of duplicating it.
- Keep raw API examples and copied prompt/provider material under `reference/`.
- Keep publishable prose under `articles/`.
- Keep the repository's domain glossary under [`reference/CONTEXT.md`](reference/CONTEXT.md).
- Keep the current capability status only in [`requirements/personal-assistant-capability-matrix.md`](requirements/personal-assistant-capability-matrix.md); plan/PRD/design documents under `requirements/` and `designs/` must stay current with shipped reality or be archived via the doc-lifecycle rules.
