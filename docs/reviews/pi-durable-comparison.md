# Pi Durable 与 Molibot 的恢复执行对比

日期：2026-10-02。范围：Pi v1.0.0 官方源码与 Molibot 当前工作区；只做分析，不改执行逻辑。

## 结论

Pi Durable 在工具调用级 checkpoint、原子状态提交和持久子任务生命周期上更完整，有作为底层执行内核的替换价值。但它与 Molibot 不是功能等价的产品：目标、计划、审批、验收、跨渠道入口、预算和事件调度仍需 Molibot 的共享上层。当前不建议整体替换，也不建议仅因为 Pi 发布 1.0 就全面接入；Durable 包仍明确标为 Experimental。

建议先处理已复现的恢复安全缺口，再用隔离的真实任务验证底层替换收益。如果持久子 Agent、工具级续跑成为核心需求，Pi Durable 的采用价值会明显提高。

## 功能与边界

| 维度 | Molibot 当前实现 | Pi Durable v1.0.0 | 判断 |
| --- | --- | --- | --- |
| 恢复单位 | 计划步骤、执行 attempt；恢复后重新进入步骤的 Agent 执行 | 模型生成阶段、每次工具调用各自持久任务；复用已提交结果 | Pi 的恢复粒度更细 |
| 原子边界 | store 内状态、版本、审批和控制回执有事务；Agent transcript 与这些业务状态属于不同路径 | 工具调用消息与子任务创建一起提交；工具结果与 terminal task 一起提交 | Pi 更容易避免结果、任务状态错位 |
| 外部副作用 | 分类 pure/idempotent/queryable/non_idempotent；未知危险操作开人工恢复决策 | 保存调用参数与 replay 策略；中断后只有保存策略和当前策略都 safe 才重放 | Pi 的调用级守卫更细；Molibot 的人工决策更贴近产品 |
| 子任务 | 本次未完整审计房间和子 Agent 生命周期，不据此宣称不存在 | 持久 task graph、前后台所有权、等待、取消传播 | Pi 提供可复用的底层机制；不等于多人房间产品 |
| 取消 | Durable 状态控制有原子回执；本次未确认该路径完整联动正在运行的工具 | 持久 abortRequested 触发活动 invocation 的 AbortController，阻止后续任务提交 | Pi 的任务内取消协议更完整；工具仍须配合 |
| 模型中断 | 步骤重新进入可能产生新的模型请求 | 普通请求中断仍会重发；支持的 deferred handle 可保存并恢复轮询 | Pi 不保证中断后不重复计费 |
| 计划与验收 | 版本、证据、用户决策、预算、基础确定性检查和人工确认 | 主要提供执行持久化；业务验收规则需自建 | 保留 Molibot 产品层 |
| 跨渠道与定时 | 共享 runtime、API/命令入口、watched event JSON 调度 | 会话 inbox 和任务调度，不包含 Molibot 的渠道和定时产品约束 | 不能直接替换 |
| 多进程与成熟度 | 有 lease/CAS，但启动 reconciliation 会接管其他进程的活动记录，不宜认作分布式安全 | 明确单进程拥有存储，无跨进程锁；Experimental | Pi 在这两项没有直接替换优势 |

Molibot 的 Session 计划批准后仍通过普通 Session turn 执行，进度同步不等于启动 Durable runtime。因此不能把“计划面板已有记录”解释成所有长任务都已有工具级断点恢复。见 [Session 计划执行](../../src/lib/server/agent/plans/sessionIntegration.ts)。当前产品能力状态仍以 [能力矩阵](../requirements/personal-assistant-capability-matrix.md) 为准。

## 一个具体场景

任务包含“生成报告 → 发邮件 → 更新记录”。报告生成和邮件发送已经成功，更新记录时进程退出。

Pi 可以复用已提交的报告和邮件工具结果，只恢复尚未完成的工具任务。Molibot 如果这三件事属于同一个计划步骤，当前恢复主要重新进入整个步骤，缺少与模型工具回合联动的逐调用结果续接协议。

但如果邮件在外部发送成功、结果尚未提交就崩溃，两者都无法凭本地数据库知道是否已经发出。Pi 默认把 unsafe 中断调用作为 interrupted 错误返回，不自动重放；模型仍可能决定新发一次调用。最终安全仍需要供应商幂等键、外部状态查询或人工确认，不能宣称“恰好执行一次”。

