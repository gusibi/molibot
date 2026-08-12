# 主题家族与明暗模式调查记录（2026-08-12）

## Confirmed decisions

- Brightness and theme family are independent.
- Brightness options: Light / Dark / System.
- Theme families: Minimal (macOS), Rosé Pine, Catppuccin, Midnight.
- Rosé Pine variants: Dawn / Moon.
- Catppuccin variants: Latte / Macchiato.
- Midnight variants: Daybreak / Midnight.
- `Daybreak` is the accepted name for Midnight's light partner.

## Implementation findings

- The previous Desktop contract combined `system`, `light`, `dark`, and `midnight` in one `DesktopTheme` value and one storage key.
- The new contract uses `DesktopAppearance`, `DesktopThemeFamily`, `data-appearance`, `data-resolved-appearance`, and `data-theme-family`.
- External previews only need resolved `light` / `dark`; family tokens remain in the Desktop WebView.
- Chat Markdown, Agent Studio, and Mini App theme propagation now read the resolved appearance.
- Chat and Settings retain the native sidebar window effect, translucent family tint, and shared blur; accessibility and low-performance paths remain opaque.

## Verification

- Focused UI structure tests: 200/200.
- Desktop API tests: 85/85.
- Full Desktop Node suite: 204/204.
- Rust suite: 55/55.
- `svelte-check` and both production builds pass.
- Cold-start browser walk confirmed independent control state, persistence across reload/server restart, and sidebar blur.

## Follow-up findings: message menu and Inspector

- The screenshot menu is the assistant row's shared `OverflowMenu`; its absolute popover was always anchored below the trigger, so it opened toward the composer.
- The Artifact Inspector already reused shared syntax tokens, but its repository chrome kept hard-coded Primer canvas, border, label, accent, and status values with only generic dark/Midnight overrides.
- The fix keeps the repository layout and typography, adds explicit upward placement for the assistant menu, and aliases all Inspector chrome roles to the active shared theme tokens. This covers every family without another selector matrix.

## Follow-up verification

- Red-capable UI tests failed before the fix and pass after it: assistant menu placement plus Inspector shared-token derivation.
- Focused Desktop UI suite: 201/201 after the fix.
# Chat Transcript Optimization 发现记录（2026-08-10）

## 用户验收清单

- 核对而非盲信：交错时序、Plan 原语、DecisionCard、结构化/队列审批、Mermaid/KaTeX/HTML-SVG artifact/宽表 Spreadsheet、`breaks`、per-step 元数据、嵌套滚动、展开态、虚拟化/分页、turn 汇总、回答大纲。
- 已声明完成的项目也要回归，尤其审批可见性、工具分类渲染、流式增量、图片灯箱与表格/代码滚动。
- 全部实现后按项目规则做对抗式审查、真实冷路径和四份产品文档同步。

## 初始约束

- UI 必须遵循 `DESIGN.md`、现有 shadcn-svelte 与共享语义 CSS；中英、明暗主题和移动宽度均需覆盖。
- 不保留旧 transcript 数据模型兼容层；直接替换当前仍在使用的内部形状。
- 公共投影、队列、决策仲裁和运行状态属于共享上层，不下沉 Channel。
- `planning-with-files` 影响：调查、决策、错误与验证结果持续写入根目录三份记录；前一任务内容原样保留。
- `frontend-design` 影响：以项目现有聊天视觉语言为审美约束，追求高信息密度、克制的工具感和可访问交互，而不是引入脱离产品的全新视觉主题。

## 第一轮核对

- 用户关于 Permission Modes PRD “仍为 Proposed、切片 0/1 未动”的证据已过时：当前文档明确写为切片 0、1、3 已于 2026-08-10 交付，只有切片 2（Plan 模式）未开始。
- `TranscriptMessage` 当前仍是 `content: string` + `thinking?` + `activities?`；共享 `DesktopConversationActivity` 仍缺 per-step 时长/退出码/行数/token，结构性判断初步成立。
- `conversationController` 当前仍只有单个 `pendingApproval`；Plan/DecisionCard 在 chat 目录没有实现，初步成立。
- Mermaid 仍只在 Artifact `MarkdownPreview.svelte` 使用，chat `markdown.ts` 尚未接入；KaTeX 也未发现。
- 已确认先前交付有对应 UI guard：审批 attention、activity headline、共享 transcript 等；仍需读取实现确认行为而非只相信正则守卫。

## 设计与源码证据

