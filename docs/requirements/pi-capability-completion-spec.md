# Pi 1.0 能力补齐 Spec

日期：2026-10-11。状态：范围与验证边界已确认；A（普通任务恢复）已按规格收尾（安全读取自动恢复、独立「等待核对」状态、三窗口强杀矩阵、核对后继续原执行、服务租约/预算专项验证），仅剩 Room review 入口与专用审阅卡片等小项；B（MCP OAuth）已交付首片、补齐本地端到端协议验证、Desktop 原生 OAuth 控件与重新授权的 scope 保留（仍缺远端回调、原生冷启动走查、step-up 自动续权与真实账号验收），C（Codemode 模型 API）已交付首片，D（Pi 扩展运行接口）已交付首片（真实运行状态 + 明确不支持报错）、双向 IPC / `executeTool`、`modelRegistry` 发现/分类/图片、流式 chat 与只读 `sessionManager`。用户已批准四项工作。实施顺序为可靠恢复优先，其余按依赖交付；这不是工作/生活助理能力已交付声明。

### 交付记录

- **A 首片（2026-10-11，部分交付）**：`src/lib/server/app/piRecovery.ts` 新增 `inspectPiRecovery`，按 Pi 正式 task 记录把 running owner 分类为 `resume` / `review` / `unavailable`；`runtime.ts` 启动协调器据此恢复安全断点、对未知远端请求/不可重放外部操作记录 `PI_RECOVERY_REVIEW` 事件并明确暂停，删除“只有 Deferred 才允许启动恢复”的限制；`backgroundConversation.ts` 按 `assistantSourceEntryId` 幂等记录答案。机器证据：`piRecovery.test.ts`、`piRecovery.classification.test.ts`、`piRecovery.ordinary.test.ts`（真实 Runner SIGKILL）、`backgroundConversation.test.ts`、service-bootstrap 21 项、desktop-chat 303 项通过。
- **A 补全（2026-10-11，部分交付）**：① **安全读取自动恢复**：`agent/tools/sideEffectClassification.ts` 新增 `isReplaySafeTool`，由共享副作用分类判定中断可重放；`createMomTools` 的 `wrapWithToolRuntime`/`toAgentTool` 对纯读取（`read`/`docExtract`/`webSearch`/`webFetch`/`skillSearch`/`profileFiles`/`switchModel`/`grep`/`find`/`ls`/`conversation_search`）设置 `replay: "safe"`，写入、命令、第三方工具与 `codemode`/`subagent` 仍不自动重放。② **等待核对独立状态**：`turnOrchestrator.markRunForRecoveryReview` 把未知外部操作的原执行置于非终态的 `recovery_review`（不再 `failed`），显式 Stop（`abortRunningTurnsForSession`）可清除；`DesktopSessionRunStatus` 与 Desktop 状态映射纳入该状态。③ **专项验证**：新增 `replaySafety.test.ts`（纯读取安全 / 写入与命令不安全 / 声明覆盖）、`recoveryReview.test.ts`（非终态、只清一次、Stop 清除）、`piRecovery.continuity.test.ts`（服务租约丢失在恢复起始即阻止首个 Provider 请求；运行预算按 `[workspace, chatId, budgetId]` 键跨重启保持，不同 run 起始预算隔离）、`codemode.integration.test.ts` 增加“安全读取标记 replay-safe”断言；父子任务与子会话复用、Room 撤权、预算/期限存储保持沿用既有回归（`piRunSession.test.ts`、`rooms/service.test.ts`、`runBudgetStore.test.ts`/`runtimeBudget.test.ts`）。
- **A 收尾（2026-10-11，部分交付）**：④ **三窗口强杀矩阵**：新增 `piRecovery.windows.test.ts` + `evals/fixtures/pi-tool-window-worker.ts`，从受控 barrier 触发真实 SIGKILL，覆盖 intent 前（tool `call` 阶段，重启后执行一次）、外部成功未提交（tool `execute` 阶段：不可重放→review 不重跑；可安全重放→重跑一次）、结果提交未投影（第一个工具已提交、第二个未开始，重启后已提交的不重跑、未开始的执行一次），用独立 ledger 计算真实执行次数；`inspectPiRecovery` 现返回 `uncertainCallIds`。⑤ **核对后继续原执行**：`review` 会经共享 Decision Request（`ApprovalBroker`，capability `recovery_review`）park 原执行（`recovery_review` 记录在启动扫描中保留），`onApprovalResolved` 在批准后把 run 置回 running 并原样续跑、拒绝/过期则中止并清理；`approvedRecoveryCallIds` 经记录 context → `MomContext` → `runPiOwner` binding → `PiConversationRuntime.assertRecovery` 透传，使人工确认过的未知工具按中断结算而不是被再次重跑。矩阵第 5 条即验证“确认后继续且不重放”。
- **A 剩余未验收**：Room 执行的 review 目前仍为终态失败（无 Decision Request 入口）；Desktop 已加专用「等待核对」卡片文案（`ChatView.svelte` 按 `command === "recovery_review"` 切换标题/说明，中英），Web 端若有审批卡仍为通用呈现；`failPiRecoveryReview` 与 `onApprovalResolved` 的运行时装线尚无端到端测试（由代码审查 + 批准后续跑矩阵覆盖）。
- **B 首片（2026-10-11，部分交付）**：`McpServerConfig` 新增显式 `auth`（`headers` | `oauth`，含 `authServerMetadataUrl` / `clientName`），sanitizer 统一经 `settings/mcpAuth.ts` 解析，选择 OAuth 时丢弃手工 `Authorization`；`agent/mcp/oauthStore.ts` 按 serverId+URL+授权服务器隔离的受保护凭据文件（0600）承接 Pi 的 `McpOAuthStateStore`；`agent/mcp/oauth.ts` 用 Pi 公共 OAuth 客户端提供状态、发起登录（loopback 回调）、取消、重新授权、退出与删除清理，不自行实现协议；`McpToolRegistry` 用 `adaptOAuthProvider` 接入 HTTP 传输，授权失败给出可操作提示，状态接口只回传状态不含 token；settings 与 desktop 的 MCP API 增加 `oauth_login`/`oauth_reauthorize`/`oauth_cancel`/`oauth_logout`；Web MCP 设置页增加授权状态与登录/重新授权/退出。
- **B 未验收**：真实 OAuth 授权服务器端到端（discovery/PKCE/state/issuer/刷新/追加 scopes）回归；Desktop 原生 MCP 设置页的 OAuth 控件与系统浏览器授权；远端 Web 公网回调（当前为 loopback）。机器证据：`oauthStore.test.ts`、`oauth.test.ts`、`mcpAuth.test.ts`、settings store 整对象 round-trip、mcp/desktopMcp 既有回归通过。
- **B 端到端验证（2026-10-11，部分交付）**：新增 `oauth.e2e.test.ts`，用本地进程内 OAuth 授权服务器 + 本地 Streamable HTTP MCP 资源跑通真实协议链路：discovery、动态客户端注册、PKCE S256（授权服务器端校验 verifier）、`state` 回显与错误 state 拒绝、RFC 9207 `iss` 校验、刷新（资源撤销 access token 后由 auth provider 刷新并重试）、step-up（403 `insufficient_scope` 明确给出可操作授权需求）、配置 `authServerMetadataUrl` 覆盖 discovery、同 URL 双账号隔离、退出/删除只清理自身、重启后凭据可用，以及登录完成后经既有 `McpToolRegistry` 重连并重新发现工具。同时修复两处根因：①授权码交换未复用配置的 `authServerMetadataUrl`，二次 discovery 在隐藏 discovery 或非默认端点时会指向错误授权服务器；②已结算/取消的登录尝试滞留 pending，使退出或删除后状态回显为过期 `error` 而非未授权。`McpToolRegistry` 增加可注入 OAuth manager 的测试接缝。机器证据：`oauth.e2e.test.ts` 10 项、既有 oauth/oauthStore/mcpAuth/store round-trip 29 项、`desktopMcp`/`desktopOpenConnector` 11 项、`mcp.test.ts` 20 项、工具相关 31 项通过。
- **B Desktop OAuth 控件（2026-10-11，部分交付）**：`apps/desktop/src/lib/settings/McpSection.svelte`、`stores/mcp.svelte.ts`、`api.ts` 补齐 Desktop 原生 OAuth：编辑器可选「请求头 / OAuth」并配置元数据地址与客户端名，列表显示授权状态与错误并提供登录 / 重新授权 / 退出；登录经 Tauri `open_external_url` 在系统浏览器打开授权链接，随后轮询直至结算并触发共享重连。复用既有 `/api/desktop/mcp` OAuth 动作与 `authMode`/`authState`/`authError` 摘要；空白元数据/客户端名保留已保存值。机器证据：MCP UI 守卫 4 项（含新增 Desktop OAuth 守卫，并修正此前失败的 `removeMcpServer` 断言）、Desktop UI 守卫 313 项、Desktop API 112 项、`desktop:check` 0 错误 1 既有警告。
- **B 追加授权保留 scopes（2026-10-11，已修复）**：`beginLogin` 现在向授权请求与授权码交换传入「已授予 scope ∪ 服务端声明的默认 scopes」的并集（`unionScope`），重新授权不再用默认 scope 覆盖并丢掉此前追加授予的权限。机器证据：`oauth.e2e.test.ts` 新增用例（先登录缓存 discovery/客户端注册 → 把已授予 scope 改为仅 `mcp.admin` → 重新授权断言 scope 同时含 `mcp.read` 与 `mcp.admin`）；移除修复该用例失败、恢复后 11 项通过。
- **B 回调与 step-up 单元验证（2026-10-11，部分交付）**：`oauth.e2e.test.ts` 增加两项：①回调 host 契约——注入 `listenCallback`（`OAuthCallbackServer.listen({ redirectHost })`），断言授权请求的 `redirect_uri` 取自监听器上报地址、未硬编码 loopback；②step-up 并集 scope——断言 Molibot 安装的 `adaptOAuthProvider` 遇 403 `insufficient_scope` 时请求「已授予 ∪ 被要求」并抛出 `McpOAuthAuthorizationRequiredError`（既有的传输级 403 用例继续覆盖可操作提示）。**远端公网回调与传输自动续权仍未实现**，因此只验证接缝与已实现契约，未验证公网可达或自动续跑。
- **B 端到端未验收**：原生桌面冷启动/首次授权走查（需构建 Tauri 或中断服务，未执行）；远端 Web 公网回调（当前 loopback，无公共回调基址配置）；传输触发 step-up 的自动续授权（当前安全暂停并提示，未自动打开浏览器续权）；真实第三方授权服务器/账号验收（需真实服务与账号，隔离实例手工走查）。
- **C 首片（2026-10-11，部分交付）**：新增共享 `agent/models/modelOperations.ts`：按类型返回模型目录与凭据可用性，`classify` 走 `models.classify`，`generateImages` 走 `models.generateImages` 并把图片落盘为工作区制品，每步经 `authorize` / `beforeCall`（预算前置）/ `onUsage`（收据）；`codemode.ts` 与 `codemode-worker.mjs` 注册 `models.list` / `models.classify` / `models.generateImages` 脚本全局接口（走与工具相同的 IPC/取消通道），`image()` 输出现已回传到工具结果；`createMomTools` 暴露 `modelOperationDeps`，Runner 在非只读、非 Plan 时按预算与用量接入，Plan/只读下模型接口不可用。
- **C 未验收**：真实 Runner 端到端（发现模型、分类、多图参考图与伴随文本、费用与 receipt 一次归属、并发归属、Deferred 轮询、重启复用已提交结果、取消传播、远端取消不支持说明）；大图制品引用传输；图片经现有媒体任务/制品服务的来源归属；模型调用走现有审批/Decision Request 入口（当前为 authority + budget + usage，未弹审批卡）。机器证据：`modelOperations.test.ts`、`codemode.integration.test.ts` 新增两条、codemode/runner 既有回归通过。
- **D 首片（2026-10-11，部分交付）**：给真正运行扩展的子进程 `scripts/runtime/untrusted-pi-extension-worker.mjs` 接入真实运行快照。新增 `plugins/piExtensions/runtimeSnapshot.ts`（`buildPiExtensionRuntimeSnapshot`，序列化 pi-ai `Model` 时剥离 headers）与 `types.ts` 的 `PiExtensionRuntimeSnapshot`；worker 的 `ExtensionContext` 现在从 `input.runtime` 读取真实 `cwd` / `systemPrompt` / `model` / `thinkingLevel` / `scopedModels` / `isIdle()` / `hasPendingMessages()` / `getContextUsage()` / `getSystemPrompt()`，未接线的 `sessionManager` / `modelRegistry` 是命名抛错代理，`abort()` / `compact()` / `shutdown()` 明确抛错（不再静默 no-op 或返回伪造成功）。工具路径经 `createMomTools.piExtensionRuntime` → `createPiExtensionTools.runtime` → worker 透传；`runner.ts` 由 `PiRunSession.state` + `renderedSystemPrompt` + `pendingMessageCount()` 组装快照。机器证据：`runtimeSnapshot.test.ts`（3 项：序列化/剥离 headers/空默认/null percent）与 `runtimeContext.test.ts`（真实子进程加载 fixture 扩展，断言真实 model/thinking/scopedModels/contextUsage/systemPrompt 且 `ctx.modelRegistry`、`ctx.abort` 抛错）。
- **D 双向 IPC 与 executeTool（2026-10-11，部分交付）**：`processClient.ts` 增加 worker→主机的请求通道（`registerHostSession`/`releaseHostSession`，按 token 把请求路由回发起它的那次调用），worker 增加 `hostRequest` 与 `ctx.executeTool()`：嵌套工具经共享 ToolRuntime 运行（`createMomTools` 用与模型相同的可调用工具集解析，未知工具与主机端失败都返回 `isError` 结果而非抛出），`toolBridge.ts` 每次调用注册/释放 host session 并透传 `hostToken`，从而按调用身份隔离并拒绝迟到回复。机器证据：`executeTool.test.ts`（4 项：成功路由到 host session、无 host session 报错、主机失败→isError、已释放 session 拒绝迟到请求）。
- **D modelRegistry（2026-10-11，部分交付）**：`ctx.modelRegistry` 从快照目录做同步发现（`getAll` / `getAvailable` / `find` / `findOfType` / `getModelsOfType` / `getModelOfType` / `hasConfiguredAuth` / `getProviderDisplayName` / `isUsingOAuth`），`classify` / `generateImages` 经双向 IPC 走共享 `ModelOperations`（授权/预算/用量与 Codemode 同一条路径），凭据、Provider 对象、Provider/模型注册与 `stream` / `streamSimple` / `complete` 明确拒绝。新增 `plugins/piExtensions/modelCatalog.ts`（每调用解析可用性，仅暴露 provider/id/name/api，不含凭据）；`toolBridge.ts` 的 host session 增加 `modelRegistry.classify` / `modelRegistry.generateImages` 分发，接 `codemodeModels`（Plan/只读下不可用，worker 返回错误结果）。机器证据：`modelRegistry.test.ts`（3 项：发现 + 分类/图片路由、凭据/注册/流式明确拒绝、无 host session 报错）、`modelCatalog.test.ts`（2 项）、`runtimeContext.test.ts` 增发现断言。
- **D 流式 chat（2026-10-11，部分交付）**：`ctx.modelRegistry.stream` / `streamSimple` / `complete` 经双向 IPC 的新推送通道（`hostEvent`）回传有界序列化事件；主进程用共享 `Models` 适配器（`getPiModels()`）运行 provider 流，并复用与 Codemode 相同的 authority / 预算 / 用量。单个事件超过 256KB 使流失败而非越界；扩展侧 `AbortSignal` 取消会通知主机（`modelRegistry.streamAbort`）并终止流。机器证据：`modelStream.test.ts`（5 项：事件顺序与最终结果、`streamSimple` 标记、超界失败、主机失败→错误、取消通知）。
- **D 只读 sessionManager（2026-10-12，部分交付）**：`ctx.sessionManager` 从**原生 durable 日志**读取身份与记录（`getCwd` / `getSessionId` / `getSessionFile` / `getSessionDir` / `getSessionName` / `getHeader` / `getLeafId` / `getLeafEntry` / `getEntry` / `getEntries` / `getBranch` / `getLabel`（无标签→`undefined`）/ `getTree`（线性日志→扁平）/ `buildContextEntries` / `buildSessionProjection`）。条目来自原生活跃上下文（存储已解析分支），每条携带其贡献的模型消息，既以 pi 风格 `message` 条目暴露又保留完整 `messages`；每次调用刷新（`PiRunSession.extensionSessionSource` → `PiConversationRuntime.context()`），同步返回、不伪装 Promise。注意与 pi SessionManager 的字段差异：durable 记录无 `parentId`/`timestamp`，会话是线性日志。机器证据：`sessionSnapshot.test.ts`（身份/记录/分支/投影/无标签）、`runtimeSnapshot.test.ts` 增 session 断言。
- **D tools / abort / 忽略取消（2026-10-12，部分交付）**：`ctx.tools` 现在是与模型相同的可调用工具目录（`createMomTools.toolCatalog` → worker），`ctx.abort()` 经双向 IPC 通知主机（`extensionAbort` → `PiRunSession.abort`，任何模式都可用），扩展忽略取消时 worker 被终止、fault 上报而服务不受影响。机器证据：`executeTool.test.ts` 增至 7 项（新增工具目录、abort 通知、忽略取消不拖垮服务）；`runtimeContext.test.ts` 未接线探针改用 `ctx.compact`。
- **D compact 与事件路径（2026-10-12，部分交付）**：`ctx.compact()` 经双向 IPC 触发原生压缩（`extensionCompact` → `PiRunSession.compact` → `PiConversationRuntime.compact`，其模型调用经运行预算），Plan / 只读下不可用。新增按 run 的扩展宿主注册表（`plugins/piExtensions/runHost.ts`，`createMomTools` 在每次运行时注册），事件处理器经该注册表拿到与工具相同的真实快照、`ctx.tools` 与 host session，从而在事件里也能 `executeTool` / `stream` / 分类图片；无活动运行时退化为 cwd + 系统提示。机器证据：`executeTool.test.ts` 增至 9 项（新增 compact 通知、事件处理器拿到运行上下文并嵌套调用）；`eventBridge.test.ts` 9 项保持通过。
- **D 未验收**（规格列全）：`ctx.signal`（仍是未绑定的控制器）；命令（slash command）路径的快照与嵌套调用（命令无运行上下文，仍只有 cwd / 系统提示）；跨作用域读取拒绝（当前由运行快照天然限定在本次运行）；真实扩展宿主端到端验收。

