# Desktop Chat 侧栏与多会话改造 — Slice 3 重接交接说明

日期：2026-07-08
对应方案：`docs/designs/2026-07-07-desktop-chat-sidebar-multi-session-plan.md`

本文档供**新会话**接手 Slice 3（`ChatView.svelte` 重接 + 拆分）使用。Slice 1、Slice 2 已完成并验证，Slice 3 的全部新组件已建好且 `svelte-check` 干净；剩余工作是把这些组件和 registry 接进 `ChatView.svelte`，并顺带把这个 2117 行的 legacy 文件拆成合理的小文件。

---

## 1. 当前进度快照

### 已完成并验证

**Slice 1 — 共享会话与运行状态接口（后端）**
- `src/lib/server/app/desktopConversations.ts` — 共享查询层（跨 Bot 聚合、`updatedAt+sessionId` 游标分页、标题/Bot/摘要搜索、按 Bot 分组、已删除 Bot、`purpose` 分类、`session-runs` 查询）。
- `src/lib/shared/desktop.ts` — 新增类型：`DesktopConversationChannel`、`DesktopConversationPurpose`、`DesktopConversationItem`、`DesktopConversationsResponse`、`DesktopConversationBotGroup`、`DesktopConversationsGroupsResponse`、`DesktopSessionRunStatus`、`DesktopSessionRun`、`DesktopSessionRunsResponse`。
- `src/lib/server/sessions/store.ts` — 新增 `SessionStore.listAllWebConversations()` 与 `getWebConversationOwner()`。
- `src/lib/server/app/desktopExternalSessions.ts` / `externalSessionsFromContexts.ts` — `ExternalSessionEntry` 新增 `preview`。
- 新路由：`src/routes/api/desktop/conversations/+server.ts`、`conversations/groups/+server.ts`、`session-runs/+server.ts`。
- `apps/desktop/src/lib/api.ts` — 新增客户端函数 `listDesktopConversations`、`listDesktopConversationGroups`、`listDesktopSessionRuns`。
- 测试：`src/lib/server/app/desktopConversations.test.ts`（12 条，全过）；`api.test.ts` 65/65；server `tsc` 干净。

**Slice 2 — 按 Session 隔离运行状态原语（前端）**
- `apps/desktop/src/lib/chat/sessionStatusDot.ts`（纯）— `SessionRunStatus`、`deriveStatusDot`、`nextTurnStatus`、`statusFromRestoredRun`、`sessionRuntimeKey`。
- `apps/desktop/src/lib/chat/sessionDraftStore.ts`（纯）— `SessionDraftStore`、`SessionDraft`、`sessionDraftKey`、`NEW_CONVERSATION_KEY`。
- `apps/desktop/src/lib/chat/sessionRuntimeRegistry.svelte.ts`（runes）— `SessionRuntimeRegistry` + `SessionRuntimeEntry` + `SessionRuntimeDeps`，每会话固定 controller + 自持 transcript/error/status + `setActive`（mark-viewed）+ `restoreFromRuns` + `dispose`。
- 测试：`sessionStatusDot.test.ts`（8 条）+ `sessionDraftStore.test.ts`（6 条）全过；`svelte-check` 干净。

**Slice 3 — 新 UI 组件（已建好，类型检查通过，尚未接入 ChatView）**
- `apps/desktop/src/lib/chat/BotAvatar.svelte`（runes）— 稳定首字 + 颜色，导出 `botAvatarColor`/`botAvatarInitial`/`BOT_AVATAR_PALETTE`。
- `apps/desktop/src/lib/chat/ConversationRow.svelte`（runes）— 会话行 + 状态点 + 悬停停止。
- `apps/desktop/src/lib/chat/BotSelector.svelte`（runes）— 新会话可选 / 已有会话只读。
- `apps/desktop/src/lib/chat/ConversationBrowserDialog.svelte`（runes）— 「更多对话」弹窗（搜索 + 分组 + 每 Bot 分页）。
- `apps/desktop/src/lib/chat/ChannelAccordion.svelte`（runes）— 单渠道折叠组（标题 + 最近会话 + 更多 + 空状态/配置引导）。导出 `ChannelDescriptor`。
- `apps/desktop/src/lib/chat/ChatSidebar.svelte`（runes）— 顶部四项导航 + 五个折叠组 + 底部 MoliBot 设置入口。

### 待完成

