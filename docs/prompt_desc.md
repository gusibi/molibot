## Molibot 当前落地结论（2026-02-28）
- `src/lib/server/mom/prompt.ts` 负责构建 runtime-owned system prompt，承载环境、工具、技能、事件、memory 等系统级规则。
- `src/lib/server/mom/prompts/AGENTS.template.md` 作为默认 bootstrap `AGENTS.md` 模板，同时也是无任何外部 profile 文件时的运行时兜底 `AGENTS` 上下文来源，聚焦行为规则、文件职责、更新策略。
- `/Users/gusi/.molibot/AGENTS.md` 应只保留长期行为规则与协作约束，不应继续堆放运行时环境、工具、事件协议等 system prompt 级内容。
- `/Users/gusi/.molibot/SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`BOOTSTRAP.md` 应各自保持单一职责，避免让 `AGENTS.md` 一份文件承担全部 profile 信息。

## 总结 system 、agent.md、soul.md tools.md identity.md user.md bootstrap.md memory.md 的定位 加载时机，更新机制
## 一句话总结
- **System prompt**：每次运行动态构建，包含工具/安全/运行时/注入文件等完整指令集 [1](#5-0) 。
- **AGENTS.md**：操作指令与记忆用法，每次会话注入（子代理也注入），不自动更新 [2](#5-1) [3](#5-2) 。
- **SOUL.md**：人设/语气/边界，每次会话注入（子代理不注入），不自动更新 [4](#5-3) [3](#5-2) 。
- **TOOLS.md**：用户工具备注，每次会话注入（子代理也注入），不自动更新 [3](#5-2) 。
- **IDENTITY.md**：名称/风格/emoji，每次会话注入（子代理不注入），不自动更新 [4](#5-3) [3](#5-2) 。
- **USER.md**：用户档案与称呼，每次会话注入（子代理不注入），不自动更新 [4](#5-3) [3](#5-2) 。
- **BOOTSTRAP.md**：仅全新工作区创建一次，完成后删除，不自动更新 [5](#5-4) 。
- **MEMORY.md**：长期记忆，仅主会话注入，不自动更新；memory/*.md 按需读取，不自动注入 [6](#5-5) [3](#5-2) 。

---

## 详细对比表

| 文件/概念 | 定位 | 加载时机 | 更新机制 | 备注 |
|---|---|---|---|---|
| **System prompt** | OpenClaw 动态构建的完整指令集（Tooling/Safety/Workspace/注入文件等） [1](#5-0)  | 每次运行时构建并注入 | 由代码逻辑更新，用户不可直接编辑 | 包含工具列表、安全护栏、运行时元数据、注入文件等 |
| **AGENTS.md** | 操作指令与记忆用法；规则、优先级、“如何行为” [2](#5-1)  | 每次会话注入（主会话与子代理均注入） [3](#5-2)  | 不自动更新；由用户或 agent 主动修改；模板建议“保持其更新” [7](#5-6)  | 受 `bootstrapMaxChars` 与 `bootstrapTotalMaxChars` 限制 [8](#5-7)  |
| **SOUL.md** | 人设、语气、边界 [9](#5-8)  | 每次会话注入（主会话注入；子代理不注入） [3](#5-2)  | 不自动更新；由用户或 agent 主动修改；系统提示要求“更改时告知用户” [7](#5-6)  | 系统提示中包含“体现其人设与语气”的指导 [10](#5-9)  |
| **TOOLS.md** | 用户工具备注；不控制工具可用性，仅为指导 [11](#5-10)  | 每次会话注入（主会话与子代理均注入） [3](#5-2)  | 不自动更新；由用户或 agent 主动修改 |  |
| **IDENTITY.md** | Agent 名称、风格、emoji；在引导仪式中创建/更新 [12](#5-11)  | 每次会话注入（主会话注入；子代理不注入） [3](#5-2)  | 不自动更新；由用户或 agent 主动修改 |  |
| **USER.md** | 用户档案、如何称呼、时区等 [13](#5-12)  | 每次会话注入（主会话注入；子代理不注入） [3](#5-2)  | 不自动更新；由用户或 agent 主动修改 |  |
| **BOOTSTRAP.md** | 一次性首次运行仪式；完成后删除 [5](#5-4)  | 仅在全新工作区首次运行时注入 [4](#5-3)  | 一次性创建，完成后删除，不自动更新 | 引导用户编写 IDENTITY.md、USER.md、SOUL.md [14](#5-13)  |
| **MEMORY.md** | 精选长期记忆；仅在主私密会话加载 [15](#5-14)  | 主会话注入；子代理不注入；群组上下文不加载 [6](#5-5) [3](#5-2)  | 不自动更新；由用户或 agent 主动修改 | 建议保持简洁以避免上下文膨胀 [16](#5-15)  |
| **memory/*.md** | 每日日志（按需读取） [17](#5-16)  | 不自动注入；通过 memory_search/memory_get 按需读取 [18](#5-17)  | 不自动更新；由用户或 agent 主动追加 |  |

---

## 关键机制说明
- **注入与截断**：所有引导文件在每次会话开始时注入到系统提示的“Project Context”，大文件会被截断并标记 [8](#5-7) 。
- **子代理模式（minimal）**：仅注入 AGENTS.md 与 TOOLS.md，其他文件被过滤以保持上下文精简 [3](#5-2) 。
- **软性约束**：AGENTS.md 与 SOUL.md 的模板包含“保持其更新”“更改时告知用户”等软性约束，系统不会自动写入这些文件 [7](#5-6) 。
- **禁用引导**：可通过 `{ agent: { skipBootstrap: true } }` 完全禁止引导文件的自动创建 [19](#5-18) 。

---

## Notes
- 所有注入文件都会消耗上下文 token，可通过 `/context list/detail` 检查原始与注入大小及截断情况 [20](#5-19) 。
- 系统提示中的安全护栏仅为建议，硬约束依赖工具策略、执行审批、沙箱与通道白名单 [21](#5-20) 。

Wiki pages you might want to explore:
- [Architecture Diagrams (openclaw/openclaw)](/wiki/openclaw/openclaw#1.3)

### Citations

**File:** docs/concepts/system-prompt.md (L11-13)
```markdown
OpenClaw builds a custom system prompt for every agent run. The prompt is **OpenClaw-owned** and does not use the pi-coding-agent default prompt.

