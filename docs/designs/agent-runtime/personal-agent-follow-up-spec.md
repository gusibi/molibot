# Personal Agent Phase One 实施 Spec：看板任务的跟进运行模式

> 版本：v0.2 · 2026-11-19
>
> 状态：owner 已批准方向与排期（2026-11-19），按第 9 节 slice 顺序实施。
>
> 产品依据：[授权事项的持续跟进与交付 PRD](../../requirements/proactive-assistant-v1-spec.md)。产品目标与阶段范围由 PRD 管理，本文负责实现契约。概念边界见 [ADR 0009](../../adr/0009-time-triggers-and-tasks.md)。
>
> 当前实现状态：[能力矩阵](../../requirements/personal-assistant-capability-matrix.md)。本文出现的新列、表、接口均为拟新增。

## 1. 范围与完成定义

Phase One 交付一个内部项目事项的完整闭环：对话或看板委托 → 持久授权 → 按约定检查指定 Plan／执行结果与文本文件 → 准备可查看的下一步材料 → 单一授权目标通知 → 用户更新状态 → 停止或继续。

首个验收场景：指定项目中的方案交付，检查关联 Plan 和指定 Markdown/TXT 草稿，识别明确列出的必需章节是否缺失，生成独立缺口清单或草稿，并在约定时间核对进度。纯定时催促不能代替材料准备验收。

不包含：任意文件格式提取、扫描全部项目、外部日历/邮件、改写原文件或 Plan、隐式偏好学习、每日汇总、长期 Goal 与大型自治执行。

## 2. 设计裁定

**跟进事项是一种看板任务，以 `mode: follow_up` 运行。** 它复用看板任务的聚合身份、版本 CAS、租约、持久化唤醒、审批挂起、证据、回执、可见会话与看板投影；单 Agent 是 Phase One 唯一执行形态。

不另建跟进域数据库、检查租约或调度循环。另建一套会产生第三个“任务”概念、第二个唤醒真相来源和第二套审批/预算语义，与 [ADR 0009](../../adr/0009-time-triggers-and-tasks.md) 冲突。

普通看板任务（`mode: execute`）的行为不变。

## 3. 与执行模式的差异

| 方面 | `execute`（现有） | `follow_up`（本文） |
| --- | --- | --- |
| 目标 | 做完一件事 | 在授权期内持续观察一件事并在需要时帮忙 |
| 下次运行 | 回执 `continue` / `verifyAt` | 回执 `verifyAt` 设定下次检查；创建时写入固定核对 |
| 无有效回执 | 协议异常，等待用户 | 记 `analysis_failed`，按约定排下次检查；固定核对仍兑现，不停摆等待用户 |
| 运行前 | 直接派发 | 先做确定性闸门与来源指纹比对，无变化且非固定核对时不调模型 |
| 工具 | 按审批策略的完整工具集 | 只读来源工具 + 写入本任务私有派生目录；外部写操作不可用 |
| Project 推进位 | 持有至 Done／已取消 | **不获取**；跟进是只读的，不能占住同 Project 的执行队列数天 |
| 预算 | 累计预算 + 单轮 `RunBudget` | 两者照旧，另加每次检查硬上限（第 6 节） |
| 完成 | 执行者申请 + 自动验收／人工验收 | 只能由用户确认或约定的确定性完成证明；执行者只能建议完成 |
| 终止 | Done／已取消 | 另有授权到期，投影为已取消并带 `close_reason: expired` |
| 会话 | 每轮实时写入可见任务会话 | 只有 `notify` 结论以短消息写入任务会话；`silent` 检查只留结构化运行事件，不污染会话 |
| 通知 | 无渠道通知 | Desktop 通知中心 + 一个用户明确选择的私聊渠道（第 7 节） |

## 4. 领域契约

### 4.1 委托

```ts
type FollowUpLifecycle = 'active' | 'paused' | 'completed' | 'cancelled' | 'expired';
type MissingEvidencePolicy = 'wait' | 'ask_at_check' | 'notify_unavailable';
type ObservationStatus = 'available' | 'unchanged' | 'unavailable' | 'revoked';
type CheckDecision = 'silent' | 'notify';
type SourceRef =
  | { kind: 'plan'; planId: string }
  | { kind: 'execution'; executionId: string }
  | { kind: 'project_file'; relativePath: string };
```