**Slice 3（剩余）— `ChatView.svelte` 重接 + 拆分**：见下文。

**Slice 4 — 对抗式审查 + 文档**：见第 9 节。

---

## 2. 已就绪的 API 契约（新会话直接用，无需再探）

### 后端路由

| 方法 | 路径 | 参数 | 返回 |
|------|------|------|------|
| GET | `/api/desktop/conversations` | `channel=web\|telegram\|feishu\|qq\|weixin`、`limit`(≤100,默认10)、`cursor`、`query`、`botId` | `{ok,channel,items:DesktopConversationItem[],nextCursor,hasMore}` |
| GET | `/api/desktop/conversations/groups` | `channel`、`query` | `{ok,channel,groups:DesktopConversationBotGroup[]}`（每组带独立 `nextCursor`） |
| GET | `/api/desktop/session-runs` | — | `{ok,runs:DesktopSessionRun[]}`（仅 running/waiting_for_approval；`profileId` 服务端解析） |

`DesktopConversationItem` 字段：`sessionId,title,updatedAt,botId,botName,botDeleted,channel,purpose,readOnly,latestMessagePreview?`。外部渠道 `readOnly=true`；web `readOnly=false`。侧栏只显示 `purpose==="conversation"`（后端已过滤）。

### 前端客户端函数（`apps/desktop/src/lib/api.ts`）

```ts
listDesktopConversations(endpoint, { channel, limit?, cursor?, query?, botId? }): Promise<DesktopConversationsResponse>
listDesktopConversationGroups(endpoint, { channel, query? }): Promise<DesktopConversationsGroupsResponse>
listDesktopSessionRuns(endpoint): Promise<DesktopSessionRunsResponse>
```

### Registry / Draft Store API（`apps/desktop/src/lib/chat/`）

```ts
// sessionRuntimeRegistry.svelte.ts
new SessionRuntimeRegistry(draftStore: SessionDraftStore)
registry.init(deps: SessionRuntimeDeps)   // 必须先 init
registry.get(profileId, sessionId): SessionRuntimeEntry | undefined
registry.getOrCreate(profileId, sessionId): SessionRuntimeEntry   // 创建固定 controller
registry.setActive(profileId, sessionId)   // 标记活动 + 清除该会话的未读终态
registry.clearActive()
registry.dispose(profileId, sessionId) / disposeAll()
registry.restoreFromRuns(runs: DesktopSessionRun[]): SessionRuntimeKey[]  // 重连恢复
registry.active: SessionRuntimeEntry | undefined

// SessionRuntimeDeps:
{ endpoint(): string; modelReady(): boolean; labels(): ConversationLabels;
  loadTranscript(profileId, sessionId): Promise<UiMessage[]>;
  refreshSessions?(): Promise<void>; afterMutate?(profileId, sessionId): void; }

// SessionRuntimeEntry（runes $state，可直接被 runes 组件读取）:
{ key, profileId, sessionId, controller, messages, error, status, lastRunId, isActive, statusDot,
  appendUser(content, files), reloadFromServer(), setError(m), clearError(), dispose() }

// sessionDraftStore.ts
new SessionDraftStore(defaultThinking?)
store.get(key): SessionDraft               // key = sessionDraftKey(profileId, sessionId) 或 NEW_CONVERSATION_KEY
store.update/setText/setFiles/setThinking/setProfileId/clear/has
```

`ConversationController`（已存在，无需改）host 接口不变；registry 内部已为每个会话构造**固定** profileId/sessionId 的 host adapter——**不要再让 host.sessionId() 读可变活动状态**，这正是旧设计串线的根因。

---

## 3. ChatView.svelte 拆分方案

`apps/desktop/src/ChatView.svelte` 现 2117 行、legacy 模式，塞了侧栏、转录、composer、审批、搜索、文件面板、onboarding、预览等全部逻辑。建议拆成：

