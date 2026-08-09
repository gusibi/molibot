# Automatic Durable Execution 执行计划

## 目标

按照 `docs/requirements/automatic-durable-execution-prd.md` 实现可持久化、可恢复、可观测的自动 durable execution，并保持跨渠道能力在共享上层，最后完成针对性测试与全量验证。

## 阶段

- [completed] 1. 需求与现状勘察
  - 验证：读完 PRD、相关设计/历史记录，定位现有事件、调度、队列、lease、runner 与持久化入口。
- [completed] 2. 设计边界与最小纵向切片
  - 验证：形成数据模型、状态机、恢复/幂等不变量和受影响文件清单。
  - 当前切片：确定性创建 + 专用 SQLite + shared coordinator actions + Desktop list/detail/inspector entry。
- [completed] 3. 实现持久化执行主链路
  - 验证：专用 SQLite、版本 CAS/lease、步骤/证据/decision、副作用 intent/receipt、共享 verifier、任务级预算与续跑事件的临时库回归通过；工具边界与 Runner 累计 usage 已接入。
  - 结果：Durable Execution 通过 watched event JSON 与共享 runtime internal-event 接缝运行，Channel 仍只负责消息/平台适配。
- [in_progress] 4. 接入运行时恢复、调度与用户可见状态
  - 已完成：启动 reconcile、fresh automation attempt、队列位置/创建顺序、暂停/恢复/取消/继续决策、Desktop 卡片/单一 inspector/侧栏/通知反馈。
- 已完成：真实模型 lazy promotion、按副作用等级限次 preflight、普通 Run 前缀吸收和当前副作用 handler 前的安全交接；离线 catch-up 的事件窗口与 `recovery_required` 状态 seam 也已完成。
- 待完成：queryable 外部探针、证据读取器、approval/source-channel 投影和 live restart acceptance。
- 验证：定向 Durable/tool 回归 42/42；Runner + Durable 回归 49/49；Desktop `svelte-check` 与生产构建通过，UI guard 仅剩既有 `RunActivity` 断言不匹配。
- [completed] 5. 文档与版本交付同步
  - 已同步 `docs/requirements/automatic-durable-execution-prd.md`、`features.md`、`prd.md`、`CHANGELOG.md`、`readme.md`、`readme.zh-CN.md`，并明确已交付与待验收边界。

## 成功标准

1. PRD 中的 Must/验收条件都有对应实现或明确的阻塞说明。
2. 自动执行只通过 watched event JSON 与运行时事件系统落地，不绕过共享运行时写 OS scheduler。
3. 执行、恢复、重试、停止、完成、失败、取消具有幂等行为，不产生重复 terminal 队列行或并发自动运行。
4. 运行时控制信息、用户通知、排障记录彼此分离，不污染模型持久化上下文。
5. 持久化测试只使用临时数据库或可注入 store，不触碰真实用户数据。

## 错误记录

| 错误 | 尝试 | 解决 |
|---|---:|---|
| 首次读取技能文件使用了错误路径 | 1 | 改用当前技能目录中的实际路径，未影响代码执行 |
| 发现记录追加补丁上下文不匹配 | 1 | 先读取文件末尾确认现状，再用精确上下文重试；未改动源码 |
| 追加 Events/scheduler 记录时重复使用已存在的上下文 | 1 | 读取发现记录尾部确认记录其实已存在，停止重复写入 |
| 首轮全仓 `tsc --noEmit` 失败 | 1 | 识别为既存依赖/类型错误加 7 处新增 store 类型错误；仅修新增错误，保留既存失败项并用局部测试验证 |
| store 测试从入口导入错误类失败 | 1 | 从 `store.ts` 重新导出领域错误类，保留类型定义单一来源 |
| store round-trip 测试假定同一时间戳的 criterion 排序 | 1 | 按 criterion 描述定位记录，避免依赖 SQLite 对同时间行的隐含顺序 |
| Desktop 守卫测试仍断言单一 Artifact inspector 可见性 | 1 | 将断言更新为同一 inspector host 下的 Artifact/Durable 两种模式，保留单 host/单 resizer 约束 |
