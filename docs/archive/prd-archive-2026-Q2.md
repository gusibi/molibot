# Molibot PRD Archive - 2026 Q2

## 2.21 Scope Clarification (2026-06-30)
- [Done] macOS Settings 左侧导航分类与 Web `/settings` 对齐为总览、AI 引擎、渠道、助手数据、系统五组；Desktop 独有的运行环境和诊断归入系统组。
- [Done] Agent、MCP、外部渠道、Web Profile、Memory 记录和任务编辑使用带固定标题/操作区的独立可滚动窗口，不再在设置主列表中内联展开；开关、下拉框和模块间距继续遵循 `Momo for Mac (standalone).html` 与 `DESIGN.md`。
- [Done] 逐页检查全部 22 个 Desktop 设置入口：补齐卡片组间距、受控图片尺寸/时区选择、TTS 默认折叠、运行历史筛选、双语渠道名、窄窗口命令换行，并移除 Web Profile 列表内联重命名入口。
- [Done] Desktop 设置的页面标题、导航项、主题选项和动态标签必须在中英切换时立即更新；依赖通过 helper 参数显式传入，避免 Svelte 5 无法追踪无参数/隐藏响应式依赖。

## 2.20 Scope Clarification (2026-06-30)
- [Done] Desktop AI Provider 新建和编辑不得追加在长列表底部；完整编辑器使用独立、可滚动的 Liquid Glass 弹窗，并保持保存/取消操作始终可见。
- [Done] AI 设置界面明确区分“内置服务商”“自建服务商”和“自定义模型”；底层 `providerMode`/`customProviders` 契约保持兼容，不为文案区分引入配置迁移。
- [Done] Desktop Sandbox 支持 Observe/Build/Strict 预设、完整环境/网络/文件系统策略、相对 env 文件替换、重置、固定保存底栏和诊断刷新；预设仅修改草稿，保存后才影响新运行。
- [In Progress, P1] 继续补齐模型报错记录、Skill Drafts、Usage/Trace 明细与筛选、完整 Host Bash/System，以及运行环境安装闭环。

## 2.19 Scope Clarification (2026-06-30)
- [Done] Standalone Desktop Settings 必须按 `Momo for Mac (standalone).html` / `DESIGN.md` 收敛为 macOS Liquid Glass：保留原生 overlay titlebar，左栏提供真实设置搜索与紧凑分类导航，右栏使用固定标题区、独立滚动内容、46px 分组行和分层玻璃材质；不得破坏中英切换、明暗主题、细粒度保存 API 或固定 `.settings-footbar`。
- [Pending visual acceptance] 由产品负责人在真实 macOS 窗口中检查最终观感；本轮按要求不截图、不执行浏览器视觉验收。代码级 `svelte-check`、Desktop 测试与 production build 已通过。

## 2.18 Scope Clarification (2026-06-29)
- [Done] Desktop Provider 新建与首次引导必须复用完整编辑契约，一次添加多模型及 text/vision/audio_input/stt/tts/tool 能力标签、上下文窗口、协议/path、Thinking 与 Reasoning 配置。
- [Done] Desktop 全局模型路由已补齐 Subagent 分级、fallback/首 Token 超时、默认 Thinking、compaction 参数/模型和 timezone。
- [Done] Desktop Search、Image、Video、TTS 已从只读摘要升级为细粒度保存与未保存配置测试；Image/Video 支持最近任务查看/删除，TTS 支持音色列表和测试音频播放。
- [Done] Desktop 自定义 AI Provider 必须支持编辑、删除、启停、默认设置、模型注册与验证、Thinking 配置以及 API Key 替换/显式清空；已保存密钥不得回显给 WebView。
- [Done] Desktop Web Profile 必须支持 CRUD、Agent 关联、沙箱覆盖和 Profile Markdown 文件编辑，并保留未暴露的服务端字段。
- [Done] Desktop Agent 必须支持 CRUD、沙箱覆盖、文本/视觉/STT 模型覆盖和 Agent Markdown 文件编辑；被渠道引用时禁止删除。
- [Done] Telegram、Feishu、QQ、Weixin 已迁移实例 CRUD、凭据、Agent/沙箱/允许会话、Bot Markdown 文件、飞书连接测试与微信登录二维码工具。
- [Done] Desktop MCP 已迁移 stdio/HTTP 服务 CRUD、启停及敏感字段替换/显式清空，且不回显已保存秘密或机器路径。
- [Done] Desktop Skills 已迁移逐项启停与技能搜索参数保存，使用服务端解析的不可逆 ID，避免暴露 Skill 绝对路径。
- [Done] Desktop Plugins 已迁移记忆后端和动态功能插件配置，密码字段不回显并支持替换/显式清空。
- [Done] Desktop Memory 已迁移搜索、同步、写入、去重、编辑、删除和拒绝记录筛选。
- [Done] Desktop Tasks 已迁移完整文本查看/筛选、编辑、单项/批量触发和删除，任务路径不回传。
- [In Progress, P1] 继续迁移模型报错记录、Skill Drafts、Usage/Trace 明细与筛选、完整 Host Bash/System，以及运行环境逐项安装闭环。Sandbox 已在 2.20 完成。


## 2.17 Scope Clarification (2026-06-28)
- [In Progress, P0] Desktop Settings 必须迁移现有 Web Settings 的实际操作能力，不能以“分类存在/只读摘要存在”判定完成。新 UI 保持 macOS 设计，但编辑、保存、测试、增删、触发和明细查看能力需逐项对齐。
- [Done] Desktop Settings 不得在每个页面无条件显示无意义的「重新检查」；只有本地服务断开时才显示「重新连接服务」。
- [Done] AI 服务商已迁移新增/编辑/删除、凭据保存、模型管理与验证，以及 provider mode/default 切换。
- [Done] Web Profile/Agent/渠道实例、MCP/Skills/Plugins、Memory/Tasks/Sandbox、Search/Image/Video/TTS 的写操作与测试动作已迁移；Usage/Trace/History 明细仍按 P1 继续。

## 2.16 Scope Clarification (2026-06-28)
- [Done] macOS Desktop Chat 的 Enter / Shift+Enter 操作提示必须作为输入框 placeholder 展示，不占用发送按钮旁的工具栏空间，并保持中英文同步。
- [Done] Chat 麦克风按钮必须启动本地录音而不是跳转到 TTS 设置；录音期间必须显示可见计时状态，并提供取消和完成操作，macOS 发布包必须声明麦克风用途。
- [Done] AI 消息 Markdown code block 必须在消息宽度内自动换行，不得因长代码或长 token 出现横向滚动条。

## 2.15 Scope Clarification (2026-06-23)
- [Done] 不同 agent 可配置专有模型，默认与全局模型路由一致：仅开放文本 / 视觉 / 语音转写三条路由的 per-agent 覆盖，留空即跟随全局；TTS、压缩、subagent 各级别路由始终走全局，不做 per-agent 覆盖。覆盖必须叠加在共享上层模型解析里（runner 注入），不能下沉到各 Channel，也不能修改全局 settings 对象。
- [Done] `/status` 必须显示「实际生效模型」（叠加 agent 覆盖后）并标注来源（agent/global）；`/models` 切换在 bot 绑定 agent 且路由为 text/vision/stt 时写入该 agent 维度（影响所有共用该 agent 的 bot），其余仍写全局，并提供 `/models <route> global` 恢复跟随全局。

## 2.14 Scope Clarification (2026-06-21)
- [Done] Bot profile layering must keep reusable agent rules and bot-specific rules together in the upper operator-directives block: if a bot defines `BOT.md`, the final rendered system prompt must include linked agent/global `AGENTS.md` before `BOT.md`, rather than treating `BOT.md` as a replacement for `AGENTS.md` or placing `AGENTS.md` after the default runtime prompt.
- [Done] Bot-level same-name identity files remain true overrides: `SOUL.md`, `IDENTITY.md`, and `SONG.md` use bot > agent > global precedence so a bot can customize personality, identity, and tone without duplicating the agent's reusable `AGENTS.md` rules.

## 2.13 Scope Clarification (2026-06-20)
- [Done] IM 共享 `/new` 命令生成的 Agent runtime session ID 必须使用日期 + 4 位随机小写字母格式 `s-YYYYMMDD-xxxx`，例如 `s-20260622-yush`，避免不同 bot 同一天创建 session 时都出现相同的序号尾缀。
- [Done] `sessionMode=fresh` 的定时任务 session ID 必须使用同一套日期随机规则，前缀为 `task`，例如 `task-YYYYMMDD-yush`；该逻辑必须留在共享 Agent runtime store，不能下沉到各 Channel。

## 2.12 Scope Clarification (2026-06-20)
- [Done] Web Chat 中 Agent 工具产生的附件（例如 `attach` 发送截图）必须真实落到 session 的 assistant 消息 `attachments` 元数据里；不能只把工具结果记录成普通文本，否则文件面板无法判断文件类型或打开附件。
- [Done] Web 附件标题不带扩展名时必须继承源文件扩展名并推断 `mediaType` / `mimeType`，例如 PNG 截图应保存为图片附件而不是未知类型文件。

## 2.11 Scope Clarification (2026-06-20)
- [Done] `/settings/mcp` 必须兼容常见 HTTP MCP 配置写法：当服务条目包含 `url` 但未显式声明 `type` / `transport` 时，保存流程应自动按 HTTP transport 处理，而不是按默认 stdio 校验并因缺少 `command` 丢弃。
- [Done] `/settings/mcp` 必须保留顶层 `headers` 写法，并在保存后归一为 HTTP headers，确保 `{ "mcpServers": { "tdx": { "url": "...", "headers": {...} } } }` 这类配置不会保存后丢失。
- [Done] MCP 工具加载后必须能在同一轮继续调用。由于 agent loop 会在 prompt 开始时拷贝当前工具列表，`loadMcp` 运行中动态追加的 `mcp__...` 工具不能依赖直接进入当前轮工具 schema；需要提供稳定入口 `mcpInvoke` 来列出和调用已加载 MCP 工具，并明确禁止用 `toolSearch` 搜索 MCP 工具。
- [Done] 内置 `read` 工具的 `label` 只作为展示/日志字段，不得作为读取文件的必填业务参数；只传 `path` 的工具调用必须通过校验，并继续保留读取 `SKILL.md` 时的 `read_skill_file` trace 记录。

## 2.10 Scope Clarification (2026-06-19)
- [Done] 生产 `node build` 和 control/service 启动路径下，`/settings/agents` 必须能加载内置 Subagent 清单；如果 release 打包资源存在则读取 build chunk 中的 `subagent-agents`，如果本地工作树直接 `node build` 缺少该资源，则回退读取源码目录，不能因为 `/api/settings/subagents` 500 让已存在的 agents 数据在页面上不可见。
- [Done] `/settings/host-bash` 必须兼容历史 Host Bash 白名单数据；persistent grant 的 `action_fingerprint` 为空或解析后不是对象时，页面 API 应使用 capability tool id 兜底显示，不能整页 500。

## 2.9 Scope Clarification (2026-06-18)
- [Done] `/stop` 成功返回“已停止”后必须同步释放 channel 层 busy 状态、终止当前 run lock 并重置对应 runner；后续普通消息不得继续因为旧运行态被提示 `Queued as #...`。清理 pending queue 与释放当前运行态必须保持一致，避免用户看到已停止但会话仍表现为忙碌。

## 2.8 Scope Clarification (2026-06-17)
- [Done] Telegram 富文本输出：Telegram SDK 必须升级到支持 Bot API 10.1 的 `grammy@1.44.0`；若 SDK 已暴露 rich message 能力，Telegram 出站文本应统一使用 rich message 来源（`InputRichMessage.markdown`、`sendRichMessage`、rich `editMessageText`）。Telegram 渲染不得再保留本地 Markdown-to-HTML 转换或 Markdown 正则识别；rich message 失败时只回退到 grammY 普通文本发送，避免自写解析逻辑和 Telegram 富文本解析发生漂移。
- [Done] 共享命令 Markdown 统一输出：既然 Telegram rich message 已可用，共享命令层不得再按 Telegram/Feishu/QQ/Weixin 分叉生成不同文本；命令只产出一份规范 Markdown，渠道发送层负责渲染或降级。`/status` 统一使用分组 Markdown 列表，`/help`、`/queue`、`/skills` 等表格型输出统一使用标准 Markdown 表格块。Telegram 发送层必须能识别纯 Markdown 表格，确保表格-only 输出也进入富文本路径。
- [Done] 命令输出格式友好化：所有共享 slash command 的多行结果必须优先使用 Markdown heading、bullet list、command list 或 table 表达结构，不再依赖普通段落中的单个换行来分隔字段；`/runlog`、`/sandbox`、`/thinking`、`/toolprogress`、`/showreasoning`、`/models`、`/sessions`、`/queue`、`/login`、`/compact`、Host Bash 审批等结果需在 Telegram rich Markdown 下保持清晰换行，同时飞书等渠道复用同一套输出。

## 2.7 Scope Clarification (2026-06-14)
- [Done] Runlog 自动归档通知必须可控且默认关闭：run detail 继续归档，但自动发送“本次执行成功，详细记录已归档。查看：/runlog ...”需按 session > bot > global 开关判断。`/runlog` 保持查看最新记录语义；状态只能通过 `/runlog status` 查看；新增 `/runlog list` 列出最近归档；`/status` 必须展示 runlog notice、sandbox、toolprogress、showreasoning 的有效状态与来源。
- [Done] Feishu topic 中的执行归档通知必须与 agent 正文回复保持同一 topic 线程；流式输出完成后发送“本次执行成功，详细记录已归档。查看：/runlog ...”时，必须复用原始 Feishu 消息的 thread reply options，不能退化为群聊主消息流普通发送。
- [Done] Changelog 重复修正问题提炼：分析 `CHANGELOG.md` 中多次出现的修复主题，只将长期有效、可预防的避免规则补充进 `AGENTS.md`，包括 prompt/profile 最终渲染校验、设置页响应式和设计系统约束、细粒度设置保存、持久化测试隔离、跨渠道队列幂等等；一次性 bug 和历史实现细节不得搬进长期规则。
- [Done] Docs 目录职责分类整理：`docs/` 下除 `agent-dev-series` 与 `superpowers` 两个独立集合外，需求、方案、评审、调研、指南和参考材料必须按文档职责分目录管理；临时执行计划、迁移 checklist、进度记录和完成日志类过程材料不再保留在 `docs/`；新增 `docs/README.md` 作为文档分类入口，并同步根 `README.md` 文档导航。
- [Done] Feishu Card markdown 渲染优化：Feishu CardKit final card 必须避免把长回答全部塞进单个 markdown 元素；标题需拆分为独立元素，markdown 表格需渲染为飞书原生 table，且 fenced code block 内的 `#`、`-`、`>` 等 markdown 字符不得被兼容转换误改。
- [Done] Bot Profile 身份锁定：当 `BOT.md`、`IDENTITY.md` 等 operator profile 已生效时，默认系统提示词不得再硬声明默认助手身份并覆盖 bot 身份；模型回答“你是谁 / 工作流 / 核心原则 / 禁止行为”等自我描述问题时，必须优先从 active profile 文件回答，并通过尾部 reminder 抵消后置默认 prompt 的稀释。
- [Done] `/stop` 成功中止当前运行时，共享命令的用户确认消息必须使用终态文案（“已停止。” / `Stopped.`），不能在飞书等渠道的最终状态卡片已经显示 stopped 后继续停留为“正在停止……”。
- [Done] 多渠道 System Prompt Preview 热刷新：保存 bot 内容、`BOT.md`、`IDENTITY.md` 等 profile Markdown 后，对应 channel bot 的有效系统提示词预览必须刷新；即使渠道配置进入 no-op apply 分支、不重启适配器，也要重写 runtime 生成的 `SYSTEM_PROMPT.preview.md`，并输出与 Telegram 同类的 `system_prompt_preview_written` 日志。Telegram、Feishu、QQ、Weixin 行为保持一致。
- [Done] 树洞发帖 Bot Profile 模板：在 `src/lib/server/agent/prompts/templates/treehole-poster/` 保存一套 bot 维度模板，包含 `BOT.md`、`IDENTITY.md`、`SOUL.md`。模板分工必须清晰：`BOT.md` 管发布触发和整理流程，`IDENTITY.md` 管身份边界，`SOUL.md` 管表达气质，避免重复规则导致 prompt 冲突。
- [Done] AI 用量与 Trace 页面分页：为 `/settings/ai/usage` 的“请求事件明细”和 `/settings/ai/trace` 的“最近 Trace Facts”明细表格添加分页控制与每页条数选择（10/20/30/50/100，默认 20 条），支持上一页、下一页跳转与多语言（i18n）联动重置。
- [Done] CLI readline 退出防护：本地 CLI adapter 必须处理 stdin/readline 在 Ctrl+C 或 TTY 断开后产生的 `EIO` 读错误，把它视为正常关闭而不是未处理异常；异步消息处理完成后不得对已关闭的 readline 再调用 `prompt()`。
- [Done] Skill 使用追踪 Phase 1：trace 体系必须记录模型隐式读取 skill `SKILL.md` 的加载事实。Runner 在 `read` 工具通过 gate/preflight/budget 后缓存已解析路径，并在成功 after 时精确匹配当前 run skill manifest，命中后 emit `skill.loaded` (`reason: read_skill_file`)；失败、blocked 与 run cleanup 不得残留 pending path。`TraceRecorderHook` 对 `skill_usage` 使用 `payload.level` 与 `payload.evidenceCsv` 做单调合并，triggered-only 使用 `status: info`，loaded/executed 使用 `status: success`。
- [Done] Skill 使用追踪 Phase 2：trace 体系必须记录 `skillSearch` 成功返回的候选 skill，但只能表达为被搜索命中的 triggered 信号，不能暗示已加载或已执行。Runner 在 `afterToolCall` 中防御式读取 `context.result.details.matches`，对结构完整的 match emit `skill.selected` (`reason: search_match`)；`TraceRecorderHook` 将 matched-only facts 保持为 `payload.level: triggered` / `status: info`，并且不得把已 loaded/executed fact 降级。
- [Done] Skill 使用追踪 Phase 3：trace 体系可以记录声明式 signals 命中的 executed 证据，但必须标注为启发式证据而非执行证明。`SKILL.md` frontmatter 可选声明 `signals.cli`、`signals.mcp`、`signals.tools`（也兼容 `signals_cli` / `signals_mcp` / `signals_tools`）；runner 只在 skill 已 loaded 后，对同一 run 内成功的 bash/tool/MCP 调用做保守匹配，并把匹配 evidence 写成 `cli_signal` / `tool_signal` / `mcp_signal`。多个 loaded skill 同时命中时，只归因给最近 loaded 的匹配 skill，避免一条工具调用污染多个 skill fact。
- [Done] 系统、沙盒及插件设置页面 Warm Shadcn UI 风格重构：对 `/settings/system`、`/settings/sandbox`、`/settings/plugins` 这三个设置页面进行了重构。使用统一的 Warm Shadcn 布局结构，将零散的 Tailwind 工具类收敛为 `.channel-*` 自定义样式类；将开关控件统一升级为 `IosSwitch` 源码组件；将重置和保存动作移至统一的固定底栏（`.settings-footbar`）中，确保与已重构的 9 个设置页面风格交互完全一致。
- [Done] Adapter-node SQLite 构建告警清理：生产构建必须显式把 `node:sqlite` 保留为 Node 运行时 external，避免 adapter-node 最终打包阶段因为 Node/Rollup 内置模块列表未包含 SQLite 等而输出 unresolved-import notices；项目 Node engine 同步收紧到 `>=22.5.0`。
- [Done] System Prompt Skill Routing 合并与 Preview 防误导：系统提示词中的 skill routing 规则不得同时散落在 `Message Processing Pipeline`、`Skills Protocol` 和独立 `Skill Routing (Mandatory)` 三处。已将路由判断保留在 pipeline，将已选 skill 后的执行协议保留在 Skills Protocol，并移除独立重复 section；同时把静态 `SYSTEM_PROMPT.preview.md` 改成占位说明，真实 prompt 检查必须走 `buildSystemPromptPreview()`、Web prompt preview endpoint 或 runtime 生成文件，避免旧 preview 继续教模型手写 event JSON。
- [Done] System Prompt P1 收尾：Prompt 回归测试必须覆盖真实 render 后的长度预算和关键路由锚点，防止后续又把长篇 event/tool/skill 说明塞回系统提示词；提示词重构方案文档中的验证命令必须使用仓库真实 Node test runner；ToolRuntime workspace whitelist 测试不得写真实 settings DB，必须使用隔离测试库。
- [Done] Trace Facts 模型用量补写与 Usage 关联：修复 `/settings/ai/trace` 最近 Trace Facts 中模型调用缺失 input/output/cache/total token 的问题。`/settings/ai/usage` 继续读取独立 usage JSONL 用量账本，`/settings/ai/trace` 继续读取 SQLite `agent_trace_facts`，但 Runner 会在 assistant message end 拿到 usage 时补发同一 `modelAttemptId` 的 `model.call.after`，使 trace facts 能通过 run/session/model attempt 与 usage 口径对齐；当 provider 未返回显式 total token 时，TraceRecorder 使用 input/output/cache read/cache write 自动补算总数。
- [Done] 工具调用后的模型续写请求必须作为独立模型调用 fact 记录：同一个 Agent prompt 内部可能发生多次真实 AI API 请求（首轮模型请求、工具调用、工具结果后的续写请求等），Trace 的 `modelAttemptId` 粒度必须按真实 API request 递增，不能用外层 `agent.prompt()` attempt 覆盖前一次模型调用。
- [Done] 设置页面多语言（i18n）重构与支持：对设置中心全部 24 个页面进行多语言重构，通过中英（zh-CN / en-US）双语的 `COPY` 块和 Svelte 响应式 `$locale` 存储绑定，实现了完全的即时响应式语言切换。弃用了不稳定的 `localizeSettings` 暴力 DOM 翻译插件。同时统一将开关替换为 `IosSwitch` 源码组件，固化粘性保存底栏。
- [Done] 导航栏图标优化与菜单名称展示切换：将设置左侧侧边栏抽象符号替换为高表达力的 Emojis。在底部新增 `🏷️` 切换按钮支持动态折叠/展开显示菜单组名称，且偏好自动存储于 localStorage 中。

