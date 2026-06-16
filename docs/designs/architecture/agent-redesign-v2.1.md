# Agent 精简优化架构改造方案 v2.1

**日期：** 2026-05-27
**定位：** 基于 Pi 的个人 Agent Runtime 精简改造方案
**目标：** 保留核心收益，降低重构复杂度，避免过度设计

---

## 1. 总体结论

v2.0 的核心方向是正确的：

```text
基于 Pi 继续演进
删除 ACP
引入 Workspace
统一 Turn 流程
统一 Tool 执行
增强 Approval scope
逐步拆分 Settings
保持 Skill 轻量标准
复用现有 Plugin 系统
```

但 v2.0 的问题是：**目标架构偏理想化，模块拆分过细，迁移阶段过多，短期落地成本偏高。**

因此 v2.1 的改造原则是：

> **保留 80% 架构收益，砍掉 50% 重构复杂度。**

不追求一次性重构成完美平台，而是围绕真实痛点做最小必要改造。

---

# 2. 本版核心调整

## 2.1 从“完整平台重构”改为“主链路收敛”

v2.0 更像是在设计一个完整 Agent Platform：

```text
AppRuntime
PluginManager
SkillLoader
TurnOrchestrator
ToolRuntime
PolicyEngine
ApprovalBroker
SandboxRuntime
MemoryRuntime
RunlogRuntime
WorkspaceRuntime
...
```

v2.1 改为主链路收敛：

```text
Channel
  -> TurnOrchestrator
  -> Pi Agent Runtime
  -> ToolRuntime
  -> Approval / Sandbox
```

核心只新增少数关键模块：

```text
Workspace
TurnOrchestrator
ToolRuntime
ApprovalScope
```

其他能力优先复用现有实现。

---

## 2.2 从“新增很多 Runtime”改为“复用现有模块”

v2.1 不新增：

```text
新的 PluginManager
完整 PolicyEngine
完整 SandboxRuntime
完整 MemoryRuntime
复杂 Subagent 类型系统
复杂 SkillRuntime
```

改为：

```text
复用现有 Plugin 系统
复用现有 Skill 系统
复用现有 memory/
复用现有 toolSandbox.ts
复用现有 HostBashStore
复用现有 runlog 能力
```

但会在主流程中重新整理这些模块的调用顺序。

---

## 2.3 从“一次性迁移”改为“渐进式迁移”

尤其是 Settings，不能一次性全部拆掉。

v2.1 采用：

```text
settings.json 继续可读
SQLite 新配置优先
启动时 migration
UI 写 SQLite
保留兼容期
```

这样避免一次性修改所有配置路径导致系统不可用。

---

# 3. 改造目标

最终系统应该变成：

```text
Pi-based Personal Agent Runtime
```

核心能力：

```text
1. Pi 负责 Agent Loop
2. Workspace 定义上下文和权限边界
3. TurnOrchestrator 统一所有入口
4. ToolRuntime 统一所有工具调用
5. Approval 支持 scope 和聚合
6. Sandbox 继续复用现有实现，但收口到 ToolRuntime
7. Skill 保持标准目录 + SKILL.md
8. Plugin 复用现有系统，只做 Runtime 能力扩展
9. Settings 渐进拆分
```

非目标：

```text
不做完整 Agent OS
不重写 Plugin 系统
不重写 Memory 系统
不重写 Skill 标准
不引入复杂 Subagent 角色体系
不一次性重构所有模块
```

---

# 4. 改造前后架构对比

## 4.1 当前问题

当前架构的主要问题不是单个模块写得不好，而是边界逐渐变宽：

```text
多渠道入口
  -> 各自处理部分消息逻辑

Agent Runtime
  -> 同时承担 prompt、tools、memory、sandbox、approval、channel 状态

Settings
  -> RuntimeSettings 巨型对象

ACP
  -> 引入外部 coding agent control plane 复杂度

Approval
  -> 只有 pending / approved / rejected
  -> 缺少 once / session / workspace 等 scope
```

