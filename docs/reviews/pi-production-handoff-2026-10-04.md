# Molipibot Pi 1.0 改造交接

> 后续执行更新（2026-10-04）：下文是生产接线前的历史交接。正式 Runner、内部子任务、审批与 Deferred 启动恢复现已实施；最新事实和未验证项以 [生产验证](pi-production-integration-validation.md) 为准。

交接日期：2026-10-04。下一会话目标：完成剩余 Pi Durable 正式生产接线，保留 Molibot 现有产品能力和审批交互。仓库：molipibot；当前分支：master。下文路径均相对仓库根目录。

## 用户授权与交付要求

用户已经授权完成整个改造，反复要求持续执行、不要按阶段反复询问是否继续。剩余范围明确为：正式 Runner 切换、自动 Host Bash 审批执行归属、内部子 Agent 恢复、Deferred 的完整生产接线。常规实现、排错和隔离验证不需要再次请求授权。

审批交互是核心不变量：保留现有审批卡片和选项；批准继续原调用；重启仍绑定原请求、Session、actor 和执行作用域；拒绝、过期、Stop 和晚到决定不能重新启动操作。已经发生但结果未知的危险操作不得盲目重跑。

用户项目有大量未提交改动，要求在此基础上修改。没有创建提交。不要 reset、checkout 整个文件、清理未跟踪文件、全量 stage 或 commit；不能把整个 dirty diff 当作本任务改动。Pi 的多个新模块和测试本身是未跟踪文件，普通 git diff 不会显示它们。不要重启用户现有服务，不要读取或写入真实用户数据库，不要发起付费模型调用。

## 权威材料：先读这些，不重新规划范围

- `AGENTS.md`：项目协作、架构、审批、持久化测试和文档规则；遵循当前版本。
- `docs/requirements/pi-capabilities-integration-spec.md`：已授权范围、阶段、验收门槛。
- `docs/adr/0005-pi-durable-private-execution-storage.md`：私有执行存储边界已接受。
- `docs/requirements/personal-assistant-capability-matrix.md`：当前能力状态的唯一权威来源；Pi kernel replacement 仍是“部分交付”。
- `docs/reviews/pi-durable-foundation-validation.md`：已实现内容、最终检查、已知失败及生产接线限制，尤其最后的 2026-10-04 条目。
- `prd.md` 顶部 Pi 接线条目、`features.md` 顶部实施记录：需求进度和交付事实。
- `docs/reviews/pi-codemode-integration-validation.md`、`docs/reviews/pi-image-integration-validation.md`：已有 Codemode/图片成果，勿重新实施或误当成 Durable 完成。

具体方案、历史验证数字和完整 diff 已在上述材料及代码中，不在此重复。

## 最重要的现场状态

续执行补充（2026-10-04）：共享 Pi registry 已修复混合批次审批竞态。存在授权 `beforeTool` hook 或工具 preparation 时，使用 Pi 原生串行批次；等待期间不启动同批后续工具，重开继续原审批调用。新增 conversation 两条路径和 `PiRunSession` 一条恢复回归，最终 3/3 通过；类型检查和生产构建通过，独立增量审查通过。串行源码全量 2382 项，2378 通过、3 失败、1 跳过，失败与前次相同。详见验证记录新增“混合工具批次审批挂起”条目。四项生产接线仍未完成；工作树仍未提交。

**生产 Runner 仍使用原 Agent loop。不是已经切换到 Pi。** 本会话曾尝试默认切换并验证部分路径，随后撤回了这部分接线，原因是自动审批、混合工具批次和子 Agent 恢复没有完整覆盖。保留下来的原生控制器与 adapter 是实施基础，不是第二套已交付生产引擎。没有新增生产双引擎开关或 fallback。

原生自动 Host Bash 阶段收据与 Deferred adapter 的请求契约已有隔离验证；外部审批入口仍有 out-of-band 执行，内部子 Agent 仍跑旧 session loop。下一位不能把 adapter 测试通过报告为四项生产接线完成。

## 从实际执行入口追踪

### 原生内核和 adapter

