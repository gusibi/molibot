下面是一套完整方案，目标是把你现在的 `SKILL.md` 提示词型 skill，从“临时读文件 + 拼 prompt”的模式，升级成一个**可观测、可热插拔、可统计、可追踪到一次 turn 的 Skill Runtime / Hook 架构**。

---

# Agent Skill 记录与 Hook 化完整方案

## 1. 核心目标

你要解决的问题不是简单的“记录日志”，而是：

```text
一次用户输入，也就是一个 turn 里：

用了哪些 skill？
skill 是怎么被选中的？
skill.md 是否被加载？
skill 内容是否被注入 prompt？
注入到了哪个 prompt section？
skill 占用了多少 token？
哪个 subagent 使用了哪个 skill？
这次 turn 总共用了多少 token？
skill / tool / subagent / model call 之间的调用链是什么？
```

所以核心目标是：

> 把 prompt-based skill 从静态文件，升级成 Agent Runtime 中的一等资源。

也就是从：

```ts
const skill = fs.readFileSync("./skills/write/SKILL.md", "utf-8")
systemPrompt += skill
```

升级为：

```ts
const skill = await skillRegistry.loadSkill("write_article")

contextBuilder.addSkill(skill, {
  reason: "User requested article writing",
  scope: "turn",
})

const messages = contextBuilder.buildMessages()
```

并在中间触发标准事件：

```text
skill.selected
skill.loaded
skill.injected
```

---

# 2. 总体架构

推荐架构如下：

```text
User Message
  ↓
Conversation Runtime
  ↓ create conversation_id / turn_id
Agent Runtime
  ↓
SkillSelector
  ↓
SkillRegistry
  ↓
ContextBuilder / PromptBuilder
  ↓
ModelRuntime
  ↓
ToolRuntime / SubagentRuntime / SandboxRuntime
  ↓
HookManager
  ↓
TraceCollector
  ↓
DB / JSONL / OpenTelemetry / Dashboard
```

更具体一点：

```text
Agent Core
  ├── TurnRuntime
  ├── ModelRuntime
  ├── ToolRuntime
  ├── SkillRegistry
  ├── ContextBuilder
  ├── SubagentRuntime
  ├── SandboxRuntime
  └── HookManager
          ├── Built-in Hooks
          │     ├── TraceRecorderHook
          │     ├── TokenUsageHook
          │     └── SkillUsageHook
          │
          ├── Config Hooks
          │     ├── script hook
          │     ├── http hook
          │     └── approval hook
          │
          └── Event Sink
                ├── Postgres
                ├── ClickHouse
                ├── JSONL
                └── OpenTelemetry
```

---

# 3. 关键设计原则

## 原则一：skill.md 禁止被业务代码直接读取

不要让各处代码这样做：

```ts
fs.readFileSync("./skills/xxx/SKILL.md")
```

要统一规定：

```text
任何 skill.md 只能通过 SkillRegistry 加载。
任何 skill 内容只能通过 ContextBuilder / PromptBuilder 注入。
任何 skill 注入都必须产生 hook event。
```

这条规则非常重要。

否则你后面永远无法准确统计：

```text
这个 turn 到底用了几个 skill？
哪个 skill 被重复注入？
哪个 skill 被 subagent 使用？
哪个 skill 占用了多少 token？
```

---

## 原则二：prompt-based skill 不叫 executed

你的 skill 是 `SKILL.md`，本质是 prompt 片段，不是函数调用。

所以不要把它记录成：

```text
skill.executed
```

更准确的是：

```text
skill.selected
skill.loaded
skill.injected
```

其中：

```text
skill.injected = 这个 turn 使用了该 skill
```

也就是说，统计层面可以定义：

```text
used_skill = skill.injected
```

但底层事件不要乱叫 `executed`。

---

## 原则三：核心 Trace 内置，扩展 Hook 热插拔

你的 Agent 应该支持热插拔 Hook，但核心 trace 不能完全依赖外部 hook。

必须内置的能力：

```text
conversation_id
turn_id
run_id
span_id
parent_span_id
model usage 采集
tool wrapper
skill wrapper
subagent wrapper
sandbox wrapper
```

可以热插拔的能力：

```text
写数据库
写 JSONL
发通知
成本统计
权限审批
安全拦截
同步到 OpenTelemetry
同步到外部分析系统
```

---

# 4. 核心对象模型

## 4.1 Conversation

表示一个完整会话。

```ts
type Conversation = {
  conversationId: string
  userId?: string
  createdAt: string
  metadata?: Record<string, any>
}
```

---

## 4.2 Turn

表示用户的一次输入和 Agent 的一次响应。

这是你这套记录系统的核心单位。