导致的问题：

```text
新增功能容易改到主流程
权限逻辑分散
approval 频率高
subagent 审批向上传递困难
settings 变更风险大
ACP 增加了不必要复杂度
```

---

## 4.2 v2.1 目标架构

```text
┌─────────────────────────────────────┐
│ Channel Layer                       │
│ Web / CLI / Telegram / Feishu / ... │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ TurnOrchestrator                    │
│ normalize / session / context / run │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ Pi Agent Runtime                    │
│ prompt + skills + selected tools    │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ ToolRuntime                         │
│ tool call / decision / approval     │
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│ Existing Sandbox + Host Approval    │
│ toolSandbox.ts / HostBashStore      │
└─────────────────────────────────────┘
```

旁路配置：

```text
Workspace
  -> skills
  -> tools
  -> sandbox policy
  -> approval policy
  -> memory scope

Settings
  -> gradually moved from RuntimeSettings to SQLite
```

---

# 5. 保留、删除、重构清单

## 5.1 删除

优先删除：

```text
src/lib/server/acp/
RuntimeSettings.acp
ACP provider
ACP target
ACP task tracking
ACP permission bridge
ACP UI / settings
```

删除原因：

```text
1. 与 Pi-based personal agent 定位不一致
2. 引入外部 coding agent 控制复杂度
3. 当前使用价值可能不高
4. 删除后可明显降低配置和权限复杂度
```

---

## 5.2 保留

短期保留：

```text
现有 Plugin 系统
现有 Skill 系统
现有 memory/
现有 toolSandbox.ts
现有 HostBashStore
现有 Subagent 机制
现有 Runlog / event 记录
现有 Channel 实现
```

保留原因：

```text
1. 当前已经可用
2. 不是主要痛点
3. 重写收益不够高
4. 避免重构范围失控
```

---

## 5.3 重构

重点重构：

```text
Workspace 模型
Turn 入口
Tool 执行链路
Approval scope
Settings 存储结构
```

重构原因：

```text
1. 这些是当前复杂度和体验问题的核心来源
2. 改完后收益最大
3. 对后续插件化和权限治理最关键
```

---

# 6. Workspace 设计

## 6.1 Workspace 的定位

Workspace 替代 ACP 中的 project / target 概念。

它不是远程 coding target，而是：

```text
上下文边界
权限边界
工具边界
执行边界
memory 边界
```

一句话：

> Workspace 表示一次任务在哪个空间里运行，以及这个空间允许 Agent 做什么。

---

## 6.2 Workspace 最小模型

第一版不要复杂，建议只包含：

```ts
type Workspace = {
  id: string;
  name: string;
  rootPath?: string;

  enabledSkillPaths?: string[];
  enabledToolIds?: string[];

  sandboxProfileId?: string;
  approvalProfileId?: string;

  memoryScope?: "global" | "workspace" | "session";

  createdAt: string;
  updatedAt: string;
};
```

---

## 6.3 Workspace 关联关系

至少关联：

```text
sessions.workspace_id
runs.workspace_id
approval_grants.workspace_id
```

后续可扩展：

```text
messages.workspace_id
memories.workspace_id
tool_events.workspace_id
```

---

## 6.4 Workspace 的使用方式

一次消息进来后：

```text
InboundMessage
  -> resolve conversation
  -> resolve workspace
  -> create run with workspace_id
  -> load workspace skills/tools/policy
  -> start Pi run
```

默认可以有一个：

```text
default workspace
```

例如：

```text
personal
```

---

# 7. TurnOrchestrator 设计

## 7.1 目标

统一所有入口，不让 Web / CLI / Telegram / Feishu 各自处理核心逻辑。

所有入口都走：

```text
Channel
  -> TurnOrchestrator
```

---

## 7.2 第一版职责

不要做太重，第一版只负责：

