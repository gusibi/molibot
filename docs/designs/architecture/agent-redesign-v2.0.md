下面是一份 **Agent 精简优化架构改造方案**。我会基于我们前面的共识来设计：

```text
继续基于 Pi
去掉 ACP
Skill 保持标准目录 + SKILL.md
Plugin 只用于 Runtime 级扩展
审批 / Sandbox / Tool / Subagent 权限统一上收到 Control Plane
核心 Runtime 保持小
```

---

# 1. 改造目标

你的目标不是把 Molibot 做成一个功能越来越多的大平台，而是做成一个：

```text
Pi-based Personal Agent Runtime
```

核心定位：

> 一个基于 Pi 的本地优先 Agent Runtime，支持多渠道输入、标准 Skill、插件化 Runtime 能力、统一工具执行、统一权限审批、统一 Sandbox 控制和长期 Memory。

改造后的架构应该满足：

```text
新增一个工作流：只需要放一个 Skill 目录
新增一个系统能力：安装 / 启用一个 Plugin
新增一个工具：由 Tool Provider Plugin 注册
新增一个渠道：由 Channel Plugin 注册
新增一个执行环境：由 Sandbox Plugin 注册
核心 Turn 流程不改
```

---

# 2. 总体架构

推荐目标架构如下：

```text
┌──────────────────────────────────────────────┐
│                Channel Layer                 │
│ Web / CLI / Telegram / Feishu / Weixin        │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│              Channel Gateway                 │
│ normalize / auth / actor / conversation       │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│              Turn Orchestrator               │
│ queue / lock / context / run / stream / log   │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│              Context Builder                 │
│ profile / workspace / memory / skills         │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│              Pi Agent Runtime                │
│ selected prompt + selected tools + messages   │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│                Tool Runtime                  │
│ tool registry / MCP / host tools / plugins    │
└───────────────┬──────────────────────────────┘
                ↓
┌──────────────────────────────────────────────┐
│        Policy + Sandbox + Approval Plane      │
│ risk classify / sandbox execute / approval    │
└──────────────────────────────────────────────┘
```

旁路能力：

```text
Plugin Manager
  -> 注册 Channel / Tool / Memory / Sandbox / UI / Model Provider

Skill Loader
  -> 扫描 .pi/skills / .agents/skills / ~/.pi/agent/skills / ~/.agents/skills

Memory Runtime
  -> retrieve / candidate / policy / writeback

Runlog Runtime
  -> turn events / tool events / approval events / final result
```

---

# 3. 核心原则

## 3.1 Pi 只做 Agent Loop

Pi 不负责：

```text
channel
approval
sandbox policy
memory writeback
plugin lifecycle
settings persistence
subagent 权限传播
```

Pi 只负责：

```text
接收 prompt
接收当前 turn 可用 tools
执行推理
发起 tool call
生成结果
```

也就是说：

```text
Pi = 推理与工具调用内核
你的 Runtime = 控制平面
```

---

## 3.2 Skill 保持轻量标准

Skill 不要插件化。

Skill 就是：

```text
skills/
  xxx/
    SKILL.md
    references/
    scripts/
    assets/
```

Skill 负责：

```text
告诉模型什么时候用
告诉模型怎么做
提供 checklist
提供参考文档
提供轻量辅助脚本
```

Skill 不负责：

```text
注册工具
连接 API
管理权限
启动服务
写数据库
控制主流程
```

---

## 3.3 Plugin 只做 Runtime 扩展

Plugin 用于新增代码级能力：

```text
Channel Plugin
Tool Provider Plugin
Memory Plugin
Sandbox Plugin
Model Provider Plugin
UI Plugin
Scheduler Plugin
```

不要把 Skill 做成 Plugin。

正确关系：

```text
Skill = 行为说明
Plugin = 能力实现
Policy = 权限控制
Pi = 使用能力完成任务
```

---

## 3.4 所有执行都必须经过 Tool Runtime

不要让任何模块直接执行命令、读写敏感文件、访问网络。

所有工具调用都走：

```text
Tool Runtime
  -> Policy Engine
  -> Approval Broker
  -> Sandbox Runtime
  -> Tool Handler
```

这样才能统一治理。

---

## 3.5 Subagent 不能扩大权限

Subagent 只能继承或缩小父任务权限。

