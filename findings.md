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
