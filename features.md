# Molibot Features

## Archive Index / 归档索引
- [2026 Q2 Features Archive (Apr - Jun)](docs/archive/features-archive-2026-Q2.md)
- [2026 Q1 Features Archive (Feb - Mar)](docs/archive/features-archive-2026-Q1.md)

---
## 2026-07-14

### Agent 头像移到消息左侧，聊天区改为居中定宽阅读列（已完成）
- Agent 头像从"名字上方堆叠"改为"消息左侧"：新增 `.assistant-layout` 弹性布局，左侧 28px `.assistant-avatar`，右侧为消息栈；身份行只保留名称 + 角色。持久记录和实时流式行同步改造，保持一致。
- 所有消息行改为共享一个居中的阅读列，最大宽度 `--message-content-width`（720px，与输入框同宽），用 `margin-inline: auto` 居中，不再在宽窗口下铺满整个面板。用户气泡在列内右对齐（最多 88%），Agent 内容占满该列。
- 纯 markup/CSS 改动；消息正文、操作、附件渲染逻辑不变。图片内联说明：附件媒体链路（消息 `attachments` →`/api/web/files` 会话文件列表 → `filesByLocal`）已端到端验证正确（接口返回的图片 `local` 键与附件匹配），此前"图片只显示文件名胶囊"是上面投影错配 bug 的连带表现，并非媒体链路本身的问题。
- 验证（Desktop UI 改动）：`svelte-check` 0 错误 0 警告、`vite build` 通过、Desktop UI 测试 53/53（将 issue-13 断言更新为"居中定宽列 + 左侧头像"布局）。

### 修复：混合历史会话的聊天记录不再错乱回复顺序（已完成）
- 问题：Web/桌面会话投影把每条 UI metadata 按“同角色第一个未用过的 Agent 消息”配对。一旦会话里残留一条迁移前的 display-only assistant（`contextBacked:false` 且自带正文），1:1 对齐被打破，后面每条回复整体错位一格——末尾表现为 用户、用户、AI、AI 且正文串台；配不上的 context-backed 行还会被静默丢弃。
- 修复：改为按 Agent `sourceEntryId` 锚定匹配。`UiMessageMetadata` 新增 `sourceEntryId`，由投影解析后持久化（`SessionStore.recordMessageSourceEntries`，仿照 `markMessagesContextBacked`），此后按稳定 id 配对而非列表位置。尚无存储 id 的旧行走“保持顺序”的回退扫描（用游标禁止后面的行抢占更早的 Agent 行）；配不上的 context-backed 行改为保留空占位而不是消失。
- 存量会话下次打开即自动迁移，无需手动操作；Agent 日志若被重写/压缩，id 会自愈重配。
- 验证（agent/runtime 改动）：`conversationProjection` 5/5（新增混合会话回归 + 存储 id 配对测试）、`sessions/store` 8/8 通过；三处改动的服务端文件 `tsc` 0 错误（仓库既有 154 处无关错误不变）；用真实上报会话回放修复后的投影，恢复出正确的 开始生成图片 → 回复 → 帮我返回文案 → 回复 顺序。

### Desktop 侧栏底部设置项与会话列表贴合分隔线（已完成）
- 底部“设置/服务状态”按钮的悬浮高亮与顶部分隔线改为满宽显示；此前受侧栏 12px 水平内边距影响，高亮两端留白，只有中间一段显示选中态。
- 会话列表滚动区域延伸到侧栏内侧右缘，滚动条紧贴右侧竖向分隔线，不再与分隔线之间留出 12px 空白。
- 侧栏与消息面板之间的拖拽分隔条，悬浮/拖拽时的高亮由过深的蓝色（`--accent`）改为柔和灰色（`--gray-600`），与中性色界面更协调，且明暗主题均适配。
- 均为纯 CSS 调整（满宽用负水平外边距 + 内边距补偿，另加一次颜色 token 替换），内容对齐位置不变。验证：`svelte-check` 0 错误 0 警告、`vite build` 通过、Desktop UI 测试 51/51。

### Desktop Trace 删除记录恢复可用（已完成）
- Trace 页面先展示时间范围、KPI 与活动/结果/覆盖范围/耗时图表，“当前运行”操作记录统一放在看板下方，避免运行明细挤占首屏。
- “删除记录/停止运行”不再依赖桌面 WebView 的浏览器原生确认框；溢出菜单会打开应用内确认对话框，支持取消、点击遮罩和 Escape 退出，确认后仍调用现有 run-scoped API。
- orphan Trace 继续采用审计安全语义：只将 run fact 标记为 `aborted` 并从当前运行列表移除，不物理删除历史 Trace facts。
- 回归覆盖可见确认、单个 `runId` POST，以及临时内存 SQLite 中的 `started → aborted → active list filtered` 链路。

### GitHub Issue #13：Molibot macOS App 界面改造（已完成）
- Desktop 统一为 Molibot macOS 产品层：系统字体优先、52px 工具栏、6/8/12/full 圆角、576px 设置内容与 720px 数据/消息内容宽度，并补齐低动效、低透明度和高对比度适配。
- Settings 统一使用“标题 + 一句说明”的 PageHeader、Molibot 服务状态侧栏底部和居中 SettingGroup；Models 展示用途说明与次级技术 ID，Providers 使用真实 Switch 并把删除移入溢出菜单，Trace 使用“未关联会话”、长时长和非驻留危险操作。
- Automatic Tasks 在宽窗口使用 320px 列表 + 弹性详情，窄于 1100px 时详情改为右侧覆盖；启用状态、调度状态、当前执行和最近结果分别表达。Chat 使用 260px 默认侧栏、720px 消息/输入区、单行紧凑输入和 Assistant 身份行。
- 共享 PageHeader、SettingGroup、SettingRow、Select、Search、Status、OverflowMenu、Empty 与 Skeleton 组件已经由目标页面真实采用；Models/Providers/Chat 共用人类可读名称投影，技术 key 保留在折叠详情。
- 通用设置新增低性能模式；系统减少动态/透明度或低资源硬件也会自动降级。Chat 支持 Command+F、Command+K、Command+, 与统一 Command+Return，菜单支持上下键/Escape 并在关闭后卸载，删除与任务弹层打开后主动接收焦点。
- `DESIGN.md` 新增 Desktop 产品层并明确覆盖通用 Geist 规则；所有变更保留现有 API、运行时和持久化边界。验证：Desktop UI/HTTP 53/53、API/展示 74/74、Svelte 0 错误 0 警告、production build 通过，并完成中英、明暗主题、860×620 与宽窗口的真实页面巡检。

### GitHub Issues #6 / #11 / #12：会话单一权威、停止保留输出与 Trace 控制（已完成）
- UI Session 文件改为 `messageMetadata` 投影：普通用户/助手正文只由 Agent append-only entries 持有，UI 侧仅保存标题、顺序、附件、activity、模型与平台消息等展示元数据；旧 transcript 逐条验证可重建后清空正文，无法匹配的旧命令消息安全保留为 display-only。
- Web、Desktop 与 Project transcript 统一经过共享投影 module，将 Agent 的 user/assistant/tool 链收敛为界面消息并保留 reasoning、附件、activity、模型；编辑重发同时截断 UI metadata 与 Agent entries/context snapshot。
- Desktop Stop 先保持 SSE 连接，让服务端 abort 后完成部分输出持久化，再在有界等待后 reload；已生成内容不再因客户端抢先断流而消失。
- Trace 当前运行列表纳入普通 Web 与 Desktop Project 的 RunnerPool 快照；停止操作可精确终止这些此前被误判为 orphan 的运行，真正的 orphan 仍只清理审计状态。
- 验证：会话/投影/Trace 聚焦测试 22/22，Runner 25/25（临时 SQLite），Desktop UI 44/44，Svelte 0 错误 0 警告，生产构建通过。

### AnySearch 与 Desktop 媒体测试一致性（已完成）
- Web 与 Desktop 搜索设置新增 AnySearch；共享 Agent 搜索层按官方 `/v1/search` 协议支持匿名额度和可选 Bearer API key，并纳入自动路由与来源归一化。
- Desktop 搜索、图片、视频测试不再用凭据安全视图中的空字符串覆盖服务端已保存 key；图片与视频测试均提供独立引擎选择，行为与 Web 一致。
- 回归覆盖 AnySearch 请求/响应协议、匿名与鉴权模式、业务错误码，以及三类 Desktop 测试保留已保存凭据。

### 运行中 Session 工作区导航与 Issue #8 体验优化（已完成）
- 修复 Project Session 运行时点击 Skill、Agent 或任务没有视觉响应的问题：打开工作区面板会明确退出 Project 详情显示，原 Session 的独立 runtime 继续在后台运行，输出、队列、停止和审批仍归属原 Session。
- 补齐 Issue #8 中尚未交付的桌面体验：启动阶段动画与当前动作、回复模型标识、消息操作与时间同排、代码高亮/复制、长消息折叠、Project `Shift+Enter` 发送、`@` 展示 Agent、纵向待发队列，以及中英/明暗主题适配的只读服务日志页。
- 首条消息自动命名和 Skill 调用标识此前已经实现，本次保持原有行为；新增导航、模型持久化、Agent 投影、日志尾部读取和 UI 结构回归覆盖。

### 每日记忆反思可选飞书/Telegram 通知目标（已完成）
- Desktop“插件 → 记忆后端设置”新增统一通知目标选择器，只列出已启用飞书/Telegram Bot 的授权会话，并把选择以结构化 channel/bot/chat 配置持久化。
- Owner 级每日反思仍动态扫描全部启用 Bot 的授权 Session，但结束后只向选中目标发送一条汇总；扫描 0 条、产生 0 条新记忆也会明确通知“已执行”，终态失败发送一条失败摘要。
- 通知使用现有渠道投递接口，不写入模型上下文或普通 Session；已选会话失去授权时安全回退到仍可用的第一个飞书/Telegram 会话。

### 每日回顾/每日素材设置重启持久化回归（已完成）
- 为已交付的插件设置重启修复补充真实持久化测试：使用临时 `settings.json` 与临时 SQLite 保存记忆开关、后端、每日回顾时间/通知、每日素材启用状态/时间/项目，再创建全新 `SettingsStore` 模拟重启并逐项核对。
- 测试不读取或写入用户真实 `settings.sqlite`，后续若保存器再次漏掉 `plugins.memory` 子字段会直接失败。

### Project Session 切换同步正文 runtime（已完成）
- 修复项目 Session 列表只更新左侧 `selectedSessionId`、聊天正文仍停留在旧 `projectChatStore.registry.active` 的问题；不同 Session 不再显示同一份聊天内容。
- Session 选择与对应 runtime 激活现在由共享 `selectProjectSession` 动作同步完成；`ProjectChat` 挂载时只恢复一次既有选择，不再依赖 legacy `$:` 监听导入 rune store 的属性变化。
- 后端真实 API 抽查确认同一项目 4 个 Session 返回不同 transcript；新增行为测试覆盖 A → B 切换时 active runtime 与消息正文同时变化。验证：精确回归测试通过、Desktop UI 42/42、Svelte 0 错误 0 警告。

## 2026-07-13

### 运行中生产构建不再破坏模型路由（已完成）
- 修复自定义 Svelte adapter 在构建开始时直接删除 `build/`，导致仍在运行的服务按需加载设置页 `/api/desktop/model-routing` 时找不到旧 manifest 引用的 `_server.ts-*.js` chunk、连续返回 500 的问题。
- 新构建现在先写入隔离 staging 目录；构建成功后先发布全部新 chunk，同时保留运行中进程仍可能依赖的旧哈希 chunk，最后原子替换 manifest。失败或中断的构建不会再破坏当前可用服务。
- 验证：adapter 回归测试 2/2；生产构建通过；构建期间连续请求模型路由 150 次，HTTP/JSON 失败 0 次。

### Owner 级记忆自动任务与系统任务分栏（已完成）
- “每日记忆反思”和“每日素材整理”从每渠道、每 Bot 各一份改为各自唯一的 Molibot Owner 级 watched event；执行时读取最新设置并动态发现全部启用 Bot，因此后续新增 Bot 会在下一次运行自动纳入，不会新增重复任务。
- 启动迁移只清理能够确认身份的旧版 per-Bot 记忆任务文件，保留用户自建任务和无法确认的文件；每个目标继续保有独立 watermark，单个目标失败不会阻止其他目标执行，最终仍进入统一重试语义。
- Desktop 自动任务页增加“用户任务 / 系统任务”中英双语分栏并适配明暗主题和窄屏。系统任务显示稳定的本地化名称和 Owner 归属，可手动运行，但启停、时间和功能开关统一由对应插件设置管理，API 同步拒绝编辑和删除。
- 托管事件的幂等判断使用忽略 JSON 对象 key 顺序的深比较；旧版或手工排序不同但语义相同的事件文件不会被无效重写，运行状态仍保留。

### GitHub Bug 修复批次：文件预览、会话隔离、首次导航与失败收敛（已完成）
- Project 文件 raw 预览增加路由级回归测试，真实调用 `/api/settings/projects/[id]/inspection/file?raw=true` 并验证返回媒体字节与 MIME，不再把 Svelte HTML 404 当作文件内容。
- Web/Profile 与 Project 的“新建会话”继续由共享 Session Store 按作用域复用唯一空会话；临时存储测试覆盖连续点击不会生成多个空 Session。
- 主 Chat 与 Project Chat 均使用按 Session 固定的运行时 controller；Project 运行时在组件重挂载后读取最新依赖，后台 A 会话的输出、队列、停止和审批不会落到正在浏览的 B 会话。
- 修复 Agents、Skills、Automations 首次点击看似无响应：实测点击事件第一次已触发，根因是启动 bootstrap 请求失败后同一 endpoint 不再重试，子页面又把失败空数据永久显示为 Loading。工作区现在等待 bootstrap 成功后才发子请求；再次点击或错误态按钮可重试，并提供中英双语错误说明。
- 修复 Skills 首次异步加载后“总数有值但卡片为 0”的响应式缺口：列表过滤从读取外部 rune store 的 legacy `$:` 迁移到 Svelte 5 `$derived`，加载 26 条时会立即渲染 26 张卡片，搜索输入仍即时过滤。
- 工具活动在服务端持久化和客户端读取历史记录时都会把遗留 `running` 收敛为 `error`；流中断会保留已生成文本、附件和工具时间线，不再永久转圈或丢失可继续的上下文。
- 验证包括真实浏览器点击与断服恢复故障注入、Desktop Svelte 诊断 0/0、Desktop UI 40/40，以及 Project raw route、Session Store、activity/transcript 共 11 项聚焦测试。

### Web UI Session 存储命名与删除生命周期（已完成）
- Web 界面使用的会话投影从含义模糊的 `users/<scope>/sessions` 改为 `ui-sessions/<scope>`，索引同步收进 `ui-sessions/index.json`；首次读取会按原顺序自动迁移旧索引和文件，确认新文件落盘后才删除旧空目录。
- 明确区分 UI Session（标题、附件、activity 与界面展示状态）和 Agent Context（模型、工具、压缩与续写状态）。Telegram、飞书、QQ、微信等外部渠道继续只使用 Agent Context，不新增 UI Session 副本。
- Web 与 Desktop 删除入口现在共用上层生命周期：运行中拒绝删除；静止会话会同步删除 UI Session 及对应 Agent `.json`、`.jsonl`、`.meta.json`，即使它是最后一个 context 也不会留下孤儿记录。
- 兼容 transcript 的第二阶段收敛已于 2026-07-14 完成：UI Session 现为 metadata-only，Agent entries 是普通消息正文的唯一权威；旧 display-only 命令消息按无损迁移策略保留。

### Project Chat 迁移到按会话运行时注册表（支持并发项目会话，已完成）
- Project 聊天此前用**单个** `ConversationController`，host 的 `sessionId`/`modelKey`/`thinkingLevel` 跟随当前选中会话，导致同一时刻只能跑一个项目会话，`stop`/`resolveApproval`/队列会串到正在浏览的会话。2026-07-12 的修复用固定 `turnSessionId` + `liveTurnVisible` 门控 + 不切换选中态的 `refreshProjectSessionMessages` 打了补丁；本次改动把 Project 聊天迁到主聊天已在用的架构，彻底去掉补丁。
- 泛化共享的 `SessionRuntimeRegistry`（`sessionRuntimeRegistry.svelte.ts`），新增三个**可选**的按会话解析器 `projectId`/`modelKey`/`thinkingLevel`（按 `(profileId, sessionId)` 键），注入到每个固定 host。主聊天的 `ChatSessionStore` 不传这些，因此其 host 的 `projectId`/`modelKey` 仍为 undefined、thinking 仍从 draft store 读取，行为完全不变。
- 新增 `projectChatStore`（`lib/projects/projectChatStore.svelte.ts`），一个对齐 `ChatSessionStore` 的**模块单例**：每个项目会话拥有自己固定的 controller（固定 `personal` profile + sessionId + 工作目录），后台 turn 会持续把输出流入自己的 transcript，而用户可以同时浏览另一个会话；stop/审批/队列始终作用于 turn 自己的会话。作为单例，项目 turn 能在 ProjectChat 卸载/重挂（切面板/切项目）后继续存活；仅由宿主（`ChatView` 断连重置 + `onDestroy`）整体销毁，删除会话时按会话销毁（`removeProjectSession` → `disposeSession`）。
- 重写 `ProjectChat.svelte` 改为驱动 `projectChatStore`（订阅其单一 `state` store、固定选中会话、send/stop/队列/审批/编辑重发都走 store）；transcript 现在来自注册表 entry 而非 `projectsStore.messages`。删除了已成死代码的补丁函数 `refreshProjectSessionMessages` 与 `liveTurnVisible` 门控。附件/媒体预览、语音录制、编辑重发保持不变。
- 验证：`svelte-check` 0 错误 0 警告；`vite build` 通过；Desktop UI 测试 41/41（`chat-ui.test.mjs` + `http-scope.test.mjs`）、cargo 测试 10/10 通过。`chat-ui.test.mjs` 里两处结构断言从旧单 controller 设计（`createConversationController`/`chat.send`/`modelKey: () => activeModelKey`）改为注册表架构（`projectChatStore.state`/`projectChatStore.send`/`resolveSessionModel`）。行为推演：项目会话 A 与会话 B 的 turn 现在各自并发流入自己的 transcript；在 B 点 Stop 只停 B；A 的审批在浏览过 B 后仍作用于 A。

### 加固：队列续发钉住完整 turn 上下文（已完成）
- `ConversationController.send()` 对队列续发（`drainQueue`）只钉住了 `sessionId`，而 `profileId`/`projectId`/`modelKey`/`thinkingLevel` 仍在 drain 时实时从 host 读取。当 host 可变（迁移前的单项目 controller）时，队列 drain 前切换项目/会话/模型会把被钉住的会话提交到错误的项目或模型上——跨项目/跨模型串台。上面的按会话注册表迁移已从根本上修掉了上报的场景（每个固定 host 现在返回固定值），所以本条是 defense-in-depth：controller 现在在 `send()` 起始对整个 turn 上下文拍快照，队列续发复用该快照，队列正确性不再依赖"调用方恰好把 host 钉死"。`stop()`/`resolveApproval()` 也从同一快照解析 `profileId` 以保持一致。
- 对当前所有调用方无行为变化：现有 host（主聊天注册表、项目注册表）均已固定，快照值等于实时值。验证：`svelte-check` 0 错误 0 警告、`vite build` 通过、Desktop 测试 42/42（`chat-ui.test.mjs` + `http-scope.test.mjs`）。

### 模型重试与持久化上下文锁步回滚（已完成）
- 修复 runner 模型重试循环只回滚内存上下文、不回滚 store 导致的持久化重复步骤问题：`message_end` 订阅器已把失败尝试的 assistant/toolResult 步骤 `appendContextMessage` 写入会话日志，而重试只做 `this.agent.state.messages = beforeAttempt`，`finally` 又会把持久化日志重新载入内存，于是每次重试都在会话里堆叠重复步骤并被下一轮继承。
- `MomRuntimeStore` 新增会话级检查点：`createContextCheckpoint` 在尝试开始时记录持久化日志长度，`restoreContextCheckpoint` 把追加式 entries 日志和 context 快照一起截断回该检查点（返回丢弃条数）。runner 在 `beforeAttempt` 旁捕获检查点，并用单一 `rollbackAttempt()` helper 在所有重试/放弃路径（可重试错误、空响应重试、上下文溢出压缩重试、抛出的模型错误、最终空响应耗尽）同步回滚内存与 store，丢弃步骤时重置 `assistantMessagePersisted`。store 调用用可选链，保证不带该方法的 runner 测试替身仍可用。
- 防止非幂等工具被重复执行：完整重跑会再次触发失败尝试里已完成的工具步骤（发消息、写文件）。`resolvePromptAttemptDecision` 新增 `attemptExecutedTools` 入参，失败尝试若已产生 `toolResult`，则把本可重试的错误降级为 `terminal_error`，直接把错误抛给用户而不是静默重复副作用。（checkpoint-continue 从最后一个完整 toolResult 续跑也能解决，但需要 SDK 级别的回合续跑能力；锁步 store 回滚是收敛的修复。）
- 验证：`tsc -p tsconfig.json` 在改动文件上无新增错误（`hostBash/store.ts`、`settings/store.ts` 的既有错误与本次无关）；`runnerRetryState.test.ts` 8/8、新增 `storeContextCheckpoint.test.ts` 3/3、`runner.test.ts` 24/24 全部通过。

### 聊天四项稳定性修复：会话串台 / 工具转圈 / 插件设置回滚 / 失败丢内容（已完成）
- **Project Chat 会话串台**：Project 聊天仍在用单 `ConversationController` 且 host `sessionId` 跟随选中会话，turn 结束时 `reload` 走 `selectProjectSession` 会把用户强行拉回正在运行的会话，且流式输出/审批卡片会在任何会话上渲染。现在 controller 新增 `turnSessionId`（随 turn 固定），`stop`/`resolveApproval`/队列 drain 都固定到该会话；Project Chat 的 live 输出（streaming/activities/approval/sending 气泡）按 `turnSessionId === selectedSessionId` 门控；新增 `refreshProjectSessionMessages`（只刷新、不改选中态）替代 turn 收尾时的 `selectProjectSession`。
- **工具调用永久转圈**：run 被中断（abort、崩溃、工具没有发出 end 事件）时，持久化的 activities 里会留下 `running` 状态条目，transcript 永远转圈。服务端 `ConversationActivityCollector` 新增 `finalSnapshot()`（把仍在 running 的条目收敛为 error），`/api/stream` 与 `/api/chat` 持久化时使用；客户端 `finalizeTranscriptActivities` 对已持久化消息（含历史数据）做同样收敛，live 流式列表不受影响。
- **插件设置重启回滚**：`SettingsStore` 的 save/load 只序列化 `plugins.memory` 的 4 个字段，`reflectionTime`/`reflectionNotifications`/`dailyMaterials`（每日反思、每日素材）、`plugins.hooks` 及动态 feature 插件 settingsKey 数据每次重启都被重置。现在 save 序列化完整 `plugins` 块；load 通过新抽出的共享 `sanitizeMemoryPluginSettings` 还原完整 memory 配置，并透传 hooks 与动态插件键；`sanitizeSettings` 同步保留动态插件键。
- **聊天失败丢中间内容**：`/api/stream` 中客户端断连/停止后 `controller.enqueue` 抛错会炸掉整个持久化路径，导致前面所有输出（含 9/10 步的工具过程）全部丢失。`writeEvent` 改为对已关闭流静默容错，run 收尾的 transcript 持久化不再被断连打断；catch 分支新增兜底：把已生成的部分文本 + finalized activities + 附件持久化成带“已中断”提示的 assistant 消息，并用 `assistantPersisted` 标志防止与成功分支重复入库。runner 侧原有的 partial 保留与 finally 从 store 重载上下文逻辑保持不变，"继续" 可以基于已持久化的步骤接着走。（渠道不受影响：`MomRunner.run` 失败时返回 `stopReason:"error"` 而非抛异常，各渠道运行时仍会持久化累积文本。）
- **补充健壮性排查**：ProjectChat 输入侧同样存在串台——`handleComposerKeydown`/`queuedMessages` 读的是共享单 controller 的原始 `sending`/`queue`，在浏览空闲会话时敲回车会把后续消息塞进正在后台运行的会话，且该会话的待发队列会渲染到当前会话；两者都改为按 `liveTurnVisible` 门控。主 ChatView 已用按会话固定的 `SessionRuntimeRegistry`，天然免疫 bug 1 这类问题；ProjectChat 仍是单 controller（同一时刻只能跑一个项目会话），已记录为后续迁移到 registry 的方向。
- 验证：`svelte-check` 0 错误 0 警告、`vite build` 通过、Desktop UI 39/39；服务端 settings/sanitize/store、conversationActivity、sessions store、desktop api 共 89/89 通过（含 desktopPlugins 早前 103/103）；`tsc` 对触碰文件无新增错误。