```
apps/desktop/src/
├── ChatView.svelte                  # 改为薄壳（runes 模式），组合下面的组件 + 持有 chatSessionStore
└── lib/chat/
    ├── ChatSidebar.svelte           ✅ 已建（顶部导航 + 五折叠组 + 底部 MoliBot）
    ├── ChannelAccordion.svelte      ✅ 已建
    ├── ConversationRow.svelte       ✅ 已建
    ├── ConversationBrowserDialog.svelte ✅ 已建
    ├── BotAvatar.svelte             ✅ 已建
    ├── BotSelector.svelte           ✅ 已建
    ├── ChatHeader.svelte            # 新建：聊天头（标题 / Bot 只读展示 / 搜索切换）— 从 ChatView 1532-1570 抽出
    ├── ChatApprovalCard.svelte      # 新建：Host Bash 审批卡 — 从 ChatView 1669-1693 抽出
    ├── ChatSearchOverlay.svelte     # 新建：转录内搜索条 + 上下匹配 — 从 ChatView 1589-1626 抽出
    ├── ChatComposer.svelte          # 新建：富 composer（输入/附件/Thinking/模型/发送/停止 + BotSelector）— 复用并扩展 ChatComposerShell
    ├── ChatOnboarding.svelte        # 新建：onboarding 向导 — 从 ChatView 1882-2095 抽出（约 200 行，独立性强）
    ├── FilePanel.svelte             # 新建：文件面板 — 从 ChatView 1828-1880 抽出
    ├── chatSessionStore.svelte.ts   # 新建：runes 模式，封装 registry + 活动会话 + 草稿桥接（见第 5 节）
    ├── conversationController.svelte.ts  ✅ 已存在
    ├── sessionRuntimeRegistry.svelte.ts  ✅ 已建
    ├── sessionDraftStore.ts              ✅ 已建
    ├── sessionStatusDot.ts               ✅ 已建
    ├── ConversationLiveView.svelte       ✅ 已存在（流式转录）
    ├── ConversationTranscript.svelte     ✅ 已存在（只读外部转录）
    ├── TranscriptAttachments.svelte      ✅ 已存在
    ├── stickToBottom.ts                  ✅ 已存在
    └── workspace.ts / RunActivity.svelte / InstalledSkillsPane.svelte / ChatWorkspacePane.svelte  ✅ 已存在
```

**拆分原则**：
- 所有**新**组件用 runes 模式（`$props`/`$state`/`$derived`）。这是消除 legacy↔runes 桥接陷阱的根本办法。
- `ChatView.svelte` 重写为 **runes 模式薄壳**：只负责组合 + 持有 `chatSessionStore` + 侧栏宽度拖拽 + 连接/重连生命周期。
- 状态归属：会话运行态（transcript/sending/streaming/approval/queue/status）→ `chatSessionStore` + registry；composer 草稿（文本/附件/Thinking/Bot）→ `SessionDraftStore`；UI 局部态（搜索、重命名编辑、删除确认、onboarding 步骤）→ 各自组件内部 `$state`。
- 既有 `ConversationLiveView`/`ConversationTranscript`/`ChatComposerShell` 尽量复用；若 `ChatComposer` 需要更富，可把 `ChatComposerShell` 升级或新建并让旧 shell 退化为壳。

---

## 4. `chatSessionStore.svelte.ts`（核心新模块）

这是重接的心脏。runes 模式，封装 registry + 活动会话，向上暴露**响应式**状态供 runes 组件直接读。**不要**让任何 legacy `$:` 组件直接读 registry 的 `$state`——要么全站 runes 化，要么经 store 桥接（见第 5 节陷阱）。

建议接口：

```ts
export class ChatSessionStore {
  registry = new SessionRuntimeRegistry(draftStore);
  activeKey = $state<string | null>(null);          // profileId:sessionId
  endpoint = $state("");                              // 由 ChatView 从 service status 注入
  // 派生
  active = $derived(this.activeKey ? this.registry.get(...split) : undefined);

  init(deps-ish from ChatView): void
  selectSession(profileId, sessionId): void   // registry.setActive + entry.reloadFromServer + 切换草稿
  newConversationDraft(): void                // 进入未落盘草稿，不创建 session
  async send(text, files): Promise<void>      // 草稿态下首条消息 → 先 createDesktopSession 再 controller.send
  stopActive(): Promise<void>
  resolveApproval(decision): Promise<void>
  statusDots = $derived(...): Map<string, SessionStatusDot>  // 供侧栏：所有 entry 的 statusDot by key
  async reconnect(): Promise<void>            // listDesktopSessionRuns → registry.restoreFromRuns + 轮询
}
```

`ChatView`（runes 薄壳）`new ChatSessionStore()`，把 `store.active.messages`、`store.active.controller.view`、`store.active.statusDot` 等以 props 下发给 `ChatHeader`/`ConversationLiveView`/`ChatComposer`/`ChatApprovalCard`。

