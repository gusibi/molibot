# Molibot

<p align="center">
  <a href="./readme.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./apps/desktop/public/molibot-icon.png" alt="Molibot 图标" width="128" />
</p>

<h2 align="center">记住你的工作背景，帮你把事情做完。</h2>

<p align="center">
  本地运行的个人 AI 助理 · 项目与文件 · 可管理的长期记忆 · 定时任务
</p>

<p align="center">
  <a href="https://github.com/gusibi/molibot/releases/latest">下载 macOS 版</a> ·
  <a href="#quick-start">开始使用</a> ·
  <a href="https://github.com/gusibi/molibot/issues">反馈问题与使用场景</a>
</p>

Molibot 适合希望用 AI 持续推进个人项目、整理资料和处理重复任务的人。你可以围绕本地文件开展工作，查看生成的结果，让助理保留有用的偏好与背景，并把重复工作设成定时任务。

你选择模型，也决定它可以使用哪些工具、访问哪些文件，以及保留哪些记忆。

<p align="center">
  <img src="./assets/screenshots/chat.png" alt="Molibot 桌面工作区：对话与任务过程" width="900" />
</p>

<!-- 配图 1：可将上方主界面图替换为 60～90 秒真实任务演示的 GIF 或视频封面。
建议展示：提供一份资料 → Agent 处理 → 打开最终文件。使用脱敏内容，画面突出输入与结果。
将文件放入 assets/screenshots/，更新上方图片路径；若使用视频封面，为图片添加视频链接。
-->

## 从一件真实的事情开始

### 把资料变成可以继续使用的结果

给 Molibot 一份 PDF、Word 文档或表格，让它提取要点、整理内容，或生成新的文档。你可以在对话旁查看文件和产物，再继续提出修改。

例如，附上一份项目说明后试试：

> 帮我整理这份项目说明中的目标、待办和需要确认的问题，生成一份 Markdown 文件。缺失的信息请标出来。

支持 PDF、DOCX、XLSX 内容提取，以及 DOCX、XLSX、PDF 导出。图片识别需要所选模型支持视觉，或另外配置识别服务。详见[工具与文件处理](docs/features/tools-skills-and-mcp.md)。

<!-- 配图 2：文件处理，建议文件名 assets/screenshots/readme-files.png。
画面同时包含用户提供的资料、处理后的回答和右侧打开的最终产物，避免只截一段聊天文字。
准备好图片后，在此处插入：
![从项目资料到可查看的文件产物](./assets/screenshots/readme-files.png)
-->

### 围绕同一个项目持续工作

把本地目录加入 Project，让相关对话和文件有一个共同的工作空间。项目上下文与普通个人对话分开；长期记忆可以保留有用的偏好和背景，减少重复交代。

例如，在项目对话中提出：

> 阅读这个目录里的项目说明和进度记录，整理当前进展与下一步建议，并注明依据来自哪些文件。

记忆可以查看、编辑和删除，也可以控制某一轮是否进入记忆或后续上下文。它不会保证记住每句话，也不能替代项目的源文件。详见[项目工作区](docs/features/desktop-project-workspace.md)和[个人助理与记忆](docs/features/personal-agent-and-memory.md)。

<!-- 配图 3：项目与记忆，建议文件名 assets/screenshots/readme-project.png。
展示一个脱敏的真实项目：左侧项目会话、当前任务与右侧文件；若展示记忆，使用真实已保存的条目。
准备好图片后，在此处插入：
![在同一个项目中继续工作](./assets/screenshots/readme-project.png)
-->

### 让重复工作按时开始

在 Automations 中创建一次性或周期任务，查看运行记录和结果。Project 也可以拥有自己的定时任务，使用该项目的上下文，结果留在应用内。

例如，为存放工作记录的 Project 创建每周任务：

> 每周五整理本项目本周的工作记录，生成一份周报草稿，列出完成事项和待确认的问题。

本地运行时需要保持运行，模型和相关服务需要可用。电脑关机或休眠时无法准时执行；恢复后的处理取决于任务类型与补跑规则，详见[定时任务执行与恢复](docs/features/scheduled-task-execution-and-recovery.md)。

