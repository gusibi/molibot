# Molibot「记忆中心与本轮记忆」功能 PRD

> 文档版本：V1.0  
> 日期：2026-07-15  
> 状态：Planned / 待开发  
> 优先级：P0  
> 目标端：macOS Desktop 首发；数据与运行时能力保持跨渠道共享  
> 关联文档：`docs/requirements/memory-improvement-plan.md`、`DESIGN.md`

---

## 1. 一句话定义

让用户能够在记忆中心管理 Molibot 已保存的长期记忆，并在每条 Assistant 回答下准确查看：本轮回答参考了哪些记忆，以及本轮新增或更新了哪些记忆。

---

## 2. 背景与问题

Molibot 已具备以下记忆能力：

- mory 正式记忆后端；
- owner/chat/project/agent/content namespace 与 domain；
- long_term/daily 分层；
- 混合检索、版本链、冲突、过期、固定、来源与候选确认；
- 每轮回答前生成 `MemoryPromptSnapshot`，随后 `promptInput.ts` 当前还会把快照文本二次压缩为最多 5 条、每条最多 220 字，再放入 `<current-memory>`；
- Agent 可通过 Memory 工具新增、更新、删除记忆；
- 每日反思与 importer 可产生待用户确认的候选记忆。

但现有产品体验存在两个断层。

### 2.1 记忆中心断层

当前 Desktop「内存」页面同时展示后端能力、Channel/User ID、同步、Flush、Compact、迁移、向量回填、候选、正式记忆与拒绝日志。它具备管理能力，但更接近开发者控制台，用户很难快速回答：

1. Molibot 现在记住了我什么？
2. 哪些记忆已经生效，哪些仍待确认？
3. 一条记忆适用于我、当前对话还是当前项目？
4. 错误或过期的记忆如何纠正？

### 2.2 Chat 可见性断层

当前 Chat 无法展示：

1. 本轮是否向模型提供了长期记忆；
2. 具体提供了哪些记忆；
3. 本轮是否新增或更新了记忆；
4. 写入的是正式记忆还是待确认候选；
5. 历史回答生成时看到的是哪一个记忆版本。

这导致用户无法确认记忆系统是否真正参与回答，也无法及时纠正错误记忆。

---

## 3. 可行性结论

### 3.1 总体结论

可行，复杂度为中等。

该功能不需要重构 mory 检索，但必须先修正 Prompt Builder 的注入事实边界。现有 `MemoryPromptSnapshot.selected` 是进入最终压缩步骤的候选，不是最终注入结果：Runner 当前请求最多 12 条，`compactPromptMemory` 随后只保留最多 5 条，并可能把每条内容截断到 220 字。

因此 V1 必须新增结构化 `MemoryInjectionSnapshot`：最终压缩逻辑一次性产出实际 Prompt 文本和实际注入项。Chat 数量、顺序和历史快照只能来自 `MemoryInjectionSnapshot.items`，不能直接使用 `selected.length`，也不能再从压缩后的字符串反向解析。

主要开发量集中在：

1. 保存所选记忆的历史快照，而不是只保存数量；
2. 捕获本轮 Memory 工具产生的结构化写入结果；
3. 用 `runId` 把读取、写入和最终 Assistant 消息关联起来；
4. 扩展 Desktop 消息摘要契约并提供懒加载详情 API；
5. 重组记忆页的信息架构；
6. 在 Chat 消息底部增加入口与本轮记忆抽屉。

### 3.2 现有能力复用

| 需求 | 现有能力 | V1 处理 |
|---|---|---|
| 本轮检索选择候选 | `MemoryPromptSnapshot.selected` | 作为最终结构化压缩的输入 |
| 本轮最终注入项 | 需要新增 `MemoryInjectionSnapshot.items` | 作为回答参考唯一事实源 |
| 实际注入顺序 | `MemoryInjectionSnapshot.items` 数组顺序 | 原样保存 `injectionOrder` |
| 记忆内容、类型、作用域 | `MemoryRecord` | 直接使用现有字段 |
| 记忆来源 | `sources[]` | 复用来源跳转 |
| 版本历史 | mory versions | 复用现有查询 |
| 编辑、删除、固定 | Desktop Memory API | 复用并补停用注入能力 |
| 本轮新增/更新 | Memory 工具 `details.item` | 增加专用写入回执收集 |
| 运行关联 | 现有 `runId`、sessionId | `runId` 作为运行期主键 |
| 历史消息稳定 ID | UI message metadata + source entry projection | Trace 提交后绑定 Assistant 消息 |

### 3.3 当前不具备、需要新增的能力

- 回答级 Memory Trace 持久化；
- 记忆内容快照；
- Memory 工具结构化写入回执；
- Assistant 消息的轻量记忆元数据；
- 记忆反馈存储；
- `allowInjection` 停用注入字段及共享选择过滤；
- Chat 本轮记忆抽屉；
- 面向用户的记忆中心信息架构。

---

## 4. 产品目标

### 4.1 核心目标

用户查看任意一条已完成的 Assistant 回答时，可以准确知道：

- Molibot 在生成该回答时参考了哪些长期记忆；
- Molibot 在该轮运行中新增、更新或删除了哪些记忆；
- 哪些内容只是候选，尚未成为正式记忆；
- 如何纠正、停用或反馈不合适的记忆。

### 4.2 用户价值

