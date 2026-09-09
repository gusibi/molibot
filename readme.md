# Molibot

<p align="center">
  <strong>English</strong> · <a href="./readme.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./apps/desktop/public/molibot-icon.png" alt="Molibot icon" width="128" />
</p>

<h2 align="center">An AI assistant that remembers your work and helps you finish it.</h2>

<p align="center">
  Runs locally · Projects and files · Memory you control · Scheduled tasks
</p>

<p align="center">
  <a href="https://github.com/gusibi/molibot/releases/latest">Download for macOS</a> ·
  <a href="#quick-start">Get started</a> ·
  <a href="https://github.com/gusibi/molibot/issues">Share feedback</a>
</p>

Molibot is a personal AI assistant for ongoing projects, document work, and recurring tasks. Work with local files, inspect the results, keep useful preferences and context in memory, and schedule work you repeat.

You choose the model and control which tools, files, and memories the assistant can use.

<p align="center">
  <img src="./assets/screenshots/chat.png" alt="Molibot desktop workspace showing a conversation and task progress" width="900" />
</p>

<!-- IMAGE 1: Replace the image above with a GIF or linked video cover for a 60–90 second real task demo.
Show: provide a document → the Agent processes it → open the resulting file. Use sanitized material.
Save the asset in assets/screenshots/ and update the image path above; link a video cover to the video.
-->

## Start with something you need done

### Turn documents into usable results

Give Molibot a PDF, Word document, or spreadsheet to extract key points, organize information, or create a new document. Inspect files and outputs beside the conversation, then ask for changes.

For example, attach a project brief and try:

> Extract the goals, action items, and open questions from this project brief into a Markdown file. Flag any missing information.

Molibot supports PDF, DOCX, and XLSX extraction, plus DOCX, XLSX, and PDF export. Image recognition needs a vision-capable model or a separately configured recognition service. See [tools and document processing](docs/features/tools-skills-and-mcp.md).

<!-- IMAGE 2: File workflow. Suggested path: assets/screenshots/readme-files.png.
Show the input document, the response, and the final artifact open in the right panel, rather than only chat text.
When ready, insert here:
![From project documents to an inspectable output file](./assets/screenshots/readme-files.png)
-->

### Keep working on the same project

Add a local folder as a Project to keep its conversations and files in one workspace. Project context stays separate from ordinary personal conversations; long-term memory can retain useful preferences and background so you repeat less setup.

For example, ask in a project conversation:

> Read this folder's project brief and progress notes. Summarize the current status and suggest next steps, citing the source files.

You can inspect, edit, and delete memories, and control whether a turn enters memory or future context. Memory does not guarantee recall of every message or replace your source documents. See [Project workspaces](docs/features/desktop-project-workspace.md) and [personal Agent and memory](docs/features/personal-agent-and-memory.md).

<!-- IMAGE 3: Project and memory. Suggested path: assets/screenshots/readme-project.png.
Show a sanitized real project: project conversations, the current task, and its files. If showing memory, use an actual saved entry.
When ready, insert here:
![Continuing work in a project workspace](./assets/screenshots/readme-project.png)
-->

### Put recurring work on a schedule

Create one-time or recurring tasks in Automations, then inspect their run history and results. Projects can also have scheduled tasks that use their own context and keep results inside the app.

For example, create a weekly task for a Project containing your work notes:

> Every Friday, summarize this week's project notes into a draft status report, including completed work and open questions.

The local runtime must be running, with the model and required services available. Tasks cannot execute on time while the computer is asleep or off; recovery depends on the task type and catch-up rules. See [scheduled task execution and recovery](docs/features/scheduled-task-execution-and-recovery.md).

If you regularly discuss your work in Molibot, you can also enable [Daily Materials](docs/guides/daily-materials.md) to turn authorized conversations into source material in a selected Project for reflection or writing.

## Adapt it to your workflow

- **Choose your model.** Connect a supported model account, API key, or custom compatible endpoint. Manage providers in Settings and select models in conversations.
- **Use chat channels.** Configure Telegram, Feishu, Weixin, or QQ to access the same local runtime. Each channel needs its own credentials and connection setup.
- **Add tools and workflows.** Extend the assistant through Skills, MCP, and OpenConnector. Individual external services need separate configuration.
- **Use Mini Apps.** Install tools for notes, todos, meeting notes, or Markdown preview, or ask the Agent to help create a personal app. See the [Mini App guide](docs/guides/miniapps/authoring.md).
- **Control execution.** Use permission modes, approvals, and run records to inspect Agent actions and stop tasks when needed.

## Quick start

### Download for macOS

You need an Apple Silicon Mac and a working model account or API key. Check [Releases](https://github.com/gusibi/molibot/releases/latest) for the currently available installers.

1. Download `Molibot_*_aarch64.dmg`, install, and open the app. The local runtime starts automatically.
2. In **Settings → AI Providers**, connect a supported account or enter an API key, then choose an available model.
3. Open a conversation with Momo, the default assistant. Attach a real document and try the document task above.
4. Inspect the output and ask for a revision. Create a Project when you want to keep working with a local folder.

If the connection fails, test it in the provider settings and check account authorization, available quota, and endpoint configuration.

### Run from source

Requires Git, Node.js 22.19 or newer, and Corepack. These commands use the pnpm version specified by the repository:

```bash
git clone https://github.com/gusibi/molibot.git
cd molibot
corepack enable
pnpm install
pnpm link --global
cp .env.example .env
molibot init
molibot
```

Open `http://localhost:3040`, configure a model provider, create or confirm an Agent, and start chatting. The default data directory is `~/.molibot`; see [.env.example](.env.example) for environment configuration.

## Before you start

- **Model costs.** Molibot does not include model credits. Model and third-party service providers set their own fees and usage limits.
- **Local storage and external requests.** Configuration, conversations, and run records are stored locally. Cloud models receive the messages, file content, and relevant memories needed for a task; external tools also send requests to their services. Running locally does not mean fully offline.
- **Personal use.** Molibot targets single-owner local deployments. Desktop releases focus on macOS. Other platforms can try running from source; this does not imply equivalent desktop support.
- **Review results.** Model output needs verification. Check content and permissions before external delivery, public publishing, or destructive actions. Molibot does not publish social content by default.

## Feedback and contributions

Try Molibot with a task you actually need to finish. Whether it works or gets stuck, share your experience through [GitHub Issues](https://github.com/gusibi/molibot/issues):

- What you wanted to accomplish and how you usually do it.
- Where you got stuck, or what the output got wrong.
- Your platform, Molibot version, and model. Sanitized screenshots or errors help; do not include keys or private data.

Use cases, documentation improvements, bug fixes, and code contributions are welcome. Read the [contribution guidelines](AGENTS.md) before development.

## Documentation

- [Documentation map](docs/README.md) · [Feature guides](docs/features/)
- [Current capabilities and boundaries](docs/requirements/personal-assistant-capability-matrix.md) · [Release notes](CHANGELOG.md)
- [Delivery record](features.md) · [Requirements and plans](prd.md)
- [Skills, tools, and MCP](docs/features/tools-skills-and-mcp.md) · [Plugin development](docs/guides/plugins/plugin-authoring.md)
- [Architecture decisions](docs/adr/) · [Agent development series](docs/agent-dev-series/README.md)
