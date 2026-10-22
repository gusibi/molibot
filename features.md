## 2026-10-21 — 会话顶栏 Agent 标识与历史导航

已有会话标题旁显示 Agent 名称，保留渠道来源；顶栏 History2（Duotone）按钮打开当前 Agent 的全部对话，未归属会话打开未归属历史。可输入的 Web 会话不显示刷新；外部只读会话的刷新按钮位于底部只读提示旁。外部会话顶栏依据外部会话身份显示操作，不受本地草稿状态影响。

## 2026-10-21 — 计划页连接提示布局修复

计划列表的实时连接与更新时间提示使用独立语义样式，与列表正文对齐，采用主题次级文字和紧凑间距；断线长文案在窄窗口内换行。

## 2026-10-21 — Agent 顶栏图标

Agent 顶栏的文件与附件入口使用 Reicon Library（Filled），Agent 设置入口使用 Tuning3（Duotone）。按钮尺寸、提示和操作保持不变。

## 2026-10-21 — Project 活动隔离与 Agent 首页输入恢复

Agent 导航、首页与总览的活动按会话所属范围过滤，Project 会话即使使用 Momo，也不进入 Agent 活动状态与活动历史；同一 Agent 的普通会话仍正常显示。模型加载状态绑定具体 Session，加载期间返回首页可立即输入，旧响应不能覆盖新会话或已缓存的模型选择，失败后可重试。

根因分别是活动投影遗漏 Project 范围，以及异步加载状态未绑定会话。既有 Agent 归属守卫只验证执行者，模型守卫只检查加载期间阻止发送，未覆盖 Project 排除与中途导航。新增临时会话存储回归与真实加载函数回归；沿用现有作用域及异步响应守卫规则，无需新增协作规则。

验证：新增定向回归均连续 5 次通过，Project 用例使用临时落盘会话并重新创建 store；WebKit 导航、实际发送与服务重启恢复用例连续 5 次通过。活动投影 20 项、活动轮询 10 项及模型加载界面守卫通过；根与桌面类型检查、构建通过，桌面检查 0 错误、0 警告。未更新当前安装的原生 App，未中断用户服务；全量 `pnpm verify:feature` 留待主动执行。

## 2026-10-21 — Personal Agent 客户端身份收口与归属核对

按同批 `PA-*` 规则完成 Desktop 侧（PA-U）与启动核对（PA-I6）。

- Agent 首页的最近历史改为按 Agent 限定的服务端查询（limit 5），不再从 100 行全量列表里截取；未归属探测保持独立的轻量查询。
- `DesktopAgentItem` 新增服务端计算的 `canExecute`（启用且不在删除中），Composer 与空状态不再自己拼 `enabled` 判断；Agent 列表的默认置顶 + 最近活动排序也移到服务端，侧边栏不再重复排序。
- 草稿携带显式 `agentId`：新增 `agentDraftKey()` 与 `SessionDraft.agentId`，`ChatView` 不再用 `agent-<id>` 伪 Profile 并靠 `startsWith`/`slice` 反解身份；发送时把 Agent 作为独立参数交给会话创建接口。传输 Profile 仍是真实 Web Profile。
- 重启恢复改为打开上次停留且仍可执行的 Agent 页面，而不是一律回到默认 Agent；外部会话缺少归属时显示“未分配”，不再回退显示全局助手名。
- 新增 `sessions/agentOwnership.ts`：启动时比较 sidecar 权威字段与 `ui.conversation.agentId` 镜像，冲突只写 `session_agent_ownership_divergence` 结构化日志，不自动改写。

验证：Desktop 行为用例 536 项通过（2 项 providerLogos / CommandSystem 为既有失败，文件不在本次改动内）；源码守卫 317 项通过（3 项 TraceSection 与 onDestroy 相邻断言为既有漂移）；根 `pnpm check` 与 `pnpm desktop:check` 均 0 错误 0 警告；会话身份/生命周期/归属/记忆/外部会话定向 134 项通过。隔离实例浏览器 UI：WebKit `@navigation` 7/7、Chromium `@smoke` 6/6。UI 复核抓到并修复一处回归：首页历史改为异步 scoped 查询后切换 Agent 会先闪空历史，现先同步铺一帧内存列表再替换。未运行 `pnpm verify:feature`、原生 App、真实渠道与付费 Provider。

## 2026-10-21 — Personal Agent 规则落地：身份解析、删除三态、认领与记忆范围

按 [Personal Agent V1 规范](docs/requirements/personal-agent-experience-v1.md) 的 `PA-*` 规则实现第一批结构约束，未新增产品能力。

- 新增唯一身份解析模块 `sessions/executionIdentity.ts`：`agentOfBot` 把“已配置 Bot 空绑定 / Bot 不存在 / 绑定到已删除或缺失 Agent”分开，`resolveExecutionIdentity` 统一产出 `new | pinned | recovery` 与 `reuse | create`。渠道运行时、Web runtime、会话创建、系统提示预览、定时任务、Trace 与活动视图、历史迁移全部改调它；`configuredSessionAgent`（零调用者）与 `app/desktopAgents.ts` 里一套未被路由使用的 save/delete 影子实现已删除。根因属于“同一条规则以同一内联表达式散落在多个入口”，机器守卫 `executionIdentity.test.ts` 扫描 `src/lib/server`、`src/routes`、`src/lib/shared`，禁止在解析模块之外直接读渠道绑定并兜底。
- 删除改为持久化三态 `active → deleting → deleted`（`pendingAgentDeletions`）：先 `agentBlockers` 返回结构化的渠道/任务/运行/审批/Host Bash/未完成 Durable 对象，界面可直接列出；归档失败停在 `deleting`，重启后重试；后两步幂等。删除中的助手立即拒绝新对话与续聊（`requireEnabledAgent`）。
- 外部会话认领真正落盘：`claimExternalSessionAgent` 写入 session 元数据并在重启后保持；`listAgentSessions` 改为信任元数据归属而不是目录名，认领后的历史仍可列出，且不授予执行权限。
- 记忆范围禁止 Bot 冒充 Agent：`namespaceForDomain(agent_self)` 与 `promptMemoryNamespaces` 不再回退 `botId`，无 Agent 身份的范围不产生 `agent:` 命名空间；反思候选、Agent 自述工具与会话提炼同步改为按会话 Agent 归属，缺少身份时明确失败而不是写进 Bot 命名空间。
- 设置新增 `pendingAgentDeletions` 并纳入 sanitize、序列化、ID 复用校验与整对象 round-trip 回归。

验证：`executionIdentity` 契约与源码守卫、会话身份/关联/迁移/runtime、生命周期、设置 round-trip、记忆命名空间与 Gateway、外部会话、Trace/活动、提示词叠加、模型路由、渠道命令、恢复审批与会话提炼共 369 项定向用例通过；`pnpm test:desktop-chat` 324 项通过；`pnpm check` 通过。Trace/活动与提示词叠加用例的夹具补充了真实存在于设置中的 Agent（原先绑定到不存在的 Agent，按新规则应视为未分配），断言语义不变。未运行全量 `pnpm verify:feature`；原生 App、真实外部渠道与付费 Provider 未验收。剩余：PA-I6 启动核对、PA-U 客户端身份收口。PA-H4 已补显式断言。`agent/core/runner.test.ts` 与 `piRecovery.continuity` 为长时程集成用例，本次未执行。

## 2026-10-20 — 桌面思考实时展开，回答时折叠

Chat 与 Project Chat 将模型实际返回的思考集中展示，思考时自动展开，正文开始输出后折叠，支持手动展开；后续正文增量不重复折叠。历史与停止后的思考默认折叠，工具详情保持独立，不重复展示思考。思考区使用透明披露，支持中英、明暗主题和窄窗口；没有思考内容时不显示空区域。

共享 Pi 运行适配器同时转发整块快照与增量中的文本，避免流式思考或回答丢失前缀。根因属于事件投影遗漏，新增临时数据库回归验证实时文本与持久化内容一致；既有界面结构守卫没有覆盖真实流式内容，现补充隔离模型与 WebKit 交互用例。已有共享层与行为测试规则适用，无需新增长期协作规则。

验证：两条 WebKit 交互用例各连续 5 次通过，另有纯文本无思考用例通过，覆盖隔离服务重启、页面重开、中英、明暗与 600px 窗口。Pi 适配器 27 项回归通过，新增前缀守卫连续 5 次通过且已证明修复前失败；桌面定向单元测试 14 项、界面守卫 5 项、模型测试服务 8 项通过。根与桌面类型检查、构建通过，桌面检查 0 错误、0 警告。当前安装的原生 App 未重新构建或验收，用户服务未重启；全量 `pnpm verify:feature` 留待主动执行。

## 2026-10-19 — 调用链报告样式两处修正（重复标签与裸时间戳）

调用链报告（traceViewer 渲染器）两处展示修正：① 时间线根行此前渲染成「本轮执行 / 本轮执行」两行重复——run 节点在报告查询里保留的 name 是 sessionId，旧渲染器对 run 行强制用类型标签覆盖 name，与行首类型 kicker 撞成重复。现在 run 行固定显示单个「本轮执行」（kicker 与行名相同则不再渲染第二行），其它行（模型/工具/输入处理）的类型+名称两行结构不变；② 报告 footer「快照生成于」与展开详情里的「开始/结束」字段此前输出裸 ISO 8601（UTC 带 T/Z），现在统一格式化为本机本地时间 `YYYY-MM-DD HH:mm:ss`（报告在本机渲染，本地时间即用户时间；公开快照在发布时定格）。`report.test.ts` 新增用例钉住两条（修复前失败、修复后通过）；`plugin.test.ts` 在裸 tsx 下因 `?raw` 的 .md 模板导入无法加载，经 HEAD 基线对照为既有环境限制（打包器 runner 可跑），与本次无关。

验证：`report.test.ts` 13/13；根 `pnpm check` 通过；根 `pnpm build` 完成，修复已进预构建产物——正在运行的服务需重启后才生效（未主动重启用户服务）。

## 2026-10-19 — 调用链抽屉层级根修与 tablist 警告清理

调用链抽屉（TraceReportDrawer）打开时右上角关闭按钮与底层窗口 header 按钮重叠。根因是层级囚禁：抽屉挂在 ConversationTranscript 内部，而会话内容都在 `.workspace-main`（`position: relative; z-index: 1`，用于压过窗口拖拽层）的 stacking context 里，窗口 header（z-index 31）是其兄弟层，所以抽屉内部的 `z-index: 140` 永远画不过 header。同款样式的 MemoryTraceDrawer 挂在 `<main>` 之外所以无此问题。修法遵循既有模式（bits-ui `Portal`，同 ConversationRow/Dialog）：抽屉 Portal 到 body，与 header 的层级比较回到根上下文，`z-index: 140 > 31` 正常压过。经隔离实例浏览器探针双向证明：body 层 backdrop 在抽屉关闭按钮位置命中自身；同标记挂在 transcript 内则被底层 header 按钮命中（即用户所见 bug）。结构断言钉死 `Portal to="body"` 防回归。

顺手清理：AgentCityInspector 的 tablist 宿主从 `<nav>`（地标元素不能挂交互角色，vite build 每次报警）换成 `<div role="tablist" tabindex="-1">`（roving focus 仍在 tab 按钮上，容器不进 Tab 序），`svelte-check` 从此 0 错误 0 警告，`vite build` 无 a11y 警告。

验证：`chat-ui.test.mjs` 313/316（3 个失败为既有漂移，见上条）、`agentActivityPolling.test.ts` 10/10、`svelte-check` 0 错误 0 警告、`vite build` 通过。真实抽屉的端到端用例受 trace viewer 插件在隔离实例中未启用所限，以结构断言 + 浏览器层级探针（已删除的一次性验证）代替，如实记录。

## 2026-10-19 — 桌面会话头部刷新归位、文件入口换图标、成功回合隐藏状态行

三处桌面 UX 修正（`apps/desktop`）：① 头部「刷新对话」按钮从 Agent 首页/外部视图改为只在会话详情显示，点击除唤醒共享轮询外还会 `chatStore.reloadActive()` 真正重载当前会话内容，运行中（`sending`）禁用；② 文件与附件入口图标从 duotone FolderOpen 换成 reicon outline `Files`（两个文档，贴合「Agent 生成的一些文件」语义，与头部其余 outline 图标一致）；③ 会话时间线中成功（complete）回合不再渲染「✓ 已完成」状态分隔行，仅失败/中断/等待审批/未知显示并保留错误详情；`TurnStatus.hasAnswer` 字段随之删除，i18n 中 `sessionStatusComplete/NoReply/Recovered` 三个死键清除。注意副作用：先前「已完成但中途出错后恢复」的恢复说明随成功分隔行一并隐藏，错误细节仍可在运行记录查看。

验证：新增浏览器行为用例 `chat.spec.ts`（header refresh lives in the session detail，覆盖首页无刷新→会话详情有刷新→成功回合无状态行→失败回合出现 Run failed 分隔行）连续 5 次通过；`transcriptStatus.test.ts`、`agentActivityPolling.test.ts`（标记断言同步更新）10/15 项通过；`chat-ui.test.mjs` 313/316 通过（3 个失败经 HEAD 基线对照为用量/Trace/AgentNavigation 遗留测试漂移，与本轮无关）；`svelte-check` 0 错误（剩 1 个 AgentCityInspector 既有 warning）。覆盖清单见 `tests/ui/COVERAGE.md`「会话头部刷新与回合状态行」。

## 2026-10-18 — Issue #65：计划与 Room 原生复核、恢复审批修复

计划已在隔离 Tauri 窗口验证生成保存 31 步、编辑与草稿恢复、安全暂停、跨 Session 接续、整体验收、返工重新批准和重启回读；公共 API 删除后原生列表实时归零，旧计划读取与恢复返回 410。Room 已验证普通与 Project 房间、定向与多人回复、审批保留写入资格、跨房间独立执行、停止、成员移除/重入，以及连续两次服务中断后的人工核对恢复。中英、明暗与最小窗口走查完成。原生麦克风实录仍待授权，#65 尚未全部验收。

修复三个共享层问题：测试模式不再自动启动 Durable worker 与后台补投；Room 真实审批入口允许身份匹配的持久化恢复审核，普通非活跃工具审批仍拒绝；等待审核的恢复记录在再次重启后仍保留恢复所有权。恢复审批回归改走真实 Room HTTP 入口，覆盖批准、拒绝、重复点击与审核中再重启，避免直接调用 Broker 掩盖入口缺陷。

验证：计划/Durable/MCP/API 定向 59 项、Room/API 定向 36 项、普通/渠道恢复与候选筛选 4 项通过；两次重启恢复 3 项与计划 API 3 项各连续 5 次通过。后台启动故障注入、恢复审批真实入口和候选筛选均已证明修复前失败。根类型检查与构建通过；全量 `pnpm verify:feature` 按日常验证规则留待主动执行，自动化原生测试框架仍未建设。范围和未验收项见 [本轮证据](docs/work/progress/issue-65/validation-2026-10-18.md)。

## 2026-10-18 — 用量归属补齐：Project 与 Mini App 伪 Agent（实现完成）

症状：用量页 Agent 筛选出现「未记录 Agent」，当天请求消耗无法归属。根因是两类记账路径缺少 `agentId`：Project 模式会话在共享层三处都不携带 Agent 身份（project 池构造不传 runtimeIdentity、runner 对 `ctx.project` 不写 session origin、会话记录本身无 agentId 字段），其全部模型调用（含子代理、扩展流、图片生成 usageScope）落入未归属；Mini App AI 调用（`miniapps/aiFacade.ts` 四处）按设计只有 appId，从不带 agentId。

修法（不引入假 Agent 进语义身份）：`MomRunner` 新增 `usageAgentId` 派生 getter——`runtimeIdentity?.agentId ?? (activeProject ? "project" : undefined)`，五个记账点全部改用；`createMomTools` 新增独立的 `usageAgentId` 选项（仅进媒体 usageScope，语义 `agentId` 继续喂 disabledTools/actor 等，不泄漏伪 Agent）；Mini App 四处记账补 `agentId: "miniapp"`。用量维度里 Project 会话归到 `project`、Mini App 归到 `miniapp`；历史无归属记录维持「未记录 Agent」不变。定时任务路径经 `admitStoredAgentSession` 本就有归属，未改动；Trace 页是另一条 fact 管线（有自己的 bot→default 兜底），未在本次范围。

验证：新增 `piProjectUsage.test.ts`（project 运行记录全带 `"project"`、run 结束 activeProject 清空、非 project 会话保持无归属）与 aiFacade 归属用例，均先证修复前失败（`[null]`）、修复后通过，并连续 5 次通过；`piChildUsage` / `tracker.miniapps` / `desktopUsage` / `desktopMediaTasks` 共 11 项通过；`pnpm check` 通过。服务端改动需 `pnpm build` + 重启服务后生效。

## 2026-10-18 — 桌面服务孤儿 sidecar 自愈（实现完成）

症状与根因链：上一轮桌面进程树被硬杀，supervisor 来不及 SIGTERM 它的 sidecar，服务进程（PPID 1）成为孤儿并继续持有 `service.lock` 与 3040 端口；用户重开 App 时，supervisor 只在启动时读一次 `service-state.json` 并给 2 秒握手窗口去收养，当时孤儿服务事件循环卡顿未应答，窗口永久错过；此后 supervisor 进入 `supervise()` 拉新循环——`choose_port` 避开被占端口、子进程撞租约 exit 73、按崩溃退避重试，永不回到发现/收养路径，App 界面永远无法就绪。

三处根修（`apps/desktop/src-tauri/src/supervisor.rs` + `scripts/runtime/parent-watchdog.mjs`）：

1. 租约冲突（子进程 exit 73）触发 `rediscover_conflicting_owner`：命令感知地等待记录所有者的握手（≤15s），按 `conflicting_owner_action` 处置——兼容托管服务直接收养并移交 `supervise_adopted`（其既有深度健康探测继续兜底"收养到僵死服务"的情形）；版本旧于随包构建的托管服务先停后接管；外部服务与不兼容服务按启动路径同样的规则上报状态。决策纯函数与启动等待窗口（存活所有者 15s / 死亡 pid 立即回落 2s）均有单元测试。
2. 启动收养窗口由固定 2 秒改为按所有者存活状态分级，消除"一次慢应答永久错过收养"的触发条件。
3. 桌面托管 sidecar（`MOLIBOT_DESKTOP_MANAGED=1`）安装父进程守望：每 5 秒检查 ppid，reparent 到 1 即自发 SIGTERM 走既有 shutdown（释放租约、500ms 强退），单次信号后停止轮询；standalone/CLI 不受影响。模块经可选加载器接入，缺失时降级为一条 stderr 日志。

验证：cargo supervisor 单元测试 26 项通过（新增 5 项守卫：冲突收养/替换/外部不误杀/无应答继续拉新/收养窗口分级）；`parent-watchdog.test.mjs` 4 项通过并入 `test:service-bootstrap`；真实进程端到端——临时数据目录 + 短命父进程硬杀后 sidecar 约 1 秒自行退出且服务曾完整启动至 ready；修复后真实 App 冷启动恢复、sidecar 日志无 exit-73 事件；隔离实例 Usage/Trace 浏览器用例 2/2。运行中的服务已带新启动器重启一轮确认。

## 2026-10-18 — Trace 调用趋势与 Agent 执行表现（实现完成，原生验收待验证）

Desktop Trace 顶部优先展示运行次数、运行完成成功率、已记录模型美元估算和缓存命中率。Agent 对比表直接显示同一组指标，点击 Agent 或使用现有筛选会同步更新指标、曲线与列表。运行成功率仅使用明确成功/失败的运行记录，不混用模型请求结果，也不代表任务质量评分；取消、等待与未完成排除在分母外。

新增模型、普通工具、MCP 三条调用次数曲线：今天/昨天按本地小时，近 7/30 天按本地日期，空桶补零；按调用开始时间归桶，明细分页不截断趋势。MCP 按运行时规范的 `mcp__` 工具标识单列，普通工具曲线不含这些 MCP 调用。图例可隐藏曲线并自动调整纵轴，悬停或键盘聚焦时间点查看精确次数；线型与主题颜色共同区分系列。

模型调用事实在脱敏前提取数值费用估算，SQLite 分析投影只读取该数值，不暴露原始 usage 对象。费用只合计已记录的模型估算并显示覆盖次数；无费用记录显示未知，明确记录的零费用保留零。历史记录可能缺少估算，不包含工具/MCP 外部服务费。缓存命中率按缓存读取 ÷（普通输入 + 缓存读取 + 缓存写入）计算，无输入分母显示未知。

## 2026-10-18 — Desktop 用量与 Trace 展示及查询优化（实现完成，原生窗口验收待验证）

用量默认查看今天，用横向指标条展示 Token 总量、请求数、缓存读取和命中率；主趋势图带刻度，环图区分普通输入、缓存读取、缓存写入和输出。模型、Agent、Bot、渠道列表默认展开，以对齐的数值和占比列比较，支持点击筛选和展开完整排行；API、Session 与逐条请求保留在详情中。同一 Provider / 模型跨 API 合并排行，API 仍单独统计。缺失历史 Agent 归属明确显示未记录，不以当前 Bot 绑定推断。

Trace 首屏展示模型请求总数、成功、失败、成功率与全部结果构成，并提供模型、Agent、渠道和 Bot 来源排行；有数据时工具、技能汇总直接展示，逐条请求与诊断默认折叠。成功率只使用成功与失败请求，取消、阻止和未完成另列；重试按独立请求计数。统计覆盖完整所选日期范围，明细分页不截断汇总，不再使用最近 5,000 条作为统计来源。历史 Agent 可从该次运行已记录的身份关联，仍缺失的保持未知。

时间范围使用分段按钮，筛选标签与选择控件在同一行对齐；窄窗自动换列。两页复用语义主题 token、中英文和紧凑数字，精确数值保留在提示中；重新进入页面刷新统计，刷新失败保留已显示数据并提供重试。用量账本按文件变化复用解析结果，图片用量继续实时合并；Desktop 不计算无关周/月汇总，并复用查询内的时区日期转换。3,500 条临时记录的统计层对比为约 603ms → 31ms，总量一致；这不是原生窗口完整打开耗时。

定向集成和展示计算 46 项连续 5 次通过；Desktop 查询参数编码回归通过。界面验证覆盖两页的筛选、错误恢复、隔离服务重启，以及 25 个内置主题的明暗布局、中英即时切换、860px 窄窗和代表性导入配色。新版两项 UI 场景连续 5 次通过，筛选错行故障注入可触发守卫。趋势曲线控制点限制在相邻数据范围，修复零值附近出现负值假象；回归先失败后连续 5 次通过。原生 Tauri 窗口与 HTTP 插件链路仍需原生验收；覆盖与运行方式见 `tests/ui/COVERAGE.md`。

## 2026-10-19 — Desktop Logo 同步原生与 Finder 图标（实现完成，原生验收待验证）

通用设置的 17 个 Logo 同时用于应用内形象、运行中的 macOS 应用图标、菜单栏和 Finder 中当前 `.app` 的图标。Dock 图标保留原图的透明异形轮廓和完整构图，仅等比缩放，不添加背景、底板或蒙版，菜单栏使用独立透明小尺寸 PNG；设置网格预览 Dock 版本，聊天头像保留原图。桌面选择由原生偏好保存，应用 Ready 时恢复，不依赖设置页或本地服务连接；原生更新和持久化全部成功后页面确认选择，失败尝试恢复原图标并显示错误。Finder 图标通过 `NSWorkspace.setIcon` 写入当前应用的自定义文件图标，退出后保留，应用包更新替换后首次启动按桌面偏好重新应用；安装包保留默认打包图标。只读或不可写位置返回错误并沿用现有回滚反馈；开发模式没有 `.app` 时只更新运行中的图标。原先仅存在于 WebView localStorage 的选择不导入原生偏好，首次使用新版需重新选择；浏览器预览继续按浏览器保存。

资源清单由前端与原生构建共享，生成入口为 `python3 scripts/generate-desktop-logo-icons.py`（Pillow）；默认打包资源保持原样。针对性回归覆盖原生调用、失败反馈、并发提交、临时目录偏好整对象保存/重新加载、原生失败回滚与所有 PNG 解码。前端状态 5 项、原生 Logo 逻辑 5 项及浏览器 UI 场景均连续 5 次通过；其他桌面偏好现有 5 项回归通过，Svelte 检查 0 错误（保留既有 1 条无障碍告警），前端构建通过。真实打包 App 的 Dock / Command + Tab、菜单栏即时变化、退出重开及服务中断恢复仍待原生验收，见 `tests/ui/COVERAGE.md`。

Finder 专项使用临时 `.app` 和偏好文件，验证自定义图标标志、Finder API 返回图像的像素变化、保存后重读、应用包替换后重建图标，以及写入失败保留选择和回滚。Logo 原生定向回归共 7 项连续 5 次通过。真实安装应用的 Finder 即时刷新与完整原生冷路径仍待验收；此改动需重新构建并安装桌面应用。

通用外观区域按“主题选择 → 主题导入 → Logo”排列，主题相关操作保持相邻；页面回归断言主题导入位于 Logo 之前。

## 2026-10-18 — Web 并入渠道设置，渠道入口移入助手分组（已交付）

设置导航取消独立「渠道」分组：「渠道」页面移入「助手」分组、紧跟 Agent 之后；原「Web Profiles」独立页面删除，Web 作为渠道的一种并入渠道设置页，分组排序为 Web、Telegram、飞书、QQ、微信。Web 实例使用精简编辑器（基础信息：ID、名称、关联 Agent、权限模式、启停 + Bot Markdown 覆盖文件），不提供放行会话、显示与通知、平台凭据——Web 页面本身在 App 内直接操作，无独立显示配置（DESIGN.md 设置导航分组与渠道身份条目同步更新）。编辑弹窗行结构抽取为 Svelte snippet 复用，列表行「显示自定义」标记仅对外部渠道显示。

实现：契约 `DesktopExternalChannel` 增加 `"web"`，渠道 summary 纳入 web（排第一），`saveDesktopChannelInstance`/`deleteDesktopChannelInstance` 支持 web（无凭据字段策略）；删除 ProfilesSection.svelte、profiles.svelte.ts、无消费方的 profiles API（save/delete/loadDesktopProfileFiles/saveDesktopProfileFiles/hasEnabledWebProfile/sanitizeWebProfileName，含原生命令面板 profiles 目的地与 16 组孤儿 i18n key）；新手引导保留 GET/PATCH web profiles API（`desktopProfiles.ts` 收敛为 resolve/patch/summarize），原服务端 PUT/DELETE 路由分支删除，不留兼容层。

测试：desktopChannels.test.ts 改断言（summary 含 web 排第一）并新增 web 保存/删除用例 32/32；api.test.ts 清理死函数 111/111；desktopProfiles.test.ts 删除已删函数用例 5/5；chat-ui.test.mjs 与导航守卫同步 316/317（1 项为既有 App.svelte 失败，与本条目无关）；settings.spec 新增导航位置断言（Channels 紧跟 Agents、无「Web Profiles」入口、无独立分组标签）与 web 实例精简编辑器走查（新建→分区裁剪断言→保存→重启持久化），双浏览器 10/10、chromium 5 连跑全绿。根 `tsc` 与桌面 `svelte-check` 0 错误（保留 1 条既有告警）；`pnpm build` 完成，重启服务后生效。浏览器验证经隔离实例完成，未触碰真实数据；全量预留 `pnpm verify:feature`、`pnpm test:ui`，本次未执行。

## 2026-10-18 — 渠道 Bot 显示配置进入桌面设置页（已交付）

设置 → 渠道的实例编辑弹窗新增「显示与通知 / Display & notifications」分区：工具进度、思考过程、自动 Runlog 通知、渠道通知间隔（秒）四项均可按 Bot 单独配置，选项含「跟随全局（当前值）」；此前这四项（`ChannelInstanceSettings.display`）只能靠聊天命令 `/toolprogress`、`/showreasoning`、`/runlog status bot` 修改，页面看不到也改不了。实例列表行仅在有覆盖时追加「显示自定义」标记，默认态保持安静；表单补齐「基础信息」分区头，与凭据、Bot 文件分区结构一致。全局与 Bot 两处显示选项标签收敛到共享模块 `displaySettings.ts`，不再两处硬编码。