- 确认 Molibot 是否真的记住了自己；
- 理解回答为何更贴合个人或项目背景；
- 发现错误、过期、冲突或越界的记忆；
- 确认「请记住」是否真正保存成功；
- 在不理解 namespace、embedding 等技术概念的前提下管理记忆。

### 4.3 产品价值

- 提升记忆系统的透明度、信任与可控性；
- 收集真实的检索质量反馈；
- 建立回答、记忆读取和记忆写入之间的可审计链路；
- 为后续排序优化、记忆质量评分和影响范围分析提供数据。

---

## 5. 非目标

V1 不实现：

1. 严格证明模型在推理中实际依赖了某条记忆；
2. 回答句子与记忆逐句引用；
3. 展示模型私有推理、完整 Prompt 或隐藏指令；
4. AI 生成「为什么使用这条记忆」；
5. retrieved/selected/injected 完整检索漏斗；
6. 检索分数、Embedding、向量与 Token 预算调试 UI；
7. 根据反馈自动修改检索权重；
8. 回答时版本与当前版本的可视化 Diff；
9. 分享对话时附带 Memory Trace；
10. Web/iOS 的完整交互实现。

V1 只承诺两类可验证事实：

- 哪些记忆实际进入了本轮 `<current-memory>`；
- 哪些记忆写入操作在本轮真实提交成功。

---

## 6. 核心概念与文案边界

### 6.1 回答参考

指结构化压缩后 `MemoryInjectionSnapshot.items` 中实际被放入本轮 `<current-memory>` 的记忆。

界面文案使用：

> 参考了 N 条记忆

不得使用：

> 使用了 N 条记忆

原因：系统只能确认记忆被提供给模型，不能证明模型最终依赖了它。

### 6.2 本轮写入

指与当前 `runId` 关联、已经由 Memory Gateway 成功提交的 add/update/delete 操作。

界面按结果区分：

- `已记住 N 条`：新增正式记忆；
- `更新了 N 条记忆`：更新现有正式记忆；
- `有 N 条记忆待确认`：只产生候选，尚未进入正式记忆；
- 删除操作仅在详情中显示，不用正向「记住」文案。

### 6.3 候选记忆

每日反思或 importer 产生、尚未确认的 `MemoryCandidate`。

候选记忆：

- 不参与检索；
- 不进入 Prompt；
- 不得显示为「已记住」；
- 只能通过 `gateway.confirmCandidate` 进入正式记忆。

### 6.4 本轮记忆

Chat 侧统一入口概念，包含两个彼此独立的区块：

1. 回答参考；
2. 本轮新增与变更。

---

## 7. 用户场景

### 场景一：确认回答参考了项目背景

用户询问：

> Molibot 的设置页应该怎么改？

消息底部展示：

> 参考了 4 条记忆

用户打开后看到：

- 当前项目使用 Svelte；
- 用户偏好 macOS 原生体验；
- 不希望界面像网页后台；
- 设置页保存按钮应固定在底部。

### 场景二：确认「请记住」已经生效

用户说：

> 请记住，Molibot 的前端现在统一使用 Svelte。

回答完成后展示：

> 已记住 1 条

用户打开后可查看正式保存内容、作用范围和来源消息。

### 场景三：本轮既参考旧记忆，又写入新记忆

消息底部展示两个独立入口：

> 参考了 3 条记忆　·　已记住 1 条

用户不会把「回答前读取」和「回答后写入」混为一谈。

### 场景四：发现错误参考

用户发现回答参考了「前端使用 React」，但当前已经改为 Svelte。

用户选择：

> 内容错误

系统记录本轮负反馈，并引导编辑原始记忆。历史回答继续展示回答时的 React 快照。

### 场景五：候选尚未生效

每日反思产生两条候选。

记忆中心显示：

> 待确认 2

Chat 不显示「已记住 2 条」。只有候选在当前交互 Run 内产生时，消息下方才显示「有 2 条记忆待确认」。

---

## 8. 功能范围

### 8.1 P0：V1 必须完成

#### 记忆中心

- 导航中文名称从「内存」改为「记忆」；
- 页面分为「已保存」「待确认」「高级管理」；
- 已保存记忆支持搜索、筛选、查看详情、编辑、固定、停用注入和删除；
- 待确认记忆支持编辑后确认、忽略；
- 详情复用来源消息、版本历史、冲突、过期与 reason；
- 技术操作移入高级管理，不占据默认首屏。

#### Chat

- Assistant 消息底部展示回答参考数量；
- Assistant 消息底部展示本轮正式写入或候选数量；
- 点击后打开「本轮记忆」右侧抽屉；
- 回答参考与本轮新增分区展示；
- 历史回答展示当时快照；
- 支持参考记忆反馈；
- 支持从抽屉编辑、停用原始记忆；
- 原始记忆删除后仍可查看历史快照；
- Trace 记录失败不阻塞回答。

#### 后端

- 持久化回答参考快照；
- 持久化 Memory 写入回执；
- 使用 `runId` 关联本轮数据；
- 绑定最终 Assistant 消息；
- 消息列表返回轻量统计；
- Trace 详情按需加载；
- 反馈保存为结构化数据，不写回模型上下文。

### 8.2 P1：后续增强

- retrieved/selected/injected 漏斗；
- 规则化检索原因与 matched terms；
- 回答时版本和当前版本对比；
- 最近被哪些回答参考；
- 记忆最近使用时间与使用次数；
- 开发调试模式；
- Web 端完整交互。