```text
parent run permission scope
  -> child agent inherited scope
  -> child tool request
  -> Approval Broker
  -> parent run resume
```

Subagent 不应该自己向用户弹审批。

---

# 4. 模块拆分方案

## 4.1 AppRuntime

职责：只负责启动、关闭和依赖注入。

```text
AppRuntime
  - load config
  - init database
  - init plugin manager
  - init services
  - start channels
  - shutdown gracefully
```

不要让 AppRuntime 直接处理消息、工具、memory、approval。

---

## 4.2 PluginManager

职责：

```text
discover plugins
read manifest
validate plugin
resolve dependencies
load enabled plugins
register capabilities
disable / enable plugin
```

Plugin 类型：

```text
channel
tool_provider
memory_provider
sandbox_executor
model_provider
ui_panel
scheduler
```

插件接口保持简单：

```ts
export interface AgentPlugin {
  manifest: PluginManifest
  setup(ctx: PluginContext): Promise<void> | void
  activate?(ctx: PluginContext): Promise<void> | void
  deactivate?(ctx: PluginContext): Promise<void> | void
}
```

插件不要拿到整个 Runtime，只给受控 API：

```ts
export interface PluginContext {
  logger: Logger
  events: EventBus
  settings: PluginSettingsApi

  tools: ToolRegistry
  channels: ChannelRegistry
  memory: MemoryRegistry
  sandbox: SandboxRegistry
  models: ModelRegistry
  ui: UiRegistry
}
```

---

## 4.3 SkillLoader

职责：

```text
scan skill directories
parse SKILL.md frontmatter
index name / description / path
handle duplicate priority
load full SKILL.md on demand
track trust / enabled / content hash
```

推荐目录兼容：

```text
project:
  .pi/skills/
  .agents/skills/

global:
  ~/.pi/agent/skills/
  ~/.agents/skills/

plugin contributed:
  plugins/<plugin-id>/skills/
```

Skill metadata：

```ts
type SkillMeta = {
  name: string
  description: string
  path: string
  source: 'project' | 'global' | 'plugin' | 'settings'
  enabled: boolean
  trusted: boolean
  contentHash: string
}
```

注意：**Plugin 可以贡献 skills 目录，但 Skill 仍然是标准 SKILL.md。**

---

## 4.4 ChannelGateway

职责：

```text
接收不同渠道消息
统一格式化
识别 actor / conversation / channel
处理附件
发送响应
处理 markdown 差异
```

统一消息结构：

```ts
type InboundMessage = {
  id: string
  channelId: string
  conversationId: string
  actorId: string
  text?: string
  attachments?: Attachment[]
  receivedAt: string
  metadata?: Record<string, unknown>
}
```

Channel 插件不能直接调用 Pi。

固定流程：

```text
Channel Plugin
  -> Channel Gateway
  -> Turn Orchestrator
```

---

## 4.5 TurnOrchestrator

这是最重要的主流程模块。

职责：

```text
创建 run
加 session lock
加载 profile / workspace
检索 memory
选择 skill
选择 tools
启动 Pi Agent
处理 tool call
处理 approval pause / resume
流式输出
写 runlog
触发 memory writeback
释放 lock
```

标准 turn 流程：

```text
1. receive InboundMessage
2. auth actor
3. resolve conversation
4. resolve profile
5. resolve workspace
6. acquire session lock
7. create run
8. retrieve memory
9. select skills
10. select tools
11. build prompt
12. start Pi Agent
13. handle tool calls
14. handle approval if needed
15. stream response
16. write messages
17. extract memory candidates
18. archive runlog
19. release lock
```

所有渠道、计划任务、CLI 都必须走这个流程。

---

## 4.6 PiAgentRuntime

职责：封装 Pi。

```text
prepare Pi session
inject selected prompt
inject selected skills
inject selected tools
stream events
receive tool call
return final response
```

不要把 policy、sandbox、memory 写入放进 PiAgentRuntime。

PiAgentRuntime 只应该依赖：

```text
PromptBuilder
ToolRuntime
ModelRouter
```

---

## 4.7 ContextBuilder

职责：

```text
合成当前 turn 上下文
```

输入：

```text
profile prompt
workspace prompt
selected skill summaries
loaded SKILL.md
memory context
conversation history
time context
channel context
```

输出：