## Problem Statement

Molibot 已使用 Pi 1.0 的模型运行时、原生 Harness、内部子会话、Deferred、Codemode 沙箱、MCP 客户端、分类和图片生成接口，但产品入口没有完整承接这些底层能力。

- 服务启动只自动续查具有 Deferred handle 的运行。普通任务即使存在原生 checkpoint，也不能通过当前启动入口自动继续；用户可能需要重新发起工作。
- HTTP MCP 只支持配置 headers。需要 OAuth 的服务器缺少登录、刷新、追加授权和退出入口。
- Codemode 脚本不能调用 `models.classify()` 或 `models.generateImages()`。用户无法在一次受控脚本中组合工具、分类与图片生成。
- Pi 扩展运行在独立进程，但 `ctx.sessionManager`、`ctx.modelRegistry` 不可用，部分运行控制返回固定值或无效果。依赖会话读取、模型操作或真实取消状态的扩展无法正确运行。

用户希望补齐这四项能力，继续使用现有 Session、权限、预算、审批、制品和渠道入口，并把实现交给其他 Agent。

## Solution

1. 服务重启后检查原执行的持久记录，从 Safe Resume Point 继续可安全恢复的普通任务、内部子任务与 Deferred 任务。已完成操作不重复；未知非幂等结果进入明确的恢复核对状态。
2. MCP 设置提供 OAuth 登录、授权状态、重新授权和退出。使用 Pi 的 OAuth 实现，凭据绑定到所属服务器，刷新和追加授权不要求用户手工维护 token。
3. Codemode 提供受控的模型发现、分类、图片生成和图片展示接口。模型请求使用用户已有凭据，权限、预算、费用、取消和恢复与共享执行链路一致。
4. Pi 扩展取得当前执行的只读会话视图、模型操作接口和真实运行状态。所有操作通过有身份校验的 IPC 与共享应用层完成，扩展继续留在独立进程。