## 2.6 Scope Clarification (2026-06-06)
- [Done] SQLite 动态设置迁移与细粒度 API 改造：为了减小大 JSON 对内存及持久化的压力，将搜索、图片生成、视频生成和沙箱设置迁移到 SQLite 动态表 `settings_dynamic` 存储，并在启动时对旧 `settings.json` 字段及旧版独立表做自动提取、合并与清理。新增统一 API 端点 `/api/settings/dynamic/[key]` 完整支持对这些动态配置的 `GET` (读取)、`PUT`/`POST`/`PATCH` (写入与更新)操作，并重构前端 settings 页面仅在加载与保存时定向读写各自的动态配置 Key，彻底消除了大 JSON 请求，同时完全替代了原本大 `PUT /api/settings` 保存机制。进一步将 AI 提供商设置页面（Providers）也从此大设置接口解耦，扩展了 `/api/settings/custom-providers` 的 `GET` 与 `PUT` 支持，彻底实现了各个功能页面的精细化增量更新。
- [Done] Agent HookManager 运行时观测扩展与 Trace 记录系统：实现了运行时可插拔的 `HookManager` 事件总线与插件系统，支持 observe 调试与 sqlite trace Telemetry 插件；在 tool call 前置增加拦截 gate 支持；并在 `BaseChannelRuntime`、Web context、`RunnerPool` 和 `MomRunner` 中完整桥接注入。后续修复了 Runner 早退路径缺失 `run.finished`、插件初始化未获得真实 settings、critical observe hook 失败导致 observe 队列停摆的问题；并新增统一 `agent_trace_facts` 分析表，用 `fact_type` 区分工具调用与模型调用，支持按 session/run 统计工具次数、关联工具和模型请求。
- [Done] Agent Trace 设置页分析入口：新增 `/settings/ai/trace`，基于 `agent_trace_facts` 提供今天/昨天/最近 7 天/最近 30 天时间窗、Bot、channel、chat ID、session ID、run ID、fact 类型筛选和汇总表，覆盖工具调用次数、实际执行次数、失败/阻止次数、模型请求数、input/output/cache/total token、Bot 与 session/run 关联工具数等排障指标。
- [Done] AI 设置页面顶部 Hero 栏尺寸收缩与统一：为包括 8 个核心 AI 设置页及 16 个使用 Tailwind 的常规设置页在内的所有页面应用了全局统一的 Hero 头部紧凑型样式；将页面标题字号从 `2rem` 缩减至 `1.375rem`，描述字体缩减至 `0.8125rem`（13px），内部 gap 缩减至 `0.375rem`，并去除了 Layout 叠加造成的默认 padding-top 导致的大面积上方空白。
- [Done] AI 设置页面底部固定栏全宽适配与样式抽离：将路由（`/settings/ai/routing`）、提供商（`/settings/ai/providers`）、报错记录（`/settings/ai/errors`）、MCP（`/settings/mcp`）、搜索（`/settings/search`）和视频（`/settings/video`）等设置页面的底栏从 `div` 元素改为 HTML5 语义化的 `footer` 元素，以解决 `workbench.css` 对 div 的 max-width 限制，实现底栏全屏幕宽度拉伸；同时将所有 8 个 AI 设置页面的 `<style>` 标签内的样式完全抽离并整合到独立的全局样式表 `src/styles/settings-custom.css` 中，防止 Svelte 编译器动态在 `<head>` 中生成 scoped 的 Header code 样式。
- [Done] AI 设置相关子页面统一样式与居中对齐排版：重构了所有 AI 设置相关页面（包括路由、提供商、用量统计、报错记录、MCP、搜索、图片和视频设置页面），为每个页面的主容器添加了 `margin: 0 auto;` 居中对齐，使得中间的内容区域在大屏下左右留白完全对称；同时将所有页面的固定保存/操作底栏（`.settings-footbar`）移出 max-width 容器，确保其在右侧主显示区横跨全屏。
- [Done] 视频设置页面固定粘性底栏适配：重构了视频生成设置页面（`/settings/video`）的表单结构，将其输入和引擎列表包裹在 `<form id="video-form" ...>` 中。将原本位于页面卡片底部的普通保存按钮，移至悬浮在全屏最底部的粘性固定底栏（`.settings-footbar`），与表单 action 完美绑定，实现了 AI Settings 下所有页面交互和视觉风格的完全一致。
- [Done] 修复 Telegram 视频附件标题覆盖扩展名的问题：当 `attach` 发送 `.mp4` 等二进制媒体且 `title` 不含扩展名时，上传文件名必须自动保留源文件扩展名，并通过 `sendVideo` 设置 `supports_streaming`，避免视频生成结果在 Telegram 中被异常展示为非视频消息。
- [Done] 模型报错记录、MCP 服务与搜索设置页面样式重构：重构了 `/settings/ai/errors`、`/settings/mcp` 和 `/settings/search` 的布局与 CSS 样式，迁移至 Warm Shadcn（衬线标题排版、`var(--card)` 背景、`var(--border)` 边框等）设计系统。
- [Done] Svelte a11y 构建告警清理：修复 Providers、Image、Video 设置页 modal/backdrop 与视频预览的可访问性问题，确保 `npm run build` 不再输出 Svelte a11y warnings。
- [Done] 适配固定粘性保存底栏：按照 `DESIGN.md` 第 4 条设计原则，将 `/settings/mcp` 和 `/settings/search` 页面的“保存设置”及“重置”按钮承载于固定底栏（`.settings-footbar`）中。对于 `/settings/ai/errors`，其“刷新记录”操作也被集成到了固定底栏中。
- [Done] 统一 Switch 开关组件：在这三个设置页面中，统一使用 Svelte 源码 `<Switch>` 组件替代手写开关，利用 Svelte 5 的 `bind:checked` 自动绑定。
- [Done] 移除 SettingsSection 布局依赖：取消这三个页面对 `SettingsSection` 包装组件的依赖，替换为自定义的 Hero 头部区域，并清理了无用组件导入。
- [Done] 图像生成记录 SQLite 持久化与历史管理：在 SQLite 中新增 `image_tasks` 表，存储图像生成 Task ID、引擎、会话 ID、状态、提示词、本地保存路径、远程图片 URL、请求参数和错误消息。
- [Done] 图像生成工具同步入库：`imageGenerate` 执行时先将任务记录创建为 `processing` 状态，并在生成完成后更新为 `completed`（含本地路径和远程 URL）或 `failed`（含错误说明），测试环境支持自定义 taskStore 以隔离测试记录。
- [Done] 图像生成供应商 HTTP 诊断日志：`imageGenerate` 在调用供应商时记录请求 URL、脱敏 headers、请求体、响应状态和响应体预览，便于在 `/settings/image` 测试和 Agent 实际调用中排查空响应、错误响应或 URL 拼接问题；日志必须脱敏 API key 和 Authorization。
- [Done] OpenAI Images 引擎：`imageGenerate` 支持 `openai` 供应商，默认读取 `OPENAI_API_KEY`，使用 `https://api.openai.com/v1/images/generations` 与 `gpt-image-2` 生成图片，并支持在 `/settings/image` 中配置 API Key、模型 ID、Base URL、默认引擎和即时测试。
- [Done] OpenAI Chat Completions 兼容图像协议：`imageGenerate` 支持 `openai-chat` 供应商，默认读取 `OPENAI_API_KEY`，提交到 `/v1/chat/completions`，并从 chat message 内容中的 JSON、Markdown 图片链接、HTTP 图片 URL、data URL 或 Base64 字段提取图像结果，适配不走 `/v1/images/generations` 的 OpenAI-compatible 图像服务。
- [Done] 图像 provider 独立启用开关：`/settings/image` 为每个图像引擎提供与 `/settings/video` 一致的启用/禁用开关；`imageGenerate` 运行时只选择 `enabled=true` 且有 API Key 的引擎，旧配置缺少 `enabled` 字段时按已配置 API Key 自动补齐为启用以保持升级兼容。
- [Done] 图像生成历史记录展示与详情弹窗：在 `/settings/image` 页面新增“最近生成记录”表格，降序排列生成记录，支持“查看结果”弹窗（渲染生成的图片和元数据并提供下载）、“查看参数”弹窗（拷贝原始 JSON）及删除操作。
- [Done] 图像设置表单适配固定粘性底栏：重构 `/settings/image` 提交表单以符合 `DESIGN.md` 第 4 条设计原则，将保存按钮和状态消息承载于固定粘性底栏（`.settings-footbar`）中。
- [Done] 图像 Serving 端点与任务接口：新增 `/api/settings/image-generate/tasks`（获取及删除任务）与 `/api/settings/image-generate/image`（流式渲染本地图片文件或重定向到远程公网图片 URL）接口。
- [Done] 视频远程 URL 存储与 302 重定向播放：取消后台轮询器与 Agent 工具内自动下载远程二进制 `.mp4` 文件到本地的操作，防止在网络环境不佳时因下载出错导致成功任务状态更新为 `failed`。并在 SQLite `video_tasks` 中引入 `video_url` 存储远程链接，优化流媒体接口 `/api/settings/video-generate/video` 对缺失本地文件但有远程 URL 的请求进行 302 重定向，保证内置播放器与下载按钮免修改完美工作。
- [Done] 视频状态查询以 SQLite 作为缓存源：当 Agent 通过 `videoGenerate(taskId, engine)` 查询任务时，必须先读取 DB。若任务已完成，直接返回 DB 中的远程 URL；若任务处理中且 `updated_at` 未超过 30 秒，直接返回缓存进度；超过 30 秒才查询一次供应商状态并写回 DB，完成时只保存和返回远程 URL，不主动下载远程 `.mp4` 到本地。
- [Done] 视频请求参数日志入库与列表/详情展示：在 SQLite `video_tasks` 表中增加 `request_params` 字段。在 Agent 创建任务时，自动捕获并存入提交给云端 API 的所有原始请求参数（如 prompt、model、images 等）。在 `/settings/video` 页面的任务列表操作列中直接提供“查看参数”按钮（即使在任务处理中也能随时点击），并可在详情弹窗中以格式化 JSON 样式及 `select-all` 代码块展示，以便于随时核对和排查生成参数问题。
- [Done] 图像远程 URL 与绝对路径输出：更新 `imageGenerate` 工具返回的成功文本内容。当供应商返回公网图片 URL 时，必须将 `Remote URL` 返回给 Agent，同时保留本地保存路径和绝对路径，确保“用上一次生成的图片生成视频”时可以优先把公网 URL 传给视频工具。
- [Done] 图片生成成功与渠道上传失败必须分离：`imageGenerate` 在图片已生成并保存后，即使 Telegram/其他渠道自动上传失败，也必须返回成功工具结果，并携带远程 URL、本地路径和上传错误说明，不能把渠道发送失败误报为图片生成失败。

- [Done] `videoGenerate` 的 `images` 参数容错与标准化：修改 `videoGenerateSchema` 允许 `images` 为数组或单个字符串类型，在执行时自动解析 JSON 字符串化数组（如 `'["/path"]'`) 或普通单路径字符串并标准化为真正的数组，避免 AI 混淆输入格式导致工具逐字符迭代寻找路径（如寻找名为 `[` 的文件）报错的问题。
- [Done] 视频参考图输入只接受公网 URL：`videoGenerate` 不再把本地图片路径转换为 Base64 Data URL。对于本地路径或 `data:` URL，工具必须在提交供应商前直接拒绝并提示使用 `imageGenerate` 返回的 `Remote URL`，避免 Agnes Video 等接口因图片不可公网访问或 Base64 无效而返回 400。
- [Done] 修复视频生成工具本地图片路径误提交问题：当检测到参考图路径为本地路径（如临时目录 `/tmp/...`）时，工具前置拒绝并给出明确提示，不再把本地路径或 Base64 Data URL 提交给要求公网 URL 的视频供应商。
- [Done] 拦截非公网参考图 URL：在向远端提交之前，前置检查参考图必须是 `http://` 或 `https://` URL；本地路径和 `data:` URL 直接返回错误，避免提交给第三方服务抛出 400/500。
- [Done] 优化后台轮询管理器对接口异常与 500 报错的容错：由于供应商 Agnes AI 错误码为结构化对象，将其规范序列化为字符串存储，避免 SQLite 绑定入库崩溃；并在遭遇 4xx 终端 HTTP 状态或连续失败 3 次时，在 SQLite 数据库中将任务标记为 `failed` 失败终态，防止产生死循环无效轮询。
- [Done] Telegram 流式答案拆分为多条消息后，后续刷新必须复用并编辑已有分片消息 ID；只能在分片数量增加时补发新消息，内容缩短时需要删除多余分片，不能持续重复创建第二条消息。
- [Done] `toolProgress = "new"` 的单行工具进度需要去掉重复的 `正在运行:` 前缀，展示压缩为 `⏳ <toolName>...`，优先把有限宽度留给真正的工具名与后续信息。
- [Done] 优化图像生成配置页面 `/settings/image`：支持各引擎自定义模型 ID（如 `agnes-image-2.0-flash` 等）；移除各引擎的 `enabled` 显式启用字段，简化为只要配置了对应的 API Key 即视为启用该引擎；支持中英文双语本地化切换。
- [Done] 优化视频生成状态查询逻辑：当 Agent 以 `taskId` 重新查询视频状态时，若本地 SQLite 数据库中该任务已为 `completed` 或 `failed` 终态，直接读取并返回本地缓存结果，避免二次向已过期的三方服务端发送请求造成 `fetch failed` 错误；并在此时自动完成 channel 消息视频发送。
- [Done] 优化 Telegram 渠道的视频发送机制：在文件发送逻辑中独立识别 `.mp4`/`.webm`/`.mov` 格式，防止因包含 `ftyp` 标识而误判为音频，并在 MIME 探测为视频类型时，直接使用 Telegram `sendVideo` 原生接口发送视频消息，保证视频可以在 Telegram 中内嵌播放与直接下载。
- [Done] 在 `/settings/video` 设置页面的“最近生成任务”列表中新增“任务 ID (Task ID)”列，以方便管理员和用户随时查看并便捷拷贝 `taskId`，用于聊天中手动进度查询。
- [Done] 隔离视频单元测试数据库写入：重构 `createVideoGenerateTool` 并为 `videoGenerateTool.test.ts` 传入独立的临时 SQLite 路径并随测试销毁，彻底避免测试执行在宿主正式 settings.sqlite 中产生垃圾 mock 记录。
- [Done] 在 `/settings/video` 设置页面的任务列表操作列中为已完成和失败任务增加“查看结果”按钮，点击弹窗展示任务详情（包含 Task ID、提示词、引擎、本地路径与错误消息），并在已生成视频时提供 HTML5 原生 `<video>` 播放器与下载按钮，使本地生成的视频在配置控制台中即可直接点击查看。

