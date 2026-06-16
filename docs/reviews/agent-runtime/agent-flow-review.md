# Agent 主流程执行分析报告

## 架构概览

```
用户消息 → +server.ts → BaseChannelRuntime.runSharedTextTask() → MomRunner.run()
                                                                     │
                                              ┌──────────────────────┼──────────────────────┐
                                              │                      │                      │
                                        系统提示词+记忆           工具创建                模型选择+回退
                                              │                      │                      │
                                              ▼                      ▼                      ▼
                                    Agent.prompt() 循环    createMomTools()      buildModelFallbackSelections()
                                              │                      │
                                              │              ┌───────┴────────┐
                                              │              │                │
                                              │          主 Agent 工具    Subagent 工具
                                              │          (bash/read/      (subagent.ts)
                                              │           edit/write)          │
                                              │              │                │
                                              │              │         runSingleSubagent()
                                              │              │                │
                                              ▼              ▼                ▼
                                    tool_execution_end    HostBashStore   pi-coding-agent session
                                    → hostBashApproval?   (SQLite)        → 独立的工具和模型
```

---

## 1. Sub Agent 与主 Agent 的审批：同一个 Store，不同的检测路径

**结论：用的是同一个 `HostBashStore`，但审批触发路径完全不同，且存在脆弱的耦合。**

### 主 Agent 审批路径
1. 主 Agent 调 bash 工具 → 沙箱拦截 → bash.ts 调用 `requestApprovalFromBash()` → 写入 `HostBashStore`
2. bash 工具返回结果中的 `details.hostBashApproval`
3. `runner.ts:2051-2058` — Agent 的 `subscribe` 回调中检测 `extractHostBashApprovalPrompt(event.result)` → 设 `blockedOnHostBashApproval = true` → `this.agent.abort()`

### Sub Agent 审批路径
1. Subagent 内部 session 调 bash → 沙箱拦截 → `requestApprovalFromBash()` → 写入**同一个** `HostBashStore`
2. Subagent 的 session subscribe 回调 (`subagent.ts:776-787`) 检测到 hostBashApproval
3. 调用 `options.emitRunnerEvent()` (主 runner 的 emitRunnerEvent) 带 `hostBashApproval`
4. 主 runner 的 `emitRunnerEvent` (`runner.ts:1898-1904`) 设 `blockedOnHostBashApproval = true` → `this.agent.abort()`
5. 同时 `session.abort()` 终止 subagent session

**问题：** 两个路径最终都走到同一个 `blockedOnHostBashApproval` 状态，但 subagent 的路径是在工具执行**内部**通过副作用触发主 Agent 的 abort。这意味着主 Agent 的 `agent.prompt()` 被 abort 时，subagent 的工具执行还在调用栈上。控制流高度非线性，极易出现竞态。

---

## 2. Subagent 审批后主 Agent 全部回滚 — 最严重的浪费

`runner.ts:2426` — 当检测到 `blockedOnHostBashApproval`：

```typescript
this.agent.state.messages = beforeAttempt;  // 整个 run 的消息全部回滚
```

这意味着：
- 主 Agent 在这次 run 中调用的**所有**工具结果（包括 subagent 之前的输出）全部丢弃
- 用户审批后继续 → 主 Agent 重新开始 → 重新调 subagent → subagent 从头开始
- subagent 的 session 已经在 `finally` 中 `dispose()` 了，无法恢复

**影响：** 如果 subagent 在被拦截前已经做了 10 次工具调用 + 3 次 LLM 调用，这些 token 和计算全部浪费。用户审批后一切重来。

---

## 3. Subagent 没有 Run Budget

主 Agent 有 `RunBudget`（`runner.ts:1637`），限制 toolCalls 和 modelAttempts。超限后会触发 tool budget continuation（只给一次无工具续写机会）。

但 subagent (`subagent.ts:637-835`) **完全没有** budget 机制。理论上 subagent 可以无限循环调用工具，唯一的限制是模型上下文窗口。对于 `worker`（有 edit/write/bash 权限），这是一个风险点。