链路：契约（`DesktopChannelInstance.display`、`DesktopChannelSaveRequest.display`、`DesktopChannelsSummary.defaults`）→ 服务端 `saveDesktopChannelInstance` 经 `sanitizeChannelInstanceDisplaySettings` 落库、summary 携带全局默认值供继承选项显示生效值 → 桌面 store 编辑器携带 display 随保存提交。顺带修复共享层两个真实缺陷：display sanitizer 此前把 `null` 当具体值（`gatewayNotifyInterval: null` 变成 0、`runLogNotice: null` 变成 false）而非「清除覆盖」，且返回对象带 undefined 空键——现按 `sanitizeAgentModelRouting` 风格只收非空键；UI 走查发现测试 harness pageerror 收集器用 `??` 导致空 stack 错误丢失 message，改 `||` 回退。

新增回归 9 项（服务端 display 读写/清空/非法值 6 项、sanitizer null 语义 1 项、UI 结构断言 1 项、浏览器冷路径行为 1 项），其中 2 项在根修前实测失败；服务端用例连续 5 次全绿，浏览器用例 chromium 5 次全绿、webkit 通过，settings.spec 双浏览器 8/8。定向测试 31+113+16 通过；根 `tsc` 与桌面 `svelte-check` 0 错误（保留 1 条既有 AgentCityInspector 告警）；`pnpm build` 完成，重启服务后生效。既有失败说明：`chat-ui.test.mjs` 的「Agent navigation unifies…」用例在本工作区（会话开始前 App.svelte 已有未提交改动）失败，与本条目改动无关，未处理。UI 走查经隔离实例（临时 DATA_DIR/HOME）完成，未触碰真实用户数据，未重放真实渠道消息。全量预留 `pnpm verify:feature`、`pnpm test:ui`，本次未执行。

## 2026-10-18 — 渠道错误兜底不再追加在正常回复之后（已交付）

QQ 私聊中，带失败工具调用的轮次会在正常文本回复后面收到 `Error: <工具输出前 200 字>`（实例：agent 查找 tts-voice 技能时拼装的 `ls` 命令因目标目录不存在 exit 1，输出为技能目录清单，被当作错误正文发出）。桌面端不可见：该通知以 `shouldLog=false` 发出、不写入 session，仅渠道侧投递。

根因是 26f283c4 引入的「本轮已有可见回复就不补发缓冲错误」守卫只统计 `sendVisibleText` 路径：QQ 私聊流式与微信的最终主回答经 `commitMainAnswer → replaceWithoutEdit` 直接送出，文件经 `uploadFile`/`uploadWithoutHandle` 送出，均不置位 `hasVisibleNonErrorReply`，收尾判定误认为「本轮无任何正常回复」，把 `lastBufferedError` 追加进流尾——错误因此恰好出现在最终回复之后的同一气泡里。该洞在 HEAD 已存在，非本次工作区改动引入；微信 `runtime.ts` 为同一份拷贝、同病。

修复：QQ/weixin 的 `replaceWithoutEdit` 与文件投递成功处在送达非错误正文时置位该标记，共 4 处各一行；缓冲错误仅在轮次确实没有任何可见回复时按原设计补发。按流程先写复现回归（QQ 流式主回答、QQ 仅文件投递、微信主回答共 3 项，修复前全部失败且失败输出与线上症状一致），另加 2 项边界用例锁定「静默轮必须补发错误」不被误伤；修复后两文件 12/12 通过并连续 5 次全绿，`tsc --noEmit` 通过，`pnpm build` 重建后经新旧 chunk 压缩码 diff 逐点确认 4 处修复进入新构建。此类送达路径旁路由本次回归守卫，不新增长期规则。

未重启用户正在使用的服务，运行中的服务仍加载 10:11 旧构建，重启后生效；未重放真实 QQ/微信消息。全量预留 `pnpm verify:feature`，本次未执行。

## 2026-10-18 — 模型失败判定与候选切换窗口加固（已交付）

共享 Runner 的失败语义收紧：模型响应带错误时（如 401/402）本轮判定为失败并切换下一个候选模型，不再把任何残留文本（旧窗口遗留、流式部分输出）当作成功答案发送给用户；仅当终态工具已产出用户可见回执（如 Plan 提案）时保持完成语义，避免在备用模型上重复执行。attempt 消息窗口由固定下标改为以 checkpoint 尾消息为锚点读取，投影数组在执行中途被重排（恢复导入、分支投影、压缩）时不再把历史回复扫进本轮窗口。

此前的 `runner-message-boundary` 修复解决了恢复误判把消息起点清零的根因，但错误决策仍存在"finalText 非空即成功"的短路：故障注入证明在同一源码树上，窗口一旦有残留文本（steer 回复、未来任何窗口回归），候选链仍会在第一个报错候选上假成功。本轮补上这层判定防线并移除下标依赖。新增 Runner 决策、锚点窗口与结构守卫回归 7 项，修复前 7 项失败、修复后通过，连续 5 次全绿；改动文件相关测试 48/48，Runner 套件 54/54，受影响 TypeScript 检查通过，`pnpm build` 完成。

正在运行的服务仍加载旧构建，重启后本修复与 `runner-message-boundary` 修复一同生效；未重放真实渠道消息。模型失败重试预算仍为 `maxModelAttempts`（默认 6，环境变量 `MOLIBOT_MAX_MODEL_ATTEMPTS` 或设置可调 1–100），候选链长度由启用的 Provider/模型决定。全量预留 `pnpm verify:feature`，本次未执行。

## 2026-10-18 — 模型降级与恢复不再重发历史回复（已交付）

共享 Runner 将导入的会话历史与本轮执行结果分开读取。主备模型均失败时保留失败状态并输出本轮错误；备用模型成功时只发送并写入本轮新答案；重新打开已完成任务时恢复该任务的结果，不把早期会话回复当成主答案或补充消息。各渠道共用这一结果边界。

根因是恢复判定随 SQLite 文件创建而变化：正常执行创建文件后，模型降级误判为恢复，将消息起点清零。恢复状态现于执行绑定时确定，原生执行打开后消耗；结果读取同时排除原生日志标记的导入历史。原有重试与恢复回归没有会话历史，未覆盖这一组合。新增真实 Runner 的主备失败/备用成功场景和带历史的原生恢复场景，断言发送内容、运行状态、落盘答案与摘要；修复前真实 Runner 两项均因重发历史失败，移除历史保护的故障注入也使恢复用例失败。新增用例连续通过 5 次，直接相关 Runner/适配器/持久会话测试 84/84，受影响 TypeScript 检查通过。此类状态和结果归属问题由机器回归守卫，不重复增加长期规则。

所有验证使用临时数据目录和模拟模型，未重放真实 QQ 消息、未修改历史记录、未重启用户服务。未改动 UI/原生桌面代码；全量预留 `pnpm verify:feature`，本次未执行。

## 2026-10-18 — 外部会话刷新、最近对话排序与音频附件（已交付）

Agent 首页和外部只读会话的标题栏提供「刷新对话 / Refresh conversations」按钮。共享刷新任务更新最近对话、Agent 最新对话时间、当前外部消息与音频文件索引；可见时按既有退避策略自动刷新，恢复可见时立即刷新。默认 Agent 仍置顶，其余 Agent 与最近对话按最新会话时间排序。刷新不改变当前会话；请求失败保留缓存并显示错误，过期请求不能覆盖新连接或较新的文件索引。

外部会话投影复用 `decodePiToolDetails` 解析工具回执，并将 TTS 音频与图像、视频一起恢复为可查看的附件；文件引用仍受会话工作区路径校验约束。根因分别为页面仅在进入时取数、缓存刷新隐藏错误，以及投影漏解码当前回执格式且缺少 TTS 分支。原有回归覆盖重新进入与历史图像回执，未覆盖留在页面时的新消息、当前封装回执和音频。新增守卫覆盖这些场景，以及刷新失败恢复、连接/会话切换、文件索引乱序与越界文件；定向测试 58/58 连续通过 5 次，相关静态 UI 用例 10/10。定向后端 TypeScript 检查与桌面 build 通过；桌面 svelte-check 0 错误，保留 1 条既有 AgentCityInspector 无障碍告警。隔离浏览器验证手动/自动刷新、真实本地 OGG 加载、排序、切换与接口中断恢复，以及中英、明暗和 620px 宽度；不使用真实 Provider 或渠道。此类异步问题由回归测试守卫，不重复增加长期规则。

指定 QQ 会话的当天请求在文本模型阶段遇到凭据过期与余额不足，未执行 TTS；修复展示与刷新不等于恢复模型服务。未替换已安装原生 App，真实 QQ 投递与原生 App 验证留待专项验收；全量预留 `pnpm verify:feature`、`pnpm test:ui`、`pnpm test:app`。

## 2026-10-18 — 持久任务恢复、并发调度与输出交付修复

持久执行器遇到有效的其他实例租约时自动重试启动；实例心跳与过期孤儿回收独立于任务执行，长任务不会阻断续期或其他空闲执行槽。回收保留活跃尝试和当前 worker 的在途认领；数据库认领错误在 worker 内处理，存储忙等待下一轮，致命存储错误停止认领。

整步恢复检查该步骤全部副作用；工具完成检查点只用于诊断，不能授权重放不可幂等操作，已有回执也不能保证重新执行整步安全。QQ 私聊流式更新或最终提交失败时补发完整答案；技能文件预览最多读取 256 KiB，大型二进制附件不会被整文件读入内存。

回归覆盖启动冲突后重试、启动后租约过期、长任务心跳与认领保护、独立任务补位、认领错误、并行工具恢复、QQ 部分帧/最终提交失败和超过 Node 整文件读取上限的稀疏文件。验证记录见 [本轮记录](docs/work/progress/unreleased-hardening-fixes/progress.md)。能力矩阵状态与使用入口不变。

## 2026-10-18 — TTS OGG 转码路径修复（已交付）

内置 `ttsGenerate` 按供应商返回的实际扩展名保存音频字节，再生成 OGG/Opus。请求文件名为 `hello.ogg` 时，小米原始 WAV/MP3 与 OGG 输出使用不同路径，避免 ffmpeg 拒绝原地覆盖。转码失败或 ffmpeg 不可用时，保留的原始音频扩展名与实际格式一致。

根因是文件名与音频格式混用；原测试只使用 `.wav` 文件名，模拟 ffmpeg 也未拒绝同路径输入输出。共享测试 helper 现已模拟这一限制，新增 9 个组合场景覆盖 WAV/MP3/OGG 格式请求与转码成功、失败、不可用，断言工具提示、格式状态、上传路径及文件内容。新增用例修复前 9/9 失败；TTS 工具与供应商测试 25/25 连续通过 5 次。本机真实 ffmpeg 配合本地模拟音频验证 OGG 文件头与发送回调；未访问真实 Provider 或渠道。定向 TypeScript 检查未通过：依赖模块 `prompts/profiles.ts` 的 6 个 `*.template.md?raw` 导入无法解析，改动文件无诊断。此类问题由定向回归守卫，无需新增长期协作规则。全量回归预留 `pnpm verify:feature`，未执行。

## 2026-10-17 — 设置导航按单一轴线重组为 8 组

设置侧栏原来混用三条分类轴（"配的是什么对象" / "它能干什么" / "发生过什么"），于是总出现"这页放哪都说得通"的页面。现在只按一条轴分组——"这一页配置的是什么"，收敛为 8 组：通用、模型（模型 / AI 服务商 / 决策模型）、助手（Agent / 技能检索 / 记忆）、能力（搜索 / 图像 / 视频 / 语音 / MCP / 连接器 / 插件）、渠道（渠道 / Web Profile）、数据与历史（会话管理 / 运行历史 / 用量 / Trace / 服务日志）、安全与权限（执行与权限 / 审批管理）、系统（系统 / 运行环境 / 诊断）。净变化：移动 4 页（会话管理 助手→数据与历史、审批管理 活动→安全与权限、执行与权限 系统→安全与权限、插件 系统→能力）、改名 3 组（工具→能力、活动→数据与历史、总览→通用）与 1 页（技能→技能检索），并删掉只用于排序的 `additionalSections` 字段。设置里的「技能检索」只配置检索的服务商/模型/参数，技能目录仍在主侧栏工作区入口。

新增导航守卫用例 `apps/desktop/src/settings-navigation.test.mjs`：断言 `SettingsSection` 联合类型、`SETTINGS_NAV` 图标与 `SETTINGS_GROUPS` 分组三者一一对应（每页恰好属于一个组、恰好有一个图标、无空组），漏归组或多归组直接失败；已做故障注入验证（删掉一条分组条目即变红，恢复后转绿）。`chat-ui.test.mjs` 里两条把旧分组字面量写死的断言改为语义断言（"共享资源仍可在设置中到达""连接器与 MCP 同级"），分组归属交给新守卫。DESIGN.md 新增「设置导航分类」条目。

验证：`settings-navigation.test.mjs` + `chat-ui.test.mjs` 316/316 通过（含守卫故障注入）；`apps/desktop` svelte-check 0 错误（1 条既有无关告警：AgentCityInspector 的 `<nav>` tablist）；隔离 vite 实例冷路径走查（独立端口 5199、无后端、不触碰运行中的服务与真实设置）：首次打开设置 → 中英双语 + 明暗主题下分组与顺序正确 → 逐个点击迁移页（会话管理 / 审批管理 / 插件 / 技能检索 / 诊断）均正确挂载 → 侧栏滚动到底部可达最后一项、footer 不遮挡。预留未执行：`pnpm verify:feature` 全量回归与原生 App 测试——本次只改静态导航与文案，无运行时链路改动。

## 2026-10-17 — 技能目录 Agent 化：Bot 作用域更名为 Agent，工作区筛选更名全局

技能页筛选分类与数据模型对齐 Agent 中心存储（session 已按 Agent 存放，`sessions/<agentId>/` 即 Agent 工作区）：原 "Bot" 分类实际扫描 `sessions/<agentId>/skills`（Agent 专属技能，目录名即 agentId），更名为 **Agent**；原 "工作区" 分类实际扫描 `~/.molibot/skills`（对所有 Agent 生效的全局技能，与卡片上的"全局"pill 同一事物），更名为**全局**，消除"工作区/Bot/全局"三个名字指两件事的混乱。改动：

- **契约**（`src/lib/shared/desktop.ts`）：`DesktopSkillScope` 的 `"bot"` 更名 `"agent"`，`DesktopSkillItem`/`DesktopSkillDetail` 的 `botId` 更名 `agentId`（附语义注释），`DesktopSkillsSummary.counts.bot` → `counts.agent`。
- **扫描路由**（`/api/settings/skills`）：`sessions/` 扫描段按 agent 语义输出（scope `"agent"` + `agentId`）。
- **桌面映射**（`desktopSkills.ts`）：`coerceScope` 把运行时的工作区层值 `"bot"` 映射为 `"agent"`——运行时对 Agent 工作区和渠道 bot 工作区共用一个工作区层作用域值，桌面端只投影 owner 的 Agent 工作区与全局目录，因此在边界转换而不是泄漏运行时词汇；运行时 `SkillScope` 枚举不动（渠道 bot 工作场景下"workspace 层"仍属实义）。`agent-skills` 路由（定义即"单个 Agent 的技能"）同点映射；Agent 设置页"Agent 专属技能"分组的过滤值从 `"bot"` 对齐为 `"agent"`（该页文案原本就已称 Agent，数据词汇此番补齐）。
- **UI**（InstalledSkillsPane + i18n 中英）：筛选 tab "Bot"→"Agent"、"工作区"→"全局"（复用 `skillScopeGlobal`，与卡片 pill 一致）；作用域 pill 与详情"Bot"事实行显示 agentId、标签用 `skillScopeAgent`。
- **分类修正（用户反馈）**：内置 Skill 会物化到全局技能目录，既是内置也是全局——原分类是"内置优先"的互斥分区（`isWorkspace = !isBuiltin && !isAgent`），导致已安装的内置技能（如 miniapp-creator）从全局分类消失。改为按属性过滤：内置/全局/Agent 三个分类各自独立判定（全局 = `scope === "global"`），计数允许交叉（内置 1 + 全局 20 + Agent 10 > 全部 30 属预期）；内置技能在"内置"分类保留版本/更新控件，在"全局"分类按普通全局技能呈现。

验证：根 `tsc` 0 错误、desktop `svelte-check` 0 错误（1 个 AgentCityInspector 既有 warning，与本次无关）；`desktopSkills.test.ts` + `composerSuggestions.test.ts` 16/16（新增"运行时工作区层映射为 agent 作用域"守卫）、`chat-ui.test.mjs` 315/315、`settings-navigation` 守卫通过。未验证：真实桌面端渲染——后端跑预构建产物，需 `pnpm build` + 重启后在技能页确认分类计数与 Agent pill。

## 2026-10-17 — 默认主题工作区统一：软选中 + 三列表一行语言（技能/自动任务/计划）

按用户反馈两步走，全部只作用于默认 macOS 主题，其他主题（Win98/Raft/导入主题等）保持共享样式表的实色选中渲染不变：

**① 选中配色**：技能选中卡从实色 `--selection-bg` 整卡填充改为**软选中**——16% 淡染 + 同色 40% 1px 内描边，文字保持画布色阶（实色大面积铺开过艳、子元素整体重着色让选中卡像异质组件）。用户随后要求计划与自动任务同款，并明确"其他主题不要这么改"——落为 `themes/macos.css` 内经 `[data-theme-region="chat"]` 钩子（工作区页面挂在 chat 内容区内，家族文件只允许经 region 钩子改 chrome，有守卫测试）作用域的软选中块，覆盖技能卡、当前文件行、自动任务行、计划行四类表面；基础实色规则原样保留给所有其他主题。同时修复悬浮层叠 bug：`workspaces.css` 后加载且特异性更高，悬浮到选中项会把选中色洗成灰色——技能行/文件行/自动任务行/计划行悬浮规则统一加 `:not(.selected)` / `:not(.active)` 守卫（纯防洗掉，不改各主题观感）。

**② 三列表一行语言**：默认主题下自动任务（直角平面）、计划（圆角行）、技能（卡片 tile）三种风格统一为计划页的行列语言——平面行 + 发丝分隔线 + `--rounded-sm` 圆角交互形 + 软选中；技能列表模式的卡片 tile 摊平为行（`background: transparent` + 底部分隔线），卡片只保留在关闭详情的网格视图（高程在那里表达网格语义）；摊平后悬浮回到与另外两个列表一致的 `--fill`。摊平与选中规则写成互斥对（`:not(.selected)` / `.selected`、相同解剖结构），避免同块内特异性压过导致半选中状态（开发中实际出现过，已修）。DESIGN.md 选中语言小节与工作区主从布局小节落相应规范。

验证：`chat-ui.test.mjs` 315 项中 313 通过，2 项失败为 `App.svelte` 并行修改导致的既有失败（settings 导航 sections 断言，与本次无关）；更新"strong selection"守卫断言为双层语义（基础实色 + macOS 软选中经 region 钩子）并新增列表语言断言；故障注入验证新守卫能被对应故障弄失败。真实浏览器加载线上 CSS 的静态校验页走查：macOS 暗色下四类选中面计算样式均为 16% 淡染+描边、三列表行语言一致；Win98 亮色下技能卡/文件行/任务行/计划行保持海军蓝实色选中、自动任务行 0px 圆角，主题特色未受影响。

## 2026-10-17 — 协作规则调整：精简测试验证流程（定向验证 + 全量预留）

优化 `AGENTS.md` 测试用例执行规则，避免日常小需求过度验证（动辄耗时数十分钟）：
- **定向精准验证**：日常开发与代码修改后，仅执行与改动直接相关的测试（对应单测、受影响模块局部集成测试、设置字段 round-trip）和局部类型检查；未改动部分不跑验证。
- **全量回归预留**：全量核心回归（`pnpm verify:feature`、全量核心套件、Playwright UI 测试、原生 App 测试等）降级为阶段验收/发版预留命令，日常不自动执行，在交付说明中提供命令提示供用户按需主动触发。

## 2026-10-17 — 侧栏 footer 统一：共享 AppFooterMark + 设置页 Agent 入口

聊天侧栏与设置侧栏左下角的应用标识统一为一个共享组件 `AppFooterMark`（`src/lib/components/AppFooterMark.svelte`）：应用 logo + 叠在 logo 角上的服务状态环点 + 应用名文字，常态不再显示"已就绪/Online"之类的状态行（状态只由点的颜色承载，可访问名称保留）。聊天页 footer 结构不变（整行点击进设置 + 设置齿轮）；设置页 footer 换成同一 mark，尾部控件由独立状态点改为 Agent 图标按钮（users2-duotone，与侧栏 Agent 条目同形，"前往 Agent"），点击后关闭设置并落到默认 Agent（Momo）首页（`ChatView.openDefaultAgentPage` 以实例方法暴露给设置层，走既有 `openAgentChat(defaultAgentId)` 路径）。删除设置页 footer 旧实现（`settings-sidebar-footer-copy`、`settings-footer-avatar`、独立 `status-dot`）及无使用者的全局 `.status-dot` 规则。DESIGN.md 落相应条目。

验证：见交付说明（svelte-check、chat-ui 结构守卫、settings UI 用例）。

## 2026-10-17 — QQ 渠道接入富消息类型（语音/审批按钮/C2C 流式/输入中/唤醒消息，qqbot 2.0 → 2.1）

接入 `@tencent-connect/qqbot-nodejs` 已提供但未使用的消息能力。适配层（`package/qqbot` 2.1.0）新增 `sendTextWithKeyboard`/`sendTyping`/`openC2cStream`/`acknowledgeInteraction`/`resolveProactiveMode`（C2C 无 `replyToId` 推送自动走 `is_wakeup` 唤醒消息）、gateway `onInteraction` 转发、`sendMedia` 显式 `fileType` 覆盖。渠道层：

- **审批按钮卡**（`approvalButtons.ts`，新模块）：host-bash 审批以按钮卡下发（批准一次/本会话/持久 + 拒绝两行布局，`hta:` token ≤32 字节、`click_limit: 1`），点击经 `onInteraction` → 白名单校验（不过回执 code 4）→ token/会话匹配（失效回执 code 1 + 指引文本）→ 5 秒内 ACK code 0 → `SharedRuntimeCommandService` 审批 → 结果文本回执；token 一次性消耗。键盘发送失败降级 `buildNonInteractiveHostBashApprovalText` 纯文本。对齐 Telegram 渠道的 `hta:` 模式。
- **C2C 流式回复**（`runtime.ts` processEvent）：私聊且有可引用入站消息时，回合内容经 `StreamSession`（replace 语义、500ms 节流）打字机刷新，进度/错误缓冲语义不变；打开失败（如 5 分钟被动窗口过期）或中途出错自动降级为一次性合并发送；异常路径 `complete()` 定格已出内容。群聊维持合并发送。
- **输入中提示**：私聊处理期间 `sendTyping` 30 秒 + 25 秒周期续期，回合结束停止；失败仅告警。
- **语音双向**：出站（`voice.ts`，新模块）音频按 QQ 语音消息发送——原生 wav/mp3/silk 或 SILK 魔数直传，其余 ffmpeg→24kHz 单声道 s16le PCM→silk-wasm 编码（复用共享 `transcodeAudio` 与根依赖 `silk-wasm`），任一步失败显式走 FILE 通道；入站（`inboundText.ts`，新模块）优先用户文字，其次 QQ 平台转写 `asr_refer_text`（多段换行拼接），最后附件占位。
- **主动消息分路**：C2C 主动推送（提醒、事件任务、被动限流降级）改走唤醒消息（用户互动后 30 天窗口），群主动消息不变。

验证：`package/qqbot` `tsc` 0 错误、`outbound.test.ts` 7/7（新增主动路由决策、键盘凭证守卫）连续 5 次通过；渠道层新增 `inboundText.test.ts`(3)、`voice.test.ts`(3，含降级链路触达证明)、`approvalButtons.test.ts`(6，成功/拒绝/token 消耗/白名单拒绝/跨会话 token/群场景) 合计 12/12 连续 5 次通过；根 `pnpm check` 0 错误、`pnpm build` 通过；冷启动冒烟（隔离数据目录）`qq:active` 装配正常。`verify:feature`：type check、desktop check、desktop 单测、WebKit UI 45/45、Chromium 冒烟 6/6 通过；全量核心回归 2747 项中 1 项失败（`codemode.test.ts` stop 取消用例，与微信 SDK 同步时相同的既有并发 flaky，单跑 10/10 通过，与本次 QQ 改动无关）。未验证：真实 QQ 账号下语音下发、按钮点击、流式帧、唤醒消息额度行为——需真实凭证专项验收。

## 2026-10-17 — QQ Bot SDK 底座更换为腾讯官方 qqbot-nodejs（fork 1.7.1 → 2.0.0）

官方插件 `@tencent-connect/openclaw-qqbot` 已从 1.7.1 升级到 2.0.3：上游在 2.0 重构中删除了全部手写协议层（WS 网关、token 管理、富媒体上传），改由腾讯官方 SDK `@tencent-connect/qqbot-nodejs` 承载。本地 `package/qqbot`（fork 自 1.7.1、仅定制 gateway onEvent 模式等 3 处）的协议层已冻结无上游支持，据此把底座更换为官方 SDK，本包重建为薄适配层（34 个源文件 → 5 个）：

- **`gateway.ts` 重写**：`QQBot` 实例生命周期 + 会话持久化（`FileKVStore` → `~/.molibot/qqbot/<accountId>/session.json`），SDK 的 `InboundMessage` 逐字段映射为 1.x 同形的 `GatewayEvent`（含 `attachments.voice_wav_url`/`asr_refer_text`），READY/RESUMED 都触发 `onReady`，`abortSignal` 贯穿 `bot.start(signal)`；群非 @ 消息照旧投递（`GROUP_MESSAGE_CREATE` 与 `GROUP_AT_MESSAGE_CREATE` 均映射 `kind:"group"`），@/白名单过滤仍归 `QQManager`。
- **`outbound.ts` 重写**：`sendText`/`sendMedia`/`sendProactiveMessage` 走 `bot.send*`；保留目标地址解析（`qqbot:c2c:`/`c2c:`/`group:`/`channel:`/裸 openid）、被动回复限流（1 小时 4 次超限降级主动消息）、语音失败降级文件发送、`OutboundResult`（`error`/`errorCode`/`qqBizCode`/`refIdx`）与稳定用户文案；媒体路由 MIME 优先、扩展名回退，未知扩展名走文件通道。
- **`api.ts` 收缩**：bot 实例注册表（appId → `QQBot`，出站复用网关连接与 token；网关未启动时按需建仅发送实例，等价旧无状态 REST 发送）+ `initApiConfig`/`clearTokenCache`/`getAccessToken` 兼容入口。
- **删除**：fork 的全套协议层与 openclaw 插件代码 29 个文件（审批/斜杠指令/流式/STT/图床/群历史/引用索引等，onEvent 模式本就旁路）；依赖 `ws`/`silk-wasm`/`mpg123-decoder` → `@tencent-connect/qqbot-nodejs ^1.0.5`。
- **协议层修复随之获得**（qqbot-nodejs 1.0.1→1.0.5）：token 刷新竞态与获取超时、重连风暴/握手静默丢弃/误判永久错误、启动 fail-fast、断线原因上报、COS 分片上传走 https、每日额度结构化错误。
- **下游适配**：`channels/qq/index.ts` 精简为插件注册 + `toSDKAccount`；删除无调用方的向后兼容层 `channels/qq/api.ts`、`sdk-adapter.ts`（`runtime.ts` 改直连 `#qqbot/src/*`）；根 `tsconfig.json` 移除已删的 `openclaw-plugin-sdk.d.ts` 引用。`runtime.ts` 消费面零改动。
- **行为变化**：会话持久化位置从 `~/.openclaw/qqbot/` 迁到 `~/.molibot/qqbot/`；重连无硬编码次数上限（SDK 默认无限退避重试）；SDK 层群消息合并队列移除（molipibot `InboundTaskCoordinator` 本就按会话排队，原先双层排队）。