```ts
type Turn = {
  turnId: string
  conversationId: string

  userMessageId?: string
  assistantMessageId?: string

  agentName: string
  status: "running" | "success" | "failed" | "cancelled"

  startedAt: string
  endedAt?: string

  totalPromptTokens?: number
  totalCompletionTokens?: number
  totalTokens?: number

  metadata?: Record<string, any>
}
```

一次用户消息必须创建一个 `turn_id`。

后面所有 model call、tool call、skill usage、subagent run 都要带这个 `turn_id`。

---

## 4.3 Run

表示一次 agent 执行。

主 agent 有自己的 run。

subagent 也有自己的 run。

```ts
type AgentRun = {
  runId: string
  parentRunId?: string

  turnId: string
  conversationId: string

  agentName: string
  runType: "main_agent" | "subagent"

  startedAt: string
  endedAt?: string

  status: "running" | "success" | "failed"
}
```

例如：

```text
turn_001
  ├── run_main_001
  │     ├── model.call
  │     ├── skill.injected
  │     ├── tool.call
  │     └── subagent.run
  │
  └── run_research_001
        ├── model.call
        ├── skill.injected
        └── tool.call
```

---

## 4.4 Span

表示 run 里面的一个具体步骤。

```ts
type TraceSpan = {
  spanId: string
  parentSpanId?: string

  turnId: string
  conversationId: string
  runId: string
  parentRunId?: string

  spanType:
    | "model_call"
    | "tool_call"
    | "skill_select"
    | "skill_load"
    | "skill_inject"
    | "subagent_run"
    | "sandbox_action"

  name: string

  status: "running" | "success" | "failed"

  startedAt: string
  endedAt?: string
  durationMs?: number

  input?: any
  output?: any
  error?: string

  promptTokens?: number
  completionTokens?: number
  totalTokens?: number

  metadata?: Record<string, any>
}
```

---

# 5. Skill 设计

## 5.1 当前目录结构

你现在可能是这样：

```text
skills/
  write_article/
    SKILL.md

  create_pdf/
    SKILL.md

  code_review/
    SKILL.md
```

可以继续保留。

---

## 5.2 推荐目录结构

建议升级成：

```text
skills/
  write_article/
    skill.yaml
    SKILL.md

  create_pdf/
    skill.yaml
    SKILL.md

  code_review/
    skill.yaml
    SKILL.md
```

其中 `skill.yaml` 存元信息：

```yaml
id: write_article
name: Write Article
version: 1.0.0
description: Help the agent write structured articles.
tags:
  - writing
  - article
  - content
type: prompt
enabled: true
```

`SKILL.md` 存提示词内容：

```md
# Write Article Skill

When the user asks to write an article, follow this structure:

1. Clarify the target reader.
2. Generate an outline.
3. Write the article.
4. Improve the title and summary.
```

---

## 5.3 也可以用 frontmatter

如果你不想多一个 `skill.yaml`，可以直接在 `SKILL.md` 顶部加 frontmatter：

```md
---
id: write_article
name: Write Article
version: 1.0.0
description: Help the agent write structured articles.
tags:
  - writing
  - article
type: prompt
---

# Write Article Skill

...
```

第一版我更推荐 `skill.yaml + SKILL.md`，逻辑更清楚。

---

# 6. Skill 对象定义

加载之后不要再把 skill 当字符串，而是包装成对象。

```ts
type Skill = {
  id: string
  name: string
  version: string
  description?: string
  tags?: string[]

  type: "prompt" | "runtime" | "hybrid"

  sourcePath: string
  content: string
  contentHash: string
  tokenCount: number

  enabled: boolean

  metadata?: Record<string, any>
}
```

对于你现在的 `SKILL.md`，`type` 就是：

```ts
type: "prompt"
```

未来如果某些 skill 有真实代码执行，可以升级为：

```ts
type: "hybrid"
```

---

# 7. Skill 生命周期

prompt-based skill 的完整生命周期建议这样定义：

```text
discovered
  ↓
selected
  ↓
loaded
  ↓
injected
```

如果未来有 runtime skill，再加：

```text
executed
```

对应事件：

```text
skill.discovered
skill.selected
skill.loaded
skill.injected
skill.executed
```

第一版建议只做这三个：

```text
skill.selected
skill.loaded
skill.injected
```

---

# 8. Skill 事件语义

## 8.1 skill.selected

表示 skill 被选择器选中了。

```json
{
  "event_name": "skill.selected",
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "run_id": "run_main_001",
  "span_id": "span_skill_select_001",
  "agent_name": "main_agent",
  "payload": {
    "skill_id": "write_article",
    "skill_name": "Write Article",
    "reason": "User asked to write an article",
    "score": 0.91
  }
}
```

---

## 8.2 skill.loaded

表示 skill 内容被加载或从缓存解析出来。

