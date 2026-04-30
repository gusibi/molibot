# Molibot ChangeLog

## Version 1.0

---

## 2026-05-01

### Weixin SDK 协议同步
- **生命周期通知**: `package/weixin-agent-sdk` 新增 `notifyStart` / `notifyStop`，高层 SDK 启停流程会尽力通知 Weixin 后端。
- **BotAgent 元数据**: 所有 SDK API 请求的 `base_info` 现在带有经过格式清洗的 `bot_agent`，便于后端日志归因；非法值会安全降级为 `OpenClaw`。
- **扫码登录升级**: QR 登录改为 POST 本地 token hint，支持手机配对码、验证码锁定、已绑定提示和 IDC redirect 状态。
- **回归覆盖**: 新增 API 测试覆盖 `bot_agent` 清洗、生命周期通知请求体，以及已有发送失败/长轮询 abort 行为。

### QQ SDK 上游能力同步
- **SDK 对齐 v1.7.1**: `package/qqbot` 升级到上游 QQ Bot SDK v1.7.1 源码形态，补齐群策略、引用消息上下文、Slash 命令、审批交互、输入状态、流式消息、STT 附件处理等模块。
- **媒体发送增强**: QQ 出站媒体现在包含分片上传、上传缓存、受保护的远程下载、图片/语音/视频/文件统一发送队列，以及更稳定的用户可见错误映射。
- **Molibot 边界适配**: 保留 molibot 的共享队列、会话推进和任务编排职责在上层，QQ SDK 只承担平台协议、消息转换和媒体传输；同时移除了对不存在的 `openclaw/plugin-sdk/core` 运行时入口依赖，并把 `/bot-upgrade` 默认保持为文档指引模式。
- **直连模式修复**: Molibot 通过 `onEvent` 接管 QQ 入站时，SDK 不再触发 OpenClaw runtime 预检、审批 gateway、SDK slash 拦截或消息处理时的 `getQQBotRuntime()`，避免 `QQBot runtime not initialized` 引发重连风暴和 QQ `/gateway` 限频。
- **回归覆盖**: 更新 `package/qqbot` 媒体出站测试，覆盖缺失凭证短路和稳定错误文案映射；`package/qqbot` 编译与主工程生产构建均已通过。

---

## 2026-04-30

### 图片识别传输格式修复
- **自定义视觉直传加验证门槛**: 自定义 provider 只有在模型 `vision` 能力验证通过后，图片消息才会走原生多模态 streaming transport；未验证但已声明 `vision` 的模型和备用候选不再宣告原生图片输入，改走 direct image-understanding fallback。
- **队列图片恢复修复**: Telegram/QQ/Weixin/Feishu 入队消息仍会清空大体积 base64，但出队处理时现在会用 workspace-relative 附件路径恢复 `imageContents`，避免图片只以文件路径形式进入模型而绕过 fallback。
- **MiMo Anthropic 角色格式修复**: 显式配置为 Anthropic 的 custom provider，其 runner 与图片 fallback 请求会把 `system`/`developer` 内容移到顶层 `system` 字段，不再发送 `messages[].role=system`；fallback 默认打印脱敏后的 `image_analysis_request`，请求头同时兼容 MiMo 的 `api-key`。
- **图片 payload 更可控**: fallback 路径继续使用显式 OpenAI-compatible `image_url` 或 Anthropic-compatible `image/source` 请求体，避免图片消息在未确认兼容的 SDK transport 中失效。
- **安装级图片测试资源**: `molibot init` 现在会把随包携带的 68-byte `vision-smoke.png` 复制到 `<DATA_DIR>/fixtures/vision-smoke.png`，provider vision 测试从用户工作区读取真实图片字节再发请求。
- **回归覆盖**: 新增 custom protocol helper、queued attachment rehydration 与 image fallback 请求体测试，覆盖 Anthropic baseUrl 推导、图片请求头构造、相对附件路径读回 base64，以及 OpenAI-compatible `image_url` / Anthropic `image/source` 两种真实图片 payload。

---

## 2026-04-29

