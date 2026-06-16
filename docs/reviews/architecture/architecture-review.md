# Molibot 架构改造方案技术评审

**评审日期：** 2026-05-28
**评审范围：** v2.0.md (理想化方案) + v2.1.md (务实方案)
**评审方法：** 文档分析 + 实际代码验证

---

## 一、总体评价

### 1.1 两个方案的共识（都正确）

两个方案在以下几个方向上是完全一致的，而且结合代码来看，这些判断是**准确的**：

| 共识 | 代码验证 |
|------|----------|
| 删除 ACP | `src/lib/server/acp/` 有 5+ 文件含 1392 行的 service.ts，引入了独立的权限模型和任务追踪，对 personal agent 定位来说确实是不必要的复杂度 |
| Agent Runtime 职责过重 | `runner.ts` 有 3226 行（114KB），是最大的 God Object——同时处理 turn 生命周期、工具调度、memory、model 解析、context 管理、compaction |
| 工具执行路径碎片化 | host bash / MCP / sandbox / builtin tools 各走各的路径，工具创建需要 15+ 参数 |
| Approval 缺少 scope | 当前只有 pending/approved/rejected（但 host bash 已有 persistent/ephemeral/session 雏形） |
| RuntimeSettings 太大 | 27 个顶层字段，schema.ts 370 行，store.ts 1410 行，sanitizeSettings ~200 行 |
| Skill 保持轻量标准 | 当前 skill 系统已经比较干净（skills.ts 529 行），不需要大改 |
| 统一 Turn 入口 | 各渠道继承 BaseChannelRuntime 但消息流程仍有差异 |

> **核心问题诊断是准确的。** 两个方案对系统痛点的识别基本一致且正确。分歧在于**怎么治**，而不是**哪里有病**。

### 1.2 一句话定性

| 方案 | 定位 | 风格 |
|------|------|------|
| v2.0 | 目标架构蓝图 | "如果从零开始我会怎么设计" |
| v2.1 | 落地改造计划 | "在现有代码上我要怎么一步步改" |

### 1.3 代码现状关键数据

| 模块 | 核心文件 | 行数 | 复杂度 |
|------|----------|------|--------|
| Agent Runtime | `agent/runner.ts` | 3226 | 极高 - God Object |
| ACP | `acp/service.ts` | 1392 | 高 - 独立复杂系统 |
| Telegram Channel | `telegram/runtime.ts` | 2123 | 高 - 最大的渠道 |
| Settings Store | `settings/store.ts` | 1410 | 高 - 含全量 sanitize |
| App Runtime | `app/runtime.ts` | 953 | 中高 - 含 bootstrap + sanitize |
| Subagent | `agent/tools/subagent.ts` | 1149 | 中高 |
| Memory | `memory/` 11 files | ~60KB | 中 - 已模块化 |
| Channel Base | `channels/shared/baseRuntime.ts` | 324 | 中 - 已有抽象基类 |
| Host Bash | `hostBash/` 4 files | ~35KB | 中 - 已有 scope 雏形 |

---

## 二、v2.0 评审

### 2.1 优点

1. **架构视野完整**
   - 完整分层图（Channel → Gateway → TurnOrchestrator → ContextBuilder → PiAgent → ToolRuntime → Policy+Sandbox+Approval）
   - 每个模块的职责边界清晰
   - 接口定义（`AgentPlugin`, `PluginContext`, `ToolDefinition`, `ToolExecutionContext`）设计合理

2. **安全模型设计严谨**
   - `PolicyDecision` 四种类型（allow / allow_with_sandbox / approval_required / deny）覆盖了真实场景
   - Sandbox policy 的 YAML 配置示例很实用（filesystem/network/env 分层控制）
   - Sandbox fallback 规则（禁止 sandbox failed → host 直接执行）是正确的安全底线

3. **Subagent 权限模型正确**
   - `child permission <= parent permission` 是正确的安全原则
   - 固定角色类型（Scout/Planner/Worker/Reviewer）与现有代码一致