完整范围以本规格为准。底层 Pi 私有执行记录、Molibot 产品状态和 UI Session 各自保持既有所有权，不创建第二套执行引擎或可写状态机。

## User Stories

1. 作为用户，我希望服务重启后普通任务能够继续，以便不必重复描述目标。
2. 作为用户，我希望恢复保留原 Session 和 Agent，以便结果仍出现在原对话。
3. 作为用户，我希望恢复保留原 Project、Bot 和渠道发送目标，以便结果不会发到错误的工作区或聊天。
4. 作为用户，我希望已经完成的工具操作不再执行，以便避免重复修改和发送。
5. 作为用户，我希望未知是否成功的外部操作要求核对，以便避免重复发送或扣费。
6. 作为用户，我希望等待审批的任务在重启后仍等待同一审批，以便审批不会丢失或重复。
7. 作为用户，我希望批准后继续原工具任务，以便不会重新提交整段需求。
8. 作为用户，我希望 Stop、拒绝和过期状态在重启后仍生效，以便停止的工作不会复活。
9. 作为用户，我希望被撤销权限的任务不再执行，以便当前授权始终有效。
10. 作为用户，我希望父子 Agent 一起恢复，以便已经完成的子任务不被重新委派。
11. 作为用户，我希望恢复不重置预算和期限，以便任务不会无限运行。
12. 作为用户，我希望安全读取可以按原执行规则恢复，以便中断不必导致整个任务失败。
13. 作为用户，我希望损坏或缺失的执行记录有明确说明，以便知道哪些工作需要处理。
14. 作为用户，我希望恢复的答案、制品和用量只显示一次，以便记录可信。
15. 作为用户，我希望看到恢复中、等待核对和失败的区别，以便决定下一步。
16. 作为用户，我希望 MCP 设置可以发起 OAuth 登录，以便使用要求授权的远端工具。
17. 作为用户，我希望看到每个 MCP 服务器的授权状态，以便定位连接问题。
18. 作为用户，我希望同 URL 的不同服务器配置可以使用不同账号，以便账号互不干扰。
19. 作为用户，我希望过期 token 自动刷新，以便正常调用不频繁中断。
20. 作为用户，我希望追加授权保留已经授予的 scopes，以便新授权不会破坏旧能力。
21. 作为用户，我希望可配置明确的授权服务器元数据地址，以便发现信息错误的 MCP 服务仍可连接。
22. 作为用户，我希望取消、失败或过期的登录可以重新发起，以便界面不会一直等待。
23. 作为用户，我希望退出授权后后续调用停止使用旧凭据，以便退出真实生效。
24. 作为用户，我希望删除服务器只清理它自己的授权记录，以便其他服务器保持可用。
25. 作为用户，我希望手工 headers 和 stdio 配置继续可用，以便已有服务无需改配。
26. 作为用户，我希望登录成功后原会话能够重新发现工具，以便不必新开对话。
27. 作为用户，我希望无人值守任务遇到新授权需求时明确暂停或失败，以便不会无限等待浏览器操作。
28. 作为用户，我希望 Codemode 能发现可用分类和图片模型，以便选择实际可调用的模型。
29. 作为用户，我希望脚本可以调用分类模型，以便将分类结果用于后续工具操作。
30. 作为用户，我希望脚本可以生成图片，以便把生成与后续处理组合起来。
31. 作为用户，我希望脚本支持参考图、多张图片和伴随文本，以便结果完整保留。
32. 作为用户，我希望脚本中的图片可以直接展示和下载，以便不用处理 base64。
33. 作为用户，我希望脚本用现有 Provider 凭据，以便不另配密钥。
34. 作为用户，我希望脚本中的模型请求受到权限限制，以便 Plan 或受限执行不能绕过规则。
35. 作为用户，我希望脚本模型调用计入同一预算和用量，以便费用不会漏记。
36. 作为用户，我希望停止脚本也停止模型请求，以便后续操作不会继续。
37. 作为用户，我希望脚本出错后保留已完成结果，以便能继续剩余工作。
38. 作为用户，我希望脚本恢复不会重复已经完成的模型请求，以便避免重复扣费。
39. 作为用户，我希望模型或参数错误提供可操作的提示，以便 Agent 能纠正调用。
40. 作为用户，我希望低频模型接口说明按需加载，以便不把长说明放进每次请求。
41. 作为扩展作者，我希望读取当前 Agent Context 的只读记录，以便扩展了解当前工作。
42. 作为扩展作者，我希望同步会话读取接口仍有正确的返回语义，以便无需把现有调用误改成异步。
43. 作为扩展作者，我希望发现可用模型并调用分类和图片生成，以便复用用户已配置的能力。
44. 作为扩展作者，我希望取得实际 model、thinkingLevel、scopedModels 和上下文用量，以便扩展不依赖伪造状态。
45. 作为扩展作者，我希望 abort、compact 和待处理消息查询真实生效，以便扩展能参与运行控制。
46. 作为扩展作者，我希望嵌套工具通过共享执行入口，以便权限、审批、预算和收据一致。
47. 作为扩展作者，我希望不支持的终端接口明确报错，以便不会误认为调用成功。
48. 作为用户，我希望扩展只能读取其获准的会话，以便其他 Agent 和 Session 的信息不会泄露。
49. 作为用户，我希望扩展崩溃、超时或退出不会停止服务，以便其他对话仍能使用。
50. 作为用户，我希望扩展不能获得原始 Provider 或 MCP 凭据，以便密钥不通过接口泄露。
51. 作为维护者，我希望真实生产入口有机器回归，以便适配器通过测试不被误认为产品已接线。
52. 作为执行 Agent，我希望每个实施单元都有明确验收条件，以便可以独立实现和交付。

