# README and Documentation Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the README into a concise product entrypoint for a memory-first personal Agent, provide user-facing feature documentation, and separate stable documentation from development-process materials.

**Architecture:** The root README will link to a new `docs/features/` layer that explains user-visible capabilities and limitations. Stable product, architecture, research, and guide documents remain in their current purpose-based directories; one-off plans, handoffs, progress trackers, and audits move under `docs/work/`, with all internal links updated to preserve navigation and history.

**Tech Stack:** Markdown, Git rename tracking, `git grep`, repository-local documentation links.

## Global Constraints

- Position Molibot as a memory-first, long-running personal AI Agent; do not frame it as a generic feature-complete Agent competitor.
- Present Momo as an example of the intended personal-Agent experience, not as a mandatory persona.
- Never present daily conversation scans, growth logs, content candidates, or automatic publishing as shipped functionality.
- Do not promise unverified group collaboration or social publishing features.
- Keep README as an entrypoint: positioning, actual high-level capabilities, quick start, links, and boundaries only.
- Put user-facing capability explanations exclusively under `docs/features/`.
- Move only short-lived development artifacts to `docs/work/`; retain durable designs, requirements, guides, research, reviews, and reference documents in their existing purpose directories.
- Preserve all documentation history via Git moves; do not delete historical material.
- Update all repository Markdown links affected by moves.
- Do not overwrite unrelated uncommitted changes.

---

## File Structure

### Create

- `docs/features/personal-agent-and-memory.md` — user-facing explanation of long-running personal Agent memory and controls.
- `docs/features/channels-and-surfaces.md` — user-facing overview of runtime access surfaces and their roles.
- `docs/features/tools-skills-and-mcp.md` — user-facing tool, Skill, MCP, and profile capability overview.
- `docs/features/automation-approvals-and-sandbox.md` — user-facing automation and execution-governance overview.
- `docs/features/desktop-project-workspace.md` — user-facing macOS Desktop and project-workspace overview.
- `docs/work/plans/` — destination for one-off implementation plans.
- `docs/work/handoffs/` — destination for temporary handoff notes.
- `docs/work/progress/` — destination for project progress, parity findings, and task trackers.
- `docs/work/reviews/` — destination for review materials coupled to a specific implementation effort.
- `docs/work/audits/` — destination for UI audit reports and screenshots.

### Modify

- `readme.md` — replace the feature ledger with product positioning, concise capabilities, quick start, documentation links, and current boundaries.
- `docs/README.md` — document the `features/` and `work/` responsibilities and offer new stable entrypoints.
- `features.md` — update the UI audit reference after its directory move.
- `prd.md` — update the native-experience planning-board reference after its move.
- moved Markdown documents that have relative links to other moved documents — repair relative references after relocation.

### Move

- `docs/audits/` → `docs/work/audits/`.
- `docs/designs/2026-07-07-desktop-chat-sidebar-multi-session-plan.md` → `docs/work/plans/2026-07-07-desktop-chat-sidebar-multi-session-plan.md`.
- `docs/designs/2026-07-08-desktop-chat-sidebar-slice3-handoff.md` → `docs/work/handoffs/2026-07-08-desktop-chat-sidebar-slice3-handoff.md`.
- `docs/designs/2026-07-16-desktop-ui-geist-consistency-plan.md` → `docs/work/plans/2026-07-16-desktop-ui-geist-consistency-plan.md`.
- `docs/designs/2026-07-16-native-experience-developer-board.md` → `docs/work/plans/2026-07-16-native-experience-developer-board.md`.
- `docs/designs/2026-07-16-web-agent-session-binding-deferred.md` → `docs/work/plans/2026-07-16-web-agent-session-binding-deferred.md`.
- `docs/designs/harness-optimization-plan.md` → `docs/work/plans/harness-optimization-plan.md`.
- `docs/designs/issue-13-completion-plan.md` → `docs/work/plans/issue-13-completion-plan.md`.
- `docs/designs/desktop-settings-parity-2026-06-29/` → `docs/work/progress/desktop-settings-parity-2026-06-29/`.
- `docs/reviews/macos-web-settings-gap-2026-06-29/{findings.md,progress.md,task_plan.md}` → `docs/work/reviews/macos-web-settings-gap-2026-06-29/`.