```text
1. 创建 runId
2. 解析 session / conversation
3. 解析 workspace
4. 加 session lock
5. 构建基本上下文
6. 调用 Pi Agent Runtime
7. 处理流式输出
8. 记录 run events
9. turn 结束后触发 memory writeback
10. 释放 lock
```

暂时不做：

```text
复杂任务队列
复杂 cancellation
复杂 retry
复杂 scheduler
复杂 multi-agent coordination
```

---

## 7.3 标准流程

```text
receive inbound message
  -> normalize
  -> resolve actor
  -> resolve session
  -> resolve workspace
  -> create run
  -> acquire session lock
  -> build context
  -> select tools
  -> call PiAgentRuntime
  -> handle tool call through ToolRuntime
  -> stream response
  -> write messages
  -> memory writeback
  -> close run
  -> release lock
```

---

## 7.4 验收标准

```text
Web 走 TurnOrchestrator
CLI 走 TurnOrchestrator
Telegram 走 TurnOrchestrator
Feishu 走 TurnOrchestrator
每次用户请求都有 runId
每次 tool call 能关联 runId
```

---

# 8. ToolRuntime 设计

## 8.1 目标

所有工具调用必须统一进入 ToolRuntime。

当前可能存在的问题：

```text
部分工具直接执行
host bash approval 单独处理
sandbox 单独处理
MCP 工具路径单独处理
subagent 工具调用路径可能不同
```

目标是统一成：

```text
Pi tool call
  -> ToolRuntime
  -> decision
  -> approval if needed
  -> sandbox if needed
  -> execute
  -> result
```

---

## 8.2 ToolRuntime 第一版职责

```text
1. 接收 Pi 的 tool call
2. 找到 tool definition
3. 生成 PolicyDecision
4. 检查 existing approval grant
5. 如需要，创建 approval request
6. 如需要，走 sandbox
7. 执行 tool handler
8. 记录 tool event
```

---

## 8.3 不单独创建完整 PolicyEngine

v2.1 不新建完整 PolicyEngine 模块。

但必须保留一个轻量决策模型：

```ts
type PolicyDecision =
  | { type: "allow" }
  | { type: "sandbox" }
  | { type: "approval_required"; request: ApprovalRequest }
  | { type: "deny"; reason: string };
```

这样可以避免 ToolRuntime 失控。

---

## 8.4 ToolRuntime 内部结构

可以先这样组织：

```text
toolRuntime.ts
  - executeToolCall()
  - resolveTool()
  - decidePolicy()
  - checkApprovalGrant()
  - requestApproval()
  - runWithSandboxIfNeeded()
  - executeHandler()
```

不需要先拆成多个模块。

---

## 8.5 验收标准

```text
所有 tool call 都经过 ToolRuntime
所有 host bash 都经过 ToolRuntime
所有 sandbox command 都经过 ToolRuntime
所有 subagent tool call 都经过 ToolRuntime
Tool call 有 runId / sessionId / workspaceId
Tool call 有可审计 event
```

---

# 9. Approval scope 设计

## 9.1 当前问题

当前 approval 只有：

```text
pending
approved
rejected
```

无法解决：

```text
同一命令反复审批
同一 session 重复审批
同一 workspace 重复审批
subagent 审批传递困难
用户不知道批准范围
```

---

## 9.2 新增 ApprovalScope

```ts
type ApprovalScope =
  | "once"
  | "turn"
  | "session"
  | "workspace"
  | "persistent";
```

含义：

| Scope      | 含义              | 适用场景          |
| ---------- | --------------- | ------------- |
| once       | 只批准本次调用         | 高风险操作         |
| turn       | 当前用户请求内有效       | 同一任务内多个类似操作   |
| session    | 当前会话有效          | 多轮连续任务        |
| workspace  | 当前 workspace 有效 | 固定项目里的常用低风险操作 |
| persistent | 长期有效            | 明确可信的工具能力     |

---

## 9.3 ApprovalGrant 模型

```ts
type ApprovalGrant = {
  id: string;

  scope: ApprovalScope;
  capability: string;

  actorId: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;

  actionFingerprint?: string;

  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
};
```