### 8.3 P2：长期能力

- 逐句引用；
- 模型结构化声明 cited memory；
- 根据反馈优化检索排序；
- 记忆质量评分和自动合并；
- 记忆影响范围分析；
- 分享时可选附带记忆记录；
- iOS 端完整交互。

---

## 9. 记忆中心产品设计

### 9.1 页面定位

记忆中心是面向用户的记忆管理产品，不是运行时诊断页。

默认首屏优先回答：

> Molibot 现在记住了什么？

### 9.2 顶部结构

页面标题：

> 记忆

页面说明：

> 查看和管理 Molibot 保存的长期信息。你可以纠正、停用或删除不准确的记忆。

主 Tab 是三个相互独立的页面，不得把前两者融合成同一页面：

1. 概览：综合画像、当前主线、近期新增、稳定偏好与待确认候选；
2. 主题：主题导航、Agent 摘要、关键事实和相关实体；
3. 全部记忆：搜索与底层记录管理。

高级管理不是第四个 Tab，而是顶部次级按钮打开的弹窗。桌面宽窗口使用顶部 Tab；窄窗口保持三入口语义，并将主题侧栏收拢为顶部分组网格。

### 9.3 概览、主题与全部记忆

概览优先回答“Molibot 目前怎样理解我”，所有摘要、主线、偏好和候选必须来自现有正式记忆或候选记录，不得用展示层虚构事实或置信度。

主题 V1 固定为：产品与项目、技术与开发、设计偏好、健康与训练、内容创作、日常习惯。每个主题展示真实记录数量、最近更新时间、Agent 摘要、关键事实及由真实标签聚合的相关实体；点击关键事实可进入原记忆详情。

全部记忆默认按最近更新展示，并继续保留底层管理能力。

默认排序：

1. pinned；
2. 存在冲突；
3. 最近更新；
4. 置信度。

支持筛选：

- 作用范围：关于你、当前对话、项目、Agent 自身、内容；
- 类型：偏好、事实、技能、事件、任务、知识；
- 状态：生效中、已停用、存在冲突、已过期、已固定；
- 层级：长期、近期。

每条列表项展示：

- `content`；
- 面向用户的类型；
- 面向用户的作用范围；
- 状态徽章；
- 最近更新时间；
- 置信度仅在低于阈值或用户展开详情时显示。

内部字段映射：

| 内部值 | 中文展示 | English |
|---|---|---|
| `domain: owner` | 关于你 | About you |
| `domain: project` | 项目 | Project |
| `domain: agent_self` | Agent 自身 | Agent self |
| `domain: content` | 内容记录 | Content |
| `layer: long_term` | 长期 | Long-term |
| `layer: daily` | 近期 | Recent |
| `hasConflict` | 存在冲突 | Conflict |
| `pinned` | 已固定 | Pinned |
| `allowInjection: false` | 已停用 | Disabled |
| `expiresAt < now` | 已过期 | Expired |

不得把原始 namespace、Channel ID 或外部用户 ID 作为卡片主标题。它们只在高级详情中展示。

### 9.4 记忆详情 Sheet

从右侧打开详情 Sheet；窄窗口使用全屏 Sheet。

内容包括：

1. 完整记忆内容；
2. 类型、作用范围、层级和状态；
3. 保存理由；
4. 来源消息；
5. 创建、更新、最近确认时间；
6. 版本历史；
7. 是否允许自动用于回答；
8. 编辑、固定、停用、删除。

有保存操作的编辑状态必须使用固定 `.settings-footbar`。删除需应用内二次确认，不使用 `window.confirm`。

### 9.5 待确认

待确认位于“概览”Tab，而不是独立 Tab。

每条候选展示：

- 候选内容；
- 为什么值得记；
- 推荐作用范围；
- 类型与置信度；
- 来源消息；
- 确认、编辑后确认、忽略。

确认必须继续走 `gateway.confirmCandidate`，UI/API 不得直接写入 mory。

### 9.6 高级管理

包含：

- 后端状态与能力；
- 全 scope 搜索；
- namespace/domain 原始信息；
- 同步、Flush、Compact；
- 向量回填；
- 旧记忆迁移；
- 治理拒绝记录。

高级管理由顶部次级按钮打开语义弹窗。危险或低频操作继续位于弹窗内部，避免与日常记忆管理竞争视觉层级。

---

## 10. Chat 产品设计

### 10.1 Assistant 消息底部入口

显示位置：现有复制、模型和时间所在的消息元信息区。

展示规则：

| 状态 | 展示 |
|---|---|
| referenced > 0 | 参考了 N 条记忆 |
| created > 0 | 已记住 N 条 |
| updated > 0 | 更新了 N 条记忆 |
| pending > 0 | 有 N 条记忆待确认 |
| 全部为 0 | 默认不展示 |
| Trace 加载/保存失败 | 不展示，不影响回答 |

回答参考与写入使用两个独立、相邻的文本按钮，不合并为一个含糊的总数。

流式回答期间不展示。Assistant 消息与 Trace 均进入可读取状态后再展示。

### 10.2 本轮记忆抽屉

标题：

> 本轮记忆

抽屉宽度：

- 标准桌面窗口：400px；
- 最大不超过窗口宽度 80%；
- 窄窗口：全屏 Sheet。

内容分为：

1. 回答参考（N）；
2. 本轮新增与变更（N）。

