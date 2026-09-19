### 修复：飞书交互卡片按钮点击无反应（2026-09-19，待验证）

- 症状（owner 实机走查）：Telegram / 飞书 `/menu` 卡片正常渲染，但点击任何按钮都没有反应；owner 怀疑飞书没收到点击动作。
- 根因：飞书长连接推送的是新版卡片回调 `card.action.trigger`，它的响应体必须把卡片嵌在 `{ card: { type: "raw", data } }` 里；而 `handleWsCardAction` 直接返回裸卡片（那是旧版回调的响应结构），客户端会判为响应体格式错误并忽略。一次性动作因为有“后台按 `open_message_id` 更新源卡片”的补偿，视觉上还能更新；纯导航动作（会话/模型/项目/思考/技能/状态/队列）只依赖回调查询结果，于是整片菜单看起来完全没反应。回调其实到达并执行了，只是响应被丢弃。
- 修法（共享渠道层）：`handleWsCardAction` 统一返回 `{ card: { type: "raw", data } }`，旧版 HTTP 回调路径保持不变；回调日志补上 `transport: "websocket" | "http"`，让“回调没到 / 动作失败 / 回执失败”可区分。
- 机器守卫（`feishu/runtime.test.ts` 新增 1 条）：用真实的 `card.action.trigger` 解析后结构驱动 `handleWsCardAction`，断言导航动作返回 `{ card: { type: "raw", data } }` 且 `data` 是对应视图卡片。
- 验证：`feishu/runtime.test.ts`、`cardkit.test.ts`、`messaging.test.ts` 共 33 项通过；`tsc --noEmit` 无新增错误；production build 通过。真实飞书点击走查仍需 owner 复测确认，能力状态保持“待验证”。
- 后续核查：若复测仍无反应，需检查飞书开发者后台「事件与回调 → 回调配置」的订阅方式是否为“使用长连接接收回调”，且已订阅“卡片回传交互（card.action.trigger）”；旧版回调（`card.action.trigger_v1`）不支持长连接，只支持回调地址。

### 修复：Interaction 输入终态与 Stop 目标一致性（2026-09-19，待验证）

- 症状（PR #58 审查确定性复现）：
  - 取消输入请求后回复原提示，`SharedInteractionService.consumeInputReply` 返回 `handled:false`；Telegram / 飞书都把这条迟到回复当普通消息，可能变成新的 Agent 任务。
  - `stopInteractionRun` 在 `await` 队列查询之后不再校验绑定 run：查询期间 run 从 A 换成 B 时会停掉 B；`cancelQueuedPending(scopeId)` 按 scope 全清，确认后新入队、用户没见过的任务也会被清除。
- 根修（共享层，不在各渠道加判断）：
  - `stopInteractionRun` 在每一次异步等待（队列读取、确认集清除）之后、真正 `stopRun` 之前重新校验绑定 run identity；确认集 stale 时整单失败，不停止也不清除。
  - `PersistentTaskQueue.cancelPending(scopeId, expectedIds?)` 改为事务内比对实时 pending 集合：只有与确认快照完全一致才删除这些 ID，否则返回 `stale` 且不删除任何行；`/stop` 保持“清空该 scope 全部 pending”的既有语义。
  - `clearInteractionQueue` 改为携带确认 ID 集合，stale 时返回确认失效并要求重新确认（`queue.clear.confirm` 据此显示失效视图）。
  - 取消不再直接删除输入记录，而是留下终态 tombstone；过期、目标变化、重复投递同样保留，`consumeInputReply` 永不因一次拒绝就删除内存记录，因此第二次、第三次迟到回复仍被明确拒绝。
  - 新增 `SqliteInteractionPromptStore`（每个 bot workspace 一个 `interaction-prompts.sqlite`，按 channel+instance 分区）：输入提示在绑定平台消息 ID 时落盘。重启后旧提示按“已失效”恢复为终态 tombstone，回复旧提示得到明确拒绝，而不是静默变成新任务；旧按钮仍按设计失败关闭。
- 机器守卫：
  - `persistentTaskQueue.test.ts`：确认集原子清除 + stale 不误删。
  - `channelCommands.test.ts`：Stop 期间 run 变化（不得停 B）、pending 集合变化（stale、不停止）、只清确认 ID、原子 stale 时零变更。
  - `service.test.ts`：取消/过期/重复/重启后迟到回复均 `handled:true` 且无 `agentText`；普通消息仍 `handled:false`。
  - `feishu/runtime.test.ts`：真实飞书消息入口（`handleIncomingMessage`）——取消后回复旧输入卡片不会 enqueue Agent 任务。
- 上一轮只给 `handleQueuedControlAction(steer)` 的“异步查询后重校验 run”配了回归；Stop 走独立的 `stopInteractionRun`，只在方法开头校验一次，同类异步竞态因此没有被既有守卫拦住，本次补齐该路径回归（根因类别：异步竞态 / 目标身份在 await 后失效）。
- 验证：PR 门禁定向测试 97 项全通过（含本次新增），`persistentTaskQueue` / `inboundCoordinator` 9 项共享层测试通过；`tsc --noEmit` 无新增错误（315 项均为仓库既有）；`pnpm run build` production build 通过。真实 Telegram / 飞书首次打开、topic/thread、重启失效、离线输入与服务中断恢复走查仍未完成，能力矩阵中该能力保持“待验证”。

### 新增：Telegram / 飞书 Interaction-first Agent 控制（2026-09-19，待验证）

- Telegram 与飞书新增统一 `/menu`，Model / Session / Project / Thinking / Skills / Queue / Status 使用平台原生按钮或卡片；Slash Command 保留，并与按钮复用共享业务动作。
- `SharedInteractionService` 只承载控制面：短 token、操作者/chat/topic/session/project/run 绑定、过期/容量清理、确认快照和回复绑定输入。普通自然语言仍走原 Agent 消息路径，Approval / Memory Review 保留独立授权生命周期。
- Steer / Follow-up / Queue front / Skill Run 不再要求手写参数：系统发送专用输入提示，只消费对该提示的明确回复；重复投递只提交一次，目标切换或运行结束后旧输入失败关闭。
- Stop 保持“停止当前 run + 清除 pending queue”语义；存在 pending 时先显示影响范围并确认。Queue cancel 只取消指定 pending，Clear pending 不停止当前 run，恢复任务保留重复副作用警告。
- Busy Queue 通知已迁移到共享 Interaction token，移除 Telegram `qctl:*` 与飞书旧 `queued_control` 双轨；Status 在普通 Session 达到现有 compaction 阈值时提供 Compact / New Session。
- Telegram callback 仅发送 `ix:<token>`；飞书卡片仅发送 token，并对一次性动作先返回 Processing、后台单次执行后更新原卡片，更新失败只补发结果、不重放业务。
- 需求与安全约束见 `docs/requirements/bot-interaction-2.md`，共享架构见 `docs/designs/channels/bot-interaction-2.md`。机器测试与 production build 作为 PR 门禁；真实 Telegram / 飞书首次打开、topic/thread、重启失效和中断恢复走查完成前，能力状态保持“待验证”。

### 调整：文件面板范围提示并入居中空状态，消灭左上角散落提示（2026-09-17，已交付）

- 背景（owner 走查）：「变更 → 本次会话」「附件」tab 在列表上方各有一条左上角对齐的范围说明（"只显示本次会话中 Agent 写入过的文件。" / "仅显示当前会话消息中的附件。"），与下方居中的空状态并排显得杂乱；owner 期望统一为「icon + 居中主文案 + 居中次要说明」的样式（即 Git 不可用空状态已有的样式）。
- 根修（共享层）：删除两条独立的 `.project-panel-scope` 提示段落，把提示文案降级为对应 `.file-empty` 空状态的 `<small>` 次要行——「本次会话」空态（icon + 本次会话还没有修改任何文件 + 会话范围说明）、「全部改动」空态（icon + 当前项目没有 Git 变更 + 全局状态说明）、「附件」空态（icon + 当前会话还没有附件 + 附件范围说明）。列表有内容时提示随段落一起消失，范围语义由分段控件标签（"本次会话 (0)" / "全部改动 (37)"）承载。
- 清理（不留兼容层）：删除 `ArtifactPanel.svelte` 两处 `.project-panel-scope` 段落与 `styles.css` 中该类的两条规则（含 artifact-panel 作用域选择器）。
- 机器守卫（`chat-ui.test.mjs` 新增 1 条）：所有 Svelte 源与样式表不得再出现 `project-panel-scope`；三条空状态必须以 `</span><small>{copy.…Hint}</small></p>` 结构携带各自的范围提示，拦住「左上角散落提示」整类回归。
- 验证：`chat-ui.test.mjs` 261/261、`svelte-check` 0 错 0 警、`vite build` 通过；隔离 Vite 预览实例（`VITE_MOLIBOT_PREVIEW=1`，1430 端口，未触碰运行中的 1420 dev 服务与 3040 正式服务）浏览器冷路径走查真实组件树：项目会话面板「变更 → 本次会话 (0)」与「附件」空态均为 icon + 居中文案 + 居中次要说明，「变更 → 全部改动 (37)」直接显示列表、无任何角落提示，截图确认与 owner 指定的 Git 不可用空态同款样式。

### 修复：发布管线根修——Intel 打包不再阻塞 latest.json，v2.9.58 更新清单补齐（2026-09-17，已交付）

- 症状（owner 反馈）：升级打包时 Intel 构建一卡住，latest.json 就发布不出来，客户端自动检测更新失败。
- 根因（上一次守卫为什么没拦住）：2026-09-16 的修复把 manifest job 的条件放宽到「`build` 失败也发布」，但 `needs: build` 指向的是 matrix 整体——只要任何一条腿还在跑/排队，`build.result` 就是 pending，manifest 只能干等。而 GitHub 已退役 `macos-13`（最后一个免费 Intel macOS runner 镜像），Intel 腿永远排不上机器：`gh run` 实测 v2.9.55/9.57 两条 run 均挂满 24 小时后被 cancelled，manifest 最终 skipped。守卫只覆盖了「失败（failure）」这一种结局，没覆盖「卡住（queued→cancelled）」。
- 修法（`.github/workflows/desktop-release.yml` 重构）：
  - matrix 拆成 `build-arm64`（`macos-15`，arm64 标准镜像）与 `build-x64`（`macos-15-intel`，现役免费 Intel 镜像）两个独立 job——只有拆开才能让 manifest 只依赖其中一条腿；顺带把 arm64 从已有退役公告的 `macos-14` 升到 `macos-15`，消除同类隐患。
  - `manifest` job `needs: [build-arm64]` 且 `if: !cancelled() && needs.build-arm64.result == 'success'`：Apple Silicon 构建一完成就生成并发布 latest.json，Intel 无论排队、失败还是取消都碰不到它。
  - 新增 `manifest-intel` job（`needs: [build-arm64, build-x64]`，按 `build-x64` 成功触发）：Intel 也成功后从本次全部 updater 产物重新生成含双平台的 latest.json 并覆盖发布（内容恒为 manifest 的超集，写入时序上必然后落盘）；arm64 万一失败时它仍会发布 x86_64 单平台清单兜底。
  - 构建产物的 release 上传列表补上 `updater-platform-*.json`，发布物可自查、事后补清单不再需要重新构造签名。
- 机器守卫（`scripts/generate-desktop-latest-json.mjs` + 测试）：CLI 在写盘前校验平台数——找不到任何有效 `updater-platform-*.json`（零文件或全部损坏/缺字段）时 `exit 1` 且不落盘，杜绝把空/坏 latest.json 覆盖到 release 上；单个文件解析失败仅告警跳过、不扩散。`finalize-desktop-release.test.mjs` 新增 2 条回归：损坏/缺字段文件被跳过且好文件照常合并；CLI 对全坏输入拒绝写出。
- 线上补救：v2.9.58 的 run 当时 11 秒即被取消、release 上缺 latest.json（`releases/latest/download/latest.json` 404，自动检测失败中）。已从 release 上现存的 `.sig` 构造 platform json、用同一生成脚本产出 latest.json 并 `--clobber` 上传，更新器端点实测已返回 v0.9.58 双字段正确清单。
- 验证：`finalize-desktop-release.test.mjs` 10/10 通过；actionlint 0 错（含顺手修掉两处原有 SC2129）；YAML 解析通过；本地模拟「一个好平台 + 一个坏平台文件」生成成功且坏文件只告警。
- 遗留风险：`macos-15-intel` 是 GitHub 免费档最后的 Intel macOS 镜像（官方只承诺维护最近两个 macOS 版本），未来退役时 Intel 腿会再次排队挂死——但按本次结构，它届时只会拖长自己的构建，latest.json 与 arm64 发布不再受影响；到时再决定 Intel 是去是留（例如 arm64 runner 上交叉编译 x86_64）。

### 修复：project 维度的主题区域钩子漏挂（右上角没有黄色芯片）（2026-09-17，已交付）

- 症状（owner 走查 Raft）：对话维度右上角是黄芯片，切到 project 维度后同一排按钮变回中性、没有主题色。
- 根因（不是样式问题，是钩子漏挂）：project 维度不复用 ChatView 的内联 header，而是共享组件 `ChatHeader.svelte` 渲染 `.chat-header`，该元素上没有 `data-theme-region="header"`（只有 ChatView 那份有）；于是所有主题的 header 适配——含 6 个硬边家族的 accent 芯片——到 project 维度就断掉。同一处 `ProjectDetail.svelte` 自己的 `.chat-content` 也漏了 `data-theme-region="chat"`，画布适配同样失效。
- 现状守卫为什么没拦住：`chat-ui.test.mjs` 的区域钩子测试只断言了 ChatView / ChatSidebar / ChatInputArea / ArtifactPanel 里的挂载点。共享组件是「一个区域一个挂载点」这条规则唯一会在没有第二份副本的情况下被破坏的地方，而它恰好不在断言里。
- 根修（共享层）：`ChatHeader.svelte` 的 `.chat-header` 补 `data-theme-region="header"`；`ProjectDetail.svelte` 的 `.chat-content` 补 `data-theme-region="chat"`。没有新增区域、没有 per-panel 特判。
- 机器守卫：区域钩子测试扩展为同时断言 `ChatHeader.svelte` 的 header 挂载与 `ProjectDetail.svelte` 的 chat 挂载，并在注释里写明「复用区域元素必须自己挂钩子」。
- 已评估并否决（owner 决定保留现状）：把黄色芯片上的图标从墨色改成白色。实测对比度——墨色 `#161311` 压 `#ffd440` = **12.99:1**；纯白 = **1.42:1**（图标会发虚）；白字要达到非文本图形 3:1 门槛需把芯片加深到 `#a67c00` 左右，那就不再是 raft.build 的信号黄。结论：保持墨色图标。
- 验证：`chat-ui.test.mjs` 260/260、`project-sidebar` + 全部 `.mjs` 守卫 261/261、桌面 `svelte-check` 0 错 0 警、`vite build` 通过。未做真机走查（本次只加两个属性 + 两条断言，无新代码路径）。

### 修复：文件面板 tab 条被长列表压扁（内容盖住 tab）+ 工具按钮计数徽章与按钮粘连（2026-09-17，已交付）

- 症状（owner 走查）：① 文件面板「变更 → 全部改动」时下方列表上移、盖住「文件/变更/附件」这一行；② 切到「文件」tab 同样；③ 工具按钮右下角的计数徽章和黄色按钮粘成一块。
- 根因 1（真 bug，CLAUDE.md pitfall 16(c) 同族：一个 flex item 的尺寸会静默塌成 0）：`.artifact-panel .project-file-tabs` 是 `.file-panel`（flex column）里**唯一**显式写了 `min-height: 0` 的固定高度 chrome 行。它的 flex 兄弟 `.project-browser` 是滚动面板，flex base size 等于整棵文件树 / 整个变更列表的**完整内容高度**；内容一长就给 flex line 一个巨大的负剩余空间，而 `min-height: 0` 恰好去掉了这一行的 automatic min-content 下限，于是它被按比例压扁，内部 26px 按钮保持原高溢出到盒外，随后的 `.project-panel-body`（后一个兄弟）直接绘制其上——即「内容盖住 tab」。同行的 `.project-change-scope` 之所以没事，正因为没人给它写 `min-height: 0`，它靠自动 min-content（34px）自保。
- 证据（真实 `styles.css` + 真实面板 DOM，浏览器实测）：同一 DOM，`min-height: 0` 时 tab 条 46px → **7px**（207 条变更）/ **11px**（80 行文件树）且按钮溢出；改 `flex: 0 0 auto` 后三种内容量都稳定 **30px**、无溢出。
- 根修（共享层）：`.artifact-panel .project-file-tabs` 的 `min-height: 0` 改为 `flex: 0 0 auto`。它本来就是固定 chrome，和面板里另两行 chrome（`.file-filters`、`.project-viewer-tabs`）已有写法一致，不是新增约定。
- 根因 2（徽章粘连）：`.icon-badge` 与工具芯片同为 `--accent` 底，Raft 下黄底黄标（且全直角）视觉上合成一块。
- 修法（6 个硬边家族 region 层）：徽章取**芯片反色**——静止（accent 芯片）时 `--on-accent` 底 + accent 字；按下/展开（芯片已反色为 `--on-accent` 底）时翻成 `--accent` 底 + on-accent 字。两态都覆盖，杜绝「按下后徽章又和芯片同色」的二次粘连；与各家族已有的「选中 nav 行里的未读徽章反色」同一套语言。
- 机器守卫（chat-ui.test.mjs 新增 1 条 + 扩展 1 条）：① 「文件面板 chrome 行不得被长滚动面板压扁」——断言 `.project-file-tabs` / `.project-viewer-tabs` / `.file-filters` 三条规则都不得出现 `min-height: 0`，且 tab 条必须是 `flex: 0 0 auto`（断言前先剥离注释，否则规则自己的说明文字会命中）；② poster 家族测试扩展：徽章必须有静止/按下两套反色。
- 验证：`chat-ui.test.mjs` 260/260、全部 `.mjs` 守卫 272/272、`vscodeTheme.test.ts` 15/15、桌面 `svelte-check` 0 错 0 警、`vite build` 通过。未在 Tauri 真机复跑（本次只改 CSS 声明，无新代码路径）。
- 环境备注：本次发现工作区里同时存在另一条并行会话的未提交改动（titlebar 控制簇重构，涉及 `ChatView.svelte` / `ChatHeader.svelte` / `ChatWorkspacePane.svelte` / `ProjectDetail.svelte` / `styles.css` / 发布脚本）。本次只在共享 `styles.css` 内新增/修改与面板和 footer 相关的块，未触碰该会话的改动。

### 调整：标题栏控制簇根修——折叠按钮固定红绿灯右侧，折叠态搜索换新建（2026-09-17，已交付）

- 背景（owner 走查）：折叠按钮在展开态位于侧栏右上角，点击折叠后按钮跳到窗口右上角（工作台页），位置跳变不合理；期望按钮固定在红绿灯右侧不动，折叠态隐藏搜索、换成新建对话。
- 根因：折叠/搜索按钮原本住在 `ChatSidebar` 顶栏内部且右对齐，而折叠是把整个侧栏压到 0 宽隐藏——按钮随侧栏一起消失，于是对话页 / 各工作台页 / 项目页各自渲染了一份展开按钮副本，位置各不相同（对话页在左、工作台页在右上），这就是「按钮跑到右边」的来源。
- 根修（共享层）：标题栏控制簇提升为 ChatView 里的窗口级固定层（`left: 84px`，对齐 Tauri 红绿灯偏移 + 现有 84px 约定；本项目为纯 macOS 应用，偏移可写死）。簇两个槽位按状态切换、坐标不动：展开 = `[折叠][搜索会话]`，折叠 = `[折叠][新对话]`；折叠态点新对话会顺带展开侧边栏（owner 确认的方案），让新会话出现在可见列表里。展开态搜索按钮随折叠按钮一起靠左成组（owner 确认），侧栏右上角变纯拖拽区。
- 清理（不留兼容层）：删除 ChatHeader / ChatWorkspacePane / ChatView inline header 三处面板级展开按钮副本及 `sidebarCollapsed`/`onToggleSidebar`/`onOpenConversationSearch`/`onToggleCollapse` 传递链，删除全局 `.sidebar-expand-btn` 与 `.workspace-header-expand` 死样式；按钮样式上移为共享层 `.titlebar-cluster` + `.sidebar-titlebar-btn`。簇容器带 `data-theme-region="sidebar"`，6 个硬边主题家族对 `.sidebar-titlebar-btn` 的 accent 芯片规则零改动继续生效。
- 折叠态标题避让：`.chat-header` 折叠态 `padding-left` 84→150px（红绿灯 + 两按钮 + 间隙 + 呼吸位），工作台 PageHeader 同步 150/150 对称保持标题列居中；窄侧栏轨道 170px > 簇末端 142px，无重叠。
- 机器守卫（chat-ui.test.mjs 重写 2 条）：① 侧栏不得再有顶栏按钮、所有 Svelte 源不得再出现 `sidebar-expand-btn`、样式表不得再有该类（拦住「面板级副本重新长出来」整类回归）+ DESIGN.md 规范条目钉住；② 簇的搜索/新建槽位切换与 `newChatFromCollapsedSidebar`（先展开后新建）钉住。
- 规范先行：DESIGN.md 新增「title-bar control cluster」条目（窗口级、红绿灯右侧锚定、槽位切换语义、禁止面板级按钮），本次在同一 slice 内对所有受影响面板统一应用。
- 验证：`chat-ui.test.mjs` 259/259、桌面全部测试 313+271+7 全绿、`svelte-check` 0 错 0 警、`vite build` 通过；隔离 Vite 实例冷路径走查（浏览器渲染真实组件树，未触碰运行中的桌面实例）：展开态簇在红绿灯右侧 → 折叠后簇原地不动、搜索换新建 → 折叠态点新建顺带展开侧边栏 → Agent 工作台折叠态标题从簇后开始、右上无孤儿按钮 → Blueprint 主题 accent 芯片正确落在簇按钮上。真机红绿灯下的最终目视确认待 owner 在桌面端完成。

### 调整：Raft 同族硬边主题的 nav/画布分面、主色上控件、选中浮起；侧栏底部去分割线（2026-09-17，已交付）

- 背景（owner 走查 Raft）：① 左侧 nav 选中项只有底色，没有像输入框那样的浮起描边；② 顶部工具按钮没有主色，信号黄「隐身」；③ 浅色下 chat 画布偏黄、nav 与 chat 同色没有区分度；④ nav 底部头像/设置区有分割线，齿轮看不清，「在线」两字多余。owner 确认范围：Raft 为主，同一套处理推广到同为硬阴影/poster 语言的 Brutalism、Blueprint、System 6、Terminal、Win98；底部区域改到全局所有主题。
- 分面（各主题 light/dark token 块）：画布与导航不再同色。Raft 亮 = 奶油导航 `#fffaef` + 白画布 `#ffffff`；Raft 暗 = 导航压深 `#100e0c`、画布保持 `#161311`；Brutalism 亮白画布 / 暗画布抬到 `#161616`；Blueprint 亮白画布 / 暗画布 `#0f365c`；Terminal 亮导航压到 `#e2ebe0` / 暗画布 `#0a120a`；Win98 亮白文档画布（header region 由灰→白渐变改为平铺灰工具栏）/ 暗导航 `#232323`。System 6 是文档化例外：1-bit 家族只有 `#000000` / `#ffffff` 两个结构色，给不出第二级面，保持单面 + 硬分隔线。
- 主色上控件（各主题 region 层）：`[data-theme-region="header"] .icon-button` 与 `[data-theme-region="sidebar"] .sidebar-titlebar-btn` 铺 `--accent` 底 + `--on-accent` 图标 + 1px on-accent 描边 + 下/右硬偏移边（Brutalism 用 `--soft-shadow` 3px，其余 `2px 2px 0 0 var(--control-border-strong)`，与各自选中行一致）；hover 走 `--accent-hover`，按下/展开反色（`--on-accent` 底 + accent 图标）并保留同一条偏移边，形成「贴纸」而不是无边的色块。
- 已评估并否决：把整条 header 铺成黄色。三个硬理由：① 折叠态 `.chat-header` 背景仍铺满窗口宽度（`inset: 0 0 auto`，`padding-left: 84px` 只推内容），黄带会压到左上红绿灯，macOS 最小化黄点 `#ffbd2e` 与 `#ffd440` 对比度仅 1.17:1，等于消失；② header 里的会话标题/来源标签必须整体翻色（奶油/墨字压在黄底是 1.25–1.37:1，墨黑变体下 `--label-secondary` 只有 1.32:1），等于再造一层「黄底语义」；③ 大面积黄把黄色从「信号」降级成「环境色」，而原站黄色永远是小块 CTA。结论：保留黄色芯片，只补硬偏移边。
- 选中项浮起（各主题 region 层）：`.nav-item.active` 补 `--accent` 实底 + 硬偏移 + `inset 0 0 0 1px` on-accent 细环；`.conversation-row.active`（Raft 保持 `--selection-bg` 粉）加同款边。偏移取各家族自己的硬边 token——Brutalism 用 `--soft-shadow`（3px 黑/奶油），其余用 `--control-border-strong`（Raft 墨/奶油、System 6 黑白、Win98 深灰）——所以是各家族用各自的硬边语言，不是照抄 Raft 的 2px。
- 焦点环（自查发现的回归）：accent 芯片和选中行的浮起都画在 `box-shadow` 上，而共享 `button:focus-visible` 的键盘焦点环用的也是 `box-shadow`——主题 region 规则特异性更高会把焦点环整条吃掉。修法：每个家族补一条 `:is(.icon-button, .sidebar-titlebar-btn, .nav-item.active):focus-visible`，写回应用自带的焦点语言（`0 0 0 2px var(--card-bg)` 间隙 + `0 0 0 4px var(--accent)` 环）并保留芯片自己的细边。会话行不需要覆写——`.conversation-row` 是不可聚焦的 div，焦点落在它的内层 `.row-open` 按钮上，那条规则不会被覆盖。
- 侧栏底部的设置齿轮（6 个家族）：底部的设置齿轮穿上和顶部栏按钮同一件 accent 芯片——28px 黄块 + 下/右硬偏移边 + 1px on-accent 细环，hover 走 `--accent-hover`，让侧栏上下两端都有家族主色。芯片用 16px 图标盒 + `padding: 6px` 画到 28px，再用 `margin: -6px` 把布局占位压回 16px——region 层只改形态、不让 footer 文字重排。芯片不遮盖键盘焦点：焦点环画在 footer 那个 `<button>` 上，和齿轮是两个元素。
- 侧栏底部（全局所有主题）：`ChatSidebar.svelte` 删掉 footer 自己声明的分割线；共享层 `styles.css` 的基础 `.sidebar-footer` 也去掉 `border-top`（项目侧栏的同一排头像/设置行受益，「对话/项目」列表下方的动作块仍由 `.sidebar-return` 自己的线分组），所以「头像/设置行上方没有分割线」是一条统一规则而不是逐面板特判。齿轮从 `--label-tertiary` × 0.6 透明度改到 `--label-secondary` 满强度、hover `--label-primary`（其余 19 个主题保持这个中性可读档位，只有上述 6 个硬边家族升为黄芯片）；「在线/离线」一行移除——头像上的状态点已表达状态，文案保留为按钮 `aria-label`，状态不靠颜色单独表达。
- 机器守卫（chat-ui.test.mjs 新增 2 条主题守卫 + 1 条侧栏底部守卫）：① poster 家族必须在工具控件上保留 accent 实底 + on-accent 字 + 硬偏移边，必须有 `:is(...):focus-visible` 写回共享焦点环（拦住「画在 box-shadow 上吃掉焦点环」整类），且底部设置齿轮也必须是 accent 芯片 + 细环；② poster 家族选中行必须保留实底 + `inset 0 0 0 1px` 细环；③ poster 家族 nav 与画布不得同色（仅 System 6 断言两者必须相同）；④ 侧栏底部无分割线、无冗余状态行、齿轮走二级标签色、状态文案仍在 `aria-label`。
- 验证：`chat-ui.test.mjs` 259/259、全部 `.mjs` 守卫 271/271、桌面 `svelte-check` 0 错 0 警、`vite build` 通过。未做 Tauri 壳内真机截图走查（本次只改 region/token/ChatSidebar 标记，无新代码路径），冷启动目视确认待 owner 在桌面端完成。
- 遗留风险（未修，owner 选择保持现状）：黄色工具芯片与它右下角的计数徽章都是 `--accent` 底，徽章会和芯片粘成一块，"有 N 个文件"的提示被削弱。若要修，方向是徽章改走 `--selection-bg` 粉底墨字（Raft 的选中色对）。

### 调整：文件面板 tab 与筛选器统一到分段控件语言（2026-09-16，已交付）

- 背景（owner 走查）：文件面板（右侧检查器）顶部的「本轮文件/文件」tab 是 GitHub 式下划线 tab，媒体筛选（全部/图片/视频/音频/文档）是描边小方块，与技能页/自动任务页已统一的分段控件明显不一致，且激活态（黄色下划线、黄味色块）在 Raft 下很不明显。
- 根因：`.artifact-panel` 覆盖层曾有意采用「仓库导航：扁平 tab + 下划线激活」的独立风格（注释自述 "not a floating macOS segmented pill"），`--artifact-*` token 虽然都别名到产品 token，但视觉语言与产品分段控件分叉。
- 修法（styles.css 共享层）：删除下划线 tab 覆盖，`.project-file-tabs` 与 `.file-filters` 改为与 `.automation-category-tabs` 相同的分段语言——`--fill` 底轨、激活段 `--card-bg` + `--soft-shadow` 卡片浮起、hover `--fill-hover`；激活 tab 的计数徽章走强选中 token 对（Raft 下粉底墨字），非激活徽章改中性灰（`.is-session` 的警告色"本轮"语义保留，并在级联后部重申防覆盖）。
- 机器守卫：chat-ui.test.mjs 新增「文件面板导航与筛选必须用共享分段语言」——钉住激活态 card-bg/soft-shadow、激活徽章 selection token，并断言下划线层保持退役。
- 验证：`chat-ui.test.mjs` 256/256、桌面 `svelte-check` 0 错 0 警、`vite build` 通过；静态 harness 亮/暗截图走查确认新语言在 Raft 奶油/墨黑两变体下与技能页观感一致。

### 修复：弹窗尺寸层叠根修 + D2/Mermaid 放大弹窗近全屏（2026-09-16，已交付）

- 症状（owner 反馈）：D2 图表放大弹窗太小、内容看不清，也无法放大；对比表格 / HTML / 图片的放大都应是近全屏。
- 根因（共享层，非 D2 专属）：`.desktop-dialog-content` / `.desktop-dialog-overlay` 基础规则是单类选择器且声明在 styles.css 靠后位置；与 `contentClass` / `overlayClass` 变体同特异性时按 source order 反过来压住所有更早声明的变体，尺寸静默退回 560px 默认。D2/Mermaid 只是其中之一，同类此前已被逐个打补丁两次（`.entity-editor-dialog`、`.markdown-artifact-dialog`）。
- 根修：基础规则改为 `:where(.desktop-dialog-overlay)` / `:where(.desktop-dialog-content)` 零特异性，任何变体无论声明顺序都能覆盖；并删除三处已无必要的复合选择器（`.desktop-dialog-content.entity-editor-dialog`、`.desktop-dialog-content.session-preview-dialog`、artifact 的 overlay/dialog 配对）。
- D2/Mermaid：`.mermaid-zoom-dialog` 改为 `calc(100vw - 48px)` × `calc(100vh - 48px)`，与表格/HTML lightbox 一致的近全屏，保留标题栏与缩放工具栏，舞台占满剩余空间。
- 全量恢复（同一根修一并修好被压回 560px 的弹窗设计尺寸）：`.task-history-modal`（820）、`.task-session-modal`（760）、`.service-log-detail-dialog`（760，含窄屏媒体查询）、`.provider-model-discovery-dialog`（700）、`.miniapps-install-dialog`（640）、`.provider-auth-dialog`（600）、`.installed-skill-dialog`（580）、`.preview-card`（820）、`.confirm-dialog`（360，此前被撑宽到 560）；`.provider-model-edit-dialog` 与 `.conversation-browser-dialog` 不受影响。
- 机器守卫：`chat-ui.test.mjs` 新增「基础规则零特异性 + 不存在带 width/height 的裸 `.desktop-dialog-content` 规则 + 恢复后的变体尺寸」，把整类层叠回归拦住，而不只是本次这一处。
- 验证：`chat-ui.test.mjs` 255/255、桌面 `svelte-check` 0 错 0 警、`vite build` 通过。

### 修复：野兽派 / Win98 / System 6 输入框四边描边（2026-09-16，已交付）

- owner 确认把上一条 Raft 的 composer 描边修法推广到另外三个硬边主题。同一根因：三个主题的 composer region 规则都只改 `border-color` + 在元素自身叠偏移阴影，而 1px 边框被不透明 `::before`（`inset:-1px`）整圈盖住——上、左无线，下、右是双层阴影叠加。
- 修法（各主题 region 层，与 Raft 相同模式）：`box-shadow: var(--float-shadow), inset 0 0 0 1px var(--control-border-strong)` 移到 `.composer::before`，元素自身不再叠阴影。各主题按自己的描边语言生效：野兽派亮/暗=黑线/奶油线 + 5px 硬阴影；System 6=黑线/白线 + 3px 1-bit 阴影；Win98=外圈深灰描线 + 凸起浮雕（`--float-shadow` 的 inset 浮雕部分此前被实色层盖住不可见，移到 `::before` 后首次真实可见，回归经典 Win98 凸面板语言）。
- 机器守卫：chat-ui.test.mjs 新增「四个不透明粗野主题（brutalism/win98/system6/raft）的 composer 描边必须画在 `::before` 玻璃层上且带 `inset 0 0 0 1px var(--control-border-strong)`」，把"只改 border-color 导致边框消失"这一缺陷类整体拦住。
- 验证：`chat-ui.test.mjs` 254/254；静态 harness 六页（三主题 × 亮/暗）截图走查 + 暗色 PNG 像素采样复核（野兽派描线 rgb(204,198,185)≈奶油、System 6≈白、Win98≈#8a8a8a，画布各自正确）。

