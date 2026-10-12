# Handoff — Pi 1.0 能力补齐 Spec 实施

日期：2026-10-11。分支：`master`（**未提交任何改动**）。

## 一句话状态

按 `docs/requirements/pi-capability-completion-spec.md` 推进四个单元：**A 已按规格收尾**，**B 已交付首片并补齐本地端到端协议验证**，**C 已交付首片（部分交付）**，**D 已交付首片（真实运行状态 + 明确不支持报错）、双向 IPC / executeTool、modelRegistry 发现/分类/图片、流式 chat 与只读 sessionManager（部分交付）**。所有改动留在工作区未提交，等用户统一验收。用户要求继续时不要擅自 commit（见下“用户约定”）。

## 必读入口（不要重复阅读/复述）

- 规格与**交付记录/未验收清单**（状态唯一权威）：`docs/requirements/pi-capability-completion-spec.md`（第 5 节起的「交付记录」逐条列了 A/B/C/D 的已交付与未验收）。
- 交付明细：工作区根目录的 `features.md`（顶部若干条：A 首片 / A 补全 / A 收尾 / MCP OAuth / Codemode 模型 API）、`CHANGELOG.md`、`prd.md` 的「Pi 1.0 能力补齐」段。
- 能力矩阵（四态）：`docs/requirements/personal-assistant-capability-matrix.md`（Durable Execution 行、Generic Skill/MCP seam 行已更新）。
- 仓库规则：`AGENTS.md`（分层职责、文档职责、验证约定），`docs/reference/CONTEXT.md`（领域词汇）。

## 各单元现状（细节以规格交付记录为准）

### A 普通任务恢复 — 已按规格收尾（Desktop 核对文案已补）
关键代码：`src/lib/server/app/piRecovery.ts`（`inspectPiRecovery` 分类 + `uncertainCallIds`）、`src/lib/server/app/runtime.ts`（启动协调器、`resumePiRecoveryOwner`、`failPiRecoveryReview` Decision Request、`onApprovalResolved` 续跑）、`src/lib/server/app/backgroundConversation.ts`（按 `assistantSourceEntryId` 幂等记录）、`src/lib/server/agent/core/turnOrchestrator.ts`（`markRunForRecoveryReview` / `abortRunningTurnsForSession` 含 `recovery_review`）、`src/lib/server/agent/tools/sideEffectClassification.ts`（`isReplaySafeTool`）、`src/lib/server/agent/durable/piConversation.ts`（`assertRecovery` 支持 `approvedRecoveryCallIds`）、`src/lib/server/agent/core/piRunSession.ts` + `types.ts`（`MomContext.approvedRecoveryCallIds` 透传）、`agent/tools/index.ts`（`wrapWithToolRuntime`/`toAgentTool` 设置 `replay: "safe"`）。

A 已补 Room review 入口（本会话，方向 A）：`RoomService.parkNativeRecovery` 把 Room 执行停在 `waiting_approval` + `approvalId=recovery-review:<runId>`，run 标 `recovery_review`；批准经 `onApprovalResolved` → `resumeNativeExecution`（守卫接受 `waiting_approval`）续跑，拒绝/过期 `failNativeRecovery`；请求 `actorId` 对 Room 用 agent 身份；`rooms/runtime.ts` 透传 `approvedRecoveryCallIds`（不重放）。测试：`rooms/service.test.ts` 新增 1 项。

A 剩余：Room review 真实运行时装线端到端测试；Desktop 专用「等待核对」文案（`ChatView` + i18n，已补）；Web（若有）仍通用；`failPiRecoveryReview`/`onApprovalResolved` 运行时装线无端到端测试。

### B MCP OAuth — 首片
关键代码：`src/lib/server/settings/mcpAuth.ts`（共享 auth 解析）、`settings/schema.ts`（`McpServerAuthConfig`）、`settings/sanitize.ts` / `store.ts` / `defaults.ts`（三处 sanitizer 都调 `resolveMcpAuthConfig`）、`src/lib/server/agent/mcp/oauthStore.ts`（0600 受保护凭据、按 serverId+URL+授权服务器隔离）、`agent/mcp/oauth.ts`（Pi 公共 OAuth 封装）、`agent/mcp/oauthRuntime.ts`（单例）、`agent/tools/mcp.ts`（`adaptOAuthProvider` 接入 + 状态）、`src/routes/api/settings/mcp/+server.ts`、`src/routes/api/desktop/mcp/+server.ts`、`src/routes/settings/mcp/+page.svelte`（Web UI）。