- `DESIGN.md` 的 Chat 产品层要求：macOS 语义色、扁平 assistant 消息、消息/Composer 最大 720px、最多一个右侧 Inspector、状态不可只靠颜色、响应式 Inspector overlay；实现不得另造视觉体系。
- `ConversationTranscript.svelte` 仍明确固定渲染 assistant 的 `ThinkingCard` → `RunActivity` → Markdown body，交错时序确实无法表达。
- `DesktopConversationMessage` 与前端 `TranscriptMessage` 均没有 step 流字段；`DesktopConversationActivity` 也没有 `startedAt/finishedAt/durationMs/exitCode/lineCount/tokenUsage`。
- chat Markdown 当前仍 `marked.use({ gfm: true, breaks: true })`，仍禁止 `style` 属性；表格包裹、代码横滚/单块 wrap 已落地。
- Desktop 已依赖 Mermaid，但没有 KaTeX；新增数学渲染将需要成熟依赖而不是自写 parser。
- `RunActivity` 的分类逻辑已经区分 diff/code/json/terminal/text，并使用 tool id 而非展示 label；此项已完成，不应重做。

## 时序根因与可复用底座

- 根因在共享服务端 `agentDisplayMessages()`：它把同一 turn 的多个 assistant entry 合并成一个聚合 assistant，并分别拼接 thinking、覆盖 content；`ConversationActivityCollector` 又独立保存活动数组。真实 raw Agent content 本来有有序 `thinking/text/toolCall` parts，但投影主动丢弃了顺序。
- live 端 `ConversationController` 也分别维护 `streamingText`、`streamingThinking`、`activities`，不过 SSE 回调本身按事件顺序到达，可在 controller 层同步构建 live step 流。
- 活动 collector 可直接增加 `startedAt/finishedAt/durationMs`；Runner/ToolRuntime 的 start/end `RunDetailEntry.timestamp` 已存在，可沿用，不需另造计时系统。
- Permission Mode 的 Composer UI、effect 分类、共享 gate 与设置 round-trip 已存在；Plan 切片应只实现“暴露前收窄 + exitPlan + 计划产物/确认/同 Session 续跑”，不重做菜单。
- 审批服务端已有统一 façade 与多个 pending 记录能力；“单 pending”主要是 Desktop API/controller 的投影限制，应在共享 Desktop contract/API 返回数组后解决，不能在 Channel 层排队。

## 最终核对结论

- 用户列出的未完成项除 Permission Modes PRD 的旧状态外均属实；本切片已逐项补齐。
- Plan 接受后的控制指令只存在于当前 Runner 请求，不追加普通 user metadata，避免污染后续模型上下文。
- `style` 清洗继续保持严格；HTML/SVG 通过 `sandbox=""` iframe 预览，宽表通过 CSV Blob 复用 SpreadsheetTable。
- 长会话采用显式分页：默认只挂载最近 80 条，用户按需加载更早记录，保留现有滚动所有权模型。

---

# Automatic Durable Execution 发现记录

## 当前假设

- 用户已确认 PRD 完善，可以开始实现；本轮默认按 PRD 的验收口径执行，不另造需求。
- 当前任务覆盖真实产品代码，而非只输出评审意见；若发现安全边界、数据迁移或产品行为存在无法安全推断的选择，会在实施前停下确认。

## 待核对

- PRD 的目标、Must/Should 范围与明确验收条件。
- 既有 durable execution、watched events、scheduler、lease、队列、runner 和 session 持久化实现。
- `CHANGELOG.md`、`docs/archive/changelog-*.md` 与 `CLAUDE.md` 中的历史坑点。
- 现有测试命令、数据库注入方式和 UI/渠道冷启动验证约定。

## PRD 已确认的硬边界（2026-08-09）