无数据的区块不展示；两个区块都无数据时不应存在入口。

### 10.3 回答参考列表

说明：

> 这些记忆被提供给 Molibot，可能影响了本次回答。

排序严格使用 `injectionOrder`，不得在 UI 中重新按置信度排序。

每项展示：

- 快照中的 `content`；
- 类型；
- 作用范围；
- 回答时状态；
- 回答时更新时间；
- 展开详情。

展开后提供：

- 有帮助；
- 不应在本次使用；
- 编辑当前记忆；
- 停用当前记忆；
- 查看来源。

### 10.4 本轮新增与变更列表

说明：

> Molibot 在处理这条消息时保存或更新了以下记忆。

新增项展示：

- 已保存的最终内容；
- 作用范围；
- 类型；
- 保存来源；
- 编辑记忆。

更新项展示：

- 更新后的内容；
- 有 `before` 时展示简短的旧值 → 新值；
- 版本历史入口。

候选项展示：

- 待确认状态；
- 确认、编辑后确认、忽略。

删除项展示：

- 已删除的快照；
- 不提供再次删除操作；
- V1 不提供恢复。

### 10.5 原始记忆变化

V1 默认始终展示回答时快照。

- 原始记忆已删除：标记「原始记忆已删除」，隐藏编辑和停用；
- 原始记忆已修改：标记「该记忆之后已修改」，仍展示旧快照；
- 当前版本查询失败：只展示快照，不阻塞抽屉。

V1 不实现回答时版本/当前版本 Diff。

---

## 11. 用户反馈

### 11.1 有帮助

写入：

```ts
value = "helpful"
```

V1 仅记录，不立即改变检索排序。

### 11.2 不应在本次使用

点击后显示轻量菜单：

- 与当前问题无关；
- 内容错误；
- 已经过时；
- 过于私人；
- 其他。

对应行为：

| 原因 | V1 行为 |
|---|---|
| irrelevant | 只记录本轮负反馈 |
| incorrect | 记录反馈并引导编辑 |
| expired | 记录反馈并建议设置过期/停用 |
| too_private | 记录反馈并建议关闭自动注入 |
| other | 可选短评论 |

反馈不得修改历史回答、历史快照或普通 Session 对话内容。

---

## 12. 数据契约

### 12.1 MessageMemoryMeta

消息列表只返回轻量统计：

```ts
interface MessageMemoryMeta {
  traceAvailable: boolean;
  referencedCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  pendingCount: number;
}
```

`DesktopConversationMessage` 增加：

```ts
memory?: MessageMemoryMeta;
```

不在消息列表响应中返回完整快照。

### 12.2 TurnMemoryTrace

```ts
interface TurnMemoryTrace {
  id: string;
  runId: string;
  sessionId: string;
  assistantMessageId?: string;
  sourceEntryId?: string;
  query: string;
  status: "pending" | "committed" | "failed";
  referenced: ReferencedMemorySnapshot[];
  writes: MemoryWriteReceipt[];
  createdAt: string;
  committedAt?: string;
}
```

说明：

- `runId` 是运行期权威关联键；
- `assistantMessageId` 是 Desktop/API 展示关联键；
- `sourceEntryId` 用于现有 Agent entries 与 UI metadata 投影；
- Trace 不进入模型上下文；
- `failed` Trace 默认不向普通 UI 暴露，但保留结构化诊断。

### 12.3 ReferencedMemorySnapshot

```ts
interface ReferencedMemorySnapshot {
  memoryId: string;
  injectionOrder: number;
  snapshot: {
    injectedText: string;
    content: string;
    namespace?: string;
    domain?: MemoryDomain;
    type?: MemorySemanticType;
    layer: MemoryLayer;
    confidence?: number;
    reason?: string;
    sources?: MemorySourceRef[];
    pinned?: boolean;
    hasConflict?: boolean;
    expiresAt?: string;
    allowInjection: boolean;
    memoryUpdatedAt: string;
  };
  feedback?: MemoryTraceFeedback;
}
```

`injectedText` 必须等于实际出现在 `<current-memory>` 中的最终文本；`content` 保存当时 Memory 的完整正文，供详情查看。UI 默认先展示 `injectedText`，展开后才显示完整正文，避免把没有完整注入模型的内容误称为本轮参考文本。

V1 不新增可独立编辑、可能互相漂移的 `displayText/promptText/content` 三套业务字段。`injectedText` 是每轮由统一压缩函数生成的只读快照，不是用户可编辑的第二份 Memory 内容。

### 12.4 MemoryInjectionSnapshot

```ts
interface MemoryInjectionSnapshot {
  promptText: string;
  items: Array<{
    memory: MemoryRecord;
    injectedText: string;
    injectionOrder: number;
  }>;
}
```

实现约束：

1. 使用结构化 `MemoryRecord[]` 执行数量与长度预算；
2. 同一次函数调用同时生成 `promptText` 和 `items`；
3. `promptText` 必须只由 `items[].injectedText` 生成；
4. 不允许先生成字符串、再用正则反解析 memoryId；
5. 原 `compactPromptMemory(string)` 应被替换或降级为兼容包装，不能继续作为新的双重裁剪点。

### 12.5 MemoryWriteReceipt