4. **Tool 注入策略有价值**
   - workspace enabled + skill required + request relevant + policy allow = 本轮注入
   - 能真正减少上下文污染和误调用

5. **数据存储分层清晰**
   - settings.json 只做 bootstrap，SQLite 存动态配置，文件系统存大对象

### 2.2 问题

1. **模块拆分过细，落地成本过高**
   - 13+ 个新模块，40+ 个新文件
   - 对于一个在运行的个人项目，接近于"重写"
   - 忽略了已有基础设施（BaseChannelRuntime、PersistentTaskQueue、host bash scope 等）

2. **8 个 Phase 路线图过长**
   - Phase 0 到 Phase 8，每个有依赖关系
   - 中间任何一个 phase 受阻都会影响后续

3. **部分模块现在并非痛点**
   - PluginManager 重写：当前 plugin 系统已经可用
   - MemoryRuntime 重构：当前 memory 系统（11 文件，已模块化）工作正常
   - SkillLoader 标准化：当前 skill 加载逻辑已经干净
   - RunlogRuntime：当前能力够用

4. **ChannelGateway 的必要性存疑**
   - 已有 BaseChannelRuntime 作为抽象基类
   - 额外加一层 Gateway 可能增加复杂度而非减少

5. **缺少对现有代码的迁移策略**
   - 大量新接口定义，但没有说明如何从现有 runner.ts 逐步迁移

### 2.3 可取之处（值得保留到最终方案）

```text
✅ PolicyDecision 四种类型
✅ Sandbox policy YAML 结构
✅ Sandbox fallback 安全规则
✅ Tool 注入筛选策略
✅ Subagent 权限继承原则
✅ 数据存储三层分离
✅ PluginContext 受控 API（不给完整 Runtime）
✅ ToolExecutionContext 受控 API
✅ ApprovalRequest 完整结构定义（含 requestedBy.depth）
✅ Approval 聚合策略（debounce + 合并 + critical 单独）
```

---

## 三、v2.1 评审

### 3.1 优点

1. **"保留 80% 架构收益，砍掉 50% 重构复杂度"——定位精准**
   - 核心只新增 4 个关键模块：Workspace, TurnOrchestrator, ToolRuntime, ApprovalScope
   - 其他模块复用现有实现

2. **Phase 精简到 3 个，每个有明确验收标准**
   - Phase 1：删除 ACP + Workspace（1-2 周）
   - Phase 2：TurnOrchestrator + ToolRuntime + Approval scope（2-4 周）
   - Phase 3：Settings 渐进拆分（2-4 周）
   - 总周期 4-8 周，可控

3. **风险控制策略实用**
   - TurnOrchestrator：先接 Web/CLI → 再接 Telegram → 最后 Feishu/Weixin，保留旧路径 fallback
   - ToolRuntime：列出所有 tool 来源 → 逐个迁移 → 禁用直接调用路径
   - Settings：增量迁移、保留 fallback

4. **Settings 渐进拆分策略务实**
   - 分两批迁移，保留 settings.json 可读 + SQLite 优先

5. **"暂不做清单"非常有价值**
   - 明确列出了不做的东西，这种自律比"什么都做"更难但更重要

### 3.2 问题

1. **ToolRuntime 内部设计不够具体**
   - 只列了函数列表，缺少 ToolDefinition、ToolExecutionContext 等关键接口定义
   - ToolRuntime 是最核心模块，设计深度不够

2. **Workspace 模型可能过于简单**
   - 缺少 Workspace 与 Channel 的关联策略（Telegram 对话默认绑定哪个 Workspace？）
   - 缺少 CRUD API 设计

3. **TurnOrchestrator 与现有代码的迁移路径不清晰**
   - 没有说清楚它和现有 runner.ts / BaseChannelRuntime 的关系
   - 是外面包一层？还是拆 runner.ts？

4. **Phase 2 太重**
   - 同时包含 TurnOrchestrator + ToolRuntime + Approval scope + Approval 聚合 + Subagent approval 上提
   - 5 个子任务中每一个都不小

