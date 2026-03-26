# System Prompt 优化设计文档

日期：2026-03-26
状态：设计阶段

## 背景

对比两份 system prompt：
- `docs/bad_prompt.md`：Moli bot 当前的 system prompt（约 610 行）
- `docs/good_prompt.md`：Claude Code（Sonnet 4.6）的 system prompt（约 842 行，作为参考标杆）

核心问题：**自然语言描述无法触发 skill，只有显式 slash 命令才触发**。例如说"帮我生成一张图片"时，agent 会去搜索而不是使用 image-generate skill。

## 一、Good Prompt 好在哪里

### 1. 结构分层清晰，职责单一

| 序号 | 模块 | 核心职责 |
|------|------|---------|
| 1 | Deferred Tools 声明 | 延迟加载工具清单（context window 管理策略） |
| 2 | 身份与安全边界 | Agent 身份定义 + 安全红线 |
| 3 | System 运行时规则 | 工具权限、Hook 机制、上下文压缩 |
| 4 | Doing Tasks 工作规范 | 编码行为约束 |
| 5 | Executing Actions with Care | 风险操作决策框架 |
| 6 | Using Your Tools | 工具选择优先级 |
| 7 | Tone / Output / Memory / Environment | 风格、效率、持久化记忆、环境信息 |
| 8 | Tools Schema | 7 个工具的完整 JSON Schema 定义 |

每个 section 有明确的"什么时候触发、做什么、不做什么"，不存在跨 section 的重复指令。

### 2. 规则用"原则 + 例子"模式，而非穷举

风控规则给出可泛化的判断框架：

> Carefully consider the reversibility and blast radius of actions.

然后跟代表性例子（destructive / hard-to-reverse / visible to others / upload to third-party）。模型能泛化到未列举的场景。

### 3. 非对称风险管理框架

建立了完整的风险决策模型：

```
可逆性低 + 影响范围大 → 必须确认
可逆性高 + 影响范围小 → 自由执行
```

四类需确认操作：
- 破坏性操作：删除文件/分支、drop table、rm -rf
- 难以逆转的操作：force push、git reset --hard、降级依赖
- 影响他人可见的操作：push 代码、创建/关闭 PR、发消息
- 上传到第三方的操作：内容可能被缓存或索引

核心原则：**暂停确认的成本很低，而误操作的成本可能很高**。

### 4. 规则强度层级（NEVER / CRITICAL / IMPORTANT）

三级强度标记让模型能区分硬约束和软建议：
- `CRITICAL` — 绝不可违反（如工具选择优先级）
- `IMPORTANT` — 高优先级约束
- `NEVER` — 绝对禁止

### 5. 过度工程约束——"最小必要"原则

分三层约束 AI 的"过度帮助"倾向：
- 层级一：不加未被要求的功能、重构、"改进"
- 层级二：不为不可能的场景添加错误处理；信任内部代码，只在系统边界做校验
- 层级三：不为一次性操作创建 helper/utility/abstraction；三行相似代码好过过早抽象

### 6. 工具定义自带完整 JSON Schema

每个工具有完整的参数 schema（类型、必填项、默认值），模型不需要猜参数格式，调用准确率更高。

### 7. Deferred Tools（延迟加载）

工具分为立即可用（核心编码工具）和延迟加载（通过 ToolSearch 按需获取 schema）。这是精巧的 context window 管理策略——不把所有工具 schema 都塞进 prompt。

### 8. 结构化记忆系统

Memory 按类型分类（user / feedback / project / reference），每种有 when_to_save / how_to_use / examples。明确定义了什么不该存，并区分 memory vs plan vs tasks 三种持久化机制。

元规则："The memory says X exists" is not the same as "X exists now." — 记忆可能过时，使用前必须验证。

### 9. 关键规则带"为什么"

如 Git 中解释 amend 规则的原因（"hook 失败后 amend 会修改上一个 commit"），让模型理解逻辑而非死记规则，从而能举一反三。

