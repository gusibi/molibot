# Agent 优化 Review 与计划（2026-06-20）

> 本文合并两份独立 review，并附上代码核对结果。定位为 **review / 决策稿**，待人工再次 review 后，确认的条目再落入 `prd.md` backlog。
> 文件职责：技术 review 与优化分析报告，不放实现流水。

## 0. 总体判断

Agent 已经在往 v2.2 方向推进，**不是"没方向"**。当前最值得做的是把已经抽出来的新模块**做深**，而不是继续加新概念。

两份 review 对比后的结论：**战略上应优先"产品可靠性 + 模块收敛"，其次才是 perf 快赢。** perf 项真实存在，但不是现在拖累产品的主因；真正影响产品体感的是 subagent 可靠性与工具执行/审批的双栈混乱。

核对代码后，两份 review 的关键论断全部成立（见各条 [验证] 标注）。

---

## 1. 两份 review 一致项（高可信，优先做）

### 1.1 [P1] runner.ts 神类回潮 —— 推进"接口化拆分"

- **现状**：`core/runner.ts` 当前 **2381 行**。prd 记录上一轮重构"缩到 1693 行"，说明那次只抽了 helper、没真正搬走职责，现已回涨。
- **[验证]** `wc -l` = 2381；prd §2.4 记录 1693。
- **处方（采纳第二份 review，不做大爆炸式重写）**：把 `prepareTurn → buildContext → buildTools → runModelLoop → commitTurn` 每段抽成明确接口，目标是提升 locality —— 出问题时不必在一个大函数里横跳。
- 推荐强度：**Strong**。

### 1.2 [P1] Subagent 运行控制太软 —— SubagentRuntime 硬化

- **现状**：`tools/subagent.ts` **完全没有 import `RunBudget`/`runtimeBudget`**。子 agent 缺失父 runner 已有的全部安全机制。
- **[验证]** `grep -c "RunBudget\|runtimeBudget" subagent.ts` = 0；`compaction:{enabled:false}` 见 `subagent.ts:699`；所谓 fallback（`subagent.ts:435`）只是**路由解析兜底**，不是**模型调用失败恢复**。

  | 机制 | 父 runner | subagent |
  |---|---|---|
  | Tool/model 预算中断 | ✅ `RunBudget` | ❌ 只计数不中断（`subagent.ts:764`）|
  | 模型调用失败 fallback | ✅ candidate 循环 | ❌ |
  | 空响应重试 | ✅ | ❌ |
  | 上下文溢出压缩 | ✅ | ❌（显式关闭）|
  | wall-clock timeout | 部分 | ❌ |
  | Host approval | 走 channel 审批 | 事件上抛 + abort（`subagent.ts:814`，**第三条审批路径**）|

- **处方**：做一个小而深的 `SubagentRuntime` 模块，统一 budget、wall-clock timeout、模型 fallback、approval waiting、compaction 策略。产品感知最强，直接减少"子任务跑飞 / 卡住 / 审批后浪费"。
- 推荐强度：**Strong**。

---

## 2. 第二份 review 补充项（我方核对后加深）

### 2.1 [P1 ↑，原 P2] ToolRuntime 双栈 —— 建议提级

- **现状（比"接口偏复杂"更深）**：`ToolRuntime` 已接入主路径（`tools/index.ts:328-394` 的 `wrapWithToolRuntime` / `toAgentTool`），并自带**一整套独立审批系统**：独立 `ApprovalBroker` + `pollApprovalRequest`（5 分钟 / 500ms 轮询）+ debounce 批处理 + `buildHostBashApprovalPrompt`。
- 同时 `runner.ts` 的 `beforeToolCall` 又有自己的 hook gate + budget + `HostBashStore` 审批路径。
- **[验证]** `executeToolCall` 调用点：`tools/index.ts:355,381`；ToolRuntime 自有审批见 `toolRuntime.ts:76-176, 200-270`。
- **风险**：一个 bash 调用要穿过**两层"像审批"的逻辑**，各有 prompt 构造与超时；维护者需同时理解 ToolRuntime、bash handler、HostBashStore、channel card 四处 —— 两个 source of truth，是 bug 温床。
- **处方**：定义**唯一**的工具执行接口 —— 所有工具返回同一种 `ToolResult`，approval 状态只在一层处理，channel 只负责渲染。
- 推荐强度：**Strong**。

### 2.2 [P2] Prompt 优化从"加规则"转为"最终渲染审计"

