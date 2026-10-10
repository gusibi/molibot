# MoliBot Personal Agent 体验升级 V1

确认日期：2026-10-09。需求和最终实施范围已确认，测试边界已确认；V1 已于 2026-10-10 实施。验证边界见 [实施记录](../work/progress/personal-agent-desktop-v1/progress.md)。当前能力状态以 [能力矩阵](personal-assistant-capability-matrix.md) 为准。

## 1. 项目背景

### 1.1 当前产品现状

MoliBot 是一个支持多 Agent、多模型、多渠道的个人 AI Agent 系统，提供 Web、macOS App、Telegram、飞书、QQ、微信等交互方式。

目前已经具备：

- 多个独立 Agent，每个 Agent 可以拥有自己的配置、模型、Skills 和运行环境。
- Web Profile／渠道实例与 Agent 的绑定；普通 Session 尚未持久化独立的 Agent 归属。
- Telegram、飞书等渠道上的 Agent 绑定机制。
- Web/macOS App 中的会话管理、项目工作空间、自动任务、Skills、小程序及 Agent Team 等功能。

当前 Web/macOS App 的交互仍以 Session 为中心。

侧边栏按照 Web、Telegram、飞书等 Channel 展开历史 Session。用户主要通过选择历史 Session 继续交流，而 Agent 更像一个需要配置和管理的技术对象。

这导致产品虽然支持多个 Agent，但在实际使用中，用户对 Agent 缺乏清晰的身份感知。

### 1.2 改造目标

将 MoliBot 从以 Session 为中心的工具型 Agent 工作台，升级为以 Agent 为中心的个人 AI 助手产品。

**核心理念：用户拥有的是一组长期存在的私人 Agent，而不是一组不断增加的聊天 Session。**

用户应该能够：

1. 清楚地看到自己创建了哪些 Agent。
2. 直接选择某个 Agent 开始交流。
3. 在同一个 Agent 下维护多个独立 Session。
4. 在不同 Session 之间保持 Agent 的身份、配置与长期记忆。
5. 继续通过 Telegram、飞书等渠道与这些 Agent 交互。
6. 根据需要使用项目、自动任务和高级 Agent 功能。

本次改造主要关注交互组织方式，不追求一次性重构底层架构。

---

## 2. 核心产品模型

### 2.1 Agent 是用户的主要交互对象

每个 Agent 是一个长期存在、可独立识别的助手。

Agent 应具有：

- 名称与头像
- 简介、定位与角色设定
- 模型与 Thinking Level 等配置
- Skills 和工具权限
- 独立的会话集合
- 长期记忆或持久化知识（按现有能力逐步接入）
- 关联的消息 Channel

用户可以创建多个 Agent，例如：

| Agent | 定位 | 主要用途 |
|---|---|---|
| 魔魔 | 默认私人助手 | 日常交流、生活事务、通用任务 |
| 投资研究员 | 专业研究助手 | 股票研究、财报分析、投资跟踪 |
| Coding Agent | 开发助手 | 编程、项目维护、技术研究 |

用户可以直接选择任何 Agent 交流，而不需要所有请求都经过默认 Agent。

### 2.2 Session 是 Agent 下的独立对话

V1 不引入永久主对话。

一个 Agent 可以拥有多个 Session，每个 Session 保存独立的对话历史和执行上下文。

例如：

```text
我的 Agent
├── 魔魔（默认）
│   ├── Session：旅行规划
│   ├── Session：今日安排
│   └── Session：英语学习
│
├── 投资研究员
│   ├── Session：UnitedHealth 分析
│   └── Session：UAMY 投资研究
│
└── Coding Agent
    ├── Session：MoliBot UI 优化
    └── Session：网站架构升级
```

设计原则：

- Agent 长期存在，Session 可以不断创建和结束。
- 一个 Session 有且仅有一个会话所属 Agent。
- 创建 Session 时确定 Agent 归属。
- 打开历史 Session 时，自动恢复对应 Agent。
- 不允许仅通过切换 Composer 中的 Agent 选择器，隐式改变已有 Session 的归属。
- 不同 Session 共享必要的 Agent 身份与长期记忆，但不自动合并完整上下文。

这样既能保持 Agent 的连续性，又能控制 Token 消耗和上下文污染。

### 2.3 Project 是工作上下文

保留现有项目功能，例如 `nss_assistant`、`talkshow` 等。

Project 不作为 Agent 的固定子级。

本轮保留 Project 现有行为，不新增 Project 或 Project Session 的 Agent 绑定、选择与身份恢复。删除 Agent 不影响 Project 会话、项目文件和现有工作流。