---

## 9.4 ApprovalRequest 模型

```ts
type ApprovalRequest = {
  id: string;

  runId: string;
  sessionId: string;
  workspaceId?: string;
  actorId: string;

  capability: string;
  riskLevel: "low" | "medium" | "high" | "critical";

  action: {
    type: "bash" | "file_read" | "file_write" | "network" | "mcp_tool" | "secret_access";
    command?: string;
    path?: string;
    domain?: string;
    toolName?: string;
  };

  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";

  scopeOptions: ApprovalScope[];
  selectedScope?: ApprovalScope;

  createdAt: string;
  resolvedAt?: string;
};
```

---

## 9.5 Approval 聚合

不要每次 violation 立即问用户。

第一版可以做一个简单规则：

```text
同一 run 内，1-3 秒 debounce
相同 capability + 相似 action 合并
critical 不合并，立即提示
```

展示时：

```text
Agent 想执行以下操作：

1. 运行 npm install
2. 写入 package-lock.json
3. 访问 registry.npmjs.org

可选：
- 只允许这一次
- 允许当前任务
- 允许当前会话
- 拒绝
```

---

## 9.6 Subagent 审批上提

原则：

```text
Subagent 不能直接扩权
Subagent 的 approval request 归属 parent run
```

流程：

```text
Subagent tool call
  -> ToolRuntime
  -> approval_required
  -> ApprovalRequest(parentRunId)
  -> Channel response to user
  -> ApprovalGrant
  -> Subagent resume
```

---

# 10. Sandbox 调整

## 10.1 保留现有实现

短期保留：

```text
toolSandbox.ts
HostBashStore
现有 sandbox settings
```

不新增完整 SandboxRuntime。

---

## 10.2 只做关键收口

做两件事：

```text
1. 所有 sandbox 执行都必须从 ToolRuntime 进入
2. sandbox 失败不能默认无审批 host fallback
```

---

## 10.3 Sandbox fallback 规则

建议：

```text
sandbox success
  -> return result

sandbox init failed
  -> low risk: 根据配置决定是否申请 approval
  -> medium/high: approval required
  -> critical: deny
```

不要允许：

```text
sandbox failed -> host bash direct execute
```

除非已有对应 scope 的 approval grant。

---

# 11. Skill 策略

## 11.1 Skill 保持轻量

Skill 不做 Plugin。

Skill 就是：

```text
skills/
  xxx/
    SKILL.md
    references/
    scripts/
    assets/
```

作用：

```text
说明模型什么时候用
说明模型怎么做
提供 checklist
提供参考资料
```

---

## 11.2 短期不重构 Skill 系统

如果现有 Skill 系统可用，短期只做小增强：

```text
保持当前目录
保持当前加载逻辑
Workspace 可配置 enabledSkillPaths
```

中期再考虑兼容：

```text
.pi/skills/
.agents/skills/
~/.pi/agent/skills/
~/.agents/skills/
```

---

## 11.3 Plugin 可以贡献 Skill 目录

如果现有 plugin 系统支持，可以允许：

```text
plugins/<plugin-id>/skills/
```

但这不是 skill plugin 化，只是增加搜索路径。

---

# 12. Plugin 策略

## 12.1 复用现有 Plugin 系统

不新建 PluginManager。

只明确边界：

```text
Plugin 可以注册 channel
Plugin 可以注册 tool provider
Plugin 可以注册 memory backend
Plugin 可以注册 sandbox executor
Plugin 可以注册 UI panel
```

Plugin 不应该：

```text
直接调用 Pi
直接控制 Turn 主流程
绕过 ToolRuntime 执行命令
绕过 Approval
直接写核心 RuntimeSettings
```

---

## 12.2 最小改造

只需要补充两个规范：

```text
1. Plugin 注册的 tool 必须进入 ToolRegistry
2. Plugin 注册的 channel 必须进入 TurnOrchestrator
```

