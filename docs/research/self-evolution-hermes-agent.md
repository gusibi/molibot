Hermes Agent 的核心定位是一个**自我改进的 AI Agent 框架**（self-improving agent framework），其"自我进化"并非单一机制，而是由几个层次叠加实现的。下面逐层拆解。

---

## 一、整体架构：三层设计

```
用户界面层 (CLI / Gateway / ACP)
        ↓
核心 Agent 层 (AIAgent 对话循环 + 工具注册表 + 记忆)
        ↓
执行后端层 (Terminal / Browser / LLM Provider)
```

入口是 `AIAgent.run_conversation()` 这个核心循环，所有模式（CLI、Telegram、VS Code 插件、批处理）都复用它。 [1](#0-0) 

---

## 二、自我进化的三个层次

### 层次 1：运行时程序性记忆 —— Skills 系统（最核心）

这是 Hermes 最有特色的设计。Agent 在完成复杂任务后，可以通过 `skill_manage` 工具**把成功的方法写成技能文件**（`SKILL.md`），存到 `~/.hermes/skills/`，下次遇到类似任务时直接读取。

```
Agent 完成任务 → skill_manage(action='create') → 写入 SKILL.md
下次启动 → 系统 prompt 注入技能索引 → LLM 按需调用 skill_view() 读取详情
```

关键设计：**渐进式披露（Progressive Disclosure）**，系统 prompt 里只放技能名+简短描述，完整内容按需加载，节省 token。 [2](#0-1) 

`skill_manage` 的触发时机被明确写在工具描述里： [3](#0-2) 

技能分两类记忆：
- `SKILL.md` = **程序性记忆**（how to do，步骤、命令、坑）
- `MEMORY.md` / `USER.md` = **声明性记忆**（facts、用户偏好） [4](#0-3) 

---

### 层次 2：跨会话声明性记忆 —— MemoryStore + Honcho

**本地记忆**：`MEMORY.md`（Agent 笔记，2200字符上限）和 `USER.md`（用户画像，1375字符上限），用 `§` 分隔条目，会话开始时冻结快照注入 system prompt，保证 prefix cache 效率。 [5](#0-4) 

**Honcho 集成**：可选的 AI 原生记忆后端，支持跨会话语义搜索和辩证推理（dialectic Q&A），Agent 可以用 `honcho_context` 工具查询"用户历史上对 X 的偏好是什么"。 [6](#0-5) 

---

### 层次 3：模型级强化学习 —— Batch + RL 训练环境

这是"进化"的最深层：**训练底层 LLM 本身**。

**数据生成**：`BatchRunner` 并行运行 Agent 处理大量 prompt，生成包含完整工具调用链和推理过程的轨迹文件（JSONL），用于 SFT 训练。没有推理过程的轨迹会被丢弃。 [7](#0-6) 

**RL 训练**：通过 `HermesAgentBaseEnv` 对接 Atropos RL 框架，支持两个阶段：
- Phase 1：用 OpenAI 兼容 API（vLLM/SGLang）
- Phase 2：直接解析原始 token，支持 Hermes/DeepSeek/Mistral/Qwen 等格式 [8](#0-7) 

内置 benchmark 环境：TerminalBench 2.0（二值奖励）、WebResearchEnv（多维加权奖励：正确性+来源多样性+效率）。 [9](#0-8) 

---

## 三、设计思路总结

```
┌─────────────────────────────────────────────────────┐
│              闭合学习环（Closed Learning Loop）        │
│                                                     │
│  Agent 使用                                          │
│      ↓                                              │
│  生成轨迹（BatchRunner）                              │
│      ↓                                              │
│  RL/SFT 训练（Atropos + HermesAgentBaseEnv）         │
│      ↓                                              │
│  更好的底层模型                                       │
│      ↓                                              │
│  更好的 Agent（同时 Skills 也在运行时积累）             │
└─────────────────────────────────────────────────────┘
```

几个值得参考的工程细节：

| 设计点 | 实现方式 | 文件 |
|---|---|---|
| 技能安全扫描 | Agent 创建/Hub 安装的技能都过 `scan_skill()`，检测 prompt injection、exfil 等 | `tools/skills_guard.py` |
| 记忆冻结快照 | session 开始时读取，mid-session 写磁盘但不更新 prompt，保证 prefix cache | `tools/memory_tool.py:119-135` |
| 迭代预算 | `IterationBudget` 限制最大轮次（默认90），子 Agent 独立预算（50），`execute_code` 可退款 | `run_agent.py:168-201` |
| 工具集随机采样 | 批处理时按概率分布随机选 toolset，增加训练数据多样性 | `toolset_distributions.py` | [10](#0-9) [11](#0-10) 

**核心设计哲学**：运行时自我进化（Skills）和模型级进化（RL）是两条并行的轨道，前者即时生效，后者需要训练周期但能改变模型本身的能力边界。

### Citations

**File:** run_agent.py (L17-21)
```python
    from run_agent import AIAgent
    
    agent = AIAgent(base_url="http://localhost:30000/v1", model="claude-opus-4-20250514")
    response = agent.run_conversation("Tell me about the latest Python updates")
"""
```

**File:** run_agent.py (L168-181)
```python
    """Thread-safe iteration counter for an agent.

    Each agent (parent or subagent) gets its own ``IterationBudget``.
    The parent's budget is capped at ``max_iterations`` (default 90).
    Each subagent gets an independent budget capped at
    ``delegation.max_iterations`` (default 50) — this means total
    iterations across parent + subagents can exceed the parent's cap.
    Users control the per-subagent limit via ``delegation.max_iterations``
    in config.yaml.

    ``execute_code`` (programmatic tool calling) iterations are refunded via
    :meth:`refund` so they don't eat into the budget.
    """

```

**File:** agent/prompt_builder.py (L18-26)
```python
from agent.skill_utils import (
    extract_skill_conditions,
    extract_skill_description,
    get_all_skills_dirs,
    get_disabled_skill_names,
    iter_skill_index_files,
    parse_frontmatter,
    skill_matches_platform,
)
```

**File:** tools/skill_manager_tool.py (L10-12)
```python
Skills are the agent's procedural memory: they capture *how to do a specific
type of task* based on proven experience. General memory (MEMORY.md, USER.md) is
broad and declarative. Skills are narrow and actionable.
```

**File:** tools/skill_manager_tool.py (L649-658)
```python
        "Create when: complex task succeeded (5+ calls), errors overcome, "
        "user-corrected approach worked, non-trivial workflow discovered, "
        "or user asks you to remember a procedure.\n"
        "Update when: instructions stale/wrong, OS-specific failures, "
        "missing steps or pitfalls found during use. "
        "If you used a skill and hit issues not covered by it, patch it immediately.\n\n"
        "After difficult/iterative tasks, offer to save as a skill. "
        "Skip for simple one-offs. Confirm with user before creating/deleting.\n\n"
        "Good skills: trigger conditions, numbered steps with exact commands, "
        "pitfalls section, verification steps. Use skill_view() to see format examples."
```

**File:** tools/memory_tool.py (L43-50)
```python
def get_memory_dir() -> Path:
    """Return the profile-scoped memories directory."""
    return get_hermes_home() / "memories"

# Backward-compatible alias — gateway/run.py imports this at runtime inside
# a function body, so it gets the correct snapshot for that process.  New code
# should prefer get_memory_dir().
MEMORY_DIR = get_memory_dir()
```

**File:** plugins/memory/honcho/__init__.py (L68-89)
```python
CONTEXT_SCHEMA = {
    "name": "honcho_context",
    "description": (
        "Ask Honcho a natural language question and get a synthesized answer. "
        "Uses Honcho's LLM (dialectic reasoning) — higher cost than honcho_profile or honcho_search. "
        "Can query about any peer: the user (default) or the AI assistant."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "A natural language question.",
            },
            "peer": {
                "type": "string",
                "description": "Which peer to query about: 'user' (default) or 'ai'.",
            },
        },
        "required": ["query"],
    },
}
```

**File:** batch_runner.py (L38-40)
```python
    list_distributions, 
    sample_toolsets_from_distribution,
    validate_distribution
```

**File:** environments/hermes_base_env.py (L4-9)
```python
Provides the Atropos integration plumbing that all hermes-agent environments share:
- Two-mode operation (OpenAI server for Phase 1, VLLM ManagedServer for Phase 2)
- Per-group toolset/distribution resolution
- Agent loop orchestration via HermesAgentLoop
- ToolContext creation for reward functions
- ScoredDataGroup construction from ManagedServer state
```

**File:** environments/web_research_env.py (L7-11)
```python
Reward signals:
  - Answer correctness  (LLM judge, 0.0–1.0)
  - Source diversity    (used ≥2 distinct domains)
  - Efficiency          (penalizes excessive tool calls)
  - Tool usage          (bonus for actually using web tools)
```

**File:** tools/skills_guard.py (L3-9)
```python
Skills Guard — Security scanner for externally-sourced skills.

Every skill downloaded from a registry passes through this scanner before
installation. It uses regex-based static analysis to detect known-bad patterns
(data exfiltration, prompt injection, destructive commands, persistence, etc.)
and a trust-aware install policy that determines whether a skill is allowed
based on both the scan verdict and the source's trust level.
```
