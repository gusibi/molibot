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
| macOS Desktop | Native chat, project workspaces, files, automations, and Settings with shared inset window chrome. |
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