### 自定义 Provider Anthropic 协议
- **协议选择持久化**: 自定义 AI provider 新增 `openai-compatible` / `anthropic` 协议配置，旧配置自动按 OpenAI-compatible 迁移，SQLite 设置表同步保存协议字段。
- **Anthropic Messages API 支持**: `/settings/ai/providers` 可选择 Anthropic Messages，默认路径切到 `/v1/messages`；连接测试使用 `x-api-key` 与 `anthropic-version` 请求头，并支持文本/视觉能力验证。
- **运行时协议分流**: Web custom-provider 直连、主 runner、自定义 subagent 模型构建、图片理解 fallback 都会按协议选择 OpenAI Chat Completions 或 Anthropic Messages payload/transport。
- **思考参数体验修正**: 协议切换现在会立即更新默认 endpoint 和 thinking format；Reasoning Effort Mapping 默认使用按格式内置的自动映射，只在选择 Custom override 时显示下拉覆盖值。
- **测试错误详情增强**: Provider 测试接口会格式化 JSON 错误并返回更长的上游响应片段，Providers 页面也不再把长状态压成单行省略号。
- **模型行内测试反馈**: 单个模型的 Test Connection 结果现在显示在对应模型卡片内，不再占用保存按钮旁边的页面级状态区。
- **Anthropic 运行时 endpoint 修复**: Runner/subagent 传给 Anthropic transport 的 base URL 现在与 `/v1/messages` endpoint 语义匹配，避免测试成功但实际对话请求到重复 `/v1` 路径而 404；模型错误日志同步展示推导后的 endpoint。
- **图片路由优先级修复**: 当 `visionModelKey` 单独配置了图片模型时，图片消息会优先使用该 vision 路由，而不是被同样声明 `vision` 的 text 路由抢走；如果 vision 请求失败但 fallback 恢复成功，会先发送一条独立失败提醒再继续输出结果。

---

## 2026-04-26

### 文档治理整理
- **AGENTS 规则提炼**: 从 `prd.md` / `features.md` 中抽出了长期有效的协作与架构规则，补充到 `AGENTS.md`，包括文档职责分层、事件调度落地边界、以及 prompt/profile 规则必须真实生效而不只是出现在 source 列表。
- **README 文档分工说明**: 更新 `README.md` 的文档说明区，明确 `README` / `AGENTS` / `prd` / `features` / `CHANGELOG` 各自职责，并补充统一的文档维护流程。
- **变更记录对齐**: 将这次文档治理调整同步记录到 `features.md`、`prd.md` 和 `CHANGELOG.md`，让规则、计划、已交付事实三者保持分层一致。

### 对话时间感知
- **每轮消息注入当前时间**: Runner 现在会在发送给模型的实时用户消息前注入结构化 `<env>` 块，包含 `message_received_at`、`timezone` 和 `today`，让模型能直接感知当前时间并更稳定地处理“今天/明天/下周”这类时间表达。
- **不污染持久化上下文**: 这段时间元数据只用于实时模型输入，保存到 session context 的仍是原始用户文本加附件标记，避免把临时环境信息塞进长期会话历史。
- **设置页时区入口**: `/settings/ai/routing` 新增 runtime timezone 下拉选择，优先展示常用时区并保留完整 IANA 列表；后端保存前仍会校验时区名，确保调度、用量统计和消息时间上下文使用同一时区基准。
- **系统提示词去时间化**: 运行时 system prompt 里原先的 `Server timezone` / `run: date` 提示已移除。当前时间感知只保留在每轮实时 `<env>` 注入里，避免把时间相关内容继续留在期望缓存的系统提示词层。

### Workbench UI 统一
- **共享 Workbench 样式层**: 新增 `src/styles/workbench.css`，把 hero、panel、toolbar、config shell、table、status line 等视觉规则收敛到共享层，不再让 Settings 页面各自携带一套私有样式。
- **AI 设置页去本地样式化**: `/settings/ai/usage`、`/settings/ai/errors`、`/settings/ai/routing`、`/settings/ai/providers` 已移除页面内 `<style>`，改由共享 workbench 体系统一接管。
- **Settings 全区同一产品语言**: Agents、Web Profiles、Telegram、Feishu、Weixin、QQ、MCP、Tasks、Skills、Skill Drafts、Run History、Memory Rejections、Plugins、ACP、Memory 等页面统一到同一套材质、间距和表单反馈规则。
- **主聊天页材质统一**: Web chat 保留对话优先的安静节奏，但侧边栏、顶部栏、Composer、Files pane、Prompt Preview / New Chat 弹层已切到同一套 workbench 材质体系，和 Settings 看起来像同一个产品。