```text
final system prompt
tool descriptions
context blocks
```

Prompt 分层：

```text
core system
profile
workspace
skill
memory
session
user message
```

---

## 4.8 ToolRuntime

职责：

```text
管理所有 tools
接收 Pi tool call
执行 policy check
申请 approval
选择 sandbox
调用 tool handler
返回结果
```

工具来源：

```text
core tools
plugin tools
MCP tools
skill scripts wrapper
host tools
```

统一 tool 定义：

```ts
type ToolDefinition = {
  id: string
  name: string
  description: string
  inputSchema: unknown
  risk: 'low' | 'medium' | 'high' | 'critical'
  requiredPermissions?: PermissionSpec
  handler: (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult>
}
```

Tool handler 不直接访问原生能力，必须使用受控 API：

```ts
type ToolExecutionContext = {
  runId: string
  sessionId: string
  workspaceId: string
  actorId: string

  fs: SafeFsApi
  shell: SafeShellApi
  network: SafeNetworkApi
  secrets: SafeSecretsApi

  emit: (event: RunEvent) => void
}
```

---

## 4.9 PolicyEngine

职责：

```text
判断工具调用是否允许
判断风险等级
判断是否需要审批
判断是否必须 sandbox
判断是否禁止执行
```

策略输入：

```text
workspace policy
plugin permission
tool risk
actor permission
session grants
approval history
sandbox policy
```

策略输出：

```ts
type PolicyDecision =
  | { type: 'allow' }
  | { type: 'allow_with_sandbox' }
  | { type: 'approval_required'; request: ApprovalRequest }
  | { type: 'deny'; reason: string }
```

---

## 4.10 ApprovalBroker

职责：

```text
创建审批请求
聚合同类审批
发送到合适渠道
等待用户批准 / 拒绝
生成 approval grant
审计记录
支持 revoke
```

审批 scope：

```text
once        只本次 tool call
turn        当前 turn 有效
session     当前会话有效
workspace   当前 workspace 有效
persistent  长期有效
```

审批请求结构：

```ts
type ApprovalRequest = {
  id: string
  runId: string
  sessionId: string
  workspaceId: string
  actorId: string

  capability: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'

  action: {
    type: 'bash' | 'file_read' | 'file_write' | 'network' | 'mcp_tool' | 'secret_access'
    command?: string
    path?: string
    domain?: string
    toolName?: string
  }

  reason: string

  requestedBy: {
    agentId: string
    parentAgentId?: string
    depth: number
  }

  scopeOptions: ApprovalScope[]
}
```

审批聚合策略：

```text
同一 turn 内 1-3 秒 debounce
同类请求合并
高风险请求单独展示
低风险重复请求建议 session / workspace scope
```

---

## 4.11 SandboxRuntime

职责：

```text
根据 policy 执行命令
包装 anthropic sandbox-runtime
未来可替换 docker / remote executor
```

拆成两层：

```text
SandboxPolicyEngine
SandboxExecutor
```

Sandbox policy 示例：

```yaml
workspace: blog

filesystem:
  read_allow:
    - "${workspace.root}"
  write_allow:
    - "${workspace.root}/content"
    - "${workspace.root}/drafts"
  deny:
    - "~/.ssh"
    - "~/.aws"
    - "**/.env*"

network:
  default: deny
  allow_domains:
    - github.com
    - api.github.com
    - api.cloudflare.com

env:
  allow:
    - OPENAI_API_KEY
  deny:
    - AWS_SECRET_ACCESS_KEY
```

Sandbox fallback 规则：

```text
sandbox failed
  -> low risk: ask or fallback if policy allows
  -> medium/high risk: approval required
  -> critical: block
```

禁止默认：

```text
sandbox failed -> 直接 host 执行
```

---

## 4.12 MemoryRuntime

职责：

```text
retrieve memory
extract memory candidates
classify memory
write memory
resolve conflict
forget / disable memory
```

Memory 分层：

```text
user memory
workspace memory
session memory
daily memory
skill memory
```

写入流程：

```text
turn finished
  -> extract candidates
  -> memory policy check
  -> sensitive check
  -> conflict check
  -> write or ask confirmation
```

不要只靠关键词写 memory。

---

## 4.13 RunlogRuntime

职责：

```text
记录完整 run 生命周期
支持调试
支持 IM 渠道只显示摘要
```