```json
{
  "event_name": "skill.loaded",
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "run_id": "run_main_001",
  "span_id": "span_skill_load_001",
  "agent_name": "main_agent",
  "payload": {
    "skill_id": "write_article",
    "skill_name": "Write Article",
    "version": "1.0.0",
    "source_path": "skills/write_article/SKILL.md",
    "content_hash": "sha256:xxx",
    "token_count": 820,
    "from_cache": true
  }
}
```

注意：
即使命中缓存，也应该记录 `skill.loaded`。

因为对当前 turn 来说，它确实解析到了这个 skill。

---

## 8.3 skill.injected

表示 skill 被注入到本次 prompt。

这个事件最重要。

```json
{
  "event_name": "skill.injected",
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "run_id": "run_main_001",
  "span_id": "span_skill_inject_001",
  "agent_name": "main_agent",
  "payload": {
    "skill_id": "write_article",
    "skill_name": "Write Article",
    "version": "1.0.0",
    "target": "system_prompt.skills",
    "token_count": 820,
    "content_hash": "sha256:xxx",
    "reason": "Selected by skill selector"
  }
}
```

统计层面：

```text
只要出现 skill.injected，就认为这个 turn 使用了该 skill。
```

---

# 9. SkillRegistry 设计

## 9.1 职责

`SkillRegistry` 负责：

```text
扫描 skill
读取 skill.yaml
读取 SKILL.md
解析 metadata
计算 content_hash
估算 token_count
缓存 skill
按 id 加载 skill
按 tag / description 检索 skill
```

---

## 9.2 接口设计

```ts
interface SkillRegistry {
  listSkills(): Promise<SkillMeta[]>

  getSkillMeta(skillId: string): Promise<SkillMeta>

  loadSkill(skillId: string, ctx: SkillLoadContext): Promise<Skill>

  searchSkills(query: string, ctx: SkillSearchContext): Promise<SkillSearchResult[]>
}
```

---

## 9.3 示例实现

```ts
class FileSystemSkillRegistry implements SkillRegistry {
  private cache = new Map<string, Skill>()

  constructor(
    private skillRoot: string,
    private hooks: HookManager,
    private tokenizer: Tokenizer
  ) {}

  async loadSkill(skillId: string, ctx: SkillLoadContext): Promise<Skill> {
    const cached = this.cache.get(skillId)

    if (cached) {
      await this.hooks.emit("skill.loaded", {
        ...ctx,
        payload: {
          skill_id: cached.id,
          skill_name: cached.name,
          version: cached.version,
          source_path: cached.sourcePath,
          content_hash: cached.contentHash,
          token_count: cached.tokenCount,
          from_cache: true,
        },
      })

      return cached
    }

    const dir = path.join(this.skillRoot, skillId)
    const manifestPath = path.join(dir, "skill.yaml")
    const skillPath = path.join(dir, "SKILL.md")

    const manifest = await readYaml(manifestPath)
    const content = await fs.promises.readFile(skillPath, "utf-8")

    const skill: Skill = {
      id: manifest.id ?? skillId,
      name: manifest.name ?? skillId,
      version: manifest.version ?? "unknown",
      description: manifest.description,
      tags: manifest.tags ?? [],
      type: manifest.type ?? "prompt",
      enabled: manifest.enabled !== false,

      sourcePath: skillPath,
      content,
      contentHash: sha256(content),
      tokenCount: this.tokenizer.estimate(content),

      metadata: manifest,
    }

    this.cache.set(skill.id, skill)

    await this.hooks.emit("skill.loaded", {
      ...ctx,
      payload: {
        skill_id: skill.id,
        skill_name: skill.name,
        version: skill.version,
        source_path: skill.sourcePath,
        content_hash: skill.contentHash,
        token_count: skill.tokenCount,
        from_cache: false,
      },
    })

    return skill
  }
}
```

---

# 10. SkillSelector 设计

## 10.1 职责

`SkillSelector` 负责判断当前 turn 应该使用哪些 skill。

第一版可以很简单：

```text
关键词匹配
tag 匹配
规则匹配
用户显式指定
```

后续可以升级：

```text
embedding 检索
LLM 选择
历史成功率排序
按 token budget 选择
```

---

## 10.2 接口

```ts
interface SkillSelector {
  selectSkills(input: SkillSelectInput): Promise<SelectedSkill[]>
}
```

```ts
type SkillSelectInput = {
  conversationId: string
  turnId: string
  runId: string
  agentName: string

  userMessage: string
  availableSkills: SkillMeta[]
  context?: Record<string, any>
}
```

```ts
type SelectedSkill = {
  skillId: string
  reason: string
  score?: number
  source: "rule" | "keyword" | "llm" | "explicit"
}
```