## 2.5 Scope Clarification (2026-06-05)
- [Done] 视频生成支持作为内置 Agent 层工具 `videoGenerate` 运行，支持 Agnes-Video 和 火山引擎 (Doubao-Seedance) 双供应商；每个供应商支持在配置中自定义特定的模型 ID；生成的视频支持下载保存至本地会话归档目录，并通过 active channel 直发；设置页提供 `/settings/video` 与 `/api/settings/video-generate/test` 连接测试接口，适配多语言中英切换。
- [Done] 视频生成任务采用非阻塞式异步执行：任务提交后立即写入 SQLite，返回 taskId 释放 Agent 回合；网页设置页通过 30 秒间隔的后台 API 进行轮询更新，并在服务端控制台打印详细的 HTTP 请求（URL、Body）与响应（Response Body）日志。

## 2.6 Scope Clarification (2026-06-09)
- [Done] 语音合成支持作为内置 Agent 层工具 `ttsGenerate` 运行，支持 macOS 系统语音（通过 `say` 命令）和小米 MiMo TTS 双 Provider；macOS Provider 支持选择系统已安装音色和输出格式（AIFF/M4A/CAF），Xiaomi Provider 支持配置 API Key、Base URL、模型（mimo-v2-tts）、音色和格式（WAV）；生成的音频保存到受控的运行时 artifact 目录，并在上传可用时自动通过 active channel 直发；设置页提供 `/settings/tts` 与 `/api/settings/tts-generate/test` 连接测试接口，适配多语言中英切换；Channel 层不包含 TTS 生成逻辑。


## 2.2 Subagent Sandbox Research Backlog (2026-05-25)
- 竞品调研与下一阶段产品边界记录在 `docs/research/sandbox/subagent-sandbox.md`。
- 下一阶段不应先扩大 Host Bash 能力；应先补齐策略模板、run ledger、审批/诊断/产物关联和恢复边界。
- P1 建议新增命名 sandbox profile（Observe / Build / Strict / Host-Assisted / Custom），把用户能理解的工作模式映射到底层 env/network/filesystem/approval 策略。
- P1 建议新增 parent/subagent run ledger，持久化 run tree、模型路由、有效 sandbox profile、审批记录、诊断事件、产物清单和终止原因。
- P2 建议引入 checkpoint/recovery：至少提供 run 前后 changed-file 摘要、artifact manifest、失败原因和可恢复边界；完整 workspace rollback 或 Docker/remote sandbox provider 应放在恢复模型稳定之后。
## 2.4 Agent v2.2 Refactoring Progress (2026-06-04)
- **内置图片生成工具 (Built-In Image Generation Tool) (2026-06-04)**:
  - Added types and settings interfaces for `imageGenerate` in `schema.ts`.
  - Added defaults reading from environment variables (`AGNES_API_KEY`, `MODELSCOPE_API_KEY`, `GOOGLE_API_KEY`, `VOLCENGINE_API_KEY`) and sanitization logic in `defaults.ts` and `sanitize.ts`.
  - Implemented the `imageGenerate` tool in `imageGenerateTool.ts` and registered it as a deferred agent tool in `tools/index.ts`.
  - Added provider integrations for Agnes (OpenAI-compatible), Google Imagen (predict API), Volcengine (Seedream), and ModelScope (async task polling) in `providers.ts`.
  - Configured prompt guidance in `prompt.ts` instructing the agent to prefer `imageGenerate` for creating images.
  - Added legacy settings backfill, default-engine-first auto routing, and data-dir storage for settings-page test outputs.
  - Treated a configured default image engine with an API key as enabled for compatibility with older `enabled: false` settings, and clarified the per-engine enabled switch in `/settings/image`.
  - Fixed semantic routing so image generation/editing intent in any language loads `imageGenerate` through `toolSearch select:imageGenerate` before skill search or bash fallbacks.
  - Implemented automated mock-based unit tests in `imageGenerateTool.test.ts`.
- **System Prompt Boundary Refactor (P0 & Sandbox Cleanup) (2026-06-04)**:
  - Compressed event management, scheduler, and tool-search details in the system prompt (`prompt.ts`), routing cron and confirm rules to the deferred tool schemas.
  - Merged the previously scattered behavioral guardrails into one `Core Directives` section, covering execution discipline, freshness/truthfulness, external-content safety, action confirmation, runtime integrity, failure recovery, and processed multimodal inputs.
  - Refactored sandbox descriptions from low-level OS implementation details (like `sandbox-exec` and `bubblewrap` paths) to concise model decision boundaries.
  - Aligned `bash` tool description and parameter schema metadata to reflect runtime-managed sandbox boundaries and hostApproval reason instructions.
  - Added regression tests in `prompt.test.ts` and `bash-output.test.ts` to enforce the refactored system prompt rules and prevent sandbox implementation detail leaks.
- **微信通道底层 SDK 升级与上下文 Token 持久化 (Weixin SDK Upstream Upgrade & Context Token Persistence) (2026-05-30)**:
  - 同步了 `package/weixin-agent-sdk` 至最新的 `openclaw-weixin` upstream 版本（版本号为 `0.3.1`），移除了所有 OpenClaw 专属插件 Hook 依赖。
  - 在 `package/weixin-agent-sdk/src/messaging/inbound.ts` 中实现了 `persistContextTokens`/`restoreContextTokens`/`clearContextTokensForAccount` 磁盘持久化机制，并在清除账号时删除关联的磁盘文件。
  - 更新了 `src/lib/server/channels/weixin/client.ts`，在启动时自动调用 `restoreContextTokens`，在运行时将 context tokens 进行双向桥接，并且适配了 `alreadyConnected` 状态实现绑定重定向自愈。
  - 将 `filterWeixinMarkdown` 设置为 no-op 管道，并更新了 `outbound.test.ts` 与 `send.test.ts` 相关的 markdown 断言。
  - 补齐了 `src/api/api.ts` 的外部中止链路：`apiPostFetch` 现在会合并 timeout controller 与外部 `AbortSignal`，`getUpdates` 也统一走这条路径，确保 Weixin 长轮询在停止与热重载时可立即退出。
- **Review Optimization Tasks 4 & 5 Completed (2026-05-30)**:
  - Fixed subagent approval depth propagation by adding `requestedByDepth` to `createSubagentTool` options and incrementing it `(options.requestedByDepth ?? 0) + 1` for host approval payload construction.
  - Documented security boundary in `TurnOrchestrator.prepareTurn`, clarifying that channel runtimes authenticate/authorize actors before turn execution, while TurnOrchestrator only persists normalized `userId` for auditing.
  - Resolved runner unit test flakiness by using randomized test session IDs to avoid turn-lock constraint conflicts on persistent local SQLite databases.
- **Named Sandbox Profiles Completed (2026-05-30)**:
  - Defined templates for Observe (read-only, network wildcard), Build (read-write workdir, standard registry domains), and Strict (isolated, block failure mode, no network, tmp write only).
  - Implemented automatic sandbox profile detection matching active settings in Svelte settings UI, showing "Custom Profile" badge and warning if local edits deviate from preset templates.
  - Implemented interactive preset selection cards at the top of `/settings/sandbox` form with glassmorphism hover and active borders.
  - Localized preset titles, descriptions, and custom/active status badges in Chinese and English.
- **Configurable Agent Run Budget Limits Completed (2026-05-30)**:
  - Extracted agent run budget limits (max tool calls, max tool failures, max model attempts) into `RuntimeSettings` and settings JSON/SQLite stores.
  - Implemented automatic value range clamping (max tool calls `1-500`, failure/attempt limits `1-100`) inside configuration sanitizers.
  - Updated `runner.ts` to instantiate `RunBudget` dynamically using custom limits if configured.
  - Added a dedicated "Agent Budget Limits" (智能体运行预算限制) management card in the "System Config" Settings page, supporting real-time PUT updates and localized en-US/zh-CN copy.
- **Phase 5 (runner.ts Slimming & Input Enrichment Extraction) Completed (2026-05-30)**:
  - Extracted 16 utility/helper functions from `runner.ts` into a new modular file `runnerHelpers.ts`.
  - Extracted audio transcription (STT) routing, vision/image routing fallbacks, and model candidate fallback resolution logic into `runnerInputEnricher.ts`.
  - Refactored `MomRunner` to import helper utilities and delegate input preparation to `prepareEnrichedInput`. Completely removed the legacy `blockedOnHostBashApproval` pausing and agent abort logic to transition fully to the new coroutine-blocking model, shrinking `runner.ts` to 1693 lines.
  - Decoupled `RunnerPool` from `runner.ts` into a separate `runnerPool.ts` file, and updated imports across commands, web context, and shared runtime layers.
  - Defined and exported `AudioRouteDecision`, `VisionRouteDecision`, and `ImageFallbackRouteDecision` interfaces in `mediaFallback.ts` to ensure type safety.
- **Phase 3D (Approval Integration & Compatibility Hardening) Completed (2026-05-30)**:
  - Implemented 5-minute timeout polling loop inside `executeToolCall` in `toolRuntime.ts` to block and wake tool execution.
  - Implemented 1.5s debounce aggregation for low/medium risk approvals in `toolRuntime.ts` using session-scoped batch map.
  - Mapped host bash tool capability to `bash:${toolId}` prefix to preserve compatibility with the old setting pages and CLI commands.
  - Integrated `AbortSignal` to unblock tool coroutines when the runner is canceled.
  - Added duplicate execution checks in `channelCommands.ts` to prevent running approved tasks in parallel if the runner is active.
  - Decoupled legacy `blockedOnHostBashApproval` abort mechanism from `runner.ts` and rewrote corresponding tests, allowing the runner to hold the lock and stay active while suspended.
- **Phase 2 (TurnOrchestrator Lifecycle Delegation & runner.ts Slimming) Completed (2026-05-29)**:
  - Encapsulated concurrent session locking and lock auto-expiration timeouts (>10 minutes) inside `TurnOrchestrator`.
  - Moved memory gateway synchronization and prompt snapshotting into `TurnOrchestrator.prepareTurnMemory()`.
  - Relocated context compaction calculations and runtime compaction saving mechanisms to `TurnOrchestrator.compactSessionContext()`.
  - Shifted run summary serialization and status updates (`completed`, `aborted`, `waiting_for_approval`, `failed`) to `TurnOrchestrator.commitTurn()`.
  - Refactored and simplified `runner.ts` to delegate all these concerns to the orchestrator.
  - Verified 100% test coverage with all 25 agent-related test suites successfully passing.

## 2.5 Agent v2.1 Simplification Plan (2026-05-27)
- v2.1 的长期架构方案记录在 `docs/designs/architecture/agent-redesign-v2.1.md` 和 `docs/designs/architecture/agent-redesign-v2.2.md`；临时执行 TODO 不再保留在 `docs/`。
- **Sprint A / Phase 5 (2026-05-29) 已顺利完成**:
  - Legacy ACP (Agent-Channel Proxy) 被物理清除并移至 `package/acp/` 作为外部依赖，并注册了 `#acp/*` node subpath import。
  - 主代码库中的配置 schema、验证 sanitize、默认值 defaults 与 store 均与 `acp` 彻底解耦，Feishu 渠道中无用的 ACP 卡片卡槽代码均已被物理清理。
  - 完成了工作区级的安全策略闭环：在 `ToolRuntime` 中对非白名单工具进行了严格拦截阻断，在 `loadSkillsFromWorkspace` 中根据工作区的技能白名单过滤加载，且在 runner 执行流中实现了 `workspaceId` 对齐透传。
- 短期第一优先级是删除 ACP 主路径并引入最小 Workspace 边界，先降低配置、权限、Channel 和 runtime 分支复杂度。
- Phase 1 验收口径：代码主路径不再依赖 ACP；默认 `personal` workspace 可创建/解析；Web 和 CLI 可在默认 workspace 下正常运行；新 run 可以记录 `workspaceId`。
- Phase 1 第一批已先完成 ACP active runtime path 下线：Channel runtime 不再实例化 ACP service，四个 IM 渠道不再自动 proxy 到 ACP，`/acp` / `/approve` / `/deny` 返回 inactive-path 提示，Settings 不再导航到 ACP 页面；旧 ACP schema/source 暂保留兼容。
- Phase 1 的最小 Workspace 边界已建立：`settings.sqlite` 新增 `workspaces` registry，启动和运行入口会确保默认 `personal` workspace，可选保留技能、工具、sandbox、approval profile 字段；新 run summary/detail 记录 `workspaceId`，但本批不迁移既有 session/chat 文件位置。
- Phase 2 才进入 TurnOrchestrator、ToolRuntime、Approval scope 和 sandbox fallback 收口，避免一次性改动所有渠道和工具路径。
- 非目标：不新建 PluginManager，不重写 Skill/Memory/Subagent 类型系统，不引入完整 PolicyEngine 或 SandboxRuntime。


## 175. Skill 执行目录稳固化 (2026-04-19)
- Priority: P1
- Stage: Delivered (2026-04-19)
- Problem:
  - 某些 skill 会在说明里直接写 `bash scripts/...` 这类相对路径命令，但运行时 shell 的默认目录其实是当前聊天的 `scratch`，不是 skill 自己的目录。
  - 一旦模型没有先手动 `cd` 到 skill 目录，相对路径就会漂到 `.../<chatId>/scratch/scripts/...`，导致“文件明明存在却提示找不到”。
  - 显式 skill 调用上下文虽然已经把 `skill_file` 给到模型，但没有把同样权威的目录路径一起带上，模型仍然容易自己猜。
- Requirement:
  - skill 自己给出的执行命令必须明确进入当前 skill 目录，不能默认依赖当前 shell 工作目录，也不能写死某一台机器上的绝对路径。
  - skill 内部脚本在启动时也必须自我纠正到自己的目录，再去访问相对路径资源，避免上层调用方式稍有变化就失效。
  - 显式 skill 调用上下文必须同时包含 `skill_file` 和 `base_dir`，让模型看到唯一可信的目录基准。
- Enforcement:
  - `~/.molibot/skills/onlinestool/SKILL.md` 必须把自动收录命令改成先进入 skill 目录再执行。
  - `~/.molibot/skills/onlinestool/scripts/run_update.sh` 必须在开头解析脚本所在目录并切换过去，再访问 `.venv`、`scripts/`、`references/`、`audit.log`、`output/` 等相对路径。
  - `src/lib/server/agent/runner.ts` 必须在显式 skill 注入块中带出 `base_dir`，减少运行时猜路径。
  - `features.md` 必须记录本次修复，方便后续排查类似“skill 找错路径”的问题。


## 175. Configurable Skill Search Routing (2026-04-18)
- Priority: P1
- Stage: Delivered (2026-04-18)
- Problem:
  - 当前 skill 隐式命中主要依赖系统提示词中的技能说明，让模型自己判断是否要用 skill；这种方式对模型自觉性依赖过高，稳定性不足。
  - 当 skill 描述是中文、用户请求是英文，或者用户表达比较抽象时，纯提示词记忆式匹配更容易漏掉已有 skill。
  - 现有系统提示词注入完整 skill description 列表，会让动态内容偏长，也不利于后续单独把 skill 检索做成显式运行时能力。
- Requirement:
  - Runtime 必须支持显式的 `skill_search` 检索路径，而不是只靠提示词内的技能清单。
  - Skill Search 必须支持两层能力并允许独立开关：本地搜索、本地未明确命中后的 API 复判。
  - 设置页必须支持配置是否启用本地搜索、是否启用 API 搜索；当启用 API 搜索时，应直接复用既有 AI Provider 配置，只需要选择 provider 和 model，不再单独维护第二套 baseUrl/path/apiKey。
  - 显式 skill 调用（如 `/skill-name`）必须继续保持最高优先级，不得被新的检索流程覆盖。
  - 系统提示词中的技能注入需要简化，避免继续默认注入完整 description 长列表；运行时 skill 命中主要依赖 `skill_search`。