B 已补端到端（2026-10-11，本会话）：新增 `agent/mcp/oauth.e2e.test.ts`，用进程内 OAuth 授权服务器 + 本地 Streamable HTTP MCP 资源跑通 discovery/注册/PKCE S256/state/RFC 9207 iss/刷新/step-up 提示/元数据覆盖/双账号隔离/退出删除/重启/注册表登录后重连。顺带修两个根因：①授权码交换未复用 `authServerMetadataUrl`（二次 discovery 可能指向错误 AS）；②已结算/取消的登录尝试滞留 pending，退出/删除后状态回显过期 `error` 而非未授权（`oauth.ts`：成功即删、`dropLogin`）。`McpToolRegistry` 增加可注入 OAuth manager 测试接缝（`mcp.ts`）。

B 已补 Desktop 原生 OAuth 控件（2026-10-11，本会话）：`apps/desktop/src/lib/settings/McpSection.svelte` + `stores/mcp.svelte.ts` + `api.ts`。编辑器可选 headers/oauth 并配置元数据地址/客户端名，列表显示授权状态 + 登录/重新授权/退出，登录经 Tauri `open_external_url` 打开系统浏览器并轮询结算后共享重连。后端 `/api/desktop/mcp` 的动作与摘要字段此前已就绪，本次只接前端；顺带修好 MCP UI 守卫里过期的 `removeMcpServer` 断言。

B 已修重新授权 scope 保留（2026-10-11，本会话）：`oauth.ts` 的 `beginLogin` 现在向授权请求与授权码交换传「已授予 ∪ 服务端声明默认」并集 scope；新增 e2e 用例并把修复前的失败验证为真（去掉修复即失败）。

B 已补回调与 step-up 单元验证（2026-10-11，本会话）：`oauth.e2e.test.ts` 新增回调 host 契约（注入 `listenCallback`，断言 redirect_uri 取自监听器、不硬编码 loopback）与 step-up 并集 scope（`adaptOAuthProvider` 请求「已授予 ∪ 被要求」）。这两项**只验证已实现的接缝/契约**：远端公网回调（无公共回调基址配置）与传输自动续权（仅安全暂停）仍未实现。

B 仍未完成（规格列全）：远端 Web 公网回调（当前 loopback）；传输触发 step-up 的自动续授权（当前安全暂停并提示）；真实第三方授权服务器/账号验收（需真实服务与账号）；原生桌面冷启动/首次授权走查（需构建 Tauri 或中断服务）。

### C Codemode 模型 API — 首片
关键代码：`src/lib/server/agent/models/modelOperations.ts`（共享 `ModelOperations`：catalog/classify/generateImages + authorize/beforeCall/onUsage）、`agent/tools/codemode.ts` + `scripts/runtime/codemode-worker.mjs`（`models.list/classify/generateImages` 全局 + `image()` 输出回传）、`agent/tools/index.ts`（`modelOperationDeps`）、`agent/core/runner.ts`（预算/用量接入，Plan/只读下不可用）。

C 已补大图不内联（本会话）：超 700k 字符的生成图片不再内联 base64，改为文本制品引用（`inlineOrReferenceImages`），小图仍内联；精确 `ref` 因沙箱 `image()` 丢弃仍待补。

C 未完成：真实 Runner 端到端（真实分类/图片 Provider、多图、参考图、伴随文本、并发/恢复/取消）；大图**精确**制品引用；图片经媒体任务/制品服务的来源归属；模型调用走现有审批卡（当前 authority+budget+usage）。

### D Pi 扩展运行接口 — 首片
生产路径是 `scripts/runtime/untrusted-pi-extension-worker.mjs` + 主进程 IPC handler（`src/lib/server/plugins/piExtensions/processClient.ts` / `toolBridge.ts` / `eventBridge.ts` / `commandBridge.ts`）。**不要只改 `src/lib/server/plugins/piExtensions/context.ts`**（未被生产调用）。

**首片（本会话）**：worker 的 `ExtensionContext` 从 `input.runtime` 读取真实 `cwd`/`systemPrompt`/`model`/`thinkingLevel`/`scopedModels`/`isIdle`/`hasPendingMessages`/`getContextUsage`/`getSystemPrompt`；未接线的 `sessionManager`/`modelRegistry` 命名抛错，`abort`/`compact`/`shutdown` 明确抛错。主进程接缝：`plugins/piExtensions/runtimeSnapshot.ts`（`buildPiExtensionRuntimeSnapshot`）+ `types.ts` 快照类型；工具路径经 `createMomTools.piExtensionRuntime` → `createPiExtensionTools.runtime`；`runner.ts` 从 `PiRunSession.state`/`renderedSystemPrompt`/`pendingMessageCount()` 组装。测试：`runtimeSnapshot.test.ts`、`runtimeContext.test.ts`（真实子进程 fixture 扩展）。