## Implementation Decisions

### 共同架构与执行顺序

- 遵循已接受的状态分库、Pi 私有执行存储、进程隔离和 Turn Retention Policy 决策。Pi 管理 generation、ToolTask、child conversation 与原生提交；Molibot 管理来源授权、业务目标、审批政策、Task Budget、展示与投递。
- 优先采用当前固定版本 Pi 的公开接口；不读取或更新其私有 JSON checkpoint 布局来实现业务逻辑。现有版本不能支持必要行为时，先记录可复现限制及所需版本变更，不静默绕开内核。
- 所有跨渠道逻辑在共享应用层实现。Channel 只适配消息收发，新增 Channel 不需要重写四项能力。
- 不新增全局能力开关、通用工作流引擎、旧引擎 fallback 或历史活动任务 migration。当前可恢复原生记录直接重开；旧活动记录进入明确的人工处理状态。
- 实施单元 A：普通任务恢复。B：MCP OAuth，可独立推进。C：共享模型操作与 Codemode，恢复验收依赖 A。D：扩展运行接口，复用 C 的模型操作与 A 的运行控制。执行 Agent 可顺序交付；各单元必须通过自己的真实入口验收。
- 新增 UI 遵循项目设计规范，复用现有组件、共享语义样式和固定保存底栏；适配即时中英切换、明暗主题和移动宽度。配置保存使用实体级 API。
- 临时模型控制、用户提示和结构化运行事件分离。恢复、授权、错误提示不伪装成普通对话消息回灌模型。

