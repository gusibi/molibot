# Desktop Chat 侧边栏与多会话并发改造方案

日期：2026-07-07

## 1. 改造目标

解决当前 Desktop Chat 左侧栏层级混乱、渠道与 Bot 占用空间过多、Web Profile 暴露底层概念，以及前端只能维持一个活动运行状态的问题。

最终效果：

- 左侧栏只保留紧凑的一级渠道导航。
- Web 和外部渠道使用一致的会话浏览方式。
- 最近会话快速访问，完整历史按 Bot 分组搜索。
- Web Profile 在聊天界面统一称为 Bot，不暴露底层 Agent。
- 不同 Session 可以同时运行，彼此不冲突。
- 每个 Session 独立保存运行、审批、队列和输入草稿状态。

## 2. 最终信息架构

### 2.1 顶部导航

保留现有四个入口，功能不变：

1. 新对话
2. 项目
3. 自动任务
4. 技能

移除顶部的 MoliBot 品牌区，以减少无效占用。

### 2.2 渠道折叠组

顶部导航下方显示五个互斥折叠组：

1. 对话
2. Telegram
3. 飞书
4. QQ
5. 微信

交互规则：

- 默认展开「对话」。
- 始终有且只有一个组处于展开状态。
- 点击其他组时，当前组自动折叠。
- 再次点击当前组不会将其折叠。
- 每个标题栏只显示渠道图标、渠道名称和展开箭头。
- 不显示渠道会话总数。
- 未配置 Bot 的渠道仍然显示。
- 未配置渠道展开后显示空状态和「前往设置」入口。

### 2.3 默认选中行为

应用首次进入 Chat 时：

- 默认展开「对话」。
- 自动选中所有 Web Bot 中最后活跃的普通会话。
- 右侧展示该会话记录。
- 如果没有历史会话，则进入尚未落盘的新对话草稿。

从项目、自动任务或技能返回 Chat 时：

- 保留本次应用运行期间最后展开的渠道。
- 保留最后选中的会话。
- 只有当前选择失效时才回退到默认 Web 会话。

## 3. 会话列表设计

### 3.1 最近会话

每个渠道展开后：

- 跨该渠道所有 Bot 聚合普通会话。
- 按 `updatedAt` 倒序排列。
- 最多显示最近 10 条。
- 第 11 条及以后不直接显示。
- 超过 10 条时，在列表底部显示「更多对话」。

只包含用户主动聊天的普通 Session，排除：

- 自动任务执行 Session
- 项目 Session
- 诊断或测试 Session
- 其他系统内部 Session

### 3.2 Web 会话

「对话」组聚合所有 Web Profile 的会话。

聊天界面不出现以下底层术语：

- Web Profile
- Agent
- Profile ID
- Agent ID

界面统一使用「Bot」。Web Profile 仍是后端真实存储和路由实体，只改变产品层展示名称。

### 3.3 外部渠道会话

Telegram、飞书、QQ、微信分别聚合该渠道下所有 Bot 的普通会话。

外部渠道保持现有只读属性：

- 可以查看完整历史记录。
- 不提供 Desktop 输入框。
- 不允许通过 Desktop 代替渠道发送消息。
- 不提供重命名和删除操作。

### 3.4 单条会话样式

每条会话使用紧凑单行布局，包含：

- Bot 首字图标
- 会话标题
- 相对更新时间
- 可选运行状态点
- 悬停或键盘聚焦时出现的操作按钮

不在侧栏显示消息摘要。标题过长时单行截断，不压缩图标和状态点。

### 3.5 Bot 图标

- 内容取 Bot name 的第一个有效字符。
- 中文取首个汉字，英文转为大写首字母。
- 没有有效名称时使用通用 Bot 图标。
- 颜色由稳定 Bot ID 映射到预设主题色板。
- 同一个 Bot 跨重启保持相同颜色。
- Bot 重命名不改变颜色。
- 不得使用运行时随机颜色。

### 3.6 已删除 Bot

Bot 删除后：

- 历史会话继续保留并可查看。
- 在完整会话弹窗中归入「已删除的 Bot」分组。
- 优先显示 Session 元数据中保存的旧 Bot 名称。
- 显示「已删除」标记。
- 保持原稳定颜色；无法恢复原 ID 时使用历史 ID 映射。

## 4. 渠道切换行为

点击渠道折叠标题时：

1. 展开目标渠道。
2. 折叠其他渠道。
3. 自动选择该渠道最新的普通会话。
4. 右侧加载该会话。