- V1 是线性 Durable Execution 聚合，不是 DAG；Runtime Task 仍负责 todo/提醒/周期自动化，Runtime Event 只负责触发续跑。
- 唯一状态来源是同级专用 SQLite：`<dbDir>/durable-execution.sqlite`；计划、步骤、验收、side effect、evidence ref、decision、attempt 均为数据库记录，Markdown 只能是导出。
- 自动启用有两条路径：确定性信号立即创建；其他请求在首次非 `pure` 工具动作前惰性 preflight。副作用等级 `idempotent < queryable < non_idempotent` 各自最多一次判断，最高 3 次；首次更高等级必须重新判断。
- 必须先持久化目标、验收标准和首个安全步骤，再允许副作用动作；惰性升级要吸收本轮已执行前缀，已有回执写 completed，无回执写 uncertain，吸收失败不得降级继续。
- 任务状态明确区分 `planned/queued/running/verifying/waiting_for_user/waiting_for_approval/paused/recovery_required/partial/completed/failed/cancelled`；旧进程的 running step 恢复为 uncertain，`verifying` 恢复时重跑只读验证。
- side effect 必须 intent → 外部动作 → receipt；恢复只自动重试 pure/有效幂等动作，可查询动作先探针，不可判定的 non-idempotent 进入 waiting_for_user；跨 Run 使用新的 automation Agent Context 和结构化 briefing/evidence reader。
- task 级 token/attempt/生命周期预算、owner 并发上限、未终结任务上限都是产品行为；超预算进入 partial，超并发进入可见 queued，不产生隐形丢弃。
- 完成只能由共享 verifier 根据确定性 checker/有条件的 judge 判定；所有必需条件全通过才 completed，全部主观条件不能自动 completed，用户改写的 criterion 不能被后续计划覆盖。
- UI/Channel 必须从共享 projection 展示；decision/approval 必须呈现在来源 UI Session/Channel，而不是被列表过滤的隐藏 attempt session；文本渠道使用稳定短句柄和共享鉴权/版本/CAS/幂等动作。
- PRD 把真实 Chat API + 可重启临时服务作为主要验收 seam，但正文也要求在实现前确认该 seam；当前用户已明确“开始执行”，暂按该 seam 已获授权，若代码现状无法安全落地再单独报告。

## 历史前科关联

- `CLAUDE.md` pitfall 23/后续规则直接覆盖本 PRD 的 owner lease、启动恢复、排除当前 lease、skipped 行、状态投影、catch-up 窗口和日志不应杀进程等约束；实现必须复用既有模式而不是新造第二套 liveness。
- 既有 `recovery_required` 入站队列、automation session 过滤、跨渠道队列幂等、控制消息不落普通上下文、Watched Event JSON-only 规则均是本功能的边界条件。

## PRD 其余硬约束（2026-08-09）

- 桌面端必须是四个共享投影表面：会话内原地更新卡片、现有右侧 inspector 的第三种任务模式、会话列表上方“进行中”分组、顶栏徽章/系统通知；任务进度不是新消息，任务详情只有一个宿主，面板在切换会话时保持 workspace 状态。
- “静止必须解释”：等待、离线、补跑窗口、排队、重复审批、恢复不确定都要有明确原因/下一步/时间点；Settings 的 Runtime Task 列表与长任务列表分开。
- 渠道动作共享 `executionId + expectedVersion + actionId` 的一次性契约；交互卡片走两阶段更新，QQ/微信走稳定短句柄/命令，多个待决问题时不得猜测，Channel 不实现状态机。
- 需要新增共享 coordinator、fresh automation context/briefing/evidence reader、tool side-effect metadata、decision/approval 来源面板、verifier registry、预算/配额、运行时事件续跑与启动 reconcile；保留现有 Runner/Approval/Session/Memory/队列各自边界。
- 交付按端到端切片推进：确定性激活+任务卡/侧栏；pure 工具+惰性升级；一个副作用步骤+回执/任务面板/决策审批；重启恢复；验收验证；预算配额/queued/离线；剩余工具/渠道适配。
- 主验收必须证明外部世界状态与证据，不接受只匹配“done”、工具名或私有 helper；覆盖中途升级吸收、所有恢复窗口、重复副作用、验证重跑、证据权限/截断、保留策略、stale CAS、取消不重启、通知单一真相及普通对话成本回归。
- PRD 明确不做 DAG/并行依赖/补偿、离线外部 worker/OS scheduler、历史 Run 迁移、Mini App Todo 自动转化、全局协作与更广事件源；实现不得擅自扩大范围。

## 执行授权解释

- PRD 仍保留“待产品负责人确认/实现前确认 seam”文案；本轮用户作为产品负责人明确要求“可以开始执行”，因此以该消息作为确认，不再把它当成阻塞项。

## 现有实现初步地图