**双向 IPC + executeTool（本会话）**：`processClient.ts` 加 worker→主机请求通道（`registerHostSession`/`releaseHostSession` 按 token 路由），worker 加 `hostRequest` + `ctx.executeTool()`（经共享 ToolRuntime；未知工具/主机失败返回 `isError`），`toolBridge.ts` 每次调用注册/释放 host session 并透传 `hostToken`。`createMomTools` 用与模型相同的可调用工具集解析，`runner.ts` 的 `runNestedToolCall` 复用（无 runner 改动）。测试：`executeTool.test.ts`（4 项）。

**modelRegistry（本会话）**：worker 的 `ctx.modelRegistry` 从快照目录同步发现（getAll/getAvailable/find/findOfType/getModelsOfType/getModelOfType/hasConfiguredAuth/getProviderDisplayName/isUsingOAuth），`classify`/`generateImages` 经双向 IPC 走共享 `ModelOperations`；凭据/Provider/注册/`stream`/`streamSimple`/`complete` 明确拒绝。新增 `modelCatalog.ts`（只暴露 provider/id/name/api + 可用性）；`toolBridge` host session 增 `modelRegistry.classify`/`generateImages` 分发，接 `codemodeModels`。测试：`modelRegistry.test.ts`(3)、`modelCatalog.test.ts`(2)。

**流式 chat（本会话）**：新增 worker↔主机推送通道（`hostEvent`；`processClient` 有 256KB 事件上限、超限失败流），worker 的 `ctx.modelRegistry.stream`/`streamSimple`/`complete` 把事件暴露为 pi 形状的可异步迭代流 + `result()`；主进程 `runner.ts` 的 `extensionModelStream` 用 `getPiModels()` 跑 provider 流并复用 authority/预算/用量（与 Codemode 同路径）；`toolBridge` 每个流一个 `AbortController`，`modelRegistry.streamAbort` 取消。测试：`modelStream.test.ts`(5)。

**只读 sessionManager（本会话）**：worker 的 `ctx.sessionManager` 从快照读身份（getCwd/getSessionId/getSessionFile/getSessionDir/getSessionName/getHeader）、记录（getLeafId/getLeafEntry/getEntry/getEntries/getBranch/getTree/getLabel/getEntries/buildContextEntries/buildSessionProjection）；条目来自原生 durable 活跃上下文，每条带 `message` + `messages`，每次调用刷新（`PiRunSession.extensionSessionSource` → `PiConversationRuntime.context()`）。durable 记录无 parentId/timestamp，线性日志。测试：`sessionSnapshot.test.ts`、`runtimeSnapshot.test.ts` 增断言。

**tools / abort（本会话）**：`ctx.tools` = 与模型相同的可调用工具目录（`createMomTools.toolCatalog` → invokeTool input → worker）；`ctx.abort()` 经双向 IPC（`extensionAbort` → `PiRunSession.abort`，任何模式可用）；忽略取消的扩展被安全终止、fault 上报。测试：`executeTool.test.ts` 7 项。

**compact + 事件路径（本会话）**：`ctx.compact()` → `extensionCompact` → `PiRunSession.compact`（Plan/只读不可用）；新增 `runHost.ts` 按 run 注册扩展宿主，`createMomTools` 注册，`eventBridge` 用它给事件处理器传真实快照 + `ctx.tools` + host session（事件里可 executeTool/stream/分类图片）。测试：`executeTool.test.ts` 9 项、`eventBridge.test.ts` 9 项。

**仍未支持**：`ctx.signal`、命令（slash command）路径（无 run 上下文）、跨作用域拒绝（当前由快照天然限定）、真实扩展宿主端到端。验收：真实扩展宿主加载 fixture 扩展。

## 本会话新增的测试（都在工作区，未提交）

- A：`src/lib/server/app/piRecovery.classification.test.ts`、`piRecovery.ordinary.test.ts`、`piRecovery.windows.test.ts`、`src/lib/server/agent/core/piRecovery.continuity.test.ts`、`agent/core/recoveryReview.test.ts`、`agent/tools/replaySafety.test.ts`；fixture：`evals/fixtures/pi-runner-ordinary-worker.ts`、`evals/fixtures/pi-tool-window-worker.ts`。
- B：`src/lib/server/agent/mcp/oauthStore.test.ts`、`agent/mcp/oauth.test.ts`、`settings/mcpAuth.test.ts`；并改 `settings/store.test.ts` 的 round-trip 加入 oauth 服务器。本会话新增 `agent/mcp/oauth.e2e.test.ts`（本地 OAuth/ MCP 服务器，10 项），并扩展 `src/routes/settings/mcp/mcp-ui.test.mjs` 的 Desktop OAuth 守卫（4 项，含修好此前失败的 `removeMcpServer` 断言）。
- C：`src/lib/server/agent/models/modelOperations.test.ts`；`agent/tools/codemode.integration.test.ts` 新增模型接口与 replay-safe 断言。
- D：本会话新增 `plugins/piExtensions/runtimeSnapshot.test.ts`（4 项）、`runtimeContext.test.ts`（真实子进程 fixture 扩展）、`executeTool.test.ts`（4 项双向 IPC / executeTool）、`modelRegistry.test.ts`（3 项）、`modelCatalog.test.ts`（2 项）、`modelStream.test.ts`（5 项流式 chat）与 `sessionSnapshot.test.ts`（1 项只读会话）。