`FollowUpLifecycle` 是从执行状态派生的投影，不是第二个状态机：`active` = 执行未终结且未暂停；`paused` = 执行 `paused`；`completed` = `completed`；`cancelled` / `expired` = `cancelled` 加 `close_reason`。

创建输入：标题、预期结果、用户确认的完成标准、来源清单、允许的帮助（清单／独立草稿）、检查周期或下一次检查、可选固定核对时间、来源不可用策略、有效期、IANA 时区、明确选择的通知目标。时间存 UTC，展示与每日额度按事项时区；模糊日期先澄清。

每个事项属于稳定的 `ownerId + agentId + projectId`。`sourceSessionId / sourceMessageId` 只用于授权追溯，不授予读取整个 Session 的权限。

创建带 `requestId`：重放相同请求返回原任务；同 `requestId` 不同 payload 返回冲突；幂等窗口 30 天。标题相同的两个独立指令不擅自合并，返回已有的相似事项供用户选择。

### 4.2 授权与版本

- 委托保存 `authorizedAt`、可信入站来源、授权摘要、来源白名单、允许帮助和 `authorizationRevision`。不信任模型传入的“已授权”；共享服务只接受绑定可信用户指令或已确认快照的创建。
- 变更来源、帮助范围、通知目标或有效期需要新的明确授权，并递增 `authorizationRevision`；延后、暂停、恢复只递增执行 `version`。
- 检查开始时捕获执行版本、授权版本、策略版本；提交结论、写派生产物、投递和展示材料前重新校验。撤权后旧快照不能继续发布。

### 4.3 观察、结论与派生产物

- 观察记录来源键、读取时间、内容 hash、状态与结构化错误码；“无新 hash”与“读取失败”不能混用。来源状态与错误码参与证据指纹，读取恢复后可产生新的有效结论。
- 同一 `(execution, authorizationRevision, triggerSlot)` 只有一个有效结论；同一证据指纹不重复产生条件性建议。
- 派生产物写入本任务私有目录，记录相对路径、hash、证据引用和授权版本；不写原项目文件，不进入可绕过权限的公共 Artifact 链接。
- Plan / execution 被删除时返回来源不可用，不崩溃，也不判定事项失败。

### 4.4 回执扩展

`KanbanReceiptActions` 增加两项，仅在 `follow_up` 模式下接受：

```ts
decision?: CheckDecision;
notify?: { text: string; artifactIds?: string[] };
```

`decision: notify` 必须带 `notify.text` 和至少一个真实观察引用；`decision` 缺失视为无有效回执。投递去重键由运行时根据 `executionId + authorizationRevision + triggerSlot` 生成，不由模型提供。

## 5. 持久化

存储在现有 `db/durable-execution.sqlite` 内做加法升级，遵循 [ADR 0004](../../adr/0004-per-domain-databases-and-state-representation.md)；首次建表前沿用看板升级的一次性备份规则。

| 表 | 核心字段与约束 |
| --- | --- |
| `durable_kanban_tasks` 加列 | `mode`（`execute` 默认 / `follow_up`），`close_reason` |
| `durable_follow_ups` | 主键 `execution_id`；`authorization_revision`、`authorized_at`、`allowed_help`、`missing_evidence_policy`、`timezone`、`check_interval`、`fixed_checkins`（JSON，UTC）、`expires_at`、通知目标列、`request_id` 唯一（按 owner） |
| `durable_follow_up_sources` | `execution_id`、`kind`、`source_key`、`authorization_revision`；唯一 `(execution_id, kind, source_key)` |
| `durable_follow_up_observations` | `execution_id`、`trigger_slot`、`source_key`、`status`、`content_hash`、`error_code`、`read_at`；按 `(execution_id, source_key)` 取最新 |
| `durable_follow_up_decisions` | 唯一 `(execution_id, authorization_revision, trigger_slot)`；`decision`、`reason_code`、`evidence_fingerprint`、`policy_version`、成本、产物引用 |
| `durable_follow_up_deliveries` | 告知账本：`delivery_key` 唯一、`execution_id`、`decision_id`、目标、`status`（`reserved / sending / sent / unknown / failed / cancelled`）、`not_before`、`expires_at`、外部回执 |