```ts
interface MemoryWriteReceipt {
  id: string;
  toolCallId?: string;
  memoryId?: string;
  operation: "add" | "update" | "delete" | "candidate";
  source: "agent_tool" | "explicit_message" | "reflection" | "importer";
  committed: boolean;
  before?: MemorySnapshot;
  after?: MemorySnapshot;
  createdAt: string;
}
```

写入回执必须来自 Memory Gateway 的真实返回值，不得从 Activity 文案、模型回答正文或 Trace preview 反向解析。

### 12.6 MemoryTraceFeedback

```ts
interface MemoryTraceFeedback {
  value: "helpful" | "irrelevant" | "incorrect" | "expired" | "too_private" | "other";
  comment?: string;
  createdAt: string;
  updatedAt: string;
}
```

同一用户对同一 TraceItem 只保留一份当前反馈，重复提交为幂等更新。

### 12.7 MemoryRecord 扩展

```ts
interface MemoryRecord {
  // existing fields...
  allowInjection?: boolean; // 缺省视为 true，兼容存量
}
```

`createPromptSnapshot` 必须在共享选择层过滤 `allowInjection === false` 的记录。不得只在 Desktop UI 隐藏。

---

## 13. 持久化设计

### 13.1 存储位置

Memory Trace 属于跨渠道运行时可观测与用户审计数据，必须位于共享 Agent/app 上层，不放入任何 Channel 目录。

建议使用独立 SQLite 表，并复用项目现有可注入存储模式：

```sql
CREATE TABLE memory_traces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  assistant_message_id TEXT,
  source_entry_id TEXT,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  referenced_json TEXT NOT NULL,
  writes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE INDEX idx_memory_traces_assistant_message
  ON memory_traces(assistant_message_id);

CREATE INDEX idx_memory_traces_session
  ON memory_traces(session_id, created_at);
```

反馈可使用独立关系表，避免重写整份 Trace JSON：

```sql
CREATE TABLE memory_trace_feedback (
  trace_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  value TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trace_id, memory_id)
);
```

### 13.2 快照要求

回答参考必须保存以下回答时字段：

- content；
- injectedText；
- namespace/domain/type/layer；
- confidence；
- reason/sources；
- pinned/conflict/expiresAt/allowInjection；
- memoryUpdatedAt；
- injectionOrder。

历史查询优先使用快照，绝不能通过 memoryId 动态替换为当前内容。

### 13.3 保留策略

- Trace 生命周期默认与 Assistant 消息一致；
- 删除整个 Session 时同步删除其 Trace 和反馈；
- 删除单条 Assistant 消息时同步删除其 Trace；
- 删除原始 Memory 不删除历史 Trace；
- V1 不单独提供 Trace 清理按钮。

---

## 14. 后端生命周期

### 14.1 正常流程

```text
turn prepared (runId created)
  → memory snapshot created
  → final MemoryInjectionSnapshot materialized
  → TurnMemoryTrace pending created
  → referenced snapshots recorded
  → model/tool loop starts
  → memory mutations append write receipts
  → assistant message persisted
  → trace binds sourceEntryId / assistantMessageId
  → trace committed
  → message projection exposes lightweight counts
  → turn finished
```

### 14.2 记录边界

推荐新增共享 `TurnMemoryTraceRecorder`，职责只有：

- `begin(runId, sessionId, query)`；
- `recordReferenced(runId, snapshot)`；
- `recordWrite(runId, receipt)`；
- `bindMessage(runId, messageIdentity)`；
- `commit(runId)`；
- `fail(runId, code)`。

Memory Retriever 不负责 Trace 持久化；Prompt Builder 不负责 UI；Channel 不负责关联与去重。

### 14.3 Assistant 消息绑定

现有 Agent entries 和 Desktop UI metadata 是两层存储，不能用「本轮最后一条 Assistant」的数组位置做关联。

V1 采用现有 `sourceEntryId` 深投影边界：

1. `MomRuntimeStore.appendContextMessage` 返回本次新建的 Agent entry id；
2. Runner 在 tool loop 中记录本轮最后一条带用户可见文本的 Assistant entry id；
3. `RunResult` 增加 `assistantSourceEntryId?: string`；
4. Web/Desktop 在创建 `contextBacked` Assistant UI metadata 时直接保存该 `sourceEntryId`；
5. `SessionStore.appendMessage` 的 options 增加可选 `sourceEntryId`，不得等到下次读取时再靠顺序猜测；
6. `TurnMemoryTrace` 以该 `sourceEntryId` 完成 committed；
7. UI metadata UUID 创建后再补 `assistantMessageId`，失败时仍可通过 `sourceEntryId` 查询；
8. 会话投影按一批 `sourceEntryId` 查询 `MessageMemoryMeta`，不得逐条 N+1 查询。

如果一次 Run 含多个内部 Assistant/toolResult entry，Trace 只绑定该轮最终投影出来的文本 Assistant entry。中间工具循环消息不得各自显示同一份 Memory Trace。

### 14.4 Memory 工具写入捕获

现有通用 Hook `tool.call.after` 只包含裁剪后的 `resultPreview`，不适合保存私密、结构化的记忆内容。

V1 应在共享 Runner 的 `afterToolCall` 路径中：

1. 识别 `toolName === "memory"`；
2. 读取本次工具参数中的 action；
3. 从原始结构化 result 的 `details.item/result` 构造回执；
4. 写入专用 `TurnMemoryTraceRecorder`；
5. 不把完整记忆内容复制进通用 Trace Hook payload。

