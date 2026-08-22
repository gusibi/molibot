# Mini App 消息动作（Message Actions）技术方案

> 状态：✅ 已实施（2026-08-06，Phase 1 + Phase 2，最低 Molibot 2.9.8）
> 前置阅读：`AGENTS.md`、`CLAUDE.md`（尤其 Recurring Pitfalls #2/#6/#7/#11/#13/#19）、`docs/requirements/miniapp-platform-implementation-plan.md`
> 交付纪律：完成后按仓库规则更新 `features.md` 与 `CHANGELOG.md`，验证方式遵循 pitfall #9/#10。

## 1. 背景与目标

主程序与 Mini App 之间现有三条缝，全部经过 `MiniAppHost`（唯一跨越缝）：

1. Agent 工具：`miniapp__<appId>__<tool>`，由模型决定调用；
2. `@app` 选择器路由（`src/lib/server/miniapps/invocation.ts`）：用户显式指定 App，参数仍由模型组织；
3. App 自有 UI 的 HTTP 通道：`/miniapps/<app-id>/api/*`（`httpRoute.ts`）。

本方案新增**第四条缝：宿主 UI 直接发起的、确定性的、不经过模型的工具调用**。首个用例：在 Chat 页 AI 消息的操作区增加一个"发送到小程序"菜单（例如"添加到收藏夹"），点击后把消息内容以标准化负载直接写入目标 App。

用户点击本身就是显式意图，不存在参数幻觉、不存在"把工具调用写成散文"（pitfall #19 那一族问题在此路径上按构造不可能发生）。

### 目标

- Manifest 新增通用的 `contributions.messageActions` 贡献点——**不为"收藏夹"写死任何东西**，任何 App 都可声明自己的消息动作（pitfall #7：共享组件不含 App 专属条件分支；pitfall #19 corollary：宿主侧不得点名某个 App 的字段）。
- 宿主定义统一的"捕获负载"契约（`MessageCaptureContext`），所有 App 共享同一形状。
- 桌面 Chat 的 AI 消息操作区渲染所有已安装 App 声明的动作；点击走新的宿主 API 直接调 `MiniAppHost.invokeTool`。
- 成功/失败都必须对用户可见（pitfall #12 corollary："按钮按了没反应"是最坏的失败形态）。

### 非目标（本期不做，勿顺手实现）

- 反方向缝（App 面板发起对话、App 作为上下文提供者、App 声明定时任务）；
- "整理后收藏"（先经一轮 Agent 提炼再写入）的变体；
- 渠道侧（飞书/Telegram）的同类动作；
- 收藏夹 App 本身（用户会用 `miniapp-creator` 单独创建；本方案只提供平台能力）。

## 2. 契约设计

### 2.1 Manifest：`contributions.messageActions`

```jsonc
{
  "manifestVersion": 1,
  "id": "favorites",
  "engines": { "molibot": ">=2.9.8" },
  // ...既有字段...
  "contributions": {
    "messageActions": [
      {
        "tool": "add",                 // 必须是本 manifest tools[] 里已声明的工具名
        "label": { "zh": "添加到收藏夹", "en": "Save to Favorites" },
        "icon": "star"                 // 可选，Phosphor 图标名（不含 ph- 前缀）
      }
    ]
  }
}
```

校验规则（在 `src/lib/server/miniapps/manifest.ts` 的发现期校验中实现，与既有风格一致——发现期整 App 失败，而不是调用期半途失败）：

- `contributions` 加入 `ALLOWED_TOP_LEVEL_KEYS`；`contributions` 对象内部同样白名单校验，未知 key 报错。
- `messageActions` 为数组，最多 3 条（菜单是稀缺位，防止单 App 刷屏）。
- 每条的 `tool` 必须存在于 `tools[]`，且**不得**是 `destructiveHint: true` 的工具（菜单一键触发破坏性操作不可接受）。`readOnlyHint` 工具允许但无意义，不禁止。
- `label` 必须含 `zh` 与 `en` 两个非空字符串；`icon` 可选、须匹配 `/^[a-z0-9-]+$/`。
- 被引用工具的 `inputSchema` 必须能接受 §2.2 的负载：**要求其 schema 对 `capture` 属性无冲突**——具体判定为：schema 是 object 且（`additionalProperties` 不为 `false`，或 `properties` 中显式声明了 `capture`）。校验失败时错误信息要说清怎么改。