### 缓存命中率可视化
- **缓存命中比例 KPI**: `/settings/ai/usage` 顶部新增缓存命中比例卡片，直接显示当前筛选范围内的 prompt cache 命中比例。
- **缓存命中趋势折线图**: 同页新增缓存命中比例趋势图，按当前时间窗口（小时或天）展示命中率变化，方便判断缓存是否持续有效。
- **口径明确**: 命中率统一按 `cache read / (input + cache read)` 计算，只看 prompt 侧 token，不把 output 或 cache write 混进去。

### Usage 时间窗自动刷新
- **点击时间范围即重拉数据**: `/settings/ai/usage` 的 `今天 / 昨天 / 最近 7 天 / 最近 30 天` 现在会在切换标签时立即调用后端重新拉取 usage 数据，不再只改本地 tab 状态。
- **无需二次点击刷新**: 切换时间范围后，顶部日期窗、`更新于` 时间和所有 KPI / 趋势图都会跟着同一轮新数据更新，不需要再手动点一次“刷新”。

### Web Chat 文件工作区
- **通用文件上传**: Web chat 输入区不再限制为仅图片上传；现在可以直接附加 PDF、Markdown、代码、JSON、音频、视频和其他常见文档文件。
- **右侧文件面板产品化**: 右侧 Files pane 从占位块升级成真实的当前会话附件工作区，支持搜索、类型筛选、待发送 / 已发送分组，以及会话切换联动刷新。
- **常见格式预览**: 图片、音频、视频、PDF、Markdown、文本/代码、JSON/CSV/YAML 现在可以内嵌预览；Office 和未知二进制格式会降级为元信息 + 下载。
- **安全浏览动作**: 面板提供下载和复制相对存储路径，不引入删除、重命名、移动这类高风险文件管理动作。

---

## 2026-03-29

### 核心功能优化
- **Python Sandbox 执行强化**: `bash` 工具现在强制所有 Python 命令使用统一的 sandbox 虚拟环境 (`~/.molibot/tooling/python/venv`)，自动修复缺失的 pip，禁用 `--break-system-packages` 标志，确保技能脚本依赖安装不污染全局 Python
- **Telegram 网络超时重试修复**: 添加每尝试 12 秒超时机制，防止 `editMessageText`/`sendMessage`/`sendChatAction` 在网络卡顿时无限挂起，超时会自动重试而非永久等待
- **Bot Profile 文件管理工具**: 新增 `profile_files` 工具，支持运行时读取/初始化/覆盖/编辑 bot 级别的 `BOT.md`/`SOUL.md`/`USER.md`/`TOOLS.md`/`IDENTITY.md`/`SONG.md`，继承链为 `bot -> agent -> global`

---

## 2026-03-28

### 系统提示词架构优化
- **Skill-First 路由优化**: 合并 Task Framing + Capability Use Order + Skill Routing 为统一的 Message Processing Pipeline，Skill 匹配提升为 Step 0，工具部分增强映射表，Skills Protocol 从 60 行精简到 15 行
- **模板简化**: TOOLS.template.md 从 91 行精简到 31 行，IDENTITY.template.md 从 34 行精简到 23 行

---

## 2026-03-26

### Weixin 迁移修复
- **Slash 命令回复修复**: 修复 Weixin 迁移后 `userId` 字段不匹配导致的 `/help`, `/new`, `/status` 等命令崩溃问题
- **SDK 迁移完成**: 完全移除 `@pinixai/weixin-bot` 依赖，使用项目本地 Weixin SDK bridge，基于 `weixin-agent-sdk` 风格的 login/polling 流程

---

## 2026-03-25