- 运行时已有 `src/lib/server/agent/core/{runner,runnerPool,turnOrchestrator}.ts`、`runtimeBudget.ts`、`runtimeNotices.ts`，可作为每个 bounded attempt 的执行底座。
- 事件与调度已有 `src/lib/server/agent/events.ts`、`eventsLeaseStore.ts`、`taskScheduler.ts` 及对应测试；必须沿用 watched-event JSON + runtime event 路径，不能另建 scheduler。
- Agent Context/session 已支持 automation origin、共享 automation archive、task session 过滤与 run detail/artifact 读取；这些是 fresh attempt context、session leakage 与 evidence reader 的现成 seam。
- Runtime Task 现有桌面 API 是 `src/routes/api/desktop/tasks/+server.ts`，对应 app/store/Settings 的执行历史；PRD 要求长任务与其分离，不能把 Durable Execution 混入 Runtime Task 列表。
- 桌面当前有 Automations workspace 和 Chat sidebar/右侧面板体系，但长任务的“进行中”分组/任务 inspector/顶栏徽章尚未从初步文件清单中发现；需要先确认共享 workspace 状态与右侧 panel host，再决定切片范围。
- 历史规则已多次强调：lease ownership 代表 liveness；automation session 必须在共享 query layer 过滤；停止不等于清空队列；控制提示不能写普通 session；跨渠道编排必须在 shared upper layer。

## 文档现状

- `prd.md` / `features.md` 是长期累积文档，直接 broad search 会被近期大量已交付条目淹没；后续只用精确 ID/标题定位，不做大范围重写。
- 本轮执行计划当前仍处于“现状勘察”；在完成目标文件、ADR、测试命令和数据层确认前不选择具体 schema/入口。

## P1/ADR 结论

- `prd.md` 的 P1-211 已标为“PRD ready for owner confirmation”，P1-210 bounded recovery 已交付；本轮只新增 P1-211，不重复实现 P1-210。
- ADR 0004 已接受 Durable Execution 的专用 `<dataDir>/db/durable-execution.sqlite`、数据库列承载状态机、库内 intent/receipt 原子性、跨存储引用 fail-soft、Markdown 只读导出和模型不得直写的决策。

## 运行时基础设施确认

- `storagePaths` 是新增专用 SQLite 路径的正式入口，`initDb()` 负责创建 `dbDir`；新增路径必须同步 required directory/存储测试，且不能写 Project 根目录。
- `config.databaseDir` 由数据目录边界逻辑解析，测试用 `NODE_TEST_CONTEXT`/显式禁用 live services 防止导入 runtime 启动真实渠道；durable store 应保持可注入并避免依赖整套 runtime。
- 现有 `desktopTasks.ts` 把 Runtime Task 的 event-file status 与 execution lease 投影分开，并明确 `skipped` 不是 attempt outcome；长任务不能复用这套类型，但应沿用“共享 projection 不读锁字段”的原则。
- 当前任务/自动化实现规模较大，前一次输出被截断；下一轮改为逐文件、逐段读取 `eventsLeaseStore.ts`、`events.ts`、`taskScheduler.ts`、`desktopTasks.ts` 与 `runtime.ts` 的初始化/导出部分。

## Lease/store 细节

- `EventExecutionLeaseStore` 当前默认写 `settings.sqlite`，有独立构造器可注入 `:memory:`；Durable Execution 不能沿用该库，必须新增自己的 store/文件。
- 既有 event lease 使用 `PROCESS_OWNER_ID`、`BEGIN IMMEDIATE`、active-slot 去重、`interrupted` 重取、runId 条件完成；这些是恢复/幂等的参考，但 Durable Execution 需要更丰富的 execution/attempt/step/decision 状态模型。
- 现有 skipped 行只是 dispatch bookkeeping，不能作为最新 outcome；这与 PRD 的单一真相要求一致。

## Events/scheduler 细节

- `EventsWatcher.start()` 先 `recoverStaleRunning()` 再读 watched-event JSON；旧进程 lease 按 owner 变 `interrupted`，事件文件再由 `resumeRecoveredLease()` 决定 catch-up/标记中断。Durable continuation 应挂在同一 shared scheduler 的内部 event 入口，不复制 watcher。
- `EventsWatcher` 已有 catch-up window、重复 slot 去重、lease/slot CAS 及“失败/中断不可静默留在 running”的守卫；Durable Execution 的 continuation payload 应只携带 execution id + expected version。
- `TaskScheduler` 在 `runtime.ts` 初始化后被启动，系统 owner event 和各 channel bot event 共用 watcher；Durable coordinator 需要接入 runtime 生命周期，但不能把长任务塞进 `TaskScheduler` 的 Runtime Task 数据/桌面 projection。

## API/UI 入口细节