### Project 本地文件面板大图与媒体文件内联预览（已完成）
- 解决在 Project 右侧文件面板中浏览项目本地文件时，对于图片、音频、视频等文件无法预览的问题（小于 256KB 会提示“二进制文件不能预览”，大于 256KB 会提示“文件超过预览上限”）。
- 后端 `/api/settings/projects/[id]/inspection/file` 接口新增 `raw=true` 参数支持，解析并定位项目文件的绝对路径后，直接以带有正确 MIME 类型和 Cache-Control 缓存头的原生二进制 `Response` 返回。
- 前端 `ProjectFilePanel.svelte` 新增对 `@molibot/shared/filePreview` 模块别名的依赖引入（修改了桌面端的 `vite.config.ts` 和 `tsconfig.json`），使用 `mediaTypeFromName` 对文件类型进行研判，遇到 image、audio、video 文件时不再回退到文本无法预览逻辑，而是利用 `raw=true` URL 在前端以 `<img />` / `<audio />` / `<video />` 容器进行原生内联预览，彻底突破了 256KB 的文本预览大小上限，实现了大型图片和媒体文件的秒开预览。
- 验证：`svelte-check` 0 错误 0 警告、根目录 `pnpm run build` 成功通过。

### Project Chat 附件只显示文件名问题修复（已完成）
- Project Chat 之前没有把 `attachmentActions` 传给 `ChatMessagesPane`，导致共享 transcript 渲染器走 fallback 分支，图片/音频/视频附件只能显示为文件名 chip，没有内联预览。
- `ProjectChat` 现在按 ChatView 同样模式接入：通过 `listDesktopSessionFiles` 拉取当前会话的文件列表（带 `projectId`），维护 `fileByLocal` Map 和 `messageMediaUrls`/`mediaLoading`/`mediaFailed` 状态，提供 `loadProjectMessageMedia`/`openProjectPreview`/`downloadProjectFile` 三个 hook（内部用 `fetchDesktopFileBlob` 并传 `projectId`），切换会话时撤销缓存的 blob URL 并清掉媒体状态；模板末尾追加与 ChatView 一致的 preview-overlay。
- 验证：`svelte-check` 0 错误 0 警告、`vite build` 通过、Desktop UI 39/39。

### Volcengine 图片参考图透传（已完成）
- `imageGenerate` 的 Volcengine provider 现在把工具层 `images` 参数按火山方舟官方 ImageGenerations 契约映射为请求体 `image` 数组，Seedream 角色参考、多图组合与图像迁移不再退化成纯文生图。
- 新增请求体回归测试，锁定参考图 URL 数组、模型和尺寸都会真实发送；原有 Agnes、OpenAI、Google、ModelScope 与自动路由路径保持不变。
- 验证：`imageGenerateTool.test.ts` 11/11 通过。

### Desktop 文件面板关闭按钮与大图预览修复（已完成）
- 修复 Project 右侧文件面板右上角关闭按钮点不动的问题：`.file-panel-head` 被 52px 高、z-index 30 的 `.window-drag-mask`（窗口拖拽热区）覆盖，按钮 mousedown 被吞掉。给 `.file-panel-head` 加 `position: relative; z-index: 31`，与 `.header-actions` 一致，按钮恢复响应。
- 修复大图（1MB+）预览失败：服务端 `GET /api/web/files` 改为流式响应（`createReadStream` + `Readable.toWeb`，附带权威 `content-length`），不再 `readFileSync` 整文件入内存；前端 `fetchDesktopFileBlob` 改为手动按 chunk 读取 body stream 拼接 `Blob`，绕开 `response.blob()` 在 Tauri plugin-http 流式响应上的截断问题，传输中任何错误会显式抛出而不是变成被截断的图片。
- 验证：`svelte-check` 0 错误 0 警告、`vite build` 通过；Desktop UI 39/39、Desktop API 74/74。

### Desktop Chat 消息复制与编辑后重发（已完成）
- 共享 transcript 每条消息悬停显示操作按钮：复制（写入 `message.content` 原始 Markdown 到剪贴板）对用户/AI 消息都可用；编辑按钮仅出现在用户自己的消息上，外部只读会话只显示复制。
- 编辑按钮把消息内容填入 composer 并进入“正在编辑”模式：输入区上方显示 banner + 取消按钮，当前编辑的消息在 transcript 中以蓝色描边高亮；点击发送后前端先调用 `truncateDesktopMessages` 在服务端删除该用户消息及其后所有消息，再以编辑后的内容正常发送一轮，避免历史重复。
- 后端在 `SessionStore` 新增 `truncateMessagesFrom(conversationId, fromMessageId)`：以 messageId 为锚点删除该消息及其后所有消息，写入对应 Web/Project session 文件；新增 `DELETE /api/sessions/:id/messages?fromMessageId=...` 端点，body 携带 `profileId`，通过 `getRuntimeContextForConversation` 自动路由到 Web 或 Project runtime；运行中的会话拒绝编辑（409），找不到消息返回 404。
- 切换会话时编辑态自动清空；truncate 失败时 composer 内容与编辑态原样恢复，用户可重试；发送期间禁用编辑按钮。
- 验证：`svelte-check` 0 错误 0 警告、`vite build` 通过；sessions store 测试 6/6（含新增 `truncateMessagesFrom` 单测）、desktop API 测试 68/68、desktop UI 测试 39/39。

### Bot Project 模式：与 Desktop 共享同一份 Agent 上下文（已完成）
- 修复飞书流式路径完全忽略 `/project` 绑定的问题：绑定后消息仍在 bot scratch 目录执行、拿不到项目目录；现在流式与非流式两条路径都会解析绑定并注入项目上下文（rootPath、instructions、模型/思考默认）。
- 新增 `ProjectAwareRunnerPool` 路由器包裹渠道 RunnerPool：scope 绑定 Project 后，消息、/stop、steer、追问、reset、/compact 全部路由到项目 runtime（`projects/<id>/runtime`），以会话 key + 项目会话 uuid 作为 runner 键；`task-*` 自动化会话始终留在 bot 池，不污染项目会话列表。
- 项目 runtime 的 {store, pool} 抽到进程级共享缓存（`projects/runtimeCache.ts`），Desktop 与渠道两侧解析到同一个 `MomRunner`：在飞书里以 Project 模式聊天，回到 Mac App 打开同一会话可以无缝继续（同一份 contexts 文件），反向亦然。
- Project 模式下渠道消息落库到项目会话存储（`projects/<id>/sessions/`），Desktop 项目会话列表可直接看到 Bot 会话；项目会话按 id 打开不再要求 externalUserId 匹配（项目为 owner 私有），Desktop 的 runner 键、附件、host-bash、compact、stop 均改用会话自身的 externalUserId，支持跨端接续。
- 验证：涉及文件 `tsc` 无错误；sessions/commands/contextBuilder/router/feishu/telegram/weixin 测试 48/48；desktop-chat 套件 187/187。

### Desktop 插件设置页折叠卡片重构（已完成）
- macOS App 的“插件”设置页改为手风琴式折叠卡片：每个插件（记忆后端设置、每日素材、Cloudflare HTML Publish 及其他 feature 插件）默认只显示一行，包含名称、描述、状态徽章、启用开关和“编辑”按钮；点击“编辑”才展开完整表单，同时只允许一张卡片展开。
- 移除该页底部的“全部插件”列表以及“总数/活跃/外部”统计卡片：渠道（web/telegram/feishu/qq/weixin）、provider 和 memory backend 不是面向用户的产品插件，已在各自专属设置页中管理，不再出现在插件页。
- 把“每日素材”从记忆后端表单中拆为独立折叠卡片，保留独立启用开关和历史回填按钮；每个插件可独立编辑。
- 验证：`svelte-check` 0 错误 0 警告、Desktop UI 39/39 通过、`vite build` 通过。

### Bot Project 模式（已完成）
- 飞书、Telegram、QQ、微信 Bot 会话可用 `/project` 查看与选择已注册 Project，使用 `/project off` 返回普通聊天；Telegram `/` 菜单同步提供入口。
- 选择按渠道、Bot 实例和会话 scope 持久化；后续消息复用现有 Project Runner 逻辑，包括项目目录、instructions、项目本地 Skills、默认模型/思考级别和工具输出规则。
- 实现位于共享命令、ProjectStore 和 BaseChannelRuntime 层；Channel 只保留消息收发，不复制 Project 编排。
- 验证：共享命令/上下文/ProjectStore 聚焦测试 33/33，SvelteKit 生产构建通过。

### Desktop 斜杠命令、Skill 自动提示与 Project 独立默认设置（已完成）
- Chat 与 Project Chat 的共享输入区在输入 `/` 时展示服务端生成的命令与已启用 Skill，支持模糊筛选、方向键、Enter/Tab、Esc、鼠标选择和中文输入法组合态保护。
- 命令元数据由共享注册表同时驱动 Desktop 建议与 Web `/help`；Skill 来自真实 Desktop Skills 投影，禁用项不会进入可执行建议，前端不维护第二份清单。
- 共享 transcript 会把已识别命令显示为蓝色 `COMMAND` 卡片，把 Skill 调用显示为独立 `SKILL` 卡片；未知 `/文本` 保持普通消息，展示不参与执行判断。
- Desktop 已识别 Command 走 Web 命令执行端点并把命令/结果保存到当前 Session；Skill 继续走流式 Agent 执行路径。
- Project 头部新增独立设置入口，可保存名称、附加说明、默认模型和默认思考等级；空值继承全局设置，Agent 继续由项目 `AGENTS.md` / `CLAUDE.md` 管理。
- Project Session 的模型选择改为逐轮 `modelKeyOverride`，不再修改全局模型路由；每个 Session 保留自己的临时模型/思考选择，解析顺序为 Session → Project → Global。
- `projects` SQLite 表通过幂等列迁移增加 `model_key` / `thinking_level`，设置保存继续走细粒度 Project PATCH；服务端拒绝未知模型。
- 验证：Composer/Project 存储测试 5/5、Desktop UI 39/39、Desktop Svelte 0 错误 0 警告、生产构建与 diff check 通过。

### Project 本地 Skills 全链路加载（已完成）
- Project 会话额外发现 `<projectRoot>/.agents/skills/**/SKILL.md`，标记为 `project` scope，并按 project → bot → global → chat 的根顺序优先加载；同名低优先级 Skill 写入 duplicate diagnostics。
- Project root 已穿透 Runner 显式 Skill 匹配、最终系统提示词、skillSearch 工具、Web `/skills` 命令和 Desktop 斜杠建议，不再只修 UI 列表。
- Desktop 建议只发送 `projectId`，服务端从 ProjectStore 解析真实 rootPath；前端不会扫描或持有额外的本机绝对路径。
- Skill prompt 缓存 key 包含 projectRoot，避免同一运行时在 Project A/B 之间串 Skill；普通 Chat 不传 Project root，保持原有隔离。
- 用真实 `/Users/gusi/Github/momo-agent/.agents/skills` 只读验证识别 26 个 Project Skills，全部为 project scope、无 diagnostics。
- 验证：Skill/Prompt/Desktop API 聚焦测试 99/99、Desktop UI 39/39、Svelte 0/0、生产构建与 diff check 通过。

### Project 运行与展示覆盖设置（已完成）
- Project 设置新增 Sandbox、Tool Progress、Reasoning 展示和 Runlog 自动通知，连同已有模型/思考默认值全部支持继承。
- Sandbox 优先级为 Session → Project → Bot → Agent → Global；Project 开关完全复用现有 Sandbox 行为，不引入 Project 专属安全语义。
- Project 绑定的 Desktop/Telegram/Feishu/QQ/Weixin 会话按 Project 覆盖工具进度与思考展示；Runlog 通知按 Session → Project → Bot → Global 解析。
- `projects` 表通过幂等迁移增加四个 nullable override 字段，细粒度 Project PATCH 可恢复为继承状态。

### Web / Desktop Trace 当前运行控制（已完成）
- Web `settings/ai/trace` 与 Mac App Trace 页新增“当前运行”区域，每 3 秒联合真实 RunnerPool 快照与持久化 run fact，区分“运行中 / 疑似卡住 / 孤儿记录”。
- 列表展示 Agent、Bot、渠道、开始时间、持续时长和 160 字任务摘要；真实 Runner 持续 10 分钟后标记为疑似卡住，但不会自动终止。
- “停止运行”按 `channel + botId + chatId + sessionId` 精确中止真实 Runner；“清理记录”只把不存在 Runner 的孤儿 fact 标记为 aborted，保留完整审计数据。
- RunnerPool 新增只读运行快照和精确 session abort 共享能力，BaseChannelRuntime 仅做代理，跨渠道控制逻辑仍位于共享 app/API 层。
- Web 使用既有 shadcn Card/Badge/Button 体系，Desktop 复用 Geist 设置卡片；两端均支持中英、明暗主题、移动宽度和操作确认。
- 验证：活动分类测试 7/7、Desktop UI 37/37、Desktop Svelte 0 错误 0 警告、完整 SvelteKit 生产构建通过。

### Desktop Three.js 巴哥犬 Agent City（已完成第一阶段）
- Mac App 的 `Agent` 工作区已从 CSS 拼装办公室升级为固定等距 Three.js 微缩城市；Svelte 继续负责真实 Agent/Activity 数据、轮询、国际化、DOM 名牌、详情、错误和降级视图，Channel 无改动。
- 城市固定包含 10 个普通 Agent 地块、独立 Global 总部和中央主人调度中心。普通 Agent 以稳定槽位按轮次加层，最多 10 栋 × 10 层；第 101 个起只增加明确的未展示数量。
- 纯 `agentCityProjection` 边界将 Agent/Activity/稳定槽位投影为建筑、楼层、状态、任务路线和 Sub-agent 协作舱，覆盖 0/1/10/11/40/41/100/101 Agent；不会从任务文本猜测工具动作。
- 每层只对应一个 Agent，程序化玩偶屋内使用统一代理巴哥犬表达 disabled/idle/working/completed/error；任务从主人中心沿地面路线和数据井到准确楼层，完成回传、失败告警不会串楼。
- Sub-agent 通过父 `runId` 归属父 Agent 楼层，最多直接展示 3 个穿助手标识的巴哥犬，更多数量聚合为团队协作舱，不占永久楼层。
- Agent 名称和状态使用常驻 DOM 控件；悬浮或键盘聚焦后显示说明、Bot、渠道、开始时间、任务摘要、模型路由和 Sub-agent 详情。2D 降级视图保留同等详情与键盘语义。
- 画质自动选择完整 3D、低画质 3D或精致 2D。持续低帧率先在原 Canvas 原地降低像素比、阴影和帧率，仍不满足时降级 2D；WebGL2 不可用或上下文丢失也不会留下空白 Canvas。
- 页面失焦或场景离屏时暂停非必要渲染，低动效关闭装饰循环；卸载时释放观察器、监听器、几何体、材质、纹理、render list 和 WebGL 上下文。
- 明暗主题分别使用自然日景与克制夜景，窄窗口保持可读；楼层增加时场景纵向增长，不把十层内容无限缩小进固定首屏。
- 当前交付使用程序化城市与代码生成代理角色；正式 Blender GLB 模型、骨骼、动画和材质替换仍是后续美术里程碑。
- 验证：Agent City 投影/场景测试 9/9、服务端 Agent Activity/Trace 测试 9/9、Desktop UI/HTTP 54/54、Svelte 0 错误 0 警告、生产构建通过；真实 1280×800 页面验证 Global + 4 普通 Agent 名牌全部可见且无横向溢出。

### 模型路由与 AI 服务商 UI 优化（已完成）
- 在「模型」设置页面中，从全局模型能力路由选择列表中移除「语音合成」(TTS) 选项，使页面只专注于文本、视觉、语音转写和智能体等核心模型的配置。
- 在「AI 服务商」的自定义提供商配置页中，将模型注册表列表改造为「内置模型」与「自建模型」两个左右切换的 Tab 选项卡（如果是非内置提供商，则自动默认选中「自建模型」）。
- 在「AI 服务商」的主设置页面底部的服务商列表上，同样添加「内置服务商」与「自建服务商」两个左右切换的 Tab 选项卡，并新增搜索框（支持模糊搜索服务商 ID 或名称）与「已启用优先」排序按钮，方便在大列表中快速查找和管理服务商。
- 在模型列表中新增搜索框（支持模糊搜索模型 ID），并且支持「已启用优先」与「默认排序」的排序切换，默认开启已启用优先，方便用户在大列表（如 OpenRouter / SiliconFlow）中快速查找及管理模型。
- 同步更新桌面应用（Tauri/Svelte 5）与网页版（SvelteKit/Svelte 4）的提供商管理页面。
- 修复：解决当对模型状态或提供商配置做出修改时，selectedProviderDetail 或 providerEdit 变化导致 Svelte effect/reactive 监听被重新触发，从而强制将模型 Tab 重置为 "内置模型" 并清空搜索词的 bug。现限制为仅在提供商 ID 真实变更时才执行重置。
- 修复：网页版（+page.svelte）中新增的 Tab 和排序按钮由于使用 Svelte 5 的 `onclick`，在旧版 legacy 编译模式下无法触发 `$$invalidate` 使 `let` 变量重绘的问题。现统一改回 legacy Svelte 4 的 `on:click` 事件，恢复其正常的响应式变化。
- 验证：运行 `npm run desktop:check` 取得 0 错误 0 警告；运行 `npm run desktop:test` 38 项测试及 Rust 单元测试全部通过。

### 每日素材独立扫描模型（已完成）
- 新增可选的「扫描模型」：素材提取与汇总调用可跑在更小更便宜的模型上，与聊天主模型解耦。配置项 `dailyMaterials.scanModelKey`（留空=跟随主模型），Desktop「记忆 → 每日素材」下拉选择，选项来自 `buildModelOptions(settings, "text")`。
- 以「单次调用覆盖」实现：`AssistantService.reply` 新增 `{ modelKey }` 参数，`overrideSettingsForModelKey` 据此派生一份临时设置（pi 或 custom provider/model）仅对该次调用生效，不改全局。每日定时任务与历史回填都用它，包括多批/汇总的每一次调用。
- 验证：`modelKeyOverride.test.ts`（3）、`dailyMaterials.test.ts`（9）、`sanitize.test.ts`（9）、`desktopPlugins.test.ts`（7）、`taskScheduler.test.ts`（5）通过；桌面 `svelte-check` 0/0；生产 `vite build` 通过。

### 每日素材 token 预算与分批扫描（已完成）
- 用「按 token 预算 + 混合分批」取代原来写死的 6 万字符尾部截断（会话一多会静默丢弃较早会话）：总量不超预算走一次调用；超预算则按会话打包多批、逐批提取，再一次汇总合并去重成当日文件，不丢任何 session；个别超长会话单独尾部截断。
- 预算按 CJK-aware token 估算（CJK 字≈1 token，其余≈¼），可配置 `dailyMaterials.scanTokenBudget`（默认 120000，范围 8000–900000），Desktop「记忆 → 每日素材」新增数字输入框。
- 明确扫描内容边界：只读 user/assistant 的最终 `content`，思考过程与工具调用在独立 `activities`/part 通道、不会进入模型。新增指南 `docs/guides/daily-materials.md`（运行流程、模型选择、watermark 隔离、预算/分批、代码地图）。
- 验证：`dailyMaterials.test.ts`（9，新增 1 条分批/汇总）、`taskScheduler.test.ts`（5）、`sanitize.test.ts`（9）、`desktopPlugins.test.ts`（7）通过；桌面 `svelte-check` 0/0；生产 `vite build` 通过。

### 每日素材历史回填（已完成）
- 为每日素材自动化新增一次性「回填历史」能力：扫描已授权会话的全部历史，为过去每一天生成一个素材文件，让已运行数周的项目一开始就有充足素材，而不只是昨天一天。
- `DailyMaterialsService.run` 拆分为 `runForDate` + `runBackfill`；回填按日期升序逐天处理，让隔离的每日素材 watermark 逐天推进，从而保证幂等、可中断续跑。起始日期通过 `SessionReflectionSourceReader.earliestLocalDate` 自动扫描最早一条授权消息。
- 以内存后台任务（`DailyMaterialsBackfillJob`）实现，提供轮询进度接口（`/api/desktop/plugins/daily-materials-backfill`），并在 Desktop「记忆 → 每日素材」下新增按钮显示实时进度，无需命令行。
- 验证：`dailyMaterials.test.ts`（8，新增 2 条回填）、`taskScheduler.test.ts`（5）、`sanitize.test.ts`（9）、`desktopPlugins.test.ts`（7）全部通过；桌面 `svelte-check` 0 错误 0 警告；生产 `vite build` 通过。

### Desktop Chat 思考与工具进度展示修复（已完成）
- Chat 与 Project Chat 的流式及历史“思考过程”默认展开，用户仍可手动收起。
- 工具运行进度默认收起，仅在用户手动点击后展开；结构化 `runner_event` 不再同时作为消息正文状态显示，消除 `tool_start=...` / `tool_end=...` 原始文本重复。
- 新增桌面 UI 回归断言，覆盖展开策略与工具事件/正文分流。

### Desktop Chat 权限审批按钮无法点击修复（已完成）
- 修复了在 Chat 和 Project Chat 中，由于 SSE 流尚未结束导致 `sending` 状态一直为 `true`，进而使得权限审批卡片按钮处于 `disabled` 状态且控制器 `resolveApproval` 中置守卫拒绝执行的 Bug。
- 在 `conversationController` 中区分流式 SSE 运行中与已结束两种路径：SSE 流运行时直接下发审批决定让后台流继续推送；流已结束时则继续走轮询同步机制。
- 移除了 Svelte 模板中审批卡片的 `disabled={sending}` 限制，实现了卡片触发即关闭并提交，防止多次连击的流畅交互。
- 补齐了自动化回归测试覆盖。

## 2026-07-11

### macOS 规范桌面图标与头像处理（已完成）
- 使用 Python Pillow 对方形头像 `momo-happy-icon.png` 进行了符合 macOS app icon 指南（HIG）的裁剪和样式化：生成了居中于 1024x1024 透明画布的 824x824 圆角主体，配合 225px 拐角半径（corner radius）、双层柔和投影和 1px 细微描边。
- 覆盖替换了 `apps/desktop/public/molibot-icon.png` 资源，并利用 `tauri icon` 生成工具重新构建了包含 ICNS、ICO、各尺寸 PNG 格式的桌面端全平台应用图标（输出至 `apps/desktop/src-tauri/icons/`）。
- 验证：Tauri 图标生成脚本运行正常，Svelte 界面引用该头像时通过 `object-fit: cover` 结合 `border-radius: 50%` 自动隐藏透明外边距，在前端 UI 和系统 Dock 栏均呈现符合规范的完美比例。

### Daily Materials 内置素材任务（已完成）
- 新增 `daily-materials` internal watched event：复用授权会话只读投影，但使用独立 watermark，按项目内可编辑模板生成上一完整本地日的素材文件，不进入普通 Agent Runner 或会话历史。
- 输出严格限定在已注册 Project 的相对目录；无效 Project、路径/软链接越界、疑似凭据、失败或 abort 均不推进 watermark，也不降级写 scratch。已有日期文件按“补充”段追加。
- Desktop Memory 设置支持启用、时间、输出 Project、目录、模板和完成通知；managed event 随保存重建并保留状态，Automation 手动触发 internal 任务时走共享 runtime 分发。
- momo-agent 已补齐每日提取提示词、月度复盘模板和自动化接入说明；素材目录与资产 catalog 核对一致。

### Desktop 项目文件面板 Header 高度对齐（已完成）
- 移除了项目文件面板（`.file-panel`）的 `padding-top: 32px`，并将其 Header（`.file-panel-head`）的 height 从 `48px` 调整为 `60px`。
- 确保了右侧文件面板的 Header 与中间聊天区域的 Header（`.chat-header`）高度完全一致且顶边对齐，横向分割线完美连贯。

### Desktop 项目创建目录确认修复（已完成）
- 选择已有目录后会保留并展示所选路径，同时出现明确的“创建项目”主按钮；提交失败时路径不丢失，可直接重试，不再停在只有“返回 / 取消”的界面。
- 两个 Desktop 项目创建入口保持一致，并补齐中英文、明暗主题 token 样式与回归测试；Svelte check 0 error / 0 warning。

### Desktop 项目删除入口（已完成）
- 项目标题 hover/focus 操作区新增 `…` 更多菜单，首批提供“重命名项目”和“删除项目”；重命名通过细粒度 Project API 即时更新侧栏。
- 删除确认弹窗明确默认只移除 Molibot 项目登记，不触碰本地工作目录。
- 可选同时删除该项目的 Molibot 对话记录；支持删除当前或非当前项目，并在成功后清理对应侧栏状态。

### Memory 每日反思时间与完成通知（已完成）
- Plugins 的 Memory 设置新增本地 `HH:mm` 每日反思时间和完成通知开关，默认 `03:00`；保存后 runtime 立即重启 scheduler，并只改写 Molibot 管理的 reflection event，保留既有执行状态。
- 内部反思仍绕过普通 Runner；仅当新增候选时，向该 Bot 的首个允许 Chat ID 发送一条独立直达通知，零候选、失败或中止均不发送。
- Desktop 控件使用既有设置表单、Switch、固定保存底栏和双语文案；验证聚焦设置/调度/Desktop/API 84/84、Svelte check 0/0。

### Memory review 稳定性修复（已完成）
- 每日 03:00 反思改为处理上一个完整本地日，避免当天 03:00–24:00 的消息永久漏扫；单个无效 LLM 候选只跳过自身，存储类异常仍中止以保留重试语义。
- embedding 配置缓存现在用 API key 的 SHA-256 摘要识别轮换（不记录密钥）；首次 provider 失败后进入 60 秒冷却，期间 add/search 直接走 lexical，避免每次请求重复触网。
- mory compact 的过期/重复 ID membership 改为 `Set`，10,000 条扫描不再退化为数组线性查找叠加的 O(n²)。
- **验证**：五个 review 点先红后绿，并补充基础设施失败保护；Memory 全套 24/24、调度器/Desktop/API 71/71 通过。