---

## 10.3 示例

```ts
class RuleBasedSkillSelector implements SkillSelector {
  async selectSkills(input: SkillSelectInput): Promise<SelectedSkill[]> {
    const result: SelectedSkill[] = []

    if (input.userMessage.includes("文章") || input.userMessage.includes("文案")) {
      result.push({
        skillId: "write_article",
        reason: "User message contains article/copywriting intent",
        score: 0.9,
        source: "keyword",
      })
    }

    if (input.userMessage.includes("PDF")) {
      result.push({
        skillId: "create_pdf",
        reason: "User requested PDF generation",
        score: 0.95,
        source: "keyword",
      })
    }

    return result
  }
}
```

选择之后触发：

```ts
await hooks.emit("skill.selected", {
  conversationId,
  turnId,
  runId,
  agentName,
  payload: {
    skill_id: selected.skillId,
    reason: selected.reason,
    score: selected.score,
    source: selected.source,
  },
})
```

---

# 11. ContextBuilder / PromptBuilder 设计

## 11.1 不要到处拼字符串

不要这样：

```ts
let systemPrompt = basePrompt
systemPrompt += skill.content
systemPrompt += memory
systemPrompt += ragContext
```

建议改成结构化 ContextBuilder。

---

## 11.2 PromptSection

```ts
type PromptSection = {
  type:
    | "system"
    | "developer"
    | "memory"
    | "rag"
    | "skill"
    | "tool_instruction"
    | "policy"

  id?: string
  title?: string
  content: string
  tokenCount?: number
  metadata?: Record<string, any>
}
```

---

## 11.3 ContextBuilder

```ts
class ContextBuilder {
  private sections: PromptSection[] = []

  constructor(
    private hooks: HookManager,
    private ctx: RuntimeContext
  ) {}

  addSystemInstruction(content: string) {
    this.sections.push({
      type: "system",
      content,
    })
  }

  addMemory(content: string) {
    this.sections.push({
      type: "memory",
      content,
    })
  }

  addSkill(skill: Skill, options: AddSkillOptions) {
    this.sections.push({
      type: "skill",
      id: skill.id,
      title: skill.name,
      content: skill.content,
      tokenCount: skill.tokenCount,
      metadata: {
        version: skill.version,
        contentHash: skill.contentHash,
        sourcePath: skill.sourcePath,
        reason: options.reason,
        target: options.target ?? "system_prompt.skills",
      },
    })

    this.hooks.emit("skill.injected", {
      conversationId: this.ctx.conversationId,
      turnId: this.ctx.turnId,
      runId: this.ctx.runId,
      agentName: this.ctx.agentName,
      payload: {
        skill_id: skill.id,
        skill_name: skill.name,
        version: skill.version,
        target: options.target ?? "system_prompt.skills",
        token_count: skill.tokenCount,
        content_hash: skill.contentHash,
        reason: options.reason,
      },
    })
  }

  buildMessages(): ModelMessage[] {
    return [
      {
        role: "system",
        content: this.renderSystemPrompt(),
      },
      ...this.renderOtherMessages(),
    ]
  }

  private renderSystemPrompt(): string {
    const systemSections = this.sections.filter(s =>
      ["system", "policy", "memory", "rag", "skill", "tool_instruction"].includes(s.type)
    )

    return systemSections
      .map(section => this.renderSection(section))
      .join("\n\n")
  }

  private renderSection(section: PromptSection): string {
    if (section.type === "skill") {
      return `<skill id="${section.id}" name="${section.title}">
${section.content}
</skill>`
    }

    return section.content
  }

  private renderOtherMessages(): ModelMessage[] {
    return []
  }
}
```

---

# 12. Skill 注入位置设计

不要简单把 skill 全部无脑追加到 system prompt 最后。

建议固定成一个区块：

```text
<system>
核心系统提示词
</system>

<runtime_context>
当前 turn 的上下文
</runtime_context>

<skills>
  <skill id="write_article" version="1.0.0">
  ...
  </skill>

  <skill id="create_pdf" version="1.0.0">
  ...
  </skill>
</skills>

<tools>
工具说明
</tools>
```

这样好处是：

```text
结构清晰
方便 debug
方便 replay
方便统计 token
方便压缩或裁剪
```

---

# 13. HookManager 设计

## 13.1 Hook 类型

建议分三类：

```text
observe hook：只观察，不影响流程
filter hook：可以修改输入/输出
gate hook：可以 allow / deny / ask
```

第一版重点做 observe hook。

---

## 13.2 Hook 事件格式

统一事件格式非常重要。