### A. 普通任务恢复

- 扩展现有启动恢复协调器，通过正式 Harness/Storage 接口检查可恢复执行；删除“只有 Deferred 才允许启动恢复”的分类限制。缺少 Deferred handle 仅能说明不能续查远端异步任务，不能据此判定所有普通原生任务不可恢复。
- 原 admission 身份绑定 owner、Agent、Room、Project、UI Session、actor、渠道实例、发送目标、模型目录、权限和原运行预算。恢复重新解析当前凭据、当前授权与服务所有权；只能保留或收紧权限，不扩大原授权范围。
- 复用原 Pi storage、requestId、task 和 child conversation，不重发原用户输入、不重新创建已拥有子任务。普通任务、Durable Execution 的 Execution Attempt、Runtime Task、Room 与内部子 Agent 共用恢复判定，各产品域继续拥有自己的目标状态和授权。
- 已提交工具结果直接复用。只有库允许重放且共享副作用分类确认安全的中断操作可以重跑；未经提交的远端模型请求也可能已收费，必须区分确定未发送、可续查和提交结果未知，不能笼统自动重发。
- 逐项核对相关 Side-effect Record 和原生提交。未知非幂等结果阻断同一语义操作的再次执行，包括模型使用新 call ID 重试的情况；通过现有审批/Decision Request 产品入口核对，答案只作用于原执行。
- 等待审批重开后保留原请求和参数绑定，批准仅唤醒原执行。拒绝、过期、Stop、预算耗尽、绝对 deadline、授权撤销和服务租约丢失优先于恢复和迟到完成。
- 每个执行存储只有一个活动服务 owner；启动重复扫描、并发恢复、多个进程和旧回调不能重复 claim、执行或投递。损坏/缺失记录、失效 owner 或无法安全恢复时释放占用，并展示明确处理原因。
- Session、Trace、usage 和投递从稳定原生来源幂等投影，允许启动 reconciliation 修复已提交但尚未展示的记录。不承诺跨库事务；工具完成不等于 Durable Execution 的 Acceptance Criterion 达成。
- 验收：真实服务启动路径能继续安全普通任务和父子任务；已提交写操作执行一次；未知写操作停在核对状态；审批身份和预算不变；终态不复活；原渠道和 Session 只收到一次结果。