**版本兼容说明（写进 `skills/miniapp-creator/reference.md`）**：manifest 校验是严格白名单，旧宿主遇到 `contributions` 会整 App 拒装——这是刻意的。因此声明了 `contributions` 的 App 必须同时把 `engines.molibot` 提到支持该字段的最低宿主版本，让失败发生在语义清晰的引擎检查处。

### 2.2 捕获负载：`MessageCaptureContext`

宿主拥有、全 App 共享的标准形状。新建 `src/lib/server/miniapps/messageActions.ts`（类型 + 构造函数 + 动作查询辅助）：

```ts
/** Host-owned capture payload. Shared by every app; never app-specific. */
export interface MessageCaptureContext {
  /** Raw markdown of the captured message. */
  text: string;
  /** User-selected fragment, when the click happened with an active selection inside the message. */
  selection?: string;
  role: "assistant" | "user";
  /** ISO-8601 capture time (host clock). */
  capturedAt: string;
  source: {
    /** Session display title, when available. Never the session key/ID. */
    sessionTitle?: string;
    /** e.g. "desktop" */
    channel: string;
  };
}
```

调用时宿主构造 `{ capture: MessageCaptureContext }` 作为工具 input。App 侧工具 handler 签名不变（走既有 `invokeTool` 的 Ajv 校验 + handler 路径）。

**隐私边界（pitfall #6）**：负载里只有会话*标题*，绝不放 session key、conversation UUID、host 路径。文本上限 64 KiB，超长截断并在负载中带 `truncated: true`（加进接口定义）。

### 2.3 Catalog 投影

`MiniAppCatalogEntry`（`types.ts`）新增：

```ts
messageActions: Array<{ tool: string; label: { zh: string; en: string }; icon?: string }>;
```

由 host 从 validated manifest 投影（App 处于 `enabled && status === "active"` 之外时桌面端不展示，但 catalog 仍带字段）。

**pitfall #11 强制检查**：沿"manifest → host descriptor → catalog → 桌面 store（`apps/desktop/src/lib/stores/miniapps.svelte.ts`）→ UI"整条链路逐个投影补上新字段，任何一处手写枚举漏掉都会静默变成空菜单。优先用展开而非枚举；必须枚举处在对应单测里断言该字段。

## 3. 服务端实现

### 3.1 新 API 路由：`POST /api/miniapps/invoke`

新建 `src/routes/api/miniapps/invoke/+server.ts`。请求体：

```ts
{ appId: string; tool: string; capture: MessageCaptureContext }
```

处理顺序（每一步失败都返回结构化 JSON 错误，复用 `miniAppErrorResponse` 风格）：

1. 解析并做基本形状校验（`capture.text` 必须是非空 string——pitfall #26(d)：副作用前先校验）。
2. `getMiniAppHost().listCatalog()` 找到 App，要求 `enabled && status === "active"`。
3. **要求 `(appId, tool)` 出现在该 App 声明的 `messageActions` 里**——此路由只暴露被显式贡献的工具，绝不做通用任意工具调用面（否则等于给 WebView 开了一个绕过 Agent 审批链的全量工具后门）。
4. 服务端重建权威负载：`capturedAt` 用服务器时钟覆写、`channel` 覆写为请求来源、执行 64 KiB 截断——客户端给的这些字段不可信。
5. 调 `host.invokeTool("miniapp__<appId>__<tool>", { capture }, context)`，`context` 与 `toolAdapter.ts` 里 Agent 路径传的 `MiniAppToolCallContext` 同构。
6. 成功返回 `{ ok: true, content, structuredContent }`——`content` 就是 App 已为人写好的一句话（如"已收藏：……"），桌面端直接展示，不二次加工。

