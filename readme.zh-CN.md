# Molibot

<p align="center">
  <a href="./readme.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./apps/desktop/public/molibot-icon.png" alt="Molibot logo" width="168" />
</p>

<h2 align="center">一个与您的工作共同成长的记忆优先的个人 AI 智能体 (Agent)。</h2>

<p align="center">
  本地优先 · 长期上下文运行 · 可配置的智能体 · 数据自主掌控
</p>

<p align="center">
  <a href="https://github.com/gusibi/molibot/releases/latest">
    <img src="https://img.shields.io/github/v/release/gusibi/molibot?label=Download&color=blue" alt="Download latest release">
  </a>
  <a href="https://deepwiki.com/gusibi/molibot">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
  </a>
</p>

<p align="center">
  <img src="./assets/screenshots/chat.png" alt="Molibot desktop chat" width="800" />
</p>

Molibot 是一个本地优先的个人 AI 智能体，适合那些不仅想要一个新聊天窗口的人。它基于两个承诺构建：

- **当前版本**：v2.9.14 (Desktop v0.9.11)

- **易于上手**：下载 macOS 应用，选择一个模型提供商即可开始聊天——一个运行时即可服务于桌面端、网页端、Telegram、飞书、微信、QQ 和命令行界面。
- **与您共同成长**：受管辖的长期记忆、每日记忆反思以及可审查的自动化任务，意味着智能体随着时间的推移学习您的偏好、项目和习惯——并且您始终能查看和控制它所记住的内容。

## 🚀 最新升级中的主要特性 (V2.8+)

本次发布引入了两个重大的运行时和 UI 支柱，使得 Molibot 更加强大且易于扩展：

### 🔌 OpenConnector：统一的第三方集成
OpenConnector 深度融合 Cloudflare 与 Molibot，轻松连接各种外部服务，支持安全的运行时凭据配置及已连接账号的自动发现。
- **本地优先且安全**：保存的访问令牌会安全地存放在您的本地工作区中，绝不会包含在摘要中发送，也不会暴露给常规 LLM 提示词。
- **智能体网关集成**：配置完成后，它将为您的智能体派生出一个受管理的、实时的远程 MCP 连接，自动注册已连接的服务，无需任何手动配置。
- **分类过滤目录**：通过响应迅速的双栏设置界面浏览第三方提供商，支持分类计数、活动状态指示以及官方主页安全跳转。

### 📦 小程序平台：本地优先的应用运行时
Molibot 现在可以直接在桌面客户端和智能体循环中运行**小程序 (Mini Apps)**，让您可以轻松扩展智能体的工具和界面。
- **托管 UI 与统一运行时**：小程序运行在私有本地源下高度隔离的 iframe 沙箱中，与后台智能体工具共享同一个状态模块和 SQLite 数据库。
- **自动安装与源头验证**：支持从本地文件夹、`.zip` 压缩包或 GitHub 仓库一键安装。清单与目录校验在安装和升级期间充分保护主机系统。
- **统一的输入框集成**：在输入框中通过输入 `@app-id`（带语法高亮气泡）即可定向调用已安装的小程序，或在侧边栏的“小程序”部分查看和打开最近使用的应用。
- **可直接使用的参考应用**：Todo 展示确定性任务收集；Note 支持安全 Markdown 阅读，并能在面板保持打开时自动呈现 Agent 写入；Meeting Notes 提供聚焦的录音棚式现场页，原生支持暂停/继续并明确展示麦克风与保存状态，把 10 秒音频块转成实时文字和滚动纪要，并把完成会议保存在可搜索、可按状态筛选的历史库中。
- **开发者脚手架**：内置了 `miniapp-creator` 技能和智能体模板，提供可运行的模板、SQLite 事务突变以及代码生成脚手架。

## 为什么选择 Molibot？

大多数 AI 聊天应用每次都从零开始。而 Molibot 专注于日常累积的工作资产。