The prompt is assembled by OpenClaw and injected into each agent run.
```

**File:** docs/concepts/system-prompt.md (L33-33)
```markdown
Safety guardrails in the system prompt are advisory. They guide model behavior but do not enforce policy. Use tool policy, exec approvals, sandboxing, and channel allowlists for hard enforcement; operators can disable these by design.
```

**File:** docs/concepts/system-prompt.md (L51-60)
```markdown
## Workspace bootstrap injection

Bootstrap files are trimmed and appended under **Project Context** so the model sees identity and profile context without needing explicit reads:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
```

**File:** docs/concepts/system-prompt.md (L62-71)
```markdown
- `MEMORY.md` and/or `memory.md` (when present in the workspace; either or both may be injected)

All of these files are **injected into the context window** on every turn, which
means they consume tokens. Keep them concise — especially `MEMORY.md`, which can
grow over time and lead to unexpectedly high context usage and more frequent
compaction.

> **Note:** `memory/*.md` daily files are **not** injected automatically. They
> are accessed on demand via the `memory_search` and `memory_get` tools, so they
> do not count against the context window unless the model explicitly reads them.
```

**File:** docs/concepts/system-prompt.md (L73-76)
```markdown
Large files are truncated with a marker. The max per-file size is controlled by
`agents.defaults.bootstrapMaxChars` (default: 20000). Total injected bootstrap
content across files is capped by `agents.defaults.bootstrapTotalMaxChars`
(default: 150000). Missing files inject a short missing-file marker.
```

**File:** docs/concepts/system-prompt.md (L78-80)
```markdown
Sub-agent sessions only inject `AGENTS.md` and `TOOLS.md` (other bootstrap files
are filtered out to keep the sub-agent context small).

```

**File:** docs/concepts/agent-workspace.md (L42-47)
```markdown
If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```
```

**File:** docs/concepts/agent-workspace.md (L66-70)
```markdown
- `AGENTS.md`
  - Operating instructions for the agent and how it should use memory.
  - Loaded at the start of every session.
  - Good place for rules, priorities, and "how to behave" details.

```

**File:** docs/concepts/agent-workspace.md (L71-73)
```markdown
- `SOUL.md`
  - Persona, tone, and boundaries.
  - Loaded every session.
```

