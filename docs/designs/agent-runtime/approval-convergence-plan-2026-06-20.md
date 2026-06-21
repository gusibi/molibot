# 审批接口收敛 —— 现状摸底与收敛方案（2026-06-20）

> 文件职责：技术设计 / 系统提案（`docs/designs/`）。本文只摸底 + 出方案，**不改代码**。
> 背景：对应 [agent 优化 review §2.1 ToolRuntime 双栈](../../reviews/agent-runtime/agent-optimization-review-2026-06-20.md) 与 SubagentRuntime 硬化的剩余 slice #3。

## 0. 一句话结论

当前**至少有两套独立的审批"执行+阻塞+落库+卡片"机制**，外加一条 subagent 专属的 bubbling 路径，靠 `channelCommands` 里一处手工对账（`resolvePendingBrokerRequests`）粘在一起。模型本身不冲突，**冗余的是执行通道**：两个 poll 循环、两个 store of record、两个 prompt 构造器、两套 resume 语义。收敛目标是「一个审批服务接口，多个能力适配器」，**高风险，需独立分阶段推进**，不要和已完成的 subagent 硬化捆绑。

---

## 0.1 关键拓扑更正（2026-06-20，构建 HostBash 适配器时发现）

摸底时把「落库」写成「两个 store of record / 独立表」。**深入读代码后更正：两条路径的物理落库是同一张表。**

- `SqliteApprovalStore`（broker，`approvalStore.ts:99-141`）和 `HostBashStore`（`hostBash/store.ts:152-`）**都默认 `storagePaths.settingsDbFile`，且都读写同一组表 `approval_requests` + `approval_grants`。**
- HostBash 记录就存在 `approval_requests` 里，hostBash 专属字段（`pendingAction`/`classification`/`permissions`/`approvalMode`）打包进 `action_json`；`capability = bash:<toolId>`、`risk_level = high`（insert 见 `hostBash/store.ts:375`）。
- 即「两个 store of record」其实是**同一物理库上的两个访问类**，不是两个数据库。物理层面的「单一 store of record」**已经成立**。
- 二者用**不同的 row id**：broker request id 由 `createDefaultApprovalRequest` 生成；hostBash record id 由 bash 分类生成。`resolvePendingBrokerRequests` 对账的是「同一逻辑审批的两行」——但因为 **bash opt-out broker、且无内置非-bash 高危工具**，两行**几乎不会同时存在**，桥接对账实际命中的场景趋近于 0（疑似 dead code）。

**对 Phase 2 的影响：**
- 原计划「让 hostBash store 成为权威、broker 改为其视图」在**物理层已无需迁移**——它们本就同表。
- 真正剩下的冗余是**访问类 + grant 模型 + 桥接**这三层逻辑，而非物理库。
- 因此「再写一个 HostBashApprovalService 适配器去统一 store」价值有限（store 本就统一）；更高价值是 **(a) 证实并删除 dead 桥接**，或 **(b) 合并两个访问类**。两者都改动不可活测的审批路径，需谨慎、单独推进。
- **已完成的 Phase 2 第一刀（ApprovalService façade + BrokerApprovalService，零行为变更）依然有效**，是干净的检查点；后续不必急着造 hostBash 适配器，建议先就 (a)/(b) 取舍做决策。

## 1. 现状摸底：到底有几条路径

### 路径 A —— ApprovalBroker（ToolRuntime 通道）

| 维度 | 现状 |
|---|---|
| 代码 | `tools/toolRuntime.ts`、`approval/approvalBroker.ts`、`approval/approvalStore.ts`、`approval/approvalTypes.ts` |
| 触发 | `ToolRuntime.executeToolCall` → `decidePolicy`。**非 bash** 且 risk 为 `high`/`critical` 的工具 → `approval_required`（`createDefaultApprovalRequest`）|
| 阻塞 | `ToolRuntime.pollApprovalRequest`：**5 分钟超时、500ms 轮询**，通过 `context.emit` 发一张 `buildHostBashApprovalPrompt` 形状的卡片 |
| 降噪 | low/medium risk 有 1.5s debounce 批量聚合（high/critical 跳过）|
| 授权模型 | `ApprovalGrant`，scope = `once/turn/session/workspace/persistent`；`checkGrant` 按 capability+actor+workspace+session+run+fingerprint 匹配 |
| 落库 | `approvalStore`（SQLite，独立表）|
| **关键事实** | bash 在 `bashPolicy.ts:62-70` **显式 opt-out**（永远返回 `allow`）；大多数内置工具是 low risk。**System A 对内置工具基本处于休眠态**，主要为 high-risk MCP/host 工具服务，却背着全套 debounce/scope/grant 机制 |

### 路径 B —— HostBashStore（bash handler 通道，真正高频）