### 2.4 Channel 是连接方式

Web、macOS、Telegram、飞书等属于访问 Agent 的不同入口。

不再将 Channel 作为 Personal Agent 主导航的主要分类依据。

同一个 Agent 可以通过多个 Channel 访问，但不同 Channel 的 Session 在 V1 不自动合并。

在 Agent 的历史视图中，可以根据权限和现有数据能力统一展示不同 Channel 的会话，并用小图标标明来源。

---

## 3. 信息架构调整

### 3.1 当前结构

```text
新对话
自动任务
技能
Agent
计划
小程序

对话
  Web
    Session 1
    Session 2
    ...
  Telegram
  飞书
  QQ
  微信

项目
  nss_assistant
  talkshow

Agent Team
```

目前主要以功能和 Channel 分类。

### 3.2 V1 目标结构

```text
新对话
自动任务

我的 Agent
  魔魔（默认）
    最近 Session 1
    最近 Session 2
    更多对话...
  投资研究员
    最近 Session 1
    最近 Session 2
  Coding Agent
    最近 Session 1
  + 创建 Agent

项目
  nss_assistant
  talkshow
  练习

更多功能
  技能
  计划
  小程序
  消息渠道
  Agent Team
```

这是建议的信息层级，不要求设计师严格使用树形导航。

### 3.3 导航设计原则

**Agent 一级，Session 二级，Session 默认折叠。**

主要要求：

1. 我的 Agent 在左侧拥有清晰、固定的导航位置。
2. Agent 名称、头像以及角色应具有明确辨识度。
3. 点击 Agent 主体，进入对应 Agent 的对话首页。
4. 展开 Agent，可以看到最近几个 Session。
5. Session 默认折叠，避免左侧过长。
6. 提供「更多对话」入口，查看完整历史。
7. 保留跨 Agent 的最近对话搜索能力。
8. Project 继续独立展示。
9. Channel 不再占据大面积一级导航空间，移动至连接管理或高级视图。

对于窄侧边栏，可以考虑仅展示 Agent 头像或采用可切换的导航面板。

---

## 4. 核心交互流程

### 4.1 创建新对话

用户点击全局「新对话」时：

- 如果用户当前处于某个 Agent 下，默认使用当前 Agent。
- 如果没有明确的当前 Agent，使用系统默认 Agent（例如魔魔）。
- Composer 明确展示当前 Agent，并允许用户在首次发送前切换。
- 首条消息发送时创建 Session，并持久化 Agent 绑定关系。

**不要在每次点击新对话时强制弹出 Agent 选择窗口。**

保持随时开始聊天的低成本体验。

### 4.2 选择 Agent

点击左侧 Agent 后：

- 展示该 Agent 的头像、名称和角色定位。
- 展示可以立即开始的新对话入口。
- 可以访问其最近 Session。
- 提供 Agent 详情或配置入口。
- 可展示与该 Agent 有关的任务、记忆等入口（视现有能力实现）。

用户不需要先进入 Agent 配置页面，才能和 Agent 交流。

### 4.3 打开历史 Session

用户打开 Session 时：

- 根据持久化绑定关系恢复正确的 Agent。
- 恢复该普通 Session 的模型等适用设置；Project 会话保持现有行为。
- UI 明确显示所属 Agent。
- 如果 Session 归属于其他 Agent，自动切换界面中当前的 Agent 标识。
- 不改变历史 Session 的 Agent 归属。

必须保证 Agent 身份与实际执行 Agent 一致。

### 4.4 查看 Agent 的历史对话

点击 Agent 下的「更多对话」，进入独立的历史视图。

支持：

- 按更新时间排序。
- 搜索对话标题或内容（按现有检索能力）。
- 查看 Session 所属 Channel。
- 区分 Project Session 和普通 Session。
- 继续对话、重命名、删除或归档（按现有功能）。

对于 Telegram、飞书等 Channel，V1 以查看和定位来源为优先目标，不强制实现跨 Channel 直接续聊。

### 4.5 Agent 管理

保留已有 Agent 配置能力，但区分两个操作：

- **与 Agent 交流**：面向普通用户的主入口。
- **管理 Agent**：面向模型、工具、Skills、系统提示词等配置。

不应把「管理 Agent」作为使用 Agent 的前置步骤。

创建 Agent 后，可以立即开始聊天。

---

## 5. Agent 首页设计

建议每个 Agent 拥有自己的轻量首页。

主要展示：

**第一部分：身份**

- Avatar
- Agent 名称
- 简单定位描述
- 是否默认 Agent

**第二部分：开始交流**