- `src/lib/server/agent/durable/piKernel.ts`：共享 registry、ToolTask preparation、authority/ownership、恢复守卫、事件和清理。
- `src/lib/server/agent/durable/piConversation.ts`：managed Harness/Conversation、稳定入站与 projection owner、动态工具配置、原生 continuation、生命周期。
- `src/lib/server/agent/core/piRunSession.ts`：上层状态/事件 adapter，尚未接入正式 Runner。
- `src/lib/server/agent/durable/piPreparationEffects.ts`：原 ToolTask memo 中的具名阶段 intent/receipt；未知结果必须保持原任务并阻止模型重试。
- `src/lib/server/agent/durable/piToolResult.ts`：私有执行 metadata 与外部工具 details 分离。
- `src/lib/server/agent/tools/preparedTool.ts`、`toolTypes.ts`、`toolRuntime.ts`：共享授权、准备和单次执行边界。

注意：PiRunSession 的 `finishTurn` 字段仍没有完整实现；beforeTool 的 terminate、原生混合批次终止与现有审批 barrier 不能直接假定等价。必须覆盖现有交互后再切默认入口。原生工具回调已通过 native task input 找到原始 assistant，不要退回“最新同 call ID 消息”的查找。

### 正式 Runner 与投影

`src/lib/server/agent/core/runner.ts` 仍有 new Agent、审批 barrier、整次 attempt rollback、abort/context rewind 等旧机制。生产切换需让 Pi 持有 canonical 执行事实，不能在 Pi 上套旧 loop，也不能删除尚未被完整替代的可用路径。

核对 `session/store.ts` 的稳定 source ID 投影、`core/runBudgetStore.ts` 的稳定步骤预算、`usage/tracker.ts` 的响应记账去重。恢复必须保留原入站和原 projection run owner；新 Attempt 不能重置预算、重复计费或重放已完成写操作。现有业务 compaction 的投影也需与原生 compaction 一起处理。

### 自动 Host Bash / 外部决定

- `tools/bash.ts`：native preparation 已把 sandbox 尝试与主机执行分开；既有普通路径仍可用。
- `hostBashExec.ts`、`hostBash/store.ts`：作用域校验、启动前取消与原子执行认领。
- `channels/shared/baseRuntime.ts` 的 `executeApprovedHostBash`：仍会在外部启动进程、改写 Session 结果并重新排队，是必须替换的真实生产入口。
- `channels/shared/brokerApprovalResume.ts`：Broker 恢复入口。保留已有的共享 orchestrator 查询改动，不能整体恢复 HEAD。

目标是外部处理器只记录决定并唤醒原 native 执行 owner，不在 Channel 层另起命令、不改写已提交 canonical 收据、不制造新的普通用户输入。显式请求和 sandbox 后自动升级都必须覆盖。

### 内部子 Agent / Codemode

`tools/subagent.ts` 的 `runSubagentOnce` 仍用 createAgentSession、resourceLoader、SessionManager 等旧 loop。需要真实 native owned task/conversation，恢复原 child 的模型和工具收据，并保留权限、只读角色、fallback、deadline、progress、公共 transcript 设置以及父子预算/取消关系。包一层 Task 后继续调用旧 loop 不算替换。

同时核对 Runner 的 `runNestedToolCall`、`tools/codemode.ts` 的 RPC 身份和 `tools/index.ts` 的 nested 归属。不能因为内部工具结果可缓存，就把任意脚本或父工具标成 replay safe；脚本重放的调用序列/参数变化和已完成写操作需要守卫。

### Deferred

`piRunSession.ts` 已通过真实 Pi Models adapter 委派 fetch/cancel，并传递当前 run 凭据、Session affinity 请求头和请求回调。`providers/piRuntime.ts`、`piRegistry.ts`、`piTelemetry.ts` 是生产 Provider/请求边界。

仍需生产等待状态、原模型/Provider/端点固定、过期/失败/取消、Trace 和一次记账接线。重启查询原 handle，不重新提交，也不在等待中切换到另一 Provider。没有支持该协议的自定义 Provider 不能伪装支持。

## SDK / 测试陷阱