如果渠道没有历史会话：

- Web：显示新对话草稿。
- 外部渠道：显示只读空状态。
- 未配置渠道：显示配置引导。

不同 Session 正在运行时，允许自由切换渠道和会话，后台运行不得被导航中断。

## 5. 「更多对话」弹窗

### 5.1 打开方式

仅当当前渠道会话数超过 10 条时，在展开列表底部显示「更多对话」。点击后打开当前渠道的完整会话弹窗。

### 5.2 分组规则

- Web 按 Web Profile 分组，但界面显示为 Bot。
- 外部渠道按渠道 Bot 实例分组。
- Bot 分组按该 Bot 最近一次会话活跃时间倒序。
- 组内会话按 `updatedAt` 倒序。

### 5.3 分页

不得一次性预载全部会话：

- 每个 Bot 首次加载最近 10 条。
- 每组独立显示「加载更多」。
- 后端使用 cursor 或稳定的 `updatedAt + sessionId` 游标分页。
- 避免仅使用 offset，防止分页过程中新增消息导致重复或遗漏。

### 5.4 搜索

首版搜索范围：

- 会话标题
- Bot 名称
- 最近消息摘要

不做全量历史消息全文检索。

搜索要求：

- 由后端执行并支持分页。
- 输入采用约 250ms 防抖。
- 只搜索当前渠道。
- 搜索结果仍按 Bot 分组。
- 空结果提供明确状态。
- 清空搜索后恢复正常分组列表。

### 5.5 会话操作

Web 会话支持打开、重命名、删除，以及停止正在运行的会话。外部会话仅支持打开查看。

点击会话后：

- 关闭弹窗。
- 展开对应渠道。
- 选中对应会话。
- 右侧加载会话内容。

## 6. 新对话与 Bot 选择

### 6.1 新对话流程

点击「新对话」后：

- 切换到 Chat。
- 展开「对话」。
- 进入尚未落盘的空白草稿。
- 输入框下方显示 Bot 选择器。
- 此时允许切换 Bot。
- 不立即创建 Session。

只有发送第一条消息时才：

1. 使用当前 Bot 对应的 Web Profile 创建 Session。
2. 将 Session 固定绑定到该 Bot。
3. 启动消息发送。
4. 将新 Session 插入最近会话列表。

这样可以避免用户试选 Bot 时产生多个空 Session。

### 6.2 Bot 默认值

新对话默认 Bot：

1. 优先选择上一次成功发送消息使用的 Web Bot。
2. 如果不存在或已删除，回退到系统默认 Web Bot。
3. 如果没有可用 Web Bot，显示配置引导并禁止发送。

「上一次使用的 Bot」可以存储在 Desktop 本地偏好中，但真实 Session 绑定必须以后端数据为准。

### 6.3 Bot 锁定

已有 Session：

- Bot 不允许修改。
- 输入框下方仍显示当前 Bot。
- 选择器变为只读展示。
- 不提供中途迁移 Agent、Bot 或 Profile 的能力。

原因是 Session 文件位置、运行上下文和 Profile 绑定在创建时已经确定。

### 6.4 显示文案

建议中文：

- 标签：`Bot`
- 新对话提示：`选择用于本次对话的 Bot`
- 锁定提示：`Bot 在发送第一条消息后不可更改`

建议英文：

- `Bot`
- `Choose a Bot for this conversation`
- `The Bot cannot be changed after the first message`

## 7. 多 Session 并发模型

### 7.1 并发边界

允许：

- Session A 正在运行时切换到 Session B。
- Session A 在后台继续运行。
- 用户可以在 Session B 发起另一轮运行。
- 多个不同 Session 同时运行。

不允许：

- 同一个 Session 同时执行两轮 Agent。
- 同一个 Session 并发写入上下文。
- 同一个 Session 绕过既有 follow-up 队列。

因此：

- 不同 Session：并行。
- 相同 Session：串行。
- 运行中再次发送：进入该 Session 自己的 follow-up 队列。

### 7.2 后端能力判断

现有后端已经具备主要基础：

- `RunnerPool` 使用 `chatId + sessionId` 作为 Runner key。
- Runtime 数据库锁按 `session_id` 检查。
- 不同 Session 可以使用不同 Runner。
- 同一个 Session 会被活动运行锁保护。

主要缺口在 Desktop 前端：当前 `ConversationController` 只对应当前活动 Session，并使用单套 `sending`、stream、approval 和 abort 状态。