---

## 5. 响应式策略（关键陷阱，必读）

**记忆已记录的坑**：legacy Svelte `$:` 是编译期追踪，只在引用的顶层 `let` 被重新赋值时重跑；它**看不到** runes `$state` 的信号图变化。当初流式渲染就因此坏过（`$: streamingText = chat.streamingText` 永不更新），修法是读 `controller.view` store。

**本次重接的正确做法**：
1. **把 `ChatView.svelte` 整体迁到 runes 模式**（`let { copy, serviceEndpoint, ... } = $props()`；`let x = $state(...)`；`$: y = ...` 改 `let y = $derived(...)`）。这样 `ChatView` 及其子组件都能直接读 registry 的 `$state`，无需桥接。
2. 若出于工作量考虑暂时保留某段 legacy，**那段**读 registry 状态必须经 Svelte store（仿 `controller.view = toStore(...)`）：给 `ChatSessionStore` 加 `readonly activeMessages = toStore(() => this.active?.messages ?? [])` 等，legacy 段用 `$activeMessages` 订阅。**优先方案 1，避免方案 2 的双轨。**
3. `ConversationLiveView` 已通过 `$conversationView` 订阅 controller 流式态——保留这个模式，把 `controller` 换成 `store.active.controller`。
4. 切换会话时**不要** `controller.clearTurn()` 旧会话——旧会话在后台仍需保留流式态；`clearTurn` 只在 `selectSession` 对**新**活动会话调用（registry 已保证 controller 隔离）。

---

## 6. 「首条消息才建会话」流程（方案 §6.1，必改）

当前 `createSession()`（ChatView 1020-1044）一点「新对话」就 `createDesktopSession` 立即落盘，会产生空 session。改为：

1. 点「新对话」→ `chatSessionStore.newConversationDraft()`：`activeKey=null`，进入草稿态，右侧显示空 composer + `BotSelector`（mode="select"）。不调任何创建接口。
2. 草稿的 Bot 默认值（方案 §6.2）：上一次成功发送的 Web Bot（存 localStorage `molibot-desktop-last-bot`）→ 回退系统默认 Web Bot → 无可用则显示配置引导并禁用发送。
3. 首次 `send(text, files)`：
   - 若 `activeKey===null`（草稿态）：`const s = await createDesktopSession(endpoint, profileId)`；`registry.getOrCreate(profileId, s.id)`；`registry.setActive(profileId, s.id)`；`entry.appendUser(...)` 或直接 `entry.controller.send({message, files})`；发送成功后写 `last-bot`，并把新 session 插入侧栏最近列表（`listDesktopConversations` 重新拉取或乐观插入）。
   - 若已有 session：`entry.controller.send({message, files})`（registry 已固定 profileId/sessionId）。
4. 已有会话的 composer 下用 `BotSelector mode="locked"`（方案 §6.3：Bot 不可改）。

`createDesktopSession` / `listDesktopSessions` / `loadDesktopSession` / `renameDesktopSession` / `deleteDesktopSession` 已存在于 `api.ts`，复用。

---

## 7. 侧栏数据与状态点接线

`ChatView` 持有：
- `expandedChannel = $state("web")`（默认展开对话，方案 §2.3）。五个互斥折叠组：点一个展开它、折叠其他；再点当前不折叠（`ChatSidebar` 已按此交互设计，`onToggleChannel` 里实现互斥）。
- `expandedItems = $state<DesktopConversationItem[]>([])`、`expandedHasMore`、`expandedLoading`。
- `expandedChannel` 变化时（`$effect`）调 `listDesktopConversations(endpoint, {channel: expandedChannel, limit:10})` 填充。
- 「更多对话」按钮（`hasMore` 或 `items.length>=10` 时显示）→ 打开 `ConversationBrowserDialog`，`onSelect` → `chatSessionStore.selectSession(item.botId, item.sessionId)`（web）或 `openExternalTranscript(item.sessionId)`（外部，`readOnly`）。注意外部 `botId` 是 instanceId，不是 profileId——外部会话打开走既有 `openExternalTranscript`（读 `/api/desktop/external-sessions/[id]`），不经 registry。
- 渠道列表：5 个 `ChannelDescriptor`。`configured` 来自 `channelSummary`（既有）+ web profiles。未配置渠道仍显示，展开后给「前往设置」（`ChatSidebar`/`ChannelAccordion` 已实现 `onConfigure`）。
- 状态点：`ChatSidebar` 的 `statusDots` 传 `chatSessionStore.statusDots`（`Map<profileId:sessionId, SessionStatusDot>`）。外部渠道 `readOnly`，`ChannelAccordion.dotFor` 已对 readOnly 返回 null。
- 默认选中（方案 §2.3）：首次进入 Chat，展开「对话」+ 自动选中最近一条普通会话；无历史则进草稿态。从项目/自动任务/技能返回保留上次展开渠道与选中会话。

