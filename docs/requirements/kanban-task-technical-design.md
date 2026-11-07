# 看板任务最小技术设计

> 2026-11-07。按 [任务看板与 Agent／Team 自主执行 Spec](autonomous-loop-and-trigger-sources-spec.md)「实施前」要求形成，只覆盖第一阶段。本文是实施设计，不是交付状态；能力矩阵才是唯一状态来源。术语沿用[领域词典](../reference/CONTEXT.md)（Kanban Task、Team Coordinator、Member Handoff）。

## 1. 聚合与存储：复用 Durable Execution 聚合，加法 schema

看板任务是 Durable Execution 的一种任务形态，不建第二套聚合。存储在现有 `db/durable-execution.sqlite` 内做加法升级（ADR 0004：一个聚合的表同库、状态机字段是真列、模型不直接写库）。

新增表（全部只增不改，旧计划零迁移）：

| 表 | 存什么 |
|---|---|
| `durable_kanban_tasks` | 每个看板任务一行，主键 = `execution_id`（1:1 复用聚合身份、版本 CAS、租约、唤醒、审批、证据）。列：`form`（`single`/`team`）、`title`、`goal`、`coordinator_agent_id`、`member_agent_ids`（JSON 快照）、`member_snapshot`（JSON：成员 name/modelKey/permissionMode 快照，防执行中途变化）、`project_id`、`work_dir`（规范化）、`completion_source`（`user`/`generated`/`pending`）、`budget_token_limit`、`budget_handoff_limit`（默认 8）、`approval_policy`（`deny`/`suspend`，默认 `suspend`）、`human_acceptance`、`auto_start`、`handoff_count`、`current_agent_id`（当前推进成员；单 Agent = 绑定 Agent）、`round_count`、`retry_count`、`next_retry_at`、`usage_gap_count`、`source_type`/`external_id`/`source_url`（第二阶段来源预留）、时间戳。 |
| `durable_kanban_receipts` | 回执：`receipt_id`、`execution_id`、`expected_version`、`round`、`actor_agent_id`、`actions`（JSON：结论/证据引用/交接/提问/预约复查/申请完成/清单变更）、去重唯一键 `(execution_id, round, actor_agent_id, dedup_key)`。同一回执身份冲突拒绝，重复提交只生效一次（CAS + 唯一键）。 |
| `durable_kanban_checklist` | 进度清单：`execution_id`、`item_id`、`text`、`done`、`sort_index`、`updated_round`。带版本（借 execution version CAS），重启可重建；全部勾选不等于完成。 |
| `durable_kanban_inputs` | 待消费用户输入：`input_id`、`execution_id`、`text`、`created_at`、`consumed_round`。回答与补充资料先落库，下一轮简报携带并标记消费，只消费一次。 |
| `durable_kanban_handoffs` | 交接流水：`execution_id`、`round`、`from_agent_id`、`to_agent_id`、`kind`（`assign`/`dispatch`/`return`）、`brief`、`created_at`。计数器 `handoff_count` 在同一事务更新。 |
| `durable_kanban_project_slots` | Project 推进位：`project_key`（project id 或规范化工作目录）为主键，列 `execution_id`、`acquired_at`。 |

完成条件**复用 `durable_acceptance_criteria`**（作者 `user`/`model`、必需位、checker 绑定、判定结果已具备），不新增第二套条件表。交接上限、预算上限的修改走修订语义。

## 2. 执行方式：复用 Durable attempt 路径 + 轮次结算分支

现有 `DurableExecutionRuntime.execute()`（`durable/runtime.ts`）按 step 驱动；看板任务无步骤，在 `execute()` 入口按 `durable_kanban_tasks.form` 分支到看板轮次路径，旧计划路径不动。

- **派发通道**：合成 `sourceChatId = "kanban:<executionId>"`、`sourceChannel = "web"`。现有按 chatId 的单飞锁让同一任务的所有轮次天然串行（含 Team 成员），不同任务不同 chatId 互不阻塞；事件执行已有的 `store.forAgent(agentId)`（按 Agent 隔离的运行时 store）+ `sessionMode: "fresh"` 任务归档会话实现"每任务每成员独立上下文、不进会话列表、不写 Room 会话"。
- **简报即输入**：每轮 `inbound.text` 由任务状态合成（目标、完成条件及判定状态、清单、已有成果与最近回执摘要、待消费用户输入、Team 时负责人的派发简报），属每轮动态内容，不进入缓存前缀；提示词合成沿用现有链路——成员轮次经 `inbound.agentId` 走该 Agent 的身份与规则，项目 `AGENTS.md/AGENT.md/CLAUDE.md` 由现有 `discoverProjectContext` 注入，无流程字段。
- **成员运行构造**：Team 成员轮次复用 Room 的成员构造语义（`roomSettings` 的成员模型路由合并、权限收敛取最严、`runtimeIdentity.agentId`），通过现有事件执行 `agentId` 入口生效，不依赖 Room 打开状态；每次派发前重验成员启用与权限（`eventStore` 已拒绝已删除 Agent）。
- **轮次结算**：attempt 结束后读最新有效回执决定下一状态，在聚合事务内提交（结算 + 预算 + 状态 + 推进位 + 下一次唤醒）后才派发：
  - `continue` → 排 `advance` 唤醒续轮；
  - `handoff(member, brief)` → 校验交接上限后更新 `current_agent_id`、写交接流水、排 `advance`；将超限时停止派发，置 `waiting_for_user`（原因：交接超限）；
  - `question` → 打开 decision（`waiting_for_user`），等待释放租约与连接，回答经 `durable_kanban_inputs` 回到原任务；
  - `verify_at(time)` → 排 `verify` 原因的持久化唤醒（复用现有唤醒队列，不写系统调度器）；
  - `request_completion` → 进入 `verifying` 走现有 `verify()`（确定性 checker + 证据；未填条件时先走条件生成轮，`completion_source: pending` 时无有效条件不开展实质工作）；
  - 无有效回执或格式错误 → 保留产物，标记协议异常（`waiting_for_user`，原因：协议异常），不重做业务。
