# 机器人会话与沙盒控制指令指南 (Session & Sandbox Control Commands Guide)

为了让用户在不同聊天渠道 (Telegram, Feishu, QQ, Weixin) 中能够精细地控制消息展示与安全执行级别，Molibot 提供了三个核心会话级指令：`/toolprogress`、`/showreasoning` 与 `/sandbox`。

这些指令均支持**实例级（Bot/渠道实例）**的隔离控制与**会话级（Session）**的临时覆盖。

---

## 1. `/toolprogress` - 工具执行进度控制

当智能体在后台调用各种工具（例如执行终端命令、搜索网页、读写文件、调度子智能体等）时，该命令用于控制这些中间执行状态在聊天界面中的呈现级别。

### 命令格式
```bash
/toolprogress [off | new | all | verbose | reset]
```

### 参数与展示效果对比

| 参数选项 | 展示级别 | 具体展示效果与设计意图 |
| :--- | :--- | :--- |
| **无参数** | 查看状态 | 输出当前全局默认配置、当前 Bot 的专属配置，以及当前生效的 Effective 值。 |
| **`off`** | 完全关闭 | **完全静默**：不向聊天窗口发送任何中间工具执行进度。<br>• **Telegram / Feishu**: 彻底跳过中间状态消息的编辑和创建，界面只呈现最终答案。<br>• **QQ / Weixin**: 强行拦截 `_→ tool_` 消息，不发送任何中间步骤，避免多步任务在群聊中刷屏。 |
| **`new`** | 仅新进度 | **单行极简**：仅显示当前正在运行的单个工具。<br>• 示例：`⏳ terminal...`<br>• 当该步骤执行完毕且无新工具时，进度自动隐去，保持界面极度干净。 |
| **`all`** *(默认)* | 完整列表 | **常规列表**：以列表形式呈现所有被调用的工具名称与状态图标。<br>• 示例：<br>&nbsp;&nbsp;`🔎 search`<br>&nbsp;&nbsp;`💻 terminal`<br>&nbsp;&nbsp;`⏳ subagent:scout`<br>• 各渠道会使用统一提取的 Emoji 图标进行状态可视化。 |
| **`verbose`** | 详细信息 | **详细输出**：在 `all` 列表的基础上，额外附带工具返回结果的简短摘要。<br>• 示例：<br>&nbsp;&nbsp;`🔎 search: "Found 3 results for..."`<br>&nbsp;&nbsp;`💻 terminal: "Build succeeded in 1.2s..."` |
| **`reset` / `inherit`** | 继承全局 | 清除当前 Bot 实例的独立覆盖设置，重新继承全局默认设置（全局默认为 `all`）。 |

---

## 2. `/showreasoning` - 模型思考过程控制

针对支持推理模型（如 DeepSeek-R1、Claude 3.5 Thinking 等）输出的 `thinking_delta` 思考流，该命令用于控制思考块在聊天界面中的呈现方式。

### 命令格式
```bash
/showreasoning [off | on | stream | new | reset]
```

### 参数与展示效果对比

| 参数选项 | 展示行为 | 具体展示效果与设计意图 |
| :--- | :--- | :--- |
| **无参数** | 查看状态 | 输出当前 Bot 的思考过程展示级别和当前生效的 Effective 值。 |
| **`off`** *(默认)* | 完全隐藏 | **净化界面**：丢弃所有 `thinking_delta` 推理流，只展示模型给出的最终文字回答。适用于不喜欢界面被冗长思考过程占用的用户。 |
| **`on`** | 归档展示 | **独立展示**：在模型完全生成最终回答后，将整个思考过程作为一条独立消息发送，不再混入最终答案消息。 |
| **`stream`** | 实时流式 | **完整流式**：在支持编辑或流式输出的渠道中，持续更新一条独立的思考消息，展示完整 reasoning；最终答案始终保持在另一条消息中。 |
| **`new`** | 最近进度 | **轻量进度**：在支持编辑或流式输出的渠道中，持续更新一条独立的思考进度消息，只保留最近一句 reasoning。Telegram 会在结束后删除临时进度消息；Feishu 会将其收尾为“思考完成”。 |
| **`reset`** | 继承全局 | 清除当前 Bot 实例的独立覆盖设置，重新继承全局默认配置（全局默认为 `off`）。 |

---

## 3. `/sandbox` - OS 沙盒执行控制