`docs/reviews/macos-web-settings-gap-2026-06-29/report.md` stays in place because it contains durable review conclusions. `docs/designs/issue-13-completion-plan.md` moves despite being currently referenced by an untracked root-level `task_plan.md`; the untracked file must not be edited by this work.

---

### Task 1: Add User-Facing Feature Documentation

**Files:**
- Create: `docs/features/personal-agent-and-memory.md`
- Create: `docs/features/channels-and-surfaces.md`
- Create: `docs/features/tools-skills-and-mcp.md`
- Create: `docs/features/automation-approvals-and-sandbox.md`
- Create: `docs/features/desktop-project-workspace.md`

**Interfaces:**
- Consumes: Current code and existing requirements/designs as fact sources.
- Produces: Five stable user-facing capability pages linked by `readme.md` and `docs/README.md`.

- [ ] **Step 1: Create `docs/features/` and write the personal Agent and memory page**

Write `docs/features/personal-agent-and-memory.md` with this structure and copy:

```md
# Personal Agent and Memory

Molibot is built for an Agent that works with you over time, not a chat that starts from zero every session.

## What it helps with

- Keep conversations and session state available across Web, Desktop, and supported chat channels.
- Retain governed memories about preferences, projects, and working context.
- Show which memories entered a completed turn and let you review or suppress future use.
- Keep Agent, project, and ordinary conversation contexts separate so one role does not silently inherit another role's work.

## Start here

1. Configure a provider and create an Agent in Settings.
2. Start a conversation in Web or Desktop.
3. Review saved and pending memories from the Memory settings area.

## Boundaries

Memory is configurable and reviewable. It is not a claim that every conversation will be remembered forever, and it should not replace source documents or project history.

## Related documentation

- [Memory improvement plan](../requirements/memory-improvement-plan-v3.md)
- [Project session provenance](../requirements/project-session-provenance-and-inspection.md)
- [Delivered changes](../../features.md)
```

- [ ] **Step 2: Write the channels and surfaces page**

Write `docs/features/channels-and-surfaces.md`:

```md
# Channels and Surfaces

Molibot uses one runtime across several ways of working. Pick the surface that fits the moment, while keeping configuration and session behavior in one local system.

## Available surfaces

| Surface | Best for |
| --- | --- |
| Web | Browser-based chat, configuration, and session access. |
| macOS Desktop | Native chat, project workspaces, files, automations, and Settings. |
| Telegram | A personal chat-channel entrypoint with runtime commands and file delivery. |
| Feishu | A chat-channel entrypoint with media handling and channel-native interaction. |
| Weixin | A local connection for personal conversations and media delivery. |
| QQ | A local chat-channel entrypoint with rich message and media support. |
| CLI | Terminal-based local conversations. |

## What stays shared

Providers, Agent profiles, configured tools, Skills, task controls, and durable session data are managed by the same runtime. Individual channels still keep their own delivery and presentation behavior.

## Boundaries

Channel availability depends on your local configuration and credentials. Group collaboration and external publishing should be validated for your own deployment before relying on them.

## Related documentation

- [Personal Agent and Memory](personal-agent-and-memory.md)
- [Session control commands](../guides/session-control/session-control-commands.md)
- [Delivered changes](../../features.md)
```

- [ ] **Step 3: Write the tools, Skills, and MCP page**

Write `docs/features/tools-skills-and-mcp.md`:

```md
# Tools, Skills, and MCP

Molibot gives a personal Agent controlled ways to work with information and local tasks. It separates reusable instructions from executable tools so you can shape behavior without turning every conversation into a one-off prompt.

## What you can configure

- **Profiles** define the Agent's identity, operating rules, and working style.
- **Skills** package reusable workflows and instructions that load when needed.
- **Built-in tools** cover supported runtime capabilities such as search and generated artifacts.
- **MCP servers** connect compatible external tools over configured transports.

## Start here

1. Create an Agent and select its provider route.
2. Review Skills from Settings or add project-local Skills when working in a project.
3. Add an MCP server only when an Agent needs that external capability.

## Boundaries

Tool availability is governed by the active Agent, runtime configuration, and execution policy. A configured integration does not grant unrestricted access to local files, credentials, or shell commands.

## Related documentation

- [Plugin authoring](../guides/plugins/plugin-authoring.md)
- [Deferred tool authoring](../guides/tools/deferred-tool-authoring.md)
- [Plugin manifest design](../designs/plugins/plugin-manifest.md)
```