5. **缺少对 Channel 层的约束定义**
   - 说"所有 channel 走 TurnOrchestrator"但没定义 Channel 层应该保留什么、不应该做什么

### 3.3 可取之处（值得保留到最终方案）

```text
✅ "保留 80% 收益，砍掉 50% 复杂度"的原则
✅ 只新增 4 个核心模块的克制
✅ 3 个 Phase 的精简路线图
✅ 风险控制策略（渐进接入 channel、逐个迁移 tool）
✅ Settings 渐进拆分策略
✅ "暂不做清单"
✅ Approval scope 设计（once/turn/session/workspace/persistent）
✅ ApprovalGrant 模型（含 actionFingerprint、expiresAt、revokedAt）
✅ 每个 Phase 的验收标准
✅ 风险 + 控制方式的配对
```

---

## 四、逐模块对比分析

### 4.1 TurnOrchestrator

| 维度 | v2.0 | v2.1 | 代码现状 | 评审意见 |
|------|------|------|----------|----------|
| 职责 | 19 步完整流程 | 10 步精简流程 | 逻辑散在 runner.ts 3226 行 | v2.1 的 10 步更现实 |
| 复杂度 | 含 turnQueue、turnEvents 等独立模块 | 一个文件 | BaseChannelRuntime + PersistentTaskQueue 已存在 | v2.1 起步合理，可复用现有基础设施 |
| 与 runner 关系 | 完全替代 | 未明确说明 | — | ⚠️ 两个方案都没讲清楚迁移路径 |

> **建议：** TurnOrchestrator 不是"新增"，而是从 runner.ts 中**抽取**。第一步是把 runner.ts 的 turn 生命周期逻辑提取到 TurnOrchestrator，runner 降级为 PiAgentRuntime（只负责推理和工具调用）。可以复用 BaseChannelRuntime 和 PersistentTaskQueue 作为基础。

### 4.2 ToolRuntime

| 维度 | v2.0 | v2.1 | 代码现状 | 评审意见 |
|------|------|------|----------|----------|
| 接口设计 | 完整的 ToolDefinition + ToolExecutionContext | 只有函数列表 | createMomTools() 需要 15+ 参数，toolRegistry 存在但未充分使用 | 用 v2.0 的接口设计 + v2.1 的落地策略 |
| Policy | 独立 PolicyEngine 模块 | 内联 decidePolicy() 函数 | 无 | v2.1 内联起步是对的，但需要 v2.0 的 PolicyDecision 类型 |
| 工具来源 | 5 种来源统一注册 | 复用现有注册 | built-in / MCP / host bash / sandbox / plugin 五条路径 | 必须统一 |

> **建议：** 从 v2.0 借用 ToolDefinition、ToolExecutionContext、PolicyDecision 三个类型定义，按 v2.1 的方式落地。

### 4.3 Approval

| 维度 | v2.0 | v2.1 | 代码现状 | 评审意见 |
|------|------|------|----------|----------|
| Scope | 5 级 | 5 级（相同） | host bash 已有 persistent/ephemeral/session 3 级 | 在现有基础上扩展 |
| Grant 模型 | 完整 | 完整（相同） | HostBashStore 已有 SQLite 存储 | 可复用存储模式 |
| Request 模型 | 更详细（含 requestedBy.depth） | 略简化 | 89 行 types.ts | v2.0 的 requestedBy 更好 |
| 独立模块 | ApprovalBroker 独立模块 | 内联到 ToolRuntime | hostBash/ 已是独立模块 | Approval 应独立文件 |

> **建议：** Approval 从一开始就是独立文件，不内联到 toolRuntime.ts。在现有 hostBash 的 scope 概念上扩展。

### 4.4 Workspace

| 维度 | v2.0 | v2.1 | 评审意见 |
|------|------|------|----------|
| 模型 | 丰富 | 最小化 | v2.1 的最小模型起步，v2.0 的丰富字段后期加 |
| Channel 关联 | 未提及 | 未提及 | ⚠️ 两个方案都漏了 Channel ↔ Workspace 映射 |