### Memory 改进计划 v2.2 剩余批次（已完成）
- **T1b/T4 检索**：mory 写入门控、冲突、consolidation 与 retrieve 统一使用 CJK word+bigram tokenizer；retrieve 支持显式多 namespace/domain 合并。可在 Plugins 中配置 OpenAI-compatible embedding Provider/模型，向量不可用自动回退 lexical；存量向量按模型版本可中断回填。
- **T3/T5 反思与 Inbox**：即时 flush 只处理显式“记住”；默认每日 03:00 创建 internal watched event，经只读 ReflectionSourceReader 扫描 Web/Project/外部 context，不写会话、不发渠道消息。候选使用独立 SQLite、watermark/fingerprint 幂等，confirm 是唯一正式写入入口，ignore 生成确定性 suppression；importer 与 json-file 迁移默认进候选治理。
- **T6b/T7 应用与审计**：Memory 工具支持 content 防重检索、content/agent_self 结构化写入；Desktop Inbox 支持编辑确认/忽略，正式记忆展示 namespace/domain/type、reason、sources、来源对话、版本历史、冲突、过期与 pin。compact 会归档过期/重复/超容量低保留项，pin 全程豁免。
- **默认值**：新安装默认启用 Memory 并选择 mory；旧配置仍由 sanitizer 保持显式值。
- **验证**：mory 184/184；Memory/事件/桌面核心验收 19/19；产品/审计场景 14/14；Desktop/API 全量回归 181/181；Desktop Svelte check 0/0；production build 与 diff check 通过。

### 历史文档归档
- 实施了 `CHANGELOG.md` 和 `prd.md` 的归档方案。为了防止文件无限追加超过 256KB 的 Agent 读取限制，将 2026 Q1（2-3月）和 Q2（4-6月）的历史记录搬移到 `docs/archive/` 目录中。
- 生成了四个归档文件：`docs/archive/changelog-2026-Q1.md`、`docs/archive/changelog-2026-Q2.md`、`docs/archive/prd-archive-2026-Q1.md`、`docs/archive/prd-archive-2026-Q2.md`。
- 主 `CHANGELOG.md` 和 `prd.md` 仅保留当前 Q3 的活跃条目和核心静态章节，并在顶部增加了索引链接。
- 在 `AGENTS.md` 和 `CLAUDE.md` 中添加了相应的归档规则与文件位置说明。

### Memory 批次 1：稳定版本链与 namespace/domain（已完成）
- C0 契约已完成实现前核对；新增共享 Memory namespace/domain/semantic type/source 类型，以及 owner/chat/project/agent/content namespace 编码与 prompt query plan。content 不会自动进入普通聊天注入，群聊可关闭 owner 合并。
- runtime prompt snapshot 与 Agent Memory 工具现在传递完整 bot/project scope；普通会话合并 owner/chat/agent，Project 会话额外合并当前 project。按 ID 的查看、修改、删除以及全局搜索/compact 都能定位实际 namespace，旧 `channel::user` 记录继续可读。
- mory 已新增可兼容旧 SQLite 的 `domain` 列与索引迁移，CanonicalMemory/SQLite/pgvector 全链路保留 domain。结构化写入使用稳定 `mory://<type>/<subject>`，无 subject 的纯文本写入继续使用唯一低置信路径；prompt 搜索开始合并 owner/chat/agent/project 与 legacy chat namespace。
- **最终验证**：mory 181/181、宿主 namespace/稳定路径/运行时 scope 23/23、根 production build 通过；覆盖旧 SQLite 无损迁移、同路径 version=2、跨 namespace 隔离、content 不自动注入和 Project query plan。

### Desktop 项目文件面板 - inline 展开 + diff2html + .gitignore
- **交互改为 inline 展开**：点文件/变更行就地向下展开内容（GitHub 风格），再点折叠；不再打开覆盖整列的"预览页"。修复了预览随列表滚走、以及预览固定黑色不跟明暗主题的问题。
- **diff 用 diff2html**：行号、`+/-` 配色、hunk 结构交给 diff2html 渲染（替换手搓的按行 span）；覆写 `.d2h-*` 到 Geist token，跟随明暗主题。
- **后端尊重 .gitignore**：用 `ignore` 库过滤文件树，node_modules/dist/build 不再刷屏。
- **文件类型图标**：按扩展名映射 Phosphor 文件图标（`ph-file-ts/js/css/py/...`）+ GitHub 式语言配色。（`vscode-material-icon-theme` 是 VS Code 扩展、不可 npm 引入，改用 Phosphor 的文件类型集。）
- **变更状态标签上色**：修改=琥珀、新增=绿、删除=红、重命名=蓝、未跟踪=灰，并缩小。
- **滚动**：全局细滚动条（10px 轨 / 6px 滑块）；面板加 `min-height:0`，文件多时可滚动。
- **范围**：`apps/desktop` + `src/lib/server/projects/inspection.ts`。**验证**：`svelte-check` 0/0、`vite build` 通过（diff2html CSS 已打包）、inspection 测试 8/8 通过。
- **遗留（按 IDE 技术栈讨论）**：monaco（只读、不做编辑）、chokidar/fast-glob/fdir/@tanstack/virtual（暂无对应功能）先不引入；simple-git 不采用（保留现有硬化版 `runGit`）。

### Desktop 项目文件面板重构
- **修复未定义 token bug**：`var(--background)` / `var(--background-secondary)` 从未定义（active tab 透明、预览层透明、代码块无底色、focus 环失效），现在映射到 `--card-bg` / `--surface-secondary` / `--code-bg`；loading 转圈引用了不存在的 `@keyframes spin`，改用 `project-spin`。
- **预览层重构**：把 文件 / 代码 / diff / 附件 预览移到不滚动的 `.project-panel-body`，预览钉在视口而非随文件列表滚走。
- **边框**：面板外壳 `0.5px` 改 `1px solid var(--separator)`。
- **尺度收敛**：外壳与 `.project-*` 全部收到 Geist 尺度（padding 32/48、高度 32/40/48、`--rounded-sm`、字号 >=12、代码走 `--code-bg` 12/16）。
- **diff 行级配色**：按行渲染 `+` 绿 / `-` 红 / `@@` hunk 灰（之前是无样式的纯 `<pre>`）。
- **文件行操作**：hover 出现 复制路径（剪贴板，复制后打勾 1.2s）；空状态加图标；面包屑用 caret 分隔替代裸 `/`。
- **遗留**：项目树文件的 下载 需要后端 blob 接口（当前没有），附件已有下载。范围仅 `apps/desktop`。
- **验证**：`svelte-check` 0 error / 0 warning，`vite build` 通过。

### Desktop Geist 字体与层级打磨
- **真正加载 Geist 字体**：通过 Fontsource 引入 Geist Sans（400/500/600）与 Geist Mono（400）的 latin 子集，让 `DESIGN.vercel.md` 的字体系统真正渲染，不再静默回退到 SF；CJK 仍按既有栈回退到 PingFang SC。这是“看着粗糙却说不出来”的主因。
- **字距收敛到 Geist 规范**：标题改用负字距（页面/空态 h2 `-0.04em`、品牌标题 `-0.02em`），过松的大写小标签字距（`0.08em`/`0.07em`）收敛到标准 `0.04em`。
- **阴影收敛到 Geist 三档层级**：自定义阴影收敛为 raised card / popover / modal 三档加功能性 focus/选中环；移除装饰性头像与内嵌高光，修复 `--shadow-card` 未定义 token 导致 Project 文件标签 active 态无阴影的 bug，把 30-72% 重透明度的弹层/浮层替换为规范 token 值（新增 `--popover-shadow` 用于菜单与浮动条，含 dark 变体）。
- **字号修正**：移除半像素 `13.5px` 空态正文（Geist 无 13.5px；归到 `14px` / copy-14）。
- **验证**：`vite build` 正确打包 Geist woff2 资源，`svelte-check` 0 error / 0 warning。范围仅 `apps/desktop`。
- **遗留**：间距尺度（大量 10/14/18/28/30px 偏离 4-8-12-16-24-32）与 <12px 小字号（9/10/11px）未在本轮处理，建议先看真实 Geist 字体渲染效果再决定是否收敛。

### Desktop 侧栏三级菜单层级与间距
- **颜色置换**：对话/项目 一级标题改为 `label-secondary`（更浅，只负责折叠），其下的 channel / 项目子组改为 `label-primary`（更深，才是可点击目标）。
- **去图标**：去掉 对话/项目 一级标题前的图标，仅保留文字 + caret；二级 channel 保留各自图标，主次更清晰。
- **二级缩进**：channel 与项目子组相对一级标题向右缩进 8px。
- **间距收敛到 Geist 尺度**：nav→tree 间距 14→8px、section padding、tree-title/header min-height 34→32。
- **底部设置条规范修正**：高度 46→48px、padding 22→8px（内容与 nav 对齐），去掉全宽负 margin 溢出，footer 与顶部 border 落在 sidebar content box 内，与其它 chrome 一致。
- **验证**：`svelte-check` 0 error / 0 warning，`vite build` 通过。范围仅 `apps/desktop`。
- **遗留**：nav-item（新对话/任务/技能）的 6px 垂直 padding 暂未动，避免改动点击密度；若仍觉得偏松可再收到 4px。

### Project Session 输出安全与显式路由（实施中）
- Project Bash 不再通过 mtime 猜测并搬运项目根文件；压缩后的完整输出写入 Project runtime `tool-output`，普通 Bot 日期归档保持兼容。
- Project `write` 默认写项目根，并支持显式 `target: "scratch"` 写 runtime 日期目录；成功结果返回安全相对路径、root kind、动作与字节数。
- **验证**：Bash/write 聚焦测试 24/24 通过，根项目 production build 通过。ProjectInspection 与 Desktop 文件面板仍待后续切片。
- ProjectInspection 服务端首批接口已落地：懒加载目录、受限文本预览、Git porcelain v2 status 与 `diff HEAD`，包含路径越界/软链接、Git config、pager、超时和输出上限防护。
- Desktop Project 文件面板已接入 **文件 / 变更 / 附件** 三标签：文件和 Git 状态按 Project 全局实时读取，附件严格跟随当前 Session；支持目录下钻、文本/diff/未跟踪文件预览、媒体附件预览与下载、刷新及窄窗口覆盖层。Project 附件读取会校验 projectId 与 sessionId，不再误读普通 Web workspace。
- Project 文件检查已完成安全收尾：目录使用稳定 cursor 并可“加载更多”；Git 超限结果显式标记截断；二进制、超大文件、空仓库、删除文件和大仓库子目录均有明确语义。父仓库路径不会返回 Desktop，跨 Project rename 的外侧来源仅保留布尔标记。
- Project 文件工具统一返回结构化结果：write/edit、图片、视频、语音生成和 attach 均提供安全相对路径/root kind/action（及可用时的字节数），不建设或冒充完整的 per-turn provenance。

### 修复：自动任务执行 Session 泄漏与页面自动刷新
- **修复 sidebar 泄漏**：在 `getOrCreateConversation` 查找或复用已有 conversation 时，如果传入 `origin: "automation"` 但已有会话没有此标记，现在会补写该 origin 标记。这解决了定时任务如果使用 `sessionMode: "chat"` 导致 event 对话泄露到左侧 Web 对话列表的问题。
- **页面自动刷新与可见性监听**：给自动任务（`TasksSection.svelte`）增加了 `onMount` 挂载刷新、浏览器 Page Visibility API（切回标签页时立即更新）以及 30 秒定时轮询机制，让昨日打开的 app 数据在今日任务触发后能自动刷新，解决了页面停滞状态下数据不更新的问题。
- **验证**：通过了 `svelte-check` 检查和桌面 app 全量 33 个单元测试（含 `TasksSection` 单元测试与 Rust 单元测试均 100% 绿灯）。

### 修复：微信等外部渠道 Session 详情提示找不到（Session not found）
- **路径与标识符安全策略放宽**：修改了 `src/lib/server/app/externalSessionsFromContexts.ts` 中的 `isSafeSegment` 函数。从原来只允许字母数字下划线减号点 `^[a-zA-Z0-9._-]+$` 改为允许 `@`, `:`, `+`, `%` 等在第三方聊天平台（如微信 `o9cq803dQf4bT1KSlE1f0Bb8sxmc@im.wechat`）中极为常见且在路径安全防穿透上完全无害的安全特殊字符，解决了点击该类微信 Session 时弹出 "Session not found" 的 bug。
- **验证**：在 `externalSessionsFromContexts.test.ts` 中新增了测试用例，真实模拟并验证了含有 `@` 与 `:` 的外部 chatId/sessionId 能够成功被解析，相关单元测试 100% 通过。

### 修复：微信/飞书/Telegram等外部渠道 Session 文件无法查看及媒体无法预览的问题
- **Desktop UI 支持外部会话文件加载**：在 `apps/desktop/src/ChatView.svelte` 的 `openSession` 中，对于只读外部会话，在打开 external transcript 的同时调用 `refreshFiles(item.botId, item.sessionId)` 以更新文件面板。
- **文件预览与下载关联外部会话上下文**：修改 `openPreview`、`downloadFile` 和 `loadMessageMedia`，当 `viewMode === "external"` 时，从 `channelItems` 动态查找并提取外部会话对应的真实 `botId` 作为 `profileId`，并将 base64 编码的外部 session ID 作为 `sessionId` 发送给 API 端点，防止在外部会话模式下调用文件接口时因 `activeSessionId` 为空而无法预览。
- **消息内联媒体加载与气泡渲染**：给外部 Transcript 的 `ConversationTranscript` 传入了 `attachmentActions={transcriptAttachmentActions}` 属性，使 Svelte UI 的消息列表气泡能正确触发 `loadMedia`，渲染出生成的图片或内嵌播放器。
- **外部消息附件与 Local 路径保留**：更新 `src/lib/server/app/desktopExternalSessions.ts` 中的 `buildDesktopExternalTranscriptMessage`，使其不再丢弃附件的 `local` 相对路径；同时更新 `src/lib/server/app/externalSessionsFromContexts.ts` 的 `buildMessages` 映射器，解码并提取 agent 消息实体中的附件列表（`ConversationAttachment[]`）。这两者让 Svelte 的 `TranscriptAttachments` 能够成功匹配 `filesByLocal` 并触发 `loadMedia`。
- **支持外部渠道的 Web 文件接口**：修改 `src/routes/api/web/files/+server.ts` 的 `GET` 处理，若 `sessionId` 能被解码为有效的 `ExternalSessionRef`，则从 `contexts/` 目录读取 `.jsonl`/`.json` 文件内容，扫描 `scratch/` 目录并将包含在会话历史中的文件作为列表返回，能够按 `fileId` 正确读取并服务对应文件。
- **验证**：修改了 `desktopExternalSessions.test.ts` 中的断言以确认 `local` 相对路径得以保留。运行全仓桌面测试 `test:desktop-chat`（181/181）、外部会话测试（4/4）和 Svelte UI 测试 `desktop:test`（34/34）全部绿灯通过。

## 2026-07-10

### 记忆检索中文分词（记忆改进计划 T1a）
- 新增共享 tokenizer 模块 `package/mory/src/moryTokenize.ts`：`Intl.Segmenter("zh")` 词级切分 + CJK 字符 bigram 兜底（接住 ICU 把「调研」切成「调|研」的场景）+ 中英停用词过滤与单字降权 + 按 query 权重归一，输出 0..1 的 `scoreLexical`。零第三方依赖，不增加桌面打包负担。
- 三处按空格切词的打分统一切换：`moryCore.ts` 与 `jsonFileCore.ts` 的 `scoreByQuery`（消除重复实现）、`classifier.ts` 的 `memoryPriority`（决定每轮 prompt 注入选哪些记忆）。此前中文查询整句成单 token，检索退化为整句子串匹配。
- 纯虚词查询（如「的了吧」）不再可能命中全量记忆；空查询保持列表语义（match-all）不变。
- **验证**：mory 包测试 179/179 通过（含新增 tokenizer 单测 11 项：「短版」命中、「调研」bigram 通道、虚词零分、中英混合、排序断言）；宿主新增 `src/lib/server/memory/classifier.test.ts` 2/2 通过；desktopMemory 与 sessions store 回归 7/7 通过。详见 `docs/requirements/memory-improvement-plan.md` T1a。

### 修复：DuckDuckGo 搜索零结果时的错误提示混淆
- 修复了在搜索工具中，如果搜索引擎正常调用但没有任何结果返回，错误地显示为 "No configured search engine returned results."（未配置任何搜索引擎）的问题。
- 系统现在会区分“成功查询但未找到结果”与“未配置任何可用搜索引擎”两种场景：若至少有一个搜索引擎成功进行了请求但结果为空，将正确显示 `"No search results found."`。
- **验证**：在 `webSearchTool.test.ts` 中新增了对应的单元测试，且全仓 search 相关测试 21/21 顺利通过。

### 修复：Desktop 自动任务写入未监控的 Web scratch 目录
- Desktop Automations 新建任务改为写入 Bot 级 `events/` watched directory，保留原 `chatId` 作为投递目标，不再把 Web 任务写进未被 Web runtime 监控的 chat scratch。运行时启动时会幂等迁移此前误放在 Web scratch 的 JSON 事件，因此已有任务无需手动重建即可重新被共享 scheduler 执行。
- **验证**：Desktop task target 与 Web legacy migration 单元测试 8/8 通过；Desktop `svelte-check` 0 错误/警告。

### Desktop 紧凑自动任务工作区
- Chat 侧的“自动任务”现为可选中的高密度任务列表与独立详情/执行记录面板，而非逐条展开的大卡片；“自动任务”和“技能”侧栏入口会标识当前选中状态。创建、编辑、立即运行、删除、执行会话和分页历史入口保持不变，并遵循共享 Geist token 与窄窗口上下堆叠布局。

### Desktop 动态设置同步与免保存拉取模型
- **多窗口设置动态同步**：引入前端 `BroadcastChannel` 机制监听设置变更。当用户在设置窗口中对自定义服务商（Providers）、模型路由（Models）、配置文件（Profiles）或助手（Agents）进行保存或删除修改时，主聊天窗口接收广播并自动、在非阻塞的状态下重新加载最新的路由配置及下拉选项，解决了“退出设置页面返回 chat 页面不生效，必须重启”的问题。
- **免保存拉取模型支持**：升级 `/api/desktop/provider-models` 接口和前端 Pull Models 机制。支持传递临时配置（`baseUrl`, `apiKey`, `protocol`, `path`），使用当前表单输入进行模型发现，从而让用户在新建或修改服务商配置时，无需先保存即可点击“拉取模型”获取最新的模型列表。
- **验证**：通过了 `svelte-check` 静态类型检查，并通过了桌面前端的 30 个单元测试及 Rust 的 10 个测试。

### Desktop 统一对话与项目侧栏
- Desktop Chat 侧栏现在以两棵可折叠三级树统一展示：`对话 → 渠道 → Session` 与 `项目 → 项目 → Session`。频道、项目和两个一级分组可同时独立展开，展开状态会在重启后恢复；折叠只影响导航，不会切换右侧内容或中断 Agent。
- 项目不再作为独立页面或顶部快捷入口。项目 Session 直接在同一主聊天布局的右侧打开，并以 `项目名 / 会话名` 显示标题；普通和外部渠道会话同样以 `来源 / 会话名` 显示。
- “新对话”和项目内“新对话”现在立即持久化。共享 Session Store 会在 Web Profile 或单个项目范围内复用唯一无消息 Session，避免左侧漏掉 `New Session` 或反复产生空会话；创建失败不写入假条目。
- 删除当前 Session 时会切到同一分组的下一条，分组为空时进入未选择状态而不擅自新建。项目仍保持独立工作目录、运行时与 Session 存储，并继续不出现在普通 Web 列表中。
- **验证**：Desktop `svelte-check` 0 错误/警告；Desktop UI/HTTP + Rust 测试 40/40；Session Store 与 Desktop API 测试 69/69。
- **侧栏打磨（2026-07-10）**：一级“对话／项目”改为与主导航同级的图标标题；项目只保留一个一级标题，移除重复的二级“项目”行。展开箭头和新增按钮默认隐藏，仅在 hover 或键盘聚焦时出现。Session 行限制在 30 个字符宽度内省略，时间与 ⋯ 菜单以带右内边距的右侧覆盖层呈现，侧栏强制禁止横向滚动。项目右侧 Header 移除头像、删除与新建按钮，改用与 Chat 一致的搜索和资源管理器图标。

### Agent harness 优化：缓存前缀稳定、压缩触发修正、工具调用保真、turn 心跳租约
- **memory 快照移出 system prompt**：每轮的工作记忆快照改为注入用户消息信封内的 `<current-memory>` 块（只发给模型、不落库），`runPromptKey` 不再包含逐轮变化的 query/memory 指纹。system prompt 跨轮字节一致，provider 前缀缓存（prompt caching）从此覆盖完整 prompt + 历史消息，不再每轮全量失效。
- **压缩触发改用真实 usage**：`shouldCompactContext` 优先使用最近一条 assistant 响应中 provider 上报的真实 token 用量（input + cacheRead + cacheWrite + output），并以压缩摘要消息的时间戳为屏障，压缩前产生的旧 usage 不会导致压缩死循环。字符估算本身对 CJK 字符按约 1 token/字加权（原 chars/4 对中文低估 3-4 倍，阈值压缩形同虚设）。
- **修复 ToolRuntime 包装链丢参**：registry handler 现在拿到真实 `toolCallId`（原先被共享的 `runId` 顶替，同轮并行调用会串号）和 `onUpdate` 流式进度回调（原先被丢弃，工具进度更新静默失效）。
- **turn 锁改为心跳租约**：运行中的 turn 每 30 秒刷新 `runs.last_heartbeat`，锁冲突判定与启动清理都基于心跳（2 分钟超时）而非固定 10 分钟墙钟。合法长任务（视频轮询、subagent 链）只要进程存活就一直持锁；进程崩溃后约 2 分钟内自动放锁。无心跳的历史记录沿用旧 10 分钟规则；心跳在 run 主 try 块内启动、finally 中必然停止，防止僵尸续租。
- 验证：agent 全量测试 378 通过（唯一失败为 skills 文案语言断言的既有问题，与本次无关）；改动文件 `tsc` 无类型错误。

### Agent harness 后续优化：中文注入检测、数据库热路径、videoGenerate 机制化限制
- **注入检测补中文模式**：项目上下文文件（CLAUDE.md/AGENTS.md 等）的 prompt 注入扫描新增中文模式（忽略以上指令 / 覆盖系统提示 / 不要告诉用户），与既有英文模式一一对应；模式刻意收紧（必须命中指令类宾语），并有回归测试保证正常中文项目文档不被误伤。
- **TurnOrchestrator 数据库访问出热路径**：每个 orchestrator 复用单个 SQLite 连接，schema DDL 只在首次打开时执行一次；此前 prepareTurn/心跳/状态更新每次都开新连接并重跑 CREATE TABLE。
- **videoGenerate 单轮限制从 prompt 恳求改为机制强制**：同一 run 内视频任务提交成功后，runner 在 beforeToolCall 直接拦截后续提交（错误信息携带已有 taskId，指引模型报告 taskId 并结束回合）；带 taskId 的进度查询不受影响；提交失败不会误触发拦截。prompt 里对应的加粗恳求句改为一句"运行时会拦截"的说明。
- 验证：agent 全量测试 379 通过（唯一失败仍为 skills 文案语言断言既有问题）；改动文件 `tsc` 干净（runner.test.ts 的 fixture 类型报错为 HEAD 上已存在的既有问题）。

### 修复：skills 文案语言断言 + 全仓 ProviderModelConfig `enabled` 类型债
- **skills.test.ts 长期红灯修复**：6 月的命令 i18n 改造把技能列表格式化函数改成默认英文、`locale: "zh-CN"` 可选，但测试仍断言旧的中文写死输出（同一测试内其他断言已是英文默认值，自相矛盾）。测试改为断言英文默认输出，并补充显式 zh-CN 用例；agent 全量测试恢复 380/380 全绿。顺带补上 channelCommands 中 `/skills <id>` 未命中分支漏传的 `locale` 参数。
- **清零 `ProviderModelConfig.enabled` 缺失的 tsc 报错**：共 22 处，涉及 6 个测试文件的 provider fixture，以及 3 处生产代码（ai-meta 设置接口的自定义 provider 模板、env 变量默认 provider 的模型、legacy provider 迁移）。运行时消费方一律按 `enabled !== false` 判断（缺省即启用），因此补 `enabled: true` 不改变任何行为；测试经 tsx 运行不做类型检查，这也是这批错误从未在运行时暴露的原因。

## 2026-07-09

