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