- Composer
- 当前 Agent 标识
- 新对话快捷入口
- 可选的常用任务建议

**第三部分：最近历史**

- 最近几个 Session
- 对话标题和更新时间
- Channel 来源标签
- 查看全部历史

不建议 V1 就把 Agent 首页设计成复杂的 Dashboard。

首页应该首先服务于「立即和这个 Agent 交流」，其次才是管理信息。

---

## 6. 长期记忆与 Token 控制

V1 保留多 Session 机制，不新增永久主对话。

Agent 的长期连续性来自身份配置和 Memory，而不是无限增长的对话上下文。

基本原则：

- 每个 Session 独立维护历史。
- 单次模型请求只使用当前 Session 所需上下文。
- 长历史通过现有 Context Compaction 机制压缩。
- 有关用户的长期信息通过 Memory 保存和检索。
- 跨 Session 不直接拼接完整聊天记录。
- 不要求每次对话加载 Agent 的全部记忆。

如果现有 Memory 尚未具备跨 Session 共享能力，需要单独评估实现成本。不能仅凭 UI 改造宣称已经具有长期记忆。

V1 重点是确保 Session 隔离与 Agent 身份的一致性。

---

## 7. 与现有功能的兼容

### Telegram / 飞书 / QQ / 微信

保留现有 Channel 绑定和路由行为。

Web/App 的调整不应影响原有消息收发、Session 映射和 Agent 执行逻辑。

### Project

保留项目模式。

进入 Project 后，继续展示项目上下文和现有工作流。

本轮不增加 Project 内的 Agent 选择或持久归属。项目入口保留现有逻辑。

### 自动任务

保留现有自动任务。

每个自动任务可以关联负责执行的 Agent，但 V1 不要求重新设计调度系统。

### Agent Team

保留现有 Agent Team 能力与入口。

本次不实现新的 `@Agent` 多人会话、Agent 自动编排或多 Agent 并行执行策略。

未来可以在保持会话所属 Agent 归属的情况下扩展协作。

### Web 小程序

已有用于特殊业务场景的 Agent 或 Bot 不应被强制展示为普通私人助手。

需要根据现有配置区分面向用户的 Agent 与内部用途 Agent。

建议优先复用现有 metadata 或配置机制，必要时增加可见性字段。

---

## 8. V1 不包含的功能

为了控制改造规模，本次明确不做：

- 永久主对话。
- 跨 Session 自动合并上下文。
- 跨 Channel 无缝续聊。
- 多 Agent 自动协作编排。
- `@Agent` 参与多人对话。
- 新的任务中心或 Activity Feed。
- 复杂的 Agent 社区与社交系统。
- 全新 Memory 引擎。
- 底层 Session 存储模型的大规模重构。

这些可以作为后续独立需求。

---

## 9. 设计师需要重点解决的问题

本次不要求单纯重新绘制完整 App，而是重点探索：

1. **Agent 如何获得身份感？** 如何通过头像、名称和布局，让用户感觉是在与一个明确的私人助手交流。
2. **Agent 与 Session 的层级如何表现？** 既突出 Agent，又避免历史 Session 难以访问。
3. **Agent 首页应该是什么样？** 保持简洁，同时提供足够的历史和功能入口。
4. **如何降低技术复杂度？** 普通用户不需要直接面对模型、权限、Session、Channel 等大量技术信息。
5. **如何兼容 Project 工作台？** 日常个人助手体验与专业开发工作区应能够自然切换。
6. **Agent 数量增长后如何扩展？** 需要考虑只有一个 Agent、三个 Agent、十几个 Agent 时的导航体验。

设计输出建议包含：

- 整体信息架构
- 左侧导航方案
- Agent 首页
- 新对话与 Agent 切换流程
- Session 历史视图
- Agent 详情与管理入口
- 单 Agent / 多 Agent / 多 Session 状态

---

## 10. 开发需要重点确认的问题

正式开发前，应检查现有代码和数据结构，确认：

1. Session 与 Agent 的关联字段是否稳定且持久化。
2. Web/App 创建 Session 时，Agent 是如何确定和传递的。
3. 切换模型或 Agent 是否会隐式修改已有 Session 的归属。
4. 不同 Channel 的 Session 是否能统一查询，涉及哪些权限与标识。
5. 现有 Agent 是否有面向 UI 的名称、头像、描述及可见性信息。
6. Project 与 Agent、Session 的关联方式。
7. Memory 当前作用域是 Agent、Session 还是全局。
8. 现有 Context Compaction 是否能够满足 V1。
9. Agent 删除、禁用或配置变更后，历史 Session 如何处理。
10. Web 与 macOS App 是否可以共享导航逻辑、状态管理和组件。