该指令用于控制智能体在执行终端 shell 命令（例如 `bash`）时是否启用安全隔离沙盒（OS Sandbox）。

为了满足各种使用场景（如仅针对单次会话临时关闭沙盒调试，或是针对某个渠道的 Bot 永久关闭沙盒），Molibot 实现了**多层级覆盖配置链**，具体解析优先级顺序为：
**1. 会话覆盖 (Session Override) > 2. 机器人设置 (Bot Instance Override) > 3. 智能体设置 (Agent Override) > 4. 全局默认设置 (Global Default)**

### 命令格式
```bash
/sandbox [on | off | reset]
/sandbox bot [on | off | reset]
/sandbox agent [on | off | reset]
```

### 参数与效果说明

| 指令级及参数 | 生效范围 | 具体执行效果与适用场景 |
| :--- | :--- | :--- |
| **无参数** (`/sandbox`) | 查看状态 | 输出当前实际生效的 Sandbox 状态（ENABLED/DISABLED），并详尽列出四个层级当前的设置值与来源。 |
| **`/sandbox off`** | 当前会话 | **临时关闭沙盒并免除 Host Bash 审批（Host full access）**：在当前会话中完全关闭沙盒，使接下来的终端命令均直接在宿主机环境（Host Bash）下执行，不再为普通 `bash` 或模型附带的 `hostApproval` 参数弹出 Host Bash 审批。<br>• 适用场景：在当前对话中临时安装系统依赖、在工作区外写入配置文件等调试任务。<br>• 重置条件：发送 `/new` 清除会话、或切换 Bot 时，该临时覆盖将自动还原（Inherit）。 |
| **`/sandbox on`** | 当前会话 | **临时开启沙盒**：在当前会话中强行开启沙盒进行安全隔离。 |
| **`/sandbox reset`** | 当前会话 | **重置当前会话**：清空会话级覆盖，重新开始继承 Bot/Agent 或全局配置。 |
| **`/sandbox bot off`** | 当前机器人 | **Bot 实例级永久关闭并免除 Host Bash 审批**：将当前 Bot 实例的沙盒开关永久持久化为 OFF，重启后依旧生效；该 Bot 后续普通 `bash` 会直接以 Host Bash 执行，不再弹 Host Bash 审批。例如可以在 Telegram 里开启沙盒而在飞书里关闭，互不干扰。 |
| **`/sandbox bot on`** | 当前机器人 | **Bot 实例级永久开启**：将当前 Bot 实例的沙盒开关永久持久化为 ON，重启后依旧生效。 |
| **`/sandbox bot reset`** | 当前机器人 | **Bot 实例级重置**：清除当前 Bot 的沙盒覆盖，让其继承 Agent 或全局配置。 |
| **`/sandbox agent off`** | 关联智能体 | **智能体级永久关闭**：将当前 Bot 关联的智能体（Agent Profile）的沙盒属性持久化为 OFF，重启后生效。 |
| **`/sandbox agent on`** | 关联智能体 | **智能体级永久开启**：将当前 Bot 关联的智能体（Agent Profile）的沙盒属性持久化为 ON，重启后生效。 |
| **`/sandbox agent reset`** | 关联智能体 | **智能体级重置**：清除 Agent 的沙盒覆盖，让其继承全局默认配置。 |

---

## 4. 指令生效说明与安全约束

1. **多渠道隔离性**：
   * 在 Telegram 里发送 `/toolprogress off` 或 `/sandbox bot off`，不会波及 Feishu 或 QQ。
   * 配置均持久化保存在后台的 SQLite 关系数据库中，重启进程后依然能够被正确加载保留。
2. **静默错误处理**：
   * 当工具发生异常且 `toolProgress` 设为 `off` 时，系统为了防止泄露底层长堆栈，不会将原始 Error 信息推送到用户窗口。但整轮执行失败时，仍会缓存并发送最后一条友好的错误摘要（例如 `Error: Execution timed out`）。
   * 完整的详细错误信息将被安全地记录在系统后台 RunLog 中，可通过 `/runlog latest` 查询。
3. **Sandbox 与 Host Bash 审批边界**：
   * Sandbox 开启时，普通 `bash` 优先在 OS sandbox 内运行；只有命令显式请求 Host Bash 或 sandbox 权限失败后，才进入 Host Bash 审批流程。
   * Sandbox 关闭时，表示当前作用域已选择 Host full access，普通 `bash` 直接在宿主执行，不再进行 Host Bash 二次审批。
