# Molibot Docs

This directory is organized by document purpose first, then by topic.

`docs/agent-dev-series/` and `docs/superpowers/` are maintained as standalone collections and are intentionally left in their original structure.

## Directory Map

| Directory | Use for |
|-----------|---------|
| `requirements/` | Product requirements, MVP boundaries, and acceptance-oriented scope notes |
| `designs/` | Architecture, technical designs, implementation options, and system proposals |
| `reviews/` | Technical reviews, post-analysis reports, and optimization reviews |
| `research/` | External research, competitor notes, and background investigation |
| `guides/` | Operator or developer guides for using and extending Molibot |
| `reference/` | Raw provider docs, prompt captures, API examples, and other reference material |
| `articles/` | Long-form publishable articles and drafts |
| `images/` | Shared diagrams and image assets |
| `agent-dev-series/` | Agent development article series. Do not reorganize with the main docs taxonomy. |
| `superpowers/` | Superpowers planning/spec/review documents. Do not reorganize with the main docs taxonomy. |

## Common Entrypoints

- Requirements: `requirements/acp-multi-provider-mvp.md`
- Memory Center and per-turn memory disclosure PRD: `requirements/memory-trace-and-memory-center-prd.md`
- Architecture: `designs/architecture/v1-architecture.md`
- Agent redesign: `designs/architecture/agent-redesign-v2.2.md`
- Prompt designs: `designs/prompt/`
- Sandbox research and designs: `research/sandbox/`, `designs/sandbox/`
- Plugin guides and manifest design: `guides/plugins/`, `designs/plugins/plugin-manifest.md`
- Deferred tool guide: `guides/tools/deferred-tool-authoring.md`
- Trace design: `designs/trace/`
- Operations / remote control: `designs/operations/control-daemon.md`

## Filing Rules

- Put new work in the directory that matches the document's current purpose, not only the feature area.
- If a document changes purpose, move it instead of duplicating it.
- Keep raw API examples and copied prompt/provider material under `reference/`.
- Do not keep temporary execution checklists, migration status trackers, or progress logs under `docs/`; preserve durable decisions in `requirements/`, `designs/`, `reviews/`, or `features.md` instead.
- Keep publishable prose under `articles/`.