- [ ] **Step 4: Write the automation, approvals, and sandbox page**

Write `docs/features/automation-approvals-and-sandbox.md`:

```md
# Automation, Approvals, and Sandbox

Molibot can run scheduled work, but automation stays visible and controlled. Tasks, approvals, execution records, and sandbox policy are part of the same local runtime.

## What you can do

- Create recurring and one-time tasks from the Desktop automation workspace.
- Review task status and execution history.
- Require approval for actions that need host-level access.
- Configure sandbox policy at the appropriate runtime scope.
- Stop or recover visible work when a run does not finish normally.

## Start here

1. Configure an enabled Bot and a delivery destination.
2. Create a task from the Automations workspace.
3. Review the task's run history and approval state before enabling broader access.

## Boundaries

Automations are not a license for unattended external publishing. Keep destructive, credential-bearing, or public actions behind explicit review until you have validated the full workflow in your own environment.

## Related documentation

- [Daily materials guide](../guides/daily-materials.md)
- [Sandbox research](../research/sandbox/subagent-sandbox.md)
- [Event retry design](../designs/agent-runtime/event-run-timeout-retry.md)
```

- [ ] **Step 5: Write the Desktop project-workspace page**

Write `docs/features/desktop-project-workspace.md`:

```md
# Desktop Project Workspace

The macOS Desktop app brings chat, project context, files, automations, and Settings into a native local workspace.

## What you can do

- Work in ordinary chats or attach conversations to a local project.
- Keep project sessions separate from ordinary personal conversations.
- Inspect project files, changes, and session attachments from the project workspace.
- Use the same configured providers, Agent profiles, memory controls, and task tools available through the local runtime.

## Start here

1. Install and launch the macOS Desktop app.
2. Create or connect a local project directory.
3. Start a project conversation and use the file panel to inspect project context.

## Boundaries

The Desktop app is macOS-specific. It manages local projects and local runtime connections; it does not replace source control or make external services available without configuration.

## Related documentation

- [Project session provenance](../requirements/project-session-provenance-and-inspection.md)
- [Project Skills loading](../requirements/project-skills-loading.md)
- [macOS app requirements](../requirements/molibot-macos-app-plan.md)
```

- [ ] **Step 6: Review internal Markdown links**

Run:

```bash
for file in docs/features/*.md; do
  grep -oE '\]\([^)]+' "$file" | sed 's/.*(//' | while IFS= read -r link; do
    case "$link" in
      http*|'#'*) ;;
      *) test -e "$(dirname "$file")/$link" || printf 'Broken: %s -> %s\n' "$file" "$link" ;;
    esac
  done
done
```

Expected: no output.

- [ ] **Step 7: Commit the feature documentation**

```bash
git add docs/features
git commit -m "docs: add user-facing feature guides"
```

Expected: one commit containing only the five new feature pages.

### Task 2: Move Development-Process Documentation

**Files:**
- Move: all paths listed in the File Structure section.
- Modify: moved Markdown files with broken relative links.
- Modify: `features.md:832`
- Modify: `prd.md:80`

**Interfaces:**
- Consumes: Existing process documents and their inbound references.
- Produces: `docs/work/` as the single non-stable home for implementation process materials.

- [ ] **Step 1: Create destination directories**

Run:

```bash
mkdir -p docs/work/{plans,handoffs,progress,reviews,audits}
mkdir -p docs/work/progress/desktop-settings-parity-2026-06-29
mkdir -p docs/work/reviews/macos-web-settings-gap-2026-06-29
```

Expected: all five top-level work directories and the two topic directories exist.

- [ ] **Step 2: Move one-off plan and handoff files with Git**

Run each command:

```bash
git mv docs/designs/2026-07-07-desktop-chat-sidebar-multi-session-plan.md docs/work/plans/2026-07-07-desktop-chat-sidebar-multi-session-plan.md
git mv docs/designs/2026-07-08-desktop-chat-sidebar-slice3-handoff.md docs/work/handoffs/2026-07-08-desktop-chat-sidebar-slice3-handoff.md
git mv docs/designs/2026-07-16-desktop-ui-geist-consistency-plan.md docs/work/plans/2026-07-16-desktop-ui-geist-consistency-plan.md
git mv docs/designs/2026-07-16-native-experience-developer-board.md docs/work/plans/2026-07-16-native-experience-developer-board.md
git mv docs/designs/2026-07-16-web-agent-session-binding-deferred.md docs/work/plans/2026-07-16-web-agent-session-binding-deferred.md
git mv docs/designs/harness-optimization-plan.md docs/work/plans/harness-optimization-plan.md
git mv docs/designs/issue-13-completion-plan.md docs/work/plans/issue-13-completion-plan.md
```