这样就够了。

---

# 13. Memory 策略

## 13.1 短期保留现有 memory/

不新建 MemoryRuntime。

保留：

```text
MemoryGateway
现有 backend
现有 retrieval / write 逻辑
```

---

## 13.2 只调整调用位置

Memory 的调用应该收敛到 Turn：

```text
turn start
  -> retrieve memory

turn end
  -> writeback memory
```

不要让各 channel 自己写 memory。

---

## 13.3 中期优化

后续再考虑：

```text
memory candidate review
sensitive memory confirmation
workspace memory
memory conflict detection
```

这些不进入第一期。

---

# 14. Settings 拆分策略

## 14.1 当前问题

`RuntimeSettings` 太大，包含：

```text
provider
model
agent
channel
mcp
skill
sandbox
host tool
plugin
telegram
feishu
qq
acp
```

问题：

```text
修改风险大
UI 保存容易覆盖无关配置
migration 困难
sanitizeSettings 越来越复杂
```

---

## 14.2 v2.1 策略：渐进拆分

不要一次性全拆。

### 第一批

```text
workspaces
approval_requests
approval_grants
plugin_settings
channel_settings
```

### 第二批

```text
model_settings
mcp_servers
sandbox_profiles
skill_settings
```

### 最后保留或迁移

```text
基础 bootstrap
default profile
server port
data directory
```

---

## 14.3 settings.json 的新定位

最终：

```json
{
  "dataDir": "~/.molibot",
  "database": "sqlite://settings.sqlite",
  "server": {
    "host": "127.0.0.1",
    "port": 3050
  },
  "defaultProfile": "default"
}
```

但迁移期间：

```text
settings.json 继续可读
SQLite 优先
启动时 migrate
UI 写 SQLite
```

---

# 15. 数据表建议

第一阶段需要：

```sql
workspaces
runs
approval_requests
approval_grants
```

## 15.1 workspaces

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT,
  enabled_skill_paths TEXT,
  enabled_tool_ids TEXT,
  sandbox_profile_id TEXT,
  approval_profile_id TEXT,
  memory_scope TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 15.2 runs

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  actor_id TEXT,
  channel_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
```

## 15.3 approval_requests

```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  actor_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload TEXT,
  reason TEXT,
  status TEXT NOT NULL,
  scope_options TEXT,
  selected_scope TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

## 15.4 approval_grants

```sql
CREATE TABLE approval_grants (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  capability TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  run_id TEXT,
  action_fingerprint TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
```

---

# 16. 改造路线图

## Phase 1：删除 ACP + 引入 Workspace

**周期：1-2 周**

### 目标

收窄系统边界，移除最大复杂度来源。

### 任务

```text
删除 src/lib/server/acp/
删除 RuntimeSettings.acp
删除 ACP UI / settings
新增 workspaces 表
新增 WorkspaceResolver
session/run 支持 workspace_id
默认 workspace: personal
```

### 不做

```text
不重构 memory
不重构 plugin
不重构 skill
不重构全部 settings
```

### 验收标准

```text
代码中无 ACP 主路径
应用可以正常启动
Web/CLI 可以在 default workspace 下运行
run 可以记录 workspace_id
```

---

## Phase 2：TurnOrchestrator + ToolRuntime + Approval scope

**周期：2-4 周**

### 目标

统一主链路，解决工具和审批分散问题。

### 任务

```text
新增 TurnOrchestrator
Web/CLI/Telegram/Feishu 统一入口
新增 ToolRuntime
所有 tool call 进入 ToolRuntime
Host bash 接入 ToolRuntime
Sandbox 调用接入 ToolRuntime
Approval 增加 scope
Approval 增加 grants
Approval 增加 debounce / merge
Subagent tool call 接入 ToolRuntime
Subagent approval 归属 parent run
```

### 不做

```text
不拆完整 PolicyEngine
不拆完整 SandboxRuntime
不重写 memory
不重写 subagent 类型系统
```

### 验收标准