| 维度 | 现状 |
|---|---|
| 代码 | `tools/bash.ts`、`agent/hostBashExec.ts`、`hostBash/store.ts`、`hostBash/approval.ts`、`hostBash/commandClassifier.ts` |
| 触发 | bash 带 `params.hostApproval`（host-only 能力）、未被白名单批准、sandbox 开启时 |
| 阻塞 | `requestApprovalFromBash` 登记 pending 记录，按 `approvalWaitTimeoutMs` **轮询等待**；窗口内批准则**内联执行**，否则返回带 `hostBashApproval` prompt 的结果（`status: "waiting_for_approval"`，`bash.ts:406`）|
| 上抛 | runner 从 `tool_execution_end` 结果里 `extractHostBashApprovalPrompt` → 转 runner event → channel 渲染卡片（如 `feishu` `sendHostToolApprovalCard`）|
| 恢复 | `channelCommands.approveHostTool` → `hostBashStore.approve` → 后台执行已批准命令（`scheduleHostBashExecutionFallback`）**并** `baseRuntime.resumeApprovedHostBashTask` 经 `retryApprovalAutoResume` 重跑回合 + `rewriteApprovalToolResultInContext`（把输出补回上下文）|
| 授权模型 | capability 白名单（长期 approved entries）+ session 放行 + one-time |
| 落库 | hostBash SQLite store（另一套表）|

### 桥接 —— 手工对账

`channelCommands.approveHostTool` 在批准 HostBash 记录后调用 `resolvePendingBrokerRequests(scopeId, "approved", ...)`（`channelCommands.ts:259-265`），**把 System A 的 broker request 也标记为 approved**。一次用户「批准」要同时摆平两套 store。单向、易漂移。

### 路径 C —— Subagent bubbling（第三种 resume 语义）

subagent 内的 bash 同样走 System B 产出 prompt，但 `subagent.ts` 的 `session.subscribe` 检测到结果里的 prompt 后：**set prompt → emit `tool_execution_end`（带 prompt）→ `session.abort()`**。父 runner 转发卡片；批准后**重跑父回合**（重新触发 subagent）。即 subagent 不在原地 coroutine-block，而是 abort + bubbling + 重跑。与主 runner 的"原地阻塞续跑"语义不同。

### 相邻 Gate D（不是审批，但常被混淆）

`runner.beforeToolCall` 里的 `hookManager.gate` + budget preflight 是**策略/预算拦截**，不是用户审批。归类时要和审批分开，避免又被当成"第四套审批"。

---

## 2. 问题清单（收敛动机）

1. **两个 store of record**：`approvalStore` vs `hostBash` store，靠 `resolvePendingBrokerRequests` 手工对账 → 状态漂移风险。
2. **两个阻塞轮询循环**：`pollApprovalRequest`（500ms/5min）vs `requestApprovalFromBash`（`approvalWaitTimeoutMs`）→ 超时与语义不一致。
3. **两个 prompt 构造**：System A 给非 bash 工具也套用 `buildHostBashApprovalPrompt`（一张"假 host-bash 卡"）→ 卡片模型对工具类型是泄漏的。
4. **三种 resume 语义**：主 runner 原地续跑 / subagent abort+重跑 / broker 后台执行 → 维护者要在脑子里同时维护三套。
5. **复杂度与使用度倒挂**：System A 对内置工具基本休眠，却背着 debounce/scope/grant 全套；真正高频的是 System B。
6. **认知负担**：排一个审批 bug 要同时读 ToolRuntime、bash handler、HostBashStore、channelCommands、channel card 五处。

---

## 3. 收敛方案

### 设计原则

不是"删掉一套模型"，而是**统一执行通道**：审批的「策略 + 落库 + 阻塞等待 + 卡片 + resume」收敛成一条；bash 能力分类器、broker scope 模型作为**输入**喂给同一服务，而不是各开一条流水线。

### 候选方案对比

| 方案 | 做法 | 优点 | 风险/代价 |
|---|---|---|---|
| **1. 以 HostBashStore 为单一权威** | 退役 ApprovalBroker，high-risk 非 bash 工具并入 hostBash 流 | 保留高频被验证的通道；改动集中 | 丢掉 broker 的 scope/grant 抽象；hostBash 模型要泛化到非 bash |
| **2. 以 ApprovalBroker 为单一权威** | bash 取消 opt-out，handler 不再自审批，全部走 broker | 模型最干净（scope/risk/grant） | 改动面最大、风险最高；要重写 bash 阻塞+resume+白名单，回归面广 |
| **3.（推荐）单一 `ApprovalService` 接口 + 适配器** | 定义一个服务：一个 store、一个 waiter、一个 prompt/卡片模型、一个 resume；bash 与 high-risk 工具都产出统一 `ApprovalRequest`；subagent 复用父服务 | 各能力保留自己的"分类/能力"输入，但共享执行；可渐进迁移、每步可回归 | 需要先定义稳定接口；迁移分多步 |

**推荐方案 3**，并以 **ApprovalBroker 的 grant/scope 模型为"脊柱"**（它的 scope 抽象更完整），但**执行/阻塞/卡片/resume 收敛到 HostBash 那条被验证的实现**上。即：模型用 broker 的，机器用 hostBash 的，二者合一。

### 分阶段迁移（每阶段可独立回归、可回滚）