- Enforcement:
  - `src/lib/server/settings/schema.ts`、`defaults.ts`、`store.ts` 必须新增 skill search 配置结构及默认值，并通过统一 settings 流程持久化。
  - `src/routes/api/settings/+server.ts` 必须接受并校验新的 skill search 配置字段。
  - `src/routes/settings/skills/+page.svelte` 必须新增 Skill Search 配置区，支持开关本地搜索/API 搜索和设置 API 参数。
  - `src/lib/server/agent/skills.ts` 必须补充本地搜索所需的索引与搜索逻辑，同时保留现有显式 skill 调用解析能力。
  - `src/lib/server/agent/tools/` 必须新增 `skill_search` 工具，并接入 `src/lib/server/agent/tools/index.ts`。
  - `src/lib/server/agent/runner.ts` 与 `src/lib/server/agent/prompt.ts` 必须把 skill-first 路由调整为“优先显式 skill，其次 `skill_search`，最后普通工具/普通回答”。
  - `features.md` 必须记录本次能力规划与后续落地。

### 175.1 Implementation Note (2026-04-18)
- 首版保留“显式 skill 调用优先级最高”的现有行为；`skill_search` 只处理未显式点名 skill 的场景，不覆盖 `/skill-name` / `$skill-name` 这类直接调用。
- Skill Search 配置先收敛到 `/settings/skills` 页面，避免再拆新设置页；支持本地搜索与 API 搜索独立开关，其中 API 搜索直接复用 `/settings/ai/providers` 已配置的 provider，只额外选择 provider 和 model。
- 系统提示词不再默认注入完整 skill description 长列表，而是切到轻量 skill 名称索引，并通过 XML 风格标签对提示块做结构化分隔，减少长动态块对主规则的干扰。
- 测试阶段必须提供单独的 skill-search 观察日志，至少覆盖搜索输入、是否启用本地/API 路径、本地结果、API 结果、最终返回结果与诊断信息，便于对比命中率和误判情况。
- provider 选择式配置上线后，运行时仍需兼容历史上直接保存在 `skillSearch.api.baseUrl/apiKey/model/path` 里的老配置；如果未选 provider 但老配置完整，API 搜索不得被静默禁用。
- 当已保存的 `skillSearch.api.model` 不再属于当前选中的 provider 时，运行时必须回退到该 provider 的默认模型或首个模型，不能继续把过期模型名发给上游。


## 162. Weixin 长文本分段回复不能只发第一段，必须完整送达并暴露真实失败 (2026-04-02)
- Priority: P0
- Stage: Delivered (2026-04-02)
- Problem:
  - 当前 Weixin 长文本虽然会做 2000 字分段，但每段都按“已完成”状态发送，导致后续分段在 Weixin 侧可能被忽略，用户只看到第一段。
  - 发送接口只看 HTTP 成功，不检查微信 `ret/errcode` 业务码，后续分段即使被微信拒绝也会被误判为成功。
- Requirement:
  - 长文本分段发送必须使用同一消息标识，前段标记为“生成中”，最后一段才标记为“完成”，确保同一次回复能完整送达。
  - 发送消息必须校验微信业务返回码；只要 `ret/errcode` 非 0 必须立刻报错，不能静默吞掉。
- Enforcement:
  - `src/lib/server/channels/weixin/client.ts` 必须在长文本分段发送时复用同一 `client_id`，并按“前段 GENERATING、最后 FINISH”发送。
  - `package/weixin-agent-sdk/src/api/api.ts` 的 `sendMessage` 必须解析并校验 `ret/errcode`，业务失败直接抛错。
  - `src/lib/server/channels/weixin/client.test.ts` 必须覆盖“长文本分段状态正确”和“业务失败抛错”两个场景。
  - `features.md` 必须记录本次修复，便于后续排查“为什么微信只发第一段”。

## 163. Built-in provider 不能被当作 custom 默认提供方 (2026-04-03)
- Priority: P0
- Stage: Delivered (2026-04-03)
- Problem:
  - 在 Providers 页面开启 built-in provider 后，`defaultCustomProviderId` 可能被设成 built-in id（例如 `google`）。
  - 当 `providerMode=custom` 时，运行时会按 custom 规则校验默认提供方，导致 built-in 被误判并抛出 `custom provider requires baseUrl, apiKey, and at least one model`。
- Requirement:
  - `providerMode=custom` 只能选择真正 custom 提供方（非 built-in）作为默认目标。
  - 设置页必须阻止把 built-in 提供方设为 custom 默认目标，避免再写入错误状态。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 在 custom 模式选默认提供方时必须排除 built-in provider id。
  - `src/lib/server/app/runtime.ts` 在保存/清洗设置时必须保证 `defaultCustomProviderId` 只落到 custom 提供方集合中。
  - `src/routes/settings/ai/providers/+page.svelte` 必须禁止 built-in 条目触发 “Set as Default”。
  - `features.md` 必须记录本次修复，便于后续追踪同类配置问题。

## 164. Web 会话 `Already working` 卡死必须可主动终止 (2026-04-03)
- Priority: P0
- Stage: Delivered (2026-04-03)
- Problem:
  - Web 端出现 `Already working` 时，通常是上一轮任务仍在后台执行，但页面没有可用的“强制停止后台任务”通道。
  - `/api/chat` 与 `/api/stream` 各自维护独立 runner 上下文，导致停止操作可能打不到真正正在运行的那条任务。
- Requirement:
  - Web 端必须支持按 `profile + session` 精确停止当前运行任务，用户不需要等待超时才能恢复发送。
  - 聊天与流式接口必须共享同一套 runner 上下文，避免“看起来同一会话，实际不是同一个运行实例”的分裂状态。
- Enforcement:
  - 新增共享运行上下文模块并由 `/api/chat` 与 `/api/stream` 统一复用。
  - 新增 `POST /api/stream/stop`，按会话中止当前 runner。
  - `/api/stream` 必须在请求断开时触发 `runner.abort()`，避免前端断流后后台继续长时间占用。
  - Web 页面必须提供可见的“停止”操作并调用 stop API。
  - `features.md` 必须记录本次修复，便于后续排查同类运行锁死问题。

## 165. Agent 运行预算与统一收尾摘要 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 当前 runner 虽然有工具安全前置校验，但长任务仍缺少明确的运行边界，容易在工具失败或模型重试中不断兜圈。
  - 任务结束后缺少统一的收尾摘要，操作者只能从零散进度消息里猜本轮到底用了什么、失败了什么。
- Requirement:
  - 每次运行必须有明确的基础预算，至少覆盖工具调用次数、工具失败次数、模型尝试次数。
  - 当预算耗尽时，runner 必须停止继续探索，转为给出当前最好的结果或明确报错。
  - 每次运行结束后，系统必须留下结构化摘要，至少包括运行结果、预算消耗、工具使用情况和模型回退信息。
- Enforcement:
  - `src/lib/server/agent/runtimeBudget.ts` 必须定义统一预算结构与判定逻辑。
  - `src/lib/server/agent/runner.ts` 必须在工具调用前、工具失败后、模型候选切换前应用预算限制。
  - `src/lib/server/agent/store.ts` 必须将运行摘要追加写入 chat 维度的 `run-summaries.jsonl`。
  - `src/lib/server/agent/runSummary.ts` 必须提供统一的收尾摘要格式化逻辑。
  - `features.md` 必须记录本次能力落地。

## 166. 可复用工作流技能草稿沉淀 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 当前 runtime 能使用 skills，但一次复杂任务成功后没有统一入口把有效做法沉淀下来，经验会直接丢失。
  - 直接自动写成正式技能风险过高，需要先有草稿层。
- Requirement:
  - 对复杂且成功的运行，系统应能自动生成“可复用工作流草稿”，供后续 review。
  - runtime 必须提供专门的技能草稿/保存工具，而不是把流程说明散落写进任意文件。
  - prompt 规则必须明确：优先保存草稿，只有工作流已验证或用户明确要求时才转成正式技能。
- Enforcement:
  - `src/lib/server/agent/skillDraft.ts` 必须负责技能草稿判定、草稿内容生成、草稿落盘和正式技能保存辅助逻辑。
  - `src/lib/server/agent/tools/skillManage.ts` 必须提供 `draft/create/update/read_draft/list_drafts` 能力。
  - `src/lib/server/agent/tools/index.ts` 必须将 `skill_manage` 接入 agent 工具集。
  - `src/lib/server/agent/runner.ts` 必须在复杂成功运行后自动生成技能草稿，并在收尾摘要中告知草稿路径。
  - `src/lib/server/agent/prompt.ts` 必须写明“优先生成草稿、不要直接覆盖正式技能”的执行规则。
  - `features.md` 必须记录本次能力落地。

## 167. 运行期记忆快照与更完整复盘层 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 当前 memory 虽然能检索，但如果 prompt 在 runner 生命周期里被复用，容易出现“这轮实际看到的记忆”不清楚、不同轮之间互相污染的情况。
  - 现有 run summary 只有基础结果字段，不足以支撑后续判断“这次为什么成功/失败，下次该怎么处理”。
- Requirement:
  - 每次运行开始时必须生成一份固定的记忆快照，并在本轮运行中只使用这份快照作为 prompt 记忆来源。
  - 运行摘要必须记录本轮用了哪一份记忆快照，以及这份快照包含多少长期/短期记忆。
  - 运行摘要必须带有更完整的复盘信息，至少包括结果分类、简短结论和下一步建议。
- Enforcement:
  - `src/lib/server/memory/gateway.ts` 必须提供结构化记忆快照生成能力，而不只是返回拼接字符串。
  - `src/lib/server/agent/runner.ts` 必须在 run 开始时生成 memory snapshot，并用 snapshot 指纹参与 prompt 刷新判定，保证“每轮固定、跨轮可更新”。
  - `src/lib/server/agent/runSummary.ts` 必须定义 outcome/summary/nextAction 这类复盘结构，并在 closing note 中输出。
  - `features.md` 必须记录本次能力落地。

## 168. 记忆写入治理与技能草稿升级正式化 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 如果 memory 没有写入治理，提醒、日志、待办、裸链接这类低价值内容会持续污染长期记忆。
  - 当前已经有草稿层，但缺少从“已 review 的草稿”升级成正式技能的明确路径，仍然需要手工复制。
- Requirement:
  - memory 写入必须有明确拒绝规则，至少挡住提醒/定时内容、临时运行日志、待办型计划、孤立裸链接。
  - 当 memory 写入被拒绝时，必须返回清楚原因，而不是静默失败。
  - `skill_manage` 必须支持把草稿正式提升为 live skill，并自动去掉 draft-only 元数据。
- Enforcement:
  - `src/lib/server/memory/classifier.ts` 必须提供显式写入评估逻辑，返回允许/拒绝和原因。
  - `src/lib/server/memory/gateway.ts` 必须在 `add/update` 时统一执行写入治理。
  - `src/lib/server/agent/tools/memory.ts` 必须沿用 gateway 的拒绝结果，让 agent 看到明确失败原因。
  - `src/lib/server/agent/skillDraft.ts` 必须支持从草稿内容生成正式技能内容，去掉 `draft/source` 等仅草稿字段。
  - `src/lib/server/agent/tools/skillManage.ts` 必须提供 `promote_draft`。
  - `features.md` 必须记录本次能力落地。

## 169. 自我进化记录可视化与草稿审核入口 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 前几轮已经把运行摘要和技能草稿写进文件，但操作者仍然要手动翻目录，无法快速判断最近跑得怎么样、哪些草稿值得转正。
  - 如果缺少统一的 review 入口，前面的“记忆快照、复盘、技能草稿”会停留在底层能力，难以形成实际工作流。
- Requirement:
  - Settings 必须提供最近运行记录查看页面，至少能看到结果分类、运行时间、主要输出、工具使用、失败路径、下一步建议。
  - Settings 必须提供技能草稿审核页面，至少能查看草稿正文、修改草稿内容、删除草稿，并一键提升为 chat/bot/global skill。
  - 后台 API 必须统一扫描 runtime 目录里的运行摘要和技能草稿，而不是让前端直接猜文件路径。
- Enforcement:
  - `src/lib/server/agent/reviewData.ts` 必须负责扫描 bot/chat 工作区中的 `run-summaries.jsonl` 和 `skill-drafts/*.md`。
  - `src/routes/api/settings/run-history/+server.ts` 必须输出最近运行记录与统计。
  - `src/routes/api/settings/skill-drafts/+server.ts` 必须支持草稿列表、保存、删除、提升为正式技能。
  - `src/routes/settings/run-history/+page.svelte` 与 `src/routes/settings/skill-drafts/+page.svelte` 必须提供实际可操作的审核界面。
  - `src/routes/settings/+layout.svelte` 必须把新的审核入口挂到 Settings 导航。
  - `features.md` 必须记录本次能力落地。

## 170. 相似案例自动归并与记忆拦截记录页 (2026-04-11)
- Priority: P1
- Stage: Delivered (2026-04-11)
- Problem:
  - 如果每次复杂成功运行都生成一份新草稿，长期下来会堆出很多“几乎一样”的工作流文件，反而让 review 和转正更难。
  - 当前 memory 写入治理虽然能拦住低价值内容，但操作者看不到“哪些内容被拦住、为什么被拦住”，治理效果不可审计。
- Requirement:
  - 自动生成或手动保存技能草稿时，系统必须优先判断是否已有相似草稿；如果相似，应合并更新而不是新建重复草稿。
  - 草稿提升为正式技能时，如果目标范围里已存在相似技能，应优先合并更新，避免出现多个近似技能副本。
  - 所有被治理规则拦住的 memory 写入都必须记录下来，并提供单独页面给操作者查看原因和原始内容。
- Enforcement:
  - `src/lib/server/agent/skillDraft.ts` 必须负责相似草稿判定与合并逻辑，并在草稿/技能保存时优先复用已有相似文件。
  - `src/lib/server/agent/runSummary.ts` 必须在收尾摘要中明确提示本次草稿是“新建”还是“合并到已有草稿”。
  - `src/lib/server/memory/governanceLog.ts` 必须负责拦截记录的落盘与读取。
  - `src/lib/server/memory/gateway.ts` 必须在 `add/update` 被拒绝时追加治理日志。
  - `src/routes/api/settings/memory-rejections/+server.ts` 与 `src/routes/settings/memory-rejections/+page.svelte` 必须提供可查看的治理记录页面。
  - `src/routes/settings/+layout.svelte` 必须把记忆拦截记录入口挂到 Settings 导航。
  - `features.md` 必须记录本次能力落地。

## 171. Weixin 原生 Markdown 发送对齐 (2026-04-15)
- Priority: P1
- Stage: Delivered (2026-04-15)
- Problem:
  - 当前 Weixin 出站文本仍按旧策略先整体压平成纯文本，导致标题、表格、代码块和英文强调等本来已经能显示的格式被提前抹掉。
  - 参考中的新版 Weixin SDK 已经改成“尽量保留 Markdown，只过滤少数已知问题格式”，如果 Molibot 不跟进，会继续落后于真实客户端能力。
- Requirement:
  - Weixin 文本发送必须默认保留已知可显示的 Markdown，而不是统一做纯文本替换。
  - 仍然需要过滤已知高风险或显示差的内容，至少包括图片语法和 CJK 斜体包裹标记。
  - vendored `package/weixin-agent-sdk` 与 Molibot 自己的 Weixin runtime/file-send 路径必须使用同一套文本过滤规则，不能一个保留、一个再二次抹平。
- Enforcement:
  - `package/weixin-agent-sdk/src/messaging/markdown-filter.ts` 必须提供可复用的 Weixin Markdown 过滤器。
  - `package/weixin-agent-sdk/src/messaging/send.ts` 与 `process-message.ts` 必须改用保留型 Markdown 过滤，而不是纯文本压平。
  - `src/lib/server/channels/weixin/runtime.ts` 与 `src/lib/server/channels/weixin/outbound.ts` 必须统一复用 vendored SDK 的同一过滤函数。
  - `package/weixin-agent-sdk/src/messaging/send.test.ts` 与 `src/lib/server/channels/weixin/outbound.test.ts` 必须覆盖“保留支持格式、移除不支持格式”的回归验证。
  - `features.md` 必须记录本次能力落地。

## 172. QQ SDK Gateway 接口兼容修复 (2026-04-17)
- Priority: P1
- Stage: Delivered (2026-04-17)
- Problem:
  - `src/lib/server/channels/qq` 这层仍按旧版方式启动 `package/qqbot` 的 gateway，继续传旧参数结构，导致升级 SDK 后启动链路和实际接口脱节。
  - 当宿主没有显式传入 `abortSignal` 时，QQ gateway 会在启动早期直接崩在 `abortSignal.addEventListener`，机器人还没真正连上就退出。
- Requirement:
  - QQ channel 适配层必须按当前 `package/qqbot` 的 gateway 上下文结构启动，不再依赖旧版 `accessToken/onMessage/onClose` 这套参数。
  - 就算宿主没显式提供停止信号，QQ gateway 也不能因为空值直接崩掉，至少要使用内部兜底信号保证启动链路安全。
  - QQ 兼容导出层要与当前 SDK 的实际类型名和函数名保持一致，避免适配层自己再带一套过期接口。
- Enforcement:
  - `src/lib/server/channels/qq/runtime.ts` 与 `src/lib/server/channels/qq/sdk-adapter.ts` 必须改为传入当前 gateway 所需的上下文对象，并在 runtime 停止时主动中断对应连接。
  - `package/qqbot/src/gateway.ts` 必须对缺失的 `abortSignal` 做兜底，不能假定所有宿主都永远传值。
  - `src/lib/server/channels/qq/index.ts` 与 `src/lib/server/channels/qq/api.ts` 必须对齐 SDK 当前公开的类型和函数命名。
  - `features.md` 必须记录本次修复，方便后续排查 QQ 启动兼容问题。

## 173. QQ API 头部日志压缩 (2026-04-17)
- Priority: P2
- Stage: Delivered (2026-04-17)
- Problem:
  - QQ API 调试日志当前会把整份响应头完整打印出来，字段很多，重复度高，会把真正有用的状态信息挤掉。
  - 排查时通常只需要看到少数关键信息，例如状态、内容类型、长度、服务端和 trace id，不需要每次展开整块 headers。