### 10. 专用工具优先，以人类可审计性为核心

选择专用工具而非 shell 命令，原因明确：让用户更好地理解和审查 Agent 的操作。

## 二、Bad Prompt 差在哪里

### 1. 大量重复指令（最严重的问题）

**"先用 skill 再用工具"** 至少出现 5 次：
- Capability Use Order: "check whether an existing skill or dedicated runtime tool already fulfills the request"
- Skill Routing: "check whether an installed skill already directly produces the requested result"
- Skills 约定: "如果已有 skill 能直接完成...优先用 skill"
- TOOLS.md: "先用现成能力，再考虑造能力"
- TOOLS.md: "skill 没试过，就没有资格直接进入写代码实现这条路"

**"不要把结果请求当成开发请求"** 也出现至少 3 次：
- Task Framing: "Treat requests like '用语音回复' as outcome requests"
- Capability Use Order: "Do not interpret 'I want voice/image/search/reminder output' as 'please implement voice/image/search/reminder support'"
- TOOLS.md: "先把它理解成结果请求，不是功能开发请求"

重复的后果：
- 浪费 token（直接成本）
- 稀释其他规则的权重（注意力被分散）
- 增加矛盾风险（不同位置措辞略有不同）

### 2. 多来源文件拼合，边界不清

由 AGENTS.md + SOUL.md + TOOLS.md + IDENTITY.md + USER.md + BOOTSTRAP.md 拼接，内容大量交叉：
- AGENTS.md 和 SOUL.md 都定义了行为准则
- TOOLS.md 和主 prompt 的 Capability Use Order / Skills 部分高度重复
- Execution Discipline 和 TOOLS.md 执行约定几乎是同一段话的中英双语版

模型看到的是扁平文本，文件分工对模型没有意义——只有最终拼合后的结构才重要。

### 3. Skill 匹配流程不是"第一步"（核心问题根因）

当前执行流程：
1. Task Framing（分类请求）
2. Capability Use Order（先查已有能力）
3. Skill Routing（如果需要，用 skill）

Skill 匹配排在第三步。模型在第一步就可能把"帮我生成一张图片"归类为"artifact creation"，然后在第二步找到 "bash + python" 或 "web search" 这条路，根本走不到第三步。

### 4. Skill 的 trigger 信息未结构化

trigger 词被埋在 description 的自由文本里：
```
description: 图像生成工具。当用户指令中包含"生成图片"、"画一张"...
```

模型要从描述中提取触发词，不如直接给结构化的 triggers 字段。

### 5. 缺少规则强度层级

所有规则的"语气"都差不多，模型无法区分硬约束和软建议。"优先用 skill" 和其他几十条规则权重一样，模型没有理由特别重视它。

### 6. 路径信息占比过大

同一条路径以完整绝对路径反复出现。optimized_prompt.md 用变量替换已解决此问题。

### 7. 缺少结构化工具定义

工具只有名字和一行描述，没有参数 schema，没有调用示例。模型调用时容易传错参数。

### 8. 防御性规则太多太散

大量"不要做 X"类规则，本质上是同一原则（"数据不要放错位置"）的不同表现，被拆成十几条负面规则。正面规则（直接指出正确路径）对模型更有效。

### 9. 中英混杂

部分规则英文写一遍、中文又写一遍，增加 token 量但没增加信息量。

## 三、优化设计方案

### 3.1 核心改动：统一消息处理流程

把 Task Framing / Capability Use Order / Skill Routing 三处逻辑合并为一个单一决策流程，放在 prompt 最前面（仅次于身份定义），用 CRITICAL 标记：