- 使用已安装的 Pi 1.0 `.d.ts` / `.js` 作为实际 API 依据；旧 example checkout 不包含等价 durable API。
- Harness 虽扩展 Session，但没有公开 `scanSubmissions`。该 scan 是 Storage API。控制器目前用私有 Control entry 与 Tx.submissionByRequest 对应输入身份；不要依据旧探索结论调用不存在的方法。
- HookApi 只有 task/conversation identity、document reads 和 memo，没有 commit/getTask/entry；ToolExecutionApi 和 Harness 有不同权限。先查签名再接线。
- Pi 工具回合 stopReason 是 `toolUse`；异步响应是 `deferred`，不是 `toolCalls` 或 `pending`。
- Provider fixture 必须提供 auth、stream 和 streamSimple。断言若发生在 deferred dispatcher 内且早于 barrier，会被 SDK 转成模型失败；测试应 race barrier 与任务 settle，避免无限等待。
- native context.messages 会过滤错误 assistant，并可能补缺失工具结果；投影 canonical 事实应查看 context.entries。
- Pi 默认只有同批工具全部 terminate 才终止；不能据此替代 Molibot 的 unconditional approval suspension。
- 未知 effect、取消/租约丢失后的 receipt 提交、close 初始化竞态均需保留守卫。不要通过放宽 replay policy 让恢复测试“通过”。

## 验证与交付

按验证记录复用现有证据，仅为新改动重跑受影响检查。最终原生生命周期/Deferred/收据测试与生产构建已通过。全量源码检查没有全绿；具体失败位置和原因见验证记录，勿隐去或顺手修改无关功能。

所有持久化测试使用临时 DATA_DIR 和临时工作区；仓库 `.env` 含真实数据目录配置，必须显式隔离。示例：

```sh
test_data_dir=$(mktemp -d)
DATA_DIR="$test_data_dir" node --import ./scripts/register-loader.js --import tsx --test --test-concurrency=1 <受影响测试文件>
pnpm check
pnpm build
```

原生关联测试入口：`durable/piKernel.test.ts`、`durable/piConversation.test.ts`、`durable/piToolResult.test.ts`、`core/piRunSession.test.ts`。生产回归入口：`core/runner.test.ts`、`core/approvalSuspension.test.ts`、`tools/bash-output.test.ts`、`tools/bashApprovalWait.test.ts`、`tools/preparedTool.test.ts`、`tools/subagent.test.ts` 与共享审批恢复测试。

PiKernel 强杀测试使用 localhost 假 Provider，必要时申请仅用于隔离测试的网络权限；不是付费或生产验收。真实 UI/渠道/生产入口的验收按 spec 和 AGENTS 执行，不能用纯内核测试代替。文档记录状态必须与实际入口一致。

独立 standards review agent 本轮因额度未能运行；已做自主对抗式检查，但独立审查不能写成通过。下一会话有可用额度时补做。工作树没有合并成提交；提交前明确本任务修改范围，不能纳入他人未提交工作。

## Suggested skills

下一位 Agent 按需调用 Skill 工具读取：

1. `mattpocock-skills:implement` — 继续已批准 spec，实施、适用检查和最终审查；本地来源 `$HOME/Github/matt-skills/skills/engineering/implement/SKILL.md`。
2. `agent-runtime-debug-review` — 仓库 `.agents/skills/agent-runtime-debug-review/SKILL.md`，跨入口追踪恢复、审批、取消和执行事实。
3. `mattpocock-skills:tdd` — 在原生/共享执行边界补行为回归，尤其真实生产 Runner 和 child/approval restart。
4. `doc-standards` — 仓库 `.agents/skills/doc-standards/SKILL.md`，更新受影响状态与证据，不将未接线能力写成已交付。
5. `code-review` / `mattpocock-skills:code-review` — 交付前审查实际 wiring 和 spec；分辨用户已有 dirty 改动与本次实现。

不需要重新调用 to-spec 或向用户确认是否继续：范围和授权已明确。只在实质变化的范围、费用、破坏性操作或缺失关键输入时询问，并继续不依赖该决定的工作。