```ts
type AgentHookEvent<T = any> = {
  eventId: string
  eventName: string

  conversationId: string
  turnId: string
  runId: string
  parentRunId?: string

  spanId?: string
  parentSpanId?: string

  agentName: string
  subagentName?: string

  timestamp: string

  payload: T

  metadata?: {
    userId?: string
    workspaceId?: string
    projectId?: string
    cwd?: string
    source?: "main_agent" | "subagent" | "tool" | "skill" | "sandbox"
  }
}
```

---

## 13.3 HookManager 接口

```ts
interface HookHandler {
  name: string
  mode: "observe" | "filter" | "gate"
  handle(event: AgentHookEvent): Promise<HookResult>
}

type HookResult =
  | { status: "ok" }
  | { status: "error"; error: string }
  | { status: "modified"; patch: any }
  | { decision: "allow" | "deny" | "ask"; reason?: string; message?: string }
```

---

## 13.4 HookManager 实现

```ts
class HookManager {
  private handlers = new Map<string, HookHandler[]>()

  register(eventName: string, handler: HookHandler) {
    const list = this.handlers.get(eventName) ?? []
    list.push(handler)
    this.handlers.set(eventName, list)
  }

  async emit(eventName: string, event: Omit<AgentHookEvent, "eventId" | "eventName" | "timestamp">) {
    const fullEvent: AgentHookEvent = {
      ...event,
      eventId: generateId("event"),
      eventName,
      timestamp: new Date().toISOString(),
    }

    const handlers = this.handlers.get(eventName) ?? []

    for (const handler of handlers) {
      try {
        if (handler.mode === "observe") {
          handler.handle(fullEvent).catch(err => {
            console.error("[Hook Error]", handler.name, err)
          })
          continue
        }

        const result = await handler.handle(fullEvent)

        if ("decision" in result) {
          if (result.decision === "deny") {
            throw new Error(`Hook denied: ${result.reason}`)
          }

          if (result.decision === "ask") {
            // call approval runtime
          }
        }

        if (result.status === "modified") {
          // apply patch if needed
        }
      } catch (err) {
        console.error("[HookManager Error]", handler.name, err)
      }
    }

    return fullEvent
  }
}
```

---

# 14. 内置 Hook

第一版建议内置三个 Hook：

```text
TraceRecorderHook
TokenUsageHook
SkillUsageHook
```

---

## 14.1 TraceRecorderHook

负责把所有事件写入 trace 表。

```ts
class TraceRecorderHook implements HookHandler {
  name = "trace_recorder"
  mode: "observe" = "observe"

  constructor(private traceStore: TraceStore) {}

  async handle(event: AgentHookEvent): Promise<HookResult> {
    await this.traceStore.writeEvent(event)
    return { status: "ok" }
  }
}
```

---

## 14.2 SkillUsageHook

专门记录 skill 使用。

```ts
class SkillUsageHook implements HookHandler {
  name = "skill_usage"
  mode: "observe" = "observe"

  constructor(private skillUsageStore: SkillUsageStore) {}

  async handle(event: AgentHookEvent): Promise<HookResult> {
    if (!event.eventName.startsWith("skill.")) {
      return { status: "ok" }
    }

    await this.skillUsageStore.write({
      conversationId: event.conversationId,
      turnId: event.turnId,
      runId: event.runId,
      agentName: event.agentName,
      eventName: event.eventName,
      payload: event.payload,
      timestamp: event.timestamp,
    })

    return { status: "ok" }
  }
}
```

---

## 14.3 TokenUsageHook

负责汇总 token。

```ts
class TokenUsageHook implements HookHandler {
  name = "token_usage"
  mode: "observe" = "observe"

  async handle(event: AgentHookEvent): Promise<HookResult> {
    if (event.eventName === "model.call.after") {
      // record model usage
    }

    if (event.eventName === "skill.injected") {
      // record prompt token contribution by skill
    }

    return { status: "ok" }
  }
}
```

---

# 15. 热插拔 Hook 配置

## 15.1 配置文件

建议支持：

```text
~/.my-agent/hooks.json
./.agent/hooks.json
./.agent/hooks.local.json
```

第一版可以只支持一个：

```text
./.agent/hooks.json
```

---

## 15.2 配置示例

```json
{
  "hooks": {
    "skill.injected": [
      {
        "name": "record_skill_usage",
        "type": "builtin",
        "handler": "skill_usage",
        "enabled": true
      },
      {
        "name": "debug_skill_injected",
        "type": "script",
        "command": "node ./.agent/hooks/debug-skill.js",
        "mode": "observe",
        "timeout_ms": 3000,
        "enabled": true
      }
    ],
    "tool.call.after": [
      {
        "name": "record_tool_call",
        "type": "builtin",
        "handler": "trace_recorder",
        "enabled": true
      }
    ],
    "subagent.finished": [
      {
        "name": "notify_subagent_done",
        "type": "script",
        "command": "node ./.agent/hooks/notify.js",
        "mode": "observe",
        "timeout_ms": 3000,
        "enabled": false
      }
    ]
  }
}
```