如果你经常在 Molibot 中讨论工作，还可以启用[每日素材](docs/guides/daily-materials.md)，从已授权的会话中整理素材并保存到指定 Project，供复盘或写作使用。

## 按你的工作方式扩展

- **选择模型**：连接支持的模型账号、API Key 或自定义兼容接口；在设置中管理，在对话中选择模型。
- **从聊天工具访问**：可配置 Telegram、飞书、微信和 QQ，共用本地运行时；各渠道需要自己的凭据和连接设置。
- **增加工具与工作流程**：通过 Skills、MCP 和 OpenConnector 接入所需能力。具体外部服务需要单独配置。
- **使用 Mini App**：安装笔记、待办、会议记录、Markdown 预览等小工具，也可以让 Agent 帮你创建个人应用。见[Mini App 指南](docs/guides/miniapps/authoring.md)。
- **控制执行权限**：通过权限模式、审批和运行记录检查 Agent 的操作，并在需要时停止任务。

<a id="quick-start"></a>

## 开始使用

### 下载 macOS 版

需要 Apple Silicon Mac，以及一个可用的模型账号或 API Key。当前下载入口以 [Releases 中实际提供的安装包](https://github.com/gusibi/molibot/releases/latest)为准。

1. 下载 `Molibot_*_aarch64.dmg`，安装并打开应用。本地运行时会自动启动。
2. 在 **设置 → AI Providers（模型提供商）** 中，连接支持的账号或填写 API Key，并选择可用模型。
3. 打开与默认助理 Momo 的对话，附上一份真实资料，尝试上面的文件整理任务。
4. 查看结果并提出一次修改；需要围绕本地目录长期工作时，再创建 Project。

如果连接失败，先在模型提供商设置中测试连接，检查账号授权、额度和接口配置。

### 从源码运行

需要 Git、Node.js 22.19 或更新版本，以及 Corepack。下面的命令使用仓库指定的 pnpm 版本：

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

打开 `http://localhost:3040`，配置模型提供商，创建或确认 Agent，然后开始对话。默认数据目录为 `~/.molibot`；环境配置见 [.env.example](.env.example)。

## 使用前了解这些边界

- **模型费用**：Molibot 不附送模型额度。模型或第三方服务的费用与使用限制由相应提供商决定。
- **本地数据与外部请求**：配置、对话和运行记录保存在本地。使用云端模型时，任务所需的消息、文件内容和相关记忆会发送给所选模型服务；外部工具也会向对应服务发送请求。本地运行不等于完全离线。
- **个人使用**：当前面向单一使用者的本地部署。桌面发布以 macOS 为主，其他平台可尝试源码运行，不代表已有同等桌面支持。
- **任务结果**：模型输出仍需核对。对外发送、公开发布或破坏性操作应先检查内容与权限；Molibot 不会默认替你发布社交内容。

## 反馈与参与

如果你愿意试用，请带一个自己确实要完成的任务。无论成功还是卡住，都欢迎通过 [GitHub Issues](https://github.com/gusibi/molibot/issues)告诉我：

- 你原本想完成什么，以及平时怎么做。
- 卡在哪一步，或结果哪里不符合预期。
- 使用的平台、Molibot 版本与模型；可附上脱敏截图或错误信息，请勿提交密钥和私人资料。

使用案例、文档改进、Bug 修复和代码贡献都欢迎。开发前请阅读[协作约定](AGENTS.md)。

## 文档与项目进展

- [文档导航](docs/README.md) · [功能说明](docs/features/)
- [当前能力与边界](docs/requirements/personal-assistant-capability-matrix.md) · [发布记录](CHANGELOG.md)
- [交付记录](features.md) · [需求与计划](prd.md)
- [Skills、工具与 MCP](docs/features/tools-skills-and-mcp.md) · [插件开发](docs/guides/plugins/plugin-authoring.md)
- [架构决策](docs/adr/) · [Agent 开发系列](docs/agent-dev-series/README.md)