**CSRF**：该路由是 JSON POST，不是 form 提交，不触发 SvelteKit 的 CSRF form 检查（pitfall #25 针对 multipart form）；不需要动 `csrf-trusted-origins.mjs`。不添加任何 CORS 许可头。

### 3.2 风险与审批的立场（写进代码注释）

Agent 路径上 Mini App 工具的风险由 manifest hint 推导并可能进审批链；本路由**不接**审批链，理由是用户点击即显式授权，且 §2.1 已在发现期禁止 destructive 工具成为消息动作。这不是绕过——是"审批的对象（用户意图）已经在场"。

## 4. 桌面端实现

### 4.1 UI 落点

`apps/desktop/src/lib/chat/ConversationTranscript.svelte` 的 `.message-actions` 区（现有 copy/edit/fork 按钮旁）。为保持共享组件干净（pitfall #7），transcript **不感知** Mini App：

- 新增 prop `messageActions?: Array<{ id: string; label: string; icon?: string; run: (msg) => Promise<{ ok: boolean; text: string }> }>`，由宿主页面（Chat 容器）注入——与既有 `attachmentActions` 注入模式完全一致。
- 动作 ≤2 个时直接渲染图标按钮；>2 个时收进一个 `ph-paper-plane-tilt`（或 `ph-plus-circle`）触发的小菜单。菜单是新的自绘 popover 时参考 `FileContextMenu.svelte` 的既有做法，不引第三方。
- 仅 assistant 消息展示（首期；user 消息留待后续）。
- 点击时若消息内有活动文本选区，取 `window.getSelection()` 填 `selection`。

### 4.2 数据流与反馈

- Chat 容器从 miniapps store 读 catalog，把每个 active App 的 `messageActions` 映射成上述注入形状；`label` 按当前语言从 `{zh,en}` 取（i18n 走 `apps/desktop/src/lib/i18n.ts` 惯例，菜单容器自身的固定文案要加词条）。
- **pitfall #2**：新代码用 runes；若 Chat 容器仍是 legacy `$:` 面，必须通过 store 订阅读 catalog，不得裸调用无参 helper。
- **pitfall #13**：Mini App 安装/启停后 catalog 会变，菜单来源必须吃同一份 settings 失效事件驱动的 store，不自建缓存。
- 请求中：按钮转圈（复用 `message-action-spin`）。成功：按钮短暂变 `ph-check` 并 toast 展示 App 返回的 `content` 文本。失败：toast 展示错误句（`invokeTool` 已保证是 sanitize 过的稳定句子），按钮恢复可重试。禁止静默失败。
- 样式：全部用语义 token（pitfall #4/#5/#24），图标尺寸用 `--icon-*`，不出现裸 px 字号。

## 5. 测试要求（先写失败用例再实现）

| 测试文件 | 断言 |
|---|---|
| `src/lib/server/miniapps/manifest.test.ts`（或就近既有套件） | `contributions` 合法通过；未知 contributions key 拒绝；`tool` 不存在拒绝；destructive 工具拒绝；缺 zh/en label 拒绝；>3 条拒绝；inputSchema 不容纳 `capture` 拒绝且错误信息含修法 |
| `src/lib/server/miniapps/messageActions.test.ts` | 负载构造：截断 + `truncated` 标记；无 session key/路径泄漏 |
| `src/routes/api/miniapps/invoke/server.test.ts` | 未声明的 (app,tool) 403；disabled/error App 拒绝；`capturedAt`/`channel` 被服务端覆写；成功透传 content；`capture.text` 非 string 时零副作用 |
| catalog 投影既有测试 | `messageActions` 字段在 catalog round-trip 中存活（pitfall #11） |
| `apps/desktop/src/chat-ui.test.mjs` | 结构守卫：transcript 通过注入 prop 渲染动作、不 import miniapps store；失败路径有可见反馈分支 |

## 6. 配套更新

- `skills/miniapp-creator/reference.md` 与 template：补 `contributions.messageActions` 章节、`capture` 参数示例 handler、engines 版本要求说明。`miniapp-creator` Skill 版本号 bump。
- 内置 `todo` App 可顺带声明一个 `messageActions`（如"存为待办"）作为活体示例——若做，遵循内置 App 的既有升级语义（不覆盖用户已删除/已改动的安装）。
- `features.md` + `CHANGELOG.md` 按 pitfall #9 格式记录验证结果。

