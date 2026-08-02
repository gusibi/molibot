# Mini App Platform PRD

> Workspace-installed apps with agent tools + hosted UI
>
> - **Status**: Planned — GitHub Issue [#26](https://github.com/gusibi/molibot/issues/26) (`ready-for-agent`)
> - **PRD index entry**: `prd.md` §3.31 (2026-08-02)
> - **Revision**: v2 (2026-08-02) — incorporated review feedback: app-provided API handlers replace the generic file-level data API; owner-global install scope pinned; trust model stated accurately; code/data directory separation; internal tool naming + classification; disable-at-invoke semantics; CSP constraint; uninstall flow. Rejected: routing UI through an MCP bridge, and adopting the full MCP Apps host protocol in MVP (both judged too heavy — see Out of Scope).
> - **Revision**: v3 (2026-08-02) — aligned with the implementation plan ([miniapp-platform-implementation-plan.md](./miniapp-platform-implementation-plan.md)): owner workspace pinned to `config.dataDir` (`~/.molibot`); iframe transport switched from port-scoped `frame-src` to the fixed custom protocol `molibot-miniapp://` (gated by the Slice 0 WKWebView spike); install requires a service restart (no hot reload in V1); Mini App tools load via toolSearch deferral; Ajv + SemVer added as production dependencies.

## Problem Statement

作为 Molibot 的用户，我可以让 Agent 帮我管理待办、记账、日程等日常数据，但这些数据没有可视化的承载面：它可能落在记忆里，也可能落在某个文件里，我只能通过对话一条条把内容"问"出来。为每一类场景（todo、记账、地图、语音/图片生成……）在主应用里单独做一套 UI 会让应用无限膨胀，而不做 UI 则这些能力对用户几乎不可用。

## Solution

引入 **Mini App** 机制：一个 Mini App 是安装在 owner workspace 下 `miniapps/` 里的可插拔应用，由三部分组成，共用一份属于该 App 自己的数据存储：

1. **数据层**：App 专属的数据目录（SQLite 或 JSON），是该领域数据的唯一事实来源（single source of truth），与 App 代码目录分离、生命周期独立。
2. **工具层**：manifest 中声明的一组 Agent 工具，服务进程内加载，Agent 通过它们读写 App 数据（如 `todo.add` / `todo.list`）。
3. **UI 层**：App 自带的静态 HTML/JS 界面 + App 自带的服务端 API handler。UI 由 Molibot 服务托管，在桌面端以 sandboxed iframe 面板呈现；UI 通过宿主挂载的 `/miniapps/<app-id>/api/*` 调用 App 自己的 API handler，直接操作自己的数据——**工具 handler 与 API handler 共用同一个领域模块**，业务逻辑单源，不经过 MCP 绕行。

用户说"帮我加个待办"，Agent 调工具写入 App 数据；用户打开 Todo Mini App 面板，看到的就是同一份数据。安装 = 放入目录（服务扫描发现，**重启服务后生效，V1 无热更新**），卸载 = 停用后经 Settings 移除（数据可保留）；Settings 中提供目录列表与启停开关。MVP 附带一个 **todo** 参考实现，同时验证工具写、UI 读、双向刷新的完整链路。

**安装作用域（V1 = owner 全局）**：Mini App 与其数据全局唯一、所有渠道共享——Telegram 会话里 Agent 添加的待办，桌面 Todo 面板同样可见。Owner workspace 即 `config.dataDir`（`~/.molibot`，Agent 运行时初始化该目录），Mini App 安装根为其下的 `miniapps/`，以现有 storagePaths 为唯一路径来源；**绝不**从调用上下文的 per-channel `workspaceDir` 推导。per-agent / per-project 实例化留待后续版本。

## User Stories

1. As a Molibot user, I want to install a Mini App by placing it under the owner workspace's `miniapps/apps/<app-id>/`, so that I can extend my agent with new domains without modifying the main app.
2. As a Molibot user, I want the service to discover installed Mini Apps automatically on startup, so that installation requires no extra registration steps.
3. As a Molibot user, I want to see all discovered Mini Apps in Settings with name, version, description and status, so that I know what is installed and whether it loaded correctly.
4. As a Molibot user, I want to enable/disable each Mini App with a toggle, so that I can turn off an app without deleting its data.
5. As a Molibot user, I want a Mini App with a broken manifest to appear as an error entry instead of being silently skipped, so that I can diagnose why it did not load.
6. As a Molibot user, I want to tell the agent "帮我加个待办" and have it call the Todo Mini App's tool, so that the item lands in a place I can later see.
7. As an agent, I want each enabled Mini App's tools exposed under a collision-proof internal name (`miniapp__<appId>__<tool>`) with a readable display name (`todo.add`), so that tools from different apps and MCP servers cannot collide.
8. As an agent, I want each tool's schema (name, parameters, description, risk hints) declared in the app manifest, so that I can call tools without introspecting app code.
9. As a Molibot user, I want to open a Mini App's UI panel from the desktop app, so that I can view and manipulate the app's data visually.
10. As a Molibot user, I want the Mini App UI to show the same data the agent writes, so that conversation and UI never diverge.
11. As a Molibot user, I want changes I make in the Mini App UI to be visible to the agent on its next tool call, so that both entrances stay consistent.
12. As a Molibot user, I want the Mini App UI to refresh when the agent mutates data, so that I don't need to manually reload the panel after a conversation.
13. As a Molibot user, I want to uninstall a Mini App from Settings and choose whether to keep its data directory, so that reinstalling later can restore my history.
14. As a Molibot user, I want a todo added from any channel (Telegram, Feishu, desktop chat) to appear in the same desktop Todo panel, so that the app is one shared surface across all my agents.
15. As a Molibot user, I want disabled Mini Apps to reject tool invocations at call time and return errors on their UI/API routes, so that "disabled" is enforced, not cosmetic.
16. As a Molibot user, I want Mini App tool calls to go through the same tool policy/approval pipeline as other agent tools, with risk derived from manifest hints, so that existing safety controls apply uniformly.
17. As a Mini App developer, I want a documented manifest format and directory contract, so that I can build a new app without reading Molibot internals.
18. As a Mini App developer, I want my UI served under a stable per-app route and my own API handlers mounted under my app's scoped route, so that my HTML and business logic work without hardcoding host internals.
19. As a Mini App developer, I want my tool handlers and API handlers to share one domain module over my own database, so that validation and business rules exist in exactly one place.
20. As a Molibot user, I want Mini App routes to enforce app-id scoping, reject path escapes and return opaque IDs, so that absolute host paths and secrets never reach the WebView.
21. As a Molibot user, I want Mini App enablement to survive a service restart, so that my configuration doesn't silently reset.
22. As a Molibot user, I want a working Todo reference app shipped with the MVP, so that I can immediately manage todos by chat and by UI.
23. As a Molibot user, I want the Todo app to support add / list / complete / delete via both agent tools and UI, so that the reference app is actually useful day to day.
24. As a future Mini App author, I want the tool/result semantics to stay conceptually aligned with the MCP Apps direction, so that apps could later be adapted to other MCP hosts.
25. As a Molibot user, I want Mini App discovery failures (unreadable dir, invalid JSON) to be logged with the app id, so that troubleshooting is possible without a debugger.
26. As a Molibot user, I want the Mini App panel to be reachable within the existing desktop layout rules (in-flow, min-width floors), so that opening it never crushes or overlays the chat pane.
27. As a Molibot user, I want an app upgrade (replacing the code directory) to leave my data intact, so that updating an app is never destructive.

## Implementation Decisions

- **新插件类别，而不是平行系统**：在现有插件体系上新增 `miniapp` 类别，复用 manifest 读取、目录扫描、catalog（含 error 条目）、启停状态的既有模式；Settings 的插件目录页面新增 Mini App 分组，开关用 IosSwitch，并提供卸载入口（保留/删除数据二选一）。
- **安装位置与目录结构（代码与数据分离）**：

  ```
  <owner-workspace>/miniapps/
    apps/<app-id>/          # 可替换的应用代码，升级 = 整目录替换
      manifest.json
      server/               # 领域模块：工具 handler + UI API handler 共用
      ui/index.html         # 静态 UI 入口
    data/<app-id>/          # App 数据，独立生命周期（卸载可保留，升级不触碰）
  ```

  `<owner-workspace>` 即 `config.dataDir`（`~/.molibot`），路径经由现有 storagePaths 统一派生；**禁止**用调用上下文传入的 per-channel `workspaceDir` 推导安装根。扫描器只把 `apps/` 下的目录当候选 App，`data/` 下的孤立目录不产生 error 条目。新增或替换 App 代码后需重启服务生效（V1 无热更新；数据不受影响）。
- **信任模型（措辞必须准确）**：owner 自装 App 的服务端代码是**完全可信代码**，进程内运行，不做沙箱（依据既有原则：owner 自有内容不设防护门禁）。"App 只碰自己的 `data/`"是目录**约定**并只在 HTTP 路由边界强制（app-id 作用域、路径校验），不是对 App 服务端代码的安全承诺。强隔离面是 UI 的 sandboxed iframe。未来支持市场/第三方来源时，再引入子进程沙箱、签名与权限系统。
- **manifest 声明**：`manifestVersion`、`engines.molibot`（宿主版本兼容范围）、id/name/version/description、`runtime.entry`（服务端模块入口）、`ui.entry`、工具列表（名称、JSON Schema 参数、描述、`readOnlyHint`/`destructiveHint` 风险提示）、数据 `schemaVersion`。宿主据此生成 Agent 工具定义并在 catalog/审批 UI 直接展示；实现模块只提供同名 handler。
- **工具命名与分类**：内部注册名为 `miniapp__<appId>__<toolName>`（与既有 `mcp__server__tool` 规范化约定同形，避免与 MCP 工具冲突）；UI/文档展示名为 `<appId>.<toolName>`。工具分类新增 miniapp 分支，归 `source: plugin`，风险由 manifest hints 决定（缺省 medium）——不允许落进未知工具的 low/builtin 兜底。经过既有 toolPolicy/审批管线。
- **UI 数据通路（无 MCP 绕行）**：宿主按 `/miniapps/<app-id>/` 托管 `ui/` 静态资源，并把 App 自带的 API handler 挂载到 `/miniapps/<app-id>/api/*`。API handler 与工具 handler 共用 `server/` 里同一个领域模块，直接操作 App 自己的 SQLite/JSON——校验、事务、业务规则单源。宿主在路由层强制 app-id 作用域与路径校验，响应只含不透明 ID，绝不暴露宿主绝对路径或凭据（pitfall #5）。**明确不做**：宿主提供的通用文件级读写 API（伺候不了 SQLite，且会造成第二套业务逻辑）。
- **禁用语义（调用时强制）**：enablement 在每次工具调用时校验，而不是只在构建工具列表时过滤；禁用后该 App 的 UI 与 API 路由返回 403。已打开的面板在下一次轮询时发现失效并自行降级提示（MVP 不要求立即 teardown）。
- **桌面面板与 iframe 传输（custom protocol）**：桌面端 Mini App 面板以 sandboxed iframe 加载 App 页面。因 Server 端口由 supervisor 运行时决定而 Tauri CSP 为构建期静态，"frame-src 精确到端口"不可实现——采用固定自定义协议 `molibot-miniapp://<app-id>/`，由 Tauri 侧传输 Adapter 转发到 `http://127.0.0.1:<runtime-port>/miniapps/<app-id>/*`；CSP 只放行 `frame-src molibot-miniapp:`，**不得**放宽任何 localhost 端口范围。该 Adapter 仅是 HTTP 传输层，不是 MCP bridge。此方案以实施方案 Slice 0 的真实 WKWebView spike 验证通过为前提；spike 失败则回到评审，不允许以放开 localhost 的 CSP 兜底。面板遵循既有多面板布局规则（in-flow、minmax 下限、不用 fixed overlay——pitfall #15）。
- **协议形状**：概念上与 MCP Apps 方向对齐（工具负责数据操作、App 提供 UI），但 MVP **不实现** MCP Apps host 协议（postMessage bridge、`ui/*` JSON-RPC、`tools/call` from UI）——UI 直连自己的 API handler 更轻、更符合"App 自治"的定位。未来若需要接入标准 MCP 宿主，为 App 增加一层 bridge 适配即可，领域模块无需改动。
- **数据归属**：App 数据只存在 `miniapps/data/<app-id>/`，Agent 工具与 UI API 读写同一份存储；不写入全局记忆，不散落在会话文件中。升级（替换 `apps/<app-id>/`）不触碰数据目录。
- **工具经 toolSearch 延迟加载**：Mini App 工具注册为 deferred tool，进入现有 toolSearch 索引（搜索文本含 App id/name/description 与工具 title/description/keywords），**不**把动态 App 列表和 schema 放入系统提示词静态前缀；提示词只增加一条稳定规则——请求可能由已安装 Mini App 处理时，用领域关键词调用 toolSearch。
- **新增生产依赖**：Ajv（manifest 工具 inputSchema 的唯一 JSON Schema 校验器，发现时预编译、调用前验证）与正式 SemVer 库（`engines.molibot` 兼容判断，不自造解析器）。
- **变更通知**：MVP 用 UI 侧轮询（revision 号）实现"Agent 改了 UI 能看见"；SSE 推送作为第二阶段。
- **启停状态持久化**：Mini App enablement 进入 runtime settings，必须通过 toStaticSettings→sanitize 序列化往返（pitfall #10）。
- **参考实现**：随 MVP 交付 Todo App（add / list / complete / delete 工具 + 列表 UI + SQLite + 轮询 revision），作为目录契约和开发文档的活样例。

## Testing Decisions

好的测试只断言外部行为（输入 → 可观察输出/持久化结果），不断言实现细节。四条测试缝，全部复用现有测试模式，不开新缝：

1. **发现/配置缝**：对临时目录运行 Mini App 扫描，断言合法 manifest 进入 catalog、非法 manifest 产生 error 条目、缺失目录返回空、`data/` 下孤立数据目录不产生 error 条目；enablement 走 settings save → fresh store → load 的 round-trip 回归（防窄序列化重置）。Prior art：现有插件 discovery 测试与 settings round-trip 测试。
2. **工具执行缝**：直接调用工具 executor——参数进、结果出，断言 App 数据目录中的持久化结果正确、**禁用 App 的工具在调用时被拒绝**（不只是列表里不可见）、错误参数返回结构化错误、工具分类为 `source: plugin` 且风险来自 manifest hints。Prior art：loadMcp / mcpInvoke 工具测试与 toolClassification 测试。
3. **HTTP 缝**：对 UI 托管路由与 App API 路由做 request-in/response-out 测试，覆盖：路径逃逸（`../`、绝对路径、双重编码、symlink）被拒绝；跨 App 访问被拒绝；禁用 App 的路由返回 403；响应中无宿主绝对路径。**双向 round-trip 在此缝闭环**：工具 executor 写入 → API 读到；API 写入 → 工具 executor 读到；并发写入不丢数据；卸载保留数据后重装 → 数据恢复。Prior art：既有 API route server tests。
4. **桌面结构守卫**：对 Mini App 面板做少量结构断言（面板入口存在、iframe sandbox 属性、`frame-src` 仅含 `molibot-miniapp:` 且**不得**出现 `127.0.0.1` / `localhost` 端口范围、面板遵守 minmax 布局约束）。Prior art：chat-ui 结构守卫测试。

真实 WKWebView 中的 iframe 渲染、bridge 行为、主题与中英文切换**不做自动化**（结构断言证明不了、自动化不划算），归入冷启动 smoke walk 手工清单：重启服务后首开面板、Agent 加待办后面板轮询刷新、UI 完成待办后 Agent list 可见、禁用后面板降级、切换会话。

验证约定沿用项目规则：涉及 Agent/runtime 的部分跑 agent 测试套件 + tsc；涉及桌面 UI 的部分 svelte-check 0/0 + vite build + desktop UI 测试 + 上述冷启动 smoke walk。

## Out of Scope

- **UI 经 MCP/postMessage bridge 调用工具**——已评审并明确拒绝：App 自治直连自己的 API handler 更轻；bridge 是未来接入外部 MCP 宿主时的适配层，不是 MVP 架构。
- **完整 MCP Apps host 协议**（`_meta.ui.resourceUri`、`ui/*` JSON-RPC、UI 发起 `tools/call`）——与上一条同因；仅保持概念对齐。
- App 市场 / 远程安装源（zip/git 下载安装）——MVP 只支持目录放置。
- SSE/WebSocket 实时推送——MVP 用轮询，推送为第二阶段。
- App 间互相调用。
- 权限系统细粒度化、子进程沙箱、签名——当前所有 App 视为 owner 自装可信内容（见信任模型）；第三方来源支持时一并引入。
- per-agent / per-project App 实例——V1 只有 owner 全局实例。
- 语音/图片/视频生成等重能力 App——属于后续基于本机制的应用，不在本 PRD 内。
- 移动端 / Web 外部渠道的 Mini App UI 呈现——MVP 仅桌面端面板。

## Further Notes

- 该机制与业界 MCP Apps / OpenAI Apps SDK 的收敛方向一致：工具负责数据操作，App 提供领域 UI，主应用做宿主薄壳。V1 以"App 自治 + 领域模块单源"落地，兼容路径保留在 App 侧适配层。
- Mini App 的长期愿景：所有需要专用 UI 的能力（记账、地图、媒体生成）都以 App 形式承载，主应用保持薄壳。
- Todo 参考实现同时充当开发者文档的活样例；目录契约文档随 MVP 一并交付。
- V1 交付按三条完整纵向链路组织：① 宿主（发现、校验、启停、工具注册、路由挂载）② App 通路（工具 handler / API handler 共用领域模块）③ Todo 参考实现（含卸载保留数据）。