### 调整：Raft 主题三处观感修正——nav 主色黄、tab 计数徽章、输入框四边描边（2026-09-16，已交付）

- owner 走查反馈三条：① 左侧 nav 的选中项（技能）背景应该是主色黄（黄=主、粉=第二主色的分工）；② 激活 tab 里的计数数字黄字看不清，应换粉色（或粉底白字），且要兼顾暗色与其他主题；③ 输入框只有下、右两边有黑线，上、左两条细边框缺失。
- nav 选中项（raft.css region 层）：`[data-theme-region="sidebar"] .nav-item.active` 铺 `--accent` 黄底 + `--on-accent` 墨字，图标同色；行内的未读徽章反色（墨底黄字），避免黄徽章贴黄行不可见。其余主题的 nav 选中态不变。
- tab 计数徽章（styles.css 共享层，修复而非 Raft 专属）：`.automation-category-tabs button.active small` 从 `--accent-soft` 底 + `--accent` 字（浅色 accent 下对比度不足，黄底白卡上尤其明显）改为 `--selection-bg` 底 + `--on-selection` 字——Raft 得到粉底墨字，其他主题得到各自 accent 实色底 + on-accent 数字，暗色同样成立；自动任务页同规则同步受益。
- 输入框描边（根因与根修）：`.composer` 本有一圈 1px 边框，但其 `::before` 玻璃层位于 `inset:-1px`（恰好覆盖边框圈）且在不透明主题里 100% 实色，把整圈边框压在下面；下、右看到的"粗线"其实是 `.composer` 自身与 `::before` 两层 `4px 4px` 偏移阴影叠出来的约 5px，上、左则完全无线。修法（raft.css region 层）：阴影与描边合并到 `::before` 一层——`box-shadow: var(--float-shadow), inset 0 0 0 1px var(--control-border-strong)`，四边都有细墨线（暗色为奶油线），阴影恢复单层 4px。注：野兽派主题的 composer 存在同样的"边框被实色玻璃层盖住"问题（其 region 规则同样只改 border-color），本次未动，待 owner 决定是否一并修。
- 验证：`chat-ui.test.mjs` 253/253（含新增断言：激活徽章必须走 selection token、Raft nav 选中项必须 accent 底）、桌面 `svelte-check` 0 错 0 警、`vite build` 通过；静态 harness（真实 styles.css + raft.css + 组件同构标记）亮/暗两变体截图走查，暗色以 PNG 像素采样复核（侧栏 #161311、nav 黄、选中卡粉）。

### 调整：Momo 朋友型助手人设（2026-09-16，已交付）

- 内置 Momo 模板升级至 1.1.1：兼顾日常聊天、情绪回应和可靠执行，温暖、有主见、偶尔俏皮；身份、协作方式和表达分寸分别由 IDENTITY.md、AGENTS.md、SOUL.md 承载。
- 关心基于用户处境、目标、兴趣和当前上下文，自主选择倾听、分享喜悦、提供建议或实际帮助，不依赖固定场景和台词；相关旧事可自然接续，尊重用户偏好与自主权。不诊断、不假装监测状态，不擅自安排定时问候或健康追踪。
- 已安装副本沿用内置 Agent 更新入口，用户修改过的副本更新前备份。模板加载、合并渲染和更新/备份相关测试 8/8 通过；尚未进行真实模型多场景回答评测。

### 修复+新功能：技能页 Type 切换选中态修复 + 强选中语义 token 与卡片选中（2026-09-16，已交付）

- 背景（owner 对照 raft.build 原版走查，三条反馈）：① 选中的技能卡应有原版选中频道那种强色背景（粉红）标识；② 技能页 Type 切换（全部/内置/工作区/Agent）选中态不明显，自动任务页的同款切换却清晰；③ Type 样式应适配主题切换。
- 根因（Type 切换，真 bug）：共享样式 `.automation-category-tab.active`（styles.css，白卡底+主文字色+soft-shadow）要求按钮带 `automation-category-tab` class。自动任务页按钮有，技能页从复制这段标记起就只带了容器 class，按钮 class 一直缺失 → 选中规则从未命中，选中 tab 与未选中几乎同貌。守卫此前只断言 CSS 规则存在与自动任务页的 class，未覆盖技能页，本次补上。
- 新语义（owner 确认方案 A）：新增共享 token 对 `--selection-bg` / `--on-selection`（styles.css 基础 ramp 默认取 accent 对，即 macOS 实色选中），家族可重映射——Raft 映射为配对粉 `#fe7da8` + 墨字（黄=主动作/视图 tab、粉=选中项，与原站配色分工一致）。DESIGN.md 已落规范：选中语义（可选卡片、家族 region 层的列表选中行）统一读这对 token；tab 激活态留在 accent。
- 应用面：① 技能卡新增选中交互——点击卡片表面切换单选（Enter/Space 可键盘操作；点击卡片内的开关/展开/详情/更新按钮不打扰选中态），选中卡整卡铺 `--selection-bg`，标题/描述/徽章/图标位/脚部分隔线翻到 `--on-selection` 色阶，控件（开关、详情按钮）保持共享 rest 态；② Raft 主题侧栏选中会话行从 accent 黄切到 selection 粉（即原版选中频道的观感）；③ 其余 24 个主题零改动，选中卡自动落到各主题 accent 实色。
- 机器守卫：chat-ui.test.mjs 新增「技能页 tab 按钮必须带 `automation-category-tab`」（拦住本次出生缺陷复发）与「强选中必须走 token」（断言基础 ramp 定义、选中卡规则引用 token 对而非硬编码色、raft 双变体映射 `#fe7da8`、侧栏选中行走 `--selection-bg`）。
- 验证：`chat-ui.test.mjs` 253/253、桌面 `svelte-check` 0 错 0 警、`vite build` 通过、浏览器冷路径走查见同日验证记录。

### 修复：系统提示词优先级、工具路由与多语言项目上下文（2026-09-16，已交付）

- 项目指令、TOOLS.md 和项目附加说明不再因中英文关键词、隐藏 HTML 示例或零宽字符整篇丢失；仍保留上下文长度限制。词法黑名单无法判断指令来源和授权，安全约束继续由统一提示词边界及既有运行时权限、审批负责，不能把本次改动理解成对提示注入的彻底防护。
- 提示词统一声明运行时约束、当前明确请求、项目工作约定和 operator profile 的优先级；身份以 IDENTITY.md 为准，移除重复提醒、标题和 profile 管理元数据。全局初始化模板同步消除旧优先级，已有 owner 文件不自动覆盖。
- 显式技能、Mini App 数据和专用工具的选择顺序明确；待办记录与定时执行分开，普通文件操作不强制发现技能。授权范围不变时不重复确认；权限拒绝与可修正的参数错误分开处理。
- 子代理按任务与实际运行预算选择，不再强制固定流水线或写死 24 次调用；任务困难不自动授权保存技能草稿。视频参数细节保留在工具说明，提交后可继续用户要求的独立工作。
- 根因属于规则分散和词法误判。回归覆盖多语言/引用/Unicode 上下文保留、长度限制、profile 合并与渲染、动态记忆不进入静态提示词、按权限模式注入审批说明及视频工具约定。文字断言只能验证拼装约束，不能替代真实模型行为评测。
- 验证：相关回归 64/64、生产构建与 diff 空白检查通过；实际 owner profile 的生成结果确认无旧优先级、名字冲突、重复标题和管理元数据。全量 tsc（315 条错误）和 svelte-check（114 个文件、392 条错误）未通过，包含依赖声明及现有类型问题；未做真实模型端到端行为评测，未重启运行中的服务。

### 新功能：Raft 主题家族——raft.build 风格的奶油/墨黑双变体（2026-09-16，已交付）

- 需求（owner）：喜欢 https://raft.build/zh-cn/ 的视觉风格，希望作为一款内置主题。
- 风格采样（读站点 CSS）：`#fffaef` 奶油画布 + `#141111` 暖墨色 + `#ffd440` 信号黄主色（`--primary-400`），辅助糖果色（cyan `#27ccf3` / pink `#fe7da8` / lime `#a9d877` / lavender `#bbafe6` / orange `#f8a16f` / red `#f97264`），`4px 4px` 硬偏移阴影（无模糊，`#141111`），全站直角；字体 Space Grotesk / Space Mono（本机未装时回退 Avenir Next / Helvetica Neue 栈，不联网加载字体）。
- 实现：新增 `themes/raft.css`（Bold 家族，自带亮「奶油」暗「墨黑」双变体 + region adaptation + 预览色板）；暗变体为自设计（站点无暗色 token）：墨色画布反转亮态的墨/奶油关系，黄色保持唯一焦点色，阴影偏移用奶油色。选中会话行=黄底墨字，输入框吃硬偏移阴影。全直角（owner 反馈后从 4/6/8px 圆角改回 0，与野兽派一致）。
- 注册链路：`themes/index.css` import → `lib/api.ts` 家族联合类型+数组 → `lib/i18n.ts` 中英标签（Raft / 奶油 / 墨黑，Cream / Ink）→ `App.svelte` THEME_FAMILY_PREVIEWS → `chat-ui.test.mjs` 家族清单、bold 家族断言与三处 token 计数（49→51）同步。
- 验证：`chat-ui.test.mjs` 252/252、`vscodeTheme.test.ts` 通过、桌面 `svelte-check` 0 错 0 警、`vite build` 通过；浏览器冷路径走查（vite dev + IAB）确认设置页主题网格出现「Raft 奶油 · 墨黑」、亮/暗两变体真实切换、`--radius-control/panel` 计算值为 0、设置页与主界面全直角。桌面 Tauri 壳内的原生窗口外观联动未单独走查（复用与野兽派完全相同的家族机制，无新代码路径）。

### 修复：导入主题侧栏/输入框观感——导入主题改为自绘平面 chrome（2026-09-16，已交付）

- 症状（owner 走查，第二次反馈同一主题）：导入 Solarized (light) 后左侧 nav 发灰发脏、输入框像一个被冲淡的米色空盒；对照 VSCode 同主题里「画布 #fdf6e3 / 侧栏 #eee8d5」的两阶暖色平面差距明显。
- 前科与回答「上次的守卫为什么没拦住」：2026-09-13 那次（见下）只修了文字对比度下限与 header/content 接缝，守卫只对**画布** `surface` 校验对比度，完全没有覆盖「侧栏和输入框实际被画成了什么」。侧栏是 62% tint 叠在原生 macOS 材质上、输入框是 72% 的 `--composer-bg`，两者都不是主题色，所以调对比度治不了这次的症状。
- 根因 1（侧栏）：`.chat-sidebar::before` 用 `--sidebar-material-tint`（映射为 `rgba(sidebar, 0.62)`）加共享 `--sidebar-material-filter: blur(18px) saturate(160%)`，叠在 `tauri.conf.json` 的原生 `sidebar` 窗口材质上。主题自己的侧栏色永远到不了屏幕，得到的是「主题色 × macOS 冷灰材质」的合成色，还会随窗口激活状态和窗口后面的内容变化。内置浅色家族不踩坑，是因为它们用近白 tint（`rgb(242 242 247 / 72%)` 等）并且刻意让原生材质当侧栏。
- 根因 2（输入框）：`.composer::before` 是 `color-mix(--composer-bg 72%, transparent)` + `blur(40px) saturate(200%)`，Solarized 的 `editorWidget.background`(#eee8d5) 合成后约 #f2ecd9，对画布 #fdf6e3 只有 1.08:1，等于没有填充，盒子只剩一条 1px `--control-border` 边。
- 根因 3（nav 发脏、字发虚）：`--fill` / `--sidebar-surface*` 从**文字色**推导（Solarized 是冷板岩 #5b6f76），压在暖米色上就是一层冷灰；次级/三级文本由「primary 往背景混 40%/62%」推导（#7d8481 / #a3a59e），比主题自己设计的 base01(#586e75) / base1(#93a1a1) 更淡——而主题为低强调文本设计的颜色本来就是它 syntax `comment` 的色。
- 根修（共享映射层 `lib/theme/vscodeTheme.ts`）：
  1. 导入主题自绘平面 chrome：`--sidebar-material-tint` 输出不透明侧栏色、`--sidebar-material-filter: none`、`--glass-chrome-opacity: 100%`（composer / header / 命令面板不再走玻璃）。三个 token 纳入 `VARIANT_TOKENS`（111→113 项），暗色导入主题同样平面，且渲染结果不再随窗口激活态或窗口背后内容漂移。
  2. hover / 选中填充改取主题的 `list.hoverBackground` / `list.activeSelectionBackground` / `list.inactiveSelectionBackground` / `list.inactiveFocusBackground` 色相（Solarized 得到暖金 `rgba(223,202,136,α)`），没有这些键时才回退文字色。
  3. 次级文本取 `tab.inactiveForeground` / `sideBarTitle.foreground` / `statusBar.foreground`（Solarized → #586e75），三级文本取 `editorLineNumber.foreground` 或 syntax `comment` 色（→ #93a1a1）；仍按 3.2:1 / 2.2:1 兜底，`descriptionForeground` 继续不信任。
- 二次修正（同日 owner 走查输入框边框）：owner 反馈输入框「上边边框很明显、两边几乎没有、下边也不明显，像有渐变」。根因是映射把 `--glass-border-light` 当成文字色的淡版（`rgba(text, 0.42)`），而它其实是 `--glass-edge: inset 0 1px 0` 的**顶部高光**——内置家族一律声明为白色（浅态 42–72%、暗态 18–25%），styles.css 里也有注释写明「a baked white here would paint a hard line」。文字色（冷板岩）在浅态上把它变成了深色线：顶边 1.7:1，而其余三边只有 1px `--control-border`（对填充 1.19:1、对外侧画布 1.35:1），于是四边不对称；所谓「渐变」是共享的 `--glass-surface-shadow`（三层黑色阴影、最大 64px）在平面卡片下变成柔和暗晕，不是填充有渐变。根修：`--glass-border-light` 固定输出白色高光（浅态 60% / 暗态 18%），`--glass-border-dark`（凹陷边，本就是深色语义）保持文字色淡版。修后顶边高光 1.13:1，与内置浅色家族的 1.09:1 一致。
- 机器守卫：`vscodeTheme.test.ts` 12→15 例，新增「导入主题 chrome 必须平面」（明/暗两例断言 tint 等于不透明侧栏色、filter 为 none、`--glass-chrome-opacity` 为 100%）、「凹陷文本与填充取自主题自己的 UI 色」（钉住 secondary #586e75 / tertiary #93a1a1 / fill 暖金）与「顶部高光必须是白色而非文字色淡版」（明/暗两例），把「填充取列表色而不是文字色」「高光与凹陷是两个绝对语义」这两个跨主题语义固定下来。
- 验证：`vscodeTheme.test.ts` 15/15、`chat-ui.test.mjs` 252/252、桌面 `svelte-check` 0 错误 0 警告、desktop `vite build` 通过。**真机 GUI 冷启动走查未做**：需在 app 里重新选中该导入主题（映射器每次加载重算，不必重新导入），确认侧栏变成主题自己的 #eee8d5、输入框变成实心且四边边框一致、nav 文字与 hover 不再发灰；并对照内置 macOS 家族确认原生玻璃家族未被影响。
- 未处理（留作决策）：`--accent` 仍取 `button.background`（Solarized #ac9d57，对画布 2.52:1），而它同时被当作选中会话标题的文字色（`.conversation-row.active .row-title`）。把 accent 压到 3:1 会让 `--on-accent` 只能退化到白字 3.2:1（现有测试明确禁止），两者不可兼得——根治需要拆出「填充用 accent / 文字用 accent」两个 token，或让选中行改用主题的列表选中色。

### 修复：桌面自动更新发布管线——"Could not fetch a valid release JSON"（2026-09-16，已交付）

- 症状（owner 走查）：桌面端「检查更新」报「Could not fetch a valid release JSON from the remote」。
- 根因（三处叠加）：
  1. `desktop-release.yml` 两处发布步骤写死 `prerelease: true`，而更新端点 `releases/latest/download/latest.json` 只解析正式 release（GitHub 跳过 pre-release/draft）→ "latest" 落到唯一正式且无资产的 v2.9.51 → 404。
  2. `manifest` job 用默认 `needs: build` 条件，Intel 构建失败/被取消时整个 job 被跳过 → 即使 Apple Silicon 成功发布，`latest.json` 也不会上传。
  3. `finalize-desktop-release.mjs` 拼更新包下载 URL 时假设 release tag 等于 `v<App版本>`（即 v0.9.x），而真实 tag 是 v2.9.x → 即使 manifest 上传成功，下载更新包也会 404。
- 修复：
  1. workflow 两处 `prerelease: false`（附注释说明更新端点约束）；manifest job 条件改为 `!cancelled() && (build success || failure)`；Generate 步骤新增守卫——找不到任何 `updater-platform-*.json` 时报错退出。
  2. `finalize-desktop-release.mjs` 新增 `releaseTagFromEnv()`：优先取 `GITHUB_REF`（仅接受 `refs/tags/` 前缀，避免 branch/dispatch 构建污染 URL），本地构建回退 `v<App版本>`。
  3. 存量矫正：v2.9.56 已由 owner 手工转为正式 release 并上传全部资产（DMG / tar.gz / sig），助手用仓库生成器补齐 `latest.json`（URL 指向真实 tag，签名取自已上传的 `.sig`）并上传；取消排队中的旧 workflow 运行（它会用旧逻辑把 release 翻回 pre-release 并写入错误 URL，冲掉修复）。
- 机器守卫：`finalize-desktop-release.test.mjs` 新增 2 个回归——GITHUB_REF tag 构建 URL 必须含真实 tag 且不含 `v<App版本>`；非 tag 构建回退到 `v<App版本>`。回归测试当场抓到 `??` 对空串不跳兜底的实现错误（改为 `||`）。
- 验证：`finalize-desktop-release.test.mjs` 8/8；生成器干跑（正常/空目录输入）结构符合 Tauri v2 更新器 schema；核对 tauri-plugin-updater 2.11.0（`updater.rs:1520`）确认 manifest version 的 `v` 前缀会被 trim 后比较；线上 `releases/latest/download/latest.json` 返回 200 且为合法 manifest；manifest 内 tar.gz 下载 URL 返回 200。
- 端到端验证（v2.9.57，2026-09-16）：修复提交后发布 v2.9.57（root 2.9.57 / desktop 0.9.57，tag `v2.9.57`）。CI aarch64 腿首次全自动跑通新流程——platform json 的 URL 由 `releaseTagFromEnv()` 正确生成指向 `v2.9.57`（生产环境确认脚本修复生效）；release 保持正式发布、资产齐全（dmg/tar.gz/sig/latest.json）。因 Intel 腿排队导致 manifest job 迟滞，从已完成的 aarch64 artifact 手工生成并提前上传 `latest.json` 打通链路（Intel 落定后 manifest job 会用相同内容覆盖，无冲突）。
- 边界：`generate-desktop-latest-json.mjs` 对缺失架构天然宽容，无需改动；Intel (macos-13) 构建本身仍会失败，owner 已确认暂不修，仅要求不阻塞发布。版本比较不受 v2.9.x ↔ 0.9.x 双轨影响（比较只发生在 `apps/desktop/package.json` 与 `tauri.conf.json` 之间，由 `sync:version` 同步）。
- 遗留：更新弹窗显示的新版本号是 0.9.x 而 GitHub 发布页是 v2.9.x，属展示层小疑惑，功能无害；未处理。

### 修复：中文「**标签：**正文」加粗渲染成原始星号（2026-09-16，已交付）

- 症状（owner 走查）：聊天回复里 `**特点：**典型秋高气爽` 这类加粗没有生效，星号原样显示；同一消息里 `**华北平原、西北大部**和…` 却正常。
- 根因（CommonMark 规范缺陷，commonmark-spec#650）：加粗的闭合 `**` 若紧跟在全角标点（如 `：`）之后、且后面直接跟 CJK 汉字，按 flanking 规则不算合法闭合定界符 → 无法闭合。该规则为英文空格分词设计，中文无空格导致「标点收尾的加粗标签」高频命中。
- 修复（共享层）：`apps/desktop/src/lib/markdown.ts` 接入 `marked-cjk-friendly`（同维护者 cjk-friendly 系列，peer `marked >= 15`，ESM）。聊天记录、流式视图、Artifact Markdown 预览等所有渲染面都汇入 `renderMarkdown`，一处修复全覆盖；仅影响紧邻 CJK 字符的强调解析，Latin 行为不变。
- 机器守卫：`markdown.test.ts` 新增 4 个回归——截图里的真实失败形态（`**特点：**`、`**华南沿海（…）：**仍偏闷热`）、开口侧/常规 CJK 加粗、非 CJK 行为不变（Latin intraword、空格星号保持字面、代码 span 不解析）、以及 spaced/unmatched 星号不被误解析。
- 验证：`markdown.test.ts` + `streamingMarkdown.test.ts` 30/30、`svelte-check` 0 错 0 警、`vite build` 通过。真实桌面冷启动走查未执行（避免打扰 owner 正在使用的实例；重载前端即可目测原会话消息）。

### Desktop：运行中的三个入口加上「发光边缘转圈」border beam（2026-09-15，已交付）

- 需求（owner）：运行中的「正在执行…」胶囊、聊天区的「回到最新」按钮、以及输入框里的暂停/停止按钮，都换成一个发光的边缘转圈动画；效果参考 https://libraries.dev/beam。
- 方案：新增共享组件 `apps/desktop/src/lib/chat/BeamRing.svelte`。用 conic-gradient 做一条彗星状渐变，挂在一个被 mask 到宿主**外沿 2px** 的环形层上，`::before` 每 2.8s 转一圈；因为 mask 已经限定了发光区域，宿主不需要 `overflow: hidden`，渐变也不会盖住内容。颜色用主题 `--accent`（不是固定彩虹），23 套主题、明暗外观下都成立。
- 接线：
  - `ConversationLiveView` 的 `.message-status` 胶囊加 `beam` 类并渲染 `<BeamRing />`；同时删掉旧的横向 shimmer（`.message-status::after` / `message-status-sheen`），避免同一个运行态出现两种动效。
  - `TranscriptDock` 新增 `running` prop，由 `ChatMessagesPane` 传 `sending`；运行中且上滑脱离底部时，「回到最新」按钮 `class:beam` 并渲染 `<BeamRing />`。
  - `ChatComposerShell` 只在 `sending`（停止按钮分支）时渲染 `<BeamRing />`；`.send-button` 补 `position: relative` 作为定位上下文，空闲的发送按钮不受影响。
- 退化：`prefers-reduced-motion` 与 `data-performance="low"` 都停转（`styles.css` 全局覆盖 `.beam-ring::before`），冻结时发光仍停在边缘，不是「无反馈」。
- 验证：headless Chrome 挂载真实组件（Vite 构建 `ChatComposerShell` + `TranscriptDock`，并导入真实 `styles.css`/主题）截图确认停止按钮与「回到最新」胶囊的 beam 正常渲染；`chat-ui.test.mjs` 252/252（新增守卫：BeamRing 的 mask/2px/conic/关键帧、三处 running 接线、旧 shimmer 移除、两个退化层；更新原 shimmer 与 `.message-status` 断言），桌面 mjs 264/264、`svelte-check` 0 错 0 警、`vite build` 通过。真实桌面冷启动走查未执行（避免打扰 owner 正在运行的实例）。
- 文档：`DESIGN.md` Motion 章节新增 Border beam 条目。

### Desktop：执行中的会话行显示旋转粒子球（2026-09-15，已交付）

- 需求（owner）：左侧会话列表里，会话正在执行时不要再是一个静止/泛光的圆点，要有一个「正在执行」的动画；执行完成后的绿色点保持不变；动效参考 https://libraries.dev/orbs 的 thinking orb。
- 方案：新增共享组件 `apps/desktop/src/lib/chat/RunningOrb.svelte` —— 用 CSS 3D（`perspective` + `transform-style: preserve-3d`）把一组按 fibonacci 球面均匀分布的粒子点放在一个旋转的球体上，靠透视自然产生近大远小的深度感，零 canvas/WebGL、零第三方依赖，侧栏同时有多个会话在跑也不会各自开一个渲染上下文。
- 接线：`ConversationRow` 在 `statusDot.color === "running"` 时渲染 `<RunningOrb />`，其余状态（waiting/completed/failed）继续用原来的扁平圆点；运行槽位 16px、中心与 9px 静态点同轴（left 0.5 + 16/2 = 4 + 9/2），并把旧的 `bot-status-pulse` 泛光圈删除。
- 退化：`prefers-reduced-motion` 与 `data-performance="low"` 都停掉旋转（`styles.css` 全局覆盖，与既有动画同一条规则）；球体带一个代表性初始姿态，冻结时仍是一个圆的静态球而不是竖条。颜色用 `currentColor` 继承运行态的 `--accent`，明暗主题、选中/非选中行都自适应。
- 验证：headless Chrome 挂载真实组件（Vite 构建 `ConversationRow`）截图确认 running 显示球体、completed/waiting/failed 显示扁平点、明暗背景与 reduced-motion 冻结态均正常；`chat-ui.test.mjs` 251/251（新增守卫：仅 running 渲染 orb、槽位中心对齐、旧 pulse 移除、orb 的 perspective/preserve-3d/keyframes/冻结姿态、两个退化层），桌面 mjs 263/263、`svelte-check` 0 错 0 警、`vite build` 通过。真实桌面冷启动走查未执行（避免打扰 owner 正在运行的实例）。
- 文档：`DESIGN.md` 会话树条目与 Motion 章节补充 running orb 及其退化规则。

### 修复：新对话在首轮执行期间不出现在侧栏会话列表（2026-09-15，已修复）

- 症状（owner 走查）：从「新对话」发出第一条消息后，聊天区已经在「正在执行…」，但左侧「Web」会话列表仍然只有旧会话，新会话整轮都看不到。
- 根因（异步时序 / 生命周期顺序）：`ChatSessionStore.send()` 的 draft 分支在 `await entry.controller.send(...)`（整轮 SSE 结束）之后才调用 `deps.onSessionCreated?.(profileId, created.id)`，而侧栏刷新（`loadChannel("web")`）只挂在这个回调上。首轮运行期间唯一的刷新机会是标题摘要器返回后发出的 `session_title_updated` 事件——它可能超时/失败，且即使返回也会被 `loadChannel` 的「已有请求在飞」守卫静默丢弃。因此第一条消息运行中的整段时间里，新会话不在列表里，只有等整轮结束才补上。
- 修复（共享层生命周期，不在调用方打补丁）：把 `onSessionCreated` 的调用移到 `entry.controller.send(...)` **之前**、`setActive`/清空 draft 之后，让会话一存在就通知宿主刷新侧栏；同时让 `persistSelected` 在首轮开始前就落好恢复锚点（首轮异常也不会丢）。占位标题由后续的标题摘要事件 / 轮次结束刷新收敛。修正后的顺序与 Web 端 `POST /api/sessions → loadSessions()` 的即时刷新行为一致。
- 机器守卫：`chat-ui.test.mjs` 新增「a new draft conversation reaches the sidebar before its first turn settles」——断言 `onSessionCreated` 必须位于 draft 分支内、且在 `entry.controller.send` 之前，防止再次把它挪到轮次之后。
- 验证：`chat-ui.test.mjs` 250/250、`svelte-check` 0 错 0 警。真实桌面冷启动走查未执行（避免打扰 owner 正在运行的实例；前端重载后即可目测）。

### 修复：项目文件夹展开态图标不切换（2026-09-15，已修复）

- 症状（owner 走查）：项目展开/折叠后文件夹图标始终是闭合形态；展开态的 `folder-open` 没有生效。
- 根因（浏览器实测定位）：`GroupHeader` 是 legacy 语法组件（`export let` + `$:`），`$: GroupIcon = ...` 在 Svelte 5 下编译为 `mutable_source` + `legacy_pre_effect`，而动态组件 `<GroupIcon>` 的挂载**只保留首次渲染的组件**——prop 变化时 `aria-expanded`、`class:open` 等兄弟绑定都正常更新，唯独图标不换，因此 markup 检查和 SSR 单帧渲染都发现不了。用 vite dev server 上挂载真实组件、点击切换并断言 SVG path 的方式复现：`open=true` 时 DOM 里仍是闭合文件夹的 path。
- 修复：`GroupHeader` 整体迁移到 Svelte 5 runes（`$props` + `$derived`），动态组件随派生信号切换。修复后同一浏览器实测：`open=false` → folder path，点击后 → folder-open path，截图确认外观。
- 机器守卫（同类首次出现即沉淀）：`reactive-statement-guard.test.mjs` 新增断言——禁止 legacy `$:` 派生的变量被挂载为动态组件；存量 `ComposerPermissionMenu`（TriggerIcon）、`ProcessActivityItem`（ToolIcon）命中同模式，已在守卫白名单登记并记入 `prd.md` 技术债（权限模式 `value` 变化时触发器图标同样可能不换，暂无用户可见故障）。`CLAUDE.md` pitfall #2 增补该附则。
- 验证：桌面 mjs 260/260、`svelte-check` 0 错 0 警、`vite build` 通过；修复前后均以真实浏览器（dev server 挂载 + 点击 + DOM path 断言 + 截图）验证。owner 的 app 窗口需重新加载前端后生效。

### Desktop：macOS 应用内自动更新（2026-09-15，已交付）

- 需求（owner）：实现 macOS 桌面客户端自动下载新版本并重启更新，解决此前每次发版必须手动前往 GitHub Releases 下载并覆盖安装的问题；背景：无苹果开发者账号。
- 原理与方案：
  - 利用 Tauri 官方 `tauri-plugin-updater` 机制与 Ed25519 (Minisign) 非对称密钥签名替代苹果公证（Notarization），解决无开发者账号下的防篡改校验。
  - 应用内通过标准 HTTP 下载更新包不会被 macOS 附带 `com.apple.quarantine` 隔离标志，用户首次授权后后续自动更新无需再过 Gatekeeper 拦截。
  - 在重启更新前由 Supervisor 优雅停止底层 `molibot-node` 伴生服务并释放端口/SQLite 数据库锁，杜绝进程残留与锁冲突。
  - 防御 App Translocation（易位隔离执行）：更新前检测如果用户未将应用拖入 `/Applications`，提示移入后再更新。
- 变更：
  - 后端与原生（`apps/desktop/src-tauri`）：引入 `tauri-plugin-updater` 插件；新增 `check_app_translocation` 与 `relaunch_desktop_for_update` 原生命令；Mac 系统菜单（`Molibot` 菜单）与托盘菜单（Tray）添加「检查更新…」项并接入 Native Command 事件流；配置 `tauri.conf.json` 与 `tauri.bundle.conf.json`（updater 端点与 Ed25519 公钥，`createUpdaterArtifacts: true`）。
  - 前端（`apps/desktop`）：引入 `@tauri-apps/plugin-updater`；新增 `updaterStore`（Svelte 5 runes 状态机，管理检查中/发现更新/下载进度/重启就绪等状态）；新增 `UpdateDialog.svelte` 更新弹窗（自适应明暗主题与中英多语言，展示版本号、更新日志、下载百分比与 MB 进度条）；通用设置（General）添加「软件更新」区块；ChatView 启动时调度静默检查并在快捷命令面板注册「检查更新…」。
  - 发布流水线与打包（`.github/workflows/desktop-release.yml`、`scripts/finalize-desktop-release.mjs`、`scripts/generate-desktop-latest-json.mjs`）：矩阵构建 Apple Silicon 与 Intel 架构更新包（`.app.tar.gz` 与 `.sig`）；新增 `manifest` job 自动聚合多架构签名生成 `latest.json` 并发布到 GitHub Releases。
- 验证：`desktop:check`（`svelte-check` 0 错 0 警）、`desktop:test`（260 项桌面前端测试 + 70 项 Rust 单元测试全部通过）、`test:desktop-release`（6 项打包与 manifest 测试全部通过）。

### Desktop：技能导航图标换成 ruler-pen（2026-09-15，已交付）

- 需求（owner）：侧边栏「技能」图标换成 reicon `ruler-pen` duotone（原为 owner 早期选的 `reorder2`）。
- 变更：`RulerPen` 加入 duotone 生成清单并重新生成；`ChatSidebar` 技能项换用 `RulerPen`；`Reorder2` 无其他消费方，从生成清单删除（75 个体）；`DESIGN.md` owner-picked 清单同步为 `skills → ruler-pen-duotone`。
- 验证：桌面 mjs 测试、`svelte-check`、`vite build` 通过。

### Desktop：会话树左对齐网格 + 会话行去头像 + 文件夹开合图标（2026-09-15，已交付）

- 需求（owner）：① 渠道区块（Web/Telegram/飞书/QQ/微信）与项目区块全部左对齐，去掉现有缩进；② 会话行去掉前面的 bot 头像，保留缩进让文字与 Web/Telegram/项目名的文字对齐；③ 项目文件夹图标随展开状态切换（展开=打开的文件夹、折叠=普通文件夹）；④ 渠道行与项目行的「新建会话」加号换成 reicon `chat-plus`（Outline）；⑤ 去掉渠道行与项目行最右侧的折叠/展开箭头。
- 变更：
  - `ConversationRow`：删除 `BotAvatar`（会话行不再渲染 bot 头像）；运行状态点（运行/待审批/完成/失败）与 fork 标记 `↳` 移入保留的 24px 缩进槽（两者同时存在时状态点优先）；标题基线 = 共享 8px 行边距 + 24px 内缩，与头部文字落在同一条 32px 网格线。`item` 契约收窄为 `title/updatedAt/readOnly/parentSessionId`，`ProjectTree`/`ProjectList` 调用方同步去掉 bot 字段。
  - `ChannelAccordion`：去掉容器 `padding-left: 8px`；删除 `channel-caret-button`（整行头部即折叠开关，`aria-expanded` 保留在头部按钮上）；`Plus` → `ChatPlus`（Outline）；空态/「更多对话」/「去设置」左缩进对齐到 32px 网格线。
  - `GroupHeader`：文件夹图标随展开切换（`folder-open` / `folder` duotone，本地生成集已含两者；notebook 图标不受影响）；`Plus` → `ChatPlus`；删除 `conv-caret-button` / `conv-caret`。项目页 `ProjectList` 共用该组件，一并生效。
  - `styles.css`：`.sidebar-section-head` / `.sidebar-section-toggle` 统一 8px 内容起点——「对话」「项目」区块头、nav 项、渠道头、项目行共用同一左原点；`.conv-group-head` 去掉 4px 边距、tile 18px→16px（`--icon-md`），保证项目名与会话文字对齐。
- 验证：`chat-ui.test.mjs` 250/250（新增守卫：行内不得再出现 `BotAvatar`/`row-avatar`、状态点与 fork 标记渲染、`channel-accordion` 不得有 `padding-left`、GroupHeader 开合图标推导、不得再有 `conv-caret`/`AngleDown`；更新 caret 相关断言与行 padding 断言）；`project-sidebar.test.mjs` 通过；`svelte-check` 0 错（`UpdateDialog` 1 个未使用选择器警告来自工作区既有改动）；`vite build` 通过；另用 `ChatSidebar` 全量 SSR 冒烟验证渠道+会话+状态点+fork 的真实渲染 DOM。真实桌面冷启动走查未执行（避免打扰 owner 正在使用的实例，owner 下次打开应用时可直接目测验证）。
- 备注：owner 提到的折叠态图标链接是 `folder-add`（带加号的文件夹），按「表现为一个普通文件夹」的描述采用了普通 `folder` 图标；若确实要 `folder-add`，改 `GroupHeader.svelte` 的 `GROUP_ICONS` 一行即可。

### Desktop：消息内容与输入框对齐 + 全屏预览关闭按钮图标（2026-09-15，已修复）

- 症状（owner 走查）：聊天正文 / 图片没有和下方输入框对齐，整体看起来左偏几像素；全屏图片预览右上角的关闭按钮只有一个圆形背景、看不到图标。
- 根因 1（对齐）：`.messages` 是可滚动容器（`overflow-y: auto` + 6px 自定义滚动条），而输入框不在滚动容器里。右边多出 6px 滚动条后，居中的 720px 阅读列相对输入框左移约 3px，于是「内容左偏、右侧显得内缩」。
- 根因 2（关闭按钮）：关闭按钮只渲染了内联的 outline `x` 路径，视觉上几乎看不见；用户指定改用 reicon 的 duotone `close-circle`。
- 修复：
  - `.messages` 增加 `scrollbar-gutter: stable both-edges`，让内容盒左右对称、居中不随滚动条出现而漂移（与设置 / 工作区滚动容器同一条 DESIGN 规则）。
  - 把 `CloseCircle` 加入 duotone 生成清单（`scripts/generate-duotone-icons.mjs`）并重新生成，得到 `icons/duotone/components/CloseCircle.svelte` 与 body；`reiconSvg.ts` 的 `close-circle` 直接引用生成的 body，`imageLightbox` 关闭按钮改用它；`MarkdownArtifactOverlay` 关闭按钮同步换成同一 duotone 组件，两个全屏预览保持一致。
  - 关闭按钮图标从 `--icon-md`(16px) 改为填满按钮（`width/height: 100%`，按钮 32px；`close-circle` 自身的内圆约占字形 83%，因此内圆约占按钮 80%+），不再「大背景里一个小圈」；按钮补 `padding: 0` 让图标精确填满。两个全屏预览的关闭按钮统一处理。
- 验证：`chat-ui.test.mjs` 全量通过（249 项；新增守卫：`.image-lightbox-close > .reicon` 与 `.markdown-artifact-close > .reicon` 必须 `width/height: 100%`，issue 13 对齐、图片 gallery、icon 来源用例通过）；`svelte-check` 0 错 0 警、`vite build` 通过。

### Desktop：文件面板打开时保留左侧 nav、拖面板只改面板（2026-09-15，已交付）

- 需求（owner）：A) 打开 / 拖动右侧文件面板时不要自动隐藏左侧 nav；B) 拖动右侧文件面板时只改面板宽度，nav 和 chat 不要跟着变。
- 根因（A）：`@media (max-width: 1000px) { .chat-layout.with-files .chat-sidebar { display: none } }`——窗口 `<= 1000px` 且有文件面板时用 CSS 直接把侧栏整个隐藏（并给 chat header 补 84px 避让交通灯）。这就是「移动文件面板时 nav 自动消失」的来源。
- 修复：
  - **A**：删除该隐藏规则与 header 的 84px 避让；`<= 1000px` 的 `with-files` 改为三列 `minmax(--sidebar-nav-w-narrow, --sidebar-w) / minmax(0, 1fr) / minmax(--files-min-w, --files-w)`，nav 只收窄不隐藏；820px tier 不再重复声明 `with-files` 轨道（保持「一个 tier 拥有该 split」）。`ChatView` 的 `filesCap` 在窄屏档也扣除侧栏宽度（`W - sidebar - CHAT_MIN_NARROW`），`sidebarMaxWidth` 在窄屏档同样按 `CHAT_MIN_NARROW` 预留。
  - **B**：文件面板拖动只改 `filesWidth`（`filesManipulation.onUpdate` 只写 `filesWidth` / `resizingFiles`）；`filesCap` 始终以当前侧栏宽度为基准，所以拖面板永远不会侵占 nav 宽度；聊天区吸收剩余空间（窗口固定时几何上必然如此）。
