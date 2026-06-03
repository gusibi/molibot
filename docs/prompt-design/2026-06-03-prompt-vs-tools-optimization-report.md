# System Prompt 与 Tool Descriptions 优化实施方案

**文档状态**: 可执行 (Actionable)
**目标**: 解决大模型 Agent 提示词臃肿、注意力稀释以及无谓 Token 消耗的问题，明确系统提示词与工具描述的职责边界。

---

## 1. 当前问题 (Current Problems)

通过审查 `molibot/src/lib/server/agent/prompts/prompt.ts` 及相关 Tools 代码，当前架构存在以下明显缺陷：

1. **System Prompt 极度臃肿**: `prompt.ts` 包含长达 450+ 行的生成逻辑，拼接了 15 个以上的独立 Sections，长文本导致 LLM 执行时产生“注意力稀释 (Attention Dilution)”，容易忽略长尾规则。
2. **规则与工具定义双重重叠**: 例如 `prompt.ts` 中的 `buildToolsSection` 手写了一个 "Tool Priority Table"，同时解释了 `bash`、`createEvent` 的详细用法。而这些工具本身的 JSON Schema 在发给大模型时，又带有一遍自身的结构定义，造成概念冗余。
3. **防御性指令极度零散**: 系统提示词中存在多达 6 个独立段落（`Execution Discipline`, `Freshness`, `Safety`, `External Content Safety` 等），里面充斥着大量的 `- Do not...`，占用了大量 Token。
4. **静态加载导致无谓的 Token 消耗**: `createEvent`、`skillManage` 等被设计为按需加载的 **Deferred Tools**，但它们的**详细使用说明**却被静态硬编码在了每次全局请求的 System Prompt 中，违背了延迟加载节省 Token 的初衷。

---

## 2. 问题分析 (Problem Analysis)

核心疑问：**“把文本从 prompt 简单迁移到 Tool description 会减少 Token 输入吗？”**
**答案是：简单搬运不省 Token，但结构化重构和利用延迟加载可以巨幅节省 Token。**

### 2.1 Token 消耗机制
大模型 API 的底层实现中，注册的 Tools 数组会被序列化为文本结构并作为输入上下文发送。如果原封不动搬运文本，算上 JSON 结构的开销，Token 反而会微增。

### 2.2 真正的优化逻辑 (Why it works)
1. **去重压缩 (Deduplication)**: 将 Tool Priority Table 中的自然语言教学（如“读文件要用 read 不能用 cat”），浓缩为目标工具 Schema 中的一条 Negative Prompt（负面提示）。这比在系统提示词里长篇大论要省字数得多。
2. **按需加载 (Deferred Schema Injection)**: 将 `createEvent` 在 `prompt.ts` 里的几百字用法说明（不能用 sleep、输出要求等）移到 `event.ts` 的 Schema 描述中。**效果**：当用户普通闲聊时，该工具未加载，这几百字描述不会发送；只有模型决定使用 `toolSearch` 加载 `createEvent` 时，模型才会看到这些细则。这从根本上切断了长尾工具对常规对话的持续 Token 消耗。
3. **聚焦注意力**: 模型在决定填充参数时，对附着在参数旁边的 Description 注意力最为集中。把约束规则放在这里，模型的遵守率最高。

---

## 3. 优化策略 (Optimization Strategy)

明确**系统提示词 (System Prompt)** 与 **工具描述 (Tool Schema)** 的职责边界：

*   **System Prompt 负责“宏观大局” (Global & Macro)**：
    *   Agent 核心人设与底线安全。
    *   **顶层 Pipeline 路由策略**：遇到任务第一步干什么（调 Skill），第二步干什么（搜 Tool）。
    *   **极简防御原则**：浓缩高密度的行为准则（Core Directives）。
*   **Tool Schema 负责“微观操作” (Micro & Tactical)**：
    *   该工具的使用场景、前置后置条件。
    *   **参数约束**：例如时间格式、必填逻辑。
    *   **排斥性提示 (Negative Prompts)**：例如“不要用某某等效的 bash 命令”。

---

## 4. 具体执行方案 (Actionable Execution Plan)

本方案分为两个阶段，请开发人员/Agent 按照以下步骤严格执行代码修改：