- `/api/desktop/tasks` 是专门的 Runtime Task projection/action 路由，内部复用 Settings tasks handler、event lease store 和 automation transcript；Durable Execution 应有独立 API/contract，不能把 action union 或状态类型污染到 Runtime Task。
- Desktop shared contracts 位于 `src/lib/shared/desktop.ts`，当前右侧 inspector 在 `ChatView.svelte` 以 `ChatInspector`/artifact 模式管理；长任务 inspector 需要进入同一 host，不能另加并列 aside。
- 现有 Desktop API 以 `endpoint` + JSON request helper 为主；后续可新增 `loadDurableExecutions`/action helper，但要保持 no-store、版本/CAS 错误可见和不暴露绝对路径。

## Desktop host 细节

- 任务专用类型目前在 shared desktop contract 的 415–552 行；可以新增平行 `DesktopDurableExecution*` 类型，保持 Runtime Task union 不变。
- `ChatView.svelte` 的当前 `ChatInspector` 只有 `artifact` kind，`artifactPanelVisible`、`inspectorVisible` 和 `ArtifactPanel` 是唯一右侧 host；任务模式应扩展该 host 的 union/props，不能新增第二个 panel。
- `ChatSidebar.svelte` 在 nav 后、conversation tree 前已有可插入的共享 section；长任务“进行中”分组应作为独立组件/props 进入这里，不要混入 `ChannelAccordion` 的会话列表数据。

## 第一刀已落地

- 新 store 使用一个库内聚合和事务写入；计划、步骤、验收、side effect、evidence、decision、attempt 都不依赖 Project 文件或 Runtime Task JSON。
- `short_handle` 是 owner 作用域内稳定的 `#N`，只用于定位；后续共享 coordinator 仍必须按 owner/Bot/版本做鉴权和 CAS。
- 当前 store 已将所有状态机字段建为列，并提供显式 transition/lease/conflict 错误；后续需要补 task-level queue/concurrency、plan revision、verifier、continuation 与 Runner activation。

## Store 校验

- `npx tsc --noEmit` 全仓仍被既存依赖/类型错误阻塞，但过滤新增路径 `src/lib/server/agent/durable` 与 `storage.ts` 后无错误。
- `git diff --check` 通过；下一步用临时 SQLite 测试真实执行事务，不把全仓类型失败误判为本切片通过。

## Runner/调度接缝确认（2026-08-09）

- `MomRunner.run()` 已支持 `isEvent + sessionMode: "fresh"` 的空上下文自动化 attempt，以及 `contextRunId` 的共享自动化 archive 恢复；Durable Execution 应通过该 seam 创建 fresh attempt，不应把临时控制提示追加为普通 Session 消息。
- `TaskScheduler` 只认 watched event JSON；`EventsWatcher` 已负责 lease、catch-up、超时和 stale recovery。Durable continuation 的事件文件应只持有 `executionId + expectedVersion` 等触发所需最小 payload，真正状态仍从专用 SQLite 读取。
- Web Chat API 当前没有 Durable 字段，显式创建可先走独立 `/api/desktop/durable-executions`；把普通聊天正文自动解释成长任务需要单独的确定性 parser/激活策略，不能在 runner 内做每轮模型分类。
- Durable store 当前的动作回执是“状态变更后再写 receipt”，存在进程在两步之间退出时的 crash window；交付前需把 actionId 与状态变更放进同一 SQLite 事务，或为每类共享动作提供原子内部实现。

## 2026-08-09 — 当前切片完成边界

- side-effect boundary 已下沉到共享 ToolRuntime，而不是 Channel；intent/receipt 写入由 Durable runtime 以版本 CAS 串行化，外部 handler 不被数据库锁包住。handler 后的 receipt 写入失败会进入 `recovery_required`，不会假装成功。
- 任务级预算采用累计 Run usage；Runner 现在汇总一个 Run 内所有 Provider 响应，Durable verifier lease 明确不计入 Agent attempt 配额。过期 lease 不再永久占用 owner 并发槽位。
- 队列事件只唤醒同一 owner 最早的 queued execution，verifying 优先；control action 仍通过共享 action receipt 幂等。`continue_work` 生成新 plan version，避免终态旧计划自循环。
- `DurablePreflightTracker` 现在按副作用等级限次触发结构化模型 preflight；升级路径由 coordinator 吸收普通 Run 的已执行前缀、证据和回执，并在 handler 前返回 pi agent 可识别的终止标记。仍待的是可重启 Chat API 的 live 验收，以及 queryable/evidence/approval/channel 等更高层能力。
- Durable continuation 现在使用 one-shot watched event 的共享 catch-up window；事件超窗被跳过时，runtime 通过最小内部 payload 将 `planned/queued` execution 转为 `recovery_required`，不会重放未知副作用。临时目录回归已覆盖，服务重启后的 live acceptance 仍待补齐。