复用现有 Agent/Session 系统，在共享层完成身份归属与执行校验，不创建第二套系统，不增加旧行为兼容层。现有渠道的消息收发能力继续保留。

---

## 11. 验收标准

V1 完成后，应该能够验证：

- 用户能直接从左侧选择 Agent 并开始聊天。
- 用户不必每次新建对话都选择 Agent。
- 每个 Agent 可以拥有多个 Session。
- Agent 的 Session 可以方便地查看、搜索和继续。
- 打开历史 Session 后，Agent 归属不会发生错误。
- 不同 Agent 的配置和上下文不会互相污染。
- Desktop App 的普通聊天导航不再主要按 Channel 展示；独立 Web 界面不改。
- 现有 Project、自动任务、Skills 和小程序继续可用。
- Telegram、飞书等渠道的执行行为保持兼容。
- Token 使用不会因为 Agent-first 的导航模式而随历史 Session 数量线性增长。

---

## 12. 核心产品原则

**Agent 是身份，Session 是对话，Project 是工作空间，Channel 是连接方式。**

- Agent 应该长期存在。
- Session 应该独立且可管理。
- Project 应该可复用。
- Channel 不应该决定用户如何认识自己的 Agent。
- 技术配置应尽可能隐藏在需要时才出现的界面中。

本次升级的目标不是让 MoliBot 拥有更多功能，而是让现有能力以更符合 Personal Agent 心智的方式呈现。

最终，用户打开 MoliBot 时，首先想到的应该是：

**「我要找哪个 Agent 帮我？」**

而不是：

「我要打开哪个 Channel 下的 Session？」

## 13. 已确认的身份、记忆与生命周期规则

本节明确前文的行为边界，作为 V1 验收依据。

### 13.1 Session 身份与创建

- Session 创建时持久化会话所属 Agent 的稳定 ID；显示名称可改，稳定 ID 不随名称变化。
- Channel/Bot 后续改绑不改变已有 Session 的 Agent 归属。服务端按持久化归属确定执行 Agent，并拒绝不一致的执行请求，不能静默使用默认 Agent。
- 新对话首次发送前可选择 Agent；首次发送时建立 Session 和绑定。新建 Agent 无需用户先配置消息渠道即可在 Desktop App 开始聊天，复用共享执行入口。
- 已有历史的归属必须基于可靠证据确定；不能将当前 Bot 绑定当作历史归属证明。无法确定的历史保留可查看状态，归属明确前不得执行。历史处理细节在技术方案中列明，不新增 migration 或 fallback 层。
- 必须验证：创建 Agent → 首次发送 → 持久化归属 → 重启 → 打开历史 → 同一 Agent 继续执行。
- 切换 Agent 不串未发送草稿；执行中切换页面不改变原运行、结果和审批所属 Session。

### 13.2 模型与配置

模型选择优先级为：Session 显式覆盖 → Agent 当前配置 → 现有默认继承规则。模型变更不改变会话所属 Agent；配置更新按该优先级影响后续轮次，不改写历史消息。

### 13.3 记忆

- 用户事实与偏好按现有 owner 授权跨 Agent 共享。
- Project 知识按项目作用域和现有权限使用。
- Agent 身份、角色和私有知识按 Agent 的明确作用域隔离；不能仅因 Channel 相同而共享，也不能将 Bot 作用域直接宣称为 Agent 作用域。
- Session 对话历史及执行上下文独立，不跨 Session 拼接完整历史。
- 复用现有 Memory 引擎，实现上述作用域接线、授权与检索；同一 Agent 跨 Session 可访问获授权的长期知识，不要求每次加载全部记忆。

### 13.4 禁用、删除与可见性

- 禁用 Agent 默认折叠，可展开查看历史；不能创建新对话或启动新的执行，包括历史续聊和自动任务的新触发。禁用不等同于停止已开始的运行，既有停止与恢复控制保留。
- 删除 Agent 时归档本次身份模型覆盖的普通 Session，Project Session 不受影响，保留历史和原会话所属 Agent ID，不能改归默认 Agent。已删除 Agent 的历史可查看，但不能继续执行；归档恢复操作不能绕过 Agent 存在性校验。
- 删除前沿用现有引用校验：仍被渠道或任务引用、仍有非终态运行或待处理审批时拒绝删除，并显示需处理的对象。不得静默取消任务或清除审批。
- 删除与归档必须可重试且幂等；不能出现 Agent 已删除但部分 Session 仍可执行的状态。
- 默认 Agent 必须存在且启用；禁用或删除当前默认 Agent 前需先选择有效替代项。
- 内部用途 Agent 默认不出现在“我的 Agent”，仍可管理。可见性与启用状态分别表达，隐藏不表示禁用。