### 语音和架构优化
- **Weixin OGG 语音自动转码**: Weixin 出站语音现在检测 Telegram 风格的 `ogg/opus` 文件，自动转换为 `mp3` 后上传，支持原生 Weixin 语音投递
- **共享文本渠道运行时框架**: 添加共享运行时骨架/helpers，Feishu/QQ/Weixin 迁移到共享 queue/dedupe/stop/prompt-preview/context 路径，Telegram 使用共享安全骨架
- **Weixin 出站投递审计和重试**: 结构化 Weixin 出站发送尝试/成功/失败日志，自动重试瞬时 `sendmessage` 失败，按聊天 `delivery.jsonl` 记录

---

## 2026-03-22

### WeChat 渠道集成
- **WeChat 渠道集成**: 通过 npm 包 `@pinixai/weixin-bot` 添加内置 WeChat 渠道插件和设置页面
- **Vite 别名修复**: 添加 Vite 别名将 `@pinixai/weixin-bot/src/index` 解析到 npm 安装的包源文件，解决包导出检查失败问题
- **QR 生成器**: 在 `/settings/weixin` 添加 QR 工具，操作员可以粘贴 SDK 登录链接即时渲染可扫描 QR 码

---

## 2026-03-21

### ACP (Agent Control Plane) 增强
- **Provider/Profile 分层**: 新增 `src/lib/server/acp/providers/`，拆分 `codex.ts` 与 `claude-code.ts`
- **Preset 管理**: Preset / auth hint / adapter 识别集中管理
- **Schema 扩展**: 扩展 ACP target schema，新增 `adapter` 字段
- **默认配置**: 默认设置改为内置 Codex + Claude Code 两个 preset
- **配置兼容**: 旧配置自动推断 adapter，保持向后兼容
- **Telegram ACP 统一**: 统一 Telegram ACP 帮助文案与状态展示
- **远端 Adapter 命令**: 远端 adapter 命令改为带 provider 前缀显示（如 `codex:/...`、`claude-code:/...`）
- **设置页更新**: 更新 `/settings/acp`，新增 adapter 字段与 Codex / Claude Code / Custom 三种 target 添加入口
- **文档更新**: 更新 `features.md` 与 `prd.md` 记录本次交付

---

## 2026-03-20

### 内存和设置改进
- **Periodic 事件状态持久化**: 修复 watcher，periodic 事件每次执行时持久化 `lastTriggeredAt`, `runCount` 和错误状态
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **设置 Patch 合并**: 运行时设置更新路径现在重新加载最新 `settings.json` 后才应用 patch，防止陈旧的内存进程快照回滚配置
- **混合设置存储**: 动态设置迁移到 `settings.sqlite` 行存储，稳定引导字段保留在 `settings.json`
- **Channel Patch 合并**: 修复运行时 channel sanitizer 合并 patch 而非替换整个 map，保存 `channels.web` 不再清除 Telegram/Feishu
- **关系型设置表**: 替换单行动态 JSON 存储为规范化 SQLite 表 (`settings_agents`, `settings_channel_instances`, `settings_custom_providers`, `settings_custom_provider_models`)
- **设置单实体保存流**: 添加单记录设置 API，迁移 Agents/Web/Telegram/Feishu 页面仅保存选定行，选择变更时提示未保存编辑

---

## 2026-03-15

### ACP 增强和命令
- **ACP 会话命令**: 添加 `/acp sessions` 命令和 ACP service 支持 `session/list`，支持 project-aware 过滤和格式化
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落，打印 `pwd`, `ls -la`, python/uv 解析, DB env 值, 命令 + 退出码
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名
- **ACP 可用命令对象渲染修复**: 修复 ACP 命令解析，支持对象形式命令条目，消除 `[object Object]` 输出
- **ACP 会话持久化和恢复**: 添加持久化 ACP 聊天会话元数据，支持服务重启后自动恢复远程会话
- **ACP 最终结果 Markdown 结构化**: 更新 Telegram ACP 任务分发，自动附加 Markdown 格式要求，本地完成摘要转为 Markdown 子弹列表
- **ACP 工具事件噪音减少**: 停止为每个完成的 ACP 工具调用发送 Telegram 消息，汇总到最终任务摘要
- **ACP 状态洪泛保护**: 强化 Telegram 429 重试逻辑，ACP 状态更新节流和降级
- **ACP 认证预检提示**: 改进 ACP 启动错误报告，Codex-like target 超时且无 API key 时附加认证提示

---