## 2026-08-10 — 高风险边界收口

- Queryable 恢复的安全默认是“没有探针就不猜”：探针缺失、失败或返回 `unknown` 都只创建 recovery decision；只有明确的 `completed` 才补 receipt 并进入 verification，明确的 `not_found` 才重新排队。
- 证据读取器同时服务 Desktop inspector 和 Durable attempt，但两者都经过同一个 `readDurableEvidence` 边界。它只接受当前 execution 的 evidence id，按 attempt/run/source chat/Project/Session 校验，run-detail 有 24KB 上限并持续标记为不可信；不可用目标返回可见状态，不让执行误失败。
- 隐藏 automation Session 不能承载唯一审批入口。审批请求先写 Durable SQLite，再通过来源 Channel 的 `sendInternalNotice` 和共享 `/durable` command service 暴露；命令解析先按 owner/Bot/channel/sourceChat 筛选，再进行版本化共享动作，避免猜 handle 越权。
- `durableEvidence` 只在 Durable attempt 的 ToolRuntime 中加载，避免给普通对话增加工具说明和调用面；其输出显式写入 `[UNTRUSTED EVIDENCE]`，不允许外部证据改变系统控制语义。
- 真实进程冒烟已验证专用 Durable SQLite 的重启恢复边界：临时 `DATA_DIR` 内先写入 running attempt，服务停止后用同一目录启动第二个进程，启动 reconcile 将其标为 `recovery_required`，原 attempt 为 `interrupted`。这条记录只覆盖直接持久化/启动恢复；下方已补充真实 Chat API seam，仍不替代跨渠道冷启动验收。

## 2026-08-10 — Web virtual profile routing seam

- 根因：`/api/chat`/`/api/stream` 把 Web 请求的 profile id 直接作为 Durable `botId`，但 Web profile 可以是虚拟 id，`channelManagers` 只含已启用的具体实例；任务入队后才在 runtime manager lookup 失败。
- 修法：在 Web identity 共享层把请求 id 解析为同名 manager、`default` 或首个已启用 manager，创建 Durable 聚合时保存解析后的 id；这保持了 manager 查找的单一共享路径，没有在 Durable runtime 里添加按面板特判。
- 机器守卫：identity 路由 3 项单测覆盖精确命中、默认/首个 manager 和无 manager；真实临时服务测试使用 `profileId=personal`，验证 provider 请求、同库重启、`recovery_required` 和 `interrupted`。

## 2026-08-12 — D2 服务端渲染与 CJK 表格乱码

- 根因：Markdown 表格弹出预览把 DOM 序列化出的 UTF-8 CSV 放进 `Blob`，随后交给 SheetJS 的 `type: "array"` 二进制工作簿解析器；中文字节被按 Latin-1 解释，形成 `å§...` 乱码。表格本身的 Markdown 渲染没有乱码。
- 修法：聊天表格直接复用 `CsvTable` 的 UTF-8 文本解析，保留原始 CSV/源码切换；没有给二进制工作簿解析器增加编码猜测或兼容层。
- D2 采用共享 fenced-block 分流：Chat、Project Chat 和 Markdown artifact 共用 `D2Diagram`，由 Desktop 服务端请求 Kroki 的 `/d2/svg`，限制源码/输出、超时并在客户端以 `<img>` 展示安全 SVG；服务失败只显示源码。
- 证据：中文 CSV 与 D2 parser 21/21，D2 route + Desktop API 91/91，Desktop UI guard 203/203，`svelte-check` 0 错误/0 警告；Kroki 实测 HTTP 200 / `image/svg+xml`；Desktop 与 root production build、`git diff --check` 通过。

## 2026-08-10 — Runner helper 类型回归

- 复现时只有 `runnerHelpers.test.ts` 的两个 fixture 报 `tags` / `supportedRoles` 为 `string[]`；production `mapUnsupportedDeveloperRole` 没有行为回归。根因是对象字面量缺少 `RuntimeSettings` 上下文，数组元素因此被宽化。
- 最小修法是让两个 fixture 使用 `typeof defaultRuntimeSettings` 类型上下文。这样保留现有默认值与 literal union 校验，不增加生产分支或类型断言。
- 守卫已验证：测试 5/5、Desktop UI guard 183/183、该文件从全仓 `tsc` 诊断中消失。剩余全仓类型错误分布在其它旧有 UI/server/test 路径，属于独立基线，不在本修复范围内。