- 验证：`chat-ui.test.mjs` 更新 / 新增守卫（不再隐藏侧栏、`<= 1000px` 三列 split、拖动只改面板、`filesCap` 两档都扣侧栏），桌面 mjs 260/260、`svelte-check` 0 错 0 警、`vite build` 通过。`DESIGN.md` 已同步。真实窗口拖拽走查未执行（脚本无辅助功能权限，未打扰 owner 实例）。

### 修复：左侧 nav 不再随窗口宽度自动折叠（2026-09-15，已修复）

- 症状（owner 走查）：左侧 nav 会自己折叠，很突兀；期望只有「点击折叠按钮」或「把 nav 分割线拖过阈值」才折叠，其它情况不要自动折叠。
- 根因：`ChatView` 里有一段按窗口宽度自动折叠的遗留逻辑——窗口进入 `<= 820px` 时把 `sidebarCollapsed` 置真并写入 localStorage（配一个 `autoCollapsedByWindow` 标记，本意是窗口变宽再自动展开；但该标记不持久化，重启后丢失，折起状态却留在 localStorage 里，表现就是「自己关掉且不再自己打开」）。
- 修复：删除 `autoCollapsedByWindow` 变量与整段按宽度自动折叠/展开逻辑。`sidebarCollapsed` 现在只由折叠按钮、键盘快捷键（`b`）以及把分割线拖过 `SIDEBAR_COLLAPSE_THRESHOLD`(160) 改变；窄窗口仍通过响应式 tier 把侧栏收窄到 170px，但不再折叠。
- 注意：owner 机器上 localStorage 里可能已残留 `sidebarCollapsed=true`（由旧逻辑写入），点一次展开按钮即可；此后不再被自动改写。
- 验证：`chat-ui.test.mjs` 新增守卫（不得再出现 `autoCollapsedByWindow`、窗口 resize 块不得改 `sidebarCollapsed`），桌面 mjs 260/260、`svelte-check` 0 错 0 警、`vite build` 通过。

### Desktop 右侧文件面板：去掉最大宽度、窗口缩放由面板吸收（2026-09-15，已交付）

- 需求（owner）：① 右侧文件面板不应有最大宽度，只保留最小宽度；② 面板打开时拖动窗口最右侧边缘放大窗口，应保持左侧 nav 与 chat 宽度不变、只增大右侧面板（查看文件时想放大内容）。
- 变更（`ChatView.svelte`，共享几何层）：
  - 删除 `FILES_MAX = 720` 常量及它在 `filesWidth` / `DirectManipulation.max` 里的钳制；面板唯一边界改为「不侵占 chat 下限」的 `filesCap(windowWidth, sidebar)`（三列保留 `CHAT_MIN`、窄屏保留 `CHAT_MIN_NARROW`）。因此面板可一直拖宽到 chat 到达可读下限，不再有固定上限。`FILES_MIN` 保留。
  - 窗口宽度变化时（`bind:innerWidth` 的 `$:` 块），若 Inspector 打开则把宽度增量转给面板（`filesWidth += delta`，再按 `filesCap` / `FILES_MIN` 钳制），nav 与 chat 宽度保持不变；无 Inspector 时仍由 chat 吸收增长。存储仍只在显式拖拽时写入用户偏好值。
- 验证：`chat-ui.test.mjs` 更新守卫（无 `FILES_MAX`、`filesCap` 公式、窗口增量转面板）、桌面 mjs 260/260、desktop `svelte-check` 0 错 0 警、`vite build` 通过。`DESIGN.md` 已同步。窗口缩放的真实冷路径走查未执行（当前无法用脚本控制该窗口，未打扰 owner 正在使用的实例）。

### 修复：切换会话时聊天记录从顶部滚动到底部（2026-09-15，已修复）

- 症状（owner 走查）：切换 Chat / Project 会话时，内容先显示在顶部（第一条），随后快速滚动到底部；期望直接停在最底部。
- 根因：`.messages { scroll-behavior: smooth }` 与 `stickToBottom.ts` 的设计冲突——action 用 rAF 弹簧自管跟随动效，并用「直接写 `scrollTop`」实现会话切换 / 空闲重载的瞬时落底；CSS smooth 会把每一次直接写 `scrollTop` 变成浏览器的平滑滚动动画，于是切换时的瞬时落底被渲染成可见的「从头滚到尾」。`DESIGN.md` §Motion 本就写明 follow-scroll「deliberately not CSS smooth-scroll」「Session switches land on the tail instantly」，即该 CSS 是遗留冲突项。
- 修复：删除 `.messages` 的 `scroll-behavior: smooth`。reduced-motion / low-performance 的 `scroll-behavior: auto !important` 覆盖保留；提示词导航、大纲跳转仍各自显式传 `behavior: smooth`，不受影响。
- 守卫与验证：`chat-ui.test.mjs` 新增「`.messages` 不得再引入 CSS smooth」守卫；桌面 mjs 守卫 260/260、`stickToBottom` 单测 4/4、desktop `svelte-check` 0 错 0 警、`vite build` 通过。冷启动走查未做（owner 桌面实例使用中，未重启）。

### 修复：左侧导航与右侧内容的分割线偏亮（2026-09-15，已修复）

- 症状（owner 走查，两次）：Chat / 设置页左侧导航与右侧内容之间的竖直分割线比右侧文件面板的分割线明显更亮；第一次只改 token 颜色后「还是很亮」。
- 根因（两层）：
  1. 颜色 token 不同：侧栏 `border-right` 用 `--sidebar-material-border`（默认 `color-mix(--control-border-strong 64%)`），文件面板用 `--separator`；另 0.5px vs 1px 线宽也不一致。
  2. 更根本的一层（第一次没修掉的原因）：分割线画在**元素自身的 `border-right`** 上。侧栏 `background` 是 `transparent`，承载材质的 `::before` 用 `inset: 0` 只覆盖 padding box、**不覆盖 1px 边框条**，所以边框那一列直接叠在「原生侧栏材质（透出窗户背后壁纸的模糊）」上，而右侧文件面板的边框叠在它自己**不透明的面板底色**上——同一个 color token 在两处合成结果不同，侧栏边因此更亮。
- 修复（共享层根修，不改布局）：`--sidebar-material-border` 默认改为 `var(--separator)`、线宽 0.5px→1px；并把分割线从元素边框移到材质层——`border-right` 画在 `.chat-sidebar::before / .settings-sidebar::before`（`box-sizing: border-box`）上，让它和其它侧栏像素一样叠在同一层 tint 上合成；新增 `class:resizing-sidebar`，仅拖动侧栏分割线时把边框色提到 `--control-border-strong`（`::before` 上），拖文件面板不误亮；增大对比度模式的更强分割线保持不变。
- 证据（运行中实例像素采样，暗色主题）：修复前侧栏边 `(60,84,101)` vs 文件面板 `(40,50,63)`；修复后侧栏边 `(42,51,64)/(40,50,62)/(39,48,59)` 与文件面板 `(40,50,63)` 基本一致。
- 验证：`chat-ui.test.mjs` 更新「分割线」守卫（token + 必须画在 `::before` + 拖拽态）、桌面 mjs 守卫 260/260、desktop `svelte-check` 0 错 0 警、`vite build` 通过。`DESIGN.md` 已同步。

### Desktop 助手消息身份行对齐输入框、去掉冗余标签（2026-09-15，已交付）

- 症状（owner 走查截图）：助手回复左侧留了独立的头像栏，头像所在列相对输入框有缩进，正文又被「头像宽 + 间隙」二次缩进，正文列比下方输入框窄；身份行同时挂「Agent」和「回答完成」两个标，其中「Agent」是静态角色词、没有信息量，「回答完成」又与下一行的「已完成工作」重复。
- 变更：
  - 头像内联到身份行首位（`ConversationTranscript` / `ConversationLiveView`，CSS 22px），移除独立头像栏；正文与头像都对齐阅读列左缘，正文宽度与输入框一致。
  - 成功态从「回答完成」文字药丸改为绿色双勾（`CheckRead`，带 `aria-label`），错误 / 中断仍保留带文字的状态药丸。
  - 静态「Agent」标签改为渠道绑定的 Agent 名：Web 会话显示「Web Profile 名 · Agent」，外部渠道显示「渠道 Bot 名 · Agent」，渠道未显式绑定 Agent 时回退默认 Agent（`Global`）；Project 会话不传 `agentName`，因此不显示 Agent。`copy.agentRole` 已删除。
- 验证：`chat-ui.test.mjs` 等桌面 mjs 守卫 260/260（含新增身份行 / 对齐 / 双勾守卫）、desktop `svelte-check` 0 错 0 警、`vite build` 通过。`DESIGN.md` 已补「Assistant identity」条目。冷启动走查未做（owner 桌面实例使用中，未重启）；重启后应看到 Project 会话身份行为「头像 + Molibot + 绿勾」，Web / 外部渠道多一个 Agent 名。

### feishu 主题对齐真实飞书（2026-09-14，已交付）

- 基准（owner 提供真实飞书运行 Molibot 的明暗截图）：中性炭黑分层、暗色下聊天画布比侧栏更暗、选中会话用柔和蓝底、bot 消息保持白色卡片。
- 变更（`themes/feishu.css`）：① 删除选中会话行的实心强调色覆盖（solid 蓝 + 白字是 iMessage 式，不是飞书），回落共享的 `accent-soft` 软底、保留行内文字原色；② 暗色聊天画布加深为 `#191919`（低于 `#1F1F1F` chrome）并去掉顶部提亮渐变，对齐真实飞书的层次；③ 暗色 assistant 气泡改为白色卡片 + 深色正文（飞书 bot 卡片签名样式），卡内富内容同步翻转：行内代码/引用/表格边框/hr 用浅色值，fenced 代码块保持深色（与飞书亮色卡片一致），diff 标签走浅色可读值（`--d2h-*` 卡片作用域覆盖）。
- 验证：chat-ui 249/249（含主题结构守卫）、desktop `svelte-check` 0/0、`vite build` 通过；视觉效果由 owner 重启 App 后在明暗两种外观下确认。

### 修复：主题给侧栏「对话/项目」分节标题加了默认背景（2026-09-14，已修复）

- 症状（owner 走查）：多款主题下，工作区侧栏的「对话」「项目」分节标题默认带强调色药丸背景，看起来像选中态；预期是静止时透明、悬浮才有背景。
- 根因：主题家族的区域适配层（`data-theme-region="session-list"`）在 23 个主题文件里给 `.sidebar-section-head` 无条件写了 `background`（QQ 还有暗色变体单独写了一份），超出「适配形态」的边界、改变了交互件的静止语义。
- 根修：按 DESIGN.md Region adaptation 新规范（分节标题/列表行静止保持透明，背景只出现在 `:hover`/`.active`）一次性改齐 23 个主题：静止背景移入 `:hover` 规则（保留各主题自己的强调色强度），布局属性（min-height/margin/padding/border-radius）原样保留。
- 守卫与验证：`chat-ui.test.mjs` 新增「分节标题禁止静止背景」守卫（回放旧写法可复现失败，并要求已塑形的主题保留 hover 背景）；该测试 249/249 通过，desktop `svelte-check` 0 错 0 警、`vite build` 通过。视觉走查由 owner 重启 App 后在多主题下确认。

### 修复：Project 会话与任务会话缺少调用链入口（2026-09-14，已修复）

- 症状（owner 走查）：Web 会话消息上有「查看调用链」按钮，Project 会话没有。
- 排查结论：后端完全共用同一链路——所有会话走同一 runner + `TraceRecorderHook`，每轮无条件分配 runId；消息投影是同一共享投影器，`traceRunIds` 数据完整（实测 talkshow 项目某会话 8/8 条消息均带 runId）。缺口纯在前端：trace 按钮只在 `ConversationTranscript` 渲染，且需要 `endpoint` prop 非空才会查询插件启用状态；`ChatView` 本地会话分支传了 endpoint，`ProjectChat` 与 `TasksSection`（任务会话详情）漏传，`traceEnabled` 恒为 false，按钮不渲染。
- 修复：`ProjectChat.svelte` 的 `ChatMessagesPane` 补传 `endpoint={view.endpoint}`；`TasksSection.svelte` 的 `ConversationTranscript` 补传 `endpoint={session.endpoint ?? ""}`。
- 验证：desktop `svelte-check` 0 错 0 警、`vite build` 通过、chat-ui/project-sidebar/reactive-statement-guard 结构守卫 250/250、projectsStore 8/8。冷启动走查未做（用户实例使用中，未重启桌面端）；重启 App 后 Project 会话消息上应出现「查看调用链」按钮。

### 修复：内置插件 trace-viewer 未进发布包，其它机器没有 Call Trace（2026-09-14，已修复）

- 症状（owner 走查）：发布新版本后，其它电脑的插件设置页没有「Call Trace / 调用链」，开发机正常。
- 根因：内置插件采用「启动时从 app 根 `package/<id>` 暂存到数据目录 `plugins/packages/`」机制；`bin/molibot-release.sh` 的拷贝白名单只写了 `external-subagent`、`cloudflare-html`，漏掉 `trace-viewer`，而 `ensureBuiltinPlugins` 对缺失源目录静默 `continue`，发布包在其它机器上永远不会暂存出该插件。排查中确认 Docker 镜像运行时层同样没拷任何 `package/`（Docker 部署下三个内置插件全部缺失），一并修复。这是「发布包手写清单漂移」同类根因第二次出现（上次为 v2.9.0 runtime 模块清单遗漏导致启动崩溃）。
- 根修：发布脚本拷贝列表补齐 `trace-viewer`；Dockerfile 运行时层补齐三个内置插件包的 COPY；`ensureBuiltinPlugins` 缺失源目录时显式 warning；插件目录对 `BUILTIN_PACKAGES` 内的暂存包默认标记「内置」来源（此前随包分发的三个内置功能插件都误显示「外置目录」）。
- 守卫与验证：`release-bundle.test.mjs` 新增 BUILTIN_PACKAGES ↔ 发布清单双向同步守卫（含 Dockerfile 运行时层检查；临时还原旧清单可复现失败）；新增 `builtinBootstrap.test.ts`（首启暂存、同版本不重拷、升级自动备份、缺失告警）；`catalogRoute.test.ts` 新增来源默认值用例。插件相关测试全部通过（contract/traceViewer/cloudflareHtml/externalSubagent 39 项、desktopPlugins 8 项、settings handlers 2 项）；真实运行 `molibot-release.sh` 产物含 `package/trace-viewer` 且与仓库一致，以产物为 app root + 全新 DATA_DIR 可暂存出全部三个内置插件。

### Bash 审批归属修复（2026-09-13，已修复）

- 通用 ToolRuntime 生成的宿主工具审批使用 `host:<toolId>`，`bash:*` 保留给 HostBashStore。SQLite broker 可以读取并批准自己创建的 Bash 请求，长期授权可在后续执行中复用。
- 根因是审批生产端与存储读取端对 capability 命名空间的约定不一致：请求仍为 pending，却被读取过滤器隐藏，界面因此误报请求失效。先前内存 broker 测试没有覆盖这个过滤器。
- 回归在同一临时数据库中使用真实 ToolRuntime、SQLite broker 和 HostBashStore，验证挂起、请求查询、长期批准、新轮次执行，以及 Host Bash 审批不被 broker 接管。既有错误标识的请求不会自动改写，需重新触发执行生成新请求。

### 计划审批后恢复执行（2026-09-13，已修复）

- 批准长任务中的工具操作时，审批结果、任务重新排队和当前步骤恢复为待执行在同一事务中保存。续跑可消费既有授权并推进步骤，支持仅此一次、执行期间和长期允许。
- 步骤启动异常进入统一失败收尾，释放执行租约并保留恢复原因，避免任务停留在无人执行的“执行中”状态。
- 根因属于任务与步骤状态转换不一致，以及启动异常遗漏收尾。临时数据库回归覆盖完整审批续跑、授权消费、计划完成和启动失败；历史审批测试只验证授权消费，未覆盖真实步骤从挂起到重新启动的链路。

### 修复：产物文件写入后打不开（「文件当前不可用」，复发）（2026-09-14，已修复）

- 症状（多次出现）：聊天里出现「创建 plan-approval-check.txt」卡片，右侧文件面板点开报「文件当前不可用」，但文件其实已在盘上。
- 根因：`write`/`edit`/`documentExport` 把文件写进带日期的 artifact 目录（`<scratch>/2026/09/14/`），但 receipt 的 `relativePath` 相对**日期目录**计算（只剩文件名），而 `/api/web/files` 与客户端 `matchesSessionOutputPath` 都按 `<scratch>/<path>` 解析 → 少了日期段，解析不到。
- 根修：`RunOutputLayout` 增加 `scratchBase`（非项目 = run cwd，项目 = `project.scratchDir`）与 `outputReportBase`；`write`/`edit`（走 `describeFileToolResult`）/`documentExport` 的 scratch `relativePath` 从 `scratchBase` 计算，日期段包含在内，写入与读取用同一把尺子；项目产物仍相对 projectRoot。
- 守卫与验证：新增 `outputLayout.test.ts`（dated-inclusive / project-relative / 无 `scratchBase` 回退），更新 `write.test.ts`；tools 相关测试 54/54、`outputLayout` 3/3、`/api/web/files` 5/5、`tsc` 改动文件无新增报错。`CLAUDE.md` pitfall #49 记录长期规则。

### 计划修复：历史卡住的计划可删除 / 标记完成（2026-09-14，已修复）

- 症状（owner 走查）：停留在 `paused` / `waiting_for_user`（「需要处理」）的旧计划在看板既没有删除、也没有完成入口，看起来永久卡死。
- 根因：删除守卫沿用旧的 durable 执行语义，把 `waiting_for_user` / `waiting_for_approval` 也当作「活跃」而拒绝；看板 `canDelete` 同样排除了这些状态。计划现在走 Session 普通轮次，这些状态只是记录，不是活跃执行。
- 修复：
  - `DurableExecutionStore.deletePlan` 只拦 `queued` / `running` / `verifying`；计划（`activation_reason = "plan"`）不再因残留 pending 审批被拦。
  - 看板 `canDelete` 同步放开；新增「标记完成」按钮与 plans `complete` 动作——把来源会话计划置为 `completed` 并镜像到 Durable，用于步骤已全部完成但停在 paused/waiting 的旧计划。
- 验证：`plans` 14/14、`tsc` 改动文件无报错、桌面 `svelte-check` 0、mjs 守卫 251/251、`vite build` 通过。

### 计划修复：执行完成应进入待确认而非暂停 + 计划页去除外层滚动（2026-09-14，已修复）

- 症状（owner 走查）：三轮都执行完了，计划却是「已暂停／需要处理」，聊天计划卡没有任何交互（没有完成/继续/返回）。
- 根因 1：`finishPlanTurn` 对正常结束（`stop`）且步骤全完成的计划仍设为 `paused`（历史语义是「中断可继续」）。现在改为——正常结束且全部步骤完成 → `waiting_review`（等待人工确认）；中止/未完成才 `paused`。
- 根因 2：`session-permission` 的 `complete` 明确拒绝带 `durableExecutionId` 的计划，且 PlanCard 的「确认完成」按钮以 `!durableExecutionId` 为前提——这是 Slice 3 遗留，与新流程冲突。现在 `complete` 允许计划记录（并把 completed 镜像回 Durable），PlanCard 在 `waiting_review` 一律显示「确认完成」。
- 症状/根因 3（计划页外层滚动）：`.workspace-scroll` 的 padding 与 `calc(100vh - 120px)` 叠加超出可视高度。改为该 pane `padding: 0; overflow: hidden`，`.plans-shell`/`.plans-workspace` `height: 100%` 填满工作区，由左列/详情内部滚动——不再出现整页滚动条。
- 验证：`planProgress` 5/5、`plans` + `sessionPlan` 共 19/19、`tsc` 改动文件无报错、桌面 `svelte-check` 0、mjs 守卫 251/251、`vite build` 通过。真机走查未做。

### 计划执行改为 Session 普通轮次（2026-09-13，已交付）

- 背景/期望（owner）：点击执行应等同于在对话里发一轮——有流式思考、工具调用、回复，至少是第二轮；审批走 chat 标准审批卡而不是右侧面板；右侧面板只读展示记录。
- 变更：
  - 接受（`session-permission`）不再启动 Durable runtime，只按接受时内容同步计划版本并写入权限；客户端接受后恢复 `resumePlan`，在来源 Session 以普通轮次执行（流式 + 标准审批卡）。
  - `/api/stream` 把带 `durableExecutionId` 的计划纳入 `sessionPlan`；轮次开始、每次 `plan_progress`、轮次结束/出错都把会话计划镜像到 Durable 记录（新增 `DurableExecutionStore.syncPlanProgress`、`PlanService.mirrorFromConversationPlan`），看板继续以 Durable 为读取源。
  - 看板「开始/继续」不再调用 plans API 启动 durable；改为 `onContinuePlan`：切到来源 Session 并 resume（项目计划仅打开会话）。移除看板暂停/取消（由对话的停止承担）。新增「打开会话」入口。
  - 右侧 Durable inspector 对计划执行改为只读：隐藏执行/审批按钮，显示「计划在对话中执行和审批；此面板仅展示记录」。
- 附带：首次批准选择的权限现在作用于来源会话的普通轮次。
- 验证：`plans + durable + sessionPlan` 61/61、`tsc` 改动文件无报错、桌面 `svelte-check` 0 错误 0 警告、mjs 守卫 251/251、`vite build` 通过；`DESIGN.md` 与能力矩阵同步。**真机冷启动走查未做**。

### 计划看板修复：计划卡进度不随 Durable 执行同步（2026-09-13，已修复）

- 症状（owner 走查）：执行结束、右侧 inspector 显示 3/3，但聊天里的计划卡仍是「排队中 0/3」、步骤不打勾；看起来像执行没有回到拆解面板。
- 根因：计划卡的状态由服务端把 Durable 聚合投影回会话计划得到，但桌面只有手动重载/切换会话时才重新拉取会话消息；带外执行的进度不会触发重载。带外执行其实已写入来源会话（截图里「已完成操作」就是它的活动），但计划卡不会自己刷新。
- 修复：`ChatView.observeDurableExecutionTransitions` 在轮询到「来源会话匹配当前会话」的执行状态或版本变化时，触发 `chatStore.reloadActive()` / `projectChatStore.reloadActive()`。这样计划卡的勾选/进度、以及新追加的执行活动都会自动出现；状态到达终止/等待态时的通知逻辑保持不变。切换/断线时同步重置签名表。
- 验证：`svelte-check` 0 错误 0 警告、mjs 守卫 251/251、`vite build` 通过。真机冷启动走查未做。

### 计划执行回归修复：恢复在来源 Session 的可见执行记录 + 看板去留白（2026-09-13，已修复）

- 症状（owner 走查）：计划执行被当成独立执行——对话里看不到 LLM 调用/工具调用/输出，只有最终任务完成；看板详情下方留白过多。
- 根因（执行记录丢失）：`DurableExecutionRuntime` 把 attempt 的 inbound 固定为 `sessionMode: "fresh"`，于是每次都开一个任务归档 Session（`t-archive-*`），来源会话没有任何活动。这偏离了 DESIGN「批准计划在当前 Session 的下一轮执行」。
- 根修：会话来源的执行（`sourceUiSessionId` 存在：计划与普通运行晋升）改为 `sessionMode: "chat"` 且 `sessionId = sourceUiSessionId`，attempt 继续来源会话，LLM/工具/产出留在同一对话；仅有调度/项目等无来源会话的执行才用 fresh 归档。附带修正：首次批准选择的来源会话权限（manual/accept_edits）现在会作用于该 attempt。
- 看板留白：`.plans-workspace` 由固定 `height: calc(100vh - 220px)` 改为 `height: auto; max-height: calc(100vh - 220px)`，短计划收缩到内容高度，长计划才到上限并内部滚动。
- 验证：`durable/*.test.ts` + `plans/*.test.ts` 59/59、`tsc` 改动文件无报错、桌面 `svelte-check` 0、mjs 守卫 251/251、`vite build` 通过。**真机冷启动/多主题走查未做**。

### 计划看板规范修复：贴合工作区容器约定 + 消除多余滚动 + Web 规范（2026-09-13，已修复）

- 背景：owner 走查指出①看板面板无圆角、与主题不一致且像 hardcode；②左列明明有空间却出现上下滚动；③左列出现左右滚动、长文本不截断；并要求按 Web Interface Guidelines 一并整改。
- 圆角/容器：改为与 `TasksSection` 等一致的 workspace 约定——`.plans-shell { width: var(--workspace-col); margin: 0 auto }` 居中，`.plans-workspace` 用 `border: 1px solid var(--separator); border-radius: var(--rounded-md); background: var(--card-bg); height: calc(100vh - 220px); overflow: hidden`。圆角全部走主题 token，组件内 0 处硬编码 px 圆角。
- 滚动：`.plans-list` 改为 `flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden`，让左列填满容器高度、只在真正溢出时滚动；去掉“有空间却滚动”。
- 横向溢出/截断：`.plans-row / .plans-row-top / .plans-row-sub` 加 `min-width: 0`，标题 `overflow: hidden; text-overflow: ellipsis`，chip `flex: none`，列表 `overflow-x: hidden`——不再出现左右滚动条和右侧被裁掉的 chip。
- 其他规范整改（PlansWorkspace）：筛选由伪 tablist 改为 `role="group"` + `aria-pressed`（去掉无 tabpanel/无方向键的假 tab）；搜索框补 `name/autocomplete="off"/spellcheck="false"` 与独立 `aria-label`；进度条补 `aria-label`；选中行补 `aria-current`；`.plans-filters`/`.plans-remove` 补 `:focus-visible`；搜索框 `:focus-within` 由仅变色改为可见焦点环；计数用 `font-variant-numeric: tabular-nums`；标识符（shortHandle/projectId）加 `translate="no"`；占位符以 `…` 结尾。
- 运行期英文串收口：`waitingReason` 按 `projection.waiting.kind` 映射为本地化文案（review→`planReviewPrompt`、recovery→新增 `planBoardRecoveryReason`），不再直接显示英文 "Please confirm whether the requested goal is satisfied…"。
- 验证：`svelte-check` 0 错误 0 警告、mjs 守卫 251/251、desktop `vite build` 通过。真机冷启动/窄窗/多主题走查未做。

### 计划看板 UI 重做：更清晰的列表/详情层次与本地化（2026-09-13，已交付）

- 背景：owner 反馈计划看板「太烂」，截图暴露拥挤的列表、全宽怪进度条、原始 ISO 时间、内部英文串外泄（`The bounded Agent attempt completed this plan step.`、`The plan's requested outcome is verified.`）、删除按钮过重等问题。
- 列表（左栏）：统一行结构（标题 + 状态 chip；次行 shortHandle · 进度 · 项目，等宽数字），搜索框与状态筛选改为 pill，选中行用卡片边框而非整行高亮。
- 详情（右栏）：标题行 = 计划名 + 状态 chip，副标题行聚合 shortHandle / 版本 / 更新时间（用会话列表同一 `formatTime`，不再显示 ISO）；内容改为卡片式分区（概览 / 任务 / 验收要求 / 返工），细进度条（5px）+ 等宽计数；步骤用图标区分完成/执行中/受阻/待执行并对齐状态文字。
- 本地化：复用 inspector 的内部串映射（`durableStepAttemptCompleted`、`durableCriterionAllStepsComplete`），新增 `planBoardDefaultCriterion` 映射默认验收语；中英同步。
- 交互：操作集中在底部固定栏，左「新增返工任务」、右按状态排序的 删除/取消/暂停/开始/继续；删除与取消改用 `.secondary-button.danger-action`（文字红、幽灵底），不再整块红。
- 布局：新增 `.workspace-scroll[data-workspace-pane="plans"] { padding:0; overflow:hidden }`，让看板成为全高 master–detail，由左右两栏各自滚动；<900px 单列折叠 + 返回按钮。
- 验证：`svelte-check` 0 错误 0 警告、mjs 守卫 251/251、desktop `vite build` 通过。