- **Phase 0 — 冻结与契约（本文）**：定稿现状图 + 目标接口草案；不动代码。产出 `ApprovalService` 接口草案（`request / checkGrant / waitForDecision / buildPrompt / resume`）。
- **Phase 2 第一刀 —— 接口先行 façade（已完成 2026-06-20，零行为变更）**：新增 `approval/approvalService.ts`，定义统一 `ApprovalService` 接口（`checkGrant / createRequest / getRequest / waitForDecision / resolve`）+ `BrokerApprovalService` broker 适配器（`waitForDecision` 复用 Phase 1a 的 `pollUntilResolved`）。`ToolRuntime` 改为依赖 `ApprovalService`（构造时把既有 `approvalBroker` 选项包成 `BrokerApprovalService`，所有调用点不变），其 `pollApprovalRequest` 的内联轮询移入服务。底层 store 未动。验证：新增 adapter 单测 5 条 + 既有 `toolRuntime.test.ts` 6 条行为测试全过（28/28），tsc 干净。**后续**：再写 HostBash 适配器实现同一接口，最终让 channelCommands 通过接口消解 `resolvePendingBrokerRequests` 桥接（Phase 2 第二刀，会改行为，需谨慎）。
- **Phase 1 — 抽公共件，零行为变更**：
  - ✅ **（已完成 2026-06-20）** 把两个 poll 循环抽成 `pollUntilResolved<T>`（`approval/approvalWaiter.ts`，注入 now/sleep、纯单测 4 条）。System A（`ToolRuntime.pollApprovalRequest`）与 System B（`waitForHostBashApprovalAndExecute`）都改调它；各自的 store 访问/终态/内联执行逻辑保留在 `poll()` 回调里。验证：waiter 4/4、System A toolRuntime 6/6、System B bash-output 19/19（含「approval 后内联执行」用例）。零行为变更。
  - ✅ **（已完成 2026-06-20，零行为变更）** ToolRuntime 内部两处「假 host-bash prompt」构造（pending 卡片 + rejected/expired 结果）合并为单一 `buildBrokerApprovalRecord`（`toolRuntime.ts`，纯单测 2 条）。两处仅传入各自不同的 toolId/displayName/command/status/pendingAction，公共信封（channel ""、ephemeral、scratch-only 权限、从 request 派生的 id/reason/scopeId/sessionId/requestedAt）收敛到一处。回归 toolRuntime 8/8、approval 套件 26/26。
  - ⏳ **（待做，非零行为变更）** 跨渠道层面把非 bash 工具卡片从「host-bash 形状」改成按工具类型分支的通用形状。这一步会改变 channel 渲染，牵涉 feishu/telegram/qq/weixin/web，需单独小心推进 —— 留待 Phase 2 之后或与渠道改动一起规划。
- **Phase 2 — 单一 store of record**：
  - 选 hostBash store 为落库权威（高频、已被 channel/auto-resume 环绕），broker 记录改为该 store 的视图/适配；删除 `resolvePendingBrokerRequests` 手工对账。
- **Phase 3 — 统一 resume 语义**：
  - 让 subagent 的 host approval 走与父级**同一条** resume 路径（消掉 `subagent.ts:814` 的 abort+bubbling 第三路径），与 §2.1 对齐。
- **Phase 4 — 删冗余**：移除 ApprovalBroker 中已无调用的执行/轮询代码，只留 grant/scope 模型；更新文档与测试。

### 验收口径（每阶段）

- Phase 1：System A/B 审批行为与超时不变；新 waiter/builder 有纯单测；全量回归绿。
- Phase 2：一次用户批准只写一处 store；旧对账路径删除后 host-bash 与 high-risk 工具审批端到端仍工作。
- Phase 3：subagent single/parallel/chain 在 host approval 下与主 runner 同一 resume 行为；`waiting_for_approval` 语义保持。
- Phase 4：无死代码；`grep` 不再有两套 poll/两套 prompt builder。

---

## 4. 待你拍板的开放问题

- [ ] 方案选 3（推荐）还是 1？（2 风险最高，基本排除）
- [ ] 脊柱用 broker 的 grant/scope 模型 + hostBash 的执行实现，这个"模型/机器分离"的取舍是否认可？
- [ ] 是否先只做 **Phase 1（抽公共 waiter + 统一 prompt builder，零行为变更）** 作为低风险第一刀，验证方向后再推 Phase 2+？
- [ ] 与 review §2.1 的"ToolRuntime 双栈"是否合并为同一个 epic 跟踪？

---

### 附：核对锚点

```
bashPolicy.ts:62-70          # bash 显式 opt-out broker，注释说明避免双重审批
toolRuntime.ts:76-176,200-270 # System A：decidePolicy + pollApprovalRequest(5min/500ms) + debounce
bash.ts:302-410,602-620      # System B：requestApprovalFromBash 阻塞等待 + 返回 waiting_for_approval prompt
hostBashExec.ts:305-337      # System B 执行已批准动作
channelCommands.ts:259-265   # 桥接：approveHostTool 同时 resolvePendingBrokerRequests
baseRuntime.ts:241-251,362-391 # System B resume：retryApprovalAutoResume + rewriteApprovalToolResultInContext
subagent.ts:814              # 路径 C：subagent host approval = emit prompt + abort（第三 resume 语义）
```