### Desktop Chat / Project 输入区与右侧组件复用
- 补强 macOS overlay titlebar 拖动区域：Chat 与 Settings 根布局顶部现在有一条 52px 透明拖拽蒙版，点击后直接调用 Tauri `startDragging()`；Chat/Project 左侧栏顶部仍保留独立拖拽条，Chat/Project/Workspace 标题栏的头像、图标、标题与副标题子元素也参与拖拽；右上角搜索、文件、设置、新建、删除等按钮提升到蒙版之上，保持正常点击。
- 修复 Chat 启动期卡在“正在连接本地会话…”且页面看似不可点击的问题：核心服务配置加载完成后立即释放 loading，默认会话/侧栏列表改为后台选择；侧栏拖拽分隔条在窗口失焦或鼠标离开时会强制结束 resize，避免 `pointer-events: none` 长期留在整页上。
- Chat 与 Project 共享输入框完成紧凑化打磨：焦点态从强蓝双层描边改为轻量提示，外壳上下 padding 收窄，textarea 默认显示更多行并按内容自动增长，发送按钮缩小到与麦克风按钮同一视觉尺寸。
- 修复 Chat 左侧外部渠道图标：飞书和 QQ 不再使用图标库中不存在的 `lark-logo` / `qq-logo`，改用已打包可渲染的渠道图标占位，避免列表里出现空图标。
- 修复 fresh 定时任务会话出现在普通 Chat Session 列表的问题：Desktop conversation 共享查询层现在把 `origin:"automation"` 和 `task-*` 会话归类为 `automation`，继续只在自动任务页面展示，普通侧栏和“更多对话”只返回 `conversation`。
- 修复外部渠道（Telegram/飞书/QQ/微信）旧任务上下文继续混入普通 Session 列表的问题：`contexts/` 投影层现在同时过滤 `origin:"automation"`、`task-*` 和历史 `[EVENT:...]` 首条用户消息，任务运行只留在自动任务历史中查看。
- Chat 右侧 Header 改为单行：头像显示当前 Bot 名称首字而不是会话标题首字，在线/离线状态挪到左下 Molibot logo 徽标上，Header 不再显示在线副标题和设置按钮。
- 把 Desktop Chat 与 Project Chat 的完整输入区收敛到共享 `ChatInputArea.svelte`：模型缺失提示、错误提示、队列 chips、待发送附件、录音条、文件按钮、录音按钮、模型选择和 thinking 选择都走同一组件，之后改输入区不再需要分别改 ChatView 和 ProjectChat。
- Project Chat 输入区现在也传入真实模型名与当前 thinking 档位；不再显示静态“模型/思考档位”，也不再塞入对项目页无意义的 `@Default Web` 或 Project token。
- 抽出 `ApprovalCard.svelte`、`ChatMessagesPane.svelte`、`ChatHeader.svelte`、`PendingFilesBar.svelte`、`QueuedMessagesBar.svelte`、`RecordingBar.svelte` 等通用展示组件；业务判断仍留在调用方，组件只接收数据、slot 和回调。
- Project 页左侧复用通用 sidebar 小组件（`SidebarShell`、`GroupHeader`、`ConversationRow`），但保留项目页语义：顶部只提供“添加项目”，项目分组右侧提供 `+` 新对话，底部提供返回 Chat 与紧凑的 logo 设置入口，不再搬入 Chat 的新对话/项目/自动任务/技能主导航。
- Project 详情头部继续复用 `ChatHeader`，只展示项目名，不再把本机路径放进标题栏；操作按钮改为 Chat 同款图标按钮，避免右上角文字按钮和 Chat 标题栏视觉割裂。
- Chat 与 Project 的侧栏底部品牌入口改为展示 Molibot logo，不再用字母 `M` 占位。
- 验证：外部会话投影测试 3/3、Desktop UI 结构测试 28/28、Desktop `svelte-check` 0 错误 0 警告，Desktop production build 通过。

### 修复：首次打开进入 Project 点击 Session 右侧空白，去 Chat 转一圈才正常
- 首次启动进入 Projects、点击某个 Session 时右侧不显示对话；切到 Chat 再切回来才正常。根因：`ProjectDetail` 用一条 legacy `$:`（`project = projects.find(...)`）来门控整个右侧面板，而 Svelte 5 里 legacy `$:` 不会订阅外部 rune `$state`，所以它只在初始化时跑一次——那时 `projectsStore.projects` 还在加载、结果是 `undefined`，面板一直不渲染，直到组件重新挂载。把 `ProjectDetail` 改为 runes 模式（`$props`/`$state`/`$derived`），派生值现在能正确跟踪 store，项目加载完成后面板立即渲染。验证：`svelte-check` 0 错 0 警告、Desktop UI 测试 24/24。

### Project 对话在独立的项目工作区运行（与 bot 隔离）
- Project 对话现在在独立运行时工作区 `<dataRoot>/projects/<projectId>/runtime` 下执行，不再复用共享的 bot 工作区。其 agent 上下文/transcript 不再泄漏到 `moli-*/bots/<bot>/…/contexts/`；一个 project 的运行时、session、scratch 全部落在自己的项目目录下，与所有 bot 完全隔离。
- 新增 `getProjectRuntimeContext`/`resolveRuntimeContext`/`getRuntimeContextForConversation`：发送、streaming、停止、`/compact`、Host-Bash 审批续跑都会把 project 对话路由到它自己的 store+pool；`SessionStore.getConversationProjectId` 按会话 id 反查所属 project。
- workspace 路径解析器新增 `projects/<id>/runtime` 标记（project 运行时的 dataRoot / memory / 全局 skills 目录都能正确回溯），并用足够具体的正则避免祖先路径里的 `projects` 段被误判。注意：本次改动之前开始的对话仍保留旧的 bot 目录上下文；展示用的历史消息来自 project session 存储，不受影响。
- 验证：workspace 解析测试 4/4、sessions store 测试 3/3、变更文件 `tsc` 无报错。

### profileFiles 支持写全局 / agent 作用域
- `profileFiles` 工具新增 `scope` 参数（默认 `bot`，可选 `global`、`agent`）。`global` 写入 workspace 根目录、被所有 bot/agent 共享的 profile，长期身份/语气/用户信息终于可以正常落全局，不必再用被全局写保护拦截后绕道的 bash。`BOT.md` 在 global/agent 作用域映射为 `AGENTS.md`；agent 作用域仅限 AGENTS/SOUL/IDENTITY/SONG，且未绑定 agent 时报错。同步更新了工具描述和全局 `TOOLS.md` 指引，引导长期 profile 修改使用 `scope:"global"`。
- 验证：profileFiles 工具测试 5/5（含默认 bot、global、BOT→AGENTS 映射、global 读回、无 agent 报错）。

### Desktop Projects 创建流程与 Session UI 对齐
- “添加项目”改为两阶段弹窗：先输入项目名，再选择“自动创建目录”或“使用现有文件夹”。自动模式在用户文稿目录的 `Molibot Projects` 下创建唯一文件夹；只有现有文件夹模式会调用一次系统目录选择器。
- Project Session 列表不再维护单独的行、重命名和删除 UI，直接复用 Chat 的 `ConversationRow.svelte`，因此头像、单行标题/时间、选中态和更多操作菜单保持同一实现。
- 修复首次进入 Projects 或快速切换 Project 时右侧对话不显示：Project 列表与 transcript 请求现在都有选择代次和 Project ID 所有权校验，旧请求不能覆盖当前 Session；页面每次挂载会重载当前 Project，并在 transcript 返回前显示明确的载入状态。
- 验证：Project 并发选择与自动目录测试 4/4、Desktop UI 结构测试 24/24、Svelte 检查 0/0；真实页面在 1280px 与 540px 暗色窗口下检查无横向溢出。

## 2026-07-08

### Desktop 输入框按钮与选择器精简
- 发送快捷键调整以避免误触：现在 Enter 换行、Shift+Enter 发送（运行中为排队跟进），中英文占位提示同步更新。
- 模型 pill 只显示裸模型名（`/` 最后一段），完整的「带 Provider 前缀」名称保留在下拉列表并作为 pill 悬停 tooltip。
- 移除了 composer 里的文件面板切换按钮（右上角标题栏已有相同的打开文件列表功能），左侧工具区只保留回形针（附件）。
- 录音按钮从左侧工具区移到右侧，紧挨发送按钮左边。
- 发送/停止合并为同一个蓝色操作按钮——不再用红色区分停止，两种状态仅用图标区分（纸飞机=发送，方块=停止），并把不好看的向上箭头发送图标换成纸飞机。
- 模型与思考档位两个 pill 现在显示当前所选值（如实际模型名、或「高」），不再显示固定的「模型」/「思考档位」文案。

### Desktop 输入框 Bot 选择改为内联 `@mention`
- 移除了原本压在输入框上方的整条「Bot」选择条，改为在 composer 输入框内部渲染一个紧凑的 `@mention` token，让 Bot 选择与输入框融为一体，不再是独立的一大条。
- 只有一个 Bot 时该 token 显示为静态、不可点选的 `@<Bot>` 标签（无需选择）；有多个 Bot 时，草稿对话默认显示 `@<默认 Bot>`，点击向上弹出带头像+名称的下拉列表切换 Bot（类似 @ 提及）。发送第一条消息后 token 锁定为安静的 `@<Bot>`，并带锁图标提示不可更改。
- 新增 `lib/chat/BotMention.svelte`（runes，支持外部点击/Esc 关闭），删除已废弃的 `BotSelector.svelte`。同时轻度优化无对话时的空状态问候（更大图标、更紧凑标题、淡入动画）。验证：`svelte-check` 0 错误 0 警告。

### 空机器首次启动修复
- 新增内置 `default` Agent，并在默认 Web Profile 上自动关联该 Agent；旧设置中 Agent 为空或默认 Web Profile 未绑定 Agent 时会在 sanitizer/store 层补齐。
- Desktop 首次启动引导新增“个性化”步骤，询问用户称呼与 AI 回复风格，并写入当前默认 Agent 的 `USER.md` / `SOUL.md` 标记区块，不覆盖用户已有内容。
- Provider 创建/编辑/删除/全局默认变更后会通知模型设置页重拉模型；onboarding 保存 Provider 后也立即刷新当前文本模型列表，避免必须重启才能选择新模型。
- Web Search 默认引擎改为 DuckDuckGo，并补齐旧配置缺失的 DuckDuckGo engine 默认值，保留其无需 API key 的可用路径。
- Desktop Automations 现在包含 Web Profile 目标；Web channel runtime 注册到共享 channel registry，Web 提醒/任务继续落地 watched event JSON 并可由事件运行时执行。
- Desktop Chat、项目详情、自动化/技能面板和设置标题区增加 Tauri 拖动区域，修复 overlay titlebar 下窗口顶部不可拖动的问题。

### Desktop 发布版本号与双架构 DMG
- Desktop App 版本源统一为 `apps/desktop/package.json`，构建前自动同步到 `src-tauri/tauri.conf.json`、`Cargo.toml` 和 `Cargo.lock`，避免打包 App 长期显示 `0.1.0`。
- GitHub Desktop Release workflow 改为 matrix 构建 Apple Silicon (`aarch64-apple-darwin`) 与 Intel (`x86_64-apple-darwin`) 两个 DMG，并为每个架构准备对应的 Node 22 sidecar。
- `finalize-desktop-release` 会把产物标准化命名为 `Molibot_<version>_<arch>.dmg`，并生成引用最终文件名的 `.sha256` 校验文件。

### Desktop 聊天侧栏重接与多会话并发（Slice 3）
- 通过新的 `lib/chat/chatSessionStore.svelte.ts`（runes）把 `ChatView.svelte` 接到 Slice 2 的按 Session registry 上。旧的"跟随当前活动会话"的单 `ConversationController` 被移除，每个会话拥有自己固定的控制器：不同 Session 真正并行运行，同一 Session 仍串行并保留自己的 follow-up 队列、审批与停止（方案 §7）。store 把活动会话的实时轮次状态经单一 `state` store 桥接给 legacy `$:` 模板——沿用已验证的 `$conversationView` 模式，只是改为跟随当前查看的会话（记忆 `desktop-controller-legacy-reactivity`）。
- 用新的 `ChatSidebar` / `ChannelAccordion` / `ConversationRow` runes 组件替换旧侧栏（水平渠道切换条 + 按 Bot 二级折叠树）：五个互斥渠道折叠组、每渠道跨 Bot 聚合的最近列表（最多 10 条）、稳定 Bot 头像、且不串会话的实时状态点（running/waiting/completed/failed）。Web Profile 在界面统一显示为「Bot」；外部渠道保持只读（方案 §2/§3）。
- 「新对话」改为进入尚未落盘的草稿，点击不再立即创建空 Session；只有在发送第一条消息时才用 `BotSelector` 所选 Bot 创建并绑定 Session（默认 Bot：上次成功发送的 Bot → 系统默认 → 无则禁用发送）。composer 草稿（文本/附件/Thinking/Bot）按 Session 隔离，切换会话后恢复（方案 §6/§10）。
- 接入「更多对话」`ConversationBrowserDialog`（按 Bot 分组、防抖搜索、每组独立游标分页）与重连恢复：服务就绪后 `GET /api/desktop/session-runs` 恢复 running/waiting 状态点并重载转录，并以 4s 轮询把已结束的运行对账为 completed 状态点（方案 §5/§11）。
- 验证：`chat-ui.test.mjs` 更新为新侧栏/store 设计的断言；`svelte-check` 0 错误 0 警告；Desktop 构建通过；桌面 25/25、聊天单测 14/14、服务端会话查询 12/12 全过。

### Desktop 按 Session 隔离运行状态（多会话侧栏改造 Slice 2）
- 新增按 Session 隔离的运行 registry（`lib/chat/sessionRuntimeRegistry.svelte.ts`）：每个会话拥有自己的 `ConversationController`，且固定绑定到该会话的 `profileId`/`sessionId`，取代此前"跟随当前活动会话"的单控制器。后台轮次继续把流式写入自己的状态，切换会话只改视图绑定、不会重定向或销毁运行中的控制器（方案 §7.1/§7.4），根治了"A 的 token/审批落到 B"的串线问题。
- 每个 registry 条目自持转录、错误、状态与状态点，宿主 adapter 自包含且固定（控制器不再读取可变的"活动"状态）。轮次结束驱动侧栏状态点：后台运行结束记录 `completed`/`failed`（未读绿/红，打开后消除），活动会话结束则置 idle（结果内联展示，不留未读点——方案 §8.2）。`restoreFromRuns` 在重连后从 `GET /api/desktop/session-runs` 恢复 running/waiting 状态，且不覆盖正在进行的前端轮次（方案 §11）。
- 新增 `lib/chat/sessionDraftStore.ts`（按 Session 保存输入文本/附件/Thinking/已选 Bot，仅内存——方案 §10.3）与 `lib/chat/sessionStatusDot.ts`（纯状态与状态点推导）。纯逻辑 14 条单测覆盖；runes registry 通过 `svelte-check`（0 错误 0 警告）。

### Desktop 共享会话与运行状态接口（多会话侧栏改造 Slice 1）
- 新增共享查询层 `src/lib/server/app/desktopConversations.ts`，为即将到来的 Desktop 侧栏与多会话导航提供数据底座。跨所有 Web Profile 与外部 Bot 实例聚合普通会话，解析 Bot 身份与名称（含已删除 Bot），并提供稳定的 `updatedAt + sessionId` 游标分页与「标题 / Bot / 最近消息摘要」搜索；分页、聚合、过滤全部在共享上层完成，不落入任何 Channel。
- 新增三个接口：`GET /api/desktop/conversations` 返回某渠道最新倒序、跨 Bot 聚合的会话列表（默认 10 条，带游标与 `hasMore`）；`GET /api/desktop/conversations/groups` 返回「更多对话」弹窗所需的按 Bot 分组视图，每组独立游标；`GET /api/desktop/session-runs` 从 runtime `runs` 表（并结合审批 broker）返回活动中的 running / waiting-for-approval 运行，服务端解析出 Web profileId，使 Desktop 重连后能恢复真实会话状态而非依赖前端内存。
- `SessionStore` 新增 `listAllWebConversations()` / `getWebConversationOwner()`；`ExternalSessionEntry` 新增 `preview` 字段。共享层统一计算 `purpose`（`conversation | project | automation | diagnostic | test`），侧栏只取 `conversation`，把项目/自动任务/诊断/测试会话排除在列表外，避免把分类判断复制进各渠道或多个 UI 组件。
- 验证：新增 12 条单测（含插入新会话时游标不重复不遗漏、搜索、分组、已删除 Bot 分组、跨 Profile 聚合）；`svelte-check` 0 错误 0 警告；`api.test.ts` 65/65 通过。

## 2026-07-07

### 本地服务端口动态递增
- `serverPort` 改为首选起始端口；启动时若已占用，Desktop supervisor 与独立服务都会按 `3000 → 3001 → 3002` 顺序寻找第一个可用端口。
- 实际 endpoint 继续写入 runtime state 并通过 Desktop handshake 自动发现，前端无需依赖固定端口，也不会把临时回退端口覆盖回设置。
- 验证覆盖端口选择单测、Desktop Rust 回归，以及真实占用起始端口后的完整服务启动与握手。

### Desktop Chat 自动吸底（跟随最新消息）
- 聊天记录现在会像正常聊天一样跟随最新内容：当阅读位置在底部时，流式 token 与新追加的消息会持续把最新一行保持在可视区；打开会话或切换会话时直接定位到最新一条消息，而不是停在长历史的顶部。
- 一旦用户向上滚动去看历史，自动跟随立即暂停，不会被强制拉回底部；当用户再次滚动回到底部（48px 阈值内）时自动重新开启跟随。
- 实现为共享的 `use:stickToBottom={sessionId}` Svelte action（`lib/chat/stickToBottom.ts`），`ChatView` 与 `ProjectChat` 共用：scroll 监听维护"是否吸底"状态，`MutationObserver` 在吸底时跟随子树变化，会话 id（key）变化时强制跳到最新。替换了此前无视阅读位置、也不跟随流式增长的 `scrollToBottom()`/`afterMutate` 无条件滚动。

### 修复 Desktop Chat 思考/结果不流式（要等整轮结束才一次性显示）
- 现象：桌面 Chat 在一轮对话过程中什么都不显示，思考过程与结果 token 都在最后一次性蹦出来。经诊断打点确认 SSE 传输本身完全正常（token/thinking 事件是逐个、隔秒到达的），根因是前端响应式：`ChatView.svelte` 与 `ProjectChat.svelte` 是 legacy 模式组件（`export let` + `$:`），legacy `$:` 采用编译期依赖追踪，只有引用的顶层 `let` 被重新赋值时才重跑。`$: streamingText = chat.streamingText` 这类别名永不更新——共享 `ConversationController` 的 runes `$state` 走 Svelte 信号系统，legacy 追踪器看不见；只有整轮结束后的 `reload()`（重新赋值 legacy transcript `let`）才触发渲染，于是表现为"最后一次性输出"。
- 在 `conversationController.svelte.ts` 新增 `readonly view = toStore(() => ({...}))`，把实时轮次状态（`sending`、`streamingText`、`streamingThinking`、`activity`、`activities`、`pendingApproval`、`queue`）打包成可订阅的 Svelte store。两个宿主组件改用 `$conversationView` 自动订阅，流式状态恢复响应式。约定：任何新增的 legacy 模式聊天界面都必须通过 `$view` 读取实时状态（或改为 runes 模式），不能在 `$:` 里直接读 `controller.foo`。
- `ConversationLiveView` 的实时思考卡片改为 `open={!streamingText}`：模型思考时展开并流式，一旦结果开始输出即自动折叠，实现"思考流式 → 折叠 → 结果流式"的预期交互。
- 验证：`svelte-check` 0 错误 0 警告；`api.test.ts` 65/65 通过。

### macOS App 图标正式接入打包
- 保留现有巴哥犬主体构图，将深色底板改为浅暖色，并生成带真实透明外角的 macOS 圆角图标。
- 从同一源图生成 512px PNG 与 ICNS，Tauri bundle 显式声明这两个资源，统一用于 App、Dock、Finder、托盘和 DMG。

### macOS Desktop 空机器首次启动自举
- Desktop 生产 runtime 改为版本化归档随 App 发布，supervisor 首次启动时原子解包到数据目录缓存；不再依赖目标 Mac 已安装 Node、npm 包或已有 `~/.molibot`。
- 修复 release 清单遗漏 `service-port.mjs`，并将 Adapter Node 运行时实际依赖的 `@sveltejs/kit` 纳入 production dependencies。
- 共享 runtime 在 DB 初始化后幂等生成 `AGENTS.md`、`BOOTSTRAP.md`、`IDENTITY.md`、`SOUL.md`、`TOOLS.md`、`USER.md` 六个内置模板；已存在文件保持原样，用户设置、密钥、历史和角色内容不会从开发机复制。
- 验证覆盖 Profile 不覆盖、runtime 归档解包/复用，以及真实归档在隔离空数据目录下启动后生成设置、SQLite 与 Profile 文件。

### 外部会话查看器改为从 Agent `contexts/` 派生
- Desktop“外部会话”只读查看器（telegram/feishu/qq/weixin）的列表与 transcript 现在直接从 Agent 的 `contexts/` 存储派生，不再依赖单独的 legacy `~/.molibot/sessions` 扁平副本。外部渠道每轮对话不再向该冗余、无限增长的存储双写；Web 与 Project 会话不受影响。
- 新增 `src/lib/server/app/externalSessionsFromContexts.ts`：位于 app 上层的只读投影，按渠道工作区枚举每个可见 Agent session，映射为既有的 `ExternalSessionEntry`/transcript 结构，排除 `automation`（`task-*`）会话，并用不透明的 base64url id 承载身份（`{channel,botId,chatId,sessionId}`）。两个 `/api/desktop/external-sessions` 路由改用它；Desktop 前端无需改动（id 端到端本就是不透明的）。
- 将 legacy `SessionStore` 的外部写入路径置为惰性（`writeLegacySession` 空实现；`createConversation` 的外部分支不再落盘/写索引），并移除已失效的 `listExternalSessions()` / `getExternalSession()` 读接口。无需数据迁移——`contexts/` 已保存完整历史；现存的 `~/.molibot/sessions/*.json` 变为孤儿文件，验证后可手动归档/删除。
- 分层：投影只读、仅访问 `contexts/`，放在 app 上层（与 `desktopExternalSessions`/`conversationThinking`/`desktopRunHistory` 一致），不穿透 Channel↔Agent 边界。
- 验证：新增 `externalSessionsFromContexts.test.ts`（列表投影、automation/空会话排除、内容块文本提取、非法/穿越/缺失 id 处理）与更新的 `sessions/store.test.ts`（外部渠道不再落盘、Web/Project 存储不受影响）；`tsc` 类型检查 0 错误。

## 2026-07-06

### Desktop Chat 连续对话流
- Assistant 的 thinking、工具活动和最终回复改为同一内容列中的连续信息流：移除头像与回复卡片，thinking 和工具明细保留折叠能力但不再使用独立卡片容器。
- 用户消息继续右对齐，背景从强调蓝改为 `DESIGN.md` 的 Geist 中性色 `gray-100`，暗色主题使用 `gray-200`，文字与边框继续使用语义 token。
- 修复回复完成并 reload 后 thinking 消失：Desktop session API 现在从 Agent context 的结构化消息读取 thinking，按前置用户消息匹配轮次，并聚合工具调用前后的多段 assistant reasoning；历史会话无需迁移或重复写入即可恢复显示。
- 该共享渲染同时作用于本地 Chat、Project Chat、外部只读 transcript 和自动任务会话详情；Desktop Svelte 检查 0 错误，chat UI 回归测试 23/23 通过。

### Desktop 周期任务可视化计划编辑器
- 自动任务创建与编辑不再要求普通用户直接输入 Cron；提供每天、每周多选、每月指定日期和自定义 Cron 四种周期计划，统一生成现有五段 Cron 并继续通过 watched-event JSON 运行时落地。
- 旧任务中的简单 Cron 自动回显为对应可视化模式；步进、范围、限定月份或日期/星期组合等复杂表达式自动进入自定义模式并原样保留，避免编辑时数据丢失。
- 周多选、月末缺失日期提示、生成结果、交付方式和会话模式均提供中英文人类可读文案，并适配明暗主题、键盘焦点与窄窗口两列布局。
- 创建目标不再枚举 Bot 文件目录或提供含义不明的“工作区”：服务端直接读取已启用渠道实例的 `allowedChatIds`；前端拆为 Bot 与“发送到”两级选择，右侧只显示该 Bot 明确允许的 Chat ID。空值和重复 ID 会被清理，禁用 Bot、Web、内部目录和未配置 ID 均不会出现；已有工作区任务仍可查看和编辑。