> **两个方案都漏了：** Channel ↔ Workspace 的映射策略。建议在 Workspace 设计中增加 defaultWorkspaceId（挂在 session 或 channel 配置上）。

### 4.5 其他模块

| 模块 | 采用 | 原因 |
|------|------|------|
| Sandbox | v2.1（保留现有） | 当前不是主要痛点，只收口到 ToolRuntime |
| Memory | v2.1（保留现有） | 已有 11 文件模块化实现，只调整调用位置 |
| Plugin | v2.1（复用现有） | 当前 plugin 系统已可用 |
| Skill | v2.1（保留现有） | 当前 skill 系统已干净 |
| Settings | v2.1（渐进拆分） | 迁移路径更安全 |

---

## 五、两个方案都忽略的问题

### 5.1 错误处理和恢复策略

```text
- TurnOrchestrator 中途 crash，session lock 怎么释放？
- ToolRuntime 执行超时，如何中断和恢复？
- Approval 请求发出后用户长时间不响应，如何处理？
- 多个 channel 同时发消息到同一个 session，如何处理？
```

> 建议在 TurnOrchestrator 设计中加入 lock timeout 和 dead lock detection，在 Approval 中加入 request timeout。

### 5.2 可观测性

统一到 TurnOrchestrator + ToolRuntime 之后，应该能做到：

```text
- 每个 run 的完整生命周期追踪
- 每个 tool call 的耗时统计
- approval 等待时间统计
- 模型调用 token 用量归属到 workspace
```

### 5.3 测试策略

两个方案都没有提到测试。核心架构重构需要：

```text
Phase 1 验证：启动测试 + 基本对话测试
Phase 2 验证：每个 channel 的回归测试
Phase 3 验证：每种 tool 类型的执行测试 + approval 流程测试
Phase 4 验证：配置迁移前后一致性测试
```

### 5.4 现有基础设施利用不足

两个方案都低估了现有代码已有的基础设施：

```text
- BaseChannelRuntime：所有渠道已有统一抽象基类
- PersistentTaskQueue：SQLite 支持的持久化任务队列
- host bash scope：已有 persistent/ephemeral/session 三级
- MessageRouter：遗留代码，可直接删除
- Subagent 固定角色：已有 scout/planner/worker/reviewer/skill-drafter
```

---

## 六、最终评审结论

### 推荐策略：v2.1 的落地框架 + v2.0 的关键设计

| 领域 | 采用方案 | 原因 |
|------|----------|------|
| **总体原则** | v2.1 | "保留 80% 收益，砍掉 50% 复杂度" |
| **路线图** | v2.1 修改版（4 Phase） | v2.1 的 Phase 2 太重，拆成两步 |
| **TurnOrchestrator** | v2.1 | 10 步精简流程起步，复用 BaseChannelRuntime |
| **ToolRuntime** | 混合 | v2.1 的落地策略 + v2.0 的接口设计 |
| **PolicyDecision** | v2.0 | 四种类型定义设计严谨 |
| **Approval scope** | 一致 | 两个方案相同，在 host bash 已有基础上扩展 |
| **ApprovalBroker** | 混合 | v2.1 的"不做完整模块"但独立文件 |
| **Workspace** | v2.1 | 最小模型起步，补充 Channel 映射 |
| **Sandbox/Memory/Plugin/Skill** | v2.1 | 复用现有，不重写 |
| **Settings** | v2.1 | 渐进拆分 |
| **Sandbox 安全规则** | v2.0 | fallback 规则 + YAML 配置结构 |
| **Subagent 权限** | v2.0 | 权限继承原则 |
| **Tool 注入策略** | v2.0 | workspace + skill + request + policy = 本轮注入 |
| **风险控制** | v2.1 | 渐进接入、保留 fallback |

### 一句话总结

> **v2.0 是一份很好的"目标架构参考文档"，v2.1 是一份可以开始执行的"改造计划"。正确的做法是：按 v2.1 的节奏和范围执行，但在核心模块（ToolRuntime、PolicyDecision、Approval、Sandbox 安全规则）的设计细节上参考 v2.0。**