- Requirement:
  - `<<< Headers:` 必须改成简短摘要，默认只保留少数高价值字段，避免日志刷屏。
  - 压缩日志后，仍然要保留足够的信息支持定位请求链路，至少不能丢掉 `content-type`、`server`、`x-tps-trace-id` 这类核心字段。
- Enforcement:
  - `package/qqbot/src/api.ts` 必须统一使用一套响应头摘要逻辑，不再直接打印整个 headers 对象。
  - `features.md` 必须记录本次改动，方便后续排查“为什么 QQ API 日志变短了”。

## 174. QQ 入站主链解耦与重复层清理 (2026-04-17)
- Priority: P1
- Stage: Delivered (2026-04-17)
- Problem:
  - `package/qqbot/src/gateway.ts` 当前默认把入站事件直接交给 OpenClaw runtime，Molibot 这边虽然能借它去连 QQ，但没有把消息正确接回自己的运行时，所以会出现“能拿 token、能拿 gateway、但收不到消息”的假象。
  - `src/lib/server/channels/qq` 目录里同时存在两套 `QQManager`，其中一套没有接入真实主链，只会制造重复和误导。
  - QQ token 缓存是单全局槽位，多 bot 同进程时会互相清缓存，连带让日志和连接状态都变得混乱。
- Requirement:
  - QQ gateway 必须支持把标准化后的入站事件直接回调给 Molibot 自己的 runtime，不能再默认绑死另一套运行时。
  - Molibot 的 QQ runtime 必须具备真正的入站处理链路，至少包括消息过滤、命令处理、排队、交给 runner、回消息。
  - 重复的 `QQManager` 实现要收敛成一套，`sdk-adapter.ts` 只保留 helper/export，不再藏第二套 manager。
  - token 缓存必须按 `appId` 隔离，不能让多个 QQ bot 共用一份缓存。
- Enforcement:
  - `package/qqbot/src/gateway.ts` 必须增加通用入站事件回调入口，Molibot 接法走这个入口时不得依赖 `getQQBotRuntime()`。
  - `src/lib/server/channels/qq/runtime.ts` 必须建立实际可运行的入站主链，而不是只负责启动 SDK。
  - `src/lib/server/channels/qq/sdk-adapter.ts` 必须去掉未接入主链的重复 manager 实现。
  - `package/qqbot/src/api.ts` 必须改成按 `appId` 存储 token cache / singleflight。
  - `features.md` 必须记录本次修复，方便后续排查 QQ 为什么“能连但收不到消息”。

## 175. Skill Draft 生成规则与标准 Workflow 配置 (2026-04-19)
- Priority: P1
- Stage: Delivered (2026-04-19)
- Problem:
  - 当前复杂运行成功后是否保存草稿，基本是写死规则，阈值偏低时很容易积累过多草稿，操作者无法按自己的标准控制。
  - 当前自动生成的草稿结构不够稳定，没有办法指定一套已经验证过的 workflow `SKILL.md` 作为统一标准。
- Requirement:
  - `Skill Drafts` 设置页必须允许配置“什么时候自动保存草稿”，至少支持总开关、最少工具调用次数，以及是否把“工具失败后恢复成功”“模型重试/回退成功”视为可保存场景。
  - `Skill Drafts` 设置页必须允许指定一个标准 workflow `SKILL.md` 路径；如果没有配置这个路径，就不能打开自动生成开关。
  - 自动生成草稿时，如果已经配置标准 workflow，新草稿必须优先复用该 workflow 的章节骨架，而不是继续使用松散的默认格式。
  - 自动生成草稿时，frontmatter metadata 必须单独规范化：`name` 使用稳定功能标识，`description` 描述功能和触发场景，不能把本轮用户消息原样当作 `name`。
  - 自动生成草稿时，应优先调用专用 `skill-drafter` subagent 生成 metadata；如果子代理失败或输出不可解析，必须回退到本地规范化逻辑，不能阻断草稿保存。
- Enforcement:
  - `src/lib/server/settings/{schema,defaults,store}.ts` 与 `src/lib/server/app/runtime.ts` 必须持久化并校验新的 `skillDrafts` 配置。
  - `src/lib/server/agent/runner.ts` 必须在决定是否保存草稿时使用新配置。
  - `src/lib/server/agent/skillDraft.ts` 必须支持基于标准 workflow 的章节结构生成草稿内容，并在缺少 workflow 路径时拒绝自动生成。
  - `src/routes/api/settings/skill-drafts/+server.ts` 必须返回当前配置与可选 workflow 建议列表。
  - `src/routes/settings/skill-drafts/+page.svelte` 必须提供可保存的新配置界面。
  - `features.md` 必须记录本次能力落地。

## 176. 固定斜杠命令的两列 Markdown 表格输出 (2026-04-19)
- Priority: P1
- Stage: Delivered (2026-04-19)
- Problem:
  - `/status`、`/help` 这类固定命令本质上是“左边字段 / 右边说明”的两列信息，但当前所有渠道都只返回普通文本，长一点时不够清楚。
  - QQ、微信、飞书现在已经具备 Markdown 表格展示能力，如果继续只发纯文本，就浪费了这些渠道已经有的可读性优势。
  - Telegram 此前不稳定支持表格，如果强行统一切过去，反而会让现有展示退化。2026-06-17 起 Telegram rich message 已支持 Markdown，命令层应输出统一 Markdown，由渠道发送层负责渲染差异。
- Requirement:
  - 固定命令需要支持按“命令语义”选择统一 Markdown 输出样式，而不是按渠道生成不同文本。
  - 结构明显且短的命令可用表格，例如 `/help`、`/queue`；长状态面板使用分组 Markdown 列表，例如 `/status`。
  - 渲染差异必须留给渠道发送层处理；命令层不应再维护 Telegram/Feishu/QQ/Weixin 专用展示分支。
  - 三列或不适合表格的命令先保持现状，不要顺手改掉。
- Enforcement:
  - `src/lib/server/agent/channelCommands.ts` 必须集中定义固定命令的 Markdown 文本形态，按命令语义决定列表或表格，不按渠道分叉。
  - `/status` 必须输出分组 Markdown 列表；`/help` 与 `/queue` 必须输出标准 Markdown 两列表格。
  - `src/lib/server/agent/channelCommands.test.ts` 必须覆盖不同渠道收到同一份命令 Markdown，以及 `/status` 的分组列表结构。
  - `features.md` 必须记录本次能力落地。

## 177. 禁止用户机器绝对路径泄漏到代码与界面 (2026-04-19)
- Priority: P1
- Stage: Delivered (2026-04-19)
- Problem:
  - 设置页里出现了直接写死的 `~/...` 占位示例，这会把当前开发机信息泄漏进产品界面，也会误导后续使用者照抄错误路径。
  - 这类路径一旦继续出现在代码、默认值、提示词或文档示例里，后续维护时很容易把“只在某一台机器成立”的路径错当成通用规则。
- Requirement:
  - 面向用户的界面占位、默认值和示例文案不得再出现当前开发机的绝对路径，优先使用相对路径、通用占位路径或与机器无关的写法。
  - 项目协作规则里必须明确禁止把用户电脑绝对路径写进代码、界面示例、提示词和文档示例，避免同类问题反复出现。
- Enforcement:
  - `src/routes/settings/acp/+page.svelte` 与 `src/routes/settings/skill-drafts/+page.svelte` 必须移除 `~/...` 示例，占位内容改成相对或通用写法。
  - `AGENTS.md` 必须加入明确规则：不要把用户机器绝对路径写进代码、界面示例、默认值、提示词或文档示例。
  - `features.md` 必须记录本次修复，方便后续排查同类路径泄漏问题。

## 178. 飞书富文本卡片与审批按钮回调 (2026-04-19)
- Priority: P1
- Stage: Delivered (2026-04-19)
- Problem:
  - 飞书通道虽然已经把消息发成 `interactive`，但当前卡片只塞了一个 markdown 块，视觉上仍然接近纯文本，标题、状态、分段和操作意图都不够清楚。
  - ACP 权限提示仍然要求操作者手输 `/approve`、`/deny`，没有利用飞书卡片原生按钮能力，审批路径不顺手。
  - 项目里之前没有飞书卡片动作回调入口，导致即使生成了按钮，也没有地方真正接住点击事件。
- Requirement:
  - 飞书普通回复必须升级成更适合阅读的富文本卡片，而不是继续复用单块 markdown 的最简壳。
  - ACP 状态提示和权限请求必须单独使用结构化卡片，清楚展示请求标题、请求号、选项和结果。
  - 飞书卡片按钮点击后必须能直接完成批准/拒绝，不再依赖用户手动输入命令。
  - 设置页需要允许配置飞书卡片回调安全字段，至少覆盖可选的 `verificationToken` 和 `encryptKey`。
- Enforcement:
  - `src/lib/server/channels/feishu/messaging.ts` 必须提供结构化回复卡片、状态卡片、审批卡片以及卡片更新能力。
  - `src/lib/server/channels/feishu/runtime.ts` 必须将 ACP 状态/审批切到正式卡片，并处理批准/拒绝按钮回调。
  - `src/routes/api/feishu/card/+server.ts` 必须提供飞书卡片动作回调入口。
  - `src/routes/settings/feishu/+page.svelte` 与相关 settings schema/store 必须支持保存可选回调安全字段。
  - `features.md` 必须记录本次能力落地。

## 179. 待处理消息持久化队列（SQLite 精简版） (2026-04-22)
- Priority: P1
- Stage: Delivered (2026-04-22)
- Problem:
  - 当前部分渠道的待处理消息还是“内存里排队”，进程如果中途退出，尚未处理完的消息会直接丢失，重启后也不会自动续跑。
  - 图片和语音消息虽然最终会走文字理解或本地附件处理，但原先没有把这些待处理任务持久化下来。
  - 参考 gbrain 的持久化任务思路是对的，但对现在这个场景来说太重了，不适合一开始就引入完整 jobs 系统。
- Requirement:
  - 用户发来的待处理任务在进入运行器前必须先写入 SQLite。
  - 任务处理完成后必须把该条记录标记为完成；崩溃中断的 `running` 任务在重启后必须恢复成待处理并继续运行。
  - 图片和语音消息必须能跟普通文本一样进入队列；至少要保存可恢复所需的文字结果、附件路径和回复目标信息。
  - 需要支持最基础的队列操作：查看当前排队、插队到最前、按队列序号删除待处理项。
  - 不做管理页面；所有操作通过聊天命令完成。
- Enforcement:
  - 渠道侧必须复用同一套轻量 SQLite 待处理队列，而不是各写一份临时 JSON 或内存队列。
  - 第一批至少覆盖 Telegram、Feishu、QQ、Weixin，包含普通文本、图片、语音这三类常见入站任务。
  - 命令层必须提供 `/queue`、`/queue front <text>`、`/queue delete <id>` 这组最小操作面。
  - `features.md` 必须记录本次能力落地。

## 180. 模型重试不得污染会话上下文，且每次 429 都必须留痕 (2026-04-22)
- Priority: P1
- Stage: Delivered (2026-04-22)
- Problem:
  - 当前同一条消息在模型返回 429 后会自动重试，但重试前没有把失败尝试留下的临时上下文清掉，导致同一条用户消息被重复写进 `contexts/<sessionId>.jsonl`，模型误以为用户连续发了多次同样内容。
  - 当最后一次重试已经成功返回正文时，前面失败尝试残留的错误状态仍会在 run 收尾阶段触发统一报错分支，把成功回复重新覆盖成 `Sorry, something went wrong.`。
  - `/settings/ai/errors` 之前按“整轮模型候选”折叠记录失败，同一模型内连续两次 429 只会看到一条，无法还原真实失败次数。
- Requirement:
  - 对同一个模型做重试时，失败尝试产生的临时 user/assistant 记录不得进入最终会话上下文；只有最后真正成功的那次尝试允许写入 `contexts/<sessionId>.jsonl`。
  - 只要最终已经拿到有效回复，就必须把这条正确回复保留给用户，不能再被之前失败尝试的错误文案覆盖。
  - 每一次 429 / retryable request error 都必须单独写入模型错误日志，即使同一轮后面恢复成功也要保留逐次失败记录，并标明是否已恢复。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 必须在 retryable request error 和空回复重试前恢复到当前轮开始前的消息状态，避免把失败尝试累积进会话。
  - 模型错误日志记录粒度必须下沉到“每次失败尝试”，而不是只在整轮候选结束时合并记一条。
  - run 收尾阶段的统一报错提示必须只在“最终仍然失败”时触发；若已有最终正文则不得覆盖。
  - `src/lib/server/agent/runnerRetryState.test.ts` 必须覆盖“429 仍算独立失败记录”和“成功正文不被旧错误覆盖”这两条回归验证。
  - `features.md` 必须记录本次修复。

## 181. `/models` 输出改成清晰表格列表 (2026-04-22)
- Priority: P2
- Stage: Delivered (2026-04-22)
- Problem:
  - 当前 `/models` 输出混合了 route、provider mode、active key 和逐行 key 明细，用户要先跳过一堆技术信息，才能找到真正想看的“有哪些模型、哪个正在用”。
  - 对于日常切换模型的场景，更自然的展示应该是“总数 + 编号 + 模型名 + 当前活跃标记”，而不是每项后面再跟一行内部 key。
- Requirement:
  - `/models` 默认输出必须改成简洁的两列表格，第一列是编号，第二列是模型名。
  - 标题必须直接显示当前列表总数；当前活跃模型必须在对应行内明确标出来。
  - 切换用法仍要保留在列表下方，但不要再把每个候选 key 明细全部展开到主列表里。
- Enforcement:
  - `src/lib/server/agent/channelCommands.ts` 的 `/models` 展示必须输出“当前模型列表（共N个）”风格的标题和两列表格。
  - 当前活跃项必须在行内显示 `⭐ 当前活跃中`。
  - `src/lib/server/agent/channelCommands.test.ts` 必须覆盖新表格标题、编号列和活跃标记这条回归验证。
  - `features.md` 必须记录本次改动。

## 182. 飞书渠道自动把 Markdown 表格转成原生卡片表格 (2026-04-22)
- Priority: P1
- Stage: Delivered (2026-04-22)
- Problem:
  - 当前 agent 和共享命令层产出的表格仍然是 Markdown 文本。QQ/微信这类纯文本或 Markdown 渠道还能勉强显示，但飞书卡片正文只是把这段 Markdown 塞进 `markdown`/`lark_md`，表格经常显示错位甚至直接失真。
  - 这个问题不只发生在 `/models` 这种命令式输出，后续任何 agent 回复里只要带 Markdown 表格，在飞书里都会遇到同样问题。
  - 按项目分层规则，这类“平台展示适配”应该收口在飞书渠道层，不应该反过来污染共享 agent 输出格式。
- Requirement:
  - 飞书发送文本卡片前，必须先识别正文里的 Markdown 表格，并把表格替换成飞书原生 `table` 卡片元素。
  - 非表格内容必须继续按原来的飞书 Markdown 卡片正文展示，不能因为支持表格而破坏普通文本、标题、列表、代码块等现有显示。
  - 这次改动必须只发生在飞书 channel 侧；共享 agent、命令层、其他渠道一律不改输出协议。
- Enforcement:
  - `src/lib/server/channels/feishu/formatting.ts` 必须提供 Markdown 表格提取能力，能把正文拆成“普通文本段 + 表格段”。
  - `src/lib/server/channels/feishu/messaging.ts` 必须在构造飞书回复卡片时，把表格段转换成原生 `table` 元素，把非表格段保留为普通 Markdown 元素。
  - `sendFeishuText` / `editFeishuText` 必须复用同一套转换逻辑，避免“新发消息”和“编辑状态消息”行为不一致。
  - `src/lib/server/channels/feishu/table-conversion.test.ts` 必须覆盖“能提取 Markdown 表格”和“能生成飞书原生 table 元素”两条回归验证。
  - `features.md` 必须记录本次改动。

## 183. 共享发件重试不能提前向上层报失败，飞书表格转换必须跳过代码块 (2026-04-22)
- Priority: P1
- Stage: Delivered (2026-04-22)
- Problem:
  - 共享 SQLite outbound queue 新增后，发送失败会先把消息重新标成 pending 并安排重试，但同时又立刻 reject 原始发送 promise。这样上层渠道会把“可重试的暂时失败”当成最终失败对外报错，后续即使后台重试成功，也会出现错误提示和真实成功并存的错乱状态。
  - 飞书 Markdown 表格提取当前只看 `| ... |` + 分隔线，没有跳过 fenced code block。只要回复里有 Markdown 教程、示例或提示词片段，代码块里的表格示例就会被错误替换成原生飞书表格，破坏原意。
- Requirement:
  - 共享 outbound queue 在可重试失败后必须保持原始发送 promise 挂起，直到某次真正发送成功或者运行时关闭，不得在仍会自动重试时提前向调用方报最终失败。
  - 飞书表格转换必须跳过 fenced code block；代码块中的 Markdown 表格语法必须按原样保留为普通 Markdown 文本。
- Enforcement:
  - `src/lib/server/channels/shared/outbox.ts` 不得在 `fail()` 中提前 reject 仍会重试的记录；`src/lib/server/channels/shared/outbox.test.ts` 必须覆盖“首次失败、后续重试成功时 enqueue 最终 resolve”的回归验证。
  - `src/lib/server/channels/feishu/formatting.ts` 的表格提取必须识别 fenced code block 边界；`src/lib/server/channels/feishu/table-conversion.test.ts` 必须覆盖“代码块中的表格不转原生 table”的回归验证。
  - `features.md` 必须记录本次修复。

## 184. `/models` 列表拆分成编号 / 供应商 / 模型三列 (2026-04-23)
- Priority: P2
- Stage: Delivered (2026-04-23)
- Problem:
  - 当前 `/models` 把“供应商 / 模型名”拼在同一列里，用户扫列表时需要自己再做一次拆分，找供应商归属和模型名都不够直观。
  - 当前活跃标识放在最后一列末尾，视觉上离编号很远；用户按编号切换时，不容易第一眼把“当前正在用的是哪一个编号”对上。