## 本次发现的 Molibot 缺口

1. **恢复只检查同一步的最后一个 intent。** [prepareRecovery](../../src/lib/server/agent/durable/runtime.ts) 从后往前取一个 intent。如果前面有尚未确认的非幂等操作、后面是幂等操作，就会允许重新进入整个步骤。
2. **queryable 尚未在生产入口接入探测器。** 类型和恢复分支已存在，但 [runtime 装配](../../src/lib/server/app/runtime.ts) 没有传入 queryableProbes。当前会进入人工判断，不能算已实现自动外部状态对账。
3. **本地 idempotencyKey 不自动提供外部幂等性。** [分类实现](../../src/lib/server/agent/tools/sideEffectClassification.ts) 中对工具和参数的 hash 是识别键；除非工具向外部服务传递并使用，否则不能阻止重复外部操作。
4. **步骤结束和目标验收有区别。** Agent 正常 stop 会结束步骤；内置验收支持步骤完成、证据存在、无待决策等基础检查，其他条件需要验证器或用户确认，不能据此认为任意任务结果已自动验证。

第 1 项已通过临时 SQLite 状态复现：同一步记录 non_idempotent 和后续 idempotent 两个 intent，模拟进程死亡后恢复，实际重新调用 attempt，结果为 verifying、无人工决策。这证明恢复守卫有缺口；没有执行真实邮件操作，不能把它描述成已观察到邮件重复发送。该问题应优先处理，本次没有修改产品代码。

## 替换价值与成本

**不建议整体替换。** 会丢失大量既有产品语义，且没有必要。**值得评估只替换底层 Agent 执行内核。** 它可能减少 Molibot 自己维护模型/工具 checkpoint、结果续接和子任务恢复协议的成本。

这不是添加一个依赖就完成的升级：会涉及会话存储、Agent loop、inbox、工具适配、审批挂起、取消、子 Agent、prompt/compaction 和流式视图；既有 owner/channel/policy 快照也必须真实接入新执行路径。复杂度高，收益需用端到端样本证明。

当前优先级：

1. 修正逐操作恢复判断，避免最后一个安全 intent 掩盖前面的未知副作用；补充整类回归守卫。
2. 对最重要的外部操作明确幂等、状态查询和人工确认协议。
3. 用同一组隔离任务比较两套执行路径：已完成工具后崩溃、外部成功但未记账、子 Agent 中断恢复、审批期间重启、取消期间工具仍在运行。比较重复副作用、额外模型请求、恢复正确率和适配复杂度。
4. 若 Pi 明显降低维护成本，采用其执行内核并保留 Molibot 业务层；否则只采用其调用级恢复不变量，不自行重写一整套通用 Harness。

## 验证与限制

- 阅读双方源码和上游恢复测试，没有运行上游测试，也没有性能/成本基准。
- Molibot Durable 现有 47 个测试：主体 46 个通过；文件监听测试在沙箱内因 EMFILE 失败，隔离环境重跑 1 个通过。全部使用临时数据目录/数据库。
- 新边界复现只写临时脚本与临时数据库。
- 既有冷启动 eval 通过注入崩溃状态验证 reconciliation/API；它不能替代实际工具执行期间强杀和外部服务对账验证。上游真实 Bash 恢复测试也使用 close/reopen，不能当作 SIGKILL 证明。
- Pi SQLite WAL synchronous=NORMAL 对进程崩溃和整机断电的保证不同；不应笼统承诺所有最新写入永久不丢。
- 保留工作区已有未提交修改；本次仅新增本文。

## 官方证据（固定 v1.0.0）

- [工具回合原子创建与结果续接](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/generation.ts#L537)
- [工具 intent、重放策略与中断恢复](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/tool.ts#L85)
- [工具结果与任务完成的原子提交](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/tool.ts#L359)
- [取消触达活动 invocation](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/scheduler.ts#L368)
- [取消后拒绝运行时提交](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/scheduler.ts#L1199)
- [Deferred 模型任务 checkpoint](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/src/harness/generation.ts#L426)
- [工具恢复测试](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/test/harness-tools-recovery.test.ts#L109)
- [API 状态与存储限制](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/README.md)
