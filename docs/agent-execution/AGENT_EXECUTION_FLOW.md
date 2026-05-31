# Agent 执行流程详解

本文档详细描述 Molibot Agent 从接收用户消息到返回最终响应的完整执行流程，包括主 Agent 与 Subagent 的调度、工具调用、权限审批、模型路由、预算控制等所有环节。

---

## 目录

1. [入口层：消息到达](#1-入口层消息到达)
2. [Runtime 调度层](#2-runtime-调度层)
3. [Runner 主循环](#3-runner-主循环)
4. [模型选择与路由](#4-模型选择与路由)
5. [工具系统初始化](#5-工具系统初始化)
6. [Agent 交互循环](#6-agent-交互循环)
7. [Bash 工具执行与沙箱](#7-bash-工具执行与沙箱)
8. [Host Bash 审批流程](#8-host-bash-审批流程)
9. [Subagent 调度与执行](#9-subagent-调度与执行)
10. [Subagent 内部流程](#10-subagent-内部流程)
11. [Subagent 的 Host Bash 审批](#11-subagent-的-host-bash-审批)
12. [预算控制与续写](#12-预算控制与续写)
13. [模型回退与错误恢复](#13-模型回退与错误恢复)
14. [上下文压缩](#14-上下文压缩)
15. [Run 结束与后处理](#15-run-结束与后处理)
16. [完整时序图](#16-完整时序图)

---

## 1. 入口层：消息到达

### 1.1 Web 通道 (`src/routes/api/chat/+server.ts`)

```
POST /api/chat
```

**步骤：**

1. **解析请求** (`parseRequest`)：支持 JSON 和 multipart/form-data。提取 `userId`, `message`, `conversationId`, `profileId`, `files`, `thinkingLevel`。

2. **命令拦截** (`tryHandleWebCommand`)：检查消息是否以 `/` 开头，如果是命令则直接处理并返回：
   - `/help` — 显示帮助
   - `/models` — 查看/切换模型路由
   - `/skills` — 查看加载的技能
   - `/compact` — 手动触发上下文压缩
   - `/login` / `/logout` — OAuth 登录/登出
   - `/hosttools` — 管理 Host Bash 审批（list/approve/approve-session/reject）

3. **会话管理**：
   ```typescript
   const conversation = runtime.sessions.getOrCreateConversation("web", externalUserId, parsed.conversationId);
   ```
   - 获取或创建 conversation，生成唯一的 conversation.id
   - conversation.id 作为 sessionId 传给 Runner

4. **附件处理**：
   - 图片 → 保存到 workspace + 生成 base64 imageContents
   - 音频 → 保存到 workspace + 标记 isAudio
   - 其他文件 → 保存到 workspace

5. **Runner 获取**：
   ```typescript
   const runner = pool.get(externalUserId, conversation.id);
   ```
   - `RunnerPool` 是 `Map<"chatId::sessionId", MomRunner>` 的封装
   - 同一 session 复用同一个 MomRunner 实例（保持上下文连续性）
   - 如果 `runner.isRunning()` 返回 true，直接返回 409

6. **调用 Runner**：
   ```typescript
   const result = await runner.run({ channel, workspaceDir, chatDir, message, respond, ... });
   ```
   - 传入 `respond`, `replaceMessage`, `respondInThread`, `setTyping`, `setWorking` 等回调
   - `onRunnerEvent` 收集诊断信息

7. **返回响应**：
   ```json
   {
     "ok": true,
     "response": "<assistant text>",
     "conversationId": "...",
     "stopReason": "stop|aborted|error|waiting_for_approval",
     "diagnostics": [...]
   }
   ```

### 1.2 其他通道 (Telegram/Feishu/QQ/WeChat)

通过各自的 `XxxChannelRuntime extends BaseChannelRuntime` 实现，核心调用路径一致：
```
ChannelRuntime.receiveMessage() → runSharedTextTask() → runner.run()
```

---

## 2. Runtime 调度层

### 2.1 `BaseChannelRuntime.runSharedTextTask()` (`src/lib/server/channels/shared/baseRuntime.ts:252`)

```
runSharedTextTask(scopeId, event, options)
```

**步骤：**

1. **确定 active session**：
   ```typescript
   const activeSessionId = event.sessionId || this.store.getActiveSession(scopeId);
   ```

2. **标记运行状态**：
   ```typescript
   this.running.add(scopeId);
   ```
   防止同一 scope 并发执行。

3. **记录用户消息到会话存储**：
   ```typescript
   this.appendConversationMessage(channel, conversationKey, "user", event.text, ...);
   ```

4. **构建 MomContext** (`buildTextChannelContext`)：
   - 包装 `respond`, `replaceMessage`, `respondInThread`, `uploadFile` 等回调
   - `respondInThread` 带有计数器 `threadEventCount`

5. **执行 Runner**：
   ```typescript
   const result = await runner.run(ctx);
   ```

6. **清理**：
   ```typescript
   this.running.delete(scopeId);
   ```

---

## 3. Runner 主循环

### 3.1 `MomRunner.run()` (`src/lib/server/agent/runner.ts:1620`)

这是整个系统的核心。一个 run 的生命周期如下：

```
run() 开始
  │
  ├─ 1. 生成 runId，初始化 RunBudget
  ├─ 2. 校验 RuntimeSettings
  ├─ 3. 音频处理 (STT 路由 → 转写)
  ├─ 4. 视觉路由 (vision 模型选择)
  ├─ 5. 图片分析 (vision fallback)
  ├─ 6. 加载 Memory
  ├─ 7. 刷新 System Prompt (如有变化)
  ├─ 8. 加载 Skills (检测显式调用)
  ├─ 9. MCP 工具加载
  ├─ 10. 创建本地工具 (createMomTools)
  ├─ 11. 注册 Agent 事件订阅 (subscribe)
  ├─ 12. 模型候选遍历循环 ──────┐
  │     │                        │
  │     ├─ 13. 上下文压缩         │
  │     ├─ 14. 设置模型/thinking  │
  │     ├─ 15. 空响应重试循环 ──┐ │
  │     │     │                  │ │
  │     │     ├─ agent.prompt()  │ │
  │     │     ├─ 等待队列清空     │ │
  │     │     ├─ 检查 Host Bash  │ │
  │     │     ├─ 检查 Tool Budget│ │
  │     │     ├─ 空响应重试判断   │ │
  │     │     └─ 保存上下文       │ │
  │     │                        │ │
  │     └─ 成功 → break          │ │
  │       失败 → 下一个候选模型   │ │
  │                              │
  ├─ 16. 输出最终响应
  ├─ 17. Skill Draft 建议
  ├─ 18. Run Summary 记录
  └─ 19. 清理
```

### 3.2 关键状态变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `this.running` | `boolean` | 防止并发 run |
| `this.agent` | `Agent` (pi-agent-core) | 核心 Agent 实例，管理消息状态和 LLM 交互 |
| `stopReason` | `"stop" \| "aborted" \| "error" \| "waiting_for_approval"` | 当前 run 的终止原因 |
| `blockedOnHostBashApproval` | `boolean` | 是否因 Host Bash 审批而暂停 |
| `activeRunBudget` | `RunBudget` | 当前 run 的预算追踪 |
| `activePayloadContext` | `object` | 当前模型请求的上下文信息 |

### 3.3 事件队列机制

Runner 内部有一个串行事件队列，用于有序处理 UI 更新：

```typescript
const queue: Array<() => Promise<void>> = [];
let queueRunning = false;

const enqueue = (job) => {
  queue.push(job);
  if (!queueRunning) void runQueue();
};
```

所有 `respond`, `respondInThread`, `onRunnerEvent` 回调都通过 `enqueue` 串行化，避免竞态。

---

## 4. 模型选择与路由

### 4.1 路由类型

系统支持 6 种模型路由，每种可以独立配置：

| Route | 用途 | 配置 Key |
|-------|------|---------|
| `text` | 主对话模型 | `modelRouting.textModelKey` |
| `vision` | 图片识别模型（可与 text 相同） | `modelRouting.visionModelKey` |
| `stt` | 语音转文字 | `modelRouting.sttModelKey` |
| `tts` | 文字转语音 | `modelRouting.ttsModelKey` |
| `subagent` | Subagent 默认模型 | `modelRouting.subagentModelKey` |
| `subagent:{level}` | Subagent 按级别模型 | `subagentHaiku/Sonnet/Opus/ThinkingModelKey` |

### 4.2 Model Key 格式

```
"{mode}|{provider}|{modelId}"

示例：
  "pi|anthropic|claude-sonnet-4-5"     → 内置 provider
  "custom|my-provider|gpt-4o"          → 自定义 provider
```

### 4.3 模型选择流程 (`resolveModelSelection`)

```
1. 检查对应 route 的 modelKey
   ├─ 解析为 pi provider → 查找内置模型 → 返回
   └─ 解析为 custom provider → 查找自定义模型 → 返回

2. providerMode === "custom"
   └─ 使用 defaultCustomProviderId → 返回

3. 遍历所有 customProviders
   └─ 第一个可用的 → 返回

4. fallback → 使用 piModelProvider + piModelName
```

### 4.4 模型回退链 (`buildModelFallbackSelections`)

```
候选列表构建顺序：
1. 主选择 (primary)
2. 同 provider 的其他模型 (fallbackMode === "same-provider")
   或：不同 provider 的模型 → 同 provider 的其他模型 (fallbackMode === "any")
3. 内置 pi 模型作为最后 fallback
```

### 4.5 模型尝试循环 (`runner.ts:2226`)

```typescript
for (let candidateIndex = 0; candidateIndex < modelCandidates.length; candidateIndex++) {
  // 1. 检查 budget 是否允许
  // 2. 解析 API Key
  // 3. 设置 agent.state.model
  // 4. candidateIndex === 0 时执行上下文压缩
  // 5. 空响应重试循环 (最多 MAX_EMPTY_RETRIES=2 次)
  // 6. 成功 → break
  //    失败 → continue 到下一个候选模型
}
```

---

## 5. 工具系统初始化

### 5.1 `createMomTools()` (`src/lib/server/agent/tools/index.ts:102`)

创建主 Agent 可用的所有工具：

```
工具列表（按创建顺序）：

始终可用：
  ├─ memory          — 读写记忆 (短期/长期/每日)
  ├─ skillSearch     — 搜索可用技能
  ├─ toolSearch      — 搜索/加载延迟工具
  ├─ read            — 读取文件
  ├─ bash            — 执行 Shell 命令 (沙箱 + Host Bash 审批)
  ├─ edit            — 编辑文件 (精确文本替换)
  ├─ write           — 创建/覆写文件
  ├─ subagent        — 委派子任务给 Subagent
  └─ attach          — 上传文件附件

延迟加载 (通过 toolSearch 激活)：
  ├─ createEvent     — 创建定时/重复事件
  ├─ switchModel     — 切换模型路由
  ├─ skillManage     — 管理技能文件
  └─ profileFiles    — 管理 Bot 配置文件

条件可用：
  └─ loadMcp         — 加载 MCP 服务器工具 (需显式调用或技能需求)

功能插件：
  └─ featureTools    — 通过 FeaturePlugin 注册
```

### 5.2 工具序列化 (`wrapSerializedTool`)

部分工具标记为 `executionMode: "sequential"`，通过 Promise 链保证同一工具的多次调用串行执行：

```typescript
let chain = Promise.resolve();
// 每次调用追加到链尾
chain = chain.then(run, run);
```

### 5.3 延迟工具加载机制

某些工具（createEvent, switchModel, skillManage, profileFiles）默认不直接暴露，而是通过 `toolSearch` 间接发现：

1. `toolSearch` 返回所有延迟工具的列表（名称、描述、关键词）
2. 模型调用延迟工具 stub → stub 触发 `loadDeferredTools`
3. 工具被加载到 `loadedDeferredToolNames` Set
4. `onLocalToolsChanged` 回调更新 `agent.state.tools`

---

## 6. Agent 交互循环

### 6.1 `agent.prompt()` 调用

```typescript
await this.agent.prompt(userMessage, images?);
```

`pi-agent-core` 的 Agent 类内部实现以下循环：

```
prompt(userMessage)
  │
  ├─ 1. 追加 userMessage 到 state.messages
  ├─ 2. 调用 streamFn(model, context) → LLM API
  ├─ 3. 流式接收 assistant message
  │     ├─ text_delta → 触发 message_update 事件
  │     └─ tool_call → 累积到 content
  ├─ 4. assistant message 完成
  │     ├─ 有 tool_calls → 执行工具 → 回到步骤 2
  │     └─ 无 tool_calls → 返回
  └─ 5. 返回最终 assistant message
```

### 6.2 Agent 事件类型 (`subscribe` 回调)

| 事件 | 触发时机 | Runner 中的处理 |
|------|---------|----------------|
| `message_start` (assistant) | LLM 开始生成回复 | 初始化流式文本追踪 |
| `message_update` | LLM 流式输出 text_delta | 累积 `streamedAssistantText`，发送 typing 事件 |
| `tool_execution_start` | 开始执行工具 | 记录工具名，通知 UI |
| `tool_execution_end` | 工具执行完成 | 检查 Host Bash Approval，更新预算，检查 subagent 委托建议 |
| `message_end` (assistant) | LLM 回复完成 | 记录 usage，发送最终文本 |

### 6.3 `beforeToolCall` 钩子 (`runner.ts:1390`)

在工具执行前调用，做两层校验：

```typescript
beforeToolCall: async (context) => {
  // 1. 安全策略校验 (validateToolCallPreflight)
  const blockedReason = validateToolCallPreflight(context, { cwd, workspaceDir });

  // 2. 预算校验
  const budgetResult = this.activeRunBudget?.tryStartTool();

  // 任一失败 → block
  if (finalBlockedReason) return { block: true, reason: finalBlockedReason };
}
```

---

## 7. Bash 工具执行与沙箱

### 7.1 `createBashTool()` (`src/lib/server/agent/tools/bash.ts:347`)

Bash 工具的执行流程：

```
bash.execute({ command, timeout, hostApproval? })
  │
  ├─ 1. 检查是否已有已批准的 Host Bash 条目
  │     ├─ tryParseHostBashCommand(command)
  │     ├─ findApprovedHostBash(store, parsed)
  │     └─ 找到 → executeApprovedHostBash() → 直接在主环境执行 → 返回
  │
  ├─ 2. 检查是否显式请求 hostApproval
  │     └─ params.hostApproval → requestApprovalFromBash() → 返回审批请求
  │
  ├─ 3. 正常沙箱执行路径
  │     ├─ 创建 artifactDir
  │     ├─ 快照根目录文件 (用于后续 artifact 移动)
  │     ├─ wrapCommandWithVenv(command) — 包装 Python venv
  │     ├─ prepareToolSandboxExecution() — OS 级沙箱
  │     ├─ execCommand() — 执行命令
  │     ├─ moveNewRootArtifacts() — 移动生成的 artifact
  │     ├─ captureSayTranscript() — 捕获 macOS say 命令
  │     └─ 成功 → 返回输出
  │
  └─ 4. 沙箱执行失败 (exit code ≠ 0)
        ├─ 检查是否为权限错误 (isSandboxPermissionFailure)
        ├─ 检查 session host approval mode
        │     └─ "session" → 自动 bypass 沙箱重试
        ├─ 尝试解析为 Host Bash 命令
        │     └─ 成功 → 自动请求 Host Bash 审批
        └─ 都不是 → 抛出错误 (含沙箱提示)
```

### 7.2 沙箱执行 (`prepareToolSandboxExecution`)

根据 `settings.toolSandbox.enabled` 决定是否使用 OS 级沙箱：
- **macOS**: 使用 `sandbox-exec` 搭配预定义的沙箱 profile
- **Linux**: 使用 `bwrap` (Bubblewrap)
- **禁用时**: 直接执行，`sandboxApplied = false`

沙箱限制包括：
- 文件系统访问范围（workspace + scratch + 临时目录）
- 网络访问限制
- 进程创建限制

---

## 8. Host Bash 审批流程

### 8.1 数据模型

**HostBashStore** (SQLite 持久化) 管理两类数据：

```
HostBashApprovalRecord (审批记录)
  ├─ id: 唯一审批 ID
  ├─ toolId: 工具标识 (sanitized command)
  ├─ command: 完整命令
  ├─ displayName: 显示名称
  ├─ approvalMode: "ephemeral" | "persistent"
  ├─ status: "pending" | "approved" | "rejected" | "executed" | "failed"
  ├─ permissions: { filesystem, network, envAllowlist }
  ├─ pendingAction: 待执行的操作 (序列化)
  └─ scopeId, sessionId, channel

ApprovedHostBashEntry (白名单条目)
  ├─ toolId: 工具标识
  ├─ command: 命令模板
  ├─ displayName: 显示名称
  ├─ enabled: 是否启用
  ├─ permissions: { filesystem, network, envAllowlist }
  └─ createdAt, lastUsedAt
```

### 8.2 审批请求流程 (`requestApprovalFromBash`)

```
requestApprovalFromBash(options, command, timeout, approval)
  │
  ├─ 1. parseHostBashApprovalCommand(command)
  │     解析命令字符串，提取 toolId、approvalMode、args
  │
  ├─ 2. store.requestApproval({ toolId, command, ... })
  │     │
  │     ├─ 检查是否已有 approved 条目
  │     │     └─ 有 → 返回 { kind: "existing-approved", approved }
  │     │
  │     ├─ 检查是否已有 pending 记录
  │     │     └─ 有 → 返回 { kind: "existing-pending", approval }
  │     │
  │     └─ 创建新记录 → 返回 { kind: "new", approval }
  │
  └─ 3. 根据返回类型构建响应
        ├─ existing-approved → "已批准，可直接执行"
        ├─ existing-pending → "审批等待中..." + HostBashApprovalPrompt
        └─ new → "审批请求已创建..." + HostBashApprovalPrompt
```

### 8.3 审批处理流程 (Web 通道)

用户通过 `/hosttools` 命令管理审批：

```
/hosttools                          → 列出 pending + whitelist
/hosttools approve <id>             → 批准并持久化到 whitelist
/hosttools approve-session <id>     → 仅当前 session 有效
/hosttools reject <id>              → 拒绝
```

**批准后的执行路径** (`handleWebHostToolsCommand`, `+server.ts:156`)：

```typescript
// 1. store.approve(scopeId, approvalId, { persistWhitelist })
// 2. 如果是 approve-session → store.setSessionHostApprovalMode("session")
// 3. 立即执行 pendingAction:
const executed = await executeHostBashApproval({
  record: approved.record,
  approvedTool: approved.approved,
  cwd: store.getChatDir(scopeId)
});
// 4. store.markExecution(id, "executed")
```

### 8.4 主 Agent 检测 Host Bash Approval

在 Agent 的 `subscribe` 回调中 (`runner.ts:2032-2107`)：

```typescript
if (event.type === "tool_execution_end") {
  const hostBashApproval = extractHostBashApprovalPrompt(event.result);
  if (hostBashApproval) {
    blockedOnHostBashApproval = true;
    stopReason = "waiting_for_approval";
    this.agent.abort();  // ← 立即中止 Agent
  }
}
```

然后在主循环中 (`runner.ts:2424`)：

```typescript
if (blockedOnHostBashApproval) {
  candidateFinalText = hostBashApprovalWaitMessage;
  this.agent.state.messages = beforeAttempt;  // ← 回滚消息
  break;
}
```

### 8.5 Session Host Approval Mode

当用户使用 `/hosttools approve-session` 批准后：

1. `store.setSessionHostApprovalMode(scopeId, sessionId, "session")` — 内存标记
2. 之后 bash 工具遇到沙箱权限错误时 (`bash.ts:462`)：
   ```typescript
   if (store.getSessionHostApprovalMode(scopeId, sessionId) === "session") {
     // 自动 bypass 沙箱，直接在主环境执行
     const fallbackResult = await execCommand(wrappedCommand, {
       inheritProcessEnv: true  // ← 不经过沙箱
     });
   }
   ```

---

## 9. Subagent 调度与执行

### 9.1 触发方式

主 Agent 通过调用 `subagent` 工具来委派任务。支持三种模式：

```typescript
// 1. 单一任务
{ agent: "scout", task: "查找所有 API 端点" }

// 2. 并行任务 (最多 4 个并发)
{
  tasks: [
    { agent: "scout", task: "查找 API 端点" },
    { agent: "reviewer", task: "审查认证逻辑" }
  ],
  maxConcurrency: 2
}

// 3. 链式任务 ({previous} 占位符传递上一步输出)
{
  chain: [
    { agent: "scout", task: "分析代码结构" },
    { agent: "planner", task: "基于分析结果制定方案: {previous}" },
    { agent: "worker", task: "实施方案: {previous}" }
  ]
}
```

### 9.2 Subagent 类型与权限

| Subagent | 工具 | 模型级别 | 典型用途 |
|----------|------|---------|---------|
| `scout` | read, bash (只读) | haiku | 代码搜索、信息收集 |
| `planner` | read, bash (只读) | sonnet | 方案设计、任务分解 |
| `worker` | read, bash, edit, write | sonnet | 代码实现、文件修改 |
| `reviewer` | read, bash (只读) | sonnet | 代码审查、diff 检查 |
| `skill-drafter` | read, bash (只读) | haiku | 技能草稿生成 |

只读 bash 的白名单正则 (`REVIEW_BASH_ALLOWLIST`)：
```
git diff/show/log, rg, grep, find, ls, pwd, date, cat, head, tail, wc, sed -n, stat
```
任何包含 shell 控制操作符 (`;`, `|`, `&`, `>`, `<`, `$(`) 的命令会被拒绝。

### 9.3 `createSubagentTool().execute()` 主流程

```
subagent.execute(params)
  │
  ├─ 1. parseSubagentMode(params)
  │     └─ 验证正好一种模式 (single/parallel/chain)，返回任务列表
  │
  ├─ 2. emitRunnerEvent({ phase: "start" })
  │
  ├─ 3. 按模式执行:
  │     ├─ single: runTask(item, 0, item.task)
  │     ├─ parallel: mapWithConcurrency(tasks, maxConcurrency, runTask)
  │     └─ chain: forEach → runTask → 替换 {previous} → 下一步
  │
  ├─ 4. 每个任务完成 → finished.push(result) → emitProgress()
  │
  ├─ 5. emitRunnerEvent({ phase: "end", stopReason })
  │
  └─ 6. summarizeSubagentResultsForParent(mode, results)
        └─ 压缩长输出 (前 4000 字符 + 后 1500 字符)
```

### 9.4 并发控制 (`mapWithConcurrency`)

```typescript
// 用 worker pool 模式控制并发
const workers = Math.min(concurrency, tasks.length);
// 每个 worker 循环抢占 cursor 指向的任务
while (cursor < tasks.length) {
  const current = cursor++;
  results[current] = await fn(tasks[current], current);
}
```

---

## 10. Subagent 内部流程

### 10.1 `runSingleSubagent()` (`subagent.ts:637`)

这是 subagent 的核心执行函数：

```
runSingleSubagent(agent, task, options)
  │
  ├─ 1. 模型解析 (resolveSubagentModel)
  │     ├─ 检查 modelLevel (haiku/sonnet/opus/thinking) → 对应 route key
  │     ├─ 检查 subagentModelKey (通用 subagent 路由)
  │     ├─ 检查 modelHint (agent 定义中的显式模型)
  │     └─ fallback → 主 text 模型
  │
  ├─ 2. 创建 SettingsManager (compaction 禁用)
  │
  ├─ 3. 创建 ResourceLoader
  │     ├─ noExtensions, noSkills, noPromptTemplates, noThemes, noContextFiles
  │     └─ appendSystemPrompt: [RUNTIME_PROMPT_APPEND, artifactPrompt, agent.systemPrompt]
  │
  ├─ 4. 创建自定义工具 (createCustomTools)
  │     ├─ read — 始终创建
  │     ├─ bash — 始终创建 (根据 agent 类型限制只读或全功能 + hostApproval)
  │     ├─ edit — 仅 worker
  │     └─ write — 仅 worker
  │
  ├─ 5. 创建 Session (createAgentSession)
  │     ├─ model, thinkingLevel, authStorage, modelRegistry
  │     ├─ tools: agent.tools 或默认 ["read", "bash", "edit", "write"]
  │     └─ customTools: read + bash + edit/write
  │
  ├─ 6. 注册 Session 事件订阅
  │     ├─ message_start (assistant) → 记录 LLM 调用次数
  │     ├─ message_end (assistant) → 记录 usage
  │     ├─ tool_execution_start → 记录工具调用次数
  │     ├─ tool_execution_end → 检查 hostBashApproval
  │     │     └─ 有 → emitRunnerEvent + session.abort()
  │     └─ (不处理 Host Tool Approval — subagent 不支持 Host Tool)
  │
  ├─ 7. session.prompt(task) — 执行!
  │
  ├─ 8. 构建结果:
  │     ├─ output: getAssistantText(lastAssistant)
  │     ├─ stopReason: "stop" | "aborted" | "error" | "waiting_for_approval"
  │     ├─ usage: buildUsage(messages)
  │     └─ model: session.model.id
  │
  └─ 9. finally: unsubscribe, session.dispose()
```

### 10.2 Subagent 的 System Prompt 构成

```
[RUNTIME_PROMPT_APPEND]  — 通用 subagent 行为约束
  "You are a delegated subagent running inside Molibot."
  "- Another agent will consume your result..."
  "- Focus only on the delegated task..."

[artifactPrompt]  — 文件生成路径提示 (如有 artifactDir)

[agent.systemPrompt]  — 从 subagent-agents/{name}.md 加载的角色定义
```

### 10.3 Subagent 与主 Agent 的差异

| 特性 | 主 Agent | Subagent |
|------|---------|---------|
| 模型选择 | 完整路由 + 回退链 | 单一模型路由（无回退） |
| 上下文压缩 | 自动压缩 | 禁用 |
| 工具预算 | RunBudget (限制次数) | 无预算限制 |
| 工具集 | 完整工具集 (~15 个) | 2-4 个基础工具 |
| Memory | 有 | 无 |
| Skills | 有 | 无 |
| MCP 工具 | 有条件加载 | 无 |
| 事件通知 | 完整 UI 事件 | 内部日志 + emitRunnerEvent |
| Host Bash 审批 | 支持（显式 + 自动） | 支持（仅自动） |
| Host Tool 审批 | 支持 | 不支持 |

---

## 11. Subagent 的 Host Bash 审批

### 11.1 触发路径

```
Subagent 的 bash 工具执行
  │
  ├─ 沙箱拦截 → exit code ≠ 0
  ├─ isSandboxPermissionFailure(output) → true
  ├─ parsedHostBashCommand → 成功解析
  └─ requestApprovalFromBash() → 写入 HostBashStore
       │
       └─ 返回 { hostBashApproval prompt }
            │
            ├─ subagent session subscribe 检测到
            │     ├─ void emitRunnerEvent({ hostBashApproval })  ← 通知主 Runner
            │     └─ void session.abort()                        ← 中止 subagent
            │
            └─ 主 Runner 的 emitRunnerEvent (createMomTools 中定义)
                  ├─ blockedOnHostBashApproval = true
                  ├─ stopReason = "waiting_for_approval"
                  └─ this.agent.abort()  ← 中止主 Agent
```

### 11.2 关键：审批 Store 是共享的

Subagent 的 bash 工具通过 `hostApproval` 参数访问的是**同一个** `HostBashStore` 单例：

```typescript
// subagent.ts:1002 — 传入 hostApproval 选项
hostApproval: {
  channel: options.channel,
  chatId: options.chatId,
  scopeId: options.chatId,      // ← 与主 Agent 相同的 scope
  sessionId: options.sessionId,  // ← 主 session ID
  store: options.store           // ← 同一个 MomRuntimeStore
}

// bash.ts:246 — 使用同一个 Store
const store = options.hostBashStore ?? getHostBashStore();
```

因此：
- 审批记录存储在同一位置
- 用户在 Web UI 批准后，`HostBashStore` 中的记录被更新
- 如果批准为 persistent，下次任何 bash 工具（主或 sub）遇到同一命令会自动执行
- `session host approval mode` 也共享（因为用的是主 session ID）

### 11.3 审批后的恢复问题

审批完成后，流程是：

1. 用户在 Web UI 批准 → `executeHostBashApproval()` 立即执行命令
2. 但 subagent session 已经被 `dispose()` 了
3. 主 Agent 的 run 已返回 `stopReason: "waiting_for_approval"`
4. 用户发送后续消息（或系统自动 followUp）→ 新的 `runner.run()` 被调用
5. 主 Agent 重新开始，可能再次调用 subagent
6. 新的 subagent 从头开始执行

**结果：subagent 在审批前的所有工作（工具调用、LLM 推理）全部丢失。**

---

## 12. 预算控制与续写

### 12.1 RunBudget (`src/lib/server/agent/runtimeBudget.ts`)

```typescript
DEFAULT_RUN_BUDGET = {
  maxToolCalls: 24,        // 最大工具调用次数
  maxToolFailures: 6,      // 最大工具失败次数
  maxModelAttempts: 6,     // 最大模型尝试次数
}
```

### 12.2 预算追踪

- `budget.tryStartTool()` → 每次工具调用前检查/计数
- `budget.recordToolResult(isError)` → 工具完成后记录
- `budget.tryRecordModelAttempt()` → 模型尝试前检查
- `budget.getExceededReason()` → 获取超限原因

### 12.3 工具预算耗尽时的续写机制 (`runner.ts:2455-2543`)

当 `budget.getExceededReason()` 包含 "too many tool calls" 时：

```
1. 检查是否已用过续写 (toolBudgetContinuationUsed)
2. 记录 runtime event (TOOL_BUDGET_EXHAUSTED)
3. beginContinuationResponse(已有文本, 预算提示)
4. 清空流式文本状态
5. 临时移除所有工具: this.agent.state.tools = []
6. 发送 runtime notice 给模型
7. agent.prompt(TOOL_BUDGET_RUNTIME_NOTICE)  ← 无工具续写
8. 恢复工具: this.agent.state.tools = previousTools
9. 清除 runtime notices
10. 拼接续写结果 + 手动继续提示
```

续写只执行一次。

### 12.4 Subagent 委托建议 (`SUBAGENT_DELEGATION_NOTICE_TOOL_CALLS`)

当工具调用超过 12 次且未使用过 subagent 时，自动注入运行时通知：

```typescript
if (!subagentDelegationNoticeSent &&
    currentBudget.toolCalls >= 12 &&
    !usedToolNames.includes("subagent") &&
    tools.some(t => t.name === "subagent")) {
  this.agent.followUp({
    role: "user",
    content: [{ type: "text", text: SUBAGENT_DELEGATION_RUNTIME_NOTICE }]
  });
}
```

---

## 13. 模型回退与错误恢复

### 13.1 错误分类

| 错误类型 | 判断条件 | 行为 |
|---------|---------|------|
| `missing_api_key` | API key 为空 | 跳过该候选，尝试下一个 |
| `request_error` (retryable) | `isRetryableModelError(message)` | 同模型重试（在空响应重试循环内）或换候选 |
| `request_error` (terminal) | 非 retryable | 换候选模型 |
| `empty_response` | 模型返回空文本 (3 次重试后) | 换候选模型 |
| `context_overflow` | 错误消息包含 context length 关键词 | 压缩上下文后重试（仅一次） |

### 13.2 空响应重试循环

同一模型最多重试 `MAX_EMPTY_RETRIES = 2` 次：

```typescript
while (attemptCount <= MAX_EMPTY_RETRIES) {
  await this.agent.prompt(userMessage, images);
  // 检查结果...
  const decision = resolvePromptAttemptDecision({ stopReason, finalText, attemptCount });
  if (decision.kind === "retryable_error") {
    this.agent.state.messages = beforeAttempt;  // 回滚
    attemptCount++;
    continue;
  }
  break;
}
```

### 13.3 上下文溢出特殊处理

```typescript
if (!overflowRetryUsed && isContextOverflowError(message)) {
  overflowRetryUsed = true;
  this.agent.state.messages = beforeAttempt;
  const compacted = await this.compact({ reason: "threshold" });
  if (compacted.changed) continue;  // 压缩后重试
}
```

### 13.4 模型失败记录

所有失败都通过 `ModelErrorTracker` 记录，包含：
- provider, model, api
- baseUrl, endpointUrl
- candidateIndex, recovered, fallbackUsed
- finalProvider, finalModel (如果最终恢复成功)

---

## 14. 上下文压缩

### 14.1 触发条件 (`shouldCompactContext`)

基于 token 估算和 compaction settings 判断是否需要压缩。

### 14.2 压缩流程 (`compactContextMessages`)

```
1. 估算当前上下文 token 数
2. 判断是否超过阈值
3. 选择要压缩的消息范围 (保留最近的 N 条)
4. 调用压缩模型生成摘要
5. 用摘要替换被压缩的消息
6. 返回新消息列表
```

### 14.3 自动压缩时机

- 每次 `runner.run()` 开始时，在第一个候选模型尝试前
- 上下文溢出时，在重试前

### 14.4 Subagent 的压缩

Subagent **明确禁用**了上下文压缩：

```typescript
// subagent.ts:661
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false }
});
```

---

## 15. Run 结束与后处理

### 15.1 输出最终响应

```
有文本 → ctx.replaceMessage(finalText)
        ├─ 如果有模型回退 → respondInThread(回退信息)
        └─ 如果以 [SILENT] 开头 → ctx.deleteMessage()

无文本 → 构建错误消息
        └─ ctx.replaceMessage(emptyResponseMessage)
```

### 15.2 Skill Draft 建议 (`shouldSuggestSkillDraft`)

在 run 结束后，根据以下条件判断是否建议创建 Skill：
- stopReason 不是 error/aborted
- 工具调用足够多
- 有工具失败
- 多次模型尝试
- 未显式使用已有 skill

如果满足条件，通过 subagent 生成 skill draft metadata，保存到 workspace。

### 15.3 Run Summary 记录

每次 run 结束后记录到 store：
```typescript
store.appendRunSummary(chatId, {
  runId, sessionId, stopReason, durationMs,
  finalText, toolNames, failedToolNames,
  explicitSkillNames, usedFallbackModel,
  modelFailureSummaries, budget, budgetLimits,
  usage, memorySnapshot, skillDraft, reflection, errorMessage
});
```

### 15.4 清理

```typescript
finally {
  unsubscribe();
  this.activeRunBudget = undefined;
  this.activeRunnerEventSink = undefined;
  this.activePayloadContext = undefined;
  this.running = false;
}
```

---

## 16. 完整时序图

### 16.1 正常执行流程（无审批）

```
用户          +server.ts       BaseRuntime       Runner           Agent           LLM API        工具
 │                │                │                │                │                │             │
 │  POST /chat    │                │                │                │                │             │
 ├───────────────>│                │                │                │                │             │
 │                │ runSharedTask  │                │                │                │             │
 │                ├───────────────>│                │                │                │             │
 │                │                │  runner.run()  │                │                │             │
 │                │                ├───────────────>│                │                │             │
 │                │                │                │ 加载 Memory    │                │             │
 │                │                │                ├───────────────┤                │             │
 │                │                │                │ 创建 Tools     │                │             │
 │                │                │                ├───────────────┤                │             │
 │                │                │                │ compact()      │                │             │
 │                │                │                ├───────────────┤                │             │
 │                │                │                │ agent.prompt() │                │             │
 │                │                │                ├───────────────>│                │             │
 │                │                │                │                │ streamSimple() │             │
 │                │                │                │                ├───────────────>│             │
 │                │  typing...     │  typing...     │                │                │             │
 │                │<───────────────│<───────────────│<───────────────│                │             │
 │                │                │                │                │  text_delta    │             │
 │                │  respond(text) │                │                │<───────────────│             │
 │                │<───────────────│<───────────────│<───────────────│                │             │
 │                │                │                │                │  [tool_calls]  │             │
 │                │                │                │                ├───────────────>│             │
 │                │                │                │                │                │ execute     │
 │                │                │                │                │                ├────────────>│
 │                │                │                │                │                │   result     │
 │                │                │                │                │                │<────────────┤
 │                │                │                │                │  next prompt   │             │
 │                │                │                │                ├───────────────>│             │
 │                │                │                │                │  text_delta    │             │
 │                │                │                │                │<───────────────│             │
 │                │  respond(text) │                │                │                │             │
 │                │<───────────────│<───────────────│<───────────────│                │             │
 │                │                │                │  finalText     │                │             │
 │                │  replaceMsg    │                │<───────────────│                │             │
 │                │<───────────────│<───────────────│                │                │             │
 │                │                │                │                │                │             │
 │  HTTP 200      │                │                │                │                │             │
 │<───────────────│                │                │                │                │             │
```

### 16.2 Host Bash 审批流程（主 Agent）

```
Runner           Agent           Bash Tool       HostBashStore    用户
 │                │                │                │                │
 │ agent.prompt() │                │                │                │
 ├───────────────>│                │                │                │
 │                │ tool_call bash │                │                │
 │                ├───────────────>│                │                │
 │                │                │ sandbox 拦截   │                │
 │                │                ├───────────────>│                │
 │                │                │ requestAppr()  │                │
 │                │                │<───────────────│                │
 │                │                │ (hostBashApproval in details)   │
 │                │ tool_end event │                │                │
 │                │<───────────────│                │                │
 │                │                │                │                │
 │ subscribe: hostBashApproval!    │                │                │
 │ blockedOn=true, agent.abort()   │                │                │
 │                │                │                │                │
 │ agent.prompt() 返回 (aborted)   │                │                │
 │<───────────────│                │                │                │
 │                │                │                │                │
 │ messages=beforeAttempt (回滚)   │                │                │
 │ run() 返回 waiting_for_approval │                │                │
 │                │                │                │                │
 │                │                │                │  /hosttools    │
 │                │                │                │  approve <id>  │
 │                │                │                │<───────────────│
 │                │                │                │                │
 │                │                │                │ execute 命令    │
 │                │                │                ├───────────────>│
 │                │                │                │                │
 │ (用户发送 "继续" / followUp)    │                │                │
 │                │                │                │                │
 │ 新的 run()     │                │                │                │
 ├───────────────>│                │                │                │
 │ agent.prompt() │                │                │                │
 ├───────────────>│                │                │                │
 │                │ tool_call bash │                │                │
 │                ├───────────────>│                │                │
 │                │                │ findApproved!  │                │
 │                │                ├───────────────>│                │
 │                │                │ 直接执行       │                │
 │                │                │<───────────────│                │
 │                │ 正常继续...    │                │                │
```

### 16.3 Host Bash 审批流程（Subagent）

```
Runner           Agent           Subagent Tool    Subagent Session  Bash Tool    HostBashStore
 │                │                │                │                │             │
 │ agent.prompt() │                │                │                │             │
 ├───────────────>│                │                │                │             │
 │                │ tool_call      │                │                │             │
 │                │ subagent       │                │                │             │
 │                ├───────────────>│                │                │             │
 │                │                │ runSingleSub() │                │             │
 │                │                ├───────────────>│                │             │
 │                │                │                │ session.prompt()              │
 │                │                │                ├───────────────>│             │
 │                │                │                │                │ sandbox 拦截│
 │                │                │                │                ├────────────>│
 │                │                │                │                │ requestAppr│
 │                │                │                │                │<────────────┤
 │                │                │                │                │             │
 │                │                │                │ tool_end event │             │
 │                │                │                │ (hostBash)     │             │
 │                │                │                │<───────────────│             │
 │                │                │                │                │             │
 │                │                │                │ emitRunnerEvt()│             │
 │                │                │<───────────────│ (hostBash)     │             │
 │                │                │                │                │             │
 │                │                │                │ session.abort()│             │
 │                │                │                ├───────────────>│             │
 │                │                │                │                │             │
 │ emitRunnerEvt  │                │                │                │             │
 │ (hostBash)     │                │                │                │             │
 │<───────────────│                │                │                │             │
 │                │                │                │                │             │
 │ blockedOn=true │                │                │                │             │
 │ agent.abort()  │                │                │                │             │
 │                │                │                │                │             │
 │ agent.prompt() │                │                │                │             │
 │ 返回 (aborted) │                │                │                │             │
 │<───────────────│                │                │                │             │
 │                │                │                │                │             │
 │ messages=beforeAttempt (回滚)   │                │                │             │
 │ run() 返回 waiting_for_approval │                │                │             │
 │                │                │                │                │             │
 │                │ session.dispose() ← 无法恢复!  │                │             │
```

### 16.4 模型回退流程

```
Runner: candidateIndex = 0 (primary model)
  │
  ├─ agent.prompt()
  │     └─ 失败 (request_error / empty_response / api_key missing)
  │
  ├─ messages = beforeAttempt (回滚)
  │
  ├─ candidateIndex = 1 (fallback model)
  │     ├─ agent.state.model = fallbackModel
  │     ├─ agent.state.thinkingLevel = resolveThinking(...)
  │     ├─ agent.sessionId = buildAgentSessionId(...)
  │     └─ agent.prompt()
  │           └─ 成功! → break
  │
  └─ 记录: modelFailures[], recordModelFailure()
     └─ recovered=true, fallbackUsed=true
```

### 16.5 Tool Budget 耗尽流程

```
Runner: agent.prompt()
  │
  ├─ ... 24 次工具调用 ...
  │
  ├─ tool_execution_end
  │     └─ budget.recordToolResult() → !ok
  │           └─ budget.getExceededReason() = "too many tool calls"
  │
  ├─ toolBudgetContinuationUsed = false
  │
  ├─ beginContinuationResponse(已有文本, 提示)
  │
  ├─ 临时移除工具
  │     this.agent.state.tools = []
  │
  ├─ agent.prompt(TOOL_BUDGET_RUNTIME_NOTICE)
  │     └─ 模型生成最终答案 (无工具调用)
  │
  ├─ 恢复工具
  │     this.agent.state.tools = previousTools
  │
  ├─ 拼接结果
  │     finalText = continuationText + "\n\n" + manualContinueNotice
  │
  └─ 返回
```

---

## 附录：关键文件索引

| 文件 | 职责 |
|------|------|
| `src/routes/api/chat/+server.ts` | Web 通道入口，消息解析，命令处理，审批管理 |
| `src/lib/server/channels/shared/baseRuntime.ts` | 通道 Runtime 基类，队列管理，任务调度 |
| `src/lib/server/agent/runner.ts` | Runner 主循环，模型路由，预算控制，事件订阅 |
| `src/lib/server/agent/tools/index.ts` | 工具创建工厂，工具注册，延迟加载 |
| `src/lib/server/agent/tools/bash.ts` | Bash 工具，沙箱执行，Host Bash 审批请求 |
| `src/lib/server/agent/tools/subagent.ts` | Subagent 工具，任务解析，并发控制，结果汇总 |
| `src/lib/server/agent/hostBashExec.ts` | Host Bash 命令执行引擎 |
| `src/lib/server/agent/hostToolExec.ts` | Host Tool 命令执行引擎（独立于 Bash） |
| `src/lib/server/hostBash/index.ts` | HostBashStore，审批数据模型，持久化 |
| `src/lib/server/agent/runtimeBudget.ts` | RunBudget 预算控制 |
| `src/lib/server/agent/compaction.ts` | 上下文压缩逻辑 |
| `src/lib/server/agent/runnerRetryState.ts` | 重试状态判断 |