- **记住重要的事**：受管的记忆让有用的偏好和项目上下文随时可用，同时让您对保存和注入的内容保持绝对的知情与控制。
- **量身定制您的智能体**：通过配置文件、技能、工具和模型路由，您可以自己定义智能体的工作方式，而不是局限于固定的助手。
- **保持每个会话在所选的模型上运行**：聊天模型的选择是会话（Session）范围的，在重启后依然持久化，而设置（Settings）依旧是更改全局默认值的明确位置。
- **在输入框中直接选择模型和思考深度**：一个精美的集成主题菜单取代了桌面端和项目聊天中零散的下拉框，同时保留了每个会话的模型选择。
- **在所有地方使用一致的控件**：桌面端设置、项目设置和新手引导共享同一个美观易用、支持明暗主题的主机风格选择菜单，支持独立的行点击、键盘导航、勾选状态以及支持长模型名称的自适应宽度。
- **在无视觉干扰下保持聊天上下文可见**：垂直对齐的 `# source / title` 头部可以轻松区分 Web、飞书、Telegram、QQ、微信和项目会话；其整个被动区域都支持拖拽本地窗口，安全缩进且与设置页共用 `228px` 导航基线的紧凑侧边栏让常用目的地触手可及，旧的窄于基线的保存值会自动钳回，上下文时间戳会在消息非今天发出时加上昨天或日期。
- **无需重复的界面即可审查外部会话**：只读的 Telegram、飞书、QQ 和微信消息流在底部有一行安静的状态栏，合并了来源和桌面端的只读状态。
- **在长侧边栏中保持定位**：会话和项目共享一个吸顶的头部插槽，因此可见的标题会随着当前滚动的区域自动变换，不会堆叠多余的元素。
- **像打开真正应用一样打开小程序**：桌面端在受限的 720px 小程序管理器、侧边栏最近 10 个应用的快速列表中呈现清单图标，支持在发现库里统一进行安装、启用/禁用、打开和删除。
- **通过构建凭证而不是承诺来构建小程序**：小程序生成器在会话临时空间中进行构建，在临时数据中进行运行时烟雾测试，通过共享的管理器原子化地安装，并在报告完成前读取已安装的版本和清单哈希值。
- **信任每条消息所显示的内容**：桌面端消息流保留了真正的响应模型以及提供商错误和已完成的回答，同时消息中的链接会在系统默认浏览器中安全打开，而不会导致 Molibot 页面跳转。
- **通过 prompt 轨道在长对话中穿梭**：桌面端聊天、项目聊天和外部聊天记录在超过 5 轮后，会在左侧边栏提供一个极简的用户 prompt 轨道，支持 Dock 风格的悬浮预览、易读的文本/回复预览、键盘操作和流式渲染；Web 渠道行还提供直接新建 Session 的加号，外部渠道不显示该动作。
- **使用每个模型的真实思考深度**：内置模型支持 pi 0.84.3 的细粒度模型层级；自定义模型和无元数据的内置模型暴露全部 7 种 canonical 级别（`off / minimal / low / medium / high / xhigh / max`），无需猜测转换。
- **在不丢失上下文的情况下配置提供商**：Web 端和桌面端使用相同的可搜索的提供商工作区，可一目了然连接/鉴权状态以及支持过滤的模型库；保存后的新模型会立即在聊天模型下拉中出现，无需重启。
- **跟随 Pi 模型目录并精细调整自定义请求**：内置 Provider/模型候选由共享 Pi registry 派生；自定义模型可持久化请求级 JSON sampling 参数。Pi 请求 telemetry、原始终止原因与明确结束轮次信号会关联到现有 Run Trace。
- **独立配置图片生成与识别**：Web 与桌面端图片设置均提供“图片生成 / 图片识别”双页签。视觉主模型直接读取原图，文本模型通过 `read(path, prompt)` 按需调用多个有序 API 引擎；引擎测试、容灾顺序、重启持久化和桌面服务恢复均可在设置中管理。桌面端多引擎编辑时保持展开，页签与共享设置内容列对齐；本地 CLI 适配器留到第二期。
- **无需重启 Molibot 即可恢复本地 MCP 工具**：网页端和桌面端可清晰区分配置启用状态与实时连接状态，显示断连/错误细节，并提供即时启用、禁用、重连和删除控制；重启后的 MCP 服务会以新客户端重连，智能体工具的暴露依然保持显式开关门槛。
- **在不破坏历史的前提下探索**：编辑并重新发送较早的聊天轮次会在主聊天中生成一个子会话，保留原本的聊天路线不受干扰。
- **在您现有的工作环境中使用**：直接在 Web 端、macOS 桌面端、Telegram、飞书、微信、QQ 或命令行界面（CLI）使用同一个本地运行时。
- **在共享边界诊断媒体故障**：语音转文字错误会在所有渠道中携带安全的提供商/模型、音频参数、耗时和上游链路追踪细节，同时不记录任何凭证或 cookie。
- **将执行权留在自己手中**：任务、审批、沙箱策略和运行记录使得自动化工作流完全可见，而不是像个黑盒。
- **在隔离不可用时安全关闭**：在启用 Bash 沙箱时，若沙箱缺失或启动失败，会直接阻止命令执行，而不会在宿主机上运行。宿主机执行需要明确选择关闭沙箱或通过 Host Bash 的手动审批。
- **无需面对大片日志，高效过滤和排查问题**：桌面端服务日志将 LLM 调用、工具使用、子智能体工作、严重性级别、状态以及运行关联性完美分离；每一行都支持查看格式化的 JSON 或原始文本，长 ID 在列表中以缩略形式展示。当前活跃日志文件到 20 MiB 时会自动滚动并保留 5 个归档，与 SQLite Trace 保持独立。
- **让长期任务安全失败**：父任务与派生任务的预算相互独立，已完成的工具结果在上下文恢复后依然保留，中断的入站任务会等待手动重试，而不会凭空消失或自动重试产生副作用。
- **保留每次生成的完整答复**：当一个智能体运行生成了主要回答和终端补充时，聊天界面会全部展示，而不是让最后一条消息覆盖之前的成果；完成后，思考与工具过程统一折叠为一行可展开摘要。
- **让每条消息都留在阅读列内**：长文本与连续路径自然换行；代码、表格、公式、图表和 diff 在自己的模块内横向滚动，不会再撑宽 Chat 或 Project Chat。
- **让 Skill 调用保持语义**：选中的 Skill 在聊天记录中显示为 Skill 卡片及用户请求；Agent 仍能读取权威文件引用，但本机路径不会作为普通消息正文展开。
- **本地保存所有数据**：您的运行时、配置、对话和运行状态全部存放在您自己控制的基础设施中。