### 计划看板修复：重启后残留「需要审批」卡片点击报 no longer pending（2026-09-13，已修复）

- 症状（owner 走查）：服务重启后，Durable inspector 仍显示上一次中断 attempt 的「需要审批」卡片，点击「仅此一次/长期允许」报 `The underlying approval request is no longer pending.`，执行停在中转态。
- 根因：审批 broker 的请求是内存态（`ApprovalBroker.requests = new Map`），重启即丢；但 `durable_approval_requests` 行仍是 `pending`，UI 据此渲染可点击卡片。
- 根修：`DurableExecutionStore` 新增 `expireAttemptApprovals`，在两条路径把不再可答的 pending 审批置为 `expired`：① 启动 reconcile 把孤儿 attempt 标为 interrupted 时；② `finishAttempt` 的落点不是 `waiting_for_approval`（暂停/中断/失败）时。卡片随之消失，恢复由「继续/开始」触发的 runtime recovery 重新请求。
- 边界：已批准的持久/session 授权在键稳定时仍会被消费复用；若模型同一文件在两次 attempt 里分别用相对路径与绝对路径（审批键含路径），键不同会重新请求——这是模型输入不稳定，非状态泄漏。
- 验证：`store.test.ts` 14/14（含新增「停止等待即过期 pending 审批」用例）。

### 计划看板修复：持久审批被反复重新请求（2026-09-13，已修复）

- 症状（owner 走查）：计划里同一个 `write` 步骤在每次恢复后都重新弹审批，即使已选「一直允许」；执行因此反复中断/暂停，看起来像卡住。
- 根因：durable 记录审批键时用 `[toolId, command, approvalMode]`（来自 prompt），而 broker 路径消费审批时用的是 `[toolId, command, "ephemeral"]` 硬编码（`toolRuntime.ts`）。键不一致 → `consumeDurableApproval` 找不到已批准的持久审批 → 每次都重新请求。
- 根修：在 `ToolRuntime` 里把 `pendingPrompt`（`buildBrokerApprovalRecord` + `buildHostBashApprovalPrompt`）提前构造一次，消费键与后续 `onApprovalRequest` 传给 durable runtime 的 prompt 同源；`toolRuntime.test.ts` 的期望键从错误的 `...:ephemeral` 修正为真实的 `...:persistent`。
- 验证：`toolRuntime.test.ts` + `durable/runtime.test.ts` 28/28。

### 计划看板修复：durable 续跑事件污染「自动任务」未读（2026-09-13，已修复）

- 症状（owner 走查）：计划执行时左侧「自动任务」出现未读角标 1，本不应出现。
- 根因：Durable Execution 的续跑事件与定时任务共用 `system/bots/<owner>/events/` 目录，`/api/settings/tasks` 把所有 JSON 事件都投影成用户 one-shot 任务，于是 `durable-execution:*` 事件进入自动任务列表与 `unreadOneShot` 计数（`category:"user"`、`channel:"system"`）。
- 根修：在任务投影层新增 `isDurableExecutionTaskEvent`（`execution:"internal" && internal.kind==="durable-execution"`），`toTaskItem` 命中即返回 null，从列表与徽标剔除；durable 续跑仍由 `taskScheduler` 正常调度，只是不再出现在用户自动化里。
- 附带结论（owner 反馈「卡在运行 shell」）：不是死锁。`durable_attempts` 显示该 attempt 的 `end_reason = service_restarted`（dev 服务在运行中重启），启动 reconcile 已把旧 attempt 标为 `interrupted` 并自动发起新一轮（attempt 3 running），属预期恢复。
- 验证：`desktopTasks.test.ts` 19/19（含新增 durable 事件剔除单测）；`tsc` 本次改动文件无新增报错。

### 计划看板 UI 调整：移除侧栏「进行中」、入口收敛到顶部图标、计划卡保留进度入口（2026-09-13，已修复）

- owner 走查反馈：左侧「进行中」列表不需要；计划应通过右上角的图标点开展示列表；新版计划卡丢失了「查看计划进度」按钮。
- 调整：删除侧栏 `DurableExecutionSidebarSection`（含组件文件），不再在左侧列进行中的执行；顶部 Layers 徽标按钮改为打开「计划」列表（`openWorkspacePane("plans")`），计数沿用进行中的执行数。
- `PlanCard` 在「待批准」决策卡上补回「查看计划进度」按钮（仅带 `durableExecutionId` 时），点击进入 Durable inspector；已接受/执行中的计划原本就有该按钮，两者一致。
- 验证：`svelte-check` 0 错误 0 警告、mjs 守卫 251/251、desktop `vite build` 通过。

### 计划看板修复：没有接受按钮 / 无法开始 / 右侧面板重复（2026-09-13，已修复）

- 症状（owner 真机走查）：生成计划后计划卡直接显示「已接受」，没有接受/修改/拒绝按钮；Durable inspector 对 `planned` 只显示「暂停/取消任务」、没有「开始」，流程卡死；右侧先后出现「查看计划进度」和「长任务详情」两套面板，聊天里同时有计划卡和「长任务」卡，看起来重复。
- 根因 1（接受按钮消失）：Slice 3 起计划在生成时就保存为 Durable Execution（状态 `planned`），而 `projectDurableConversationPlan` 把 durable `planned` 投影为会话计划 `accepted`，于是 `PlanCard` 认为已接受、不再渲染决策卡。根修：`planned` → `proposed`（未批准＝待批准），补 `planProjection.test.ts` 断言。
- 根因 2（无法开始）：仓库的 durable 控制动作只有 pause/resume/cancel，`DurableExecutionInspector` 对 `planned` 因此只给暂停。根修：`/api/desktop/durable-executions` 新增 `activate` 动作（复用 `coordinator.activate`），inspector 对 `planned` 渲染「开始」，与计划看板一致。
- 根因 3（面板/卡片重复）：计划卡「查看计划进度」固定打开旧的 `SessionPlanInspector`（PlanCard 进度视图），而计划实际由 Durable 执行驱动；聊天转写里又额外渲染一张 `DurableExecutionCard`。根修：计划若带 `durableExecutionId`，进度入口直接打开 Durable inspector（单一真相源）；同一 session 内已被计划引用的 durable 执行不再重复渲染「长任务」卡。
- 验证：`planProjection.test.ts` 4/4、`plans/durable/sessionPlan` 55/55、`svelte-check` 0 错误 0 警告、mjs 守卫 251/251、desktop `vite build` 通过。

### 计划看板（Plan Board）Session 接入：生成即保存 + 首次批准走 Durable Execution（2026-09-13，部分交付）

- 背景：Slice 1/2 之后，计划已能在看板查看/编辑/控制，但还不能从 Session 生成，接受计划仍走「原 Session 内执行」旧链路。本 slice 把计划接入真实的生成与批准流程，并统一到 Durable Execution。
- 生成即保存：Plan mode 产出 `plan_proposal` 时，`ensureSessionPlanRecord` 立即把计划写为 Durable Execution（`planId = plan.id`，幂等，拍平为一个任务包含全部步骤），并把返回的 `durableExecutionId` 写回会话计划元数据；`/api/stream` 与 `/api/chat` 两条持久化路径都接入。保存失败只记录结构化日志、不中断本轮回答。未批准的计划因此进入看板待批准。
- 首次批准：`/api/desktop/session-permission` 的 accept 分支不再依赖聊天续跑。若计划已保存为 Durable Execution，先按接受时（可能已编辑）的标题/摘要/步骤用 `replacePlanContent` 生成一个新内容版本（仅允许 `planned` 状态，不覆盖任何结果），再 `start` 进入 `queued`；失败返回 409。权限覆盖仍按 accept 的 `manual/accept_edits` 写入来源 Session。
- 客户端：接受计划时若带 `durableExecutionId`，不再调用 `resumePlan` 走原 Session 内执行，避免两个执行者；只有在 Session 内、未落库的计划才保留旧链路。
- store 新增 `replacePlanContent`（`planned` 专用、写新版本、复用计划内容写入），`PlanService.replaceContent`，以及 `sessionIntegration.ts`（`planTasksFromConversationPlan` / `ensureSessionPlanRecord` / `approveAndStartPlan`）。
- 跨 Session：计划执行由 Durable runtime 在独立 attempt session 中推进，事件与结果按执行/任务身份路由；在任意 Session 打开看板都能查看与暂停/继续，不依赖来源 Session 仍打开。
- 验证：服务端 `plans/*.test.ts` 12/12（含生成幂等、批准时应用编辑并 queued、启动后禁止替换内容、35 步不截断）；`durable/*.test.ts` + `sessionPlan.test.ts` 42/42；`tsc` 改动文件 0 报错；桌面 `svelte-check` 0 错误 0 警告、`vite build` 通过、mjs 守卫 251/251。**真机冷启动走查未做**。
- **未交付**：看板内的确认/审批/证据交互（当前由侧栏 Durable Execution inspector 承担）、跨 Session 显式认领（`setAttemptContextSession`）与承接历史展示、首次批准的权限选择 UI（当前沿用来源 Session 权限）、实时事件（当前轮询）、完整任意两层增删改排序（当前替换仅限未开始、返回后为追加返工）。

### 计划看板（Plan Board）桌面列表与详情面板（2026-09-13，部分交付 / 桌面 UI）

- 背景：Slice 1 落地共享计划服务后，本 slice 补齐桌面 App 专享的「计划」入口与两层编辑/控制界面。
- 入口：工作区导航新增「计划」（`workspace.plans` 命令 + 侧栏 nav item + commandSystem 目录），路由到新的 `PlansWorkspace.svelte`；沿用 workspace 的 master–detail 轨道，未占用聊天 Inspector 的第四个 adapter 位置。
- 列表：`/api/desktop/plans` 拉取（`includeArchived`），本地即时搜索（名称/ID）与状态分桶筛选（全部/未开始/进行中/需要处理/已结束/已归档）；行显示标题、状态 chip、短 handle、完成数、当前步骤与项目。空列表/无匹配/加载失败均有明确提示。
- 详情：标题 + 状态 + 版本 + 更新时间 + 当前步骤；两层任务/步骤列表（状态图标、产出摘要）、验收要求结果；`completed/skipped` 只读。操作区按状态启用：planned 显示「开始」、queued/running/verifying 显示「暂停」「取消」、paused/recovery_required 显示「继续」、可修订状态显示「新增返工任务」「删除」。
- 返工编辑：新增任务行（任务名 + 每行一个步骤），提交 `revise` 追加为新版本并回到待批准（与 Slice 1 store 语义一致，已完成结果结转）。
- 轮询：列表 5s、已选详情 5s（`document.hidden` 时暂停），`requestSeq` 丢弃过期响应，避免旧详情覆盖新选择。
- 契约与 API 客户端：`src/lib/shared/desktop.ts` 新增 `DesktopPlan*`（含 `DesktopPlanDetail` = durable inspection + `meta` + `tasks` + `projection`）；`api.ts` 新增 `loadDesktopPlans/loadDesktopPlan/runDesktopPlanAction`。
- i18n：中英各新增计划看板文案（导航/筛选/空态/操作/返工/状态）。
- 验证：服务端 `plans/*.test.ts` 8/8；`tsc` 改动文件 0 报错；桌面 `svelte-check` 0 错误 0 警告；desktop `vite build` 通过；`chat-ui.test.mjs` 等 mjs 守卫 251/251、`commandSystem.test.ts` 8/8（含新 `workspace.plans` 断言）。**真机冷启动走查未做**。
- **未交付**：从 Session 生成并保存计划（`exitPlan` 接入）、首次批准选择权限、跨 Session 继续、实时事件（当前为轮询）、已完成计划的历史结果入口与完整任意增删改排序（当前为追加返工）。

### 计划看板（Plan Board）共享计划服务基础（2026-09-13，部分交付 / 后端基础）

- 背景：落实 `docs/requirements/plan-board-prd.md`（方案 v4）。第一阶段先把「计划 = Durable Execution 聚合」的共享底座跑通，避免先做 UI 再返工执行真相源。
- 存储（复用 `durable-execution.sqlite`，全部为新增表，不改动既有表）：`durable_plan_meta`（title/summary）、`durable_tasks`、`durable_task_steps`（step→task 映射，执行仍按 `durable_steps.step_index` 线性推进）、`durable_plan_tombstones`（删除后旧引用可判定）。`ensureSchema` 只用 `CREATE TABLE IF NOT EXISTS`，无 migration、不触碰既有用户数据。
- 领域能力（`src/lib/server/agent/durable/store.ts`）：`createPlan`（一个事务写入执行行、版本、两层任务/步骤、验收标准、meta，初始 `planned`）、`getPlanTasks`、`getPlanMeta`、`revisePlan`（追加返工任务为新版本，原样结转已完成步骤的结果与证据，新版本回到 `planned` 待重新批准；运行中/排队/等待/已取消拒绝应用，须先安全暂停）、`deletePlan`（仅停止且无待审批的计划可删，保留产出文件，写 tombstone，重复删除幂等）、`getPlanTombstone`。
- 共享服务（`src/lib/server/agent/plans/service.ts`）：`PlanService` 提供 create/list（标题/ID 搜索、状态/项目筛选、默认隐藏已归档）/read（含两层任务、真实进度投影、`PlanDeletedError`）/revise/start/pause/resume/cancel/delete；生命周期分桶 `not_started / in_progress / needs_attention / finished / archived` 由执行状态派生，completed 视为归档。
- API：`/api/desktop/plans`（GET list/read，POST create/revise/start/pause/resume/cancel/delete），返回 `Cache-Control: no-store`；错误按 404/410/409/400 映射。仅桌面 `api/desktop` 前缀，未加入 Web/Channel。
- 与 Durable Execution 的关系：计划即聚合，`planId` 复用执行 id，杜绝第二套进度源；任务层只做展示分组，执行器继续按线性步骤推进，未改 runtime。
- 测试：新增 `plans/service.test.ts` 7/7（两层结构、31 步无静默截断、搜索/筛选/归档、start 入队事件、暂停后返工结转已完成结果、删除幂等与 `PlanDeletedError`、owner 隔离）；`durable/*.test.ts` + `plans/*.test.ts` 共 48/48 通过；`tsc --noEmit` 对本次改动文件无报错。
- **未交付**（后续 slice）：桌面「计划」列表 + 右侧编辑面板（两层编辑、固定操作栏、中英/明暗/窄窗）、`exitPlan` 生成即保存与首次批准接入、实时快照/增量与断线补齐、跨 Session 继续、完整的确认/审批复用。真机冷启动走查未做。能力矩阵未新增行：尚无用户可见的端到端能力。

### 主题区域适配层：现有 chrome 区域按家族改写 + QQ 样板（2026-09-13，已交付）

- 背景：owner 用一张完整 QQ 皮肤举例，指出「完整形态」不只是换色 + 气泡，而是 header、文件面板、输入区、会话列表、聊天区这些**独立结构**都要有对应的适配项；但明确不改整体布局、不加底部状态栏/顶部命令带。此前主题只能改 token，作用在同一棵组件树上，无法表达这些区域的**形态**。
- 方案（共享层）：新增「区域适配层」——在现有元素上挂固定的 `data-theme-region` 钩子，家族文件用 `:root[data-theme-family="X"] [data-theme-region="Y"] …` 限定作用域改写区域形态（渐变、边框、圆角、阴影、装饰伪元素、被重绘元素的文字色），**禁止改布局**（不得动 display/grid/position/尺寸）。token 能表达的仍放 token 块。契约见 `DESIGN.md`「Region adaptation」。
- 钩子落位：`.chat-layout`→`window`、`.chat-header`→`header`、`.chat-sidebar`→`sidebar`、`.sidebar-channels`→`session-list`、`.chat-content`→`chat`、`.composer-wrap`→`composer`、ArtifactPanel `.file-panel`→`file-panel`（7 个，全部挂在已存在的元素上，零布局改动）。
- 样板（QQ，`themes/qq.css` 新增区域段）：header 变 QQ 标题栏（浅蓝渐变 + 下边线、去掉玻璃层）、sidebar 换蓝色渐变 veil、会话分组头变填充条、选中会话变蓝色药丸白字、聊天画布顶部加白色洗淡（在输入框渐隐条之前淡出，维持 `header-bg === content-bg` 不产生接缝）、输入区加凸起白卡框、文件面板加标题栏；暗态同形换 QQ 蓝灰。
- 全家族铺开（共 23 款，除 macOS 外全部）：QQ 之外，9 款品牌聊天/社交家族（WeChat、Telegram、Discord、Feishu、WhatsApp、Facebook、Google、iOS、Android）、7 款大胆家族（Terminal、Brutalism、Blueprint、System 6、Cyberpunk、Candy、Cartoon）、2 款商务文档家族（Office、WPS），以及 win98 与 3 款纯调色板家族（Rosé Pine、Catppuccin、Midnight）都用同一套钩子补齐区域适配。实现走**token 派生的 color-mix**（`color-mix(in srgb, var(--accent) …)`、`var(--card-bg)`、`var(--sidebar-bg)`、`var(--on-accent)`），所以同一段规则在明暗两态自动成立、无需各写一遍；差异来自各自 token（WeChat 绿、Telegram 蓝、Discord blurple、Office Word 蓝、WPS 红、Catppuccin 蓝、Rosé Pine pine/iris、Midnight 蓝紫、Win98 深蓝、Cyberpunk 品红、System 6 黑白反转、Terminal 荧光绿等）。半径/字体/硬阴影仍由各家族 token 决定（System 6/Brutalism/Terminal/Win98 的 `--radius-*:0` 让选中药丸自动变方块）。
- 刻意未做：仅 `macos`（产品默认，必须保持原生玻璃与中性，不能有品牌 chrome）。其余 23 款全部有区域适配段。
- 守卫：`chat-ui.test.mjs` 新增用例——家族文件里每个选择器只能是「token 块 / 缩略图 / `data-theme-region` 区域规则 / win98 bevel」，且用到的 region 钩子必须在文档表内；并断言钩子确实挂在真实 chrome 元素上。既放开了结构适配，又堵住「回退成任意 per-component 选择器」的漂移。
- 验证：`chat-ui.test.mjs` 248/248、全量桌面守卫 259/259、`svelte-check` 0 错误 0 警告、desktop `vite build` 通过。渲染台截图确认 23 款家族的 header/侧栏/会话列表/聊天区/输入区/文件面板都按各自形态改写、明暗两态都成立，`macos` 保持原生玻璃。**未做**：Tauri 真机走查未做。

### 主题走查修复：QQ 品牌色重调 + Agent City 天空跟家族走（2026-09-13，已交付）

- 背景：上一批 24 款家族交付时明确标注「真机 GUI 冷启动走查未做」。owner 走查后反馈两点：QQ 只换了颜色、整体并不像 QQ；以及希望整个 APP（含 Agent City）都符合主题，而不是只改其中一部分。本轮补上了 24 款家族明/暗两态的真实像素走查——临时改用独立渲染台（直接加载 `styles.css` + 全部主题文件，无头 Chromium 截图 48 张 + 4×6 拼图）逐款比对。
- 根因 1（QQ）：强调色 `#0d7faa` 是发灰的深青蓝、整屏 `#cfe4f7` 是偏饱和中蓝，像「普通蓝色聊天软件」而非 QQ。QQ 真正的品牌天蓝是亮而通透的 azure。重调亮态：强调 `/`/ 链接 `#0f79c0`、发出气泡 `#0090e8`（白字 3.41:1，达「饱和品牌气泡 3:1」下限）、画布 `#e6f2ff`、侧栏 `#dcebfb`;暗态改为 QQ NT 冷静蓝灰 `#101822`（蓝色只留在气泡/强调色），发出气泡 `#1e7fc4`。同步更新三态缩略图。
- 根因 2（Agent City 跑题）：天空色原为场景写死的 `DAY_SKY`/`NIGHT_SKY`，每个家族再用 `--agent-city-sky` 反向对齐，于是 System 6 / Win98 / Terminal / Candy / Cartoon 等主题里 Agent City 永远是一块固定蓝灰孤岛。根修（共享层、单一事实来源）：全 24 家族 + base `:root` + 导入主题映射统一把 `--agent-city-sky` 指向 `var(--header-bg)`;`AgentStudioPane` 用 `getComputedStyle` 读该 token、经 `AgentCityCanvas` 传给新 `AgentCitySceneOptions.sky`,`scene.background` 与 `scene.fog` 同源;新增 `setSky` 在家族/明暗切换时只重绘画布不重建场景。删除了场景里的 DAY_SKY/NIGHT_SKY 常量——外壳与画布再也不可能各说各话，接缝类问题从结构上消失，而不是靠两处常量手工对齐。
- 守卫改写：`chat-ui.test.mjs` 的 Agent City 用例从「从场景常量反查期望天空色」改为「断言 48 个家族/变体全部 `--agent-city-sky: var(--header-bg)`、场景消费 `options.sky`、pane 读计算 token 并监听 `data-theme-family` + `data-resolved-appearance`、导入映射 `set("--agent-city-sky", hex(surface))`」，并断言场景不再出现 `DAY_SKY|NIGHT_SKY`。`CLAUDE.md` pitfall #4 同步更新为新契约。
- 验证：`chat-ui.test.mjs` 247/247、`agentCityScene.test.ts` 6/6、`vscodeTheme.test.ts` 12/12、`svelte-check` 0 错误 0 警告、desktop `vite build` 通过;48 张渲染台截图确认 Agent City 面板在 24 款明/暗下均与页面同色（system6 纯黑、candy 粉/酒红、qq 蓝灰等）。**Tauri 真机 GUI 冷启动走查仍未做**：渲染台用真实 `styles.css` + 全部主题文件和真实类名复刻了聊天/侧栏/气泡/工具卡/输入框/Agent City 结构，但非真机 WebView，需在 app 内逐款切换做最终确认。**未处理**：Blueprint 亮态 / Cyberpunk 亮态的招牌（制图网格、霓虹）是结构性的，仅靠颜色无法表达，未纳入本轮;Android/Google 亮态发出气泡与助手气泡对比也偏弱，留作后续。

### 新增 14 款生活化/品牌主题家族 + 双向气泡语义 token（2026-09-13，已交付）

- 背景：owner 反馈主题风格单一（原 10 款全是原生/开发/复古技术风或柔和配色），希望增加活泼可爱、商务、平台识别、社交通讯、儿童卡通五类，且要「一看就知道是 iOS / WhatsApp / 安卓」。第一版只做了强调色 + 气泡色，owner 二次反馈「背景基本没变、不够彻底、回复也要有气泡」，于是重做为一整套视觉语言。
- 新增家族（`apps/desktop/src/themes/`，各自一个文件）：产品档（只换颜色）`ios`、`office`、`wps`、`whatsapp`、`wechat`、`telegram`、`facebook`、`feishu`；大胆档（重写字体/圆角/阴影/玻璃）`android`、`discord`、`qq`、`candy`、`cartoon`、`google`。共 14 款，主题家族从 10 增至 24。
- 彻底化（第二轮）：每款都让**整幅窗口画布**带品牌色而非只改强调色——QQ 全蓝、糖果全粉、卡通暖黄、安卓薰衣草、Material 紫、Google 白+谷歌四色、Feishu 灰+飞书蓝；聊天类家族同时把**助手回复正文**包进气泡（工具/思考卡片保持无框，在 `.message-bubble` 之外），文档类家族（Office/WPS/Google）保持裸文。
- 共享层根修 1（发出气泡）：原本写死 `--gray-300`（开关关闭态也用它），新增 `--bubble-mine-bg` / `--bubble-mine-border` / `--bubble-mine-text`，`.message-row.mine .message-bubble` 改读新 token。饱和气泡（iMessage/飞书/Facebook 蓝）用白字。导入主题无需改映射器：`var()` 在计算期解析，覆盖 `--gray-300` 后气泡自动跟随。
- 共享层根修 2（回复气泡）：助手回复原本被 `.message-row.assistant .message-bubble { background: transparent; border: 0 }` 强制裸文；改为读取 `--bubble-assistant-bg` / `-border` / `-padding` / `-radius`，默认仍是裸文（transparent/0），聊天类家族填这 4 个 token 即获得气泡。
- 品牌气泡（发出 / 回复）：qq 蓝实色白字 / 白、candy 粉 / 白、cartoon 橙 / 白、android #4F378B / 深面、discord #5865F2、whatsapp #D9FDD3 / 白、wechat #95EC69 / 白、telegram #EFFDDE / 白、ios #007AFF / 白、facebook #1877F2 / #F0F2F5、google #E8F0FE / #F1F3F4、feishu #3370FF / 白。
- 边界约束：`--agent-city-sky` 每个家族/明暗固定为 `#eaf3f5`/`#101820`（须与 Agent City WebGL 画布 `DAY_SKY`/`NIGHT_SKY` 一致，否则外壳露缝）；产品档保持 `header-bg === content-bg`（输入框渐隐条不显影）；暗色结构面不用纯黑（iOS #101014、WhatsApp #0B141A、WeChat #111111 均避开 `#000000`/`#0A0A0A`）。
- 可读性：亮色态强调色同时用作按钮填充（白字 `--on-accent`）和链接文字，逐家族校准白字对比度 ≥4.5——wechat #058844、telegram #1f7eaf、qq #0d7faa、cartoon #b46100、candy #c84877、whatsapp #198845、wps #d54037、ios 保留系统蓝 #007aff；饱和品牌气泡（ios/facebook 深色态、feishu 深色 danger）按 WCAG UI 3:1 兜底。缩略图色块保留原始品牌色。
- 登记点：`themes/index.css` 14 条 import、`lib/api.ts` 类型+白名单、`api.test.ts`、`lib/i18n.ts`（中英各 14 家族 + 28 变体标签）、`App.svelte` 三个 key 联合类型 + `THEME_FAMILY_PREVIEWS`、`chat-ui.test.mjs` 家族清单/大档清单/sky 与 accent 计数（21→49）。
- 验证：`chat-ui.test.mjs` 247/247、`api.test.ts` 109/109、`vscodeTheme.test.ts` 12/12、`svelte-check` 0 错误 0 警告、`vite build` 通过；另有 token 对比度对抗脚本（label/canvas、on-accent、danger、发出/回复气泡文字）全部达标。**真机 GUI 冷启动走查未做**：需在设置 → 外观逐一切换 24 款家族，确认画布品牌色、助手/发出气泡、明暗两态、Agent City 接缝、窄宽度网格换行。


### 导入主题映射修正：对比度下限 + 输入框渐隐接缝（2026-09-13，已交付）