- 下次检查、固定核对与到期都写成持久化唤醒（`verify` 原因，到期用新增 `expire` 原因），与状态变更同事务提交；不写 watched JSON，不建跟进专用 worker。
- 每日额度与冷却在同一事务中读取并预占 `durable_follow_up_deliveries`：`reserved / sending / sent / unknown` 占用额度，明确失败或取消释放；固定核对单独计数，不占条件性建议额度。
- 删除沿用看板删除墓碑语义，并在同一事务内失效授权、取消未发送投递、删除产物元数据，随后清理派生文件；已发到渠道的消息不声称可收回。

## 6. 检查流水线

由 `verify` 唤醒进入 `execute()` 的看板分支，`mode: follow_up` 时按序执行：

1. **闸门**：功能开关、owner、执行状态、授权版本、有效期、触发槽位；陈旧唤醒 no-op。已过期则在同一事务置为 `expired` 并结束。
2. **抑制**：条件性检查若命中冷却、额度或安静时段，排具体的未来唤醒，不把检查标为完成后丢弃。固定核对独立判定。
3. **取证**：最多 1 个 Plan、1 个关联执行结果、3 个 UTF-8 文本文件，各文件最多 64 KiB；超限或二进制标为不可用，截断正文不能用来“确认缺少某章节”。写入观察记录。
4. **短路**：证据指纹未变且不是固定核对 → 写 `silent` 结论、排下次检查，**不调模型**。来源缺失按 `missing_evidence_policy` 处理。
5. **分析**：派发一轮受限执行。总输入不超过 8k tokens，输出不超过 4k tokens，只注册只读来源工具、派生产物写入工具和回执工具。
6. **校验与提交**：校验观察引用存在、授权未变、未越权判定完成；产物先写临时文件，元数据提交后才可见。结论、投递意图与下次唤醒在同一事务提交。
7. **失败兜底**：超时、无有效回执或结构无效时记 `analysis_failed`，按约定排下次检查。固定核对用结构化委托生成确定性消息“按约定核对；本次未能核实进展”。

## 7. 通知与投递

- **Desktop**：写入首页通知中心，复用 `home_notifications` 的去重键与已读状态，新增“跟进”类型。
- **私聊渠道**：Phase One 只接一个用户明确选择的私聊目标，经共享投递层发送；渠道只负责渲染与发送，跟进条件不进渠道代码。
- **共享投递契约**（S0，独立于跟进，所有主动通知受益）：
  - `SqliteOutbox` 支持调用方稳定键，唯一 `(channel, instance_id, delivery_key)`，重复入队返回已有记录；
  - 有效期 `expires_at`，过期不发；
  - 发送前业务闸门回调，拒绝已取消、已撤权或已过期的意图；
  - 区分可重试与永久失败，退避有次数上限，永久失败后 reject 调用方；
  - 保留回执行至少覆盖幂等窗口，不在成功时立即删除；
  - Telegram 主动通知接入同一投递层。
- 发送前闸门是撤权竞态的线性化点：闸门之前撤权则禁止发送；越过闸门后崩溃或网络不确定记为 `unknown`。投递语义是 at-least-once，不承诺 exactly-once。
- 外发消息只含事项标题、简短结论和材料入口；完整材料经鉴权页面读取。

## 8. 接口

- **服务**：在 `PlanService` 的看板方法上扩展 `createFollowUp`，以及 `snooze` / `complete` / `updateAuthorization`；暂停、恢复、取消、删除沿用 `runControlAction`。owner 与 actor 来自可信运行上下文。
- **HTTP**：沿用 `/api/desktop/plans`，新增 `create-follow-up`、`snooze-follow-up`、`complete-follow-up`、`update-follow-up` 动作；写操作带 `expectedVersion` 与操作 ID，沿用 SSE 推送。
- **Agent 工具**：对话委托走一个 `followUp` 工具（create / list / get / control），只在可信用户指令上下文中允许 create；检查轮只能用回执工具，不能调用 `followUp`。
- **渠道动作**：按钮绑定 `executionId + expectedVersion + actor + 过期时间`；陈旧按钮返回“状态已变化，请查看最新事项”，不重放旧动作。文本“延后”出现歧义时先澄清。
- **看板投影**：跟进任务在 Doing 列，子状态为“跟进中 · 下次检查 X”或“已暂停”；卡片带“跟进”标记。详情右侧面板展示委托范围、来源状态、最新结论、告知记录、下次检查与有效期。
- **设置**：主动模式开关、安静时段、每日条件性建议上限、同事项冷却。新字段遵循整对象 save → 新建 store → load 回归。PRD 5.1 的默认值作为实现默认值。