Expected: Git records seven renames; do not edit the untracked root-level `task_plan.md`.

- [ ] **Step 3: Move parity and audit directories with Git**

Run:

```bash
git mv docs/designs/desktop-settings-parity-2026-06-29/findings.md docs/work/progress/desktop-settings-parity-2026-06-29/findings.md
git mv docs/designs/desktop-settings-parity-2026-06-29/progress.md docs/work/progress/desktop-settings-parity-2026-06-29/progress.md
git mv docs/designs/desktop-settings-parity-2026-06-29/task_plan.md docs/work/progress/desktop-settings-parity-2026-06-29/task_plan.md
git mv docs/reviews/macos-web-settings-gap-2026-06-29/findings.md docs/work/reviews/macos-web-settings-gap-2026-06-29/findings.md
git mv docs/reviews/macos-web-settings-gap-2026-06-29/progress.md docs/work/reviews/macos-web-settings-gap-2026-06-29/progress.md
git mv docs/reviews/macos-web-settings-gap-2026-06-29/task_plan.md docs/work/reviews/macos-web-settings-gap-2026-06-29/task_plan.md
git mv docs/audits docs/work/audits
```

Expected: the two long-lived parent directories retain only durable documentation; the audit directory is now under `docs/work/`.

- [ ] **Step 4: Repair known inbound and moved-document references**

Make these exact replacements:

- In `features.md`, change `docs/audits/chat-workspace-2026-07-04/` to `docs/work/audits/chat-workspace-2026-07-04/`.
- In `prd.md`, change `docs/designs/2026-07-16-native-experience-developer-board.md` to `docs/work/plans/2026-07-16-native-experience-developer-board.md`.
- In `docs/work/handoffs/2026-07-08-desktop-chat-sidebar-slice3-handoff.md`, change `docs/designs/2026-07-07-desktop-chat-sidebar-multi-session-plan.md` to `docs/work/plans/2026-07-07-desktop-chat-sidebar-multi-session-plan.md`.
- In `docs/work/progress/desktop-settings-parity-2026-06-29/findings.md`, change `docs/reviews/macos-web-settings-gap-2026-06-29/report.md` to `docs/reviews/macos-web-settings-gap-2026-06-29/report.md`; the string remains the same because that report deliberately remains stable. Confirm no relative-path adjustment is needed.

- [ ] **Step 5: Find and repair remaining old-path references**

Run:

```bash
git grep -nE 'docs/(audits|designs/(2026-07-07-desktop-chat-sidebar-multi-session-plan|2026-07-08-desktop-chat-sidebar-slice3-handoff|2026-07-16-desktop-ui-geist-consistency-plan|2026-07-16-native-experience-developer-board|2026-07-16-web-agent-session-binding-deferred|harness-optimization-plan|issue-13-completion-plan|desktop-settings-parity-2026-06-29)|reviews/macos-web-settings-gap-2026-06-29/(findings|progress|task_plan))' || true
```

Expected: no tracked-file references to old locations. If output remains, replace each reference with the corresponding `docs/work/` location, except references inside untracked files which are out of scope.

- [ ] **Step 6: Verify Git tracks the changes as moves**

Run:

```bash
git diff --summary -- docs/designs docs/reviews docs/work features.md prd.md
```

Expected: rename summaries for moved Markdown and audit files, plus modifications only for updated links.

- [ ] **Step 7: Commit the process-document migration**

```bash
git add docs/designs docs/reviews docs/work features.md prd.md
git commit -m "docs: separate work artifacts from stable docs"
```

Expected: one commit containing the moves and link repairs only.

### Task 3: Rewrite the README as a Product Entry Point

**Files:**
- Modify: `readme.md`

**Interfaces:**
- Consumes: The five feature pages produced by Task 1.
- Produces: A concise root documentation entrypoint, with stable links and no process-level detail.

- [ ] **Step 1: Replace the README with the following content**