### 修复周期任务永久卡在 running 状态
- 修复周期（cron）任务会永久卡在 `running` 的问题：当一次触发因同 `taskId` 的兄弟任务仍在运行而被判定 `task_already_running` 跳过时，`dispatchEvent` 已通过周期运行锁把事件文件写成 `running`，但跳过分支直接 `return`、从不释放该锁，导致文件永远停在 `running`。新增 `releasePeriodicRunLock`，在跳过时释放运行锁并将该时间槽标记为已消费，使文件复位为 `pending`（不增加 `runCount`）。
- 修复启动恢复忽略孤儿 `retry_wait` 租约的问题：`recoverStaleRunning()` 原先只回收 `running` 租约，导致重试从未被拾起的 `retry_wait`（如进程在重试等待期间退出）永久保持“活跃”，并因 `taskId` 可跨事件共享而通过 `hasActiveForTask` 永久阻塞所有兄弟任务。恢复逻辑现在也会回收超期（超过一个完整 timeout 窗口）的 `retry_wait`，标记 `stop_reason = 'retry_abandoned'`。
- 说明：多个互不相关的周期事件共用同一个通用 `taskId`（如 `"explicit"`）会经由 `hasActiveForTask` 被当作互斥；应给每个独立任务分配不同 `taskId`，避免误判 `already running` 而跳过。
- 修复既有单测 `late successful event completion suppresses timeout retry outcome` 的 pre-existing 失败：该用例本想验证“超时先触发、run 之后才成功”时结果仍为 success 且 `onTimeout` 只调用一次，但它用 `createLease(store, 5)` 申请 5ms 超时，而 `acquire` 会把 `timeoutMs` 钳到 1000ms 下限（早于用例存在），导致 20ms 的 run 永远先于超时完成、`onTimeout` 从不触发。改为在调用 `runAttemptWithTimeout` 时用 `{ ...lease, timeoutMs: 5 }` 显式给出低于 run 时长的超时，真正复现该竞态；生产逻辑无需改动。
- 租约库不再静默钳制：当调用方请求的 `timeoutMs` 低于 1000ms 下限、或 `maxAttempts` 小于 1 时，`acquire()` 与 `recordSkipped()` 会通过 `momWarn` 打出 `eventLease/timeout_below_floor`、`eventLease/max_attempts_below_floor` 警告（附 `eventFile`/`runId`/请求值/实际值），把“毫秒被下限吞掉”这类踩坑显式暴露出来。
- 验证：新增 `events.test.ts`（跳过时释放文件运行锁）、`eventsLeaseStore.test.ts`（回收超期 `retry_wait`、低于下限时钳制并告警）回归用例；`events`+`eventsLeaseStore`+`tools/event` 三个测试文件共 16/16 全部通过。

### 任务 taskId 全局唯一且可读
- taskId 生成格式改为可读的 `<slug>-<4位随机>`（如 `ai-news-daily-8x2k`），取代原 `task_<uuid>`；`createEventTaskId(slug?)` 会对可选名称做 slug 化并追加随机后缀。
- `createEvent` 工具现在为每个新建事件盖上唯一 `taskId`，并保证与同一 Bot `events/` 目录下已有事件不重复；新增可选 `name` 参数用于指定可读 slug；按 chatId+schedule+timezone 命中的周期任务更新时保留原 `taskId`，保持执行历史关联。
- `createEvent` 文件名改为带随机后缀（`event-<ts>-<rand>.json`），避免同一毫秒创建的两个事件互相覆盖。
- 将现有 `moli_news_bot` 任务从共享/通用标签迁移到唯一 id：`explicit`/`explicit`/`news` → `ai-news-daily-*`、`ai-daily-report-*`、`news-daily-*`（旧 id 下的历史执行记录仍在租约库中，但不再归属到改名后的任务）。
- 验证：新增 `tools/event.test.ts`（可读唯一 taskId、目录内去重、周期更新保留 id、无名回退 `task-` slug、文件名去重）5 个用例全部通过；`desktopTasks`/`taskSessions` 等既有任务用例保持 13/13 通过。

## 2026-07-05

### Desktop Projects：外部真实目录与独立多会话
- Desktop 新增 Projects 工作区，可注册经过服务端安全校验的外部目录、创建多个项目会话并直接聊天；删除项目时明确区分注册记录和 Molibot 会话记录，项目真实目录永不被删除。
- 独立 `ProjectStore` 与项目 session 存储把元数据限制在 Workspace 的 `projects/<projectId>/`；项目工具 cwd 指向 rootPath，memory、runlog、scratch、附件与审批仍走 Workspace/runtime。
- 最终提示词按 AGENTS.md → AGENT.md → CLAUDE.md 发现项目工作规范，保留身份与不可覆盖安全层，并执行注入扫描和 20k 截断。
- Projects UI 使用独立 runes store/组件、共享 `ConversationTranscript`、中英文本、明暗主题 token 与窄窗口布局。
- 验证：聚焦存储/路径/prompt/runner 测试、`test:desktop-chat`、Desktop `svelte-check`（0/0）、Desktop/Rust tests 与 production build 全部通过。
- 修复 Desktop HTTP capability 只允许 `/api/settings` 精确路径、导致 Projects 请求在到达服务端前被 Tauri 拒绝的问题；新增 Projects 嵌套路由 scope 契约测试。
- 添加项目使用两阶段创建弹窗：先输入名称，再选择自动创建唯一目录或使用已有文件夹；仅已有文件夹分支调用一次 Tauri/macOS 原生目录选择面板。
- Projects 导航改为项目与会话一体的树状侧栏，移除独立会话列；修复新项目添加后没有首个会话、必须重启才能进入聊天的问题。
- 删除 Project Chat 的独立 stream/消息/composer 实现，改为与普通 Chat 共享 conversation turn、实时活动/思考展示和输入外壳；项目发送仅补充 projectId。
- 修复项目 Session 切换后右侧共享对话区域收缩不可见的问题，历史消息与空会话状态现在均占满详情面板。
- 抽取共享会话控制器 `lib/chat/conversationController.svelte.ts`（`ConversationController`，`$state` 承载 sending/streaming/activity/approval/queue，统一 send/stop/resolveApproval/queue/drain 逻辑），通过 host 适配器注入各自的 endpoint/profile/session/projectId、乐观消息与 reload/refresh 钩子。`ChatView` 与 `ProjectChat` 均改为实例化该控制器：ChatView 保留富 composer（文件、模型、思考等级）并以 `$:` 只读别名复用既有模板，`runDesktopConversationTurn` 只在控制器内被调用一次。
- 修复点击项目 Session 右侧不显示对话：`selectProjectSession` 现在捕获并上报加载错误而非静默失败；新增 `refreshProjectSessionList` 在发送完成后只刷新会话标题/排序、不再把选中会话跳回最近会话，从而在原会话就地重载消息。
- 项目会话列表直接复用 Chat 的 `ConversationRow.svelte`，共享单行标题/时间、头像、选中态、重命名与删除确认菜单，不再维护第二套相似 UI。
- Chat 与 Project 会话删除统一改为 popover 二次确认，替换原先“点垃圾桶后再点一次垃圾桶”的不明显交互；新增 `deleteConversationTitle`/`deleteConversationHint` 中英文案。
- 新增项目会话 rename/delete 服务端：`renameProjectConversation`（project 存储直写，绕过 web index 查找）、`deleteProjectConversation`，对应 `PATCH`/`DELETE /api/settings/projects/[id]/sessions/[conversationId]` 与桌面 API `renameDesktopProjectSession`/`deleteDesktopProjectSession`。
- Projects 页面使用组件实例级 endpoint 标记，每次进入页面都会重载当前 Project，同时避免同一挂载周期重复加载。
- Project composer 与 Chat composer 对齐：补齐模型选择、思考档位、附件、录音（Tauri 原生 + 浏览器 fallback），复用 `.composer-wrap` 样式与 `ChatComposerShell`，并通过 controller host 适配器接入 `thinkingLevel`/`canSend`/`appendUserMessage(files)`。
- 修复首次打开 App 从 Chat 进入 Projects 页、第一次点击 Session 右侧消息不切换的竞态：Project 列表与 transcript 分别使用递增请求代次，并同时校验 Project ID、Session ID；任何旧 Project/Session 响应都不能接管当前右侧对话。
- Projects 页 UI 与 Chat 页统一为真实共享实现：`ProjectsView`/`ProjectDetail` 继续复用 Chat 外壳与头部，Project Session 直接渲染 `ConversationRow.svelte`，删除重复的行内编辑、操作按钮与 popover DOM/CSS。
- 优化侧栏分组（Project / Bot / Agent）与会话列表的层级观感（`.conv-group`，Chat 与 Projects 共用）：展开三角 `.conv-caret` 从组标题左侧移到最右侧（`.conv-group-label` 改 `flex:1` 把 caret 与计数/只读标推到右端）；会话行 `.conversation-row` 与 `.conv-new-session` 左缩进 26px，并在展开时由 `.conv-group::before` 画一条纵向引导线（收起时自动隐藏），一眼可见其从属分组；并移除会话行图标 `.conversation-tile`（缩进 + 引导线已足够表达从属关系，图标反而造成与分组图标的主次倒置，冗余无价值）。
- 验证：扩展 sessions store 测试覆盖 `renameProjectConversation`/`deleteProjectConversation`；Project store/选择并发测试覆盖自动目录与跨 Project 过期响应；Desktop `svelte-check`（0/0）、Desktop chat-ui 测试（24/24）通过。

### 可配置服务端口与桌面托管重启
- Web 系统设置与 Desktop 常规设置均可配置服务端口，默认 3000，保存范围为 1024–65535。
- 独立启动脚本和 Desktop supervisor 在启动前读取持久化端口；Desktop 可“保存并重启”，Web 重启接口仅对 Desktop 托管服务开放。
- Desktop 重启保留托管边界，不会从页面终止无法自动拉起的外部服务；修改端口后 supervisor 使用新端口启动并刷新实际 endpoint。
- 验证：服务端 production build、Desktop `svelte-check`、Rust supervisor 测试和端口读取单测通过。
- 修复 Desktop HTTP capability 未放行共享 `/api/settings`，导致端口读写在到达服务端前报 `url not allowed on the configured scope`；新增 capability 契约回归测试。
- 保存端口前检查 loopback 监听占用；目标端口已被其他进程使用时返回 409 和明确错误，不再保存后由 supervisor 静默换成随机端口。
- Desktop 重新启动后会依据 service-state 与 handshake 的双重托管标记接管仍在运行的 sidecar PID，保持 `managed` ownership；“保存并重启”不再因误判 external 而禁用。

## 2026-07-04

### Settings API 按模块拆分与 Desktop/Web 存储去重
- 单体 `/api/settings`（GET 返回全量 `RuntimeSettings`、PUT 接受任意 patch）已退役并删除；通用兜底 `dynamic/[key]`（此前零校验直接 `updateSettings`）已被摘除，所有页面切片都有了带 sanitize/validate 的专用端点：`/api/settings/locale`、`/api/settings/mcp`、`/api/settings/skills`、`/api/settings/skill-drafts`、`/api/settings/plugins`、`/api/settings/system`、`/api/settings/sandbox`、`/api/settings/web-search`、`/api/settings/image-generate`、`/api/settings/video-generate`、`/api/settings/tts-generate`、`/api/settings/agent`、`/api/settings/channel-instance?channel=xx`、`/api/settings/ai-routing`、`/api/settings/custom-providers`、`/api/settings/model-switch`、`/api/settings/profile-files`；前端五个页面（search/image/video/tts/sandbox settings）同步迁移到各自的端点，彻底消除 `runtime.updateSettings({[key]: rawBody})` 脏写面。
- 端点间持久化逻辑抽到 `src/lib/server/settings/handlers/`（纯函数，注入 `SettingsAccessor`，便于单测与 Web/Desktop 复用）；对应切片的字段校验（agent 引用、skill draft 路径、cloudflare 插件、timezone）集中到 `src/lib/server/settings/validators.ts`，web 与 desktop 路径共用同一套校验，修复“desktop 绕过 web 校验”的历史漂移。
- 切片级 sanitizer 从单体 `sanitizeSettings` 中抽出（`sanitizeSingleAgent`、`sanitizeSingleChannelInstance`、`sanitizeModelRoutingConfig`、`sanitizeModelFallback`、`sanitizeCompaction`、`sanitizeAiRoutingConfig`），供 handler 与原单体路径共享；custom-providers 端点改为经 `sanitizeSettings` 正规化后再落盘，修复此前 POST/PUT 直接写对象、不跑模型列表/verification/tags 正规化的问题；`/api/settings/model-switch` 只更新所选模型路由，不再意外覆盖独立配置的全局 `providerMode`。
- Web 设置页逐页迁移到新端点（mcp、skills、skill-drafts、plugins、system、agents、web/feishu/telegram/qq/weixin、ai/routing、ai/providers、根页模型切换器、i18n setLocale）；根页 Chat 的模型切换从“PUT 整个 settings 大对象”改为 POST `/api/settings/model-switch`，运行时设置加载改由 `/api/settings/custom-providers` + `/api/settings/ai-routing` + `/api/settings/channel-instance?channel=web` 组合。
- `src/lib/server/settings/handlers/` 现已覆盖 agents、channels、aiRouting、customProviders、plugins、skills、locale、mcp、system、skillDrafts、mediaGenerates（web-search/image/video/tts）所有切片持久化；Desktop 端 `plugins`、`skills`、`agents`、`channels`、`profiles`、`providers`、`model-routing`、`mcp`、`sandbox` 路由全部改为走同一套 handler 做持久化（保留 `buildDesktopXxxSummary` 这种“去掉凭据/绝对路径后再返回给 WebView”的投影 DTO 不变）；plugin memory 保存会保留 embedding、反思、通知和 daily materials 字段，Desktop 服务端口也迁到 `/api/settings/system` 并继续执行范围与占用校验；`upsertCustomProvider` 新增 `{activateAsDefault, switchToCustomMode}` 选项支持 desktop 创建即激活场景。
- `parseProviderModelIdsResponse` 与整个 `/models` 拉取+解析流水线（URL/headers 拼装、HTTP 错误处理、JSON 解析）一并抽到 `src/lib/server/providers/customProtocol.ts` 的 `listProviderModels()`，web/desktop 两个 `/provider-models` 端点只负责各自的凭据来源（request body vs 已保存 provider）；消除 ~30 行复制代码，HTTP 错误统一用 `ProviderModelsError` 携带状态码。
- 路由页不再把 `customProviders` 大列表回写服务器（providers 管理完全交给 `/api/settings/custom-providers`），channel/agent 页面的设置保存不再提交全量 settings 大对象。

### Desktop Chat 工作区 DESIGN 审计与一致性修正
- 使用真实 Chat、Automations、Skills 截图对照 `DESIGN.md` 完成组合 UX/可访问性审计，证据与报告保存在 `docs/audits/chat-workspace-2026-07-04/`。
- Skills 新增即时搜索、无结果状态和可展开的三行说明；卡片按自身内容高度排列，不再被同一行最长描述撑出大片空白；导航名称从“技能广场”收敛为实际能力“技能”。
- Chat 媒体加载失败不再把重复的技术 404 错误抛到输入框上方；通用 assistant 失败文案按当前语言提供原因方向和下一步，composer 错误使用可关闭的 alert 结构。
- Chat 全局交互补齐双层 `:focus-visible` 焦点环，主导航/会话行提升到 40px，渠道入口扩大并减少标签截断；真实最小窗口可触发的紧凑断点从 680px 调整为 820px。
- Automations 收敛装饰圆环、重阴影和自造圆角，统一到 6px/12px Geist 半径与共享轻阴影；单行任务不再重复任务正文，执行状态完成中英本地化。

### Desktop 自动化任务完整管理与执行记录分页
- macOS Automations 工作区现在提供周期任务创建、搜索、编辑、删除、批量操作和立即运行；创建目标使用受限的 channel/Bot/chat/scope 契约，任务仍通过共享 watched-event JSON 运行时落地。
- 任务卡片默认只展示计划、状态、上次执行时间与最近 3 次运行，完整执行历史按需展开；历史由 SQLite 按时间倒序、每页 10 条真实分页查询，并继续支持打开只读执行会话。
- 页面采用紧凑管理卡片、运行状态标识、创建弹窗和响应式分页控件，支持中英、明暗主题与窄窗口；任务变更或手动运行后会失效旧历史缓存，避免展示过期数据。
- 自动化视觉进一步收敛为 Geist 控制台：总览、运行指标、搜索和创建组成统一 command deck，任务意图、Cron、运行目标与最近状态分层展示；完整执行记录改为独立分页弹窗，不再撑开任务卡片，创建与编辑也统一使用独立编辑弹窗。

### Desktop 自动化 Session 列表隔离修复
- Desktop 外部渠道 Session 列表现在在共享 `SessionStore` 边界排除 conversation key 末段为 `task-*` 的 fresh 自动化会话；历史自动化记录无需迁移即可立即隐藏。
- 自动化 transcript 仍可通过执行记录按 conversation id 打开，过滤只影响普通左侧导航，不删除会话或运行记录。
- 根级 `desktop:dev` / `make desktop-dev` 现在先构建共享 Server，再启动 Tauri dev，避免 Desktop 管理进程继续加载过期的 `build/index.js`。

### Desktop Chat 共享媒体与工具执行展示
- `ConversationTranscript` 统一负责已完成消息中的图片、音频、视频、普通文件与工具执行展示；本地 Chat、历史会话、外部渠道只读会话和自动任务详情不再维护各自的展示逻辑。
- 图片通过受保护文件接口加载为可回收 Blob URL，直接内联展示并沿用预览操作；音频、视频使用原生播放器，加载、失败重试、窄屏、明暗主题和中英提示使用共享语义样式。
- 流式与带附件的非流式 Chat 共用 `ConversationActivityCollector`：工具开始/结束合并为一个稳定条目，结果随 assistant 消息持久化；实时与历史均使用可折叠的纵向执行视图，不再显示重复的横向诊断标签。
- 纯媒体消息隐藏 `(attachment)` / `(empty response)` 运行时占位文本，不再出现空白气泡；工具失败使用独立的中英文状态标题，避免误报为“已完成”。
- 验证：Desktop `svelte-check` 0 error / 0 warning；服务端与 Desktop 相关单测 76/76；UI 结构回归 12/12。

## 2026-07-03

### Desktop 自动任务会话对话化展示
- 修复自动任务执行会话把 Agent `content` 内容块直接展示为 JSON 的问题，覆盖内容块数组、单个内容块 JSON 字符串和整组内容块 JSON 字符串；服务端与 Desktop 客户端双层兼容旧响应，只提取 user/assistant 的 `text`，过滤 thinking、system、toolCall/toolResult，同时保留用户真正输入的普通 JSON。
- “查看会话”弹窗不再维护 `task-session-*` 平行消息样式，直接复用 Chat 页的 `message-row`、`message-avatar`、`message-stack`、`message-bubble`、Markdown 和时间结构，消除 Molibot 的两套展示身份。
- 完成真正的共享模块抽取：本地 Chat 历史、外部渠道只读会话、自动任务会话统一调用 `ConversationTranscript`，附件统一调用内部 `TranscriptAttachments`。后续修改已完成消息的 Markdown、头像、气泡、时间、thinking、附件、搜索高亮或已读状态，只需修改一处。

### Desktop Chat 工作区导航与幂等新对话
- “新对话”会切回 Chat、展开当前 Web Profile、清空 Session 筛选并定位到当前新 Session；当前 Session 仍为空时重复点击会复用，不再堆积空 Session。
- “自动任务”和“技能广场”不再打开独立 Settings 窗口，而是在保留左侧渠道/Bot/Session 导航的前提下切换右侧工作区。
- 技能工作区展示 Desktop 安全投影返回的全部已安装/已发现技能，包括全局、Bot 和会话级自动生成技能；本轮不包含技能安装或市场能力。
- Chat 工作区路由、技能列表与新对话判定已拆到 `lib/chat/`，为继续拆分超大 `ChatView.svelte` 建立稳定边界。

## 2026-07-02

### Desktop Session 侧栏层级与最近活动排序
- Bot/Profile 分类行与 Session 行改为接近的紧凑密度，分类标题和图标适度放大、Session 图标和行高收紧，保持中英、明暗主题和可变侧栏宽度兼容。
- 切换渠道或首次加载时不再自动展开第一个 Bot/Profile；所有分类默认折叠，只有点击分类才展开，再次点击可收起。
- Web 与外部渠道 Session 均按 `updatedAt` 倒序展示；外部聚合服务和 Desktop 客户端各自显式排序，旧会话产生新消息后会回到所属分类顶部。

### Agent 工作方法论
- 根 `AGENTS.md` 新增第一性原理与交付前对抗式审查规则：先明确根本问题并拆成可验证单元；所有决定说明原因；交付前主动攻击最可能翻车的 3～5 个点，修正后提供验证证据。

### Desktop 设置页全量 Geist 对齐
- 按 `DESIGN.vercel.md` 对 Desktop 设置页做了一次全量 Geist 对齐：移除 6 色 macOS 强调色选择器与侧栏每项的 macOS 着色图标（Geist 只用单一 blue-700 强调色，由主题 token 统一管理），侧栏改为单色。
- 设置样式里所有硬编码 macOS 系统色（iOS 红/绿/蓝/紫/灰 与 Material 红）全部替换为 Geist token（`--danger`/`--online`/`--accent`/`--chart-purple`/`--gray-*`）；状态点、开关、状态徽章、模型校验态、外部渠道 / 首启 / 健康检查视图、侧栏底栏在浅/深色下都改由 token 取色。
- 圆角统一到 Geist 6/12/16/9999 体系（控件 6px、卡片 12px、药丸 9999px），替换掉散落的 4/5/7/8/9/10/11/18px。
- 字号字重对齐 Geist：字重仅保留 400/500/600（原 450/550/650/680/700）；半像素字号（13.5/12.5/11.5/10.5/9.5/14.5px）取整。
- 统一按钮变体 —— primary（gray-1000）、secondary（白底带边框）、tertiary（透明）、新增 error（red-800）—— 全部 32px 高、6px 圆角；危险态 secondary 统一红色 hover 蒙层。下拉选择简化为单 chevron 并补齐 disabled 态（gray-100 底、gray-700 文字、not-allowed）。
- 验证：Desktop `svelte-check` 0/0、`chat-ui.test.mjs` 8/8、production build 通过。Chat 视图（会话/消息/输入框/文件）仍沿用旧 macOS 色，留作下一个 slice。

### Desktop 聊天 UI：Geist 颜色对齐
- 完成 Chat 视图（`apps/desktop/src/styles.css` + `ChatView.svelte`）的 Geist 对齐：所有 iOS chrome 字面量改为 token。`rgb(60 60 67 / X%)` 标签灰按透明度映射到 `--label-primary`/`--label-secondary`/`--label-tertiary`（95/85→primary，65–80→secondary，30–55→tertiary）；`rgb(120 120 128 / X%)` 系统灰 hover/底色映射到 `--fill`/`--fill-hover`；iOS 红 `rgb(255 59 48 / X%)`、橙 `rgb(255 149 0 / X%)` 映射为 `--danger`/`--warning` 的 `color-mix` 蒙层。
- 文件类型 tint（image/video/audio/file）改由 `--online`/`--accent`/`--chart-purple` 经 `color-mix` 派生，不再用裸 iOS 蓝/绿/紫。给 chart-KPI 与实体编辑器阴影去蓝偏（`rgb(28 38 68)`/`rgb(12 16 26)` → 中性 `rgba(0,0,0,X)`），并调淡会话 tile 阴影。
- 新增显式 `--code-bg`/`--code-text` token（浅/深色均固定为深底），让 markdown 代码块与审批字段代码在深色下也正确显示，替换掉 iOS `#f2f2f7` 文字字面量；清理 10 处 `var(--sidebar-surface, rgba(...))` 死回退为 token。
- `ChatView.svelte`：把内联样式的只读提示改为语义类 `.external-readonly-notice`；通用渠道 tile 兜底色板由 iOS 系统色调改为 Geist 强调色阶（blue-700/purple-700/pink-700/amber-700/green-700/teal-700）。渠道品牌色（`CHANNEL_COLORS`：Telegram/微信/Discord/Slack/QQ…）作为合法语义身份保留，不改。
- 验证：Desktop `svelte-check` 0/0、`chat-ui.test.mjs` 8/8、production build 通过。剩余：安装 Geist Sans / Geist Mono 字体。

### macOS 自动化任务执行记录与会话入口
- macOS app 的 Chat 侧栏“自动化任务”入口现在作为独立 Automations 面板使用：Desktop `/api/desktop/tasks` 只投影周期定时任务，one-shot/immediate 任务继续保留在 Web `/settings/tasks` 诊断页，不出现在 macOS 自动化列表。
- 周期 event JSON 会获得稳定 `taskId`；后续定时触发、手动“立即运行”和跳过记录都能按 taskId 关联到同一个任务。
- 共享 event lease SQLite 记录扩展为自动化执行历史：记录 running/retry_wait/completed/failed/aborted/skipped、attempt/maxAttempts、runId、sessionId、错误和停止原因；同一任务禁止并发运行，已有执行未结束时新触发写入 skipped 记录而不启动第二个 Agent。
- fresh 定时任务创建的 Agent session 会写入 automation 来源元数据，并从普通 `/sessions` 会话列表隐藏；任务执行记录可在 macOS app 中打开只读 session 详情，若 retention 已清理则展示会话已清理状态。
- Desktop Automations UI 支持中英、多主题 token、窄窗口兼容的执行记录列表和 session 详情弹层，保留编辑、立即运行、删除等原有任务管理能力，且不暴露真实 event JSON 路径。
- Desktop Automations 可兼容仍在运行的旧本地服务响应：前端会自行剔除 one-shot/immediate 并补齐缺失的执行记录数组；加载失败只显示错误，不再进入无限重试加载。
- Automations 工作区默认只显示搜索、简要统计和紧凑任务列表；只有显式选择任务后才打开可关闭的详情面板。每行同时展示计划、状态、累计执行次数和上次执行时间。
- “立即运行”改为任务级运行状态：运行中的任务在列表和详情按钮各自显示转动指示，其它任务仍可选择、暂停或立即执行，不再被全局 busy 状态锁住。
- 周期任务支持持久化启用/暂停；暂停状态写入 watched event JSON，事件 watcher 不会调度已暂停任务，恢复后无需重新创建任务。
- 自动任务写入 Web 会话时会保留 `automation` 来源标记，因此即使使用非 `task-*` 的会话 id，也不会混入普通 Session 列表；会话行右侧时间覆盖层带有与当前表面一致的背景，长标题不再与时间重叠。
- 验证：`apps/desktop` `svelte-check` 0/0；`desktopTasks.test.ts` 4/4；`apps/desktop/src/lib/api.test.ts` 57/57；根级 `tsc --noEmit` 当前仍受仓库既有类型错误阻塞，过滤本次涉及文件无新增错误。