## 快速开始

### 选项 A · 下载 macOS 应用（推荐）

1. 从 [Releases 页面](https://github.com/gusibi/molibot/releases/latest) 下载最新的 `Molibot_*.dmg` (适用于 Apple Silicon)。
2. 打开应用。Molibot 会自动启动其本地运行时——无需任何终端配置。
3. 在 **Settings → AI Providers (设置 → AI 提供商)** 中，通过 **Sign in now (立即登录)** 登录受支持的账户（包括 Kimi Coding、ChatGPT/Codex、Claude、Copilot、OpenRouter、Radius 和 xAI），或直接添加您的 API key。
4. 开始和 Momo (首次打开的默认智能体) 聊天。应用也可以常驻菜单栏在后台运行。

### 选项 B · 源码运行

需要 Node.js 22.19 或更高版本。macOS 桌面发布版已自动打包并锁定了 Node 22.23.1 运行时。

```bash
corepack enable
pnpm install
pnpm link --global

cp .env.example .env
molibot init
molibot
```

然后在浏览器中打开 `http://localhost:3040`，配置 AI 提供商，并在开始聊天前创建或确认一个智能体。

Molibot 使用 pi-mono 0.84.3 作为统一的服务运行时：内置模型目录、API-key/OAuth 解析、主/子智能体流式传输、会话精简和可读上下文 ID 共享上层相同的处理流程。新的常规会话在网页端、桌面端、项目和聊天渠道中均采用 `s-YYYYMMDD-xxxx` 命名规则；自动化任务上下文使用 `t-YYYYMMDD-xxxx`，原有的 UUID、`fork-*` 和 `task-*` 等历史 ID 依然保持可读。OAuth 认证提供商可通过 Web 端或桌面设置，使用浏览器、设备码或手动重定向等流程进行连接；常规的 Moonshot 国内/国际端点仍使用 `MOONSHOT_API_KEY`，Kimi 订阅登录仍使用 `kimi-coding`。自定义的 OpenAI 和 Anthropic 兼容端点保持隔离，保存在其独立的智能体/设置快照中，系统提示词保存在 pi 的顶层上下文而非序列化为对话消息。OpenAI 兼容端点会根据选定的自定义模型中保存的 `supportedRoles` 来选择 `system` 或 `developer` 角色，而不是从 SDK URL 启发式分析。

关于提供商配置、渠道、部署和环境变量，请参阅[文档](#文档)。

## 深入探索

### 为您的智能体打造的一站式工作空间

Agent City (智能体城市) 为每个智能体提供一席之地——您可以一目了然看清谁在值班和工作，点击某一楼层即可查看该智能体的实时状态细节。

<p align="center">
  <img src="./assets/screenshots/agents.png" alt="Agents — 任务调度中心" width="800" />
</p>

### 一个按计划学习您偏好的智能体

类似于**每日记忆反思 (Daily Memory Reflection)** 的系统任务会总结最近的对话并提取长久记忆——因此，随着您的频繁使用，智能体将变得越来越得心应手。您自己的自动化和一次性任务也会和它们并排排列，并附带完整的运行历史记录。

<p align="center">
  <img src="./assets/screenshots/auto-tasks.png" alt="Auto tasks — 自动化和系统任务" width="800" />
</p>

### 清晰易懂的设置界面

语言、启动行为、菜单栏模式、通知和外观——全部以简单的语言说明，并且每个页面都解释了其共享的范围。表单控件尺寸统一，时间字段在可用时会自动调用主机的原生时间选择器。记忆反思和每日材料共享同一个授权的 Telegram/飞书推送目的地，可从任何一个卡片进行配置，同时保留独立的通知开关。

<p align="center">
  <img src="./assets/screenshots/setting-general.png" alt="Settings — 通用设置" width="800" />
</p>

### 准确掌握智能体的费用成本

本地使用量仪表盘可以跟踪请求、Token 趋势、缓存命中率和 Token 分布情况——仅统计总量，没有任何凭证会离开您的机器。模型/智能体/渠道控件在一行中紧凑、均匀排布，在最小窗口下也不会重叠，而 Trace (追踪) 将精准的诊断 ID 放在一个低对比度的“更多过滤器”折叠面板后。

<p align="center">
  <img src="./assets/screenshots/setting-usage.png" alt="Settings — 使用量仪表盘" width="800" />
</p>

## 今日立即可用的能力

| 能力 | 带来的价值 |
| --- | --- |
| [个人智能体和记忆](docs/features/personal-agent-and-memory.md) | Momo 作为默认智能体，内置多种模板（如职场英文教练），受管辖的长期记忆，以及隔离的项目或智能体上下文。 |
| [智能体能力矩阵](docs/requirements/personal-assistant-capability-matrix.md) | 工作/生活助理能力的唯一四态现状视图（已交付 / 部分交付 / 待验证 / 未开始）。 |
| [自动持久化长任务](docs/requirements/automatic-durable-execution-prd.md) | 可持久化、可检查的长任务基础能力，包含已接受 Plan 的逐步执行、分层惰性升级、虚拟 Web profile 路由、版本化进度、副作用回执、失败关闭式恢复、受限且标记为不可信的证据读取、来源渠道审批、短句柄控制和桌面端状态展示；完整冷启动/跨渠道验收仍待完成。 |
| [会话权限模式](docs/requirements/permission-modes-prd.md) | Plan、Manual、Accept edits 与 Auto 四档独立输入控件，包含推理前工具收窄、artifact checklist、统一决策和同 Session 的 Durable 分步续跑。 |
| [渠道与界面](docs/features/channels-and-surfaces.md) | 统一的本地运行时，同时支持浏览器、macOS 桌面端、各类聊天渠道和终端。 |
| [工具、技能与 MCP](docs/features/tools-skills-and-mcp.md) | 可配置的智能体行为，控制对可复用工作流 and 外部工具的访问。 |
| [OpenConnector](docs/requirements/openconnector-cloudflare-and-molibot-plan.md) | 使用安全的运行时令牌连接第三方服务，并支持动态的远程 MCP 集成。 |
| [小程序平台](docs/guides/miniapps/authoring.md) | 安装并运行本地优先的应用，提供自定义智能体工具、托管 UI 以及数据库隔离。 |
| [项目自动任务](docs/requirements/project-automations-prd.md) | 限定在项目内的周期 Runtime 任务：watched JSON 调度、当前项目上下文、全新应用专属 Session、共享桌面端 CRUD/历史，不经过 Bot 或渠道投递。 |
| [插件自有设置](docs/requirements/plugin-owned-settings-prd.md) | 部分交付的插件契约：Web 与原生桌面端提供相同的四条目目录和专属页面、独立存储、主题/高度感知且防克隆的自定义 UI 托管，以及 External Subagent 参考迁移（环境门控启用 + 按 Provider 失败关闭执行）；enhanced-pi 安装与其余迁移在此文档跟踪。 |
| [外部子代理](docs/requirements/plugin-owned-settings-prd.md) | 通过内置插件将 OpenAI Codex 或 Claude Code 作为一次性子代理运行：PATH 检测或按需安装二进制、JSON-RPC 传输、双语主题感知设置（检测/安装/测试）以及保留配置和数据的升级。 |
| [自动化、审批与沙箱](docs/features/automation-approvals-and-sandbox.md) | 计划任务和执行控制，保持完全的可审查和可追溯。 |
| [桌面端项目工作区](docs/features/desktop-project-workspace.md) | 原生 macOS 聊天、项目、文件、智能体城市、自动化和设置等融于一体的本地工作区，每个项目轮次有稳定的实时答复，以及 Finder 风格的原生侧边栏素材。 |

在桌面端，可在 **Settings → Tools → OpenConnector** 下使用 OpenConnector。其连接设置在不需要时保持折叠；紧凑的本地缓存目录展示了分类计数、活动服务和提供商图标，支持手动刷新和保存令牌的显式展示/隐藏，可以打开提供商设置，并通过内置的只读技能将实时的托管远程 MCP 暴露给智能体。参见 [部署与集成设计](docs/requirements/openconnector-cloudflare-and-molibot-plan.md)。
提供商目录采用双列布局，配有紧凑的可搜索/状态/多分类筛选栏；选择多个分类将包含符合其中任意一个分类的提供商。
每个提供商卡片有独立的边界，奇数的搜索结果依然能保持整齐的留白，不会渲染空白的占位行。
提供商信息保持左对齐，连接状态和管理操作组合形成一致的右对齐组。
当 OpenConnector 提供商提供了官方主页时，其图标和名称支持在默认浏览器中安全打开官方网址。
启用并配置好之后，衍生的 `open-connector` 服务也会作为 Managed 标签显示在 **Settings → Tools → MCP** 中，支持在此处重新连接；具体配置仍然在 OpenConnector 页面中管理。

项目运行会在项目工作区中生成 `SYSTEM_PROMPT.preview.md`。其头部仅列出当前生效的提示词来源：项目规则来自 `AGENTS.md`、`AGENT.md` 或 `CLAUDE.md`；运行时上下文保留 `USER.md`，但不包含 Bot/智能体标识和人格特征快照。
当用户显式调用某项技能时，该选择优先于自动生成的路由规则；否则，多媒体、当前信息和定时提醒的请求在调用通用技能发现前，会优先使用对应的运行时工具。

## Molibot 如何与您共同成长

Momo 是 Molibot 致力于构建的体验的典范：一个了解您工作上下文、记住您常去项目的个人智能体，并在您的审查与反馈中变得越来越实用。

具体的过程如下：

1. **您只需像平常一样工作与聊天**——在桌面端、网页端或任何相连的渠道上，不论是在共享空间还是在隔离的上下文中。
2. **Molibot 每日进行反思**——系统任务会回顾近期的对话，生成有关您偏好、项目和习惯的耐久记忆。
3. **您始终保持控制权**——记忆是完全受管的：您可以审查、编辑和删除保存的任何内容，并实时查看每次会话被注入了什么上下文。
4. **智能体变得更加敏锐**——未来的会话将直接带入相关的上下文，不再需要每次从零开始。

当前的运行时已经支持持久的会话、记忆管辖、可配置的智能体配置文件、工具、任务和人工控制。下一步的成长计划实验会在此基础上构建，展示可见的智能体成长日志和人工审查的候选内容。这些实验不会自动公开发布，并且使用 Molibot 也并非强求启用它们。

## 支持的界面

| 界面 | 适用场景 |
| --- | --- |
| macOS 桌面端 | 原生聊天、项目工作空间、文件、自动化和设置。配合 WKWebView 安全的、Finder 校准的 Light 侧边栏材质，在明亮、暗黑和系统外观下使用 AppKit 衍生的语义颜色。 |
| Web 端 | 浏览器对话、设置和会话访问。 |
| Telegram | 个人对话访问、运行时控制以及文件传输。 |
| 飞书 | 个人对话访问，支持渠道原生的富媒体和交互。 |
| 微信 | 本地个人会话与富媒体交付。 |
| QQ | 本地聊天访问，支持富消息和媒体传输。 |
| CLI | 基于终端的本地聊天会话。 |

对话是互通的：在 Web 端开始的聊天可以在桌面端继续，不同的渠道会话共享同一个本地运行时和记忆库。

## 文档

### 开始使用

- [特性总览](docs/features/)
- [文档地图](docs/README.md)
- [环境变量参考](.env.example)
- [每日材料指南](docs/guides/daily-materials.md)
- [会话控制命令](docs/guides/session-control/session-control-commands.md)
- [自动持久化长任务 PRD](docs/requirements/automatic-durable-execution-prd.md)
- [会话权限模式 PRD](docs/requirements/permission-modes-prd.md)

### 开发与扩展

- [架构设计](docs/archive/designs/v1-architecture.md)
- [智能体运行时设计](docs/designs/architecture/agent-redesign-v2.2.md)
- [插件开发指南](docs/guides/plugins/plugin-authoring.md)
- [小程序开发指南](docs/guides/miniapps/authoring.md) —— 在草稿中开发、验证运行时并原子化地安装一个自带智能体工具、UI 和数据隔离的小程序。
- [小程序快捷调用](docs/guides/miniapps/authoring.md#using-an-installed-mini-app) —— 使用 `/miniapps` 列出应用，接着用 `@app-id` 在单次会话中定向调用工具。
- [延迟加载工具开发](docs/guides/tools/deferred-tool-authoring.md)
- [智能体开发系列文章](docs/agent-dev-series/README.md)

### 追踪项目进展

- [当前功能清单](features.md)
- [产品路线图](prd.md)
- [版本发布日志](CHANGELOG.md)
- [UI 设计指南](DESIGN.md) & [深色主题规范](design.dark.md)
- [协作与贡献规则](AGENTS.md)

## 当前局限

- 桌面端应用目前仅发布了适用于 macOS Apple Silicon 的版本；其他平台可以通过源码编译运行。
- Molibot 专为本地单用户部署设计。请自行配置您自己的模型提供商和密钥凭证。
- 渠道的消息收发表现取决于您在本地启用和配置的证书和集成。
- 请将涉及删除、写入证书以及公共网络的操作视为需要人工确认的工作流，直到您已在自己环境中进行过验证。
- Momo 的成长日志与内容候选实验尚处于开发阶段。Molibot 默认情况下绝不会向外部社交平台发布任何内容。

## 许可与支持

如遇 Bug 反馈或功能建议，请使用 GitHub Issues，进行交流或提问请使用 GitHub Discussions。