渠道/Bot 命名：web 用 profile name（「Bot」），外部用 instance name；界面不出现 Web Profile/Agent/Profile ID/Agent ID（方案 §3.2）。`DesktopConversationItem.botName` 已是展示名。

---

## 8. 重连与状态恢复（方案 §11）

`ChatView` `onMount`（或 service ready 后）：
1. `await listDesktopSessionRuns(endpoint)` → `registry.restoreFromRuns(runs)`。
2. 对返回的 `restoredKeys`：每个 entry `reloadFromServer()` 拉取最新转录（方案 §11.2：不重放断线期间 token，直接加载持久化消息）。
3. 启动轮询（建议 3–5s）：再次 `listDesktopSessionRuns`，与上次比对——消失的 run：若其 entry 非活动，置 `status` 为 `completed`/`failed`（未读点）；活动的直接 `reloadFromServer` + 清状态。**状态必须来自 runs 表/approval broker，不能只凭前端内存。**
4. 审批恢复：`session-runs` 的 `waitingApproval=true` → 该 entry `status="waiting"`（侧栏黄点）；用户打开该会话时，`ChatApprovalCard` 读 `entry.controller.pendingApproval`（若 controller 内存里没有审批卡片，需调 `/api/desktop/host-bash` GET 取 pending 并回填——见下文待确认点）。

**待确认点**：断线重连时若审批卡片不在 controller 内存，如何恢复 `pendingApproval`。`/api/desktop/host-bash` GET 返回 pending 列表（`HostBashApprovalRecord`，含 `sessionId`）。需在 `restoreFromRuns` 后，对 `waitingApproval` 的会话用 host-bash pending 构造 `DesktopApprovalPrompt` 写入 `entry.controller.pendingApproval`（该字段是 `$state`，可直接赋值）。新会话实现时确认 `HostBashApprovalRecord` → `DesktopApprovalPrompt` 的映射（参考既有 host-bash 审批 SSE 事件 → `DesktopApprovalPrompt` 的转换，在 `conversationTurn.ts` / SSE handler 里）。

---

## 9. 验收标准（方案 §16）+ Slice 4 对抗式清单

重接完成后必须满足：
- 左侧栏无水平渠道切换条、无 Bot 二级折叠树；五个渠道组始终只展开一个。
- 默认展开「对话」并打开 Web 最新普通会话；最近列表跨 Bot 聚合且最多 10 条。
- 「更多对话」可按 Bot 分组、搜索、分页；Web Profile 在聊天界面统一显示为 Bot。
- Bot 只能在首条消息前选择；不同 Session 真实并行；同一 Session 仍串行+独立队列。
- 后台 Session 可审批/停止/恢复；状态点不串到其他 Session；外部渠道只读。
- 自动任务/项目/诊断 Session 不进入列表。
- 中英、明暗、窄窗口均可用；新增持久化测试用临时 DB/可注入 store。

**Slice 4 对抗式审查重点**（方案 §15）：
1. 快速切换 Session 时 SSE 是否串线（A 的 token 写进 B）——registry 固定 controller 应已根治，但要实测。
2. 删除/重命名 Bot 后历史会话是否丢失（已删除 Bot 分组、稳定颜色）。
3. 断线重连后运行状态是否虚假（必须查 `session-runs`，不能凭内存）。
4. 多 Session 审批/停止是否作用到错误目标（`stop`/`resolveApproval` 必须显式走活动 entry 的 controller）。
5. 分页期间会话更新是否重复/遗漏（游标 `updatedAt+sessionId`，已在 Slice 1 测过）。
6. 未发送附件是否因切换会话丢失（草稿按 session 隔离；File 仅内存，重启提示重选）。
7. 旧 Session 是否被错误分类进普通聊天（`purpose` 过滤）。
8. 当前会话完成时是否错误显示未读绿点（`nextTurnStatus` 活动会话置 idle，已测）。