- **回执工具**：新增任务作用域的结构化工具 `kanban_receipt`（与 `durableEvidence` 同样的按 attempt 注入方式），仅在看板 attempt 的 runner 上下文注册；提交即经运行时确定性校验后写 `durable_kanban_receipts`（绑定 execution、round、期望版本）。
- **审批**：完全复用现有挂起机制（attempt 以 `waiting_for_approval` 收尾并释放租约/连接，带外 `resolve_approval` 消费，`consumeDurableApproval` 续跑）。`approval_policy: deny` 时 `onApprovalRequest` 直接返回 deny（对齐无人值守自动化现有 `unattendedDenials` 语义），执行者找已授权替代方案；`suspend`（默认）即现有 defer 行为。拒绝结果由回执轮看到，不放宽权限。
- **暂停/恢复/取消/修订/删除**：沿用 `runControlAction` 现有语义与 actionId 幂等；拖入 Doing = 启动（同 start），拖入 Done 被拒绝。

## 3. Project 推进位事务边界

- 推进位行与任务状态变更**同库同事务**：启动/入队时以 `project_key` 为主键插入（冲突 = 已被占用 → 保持 `queued` 并记录占用者，等待前序任务的终结释放）；进入 `completed`/`cancelled` 的同一事务内删除推进位行，并按创建顺序为同 project_key 的下一个 `queued` 任务排 `capacity` 唤醒。
- 持有期覆盖执行、等待、暂停与失败停止；`waiting_for_user` 等等待态也持有推进位（同 Project 后续排队并显示被谁占用），由用户处理或取消前序任务放行。
- 推进位只约束看板任务之间，不约束旧计划（无 `durable_kanban_tasks` 行）与普通对话/Room 写入，不替代既有工作目录权限。

## 4. 预算与护栏

- **累计预算默认值（写入验收）**：`budget_token_limit` 缺省 2,000,000 tokens/任务，创建时可见可改；单轮限制沿用现有 runner `RunBudget`（`settings.budget`）。结算时 `usage.totalTokens` 缺失记入 `usage_gap_count`，有缺口时阻止自动续轮（转等待用户，说明统计缺口），不当零处理。预算耗尽 → `partial`，追加额度单独记账（`budget_topups` 流水入 kanban_tasks JSON 审计列）不清零，追加后从当前状态继续。
- **交接上限**：默认 8；首次分配（`assign`）与负责人纯调度轮不计；A→B 与 B→A 各加一。
- **安全重试**：仅未执行或幂等/可查询确认安全的临时故障自动退避重试，退避 60s 起、按 4 倍退避、最多 3 次，`retry_count`/`next_retry_at` 持久化，重启不重置；审批拒绝、成员不可用、超限、配置错误、结果不确定的副作用不重试；CR 返工是正常交接，不计故障重试。
- 三类计数分开持久化：`round_count`（执行轮次）、`handoff_count`（交接）、事件因果深度本版不开放。

## 5. 看板投影与 API

- **投影层**：`PlanService` 扩展看板方法（`createTask`/`startTask`/`boardList`/`answerTask`/`addBudget`/`acceptance`…），列表 = 看板任务（新表）∪ 旧计划（按原始 `execution.status` 直接映射，**不得**经过 `planStatus` 的 `completed → archived` 桶）；阶段（Todo/Doing/Done/已取消）与子状态均为派生投影，运行判断一律读真实执行状态。
- **API**：扩展现有 `/api/desktop/plans` 路由：GET 返回看板列投影 + 全集筛选计数（新增 `board=true` 模式与 `view=board` 详情字段：配置、清单、回执计数、成果、对话投影分页）；POST 新动作 `create-task`（含自动开始）、`start-task`、`answer-task`（补充资料/回答）、`add-budget`、`accept-task`/`reject-task`。写操作带 `expectedVersion` + 操作 ID，沿用现有 failure() 错误映射与 SSE 推送（快照 + changed）。
- **对话投影**：按 attempt 归档会话（`store.forAgent` + kanban chatId）读各成员轮次消息/工具活动，按时间合并并标注成员；用户输入不实时 steer，只作为待消费输入。

## 6. 备份与升级

- 首次建表前将 `durable-execution.sqlite` 复制为同目录 `durable-execution.sqlite.backup-<version>`（一次性、存在即跳过）；建表全部 `CREATE TABLE IF NOT EXISTS`，对旧库只增不写。
- 失败恢复：建表事务化；升级失败时旧库副本仍在，服务以旧 schema 报错可见，不静默半升级。

## 7. 测试接缝

按 Spec：主接缝 = 看板服务 + 真实 Durable 运行时 + 本地模拟模型（先例 `plans/service.test.ts`、`durable/runtime.test.ts`、`durable/wakeupWorker.test.ts`）；UI 接缝 = Desktop HTTP API + Playwright。全部临时库/隔离目录。第一版定向覆盖：创建/自动开始幂等与重启、同 Project 串行与并行、单 Agent 回执续轮与等待、Team 串行闭环与交接计数、预算/用量缺口/追加、审批挂起与释放、回执重复与崩溃窗口、协议异常、完成检查与人工验收、旧计划映射与推进位豁免。

## 8. 明确不做

不建第二套编排器或看板专用 worker（复用 `DurableWakeupWorker`）；不做 trigger 插件、流程编辑器、多成员并行、实时 steer；渠道入口不参与。