- **现状**：`prompts/prompt.ts` 已有 Message Processing Pipeline，但最终拼装（`prompt.ts:768` 附近）仍有 profile、project context、skills、memory 多层合并。
- **处方**：做系统提示词审计工具，每次改 prompt/profile/skill routing 时输出最终 system prompt 的 section 顺序、重复 section、token 估算、缓存稳定前缀变化。不再靠人工预览。
- 推荐强度：**Worth exploring**（与 §3.1 eval harness 是同一件事的两半：审计=静态检查，eval=行为回归）。

### 2.3 [P2] Workspace 能力闭环

- **现状**：`workspaces/store.ts` 已有 tool/skill 白名单与 `memoryScope`，`toolRuntime.ts:55` 已用 tool 白名单，skill 加载也用 `workspaceId`。但 channel↔workspace 绑定、`memoryScope` 真实隔离、设置页/命令入口尚不完整。
- **处方**：把 Workspace 定义成"权限与上下文 profile"，先做默认 workspace、会话绑定、工具/skill 白名单可见化。
- 推荐强度：**Worth exploring**。

---

## 3. 两份 review 均漏掉项（我方补充）

### 3.1 [P1] ⭐ 没有 agent 质量回归 / eval harness —— 最值得补

- **现状**：`src/lib/server/agent/` 下没有任何 eval / bench / golden-task 目录。单测覆盖很厚，但 AGENTS.md 反复警告的那类问题（重复 section、缓存前缀漂移、skill routing 失效、profile 合并顺序错）**全是单测抓不到、只有 golden-task eval 能抓的**。
- **[验证]** `ls src/lib/server/agent | grep -i 'eval\|bench\|quality'` → 无。
- **理由**：prompt / routing 是改动最频繁、风险最高的区域，却没有回归网。比任何 perf 项更值得做，且与 §2.2 互补。
- 推荐强度：**Strong**。

### 3.2 [P3] 轮询是系统性反模式（非单点）

- **现状**：`runner.ts` 25ms ×2（`:1492`、`:1627`）、`toolRuntime.ts` 500ms、`baseRuntime` 审批 auto-resume 1000ms × 3600 次。到处是 busy-wait 而非 event/latch。
- **处方**：做 SubagentRuntime / ToolRuntime 收敛时，顺手换成 Promise latch（队列空时 resolve）。不单独立项，搭车做。
- 推荐强度：**Worth exploring**。

---

## 4. Perf 快赢（原第一份 review，降级为"搭车做"）

这些真实但非产品瓶颈；**触碰相关文件时顺手做**，不单独排期。

| 项 | 位置 | 说明 |
|---|---|---|
| TurnOrchestrator 每操作新建 SQLite 连接 | `core/turnOrchestrator.ts · openRuntimeDb()` | 一轮 run open/close 4–6 次；改单例持久连接 + 轻量 mutex |
| Skill 加载每轮全量扫盘 | `skills/skills.ts · loadSkillsFromWorkspace()` | 加 path+mtime 的 per-runner 缓存 |
| 队列 drain 25ms 轮询 | `core/runner.ts:1492,1627` | 见 §3.2，用 Promise latch |
| 外部记忆每轮同步 | `core/turnOrchestrator.ts · prepareTurnMemory()` | `syncExternalMemories()` 加 60s TTL debounce |
| Subagent 输出 6000 字符有损截断 | `tools/subagent.ts · compressOutput()` | 完整输出写 artifact，父 agent 按需 read |
| Subagent 每任务冷启动 | `tools/subagent.ts · runSingleSubagent()` | parallel/chain 复用 session 模板 |
| Compaction 永远用主模型 | `core/turnOrchestrator.ts · compactSessionContext()` | 增 `compactionModelKey`，默认回退主模型 |
| Hook flush 硬编码 2s | `core/runner.ts · finishHookRun()` | 改 `settings.hookFlushTimeoutMs` |

---

## 4.5 实现进度（2026-06-20，第一刀已启动）

已选定第一刀 = **SubagentRuntime 硬化**，本次交付：

- ✅ 新增 `tools/subagentRuntime.ts`：`SubagentExecutionGuard`（复用 `RunBudget` + wall-clock deadline）、`evaluateSubagentEvent`、`resolveSubagentBudgetLimits`、`DEFAULT_SUBAGENT_DEADLINE_MS`。
- ✅ 已 wiring 进 `runSingleSubagent`：session 事件驱动预算/超时中断 + `session.abort()`。
- ✅ `SubagentRunResult` 携带 `budget` / `runtimeStopKind` / `durationMs`；预算/超时 → `stopReason="error"` + 结构化 `errorMessage`。
- ✅ 模型 fallback **基础**：`buildSubagentModelCandidates`（有序去重，向后兼容 `resolveSubagentModelRoute`）。
- ✅ 测试：`subagentRuntime.test.ts`（7）+ `subagent.test.ts` 新增 2 例；agent 测试 40/40 通过；改动文件 tsc 干净。