这样可以保持：

- 通用 Trace 与用户记忆隐私分离；
- 写入事实不依赖展示文案；
- Chat 可获得精确 add/update/delete 结果。

### 14.5 重试与失败

Memory 写入可能在回答结束前已经提交，因此不能假设回答失败等于没有写入。

规则：

1. 模型重试不得重复记录同一个 `toolCallId + operation + memoryId`；
2. Trace recorder 写入回执必须幂等；
3. 如果回答失败但 Memory 写入已经成功，回执仍保留；
4. 有可展示的 Assistant 错误消息时，可绑定并显示「已记住 N 条」；
5. 没有 Assistant 消息时，Trace 保留为 failed 诊断数据，不出现在普通 Chat；
6. Trace 存储失败不得回滚已成功的回答或 Memory 写入；
7. Memory 写入失败不得显示「已记住」。

### 14.6 外部渠道

数据采集在共享 Runner 层完成，因此 Telegram、飞书、QQ、微信与 Web 运行都可以生成 Trace。

V1 只在 macOS Desktop 展示。Channel 不新增 Memory Trace 文案、按钮或消息，不改变现有回复格式。

---

## 15. API 设计

### 15.1 消息列表

现有 Desktop Session 详情响应为每条 Assistant 消息增加可选 `memory` 摘要，不增加额外批量请求。

```json
{
  "id": "msg_456",
  "role": "assistant",
  "content": "...",
  "memory": {
    "traceAvailable": true,
    "referencedCount": 4,
    "createdCount": 1,
    "updatedCount": 0,
    "deletedCount": 0,
    "pendingCount": 0
  }
}
```

### 15.2 获取完整 Trace

```http
GET /api/desktop/messages/:messageId/memory-trace
```

响应只返回当前本地用户有权查看的 Trace。默认返回快照，不批量查询所有原始 Memory 当前版本。

### 15.3 提交反馈

```http
PUT /api/desktop/messages/:messageId/memory-trace/:memoryId/feedback
```

```json
{
  "value": "irrelevant",
  "comment": "与当前问题无关"
}
```

使用 PUT 是为了表达同一 TraceItem 反馈的幂等覆盖。

### 15.4 记忆操作

V1 复用并细化现有 Desktop Memory API 能力：

- 查询当前 Memory；
- 更新 Memory；
- 设置 `allowInjection`；
- 固定/取消固定；
- 删除；
- 确认/忽略候选；
- 查询来源与版本。

设置保存必须继续走单条 Memory 的细粒度 API，不提交整个 settings 或整个记忆列表。

---

## 16. 前端组件边界

建议组件：

```text
ConversationTranscript
  └─ MessageMemoryMeta
       ├─ ReferencedMemoryTrigger
       └─ MemoryWriteTrigger

TurnMemoryDrawer
  ├─ ReferencedMemorySection
  │    └─ MemorySnapshotItem
  └─ MemoryWriteSection
       └─ MemoryWriteItem

MemorySection
  ├─ SavedMemoriesTab
  ├─ MemoryCandidatesTab
  ├─ MemoryAdvancedTab
  └─ MemoryDetailSheet
```

状态必须使用 Svelte 可追踪的 `$state`、`$derived` 或 store；不得让模板直接调用隐藏响应式依赖的无参数 helper。

优先复用现有 shadcn-svelte/共享 UI 组件和语义 CSS，不新增页面内零散 `<style>`、裸 Tailwind 或自造 Switch。

---

## 17. 加载、空状态与错误状态

### 17.1 Chat

- 流式中：不展示入口；
- 没有任何数据：不展示入口；
- 详情加载中：抽屉内显示 Skeleton；
- 加载失败：显示「无法加载本轮记忆记录」，提供重试；
- 原始记忆查询失败：继续展示快照；
- Trace 保存失败：回答照常显示，不展示入口。

### 17.2 记忆中心

- 没有正式记忆：说明什么内容会被 Molibot 记住，并提供前往 Chat 的入口；
- 没有候选：显示「没有待确认的记忆」；
- Memory 未启用：解释影响并提供前往插件设置入口；
- 服务未连接：保留重新连接能力，但不得重复显示页面说明；
- 搜索无结果：显示清空筛选操作。

---

## 18. 隐私与安全

1. Memory Trace 仅当前本地用户可见；
2. 分享对话默认不包含 Memory Trace；
3. 完整 Memory 内容不得进入通用运行日志、Activity summary 或埋点；
4. 反馈 comment 不回灌模型上下文；
5. 不展示系统 Prompt、隐藏指令、模型推理、Token、密钥、凭据和工具机密；
6. Memory Trace 查询必须通过消息所属 Session 校验，不能只凭 memoryId 查询；
7. 删除 Session 时同步删除 Trace，防止孤立私密数据；
8. 测试必须使用临时 SQLite 或可注入 Store，不得读写真实用户记忆库和 Session 数据。

---

## 19. 性能要求

- 消息列表不得加载完整 Trace JSON；
- 每条消息只增加轻量数量字段；
- 本地 Trace 详情 P95 目标 < 200ms；
- 一次会话加载不得因历史 Trace 数量产生 N+1 查询；
- Assistant 消息投影应批量按 messageId/runId 查询摘要；
- Trace 记录失败不得增加模型请求重试；
- Snapshot JSON 大小必须有上限，单条来源列表和 content 需使用与现有 Memory 相同的安全限制。