## 2026-03-14

### 集成和兼容性
- **pi-ai 0.62 OAuth 导入兼容性修复**: 将 OAuth helper 导入从 `@mariozechner/pi-ai` 移到 `@mariozechner/pi-ai/oauth`，恢复生产构建兼容性
- **Codex auth.json 重用 + ACP 启动超时调整**: 验证 Codex ACP 可在非交互进程重用本地 `~/.codex/auth.json`，增加 ACP 启动超时 (`initialize` 30s, `session/new` 60s)
- **共享 Button 点击事件转发**: 修复 `src/lib/ui/Button.svelte` 转发原生点击事件，恢复 ACP `Add Project` 等设置页面操作
- **ACP stdio 帧兼容性修复**: 修复 ACP stdio 传输帧发送换行分隔 JSON 而非 `Content-Length` 帧，解决 Codex ACP 初始化解析失败
- **Linus Torvalds 风格人设模板**: 添加 `IDENTITY.linus.template.md` 和 `SOUL.linus.template.md`，提供直率技术至上代理人格选项

---

## 2026-03-10

### 稳定性和路由优化
- **Periodic 事件更新 + 重复取代**: 更新 `create_event`，periodic 任务按 `chatId + schedule + timezone` 更新而非创建新文件，旧重复项标记 `completed` (`superseded_by_update`)
- **跨 Provider 模型回退**: Runner 和 assistant service 保留失败 context，自动重试替代 provider，聚合失败详情
- **声明优先的视觉路由**: 更新 runner，自定义文本/视觉模型声明 `vision` 后即使验证 `untested`/`failed` 也信任原生图像输入
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态保持 `untested`
- **验证感知的音频回退路由**: Runner 根据 `audio_input` 和 `stt` 元数据计算显式音频决策，记录回退原因
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据

---

## 2026-03-08

### UI/UX 主题和设置
- **主题和 i18n 基础**: 添加可替换主题令牌文件，切换聊天 + 设置 shell 到主题令牌渲染，添加 `system/light/dark` 切换和 `zh-CN`/`en-US` 语言切换
- **设置概览暗模式对比修复**: 更新 `/settings` 概览介绍和卡片描述，从硬编码 `text-slate-400` 到主题令牌 `text-[var(--muted-foreground)]`
- **Feishu 入站媒体解析和 Runner 就绪接收**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **Mory 支持的内存网关核心切换**: 添加可选 `mory` provider 在内存网关中，保持 `json-file` 为默认
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，Telegram + Feishu `/models` 命令使用共享流
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 现在显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分

---

## 2026-03-03

### 内存系统核心实现
- **内存 V2 分层 + 增量检索管道**: 添加分层内存 (`long_term`/`daily`)，后端能力协商，增量 `flush` 光标，混合搜索 (keyword+recency)
- **内存治理和操作控制台**: 添加事实键冲突检测 (`hasConflict`)，TTL 支持 (`expiresAt`)，API `list` 动作，`/settings/memory` 管理 UI
- **Telegram 内存统一到内存根**: Telegram mom 内存不再存在于聊天工作区目录，全局/聊天内存文件从统一 `memory/` 根迁移/读取
- **统一内存网关用于 Telegram Agent 操作**: 添加 Telegram `memory` 工具，阻止通过 `read/write/edit/bash` 工具直接内存文件访问
- **外部化 Telegram Runner 指令文件**: `runner.ts` 现在从代码构建运行时系统提示，然后从 data-root `~/.molibot` 合并指令/配置文件
- **Bot 提示自动维护协议**: 在捆绑的 AGENTS 模板中添加显式自动更新治理，用于 `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md`
- **AGENTS.md 工作区目标护栏**: 添加显式 bot 提示规则：编辑 AGENTS 指令时，始终目标 `${workspaceDir}/AGENTS.md`，永远不要项目根 `AGENTS.md`
- **`molibot init` 工作区引导命令**: 添加启动器子命令 `molibot init` 来初始化 `${DATA_DIR:-~/.molibot}` 并从捆绑的提示模板引导配置文件
- **全局配置文件路径强制执行**: 强化工具路径解析/保护，因此配置文件 (`SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md`) 被规范化为 data-root 全局路径

---