## 2026-07-01

### pnpm workspace 与共享依赖存储
- 根应用与 `apps/desktop` 已从 npm 双锁文件迁移为统一 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`；`packageManager` 固定 pnpm 11.7.0，开发机上的不同 workspace/项目通过 pnpm 内容寻址 store 复用相同包内容，降低重复依赖的磁盘占用。
- 根命令、Desktop/Tauri 命令、发布目录组装、Docker 构建、GitHub Desktop Release workflow、Makefile 和 agent 测试入口均改用 pnpm；CI 使用一次 frozen workspace install，不再分别安装根目录和 Desktop 依赖。
- Makefile 及其调用的根/Desktop/Mory 嵌套脚本均通过 `corepack pnpm` 调用项目固定版本，不再依赖全局 `pnpm` 是否已加入 shell PATH；仍可用 `PNPM=/path/to/pnpm` 显式覆盖 Make 入口。
- 保留现有 `@mariozechner/pi-web-ui` 的 URL 间接依赖兼容配置；npm 锁文件已移除，安装入口统一为 `corepack enable && pnpm install`。


## Implemented Features
| ID | Feature | Status | Notes |
|---|---|---|---|
| DOC-01 | V1 PRD baseline | Done | Must/Later scope and acceptance criteria defined |
| DOC-02 | V1 architecture baseline | Done | Architecture aligned to Telegram + CLI + Web only |
| DOC-03 | Two-week sprint plan | Done | Week-by-week deliverables and checkpoints defined |
| DOC-04 | Telegram tech decision (`grammY`) | Done | V1 Telegram adapter library fixed as `grammY` |
| DOC-05 | Persistence tech decision (`SQLite`) | Done | V1 session/message persistence changed to SQLite |
| DOC-06 | Documentation cleanup | Done | Removed redundant docs and added file-purpose navigation in `readme.md` |
| DOC-07 | Global SOUL profile tone optimization | Done | Rewrote `~/.molibot/SOUL.md` with decisive, concise, non-corporate voice and explicit direct-answer constraints |
| DOC-13 | Plugin authoring and installation tutorial | Done | Added a full plugin tutorial covering plugin types, current support boundaries, how to write/install/enable built-in plugins, manifest limits for external plugins, and a Cloudflare HTML publish demo |
| DOC-18 | Subagent sandbox research spec | Done | Added `docs/research/sandbox/subagent-sandbox.md` covering users, competitor patterns, functional boundaries, target data structures, page interactions, non-goals, and phased acceptance criteria for the next sandbox/subagent product iteration |
| ENG-01 | Unified message router implementation | Done | Shared message router now lives at `src/lib/server/channels/shared/messageRouter.ts` with validation, rate limit, and shared pipeline |
| ENG-153 | Agent hierarchy settings and prompt overlays | Done | Added reusable agent settings, agent-linked bots, in-page Markdown editors for agent/bot profile files, and runtime prompt layering `global -> agent -> bot` |
| ENG-190 | Shared inbound task ownership above channels | Done | Inbound queue ownership, queue commands, and resume flow now live in shared runtime helpers instead of per-channel queue wiring |
| ENG-191 | Shared text-task execution skeleton | Done | Feishu/QQ/Weixin now reuse one shared task-execution skeleton for session append, runner acquisition, and lifecycle cleanup so channel files stay focused on platform adaptation |
| ENG-192 | Queue success auto-cleanup | Done | Inbound tasks and outbound sends are now deleted from SQLite immediately after success; only pending/running/failed work remains for recovery and retry |
| ENG-278 | Model failure log center | Done | Failed model calls are now written to a dedicated error log store and visible from Settings / AI / Model Error Logs, including failure reason, channel/bot scope, and whether fallback recovered the run |
| ENG-279 | Web chat and settings consistency pass | Done | Unified the web chat shell and settings shell around one visual theme, added locale-aware settings navigation/overview, removed several hard-coded status strings, and improved main-page hierarchy, empty states, quick actions, and composer polish |
| ENG-280 | Mom-t readable colored logs | Done | Default `[mom-t]` console output now uses a human-readable single-line format (`prefix + time + scope + event + key fields`) with ANSI event colors, while `MOM_LOG_PRETTY=0` restores JSON output for machine parsing |
| ENG-281 | Explicit model fallback policy | Done | Added configurable model fallback policy (`off` / `same-provider` / `any-enabled`), defaulted runtime fallback to same-provider, excluded disabled providers from STT/vision fallback, and aligned routing settings options with backend model-switch resolution |
| ENG-282 | AI Providers maintenance UX | Done | Providers settings now use an earlier two-pane layout, independent provider-list scrolling, collapsed built-in model lists, and clearer thinking/reasoning configuration guidance |
| ENG-283 | Unified AI model-pool settings UX | Done | AI Routing now presents built-in and custom models as one mixed capability routing pool, with provider management cross-links, compatibility fallback demoted from the primary flow, and theme-aware responsive panels shared with the Providers page |
| ENG-284 | Desktop-style Web chat UI | Done | Reworked the main Web chat into a desktop agent shell with denser conversation navigation, message-stream chat layout, toolbar composer, and a default-collapsed right Files workspace placeholder |
| ENG-285 | Shared Web locale switching and settings translation fallback | Done | Added a shared locale store for Chat and Settings, made the settings overview react to language changes, and added a dictionary-backed Settings layout translation layer for still-hardcoded English pages |
| ENG-286 | Custom provider thinking-format compatibility | Done | Custom providers can choose provider-specific thinking formats, old `thinking-type` settings migrate to `deepseek`, and DeepSeek-style custom endpoints send `thinking.type` plus mapped `reasoning_effort` |
| ENG-287 | Web chat Markdown rendering and latest-message scroll | Done | Assistant responses in Web chat now render Markdown through `marked` with a constrained HTML allowlist, and chat history/streaming updates scroll to the newest content |
| ENG-288 | Legacy orphan tool-result cleanup | Done | Runner now drops orphan tool-result messages that no longer have a preceding assistant tool call, preventing strict OpenAI-compatible providers from rejecting old sessions |
| ENG-289 | Pi-mono DeepSeek v4 upgrade | Done | Upgraded pi-mono packages to `0.70.2`, uses built-in DeepSeek v4 models and upstream `deepseek` compat, and removed Molibot's redundant DeepSeek payload patch/auto-disable path |
| ENG-290 | Explicit TypeBox runtime dependency | Done | Added `@sinclair/typebox` as a direct dependency so agent and plugin tool schemas do not rely on pi-mono's transitive dependencies during production builds |
| ENG-291 | Line-aware edit tool diff | Done | Added direct `diff` dependency and upgraded the agent `edit` tool to return context-aware line diffs for insertions/deletions while keeping existing path guardrails |
| ENG-292 | Telegram separated run display messages | Done | Telegram now keeps tool/progress, aggregated run details/errors, and final assistant answers in separate messages; tool progress renders as icon + tool name + bounded summary |
| ENG-293 | AI usage observatory redesign | Done | Rebuilt `/settings/ai/usage` into a denser Chinese usage dashboard with request/token summary cards, time-series charts, token-type distribution, API/model/bot/channel breakdowns, and raw usage event details sourced only from existing usage records |
| ENG-294 | AI providers and errors settings polish | Done | Moved Providers save/default-model controls to the top of the editor, made newly added providers and models appear first, and redesigned Model Error Logs into a failure-radar console with summary cards, filters, provider ranking, and detailed failure records |
| ENG-295 | Tool-budget partial answer preservation | Done | Runner now preserves streamed assistant text when a run fails after hitting the tool-call budget, appends the budget notice to the first answer, starts one no-tool continuation in a new message where supported, and tells the user to manually continue if more work is needed |
| ENG-296 | Shared pi-mono subagent delegation | Done | Added a shared `subagent` tool backed by `@mariozechner/pi-coding-agent` isolated sessions, reusing the four upstream-style roles (`scout` / `planner` / `worker` / `reviewer`) with single/parallel/chain delegation modes so long codebase tasks can spill into independent tool budgets instead of exhausting the parent run; default pretty logs now show subagent start/end plus per-subagent task start/end so operators can tell when work is executing in a delegated child session |
| ENG-297 | Shared `/stop` queue-backlog cancellation | Done | Shared channel `/stop` now aborts the active run and cancels same-scope pending queued tasks in Telegram/Feishu/QQ/Weixin, so queued follow-up prompts do not keep executing after a user explicitly stops the conversation |
| ENG-298 | Shared live run control commands | Done | Added shared `/steer <text|queueId>` and `/followup <text|queueId>` commands above the channel layer, wired them into the live runner via `Agent.steer()` / `Agent.followUp()`, taught busy channels to reply with a queued task id for already-sent follow-up messages, and hardened `/stop` into a true hard-abort path that clears any still-queued live corrections before aborting |
| ENG-299 | Molifin gold daily serial search hardening | Done | Hardened the Molifin gold daily scheduled workflow to run the four fixed searches through one `run_gold_daily_searches.py` wrapper with fixed 60-second per-engine timeout, strict serial execution, automatic engine fallback, and aligned V7 scheme/event/render defaults so the task no longer launches fragile 30-second parallel searches |
| ENG-300 | Shared prompt parallelism policy refinement | Done | Updated the shared system-prompt tool policy so parallelism is recommended only for local read-only low-risk calls, while remote/network/search steps with timeout or fallback coordination are explicitly steered toward sequential or tightly limited parallel execution; added a focused prompt regression test |
| ENG-301 | Tool-budget runtime notice isolation | Done | Tool-budget exhaustion during no-tool continuation now records a structured session `runtime_event` code (`RUN_TOOL_BUDGET_EXHAUSTED`) for debugging, while stripping the transient `[runtime notice] ... Do not call tools.` control prompt from persisted conversation history so later turns in the same session do not inherit a fake no-tools restriction |
| ENG-302 | Queue notice only for real pending tasks | Done | Telegram/Feishu/QQ/Weixin now announce `Queued as #...` only when the just-enqueued inbound task is still in `pending` state after insertion, instead of showing a queue id for messages that immediately transition into execution and were never meaningfully waiting in line |
| ENG-303 | Per-message env time injection with configurable timezone | Done | Runner now wraps each live user prompt in a structured `<env>` block (`message_received_at` / `timezone` / `today`) before model invocation, rewrites saved context back to the raw user message plus attachment markers to avoid prompt pollution, and exposes validated runtime timezone editing in `/settings/ai/routing` |
| ENG-304 | Shared workbench UI system | Done | Added a shared `workbench.css` design layer for hero/panel/form/table/config-shell primitives, moved the four AI settings showcase pages off page-local `<style>` blocks, and aligned the rest of Settings plus Web chat onto the same material/spacing/interaction language without changing behavior |
| ENG-305 | Usage dashboard cache hit ratio observability | Done | `/settings/ai/usage` now computes prompt-cache hit ratio as `cacheRead / (input + cacheRead)`, shows the current ratio as a KPI card, and plots its time trend so operators can see whether cache reuse is actually effective within the selected window |
| ENG-306 | Usage range-switch auto refresh | Done | Clicking `今天 / 昨天 / 最近 7 天 / 最近 30 天` on `/settings/ai/usage` now immediately re-fetches fresh usage stats instead of only changing the local tab state, so the window summary and generated-at timestamp stay current without requiring a second manual refresh click |
| ENG-307 | Web chat file workspace and general upload support | Done | Web chat now supports general file upload beyond images, records session attachment metadata, exposes a new `/api/web/files` read-only workspace API, and upgrades the right-side files pane into a searchable current-session file workspace with inline preview/download/copy-path flows for common formats |
| ENG-308 | Custom provider Anthropic protocol support | Done | Custom AI providers now persist a protocol choice (`openai-compatible` or `anthropic`), expose it in `/settings/ai/providers`, test Anthropic Messages API connectivity/capabilities, and route Anthropic custom models through `anthropic-messages` transport including vision fallback payloads |
| ENG-309 | Dedicated vision route precedence and recovery notice | Done | Image turns now prefer an explicitly configured vision route over a separate text route that also declares `vision`, and recovered vision-model failures send a user-visible notice before continuing on the fallback model |
| ENG-310 | Verified custom vision transport gate | Done | Custom-provider image turns now send images through the native model transport only after that model's `vision` capability has passed verification; declared-but-unverified vision models and fallback candidates expose text-only transport and use the direct image-understanding fallback payload instead, keeping image transfer format simple and provider-test aligned |
| ENG-311 | Queued attachment image rehydration | Done | Shared channel queues now rebuild image `imageContents` from workspace-relative attachment paths before invoking the runner, so queued Telegram/QQ/Weixin/Feishu image messages can enter vision fallback instead of only exposing a file path to the model |
| ENG-312 | MiMo Anthropic message role compatibility | Done | Anthropic custom-provider runner and image-fallback requests now keep system instructions in the top-level `system` field when the provider protocol is `anthropic`, log redacted fallback request bodies by default, and include MiMo's `api-key` header alongside the standard `x-api-key` |
| ENG-313 | Weixin SDK upstream protocol sync | Done | `package/weixin-agent-sdk` now includes upstream Weixin lifecycle notification APIs, sanitized `bot_agent` metadata, QR-login pairing-code/redirect handling, and focused API regression coverage |
| ENG-314 | QQ SDK upstream parity sync | Done | `package/qqbot` is aligned to upstream QQ Bot SDK v1.7.1 source-level capabilities, including group policy metadata, quoted-message context support, approval interaction plumbing, slash-command handlers, typing/streaming helpers, STT attachment processing, chunked media upload, upload cache, SSRF-guarded downloads, and safer media error mapping while Molibot keeps shared queue/session orchestration above the channel layer and keeps `/bot-upgrade` in doc-only mode unless explicitly configured |
| ENG-315 | QQ SDK Molibot direct-mode runtime guard | Done | `package/qqbot` now respects Molibot's `onEvent` direct gateway mode by skipping OpenClaw runtime preflight, SDK approval gateway startup, SDK slash-command interception, and per-message `getQQBotRuntime()` lookup, preventing reconnect storms with `QQBot runtime not initialized` |
| ENG-316 | Source-free production release and auto update | Done | Added release-bundle packaging, GitHub fetch/build/switch/restart automation, Docker production image support, direct `qrcode-terminal` production dependency coverage, and service-script `MOLIBOT_APP_DIR` control so production can run from build artifacts instead of a source checkout |
| ENG-317 | Interactive deployment manager CLI | Done | Added `molibot manage`, a lightweight prompt-based manager for configuring GitHub deployment, installing/updating, start/stop/restart/status/log viewing, and guarded runtime-file uninstall without deleting `DATA_DIR`; update/release paths now refuse to overwrite unmanaged non-empty directories |
| ENG-318 | Web version visibility and update check | Done | Web UI top bar now shows the current Molibot version and a read-only update check panel backed by `/api/version`, using GitHub metadata when configured and directing operators to `molibot manage` without triggering updates or restarts from the browser |
| ENG-319 | System settings page and readable version badge | Done | Added `/settings/system` for language, runtime timezone, and read-only GitHub/deployment version information; enlarged the Web top-right version badge so the running version text stays visible |
| ENG-320 | Default GitHub deployment source | Done | Deployment update, `molibot manage`, and `/api/version` now default to `https://github.com/gusibi/molibot` on branch `master` when no custom GitHub source is configured |
| ENG-321 | Release tooling bootstrap for old checkouts | Done | `bin/molibot-update.sh` now injects the current release/service/manage scripts into managed source clones that do not yet contain release tooling, and release packaging self-heals missing root runtime dependencies such as `qrcode-terminal` and `mpg123-decoder` so first install from older GitHub commits can still build a release bundle |
| ENG-323 | Lightweight service watchdog | Done | `bin/molibot-service.sh` now starts a small supervisor process that restarts the Molibot child process after unexpected exits, while `stop` writes an explicit stop marker so manual stops do not trigger auto-restart |
| ENG-324 | Weixin image-message delivery repair | Done | Weixin outbound image files now use the shared `weixin-agent-sdk` media protocol path, and single image URLs / Markdown image replies are downloaded and delivered as native Weixin `IMAGE` messages instead of plain links |
| ENG-325 | Weixin channel-local progress/error compaction | Done | Weixin now sends the first tool progress notice immediately, batches later tool progress notices in groups of five, and buffers intermediate tool/model errors so only the latest error is sent when the run ends without a normal visible answer |
| ENG-326 | QQ channel-local progress/error compaction | Done | QQ now sends the first tool progress notice immediately, batches later tool progress notices in groups of five, and buffers intermediate tool/model errors so only the latest error is sent when the run ends without a normal visible answer |
| ENG-327 | Providers 批量拉取模型与一键加入 | Done | `/settings/ai/providers` 为 Custom Provider 新增“开始”批量拉取 `/models`，并在拉取结果中提供逐条 `+` 按钮将模型快速加入当前 provider |
| ENG-328 | Provider 模型保存去重兜底 | Done | 修复同一 provider 下重复 model_id 导致 `/api/settings` 保存触发 `settings_custom_provider_models(provider_id, model_id)` 唯一键冲突；保存流程现在跳过空模型和重复模型 |
| ENG-329 | Telegram typing 超时非阻塞化 | Done | `setTyping` 的 `sendChatAction(typing)` 连续超时时仅记录告警日志，不再中断主 run 流程并误触发整轮 `run_exception` |
| ENG-330 | Settings shadcn-svelte migration baseline | Done | Added shadcn-svelte configuration and generated source-owned UI components, then migrated `/settings/system` and `/settings/web` to shadcn-style Card/Button/Input/Badge/Alert/NativeSelect/Switch/Textarea composition while leaving the chat page unchanged |
| ENG-331 | Skill Draft metadata normalization | Done | Automatic and manual skill draft creation now routes frontmatter metadata through a skill-creator-aware normalizer, producing concise reusable workflow names instead of raw user messages like retry prompts or complaint text |
| ENG-332 | Skill Draft metadata subagent | Done | Added the built-in `skill-drafter` subagent and wired automatic Skill Draft saves to try isolated subagent metadata generation before falling back to the local normalizer |
| ENG-333 | Dated scratch artifact folders | Done | Ordinary chat scratch artifacts now default to `scratch/YYYY/MM/DD/` through per-message env metadata, `write` basename routing, bash root-artifact relocation, and `$MOLIBOT_SCRATCH_ARTIFACT_DIR`, while `scratch/events` remains the watched runtime event directory |
| ENG-334 | Agent bash OS sandbox support | Done | Added opt-in OS-level sandboxing for main agent `bash` and built-in subagent `bash`, with workspace env-file allowlist injection, host-app bypass blocking, diagnostics, `/settings/sandbox`, and `bash (sandbox)` tool-output display markers; Browser, Computer Use, ACP, MCP, and channel delivery remain outside this first sandbox boundary |
| ENG-338 | `molibot manage` TTY disconnect guard | Done | The interactive deployment manager now treats terminal read `EIO` during `readline` prompts as a graceful prompt shutdown, so closing or detaching the controlling TTY exits the menu cleanly instead of throwing an unhandled Node `Interface` error |
| ENG-340 | Cross-channel subagent execution notices | Done | Subagent runs now emit shared `subagent_execution` UI events for run/task start/end, the parent runner turns them into transient progress notices, Telegram status rendering consumes them natively, Web streaming surfaces them in live diagnostics, and Feishu/Weixin/QQ inherit the same shared visibility path without moving delegation logic into channel adapters |
| ENG-345 | Non-interactive host approval fallback for Weixin and QQ | Done | Added a shared host-approval text fallback formatter for channels without native approval buttons, wired Weixin/QQ runner event sinks to send explicit approve/reject instructions instead of misleading button wording, and added `/hosttools reject <approvalId>` so multi-pending text fallback can resolve both actions explicitly |
| ENG-346 | Persistent single-command and one-time multi-command host approval split | Done | Host approval now distinguishes reusable single-executable approvals from one-time compound shell approvals: single commands still persist into `approvedTools`, multi-command scripts become exact one-time host actions that execute once after approval and are never promoted into the reusable host whitelist; resolved approvals also move out of `pendingApprovals` into dedicated history so pending lists only show real waiting items |
| ENG-347 | Cross-channel archived run details and success-collapse display | Done | Runner now writes per-run structured detail logs under each chat workspace, shared commands expose `/runlog latest|<runId>` for later inspection and prefer returning archived logs as `.txt` files on chat channels that support file upload, Telegram rewrites successful `运行详情` threads into one archive notice and now sends final answers/archive notices as replies to the user’s source message, and QQ/Weixin/Feishu append the same concise archive notice instead of leaving bulky success-path execution details in chat history |
| ENG-348 | Host approval waiting-state stop reason split | Done | Waiting for sandbox host approval is now a first-class runner stop state instead of reusing generic `aborted`: the current turn pauses in `waiting_for_approval`, Telegram no longer sends a misleading `Stopped.` terminal reply, and the temporary waiting prompt is kept out of Telegram session history so approval/resume semantics stay consistent |
| ENG-349 | Sandbox env precedence and missing-key audit | Done | Sandboxed env injection now resolves allowlisted keys from both host env and `.env.sandbox.local` with env-file values taking precedence, runtime startup logs missing allowlist keys, and `/settings/sandbox` diagnostics surface missing entries without exposing values |
| ENG-350 | WeRead skill env preflight and request/error discipline | Done | The global WeRead skill now requires an actual `printenv WEREAD_API_KEY` preflight before claiming the key is missing, forbids re-labeling server-side `用户不存在`/鉴权 failures as local env absence when the key exists, and requires surfacing the real `api_name` plus final JSON body/error context on failed WeRead calls |
| ENG-351 | Approved host tool shell parity | Done | Reusable approved host tools now execute the original approved command through the same shell-style path as bash instead of direct structured argv, so normal shell expansion such as `$WEREAD_API_KEY` works consistently while sandboxed commands still use the sandbox path when no host approval matches |
| ENG-352 | Telegram group mention trigger repair | Done | Telegram loads the bot username before polling and recognizes group/supergroup mentions from Telegram message entities as well as raw `@username` text, so direct mentions trigger consistently while replies to bot messages continue to work |
| ENG-353 | Subagent artifact directory and approval inheritance | Done | Built-in subagents inherit the parent message's dated scratch artifact directory and Host Bash approval context, route worker `write` outputs and subagent `bash` artifacts into that directory, move modified root-level artifact files, and bubble new approval prompts through the parent runner's existing channel approval UI |
| ENG-354 | Host Bash approval friction and context hygiene | Done | Session-only approvals can execute pending actions without a durable whitelist entry, QQ/Weixin/Web share the approval execution path, duplicate same-run approval events are suppressed, long subagent outputs are compressed before returning to the parent model context, and host approval env inheritance was restored in the 2026-05-25 hotfix |
| ENG-355 | Host Bash execution-path display labels | Done | Runner start/end events, diagnostics, and run detail now show `Host Bash` for approved Host Bash direct execution and session-approved host fallback, while reserving `Sandbox` for actual OS sandbox execution and `Sandbox disabled` for sandbox initialization soft-disable |
| ENG-356 | Agent session failure-turn persistence parity | Done | Agent session persistence now follows Pi/Pae-style message-boundary semantics: user prompts are saved at run start, assistant error/partial messages and tool results are appended as they happen, transient runtime notices stay out of normal history, and model retry/fallback can isolate error assistant messages without deleting audit history |
| ENG-357 | Sandbox-off Host Bash full access | Done | Effective `/sandbox off` now means Host Bash full access for the current scope: ordinary `bash` and model-supplied `hostApproval` parameters run directly on the host without creating Host Bash approval requests, while sandbox-on approval behavior remains unchanged |
| ENG-341 | Settings shell and first-screen hierarchy unification | Done | Reworked the shared `/settings` shell around one warmer editorial frame aligned to `DESIGN.md`, tightening left-nav hierarchy, top chrome, page-hero treatment, content width, card surfaces, and primary action styling so settings pages enter with one consistent first-screen structure without rewriting each page's business logic |
| ENG-342 | Settings header compactness and softer dark-card borders | Done | Tuned the shared settings shell so ordinary page headers stay compact instead of expanding into oversized hero blocks, and reduced card-border contrast across settings pages, especially in dark mode where the old bright outline felt crude |
| ENG-343 | Card primitive border softening | Done | Replaced the shared shadcn `Card` primitive's `ring-foreground/10 ring-1` outline with a softer semantic border and lighter shadow so cards stop reading as black-edged/light-edged boxes across settings and other reused surfaces |
| ENG-344 | Tasks page text overflow hardening | Done | Tightened `/settings/tasks` so badges wrap, table headers and cells can break long text, action buttons fit their column, and the table uses fixed column widths instead of letting long file paths/status strings blow out the layout |
| ENG-335 | Telegram live-control command registration fix | Done | Telegram now registers shared `/steer`, `/followup`, `/follow_up`, and `/queue` commands before the busy-message enqueue path, so `/steer <queueId>` promotes the existing queued task instead of being queued as a new message |
| ENG-336 | Manual compact keep-window false negative | Done | Manual `/compact` now forces a summarizable older slice when the configured `keepRecentTokens` is larger than the current context, while automatic threshold compaction continues to honor the keep-recent setting |
| ENG-337 | Chat-first host tool approval | Done | Added chat-first host capability approval for sandbox escape cases, shared chat confirmation via `安装` / `批准` / `approve`, persisted pending/approved host tool registry, internal runtime execution of approved fixed commands through structured argv, and bash-level routing/prompt rules that forbid using sandbox bash as a host-tool bypass |
| ENG-339 | Concise sandbox labels and Weixin multiline tool batches | Done | User-facing sandboxed bash displays now show `Sandbox` / `Sandbox disabled` instead of longer `bash (sandbox)` markers, and Weixin batched tool-progress notices are formatted as explicit multi-line lists instead of collapsing multiple calls into one dense line |
| ENG-317 | Subagent model routing and visibility | Done | Added a dedicated subagent model route plus Claude Code-style subagent model levels (`haiku` / `sonnet` / `opus` / `thinking`), read-only built-in subagent inventory on Agents settings, Web run-trace tool diagnostics, subagent-aware Telegram progress display, and 20-character Telegram tool summaries |
| ENG-322 | Subagent early-delegation budget strategy | Done | Parent runs now explicitly delegate codebase-heavy work before the 24-tool hard limit and inject a transient subagent recommendation after 12 parent tool calls when no subagent has been used yet |
| DOC-14 | AGENTS runtime error-handling policy | Done | Added a project-level AGENTS rule requiring temporary model-control prompts, user-visible channel notices, and persistent debugging records to stay separate: transient runtime controls must not persist as normal session history, persistent diagnostics must use non-contextual structured error/event codes, and detailed human-readable explanations should be sent only through the client/channel response path |
| DOC-15 | Documentation role separation and maintenance workflow | Done | Clarified which project rules belong in `AGENTS.md`, which records stay in `prd.md` / `features.md`, and how `README.md` / `CHANGELOG.md` should be kept in sync after each meaningful change |
| DOC-16 | DESIGN-driven page change governance | Done | Added a long-lived rule that any page/UI change must follow `DESIGN.md`, while keeping detailed design tokens and component guidance in `DESIGN.md` instead of duplicating them into `AGENTS.md` |
| DOC-17 | shadcn-first UI component governance | Done | Added a long-lived rule that page/UI changes should prefer `shadcn-svelte` and `src/lib/components/ui` unless that component system truly cannot implement the requirement, avoiding drift back to ad hoc non-shadcn components |
| DOC-18 | Agent v2.1 simplification execution plan | Done | Created a short-term execution checklist for ACP removal, Workspace, TurnOrchestrator, ToolRuntime, approval scope, sandbox rules, and settings split; the process checklist has since been removed from the main docs tree |
| ENG-348 | Minimum Workspace boundary | Done | Added a SQLite-backed `workspaces` registry with default `personal` bootstrap, workspace resolution fallback, and `workspaceId` propagation into new channel/Web messages and run summary/detail archives without moving existing session files |
| ENG-02 | Telegram adapter implementation | Done | `src/adapters/telegram.ts` built with `grammY` |
| ENG-03 | Web chat implementation | Done | SvelteKit chat page + API (`src/routes/+page.svelte`, `src/routes/api/chat/+server.ts`) with `pi-web-ui` |
| ENG-04 | CLI adapter implementation | Done | `src/adapters/cli.ts` interactive loop |
| ENG-05 | SQLite session/message persistence | Done | `src/db/sqlite.ts` + `src/lib/server/sessions/store.ts` |
| ENG-06 | pi-mono runtime integration | Done | `src/lib/server/providers/assistantService.ts` now calls `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` directly |
| ENG-07 | SQLite driver compatibility fix | Done | Replaced `better-sqlite3` with built-in `node:sqlite` for Node 25 compatibility |
| ENG-08 | Web chat model selector scope control | Done | Chat page disables model selector dropdown and avoids showing unconfigured model catalog |
| ENG-09 | Web chat uses backend runtime model settings | Done | Web `pi-web-ui` stream now proxies to `/api/chat`, so custom provider/model from Settings is applied |
| ENG-10 | Web chat send reliability and controls restore | Done | Restored model/thinking selectors and changed stream error handling to render visible error message instead of silent failure |
| ENG-11 | Web chat custom-provider store initialization fix | Done | Initialized `CustomProvidersStore` in AppStorage to fix model selector `getAll` runtime error |
| ENG-12 | Web chat editor-null send fallback | Done | Added send fallback when `message-editor` reference is missing to prevent crash on send |
| ENG-13 | AI settings multi-provider architecture | Done | Runtime settings now support multiple custom providers and default custom provider selection |
| ENG-14 | Settings information architecture split | Done | Settings split into hub (`/settings`), AI page (`/settings/ai`), Telegram page (`/settings/telegram`) |
| ENG-15 | PI provider selectable dropdown | Done | Added server-provided PI provider/model metadata and dropdown selector for PI provider/models |
| ENG-16 | Web IndexedDB store migration fix | Done | Bumped Web UI IndexedDB version to create `custom-providers` store and fix store-not-found runtime error |
| ENG-17 | Web IndexedDB forced clean schema rollout | Done | Switched Web UI local DB name to `molibot-web-ui-v2` to avoid stale schema from old browser cache/state |
| ENG-18 | Backend settings JSON persistence | Done | Runtime settings are now stored in `data/settings.json` (single file) instead of SQLite |
| ENG-19 | Backend session-per-file persistence | Done | Each chat session is now stored as one JSON file under `data/sessions/<conversationId>.json` with index mapping |
| ENG-20 | Web storage backend without IndexedDB | Done | Replaced browser IndexedDB backend with in-memory storage backend to avoid browser DB persistence |
| ENG-21 | Web session list from backend JSON | Done | Added backend session APIs and chat-page session selector/new-session actions backed by JSON files |
| ENG-22 | Session title from first user message | Done | Session title now persists in backend JSON and auto-updates from first user message summary |
| ENG-23 | Chat model dropdown from backend config | Done | Disabled built-in model catalog selector and added model switcher sourced only from backend settings |
| ENG-24 | Chat response streaming UX improvement | Done | Assistant stream now enters immediate streaming state and outputs at a visible incremental cadence |
| ENG-25 | Chat real-time render fallback hook | Done | Added page-level agent event subscription to force UI updates for user/assistant messages and streaming container |
| ENG-26 | Telegram mom-t core modules | Done | Added `src/mom/*` core modules (runner/store/tools/events) for Telegram mom implementation |
| ENG-27 | Telegram mom-t scheduler | Done | Added file-based events watcher (`immediate`/`one-shot`/`periodic`) under `data/telegram-mom/events` |
| ENG-28 | Telegram mom-t attachment pipeline | Done | Added Telegram attachment download + image-context injection into agent prompt |
| ENG-29 | Telegram default path switched to mom-t | Done | `src/adapters/telegram.ts` now uses mom runner/queue/stop/events by default, still driven by Web settings token/chat id |
| ENG-30 | Telegram mom-t observability logs | Done | Added structured run-level server logs for inbound message, queue lifecycle, runner/tool stages, context updates, and error paths |
| ENG-31 | Telegram chat-id visibility | Done | Added `/chatid` command and startup whitelist logs so operators can verify which chat ids are allowed/listened |
| ENG-32 | Dev runtime auto-bootstrap | Done | Added Vite dev bootstrap ping to `/api/settings` so runtime/telegram status logs appear immediately after dev server starts |
| ENG-33 | Telegram runner config preflight & no-panic error path | Done | Runner now validates provider/key config, returns readable Telegram errors instead of crashing process, and supports custom provider mode model selection |
| ENG-34 | Telegram sessions mirror + empty-response guard | Done | mom-t now mirrors telegram turns into `data/sessions` and returns explicit user-facing message when provider returns empty assistant content |
| ENG-35 | AI call trace logs | Done | Added runner-level AI invocation trace logs: model/api/baseUrl/path/key presence, api-key resolve, stream start, and assistant usage/content stats |
| ENG-36 | Custom provider path/baseUrl mapping fix | Done | Custom provider now maps `baseUrl + path` to OpenAI SDK `baseURL` prefix correctly (e.g. OpenRouter `/api/v1`) |
| ENG-37 | Telegram output cleanup | Done | Ignored non-modified status edit errors (no duplicate fallback sends), disabled normal tool thread spam (error-only), and stripped ANSI escapes from bash output |
| ENG-38 | Mom-t key-log mode | Done | Reduced default `[mom-t]` logs to key execution events via whitelist; full verbose logs can be re-enabled with `MOM_LOG_VERBOSE=1` |
| ENG-39 | Telegram dual events watcher | Done | Added watcher support for both workspace events and chat scratch events (`<chatId>/scratch/events`) |
| ENG-40 | Mom-style system prompt optimization | Done | Upgraded Telegram runner system prompt with mom-style structure: environment, formatting, event scheduling constraints, and watched event paths |
| ENG-41 | Event reminder direct-delivery fix | Done | One-shot/immediate events now send event `text` directly to Telegram instead of relying on LLM-generated phrasing |
| ENG-42 | Event file status persistence | Done | Event files are no longer deleted after execution; watcher now writes `status` (completed/skipped/error, timestamps, run count) |
| ENG-43 | Scratch path duplication guard | Done | Tool path resolver now normalizes accidental `data/telegram-mom/<chatId>/scratch/...` prefixes to prevent nested duplicate directories |
| ENG-44 | Telegram scratch nested-path data migration | Done | Safely migrated existing files from duplicated nested scratch path back to canonical chat scratch root |
| ENG-45 | Custom provider multi-model schema | Done | Upgraded custom provider config to `models[] + defaultModel + supportedRoles[]` with legacy `model` backward compatibility |
| ENG-46 | Provider capability test API | Done | Added `/api/settings/provider-test` to verify connectivity and detect `developer` role support per model |
| ENG-47 | Developer-role compatibility fallback | Done | Telegram mom stream now maps `developer -> system` when selected custom provider does not support `developer` role |
| ENG-48 | AI settings split-pane provider UI | Done | Rebuilt `/settings/ai` into left searchable provider list + right detail panel with model management, role display, and inline provider testing |
| ENG-49 | SystemPrompt role-compat fallback | Done | When custom provider lacks `developer` support, runner now also flattens `systemPrompt` into explicit `system` message to avoid adapter-level developer-role injection |
| ENG-50 | Telegram global skills support + prompt upgrade | Done | Runner now discovers skills from `data/telegram-mom/skills/**/SKILL.md`, injects them into system prompt, and upgrades prompt with skill protocol/system-log guidance |
| ENG-51 | Workspace find-skills skill installed | Done | Installed `find-skills` into `data/telegram-mom/skills/find-skills/SKILL.md` so mom runtime can discover it |
| ENG-52 | Runtime skills path alignment | Done | Active runtime skill path is `data/telegram-mom/skills/find-skills/SKILL.md` under root-start mode |
| ENG-53 | Runtime path knowledge documented | Done | Current runtime paths: workspace `data/telegram-mom`, per-chat tool cwd `data/telegram-mom/<chatId>/scratch` |
| ENG-54 | Backend source fully merged into SvelteKit | Done | Backend source is fully hosted at `src/lib/server/*` and imported via `$lib/server/*` in SvelteKit server routes/hooks |
| ENG-55 | Svelte app flattened to repository root | Done | Removed standalone `web/` app layout; SvelteKit app now runs from root with one `package.json` and one command set (`dev/build/start/cli`) |
| ENG-56 | Web build Node-only dependency isolation | Done | Replaced chat page runtime dependencies (`pi-web-ui`/`pi-ai` client imports) with pure Svelte + backend API integration to avoid browser bundle pulling Node-only packages and to restore successful `npm run build` |
| ENG-57 | Telegram multi-session commands | Done | Added `/new`, `/clear`, `/sessions`, `/delete_sessions`, `/help`; Telegram runner/context now supports per-chat multiple contexts with active session switching |
| ENG-58 | Telegram busy-message queue support | Done | While a run is in progress, new inbound messages are now queued (with pending count feedback) instead of rejected; `/stop` still aborts current task |
| ENG-59 | Telegram text attachment extension guard | Done | Enforced Telegram text-file upload extensions to `.txt/.md/.html` (auto-normalize text attachments with unsupported suffix to `.txt`) and updated runner prompt rules accordingly |
| ENG-60 | Telegram skills listing command | Done | Added `/skills` command to list currently loaded workspace skills (name/description/path) and loader diagnostics from `src/lib/server/agent/skills.ts` |
| ENG-61 | Delayed-reminder event enforcement | Done | For Telegram mom runtime, delayed tasks now explicitly require event-file scheduling; `bash` tool blocks wait/sleep-style commands and instructs creating one-shot events instead |
| ENG-62 | Telegram text-first delivery policy | Done | `uploadFile` now sends likely-text content as normal Telegram message when within limit; falls back to document only for oversized text or non-text/binary files |
| ENG-63 | Runner prompt aligned to upstream mom agent baseline | Done | Rebased Telegram runner system prompt on `example/pi-mono/packages/mom/src/agent.ts` structure and adapted only environment-specific parts (Telegram, workspace/session paths, event lifecycle, text-first output rules) |
| ENG-64 | Tool path sandbox for workspace roots | Done | `read/write/edit/attach` now reject file paths outside allowed roots (`scratch` + workspace), preventing incorrect writes to `/tmp` and other external directories |
| ENG-65 | Mom tools modularized with upstream-aligned capabilities | Done | Refactored tools into per-tool modules (`bash/read/write/edit/attach`) plus shared `path` and `truncate` utilities; added richer read/image handling and bash truncation diagnostics aligned with mom example design |
| ENG-66 | Reminder shorthand auto-normalization | Done | `write` now detects reminder shorthand (`<ISO_TIME> <text>`) and normalizes it into one-shot event JSON under workspace watched events directory, preventing non-JSON reminder files |
| ENG-67 | Skills canonical install path guard | Done | Runner prompt now enforces absolute workspace skills path and tool path resolver normalizes mistaken `data/telegram-mom/skills` relative paths from scratch into canonical `data/telegram-mom/skills` |
| ENG-68 | Telegram workspace absolute-path normalization | Done | Telegram runtime now resolves workspace dir with `path.resolve`, so prompt/skills listing report true absolute paths (not `data/telegram-mom` relative form) |
| ENG-69 | Repository `.gitignore` baseline refresh | Done | Added complete ignore rules for Node/SvelteKit build artifacts, local env files, runtime data outputs, logs, and editor/OS noise |
| ENG-70 | Global `molibot` launcher + home workspace migration | Done | Added npm-linkable `molibot` command, moved default runtime data root to `~/.molibot`, and switched Telegram workspace to `~/.molibot/moli-t` |
| ENG-71 | Legacy Telegram workspace data migration | Done | Copied legacy runtime data from repo-local `data/telegram-mom` into new home workspace `~/.molibot/moli-t` with file-count parity verification |
| ENG-72 | Legacy settings file migration | Done | Copied `data/settings.json` to `~/.molibot/settings.json` so runtime settings continue from previous repo-local storage |
| ENG-73 | Telegram markdown-to-native formatting delivery | Done | Added the original outbound text formatting adapter; superseded on 2026-06-17 by grammY rich messages with plain text fallback instead of local Markdown-to-HTML conversion |
| ENG-126 | Telegram chat event path simplification | Done | Simplified chat-local watched events path from `<chatId>/scratch/data/.../events` to `<chatId>/scratch/events` with legacy directory migration |
| ENG-127 | Settings task inventory page | Done | Added `/settings/tasks` and `/api/settings/tasks` to inspect workspace and chat event tasks grouped by type with status, delivery, schedule, run count, and file path |
| ENG-155 | Settings task deletion and batch operations | Done | Added task deletion API plus `/settings/tasks` multi-select UI with single delete, section select, select-all, and batch delete actions |
| ENG-156 | Telegram send retry and task manual trigger | Done | Added retry/backoff for retryable Telegram `sendMessage` network failures and `/settings/tasks` manual trigger actions (`Retry Now` / batch send) for task delivery testing |
| ENG-157 | Provider settings split and enable-gated routing | Done | Migrated `update-provider` settings/config changes into `master` without agent-runtime changes: added `customProviders[].enabled`, split built-in/custom provider management UI, and gated routing/model options/default selection by enabled providers (built-in providers default to disabled) |
| ENG-158 | Settings sidebar active-tab highlight fix | Done | Updated `/settings` sidebar route matching to normalized exact-path matching for tab links so active color switches correctly when moving between AI/Settings tabs |
| ENG-159 | Built-in provider enable persistence fix | Done | Fixed runtime settings sanitize/save path to persist `customProviders[].enabled` and keep `defaultCustomProviderId` aligned to enabled providers first |
| ENG-154 | Periodic event execution status persistence | Done | Fixed watcher so periodic events persist `lastTriggeredAt`, `runCount`, and error state on every execution instead of bypassing status writes |
| ENG-160 | Vision-to-text image fallback in runner | Done | Added `src/lib/server/agent/vision-fallback.ts` and updated `runner.ts` so unsupported text models can still understand images via vision analysis text injected into the prompt, mirroring the existing voice transcript fallback flow; runner now also strips historical `image` parts from session context before calling text-only models |
| ENG-161 | Web session summary title edit + ownership labels | Done | Added session rename path (`PUT /api/sessions/:id` + `SessionStore.renameConversation`), exposed session `title` in details API, and upgraded web chat session list with inline title editing plus per-session user label display |
| ENG-162 | Telegram startup failure log includes bot instance id | Done | Added `botId` metadata to Telegram adapter startup/apply logs so `adapter_start_failed` errors (for example token 401) can be mapped to a specific bot instance quickly |
| ENG-163 | Telegram per-bot auth-failure auto-disable | Done | When a Telegram instance fails startup with `401 Unauthorized`, runtime now auto-disables only that `botId` in channel settings and keeps other channel instances running |
| ENG-164 | Web chat realtime voice recorder control | Done | Replaced audio-file attachment UX with in-page microphone recording control in Chat: click to start recording, click again to stop and auto-send voice as chat input |
| ENG-165 | Settings patch merge uses latest persisted snapshot | Done | Runtime settings update path now reloads latest `settings.json` before applying patch, preventing stale in-memory process snapshots from rolling Telegram/Web/Feishu config back to older versions |
| ENG-166 | Hybrid settings storage (JSON bootstrap + SQLite dynamic domains) | Done | Migrated dynamic settings (`customProviders`, `channels`, `agents`) to `settings.sqlite` row-based storage while retaining stable bootstrap fields in `settings.json`, reducing full-file overwrite risk for large mutable config |
| ENG-167 | Channel patch merge no longer wipes sibling channels | Done | Fixed runtime channel sanitizer to merge patches over current channel map instead of replacing the whole map, so saving `channels.web` no longer clears Telegram/Feishu (and vice versa) |
| ENG-168 | Relational settings tables for agents/channels/providers | Done | Replaced single-row dynamic JSON storage with normalized SQLite tables (`settings_agents`, `settings_channel_instances`, `settings_custom_providers`, `settings_custom_provider_models`) so each entity is stored as separate rows and reconstructed at load time |
| ENG-169 | Settings single-entity save flow + unsaved-switch prompt | Done | Added single-record settings APIs (`/api/settings/agent`, `/api/settings/channel-instance`) and migrated Agents/Web/Telegram/Feishu pages to save only the selected row plus prompt on selection change when there are unsaved edits |
| ENG-170 | Web chat profile-only New Chat identity flow | Done | Removed Web Chat `userId` UI/storage/request wiring; New Chat now selects only Web Profile and all session/chat/prompt-preview API calls use profile-scoped identity without user-id input |
| ENG-171 | Web UI theme switching + i18n foundation | Done | Added replaceable theme-token file (`src/styles/theme.css`) and switched chat + settings shells to theme-token rendering (updated to Solar Dusk palette), with improved input/text contrast; added `system/light/dark` toggle with local persistence, plus zh-CN/en-US UI language switch with dictionary-based rendering and local persistence |
| ENG-172 | Global+bot skills persistence and scope alignment | Done | Stopped startup migration from clearing `${workspaceDir}/skills` for bot workspaces, standardized skill scopes to `global/bot/chat`, updated runtime `/skills` output + settings skills inventory naming, and aligned prompt/tooling declarations to load from global and bot directories consistently |
| ENG-173 | Agent MCP stdio integration | Done | Added runtime `mcpServers` settings + env bootstrap, MCP client registry based on `@modelcontextprotocol/sdk`, automatic MCP tool discovery/injection into runner, and graceful warning-only degradation when MCP servers fail |
| ENG-174 | Skill-gated MCP injection + MCP settings UI | Done | Added `/settings/mcp` visual editor for MCP servers, introduced skill frontmatter MCP bindings (`mcpServers`/`mcp_servers`), and changed runner MCP injection to default-hidden + explicit-skill-scoped activation (`$skill-name` / `/skill skill-name` / `skill:skill-name`) |
| ENG-175 | MCP JSON-first settings UX + HTTP transport | Done | Simplified `/settings/mcp` to single JSON input with parsed server list + enabled toggles, accepted object-map payloads (`{ mcpServers: { id: config } }`), and added HTTP MCP transport support in runtime/client (`StreamableHTTPClientTransport`) |
| ENG-176 | Skill-invocation MCP enablement without skill schema changes | Done | Removed MCP dependency on skill frontmatter fields; runner now enables MCP tools based on explicit skill invocation alone, keeps MCP hidden when no skill invocation is present, and updated system prompt rules to require clear missing-MCP error messaging without changing skill file format |
| ENG-177 | Session MCP loader tool (`load_mcp`) | Done | Added built-in `load_mcp` tool (`list/load/unload/clear`) so agent can explicitly select MCP servers at runtime, dynamically refresh loaded MCP tools for the current chat session, and return clear errors when a target MCP server is missing/disabled |
| ENG-178 | Skills enable/disable toggle with runtime ignore | Done | Added `Enable` toggle on `/settings/skills`, persisted disabled skills via `disabledSkillPaths`, and updated skill loading in runner/prompt/channel runtimes to ignore disabled skills without deleting files |
| ENG-179 | Stop command immediate abort (keep queued messages) | Done | Enhanced Telegram/Feishu/QQ stop handling so `stop`/`/stop` immediately aborts only the currently running runner task, without clearing queued follow-up messages; queued messages continue after abort |
| ENG-180 | Stop hard-interrupt for MCP/tool wait + immediate busy release | Done | Wired MCP tool calls to respect abort signals (`client.callTool(..., { signal })`) and changed channel stop handlers to drop chat busy guard immediately after abort, so `/new` and follow-up commands no longer block behind slow/unresponsive in-flight tool calls |
| ENG-181 | Prompt refresh-by-change policy for cache stability | Done | Runner now rebuilds system prompt only when prompt-affecting settings change (system prompt text/timezone/disabled skills/MCP config/current bot agent binding) or on fresh runner (`/new`), instead of rebuilding on every message, balancing cache reuse with timely settings-driven prompt updates |
| ENG-182 | Settings Overview dark-mode contrast fix | Done | Updated `/settings` Overview intro and card description copy from hardcoded `text-slate-400` to theme token `text-[var(--muted-foreground)]` to restore readable WCAG-friendly contrast in dark mode while keeping light/dark palette consistency |
| ENG-183 | Periodic event upsert + duplicate supersede | Done | Updated `create_event` for periodic tasks to upsert by `chatId + schedule + timezone` instead of always creating a new file; existing matching task is updated in place, and older duplicates are marked `completed` with `reason: superseded_by_update` to stop repeated duplicate runs |
| ENG-185 | Telegram timeout fallback crash guard | Done | Telegram timeout/failure fallback messages now use a non-throwing safe send path, so repeated outbound timeouts log and end the run cleanly instead of crashing the whole service |
| ENG-186 | Chat run-summary reply suppression | Done | End-of-run summary replies are now hidden from normal chats; users only see a short note when the run actually saved a reusable draft |
| ENG-187 | Skill Draft bot-scope dedupe | Done | Skill Drafts page now reads each bot-level `skill-drafts` directory only once, preventing the same draft from appearing repeatedly for every chat under that bot |
| ENG-184 | Cross-provider model fallback with contextual error summary | Done | Runner and assistant service now retain provider/model/baseUrl context for failures, automatically retry alternative providers on retryable request errors such as 429/rate-limit or upstream 5xx/network failures, and expose aggregated failure details instead of bare status codes |
| ENG-225 | Telegram forum topic conversation support | Done | Telegram runtime now recognizes forum-topic messages via `message_thread_id`, routes replies/status/media back into the same topic, and keeps each topic on its own runtime context/session scope instead of mixing the whole supergroup |
| ENG-265 | Built-in provider no longer treated as custom default | Done | Fixed AI provider-mode guardrails so `providerMode=custom` only selects true custom providers; built-in providers can no longer become `defaultCustomProviderId` from Providers page, preventing false `custom provider requires baseUrl/apiKey/model` errors when using built-in models |
| ENG-266 | Web chat running-state stuck recovery and force-stop | Done | Unified web runner context across `/api/chat` and `/api/stream`, added `/api/stream/stop` to abort the active run by profile/session, wired stream request abort to runner abort, and added a visible Stop action in Web chat so `Already working` lockups can be cleared without waiting for backend timeout |
| ENG-267 | Deterministic skill invocation matching and ambiguity resolution | Done | Reworked explicit skill matcher to detect slash/inline invocation anywhere in user text (`/skill`, `$skill`, `skill:...`, `技能:...`), normalize aliases consistently, and resolve collisions deterministically by exact-name + scope priority (`chat > bot > global`) so skill triggering is more stable and less ambiguous |
| ENG-268 | QQ SDK gateway startup compatibility fix | Done | Updated the QQ channel adapter to match the current `package/qqbot` gateway contract, added a safe default stop signal so startup no longer crashes when `abortSignal` is missing, and aligned the QQ compatibility exports with the SDK’s current type/function names |
| ENG-269 | QQ API response-header log compaction | Done | Reduced `package/qqbot/src/api.ts` response-header logging from full JSON dumps to a short one-line summary with only key fields, so QQ request traces stay readable without hiding the useful status and trace information |
| ENG-270 | QQ inbound runtime decoupling and duplicate-layer cleanup | Done | Changed `package/qqbot` gateway to support a direct event callback instead of always requiring OpenClaw runtime wiring, connected Molibot’s QQ runtime to a real inbound queue/command/runner flow, removed the duplicate `QQManager` implementation from `sdk-adapter.ts`, and isolated QQ token caching per appId so multiple bots no longer clear each other’s tokens |
| ENG-271 | Manual compaction runner/store resync | Done | Manual `/compact` now reloads the latest persisted session context into the idle runner before summarizing, fixing cases where `/status` showed a large context but `/compact` incorrectly replied `Nothing to compact yet.` because runner memory lagged behind session storage |
| ENG-186 | Minimal conversation context compaction | Done | Added runtime context compaction with configurable `enabled/reserveTokens/keepRecentTokens`, auto-triggering before prompts when the active model context window gets tight, manual `/compact [instructions]` commands across web/Telegram/Feishu/QQ, and AI Routing settings controls for the thresholds |
| ENG-187 | Session entry log substrate | Done | Added append-only per-session `contexts/<sessionId>.jsonl` entry logs with legacy `.json` migration, context rebuild from structured entries, and compaction persistence that no longer depends only on overwriting raw message arrays |
| ENG-188 | OAuth auth.json runtime login loop | Done | Added shared `${DATA_DIR}/auth.json` resolver (override via `PI_AI_AUTH_FILE`), runtime API-key resolution with OAuth refresh support, and `/login` + `/logout` commands in web/Telegram/Feishu/QQ so chat flows can complete provider auth without manual code edits |
| ENG-189 | Recoverable compaction with overflow retry | Done | Upgraded compaction session entries with token metadata and added runner-side context overflow detection that auto-compacts and retries the active request instead of failing immediately on model window exhaustion |
| ENG-208 | Periodic event running lock and slot dedupe | Done | Added periodic pre-run `running` lease lock with TTL, same-slot dedupe (`lastSlotKey` / `runningSlotKey`) and run-id guarded status transitions in `EventsWatcher`, preventing repeated triggers in the same cron minute when status file writes re-fire watchers; added `EVENT_RUNNING_LOCK_ENABLED` rollback switch and task UI/API `running` status support |
| ENG-209 | BOT.md prompt merge inclusion fix | Done | Fixed prompt section merge order to include `BOT.md` (`PROMPT_SECTION_ORDER` now contains `BOT.md`), so bot-scoped profile instructions are actually injected into runtime system prompt instead of being dropped during merge |
| ENG-210 | Settings task inline edit support | Done | Added `/api/settings/tasks` update action for safe task JSON edits (`text`/`delivery`/`at`/`schedule`/`timezone` with type-aware validation), and added inline `Edit/Save/Cancel` controls in `/settings/tasks` so operators can modify tasks directly without manual file editing |
| ENG-211 | Settings task textarea SSR build compatibility fix | Done | Replaced self-closing `<textarea />` with explicit `<textarea></textarea>` in `/settings/tasks` edit UI to satisfy Svelte non-void tag rules and remove production build warnings |
| ENG-185 | Web chat runtime commands bypass LLM for model operations | Done | Web chat `/models`, `/skills`, and `/help` now execute through local settings/skill data paths in API handlers instead of going through the model, so model inspection and switching no longer depend on successful LLM intent parsing |
| DOC-08 | README full onboarding refresh | Done | Rewrote `readme.md` into a concise end-to-end guide: install, configure, startup modes, first-time setup sequence, Web/Telegram usage, settings index, data layout, and environment variables |
| DOC-09 | README visual story upgrade | Done | Refactored README presentation with a stronger hero, key highlights, architecture diagram, feature snapshot, and a cleaner quick-start-first narrative inspired by modern agent project documentation style |
| DOC-10 | README scannability enhancement | Done | Added badges, table of contents, and product surface matrix to improve first-screen readability and make key sections discoverable faster |
| DOC-11 | README architecture rendering fallback | Done | Simplified Mermaid syntax for compatibility and added a local static SVG architecture diagram fallback so readers can always see the architecture even when Mermaid rendering is unavailable |
| ENG-128 | Memory sync deduplication | Done | Added exact-content deduplication to `mory` memory writes and prompt-context rendering so periodic sync/import noise does not duplicate `Current Memory` entries |
| ENG-129 | Memory update dedupe and compact tool parity | Done | Updating a memory to content that already exists now merges into the survivor instead of creating a duplicate, and the mom `memory` tool now exposes `compact` so agent-side dedupe uses the same capability as the web API |
| ENG-130 | Explicit all-scope memory queries | Done | Memory API, settings page, and mom memory tool now require explicit `allScopes` to query or compact across all scopes; default behavior stays limited to the current scope |
| ENG-131 | Settings memory page defaults to global view | Done | `/settings/memory` now defaults to `allScopes=true` and surfaces source/session labels so operators see all stored memory entries immediately instead of landing on an empty scoped view |
| ENG-132 | Backend module structure phase-1 migration | Done | Moved runtime/bootstrap to `src/lib/server/app`, renamed `mom` to `src/lib/server/agent`, moved built-in channel implementations to `src/lib/server/channels`, and pulled session/settings/provider services into explicit module directories |
| ENG-133 | Settings/bootstrap boundary split | Done | Split former `config.ts` into `src/lib/server/app/env.ts` and `src/lib/server/settings/{schema,defaults}.ts`, added `src/lib/server/settings/index.ts` barrel, and rehomed the shared router to `src/lib/server/channels/shared/messageRouter.ts` |
| ENG-134 | Infra and shared-type extraction | Done | Moved rate limiting to `src/lib/server/infra/rateLimiter.ts`, moved storage helpers to `src/lib/server/infra/db/storage.ts`, and moved cross-module message types to `src/lib/shared/types/message.ts` |
| ENG-135 | Dead local web storage backend cleanup | Done | Deleted unused `src/lib/memoryStorageBackend.ts`; repository no longer contains an unreferenced in-memory web storage backend leftover at the root `src/lib` level |
| ENG-136 | Telegram runtime low-risk helper extraction | Done | Extracted Telegram queueing, message formatting, and local runtime helper types into sibling files so `runtime.ts` keeps orchestration while leaf transport concerns stay isolated |
| ENG-137 | Feishu runtime low-risk helper extraction | Done | Extracted Feishu queueing and message send/edit helpers into `src/lib/server/channels/feishu/{queue,messaging}.ts`, while keeping orchestration and command flow in `runtime.ts` |
| ENG-138 | Shared channel queue extraction baseline | Done | Moved duplicated Telegram/Feishu queue logic into `src/lib/server/channels/shared/queue.ts`; later multimodal cleanup moved STT ownership out of `channels` and into `agent` core |
| ENG-139 | Feishu outbound file/image/audio delivery | Done | Implemented Feishu `uploadFile` handling with text passthrough, native image send, audio/media best-effort send with file fallback, generic file send, and message deletion support for silent responses |
| DOC-08 | README standard structure rewrite | Done | Rewrote `readme.md` into a conventional GitHub README shape with clearer sections for overview, features, setup, usage, architecture, structure, API, and limitations |
| DOC-09 | README logo placement | Done | Added the repository logo image to the README header with a constrained width so branding is visible without overwhelming the page layout |
| DOC-10 | README intro aligned to OpenClaw lineage | Done | Reframed the README introduction so Molibot is presented as a simplified OpenClaw-style personal AI assistant rather than a generic multi-entry AI project |
| DOC-11 | README hero copy polish | Done | Tightened the README opening into a shorter product-style positioning statement so the first screen reads more like a real project homepage |
| DOC-12 | README hero slogan | Done | Added a short centered slogan under the logo so the README header reads like a finished project landing block |
| ENG-74 | Dev startup eager runtime bootstrap | Done | Replaced dev HTTP ping bootstrap with direct runtime module initialization via Vite `ssrLoadModule`, so Telegram bot starts without opening any web page |
| ENG-75 | Telegram `/models` command for in-chat model switching | Done | Added `/models` command to list configured model options and switch active model by index/key, with runtime settings persistence via `updateSettings` |
| ENG-76 | Telegram voice message transcription support | Done | Added `voice/audio` ingestion and optional OpenAI-compatible transcription (`/audio/transcriptions`) so voice messages can be converted to text for chat processing |
| ENG-77 | AI provider multimodal model registry + routing | Done | Upgraded provider model schema to per-model objects with capability tags and added routing config for text/vision/stt/tts model selection |
| ENG-78 | AI settings page capability-tag and routing UI | Done | Rebuilt `/settings/ai` to support provider CRUD, multi-model management with tags (text/vision/stt/tts/tool), and dedicated routing selectors for text/image/stt/tts |
| ENG-79 | Per-model provider capability test action | Done | AI settings now tests the exact clicked model (per-row Test button) instead of implicitly using provider default model |
| ENG-80 | Per-model supported-roles schema migration | Done | Moved `supportedRoles` from provider level to model level, added backward-compatible migration, and updated runtime role fallback to read selected model roles |
| ENG-81 | STT custom path routing fix + queue error stack logs | Done | Telegram STT now uses configured provider `path` (e.g. `/v1/audio/transcriptions`) when building transcription URL, and queue uncaught errors now log stack traces for faster root-cause analysis |
| ENG-82 | Voice-transcription failure user feedback | Done | When Telegram voice/audio transcription fails, bot now sends immediate actionable feedback to user (not silent failure), including config hints |
| ENG-83 | Runner constructor `ctx` reference crash fix | Done | Removed invalid `ctx` usage from `TelegramMomRunner` constructor; constructor now initializes with text-model baseline and per-message vision routing remains in `run()` |
| ENG-84 | Active-model API key preflight + robust key resolver | Done | Runner now validates API key for the actual selected model before prompt, returns user-visible settings error instead of process crash, and resolves API keys by requested provider directly |
| ENG-85 | Prompt-driven failure recovery + model route auto-heal | Done | Added mandatory failure-recovery protocol in runner system prompt, enabled automatic custom model fallback when route/default is invalid, and added STT tagged-model auto fallback when stt route is missing |
| ENG-86 | STT observability + anti-hallucination prompt guard | Done | Added STT target/success logs for deterministic verification and strengthened prompt to forbid fabricated “missing config file/API key” claims unless runtime explicitly reports them |
| ENG-87 | Telegram outbound audio media correctness | Done | Bot now sends `.ogg/.oga` as native Telegram voice and other common audio formats as Telegram audio instead of generic data documents |
| ENG-88 | Core-owned workspace prompt and skills resolution | Done | System prompt source loading, global skills root, memory root, and workspace semantics now resolve in `mom` core for both Telegram and Feishu instead of diverging per plugin |
| ENG-87 | Voice-transcript marker + hard anti-disclaimer rule | Done | Voice transcripts are now explicitly prefixed with `[voice transcript]`, and prompt now forbids claiming “cannot transcribe/play audio” when transcript section is present |
| ENG-88 | AI settings model editor reactivity fix | Done | Reworked provider/model mutations to immutable-by-id updates so `+ Add Model` / delete / tag toggle / per-model test updates always trigger UI state refresh reliably |
| ENG-89 | AI settings empty-model draft row support | Done | `+ Add Model` now keeps unsaved empty model rows visible (input appears immediately) instead of being filtered out during defaults normalization |
| ENG-90 | Web app ChatGPT-style Tailwind layout refactor | Done | Rebuilt chat + settings pages (`/`, `/settings`, `/settings/ai`, `/settings/telegram`) into unified ChatGPT-style shell with Tailwind-only styling while preserving all existing behavior |
| ENG-91 | Telegram route-scoped model switching command | Done | Upgraded `/models` to support route-specific model listing/switching for `text/vision/stt/tts` in Telegram chat |
| ENG-92 | Server background startup script with fixed log output | Done | Added `bin/start-molibot.sh` to run `molibot` with `nohup` in background and persist logs to configurable file path |
| ENG-93 | Server lifecycle scripts + ops docs | Done | Added `bin/stop-molibot.sh`, `bin/status-molibot.sh`, `bin/restart-molibot.sh`; upgraded start script with PID file management; documented all commands in `readme.md` |
| ENG-94 | Unified service-control script with subcommands | Done | Added `bin/molibot-service.sh` (`start/stop/status/restart`) as single operational entrypoint; legacy scripts now forward to the unified script |
| ENG-95 | Telegram multi-bot runtime + settings UI | Done | Added `telegramBots[]` settings schema and `/settings/telegram` multi-bot editor; runtime now starts one Telegram manager per bot with isolated workspace path and legacy single-bot migration fallback |
| ENG-96 | Event delivery mode split (`text` vs `agent`) | Done | Added optional event field `delivery`; one-shot/immediate now default to agent execution, while `delivery:\"text\"` keeps literal push behavior |
| ENG-97 | Pluggable memory gateway + backend switch | Done | Added stable memory gateway API with replaceable backend (`json-file`), `add/search/flush/delete/update` API endpoints, chat-time memory injection, and `/settings/plugins` memory enable toggle |
| ENG-98 | Memory v2 layered + incremental retrieval pipeline | Done | Added layered memory (`long_term`/`daily`), backend capability negotiation, incremental `flush` cursor, hybrid search (keyword+recency), and per-scope markdown mirrors (`MEMORY.md` + `daily/*.md`) |
| ENG-99 | Memory governance and operations console | Done | Added fact-key conflict detection (`hasConflict`), TTL support (`expiresAt`) with expired-entry filtering, API `list` action, and `/settings/memory` management UI (search/flush/edit/delete) |
| ENG-100 | Telegram memory unified under memory root | Done | Telegram mom memory no longer lives in chat workspace directories; global/chat memory files are migrated/read from unified `memory/` root with environment subpaths (`memory/MEMORY.md`, `memory/moli-t/bots/<botId>/<chatId>/MEMORY.md`) |
| ENG-101 | Unified memory gateway for Telegram agent operations | Done | Added Telegram `memory` tool (`add/search/list/update/delete/flush/sync`), blocked direct memory file access via `read/write/edit/bash` tools, enabled periodic external memory sync into gateway, and upgraded memory management page/API to unified all-scope view |
| ENG-102 | Externalized Telegram runner instruction files | Done | `runner.ts` now builds runtime system prompt from code, then merges instruction/profile files from data-root `~/.molibot` (plus optional workspace-local overlays), renders runtime placeholders, and falls back to bundled default template only when no instruction files are present |
| ENG-103 | Bot prompt auto-maintenance protocol for instruction files | Done | Added explicit auto-update governance in bundled AGENTS template for `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md`, including trigger conditions, security gate, change-summary requirement, and conflict priority |
| ENG-104 | AGENTS.md workspace-target guardrail | Done | Added explicit bot prompt rule: when editing AGENTS instructions, always target `${workspaceDir}/AGENTS.md`, never project-root `AGENTS.md`, and state target path in response |
| ENG-105 | `molibot init` workspace bootstrap command | Done | Added launcher subcommand `molibot init` to initialize `${DATA_DIR:-~/.molibot}` and bootstrap the profile files from bundled prompt templates under `src/lib/server/agent/prompts/` |
| ENG-106 | Global profile file path enforcement | Done | Strengthened tool path resolution/guard so profile files (`SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md`) are normalized to data-root global paths and blocked from being written under chat/workspace subdirectories |
| ENG-107 | Global profile path guard compatibility fix | Done | Fixed false rejection for valid global profile paths by normalizing absolute global profile targets before path checks and using case-insensitive path comparison on macOS/Windows |
| ENG-108 | Two-level skills repository (global + chat) | Done | Reworked skills load/query/install logic to use `${DATA_DIR}/skills` for reusable skills and `${workspaceDir}/${chatId}/skills` for chat-specific skills, with scope-aware listing, path guard allowances, legacy workspace-skill migration, and prompt guidance updates |
| ENG-115 | Runtime/system prompt ownership split | Done | `runner.ts` now owns Telegram mom runtime system prompt in code, while the bundled AGENTS template is limited to durable bootstrap behavior rules instead of carrying runtime-owned environment/event/tool instructions |
| ENG-109 | Settings skills inventory page | Done | Added `/settings/skills` UI and `/api/settings/skills` backend inventory endpoint to display installed skills grouped by scope (`global`/`chat`/`workspace-legacy`) with full file paths, bot/chat identifiers, counts, and diagnostics |
| ENG-110 | Telegram image reply delivery fix | Done | Telegram `uploadFile` now detects image payloads (extension + magic bytes) and sends via `sendPhoto`; if photo send fails, it safely falls back to `sendDocument` |
| ENG-111 | `@molibot/mory` package completion | Done | Added standard package layout (`src/` + `test/`), independent `package.json` + build config, node:test suite, smoke script, and SQLite/pgvector SQL templates under `package/mory` |
| ENG-112 | `@molibot/mory` cognitive control logic modules | Done | Added pure-logic modules for write scoring gate (`moryScoring`), conflict resolution/versioning (`moryConflict`), retrieval intent routing (`moryPlanner`), episodic consolidation (`moryConsolidation`), and task-scoped workspace memory helpers (`moryWorkspace`) with tests and index exports |
| ENG-113 | `@molibot/mory` README 功能点状态清单 | Done | 将 mory 全量功能点写入 `package/mory/README.md`，按 `完成` / `TODO` 明确当前实现边界，并补充快速示例与 SQL 模板说明 |
| ENG-114 | `@molibot/mory` TODO 功能全量落地 | Done | Added `moryEngine` orchestration (`ingest/retrieve/commit/readByPath/readMemory`), `read_memory` tool API, async commit pipeline, strict extraction validator, storage adapters (`InMemory`/`SQLite`/`pgvector`), versioned schema fields (`version/supersedes/conflict_flag/archived_at`), retrieval executor (planner+vector recall+rerank+L0/L1/L2), forgetting/archive policy engine, observability metrics, and full-loop E2E test |
| ENG-116 | Telegram relative-reminder deterministic fallback | Done | For explicit relative reminder requests like “2 分钟后提醒我…”, Telegram adapter now creates watched one-shot event JSON server-side before model execution, avoiding missed reminders when the active model skips tool calls |
| ENG-117 | System prompt modular builders + startup preview | Done | Split Telegram mom system prompt into section builders in `runner.ts` and generate `SYSTEM_PROMPT.preview.md` in each bot workspace on startup so operators can inspect the actual effective prompt |
| ENG-118 | Global prompt-source enforcement and source preview | Done | Prompt file loader now resolves instruction/profile files from `${DATA_DIR}` (`~/.molibot`) with case-insensitive filename matching, merges global + workspace sources deterministically, and writes `global_sources` / `workspace_sources` into startup prompt previews |
| ENG-119 | Global profile templates upgrade | Done | Refactored `~/.molibot/AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md` using template-style frontmatter and clearer sections inspired by OpenClaw, while preserving existing user-specific rules and identity data |
| ENG-120 | Init profile template bundle | Done | Added `src/lib/server/agent/prompts/*.template.md` from the upgraded global profiles and switched `molibot init` to copy these templates for new users instead of creating mostly empty profile files |
| ENG-121 | Remove legacy AGENTS.default fallback file | Done | Deleted `src/lib/server/agent/prompts/AGENTS.default.md` and pointed runtime fallback/imports to `AGENTS.template.md`, removing the last duplicated AGENTS template artifact |
| ENG-122 | Prompt builder extraction and runtime/profile split cleanup | Done | Moved Telegram mom prompt construction out of `runner.ts` into `src/lib/server/agent/prompt.ts`, kept runtime-owned contract sections in code, and removed duplicated style rules like `Be concise` / `No emojis` from code-owned prompt sections |
| ENG-123 | Prompt preview dynamic-section ordering cleanup | Done | Reordered `prompt.ts` so stable runtime contract sections stay ahead of high-churn runtime payloads; `available skills` / `skill diagnostics` / `current memory` now render near the end for cleaner preview diffing |
| ENG-124 | Profile injection cleanup | Done | Stripped YAML frontmatter before injecting profile files into the runtime prompt, rewrote AGENTS injected wording to reflect already-injected context, removed the misleading “not the system prompt body” line from injected AGENTS content, and normalized bundled TOOLS paths to `${dataRoot}` |
| ENG-125 | Channel-specific prompt sections | Done | Removed Telegram-specific delivery wording from the core prompt, introduced adapter-selectable channel prompt sections in `src/lib/server/agent/prompt-channel.ts`, and wired Telegram runtime/preview to request the Telegram section explicitly |
| ENG-128 | Mory-backed memory gateway core switch | Done | Added `src/lib/server/memory/moryCore.ts`, registered optional `mory` provider in `MemoryGateway`, kept `json-file` as default, and exposed SDK-backed backend selection in plugin settings while preserving the existing gateway API for agent/tool/API callers |
| ENG-129 | Feishu inbound media parsing and runner-ready intake | Done | Feishu runtime now downloads inbound image/audio/file resources, persists attachments with media metadata, injects images into runner context, and passes audio forward for agent-side transcription instead of treating Feishu as text-only |
| ENG-140 | Unified safe model-switch service | Done | Added shared `settings/modelSwitch.ts`, narrow `/api/settings/model-switch`, Telegram + Feishu `/models` parity, and agent `switch_model` tool so runtime model changes no longer need direct settings-file edits |
| ENG-141 | Agent settings-file shell guard | Done | Hardened agent `bash` tool to block direct access to the runtime settings file and steer model changes onto the validated switch tool/API path |
| ENG-142 | Runtime AI token usage tracker | Done | Added append-only JSONL usage logging under `~/.molibot/usage/ai-usage.jsonl`, recorded per-request provider/model/input/output/cache/total tokens from both web and channel agent paths, and exposed aggregated stats through `/api/settings/usage` |
| ENG-143 | AI settings usage dashboard | Done | `/settings/ai` now shows today/yesterday/7-day/30-day token totals, daily/weekly/monthly breakdowns, and top per-model usage summaries sourced from the backend usage tracker |
| ENG-144 | Mory first-run directory bootstrap fix | Done | Ensured `${DATA_DIR}/memory` and SQLite parent directories are created before opening the Mory database, preventing new-machine startup failure `unable to open database file` |
| ENG-274 | Fixed slash-command two-column Markdown tables | Done | Shared fixed commands now support per-command render modes; `/status` and `/help` render as two-column Markdown tables on QQ/Weixin/Feishu while Telegram keeps plain-text fallback, and three-column/other command outputs stay unchanged |
| ENG-145 | Agent-owned audio transcription boundary | Done | Moved STT target resolution/transcription flow into `src/lib/server/agent/stt.ts`, extended attachment metadata with `mediaType`/`mimeType`, made Telegram/Feishu channels emit raw audio attachments only, and let `runner.ts` decide transcription, prompt injection, and user-facing STT fallback |
| ENG-146 | Provider capability verification states | Done | Added per-model `verification` status (`untested` / `passed` / `failed`) to custom provider settings, extended provider test API to verify declared `text`/`vision` capabilities, and updated AI Providers UI to show declared tags separately from verification results |
| ENG-147 | Verification-aware vision routing | Done | Updated `runner.ts` so image inputs only go through native multimodal prompting when the selected custom text model or dedicated vision-route model has `vision` both declared and verification-passed; otherwise images fall back to attachment-based handling instead of being blindly sent to the model |
| ENG-148 | Skill Drafts textarea tag fix | Done | Replaced the self-closing `textarea` in `/settings/skill-drafts` so both dev runtime and production build stop emitting invalid Svelte HTML warnings |
| ENG-275 | Feishu rich cards and approval callbacks | Done | Feishu replies now render as structured rich cards instead of one raw markdown block, ACP status/approval messages use dedicated cards, and new `/api/feishu/card` callbacks plus optional verification/encryption settings let approval buttons work directly inside Feishu |
| ENG-277 | Durable SQLite inbound task queue | Done | Telegram, Feishu, QQ, and Weixin incoming tasks now enter one shared lightweight SQLite queue flow with restart recovery, image/audio attachment restoration, front insertion, queue listing, and delete-by-id support |


## In Progress
| ID | Feature | Status | Notes |
|---|---|---|---|
| N/A | N/A | N/A | No active in-progress item in docs; next is tests + deployment packaging |

## Backlog
| ID | Feature | Status | Notes |
|---|---|---|---|
| BL-01 | WhatsApp adapter | Backlog | Post V1 |
| BL-02 | Lark adapter | Backlog | Post V1 |
| BL-03 | Slack adapter | Backlog | Post V1 |
| BL-04 | Vector memory | Backlog | Post V1 |
