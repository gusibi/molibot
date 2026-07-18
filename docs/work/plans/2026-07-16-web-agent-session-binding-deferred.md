# Web/App 新对话选择 Agent 与 Session 隔离（暂缓）

日期：2026-07-16  
状态：Deferred，暂不实施  
关联文档：[Desktop Chat 侧边栏与多会话并发改造方案](./2026-07-07-desktop-chat-sidebar-multi-session-plan.md)

## 1. 讨论背景

当前 Web/App 新建对话时选择的是 Web Profile，界面将它展示为 Bot。Web Profile 同时承担以下职责：

- Web 渠道实例配置；
- Web Session 的归属维度；
- `bots/<profileId>` 运行目录和文件命名空间；
- 通过 `Web Profile.agentId` 关联 Agent；
- Bot 级 Prompt、模型路由、沙箱覆盖和自动任务目标。

从用户视角看，新建对话时真正想选择的是“由哪个 Agent 完成任务”，而不是选择一个 Web 渠道 Profile。因此讨论过将新对话选择器从 Bot/Profile 改为 Agent，并让 Web/App 只保留一个内部 `default` Profile。

本次只记录候选设计和风险，不修改现有产品行为。

## 2. 讨论过的最简方案

最简方案是：

1. Web/App 隐藏 Web Profile 的新增、删除和编辑入口；
2. 内部始终只使用 `default` Web Profile；
3. 新对话界面选择 Agent；
4. 用户选择后动态修改 `default.agentId`；
5. 其他运行链路保持不变。

这个方案代码改动较小，因为现有 Runner 会通过 `Web Profile.agentId` 解析 Agent，并在绑定变化后刷新系统提示词和模型路由。

## 3. 为什么不能直接采用

`default.agentId` 是 Web Profile 的全局可变配置，不是 Session 状态。动态修改它会破坏 Session 隔离：

```text
Session 1 创建时使用 Agent A
Session 2 创建前把 default.agentId 改为 Agent B
Session 1 下一轮也会改用 Agent B
```

影响不只限于显示名称，还可能包括：

- Agent Profile 和身份提示词；
- Agent 级文本、视觉和语音模型路由；
- Agent 级沙箱策略；
- Profile 文件工具解析出的 Agent 作用域；
- 恢复运行、审批和后续轮次所使用的 Agent 上下文。

并发运行时风险更明显：一个 Session 正在执行工具或后台任务时切换全局 Agent，可能让同一轮运行读取到前后不一致的配置。

因此，“新对话选择 Agent”不能通过动态修改唯一 Web Profile 的 `agentId` 实现。

## 4. 如果以后重启该需求，推荐模型

可以继续保留唯一的内部 Web Profile，但 Agent 绑定必须下沉到 Session：

```text
Web Profile: default
├── Session 1 → Agent A（创建后固定）
├── Session 2 → Agent B（创建后固定）
└── Session 3 → Agent A（创建后固定）
```

职责应拆分为：

- `default` Web Profile：只负责 Web 渠道、运行入口和共享工作区命名空间；
- `Conversation.agentId`：记录该 Session 使用的 Agent；
- `default.agentId`：仅作为新 Session 的默认值，以及没有 `agentId` 的旧 Session 的兼容回退；
- 外部渠道 Bot：继续通过渠道实例的 `botId → agentId` 绑定 Agent，不受本设计影响。

核心不变量：

> 一个 Session 创建后，其 `profileId` 和 `agentId` 不可改变。发送后续消息、恢复、停止、审批和运行状态查询必须继续使用同一绑定。

Agent 自身配置仍可以被编辑。Session 固定的是 Agent 身份引用，而不是复制一份永久不变的 Agent 配置快照。是否需要版本化 Agent 配置，是另一个独立需求。

## 5. 预计改动范围

若采用推荐模型，改动属于中等规模，主要包括：

1. 在 Conversation/UI Session 元数据中增加可选 `agentId`；
2. 新建 Session 时提交、校验并持久化 Agent；
3. 后续消息从服务端 Session 读取 Agent，不能信任客户端逐轮传入的 Agent；
4. Runner、Prompt、模型路由和沙箱优先使用 Session 级 Agent；
5. Profile 文件工具使用当前 Session 的 Agent 作用域；
6. Web/App 新对话选择器读取已启用的 Agents，同时固定使用 `profileId: "default"`；
7. 旧 Session 没有 `agentId` 时回退到原 Web Profile 的绑定，避免强制迁移历史数据；
8. 增加跨 Session 并发、恢复、审批和配置切换测试。

不应为了这个需求重写外部 Channel 的 Bot 路由，也不应把跨渠道 Session/Agent 选择逻辑放进 Web Channel 层。

## 6. 重新启动前需要确认的产品决策

未来决定实施前，需要先确认：

- 新建普通 Web Session 是否必须显式选 Agent，还是默认上次使用的 Agent；
- Project Session 是继承项目默认 Agent，还是每个 Session 独立选择；
- Web 自动任务继续绑定 `default` Profile，还是增加显式 `agentId`；
- 历史会话列表是否显示创建时绑定的 Agent；
- Agent 被禁用或删除后，已有 Session 是只读、阻止继续运行，还是允许选择替代 Agent；
- 修改同一个 Agent 的 Prompt、模型或沙箱后，历史 Session 是否立即使用新配置。

在这些决策完成前，维持当前“Web Profile 作为 Bot、Profile 静态关联 Agent”的实现，不做局部 UI 改名或全局动态切换，以免制造错误的 Session 隔离预期。