- Requirement:
  - `/models` 默认输出必须改成三列表格：`编号 / 供应商 / 模型`。
  - 当前活跃标识必须放在编号列，而不是模型列末尾。
  - 内建模型和自定义模型都必须按同一结构输出，便于飞书原生表格和普通文本渠道统一展示。
- Enforcement:
  - `src/lib/server/agent/channelCommands.ts` 必须把模型显示拆成独立供应商列和模型列，并把 `⭐ 当前活跃中` 挪到编号列。
  - `src/lib/server/agent/channelCommands.test.ts` 必须覆盖三列表头、内建模型供应商列、以及活跃标识位于编号列的回归验证。
  - `src/lib/server/channels/feishu/table-conversion.test.ts` 必须同步覆盖三列 Markdown 表格在飞书卡片转换后的结构验证。
  - `features.md` 必须记录本次改动。

## 185. 混合 built-in / custom 模型路由必须自动分流 (2026-04-23)
- Priority: P1
- Stage: Delivered (2026-04-23)
- Problem:
  - 现在 `/models` 和 AI 路由页会把设置里的 built-in provider 条目也当成普通 custom provider 生成 `custom|...` 路由 key，导致像 Google Gemini 这种本该走内置协议的模型被误送到 OpenAI 兼容链路，最终出现“明明是 built-in 但一用就报错”。
  - 运行时校验又会先看全局 `providerMode`，只要它还是 `custom`，即便当前实际选中的是 built-in 模型，也会被提前拦成“custom provider 配置不完整”，不能做到 built-in / custom 混用。
  - 路由页还把内置 fallback provider/model 输入框绑在全局模式上，误导用户以为必须先选一个大类模式，不能按具体模型自动分流。
- Requirement:
  - 运行时必须根据当前选中的模型 key 自动判断走 built-in 还是 custom 通道，而不是依赖用户先手动切全局模式。
  - built-in provider 出现在 providers/routing 配置池里时，必须生成 `pi|provider|model` 形式的路由 key；只有真正的自定义 OpenAI 兼容 provider 才能生成 `custom|provider|model`。
  - `/models`、AI 路由页、运行时校验三处都必须遵守这套自动分流规则，允许 built-in 和 custom 模型混着配置、混着切换。
- Enforcement:
  - `src/lib/server/settings/modelSwitch.ts` 必须把 known provider 识别为 built-in，并在模型列表与切换 patch 中生成内置路由 key，而不是 custom key。
  - `src/lib/server/agent/runner.ts` 必须按当前实际选中的文本模型做凭据校验和 custom 兼容处理，不能仅凭 `providerMode` 先行报错。
  - `src/routes/settings/ai/routing/+page.svelte` 必须把 built-in/custom 选项放进同一模型池，并提示“自动判断通道”，不再把 PI fallback 输入框禁用成依赖全局模式。
  - 回归测试必须至少覆盖“built-in 项切换后生成 pi key”这条场景，避免 built-in provider 再次被误生成成 custom 路由 key。
  - `features.md` 必须记录本次修复。

## 186. built-in provider 填在设置页的 API key 也必须通过运行前校验 (2026-04-23)
- Priority: P1
- Stage: Delivered (2026-04-23)
- Problem:
  - built-in provider（例如 `google`）现在支持在 Providers 页填写 API Key Override，但运行前校验仍然只认环境变量或 `auth.json`，导致用户明明已经在设置页填了 key，系统却仍报“missing credentials for provider 'google'”。
  - 真正请求发送时其实已经能从 settings 里读到 built-in provider 的 `apiKey`，只是前置校验先把流程拦死，形成“设置已填但仍提示没填”的假错误。
- Requirement:
  - 当当前活动模型是 built-in provider 时，运行前校验必须同时接受三种凭据来源：环境变量、`auth.json`、以及 Providers 页保存的 API Key Override。
  - 不能再因为缺少 `GOOGLE_API_KEY` 环境变量而否定已经保存在 settings 中的 built-in key。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 的 built-in 凭据校验必须传入 settings 中对应 provider 的 `apiKey` 作为 fallback。
  - `features.md` 必须记录本次修复。

## 187. built-in provider 的内部默认模型必须压过旧的 PI fallback 残留值 (2026-04-23)
- Priority: P1
- Stage: Delivered (2026-04-23)
- Problem:
  - 当前 built-in provider 页面允许用户给 `google-vertex` 之类的内置 provider 配置“Attached Models + internal default model”，但运行时的 PI fallback 仍可能继续沿用旧的 `piModelName` 残留值。
  - 结果就是：界面里明明只剩 `gemini-3.1-flash-lite-preview`，日志里却还在请求旧的 `gemini-1.5-flash`，让用户误以为当前配置根本没有生效。
- Requirement:
  - 当某个 built-in provider 在 settings 里已经有自己的模型列表和内部默认模型时，运行时与 `/models` 的内置 fallback 选择必须优先使用这份当前配置。
  - 如果旧的 `piModelName` 不在该 built-in provider 当前已挂载的模型列表中，系统必须自动回退到该 provider 的 `defaultModel` 或第一条可用模型，不能继续沿用旧值。
- Enforcement:
  - `src/lib/server/settings/modelSwitch.ts` 必须提供 built-in provider 默认模型解析逻辑，并让 `currentModelKey` / built-in 选项输出复用它。
  - `src/lib/server/agent/runner.ts` 在解析 PI model 和构造 PI fallback 候选时必须复用同一套解析逻辑。
  - 回归测试必须覆盖“旧 `piModelName` 为 `gemini-1.5-flash`，但当前 built-in provider 默认模型已改成 `gemini-3.1-flash-lite-preview` 时，实际使用 3.1 而不是 1.5”。
  - `features.md` 必须记录本次修复。

## 188. 禁用后的 custom provider 不能再被旧路由 key 命中 (2026-04-23)
- Priority: P1
- Stage: Delivered (2026-04-23)
- Problem:
  - 当前如果 `modelRouting.textModelKey` 还残留着旧的 `custom|provider|model`，即使对应 custom provider 已经在设置页里被禁用，运行时仍会直接命中它。
  - 这会造成“/models 列表已经看不到它，但实际对话一失败又回去用它”的错觉，尤其在从旧模型切到 built-in 后更容易出现。
- Requirement:
  - routed custom model 在被真正选中前，必须同时满足“provider 存在、provider 仍是 enabled、provider 配置可用、model 仍支持当前 use case”。
  - 只要 provider 已被禁用，就不能仅靠残留的旧 route key 继续参与当前运行。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 的 routed custom 分支必须检查 `provider.enabled !== false`。
  - `features.md` 必须记录本次修复。

## 189. fallback / retry 选模型时也必须严格遵守 Enabled (2026-04-23)
- Priority: P1
- Stage: Delivered (2026-04-23)
- Problem:
  - 即便旧的 routed key 已经被拦住，运行时在 `providerMode=custom` 的“默认 custom provider”分支，以及后续“遍历所有 custom provider 做兜底”分支里，之前仍可能把已经禁用的 provider 重新选出来。
  - 这会导致用户看到 `/models` 只剩 1 个可用模型，但一旦重试/回退，系统又拿出已经 Disable 的旧 provider 继续尝试。
- Requirement:
  - 所有 custom provider 参与当前文本/视觉模型选择前，都必须统一满足 `enabled !== false`。
  - 不仅 routed key 命中要检查，默认 custom provider 选择和通用 fallback 扫描也都必须检查。
- Enforcement:
  - `src/lib/server/agent/runner.ts` 的 `getSelectedCustomProvider()` 必须过滤掉禁用 provider。
  - `src/lib/server/agent/runner.ts` 在遍历 `settings.customProviders` 做 fallback 扫描时必须跳过禁用 provider。
  - `features.md` 必须记录本次修复。

## 190. AI Providers 页必须降低配置误操作和长列表维护成本 (2026-04-24)
- Priority: P2
- Stage: Delivered (2026-04-24)
- Problem:
  - Providers 页在常见桌面宽度下容易退化成上下布局，编辑区被长 provider 列表挤到下方，维护模型时需要大量滚动。
  - built-in provider 的模型清单通常很长，默认完整展开会让页面噪音过高，也让真正要改的 provider 配置不易定位。
  - `Thinking Support = Auto` 容易被理解成自动探测，但当前运行时只有明确 `Enabled` 才会发送 thinking 参数；`Thinking Format = Auto` 在启用后又会按 OpenAI-style `reasoning_effort` 发送，存在误配风险。
  - `Reasoning Effort Mapping` 容易被理解成“思维维度”配置，但实际只是 low/medium/high 到上游参数字符串的映射。
- Requirement:
  - Provider 列表和编辑区在常见桌面宽度下应保持两栏，并让左侧列表独立滚动。
  - built-in provider 模型列表默认只展示前几项，用户需要时再手动展开完整列表。
  - 自定义 provider 的 thinking 设置必须在 UI 中解释真实运行行为，包括 unknown 不自动探测、Auto format 的 OpenAI fallback、以及 provider 级配置会影响该 provider 下所有模型。
  - effort mapping 的文案必须明确它只是参数值映射，不是新增思维维度。
- Enforcement:
  - `src/routes/settings/ai/providers/+page.svelte` 必须改进布局断点、左侧滚动、built-in 模型折叠和 thinking 配置提示。
  - `features.md` 必须记录本次 UI/配置语义优化。

## 191. AI Providers / Routing 必须表达同一个混合模型池 (2026-04-24)
- Priority: P2
- Stage: Delivered (2026-04-24)
- Problem:
  - 后端已经允许 built-in 与 custom 模型通过 `pi|...` / `custom|...` route key 混用，但 UI 仍把它们表达成两套配置逻辑。
  - Routing 页把 legacy `providerMode`、PI provider、PI model fallback 放在主流程里，用户容易误以为必须先选择 built-in 或 custom 其中一种模式。
  - 两个页面大量使用硬编码 white/black/slate/emerald 类名，明暗主题下主要依赖全局覆盖，局部页面自身不够稳。
- Requirement:
  - Routing 页必须把模型选择表达成统一能力路由：text / vision / stt / tts 每条路由都可选择 built-in 或 custom 模型。
  - Legacy fallback source、PI fallback provider/model 只能作为兼容兜底展示，不能继续占据主配置心智。
  - Providers 页必须说明 built-in transports 和 custom endpoints 都进入同一个 routing pool，并提供到 Routing 页的直接入口。
  - 两个页面的主要面板、输入、footer、状态提示应优先使用主题变量，适配明暗主题和移动端布局。
- Enforcement:
  - `src/routes/settings/ai/routing/+page.svelte` 必须重构为统一模型池概览、能力路由、运行时默认值、兼容兜底和 prompt 区块。
  - `src/routes/settings/ai/providers/+page.svelte` 必须同步文案、跳转入口和主要面板样式。
  - `features.md` 必须记录本次页面融合与样式优化。

## 192. Web chat 必须升级为桌面 Agent 工作台式 UI (2026-04-24)
- Priority: P1
- Stage: Delivered (2026-04-24)
- Problem:
  - 现有外部 Web chat 已经能用，但视觉仍偏普通聊天页，左侧会话、主消息流、底部输入区的密度和工具感不足，不适合长期作为可展示的产品入口。
  - 参考截图里的右侧文件区当前还没有完整能力，如果直接展开会制造功能预期落差。
- Requirement:
  - Web chat 首屏应改成桌面 agent shell：左侧会话导航、中间消息工作区、右侧 Files 入口。
  - 主消息区应从气泡式聊天改成更像工作日志的消息流，保留发送、停止、附件、录音、模型选择、思考档位、主题与语言切换等现有功能。
  - 右侧 Files 区域必须保留扩展口子，但默认折叠；当前只展示占位说明，不接入未完成的文件管理能力。
- Enforcement:
  - `src/routes/+page.svelte` 必须完成布局与视觉改造，不改动 Channel/Agent 业务层。
  - `features.md` 必须记录本次 Web chat UI 升级。

## 193. Web 多语言切换必须可靠覆盖 Settings 子页面 (2026-04-24)
- Priority: P1
- Stage: Delivered (2026-04-24)
- Problem:
  - Chat 和 Settings 各自读取 `localStorage`，语言状态没有统一来源；在 Settings layout 里切换语言后，已经挂载的子页面不会自动刷新自己的文案。
  - 许多 Settings 子页面仍是英文硬编码，导致中文模式下导航已经中文化，但页面主体仍然出现大量英文。
- Requirement:
  - Web 端必须有一个共享 locale 状态，Chat 和 Settings 都从同一处读取/写入。
  - 已经具备结构化 `COPY/I18N` 的页面，在语言切换时必须立即响应。
  - 对还没逐页迁移的 Settings 英文硬编码，必须提供可控的中文兜底翻译层，覆盖常见标题、按钮、表单标签、占位符和状态字段。
- Enforcement:
  - 新增共享 locale 工具，替代页面各自散落的 locale 读写。
  - Settings layout 必须挂载中文兜底翻译层，并在切回英文时恢复原文。
  - `features.md` 必须记录本次多语言修复。

## 194. Web chat 回复必须支持 Markdown 渲染并自动定位最新消息 (2026-04-24)
- Priority: P1
- Stage: Delivered (2026-04-24)
- Problem:
  - Web chat 的 assistant 回复直接显示 Markdown 源码，标题、列表、代码块、表格和链接没有转成可读排版。
  - 长会话打开后默认停在最上方，用户需要手动滚到最新消息；流式输出更新时也应该持续跟随最新内容。
- Requirement:
  - Markdown 解析必须使用成熟第三方库，不能依赖手写解析器。
  - HTML 输出必须经过受控清洗，避免模型返回的原始 HTML / script / unsafe link 直接进入页面。
  - 历史消息加载完成后应定位到最新消息；流式 token / replace / thinking 更新时应保持滚动到最新内容。
- Enforcement:
  - `src/routes/+page.svelte` 必须使用 `marked` 渲染 assistant Markdown，并只允许受控 HTML 标签和安全链接协议。
  - `package.json` / `package-lock.json` 必须把 `marked` 声明为 root 依赖。
  - `features.md` 必须记录本次 Markdown 与滚动体验修复。

## 195. 本地工具必须支持延迟搜索加载以压缩启动上下文 (2026-04-25)
- Priority: P1
- Stage: Delivered (2026-04-25)
- Problem:
  - 本地工具越来越多时，全部默认暴露会把工具描述和配套 prompt 规则塞进每轮启动上下文。
  - 事件/提醒能力很重要，但不是每轮都会用；当前完整 Events 说明默认加载，明显增加普通聊天的 token 成本。
- Requirement:
  - runtime 必须提供一个 `toolSearch` 元工具，用来搜索和加载默认未暴露的本地工具。
  - 所有 Molibot 自定义工具名必须使用 camelCase，不能继续使用 snake_case，避免下划线被模型、Markdown 或供应商适配层吞掉。
  - prompt 必须明确列出 `<available-deferred-tools>`，让模型知道可异步加载的工具名，而不是只靠自然语言猜。
  - `toolSearch` 返回结果必须包含匹配工具的 `description/name/parameters` schema 表达，方便模型在同一轮之后按真实 schema 调用。
  - 首批延迟工具至少覆盖 `createEvent`，提醒/计划/周期任务场景先搜索加载，再调用真实工具。
  - 低频管理工具（如模型切换、技能草稿管理、profile 文件管理）也应进入 deferred 层：默认只暴露短描述和轻量入口，完整说明和参数 schema 由 `toolSearch` 返回。
  - 如果模型提前调用 deferred 工具名，运行时不能反复返回 `Tool ... not found` 或进入 `call again` 死循环；必须有轻量入口完成加载，并在参数足够时直接委托真实工具执行。
  - 搜索必须识别 camelCase 工具名拆词，`create event` 和 `createEvent` 都应命中同一个 deferred 工具。
  - deferred tool 搜索和加载必须有足够日志，能看清 query 如何 normalize、匹配了哪些候选、为什么命中/没命中、最终是否加载进 active tool set。
  - 延迟加载必须发生在 Agent 共享上层，不放到 Channel 层；新增渠道不需要为该能力改各自 runtime。
  - prompt 中只保留必要路由规则，具体工具 schema/说明由延迟加载后的工具描述提供。
  - 从启动 prompt 移除的事件详细规则必须迁入 `createEvent` 自身描述，不能因为 deferred 化而丢失行为约束。
- Enforcement:
  - `src/lib/server/agent/tools/toolSearch.ts` 必须实现 deferred tool 搜索和加载返回，支持 `select:a,b` 与 `+required` 查询形式。
  - `src/lib/server/agent/tools/index.ts` 必须把 `createEvent`、`switchModel`、`skillManage`、`profileFiles` 从默认完整工具列表移入 deferred registry。
  - `src/lib/server/agent/tools/index.ts` 必须提供轻量 deferred entry，防止模型提前调用 deferred 工具时报 not found；由于 pi-agent-core 会在 run 开始时快照 tools，该 entry 必须能在同一 run 内委托真实工具执行。
  - `src/lib/server/agent/tools/toolSearch.ts` 的匹配逻辑必须把 camelCase 拆成可搜索词。
  - `src/lib/server/agent/tools/toolSearch.ts` 和 `src/lib/server/agent/tools/index.ts` 必须记录搜索解析、候选评分、加载前后状态和 active tool names。
  - `src/lib/server/agent/tools/event.ts` 必须承载 event 类型、delivery、cron、禁止 shell scheduler、成功原样回复、失败不声称成功、周期 `[SILENT]` 等工具级说明。
  - `src/lib/server/agent/runner.ts` 必须在 deferred 工具加载后刷新当前 agent 的本地工具列表，同时保留已加载 MCP 工具。
  - `src/lib/server/agent/prompt.ts` 必须移除默认 Events 长说明，加入 `<available-deferred-tools>` 与 ToolSearch 协议，只保留 `toolSearch -> createEvent` 的执行规则。
  - `src/lib/server/agent/toolPolicy.ts` 和所有插件工具声明必须同步使用 camelCase 工具名。
  - `features.md` 必须记录本次能力落地。