## 7. 验收标准

1. 安装一个声明 `messageActions` 的 App 后，桌面 Chat 每条 AI 消息操作区出现该动作；点击后 App 数据落库、UI 面板（revision 轮询）可见新数据、消息旁出现成功反馈文本。
2. 服务重启后动作仍在（冷启动走查，pitfall #10：首开即测，不允许"第二次打开才出现"）。
3. 停用该 App 后菜单项即时消失（settings 失效事件驱动，无需刷新 WebView）。
4. 手工构造一个引用 destructive 工具的 manifest：App 在 Manager 中显示为 error，错误文案指明原因。
5. `svelte-check` 0/0、`vite build`、桌面 UI 测试、agent 侧 `tsc` + 相关套件全绿。

## 8. Phase 2：附件动作与选区动作（已确认需求，作为第二个 slice 交付）

Phase 1 验收通过后实施。两者共享 Phase 1 的全部基建（贡献点、invoke 路由、注入式 UI），只扩展契约与入口。

### 8.1 契约扩展

`messageActions` 每条新增可选字段 `accepts`（默认 `["text"]`）：

```jsonc
{ "tool": "add", "label": {...}, "accepts": ["text", "image"] }
```

`MessageCaptureContext` 新增：

```ts
resources?: Array<{
  kind: "image" | "file";
  name: string;
  mime: string;
  /** Path RELATIVE to the app's own dataDir (host stages a copy into `<dataDir>/incoming/`). */
  path: string;
  bytes: number;
}>;
```

**文件传递方式**：宿主把附件**复制**进目标 App 自己的数据目录（`miniapps/data/<appId>/incoming/<uuid>.<ext>`），负载里只传相对路径——App 的 dataDir 本来就归 App 读写，不产生新的路径越界面；工具调用是 in-process 的，不经 HTTP，1 MiB body 限制无关。staged 文件的生命周期归 App 管（用了就挪走或删掉）；宿主在 `incoming/` 超过 256 MiB 时按 mtime 淘汰并记 warn 日志。单文件上限 64 MiB。

### 8.2 入口

- **图片/附件右键**：`TranscriptAttachments` 已有 `attachmentActions` 注入位，把 `accepts` 含 `image`（或 `file`）的动作映射进去。典型场景：Agent 生成的图片右键 →"用 XX 编辑"→ App 面板打开即可处理该图。
- **选区动作**：消息文本上有活动选区时触发右键菜单，列出 `accepts` 含 `text` 的动作，`capture.selection` 填选中片段（Phase 1 已定义该字段）。同时把消息动作扩展到 user 消息（Phase 1 仅 assistant）。

### 8.3 测试补充

staging 复制的路径包含性与淘汰策略（`messageActions.test.ts`）；`accepts` 过滤逻辑（不含 `image` 的动作绝不出现在图片右键里）；invoke 路由对 `resources.path` 做**只读校验**——必须落在该 App dataDir 的 `incoming/` 内，防止客户端伪造路径让 App 读到别处（pitfall #6）。

## 9. 后续方向（见 `miniapp-platform-extension-roadmap.md`）

已交付：App 面板反向发起对话（Composer 桥 v1/v2）、AI 能力门面、结果卡片 / 深链 / 徽标（roadmap §2.3–2.5，2026-08-07）。

**结果卡片与本方案的关系**：消息动作的成功反馈原本只有 App 返回的那一句 `content`。现在工具结果可以附带一张 `card`，`/api/desktop/miniapps/invoke` 原样透传（宿主已 sanitize），桌面端在同一个反馈位渲染。`content` 仍是权威文本——卡片是桌面端的展示增强，缺席不构成降级。

未动工：渠道侧同构动作（§2.1）、App 作为 Agent 上下文提供者（§3.1）、App 声明定时任务（§3.3）。

> Archived: 2026-08-22 (delivered/superseded or never-started plan; see docs/requirements/ and features.md for current authority)