### B. MCP OAuth

- 采用 Pi MCP OAuth 公共接口、状态存储和 HTTP authProvider，复用其 discovery、PKCE、state、RFC 9207 issuer 验证、token 刷新与 step-up scopes 行为，不自行实现协议。
- MCP 服务器配置加入显式认证方式：手工 headers 或 OAuth。保留既有 headers/stdio 配置；选择 OAuth 时禁止混用手工 Authorization，避免令牌来源不明确。配置支持 Pi 提供的 authServerMetadataUrl 和 clientName，不增加第二份 Pi MCP 配置文件。
- 凭据持久记录按 owner 与稳定服务器身份隔离，并绑定 URL 和授权服务器。相同 URL 的不同配置可以分别登录；URL、认证方式或授权服务器改变后不得复用不匹配 token。原始凭据只进入现有受保护凭据存储，不进入设置响应、日志、Trace、prompt 或扩展 IPC。
- 共享应用层提供授权状态、发起登录、完成回调、取消登录、重新授权和退出接口。一次授权绑定原 actor/owner/server、有效期、state 和唯一尝试身份；迟到或重复回调不能覆盖后来的登录、退出或删除决定。
- 原生 Desktop 在系统浏览器完成授权；Web 使用与实际部署匹配的安全回调。复用 Pi 支持的回调设施，明确本地 loopback 与远端 Web 的差异，不写入开发者机器地址。回调不额外要求同站 cookies，但必须通过原授权尝试和协议校验。
- 正常 HTTP 调用动态解析当前授权，刷新并发合并。退出先禁用本地凭据，协议支持时尝试远端撤销；远端撤销失败不得让本地继续使用旧 token。删除服务器清理其授权尝试和凭据，不影响同 URL 的其他配置。
- 新授权需求不得在非幂等 tools/call 结果未知时自动重放。当前执行安全暂停并保留原任务，授权完成后从安全位置继续。无人值守任务不自动打开浏览器、不无限等待，记录可操作的授权需求。
- 登录成功后通过现有连接注册表重连并刷新工具。重启后凭据可用，未完成授权尝试明确结束或按仍有效的协议状态恢复，不保留无法完成的加载态。
- 验收：完整登录、刷新、追加授权、退出和重启可用；state/issuer 不匹配拒绝；同 URL 双账号隔离；退出与迟到回调竞态无复活；工具权限、恢复和结果限额保持一致。

### C. Codemode 模型 API