### 13.5 验证与文档边界

- 验证 Bot 改绑、Agent 改名、两个 Agent 的草稿、执行中切换、Project 现有行为不受影响、禁用与删除、服务重启和中断恢复。
- 记忆回归同时覆盖允许共享的 owner 信息和必须隔离的 Agent 私有知识。
- 新增或修改 settings 字段使用临时数据库验证 save → 新建 store → load 的整对象 round-trip。
- UI 遵循 DESIGN.md，验证中英文即时切换、明暗主题、移动宽度；执行相关测试、svelte-check、build 和隔离冷启动走查。
- 单次模型请求不加载其他 Session 的完整历史；会话列表分页或按需加载。
- 与既有会话管理、Project、Agent Room 和 Memory 规范互补，不替代这些能力的独立规范。prd.md 中旧“侧边栏会话行的 Agent 区分方式”候选由本方案替代；其他独立设计仍保留。


## 14. Desktop 范围与导航决策（2026-10-09）

- 仅升级 Desktop App，独立 Web 界面不改；共享服务只做支撑本次行为的必要改动。Project 不增加 Agent 绑定，既有项目聊天与工作流保持不变。
- 启动恢复上次页面；点击 Agent 主体进入该 Agent 的新对话首页；点击具体 Session 才续聊。
- Agent 主体选择与历史展开是独立操作。允许多个 Agent 展开，首次默认折叠，跨重启保存用户的展开选择。
- 禁用期间的定时任务不执行，记录跳过原因；重新启用后按后续计划运行，不补跑禁用期间的任务。
- 同一 owner 的普通助手默认共享用户事实与偏好；Agent 私有知识隔离，内部业务 Agent 保持现有授权边界。
- 视觉方向采用已评审的整合草稿：紧凑统一 Header、Agent 导航、底部 Composer、现有文件 Inspector、带输入框的新对话首页和完整历史视图。具体控件遵循 DESIGN.md，不复制草稿中的占位内容或实现说明。


## 15. 渠道、旧历史和删除后的记忆（2026-10-09）

- 外部渠道纳入固定会话归属。Bot 从 Agent A 改绑到 B 后，旧 Session 仍属于 A；后续新入站消息创建或进入改绑后 B 的新 Session，不继续 A 的旧上下文。Desktop 的外部历史继续只读。共享路由接线属于本轮范围，独立 Web 界面不改。
- 旧普通 Session 按所在 Bot 目录和该 Bot 的有效 Agent 绑定自动关联，已有归属不可改写。缺失有效绑定的历史保留在“未分配历史”，用户显式认领后才允许原本支持续聊的会话继续执行。关联不解除外部会话只读限制，Project 和自动任务不参与。
- 删除 Agent 保留其私有记忆，但停止将这些记忆注入模型或提供给正常运行的 Agent 检索；不能转给默认 Agent。同一名称的新助手不继承已删除助手的稳定身份或私有记忆。共享 owner 记忆、Project 知识不受影响；私有记忆删除必须单独明确操作。

## 16. 最终实施顺序与完成条件

1. 共享层落实普通 Session 的固定 Agent 归属、执行校验、按 Bot 绑定自动关联历史、显式历史认领和外部渠道改绑后的新 Session 路由；Project 保持现有行为。
2. 接通 Agent 创建后直接在 Desktop 聊天、模型继承、记忆作用域、默认/禁用/删除/可见性及定时任务跳过规则。
3. 在 DESIGN.md 先记录 Agent 导航和身份展示规则，再统一实施 Desktop 导航、轻量首页、完整历史及必要管理入口。统一 Header、Composer、Inspector 和现有主题结构继续复用。
4. 使用临时数据库/隔离服务验证身份闭环、作用域隔离、生命周期幂等、配置 round-trip 与受影响渠道路由；完成相关测试、svelte-check、build 和真实隔离冷路径。未执行项及限制明确报告。

核心交付是已评审整合草稿对应的 Desktop 体验和上述真实行为；不新增永久主对话、跨渠道无缝续聊、新 Memory 引擎或 Project Agent 绑定。开始实施前由用户确认该最终范围。


执行故事、实施决定与测试边界见 [Desktop V1 实施规格](personal-agent-desktop-v1-spec.md)。本 PRD 保留产品模型与已确认交互，实施规格不替代既有 Project、Room 或 Memory 独立规范。