### 7.3 前端状态结构

将单一控制器改为按 Session 管理：

```ts
type SessionRuntimeKey = `${profileId}:${sessionId}`;

interface SessionRuntimeState {
  profileId: string;
  sessionId: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  sending: boolean;
  activity: string;
  streamingText: string;
  streamingThinking: string;
  activities: DesktopActivityEntry[];
  pendingApproval: DesktopApprovalPrompt | null;
  queue: string[];
  error: string;
  lastRunId?: string;
  unreadTerminalStatus?: "completed" | "failed";
}
```

由 Session runtime registry 管理：

```ts
Map<SessionRuntimeKey, ConversationController>
```

关键要求：

- Controller 创建后不能因为切换会话而销毁。
- 切换会话只改变当前视图绑定。
- 每个 Controller 使用固定的 Profile ID 和 Session ID。
- 不允许 Controller 通过可变的 `host.sessionId()` 意外指向另一个 Session。
- 停止、审批、队列操作都必须显式携带目标 Session key。
- 删除 Session 前必须确认该 Session 没有活动运行，或先停止运行。

### 7.4 流式状态

后台 Session 继续接收 SSE：

- token 更新对应 Session 的 `streamingText`。
- tool activity 更新对应 Session。
- approval 只写入对应 Session。
- done 后重新加载对应 Session transcript。
- 不修改当前正在查看的其他 Session。

切回后台 Session 时，立即显示其当前流式进度。

### 7.5 附件发送

带附件的非流式请求也必须进入对应 Session Controller。

切换会话不得：

- 取消上传。
- 把响应写入新的活动会话。
- 清除其他会话的附件草稿。

## 8. Session 状态点

### 8.1 状态颜色

- 蓝色脉冲：运行中
- 黄色：等待审批或已暂停
- 绿色：后台运行成功完成
- 红色：异常退出

### 8.2 消失规则

- 蓝色：运行结束后切换为终态。
- 黄色：审批完成、拒绝或运行恢复后消失。
- 绿色：用户打开对应会话后视为已读并消失。
- 红色：用户打开对应会话后视为已读并消失。
- 当前正在查看的会话成功结束时，不需要显示未读绿色状态。
- 当前正在查看的会话失败时，应直接显示错误，同时不保留未读红点。

### 8.3 无障碍要求

状态不能只依赖颜色。每个状态点必须有 `aria-label`、tooltip 和可本地化状态文本，例如「正在运行」「等待审批」「已完成」「运行失败」。

## 9. 审批与停止

### 9.1 后台审批

后台 Session 遇到 Host Bash 审批时：

- 该 Session 暂停。
- 侧栏显示黄色状态点。
- 不弹出覆盖当前会话的全局审批弹窗。
- 用户点击该会话后，在对应聊天区域处理审批。
- 审批不得出现在其他 Session 中。

### 9.2 停止运行

正在运行的会话提供两个停止入口：

- 会话行悬停时的停止按钮。
- 进入会话后的输入区域停止按钮。

停止规则：

- 只停止目标 Session。
- 清空该 Session 的 follow-up 队列。
- 不影响其他 Session。
- 停止请求必须携带明确的 Profile ID 和 Session ID。
- 停止完成后重新加载该 Session 的真实消息和状态。

## 10. 草稿管理

### 10.1 每个 Session 独立草稿

每个 Session 独立保存：

- 输入文本
- 待发送附件
- Thinking 选择
- 其他仅属于本次输入的 composer 状态

切换会话后再回来，应恢复草稿。

### 10.2 新对话草稿

未落盘的新对话也有独立草稿，包括已选 Bot、输入文字、附件和 Thinking 设置。

建议只保留一个尚未落盘的新对话草稿，避免侧栏出现多个不可见的临时会话。

### 10.3 持久化边界

- 普通文本草稿可保存在 Desktop 本地状态。
- 文件对象不能直接长期持久化。
- 应用重启后无法安全恢复的本地附件，需要明确提示重新选择。
- 不要把未发送草稿写入 Session 对话上下文。

## 11. 重连与状态恢复

### 11.1 目标

Desktop 重启或服务短暂断线后，不能仅依赖前端内存判断 Session 状态。

重连时应：

1. 查询 Runtime 中活动 Session 状态。
2. 恢复运行中、等待审批、完成或失败状态。
3. 重新加载相关 Session transcript。
4. 恢复可恢复的审批信息。
5. 清理已经过期的前端 Controller。