```md
# Molibot

<p align="center">
  <img src="./Voldemomo_compressed.jpg" alt="Molibot logo" width="168" />
</p>

<h2 align="center">A memory-first personal AI Agent that grows with your work.</h2>

<p align="center">
  Local-first · Long-running context · Configurable agents · Your data, your control
</p>

<p align="center">
  <a href="https://deepwiki.com/gusibi/molibot">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
  </a>
</p>

Molibot is a local-first personal AI Agent for people who want more than a new chat window. It helps you keep the context that matters—your preferences, projects, conversations, tools, and working habits—under your control and available over time.

It is designed for a personal Agent that can be shaped, reviewed, and improved as your work changes.

## Why Molibot?

Most AI chats start from scratch. Molibot focuses on the work that accumulates.

- **Remember what matters.** Governed memory keeps useful preferences and project context available, while giving you visibility and control over what is saved and injected.
- **Shape your own Agent.** Profiles, Skills, tools, and model routes let you define how an Agent should work instead of relying on one fixed assistant.
- **Work where you already are.** Use one local runtime from Web, macOS Desktop, Telegram, Feishu, Weixin, QQ, or the CLI.
- **Keep execution in your hands.** Tasks, approvals, sandbox policy, and run records make automation visible rather than opaque.
- **Keep the data local.** Your runtime, configuration, conversations, and operational state stay on infrastructure you control.

## What you can do today

| Capability | What it gives you |
| --- | --- |
| [Personal Agent and Memory](docs/features/personal-agent-and-memory.md) | Persistent conversations, governed long-term memory, and isolated project or Agent context. |
| [Channels and Surfaces](docs/features/channels-and-surfaces.md) | One local runtime across browser, macOS Desktop, chat channels, and the terminal. |
| [Tools, Skills, and MCP](docs/features/tools-skills-and-mcp.md) | Configurable Agent behavior and controlled access to reusable workflows and external tools. |
| [Automation, Approvals, and Sandbox](docs/features/automation-approvals-and-sandbox.md) | Scheduled work and execution controls that stay inspectable and reviewable. |
| [Desktop Project Workspace](docs/features/desktop-project-workspace.md) | Native macOS chat, projects, files, automations, and Settings in one local workspace. |

## A personal Agent can grow with you

Momo is Molibot's example of the experience this project is building toward: a personal Agent that learns your working context, remembers the projects you return to, and becomes more useful through review and feedback.

The current runtime already supports durable sessions, memory governance, configurable Agent profiles, tools, tasks, and human control. The next growth-plan experiments build on that foundation with daily conversation reflection, a visible Agent growth log, and human-reviewed content candidates. Those experiments are not automatic publishing features, and they are not required to use Molibot.

## Quick start

### 1. Install

```bash
corepack enable
pnpm install
pnpm link --global
```

### 2. Initialize your local runtime

```bash
cp .env.example .env
molibot init
```

### 3. Start Molibot

```bash
molibot
```

Open `http://localhost:3000`, configure an AI provider, and create or confirm an Agent before starting a chat.