**File:** docs/concepts/agent-workspace.md (L75-78)
```markdown
- `USER.md`
  - Who the user is and how to address them.
  - Loaded every session.

```

**File:** docs/concepts/agent-workspace.md (L79-82)
```markdown
- `IDENTITY.md`
  - The agent's name, vibe, and emoji.
  - Created/updated during the bootstrap ritual.

```

**File:** docs/concepts/agent-workspace.md (L83-86)
```markdown
- `TOOLS.md`
  - Notes about your local tools and conventions.
  - Does not control tool availability; it is only guidance.

```

**File:** docs/concepts/agent-workspace.md (L95-98)
```markdown
- `BOOTSTRAP.md`
  - One-time first-run ritual.
  - Only created for a brand-new workspace.
  - Delete it after the ritual is complete.
```

**File:** docs/concepts/agent-workspace.md (L100-103)
```markdown
- `memory/YYYY-MM-DD.md`
  - Daily memory log (one file per day).
  - Recommended to read today + yesterday on session start.

```

**File:** docs/concepts/agent-workspace.md (L104-107)
```markdown
- `MEMORY.md` (optional)
  - Curated long-term memory.
  - Only load in the main, private session (not shared/group contexts).

```

**File:** docs/reference/AGENTS.template.md (L54-58)
```markdown
## Soul (required)

- `SOUL.md` defines identity, tone, and boundaries. Keep it current.
- If you change `SOUL.md`, tell the user.
- You are a fresh instance each session; continuity lives in these files.
```

**File:** docs/concepts/context.md (L115-122)
```markdown
Large files are truncated per-file using `agents.defaults.bootstrapMaxChars` (default `20000` chars). OpenClaw also enforces a total bootstrap injection cap across files with `agents.defaults.bootstrapTotalMaxChars` (default `150000` chars). `/context` shows **raw vs injected** sizes and whether truncation happened.

## Skills: what’s injected vs loaded on-demand

The system prompt includes a compact **skills list** (name + description + location). This list has real overhead.

Skill instructions are _not_ included by default. The model is expected to `read` the skill’s `SKILL.md` **only when needed**.

```