记录事件：

```text
run_started
skill_selected
tool_selected
tool_called
policy_checked
approval_requested
approval_granted
sandbox_executed
tool_result
subagent_started
subagent_finished
memory_written
run_finished
run_failed
```

---

# 5. 删除 / 保留 / 重写清单

## 5.1 删除

```text
ACP
ACP targets
ACP providers
ACP task tracking
Codex / Claude Code remote control
ACP permission flow
ACP project management
```

删除后用：

```text
Workspace
```

替代原有 project / target 概念。

---

## 5.2 保留

```text
Pi Agent Loop
多渠道入口
标准 Skill 目录
MCP 能力
Memory 思路
Sandbox 思路
Host Approval 思路
Subagent 可见性
Runlog archive
Settings UI
```

---

## 5.3 重写

```text
RuntimeState
MessageRouter
Tool execution flow
Host bash approval
Sandbox fallback
Settings sanitize
Memory writeback
Subagent permission inheritance
Tool injection logic
```

---

# 6. Workspace 设计

删除 ACP 后，Workspace 是新的边界。

Workspace 表示：

```text
一个任务空间 / 项目空间 / 执行边界
```

每个 Workspace 有：

```text
root path
enabled skills
enabled plugins
enabled tools
memory scope
sandbox policy
approval policy
model route
```

示例：

```yaml
id: blog
name: Blog Workspace
root: ~/projects/onlinestool

skills:
  - seo-writer
  - publish-blog
  - blog-review

tools:
  - core.file
  - core.git
  - cloudflare.deploy
  - github.repo

sandbox:
  policy: blog-sandbox

approval:
  file_write: workspace
  network: session
  shell: once

memory:
  scopes:
    - user
    - workspace
```

这样可以清楚控制：

```text
这个 workspace 里 Agent 能看到什么
能调用什么工具
能写哪些路径
需要哪些审批
```

---

# 7. Skill 设计规范

Skill 目录：

```text
skills/
  seo-writer/
    SKILL.md
    references/
      seo-checklist.md

  publish-blog/
    SKILL.md
    references/
      publish-flow.md
```

`SKILL.md` 示例：

```markdown
---
name: seo-writer
description: Use when writing or optimizing SEO articles, titles, meta descriptions, FAQs, and keyword-focused content.
---

# SEO Writer

## When to use

Use this skill when the user asks to create, rewrite, or optimize website content for SEO.

## Process

1. Identify the primary keyword.
2. Create a clear title.
3. Write a concise meta description.
4. Use H2 sections.
5. Add FAQ if useful.
6. Avoid keyword stuffing.

## Output

Return Markdown.
```

Skill 只做：

```text
说明
流程
检查清单
参考资料
轻量脚本
```

不要做：

```text
权限声明
工具注册
plugin lifecycle
```

---

# 8. Plugin 设计规范

Plugin manifest 示例：

```yaml
id: cloudflare.tool
name: Cloudflare Tool Provider
version: 0.1.0
type: tool_provider
entry: ./dist/index.js

capabilities:
  tools:
    - cloudflare.list_deployments
    - cloudflare.trigger_deploy

permissions:
  network:
    allow_domains:
      - api.cloudflare.com

secrets:
  required:
    - CLOUDFLARE_API_TOKEN

approval:
  cloudflare.trigger_deploy:
    risk: medium
    default_scope: once
```

Plugin 职责：

```text
注册工具
注册 channel
注册 memory backend
注册 sandbox executor
注册 UI panel
```

Plugin 不负责主流程。

---

# 9. Tool 注入策略

不要把所有 tools 都暴露给 Pi。

推荐策略：

```text
当前 workspace enabled tools
+
当前 skill required tools
+
当前用户请求推断出的 relevant tools
+
policy allow tools
=
本轮注入 tools
```

注入逻辑：

```text
ToolRegistry 全量注册
ToolSelector 本轮筛选
PiAgentRuntime 只拿 selected tools
```

这样可以减少：

```text
上下文污染
工具误调用
审批频率
模型选择困难
```

---

# 10. Subagent 简化设计

只保留少量固定类型：

```text
Scout     调研，只读
Planner   规划，不执行
Worker    执行，继承父权限
Reviewer  审查，只读
```

权限原则：