## 196. Telegram 工具调用、错误详情和最终回复必须分消息展示 (2026-04-25)
- Priority: P1
- Stage: Delivered (2026-04-25)
- Problem:
  - Telegram 当前复用同一个状态消息承载工具进度、错误提示和最终答案，最终 `replaceMessage` 会覆盖前面的工具调用显示。
  - 多个工具错误或运行详情会各发一条回复，聊天里容易出现重复错误消息，用户难以区分“执行过程”和“最终结果”。
- Requirement:
  - Telegram 先落地三段式显示：工具/进度一条消息，错误/运行详情聚合为一条消息，最终答案单独一条消息。
  - 工具/进度消息必须使用紧凑列表展示，包含图标、工具名和简短结果摘要；单条摘要需要限制最大长度，避免工具输出刷屏。
  - 工具/错误展示必须保持在 Channel 展示层，不把 Telegram 的消息拆分策略下沉到 Agent 业务逻辑。
  - Feishu / QQ / Weixin 可后续按各自平台能力再做同类展示优化。
- Enforcement:
  - `src/lib/server/channels/telegram/runtime.ts` 必须将 progress/details/final answer 拆成独立消息句柄。
  - `src/lib/server/channels/telegram/runtime.ts` 必须把结构化工具事件格式化为 Telegram 友好的紧凑工具调用列表。
  - `respondInThread` 在 Telegram 中必须复用同一条详情消息追加内容，避免一轮运行产生多条重复错误消息。
  - `features.md` 必须记录本次 Telegram 消息展示优化。

## 197. 工具调用上限后不得覆盖已输出内容，并应尝试无工具续写 (2026-04-26)
- Priority: P1
- Stage: Delivered (2026-04-26)
- Problem:
  - 一轮运行达到工具调用上限后，模型可能继续请求工具，最终 Runner 进入错误收尾。
  - 如果本轮已经流式输出过正文，最终错误兜底仍可能调用 `replaceMessage`，把已有正文覆盖成 `Sorry, something went wrong.` 或类似失败文案，导致用户丢失已经生成的内容。
- Requirement:
  - Runner 必须在 Agent 共享层保存本轮已流出的 assistant 正文；出错时优先保留这部分内容。
  - 工具调用预算耗尽后的错误详情应进入运行详情/线程说明，不应覆盖最终答案消息。
  - 达到工具调用上限后，Runner 应尝试一次新的无工具模型请求，让模型基于已有上下文给出当前最佳答案；不能无限续跑。
  - 新的无工具续写应尽量使用一条新的回复消息承载；第一条回复末尾保留现有预算耗尽提示，让用户明确知道后续是新请求。
  - 自动续写最多执行一次；如果续写后仍不完整或再次触发上限，必须明确告诉用户可以手动发送“继续”，由用户决定是否开启下一轮。
  - 该能力必须放在 Agent/共享运行层，不能分别塞进 Telegram/QQ/Feishu/Weixin 的 Channel 适配代码。
- Enforcement:
  - `src/lib/server/agent/runtimeBudget.ts` 必须暴露预算耗尽原因，供 Runner 判断是否触发续写或部分结果保护。
  - `src/lib/server/agent/runner.ts` 必须记录流式正文、在工具上限时清空工具列表并只尝试一次无工具 continuation prompt。
  - `MomContext` 应提供可选的 continuation response 边界能力；Telegram 必须把上限前后的回答拆成两条消息。
  - continuation message 必须包含手动继续提示，避免系统静默停止或继续自动递归请求。
  - `src/lib/server/agent/runner.ts` 的异常收尾必须在已有 partial answer 时跳过错误 `replaceMessage`，改为把错误写入详情。
  - `features.md` 必须记录本次可靠性修复。

## 198. 复杂代码任务必须支持共享子 Agent 委派 (2026-04-26)
- Priority: P1
- Stage: Delivered (2026-04-26)
- Problem:
  - 一轮主 Agent 运行存在工具调用上限，复杂代码任务在“侦察 -> 规划 -> 修改 -> 复核”多阶段流程下容易把父 run 卡死在预算边界。
  - 现有 Channel 共享层虽然已有队列、恢复、预算与 prompt 规则，但还没有一个正式的共享子 Agent 能力来把复杂任务切成多个独立 run。
  - 如果把这类能力放到各个 Channel runtime 里，会违反 Molibot 当前“共享上层负责编排、Channel 只负责收发与适配”的边界。
- Requirement:
  - Agent 共享层必须提供一个 `subagent` 工具，基于 `@mariozechner/pi-coding-agent` 的独立 session 能力运行子 Agent，而不是在 Channel 层各自实现一套委派逻辑。
  - 初版必须复用四个固定角色：`scout`、`planner`、`worker`、`reviewer`，并支持单任务、有限并行任务、顺序 chain 三种委派模式。
  - 子 Agent 必须拥有独立上下文和独立工具预算；父 Agent 只消费子 Agent 的结果摘要，不把整段子会话塞回主上下文。
  - `worker` 子 Agent 内的文件修改能力必须继续沿用 Molibot 现有的受保护 `read` / `bash` / `edit` / `write` 约束，不能因为引入 pi-mono SDK 就绕过已有路径/设置/内存安全边界。
  - Prompt 必须明确告诉父 Agent：当任务天然分成“侦察、规划、执行、复核”阶段，或者预计会消耗大量工具调用时，应优先考虑 `subagent`，而不是把所有阶段硬塞进一个父 run。
  - 默认运行日志必须明确显示何时进入 `subagent`，以及具体是哪个子 Agent 角色在执行哪一步，否则 operator 无法判断一轮工作是父 Agent 还是 delegated child session 在跑。
- Enforcement:
  - `src/lib/server/agent/tools/subagent.ts` 必须实现共享 `subagent` 工具，并复用 upstream-style 四个 agent prompt 定义。
  - `src/lib/server/agent/tools/index.ts` 必须将 `subagent` 暴露给主 Agent。
  - `src/lib/server/agent/toolPolicy.ts` 必须把 `subagent` 纳入串行执行集合，避免与其他重型/可变工具并发踩踏。
  - `src/lib/server/agent/prompt.ts` 必须补充 `subagent` 的适用场景、角色说明和 chain/parallel 使用规则。
  - `src/lib/server/agent/log.ts` 必须默认输出 `subagent_start` / `subagent_task_start` / `subagent_task_end` / `subagent_end` 事件，并在 pretty 模式下带上 delegated role、step、mode、usage 等关键信息。
  - `features.md` 必须记录本次能力落地。

## 199. QQ SDK 应跟进上游协议和媒体能力，但不接管共享编排 (2026-05-01)
- Priority: P1
- Stage: Delivered (2026-05-01)
- Problem:
  - 本地 `package/qqbot` 基于较早的 QQ Bot SDK 形态开发，已经落后于上游 v1.7.1 的群策略、引用消息、审批交互、Slash 命令、媒体上传和附件处理能力。
  - 直接整包覆盖会把 OpenClaw 插件工具注册、热升级、队列/调度等宿主能力混进 Molibot 的 Channel SDK，破坏“Channel 只做平台适配，共享上层做编排”的边界。
- Requirement:
  - `package/qqbot` 应同步上游 QQ 协议、消息解析、媒体发送、引用上下文、审批交互和 STT 附件处理等 SDK 层能力。
  - Molibot 自己的入站队列、会话推进、任务调度和 ACP 共享控制仍必须留在共享 runtime / Agent 层，不因 SDK 升级下沉到 QQ Channel。
  - 上游运行时只存在于 OpenClaw 插件宿主里的入口不能成为 Molibot 构建的硬依赖；本地包需要使用 Molibot 可解析的运行时入口或本地兼容实现。
  - 升级后必须保留可运行的媒体出站回归覆盖，尤其是缺失凭证短路和用户可见错误文案映射这类不依赖真实 QQ 网络的稳定逻辑。
- Enforcement:
  - `package/qqbot` 版本标记为 `1.7.1` 并同步 package lock。
  - `package/qqbot/src/channel.ts` 不得运行时导入 Molibot 不存在的 `openclaw/plugin-sdk/core`。
  - 当 `startGateway()` 收到 `onEvent` 回调时，表示 Molibot 已经接管入站、命令、队列和 ACP；此模式下不得无条件调用 `getQQBotRuntime()`，也不得启动 OpenClaw approval gateway 或 SDK slash-command 拦截。
  - `/bot-upgrade` 在 Molibot 默认必须是文档指引模式，不能默认执行 npm 热更新；只有显式配置 `upgradeMode="hot-reload"` 时才允许进入热更新路径。
  - `package/qqbot/src/outbound.test.ts` 必须覆盖升级后的稳定出站行为。
  - `npm --prefix package/qqbot run build` 和 `npm run build` 必须通过。
  - `features.md` / `CHANGELOG.md` / `README.md` 必须记录本次交付边界。

## 200. 普通 scratch 生成物应按日期目录归档 (2026-05-10)
- Priority: P1
- Stage: Delivered (2026-05-10)
- Problem:
  - 同一个 chat 的普通生成文件长期平铺在 `scratch/` 根目录下，数量变多后难以查找、清理和判断文件产生时间。
  - 直接把工具 cwd 改到日期目录会破坏既有路径语义，尤其是 `scratch/events` 这类 watched runtime 目录。
- Requirement:
  - `scratch` 必须继续作为工具运行根目录，保持现有相对路径、安全护栏和事件监听语义。
  - 普通生成物默认写入 `scratch/YYYY/MM/DD/`，日期按 runtime timezone 计算。
  - `events/`、显式用户路径、技能/工具要求的特定路径必须保持原路径，不得被自动移入日期目录。
  - Agent 每轮模型输入应提供当前默认产物目录，且该运行时提示不能污染持久化 session 对话内容。
- Enforcement:
  - `buildPromptInputEnvelope()` 必须在 transient `<env>` 中提供 `scratch_artifact_dir`，但 persisted message 仍只保存原始用户消息和附件标记。
  - 共享 `write` 工具对普通文件名应用日期目录默认路由；带目录的显式路径和绝对路径保持不变。
  - 共享 `bash` 工具必须暴露 `$MOLIBOT_SCRATCH_ARTIFACT_DIR`，方便 shell 命令把普通产物写入同一个日期目录；对命令新生成在 scratch 根目录的普通产物文件，应在命令结束后自动归档到当天目录。
  - `attach` 对 bash 自动归档后的普通产物应提供兼容查找：当旧根路径缺失且当天目录存在同名文件时，发送当天目录文件。
  - 系统提示必须明确普通产物与 runtime/control 文件的边界，避免把 event JSON 写进日期目录。

## 201. Skills 命令输出应分层，避免默认刷全量详情 (2026-05-16)
- Priority: P1
- Stage: Delivered (2026-05-16)
- Problem:
  - 当前 `/skills` 默认直接返回完整 description/aliases/file 等全量信息，在技能较多时可读性差，也不利于先快速扫一遍当前已加载技能。
  - Web chat 和共享聊天命令都支持 `/skills`，如果只在某个 Channel 单独改，会再次违反“共享上层负责公共命令、Channel 只做适配”的边界。
- Requirement:
  - `/skills` 默认只返回已加载技能的名字和路径，作为轻量索引视图，并使用和 `/models` 一致的表格输出便于扫读。
  - `/skills <id>` 必须支持按 `name/alias` 查询单个技能详情，方便在索引视图后继续下钻。
  - `/skills-detail` 必须保留全量详情清单，兼容需要一次性查看完整技能元数据的场景。
  - Web chat 的本地命令处理和共享 runtime 命令层必须复用同一套选择/格式化语义，避免两个入口输出不一致。
- Enforcement:
  - 选择器解析与 summary/detail formatter 必须放在 `src/lib/server/agent/skills.ts` 这类共享技能层，而不是散落在具体 Channel 或 Web handler 里各写一套。
  - `src/lib/server/agent/channelCommands.ts` 与 `src/routes/api/chat/+server.ts` 都必须支持 `/skills`、`/skills <id>`、`/skills-detail`，并同步更新 `/help` 文案。
  - 回归测试至少覆盖 summary、single detail、full detail 三种输出模式。

## 202. Agent 精简优化架构改造 (v2.2) (2026-05-28)
- Priority: P0
- Stage: In Progress
- Problem:
  - 核心组件 `runner.ts` (3226 行) 承担了过多的职责（turn生命周期、LLM推理、工具运行、审批、内存加载等），极难进行维护和扩展。
  - ACP (Agent Control Plane) 模块引入了多余的复杂度，对于单用户的 personal agent 来说没必要。
  - 工具执行路径碎片化且缺乏统一控制，审批逻辑中也缺少一次性/会话/工作空间级 Scope 授权，容易造成频繁审批或越权。
- Requirement:
  - 隔离下线 ACP 业务，新增 SQLite-backed workspaces 管理，替代 ACP 确立上下文和权限边界。Workspace ID 必须作为逻辑权限与隔离边界，绝不干预或搬移物理文件目录结构。
  - 将 `runner.ts` 拆解为 `TurnOrchestrator`（控制 turn 生命周期、Session 锁、Workspace 绑定和 Memory 读写）和 `PiAgentRuntime`（只负责 LLM 推理循环）。
  - 实现统一的 `ToolRuntime` 收口所有内置、MCP、宿主和插件工具的执行，引入 inline policy 判断。废除全局 bypass 开关，改用渐进注册限制。
  - 新建独立的 `ApprovalBroker`，支持 once/turn/session/workspace/persistent 五级授权 scope、1.5 秒 debounce 审批聚合、subagent 审批上提到父任务 chat 会话，以及 5 分钟超时自动 expire 机制。
  - 渐进将 workspaces、channel_settings、plugin_settings 配置项从 settings.json 拆分至 SQLite 关系表。
- Enforcement:
  - Phase 1: 仅下线 ACP 活跃引用并保留源码为 legacy inactive，不物理删除 acp 目录。创建 workspaces 数据库表及 `WorkspaceStore` / `WorkspaceResolver`，默认空间绑定 `"personal"`。
  - Phase 2: 以增量（additive）方式编写 `TurnOrchestrator`，逐步将管道按 Web -> stream -> shared IM -> Telegram -> CLI 灰度迁移，最终剥离 MomRunner 的生命周期逻辑，将 `runner.ts` 精简至 1500 行以内。对并发请求启用 10 分钟锁超时控制，启动时释放 running 遗留锁。
  - Phase 3: 切片式建立 `ToolRuntime`（先收口 Built-in，再对 Host Bash/MCP 实施迁移，沙箱崩溃禁止 fallback 宿主直接执行）与 `ApprovalBroker`（以 SQLite 存储 grants 和 requests，对接 Channel 层的 `renderApproval()`，加入 Subagent 审批冒泡、1.5秒 Debounce 和 5分钟超时 Expire）。
  - Phase 4: 渐进迁移第一批 settings 配置至 SQLite，保留 settings.json 引导和自动落库逻辑。
  - Phase 5: 新架构稳定后物理清除 `acp/` 源码库及兼容过渡开关。
- Progress:
  - 2026-05-29 (Pluggable Sandbox Runtime): Refactored the sandbox implementation inside `sandbox.ts` to be pluggable and decoupled from the Anthropic SDK. Defined standard configuration type shapes and the generic `SandboxProvider` interface. Enclosed Anthropic SDK inside `AnthropicSandboxProvider` and added getter/setter registration methods. Wrote dynamic mock provider tests inside `sandbox.test.ts` and verified 100% green regression test pass.
  - 2026-05-29 (Phase 3 Integration): Fully integrated ToolRuntime and ApprovalBroker. Wrapped dynamically loaded MCP tools and labeled their source as `"mcp"`. Propagated parent `runId` to subagents as `scopeId` with `requestedByDepth: 1` to bubble up subagent approvals. Persistent `requestedByDepth` in `approval_requests` SQLite table via `HostBashStore`. Verified zero compilation errors and all agent and approval tests passed successfully.
  - 2026-05-29: Built-in tools (read, write, edit, bash) have been fully refactored as ToolDefinitions. SafeFsApi (including readBuffer), SafeShellApi (with sandbox metadata), and SafeNetworkApi are fully implemented in ToolExecutionContext. Custom decidePolicy for ToolRuntime orchestrates sandbox checks and Host Bash approvals. Legacy bridge toolDefToAgentTool introduced for subagents backwards compatibility. Modified files type-check with zero errors.
  - 2026-05-29 (Relocation & Modularity): Fully relocated and structured all 60+ agent files into dedicated subdirectories (`core`, `routing`, `prompts`, `tools`, `skills`, `session`, `identity`, `common`, `commands`). Resolved all relative and absolute imports workspace-wide. Wrote a custom Node.js ESM test loader (`md-loader.js` and `register-loader.js`) to support raw markdown imports. Fixed various logic, mock, path, and directory-creation bugs across the test suite. Regression test run successfully verified with **100% green tests** (25/25 suites passed).
  - 2026-05-28: v2.2 核心优化与重构整合已全面落地：`TurnOrchestrator` 已完全接入 `runner.ts` 并在所有分支更新状态、并在 `runtime.ts` 中完成启动死锁清理，在 `baseRuntime.ts` 中直接进行 turn 准备；所有内置工具通过 `ToolRuntime` 及 `ToolRegistry` 统一进行执行、鉴权和审批；`ApprovalBroker` 与 `HostBashStore` 已完全重构，直接映射到 SQLite 的 request/grant 表中；`runtime.ts` 已被模块化解耦，配置清洗抽取至 `settings/sanitize.ts`，插件激活提取至 `plugins/loader.ts`，主引导文件缩减至 150 行以内。
  - Remaining: 仅剩 Phase 5 遗留清理——待新架构稳定运行后物理清除 `acp/` 源码库与旧过渡兼容代码。