For provider configuration, channels, deployment, and environment variables, see the [documentation](#documentation).

## Available surfaces

| Surface | Use it for |
| --- | --- |
| Web | Browser chat, Settings, and session access. |
| macOS Desktop | Native chat, project workspaces, files, automations, and Settings. |
| Telegram | Personal chat access, runtime controls, and file delivery. |
| Feishu | Personal chat access with channel-native media and interaction support. |
| Weixin | Local personal conversations and media delivery. |
| QQ | Local chat access with rich message and media support. |
| CLI | Terminal-based local conversations. |

## Documentation

### Get started

- [Feature overview](docs/features/)
- [Documentation map](docs/README.md)
- [Environment reference](.env.example)
- [Daily materials guide](docs/guides/daily-materials.md)
- [Session control commands](docs/guides/session-control/session-control-commands.md)

### Build and extend

- [Architecture](docs/designs/architecture/v1-architecture.md)
- [Agent runtime design](docs/designs/architecture/agent-redesign-v2.2.md)
- [Plugin authoring](docs/guides/plugins/plugin-authoring.md)
- [Deferred tool authoring](docs/guides/tools/deferred-tool-authoring.md)
- [Agent development series](docs/agent-dev-series/README.md)

### Track the project

- [Current feature record](features.md)
- [Product roadmap](prd.md)
- [Release notes](CHANGELOG.md)
- [Collaboration and contribution rules](AGENTS.md)

## Current boundaries

- Molibot is designed for local, single-owner deployments. Configure your own model provider and credentials.
- Channel behavior depends on the credentials and integrations you enable locally.
- Treat destructive, credential-bearing, and public actions as reviewed workflows until you have validated them in your own environment.
- Momo's growth-log and content-candidate experiments are under development. Molibot does not publish to external social platforms by default.

## License and support

Use GitHub Issues for bug reports and feature requests, and GitHub Discussions for questions and ideas.
```

- [ ] **Step 2: Check root README links and structure**

Run:

```bash
for link in $(grep -oE '\]\([^)]+' readme.md | sed 's/.*(//' | grep -vE '^(http|#)'); do
  test -e "$link" || printf 'Broken: readme.md -> %s\n' "$link"
done
wc -l readme.md
```

Expected: no `Broken:` lines and a README substantially shorter than the previous 856 lines.

- [ ] **Step 3: Read the README top-to-bottom as a first-time visitor**

Confirm all five questions are answered without following a link:

1. What is Molibot?
2. Who is it for?
3. What does it actually do today?
4. How do I start it?
5. Which document contains detailed help?

Expected: each answer appears in the positioning, capability table, quick start, or documentation sections.

- [ ] **Step 4: Commit the README rewrite**

```bash
git add readme.md
git commit -m "docs: focus README on personal agent experience"
```

Expected: one commit containing only `readme.md`.

### Task 4: Update the Documentation Map and Verify the Final Graph

**Files:**
- Modify: `docs/README.md`
- Test: repository Markdown-link scan

**Interfaces:**
- Consumes: Feature pages from Task 1 and `docs/work/` moves from Task 2.
- Produces: Current documentation taxonomy and stable navigation for users and contributors.

- [ ] **Step 1: Replace `docs/README.md` with this taxonomy**

```md
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
- [Sandbox research and designs](research/sandbox/, designs/sandbox/)
- [Plugin guides and manifest design](guides/plugins/, designs/plugins/plugin-manifest.md)
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
```

- [ ] **Step 2: Scan tracked Markdown links for missing local targets**

Run this Python-free shell check from the repository root:

```bash
find . -path './node_modules' -prune -o -name '*.md' -type f -print0 | while IFS= read -r -d '' file; do
  grep -oE '\]\(([^)#]+)(#[^)]*)?\)' "$file" | sed -E 's/^.*\]\(([^)#]+).*/\1/' | while IFS= read -r link; do
    case "$link" in
      http:*|https:*|mailto:*|'') continue ;;
    esac
    test -e "$(dirname "$file")/$link" || printf 'Broken: %s -> %s\n' "$file" "$link"
  done
done
```

Expected: no output for local Markdown links. Investigate every result; skip links only when the target is intentionally generated outside the repository.

- [ ] **Step 3: Search for obsolete stable references**

Run:

```bash
git grep -nE 'docs/(audits|designs/(2026-07-07-desktop-chat-sidebar-multi-session-plan|2026-07-08-desktop-chat-sidebar-slice3-handoff|2026-07-16-desktop-ui-geist-consistency-plan|2026-07-16-native-experience-developer-board|2026-07-16-web-agent-session-binding-deferred|harness-optimization-plan|issue-13-completion-plan|desktop-settings-parity-2026-06-29)|reviews/macos-web-settings-gap-2026-06-29/(findings|progress|task_plan))' || true
```

Expected: no output. Do not modify untracked `task_plan.md` even if an ordinary `grep` finds its old references.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff --summary
```

Expected: no whitespace errors; existing unrelated changes remain unmodified; moves are represented as renames where Git similarity detection permits.

- [ ] **Step 5: Commit documentation navigation and verification updates**

```bash
git add docs/README.md
git commit -m "docs: organize documentation entrypoints"
```

Expected: one commit containing only the documentation-map update.

## Final Verification

- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run the Task 4 local-link scan and resolve all newly introduced broken links.
- [ ] Re-read `readme.md`, `docs/README.md`, and every `docs/features/*.md` page for factual consistency with the current shipped product.
- [ ] Run `git status --short` and confirm existing source/UI changes remain unstaged and unmodified by this documentation work.
- [ ] Record the documentation reorganization and README repositioning in `features.md` and `CHANGELOG.md` only if the project treats documentation navigation and product positioning as release-summary-worthy changes; otherwise do not add release noise.