验证：`package/qqbot` `tsc` 0 错误、`outbound.test.ts` 5/5（目标解析全格式、媒体类型推断 MIME/扩展名/未知扩展走文件、凭证守卫、错误文案）连续 5 次通过；根 `pnpm check` 0 错误、`pnpm build` 通过且产物含新适配层；冷启动冒烟（隔离临时数据目录）`qq:active` 渠道装配正常、无凭证不报错、首页 200。`verify:feature`：type check、desktop check、desktop 单测、WebKit UI 45/45、Chromium 冒烟 6/6 通过；全量核心回归首跑 1 项失败，同命令重跑 2747 项 0 失败（既有并发 flaky 模式，与本次改动无关）。真实 QQ 连接（登录、收发、断线重连）未验证——需真实凭证专项验收。

## 2026-10-17 — vendored weixin-agent-sdk 同步上游 2.4.10 适用子集（fork 0.3.1 → 0.4.0）

基于官方 SDK 2.4.4 改造的 `package/weixin-agent-sdk` 与上游 2.4.10（本地官方仓库 HEAD=2.4.4、工作区=2.4.10，diff 即精确上游增量）逐 hunk 比对后移植适用改动：

- **uint64 消息 ID 无损解析**（上游 2.4.9-beta）：新增 `parseWeixinApiJson` 在 `JSON.parse` 前给 `message_id`/`msg_id`/`svr_id` 加引号，修复超出 `Number.MAX_SAFE_INTEGER` 的消息 ID（实测 `8421831295061105778` 会静默取整成 `8421831295061106000`）；`WeixinMessage.message_id` 与 `SendMessageResp.message_id` 类型改 `string`，`getUpdates`/`sendMessage` 走无损解析。
- **网络错误分类**（上游 2.4.6）：`classifyFetchError` 按 `dns`/`tcp`/`tls`/`timeout`/`unknown` 分类 fetch 级错误；三个 API fetch 封装、monitor getUpdates 异常、CDN 上传重试、`downloadRemoteImageToTemp` 失败日志全部带分类 + 脱敏 URL + cause。
- **`sendMessage` 返回 `SendMessageResp`**（上游 2.4.6）：可拿到服务端分配的 `message_id`；非零 ret/errcode 抛错行为不变（fork 先前已有等价校验）。
- **`SESSION_EXPIRED_ERRCODE` → `STALE_TOKEN_ERRCODE`**（上游 2.4.6）：更名以贴合 -14 的真实语义（token 失效）。
- **删除无调用方的 allowFrom 写入器**（上游 2.4.10）：`registerUserInAllowFromStore` 全仓库零调用方，与上游同步删除；读取侧行为不变。
- **协议类型对齐**：`RefMessage.svr_id`/`partial_text` + `PartialText`（为后续引用消息还原铺路的 wire 类型，无行为变化）。

明确不移植：引用消息还原全功能（quote-store/partial-quote/ReplyTo 上下文/出站缓存，依赖 `node:sqlite` + Node ≥22.13 + OpenClaw 消息模型，属新功能待决策）；OpenClaw 宿主兼容修复（2.4.7/2.4.9/2.4.10 的 plugin SDK 适配，fork 无宿主）；纯格式化 diff。详见 `package/weixin-agent-sdk/README.md` 同步记录。

下游适配：`channels/weixin/media.ts` 三个附件文件名构造函数接受 `number | string` ID（运行时去重键本就走 `String()`，自动变为无损）；`media.test.ts` 夹具改字符串 ID。

验证：SDK `tsc --noEmit` 0 错误；SDK 测试 11/11（新增 6 个回归用例：uint64 无损、字符串内容不误改写、非 ID 数字字段不动、错误分类 ×4 场景、sendMessage/getUpdates 无损端到端；已证实裸 `JSON.parse` 下用例必失败）；weixin channel 测试 11/11；根 `pnpm run check` 0 错误。`verify:feature`：type check、desktop check、desktop 单测、WebKit UI 45/45、Chromium 冒烟 6/6 全绿；全量核心 2747 项中 1 项（`codemode.test.ts` stop 取消用例）并发负载下失败，单跑通过，与本次微信链路改动无关，判定为既有并发 flaky。

## 2026-10-17 — 计划改为 Durable 执行器统一执行与跨 Session 接续（#65 A 项）

按所有者决策重写计划执行架构：计划不再作为来源 Session 的普通轮次执行，统一交给现有 Durable Execution 执行器；Session 只承接计划记录、执行反馈和后续要求。`DESIGN.md` 的执行约定段落已同步重写。

服务端（共享层，非 Channel 层）：

- **Durable 计划执行**（`durable/runtime.ts`、`store.ts`）：绑定的计划以隔离上下文逐尝试执行（`sessionMode: fresh` + 每步新 attempt），控制请求（暂停/取消）经 SQLite 控制表 + 100ms 轮询转成 AbortSignal，工具静默后安全停止；每计划独立认领（`bindPlan`，原子事务 + 版本 CAS + 原 Agent 独占），`claimAttempt` 拒绝未经当前版本批准的执行。并发上限放开为按计划并行，`ensureQueuedEvents` 入队全部就绪候选。
- **承接与投递**（`plans/sessionDelivery.ts`、`app/desktopPlans.ts`）：批准时原子绑定承接 Session（可选当前会话或新建），保留原 Agent/Project/输入/版本；输入附件复制到计划自有的 `.plans/<hash>/inputs/`（路径穿越防护），来源会话删除后仍可重放。每步结果以 `durable-plan:<executionId>:<runId>` 幂等投递到承接 Session（重启后 `reconcilePlanDeliveries` 补投）。
- **修订与审批**（`plans/revision.ts`、`store.editPlanContent`）：完整增删改排序（保任务/步骤身份，已完成只读不可删）、验收要求编辑、自然语言修订草稿（只产草稿不落盘）；编辑前快照整版本，旧版本可完整读回。审批、待验收确认、工具审批经共享 Durable 决策/审批链路。
- **查询与事件**（`store.queryPlans`、`plans/+server.ts`）：搜索/项目/状态筛选先于分页在服务端完成（覆盖全部可访问计划），SSE 变更通知 + 心跳，断线重连先订阅再取快照。
- **旧架构清理**：删除 `syncPlanProgress`/`mirrorFromConversationPlan` 镜像链路与 `start` 动作；`stream` 路由不再把绑定计划当 Session 轮次执行。
- Pi 运行时依赖 `@earendil-works/*` 1.0.0 → 1.3.0（新增 `DurableAttemptHooks.execution` 钩子面所需）。

桌面端：

- 计划工作区（`PlansWorkspace.svelte` + 新 `PlanEditor.svelte`）：SSE 实时刷新替代 5 秒轮询、服务端分页（上/下一页）、项目筛选、断线提示与最后更新；详情内完成批准（权限选择 + 承接会话选择：当前会话/新建）、编辑（草稿 localStorage 保留、版本冲突提示与以最新版本重览、差异预览、中英文案）、暂停/取消/继续/验收/返工/删除。`>30` 步计划不再截断（`exitPlan`/`updatePlan`/`PlanCard` 移除 30 步上限）。

验证（隔离实例、临时数据库、本地夹具）：plans/durable/mcp 相关 62 项五连跑全绿（含 MCP 多页工具发现新回归）；`claimAttempt` 批准守卫故障注入可复现失败；`plans/server.test.ts` 公共 API 2/2；`workspaces.spec.ts` 修订/草稿/冲突/重启用例与 `plans.spec.ts` 31 步计划忙碌 Session 接续用例通过；`verify:feature` 全绿（原生 App 测试环境缺失记「未验证」）；svelte-check 0 错误、根构建通过。全量核心回归 2745 项中 3 项并发负载下偶发失败，干净 HEAD 基线同负载同样出现随机失败（不同用例），单跑均通过，判定为既有并发 flaky，非本次引入。原生 App（Tauri 窗口）完整链路走查未做（`tests/pi/issue65-native-harness.ts` 已备好隔离夹具待用）。

## 2026-10-17 — 应用 Logo 抠图集与设置页切换器

用户放入 `apps/desktop/public/logos/` 的 16 张徽章式 logo（1254×1254、每张约 2MB）完成三步处理并接入应用：

1. **抠图去背景**：8 张奶油底 RGB 图通过边缘泛洪 + 抗锯齿羽化 + 颜色反混去底；8 张自带 alpha 的圆形徽章对半透明边缘做去奶油晕处理（深色背景下验证无晕边、浅色下无底色残留）。16 张全部经浅色/深色双背景拼贴视觉审查通过。
2. **压缩**：统一裁到内容包围盒、居中方形画布、512px WebP（q85），单张 47-70KB（合计约 950KB，原 32MB，压缩率 97%）。原图移至 `apps/desktop/logos-src/` 保留，满意后可删。
3. **切换功能**：新增 `lib/stores/appLogo.svelte.ts`（17 项清单含默认图标 + `$state` store + localStorage `molibot-desktop-app-logo` + `storage` 事件跨窗口同步），与外观/主题同机制：即时生效、无需保存、无服务端往返。设置 → 通用 → 外观的「应用 Logo」区块提供棋盘底缩略图网格（复用 theme-swatch 壳、token 化配色适配明暗主题、中英文案、窄窗自动换行）。原先硬编码 `/molibot-icon.png` 的 9 处（聊天侧栏 ×2、设置页脚、外部渠道空态、转录/流式助手头像、项目侧栏、AgentAvatar fallback ×2）全部改读 store。

验证：`appLogo.test.ts`（持久化、非法 id 回退默认、清单资产在盘校验；故障注入可复现失败）；`settings.spec.ts` 新增切换用例（即时换标、冷 reload 持久、恢复默认）连续 5 次通过；中/英 × 亮/暗 × 760px 窄宽截图走查通过；`chat-ui` + 反应式守卫 318/318；`svelte-check` 对本次改动文件 0 错误（工作区中另有一批 plans WIP 改动自带 2 个既有错误，非本次引入）。

## 2026-10-17 — 工作区页面切换消除垂直位移与抖动（纯平滑淡入）

用户反馈计划、任务、技能、小程序页面切换时存在页面抖动感。代码排查发现：
1. 切换容器挂载的 `motion-surface-in` 带有 `translate: 0 6px` 且持续 240ms，导致顶部已固定对齐的 Header、标题文字、Tab 分割线每次切换都整体下沉 6px 再弹回，产生抖动抽搐感；
2. 小程序页面带有单独的 `padding-top: 12px` 且未重置 `scrollbar-gutter`，导致切入/切出小程序时顶栏垂直下移 12px 且横向宽度突变。

修复措施（方案 1）：
1. 将 `motion-surface-in` 修改为纯透明度过渡（`opacity: 0 -> 1`），去除垂直 `translate`，动画时间优化为更干脆利落的 `--duration-fast`（160ms）；
2. 抹平小程序页面 `[data-workspace-pane="miniapps"]` 的 `padding: 0` 与 `scrollbar-gutter: auto`，使四大工作区页面的顶栏、描述和分割线像素级锚定固定。

验证：桌面结构检查 315/315 通过，`svelte-check` 0 error。

## 2026-10-17 — 技能卡片网格消除分割线下的"第二条横线"

用户在深色主题、有真实数据的应用里对比发现：技能页分割线下约 21px 处出现一条几乎横贯全宽、左右缩进的第二条横线，且第一行内容文字距分割线远高于计划/自动任务页——上一轮只对齐了描述区、tab 行与分割线本身（浅色空数据下已一致），未覆盖分割线下方。

根因：技能卡片默认带 `1px separator` 边框，网格顶距 20px，第一行卡片的上边框连成一条近全宽细线，视觉上成了一条没对齐的分割线；计划/自动任务的列表行紧贴分割线且只在列内画行分隔线，没有这条线。修复沿用页面家族已有模式（list-mode 静默无边框、小程序网格顶距 24px）：网格顶距改为 24px，静默态卡片边框透明（hover/选中态边框保留），卡片靠背景色块与圆角保持磁贴感。

验证：深色 1120×760 像素级线检测确认分割线与首行内容间的强横线消失（修复前 y=173、覆盖 1600px，修复后无）；视觉确认卡片磁贴感与间距良好。对齐回归新增断言（网格顶距 24px、静默卡片上边框 alpha 为 0）连续 5 次通过；`workspaces.spec.ts` 与 `skills-management.spec.ts` 共 6 项、结构检查 315/315 通过。原生 App 测试环境缺失未验证。

## 2026-10-16 — 技能页顶部与计划、自动任务对齐

技能页说明区、筛选栏与分隔线并入计划/自动任务的共享几何规则：移除筛选栏上方多出的 12px 间距，分隔线位置三页一致；筛选行右侧不再显示「总数 · 已启用」统计文案（各分类数量保留在分段按钮内），`skillsTotal` 文案键删除。顶部几何回归扩展为三页比对（中英、macOS 明暗、Brutalism 深色 × 1440/1120/860），恢复旧间距可复现失败，修复后连续 5 次通过；`verify:feature` 全部通过（类型、398 文件核心测试、桌面单元、WebKit 42 项、Chromium 冒烟），原生 App 测试环境缺失未验证。

## 2026-10-16 — Agent 设置保存后停留

Agent 设置保存成功后停留当前页，保留分类、文件选择及已保存内容，固定底栏显示保存成功；返回/取消负责离开。连续保存沿用已创建的 Agent 身份，已保存的机器人绑定清除待保存状态，保存失败保留草稿供重试。窄窗底栏为成功提示单独留一行。

根因是保存完成与编辑页退出共用清空草稿状态。`agent-settings.spec.ts` 覆盖保存留页、连续保存、失败重试、显式返回、服务重启回读，以及中文深色 390px 下非默认文件与成功反馈；3 项各连续 5 次通过，修复前可复现页面退出与窄窗反馈隐藏。根与桌面类型检查、桌面构建通过；完整 `pnpm verify:feature` 的核心测试为 2,870 通过、3 失败、1 跳过；失败为 `channelCommands`、`runner` 的 SQLite 锁冲突及 `codemode` 取消断言。桌面单元和结构检查通过，WebKit 为 41 通过、1 失败（聊天流空闲超时未显示 `.composer-error`）；本次 3 项 Agent 设置用例全部通过。原生 App 测试缺少带驱动的构建与隔离应用标识，未验证；尚未重新打包安装。

## 2026-10-16 — 技能详情就地展开与全宽内容区

点击技能卡片（或聚焦后 Enter/空格）不再只是高亮，而是就地展开详情：卡片网格 FLIP 成 320px 竖向列表，右侧按「列表 · 内容 · 目录」三区展示。中列给出标题、完整说明、SKILL.md 路径、YAML 元信息（嵌套项展开为 `metadata.openclaw.emoji` 这类点号行）、版本、文件修改时间、内置版本状态和所选文件内容；右列是技能目录树（相对路径、大小、目录优先、按层级缩进）。目录里的文本文件可在中列只读预览（Markdown 渲染并去掉已在元信息区展示的 frontmatter，其它文本用等宽只读框，超过 256 KB 截断，二进制文件明确说明无法预览）。关闭详情后卡片 FLIP 回原网格位置；窄窗折叠为单列并在详情内提供返回入口。原来的居中详情弹窗与卡片上的详情按钮移除。

技能页改用与自动任务、计划一致的全宽内容区，不再收窄到 1240px 内容列：说明、筛选栏分隔线与卡片网格边界一致地铺满可用宽度，左右各留统一页面内边距（上一版“技能与小程序内容列对齐”的规则相应收回，小程序继续使用 1240px 限宽容器）。

详情数据按需读取：新增 `GET /api/desktop/skills/detail`（路径、完整 frontmatter、SKILL.md 修改时间、目录清单、内置版本状态）与 `GET /api/desktop/skills/file`（单个文本文件内容）以及 `POST /api/desktop/skills/reveal`（在访达中显示技能目录）；列表接口继续保持无路径，所有路径都由服务端按不透明 id 反查，文件读取会校验解析后的真实路径仍在技能目录内。新增 `flattenSkillFrontmatter` / `listSkillDirectory` / `readSkillFileContent` 的单元用例（临时目录），并在界面结构检查中锁定“详情为页面内面板、无弹窗”。

验证：`desktopSkills.test.ts` 10/10、桌面结构检查 315/315、类型检查（根 `tsc --noEmit`、`svelte-check` 0 error）、桌面与服务构建通过；WebKit 专项 `skills-management.spec.ts` 与 `workspaces.spec.ts` 5 项通过（冷启动打开技能页、切换范围、勾选、进入/退出详情）。完整 UI 套件与原生 App 测试本次未运行（原生构建未更新）。

## 2026-10-16 — 小程序内容限宽容器