## 203. 沙盒多层控制与审批自动恢复优化 (2026-05-30)
- Priority: P0
- Stage: Delivered (2026-05-30)
- Problem:
  - 缺乏会话 (Session)、渠道实例 (Bot)、智能体 (Agent) 级别的沙盒精细化控制。一旦全局启用沙箱，所有会话均强制使用，无法按需关闭。
  - 主机命令审批流程体验繁复，审批通过后执行流往往中断，需要用户在会话中手动操作才能继续推进，导致交互体验极不顺滑。
  - 工具执行时的开发环境（如 Python 虚拟环境、GOPATH、GOCACHE 等）缺乏统一的管理目录，容易散落在不同的临时会话中，导致工具依赖反复安装或环境不一致。
- Requirement:
  - 支持 `Session Override > Bot Instance Override > Agent Override > Global Default` 的沙盒控制链。
  - 新增终端指令 `/sandbox`，支持直接查询当前会话的有效沙盒状态，并允许对其进行 Session、Bot、Agent 级别的临时/永久开关重写。
  - 自动执行恢复机制：当敏感主机命令被用户批准后，自动定位会话上下文中对应的 toolCall 和 toolResult 消息，重写执行输出结果为真实 stdout/stderr，并自动在后台唤醒/触发 runner 继续执行，实现无缝连贯的对话交互。
  - 可定制的主机工具运行目录：提供统一的工具安装及运行环境根目录（如 `~/.molibot/tooling`），自动为 `bash` 等主机工具注入独立的 `venv`、`GOPATH` 和 `GOCACHE` 等路径，避免环境受限于单次会话临时目录。
- Enforcement:
  - 在 `settings/schema.ts`、`sanitize.ts` 和各设置接口中支持 `sandboxEnabled` 字段，并在 Settings SQLite 存储中支持数据库表自动 ALTER COLUMN 迁移。
  - 在 `channelCommands.ts` 中实现 `/sandbox` 指令的指令解析与生效范围覆盖逻辑。
  - 在 `baseRuntime.ts` 与 Web API `+server.ts` 中实现 approved 命令自动重写上下文消息和后台触发 runner.run / runSharedTextTask。
  - 在 `helpers.ts` 与 `sandbox.ts` 中实现工具依赖环境变量注入与白名单目录自动解析，支持通过环境变量 `MOLIBOT_TOOLING_DIR` 或默认目录 `~/.molibot/tooling` 隔离工具环境。

## 204. 消息返回与展示布局优化 (Message Return & Display Layout Optimization) (2026-05-30)
- Priority: P0
- Stage: Delivered (2026-05-30)
- Problem:
  - 消息展示布局在不同渠道（Telegram, Feishu, QQ, Weixin）中很乱，工具调用进度、模型思考过程以及错误信息经常混杂在一起，用户交互不够清晰。
  - 缺乏细粒度的展示控制。之前只依赖一个粗粒度开关控制流式输出，一旦关闭则连正常的回答流都全被关闭。
- Requirement:
  - 提取出统一的 `DisplayFormatter` 作为共享展示格式化层，以实现消息布局的归一化与解耦。
  - 支持实例级别（Bot/渠道实例维度）的细粒度展示设置，包括工具进度等级 (`toolProgress`: `off` | `new` | `all` | `verbose`) 以及模型思考展示 (`showReasoning`: `off` | `on` | `stream` | `new`)。
  - `showReasoning` 必须与最终答案解耦：`on`/`stream` 使用独立思考消息展示完整 reasoning，`new` 仅动态展示最近一句 reasoning，用于判断模型是否仍在推进。
  - 增加两个独立的机器人会话指令 `/toolprogress` 和 `/showreasoning`，用于在终端直接调整当前渠道实例的独立展示行为，且互不干扰。
- Enforcement:
  - 扩展 settings 相关的 schema、sanitize 逻辑，添加对 `display`（`toolProgress`、`showReasoning`、`gatewayNotifyInterval`）属性的保存、校验与去静默抹除支持。
  - 在 `channelCommands.ts` 中完成独立指令 `/toolprogress` 和 `/showreasoning` 的开发，并打通 SQLite `settings_channel_instances` 表的 `display_json` 字段及 `settings.json` 的全局序列化存储，以确保在系统重启后独立展示配置能够被持久保留。
  - 在共享格式化层 `DisplayFormatter` 中统一处理思考块的捕获（`thinking_start/delta/end`）、工具运行状态整合、答案渲染和独立 reasoning 渲染。
  - 在 Telegram 运行时、Feishu 运行时和 StreamingSession 中引入 `DisplayFormatter` 与配置适配；在 QQ/Weixin 中接入 `toolProgress === 'off'` 判断，跳过中间进度信息的批量发送，防止刷屏。同时，在 QQ 和微信中引入消息流缓冲区（`messagesBuffer`），将工具执行进度、模型思考、错误及最终答复进行合并缓冲，在运行结束、触发敏感审批或上传文件前一次性拼接并以单个消息气泡发送，极大限度地消除了在不支持消息编辑的平台上的刷屏问题。

## 205. 自定义模型启用状态保存修复 (Custom Model Enable State Serialization Fix) (2026-06-06)
- Priority: P0
- Stage: Delivered (2026-06-06)
- Problem:
  - 在修改自定义模型配置并保存时，模型列表的单模型启用状态无法被持久化（即使在 UI 中将其关闭，保存并传给后台 API 依然是启用状态）。
- Requirement:
  - 修正前端保存逻辑，打通 model `enabled` 状态的完整序列化，确保用户可以在提供商设置中彻底关闭某些模型，不让其参与系统路由。
- Enforcement:
  - 修正 `+page.svelte` 中的 `ensureProviderDefaults` 映射逻辑，确保在保存映射前，模型对象的 `enabled` 字段被正确透传，防止其被误置为 undefined 并最终默认解析为 true。
  - 在 `addModel`、`confirmAddModel` 和 `addDiscoveredModel` 中为新模型初始化提供默认值 `enabled: true`。

## 206. Runtime 日志 Hook 化收敛 (2026-06-07)
- Priority: P1
- Stage: Delivered (2026-06-07)
- Problem:
  - Agent runner 中的生命周期和工具调用日志与 HookManager/Trace 事件重复，导致同一运行事实同时散落在本地 `momLog` 调用和 hook 事件里。
  - 直接把日志写入 Trace 会混淆职责；日志输出应作为独立 hook consumer 统一管理，和 TraceRecorder 并列消费同一套运行事件。
- Requirement:
  - 新增 `RuntimeLogHook`，注册到默认 HookManager 中，负责 hook 能覆盖的 runtime 日志输出。
  - 先迁移 runner 中已经有 hook event 覆盖的 `run_start` / `run_end` / `tool_start` / `tool_end` / `tool_call_blocked`，不强改 Channel 层和 Web 即时诊断。
  - 保留 `/runlog` 归档、`onRunnerEvent` 前端/渠道即时状态，以及非 run 上下文的 adapter/SDK 运维日志。
  - 后续再单独评估 Trace fact 类型扩展，例如 `run`、`skill_usage`、`subagent_task`、`runtime_notice`、`approval`、`input_enrichment`。
- Enforcement:
  - 默认 hook 注册使用 `RuntimeLogHook` + `TraceRecorderHook`，日志输出和 Trace 入库保持并列关系。
  - runner 只补齐 hook payload 中日志需要的展示字段，不把 channel 发送、run detail archive、UI runner event 合并进日志 hook。
  - 单测必须覆盖 `RuntimeLogHook` 对 run/tool hook event 的日志映射，并回归 TraceRecorder 现有 tool/model fact 行为。

## 207. Trace Fact 类型扩展 (2026-06-07)
- Priority: P1
- Stage: Delivered (2026-06-07)
- Problem:
  - Trace facts 之前只聚合 `tool_call` 与 `model_call`，导致 run 生命周期、skill 使用、Sub Agent 任务、runtime notice、审批请求、输入增强等关键运行事实只能从 raw events 或散点日志中还原。
  - 如果直接把这些事件都按 model/tool 统计，会污染 `/settings/ai/trace` 的模型请求和 token 汇总。
- Requirement:
  - 扩展统一 `agent_trace_facts` 的 `fact_type`，支持 `run`、`skill_usage`、`subagent_task`、`runtime_notice`、`approval`、`input_enrichment`。
  - 保持现有 SQLite 表结构兼容，不新增专用表；新增 fact 的特定字段放入现有通用列与 `payload_json`。
  - runner 必须为输入增强、Sub Agent task、Host Bash approval request、预算/委派 runtime notice 发出对应 hook event。
  - `/settings/ai/trace` 必须能筛选新增 fact 类型，且统计汇总只把 `model_call` 算入模型请求，只把 `tool_call` 算入工具调用。
- Enforcement:
  - `TraceRecorderHook` 必须继续保留 raw trace events，同时把新增阶段 upsert 到 `agent_trace_facts`。
  - 新增状态值允许表达 `waiting`、`aborted`、`info`、`warning`，用于审批等待和 runtime notice。
  - 测试必须覆盖新增 fact 类型的入库，以及既有 `tool_call` / `model_call` 行为不回退。

## 208. 飞书视频附件不得误发为语音 (2026-06-12)
- Priority: P0
- Stage: Delivered (2026-06-12)
- Problem:
  - 飞书发送 `.mp4` 视频文件时，出站 MIME 判断把 `.mp4` 识别为 `audio/mp4`，触发音频转码并以语音消息发送。
  - 飞书入站附件解析也会把 `.mp4` / `.webm` 文件名推断成音频 MIME，导致视频附件元数据错误。
- Requirement:
  - `.mp4` 必须按飞书原生视频处理：上传 `file_type: mp4`，发送 `msg_type: media`。
  - 非 MP4 视频容器不得走语音转码；当前以普通文件附件发送。
  - 入站飞书 `media` / `video` 消息必须按媒体资源下载并保存为 `video` 附件。
- Enforcement:
  - 飞书音频识别不得把 `.mp4` / `.webm` 当作音频扩展名。
  - 飞书资源下载候选顺序必须让 `media` / `video` 消息优先走 `type=media`，不能被 `file_` key 前缀覆盖。
  - 单测必须覆盖 `.mp4` 出站发送为 `media`、`.webm` 出站发送为 `file` 而非 `audio`、`.mp4` 入站保存为 `video`。

## 209. 视频生成 Provider 响应日志可排障 (2026-06-12)
- Priority: P0
- Stage: Delivered (2026-06-12)
- Problem:
  - `videoGenerate` 失败时，运行日志只看到 provider request 和 body，缺少 provider response 状态和响应体，无法判断是参数错误、图片 URL 过期还是服务端错误。
  - 现有请求头日志会打印完整 `Authorization`，容易把 API Key 泄漏到终端日志或聊天排障粘贴内容中。
- Requirement:
  - 每次 provider HTTP 请求都应记录 response status 和 response body 摘要，包括非 2xx 失败响应。
  - 请求头日志必须脱敏 `Authorization`、API key、token、secret 类字段。
- Enforcement:
  - `videoGenerate` 的 fetch wrapper 在返回给 provider 解析前，先从 cloned response 读取并打印响应体；读取失败时打印明确的 body read 错误。
  - 单测必须覆盖失败 provider response body 被记录，且完整 API key 不出现在日志中。

## 210. Molibot macOS App (2026-06-27)

- Priority: P0
- Stage: In Progress — Phase 1 foundation, clean-machine runtime/data bootstrap, most local Chat/Settings surfaces, read-only external-session aggregation, and the first-launch health/Provider/Agent steps are delivered; native/live-service and signed release verification remain
- Detailed plan: [`docs/requirements/molibot-macos-app-plan.md`](docs/requirements/molibot-macos-app-plan.md)
- Product target:
  - 新增独立可安装的 Molibot macOS App，使用 Tauri 提供原生窗口、菜单栏、通知和生命周期管理，内置 Node 22 sidecar 复用现有 Agent、SvelteKit API 和多渠道运行时。
  - 首版发布 Apple Silicon、macOS 13+ unsigned beta，Bundle ID 为 `com.eztoolab.molibot`，通过 GitHub Releases 交付；正式公开版仍以 Developer ID 签名、公证和安全更新为前置条件。
- Requirement:
  - App 与现有 Web 共享 `~/.molibot`、Web Profile、session、设置和运行时数据，但 Desktop Chat 与 Desktop Settings 必须是 `apps/desktop` 下完全独立的 Svelte UI，不嵌入或复用现有 Web 页面和页面 CSS。
  - 本地服务默认只监听 `127.0.0.1`，优先使用配置端口并支持冲突回退；必须具备单实例、数据目录锁、服务所有权识别、版本/capability 握手、sidecar 崩溃恢复和端口发现。
  - 配置端口仅作为起始首选值；如果启动时已占用，必须向上递增选择第一个可用端口，并通过 runtime state/握手向 Desktop 暴露实际 endpoint。（Delivered 2026-07-07）
  - 关闭主窗口后渠道服务继续运行，Dock 和菜单栏状态项保留；明确退出只停止由 App 启动的 sidecar，不能擅自停止既有外部 Molibot 服务。
  - Desktop Chat 必须覆盖现有 Web Chat 的 session、流式消息、thinking、模型选择、附件、语音、队列、停止/steer/follow-up 和 Host Bash 审批闭环；右侧文件面板只索引当前本地 session。
  - Desktop Chat 与 Project Chat 的输入区、消息区、审批卡和右侧 header 必须通过共享展示组件复用；组件内部不得用大批 project/chat 分支判断，业务差异由调用方通过 props、slot 和回调提供。（Delivered 2026-07-09）
  - Desktop Chat 的 Assistant 回复采用连续内容流：thinking、工具活动与最终正文共享同一内容列，不使用相互割裂的卡片；用户消息保持右对齐并使用 Geist 中性背景，不使用强调蓝填充。（Delivered 2026-07-06）
  - Desktop transcript 必须从 Agent context 恢复已持久化的 thinking，并按用户轮次聚合工具调用之间的多段 reasoning；刷新或重新打开历史会话不得丢失思考过程，也不得要求复制保存第二份 thinking。（Delivered 2026-07-06）
  - Telegram、Feishu、QQ、Weixin 会话必须按渠道和 Bot 实例只读聚合并实时更新；新消息需在共享 session 层保存发送者、会话、线程/Topic、Bot 实例和附件元数据，Channel 只负责平台字段转换。
  - Desktop Settings 首版保留全部现有设置能力，并遵守细粒度保存、中英即时切换、Light/Dark/System、响应式布局、固定保存底栏和现有设计组件约束。
  - 首次启动引导必须区分全新安装、已有可用配置和损坏配置；依赖安装由用户逐项明确授权，Node 随 App 内置，其余工具优先使用 `~/.molibot/tooling` 隔离环境或已安装的 Homebrew。
  - 全新安装必须在服务就绪前具备完整 production runtime；空数据目录首次进入 runtime 后自动创建 settings、SQLite schema、必要目录和内置全局 Profile 模板，重复启动不得覆盖用户文件。（Delivered 2026-07-07）
  - App 与 DMG 必须使用项目 Molibot Logo 的原生 ICNS/PNG 资源；macOS 图标采用浅色圆角底板和透明外角，不得回退到默认 Tauri 图标。（Delivered 2026-07-07）
  - 跨渠道聚合、服务控制、依赖安装和统一审批等桌面专用能力必须使用每次启动生成的临时 capability token，不能暴露给普通本机 Web 页面。
  - 删除 App 不删除 `~/.molibot`；数据格式迁移前必须备份受影响的结构化数据并原子执行，失败时停止服务并提供恢复。
- Delivery phases:
  1. Tauri 壳、Node sidecar、单实例、菜单栏和窗口/服务生命周期。当前已交付独立 desktop workspace、双窗口、单实例、菜单栏、关闭保活、登录启动、共享服务租约、真实握手/发现、固定校验的 Apple Silicon Node 22 runtime、外部/托管所有权、有限退避重启和托管进程优雅退出；完整 App 生命周期 smoke、压缩 DMG 与 checksum 仍待完成。
  2. 独立 Desktop Chat 与本地 Web Profile/session 完整闭环。当前已交付 Profile/session 管理、持久 transcript、安全 Markdown、模型/thinking、SSE、stop、文件面板、附件上传与展示、运行时间线、Host Bash 审批、会话/全文筛选和本地 follow-up 队列；真实模型流 smoke、语音和 native 文件动作仍待完成。
  3. 外部渠道只读聚合、统一元数据、实时事件、审批和通知。当前已交付安全聚合列表与只读 transcript；实时事件、统一审批和通知仍待完成。
  4. 完整 Desktop Settings、首次引导和授权依赖安装器。当前已交付主要设置只读/细粒度控制面、三分支首次启动、健康摘要、Provider 提交与连接验证、可保存的 Agent/Web Profile 确认与官方 LaunchAgent 登录启动选择；渠道/诊断引导步骤与依赖安装执行仍待完成。
  5. 原生材质、辅助功能、图标、诊断、迁移保护和 GitHub Release DMG。
- Acceptance:
  - 安装后无需系统 Node 即可启动，关闭窗口不导致渠道离线，现有 Web 与 server 启动方式无回归。
  - Web 与 Desktop 可以继续同一个本地 session，但两套 UI 在代码和样式上保持独立。
  - 四个外部渠道的新消息、Agent 回复、Bot 实例状态和待审批事件能在桌面端实时、只读、无重复地展示。
  - 自动化测试全部使用临时 `DATA_DIR`、临时数据库或可注入 store；真实渠道 smoke test 只能由用户明确触发。