## 9. 实施 slice

| Slice | 可演示交付 | 直接相关验证 |
| --- | --- | --- |
| S0 共享投递契约 | 第 7 节共享投递契约全部条目；Telegram 接入 | 重复键只发一次、过期不发、闸门拒绝、永久失败上抛、退避上限、回执保留、重启续发 |
| S1 最小闭环 | 对话委托 → 跟进任务 → `verify` 唤醒 → 单文件观察 → 指纹短路 → 受限分析 → `silent / notify` → Desktop 通知 → 完成／取消／到期 | 服务 + 真实 Durable 运行时 + 本地模拟模型；无变化不调模型、无回执不停摆、到期终止、不占推进位、重启恢复 |
| S2 真实证据与固定核对 | Plan／执行证据、派生缺口清单、固定核对与失败兜底提醒、来源不可用策略 | 来源不可读显示未知、提示注入、输出无效、模型失败仍发固定提醒 |
| S3 私聊渠道 | 选定的一个私聊渠道贯通通知、按钮与回执 | 幂等、闸门撤销、未知投递、陈旧/重启按钮；真实账号验收另行授权 |
| S4 收口 | 设置、详情面板、授权变更、删除、冷路径 | settings round-trip、撤权后产物不可读、主题／语言／窄窗、隔离实例冷启动走查 |

S0 不依赖产品决策，可以先行。所有 slice 完成才算 Phase One 交付；局部通过不提升能力矩阵状态。

## 10. 场景评测与故障守卫

以下场景同时作为 S1–S4 的验收用例：

- 来源无变化：不调模型、不发通知，有 `silent` 结论可查。
- 来源读取失败：结论为“无法判断”，不声称未完成。
- 固定核对遇到模型失败：仍发确定性提醒，并说明进展未核实。
- 等待审批或等待下次检查：不持有 runner、租约与 Project 推进位，同 Project 的执行任务可以继续。
- 用户取消后旧投递仍在队列：发送前闸门拒绝，账本状态为 `cancelled`。
- 发送后、记回执前进程终止：重启后状态为 `unknown`，不伪报“未发送”。
- 同 `requestId` 连点：只建一个任务；payload 不同返回冲突。
- 检查持有旧版本时用户暂停或改授权：旧结论无法提交。
- 两个唤醒同槽位并发：只有一个有效结论；额度并发预占不超额。
- 另一个 Session 讨论同一事项：读取同一委托与最新观察，不需要重新交代背景；跨 owner、Project、Agent、路径穿越与符号链接越界全部拒绝。
- 延后不删除事项；忽略消息不暂停；终态不再投递；关闭主动模式不影响用户独立的 Runtime Task。

新增测试使用临时数据库、隔离 `DATA_DIR`、本地模拟模型；先证明故障能使其失败，入集前连续 5 次通过。日常只跑 touched slice 的定向测试；全量 `pnpm verify:feature`、Playwright 与原生套件由用户在整体验收时执行。

## 11. 可观测与保留

- 结构化运行事件：创建／控制、观察结果、闸门拒绝、短路、`silent / notify / analysis_failed`、产物生成、投递状态。每条带 execution、trigger slot、decision、delivery ID 与授权版本；不回灌模型，不写入普通会话。
- 详情可回答“为什么检查、为什么没通知、下次何时、哪条投递不确定”。`silent` 不等于失败，生成材料不等于用户采用。
- 非内容运行记录保留 30 天；产物保留至删除或授权到期，到期后隐藏并在 7 天内清理；无内容幂等墓碑保留 30 天。

## 12. Phase Two / Three 边界

Phase Two 在现有 Memory/Profile 上增加带场景的偏好与可撤销行为规则，不把跟进任务扩成事实库；汇总与类别退订届时再扩展回执与投递 schema。

Phase Three 为 `SourceRef` 增加经评审的外部来源适配，撤权、时效与未知状态契约与内部来源一致；写操作仍交由 `execute` 模式的看板任务或既有审批链路，不在跟进模式内新增执行器。