```text
Subagent cannot escalate permissions
```

也就是：

```text
child permission <= parent permission
```

Subagent 调用工具时：

```text
Subagent
  -> ToolRuntime
  -> PolicyEngine
  -> ApprovalBroker
  -> parent run
```

Subagent 不能直接找用户审批。

---

# 11. 数据存储设计

## 11.1 settings.json

只保留 bootstrap：

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

## 11.2 SQLite

存动态配置：

```text
profiles
workspaces
channels
plugins
plugin_settings
skills
tools
mcp_servers
sandbox_policies
approval_requests
approval_grants
sessions
messages
runs
run_events
memories
usage_records
```

## 11.3 文件系统

存大对象：

```text
~/.molibot/
  attachments/
  runlogs/
  skills/
  prompts/
  scratch/
  exports/
  workspaces/
```

---

# 12. 推荐目录结构

```text
src/lib/server/
  app/
    appRuntime.ts
    lifecycle.ts

  plugins/
    pluginManager.ts
    pluginManifest.ts
    pluginContext.ts

  skills/
    skillLoader.ts
    skillRegistry.ts
    skillSelector.ts

  channels/
    channelGateway.ts
    channelRegistry.ts
    web/
    cli/

  turns/
    turnOrchestrator.ts
    turnQueue.ts
    turnEvents.ts

  agents/
    piAgentRuntime.ts
    modelRouter.ts
    subagentManager.ts

  context/
    contextBuilder.ts
    promptBuilder.ts
    profileResolver.ts
    workspaceResolver.ts

  tools/
    toolRuntime.ts
    toolRegistry.ts
    toolSelector.ts
    builtin/

  policies/
    policyEngine.ts
    riskClassifier.ts

  approvals/
    approvalBroker.ts
    approvalStore.ts
    approvalRenderer.ts

  sandbox/
    sandboxRuntime.ts
    sandboxPolicy.ts
    sandboxExecutor.ts

  memory/
    memoryRuntime.ts
    memoryRetriever.ts
    memoryWriter.ts
    memoryPolicy.ts

  workspaces/
    workspaceStore.ts
    workspacePolicy.ts

  settings/
    settingsStore.ts
    schemas/
    migrations/

  runlog/
    runlogStore.ts
    runlogFormatter.ts

  observability/
    usageTracker.ts
    health.ts
```

---

# 13. 改造路线图

## Phase 0：冻结能力边界

目标：停止功能继续发散。

动作：

```text
冻结 ACP 功能
冻结新的 runtime 内联功能
明确 Skill / Plugin / Tool / Workspace 边界
画出当前模块依赖图
标记待删除模块
```

产出：

```text
architecture-boundary.md
module-dependency-map.md
migration-plan.md
```

---

## Phase 1：删除 ACP，引入 Workspace

目标：把系统从 coding control platform 收敛为 personal agent runtime。

动作：

```text
删除 ACP target / provider / task
新增 Workspace 模型
把原 project 配置迁移到 Workspace
把权限策略挂到 Workspace
把 skill scope 挂到 Workspace
```

产出：

```text
workspace table
workspace resolver
workspace policy
migration script
```

验收标准：

```text
没有 ACP 代码路径
一次用户请求可以绑定 workspace
workspace 可以控制 root path / skills / tools / sandbox
```

---

## Phase 2：重构 TurnOrchestrator

目标：统一所有入口的主流程。

动作：

```text
新增 TurnOrchestrator
Web / CLI / Telegram / Feishu 全部走统一入口
MessageRouter 降级为兼容层或删除
run lifecycle 标准化
session lock 标准化
```

产出：

```text
turnOrchestrator.ts
turn events
run table
run_events table
```

验收标准：

```text
所有 channel 的消息都走同一个 turn pipeline
所有 run 都有 runId
所有工具调用都能归属到 runId
```

---

## Phase 3：抽离 ToolRuntime

目标：所有工具执行统一治理。

动作：

```text
新增 ToolRegistry
新增 ToolRuntime
把 built-in tools 迁移到 registry
把 MCP tools 接入 registry
把 host bash 迁移到 tool runtime
```

产出：

```text
toolRuntime.ts
toolRegistry.ts
toolSelector.ts
```

验收标准：

```text
Pi 不能直接调用原始工具
所有 tool call 都经过 ToolRuntime
所有 tool call 都有 policy check event
```

