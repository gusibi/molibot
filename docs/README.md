# Molibot Docs

This directory is organized by document purpose first, then by topic. Start with [the feature overview](features/) when you want to understand what Molibot can do today.

`docs/agent-dev-series/` and `docs/superpowers/` are maintained as standalone collections and keep their existing internal structure.

## Directory map

| Directory | Use for |
| --- | --- |
| `features/` | User-facing capability explanations, starting points, and current boundaries. |
| `guides/` | Operator and developer guides for using, configuring, deploying, and extending Molibot. |
| `requirements/` | Planned product scope, MVP boundaries, and acceptance-oriented requirements. |
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
- [Desktop Project Workspace](features/desktop-project-workspace.md)

### Architecture and operation

- [V1 architecture](designs/architecture/v1-architecture.md)
- [Agent redesign](designs/architecture/agent-redesign-v2.2.md)
- [Prompt designs](designs/prompt/)
- [Sandbox research](research/sandbox/)
- [Sandbox designs](designs/sandbox/)
- [Plugin guides](guides/plugins/)
- [Plugin manifest design](designs/plugins/plugin-manifest.md)
- [Deferred tool guide](guides/tools/deferred-tool-authoring.md)
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