- 在现有 Pi Codemode 沙箱中注册公开脚本接口，承接 Pi 1.0 的模型发现、`models.classify()`、`models.generateImages()` 和 `image()` 展示语义。输入、输出与错误形状优先遵循 Pi 文档，不另创同名不同义协议。
- 由共享模型操作服务承接请求，Codemode 与扩展复用同一入口；主进程解析模型和凭据，子进程只得到有权限的模型元数据和序列化结果。保留无直接 Node、文件、网络及原始密钥访问的限制。
- 按模型类型返回目录和凭据可用状态。可用不代表允许调用；运行时根据原 actor、权限模式、允许模型和作用域再授权，不能因用户有某 Provider 凭据就允许脚本调用任意模型或端点。
- 模型调用使用现有审批入口，遵循 Plan/Manual/Accept Edits/Auto 与共享副作用分类；没有允许的执行动作时明确拒绝。每个调用在请求前保留预算，计入父执行及内部子任务的适用限额，结束后按稳定 receipt 入账。
- 每个模型操作绑定原生父工具和稳定子调用身份、参数指纹、模型与目的。结果先提交再回传；重复恢复复用已提交结果。并行调用各自拥有身份，重排或变参不能复用其他调用。
- 已提交 Deferred handle 继续轮询；外部成功但本地结果未知时进入恢复核对，不为图片或分类自动重复收费请求。不把任意 JavaScript 内存状态当作 durable checkpoint；脚本审批/中断后继续遵循现有部分结果和剩余工作契约。
- 图片经现有媒体任务和制品服务落盘并展示，支持模型实际支持的参考图、多图、伴随文本、下载及来源归属。尺寸、seed 等参数仅在模型接口支持时允许；不得默默丢弃不支持参数。传输受限的大图片使用现有安全制品引用，模型可读结果不灌入大段 base64。
- 用量、已知费用和未知价格采用现有统一汇总；重读、恢复、失败后查看、保存失败或取消不删除已发生的费用事实。必要的 Provider 费用返回缺失时标记未知，不伪造零费用。
- Stop、期限与预算耗尽传播到所有在途模型操作，不能让迟到结果启动后续工具。远端取消失败或不支持时给出人类可读说明，不声称远端停止或不会收费。
- 工具描述保持简短，模型 API 的长说明按需读取；参数错误、不存在成员和未知模型提供 Pi 的纠错指引。检查最终真实系统提示词及真实请求，不只检查静态 preview，也不承诺固定 token 节省比例。
- 验收：真实 Runner 中脚本可发现模型、分类、生成并展示多图；调用经过权限和预算；费用与 receipt 一次归属；取消及重启不重复已完成请求；现有普通工具组合仍可用。

### D. Pi 扩展运行接口

- 修改真正运行扩展的子进程上下文和主进程 IPC handler，而非仅替换未被生产调用的 context helper。遵守现有独立进程、内存上限、最终期限和异常退出清理规则，不将扩展模块载入服务。
- 为 Pi 1.0 ExtensionContext 的服务器适用接口建立明确支持表。必须支持当前 model、thinkingLevel、scopedModels、isIdle、hasPendingMessages、getContextUsage、getSystemPrompt、signal、abort 与 compact；终端布局、服务进程 shutdown 和未授权操作明确拒绝，不能静默 no-op 或返回伪造成功。
- `ctx.sessionManager` 使用只读、按调用刷新且绑定原执行身份的快照，覆盖当前会话记录、当前分支、会话身份和构建上下文等 ReadonlySessionManager 能表达的读取。保持同步接口的返回语义；不得把同步读取伪装成 Promise。记录从原生提交和已授权 Agent Context 派生，保留来源、分支和 retention，不用 UI Session 的全部历史冒充模型上下文。
- 通过有界 IPC 提供 `ctx.modelRegistry` 的模型发现与可用性、chat/classifier/image 类型查询、受控分类和图片生成；支持扩展的 stream/streamSimple/complete 模型调用并复用共享 Provider 适配，流式消息经有界序列化事件回传。所有调用复用 C 的授权、预算、receipt、费用、制品与取消。
- 支持表逐项列出 Pi 1.0 实际公开方法、同步/异步语义和测试证据。原始 API key、auth token、Provider 可执行对象、全局凭据修改和 Provider/virtual model 注册不通过此上下文暴露；调用这些接口明确给出不支持原因。该范围不声称完整兼容任意 Pi 扩展。
- 扩展工具上下文的工具目录与 `executeTool()` 通过共享 ToolRuntime 和原生 owned task 执行，保留参数校验、权限、审批、预算、进度与收据。禁止直接 invoke 底层 handler，禁止跨 Session 发起执行或自行扩大工具目录。
- IPC 请求和响应绑定 extension、owner、run、Session、父工具及调用身份。重开或切换 Session 后旧上下文失效，迟到响应不能作用于新 run；共享控制在每次实际动作前重新核对身份、取消、权限与服务所有权。
- abort 控制当前获准执行，compact 复用当前压缩入口和预算；权限不足或运行阶段不允许时明确拒绝。`hasUI: false` 与 print mode 保持真实，不把终端确认的默认 false 当作业务审批结果。
- 验收：通过真实扩展宿主加载 fixture 扩展，读取正确会话和状态、调用模型、执行嵌套工具、取消和压缩；跨作用域读取拒绝；同步方法不返回 Promise；扩展崩溃或忽略取消不影响服务；退出后预算、审批与未决结果仍由原执行拥有。

## Testing Decisions