```text
所有 channel 消息都有 runId
所有 tool call 都有 runId / workspaceId
重复低风险操作可以 session/workspace scope 批准
subagent 触发审批时用户在父任务看到审批请求
sandbox 失败不会无审批 host fallback
```

---

## Phase 3：Settings 渐进拆分

**周期：2-4 周**

### 目标

降低 RuntimeSettings 巨型对象风险。

### 任务

第一批迁移：

```text
workspaces
approval_requests
approval_grants
plugin_settings
channel_settings
```

第二批迁移：

```text
mcp_servers
sandbox_profiles
skill_settings
model_settings
```

### 迁移策略

```text
settings.json 继续可读
SQLite 优先
启动时迁移缺失数据
UI 写 SQLite
保留 fallback
```

### 验收标准

```text
RuntimeSettings.acp 已移除
Workspace/Approval 不依赖 settings.json
UI 修改 channel/plugin 设置不会覆盖 model/sandbox 等无关配置
sanitizeSettings 明显变小
```

---

# 17. 暂不做清单

这些不是不要，而是暂不做：

```text
新的 PluginManager
复杂插件依赖解析
第三方插件隔离进程
完整 PolicyEngine 模块
完整 SandboxRuntime 模块
完整 MemoryRuntime 模块
复杂 Subagent 角色体系
完整 SkillLoader 重写
复杂 RunlogRuntime
插件市场
多实例分布式部署
```

原因：

```text
当前收益不如主链路重构
会扩大重构范围
容易拖慢进度
现有模块已经可用
```

---

# 18. 风险与控制

## 风险 1：TurnOrchestrator 改动影响所有渠道

控制方式：

```text
先接 Web / CLI
再接 Telegram
最后接 Feishu / Weixin
保留旧路径 fallback
每接一个 channel 做回归
```

---

## 风险 2：ToolRuntime 迁移遗漏工具

控制方式：

```text
列出所有 tool 来源
逐个迁移
迁移后禁用直接调用路径
tool call 统一打 event
```

工具来源包括：

```text
built-in tools
MCP tools
host bash
sandbox bash
subagent tools
plugin tools
```

---

## 风险 3：Approval scope 误放权

控制方式：

```text
默认 scope 保守
high / critical 只允许 once
workspace / persistent 需要显式选择
grant 支持 revoke
所有 grant 写 audit
```

---

## 风险 4：Settings 迁移破坏旧配置

控制方式：

```text
只做增量迁移
保留 settings.json fallback
迁移前备份
UI 写新表
启动时校验
```

---

# 19. 最终优先级

最高优先级：

```text
1. 删除 ACP
2. Workspace
3. TurnOrchestrator
4. ToolRuntime
5. Approval scope
```

中优先级：

```text
6. Approval 聚合
7. Subagent approval 上提
8. Sandbox fallback 收紧
9. Settings 第一批拆分
```

低优先级：

```text
10. Skill 目录兼容增强
11. Memory 写入治理
12. Plugin 能力规范化
13. Settings 第二批拆分
```

---

# 20. 最终结论

v2.1 方案不追求一次性把系统改造成完美的 Agent Platform，而是围绕当前真实痛点做收敛：

```text
删除不必要的 ACP
用 Workspace 建立边界
用 TurnOrchestrator 统一入口
用 ToolRuntime 统一工具执行
用 Approval scope 降低审批噪音
用渐进 Settings 拆分降低配置复杂度
```

最终目标是：

> **Pi 做 Agent Loop，Skill 保持标准文件化，Plugin 复用现有系统，Workspace 定义边界，ToolRuntime 管执行，Approval 管授权，Sandbox 管隔离。**

这版方案比 v2.0 更适合落地：

```text
改动范围更小
优先级更清晰
不重复造轮子
保留现有可用能力
能在 4-8 周内分阶段完成
```

一句话总结：

```text
不要重写一个新系统，而是把现有系统的主链路收拢，把权限和工具执行统一起来。
```
