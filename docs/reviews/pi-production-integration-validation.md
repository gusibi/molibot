# Pi 生产执行接线验证（2026-10-04）

## 实际实现

正式共享 Runner 使用 PiRunSession、原生 Harness 和私有 SQLite。旧根 Agent 模型循环和内部 createAgentSession 子任务循环已移除。Molibot 保留业务编排、计划验收、队列、权限、审批、保留策略和来源授权；Pi 管理原生 generation、ToolTask、child conversation 和已提交收据。

外部 Broker、Host Bash 和 Web 审批处理器只写决定并唤醒原 run/budget/actor。它们不执行命令、不改写 canonical 工具收据、不新增普通用户输入。恢复固定原模型目录与端点，重新解析当前凭据；权限只能保留或收紧。源消息使用原生 entry 身份幂等投影，模型和工具预算使用稳定原生 task 身份。

内部子 Agent 由原生父 ToolTask 创建并拥有，保留角色、共享工具授权、绝对 deadline、取消、fallback、进度、公开 transcript 设置与父子预算。子任务只选择自身扩展，避免根提示词、预算和压缩 hook 重复参与。子压缩计入原生 usage 与预算，并通过原生累计用量增量生成不可变业务收据；收据与投影水位在同一原生事务提交，重开后按稳定身份去重。Codemode 的 nested 调用同样由原生 owned task 管理；参数和调用身份改变会拒绝复用。

Deferred 的原 handle 留在 Pi 私有库；业务 admission 元数据不保存凭据。启动先保留候选 owner，再检查原生 poll checkpoint，覆盖 handle 已提交而显示等待标记尚未投影的强杀窗口。恢复只查询原 handle。无 handle 或损坏 checkpoint 不自动重提；原 Room 通过 RoomService 重查成员权限，失败释放 writer。项目原生执行身份与原 Bot 发送目标分别保存。恢复保留项目工作区，并按原渠道实例、Bot 工作区和聊天/topic 发送完成答案。Stop 终态优先。取消不受支持或失败有结构化诊断与面向用户的说明。

## 验证边界

真实 Runner 子进程在 Deferred 等待和 native poll 已提交但外部标记未写入两个窗口被 SIGKILL。同临时数据目录重开后，独立 ledger 显示一次提交、两次原 handle 查询；完成 usage 与答案不重复。终态 Stop 不恢复。全部使用本地 fixture，无付费请求。

关联测试覆盖审批重开与已完成写操作不重放、混合审批批次、稳定投影、服务租约、Codemode、子任务失败预算、并行同 call ID、只读权限、fallback、压缩与 standalone skill drafter；Deferred 正常完成、Stop、过期、取消不支持和取消失败均不重提请求。Room 撤销成员拒绝恢复，损坏/缺失 checkpoint 释放 writer，晚到检查不覆盖取消终态。

Pi SDK 会记录部分 hook 异常后继续调度，因此预算/租约/期限拒绝在共享 hook 边界停止原执行并阻止请求，而不是只抛异常。工具结果预算耗尽仍保留已取得的真实收据，在下一模型请求前阻断。回归测试覆盖这些根因，无调用方临时 gating。

最新检查结果见下方最终验证记录。代码审查由独立只读 agent 核对执行所有权、权限、预算、子扩展和启动接线；未发现该范围内新的执行或安全阻塞。

## 最终验证记录

- 全量测试：2404 项，2399 通过、4 失败、1 跳过。失败分别涉及 Python tooling 默认目录、Mini App candidate 验证进程退出、Desktop 审批 session 筛选、Desktop MCP 页面静态断言，均在本次 Pi 改动范围之外。日志：`/tmp/molibot-pi-completion-full-suite.log`。
- 最后恢复回归：12/12，包含 Telegram topic、Telegram/Feishu 项目绑定、强杀窗口与原发送目标；日志：`/tmp/molibot-pi-topic-final-tests.log`。
- 仅导出暂存文件的隔离快照核心回归：53/53，覆盖内核、原生会话、生产 Runner 子用量和强杀恢复；日志：`/tmp/molibot-pi-index-tests.log`。
- 子任务用量回归：50/50；Room 恢复回归：22/22。生产 Runner 的子生成与压缩产生实际用量记录，重开不重复记录或发起请求。
- 最终工作区类型检查和生产构建通过；仅导出本次暂存文件的隔离快照也构建通过。隔离快照的单独 TypeScript 检查未通过，仍有 vendored 声明、Svelte 导出及旧测试类型错误；工作区中已有但不属于本次提交的类型修正未一并提交。日志：`/tmp/molibot-pi-index-check.log`。构建日志：`/tmp/molibot-pi-final-build.log`、`/tmp/molibot-pi-index-build.log`。独立审查确认此前发现的 Deferred 提交窗口、Room 授权/writer、预算、用量去重和项目渠道身份问题均已关闭。

## 尚未验证

真实外部渠道 transport、外部 Provider Deferred 协议和付费请求未执行。隔离内核/Runner、渠道契约和构建结果不代替这些验收。完整产品验收矩阵仍保留“部分交付”，不将正式代码接线等同于 spec 所有阶段验收完成。已有图片能力的付费 Provider 验收也不属于本次执行验证。