## 2026-02-28

### 系统提示词和架构
- **全局提示源强制执行和源预览**: 提示文件加载器现在从 `${DATA_DIR}` (`~/.molibot`) 解析指令/配置文件，大小写不敏感文件名匹配
- **全局配置文件模板升级**: 使用受 OpenClaw 启发的模板样式 frontmatter 和更清晰的章节重构 `~/.molibot/AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md`
- **Init 配置文件模板包**: 从升级的全局配置文件添加 `src/lib/server/agent/prompts/*.template.md`，切换 `molibot init` 为复制这些模板
- **移除遗留 AGENTS.default 回退文件**: 删除 `src/lib/server/agent/prompts/AGENTS.default.md`，运行时回退/导入指向 `AGENTS.template.md`
- **提示构建器提取和运行时/配置文件拆分清理**: 将 Telegram mom 提示构建从 `runner.ts` 移到 `src/lib/server/agent/prompt.ts`，代码拥有的合约章节保留在代码中
- **提示预览动态章节排序清理**: 重新排序 `prompt.ts`，稳定的运行时合约章节保持在高变动运行时有效负载之前
- **配置文件注入清理**: 在将配置文件注入运行时提示前剥离 YAML frontmatter，重写 AGENTS 注入措辞
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，在 `src/lib/server/agent/prompt-channel.ts` 引入适配器可选渠道提示章节

---

## 2026-02-27

### 核心架构和内存系统
- **mory README 能力清单**: 更新 `package/mory/README.md` 为功能状态清单，按 `完成` / `TODO` 标注 mory 当前能力与未实现项
- **mory TODO 功能全量落地**: 添加 `moryEngine` 编排 (`ingest/retrieve/commit/readByPath/readMemory`)，`read_memory` 工具 API，异步 commit 管道，严格提取验证器，存储适配器 (`InMemory`/`SQLite`/`pgvector`)，版本化 schema 字段，检索执行器，遗忘/归档策略引擎，可观测性指标，全循环 E2E 测试
- **mory 认知控制模块**: 扩展 `package/mory`，添加纯逻辑模块用于写入评分门 (`moryScoring`)，冲突解决/版本控制 (`moryConflict`)，检索意图路由 (`moryPlanner`)，情景整合 (`moryConsolidation`)，任务范围工作区内存助手 (`moryWorkspace`)
- **定期事件生命周期修复**: `periodic` 任务首次执行后不再标记 `completed` 并从调度表移除，watcher 保持它们跨运行调度并记录 `lastTriggeredAt` 同时保留 `runCount`
- **Molibot 服务脚本状态说明**: 确认 `bin/molibot-service.sh` 仅反映其管理的后台实例状态，不能代表系统内不存在其他手动或开发模式运行中的 Molibot 进程
- **mory README 功能点状态清单**: 将 mory 全量功能点写入 `package/mory/README.md`，按 `完成` / `TODO` 明确当前实现边界
- **硬调度护栏**: 为 Telegram mom 运行时添加硬调度护栏，提示明确要求所有延迟/重复任务使用 watched event JSON 文件，`bash` 阻止外部调度器，`memory add` 拒绝提醒/计划类内容
- **mory 独立 SDK 完成**: 完成 `package/mory` 作为独立 Node 包，标准结构 (`src/`, `test/`, `README.md`, `package.json`, `tsconfig.build.json`)，可运行构建/测试/smoke 脚本
- **mory SQL 持久化模板**: 添加 `@molibot/mory` SQL 持久化模板，SQLite schema/upsert SQL 加 PostgreSQL pgvector schema/upsert/vector-search SQL
- **mory 写入门批量行为**: 改进 `mory` 写入门批量行为，批量缓存反映插入和更新决策，待处理 ID 现在是碰撞安全的
- **技能提供策略澄清**: README 澄清 `molibot init` 保持手动安装行为，添加从项目 `skills/` 到 `${DATA_DIR}/skills` 的显式手动安装命令
- **README 渠道状态措辞**: 修正 README 渠道状态措辞，Telegram 标记为实际使用中验证，Web Chat/CLI 标记为实现但尚未在此项目使用上下文中亲自验证
- **mory 写入时分类**: 添加共享内存分类，新内存写入时自动标记，flush/import 路径重用相同分类器，提示注入优先 collaboration/project/reference 内存
- **通用代理提示强化**: 填补非编码提示空白，添加任务框架、新鲜度验证、外部内容注入抵抗、更广泛的动作确认规则
- **Weixin 入站语音/文件媒体回退强化**: Weixin 入站媒体接收不再在 `media.aes_key` 缺失或 SDK payload 仅提供 hex `aeskey` 时丢弃语音/文件/视频项目，回退到纯 CDN 下载或 hex-key 规范化