### 11.2 流式恢复策略

不要求重放断线期间的所有 token：

- 如果运行仍在继续，恢复蓝色状态并轮询 transcript/run 状态。
- 如果运行已经结束，直接加载最终持久化消息。
- 如果运行等待审批，恢复黄色状态和审批卡片。
- 如果无法重新订阅旧 SSE，不伪造流式文本。

### 11.3 建议接口

增加共享运行状态接口，例如：

```http
GET /api/desktop/session-runs?profileId=...
```

响应示例：

```json
{
  "runs": [
    {
      "profileId": "default",
      "sessionId": "s-...",
      "runId": "run-...",
      "status": "running",
      "startedAt": "...",
      "waitingApproval": false,
      "errorCode": null
    }
  ]
}
```

状态必须来自 Runtime 持久化或真实 Runner 状态，不能只来自 Desktop 进程内存。

## 12. 会话数据接口

### 12.1 当前问题

现有 Desktop 前端：

- Web 只加载当前 Profile 的 Session。
- 外部会话 summary 倾向于一次返回完整列表。
- 当前导航先按渠道，再按 Bot 展开。
- 不支持跨 Bot 最近 10 条统一聚合。
- 不支持按 Bot 分页搜索。

因此不能只改 Svelte 模板，需要补共享数据接口。

### 12.2 统一查询接口

建议新增面向 Desktop 导航的接口：

```http
GET /api/desktop/conversations
```

参数：

```text
channel=web|telegram|feishu|qq|weixin
limit=10
cursor=
query=
botId=
```

响应建议：

```json
{
  "channel": "telegram",
  "items": [
    {
      "sessionId": "s-...",
      "title": "会话标题",
      "updatedAt": "...",
      "botId": "bot-1",
      "botName": "通知助手",
      "botDeleted": false,
      "latestMessagePreview": "最近消息摘要",
      "readOnly": true
    }
  ],
  "nextCursor": "...",
  "hasMore": true
}
```

### 12.3 Bot 分组接口

「更多对话」可以继续使用统一接口，也可以增加分组接口：

```http
GET /api/desktop/conversations/groups?channel=telegram&query=
```

每个 Bot 分组返回独立 cursor。

不要把分页、聚合和过滤逻辑放进 Channel 实现。它们属于 Desktop/API 或共享会话查询层。

Channel 层仍只负责：

- 平台消息收发
- 平台身份适配
- 原始消息与统一消息结构转换

### 12.4 普通 Session 过滤

服务端需要提供明确的 Session 分类字段，避免前端通过 ID 前缀长期猜测：

```ts
type SessionPurpose =
  | "conversation"
  | "project"
  | "automation"
  | "diagnostic"
  | "test";
```

侧栏只查询 `purpose=conversation`。

如果暂时无法迁移历史数据，可在共享查询层集中兼容旧命名，但不要把判断复制到各 Channel 或多个 UI 组件。

## 13. 组件拆分建议

不要继续把全部逻辑堆进 `ChatView.svelte`。

建议拆分为：

```text
apps/desktop/src/lib/chat/
├── ChatSidebar.svelte
├── ChannelAccordion.svelte
├── ConversationRow.svelte
├── ConversationBrowserDialog.svelte
├── BotAvatar.svelte
├── BotSelector.svelte
├── sessionRuntimeRegistry.svelte.ts
├── sessionDraftStore.svelte.ts
└── conversationController.svelte.ts
```

职责：

- `ChatSidebar`：整体导航和折叠状态。
- `ChannelAccordion`：单个渠道标题和最近会话。
- `ConversationRow`：会话展示、状态和行操作。
- `ConversationBrowserDialog`：搜索、分组、分页。
- `BotAvatar`：稳定首字和颜色。
- `BotSelector`：新会话选择和已有会话只读展示。
- `sessionRuntimeRegistry`：按 Session 管理 Controller。
- `sessionDraftStore`：按 Session 保存 composer 草稿。
- `ConversationController`：单个固定 Session 的运行控制。

共享消息 renderer、composer 外壳和现有 API client 应继续复用，不复制实现。

## 14. 视觉与布局

### 14.1 侧栏宽度

- 默认宽度约 260px。
- 保留拖拽调整。
- 最小宽度结合现有内容测试后设置，建议约 220px。
- 最大宽度保留现有约束。
- 用户调整后的宽度继续持久化。

### 14.2 紧凑密度

需要整体降低：