- 用户已确认以现有真实 Runner／服务生命周期作为主验收入口，使用临时数据库、模拟 Provider/MCP 和真实子进程强杀；OAuth 及桌面交互补充接口测试与隔离冷启动走查。无需新增通用测试框架。
- 测试外部可观察行为：原操作次数、原任务身份、实际模型请求、展示结果、费用、状态和权限。避免仅断言 import、源代码文字或适配器构造参数。
- A 复用现有生产 Runner Deferred 强杀、原生会话审批重开、工具结果复用与未知副作用守卫。补齐普通同步任务、已完成工具后继续、父子任务、审批、Stop、Room 授权撤销和服务租约；至少在 intent 前、外部成功未提交、结果提交未投影三个窗口使用受控 barrier 强杀。外部模拟器 ledger 独立于 Molibot 数据库计算执行次数。
- A 必须从真实启动协调器恢复，而不是测试直接手工调用原生 resume。并发启动或重复检查只能产生一个 owner；UI Session、搜索/记忆保留策略、Trace、usage 与渠道投递一致。
- B 用本地 HTTP MCP 和 OAuth 服务验证 discovery、PKCE、state/issuer 错误、metadata override、首次授权、刷新、并发刷新、空 scopes、追加 scopes、取消、过期、迟到回调、同 URL 双账号、退出、删除和重启。检查真实 Authorization header，避免把 token 打到测试输出。
- C 在真实 Runner 中运行 Pi Codemode 沙箱，验证分类、多图参考输入、伴随文本、模型类型区分、参数错误、权限拒绝、预算前置、并发归属、部分失败、取消、Deferred、重启结果复用与未知收费请求阻断；用量和图片使用共享媒体测试的临时制品目录。
- D 经真实扩展子进程和 IPC 加载 fixture，验证只读会话快照、同步返回类型、真实运行状态、模型流式操作、嵌套工具与审批；覆盖两个并行 Session、旧 run 迟到回复、跨作用域访问、异常退出、无响应和忽略取消。不以主进程 context helper 的单测替代生产宿主测试。
- 所有持久化测试使用临时数据库与可注入 store；新增设置做 save → 新建 store → load 整对象 round-trip，保留其他 Provider、Channel 和 MCP 配置。禁止读取真实用户凭据或运行数据库。
- UI 验收覆盖即时中英切换、明暗主题、移动宽度，以及隔离服务重启 → 首次打开/授权 → 切换 Session/页面 → 服务中断恢复。Desktop 的浏览器授权与回调也必须验证真实入口。
- 每个实施单元运行相关现有回归、根类型检查、生产构建；涉及 Desktop 时运行 Desktop 检查与构建。交付前进行对抗式审查，重点检查副作用重放、身份串用、权限提升、双重入账和是否可删除重复实现。
- 本次规格依据的代码审查回归为 90 项通过：原生会话与子任务、Codemode、MCP、图片 Provider、Telemetry、真实 Runner 和 Deferred 强杀恢复。这不证明本规格新增行为已实现。真实账号和付费 Provider 验收仅在获得账号、目标与费用授权后执行，其缺失单独记录。

## Out of Scope

- Pi 全屏 TUI、终端主题、终端交互控件及原样复制 CLI。
- 更换现有 Session 产品模型、重新实现 Harness、通用 DAG、永久双引擎、历史活动任务转换或删除。
- 声称未知外部副作用 exactly-once，或声称本地取消必然取消远端计费。
- MCP resources/prompts/sampling/tasks、新增旧 SSE transport、Radius 专用账号入口或全局 Pi MCP 配置管理。
- 任意扩展完整兼容；通过扩展暴露密钥、全局 Provider 注册/修改、virtual model 注册、任意其他会话写入或服务 shutdown。
- 新增独立图片产品页面、替换已有图片后端、开放脚本直接网络/文件/Node 权限。
- 未经批准使用真实账号、付费模型、部署环境，或中断用户正在使用的服务。

## Further Notes

- 术语使用 [领域词汇](../reference/CONTEXT.md)：UI Session、Agent Context、Durable Execution、Execution Attempt、Execution Step、Acceptance Criterion、Side-effect Record、Safe Resume Point 和 Task Budget 各有独立语义。
- 遵循 [ADR 0001](../adr/0001-memory-namespace-and-turn-retention.md)、[ADR 0002](../adr/0002-untrusted-runtime-process-boundaries.md)、[ADR 0003](../adr/0003-runtime-tasks-and-mini-app-todo-boundary.md)、[ADR 0004](../adr/0004-per-domain-databases-and-state-representation.md) 和 [ADR 0005](../adr/0005-pi-durable-private-execution-storage.md)。本规格不修改这些已接受决定。
- [旧 Pi 接入规格](pi-capabilities-integration-spec.md) 保留既有四项接入的架构与验收约束；本规格接管普通任务启动恢复的剩余范围，并新增 B/C/D。不得从旧文档的过期“尚未接线”描述重新安排已完成的内核替换。
- [Pi MCP 替换规格](pi-mcp-replacement-spec.md) 保留已实施客户端替换的连接、授权范围、取消和结果约束；其 OAuth 排除范围由本规格 B 单元覆盖，其余排除项仍有效。该文档含仍有用的运行约束和实现证据，继续保留。
- [生产接线验证](../reviews/pi-production-integration-validation.md)、[Codemode 验证](../reviews/pi-codemode-integration-validation.md)、[图片验证](../reviews/pi-image-integration-validation.md) 与 [手工验收材料](pi-manual-acceptance-2026-10-04.md) 提供已有行为证据，不证明本规格新增能力已交付。
- 其他 Agent 开始前核对当前实现与未提交修改，不回退他人改动。每个单元交付记录实际修改、删除的重复机制、机器证据和未验证项；同步需求状态、适用交付记录及能力矩阵。当前仅增加计划，能力矩阵状态不变。
- 已按 to-spec 流程发布为 [GitHub Issue #64](https://github.com/gusibi/molibot/issues/64)，应用 `ready-for-agent` 标签。Issue 和本地规格共同提供执行入口；后续实施状态必须明确记录，不能以标签替代验收。