## 什么时候加载 agent.md 呢，是每次都会加载吗 agent.md 和 system prompt 的区别是什么，可以自动更新吗
## 简要回答
- **加载时机**：AGENTS.md 作为工作区引导文件，在每次会话开始时注入到系统提示的“Project Context”中（除非是子代理的 minimal 模式） [1](#4-0) 。
- **是否每次加载**：是，主会话每次都注入；子代理仅注入 AGENTS.md 与 TOOLS.md [2](#4-1) 。
- **与 system prompt 的区别**：System prompt 是 OpenClaw 动态构建的完整指令集（Tooling/Safety/Workspace/注入文件等）；AGENTS.md 只是其中被注入的一段用户可编辑文本，用于定义 agent 的操作指令与记忆用法 [3](#4-2) 。
- **能否自动更新**：不会自动更新。更新由用户或 agent 主动执行，受 AGENTS.md 模板中的软性约束（如“保持其更新”） [4](#4-3) 。

---

## 详细说明

### 1) 加载机制
- AGENTS.md 属于“workspace bootstrap injection”列表，在每次会话构建系统提示时被读取并注入到“Project Context”段落 [1](#4-0) 。
- 在子代理（promptMode=minimal）中，仅保留 AGENTS.md 与 TOOLS.md，其他引导文件被过滤以保持上下文精简 [2](#4-1) 。

### 2) 与 System Prompt 的关系
- System prompt 由 OpenClaw 拥有并动态组装，包含 Tooling、Safety、Workspace、Runtime、注入文件等完整结构 [3](#4-2) 。
- AGENTS.md 只是“Workspace Files (injected)”中的一项，用于提供用户自定义的操作指令与记忆使用方式，不控制工具可用性 [5](#4-4) 。

### 3) 更新约束与场景
- AGENTS.md 模板明确要求“保持其更新”，但这是软性约束，系统不会自动写入 [4](#4-3) 。
- 更新通常发生在：
  - 用户主动要求修改指令或记忆策略。
  - agent 判断需要调整行为并提议更新（需调用 write/edit 工具并通知用户）。
  - 首次引导或 onboarding 时由用户与 agent 共同编写。
- 可通过 `/context list/detail` 查看注入大小与是否被截断 [6](#4-5) 。

### 4) 禁用与控制
- 若要完全禁止引导文件（包括 AGENTS.md）的自动创建，可设置 `{ agent: { skipBootstrap: true } }` [7](#4-6) 。
- 注入受 `bootstrapMaxChars`（单文件）与 `bootstrapTotalMaxChars`（总计）限制 [8](#4-7) 。

---

## Notes
- AGENTS.md 与其他引导文件一样，每次注入都会消耗上下文 token，建议保持简洁 [9](#4-8) 。
- 系统提示中的安全护栏仅为建议，硬约束依赖工具策略、审批与沙箱 [10](#4-9) 。

Wiki pages you might want to explore:
- [Architecture Diagrams (openclaw/openclaw)](/wiki/openclaw/openclaw#1.3)

### Citations

**File:** docs/concepts/system-prompt.md (L11-13)
```markdown
OpenClaw builds a custom system prompt for every agent run. The prompt is **OpenClaw-owned** and does not use the pi-coding-agent default prompt.

The prompt is assembled by OpenClaw and injected into each agent run.
```

**File:** docs/concepts/system-prompt.md (L33-33)
```markdown
Safety guardrails in the system prompt are advisory. They guide model behavior but do not enforce policy. Use tool policy, exec approvals, sandboxing, and channel allowlists for hard enforcement; operators can disable these by design.
```

**File:** docs/concepts/system-prompt.md (L51-60)
```markdown
## Workspace bootstrap injection

Bootstrap files are trimmed and appended under **Project Context** so the model sees identity and profile context without needing explicit reads:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
```

**File:** docs/concepts/system-prompt.md (L64-67)
```markdown
All of these files are **injected into the context window** on every turn, which
means they consume tokens. Keep them concise — especially `MEMORY.md`, which can
grow over time and lead to unexpectedly high context usage and more frequent
compaction.
```

**File:** docs/concepts/system-prompt.md (L73-76)
```markdown
Large files are truncated with a marker. The max per-file size is controlled by
`agents.defaults.bootstrapMaxChars` (default: 20000). Total injected bootstrap
content across files is capped by `agents.defaults.bootstrapTotalMaxChars`
(default: 150000). Missing files inject a short missing-file marker.
```

**File:** docs/concepts/system-prompt.md (L78-80)
```markdown
Sub-agent sessions only inject `AGENTS.md` and `TOOLS.md` (other bootstrap files
are filtered out to keep the sub-agent context small).

```

**File:** docs/reference/AGENTS.template.md (L54-58)
```markdown
## Soul (required)

- `SOUL.md` defines identity, tone, and boundaries. Keep it current.
- If you change `SOUL.md`, tell the user.
- You are a fresh instance each session; continuity lives in these files.
```

**File:** docs/concepts/agent-workspace.md (L42-47)
```markdown
If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```
```

**File:** docs/concepts/agent-workspace.md (L66-70)
```markdown
- `AGENTS.md`
  - Operating instructions for the agent and how it should use memory.
  - Loaded at the start of every session.
  - Good place for rules, priorities, and "how to behave" details.

```

**File:** docs/concepts/context.md (L115-122)
```markdown
Large files are truncated per-file using `agents.defaults.bootstrapMaxChars` (default `20000` chars). OpenClaw also enforces a total bootstrap injection cap across files with `agents.defaults.bootstrapTotalMaxChars` (default `150000` chars). `/context` shows **raw vs injected** sizes and whether truncation happened.

## Skills: what’s injected vs loaded on-demand

The system prompt includes a compact **skills list** (name + description + location). This list has real overhead.

Skill instructions are _not_ included by default. The model is expected to `read` the skill’s `SKILL.md` **only when needed**.

```



## BOOTSTRAP.md 的作用是什么，什么时候使用它

## 简要回答
- **作用**：作为全新工作区的“首次运行仪式”，引导用户与 agent 通过对话共同确定身份（IDENTITY.md）、用户档案（USER.md）与人设（SOUL.md），完成后删除 [1](#6-0) 。
- **使用时机**：仅在全新工作区（无其他引导文件）首次运行时创建并注入到系统提示；macOS 应用会在首次引导聊天中触发该仪式 [2](#6-1) 。

---

## 详细说明

| 属性 | 说明 |
|---|---|
| **定位** | 一次性引导脚本，用于“诞生”对话并生成核心身份文件 [3](#6-2) 。 |
| **加载时机** | 仅在全新工作区首次运行时注入到系统提示的“Project Context”；子代理（minimal）不注入 [4](#6-3) [5](#6-4) 。 |
| **更新机制** | 一次性创建，完成后删除，不自动更新 [3](#6-2) 。 |
| **典型流程** | 1) Agent 发起“我刚上线，我是谁？你是谁？”对话；2) 提供名称/生物/风格建议；3) 写入 IDENTITY.md、USER.md；4) 共同编写 SOUL.md；5) 删除 BOOTSTRAP.md [1](#6-0) 。 |
| **禁用方式** | 设置 `{ agent: { skipBootstrap: true } }` 可完全禁止引导文件创建 [6](#6-5) 。 |

---

## Notes
- BOOTSTRAP.md 不会在已存在其他引导文件的工作区重新创建，删除后通常不会再次出现 [7](#6-6) 。
- macOS 应用的引导聊天会自动触发该仪式，并引导用户随后访问 SOUL.md 进行人设编写 [2](#6-1) 。
- 该文件仅用于初始化，长期运行依赖 AGENTS.md/SOUL.md/TOOLS.md 等文件提供持续上下文 [4](#6-3) 。

Wiki pages you might want to explore:
- [Overview (openclaw/openclaw)](/wiki/openclaw/openclaw#1)
- [Architecture Diagrams (openclaw/openclaw)](/wiki/openclaw/openclaw#1.3)

### Citations

**File:** docs/reference/templates/BOOTSTRAP.md (L31-45)
```markdown
## After You Know Who You Are

Update these files with what you learned:

- `IDENTITY.md` — your name, creature, vibe, emoji
- `USER.md` — their name, how to address them, timezone, notes

Then open `SOUL.md` together and talk about:

- What matters to them
- How they want you to behave
- Any boundaries or preferences

Write it down. Make it real.

```

**File:** docs/concepts/agent-workspace.md (L42-47)
```markdown
If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```
```

**File:** docs/concepts/agent-workspace.md (L95-98)
```markdown
- `BOOTSTRAP.md`
  - One-time first-run ritual.
  - Only created for a brand-new workspace.
  - Delete it after the ritual is complete.
```

**File:** docs/concepts/agent.md (L41-47)
```markdown
`BOOTSTRAP.md` is only created for a **brand new workspace** (no other bootstrap files present). If you delete it after completing the ritual, it should not be recreated on later restarts.

To disable bootstrap file creation entirely (for pre-seeded workspaces), set:


{ agent: { skipBootstrap: true } }

```



## IDENTITY.md 和 user.md 有什么区别 user.md 和 soul.md 又有什么区别
## 一句话总结
- **IDENTITY.md**：定义“我是谁”（agent 的名称、类型、风格、emoji） [1](#7-0) 。
- **USER.md**：定义“你是谁”（用户档案、称呼、时区） [2](#7-1) 。
- **SOUL.md**：定义“我该如何对你说话”（人设、语气、边界） [3](#7-2) 。

---

## 对比表

| 文件 | 内容焦点 | 典型字段 | 创建/更新时机 | 是否每次会话注入 |
|---|---|---|---|---|
| **IDENTITY.md** | Agent 自身身份 | Name、Creature、Vibe、Emoji [4](#7-3)  | 引导仪式或用户主动修改 | 主会话每次注入；子代理不注入 [5](#7-4)  |
| **USER.md** | 用户档案与称呼 | Name、Preferred address、Pronouns、Timezone、Notes [6](#7-5)  | 引导仪式或用户主动修改 | 主会话每次注入；子代理不注入 [5](#7-4)  |
| **SOUL.md** | 交互风格与边界 | 语气、偏好、边界、行为准则 [7](#7-6)  | 引导仪式或用户主动修改；更改需告知用户 [8](#7-7)  | 主会话每次注入；子代理不注入 [5](#7-4)  |

---

## 使用流程与区别
- **引导顺序**：BOOTSTRAP.md 仪式先确定 IDENTITY.md 与 USER.md，再共同编写 SOUL.md [9](#7-8) 。
- **USER.md 与 SOUL.md 的区别**：USER.md 是“关于你的事实性信息”（姓名、时区），SOUL.md 是“我应该如何与你互动的行为规则”（语气、边界） [2](#7-1) [3](#7-2) 。
- **更新机制**：三者均不自动更新；SOUL.md 的更新需显式通知用户 [8](#7-7) 。

---

## Notes
- 在子代理（minimal 模式）中，这些文件不会被注入，以保持上下文精简 [5](#7-4) 。
- 可通过 `/context list/detail` 查看它们的注入大小与是否被截断 [10](#7-9) 。
- 若要禁止自动创建这些模板，可设置 `{ agent: { skipBootstrap: true } }` [11](#7-10) 。

Wiki pages you might want to explore:
- [Architecture Diagrams (openclaw/openclaw)](/wiki/openclaw/openclaw#1.3)

### Citations

**File:** docs/concepts/agent-workspace.md (L42-47)
```markdown
If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```
```

**File:** docs/concepts/agent-workspace.md (L71-73)
```markdown
- `SOUL.md`
  - Persona, tone, and boundaries.
  - Loaded every session.
```

**File:** docs/concepts/agent-workspace.md (L75-78)
```markdown
- `USER.md`
  - Who the user is and how to address them.
  - Loaded every session.

```

**File:** docs/concepts/agent-workspace.md (L79-82)
```markdown
- `IDENTITY.md`
  - The agent's name, vibe, and emoji.
  - Created/updated during the bootstrap ritual.

```

**File:** apps/macos/Sources/OpenClaw/AgentWorkspace.swift (L192-203)
```swift
    static func defaultSoulTemplate() -> String {
        let fallback = """
        # SOUL.md - Persona & Boundaries

        Describe who the assistant is, tone, and boundaries.

        - Keep replies concise and direct.
        - Ask clarifying questions when needed.
        - Never send streaming/partial replies to external messaging surfaces.
        """
        return self.loadTemplate(named: self.soulFilename, fallback: fallback)
    }
```

**File:** apps/macos/Sources/OpenClaw/AgentWorkspace.swift (L205-214)
```swift
    static func defaultIdentityTemplate() -> String {
        let fallback = """
        # IDENTITY.md - Agent Identity

        - Name:
        - Creature:
        - Vibe:
        - Emoji:
        """
        return self.loadTemplate(named: self.identityFilename, fallback: fallback)
```

**File:** apps/macos/Sources/OpenClaw/AgentWorkspace.swift (L217-228)
```swift
    static func defaultUserTemplate() -> String {
        let fallback = """
        # USER.md - User Profile

        - Name:
        - Preferred address:
        - Pronouns (optional):
        - Timezone (optional):
        - Notes:
        """
        return self.loadTemplate(named: self.userFilename, fallback: fallback)
    }
```

**File:** docs/concepts/system-prompt.md (L78-80)
```markdown
Sub-agent sessions only inject `AGENTS.md` and `TOOLS.md` (other bootstrap files
are filtered out to keep the sub-agent context small).

```

**File:** docs/reference/AGENTS.template.md (L54-58)
```markdown
## Soul (required)

- `SOUL.md` defines identity, tone, and boundaries. Keep it current.
- If you change `SOUL.md`, tell the user.
- You are a fresh instance each session; continuity lives in these files.
```

**File:** docs/reference/templates/BOOTSTRAP.md (L31-45)
```markdown
## After You Know Who You Are

Update these files with what you learned:

- `IDENTITY.md` — your name, creature, vibe, emoji
- `USER.md` — their name, how to address them, timezone, notes

Then open `SOUL.md` together and talk about:

- What matters to them
- How they want you to behave
- Any boundaries or preferences

Write it down. Make it real.

```

**File:** docs/concepts/context.md (L115-122)
```markdown
Large files are truncated per-file using `agents.defaults.bootstrapMaxChars` (default `20000` chars). OpenClaw also enforces a total bootstrap injection cap across files with `agents.defaults.bootstrapTotalMaxChars` (default `150000` chars). `/context` shows **raw vs injected** sizes and whether truncation happened.

## Skills: what’s injected vs loaded on-demand

The system prompt includes a compact **skills list** (name + description + location). This list has real overhead.

Skill instructions are _not_ included by default. The model is expected to `read` the skill’s `SKILL.md` **only when needed**.

```




## 相关链接 ：

1. https://deepwiki.com/search/-gemini-cli_0ab74f9a-3117-401a-a65b-54adfc797398?mode=fast