## 验证命令与已知既有失败

- 类型检查：`corepack pnpm run check`。**既有失败**（非本次改动）：`src/routes/api/desktop/conversations/+server.ts:50` `latestConversationByAgent` 类型错误。
- Svelte/桌面：`corepack pnpm run desktop:check`（0 error，1 既有 warning）。
- 构建：`corepack pnpm run build`。
- 测试组：`test:service-bootstrap`(21)、`test:desktop-chat`(303)、`test:projects`(86)、`test:decision`(50)。**既有失败**：`src/routes/settings/mcp/mcp-ui.test.mjs` 的 desktop MCP 断言（HEAD 组件已用 `removeMcpServer(id)`，测试仍期望 `removeMcpServer(server.id)`），与本次无关。
- 单测运行方式：`node --import ./scripts/register-loader.js --import tsx --test <files...>`。

## 关键坑与约定（省得重新踩）

- **forked fixture 必须设全数据目录 env**，否则 `dataDirScope` 抛错：`DATA_DIR`、`DB_DIR`、`SETTINGS_DB_FILE`、`SETTINGS_FILE`、`WEB_WORKSPACE_DIR`、`SESSIONS_DIR`、`SESSIONS_INDEX_FILE`、`PI_CODING_AGENT_DIR`（放在 `DATA_DIR` 内）。
- **PiRunSession 的 `beforeToolCall` 是构造参数，不是 `bindRun` 的字段**；放错不会报错，只会静默不触发 barrier。
- 三窗口 fixture 用受控 barrier + SIGKILL；`external-success` 窗口靠 tool `execute` 内 barrier，`intent 前`/`结果提交未投影` 靠 `beforeToolCall` barrier。
- `AgentTool.replay === "safe"` 由 `isReplaySafeTool` 派生：只对纯读取（含 `grep`/`find`/`ls`/`conversation_search` 别名）；写入/命令/第三方/`codemode`/`subagent` 不安全。改这里会影响 Pi 恢复的 `assertRecovery`。
- 工作区有**大量他人未提交改动**（约 150 modified + 数个 untracked）。不要回退或整体重排；只改自己相关的文件。
- 文档改动按 `AGENTS.md` 的文档职责同步（features/prd/CHANGELOG/能力矩阵/spec 交付记录）。

## 用户约定

- 语言：中文。
- **不要 commit**，用户明确说“改动完成后我统一验收”。
- 用户重视诚实与证据：每单元交付要说明“未验收项”，不要夸大。
- 下一步由用户决定方向，历史选择顺序是 A →（B、C 首片）→ 收尾 A → 补 B 端到端（协议验证 + Desktop 控件 + scope 保留）→ D 首片（本会话完成）。D 下一步可做：真实 abort/compact / `ctx.tools` 工具目录 / 事件与命令路径快照（对齐工具路径）/ 跨作用域拒绝 / 扩展崩溃-忽略取消端到端；或 C 端到端；B 剩余需真实账号或远端回调。

## suggested skills（下一个 agent 用 Skill 工具加载）

- `implement` — 继续按 spec 交付（实现 + 验证 + 收尾），本会话即用它。
- `tdd` — 在预商定的接缝上测试先行；B/C/D 的端到端验收适合。
- `code-review` — 交付前按仓库标准对抗式审查（文档同步、能力矩阵、验证证据）。
- `agent-runtime-debug-review` — 涉及队列/停止/恢复/子代理/审批挂起恢复等运行时缺陷时。
- `diagnosing-bugs` — 遇到难以复现的恢复/竞态问题时。
- `doc-standards` / `doc-lifecycle` / `prose-standard` — 更新 `features.md`/`prd.md`/`CHANGELOG.md`/规格与注释文案时。
- `commit` — **仅当用户明确要求提交时**使用（当前禁止）。
- `handoff` — 再次交接时。