文档：完成后更新 `prd.md`、`features.md`、`CHANGELOG.md`、`README.md`（Slice 1/2 已更新 features/CHANGELOG；Slice 3 完成后补；Slice 4 收尾全量）。

---

## 10. 必读 Gotchas

- **legacy `$:` ≠ runes `$state`**（见第 5 节）。新组件全 runes；ChatView 迁 runes 或经 store 桥接。
- **controller 必须固定**：registry 已保证 host.profileId()/sessionId() 返回固定值。**禁止**再引入「读活动会话」的 host adapter。
- **外部会话只读**：不经 registry、不显示输入框/状态点/重命名/删除。打开走 `openExternalTranscript`（`/api/desktop/external-sessions/[id]`）。
- **外部 Bot 身份**在 `externalUserId`（`bot:<instanceId>:chat:...`），不在 conversation.id（UUID/base64url）。后端已用 `parseBotInstanceId` 解析，前端 `item.botId` 即 instanceId。
- **草稿仅内存**：`File` 不可持久化；重启后提示重选附件（方案 §10.3）。
- **`IosSwitch`**：所有开关用 `$lib/components/ui/ios-switch` 的 `IosSwitch`，不要用 generic `Switch`（CLAUDE.md）。
- **语义 CSS / Geist**：desktop 走 `DESIGN.vercel.md`（Geist），单蓝 `--accent`；新组件已用 `--accent`/`--fill`/`--border`/`--danger`/`--warning`/`--success` 等 token，避免裸 Tailwind。
- **测试约束**：持久化测试用临时 DB/可注入 store（AGENTS.md）。registry 是 runes，无法 `node --test` 跑；其纯逻辑（statusDot/draftStore）已单测；registry 行为靠 `svelte-check` + 真实界面验收。
- **i18n**：新标签需加中英（见下）。

---

## 11. 待加 i18n 标签（`apps/desktop/src/lib/i18n.ts`）

组件已引用这些 key（`copy.*`），需在 `translator()` 的中英对象里补齐（部分可能已存在，先 grep 确认）：

- 侧栏/状态点：`running`、`waitingApproval`、`completed`、`failed`、`more`（更多对话）、`emptyWeb`（暂无对话）、`emptyExternal`（暂无外部会话）、`notConfigured`（尚未配置）、`goToSettings`（前往设置）。
- Bot 选择器：`bot`（Bot）、`chooseBot`（选择用于本次对话的 Bot）、`botLocked`（Bot 在发送第一条消息后不可更改）。
- 浏览弹窗：`searchConversations`（搜索会话）、`searchEmpty`（未找到会话）、`loadingMore`（加载中…）、`loadMore`（加载更多）、`deletedBot`（已删除的 Bot）、`unknownBot`（未指定 Bot）。

既有可复用：`newChat`、`projects`、`autoTasks`、`skillsSquare`、`appName`、`externalSessionReadOnly`。

---

## 12. 建议执行顺序

1. 先跑 `corepack pnpm --dir apps/desktop run check` 与 `node --import ./scripts/register-loader.js --import tsx --test apps/desktop/src/lib/chat/sessionStatusDot.test.ts apps/desktop/src/lib/chat/sessionDraftStore.test.ts` 确认基线绿。
2. 新建 `chatSessionStore.svelte.ts`（第 4 节），先不接 UI，`svelte-check` 过。
3. 把 `ChatView.svelte` 迁 runes + 拆 `ChatHeader`/`ChatApprovalCard`/`ChatSearchOverlay`/`ChatComposer`/`ChatOnboarding`/`FilePanel`（第 3 节），每拆一块 `svelte-check` + 手动点一遍。
4. 接侧栏：用 `<ChatSidebar>` 替换旧侧栏 markup，接 `chatSessionStore` + `listDesktopConversations` + 状态点 + 默认选中。
5. 接「首条消息才建会话」流程（第 6 节）+ `BotSelector`。
6. 接「更多对话」弹窗 + 重连恢复（第 7、8 节）。
7. i18n + 明暗/中英/窄宽适配。
8. Slice 4 对抗式审查（第 9 节）+ 文档。

每步小步提交，保持 `svelte-check` 与 `chat-ui.test.mjs` 绿。