---

## 15.3 Script Hook 协议

Agent 通过 stdin 传 JSON：

```json
{
  "event_name": "skill.injected",
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "run_id": "run_main_001",
  "payload": {
    "skill_id": "write_article",
    "token_count": 820
  }
}
```

脚本通过 stdout 返回 JSON：

```json
{
  "status": "ok"
}
```

失败：

```json
{
  "status": "error",
  "error": "failed to write log"
}
```

---

# 16. 数据库设计

## 16.1 agent_turns

```sql
CREATE TABLE agent_turns (
  id BIGSERIAL PRIMARY KEY,

  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL UNIQUE,

  user_id TEXT,
  user_message_id TEXT,
  assistant_message_id TEXT,

  agent_name TEXT,

  status TEXT NOT NULL,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,

  total_prompt_tokens INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  metadata JSONB DEFAULT '{}'::jsonb
);
```

---

## 16.2 agent_trace_spans

```sql
CREATE TABLE agent_trace_spans (
  id BIGSERIAL PRIMARY KEY,

  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,

  run_id TEXT NOT NULL,
  parent_run_id TEXT,

  span_id TEXT NOT NULL,
  parent_span_id TEXT,

  span_type TEXT NOT NULL,
  name TEXT NOT NULL,

  status TEXT NOT NULL,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,

  input JSONB,
  output JSONB,
  error TEXT,

  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_trace_turn_id ON agent_trace_spans(turn_id);
CREATE INDEX idx_trace_run_id ON agent_trace_spans(run_id);
CREATE INDEX idx_trace_span_id ON agent_trace_spans(span_id);
CREATE INDEX idx_trace_parent_span_id ON agent_trace_spans(parent_span_id);
```

---

## 16.3 agent_hook_events

```sql
CREATE TABLE agent_hook_events (
  id BIGSERIAL PRIMARY KEY,

  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,

  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,

  run_id TEXT NOT NULL,
  parent_run_id TEXT,

  span_id TEXT,
  parent_span_id TEXT,

  agent_name TEXT,
  subagent_name TEXT,

  payload JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_hook_events_turn_id ON agent_hook_events(turn_id);
CREATE INDEX idx_hook_events_event_name ON agent_hook_events(event_name);
```

---

## 16.4 agent_skill_usages

```sql
CREATE TABLE agent_skill_usages (
  id BIGSERIAL PRIMARY KEY,

  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,

  run_id TEXT NOT NULL,
  parent_run_id TEXT,

  agent_name TEXT,
  subagent_name TEXT,

  skill_id TEXT NOT NULL,
  skill_name TEXT,
  skill_version TEXT,

  usage_type TEXT NOT NULL,
  -- selected / loaded / injected / executed

  reason TEXT,
  score DOUBLE PRECISION,

  source_path TEXT,
  content_hash TEXT,

  token_count INTEGER DEFAULT 0,
  from_cache BOOLEAN DEFAULT false,

  target TEXT,

  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_skill_usage_turn_id ON agent_skill_usages(turn_id);
CREATE INDEX idx_skill_usage_skill_id ON agent_skill_usages(skill_id);
CREATE INDEX idx_skill_usage_run_id ON agent_skill_usages(run_id);
```

---

## 16.5 agent_model_calls

可以单独拆，也可以放在 trace span 里。为了后续统计方便，建议拆一张。

```sql
CREATE TABLE agent_model_calls (
  id BIGSERIAL PRIMARY KEY,

  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,

  run_id TEXT NOT NULL,
  span_id TEXT NOT NULL,

  agent_name TEXT,
  model TEXT NOT NULL,

  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  input_summary TEXT,
  output_summary TEXT,

  status TEXT NOT NULL,
  error TEXT,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,

  metadata JSONB DEFAULT '{}'::jsonb
);
```

---

# 17. 一次完整 Turn 流程

主流程应该变成：