---

## 2026-02-25

### 渠道和内存系统
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，引入适配器可选渠道提示章节
- **Mory 支持的内存网关核心切换**: 添加 `src/lib/server/memory/moryCore.ts`，注册可选 `mory` provider 在内存网关中
- **Feishu 入站媒体解析**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，窄 API `/api/settings/model-switch`
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **Agent 拥有的音频转录边界**: 将 STT 目标解析/转录流移到 `src/lib/server/agent/stt.ts`，附件元数据扩展 `mediaType`/`mimeType`
- **Provider 能力验证状态**: 添加每模型 `verification` 状态 (`untested`/`passed`/`failed`)，扩展 provider 测试 API
- **验证感知的视觉路由**: 更新 runner，图像输入仅在选定的自定义文本模型或专用视觉路由模型声明并验证通过 `vision` 时才通过原生多模态提示
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态故意保持 `untested`
- **验证感知的音频回退路由**: 更新 runner 从 `audio_input` 和 `stt` 能力元数据计算显式音频决策
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据
- **声明优先的视觉路由**: 显式声明 `vision` 的自定义文本/视觉模型现在即使验证 `untested` 或 `failed` 也被信任用于原生图像输入
- **AI 使用 Bot 维度分析和过滤**: 扩展使用记录添加 `botId`，在使用跟踪器窗口/细分中添加 bot 级聚合，升级 `/settings/ai/usage` 支持 bot 过滤 + bot 排名表
- **Runner 流日志安全修复**: 从 `runner.ts` 移除不安全的低级流包装器，将 first-token 日志移到真实 assistant delta 事件，停止自动启用 pretty stdout 日志除非显式设置 `MOM_LOG_PRETTY=1`

---

## 2026-02-23

### Web UI 重构
- **Web 应用 ChatGPT 风格 Tailwind 布局重构**: 重建聊天 + 设置页面 (`/`, `/settings`, `/settings/ai`, `/settings/telegram`) 为统一 ChatGPT 风格 shell，纯 Tailwind 样式
- **服务器生命周期脚本 + 运维文档**: 添加 `bin/start-molibot.sh`, `bin/stop-molibot.sh`, `bin/status-molibot.sh`, `bin/restart-molibot.sh`
- **统一服务控制脚本**: 添加 `bin/molibot-service.sh` (`start/stop/status/restart`) 作为单一运维入口
- **全局 `molibot` 启动器 + 家工作区迁移**: 添加 npm-linkable `molibot` 命令，将默认运行时数据根移到 `~/.molibot`，Telegram 工作区切换到 `~/.molibot/moli-t`

---

## 2026-02-20

### 核心功能实现
- **记忆网关 API 完成**: 实现稳定的记忆网关 API，支持可替换后端（JSON 文件默认），`add/search/flush/delete/update` API 端点
- **记忆 V2 分层 + 增量检索管道**: 添加分层记忆（`long_term`/`daily`），后端能力协商，增量 `flush` 光标，混合搜索（keyword+recency）
- **记忆治理和操作控制台**: 添加事实键冲突检测（`hasConflict`），TTL 支持（`expiresAt`），`/settings/memory` 管理 UI
- **Telegram 多 Bot 运行时 + 设置 UI**: 添加 `telegramBots[]` 设置 schema 和 `/settings/telegram` 多 bot 编辑器
- **事件交付模式拆分**: 添加可选事件字段 `delivery`，one-shot/immediate 默认 agent 执行，`delivery:"text"` 保持字面推送

---

## 2026-02-15