---

## Phase 4：重构 ApprovalBroker + SandboxRuntime

目标：解决审批频率和 subagent 审批传递问题。

动作：

```text
新增 ApprovalRequest 标准结构
新增 ApprovalBroker
新增 approval scope
新增 approval debounce / merge
新增 SandboxPolicyEngine
禁止 sandbox failure 自动 host fallback
```

产出：

```text
approvalBroker.ts
approval_requests table
approval_grants table
sandboxPolicy.ts
```

验收标准：

```text
同一 turn 内相似审批会聚合
审批可以 once / turn / session / workspace / persistent
subagent 的审批会上提到 parent run
sandbox 失败不会无审批直接 host 执行
```

---

## Phase 5：SkillLoader 标准化

目标：兼容 Pi 的标准 Skill 目录，不重造 Skill plugin。

动作：

```text
新增 SkillLoader
扫描 .pi/skills / .agents/skills / global skills
支持 plugin contributed skills directory
支持 enabled / trusted / hash
按需加载 SKILL.md
```

产出：

```text
skillLoader.ts
skillRegistry.ts
skills table
```

验收标准：

```text
新增一个 skill 目录即可被识别
Skill 不需要注册代码
Skill 可以被 workspace 启用 / 禁用
完整 SKILL.md 只在需要时加载
```

---

## Phase 6：PluginManager 最小化落地

目标：插件化 Runtime 能力，而不是插件化 Skill。

优先支持：

```text
tool_provider plugin
channel plugin
sandbox plugin
memory plugin
```

暂不做：

```text
插件市场
第三方隔离进程
复杂依赖解析
UI 动态组件
```

产出：

```text
pluginManager.ts
pluginManifest.ts
pluginContext.ts
plugins table
```

验收标准：

```text
新增一个 tool provider plugin 不需要改核心流程
新增一个 channel plugin 不需要改 TurnOrchestrator
插件不能直接访问 AppRuntime
```

---

## Phase 7：MemoryRuntime 重构

目标：避免关键词式乱写 memory。

动作：

```text
memory retrieval 独立
memory candidate extraction 独立
memory write policy 独立
workspace memory 支持
sensitive memory 默认不写
```

产出：

```text
memoryRuntime.ts
memoryPolicy.ts
memoryWriter.ts
```

验收标准：

```text
用户明确要求记住才优先写
短期信息进入 daily / session
项目事实进入 workspace memory
敏感内容需要确认
```

---

## Phase 8：Settings 简化

目标：移除巨型 sanitizeSettings。

动作：

```text
settings.json 只保留 bootstrap
动态配置迁移 SQLite
每个领域独立 schema / migration
插件 settings 独立 namespace
```

产出：

```text
settingsStore.ts
plugin_settings table
workspace settings
channel settings
```

验收标准：

```text
不再有超大 sanitizeSettings
每类配置有自己的 schema
UI 修改不会覆盖无关配置
```

---

# 14. 优先级建议

如果你时间有限，我建议按这个优先顺序做：

```text
1. 删除 ACP + 引入 Workspace
2. TurnOrchestrator 统一入口
3. ToolRuntime 统一工具调用
4. ApprovalBroker + SandboxRuntime
5. SkillLoader 标准化
6. PluginManager 最小可用
7. MemoryRuntime 重构
8. Settings 拆分
```

最关键的是前四步。

因为它们解决的是系统主干问题：

```text
边界过宽
流程分散
工具绕过
审批混乱
sandbox 不统一
```

Skill 和 Plugin 可以稍后逐步完善。

---

# 15. 最终目标状态

改造完成后，系统应该变成：

```text
核心 Runtime 很小
Turn 流程唯一
Skill 是标准 SKILL.md
Plugin 是 Runtime 扩展
Tool 调用统一进入 ToolRuntime
权限统一进入 PolicyEngine
审批统一进入 ApprovalBroker
执行统一进入 SandboxRuntime
Memory 有明确写入策略
Workspace 是权限和上下文边界
```

一句话总结：

> **用 Pi 做 Agent Loop，用 Skill 描述行为，用 Plugin 扩展能力，用 Workspace 定义边界，用 ToolRuntime 管工具，用 Approval + Sandbox 管安全。**

这就是我建议的精简优化方向。