- 顶部导航行高
- 导航间距
- 渠道标题行高
- 会话行高
- 图标尺寸
- 分组间距
- 底部品牌区高度

不要通过裸 Tailwind 或页面内 `<style>` 临时实现，应继续使用共享语义 CSS 和主题 token。

### 14.3 底部品牌区

移除字母 D 和「账户与设置」，替换为：

- 真实 MoliBot Logo
- `MoliBot`
- 右侧设置齿轮

点击整行打开设置窗口。顶部不再重复显示 MoliBot。

### 14.4 适配要求

必须检查：

- 中文与英文
- 明亮与暗色主题
- 最窄可用窗口
- 拖拽侧栏宽度
- 键盘操作
- 长 Bot 名称
- 长会话标题
- 200 条以上历史会话
- 多个同时运行的 Session

## 15. 实施阶段

### Slice 1：共享会话和运行状态接口

实现：

- 普通会话分类过滤。
- 跨 Bot 最近 10 条聚合。
- Bot 分组分页。
- 标题、Bot、摘要搜索。
- 已删除 Bot 历史分组。
- Session 运行状态查询。
- Web 和外部渠道统一 view model。

验证：

- Web 多 Profile 聚合排序正确。
- 外部渠道多 Bot 聚合排序正确。
- 只返回普通 Session。
- 分页不重复、不遗漏。
- 搜索不会预载全部 transcript。
- 未配置渠道仍出现在渠道摘要中。
- 已删除 Bot 历史可见。

### Slice 2：按 Session 隔离运行状态

实现：

- Session runtime registry。
- 每个 Session 独立 Controller。
- 后台 SSE 持续运行。
- Session 独立 follow-up 队列。
- Session 独立审批状态。
- Session 独立 abort。
- 草稿与附件隔离。
- 重连状态恢复。
- 运行状态点数据模型。

验证：

- A、B 两个 Session 可同时运行。
- A 中途切到 B 不会中止 A。
- A 的 token 不会写入 B。
- A 的审批不会出现在 B。
- 停止 A 不影响 B。
- 同一 Session 的第二条消息仍排队。
- 服务断线重连后能恢复真实状态。
- 切换会话不会丢失草稿。

### Slice 3：侧栏和弹窗 UI

实现：

- 移除顶部品牌。
- 紧凑四项导航。
- 五个互斥折叠组。
- 最近 10 条会话。
- Bot 首字和彩色图标。
- 状态点。
- 「更多对话」弹窗。
- Bot 选择器。
- 底部 MoliBot 设置入口。
- 空状态和设置引导。
- 中英、明暗、窄宽适配。

验证：

- 默认展开对话并打开最新 Chat。
- 渠道切换自动打开最新会话。
- 永远只展开一个渠道。
- Web Profile 不在聊天界面暴露。
- 第 11 条通过「更多」访问。
- 搜索、分页、分组可用。
- 键盘焦点和 screen reader 标签完整。

### Slice 4：对抗式审查与文档

重点攻击：

1. 快速切换 Session 时 SSE 是否串线。
2. 删除或重命名 Bot 后历史会话是否丢失。
3. 断线重连后运行状态是否虚假。
4. 多 Session 审批和停止是否作用到错误目标。
5. 分页期间会话更新是否造成重复或遗漏。
6. 未发送附件是否因切换会话丢失。
7. 旧 Session 是否被错误分类进普通聊天。
8. 当前会话完成时是否错误显示未读绿点。

完成后按项目规则更新：

- `prd.md`
- `features.md`
- `CHANGELOG.md`
- `README.md`

## 16. 验收标准

功能完成必须同时满足：

- 左侧栏没有水平渠道切换条和 Bot 二级折叠树。
- 五个渠道组始终只展开一个。
- 默认打开 Web 最新普通会话。
- 最近列表跨 Bot 聚合且最多 10 条。
- 完整会话可按 Bot 分组、搜索和分页。
- Web Profile 在聊天界面统一显示为 Bot。
- Bot 只能在第一条消息发送前选择。
- 不同 Session 可以真实并行运行。
- 同一个 Session 仍保持串行和独立队列。
- 后台 Session 可以审批、停止和恢复。
- 状态点不会串到其他 Session。
- 外部渠道保持只读。
- 自动任务、项目和诊断 Session 不进入列表。
- 中英、明暗主题和窄窗口均可用。
- 所有新增持久化测试使用临时数据库或可注入 Store。
- 最终通过类型检查、单元测试、Desktop 构建和真实界面验收。