---

## 4. Subagent 没有模型回退

主 Agent 有完整的模型回退链：`buildModelFallbackSelections()` → 按 same-provider → different-provider → pi 的顺序尝试多个模型。

Subagent (`resolveSubagentModel`, `subagent.ts:357-417`) 没有这个机制。如果 subagent 的模型请求失败，subagent 直接抛错，主 Agent 收到的是一个失败的 tool result。主 Agent 可以换模型重试，但 subagent 本身不会换模型。

---

## 5. Subagent 禁用了上下文压缩

```typescript
// subagent.ts:661
const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }
});
```

主 Agent 有上下文压缩（`shouldCompactContext` → `compactContextMessages`），但 subagent 明确禁用了。长任务 subagent 可能直接撞上 context window 上限。

---

## 6. Chain 模式的错误传播问题

`subagent.ts:1073-1086` — chain 模式中，上一步的输出通过 `{previous}` 占位符传给下一步：

```typescript
const task = item.task.includes("{previous}")
    ? item.task.replaceAll("{previous}", previousOutput)
    : item.task;
```

如果上一步失败（输出是错误信息），下一步**无感知**地继续处理。没有机制让 chain 在中间步骤失败时提前终止。

---

## 7. Subagent 的 `emitRunnerEvent` 是 fire-and-forget

```typescript
// subagent.ts:779
void options.emitRunnerEvent?.({...hostBashApproval: prompt});
void session.abort();
```

两个 `void` 调用都是 fire-and-forget。`emitRunnerEvent` 内部调 `this.agent.abort()` 是同步的，但 `session.abort()` 也是同步触发但效果异步。如果 `emitRunnerEvent` 抛错（比如 sink 为 undefined），`session.abort()` 仍然执行，但错误被静默吞掉。

---

## 8. Session Host Approval Mode 的一致性

`bash.ts:462` — session 级别的 host approval mode 检查。当用户通过 `/hosttools approve-session` 批准后，沙箱拦截会自动 fallback 到无沙箱执行。

Subagent 的 bash 工具 (`subagent.ts:1002-1009`) 传入的是**主 session 的 sessionId**，所以 session approval mode 对 subagent 也生效。这是正确的行为，但设计上是"碰巧"正确而非显式设计。

---

## 9. 缺少 Subagent 级别的超时机制

主 Agent 的 `DEFAULT_RUN_BUDGET` 限制了工具调用次数，但没有 wall-clock 超时。Subagent 更是两者都没有。一个失控的 subagent 可能无限运行。

---

## 优化建议（按优先级排列）

1. **Subagent 审批不应回滚整个主 Agent run。** 改为"暂停等待"模式：保存当前状态，审批后恢复 subagent 执行，而不是 `this.agent.state.messages = beforeAttempt`。或者至少只回滚 subagent 内部，保留主 Agent 的工具调用上下文。

2. **给 subagent 加上 RunBudget。** 至少限制工具调用次数（如 20 次）和模型调用次数（如 10 次），防止无限循环。

3. **给 subagent 加上模型回退。** 复用或简化 `buildModelFallbackSelections` 的逻辑。至少尝试 2 个候选模型。

4. **启用 subagent 的上下文压缩。** 或者在 subagent 定义中限制最大上下文使用量，防止撞墙。

5. **Chain 模式加失败检测。** 在 chain 的每一步后检查 `stopReason`，如果是 error/aborted 则终止 chain。

6. **Subagent 加 wall-clock 超时。** 比如单个 subagent 最长运行 3 分钟。

7. **把 `blockedOnHostBashApproval` 的检测从 tool 执行内部移到 tool 返回之后。** 让 subagent 正常返回（带 `stopReason: "waiting_for_approval"`），由主 Agent 的 tool_execution_end handler 统一处理，而不是在 subagent 内部就触发主 Agent abort。