### ACP 和渠道增强
- **Telegram ACP 命令路径 MVP**: 添加 ACP 设置 + Codex target preset，Telegram `/acp` / `/approve` / `/deny` 命令，项目注册，聊天范围的 ACP 会话生命周期
- **ACP Web 设置工作区**: 添加 `/settings/acp`，结构化 ACP target/project 管理，批准模式默认值，绝对路径项目允许列表编辑
- **ACP 会话命令**: 添加 `/acp sessions` 命令，支持 ACP `session/list`，包括 target/project 上下文和当前会话标记
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名

---

## 2026-02-11

### 项目启动和基础架构
- **V1 PRD 基线**: Must/Later 范围和验收标准定义
- **V1 架构基线**: 架构对齐到仅 Telegram + CLI + Web
- **双周冲刺计划**: 按周交付物和检查点定义
- **Telegram 技术决策**: V1 Telegram 适配器库固定为 `grammY`
- **持久化技术决策**: V1 会话/消息持久化改为 SQLite
- **文档清理**: 移除冗余文档，在 `readme.md` 中添加文件用途导航
- **代码骨架实现**: 实现 V1 代码骨架：Telegram (`grammY`), CLI, Web, 统一路由器, SQLite 持久化
- **运行时集成**: `assistantService.ts` 直接调用 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`
- **驱动兼容性修复**: 用内置 `node:sqlite` 替换 `better-sqlite3`，支持 Node 25 兼容性

---

## 总结

### 主要成就 (2026-02-11 至 2026-03-29)

#### 1. 架构重构 (3次重大重构)
- **模块重组**: 后端重组为 7 个显式模块（app, agent, channels, memory, sessions, settings, providers）
- **分层重构**: 共享命令层抽取，渠道 Runtime 清理，代码和文档同步
- **ACP 增强**: 完整的 Agent Control Plane，支持 Codex 和 Claude Code 双 preset

#### 2. 渠道支持 (4个主要渠道)
- **Telegram**: 完整入站和出站媒体支持，多 bot 运行时，ACP 集成
- **Feishu**: 完整入站媒体解析和出站文件/图像/音频交付
- **Weixin**: SDK 迁移完成，OGG 语音自动转码，媒体投递审计
- **QQ**: 基础运行时支持

#### 3. 内存系统 (30+ 相关功能项)
- **核心架构**: 分层内存 (`long_term`/`daily`)，混合检索 (keyword+recency)
- **网关 API**: 稳定的记忆网关，支持可替换后端（JSON 文件默认，Mory 可选）
- **治理控制台**: 事实键冲突检测，TTL 支持，`/settings/memory` 管理 UI
- **mory SDK**: 独立 Node 包，支持 SQLite/pgvector，完整认知控制模块

#### 4. 设置和配置 (25+ 功能项)
- **AI 设置**: 多 provider 架构，每模型能力标签和验证，可视化 provider 测试
- **模型路由**: 文本/视觉/STT/TTS 模型选择，跨 provider 自动回退
- **关系型设置**: 规范化 SQLite 表，单实体保存流，未保存变更提示
- **主题和 i18n**: Solar Dusk 调色板，`system/light/dark` 模式，`zh-CN`/`en-US` 切换

#### 5. 开发者体验和工具 (20+ 功能项)
- **Python Sandbox**: 统一虚拟环境，自动依赖管理，禁止系统包污染
- **Bash 工具强化**: 路径沙箱，命令白名单，输出压缩，超时处理
- **MCP 集成**: stdio 和 HTTP 传输支持，技能门控注入，动态加载工具
- **性能优化**: 提示刷新策略（仅变更时重建），流日志安全修复，定期事件锁机制

### 统计数据
- **总功能项**: 250+ 个已交付功能项
- **架构重构**: 3 次重大重构（模块重组、分层重构、ACP 增强）
- **渠道支持**: 4 个主要渠道（Telegram、Feishu、Weixin、QQ）完整媒体支持
- **内存系统**: 30+ 相关功能项，完整的记忆层实现
- **设置和配置**: 25+ 功能项，完整的设置架构
- **开发者工具**: 20+ 功能项，完整的开发体验

### 时间跨度
- **开始日期**: 2026-02-11
- **当前版本日期**: 2026-03-29
- **总开发周期**: 7 周
- **主要发布**: V1.0 (当前)