小程序说明、数量工具栏、横线、图标启动台和管理页放入同一个限宽容器，统一沿用 1240px 内容列上限；内部区域只填满该内容列，宽窗口不铺满页面。新增 2240/1600 宽窗口检查，断言内容宽度不超过 1240px，并与说明文字左右边界一致。最终小程序单页专项在 WebKit 连续 5 次、Chromium 同项通过，类型检查、结构检查与构建通过；完整检查未全通过，原生 App 未验证，见[验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 技能与小程序内容列对齐

小程序工具栏跟随父内容列宽度，移除嵌套宽度计算造成的左右各 24px 内缩。技能与小程序的说明、分隔线、数量及网格左右边界保持一致，进入管理页后也沿用同一列。根因属于布局层级：页面边距应由顶层内容列计算一次。新增跨页几何回归同时核对两侧边界、网格和管理页，避免只检查无溢出而漏掉内缩。接入更新后的技能详情结构后，WebKit 专项连续 5 次、Chromium 同项、314 项结构检查、类型检查与构建通过；完整验证结果见[工作区验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 计划筛选数量与主从工作区顶部对齐

计划各状态筛选直接显示数量，全部显示搜索结果总数，移除旁侧重复计划数量；搜索时各状态数量同步更新。自动任务移除重复定时任务总数，保留分类内数量和执行统计。两页说明区统一预留两行，筛选栏保持同高单行；窄窗分类横向滚动，执行统计收缩并提供完整悬浮说明，避免文本换行导致切页时分隔线跳动。新增顶部几何与数量用例连续 5 次通过，修复前能复现 860 宽度下 19px 的分隔线错位；工作区回归 4 项、类型检查与构建通过。完整验证的运行时失败、旧中文定位修正和原生未验证情况见[验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 小程序管理导航与 AI 设置入口

小程序启动台和管理页共用数量工具栏，管理图标在原位置切换为返回启动台图标，返回入口不再移到窗口标题栏。管理页 AI 设置入口改为工具栏中的齿轮图标，悬浮说明显示本地化名称与模型路由提示；移除通栏入口及其独立样式，复用共享图标按钮。管理页不重复展示安装与启用数量。专项连续 5 次、314 项界面结构检查、类型检查、构建和浏览器回归通过；全仓运行时测试未全通过，原生 App 未验证，详见[验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 自动任务分段筛选

自动任务分类改为与计划页一致的共享分段按钮，直接切换自动化任务、Project 自动任务、一次性任务和系统任务，保留分类数量、详情清空及统计行为。沿用主题 token 和中英标签，窄窗允许换行。专项连续 5 次、界面结构检查 314 项、类型检查、构建及浏览器回归通过；完整验证有 4 项运行时失败，原生 App 未验证，详见[验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 技能管理入口统一

技能管理统一到外侧技能工作区，保留现有卡片、分段筛选和详情布局。内置技能可安装、更新或覆盖本地修改，版本与备份说明放在详情；设置中的 Skills 仅保留技能搜索配置和固定保存栏。内置技能以工作区副本的散列 ID 关联卡片，避免与同名 Agent 技能混淆。管理操作反馈与搜索设置反馈分离。侧栏技能入口移至计划下方。

自动生成的时间戳备份目录从管理与运行时技能扫描中排除；备份文件仍保留，避免旧副本变成重复卡片或参与技能目录渲染。迁移浏览器用例连续 5 次通过，覆盖真实文件与备份、设置保存及重启回读、中英、明暗与窄窗；22 项生命周期及身份检查、314 项界面结构检查各连续 5 轮通过。构建和类型检查通过；完整验证仍有运行时失败，见 [验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 计划筛选与返工编辑

计划状态改为分段筛选，详情操作移至标题下方。返工编辑器在正文顶部打开，支持取消并清空草稿；存在未填写名称或有效步骤的任务时，禁止继续添加或保存，避免堆积空任务和保存时忽略半填内容。编辑期间的新增返工入口禁用，切换计划不沿用另一计划的草稿。桌面返工 API 明确以用户身份记录修订，修复缺少作者信息导致的保存失败。工作区 3 项用例各连续运行 5 次，共 15 项通过；类型检查、服务及桌面构建和本轮完整自动验证通过，原生 App 测试环境缺失、未验证。完整记录见 [工作区验证](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-16 — 工作区说明与小程序工具栏

自动任务和计划在内容区顶部补齐中英页面说明，沿用共享说明样式。小程序的已安装/启用数量靠左，管理图标移至同一行右侧，标题栏保留展开式搜索，管理页返回仍在标题栏。固定列表和窄窗切换保持原有结构。工作区浏览器用例连续 5 轮共 10 项通过，界面结构检查、类型检查与桌面构建通过；完整验证和限制见 [验证记录](docs/reviews/workspace-redesign-verification.md)。

## 2026-10-15 — 刷新接续阶段 1（已交付；逐字实时回放属阶段 2）

生成中的回合不再因刷新或连接中断而被中止。`/api/stream` 不再把请求断开当作中止来源，服务端把回合跑到自然完成并把回复持久化到会话（用户已确认「运行到完成」策略）；`chatSessionStore.reconnect()` 改为把孤儿运行收编进对应会话并恢复结果：`ConversationController.recoverRunningTurn()` 显示「Resuming…」并轮询 `/api/desktop/session-runs` 直到运行结束，然后 reload transcript，期间用户仍可 Stop。恢复过程不重发消息，因此不重复执行、不丢失回复。顺带修复生成中刷新取消在途请求导致的未处理 Promise 拒绝（`refreshAgentSessions`）。浏览器用例覆盖「生成中刷新后接上回复、恰好一次」，连续多次通过；测试接缝新增按用例的页面错误白名单（`expected-page-error`）。刷新后继续接收逐字实时增量的运行事件日志与订阅接口属阶段 2，见 [规格](docs/requirements/session-run-reattach-spec.md)。

## 2026-10-15 — 桌面功能工作区重设计（已实现，工作区验证通过）

自动任务、技能、计划和小程序保留四个独立导航入口。四页统一使用标题栏搜索图标，点击展开并聚焦，关闭或 Esc 清空并收起；标题栏各操作仅显示单个图标并保留悬浮提示，刷新直接展示；分类、筛选与数量位于下方，技能范围使用分段按钮。任务和计划使用 320px 固定列表，窄窗切换列表与详情；未选中时右侧复用启动页 Agent City 插画。技能卡片整合短说明、范围信息与底部启停/详情；完整说明与内部 ID 留在详情。技能卡片使用中性边框和状态文字，去掉绿色侧线；主题沿用共享选中配色与控件 token。

设计规范见 `DESIGN.md` 的“功能工作区”。浏览器用例验证真实暂停及保存、技能启停、搜索展开/关闭与空结果、固定列宽、未选中插画、独立导航、主题、中英切换、窄窗及隔离服务重启。工作区两项用例各连续运行 5 次通过，313 项界面结构检查、桌面类型检查和构建通过；完整验证入口未全通过，原生 App 测试环境缺失。验证记录见 [工作区重设计验证](docs/reviews/workspace-redesign-verification.md)；原生安装包未更新。

## 2026-10-15 — Agent 数据强制迁移（已交付）

迁移弹窗提供“强制迁移（跳过异常项）”，统一跳过归属不明、引用歧义、元数据损坏、符号链接与文件冲突，正常数据继续复制和校验。会话正文或元数据失败时连同该会话的路由与索引一起跳过。跳过的源文件保留；无法关联的数据库记录在同一事务内备份到 `agent_storage_skipped_rows` 后移出恢复流程，无法处理的数据库连同 SQLite sidecar 保存在迁移目录的 `skipped-databases/`。完成页可查看跳过记录与备份位置，确认完成状态持久化，旧数据不会在重启后再次阻断启动。目标写入失败仍报错，不标记完成。

根因属于迁移错误处理粒度：已知历史表的逐类放行无法覆盖其他表与异常来源。临时目录回归覆盖引用歧义、孤立运行、损坏数据库、符号链接、暂存冲突、原数据与备份保留、无可迁移会话和重启；真实浏览器覆盖按钮、普通迁移阻断、强制成功、完成报告、窄窗、中英与冷启动。

验证：迁移相关 58 项通过；新增回归和强制迁移浏览器用例连续 5 次通过。类型检查、Desktop 检查、服务与 Desktop 构建、Desktop 单元测试、WebKit 29 项和 Chromium 冒烟 3 项通过。`verify:feature` 全核心 2,866 项中 2,859 项通过、6 项失败、1 项跳过；提示词、审批、子模型和会话派生的 5 项失败在改动前的迁移模块对照中同样复现，另有 MCP 超时在单独运行时通过。全量验证不计为通过；原生 App 测试环境缺失，未验证。

## 2026-10-14 — Feature 验证 P0 浏览器场景补齐（已交付；刷新接续待决策、原生未验证）

在隔离实例与 `verify:feature` 基础上补齐 P0 浏览器用例：连点发送不重复；队列入队、顺序执行、清空不执行、插话投递到运行中的回合；排队时审批与队列按顺序推进；允许/拒绝审批之外，重复点击审批恰好执行一次、待审批时切换会话不串、提交中切换会话后仍恰好一次；生成中、工具运行中、待审批时都能 Stop 并继续发送；设置页「默认执行模式」字段级保存、离开返回、重启回读且不覆盖 Agents 配置；SSE 空闲看门狗在单元层拒绝无事件的流（覆盖请求超时机制）。断言仍同时检查界面、模型请求总数与磁盘文件内容。

`reconnect()` 按设计中止孤儿运行（无法恢复已断开的 SSE），因此「生成中刷新接续回复」这一 P0 无法在不改动运行态架构的前提下作为测试实现：刷新会得到「Interrupted」并丢失进行中的回复。已在覆盖清单标注为阻塞，并经用户决定另立 spec 实现运行态重新订阅后再启用。原生 App 测试仍未建设。

验证：WebKit 全套 28 项通过，Chromium 冒烟通过，新增 11 项连续 5 次通过，类型检查与基础设施自测通过。

## 2026-10-14 — 聊天正文中的本地图片（已交付）

Desktop 聊天 Markdown 中的 scratch 图片引用，通过本轮成功工具记录对应到图片附件，再复用受控附件读取和 Blob URL。图片加载后正文自动更新，点击使用现有图片预览；加载失败或附件关联不明确时保留替代文字，不把磁盘路径作为 WebView 请求地址。远程图片地址保持原有加载行为。正文与过程说明中的图片预览最大宽度 480px、高度 360px，保持原比例且不放大小图；窄列内自适应，点击使用全屏预览。

根因属于资源地址解析和渲染层接线遗漏。回归覆盖原图路径到附件、异步加载、失败与同名歧义；真实浏览器覆盖正文图片加载和点击预览。此前 CSP、附件图库守卫未覆盖正文磁盘路径。原 session 回放、桌面测试、类型检查（0 错误、1 个既有警告）和构建通过；WebKit 图片加载、读取失败与尺寸/放大三项连续 5 轮通过。完整核心回归 2717 项通过，6 项失败、1 项超时取消、1 项跳过；其中取消与恢复两项单独运行通过，其余为既有 profile、审批、用量及 session fork 失败。全量不能算通过。`verify:feature` 的类型、基础冒烟、桌面测试和 Chromium 冒烟通过；WebKit 26 项通过，1 项因两轮验证共用输出目录而缺失轨迹文件，该审批用例在独立输出目录通过，汇总命令仍记为失败。原生 App 冷路径因缺少测试构建与驱动未验证。

## 2026-10-14 — 顶栏分隔线弱化（已交付）

侧栏与标题、标题与 Inspector 之间的顶栏竖线统一为文字字号高度（13px）、1px 宽、垂直居中，并降低至原边缘色的 65% 透明度。Inspector 正文分隔线保留，折叠侧栏时仍隐藏左侧顶栏分隔线。共用主题 token，适配中英、明暗主题与窄窗口。

验证：中英 × 明暗 × 1120/760px 实际页面检查、首次打开文件面板、侧栏折叠、页面切换与隔离服务停启恢复通过；类型检查、桌面构建与 327 项桌面测试通过。顶栏布局断言更新为文字高度的共享分隔线，连续 5 次通过。WebKit 自动选择的 5 项通过；Chromium 首轮预热等待 Momo 超时，独立输出目录重跑 3 项通过。完整核心回归仍有既有的 5 项失败（Agent profile、Desktop approval、Pi child usage、Session fork）；原生 App 冷路径因测试构建和驱动缺失未验证。

## 2026-10-14 — Feature 开发验证自动化（阶段 1 与阶段 2 基础设施，已交付；原生未验证）

把原型重做为隔离实例驱动的验证体系：`tests/ui/support/instance.ts` 用临时数据目录、临时 HOME、空闲端口和仅监听回环的预设回复模型服务启动真实服务，子进程只拿到白名单环境变量（PATH/HOME/TMPDIR 等必需项），启动前的守卫在非临时目录、非回环模型地址或存储路径逃出临时目录时拒绝启动并报错。`tests/ui/support/model-service.ts` 按用例登记回复脚本，支持分段文本、参数分段的工具调用、同一轮多个工具调用、暂停等待释放、中途报错、断开连接、HTTP 错误码（含 429）和非流式回复；每个请求完整记录模型名、系统提示词、消息与工具列表，未匹配请求被记录并让用例失败。共享数据准备显式声明标题生成这一后台请求。

Playwright 浏览器测试覆盖冷启动、消息输入（Enter/Shift+Enter/空消息/组合输入）、连发与流式更新、请求失败（429/500/断开）与重试、允许与拒绝审批（批准前无文件、批准后文件正确、工具恰好一次）、生成中 Stop、队列入队与删除、会话草稿隔离与后台回复归属、服务停启后回读。断言同时检查界面反馈、模型请求总数和磁盘文件内容。

`pnpm verify:feature` 按 git 改动确定性地选择逻辑/API 测试、基础冒烟和 UI 场景；涉及 Tauri 代码、桌面 API 传输层、Supervisor、启动/握手时要求原生测试；`--tags=` 只能追加。自动选择映射与守卫、模型服务一样有独立自测。覆盖清单落在 `tests/ui/COVERAGE.md`。

验证：WebKit 全套 17 项连续 5 次通过，Chromium 冒烟 2 项通过，基础设施自测 23 项通过，基础冒烟 161 项通过，类型检查通过。本次改动未命中自动选择规则，`verify:feature` 回退到完整核心回归；完整核心有 5 项与本次改动无关的既有失败（`builtInAgentPrompt.test.ts`、`desktopApprovals.test.ts`、`piChildUsage.test.ts`、`sessionFork.test.ts` 两个用例），本次不修改 `src`，未处理，已在交付说明中列明。原生 App 测试尚未建设（`pnpm test:app` 输出「原生：未验证」），交付说明照实列出。流式回复期间的首个文本增量不会出现在实时流中（最终正文完整，后续增量正常），已在覆盖清单记录，未在本次范围内修改运行时。参见[规格](docs/requirements/feature-verification-spec.md)与[覆盖清单](tests/ui/COVERAGE.md)。

## 2026-10-13 — 修复版本审查发现的五项问题（已交付）

扩展 `stream.result()` 等待模型终态，即使不消费事件也返回完整结果或失败。参考图下载按流累计限额，超限立即取消；内联参考图同样执行 10 MiB 校验。事件子调用身份包含扩展、handler、原生父任务及父工具，区分独立请求并保持恢复稳定。MCP 授权等待使用工具的实际期限与取消信号，超时后的授权不能重发原调用。桌面共享规则复用已授权的 Desktop profile API，全局保存只更新提交的文件。

五项故障的回归均在修复前失败，161 项相关回归连续 5 轮通过；核心 812 项通过、1 项缺少 fd 跳过，桌面 327 项及 Rust 70 项通过，类型与构建通过。共享规则 UI 在 Chromium/WebKit 各 5 次通过；原生 App 首次加载、保存、页面/Session 切换、托管服务重启和中断恢复完成。详细根因、守卫和边界见[审查修复记录](docs/work/progress/pi-capability-completion/review-fixes.md)。

## 2026-10-13 — Pi 能力补齐：恢复、授权、模型与扩展运行（本地已交付）

普通渠道任务在恢复核对后继续原执行，批准/拒绝通过真实启动和审批路径验证，Web 明确显示核对原因。MCP OAuth 支持部署回调、共享刷新和追加 scopes；交互式调用等待授权，安全读继续，未知外部操作不自动重放。桌面授权消息随语言即时切换，切换页面和服务重启后按实际授权状态刷新。

Codemode 与扩展的分类、图片及 chat 请求由原生子任务拥有，使用共享权限、审批、预算和稳定用量收据；图片进入共享媒体任务，保存失败仍保留已发生的费用。恢复复用已提交响应，未知收费请求不能换 call ID 重试。扩展支持原执行 signal、命令、嵌套工具的进度/取消和显式原生压缩；迟到结果不能跨运行使用。

接口范围见[扩展运行说明](docs/guides/pi-extension-runtime.md)，实际验证与限制见[验收记录](docs/work/progress/pi-capability-completion/validation.md)。真实第三方 OAuth 和付费模型验收按用户决定跳过。

## 2026-10-12 — 协作规则：测试用例的添加、更新与执行时机（规则调整）

AGENTS.md 新增「测试用例维护与执行」：新增用户可见行为、修 Bug（先写复现用例）、改持久化或运行时、改原生链路时必须添加用例；产品行为有意变化、定位失效、功能删除、出现不稳定用例时按规则更新，禁止靠放宽断言、加等待或重试让测试通过；实现单元完成后跑相关测试，交付前使用仓库已有验证入口（没有 `verify:feature` 时按 AGENTS.md 中的验证范围手动运行并列出），运行时与原生改动分别扩大到核心回归和原生测试，环境缺失标为“未验证”。规则直接写在 AGENTS.md 中，不依赖需求规格文档。

## 2026-10-12 — Codemode 大图精确制品引用 + 大结果 IPC 丢失修复（已交付）

Codemode 脚本用 `image()` 展示的超大生成图片，文本引用现在带**精确的工作区相对路径**，不再是「已保存到本运行制品」的模糊说明。修了两个根因：① 沙箱 `image()` 只保留 `data`/`mimeType`、丢弃 ModelOperations 给的 `ref`，主机侧改为按图片字节记录 `models.generateImages` 的制品路径并在结果装配时回填；② `modelOperations.generateImages` 的 `ref` 原用 `workspaceDir/name` 拼接，而文件实际写在 `artifactDir` 下，路径指向不存在的文件——改为按实际落盘位置计算，并在其中位于工作区时给出工作区相对路径（在工作区外退回绝对路径）。顺带修一个真实数据丢失：大结果经 IPC 回传时，worker 紧随其后的 `process.disconnect()` 会丢掉尚未冲刷的消息，导致整个脚本结果丢失（宿主报 “exited without a result”）；现在 `send` 在 `process.send` 回调后才 resolve，结果发送改为 await，宿主 fallback 从 `exit` 改到 `close`。

验证：`modelOperations.test.ts` 新增「工作区内→相对 ref / 工作区外→绝对 ref」；`codemode.integration.test.ts` 增至 14 项，新增「超大展示图带精确制品引用」（修复前失败：文本无路径；IPC 修复前宿主报 exited without a result），连跑 5 次全绿；`codemode.test.ts`、`piExtensions/modelRegistry.test.ts` 回归通过；根 `check` 未引入新错误、`build` 通过。

未验收：真实 Runner 中的多图/参考图/伴随文本与费用归属（需真实或更完整的模拟 classify/image Provider）。

## 2026-10-12 — Room 恢复核对运行时装线端到端 + 续跑幂等根修（已交付）

补上 A 单元最后一块运行时装线验收：新增 `piRecovery.roomReview.test.ts` 与 fixture `evals/fixtures/pi-room-review-worker.ts`。首启让真实 Room 执行打到进程内 provider 后被杀，制造 Pi `request` 阶段的活请求；重启经真实启动协调器分类为 `review`，`failPiRecoveryReview` 把 Room 执行停在 `waiting_approval` 并挂共享 Decision Request（`recovery-review:<runId>`，capability `recovery_review`），且**在人工决定前不再重发**；再经真实 Desktop 审批入口批准 → `onApprovalResolved` → `resumePiRecoveryOwner` → `resumeNativeExecution` 续跑并完成（恰好一次重发），拒绝 → run `aborted`、执行 `failed`、恢复记录清除。

过程中拦下一个真实根因：`RoomStore.recordContextRun` 用普通 `INSERT`，恢复执行以同一 execution id 重新进入 runner 时会撞 `UNIQUE constraint failed: room_context_runs.execution_id`，导致批准后续跑直接失败。改为 `INSERT OR IGNORE`（该映射幂等），在共享 store 层根修。

验证：`piRecovery.roomReview.test.ts` 2 项（approve/reject 全链路）；`rooms/service.test.ts` 31 项、`rooms/runtime.integration.test.ts`、`piRecovery.ordinary.test.ts`、`piRecovery.windows.test.ts`、`piRecovery.classification.test.ts`、`recoveryReview.test.ts`、`replaySafety.test.ts`、`piRecovery.continuity.test.ts`、`backgroundConversation.test.ts` 回归全通过；`test:service-bootstrap` 21、`test:desktop-chat` 305、`test:projects` 86、`test:decision` 50；根 `check` 未引入新错误（仅剩既有错误）、`build` 通过。

未验收：非 Room（渠道投递）的 `resumePiOwner`/`runBackgroundConversation` 续跑路径仍无运行时装线端到端（`piRecovery.ordinary.test.ts` 只覆盖分类，不覆盖续跑）。

## 2026-10-11 — 内置头像选择器改为目录派生，scifi 头像集入库（已交付）

Agent 设置页"内置头像"网格原来写死 12 个 `pattern-*.svg`，导致后来放入 `static/agent-avatars/` 的 12 个 `scifi-*.svg` 永远不出现在选择器里（且 `static/` 根目录这份拷贝在代码中零引用，真正被服务的是 `apps/desktop/public/agent-avatars/`）。根修：资产收敛到 `apps/desktop/public/agent-avatars/` 单一目录（删除根目录 `static/`），新增 `agentAvatarPresets.ts` 在构建时用 `readdirSync` 派生列表（扩展名过滤 + 自然排序 + 中英标签），经 Vite 虚拟模块 `virtual:agent-avatars` 注入 `AgentSettingsPage.svelte`——以后往目录里加图片文件即自动出现在选择器，列表不再可能与目录脱节。头像 URL 格式不变（`/agent-avatars/<文件名>`），已保存的 Agent 头像继续有效。

验证：`agentAvatarPresets.test.ts` 2 项（临时目录派生、自然排序、双语标签）、settings 组 13 项、reactive/runes 守卫通过；`desktop:check` 0 错误（仅剩 AgentCityInspector 既有警告）；`vite build` 产物含全部 24 个头像 URL 与标签；隔离 dev 实例（端口 1427）冒烟：scifi svg 200、虚拟模块导出 24 项、设置页编译 200。未执行 Tauri 原生壳冷启动走查；24 个 svg 与新代码尚未提交 git。

## 2026-10-12 — Room 恢复核对接入 Decision Request（部分交付）

Room 执行遇到「重启前结果未知需核对」时不再直接终态失败：`RoomService.parkNativeRecovery` 把执行停在 `waiting_approval` 并挂上共享 Decision Request（`recovery-review:<runId>`），Room 现有审批卡即可展示；批准经 `onApprovalResolved` → `resumeNativeExecution` 续跑（守卫已接受 `waiting_approval` 并清审批），拒绝/过期则结束执行。Room 审批请求用 agent 身份以通过身份校验；`rooms/runtime.ts` 把 `approvedRecoveryCallIds` 从恢复记录透传给 Run，保证确认过的未知调用按中断结算、不重放。

验证：`rooms/service.test.ts` 新增「park + resume once approved」；rooms 与 piRecovery 回归 51 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：Room review 的真实运行时装线端到端（真实 Room + durable + 重启 + 审批续跑/拒绝/不重放）。

## 2026-10-12 — Codemode 大图不内联（部分交付）

Codemode 脚本经 `image()` 展示的生成图片，base64 超过 700k 字符时不再内联进工具结果，改为文本制品引用，避免单图灌爆模型上下文与记录；小图仍内联供视觉。逻辑抽为 `inlineOrReferenceImages` 纯函数。

验证：`codemode.integration.test.ts` 13 项（新增小图内联 / 大图转引用）；根 `check` 仅剩既有会话列表错误、build 通过。未验收：沙箱 `image()` 丢弃 `ref` 导致精确制品引用缺失，及图片经媒体任务服务的来源归属。

## 2026-10-12 — 等待核对专用审批文案（部分交付）

桌面聊天里的「等待核对」审批不再复用通用主机命令文案：`ChatView.svelte` 按 `command === "recovery_review"` 切换到专用标题与说明（说明这是服务重启前结果未知的外部操作；批准=按已中断处理并继续，不重放），中英各加 `approvalRecoveryReviewTitle` / `approvalRecoveryReviewSubtitle`。

验证：Desktop `svelte-check` 0 错误 1 既有警告；根 `check` 仅剩既有会话列表错误、build 通过。Web 端审批卡（若有）仍为通用呈现，Room review 仍为终态失败，均留待后续。

## 2026-10-12 — Pi 扩展 compact 与事件路径（部分交付）

`ctx.compact()` 现在真实触发原生压缩（经运行预算），Plan/只读下不可用。新增按 run 的扩展宿主注册表（`plugins/piExtensions/runHost.ts`，`createMomTools` 每次运行时注册）：事件处理器拿到与工具相同的真实快照、`ctx.tools` 与 host session，因此在事件里也能 `executeTool` / `stream` / 分类图片；无运行时退化为 cwd + 系统提示。

验证：`executeTool.test.ts` 9 项（含 compact 通知、事件处理器嵌套调用）、`eventBridge.test.ts` 9 项；piExtensions 与工具组 90 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：`ctx.signal`、命令（slash command）路径、跨作用域（当前由快照天然限定）、真实扩展宿主端到端。

## 2026-10-12 — Pi 扩展工具目录与 abort（部分交付）

`ctx.tools` 现在给出与模型相同的**可调用工具目录**（名称/标签/描述/参数 schema，`createMomTools.toolCatalog` → worker），扩展据此知道 `executeTool` 能调什么。`ctx.abort()` 经双向 IPC 通知主机（`extensionAbort` → `PiRunSession.abort`，任何模式可用）；扩展忽略取消时 worker 被终止、fault 上报，服务其他部分不受影响。

验证：`executeTool.test.ts` 增至 7 项（新增工具目录、abort 通知、忽略取消不拖垮服务）；piExtensions 与工具组 88 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：真实 `compact`/`signal`、事件/命令路径快照与嵌套调用、跨作用域（当前由快照天然限定）、真实扩展宿主端到端。

## 2026-10-12 — Pi 扩展只读 sessionManager（部分交付）

扩展现在可通过 `ctx.sessionManager` 只读地查看当前执行的原生会话：`getSessionId`/`getCwd`/`getSessionFile`/`getSessionDir`/`getSessionName`/`getHeader`/`getLeafId`/`getLeafEntry`/`getEntry`/`getEntries`/`getBranch`/`getTree`/`buildContextEntries`/`buildSessionProjection`；无标签时 `getLabel` 返回 `undefined`，线性日志的 `getTree` 为扁平。条目来自原生 durable 活跃上下文（存储已解析分支），每条携带其贡献的模型消息（同时以 pi 风格 `message` 暴露、并保留完整 `messages`），每次调用刷新（`PiRunSession.extensionSessionSource` → `PiConversationRuntime.context()`），同步返回、不伪装 Promise；快照不含凭据。注意 durable 记录与 pi SessionManager 的字段差异（无 `parentId`/`timestamp`）。

验证：`sessionSnapshot.test.ts` 1 项（身份/记录/分支/叶/树/投影/无标签）与 `runtimeSnapshot.test.ts` 增 session 断言；piExtensions 与工具组 84 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：真实 `abort`/`compact`、`ctx.tools` 工具目录、事件/命令路径快照、跨作用域拒绝、扩展崩溃/忽略取消端到端、真实扩展宿主端到端。

## 2026-10-11 — Pi 扩展流式 chat（部分交付）

`ctx.modelRegistry.stream`/`streamSimple`/`complete` 现在可用：主进程用共享 `Models` 适配器（`getPiModels()`）运行 provider 流，并经新增的双向 IPC 推送通道（`hostEvent`）把有界序列化事件回传给扩展；authority、预算与用量与 Codemode 同一条路径。单个事件超过 256KB 会使流失败而不是越界；扩展侧传 `AbortSignal` 取消会通知主机（`modelRegistry.streamAbort`）并终止流。

验证：`modelStream.test.ts` 5 项（事件顺序 + 最终结果、`streamSimple` 标记、超界失败、主机失败→错误、取消通知）通过；piExtensions 与工具组 83 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：只读 session 快照、真实 abort/compact、`ctx.tools` 目录、事件/命令路径快照、跨作用域拒绝、扩展崩溃/忽略取消端到端、真实 Provider/扩展宿主端到端。

## 2026-10-11 — Pi 扩展 modelRegistry：发现与分类/图片（部分交付）

扩展可通过 `ctx.modelRegistry` 做同步模型发现（`getAll`/`getAvailable`/`find`/`findOfType`/`getModelsOfType`/`getModelOfType`/`hasConfiguredAuth`），并用 `classify`/`generateImages` 调用模型；后两者经双向 IPC 走共享 `ModelOperations`，权限、预算与用量与 Codemode 同一条路径。凭据、Provider 对象、Provider/模型注册、`stream`/`streamSimple`/`complete` 明确拒绝（不再静默成功）。新增 `plugins/piExtensions/modelCatalog.ts`，仅暴露 provider/id/name/api 与「是否有凭据」，每次调用重新解析可用性、快照不含凭据；`toolBridge` 的 host session 增加 `modelRegistry.classify`/`generateImages` 分发，Plan/只读下不可用并返回错误结果。

验证：`modelRegistry.test.ts` 3 项、`modelCatalog.test.ts` 2 项，`runtimeContext.test.ts` 增发现断言；piExtensions 与工具组 78 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：流式 chat 调用、只读 session 快照、真实 abort/compact、`ctx.tools` 目录、事件/命令路径快照、跨作用域拒绝、扩展崩溃/忽略取消端到端。

## 2026-10-11 — Pi 扩展 executeTool 走共享 ToolRuntime（部分交付）

扩展子进程现在能通过 `ctx.executeTool(name, args)` 嵌套调用工具，且经**共享 ToolRuntime** 运行：`createMomTools` 用与模型相同的可调用工具集解析目标，未知工具和主机端失败都返回 `isError` 结果而不是抛出。为此新增 worker→主机请求通道：`processClient.ts` 的 `registerHostSession`/`releaseHostSession` 按 token 把请求路由回发起它的那次调用，`toolBridge.ts` 每次调用注册/释放 host session 并透传 `hostToken`，从而按调用身份隔离并拒绝迟到回复；`ctx.tools` 暂为空。

验证：`executeTool.test.ts` 4 项（成功路由、无 host session 报错、主机失败→isError、已释放 session 拒绝迟到请求）通过；piExtensions 与工具组 93 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：只读 `sessionManager` 快照、`modelRegistry`（发现/分类/图片/流式）、真实 `signal`/`abort`/`compact`、`ctx.tools` 工具目录、事件/命令路径的完整快照与 `executeTool`、跨作用域拒绝、扩展崩溃/忽略取消端到端、真实扩展宿主端到端验收。

## 2026-10-11 — Pi 扩展运行接口首片：真实运行状态（部分交付）

真正运行扩展的子进程（`scripts/runtime/untrusted-pi-extension-worker.mjs`）不再是占位上下文：`ExtensionContext` 的 `cwd` / `systemPrompt` / `model` / `thinkingLevel` / `scopedModels` / `isIdle()` / `hasPendingMessages()` / `getContextUsage()` / `getSystemPrompt()` 现在来自调用方传入的真实运行快照。新增 `plugins/piExtensions/runtimeSnapshot.ts`（`buildPiExtensionRuntimeSnapshot`，序列化 pi-ai `Model` 时剥离 headers，快照不含凭据）与 `types.ts` 的 `PiExtensionRuntimeSnapshot`。未接线的 `sessionManager` / `modelRegistry` 改为命名抛错代理，`abort()` / `compact()` / `shutdown()` 明确抛错——不再静默 no-op 或返回伪造成功。工具路径经 `createMomTools.piExtensionRuntime` → `createPiExtensionTools.runtime` → worker 透传；`runner.ts` 用 `PiRunSession.state` + 渲染后的系统提示 + 待处理消息数组装快照。

验证：`runtimeSnapshot.test.ts` 3 项与 `runtimeContext.test.ts`（真实子进程加载 fixture 扩展）通过；piExtensions 组 38 项、根 `check`（仅剩既有会话列表错误）与 build 通过。

未验收：只读 `sessionManager` 快照、`modelRegistry`（发现/分类/图片/流式）、`executeTool()` 走共享 ToolRuntime、真实 `signal`/`abort`/`compact`、事件/命令路径的完整快照、身份绑定与迟到回复隔离、跨作用域拒绝、扩展崩溃/忽略取消的端到端、真实扩展宿主端到端验收。

## 2026-10-11 — MCP OAuth 回调与追加授权的单元验证（部分交付）

为回调和追加授权补单元/集成验证，并明确标注不能单测的部分：
- **回调 host 契约**：`oauth.e2e.test.ts` 注入 `listenCallback`（`OAuthCallbackServer.listen({ redirectHost })`），断言授权请求的 `redirect_uri` 取自监听器上报的地址、不硬编码 loopback。**远端公网回调本身仍需「回调基址」配置与部署，尚未实现**，因此只验证了接缝，未验证公网可达。
- **追加授权（step-up）**：断言传输遇 403 `insufficient_scope` 时给出可操作的 `McpOAuthAuthorizationRequiredError`；并断言 Molibot 安装的 `adaptOAuthProvider` 在 step-up 时请求「已授予 ∪ 被要求」的并集 scope。**传输触发的自动打开浏览器/自动续跑尚未实现**，只验证了「安全暂停 + 并集 scope」这一已实现契约。
- **真实第三方账号**与**原生桌面冷启动**无法用单元测试替代：前者需要真实 OAuth MCP 服务与账号（隔离实例手工走查），后者需要运行 Tauri（手工走查）。本地 fixture 已覆盖真实账号会走的同一批代码路径（discovery / 注册 / PKCE / state / issuer / 刷新 / step-up / 退出 / 重启），但不证明外部服务本身可用。

证据：`oauth.e2e.test.ts` 13 项通过；服务端 B 组与 MCP UI 守卫通过；类型检查仅剩既有错误。

## 2026-10-11 — MCP 重新授权保留额外 scopes（已交付）

重新授权（含 step-up 后再次登录）改为请求「已授予 scope ∪ 授权服务器声明的默认 scopes」，不再用默认 scope 覆盖并丢掉此前追加授予的权限。根因：`McpOAuthManager.beginLogin` 未向 Pi 的 OAuth 流程传 scope，`runFlow` 回退到 protected-resource metadata 的 `scopes_supported`，额外 scope 被静默丢弃。授权请求与授权码交换现在都带上并集 scope。

验证：`oauth.e2e.test.ts` 新增用例先完成一次登录缓存 discovery 与客户端注册，再把已授予 scope 改为仅 `mcp.admin`，重新授权时断言授权 URL 的 scope 同时包含 `mcp.read`（声明的默认）与 `mcp.admin`（已授予）；人为移除修复后该断言失败，修复后 11 项全通过。

## 2026-10-11 — Desktop MCP OAuth 控件（已交付）

Desktop 原生 MCP 设置补齐 OAuth，与 Web 一致：编辑器可选择「请求头 / OAuth」，OAuth 下填写授权服务器元数据地址（留空自动发现）与客户端名称；列表行显示授权状态（已授权 / 未授权 / 已过期 / 等待浏览器 / 授权失败）与失败原因，并提供登录 / 重新授权 / 退出授权。登录在系统浏览器打开授权链接（Tauri `open_external_url`，非 Tauri 回退 `window.open`），随后每 3 秒轮询状态直到结算，授权成功后经共享重连发现工具。

根因是后端早已具备该能力、前端从未接线：`/api/desktop/mcp` 支持 `oauth_login` / `oauth_reauthorize` / `oauth_logout`，摘要已带 `authMode` / `authState` / `authError`，保存请求已带 `authMode` / `authServerMetadataUrl` / `clientName`，但 `McpSection.svelte`、`stores/mcp.svelte.ts`、`api.ts` 没有对应控件与调用。空白元数据/客户端名表示保留已保存值，切换为 OAuth 时后端会自动丢弃手工 `Authorization` 头。顺带修正 MCP UI 守卫里过期的 `removeMcpServer` 断言。

证据：MCP UI 守卫 4 项（含新增 Desktop OAuth 守卫）、Desktop UI 守卫 313 项、Desktop API 112 项、reactive/runes 守卫通过；`desktop:check` 0 错误、1 条既有警告。未执行原生桌面冷启动走查（需构建 Tauri 或中断服务），保留为待验证。

## 2026-10-11 — MCP OAuth 端到端（已交付验证）

使用本地 HTTP MCP 资源与本地 OAuth 授权服务器跑通真实协议链路，不再只做适配器单测：discovery、动态客户端注册、PKCE S256、`state` 校验、RFC 9207 `iss` 校验、刷新、追加授权（step-up）提示、同 URL 双账号隔离、退出/删除只清理自身、重启后凭据可用，以及登录完成后既有连接注册表重连并重新发现工具。

修复两处根因。①授权码交换没有复用配置的 `authServerMetadataUrl`，会在交换阶段重新 discovery，隐藏 discovery 或端点非默认时会指向错误授权服务器甚至失败；现在配置的元数据地址贯穿整个流程。②已结算或取消的登录尝试会滞留在内存 pending 表，导致退出或删除服务后状态回显为过期 `error` 而不是未授权；现在登录成功即移除尝试，退出/删除会丢弃尝试，迟到的尝试无法复活授权。

新增 `oauth.e2e.test.ts` 10 项覆盖上述链路；既有 oauth/oauthStore/mcpAuth/设置 round-trip 29 项、desktopMcp/openConnector 11 项、mcp 注册表 20 项、工具相关 31 项通过。类型检查仅剩既有的会话列表 API `unknown` 错误。未验收：Desktop 原生 MCP 设置页的 OAuth 控件、远端 Web 公网回调（当前 loopback）、传输触发 step-up 的自动续授权（当前安全暂停并给出可操作提示）、重新授权保留已授予的额外 scopes。

## 2026-10-11 — Agent 运行归属与侧栏图标（已交付）

运行事实保留执行上下文的 Agent 身份，状态投影使用该身份；桌面选择其他 Agent 后不再将运行状态归到 Momo，后续 Bot 改绑不改变已有运行的身份。侧栏仅显示状态图标，执行中使用 1.4 秒呼吸动画，空闲与未就绪不显示；中英说明保留在悬浮提示和无障碍名称中。减少动态效果或低性能模式下图标静态。

根因为运行身份在 trace 持久化与投影之间丢失。临时数据库回归覆盖真实 Hook → SQLite → 状态投影的开始、完成和改绑；轮询回归覆盖断连、失败与恢复。原有测试仅覆盖 Bot 配置绑定。27 项运行状态/Hook/轮询测试、313 项 Desktop UI 守卫、Desktop svelte-check（0 错误，保留既有 1 条警告）与 build 通过。组件浏览器检查覆盖首次加载、切换 Agent、中英、图标无可见文字、动画及断连状态模拟。完整服务冷启动、Session 切换与服务重连尚未执行，未重启当前执行中的用户服务。全项目类型检查仍被会话列表接口的既有 unknown 类型错误阻塞。

## 2026-10-11 — MCP 分发死锁与可配置超时（已交付）

`mcpInvoke` 将执行锁和副作用记录交给内部 MCP 工具，避免父调用持锁等待子调用的死锁；内部工具保留权限检查和串行保护，分发调用不会自动重放。每个 MCP 服务支持 `timeoutMs`（1000–3600000 毫秒，默认 120000），Desktop 编辑表单使用秒，Web JSON 配置使用毫秒。进度通知不延长绝对截止时间；超时传递取消信号并结束本地等待，远端写操作结果仍须核实后再重试。修改设置影响后续调用，不改变已在等待中的调用。

设置保存和启动读取共用 MCP 清洗逻辑，临时数据库 round-trip 覆盖完整服务配置。回归覆盖真实分发路径的父子锁、非自动重放、配置超时、取消和超时后的后续调用。

验证：117 项 MCP/运行时/设置相关测试、314 项 Desktop UI 与响应式检查、Desktop svelte-check、两端 build 通过。隔离实例验证保存、重启回读、页面切换、服务中断恢复、中英/明暗和 390px。全项目类型检查仍有既有会话列表 API 类型错误，旧 MCP 删除动作源码匹配测试与当前确认弹窗不符；真实服务已获授权重启，健康检查正常；tdx 已连接并返回 120000 毫秒超时，原 session 无活动运行记录。

## 2026-10-11 — 共享 Agent 规则真正生效（已交付）

设置导航分组使用“助手”。Agent 管理上方提供“共享配置 / 共享规则”编辑，读写真实全局 AGENTS.md，并且只保存该文件。所有 Agent 的提示词按共享协作规则、Agent 协作规则、Bot 补充规则叠加；明确的模型和身份等配置仍优先于共享默认。Momo 与全局规则共用同一文件且只注入一次。没有把 Agent 编辑变成全局编辑。

根因是同名 profile 文件的覆盖策略也用于协作规则，导致有专属 AGENTS.md 的 Agent 丢失共享规则；既有测试仅覆盖 Agent → Bot 叠加。增加真实提示词回归覆盖多个 Agent 与 Momo，验证共享只出现一次、专属仍保留及顺序；API 回归验证 scope=global 与仅写 AGENTS.md。30 项真实提示词、112 项 API、315 项 UI/响应式回归通过，Desktop check/build 与服务 build 通过。隔离实例检查保存回读、重启、服务恢复、中英明暗和 390px；没有新增 settings 字段，原生安装包未更新。

## 2026-10-11 — 设置页视觉整理（已交付）

设置导航使用清楚的选中态；标题与表单共享阅读列，分组标题、说明、行间距和分隔线统一。Agent 列表带身份头像；二级编辑保留全局导航，内部分类横向排列，身份标题与表单限定阅读宽度，头像预设按需展开。固定保存栏注明保存生效，正文留出底栏空间；分类切换返回正文顶部，草稿保留。窄窗口下拉单独一行，开关不挤压说明。沿用主题 token 和共享控件，无新依赖或持久化字段。

验证：315 项桌面 UI/响应式守卫、Desktop svelte-check 和 build 通过；隔离实例走查通用、模型、技能、记忆、渠道与两个 Agent 编辑入口，覆盖头像展开、分类草稿、保存返回、服务中断恢复、中英、明暗和 390px 无横向溢出及底栏可达。保留既有 1 条可访问性和构建体积警告，原生安装包未更新。

## 2026-10-11 — Agent 设置入口整理（已交付）

全局设置的 Agent 页面把默认 Agent 放在上方“全局设置”组，说明仅影响全局新对话。列表使用“编辑”入口，已有 Agent 位于安装模板前。Agent 编辑是右侧内容区的二级页面，最左侧始终保留设置搜索与导航；内部分类和固定保存栏限定在编辑区域，返回 Agent 列表。Agent 首页进入编辑继续保留应用导航。专属记忆与共享记忆分开，机器人默认仅显示当前绑定。

验证：315 项桌面 UI/响应式守卫、Desktop svelte-check 与 build 通过。隔离实例检查冷启动、两个编辑入口、设置导航切换保留草稿、保存/返回、服务中断恢复、中英明暗及 390px 无横向溢出和固定底栏。保留既有 1 条可访问性及构建体积警告，未更新原生安装包。导航守卫明确检查全局设置导航不因 Agent 编辑而隐藏，编辑区域保留窗口拖动栏占位。无持久化字段变化。

## 2026-10-11 — Agent 机器人绑定交互（已交付）

Agent 设置的“消息渠道”改为“绑定的机器人”。默认只列出当前 Agent 的绑定；“绑定其他机器人”显示渠道、原负责人及改绑说明。“移交给 Momo”代替解绑开关，Momo 的机器人通过目标 Agent 的绑定入口转交。所有操作先进入草稿，待保存区列出变更与撤销；固定底栏保存后生效，历史会话归属、机器人启用状态及凭证不变。

验证：6 项绑定投影/共享保存回归、315 项桌面 UI/响应式守卫通过；Desktop svelte-check 与 build 通过，保留既有 1 条可访问性及构建体积警告。隔离实例完成首次打开、分类切换、绑定/移交/撤销、保存回读、服务中断后保留草稿与恢复重试、中英明暗/390px 固定底栏走查。未更新原生安装包。

根因是作用域和操作含义混淆：把全局机器人列表与当前 Agent 绑定用启停样式开关呈现。既有守卫验证保存时不覆盖渠道配置，没有验证视图归属及草稿动作；新增投影回归覆盖仅显示当前绑定、跨渠道同 ID、移交、撤销和 Momo 非空身份。不需要新增持久化字段或长期 pitfalls。

## 2026-10-11 — 迁移完成状态在新建会话与重启后保持（已交付）

已完成迁移且源文件未新增或变化时，启动检测跳过旧会话映射的数据库校验；保留或删除旧目录都不会因新运行记录重新要求迁移。搜索历史缺少归属时保留原 ID，明确归属的记录正常转换，首次迁移仍阻止有歧义的待恢复任务。56 项迁移/运行时回归、独立进程中新建会话后再次启动及生产构建通过；全项目类型检查被会话列表接口的 `latestConversationAtByAgent: unknown` 错误阻塞。

## 2026-10-11 — Agent 首页去掉输入框 Agent 选择器并补齐会话右键菜单（已交付）

Agent 首页输入框左下角的 Agent 选择器移除：首页本来就挂在侧栏选中的 Agent 下，头像与标题也已标明身份，composer 里再放一个可点选 Agent 的下拉属于重复入口（群聊 Room 内选择发言对象的选择器不受影响，仍有真实作用）。会话内的 composer 保留只读 Bot 徽标（locked 模式），仅移除 draft 模式的 select 下拉。

Agent 首页「最近对话」、全部对话历史页与搜索浏览弹层的会话行右键菜单补齐为 3 项：复制 session 路径、从 Finder 打开、删除对话（复用侧栏同款 RowContextMenu 与既有 `copySessionPath` / `revealSessionInFinder` handler，复制与 Finder 对只读会话同样可用；项目来源会话按 `projectId` 解析路径）。新增 chat-ui 守卫：首页 composer 不再出现 select/locked 双模式，三种会话列表均接线复制/Finder/删除。

验证：313 项 chat-ui 回归、相关单测与守卫、桌面生产构建通过；svelte-check 仅剩未跟踪新文件 AgentSettingsPage.svelte 的 1 条既有错误与 AgentCityInspector 的 1 条既有 a11y 警告，均非本次改动文件。真实桌面冷启动走查未执行（需启动桌面实例，避免打断正在使用的会话），建议重启桌面应用后确认首页输入框左下角已无 Agent 头像按钮、右键行出现 3 项菜单。

## 2026-10-11 — Agent 配置范围与文件卡片（已交付）

通用设置增加“全局 Agent 的设置”目录。单 Agent 编辑标题显示身份，技能按专属和继承范围显示数量，共享技能默认收起；记忆分别显示当前 Agent 和已授权共享记录数量。Momo 角色文件作为全局默认规则的影响在角色页明确说明。

文件页按生成内容、上传附件及来源待确认分区，再按文件类型分组，组内时间倒序。卡片显示图片缩略图、渠道、完整时间和来源对话；预览保留项目及对话身份。来源从共享文件接口的消息角色、入站附件及成功工具记录判定，历史证据不足时保留待确认状态；普通文本扩展名识别在共享文件预览层修正。图片使用既有文件传输，进入可视区域后加载并释放 Blob URL。

验证：15 项文件来源/类型/分组/分页回归、315 项桌面 UI/响应式守卫通过；Desktop svelte-check 无错误（1 条既有可访问性警告），服务和桌面 build 通过。隔离实例验证首次打开、分类切换、图片预览、来源对话切换、服务停止后错误及重启重试、中英即时切换、明暗与 390px 无横向溢出。根项目 check 被未改动的 piRecovery.ordinary.test.ts 和 conversations API 类型错误阻塞；未替换原生安装包。

根因：配置作用域未在界面区分，文件接口缺少来源字段。旧文件守卫验证可见性、身份和迁移映射读取次数，没有验证来源。新增回归覆盖消息角色及同目录内的生成/上传/未知文件；既有长期规则足够，无需重复加入 pitfalls。

## 2026-10-11 — 普通任务恢复收尾：三窗口强杀矩阵 + 核对后继续原执行

- **三窗口强杀矩阵**：新增 `src/lib/server/app/piRecovery.windows.test.ts` 与 `evals/fixtures/pi-tool-window-worker.ts`，用受控 barrier 触发真实 SIGKILL，覆盖规格要求的三个窗口——intent 前（tool `call` 阶段）、外部成功未提交（tool `execute` 阶段，不可重放→核对不重跑、可安全重放→重跑一次）、结果提交未投影（第一个工具已提交、第二个未开始）。独立 ledger 统计真实执行次数，验证已提交操作不重复、未开始操作只执行一次。
- **核对后继续原执行**：未知外部操作的 `review` 现在会经共享 Decision Request（`ApprovalBroker`，capability `recovery_review`）park 原执行；批准后把 run 置回 running 并原样续跑（人工确认过的未知工具按中断结算、绝不重跑），拒绝或过期则中止并清理记录。`recovery_review` 记录在启动扫描中保留，`inspectPiRecovery` 返回 `uncertainCallIds`，`approvedRecoveryCallIds` 经记录 context → `MomContext` → 原生 binding → Pi `assertRecovery` 透传。第三窗口与新增的“核对确认后继续”场景共同证明：确认只作用于原执行，且不重放未知操作。

验证：`piRecovery.windows.test.ts`（5 场景）、`piRecovery.test.ts`、`piRecovery.classification.test.ts`、`piRecovery.ordinary.test.ts`、`piRecovery.continuity.test.ts`、`recoveryReview.test.ts`、`replaySafety.test.ts`、`backgroundConversation.test.ts` 共 27 项通过；`piRunSession.test.ts`、`rooms/service.test.ts`、`approvalBroker.test.ts`、`resolutionEvents.test.ts`、`codemode.integration.test.ts` 80 项、service-bootstrap 21、desktop-chat 303 通过；`pnpm check` 与生产构建通过。

未验收：Room 执行的 review 仍为终态失败；Desktop/Web 用通用审批卡呈现，尚无专用“等待核对”卡片文案；`failPiRecoveryReview`/`onApprovalResolved` 运行时装线无端到端测试（由批准后续跑矩阵覆盖）。

## 2026-10-11 — 普通任务恢复补全：安全读取自动恢复、等待核对状态、专项验证

动机：首片恢复把不可安全重放的中断一律停在“明确失败+事件”，安全读取也会被拦；未知外部操作没有区别于失败的独立状态；父子任务/预算/租约等缺少专项验证。

改动：

- **安全读取自动恢复**：`agent/tools/sideEffectClassification.ts` 新增 `isReplaySafeTool(toolId, declared)`，以共享副作用分类判定中断是否可重放——声明的 `pure` 或已知纯读取为可重放；写入、命令、第三方工具、`codemode`/`subagent` 与未声明工具保持不可重放。`createMomTools` 的 `wrapWithToolRuntime` 与 `toAgentTool` 据此给 `read`/`docExtract`/`webSearch`/`webFetch`/`skillSearch`/`profileFiles`/`switchModel`/`grep`/`find`/`ls`/`conversation_search` 设置 Pi 的 `replay: "safe"`，使中断的安全读取在重启后从原生断点自动继续，而不是进入核对。
- **等待核对独立状态**：新增 `turnOrchestrator.markRunForRecoveryReview`，把未知外部操作的原执行置于非终态 `recovery_review`（此前是 `failed`），并在 `abortRunningTurnsForSession` 中包含该状态，使用户显式 Stop 能清除；`DesktopSessionRunStatus` 增加该状态，Desktop 状态映射将其呈现为“等待”。结构化运行事件 `PI_RECOVERY_REVIEW` 与人类可读通知保持不变。
- **专项验证**：新增 `replaySafety.test.ts`、`recoveryReview.test.ts`、`piRecovery.continuity.test.ts`，并在 `codemode.integration.test.ts` 增加“安全读取标记 replay-safe”断言；父子任务/子会话复用、Room 撤权、预算/期限存储保持沿用既有回归。

验证：`replaySafety.test.ts`、`recoveryReview.test.ts`、`piRecovery.continuity.test.ts`（服务租约在恢复起始丢失即阻止首个 Provider 请求；预算按 `[workspace, chatId, budgetId]` 跨重启保持且不同 run 隔离）、`codemode.integration.test.ts` 全通过；`piRecovery.test.ts`、`piRecovery.classification.test.ts`、`piRecovery.ordinary.test.ts`、`piRunSession.test.ts`、`runBudgetStore.test.ts` 等 63 项相关回归、service-bootstrap 21、desktop-chat 303、projects 86、decision 50 通过；`pnpm check`、`desktop:check`（0 error）与生产构建通过。

未验收：intent 前 / 外部成功未提交 / 结果提交未投影三窗口的受控 barrier 强杀矩阵；`recovery_review` 尚未接入审批/Decision Request 的“核对后继续原执行”。

## 2026-10-11 — Codemode 模型 API（部分交付）

动机：Codemode 脚本之前只能组合工具，不能在一次受控脚本里调用分类模型或生成图片。

改动：新增共享 `agent/models/modelOperations.ts`：按类型（classifier / image）返回模型目录与凭据可用状态，`classify` 承接 Pi `models.classify`，`generateImages` 承接 `models.generateImages` 并把图片落盘为工作区制品，返回可直接交给 `image()` 的图片对象（含 `type`/`ref`/`mimeType`/`data`）。每一步都经 `authorize`（共享副作用/权限闸门）、`beforeCall`（请求前预算保留）、`onUsage`（用量与费用收据）；未知模型键给出 `models.list()` 纠错指引；参考图仅接受 https URL 或 data URL，超出 10 MiB 拒绝。`codemode.ts` 与 `codemode-worker.mjs` 注册 `models.list` / `models.classify` / `models.generateImages` 脚本全局，走与工具相同的 IPC、取消和 deadline 通道；`image()` 产出已回传到工具结果（此前被丢弃）。`createMomTools` 暴露 `modelOperationDeps`，Runner 在非只读、非 Plan 模式接入（只读/Plan 下脚本看不到 `models`），模型调用计入父执行预算并记入用量。

验证：`modelOperations.test.ts`（目录可用性、授权/预算/收据顺序、拒绝即不请求、图片落盘、未知键纠错）与 `codemode.integration.test.ts` 新增两条（脚本发现/分类/生成/`image()` 展示、无授权时 `models` 不可用）通过；codemode 与 runner 既有回归、desktop-chat 303、projects 86、decision 50 通过；`pnpm check` 与生产构建通过。

未验收：真实 Runner 端到端（真实分类/图片 Provider、多图、参考图、伴随文本、并发归属、Deferred 轮询、重启复用已提交结果、取消传播）；大图制品引用；图片经现有媒体任务/制品服务的来源归属；模型调用接入现有审批卡（当前为 authority + budget + usage）。脚本取消会中止在途模型请求，但远端取消后的说明仍沿用 Pi Provider 行为。

## 2026-10-11 — MCP OAuth 授权（部分交付）

动机：HTTP MCP 之前只支持配置 headers，需要 OAuth 的服务器缺少登录、刷新、追加授权与退出入口，用户无法使用要求授权的远端工具。

改动：`McpServerConfig` 新增显式认证方式 `auth`（`headers` | `oauth`，含 `authServerMetadataUrl` / `clientName`），三个 sanitizer（`sanitize.ts` / `store.ts` / `defaults.ts`）统一复用 `settings/mcpAuth.ts` 的解析，选择 OAuth 时丢弃手工 `Authorization`，避免令牌来源不明确。`agent/mcp/oauthStore.ts` 把 Pi 的 `McpOAuthStateStore` 落到受保护文件（`<数据目录>/mcp-oauth.json`，0600），按 serverId + URL + 授权服务器隔离：同一 URL 的不同配置各自登录，URL/认证方式/授权服务器变化后不复用不匹配 token，删除服务器只清它自己的记录。`agent/mcp/oauth.ts` 用 Pi 公共 OAuth 客户端（discovery、PKCE、state、RFC 9207 issuer 校验、刷新、step-up scopes、动态客户端注册）提供状态、发起登录（loopback 回调）、取消、重新授权、退出；`McpToolRegistry` 用 `adaptOAuthProvider` 接入 HTTP 传输，授权失败给出可操作提示；状态接口只回传授权状态，不含 token、不进入设置响应/日志/prompt。settings 与 desktop 的 MCP API 增加 `oauth_login` / `oauth_reauthorize` / `oauth_cancel` / `oauth_logout`，Web MCP 设置页新增授权状态与登录/重新授权/退出按钮。

验证：`oauthStore.test.ts`（scope 隔离、同 URL 双配置、删除只清自身、reload 保留）、`oauth.test.ts`（状态/过期/退出/删除不影响同 URL 兄弟）、`mcpAuth.test.ts`（默认 headers、OAuth 丢弃 Authorization、stdio 保持 headers）、settings store 整对象 round-trip 含 oauth 服务器、mcp/desktopMcp 既有回归通过；`pnpm check` 与生产构建通过。

未验收：真实 OAuth 授权服务器端到端（discovery/PKCE/state/issuer/刷新/追加 scopes/过期/迟到回调）回归；Desktop 原生 MCP 设置页的 OAuth 控件与系统浏览器授权入口；远端 Web 公网回调（当前为 loopback，适用于浏览器在同机的 Desktop/本地 Web）。`mcp-ui.test.mjs` 中 desktop MCP 断言为既有失败（HEAD 组件已用 `removeMcpServer(id)`，测试仍期望 `removeMcpServer(server.id)`），与本次改动无关。

## 2026-10-11 — 普通任务启动恢复按原生断点分类（部分交付）

动机：服务启动只对带 Deferred handle（`poll` checkpoint）的运行自动续查，普通任务即使存在原生 checkpoint 也被当作“无 Deferred handle”直接失败，用户需重新发起工作。

改动：`piRecovery.ts` 新增 `inspectPiRecovery`，通过 Pi 正式 storage/task 记录（不读私有 JSON 布局）把每个 running owner 分类为 `resume` / `review` / `unavailable`。live 的模型请求（generation `request` 或 compaction `summarize`）与不可安全重放的工具 intent（tool `execute` 且 `replay !== "safe"`）→ `review`；缺失或损坏的执行记录 → `unavailable`；其余原生断点（`prepare` / `retry` / `poll` / `select` / `tools` / 未开始的工具调用 / 已提交仅待 reconcile）→ `resume`。删除“只有 Deferred 才允许启动恢复”的分类限制与误导性失败文案。

`runtime.ts` 启动协调器按分类处理：`resume` 走原 `resumePiOwner`（保留原 Session、Agent、Project、Bot、渠道发送目标、模型目录与原运行预算，复用原 Pi storage/requestId，不重发原用户输入）；`review` / `unavailable` 记录结构化运行事件 `PI_RECOVERY_REVIEW`、向原渠道发送人类可读说明并按终态失败，不自动重提。`backgroundConversation.ts` 按原生 `assistantSourceEntryId` 幂等记录答案：重启后重新投影已提交答案时不再向 Session 二次追加，也不重复通知。

验证：新增分类回归（真实 `PiRunSession` + 原生 SQLite：model request→review、unsafe tool→review、safe tool→resume、已提交→resume、缺失记录→unavailable）；新增真实 Runner 强杀回归（模型请求中断后重启不重发，provider ledger 仅 1 次 submit）；Deferred 强杀回归、`backgroundConversation` 幂等回归、service-bootstrap 21 项与 desktop-chat 303 项全部通过。

未验收：父子任务、预算/期限保持、Room 授权撤销、服务租约，以及 intent 前 / 外部成功未提交 / 结果提交未投影三个窗口的强杀矩阵；`review` 由现有审批或 Decision Request 入口承载（当前为明确失败 + 结构化运行事件，尚无独立“等待核对”运行状态）。read 类工具仍按 Pi 默认保守处理（未声明 `replay: "safe"`），安全读取的自动恢复与共享副作用分类打通留待后续 slice。

## 2026-10-11 — 全局 profile 层统一迁入 agents/default（已交付）

全局 profile 目录在代码中定义为 `~/.molibot/agents/default/`（`getGlobalProfileDir()`）：Momo 即全局默认身份，她的 Agent profile 就是所有 Agent/Bot 回退共享的全局基线，数据目录根下不再放置任何 profile 文件，也不留根目录回退。动机：此前全局层文件散落在数据根（`~/.molibot/AGENTS.md` 等），Agent 设置页只显示 agent 层（`agents/<id>/`），Momo 页面因此显示为空，用户无法统一在一个目录管理全部 Agent 定义。改动：`profiles.ts` 新增 `getGlobalProfileDir()` 并切换 `ensureGlobalProfileDefaults` 与 global scope 读写；`prompt.ts` 全局 sections、identity 与 source 列表改用该目录；`tools/profileFiles.ts` 的 globalFilePath 与 `tools/path.ts` 的路径守卫（禁止文件工具直连 profile 文件）同步指向新目录，并删除 `path.ts` 里重复的文件名列表改用共享常量。新增守卫测试断言 `getGlobalProfileDir() === getAgentDir("default")`。本机一次性迁移根目录 6 个 profile 文件及 1 个历史备份到 `agents/default/`，重启后端后验证：`/api/settings/profile-files?scope=global` 与 `/api/desktop/profile-files?scope=agent&agentId=default` 均返回迁移后内容，运行时 `buildSystemPrompt` 的全局 source 全部指向 `agents/default/`。对其他 Agent 行为不变（自身 agent 层优先、缺失回退该目录）。注意：旧安装若有根目录 profile 文件需手动移入 `agents/default/`，系统不做自动迁移。106 项相关测试（prompts/tools/runner）与生产构建通过。

## 2026-10-11 — Agent 首页快捷任务脱离输入卡阴影（已交付）

Agent 首页的快捷任务按钮原先作为普通文档流元素排在输入卡下方 14px 处，被输入卡（stacking context）的 float 层环境阴影整个罩住——按钮是字面上被渲染在半透明阴影下面，亮色下发灰、暗色下接近糊白，视觉上也显得拥挤。修复：`.agent-home-tasks` 提升为 `position: relative; z-index: 1`，按钮绘制在阴影之上恢复真实底色；与输入卡的间距 14px → 28px，与上方 identity 区块节奏一致。用真实 styles.css 的静态 harness + headless Chrome 截图并经视觉评审：亮暗两主题下改前均复现罩影（暗色按钮填充被冲到灰 114–149），改后按钮恢复真实 token 底色、对比度约 7.9:1（暗色）、间距增加且与下方"最近对话"标题无碰撞，输入卡边框/圆角/阴影不变。313 项 chat-ui 回归（含读取 styles.css 的结构守卫）与生产构建通过。Project Chat 与普通空对话的快捷入口走 transcript 内嵌路径，不经过此规则，无需改动。

## 2026-10-11 — 侧栏吸顶标题去底色（已交付）

Agent、Agent Team、项目一级标题吸顶后不再绘制 `--sidebar-bg` 纯色底，仅用 backdrop blur（14px）熔掉从下方滚过的行，与侧边栏材质在任意主题下保持同一表面；修复半透明 tint 主题（壁纸透过侧边栏材质着色）中纯色底显示为突兀白卡片的问题，同时不产生透底文字碰撞。分组头上不加 `isolation`（会把 blur 的 backdrop 根截断在自己身上导致遮罩失效）。减低透明度 / 提高对比度 / 低性能模式回退为不透明 `--sidebar-bg` 底色。结构守卫升级：吸顶规则必须含 backdrop-filter、不含 background 与 isolation，降级规则必须回退不透明底色；另修正一条因 AgentNavigation 移至 ChatView 而过期的挂载点断言。313 项 UI/侧栏回归、Svelte 检查与生产构建通过；浏览器实测 google（半透明 tint）与 cartoon（不透明）两族主题及降级模式：静止时分组头与侧边栏浑然一体，滚动行在吸顶头下熔为磨砂。

## 2026-10-11 — Agent 侧栏稳定排序与默认置顶（已交付）

Agent 侧栏排序：默认 Agent（Momo）固定置顶；其余按全部渠道最新对话更新时间倒序，同一时间按名称首字母（中文按拼音）排序，无对话的按名称放在默认与有对话 Agent 之后。编辑配置不再改变顺序——排序键只取会话时间与名称，设置数组顺序（`upsertAgent` 会把被编辑项移到末尾）不再影响列表。时间在服务端分页前汇总，不受最近 100 条分页截断影响。列表行「待命中」占位状态移除（`agentActivityLabel` 空闲/未就绪返回空串，行内不渲染），仅保留工作中/已完成/失败/已停用；Agent Home 的状态 tooltip 同步过滤空段。排序函数新增 `defaultAgentId` 参数并有回归测试（置顶、数组重排不变、无时间兜底）；同批修正 `desktopConversations.test.ts` 中 `latestConversationAtByAgent` 键集合断言漏计 writer 的问题。24 项共享/会话查询测试、313 项 chat-ui 回归、svelte-check、桌面与生产构建通过。真实服务冷启动走查：重启后端后接口返回各 Agent 最新时间，真实数据下顺序为 Momo 置顶 + 按时间 + 无对话按拼音，模拟编辑任意 Agent（数组重排）顺序逐字节一致。注意：后端为构建产物（`scripts/start-server.mjs`），改服务端代码后需重新 `pnpm build` 并重启服务，否则接口缺 `latestConversationAtByAgent` 导致列表退化为纯名称序。

## 2026-10-11 — 侧栏二级层级缩进

Agent（含总览）、Agent Team 与项目二级内容统一缩进 12px，一级标题保持原字号与位置，沿用统一滚动和吸顶行为。

## 2026-10-11 — 侧栏一级菜单与统一滚动（部分交付）

Agent、Agent Team、项目共用一个滚动容器，上方快捷入口固定。一级标题点击展开/折叠，悬停或聚焦显示箭头与新增操作，仅一级标题吸顶。真实服务预览确认只有一个目录滚动容器、一级标题吸顶且上方快捷入口固定；三组标题点击展开/折叠，Team/项目新增按钮默认隐藏。314 项 UI/侧栏回归、Svelte 检查与生产构建通过；原生冷启动及断连恢复待验证。

## 2026-10-11 — Agent 文件与附件页及快捷菜单（部分交付）

Agent 首页 header 增加文件入口；左侧有效 Agent 右键菜单依次为全部对话、文件与附件、设置，均打开当前 Agent 的对应页面。文件页按对话分页展示生成文件与上传附件，复用 ArtifactPanel 预览并可返回来源对话；每批最多四个并发读取，失败项可重试，切换 Agent 丢弃旧响应。已删除及未归属历史仅提供全部对话。

312 项界面检查、3 项分页/重试/切换/并发回归、Svelte 检查及生产构建通过；真实服务预览确认三个菜单跳转、header 文件入口、生成图片预览及返回飞书来源对话。原生冷启动、隔离服务断连恢复与完整中英/明暗视觉走查未完成。当前不统计产出总数，不定位到具体消息；范围为现有 Session 文件接口可列出的可用文件，不包含 Agent 工作区全部文件或 Project 文件。外部渠道的文件时间沿用现有接口的磁盘修改时间。

## 2026-10-11 — Agent 对话列表简化（部分交付）

最近与全部对话共用两列布局：渠道图标位于标题左侧，更新时间右对齐；移除独立来源列与重复对话图标。来源与只读状态保留悬停提示和无障碍名称，窄窗口保持两列、长标题截断。311 项界面检查、Svelte 检查与生产构建通过；真实页面的中英、明暗、窄屏及隔离冷启动、切换、断连恢复尚未验证。产出统计与 Agent 产出列表未实施。

## 2026-10-11 — MCP 底层接入替换为 Pi（已交付）

生产 MCP 客户端改用 Pi 的独立实现（`@earendil-works/pi-mcp`）：`McpClient` 负责连接与协议，`StdioTransport`/`StreamableHttpTransport` 负责传输，`toLlmContent` 负责结果转换；删除 Molibot 自维护的官方 SDK 接入、transport 事件接线和逐类型内容解析。官方 `@modelcontextprotocol/sdk` 从生产依赖降为测试依赖，仅用于隔离 stdio/HTTP 测试服务器。保留设置契约、`loadMcp`/`mcpInvoke` 会话工具入口、连接注册表与状态投影（disabled/connecting/connected/disconnected/error）、8 秒连接上限与 120 秒绝对执行期限（progress 不能续期突破）、结果限额与完整输出落盘、凭据脱敏、`isError` 与 server/tool 运行身份；MCP annotations 通过工具 classification 进入现有 `third_party` 权限分类，未声明注解仍为 `undeclared`，各权限模式的既定规则不变。stdio 子进程由 Pi 按进程组托管，服务退出时统一释放。

验证：`mcp.test.ts` 20 项通过（真实隔离 stdio 生命周期/重连/禁用启用/错误/显式 reconnect、忽略取消下的绝对期限、环境与工具参数映射、HTTP 头部映射、文本/图片/内嵌资源/资源链接/音频/仅 structuredContent 转换、`isError` 抛出、大输出截断与完整落盘、注解→分类）；`mcpInvoke`、`loadMcp`、`toolClassification`、`decidePermission`、`toolPermissionGate`、`codemode.integration`、`approvalBroker`、`desktopMcp`、`prompt`、`index`、`toolRuntime`、`approvalSuspension`、`runner` 相关回归共 243 项通过；`pnpm check` 与 `pnpm build` 通过。限制：未对真实用户 MCP 服务器或返回多页工具列表的服务器单独走查（分页由 Pi `listTools` 内部完成）；未在原生 Desktop 冷路径与真实服务重启下验证。

## 2026-10-11 — 侧栏导航顺序统一

展开与折叠均按新对话、自动任务、技能、计划、小程序、Agent、Agent Team、项目 排列；折叠侧栏新增第一项新对话入口。Agent、Agent Team 与项目集中置于其他入口下方。312 项回归通过；最终顺序的真实页面、原生冷启动及断连恢复仍待验证。

## 2026-10-11 — Agent 角色文件与本地头像（已交付）

Agent 设置集中编辑 AGENTS/IDENTITY/SOUL/SONG，显示各文件用途；基础信息提供 12 个内置图案、本地头像上传与恢复默认。图片保存到 Agent workspace，内置资源随包构建。配置作用域见 [Agent 设置规格](docs/requirements/agent-settings-page.md)。

## 2026-10-11 — Agent 空闲与忙碌图标

首页空闲状态使用睡眠图标，忙碌使用奔跑图标，移除暂停与时钟表达；保持原有状态数据、主题颜色和总览入口。

## 2026-10-11 — Agent 首页头像与运行入口（部分交付）

圆形头像放大裁切方图。运行入口合并至可点击头像，右下角显示基于真实数据的待命、执行、完成、失败、未知或停用图标；悬停显示状态与任务，点击打开当前 Agent 总览。移除独立状态文字和运行情况按钮。真实服务预览已确认裁切、状态提示及点击进入当前 Agent 总览；310 项 UI/侧栏回归、Svelte 检查和生产构建通过。原生冷启动与断连恢复仍待验证。

## 2026-10-11 — 空未归属历史入口隐藏（部分交付）

Agent 侧栏仅在存在未归属对话时展示“未归属历史”。独立查询包含归档、排除回收站，不受最近 100 条列表限制；认领或删除后刷新。311 项界面检查、3 项状态与历史刷新回归、Svelte 检查和构建通过；隔离页面确认空入口隐藏。原生安装包冷启动尚未验证。

## 2026-10-11 — Agent 统一入口（部分交付）

侧栏 Agent 分组包含动画总览、各 Agent 首页入口和状态文字，移除独立“对话”分组与重复 Agent 工作区按钮。点击动画 Agent 或侧栏名称进入同一首页，首页显示运行状态和当前任务摘要，可返回总览定位该 Agent。三处共享状态轮询，断连清除过期状态，旧连接响应不能覆盖新连接。界面与响应式检查 310 项、状态轮询和城市投影回归 15 项、Svelte 检查及构建通过；隔离服务验证首页/总览首次进入、Agent 切换、动画点击、中英、明暗、560px 列表浮层和服务中断后恢复。完整原生安装包冷启动尚未验证，未替换安装包。

## 2026-10-11 — 房间设置入口与成员编辑（部分交付）

房间首页与会话顶栏新增设置图标，进入与 Agent 设置共用布局的主内容区设置页，包含房间信息、成员、协作方式和固定保存栏。侧栏编辑成员直接打开成员分类。修复导航与编辑请求同时更新时，导航清空编辑状态的问题：编辑意图随房间加载完成后应用。新增真实组件脚本回归，修复前失败、修复后通过；此前预览只改变编辑请求，未覆盖父组件同时更新导航版本的路径。308 项界面检查、导航回归、Svelte 检查和构建通过；隔离预览验证名称与成员保存、重新加载、中英、明暗及 560px 窄屏。完整原生冷启动和真实服务中断恢复尚未验证，未替换安装包。

## 2026-10-11 — Agent 列表管理与房间操作层级（部分交付）

左侧 Agent 只保留首页入口。Agent 最近与全部列表复用右键删除菜单，全部列表支持多选、选择已加载条目和批量删除。删除走共享回收站服务，成功条目移除，失败条目保留。房间首页移除重复新对话按钮；会话顶栏只提供首页和新对话图标，编辑成员与删除房间移到侧栏右键菜单。隔离组件预览已验证中英切换、暗色、560px 宽度、右键单删和批量部分失败。房间组件首次打开、会话切换和侧栏右键编辑入口已验证；初始化只在成员与项目加载完成后打开一次，避免覆盖编辑状态。308 项界面与响应式检查、2 项删除回归、Desktop 类型检查和构建通过。隔离预览服务重启后首次进入通过；完整原生冷启动、真实运行时断连恢复及房间设置保存走查尚未完成。

## 2026-10-11 — Agent 房间首页（部分交付）

房间入口展示与 Agent 共用的首页、输入区和最近三条会话行，可展开全部历史并打开会话；会话页提供返回首页，移除顶部会话下拉。新对话首次发送时创建，创建失败保留草稿，切换房间时忽略过期创建结果。真实页面中英、主题、窄窗口及冷启动和断连恢复走查未完成；当前未替换原生安装包。

## 2026-10-11 — Agent 图标操作主题适配（部分交付）

Agent 设置复用共享图标按钮主题；首页历史操作保留共享 secondary 按钮的主题外观，局部类只设置尺寸。移除覆盖背景、边框、阴影与 hover 的固定样式。Brutalism 明暗与 Minimal 即时切换已在真实服务预览验证，Agent 设置与相邻 Header 按钮的计算样式一致，历史按钮恢复主题边框与表面。304 项 UI/侧栏回归、Svelte 检查和生产构建通过；原生冷启动、断连恢复仍待验证。

## 2026-10-11 — Agent 导航与图标操作（部分交付）

- 2026-10-11：Agent 设置改为主页主内容区内的二级页面，保留应用主侧栏；通用 Settings 入口保留通用导航。两个入口复用表单，窄容器分类横向排列，返回/保存回到入口。

Agent 导航复用项目分组头与会话行，仅显示名称和小头像；新对话操作按项目规则在悬停或聚焦时出现，省略号在列表内加载下一页。移除重复搜索、管理与全部历史按钮。首页查看全部和 Header 设置采用图标按钮，会话来源使用次级单色标记与渠道名称提示。UI/侧栏回归首次 302/302 通过；并行接入 Agent 设置主区域后最终为 300/302，两项旧结构断言失败，本次新增导航检查通过。Svelte 检查零错误，生产构建通过；连接真实服务的独立前端预览验证展开、原位追加、来源提示与键盘进入首页。完整中英、主题、窄窗及服务冷启动、断连恢复仍待验证。

## 2026-10-11 — Agent 身份区与默认头像（部分交付）

新对话页采用上移的 96px 圆形头像，下方依次显示名称和简介，无简介时保留简短提示。共享 AgentAvatar 在头像缺失、空白或加载失败时使用侧栏与设置页相同的 Molibot logo，覆盖首页、导航及 Agent 设置。真实页面视觉与冷启动走查尚未完成。

## 2026-10-11 — 新对话页居中与 Header 设置（部分交付）

头像、Agent 名称与简短提示居中置于输入框上方，输入区随内容视口高度调整位置，三个推荐按钮居中紧接其下。Agent 设置移至窗口 Header，最近对话保持三条共享列表行。真实页面视觉、冷启动与断连恢复走查尚未完成。

## 2026-10-11 — 新对话页以输入为主（部分交付）

新对话页将真实输入区置于主内容列，标题与 Agent 身份缩小，推荐任务改为紧凑按钮，最近对话限定三条并复用历史行组件。简介和推荐说明不占首屏。发送后沿用正常聊天布局；新对话页不启用聊天记录自动滚底及回到最新按钮。原生冷启动、发送、Session 切换及断连恢复走查尚未完成。

## 2026-10-11 — Agent 独立设置页面（已交付）

- 2026-10-11：Agent“记忆与知识”接入现有记忆记录与独立归属检索，保留共享授权；移除 KNOWLEDGE.md 编辑与提示词注入。全局记忆后端、候选审核及维护保留在通用记忆中心。

Agent 首页提供设置入口，创建与编辑使用基础信息、模型与能力、技能与工具、记忆与知识、消息渠道、高级设置六类导航，保留原有字段、分类间草稿与固定保存栏。Agent 技能停用与全局停用共同生效，工具开关由共享执行层限制直接、延迟和 Codemode 调用；记忆记录按 Agent 归属检索，共享个人记忆可独立授权。Bot/Web Profile 绑定通过专用 API 只修改 Agent 身份，保留凭证、权限和其它配置。共享 Provider、资源安装、MCP 连接、记忆服务和渠道账号继续在通用设置管理。

临时数据库整对象回读、提示词、工具调用和绑定保留回归通过；隔离服务真实页面创建、分类切换、保存、服务中断与冷启动恢复，中英、明暗和 390px 宽度走查通过。实现边界见 [规格](docs/requirements/agent-settings-page.md)。

## 2026-10-11 — Agent 对话列表统一（部分交付）

首页最近对话与完整历史复用 AgentConversationRow，统一标题与预览、来源与只读状态、更新时间三列、细分隔线及窄窗口布局。移除首页专用圆角行样式。真实页面视觉与冷启动走查尚未完成。

## 2026-10-11 — Desktop 启动标题与会话恢复（部分交付）

启动顶栏显示服务状态，初始导航加载期间保留加载画面；恢复查询覆盖外部渠道 Session，无有效目标时进入默认 Momo 首页。界面回归覆盖状态衔接、失效 Session 和外部渠道恢复。原生冷启动、切换及断连恢复走查尚未完成。

## 2026-10-11 — Agent 历史查询性能与工具栏高度（部分交付）

搜索框、来源选择器和返回按钮统一为 40px。共享搜索先枚举元数据、筛选 Agent/来源并分页，再投影当前页预览；外部渠道元数据一次枚举，正文按候选 ID 读取，不再为每个渠道重复解析全部日志。有搜索词时只投影归属筛选后的候选，保留预览搜索及不可搜索正文排除。

真实旧接口第一页约 4.94 秒，元数据接口约 108 毫秒；隔离的 60 个 Web 与 40 个外部会话基准中，旧扫描流程中位约 109 毫秒，当前页预览流程约 21 毫秒。22 项会话查询、12 项外部会话、296 项界面回归、前后端类型检查及构建通过。回归限定首/次页投影条数及其他 Agent 不被读取。真实服务仍加载旧构建，未重启或中断用户服务；更新后的真实 HTTP、工具栏视觉及冷启动走查未完成，隔离基准不代表真实数据的最终时延。

## 2026-10-11 — Agent 首页最近对话 Logo（已交付）

最近对话每行左侧显示对应渠道的本地 Logo，与完整历史来源列共享 `CHANNEL_LOGOS` 映射；标题保持截断，时间保持右对齐。

## 2026-10-11 — Agent 历史来源 Logo（已交付）

Agent 历史来源列复用 Session 侧栏的本地渠道 Logo，Telegram 不再显示通用飞机图标。沿用共享 `CHANNEL_LOGOS` 映射，不新增资源。

## 2026-10-11 — Agent 历史三列布局（部分交付）

完整历史页采用标题与预览、来源与只读状态、最后更新时间三列，使用细分隔线与整行点击。搜索框和共享来源下拉筛选位于顶部；窄窗口每条记录改为两行。Agent 范围与最近更新时间排序保持生效。项目筛选和独立归档入口尚未提供，页面不显示无效操作。Svelte 检查与生产构建通过，真实页面的主题、语言及窄宽度走查仍受原生服务发现阻塞。

## 2026-10-11 — Agent 完整历史页面（部分交付）

Agent 首页“查看全部”在主内容区展示该 Agent 的完整 Session 列表，窗口标题显示 Agent 名称与“全部对话”。搜索、来源筛选与分页携带固定 Agent ID；来源不提供无效的项目选项。返回按钮进入该 Agent 首页，选择记录打开真实会话；全局搜索保留独立弹窗。293 项界面与响应性回归、20 项服务端会话测试和生产构建通过。真实页面及冷启动走查仍未完成：浏览器预览无法完成原生服务发现。

## 2026-10-11 — Agent 首页布局（部分交付）

Agent 草稿首页以并排头像与名称、简介、快捷任务卡片和最近对话列表展示；窗口标题使用 Agent 名称，输入区保持在底部。任务卡片只填入草稿；最近对话显示真实标题、内容预览与时间，并提供当前 Agent 历史入口。无历史显示开始提示，窄窗口卡片纵向排列，文案支持中英并沿用主题 token。292 项界面与响应性检查、Svelte 检查和生产构建通过；既有 AgentCityInspector 警告仍存在。真实主题、语言、窄窗口及冷启动走查未完成：浏览器预览停在原生服务发现阶段，无法进入首页。

## 2026-10-11 — 渠道会话切换缓存与侧栏选中（修复）

Agent 侧栏使用当前可见会话 ID，飞书、微信等只读会话点击后立即高亮对应行，滚动定位也跟随渠道会话。渠道历史按服务地址与会话 ID 缓存，重访立即展示并后台刷新；切换、关闭与断连取消旧请求，晚返回的成功或错误不会覆盖新选择，同一会话失败后可重试。新增异步回归覆盖乱序响应、缓存刷新、跨服务隔离、关闭与重试；3 项加载器回归及 292 项界面/响应性守卫通过，桌面类型检查与构建通过（既有 AgentCityInspector 警告）。原生冷启动、首次点击与断连恢复走查未完成：自动化无法绑定开发版窗口，浏览器预览缺少原生服务发现能力，停在服务检查状态。当前真实渠道历史 HTTP 请求已验证为几十毫秒返回，缓存不保证未打开过的会话无网络等待。

## 2026-10-11 — 渠道会话文件列表阻塞服务（修复）

Agent 共享工作区的外部会话文件列表在一次请求内构建路径引用匹配器，复用迁移映射与会话引用集合，不再对每个候选文件读取完整清单并重建映射。保留历史路径解析与会话文件可见性。临时目录回归覆盖迁移后 80 个文件只读清单一次、只展示被该会话引用的文件；真实服务重启加载修复后，截图对应飞书和微信历史接口分别约 42 ms、14 ms、文件列表约 139 ms、84 ms 返回 200；并发健康检查 runtimeReady=true，服务恢复响应。

## 2026-10-11 — 迁移进度重连与批量检查点（修复）

弹窗发现后台迁移运行中时自动接续进度查询；查询串行发送，服务代次变化后丢弃旧响应，完成后关闭弹窗并启用工作区。后台运行时禁用重复确认与归属调整。复制和发布每 32 个文件保存一次清单，阶段结束时保存完整进度；重试逐文件验证未记录检查点的已复制或已发布文件，不猜测归属，不覆盖不同内容。临时目录回归覆盖检查点中断后的完整续跑及清单写入次数；迁移相关 54 项、桌面界面 289 项测试通过。原生弹窗首次打开、切换页面和断连恢复的完整走查未完成：自动化工具无法绑定开发版窗口。

## 2026-10-11 — 迁移中进度查询不再重复扫描来源（修复）

迁移执行期间，进度接口读取已验证的迁移清单，不重复扫描和哈希全部来源文件。确认前、复制时和切换后的校验保留；非执行状态仍完整检测源文件变化。临时目录回归验证进度查询独立于源扫描且正常状态仍拒绝源变化，迁移相关 53 项回归、类型检查与构建通过。真实桌面服务已加载进度查询修复；6,145 项全部发布、确认接口返回 needed=false，深度健康检查 runtimeReady=true。

## 2026-10-11 — processing 媒体记录不再误拦 Session 迁移（修复）

媒体任务按 task ID 查询，Session ID 不参与恢复执行；缺少唯一来源时保留原 ID，不修改 processing 状态、远程任务信息或产物。运行与审批的非终态歧义仍阻塞，未知表保持严格检查。阻塞诊断包含数据库、表名、主键与状态。回归覆盖 processing 图片和视频记录；真实来源映射及旧 Bot 排除选择的只读持久引用校验通过，未提交真实迁移。

## 2026-10-10 — 历史 Session 引用歧义不再误拦迁移（修复）

旧数据库中缺少唯一来源的终态运行、媒体任务、已结束审批、trace 和记忆记录保留原 Session ID；来源明确的记录按迁移映射更新。可恢复任务及未知表的歧义仍阻塞，避免猜测执行归属。临时数据库覆盖同名 default、历史保留、准确改写与运行中任务阻塞；迁移、Runtime 门控及生命周期 52 项回归通过。

## 2026-10-10 — 迁移弹窗操作组对齐（修复）

目标 Agent 选择器与“不迁移”按钮放入同一个左对齐操作组，控制高度一致；窄窗口改为纵向排列并保持共同左边线。详情与资源忽略操作使用相同起点，固定底栏保留右对齐。复用 SelectControl、Button 与主题 token，不改变迁移判断或保存行为。

## 2026-10-10 — 缺失 Bot 排除资格误判（修复）

迁移引用检查先识别 SQLite 文件头，跳过其他格式的 `.db` 和空的非应用数据库占位文件；损坏或截断的应用 SQLite 仍明确阻塞。仅实际执行表与 deferred Pi 恢复记录参与可恢复任务判断，历史 trace 的成功或运行状态不再阻止排除旧 Bot。补充临时数据库回归，旧数据保留；隔离界面验证无需选择 Agent 即可排除两个旧 Bot，确认后正常进入对话页。

## 2026-10-10 — Agent City 启动画面（已实现）

Desktop 服务启动等待区域展示本地等距微缩城市，包含五栋建筑、协作站与十二个移动机器人。中英状态与恢复操作沿用启动协调器；支持主题、窄窗口及减少动态效果，错误状态暂停动画。插画为装饰场景，不表示真实 Agent 运行状态。 验证：289 项界面测试与 4 项启动协调器测试通过，Desktop build 通过，svelte-check 为 0 errors / 1 条已有 AgentCityInspector 警告；隔离浏览器检查首次加载、动态场景、延迟恢复入口及窄窗口。原生 App 冷启动、真实服务中断恢复与明暗/中英实际切换尚未验证。

## 2026-10-10 — 迁移阻塞与启动顺序明确显示（修复）

移除仅关闭弹窗的“稍后”按钮。关闭弹窗后，主会话区域显示“会话数据尚未处理”与可见的处理入口，不再误显示服务启动中。忽略选择明确说明需确认才保存并启用服务；被可恢复任务引用的资源与旧 Bot 不显示忽略按钮，详情说明原因。服务 ready 后才检查迁移，短暂请求失败留在启动恢复界面并自动重试，不弹空错误窗口；服务中断时关闭弹窗，恢复后重新检查。所有预览、确认与轮询响应都校验服务地址和请求代次，避免过期结果覆盖新服务状态。

## 2026-10-10 — 缺失 Bot 的旧数据可选择不迁移（已实现）

迁移弹窗为缺失 Bot 提供“不迁移此 Bot 的旧数据”，无需选择 Agent 或编辑文件。排除该 Bot 的全部会话（含已有归属）、资源、事件、当前路由与普通 Web 展示副本；其他 Bot 的数据继续迁移，原文件保留。选择可在确认前撤销，确认时保存，重启不重复要求处理；全部排除时可确认进入空工作区。可恢复队列、Durable 任务、事件租约与 Bash 审批仍引用该 Bot 时明确阻塞，终态历史保持原样。验证使用临时数据。

## 2026-10-10 — 迁移弹窗认领缺失 Bot 的历史归属（已实现）

旧 Bot 不在当前配置且历史数据未记录 Agent 时，可在迁移弹窗直接选择目标 Agent，无需编辑文件。选择后重新计算会话、资源、当前路由和 Web 展示；预览不保存或启动 Runtime，确认时才保存迁移归属。支持改选和撤销，已有效固定的会话归属保留；迁移开始后选项锁定，失败按原选择重试。缺失 Bot 不会重新创建，旧文件与现有 Bot 配置不变。有冲突显示“需要处理”，冲突解决后显示“等待确认”并启用迁移。

## 2026-10-10 — 迁移弹窗布局与固定操作栏（修复）

迁移弹窗采用固定标题摘要、中间正文滚动和固定底部操作栏，长冲突列表与展开诊断不会遮挡按钮。摘要数字、冲突标题、会话数量和路径按桌面主题区分层级，诊断折叠显示，资源冲突支持原有忽略/恢复操作。中英、明暗主题及窄窗口验证使用隔离实例，不操作真实数据。

## 2026-10-10 — 迁移归属提示说明缺失 Bot（修复）

历史 Bot 不在当前配置中且会话未记录 Agent 归属时，迁移弹窗明确显示渠道、Bot ID、受影响会话及无法确定目标 Agent 的原因。同一 Bot 的会话、资源、路由与 Web 展示连带报错合并，原始诊断可展开查看；已指定但不存在的 Agent 单独说明。迁移阻塞和原文件保护规则保持有效。

## 2026-10-10 — 迁移资源冲突可忽略（已实现）

scratch 中的依赖环境与缓存自动跳过，包括 `node_modules` 下的可执行符号链接。迁移弹窗提供单项“忽略此资源”、恢复选择及“迁移其余数据”，预览重新计算数量；只有确认时保存忽略策略，重启后保留。Context、身份与持久运行引用冲突仍需解决，被可恢复事件租约引用的资源不能跳过。原文件保持不变。临时数据回归覆盖损坏 Event、链接、Skill 冲突、API 预览与确认、租约约束及冷启动。

## 2026-10-10 — 迁移跳过 scratch 虚拟环境（修复）

Agent 存储迁移忽略 scratch 内的 `.venv` 临时目录，包括其中的 Python 符号链接和链接形式的 `.venv`。原目录保留，正常产物继续迁移；其他位置的符号链接仍阻止迁移。回归使用临时数据，覆盖旧源树整体扫描、Bot/Chat scratch、正常产物和原文件保留。

## 2026-10-10 — Agent 共享存储与确认迁移（已实现）

普通 Session、技能、事件、附件、scratch 和运行记录统一存入 `sessions/<agentId>`；Context 文件及元数据保存固定 Agent 和完整渠道来源。Bot 改绑定不改变历史执行身份，新对话只创建 Context 与元数据，共享资源不随单个 Session 删除。渠道配置、规则、认证和连接数据整理到 `channels/<channel>/bots/<botId>`；Project 与 Room 保持独立域。

Desktop 启动发现旧数据后阻止 Runtime、队列与事件推进，提供中英确认、稍后、重开、进度、冲突及重试入口。确认后经过稳定映射、校验复制、逐文件发布和分域持久引用切换再启动 Runtime。源文件字节、修改时间和权限保留；同名 Session、Skill 冲突、历史附件和产物引用、当前路由及事件回复目标均有回归覆盖。已完成的映射不会覆盖目标后续修改，新增源项在下一次冷启动重新请求确认。

隔离生命周期、跨渠道资源、历史正文及 Room 运行已验证；类型检查、两端构建、Desktop 测试通过。完整后端测试仍有既有基线失败，原生 Tauri 完整人工走查未执行，详见 [实施记录](docs/work/progress/agent-session-storage/progress.md)。没有迁移真实用户数据；本轮改动按用户要求保持未提交。

## 2026-10-10 — Momo 与 global 身份归一（已交付）

Momo 的稳定 Agent ID 为 `default`；global 表示共享配置与规则，不再代表空身份。已配置 Bot 的空 Agent 绑定在共享设置读写和初始化时规范化并持久化为 Momo。新对话默认 Agent 是独立偏好，不改变这些 Bot 或已固定 Session 的归属。Desktop 和独立 Web 设置页取消“无 Agent／全局兜底”选项，新建 Bot、Web Profile 默认选择 Momo；保留已有明确绑定、删除记录和全局人设文件。

实际数据中 15 个空绑定 Bot 与 161 条 Context 元数据已补齐，示例历史归属为 `default`，重复执行无修改或冲突；剩余 1 条来自配置中已不存在的 Web Bot。细粒度渠道保存只更新 channels，临时数据库回归覆盖完整对象重载和其他设置保留。46 项设置/历史回归及 52 项提示词/执行相关回归通过；完整后端 2527 通过、5 个既有基线失败、1 跳过。Desktop 9 项预检查、334 项行为测试、300 项源码守卫和 70 项 Rust 测试、两端类型检查与构建通过，保留既有 Agent City 可访问性警告。实际提示词全局人设单次渲染；隔离页面核对中英、明暗、窄窗口、默认 Momo 选择及保存/重启。详见 [验证记录](docs/work/progress/personal-agent-desktop-v1/progress.md)。

## 2026-10-10 — 恢复 Agent 侧栏 Session 右键菜单（已交付）

Agent 侧栏重新接通共享会话行的完整操作：重命名、复制 Session 路径、从 Finder 打开和删除确认。外部只读会话仍可复制路径和打开目录；重命名和删除遵守原有权限。菜单文字沿用中英文翻译和既有主题样式。

根因是新导航遗漏路径操作回调及菜单标签；原守卫只检查菜单组件，没有覆盖新调用方。新增接线守卫，Desktop 334 项行为测试、299 项源码守卫、70 项 Rust 测试及 9 项预检查通过。Desktop 类型检查 0 错误、1 项既有 Agent City 可访问性警告；构建通过。隔离预览验证首次右键展开、复制成功提示、删除确认/取消、Session 切换及服务中断后恢复；未启动原生 Finder 验证窗口。

## 2026-10-10 — 历史 Session 自动关联（已交付）

共享启动与 Bot/Agent 配置更新按 Bot 目录和有效 Agent 绑定补齐普通 Session 归属。Web 会话与 Context 固定身份优先，Bot 改绑不改写历史；Project、自动任务和缺失有效绑定的数据不参与。身份冲突保留两侧并明确报告，不移动或重写聊天正文。

17 项针对性回归、类型检查、构建及隔离进程首次列表/重启列表通过。完整后端回归 2524 通过、5 项此前已复现的基线失败、1 跳过。实际历史补齐 69 条 Web 会话与 94 条 Context 元数据，冲突为零，重复执行无修改；仍有 121 条可见历史缺失有效 Bot/Agent 绑定。见 [验证记录](docs/work/progress/personal-agent-desktop-v1/progress.md)。

## 2026-10-10 — Personal Agent Desktop V1（已交付）

Desktop 以 Agent 为普通对话入口，默认 Agent 始终置顶并标记，启用的 Agent 提供“＋”新对话按钮，全局新对话进入默认 Agent。支持头像、名称、简介、多个历史组展开、按 Agent 的完整历史与跨 Agent 搜索、独立草稿和上次页面恢复。Agent 管理支持可见性、启用状态、共享 owner 记忆和默认选择；编辑使用固定保存栏，中英文、明暗主题及窄窗口均检查。

普通 Session 固定执行 Agent，模型按 Session 覆盖 → 当前 Agent 默认 → 全局默认解析。跨渠道改绑不会改写旧 Session，旧历史按 Bot 目录及有效 Agent 绑定自动关联，缺失绑定的历史可显式认领，外部镜像仍只读。共享层约束禁用、定时跳过、删除引用与运行检查、幂等归档和删除 ID；私有记忆按稳定 Agent ID 授权，关闭 owner 共享后仍保留本 Agent 的私有知识。

后端完整回归 2519 通过、5 个已复现的基线失败、1 跳过；本次后续私有 profile 与授权改动由 29 项相关回归覆盖。Desktop 334 项行为测试、298 项源码守卫和 70 项 Rust 测试通过；类型检查、两端构建及隔离 Desktop 预览的服务重启/历史续聊通过。详见 [实施记录](docs/work/progress/personal-agent-desktop-v1/progress.md)。独立 Web 页面不新增认领入口；缺失有效 Bot 绑定的未归属会话需在 Desktop 认领后续聊。原生窗口完整人工走查未执行。

## 2026-10-09 — Personal Agent V1 会话存储基础（部分实施）

共享 Session 存储支持普通会话持久化稳定的 `agentId`。显式提供 Agent 的创建和复用按归属隔离；指定已存在会话且归属不一致时拒绝。未分配的本地 Web 历史可由所属 owner 显式认领，重复认领幂等且不改变活跃时间，不能改绑已有归属。Project 会话不保存该字段，也不参与校验和认领。

当前仅完成存储契约，生产发送入口尚未接入，不能据此认定真实执行身份、外部渠道改绑或 Desktop 导航已完成。后续范围见 [需求文档](docs/requirements/personal-agent-experience-v1.md)。临时目录的相关 Session 回归 35 项通过，类型检查和服务端构建通过；标准与规格审查发现的 Project 查询边界已修正。后端完整测试 2508 通过、5 失败、1 跳过，失败均在独立 HEAD 基线复现，完整测试并非全绿。

## 2026-10-08 — 构建与类型检查分离

已交付：`build` 执行插件构建、SvelteKit 同步与 Vite 打包，不再执行全项目 `tsc --noEmit`。桌面 runtime 准备复用同一构建命令；类型检查保留为独立的 `check` 命令。

## 2026-10-08 — 只读缓存有效性与单任务交接修复

已交付：文件读取缓存使用设备、inode、大小及纳秒级修改/状态变化时间，读取前后版本不一致的结果不进入缓存。外部写入保留大小和修改时间、替换文件时重新读取；`read` 支持 `refresh: true` 显式刷新。缓存与实际读取保留相同的文件名空白，offset / limit 不合并语义不同的请求。单任务 `{agent, task}` 与并行、链式任务使用相同的结构化交接字段。

根因：缓存身份与实际操作身份不一致、文件版本信息不足、单任务接口字段遗漏。回归守卫覆盖保留 mtime 的外部写入/替换、空白文件名、显式刷新、小数 offset、读取期间版本变化及单任务 schema/子任务请求。

验证：独立临时 DATA_DIR 中的 read / resultReuse / ToolRuntime / subagent / index / edit / write 测试 123 项通过，最终 offset 改动后的 read 测试 13 项通过；`corepack pnpm run check` 与生产构建通过。subagent 原生委派测试新增 `testDataDir` 前置模块自带临时 DATA_DIR，不再依赖外部环境变量，也不会与真实服务的租约冲突。真实模型 token / 质量基线仍未测量，运行中的用户服务未重启。

## 2026-10-08 — 子代理结构化交接与只读结果复用

已交付（子代理 token 效率，规格 `docs/requirements/subagent-token-efficiency-spec.md`）：

- **结构化委派 brief**：`subagent` 的每个任务项新增可选 `goal` / `knownSources` / `missingInfo` / `constraints` / `deliverables` / `acceptance` / `scope`。`renderDelegationBrief` 只渲染父代理实际提供的字段并附加到子任务前；无字段时任务原文不变。父代理因此把已抓取的资料、已验证约束和完成标准交给子代理，子代理只补缺失信息，而不是重复整段探索或继承父会话历史。
- **只读结果复用**：新增 `resultReuse.ts`，在共享 `ToolRuntime` 层按“工具身份 + 归一化参数（路径 / offset / limit）+ 源版本（设备 / inode / size / 纳秒级 mtime 与 ctime）”复用未变化的只读结果。命中时跳过物理读取，返回原内容并附带指明来源与刷新方式的 notice（不是裸“已读过”拒绝）。源版本变化、范围变化、缓存缺失、失败结果一律重新执行；图片读取不参与复用。
- **写入失效与副作用隔离**：`read` 声明复用描述符；`write` / `edit` 声明 `invalidatesSources`，成功执行后按源清除对应缓存。只有 `sideEffectClass === "pure"` 的调用会进入复用，写入 / 编辑 / 发布 / 审批永不缓存或跳过。`fs.stat` 加入共享 `SafeFsApi`，无法证明新鲜度时不复用。
- **测量**：复用结果带 `metadata.resultReused` 并在运行详情中记录一条“复用未变化缓存结果”的 tool_end；模型轮次、工具请求、usage 沿用既有 trace / usage 投影。

验证：新增 `resultReuse.test.ts`（5 项）、`toolRuntime.test.ts` 复用回归（6 项）、`read.test.ts` 真实文件端到端复用与编辑重读（1 项）、`subagent.test.ts` brief 渲染与子代理到达回归（3 项）。`node --test` 跑 `src/lib/server/agent/tools/*` + `core/*` 共 487 项，485 通过、1 跳过，唯一失败为既有环境相关用例（独立 Skill drafter 需要服务所有权，被当前运行的桌面服务占用）；`test:projects` 86 项、`test:desktop-chat` 300 项全绿；`tsc --noEmit` 通过。未做真实模型同批任务的优化前后 token / 质量对比（无基线，未设置节省百分比），未重启用户正在使用的服务。

## 2026-10-08 — 可读的执行进度与调用复用指引

已交付：实时对话默认显示最近两条助手正文进度说明、当前结构化步骤和实时耗时；工具链与输出折叠到「执行详情」。无正文说明时只显示真实工具状态，不把私有思考或日志生成解释。移除桌面对内部诊断的旧活动解析；子代理开始/结束更新同一个任务条目，不重复增加工具计数。

共享提示词要求阶段说明、委派前说明、复用抓取和读取结果、继续未读范围、合并独立检查，并向子代理传递已知资料。子代理使用同样的复用指引。长任务分类保留决策模型；调用数改善尚待真实任务验证。

验证：150 项活动/传输/最终提示词测试、14 项进度与转录测试、284 项 UI 结构守卫通过；类型检查及两端构建通过，桌面 Svelte 检查有一个既有 AgentCityInspector 警告。隔离真实组件首次打开、详情展开、语言/主题/窄屏切换、会话切换与预览重启后重新打开通过。子代理专项 49 项中 48 项通过，独立 Skill drafter 用例被现有服务所有权守卫拒绝，未绕过用户服务锁。未重启用户服务或替换安装包，完整桌面运行连接冷路径未验证。

## 2026-10-07 — 后台执行取消归属修复

- 已交付：桌面重连清理绑定具体 runId，由共享 Runner 拒绝取消后台事件和长任务；仅统计实际停止的前台孤立运行。
- HTTP 断连监听归属当前前台运行，结束时移除；迟到断连不能取消同会话的新运行。主动 Stop 继续支持后台任务。
- 取消日志记录来源与执行归属；回归覆盖后台保护、过期 runId 和清理计数。

## 2026-10-07 — 决策模型长任务分类与卡片换行

已交付：Web Chat、Stream 与共享渠道入口使用当前启用并选中的决策模型判断普通任务或长任务，工具前预检使用同一接入。支持 Jev、Cloudflare 与 LLM，沿用超时和置信度阈值。移除自然语言关键词和多链接自动判定；分类指引区分实际指令与待保存正文。不可用或不确定时保留普通执行，显式长任务命令及 force 仍可直接创建。启用决策模型时，普通请求增加一次入口分类调用。

桌面长任务卡片的目标、下一步和等待原因保留换行，连续字符在卡片内折行，网格不被长文本撑宽。窄屏状态标签独占一行。

验证：运行时与决策模型回归、桌面结构守卫、类型检查与前后端构建通过；实际卡片在隔离预览的中英、明暗、三种宽度共 12 组检查无横向溢出，首次打开、操作、切换内容和预览服务中断后恢复通过。模型接入使用模拟响应验证，未进行线上模型准确率评测；未重启用户服务，完整桌面冷路径尚未验证。

## 2026-10-07 — Mini App 工具发现与调用指引

已交付：`miniAppManage inspect` 在模型可见结果中列出完整 App 工具名，并说明检查安装状态不会保存业务记录；Agent 使用 `toolSearch` 获取参数后直接调用 App 工具。精确选择出现部分匹配或全部未匹配时，`toolSearch` 返回未匹配项、可用工具名和正确查询方式。系统提示词明确区分 Mini App、Skill 与 MCP 入口。

验证：临时目录中的 App 安装、检查、schema 发现与调用集成测试，精确选择部分/全部未匹配回归，以及最终渲染提示词检查。未重启当前服务，未改写用户笔记。

## 2026-10-07 — Desktop 侧栏图标网格与分区头折叠

已交付（桌面侧栏 6 项优化）：

- **分区头与主导航左对齐**：`.sidebar-section-head` 在 23 个主题家族里被额外加了 `margin: 2px 6px; padding: 0 6px`，把「对话 / 项目」整体右移 12px，与上方「自动任务 / 计划 / 小程序」的 8px 内容起点错位。现将这些主题规则的水平内缩统一去掉（改为 `margin: 2px 0; padding: 0`，保留垂直间距、圆角与 hover 背景），并在「对话 / 项目 / Agent Team」分区头里补上 16px 图标槽，使标题落到与主导航、渠道行、项目行同一条 32px 网格线（8px 行缩进 + 16px 图标 + 8px 间距）。
- **分区头再次点击折叠**：`openConversationsSection` / `openProjectsSection` / `openRoomsSection` 现在在该分区已经是当前内容且已展开时再次点击即折叠（并持久化），否则维持「切回该分区并展开」的原行为；标题旁 caret 仍可独立折叠/展开。三种分区行为统一，不再出现「只能展开、不能收起」。
- **Agent 房间更名为 Agent Team 并加图标**：`roomsCopy` 标题改为「Agent Team」/「Agent Teams」，分区头与折叠态图标栏使用 `dialog` duotone；按要求保留在「项目」下方，未上移到「对话」上方。
- **图标替换**：项目 → Filled `Package`（分区头与折叠态图标栏，替换 `feed-duotone`）；自动任务 → Filled `SendClock`（替换 `sort-time-duotone`）；计划 → Filled `Bulb2`（替换 `layers-duotone`）。`package` 与 `send-clock` 官方只有 Filled/Outline、没有 duotone，`bulb2` 按 owner 指定也用 Filled，统一走 `reicon-svelte` 组件并传 `weight="Filled"`。

验证：`node --test` 9 个桌面结构守卫套件 288 项全绿（同步更新「list-section headings」守卫以断言新的折叠分支）；`svelte-check` 0 错误（1 条既有、与本次无关的 `<nav role=tablist>` 警告）；`vite build` 通过。未在隔离预览实例做冷启动走查（未重启用户正在使用的桌面服务）。

## 2026-10-07 — 模型输出上限可配置 + 输出截断自愈（阶段 A 基础切片）

修复线上问题：子代理用推理模型翻译一篇约 6800 词的英文长文时，最后一条响应 `stopReason: length`、`output: 8192 / reasoning: 8192`，即 8192 的输出预算全被「思考」吃光，正文一个字没写就断了，父 Agent 收到 `Status: length; not completed.` 后停住。根因是自定义 Provider 的模型输出上限被硬编码为 8192，且推理 token 与正文共用这一预算；上下文窗口（这些模型是 1M）与此无关。

已交付：

- **输出上限可配置（写入 settings.json，无设置页控件）**：新增 `maxOutputTokens`（默认 32768，环境变量 `MOLIBOT_MAX_OUTPUT_TOKENS`，范围 256–262144）。模型注册表能识别出模型已知输出上限时按 `min(配置值, 已知上限)` 收敛，避免向 fallback 的小上限模型请求超限 `max_tokens`；未知自定义模型用配置值。`toStaticSettings`/`sanitize`/`RawSettings` 已同步，随设置持久化；主模型（`resolveCustomModel`）、子代理模型（`buildModelFromRoute`）及直连 Provider 的 Anthropic 生成路径均读取该值。用户手动在 settings.json 提高它后重启即可让长翻译/长报告跑完。
- **C：输出截断识别与自愈**：子代理生成循环现在识别 `stopReason: length`。若该次响应既无正文也无工具调用（预算全花在 reasoning），自动关闭 thinking 后继续已提交上下文并重试（最多 2 次）；重试仍截断则记录结构化停止原因 `length_exceeded`，不再静默当成功。纯函数 `assistantHasUsableOutput` / `planLengthRecovery` 单元覆盖。
- **A：委托拆分引导**：`subagent` 工具描述明确要求长源材料（整章/数千词文章）按段落拆分后分派，暗示单个委派任务有输出预算上限；`length_exceeded` 作为结构化 `runtimeStopKind` 回传父 Agent，父 Agent 据此拆分重派。

验证：`store.test.ts` 新增 `maxOutputTokens` 重启 round-trip（含越界钳制），settings 55 项、subagentRuntime/piConversation 相关 47 项、agent 全量 1128/1130（唯一失败为既有、与本改动无关的 `standalone skill drafter`）通过；`npm run check` 与文档能力矩阵守卫通过。

## 2026-10-07 — 规模化自主长任务：多工作项请求的确定性升级（阶段 A 基础切片）

修复线上问题：用户一次发来 4 篇文章链接要求「都保存为博客并发布」，任务却按普通 Run 执行、两次尝试后停在半成品并报「还不能发布」。根因是长任务识别的唯一入口是「首次非幂等工具」时的模型 preflight，而该 preflight 复用主模型；主模型当时不稳定，`evaluateDurablePreflightWithModel` 抛错后按设计静默回退成普通 Run，于是没有创建 Durable Execution（该会话在 durable 库中 0 条记录），自然也不会有跨轮续跑、逐项验收或目标追踪。

已交付：确定性升级新增两个不依赖 preflight 模型的信号——一条消息里 ≥2 个 URL 且带内容动作（保存/收录/整理/翻译/发布…），或批量/复数指代（逐篇/每篇/批量/全部/所有/这些/几篇…）加内容动作，直接创建 Durable Execution（`multi_item_request` / `bulk_content_request`）。同时 `evaluateDurablePreflightWithModel` 的降级分支（模型报错、未完成、不可用、结构化输出非法、promote 缺字段）现在标记 `degraded`；运行器在 preflight 降级且消息命中确定性信号时走确定性升级，而不是静默转普通 Run；Session 计划执行与已绑定执行不受该回退影响，避免重复创建。

验证：`activation.test.ts`（多 URL、批量指代激活；单 URL、比较链接、单篇保存不激活；降级回退升级）、`preflight.test.ts`（结构化非法与不可用均标记 degraded）、`runner.test.ts`、全套 durable + plans + core（145）+ 路由（42）通过；agent 全量 1126/1128（唯一失败为既有、与本改动无关的 `standalone skill drafter`）。尚未交付：「继续」绑定既有目标、调度器代码派发与规模化验收。

## 2026-10-07 — 规模化自主长任务：工作项独立验收（阶段 A 基础切片）

依据[规模化自主长任务 PRD](docs/requirements/large-autonomous-execution-prd.md)：Durable Execution 的每个计划工作项现在绑定一条确定性验收规则，执行者的「完成」声明不再是验收通过条件。运行器在一次 attempt 结束后先用已注册检查器核对产物证据，通过才标记步骤完成；缺失或格式不符的产物会被拒绝，规则缺失或无对应检查器一律 fail closed（不默认为通过）。

已交付：新增 `durable_step_rules` 表（按 execution/plan_version/step 存储 checker、参数、失败处置、规则版本），随计划创建、修订、内容替换一起写入并在读取时回填到步骤；`exitPlan` 计划步骤默认绑定 `run_detail_present`。运行器内置 `run_detail_present`、`evidence_present`、`expected_outputs` 三种检查器。`onFailure:"retry"` 的规则在额度内把步骤退回 `pending` 重新派发；`"block"` 或额度耗尽时把步骤标记 `failed`，目标进入 `recovery_required`，并通过来源渠道发送持久化的中文兜底报告（停止位置、原因、已完成/未完成项），父模型静默时仍有记录。步骤验收证据以 `durable-step-verifier` 引用保存，可经证据读取器回读。

验证：`stepVerification.test.ts` 6 项（规则 round-trip、修订携带规则、完成但缺产物被拒绝并阻塞、产物存在则通过并推进、跨 attempt 自动推进到完成、retry 规则退回重派），durable + plans 全量 105 项、类型检查通过。剩余阶段 A 范围：规则由主 Agent 在 `exitPlan` 中显式声明、调度器代码派发（不逐项唤醒主模型）、目标累计费用与并发公平、以及真实入口的冷启动 live 验收。

## 2026-10-07 — Desktop 统一窗口框架与全局 Header

已交付：Chat 顶部与侧栏共用一张窗口材质层，统一主题颜色、透明度与模糊；右侧文件／小程序面板的 header 同样保持透明、与全局 header 属于同一条背景带，它下面的内容与中间对话内容同处一块悬浮面，两者之间只有面板自己的浅色左侧分割线。内容框保留 8px 右侧／底部窗口边距、圆角跟随主题，悬浮阴影加在与整块内容框等尺寸的共享 frame overlay（`.chat-layout::after`）上，使对话与 Inspector 内容读起来是一整块浮在「Header + 侧栏」之上的整体。

统一窗口 Header：整个窗口只有一条承载当前页面身份与操作的顶部 Header（窗口网格第一行）。按 Codex 参考收紧为三栏：全局 Header 覆盖「侧栏 + 对话」两列（列 1-2），左侧固定预留原生红绿灯，随后是窗口级控件（侧栏切换 + 会话搜索／新对话），再后是当前页面／会话标题、来源与页面级操作，且操作右对齐到对话列右缘。侧栏展开时 Header 复用两列网格，标题左缘对齐对话列左缘（即内容框左缘），并在该列边界加一条 1px 实线：颜色取自内容框阴影接触层的同色 token `--content-frame-edge`（浅色下为深色低透明，深色下为浅色低透明，避免纯黑在深色画布上消失），让这条线读起来是内容框左边缘向上延伸、与阴影同一整体；线右侧文字留 12px 间隔，不紧贴。折叠时回退为单行 flex、去掉这条线，标题跟在控件之后（保持原有逻辑）。打开的 Inspector 是独立的全高第三列：它自己的 header（标题、搜索／跟随、关闭、文件／小程序切换）与全局 Header 同处这一行，由该列的浅色左规则分隔，正文与对话内容在下方拼成一整块、保留中间分割线。聊天、项目、Room、自动任务、技能、Mini Apps、计划和 Agents 都通过共享 `ChatHeader` 组件把标题、来源、副标题与操作片段发布到这一条 Header；原页面的浮动 Header 与第二条标题栏全部删除。Room 配置页的说明文字移回正文顶部；工作区说明保留在正文顶部并居中于工作区列。

主题一致性：所有主题下 header 与左侧导航同用一张窗口材质（`--sidebar-material-tint`）。删除了 53 处主题规则：`[data-theme-region="header"]` 元素自身的背景、下边线与阴影（27 个文件），以及 `[data-theme-region="file-panel"] .file-panel-head` 的背景／下边线／阴影（26 个文件），让文件／小程序面板的 header 也回到同一条背景带；主题仍可给 header 内的控件上色。回归守卫断言所有主题都不再给窗口 header 或 Inspector header 上背景。浏览器逐主题核对：25 个家族 × 明暗共 50 组下 header 与侧栏的计算背景完全一致（均为透明，落在同一窗口材质上），侧栏材质 `::before` 全部隐藏；文件面板打开时 `.file-panel-head` 背景透明、无下边线。

搜索图标：窗口级「搜索会话」按钮改用 Reicon Outline `Search4`，会话内搜索（聊天 header 与项目 header 的 TranscriptSearch 触发器）改用 Outline `MessageSearch`，替换原先的 duotone `Magnifier`；作为 owner 指定的非 duotone 例外记录在 DESIGN 图标章节。

验证：桌面回归（含 297 项 `.mjs` 结构守卫）、Svelte 检查、生产构建与 Rust 测试全部通过。浏览器走查了聊天（无 Inspector 与强制打开 Inspector 两种）、自动任务工作区、浅色／深色主题、iOS 浅色主题、Brutalism 深色主题、侧栏展开／折叠、Header 标题对齐与列边界实线、内容悬浮投影与三栏几何（Header 覆盖列 1-2、Inspector 全高、面板左规则分界）。未中断用户后端服务，原生红绿灯避让、原生空白拖动与桌面材质合成尚未在原生窗口走查；服务未就绪故项目／Room 的真实标题切换、会话操作右对齐与搜索展开仅按共享机制验证。

## 2026-10-07

- MCP/菜单更新：[说明](docs/guides/session-control/session-control-commands.md)。

Delivered: Agnes video URLs; query errors stay retryable. Regression tests: 15 pass.

## 2026-10-04 — Agent 房间多次会话

已交付：房间配置与会话记录、成员 Context 分开存储。标题栏提供新建会话和历史选择器，草稿、模型选择与消息归属按会话隔离；运行中切换不取消原会话工作，房间写入资格仍跨会话串行。当前选择在页面刷新后恢复，新会话不重复出现在普通会话和 Project 列表。会话事件只同步对应记录，恢复时同步整个房间。

验证：临时数据库的服务/API/身份回归及实际 Runner 模拟模型测试 31 项通过，桌面界面与响应性守卫 284 项通过；后端与 Desktop 类型检查及构建通过。隔离服务首次打开、新建/历史切换、后台结果归属、草稿切换、刷新/重启恢复、中英/明暗和 560px 窄屏走查通过。隔离旧结构服务冷启动、原聊天回显、升级后新建与历史切换、服务中断重连通过。旧房间在首次加载新版结构时先生成 SQLite 备份，再将原聊天和成员 Context 归入第一条会话；临时数据库升级、历史/重试身份保留及再次打开不重复升级回归通过。用户已批准本次保留数据的结构升级例外；真实用户服务未重启，原生安装包未替换。

## 2026-10-04 — 项目会话运行标识

已交付：项目侧栏会话行连接现有项目运行状态，复用对话列表的运行动画、等待审批及后台完成/失败标记，沿用中英文状态说明与减少动态效果适配。会话行渲染回归、桌面类型检查及构建通过；原生桌面冷启动、会话切换与服务中断恢复走查尚未执行。

## 2026-10-04 — 原生工具准备校验

共享工具 bridge 在权限审批和执行准备前调用 Pi 参数校验器；不合法参数直接返回错误，不创建审批或执行 intent。回归用真实 Bash schema 验证空理由拒绝发生在审批策略之前，以及普通 null 参数继续准备。

## 2026-10-04 — Bash 审批参数契约修复

普通 Bash 调用允许显式 `hostApproval: null`；请求 Host Bash 的对象必须提供非空理由，避免模型填入空对象误入审批。timeout 明确以秒计。schema 回归覆盖普通执行与无效审批输入。

## 2026-10-04 — 委派工具死锁修复

已交付：共享副作用分类将 Codemode 与 subagent 作为编排容器，容器不持有叶子工具的执行锁；实际 bash、写入等继续独立校验权限并串行记录副作用。父任务等待子任务时，不再阻塞子任务申请同一把锁。等待执行锁的任务可立即取消，取消后仍保持后续任务与当前持锁操作的执行顺序。

回归覆盖：修复前嵌套委派测试失败；修复后 Codemode → subagent → bash/写入完成、原生 Pi 父子共用运行时实际 shell 执行、叶子权限拒绝、串行副作用及取消等待者顺序通过。144 项相关测试及类型检查通过；子 Agent suite 使用隔离 DATA_DIR 避免与运行中的服务租约冲突。运行中的服务与已有挂起任务尚未切换到新代码。

## 2026-10-04 — Desktop 系统设置页

已交付：桌面设置增加系统页，提供运行时区、主 Agent 失败重试与工具预算、子 Agent 运行限制、浏览器超时及跨渠道显示与通知默认值。保存仅提交修改的字段，复用共享系统设置校验与存储。主、子 Agent 均明确失败重试标签。语言、更新与端口仍在通用页，默认权限仍在执行与权限页，版本仍在诊断页；已有入口迁移待用户选择。

验证：116 项相关测试、6 项桌面结构守卫、Web 与 Desktop 类型检查及构建通过。临时数据库整对象保存与新建 store 回读通过；隔离桌面预览检查首次打开、保存、页面切换、服务中断与重启回读、中英、明暗及 560px 窄屏。原生 macOS 安装包尚未替换。

## 2026-10-04 — 模型失败重试预算

已交付：主 Agent 默认允许失败后重试 6 次；正常生成不扣预算，失败按原生 generation 身份去重并持久化。空回复最多重试 2 次，已执行操作不重放。

2026-10-07 已交付：子 Agent 改为默认 12 次模型失败重试，移除正常轮次上限。停止结果包含失败标记、进度和原因，父 Agent 继续处理并输出结论；父模型无文本或返回 `[SILENT]` 时，Runner 输出未完成说明。Desktop/Web 设置同步更新。详见[子 Agent 执行与失败恢复](docs/guides/subagent-execution.md)。

验证：真实原生子任务超过 12 轮、失败重试耗尽、失败后父输出及静默兜底、已完成写入不重放、临时数据库设置整对象 round-trip。隔离 Desktop 预览保存、切页、服务中断与重启回读、中英和暗色窄屏走查通过；原生安装包未替换。


## 2026-10-04 — Review 缺陷修复

### 修复：Room 成员、只读工具、图片任务与录音接收（已实现）

- 停用或删除 Agent 后，Room 仍可打开；不可用成员的模型标识为空。文本提及只匹配当前 Room 在场成员，Room 外成员及其同名别名不再影响发送。显式指定非成员仍被拒绝。
- Room 执行授权和工具注册使用同一只读判定；Codemode 可编排只读调用，嵌套写入仍被拒绝，讨论模式不暴露 Plan 的退出与委派工具。
- Pi 图片引擎用 `credentialSource: provider` 表示复用 Provider 凭证，不再保存空 API Key 与无效协议字段；选择和日志按凭证来源处理。图片用量复用运行时数据库连接，一次联表查询只读取计费字段，删除媒体后仍保留计费事实。
- 旧图片 Provider 的输出通过字节、返回的 MIME 或下载响应类型确定格式，并使用匹配扩展名；无法确定格式时明确失败。多图发送中途失败会返回已上传数量，已保存图片仍保留。
- 录音结束时把文件放入当前打开的聊天输入框；Room 的不同导航入口统一关闭浏览器与外部记录。Durable 恢复合并幂等键、类型、目标和内容完全一致的重复 intent，不同操作仍需人工核对。
- 升级前已排队的旧 `plan` 多人讨论执行会直接失败，需重新发送；不会迁移旧模式。

回归覆盖：不可用成员模型投影、Room 外同名提及、Codemode 执行与嵌套权限、整对象设置保存后新建 store 回读、JPEG 扩展名、部分上传、重复 intent 与删除后用量保留。隔离 Desktop 浏览器预览已验证服务重启、首次打开房间、页面切换及中断后自动恢复。真实 Provider 与原生 Desktop 冷启动验收仍需单独完成。

## 2026-10-04 — 设置/小程序图标与共享按钮主题修复

### 修复：共享 Button 的 variant 映射到控制族类名（2026-10-04，已修复）

`components/ui/Button.svelte` 把 `variant` 直接渲染成裸 `primary` / `secondary` 类，而全局只有 `.primary-button` / `.secondary-button`，导致只传 `variant`、没额外传 class 的调用（项目设置对话框、更新对话框）落到浏览器原生按钮、脱离应用主题。现改为把 `variant` 映射到 `.primary-button` / `.secondary-button`，项目设置底栏的保存/取消按钮恢复为应用控制族样式。新增回归断言。

### 优化：设置图标改 settings2 filled，小程序图标改 widget2 duotone（2026-10-04，已实现）

侧栏底部设置入口与项目 header 设置按钮从 `TuningSquare2` duotone 改为 Reicon Filled `Settings2`（DESIGN 记录为唯一的非 duotone 设置字形例外）；小程序导航图标从 `Grid`（squares）改为 `Widget2` duotone。`TuningSquare2` 从生成器 manifest 移除并重新生成。

### 优化：设置导航按入口定制字形（2026-10-04，已实现）

设置侧栏导航图标按入口逐项指定：审批管理 → Filled `Verified`，系统 → Filled `Gear2`；服务日志 → `Reorder` duotone，运行环境 → `CodeSquare` duotone，Trace → `Routing3` duotone。三个 duotone 字形加入 `scripts/generate-duotone-icons.mjs` manifest 并重新生成；设置导航模板本就以 `weight="Filled"` 渲染，duotone 组件忽略该属性按 duotone 输出。同时把旧的设置导航分类断言同步到当前 `system` 分区（工作区已新增系统页）。

## 2026-10-04 — 房间列表移入侧栏与分区导航

### 优化：Agent 房间列表移入左栏，分区标题点击切换右侧内容（2026-10-04，已实现）

Agent 房间不再占用整页列表：房间列表并入侧栏的列表分区（与对话、项目同级），展开态在左栏显示，折叠态通过图标栏的「房间」浮层显示，复用共享 `SidebarLists`；`RoomWorkspace` 只保留房间聊天和创建/编辑表单，列表由 `ChatView` 统一持有并在会话变更后刷新，房间创建走分区标题右侧的 `+`（`startInCreate` 进入创建态）。同时，点击「对话 / 项目 / 房间」分区标题会把右侧内容切回该分区（上一次的对话 / 项目会话 / 房间），折叠/展开改由标题旁独立的折叠按钮承担，避免进入技能等工作区后无法回到对话。`refreshProjectSessionList` 用于在无历史选中时回退到最近项目会话。

## 2026-10-04 — 欢迎页统一与图标调整

### 优化：本地 Chat 与项目新会话欢迎页统一，快速开始卡片重设计（2026-10-04，已实现）

本地 Chat 与项目新会话的空白欢迎页原本一个有三张快速开始卡片、一个只有标题和说明。抽出共享的 `emptyQuickStarts.ts`（拆解目标 / 分析问题 / 整理材料），两个空白页都通过共享 `ConversationLiveView` 渲染同一组卡片，项目侧新增 `fillEmptyPrompt`（只填入输入框并聚焦，不发送）。卡片视觉从透明灰边按钮改为卡片式：`--card-bg` 表面、强调色图标底片（`--accent-soft`）、12px 圆角、悬停微抬与边框加强，窄宽度下纵向铺满。

### 优化：侧栏图标调整（2026-10-04，已实现）

自动任务 `CalendarDays` → `SortTime`；对话 → `ChatRoundLine`，项目 → `Feed`，Agent → `Users2`，Agent 房间 → `Dialog`（后四项为上一轮替换，本轮补充自动任务）。新图标加入 `scripts/generate-duotone-icons.mjs` 清单并重新生成。

## 2026-10-04 — 折叠侧栏图标栏与对话/项目浮层

### 新增：折叠侧栏保留图标栏，对话/项目按需浮层（2026-10-04，已实现，待原生冷启动走查）

桌面端折叠侧栏不再整列隐藏：第一列保留 48px 图标栏（对话、项目、自动任务、技能、Agent、Agent 房间、计划、小程序、底部设置头像），点击顶部 对话/项目 在图标栏右侧展开浮层列，复用与展开态完全相同的 `SidebarLists.svelte`（频道过滤、项目分组、行菜单、分页一致），浮层复用记住的展开宽度；选中会话保持展开，Esc / 再点同一图标 / 点其它目的地关闭。自动任务等其它目的地点击直接打开现有面板，不新增列。新对话在折叠态由窗口标题栏按钮承载并同时打开对话浮层。`ChatView.svelte` 新增 `collapsedFlyout` 与 `reservedSidebarWidth` 预算，`styles.css` 折叠轨道改为 rail 宽度。规范见 `DESIGN.md` 折叠侧栏条目。

## 2026-10-04 — Pi 正式执行接线

共享 Runner 与内部子 Agent 改用 Pi 原生执行所有权。外部审批只唤醒原任务；稳定消息投影、原始预算、子任务权限与压缩、Codemode nested 收据和 Deferred 原 handle 启动恢复已接线。真实 Runner 强杀测试覆盖原生提交与显示标记之间的窗口，未知提交拒绝自动重提，Room 撤权与 Stop 终态优先。代码验证通过不代表真实外部 transport/Provider 验收完成；能力矩阵继续保留部分交付。详见 [生产验证](docs/reviews/pi-production-integration-validation.md)。

### 实施：Pi 混合工具批次审批挂起（2026-10-04，部分交付）


原生工具授权 hook 或准备流程可能挂起时，Pi 按原生串行批次调度，防止同批后续工具先开始执行。临时库恢复测试覆盖普通并行工具与审批工具混用：等待时保留已完成读取，批准后沿原审批 ID 继续，剩余操作各执行一次，恢复仍使用原始入站。正式 Runner 和外部审批入口尚未切换；该修复不代表生产接线完成。见 [验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 实施：Pi 原生会话与自动 Host Bash 阶段收据（2026-10-04，部分交付）

原生会话控制器支持稳定输入、工具动态配置、原生 continuation 与资源清理；自动 Host Bash 将沙箱尝试收据保存在原工具任务内，等待批准前不提交主机执行 intent。临时库重开验证批准/拒绝不重跑沙箱，未知执行结果阻止模型重试。工具回调按原生 task 找到原始 assistant，保留结果 override，私有审批 metadata 与第三方 details 分离。Deferred 查询/取消保留当前凭据、Session 请求头与请求回调。正式 Runner、外部审批入口、内部子 Agent 和 Deferred 的完整生产接线仍未交付，见 [验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 实施：步骤预算持久化与响应记账去重（2026-10-03，部分交付）

正式 Runner 的工具、失败与模型尝试预算按稳定步骤身份持久化，审批恢复和新 Attempt 不重置；原始上限固定，跨回合复用工具 ID 不漏计，未知工具与参数错误分别计失败。用量按响应记录身份重开去重并拒绝冲突。Pi 可恢复已接纳输入与初始上下文，继续校验权限和模型绑定。关联回归 74/74、内核回归 21/21 及类型检查通过；父子任务共享预算、正式 Pi 投影记账和内核替换仍未完成。见 [验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 维护：Agent Runtime 审查 Skill（2026-10-03，已交付）

更新项目级 `agent-runtime-debug-review` Skill：按症状检查共享执行所有权、审批挂起与恢复、重试中的实时控制、提示词持久化边界及执行与显示状态；历史根因从 CHANGELOG、归档和 Recurring Pitfalls 按需查询。明确已授权根修、临时数据库验证，以及隔离验证与正式 Runner、真实服务生效的证据区别。Skill 格式校验与静态场景走查完成，未进行独立 Agent 行为评测。

### 实施：Pi 原生事件与重开显示边界（2026-10-03，部分交付）

Pi 内核可交付原生实时消息/工具事件与提交快照；先完成记录投影，再通知显示消费者。显示回调失败后安全关闭，重开复用已提交工具结果。原生事件、共享 Runtime 与 Session 关联回归 33 项及类型检查通过。正式 Runner 的展示消费者与任务入口尚未接入，不标记内核替换完成。

### 修复：审批通知期间停止（2026-10-03，已交付）

共享 Host Bash 准备流程在消费已有审批、发布审批通知的异步回调返回后检查停止，将未执行请求过期，避免已停止任务仍被标记为可恢复等待。真实临时数据库回归覆盖通知中批准后停止及消费审批期间停止，晚到批准不能启动命令。根因属于审批状态与异步取消竞态；机器守卫已补充，现有审批选项不变。

### 修复：Host Bash 启动前停止（2026-10-03，已交付）

批准后的 Host Bash 在异步环境准备前后检查取消，避免用户停止后仍启动进程再终止。根因是异步准备与进程启动之间的取消竞态；临时目录回归覆盖准备前停止和准备期间停止，均不产生启动收据。审批选择与作用域不变。

### 实施：Host Bash 显式审批准备与恢复（2026-10-03，部分交付）

共享工具先准备审批，实际执行时校验上下文、权限与审批绑定并原子认领；稳定工具调用身份重开复用同一审批。按 ID 批准严格校验 scope/Session，取消过期未执行审批，清理失败仍关闭 Pi Harness。真实 HostBashStore 与 Harness 重开验证批准前无 intent、批准后原命令只执行一次。类型检查、生产构建与关联回归通过；全仓隔离测试仍有 7 项失败。自动 sandbox 升级、外部批准执行入口和正式 Runner 替换尚未完成，见 [验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 实施：Pi 提交记录投影与异步恢复（2026-10-03，部分交付）

Pi 内核可按稳定来源投影已提交消息，重开补齐 Session 记录并拒绝身份冲突；临时控制不进入持久历史，服务租约丢失会取消在途工作。真实子进程验证异步模型 handle 提交后强杀可继续查询原任务，答案与 usage 不重复；关联回归 62 项通过。ADR 0005 的私有执行存储边界已接受。正式 Runner、自动 Host Bash 升级与外部审批执行归属、持久预算与内部子任务仍未接线；不声称内核替换完成。见 [验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 修复：工具排队期间停止与权限撤销（2026-10-03，已交付）

共享工具取得写执行槽后重新检查取消和权限，异步 intent 回调完成后再次检查取消，避免已停止的排队操作启动忽略 signal 的 handler。新增单次 invocation 准备接口固定授权参数，权限仍由共享层执行；它为 Pi Durable 接线提供授权与执行分离，正式 Runner 尚未替换。根因属于执行所有权与异步竞态，持槽撤权、Stop 及 intent 回调中取消的机器守卫已覆盖；关联回归 55 项通过。

### 新增：Pi Codemode 工具组合（2026-10-03，已交付）

助理可在隔离脚本里批量查询、筛选结果，再调用已有工具。工具发现受当前权限约束，每个内部调用经过共享授权、审批、预算、Trace 与副作用收据；写操作仍使用共享执行槽。取消、脚本错误或审批挂起保留部分输出和已完成操作，审批后重新规划剩余步骤，不自动重放整段脚本。直接工具调用继续可用。

复用 Pi 1.0 正式 Codemode 引擎，以独立进程和 QuickJS 内存上限隔离脚本；无直接 Node、文件、网络、凭据或模型访问。大输出保存到当前 scratch 制品目录。真实 Runner 的预算/Trace 接线、审批恢复和部署文件守卫有回归覆盖。输入量对照仅证明筛选效果，不承诺降低模型费用。见 [验证记录](docs/reviews/pi-codemode-integration-validation.md)。

### 修复：桌面图片设置页打不开（2026-10-02，已修复）

## 修复：多人房间直接分析与执行状态（2026-10-03）

多人提及以独立只读讨论执行，复用现有受限工具白名单，不再自动进入生成计划的 Plan 模式；用户显式设置的 Plan 权限仍保留。房间模型预览由后端解析成员配置，已持久化回复按实际失败/中止状态呈现。共享 Runner 区分中止与具体错误，提供中英提示。

根因是将并发讨论的能力限制与 Plan 产品流程耦合，以及前端自行推导模型和成功状态。回归覆盖真实 Runner 的两份完整答案、身份与模型、禁用工具，以及失败提示。隔离浏览器冷启动、双成员发送、受控失败、技能页切换及服务重启回读通过；类型检查与前后端构建通过。原生 Desktop 与真实付费模型重放未执行。原截图研究员取消的具体触发源尚未确认，取消日志现在包含 Run ID，房间停止请求单独记录运行事件，不自动重放真实用户请求。


- 症状：桌面设置里点「图像」后页面停在加载态、无任何内容。根因是 Pi 图片模型新增的 `loadPiImageModels()` 请求 `/api/settings/image-generate/models`，服务端路由正常，但 Tauri HTTP capability scope 白名单只列了同族的 `.../test` 与 `.../image*`，漏了 `.../models`；`tauriFetch` 在 URL 不在 scope 时直接拒绝，`loadImageGenerate` 的 `Promise.all` 因此整体失败并被 catch，`imageGenerateEdit` 保持 null，组件永远走 loading 分支。
- 修复：在 `apps/desktop/src-tauri/capabilities/default.json` 的 `http:default` 允许列表为 `127.0.0.1` 与 `localhost` 两个 host 补上 `/api/settings/image-generate/models`。capability 变更需 Rust 重建并重启应用才生效，WebView 热更新无效。
- 机器守卫：`apps/desktop/src/http-scope.test.mjs` 新增扫描，遍历 `lib/api.ts` 中所有 `/api/settings/...` 路由字面量，要求两个 host 的白名单都覆盖；回放漏掉 `.../models` 会失败（已验证）。http-scope 7/7 通过。

### 新增：可选 Pi 图片生成后端（2026-10-03，已实现，待真实模型验收）

- 图片设置可选择 Pi 图片模型，复用现有 Provider 凭据；支持模型的参考图进入原生图片操作，不支持的 size/seed 参数明确拒绝。
- 现有图片任务保存全部图片、MIME、伴随文本及可选 usage；Web/Desktop 可以切换输出预览与下载，Channel 沿用文件发送接口。取消记录为取消，未知 usage 不伪造为零费用，不自动重发付费请求。
- 临时数据库验证设置整对象 round-trip、工具生成、多图发送与同库重开下载；隔离 Web 服务验证中英切换、保存、刷新及服务重启恢复。费用归入统一用量，按会话/Bot/渠道汇总已知估价并单列未知价格；取消、删除与保存失败保留费用事实，重读和重启不重复计费。飞书真实图片适配器的模拟传输契约通过（2026-10-03）。独立原生 Desktop 的首次图片设置加载、多图切换、页面切换及服务中断自动恢复已验证；真实付费 Provider 尚待授权验收。见 [验证记录](docs/reviews/pi-image-integration-validation.md)。

### 修复：房间提及的实际发送与模型语义（2026-10-02，已交付）

- 输入中的已解析成员 ID 随发送请求提交，与输入区展示的接收成员一致；后端仍校验房间成员资格。截图中的 `@agent-buffett @value-investment-researcher` 有精确回归。
- 本轮运行说明携带当前作者和接收成员，模型按自己的身份独立回复，理解 `@` 已由房间调度器处理。说明只进入本轮输入封装，真实 Runner 回归检查系统提示词与持久化历史均不包含它。
- 冷启动默认会话统一经过房间感知的打开入口；服务恢复保留房间选择。共享发送目标与恢复入口有界面守卫，避免恢复时把房间作为普通 Chat 打开。
- 根因是前端热更新与长期运行的旧后端不同步，发送请求又未显式携带文本解析出的目标；运行输入也缺少房间路由语义。此前隔离测试没有验证用户实际使用的服务。本次构建后重启桌面管理的后端，实时运行接口与深度健康检查通过；历史回复保留，用户重新发送后应用新路由。房间服务 20 项、真实 Runner 模拟模型回归、277 项界面守卫、Desktop 类型检查与两端构建通过。原生窗口画面中的最终回复未通过付费模型重放验证。

### 修复：Agent 房间提及路由与完整聊天界面复用（2026-10-02，已交付）

- 共享 Room 服务解析 `@成员名` / `@成员 ID`，支持中文、包含空格的名字、大小写匹配与去重；命中单成员直接执行，命中多成员进入受限讨论。非房间成员不能被调度，同名歧义要求使用 ID。输入区沿用共享候选菜单，选择项使用稳定成员 ID。
- 房间直接复用 ChatHeader、ChatMessagesPane、ConversationTranscript、ConversationLiveView、ChatInputArea 与 ApprovalCard。头像/作者按消息显示；工具过程、代码块、复制、附件媒体和下载沿用共享逻辑；房间管理收进顶部菜单，回复/执行使用消息旁的紧凑操作。
- 根因是独立房间 UI 与只接受显式 ID 的路由之间缺少文本提及契约；此前守卫只覆盖输入组件，未覆盖整页复用及真实提及调度。本次增加提及路由、中文/空格/同名歧义及跨房间校验回归，真实 Runner 集成改为通过消息中的提及启动两位成员；结构守卫覆盖完整页面复用。现有共享组件规则已覆盖该类边界，不新增重复协作规则。
- 冷路径检查补齐首次加载失败重试与事件心跳超时重连；避免服务中断时首次打开长期空白或旧连接悬挂。隔离预览验证首次打开、顶部菜单、草稿切换、中英文、明暗主题和 560px 宽度。服务中断后心跳超时显示断线状态，恢复服务后自动回连、清除错误并保留草稿。房间服务 19 项、真实 Runner 集成 1 项、共享组件逻辑 22 项和界面守卫 276 项通过；Desktop 类型检查 0 错误、1 条既有警告，构建通过。根目录最终构建被另一个新增图片 Provider 测试夹具缺少 stream/streamSimple 阻塞（piProvider.test.ts），与本次修改无关。原生窗口拖动、原生录音实录仍未验证。

### 修复：Durable 恢复检查完整步骤的副作用（2026-10-02，已交付）

- 共享恢复路径检查当前步骤的所有 intent；较早的非幂等操作不再被最后一个安全操作掩盖。多操作步骤不能凭单个 queryable 查询结果宣布整个步骤完成，统一进入恢复决策。
- 两类混合副作用回归通过；Durable 相关最终回归 23/23。Pi Durable 1.0 的隔离执行适配已实现并验证审批重开、结果复用、真实 SIGKILL 与取消；尚未接入正式 Runner，不能视为内核替换完成。详见 [阶段 1 验证记录](docs/reviews/pi-durable-foundation-validation.md)。

### 优化：Agent 房间复用普通对话输入区（2026-10-02，已实现）

- 房间直接使用完整 ChatInputArea，复用模型/思考菜单、附件预览与移除、录音入口、输入卡材质及键盘交互；成员头像、多人讨论提示和引用放入现有插槽，删除房间移到顶部。
- 复用 SessionDraftStore 保留切换页面时的文字、附件、模型和思考草稿；共享 Enter/IME 守卫和思考等级文案，录音沿用普通对话的原生/浏览器实现，并把附件返回录音开始时的输入区。未选择模型时，各成员使用自己的模型；显式选择应用到本次提交的成员，进入真实 Runner 和上下文预算。模型与思考等级随提交记录持久化，重新打开回读，重试沿用。
- 房间持久化及幂等回归、真实 Runner 模拟模型请求、共享键盘与思考能力测试通过。隔离预览验证模型与思考切换、成员选择、附件添加/移除、中英即时切换、明暗主题与 560px 窄屏、草稿切换恢复及服务重启恢复；原生录音实录尚未验证。Desktop 类型检查 0 错误、1 条既有警告，构建与 274 项界面检查、9 项共享输入/草稿测试通过；房间服务 16 项与真实 Runner 集成测试通过。根目录本次复查被另一个 Durable 测试夹具的缺字段类型错误阻塞（piKernel.test.ts），本次改动不涉及该文件。

### 优化：Agent 房间创建与成员编辑（2026-10-02，已实现）

- 房间顶部标题与整行空白接入原生拖动区域，操作按钮保持可点击；左侧入口移到 Agent 下方，改用对话图标，并正确显示当前选中页面。回归守卫覆盖拖动标记、按钮隔离和入口顺序。隔离预览已验证新建、取消、编辑、页面切换和服务重启恢复；273 项界面检查通过，Desktop 类型检查与构建通过。原生窗口实际拖动尚未验证。
- 创建页按房间信息、成员与协作方式分组，复用共享 SettingGroup/SettingRow；修正旧布局类名错配造成的标签与控件错位。
- 成员显示稳定头像、职责简介和选中反馈，宽屏双列、窄屏单列；默认回答者在选择成员前显示明确提示。固定底栏显示已选团队、保存进度和创建/保存按钮，取消可返回原视图。
- 修正 Grid 子项的最小高度，内容在面板内滚动，底栏保持在窗口内。隔离桌面浏览器预览已验证中英即时切换、明暗主题、560px 窄屏、创建双成员房间、切换设置页面以及服务重启后的成员回读。Desktop 检查 0 错误、1 条既有警告，构建与 272 项界面检查通过；原生 Desktop 房间完整验收仍待完成。

### 修复：根目录严格类型检查（2026-10-02，已修复）

- 根目录 TypeScript 检查的 310 条错误清零：加载已有 SDK 声明，补齐运行时依赖和接口字段，修正过期路由、响应联合类型与测试夹具。审批恢复通过共享运行时查询等待状态；持久审批白名单明确标记为持久授权。
- 共享 UI 的样式配置与类型移到独立 TypeScript 模块，组件标记和样式值保持一致。媒体测试接口在启动生成前拒绝非法 provider/engine。
- 此前构建只转译代码、Desktop 检查没有覆盖全量后端和测试，存量错误掩盖了缺失标识符和接口错配。新增 `corepack pnpm check`，生产构建也先执行严格类型检查。相关回归 547 项通过，生产构建、隔离服务首次页面与设置接口加载及重启恢复通过；Desktop 检查 0 错误、1 条既有警告。Web 全量 Svelte 检查仍有 87 条错误，涉及旧页面和第三方声明；原生 Desktop 房间验收仍待完成。

### Desktop Agent 房间（2026-10-02，已实现，待原生验收）

- 普通和 Project 房间保留一份共享记录与每位成员独立上下文；默认回答者、定向回复和多成员受限 Plan 讨论可在同一房间使用。
- 成员使用自己的模型和身份。房间内写入串行，审批保留执行资格；独立取消、排队、停止、成员移除和重启暂停由共享服务管理。重试保留历史证据，未知外部操作需核对。
- 附件、共同历史预算和保留限制参与真实 Runner 请求；房间通过现有 Session 回收站恢复和清理。使用方法及插队隐私限制见 [房间指南](docs/guides/agent-rooms.md)。
- 修复（2026-10-02）：显式引用无法放入共同上下文时拒绝发送，不再静默丢弃；暂停恢复与失败重试持久保存提交 ID，重复请求返回原结果，ID 用于不同操作或执行时明确拒绝。
- Room 服务、真实模型请求及受影响运行/工具/会话回归通过；Desktop 完整测试和构建通过。全仓检查限制与原生验收范围见 `prd.md` 的 #62 记录。

### Pi Runtime 1.0 与新版请求、登录和分类 API（2026-10-02，已实现）

- Pi 三个运行时包统一升级到 1.0.0，Trace 直接依赖独立 telemetry 包；现有模型和 OAuth 目录自动提供新版本条目。
- 请求前恢复最终系统提示词和工具，原生 transcript 保留动态工具与系统更新；审批暂停改用 `finishTurn`。assistant 上下文保留实际请求的 `thinkingLevel`。
- ChatGPT 登录传递可跨重启复用的安装 UUID；通用 OAuth 交互承接 Anthropic 复制验证码登录。TypeSafe-compatible Jev Auto 决策使用 Pi 分类 API，保留取消、超时、零重试和安全错误规则。
- 聚焦回归、生产构建、Desktop 类型检查和隔离服务初始化通过；真实账号授权与付费模型请求未验证，根目录 TypeScript 检查已在同日后续修复中通过。新特性接入范围和未接入原因见 [升级评估](docs/reviews/pi-1.0-upgrade-assessment.md)。

### 修复：Auto 决策的入队快照、取消与凭据边界（2026-10-01，已实现）

- 排队时保存策略来源、自动上限和不含凭据的接入身份；排队期间改策略或接入地址不再改变已接收 Turn。审批及内部恢复复用决策，用户显式重试重新决策。
- 决策超时及 Stop 不再等待忽略取消信号的请求；非法置信度被拒绝，缺少续写前文或必要附件内容时确定性回退。历史输入只包含用户与助手文本，裁剪状态如实记录。
- Jev 上游错误只返回安全状态，保存前验证 Host 和策略字段。Web 设置页采用当前接入列表及密钥更新格式，保留其它接入，支持已有密钥测试、中英即时切换和固定保存栏。
- 运行记录保留原始规则版本、上下文大小、可用决策用量及估算费用。新增的实际主模型配对评测入口见 [评测说明](evals/README.md#adaptive-thinking-paired-outcome-evaluation)；未测量的数据明确标记为未证明。
- 验证：相关运行、决策、设置和队列回归及隔离设置保存、重启回读通过；Web 中英、明暗及窄屏保存栏已走查。产品负责人于 2026-10-01 确认已完成原生 Desktop 验证；功能验收完成，issue #61 按产品负责人要求关闭；真实主模型收益评估作为后续可选优化，尚无量化收益结论。完整检查的限制见 `prd.md` 的 issue #61 验收记录。

## Archive Index / 归档索引
- [2026-09-12 Features snapshot](docs/archive/2026-Q3-features-september-12.md)
- [2026 Q2 Features Archive (Apr - Jun)](docs/archive/features-archive-2026-Q2.md)
- [2026 Q1 Features Archive (Feb - Mar)](docs/archive/features-archive-2026-Q1.md)
- [2026 Q3 Features Archive (Jul - Sep)](docs/archive/features-archive-2026-Q3.md)

# 外部任务监控与异常收尾（2026-10-07）

共享 Runner 在异常结束时保留最近的进度说明，输出成功工具结果摘要、未返回结果的步骤和停止原因，并保存到会话和运行摘要。早期进度消息不再阻止异常收尾保存；监控超时不会被解释为远端任务失败，也不会伪造整体成功。系统提示词要求长等待前先报告成果和待确认事项，优先短时查询既有任务。Bash 副作用分类及未知写操作恢复保护保持生效；后台跟进须经 `runtimeTask` 实际创建。[使用说明](docs/guides/external-job-monitoring.md)。

验证：80 项相关回归、类型检查和生产构建通过；原生 Runner／Pi 隔离回归确认真实工具回执、进度消息、异常报告持久化及不重放，渲染系统提示词检查通过。用户服务尚未重启，真实外部模型行为未重放。

# 历史会话轮次对齐（2026-10-07）

共享会话投影保留只有工具过程的助手回合，按原始用户输入时间校验来源 ID 与轮次对应关系，防止一个回合缺少正文后逐轮错配后续消息。重新加载会话可校正已保存的错误对应关系。最近运行摘要补齐终态与已有结果，监控异常不再因缺少最终助手消息而显示执行成功。

验证：35 项会话投影、运行上下文与桌面 transcript 回归通过，覆盖错配来源 ID 校正、纯工具回合保留、延迟入场和再次加载。真实故障 session 的只读投影确认五轮对应正确；未改写原始数据，未重启用户服务，真实页面冷路径尚未走查。

## 2026-10-07 — 长命令实时执行进度

命令执行层实时传递最近输出，共享 Runner 按工具调用 ID 更新活动。桌面运行中的工具默认展开最近 12 行输出和实时耗时；已有进度正文不会遮住运行工具，超过 1 分钟的已完成命令保持独立条目。结束或取消后的迟到更新不会恢复运行状态。

验证：97 项执行与活动回归、补充后的 53 项 Pi 原生回归、27 项桌面状态测试与 284 项界面守卫通过；前后端构建通过，桌面检查 0 错误、1 个已有警告。隔离组件验证首次展示、内容切换、输出恢复、中英、明暗主题与 360px 宽度。Pi 回归覆盖准备阶段实时输出、重复开始事件去重和长输出尾部保留。未重启用户服务，完整桌面服务冷启动与真实聊天断线恢复尚未验证。