---

## 20. 埋点与质量指标

V1 只记录不含记忆正文的事件：

- `memory_trace_trigger_impression`；
- `memory_trace_opened`；
- `memory_trace_item_opened`；
- `memory_trace_feedback_submitted`；
- `memory_trace_memory_edited`；
- `memory_trace_memory_disabled`；
- `memory_trace_source_opened`。

核心指标：

- 入口点击率；
- 反馈率；
- 负反馈率；
- 从 Trace 发起的编辑率；
- helpful / (helpful + irrelevant)；
- Trace 记录失败率；
- 有记忆注入的回答占比；
- 明确「请记住」后产生成功写入回执的比例。

埋点只记录 ID、类型、数量、状态和时间，不记录 Memory content。

---

## 21. 验收标准

### 21.1 回答参考准确性

- [ ] 注入 N 条记忆时，消息底部显示「参考了 N 条记忆」；
- [ ] N 等于 `MemoryInjectionSnapshot.items.length`；
- [ ] 抽屉展示全部最终注入项，不展示在 5 条预算外被裁掉的 selected 候选；
- [ ] 每项展示文本与 `<current-memory>` 中的最终截断文本一致；
- [ ] 展示顺序与 `<current-memory>` 注入顺序一致；
- [ ] 未注入时默认不展示入口；
- [ ] 历史回答使用生成时快照；
- [ ] 修改或删除原始 Memory 后，历史快照不变。

### 21.2 本轮写入准确性

- [ ] Memory add 成功后显示「已记住 1 条」；
- [ ] update 成功后显示「更新了 1 条记忆」；
- [ ] 写入失败不增加数量；
- [ ] 候选不显示为「已记住」；
- [ ] 回执内容来自结构化 Gateway 返回值；
- [ ] 模型回答文本提到「记住了」但实际未写入时，不展示成功入口；
- [ ] 重试不会重复计算同一个写入；
- [ ] 回答失败但写入已提交时，回执仍可审计。

### 21.3 记忆中心

- [x] 默认进入「概览」而不是技术操作区；
- [x] 「概览 / 主题 / 全部记忆」是三个独立 Tab，高级管理不是 Tab；
- [x] 待确认候选位于概览；
- [x] 主题包含摘要、关键事实和相关实体，并可追溯到底层记忆；
- [ ] 用户无需理解 namespace 即可判断作用范围；
- [ ] 待确认候选不参与检索和注入；
- [ ] 编辑候选后仍通过 `confirmCandidate` 重新校验；
- [ ] 关闭自动注入后，后续 `createPromptSnapshot` 不再选择该记录；
- [ ] 版本、来源、冲突、过期和固定状态可查看；
- [ ] 删除使用应用内确认弹层。

### 21.4 稳定性

- [ ] Trace 记录器异常不终止 Turn；
- [ ] Trace 保存失败不影响回答落库；
- [ ] Session 删除同步清理 Trace；
- [ ] 原始 Memory 删除不清理历史 Trace；
- [ ] 同一 Run 重复 commit 幂等；
- [ ] 每个重试生成的最终 Assistant 回答只绑定一份 committed Trace；
- [ ] 普通 Channel 不需要新增分支即可产生共享 Trace 数据。

### 21.5 UI 与无障碍

- [ ] 中英文即时切换；
- [ ] 明暗主题正确；
- [ ] 860×620 最小窗口可用；
- [ ] 抽屉在窄窗口全屏；
- [ ] 键盘可打开入口、切换区块、提交反馈和关闭抽屉；
- [ ] 焦点进入抽屉后受控，关闭后返回触发按钮；
- [ ] 状态不能只靠颜色表达；
- [ ] reduced motion / increased contrast 下可用；
- [ ] 保存操作使用固定底栏。

---

## 22. 测试计划

### 22.1 单元测试

- Snapshot 转 TraceItem；
- `MemoryPromptSnapshot.selected` 结构化压缩为 `MemoryInjectionSnapshot`；
- 12 条 selected 最终只注入 5 条时，计数必须为 5；
- 超过 220 字时 `injectedText` 与实际 Prompt 截断结果一致；
- injectionOrder 保持；
- `allowInjection` 过滤；
- Memory 工具 result 转 WriteReceipt；
- 写入回执幂等键；
- 反馈 upsert；
- MessageMemoryMeta 计数；
- 原始 Memory 缺失时的快照返回。

### 22.2 存储测试

- 临时 SQLite create/read/commit/fail；
- runId 唯一；
- Assistant message 绑定；
- Session 级批量摘要查询；
- 删除 Session 级联清理；
- 删除 Memory 不影响 Trace；
- 重启后历史 Trace 可读。

### 22.3 Runner 集成测试

固定场景：

1. 无记忆 → 无入口；
2. 注入 3 条 → 参考数量与快照一致；
3. memory add → createdCount=1；
4. memory update → before/after 正确；
5. 工具返回错误 → writtenCount=0；
6. 模型 fallback/retry → 不重复写入回执；
7. abort 后已有成功写入 → 保留回执；
8. Trace Store 抛错 → 回答仍成功；
9. Project 会话只展示实际注入的 owner/chat/agent/project，不出现 content；
10. 停用 Memory 后不再被注入；
11. 一轮包含多个 Assistant/toolResult entry 时，只给最终文本 Assistant 绑定 Trace；
12. UI metadata 顺序变化时仍通过 `sourceEntryId` 绑定正确消息。