- 背景：owner 导入 Solarized (light) 后反馈两处——整体对比度低（尤其字体、侧栏），以及 chat 输入框上方多出一道阴影带。
- 根因 1（对比度）：Solarized 的 `editor.foreground`(#657b83) 对画布只有约 3.6:1，而映射又把 `--label-secondary/tertiary` 按「primary 向背景混 40%~68%」推导，得到 #a9b2ae / #cccfc4，几乎看不清。根修：颜色工具新增 `contrastRatio` 与 `ensureContrast`，映射时对 primary 施加 WCAG AA（4.5:1）、secondary（3.2:1）、tertiary（2.2:1）对比度下限；`--on-accent`、`--warning-text`、`--code-text`、`--syntax-code-fg` 同样兜底（4.5:1）。`readableOn` 改为在黑白中选对比度更高者——此前阈值错误，把白字压到橄榄色 accent 上只有约 2.7:1。
- 根因 2（阴影带）：所有内置家族都保证 `header-bg === content-bg`；`.composer-wrap.is-floating::before` 的滚动渐隐是 `transparent → var(--content-bg)`，而聊天画布用 `var(--header-bg)`。映射此前把 `header-bg` 映射成 `titleBar.activeBackground`(#eee8d5)，与 `content-bg`(#fdf6e3) 不等，于是渐隐条显影成一条更亮的带子。根修：`header-bg` = 画布 surface（与 content-bg 一致），不再取 titleBar。
- 存储改为保存原始主题文件：记录只存 `{id, importedAt, raw}`，加载时前端用当前映射器重新推导 token（`hydrateImportedTheme`）。以后调整映射无需重新导入即可生效；旧格式（内嵌 tokens）不兼容，会被 `list` 跳过。
- 验证：`vscodeTheme.test.ts` 12/12（新增对比度下限、header-bg 等于 content-bg、on-accent 非白、hydrate 容错）；Rust `imported_themes` 6/6（新 schema）；`cargo test` 70/70；`svelte-check` 0 错误；桌面 mjs 守卫 258/258；desktop build 通过。**真机走查未做**：需重新导入 Solarized (light)，确认字体变清晰、输入框上方阴影消失。

### 主题导入增加「一键打开主题目录」（2026-09-13，已交付）

- 背景：owner 找不到 VSCode 主题文件在哪（实际装的是 Insiders，且未安装任何主题扩展，只有 App 内置、且多为 `include` 拆分的主题），希望导入说明处能一键在访达打开目录，并覆盖 VS Code / Insiders / Antigravity 等。
- 方案：Rust 侧 `theme_sources.rs` 维护已知目录白名单——macOS 下各编辑器的 `Contents/Resources/app/extensions`（VS Code / Insiders / Antigravity / Cursor / VSCodium / Windsurf），加上用户扩展目录（`~/.vscode/extensions`、`~/.vscode-insiders/extensions`、`~/.cursor/extensions`、`~/.vscode-oss/extensions`、`~/.windsurf/extensions`）。命令 `list_theme_directories` 返回目录及 `exists`，`open_theme_directory(id)` 只接受白名单 id 再用 opener 打开；前端只传 id，绝不传路径，从根上杜绝任意路径打开。
- UI：外观设置的导入区块新增「打开内置主题目录 / 打开已装扩展目录 · <编辑器>」按钮组，鼠标悬停显示完整路径，附文案说明进入 `theme-*/themes/` 选 `*.json`。
- 二次修正（owner 反馈「为什么有两个 VS Code Insiders，扩展目录是什么，一个不就够了吗」）：`hasThemes` 改为「目录存在且至少有一个扩展在 `package.json` 的 `contributes.themes` 里声明了配色主题」才为真——纯扩展目录（如 `~/.vscode-insiders/extensions` 只有 Claude/Go/Python 等非主题扩展）不会再出现无效按钮；标签也改为「内置主题目录 / 已装扩展目录」区分来源。用户现在只看到两个按钮（Insiders 内置、Antigravity 内置），装了市场主题后才会多出扩展目录按钮。
- 验证：Rust `theme_sources` 4/4（id 唯一且可解析、用户扩展路径在 home 下、未知 id 拒绝、无主题贡献的扩展目录不被判定为可开）、`cargo test` 70/70；`svelte-check` 0 错误 0 警告；`chat-ui.test.mjs` 247/247；desktop vite build 通过。**真机 GUI 走查未做**：需在 app 里确认按钮出现、扩展目录在无主题扩展时被隐藏、并能在访达打开对应目录。

### VSCode 主题导入（2026-09-13，已交付）

- 背景：owner 希望外观不再只有内置家族，能直接导入 VSCode / 其他编辑器主题。确认范围：只做桌面端、只导入单个 VSCode `.json`、单变体（明暗由主题自己声明）、落盘到 Tauri app data、运行时注入，并在导入处给出「支持什么 / 在哪下载 / 怎么拿文件」的说明。
- 数据模型：导入主题是只换颜色的产品档家族、单变体。`lib/theme/vscodeTheme.ts` 解析 VSCode 的 `colors` + `tokenColors`（含 JSONC 注释与尾逗号，尾逗号去除是字符串感知的），把工作台色板映射到产品 token；缺失项由 `lib/theme/color.ts` 从基础色推导（灰阶、hover、alpha 标签、玻璃 tint、阴影、图表、diff、syntax）。几何 / 字体 / 圆角仍继承共享 macOS 系统，所以导入项永远是产品档，不会变成大胆档。TextMate scope 归并到现有 8 个 `--syntax-code-*` 桶。
- 完整性：映射器必须输出内置家族变体块拥有的全部 token（`VARIANT_TOKENS`，共 110 个），否则暗色主题的缺项会静默回退到浅色 macOS ramp；由单测逐 token 守卫。
- 持久化：Rust 侧 `imported_themes.rs` 每主题一个 `<id>.json`，落在 app data 目录的 `themes/`。id 是文件名安全 slug 且写入前校验，防止路径逃逸；`list` 跳过损坏文件、`delete` 幂等。命令：`pick_theme_source_file`（原生选择器 + 4 MB 上限 + 读取文本）、`list_imported_themes`、`save_imported_theme`、`delete_imported_theme`。
- 应用：`App.svelte` 用 `data-theme-family="imported-<id>"` 加一个动态 `<style>` 注入映射后的 token（值全部由 `parseColor` 归一化，主题原文绝不进入样式表），并按主题变体设置 `data-resolved-appearance` 与原生窗口外观。新增 `effectiveNativeTheme()` 统一解析，修复启动时原生外观可能被用户亮度偏好覆盖的问题；`storage` 事件跨窗口同步。
- UI 与说明：外观设置新增「导入的主题」区块——导入按钮、已导入列表（缩略图用主题真实色值内联）、悬停删除、错误提示，以及可展开的说明，覆盖支持类型（VSCode / Cursor / VSCodium 的 `*.json`，暂不支持 `.vsix` / `.tmTheme`）、下载渠道（VS Code Marketplace / Open VSX / 作者仓库）、获取方法（右键已安装扩展 → 显示于文件资源管理器 → `themes/*.json`）。
- 验证：新增 `lib/theme/vscodeTheme.test.ts` 10/10（解析、JSONC、变体推断、非法输入、映射值、110 token 全覆盖、注入安全、注入样式串、记录生成）；Rust `imported_themes` 6/6（id 校验、round-trip、损坏跳过、幂等删除）；全套桌面 mjs 守卫 258/258（含 `chat-ui.test.mjs` 247，原生外观断言已更新为 `effectiveNativeTheme`）；`svelte-check` 0 错误 0 警告；desktop vite build 通过。**真机 UI 冷启动走查未做**：需在 app 里打开设置 → 外观 → 导入一个真实主题 JSON，确认缩略图、切换、重启后仍生效、删除后回退。

### 调用链报告接入共享主题（2026-09-13，已交付）

- 背景：owner 反馈调用链弹窗看起来像独立页面、不遵守主题规范。根因：报告由服务端 `renderTraceReport` 生成独立 HTML，配色是自带硬编码调色板，只认 `light/dark`，不认主题家族；弹窗用沙盒 iframe 内联 `srcdoc`，父页无法把样式注进去，服务端也不该复制一份主题 ramp。
- 根修（共享层，不复制主题）：报告 CSS 改为读取应用语义 token 名并保留内置兜底——`--bg: var(--card-bg, var(--r-bg))`、`--panel: var(--surface-secondary, …)`、`--ink: var(--label-primary, …)`、`--line: var(--separator, …)`、`--blue: var(--accent, …)`、`--green: var(--online, …)`、`--purple: var(--skill-accent, …)`，并接入 `--font-ui / --font-mono / --fs-* / --radius-* / --syntax-code-*`。`TraceReportDrawer` 打开时读取 `getComputedStyle(document.documentElement)` 的实时值注入 iframe 的 `:root`，并监听 `data-resolved-appearance`、`data-theme-family`、`data-appearance`，切换家族即时重注入。公开发布的 R2 快照不注入，继续用内置兜底调色板（含明暗）。
- 观感：嵌入式隐藏报告自带的重复 `<h1>` 标题（弹窗头部已有「调用链」），保留 runId / 统计 / 时间线；字号、圆角、代码块都改吃应用 token，Win98 等主题下自动变方角、等宽与对应色板。
- 守卫：新增用例断言报告 CSS 逐 token 带兜底、drawer 注入实时值并在家族变化时重注入；删除过时的「只跟随 resolved appearance」断言，`--d-bg` 断言改为 `--r-d-bg` 与新 token 兜底。
- 验证：traceViewer 测试 12/12、`chat-ui.test.mjs` 247/247、`svelte-check` 0 错误、根 `pnpm build` 与 desktop build 通过；渲染冒烟确认输出含 token 兜底。

### 六款大胆主题家族（2026-09-13，已交付）

- 在既有 4 款产品家族（macOS / Rosé Pine / Catppuccin / Midnight）之外，新增 6 款「大胆」家族，每款都有明暗两个变体：Windows 98（Classic / Midnight）、终端（Paper / Phosphor）、野兽派（Poster / Night）、蓝图（Vellum / Diazotype）、System 6（1-bit White / 1-bit Black）、赛博朋克（Daylight / Midnight）。
- 改造范围不止配色：家族 token 块同时覆盖 `--font-ui / --font-display / --font-mono`、`--radius-*` 圆角刻度、`--soft-shadow / --float-shadow / --popover-shadow / --glass-*` 阴影与玻璃、以及 `--sidebar-material-tint / -filter`，因此能做出等宽 TUI、方块直角、硬偏移阴影、纯单色、完全不透明侧栏等现有产品家族做不到的形态。
- 数据面：`DesktopThemeFamily` 联合类型与 `DESKTOP_THEME_FAMILIES` 白名单（`lib/api.ts`）、10 项家族标签 + 12 项变体标签（中英 `lib/i18n.ts`）、`THEME_FAMILY_PREVIEWS` 预览项（`App.svelte`）。旧持久化值不受影响，未知值仍回退 macOS。
- 主题文件拆分（owner 要求，避免单文件膨胀）：共享系统（基础 `:root`、按明暗变化的玻璃层级、所有组件规则）留在 `styles.css`；每个家族独占 `apps/desktop/src/themes/<family>.css`，内含该家族的明/暗 token 块、系统深色侧栏覆盖与外观缩略图。`themes/index.css` 统一 `@import`，`main.ts` 引入 index。新增家族 = 新建一个文件 + 一行 import，不再往共享大表里追加；`styles.css` 从 8199 行降到 6759 行。
- Windows 98 3D 立体边（补齐）：按钮边框固定 1px、不读 `--soft-shadow`，token 层无法表达双色凸起，因此在 `themes/win98.css` 内用一层家族限定的规则实现——凸起/凹陷两套边由 `--win98-bevel-raised / -sunken` token 组合，明暗变体只换 bevel 颜色；作用于次要/主要按钮、分段控件按钮与输入框。危险态主按钮与聚焦态排除在外，不覆盖其语义色与焦点环。
- Windows 98 聊天输入框修复（owner 反馈「看不出是输入框」）：聊天输入区是 `.composer` 卡片里的透明 `textarea`（非原生 `<input>`），通用输入框规则没命中，整块灰底看起来像窗口而非字段；那圈淡紫边其实是基础聚焦态的 accent 光晕。现给 `textarea` 加 Win98 凹陷白色输入井（`--control-bg` 底 + `--win98-bevel-sunken`），高亮浮层同步 padding 保证 invocation 药丸与字形对齐；聚焦反馈改为边框加粗、去掉与 Win98 不搭的柔和光晕。
- 机器守卫：`chat-ui.test.mjs` 用例改为「家族必须在自己文件里、必须被 index 引入、每个家族必须有明/暗 token 块 + 三态缩略图」；新增断言「共享 `styles.css` 不得出现 `data-theme-family` 规则」与「win98 bevel 只允许存在于 win98.css」；`--agent-city-sky` 的期望值改为从 `agentCityScene.ts` 的 DAY_SKY / NIGHT_SKY 常量反查（此前错误地让新家族用自定义天空色，会在 Agent City 外壳边缘露出接缝）。
- 设计规范：DESIGN.md 区分「产品家族（只换颜色）」与「大胆家族（重写控件语言）」两档，记录 6 款家族的明暗变体表、主题文件布局，并注明 System 6 是「禁止纯黑结构面」规则的唯一记录在案例外。
- 验证：`node --test src/chat-ui.test.mjs` 247/247、`api.test.ts` 109/109、`svelte-check` 0 错误 0 警告、`apps/desktop` vite build 通过（构建产物含全部家族与 bevel）。**真机 UI 走查未做**：需在 app 里逐款切换，确认明暗态、窄宽与中英下的实际观感。

### Project 模式下 `/sessions` 列出并切换项目会话（2026-09-13，已交付）

- 背景：飞书/Telegram 在 `/project` 下输入 `/sessions` 仍列出 bot 本地会话，与 Project 无关；Project 会话（含 Desktop 创建的）无法从聊天里看到和切换。
- 根修（共享层）：渠道 scope 与 Project 的绑定 `channel_project_bindings` 新增可空 `conversation_id`（`ProjectStore.getChannelConversation` / `setChannelConversation`），把"用哪个项目会话"从隐式的 bot session 映射改为显式持久选择；切换项目（或退出）时若项目变化自动清空，重选同一项目保留。
- 路由：`ProjectAwareRunnerPool.resolveTarget` 读取 pinned conversation 传给 `getOrCreateConversation`，并把 runner key 的 `chatId` 改为会话自身的 `externalUserId`，与 Desktop/Web 路由一致，保证渠道和 Desktop 续写同一份 agent context。默认未 pin 时行为不变（仍取该 scope 最近会话）。
- 会话集合：`SessionStore.listSwitchableProjectConversations` 返回 Desktop Project 列表可见的会话，加上该渠道 scope 自己创建的 Project 会话（渠道会话以 `origin: "automation"` 落库，不会出现在 Desktop 普通列表，但必须能从自己的聊天切回）；`project:<id>` 的显式自动化归档不在其中。
- 命令行为：`/sessions` 在 Project 下展示「Current mode: Project · 名称 (id)」、当前会话（或 Auto）与全部项目会话，`/sessions <编号|id>` 设置 pinned conversation；`/new` 创建新的项目会话并 pin；`/delete_sessions` 在 Project 下提示到 Desktop 管理，不误删 bot 会话。中英双语。
- 验证：ProjectStore 绑定 round-trip（持久化 / 换项目清空 / 同项目保留 / 手动清空）、`listSwitchableProjectConversations` scope 过滤、`resolveTarget` pin 命中且 `chatId = externalUserId`、`/sessions`/`/new`/`/delete_sessions` 项目分支用例全过（58/58）；`tsc` 无新增错误（仅遗留的 `resolveRouteSummary(..., "vision")` 旧错误）。**真实渠道冷路径未走查**：需在飞书/Telegram 执行 `/project` → `/sessions` → 切换 → 发消息确认落到目标会话。

### 内置调用链插件（2026-09-13）

- 新增 Call Trace 插件：APP 回复菜单打开 HTML 调用树和时间瀑布图，展示模型、工具、耗时及 token；支持刷新与公开 R2 快照。
- 主运行的工具关联发起模型，内置子 Agent 的模型与工具关联到独立委派节点；回复保留实际 run ID，共享渠道发送记录平台回复 ID。查询和公开投影由共享插件能力提供，小程序留待单独实现。
- 审批请求记为等待，批准/拒绝/超时后由共享审批事件更新为成功/已阻止/已中断并记录等待耗时；审批层不依赖 trace 实现。
- 使用与数据边界见 [调用链报告](docs/guides/trace/call-trace.md)。外部 Agent 内部未上报数据和历史缺失关联不补猜，公开报告不含自由文本摘要。

### 输入框统计面板改为 Session 累计口径（2026-09-12，已交付）

- 背景：owner 反馈「最后一条回复显示 51.1k tokens，容量环却只有 2.49万」——两者都对但口径不同：回复下方是本轮全部模型调用的用量之和（含缓存读取，两次调用把共享上下文各计一次），容量环是最近一次请求的输入上下文。经比对用量页账本确认数字自洽（24,730 + 26,380 = 51,110；186 + 24,704 = 24,890）。按已确认的 [Session 用量需求](docs/requirements/session-usage-summary.md) 把输入框统计面板改成 Session 累计为主。
- 服务端：`AiUsageTracker.getSessionUsage(sessionId)` 按账本 sessionId 聚合（总/输入/输出/缓存读取/缓存写入 + `coverageStart` 覆盖边界）；`/api/sessions/[id]` 与 Project 会话详情路由随 transcript 返回 `usage` 汇总，账本读取失败返回 `available:false`，与真实零用量可区分。
- 桌面端：`ComposerContextMenu` 重排——「本会话累计用量」（总 tokens + 输入/输出/缓存读取/缓存写入 + 累计缓存命中率）为主区，「当前上下文」单列其下；进度环表达当前已使用上下文占用。usage 挂在会话 registry entry 上（entry 与 sessionId 绑定，后台会话刷新不会串到当前面板）；主 Chat 与 Project Chat 复用同一组件与口径，中英文案齐备。
- 口径修正：删除原「每轮命中率的算术平均」（平均缓存命中率 76% 这类数字），命中率改为累计缓存读取 / 累计完整输入（spec 验收口径 8,114/84,028 = 9.66%）；缓存读取/写入作为输入明细，不再与完整输入相加。
- 二次修正（同日，owner 提出一轮对话后累计与上下文"对不上"）：上下文一栏从「最近一次请求的输入」改为「**当前上下文**（已使用上下文）」= 最后一次请求输入（含缓存）+ 该次回复输出，即下一次发送的起点（真实案例 17,246 + 2,393 = 19,639，不再是孤立的 1.72万）。中间工具调用的输出已包含在最后一次输入内，回合聚合输出只带来每次几十 token 的正偏差；无快照旧会话退化为回合聚合用量对照模型配置窗口。配套解释了该轮累计 8.63万 的构成：一轮 6 次调用 = 首次尝试 3 次（最后一次空响应触发 `empty_response_retry` 整轮重跑）+ 重跑 3 次，gemini-3.8-flash-high 路由不回报缓存（命中率 0% 属实回报）。
- 验证：tracker 汇总测试 2 例（spec 验收数字 88,084/9.66% + 未知会话零值）+ presentation 测试 16 例（含 19,639 当前上下文场景）全过；desktop 测试链 297 + 守卫 255 全过（`presentation.test.ts` 顺带注册进测试链，此前不在链内）；svelte-check 0 错误；tsc 无新增错误；desktop 与服务端 build 通过。隔离实例冷启动冒烟：临时 DATA_DIR 起服务 → 建会话 → 注入账本记录 → API 返回累计 88,084 且排除他会话记录 → 重启后累计不变 → 全新会话显式零值。**桌面 UI 真机走查未做**：需在 app 里开面板确认布局（中英/明暗/窄宽）。

### 模型请求携带会话亲和头 x-molibot-session（2026-09-12，已交付）

- 背景：用户会话经 cli-proxy-api 调 opencode Go 路由的模型（如 deepseek-v4.1-flash-oc）每轮全部 400 `MissingSessionID`——opencode Go 要求第三方客户端带 `x-opencode-session`（每会话稳定 ID）用于会话粘性路由与提示缓存优化；同时用户在用量页看到的 0 token 记录即这些失败调用（失败无 usage 可报，但会话路径落库时未标记 error 状态，视觉上像"成功但 0 用量"）。
- 方案（owner 确认）：molibot 发自有通用头 `x-molibot-session: <sessionId>`，上游方言在代理层映射（cli-proxy-api 配 `x-opencode-session: "$x-molibot-session"`），molibot 不耦合任何单一上游的头名。
- 实现：注入点收在共享漏斗 `streamWithPiRuntime`——`options.sessionId` 存在时合并 `x-molibot-session` 头（`withSessionAffinityHeaders`，pi-ai 原生 `options.headers` 最后合并）；runner 主循环（含全部 fallback 候选尝试）与标题总结链路（conversationId 作为 sessionId）传入会话身份。无会话的调用（设置页连通性测试、owner 级助手）不带头，行为不变。
- 边界：图像识别引擎与 durable preflight 的 dispatch 暂未传 sessionId（当前无上游需要），后续有需要时同样只需在调用方传 `options.sessionId`；subagent 经 pi-agent-core 自有 Agent 实例分发，不在本漏斗内。
- 验证：新增 `piRuntime.sessionHeaders.test.ts` 3 例（带头/保留已有头/无会话不动）+ titleSummarizer sessionId 透传 1 例全过；runner.test 36/36、runnerHelpers 7/7、piTelemetry 3/3 回归全过；tsc 无新增错误。**端到端未验证**：需用户在 cli-proxy-api 配好映射并重启后跑一轮对话，确认 `model-errors.jsonl` 不再出现 MissingSessionID。

### 执行与权限保存失败修复 + 桌面 API 传输守卫（2026-09-12，已交付）


- 用户反馈「执行与权限」设置保存永远显示「保存失败，请重试。」。根因：`ExecutionPermissionsSection.svelte` 是全仓库唯一绕过共享 api transport、直接用原生 `fetch` 调 sidecar 的组件——桌面 webview 源是 Tauri 自定义协议、sidecar API 在 `http://127.0.0.1:<port>`，原生 fetch 属跨源请求且 sidecar 不带 CORS 头：PATCH 的预检（OPTIONS 405）必挂，GET 响应同样不可读但被 `.catch(() => undefined)` 静默吞掉（页面显示的「已保存模式」从未真正加载过，一直显示代码初始值）。curl、服务端直测、同源浏览器全部通过，唯独 app 内必挂，因此 issue #49 的服务端验证没拦住。
- 修复：`api.ts` 新增 `saveDesktopExecutionDefault`（走 `requestJson`/`fetchFromDesktop`，Tauri 内自动切 HTTP plugin 由 Rust 侧发请求），组件加载/保存两处全部换成共享 helper；加载失败从静默吞掉改为可见错误横幅（与 sandbox 加载一致）。服务端 `/api/desktop/execution-default` 无需改动（curl 直测 GET/PATCH 全链路正常）。
- 机器守卫：新增 `apps/desktop/src/api-transport-guard.test.mjs`（注册进 desktop test 链），禁止 `lib/api.ts` 之外任何源码直接调用 fetch（负向验证过能拦住修复前的写法）；`api.test.ts` 新增 execution-default PATCH 传输契约用例（方法/路由/body）；CLAUDE.md Recurring Pitfalls 补条目（首犯即配守卫：此类故障在浏览器/服务端测试里完全不可见）。
- 验证：`svelte-check` 0 错误 0 警告、desktop mjs 测试 255/255（含新守卫）、`api.test.ts` 109/109、desktop vite build 通过、运行中服务直测 GET/PATCH 正常。**真实桌面 webview 冷路径走查未完成**：computer-use 缺辅助功能/屏幕录制授权无法驱动真实窗口；修复代码已在运行的 dev 实例（vite 1420）上，手测路径：设置 → 执行与权限 → 切换模式 → 保存修改，应显示保存成功且重进页面保持所选模式。

### Chat 玻璃材质透明度整体加强（2026-09-12，已交付）

- 用户反馈输入区上方弹层（已排队栏 + 悬浮输入卡）透明感不足、接近不透明卡片。根修在共享玻璃 token 层：整条密度带下移 8 个点——`--glass-surface-bg` 74%→66%、`--glass-popover-bg` 80%→72%、`--glass-chrome-opacity` 80%→72%，所有玻璃表面（卡片、菜单、药丸、工具栏、输入卡及其上方条带）统一变透，材质体系保持单一；磨砂模糊（28–40px）与饱和度提升不变——DESIGN.md 约定可读性来自磨砂而非密度，降密度不损文字可读性。全部数值仍在守卫区间（65–92%）内，降透明度/低性能/高对比度的不透明降级不变。
- 同步更新 DESIGN.md「Chat glass materials」记录的密度值。
- 验证：`chat-ui.test.mjs` 全绿（含玻璃密度带守卫、popover>surface 层级守卫、模糊/饱和度下限守卫）、desktop vite build 通过；冷启动实测透明观感未做，建议在明暗主题下各看一眼弹层与菜单。

### 上下文面板圆环触发器 + 缓存无数据显示 + 排版放宽（2026-09-12，已交付）

- 触发器从折线图标改为**进度圆环**：一圈 = 上下文窗口的 100%，蓝色弧线即当前占用百分比，不开面板就能直观看到还剩多少容量；无数据时为空环。
- 缓存命中率 0% 的排查结论：取值与统计均正确——用户会话的每条调用上游（cli-proxy-api）确实报了 cacheRead=0（同一模型走 Telegram 的调用有命中，证明链路映射无损；web 图片类负载上游隐式缓存未命中）。显示规则（按用户要求）：只要会话有用量的调用，缓存命中率**常驻显示**，0% 也如实展示；仅完全无用量（全新会话）时空态隐藏。
- 弹层排版放宽：面板 300→320px，内边距 12/14→14/16，区块间距 10→12px，分类行距 7→9px，缓存行上边距 10→12px。
- 验证：presentation 单测 14/14（新增全零缓存→null 用例）、svelte-check 0 错误、desktop build 通过；harness 实测圆环弧线（26%）、空环、放宽后面板排版（明暗主题）。

### 用量账本增加会话维度（2026-09-12，已交付）

- 落地"用量控制统一走用量账本"的第一、二步（不新造第三种统计维度）：`AiUsageRecord` 增加可选 `sessionId`（会话 id），runner 的账本记录点带上当前会话；Mini App、assistant 等非会话调用不携带该字段。聚合层 `buildDesktopUsageSummary` 的 rankings 新增 `sessions` 维度（只统计携带会话 id 的记录），用量页排行榜新增"会话"tab，按所选时间范围与筛选条件展示每个会话的请求数/token 明细，按总量排序。
- 定位澄清：这个维度记的是真实消耗账，供后续 session 级限额/预算闸门读取；与转写消息上的 usage、上下文面板的分类构成快照各司其职，不互相替代。历史记录（本功能上线前）无 sessionId，不出现在会话排行中。
- 验证：账本 JSONL round-trip 用例（带 sessionId 存取、不带时字段缺席）+ 聚合会话分组用例（7 天窗口合计、today 窗口、非会话记录排除）全过；runner/api/steer 146 测试、svelte-check 0 错误、desktop build 通过。排行榜会话行目前显示会话 id，标题联动（跨渠道按 id 解析会话标题）留作后续打磨。

### Chat 输入框上下文用量面板（2026-09-12，已交付）

- Chat 与 Project 会话的输入框底栏（模型选择器左侧）新增上下文用量仪表：图标触发器常驻，弹出只读玻璃面板，展示上下文容量（已用/窗口 + 百分比 + 进度条）、六类占比明细（消息 / MCP 工具 / 系统工具 / 系统提示词 / 技能 / 其他）与平均缓存命中率；中英文案、明暗主题、reduced-transparency 降级齐备。数据分两档降级：有分类快照（本功能上线后产生的新回复）显示全部内容；历史会话无快照时用消息上的真实 usage + 所选模型配置的上下文窗口渲染容量条与命中率、隐藏分类行；完全无 usage（全新会话）显示"收到回复后展示"空态提示。注意数据源不是「用量」页的全局聚合（无会话维度、无分类信息），而是每条 assistant 消息自带的真实 token 报告 + dispatch 时服务端的分类估算。
- 数据链路（共享层一条线）：runner 在每次 dispatch 的 `streamFn` 里复用 preflight 估算器算出分类明细（`estimateContextBreakdown`，技能按 `<available-skills>` 区块从系统提示词中拆出、工具按 `mcp__` 前缀分 MCP/内置）；assistant 消息落盘时（`message_end` → `appendContextMessage`）把估算与该次调用真实报回的 input/cacheRead/cacheWrite 合成 `SessionContextSnapshot` 挂到 session entry 上（不进模型上下文）；投影层把快照带到 assistant 消息，`/api/sessions/[id]` 透传，前端 `deriveComposerContextUsage`（presentation.ts）取最后一条快照、用该次调用自身的 input 侧当已用量（回合聚合 usage 会重复计入共享上下文，不可用），缓存命中率取每次调用命中率的均值。
- 验证：估算器/投影/落盘 round-trip 新增 4 个回归用例 + `presentation.test.ts` 4 个新用例全过；服务端 core+session 185、store+api 125、桌面 291、UI 守卫 245 全绿；`svelte-check` 0 错误（含修复了此前工作区遗留的 ChatView 3434 prop 未声明错误）；desktop vite build 通过。隔离 harness 实测明/暗主题与降透明度渲染（面板结构、锚定、数据与参考设计一致）；真实桌面冷启动 + 真实模型调用的端到端走查未做（新快照在下次真实对话的首个回复后出现）。

### 项目设置弹窗按钮回归全局扁平样式 + 共享 Button 组件 + 弹窗 scrim 磨砂（2026-09-12，已交付）

- 用户反馈项目设置弹窗按钮（保存/取消/添加命令）是"四不像的业态玻璃"：根因是 `.project-settings-modal` 专属覆盖把全局按钮改造成 38px 药丸 + 内嵌高光 + 柔和投影，与全局 32px 扁平按钮（纯色主按钮/描边次按钮）完全脱节。根修：删除该覆盖及配套的 38px 搜索框高度，弹窗内按钮/控件直接吃全局样式。
- 新增共享 `components/ui/Button.svelte`（variant: primary/secondary、danger、class 透传、submit 支持），渲染全局 `.primary-button`/`.secondary-button` 类；ProjectSettingsDialog 的取消/保存/添加命令改用组件。样式源仍是全局 CSS 单一来源，组件只是规范入口；其余面板逐步迁移即可，任何面板再想分叉按钮样式都被守卫拦住。
- blur 效果落在共享 Dialog 层而非按钮上：新增 `--glass-modal-filter`（popover 档 blur(28px) saturate(190%)），`.desktop-dialog-overlay` 组合 `--modal-scrim` + 磨砂，所有弹窗统一获得"背景结霜、面板不透明"的层次；reduced-transparency 下降级为 none。DESIGN.md「Chat glass materials」已补条目。
- 验证：桌面结构测试 254/254（含新增守卫"弹窗不得分叉全局按钮样式"）、`svelte-check` 0 警告（仅存 1 个与本次无关的既有错误：ChatView.svelte:3434 `composerContextUsage` prop，来自工作区未提交的 ChatInputArea 改动）、desktop vite build 通过。运行中桌面的冷启动冒烟走查未完成，建议实际打开项目设置核对按钮观感与弹窗背景磨砂。

### 项目设置「自动任务」标签字号回归标准字阶（2026-09-12，已交付）

- 用户反馈项目设置弹窗的「自动任务」标签字号偏大。分析确认不是硬编码像素，而是 9 月 6 日 fixed-size project settings dialog 提交引入的一层 `.project-settings-modal` 专属覆盖：卡片标题 19px（`--fs-section`）、预览/摘要/页脚 14.5px（`--fs-body-lg`）、外加 0.3–0.6px letter-spacing——这 19/14.5 两档是 styles.css 自造刻度，DESIGN.md 字阶里不存在；而同弹窗「常规」标签用 `--fs-label`(13px)，与全局任务页也不一致。
- 根修：删除该字号覆盖层（含详情标题与按钮字号的特例），弹窗内自动任务回落到共享 automation 样式的标准 token（标题 `--fs-title` 15px、正文/摘要 `--fs-meta` 11px、按钮 `--fs-label` 13px），与全局任务页及「常规」标签同一字阶；保留弹窗的阴影、圆角、38px 控件等视觉处理，不受影响。
- 验证：`chat-ui.test.mjs` 243/243（含字阶守卫与 11px 下限守卫）。运行中桌面的冷启动冒烟走查未完成，建议实际打开项目设置 → 自动任务核对。

### 思考档位选择器对齐与可读性修复（2026-09-12，已交付）

- 恢复档位按钮的定位样式类，刻度均匀分布，选中圆点和焦点显示在滑块上方。标题与当前档位左右对齐，轨道下方显示首尾档位；支持点击及左右方向键切换。
- 根因是样式绑定遗漏。原有菜单角色测试没有覆盖按钮定位类，现已补上回归检查；未新增长期规则。
- 验证：桌面 UI 测试 243/243，svelte-check 0 错误 0 警告，desktop build 通过；隔离控件实测中文、英文、点击与方向键。完整桌面冷启动、Session 切换、服务中断恢复、暗色主题和真实移动视口走查未完成，浏览器主界面停在本地服务发现阶段。

### Chat 输入区下拉菜单与发送按钮密度收紧（2026-09-12，已交付）

- 用户反馈权限模式菜单与模型菜单行高过于稀疏、发送按钮偏大。`styles.css` 收紧：权限菜单选项改为两行布局（名称一行、提示一行，图标与勾选对齐首行，提示用 meta 字号次级色），菜单通用行 42→34px、模型列表行 36→28px，provider 分组头/分隔/页头间距同步收紧，来源脚注 padding 收窄。
- 发送按钮 32→28px，图标 `--icon-md`→`--icon-sm`，与输入区其它 28px 控件对齐。
- 模型下拉改为参考图式弹窗：思考档位从二级列表改为弹窗首页的横向轨道选择器（当前档位名居中 + 轨道圆点 + 滑块，点击/方向键直接切档，不关菜单）；「思考档位」二级页删除，仅保留模型选择二级页。
- 模型下拉列表乱序（跟随 provider 配置出现顺序）：共享层 `groupModelOptions`（presentation.ts）改为两级字母排序——分组按 provider 显示名、组内模型按显示名（`localeCompare` + `numeric`，Kimi K2.7 Code 正确排在 Kimi K3 前）；同时作用于 Composer 模型菜单、设置模型页和 Mini Apps AI 设置三处消费方。
- 验证：`presentation.test.ts` + `modelSelection.test.ts` 10/10（新增两级排序守卫用例）、`chat-ui.test.mjs` 242/242、`svelte-check` 0 错误 0 警告、desktop vite build 通过；横向轨道的真实点击/键盘走查未做（需运行桌面实例），结构由既有 `role="menuitemradio"` 契约用例钉住。

### Chat 页图标切换 Reicon Duotone 字重（2026-09-12，已交付）

- Chat 页 20+ 组件的图标 chrome（侧栏导航/搜索/折叠、会话行悬停操作、输入区附件/录音、发送/停止、权限与模型菜单、分组头、会话搜索、转写工具栏、技能面板、Agent 城市工具栏、记忆抽屉、header 小程序快捷菜单等）从 Outline 切换为 Reicon 官方 Duotone（`currentColor` + 50% 次层，主题继承）；项目会话视图的 header（搜索/文件面板/设置）与文件树复制、项目重命名/删除菜单、会话标题编辑一并跟随。
- 用户逐项指定的字形：发送→`plane2-duotone`、附件→`paperclip-duotone`、技能→`reorder2-duotone`、Agent→`vacuum2-duotone`、header 小程序→Grid 的 duotone（squares）、设置入口→`tuning-square2-duotone`、计划模式→`circle-arrows-down-duotone`、手动模式→`handshake-duotone`、全部小程序 CTA→`list-duotone`；其余 chrome 图标用精确 duotone 或目检过的同概念替代（CalendarDays→calendar、More→more-h、EyeSlash→eye-closed、ThumbsUp→like、PenLine→pen2、MagicWand→wand3、Files→docs、Video→camera-record、Crosshairs→target、TriangleWarning→alert-triangle 等）。小程序快捷菜单的行箭头（ArrowRight）与收藏星标（Star）同为 duotone；`StarOff` 无官方 duotone 字形，按回退规则保留线性。
- 生成管线扩展：`scripts/generate-duotone-icons.mjs` manifest 为唯一采用入口（当前 71 项），并新增产出 `apps/desktop/src/lib/icons/duotone/components/<Name>.svelte`（与 reicon-svelte 同 props 契约，`weight` 接受但忽略），组件仅由脚本生成、随 manifest 增删同步清理。
- 字重边界（DESIGN.md Foundations 已更新）：duotone 覆盖展示位与 chat 页图标 chrome；无官方 duotone 的字形（Check/X/Plus/Minus/箭头/加载等）、对话流内状态信号（成功/失败/警告标记、activity 工具类型 14px 行内图标）与 XCircle（与设置页搜索清除保持一致）保留线性 Outline。
- 验证：`svelte-check` 0 错误 0 警告、desktop vite build 通过、UI 契约测试全绿（GroupHeader 守卫断言同步到 duotone import）、隔离预览实例实测侧栏五枚导航图标、发送/停止按钮、项目会话 header、小程序快捷菜单（搜索/行箭头/星标/全部小程序 CTA）渲染正常；完整桌面冷启动走查未做。

### 对话 Header 标题优先（2026-09-12，已交付）

- 普通 Web 对话仅显示标题；外部对话在标题后以次级文字显示完整渠道名称，取消首字母胶囊和斜杠。
- 项目 Header 先显示会话标题，项目名作为后置次级文字；移除斜杠和项目类型标签。长标题和来源在各自宽度内截断，沿用明暗主题 token 与原生窗口拖动区域。

### 会话右键菜单脱离侧栏层级（2026-09-12，已交付）

- 会话菜单与关闭遮罩使用 Bits UI Portal 挂到 `body`，完整覆盖聊天区域，不受侧栏的裁剪或层叠上下文限制。
- 根因属于 CSS 层级隔离。此前的材质守卫只排除了 `backdrop-filter`，未覆盖侧栏自身的 stacking context；新增 Portal 结构守卫，并用真实 ConversationRow 组件验证右侧菜单项的命中结果由聊天面板变为菜单项。

### 侧栏右键菜单被裁剪修复：侧栏玻璃材质移到 ::before 层，fixed 菜单浮回最上层（2026-09-12，已实现）

- **症状**：左侧会话列表右键菜单（重命名/复制 session 路径/删除等）在侧栏右边缘被硬裁掉，菜单右半截不可见（用户截图圈出）。
- **根因**：在途玻璃材质改动把 `backdrop-filter`（`--sidebar-material-filter`）直接挂在 `.chat-sidebar` 元素上。带 `backdrop-filter` 的元素会成为 `position: fixed` 后代的 containing block 并以自身 `overflow: hidden` 裁剪它们——于是按视口坐标定位的 `.row-menu` 被困在侧栏盒子里，超出侧栏宽度的部分全部被裁。降级模式（低性能/减弱透明度）下 filter 为 none，菜单反而正常，行为随模式漂移。同机制也影响侧栏内其它 fixed 浮层（如 `.row-menu-backdrop` 只盖住侧栏而不是全窗）。
- **修复**：侧栏材质移到 `.chat-sidebar::before` 层（元素本身 `background: transparent` + 显式 `z-index: 0` 提供 stacking context——原 backdrop-filter 本就隐式创建了 stacking context，浮层与悬浮 chrome 的层序不变）；三处降级覆盖（低性能/减弱透明度/提高对比度）同步改指向 `::before`。合成结果不变：backdrop 采样内容与「先模糊后叠 tint」的顺序都与原来一致。
- **机器守卫**：`chat-ui.test.mjs` 侧栏材质用例改为钉住新结构——`.chat-sidebar`/`.settings-sidebar` 元素本体禁止出现 `backdrop-filter`（不跨花括号的精确正则）、材质/降级覆盖必须落在 `::before` 层；顺带修正三处钉住旧结构的断言。
- **验证**：`chat-ui.test.mjs` 240/240、`svelte-check` 0 错误、desktop vite build 通过；无头 Chrome 加载真实 `styles.css` 的结构 harness 截图确认菜单完整浮出侧栏边缘并盖在聊天区之上，「去掉 ::before」对照像素 diff 42%（材质层确认在渲染）。

### 运行状态胶囊与进度卡片去重：思考流式输出时不再叠显示「Thinking...」（2026-09-12，已实现）

- **症状**：回合运行中，状态玻璃胶囊显示硬编码英文「Thinking...」，紧挨其下「运行进度」卡片里就是正在流式输出的思考过程原文——同一件事上下说两遍（用户截图圈出）；中文界面里还混入英文文案。
- **根因**：SSE 桥接层（`src/routes/api/stream/+server.ts`）把频道适配概念照搬成了文本帧：`setTyping(true)` 写死发 `status: "Thinking..."`，`respond(text, false)` 把工具/子代理进度以 `_→ label_` 文本帧发出；而这些信息在桌面端已经全部通过结构化事件（`thinking_delta`、`runner_event` 的 activity）渲染进过程卡片。Web 端从未消费 `status` 帧，只有桌面端把它显示成胶囊文本。
- **修复**：SSE 路径不再发出任何文本 `status` 帧（`setTyping` 置空、`respond` 非 log 分支不再写帧——打字指示是频道适配器概念，SSE 客户端有自己的阶段胶囊与思考卡）；桌面端删除死掉的 `onStatus`/`status` 帧处理；状态胶囊只在「已发送但过程卡片尚无内容」的空窗期显示（本地化阶段文案：正在执行…/识别图片中…等），思考或工具活动一旦出现即由卡片接管，胶囊隐藏。
- **机器守卫**：`chat-ui.test.mjs` 新增契约用例——胶囊必须被 `!liveSections.process.length` 门控、`conversationTurn.ts` 与 stream 路由不得再出现 `status` 帧；删除守护旧通道的过时用例。
- **验证**：桌面 tsx 批次 281/281、UI 契约批次 250/250、`test:desktop-chat` 289/289、stream 路由 3/3、`svelte-check` 0 错误、根 Web 与 desktop vite build 通过。**未做**：真实模型回合的冷启动走查未执行（需中断在用服务并消耗真实调用），胶囊隐藏逻辑由契约用例钉住。


### 液态玻璃位移撤回：玻璃材质统一到 --glass-* 三档体系，面板直边恢复（2026-09-12，已实现）

- **症状**：顶栏底边、底部悬浮输入卡与各玻璃卡片的边缘呈缓慢波浪线（用户截图），不是直线。
- **根因**：在途的液态玻璃改动把 `feTurbulence+feDisplacementMap` SVG 滤镜经 `filter: var(--liquid-glass-distortion)` 套在 9 处材质层（`::before`）上；CSS `filter` 作用于图层自身渲染的全部内容（含边缘），低频噪声把直边推成 ±12px 波浪。
- **方案取舍**：把位移挪进 `backdrop-filter`（只扭曲透过的背景、保住直边）是标准做法，但离屏 WKWebView 四样张实测证明 WebKit 对含 SVG `url()` 的 backdrop-filter **整链丢弃**（解析通过、`CSS.supports=true`、`@supports` 探测不到），连 blur 都不剩；Chromium 是唯一支持方。用户拍板：简化为纯磨砂（blur+saturate）。
- **修复**：9 处材质层的位移滤镜全部移除；连同 `LiquidGlassFilters.svelte`、`--liquid-glass-*` 双主题变量、styles.css 末尾一处 `TEMP DIAGNOSTIC v2` `!important` 覆盖一并删除；被同一改动改成第二套体系的面板（chat-header、composer、plan-card、thinking-card、file-menu、prompt-navigation-preview、row-menu）统一回归守卫描述的 `--glass-*` 三档材质（surface 74%+blur32 / popover 80%+blur28 / chrome 80%+blur40 + 边缘高光 + 双档阴影）；进行中推理（thinking-card）为玻璃卡、完成态（turn-process）维持无边框透明折叠条。
- **机器守卫**：既有 `chat-ui.test.mjs` 玻璃材质/密度/降级/backdrop-root/turn-process 守卫全数恢复通过——本问题正是该改动违反这批守卫所致（5 条红用例）；CLAUDE.md 新增 pitfall 48（滤镜扭曲承载层直边；WebKit 对 backdrop-filter 含 SVG 引用整链丢弃、`@supports` 探测不出）。
- **反馈追加（同日）**：`turn-files-card` 文件结果卡接入 popover 档材质（`--glass-popover-bg` + blur28，与输入框同色），不再隐入背景；导航预览卡 blur 失效根因为导航主机 `opacity:.38/.72` 构成 backdrop root（预览卡只能采样空内容、整卡还被压淡），透明度移至标记子元素后预览恢复全不透明度 + 真实磨砂；文件行图标从通用 File 换成按扩展名的文件类型图标 + 仓库语言色（复用 `fileIcons`/`fileKindIcons` 体系，与文件面板、工件面板一致，`.turn-file-row > .reicon` 读 `--file-color`）。
- **验证**：桌面 node 批次 250/250、chat-ui 240/240、tsx 逻辑批次 199/199、`svelte-check` 0 错误、vite build 通过；离屏 WKWebView（与桌面壳同引擎）对真实 dev server 与磨砂材质 harness 截图，确认 header/composer/卡片/菜单边缘均为直线、磨砂与边缘高光正常。**未做**：正在运行的 v2.9.47 实例仍是旧构建，需重建重启后才能看到新材质（未主动中断在用服务）；cargo 批次未跑（本次未触 Rust 代码）。

### 自动任务会话视图修复：工具轨迹可见、等待审批语义诚实、弹窗布局不再塌陷（2026-09-12，已实现）

- **症状**：自动任务页「会话」弹窗里，Project 定时任务（每日 08:30 AI 日报）只显示一条 EVENT 输入、没有任何输出；Telegram 定时任务（08:00）的会话里 assistant 回复渲染成空气泡加一条竖线；执行历史把卡死在审批上的运行记成「已完成」。
- **根因（三个独立问题叠加）**：
  1. **输出真空**：`buildDesktopTaskSessionMessages`（`src/lib/server/app/desktopTasks.ts`）只保留带文本的 user/assistant 消息，toolCall-only 的 assistant 消息和 toolResult 全部被过滤。08:30 那次运行真实执行了（拉日报、写文章、跑构建），最后一步 `host_build_file` 触发 Host Bash 审批后以 `stopReason=waiting_for_approval` 挂起，最终文本从未产生——transcript 里只剩工具调用记录，再被过滤就只剩输入。
  2. **状态说谎**：`events.ts` 的 `runLeasedEvent` 只要执行函数正常 resolve 就 `markCompleted`，不区分 `waiting_for_approval`；挂起请求 1 小时 TTL 过期后被删除，运行永远无法恢复，UI 却报「已完成」。
  3. **布局塌陷**：`.task-session-detail` 是 flex column，`.message-row` 自带的 `margin: 0 auto` 使 stretch 失效，`width: auto` 让行 shrink-to-fit；assistant 回复是整块 ```` ```txt ```` 代码块（`pre` 是 `min-width:0` 的滚动容器），被压成约 1 字符宽、一字一行的「竖线」。
- **修复**：
  1. 会话投影保留工具轨迹：一次运行投影为一个 assistant 轮次，toolCall/toolResult 配对成 `DesktopConversationActivity[]`（label 取 arguments.label、结果文本截断为 summary、时长/错误态齐全，无结果的调用闭合为 error），thinking 依旧不外泄、工具参数永不进 summary；客户端 `normalizeDesktopTaskSession` 透传 activities，纯活动消息（无文本）不再被丢。配合前端现成的 `TurnProcess`/`RunActivity` 渲染成「过程 + 答复」。
  2. 租约新增 `waiting_approval` 终态（`markWaitingApproval`）：运行挂起时租约记等待而非完成，定时器的 run-lock 照常释放（排程继续）；桌面契约与中英文案（等待审批 / Waiting for approval）与状态色同步补齐。
  3. 无人值守运行（isEvent + fresh 的自动化事件）不再挂起成僵尸：Host Bash 在创建审批请求前直接拒绝（`unattendedDenials`，父运行与子代理同享），通用 broker 路径经 `onApprovalRequest` 新增的 `"deny"` 处置拒绝且不落请求；模型拿到明确的拒绝文本后继续执行并在最终答复里报告被跳过的步骤。挂起语义本身（issue #48）对有人值守的会话保持不变，durable 尝试的 defer 也不受影响。
  4. `.task-session-detail .message-row.assistant { width: 100% }`：assistant 行保持全宽横向滚动，只有用户行收缩。
- **机器守卫**：`desktopTasks.test.ts` 4 条投影用例（文本提取、活动配对、挂起运行可见且参数不泄漏、legacy JSON 块）；`api.test.ts` 活动透传用例；`eventsLeaseStore.test.ts`/`events.test.ts` 挂起租约记 `waiting_approval` 且 run-lock 释放；`bashApprovalWait.test.ts`/`toolRuntime.test.ts` deny 处置不终止循环、不落请求；`chat-ui.test.mjs` 结构断言禁止 assistant 行 shrink-wrap（pitfall 16c 的第二次出现，守卫成为必选项）。
- **验证**：相关服务端套件 92/92、`test:desktop-chat` 289/289、`test:projects` 83/83、`test:service-bootstrap` 21/21、`svelte-check` 0 错误、SvelteKit 与 desktop vite build 通过；用真实落盘的 08:30 运行归档跑新投影，输出「输入 + 6 条工具活动（含审批请求摘要）」；空气泡用无头 Chrome 加载真实 `styles.css` 与真实数据做了修复前后截图对比。**未做**：本机正在运行的服务（v2.9.47）仍是旧构建，需重建重启后弹窗才会呈现新投影与等待审批状态（未主动中断在用服务）；工作区中在途的液态玻璃改动自带 5 条 `chat-ui.test.mjs` 失败用例，与本次改动无关。

# Molibot Features

### Chat 界面全量落地 macOS 液态玻璃效果与深浅色模式深度调优（2026-09-12，已实现）

- **背景与目标**：基于 Lucas Romero 的 macOS Liquid Glass 物理光学模拟效果，将 Chat 核心界面的浮动与交互层全面改造为高质感的液态玻璃材质，并深度兼容与优化暗色模式。
- **全局 SVG 滤镜 (`LiquidGlassFilters.svelte`)**：
  - 在 `App.svelte` 根部挂载不可见的全局 SVG Filter 定义。
  - **浅色滤镜 (`#liquid-glass-distortion`)**：基于 `feTurbulence` (0.002 0.006) + `feSpecularLighting` (#ffffff 光源) + `feDisplacementMap` (scale 24)，营造通透清澈的边缘微扰折射。
  - **暗色滤镜 (`#liquid-glass-distortion-dark`)**：降低折射 scale (16)，采用微蓝紫冷调光 (`rgb(210, 225, 255)`)，调高 `specularExponent` (120)，彻底消除暗色背景下高光粗糙泛白的问题。
- **5 个重点场景的全面落地**：
  1. **右键菜单弹出窗口**：正文与代码/文件右键菜单（`.file-menu`）改用液态玻璃背景与多层边缘内高光。
  2. **Chat 多轮对话预览**：右侧定位时间轴悬停预览卡片（`.prompt-navigation-preview`）接入液态折射光泽与景深阴影。
  3. **左侧 Session 会话右键菜单**：会话操作弹窗（`.row-menu`）加入液态材质与高光边缘。
  4. **状态气泡与思维卡片**：运行状态进度条外壳（`.turn-process`）与思维链展开卡片（`.thinking-card`）接入统一的液态玻璃微质感。
  5. **审批计划卡片与顶部/底部悬浮条**：计划决策卡（`.plan-card`）、顶部浮动标题栏（`.chat-header`）与底部悬浮输入框外壳（`.composer`）全面升级为液态玻璃微光折射层。
- **机器守卫与验证**：
  - `svelte-check` 0 错误 0 警告。
  - `vite build` 生产打包测试通过。
  - `chat-ui.test.mjs` 248/248 项用例全绿通过。

### 剪贴板粘贴图片：名称唯一化 + 截图多格式表示只留一张（2026-09-12，已实现）

- **症状**：粘贴截图时输入框出现两个附件，两个都叫 `image.png`；连续粘贴两张图时两次都叫 `image.png`，附件条上无法区分，也担心上传落盘时互相覆盖。
- **根因**：`clipboardImageFiles` 只对**空文件名**做多格式去重（原注释「Safari 的 png+tiff」），其余条目一律原样透传。而 macOS 的截图剪贴板里同一张图以 9 种格式存在（`screencapture -c` 后 `osascript -e 'clipboard info'` 实测：PNGf/AVIF/8BPS/GIF/jp2/JPEG/TIFF/BMP/TPIC），WebView 为这些**剪贴板数据**条目生成的占位名是 `image.<ext>`——名字非空，于是 png 与 tiff 两个条目都被当作「两张不同的图」收下；同理，两次粘贴的截图都拿同一个占位名。占位名不携带身份信息，不能用来判断「是不是两张图」。
- **根修（共享 helper）**：`clipboardImageFiles` 按**名字能否证明身份**重新分组。空名或匹配 `image.<ext>` 占位形态的条目是「同一张图的格式表示」，只保留优先级最高的一种（png > jpeg > webp > gif > 其它）；带真实文件名的条目是独立的文件，全部保留。另外：粘贴板同时给出真实文件和它自己的字节副本时（Finder 复制图片即如此），保留文件、丢弃表示，避免同一张图出现两个附件。命名上，表示条目按会话内递增序号命名为 `image-1.png`、`image-2.png`（连续粘贴不再重名，序号循环跳过本次已用名），真实文件名原样保留、仅在同一次粘贴内重名时追加 `-2`、`-3`。所有分辨率的扩展名按 MIME 取（tiff 不再被错标成 `.png`）。
- **机器守卫**：`api.test.ts` 7 条剪贴板用例——文本/PDF 项不受影响、多格式表示只留一张、截图 `image.png`+`image.tiff` 只留一张、连续两次粘贴得到不同名字、多文件粘贴各自保名、真实文件优先于其字节副本、同一次粘贴内重名文件互不覆盖。
- **验证**：`api.test.ts` 107/107、`chat-ui.test.mjs` 236/236、`svelte-check` 0 错误 0 警告、`vite build` 通过。**未做**：真机粘贴走查（本环境无法自动按键，`osascript` UI scripting 未授权），`image.<ext>` 占位名是按 WebKit 行为建模并用剪贴板实测格式列表佐证的，需在桌面端真实粘贴一次确认。

### Chat 页 macOS 化：液态玻璃材质体系 + 悬浮工具栏/输入框（2026-09-12，已实现）

- **背景**：chat 页此前所有浮层都是同一张不透明 `--card-bg` 卡片加一档阴影，弹窗、审批、计划、思考态都没有材质层次，整体观感偏 Web。工作区里已有一份上次中断的半成品：`DESIGN.md` 的 `§Chat glass materials` 契约与 `styles.css` 的六个 `--glass-*` token 都已写入，但**全仓 0 处引用**——契约落地了，屏幕上一个像素没变。本次把材质真正接到表面上并补齐契约未覆盖的部分。
- **材质接线**：审批/决策卡、计划卡、composer 及其上方整叠条（排队消息、待发附件、录音条、编辑条、无模型提示、错误条）、顶栏、运行态胶囊，以及全部 chat 浮层菜单（模型/权限菜单、斜杠建议、溢出菜单、命令面板、Mini Apps 快捷菜单、提问导航预览）统一走 `--glass-surface-bg` / `--glass-popover-bg` + `backdrop-filter` + `--glass-edge`；大面（卡片、composer）用 30px 模糊与 float 档阴影，小件用 24px 与 chip 档——大面读作更厚。静态区（正文、气泡、侧边栏、设置）保持不透明。
- **不透明度是清晰度下限，不是口味**：首版按 78% 配，弹窗盖在转写上时文字看不清，观感就是「纯半透明」而不是磨砂。macOS 承载文字的材质（popover/menu/toolbar）实际是 90–97% 不透明——磨砂感来自「很重的模糊 + 很低的透出量」，不是让内容透过来。现为：大面 90%、承载文字的小菜单与胶囊 93%、悬浮 chrome 92%，模糊 24–36px；上下限都写了守卫，防止再次漂移。
- **backdrop root（本轮真正的根因）**：`backdrop-filter` 会让元素成为 backdrop root，其子孙的 `backdrop-filter` 只能采样该 root 内部的内容（Filter Effects §Backdrop Root）。材质加在 `.composer` 与 `.chat-header` 上之后，正好把最常用的一批弹窗的模糊杀掉了——模型菜单、权限菜单、斜杠建议在 `.composer` 里，Mini Apps 快捷菜单在 `.chat-header` 里，它们都悬停在父级盒子之外、转写上方，于是在父级里找不到任何可模糊的内容，退化成纯半透明、下面的字原样透出。修复：把这两个父级的 `background` + `backdrop-filter` + `box-shadow` 整体挪到 `::before` 层（元素本身不再产生 backdrop root），并给宿主 `z-index: 0` 提供 `z-index: -1` 所需的层叠上下文——**不能用 `isolation: isolate`**，它本身就在 backdrop-root 名单里，会把 bug 原样装回去。带 1px 边框的宿主还要让该层覆盖到 border box（`inset: -1px`），否则半透明描边会直接压在原始内容上形成一圈接缝。守卫：`chat-ui.test.mjs` 新增「包含弹窗的宿主不得自己带 backdrop-filter」断言。
- **边缘高光改为随主题**：`--glass-edge` 原先写死 `rgb(255 255 255 / 55%)`，挂到深色家族就是一道硬白线；改由项目已有的逐家族 `--glass-border-light`（浅色 42–72% 白、深色 14–25%）驱动，一处声明四个家族 × 明暗自动正确。玻璃深度同样改为按明暗（而非家族）在 `:root[data-resolved-appearance="dark"]` 下加深一次。
- **真·悬浮（布局变更）**：顶栏与输入框移出 chat 列的正常流，改为绝对定位浮在转写上，内容真正从下面滚过去；顶栏去掉硬底边（改由模糊分隔），输入框上方加 26px 渐隐带（滚动边缘效果，且刻意停在 composer 顶边，让玻璃背后仍有真实内容可采样）。两者各自用 `--chrome-header-bg` / `--composer-bg` 经 `--glass-chrome-opacity` 混色，因此顶栏的「窗口失焦」投影继续生效。
- **高度预算而非常量**：转写用 `--chat-header-h` / `--composer-h` 预留上下空间，dock、提问导航、操作提示条按 `--composer-h` 上移。`--composer-h` 是 `ChatInputArea` 用 `ResizeObserver` 对整个 footer 的实测值（输入行数、排队条、附件、横幅都会撑高），随浮动的传入 prop 决定是否发布，卸载时清除，避免残留高度。
- **动效**：`popover-in` / `command-palette-in` 入场改为材质化——opacity + transform + `filter: blur(6px → 0)` 同帧解析，末帧 `blur(0)` 且不加 `forwards`（避免元素永久成为子元素的包含块）；浮层 `transform-origin` 锚到触发源。**仅做入场**：这些浮层是条件渲染，卸载时没有可过渡元素，出场保持瞬时，已在 DESIGN.md 写明而非假装对称。
- **思考/运行态**：合并两个互相打架的指示器——原先「1.4s 呼吸圆点」与下方流程卡里「1s alternate 三竖条」同时动画。现在运行态是一枚玻璃胶囊，只有一道 `translateX` 光泽扫过（Apple Intelligence 手法，纯 transform 不触发重绘），wave 归位到它描述的步骤（流程卡与活动行）；wave 本身改为共享周期 + 负延迟，读作一道行进波而非三次独立闪烁。`prefers-reduced-motion` 下竖条保持静止满高 crest（仍编码「运行中」），而不是 `animation: none` 卡在中间态。
- **降级**：`data-reduced-transparency`、`data-performance="low"`、`prefers-contrast: more` 三档同时把 `--glass-surface-bg` 置为 `--card-bg` **并**把 `--glass-chrome-opacity` 提到 100%——只去掉模糊会留下半透明长条压在滚动文字上，比两端都差。
- **验证**：`svelte-check` 0 错 0 警、`vite build` 通过；desktop Node 结构测试 248/248（含新增 5 条守卫：材质必须成对出现、包含弹窗的宿主不得自带 backdrop-filter、不透明度与模糊的下限、悬浮高度预算、入场与降级），chat TS 测试 42/42。**未做**：真实 WebView 的冷启动走查（本环境无头浏览器与 Tauri 窗口均不可用），滚动穿透与 `--composer-h` 的实测需人工确认。

### 桌面端合并「执行与权限」「执行环境」为单页（2026-09-12，已实现）

- **合并**：桌面设置删除独立「执行环境」（sandbox）分区，沙箱后端、可用性诊断与高级限制（env 注入/网络/文件系统规则）整体并入「执行与权限」页（`ExecutionPermissionsSection` 一个组件，`SandboxSection.svelte` 删除）；设置侧栏系统组收敛为 运行环境/执行与权限/插件/诊断 四项，命令面板 `settings.sandbox` 目标同步替换为 `settings.executionPermissions`。
- **排版修复**：执行模式卡片固定 2×2（原 auto-fit 在 720px 栏内折成 3+1 失衡）；「完全访问的范围」由右侧挤压长行改为卡片底部说明块；「沙箱后端」组描述承接适用范围说明、诊断行并入同组（运行诊断按钮移至组头）；「高级限制」折叠改为透明披露并对齐 720px 内容栏（原为横跨窗口的实底长条）；页面统一单一保存底栏（模式与沙箱策略任一改动出现，一次保存按需分别提交，放弃同时还原）。
- **清理**：删除失效 i18n key（executionEnvironment*、sandboxHint、sandboxPreset* 预设族、sandboxEnabled/InitFailure/Diagnostics 等约 60 条，两种语言），新增 `settingsSave`；合并页描述更新为中英双语。
- **验证**：desktop `svelte-check` 0 错 0 警、`vite build` 通过、commandSystem 单测 8/8；浏览器预览连真实服务只读走查：合并页深/浅主题与中/英文渲染、高级限制展开对齐、模式切换出现保存栏、放弃更改正确还原（未写入任何服务端设置）。

### 统一权限模式第二轮复审修复：代理白名单时效、Auto 布局墙、子代理审批升级、draft 默认刷新（2026-09-12，已实现）

- **P1 改域名限制后共享代理仍用旧白名单**：基础设施去重键此前只含静态 knob + 代理存在性，而 SDK 的共享代理过滤器读的是管理器全局 config——先允许全部再收紧域名后，沙箱命令仍按旧白名单放行（复现：仍返回 200）。修复：`sandboxInfrastructureKey` 纳入完整网络配置（allow/deny 域名排序后参与），网络设置变更触发管理器重初始化；文件系统仍走逐命令 customConfig（并发句柄的 workspace 差异继续互不干扰）。守卫：infra key 语义反转后的纯函数测试 + 「allow-all → 收紧域名」两段 prepare 断言第二次 initialize 携带新 allowlist。
- **P1 Auto 写外部文件被输出布局检查拦住**：路径守卫放开后，write 的第二层 `Absolute output paths must stay inside the Project root or runtime scratch root` 仍在。修复：该层包含性检查同样按 `hostWideAccess`（Auto）跳过，受限模式两层照旧（测试分别钉住两层错误）。守卫：write 工具带 outputLayout 的 Auto/受限对照测试。
- **P1 子代理沙箱拒绝无法升级审批**：绑定环境的 shell 包装只返回退出码和输出，丢掉 `sandboxApplied`/`warning`，bash 无法识别沙箱拒绝（复现：审批请求数 0）。修复：完整透传执行元数据；沙箱拒绝照常升级为 Host Bash 审批请求并挂起。守卫：脚本化环境返回 `Operation not permitted` + `sandboxApplied: true` → 恰好一个审批请求 + 挂起文本。
- **P2 draft 默认模式可能过期**：只在服务地址变化时读取一次。修复：每次新开 draft（draftMode 翻转）与收到设置变更事件（未主动选择时）都重新拉取全局默认；用户在 draft 中显式选择过的值不被覆盖。守卫：chat-ui 结构守卫补两条刷新条件。
- **验证**：受影响服务端测试 256/256 + 外部适配器契约 3/3；desktop `svelte-check` 0 错 0 警、chat-ui 233/233、api.test 103/103；`vite build` 通过；重建产物冷启动冒烟（health 200 → execution-default GET/PATCH → sandbox GET → kill 重启恢复 200）通过。

### 统一权限模式复审修复：子代理真沙箱、Auto 文件全host、draft 继承、Provider 配置所有权、提示词契约（2026-09-12，已实现）

- **P1 子代理 bash 未接沙箱（review 复现）**：`createBashTool` 走 `toolDefToAgentTool` 的 legacy ctx，`shell.run` 直接 `execCommand`，`executionTarget` 只是摆设——沙箱不可用时子代理照样在宿主建文件。修复：`toolDefToAgentTool`/`createBashTool` 接受绑定执行环境，`createBashDefinition` 用 `bindExecutionEnvironment`（继承父尝试策略）绑定后传入——沙箱目标真沙箱、全自动真宿主、Plan 显式失败（不再静默逃逸宿主）；子代理 read/write/edit 同步继承 `hostWideAccess`。守卫：注入式后端路由测试 + 沙箱不可用组合复现（拒绝且不落盘）+ subagent.ts 结构断言。
- **P1 Auto 文件工具仍被 workspace 根墙拦住**：只取消了 denyWrite，`createPathGuard` 的 approved-root 检查仍拒绝外部路径。修复：`createPathGuard` 增加 `hostWideAccess`（Auto 时跳过根限制，保留 memory gateway / 全局 profile 两类结构路由守卫），主路径 ctx.fs 与 read/write/edit 及子代理同名工具按有效策略传参——文件工具与命令服从同一份策略。守卫：path 守卫单测 + write 工具在 Auto 写外部路径成功 / 受限模式仍拒绝的对照测试。
- **P1 新会话无条件写会话覆盖**：`draftPermissionMode` 硬编码初始值且 `onDraftSessionCreated` 无条件保存，全局默认改了新会话不跟随。修复：draft 进入时从 `/api/desktop/execution-default` 读取真实默认（新增 `loadDesktopExecutionDefault` 客户端），只有用户在 draft 中主动选择（`draftPermissionModeTouched`）才落会话覆盖，否则继承并在来源行显示「继承自全局默认」。守卫：chat-ui 结构守卫锁定 touched 条件与未触碰分支不含保存调用。
- **P1 后端句柄未隔离真实沙箱配置**：Anthropic provider 的 `initialize` 以完整 config 为去重键，并发时第二个句柄等第一个的初始化 Promise 却应用不上自己的配置。经 SDK 源码核实：`wrapWithSandbox` 第三参支持逐命令 `customConfig`（文件系统逐命令生效），网络代理过滤读全局 config 而域名限制本就是全局设置（各句柄一致）。修复三件套：(1) `sandboxInfrastructureKey`（allowLocalBinding + 代理是否需要）作为去重键，句柄间差异不再触发 reset 抢占；(2) `prepareToolSandboxExecution` 把本句柄 effective config 传入 `wrapWithSandbox` customConfig，wrapped 命令自带配置、与全局状态解耦；(3) init→wrap 以模块级互斥串行（执行仍在锁外，并发保持并行）。守卫：infra key 纯函数测试 + pluggable provider 捕获「wrap 收到本句柄 config」契约测试。
- **P2 静态提示词与全自动冲突**：缓存稳定前缀里的「Bash 在沙箱中执行、宿主操作须请求审批 `bash(command, hostApproval=…)`」教学会让 Auto 模型主动停下等一张永远不会来的卡。修复：删除静态 `host-tool-approval` section（含 pipeline 第 4 步的指向），沙箱→宿主访问契约移入 manual/accept_edits 的逐轮 runtime instructions（Auto/Plan 不含），bash 工具描述改为模式中立；modeInstructions 的 Auto 行显式加「不要请求/等待审批、不要把命令描述为沙箱内」。守卫：modeInstructions 测试（受限模式含契约、Auto 无 hostApproval 教学、四模式互异）+ prompt.ts 源结构守卫（静态前缀不再含审批教学）。
- **验证**：受影响服务端测试 269/269（approvalSuspension harness 10/10 连续三轮稳定）；desktop `svelte-check` 0 错 0 警、chat-ui 结构守卫 233/233、api.test 103/103；`vite build` 通过。

### 统一执行权限模式：一套四模式，全自动=完全访问（2026-09-11，已实现，issue #49）

- **统一模式**：产品只保留一套执行权限模式（计划/手动/接受修改/全自动），设置默认值与对话窗口覆盖共用同一套名称、说明与运行时策略；会话覆盖按原五级链（Session → Project → Bot 实例 → Agent → 全局默认）解析，`resolveEffectivePermissionMode` 现同时返回决策来源（session/project/instance/agent/global），`/api/desktop/session-permission` GET 透出 `source`，composer 权限菜单底部显示「来源：本会话覆盖/继承自…」。删除 `clampModeForChannel`：渠道不再把 Plan/Manual 钳制成 Accept Edits（Plan 各渠道只读可守、Manual 走既有 defer/挂起审批路径），杜绝无审批面渠道上的静默放宽。
- **全自动=完全访问（行为变更）**：`decidePermission` 矩阵中 auto 全行 allow——宿主命令、越界写入、MCP/第三方调用、Mini App/插件安装等管理操作不再产生审批卡或 `waiting_for_approval`；high/critical 工具的强制 broker 门槛在 auto 下跳过。删除旧「半自动」补丁链：`liftSandboxForPermissionMode`（Auto 放开沙箱域名）与 `autoApproveSandboxEscalation`（沙箱拒绝后解析输出再转宿主重跑）整体移除——auto 在命令启动前就选择宿主执行，不经沙箱、无二次副作用；受限模式的「会话级批准宿主回退」与 Host Bash 审批卡路径保持不变。`.env*` 凭证文件硬保护（toolPolicy preflight）不属于审批门，全访问下继续保留。
- **共享执行后端边界**：新增 `src/lib/server/agent/exec/executionBackend.ts`——`ExecutionBackend`/`BoundExecutionEnvironment` 共享入口统一拥有命令执行、输出、终态、取消与环境生命周期；`HostExecutionBackend`（直接宿主执行 + env 文件凭证注入）与 `AnthropicLocalSandboxBackend`（provider 包装、依赖检查、fail-closed 收敛在适配器内）按有效模式的 execution target 选择；`bindExecutionEnvironment` 把后端+workspace 绑定到单次尝试，模式/后端更改只影响下一次尝试。Plan 模式绑定显式 no-execution 环境（拒绝而非静默宿主回退）。bash/文件工具/审批判定/子代理/提示词/UI 全部读取同一份 `EffectiveExecutionPolicy`（mode + source + executionTarget + 适用沙箱限制）。
- **删除独立沙箱体系**：`ToolSandboxSettings` 移除 `enabled`/`initFailureMode`（sanitize 双向丢弃旧字段），沙箱是否参与执行由有效模式决定；删除 agent/instance/Project 的 `sandboxEnabled` 覆盖链与 session `preferences.sandboxOverride`；删除沙箱四档预设（locked/readonly/standard/full）与预设滑条 UI、检测/应用逻辑（desktop api + web 页）。默认沙箱网络不限制（`allowedDomains: ["*"]`），域名/文件系统/env 注入降级为「执行环境」高级设置，仅约束沙箱命令，UI 明示全自动下不适用。
- **子代理与外部适配器**：内部子代理通过 `executionPolicy` 显式继承父尝试策略（bash 执行目标与父一致）；外部 Codex/Claude Code 适配器删除独立 `codexPermissionMode`/`claudeCodePermissionMode` 配置（插件 manifest/UI 更新并 bump 0.2.2→0.3.0），改由 `policyTranslation.ts` 把会话有效模式翻译为受支持的运行时选项（Claude: plan→plan、accept_edits→acceptEdits、auto→bypassPermissions；Codex: accept_edits→approve-for-me、auto→dangerously-bypass…），无法守约的模式（如 Manual 无交互审批面、Codex 无只读）抛出明确 unsupported 错误，不再静默等待或放宽。
- **UI/渠道命令**：设置新增「执行与权限」区（全局默认模式四卡片 + 完全访问范围说明，新 `/api/desktop/execution-default` 端点）；「沙箱」区改版为「执行环境」（后端声明+可用性诊断+折叠高级限制，无开关无预设，固定底栏保存）；Agent/Channel/Web Profile 设置的沙箱覆盖改为一套四模式继承式选择；composer 权限菜单 Auto 显示「全自动（完全访问）」并显示来源行；工具展示标签（Sandbox/bash）与 runner 诊断事件改用 `executionTarget`；渠道 `/sandbox` 命令替换为 `/mode [scope] [plan|manual|accept_edits|auto|reset]`（状态含生效模式与来源）。Web 端设置页（system 沙箱开关→默认模式、渠道页沙箱开关→模式继承、sandbox 页改版执行环境）同步。中英即时切换、明暗主题与窄宽度沿用既有 token/组件体系。
- **机器守卫**：`decidePermission.test.ts` 新矩阵逐格断言（含「Auto 永不 ask/deny」「受限模式不自动放行宿主」「Accept edits 对外部效应全 ask vs Auto 全 allow」差集）；`resolvePermissionMode.test.ts` 来源标注+模式→target 推导+沙箱限制仅在参与时附带+全渠道不钳制；`executionBackend.test.ts` 注入式后端验证 workspace 绑定、输出/终态、取消、并发不串配置、能力声明决定高级设置存在性；`approvalSuspension.test.ts` 新增 7 个真实 Runner 场景（宿主直执行/显式宿主请求/denyWrite 文件/管理操作/渠道 Manual 挂起不放宽/切回受限立即生效/模式更改不复活待审批）；`tools/index.test.ts` 经真实 ToolRuntime 的 MCP third_party 对照（auto 直执行 vs accept_edits 产审批）；`externalSubagentAcceptance.test.ts` 契约更新+翻译函数用例；store round-trip 覆盖新形状（含旧字段在 sanitize 丢弃）。
- **验证（已执行的必需检查）**：服务端全树（agent/settings/approval/hostBash/app/channels/projects/sessions）1553 项测试 1552 过——唯一失败 `desktopApprovals`「lists only for requested session」经 git stash 基线核实为 HEAD 既有问题，与本线无关；其中主验收入口 `approvalSuspension.test.ts` 10/10（三既有审批挂起回归 + 七个新 Auto/受限/竞态场景）。`tsc` 相对 HEAD 基线 diff：生产代码 0 新增错误（新增错误全部位于随实现更新的测试文件，且已随测试转绿）；desktop `svelte-check` 0 错 0 警；`vite build` 通过；desktop 结构守卫 236/236（含按新执行环境契约改写的 sandbox 守卫）。隔离实例冷启动冒烟（构建产物 + 临时 DATA_DIR + 5177 端口）：`/health` 200 → `execution-default` GET 默认 accept_edits / PATCH 改 auto → sandbox GET 新形状（backend + 高级限制，无 enabled）PATCH 保存域名限制 → session-permission GET source=global / POST 会话覆盖 manual 后 source=session → kill 重启后三项保存值全部存活（round-trip 通过）。**未完成/边界**：真实 GUI 的四语言/主题/窄宽度人工点查未执行（以 svelte-check + 结构守卫 + 双语文案落地代替）；渲染后系统提示词的四模式断言由 `modeInstructions.test.ts`（四模式互异 + 关键词）与 runner 接线覆盖，未在真实模型往返中肉眼核对。

### 审批等待成为共享运行时的明确暂停状态：挂起/恢复语义统一（2026-09-10，已实现，issue #48）

- **背景/根因**：用户报告「回答请批准却没有可操作的审批卡」「已有审批未处理时任务继续跑、产生更多审批」「点批准后网络错误卡片消失」。沿实际运行适配链的行为回归证实了三个叠加根因：(1) Host Bash 审批等待的超时结果缺 `terminate: true`，握手窗口（10s）过后 agent 循环继续发起模型轮次；(2) 混合工具批次里兄弟工具的正常结果稀释挂起标记（pi-agent-core 要求整批 `terminate` 才终止），一个挂起变成无限「模型调用→再挂起→再建审批请求」循环（E2E 复现实锤）；(3) Runner 的空回复重试机制把挂起 attempt 当空回答回滚重跑，同一动作最多重复创建 3 个审批请求，且 run 行永远不会落 `waiting_for_approval`，出带恢复找不到可恢复的 run——这就是「模型说请批准但没有卡」的真实机制。
- **共享运行时修复**：新增 `src/lib/server/approval/suspendedResult.ts`——`buildApprovalSuspensionResult`（无条件 `terminate` + `metadata.approvalRequestId` + `status: waiting_for_approval`）与共享握手窗口常量 `APPROVAL_INLINE_HANDSHAKE_WINDOW_MS`（Host Bash 10s→30s 与 Broker 统一，均为握手非截止）；Runner 构造时安装审批屏障（`beforeToolCall` 包装 + `shouldStopAfterTurn`），工具挂起（含 subagent 冒泡，事件现携带真实 `approvalRequestId`）即设置 run 级挂起标志：未启动的工具被拦截、循环在下一轮模型调用前干净退出（steer 注入也不放行）、stopReason 落 `waiting_for_approval` 且 attempt 不回滚；拒绝/过期返回真实终态 status 不再伪装 waiting；`broken` 挂起结果携带 requestId 供恢复定位。
- **决定与恢复的幂等/恢复核对**：Broker `listPendingRequests` 读路径按共享 TTL（1h）过期（对齐 Host Bash 惯例）；Host Bash 新增 `expirePending`（等待中 Stop/中断 → 终态，迟到决定不能复活已结束的 run）与 `recoverStaleExecuting`（`executing` 超 30min → 明确「结果未知，请核对勿盲重跑」的 failed，读路径触发，不可再被认领）；Web/Desktop `_handleWebHostToolsCommand` 出带执行前原子 `claimExecution`，认领失败时按记录真实状态答复（运行内执行中 vs 已处理），落实 prd §3.08 的「一次决定一次执行」。
- **Desktop 前端**：`resolveApproval` 服务端确认前不再移除卡片——新增 `resolvingApprovalId` 提交中状态（经 view store 供 legacy 面板响应，pitfall 2），提交期间按钮与快捷键禁用（DecisionCard 新 `submitting`/`submittingLabel`，`approval-submitting` 语义样式），失败保留卡片可重试，`not_found` 撤卡并提示；多请求稳定队列不覆盖当前卡片；重新打开会话经 `adoptPendingApproval` 以服务端状态恢复卡片。
- **网络错误边界**：`isSandboxPermissionFailure` 导出并加边界回归——仅 OS 沙箱特征（EPERM/EACCES/sandbox-exec/seatbelt/operation not permitted/permission denied）升级宿主审批；connection refused、DNS、fetch failed、ENOTFOUND 等网络失败返回真实诊断。
- **机器守卫**：新增 `src/lib/server/agent/core/approvalSuspension.test.ts`（真实 MomRunner + 真实 Agent 循环 + 真实 Broker/Store @ 临时 DATA_DIR，脚本化模型驱动「发起→挂起→决定→恢复」三场景：批准后恰好执行一次且 run 完成、拒绝不执行动作、混合批次挂起后零额外模型轮次且仅一个请求）；`bashApprovalWait.test.ts` 4 项（窗口超时/defer/中止过期/记录消失均 `terminate` + requestId）；`bashPolicy.test.ts` 网络错误边界；`store.test.ts` 过期与卡死恢复；`approvalBroker.test.ts` TTL；`conversationController.test.ts` 4 项（失败保留可重试、飞行中防重复、stale 撤卡、稳定顺序）+ 页面恢复幂等；`chat-ui.test.mjs` 结构守卫（卡片须服务端确认后才移除、submitting 接线、双面绑定）。
- **验证**：新增/相关服务端测试全绿（E2E 3/3、bashApprovalWait 4/4、agent 全树 842 pass/1 既有 skip、desktop-chat 282、projects 83、service-bootstrap 21、webCommands/hostBash/approval 150）；desktop tsx 单测与 `node --test` 结构守卫全绿（controller 9/9、chat-ui 232/232）；`svelte-check` 0 错 0 警；`vite build` 通过；`tsc` 触碰文件 0 新增错误（存量噪音基线 300 按行号偏移核对）。隔离实例冷启动冒烟（临时 DATA_DIR + 5177 端口，构建产物 `start-server.mjs` 冷启 → `/health` 200 → deep health runtimeReady → `/hosttools list` → Desktop `list_pending` → kill 重启恢复 200）；routes 层 mcp-ui 1 项失败经 stash 基线核实为 HEAD 既有问题，与本线无关。
- **遗留意向**：握手窗口统一使 Host Bash 连接保持从 10s 延长至 30s（与 Broker 既有体验一致，均为挂起而非阻塞语义）；subagent 冒泡的多请求归因已由事件携带真实 requestId 解决，旧事件回退路径仅影响日志字段。

### 图标体系引入 Reicon Duotone：混合字重规范 + 生成管线（2026-09-09，已实现）

- **背景**：桌面端此前只用 Reicon 的 Outline/Filled 两种字重，希望采用官网已展示的 duotone 双色调风格。核查结论：官方框架包（reicon-svelte 最新 1.0.104）仍只含 Outline/Filled，duotone 只存在于官网与官方数据同步（Iconify 官方包 `@iconify-json/reicon` 1.2.4 收录 1238 个 `-duotone` 变体）；且项目在用的 150 个图标中仅约六成有同字形 duotone，Check/X/Loader/Chevron 等 UI 骨架图标官方就没有 duotone 形态——全量切换不可行，细线条功能图标做 duotone 也无意义。
- **方案（混合字重体系，规范先落 `DESIGN.md` Foundations）**：16px 及以下的功能/状态图标（导航、行内操作、按钮、spinner、全部状态信号）保持 Outline，Filled 仍仅用于既有激活态；20px 及以上的装饰展示位改用 duotone，并在同一 slice 统一应用：`EmptyState` 共享组件 29 个语义图标名中 28 个走 duotone（仅 `activity` 无同概念 duotone 且会与 `pulse` 撞字形，保留 Outline 兜底）、`ProjectDetail` 欢迎位 Folder 28px、`ArtifactPanel` 5 处 `file-empty` 空列表图标。新增生成管线：`@iconify-json/reicon`（devDependency）+ `scripts/generate-duotone-icons.mjs`——manifest 内 EXACT 同名映射 + SUBSTITUTIONS 同概念显式映射（`Timer`→Stopwatch、`Image`→Gallery、`Sparkle`→Wand、`Film`→Clapperboard、`Search`→search2、`ShieldSlash`→shield-cross、`TriangleWarning`→alert-triangle），产出 `apps/desktop/src/lib/icons/duotone/bodies.generated.ts`（32 个 body，禁止手改）；配套手写 `DuotoneIcon.svelte`，API 对齐 reicon 组件（size/color/class/style + restProps，`aria-hidden` 默认 true）。duotone 层走 `currentColor` + 官方烘焙的 50% 次层透明度，明暗主题与全部主题家族自动适配，不做单独图层重绘。
- **机器守卫**：生成脚本对 manifest 逐名校验存在性，缺名即非零退出；`DuotoneIcon` 的 `name` 类型派生自生成 map（`DuotoneIconName`），引用不存在的名字直接 svelte-check 报错；DESIGN.md 规范禁止手改生成模块。
- **验证**：生成脚本 32 body 产出；svelte-check 0 错 0 警；desktop tsx 单测 276/276、`node --test` 结构守卫 241/241；vite build 通过（同时解除了上一条 Markdown 修复记录里因图标线缺 `bodies.generated` 而无法本机跑 build 的阻塞）。隔离实例冷启动视觉走查（独立 vite 1428 端口 + 无后端让空态自然呈现，不触碰用户运行中的服务与真实设置）：暗色下 AI 服务商（cloud-cross）、Skills（wand）、图像（gallery）、视频（clapperboard）、搜索（search2）空状态渲染正确；本地强制亮色（`data-resolved-appearance`，不持久化）复验 Skills/搜索正常；settings 侧栏小图标保持 Outline 符合规范。**未完成**：自动任务页因无后端停在「正在加载」，bell/stopwatch 两个 duotone 未在真实面板过目（同一组件管线、数据已校验存在）；ProjectDetail 欢迎位与 ArtifactPanel 空列表需后端会话才能走到，未截图过目。

### Chat Markdown 渲染修复：价格 $ 不再被当成公式，KaTeX 真公式恢复正常排版（2026-09-09，已实现）

- **症状**：回复同一行出现两个 `$` 时（价格、金额最常见），两个 `$` 之间的中英文正文被渲染成斜体数学公式——「订阅费每月 $10，一年 $120」里「10，一年」变公式、「120。」孤离开；表格单元格（`$10/月，年付 $100`）同样中招，流式与最终渲染都错。真写 LaTeX 公式时排版也是错位的。
- **根因**：desktop `src/lib/markdown.ts` 给 marked 挂 `marked-katex-extension` 时开了 `nonStandard: true`（非标准规则：同行任意两个 `$` 即成 inline math，不要求定界符贴空白），这是价格文本误伤的直接来源；同时 DOMPurify 配置 `FORBID_ATTR: ["style"]` 且只开 html profile，把 KaTeX 视觉层依赖的内联样式（strut 高度、间距）和 MathML 语义层整段剥掉，真公式因此错位。
- **修复**：`nonStandard` 回归库默认 `false`——标准规则要求闭合 `$` 贴着空白/标点，实测常见价格形态（`$10、 $20`、`支出 $100（收入 $200）`、`总计 $10，其中 $3。`、`costs $5 and $6`、`"$a 和 $b"`）全部保持字面量，残留边界只剩「孤立 `$` 后跟空格」这类刻意写法；sanitize 改为 `USE_PROFILES: { html: true, mathMl: true }`，新增 `uponSanitizeAttribute` hook 把 style 属性限定在 `.katex` 子树内保留、其余一律剥除，模型输出里的原始 HTML 仍然不能带样式或脚本。hook 懒注册：无 DOM 的 Node 导入拿到的 DOMPurify 没有 addHook/sanitize，只在真实消毒路径首次执行时安装。
- **机器守卫**：新增 `src/lib/markdown.test.ts` 12 项回归（中英价格、表格内价格、单 `$`、标准 inline/display/`$$` 数学、边界形态固化、代码块 chrome、表格查看器注入、heading id 命名空间），接入 desktop test script；`chat-ui.test.mjs` 新增结构守卫锁定 `nonStandard: false`、mathMl profile、`.katex` 范围 style hook、`FORBID_TAGS` 与 `katex.min.css` 引入，防止配置回潮。
- **验证**：desktop tsx 单测 276/276、`node --test` 结构守卫 241/241 通过；`svelte-check` 报的 4 个错误全部来自进行中的 DuotoneIcon 图标线（`bodies.generated` 未生成、`aria-hidden` prop 类型），与本次改动文件无关；DOMPurify hook 行为在真实浏览器用真实管线输出夹具验证：`.katex` 内 style 存活且计算高度生效（17.37px strut）、KaTeX_Main 字体解析成功、MathML 层在位、原始 HTML 的 style 属性被剥除、内联 script 被拦截。**未完成**：desktop `vite build` 因图标线缺失 `bodies.generated`（`@iconify-json/reicon` 数据包未安装、生成脚本无法运行）无法在本机构跑，待该线完成后补跑；应用内冷启动冒烟走查同样待 build 恢复后进行。

### 输入框富文本实体高亮：按类型着色的 pill + 持久化引用纳入高亮（2026-09-09，已实现）

- **背景**：composer 里 `/grabby` 这类调用 token 原本的 tint 只有 11% 透明度，暗色主题下几乎不可见，也没有按类型区分；从 `@` 菜单选文件后落进输入框的 `@[文件](路径)` Markdown 原文则完全没有高亮，读起来是链接汤。
- **方案（保持 textarea + overlay 镜像架构不变）**：`segmentComposerInvocations` 升级为通用实体分段——在既有 `[/@]` 词边界 token 之外，复用共享 `parseProjectFileReferences` 识别 `@[file.md](path)`（含 `:行号`、转义），并识别 `[$Skill](.../SKILL.md)`（与提交分类同构），引用在任何偏移都算一个实体，实体内部不再二次起 pill；`ComposerSegment.kind` 扩宽出 `file`。CSS 侧每种类型用「同色系 tint + 1px inset ring（box-shadow，零布局影响）」双通道区分：command 蓝、skill 紫、miniapp 青、file 中性（与建议菜单/invocation 卡片同一套色相），色相从菜单 → 输入框 → 会话记录保持一致。不引入 `$` 之类视觉前缀：任何改变文本 advance 的装饰都会破坏 overlay 与 textarea 的逐字形镜像、挤歪 CJK 输入法候选窗。
- **pill 尺寸按实测预算放宽**：bleed 从 x2/y3 放宽到 **x4/y3.5**，让胶囊明显大于文字（用户反馈：原来左右紧贴字符）。约束全部实测验证：垂直方向超过 3.5px 后，跨行折行的上下两个 pill 会触碰粘连（4px 时 ring 融成一块，样张确认）；水平方向 4px 是常见场景（行首、两侧有空格）下 ring 不压到相邻字形的最大留白，CJK 无空格紧邻（`让@timer提醒`）在旧值 2px 时本就互压，软 tint 保持可读。`.composer-highlight` 的 `overflow-clip-margin` 相应改为 `max(bleed-x, bleed-y)`，否则盒边缘会削掉首尾 pill 的 bleed；chat-ui 守卫测试同步钉住新值。
- **机器守卫**：`composerSuggestionCatalog.test.ts` 新增 7 项分段单测（任意偏移 pill、普通文本/未知 token/邮箱/`3/4` 不误报、文件与 Skill 引用各成一实体、引用内部不嵌套 pill、混合实体按阅读顺序合并且拼接恒等于原文）；`chat-ui.test.mjs` 结构守卫补 `parseProjectFileReferences`、SKILL.md 模式与 `.composer-token[data-kind="file"]` 断言。
- 验证：catalog 单测 8/8、chat-ui 结构守卫 233/233（含 numeric-typography）、相关 chat 模块批 98/98、desktop 全量 tsx 264/264、`svelte-check` 0 错 0 警、`vite build` 通过；另用应用真实 CSS 值搭样张在浏览器截图核对明暗两套主题下四种类型 pill 的观感、折行对齐、无空格 CJK 相邻与上下行堆叠最坏情况（据此选定 x4/y3.5，否决 y4 粘连方案；临时样张与服务已清理）。

### 会话内 Mini App 快捷入口：顶部菜单与消息打开按钮（2026-09-09，已实现）

- **顶部入口**：普通会话和 Project 会话标题栏都提供可键盘操作的图标菜单；目录只显示已启用且健康的小程序，支持名称/描述搜索、收藏、最近打开的 10 个应用、加载失败重试和「全部小程序」返回既有启动台。
- **消息入口**：持久化的 `@app-id` Mini App 调用标识显示「打开」按钮；Project 会话通过既有深链桥接到 ChatView，普通会话直接复用共享 Mini App Inspector。重复打开只激活已有标签，不重放消息或再次执行工具。
- **状态边界**：收藏和最近使用保存在连接作用域的桌面 UI 偏好中；目录加载按连接防止旧连接响应覆盖新连接，失效/停用应用不出现在快捷列表，Inspector 继续显示既有不可用原因。
- **规范与测试**：设计规则写入 `DESIGN.md`；quick-access 偏好 save → 新建 store → load、去重、连接隔离和最近列表上限有单测覆盖。验证：desktop 测试 240/240、聊天 UI 230/230、`svelte-check` 0 错 0 警、Desktop Vite build、cargo test 60/60 通过；冷启动自动尝试因已有进程占用 `127.0.0.1:1420` 未能启动独立 Tauri 窗口。

### 聊天输入草稿持久化根修：草稿存储成为唯一事实源（2026-09-09，已实现）

- **症状**：会话里正在输入的内容会在某些会话切换后丢失——能否保住草稿取决于「那条切换路径有没有记得手动调 sync」：`openSession`/`newConversation`/fork 记得，服务连接时的默认选座（`selectDefaultSession`，含点侧边栏导航触发的 `connect()`）不记得，直接 `loadDraftIn()` 覆盖 `messageInput`，未保存的输入就此丢失。
- **根修（结构性，消掉整类问题）**：废弃「切换时手动 syncDraftOut/loadDraftIn」模式，ChatView 改为单一 `$:` 镜像块双向负责——草稿 key 变化（切会话/新建草稿/首条消息建会话）时载入新会话草稿，其余任何变化（打字、加附件、改 thinking 级别、小程序 composer.insert、发送清空、失败回填）即时镜像回 `draftStore`。任何路径切换会话都不可能再丢草稿，也不存在「哪条路径忘了 sync」。草稿 key 规则提炼为纯函数 `composerDraftKey()`（`sessionDraftStore.ts`），镜像块与 store 共用一份，不会再对「当前在编辑哪个草稿」产生分歧；随之失去全部调用方的 `ChatSessionStore.currentDraftKey()` 直接删除。
- **机器守卫**：`chat-ui.test.mjs` 新增结构性守卫（镜像块存在且双向、全文件禁止 `syncDraftOut(`/`loadDraftIn(`/`draftStore.setText|setFiles|setThinking(` 回潮、key 规则只在共享层定义）；`sessionDraftStore.test.ts` 补 `composerDraftKey` 路由用例，并把该测试文件接入 desktop test script（此前未接入）。
- 验证：desktop tsx 262/262（含补接的 sessionDraftStore 7 项）、`node --test` 守卫 239/239、`svelte-check` 0 错 0 警、`vite build` 通过、cargo test 通过（未触及 Rust）；冷启动冒烟走查未做（需打包 Tauri 窗口，留待发布前验证）。

### 回收站删除根修：显式 purge 操作让「彻底清除」真正生效（2026-09-08，已实现）

- **症状**：回收站内选中会话点「删除」确认后毫无变化——会话永远留在回收站。
- **根因**：批量 `delete` 一律走 `lifecycle.trash()`，而 trash 对已回收会话是幂等成功（直接返回 succeeded 的 no-op）。回收站视图发的就是 delete kind，服务端"成功"了但什么都没做：既没有跨存储清除，也不从列表消失。到期 30 天的定时 sweep 是唯一的清除路径，用户主动删除这条路根本不存在。
- **根修（共享层）**：bulk 操作新增显式 `purge` kind（`delete` 语义一字不改：进回收站/对已回收幂等）；lifecycle 服务新增 `purgeTrashed` 操作（owner 授权重查 + retain 保护 + busy 探针门槛与其余操作一致，执行体经注入端口复用 `SessionTrashCleanupService` 的跨存储 purge：搜索投影 → UI 会话文件 → Agent Context → 删 lifecycle 行，部分失败记 cleanup intent 可恢复）；runtime 装配把 cleanup 服务先建并接入端口（顺序调整，`reconcilePending`/runtime 暴露引用不变）。客户端在回收站视图把删除映射为 purge（web `doBulk` / desktop `runSessionBulk`），删除意图精确保留到操作记录与重试。
- **文案**：回收站视图的删除确认改为「这些会话已在回收站中，将立即彻底清除，此操作无法恢复。」（双语），其余视图维持 30 天恢复期说明。
- **机器守卫**：`sessionBulkService.test.ts` +2（purge 真删除：lifecycle 行与 UI 会话文件消失、普通 delete 在回收站仍是幂等 no-op 且对 active 会话进回收站；busy 会话 purge 被 skip 保留）；夹具接入与生产同形的 trash cleanup 端口。
- 验证：会话域 147/147（含 bulk 12）；桌面 `svelte-check` 0 错 0 警、store 12/12；Web `vite build` 通过；隔离实例冷路径走查：trash A/B → purge API 成功且预览诚实返回 source-unavailable → UI 回收站选 B → 删除 → 确认（显示立即清除文案）→ 回收站 (0)、"No matching sessions"。

### Mini Chat 输入乱码与频繁中断修复：后台生成 + IME 守卫升级（2026-09-08，已实现，closes #47）

- **症状**（issue #47）：Mini Chat 输入框输入中文后残留拼音乱码（如 "wff"）；回复频繁显示「回复已中断」/「Could not reach the Molibot service.」，长回复几乎必中断。
- **中断根因**：发消息 POST 同步等待整个 LLM 生成完成，撞上传输链两级看门狗——桌面 Tauri 协议传输 30s 请求超时（返回 502 "Could not reach the Molibot service."）+ MiniApp 宿主→子进程 RPC 60s 看门狗（超时直接 SIGKILL 整个 App 子进程并中止生成），下次启动把 pending 消息标记为 interrupted。超过 30s 的回复 100% 中断。
- **根修（共享层）**：`POST /messages` 与 `/retry` 改为追加轮次后立即返回 201（实测 <2ms），生成在后台继续（App→宿主 `ai.chat` host_call 无看门狗，时长不再受限）；UI 用 `generatingId`（会话级）轮询驱动整个生成生命周期——200ms 轮询流式渲染、终态自动释放、404 自愈、切换会话/新建/设置在生成期间不再被全局锁死；其他会话仍可正常对话（服务端本就按会话粒度并发）。失败原因不再随 30s 超时丢失：消息行新增 `error_message`（SQLite `PRAGMA table_info` 守卫式 ALTER 兼容既有库），失败/中断文案带出可读原因（保留「Provider 错误可见」修复的承诺），`GET /messages` 投影透出。
- **输入乱码根因**：内置的 `@astryxdesign/core` 0.1.4 的 contentEditable 输入框没有 IME 组合输入守卫，组合期间按 Enter（选词）会误触发提交并重写 DOM，打断组合、残留拼音原文。升级 `@astryxdesign/core`/`@astryxdesign/theme-neutral` 0.1.4→0.5.4、`@stylexjs/stylex` 0.18.3→0.19.0（React 19 已满足 peer），重建 mini-chat（1.1MB→757KB）与 prompt-box 产物，两个内置包版本 bump 至 1.2.0 让现有安装收到更新。
- **机器守卫**：`miniChat.test.ts` 全套改用「POST 立即返回 + 轮询终态」语义（14 项），新增看门狗回归测试——`processCallTimeoutMs` 压缩到 300ms + 900ms 慢生成，断言 POST 不阻塞且回复最终 completed（旧实现此场景必失败）。
- 验证：miniapps 套件 209/209、desktopMiniApps 7/7、`vite build` 通过、tsc 改动文件零错误；隔离实例（临时 DATA_DIR）冷路径走查：内置目录版本 1.2.0 → 安装激活 → UI 资产 200 + IME 守卫在产物中（`isComposing||keyCode===229`）→ 发消息 POST 201 立即返回 → 无模型时失败原因落到消息行 → retry 201 立即返回，全部符合预期。

### 会话预览弹窗化：还原真实 chat UI（图片/附件可见）（2026-09-08，已实现）

- **症状**：会话管理页点击「查看」是在列表下方追加一个纯文本「相邻预览」卡片——既打断了浏览位置，也只显示 role+content 纯文本，图片/音频/视频附件全部不可见，无法还原对话的真实样子。桌面端策略区还持续报 `url not allowed on the configured scope: .../api/settings/session-auto-archive`（上一轮接入桌面端时漏配 Tauri HTTP scope）。
- **根修（共享层）**：`/api/sessions/managed/preview` 改为返回与聊天界面完全相同的投影消息（`loadStoredConversationMessages`：attachments/thinking/steps/model 全量，web/project 走 owner 索引解析，external 透传 contexts 投影），不再丢字段只留三字段；`resolveAuthorizedConversation` 的 web 分支同样改为 owner 索引解析（与 sessions 读 API 对齐），修复浏览器创建会话（真实 userId owner）的附件 404。Web 聊天页的 markdown 渲染抽为共享模块 `src/lib/ui/markdown.ts`，并允许安全的 markdown 图片（同源/绝对安全协议、lazy 加载），聊天页与设置页共用一份实现。
- **桌面端**：`SessionManagementSection` 预览改为 Dialog 弹窗，内部直接挂 `ConversationTranscript`（桌面聊天同款渲染器：气泡/markdown/代码高亮/复制），附件经 `listDesktopSessionFiles` + `fetchDesktopFileBlob` 加载真实字节（object URL，关闭/切换时 revoke，在途请求有会话一致性守卫）；预览目标行（botId/projectId/source）存入 store 供文件 API 推导参数。Tauri capabilities 补 `/api/settings/session-auto-archive*`（127.0.0.1 + localhost）。
- **Web 端**：`settings/sessions` 预览同样弹窗化（providers-modal 系 + 新 session-preview-* 语义 CSS，全部主题 token），消息气泡布局 + markdown 渲染 + 附件图片/音频/视频（经 `/api/web/files` 同源 URL）/文件 chip；提炼详情随弹窗展示；双语 + 明暗主题。
- **机器守卫**：`http-scope.test.mjs` 新增 session-auto-archive scope 断言（此类漏配第二次出现，守卫升级为整类）；`sessionManagement.test.ts` 新增「成功预览保留完整投影（attachments/thinking）且记住来源行」用例（共 12 项）。
- 验证：桌面 `svelte-check` 0 错 0 警、store 测试 12/12、scope 测试 5/5、`vite build` 通过（桌面 + Web）；Web 基线 svelte-check 错误数不变（存量错误未动）；隔离实例冷路径走查（临时 DATA_DIR + 种子会话）：列表 → 查看 → 弹窗（用户/助手气泡、附件图片、markdown 图片/粗体/代码/列表、提炼摘要）→ 关闭 → 英文界面复验 → 暗色主题复验，全部通过。

### Desktop 设置页接入会话管理：api 适配层 + runes store + SessionManagementSection（2026-09-08，已实现）

- **范围**：desktop app 同等获得已交付的 Web「会话管理」能力——后端零改动，直接调共享 HTTP 端点（owner 级查询参数式授权，不传 requester）。`apps/desktop/src/lib/api.ts` 新增类型化适配函数（managed 列表/预览/selection/bulk/retry/describe-delete/extraction/extraction-status/auto-archive 设置，沿用 requestJson 模式）；`stores/sessionManagement.svelte.ts` runes store（筛选/服务端分页/本页多选+shift 范围/跨页全选快照/预览含提炼详情与 source-unavailable/批量与重试/策略编辑，列表请求 generation 所有权防串写）；`settings/SessionManagementSection.svelte` 三视图+全量筛选+批量控件+策略区（`.settings-footbar` 保存），复用既有语义 CSS/组件（SelectControl/StatusBadge/Dialog/EmptyState/IosSwitch/SkeletonRows），i18n 新增 sessionMgmt* 双语 key；App.svelte assistant 组 memory 后新增导航。
- **机器守卫**：`api.test.ts` +10（URL/方法/载荷/逐项投影/400 透传）、`sessionManagement.test.ts` 11 项（筛选清选择、跨页快照、删除确认门控、archive 逐目标版本、提炼门控模式、策略细粒度路由、失败保留旧行、旧响应不覆盖新结果）；`chat-ui.test.mjs` taxonomy 断言同步 assistant 组扩展。
- 验证：桌面 tsx 114/114（含既有 api 103 项不回归）、全量 tsx 288 项与 node --test 237 项不回归、`vite build` 通过、`tsc --noEmit` 0 错误。

### 会话管理生产装配根修：真实忙碌探针/外部只读/Trash 调度/设置 round-trip（2026-09-08，已实现，Session 管理 Phase1 Blockers）

- **B1 生产忙碌探针**：`runtime.ts` 经新装配 `assembleSessionLifecycle`（`sessionServiceAssembly.ts`）装配 lifecycle——真实探针 `createSessionBusyProbe` 覆盖 live runner（`snapshotAllRuntimeRuns`）、待审批（`HostBashStore.listPending` session 维）、非终态关联任务（`DurableExecutionStore.hasNonterminalForSession` 新增：`source_ui_session_id`/attempt `context_session_id` 任一命中即忙）；archive/delete 在生产真正阻塞（busy skip），读失败降级为不忙、永不把监控故障变成 500。机器守卫：`sessionServiceAssembly.test.ts` B1（可控三信号逐个阻塞、清空后成功、默认装配不误伤）。
- **B2 外部渠道生产可管理**：生产装配传入 `listExternal`（复用 `listExternalSessionsFromContexts` 只读投影→`ExternalManagedCandidate`，含 botId/授权 search 投影）；`isExternalSession` 谓词接入 `authorizedRow`——外部 id 的 archive/restore/trash/setRetain 一律 `skipped/not_applicable`（存在但只读），未知 id 仍 `not_found`；管理预览新增外部只读分支（`readExternalTranscriptFromContexts` transcript 只读 + `readOnly` 标记，缺失则诚实 `source-unavailable`+原因）；keyword 对 external 按标题生效、botIds/sources 筛选直通。机器守卫：US2/US3 级测试（列表可见性、按 BOT、keyword、mutation skip 语义）。
- **B3 Trash 过期生产调度**：`ensureOwnerSessionTrashExpiryEvent`（常开、无 opt-in——以删除时展示的 30 天期限为准）+ `InternalEventKind session-trash-expiry` + `TaskScheduler.start` 接入；dispatcher 分支走 `reconcilePending`（先重试 intent 再扫过期，auto-archive sweep 只管归档的注释保持不动）；启动时对账一次（`session_trash_reconciled` 日志）；真实 purge 端口 `buildSessionTrashPorts`（UI 文件/Project 文件、Agent Context `deleteSessionArtifacts` 幂等、search 投影、owner/project 鉴权）。机器守卫：`sessionTrashExpiry.test.ts`（事件常开/kind/执行体）+ `sessionMaintenance.test.ts`（真实端口 purge、跨 owner 拒绝、recorded intent 重启对账）。
- **B4 设置整对象 round-trip**：`sessionAutoArchiveRoundtrip.test.ts`（settings 目录）：富配置（custom provider+model alias、agent、per-bot 策略）save→新 store→load→改策略→save→新 store→load，策略生效且 provider/agent 原样。
- **建议顺手修**：S2 提炼按会话 BOT 路由（`sessionBotIdOf` 解析 `web:<bot>:<user>`，`agent_self`/`content` 命名空间 + receipt `botId` + extractor 输入逐会话；project 回退默认；S2 测试断言 personal/work 分流）；S3 Tabs 单驱动（`bind:value`+`onValueChange` 二写一 → 受控 `value`+`onValueChange`，`onViewChange` 唯一写 `view`）；S4 sanitize 截断走 API 回执声明（PUT/GET 均返回应用后 policy + previewCount，不改静默 clamp 语义，已验证）。
- 验证：回归全过 225 项（会话域 179：assembly 5、maintenance 3、expiry 1、roundtrip 1、extraction 17 含 S2、其余会话/查询/批量/入站/归档/清理既有；相邻域 46：taskScheduler、settings store、sanitize、hostBash store、durable store）；`vite build` 通过；`tsc --noEmit` 新增文件 0 错误（svelte-check 未安装且 npx 无源——未改 package.json；基线 qqbot 缺 SDK/tabs-list svelte 类型/channels hookManager 等错误未动）；隔离冷启动冒烟（临时 DATA_DIR：重启→首开管理页 200→建会话→预览→策略启用→bulk archive/delete→operation 可读→优雅重启→kill -9→状态/策略/operation 全部恢复；trash-expiry 事件与启用后的 auto-archive 事件均落盘）。
- **已知局限**：Phase2 无 document saver（transcript-only 产物显式失败并阻塞归档，见矩阵部分交付）；排队信号经 queued/waiting Durable + 运行中 turn 覆盖，无独立逐会话队列存储。

### 会话管理 Phase 2 UI：提炼并归档/状态/待归档筛选（2026-09-08，已实现，T9 closes #45）

- **范围**：管理页固定「提炼并归档」批量控件（走 T8 门控：仅全部成功、需保留结果已保存、无待审核、来源无变化时归档；失败/待审/并发新消息不归档并明示原因；提炼永不删除）；列表新增提炼状态列（unprocessed/processing/saved/no-useful-information/pending-review/partially-processed/failed）与提炼筛选 + processed-but-not-archived 筛选；预览面板展示精确来源范围（processedThroughId + messageRevision）与保留信息（记忆数/文档标题 + 记忆页链接、待审核候选、失败原因）；purge 后预览与状态接口统一返回 source-unavailable。
- **后端**：`queryManagedSessions` 经 `SessionExtractionStatusSource` 窄端口派生状态（revision 公式与 T8 共用 `buildExtractionRevision`，新消息到达即 partially-processed；空/畸形模型输出只记 failed，永不记无价值）；`SessionBulkService.getSelectionTargets` 供跨页选择复用；`SessionExtractionService.describe` 只读聚合；`POST /api/sessions/managed/extraction` + `GET .../extraction/status`（鉴权+校验+投影）；runtime 接线（assistant-reply JSON extractor + MemoryGateway + 隐私抑制透传，不接 document saver——纯 transcript 产物 siblings 显式失败而非谎称已保存）。
- **机器守卫**：`sessionManagedExtraction.test.ts`（6：状态派生/范围/引用、partial、双筛选、failed≠无价值）、`sessionExtractionBatch.test.ts`（4：门控语义/selection/永不删除）、`sessionManagedApi.test.ts`（+5：解析/校验/投影）、gateway 抑制透传（1）；双语 key 机器核对 105/105。
- 验证：sessions 136/136、memory 98/98 全过；`vite build` 通过；新增文件 tsc 0 错误（`sessionManagedApi` 旧坏 import 与 qqbot 缺 SDK 等基线错误未动）。
- **已知局限**：多 BOT 下 content/agent_self 命名空间沿用默认 botId（未改 T8 构造）；文档引用仅展示标题+docId（尚无独立文档查看路由）；记忆链接到记忆设置页（无单条深链）。

### Project 会话列表合并到共享 store：标题回退与空列表根修（2026-09-07，已实现）

- **症状**：Project 会话生成新标题后在切换会话/项目时回退；列表请求成功后侧栏仍可能显示为空；行菜单会被普通列表刷新卸载。此前历史修复只覆盖了单侧列表，未覆盖 ProjectTree 侧栏与共享 store 各自维护列表的重复状态。
- **根因**：侧栏组件内维护了第二份 `sessionsByProject` 缓存和独立加载入口，与 `projectsStore.sessions` 双写互不同步——显示读一份、刷新写另一份，竞态下旧结果覆盖新状态。
- **根修（共享层）**：`projectsStore` 按项目 ID 持有唯一 `sessionsByProject` 列表及 `sessionListLoading/Errors` 状态；`sessions` 改为由选中项目派生的 getter，不再有可独立写入的副本。侧栏只保留展开/折叠/分页等展示状态；创建、重命名、删除、对话完成刷新统一走 store 的 `newProjectSession/renameProjectSession/removeProjectSession/refreshProjectSessionList`。同项目请求去重（in-flight 复用），按"最新请求所有权"发布结果——过期请求、被变更（rename/delete/create）作废的请求一律不发布，旧结果无法覆盖新状态；后台刷新保留已有行，错误显示为行内 alert + 重试按钮，空列表只在成功读取且结果为空时出现；新建会话先乐观插入列表顶部（服务端即 newest-first），后续列表刷新失败也不会隐藏。会话完成刷新改为携带该会话所属项目 ID（`sessionRuntimeRegistry`/`projectChatStore` 接口相应从无参改为传入 profileId/sessionId），在 A 项目后台完成对话不会再刷错列表。
- **机器守卫**：`projectsStore.test.ts` 扩展为共享 store 行为测试（项目切换保留刷新标题、去重与"旧响应不能撤销改名/删除"、强制刷新乱序所有权、创建会话在后续列表请求失败时仍可见）；新增 `project-sidebar.test.mjs` 联合行为测试，用 vite SSR 渲染真实 ProjectTree + 真实 store，覆盖单测 store 无法捕获的"双列表覆盖"路径；`chat-ui.test.mjs` 守卫断言同步到新所有权机制（`sessionListRequests` 所有权检查）。
- **清理**：删除侧栏重复缓存、`loadSessions/renameSession/deleteSession` 本地实现及赋值同步代码，不保留兼容层；后端会话存储格式与 API 不变。
- **验证**：store 8/8、联合行为测试、tsx 240 项、node 237 项、`svelte-check` 0 错误 0 警告、生产构建通过；隔离实例（mock 服务 + 冒烟页）冷启动走查通过：首发展开加载、选中/行内重命名、服务端标题变更后刷新生效、定时后台刷新期间行菜单保持挂载（行未重建）、断线保留列表/重连恢复、读取失败显示错误 + 重试按钮且行保留、重试恢复、跨项目切换标题不回退、新建会话立即出现、删除选中会话自动回落、中文即时切换。

### 同一消息多张同名图片互相覆盖修复（2026-09-07，已实现，fix #35）

- **症状**：对话中通过复制粘贴添加多张图片（剪贴板给的名字都是 `image.png`）后发送，无论传几张，会话里只能看到最后一张的内容。
- **根因**：`MomRuntimeStore.saveAttachment` 用 `chatId/attachments/<毫秒>_<文件名>` 落盘；`/api/chat` 与 `/api/stream` 都在循环外只取一次时间戳，同一条消息里的多张同名文件得到完全相同的路径，`writeFileSync` 逐个覆盖，所有附件记录最终指向最后一张的字节。该碰撞是共享层的类缺陷，渠道侧同名同毫秒到达的附件同样命中。
- **根修（共享层）**：`saveAttachment` 新增 `reserveAttachmentPath`——目标路径已存在时在扩展名前追加 `-2`、`-3` 序号，保证同名同毫秒附件各自独立落盘；`original` 展示名、类型/媒体类型推断（后缀位于扩展名前，`isImage` 等判断不受影响）不变。所有调用方（Web/Desktop 聊天、Feishu、QQ、Telegram、Weixin）无需逐个改动。
- **粘贴多图补齐**：`clipboardImageFiles` 原来只返回第一张图片就提前返回，一次粘贴多张文件只会有第一张进入待发送列表；现改为返回全部图片文件，未命名条目（同一张图的多格式表示，如 Safari 的 png+tiff）仍只取第一个，保持既有去重语义。ProjectChat 与 ChatView 共用该 helper 与 `ChatComposerShell` 粘贴链路，自动生效。
- **机器守卫**：新增 `storeAttachments.test.ts`（同名同毫秒三次保存得到三个不同路径且字节各自独立、后缀在扩展名前且 `isImage` 保持 true；不同毫秒同名仍走无后缀确定性路径）；`api.test.ts` 新增多张命名剪贴板图片全部附加的回归。
- 验证：storeAttachments/session/storeContextCheckpoint/web attachments/streamRequest/feishu/weixin 渠道测试、桌面 `api.test.ts` 93 项、`chat-ui.test.mjs` 227/228 项（唯一失败为项目侧边栏进行中改动的既有断言 `chat-ui.test.mjs:2986`，与本次无关，已用 diff 验证）、`svelte-check` 0 错误 0 警告。真机冷启动粘贴走查待桌面端下次使用确认。

### 文件面板 HTML 预览暗色可读性根修 + 模板文件默认源码视图（2026-09-06，已实现）

- **症状**：右侧项目文件面板预览 `.html` 文件时，暗色主题下内容接近纯黑、完全看不清（如 Hugo 模板 `layouts/partials/extend_footer.html`）。
- **根因**：`.html` 一律走 sandboxed iframe 渲染预览，artifact 路由直接回吐原始字节——`artifactPreviewUrl` 一路携带的 `theme` 查询参数从未被消费。Hugo 模板不是完整网页，浏览器把模板指令当正文用 UA 默认黑色渲染；iframe 文档画布透明，露出暗色面板，形成黑字叠暗底。无 `<style>` 的真实页面同样命中。
- **根修（共享层）**：`artifactRoute.ts` 新增 `injectPreviewBaseStyle` / `artifactPreviewResponse`——HTML 文档按 `theme` 注入一段置于文档最前的基底样式（dark `#0d1117/#e6edf3`、light `#ffffff/#1f2328`，与桌面 Primer 语法色板一致；页面自有样式在后必然覆盖，真实带样式页面不受影响）；ETag 折入 theme variant，跨主题缓存不会 304 出旧画布；无 theme、Range 请求、超 4MB 走原流式路径。路由层只保留薄壳。
- **视图修正**：`viewerRegistry` 新增 `isTemplateDocument`（头部 4096 字符内含 `{{`/`{%`/`<%`/`<?php`/`<?=` 即模板）；含模板指令的 HTML 默认打开源码视图（CodeViewer 语法高亮，明暗主题均正常），`</>` 源码切换扩展到 HTML，用户可手动切回渲染视图；session 作用域 html 标签页在既有 blob 上顺带解码文本，无二次请求。
- **机器守卫**：`artifactRoute.test.ts` 新增注入位置/主题色/ASCII 注入、ETag theme variant 与 304、无 theme/Range/非 HTML 回退流式等 3 组测试；`viewerRegistry.test.ts` 新增模板嗅探与 hasSourceToggle(html) 断言；`chat-ui.test.mjs` 源码切换重置守卫迁移为 `sourceOverride = null` 契约。
- 验证：`test:projects` 80 项、桌面 tsx 238 项、node 236 项、`svelte-check` 0 错误、`vite build` 通过；隔离冒烟（Chromium 读取注入后文档计算样式）确认 dark 注入为浅字暗底、light 为白底黑字、原始字节复现黑字透明画布。真机冷启动走查（重启桌面端 → 打开 `layouts/*.html` → 暗色查看 → 明暗切换）待用户下次打开桌面端确认。

### 工作区四面板 header 统一为设置页「标题 + 描述」风格（2026-09-06，已实现）

- **问题**：自动任务、技能、Agent、小程序四个工作区面板的顶部只有一条 42px 窄栏里左对齐的纯标题，与设置页（居中列 + 标题 + 灰色描述）的观感割裂。
- **实现**：共享 `PageHeader` 组件新增 `workspace` 变体——复用 `.settings-page-header` 全部样式，仅把标题列宽切到 `--workspace-col`，与面板内容列保持同一几何；`ChatWorkspacePane` 移除旧的 `chat-header` 窄栏，改挂 PageHeader 并为四个面板补中英描述文案（`autoTasksHint` / `skillsSquareHint` / `miniAppsHint`，Agent 复用并改写闲置的 `agentStudioHint`）。`workspace-scroll` 的 `scrollbar-gutter` 改为 `stable both-edges`，滚动时居中列仍与 header 对齐（与 settings-scroll 同理）。
- **侧栏收起态**：展开按钮改为绝对定位在 header 右上列缘（`top:24px; right:28px`）——原设计放左侧会与居中标题文字重叠，且真实桌面端该位置被红绿灯图标占据；走查确认折叠/展开往返正常。
- **机器守卫**：`chat-ui.test.mjs` 两条旧断言（`workspace-header` 左对齐、`workspace-page-title` 拖拽区）迁移为新契约：workspace 面板必须挂共享 PageHeader（含拖拽区）、header 列宽必须是 `--workspace-col`。
- 验证：`svelte-check` 0 错误；前端测试 482 项全过；`vite build` 通过；浏览器预览走查四个面板明暗主题、侧栏折叠/展开均正常（预览环境无法连本地服务，内容区加载态为既有逻辑未改动）。

### 小程序 Toast 不自动消失修复（2026-09-06，已实现）

- **症状**：小程序把内容填入聊天输入框后弹出的「已填入输入框，确认后再发送。」Toast 永不消失，只能手动点 ×。
- **根因**：`miniAppActionFeedback` Toast 的自动消失定时器只写在 `runMiniAppMessageAction` 的 `finally` 里；composer 插入、附件附加、会话打开等路径直接给 `miniAppActionFeedback` 赋值，没有调度定时器。`ChatView.svelte` 与 `ProjectChat.svelte` 两个宿主共有 8 处这样的直接赋值。
- **修复**：两个宿主各新增 `showMiniAppFeedback(text, card?)`，统一负责「设置文本 + 调度 3 秒自动消失；带结果卡片的 Toast 仍保留到手动关闭」既有策略，全部赋值路径改走该 helper；卡片驻留设计不变。
- **机器守卫**：`chat-ui.test.mjs` 原守卫只断言文件里存在定时器模式，拦不住「某条路径漏掉定时器」——本次升级为两条：定时器策略必须内聚在 `showMiniAppFeedback` 内，且 `miniAppActionFeedback` 出现 helper/dismiss 之外的任何直接赋值即失败。已对抗式验证旧 bug 写法会被该守卫命中。
- 验证：`svelte-check` 0 错误；node 测试组 236 项、miniapp messageActions 测试全过。真机冷启动走查（点击小程序填入输入框 → Toast 3 秒自动消失）待用户下次使用时确认。

### Session 列表点击变"新会话"的根修（2026-09-06，已实现）

- **症状**：侧边栏会话明明已更新，点击后右侧却变成新会话（空面板），再点又变回来。
- **根因 1（重连重置视图）**：服务每次断连会把工作区全部清空，重连后 `selectDefaultSession` 无条件重选"最后一次点击过的会话"，且只在 web 列表第一页里找——找不到就掉进新会话草稿或跳到最新会话。运行时按 pitfall 21/22 本来就经常重启，形成"点开又被打回新会话"的乒乓。修复：断连时先 `untrack` 捕获当前视图快照（本地会话 / 项目会话 / 外部只读会话三类），重连成功后恢复该快照；默认选择只在首启且无快照时兜底。草稿发送创建的会话现在也写入恢复锚点（`persistSelected` 进 `onSessionCreated`）。
- **根因 2（跨 owner 读取 404）**：桌面侧边栏跨所有 Web owner 聚合会话，但详情读取信任调用方身份（桌面是 `web:<profile>:web-anonymous`），浏览器等其它 surface 创建的会话点击即 404，面板只剩空状态 hero + 错误横幅——看起来就是新会话。修复：新增共享解析 `resolveWebConversationIdentity` / 扩展 `resolveRunnerChatId`（`src/lib/server/web/runtimeContext.ts`），按 Web 索引里会话的真实 owner 解析身份；`/api/sessions/:id`、`/api/chat`、`/api/stream` 及 stop/steer/waitFor 全部改走该解析，读写与停止/插话都落在会话自己的 agent context 上。
- **根因 3（发送静默换会话）**：`/api/chat` 携带 conversationId 但 owner 不匹配时，`getOrCreateConversation` 会静默续上该 owner 最近一个会话或新建一个——正是"点了会话、一发消息就冒出新会话"的来源。owner 解析修正后该兜底不再被触发。
- **根因 4（标题永远是 New Session）**：自动命名只在第一条用户消息那轮尝试一次，超时/无 key/报错即永久放弃。改为以"标题仍是默认值"为门槛重试（`hasDefaultConversationTitle`），用户改过的标题不会被覆盖；`/api/chat` 与 `/api/stream` 的调用门槛同步更换。
- **顺手修**：工作区存量的 `api.ts` memory 插件 `embeddingProviders` 类型错误（前两个 slice 均标注为"与本改动无关"的遗留）——服务端已返回该字段、类型已声明，仅 `loadDesktopCorePluginDetail` 漏传，本次补上，`svelte-check` 现为 0 错误。
- **机器守卫**：`src/lib/server/web/runtimeContext.test.ts`（owner 解析单测 + 真实存储端到端：浏览器会话经桌面身份可打开、旧身份仍 404 证明修的是解析本身）；`titleSummarizer.test.ts` 重写为"默认标题可重试、自定义标题不覆盖"两条；`chat-ui.test.mjs` 新增重连恢复结构守卫（快照捕获在 teardown 首行且必须 `untrack`、connect 先消费快照再走默认选择、`onSessionCreated` 写恢复锚点）。
- 验证：桌面端 `pnpm test`（tsx 239 + node 236 + cargo 60）全过，`test:desktop-chat` 271 项全过，`svelte-check` 0 错误，`vite build` 通过。真机冷启动走查（重启服务 → 点击更新会话 → 服务中断恢复）待用户下次打开桌面端确认。

### 项目设置弹窗固定尺寸 + 自动任务 tab 样式重做（2026-09-06，已实现）

项目设置弹窗改为固定视口（760px × 86vh），常规/自动任务两个 tab 共享同一窗口尺寸，切换 tab 不再改变弹窗大小，面板内容自行滚动。自动任务 tab 在弹窗内按新设计参考呈现：任务卡片去边框、改分层阴影 + 12px 圆角；卡片标题用新增 `--fs-section`（19/24）字阶，正文/日期用 `--fs-body-lg`（14.5/18）字阶；弹窗标题用 `--fs-page`（22/28）；主/次按钮在弹窗内为 38px 圆形、带内嵌高光与柔和投影；分隔线统一 1px `--separator`。两个新字阶已纳入 chat-ui 排版守卫的 scale map；DESIGN.md 补充了实体检查器弹窗的固定视口与字阶规范。守卫测试、numeric-typography、build 及明暗主题隔离冒烟均通过；svelte-check 仅剩存量 `api.ts` memory 插件类型错误（与本次无关）。

### 内置 Agent 模板行为优化（2026-09-06，已实现）

8 个模板明确任务深度与证据边界：投资研究移除虚构履历和个人仓位指令；英语教练区分即用表达与训练；审查、统计、反馈、产品和策略模板补充范围及数据口径；Mini App Creator 按实际技能位置构建。7 个模板升至 1.0.1，Mini App Creator 升至 1.3.4。真实模板安装与提示词合并回归覆盖角色覆盖、Bot 规则保留和正文单次注入；模板更新沿用先备份用户修改副本的机制。相关测试 36 项通过；尚未进行真实模型回答质量 A/B 评估。

### 协作规则的自主执行与批准边界（2026-09-06，已实现）

已授权范围内的实现、排错和验证持续执行，进度更新不要求重新批准；关键决策、临时补丁和未授权部署事项保留用户确认。验收要求区分必需验证与额外打磨，文档按实际影响同步。规则以 `AGENTS.md` 为准。

### 小程序主页面改为 macOS 启动台，管理收进二级视图（2026-09-06，已实现）

- **问题**：小程序主入口长期是一张管理页（版本号、状态 Badge、启停开关、卸载菜单、更新按钮铺满首屏），打开它的主要动机却是"启动一个小程序"，两种任务密度错位。
- **启动台（默认视图）**：新增 `MiniAppsLaunchpad.svelte` 作为 `miniapps` 工作区面板的挂载组件。默认视图是 macOS Launchpad 式图标网格：每个磁贴只有 64px squircle 图标（`MiniAppIcon` 新增 `launchpad` 尺寸）和名字，点击即打开应用；只显示 `enabled && status === "active"` 的可用应用，停用/出错的应用不再占据首屏，其原因统一在管理视图可见。磁贴 hover 亮起中性 fill、按下图标回缩（scale 0.94），入场按索引做 ≤288ms 的错峰淡入；工具栏保留工作区统一三件套——搜索（名称/描述过滤）、已安装/启用/出错计数、主 CTA「管理小程序」。空态三分：未安装任何应用（EmptyState + 去安装）、全部停用（提示 + 去管理）、搜索无结果。
- **管理视图（二级）**：原 `MiniAppsManager` 原封不动下沉为启动台的 manage 视图（顶部「返回启动台」返回），安装/启停/卸载/更新/AI 路由指引全部能力不丢；Settings 不挂载该组件的既有契约不变。
- **机器守卫**：`chat-ui.test.mjs` 新增启动台契约测试（仅可用应用上墙、磁贴即按钮、manage 视图复用 manager、reduced-motion 关闭入场动画），并把 workspace 居中规则、唯一挂载点两条既有断言迁移到新组件。
- 验证：`chat-ui.test.mjs` 227 项全过；`vite build` 通过；`svelte-check` 仅剩工作区既有的 `api.ts` Memory 插件类型错误（与本改动无关）。真机冷启动走查待用户下次打开桌面端时确认。

### Prompt Box 删除同步复活修复与新图标（2026-09-06，已实现，v1.1.0）

- **删除后被同步"复活"的根因与修复**：远端 pb.onlinestool.com 的 API 只实现 list/create（实测 `DELETE /api/prompts/:id` 鉴权通过后返回 "Endpoint not implemented"），本地删除无法上报；下次刷新/同步时 `upsertFromRemote` 把远端仍存在的提示词原样重建。本地 SQLite 新增 `deleted_remote_prompts` 墓碑表：删除带 `remote_id` 的提示词时记录墓碑（`Store.delete`），同步拉取时跳过已墓碑的远端条目（`upsertFromRemote` 返回 null），sync 结果新增 `skippedDeletedCount`。墓碑表由 SCHEMA `CREATE TABLE IF NOT EXISTS` 在旧库上自动补建，无需迁移。
- **Agent 删除拿不到 ID 的修复**：`list_prompts` 的文本输出此前不含 ID，通过对话让 Agent 删除/更新/查看提示词时无法构造 `delete_prompt` / `update_prompt` / `get_prompt` 调用。每条摘要现在携带 `(id: …)`。
- **新图标**：替换原莫兰迪渐变抽象图形（语义不明），改为与其他内置小程序一致的扁平多彩分层风格——打开的盒子向上冒出灵感星光、盒身正面带终端提示符 `>_`，紫色系（现有蓝/琥珀/绿/青/橙之外无冲突）。应用内头部 "PB" 文字徽标同步替换为 `icon.svg`（同源相对引用，CSP `img-src 'self'` 允许），并删除死代码 `copy.title`。
- **版本 1.0.0 → 1.1.0**：随包内容变更同步 bump 版本号，已安装副本经 Mini Apps 管理器收到更新提示。前次 v1.0.7 的 UI 修复未 bump 版本，已安装副本从未收到该更新——本次一并纠正。
- 机器守卫：`promptBox.test.ts` 新增"删除后同步不复活"回归测试，覆盖 HTTP 与 Agent 工具两条删除路径，精确断言 `pulledCount` / `skippedDeletedCount`，并守卫同步期间绝不向远端发出非 GET 请求（远端只读契约）；`list_prompts` 输出必须携带 id 的断言。
- 验证：miniapps 全套 208 项、desktopMiniApps 7 项测试全过；用真实旧库副本（88 条全部带 remote_id）端到端实测：墓碑表自动补建 → 删除 → 模拟远端仍返回该条 → 同步不复活、新远端条目正常导入。图标在明暗两种背景、512px 与 48px 尺寸下渲染检查通过。

### 项目文件/附件下载走原生保存对话框（2026-09-06，已实现）

- **修复桌面端所有文件下载点击无反应**：Tauri 的 WKWebView 会静默丢弃 `<a download>` 触发的下载（未注册 `on_download` handler），blob URL 方案在原生壳里完全不生效。新增共享 helper `apps/desktop/src/lib/saveFile.ts`（`saveBlobAsFile`）：Tauri 环境经 FileReader 转 data URL 后调用既有 `save_file_dialog` 原生命令（Mini App 保存图片同通道）弹出系统保存对话框并写盘；纯浏览器 dev 环境保留 anchor 下载兜底。
- 全部 5 处下载调用点统一走 helper：ArtifactPanel 项目文件下载（用户报告的入口）、ArtifactPanel 会话文件 tab、ArtifactPanel 附件列表、ChatView 会话附件、ProjectChat 会话附件。用户取消保存对话框不报错。
- 顺手修正 `downloadAttachment` 硬编码 `"personal"` profileId 为 `profileId || "personal"`（与同文件其余调用点一致，修复多 Bot 会话附件下载 404，同 CHANGELOG 记载过的旧坑）。
- 机器守卫：`chat-ui.test.mjs` 新增断言——所有下载来源文件必须导入 `saveBlobAsFile` 且不得再手写 `anchor.download`；`lib/saveFile.ts` 必须含 `save_file_dialog` 与 Tauri 检测。
- 验证：226 项 Desktop UI 结构测试全过；vite build 通过；`svelte-check` 仅剩工作区既有的 Memory `embeddingProviders` 类型错误（进行中的无关改动）。Rust 侧无改动（`save_file_dialog` 命令已在线上验证）。另用 curl 实测线上服务 raw 接口对报告中的未跟踪文件返回 200 / 46490 字节（hugo_blog 项目），证实服务端链路本就正常、问题纯在 WebView 层。原生保存对话框弹出已由用户在 `tauri dev` 运行实例中实测确认（2026-09-06）。

### 输入框回车发送 + 输入法上屏守卫（2026-09-06，已实现）

- 主会话与项目会话的 composer 快捷键互换：**Enter 发送，Shift+Enter 换行**（textarea 原生行为，不再拦截），Cmd/Ctrl+Enter 继续发送，Alt+Enter 不拦截。
- **输入法上屏不再误发送**：守卫改为 `event.isComposing || event.keyCode === 229`——桌面端跑 WKWebView（Safari 内核），确认组合的回车 keydown 在 `compositionend` 之后才触发、`isComposing` 已复位为 `false`，只查 `isComposing` 会漏掉；`keyCode 229` 补上这个洞。Slash/`@` 联想菜单的 Enter 选中同样加固，输入法组词时回车只上屏、不选词不发送。
- 中英 placeholder 提示同步更新（`enterHint` / `queueHint`）。
- 机器守卫：`chat-ui.test.mjs` 断言两处 composer 都有 IME 双重守卫与 Shift/Alt 放行，联想菜单排除 keyCode 229。
- 验证：225 项 Desktop UI 结构测试全过；`svelte-check` 仅剩工作区既有的 Memory `embeddingProviders` 类型错误（进行中的无关改动）。

### 审批续跑显示修复（2026-09-06，已实现）

- Host Bash 与通用工具审批共用后台回答记录器：工具活动结构化保存，最终回答绑定 Agent 来源条目，替换回答不再追加重复消息。
- Desktop 按服务端运行状态刷新，支持超过 15 秒的续跑、再次审批及切换会话；续跑耗时独立保存并在重载后保留。
- 已为问题会话备份并重建两次续跑的展示元数据，原始模型上下文与审批记录不变。真实项目会话接口确认孤立进度行归零，恢复 12+8 条工具活动及 57.078s/40.871s 的续跑耗时；39 项服务端与 115 项 Desktop/API 回归通过。原生冷启动验证受电脑控制工具无法识别开发版程序阻塞。

### Host Bash 审批执行与结果回写（2026-09-06，已实现）

- 共享 SQLite 中的 Host Bash 请求由专用执行器处理，通用 Broker 不再提前消费批准或拒绝；工具结果按审批 ID 回写，支持带参数和重复命令。
- 验证：临时数据库分派、真实无副作用命令执行、精确回写、拒绝与终态保护，以及相关回归共 51 项通过；原生应用冷启动续跑待验证。

## 2026-09-06

### 沙箱 loopback 可达 + 审批卡片三重兜底（已交付）

- **沙箱内 localhost 永久不可达的根修**：`@anthropic-ai/sandbox-runtime` 无条件注入 `NO_PROXY=localhost,127.0.0.1,::1`（HTTP 客户端直连本机），而受限网络的 seatbelt profile 只放行其过滤代理端口（直连默认拒绝）——两者叠加导致沙箱内任何 localhost/局域网服务都连不上，且报错与服务未启动完全一致、无法区分。`buildEffectiveSandboxConfig` 现固定带 `allowLocalBinding: true`，seatbelt 生成直连 loopback 的 outbound/bind 规则；`allowedDomains` 域名过滤继续只管外部主机。机器守卫：`sandbox.test.ts` 断言 effective config 必须含 `allowLocalBinding`；seatbelt 规则已用 `sandbox-exec` 实测（同场景 curl 由 exit 7 变为 HTTP 200）。
- **设置页审批列表可直接处理**：待审批行新增「批准一次 / 一直允许 / 拒绝」操作。服务端 `resolve_approval` 新增操作员表单（仅 `requestId`+`decision`，无 chat 上下文）：按 ID 全局定位记录，`web:` 作用域复用既有 chat 卡片的批准-执行-恢复机械（隔离实例实测 reject 与 approve-once（含命令执行）全链路），其它渠道记录支持拒绝、批准则提示回对应渠道处理。
- **打开/切换会话即认领 pending 审批**：`ConversationController.adoptPendingApproval()` 在主会话与项目会话的 `selectSession` 里调用——此前卡片只在"轮次内的 SSE 推送"和"轮次结束后一次性轮询"两个窗口出现，错过（流中断、Stop、重启应用）即永久沉没，用户只能干等。
- **SSE 单帧容错**：`consumeDesktopSse` 逐事件隔离 handler 异常（协议 `error` 帧与 abort 照常上抛），一个坏帧不再吞掉后续所有帧（此前审批事件可能跟在坏活动帧后面被一起丢掉）。
- 验证：sandbox 12 项、desktop-chat/hostBash/webCommands 相关 18+14 项、api.test 92 项全过；根构建通过。`svelte-check` 仅剩工作区既有的 Memory `embeddingProviders` 类型错误（进行中的无关改动）。**服务端改动（loopback 放行、操作员解析端点）需重启 dev 栈后生效；前端部分随 vite HMR 即时生效。**

### Desktop 侧栏小程序列表移除（已交付）

- 左侧导航只保留"小程序"主入口（打开小程序管理面板）；删除项目树下方的"小程序"最近使用列表区，两者功能重复，管理面板已覆盖浏览、打开、安装、启停全部能力。
- 随之删除的孤儿代码：`MiniAppsSidebarSection.svelte` 组件、ChatSidebar 的 4 个相关 props、ChatView 的展开状态（`MINIAPPS_EXPANDED_KEY` localStorage 键与 toggle 函数）、store 的 recent 列表辅助（`markMiniAppUsed`/`recentMiniApps`/`hasMoreThanRecent`/`openableMiniApps` 与 `recentIds` 状态）、`MiniAppIcon` 的 `sidebar` 尺寸变体、styles.css 侧栏列表/角标样式块，以及中英双语的 4 个孤儿文案 key（`miniAppsRecent`/`miniAppsSeeAll`/`miniAppBadgeCount`/`miniAppBadgeDot`）。
- 保留：服务端 `ctx.badge` 角标能力与打开面板时经服务端目录回收角标的链路不变（角标当前无展示面，是否随之下线属平台能力决策，另行确认）。
- 验证：225 项 Desktop UI 结构测试（含同步更新的断言与新的"导航是唯一侧栏入口"守卫）、8 项静态守卫测试、9 项 miniapps/turn 单元测试、vite build 全部通过；`svelte-check` 仅剩工作区既有的 Memory `embeddingProviders` 类型错误（与本改动无关）。

## 2026-09-05

### Desktop Session 计划执行闭环（已交付）

- 计划接受后在原 Session 的下一轮直接执行，思考、工具、产物、检查与后续反馈共享同一上下文；右侧计划面板只投影结构化进度，不再创建或替代一个独立执行会话。
- 计划状态明确区分执行、等待授权、受阻、执行结束待检查与完成。待检查不再占用左侧“进行中”列表；确认完成后不再显示暂停或取消，旧任务的“继续执行”入口改为返回当前对话提出修改。
- `exitPlan` 使用稳定工具调用 ID 作为计划 ID，修复同一 Session 创建第二个计划时，展示卡片与持久化记录 ID 不一致导致的“计划不存在”。
- 同一用户轮次的多段终止回复合并为一个回答容器，完整保留文本和过程轨迹；执行过程恢复为无边框、透明背景的紧凑披露，回答状态文案改为“回答完成”。
- 验证：50 项计划/会话/持久化/运行时测试、18 项 Desktop 对话单元测试、225 项 Desktop UI 结构测试、root 与 Desktop 构建通过；隔离服务中完成暗色主题与右侧面板并排走查。`svelte-check` 仅剩工作区既有的 Memory `embeddingProviders` 类型错误。

## Archive Index / 归档索引
- [2026 Q2 Features Archive (Apr - Jun)](docs/archive/features-archive-2026-Q2.md)
- [2026 Q1 Features Archive (Feb - Mar)](docs/archive/features-archive-2026-Q1.md)
- [2026 Q3 Features Archive (Jul - Sep)](docs/archive/features-archive-2026-Q3.md)

---

9 月 4 日及更早的实施记录见 [2026 Q3 功能归档](docs/archive/features-archive-2026-Q3.md)。