**对照验收标准（更新 2026-06-20）：** 1 ✅ ｜ 2 ✅（候选 + 重试循环已 wiring）｜ 3 ❌（审批收敛未动）｜ 4 ✅（single/parallel/chain 各有预算中断用例）｜ 5 ✅（budget/model/duration/stopReason 已透传到 RunSummary）。

**已追加交付：**
- ✅ **#2 run summary 透传**：`buildSubagentTaskRecord`（runSummary.ts，纯函数 + 测试）把 `budget`/`model`/`durationMs` 从 `subagent_execution` task_end 事件落到 `RunSummary.subagent.tasks`。事件类型（types.ts）、emit（subagent.ts）、record（runner.ts）已串联。
- ✅ **#1 模型 fallback 重试循环**：`resolveSubagentModelCandidates` + `buildModelFromRoute` + `buildSubagentFallbackModel`；`runSingleSubagent` 重构为「解析候选 → 共享 guard → 逐候选 `runSubagentOnce`」循环，按 `shouldFallbackToNextModel`（纯函数 + 测试）决定是否换模型。预算/超时/审批/中止不触发 fallback。

- ✅ **#4 per-mode 预算测试**：`createSubagentTool` 新增可注入的 `runSubagent` 依赖（默认 `runSingleSubagent`），测试注入返回 budget-stopped 结果的 fake runner，覆盖：single 透出 `runtimeStopKind="budget_exceeded"` + end 事件 `error`；parallel 即便一个被预算中断仍跑完全部任务；chain 在被预算中断的步骤后**不再执行后续步骤**。

**剩余 slice：**
3. 审批接口收敛：让 subagent host approval 走与父级同一审批接口（消掉 `subagent.ts` 的事件上抛 + abort 第三路径），与 §2.1 对齐。**风险最高，留最后；建议与 ToolRuntime 双栈合并规划。**

**Review 修复（2026-06-20）：** [P2] deadline 仅在 session 事件回调里检查，`session.prompt` 卡住（provider stall、无后续事件）时 10min 超时不会触发 abort。已修：新增 `armSubagentDeadline`（注入式调度器，纯测）+ `guard.remainingMs()`，在每次 attempt 外层挂独立计时器，到点记录 timeout 并 `session.abort()`，`finally` 清除。

> 注：fallback 循环与 guard 中断的「活模型」行为目前由纯逻辑单测（`shouldFallbackToNextModel`、`evaluateSubagentEvent`、候选排序）+ 全量回归覆盖；端到端真实模型切换尚无自动化集成测试（需要可注入的 fake session）。

## 5. 建议的第一刀：SubagentRuntime 硬化

范围清楚、风险具体、产品感知最强，且不逼你同时重构 channel / runner / settings / prompt。

**验收标准：**

1. subagent 超过 tool/model/time budget 会停，并返回**结构化原因**。
2. subagent 模型调用失败会走 fallback。
3. subagent 触发 host approval 时，主 run **不丢已有上下文**。
4. chain / parallel / single 三种模式都有测试覆盖。
5. run summary 里能看见 subagent 的预算、耗时、模型、stopReason。

**贯彻"做深已有模块"的两条额外约束：**

- **复用父 runner 的 `RunBudget` 类**，不要新发明一套预算。
- 把它当作**收敛审批的契机**：让 subagent 的 host approval 走与父级**同一条审批接口**（消掉 `subagent.ts:814` 这条第三路径），与 §2.1 ToolRuntime 收敛对齐。

---

## 6. 待人工 review 的开放问题

- [ ] §2.1 ToolRuntime 是否提级到 P1？需先摸清"哪些工具调用走 ToolRuntime、哪些走 runner.beforeToolCall + HostBashStore"的准确现状图。
- [ ] 第一刀确认为 SubagentRuntime 硬化？还是先做 §3.1 eval harness 以保护后续所有 prompt/routing 改动？
- [ ] §1.1 runner.ts 接口化拆分与 SubagentRuntime 的先后顺序。

---

### 附：核对命令留痕

```
wc -l src/lib/server/agent/core/runner.ts                    # 2381
grep -c "RunBudget\|runtimeBudget" src/lib/.../tools/subagent.ts   # 0
grep -rn "executeToolCall" src/lib/.../tools/index.ts        # :355 :381
ls src/lib/server/agent | grep -i 'eval\|bench\|quality'     # 无
```
