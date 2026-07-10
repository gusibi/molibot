# Molibot Features

## 2026-07-10

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

## 2026-06-30

### macOS 聊天侧栏重构为「渠道 → Bot → 会话」导航
- Chat 页左栏重做成两列布局的统一导航：顶部一排横向圆形渠道切换器（Web / telegram / feishu / qq / weixin，紧凑头像 + 与上方菜单间用分割线隔开），选中渠道后下方列出该渠道已配置的全部 Bot 实例（含 0 会话的），点开某个 Bot 展开它的会话列表，点会话进入右侧对话区。Web 渠道的「Bot」即各 Web Profile（会话可新建/重命名/删除），外部渠道的 Bot 会话只读。
- 修复「全部显示为未指定 Bot 实例」：外部会话以前只读 `external.botInstanceName`（实际数据未写）。真实数据里 Bot 身份编码在 legacy 索引的 `externalUserId`（`bot:<instanceId>:chat:...`，如 `bot:moli_news_bot:chat:...`），而会话 `id` 只是 UUID。现在后端从 `externalUserId` 解析出 `botInstanceId`，前端再与渠道设置（实例 id=slug、name=显示名）join 出 Bot 名称与完整 Bot 列表 —— 实测 272 条外部会话里 269 条能正确归位（telegram 拆到约 10 个 bot、feishu 8 个、qq 2 个、weixin 1 个），仅 3 条旧式 `chat:<chatId>:...` 无 Bot 前缀的归入「未指定 Bot 实例」兜底。
- 后端新增纯函数 `parseBotInstanceId`（解析 `externalUserId`）与契约字段 `DesktopExternalSession.botInstanceId`，投影改为透传 `externalUserId`；前端新增纯函数 `buildExternalChannelNav` / `externalSessionsForBot` 与 `.channel-switch` / `.channel-chip` 语义类。
- 验证：`api.test.ts` 60/60、`desktopExternalSessions.test.ts` 9/9、Desktop `svelte-check` 0/0、production build 通过；并用真实 `~/.molibot/sessions/index.json` 验证分组分布。

### macOS 设置导航分组与实体编辑弹窗
- macOS Settings 左栏按 Web `/settings` 的五组结构整理为「总览 / AI 引擎 / 渠道 / 助手数据 / 系统」，保留全部 22 个桌面设置入口、双语标签和搜索过滤。
- Agent、MCP、外部渠道、Web Profile、任务的新增/编辑表单不再追加到长页面底部，统一显示为居中的可滚动编辑窗口；保存仍走原有细粒度 API 和固定底栏。
- 编辑窗口现在自带固定标题、关闭、取消和保存区，避免操作按钮被浮层遮挡；Memory 记录也从列表内直接改写调整为摘要列表 + 独立编辑窗口。
- 设置行、38×22 开关、紧凑下拉框、卡片间距继续复用 `DESIGN.md` / standalone 设计稿 token；Provider、Agent、MCP、渠道和 Web Profile 编辑态的启用控件统一为 Switch，并补充减少动态效果适配。
- 完成 22 个设置入口的逐页布局检查：独立卡片增加 12px 组间距，TTS 默认只展开当前 Provider，图片测试尺寸改为受控下拉，模型/任务时区下拉保留 `UTC` 和旧配置值，运行历史增加双语即时筛选，渠道名称按中英文显示；运行环境长命令在窄窗口安全换行。
- 在 860×650 实页逐项切换全部 22 页，标题均正确且无横向溢出；620×480 最小窗口确认切换为 170px/449px 双栏布局。服务依赖内容的完整数据态继续由源码契约与 production build 覆盖。
- 修复 Desktop 设置即时切换语言时的响应式失效：此前正文和分组标题会变英文，但左侧页面名、当前页标题、主题选项以及部分动态状态标签仍停留在中文；现在所有 helper 显式接收当前 `text`/`locale`，避免 Svelte 5 隐藏依赖。已在 620×480 深色英文状态逐项切换 22 页，标题全部即时翻译且无横向溢出，随后恢复中文与跟随系统。

### 定时任务：会话隔离改为下拉 + 修复默认值漂移
- **交互改为下拉**：`/settings/tasks` 编辑态的「会话隔离」由 `IosSwitch` 开关改为 `fresh` / `chat` 下拉（`NativeSelect`），两种模式一目了然，不再用开/关隐含表达。
- **修复 chat 跑一次变 fresh 的 Bug**：开关此前把「未显式设置 `sessionMode`」当作 `chat`（开关 off），而展示用的 Badge 和运行时（`resolveEventSessionMode`）对「未设置 + periodic」解析为 `fresh`，导致不动开关直接保存会写入空值、运行后显示成 `fresh`。现在编辑态用共享的 `effectiveSessionMode(item)` 以「实际生效模式」初始化下拉（Badge 也复用该 helper），保存时始终写入明确的 `fresh`/`chat`，选择不再漂移。

- Completed macOS Sandbox policy parity with Web: Observe/Build/Strict presets, enable/failure/env modes, relative env-file replacement, env allow/deny keys, network allow/deny domains, filesystem read/write rules, reset, fixed save footer, and diagnostics refresh are fully editable. Presets remain local drafts until save. Existing absolute env-file paths and all env values stay server-side. Verified with 61 focused server/client tests, 6/6 UI structural tests, `svelte-check` 0/0, Desktop/Web production builds, and an isolated standard/640px save-and-reload smoke.
- Improved macOS AI Provider management: built-in providers, self-hosted providers, and custom models now have distinct bilingual labels and grouped sections. The complete create/edit form opens in a 920px scrollable liquid-glass modal with a persistent action footer instead of being appended below the provider list; Escape, backdrop close, dark theme tokens, and narrow-window single-column layout are supported. Verified against an isolated temporary service at normal and 640px widths, plus frontend tests (5/5), `svelte-check` (0/0), Desktop production build, and Web production build.
- Refined the standalone macOS Settings shell against `Momo for Mac (standalone).html` / `DESIGN.md`: the sidebar now uses a real bilingual settings filter, compact 34px category rows, native titlebar spacing, and a status footer; the right pane now has fixed title chrome, an independent scrolling body, 46px grouped rows, horizontal appearance controls, layered liquid-glass materials, and translucent sticky save footbars. Existing fine-grained settings actions, light/dark themes, and responsive behavior are preserved. Verified with Desktop `svelte-check` (0/0), frontend tests (4/4), Rust tests (8/8), and production build; visual acceptance remains with the user on macOS as requested.
- Standardized macOS Desktop Settings i18n and DESIGN.md compliance: replaced hardcoded English (tool `Base URL`, Provider protocol options, Search route/strategy enums, Search/Image/Video engine names, TTS format/provider labels) with bilingual `text.*` keys; added a reusable show/hide API-key reveal control across Web Search, Image, Video, and TTS credential fields.
- Brought Desktop tool/provider panels to web parity polish: Search per-engine test-target selector; TTS test-provider selector plus Xiaomi MiMo voice dropdown; Provider per-row "Set as default", per-model verification badges, and an editable supported-roles chip row.
- Added Image/Video generation task-detail modal (preview + download + status/progress/error/timestamps) with 5s auto-polling for in-progress tasks; localized engine names in the task list and default-engine selector.
- Added a live model-routing compaction-trigger preview callout and a native timezone `<select>` (from `Intl.supportedValuesOf`) replacing the free-text field.
- Completed the whole-settings i18n sweep: localized header language label, Memory placeholders, Runtime Environment total count, Diagnostics connection state, Weixin QR-login placeholder, and the onboarding sidebar-resize label. Preserved the Desktop privacy boundary (no local paths/session ids/secret-bearing request params in the media-task projection).

### macOS Settings 功能对齐——Provider、模型路由与生成工具
- **完整 Provider 新建**：Settings 与首次引导统一使用完整 Provider 契约；新建时即可配置 Provider ID、协议、Base URL/path、默认模型、Thinking/Reasoning、多模型、模型能力标签、上下文窗口与启停状态，不再先创建单一 text 模型再二次编辑。
- **高级模型路由**：补齐 Subagent haiku/sonnet/opus/thinking 路由、fallback 策略、首 Token 超时、默认 Thinking、自动上下文压缩参数、压缩模型和运行时 timezone，并使用细粒度 `/api/desktop/model-routing` 保存。
- **搜索/图像/视频/TTS 可操作化**：四个原只读区域支持启停、默认路由/引擎、超时、模型、Base URL、凭据替换/显式清空、未保存值测试；图片/视频支持安全的最近任务查看与删除，TTS 支持系统音色和测试音频播放。
- **安全与交互**：保存使用各动态 key 的 Desktop API，保留未提交密钥；媒体任务契约过滤 session、请求参数和本地绝对路径。多个工具页的未保存状态独立保留，保存按钮固定在 `.settings-footbar`。界面沿用 `Momo for Mac (standalone).html` / `DESIGN.md` 的 macOS 分组卡片、主题 token、中英和窄窗口布局。
- **验证**：Desktop 回归测试 155/155、`svelte-check` 0 错误/0 警告、Desktop production build 与 Web production build 通过；常规和 680px 窄窗口真实渲染检查通过。真实第三方 Provider 请求仍需在有凭据环境做 smoke。

### macOS Settings 可操作迁移——外部渠道
- **统一实例管理**：Telegram、Feishu、QQ、Weixin 支持新增、编辑、删除、启停、关联 Agent、沙箱继承/强开/强关、允许会话列表，以及 `BOT.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑。
- **凭据安全**：Desktop 只读取“已配置”的凭据字段名，不回传 Token/Secret；留空保留原值，显式勾选才清空，编辑不会丢弃渠道实例的其它已支持字段。
- **渠道工具**：飞书支持使用已保存或尚未保存的 App ID/App Secret 测试连接；微信提供与 Web 页一致的本地登录链接二维码生成、清空和原链接打开能力。
- **验证**：渠道聚焦测试 56/56、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——MCP
- **服务管理**：stdio 与 HTTP MCP 服务支持新增、编辑、删除、启停，并可配置名称、命令或 URL、工具名前缀。
- **敏感配置边界**：已保存的 args、env 值、HTTP headers 与 cwd 不回传 Desktop，只展示计数、键名或已配置状态；用户可提交替换值或逐项显式清空，留空保留原配置。
- **验证**：设置回归测试 79/79、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Skills
- **Skill 启停**：已发现的全局、Bot、会话 Skill 可在 Desktop 逐项启用或禁用；WebView 只持有不可逆短 ID，服务端再解析真实路径。
- **搜索配置**：支持本地/API 技能搜索启停、Provider、模型、最大 Tokens、Temperature、超时和最低置信度，并使用固定保存底栏。
- **安全边界与验证**：Skill 磁盘路径、搜索 API Key/Base URL/path 不回传且更新时保留。设置回归测试 84/84、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Plugins
- **插件配置**：支持启用/禁用记忆能力、选择记忆后端，以及按插件目录声明动态渲染功能插件的布尔、文本、选择和密码字段。
- **凭据安全**：密码字段只返回已配置状态，支持替换和显式清空；未提交字段、hooks、插件 manifest/entry 路径均不会被覆盖或泄露。
- **验证**：设置回归测试 90/90、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Memory
- **完整操作**：支持全部/指定作用域的记忆列表和搜索、外部文件同步、写入、去重，以及记忆内容、标签、过期时间编辑和删除。
- **治理记录**：同一页面展示记忆写入拒绝记录，并可按原因、内容、渠道、用户和标签筛选；治理日志磁盘路径不回传。
- **验证**：设置回归测试 93/93、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Tasks
- **任务管理**：显示并筛选完整任务文本，支持单项/批量选择、触发和删除，以及文本、交付方式、会话模式、单次时间或周期 Cron/时区编辑。
- **运行时边界**：任务绝对 JSON 路径替换为不可逆 ID，服务端解析后复用 watched-event API 的路径白名单、格式校验和渠道 `triggerTask`。
- **验证**：设置回归测试 98/98、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### Molibot macOS App 原生麦克风录音与音频回放
- **根因**：Tauri 在 macOS 用 WKWebView，`navigator.mediaDevices` 不暴露，前端 `getUserMedia` 永远走不到，统一报「当前环境不支持麦克风录音」。与 dev/生产无关，正式包同样如此。
- **原生采集**：新增 Rust 模块 `apps/desktop/src-tauri/src/audio.rs`，用 `cpal` 打开默认输入设备，在独立线程持有 `!Send` 的 `cpal::Stream` 并缓冲样本；`stop` 时用 `hound` 编码为内存 WAV（16-bit PCM）并以 base64 返回。新增 `start_recording`/`stop_recording`/`cancel_recording` 三个命令与 `AudioState`。
- **麦克风授权修复**：原先只开流不申请权限，macOS 静默拒绝、只给静音（表现为「没监听麦克风」）。新增 `ensure_microphone_access()`，用 `objc2-av-foundation` 显式查询 `AVCaptureDevice` 授权状态并在未决时调 `requestAccessForMediaType` 弹窗、阻塞等待结果；拒绝/受限/超时分别返回明确错误。
- **前端接线**：`ChatView.svelte` 录音改为优先调用 Tauri 命令（`__TAURI_INTERNALS__` 探测），把返回的 base64 WAV 还原成 `File` 加入待发送附件；保留纯浏览器 `npm run dev` 的 `MediaRecorder` 回退路径。录音中禁用重复触发。
- **音频回放**：待发送录音 chip 内嵌 `<audio controls>` 即时试听（object URL 随 `pendingFiles` 增删创建/回收，用独立 tracking map 避免响应式自写循环）；已发送消息的音频附件新增「播放」按钮，按需经 `fetchDesktopFileBlob` 拉取并内联播放，URL 在切换会话/销毁时回收。新增 i18n `play`。
- **附件发送 CSRF 修复**：打包后带附件（如录音）发送报 `Cross-site POST form submissions are forbidden`——multipart `/api/chat` 请求来自 WebView 的 `tauri://localhost` origin，与 loopback 服务端 origin 不符被 SvelteKit CSRF 拦截。在服务端 `svelte.config.js` 的 `kit.csrf.trustedOrigins` 加入 `tauri://localhost`：保留 Web 部署的完整 CSRF 防护，只放行这一个固定的桌面 origin。运行时随 `prepare:runtime`（root `npm run build`）打包生效。
- **验证**：`cargo check` 通过、Desktop `svelte-check` 0/0。原生录音、回放、附件发送已在打包版实测通过。

### macOS Settings 可操作迁移——Provider、Web Profile、Agent
- **AI Provider 管理**：自定义 Provider 支持编辑、删除、启停、默认项、Key 替换/清空、模型注册表增删与启停、能力标签、上下文窗口、默认模型、远端模型发现、逐模型验证、Thinking 格式和推理力度映射；全局 Provider mode、Pi Provider/模型与默认自定义 Provider 可保存。已保存 Key 不回传 Desktop。
- **Web Profile 管理**：支持新增、编辑、删除、启停、关联 Agent、沙箱继承/强开/强关，以及 `BOT.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑。编辑时保留 Desktop 不可见的 credentials/allowedChatIds。
- **Agent 管理**：支持新增、编辑、删除、启停、沙箱覆盖、文本/视觉/STT 专有模型路由，以及 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑；仍被渠道引用的 Agent 拒绝删除。
- **验证**：目标测试 70/70、Web production build、Desktop production build、Desktop Svelte check 0/0。设置功能迁移继续推进到渠道、MCP、Skills、Memory、Tasks 与媒体能力。

## 2026-06-28

### Molibot macOS App 设置——Web 功能迁移启动与重连修复
- **重连操作修复**：移除所有 Desktop Settings 页面底部无条件出现的「重新检查」。本地服务健康时不再渲染该底栏；仅断开时显示语义明确的「重新连接服务」。
- **AI 服务商首条功能迁移**：Desktop Settings → AI 服务商在新 macOS UI 中支持新增自定义服务商、一次性提交 API Key、保存后刷新列表，以及验证已保存服务商的真实连接。密钥只在保存请求中传入，服务端测试按 provider id 读取，不向 WebView 回显。
- **设计与验证**：新增表单采用共享语义 CSS、中英即时切换、明暗主题 token、窄窗口单列布局和固定保存底栏。目标测试 55/55、Desktop `svelte-check` 0/0、Desktop 与 Web production build 均通过；其余 Web 设置动作按 `prd.md` 分批迁移。

### Molibot macOS App Chat 输入、录音与 Markdown 可读性修复
- Chat 输入框现在直接用“Enter 发送 · Shift+Enter 换行”（英文同步）作为 placeholder，不再把提示挤在发送按钮左侧。
- 原先错误跳转到 TTS 设置页的麦克风按钮已接回现有 `MediaRecorder` 录音流程；录音时显示双语计时条、脉冲状态、取消与完成操作，完成后作为待发送音频附件加入当前消息。macOS bundle 增加麦克风用途声明。
- AI 消息的 fenced code block 改为保留换行并在容器宽度内自动折行，禁用横向滚动条；新增 3 个 Chat UI 回归检查。Desktop Svelte check 0/0、生产构建和 Info.plist 校验通过。

### Molibot macOS App Phase 4 设置——语音（TTS）只读区
- **语音区**：Settings 新增「语音」区，只读展示 TTS 配置（启用、默认提供方）与两个提供方：macOS 系统语音（音色/格式，无密钥）与小米 MiMo（是否配置密钥、模型、Base URL、音色、格式），状态徽标文本+颜色（§8 "语音"）。这是 §8 最后一个待补设置区。
- **凭据安全映射**：新增 `desktopTtsGenerate.ts`（`buildDesktopTtsSummary` + 两个 per-provider 构造器）逐字段投影；小米 `apiKey`→`hasApiKey`，macOS 无密钥。新增 `/api/desktop/tts-generate` GET、`DesktopTtsSummary`/`DesktopTtsProvider` 契约、`loadDesktopTts` loader、能力 scope。
- **验证边界**：`desktopTtsGenerate.test.ts` 4/4（macOS 无密钥；小米 `apiKey`→bool 且不泄露；空密钥；summary 保序不泄露）——desktop-chat 128/128、Desktop check 0/0、Desktop+Web build 通过。真实配置实机 smoke 待补。**至此 §8「保留现有全部设置能力」全部 22 个区均已在桌面端落地。**

### Molibot macOS App Phase 4 设置——视频生成只读区
- **视频区**：Settings 新增「视频」区，复用图像/视频共享的媒体映射器只读展示视频生成配置和各引擎状态（是否配置密钥、模型、Base URL），布局与图像区一致（§8 "视频"）。
- **复用实现**：`/api/desktop/video-generate` GET 复用 `buildDesktopMediaGenerateSummary`（每引擎 `apiKey`→`hasApiKey`）；新增 `DesktopVideoGenerateResponse` 契约别名、`loadDesktopVideoGenerate` loader、能力 scope。无新增映射器/测试（共享映射器已被 `desktopMediaGenerate.test.ts` 覆盖）。
- **验证边界**：desktop-chat 124/124、Desktop check 0/0、Desktop+Web build 通过。真实配置实机 smoke 待补。

### Molibot macOS App Phase 4 设置——图像生成只读区
- **图像区**：Settings 新增「图像」区，只读展示图像生成配置（启用、默认引擎）与每引擎状态（是否配置密钥、模型、Base URL）+ 计数（总/启用/已配置）（§8 "图像"）。
- **可复用媒体映射器**：因图像与视频设置结构完全一致，新增共享 `desktopMediaGenerate.ts`（`buildDesktopMediaEngine` + `buildDesktopMediaGenerateSummary`）与共享 `DesktopMediaGenerateSummary`/`DesktopMediaEngine` 契约，每引擎 `apiKey`→`hasApiKey`，保留 baseUrl/model；新增 `/api/desktop/image-generate` GET、`loadDesktopImageGenerate` loader、能力 scope。
- **验证边界**：`desktopMediaGenerate.test.ts` 4/4（密钥→bool 且不泄露；未配置引擎；summary 计数；缺 engines map）——desktop-chat 124/124、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 4 设置——联网搜索只读区
- **搜索区**：Settings 新增「搜索」区，只读展示联网搜索配置（启用、默认路由/引擎、选择策略、最大结果数）与每个引擎状态（是否配置密钥、Base URL）+ 计数（总/启用/已配置密钥）（§8 "搜索"）。
- **凭据安全映射**：新增 `desktopWebSearch.ts`（`buildDesktopWebSearchSummary` + per-engine 构造器），每引擎 `apiKey`→`hasApiKey`，保留 baseUrl（端点非密钥）；新增 `/api/desktop/web-search` GET、`DesktopWebSearchSummary` 契约、`loadDesktopWebSearch` loader、能力 scope。
- **验证边界**：`desktopWebSearch.test.ts` 4/4（密钥→bool 且不泄露；未配置引擎；summary 计数+不泄露；缺 engines map）——desktop-chat 120/120、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 4 设置——插件只读区
- **插件区**：Settings 新增「插件」区，只读展示已加载插件（渠道/服务商/功能/记忆后端）：名称、版本、种类、来源（内置/外部）、状态徽标（活跃/错误/已发现）+ 计数（总/活跃/外部）（§8 "插件"）。
- **完成孤立映射器**：此前 `desktopPlugins.ts` 仅有映射器无路由/测试/UI。本切片端到端接入：新增 `/api/desktop/plugins` GET（映射 `runtime.pluginCatalog`，丢弃 `manifestPath`/`entryPath`/`settingsFields`）、`desktopPlugins.test.ts`、`loadDesktopPlugins` loader、能力 scope。种类/状态标签用显式三元表达式直接引用 `text`（保持 locale 切换响应式，避免 Svelte-5 响应式陷阱）。
- **验证边界**：`desktopPlugins.test.ts` 4/4（丢弃路径/secret；未知种类/状态 coerce；已知种类顺序+计数；空目录）——desktop-chat 116/116、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 3 外部会话——Bot 实例层级
- **多实例自动分层**：外部渠道只读侧栏现按计划 §7.2「单实例时直接显示会话。多实例时自动增加 渠道 → Bot 实例 → 会话 层级」分层。某渠道有多个不同 `botInstanceName` 时渲染每个实例的子标题与其会话；单实例或旧无元数据渠道保持扁平（渠道徽标内联）。旧无元数据会话归入 null 实例桶，仅在渠道被拆分时显示「未指定 Bot 实例」标题。
- **可测试纯函数**：新增 `groupExternalSessionsByInstance`（返回有序 `ExternalChannelSection[]`，含 `showInstances` + per-instance 段，保持服务端渠道顺序与组内最新优先）。复用现有 `/api/desktop/external-sessions` 契约（已投影 `botInstanceName`），渠道适配器填充后层级自动出现。
- **验证边界**：新增 api 单测 3 例（单实例扁平；多实例拆分并保序；旧无元数据→null 桶）——desktop-chat 112/112、Desktop check 0/0、Desktop build 通过。改动仅限桌面端，无 Web/server 源码变更。

### Molibot macOS App Phase 4 首次启动——诊断步骤
- **可工作的第五步**：§9.2 onboarding 的「诊断」步骤不再是延期占位。只读展示运行环境诊断概览：本地服务就绪状态 + 依赖已安装/总数 + 缺失可选依赖名称，并提示前往 设置 → 运行环境（计划 §9.2 step 5「展示运行环境诊断」）。仅信息展示，缺失可选依赖不阻止「完成」。
- **复用端点**：新增纯函数 `summarizeOnboardingDiagnostics(runtimeEnv, serviceReady)`，复用 `/api/desktop/runtime-env`；加载折入 `connect()` 的 `Promise.all` 并 `.catch(()=>null)`（信息性、非关键），断连重置。**至此 §9.2 五步引导全部实现（provider/agent/channels/launch/diagnostics），无剩余延期占位。**
- **验证边界**：新增 api 单测 2 例（服务+依赖状态+缺失名；null runtime→空）——desktop-chat 109/109、Desktop check 0/0、Desktop build 通过。

### Molibot macOS App Phase 4 首次启动——渠道步骤
- **可工作的第三步**：§9.2 onboarding 的「渠道」步骤不再是延期占位。只读展示已配置外部渠道（每渠道 已启用/总数 + 已启用实例计数），并提示前往 设置 → 渠道 连接/编辑（计划 §9.2 step 3「可选连接渠道」）。引导内无输入/连接控件，该步可选、不门控「下一步」。
- **复用端点**：新增纯函数 `summarizeOnboardingChannels(summary)`，复用 credential-safe `/api/desktop/channels`；加载折入 `connect()` 的 `Promise.all` 并 `.catch(()=>null)`，断连重置。
- **验证边界**：新增 api 单测 2 例（有序投影+计数；null summary→空）——desktop-chat 107/107、Desktop check 0/0、Desktop build 通过。改动仅限桌面端，复用既有端点。

### Molibot macOS App Phase 4 首次启动——Provider 提交/验证
- **外部渠道会话右侧展示**：修复了点击左侧“外部渠道”会话时内容依然挤在窄侧边栏展示的问题。现将外部渠道的 transcript 统一呈现在右侧主对话视口 `.messages` 中，复用了 Markdown 渲染与附件芯片样式；并在底部展示只读提示横幅，保证外观和操作逻辑与本地对话完全一致。同时移除了侧栏的临时 `.external-transcript-panel`。
- **输入框区域置底固定与消息滚动**：修复了 ChatView 消息较多时或搜索栏开启时，底部输入框区域 `.composer-wrap` 会随页面内容向上滚走的问题。将 `.chat-content` 主容器升级为 `display: flex; flex-direction: column; height: 100%; min-height: 0;`（`min-height: 0` 强行约束高度），并将 `.messages` 设置为 `flex: 1; min-height: 0;`。这确保无论是在普通对话、搜索栏开启还是特殊状态提示下，消息区域都可以在高度内自动滚动，而头部和输入框永远稳固钉在界面两端。
- **列表滑动翻页修复**：修复了 macOS App 内所有长列表在小屏幕或内容溢出时无法使用鼠标滑轮滚动的体验问题。对 `.settings-content` 配置了 `overflow-y: auto` 并设置了 padding-bottom 留空；将 `.settings-footbar` 保存栏改为 `position: sticky; bottom: 0` 粘性置底；使 `.chat-sidebar` 与 `.settings-sidebar` 支持 `overflow-y: auto` 滚动；限制外部会话列表 `.external-list` 与文件列表 `.file-list` 容器高度并启用垂直滚动；对首启引导卡片 `.onboarding-card` 限制最大高度并支持滚动。
- **可工作的首个步骤**：§9.2 onboarding 的 Provider 配置步骤不再是占位说明。新增了 Provider 提交和真实连接测试的完整功能闭环。
- **安全设计与 API**：
  - 新增服务端 `/api/desktop/providers` [POST] 及纯函数 `buildNewCustomProvider`：接收 Provider 配置，创建带有 `desktop-` 唯一时间戳 ID 的 CustomProvider，自动配置 text model 并将 `providerMode` 切为 `"custom"`。API Key 仅本地安全保存，不在任何接口响应中泄露。
  - 新增服务端 `/api/desktop/provider-test` [POST]：接收 `providerId`，从服务端读取 API 密钥后，调用已有的真实 `testCustomProvider` 执行远程连接验证。密钥绝不传回 WebView。
  - 新增客户端 API `submitDesktopProvider` 与 `testDesktopProvider`。
- **UI 与交互**：ChatView 首启引导中移除 deferred 延期占位，增加了「保存 Provider」与「验证连接」的操作流程与 loading/success/error 响应式状态。Next 按钮现被 `providerSubmitted` 状态门控，要求成功保存后才能继续，但不强制连接成功（允许进入主界面/设置排障）。
- **能力授权**：在 Tauri `default.json` 权限配置中，将 `/api/desktop/provider-test` 的 loopback 访问权限注册到 scopes，保证请求的安全发起。
- **验证**：新增 `desktopProviderSubmit.test.ts` (5个服务端用例，验证构造合法性与 credentials 隔离不泄露)；`api.test.ts` 新增 2 例 mock-fetch 用例。全部 105 个桌面测试通过，`svelte-check` 0 错误/0 警告。

### Molibot macOS App Phase 4 首次启动——登录启动步骤
- **可工作的第四步**：§9.2 onboarding 的「登录启动」不再是占位说明。它复用现有 Tauri `tauri-plugin-autostart` / macOS LaunchAgent 与 `set_login_start(enabled)` 命令，通过 App→Chat 显式异步回调展示默认关闭的双语 Switch、保存中状态、实际返回状态和错误；浏览器预览只更新内存，不写 OS scheduler。
- **精简修复流程**：新增 `resolveOnboardingStartStep` 与 `resolveOnboardingRepairTarget`。已有模型但缺 Web Profile 的损坏配置直接从 Agent 步骤开始；引导锁定初始 `new/usable/broken` 模式和缺失目标，Agent 保存使 readiness 变为可用后仍继续 Channels→Launch→Diagnostics，且顶部提示不会错误翻转。
- **验证**：desktop-chat 回归 98/98、Rust 8/8、Desktop Svelte check、Desktop production build、现有 Web production build通过。隔离临时数据页面验证到第 4 步：默认关闭、可访问 `role=switch`、中英状态文案和完整修复路径均真实渲染。

### Molibot macOS App Phase 4 首次启动——Agent / Web Profile 确认
- **可工作的第二步**：§9.2 onboarding 的 Agent 步骤不再显示占位说明。Desktop 从既有 credential-safe `/api/desktop/agents` 与 `/api/desktop/profiles` 读取已启用 Agent 和 Web Profile，提供双语选择器、保存中/成功/错误状态；只有确认保存成功后才可进入下一步。若确认时 Chat 尚无活动 Profile，成功启用后会立即走既有 `loadProfile` 会话路径，避免完成引导后输入区仍未连接。
- **细粒度安全保存**：`DesktopWebProfilePatch` 与 `/api/desktop/profiles` PATCH 新增可选 `agentId`，服务端校验目标 Agent 存在，只更新指定 Web Profile 的 `agentId`/`enabled`，保留 credentials、allowedChatIds、sandbox override、显示配置、其他 Profile 和其他渠道。未知 Agent 会拒绝且不修改设置。
- **响应式与验证**：onboarding 标题、提示、步骤名和步骤计数改为显式 `$:` 派生状态，移除模板中的无参数 helper。完整 desktop-chat 回归 96/96、Desktop Svelte check、Desktop production build、现有 Web production build 通过；隔离临时数据页面 smoke 已验证中文修复分支与五步布局。Profile 创建仍由 Settings 完成；Launch 已在后续切片交付，Provider 提交/验证及 Channels/Diagnostics 继续后续实现。

### Molibot macOS App Phase 4 引导健康检查摘要
- **既有配置健康检查**：首次启动引导的 `usable` 分支（已存在可用配置）现展示「迁移和健康检查摘要」卡片（计划 §9.1「已存在可用 Provider/模型：显示一次迁移和健康检查摘要」）：两行分别列出检测到的文本模型（标签或「未配置」）与 Web Profile 数量（或「未启用」），加一行就绪/未就绪状态。由新增纯函数 `buildOnboardingHealthCheck(readiness, labels)` 构建（locale 无关、标签可注入），卡片边框/状态颜色反映就绪状态，文本标签承载含义（§14 状态不仅靠颜色）。
- **验证边界**：新增 api 单测 1 例（ready + 缺模型 + 缺 Profile 三分支）——desktop-chat 套件 93/93、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。复用已加载的 readiness 数据，无需新端点。

### Molibot macOS App Phase 4 引导式首次启动——Provider 步骤
- **多步引导流**：首次启动引导覆盖层在 `new`/`broken` 配置下升级为 §9.2 五步引导：provider → agent → channels → launch → diagnostics。含步骤指示（`Step n/total`）、有序步骤列表（active/done 状态）、上一步/下一步/完成导航，末步显示「完成」。`usable` 配置仍保留简单摘要 + 继续。
- **凭据盲的 Provider 草稿表单**：provider 步渲染表单（名称、协议、Base URL、模型、API Key），由新增纯函数 `validateProviderDraft` 实时校验（仅结构：名称/模型非空、已知协议、http(s) Base URL、apiKeyPresent）。API Key **绝不存入草稿**——仅 `apiKeyPresent: boolean`；密钥只活在输入框，提交/验证明确标注将在后续版本接入（需桌面端令牌 §11.1）。下一步在草稿未通过校验时禁用。
- **纯函数可测**：新增 `ONBOARDING_STEPS`（有序）、`OnboardingStep`、`ProviderDraft`/`ProviderDraftValidation`、`validateProviderDraft`（不联网、不处理密钥）、`advanceOnboardingStep`。双语 i18n（步骤标签、字段标签、已输入/未输入、上一步/下一步/完成、步骤模板、提交延期说明）与语义化 CSS（`.onboarding-steps`/`.onboarding-field`/`.onboarding-error`）。
- **验证边界**：新增 api 单测 3 例（`validateProviderDraft` 接受完整草稿 + 拒绝各缺失字段 + 错误 URL；`ONBOARDING_STEPS` 顺序；`advanceOnboardingStep` 前进与末步返回 null）——desktop-chat 套件 92/92、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。Provider 提交/验证、agent/channels/launch/diagnostics 步骤表单与真机 smoke 留作后续切片（需桌面端令牌 + 服务端创建/验证路由或运行服务）。

### Molibot macOS App Phase 4 运行环境设置区
- **只读依赖检测展示**：Settings 新增「运行环境」区（位于「诊断」之后），提供计数卡片（已安装 / 未安装 / 总数）与每行一条可选依赖：名称、状态徽标（已安装/未安装/未知）、用途、版本、来源、预计体积，以及 `<code>` 块中的准确安装命令。底部说明「安装功能将在后续版本提供逐项授权安装」——本区仅检测/展示，不执行安装（计划 §10「用户逐项明确授权，禁止静默安装」）。Node 因已由内置 sidecar 满足而故意省略。
- **服务端检测**：新增 `desktopRuntimeEnv.ts`，含 `DESKTOP_RUNTIME_DEPENDENCIES` 声明表（ffmpeg/git/python3）、可注入的 `detectRuntimeDependency`（经 `command -v` 解析、按解析路径判别 homebrew vs system 来源、探测版本、永不抛错）、纯 `buildDesktopRuntimeEnvSummary`/`buildDesktopRuntimeDependency` 映射器，以及 `formatRuntimeInstallCommand`（homebrew → `brew install <formula>`；tooling → `pip install --target ~/.molibot/tooling`；禁 `sudo`、禁 `npm -g`、禁改系统 Python）。映射器丢弃解析出的二进制路径，仅保留来源类别（§11 不变式，逐字段构建）。新增 `/api/desktop/runtime-env` GET 与契约类型。
- **验证边界**：新增服务端 `desktopRuntimeEnv.test.ts` 7/7（安装命令格式化 homebrew/tooling/system；缺失检测；homebrew vs system 来源判别；映射器投影展示字段并丢弃解析路径；空来源回退；summary 计数与声明顺序；声明依赖无 sudo/npm -g），api 单测新增 1（`missingRuntimeDependencies` 仅返回未安装项）——desktop-chat 套件 89/89、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/runtime-env` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真机检测 smoke 与逐项授权安装执行（PATH 恢复、实时日志、取消/重试）留作后续 §10 切片。

### Molibot macOS App Phase 4 首次启动引导覆盖层
- **三分流引导**：ChatView 在服务就绪后展示一次性、由 localStorage 门控的引导覆盖层（`molibot-desktop-first-launch-seen`）。通过新增纯函数 `classifyFirstLaunch` 将就绪摘要分为计划 §9.1 三分支：`new`（无模型且无 Profile → 完整配置引导）、`usable`（两者皆有 → 可直接对话的摘要）、`broken`（仅有一项 → 指明缺失项的精简修复引导，不覆盖既有配置）。每个分支含「打开设置」按钮；`usable` 另含「继续」，`new`/`broken` 另含「不再提示」。任一操作写入 seen 标志，覆盖层不再出现。
- **纯客户端可测**：`classifyFirstLaunch` 为纯函数，双语 i18n（`onboardingTitleNew/Usable/Broken`、`onboardingHintNew/Usable/BrokenModel/BrokenProfile`、`onboardingContinue`、`onboardingDontShowAgain`）与语义化 CSS（`.onboarding-overlay`/`.onboarding-card`/`.primary-button`，遵循 DESIGN.md，无裸 Tailwind）。`new` 分支不显示「继续对话」主操作，符合 §9.1「全新安装不得假装配置完成」。
- **验证边界**：新增 api 单测 1 例（覆盖 usable / new（空 + null 模型）/ broken-model / broken-profile 四分支）——desktop-chat 套件 81/81、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。覆盖层的真机行为（真实就绪数据、真实设置导航）需运行服务 smoke。完整 §9.2 引导式 provider/agent/渠道配置与 §9 既有配置迁移摘要留作后续切片。

### Molibot macOS App Phase 3 外部渠道只读 transcript 面板
- **只读 transcript 查看**：在「外部渠道」分页中点击某条外部会话，通过新增的 `/api/desktop/external-sessions/[id]` GET 加载只读 transcript，在侧栏内嵌面板渲染：标题 · 会话类型 · 渠道 的头部（含关闭按钮），随后逐条展示消息（角色标签、Markdown 渲染内容、附件名）。无输入框、无重命名、无删除、无归档，外部 transcript 保持只读（计划 §7.2「支持查看…当前 transcript」）。重复点击当前行无操作；切回「本地」清空面板。
- **服务端契约**：新增 `SessionStore.getExternalSession(id)`（按 id 解析单条非 web 会话，web/未知/陈旧返回 null）与凭据/路径安全的 `/api/desktop/external-sessions/[id]` GET，经 `buildDesktopExternalTranscript` + `buildDesktopExternalTranscriptMessage` 投影。映射器复用列表的会话投影，并逐字段显式投影消息——**丢弃** 附件的磁盘 `local` 路径（外部附件无法经 Web 文件端点预览，仅保留 original/mediaType/mimeType/size），**过滤掉 `system` 角色消息**（控制指令不得作为普通 transcript 呈现，计划 §12）。新增 `DesktopExternalTranscript`/`DesktopExternalTranscriptMessage`/`DesktopExternalTranscriptResponse` 到共享契约。
- **验证边界**：服务端 `desktopExternalSessions.test.ts` 增至 9/9（新增：transcript 消息丢弃 local 路径并过滤 system；transcript 投影元数据与有序非 system 消息），api 单测新增 1（`groupExternalTranscriptByRole` 计数）——desktop-chat 套件 80/80、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/external-sessions/*` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真实渠道数据实机 transcript smoke 留作后续。§7.3 实时事件流与统一审批中心留作后续 Phase 3 切片。

### Molibot macOS App Phase 3 外部渠道只读视图
- **本地/外部分页**：ChatView 侧栏新增「本地 / 外部渠道」分页切换。选择「外部渠道」时通过新增的 `loadDesktopExternalSessions` 客户端 loader 加载 `/api/desktop/external-sessions`，按渠道分组只读展示外部会话——每行含渠道徽标、会话类型（私聊/群聊/频道）、可选 Bot 实例/发送者、更新时间。无输入框、无重命名、无删除、无归档，外部 transcript 保持只读（计划 §7.2）。连接后加载一次，切页时懒加载；空/加载中/错误状态内联处理。
- **可测试的纯函数**：新增 `groupExternalSessionsForView`（将分组 summary 展平为有序视图列表，保持服务端分组与最新优先顺序）与 `formatExternalSessionPreview`（生成 `Bot 实例 · 线程 · 发送者` 紧凑预览）。新增双语 i18n（`externalChannels`、`externalChannelsHint`、`noExternalSessions`、`chatTypePrivate/Group/Channel`）与语义化 CSS（`.view-tabs`/`.view-tab`/`.external-*`，遵循 DESIGN.md，无裸 Tailwind 工具类）。
- **验证边界**：新增 api 单测 3 例（分组展平保序并携带展示字段；空 summary；预览拼接 Bot 实例/线程/发送者并降级为空）——desktop-chat 套件 77/77、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。真实外部会话列表实机 smoke 与只读 transcript 面板 / 实时事件流（§7.3）留作后续 Phase 3 切片。

### Molibot macOS App Phase 3 外部渠道会话聚合（列表/契约起步）
- **共享 session 元数据扩展**：在共享 `Conversation` 类型上新增向后兼容的可选 `external?: ExternalSessionMetadata`（Bot 实例 id/名称、发送者 id/名称/头像、会话类型 private·group·channel、线程 id/标题、来源平台），供渠道适配器后续填充；旧记录缺失时省略该字段，符合计划 §7.2「现有 session schema 需要向后兼容地增加可选元数据」。元数据定义置于共享 session 层而非渠道代码。
- **外部会话枚举**：`SessionStore` 新增 `listExternalSessions()`，遍历 legacy session 索引，跳过 `web`，按 `updatedAt` 倒序加载每个非 web 会话文件，并跳过索引中文件已缺失的陈旧条目。
- **凭据安全的只读聚合端点**：新增 `/api/desktop/external-sessions` GET，经 `buildDesktopExternalSessionsSummary` + `buildDesktopExternalSession`（`desktopExternalSessions.ts`）按 telegram/feishu/qq/weixin 已知顺序分组（排除 `web` 与 `cli`），每个会话仅投影展示字段——id、标题、updatedAt、会话类型、发送者名、可选头像/线程标题/Bot 实例名、平台。原始 `externalUserId` 经 `maskExternalUserId` 截断为 8 字符预览（完整平台 id 不抵达 WebView），列表从不加载消息内容，旧记录无元数据时回退为 `chatType=private` / `senderName=掩码 id` / `platform=渠道`（计划 §7.2「旧记录缺失元数据时使用稳定 fallback，不回头批量请求平台补全」）。
- **验证边界**：新增服务端 `desktopExternalSessions.test.ts` 7/7（掩码截断+直通；缺失元数据回退为掩码 id+私聊且原始 id 不泄露；元数据投影；空标题+空发送者回退；分组按已知渠道排序且排除 web/cli；空 summary；渠道内顺序保持），`store.test.ts` 新增 `listExternalSessions` 用例（2 个 telegram 会话按最新优先排序、排除 web、暴露 externalUserId/channel）——desktop-chat 套件 74/74、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/external-sessions` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真实渠道数据实机 smoke 留作后续。只读 transcript 视图、实时事件流（§7.3）、统一审批中心与通知留作后续 Phase 3 切片。

### Molibot macOS App Phase 5 GitHub Actions unsigned-DMG 发布流水线
- **可复现的 unsigned-beta 构建流水线**：新增 `.github/workflows/desktop-release.yml`（仓库首个 CI 流水线），按计划 §16.1 / Phase 5 在 `macos-14`（Apple Silicon）runner 上产出 unsigned DMG。触发方式：推送 `molibot-v*` tag（发布 prerelease GitHub Release）与 `workflow_dispatch`（仅构建冒烟，不发布）。
- **构建步骤**：Setup Node 22 + stable Rust，缓存 Cargo，安装根目录与 `apps/desktop` 依赖，执行 `npm run desktop:build`（= 准备内嵌 Node 22.23.1 sidecar runtime → `tauri build --ci`（`tauri.bundle.conf.json`）→ `finalize-desktop-release.mjs` 写 `.sha256`）。随后生成 BUILD-INFO 清单（版本、git commit/ref、构建时间、runner OS/arch、Node/Rust 版本、macOS 13.0 部署目标、内嵌 sidecar Node 版本、明确的 unsigned/未公证说明），上传 `molibot-desktop-dmg` workflow artifact，并在 tag 推送时通过 `softprops/action-gh-release@v2` 发布含 DMG + `.sha256` + 清单的 prerelease（自动生成 release notes）。`MACOSX_DEPLOYMENT_TARGET=13.0` 与 bundle `minimumSystemVersion` 一致。
- **验证边界**：仅配置改动，未触及 Web/server 运行时代码，故无 Web 回归；YAML 已校验（11 步、`runs-on: macos-14`）。真实 DMG 生产仍需真实 macOS runner（受限沙箱无法运行 `hdiutil`/`tauri build`），端到端验证留待真实 `molibot-v*` tag 构建或 `workflow_dispatch` 运行。`molibot-v*` tag 与现有服务端/Web 产品的 `v*` tag 分离，保持发布语义不混淆。

### Molibot macOS App Phase 4 渠道设置区
- **只读渠道展示**：Settings 新增「渠道」区（位于「内存」之后），提供计数卡片（实例总数 + 已启用）与按外部渠道分组：每组一个子标题（`渠道 · 已启用/总数`）外加每个 Bot 实例一行，显示名称、关联 Agent、放行会话数、沙箱覆盖（继承/是/否）、启用/禁用状态徽标（文本+颜色，符合 §14）。Web 渠道排除在外（已有独立的 Web Profiles 区）（计划 §8 Telegram/Feishu/QQ/Weixin）。
- **凭据安全**：新增 `/api/desktop/channels` GET，经 `buildDesktopChannelsSummary` + `buildDesktopChannelInstance` 投影 runtime 设置。映射器过滤掉 `web` 渠道，已知渠道（telegram/feishu/qq/weixin）优先排序，每个实例保留 id/name/enabled/agentId、三态沙箱覆盖、`allowedChatCount`，**整体丢弃** 实例 `credentials`（Bot Token / App 密钥）并将 `allowedChatIds` 降为计数——渠道密钥不抵达 WebView。
- **验证边界**：新增服务端 `desktopChannels.test.ts` 3/3（实例丢弃 credentials 并将 allowedChatIds 降为计数——断言 `SECRET-BOT-TOKEN`/`sk-secret-app`/`credentials` 不泄露；summary 排除 web、已知渠道优先排序、统计实例；缺失沙箱覆盖→继承），desktop-chat 套件 65/65（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含夹具 Bot Token/App 密钥以证明映射器会剥离。`/api/desktop/channels` 已加入 Tauri HTTP capability scope。真实 Bot 实例实机 smoke 留作后续。编辑渠道实例/凭据与实时连接状态留作后续（后者属 Phase 3 外部渠道聚合）。

### Molibot macOS App Phase 4 内存设置区
- **只读内存状态展示**：Settings 新增「内存」区（位于「Skills」之后），提供状态卡片（运行时启用、配置启用、后端名称）与能力卡片（混合检索、向量检索、增量刷新、分层记忆），每项为 yes/no 徽标（文本+颜色，符合 §14）。仅读取后端状态，绝不读取任何记忆内容（计划 §8「内存」）。
- **隐私安全**：新增 `/api/desktop/memory` GET，经 `buildDesktopMemorySummary` 将 `settings.plugins.memory`（enabled/backend）与运行时 `runtime.memory.isEnabled()`、`runtime.memory.capabilities()` 组合。记忆记录含用户内容，故映射器刻意从不 list/search 记录——只暴露后端名称、配置/运行时启用标志与四个能力标志。
- **验证边界**：新增服务端 `desktopMemory.test.ts` 2/2（映射 config + 运行时状态 + 能力标志；内存配置缺失时回退为禁用/空后端），desktop-chat 套件 62/62（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/memory` 已加入 Tauri HTTP capability scope。真实后端实机 smoke 留作后续。查看/编辑/删除记忆记录不在范围内（记录内容属用户数据）。

### Molibot macOS App Phase 4 Skills 设置区
- **只读 Skill 展示**：Settings 新增「Skills」区（位于「MCP」之后），提供计数卡片（总数 / 已启用 / 按作用域 global·bot·chat）与技能搜索状态（本地启用徽标、API 服务商/模型），以及每行一条 Skill 记录：名称、描述、作用域、归属 bot/chat、MCP 服务器数、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「Skills」）。
- **路径与凭据安全**：新增 `/api/desktop/skills` GET，复用共享 skills 路由的 GET（其忽略 RequestEvent，故传 `undefined`），再经 `buildDesktopSkillsSummary` + `buildDesktopSkillItem` 投影。映射器保留 name/description/scope/enabled/botId/chatId 并将 `mcpServers` 降为计数，**丢弃** 每个 skill 的 `filePath` 与 `baseDir`（绝对磁盘路径），以及路由的 `dataRoot`/`globalSkillsDir`/`diagnostics`/原始 `searchProviders`；`skillSearch` 仅保留 local/api 启用标志与 api provider/model，**丢弃** 技能搜索的 `api.apiKey`——磁盘路径与搜索密钥均不抵达 WebView。
- **验证边界**：新增服务端 `desktopSkills.test.ts` 3/3（item 丢弃 filePath/baseDir 并将 mcpServers 降为计数——断言 `/Users/secret`/`filePath`/`baseDir` 不泄露；未知 scope 归 global；summary 按作用域计数并丢弃技能搜索 api key——断言 `sk-secret-search-key` 不泄露），desktop-chat 套件 60/60（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/secret/...` 夹具路径与搜索 api key 以证明映射器会剥离。`/api/desktop/skills` 已加入 Tauri HTTP capability scope。真实技能文件实机 smoke 留作后续。启用/禁用 Skill、查看 SKILL.md 内容与技能草稿管理留作后续切片。

### Molibot macOS App Phase 4 MCP 设置区
- **只读 MCP 展示**：Settings 新增「MCP」区（位于「Agent」之后），提供计数卡片（总数 / 已启用 / stdio / http）与每行一条服务器记录：传输方式、命令（stdio）或 URL（http）、参数/env/请求头数量、可选工具名前缀、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「MCP」）。
- **凭据安全**：新增 `/api/desktop/mcp` GET，经 `buildDesktopMcpSummary` + `buildDesktopMcpItem` 投影 runtime 设置。映射器保留 id/name/enabled/transport/toolNamePrefix 与可识别的 `command`（stdio）/`url`（http），并将携带密钥的字段一律降为计数——stdio 的 `env` 值、`cwd`（绝对路径）、`args` 值（可能含内联 token），以及 http 的 `headers` 值（鉴权 token）——WebView 永远拿不到 MCP 凭据。
- **验证边界**：新增服务端 `desktopMcp.test.ts` 3/3（stdio 保留 command 但 env/cwd/args 降为计数——断言 `sk-secret-env-value`/`SECRET-ARG`/`/Users/secret` 不泄露；http 保留 url 但 headers 降为计数——断言 `sk-secret-header-token` 不泄露；summary 计 total/enabled/stdio/http 且无密钥泄露），desktop-chat 套件 57/57（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含夹具密钥/路径以证明映射器会剥离。`/api/desktop/mcp` 已加入 Tauri HTTP capability scope。真实服务器实机 smoke 留作后续。新增/编辑/删除 MCP 服务器与查看逐服务器工具列表留作后续切片。

### Molibot macOS App Phase 4 Agent 设置区
- **只读 Agent 展示**：Settings 新增「Agent」区（位于「AI 服务商」与「Web Profiles」之间），提供计数卡片（总数 + 已启用）与每行一条 Agent 记录：名称、描述、沙箱覆盖（继承/是/否）、逐 Agent 模型路由覆盖数、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「Agent」）。
- **窄契约投影**：新增 `/api/desktop/agents` GET，经 `buildDesktopAgentsSummary` + `buildDesktopAgentItem` 投影 runtime 设置。Agent 不含服务商密钥，故映射器并非"丢弃敏感字段"而是投影一个窄的展示形状——id/name/description/enabled、三态 `sandboxEnabled`（继承时为 null）、以及由 agent `modelRouting`（text/vision/stt key）推导的 `modelOverrides` 计数——而非把完整 settings 对象交给 WebView。
- **验证边界**：新增服务端 `desktopAgents.test.ts` 3/3（投影展示字段并计 1 个模型覆盖；缺失 routing/sandbox 时计 0 覆盖/继承；summary 计 total + enabled），desktop-chat 套件 54/54（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/agents` 已加入 Tauri HTTP capability scope。真实配置实机 smoke 留作后续。创建/编辑/删除 Agent 与逐 Agent 模型路由编辑留作后续切片。

### Molibot macOS App Phase 4 语言选择持久化与跨窗口同步
- **语言偏好持久化**：Settings 语言下拉的选择现经 `normalizeLocale` 校验后写入 `localStorage`，重启后保留；此前仅在内存生效、重启重置（计划 §8「支持中文和英文即时切换」）。
- **跨窗口实时同步**：Chat 与 Settings 两个 WebView 同源共享存储，通过 `storage` 事件实时同步语言切换，两窗保持一致；与既有主题处理一致。
- **验证边界**：新增 `normalizeLocale` 纯函数及单测（已知 locale + zh 变体映射 + fallback）；desktop-chat 套件 51/51、Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端、纯客户端，无服务端变更。

### Molibot macOS App Phase 4 Desktop Settings 起步：模型路由
- **多区设置导航**：Settings 窗口从单一「通用」扩展为可切换的左侧导航，新增「模型」区，沿用现有固定底栏、中英即时切换、Light/Dark/System 和紧凑布局；不嵌入现有 `/settings` 页面。
- **凭据安全的模型配置**：「模型」区按 text/vision/stt/tts/subagent 五条能力路由各提供一个下拉，复用现有 `/api/desktop/models`（现扩展为接受 `route` 参数，向后兼容默认 `text`）即时切换并与 Web 共享；返回项仅含 key/label/contextWindow，绝不向 WebView 暴露 Provider API key 或 Base URL，符合计划 §8/§11 的细粒度复用与凭据掩码要求。
- **验证边界**：服务端新增 `sanitizeDesktopModelRoute` 与路由化 `buildDesktopModelState` 单测（含五路由不泄漏凭据断言，desktop-chat 套件 20/20）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、**现有 Web production build 回归通过**、机器路径扫描干净。`/api/desktop/models` 改动为附加且向后兼容（ChatView 不传 route 仍走 text）。真机内 Settings 实操 smoke 待运行服务环境补充。

### Molibot macOS App Phase 4 环境就绪摘要
- **就绪健康卡片**：Settings「通用」区在服务就绪后展示「环境就绪」卡片，按文本模型与 Web Profile 两项给出「就绪/未配置」状态徽标与修复提示；为计划 §9 首启分流（全新/已有可用/损坏配置）提供凭据安全的判定信号。
- **纯客户端派生**：就绪状态由 `summarizeDesktopReadiness` 从现有 `/api/desktop/bootstrap`（Profile 列表）与 `/api/desktop/models`（文本路由 currentKey/options）派生，无新增服务端接口，不向 WebView 暴露任何 Provider 凭据；状态徽标同时用文字表达，不只靠颜色（§14）。
- **验证边界**：新增 `summarizeDesktopReadiness` 纯函数及单测（api 套件覆盖有/无模型与 Profile，desktop-chat 套件 22/22）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更，故无需 Web 回归；真机内 Settings 实操 smoke 待运行服务环境补充。

### Molibot macOS App Phase 4 Chat 首启分流（无可用模型引导）
- **不阻断的修复引导**：当本地服务就绪、已有 Web Profile，但未配置可用文本模型时，Chat composer 上方显示橙色引导横幅（标题 + 提示 + 「打开设置」按钮），并禁用附件、输入框与发送，避免「假装配置完成」；保留已有 transcript 历史可见，符合计划 §9「配置存在但不可用：精简修复引导」与「没有可用模型时...允许进入 Settings 排障」。
- **复用就绪判定**：`modelReady` 由上轮的 `summarizeDesktopReadiness` 从 ChatView 已加载的文本模型 `currentKey/options` 派生；`sendMessage` 增加 `!modelReady` 守卫，双重防止无模型时发送。无新增接口、无凭据暴露。
- **验证边界**：复用已测的 `summarizeDesktopReadiness`，本切片新增逻辑为模板绑定（派生态 + 横幅 + 禁用条件），由 Svelte check 与 production build 覆盖（desktop-chat 套件 22/22，0 错误/警告，build 通过，机器路径干净）。改动仅限桌面端，无服务端变更。

### Molibot macOS App Phase 4 诊断设置区
- **本地诊断视图**：Settings 新增「诊断」区，只读展示服务版本、服务所有权（由 Molibot 管理 / 外部服务）、本地 loopback 地址与连接状态；数据全部来自现有 `desktop_status`，不含任何 Provider 凭据或 token，符合计划 §11.3 与 §16.1。
- **脱敏复制**：提供「复制诊断信息」按钮，经 `buildDiagnosticsSummary` 生成仅含非敏感运行事实的多行文本写入剪贴板，复制后短暂显示「已复制」。
- **验证边界**：新增 `buildDiagnosticsSummary` 纯函数及单测（含缺失值 fallback 断言，desktop-chat 套件 23/23）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更。完整轮转日志与诊断包导出（§11.3）需原生文件写入，留作后续切片。

### Molibot macOS App Phase 4 显式主题切换（System/Light/Dark）
- **主题选择落地**：Settings「通用」区新增「外观」下拉（跟随系统 / 浅色 / 深色），默认跟随系统，补齐计划 §8「支持 Light、Dark、System，默认跟随系统」此前缺失的显式选择能力；此前仅靠 `@media (prefers-color-scheme)` 跟随系统。
- **持久化与跨窗口同步**：选择经 `normalizeTheme` 校验后写入 `localStorage` 并设置 `document.documentElement[data-theme]`；Chat 与 Settings 两个 WebView 同源共享存储，通过 `storage` 事件实时同步，重启后保留。CSS 重构为：显式 `:root[data-theme="dark"]` 始终深色、显式浅色保持浅色、未显式选择时 `:not([data-theme])` 仍跟随系统暗色媒体查询。
- **验证边界**：新增 `normalizeTheme` 纯函数及单测（已知值 + 非法值 fallback，desktop-chat 套件 24/24）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更。


### Molibot macOS App Phase 4 任务设置区
- **只读任务展示**：Settings 新增「任务」区，提供计数卡片（总数、按类型/状态/范围）与每行一条任务记录：channel/bot/chat、类型、调度文本+时区、状态、运行次数、上次触发时间、最近错误（计划 §8「任务」）。
- **凭据与路径安全**：新增 `/api/desktop/tasks` GET，复用共享 tasks 路由的 GET（其忽略 RequestEvent，故传 `undefined`），再经 `buildDesktopTaskSummary` 投影。映射器保留 channel/botId/chatId/scope/type/delivery/scheduleText/timezone/status/statusReason/lastError/runCount/时间戳/sessionMode，**丢弃** `text`（任务 prompt，可能含用户密钥）与 `filePath`（绝对磁盘路径），也丢弃 web 端的 `dataRoot`/`diagnostics`。未知 type/status 归为 `one-shot`/`pending`。
- **验证边界**：新增服务端 `desktopTasks.test.ts` 3/3（item 丢弃 text/filePath 但保留调度元数据——断言 `API key`/`/Users/secret`/`filePath`/`text` 不泄露；未知 type/status 归默认；summary 按 type/status/scope/channel 计数且无 text 泄露），desktop-chat 套件 47/47（本切片无新客户端纯函数——`taskTypeLabel`/`taskStatusLabel` 为类型化 i18n 取值）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/secret/.../task-123.json` 夹具 `filePath` 与敏感 `text` 以证明映射器会剥离。`/api/desktop/tasks` 已加入 Tauri HTTP capability scope。真实任务的实机 smoke 留作后续。创建/编辑/触发/删除任务留作后续切片。


### Molibot macOS App Phase 4 AI 服务商设置区
- **只读服务商展示**：Settings 新增「AI 服务商」区，提供模式卡片（服务商模式 + 内置 Pi 服务商/模型）与每行一条自定义服务商记录：名称（含默认标记）、协议 + baseUrl、模型数 + 默认模型、API Key 是否已配置、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「AI Provider/模型路由」）。
- **凭据安全**：新增 `/api/desktop/providers` GET，经 `buildDesktopProvidersSummary` + `buildDesktopProviderItem` 投影 runtime 设置。映射器保留 providerMode/piModelProvider/piModelName/defaultCustomProviderId，以及每个自定义服务商的 id/name/enabled/isDefault/protocol/baseUrl/modelCount/defaultModel，**丢弃** `apiKey`（服务商密钥，改为 `hasApiKey` 布尔值）、各模型 verification 细节与 reasoning-effort 映射——WebView 永远拿不到服务商密钥。
- **验证边界**：新增服务端 `desktopProviders.test.ts` 3/3（item 丢弃 apiKey 但保留身份/端点/模型数——断言 `sk-super-secret-key`/`apiKey` 不泄露；报告缺失 key + 非默认 + anthropic 协议；summary 映射模式/pi 模型且不泄露 key），desktop-chat 套件 51/51（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/providers` 已加入 Tauri HTTP capability scope。真实配置的实机 smoke 留作后续。创建/编辑/测试/删除服务商与逐模型路由编辑留作后续切片。

### Molibot macOS App Phase 4 Host Bash 设置区
- **审批状态与白名单**：Settings 新增「Host Bash」区，提供计数卡片（待审批、白名单已启用/总数、历史记录）与白名单列表。每行展示工具 id、显示名、原因、审批模式与权限摘要（文件系统/网络/env 数量）及启用/禁用开关（计划 §8「Host Bash」）。
- **凭据安全**：新增 `/api/desktop/host-bash` GET + POST（`toggle_whitelist` 复用 `hostBashStore.setWhitelistEnabled`），由 `buildDesktopHostBashSummary` + `buildDesktopHostBashWhitelistItem` 映射，保留 id/toolId/displayName/reason/approvalMode/enabled/approvedAt 与权限摘要（envAllowlist 归约为计数），**丢弃** `command`（shell 命令）、原始 env-allowlist key 名、channel/chatId/scopeId、approvedFromRecordId——桌面白名单列表永远看不到实际命令或 env 变量名。pending/history 归约为计数。
- **验证边界**：新增服务端 `desktopHostBash.test.ts` 2/2（白项丢弃 command/env key 名但保留身份/原因/模式/权限摘要——断言 `ls -la`/`/Users/secret`/`PATH`/`command` 不泄露；summary 计数 pending/whitelist/enabled/history 且无命令泄露），desktop-chat 套件 44/44（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `ls -la /Users/secret` 夹具命令以证明映射器会剥离。`/api/desktop/host-bash` 已加入 Tauri HTTP capability scope。真实 Host Bash 的实机 smoke 留作后续。删除白名单/历史条目与审批 pending 项留作后续切片。

### Molibot macOS App Phase 4 沙箱设置区
- **沙箱状态与诊断**：Settings 新增「沙箱」区，提供启用/禁用开关、初始化失败策略与环境变量继承模式；一张诊断卡片（平台支持、依赖可用、沙箱已初始化+错误、env 文件存在性+已注入/可用 key 计数）与一张网络/文件系统规则卡片（允许/拒绝计数）（计划 §8「沙箱」）。
- **凭据与路径安全**：新增 `/api/desktop/sandbox` GET + PATCH，由 `buildDesktopSandboxSummary` 复用 `getToolSandboxDiagnostics`，保留 enabled/initFailureMode/envInheritMode、network/filesystem 域规则与聚合诊断计数，**丢弃** `envFilePath`（绝对磁盘路径）、原始 env allow/deny key 列表以及逐 key 诊断数组（envKeys* 归约为计数）——env 变量名永不进入 WebView。PATCH 仅切换 `toolSandbox.enabled`，经 `{ ...current, enabled }` 保留其余字段。
- **验证边界**：新增服务端 `desktopSandbox.test.ts` 2/2（保留模式 + network/filesystem 规则 + 诊断计数但丢弃 envFilePath/env key 名——断言 `/Users/` 与 `SECRET_KEY` 不泄露；展示沙箱错误与缺失 env 计数），desktop-chat 套件 42/42（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/example/.../.env` 夹具 `envFilePath` 以证明映射器会剥离。`/api/desktop/sandbox` 已加入 Tauri HTTP capability scope。真实沙箱诊断的实机 smoke 留作后续。编辑 network/filesystem 允许/拒绝列表留作后续切片。

### Molibot macOS App Phase 4 Trace 设置区
- **只读 trace 聚合**：Settings 新增「Trace」区，按可选时间窗口（今天 / 昨天 / 近 7 天 / 近 30 天）展示运行 trace 聚合计数：一张范围卡片（窗口日期 + 时区）+ 一张总计卡片（事实数、运行数、工具调用含失败/拦截、模型调用含 token、技能使用含不同数、平均工具/模型耗时、覆盖 bots/channels/chats/sessions）（计划 §8「Trace」）。
- **凭据与内容安全**：新增 `/api/desktop/trace` GET，由 `computeDesktopTraceTotals` 从 `SqliteTraceStore.listRecentFacts` 只派生聚合计数与平均，**丢弃**原始 fact 记录——fact 携带 `payload`/`argsPreview`/`resultPreview`/`errorPreview`，可能含用户或命令内容，永不进入 WebView。web 端 `/api/settings/trace` 的 per-tool/skill/model/bot/session/run/chat 明细分组也一并省略，桌面卡片只需聚合。映射器自包含，未改动 web 代码。
- **验证边界**：新增服务端 `desktopTrace.test.ts` 3/3（`sanitizeDesktopTraceRange` 已知值+fallback；`resolveDesktopTraceWindow` last7Days 跨度=6 天；`computeDesktopTraceTotals` 计数 tools/models/skills/tokens/distinct/coverage 且断言 `errorPreview`/`argsPreview`/`private-model`/`payload` 不泄露），desktop-chat 套件 40/40（本切片复用已测的 `formatTokenCount`/`formatDurationMs`，无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/trace` 已加入 Tauri HTTP capability scope。真实 fact 的实机 trace smoke 留作后续。

### Molibot macOS App Phase 4 运行历史设置区
- **只读运行历史**：Settings 新增「运行历史」区，列出近期运行——统计卡片（成功/部分/失败计数）加每行一条运行记录：结果徽标、bot/chat、创建时间+耗时+停止原因+是否回退模型、反思摘要、工具/失败工具列表（计划 §8「运行历史」）。
- **凭据与路径安全**：新增 `/api/desktop/run-history` GET，由 `buildDesktopRunHistoryItem` 映射，保留 runId/createdAt/botId/chatId/stopReason/durationMs/toolNames/failedToolNames/reflectionOutcome/reflectionSummary/nextAction/memorySelectedCount/usedFallbackModel，**丢弃** `workspaceDir`/`filePath`/`skillDraftPath`（绝对磁盘路径）、`finalText`（原始模型输出）、`modelFailureSummaries`、`explicitSkillNames`；路由也不再返回 web 端的 `dataRoot`/`diagnostics`。桌面列表永远看不到磁盘位置或 transcript 内容。
- **验证边界**：新增服务端 `desktopRunHistory.test.ts` 3/3（丢弃绝对路径与 finalText 但保留 timing/tools/reflection；未知 outcome 归为 failed；按 outcome 分组计数），desktop-chat 套件 37/37（新增 `formatDurationMs` 用例：亚秒/秒/分秒/NaN/负数兜底）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试文件刻意含 `/Users/example/...` 夹具路径以证明映射器会剥离（断言输出 `includes("/Users/")` 为 false）。`/api/desktop/run-history` 已加入 Tauri HTTP capability scope。真实运行记录的实机 smoke 留作后续。

### Molibot macOS App Phase 4 用量设置区
- **只读用量展示**：Settings 新增「用量」区，展示本地 AI 聚合用量——累计卡片（请求数 + 输入/输出/缓存读/缓存写/合计 tokens，附生成时间与时区）与四个时间窗口行（今天 / 昨天 / 近 7 天 / 近 30 天），每行显示请求数、合计 tokens 与日期区间（计划 §8「用量」）。
- **凭据安全与窄契约**：新增 `/api/desktop/usage` GET，由 `buildDesktopUsageSummary` 将 `UsageStatsResponse` 映射为稳定的 `DesktopUsageSummary`（timezone/generatedAt/totals/四个带 label 的窗口）。映射器刻意丢弃 `records`、`breakdowns` 与各窗口的 `models`/`bots` 数组——provider/model 名称与 bot id 不进入桌面端，用量卡只需聚合 token/请求数。
- **验证边界**：新增服务端 `desktopUsage.test.ts` 2/2（映射 totals + 四窗口有序；断言 `private-model`/`botId`/`records`/`breakdowns` 不泄露），desktop-chat 套件 33/33（新增 `formatTokenCount` 用例：千分位、四舍五入、NaN/负数兜底）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、机器路径扫描干净。`/api/desktop/usage` 已加入 Tauri HTTP capability scope。真实记录的实机用量 smoke 留作后续。

### Molibot macOS App Phase 4 Web Profile 设置区
- **Profile 列表与管理**：Settings 新增「Web Profile」区，列出全部已配置的 Web Profile（含已禁用），显示关联 Agent 名称，提供内联重命名（Enter 保存 / Esc 取消）与启用/禁用开关；当没有已启用的 Profile 时显示明确错误卡片，补齐 Chat「请先启用一个 Web Profile」空状态背后的可操作入口（计划 §8）。
- **凭据安全与窄契约**：新增只读 `/api/desktop/profiles` GET，仅返回 id/name/enabled/agentId/agentName/sandboxEnabled，绝不回显凭据或 allowed-chat 列表；PATCH 仅接受指定 id 的 `name` 和/或 `enabled`，由 `patchDesktopWebProfile` 仅覆盖这两个字段，原样保留 agentId、credentials、allowedChatIds、sandboxEnabled、display，避免凭据盲的桌面端开关抹除服务端配置。写入经 `runtime.updateSettings({ channels: { web: { instances } } })`，`sanitizeChannels` 按渠道深合并，其他渠道不动。
- **验证边界**：新增服务端 `desktopProfiles.test.ts` 4/4（含禁用 Profile + agentName 解析且凭据不泄露；patch 仅改 name/enabled 保留 agentId/credentials；拒绝未知 id；空名回退 id），desktop-chat 套件 30/30（新增 `hasEnabledWebProfile`、`sanitizeWebProfileName` 用例）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、机器路径扫描干净。`/api/desktop/profiles` 已加入 Tauri HTTP capability scope。创建/删除与关联 Agent 留作后续切片。

### Molibot macOS App Phase 1 服务运行时切片
- **共享单实例租约**：生产启动器、`molibot start` 与开发服务器统一使用 `DATA_DIR/runtime/service.lock`；活跃实例冲突会安全退出，失效租约可回收，状态文件只由持有者清理。测试全部使用临时数据目录。
- **真实发现与握手**：新增只读、版本化的 Desktop handshake，返回服务版本、实例 ID、所有权和 capability；Tauri 只探测 loopback 地址，兼容的既有 Molibot 服务按 external 接入，绝不由 App 停止。
- **内置 Node 与服务监管**：构建流程固定校验并打包 Apple Silicon Node 22.23.1 和 production release；Rust supervisor 支持发现、随机端口回退、临时 desktop token 注入、日志、有限退避重启、菜单重启，以及仅对 App-managed 子进程执行 SIGTERM 后超时强制退出。
- **打包边界**：生成的 App 明确要求 macOS 13+；裁剪 build-only/optional 依赖后，当前 runtime resource 为 249 MB、测试 `.app` 为 363 MB。发布命令使用非交互 CI 打包并在 DMG 成功后自动生成同名 `.sha256`，checksum 逻辑由临时文件测试覆盖。打包 runtime 已通过独立启动/握手/清理 smoke，但完整 App 生命周期 smoke 和受限环境外的压缩 DMG 实产尚未完成，因此仍不构成可发布 beta。

### Molibot macOS App Phase 2 本地 Chat 垂直切片
- **真实 Web Profile/session 共享**：Desktop 通过窄化的 `/api/desktop/bootstrap` 只读取已启用 Web Profile 摘要，并继续使用现有 `channel=web` session API；支持 Profile 切换、按 Profile 恢复最后会话、新建、选择、内联重命名和两步删除，不新增 `desktop` channel。
- **共享 transcript 与流式传输**：独立 Desktop UI 可读取持久 transcript，展示 user/assistant 气泡，选择 thinking level，并消费现有 SSE 的 token、replace、thinking、工具状态、done/error 事件；发送和停止均复用共享 Agent runner API，不在桌面端复制执行逻辑。
- **安全 Markdown 与模型切换**：消息气泡使用 GFM 渲染并通过 DOMPurify 清洗后显示；Desktop 使用只返回模型 key/label/context window 的窄接口读取和切换文本模型，不把完整 settings、Provider API key 或 Base URL送入 WebView。
- **受限 loopback transport**：新增官方 Tauri HTTP client，能力范围仅允许 `127.0.0.1`/`localhost` 的 Molibot Chat API 路径，支持动态服务端口和流式 body，不开放任意远程 URL。
- **验证边界**：5 项临时数据/纯流/模型脱敏测试、8 项 Rust 生命周期测试、Desktop Svelte/production build 与现有 Web production build 均通过；标准宽度浏览器 smoke 已验证临时会话切换、新建、重命名和删除。真实模型流、附件、语音、队列/steer/follow-up、审批和文件面板仍属于 Phase 2 后续工作。

### Molibot macOS App Phase 2 当前会话文件面板
- **只读文件面板**：Chat 头部新增可切换的「文件」面板，复用现有只读 `/api/web/files` 接口，仅索引当前本地 session 的持久附件，并按「全部/图片/视频/音频/文档」媒体类型筛选；切换会话和每轮运行结束后自动刷新，符合「右侧文件面板只索引当前本地 session」的范围约束。
- **预览与导出**：图片/视频/音频通过 Tauri HTTP loopback 客户端拉取字节并以 object URL 在应用内预览，所有文件均可经浏览器 `download` 锚点导出原文件名；HTTP 能力范围新增 `/api/web/files*`，仍仅限 `127.0.0.1`/`localhost` 的 Molibot 路径，不开放任意远程 URL，也不向 WebView 暴露磁盘绝对路径。
- **验证边界**：新增 `filterDesktopFiles` 与 `desktopFileContentUrl` 纯函数单测（api 套件 4/4，desktop-chat 套件 8/8），Desktop Svelte check 0 错误/警告、production frontend build 通过；面板改动仅限桌面端，未触及 Web/服务端代码。原平台「Finder 定位」与本地缓存 Quick Look 需要 fs/dialog/opener 原生插件，留作后续切片。

### Molibot macOS App Phase 2 运行进度时间线
- **实时工具时间线**：运行中的回复气泡内新增可折叠的「运行进度」卡片，按顺序展示工具开始/结束（含成功/失败状态点）、subagent 进度和 thread note，复用现有 SSE 的 `runner_event`/`thread_note` 事件，不新增任何服务端或原生能力；事件解析由纯函数 `parseDesktopActivity` 完成并落入 api 单测。
- **范围与重置**：时间线随每轮发送和会话切换清空，仅在运行期间展示当前轮的步骤；不把诊断字符串写入持久 transcript，符合「运行进度展示」而非持久消息。
- **验证边界**：新增 `parseDesktopActivity` 单测覆盖工具开始/结束/错误、thread note 与无关 token 忽略（api 套件 6/6，desktop-chat 套件 10/10），Desktop Svelte check 0 错误/警告、production frontend build 通过；改动仅限桌面端。

### Molibot macOS App Phase 2 消息内联附件
- **附件随消息展示**：transcript 中每条消息底部新增附件条，按媒体类型显示图标和原文件名；附件数据来自现有 `/api/sessions/[id]` 已返回的 `attachments`，无需服务端改动。
- **复用预览/下载**：内联附件按 `local` 与已加载的 `/api/web/files` 列表匹配，复用同一套 loopback 预览 overlay 和应用内 `download` 导出（图片/音频/视频可预览，全部可下载）；文件尚未在面板列表就绪时优雅降级为只读文件名条。Agent 生成的回复附件在本轮结束、会话重载后持久出现。
- **验证边界**：契约新增 `DesktopMessageAttachment` 并为 `DesktopSessionFile` 补充 `local`（均为响应中已有字段）；api 套件 6/6、desktop-chat 套件 10/10、Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。改动为纯增量且仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 文件上传
- **附件随消息发送**：composer 新增附件按钮（隐藏 `<input type=file multiple>`，无需原生插件），选中文件以可移除 chip 形式预览；含附件的消息通过现有 `/api/chat` multipart 接口发送，复用共享 Agent runner 完成整轮处理，不在桌面端复制上传或执行逻辑。
- **传输与回显**：Tauri HTTP 客户端转发 multipart body 及其自动生成的 boundary（不手动设置 Content-Type），绕过 WebView 跨源限制；HTTP 能力范围新增 `/api/chat*`，仍仅限 loopback。发送时乐观展示用户气泡和待上传文件名，整轮结束后重载会话，持久化的用户附件与 Agent 回复一并出现。含附件的轮次走非流式 `/api/chat`（纯文本消息仍走 `/api/stream` 流式）。
- **验证边界**：新增 `sendDesktopChatWithFiles` 单测，mock fetch 断言 multipart 字段（profileId/conversationId/message/thinkingLevel/files）与 `/api/chat` 目标 URL（api 套件 7/7，desktop-chat 套件 11/11）；并通过阅读 `@tauri-apps/plugin-http` 源码确认其用标准 `Request` 序列化 FormData 并转发 boundary 头。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。受限沙箱无运行服务，真实 multipart 上传实机 smoke 仍待补。改动仅限桌面端（含一处 loopback 能力范围），未触及 Web/服务端代码。

### Molibot macOS App Phase 2 Host Bash 审批
- **本地审批卡片**：流式回复消费现有 `host_bash_approval` SSE 事件，在 transcript 内渲染审批卡片，结构化展示待执行命令和原因，并按 prompt 选项提供「仅此一次/本会话允许/永久允许此工具/拒绝」按钮（选项标签由桌面端按 id 本地化中英）。
- **复用共享 runtime 恢复**：审批结果通过 `/api/chat` 的 `/hosttools approve-once|approve-session|approve|reject <id>` 命令解决，命令不持久化为普通 session 消息；服务端执行决策并在后台恢复原任务，桌面端按有限次数（最多 15×1s）轮询 transcript，待恢复出的 assistant 回复落库后停止并刷新，符合「通过共享 runtime 恢复、不持久化临时控制指令」的要求，不在桌面端复制审批或执行逻辑。
- **验证边界**：契约新增 `DesktopApprovalPrompt`/`DesktopApprovalDecision`；新增 `parseDesktopApproval`（从 SSE 载荷构建卡片）、`hostBashApprovalSubcommand`（决策→`/hosttools` 子命令）纯函数及单测（api 套件 10/10，desktop-chat 套件 14/14）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。受限沙箱无运行服务，真实审批触发与后台恢复实机 smoke 仍待补。改动仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 会话筛选与 transcript 搜索
- **侧栏标题筛选**：会话列表上方新增筛选输入，按会话标题大小写不敏感地过滤当前 Profile 的本地会话（计划 §7.4「侧栏按会话标题筛选」），纯前端、即时生效。
- **当前对话内搜索**：Chat 头部新增「搜索对话」开关，打开后浮出查找条，在当前 transcript 内按消息内容大小写不敏感匹配，显示「第 i / 共 n」计数并支持上一个/下一个匹配跳转——命中消息气泡高亮、活动匹配滚动居中（计划 §7.4「当前 transcript 内搜索，支持上一个/下一个匹配」）。切换会话自动清空查询。首版只做当前会话内搜索，不做跨全部会话全文索引。
- **验证边界**：新增 `filterSessionsByTitle`/`findTranscriptMatches` 纯函数及单测（api 套件 12/12，desktop-chat 套件 16/16）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。功能完全在客户端，无需运行服务即可验证；改动仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 跟进队列与媒体预览 CSP 修复
- **跟进消息队列**：运行期间输入框保持可用，按 Enter 把消息排入本地跟进队列（而非被 409 拒绝）；队列以可移除 chip + 「已排队 · n」徽标展示，当前轮结束后自动按序发送下一条，满足计划 §7.1「follow-up 和队列状态」。主动「停止」会清空队列；切换会话清空队列，但同一会话流式回复重载不清空。Web 渠道服务端无并发队列，本地顺序队列是该 UX 的正确落点。
- **媒体预览 CSP 修复**：此前 `tauri.conf.json` 的 CSP `img-src` 缺少 `blob:` 且无 `media-src`，会在真机上拦截文件面板、内联附件等用 `URL.createObjectURL` 生成的 `blob:` 预览。现补充 `img-src ... blob:` 与 `media-src 'self' blob:`，使已交付的图片/音频/视频预览在真机生效。
- **验证边界**：新增 `addToFollowUpQueue`/`nextFollowUp` 纯函数及单测（api 套件 14/14，desktop-chat 套件 18/18）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。队列完全客户端可验证；CSP 为配置修正、真机媒体预览仍待实机确认。改动仅限桌面端，未触及 Web/服务端代码。语音录制与发送（§7.1）因 Tauri WKWebView 的 `getUserMedia` 需额外原生麦克风授权接线、当前沙箱无法验证，留作独立切片。

## 2026-06-27

### Molibot macOS App Phase 1 基础切片
- **独立桌面工程**：新增 `apps/desktop`，使用独立 Svelte 5 + Vite 前端和 Tauri 2 Rust host，不导入现有 Web 页面或页面 CSS；根 package scripts 提供 `desktop:dev`、`desktop:build`、`desktop:check`、`desktop:test` 入口。
- **原生宿主基础**：配置 Chat / Settings 两个真实窗口、单实例聚焦、关闭窗口后隐藏保活、Dock reopen、菜单栏打开 Chat/Settings/Web 与明确退出；登录启动使用 Tauri autostart LaunchAgent 能力，默认关闭。
- **服务边界模型**：新增 App-managed / external 服务所有权、兼容握手决策、端口顺延选择和退出停止策略的 Rust 纯逻辑；4 条单测覆盖兼容外部服务连接、非兼容拒绝、端口占用回退，以及退出时绝不停止外部服务。
- **桌面视觉基础**：按 `DESIGN.md` 建立独立语义 token、Light/Dark/System、减少透明度/动效降级、固定 Settings 底栏和 620px 紧凑布局；中英即时切换和登录启动开关通过浏览器交互验证。新增巴哥犬 Molibot macOS 图标 master 与 `.icns` 资源。
- **当前边界**：该基础切片当时尚未打包 Node sidecar、启动真实本地服务或产出 DMG；后续进展见 2026-06-28 记录。
## 2026-06-23

### Agent 专有模型（text / vision / stt）
- **分层覆盖**：不同 agent 现在可以配置专有模型，默认与全局模型路由（`/settings/ai/routing`）一致，可单独覆盖文本 / 视觉 / 语音转写三条路由；其它路由（TTS、压缩、subagent 各级别）始终走全局。`AgentSettings.modelRouting` 新增可选字段，三个 key 都留空即透明跟随全局。
- **单一注入点**：runner 构造时把绑定 agent 的覆盖叠加到 `getSettings()` 返回值上（`applyAgentModelRoutingOverride`，按 workspace 的 botId → channel 实例 `agentId` 解析 agent），下游 turn 编排、压缩、媒体兜底等所有 `resolveModelSelection` 自动用 agent 模型，无需逐处改调用点。覆盖只替换非空的 text/vision/stt key，不改其它路由，也不修改全局 settings 对象。
- **配置贯通**：`/settings/agents` 页面新增「专有模型」卡片，三个下拉复用 `/api/settings/model-switch` 的 route 选项（首项「跟随全局（默认）」= 空），随 agent 一起保存；`/api/settings/agent` PUT、sanitize、store（新增 `settings_agents.model_routing_json` 列 + 幂等 ALTER 迁移）全链路持久化，空值自动丢弃回退全局。
- **`/status` 与 `/models` 命令适配**：`/status` 模型区现在显示「实际生效模型」（叠加 agent 覆盖后），并在 text/vision/stt 行标注来源 `（agent：<id>）` 或 `（全局）`；思考能力判定也按生效文本模型。`/models` 切换在「bot 绑定了 agent + 路由是 text/vision/stt」时写入该 agent 的专有模型（影响所有共用该 agent 的 bot），其余（tts/subagent、或未绑定 agent）仍写全局；新增 `/models <route> global`（亦接受 `reset`/`default`）清除 agent 覆盖、恢复跟随全局；`/models` 列表顶部显示本次切换的写入目标（agent/global）。命令处理器经 `this.options.channel` + `instanceId` 解析绑定 agent，全部走共享上层、不下沉 Channel。
- **测试**：新增 `applyAgentModelRoutingOverride` 单测 4/4；channelCommands 新增 `/models` agent 维度写入 + `global` 重置、tts/subagent 仍走全局 2 例，套件 25/25；store/settings 套件全绿；`npm run build` 通过，改动源文件无新增 tsc 错误。

### 压缩专用模型
- **压缩与对话解耦**：会话上下文压缩（摘要）此前固定复用主文本模型，现在可以单独指定。新增 `modelRouting.compactionModelKey` 路由：可把摘要任务交给更便宜/更快的模型，主对话仍跑在更强的文本模型上；留空则复用主文本模型（默认行为不变）。
- **触发判定仍按主文本模型**：是否触发压缩仍以「主文本模型的上下文窗口」为准（对话实际跑在该模型上），只有摘要那一次调用换用压缩专用模型——`turnOrchestrator.compactSessionContext` 中分别用 `resolveModelSelection(settings, "text")` 取窗口、用新增的 `resolveCompactionSelection(settings)` 取摘要模型与 API key；压缩 key 失效时自动回退到文本兜底链。
- **配置贯通**：`/settings/ai/routing` 页面压缩设置区新增「压缩专用模型」下拉（复用文本能力模型选项，含「复用主文本模型」空选项），并贯通 schema/defaults/sanitize 持久化；选中的模型若不再存在，保存时自动清空回退到主文本模型。
- **测试**：compaction、modelRouting、sanitize 套件全绿，改动源文件无新增 tsc 错误。

### 流式首字超时 + 模型兜底
- **解决卡死**：当上游模型接受了请求却迟迟不返回任何内容时，流式模式下 `for await` 会一直阻塞导致整轮任务卡住。现在在 `runner.ts` 的 `streamFn` 里包了一层首字超时（`withFirstTokenTimeout`，见 `agent/core/firstTokenStreamTimeout.ts`）：计时器对「第一个真正的内容 token」生效，pi-ai 的 `start`（HTTP 流已打开）和裸 `*_start`（声明了内容块但还没产出字节）等事件不会清除计时器——`text_start` 到首个 `text_delta` 之间正是要兜底的「首字响应时间」；只有 `*_delta`/`*_end`/`done`/`error` 到达才清除计时器，慢但还在输出的模型不会被打断。
- **超时即兜底**：超时后通过独立的 `AbortController` 终止当前请求并抛出带 “timed out” 的可重试错误，命中既有 `isRetryableModelError` 判定，进而走原有的模型候选兜底循环切到下一个模型；所有候选都不可用时返回错误而不是卡住。
- **可配置**：默认 60 秒（环境变量 `MOLIBOT_MODEL_FIRST_TOKEN_TIMEOUT_MS`），新增 `modelFallback.firstTokenTimeoutMs` 设置项并贯通 schema/defaults/sanitize/store 持久化；`/settings/ai/routing` 页面「首字响应超时」数字输入框可调，填 `0` 关闭。正值会被夹到 1s–10min 区间。
- **测试**：`firstTokenStreamTimeout.test.ts` 5/5（无事件时超时触发 onTimeout+可重试错误、`start`+`text_start` 后仍因 stall 超时、首个 `text_delta` 到达后不再超时、`result()` 透传、超时为 0 时原样返回）；runner 22/22、modelRouting 2/2 仍全绿，改动文件无新增 tsc 错误。

## 2026-06-21

### Bot Profile 与 Agent AGENTS 叠加
- **`BOT.md` 不再覆盖 `AGENTS.md`**：系统提示词构造时，已绑定 agent/global 的 `AGENTS.md` 与 bot 维度 `BOT.md` 一起放在上方 operator directives 区块；`AGENTS.md` 先作为可复用底座，`BOT.md` 再叠加 bot 专属规则，避免 Feishu/Web/Telegram 等 bot 的专属规则把 agent 维度长期规则整体挤掉。
- **同名身份文件仍按 bot 优先**：`SOUL.md`、`IDENTITY.md`、`SONG.md` 继续使用 bot > agent > global 取一个的覆盖语义，适合 bot 维度定制人格、身份和表达风格。
- **回归验证**：新增 prompt render 测试覆盖 bot `BOT.md` 与 global `AGENTS.md` 叠加且位于默认 `<system-prompt>` 前，以及 Feishu bot 绑定 agent 时 agent `AGENTS.md` 先于 bot `BOT.md` 生效、bot `SOUL.md` 覆盖 agent `SOUL.md`。

### Feishu 卡片去标题 + emoji 状态 + 回复引用
- **去掉卡片标题栏**：`buildFeishuStreamingCard` / `buildFeishuFinalCard` 不再渲染 `header`（原来显示 Thinking/Processing/Completed 等），删除随之失效的 `title` 入参、`FeishuStreamingSession.resolveStreamingTitle()` 与 `workingPhase` 字段。卡片仍保留 `config.summary`，通知列表里照常显示进度文案。
- **状态改用用户消息上的 emoji reaction**：`FeishuStreamingSession.startStatusIndicator()` 在任务一开始就给「用户的触发消息」加 `OnIt`（处理中）表情；`finalize()` 按 `stopReason` 换成 `DONE`（成功）/`CrossMark`（失败）/`No`（中止）。emoji 用飞书固定 `emoji_type` 枚举（非任意 emoji），新增 `addFeishuReaction` / `removeFeishuReaction` 封装（`client.im.messageReaction.*`），全程 try/catch + `momWarn`，缺权限或错 key 只告警不打断运行。
- **回复明确引用用户消息**：`replyOptionsForEvent` 放开原先「仅 thread 才 reply」的限制——只要有 `platformMessageId` 就带 `replyToMessageId`，`replyInThread` 仅在源自 topic 时为真。普通群聊/单聊里每条回复都带引用块，连发多条也能快速定位。
- **测试**：cardkit 6/6、streamingSession 4/4 通过；剔除测试中已删除的 `title` 入参。改动源文件无新增 tsc 错误（messaging 既有 `buildFeishuReplyCards` 类型告警为基线既存）。

### 审批收敛 Phase 2 (b)：审批落库合并为单表
- **两表合一**：新增 `approval/approvalSchema.ts`，把 `approval_requests` + `approval_grants` 合并为单表 `approvals`（两套旧表列并集）+ `type` 判别列（`request`/`grant`），并提供幂等迁移 `migrateLegacyApprovalTables`（启动时把旧表数据 `INSERT OR IGNORE` 拷入，旧表保留可回滚）。
- **两个访问类共用单表**：`SqliteApprovalStore`(broker, 8 语句) 与 `HostBashStore`(bash 工作流, ~24 语句) 全部 SQL 切到 `approvals` 并带显式 `type` 过滤；bash 域行仍以 `capability LIKE 'bash:%'` 标记。生产代码不再创建或引用旧表。
- **测试**：`approvalSchema.test.ts`(3) + 既有 broker/hostBash 守卫；hostBash 两处直插旧表用例改为 `approvals`；approval + hostBash + channelCommands + toolRuntime + turnOrchestrator 合计 61/61 通过，改动源文件无新增 tsc 错误。
- **取舍**：瞬时 request 与持久 grant 同表带来可空列/混生命周期（按用户决定执行）；旧表暂留以便回滚。

### 审批收敛 Phase 2 (a)：删除 dead broker 桥接
- **证实再删除**: 新增 lock 测试证明默认策略下唯一的 high-risk 内置分类是 `bash`，而 `bash` 在 `decideBashToolPolicy` 中 opt-out broker（永远 `allow`）——因此没有任何内置工具会创建 broker request，hostBash 审批永远不存在同 scope 的待对账 broker request。据此删除 `channelCommands.ts` 的 `resolvePendingBrokerRequests` 方法、5 处调用、以及无 hostBash 记录时回退 resolve broker 的 NL 审批分支，并清理 `getApprovalBroker` import。
- **只删死桥接、不动 broker**: `ApprovalBroker` 的 grant 模型仍在 ToolRuntime / TurnOrchestrator / feishu 中存活。
- **回归保护**: lock 测试在未来新增「非-bash 高危工具」时会失败，提示去显式接线审批。验证：channelCommands + classification + toolRuntime + approvalService 共 43/43 通过，tsc 干净。

### Image Generation Provider Diagnostics
- **图像工具 HTTP 诊断日志**: `imageGenerate` 现在会在服务端日志打印供应商请求 URL、脱敏请求头、请求体、响应状态和响应体预览，覆盖设置页测试与 Agent 调用，便于排查 Google Imagen 返回空 `{}` 等 provider 侧问题。
- **敏感信息脱敏**: 图像工具日志会脱敏 `Authorization`、API key header、Google `?key=` 查询参数以及已配置的供应商密钥，避免调试时把真实 key 打到日志里。

### OpenAI Images Provider
- **OpenAI 图像生成接入**: `imageGenerate` 新增 `openai` 引擎，默认使用 `OPENAI_API_KEY`、`https://api.openai.com` 和 `gpt-image-2`，通过 OpenAI Images API 保存返回的 `b64_json` 图像结果。
- **设置页 OpenAI 选项**: `/settings/image` 新增 OpenAI Images 配置卡片，支持 API Key、模型 ID、Base URL、默认引擎选择和即时测试；读取旧设置时会补齐新增的 `openai` 引擎配置，避免老数据缺字段导致页面崩溃。
- **OpenAI Chat Completions 兼容协议**: `imageGenerate` 新增 `openai-chat` 引擎，提交到 `/v1/chat/completions`，用于兼容通过 chat/completions 返回图片 URL、data URL 或 Base64/JSON 的服务；设置页新增 `OpenAI Chat Format` 配置项，同样支持 API Key、模型 ID、Base URL 和即时测试。
- **图像引擎显式启用开关**: `/settings/image` 的每个 provider 现在和 `/settings/video` 一样有独立启用/禁用开关；运行时只会选择同时启用且配置了 API Key 的引擎。旧配置缺少 `enabled` 字段时会按已有 API Key 自动补齐启用状态，避免升级后不可用。
- **图像工具返回 provider 启用状态**: `imageGenerate` 执行结果的 `details` 现在包含 `engineEnabled` / `providerEnabled`，任务 `requestParams` 也会记录同样状态，便于调用方和历史记录判断本次 provider 是否启用。

## 2026-06-20

### Session 命名日期随机化
- **`/new` 会话命名**: IM 共享命令创建的新 session 改为日期 + 4 位随机小写字母格式，例如 `s-YYYYMMDD-yush`，避免不同 bot 同一天创建 session 时都出现相同的序号尾缀。
- **定时任务 session 命名**: `sessionMode=fresh` 的 scheduled task session 使用同样规则，前缀为 `task`，例如 `task-YYYYMMDD-yush`，仍保留原有 task session 自动清理策略。
- **回归验证**: 增加 `MomRuntimeStore` 单元测试覆盖普通 session 与 task session 的日期随机命名格式。

### Web 工具附件类型修复
- **Web `attach` 附件持久化**: Web Chat 的 `/api/chat` 与 `/api/stream` 现在会把 Agent 工具通过 `uploadFile` 产生的文件保存为会话附件，并随 assistant 消息写入 `attachments` 元数据，避免工具显示已发送但文件面板没有结构化附件。
- **无扩展名标题保留文件类型**: 当 `attach` 传入类似 `Example.com 网页截图` 这类不带扩展名的标题时，Web 保存文件名会保留源文件扩展名（如 `.png`），并写入 `mediaType: image` / `mimeType: image/png`，确保图片可以直接预览和打开。
- **回归验证**: 新增 Web 附件单元测试覆盖 PNG 文件路径 + 无扩展名标题的保存行为。

### MCP 设置保存兼容性修复
- **URL-only HTTP 配置保留**: `/settings/mcp` 现在会把包含 `url` 但未显式声明 `type` / `transport` 的 MCP 服务自动识别为 HTTP transport，避免这类配置在保存 sanitizer 中被当作缺少 `command` 的 stdio 服务过滤掉。
- **顶层 headers 兼容**: MCP 配置支持常见的顶层 `headers` 写法，并在保存时归一到最终 HTTP headers，适配 `{ "mcpServers": { "id": { "url": "...", "headers": {...} } } }` 格式。
- **回归验证**: 新增 `sanitizeMcpServers` 单元测试覆盖 TDX 风格 payload；验证原始复现 payload 已从空数组变为保留 `tdx` HTTP 配置。
- **MCP 调用入口修复**: 新增稳定的 `mcpInvoke` 工具，只在显式 MCP 场景随 `loadMcp` 暴露。`loadMcp` 仍负责加载服务器；`mcpInvoke(listTools)` 负责列出已加载 MCP 工具；`mcpInvoke(call)` 负责调用具体 MCP 工具，避免同一轮 `agent.prompt()` 中动态追加工具 schema 不会进入当前 context snapshot 导致模型只能误用 `toolSearch` / `bash`。
- **MCP 工具包装透传**: `wrapWithToolRuntime` 现在向原始工具透传 `AbortSignal` 和 `details`，保留 MCP 结果中的 `serverId` / `remoteToolName` 等可观测信息，并保持停止/中止链路一致。

### 运行预算降级修复（预算耗尽不再 spiral 成报错 / 不再吞掉半截回复）
- **预算 block 不再误记为工具失败**: 撞「工具调用预算」被 block 的调用会返回 error 结果，原先在 `tool_execution_end` 里被 `recordToolResult(isError)` 当成「工具失败」计数。当模型一轮并行发出多个工具调用时，这些被 block 的调用会让「失败预算」迅速冲顶并触发硬中止，绕过本该执行的「无工具优雅续写」，最终给用户一句 `Sorry, something went wrong`。现在在 `beforeToolCall` 用 tool-call id 记下被预算 block 的调用（`budgetBlockedToolCallIds`），`tool_execution_end` 通过纯函数 `shouldCountToolResultAsFailure` 跳过这些调用的失败计数，并且不再把重复的「budget exceeded」刷屏到会话线程。
- **错误时保留半截回复**: 流式输出了一半再报错时，原先会把整条消息 `replaceMessage("Sorry, something went wrong.")`，把用户已经看到的部分全部覆盖。新增纯函数 `resolveFinalErrorAction`：有最终答案 → 不动；有可见的流式 partial → 保留 partial、只追加一句中断说明；确实什么都没产出 → 才用兜底通用错误文案。
- **测试**: `runnerRetryState.test.ts` 新增 2 组用例（失败计数口径、最终错误动作）；回归 `runner.test.ts` 22/22，全部受影响套件 69/69 通过；改动源文件 tsc 干净。

### 审批收敛 Phase 2 第一刀（ApprovalService façade，零行为变更）
- **统一接口**: 新增 `src/lib/server/approval/approvalService.ts`，定义 `ApprovalService` 接口（`checkGrant / createRequest / getRequest / waitForDecision / resolve`）+ broker 适配器 `BrokerApprovalService`（`waitForDecision` 复用 Phase 1a 的 `pollUntilResolved`）。
- **ToolRuntime 改为依赖接口**: 不再直接戳 `ApprovalBroker`；构造时把既有 `approvalBroker` 选项包成 `BrokerApprovalService`（所有现有调用点不变），`pollApprovalRequest` 的内联轮询移入服务。底层 store 未动。
- **测试**: 新增 `approvalService.test.ts` 5 条（delegate/已终态/abort/timeout 落库/resolve 建 grant）；既有 `toolRuntime.test.ts` 6 条行为测试全过，合计 28/28；改动源文件 tsc 干净。
- **后续**: HostBash 适配器实现同一接口、通过接口消解 `resolvePendingBrokerRequests` 桥接（会改行为，单独谨慎推进）。

### 审批收敛 Phase 1（共享 poll 等待器，零行为变更）
- **背景**: 仓库存在两套独立审批阻塞循环 —— ApprovalBroker 通道（`ToolRuntime.pollApprovalRequest`，非 bash 高危工具）与 Host Bash 通道（`waitForHostBashApprovalAndExecute`，bash host 命令），各自手写 timeout/abort/sleep 轮询（摸底见 `docs/designs/agent-runtime/approval-convergence-plan-2026-06-20.md`）。
- **改动**: 新增 `src/lib/server/approval/approvalWaiter.ts` 的 `pollUntilResolved<T>` 通用轮询骨架（注入 `now`/`sleep`，可纯单测），把"等到终态或超时/中止"的循环机制抽出。System A 与 System B 都改调它；各自的 store 访问、终态判定、approval 后内联执行逻辑保留在各自的 `poll()` 回调中。**零行为变更**（超时、轮询间隔、中止语义、内联执行均不变）。
- **测试**: `approvalWaiter.test.ts` 4 条（done/持续轮询/中止/超时，均注入假时钟）；回归 System A `toolRuntime.test.ts` 6/6、System B `bash-output.test.ts` 19/19（含「approval 后阻塞内联执行」用例）。改动源文件 tsc 无新增错误。
- **Prompt 构造收敛（同样零行为变更）**: 把 `ToolRuntime` 内部两处「假 host-bash prompt」构造（pending 卡片 + rejected/expired 结果）合并为单一 `buildBrokerApprovalRecord` helper —— 两处仅传各自的 toolId/displayName/command/status/pendingAction，公共信封（channel ""、ephemeral、scratch-only 权限、从 request 派生的 id/reason/scopeId/sessionId/requestedAt）收敛到一处。新增纯单测 2 条，回归 toolRuntime 8/8、approval 套件 26/26。
- **范围**: 以上是审批收敛 Phase 1 的两步（共享等待器 + broker prompt 构造收敛），均零行为变更。跨渠道的卡片形状统一（非纯零行为变更）、单一 store of record、subagent resume 收敛为后续 Phase（见上述设计文档）。

### SubagentRuntime 硬化（第一刀）
- **执行预算与时间上限**: 新增 `src/lib/server/agent/tools/subagentRuntime.ts`，提供 `SubagentExecutionGuard`。它复用父 runner 的 `RunBudget`（不另造预算），叠加 wall-clock deadline（默认 `DEFAULT_SUBAGENT_DEADLINE_MS = 10min`），在子 agent 超过工具调用 / 工具失败 / 模型调用预算或超时时返回**结构化停止原因**（`{ kind: "budget_exceeded" | "timeout", reason }`）。
- **会话事件驱动中断**: `evaluateSubagentEvent(guard, event)` 把 pi-coding-agent 的 session 事件映射为预算判定；`runSingleSubagent` 在 `session.subscribe` 中据此 `session.abort()`，子 agent 因此获得与父 runner 一致的预算中断能力。
- **独立 deadline 计时器（修复 idle hang）**: 仅靠事件驱动检查无法在 `session.prompt` 卡住（provider stall、无后续事件）时触发超时。新增 `armSubagentDeadline(guard, onExpire, scheduler?)`（注入式调度器，纯逻辑可测）+ `guard.remainingMs()`，在每次 attempt 外层挂一个真实计时器，到点记录 timeout stop 并 `session.abort()`，并在 `finally` 中清除，确保空闲挂起也能被中止。
- **结果携带可观测信息**: `SubagentRunResult` 新增 `budget`（RunBudget 快照）、`runtimeStopKind`、`durationMs`；预算/超时触发时 `stopReason` 归一为 `error` 并附结构化 `errorMessage`。
- **模型 fallback**: 新增 `buildSubagentModelCandidates(settings, modelHint)`（有序去重候选路由，首项与既有 `resolveSubagentModelRoute` 等价、末项追加主 text 路由兜底）+ `resolveSubagentModelCandidates` / `buildModelFromRoute` / `buildSubagentFallbackModel`。`runSingleSubagent` 重构为「解析候选 → 共享 guard → 逐候选 `runSubagentOnce`」循环，按 `shouldFallbackToNextModel` 决定是否换下一个模型；预算/超时/审批/中止不触发 fallback（避免浪费模型或丢状态）。
- **Run summary 透传**: 新增纯函数 `buildSubagentTaskRecord`，把子 agent 的 `budget`/`model`/`durationMs` 从 `subagent_execution` task_end 事件落到 `RunSummary.subagent.tasks`，使 trace/分析能看到每个子任务的预算、耗时、模型与 stopReason。
- **测试**: `subagentRuntime.test.ts`（10）覆盖预算耗尽、deadline 超时、事件映射、limits 解析、fallback 判定；`subagent.test.ts` 新增候选构建/去重；`runSummary.test.ts`（2）覆盖任务记录映射。改动源文件 tsc 干净，全量 agent 回归仅既有 `events.test.ts`（与本次无关）失败。
- **Per-mode 预算测试**: `createSubagentTool` 新增可注入的 `runSubagent` 依赖（默认 `runSingleSubagent`），无需活模型即可端到端验证三种模式下预算中断的流转：single 透出 `runtimeStopKind="budget_exceeded"` 并发出 `error` 终态事件；parallel 即使某个任务被预算中断仍跑完全部；chain 在被预算中断的步骤后停止、不再执行后续步骤。
- **对照验收**: 标准 1（预算/超时结构化停止）✅、2（模型 fallback）✅、4（single/parallel/chain 预算中断用例）✅、5（run summary 可见）✅；仅剩 3（审批接口收敛，风险最高，建议与 ToolRuntime 双栈合并规划）作为后续 slice（见 `docs/reviews/agent-runtime/agent-optimization-review-2026-06-20.md`）。

## 2026-06-19

### Settings Data Visibility Reliability
- **Agents 生产启动可见性修复**: `/settings/agents` 页面依赖 `/api/settings/subagents` 同时加载内置 Subagent 清单。生产 `node build` 若缺少打包进 `build/server/chunks/subagent-agents` 的 Markdown 资源，现在会回退读取本地源码目录中的 `subagent-agents` 定义，避免接口 500 导致已保存 agents 看起来无法加载。
- **Host Bash 旧白名单兼容**: `/settings/host-bash` 现在兼容旧的 persistent approval grant 记录，即使 `action_fingerprint` 为 `NULL` 也能用 capability tool id 渲染白名单项，不再因为 `metadata.displayName` 为空对象访问而整页 500。
- **回归验证**: 覆盖 Host Bash legacy grant 单元测试，并验证生产 `node build` 下 `/api/settings/subagents` 与 `/api/settings/host-bash` 均返回 200。

## 2026-06-18

### Stop Command Busy-State Release
- **Stop 后立即释放会话忙碌态**: `/stop` 成功中止当前运行或清理 stale running turn 时，会同步释放 channel 层 busy 标记、标记当前 run 为 aborted，并重置对应 runner。这样用户收到“已停止”后，下一条普通消息会直接进入新任务，而不会继续被误判为当前任务 follow-up 并提示 `Queued as #...`。

## 2026-06-17

### Telegram Rich Message Output
- **grammY 1.44.0**: Telegram SDK dependency upgraded to `grammy@^1.44.0`, resolving `@grammyjs/types@3.28.0` with Bot API 10.1 rich message types and methods.
- **富文本优先发送**: Telegram outbound text now prefers Bot API 10.1 rich messages via grammY `sendRichMessage` and rich `editMessageText` payloads, using the original text as the rich Markdown source.
- **grammY-only Telegram rendering**: Telegram formatting no longer performs local Markdown-to-HTML conversion. If rich message delivery fails, the fallback is grammY `sendMessage` / plain `editMessageText` with the original text.
- **命令 Markdown 统一输出**: Shared commands now produce one canonical Markdown shape across channels instead of branching by Telegram/Feishu/QQ/Weixin: `/status` uses grouped Markdown lists, while `/help` and queue listings use standard Markdown table blocks. Channel senders remain responsible for platform-specific rendering or fallback.
- **Runlog 状态块标准化**: `/runlog status` and runlog toggle confirmations now render the status block as Markdown headings plus bullet lists, avoiding Telegram rich Markdown folding single newlines inside plain paragraphs.
- **命令输出结构化打磨**: Host Bash 审批、queue/session/model/login/compact/thinking/sandbox/toolprogress/showreasoning/runlog 等共享命令的多行结果统一改为 Markdown heading、bullet list、command list 或 table，避免 Telegram rich Markdown 把普通段落单换行折叠成一行，同时保持飞书等渠道复用同一套命令文本。
- **无本地渲染判断**: Telegram no longer uses local regular expressions to decide whether text is Markdown; grammY/Telegram receives the original text and owns rich rendering.

### Independent Control Daemon (Telegram 运维控制进程)
- **独立控制守护进程**: 新增 `bin/molibot-control.js`，一个不依赖主程序 agent/runtime/settings 的极小独立进程，用一个专用 Telegram bot 接收运维命令。它与主服务生死无关，因此主服务完全停止时仍能收命令并把服务重新拉起（这是“启动已停服务”唯一可行的路径）。
- **运维命令**: `/status`、`/start`、`/start dev`、`/stop`、`/restart`、`/restart dev`、`/logs [n]`。每条命令通过 `spawn` 调用相应脚本并把输出回贴到聊天。
- **两套服务源**: `/start` 走 release 流程(调用 `molibot-update.sh`：拉取并构建最新 git ref → 部署到 `current` → 启动);`/start dev`、`/restart dev` 对齐本地 dev 工作树。stop/status 基于 PID 文件,与启动来源无关。
- **dev 自动构建**: `/start dev`、`/restart dev` 会先 `npm run build`(通过 login shell 解析 node/npm PATH)再启动,确保拿到最新本地代码;构建失败则中止、不启动。另提供 `/build` 单独构建。
- **发现模式**: admin 白名单为空时不再退出,而是进入发现模式(不授权任何命令,只把收到消息的 chat_id 记日志),避免「没 id 不让启动、不启动又拿不到 id」的死锁;非白名单消息一律只记日志、不回复。
- **白名单鉴权**: 仅响应 `MOLIBOT_CONTROL_ADMIN_IDS` 中的 chatId/userId，非白名单消息静默忽略；进程缺少 token 或空白名单时拒绝启动。控制进程不接入任何 agent 能力，只能执行固定命令集。
- **自身守护**: 新增 `bin/molibot-control-service.sh`，沿用 `molibot-service.sh` 的 nohup 监督循环模式（start/stop/status/restart、崩溃自动重启），让控制进程开机后常驻并在崩溃时自拉起。
- **配置与发布接线**: `molibot manage` 的 `deploy.env` 新增 `MOLIBOT_CONTROL_TG_TOKEN` / `MOLIBOT_CONTROL_ADMIN_IDS` 两项（交互式可配置），`molibot-release.sh` 把两个新脚本打包进 release。
- **设计文档**: 方案归档到 `docs/designs/operations/control-daemon.md`，README 部署章节给出快速使用步骤并链接到该文档。

### Telegram Command Menu Cleanup（命令菜单精简）
- **精简「/」菜单**: 新增 `TELEGRAM_MENU_COMMANDS` 并在启动时调用 `setMyCommands`，Telegram 的命令选择器只暴露 8 个常用命令（`/new`、`/clear`、`/stop`、`/sessions`、`/status`、`/models`、`/skills`、`/help`），按运行时 locale 显示中/英描述。菜单注册失败只告警、不影响启动。
- **/help 分组**: `/help` 输出拆成「常用命令 / 高级命令」两组,高级命令(steer/followup/queue/compact/thinking/sandbox/runlog/toolprogress/showreasoning/delete_sessions/skills 详情等)合并为更紧凑的带可选参数行。
- **非破坏式**: 所有命令处理器保持不变(`TELEGRAM_SHARED_COMMANDS` 未删减),高级命令照常可用,仅调整 UI 暴露与帮助呈现。

## 2026-06-16

### Runlog Notice Controls
- **自动归档通知默认关闭**: run detail 仍然持续归档，但“本次执行成功，详细记录已归档。查看：/runlog ...”自动提示默认关闭，减少聊天噪音。
- **分层开关**: 新增 `/runlog status`、`/runlog on|off|reset`、`/runlog bot on|off|reset`、`/runlog global on|off|reset`，按 session > bot > global 生效；`/runlog` 和 `/runlog latest` 保持查看最新记录语义。
- **历史列表与状态面板**: 新增 `/runlog list` 列出最近归档记录；`/status` 现在同时展示 runlog notice、sandbox、toolprogress、showreasoning 的当前有效状态和来源。
- **跨渠道接线**: Telegram、Feishu、QQ、Weixin 的自动归档通知统一遵守共享开关；手动 `/runlog` 查询不受影响。

### Feishu Topic Runlog Notice Threading
- **Topic 内归档通知对齐**: Feishu 流式输出在 topic 中触发 runlog 归档提示时，现在会沿用原始消息的 `reply_in_thread` 回复参数，不再把“本次执行成功，详细记录已归档。查看：/runlog ...”发送到群聊主消息流。
- **回归测试**: Feishu runtime 测试覆盖流式 topic 场景，断言归档通知通过 Feishu reply API 回到原 topic。

### AGENTS 重复问题规则提炼
- **Changelog 复盘提炼**: 分析 `CHANGELOG.md` 中反复出现的修正主题，将稳定的避免规则补充到 `AGENTS.md`，覆盖 prompt/profile 真实生效与去重、设置页响应式与设计系统、细粒度设置保存、测试数据库隔离、跨渠道队列幂等等长期约束。
- **文档同步**: 按文档职责分层，仅在 `features.md` / `prd.md` / `CHANGELOG.md` / `README.md` 记录本次规则治理摘要，不把 changelog 历史流水账搬入长期规则。

### Docs Taxonomy Cleanup
- **分类入口**: 新增 `docs/README.md`，按文档职责定义 `requirements`、`designs`、`reviews`、`research`、`guides`、`reference` 等目录用途，并明确 `docs/agent-dev-series` 与 `docs/superpowers` 维持独立结构。
- **过程数据清理**: 删除 `docs` 下临时执行计划、迁移 checklist、进度记录和完成日志类过程材料；长期需求、架构方案、研究、评审、指南和参考资料保留。
- **导航同步**: 更新根 `README.md` 的 Docs 和 Documentation Workflow，指向新的文档路径和归档规则。

## 2026-06-14

### Feishu Card Markdown 渲染优化 (Feishu Card Markdown Rendering)
- **最终回答结构化渲染**: Feishu CardKit final card 不再把完整回答塞进单个 markdown 元素；标题会拆成独立 markdown 元素，markdown 表格会转换成飞书原生 table 元素，降低大段 H1/结构化回答在 card 中排版错乱的概率。
- **代码块保护**: `markdownToFeishuMarkdown()` 在应用标题、列表、引用等兼容转换前会先保护 fenced code block，避免代码示例里的 `#`、`-`、`>` 被误改成标题、项目符号或引用样式。
- **回归测试**: Feishu 测试覆盖代码块 markdown 保护、final card 标题拆分和 markdown table 原生 table 渲染。

### Bot Profile 身份锁定 (Bot Profile Identity Lock)
- **默认身份不再覆盖 Bot 身份**: 当有效 prompt 中存在 `BOT.md` / `IDENTITY.md` / `SOUL.md` / `SONG.md` / `USER.md` 这类 operator profile 时，默认 `<system-prompt>` 不再硬声明 `You are Momo Agent...`，而是要求模型以 profile 中定义的名称、身份、使命、工作流、语气和禁令作为自我描述与行为准则。
- **尾部提醒防止后置默认规则稀释**: 新增 `<operator-directives-reminder>` 段，明确回答“你是谁 / 工作流 / 核心原则 / 禁止行为”时必须从 active profile 文件回答；如果 profile 要求缺少必要 skill 时停止，也必须按 profile 原因停止。
- **回归测试**: `prompt.test.ts` 覆盖有 bot 身份时不再渲染默认 Momo 身份，并保留 profile 内容与尾部提醒。

### System Prompt 易变段落后置以利缓存 (Volatile Sections Last for Cache-Friendliness)
- **易变内容移到 system 块末尾**: `<available-skills>`（技能名列表）和 `<current-memory>`（记忆内容）这两段会随轮次变化,现在统一放到 `<system-prompt>` 块的**最末尾**,排在静态的 `system-configuration-log` / `log-queries` 之后。此前 `available-skills` 紧跟在 skills protocol 后、靠近顶部,导致技能列表或记忆一变就作废几乎整个前缀。讲用法的 skills **protocol**(静态)仍留在顶部与 pipeline 一起,只挪了易变的技能名列表。
- **目的**: 让上方那一大段静态前缀跨轮保持字节一致,便于做前缀缓存的 provider/模型复用更多内容。(注:Anthropic 经 pi-ai 把 system 当**单块**缓存,所以在 Anthropic 上是无收益的 no-op;收益面向更细粒度缓存或自定义协议路径。)改动在 `agent/prompts/prompt.ts` 的 `buildBaseSystemPromptWithOptions`。

### Operator Profile 优先级高于默认系统提示词（但有安全底线） (Operator Profile Files Outrank System Prompt, Under a Safety Floor)
- **代表 operator 意图的 profile 文件上提到最前**: `BOT.md` / `IDENTITY.md` / `SOUL.md` / `SONG.md` / `USER.md` 现在被拼到默认 `<system-prompt>` 之**前**，并由一段 `<operator-directives>` 前言声明它们为高优先级、与默认系统提示词冲突时以这些为准。此前它们被追加在 base prompt 之后、且是无任何框定的纯文本，容易被 base prompt 里的工具/bash 指引稀释——例如 Skill-Only 的 `BOT.md`（禁用 curl/cat 等）规则被忽略。
- **不可逾越的安全底线压在最上层**: 新增 `<inviolable-safety>` 段，位于 operator directives **之上**，声明 profile 文件（以及用户、外部内容）只能**收紧**而不能放松/绕过核心安全——不得关闭安全规则、不得外泄密钥、不得在未确认下执行破坏性/不可逆操作、不得攻击系统、必须抵御 prompt injection、不得谎报执行成功——**即使 profile 文件明确要求破坏也不行**。
- **支撑类文件仍为低优先级**: `TOOLS.md` / `BOOTSTRAP.md` 保留在 base prompt 之后作为低优先级配置；`AGENTS.md` 仍仅在没有 `BOT.md` 覆盖时注入；project-context 块保持不变。改动集中在 `agent/prompts/prompt.ts`（新增 `OPERATOR_DIRECTIVE_FILES`、`SUPPORTING_INSTRUCTION_FILES`、`buildSafetyFloorSection`、`buildOperatorDirectivesPreamble`），现有 `prompt.test.ts` 的 BOT.md 覆盖断言仍通过。

### Stop Command Terminal Confirmation Copy
- **终止确认改为最终态**: `/stop` 成功中止当前运行时，共享命令回复从“正在停止……”改为“已停止。”；同时清理排队任务时继续显示已清除数量，避免飞书等渠道在运行卡片已显示 stopped 后，底部确认消息仍停留在进行态。

## 2026-06-13

### Host Bash Fallback 继承沙箱环境变量 (Host Bash Fallback Inherits Sandbox Env)
- **修复 fallback 丢失 token**: 沙箱命令被拒后会自动 fallback 到 Host Bash，但此前 `buildHostEnv` 只读父进程 env，导致只存在于 `.env.sandbox.local` 的密钥（如 `BOT_API_TOKEN`）在 fallback 路径上凭空消失，报出误导性的“缺少 token”。现在 Host Bash 也会注入这些仅存在于沙箱 env 文件中的密钥。
- **沿用沙箱 env 策略**: 注入受同一套 `inheritMode`/`allow`/`deny` 策略约束，并跳过父进程 env 里已有的 key，因此 fallback 拿到的权限不会超过沙箱本身会授予的范围；沙箱关闭时不注入任何文件密钥（不污染长期存活的主进程 env）。
- **新增 `buildSandboxEnvFileInjection`** 辅助函数（`agent/tools/sandbox.ts`），由 `sandbox.test.ts` 覆盖。

### 多渠道 System Prompt Preview 热刷新 (Cross-Channel Prompt Preview Refresh)
- **No-op apply 也刷新预览**: Feishu / QQ / Weixin 在保存 bot 配置或 profile Markdown 后，即使渠道凭据和白名单没有变化、无需重启适配器，也会重写对应 bot workspace 的 `SYSTEM_PROMPT.preview.md`。行为与 Telegram 对齐，避免只有 Telegram 预览更新、其他渠道仍显示旧 prompt 的观测偏差。
- **日志对齐**: Feishu / QQ 的 apply、no-op apply 日志补充 `botId`，刷新时会输出与 Telegram 同类的 `system_prompt_preview_written` 日志，便于按 bot 核对 prompt 是否已经更新。

### 树洞发帖 Bot Profile 模板 (Treehole Poster Bot Profile Template)
- **Bot 维度模板**: 新增 `src/lib/server/agent/prompts/templates/treehole-poster/`，提供可复用的 `BOT.md` / `IDENTITY.md` / `SOUL.md` 模板，用于专门负责轻度整理随想并按明确触发发布帖子的 bot。
- **配置分层去重**: `BOT.md` 只承载工作流、发布触发和风险确认规则；`IDENTITY.md` 只定义身份边界；`SOUL.md` 只定义表达气质，避免三份配置互相重复。

### AI 用量与 Trace 页面分页支持 (AI Usage and Trace Pagination)
- **分页控制与每页条数自选**: 为 `/settings/ai/usage` 的“请求事件明细”和 `/settings/ai/trace` 的“最近 Trace Facts”表格添加了分页组件。每页支持可选条数（10/20/30/50/100，默认 20 条）。
- **多语言（i18n）支持**: 分页文本信息（例如 `第 1 / 5 页 (共 98 条记录)` / `Page 1 of 5 (98 records)`）和“上一页”/“下一页”导航控件完美匹配 `$locale` 多语言，在中英文下均可自动适应切换。
- **状态联动重置**: 在切换时间范围、模型、Bot、渠道或 Fact 调用类型等过滤条件时，分页状态会自动重置归零（`currentPage = 1`），保证过滤结果显示正确。

### Trace Skill 调用统计 (Trace Skill Usage Statistics)
- **Skill 调用指标卡**: `/settings/ai/trace` 在工具调用、模型请求卡片之外新增 "Skill 调用" 指标卡，展示当前筛选范围内 `skill_usage` fact 总数、实际执行（executed）次数与技能种类（distinct）。
- **技能使用排行表**: 新增 "技能使用排行" 表格，按技能 name 聚合命中（triggered）、加载（loaded）、执行（executed）次数、关联 run 数与平均耗时，与工具调用排行对齐。
- **API 汇总扩展**: `/api/settings/trace` 的 `buildStats` 现在产出 per-skill 汇总（`skills[]`）与 totals 字段（`skillUsages` / `executedSkills` / `distinctSkills`），level 取自 `payload.level`、scope 取自 `payload.scope`，复用既有 fact 读取链路，不新增存储。

### CLI Readline 退出防护 (CLI Readline Shutdown Guard)
- **TTY EIO 防护补齐**: 为 CLI adapter 增加统一的 readline shutdown guard。Ctrl+C、TTY 断开或 stdin `read EIO` 时会安静关闭 readline 并暂停 stdin，不再因为未处理的 `Interface` error 打出 Node.js 崩溃栈。
- **异步 prompt 防重入**: CLI line handler 在异步回复完成后会先检查 readline 是否已关闭，避免 Ctrl+C 后继续调用 `rl.prompt()` 重新读取已关闭的终端输入。

### Skill 使用追踪 Phase 1 (Implicit Skill Load Tracking)
- **隐式读取追踪**: 当模型通过 `read` 工具成功读取当前 run 已加载 skill manifest 中的 `SKILL.md` 时，runner 会记录 `skill.loaded`，并标记 `reason: "read_skill_file"`。这补齐了非显式 `/skill` / `$skill` 调用场景下，模型按 skill routing 自行读取技能文件但 trace 中没有 skill fact 的缺口。
- **路径与阻塞安全**: read 路径归因复用工具层 `resolveToolPath` 与导出的 `pathCompareKey`，支持 `data/moli-*/skills/...` 等既有路径纠偏；缓存只在 hook gate、preflight、budget 全部放行后写入，read 成功、失败、blocked 与 run cleanup 都不会残留 pending path。
- **单调 skill fact 合并**: `TraceRecorderHook` 现在为 `skill_usage` 维护 run 内合并态，使用 `payload.level` (`triggered` / `loaded`) 与 `payload.evidenceCsv` 累积证据，保证后到的低置信度信号不会把已 loaded 的 fact 降级。triggered-only skill facts 使用 `status: "info"`，避免被误显示为进行中。
- **实施说明**: Skill 使用追踪的长期行为记录在本文件与 Trace 设计文档中，不再保留单独的过程进度 checklist。

### Skill 使用追踪 Phase 2 (SkillSearch Candidate Tracking)
- **候选触发追踪**: 当 `skillSearch` 成功返回 `details.matches` 时，runner 会对每个结构完整的匹配项发出 `skill.selected`，并标记 `reason: "search_match"`，让 trace 能记录“被检索命中的候选 skill”，即使模型后续没有读取对应 `SKILL.md`。
- **防御式结果解析**: Phase 2 只读取 `context.result.details.matches`，并逐项校验 `name`、`scope`、`filePath` 为字符串；失败的 `skillSearch`、缺失 details、非数组 matches 或畸形 match 都会被忽略，不影响工具原始执行结果。
- **语义边界**: `search_match` 只会形成 `payload.level: "triggered"` / `status: "info"` 的 `skill_usage` fact；如果同一 skill 后续已由 Phase 1/3 标记为 loaded 或 executed，合并逻辑保持高置信度层级不降级。

### Skill 使用追踪 Phase 3 (Heuristic Executed Evidence)
- **可选 signals 元数据**: `SKILL.md` frontmatter 现在可声明 `signals`，支持 `cli`、`mcp`、`tools` 三类特征信号；实现同时兼容嵌套 `signals:` 写法和扁平 `signals_cli` / `signals_mcp` / `signals_tools` 字段。
- **加载后执行证据归因**: Runner 只对同一 run 内已经 loaded 的 skill 做执行证据归因。成功的 bash/tool/MCP 调用命中声明信号时，会追加 `cli_signal` / `tool_signal` / `mcp_signal` evidence，并把 `skill_usage.payload.level` 单调升级到 `executed`。
- **保守重叠处理**: 多个已 loaded skill 命中同一 signal 时，只归因给最近 loaded 的匹配 skill，避免一个工具调用同时污染多个 skill fact。executed 仍是启发式证据，不作为确定性执行证明。

### 导航栏图标优化与菜单名称展示切换 (Sidebar Emojis & Label Toggle)
- **语义化 Emoji 图标**: 优化了设置中心左侧一级导航的 5 个图标，使用更直观、高频表达的 Emojis (`🏠`, `🤖`, `💬`, `💾`, `⚙️`) 替换了原来的抽象几何符号。
- **名称展示切换开关**: 在一级导航底部添加了一个 `🏷️` (显示名称) 按钮，控制左侧边栏是否展开并显示各菜单组的文本名称（如 “总览”、“AI 引擎”、“渠道”等）。侧边栏展开宽度与底部固定保存栏的左侧定位均完美适配并自带过渡动画。状态保存在 `localStorage` 中，刷新页面亦可自动还原 operator 的选择。

### 设置页面全面响应式多语言支持 (Complete Reactive i18n Overhaul for Settings)
- **i18n 多语言架构升级**: 全面重构了 `/settings/` 目录下全部 24 个设置子页面，彻底移除了原本基于 MutationObserver 暴力 DOM 替换的 `localizeSettings` 机制。
- **响应式 `COPY` 与 `$locale` 绑定**: 统一在 Svelte 组件的 script 块中定义中英双语 (`zh-CN` / `en-US`) 的 `COPY` 本地数据源，并通过导入 `$lib/ui/i18n` 的 `$locale` 存储实现完全响应式的模板绑定 (`{copy.title}`)。用户切换语言时，所有动态文本（包括 placeholders、KPI 描述、表格头部、下拉选项和弹窗详情）瞬间即时更新，且绝不产生闪烁或文案漏译。
- **控件与底栏规范化**: 结合此前重构，对残留的开关控件统一升级为 `IosSwitch`，并规范使用固定的 `.settings-footbar` 底栏，确保在所有设置页面中均实现统一、专业、高水准的交互。

### 设置页面设计系统风格与 iOS Switch 适配 (Settings Pages Design System & iOS Switch Overhaul)
- **多页面统一风格重构**: 针对 `/settings/agents`, `/settings/memory`, `/settings/memory-rejections`, `/settings/skills`, `/settings/skill-drafts`, `/settings/run-history`, `/settings/tasks`, `/settings/host-bash`, `/settings/system`, `/settings/sandbox`, 和 `/settings/plugins` 11 个设置页面进行了全方位的风格重构，使用统一的 Warm Shadcn 布局和配色，弃用零散的 Tailwind 工具类，引入自定义 CSS 类名（`channel-page` 等），与已重构的 `/settings/web` 保持高度一致。
- **iOS Switch 开关组件升级**: 在所有重构页面的开关配置处统一使用 `IosSwitch` 源码组件，替换原本的原生 checkbox 或非 iOS Switch 开关。
- **粘性保存底栏适配**: 将所有带有配置保存/重置动作的页面（包括 Agents, Skills, Skill Drafts 等）的提交按钮和状态反馈信息，均迁移至固定于窗口底部的粘性底栏（`.settings-footbar`）中，确保无论表单多长用户都能随时一键保存。

### 定时任务 Fresh Session 与任务会话自动清理 (Scheduled Task Fresh Sessions & Auto Cleanup)
- **事件级 `sessionMode`**: `MomEvent` 新增 `sessionMode: "fresh" | "chat"`。`fresh` 表示每次触发在全新 session 中运行（不携带聊天历史），`chat` 表示沿用聊天 active session（旧行为）。默认值：periodic → fresh，one-shot/immediate → chat（`resolveEventSessionMode`）。解决日报类周期任务的历史报告逐日累积、每次运行重复支付全部历史 input token 的问题。
- **Fresh session 即 active session**: `MomRuntimeStore.beginTaskSession` 创建 `task-` 前缀的新 session 并切换为 active，任务报告发出后用户直接在聊天中回复即可微调——反馈自然落入该任务 session，生成上下文完整保留。下次任务触发时再开新 session，上一个自动归档。
- **任务会话自动清理**: `pruneTaskSessions` 在每次创建 fresh session 时按保留期删除过期的 `task-*` session（按 entries 文件 mtime 判定最近活跃时间）；active session 与非 task 前缀的用户 session 永不删除。保留期由 `settings.events.taskSessionRetentionDays` 控制（默认 7 天，0 = 不清理，env `MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS`）。
- **四渠道统一接线**: telegram / feishu（流式与非流式）/ weixin / qq 的 triggerTask 在 synthetic 消息上标记 `sessionMode`，session 解析统一收敛到 `BaseChannelRuntime.resolveInboundSessionId`。
- **createEvent 工具支持 sessionMode**: agent 创建定时任务时可显式指定 `sessionMode`，工具描述中说明了 fresh/chat 语义与默认值。
- 测试: 新增 `taskSessions.test.ts`（5 个用例：创建、过期清理、保留期关闭、默认模式解析、天数换算），全部通过。

## 2026-06-12

### Subagent 触发可观测性与触发场景扩展 (Subagent Trigger Observability & Scenario Widening)
- **run-summaries 持久化 Subagent 遥测**: `RunSummary` 新增 `subagent` 字段（`delegationNoticeSent` / `invoked` / `taskCount` / 每个任务的 agent、mode、stopReason、耗时、错误、任务预览），runner 在 `subagent_execution` 事件流中采集并写入成功/失败两条 run summary 路径。此前 subagent 是否触发只能在终端 momLog 中看到，无法事后查证；现在可直接 `grep '"subagent"' run-summaries.jsonl` 审计。
- **run closing note 展示 Subagent 使用情况**: 调用过 subagent 时显示任务数与角色；收到委派建议（12 次工具调用阈值）但未使用时显示 "delegation recommended but not used"，便于发现模型忽略建议的 run。
- **触发场景从 codebase-heavy 扩展为 file/shell-heavy**: 系统提示词（tools 段 + subagents 段）与 `SUBAGENT_DELEGATION_RUNTIME_NOTICE` 统一改写——日志/数据文件分析、长文档处理、多文件 artifact 构建等 bash 密集任务现在也被明确引导委派；同时新增反向约束：subagent 仅有 read/bash(/edit/write)，需要 webSearch/imageGenerate/attach 等父级工具的步骤不得委派。旧版 notice 文案保留在 transient 剥离集合中，历史会话中的旧 notice 仍会被正确清理。

### 文件工具加固 (File Tool Hardening: read/write/edit/bash)
- **edit `$` 替换模式 bug 修复**: `String.replace` 会把 newText 中的 `$&`/`$'`/`` $` `` 解释为特殊替换模式导致写入内容被悄悄破坏，现改用 replacer 函数按字面值插入。
- **edit 功能增强（参考 Claude Code FileEditTool）**: 新增 `replaceAll` 参数；多匹配时报具体数量并提示扩大片段或用 replaceAll；oldText===newText 提前拒绝；CRLF 文件按 LF 归一匹配、写回时还原原始换行风格。
- **read 重写**: 不再 spawn `wc`/`cat`/`tail`，改为 fs 直读 + JS 切片；修复带末尾换行文件总行数多报一行的 off-by-one；二进制文件（前 8KB 含 NUL）直接拒绝；图片超过 5MB 拒绝读取，避免 base64 撑爆上下文。
- **write 修正**: 返回的字节数改用 `Buffer.byteLength`（此前中文内容按字符数误报）；删除恒真的死代码条件。
- **bash 文件操作硬门禁**: `decideBashToolPolicy` 新增 `findFileToolRedirect` 规则——单独的 `cat`/`head`/`tail`/`less` 读文件、`echo/printf/cat > file`、heredoc、`echo | tee`、`sed -i`/`perl -i`/`awk -i inplace` 一律 deny 并提示改用 read/write/edit 工具；管道组合、多文件合并（`cat a b > c`）、`make | tee log` 等复合用法不受影响。bash 工具描述同步加了 prompt 级引导。
- **清理**: 删除 helpers.ts 中无调用方的重复 `truncateTail`（统一使用 truncate.ts 的 UTF-8 安全版本）。
- 测试: 新增 read.test.ts、bashPolicy.test.ts，扩充 edit.test.ts（`$` 字面值、replaceAll、多匹配、CRLF），tools 目录 80 个测试全部通过。

### 沙箱可写目录扩展与审批幂等回复 (Sandbox Writable Roots & Idempotent Approval Replies)
- **数据目录全量可写**: `buildEffectiveSandboxConfig` 的 allowWrite 现在包含 `config.dataDir`（默认 `~/.molibot`）与 workspaceDir，schedule/服务往数据目录内写入不再被沙箱拦截；bot 维度 scratch 目录仍是默认工作目录（cwd），数据优先落 scratch 的约定不变。denyWrite（`.env*`、`*.pem`、`*.key`、sandbox env 文件）依旧生效。
- **临时目录按真实路径放行**: macOS 上 `/tmp` 是 `/private/tmp` 的符号链接（`os.tmpdir()` 同理指向 `/private/var/folders/...`），沙箱按解析后路径匹配导致 `mkdir /tmp/longbridge-logs` 报 "Operation not permitted"。现在 allowWrite 同时加入 `/tmp`、`os.tmpdir()` 及二者的 `realpathSync` 结果，固定写临时路径的第三方 CLI（如 longbridge 日志目录）可直接工作。
- **重复审批操作幂等化**: 审批已处理后再次点卡片/再次回复，不再返回误导性的「未找到匹配的待处理 Host Bash 审批」，改为按记录实际状态回复（已通过正在执行 / 已批准并执行 / 执行失败原因 / 已拒绝 / 已过期），`describeResolvedApproval` 同时覆盖 approve / approve-session / reject 三条路径。

### Host Bash 审批交互修复：阻塞式审批门 (Host Bash Approval Interaction Fixes)
- **卡片命令截断**: `buildHostBashApprovalPrompt` 中展示的命令最多显示前 100 字符（超出加 `…`），不再把最长 4000 字符的完整命令塞进飞书卡片正文；审批结果卡/处理中卡复用同一 prompt body，一并生效。
- **审批改为 run 内阻塞门**: bash 工具的 `hostApproval` 请求不再以 "waiting_for_approval" 结束本轮、批准后改写上下文再 resume。`waitForHostBashApprovalAndExecute` 在 run 内轮询审批存储（最长 10 分钟，500ms 间隔，尊重 abort signal）：批准 → 原地执行宿主命令并把真实输出作为 toolResult 返回，run 持续流式更新；拒绝/过期 → 立即返回失败；仅等待超时才回退到旧的「批准后补跑 + resume」流程（测试可经 `approvalWaitTimeoutMs` 注入短超时）。审批卡片在等待开始时即通过 runner 事件下发。
- **去掉双重审批门**: `decideBashToolPolicy` 不再对带 `hostApproval` 的 bash 调用走 ApprovalBroker 门控（此前同一条命令要先批 broker 请求、再批 Host Bash 记录，各出一张卡）。
- **执行权原子认领**: 新增 `executing` 状态与 `HostBashStore.claimExecution`（`approved → executing` 的 CAS）。run 内等待者与渠道审批处理器都先 claim 再执行，彻底消除双重执行竞态；输掉 claim 的一方继续轮询直至赢家写入 executed/failed。
- **isRunActive 修复**: run id 实际是 `chatId-sessionId-messageId`，旧实现用 scopeId 查 `runs.id` 永远 false（"活跃 run 自动执行" 分支从未生效）。改为按 `session_id + status='running'` 查询并套用 10 分钟锁超时；run 活跃时审批只落库由阻塞中的 bash 执行，另挂 3 秒延迟兜底（`scheduleHostBashExecutionFallback`）防止等待已超时的批准被丢弃。
- **双审批体系桥接**: 用户文字回复「本会话允许/永久允许/拒绝」及卡片点击现在也会 resolve 同 scope 下 pending 的 ApprovalBroker 请求（`resolvePendingBrokerRequests`），仅有 broker 请求（无 Host Bash 记录）时文字审批同样命中；`ApprovalBroker` 新增 `listPendingRequests()`。修复审批通过后 run 仍报 "User approval timeout" 的问题。
- **回归验证**: 新增「阻塞等待→批准→原地执行」用例（bash-output.test.ts）与 `claimExecution` 竞态用例（store.test.ts）；更新 index.test / channelCommands.test 断言新语义；相关 9 个套件 77 个用例全部通过。

### 沙箱 Host Bash 审批流程优化 (Sandbox Host Bash Approval UX Overhaul)
- **沙箱失败检测收紧**: `isSandboxPermissionFailure` 不再对输出做 `sandbox`/`socket`/`ipc`/`access denied` 等宽泛子串匹配，只匹配 OS 沙箱真实产生的签名（`operation not permitted`、`permission denied`、`sandbox-exec`、`seatbelt`、`EPERM/EACCES`），大幅减少普通失败命令误触发自动 Host 审批。
- **审批卡片改为明确三档授权**: 审批提示统一为「仅此一次 / 本会话允许 / 永久允许此工具 / 拒绝」，按钮语义不再随请求类型（persistent/ephemeral）变化；无法归约为可复用 capability 的一次性脚本不显示「永久允许」。飞书卡片、Telegram inline keyboard、QQ/微信文字回复与 Web `/hosttools` 全部对齐。
- **普通「批准」改为最小授权**: 回复 `批准`/`approve` 或点击旧卡片的 Approve 仅执行一次、不落白名单；落白名单需显式回复 `永久允许` 或点「永久允许此工具」；`/hosttools approve` 保持白名单语义，新增 `/hosttools approve-once`。
- **复合命令一次审批全量授权**: 永久批准时把命令分类出的所有 capability（如 `gh | osascript`）分别写入 `approval_grants` 白名单，后续任一工具单独使用均免审批。
- **pending 审批 TTL + 同工具旧卡失效**: 待审批记录 60 分钟自动过期（新增 `expired` 状态）；同一 scope 下同一 capability 的新审批请求会使旧的 pending 卡片自动失效，重试命令不再堆积多张活动卡片；完全相同的命令仍复用现有 pending。
- **toolRuntime 通用审批路径修复**: 审批请求 ID 加时间戳+随机后缀消除同 run 同工具的 ID 冲突；审批提示卡现在显示真实命令/路径（之前显示的是工具名）。
- **回归验证**: 新增 `src/lib/server/hostBash/store.test.ts`（once 不落白名单、复合命令全量授权、旧卡失效、相同命令去重）；更新 `approval.test.ts`、`channelCommands.test.ts` 断言新语义，相关套件 77 个用例全部通过。

### Profile 三层作用域一致性修复 (Profile Scope Consistency)
- **BOT.md 真覆盖 AGENTS.md**: 系统提示词拼装中，当 bot 目录存在 `BOT.md` 时不再同时注入 agent/global 的 `AGENTS.md`，与 `profileFiles` 工具 bootstrap 的"bot 覆盖 agent 覆盖 global"语义对齐，消除 bootstrap 后同一内容在提示词里出现两遍的问题。
- **USER/TOOLS 回退链对齐**: `profileFiles` 工具的父级回退只在 agent 维度实际包含该文件（`AGENTS/SOUL/IDENTITY/SONG`）时才检查 agent 目录；`USER.md`、`TOOLS.md` 直接回退到 global，与提示词拼装一致，避免 agent 目录残留文件导致"读到的"与"实际生效的"不一致。
- **常量去重**: 工具复用 `BOT_PROFILE_FILES`，提示词拼装的 global 默认文件列表复用 `GLOBAL_PROFILE_FILES`，frontmatter 剥离逻辑统一复用 `profiles.ts` 的 `normalizeEditableBody`，消除三处手抄副本的漂移风险。
- **bot 根路径解析加固**: `profileFiles` 的 `resolveBotRoot` 现在把路径截断到 `/bots/<botId>`，传入更深层路径（如 chat 目录）也能解析出正确的 botId。
- **回归验证**: `prompt.test.ts` 新增用例覆盖"无 BOT.md 时注入 global AGENTS.md / 有 BOT.md 时只注入 BOT.md"两种合并行为。
### Agent Hook 框架加固与可插拔化 (Agent Hook Framework Hardening & Pluggability)
- **Gate 失败默认拒绝 (fail-closed)**: gate 类 hook 抛错或超时时不再静默放行，默认返回 `deny`（`HOOK_GATE_FAILURE`）；hook 可声明 `failMode: "open"` 显式选择失败放行。
- **Observe 队列按 run 隔离**: `DefaultHookManager` 的 observe 事件队列从全局单链改为按 `runId` 分队列，慢 hook 不再拖慢其他并发 run；`flush()` 支持 `runId` 参数做单 run 排空，runner 结束时改用 `flush({ runId, timeoutMs: 2000 })`。
- **Emit payload 快照**: `emit()` 时对 payload 做 `structuredClone` 快照，调用方在 emit 后修改对象不会影响异步 hook 看到的数据。
- **Transform 管线默认启用并接入 runner**: `input.enrich.after` 支持 transform hook 改写富集后的输入文本；`prompt.build.after` 支持 transform hook 改写系统提示词（在 prompt 重建时应用并随 promptRefreshKey 缓存）。
- **TraceRecorderHook 状态防泄漏**: run 状态与 fact 起始状态改为按 runId 的二级 Map，run 结束整体释放；新增 1 小时 TTL + 5 分钟间隔清扫，覆盖 `run.finished` 永不到达的异常路径。
- **插件加载入口**: 新增 `pluginRegistry.ts`（`registerHookPluginFactory` / `applyConfiguredHookPlugins`），由 `settings.plugins.hooks: [{ id, enabled, options }]` 控制启用；单个插件 init 失败不影响其它插件和运行时启动。插件 hook id 自动加 `pluginId/` 命名空间防冲突；`unregisterPlugin` 先 flush 在途事件再 destroy。
- **类型化 Stage Payload**: 新增 `StagePayloadMap`，`emit/transform/gate` 按 stage 类型约束 payload 字段（保留开放索引签名）；未接入的 stage 在 `HookStage` 上标注 `(reserved)`。
- **小优化**: stage→hooks 索引缓存（注册/注销时失效）替代每次 emit 全量排序过滤；runner 的内联空实现替换为共享 `NOOP_HOOK_MANAGER`。
- **回归验证**: `manager.test.ts` 新增 fail-closed / fail-open、transform 链式 replace、per-run flush 隔离、payload 快照、插件命名空间用例；hooks 全部测试与 `runner.test.ts` 通过。

## 2026-06-11

### Adapter-node SQLite 构建告警清理 (Adapter-node SQLite Build Warning Cleanup)
- **显式 external 化 `node:sqlite`**: SvelteKit 生产构建改用项目内 adapter-node 变体，在 adapter 最终 Rollup 打包阶段把 `node:sqlite` 标记为 external，避免 build 末尾出现无法解析 `node:sqlite` 的 adapter 告警。
- **Node 版本前提收紧**: 项目 `engines.node` 从 `>=22.0.0` 调整为 `>=22.5.0`，对齐内置 `node:sqlite` 的真实运行要求。

### DB 目录集中管理 (Centralized DB Directory)
- **统一 SQLite 默认目录**: 默认数据库目录新增为 `${DATA_DIR}/db`，`settings.sqlite`、`inbound-queue.sqlite`、`outbox.sqlite` 和 Mory 的 `mory.sqlite` 都集中到该目录下，不再散落在数据根目录或 `memory/` 子目录。
- **旧路径自动迁移**: 启动初始化会在新路径不存在时把旧的 `${DATA_DIR}/settings.sqlite`、`inbound-queue.sqlite`、`outbox.sqlite`、`memory/mory.sqlite` 迁移到 `${DATA_DIR}/db/`，并同步迁移 SQLite 的 `-wal` / `-shm` sidecar 文件。
- **显式路径仍可覆盖**: 新增 `DB_DIR` 环境变量控制统一 DB 目录；`SETTINGS_DB_FILE` 等显式测试或运维路径保持优先，避免破坏隔离测试和自定义部署。

### Feishu 多机器人群聊 @ 归属过滤 (Feishu Multi-Bot Mention Ownership)
- **严格匹配被 @ 机器人身份**: Feishu 群聊主消息流现在只有在消息 `mentions` 命中当前 Bot 的身份 ID 时才触发运行；@ 群内其他机器人不会再让本实例响应。
- **移除任意 @ 兜底误触发**: 当当前 Bot 身份尚未解析或解析失败时，群聊 direct mention 不再退化为“只要有任意 @ 就响应”，避免多机器人群里同时回复。私聊和已登记 Bot thread 续聊逻辑保持不变。
- **Bot 身份解析对齐 openclaw-lark**: 运行时和 `/api/settings/feishu/test` 现在优先使用 `POST /open-apis/bot/v1/openclaw_bot/ping` 读取 `pingBotInfo.botID/botName`，仅在 ping 未返回身份时回退到 `/open-apis/bot/v3/info`，避免旧接口返回 `code: 0` 但身份字段为空导致群聊 @ 全部被忽略。
- **防止忙碌重试复制队列**: Feishu 入站 worker 遇到 “Another run is currently active” 时不再重新插入一条队首任务，避免启动恢复或锁竞争时把同一条消息复制成大量 completed/pending 记录并放大 SQLite 锁冲突。
- **完成/废弃队列自动清理**: 共享 `PersistentTaskQueue` 改为在成功、失败、手动删除、批量取消以及启动时发现遗留 running 任务时直接删除 SQLite 记录，避免跨渠道入站队列长期保留 completed/failed/cancelled 记录导致数据库膨胀、WAL 变大和首个设置页请求被 runtime 初始化拖慢。
- **SDK 适配判断**: 现有 Feishu runtime 已使用 `@larksuiteoapi/node-sdk` 的 Client / WSClient / EventDispatcher；本次问题属于入站触发过滤和身份探测 endpoint 选择，不需要引入额外 SDK 适配层。
- **回归验证**: 扩展 `src/lib/server/channels/feishu/message-intake.test.ts` 和 `src/routes/api/settings/feishu/test.server.test.ts`，覆盖 @ 当前 Bot 放行、@ 其他 Bot 忽略、Bot 身份未知时忽略群聊 @、已知 Bot thread 继续免 @ 续聊、ping 身份解析和 v3 fallback。

## 2026-06-10

### Global Profile File 防误写保护 (Global Profile File Write Guard)
- **移除路径自动重路由**: 从 `resolveToolPath` 中移除 `resolveGlobalProfilePath`，不再将被判定为 profile 文件名的路径无条件重路由到 `dataRoot/`。此前 `SOUL.md` 等文件名无论路径层级都被解析到全局文件，导致 bot 维度的 write/edit 误改全局配置。
- **门禁阻断全局 profile 直接写入**: `createPathGuard` 对全局 profile 文件 (AGENTS.md, SOUL.md, TOOLS.md, BOOTSTRAP.md, IDENTITY.md, USER.md, SONG.md) 由**显式放行**改为**显式拒绝**，统一提示使用 `profileFiles` 工具管理。读取能力不受影响——`profileFiles` 工具内部直接调用 `profiles.ts` 的读写函数，不经过路径守卫。
- **修复文件**: `src/lib/server/agent/tools/path.ts`

## 2026-06-08

### Feishu Bot 健康检查与 Thread 续聊 (Feishu Bot Health Check & Thread Continuation)
- **Bot 连接测试**: 新增 `/api/settings/feishu/test`，允许 `/settings/feishu` 使用当前表单中的 `appId` / `appSecret` 直接测试飞书 Bot 凭据，成功时返回 Bot 名称和 `open_id`，失败时返回飞书 SDK `code` / `msg` 或本地校验错误。
- **设置页健康面板**: 在 Feishu Bot Configuration 区块加入 `Test Connection` 操作和结果面板，保留现有多 Bot 单实体保存流程与 `.settings-footbar` 固定保存底栏。
- **Thread 免 @ 续聊**: Feishu 入站消息保留原始 `message_id`、`thread_id`、`parent_id`、`root_id`，并为 thread 生成独立 `scopeId`，让同一群里的不同 thread 拥有独立 session、队列、附件和运行日志。
- **保守触发策略**: 群主消息流仍需 @ Bot；只有 Bot 已在某个 Feishu thread 中回复过，或用户回复命中已知 Bot 消息时，该 thread 后续无 @ 消息才会触发同一对话。旧 registry 数据缺失时，用户只需在老 thread 中重新 @ 一次。
- **Thread 内回复渲染**: Feishu 文本、卡片、CardKit streaming、文件/图片 fallback 均支持 `im.message.reply({ reply_in_thread: true })`，关闭 CardKit streaming 后也不会退回群主消息流。
- **回归验证**: 新增 Feishu intake、thread registry、messaging reply 和 settings test endpoint 覆盖；验证普通群无 @ 不触发、带 @ 触发、已登记 thread 无 @ 触发、未知 thread 无 @ 不触发，以及 thread 回复走 `im.message.reply`。

## 2026-06-07

### System Prompt Skill Routing 合并与 Preview 防误导 (System Prompt Skill Routing Merge & Preview Guardrail)
- **Skill routing 去重**: 将独立的 `Skill Routing (Mandatory)` section 合并回 `Message Processing Pipeline` 与 `Skills Protocol`，保留显式 skill 调用、`[explicit skill invocation]` 权威路径、读取 `SKILL.md`、输出媒介不静默降级和失败 fallback 等规则，同时减少系统提示词重复段落。
- **静态 preview 防误导**: 将 `src/lib/server/agent/prompts/templates/SYSTEM_PROMPT.preview.md` 从过期的完整旧样例改成静态占位说明，明确真实预览来自 `buildSystemPromptPreview()` / Web prompt preview endpoint / runtime 生成文件，避免继续传播手写 event JSON 的旧调度做法。
- **Prompt 长度回归检查**: `prompt.test.ts` 新增真实 `buildSystemPromptPreview()` render 测试，使用临时 workspace 校验 broad size budget，并固定 `available-deferred-tools`、`createEvent`、`skillSearch`、`skills-protocol` 等关键路由锚点。
- **验证命令更新**: 系统提示词重构方案文档中的验证命令已从不可用的 `npm test -- --run ...` 更新为当前仓库可执行的 `node --import ./scripts/register-loader.js --import tsx --test ...`。
- **ToolRuntime 测试库隔离**: `ToolRuntime` 支持注入测试专用 `WorkspaceStore`，`toolRuntime.test.ts` 的 workspace whitelist 用例改用临时 SQLite 文件，避免写真实 settings DB 并修复 `attempt to write a readonly database` 失败。

### Trace Facts 模型用量补写与 Usage 关联 (Trace Facts Model Usage Backfill & Usage Alignment)
- **模型调用 token 补写**: Runner 在 assistant 消息结束并拿到 `usage` 后，会额外向 HookManager 发出同一 `modelAttemptId` 的 `model.call.after` 事件，使 `agent_trace_facts` 的 `model_call` 记录也能拿到 input/output/cache/total token。
- **工具后续写模型请求拆分记录**: 同一个 Agent prompt 内如果发生“模型请求 -> 工具调用 -> 工具结果后再次请求模型”的循环，每次真实 AI API 请求都会生成独立的 `modelAttemptId`，避免工具后的模型请求覆盖第一次模型调用 fact。
- **Trace 与 Usage 口径对齐**: `/settings/ai/usage` 继续作为独立用量账本读取 `usage/ai-usage.jsonl`；`/settings/ai/trace` 继续读取 SQLite trace facts，但现在通过同一 run/session/model attempt 维度记录模型用量，便于把用量统计和运行 trace 对上。
- **total token 兜底计算**: 当模型返回 usage 里没有显式 `totalTokens` 时，TraceRecorder 会用 input/output/cache read/cache write 相加补出总数，避免 Recent Trace Facts 里只有分项没有总数。
- **回归验证**: 更新 `traceRecorderHook.test.ts` 和 `runner.test.ts`，覆盖 cache token 透传、total 兜底和 runner 模型调用 hook payload。

## 2026-06-06

### Agent HookManager 运行时扩展 (Agent HookManager Runtime Extension)
- **运行时可插拔 HookManager**: 新增了基于事件总线的 `HookManager` 模块，为 Molibot Agent 的各项关键生命周期事件（包括运行启动/结束、模型调用前/后、工具调用前/后、工具拦截/报错、技能选择/加载）提供可插拔的插件系统。
- **内置调试与 trace telemetry 插件**: 实现了两个内置 observe 插件——`DebugLogHook`（向控制台输出诊断日志）和 `TraceRecorderHook`（将 sanitized 后的结构化运行 trace 日志通过 `SqliteTraceStore` 存储在本地 SQLite 数据库中，并以 `runId` 隔离/在结束后清理状态以防泄漏）。
- **统一 trace facts 分析表**: 在保留原始 `agent_trace_events` 事件流的同时，新增统一 `agent_trace_facts` 表，用 `fact_type` 区分 `tool_call` 与 `model_call`，将工具名、调用状态、耗时、模型 provider/model、token usage 等常用分析字段独立成列，便于按 session/run 统计调用次数和关联工具。
- **Trace 分析设置页**: 新增 `/settings/ai/trace` 与 `/api/settings/trace`，复用用量统计页的时间段筛选体验，按 Usage 页同一 `botId` 口径记录和筛选 Bot，并支持 channel、chat ID、session ID、run ID、fact 类型和读取上限筛选；页面展示工具调用、模型请求 token、Bot、channel/chat、session、run、最近 facts 等汇总与明细，方便核对某个工具是否实际调用及调用次数是否符合预期。
- **拦截控制网关与拦截事件日志**: 实现了 gate net 网关能力，允许注册拦截型 hook 依据自定义的安全或预算策略直接在 tool preflight/budget 前提拦截 tool 执行，并通过 `tool.call.blocked` 上报 `blockedBy: "hook_gate"`。
- **全链路依赖注入与 Runner 桥接**: 在 runtime 引擎（`baseRuntime`、Web context）以及 `RunnerPool` 和 `MomRunner` 中完整注入了 `hookManager` 单例，并将 `pi-agent-core` 的回调和 Molibot 本身的模型选择、技能加载完整桥接至事件通知网关。
- **终态 trace 与插件生命周期修复**: 修复 Runner 早退路径未写入 `run.finished` 的问题，确保设置错误、缺失 API Key 等未进入 `agent_end` 的运行也有终态 trace；同时让 `HookPlugin.init()` 接收真实 `RuntimeSettings`，并修复 critical observe hook 失败后 observe 队列不再处理后续事件的问题。

### SQLite 动态设置迁移与细粒度 API 改造 (SQLite Settings Migration & Fine-grained APIs)
- **设置配置存储数据库迁移**: 将原本存放在 `settings.json` 里的 `webSearch` (搜索配置)、`imageGenerate` (图片生成配置)、`videoGenerate` (视频生成配置) 和 `toolSandbox` (运行沙箱配置) 统一迁移到 SQLite `settings_dynamic` 数据库表中，通过键值对和 JSON 序列化形式结构化存放，减小大 JSON 文本对内存和持久化的压力。
- **动态键值存储与表合并**: 废弃了原方案创建 7 张具体配置子表的做法，改用现有的 `settings_dynamic` 动态表，使用对应的 `settings_web_search`、`settings_image_generate`、`settings_video_generate` 和 `settings_sandbox` 作为键进行存储。
- **启动时配置与旧表自动搬迁**: 在系统加载 `SettingsStore` 时，会自动检测 `settings.json` 中的旧字段以及 SQLite 中若已存在的旧版独立表，将其搬迁、转换并导入 `settings_dynamic` 键值行中，并在落盘时自动把 `settings.json` 中的旧字段以及 SQLite 中的旧表进行清理与删除。
- **推出统一动态更新 API**: 新增了统一配置更新与读取接口 `/api/settings/dynamic/[key]`，支持对具体 Key 配置进行 `GET` (读取)、`PUT`/`POST`/`PATCH` (写与更新)。Web 搜索、图片生成、视频生成和沙箱设置页面在初始化时均通过该 API 独立按需加载，保存时仅对该 Key 进行增量修改并回写，从而完全免去了旧的 `/api/settings` 大查询与原本的独立更新接口，有效规避冲突。

### AI 提供商页面样式切换与模型开关保存修复 (AI Providers Page Switches & Model Enable Save Fix)
- **提供商页面独立 API 解耦**: 扩展了 `/api/settings/custom-providers` 接口，支持 `GET` (读取提供商相关配置) 和 `PUT` (保存提供商模式、默认服务商设置)，重构了 `/settings/ai/providers` 设置页面使其初始化和保存时仅定向请求此接口，彻底取消了对大 `/api/settings` 接口的依赖。
- **Shadcn iOS 开关替换**: 将 AI 提供商设置页面（`/settings/ai/providers`）的提供商启用状态与单模型启用状态两处自定义 HTML checkbox 开关，替换为 `src/lib/components/ui/switch` 统一的 iOS 样式开关组件。
- **自定义模型启用保存修复**: 修复了模型列表单模型启用状态无法被保存的 Bug。更新了 `ProviderModelConfig` 类型定义与 `+page.svelte` 保存函数映射机制，打通了 `enabled` 状态的序列化与存储。并修正了 `ensureProviderDefaults`、`addModel`、`confirmAddModel` 和 `addDiscoveredModel` 中对 `enabled` 字段的正常传递与默认初始化，防止在保存映射和新增模型时丢失 `enabled` 属性值。
- **后台过滤与路由对齐**: 在模型选择与路由层（`modelRouting.ts` 的 `pickCustomModelId`、`getProviderModel` 以及 `modelSwitch.ts` 的 `buildModelOptions` 等）增加了 `enabled !== false` 过滤机制，避免已被禁用的自定义模型参与服务路由或展示在可选列表中。
- **Svelte a11y 构建告警清理**: 修复 Providers、Image、Video 设置页的 modal/backdrop 可访问性告警，移除静态 modal card 上的 click/keydown handler，改用 backdrop 自身目标判断关闭弹窗；为图标关闭按钮添加 `aria-label`，并为视频预览补充有效 captions track，使 `npm run build` 不再输出 Svelte a11y warnings。

### HookManager 运行时扩展设计方案细化与评审 (HookManager Runtime Spec Refinement & Review)
- **挂载式多播设计**: 明确 HookManager 并非替代 pi-agent-core 循环，而是作为其上的多播层挂载在已有回调点（`beforeToolCall`, `afterToolCall`, `subscribe` 等）上。
- **生命周期语义澄清**: 重命名阶段为 `run.started` / `run.finished` 以与 pi-agent-core 内部 LLM turn-level 状态区分；重新规划 `beforeToolCall` 桥接点，使 gate 拦截在 preflight/budget 前置触发。
- **运行性能与内存防护**: 确立 observe hook 默认以异步非阻塞队列运行以不增加 LLM 响应延迟；要求全局 `TraceRecorder` 实例内部的状态（如 span stack）必须以 `runId` 隔离并在结束后清理，避免跨会话污染与内存泄漏。
- **可插拔插件接口**: 新增 `HookPlugin` 接口定义，为未来的 S3 结果导出和 Webhook 通信留好扩展插槽。

### AI 设置页面顶部 Hero 栏尺寸收缩与统一 (AI Settings Pages Hero Header Compact Unification)
- **全局顶部栏缩减**: 为包括 Routing、Providers、Errors、MCP、Search、Image、Video、Usage 以及其他 16 个使用 Tailwind inline classes 布局的普通设置页面在内的所有设置页面，应用了全局统一的 Hero 头部样式规范。
- **排版与间距优化**: 将所有标题的字号从 `1.875rem` / `2rem` 缩小至 `1.375rem`，描述文字字号统一至 `0.8125rem`（13px）并且行高设为更紧凑的 `1.45`。头部内的间距 gap 从 `0.75rem`/`1rem` 缩减至 `0.375rem`，下边距设为 `0.5rem`。
- **多余垂直留白消除**: 将各设置页面最外层容器在 Svelte 结构中渲染的默认 `padding-top` 从 Tailwind 默认的 `py-8` / `sm:py-10` 重载并缩减为统一的 `0.5rem !important`，从而消除由于 Layout 叠加导致的上方过大空白。

### AI 设置页面底部固定栏全宽适配与样式抽离 (AI Settings Pages Footer Full-Width & Style Extraction)
- **底栏全宽适配**: 将路由（`/settings/ai/routing`）、提供商（`/settings/ai/providers`）、报错记录（`/settings/ai/errors`）、MCP（`/settings/mcp`）、搜索（`/settings/search`）和视频（`/settings/video`）等设置页面的底栏从 `div` 元素改为 HTML5 语义化的 `footer` 元素。这成功绕过了 `workbench.css` 中限制 `.settings-viewport > div` 最大宽度的样式污染，使底栏可以像用量统计页面一样，完整打通横跨右侧的整个右半屏幕宽度。
- **自定义样式完全抽离**: 将上述所有 AI 设置子页面（包括路由、提供商、用量统计、报错、MCP、搜索、图片、视频等 8 个页面）中的 Svelte 内部 `<style>` 样式块完全删除，全部转换为普通类名，并将所有对应样式规则整合到全局独立的 `src/styles/settings-custom.css` 中，防止 Svelte 编译器在运行时动态在 `<head>` 中生成大量 scoped 内部样式（即 Header code 样式）。
- **去内联样式与规范化**: 移除了搜索设置页面中测试结果成功提示的内联 style，在 `settings-custom.css` 中新增 `.search-test-result[data-tone="success"]` 类选择器，并通过 `data-tone` 进行样式绑定。

### AI 设置子页面统一重构与布局居中对齐 (AI Settings Pages Styling Unification & Center Alignment)
- **统一居中展示**: 重构了所有 AI 设置相关页面（包括路由、提供商、用量统计、报错记录、MCP、搜索、图片和视频设置页面），为它们的主页面容器（`.routing-page`、`.providers-page`、`.usage-page`、`.errors-page`、`.mcp-page`、`.search-page`、`.image-page` 和 `.video-page`）添加了统一的居中对齐规则（`margin: 0 auto;`），使得中间的内容区域左右留白完全对称，彻底解决了在大屏下左偏的问题。
- **打通全屏的底栏**: 将所有页面的粘性保存/操作底栏（`.settings-footbar`）从页面的 max-width 容器中移到最外层，从而配合全局 `left: calc(72px + 260px); right: 0;` 属性，能够真正打通全屏，横跨整个右侧主显示区。
- **提供商与图像设置页 Hero 头部适配**: 移除了提供商设置（`/settings/ai/providers`）和图像生成设置（`/settings/image`）对 Svelte `SettingsSection` 布局组件的依赖，替换为与路由页面一致的精美 `.providers-hero` / `.image-hero` 衬线标题头部，并进行了 scoped CSS 的精细化编写。
- **视频设置页固定底栏与表单联动**: 重构了视频生成设置页面（`/settings/video`）的表单结构，将其输入控制及引擎列表包裹在 `<form id="video-form" ...>` 中。将原先位于卡片底部的普通保存按钮，移至悬浮在下方的固定粘性底栏（`.settings-footbar`），始终横跨全屏底部，与表单 action 完美绑定，从而实现 AI Settings 下所有页面交互和视觉风格的绝对统一。

### Telegram 视频附件扩展名保留 (Telegram Video Attachment Filename Preservation)
- **保留媒体扩展名**: Telegram `attach` 上传二进制媒体时，如果工具传入的 `title` 没有扩展名，会自动补回源文件路径的扩展名。例如本地文件 `aerobics_practice.mp4` 搭配标题“女健美操运动员练习视频”时，实际上传文件名会变成“女健美操运动员练习视频.mp4”，避免平台因上传文件名缺少 `.mp4` 而出现视频展示异常。
- **视频流式播放提示**: `sendVideo` 现在附带 `supports_streaming: true`，让 Telegram 更明确地按原生视频消息处理可在线播放的 MP4。
- **回归测试补充**: `runtime.test.ts` 新增覆盖“标题无扩展名但源文件是 `.mp4`”的上传文件名解析断言。

### 设置页面样式重构 (Settings Pages Styling Refactor)
- **errors/mcp/search 页面 Warm Shadcn 重构**: 重构了模型报错记录（`/settings/ai/errors`）、MCP 服务（`/settings/mcp`）和搜索工具（`/settings/search`）这三个设置页面的样式与布局，彻底弃用旧的 `.wb-` Workbench 样式，转为与 AI 路由页面一致的 Warm Shadcn 高级衬线排版风格。
- **iOS 粘性保存底栏适配**: 将 MCP 服务与搜索工具设置页面的保存按钮重构为符合 `DESIGN.md` 规范的固定粘性底栏（`.settings-footbar`），始终悬浮在内容区最下方，并联动 `<form>` 提交动作。模型报错记录页面的“刷新记录”操作也被集成到了固定底栏中。
- **iOS-style 状态开关组件**: 将 MCP 服务列表和搜索引擎列表里的原生 HTML 开关/逻辑，重构为统一的 Svelte `<Switch>` 源码组件，配合明暗模式实现平滑过渡。
- **移除 SettingsSection 布局依赖**: 取消这三个页面对 `SettingsSection` 包装组件的依赖，替换为自定义的 Hero 头部区域，并清理了文件中未使用的 Svelte UI 组件导入。

### 图像生成记录入库与历史记录管理 (Image Generation SQLite Logging & History Management)
- **SQLite 增加图像记录表**: 在 SQLite 数据库中新增 `image_tasks` 表，用于存储图像生成任务记录（包含 `id`、`engine`、`session_id`、`status`、`prompt`、`image_path`、`image_url`、`request_params`、`error_message`、`created_at`、`updated_at`）。
- **工具执行同步入库**: 在 `imageGenerate` 工具执行时，生成唯一 Task ID，先向 SQLite 写入一条 `processing` 记录；并在生成完成后，将状态更新为 `completed`（保存本地绝对路径与远程 URL）或 `failed`（保存错误信息）。
- **后台 API 路由配置**: 新增 `/api/settings/image-generate/tasks` 接口，支持读取最近 50 条图像生成记录及根据任务 ID 删除记录；新增 `/api/settings/image-generate/image` 接口，支持根据任务 ID 读取并串流本地图像文件或重定向到远程公网 URL。
- **设置页面历史查询与重构**: 在 `/settings/image` 设置页面下方新增“最近生成记录”表格，展示生成记录的创建时间、任务 ID、引擎、提示词、状态，并支持“查看结果”（弹出浮窗展示生成的图片与详细元数据）、“查看参数”（查看/复制原始请求参数）和“删除”操作。
- **粘性保存底栏适配**: 将图像生成设置页面的提交表单重构为符合 `DESIGN.md` 规范的固定粘性底栏（`.settings-footbar`），以提供更加一致、流畅的保存交互体验。
- **单元测试覆盖**: 在 `imageGenerateTool.test.ts` 单元测试中，新增针对 SQLite 任务入库和记录详情的完整断言。

### 视频远程 URL 存储与 302 重定向播放 (Remote Video URL Storage & Redirect Streaming)
- **取消大型文件本地下载**: 从后台任务轮询器（`/api/settings/video-generate/tasks`）和 `videoGenerate` 工具的查询逻辑中，移除了拉取下载远程 `.mp4` 文件到本地并落盘的步骤。这彻底解决了在网络较差或目标存储服务连接不稳定时（如遇到 Google GCS 的 `ECONNRESET` TLS 连接重置错误）而导致已成功生成完成的任务在本地库被误判/更新为 `failed` 失败状态的问题。
- **SQLite 增加远程 URL 字段**: 更新 [`videoTaskStore.ts`](file:///Users/gusi/Github/molipibot/src/lib/server/agent/videoGenerate/videoTaskStore.ts)，在任务记录表 `video_tasks` 中安全增加 `video_url` 列。在服务启动初始化时，会自动执行表结构变更，从而安全保留已有的任务数据。
- **Agent 查询优先使用 SQLite 缓存**: 当 `videoGenerate` 通过 `taskId` 查询任务时，优先读取 `video_tasks`。已完成任务直接返回 DB 中的 `Remote URL`；处理中任务若 `updated_at` 距今不超过 30 秒，则直接返回缓存进度；超过 30 秒才向供应商查询一次状态并把最新进度或 `video_url` 写回 DB。
- **302 重定向透明流式预览**: 优化了 `/api/settings/video-generate/video` 后端流媒体响应接口。在检测到任务无本地保存文件但有远程 `videoUrl` 时，自动返回 302 重定向至远程地址，使得控制台内置的播放器和下载链接可以免修改、无感地在线播放或下载远程生成的视频。
- **工具返回远程地址给 AI**: `videoGenerate` 工具查询完成后直接将 `Remote URL: https://...` 返回给 AI Agent 的上下文。若 DB 中同时存在本地路径才附带 `Local path`，不再因本地路径为空输出 `unknown` 或触发本地文件查找。
- **请求参数入库与详情/列表展示**: 在 SQLite 的 `video_tasks` 表中安全增加了 `request_params` 字段。在 AI Agent 创建视频任务时，自动捕获并存入提交给云端 API 的所有原始请求参数（例如：prompt、model、images 等）。在 `/settings/video` 页面任务列表的“操作”列中，直接新增了“查看参数”按钮（当存在请求参数时即可点击，支持生成中状态），并在详情弹窗中增加了“请求参数”格式化 JSON 复制区块，便于核对和排查提示词及参考图引用关系。


### 图像绝对路径输出与 images 参数容错标准化 (Image Path Visibility & Robust Parameter Normalization)
- **图像远程 URL 与绝对路径输出**: 更新了 `imageGenerate` 工具返回的成功文本内容。当供应商返回公网图片地址时，工具会输出 `Remote URL: https://...`，同时继续输出本地保存路径 `Saved file to` 与绝对路径 `Absolute path`。这确保了当图片成功生成时，AI Agent 能够优先把公网 URL 传给后续视频生成工具，同时保留本地归档文件用于查看和调试。
- **渠道上传失败不吞掉生成结果**: `imageGenerate` 将图片生成/保存成功与聊天渠道上传成功分离。若 Telegram 等渠道 `sendPhoto`/`sendDocument` 网络失败，工具仍返回成功结果、远程 URL、本地路径和上传错误说明，避免 Agent 误判为图片生成失败。
- **images 参数容错与标准化**: 将 `videoGenerateSchema` 中的 `images` 字段类型修改为支持数组或单个字符串（使用 `Type.Union`）。在工具执行时，对传入的 `params.images` 进行了运行时标准化处理：支持自动解析 JSON 字符串化数组（例如 `'["/path/to/img"]'`) 并映射为常规的字符串数组，而对于普通的单个字符串路径/URL，则自动用数组包裹，规避了由于 AI 混淆输入格式、把 string 传给 array 遍历而导致逐字符迭代寻找路径（如寻找名为 `[` 的文件）报错的问题。
- **视频参考图只接受公网 URL**: `videoGenerate` 不再把本地图片路径读取成 Base64 Data URL 提交给 Agnes 或火山视频接口。工具会在提交前拒绝本地路径和 `data:` URL，并提示使用 `imageGenerate` 返回的 `Remote URL`，避免供应商因无效 Base64 或不可访问本地路径返回 400。
- **回归测试补充**: 在 `videoGenerateTool.test.ts` 中新增了分别使用 JSON 字符串数组和普通单路径字符串作为 `images` 参数的两个测试用例，校验其运行时的标准化和路径解析能力。

### 视频生成参考图公网 URL 校验与轮询容错优化 (Video Generate Public URL Validation & Poller Fault Tolerance)
- **参考图公网 URL 前置校验**: 修复了远端视频生成服务（Agnes AI 和火山引擎）无法读取本机路径或 Base64 Data URL 而导致 400/500 报错的问题。当检测到 `images` 参数传入本地路径或 `data:` URL 时，工具会立刻拒绝并提示使用 `imageGenerate` 返回的 `Remote URL`，避免向云端 API 发送不可用图片引用。
- **本地路径提交拦截**: 如果传入的参考图不是 `http://` 或 `https://` 公网地址，工具会在提交供应商前直接返回明确错误，不再读取本地文件或构造 Base64。
- **后台轮询限制与错误规避**: 修复了由于 Agnes 返回的 `error` 报错以结构化对象形式存在而导致 SQLite 绑定入库崩溃的问题。优化后台轮询管理器和工具查询逻辑，在遭遇 4xx 终端 HTTP 错误或连续拉取失败 3 次时，自动在数据库中将任务标记为 `failed` 失败状态，防止无限重复循环拉取。
- **单元测试补充**: 新增针对远程图片 URL 透传、本地路径拒绝和 Base64/data URL 拒绝机制的独立单元测试，运行且测试完全通过。

### Telegram 流式长消息分片复用 (Telegram Streaming Long-Message Chunk Reuse)
- **复用已有分片消息**: Telegram answer lane 现在保存完整的分片消息 ID 列表；连续流式刷新会按分片位置编辑已有消息，只在分片数量增加时创建新消息，避免第二段在每次刷新时被重复发送。
- **清理多余分片**: 当后续答案内容缩短、所需分片数量减少时，runtime 会删除已经不再需要的尾部分片消息。
- **回归断言补充**: `formatting.test.ts` 覆盖连续分片刷新与分片数量减少，固定“编辑已有分片、不重复创建第二条”的行为。

### 异步视频查询 SQLite 预检优化 (Video Query Bypass Optimization)
- **避免重复调用三方 API**: 当 Agent 使用 `taskId` 重新查询视频生成状态时，`videoGenerate` 工具会优先检查本地 SQLite 数据库中的 `status` 记录。如果任务已由后台轮询服务更新为 `completed` 或 `failed`，工具将直接读取本地视频路径或错误信息并返回，避免因三方任务过期或连接波动产生 `fetch failed` 报错。
- **自动触发消息发送**: 即使任务是在后台被静默轮询下载完成的，一旦 Agent 在会话中触发查询，工具也会自动检测 `options.uploadFile` 存在并将本地已完成的视频文件发送给当前聊天通道，保证用户顺畅拿到生成结果。

### 工具运行进度文案压缩 (Compact Tool Progress Copy)
- **去掉重复状态前缀**: `toolProgress = "new"` 的单行运行态文案不再显示 `正在运行:`，从 `⏳ 正在运行: videoGenerate...` 压缩为 `⏳ videoGenerate...`，为真正有用的工具名留出更多可见空间。
- **回归校验补充**: 新增 `displayFormatter.test.ts`，固定 `new` 模式下的最小运行态输出格式，避免后续又把冗余前缀带回来。

### Telegram 视频消息原生支持与 MIME 识别优化 (Telegram Native Video Message Support & MIME Optimization)
- **修正视频文件被误判为音频的问题**: 修复了 MP4 容器在字节头检测时（包含 `ftyp` 签名）被错误归类为 `audio/mp4` 并通过 `sendAudio` 路径发送，从而在 Telegram 中显示为音频且无法正常播放的问题。
- **添加 detectVideoMime 探测器**: 在 `TelegramManager` 中实现 `detectVideoMime` 辅助方法，专门提取 `.mp4`、`.webm`、`.mov` 视频格式文件的 MIME 类型，并在 `detectAudioMime` 中排除这些后缀的视频文件。
- **原生 sendVideo 接口调用**: 完善 `uploadFile` 逻辑，在检测到视频 MIME 类型时，优先通过 `bot.api.sendVideo` 将视频原生发送给用户，如果失败则优雅降级为发送文档 (`sendDocument`)。
- **完善单元测试覆盖**: 在 `src/lib/server/channels/telegram/runtime.test.ts` 中新增针对音频与视频 MIME 类型（包括 MP4/M4A、WebM、MOV、OGG）的精准识别断言。

### 视频生成设置页新增 Task ID 展示 (Task ID Display on Video Settings Page)
- **展示任务唯一定义标识**: 在 `/settings/video` 设置页面的“最近生成任务”列表中，新增“任务 ID (Task ID)”展示列。
- **便携复制与完整可见**: 将 Task ID 以等宽字体（`font-mono`）展示，并配置 `select-all` 类名与 hover title，让管理员可以直接在界面完整查阅并快速选中/拷贝 Task ID，方便在聊天窗口手动查验生成进度或核实结果。

### 视频生成结果查看与测试隔离优化 (Video Generation Results Viewing & Test Isolation)
- **单元测试数据库隔离**: 重构了 `createVideoGenerateTool` 使其支持在 options 中接收自定义的 `taskStore`。在 `videoGenerateTool.test.ts` 单元测试中，为所有 `SqliteVideoTaskStore` 配置隔离的临时测试 SQLite 数据库文件（在 `mockCwd` 目录中），在测试结束后会自动删除，彻底避免测试执行向宿主正式的 settings 数据库文件添加 mock 测试任务数据。
- **新增视频流服务接口**: 新增后端 API 端点 `/api/settings/video-generate/video`，支持通过 `taskId` 从数据库读取对应任务的本地 `videoPath`，并在文件存在时以 `video/mp4` MIME 格式通过流式响应安全输出。
- **结果详情弹窗与内置播放器**: 在 `/settings/video` 的“最近生成任务”表格操作列中，为已完成（`completed`）和失败（`failed`）的任务新增了“查看结果 (View Result)”操作按钮。点击可弹出一个精美的模态框：
  - 对已完成的任务，弹窗内嵌 HTML5 `<video>` 原生播放器，支持直接在配置页面播放和查验生成的视频文件；
  - 汇总展示任务 ID、生成引擎、完整提示词、本地物理保存路径以及详细错误信息；
  - 弹窗底部提供一键下载生成的 `.mp4` 文件及关闭弹窗的按钮。

### 图像生成设置页优化 (Image Generation Settings Optimization)
- **多引擎 Model ID 自定义**: 优化内置 `imageGenerate` 工具及其控制台 `/settings/image`，为 Agnes, Google Imagen, Volcengine (Seedream) 和 ModelScope 图像引擎独立支持自定义 Model ID 输入，增强不同画风和模型版本的灵活扩展性。
- **极简启用逻辑 (基于 API Key)**: 移除了各个引擎配置中冗余的 `enabled` 显式复选框/开关。遵循“只要配置了非空 API Key 即视为启用”的清晰规则，简化配置负担并避免状态不同步问题。
- **完整中英本地化支持**: 重构了前端配置表单以完整支持双语 `zh-CN` / `en-US` 本地化显示及切换，适配明暗模式和响应式自适应布局。
- **全面单元测试对齐**: 更新了 `imageGenerateTool.test.ts` 以移除对各引擎显式启用参数的依赖，利用 Mock 校验模型自定义和多引擎按优先级自动路由（根据配置 key 的有无自动路由）。

## 2026-06-05

### 设置总览页重新设计 (Settings Overview Redesign)
- **控制中心仪表盘**: 将 `/settings` 总览页从 14 个扁平卡片重构为 4 个分组功能卡片（AI 智能、消息渠道、知识与数据、系统），匹配设计稿的 Dashboard 布局。
- **Lucide 图标集成**: 每个分组卡片使用语义化 Lucide 图标（Cpu、MessageSquare、BookOpen、Settings），引入 `@lucide/svelte` 在设置页面的首次直接使用。
- **衬线标题排版**: 页面标题采用 `var(--font-serif)` 衬线字体，营造设计稿中的编辑感排版风格。
- **子页面快捷导航**: 每张卡片底部列出所有子页面链接，hover 时显示 → 箭头动画，直接导航到对应设置页。
- **分组计数 Badge**: 每张卡片顶部显示 Shadcn Badge 标注模块/渠道/页面数量。
- **双语支持**: 所有文本完整支持 zh-CN 和 en-US，使用 `$locale` 响应式切换。
- **暗色模式适配**: 卡片背景通过 `color-mix()` 在暗色模式下自动调整透明度。

### 设置布局头部重新设计 (Settings Layout Header Redesign)
- **侧边栏品牌头部**: 将侧边栏顶部从"配置工作台 + 设置"大标题重构为品牌圆点 logo + 衬线字体"设置"标题 + 紧凑的"返回聊天"胶囊按钮，匹配设计稿的主侧边栏头部风格。
- **面包屑顶部栏**: 将顶部栏从"工作台标题 + 页面名"改为"设置 › [当前页面]"面包屑导航，右侧保留主题/语言选择器和"打开聊天"链接。
- **语义化 CSS 类**: 所有新增 UI 元素使用语义化 CSS 类名（`.settings-sidebar-header`、`.settings-topbar-breadcrumb` 等），遵循 DESIGN.md 的 CSS 类名规范。
- **移动端导航保留**: 移动端折叠导航（`<details>`）保持不变，样式统一更新。
- **清理未使用 i18n**: 移除 `workspaceTitle` 翻译键，不再使用。

### 设置导航菜单样式重做 (Settings Navigation Menu Restyle)
- **匹配设计稿 nav-item 样式**: 将导航链接从 `rounded-xl border text-xs` 卡片风格改为设计稿的 `rounded-[6px] text-sm` 无边框列表风格，padding 从 `px-3 py-2` 调整为 `px-3.5 py-2.5`。
- **活跃状态对齐**: 活跃链接改为 `accent-soft` 背景 + `accent` 文字色 + 内边框阴影（`inset box-shadow`），匹配设计稿的 `nav-icon.active` 样式。
- **分组标题更新**: 去掉 `uppercase tracking-[0.16em]`，改为正常的 12px 小写标题，带折叠箭头（▾ 替代 ▸），闭合时旋转 -90°。
- **语义化 CSS 类**: 导航样式全部迁移到 `<style>` 块中的语义化类名（`.settings-nav-link`、`.settings-nav-group-title` 等），移除 `navLinkClass()` 中的 Tailwind 内联。
- **移动端同步**: 移动端折叠导航复用同一 `navLinkClass` 函数，样式自动继承。

### 内置视频生成工具 (Built-In Video Generation Tool)
- **原生 Agent 层工具**: 新增内置 `videoGenerate` 工具，视频生成能力从 bash/Python 脚本技能提升为 runtime 原生能力。
- **多渠道 API 支持**: 支持 Agnes-Video-V2.0 和 火山引擎 (Doubao-Seedance-2.0)。
- **模型自定义支持**: 支持在设置里为每个供应商独立配置特定的模型 ID（如 `agnes-video-v2.0`、`doubao-seedance-2.0`），而不再硬编码，充分保证了模型的灵活选型。
- **沙箱与存储规范**: 工具生成的视频会自动存放到对应会话的 dated 归档目录 (`artifactDir`)，并应用严格的安全沙箱路径校验，禁止向受限目录写入。
- **直发通道**: 工具会自动将生成的视频通过 active channel 发送回聊天对话，无需 Agent 额外运行 `attach` 工具。
- **设置管理界面**: 新增 `/settings/video` 专属页面与 `/api/settings/video-generate/test` 接口，支持配置全局开关、默认引擎，按引擎启用状态、API 密钥、自定义模型 ID 与自定义基准 URL 存储，并支持在页面直接运行测试 Prompt 生成并渲染。
- **启动与设置兼容**: 旧版 settings 缺少 `videoGenerate` 字段时会自动回填默认配置；默认引擎会优先参与 auto 路由；设置页测试产物写入 Molibot 数据目录，避免污染项目源码目录。
- **语义路由优先级**: Agent 会对任意语言的视频生成意图做语义判断，并优先通过 `toolSearch select:videoGenerate` 加载内置工具；只有内置工具不可用或失败时才回退到 skill/bash。
- **非阻塞异步任务执行**: `videoGenerate` 视频生成支持完全非阻塞的异步任务执行。Agent 提交任务后即刻将任务记录持久化写入 SQLite，并向 Agent 返回 taskId，直接释放当前对话回合。
- **后台轮询与状态同步**: 前端设置页面 `/settings/video` 以 30 秒间隔运行后台轮询，查询处于 processing 状态的任务，自动更新 SQLite 数据库中的任务状态，完成时自动下载并保存视频文件。
- **详细的请求与响应日志**: 在服务端查询第三方视频生成接口的状态时，会打印带有 `[Video Task Poller]` 标识的详细 HTTP 请求与响应日志，包含请求 URL、请求 Payload 以及完整的响应 Body（限前 500 字节），方便管理员随时核对调用细节与排障。
- **回归测试与编译校验**: `videoGenerateTool.test.ts` 完整覆盖了异步任务的提交、SQLite 读写、状态轮询与下载处理。项目在 TypeScript + SvelteKit 生产构建下完美编译通过。

### 飞书审批卡片终态稳定 (Feishu Approval Card Terminal State)
- **原卡片编辑为终态**: 审批完成后原地把带按钮卡片更新成“审批已处理”结果卡片，不再依赖有时间限制的消息撤回；编辑失败时才发送文本结果。
- **审批动作幂等**: HTTP 与 WebSocket 同时收到同一审批点击、或用户重复点击时，按 `requestId` 只执行一次审批，并复用同一张无按钮终态卡片。
- **明确终态展示**: 结果卡片标题改为“审批已处理”，并移除全部 action 按钮，不再继续显示“需要你的确认”。
- **三秒内快速回调**: 点击后立即返回无按钮的“审批处理中”卡片，后台完成审批执行后再原地编辑为“审批已处理”，避免飞书长连接回调超时重推旧卡片。
- **会话忙时持续恢复**: 共享审批自动恢复最长等待从约 5 秒延长到 1 小时；当前会话仍在运行时继续后台等待，不再很快提示用户发送任意消息继续。
- **工具结果由 Agent 汇总**: 审批后的 Bash stdout/stderr 只回填到原工具调用上下文，不再直接发送到聊天；“命令执行成功，正在恢复”也不再作为独立消息打扰用户。
- **回归测试补充**: `runtime.test.ts` 覆盖并发重复回调只执行一次及后续重复动作复用首次结果；`messaging.test.ts` 固定终态卡片标题与无按钮结构。

### Bash Stop 可靠收尾 (Reliable Bash Stop Finalization)
- **取消即终止本轮**: `/stop` 触发 bash/Agent abort 后，Runner 将 `aborted` 作为不可重试的终止结果，不再误判为空响应并自动重试或切换备用模型。
- **状态及时释放**: abort 后跳过可能阻塞的 UI 更新队列等待并清除待发送进度，确保 bash 已被 kill 后会话状态能从“运行中”回到空闲。
- **部分输出保留**: 停止前已经产生的 assistant 文本仍可保留展示，但不会被改写成普通运行错误。
- **回归测试补充**: `runnerRetryState.test.ts` 固定 aborted 不得进入 empty-response retry 的行为。

### 精简审批确认文案 (Concise Approval Confirmation Copy)
- **只展示决策所需信息**: Host Bash 审批提示统一收敛为“需要确认、操作、完整命令、批准/本轮允许/拒绝”结构，不再向聊天用户展示 request ID、Tool ID、分类器、权限明细和内部原因。
- **完整命令优先**: 审批提示优先展示真正待执行的原始完整命令，避免只显示 executable 后还要用户自行拼接参数。
- **跨渠道共享**: Telegram / 飞书审批卡片与 QQ / 微信纯文本审批复用同一个共享审批 prompt；纯文本渠道使用简短中文回复指引，审批动作与权限边界保持不变。
- **回归测试补充**: 新增 `hostBash/approval.test.ts`，固定长期审批、单次审批和非交互文本的最小信息结构。

### 全局命令响应多语言 (Global Command Response i18n)
- **运行时语言配置**: Settings 语言选择现在会写入全局 `RuntimeSettings.locale`，不再只保存在当前浏览器。
- **共享命令双语响应**: Telegram、飞书、QQ、微信复用的 Agent 命令层会按全局语言返回 `/help`、`/status`、模型、技能、会话、队列、运行控制、沙盒与显示控制等固定响应。
- **Web Chat 对齐**: Web Chat 本地命令读取同一运行时语言配置，避免网页命令与其他渠道语言不一致。
- **Help 命令精简**: `/help` 不再展示 `/login` 与 `/logout` OAuth 管理命令；命令本身继续可用。

## 2026-06-04

### 内置图片生成工具 (Built-In Image Generation Tool)
- **原生 Agent 层工具**: 新增内置 `imageGenerate` 工具，图片生成能力从 shell 脚本技能提升为 runtime 原生能力。
- **多渠道 API 支持**: 支持 Agnes-Image-2.0-Flash、Google Imagen、火山引擎 (Seedream) 和 ModelScope。
- **沙箱与存储规范**: 工具生成的图片会自动存放到对应会话的 dated 归档目录 (`artifactDir`)，并应用严格的安全沙箱路径校验，禁止向受限目录写入。
- **直发通道**: 工具会自动将生成的图片通过 active channel 发送回聊天对话，无需 Agent 额外运行 `attach` 工具。
- **设置管理界面**: 新增 `/settings/image` 专属页面与 `/api/settings/image-generate/test` 接口，支持配置全局开关、默认引擎，按引擎启用状态、API 密钥与自定义基准 URL 存储，并支持在页面直接运行测试 Prompt 生成并渲染。
- **启动与设置兼容**: 旧版 settings 缺少 `imageGenerate` 字段时会自动回填默认配置；默认引擎会优先参与 auto 路由；设置页测试产物写入 Molibot 数据目录，避免污染项目源码目录。
- **默认引擎兼容**: 当默认图片引擎已经配置 API key 时，即使旧配置残留该引擎 `enabled: false` 也会自动视为可用；`/settings/image` 页面明确展示每个引擎的启用开关。
- **语义路由优先级**: Agent 会对任意语言的图片生成/编辑意图做语义判断，并优先通过 `toolSearch select:imageGenerate` 加载内置工具；只有内置工具不可用或失败时才回退到 skill/bash。
- **回归测试补充**: 新增 `imageGenerateTool.test.ts`，利用 fetch mock 覆盖 Agnes 尺寸与 seed 参数校验、Google base64 解码、火山引擎下载和 ModelScope 异步轮询任务执行。

### Host Bash 分类器 URL/Helper 修复 (Host Bash URL and Helper Classification Fix)
- **Quoted URL 不再误判 glob**: Host Bash 分类器现在只把未引用、未转义的 `*` / `?` / `[` 视为 glob 风险，`agent-browser open "https://example.com/search?q=..."` 这类带 query string 的已引用 URL 会正确归约到 `agent-browser` capability。
- **受限 wrapper 归约**: `cd /tmp && agent-browser ... && echo DONE` 这类静态工作目录切换和输出标记会作为 safe helper 处理，避免已批准 `agent-browser` 因安全 shell 包装再次触发 one-time 审批；动态 `cd "$HOME"` 仍退化为 one-time。
- **回归断言补充**: `commandClassifier.test.ts` 增加 quoted URL、未引用 glob、受限 `cd` / `echo` wrapper、动态 `cd` 降级测试，固定审批降噪边界。

### Telegram 超长编辑统一分片能力 (Telegram Unified Overlong Edit Chunking)
- **统一发送/编辑分片 helper**: `src/lib/server/channels/telegram/formatting.ts` 现在把 Telegram 文本分片、grammY rich message 发送、plain text fallback 收口到共享 helper，避免 `sendMessage` 和 `editMessageText` 分别维护近似但漂移的逻辑。
- **超长编辑自动续发**: 当 Telegram 对 `editMessageText` 返回 `400: Bad Request: MESSAGE_TOO_LONG` 时，runtime 不再直接失败中断；现在会保留原消息作为第一段并自动补发后续分片消息。
- **Thread 上下文透传**: Telegram runtime 在状态消息、主答案、思考消息和运行详情消息的编辑路径中，都会把既有的 `message_thread_id` / 发送选项透传给超长续发逻辑，避免 forum topic 场景把后续分片发回主聊天。
- **回归断言补充**: `formatting.test.ts` 新增针对 plain text 和 rich message 路径的超长编辑拆分断言，固定“首条编辑 + 后续补发”的行为。

### System Prompt Boundary Refactor (P0 + Sandbox Slice)
- **P0 去重落地**: `src/lib/server/agent/prompts/prompt.ts` 已压缩 `Events`、`ToolSearch` 和 `Tools` 三个区块，移除重复的 `createEvent` 细节、`<functions>` 返回格式教学，以及冗长的 Tool Priority Table，保留最小但足够的路由规则。
- **P1.2 Core Directives 合并**: 原本分散在 `Execution Discipline`、`Freshness`、`External Content Safety`、`Action Confirmation`、`Runtime Safety & Truthfulness`、`Failure Recovery` 的全局防御性规则，现已合并为单一 `Core Directives` section，并把 `Processed Inputs` 一并收口到同一区块。
- **Sandbox 边界收口**: 系统提示词中的 sandbox 文本已从实现细节改为决策边界，只保留“普通 shell 工作可走 bash”“不要绕过 sandbox”“需要 host-only 能力时走 `bash.hostApproval`”这类模型决策规则，不再在全局提示词里展开实现名、文件系统/网络细节或共享 venv 路径。
- **`bash` 工具描述对齐**: `src/lib/server/agent/tools/bash.ts` 的工具描述与 `hostApproval.reason` 参数说明同步收短，明确其职责是受控 host-only 访问说明，而不是让系统提示词承担具体 runtime 教学。
- **回归断言补充**: `prompt.test.ts` 与 `bash-output.test.ts` 新增断言，固定这轮去重结果，防止后续把 `<functions>` 细节、Tool Priority Table 或 `sandbox-exec` / `bubblewrap` 这类实现描述重新塞回系统提示词。

## 2026-06-03

### Deferred Web Search 去重 (Deferred Web Search Deduplication)
- **`webSearch` 改成 deferred-only 暴露**: `src/lib/server/agent/tools/index.ts` 里保留 `webSearch` 的 deferred registry 条目，但显式设置 `exposeStub: false`，不再把它作为顶层 lightweight stub 放进模型工具列表。
- **修复 provider 400 重名错误**: `toolSearch` 加载 `webSearch` 后，不会再和顶层同名 stub 同时出现在 `tools` 请求参数里，避免 `tools contains duplicate names: webSearch`。
- **回归断言补充**: `index.test.ts` 新增断言，固定 `webSearch` 的 deferred-only 暴露方式。

### Deferred Tool Registry 对齐 (Deferred Tool Registry Alignment)
- **deferredEntries 补齐 webSearch**: `src/lib/server/agent/tools/index.ts` 现在把 `webSearch` 加入 deferred tool registry，与 prompt 里的 `<available-deferred-tools>` 保持一致，避免提示词宣称可延迟加载但 runtime 注册表缺项。
- **提示词回归断言**: `prompt.test.ts` 补充断言，确保 `<available-deferred-tools>` 区块继续显式包含 `webSearch`。

### 共享 Python 工具环境收敛 (Shared Python Tooling Runtime)
- **统一 Python 工具目录**: Agent `bash` 运行时默认使用 `~/.molibot/tooling/python/venv` 作为共享虚拟环境，替代旧的 `~/.molibot/tooling/sandbox-venv`，避免 skill 目录各自生成 `.venv` 后残留机器绝对路径。
- **缓存和临时文件归位**: `wrapCommandWithVenv()` 现在统一导出 `PIP_CACHE_DIR`、`UV_CACHE_DIR`、`TMPDIR`、`TEMP`、`TMP` 到 `~/.molibot/tooling/python/{pip-cache,uv-cache,tmp}`，并设置 `PYTHONNOUSERSITE=1`，让 pip/uv/临时构建文件留在 Molibot tooling 目录。
- **沙箱写入范围对齐**: OS sandbox 的写入 allowlist 同步包含 Python tooling 根目录，避免 pip/uv 在 cache/tmp 目录写入时触发 `Operation not permitted`。
- **onlinestool 使用共享环境**: `~/.molibot/skills/onlinestool/scripts/run_update.sh` 现在自定位到 skill 根目录，并优先使用 runtime 注入的 `VIRTUAL_ENV` 或 `~/.molibot/tooling/python/venv`，不再创建 skill 私有 `.venv`。
- **回归测试补充**: 新增 `helpers.test.ts` 覆盖默认 Python tooling 路径、`MOLIBOT_TOOLING_DIR` / `MOLIBOT_VENV_DIR` 覆盖语义，以及 pip/uv/tmp 环境变量注入。

### Web Search 查询稳健性修复 (Web Search Query Robustness)
- **搜索关键词不再被时间前缀污染**: `runWebSearch()` 现在把用户的简洁 query 直接交给 provider，不再统一拼接 `Current date/time ... User query ...`，避免“最新黄金价格”这类实时查询因为当天日期关键词过窄而搜不到可用结果。
- **弱模型工具参数容错**: `webSearch` 会清理 `route` / `engine` 参数中常见的换行和嵌套引号形态，例如 `\n"auto"\n`，避免连续工具校验失败卡住搜索轮次。
- **中文路线优先网页引用**: `china` 路由优先尝试 `baidu_web`，再降级到 `baidu_fast` / `baidu` 等摘要型搜索，降低 provider AI 摘要无引用或幻觉时被直接放大的风险。
- **提示词边界收紧**: `webSearch` 工具说明保留当前年份提醒，但明确不要机械添加当天完整日期；系统工具表述从 `time-aware queries` 调整为 `date-aware guidance`。
- **回归测试补充**: 更新 `webSearchTool.test.ts` 和 `router.test.ts`，覆盖简洁 provider query、弱参数容错和中文路由顺序。

## 2026-06-02

### Host Bash 复合命令能力分类 (Host Bash Compound Command Classification)
- **复合命令分类器**: 新增 `src/lib/server/hostBash/commandClassifier.ts`，对受限 shell 语法做保守解析，把命令分成 `persistent-capability`、`compound-capabilities` 和 `one-time-script`，并显式记录 safe glue（如 `|`、`2>&1`、`&&`）与 safe helper（如 `head -30`、`sleep 3`）。
- **审批降噪**: `longbridge news FIG.US 2>&1 | head -30`、`agent-browser ... && sleep 3 && agent-browser ...` 这类“同一真实能力 + 安全修饰”的命令，不再一律退化成一次性审批；未批准时会优先请求对应 capability 的长期 Host Bash 审批。
- **运行时命中增强**: 已批准的 Host Bash capability 现在可以命中带 safe helper / safe glue 的复合命令，并直接走 Host Bash 执行，不再因为简单管道或 sleep 链而重新进 sandbox 或重新发审批。
- **审计可解释性**: 新审批记录会在 `action_json` 中持久化 classification 元数据；`/settings/host-bash` 的 Pending / History 表格会展示 capability、safe helper / glue 或 one-time reason，方便运维判断为何是长期审批还是一次性审批。
- **回归测试补充**: 新增 `commandClassifier.test.ts`，并扩展 `bash-output.test.ts` 覆盖 approved pipeline、same-tool chain、safe helper 命中与 compound one-time 退化路径。

## 2026-06-01

### Host Bash 审批自动恢复避免 session 锁 panic (Host Bash Auto-Resume Session-Lock Recovery)
- **共享恢复重试**: `baseRuntime.ts` 的批准后自动恢复流程现在会在旧 turn 尚未完全释放 session 锁时做短暂重试，而不是让 `prepareTurn()` 的并发锁异常直接变成未处理 rejection。
- **服务稳定性修复**: Telegram 点按 `approve-session` / `approve` 后，即便撞到 `Another run is currently active in this session.` 的释放窗口，也不会再触发进程异常退出。
- **可见降级提示**: 若短重试后会话仍持续忙碌，runtime 会给用户发送“命令已执行，但会话仍忙碌”的继续提示，避免自动恢复静默卡住。
- **回归测试补充**: 新增 `approvalAutoResume.test.ts`，覆盖 turn 锁冲突重试与非锁错误直接终止两条路径。

### 内置网页搜索工具 (Built-In Web Search Tool)
- **共享 Agent 层工具**: 新增内置 `webSearch` 工具，搜索能力从 skill 文档/脚本提升为 runtime 原生能力，Web、Telegram、Feishu、QQ、Weixin 等渠道共享同一套工具注册、结果结构和诊断信息。
- **多引擎配置**: `RuntimeSettings.webSearch` 支持 DuckDuckGo、Brave、Tavily、Exa、Serper、Baidu Qianfan、Bocha。DuckDuckGo 默认开箱即用；其他引擎按 API Key 配置后参与路由。
- **与本地 web-search skill 对齐**: 额外补齐 `baidu_fast`、`baidu_web`、`ark`、`grok` 四个原本只存在于 `~/.molibot/skills/web-search/scripts` 的引擎入口，统一纳入 runtime 设置、默认 base URL、路由顺序与 provider 执行链路。
- **路由与降级**: 搜索路由收敛为 `china`、`global`、`official_docs`、`research` 四类目标导向 fallback，不再把“中文 + 最新/新闻”粗暴等同于国内新闻；当前引擎失败、无结果或缺少 Key 时按配置顺序降级到下一个可用引擎。
- **自动引擎选择策略**: `Default engine = auto` 时支持 `priority`、`random`、`round_robin` 三种策略；随机与轮询只会在已启用且已配置 API Key 的付费/账号引擎之间选择（DuckDuckGo 作为无需 Key 的例外），便于分摊额度或绕开单个 Key 余额不足。
- **测试请求诊断**: `/settings/search` 的 Test Query 结果现在展示每次 provider attempt 的脱敏请求诊断，包含 method、实际 URL、脱敏 headers 和请求 body，方便核对 Tavily/Brave/DuckDuckGo 等实际调用路径。
- **设置页管理**: 新增 `/settings/search`，可配置工具总开关、默认 route/engine、最大结果数、超时/重试超时、各引擎启用状态、API Key、自定义 Base URL，并支持使用当前表单值发起测试查询。
- **默认地址可见**: 搜索设置页现在直接展示 Brave、Tavily、Exa、Serper、Baidu、Bocha 在 `baseUrl` 留空时的真实默认地址，并与运行时 provider 共享同一份常量，避免 UI 文案和实际回退目标漂移。
- **工具提示词优化**: `webSearch` 工具描述现在明确要求最终答案附带 `Sources:` 区块，近期/最新查询使用当前年份，并优先交给自动 route/engine 分流，除非用户指定来源或区域。
- **回归测试补充**: 新增搜索路由和 `webSearch` 工具结果归一化测试，并将 `webSearch` 分类为会访问外部网络的中风险内置工具。
- **来源证据包**: `webSearch` 结果现在包含 `citations`、`metadata` 与每条 result 的 `citationId`，Agent 可以稳定把最终回答引用到真实 URL，而不是只依赖临时拼接的结果列表。
- **Provider 元数据归一化**: Brave、Tavily、Baidu Fast/Baidu Web、Bocha 等 provider 会尽量保留 request id、站点名、favicon、发布时间、provider 原始引用 id 和 usage/credits，排障信息继续保持密钥脱敏。
- **百度 Fast answer 保留**: 当百度 `web_summary` 同时返回综合 answer 与 references 时，工具会保留 provider answer 作为摘要，并将 references 标准化为可引用来源。
- **测试面板结果对齐真实响应**: `/settings/search` 的 Test Query 现在支持显式选择搜索引擎，并直接展示 `runWebSearch()` 返回的完整 `WebSearchResponse` JSON，避免页面再拼一层简化结果导致调试视图与模型实际看到的 payload 不一致。
- **Ark 从搜索设置页隐藏**: `ark` provider 仍保留在共享 runtime 类型和 provider 链路中，但设置页不再展示或允许作为默认引擎选择，避免在当前产品面上继续暴露这个实验性入口。
- **搜索请求自动注入当前时间**: `runWebSearch()` 现在会为每次 provider 请求生成带 `Current date/time` 与用户原始问题的内部查询文本，提升“明天天气”“最新价格”“今天新闻”等相对时间查询的时效性；返回的 `WebSearchResponse.query` 仍保留用户原始输入，方便会话展示与诊断对齐。
- **Prompt 工具优先级对齐**: 系统提示词的 Tools Priority Table 现在明确要求当前网页信息查询使用 `webSearch`，而不是通过 `bash curl`、浏览器搜索或旧 skill 脚本绕行；Tool Parameters 中也补充了 `webSearch` 参数签名。

### Feishu 本地审批按钮长连接回调 (Feishu Local Approval Buttons via WebSocket)
- **卡片按钮不再依赖公网 HTTP 回调**: Feishu runtime 现在通过现有 `WSClient` 的 `card.action.trigger` 事件接收审批卡片点击，本地机器启动且端口未暴露时也能处理 Host Bash 审批按钮。
- **审批逻辑复用**: 长连接卡片事件复用原有 Host Bash approve / approve-session / reject 共享命令路径；若按钮对应的是通用工具审批记录，会用同一个 `requestId` 回落到通用审批 Broker 继续处理。HTTP `/api/feishu/card` 回调入口保留，公网部署仍可继续使用。
- **自然中文审批口令**: 共享命令层现在支持 `审批通过`、`通过`、`批准通过`、`审批拒绝` 等常见中文回复，避免用户回复审批结论时被当作普通消息排队。
- **结果卡片更新与降级提示**: WebSocket 卡片事件处理完成后会主动编辑原审批卡片为结果态；如果原消息编辑失败，则发送一条普通文本结果提示。
- **按钮回调可观测性**: 收到飞书按钮点击时记录 `card_action_received`，便于区分飞书控制台未投递回调和运行时解析失败。
- **回归测试补充**: 新增 Feishu card action payload 解析测试，覆盖 `card.action.trigger` 的 chat/message/operator/action 字段归一化。

### Molibot 本机持续后台运行 (Local LaunchAgent Runtime)
- **LaunchAgent 配置**: 新增 `launchd/com.gusi.molibot.dev.plist`，可安装到用户 `LaunchAgents` 后由 macOS 管理本地 Molibot dev 服务。
- **自动拉起**: 配置 `RunAtLoad` 与 `KeepAlive`，避免普通前台 `molibot` 进程因终端/PTY 会话结束而停止。
- **独立日志**: 标准输出和错误分别写入本机 `molibot-launchd` 日志文件，方便排查启动与运行状态。

## 2026-05-31

### 定时任务执行 Lease、超时中止与重试 (Scheduled Event Lease, Timeout Abort, and Retry)
- **共享执行 Lease**: 新增 SQLite-backed `event_execution_leases` 运行态表，将 watched event 的“当前是否正在执行、属于哪个 run、尝试次数、超时与重试状态”从事件 JSON 文件锁提升为共享 runtime 协调状态。
- **10 分钟默认超时与 3 次上限**: `RuntimeSettings.events` 新增 `executionTimeoutMs`、`maxAttempts`、`retryDelayMs`，默认分别为 10 分钟、3 次、5 秒，并支持通过 settings/env 配置。
- **超时先中止再重试**: `EventsWatcher` 现在为事件执行包裹 watchdog；超时后调用共享 channel runtime 的 abort 路径，中止 runner / stale running turn，再按 lease retry budget 触发下一次尝试。
- **超时后成功收尾不再补发重复 attempt**: 如果首个 attempt 虽然超过 nominal timeout，但最终自己成功完成，`EventsWatcher` 现在直接按成功收口，不会再把同一 cron 槽位补发成第二次重复执行。
- **启动恢复**: watcher 启动时会扫描并恢复超时的 `running` lease，将其转换到 retry/final failed 路径，避免进程重启后旧 lease 永久阻塞同一事件槽位。
- **恢复镜像对齐**: watcher 启动恢复后会重新接管 `retry_wait` lease，并把 failed/aborted/completed lease 同步回事件 JSON 镜像，避免文件仍停在 `running` 状态导致跳过或误判。
- **`/stop` 识别事件 Lease**: 共享 `BaseChannelRuntime` 的停止逻辑现在会同步查询并终止当前 chat 的 active event lease，避免只有 runner 内存状态丢失时误报 `Nothing running.`。
- **跨 Bot Lease 隔离**: lease 唯一键新增 channel/bot 作用域，避免不同渠道或不同 bot 中同名事件文件、同 chatId、同 slot 相互阻塞。
- **重试并发防护**: timeout 分支会等待旧 runner 释放后才进入下一次 attempt；若 `/stop` 已经终止 lease，后续 runner 返回不会再把事件覆盖成完成态。
- **跨渠道 runId 对齐**: Telegram、Feishu、QQ、Weixin 的事件触发路径现在使用 lease 分配的 `runId`，使 runs 表、lease 表和事件 JSON 镜像能对齐同一轮事件执行。
- **回归测试补充**: 新增 `eventsLeaseStore.test.ts` 覆盖同槽位单 active lease、timeout 进入 retry、重试次数耗尽、手动 stop 抑制 retry、启动恢复 stale running lease。

### Sandbox 关闭时 Host Bash 免审批 (Host Bash Full Access When Sandbox Is Off)
- **权限语义修正**: 有效 `/sandbox off` 现在表示当前作用域进入 Host Bash full access。普通 `bash` 以及模型附带的 `hostApproval` 参数都会直接在宿主执行，不再额外创建 Host Bash 审批。
- **Sandbox-on 审批保持不变**: 当 sandbox 有效开启时，普通 `bash` 仍优先进入 OS sandbox；显式 Host Bash 请求和 sandbox 权限失败仍会走原有审批与自动恢复流程。
- **重复审批防护**: 命中已批准 Host Bash 白名单的命令会直接走 `executeApprovedHostBash`，不会重新进入 sandbox shell，也不会触发二次审批。
- **回归测试补充**: 新增策略层测试覆盖 sandbox on/off 与 `hostApproval` 参数组合；补充 bash 输出测试覆盖 sandbox disabled 免审批直跑和 approved Host Bash 不调用 sandbox shell。

### 独立思考消息与最新进度模式 (Separate Reasoning Messages & Latest Progress Mode)
- **`/showreasoning new` 模式**: `showReasoning` 配置扩展为 `off/on/stream/new`，聊天命令、Settings → System 下拉选项、settings schema/sanitize/store 均接受并保留 `new`。
- **思考与答案分离**: `DisplayFormatter` 新增独立的答案与 reasoning 渲染方法。Telegram 与 Feishu 不再把 reasoning 拼进最终答案消息，避免打开思考后需要先翻过大段 reasoning 才能看到正文。
- **Telegram 实时展示优化**: Telegram 运行时新增独立 `reasoningMessageId`。`thinking_delta` 只刷新独立思考消息，`text_delta` 只刷新答案消息；`new` 模式运行中只显示最近一句思考，结束后删除临时思考进度消息。
- **Feishu 流式会话适配**: Feishu CardKit 答案卡片保持原有流式输出，reasoning 改为独立可编辑文本消息；`new` 模式结束时将临时思考消息收尾为“思考完成”。
- **回归测试补充**: `FeishuStreamingSession` 新增 reasoning 独立消息测试，覆盖思考内容不创建空答案卡片的路径。

### 主答案生命周期与跨渠道展示冻结 (Main Answer Lifecycle & Display Commit)
- **Runner 主答案提交语义**: 在共享 `MomContext` 中新增可选 `commitMainAnswer` 与 `sendSupplement` 语义。Runner 会按模型返回的 terminal assistant 消息边界展示内容：一条返回一条，多条则第一条作为主答案、后续条作为补充消息，不再用最后一条覆盖前面的完整答案。
- **共享文本渠道冻结逻辑**: `buildTextChannelContext` 增加 `draft/committed` 主答案阶段。Weixin / QQ 等不支持编辑的渠道在 draft 阶段仍可通过 buffer 替换草稿，但 committed 后的后续文本会作为补充发送，不会从 `messagesBuffer` 中删除已提交主答案。
- **Telegram / Feishu 对齐**: Telegram 手写 context 与 Feishu 卡片流式会话接入同样的提交语义。主答案 committed 后，后续 assistant 文本或续写结果改为补充消息/详情，不再编辑覆盖原主答案。
- **回归测试补充**: 为 shared context 增加 committed 后 replacement 转补充的单元测试，覆盖不支持编辑渠道最容易丢失主答案的路径。

## 2026-05-30

### 微信通道底层 SDK 升级与上下文 Token 持久化 (Weixin SDK Upstream Upgrade & Context Token Persistence)
- **底层 SDK 协议同步与升级**: 同步了本地 `package/weixin-agent-sdk` 至最新的 `openclaw-weixin` upstream 版本（版本号升至 `0.3.1`），移除了所有 OpenClaw 专属插件 Hook (如 `channel.ts` 等) 以保持 SDK 的独立性。
- **上下文 Token 磁盘持久化**: 在 `package/weixin-agent-sdk/src/messaging/inbound.ts` 中实现了上下文 Token 磁盘持久化机制 (`persistContextTokens`, `restoreContextTokens`)。当 Weixin 轮询到新消息时，其对应的 `context_token` 会自动保存至 `{accountId}.context-tokens.json` 文件中，系统重启后会自动重新载入内存，彻底解决了服务器重启时丢失上下文 Token 导致无法主动回复消息的问题。
- **WeChat 账号清理行为增强**: 在 `clearWeixinAccount` 中增加了同步清理对应的 `.sync.json` 和 `.context-tokens.json` 文件的逻辑，确保敏感凭证与缓存数据能够被物理清除。
- **长轮询中止链路补齐**: 在 `package/weixin-agent-sdk/src/api/api.ts` 中补齐了 `combineAbortSignals` 合并逻辑，并让 `getUpdates` 走支持外部 `AbortSignal` 的 `apiPostFetch`。这样 Weixin 长轮询在停止、热重载或运行时切换时可以立即中断，不再依赖超时自然返回。
- **SvelteKit 运行期无缝对接与自愈**:
  - 重写了 `src/lib/server/channels/weixin/client.ts`，在 Weixin 客户端启动与重连加载凭证时，自动调用 `restoreContextTokens` 载入历史 Token 缓存，并将 `getContextToken`/`setContextToken` 进行双向桥接，使 Svelte 运行期的所有发送与打字提示消息均获得持久化 Token 保护。
  - 针对扫码登录返回的 `binded_redirect` 重定向状态，实现了 `alreadyConnected` 状态捕获与自愈处理。如果用户扫描了已连接的机器人二维码，不会再抛出登录失败异常，而是自动解析加载已存的本地 credentials 并恢复正常服务。
- **去除过时的 Markdown 过滤规则**: 鉴于微信对 Markdown 的支持已趋于完善，移除或将 `filterWeixinMarkdown` 逻辑弱化为无操作（no-op）的透明管道，并在单元测试中更新回归校验，彻底避免因旧版 SDK 移除 Markdown 特性导致的 import 错误及格式破坏。

### 浏览器自动化超时可配置 (Browser Automation Timeout Configuration)
- **Settings 页面配置**: 在 Settings → System 页面新增「浏览器自动化」配置卡片，支持通过 Web UI 直接调整 `agent-browser` (Playwright) 的默认超时时间（毫秒），无需修改 `.env` 或重启服务。
- **全局显示、思考过程及沙盒安全可视化配置**: 
  - **显示与思考设置**: 在 Settings → System 页面新增「显示与思考设置」配置卡片，支持直接通过 Web UI 调整模型思考过程显示模式 (`showReasoning`)、工具执行进度展示详细度 (`toolProgress`) 及网关通知发送间隔 (`gatewayNotifyInterval`)，避免手动注入参数。
  - **工具沙盒安全限制**: 新增「工具沙盒安全限制」配置卡片，支持可视化一键开关全局 Bash 命令沙盒隔离 (`toolSandbox.enabled`)，并包含直达沙盒详细规则配置页面的链接，极大地提升了系统的安全易用性。
- **Schema 与持久化**: 在 `RuntimeSettings` 中新增 `browserAutomation: { defaultTimeoutMs }` 字段，配合完整的 sanitize、store 序列化/反序列化链路，确保配置修改即时生效且重启后持久保留。
- **环境变量自动注入**: `hostBashExec.ts` 的 `buildHostEnv` 自动将配置值注入为 `AGENT_BROWSER_DEFAULT_TIMEOUT` 环境变量，所有通过 Host Bash 执行的 `agent-browser` 命令自动继承。
- **默认值调整**: 默认超时从 25s 提升至 60s，解决了 feishu.cn 等加载较慢网站的超时问题。范围约束 5s~300s。
- **统一的渲染格式化层 (Unified DisplayFormatter)**: 实现了 [displayFormatter.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/displayFormatter.ts) 作为共享逻辑层。统一捕获 `thinking_start/delta/end`、工具调用与子智能体执行事件，规范化输出适用于各个渠道的 Markdown 排版，使得展示逻辑完全与 Channel 消息收发解耦，严格遵守 `AGENTS.md` 的规范边界。
- **展示设置持久化与校验逻辑**: 扩展了 `schema.ts`、`defaults.ts` 与 `sanitize.ts`，为 `RuntimeSettings` 及各渠道实例的 `ChannelInstanceSettings` 新增了 `display` 配置（包含 `toolProgress`、`showReasoning`、`gatewayNotifyInterval`）。升级了 sanitizer，打通了 SQLite `settings_channel_instances` 表中的 `display_json` 字段及 `settings.json` 中的全局 `display` 属性的持久化存储、动态读取与自动迁移，保证指令 `/toolprogress` 及 `/showreasoning` 的修改状态在系统重启后能够被持久保留。同时将展示配置指令与 `/sandbox` 多级控制指令统一整理编写为指南文档 [session-control-commands.md](docs/guides/session-control/session-control-commands.md)。
- **独立会话指令控制 (/toolprogress & /showreasoning)**: 在 [channelCommands.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/commands/channelCommands.ts) 中增加了 `/toolprogress` 与 `/showreasoning` 两个独立的聊天命令。仅修改并写回当前渠道的 Bot 实例设置，实现了精细化的 Bot (Channel Instance) 维度控制，各个平台/Bot 互不干扰。
- **多渠道渲染适配与进度拦截**:
  - **Telegram**: 重构了 Telegram 的消息发送与编辑管道，全面接入 `DisplayFormatter`；若 `toolProgress === 'off'`，则彻底跳过状态消息的生成与编辑。修复了在 `"new"` 进度显示级别下，最后一条临时状态（如 `⏳ 正在运行: bash...`）在智能体执行完成后仍残留于界面的 bug。现已支持在运行终期自动将其物理删除。
  - **Feishu**: 重构了 `FeishuStreamingSession` 与 `FeishuManager`，根据 `displayConfig` 动态渲染飞书流式交互卡片的工具进度及状态，当设为 `off` 时隐藏工具历史元素。
  - **QQ & Weixin (防刷屏气泡缓冲合并)**: 重构了 QQ 与微信的 `processEvent` 函数，分别获取当前实例的 `displayConfig`。当 `toolProgress === 'off'` 时跳过进度消息。同时，引入了 `messagesBuffer` 缓冲区，将工具进度日志、运行归档提示、错误信息及中间 streaming 结果在运行期间于内存中聚合，直至运行彻底结束、触发敏感授权（如 Host Bash 审批）或上传文件时才一次性拼接并通过单个气泡发出，彻底杜绝了这两个平台由于不支持消息编辑而产生多个消息气泡的刷屏缺陷。
- **`/help` 帮助指令丰富**: 在 [channelCommands.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/commands/channelCommands.ts) 的 `helpText` 帮助信息中，补充了包含会话（Session）、机器人实例（Bot）和智能体（Agent）多层覆盖的 `/sandbox` 开关指令及 `/toolprogress`、`/showreasoning` 展示指令的使用说明，方便用户随时查阅。
- **审批自愈流式自动恢复优化**: 移除了 Telegram 和 Feishu 渠道对 `executeApprovedHostBash` 的冗余重写，恢复复用 `baseRuntime.ts` 默认提供的审批自动唤醒流程。扩展了 `isSessionApprovalText` 会话批准正则，支持包括“允许本轮”、“本轮允许”、“本会话允许”等自然中文，并在自愈完成后添加了状态提示消息。
- **修复主机工具审批 Scope 冲突导致的卡顿缺陷**: 修复了由 `ToolRuntime`（对于插件/MCP工具）写入数据库的 `run_id` (实际为 UUID) 与 Channel 审批指令解析查询的 `scopeId` (实际为 chatId) 不匹配，导致审批时报错 `No matching pending Host Bash approval found.` 且执行流程卡死的 bug。`HostBashStore` 现支持 `sessionId` 级联 fallback 检索，全渠道及 Web 端审批完美打通。

### 智能体优化：审批深度传播与安全认证边界记录 (Review Optimization Tasks 4 & 5)
- **子智能体审批深度传播 (Subagent Approval Depth Propagation)**: 在 `createSubagentTool` 的选项中新增并传递了 `requestedByDepth` 参数，且在生成子智能体的 `hostApproval` 载荷时将其递增 `(options.requestedByDepth ?? 0) + 1`，确保子智能体执行敏感操作（如 `bash` 命令）时能够向上级与宿主持久化正确的调用层级深度，彻底修复了原先硬编码为 `1` 的逻辑缺陷。
- **TurnOrchestrator 认证边界文档化 (Actor Authentication Boundary Documentation)**: 在 `TurnOrchestrator.prepareTurn` 中为 SQLite `runs` 表写入 `actor_id` 时补充了明确的注释文档，声明 Channel 渠道运行时应在调用共享的 turn 编排管道前完成外部 Actor 的鉴权与授权，而 TurnOrchestrator 仅对已标准化的 `message.userId` 进行归档以做审计与工作区映射，明确了系统安全边界。
- **测试环境会话与沙盒隔离优化 (Test Session Isolation & Mock Alignment)**: 优化了 `runner.test.ts` 中硬编码 `session-1` 导致的并发或遗留锁冲突，改为在各测试用例中生成独一无二的随机 session ID 进行测试；同时在 store Mock 对象中对齐补全了 `getSessionSandboxOverride: () => null`，使得测试完全在干净且隔离的模拟数据库环境中执行，修复了多个脆弱与 flaky 的单元测试。

### 沙盒多层控制与审批自动恢复优化 (Sandbox Multi-Level Control & Approval Auto-Resume)
- **多层控制链 (Multi-level Control Chain)**: 支持 `Session Override > Bot Instance Override > Agent Override > Global Default` 的沙盒控制优先度。当底层检测到有 Session 级别的覆盖时优先使用该覆盖，方便针对单次会话灵活控制沙盒。
- **配置持久化与迁移 (Configuration Persistence & Migration)**: 在 `schema.ts`、`sanitize.ts` 和各个设置接口中打通了 `sandboxEnabled` 字段的读写，且在启动时通过 SQLite 迁移代码自动为 channels 表和 agents 表添加 `sandbox_enabled` 列。同时，在 Web、Telegram、Feishu、QQ、Weixin 的 Svelte 设置页面中全面接入了 `sandboxEnabled` 的字段加载与保存映射（并提供 UI 覆盖开关），彻底解决了保存其他渠道配置时 sandboxEnabled 字段被静默覆盖清空的数据丢失隐患。
- **沙盒开关控制指令 (Sandbox Command override)**: 新增 `/sandbox` 会话指令，支持展示当前有效沙盒状态，并可接受 `/sandbox session on/off`，`/sandbox bot on/off`，`/sandbox agent on/off` 级别覆盖重写。
- **主机命令审批自动恢复 (Approval Auto-Resume)**: 重构了主机命令批准后的执行流程，当用户通过客户端或 Web API 批准命令执行后，自动修改会话上下文中对应的 toolCall 对应的 toolResult 消息，将其内容替换为真实 stdout/stderr。随后，自动在后台重新触发 `runner.run(...)` 或 `runSharedTextTask(...)`，彻底解决以往命令审批通过后对话被截断的痛点。
- **主机工具运行目录定制 (Customizable Tooling Directory)**: 内置主机 bash 工具在执行前，将检查环境变量 `MOLIBOT_TOOLING_DIR`（默认 `~/.molibot/tooling`），并在此目录下单独建立 `venv`、`GOPATH` 和 `GOCACHE`，确保智能体独立运行环境持久化并独立管理，防止依赖包或环境配置污染。

### 命名沙盒安全策略卡片 (Named Sandbox Profiles)
- **定义标准沙盒策略模板**: 在 Web UI 中预定义了三种安全级别模板：`Observe`（只读，允许网络通配符，可写 `/tmp` 和 `scratch`），`Build`（可读写工作区，限制网络至标准依赖源），以及 `Strict`（极度隔离，无网络，仅可写 `/tmp`）。
- **动态策略匹配与状态检测**: 实现了 Svelte 端对当前生效沙盒规则的自动比对匹配。若检测到用户更改了底层任何细节，卡片状态将自动高亮显示“自定义配置策略 (Custom Profile)”，方便用户随时重置或查看。
- **可视化预设选择卡片**: 在 `/settings/sandbox` 顶部新增了三张拥有精美悬停悬浮阴影、过渡动效和当前生效激活边框的卡片。
- **完善的国际化支持**: 针对预设卡片名称、模式描述以及自定义状态和生效徽标等，全部提供了完整的中文与英文双语翻译支持。

### 可配置的智能体运行预算限制 (Configurable Run Budget Limits)
- **Schema 与配置持久化扩展**: 在 `RuntimeSettings` 接口和 `schema.ts` 中新增了 `budget: RunBudgetLimits` 结构，声明最大工具调用次数 (`maxToolCalls`)、最大允许工具失败次数 (`maxToolFailures`) 和最大模型尝试次数 (`maxModelAttempts`)，并增加对应环境变量 `MOLIBOT_MAX_TOOL_CALLS` 等的支持。
- **Sanitization 与 Clamping 保护机制**: 在 `sanitize.ts` 与 `store.ts` 中新增并集成了 `sanitizeBudgetSettings` 辅助方法，将用户的数值输入安全地夹逼（clamp）在合理范围（如工具调用最大限额 `1` 至 `500`），避免死循环或配置溢出。
- **Agent 预算动态实例化**: 重构了 `runner.ts` 中的 `RunBudget` 实例化逻辑，由原本的硬编码默认值 `DEFAULT_RUN_BUDGET` 改为优先读取当前 Settings 的 `settings.budget` 配置。
- **系统配置 Web UI 深度集成**: 在 `/settings/system`（系统配置）界面中新增了“智能体运行预算限制”配置卡片，支持中英文双语翻译与实时配置保存，完美对接 `/api/settings` 后端更新接口。

### Agent runner.ts 瘦身与输入 Enrichment 抽取 (v2.2 Phase 5)
- **Top-Level Helper 提取**: 将 `runner.ts` 顶部的 16 个辅助函数（如 `envVarForProvider`, `getMessageText`, `prepareMessagesForModelContext`, `validateRuntimeSettings` 等）完整提取至独立的 `runnerHelpers.ts` 文件中，使核心文件结构更为聚焦。
- **输入 Enrichment 模块抽取**: 将包含语音识别转写（STT）路由、视觉/图像路由降级（Vision Route/Image Fallback）以及候选模型兜底决议逻辑的 Enrichment 链条，从 `runner.ts` 的 `run()` 方法中提取至 `runnerInputEnricher.ts` 的 `prepareEnrichedInput()` 纯净辅助函数中。
- **`runner.ts` 代码精简与重构**: 更新 `runner.ts` 导入新抽取的 `runnerHelpers` 和 `runnerInputEnricher`。修改 `activeSelection` 解构为 `let` 变量以支持在模型候选重试循环中被重新赋值。彻底移除兼容旧版中断审批的 `blockedOnHostBashApproval` 临时逻辑与 `agent.abort()`，成功将文件精简至 1693 行。
- **`RunnerPool` 模块化解耦**: 将 `RunnerPool` 从 `runner.ts` 剥离至独立的 `runnerPool.ts`，并重构了所有渠道 runtime 与命令相关的引用路径，使得生命周期与池管理逻辑更清晰。
- **媒体路由类型安全化**: 在 `mediaFallback.ts` 中定义并导出了明确的 `AudioRouteDecision`、`VisionRouteDecision`、`ImageFallbackRouteDecision` 接口，解决跨模块导入类型推导问题，打通了 TypeScript 全局类型校验。

### 审批运行期阻塞唤醒与兼容性对齐 (v2.2 Phase 3D)
- **Tool 协程挂起与轮询**: 在 `toolRuntime.ts` 的 `executeToolCall` 中实现了 5 分钟超时限制的轮询机制，在需要审批且无授权时阻塞 Tool 的执行协程，待用户在客户端（Telegram / Web）做出选择后自动唤醒。
- **1.5s 审批 Debounce 聚合**: 针对 `low` 和 `medium` 风险的敏感操作实现了 1.5 秒 Debounce 合并逻辑，连续触发的类似审批会聚合成单张操作卡片，避免弹窗泛滥。
- **Capability 标识符映射**: 重构了 Host Bash 类型的能力标识符生成策略，统一映射为 `bash:${toolId}` 格式，完美兼容旧版控制命令和 `/settings/host-bash` 设置页中的 `LIKE 'bash:%'` 过滤规则。
- **重复执行并发拦截**: 在 `channelCommands.ts` 的审批执行方法中增加了 `isRunActive` 校验；如果被审批的 Run 当前处于 `'running'` 激活状态，将不调用后台并发执行通道，而是交由被挂起的协程直接继续完成执行，避免重复执行命令。
- **Abort 信号深度打通**: 在 `ToolExecutionContext` 中新增 `signal` 字段，并在 `tools/index.ts` 包装层及 `toolRuntime.ts` 轮询层进行对齐透传，当 Runner 主动中止（abort）时，被挂起的协程能够立刻感知并退出轮询。
- **暂停中断逻辑解耦**: 清理了 `runner.ts` 内部对 `waiting_for_approval` 中断的强制依赖，确保当审批挂起时 Runner 仍保持活跃 `running` 状态并正确持有分布式锁，只有在真正取消（`/stop`）时才中止。对 [runner.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/runner.test.ts) 中的审批通知推送与不中止执行流进行了同步重写与回归验证。

## 2026-05-29

### Legacy ACP 物理清理与工作区安全策略闭环 (Sprint A)
- **Legacy ACP 物理清理与依赖包外置**: 将遗留的 ACP (Agent-Channel Proxy) 模块从主代码库中彻底剥离并迁移至 `package/acp/`。删除了 `src/lib/server/acp/`、`src/routes/settings/acp/` 目录以及 `src/lib/server/channels/telegram/acpProgress.ts` 临时进度管理文件。
- **配置与设置层彻底解耦**: 移除了 `src/lib/server/settings/` 目录下 schema、defaults、sanitize 和 store 中所有关于 `acp` 的数据结构、验证、默认值和序列化逻辑。
- **外部依赖 subpath imports 注册**: 在根 `package.json` 的 `imports` 字段中注册了 `"#acp/*": "./package/acp/src/*"` 别名映射，以便在未来需要时可以将其作为标准外部依赖即插即用。
- **Feishu 渠道无用逻辑清理**: 移除了 `src/lib/server/channels/feishu/messaging.ts` 中未被引用的 `AcpPendingPermissionView` 导入和专属于 ACP 的卡片生成函数 `buildFeishuAcpPermissionCard` 与 `buildFeishuAcpPermissionResultCard`。
- **工作区工具与技能执行策略闭环**: 
  - **Tool 拦截**: 重构了 `ToolRuntime.executeToolCall`，使其读取当前工作区的 `enabledToolIds` 字段；当配置不为空且不包含 `*` 时，强行阻断所有未列入白名单的工具执行，并返回拒绝提示。
  - **Skill 过滤**: 扩展了 `loadSkillsFromWorkspace` 的 `SkillLoadOptions`，支持接收 `workspaceId` 并自动根据工作区的 `enabledSkillPaths` 过滤被加载的技能，且在 `runner.ts` 的执行流中对齐传递了活跃的 `workspaceId`。
- **单元测试与回归校验**: 在 `toolRuntime.test.ts` 与 `skills.test.ts` 中分别为工具及技能白名单过滤编写了高可靠性的单元测试，模拟创建测试工作区记录并验证策略阻断和过滤通过。所有 25/25 Agent 测试套件与 SvelteKit TypeScript 编译通过，无任何回归问题。

### 可插拔沙盒运行环境模块化重构 (Pluggable Sandbox Runtime)
- **解耦的沙盒接口定义**: 在 [sandbox.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/tools/sandbox.ts) 中定义了通用的 `SandboxProvider` 接口，以及与具体 SDK 无关的通用配置类型（`SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxRuntimeConfig`），确保底层沙盒逻辑与上层工具彻底解耦。
- **默认 Anthropic 沙盒包装器**: 实现了 `AnthropicSandboxProvider` 类，将原有的 `@anthropic-ai/sandbox-runtime` SDK 整合封装于其内，作为系统默认激活的沙盒后端。
- **沙盒管理器注册与动态切换**: 提供了 `getSandboxProvider()` 与 `setSandboxProvider()` 注册机制，支持运行时自由插拔更换底层沙盒实现（如 Docker、Bubblewrap 等）。重构了 `prepareToolSandboxExecution` 和 `getToolSandboxDiagnostics` 诊断函数，使其完全动态委托给当前激活的沙盒提供者。
- **自定义沙盒插拔测试验证**: 在 [sandbox.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/tools/sandbox.test.ts) 中新增了 `pluggable sandbox provider dynamically intercepts sandbox execution` 单元测试，注册 Mock 沙盒提供者并验证其执行阻断、配置传递与环境隔离行为，且在测试结束后安全还原，确保测试隔离。运行 25/25 Agent 测试套件全部绿灯通过。

### ToolRuntime 与 ApprovalBroker 深度集成 (v2.2 Phase 3)
- **MCP 工具安全收口与动态包装**: 重构了 MCP 工具的加载与包装流程。在 `index.ts` 中更新 `wrapWithToolRuntime`，对以 `mcp__` 开头的 MCP 工具将其 `source` 统一标识为 `"mcp"`，并暴露出 `wrapTool` 辅助方法；在 `runner.ts` 的加载及刷新流程中，动态使用该方法将 MCP 工具包裹进 `ToolRuntime` 控制流下，确保 MCP 工具执行受到统一安全策略（沙箱/审批）监管。
- **子代理审批冒泡 (Subagent Approval Bubbling)**: 在 `subagent.ts` 中扩展 `createSubagentTool` 接收父任务的 `runId`，在子任务触发敏感工具需宿主审批时，将父任务的 `runId` 作为 `scopeId` 并将 `requestedByDepth` 设为 `1`。由此让前端 Channel 适配器能直接在主会话中为用户渲染并提醒子代理的审批请求。
- **审批深度持久化追踪**: 修改了 `HostBashStore.requestApproval` 存储适配层与 `bash.ts`，支持接收并持久化 `requestedByDepth` 参数，将其安全地记录在 SQLite 表 `approval_requests` 中，完成了子代理审批深度的库表字段落地。
- **测试回归验证**: 运行类型校验和 25/25 Agent 测试套件，以及 5/5 的 `approvalBroker.test.ts` / `approvalStore.test.ts` 测试套件，结果全部绿灯通过。

### TurnOrchestrator 核心生命周期接管与 runner.ts 瘦身 (v2.2 Phase 2)
- **核心生命周期委托**: 将原本耦合在 `runner.ts` 中的 Session 并发锁、10 分钟锁超时释放、内存同步与 Prompt 快照加载、以及上下文自动压缩机制全面委托给 `TurnOrchestrator` 管理。
- **并发锁与超时机制**: `TurnOrchestrator.prepareTurn` 实现了基于 SQLite 的 Session 锁，在同个会话出现并发调用时拦截并报错；支持 10 分钟锁自动超时置为 `failed` 状态并自动释放重构，保证系统不会因异常崩溃而产生永久死锁。
- **内存快照接管**: 实现了 `TurnOrchestrator.prepareTurnMemory`，统一封装 MemoryGateway 的外部记忆同步与快照 fingerprint 创建。
- **上下文压缩解耦**: 提取 `compact` 方法为 `TurnOrchestrator.compactSessionContext`。`runner.ts` 中的上下文超出临界值判定、自动压缩和重试流程现已全部委托其执行。
- **Turn 状态归档**: 提取 `commitTurn` 方法，集中管理最终 `RunSummary` 的保存及 SQLite runs 运行状态的更新（`completed`, `aborted`, `waiting_for_approval`, `failed`）。
- **`runner.ts` 瘦身**: 移除了 `runner.ts` 中上述大量的辅助状态与数据操作函数，让其核心只专注于 LLM 推理循环、工具预算和工具执行，文件可维护性极大提升。
- **回归测试验证**: 新增/重写了 `turnOrchestrator.test.ts` 中针对并发锁、超时释放、内存同步和归档提交等逻辑的 7 个细粒度单元测试；回归运行 25 个 Agent 测试套件，结果达成 **100% 全部通过** (25/25 passed)。

### Agent 目录重构与模块化治理 (Step 5)
- **目录结构清晰化**: 将原本存放在 `src/lib/server/agent/` 根目录下的数十个凌乱文件成功归类至以下子目录：
  - `core/`: 存放 Agent 核心逻辑、运行控制与生命周期管理（`runner.ts`、`turnOrchestrator.ts` 等）。
  - `routing/`: 媒体资源路由与备用决策（`modelRouting.ts` 等）。
  - `prompts/`: 提示词渲染、人设、模版和配置上下文加载（`prompt.ts`、`profiles.ts` 等）。
  - `tools/`: 工具定义、策略拦截与运行控制（`write.ts`、`bash.ts` 等）。
  - `skills/`: 自我演化与技能推荐机制（`skills.ts`、`self-evolution.ts` 等）。
  - `session/`: 会话历史持久化、归档与压缩机制（`session.ts`、`compaction.ts` 等）。
  - `identity/`: 鉴权鉴密管理（`auth.ts` 等）。
  - `common/`: 日志记录等辅助公共设施（`log.ts` 等）。
  - `commands/`: 终端命令与调试管理（`channelCommands.ts` 等）。
- **静态类型与导入路径纠正**: 对整个工作区中受到移动影响的 TS/JS/Svelte 文件进行全面重构，使用全新的 alias `"$lib/server/agent/..."`。
- **自定义 Node.js ESM 测试加载器**: 为规避 Node.js 对 Vite 特有的 `?raw` markdown 文件后缀静态引入抛出 `ERR_UNKNOWN_FILE_EXTENSION` 错误的问题，设计并引入了 `scripts/md-loader.js` 自定义 ESM 加载器，在测试执行期自动拦截并以 JavaScript 格式包装渲染 Markdown 字符串内容。
- **高风险写入路径和 Mock 稳健性修复**:
  - 修复 `write.ts` 无法自动创建缺失父级目录导致 `ENOENT` 异常的缺陷，改为前置安全调用 `fs.promises.mkdir` 递归建目录。
  - 修复了 `compaction.ts` 达到临界值时无法正确触发压缩的等于逻辑 bug。
  - 修复了 `self-evolution.test.ts` 因为迁移深度改变导致读取模板技能路径多了一层 `../` 的定位 bug。
  - 补充并对齐了 `runner.test.ts` 中模拟 error tracker 的 mock 对象，彻底消除了 `tracker.record is not a function` 的隐藏异常。
- **验证**: 运行 `npx node scripts/run-all-agent-tests.js` 对整个 agent 模块的 25 个测试套件进行了完整回归测试，达成 **100% 全部通过** (25/25 passed)，无任何类型或测试阻碍。

### ToolRuntime 和 ToolRegistry 深度集成 (Step 4)
- **内置工具 ToolDefinition 重构**: 内置工具（`read`、`write`、`edit`、`bash`）全部重构为 `ToolDefinition` 结构。工具逻辑彻底解耦，不直接导入 `node:fs` 或通过子进程直接执行 Host Bash。
- **ToolExecutionContext 真实 API 实现**: 移除了原有的 dummy 桩实现。`fs.readText`、`fs.writeText` 和 `fs.readBuffer` 实现了完整的 Workspace / CWD 路径安全性检查与节点文件系统读写能力。`shell.run` 在沙箱配置启用时自动执行沙箱指令包裹与状态跟踪。
- **ToolRuntime 集中拦截政策检查**: 使用自定义 `decidePolicy` 代代替原有的默认策略，拦截高风险命令（Host Bash / 越狱行为），根据 `hostBashStore` 的审批历史进行沙箱绕过或自动生成 `HostBashApprovalPrompt` 挂起审批。
- **向下兼容遗留桥接**: 实现并引入了 `toolDefToAgentTool` 桥接工具，对 `subagent.ts` 及各类旧测试代码透明，确保原有工具集继续跑通。
- **验证**: 单元测试和 TypeScript 类型检查全面通过，修改后的文件完全实现零 TS errors。

## 2026-05-28

### Agent v2.2 Runtime Integration
- **TurnOrchestrator 完整接入**: 新增 `src/lib/server/agent/turnOrchestrator.ts`，控制 run/session/workspace 元数据准备；`runner.ts` 现已在所有出口路径下调用 `updateRunStatus` 将 run 状态置为非 running。
- **启动死锁清理**: 在 `src/lib/server/app/runtime.ts` 的 `getRuntime()` 初始化段接入了 `getTurnOrchestrator().cleanupStaleRunningTurns(new SqliteTurnCleanupStore())`，在系统启动时自动清理过期的 runs 死锁。
- **渠道接入 TurnOrchestrator**: 修改 `baseRuntime.ts`，在 `runSharedTextTask` 处理消息前，直接调用 `TurnOrchestrator.prepareTurn()`，减少 `runner.ts` 内部对消息元数据处理的依赖。
- **ToolRuntime 统一拦截执行**: 所有由 `createMomTools()` 返回的内置工具均通过 `wrapWithToolRuntime` 动态注册至 `ToolRegistry` 并委托给 `ToolRuntime.executeToolCall()` 进行鉴权、审计及审批检查。
- **ApprovalBroker 与 SQLite 审批库**: 实现 SQLite 存储 `approval_requests` 和 `approval_grants`，并且 `HostBashStore` 已经完全重写直接使用该 SQLite 审批流。
- **ACP 设置面收缩与 Dynamic Settings 拆分**: ACP 主业务隔离，dynamic settings (Workspaces, Channel Instances, Custom Providers) 已经由 SettingsStore 自动支持 SQLite 拆分存储。
- **Runtime 模块化解耦**: 将包含 650+ 行配置清洗逻辑的 sanitizers 从 `runtime.ts` 提取至 `src/lib/server/settings/sanitize.ts`；将 channel 插件热装载逻辑 `applyChannelPlugins` 提取至 `src/lib/server/plugins/loader.ts`。`runtime.ts` 文件体积大幅缩减至 150 行以内，核心职责高度凝聚。
- **验证**: 单元测试和聚焦测试完全通过，TurnOrchestrator 补齐测试环境自动建表规避了 "no such table" 异常。

### Agent v2.2 Refactoring Design Spec (Refined)
- **精炼可执行架构规范**: 重新整合 v2.0 与 v2.1 方案优点，输出 `v2.2.md` 作为正式执行规范。明确了由 TurnOrchestrator、PiAgentRuntime、ToolRuntime、ApprovalBroker、Workspace 组成的 4 核心 1 边界的极简设计。
- **融合技术评审改进**: 根据 `v2.2-review.md` 评审，明确 Workspace ID 仅作为逻辑权限与隔离边界，绝不干涉或迁移物理文件目录结构。
- **平滑演进与细化切片**: 将 ACP 下线改为第一阶段仅清除活跃引用、最后阶段再物理删除代码；将 TurnOrchestrator 改为增量式接入与管道灰度升级；将 Phase 3 审批模块拆分成内置收口、Host Bash 兼容、Subagent 冒泡、Debounce超时 4 个更薄的细分切片。
- **细化模块接口与库表**: 设计并给出了 Workspace、ToolDefinition、ToolExecutionContext、ApprovalRequest、ApprovalGrant 的完整 TS 类型以及 SQLite 数据表结构，并在 SQLite schema 中补齐 `runs.status` 完整运行时状态与 `approval_requests` 性能优化索引。


### Minimum Workspace Boundary
- **默认 Workspace registry**: 新增 SQLite-backed `workspaces` registry，启动时确保默认 `personal` workspace 存在，并保留 `enabledSkillPaths`、`enabledToolIds`、`sandboxProfileId`、`approvalProfileId` 等后续边界字段为可选。
- **运行记录带 Workspace**: Shared channel runtime、Web chat API 和 streaming API 会给新消息注入默认 `workspaceId`，runner 兜底解析 workspace 并把 `workspaceId` 写入 run summary / run detail JSONL；当前不迁移已有 session/chat 文件布局。


## 2026-05-27

### Agent v2.1 simplification planning
- **可执行 TODO 计划**: 当时曾把 `v2.1.md` 拆成 80 条执行项，用于推进“删除 ACP 主路径 + 引入最小 Workspace 边界”、TurnOrchestrator、ToolRuntime、Approval scope 和 Settings 渐进拆分；该过程计划现已从主 docs 树清理，长期架构结论保留在 Agent redesign 设计文档中。

### ACP active runtime path removal
- **ACP 主路径下线**: Web/Telegram/Feishu/QQ/Weixin 的共享 channel runtime 不再实例化 `AcpService`，各渠道移除 ACP 自动代理、ACP 命令模板、权限回调和运行提示；`/acp`、`/approve`、`/deny` 统一返回 inactive-path 提示。
- **设置入口下线**: Settings 左侧导航和总览页不再展示 `/settings/acp`，README 将 ACP 标记为 legacy inactive surface；旧 `settings.acp` schema 与 `src/lib/server/acp/` 仍保留兼容，不做破坏性迁移。

### Agent session persistence hardening
- **Compaction 顺序修正**: Runner 自动压缩上下文时先写入 compaction entry，再追加本轮用户消息，避免当前 prompt 被新 compaction 快照截断。
- **错误 assistant 上下文隔离**: 没有 partial 文本的 assistant error 仍作为审计消息保存在 Agent session，但从下一轮模型上下文中过滤，避免空 assistant error turn 污染推理。
- **Sandbox 写权限收窄**: Longbridge 日志目录不再被加入所有 sandbox 命令的默认 `allowWrite`，后续如需放行应走命令级或配置级边界。

## 2026-05-26

### Agent session persistence parity
- **失败轮次保存对齐 Pi/Pae**: Runner 现在在本轮开始时保存用户消息，并在 assistant 成功、失败、partial 输出或工具结果完成时追加 Agent session 记录；自动重试和工具预算续写可继续隔离错误 assistant 的模型上下文，但不会删除 session 审计历史。

### Host Bash tool display accuracy
- **Host Bash 显示名修正**: `bash` 命中已批准 Host Bash 白名单或当前 session host fallback 时，runner 进度、run detail 和客户端诊断显示为 `Host Bash`，不再因为全局 sandbox 开启而误标成 `Sandbox` / `Sandbox disabled`。

## 2026-05-25

### Subagent sandbox research and product boundary
- **竞品调研文档**: 新增 `docs/research/sandbox/subagent-sandbox.md`，系统梳理 Claude Code、Codex、GitHub Copilot cloud agent、Replit Agent、Devin、OpenHands、Cursor 在 subagent、sandbox、审批、环境快照、回滚和页面交互上的实现方式。
- **下一阶段边界明确**: 文档把 Molibot 当前第一版能力和缺口拆成 P0/P1/P2/P3，建议先补齐策略模板、run ledger、审批/产物/诊断关联和恢复边界，再扩大 host access 或 Docker sandbox provider。

### Host approval environment hotfix
- **Host approval env 恢复继承**: approved Host Bash / legacy host tool 执行器恢复继承宿主 `process.env`，避免开启 sandbox 后审批执行拿不到 API key、PATH、HOME 等运行变量。
- **env allowlist 暂保留兼容**: `envAllowlist` 仍保留在审批记录和白名单结构里，但当前热修复不再把它作为默认清空宿主环境的强制边界；后续再设计可审计的敏感 env 审批。
- **Subagent 审批等待状态修复**: subagent chain/parallel 汇总现在保留 `waiting_for_approval`，chain 在子任务等待审批或失败时停止继续传递 `{previous}`；Web chat 和 streaming API 不再把等待审批提示持久化为普通 assistant 会话消息。
- **审批后自动执行路径修复**: 新建 Host Bash pending action 统一使用 `run_approved_host_bash`，审批后的自动执行恢复拿到原始命令 payload，并从 chat scratch 目录运行，避免相对路径偏移到 chat 根目录。
- **审批等待不再被内部 abort 覆盖**: Host Bash 审批触发的内部 `abort()` 不再把 runner 最终状态改回 `aborted`，Telegram 因此不会在等待审批路径额外发送 `Stopped.`。
- **审批后空输出减噪**: Host Bash pending action 自动执行成功但无 stdout/stderr 时，不再向 Telegram/Feishu/Web/Base 额外发送 `(no output)`，只保留审批已执行的确认消息；失败输出仍照常展示。
- **Telegram 审批点击立即反馈**: Telegram Host Bash 按钮现在先确认 callback 并把审批卡改成“已收到/执行中”，再执行可能较慢的 Host Bash pending action，避免 Telegram callback 超时后用户看不出点击是否生效。

## 2026-05-24

### Host Bash approval friction reduction
- **Host Bash 审批执行补齐**: approved Host Bash / legacy host tool 执行器补齐 session-only pending action 自动执行路径；环境变量默认继承行为已在 2026-05-25 热修复中恢复。
- **Session-only 执行闭环**: `approve-session` 不写长期白名单时，pending Host Bash action 也能用审批记录自身权限执行一次，避免“本 session 允许”后立即执行失败。
- **跨渠道审批执行补齐**: QQ / Weixin 通过共享 channel runtime 继承默认 Host Bash pending action 执行回调；Web Chat 新增 `/hosttools approve|approve-session|reject` 命令闭环。
- **上下文瘦身**: 等待 Host Bash 审批时回滚本轮模型消息，避免审批卡和 sandbox 长错误写入会话上下文；subagent 返回给父 Agent 的超长输出会压缩，完整结果保留在 tool details / run trace。

### Subagent artifact routing
- **Subagent 日期目录继承**: 主 Agent 传入的 `scratch_artifact_dir` 会继续传给 subagent 的 `bash/write` 工具；子 Agent 普通产物和主 Agent 一样默认进入 `scratch/YYYY/MM/DD/`，并在提示中要求回报 routed relative path。
- **修改型产物也归档**: `bash` 会比较根目录文件快照和修改时间，新建或修改过的普通产物都会移动到日期目录，避免子 Agent 重写同名报告时父 Agent 读到旧文件。
- **Host Bash 审批一致**: subagent 内部 `bash` 继承主 Agent 的 channel/chat/session/store 权限上下文，已批准 Host Bash 和 session-only sandbox fallback 对子 Agent 同样生效；子 Agent 需要新审批时会把审批请求冒泡给父 runner 和现有 channel 审批入口。

## 2026-05-23

### Session-scoped sandbox approval fallback
- **第三种审批选项**: host tool approval 现在新增 `This Session` / `approve-session` 路径，批准后不会把命令写进全局 `approvedTools`，只对当前聊天 session 生效。
- **sandbox 自动回退**: 一旦当前 session 进入该模式，后续被 sandbox 权限拦住的 `bash` 命令会直接 fallback 到 host bash 执行，不再对同一 session 中的每条命令重复审批。
- **生命周期正确**: 该放行状态存进 session header preference，不会作为普通对话消息回灌给模型；新建 session（如 `/new`）或切换 bot 后自然失效，并额外写入 runtime event 供排障查看。
- **交互入口补齐**: Telegram/Feishu 审批卡片现在有三种操作：`Approve`、`This Session`、`Reject`；无按钮渠道可用 `/hosttools approve-session <approvalId>` 或回复 `本session允许` / `approve session`。
- **回归覆盖**: 新增共享命令测试覆盖 session-only approval 行为，并补 bash 工具测试覆盖 session 模式下的 sandbox denial fallback 分支。

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

## Update Log
- 2026-05-13: Hardened `molibot manage` against terminal disconnects. Interactive `readline` prompts now swallow ignorable TTY read `EIO` failures, pending prompt waits resolve on interface close, and the menu exits cleanly instead of crashing with an unhandled `Interface` error when stdin disappears.
- 2026-05-11: Fixed Telegram shared live-control command registration. `/steer`, `/followup`, `/follow_up`, and `/queue` now enter the shared command handler before the busy-message enqueue path, so `/steer <queueId>` injects the referenced pending task into the active run instead of creating a new queued task id.
- 2026-04-29: Fixed image routing for dedicated vision models. When a different `visionModelKey` is configured, image messages now use that route before falling back to a vision-capable text route, so setups like text=`mimo-v2.5-pro` and vision=`mimo-v2.5` send the image turn to the intended vision model. If a vision-model request fails but a fallback model recovers the run, Telegram receives a separate failure notice and the assistant still continues processing.
- 2026-04-29: Added Anthropic protocol support for custom AI providers. `/settings/ai/providers` now lets custom providers choose OpenAI-compatible or Anthropic Messages protocol, defaulting old configs to OpenAI-compatible and switching Anthropic paths to `/v1/messages`; provider tests, direct Web custom-provider calls, runner/subagent model construction, SQLite persistence, and vision fallback payloads now branch by protocol. Follow-up polish made protocol switching update the endpoint path reactively, added an Anthropic adaptive thinking format, and changed Reasoning Effort Mapping to default to automatic per-format mappings with optional dropdown overrides.
- 2026-04-29: Improved custom provider test diagnostics. `/api/settings/provider-test` now formats JSON upstream errors and returns up to 4000 characters with an explicit truncation note, while the Providers page allows multi-line status text instead of collapsing long responses to a single ellipsis.
- 2026-04-29: Moved single-model provider test feedback into the tested model card on `/settings/ai/providers`, so Save-button status is reserved for page-level save/load results and each model keeps its own latest connectivity response.
- 2026-04-29: Fixed Anthropic custom-provider runtime endpoint construction. Runner/subagent model setup now passes the Anthropic SDK-style base URL by stripping the full `/v1/messages` suffix, matching the provider-test request URL; model error records also include a computed endpoint URL so `/settings/ai/errors` no longer forces operators to infer the failing path from base URL alone.
- 2026-04-26: Productized the Web chat files pane. Added shared file-preview classification in `src/lib/shared/filePreview.ts`, persisted Web session attachment metadata in `src/lib/shared/types/message.ts` and `src/lib/server/sessions/store.ts`, and introduced `src/routes/api/web/files/+server.ts` for current-session file listing plus raw preview/download responses. The main chat page now supports general file upload, richer pending-file chips, and a real right-side file workspace with search, type filters, preview, download, and copy-path actions.
- 2026-04-26: Updated `/settings/ai/usage` so range-tab clicks now automatically refresh backend stats. Switching `today / yesterday / last7Days / last30Days` immediately triggers `loadUsage()`, keeping the selected window, `generatedAt`, and KPI/chart payload in sync without a separate manual refresh click.
- 2026-04-26: Extended `/settings/ai/usage` with cache-hit observability. The dashboard now shows a cache-hit ratio KPI and a dedicated line chart, using the existing usage records only and defining hit rate explicitly as `cacheRead / (input + cacheRead)` so prompt-cache effectiveness is visible by time window and filters.
- 2026-04-26: Added a shared `src/styles/workbench.css` UI layer and switched Settings onto reusable workbench primitives instead of per-page CSS islands. `PageShell`, `Button`, `Card`, and `Alert` now expose the same material system; `/settings/ai/usage`, `/settings/ai/errors`, `/settings/ai/routing`, and `/settings/ai/providers` no longer keep page-local `<style>` blocks; the remaining settings pages and the main Web chat were restyled onto the same panel/toolbar/config-shell language without changing route behavior or data flow.
- 2026-04-26: Removed time-specific lines from the runtime-owned system prompt context in `src/lib/server/agent/prompt.ts`. Current time and today-date awareness now live only in the per-message `<env>` wrapper, so the cached system prompt no longer carries `Server timezone` / `run: date` guidance that was redundant after live input injection.
- 2026-04-26: Added structured per-message time context for model input. `src/lib/server/agent/promptInput.ts` now injects `<env>` metadata with `message_received_at`, `timezone`, and `today`; `src/lib/server/agent/runner.ts` uses that wrapper only for live model input and rewrites persisted context back to the raw user text plus attachment markers; `src/routes/settings/ai/routing/+page.svelte` now exposes runtime timezone as a dropdown built from IANA timezones, and `/api/settings` validates the saved timezone before persistence.
- 2026-04-26: Reorganized documentation responsibilities across `AGENTS.md`, `README.md`, `features.md`, `prd.md`, and `CHANGELOG.md`. Extracted only evergreen collaboration and architecture rules into `AGENTS.md`, added a doc-role table plus maintenance workflow to `README.md`, and recorded the change as a dedicated documentation-governance update so future edits keep stable rules separate from planned work and shipped history.
- 2026-04-26: Fixed three regressions in the new shared runner/subagent path. `src/lib/server/agent/runner.ts` now clears buffered streamed assistant text at the start of each new assistant message so retry/fallback partial output cannot leak stale text into later failures or continuations. `src/lib/server/agent/tools/subagent.ts` now rejects shell control operators in read-only subagent bash commands, and delegated roles now honor the checked-in per-agent `model:` hint instead of always inheriting the parent text model. Added focused regression tests in `src/lib/server/agent/runner.test.ts` and `src/lib/server/agent/tools/subagent.test.ts`.
- 2026-04-26: Refined the shared tool-execution guidance in `src/lib/server/agent/prompt.ts`. The system prompt no longer says to parallelize any “independent” tool calls by default; it now distinguishes safe local read-only parallelism from remote/network/search work that has timeouts, retries, fallbacks, quotas, or result-normalization concerns, and explicitly tells the agent to run fallback-dependent steps sequentially. Added `src/lib/server/agent/prompt.test.ts` to lock that wording in.
- 2026-04-26: Hardened the Molifin gold daily scheduled task outside the main app repo. The bot workspace now ships a dedicated `run_gold_daily_searches.py` wrapper that executes the four fixed gold-report queries strictly in series, gives each engine a fixed 60-second budget, automatically falls back across the documented web-search engine order on timeout/error/empty results, and writes one JSON + Markdown result bundle per day. The linked event prompt and `gold_daily_scheme.md` were bumped to V7 so the runtime stops spawning four parallel 30-second `bash` searches by default.
- 2026-04-26: Made live run control queue-aware. When a second message arrives during an active run, Telegram/Feishu/QQ/Weixin now reply with a queue id (`Queued as #...`). Shared `/steer <queueId>` and `/followup <queueId>` can promote that already-sent pending item directly from the SQLite inbound queue into the live runner without retyping its text.
- 2026-04-26: Added shared live run-control commands for active tasks. `src/lib/server/agent` now exposes `abort / steer / followUp` through the shared runner/pool layer, `/steer <text>` injects a correction into the current run, `/followup <text>` queues a live follow-up after the current run finishes, and `/stop` now hard-aborts after clearing any in-memory live-control queue entries.
- 2026-04-26: Changed shared channel stop semantics so `/stop` now aborts the current run and clears pending queued tasks in the same scope. Added shared queue cancellation support in the SQLite inbound queue layer, updated Telegram queue feedback text to explain the new behavior, and covered the change with queue/command tests.
- 2026-04-22: Replaced the old in-memory pending-message flow for Telegram, Feishu, QQ, and Weixin with a shared lightweight SQLite task queue. Incoming text/image/voice tasks now survive restart, support `/queue` listing, `/queue front`, and `/queue delete`.
- 2026-04-14: Fixed the invalid self-closing `textarea` in Skill Drafts settings so `npm run build` and dev startup no longer warn on that page.
| ENG-148 | Audio-input capability groundwork | Done | Added `audio_input` as a first-class model capability tag across settings schema, sanitization, provider test payloads, and AI Providers UI, while intentionally keeping its verification state `untested` until native audio prompt transport is implemented |
| ENG-149 | Verification-aware audio fallback routing | Done | Updated `runner.ts` to compute an explicit audio decision from `audio_input` and `stt` capability metadata, log the fallback reason, keep STT as the execution path while native audio transport is unavailable, and preserve voice-placeholder behavior when no STT target exists |
| ENG-150 | Telegram media pre-processing status + action retry hardening | Done | Added reusable pre-thinking status messages for inbound image/audio recognition, upgraded `sendChatAction` and status-edit paths with limited retry on transient network failures, and reused the seeded status message through `Recognizing... -> Thinking -> final answer` |
| ENG-151 | Telegram network-error diagnostics enrichment | Done | Added structured Telegram transport error diagnostics with nested `cause`/`code`/`errno`/`syscall`/`address` metadata on retry warnings and failure logs so generic grammY `Network request failed` events can be traced to real socket/DNS timeout causes |
| ENG-152 | Declared-vision-first native image routing | Done | Custom text/vision models that explicitly declare `vision` are now trusted for native image input even when verification is `untested` or `failed`; verification remains observable in logs, but no longer forces an unnecessary image-analysis fallback API call |
| ENG-153 | AI usage bot-dimension analytics and filtering | Done | Extended usage records with `botId`, added bot-level aggregation in usage tracker windows/breakdowns, and upgraded `/settings/ai/usage` with bot filter + bot ranking table to compare usage across different bot instances |
| ENG-276 | AI usage analytics chart/icon contrast fix | Done | Fixed `/settings/ai/usage` so its key accent icons, token badges, and Usage Timeline bars keep visible contrast under the shared settings theme instead of being flattened into near-background black/white tones |
| ENG-252 | Runner stream logging safety fix | Done | Removed the unsafe low-level stream wrapper from `runner.ts`, moved first-token logging onto real assistant delta events, and stopped auto-enabling pretty stdout logs unless `MOM_LOG_PRETTY=1` is explicitly set |
| ENG-253 | Weixin final-reply drop fix after progress updates | Done | Fixed `src/lib/server/channels/weixin/runtime.ts` so when Weixin has already sent progress updates (for example “搜索中”), the final answer is still sent out instead of being silently swallowed by replace-without-edit fallback |
| ENG-254 | QQ final-reply drop fix after progress updates | Done | Fixed `src/lib/server/channels/qq/runtime.ts` so when QQ has already sent progress updates, the final answer is still sent out instead of being silently swallowed by replace-without-edit fallback |
| ENG-255 | Weixin outbound markdown conversion routed to vendored SDK logic | Done | Weixin text/file-caption outbound now runs `#weixin-agent-sdk/src/messaging/send.ts` `markdownToPlainText` before sending, and removed local SDK barrel `src/lib/server/channels/weixin/sdk/index.ts` to avoid stale duplicate entry paths |
| ENG-256 | Weixin local type facade removal (phase-2 step-1) | Done | Removed local `src/lib/server/channels/weixin/sdk/types.ts` facade and switched Weixin channel modules to direct vendored type imports, while keeping send/receive runtime behavior unchanged for safe incremental migration |
| ENG-257 | Weixin local poll/login wrapper thinning (phase-2 step-2) | Done | Kept WeixinBot external interface unchanged but switched internal polling/config/typing calls in `sdk/client.ts` to direct vendored API usage, and removed now-unused local relay methods from `sdk/api.ts` |
| ENG-258 | Weixin local credential-storage thinning (phase-2 step-3) | Done | Kept workspace tokenPath isolation behavior, while syncing save/clear operations in `sdk/auth.ts` into vendored account storage and using vendored account store as fallback only when tokenPath is not provided |
| ENG-259 | Weixin direct third-party SDK cutover (remove local sdk directory) | Done | Removed local `src/lib/server/channels/weixin/sdk` API/Auth implementations and switched runtime/outbound/media paths to direct `#weixin-agent-sdk/*` usage, with a minimal channel bridge file retained at `src/lib/server/channels/weixin/client.ts` |
| ENG-260 | Bash Python sandbox virtualenv isolation | Done | `bash` tool now auto-runs commands with one shared Python virtualenv under `~/.molibot/tooling/python/venv`, and unifies `python/pip/uv` to this sandbox path so package installs do not pollute global Python |
| ENG-261 | Bot profile files management tool with inherit fallback | Done | Added `profile_files` tool so runtime can read/bootstrap/write/edit bot-level profile files (`BOT/SOUL/USER/TOOLS/IDENTITY/SONG`) with fallback chain `bot -> agent -> global`, avoiding direct bash path edits for agent training/tuning workflows |
| ENG-262 | Telegram API call timeout-based retry unstick | Done | Added per-attempt timeout to Telegram send/edit/action API retry wrapper so stuck network calls fail fast with retry instead of hanging status updates indefinitely; timeout failures now count as retryable and include timeout metadata in logs |
| ENG-263 | Bash Python command hard-binding to sandbox venv | Done | Hardened bash tool Python isolation by forcing `python/python3/pip/pip3` inside executed shell to resolve to the unified sandbox interpreter, auto-healing missing pip via `ensurepip`, and stripping unsupported `--break-system-packages` flags so skill scripts no longer fail when bootstrapping dependencies |
| ENG-264 | Settings tasks cross-channel visibility and trigger routing | Done | Expanded `/api/settings/tasks` and `/settings/tasks` from Telegram-only scope to all built-in channels (`telegram`/`feishu`/`qq`/`weixin`), added channel-aware path validation and counts, and wired manual trigger dispatch by channel manager with new `triggerTask` support in QQ/Feishu/Weixin runtimes |
| ENG-265 | Session token visibility and QQ audio URL voice routing | Done | `/status` now shows current session context estimate plus accumulated per-session token usage, and QQ outbound media now routes remote audio URLs onto the native voice send path instead of misclassifying them as generic attachments |
| ENG-226 | ACP compact settled-history progress display | Done | ACP now emits normalized progress events, Telegram keeps one live progress message with current state plus recent completed/failed history instead of overwriting everything, and the shared ACP proxy rule is centralized so active ACP sessions keep slash-style input on the remote side unless it is an ACP control command |
| ENG-187 | Telegram stream output toggle per bot | Done | Added per-bot `streamOutput` setting (default on) on `/settings/telegram`; Telegram runtime now supports stream-on incremental status editing and stream-off final one-shot output |
| ENG-188 | WeChat channel integration via Node SDK | Done | Added built-in WeChat channel plugin and settings page; later migrated the runtime off the buggy published `@pinixai/weixin-bot` package and onto a project-local Weixin SDK bridge derived from the newer `weixin-agent-sdk` flow so WeChat no longer depends on that npm package at runtime |
| ENG-189 | WeChat login-link QR generator in settings | Done | Added a QR tool to `/settings/weixin` so operators can paste the SDK login link from logs and instantly render a scannable QR code in the browser for phone-based WeChat login confirmation |
| ENG-190 | Telegram Codex ACP command path MVP | Done | Added ACP settings + Codex target preset, Telegram `/acp` / `/approve` / `/deny` commands, project registration, chat-scoped ACP session lifecycle, live status updates, and permission request handling for Codex-style remote coding control without altering the normal Telegram chat runner |
| ENG-191 | ACP web settings workspace | Done | Added `/settings/acp` with structured ACP target/project management, approval-mode defaults, absolute-path project allowlist editing, and settings overview/navigation entry so Codex ACP can be configured from the web UI instead of command-only setup |
| ENG-192 | Shared Button click event forwarding | Done | Fixed `src/lib/ui/Button.svelte` to forward native `click` events from the inner `<button>`, restoring all settings actions wired as `<Button on:click={...}>`, including ACP `Add Project` / `Add Target`, bot add/remove controls, MCP parse/save, memory actions, and task bulk operations |
| ENG-193 | ACP stdio framing compatibility fix | Done | Fixed `src/lib/server/acp/connection.ts` to send newline-delimited JSON over stdio for ACP adapters instead of LSP-style `Content-Length` frames, while still accepting `Content-Length` input for compatibility; this resolves Codex ACP initialization parse failures and removes silent `/acp new` hangs caused by transport mismatch |
| ENG-194 | Codex ACP auth preflight hinting | Done | Improved `src/lib/server/acp/service.ts` startup error reporting so Codex-like ACP targets now append a concrete auth hint when Molibot has neither `OPENAI_API_KEY` nor `CODEX_API_KEY`, clarifying that Telegram ACP cannot complete interactive `codex --login` and needs pre-provisioned host auth or target env credentials |
| ENG-221 | pi-ai 0.62 OAuth import compatibility fix | Done | Moved runtime OAuth helper imports in `src/lib/server/agent/auth.ts` from `@mariozechner/pi-ai` to `@mariozechner/pi-ai/oauth`, restoring production build compatibility after upgrading `pi-ai` to `0.62.x` |
| ENG-195 | Codex auth.json reuse + ACP startup timeout tuning | Done | Verified that Codex ACP can reuse local `~/.codex/auth.json` ChatGPT login state in a non-interactive process, then updated `src/lib/server/acp/service.ts` to detect file-based auth before warning about missing credentials and increased ACP startup timeouts (`initialize` 30s, `session/new` 60s) so Codex adapter warm-up no longer fails under transient model-refresh latency |
| ENG-196 | Telegram ACP status flood protection | Done | Hardened `src/lib/server/channels/telegram/formatting.ts` and `runtime.ts` so Telegram `429 Too Many Requests` with `retry_after` is retried correctly, ignorable `message is not modified` edits no longer bubble as fatal errors, and ACP task status updates are throttled plus wrapped in warning-only fallback logic instead of crashing the whole Node process |
| ENG-197 | ACP tool-event noise reduction | Done | Stopped emitting one Telegram message per completed ACP tool call in `src/lib/server/acp/service.ts`; Telegram now keeps permission/plan events but rolls tool activity into the final `/acp task` summary with completed/failed counts and touched file locations, preventing tool-call spam from flooding the chat |
| ENG-198 | ACP final-result Markdown structuring | Done | Updated Telegram ACP task dispatch in `src/lib/server/channels/telegram/runtime.ts` to automatically append output-format instructions that require concise Markdown sections (`Summary` / `Changes` / `Verification` / `Notes`), and reformatted the local task-finished summary into Markdown bullets so final responses render as readable structured reports instead of plain-text walls |
| ENG-199 | ACP session persistence and restore | Done | Added persisted ACP chat-session metadata under each Telegram bot workspace, taught `src/lib/server/acp/service.ts` to restore saved remote sessions through ACP `session/load`, and updated Telegram ACP commands to auto-restore on `/acp status`, `/acp task`, `/acp mode`, and `/acp cancel`, so service restarts no longer force a fresh `/acp new` when the remote Codex session still exists |
| ENG-200 | ACP available-commands object rendering fix | Done | Fixed ACP command parsing in `src/lib/server/acp/service.ts` so `availableCommands` arrays containing objects are normalized by `name`/`id` instead of `String(object)`, eliminating `/acp status` output like `[object Object]` and restoring readable command lists |
| ENG-201 | ACP sessions command | Done | Added `/acp sessions` command in Telegram runtime and ACP service support for `session/list`, with project-aware filtering and readable formatting, so operators can inspect restorable remote Codex sessions instead of relying only on implicit auto-restore |
| ENG-202 | ACP permission inline-card UX | Done | Reworked Telegram ACP permission handling from raw text instructions into inline button cards with one-tap approve/deny actions and a guided “deny with note” follow-up flow, while keeping legacy `/approve` and `/deny` commands as fallback |
| ENG-203 | Feature plugin MVP + Cloudflare HTML publish | Done | Added first-class built-in feature plugin plumbing, a configurable Cloudflare HTML publish plugin in `/settings/plugins`, system-prompt plugin guidance, and a `publish_html` agent tool that uploads complete HTML documents to Cloudflare R2 and returns the public link |
| ENG-203 | ACP execution-context output guardrail | Done | Updated Telegram ACP task prompt template to require a mandatory `Execution Context` section that prints raw runtime diagnostics (`pwd`, `ls -la`, python/uv resolution, DB env values, command + exit code), improving root-cause visibility when ACP execution differs from local terminal runs |
| ENG-204 | ACP stop command alias | Done | Added `/acp stop` command alias in Telegram ACP command router (same path as `/acp cancel`) and updated ACP help output so operators can immediately terminate running ACP tasks with a more intuitive stop action |
| ENG-237 | Cloudflare HTML plugin ownership cleanup | Done | Moved the Cloudflare HTML publish runtime action into `src/lib/server/plugins/cloudflareHtml/`, made the feature registry the only registration path, and split final-link settings to use a dedicated Worker base host while still reading older saved `publicBaseUrl` values |
| ENG-238 | Feature plugin dynamic settings form | Done | Feature plugins can now declare their own settings fields in the registry, and `/settings/plugins` renders/saves those fields dynamically instead of hard-coding a dedicated Cloudflare HTML form block |
| ENG-239 | Feature plugin subdirectory declarations | Done | Plugin-specific feature declarations now live inside each plugin subdirectory (`src/lib/server/plugins/<plugin>/plugin.ts`), while the root feature registry is reduced to a thin aggregator that imports and combines built-in plugins |
| ENG-240 | Cloudflare HTML Worker template | Done | Added a Worker-side HTML serving template under `src/lib/server/plugins/cloudflareHtml/worker/`, including the Worker source, example Wrangler config, and setup notes so the plugin ships both the upload side and the public-serving side together |
| ENG-241 | Cloudflare HTML Worker custom filename support | Done | Relaxed the Worker-side filename guard so public routes can serve normal safe `.html` names like `gold_daily_20260420_v5.html`, instead of only accepting one hard-coded random-name pattern |
| ENG-242 | Cloudflare HTML dual public-link modes | Done | Cloudflare HTML publish can now return either Worker-based links or direct public R2 links, with plugin settings and docs updated so operators can choose between the two without removing the optional Worker path |
| ENG-243 | Cloudflare plugin partial-update validation fix | Done | Fixed plugin settings validation so partial `plugins.cloudflareHtml` updates are merged with current saved values before required-field checks run, preventing false failures and `.trim()` crashes during incremental updates |
| ENG-266 | Cloudflare HTML file-path upload input | Done | Changed `publishHtml` to accept a local `filePath` instead of inline HTML content, so the tool reads and validates the file inside runtime, keeps workspace path-guard enforcement, and avoids pushing large HTML payloads into model context |
| ENG-235 | Weixin OGG voice auto-transcode | Done | Weixin outbound voice now detects Telegram-style `ogg/opus` files, converts them to `mp3` before upload, and then retries native Weixin voice delivery instead of treating them as unsupported binary blobs |
| ENG-236 | Weixin SDK import cleanup and install repair | Done | Removed all app-side `../../../../node_modules/...` Weixin SDK imports, switched Weixin channel code to normal SDK subpath imports, and added a postinstall repair script so the broken published package exports are fixed automatically after dependency install |
| ENG-205 | Skill protocol slimming + multiline frontmatter compatibility | Done | Prompt now prefers global `skill-creator` when `~/.molibot/skills/skill-creator/SKILL.md` exists, hides `Skill Diagnostics`, skill inventory no longer prints `base_dir`, and skill frontmatter parser now supports YAML block-style multiline `description` (`>` / `|`) across runtime and settings inventory |
| ENG-206 | Explicit slash skill invocation normalization | Done | Skill invocation detection now accepts direct slash form such as `/skill-name` and `/skill-name@bot`, matches normalized names case-insensitively (`space`/`_`/`-` treated equivalently), injects explicit invocation context into runner input, and keeps MCP skill-gating aligned with the same matcher |
| ENG-207 | Explicit skill path injection and SKILL.md execution guard | Done | Runner explicit-skill context now includes authoritative `name/scope/skill_file` fields to avoid global-path guessing for bot-scoped skills, and prompt skill protocol now explicitly forbids running `SKILL.md` via `sh/bash` directly (must read first, then execute documented scripts) |
| ENG-212 | ACP multi-provider adapter profiles and command unification | Done | Split ACP target behavior into explicit provider files for Codex and Claude Code, added `adapter` metadata plus dual built-in presets, removed Codex-only project defaults/auth branching from the service layer, and standardized Telegram/UI exposure so the public control surface stays `/acp ...` while provider-specific remote commands are shown with prefixes like `codex:/...` and `claude-code:/...` |
| ENG-213 | ACP remote command execution entrypoint | Done | Added Telegram `/acp remote <command> [args]` command and ACP-side provider-aware remote-command resolution/validation, so operators can execute adapter-reported remote commands directly with unified syntax while still distinguishing providers via `codex:/...` or `claude-code:/...` prefixes |
| ENG-214 | ACP active-session default proxy mode | Done | Added Telegram ACP auto-proxy middleware so when a chat has an active ACP session, all non-control text (including slash commands like `/help`) is forwarded directly to the active Codex/Claude ACP session; `/acp ...`, `/approve ...`, and `/deny ...` stay as reserved control commands, and `/acp close` exits proxy mode |
| ENG-215 | ACP all-channel runtime support | Done | Extended ACP from Telegram-only to Telegram, Feishu, and QQ runtimes, moved ACP task prompt policy into a shared ACP module, added channel-level `/acp` / `/approve` / `/deny` command handling plus active-session default proxy mode in Feishu and QQ, and updated the ACP operator doc to describe channel-wide behavior instead of Telegram-only behavior |
| ENG-216 | Weixin ACP parity | Done | Added ACP support to the Weixin runtime so it now matches Telegram, Feishu, and QQ with `/acp` / `/approve` / `/deny`, active-session default proxying, remote command execution, approval handling, and updated channel-wide ACP documentation |
| ENG-217 | ACP shared channel control layer | Done | Centralized ACP slash-command parsing, approval handling, reserved-control detection, and channel help lines into a shared channel controller so Telegram, Feishu, QQ, and Weixin now use one ACP behavior core instead of copy-pasted per-channel command logic |
| ENG-218 | ACP text-channel template | Done | Added a reusable ACP channel template for text-oriented runtimes and moved Weixin, QQ, and Feishu to that template so future channel onboarding only needs message I/O wiring instead of rebuilding ACP proxy/control flow |
| ENG-219 | Weixin inbound media intake parity | Done | Weixin runtime now parses raw `item_list` media payloads, downloads/decrypts inbound image/file/voice/video attachments from the Weixin CDN, stores them in the chat workspace, feeds images into vision input, and no longer drops attachment-only messages as empty text |
| ENG-220 | Weixin inline voice-text STT skip | Done | When a Weixin voice message already carries built-in text content, runtime now marks it as already transcribed and skips the second STT pass, avoiding redundant tool churn and failed `.silk` re-decoding attempts |
| ENG-231 | Weixin outbound image/voice media delivery | Done | Replaced the fake `[file] path` fallback in Weixin uploads with real CDN-backed media sending: images now go out as native image messages, audio tries native voice first with file fallback, and other binaries send as actual file attachments |
| ENG-232 | Skill-first prompt routing and slash-alias hardening | Done | Removed hardcoded skill-name assumptions from the runtime prompt, added general explicit-skill rules adapted from the Claude-style skill semantics, and fixed slash invocation matching to honor both `SKILL.md` `name` and skill directory aliases so runtime can pass the exact `skill_file` path instead of guessing |
| ENG-233 | Tool-priority and memory-governance prompt upgrade | Done | Upgraded runtime/tool templates with dedicated-tool-first execution rules (`read/edit/write/create_event/memory` before bash), parallel-call guidance, and practical memory governance constraints (what to store, what not to store, stale-memory verification) adapted from the Claude-style guidance but aligned to Molibot runtime tools |
| ENG-234 | Prompt mainline reordering and dynamic payload compression | Done | Reordered runtime prompt so execution rules/tooling/skill policy appear before environment noise, compacted the injected skill inventory into a short index, and trimmed current-memory injection into a bounded snapshot so the model sees the stable high-value instructions first |
| ENG-237 | Memory write-time classification and prompt filtering | Done | Added shared memory classification so new memories are auto-tagged on write, flush/import paths reuse the same classifier, and prompt injection now prioritizes collaboration/project/reference memories while isolating lifestyle and temporary records unless the current query actually needs them |
| ENG-238 | General-agent prompt hardening | Done | Filled non-coding prompt gaps by adding task-framing, freshness verification, external-content injection resistance, and broader action-confirmation rules so Molibot behaves more like a reliable general-purpose agent instead of a file-centric coding assistant |
| ENG-242 | Weixin inbound voice/file media fallback hardening | Done | Weixin inbound media intake now no longer drops voice/file/video items when `media.aes_key` is absent or when the SDK payload provides only hex `aeskey`; it falls back to plain CDN download or hex-key normalization so real user voice/file messages reach the agent |
| ENG-243 | Channel-agnostic attachment tool wording | Done | Fixed the runtime attachment tool description so it no longer falsely says files can only be sent to Telegram; this prevents the agent from misreading Weixin/QQ/Feishu as attachment-incapable and refusing image/audio/file replies |
| ENG-246 | System prompt skill-first routing optimization | Done | Merged Task Framing + Capability Use Order + Skill Routing into unified Message Processing Pipeline with CRITICAL markers; skill matching elevated to Step 0; enhanced Tools section with mapping table; deduplicated Skills Protocol from ~60 to ~15 lines; simplified TOOLS.template.md (91→31 lines) and IDENTITY.template.md (34→23 lines) |
| ENG-244 | Weixin outbound CDN upload diagnostics | Done | Expanded Weixin media-upload failures with concrete request context (source file, media type, host/path, key/size summary) so blank 400 responses from the CDN can be diagnosed instead of collapsing into an empty generic error |
| ENG-245 | Explicit skill file injection in shared runner | Done | Shared agent runner now injects the actual `SKILL.md` content for explicitly-invoked skills into the turn input, so all channels use the same hard skill context instead of trusting the model to honor only a skill name/path marker |
| ENG-246 | Image skill output-path hardening and bash output compression | Done | Tightened the shared image-generation skill to require outputs under the active chat workspace instead of `/tmp` or the skill directory, and changed bash output compression to keep both the start and end of long logs while collapsing noisy carriage-return progress spam |
| ENG-247 | Image skill path portability cleanup | Done | Removed machine-specific absolute paths from the shared `image-generate` skill and changed it to require the caller to pass the output path explicitly, so the skill remains reusable across different users and runtimes |
| ENG-248 | Weixin full upload-parameter diagnostics | Done | Added full local diagnostics for Weixin media upload: request body sent to `getuploadurl`, returned upload parameters, exact CDN upload URL/headers, and chunked raw response body, so blank 400 failures can be inspected from logs instead of inferred indirectly |
| ENG-249 | Weixin CDN upload protocol alignment | Done | Corrected Weixin media upload to follow the documented protocol: CDN requests now use `encrypted_query_param` instead of the wrong query key, stop sending the extra file-key header, and read the returned media token from the `x-encrypted-param` response header before falling back to body parsing |
| ENG-250 | Shared text-channel runtime skeleton refactor | Done | Added shared runtime skeleton/helpers under `src/lib/server/channels/shared/`, moved Feishu/QQ/Weixin onto the shared queue/dedupe/stop/prompt-preview/context path, and switched Telegram onto the shared safe skeleton pieces only so channel-specific streaming/interactive behavior stays intact |
| ENG-251 | Weixin outbound delivery audit and retry | Done | Added structured Weixin outbound send attempt/success/failure logs, automatic retry for transient `sendmessage` failures, and per-chat `delivery.jsonl` records so “model finished but user received nothing” cases can be traced without digging through session context files |
| ENG-252 | Prompt layering hardening with project-context discovery | Done | Upgraded prompt assembly with identity-first layering (`SOUL.md`/`IDENTITY.md`), workspace project-context priority discovery (`.hermes.md -> AGENTS.md -> CLAUDE.md -> .cursorrules`) plus injection scan/truncation, short-TTL skills index cache for prompt rendering, and expanded prompt-source observability (`identity_sources` / `project_context_sources`) |
| ENG-240 | Profile template deduplication and noise reduction | Done | Tightened AGENTS/IDENTITY/SOUL/USER/BOOTSTRAP templates so each file owns a single responsibility, removed repeated runtime rules from profile templates, reduced low-value lifestyle/default-init noise, and kept only the long-term collaboration signals that help a general-purpose agent stay stable |
| ENG-241 | Skill/tool-before-coding decision order | Done | Tightened runtime prompt and tool template rules so outcome requests such as voice/image/search/reminder are treated as requests to use existing capabilities first; the agent must try installed skills or dedicated tools before considering code changes, and a missed first attempt no longer justifies jumping straight into implementation |
| ENG-239 | Weixin SDK migration off buggy npm package | Done | Removed the `@pinixai/weixin-bot` dependency entirely, vendored a local Weixin SDK bridge under `src/lib/server/channels/weixin/sdk/`, and rewired runtime/media/outbound paths to use that bridge instead of the buggy old npm package |
| ENG-240 | Weixin command-reply userId fix after SDK migration | Done | Fixed the migrated Weixin command layer to reply using the actual `userId` field on incoming messages instead of the old nonexistent `sender.id`, which was crashing slash-command handling right after startup |
| ENG-222 | Agent tool safety preflight + serialized mutators | Done | Added unified runtime tool-policy checks in `src/lib/server/agent/toolPolicy.ts` and wired `runner.ts` + `tools/index.ts` so destructive bash commands, secret/settings/auth file edits, and reminder-like memory writes are blocked before execution, while mutating tools (`bash`/`edit`/`write`/`switch_model`/`load_mcp`/event/mutating memory ops) are serialized instead of racing in parallel |
| ENG-223 | Model responsibility routing hardening | Done | Tightened `runner.ts` custom-model selection so text turns only choose text-capable models, vision turns only choose vision-capable models, same-provider fallbacks stay capability-aligned, and Agent session/transport are now refreshed per active route/model to better match upgraded `pi-agent-core` provider caching and transport behavior |
| ENG-224 | Agent transport and retry-cap integration | Done | Added shared runtime Agent options in `src/lib/server/agent/runtimeOptions.ts` and wired both `runner.ts` and `assistantService.ts` to use upgraded `pi-agent-core` transport selection plus `maxRetryDelayMs`, so Codex-capable models can opt into automatic transport choice while long hidden provider retry sleeps are capped consistently across chat entry points |
| ENG-227 | Web thinking controls and visible reasoning trace | Done | Web chat now exposes per-send thinking level selection (`off/low/medium/high`), sends that level with requests, and shows request/payload diagnostics plus captured thinking text so operators can verify whether reasoning was requested and actually streamed |
| ENG-228 | Runner delta-stream bridge for Web and Telegram | Done | Runner now forwards assistant `message_update` deltas instead of waiting for final `message_end`, `/api/stream` uses the real runner path for SSE streaming, Web keeps thinking details above the answer in a collapsible panel, and Telegram batches live edits, avoids duplicate fallback sends, and logs effective thinking settings for each run |
| ENG-229 | Telegram session status + per-session thinking override | Done | Telegram now exposes `/status` and `/state` to show active session/runtime/model/thinking state, and `/thinking <default|off|low|medium|high>` to override thinking only for the current session without changing the global default or future new sessions |
| ENG-230 | Shared channel command and session-control layer | Done | Moved public text-channel commands (`/new`, `/clear`, `/sessions`, `/delete_sessions`, `/models`, `/compact`, `/login`, `/logout`, `/skills`, `/status`, `/state`, `/thinking`, `/help`) into `src/lib/server/agent/channelCommands.ts`, so Telegram/Feishu/QQ/Weixin now keep channel-local intake/delivery logic while shared session/model/thinking handling lives in the agent core |
| ENG-268 | Runner budget and structured run summary | Done | Added run-level tool/model budget limits, failure-stop handling, per-chat `run-summaries.jsonl` logging, and a unified closing summary message in `src/lib/server/agent/runner.ts` / `store.ts` |
| ENG-269 | Skill draft management and post-run workflow capture | Done | Added `skill_manage` tool plus automatic reusable workflow draft generation under `skill-drafts/` after complex successful runs, and updated prompt rules so validated workflows can be drafted before becoming live skills |
| ENG-270 | Memory snapshot prompt freezing and richer run reflection | Done | Each run now freezes one memory snapshot before prompt assembly, uses that fixed snapshot for the whole run, and records richer reflection fields in run summaries including memory counts, outcome classification, and next-action guidance |
| ENG-271 | Memory write governance and draft-to-skill promotion | Done | Added explicit memory write rejection rules for reminders, transient run logs, bare links, and todo-style notes; `skill_manage` now supports promoting reviewed drafts into live skills without carrying draft-only metadata |
| ENG-272 | Self-evolution review pages for runs and drafts | Done | Added Settings pages and APIs to inspect recent run history, review saved skill drafts, edit draft content, and promote reviewed drafts into live skills from the UI |
| ENG-273 | Skill draft generation rules and workflow-skill binding | Done | Added configurable auto-save rules on `/settings/skill-drafts`, requiring a standard workflow `SKILL.md` path before auto generation can be enabled and making new drafts follow that workflow's structure |
| ENG-273 | Similar-case draft merge and memory rejection review | Done | Similar workflow drafts and matching live skills now merge instead of creating near-duplicate files, and blocked memory writes are recorded to a governance log with a dedicated Settings review page |

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

## Update Log
- 2026-04-11: Added automatic similar-case merging for self-evolution artifacts. New workflow drafts now reuse and update a matching draft instead of creating duplicate files, promoted skills can merge into an existing similar skill, and draft review now shows how many cases have been merged into one entry.
- 2026-04-11: Added memory-governance rejection logging under `memory-governance/rejections.jsonl` plus `/settings/memory-rejections`, so blocked memory writes can be reviewed by reason, content, source scope, and action type instead of disappearing as one-off errors.
- 2026-04-11: Added Settings review surfaces for self-evolution data. `/settings/run-history` now shows per-chat run outcomes, follow-up suggestions, tool usage, and saved draft links from `run-summaries.jsonl`; `/settings/skill-drafts` lists saved workflow drafts, allows inline edits, and can promote reviewed drafts into chat/bot/global skills through `/api/settings/skill-drafts`.
- 2026-04-19: Added configurable draft-generation rules on `/settings/skill-drafts`. Automatic draft generation now requires a standard workflow `SKILL.md` path before it can be enabled, uses that workflow as the structure source for new drafts, and enforces the configured minimum tool-call threshold instead of letting recovery cases bypass it.
- 2026-04-11: `src/lib/server/agent/reviewData.ts` now scans bot/chat workspaces for run summaries and skill drafts, while `store.ts` stamps each appended run summary with `createdAt` so operator review pages can sort records by real run time.
- 2026-03-31: Upgraded prompt builder layering in `src/lib/server/agent/prompt.ts`: split identity files from generic instruction overlays, inserted workspace project-context discovery with safety scanning and truncation before injection, and added short-TTL skills formatting cache to reduce repeated skill tree scans during rapid prompt refresh cycles.
- 2026-03-31: Expanded prompt preview source metadata in `src/lib/server/channels/shared/baseRuntime.ts` to include `identity_sources` and `project_context_sources` for easier runtime prompt debugging.
- 2026-03-31: Expanded Settings tasks inventory from Telegram-only to all built-in channels. `/api/settings/tasks` now scans `${DATA_DIR}/moli-t|moli-f|moli-q|moli-wx/bots/**/(events|*/scratch/events)`, validates paths per channel root, and routes manual trigger requests to the matching channel manager instead of hardcoding Telegram.
- 2026-03-31: Updated `/settings/tasks` UI to show channel dimension and channel-level task counts, so operators can distinguish Telegram/Feishu/QQ/WeChat tasks in one page.
- 2026-03-31: Added runtime manual-task trigger entrypoints for QQ/Feishu/Weixin channel managers, aligning Settings “Retry Now / Send Selected” behavior beyond Telegram.
- 2026-03-29: Hardened Python sandbox execution in `bash` tool: added shell-level binding so `python/pip/pip3` always use the same sandbox interpreter, auto-runs `ensurepip` when sandbox pip is missing, disables strict `PIP_REQUIRE_VIRTUALENV` false negatives, and strips `--break-system-packages` to keep dependency install commands working inside sandbox venv.
- 2026-03-29: Fixed Telegram “retry scheduled but still hangs” behavior by adding per-attempt timeout (12s default) in the shared Telegram API retry path. `editMessageText`/`sendMessage`/`sendChatAction` now fail fast on slow/hung network calls and continue retrying automatically instead of waiting forever on a single stalled request.
- 2026-03-29: Added dedicated `profile_files` tool for bot profile operations. The agent can now read, bootstrap, overwrite, and patch bot-level `BOT.md`/`SOUL.md`/`USER.md`/`TOOLS.md`/`IDENTITY.md`/`SONG.md`; when a bot file is missing it auto-inherits from agent first, then global. Also expanded bot profile file whitelist to include `USER.md` and `TOOLS.md`.
- 2026-03-29: Added a unified Python sandbox for the agent `bash` tool. Every bash execution now injects the same dedicated virtualenv (`~/.molibot/tooling/python/venv`) into PATH/environment, auto-creates it when missing, and routes `python/pip/uv` to that location with shared cache dirs to avoid global Python pollution and per-directory env drift.
- 2026-03-26: Optimized system prompt architecture for skill-first routing: merged three separate decision sections (Task Framing, Capability Use Order, Skill Routing) into a unified Message Processing Pipeline with CRITICAL markers so skill matching runs before tool matching; enhanced Tools section with explicit mapping table + parameter reference; deduplicated Skills Protocol section; simplified TOOLS.template.md and IDENTITY.template.md to remove overlap with prompt.ts and SOUL.md.
- 2026-03-26: Fixed a Weixin post-migration crash in slash-command replies. The new local Weixin message shape exposes `userId`, not `sender.id`; command responses now use the real field so `/help`, `/new`, `/status` and similar commands no longer throw immediately on receipt.
- 2026-03-26: Replaced the old `@pinixai/weixin-bot` dependency with a project-local Weixin SDK bridge under `src/lib/server/channels/weixin/sdk/`, using the newer `weixin-agent-sdk` style login/polling flow as the base. Weixin runtime, media intake, and outbound sending no longer depend on the buggy old npm package or its install-time repair script.
- 2026-03-25: Fixed Weixin voice replies for Telegram-style `ogg/opus` TTS output. The channel now auto-converts those files to `mp3` before attempting a native Weixin voice reply, which avoids feeding Weixin an `Ogg/Opus` voice file it does not natively accept on this path.
- 2026-03-25: Fixed Weixin outbound media delivery. Root cause was the channel upload hook only trying UTF-8 text passthrough and otherwise replying with a literal `[file] /path/to/file` string, so images and audio were never uploaded to Weixin at all. Added CDN-backed outbound upload/send flow so images are sent natively, audio attempts native voice first with file fallback, and other binaries go out as real file attachments.
- 2026-03-25: Centralized public text-channel command handling into `src/lib/server/agent/channelCommands.ts`, rewired Telegram/Feishu/QQ/Weixin to use the shared layer, preserved Telegram-specific `/chatid` plus platform reply behavior, and removed duplicate per-channel copies of session/model/thinking command logic.
- 2026-03-22: Added WeChat channel support through the published npm package `@pinixai/weixin-bot`. The package installs successfully from npm, but version `1.2.0` ships `src/*` without the `dist/index.js` entry declared in `package.json`, so Molibot now imports the package-shipped source entry instead of a local sibling repository path. The runtime still uses npm-installed SDK code, with built-in `weixin` plugin registration, `/settings/weixin`, QR-login startup, and shared session/model/skills commands.
- 2026-03-22: Fixed production build break for WeChat integration by adding a Vite alias that resolves `@pinixai/weixin-bot/src/index` to the npm-installed package source file directly. This avoids the package export check that fails because `@pinixai/weixin-bot@1.2.0` declares a missing `dist/index.js`.
- 2026-03-22: Added a login-link QR generator to `/settings/weixin`. You can now paste the WeChat SDK login URL from the service log into the page and get a browser-rendered QR code immediately, without needing to open or forward the link manually.
- 2026-03-15: Added `/acp sessions` command backed by ACP `session/list`, including target/project context and current-session markers for faster manual recovery after service restarts.
- 2026-03-20: Fixed periodic same-minute duplicate execution loop in `src/lib/server/agent/events.ts` by introducing pre-dispatch `running` lock state, same-slot dedupe keys (`runningSlotKey`/`lastSlotKey`), run-id guarded completion/error writes, and stale-running lease timeout release; added rollback env switch `EVENT_RUNNING_LOCK_ENABLED` (`MOLIBOT_EVENT_RUNNING_LOCK_ENABLED`) plus settings task status support for `running`.
- 2026-03-20: Fixed bot profile prompt merge gap in `src/lib/server/agent/prompt.ts`: `BOT.md` is now part of prompt section merge order, so bot-level instructions are included in final system prompt (not just detected in source listing).
- 2026-03-20: Added editable task operations in Settings: `/api/settings/tasks` now supports `action:"update"` with type-aware validation for `one-shot/periodic/immediate` fields, and `/settings/tasks` now provides inline row editing (`Edit/Save/Cancel`) for task text, delivery mode, and schedule/timezone.
- 2026-03-20: Fixed Svelte build warning in `/settings/tasks` by changing edit-mode task text input from self-closing `<textarea />` to explicit `<textarea></textarea>`, ensuring SSR/client builds stay warning-free under `vite-plugin-svelte`.
- 2026-03-15: Reworked Telegram ACP permission prompts into inline action cards with approve/deny buttons and a guided “deny with note” flow; raw `/approve` and `/deny` text commands remain available as fallback.
- 2026-03-15: Added mandatory ACP execution-context diagnostics in `/acp task` output template (`pwd`, `ls`, python/uv resolution, DB env values, exact command and exit code) so terminal-vs-ACP environment mismatches are visible in one response.
- 2026-03-15: Added `/acp stop` as an immediate-stop alias for `/acp cancel`, and updated ACP help text so operators can quickly terminate running ACP tasks.
- 2026-03-15: Fixed ACP `availableCommands` normalization to handle object-form command entries from Codex ACP (`name`/`id`), so `/acp status` no longer shows `[object Object]` for available commands.
- 2026-03-15: Added ACP session persistence and restore. Telegram bot workspaces now keep chat-to-remote-session metadata on disk, and ACP commands auto-reload the prior remote session after Molibot restarts when Codex still has that session available.
- 2026-03-15: Improved ACP final response readability by forcing structured Markdown output requirements on `/acp task` and converting the local completion summary to Markdown bullet sections before sending to Telegram.
- 2026-03-15: Reduced ACP Telegram noise by suppressing per-tool completion event messages and replacing them with a single final task summary containing tool counts plus touched locations.
- 2026-03-15: Fixed Telegram ACP status-update crash path by teaching `src/lib/server/channels/telegram/formatting.ts` to honor `429 retry_after`, ignore harmless `message is not modified` edit errors, and throttling ACP status edits in `src/lib/server/channels/telegram/runtime.ts` so Telegram rate limits no longer terminate the bot process.
- 2026-03-15: Verified `~/.codex/auth.json` is reusable by Codex ACP without API keys and updated ACP startup logic to treat file-based auth as valid, while increasing `initialize` / `session/new` timeouts in `src/lib/server/acp/service.ts` to better tolerate Codex model-refresh warm-up.
- 2026-03-14: Added Codex ACP auth hinting in `src/lib/server/acp/service.ts`; when a Codex-like target times out during startup and Molibot has no `OPENAI_API_KEY` / `CODEX_API_KEY`, the returned error now explains that Telegram ACP cannot perform interactive login and needs target env credentials or pre-provisioned host auth.
- 2026-03-14: Fixed ACP stdio transport framing in `src/lib/server/acp/connection.ts` to send newline-delimited JSON requests instead of `Content-Length` frames, matching Codex ACP adapter expectations and resolving `failed to parse incoming message` startup errors on `/acp new`.
- 2026-03-14: Added Linus Torvalds-inspired personality templates (`IDENTITY.linus.template.md` and `SOUL.linus.template.md`) to provide a blunt, technical-first agent profile option.
- 2026-03-14: Fixed shared `Button` event forwarding by adding native click forwarding in `src/lib/ui/Button.svelte`, which restores ACP `Add Project` and other settings-page actions implemented through `<Button on:click={...}>`.
- 2026-03-14: Added `/settings/acp` web configuration page with structured target/project editors, default approval mode controls, absolute-path project allowlist management, and Settings navigation/overview entry for ACP operations.
- 2026-03-14: Added Codex ACP MVP documentation at `docs/requirements/acp-multi-provider-mvp.md`, persisted ACP settings (`targets` + registered projects), and introduced Telegram `/acp` / `/approve` / `/deny` command flow for chat-scoped ACP coding sessions with live status updates, project allowlisting, and Telegram-mediated permission approvals.
- 2026-03-14: Added Telegram per-bot stream output toggle. `/settings/telegram` now exposes `Enable streaming output (default on)`, persisted in channel-instance credentials as `streamOutput`, and runtime now supports two modes: stream-on incremental `editMessageText` updates and stream-off final one-shot output.
- 2026-03-14: Added bot-dimension usage analytics. `AiUsageTracker` now records and aggregates `botId` (with backward-compatible fallback for historical logs), channel runner usage writes include workspace-derived bot ID, web writes use `web`, and `/settings/ai/usage` now supports bot filtering and “Bots Used” ranking for cross-bot consumption comparison.
- 2026-04-21: Fixed `/settings/ai/usage` visual contrast under the shared settings skin so accent icons, token badges, and Usage Timeline bars render with clear green highlights instead of collapsing into near-background black/white.
- 2026-04-25: Rebuilt `/settings/ai/usage` as an observability dashboard using existing usage records only: summary cards, request/token trends, token-type distribution, API/model/bot/channel breakdowns, and recent event rows; omitted cost, latency, success-rate, and auth-index modules because this tracker does not record those fields.
- 2026-04-25: Polished `/settings/ai/providers` and `/settings/ai/errors`. Provider save/default-model controls now sit at the top of the edit pane, new custom providers and models are inserted first, and Model Error Logs now uses a denser failure-radar layout with summary cards, filters, provider ranking, and failure detail cards.
- 2026-05-12: Fixed manual `/compact` false negatives caused by an oversized `keepRecentTokens` setting. Explicit manual compaction now summarizes an older slice even below that keep window, while threshold/overflow compaction keeps the conservative automatic behavior.
- 2026-05-11: Fixed manual `/compact` to resync idle runner state from the latest persisted session before summarizing, so `/status` token counts and `/compact` eligibility no longer drift apart after runner/store desync.
- 2026-03-14: Reworked session persistence from snapshot-only context storage to append-only per-session entry logs (`contexts/<sessionId>.jsonl`) with legacy migration, rebuilt-context loading, and structured compaction entries.
- 2026-03-14: Added shared OAuth auth handling in `src/lib/server/agent/auth.ts`. Runtime now resolves credentials from `${DATA_DIR}/auth.json` (or `PI_AI_AUTH_FILE`), refreshes OAuth-backed keys on demand, and exposes `/login` / `/logout` commands in web/Telegram/Feishu/QQ.
- 2026-03-14: Upgraded context compaction to a recoverable retry flow. Runner now records compaction token metadata and automatically compacts + retries when upstream models reject a request for context/window overflow.
- 2026-03-13: Added cross-provider model fallback in `src/lib/server/agent/runner.ts` and `src/lib/server/providers/assistantService.ts`, so retryable model failures now automatically switch to alternative providers and surface provider/model/baseUrl in aggregated error output.
- 2026-03-13: Added web runtime command short-circuit in `src/routes/api/chat/+server.ts` and `src/routes/api/stream/+server.ts`, so `/models`, `/skills`, and `/help` use direct settings/skill data access instead of consuming an LLM turn.
- 2026-03-10: Added true periodic-task update semantics in `create_event`: same `chatId + schedule + timezone` now updates existing event file in place (no new duplicate file), and historical duplicates are automatically marked `completed` (`superseded_by_update`) to prevent multi-fire repeats.
- 2026-03-10: Changed image routing to trust explicitly declared custom-model `vision` capability for native multimodal input, so verified-failed/untested states no longer force unnecessary separate image-analysis fallback calls when the operator already selected a vision-capable main model.
- 2026-03-10: Enriched Telegram transport failure logs with nested fetch/socket cause details to diagnose `sendChatAction` network failures beyond the generic grammY wrapper message.
- 2026-03-10: Hardened Telegram media handling by adding transient retry for `sendChatAction`/status edits and showing an early reusable `Recognizing image/audio` status before runner thinking starts.
- 2026-03-08: Fixed `/settings` Overview card readability in dark mode by replacing hardcoded low-contrast gray description text (`text-slate-400`) with theme-aware muted foreground tokens, improving accessibility and preserving theme consistency.
- 2026-03-13: Added minimal conversation context compaction. Runtime now estimates context size, summarizes older turns into a compact continuation note when the active model window nears exhaustion, persists the compacted session back to per-session context JSON, exposes manual `/compact [instructions]` commands in web/Telegram/Feishu/QQ, and adds AI Routing settings for `enabled`, `reserveTokens`, and `keepRecentTokens`.
- 2026-03-08: Fixed theme contrast/selection issues on `/settings/ai/providers`: non-selected provider cards now use neutral card background while only selected item is highlighted; provider search/input borders now use weaker `--input` border with softer focus ring; and `text-slate-100` labels (for example plugin tags like `JSON File`) are mapped to readable foreground color in light mode.
- 2026-03-08: Replaced UI tokens with a Solar Dusk palette (based on user-provided target style), tuned input/border/muted contrast for readability, and added `tailwind.config.cjs` variable mapping for `background/foreground/card/popover/primary/secondary/muted/accent/sidebar/chart` token consistency.
- 2026-03-08: Strengthened Settings light-theme coverage across AI Engine / Channels / Agent Data / System by promoting token overrides to high priority, removing gradient rendering under `settings-theme`, and raising secondary text contrast so light mode remains readable on dense config pages.
- 2026-03-08: Fixed bot-scoped skills persistence by skipping legacy workspace-skills migration for bot workspaces (`.../moli-*/bots/<botId>`), preventing startup from moving files out of `${workspaceDir}/skills`.
- 2026-03-08: Unified skills scope semantics across loader/runtime/settings UI to `global` / `bot` / `chat` (removed `workspace-legacy` wording), and exposed Bot skills directory in Telegram/Feishu/QQ `/skills` diagnostics.
- 2026-03-08: Updated prompt/tooling declarations (`src/lib/server/agent/prompt.ts`, `src/lib/server/agent/prompts/TOOLS.template.md`, and `~/.molibot/TOOLS.md`) so skills path guidance is consistent with actual runtime loading order and directory semantics.
- 2026-03-08: Improved readability/contrast for themed UI by increasing muted/input token contrast in `src/styles/theme.css`, added settings-header theme/language switch controls, and strengthened `settings-theme` token mappings (`slate/sky/emerald/rose` text-border-bg + input focus colors) so all settings subpages remain legible in both light and dark modes.
- 2026-03-08: Replaced web chat hardcoded dark palette with tokenized theme variables from `src/styles/theme.css` (based on user-provided palette), added runtime theme mode switching (`system/light/dark`) and language switching (`zh-CN`/`en-US`) in chat header, and persisted both via localStorage so future theme replacement only requires editing one theme file.
- 2026-03-08: Completed settings-wide theme application by introducing a scoped `settings-theme` skin in `src/app.css` and converting settings layout shell to token-based colors, so existing settings pages inherit light/dark token colors without rewriting each page file; removed chat gradient overlay and switched chat background to pure token color.
- 2026-03-08: Fixed README architecture visibility issue reported by user. Replaced Mermaid HTML line-break label with plain-text labels and added a static fallback image `docs/images/molibot-architecture.svg` directly under the Mermaid block.
- 2026-03-08: Enhanced README scannability with status badges, a table of contents, and a concise product-surface matrix (`Web/Telegram/Feishu/CLI`) so readers can quickly understand maturity and entry points.
- 2026-03-08: Reworked `readme.md` visual structure by referencing the presentation style of similar lightweight assistant projects (hero + highlights + architecture diagram + feature snapshot + quick start). Kept claims aligned to actual Molibot capabilities and current implementation boundaries.
- 2026-03-07: Simplified Web Chat identity model to profile-only. Removed `userId` from chat-page local storage/state and request payloads, removed User ID input from New Chat dialog, and kept session creation scoped only by selected Web Profile.
- 2026-03-07: Rewrote `readme.md` as a practical onboarding document covering installation, configuration, startup commands, first-time setup order, full feature map, settings navigation, data structure, and common environment variables.
- 2026-03-07: Improved New Chat identity UX in chat page. The New Chat dialog now includes a dedicated Web Profile dropdown (showing profile names/ids from Settings) and no longer uses the old user-ID datalist as the primary selector, preventing confusion from opaque random-looking IDs.
- 2026-03-07: Fixed Telegram new-bot save target drift when editing draft `Bot ID`. Root cause was selection tracking by mutable `id`, which could desync and fall back to first row (`default`) on save. Added selected-bot resolver + reactive selection recovery in `/settings/telegram` so save always targets the active draft.
- 2026-03-07: Reworked Settings save flow to entity-scoped writes. Added `/api/settings/agent` and tightened `/api/settings/channel-instance` patch shape, then updated `/settings/agents`, `/settings/web`, `/settings/telegram`, and `/settings/feishu` to save only the currently selected record (no full-list payload, no per-item file-save loops). Added unsaved-change guard on selection switch with "save before switch" confirmation.
- 2026-03-07: Fixed a second image-fallback bug in long-lived sessions. Root cause was historical `type:"image"` parts (for example from prior `read` tool results) remaining in agent context, so later requests still sent image content to text-only models even when the current user turn had already been converted into `[image analysis #N: ...]`; `runner.ts` now gives custom models an accurate `input` capability and strips image parts from history before calling text-only models.
- 2026-03-06: Added runner-side image fallback preprocessing. Introduced `src/lib/server/agent/vision-fallback.ts` to resolve a custom vision route and convert images into structured text analysis when native image input is unavailable, updated `src/lib/server/agent/runner.ts` to inject `[image analysis #N: ...]` blocks alongside existing voice transcript fallback behavior, and updated prompt/logging rules so text-only models stop guessing from attachment paths.
- 2026-03-06: Fixed built-in provider enable toggle not persisting after save. Root cause was runtime sanitize path rebuilding `customProviders` without carrying `enabled`; this now persists `enabled` correctly and default custom provider resolution now prefers enabled providers.
- 2026-03-06: Fixed settings sidebar active state mismatch in two steps. `/settings/+layout.svelte` now normalizes trailing slashes, uses strict exact matching for sibling section tabs, computes link classes directly from `$page.url.pathname`, and keys sidebar rendering by pathname to force reliable active-style refresh after route switches.
- 2026-03-06: Adjusted built-in provider default state to `disabled`. For providers with missing historical `enabled` field, known built-ins now default to off while non-built-in custom providers keep previous default-on behavior; applied in both server-side settings sanitize and AI settings page/routing load mapping.
- 2026-03-06: Reimplemented `update-provider` settings/config migration on `master` (without merging and without agent changes). Added `customProviders[].enabled` to settings schema/default/sanitize flow, updated `/settings/ai/providers` for built-in vs custom provider management and auth guidance, updated `/settings/ai/routing` and web model selection to ignore disabled providers, and updated `/api/settings/ai-meta` template defaults. Verified with `npm run build`.
- 2026-03-03: Fixed new-machine Mory startup failure. `initDb()` now creates `${DATA_DIR}/memory`, `MoryMemoryBackend` ensures the DB parent directory exists, and `package/mory`'s `NodeSqliteDriver` now creates parent directories for file-backed SQLite paths before opening the database. Verified with `npm run build`.
- 2026-03-03: Added runtime AI token accounting. Introduced `src/lib/server/usage/tracker.ts` with append-only JSONL storage under `~/.molibot/usage/ai-usage.jsonl`, recorded usage from both `AssistantService` (web/API path) and `MomRunner` (Telegram/Feishu agent path), added `GET /api/settings/usage`, and surfaced token analytics in `/settings/ai`. Verified with `npm run build`.
- 2026-03-03: Added a unified safe runtime model-switch path. Extracted shared model option/switch logic into `src/lib/server/settings/modelSwitch.ts`, added narrow API `POST /api/settings/model-switch`, wired Telegram and Feishu `/models` commands to the shared flow, added agent `switch_model` tool, and blocked direct `settings.json` shell edits in the generic `bash` tool. Verified with `npm run build`.
- 2026-03-02: Added concise responsibility comments to Telegram/Feishu runtime entry files and expanded README with a directory guide for the new module layout.
- 2026-03-02: Extracted duplicated Telegram/Feishu channel queue and STT core logic into `src/lib/server/channels/shared/{queue,stt}.ts`; Telegram and Feishu now keep only thin channel wrappers plus Feishu-specific audio filename/MIME normalization. Verified with `npm run build`.
- 2026-03-02: Performed low-risk Feishu runtime modularization: extracted `queue.ts` and `messaging.ts` from `src/lib/server/channels/feishu/runtime.ts` while keeping the main runtime as the orchestration entry. Verified with `npm run build`.
- 2026-03-02: Performed low-risk Telegram runtime modularization: extracted `queue.ts`, `formatting.ts`, `stt.ts`, and `types.ts` from `src/lib/server/channels/telegram/runtime.ts`. This keeps the main runtime as the orchestration entry while moving isolated leaf logic out first. Verified with `npm run build`.
- 2026-03-03: Completed Feishu outbound media support: `uploadFile` is no longer a stub. Feishu runtime now supports file delivery, native image sending, best-effort audio/media sending with file fallback, text-file passthrough for small UTF-8 content, and message deletion for silent runner responses. Verified with `npm run build`.
- 2026-03-03: Rewrote `readme.md` into a more standard GitHub README structure. Consolidated scattered information into clearer sections for project overview, current status, capabilities, setup, commands, configuration, data layout, project structure, API, and known limitations.
- 2026-03-03: Added `Voldemomo_compressed.jpg` to the top of `readme.md` as a centered header logo with restrained sizing so the page gets branding without becoming image-heavy.
- 2026-03-03: Updated the README introduction to position Molibot explicitly as a simplified OpenClaw-style personal AI assistant, instead of a generic multi-entry AI project.
- 2026-03-03: Polished the README hero copy again, reducing the opening paragraphs into a tighter product-style positioning statement for a cleaner first screen.
- 2026-03-03: Added a short centered slogan under the README logo to make the first screen feel more like a complete project header.
- 2026-03-03: Moved audio transcription ownership from `channels` into `agent`: added `src/lib/server/agent/stt.ts`, enriched attachment metadata with `mediaType`/`mimeType`, stopped Telegram/Feishu intake from appending `[voice transcript]` or emitting STT errors directly, and made `runner.ts` perform transcription/fallback before prompt assembly.
- 2026-03-03: Added first-class `agents` to Settings and runtime. New `/settings/agents` edits agent metadata plus `AGENTS.md` / `SOUL.md` / `IDENTITY.md` / `SONG.md`, Telegram and Feishu bot settings now support `agentId` selection plus bot-level Markdown overrides, and prompt preview/runtime loading now resolves `global -> agent -> bot` sources.
- 2026-03-03: Hardened settings safety for identity objects. Existing agent IDs and bot IDs are now locked after first save, and deleting either an agent or a bot requires an explicit browser confirmation before removal.
- 2026-03-03: Changed prompt file resolution from additive concatenation to slot-based override. For each profile file name, runtime now selects exactly one source using `bot > agent > global`, instead of concatenating same-name files across layers.
- 2026-03-04: Removed the hardcoded assistant identity line from `src/lib/server/agent/prompt.ts`. The base system prompt now stays channel/runtime-neutral and no longer injects `Voldemomo` ahead of agent-owned `IDENTITY.md` / `SOUL.md`, so “who are you” answers can come from the configured agent profile instead of conflicting core text.
- 2026-03-03: Added first-stage capability verification for custom models: settings schema now persists per-capability verification status, `/api/settings/provider-test` returns verification results for declared `text`/`vision` probes, and `/settings/ai/providers` now shows “Declared Capabilities” separately from “Verification Status”.
- 2026-03-03: Fixed provider capability verification save path on `/settings/ai/providers`: save now serializes each model's `verification` map explicitly into the settings payload so test results survive refresh after clicking Save.
- 2026-03-02: Deleted unused `src/lib/memoryStorageBackend.ts`. It had no remaining imports after the web storage simplification and was only creating confusion about whether a second memory backend still existed outside `src/lib/server/memory`.
- 2026-03-02: Continued structure migration with infra extraction: moved rate limiter into `src/lib/server/infra`, moved storage helpers into `src/lib/server/infra/db/storage.ts`, and moved shared message types into `src/lib/shared/types/message.ts`. Verified with `npm run build`.
- 2026-03-02: Completed structure migration phase 2: split runtime env/path config into `src/lib/server/app/env.ts`, split runtime settings schema/defaults into `src/lib/server/settings/*`, and moved the shared web/CLI message router to `src/lib/server/channels/shared/messageRouter.ts`. Verified with `npm run build`.
- 2026-03-02: Completed structure migration phase 1: moved bootstrap/runtime files to `src/lib/server/app`, renamed `mom` runtime core to `src/lib/server/agent`, moved built-in Telegram/Feishu implementations under `src/lib/server/channels`, and split session/settings/provider ownership into dedicated module folders. Verified with `npm run build`.
- 2026-03-04: Fixed periodic event status persistence in `EventsWatcher`: cron-triggered jobs now go through the same dispatch/status path as one-shot jobs, so event JSON keeps updating `lastTriggeredAt`, `runCount`, and `error` metadata instead of remaining a bare schedule config.
- 2026-03-04: Added task-management actions in `/settings/tasks`: new `/api/settings/tasks` delete operation now removes selected event JSON files under watched task roots, and the page now supports single delete, per-section select, select-all, clear selection, and batch delete.
- 2026-03-04: Hardened Telegram task delivery against transient network send failures by adding retry/backoff in `sendTelegramText`, and added manual task trigger actions in `/settings/tasks` plus `/api/settings/tasks` so operators can retry/send selected task payloads immediately for validation.
- 2026-03-01: Added optional `mory` memory backend behind the existing memory gateway, wired backend switching through `/settings/plugins`, and surfaced the active memory backend in `/settings/memory`.
- 2026-02-28: Refactored Telegram mom system prompt into section builders and added startup prompt preview generation (`SYSTEM_PROMPT.preview.md`) per bot workspace, with log output for the preview path.
- 2026-02-28: Fixed Telegram prompt source resolution to always load global instruction/profile files from `${DATA_DIR}` (`~/.molibot`) instead of repository root fallbacks, added case-insensitive filename matching (`SOUL.md` vs `soul.md`), and annotated startup prompt previews with exact `global_sources` / `workspace_sources`.
- 2026-02-28: Upgraded global profile files under `~/.molibot` to a richer template structure inspired by OpenClaw: added frontmatter, clearer responsibilities, session-read guidance, and stronger separation between AGENTS/SOUL/TOOLS/USER/IDENTITY/BOOTSTRAP while preserving existing user data and collaboration rules.
- 2026-02-28: Added reusable profile templates under `src/lib/server/agent/prompts/*.template.md` and updated `molibot init` to bootstrap new users from these templates instead of using a single AGENTS default plus empty companion files.
- 2026-02-28: Removed legacy `AGENTS.default.md`; runtime fallback and init template ownership are now both carried by `src/lib/server/agent/prompts/AGENTS.template.md`, eliminating the duplicate AGENTS template file.
- 2026-02-28: Extracted Telegram mom prompt construction into `src/lib/server/agent/prompt.ts` and reduced code-owned prompt duplication by keeping runtime contract in code while leaving editable style/persona guidance to `AGENTS.md` / `SOUL.md` / `TOOLS.md`.
- 2026-02-28: Reordered Telegram mom prompt output so dynamic runtime payload blocks (`available skills`, `skill diagnostics`, `current memory`) move to the end, improving `SYSTEM_PROMPT.preview.md` readability and reducing noisy mid-file diffs.
- 2026-02-28: Cleaned runtime profile injection: frontmatter is now stripped before prompt assembly, AGENTS injected wording now matches the actual preload model, bundled TOOLS paths now use `${dataRoot}`, and profile self-referential meta text was reduced to avoid runtime confusion.
- 2026-02-28: Split channel-specific prompt guidance from the core runtime prompt: Telegram formatting now comes from adapter-selected channel sections, while cross-channel core prompt keeps only generic runtime contracts.
- 2026-02-28: Added deterministic Telegram reminder fallback for relative-time reminder requests. Explicit “X 分钟/小时后提醒我...” messages now create one-shot event files in runtime code without depending on model tool-call reliability.
- 2026-02-28: Rewrote `package/mory/README.md` for external SDK consumers: added installation requirements, backend selection guidance, SQLite quick start, PostgreSQL/pgvector setup, `ingest/commit/retrieve/readByPath` usage, `read_memory` helper example, integration patterns, and explicit host-vs-SDK responsibility boundaries.
- 2026-02-28: Upgraded `@molibot/mory` from a driver-contract package to a standalone SDK: added package-owned dependency declaration (`pg`) and local build deps, built-in `NodeSqliteDriver` / `NodePgDriver`, factory helpers (`createSqliteStorageAdapter` / `createPgvectorStorageAdapter`), SQLite embedding persistence + local cosine rerank, README clarification, and SQLite-backed adapter test coverage.
- 2026-02-28: Completed ENG-115. Realigned prompt architecture with `docs/prompt_desc.md`: runtime system prompt is code-owned again, and the bundled AGENTS template now only defines durable AGENTS/bootstrap policy while `~/.molibot` carries editable profile files.
- 2026-02-28: Added hard scheduling guardrails for Telegram mom runtime: prompt now explicitly requires all delayed/recurring tasks to use watched event JSON files, `bash` now blocks external schedulers (`crontab`/`at`/`launchctl`/`schtasks`), and `memory add` now rejects reminder/schedule-like content so timers cannot silently degrade into memory records.
- 2026-02-27: Fixed Telegram periodic events lifecycle: `periodic` jobs are no longer marked `completed` and removed after first execution; watcher now keeps them scheduled across runs and records `lastTriggeredAt` while preserving `runCount`.
- 2026-02-27: 排查定时任务能力边界，确认 Telegram runtime 已实现事件调度（immediate/one-shot/periodic），但 Web chat 入口尚未接入该能力；同时确认 `bin/molibot-service.sh` 仅反映其管理的后台实例状态，不能代表系统内不存在其他手动或开发模式运行中的 Molibot 进程。
- 2026-06-04: 修复 `EventsWatcher` 超时后的晚到成功收尾路径；当同一 `periodic` 槽位首个 attempt 已完成真实产出时，不再因为 nominal timeout 进入重复的第二次 attempt；新增 `events.test.ts` 回归覆盖。
- 2026-02-27: Completed all remaining `package/mory/README.md` TODO items. Implemented new modules `moryEngine.ts`, `moryValidation.ts`, `moryAdapter.ts`, `moryRetrieval.ts`, `moryForgetting.ts`, `moryMetrics.ts`; upgraded `morySql.ts` to versioned persistence schema + param builders; expanded package exports and added `moryEngine.e2e.test.ts`. Verified with `npm --prefix package/mory run test` (20/20 pass).
- 2026-02-27: 更新 `package/mory/README.md` 为功能状态清单，按 `完成` / `TODO` 标注 mory 当前能力与未实现项（编排层、异步 commit、read_memory API、持久化适配器、版本化落库、检索执行器、遗忘引擎、校验器、指标、E2E）。
- 2026-02-27: Expanded `package/mory` with cognitive-control modules: `moryScoring.ts`, `moryConflict.ts`, `moryPlanner.ts`, `moryConsolidation.ts`, `moryWorkspace.ts`; exported all new APIs via `src/index.ts`; added corresponding tests (`moryScoring/moryConflict/moryPlanner/moryConsolidation`) and validated with `npm --prefix package/mory run test` (19/19 pass).
- 2026-02-27: Completed `package/mory` as a standalone Node package with standard structure (`src/`, `test/`, `README.md`, `package.json`, `tsconfig.build.json`), runnable build/test/smoke scripts, and root shortcuts (`npm run mory:build|mory:test|mory:smoke`).
- 2026-02-27: Added `@molibot/mory` SQL persistence templates for memory storage: SQLite schema/upsert SQL plus PostgreSQL pgvector schema/upsert/vector-search SQL (`package/mory/src/morySql.ts`), and exported them from package entrypoint.
- 2026-02-27: Improved `mory` write-gate batch behavior: batch cache now reflects both insert and update decisions to avoid same-batch stale-state decisions; pending IDs are now collision-safe.
- 2026-02-27: Clarified skills provisioning policy in README: `molibot init` keeps manual-install behavior (no automatic project-skill copy), and added explicit manual install command from project `skills/` to `${DATA_DIR}/skills`.
- 2026-02-27: Corrected README channel status wording: Telegram marked as validated in real usage; Web Chat/CLI marked as implemented but not yet personally validated in this project usage context.
- 2026-02-27: Rebuilt `readme.md` based on current `prd.md` + implemented feature set, refreshed startup/deploy/config/Telegram commands/data layout/API docs, and removed outdated behavior descriptions.
- 2026-02-27: Fixed Telegram outbound image behavior: image files are now delivered as photos (`sendPhoto`) instead of generic data documents when possible, with automatic document fallback for unsupported cases.
- 2026-02-25: Added Skills management visibility in Web settings: new API endpoint `GET /api/settings/skills` scans `${DATA_DIR}/skills`, `${DATA_DIR}/moli-t/bots/*/skills` and `${DATA_DIR}/moli-t/bots/*/*/skills`; new page `/settings/skills` shows grouped installed skills and concrete paths; settings navigation and dashboard cards updated to include Skills.
- 2026-02-25: Optimized skill routing to two-level repositories: global reusable skills now live in `${DATA_DIR}/skills`, chat-specific skills live in `${workspaceDir}/${chatId}/skills`; loader now merges scopes with precedence `chat > global > workspace-legacy`, `/skills` outputs scope and both directories, path resolver allows global skills root and redirects legacy `data/moli-t/skills` references to data-root skills, and runtime store migrates legacy workspace skills to global root when possible.
- 2026-02-25: Updated `molibot init` to create `${DATA_DIR}/skills` for global reusable skill installation.
- 2026-02-25: Fixed `Global profile files must be written only under data root` false positives for valid targets (for example `~/.molibot/soul.md`) by normalizing absolute global profile paths in `resolveToolPath()` and applying case-insensitive path-key matching in guard logic on case-insensitive platforms.
- 2026-02-25: Hardened profile-file path enforcement in `src/lib/server/agent/tools/path.ts`: relative writes targeting `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md` now normalize by basename to data-root global files, and guard logic now explicitly rejects those filenames when resolved under non-global paths (e.g. `.../moli-t/bots/.../<chatId>/soul.md`).
- 2026-02-25: Corrected `molibot init` behavior: `AGENTS.md` now initializes by copying `src/lib/server/agent/prompts/AGENTS.default.md` instead of creating an empty file; other instruction files remain empty-file bootstrap.
- 2026-02-25: Added `molibot init` command in `bin/molibot.js` to initialize `${DATA_DIR:-~/.molibot}` and create empty instruction bootstrap files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`); updated `readme.md` usage docs.
- 2026-02-25: Added strict AGENTS update targeting rule in bot default prompt: AGENTS changes must be written to `${workspaceDir}/AGENTS.md`, project-root `AGENTS.md` must not be modified, and response text must explicitly mention the workspace target path.
- 2026-02-25: Moved instruction-file auto-maintenance protocol from project root `AGENTS.md` into bot default prompt `src/lib/server/agent/prompts/AGENTS.default.md`, so the rules live in bot runtime prompt content instead of repository collaboration policy file.
- 2026-02-25: Added instruction-file auto-maintenance protocol to bot default prompt: defined automatic update triggers for `USER.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, and `BOOTSTRAP.md`, with high-risk confirmation gate, mandatory change summaries, and conflict priority order.
- 2026-02-25: Added project-level prompt fallback for Telegram runner instructions: load order is now `workspaceDir/AGENTS.md` -> project-root `AGENTS.md` -> bundled default template; optional companion files (`SOUL.md`, `TOOLS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`) follow the same base directory in each tier.
- 2026-02-25: Externalized Telegram runner prompt from hardcoded string to file-driven loading. Added bundled default template `src/lib/server/agent/prompts/AGENTS.default.md`, runtime workspace override via `AGENTS.md`, optional companion file merge (`SOUL.md`, `TOOLS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`), and placeholder rendering for workspace/chat/memory variables.
- 2026-02-25: Upgraded event execution model: added event `delivery` mode (`text`/`agent`), switched one-shot/immediate default to agent execution, retained literal direct-send path via `delivery:\"text\"`, and updated runner event prompt/examples accordingly.
- 2026-02-25: Added event-file delivery normalization: watcher now auto-fills missing `delivery` as `agent` and writes it back to event JSON, so execution mode is explicit on disk.
- 2026-02-25: Added one-shot schedule guard in `write` tool: event JSON with past/invalid `at` is rejected with explicit error (`at` + `now`), forcing immediate recomputation instead of silently creating skipped reminders.
- 2026-02-25: Added Telegram multi-bot support end-to-end: settings schema now supports `telegramBots[]`, Telegram settings page supports add/remove/edit multiple bots, runtime applies all bots concurrently, and each bot uses isolated workspace state under `~/.molibot/moli-t/bots/<botId>`.
- 2026-02-25: Added pluggable memory architecture (`memory gateway` + replaceable memory backend) with built-in JSON-file backend, `POST /api/memory` operations (`add/search/flush/delete/update`), prompt-time memory retrieval injection, and new `/settings/plugins` memory enable/backend settings UI.
- 2026-03-01: Renamed the memory abstraction from `core` to `backend`, added a built-in memory backend registry, and kept settings backward-compatible with legacy `plugins.memory.core`.
- 2026-03-01: Split external memory sync out of backend implementations into independent memory importers/sources, so backend storage and legacy-file import are no longer coupled.
- 2026-03-01: Exposed built-in memory backends in the plugin catalog and `/settings/plugins`, alongside channel and provider entries.
- 2026-03-01: Added startup runtime diagnostics for plugin catalog, applied channel plugin instances, selected memory backend, available memory backends/importers, and initial memory sync results.
- 2026-03-01: Added ANSI-colored startup diagnostics for runtime/memory logs so plugin catalog, channel instance loading, memory backend selection, and sync results are visually distinguishable in terminal output.
- 2026-03-01: Fixed Telegram outbound audio delivery: attachment uploads now detect audio payloads, send `.ogg/.oga` via `sendVoice`, send common audio formats via `sendAudio`, and only fall back to `sendDocument` if native media sending fails.
- 2026-03-01: Moved workspace/data-root/memory-root/global-skills resolution into shared `mom` core so Telegram and Feishu now load system prompt sources and skills from the same rules; Feishu runtime now passes bot workspace root instead of scratch as `workspaceDir`, generates `SYSTEM_PROMPT.preview.md`, and exposes `/skills` for parity checks.
- 2026-02-25: Upgraded memory pipeline inspired by OpenClaw strategy: introduced layered memory classification (`long_term`/`daily`), hybrid retrieval (keyword + recency), incremental flush cursors per conversation, and scope-local markdown mirrors for human-readable memory inspection.
- 2026-02-25: Added memory governance layer: fact-key conflict labeling (`hasConflict`), optional memory expiration (`expiresAt`) handling, `list` API for operations, and a dedicated Memory management page for manual curation.
- 2026-02-25: Unified Telegram mom memory paths under shared memory root; legacy `${workspaceDir}/MEMORY.md` and `${workspaceDir}/${chatId}/MEMORY.md` are auto-migrated to `${DATA_DIR}/memory/...`, and tool path guards now allow writes under the shared memory root.
- 2026-02-25: Enforced gateway-first memory workflow for Telegram agent: introduced dedicated `memory` tool, blocked direct memory-file mutations from generic file/shell tools, added runtime periodic import of Telegram memory files into gateway, and made `/settings/memory` default to cross-scope unified listing.
- 2026-02-25: Consolidated server process management into single script `bin/molibot-service.sh` with subcommands (`start/stop/status/restart`) and kept legacy per-action scripts as compatibility wrappers.
- 2026-02-25: Added server lifecycle scripts (`start/stop/status/restart`) for Molibot background process management, introduced PID file control (`~/.molibot/molibot.pid`), and documented all operations in `readme.md`.
- 2026-02-25: Added `bin/start-molibot.sh` for one-command background startup (`nohup + disown`) with default log file `~/logs/molibot.log` and optional `MOLIBOT_LOG_FILE` override.
- 2026-02-23: Migrated web chat page UI to Tailwind CSS with modern visual refresh (toolbar, message list, composer), removed local `<style>` from `src/routes/+page.svelte`, and added Tailwind runtime wiring (`@tailwindcss/vite`, `src/app.css`, `src/routes/+layout.svelte`).
- 2026-02-23: Upgraded web app layout to ChatGPT-style structure across chat and settings pages (left navigation shell + main workspace), removed legacy page-scoped CSS from settings pages, and kept existing settings/chat logic unchanged.
- 2026-02-23: Added Telegram route-scoped model switch support in `/models` command: `text/vision/stt/tts` can be listed and switched independently by index or key.
- 2026-02-11: Created `features.md` with V1 baseline status tracking.
- 2026-02-11: Added implemented/planned/backlog sections aligned with `prd.md`.
- 2026-02-11: Recorded documentation milestones for Must/Later scope and sprint plan.
- 2026-02-11: Confirmed Telegram adapter implementation will use `grammY` and synced `prd.md` + `architecture.md`.
- 2026-02-11: Changed V1 persistence from PostgreSQL to SQLite and synced `prd.md` + `architecture.md` + `notes.md`.
- 2026-02-11: Removed `task_plan.md`, `notes.md`, `feasibility-report-v2.md`; updated `readme.md` with remaining file purposes; synced `prd.md`.
- 2026-02-11: Implemented V1 code skeleton for Telegram (`grammY`), CLI, Web, unified router, and SQLite persistence.
- 2026-02-11: Added startup/config files (`package.json`, `tsconfig.json`, `.env.example`, `.gitignore`) and updated `readme.md` quickstart.
- 2026-02-11: Added `.npmrc` to use npmjs registry; local dependency installation remains blocked due to network DNS (`ENOTFOUND`).
- 2026-02-11: Removed `better-sqlite3` due to Node 25 native build failure; migrated to built-in `node:sqlite` and updated setup docs.
- 2026-02-11: Removed all mock assistant logic and switched to real pi-mono runtime calls in `AssistantService`.
- 2026-02-11: Added configurable model selection (`AI_PROVIDER_MODE`) with custom provider support (`CUSTOM_AI_BASE_URL`, `CUSTOM_AI_API_KEY`, `CUSTOM_AI_MODEL`).
- 2026-02-11: Added Telegram chat whitelist config via `TELEGRAM_ALLOWED_CHAT_IDS` and documented exact `.env` locations in `readme.md`.
- 2026-02-11: Replaced custom Web chat UI with official `@mariozechner/pi-web-ui`-based page (`public/index.html`).
- 2026-02-11: Documented separate config behavior: Web UI provider key is browser-side, Telegram/CLI provider config remains server-side `.env`.
- 2026-02-11: Updated `public/index.html` bootstrap flow with explicit error surface; black screen now shows concrete init failure reason and checks.
- 2026-02-11: Reworked Web UI integration to local Vite app (`web/`) based on pi-web-ui example; removed CDN dynamic import path that caused MIME/module load failures.
- 2026-02-11: Backend web adapter now serves `web/dist` when available and returns clear setup instructions when frontend is not built.
- 2026-02-11: Fixed TypeScript build errors in `assistant.ts` (`KnownProvider`) and `sessionStore.ts` (safe SQLite row mapping).
- 2026-02-11: Updated `npm run dev` to start backend + web concurrently (`concurrently`).
- 2026-02-11: Changed `npm run dev` to shell-based parallel startup (`dev:backend` + `web:dev`) without extra process manager dependency.
- 2026-02-11: Switched `npm run dev` back to managed parallel startup via `concurrently` to avoid orphaned dev processes.
- 2026-02-11: Improved backend startup diagnostics for `EADDRINUSE` with actionable message.
- 2026-02-11: Migrated Web frontend to SvelteKit (`web/`), replaced old Vite hand-rolled entry files.
- 2026-02-11: Integrated `pi-web-ui` mount in SvelteKit client page (`web/src/routes/+page.svelte`) with SSR disabled.
- 2026-02-11: Updated root scripts to run SvelteKit via `npm --prefix web ...` and preserved backend static hosting from `web/dist`.
- 2026-02-11: Added standalone `web/package.json`; SvelteKit web build now requires running `npm --prefix web install` before `web:dev/web:build`.
- 2026-02-11: Attempted `npm --prefix web install`; blocked by DNS/network (`ENOTFOUND registry.npmjs.org`) in current environment.
- 2026-02-11: Unified dev runtime to single-process SvelteKit (`npm run dev` now launches only web/SvelteKit process).
- 2026-02-11: Moved backend API into SvelteKit server routes (`web/src/routes/api/*`) and health route (`web/src/routes/health/+server.ts`).
- 2026-02-11: Added shared runtime bootstrap (`src/runtime.ts`) and SvelteKit server hook (`web/src/hooks.server.ts`) to start Telegram in same process.
- 2026-02-11: Switched SvelteKit adapter to `@sveltejs/adapter-node` for server API support in production.
- 2026-02-11: Fixed `pi-web-ui` mount path to static ESM imports in SvelteKit page (`+page.svelte`) so Vite can prebundle dependencies correctly.
- 2026-02-11: Added `optimizeDeps.include` for `pi-web-ui`/`pi-ai`/`pi-agent-core`/`lit` in `web/vite.config.ts` to stabilize dev dependency optimization.
- 2026-02-11: Added Lit shadow-field cleanup workaround before `ChatPanel.setAgent()` to avoid runtime `class-field-shadowing` crash with current `pi-web-ui` build.
- 2026-02-11: Updated SvelteKit web scripts to run `svelte-kit sync` before dev/build, removing `.svelte-kit/tsconfig.json` warning.
- 2026-02-11: Expanded Lit warning workaround to disable `class-field-shadowing` on all relevant `pi-web-ui` custom element constructors (not only `ChatPanel`).
- 2026-02-11: Forced SvelteKit dev server to production mode (`vite dev --mode production`) and set resolver conditions to avoid Lit development export path that throws `class-field-shadowing` errors.
- 2026-02-11: Added runtime settings store (`app_settings` table + `SettingsStore`) and runtime update flow (`src/runtime.ts`).
- 2026-02-11: Added settings API (`web/src/routes/api/settings/+server.ts`) for reading/updating AI and Telegram configuration.
- 2026-02-11: Added Web settings page (`web/src/routes/settings/+page.svelte`) and chat-page settings entry link.
- 2026-02-11: Refactored Telegram integration to managed runtime service (`TelegramManager`) supporting config reload.
- 2026-02-11: Refactored `AssistantService` to use runtime settings instead of static env snapshot.
- 2026-02-11: Updated chat page to hide model selector in `pi-web-ui`, so chat no longer displays large built-in model list unrelated to current configuration.
- 2026-02-11: Updated Web chat runtime to use backend `/api/chat` stream function, so Web replies follow runtime settings (`providerMode`, custom host/key/model) instead of browser-side provider keys.
- 2026-02-11: Restored Web chat model/thinking selectors and hardened send flow to show explicit assistant-side error text when backend call fails.
- 2026-02-11: Fixed Web model selector crash by wiring `CustomProvidersStore` into IndexedDB/AppStorage (`customProviders.getAll` no longer undefined).
- 2026-02-11: Added defensive send fallback for missing `message-editor` ref to avoid `Cannot set properties of undefined (setting 'value')`.
- 2026-02-11: Refactored runtime settings schema from single custom provider fields to `customProviders[] + defaultCustomProviderId` with legacy migration support.
- 2026-02-11: Added AI metadata API (`/api/settings/ai-meta`) and upgraded AI settings UI to dropdown PI provider/model selection.
- 2026-02-11: Reorganized settings UX into entry page and dedicated AI/Telegram subpages to avoid crowded single-page form.
- 2026-02-11: Bumped Web UI IndexedDB schema version from `1` to `2` to migrate existing local DB and create missing `custom-providers` object store.
- 2026-02-11: Changed Web UI IndexedDB database name to `molibot-web-ui-v2` for deterministic fresh schema creation on clients with stale local DB state.
- 2026-02-11: Replaced SQLite persistence with backend JSON-file persistence (`data/settings.json` + `data/sessions/index.json` + per-session JSON files).
- 2026-02-11: Replaced Web `IndexedDBStorageBackend` with in-memory backend (`web/src/lib/memoryStorageBackend.ts`) so browser no longer uses IndexedDB.
- 2026-02-11: Added backend session APIs (`/api/sessions`, `/api/sessions/:id`) and wired Web chat session list/switch/create to backend JSON sessions.
- 2026-02-11: Upgraded session title strategy from timestamp labels to first-user-message summary and persisted title in conversation JSON.
- 2026-02-11: Switched chat model selector source from `pi-web-ui` built-in model catalog to backend settings data; model switching now updates `/api/settings` and takes effect immediately.
- 2026-02-11: Improved chat UI responsiveness by emitting assistant `start/text_start` immediately and slowing text delta cadence for visible progressive rendering.
- 2026-02-11: Added page-level realtime render fallback by subscribing to agent events and explicitly requesting `agent-interface` updates.
- 2026-02-11: Reworked `src/adapters/telegram.ts` into a mom-style runtime with per-chat queue, cancellable runs, progressive status updates, and tool-result thread replies.
- 2026-02-11: Added Telegram mom core modules under `src/mom/` (`types`, `store`, `runner`, `events`, `tools`) and wired them into runtime settings.
- 2026-02-11: Added filesystem event scheduling for Telegram mom workspace (`data/telegram-mom/events/*.json`) with support for immediate, one-shot, and periodic events.
- 2026-02-11: Added Telegram attachment ingestion/download and image injection into agent prompt context.
- 2026-02-11: Rolled back Telegram adapter runtime entry to stable router path after regression; mom-t modules remain in repository as prototype and are not default-enabled.
- 2026-02-11: Re-enabled Telegram default runtime as mom-t with `grammy`, per-chat queue/stop, event watcher, attachment ingestion, and Web settings-driven token/chat-id allowlist.
- 2026-02-11: Fixed mom-t `read` tool range command generation (`sed` line range expansion bug), improving tool-call reliability.
- 2026-02-11: Added structured `[mom-t]` logs (`src/mom/log.ts`) and wired logging through `src/adapters/telegram.ts` + `src/mom/runner.ts` for end-to-end request tracing (received/enqueued/started/tools/responded/completed/errors).
- 2026-02-11: Added Telegram `/chatid` command and startup `allowed_chat_ids_loaded` log to make whitelist/debug of polling chat ids explicit.
- 2026-02-11: Added Vite dev bootstrap plugin to ping `/api/settings` at server startup so runtime initialization and Telegram status logs are visible without manual first request.
- 2026-02-11: Added runner provider preflight validation and graceful error-return path for missing API keys/config so Telegram requests fail with explicit messages instead of process panic.
- 2026-02-11: Added Telegram -> session store mirror writes (user/assistant) so `data/sessions` continues updating under mom-t path.
- 2026-02-11: Added empty assistant output guard: when provider returns empty content, bot now sends clear diagnostic response instead of silent completion.
- 2026-02-11: Added detailed AI call trace logs in runner (`model_selected`, `api_key_resolve`, `llm_stream_start`, `assistant_message_end`) to verify whether/how each Telegram message reaches provider APIs.
- 2026-02-11: Fixed custom provider URL assembly for OpenAI-compatible chat completions so configured path (e.g. `/v1/chat/completions`) is reflected in effective `baseURL` used by SDK calls.
- 2026-02-11: Cleaned Telegram message noise: no duplicate message sends on `message is not modified`, tool details only posted on failures, and ANSI color codes stripped from bash tool outputs.
- 2026-02-11: Added default key-log filtering for `[mom-t]` logs; non-critical debug events are suppressed unless `MOM_LOG_VERBOSE=1`.
- 2026-02-11: Extended Telegram events watcher to include per-chat scratch event directory (`data/telegram-mom/<chatId>/scratch/data/telegram-mom/events`) in addition to workspace events.
- 2026-02-11: Optimized Telegram system prompt by referencing mom agent prompt structure (context, formatting, runtime behavior, event guarantees, and scheduling guidance).
- 2026-02-11: Fixed one-shot/immediate event delivery to send exact event text directly, retained event files with execution status updates instead of deletion, and added scratch-path normalization to prevent duplicated nested `.../scratch/data/telegram-mom/<chatId>/scratch` directories.
- 2026-02-11: Performed safe one-time data migration for chat `7706709760`, moving files from duplicated nested path `scratch/data/telegram-mom/7706709760/scratch/` back to canonical `scratch/` and cleaning obsolete empty directories.
- 2026-02-11: Upgraded AI settings custom provider model from single `model` to multi-model (`models/defaultModel`), added provider test endpoint for connectivity + developer-role detection, and added Telegram runner fallback to map unsupported `developer` role into `system`.
- 2026-02-11: Redesigned AI settings page into two-pane workspace (provider list + detail editor), improving provider selection flow and model/role operations.
- 2026-02-11: Hardened Telegram custom-provider role fallback by moving `systemPrompt` into a `system` message when provider does not support `developer`, preventing residual `developer` role 400s.
- 2026-02-11: Added unified global skills discovery (`data/telegram-mom/skills`) and upgraded Telegram mom system prompt with richer mom-style sections (skills contract/usage protocol, workspace/system log, and operational query snippets).
- 2026-02-12: Installed `find-skills` skill file into workspace runtime directory `data/telegram-mom/skills/find-skills/` (in addition to Codex global skill directory).
- 2026-02-12: Corrected runtime skill location for current web-start mode; `find-skills` is now present at `data/telegram-mom/skills/find-skills/SKILL.md`.
- 2026-02-12: Added explicit runtime-path documentation: in current web-start mode, Telegram workspace resolves to `data/telegram-mom` and tool execution cwd resolves to `data/telegram-mom/<chatId>/scratch`.
- 2026-02-12: Completed backend full-merge into SvelteKit by moving `src/*` to `web/src/lib/server/*`, updating API/hook imports to `$lib/server/*`, removing `$backend` alias, and unifying root commands (`dev/build/start`) to web package entrypoints.
- 2026-02-12: Updated top-level docs and config for merged layout (`readme.md` paths/commands and `tsconfig.json` server include path).
- 2026-02-12: Flattened SvelteKit app from `web/` to repository root (`src/`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`), merged dependencies into root `package.json`, and removed cross-directory app startup paths.
- 2026-02-12: Fixed production build failure (`@smithy/node-http-handler` browser export error) by replacing `src/routes/+page.svelte` with a pure Svelte chat client that talks to existing `/api/chat`, `/api/sessions`, and `/api/settings` endpoints without importing Node-only runtime packages in browser code.
- 2026-02-12: Added Telegram session management commands and storage model: context now stored as `data/telegram-mom/<chatId>/contexts/<sessionId>.json` with `active_session.txt`; legacy `context.json` is auto-migrated to `contexts/default.json`.
- 2026-02-12: Changed Telegram busy behavior from hard-reject to queue mode: incoming messages during active run are enqueued and user receives `Queued. Pending: N...` feedback instead of `Already working`.
- 2026-02-12: Added text attachment format guard for Telegram uploads: if output file is detected as text and extension is not `.txt/.md/.html`, it is renamed to `.txt` before sending.
- 2026-02-12: Added Telegram `/skills` command for inspecting currently loaded skills and skill loader diagnostics from workspace `data/telegram-mom/skills/**/SKILL.md`.
- 2026-02-12: Hardened delayed reminder behavior by strengthening runner event rules and adding `bash` wait-command guard (`sleep/timeout/wait/ping`) to prevent in-process waiting and force one-shot event creation.
- 2026-02-12: Changed Telegram attachment behavior to text-first delivery: likely text outputs are sent as plain messages when short enough; file upload is used only for oversized text or non-text content.
- 2026-02-12: Rebased Telegram mom runner system prompt to upstream `mom` agent prompt style and content, with minimal local adaptations for Telegram runtime paths, event status-retention behavior, and text-first response policy.
- 2026-02-12: Added workspace-root path guard for mom file tools (`read/write/edit/attach`): absolute/escaped paths outside `scratch` and workspace are now blocked, preventing miswrites like `/tmp/events/*`.
- 2026-02-12: Reworked `src/lib/server/agent/tools` from single-file implementation to modular upstream-style layout (`bash.ts/read.ts/write.ts/edit.ts/attach.ts/path.ts/truncate.ts`) and upgraded tool behavior (image-capable read, structured truncation metadata, bash full-output capture path, shared path guard).
- 2026-02-12: Added reminder shorthand normalization in `write` tool: inputs like `2026-02-12T04:11:09.000Z 你好` are auto-converted to valid one-shot event JSON and written to `data/telegram-mom/events/*.json`.
- 2026-02-15: Enforced canonical workspace skills install path in Telegram runner prompt and added path normalization so mistaken `data/telegram-mom/skills/...` writes from chat scratch resolve to workspace `data/telegram-mom/skills/...` instead of nested scratch duplicates.
- 2026-02-15: Changed Telegram workspace root initialization to absolute path resolution (`resolve(config.dataDir, "telegram-mom")`), so skill path guidance/output now shows full absolute filesystem paths.
- 2026-02-16: Refreshed root `.gitignore` for current mono-root SvelteKit layout; now ignores local env variants, build artifacts (`build/.svelte-kit/dist`), runtime data outputs, logs, and common OS/editor transient files while explicitly keeping `data/telegram-mom/skills/**` versioned.
- 2026-02-16: Added global launcher command `molibot` via npm `bin` + `bin/molibot.js` (supports `dev/start/build/cli`) so project can be started after `npm link` without `npm run dev`.
- 2026-02-16: Migrated default runtime storage root from repo-local `data/` to `~/.molibot` (supports `~` expansion in env paths), and switched Telegram workspace directory from `telegram-mom` to `moli-t` (target path `~/.molibot/moli-t`).
- 2026-02-28: Simplified Telegram chat-local watched events path from `scratch/data/.../events` to `scratch/events`, added legacy directory migration from prior `data/moli-t`, `data/molipi_bot`, and `data/telegram-mom` layouts, and updated prompt/docs to the new canonical path.
- 2026-02-28: Added Settings task inventory: new `/api/settings/tasks` scans `${DATA_DIR}/moli-t/bots/*/events` and `${DATA_DIR}/moli-t/bots/*/*/scratch/events`, and new `/settings/tasks` shows grouped task tables by event type with operational status fields.
- 2026-02-16: Updated Telegram mom prompt/path conventions to `moli-t` naming for scratch events and skill-path guidance; kept legacy `data/telegram-mom` and new `data/moli-t` prefixes compatible in tool path normalization.
- 2026-02-16: Executed one-time data migration from `~/github/molipibot/data/telegram-mom/` to `~/.molibot/moli-t/` using `rsync -a`; verified file-count parity (`2701 -> 2701`).
- 2026-02-16: Completed missing settings migration by copying `~/github/molipibot/data/settings.json` to `~/.molibot/settings.json`; verified same SHA1 hash on source and target.
- 2026-02-16: Added the original Telegram outbound formatting bridge. This legacy Markdown-to-HTML approach was superseded on 2026-06-17 by grammY rich messages with plain text fallback.
- 2026-02-16: Optimized dev boot path in `vite.config.ts`: startup now initializes runtime by `server.ssrLoadModule('/src/lib/server/app/runtime.ts').getRuntime()` directly after Vite listens, removing dependency on first browser request for Telegram activation.
- 2026-02-16: Added Telegram `/models` command: `/models` lists current/configured model options and `/models <index|key>` switches active model in chat, persisting to runtime settings and re-applying Telegram runtime without requiring web settings page.
- 2026-02-16: Added Telegram voice/audio support in `src/lib/server/adapters/telegram.ts`: bot now downloads `voice`/`audio` files, stores them as attachments, and (when STT is configured) transcribes audio to text via OpenAI-compatible `audio/transcriptions` endpoint, appending transcript into inbound message text.
- 2026-02-16: Added STT runtime config (now organized under `src/lib/server/app/env.ts`) and `.env.example`: `TELEGRAM_STT_BASE_URL`, `TELEGRAM_STT_API_KEY`, `TELEGRAM_STT_MODEL`, optional `TELEGRAM_STT_LANGUAGE` / `TELEGRAM_STT_PROMPT`.
- 2026-02-16: Upgraded runtime settings model schema to `CustomProvider.models[]` object format (`{id,tags}`) with backward-compatible migration from legacy string arrays, and added `modelRouting` keys (`textModelKey/visionModelKey/sttModelKey/ttsModelKey`) in config + settings store + runtime sanitizer.
- 2026-02-16: Updated Telegram model switching to write `modelRouting.textModelKey` and updated mom runner model resolution to prefer route-based model selection by use case (vision route when image content exists, text route otherwise).
- 2026-02-16: Rebuilt AI settings page into multimodal control center: provider CRUD, model tags, and explicit routing selectors for text model, image recognition model, speech-to-text model, and text-to-speech model.
- 2026-02-16: Updated AI settings model testing UX to per-model granularity: each model row now has its own Test action so the selected target model is explicit; removed ambiguous provider-level default-model test behavior.
- 2026-02-19: Completed `supportedRoles` migration to model-level schema (`customProviders[].models[].supportedRoles`), removed provider-level role dependency in runtime fallback logic, and updated AI settings UI/metadata template to read and display roles per model with legacy provider-level compatibility fallback.
- 2026-02-19: Fixed Telegram STT URL assembly to honor configured provider `path` (for example Groq `/openai` + `/v1/audio/transcriptions`), and added richer uncaught queue/event error logs including stack traces.
- 2026-02-19: Added user-visible Telegram fallback reply for voice STT failures: bot now proactively reports transcription failure reason and suggested config checks instead of failing silently.
- 2026-02-19: Fixed `ReferenceError: ctx is not defined` in `TelegramMomRunner` constructor by removing constructor-time access to message context; runner now resolves initial model with text route and keeps vision selection in request-time path.
- 2026-02-19: Hardened runner API-key handling for routed models: missing active-model key now returns Telegram-visible settings guidance (no Node crash), and provider key lookup no longer depends on fragile provider-mismatch guard.
- 2026-02-19: Added system-prompt "Failure Recovery Protocol" so agent must continue with diagnosis + fallback steps instead of stopping at capability disclaimers; implemented runtime auto-heal to pick first usable custom model (text/vision) and first `stt`-tagged custom model when explicit routing is absent or invalid.
- 2026-02-19: Added STT observability logs (`voice_transcription_target`/`voice_transcription_success`) and prompt guardrails to reduce config hallucinations (assistant should not claim missing GROQ config/API key unless runtime explicitly reports it).
- 2026-02-19: Fixed false “cannot process audio” replies after successful STT by marking transcript payload as `[voice transcript]` in inbound text and adding explicit prompt rule to treat transcript as ready-to-reason text.
- 2026-02-19: Fixed `/settings/ai` model editor interaction reliability by switching nested provider/model edits to immutable updates keyed by provider id, resolving `+ Add Model` and related controls not reflecting changes.
- 2026-02-19: Fixed `+ Add Model` still showing no input by removing empty-id filtering in provider defaults normalization, so draft model rows remain editable before assigning model id.
- 2026-02-27: Rewrote global profile file `~/.molibot/SOUL.md` with stronger opinionated tone, mandatory brevity, anti-corporate style, and direct-answer opening constraints.
- 2026-02-28: Removed Telegram-specific wording from core mom system prompt (`prompt.ts`) and moved channel-specific formatting guidance lower in the assembled prompt; core event/tool/identity text is now channel-neutral while adapter-selected channel sections remain isolated.
- 2026-02-28: Removed Telegram markdown-format guidance from the prompt channel layer. Telegram output formatting is now handled by the channel send path, and since 2026-06-17 that path delegates rich rendering to grammY/Telegram with plain text fallback.

- 2026-03-01: Added planned item `P1-38 Channel plugin registry architecture` to formalize refactor goal: new channels should register through a plugin contract instead of changing runtime/runner/prompt core files.
- 2026-03-01: Completed channel refactor stage 1 and stage 2 groundwork: mom runtime core now uses channel-agnostic names (`ChannelInboundMessage`, `MomRuntimeStore`, `MomRunner`), memory tool scope no longer hardcodes Telegram, prompt channel type now accepts Telegram/Feishu, and `runtime.ts` now manages built-in channels through a unified registry instead of separate Telegram/Feishu apply branches.
- 2026-03-01: Completed channel refactor stage 3 groundwork: runtime settings now persist a generic `channels` schema (`channels.<plugin>.instances[]`) as internal source of truth, while preserving backward compatibility with legacy `telegramBots` / `feishuBots` settings and current settings pages.
- 2026-03-01: Added external plugin discovery/catalog groundwork. Built-in Telegram/Feishu/plugins remain code-owned; external manifests under `${DATA_DIR}/plugins/**/plugin.json` are now discovered, validated, and visible in the Plugins settings page/API.
- 2026-03-01: Refined built-in channel plugin structure: Telegram/Feishu runtime implementations now live under `src/lib/server/plugins/channels/<name>/runtime.ts`; plugin entry modules live beside them, and per-instance `enabled` toggles now control whether built-in channel plugins load at startup.
- 2026-03-01: Refined built-in channel plugin structure: Telegram/Feishu runtime implementations now live under `src/lib/server/plugins/channels/<name>/runtime.ts`; plugin entry modules live beside them, and per-instance `enabled` toggles now control whether built-in channel plugins load at startup.
- 2026-03-01: Fixed repeated memory lines in prompt previews and runtime memory context by deduplicating exact same content per scope/layer in `src/lib/server/memory/moryCore.ts` and deduplicating rendered prompt memory rows in `src/lib/server/memory/gateway.ts`.
- 2026-03-02: Closed remaining memory dedupe gaps: updating a memory to content that already exists now merges into the existing survivor instead of creating a duplicate, and the agent-side `memory` tool now supports `compact` to trigger the same dedupe cleanup available in the web memory API.
- 2026-03-01: Fixed Feishu inbound media handling in `src/lib/server/channels/feishu/runtime.ts`: non-text messages are no longer dropped at ingress; images now populate `imageContents`, files/media are saved as attachments, and audio/media messages can be transcribed through the configured STT route before entering the runner.
- 2026-03-01: Hardened Feishu message-resource download type resolution: when direct download type mapping is wrong (for example `file_v3_*` audio payloads failing with `type=media`), runtime now retries candidate types and logs the resolved one instead of dropping the message.
- 2026-03-01: Refactored Feishu channel internals so channel-specific inbound parsing, resource download, and STT enrichment live under `src/lib/server/channels/feishu/message-intake.ts`; `runtime.ts` now stays focused on manager lifecycle and runner orchestration.
- 2026-03-01: Added bounded retry to Feishu STT transcription in `message-intake.ts`: failed or empty transcription attempts now retry up to 3 times with short backoff before downgrading to untranscribed voice input.
- 2026-03-01: Fixed Feishu duplicate-response risk in `src/lib/server/channels/feishu/runtime.ts`: manager `stop()` now actively closes the prior `WSClient` connection instead of only dropping the reference, preventing duplicate event subscriptions after repeated `apply()` calls.
- 2026-03-01: Added Feishu plugin-local inbound dedupe keyed by raw `chat_id + message.message_id` before media download/STT, so duplicate WebSocket deliveries are skipped even before entering the generic numeric message log path.
- 2026-03-01: Added plugin developer documentation in `docs/guides/plugins/plugin-development.md`, covering built-in vs external plugin layout, channel/provider contracts, persisted `channels.<plugin>.instances[]` config shape, discovery/load flow, and current runtime limitations.
- 2026-03-03: Added second-stage vision routing behavior in `src/lib/server/agent/runner.ts`: image payloads are sent natively only when the selected custom text model or dedicated vision-route model has `vision` declared and verification-passed; otherwise the runner withholds native image parts and falls back to attachment-based handling.
- 2026-03-03: Added `audio_input` capability groundwork across settings and `/settings/ai/providers`; it can now be declared explicitly, but remains `untested` and does not change runtime audio handling until native audio prompt transport is supported.
- 2026-03-04: Added explicit audio routing decisions in `src/lib/server/agent/runner.ts`. Audio inputs now log whether they are using declared STT fallback or degrading because native audio transport is unavailable, and voice-only messages keep placeholder behavior with a visible notice when no STT target exists.
- 2026-03-07: Added high-visibility locked-user status indicators to web chat (`src/routes/+page.svelte`) in both sidebar and main header, making current identity scope explicit while preserving session-only switching behavior.
- 2026-03-07: Simplified web chat interaction model in `src/routes/+page.svelte`: removed in-chat user switching/add-user controls and agent/profile operation controls from chat surface; user identity is now locked during a session flow and only selectable when creating `New Chat`.
- 2026-03-07: Added `New Chat` user-picker modal in web chat (`src/routes/+page.svelte`): selecting a user in this modal creates a fresh session under that user and persists the user identity, preventing mid-thread user drift across conversation history.
- 2026-03-07: Added web session title editing end-to-end: `SessionStore.renameConversation` and `PUT /api/sessions/:id` now support title updates with ownership validation (`channel + externalUserId + conversationId`) and title sanitization.
- 2026-03-07: Improved web chat sidebar session clarity in `src/routes/+page.svelte`: session item now shows profile label, keeps summary-style title display, and supports inline rename (double-click + Enter/Escape) without leaving chat context.
- 2026-03-07: Fixed chat identity label semantics in `src/routes/+page.svelte`: human-facing labels now show Web profile name (`activeProfileName`) instead of raw userId/external identity fragments, including sidebar status card, session item metadata, header badge, and message actor label.
- 2026-03-07: Added dedicated settings page for Web profiles (`/settings/web`, `src/routes/settings/web/+page.svelte`) with profile CRUD, enabled toggle, linked-agent selection, and profile-level Markdown override editing/saving (`BOT.md`/`SOUL.md`/`IDENTITY.md`/`SONG.md`).
- 2026-03-07: Added Web profile navigation entry in settings shell (`src/routes/settings/+layout.svelte`) and overview card entry (`src/routes/settings/+page.svelte`) so Web profile management is first-class alongside Telegram/Feishu.
- 2026-03-07: Updated profile filesystem mapping (`src/lib/server/agent/profiles.ts`) so `channel=web` bot/profile files resolve to `moli-w/bots/<profileId>` path instead of generic channel directory naming.
- 2026-03-07: Upgraded Web chat request pipeline (`src/routes/api/chat/+server.ts`) from simplified text router path to Mom runner path, adding native support for image/audio attachments, shared model routing behavior with channel runtimes, tool-enabled responses, and profile-scoped web bot workspaces under `~/.molibot/moli-w/bots/<profileId>`.
- 2026-03-07: Added Web profile + user composite identity for session isolation (`src/lib/server/web/identity.ts` + `/api/sessions*` + `/api/chat`): sessions now partition by `profileId + userId`, so different web bot profiles no longer share the same conversation bucket.
- 2026-03-07: Added system prompt preview API for Web (`/api/web/system-prompt`) backed by `buildSystemPromptPreview` and source tracing (`global/agent/bot` instruction file paths), aligned with Telegram/Feishu prompt composition flow.
- 2026-03-07: Extended prompt channel typing to include `web` (`src/lib/server/agent/prompt-channel.ts`, `src/lib/server/agent/runner.ts`) and added default Web channel instance in runtime defaults (`src/lib/server/settings/defaults.ts`) so Web profile agent binding works through the same `settings.channels.<channel>.instances[].agentId` mechanism as bot channels.
- 2026-03-07: Rebuilt web chat UI controls (`src/routes/+page.svelte`) with Telegram-style operator features: web profile switch, user switch/add, active-profile agent selector, image/audio upload composer, and in-page system prompt preview modal with source list.
- 2026-03-07: Added dedicated Web workspace root config (`WEB_WORKSPACE_DIR`, default `~/.molibot/moli-w`) in `src/lib/server/app/env.ts`, surfaced in storage paths (`src/lib/server/infra/db/storage.ts`), and documented in `.env.example`.
- 2026-03-07: Refactored `src/lib/server/sessions/store.ts` so `channel=web` sessions are persisted under Web workspace (`moli-w/users/<user>/sessions/*.json`) with separate Web session index (`moli-w/sessions-index.json`) instead of generic shared `sessions/`.
- 2026-03-07: Added automatic compatibility migration for historical Web sessions: legacy records in `sessions/index.json` + `sessions/*.json` are moved into `moli-w` lazily per user on access, while Telegram/Feishu storage behavior remains unchanged.
- 2026-03-07: Refactored settings shell navigation (`src/routes/settings/+layout.svelte`) to remove misleading sidebar `Chat` menu entry, add explicit `Back To Chat` action, add sticky settings page header, and add mobile-only settings navigation panel so settings routes remain reachable on small screens.
- 2026-03-07: Rebuilt web chat page (`src/routes/+page.svelte`) from minimal draft to production-ready workspace layout: improved visual hierarchy, mobile session drawer, session search, quick prompt chips, Enter-to-send with Shift+Enter newline, adaptive composer auto-resize, loading/thinking states, and auto-scroll behavior for new messages.
- 2026-03-07: Improved Telegram adapter observability in `src/lib/server/channels/telegram/runtime.ts` by adding `botId` to startup/apply logs (`apply`, `disabled_no_token`, `apply_noop_same_token`, `allowed_chat_ids_loaded`, `adapter_start_failed`) so token/auth failures can be traced to the exact bot instance.
- 2026-03-07: Added Telegram single-instance auth-failure circuit breaker in `src/lib/server/channels/telegram/runtime.ts`: if startup returns `401 Unauthorized`, only the failing `botId` is auto-disabled via runtime settings update (`channels.telegram.instances[].enabled=false`) and a dedicated `instance_disabled_auth_failed` log is emitted, so one bad token no longer drags the whole Telegram plugin surface into repeated start-fail noise.
- 2026-03-07: Updated Web chat input UX in `src/routes/+page.svelte`: audio is no longer chosen as file attachment. Added realtime voice recorder control (`Record Voice` -> `Stop & Send`) using browser microphone capture (`MediaRecorder`), automatic voice-file packaging/sending, and recording lifecycle cleanup on component destroy.
- 2026-03-07: Fixed cross-page settings rollback bug in `src/lib/server/app/runtime.ts`: `updateSettings` now loads latest persisted settings before patch-merge and save, avoiding stale runtime snapshots from overwriting newer Telegram bot lists when saving unrelated settings (for example Web Profiles).
- 2026-03-07: Migrated settings persistence to a hybrid model in `src/lib/server/settings/store.ts`: `customProviders`/`channels`/`agents` now persist in `~/.molibot/settings.sqlite` (`settings_dynamic` table, per-domain row upsert), while stable bootstrap fields persist in `settings.json`; load path merges DB-over-JSON and keeps legacy Telegram/Feishu compatibility fields derived from channel instances.
- 2026-03-07: Fixed channel cross-overwrite bug in `src/lib/server/app/runtime.ts`: `sanitizeChannels` now starts from current channel map and overlays incoming patch keys, preventing partial settings updates (for example saving only Web profiles) from deleting unrelated channel instances like Telegram bots.
- 2026-03-07: Normalized dynamic settings schema in `src/lib/server/settings/store.ts`: added per-entity tables for agents, channel instances, custom providers, and provider models, with transactional replace-write semantics and read-time reconstruction into runtime settings objects; legacy `settings_dynamic` rows remain as fallback source for migration compatibility.
- 2026-03-08: Added built-in QQ channel integration baseline aligned with Telegram/Feishu runtime shape: new `src/lib/server/channels/qq` plugin (QQ gateway websocket + token auth + inbound text handling + runner queue + command set), channel registration in runtime plugin registry, runtime/settings schema support for `channels.qq.instances` + `qqBots` compatibility field, and new Settings UI route `/settings/qq` for multi-bot credentials/agent binding/profile markdown editing.
- 2026-03-08: Added high-signal QQ inbound trace log in `src/lib/server/channels/qq/runtime.ts` (`message_received_raw`) to print `chatId/userId/groupOpenid/channelId/guildId/messageId/textPreview` for each received event, making first-time ID discovery and whitelist setup operable from runtime logs.
- 2026-03-08: Fixed QQ duplicate final reply risk by changing `replaceMessage` semantics in `src/lib/server/channels/qq/runtime.ts` to avoid re-sending full text when the channel lacks true message-edit capability.
- 2026-03-08: Added QQ inbound media intake baseline in `src/lib/server/channels/qq/runtime.ts`: attachments are now downloaded from `attachments[].url` / `voice_wav_url`, saved via `store.saveAttachment`, images are injected into `imageContents`, and media-only inbound events are no longer dropped as empty text.
- 2026-03-08: Fixed QQ reply `msg_id` misuse in `src/lib/server/channels/qq/runtime.ts`: channel no longer chains bot-generated message IDs as subsequent reply targets, preventing `40034024 msg_id invalid/unauthorized` storms on multi-chunk outputs.
- 2026-03-08: Improved QQ voice intake compatibility by treating `.amr` / `.silk` as audio in both QQ intake (`runtime.ts`) and attachment classification (`src/lib/server/agent/store.ts`), so runner audio route can detect voice input instead of `no_audio`.
- 2026-03-08: Added credential visibility toggles (Show/Hide) in bot settings pages for Telegram token, Feishu App Secret, and QQ App Secret to support manual verification of sensitive input values without leaving settings.
- 2026-03-08: Added agent MCP integration baseline: introduced `RuntimeSettings.mcpServers` (with env bootstrap `MOLIBOT_MCP_SERVERS`), persisted it in settings storage/API, added `src/lib/server/agent/mcp.ts` stdio MCP registry using `@modelcontextprotocol/sdk`, and wired runner to auto-merge MCP tools with built-in tools per run while treating MCP connection failures as non-fatal warnings.
- 2026-03-08: Added MCP Settings UI (`/settings/mcp`) with visual CRUD for MCP servers and integrated MCP metadata into Skills inventory; updated skill loading/frontmatter parser to support `mcpServers`/`mcp_servers`, and switched runner MCP exposure to skill-gated mode (MCP hidden by default, injected only when an explicitly invoked skill declares corresponding server IDs).
- 2026-03-08: Simplified MCP settings experience to JSON-first input on `/settings/mcp` (supports direct map or `{ "mcpServers": { ... } }`), auto-parses server entries into a list with per-server enabled toggle, and added end-to-end HTTP MCP server support (`type: "http"`, URL/headers) alongside stdio in settings sanitization, API parsing, runtime sync, and MCP client connection.
- 2026-03-08: Adjusted MCP activation strategy to preserve existing skills framework: MCP enablement no longer depends on `SKILL.md` frontmatter (`mcpServers`/`mcp_servers`). Instead, explicit skill invocation opens MCP tools (from enabled MCP servers) for that run, and system prompt now requires explicit "missing MCP server/tool" error reporting when MCP is needed but unavailable.
- 2026-03-08: Added runtime MCP control tool `load_mcp` (actions: `list` / `load` / `unload` / `clear`) and wired runner session state to support explicit MCP server selection per chat; tool now errors clearly for missing/disabled MCP server IDs and refreshes MCP tool availability immediately after load/unload.
- 2026-03-08: Added skills temporary disable capability: introduced runtime setting `disabledSkillPaths`, added `Enable/Disable` switches on `/settings/skills` backed by `/api/settings` updates, surfaced enabled state in skills API, and made all runtime skill loaders (runner, prompt rendering, Telegram/Feishu/QQ `/skills`) skip disabled skill files while keeping them on disk.
- 2026-03-08: Updated stop semantics across Telegram/Feishu/QQ to interrupt the active run immediately on `stop` or `/stop` (including plain `stop` in Feishu/QQ command parsing), while preserving queued user messages so the next queued task can continue after the abort.
- 2026-03-08: Strengthened stop responsiveness for long-running MCP/tool calls: MCP client tool execution now forwards abort signals into SDK `callTool` requests, and Telegram/Feishu/QQ stop paths now release per-chat running guards immediately after abort, preventing `/new` from being blocked by slow shutdown tails while keeping queue entries intact.
- 2026-03-08: Implemented prompt refresh-on-change strategy in `runner.ts`: added prompt refresh key fingerprinting over prompt-relevant settings and switched to conditional `setSystemPrompt` updates (refresh on relevant settings change or new runner, reuse otherwise) to reduce avoidable cache invalidation while still applying settings/skills enable-disable updates on the next message.
- 2026-03-14: Started web productization UI refactor (phase A/B kickoff) on `src/routes/+page.svelte`: upgraded chat workspace visual hierarchy with atmospheric background layer, polished sidebar/session cards, denser operator header chips, message bubble metadata (send time), improved composer container styling, and stronger modal elevation while preserving existing chat/settings API logic.
- 2026-03-14: Aligned chat UI to shadcn-like standard baseline in `src/routes/+page.svelte`: removed decorative visual effects and custom accent-heavy treatments, standardized core surfaces to card/muted/border semantics, simplified interactive states, and kept existing chat runtime behavior unchanged.
- 2026-03-14: Switched site-wide theme foundation to shadcn default tokens (`src/styles/theme.css`) and refactored global settings-surface normalization (`src/app.css`) so all `/settings` subpages inherit the same neutral default style baseline without page-by-page visual drift. Also changed chat/settings theme fallback from `system` to `light` (`src/routes/+page.svelte`, `src/routes/settings/+layout.svelte`) to make default startup theme deterministic.
- 2026-03-14: Completed settings-shell standardization pass: updated settings navigation/header active states to neutral shadcn-style semantics (`src/routes/settings/+layout.svelte`), rebuilt settings overview page into unified card directory (`src/routes/settings/+page.svelte`), and expanded `settings-theme` control normalization for button/link/input interaction consistency across all settings subpages (`src/app.css`).
- 2026-03-14: Applied explicit settings-page standardization hook across every settings route component (`src/routes/settings/**/+page.svelte`) by adding shared `settings-page` wrapper class, so all existing settings views now share the same global design-system normalization contract in `src/app.css` instead of relying on per-page ad-hoc styling behavior.
- 2026-03-14: Added final normalization pass for settings surfaces in `src/app.css`: removed residual gradient/heavy-shadow/emerald-accent visual noise, standardized hover/focus/border behavior, and forced legacy dark-style class combinations onto the same neutral default card/muted/ring semantics used by the global theme tokens.
- 2026-03-14: Introduced reusable UI primitives (`src/lib/ui/Button.svelte`, `src/lib/ui/Card.svelte`, `src/lib/ui/Alert.svelte`, `src/lib/ui/PageShell.svelte`) and migrated every settings route entry (`src/routes/settings/**/+page.svelte`) to the shared `PageShell` wrapper so page structure now uses common components instead of per-file root containers; settings overview now renders cards through the shared `Card` component and agents page uses shared `Alert` for status/error notices.
- 2026-03-14: Expanded shared-component migration inside settings pages: migrated high-frequency action/status UI from raw HTML to shared components (`Button`/`Alert`) across `memory`, `tasks`, `telegram`, `feishu`, `qq`, `web`, `mcp`, `plugins`, and `skills`; also fixed `PageShell` wrapper boundary regressions on `memory/plugins/skills` after initial bulk migration.
- 2026-03-14: Continued shared-component enforcement pass for settings forms and action bars: migrated remaining critical action buttons from `agents`, `ai/routing`, `ai/providers`, and task row actions to shared `Button` variants, replacing ad-hoc per-page CTA styling with unified component semantics.
- 2026-03-14: Fixed Svelte compile break on `src/routes/settings/memory/+page.svelte` after shared-component migration by removing an extra unmatched closing `</div>` near the page footer, restoring valid `PageShell` boundary structure for production build.
- 2026-03-15: Fixed Telegram long-message failures (`400 Bad Request: message is too long`) by adding automatic text chunking in `src/lib/server/channels/telegram/formatting.ts` (`sendTelegramText` now splits oversized payloads and sends sequential chunks), and updated high-volume command outputs in `src/lib/server/channels/telegram/runtime.ts` (`/help`, `/skills`, `/models` branches) to use chunked sending consistently. Also replaced remaining direct `bot.api.sendMessage` calls in runtime failure/abort paths with `sendTelegramText` so all oversized responses can degrade safely instead of throwing.
- 2026-03-15: Reduced unnecessary MCP auto-loading attempts in agent runtime: `load_mcp` tool is no longer always exposed. It is now injected only when the current user input explicitly invokes a skill (`$...`, `/skill ...`, `skill:...`, `技能:...`) or when the session already has selected MCP servers (`src/lib/server/agent/runner.ts`, `src/lib/server/agent/tools/index.ts`). Added prompt guardrails to prevent mapping skill names directly to MCP server IDs (`src/lib/server/agent/prompt.ts`).
- 2026-03-15: Tightened MCP isolation policy to remove skill/MCP ambiguity: MCP is now available only in two explicit scenarios (`src/lib/server/agent/runner.ts`): (1) user explicitly asks to use MCP (e.g. "使用MCP"/"加载MCP"/"use MCP"), or (2) user explicitly invokes a skill and that skill declares MCP dependencies (`mcpServers`). Generic skill invocation no longer unlocks MCP by default, and prompt policy was updated accordingly (`src/lib/server/agent/prompt.ts`).
- 2026-03-15: Improved Telegram `/models` operator clarity in `src/lib/server/channels/telegram/runtime.ts`: model list output now includes explicit top-level lines for `Current active model` and `Current active key` (not just inline `(active)` markers), and `/help` command descriptions for `/models` were rewritten to match real behavior and emphasize active-model visibility.
- 2026-03-15: Fixed stale `SYSTEM_PROMPT.preview.md` refresh behavior in Telegram runtime (`src/lib/server/channels/telegram/runtime.ts`): preview file now rewrites in no-op reapply path (`apply_noop_same_token`) and after session lifecycle commands (`/new`, `/clear`, `/sessions <selector>`), so operators can see prompt/skill state changes reflected immediately instead of waiting for process restart.
- 2026-03-17: Slimmed skill guidance in `src/lib/server/agent/prompt.ts` with conditional `skill-creator` fast-path (active only when `~/.molibot/skills/skill-creator/SKILL.md` exists), removed prompt `Skill Diagnostics`, removed `base_dir` from prompt skill inventory output, and added shared YAML frontmatter parser (`src/lib/server/agent/skillFrontmatter.ts`) to correctly parse multiline `description` blocks (`>` / `|`) for both runtime skill loading and `/api/settings/skills` inventory.
- 2026-03-17: Added explicit slash skill invocation normalization across `src/lib/server/agent/skills.ts`, `src/lib/server/agent/runner.ts`, and `src/lib/server/agent/prompt.ts`: direct `/skill-name` and `/skill-name@bot` inputs now count as explicit skill selection, normalized aliases ignore case and treat spaces/underscores/hyphens as equivalent, runner appends an `[explicit skill invocation]` block before model execution, and MCP skill-gating now follows the same explicit matcher.
- 2026-03-18: Fixed explicit skill path drift for bot-scoped skills by enriching runner-injected `[explicit skill invocation]` entries with `name/scope/skill_file` and adding a hard guard in skill protocol that `SKILL.md` must never be executed directly with `sh/bash` (read file first, then run documented scripts/commands).
- 2026-03-21: Added explicit ACP provider split under `src/lib/server/acp/providers/` with separate `codex.ts` and `claude-code.ts` profiles, introduced `adapter` metadata for ACP targets plus dual default presets, changed `/acp add-project` to allow all enabled targets by default instead of hardcoding Codex, and unified Telegram/UI command presentation so the same `/acp ...` flow works across Codex and Claude Code while remote adapter commands are rendered with provider prefixes.
- 2026-03-21: Fixed post-review ACP follow-ups by respecting explicit `adapter: "custom"` without re-inferring it back to Codex/Claude behavior, updated `docs/requirements/acp-multi-provider-mvp.md` to match the now-shipped multi-provider ACP behavior, and added the new `src/lib/server/acp/providers/` files to version control so the refactor cannot land with missing imports.
- 2026-03-22: Added `/acp remote <command> [args]` in Telegram ACP control flow and implemented provider-aware command parsing in `src/lib/server/acp/service.ts` (supports optional `codex:/...` / `claude-code:/...` prefixes, validates against session `availableCommands` when present, and forwards the resolved command as the ACP prompt).
- 2026-03-22: Fixed Telegram ACP subcommand argument parsing edge case in `src/lib/server/channels/telegram/runtime.ts`: `/acp remote` and `/acp task` without payload no longer fall through as literal `remote` / `task` commands; they now correctly return usage guidance and avoid unintended remote-command execution.
- 2026-03-22: Added active-session ACP default proxy mode in `src/lib/server/channels/telegram/runtime.ts`. When ACP is active, non-control messages are sent directly to ACP (no `/acp task` prefix required), while `/acp ...` / `/approve ...` / `/deny ...` remain control-plane commands.
- 2026-03-22: Generalized ACP into a channel-wide capability. Added shared ACP prompt/help/permission text in `src/lib/server/acp/prompt.ts`, wired Feishu and QQ runtimes to the same `/acp` / `/approve` / `/deny` controls plus active-session default proxy mode, and updated `docs/requirements/acp-multi-provider-mvp.md` to describe Telegram, Feishu, and QQ instead of Telegram-only behavior.
- 2026-03-22: Extended the same ACP control surface to `src/lib/server/channels/weixin/runtime.ts`, including `/acp` commands, `/approve` / `/deny`, provider-aware remote commands, and active-session default proxying so Weixin now behaves like Telegram, Feishu, and QQ.
- 2026-03-23: Fixed build failure after upgrading `@mariozechner/pi-ai` to `0.62.x` by moving runtime OAuth helper imports in `src/lib/server/agent/auth.ts` onto the new `@mariozechner/pi-ai/oauth` entrypoint; verified by rerunning `npm run build`.
- 2026-03-24: Hardened upgraded agent runtime around the new `pi-agent-core` control surface: added centralized tool preflight blocking for destructive bash / protected settings-auth-secret file edits / reminder-like memory misuse, serialized mutating tools to prevent parallel write races, and tightened custom model routing so text vs vision tasks only select capability-matching models while Agent session/transport update per active route.
- 2026-03-24: Continued the upgrade on the pure engineering side by extracting shared Agent runtime options into `src/lib/server/agent/runtimeOptions.ts` and wiring both runtime Agent call sites to the upgraded transport preference plus `maxRetryDelayMs`, so transport behavior stays aligned and long server-requested retry sleeps are capped across both runner and assistant-service paths.
- 2026-03-24: Added a real custom-provider thinking path instead of a fake capability flag: AI settings now store `defaultThinkingLevel` plus provider-specific thinking metadata, the runner and legacy assistant path both map `off/low/medium/high` into provider-compatible request fields, and the settings UI now exposes those controls so custom providers can actually turn thinking on.
- 2026-03-24: Updated ACP progress behavior to match the channel-display design: ACP now emits normalized progress events, Telegram renders one edited progress message with `Current + settled history` while dropping transient `pending` lines from history, and the shared ACP proxy decision is centralized so active ACP sessions keep slash-style inputs such as `/review` on the remote coding side unless they are reserved ACP control commands.
- 2026-03-24: Fixed a Telegram ACP startup regression after the progress-display refactor: removed one leftover old control-command check in the Telegram middleware so the bot no longer crashes with `isAcpControlCommandText is not defined` during inbound message handling.
- 2026-03-24: Fixed Telegram ACP topic leakage after the progress/proxy refactor: ACP session routing, proxy input, approvals, deny-with-note flow, and progress/result messages now all key off the topic-scoped Telegram conversation id and keep replies inside the originating forum topic instead of collapsing to the parent supergroup chat id.
- 2026-03-24: Opened up the chat black box for normal Web use: the chat header now has a per-send thinking selector (`off/low/medium/high`), text messages go through a real runner-backed stream endpoint, the page shows request/payload trace plus captured thinking content, and streamed assistant text no longer waits for the final full response before appearing.
- 2026-03-24: Wired runner message-update deltas through the shared channel context so Telegram can consume incremental assistant text from the upgraded agent event stream instead of relying only on final `message_end` output, keeping Web and Telegram on the same lower-level streaming path.
- 2026-03-24: Tightened the new thinking/stream UX after live testing: Web assistant cards now keep the thinking/request block above the final answer inside a collapsible panel, and Telegram no longer edits on every tiny delta or waits out multi-minute rate-limit retries for intermediate stream updates.
- 2026-03-24: Fixed a Telegram duplicate-reply path in stream mode: when editing the in-place status message fails, runtime no longer blindly sends the same answer again as a fresh message except when the old edit target is genuinely gone, and Telegram now logs both requested/effective thinking level plus payload reasoning summary so operators can verify whether a run actually used thinking.
- 2026-03-25: Added Telegram operator controls for session state: `/status` and `/state` now summarize the active session, queue, stream mode, route models, and next-request thinking behavior, while `/thinking` stores a session-local override in the session header so one chat session can switch reasoning depth without touching the global default or newly created sessions.
- 2026-03-25: Reworked skill invocation handling in `src/lib/server/agent/prompt.ts`, `skills.ts`, and related command surfaces: removed hardcoded skill-name hints from the prompt, added generic explicit-skill rules based on the Claude-style loading semantics, taught slash invocation matching to honor both frontmatter `name` and skill directory aliases, injected aliases into `[explicit skill invocation]`, and updated `/skills` outputs to show those aliases so path mismatches are easier to spot.
- 2026-03-25: Added Claude-style but runtime-adapted tool/memory governance rules to `src/lib/server/agent/prompt.ts` and `src/lib/server/agent/prompts/TOOLS.template.md`: dedicated tools are now explicitly preferred over bash when equivalent, independent tool calls are encouraged to run in parallel, and memory usage is constrained to stable cross-session facts with explicit stale-check/update behavior.
- 2026-03-25: Refactored prompt assembly in `src/lib/server/agent/prompt.ts` to front-load execution discipline, skill routing, tools, safety, and memory rules ahead of environment/runtime detail; compressed `Available Skills` to short descriptions in `skills.ts`; and trimmed `Current Memory` injection to a bounded snapshot so irrelevant long-form memory content no longer dominates the live system prompt.
- 2026-03-26: Added shared memory classification in `src/lib/server/memory/classifier.ts` and routed both gateway writes and backend auto-flush capture through it. New memories now carry class tags such as collaboration, user preference, project context, reference, lifestyle, and temporary; prompt memory selection now prefers high-value classes and suppresses lifestyle noise unless the active request is actually about it.
- 2026-03-26: Hardened the runtime prompt for general-purpose agent use, not just coding workflows. Added explicit task-framing, real-time verification, external-content prompt-injection resistance, and broad high-impact-action confirmation rules; also removed the old “just `cat`/`rm` event files” tone in favor of safer event inspection/cancellation guidance.
- 2026-03-26: Cleaned up the long-term profile templates in `src/lib/server/agent/prompts/`: `AGENTS` now focuses on collaboration contract, `IDENTITY` only defines stable role, `SOUL` keeps communication/judgment style without drifting into performative harshness, `USER` now prioritizes collaboration-relevant facts over generic lifestyle detail, and `BOOTSTRAP` was reduced to a minimal post-init stub.
- 2026-03-26: Added an explicit “use existing capability before coding” decision ladder to `src/lib/server/agent/prompt.ts` and `src/lib/server/agent/prompts/TOOLS.template.md`. Requests like voice reply, image generation, search, or reminders are now framed as result requests first; the agent must try matching skills or dedicated runtime tools before it is allowed to fall back to workspace changes or code-writing.
- 2026-03-26: Fixed a real Weixin inbound media gap in `src/lib/server/channels/weixin/media.ts`: voice/file/video downloads no longer require `media.aes_key` to be present in exactly one format. The runtime now accepts the reference SDK’s optional-key reality, normalizes hex `aeskey` when provided, and falls back to plain CDN download when the key is omitted, so voice and file messages are no longer silently dropped before they reach the agent. Added focused verification in `src/lib/server/channels/weixin/media.test.ts`.
- 2026-03-26: Fixed a reply-side capability miscue in `src/lib/server/agent/tools/attach.ts`: the attachment tool no longer advertises itself as Telegram-only. That wording was leaking into agent behavior and could make Weixin sessions incorrectly conclude that image/audio/file replies were unsupported even before attempting channel upload.
- 2026-03-26: Added high-signal diagnostics to `src/lib/server/channels/weixin/outbound.ts` for blank CDN upload failures. When the CDN rejects an upload, the error now includes source file name, media type, target CDN host/path, upload parameter length, file key, and plaintext/ciphertext sizes so the next live retry can reveal whether the request shape or endpoint is wrong.
- 2026-03-26: Fixed a shared explicit-skill weakness in `src/lib/server/agent/runner.ts` and `src/lib/server/agent/prompt.ts`. Explicit slash skill invocation no longer relies only on a lightweight `[explicit skill invocation]` marker; the runner now injects the actual `SKILL.md` body as `[explicit skill file]` context for that turn, making skill execution behavior channel-agnostic and much harder for the model to ignore.
- 2026-03-26: Hardened `~/.molibot/skills/image-generate/SKILL.md` so image outputs must stay inside the active chat workspace and never go to `/tmp` or the skill directory, which was breaking later attachment sending. Also upgraded `src/lib/server/agent/tools/bash.ts` + `truncate.ts` + `helpers.ts` so long bash output now preserves both the opening context and the ending result, while collapsing repeated carriage-return progress noise like `curl` bars. Added focused coverage in `src/lib/server/agent/tools/bash-output.test.ts`.
- 2026-03-26: Cleaned up the shared `image-generate` skill to remove user-specific absolute paths. The skill now requires the caller to provide the output path explicitly and describes `generate.py` generically as living under the skill directory, so other users can reuse the same skill without editing hardcoded local paths.
- 2026-03-26: Expanded `src/lib/server/channels/weixin/outbound.ts` diagnostics to print the complete local upload context for failing media sends: full `getuploadurl` request body, returned `upload_param`, exact CDN upload URL and request headers, plus chunked raw CDN response body. This makes the next live failure actionable instead of leaving only a blank `400`.
- 2026-03-26: Aligned `src/lib/server/channels/weixin/outbound.ts` with the published Weixin upload protocol. CDN upload now sends the query parameter as `encrypted_query_param` (not the previously wrong `upload_param`), stops adding the extra `X-WECHAT-FILEKEY` header, and accepts the returned media token from the `x-encrypted-param` response header, which matches the documented successful upload flow.
- 2026-03-26: Reworked the Weixin channel boundary so `package/weixin-agent-sdk` is now explicitly treated as the third-party transport base instead of letting Molibot’s local `sdk/` folder continue drifting into a separate homegrown stack. Shared protocol types are now re-exported from the vendored SDK, the local QR login flow delegates to the vendored login implementation, and the root README plus `package/weixin-agent-sdk/README.md` now mark that directory as third-party vendored code.
- 2026-03-26: Finished hardening that Weixin vendored-SDK integration for real builds: replaced the fragile long relative imports with a package-level `#weixin-agent-sdk/*` entry, and marked `qrcode-terminal` as a server-side external so production build no longer breaks while QR rendering stays optional at runtime.
- 2026-03-26: Fixed the Weixin outbound media-key encoding bug in `src/lib/server/channels/weixin/outbound.ts`. CDN upload was succeeding, but sent image/file/voice messages were still carrying `aes_key` in the wrong format for downstream clients, which made WeChat render gray placeholder media instead of the real asset. Outbound media messages now encode `aes_key` in the same format expected by the Weixin message protocol.
- 2026-03-26: Fixed Weixin outbound audio misclassification in `src/lib/server/channels/weixin/outbound.ts`. Formats like `AIFF/AIF` were not being recognized as sendable voice, so the runtime fell back to plain file attachments. Unsupported audio is now transcoded before send and kept on the voice-message path instead of being dumped as a dead attachment.
- 2026-03-26: Filled in missing Weixin voice-message metadata in `src/lib/server/channels/weixin/outbound.ts`. Outbound voice sends now include playtime, sample rate, and bit depth gathered from `ffprobe` (with safe defaults), so the client gets a fuller voice item instead of just a bare file reference plus `encode_type`.
- 2026-03-26: Stopped forcing unsupported outbound audio through `mp3` in `src/lib/server/channels/weixin/outbound.ts`. The vendored `silk-transcode.ts` only decodes inbound SILK and cannot create outbound SILK, and this machine has no SILK/AMR encoder available, so generic audio now transcodes to mono 24k WAV/PCM for the voice-message path instead of pretending `mp3` is the dedicated Weixin voice format.
- 2026-03-26: Tightened the Weixin audio fallback in `src/lib/server/channels/weixin/outbound.ts`. When the runtime cannot produce a native-format Weixin voice bubble on this machine, it no longer sends a likely-to-be-ignored pseudo-voice item and leaves only the caption behind. Instead it falls back to a real audio file attachment, so the user still receives the generated sound file rather than just text.
- 2026-03-26: Aligned outbound Weixin voice messages more closely with the published protocol by including the optional `voice_item.text` transcript field alongside `encode_type`, `bits_per_sample`, `sample_rate`, and `playtime`. The vendored SDK still only sends the minimal voice shape by default; Molibot’s bridge now fills in the richer payload so speech replies can carry their text result too.
- 2026-03-26: Added real outbound SILK encoding for Weixin voice replies. Installed `silk-wasm`, changed the voice send path in `src/lib/server/channels/weixin/outbound.ts` to transcode generic audio into 24k mono WAV first and then encode it to `.silk`, and now send that result as native-format Weixin voice instead of pretending `mp3` is the dedicated voice format.
- 2026-03-27: Increased Telegram outbound retry depth in `src/lib/server/channels/telegram/formatting.ts` from 3 total attempts to 7 total attempts, including `sendChatAction`, so transient network resets such as `ECONNRESET` and `socket hang up` have a much better chance to recover before a run is marked failed.
- 2026-03-27: Fixed a Weixin outbound voice regression in `src/lib/server/channels/weixin/outbound.ts` and `src/lib/server/channels/weixin/sdk/api.ts`. Voice replies no longer prepend the attachment title as a separate text message or stuff that title into `voice_item.text`, which had made logs and loopback handling look like plain text instead of voice. The send-message client also now treats non-zero Weixin `ret/errcode` as real failures instead of silently accepting them. Added focused coverage in `src/lib/server/channels/weixin/outbound.test.ts`.
- 2026-03-27: Tightened the same Weixin voice path after live inspection showed “nothing arrived” once the standalone title text was removed. Outbound media items now also carry the hex `aeskey` field alongside the CDN media reference, and voice replies keep the title only inside the voice item instead of sending a separate text message first. Added send-mode diagnostics so the next live attempt can reveal whether the bridge actually took the voice path or fell back to file.
- 2026-03-27: Updated the attachment tool and Weixin voice path so audio replies can carry the full spoken script separately from the short file title. When the agent provides full text, Weixin now stores that full text on the voice message itself and uses it as the readable fallback instead of a short label like “笑话语音”.
- 2026-03-27: Changed Weixin audio replies to a simpler, user-visible fallback that matches current client behavior. Instead of trying to send a native voice bubble, the bot now replies with two separate messages: first the full text content, then a real `MP3` file attachment. This removes the invisible pseudo-voice path and guarantees users still get both readable text and a playable audio file.
- 2026-03-27: Refactored the multi-channel runtimes around a shared text-channel skeleton. Added `src/lib/server/channels/shared/baseRuntime.ts` and `contextBuilder.ts`, moved Feishu/QQ/Weixin onto shared queue/dedupe/stop/prompt-preview/context assembly, kept Telegram’s streaming and ACP interaction logic local while still reusing the shared safe core, and added focused shared-layer tests in `src/lib/server/channels/shared/*.test.ts`.
- 2026-03-28: Hardened Weixin outbound delivery reliability and observability. `src/lib/server/channels/weixin/sdk/api.ts` now retries transient `sendmessage` failures and logs each attempt / retry / success / final failure; `src/lib/server/channels/weixin/runtime.ts` now records per-chat delivery attempts to `delivery.jsonl` and logs whether each outgoing text reply actually went out or failed. Added focused retry coverage in `src/lib/server/channels/weixin/outbound.test.ts`.
- 2026-03-28: Fixed a cross-model empty-response regression in the shared runner path. `src/lib/server/agent/runner.ts` no longer monkey-patches the model stream object just to log first-token timing; that timing is now captured from real assistant text-delta events instead. `src/lib/server/agent/log.ts` also no longer auto-switches to pretty stdout formatting on any TTY unless `MOM_LOG_PRETTY=1` is explicitly enabled, reducing the risk of logging behavior changing runtime behavior unexpectedly.
- 2026-03-28: Fixed a runner request-path regression introduced by new diagnostics in `src/lib/server/agent/runner.ts`. The stream callback no longer reads an out-of-scope `ctx` variable while logging `llm_request_sent`; this runtime `ReferenceError` was aborting every provider attempt before any real model response could be consumed and surfaced as repeated empty-response failures.
- 2026-03-28: Fixed the Weixin “only shows progress, never sends final answer” bug in `src/lib/server/channels/weixin/runtime.ts`. When the channel cannot edit a previous message, final replacement text now triggers a real follow-up send instead of only updating internal state, so queries like “今日金价” no longer end at “搜索中”.
- 2026-03-28: Fixed the QQ “only shows progress, never sends final answer” bug in `src/lib/server/channels/qq/runtime.ts`. When QQ lacks edit capability and progress text has already been sent, final replacement text now triggers a real follow-up send instead of being swallowed by state-only replacement logic.
- 2026-03-28: Weixin outbound text now uses vendored SDK markdown conversion (`markdownToPlainText`) before sending, so markdown tables/fences/format symbols are flattened for WeChat delivery. Also removed the local redundant SDK barrel file `src/lib/server/channels/weixin/sdk/index.ts` and switched imports to direct module paths (`sdk/client.ts` / `sdk/types.ts`) to reduce duplicate routing entry points.
- 2026-03-28: QQ outbound text now converts Markdown to plain text before delivery in `src/lib/server/channels/qq/runtime.ts` (same conversion rules as Weixin reference), so tables/code fences/format symbols are flattened for QQ display. This conversion is applied at the shared `sendText` exit, covering normal replies, progress-to-final follow-up replies, and command outputs.
- 2026-03-28: Continued Weixin migration phase-2 with rollback-safe type-layer thinning. Removed local `src/lib/server/channels/weixin/sdk/types.ts` and switched `media.ts` / `outbound.ts` / `sdk/api.ts` / `sdk/client.ts` / `media.test.ts` to direct `#weixin-agent-sdk/src/api/types.js` imports, keeping runtime send/receive behavior unchanged while shrinking one extra local wrapper layer.
- 2026-03-28: Continued Weixin migration phase-2 with login/poll wrapper thinning. `src/lib/server/channels/weixin/sdk/client.ts` now directly calls vendored `getUpdates/getConfig/sendTyping` while preserving existing relogin behavior for session-expired (`-14`) cases, and `src/lib/server/channels/weixin/sdk/api.ts` removed now-unused local relay functions (`getUpdates/getConfig/sendTyping/buildTextMessage`) to further reduce local indirection.
- 2026-03-28: Continued Weixin migration phase-2 with credential-storage thinning. `src/lib/server/channels/weixin/sdk/auth.ts` now syncs successful login credentials into vendored account storage (`save/register`) and clears linked vendored account data on local credential cleanup, while preserving per-bot workspace isolation by keeping `tokenPath` reads strictly local when provided.
- 2026-03-28: Completed direct Weixin SDK cutover per product decision. Removed local `src/lib/server/channels/weixin/sdk` directory (`api.ts`/`auth.ts` dropped; client bridge moved to `src/lib/server/channels/weixin/client.ts`), updated runtime/media/outbound references, and switched file-send path to direct vendored account/API calls without local credentials wrapper or local send API wrapper.
- 2026-04-02: Fixed Weixin long-text truncation-at-first-chunk behavior in `src/lib/server/channels/weixin/client.ts` by sending chunked replies with one shared `client_id`, marking intermediate chunks as `GENERATING` and only the last chunk as `FINISH`, so a large reply can continue instead of stopping after the first segment.
- 2026-04-02: Hardened send-result validation in `package/weixin-agent-sdk/src/api/api.ts` (and `types.ts`) so `sendMessage` now checks Weixin business codes (`ret/errcode`) and throws on non-zero responses instead of silently treating HTTP 200 as success.
- 2026-04-02: Added focused Weixin chunk-send regression coverage in `src/lib/server/channels/weixin/client.test.ts` for both long-text chunk state sequencing and non-zero `sendmessage` business-code failure surfacing.
- 2026-04-03: Fixed AI provider-mode misrouting across `src/lib/server/agent/runner.ts`, `src/lib/server/app/runtime.ts`, and `src/routes/settings/ai/providers/+page.svelte`: `providerMode=custom` now only resolves real custom providers (excluding built-in ids), runtime sanitization no longer keeps built-in ids as `defaultCustomProviderId`, and Providers UI blocks setting built-in providers as custom default target, preventing false `custom provider requires baseUrl, apiKey, and at least one model` errors when built-in providers are enabled.
- 2026-04-03: Fixed Web chat `Already working` lockups by consolidating web runner context into shared `src/lib/server/web/runtimeContext.ts` (so `/api/chat` and `/api/stream` operate on the same runner pool), adding explicit stop API `POST /api/stream/stop`, wiring request-abort -> `runner.abort()` in `src/routes/api/stream/+server.ts`, and adding a user-facing Stop control in `src/routes/+page.svelte` to force-cancel stuck background runs.
- 2026-04-04: Improved skill-invocation stability and disambiguation in `src/lib/server/agent/skills.ts` and `src/lib/server/agent/runner.ts`: explicit skill patterns now recognize slash/inline forms anywhere in text, normalize selector aliases consistently, avoid URL-like false positives, and resolve alias conflicts deterministically with `exact-name > scope(chat > bot > global)` priority. Also removed language-bound MCP/skill trigger wording and switched to language-agnostic structured forms (`/skill`, `$skill`, `label:skill`, `/label skill`) plus standalone `mcp` token detection. Added focused regression tests in `src/lib/server/agent/skills.test.ts`.
- 2026-04-11: Added the first self-evolution runtime loop in `src/lib/server/agent/runner.ts` and related modules. Complex successful runs now enforce basic tool/model budgets, write structured per-chat run summaries to `run-summaries.jsonl`, emit a compact closing summary after tool-heavy work, and auto-save a reusable workflow draft under `skill-drafts/` when no explicit skill already covered the task.
- 2026-04-11: Extended the self-evolution loop with per-run memory snapshots and richer reflection output. `src/lib/server/memory/gateway.ts` now builds structured prompt snapshots, `runner.ts` freezes one snapshot at run start instead of re-querying memory mid-run, and run summaries now persist memory snapshot counts plus outcome/next-step reflection fields. Added focused regression coverage in `src/lib/server/agent/self-evolution.test.ts`.
- 2026-04-11: Added memory write governance and formal skill-upgrade flow. `src/lib/server/memory/classifier.ts` now rejects low-value memory writes such as reminders, transient run logs, bare links, and todo-style next steps; `src/lib/server/memory/gateway.ts` enforces those rules on add/update. `src/lib/server/agent/skillDraft.ts` and `tools/skillManage.ts` now support promoting a reviewed draft into a live skill while stripping draft-only metadata. Added focused tests for both behaviors in `src/lib/server/agent/self-evolution.test.ts`.
- 2026-04-14: Fixed the Telegram “timeout then service exits” failure in `src/lib/server/channels/telegram/runtime.ts` and `formatting.ts`. Fallback notices like `Internal error.` and `Stopped.` now go through a safe send path that swallows repeated outbound timeout failures after logging them, so a bad Telegram network window no longer turns one failed reply into a process crash. Added focused regression coverage in `src/lib/server/channels/telegram/formatting.test.ts`.
- 2026-04-14: Removed the default end-of-run “Run summary” chat reply in `src/lib/server/agent/runner.ts`. Runs still save internal records, but the user-facing extra message is now sent only when a reusable draft was actually saved, and that message is shortened to a plain draft notice. Updated coverage in `src/lib/server/agent/self-evolution.test.ts`.
- 2026-04-14: Fixed repeated duplicate rows on the Skill Drafts page. `src/lib/server/agent/reviewData.ts` was scanning the same bot-level `skill-drafts` folder once per chat directory, so one real draft could show up multiple times. It now scans each bot workspace only once, with focused coverage in `src/lib/server/agent/reviewData.test.ts`.
- 2026-04-15: Updated Weixin outbound text handling to match the newer reference SDK behavior. `package/weixin-agent-sdk` now uses a streaming Markdown filter instead of flattening every reply to plain text, and Molibot’s Weixin runtime/file-send path now preserves supported Markdown (headings, tables, code fences, non-CJK emphasis) while still removing problem cases such as inline images and CJK italic markers. Added focused regression coverage in `package/weixin-agent-sdk/src/messaging/send.test.ts` and `src/lib/server/channels/weixin/outbound.test.ts`.
- 2026-04-17: Fixed the QQ SDK startup crash in `src/lib/server/channels/qq` and `package/qqbot/src/gateway.ts`. The adapter was still calling the old gateway shape, so startup could die on `abortSignal.addEventListener` before the QQ bot fully connected. The QQ bridge now passes the current gateway context shape, falls back to an internal stop signal when none is provided, and aligns the QQ compatibility exports with the SDK’s current names so this path no longer trips over the old interface mismatch.
- 2026-04-17: Shrunk the noisy QQ API response-header logs in `package/qqbot/src/api.ts`. `<<< Headers:` no longer prints the full header object; it now shows only a compact summary of the few fields that help排查请求结果，比如内容类型、长度、压缩方式、服务端和 trace id。
- 2026-04-17: Finished the bigger QQ cleanup pass. `package/qqbot/src/gateway.ts` can now hand inbound events directly to Molibot instead of assuming OpenClaw runtime is present; `src/lib/server/channels/qq/runtime.ts` now has a real inbound queue -> command -> runner path instead of only starting the SDK and waiting; `src/lib/server/channels/qq/sdk-adapter.ts` was reduced to helper exports instead of carrying a second unused manager class; and `package/qqbot/src/api.ts` now caches tokens per `appId`, so multiple QQ bots no longer fight over one global token slot.
- 2026-04-17: Fixed the remaining QQ SDK regression set after the adapter migration. `package/qqbot/src/api.ts` no longer references a missing token variable in background refresh, QQ markdown mode is now tracked per `appId` instead of one process-global switch, and the new gateway/outbound call chain passes the bot `appId` through all passive/proactive text sends so multi-bot deployments keep the right message format.
- 2026-04-17: Restored QQ inbound media behavior in `src/lib/server/channels/qq/runtime.ts`. Incoming QQ attachments are downloaded and saved through `store.saveAttachment` before entering the runner, image bytes are rebuilt into `imageContents` so vision still works, and audio attachments now point at real local files again so later transcription no longer dies on remote URLs.
- 2026-04-17: Fixed the new QQ startup regression in `package/qqbot/src/gateway.ts`. The gateway was trying to grab OpenClaw runtime during connect even when Molibot had already supplied its own `onEvent` handler, so both QQ bots fell into a reconnect loop with `QQBot runtime not initialized`; runtime lookup is now delayed until the legacy OpenClaw path is actually used.
- 2026-04-17: Removed the noisy `qqbot-api` request trace logs from `package/qqbot/src/api.ts`. QQ API calls no longer print every request/response header and body on normal paths; only real failures still surface as explicit errors, so runtime logs are much easier to read.
- 2026-04-18: Added session token visibility to `/status`. The command now shows current session message count, estimated live context size, accumulated session token totals, and latest compaction effect so it is easier to judge whether a session should be compacted or cleared.
- 2026-04-18: Fixed QQ outbound audio URL routing in `package/qqbot/src/outbound.ts` and `package/qqbot/src/api.ts`. Remote `.mp3/.wav/.flac/...` resources are now recognized as voice replies and uploaded with QQ voice media type instead of falling through to the wrong media path.
- 2026-04-18: Tightened QQ local voice sending in `package/qqbot/src/outbound.ts` and `package/qqbot/src/gateway.ts`. Local audio files are now forced through SILK conversion before upload instead of裸传 `mp3/wav` file data, reducing the chance that QQ single chats render them as generic file attachments rather than voice messages.
- 2026-04-18: Fixed QQ audio type detection for `AIF/AIFF` in `package/qqbot/src/utils/audio-convert.ts`. Those files were being missed by the audio classifier and dropped into the generic file-send path, which is why single-chat replies could arrive as plain files instead of voice messages. Added focused regression coverage in `package/qqbot/src/outbound.test.ts`.
- 2026-04-18: Added the first working Skill Search path across runtime settings, tools, prompt, and Settings UI. `src/lib/server/settings/{schema,defaults,store}.ts` plus `src/lib/server/app/runtime.ts` now persist configurable local/API skill-search settings; `/settings/skills` can enable local search, enable API search, and pick which configured AI Provider + model should be used for API review; `src/lib/server/agent/tools/skillSearch.ts` adds the new `skill_search` runtime tool with local lookup plus optional API review; `src/lib/server/agent/prompt.ts` now routes non-trivial action requests through `skill_search`, trims `Available Skills` down to names only, and wraps major prompt blocks in XML-style tags for clearer structure. `docs/skill-search-plan.md` was updated to reflect the initial implementation state and `prd.md` marks the feature as delivered.
- 2026-04-18: Added dedicated test-phase observability for `skill_search`. The runtime now logs `skill_search_start`, `skill_search_local_result`, `skill_search_api_result`, and `skill_search_end`, including the search input intent, enabled path flags, local/API match summaries, diagnostics, and final returned matches so skill-routing behavior can be monitored during evaluation.
- 2026-04-18: Simplified Skill Search API setup to reuse the existing AI Provider list instead of maintaining a second endpoint config. `/api/settings/skills` now returns selectable configured providers/models from Settings / AI / Providers, `/settings/skills` uses dropdowns for provider and model instead of separate baseUrl/path/key fields, and `src/lib/server/agent/tools/skillSearch.ts` resolves the selected provider’s real request settings at runtime before calling the routing model.
- 2026-04-18: Fixed two Skill Search API edge cases after the provider-selector change. Runtime API review now keeps working for older saved installs that still rely on the legacy direct endpoint fields when no provider is selected, and when a saved model no longer exists on the chosen provider it now falls back to that provider’s default/first model instead of sending a stale model id.
- 2026-04-19: Hardened skill execution path handling for the `onlinestool` workflow. The script now self-anchors to its own directory before touching relative `scripts/...` paths, `src/lib/server/agent/runner.ts` now includes explicit `base_dir` metadata when passing invoked-skill context into the model, and the skill instructions were rewritten to follow the current skill directory instead of hardcoding one machine-specific absolute path.
- 2026-04-19: Updated fixed slash-command display for table-capable channels. Shared command rendering now uses a per-command mode switch, so `/status` and `/help` return clearer two-column Markdown tables on QQ / Weixin / Feishu, while Telegram still falls back to the original plain-text layout and other command outputs remain unchanged. Added regression tests for both the table path and Telegram fallback.
- 2026-04-19: Removed machine-specific absolute-path examples from the ACP and Skill Drafts settings pages, replacing `~/...` placeholders with relative or generic examples. Also added a project rule in `AGENTS.md` to forbid user-machine absolute paths in code, UI copy, prompts, and docs going forward.
- 2026-04-19: Upgraded Feishu outbound presentation from minimal single-block cards to structured rich cards in `src/lib/server/channels/feishu/messaging.ts`, added dedicated ACP status/approval cards plus in-card approve/reject handling in `src/lib/server/channels/feishu/runtime.ts`, exposed a new Feishu card callback route at `src/routes/api/feishu/card/+server.ts`, and extended `/settings/feishu` with optional callback security fields (`verificationToken`, `encryptKey`).
- 2026-04-20: Added the first built-in feature-plugin path for product capabilities beyond channels/providers. `src/lib/server/plugins/feature-registry.ts` now registers built-in feature plugins, plugin catalog output includes `features`, `/settings/plugins` can enable and configure Cloudflare HTML publish, `src/lib/server/agent/prompt.ts` injects plugin-specific guidance, and `publish_html` now lets the agent upload complete HTML documents to Cloudflare R2 and return the configured public URL.
- 2026-04-20: Added a full practical plugin tutorial in `docs/guides/plugins/plugin-authoring.md`, plus cross-links from `docs/guides/plugins/plugin-development.md`, `docs/designs/plugins/plugin-manifest.md`, and `README.md`. The new guide explains what plugin types exist today, which ones really run, how to write/install/enable a built-in plugin, what the current external-manifest limits are, and includes a full Cloudflare HTML publish demo.
- 2026-04-20: Fixed a production build blocker in `src/lib/server/app/runtime.ts`. The plugin-settings merge path for `cloudflareHtml` was missing one closing parenthesis, which broke `npm run build`; the merge expression now closes correctly again.
- 2026-04-20: Restructured Cloudflare HTML publish so the upload tool now lives under `src/lib/server/plugins/cloudflareHtml/` instead of `src/lib/server/agent/tools/`, and the feature registry now owns the registration path end-to-end. Also split the public-link config wording to use a dedicated Worker base host while keeping backward compatibility with older saved `publicBaseUrl` settings.
- 2026-04-20: Reworked `/settings/plugins` so feature-plugin config forms are now generated from plugin-declared field metadata instead of a hard-coded Cloudflare HTML section. The feature registry now ships settings-field definitions, the page reads current values dynamically, and saving writes plugin settings back by registry key.
- 2026-04-20: Moved Cloudflare HTML feature-plugin declaration itself into `src/lib/server/plugins/cloudflareHtml/plugin.ts`. The root `src/lib/server/plugins/feature-registry.ts` is now only a thin aggregator that imports built-in plugins and exposes combined catalog/prompt/tool helpers.
- 2026-04-20: Added the Cloudflare Worker side of the HTML publish plugin under `src/lib/server/plugins/cloudflareHtml/worker/`. The plugin directory now includes a deployable classic-script template (`index.js`), a module-mode template (`module.ts`), an example `wrangler` config, and a short setup note so operators can wire public HTML serving to the same R2 bucket used by Molibot uploads.
- 2026-04-21: Fixed an over-strict Cloudflare HTML Worker guard that was causing false 404s for manually named HTML files. The Worker now accepts normal safe `.html` file names such as `gold_daily_20260420_v5.html` instead of only matching one random-string naming pattern.
- 2026-04-22: Upgraded the Cloudflare HTML plugin to support two public-link modes. Operators can now choose between `Worker` mode (final URL uses `workerBaseHost + routePrefix + fileName`) and `Direct R2` mode (final URL uses `publicBaseHost + objectKey`). Added plugin README notes for both modes, kept the Worker path optional instead of removing it, and updated the root README/doc guide links accordingly.
- 2026-04-22: Fixed Cloudflare plugin settings validation for partial updates in `src/routes/api/settings/+server.ts`. Validation now merges incoming `plugins.cloudflareHtml` patches with the current saved config before checking required fields, so toggling one plugin field no longer throws or fails just because unrelated fields were omitted from the request body.
- 2026-06-03: Changed the Cloudflare HTML publish tool to accept a local `filePath` instead of raw HTML content. Runtime now resolves the path under the normal workspace guard, reads and validates the file internally before upload, and avoids forcing large HTML documents into model tool arguments.
- 2026-04-22: Moved inbound queue ownership, queue commands, and resume flow out of individual channel runtimes into shared runtime helpers. Feishu, QQ, Weixin, and Telegram now all use the same shared inbound-task coordinator, and Feishu/QQ/Weixin also reuse one shared text-task execution skeleton instead of each channel owning its own queue-to-runner plumbing.
- 2026-04-22: Added a dedicated model error log path. Failed model calls are now appended to `data/logs/model-errors.jsonl`, exposed through `/api/settings/model-errors`, and visible in a new Settings page so fallback failures and real provider/model error reasons can be inspected without scanning console output.
- 2026-04-22: Fixed Telegram/model-retry context corruption in `src/lib/server/agent/runner.ts`. Retryable 429 attempts now reset the in-memory prompt state before retrying, so the same user message no longer gets appended into session context multiple times; each failed 429 attempt is recorded separately in model error logs; and a later successful reply is no longer overwritten by the stale final `Sorry, something went wrong.` fallback. Added focused regression coverage in `src/lib/server/agent/runnerRetryState.test.ts`.
- 2026-04-22: Updated `/models` output in `src/lib/server/agent/channelCommands.ts` to use a cleaner numbered two-column table with total count and inline active-model marker (`⭐ 当前活跃中`) instead of the old mixed paragraph + key dump format. Added focused regression coverage in `src/lib/server/agent/channelCommands.test.ts`.
- 2026-04-22: Added Feishu-only Markdown table conversion in `src/lib/server/channels/feishu/{formatting,messaging}.ts`. Feishu replies now detect Markdown tables inside outgoing text, convert them into native interactive-card `table` elements, and keep surrounding non-table text as normal card markdown, without changing shared agent output or other channel behavior. Added focused regression coverage in `src/lib/server/channels/feishu/table-conversion.test.ts`.
- 2026-04-22: Fixed two follow-up regressions in shared outbound retry and Feishu table conversion. Shared outbox sends now keep the original send promise pending until a retried delivery truly succeeds or the runtime closes, so transient provider/channel failures no longer surface as false immediate send errors while the same row is still queued. Feishu table extraction now ignores pipe-table syntax inside fenced code blocks, preserving literal Markdown examples instead of rewriting them into native tables. Added focused regression coverage in `src/lib/server/channels/shared/outbox.test.ts` and `src/lib/server/channels/feishu/table-conversion.test.ts`.
- 2026-04-23: Refined `/models` output structure in `src/lib/server/agent/channelCommands.ts`. Model lists now render as three columns (`编号 / 供应商 / 模型`) instead of merging provider and model into one cell, and the active marker moved into the index column so scanning and switching are easier in text channels and Feishu-native table cards. Updated focused regression coverage in `src/lib/server/agent/channelCommands.test.ts` and `src/lib/server/channels/feishu/table-conversion.test.ts`.
- 2026-04-23: Fixed mixed built-in/custom model routing compatibility across `/models`, runtime selection, and AI routing settings. Built-in providers listed in settings now generate native `pi|provider|model` route keys instead of being misrouted through the custom OpenAI-compatible path, runtime validation now checks the actually selected model instead of hard-blocking on the global provider mode, and the routing page now treats built-in/custom options as one mixed pool with automatic transport selection. Updated switch output text and added focused regression coverage for mixed-provider switching.
- 2026-04-23: Fixed built-in provider credential precheck for settings-stored API keys. When the active built-in model (for example Google Gemini) has its key filled in the Providers page, runtime validation now treats that saved key as valid credentials instead of incorrectly demanding only `GOOGLE_API_KEY` or `auth.json` before the request can start.
- 2026-04-23: Fixed stale built-in fallback model selection. When a built-in provider keeps its own attached-model list and internal default model (for example `google-vertex -> gemini-3.1-flash-lite-preview`), runtime fallback and `/models` now prefer that configured built-in default instead of silently reusing an older `piModelName` such as `gemini-1.5-flash`.
- 2026-04-23: Fixed routed-model selection so disabled custom providers are no longer eligible just because an old route key still points at them. Runtime now requires routed custom providers to remain enabled before they can be selected.
- 2026-04-23: Tightened retry/fallback model selection to honor `Enabled` consistently. Disabled custom providers are now excluded not only from routed-model hits, but also from the “current custom default” and broad fallback scan paths, so a turned-off provider cannot reappear during retry selection.
- 2026-04-23: Simplified default `[mom-t]` console logs in `src/lib/server/agent/log.ts`. Logs now print as readable one-line entries with `[mom-t] + time + scope + event + key fields`, use ANSI colors to distinguish event categories, keep `system_prompt_preview_written` and other key events easy to scan, and allow explicit JSON fallback with `MOM_LOG_PRETTY=0`. Added focused regression coverage in `src/lib/server/agent/log.test.ts`.
- 2026-04-24: Added explicit model fallback policy in runtime settings and AI Routing UI. The default now tries only same-provider backup models instead of silently crossing to any enabled provider; operators can choose `off` or restore old cross-provider fallback with `any-enabled`. STT and image fallback now ignore disabled providers, STT-only providers are no longer treated as text defaults, and `/api/settings/model-switch` exposes backend-generated route options for the settings page.
- 2026-04-24: Improved the AI Providers settings page for real provider/model maintenance. The provider list now switches to a two-pane layout earlier and scrolls independently, built-in provider model lists are collapsed by default with an explicit expand control, and custom provider thinking settings now explain the exact runtime behavior, OpenAI fallback risk, provider-wide scope, and low/medium/high effort mapping semantics.
- 2026-04-24: Unified the AI Providers and AI Routing settings UX around one mixed model-pool concept. Routing now foregrounds capability-specific concrete model selection across `pi|...` and `custom|...` keys, shows enabled built-in/custom/model counts, moves legacy fallback anchors into a compatibility section, and uses theme-variable based panels, controls, status bars, and responsive grids. Providers now links directly to Routing and describes built-in/custom entries as inputs to the same routing pool.
- 2026-04-24: Added custom-provider thinking format settings for provider-specific protocols. Legacy saved `thinking-type` values now migrate to the explicit `deepseek` format, while custom DeepSeek-style endpoints send `thinking.type=enabled` plus mapped `reasoning_effort`.
- 2026-04-25: Upgraded pi-mono packages to `0.70.2`, added DeepSeek to the built-in provider list, route-migrated stale `custom|deepseek|...` keys to `pi|deepseek|...`, and removed Molibot's local DeepSeek payload patch / auto-disable notice because upstream now owns DeepSeek v4 thinking compatibility.
- 2026-04-25: Moved old-session strictness handling to generic runner context cleanup by dropping orphan tool-result messages that no longer have a matching preceding assistant tool call.
- 2026-04-25: Added `@sinclair/typebox` as an explicit project dependency after the pi-mono upgrade stopped providing it transitively, fixing production build resolution for agent/MCP/plugin tool schemas.
- 2026-04-25: Added `diff` as a direct runtime dependency and upgraded the agent `edit` tool diff output to show accurate line-aware context for insertions and deletions.
- 2026-04-25: Added a deferred local-tool loading path inspired by Claude Code's ToolSearchTool. `src/lib/server/agent/tools/toolSearch.ts` now provides a `toolSearch` meta tool, `src/lib/server/agent/tools/index.ts` keeps `createEvent` out of the default startup tool list until `toolSearch` loads it, and `src/lib/server/agent/runner.ts` updates the live agent tool set when deferred tools are loaded. The system prompt now keeps only concise event-routing rules instead of embedding the full event-tool guide up front, reducing startup prompt/tool context for normal chats.
- 2026-04-25: Tightened the deferred-tool protocol to mirror Claude Code more closely. The prompt now exposes an explicit `<available-deferred-tools>` block plus a `ToolSearch` protocol section, and `toolSearch` now supports `select:a,b`, required-name terms like `+event schedule`, and returns matched tool JSONSchema definitions inside a `<functions>` block while still loading the real tools into the active runtime tool set.
- 2026-04-25: Moved the detailed event-tool operating rules into `createEvent`'s own tool description so deferred loading does not drop important scheduling behavior. The startup prompt keeps only routing guidance, while the loaded `createEvent` schema now carries event types, delivery modes, cron examples, no-shell-scheduler rules, retry guidance for past timestamps, exact-confirmation reply requirements, and periodic `[SILENT]` handling.
- 2026-04-25: Migrated Molibot custom tool names from snake_case to camelCase to avoid underscore/Markdown/tool-name normalization problems. Runtime tools now expose names such as `skillSearch`, `toolSearch`, `skillManage`, `profileFiles`, `switchModel`, `createEvent`, `loadMcp`, and `publishHtml`; prompt guidance, tool policy serialization, MCP explicit-load detection, and plugin guidance were updated to match.
- 2026-04-25: Hardened deferred `createEvent` loading after runtime reports showed `Tool createEvent not found` when a model called the deferred tool before `toolSearch` finished. The default tool list now includes a tiny `createEvent` entry that loads the full deferred tool and, when called with scheduling arguments, delegates directly to the real `createEvent` implementation to avoid a "call again" loop caused by pi-agent-core's per-run tool snapshot. `toolSearch` normalization now splits camelCase, so queries like `create event`, `createEvent`, and `event schedule reminder` all match the deferred entry.
- 2026-04-25: Added detailed diagnostics around deferred tool search and loading. `toolSearch` now logs normalized queries, direct selections, required/optional terms, deferred tool keywords, candidate searchable text, scores, match reasons, final matches, and loaded tools; `createMomTools` now logs deferred load requests plus before/after loaded sets and the active local tool names.
- 2026-04-25: Moved more low-frequency custom tools behind the deferred-tool layer. `switchModel`, `skillManage`, and `profileFiles` now expose only lightweight default entries with short descriptions and empty schemas; their full descriptions and parameter schemas are returned by `toolSearch` and the lightweight entries delegate to the real tools when called with parameters. Startup prompt guidance now lists these names in `<available-deferred-tools>` and removes their detailed parameter lines.
- 2026-04-25: Split Telegram run display into separate message lanes in `src/lib/server/channels/telegram/runtime.ts`. Tool/progress updates now stay in their own editable status message, render as a compact icon + tool name + bounded-summary list, final assistant answers are sent/edited as a separate answer message, and repeated `respondInThread` notices such as tool errors/model fallback details are appended into one reusable “运行详情” message instead of producing multiple duplicate error bubbles. `src/lib/server/agent/runner.ts` now emits structured tool start/end UI events so Telegram can format tool calls without parsing final assistant text.
- 2026-04-22: Polished the main web experience for consistency. `src/styles/theme.css` and `src/app.css` now define a stronger shared visual baseline for chat and settings; `src/routes/+page.svelte` now uses unified localized status copy, a clearer page hierarchy, stronger empty state / quick-action treatment, and more consistent chat/composer surfaces; `src/routes/settings/+layout.svelte` and `src/routes/settings/+page.svelte` now use locale-aware navigation and a more coherent settings overview instead of the previous mixed-language shell.
- 2026-04-24: Reworked `src/routes/+page.svelte` to match a desktop agent-chat layout: icon-led left navigation, compact session filtering, non-bubble message stream, fixed toolbar composer with model/thinking controls, and a right Files workspace kept behind a collapsed toggle for future file features.
- 2026-04-24: Fixed incomplete Web i18n switching. Added `src/lib/ui/i18n.ts` as the shared locale source, connected Chat and Settings to it, made Settings overview copy update immediately when language changes, and added a Settings-shell translation fallback so English-only legacy settings pages render Chinese labels/placeholders while they are migrated.
- 2026-04-24: Added Web chat Markdown rendering for assistant messages using the `marked` package plus a constrained HTML sanitizer, styled common Markdown blocks, and changed history load / streaming updates to keep the viewport pinned to the newest message.
- 2026-04-26: Hardened runner behavior when the tool-call budget is exhausted. Streamed assistant content is now retained as a partial answer with the budget notice appended instead of being overwritten by generic failure text, runtime errors are sent to details, and the runner makes one automatic no-tool continuation request in a new response message where the channel supports it. The continuation message now explicitly says automatic continuation stops there and the user can manually send “继续” if more work is needed.
- 2026-04-26: Isolated the tool-budget continuation control prompt from persisted session history. The runner now records `RUN_TOOL_BUDGET_EXHAUSTED` as a structured `runtime_event` entry for debugging, immediately strips the transient `[runtime notice] ... Do not call tools.` prompt from saved model messages, and keeps the user-facing detailed limitation notice only in channel output so later turns in the same session can still call tools normally.
- 2026-04-26: Tightened queue id notices across Telegram/Feishu/QQ/Weixin. The runtime now checks the freshly enqueued task state and only sends `Queued as #...` when that message is still truly `pending`; messages that go straight into execution no longer get a misleading queue-number reply.
- 2026-04-26: Manually cleaned the polluted Molifin session `s-mmat56zw` under `~/.molibot/.../contexts/` by removing the stale `pushhtml` budget-limit turns from both `.json` and `.jsonl`, so future turns in that session rebuild from clean context instead of inheriting the broken no-tools follow-up path.
- 2026-04-26: Added a standing AGENTS policy for runtime error handling. Temporary model-control instructions must not be persisted as normal session turns, persistent diagnostics must use structured non-contextual error/event codes, and user-facing detailed limitation text must stay on the channel/client output path instead of being reused as model context.
- 2026-04-26: Added a shared `subagent` delegation tool powered by `@mariozechner/pi-coding-agent`. Molibot can now delegate codebase-heavy work into isolated `scout` / `planner` / `worker` / `reviewer` sessions, including single-task, bounded parallel, and `{previous}` chain handoff modes. The parent runtime keeps delegation in the shared Agent layer, serializes `subagent` calls with other mutating tools, reuses Molibot's guarded `read` / `bash` / `edit` / `write` behaviors inside worker-style subagents, and instructs the main prompt to prefer subagents when a long multi-phase code task would otherwise burn through the parent run budget.
- 2026-04-26: Made subagent execution visible in default mom logs. Pretty logs now emit `subagent_start`, `subagent_task_start`, `subagent_task_end`, and `subagent_end` by default, including chat, mode, delegated role, step index, token usage, and short task/output previews so operators can tell when a request is running inside a delegated child session rather than the parent run alone.
- 2026-04-30: Fixed custom-provider image routing so declared-but-unverified vision models no longer receive images through the native streaming transport. Image turns now use native multimodal transport only after `verification.vision === "passed"`; otherwise the runner falls back to the direct image-understanding request builder, whose OpenAI-compatible and Anthropic-compatible payloads are explicit and covered by focused tests.
- 2026-04-30: Fixed queued image attachment rehydration across Telegram/QQ/Weixin/Feishu. Persistent inbound queues still strip large base64 payloads before SQLite storage, but restore `imageContents` from `workspaceDir + attachment.local` when processing resumes, so image fallback receives real image bytes instead of only an attachment path.
- 2026-04-30: Fixed MiMo Anthropic role formatting. Runner streaming and image-fallback requests for providers explicitly configured as `anthropic` now keep system/developer instructions in the top-level `system` field instead of putting `role: system` inside `messages`; fallback logs a redacted `image_analysis_request`, and Anthropic-compatible calls send both `api-key` and `x-api-key` headers.
- 2026-04-30: Closed the review gap where custom fallback candidates could still advertise native image input from the `vision` tag alone. Custom model transport now exposes image input only after `verification.vision === "passed"`, and `src/lib/server/agent/vision-fallback.test.ts` mocks real fallback requests to assert OpenAI-compatible `image_url` and Anthropic `image/source` payloads both carry image bytes.
- 2026-04-30: Added a tiny installed vision smoke fixture. `molibot init` now copies the bundled 68-byte `assets/test-images/vision-smoke.png` to `<DATA_DIR>/fixtures/vision-smoke.png`, and provider vision tests read that workspace file before sending OpenAI-compatible or Anthropic image probes.
- 2026-05-01: Synced `package/weixin-agent-sdk` with the current `openclaw-weixin` protocol changes that belong in the SDK. API requests now include sanitized `base_info.bot_agent`, lifecycle `notifyStart` / `notifyStop` helpers are exposed, QR login now posts local token hints and handles pairing-code / redirect statuses, and API tests cover bot-agent sanitization plus lifecycle request payloads.
- 2026-05-01: Synced `package/qqbot` with the current upstream QQ Bot SDK v1.7.1 source. The local SDK now carries the newer QQ protocol/media modules for group policy, quoted-message refs, slash commands, approval interactions, typing/streaming helpers, STT attachment processing, chunked uploads, upload caching, and guarded remote downloads; Molibot-specific compatibility keeps plugin SDK imports runtime-local, leaves queue/session orchestration in the shared channel runtime, and defaults `/bot-upgrade` to doc-only mode instead of hot reload.
- 2026-05-01: Fixed the QQ reconnect storm after the v1.7.1 sync. When Molibot starts the SDK with `onEvent`, `package/qqbot/src/gateway.ts` now bypasses OpenClaw-only runtime preflight, approval gateway startup, SDK slash-command interception, and the per-message `getQQBotRuntime()` path, so QQ no longer fails connection setup with `QQBot runtime not initialized`.
- 2026-05-01: Added production deployment without source checkout. `npm run release` now builds `dist/molibot-release` with `build/`, production dependencies, runtime bootstrap assets, and service scripts; `bin/molibot-update.sh` can fetch GitHub, build a timestamped release, atomically switch `current`, and restart; Dockerfile/Compose provide the equivalent image-based path.
- 2026-05-01: Added `molibot manage` as a lightweight interactive deployment manager. It writes `${DATA_DIR}/deploy.env`, runs GitHub install/update through the existing updater, controls the service, shows logs, and guards uninstall so it removes only runtime deployment files while keeping `DATA_DIR`.
- 2026-05-01: Hardened deployment overwrite safety. `bin/molibot-update.sh` now refuses to use a non-empty deployment directory unless it has a `.molibot-deploy` marker, `bin/molibot-release.sh` refuses to overwrite non-release output directories, and manager uninstall only removes marked Molibot deployment directories.
- 2026-05-01: Added read-only version visibility to Web UI. `/api/version` reports the local package version, optionally checks GitHub latest release or remote `package.json`, and the top bar version popover shows current/latest/update state while leaving actual updates to `molibot manage`.
- 2026-05-01: Added a dedicated System Config settings page. Operators can change Web language, save runtime timezone, and inspect the configured GitHub repository/ref as read-only deployment information; the top-right version badge was widened and switched to a clearer monospace text treatment.
- 2026-05-01: Set the default GitHub deployment source to `https://github.com/gusibi/molibot` on branch `master` across `bin/molibot-update.sh`, `molibot manage`, and `/api/version`.
- 2026-05-01: Fixed first-install bootstrap when GitHub `master` does not yet contain the new release scripts. The updater now copies current installer tooling into the managed clone before running release packaging, refreshes previously bootstrapped untracked tooling on later runs, while release packaging tolerates older source trees that lack optional manager/update scripts and adds missing root runtime dependencies before `npm ci`.
- 2026-05-01: Fixed the production Agents settings page after release deployment. Release bundles now copy built-in subagent Markdown definitions into the SvelteKit server chunk asset path so `/api/settings/subagents` no longer fails with missing `scout.md`, and regular saved Agents remain visible in the Web UI.
- 2026-05-01: Added lightweight service supervision to `bin/molibot-service.sh`. `start` now launches a supervisor that records its PID, starts the Molibot child process, and restarts that child after unexpected exits; `stop` uses a stop marker and kills the supervised child so intentional stops do not loop.
- 2026-05-01: Added subagent-specific model routing and visibility. AI Routing now includes a `subagent` fallback route plus per-level `haiku` / `sonnet` / `opus` / `thinking` mappings for cheaper/faster delegated runs, the Agents settings page lists built-in `scout` / `planner` / `worker` / `reviewer` definitions as read-only inventory, Web run traces include tool start/end diagnostics, and Telegram tool progress now shows subagent calls with 20-character result summaries. The subagent inventory now uses the same effective-model resolution as runtime, shows abstract model levels instead of unconfigured concrete Claude model IDs, and lives behind a single Subagents navigation item instead of crowding the sidebar.
- 2026-05-01: Upgraded subagent triggering strategy before tool-budget exhaustion. The system prompt now tells codebase tasks to delegate early when they would need roughly 8+ direct read/bash/edit calls, and the runner injects a transient runtime notice after 12 parent tool calls if no subagent has been used yet. The notice asks the model to switch remaining investigation/implementation/review work to `subagent`, is logged for operators, and is stripped from persisted model history like the existing no-tool continuation notice.
- 2026-05-02: Fixed Weixin image replies so local image attachments use the shared `weixin-agent-sdk` media send protocol and single image URLs / Markdown image references are downloaded and resent as native Weixin `IMAGE` messages. Added focused outbound coverage for both local image files and Markdown image URL conversion.
- 2026-05-02: Reduced Weixin run-error message spam inside `src/lib/server/channels/weixin/runtime.ts`. The channel now buffers transient tool progress and intermediate error notices, suppresses them during successful runs, and sends only the latest buffered error if no normal visible answer was delivered.
- 2026-05-02: Reduced QQ run-error message spam inside `src/lib/server/channels/qq/runtime.ts`. QQ now buffers transient tool progress and intermediate error notices at the channel boundary, suppresses them during successful runs, and sends only the latest buffered error if no normal visible answer was delivered.
- 2026-05-03: Adjusted Weixin and QQ tool-progress delivery so the first tool call notice is sent as its own message, while later tool-progress notices are compacted into batches of five before sending. Pending partial batches are flushed before final answers, final error notices, or run completion.
- 2026-05-04: Hardened Weixin tool-progress delivery after `sendMessage failed: code=-2` on batched `_→ ..._` messages. Weixin progress batches are now rewritten to plain Chinese text before enqueue, already-pending legacy progress batches are rewritten during retry, and invalid tool-progress payloads are dropped instead of retrying forever.
- 2026-05-04: Added custom-provider model discovery in `/settings/ai/providers`: operators can click `开始` to batch pull provider `/models`, then click `+` beside each discovered model to add it into Attached Models without manual model-id typing.
- 2026-05-04: Made Telegram typing indicator non-blocking in `ctx.setTyping`: when `sendChatAction(typing)` retries still timeout, runtime now logs `ctx_set_typing_failed_non_blocking` and continues the run instead of failing the whole turn.
- 2026-05-06: Started the Settings shadcn-svelte migration. Added `components.json`, generated the initial shadcn-svelte component set under `src/lib/components/ui`, added the shared `cn()` utility, and migrated `/settings/system` from the old local UI wrappers/workbench page styling to shadcn-style semantic component composition. Follow-up migrated `/settings/web` to the same shadcn component baseline, including profile list cards, Switch-enabled state, NativeSelect agent binding, Textarea Markdown overrides, skeleton loading state, and Alert feedback. The chat page was intentionally left unchanged.
- 2026-05-06: Closed the Settings shadcn-svelte review gaps for `/settings/ai/providers` and `/settings/tasks`. AI Providers now uses shadcn-svelte Button, Card, Alert, Checkbox, Input, and NativeSelect primitives for provider navigation, enable toggles, provider/model forms, model discovery, and capability chips; Tasks row selection now uses the shared Checkbox component; obsolete providers-page workbench CSS hooks were removed.
- 2026-05-06: Updated `/settings/skill-drafts` draft review ergonomics so long draft content defaults to a 10-line preview, while full draft editing and saving happens in a focused modal form to keep the page scannable when many generated drafts are present.
- 2026-05-06: Added skill-creator-aware Skill Draft metadata normalization. `src/lib/server/agent/skillDraftMetadata.ts` now derives reusable workflow `name` / `description` / `aliases` separately from raw user text, `skillDraft.ts` applies it to automatic drafts, and `skillManage.ts` passes manual draft metadata through the same path. Focused tests cover complaint-style “昨日数据回顾” requests and generic “重试一下” retries so those messages no longer become unusable draft names.
- 2026-05-06: Added a dedicated Skill Draft metadata subagent. `src/lib/server/agent/tools/subagent-agents/skill-drafter.md` defines a read-only `haiku`-level metadata generator, `src/lib/server/agent/skillDraftSubagent.ts` parses its JSON output with local fallback, and `runner.ts` now calls it before saving automatic drafts so subagent execution is exercised on real draft generation.
- 2026-05-10: Added dated scratch artifact organization. Each live prompt now includes `scratch_artifact_dir` in the transient `<env>` block, the shared `write` tool routes plain file names into that dated folder, and `bash` exposes the same relative folder through `$MOLIBOT_SCRATCH_ARTIFACT_DIR`. Bash now also relocates newly created root-level artifact files such as images/reports into the dated folder, and `attach` can resolve a just-moved root filename to its dated location; explicit paths such as `events/...` stay unchanged so watched event files keep their runtime location.
- 2026-05-10: Added opt-in OS-level sandbox support for agent shell execution. Runtime settings now include `toolSandbox`, the main `bash` tool and built-in subagent `bash` can run through `@anthropic-ai/sandbox-runtime`, and sandboxed bash receives only sanitized minimal env plus allowlisted workspace env-file keys instead of inheriting the host process environment. `/settings/sandbox` and `/api/settings/sandbox-diagnostics` expose policy editing and redacted diagnostics, while Browser, Computer Use, ACP, MCP, and channel message delivery remain outside this first sandbox boundary.
- 2026-05-14: Added explicit cross-channel Sub Agent execution notices. The shared `subagent` tool now emits run/task lifecycle UI events, the parent runner turns them into transient `_→ ..._` progress notices, Telegram renders them inside the live progress block, Web streaming shows them in live diagnostics, and text channels that rely on the shared runner context (Feishu/Weixin/QQ) now surface the same “Sub Agent started / task started / task finished / finished” hints without adding per-channel delegation logic.
- 2026-05-14: Hardened subagent progress event delivery. Shared `subagent_execution` notices are now dispatched through the runner's best-effort UI queue so broken Web/Telegram sinks no longer abort successful delegated work, and failed delegated runs now emit terminal `end` progress events so cross-channel status UIs do not get stuck in a started state.
- 2026-05-24: Routed subagent-generated artifacts through the parent run's dated scratch directory and aligned subagent Host Bash approval with the parent Agent. Built-in subagents now receive the current `scratch_artifact_dir`, their `write` and `bash` tools default ordinary generated files into that directory, modified root-level artifact files are moved just like newly created ones, and subagent `bash` uses the parent channel/chat/session/store approval context.
- 2026-05-10: Marked sandboxed shell tool output in runner displays. Internal tool routing and run summaries still use the real tool name `bash`, but Web diagnostics, Telegram progress, and threaded tool output now show `Sandbox` when sandboxing applies and `Sandbox disabled` when the configured sandbox soft-disables after an initialization failure.
- 2026-05-13: Tightened user-facing run-display copy and Weixin batching. Sandboxed bash labels were shortened to `Sandbox` / `Sandbox disabled` across channel-visible tool progress, and Weixin batched tool calls now render as explicit multi-line lists so grouped progress updates stay readable.
- 2026-05-13: Simplified sandbox host-approval routing so `bash` is now the single entry point for sandboxed shell execution and host-capability approval requests. The standalone `hostToolApproval` and `hostToolRun` agent tools were removed, `bash.hostApproval` now creates pending host tool approvals against the existing chat confirmation flow, and prompt/docs were updated so runtime auto-executes the stored host action after approval.
- 2026-05-13: Structured host approval prompts now carry JSON-like action metadata instead of only free-text guidance. Runner UI events and Web stream output include a dedicated `host_tool_approval` payload, Telegram/Feishu can render approve/reject buttons from that payload, pending approvals now persist structured pending host-run actions (`args/stdin/timeout`), and approving a host tool auto-executes the pending action immediately instead of waiting for a separate “continue” turn.
- 2026-05-13: `bash` now routes through the approved host-tool registry before normal execution. Single-executable commands that already exist in the approved host whitelist run directly through the internal host executor, while sandbox permission failures for eligible single commands auto-create a structured approval request and persist the newly approved executable back into settings for future direct reuse.
- 2026-05-14: Host approval rejection now sends an explicit visible runtime reply in Telegram and Feishu instead of only updating the approval card/message state, so rejecting a host tool request has a clear terminal acknowledgement.
- 2026-05-14: Auto-created host approval requests now block the current runner turn instead of being treated as a successful tool result. When sandbox permission failure triggers structured host approval, the run aborts cleanly with a “waiting for approval” terminal message so the agent does not continue producing a misleading final answer before the operator decides.
- 2026-05-16: Added a shared non-interactive host approval fallback for Weixin and QQ. Channels without native approval buttons now receive explicit text instructions for approve/reject plus per-request `/hosttools approve|reject <approvalId>` commands, and the shared command layer now supports `/hosttools reject <approvalId>` for multi-pending text-only rejection.
- 2026-05-16: Split host approval into two execution models. Single executable commands still create reusable approved host capabilities, while compound shell commands now create exact one-time approvals that execute once after approval and never enter `approvedTools`; resolved approvals are moved into dedicated history so `pendingApprovals` only contains still-waiting requests.
- 2026-05-19: Split sandbox host-approval waiting from generic abort semantics. Runner now returns `waiting_for_approval` when a host approval request blocks the turn, Telegram no longer emits `Stopped.` for that path, and the temporary waiting prompt is excluded from Telegram session history so approval resumes from clean context instead of a fake final answer.
- 2026-05-19: Sandbox env resolution now falls back to host process variables for allowlisted keys that are absent from `.env.sandbox.local`, while keeping `.env.sandbox.local` as the precedence source. Runtime startup now logs missing allowlist keys, and `/settings/sandbox` diagnostics show missing allowlist entries next to injected and denied keys.
- 2026-05-19: Tightened the global WeRead skill's execution rules. It must now verify `WEREAD_API_KEY` with `printenv` before claiming the env is missing, must surface the actual `api_name` and final request body on failing WeRead calls, and must treat `用户不存在`-style responses as real server-side business/auth errors rather than automatically blaming local env injection.
- 2026-05-15: Added DESIGN-driven page-governance documentation. `AGENTS.md` now requires all page/UI changes to follow `DESIGN.md`, `README.md` and `prd.md` both describe `DESIGN.md` as the page-design source of truth, and the documentation workflow now explicitly checks `DESIGN.md` before UI-facing edits.
- 2026-05-15: Added shadcn-first UI governance. `AGENTS.md` now requires page/UI work to stay on `shadcn-svelte` and `src/lib/components/ui` unless that component system truly cannot implement the requirement, and the same rule is mirrored into `README.md` workflow guidance plus `prd.md` documentation structure notes.
- 2026-05-15: Unified the shared Settings shell and first-screen hierarchy around the `DESIGN.md` warm-canvas direction. `src/routes/settings/+layout.svelte` now uses a more editorial nav and top chrome, while `src/styles/workbench.css` applies one shared cream/coral shell, page-hero surface, content width rhythm, warmer card treatment, and primary-action styling across settings pages without changing their underlying save/load business logic.
- 2026-05-15: Refined the new Settings shell after visual review. Ordinary page headers no longer get oversized boxed-hero treatment, and settings card borders now use softer lower-contrast strokes, especially in dark mode where the previous bright border felt too harsh.
- 2026-05-15: Tightened `/settings/ai/providers` specifically so its first screen uses the same compact header rhythm as the rest of Settings instead of keeping the old wide `div + header + button` block that still rendered like a large hero.
- 2026-05-15: Softened the shared `Card` primitive itself. `src/lib/components/ui/card/card.svelte` no longer uses the old `ring-foreground/10 ring-1` outline, and instead defaults to a lower-contrast semantic border plus a lighter shadow so reused cards stop picking up harsh black or bright-edge framing.
- 2026-05-15: Hardened `/settings/tasks` against text overflow. Summary badges now wrap, the tasks table uses fixed widths with wrapping/break-all behavior for long filenames, file paths, bot/chat ids, timezones, status reasons, and errors, and action buttons now stay inside their column instead of stretching the row.
- 2026-05-16: Split shared skills inspection into layered command outputs. `/skills` now shows only skill names and file paths, `/skills <id>` resolves one loaded skill by name/alias for full detail, and `/skills-detail` keeps the full multi-skill inventory view across shared chat commands and Web chat.
- 2026-05-16: Changed `/skills` summary output to a markdown table (`编号 / 名称 / 路径`) so it scans like `/models` instead of a loose line list.
- 2026-05-23: Moved Host Bash approval persistence out of `settings.json` / `settings_dynamic` and into dedicated SQLite tables: `host_bash_approval_records` for full request history and `host_bash_whitelist` for durable approved commands. Runtime now migrates legacy `hostTools` data once on startup, stops writing Host Bash state back into settings JSON, and keeps session-only sandbox fallback approval behavior unchanged.
- 2026-05-23: Added `/settings/host-bash` plus `/api/settings/host-bash` for Host Bash operations. Operators can now inspect pending approvals, review one-time/session/persistent approval history, enable/disable or delete whitelist entries, and delete historical approval records without touching raw JSON files.
- 2026-05-23: Fixed `/settings/host-bash` action buttons so whitelist `Disable` / `Delete` and history `Delete` now use the current shadcn Button event binding style and actually trigger their POST actions.
- 2026-05-26: Corrected user-facing bash execution labels. Approved Host Bash direct execution and session-approved host fallback now display as `Host Bash` in runner progress, diagnostics, and run detail, while `Sandbox` remains reserved for actual OS sandbox execution and `Sandbox disabled` for sandbox initialization soft-disable.
- 2026-05-26: Aligned Agent session persistence with Pi/Pae message-boundary semantics. Failed or partial runs now preserve the user prompt plus assistant error/partial output and completed tool results, while runtime control notices remain excluded from normal model history.
- 2026-05-31: Changed effective `/sandbox off` semantics to Host Bash full access. Ordinary `bash` and model-supplied `hostApproval` now execute directly on the host without creating Host Bash approval requests, while sandbox-on explicit host requests and sandbox permission failures still use the existing approval flow.
- 2026-06-06: Restyled all channel settings pages (web, telegram, weixin, feishu, qq) to use semantic CSS classes matching DESIGN.md conventions. All inline Tailwind utility classes in Svelte templates have been replaced with `.channel-*` prefixed classes defined in `settings-custom.css`. Pages now use the Warm Shadcn card pattern with hero headers, master-detail layout, and consistent form components.
- 2026-06-06: Added fixed footer bar (`.settings-footbar`) to all channel settings pages, matching the MCP page pattern. Save buttons are now pinned to the bottom of the viewport with a glassmorphic backdrop blur effect, and the form uses `id="channel-form"` with `type="submit" form="channel-form"` on the footer button.
- 2026-06-06: Converted Checkbox toggles to Switch components across channel settings pages for visual consistency with the reference HTML design system. Enable and streaming output toggles now use iOS-style switches.
- 2026-06-06: Fixed MCP settings page footer to remove remaining Tailwind utility classes, replacing them with `.settings-footbar-saving`, `.settings-footbar-pulse`, and `.settings-footbar-actions` semantic classes.
- 2026-06-07: Centralized hook-covered runtime logs behind `RuntimeLogHook`. The default HookManager now registers `RuntimeLogHook` alongside `TraceRecorderHook`, runner lifecycle/tool logs are emitted from hook events instead of duplicated local `momLog` calls, and tool hook payloads now carry `displayName` / `label` so terminal output remains readable while Trace facts continue using the same events.
- 2026-06-07: Expanded `agent_trace_facts` coverage to record `run`, `skill_usage`, `subagent_task`, `runtime_notice`, `approval`, and `input_enrichment` facts in addition to existing `tool_call` / `model_call` facts. Runner now emits hook events for input enrichment, subagent task progress, Host Bash approval requests, and budget/delegation runtime notices; `/settings/ai/trace` can filter the new fact types without inflating model-call summaries.
- 2026-06-07: Merged the duplicated system-prompt skill routing section into the message pipeline and skills protocol, then replaced the stale static prompt preview sample with a placeholder that points audits to the live generated prompt preview.
- 2026-06-07: Finished prompt P1 follow-up hardening by adding rendered prompt length regression coverage, correcting prompt-plan verification commands to the real Node test runner, and isolating `toolRuntime.test.ts` workspace whitelist writes in a temporary SQLite database.

- 2026-06-09: Added `ttsGenerate`, a shared Agent-layer deferred tool for text-to-speech generation. Supports macOS system voices through the built-in `say` command (macOS only) and Xiaomi MiMo TTS with model and voice selection. Added `/settings/tts` for enabling the tool, selecting the default provider, configuring provider credentials, selecting voices, and running test synthesis. Generated audio is saved to controlled runtime artifacts and automatically uploaded through the shared runtime upload capability when available. Channel implementations do not contain TTS generation logic.
- 2026-06-12: Fixed Feishu video delivery so outbound `.mp4` files are uploaded with Feishu `file_type: mp4` and sent as native `media` messages instead of being transcoded into OPUS voice messages. Inbound Feishu `media`/video resources are now downloaded as media and saved as `video` attachments, while non-MP4 video containers such as `.webm` are delivered as regular files rather than voice.
- 2026-06-12: Improved `videoGenerate` provider diagnostics. The tool now logs HTTP response status and response body for provider calls, including failed submissions, and redacts sensitive request headers such as `Authorization` before printing logs.
- 2026-06-20: Made the built-in `read` tool's display `label` optional. Calls with only `path` now pass schema validation, and focused runner coverage confirms `SKILL.md` reads still emit `skill.loaded` with `reason: read_skill_file`.
- 2026-07-01: Tightened the macOS Settings page vertical rhythm so sections/modules no longer crowd each other. Reworked the spacing scale in `apps/desktop/src/styles.css`: larger, calmer page-header padding; section hints now have real breathing room above the first card (and a readable max-width) instead of sitting flush against it; group titles create a clearer section break (30px above / 10px below) and use the theme-adaptive `--label-secondary` so they read correctly in dark mode; card-to-card gap 12→16px; and the chart blocks (`chart-kpi-grid`, `chart-split`/`usage-split`) now carry proper top/bottom margins so KPI tiles, trend cards, and split rows no longer touch the neighbouring cards. Verified with the updated UI structure tests, `svelte-check`, the production build, and light/dark render screenshots.
- 2026-07-01: Rebuilt the macOS Settings **Usage** and **Trace** pages from plain stat rows into chart dashboards. Both pages now lead with KPI tiles and use hand-rolled SVG charts (no chart library added): Usage shows a 30-day token/request trend area chart with a peak marker, a token-type distribution donut, and a stacked time-window comparison; Trace shows an activity bar chart (tool/model/skill/run counts), a tool-outcome donut (succeeded/failed/blocked), coverage tiles (bots/channels/chats/sessions), and an avg tool-vs-model duration comparison. To power the real trend chart, extended the credential-safe desktop usage contract with a `daily` series (`DesktopUsageDailyPoint[]`, date + token/request totals only) projected from the existing shared daily buckets in `buildDesktopUsageSummary` — per-model/per-bot detail is still dropped. Added a categorical `--chart-*` palette (drawn from the macOS accent set, light/dark variants) and chart geometry helpers (`trendLinePath` Catmull-Rom smoothing, `donutSegments`, `percentOf`). Verified with the usage server test (daily projection + credential-safety), 8 desktop UI structure tests, Desktop `svelte-check` (0 errors) and production build, plus a static render harness screenshot in light and dark mode.
- 2026-07-01: Unified every macOS Settings dropdown into one macOS-style popup button. The page previously mixed a custom single-triangle `.row-select` with raw native `<select>` controls (model routing, subagent levels, runtime defaults), so dropdowns looked inconsistent and "off". All settings selects now share one look in `apps/desktop/src/styles.css`: `appearance: none`, a soft `--control-bg` surface, a faint depth shadow, a clean stroked double-chevron (theme-aware light/dark glyph), plus hover, accent focus-ring, and disabled states. Added `--control-bg/-hover/-border/-border-strong/-shadow` tokens for both themes, gave form-grid selects a height/radius matched to adjacent text inputs, and increased `.settings-row` breathing room (min-height 50px, padding 10×16) for a calmer, more system-native rhythm.
- 2026-07-01: Migrated the root app and macOS Desktop package from separate npm installs/lockfiles to a pnpm workspace with one lockfile, shared content-addressable storage, pinned pnpm version, and pnpm-based local, CI, Docker, release-bundle, Makefile, and Tauri commands.
- 2026-07-01: Fixed pnpm-based Make targets on machines without a global pnpm binary by routing `desktop-dev`, `desktop-check`, and `dmg` plus their nested root/Tauri package scripts through Corepack while preserving an overridable `PNPM` command.
- 2026-07-01: Fixed `make desktop-dev` remaining on “Checking the local service” because the custom SQLite-aware SvelteKit Node adapter left the current adapter-node `BASE` and `PRERENDERED` runtime placeholders unresolved. Added focused replacement coverage and verified the generated service handshake.
- 2026-07-01: Started migrating the desktop app's visual system from Momo Liquid Glass (`DESIGN.md`) to Vercel Geist (`DESIGN.vercel.md`), a product-directed pivot to a flat, high-contrast, neutral-surface aesthetic across both Chat and Settings. Foundation milestone in `apps/desktop/src/styles.css`: rewrote the `:root` + dark token layers to Geist (gray 100–1000 + gray-alpha, blue-700 `#006bff` accent, `background-100/200` surfaces, 6/12/16px radii, subtle `0 2px 2px` card shadow), keeping legacy variable names remapped so existing rules re-theme without churn, and stripped every `backdrop-filter` blur, the wallpaper gradients, and translucent glass highlights. Converted core primitives: flat bordered `settings-card`, `secondary-button` (white + border), unified `select`/`input` at 6px with the Geist two-layer focus ring, Geist `status-badge` colors, neutral monochrome `settings-nav` selection (removed rainbow category tiles), and flattened brand/avatar gradient marks. Verified light + dark via a settings-layout harness, `svelte-check`, 8/8 UI tests (card assertion updated from glass-blur to flat Geist), and the production build.
- 2026-07-01: Geist migration second pass — Chat surface + interaction review. Converted `apps/desktop/src` Chat components to Geist: message bubbles (flat, 1px border, 12px radius, no glass shadow), composer (flat + Geist two-layer focus ring), `icon-button` (round macOS → 6px ghost square), send button (dropped blue glow); made `primary-button` a solid `gray-1000` fill with `panel-bg` label (correct Geist primary that inverts in dark), converted `model-chip`/`row-input`/`settings-field` inputs + textareas to 6px white Geist fields, normalized all modal/card radii to 12px, and fixed avatar/brand marks (`color: #fff` → `var(--panel-bg)`) that turned invisible in dark because `gray-1000` is near-white there. Interaction fix on `/settings/tasks` for the "too many buttons in one row" problem: the 4-button bulk-action bar (全选/清除/触发所选/删除所选, all equal weight) became a hierarchy — a selection-count chip + low-emphasis `tertiary-button` 全选/清除 helpers on the left, a spacer, then the real 触发所选 + danger 删除所选 on the right; and the per-row 3 text buttons (触发/编辑/删除) became compact `row-icon-btn` ghost icon buttons with tooltips. Verified light + dark via harness, `svelte-check` (0), 8/8 UI tests, and production build. Still to sweep: provider/sandbox/media detail rows (apply the same icon-action pattern), residual hardcoded macOS colors, and installing the Geist fonts.
- 2026-07-02: Fixed macOS Automations remaining in a loading state when its hot-reloaded frontend connected to an older local-service build. Desktop now normalizes old task summaries to recurring tasks with empty execution arrays, stops failed loads from immediately retrying forever, and has regression coverage for the version-mismatch response.
- 2026-07-02: Standardized Desktop Settings save affordances (`apps/desktop/src/App.svelte`, `styles.css`, `lib/i18n.ts`). Audited all ~22 settings sections into four patterns: instant-apply (General, model routes — no button), dirty-gated page save bar (Models advanced routing, Providers globals, Skills, Plugins, Sandbox, Web/Image/Video/TTS), per-entity editor footer (Agents/MCP/Channels/Profiles/Memory/Tasks/Providers), and read-only (Usage/Trace/Run History/Runtime Env/Diagnostics/Host Bash). Fixed the "permanent" Skills/Plugins/Sandbox save bars — they previously appeared whenever the draft object existed (created on load); now a pristine JSON snapshot is captured at load + after save and `skillsSearchDirty`/`pluginsDirty`/`sandboxDirty` derived flags gate the footer to only show on real change (matching how Models/Providers/tools already worked). Unified every save bar to one layout — a left `有未保存的更改` status label + right-aligned `放弃更改`(secondary) + `保存`(primary) via `.settings-footbar-label`/`.settings-footbar-actions` — and added Discard (revert-to-pristine) for Skills/Plugins/Models plus Sandbox's existing reset. Added `settingsUnsaved`/`discardChanges` i18n keys (zh/en). Verified light + dark via harness, `svelte-check` (0 errors), 8/8 UI tests, production build.
- 2026-07-03: Decomposed the monolithic macOS Settings UI. `apps/desktop/src/App.svelte` had grown to a single 3,953-line component holding ~258 state variables, 147 functions, and all 24 settings sections in one `{:else if activeSection === …}` chain. Split it into a per-domain architecture with no behavior change: a shared `lib/stores/session.svelte.ts` runes store holds cross-section state (endpoint, serviceReady, locale/text, error banner), and each settings domain now has its own Svelte 5 runes state module under `lib/stores/*.svelte.ts` (models, providers, agents, mcp, skills, memory, channels, profiles, plugins, tools, sandbox, hostBash, tasks, usage, runHistory, trace, runtimeEnv) plus a presentational component under `lib/settings/*Section.svelte`. Each store wraps the existing pure transport helpers in `lib/api.ts` (unchanged) with the orchestration + loading/dirty state that previously lived in `App.svelte`; each section owns its own load `$effect` and its own dirty-gated save bar (colocated instead of one global footer switch). Extracted shared helpers into `lib/settings/` (`charts.ts` SVG geometry for Usage/Trace, `timezones.ts`, `profileFiles.ts`). `App.svelte` is now a ~540-line shell: window titlebar, sidebar nav, General + Diagnostics sections, status polling, theme/locale, and the section dispatch. Left legacy-mode (`$:`) in the shell and mirrored its state into the runes `session` store for the children. Verified with `svelte-check` (0 errors/0 warnings), the desktop production build (213 modules), the updated `chat-ui.test.mjs` structure suite (9/9, repointed at the new component files), and a vite runtime transform check of every new module.
- 2026-07-08: Polished the macOS Desktop chat sidebar conversation list to the Geist reference and tightened its top spacing. Reduced `.chat-sidebar` top padding 48→30px in `apps/desktop/src/styles.css` so the nav no longer floats below a large gap under the traffic lights. Re-skinned the three sidebar components (`ChatSidebar.svelte`, `ChannelAccordion.svelte`, `ConversationRow.svelte`) to use Geist design tokens instead of hardcoded `rgba(0,0,0,0.x)` fallbacks: channel headers now read as quiet section labels (`--label-secondary`, 12px/500, `--rounded-sm` hover pill) with the heavy per-section bottom borders removed in favor of a light 2px inter-section gap; conversation rows use `--fill` hover, `--accent-soft` active fill with an accent-colored title, and `--label-tertiary` timestamps; nav items align to the same `--rounded-sm` ghost pill with `--label-secondary` icons and a single `--separator` divider under the nav.
- 2026-07-08: Added per-conversation management + collapsible channel groups to the macOS Desktop chat sidebar. Web conversation rows (`ConversationRow.svelte`) now carry an ellipsis (⋯) menu with Rename (inline title edit committed on Enter/blur) and Delete (window.confirm-gated); the menu is a fixed-positioned popup that closes on outside pointerdown / scroll / resize, and is only offered when the host wires `onRename`/`onDelete` and the row is an editable Web session (external channels stay read-only mirrors, and the `ConversationBrowserDialog` reuse passes no handlers so it renders selection-only). Wired the actions through `ChannelAccordion`/`ChatSidebar` to new `ChatView` handlers that call new client helpers `renameDesktopConversation`/`deleteDesktopConversation` (`apps/desktop/src/lib/api.ts`) against new `PATCH`/`DELETE` methods on `/api/desktop/conversations`; deleting the active session falls back to a fresh draft and disposes its runtime. Backend `renameDesktopConversation`/`deleteDesktopConversation` (`src/lib/server/app/desktopConversations.ts`) resolve the owning `externalUserId` from the Web index by session id and reuse the store's existing `renameConversation`/`deleteConversation` (Web-only). Also made the five channel accordions independently collapsible: `expandedChannel` may now be `""` (all collapsed) and re-clicking the open group closes it instead of forcing one open, with `loadExpanded`/persist/restore updated to tolerate the empty state. Added zh/en i18n keys (rename/delete/menu/placeholder/confirm). Verified `svelte-check` 0/0 and the desktop UI structure suite (26/26, updated collapse + row-menu assertions).
- 2026-07-08: Compacted the macOS Desktop chat sidebar conversation rows (`ConversationRow.svelte`) from a two-line (title over timestamp) layout to a single line. The status dot (running/waiting/completed/failed) is now an absolutely-positioned corner badge on the Bot avatar — with a `--sidebar-bg` ring and the running-pulse keyframes reworked to keep that ring — so it sits at the far left and never consumes the title's horizontal space. The title fills the middle (`flex: 1` with ellipsis) and the timestamp sits at the far right; on row hover/focus (managed Web rows only) the timestamp yields its slot to the ⋯ menu button, while read-only external rows keep showing the timestamp. `svelte-check` 0/0, desktop UI suite 26/26.
- 2026-07-08: Two fixes to the macOS Desktop chat sidebar list. (1) Added `formatListTime` in `ChatView.svelte` for sidebar/browser rows: today's conversations show the clock (HH:MM), yesterday shows the "昨天" label, and older rows show a bare date (month/day, or year/month/day across years) with no hour/minute; the shared `formatSessionTime` is kept for transcript message timestamps so those still show the time. (2) Fixed Delete being a no-op: it depended on the native `window.confirm`, which is unreliable in the wry/Tauri webview (it returned falsy so the handler bailed before calling the API — rename worked because it uses no confirm). Replaced it with an inline two-step confirmation rendered inside the row menu (`ConversationRow.svelte`): clicking 删除 swaps the menu to a "删除该对话？" prompt with 取消/删除 buttons, and only 删除 fires `onDelete`. Removed the now-dead `deleteConversationConfirm` i18n key; added `deleteConversationPrompt` + `cancelAction`. `svelte-check` 0/0, desktop UI suite 26/26.