### 22.4 Desktop UI 测试

- 两个入口分别显示与隐藏；
- 抽屉懒加载、失败重试；
- 快照详情；
- 反馈状态；
- 记忆编辑后列表刷新；
- 待确认流程；
- 来源跳转；
- 中英、明暗、窄窗口、键盘和焦点恢复。

---

## 23. 实施计划

### 阶段 0：契约冻结

交付：

- 本 PRD 评审通过；
- `MessageMemoryMeta`、`TurnMemoryTrace`、Snapshot、WriteReceipt 定稿；
- 确认 Trace SQLite 所属 storage path；
- 验证 Assistant messageId/sourceEntryId 绑定契约。

验证：类型级测试与存储草图评审。

### 阶段 1：读取 Trace

交付：

- Trace Store；
- `runId` pending/commit 生命周期；
- 结构化生成 `MemoryInjectionSnapshot`，移除字符串二次裁剪造成的事实偏差；
- 保存最终注入项快照；
- 消息摘要和详情 API。

验证：无记忆/有记忆/历史修改/原始删除四条集成测试。

### 阶段 2：写入回执

交付：

- Memory 工具 add/update/delete/candidate 回执；
- retry/abort 幂等；
- 本轮写入 API 投影。

验证：成功、失败、重试、回答失败但写入成功四条集成测试。

### 推荐代码落点

| 位置 | 计划改动 |
|---|---|
| `src/lib/server/memory/types.ts` | 增加 injection/trace/write receipt 类型与 `allowInjection` |
| `src/lib/server/agent/prompts/promptInput.ts` | 用结构化 materialize 替代字符串二次压缩 |
| `src/lib/server/agent/core/runner.ts` | 创建 Trace、记录最终注入项、捕获 Memory 工具原始结果、返回 final sourceEntryId |
| `src/lib/server/agent/session/store.ts` | `appendContextMessage` 返回新 entry id |
| `src/lib/server/sessions/store.ts` | UI metadata 接受并保存显式 `sourceEntryId` |
| `src/lib/server/app/conversationProjection.ts` | 按 sourceEntryId 批量附加消息记忆摘要 |
| `src/lib/server/memory/turnTraceStore.ts` | 新增可注入的 SQLite Trace/feedback store |
| `src/lib/shared/desktop.ts` | 增加 MessageMemoryMeta 与详情响应契约 |
| `src/routes/api/desktop/messages/...` | 新增详情与反馈细粒度 API |
| `apps/desktop/src/lib/chat/ConversationTranscript.svelte` | 消息入口，不直接承担抽屉业务状态 |
| `apps/desktop/src/lib/chat/TurnMemoryDrawer.svelte` | 回答参考与本轮写入展示 |
| `apps/desktop/src/lib/settings/MemorySection.svelte` | 重组已保存/待确认/高级管理 |
| `apps/desktop/src/lib/i18n.ts`、`apps/desktop/src/styles.css` | 双语与共享语义样式 |

文件名是推荐落点；实现时若现有模块边界已有更合适入口，可调整文件拆分，但不得改变共享上层、显式 sourceEntryId、结构化最终注入和细粒度 API 四项契约。

### 阶段 3：Chat UI

交付：

- 消息底部两个入口；
- 本轮记忆抽屉；
- 快照详情；
- 反馈；
- 编辑/停用/来源入口。

验证：真实浏览器交互、中英、主题、窗口和键盘。

### 阶段 4：记忆中心重组

交付：

- 「记忆」命名；
- 已保存/待确认/高级管理；
- 详情 Sheet；
- `allowInjection`；
- 应用内删除确认。

验证：管理完整链路与设置保存细粒度回归。

### 阶段 5：对抗式验收与发布

重点攻击：

1. 数量与真实注入不一致；
2. 候选被误称为正式记忆；
3. 回答重试导致重复写入；
4. 原始记忆修改覆盖历史快照；
5. Trace 异常阻塞回答；
6. 私密内容进入通用日志或埋点；
7. Session 投影把 Trace 绑定到错误 Assistant 消息。

全部修正并通过验收后才可发布。

---

## 24. 发布与兼容策略

1. 数据库迁移只新增表和可选字段；
2. 存量消息没有 `memory` 元数据时正常渲染；
3. 存量 Memory 缺少 `allowInjection` 时按 true 处理；
4. json-file 维护后端不要求实现完整 Trace 编辑能力，但读取 Snapshot 仍可记录；
5. 功能可通过内部 feature flag 分阶段开启：先记录、再 Desktop 展示；
6. 首次发布观察 Trace 失败率、错误绑定率和消息列表性能；
7. 发现异常时可关闭展示，不关闭 Memory 检索和回答主流程。

---

## 25. 最终产品原则

### 透明，但不夸大

展示「提供给模型的记忆」，不声称已经证明模型如何推理。

### 读取与写入分离

「参考了什么」和「记住了什么」必须分别展示、分别计数。

### 历史准确

历史回答永远展示回答生成时的记忆快照。

### 可纠正

用户不仅能看，还能反馈、编辑、停用、确认或删除。

### 不阻塞回答

Memory Trace 是旁路审计能力，任何失败都不能破坏聊天主流程。

### 共享上层实现

记录、关联、去重、失败恢复和持久化全部位于共享 Agent/app 层；Channel 只负责消息收发与平台适配。