```ts
async function handleUserMessage(input: UserMessageInput) {
  const turn = await turnRuntime.startTurn({
    conversationId: input.conversationId,
    userMessage: input.message,
    agentName: "main_agent",
  })

  const ctx: RuntimeContext = {
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    runId: generateId("run"),
    agentName: "main_agent",
  }

  try {
    await hooks.emit("turn.started", {
      ...ctx,
      payload: {
        user_message_id: input.messageId,
      },
    })

    const availableSkills = await skillRegistry.listSkills()

    const selectedSkills = await skillSelector.selectSkills({
      ...ctx,
      userMessage: input.message,
      availableSkills,
    })

    const contextBuilder = new ContextBuilder(hooks, ctx)

    contextBuilder.addSystemInstruction(baseSystemPrompt)

    for (const selected of selectedSkills) {
      await hooks.emit("skill.selected", {
        ...ctx,
        payload: {
          skill_id: selected.skillId,
          reason: selected.reason,
          score: selected.score,
          source: selected.source,
        },
      })

      const skill = await skillRegistry.loadSkill(selected.skillId, ctx)

      contextBuilder.addSkill(skill, {
        reason: selected.reason,
        target: "system_prompt.skills",
      })
    }

    const messages = contextBuilder.buildMessages()

    const result = await modelRuntime.call({
      ...ctx,
      model: "gpt-4.1",
      messages,
    })

    await hooks.emit("turn.finished", {
      ...ctx,
      payload: {
        status: "success",
        assistant_message: result.text,
        usage: result.usage,
      },
    })

    await turnRuntime.finishTurn(turn.turnId, {
      status: "success",
      usage: result.usage,
    })

    return result
  } catch (err) {
    await hooks.emit("turn.failed", {
      ...ctx,
      payload: {
        error: String(err),
      },
    })

    await turnRuntime.finishTurn(turn.turnId, {
      status: "failed",
      error: String(err),
    })

    throw err
  }
}
```

---

# 18. Subagent 中如何使用 Skill

subagent 也必须共享同一个 `turn_id`。

但是它有自己的 `run_id`。

```ts
async function runSubagent(input: SubagentInput, parentCtx: RuntimeContext) {
  const subCtx: RuntimeContext = {
    conversationId: parentCtx.conversationId,
    turnId: parentCtx.turnId,

    runId: generateId("run"),
    parentRunId: parentCtx.runId,

    agentName: input.subagentName,
    parentSpanId: parentCtx.currentSpanId,
  }

  await hooks.emit("subagent.started", {
    ...subCtx,
    payload: {
      subagent_name: input.subagentName,
      input_summary: summarize(input),
    },
  })

  // subagent 内部也走相同的 skill 流程
  const selectedSkills = await skillSelector.selectSkills({
    ...subCtx,
    userMessage: input.task,
    availableSkills: await skillRegistry.listSkills(),
  })

  const contextBuilder = new ContextBuilder(hooks, subCtx)

  for (const selected of selectedSkills) {
    await hooks.emit("skill.selected", {
      ...subCtx,
      payload: {
        skill_id: selected.skillId,
        reason: selected.reason,
        score: selected.score,
      },
    })

    const skill = await skillRegistry.loadSkill(selected.skillId, subCtx)

    contextBuilder.addSkill(skill, {
      reason: selected.reason,
      target: "subagent.system_prompt.skills",
    })
  }

  const result = await modelRuntime.call({
    ...subCtx,
    model: input.model,
    messages: contextBuilder.buildMessages(),
  })

  await hooks.emit("subagent.finished", {
    ...subCtx,
    payload: {
      subagent_name: input.subagentName,
      status: "success",
      usage: result.usage,
    },
  })

  return result
}
```

这样你就可以回答：

```text
这次 turn 里，main_agent 用了哪些 skill？
research_agent 用了哪些 skill？
writer_agent 用了哪些 skill？
每个 subagent 消耗了多少 token？
```

---

# 19. Token 统计方案

## 19.1 skill token

`skill.tokenCount` 可以用 tokenizer 估算。

记录在：

```text
skill.loaded
skill.injected
agent_skill_usages.token_count
```

这表示：

```text
这个 skill 注入 prompt 时贡献了多少输入 token
```

---

## 19.2 model token

model token 必须优先使用模型 API 返回的 usage。

```ts
{
  promptTokens: result.usage.prompt_tokens,
  completionTokens: result.usage.completion_tokens,
  totalTokens: result.usage.total_tokens
}
```

记录在：

```text
model.call.after
agent_model_calls
agent_trace_spans
```

---

## 19.3 turn 总 token

按 turn 汇总：

```sql
SELECT
  turn_id,
  SUM(prompt_tokens) AS prompt_tokens,
  SUM(completion_tokens) AS completion_tokens,
  SUM(total_tokens) AS total_tokens
FROM agent_model_calls
WHERE turn_id = $1
GROUP BY turn_id;
```

---

## 19.4 subagent token

按 run 汇总：

```sql
SELECT
  run_id,
  agent_name,
  SUM(prompt_tokens) AS prompt_tokens,
  SUM(completion_tokens) AS completion_tokens,
  SUM(total_tokens) AS total_tokens
FROM agent_model_calls
WHERE turn_id = $1
GROUP BY run_id, agent_name;
```

---

## 19.5 skill 注入 token