### Phase 1: 系统提示词瘦身 (`src/lib/server/agent/prompts/prompt.ts`)

**目标**：将 450+ 行的生成逻辑精简 50%，移除所有具体的工具教学。

*   **Action 1.1: 整合防御指令**
    *   **删除**以下 6 个冗长的生成函数：`buildExecutionDisciplineSection`, `buildFreshnessSection`, `buildExternalContentSafetySection`, `buildConfirmationSection`, `buildSafetySection`, `buildFailureRecoverySection`。
    *   **新建**一个 `buildCoreDirectivesSection()` 函数，将上述逻辑用极高密度的英语压缩为不超过 8-10 行的要点列表（例如整合为 `Safety & Truth`, `Execution`, `Failure Recovery` 三个 bullet points）。
*   **Action 1.2: 精简 Pipeline 与路由**
    *   **合并** `buildMessageProcessingPipeline`, `buildSkillRoutingSection`, `buildSkillsProtocolSection`。
    *   **重写**为极其精炼的 3 步路由：(1) 强制执行 Explicit Skill (2) 复杂任务先调 `skillSearch` (3) 基础任务使用专用 Tools 或 Bash。
*   **Action 1.3: 移除工具级教学文本**
    *   **删除** `buildEventsSection`（关于 createEvent 的几十行说明全部删掉，仅保留一句：“For events/reminders, use toolSearch to find createEvent”）。
    *   **删除** `buildHostToolApprovalSection`（仅保留一句：“Bash runs in a sandbox. If host OS integration is strictly required, use bash tool with hostApproval parameters.”）。
    *   **删除** `buildToolSearchProtocolSection` 中对于 `<functions>` 返回格式的自然语言解释。
*   **Action 1.4: 移除 Tool Priority Table**
    *   **修改** `buildToolsSection`，直接删掉那个 Markdown 表格。
    *   **替换为**一句强指令："CRITICAL: Always use dedicated tools (read/write/edit/memory) over their bash equivalents (cat/echo/sed)."

### Phase 2: 工具描述强化 (Tools Directory)

**目标**：将 Phase 1 中删除的微观约束，精准注入到对应 Tool 的 JSON Schema 描述中。

*   **Action 2.1: 改造 `src/lib/server/agent/tools/event.ts`**
    *   在 `eventSchema` 或顶层工具的 `description` 字段中，**增加以下明确指示**（承接自原 prompt）：
        `"Schedule messages/reminders. NEVER implement delays via bash 'sleep' or 'crontab'. When scheduling succeeds, output the EXACT confirmation text returned by this tool without modifications."`
    *   在 `type` 参数的描述中明确 `one-shot` (ISO8601), `periodic` (cron) 的触发条件。
*   **Action 2.2: 改造 `src/lib/server/agent/tools/bash.ts`**
    *   在 `bashSchema` 的顶层 `description` 字段中**增加**：
        `"Execute shell commands in an OS sandbox. Used for scripting, file ops, 'pip/npm install'. Python venv is pre-activated."`
    *   在 `hostApproval` 参数的 `description` 中**增加**（承接自原 prompt）：
        `"DO NOT attempt to bypass the sandbox via commands. Populate this parameter instead of 'command' ONLY IF the task inherently requires host-level capabilities (e.g., browser control, native UI apps) and encounters permission errors."`
*   **Action 2.3: 改造基础文件工具 (`read.ts`, `write.ts`, `edit.ts`)**
    *   承接原 Tool Priority Table 的作用，在这些工具的 schema description 尾部添加负面提示（Negative Prompts）。
    *   `read.ts` 增加：`"Use this tool exclusively for reading files. DO NOT use bash 'cat', 'head', or 'tail'."`
    *   `write.ts` 增加：`"Use this tool to create new files or rewrite small files entirely. DO NOT use bash 'echo' or heredocs for writing files."`
    *   `edit.ts` 增加：`"Use this tool for precise inline code modifications. DO NOT use bash 'sed' or 'awk'."`
*   **Action 2.4: 改造路由工具 (`toolSearch.ts`, `skillSearch.ts`)**
    *   优化 `toolSearch.ts` 的描述，确保其说明自己是获取 Deferred Tools Schema 的唯一入口，模型只需传入 query 即可获得完整的调用能力。