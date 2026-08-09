# Automatic Durable Execution 进度日志

## 2026-08-09

- 已读取 `planning-with-files` 与 `agent-runtime-debug-review` 技能规范。
- 已创建 `task_plan.md`、`findings.md`、`progress.md`。
- 下一步：读取 PRD、设计文档、历史修复记录和当前运行时实现。
- 已读 PRD 第 1–240 行：核心为专用 SQLite、线性状态机、确定性/惰性自动启用、side-effect 意图/回执、跨 attempt 新 Context、任务级预算与共享投影。
- 现有工作区已有用户改动；规划文件与当前 `HEAD` 一致，未覆盖其他用户内容。
- 已完整读取 PRD 第 1–478 行：明确四个桌面表面、共享动作契约、切片顺序、验收测试矩阵及 out-of-scope；产品负责人确认 seam 的原文由本轮用户消息覆盖。
- 已完成第一轮运行时文件地图：现有 Runner/RunnerPool、事件 lease/scheduler、automation Session archive/过滤、Runtime Task API 与桌面任务 store 可复用；尚未开始代码实现。
- 已建立 Durable Execution 领域词汇并更新 `CONTEXT.md`。
- 已新增 `durable/types.ts` 与 `durable/store.ts`，并在 `storagePaths` 注册专用 `durable-execution.sqlite`；覆盖初始计划/步骤/验收、版本 CAS、attempt lease、孤儿恢复、步骤状态、副作用 intent/receipt、evidence ref、decision 和短句柄。
- 下一步：先跑类型检查，补临时 SQLite 回归测试；若发现 schema/事务问题先修 store，再接 coordinator/API。
- 首轮全仓类型检查暴露 7 个新增 store 类型错误，已修复；新增路径局部过滤检查通过，`git diff --check` 通过。
## 2026-08-09 — Durable Execution 第一纵向切片验证

- `DurableExecutionCoordinator` 已补充临时 SQLite 回归：owner 隔离、projection、CAS 控制动作和 actionId 重放均通过。
- Desktop 181 项 UI/响应式守卫、`svelte-check` 以及 Durable store/coordinator 10 项测试均通过。
- UI 守卫原先只允许 Artifact inspector；已改为验证 Artifact 与 Durable 共用一个 inspector host，未增加第二右侧栏或第二 resizer。
- 下一步进入运行时主链路：创建/继续执行只生成 watched event JSON，由 owner internal event 触发共享 Durable coordinator；Channel 只承担既有消息适配。

## 2026-08-09 — Durable Execution 主链路收尾

- 已把工具 side-effect 分类接到共享 `ToolRuntime`：`pure` 不进入边界，`idempotent/queryable/non_idempotent` 在 handler 前写 intent、handler 后写 receipt；未声明工具按保守的非幂等处理，幂等键对完整输入做稳定序列化哈希。
- 已补任务级累计 token/attempt/lifetime 配额、未终结任务上限、创建顺序 queue position 和 verifier 不消耗 Agent attempt 配额；Runner 的 Run usage 现在累加所有模型响应，而不是只保留最后一条。
- 已补 `continue_work` 的用户动作：不会把已完成 plan 循环改回运行中，而是创建新的 user-authored plan version，并保留用户已确认的 criterion。
- 已接入 Desktop 现有 `FeedbackCoordinator`：等待用户/审批、恢复、partial、完成、失败和取消状态只通过共享反馈链触发终态通知，避免把进度刷成 transcript 消息。
- 验证：Durable/tool 定向回归 37/37；Runner + Durable 回归 49/49。已通过 `svelte-check` 0 错误/0 警告与生产构建；桌面 guard 仍有一个既有 dirty-worktree 的 `RunActivity` 断言不匹配。Durable one-shot continuation 已接入共享 catch-up window，超窗会进入 `recovery_required`；该行记录的是前一阶段边界，后续 lazy promotion 已在当前切片补齐。

## 2026-08-09 — Lazy promotion handoff 完成

- 普通 Run 首次遇到非纯工具时，按 `idempotent` / `queryable` / `non_idempotent` 等级最多各做一次结构化模型 preflight；低等级判断为 ordinary 后不重复收费，首次进入更高等级会重新判断。
- preflight 选择升级时，coordinator 在专用 SQLite 内吸收已执行前缀、证据摘要和副作用回执，只把当前动作作为下一步排队；ToolRuntime 用 pi agent loop 的 `terminate` 标记在 handler 前停止当前普通 Run。
- 验证：Durable/tool 42/42、Runner 34/34、Runner + Durable store/runtime 49/49；改动范围 TypeScript 过滤检查仅剩既有 `runnerHelpers.test.ts` 两处错误。