```sql
SELECT
  skill_id,
  skill_name,
  SUM(token_count) AS injected_tokens,
  COUNT(*) AS injected_count
FROM agent_skill_usages
WHERE turn_id = $1
  AND usage_type = 'injected'
GROUP BY skill_id, skill_name;
```

---

# 20. 查询示例

## 20.1 查询一次 turn 用了哪些 skill

```sql
SELECT
  skill_id,
  skill_name,
  skill_version,
  usage_type,
  token_count,
  target,
  reason,
  created_at
FROM agent_skill_usages
WHERE turn_id = $1
ORDER BY created_at ASC;
```

---

## 20.2 查询某个 skill 被使用次数

```sql
SELECT
  skill_id,
  skill_name,
  COUNT(*) AS usage_count,
  SUM(token_count) AS total_injected_tokens
FROM agent_skill_usages
WHERE usage_type = 'injected'
GROUP BY skill_id, skill_name
ORDER BY usage_count DESC;
```

---

## 20.3 查询一次 turn 的调用链

```sql
SELECT
  span_id,
  parent_span_id,
  span_type,
  name,
  status,
  duration_ms,
  total_tokens
FROM agent_trace_spans
WHERE turn_id = $1
ORDER BY started_at ASC;
```

---

## 20.4 查询 subagent token 消耗

```sql
SELECT
  agent_name,
  run_id,
  SUM(total_tokens) AS total_tokens
FROM agent_model_calls
WHERE turn_id = $1
GROUP BY agent_name, run_id
ORDER BY total_tokens DESC;
```

---

# 21. Replay / Debug 设计

你后面一定会需要“复盘一次 turn”。

建议每次 turn 保存一个 summary：

```json
{
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "user_message": "帮我写一篇 SEO 文章",
  "skills": [
    {
      "skill_id": "write_article",
      "version": "1.0.0",
      "usage_type": "injected",
      "token_count": 820
    }
  ],
  "model_calls": [
    {
      "model": "gpt-4.1",
      "total_tokens": 4200
    }
  ],
  "tools": [],
  "subagents": [],
  "total_tokens": 4200
}
```

但不要默认保存完整 system prompt。

建议保存：

```text
content_hash
token_count
skill id
skill version
source path
```

需要 debug 时再按 hash / version 回放。

---

# 22. 安全与隐私

Hook 不能默认拿到全部数据。

尤其是外部 script/http hook。

默认只传：

```text
event_name
turn_id
run_id
skill_id
tool_name
token_count
duration
status
summary
hash
```

不要默认传：

```text
完整 system prompt
完整 message history
API key
cookie
环境变量
文件完整内容
tool raw output
```

如果某个 hook 需要原始数据，要显式配置权限：

```json
{
  "name": "debug_full_prompt",
  "type": "script",
  "command": "node debug.js",
  "permissions": {
    "read_raw_prompt": true,
    "read_raw_tool_output": false,
    "read_env": false
  }
}
```

---

# 23. 最终效果

完成后，你的一次 turn 可以被完整记录成：

```text
turn_001 用户：帮我写一篇 SEO 文章

main_agent
  ├── skill.selected: write_article
  ├── skill.loaded: write_article@1.0.0, 820 tokens
  ├── skill.injected: write_article → system_prompt.skills
  ├── model.call: gpt-4.1, 4200 tokens
  └── turn.finished

统计：
  - 使用 skill：write_article
  - skill 注入 token：820
  - model 总 token：4200
  - subagent token：0
  - tool call：0
```

如果有 subagent：

```text
turn_002 用户：帮我调研并写一份报告

main_agent
  ├── skill.injected: planning
  ├── subagent.started: research_agent
  │     ├── skill.injected: web_research
  │     ├── tool.call: web_search
  │     └── model.call: 8500 tokens
  │
  ├── subagent.started: writer_agent
  │     ├── skill.injected: report_writing
  │     └── model.call: 6200 tokens
  │
  └── model.call: final_answer, 2400 tokens

统计：
  - main_agent tokens: 2400
  - research_agent tokens: 8500
  - writer_agent tokens: 6200
  - total tokens: 17100
  - skills:
      planning
      web_research
      report_writing
```

---

# 27. 最重要的结论

你的方向应该是：

```text
不要把 skill.md 当成普通 markdown 文件临时读。
要把它包装成 Skill 对象。
不要在业务代码里拼 prompt。
要通过 ContextBuilder.addSkill() 注入。
不要用 skill.executed 表示 prompt skill。
要用 skill.injected 表示它参与了本次 turn。
不要把记录逻辑写死在主流程里。
要通过 HookManager 发标准事件。
```

最终架构可以概括为一句话：

> **SkillRegistry 负责加载 skill，ContextBuilder 负责注入 skill，HookManager 负责记录 skill，turn_id 负责把所有行为关联到一次用户输入。**