```
CRITICAL: 每条用户消息按以下顺序处理，不可跳步：

Step 0 — Skill 匹配（必须执行）
  扫描下方 Skill Registry，按三层优先级匹配：
  a) 显式调用（/skill-name, $skill-name, 技能:skill-name）→ 无条件使用
  b) Trigger 词命中 → 使用
  c) 语义匹配（用户想要的产出类型与某 skill 的 output 一致）→ 使用
  命中任意一层即停止，执行该 skill。不命中才进入 Step 1。

Step 1 — 工具匹配
  参考 Tool 映射表，选择最合适的专用工具。

Step 2 — 实时信息判断
  如果涉及时间敏感信息，先搜索再回答。

Step 3 — 直接回答
  以上都不适用时，直接回答。
```

### 3.2 Skill Registry 格式（运行时动态注入）

Prompt 模板定义匹配规则（不依赖具体 skill），运行时自动扫描生成 skill 条目并注入。

每个 skill 条目格式：
```
- **{name}** | scope: {scope} | `{skill_file}`
  Triggers: {trigger_words}
  Output: {output_type}
```

`Output` 字段是语义匹配（Step 0c）的关键依据。

### 3.3 Tool 映射表（静态，写死在模板层）

| 操作     | 必须使用        | 禁止使用                |
|----------|---------------|------------------------|
| 文件读写 | read/write/edit | bash cat/sed/echo      |
| 调度/提醒 | create_event   | sleep/crontab/at       |
| 记忆     | memory 工具     | 直接读写 MEMORY.md     |
| 发文件   | attach          | bash echo 重定向        |

Tool 是静态的，变化少，适合用硬编码映射表。Skill 是动态安装的，靠流程机制保证触发。

### 3.4 去重合并

| 原先散落在 | 合并到 |
|---|---|
| Task Framing + Capability Use Order + Skill Routing + TOOLS.md 执行约定 | 统一的 Step 0-3 流程 |
| 多处"不要把结果请求当开发请求" | Step 0 的 skill 匹配规则中说一次 |
| 多处路径说明 | 顶部变量定义 + Runtime Layout（各一次） |
| AGENTS.md + SOUL.md 重叠的行为准则 | 合并为一个 Principles section |
| Execution Discipline + TOOLS.md 执行约定（中英重复） | 统一中文，保留一份 |

### 3.5 规则强度层级

引入三级标记：
- `CRITICAL` — skill 匹配必须第一步、不可伪造执行结果、不可跳过 skill 直接降级
- `IMPORTANT` — 工具优先级、搜索前置、高风险操作需确认
- 无标记 — 一般指导原则

### 3.6 正面规则替代负面规则

| 原来（负面） | 改为（正面） |
|---|---|
| "不要把 profile 写到 chat 子目录" | "profile 文件只写入 `{molibot}/*.md`" |
| "不要用 memory 充当调度器" | "调度一律用 `create_event`" |
| "不要把结果请求当开发请求" | "用户要图片/语音/搜索结果时，匹配对应 skill 直接产出" |

### 3.7 关键规则补充"为什么"

只给最容易被违反的规则加原因说明：
- Skill 优先：因为搜索返回的是别人的内容，skill 生成的是匹配用户需求的新内容，两者不可互换
- 不 amend：因为 hook 失败后 amend 会修改上一个 commit
- 专用工具优先：让用户更容易审查 agent 的操作

### 3.8 不改动的部分

- 变量化路径（optimized_prompt.md 已做好）
- Identity / Soul / User 的内容本身（只精简重复）
- Memory 规则（当前够用）
- Events 规则（结构清晰）

## 四、预期效果

| 维度 | 预期改善 |
|---|---|
| Skill 自然语言触发率 | 从"只有显式调用才触发"变为"trigger 词和语义匹配都能触发" |
| Prompt token 量 | 减少约 30%（去重 + 变量化 + 统一语言） |
| 规则遵守一致性 | 同一规则只有一个权威来源，消除措辞冲突 |
| 可维护性 | 模板层和动态注入层分离，新增 skill 不需要改 prompt 模板 |

## 五、下一步

1. 确认本设计方案
2. 基于此方案产出优化后的 prompt（v2）
3. 实测 skill 触发率
