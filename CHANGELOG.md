# Molibot ChangeLog

### Fixed: Session management production wiring — real busy guard, external sessions, trash schedule (2026-09-08)

Archive and delete now genuinely refuse sessions with live work: the production lifecycle is assembled with a real busy probe (running agent turns, pending approvals, nonterminal linked tasks) instead of a constant-false check. External-channel conversations appear in management as read-only (listed, searchable by title, previewable) while every lifecycle mutation honestly reports "exists but read-only" instead of "not found". Expired trash purges on its own daily watched-event schedule with startup reconciliation, and editing the auto-archive policy round-trips the whole settings object without dropping provider or assistant configuration. The management tabs also stop double-driving their selection state, and extraction namespaces now follow each session's own assistant.

### Added: Session management can extract value before archiving (2026-09-08)

The Session management page now offers "Extract & archive" bulk processing: valuable preferences, facts, decisions and artifacts are distilled into memories (or linked artifacts) and the Session archives only when everything succeeded with nothing awaiting review. Per-session extraction states, a processed-but-not-archived filter, exact source ranges and links to retained information make it clear what still needs cleanup; failed or concurrently-messaged Sessions stay put with an explicit reason, and extraction never deletes anything.

### Fixed: HTML previews stay readable in dark mode (2026-09-06)

Previewing an `.html` file in the project files panel — a Hugo template partial, for example — painted default black text over the dark panel and was unreadable. The artifact preview route now injects a theme-aware base style (driven by the `theme` hint the panel already sends) ahead of every served document's own styles, so template text and unstyled pages render light-on-dark in dark appearance and unchanged in light. Documents that are actually templates (`{{ }}`, `{% %}`, `<% %>`, PHP tags) now open as syntax-highlighted source instead of a broken "rendered" view, with a toggle to switch back; real styled pages render exactly as authored.

### Changed: Workspace pages adopt the Settings page header (2026-09-06)

Automations, Skills, Agents, and Mini Apps now open with the same header pattern as Settings — a centered title with a one-line description on the shared content column — instead of a bare left-aligned title in a narrow bar. Each page explains its scope in both languages, the header stays aligned with the content column while scrolling, and the sidebar-restore control moves to the header's right edge so it never collides with the title.

### Fixed: Mini App toasts dismiss themselves again (2026-09-06)

The "Added to the composer" toast (and its siblings for attachments, read-only composers, and missing sessions) stayed on screen forever until manually closed: only one code path ever scheduled the auto-dismiss timer while the rest assigned the toast text directly. Every Mini App toast now flows through a single helper that owns the 3-second self-clear, with a guard test that fails if any code path ever bypasses it again. Toasts carrying a readable result card keep their stay-until-dismissed behavior.

### Fixed: Clicking a session no longer lands on a new conversation (2026-09-06)

Three root causes fixed together. A service reconnect no longer resets the view to a default conversation: the app now snapshots what you are reading when the service drops and restores exactly that on reconnect (previously every service restart could yank the pane to a brand-new draft). Sessions created by other surfaces (e.g. the browser Web UI) now open from the Desktop sidebar — reads, sends, stops and steers resolve the conversation's recorded owner instead of trusting the caller's identity, which also stops sends from silently continuing a different session. Session titles that failed their one-shot auto-summary no longer stay "New Session" forever: summarization retries on later turns while the title is still the default and never touches a renamed session.

### Changed: Project settings dialog keeps one fixed size across tabs (2026-09-06)

The project settings dialog no longer resizes when switching between General and Automations: width and height are set by the window, and the panel bodies scroll. The Automations tab inside the dialog also adopts the dialog presentation — shadow-floating task cards without visible borders, a 22px dialog title with 19px section headlines and 14.5px body/date text (two new type-scale tokens, guarded by the typography test), 38px pill buttons with an inset highlight, and 1px separator dividers.

### Changed: Built-in Agent templates clarify task scope and evidence (2026-09-06)

Eight templates now distinguish quick answers from full workflows, clarify research and calculation evidence, and resolve Mini App tooling from its actual location. Investment research removes fictional career credentials and personal position directives. Updated template versions are offered through the existing backup-preserving update flow.

### Documentation: Clarify contributor autonomy and approval boundaries (2026-09-06)

Contributor instructions now distinguish routine implementation from decisions requiring approval, preserve authorization across execution steps, and define completion and blocked-validation reporting. Documentation updates follow actual impact.

### Changed: The Mini Apps destination opens on a macOS-style Launchpad (2026-09-06)

The Mini Apps page now opens as a Launchpad: a grid of icon-and-name tiles for enabled, healthy apps only, one click to launch. Search, live counts, and a "Manage" CTA stay in the workspace toolbar; every lifecycle control (install, enable/disable, update, uninstall, AI routing) moved one click into a manage view that reuses the existing manager unchanged, so the launcher stays a launcher.

### Fixed: Prompt Box deletions survive cloud sync, plus a real icon (2026-09-06)

Deleting a prompt in Prompt Box never stuck: the remote pb.onlinestool.com API has no delete endpoint, so every sync re-imported exactly what the owner had just removed. Deletions of cloud-synced prompts now record a local tombstone that sync skips (surfaced as `skippedDeletedCount`), and prompt listings shown to the agent now carry their ids so agent-driven delete/update/get actually work. The app also gets a meaningful icon — an open box with rising sparkles and a terminal prompt glyph, in the same flat style as the other built-in Mini Apps — replacing the abstract "PB" badge in the header as well. Manifest bumped to 1.1.0 so installed copies are offered the update (the previous 1.0.7 UI fixes never shipped to installed copies because the version was never bumped).

### Fixed: Desktop file downloads open the native save dialog (2026-09-06)

Every download button in the desktop shell (project files, session file tabs, attachments in chat) silently did nothing: Tauri's WKWebView drops `<a download>` clicks because no `on_download` handler is registered. All download paths now route through one shared helper that, inside Tauri, hands the bytes to the existing native `save_file_dialog` command (the same channel Mini App image saving uses) so the system save panel appears; plain-browser dev keeps the anchor fallback. Attachment downloads also stop hard-coding the `personal` profile, fixing downloads in conversations owned by other bots. A machine guard test forbids reintroducing hand-rolled anchor downloads.

### Changed: Enter sends, Shift+Enter breaks the line (2026-09-06)

The chat composer (main sessions and Project chat) now sends with Enter and inserts a newline with Shift+Enter, matching every mainstream chat app. The IME confirm keystroke commits the composition instead of sending: the guard also checks `keyCode 229`, which WebKit still reports after `compositionend`, so confirming Chinese/English input no longer fires the message. Composer placeholder hints were updated in both languages.

### Fixed: Desktop approval continuation transcript and completion tracking (2026-09-06)

Background approval turns now keep tool progress in structured activities and persist one answer linked to the Agent transcript. Desktop follows server run status beyond fifteen seconds, handles subsequent approvals, and displays continuation execution time without counting the earlier approval wait.

### Fixed: Host Bash approvals execute and return results after Desktop approval (2026-09-06)

Host Bash requests now remain owned by their executor when sharing the approvals database with the generic broker. Approved command results are matched to the suspended tool result by request ID, including commands with arguments and repeated commands.

### Fixed: Sandbox localhost access and approval card reachability (2026-09-06)

Commands in the OS sandbox could never reach localhost services: the sandbox runtime tells HTTP clients to bypass its proxy for loopback (`NO_PROXY`) while the seatbelt profile only permits the proxy ports, so direct loopback connects were denied with a "Couldn't connect to server" that is indistinguishable from a dead service. The sandbox now always allows loopback outbound/bind, keeping domain filtering for external hosts. Missed Host Bash approval cards are no longer lost either: pending approvals can be resolved from the Settings approval list (approve once / always allow / reject), opening or switching to a session re-adopts its pending card, and one malformed SSE frame no longer starves later frames such as an approval push.

### Changed: Mini Apps have a single sidebar entry (2026-09-06)

The sidebar now offers Mini Apps only as the primary nav destination that opens the full manager. The redundant recent-apps tree section below the Projects tree is removed together with its recency tracking, badge rendering, and locale strings; the server-side `ctx.badge` capability and its retire-on-open flow are untouched.

### Fixed: Session Plan execution continuity and status clarity (2026-09-05)

Accepted Plans now execute and continue inside their originating Session, with the right panel acting as a progress view. Review-ready work leaves the running list, completion removes pause/cancel actions, later feedback returns to the same conversation, stable Plan ids prevent second-Plan acceptance failures, and one user turn renders as one answer without losing supplemental text or tool history. The reasoning disclosure is compact and borderless again.

### Changed: Desktop numeric typography (2026-09-04)

All data numerals now render with tabular figures via one shared rule on `body`, so counts, durations, sizes, and table columns no longer shift width as values change; rendered prose keeps proportional figures. A machine guard test (`numeric-typography.test.mjs`) protects the shared block and any future proportional opt-out.

### Changed: Desktop conversation presentation (2026-09-04)

Refined the welcome, composer, execution disclosure, and file receipts with clearer hierarchy and restrained depth. A single output now appears as one actionable row; existing task execution and file-opening behavior remain intact.

### Documentation: Desktop visual direction (2026-09-04)

Defined a Wealthsimple-inspired direction for future Desktop UI work: clear hierarchy, selective tactile depth, and continuous state changes within the existing macOS component system. Product restyling remains subject to visual validation.

### Fixed: Desktop numeric settings fields (2026-09-04)

Search limits and model timeout inputs retain enough width for complete values and native stepper buttons, including when cleared.

## Archive Index / 归档索引
- [2026 Q2 Archive (Apr - Jun)](docs/archive/changelog-2026-Q2.md)
- [2026 Q1 Archive (Feb - Mar)](docs/archive/changelog-2026-Q1.md)
- [2026 Q3 Archive (Jul - Sep)](docs/archive/changelog-2026-Q3.md)

### Fixed: Desktop 设置页记忆高级管理弹窗与全局 Modal 滚动与排版重塑

- **WebKit 顺畅上下滚动与弹性压缩根治**：
  - 根因定位：`.memory-advanced-body` 原本使用了 `display: grid; align-content: start;`。在 macOS WKWebView 中，带有 `align-content: start` 的 Grid 滚动容器在触控板与鼠标滚轮事件命中测试（Hit Testing）时无法正确派发滚轮事件，导致用户滚轮“滚不动”；且父容器缺少明确高度预算。
  - 禁止卡片被 Flex 压扁：声明 `.memory-advanced-body > .settings-card { flex: none; }` 及直属子项 `flex-shrink: 0;`。根治因 `.settings-card` 的 `overflow: hidden` 使 Flexbox 强制收缩子项至 50px、将多行诊断压缩切片、导致弹窗无溢出且滚不动的关键缺陷。
  - 标准 Flex 纵向滚动：将 `.memory-advanced-body` 改为标准 Flex 纵向容器：`display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;`；
  - 弹窗整体纵向滚动：外层声明 `width: min(680px, calc(100vw - 48px)); max-height: min(85vh, calc(100vh - 48px), 760px);`，内部 4 张卡片自然铺开，超出部分由外层 `.memory-advanced-body` 顺畅上下滚动；
  - 共享层根治：在全局 `.modal-body` 中保持 `flex: 1 1 auto; min-height: 0; overflow-y: auto;`。
- **桌面级原生精致排版重构**：
  - 只读诊断行收敛：重写 `.memory-advanced-body .settings-row`，行高从 50px 降为 32px，标题字号从 14px 粗体降为 13px `var(--fs-label)`（500 字重，二级色），数值 13px，状态 badge 收敛为 20px 紧凑胶囊（11px `var(--fs-meta)`）；
  - 运维表单与按钮：工具栏标题统一为 13px，输入框继承 `--control-h: 28px`，6 个运维操作按钮高度统一下调至 28px（`var(--control-h)`），内边距 `0 12px`，字体 13px，紧凑整齐；
  - 拒绝记录列表：搜索框统一为 28px 高度，记录项重构为清晰紧凑图文行（标题 13px，元信息 11px，内容 11px），单项高度腰斩，消除臃肿感；
  - 弹窗副标题排版：统一 `.entity-editor-head p` 样式为 11px `var(--fs-meta)`。
- **防复发机器测试守卫**：
  - 更新 `CLAUDE.md` Pitfall 16(c)；
  - 在 `apps/desktop/src/chat-ui.test.mjs` 中添加针对 `.memory-advanced-modal` 明确高度、`.memory-advanced-body` 纵向 Flex 滚动、`flex: none` 卡片防收缩、32px 紧凑行高与 13px 字体规范的自动化测试守卫。
- **验证**：`svelte-check` 0 error/0 warning，Desktop 229 项单元与结构测试全绿。

### Changed: Desktop 设置页控件标准化与下拉菜单轻量原生重构

- **全局统一控件尺寸 Token（消除 Hard-coded 尺寸）**：
  - 在 `:root` 中确立原生 macOS 桌面端控件尺寸变量：`--control-h: 28px`（表单输入与下拉菜单触发器）、`--control-h-button: 32px`（按钮与独立搜索框）、`--control-h-compact: 24px`（密集表格与分页器）。
  - 下拉菜单专项变量：`--select-trigger-h: var(--control-h)`（28px）、`--select-item-h: 24px`、`--select-min-w: 130px`、`--select-max-w: 260px`、`--select-popover-min-w: 140px`、`--select-popover-max-w: min(380px, calc(100vw - 24px))`。
- **根治下拉菜单（SelectControl）“大、宽、高”问题**：
  - **高度精简**：触发器高度从 40px 大幅降至 28px（`var(--select-trigger-h)`），菜单选项高度从 34px 降至 24px（`var(--select-item-h)`），与 22px 的 Switch 和 32px 的按钮形成优雅和谐的桌面层级。
  - **宽度自适应（Content-adaptive）**：在设置行中彻底废除硬编码 `width: 320px; flex: 0 1 320px; max-width: 58%` 的粗暴霸屏规则，改为 `min-width: 130px; max-width: 260px; width: auto;`。短选项（如“简体中文 / English”）紧凑贴合内容靠右对齐，长选项平滑展开并优雅省略，释放左侧标题与说明空间。
  - **弹层浮窗智能收敛**：浮窗宽度采用 `min(max(var(--select-popover-min-w), var(--bits-select-anchor-width)), var(--select-popover-max-w))`，内边距收敛至 4px，视口上限收敛，彻底杜绝了 320px~450px 笨重黑块弹出的突兀感。
- **全局表单输入控件统一归拢**：
  - 同步重构 `.settings-field input`、`.row-input`、`.provider-input`、`.observatory-field input/select`、`.connector-filter-toolbar .select-control-trigger`，全面继承 `--control-h: 28px`，根治此前不同页面各写 40px、36px、34px、32px、30px 零碎覆盖补丁的架构问题。
- **规范与测试守卫同步对齐**：
  - 修正 [DESIGN.md](file:///Users/gusi/Github/molipibot/DESIGN.md) 中误套用 Web Geist 40px 的条款，在 macOS product layer 正式确立 `--control-h: 28px` 规范；同步更新 `chat-ui.test.mjs` 中的静态测试断言。
- **验证**：`svelte-check` 0 error/0 warning，Desktop 229 项单元与结构测试全量通过。

### Changed: Desktop 自动任务窄屏自适应与工作区顶栏排版根治

- **工作区顶栏标题定位修复**：给 `.workspace-header` 明确指定 `justify-content: flex-start; gap: 12px;`，根治侧边栏折叠时标题“自动任务”被抛至视口最右侧的布局问题，恢复标准 macOS 顶栏左对齐体验。
- **搜索框与工具栏尺寸防变形**：给 `.search-field` 锁定 `height: 32px; min-height: 32px; max-height: 32px; box-sizing: border-box;`，移除窄屏媒体查询中导致搜索框主轴误拉伸为 200px 巨型白块的 `flex-direction: column`；窄屏下搜索框与创建按钮并排于 Row 1，统计指标并排于 Row 2。
- **分类 Tab 防折行平滑滚动**：为分类 Tab 按钮设置 `white-space: nowrap; flex: none;`，分类条容器开启静默水平滑动（`overflow-x: auto; scrollbar-width: none;`），彻底杜绝窄屏下“Project 自动化任务”被生硬压成两行碎字的排版瑕疵。
- **窄屏 Master-Detail 钻取规范**：在窄屏视口（`< 760px`）下，点击任务查看详情时列表平滑隐藏并由详情卡片全宽呈现，避免卡片列表与详情纵向生硬挤压；点击 `X` 或按 `Escape` 瞬间切回列表。
- **验证**：`svelte-check` 0/0、Desktop 结构与单元测试（223 项全量通过）。

### Changed: Desktop 自动任务详情面板统一平铺分栏与丝滑交互重构

- **根治平铺与覆盖逻辑不一致**：彻底移除 `@container (max-width: 880px)` 导致的临界突变规则与半屏遮挡弹层，在桌面端统一为纯粹自洽的左右平铺分栏（Split View）。左栏（280px~320px）收敛为任务导览列，右栏自适应展开为详情工作台。
- **剔除移动端拖拽把手与遮罩**：彻底移除怪异的手机端拖拽把手 `—`（`automation-detail-drag-handle`）与局部遮罩（`automation-detail-scrim`），消除一切视线遮挡；左侧卡片始终可见并支持一键切换。
- **丝滑过渡动画与快捷键**：详情面板新增 200ms 平滑滑入淡入动画（`automation-detail-slide-in`），支持点击常驻 `X` 按钮或键盘 `Escape` 瞬间退出并平滑恢复为三列 Bento 网格。
- **验证**：`svelte-check` 0/0、Desktop 结构与单元测试（223 项全量通过）。

### Changed: Desktop 自动任务与技能面板全系统主题动态配色适配

- **彻底清除 Hard-coded 颜色**：清查并移除了状态胶囊（`.row-outcome`）、任务行状态标记（`.automation-task-row-mark`）与技能图标（`.installed-skill-icon`）中误引入的所有硬编码 Hex / 自定义私有颜色（`#EDF3EC`、`#346538`、`#FBF3DB`、`#9F2F2D`、`#E1F3FE` 等）。
- **100% 遵从系统主题 Token 与动态计算**：
  - 严格映射至系统主题语义变量（`var(--online)` 完成、`var(--danger)` 失败、`var(--accent)` 运行/代码、`var(--warning)`/`var(--warning-text)` 待办/文档、`var(--skill-accent)` 设计/技能）。
  - 通过 `color-mix(in srgb, var(...) %, var(--fill))` 基于当前主题表面基底动态混合，去除多余的 `[data-theme="dark"]` 人工硬写色块，完美自适应系统所有主题（macOS Light/Dark、Rose Pine Dawn/Moon、Catppuccin Latte/Frappé、Midnight）。
- **静态机器守卫拦截**：在 `chat-ui.test.mjs` 中固化测试守卫，确保未来任何针对状态胶囊与技能色相的提交无法带入硬编码 Hex 颜色。
- **验证**：`svelte-check` 0/0、Desktop 结构与单元测试（223 项全量通过）。

### Changed: Desktop 工作区技能面板分类分流与精细化卡片重构

- **技能分类分流 Tab**：在技能中心顶栏引入 macOS 风格的分段控制分类栏（`.automation-category-tabs`），按「全部」、「内置 Skill」、「工作区」与「Agent 专有」四个维度实时统计与过滤技能，解决过去所有来源技能混杂平铺且难以检索的问题。
- **差异化语义图标与视觉层级**：消除所有卡片清一色 MagicWand 图标的视觉单调感，根据技能属性智能分配代码（Code/蓝色）、文档规范（FileText/橙色）、设计排版（Palette/紫色）、运行时与 Agent（Cpu/绿色）等语义图标与柔和背景色相；卡片增加来源与 MCP 服务徽标。
- **开关统一靠右对齐与冗余徽标精简**：移除卡片内与开关重复的「已启用/已禁用」文字 Badge，消除视觉干扰与错位；技能开关通过 `margin-left: auto` 统一严格对齐到卡片右上边缘。
- **就地启停与详情弹窗**：
  - 每个技能卡片集成原生无障碍 `IosSwitch`，支持在工作区内直接就地启停技能；内置技能有新版本时直接提供一键「更新」按钮。
  - 新增「详情」模态对话框（`<Dialog>`），清晰展示完整说明、作用域、挂载 Bot/Chat、MCP 服务以及版本状态。
- **验证**：`svelte-check` 0/0、Desktop 结构与单元测试（223 项全量通过）。

### Changed: Desktop 工作区外壳几何统一与小程序应用启动台卡片重构

- **工作区几何统一**：Desktop 核心工作区（自动任务、技能、小程序）从过去 1240px、全宽无限制拉伸、720px 窄条的分裂状态，统一对齐至 `--workspace-col: min(1240px, calc(100% - 48px))` 居中布局，消除侧边栏切换时的视口跳跃与呼吸感撕裂。
- **小程序应用启动台（A+A 模式）**：
  - **首屏重构**：将小程序页面从过去被开发者安装表单霸占首屏的表单列表，重构为现代 App Launcher 卡片网格（突出应用图标、名称、版本、运行状态徽章与一键「打开应用」主操作按钮）。
  - **安装器模态收敛**：右上角提供清晰的「+ 安装小程序」主操作，点击呼出原生 Dialog 对话框（包含内置推荐一键安装、本地目录导入、ZIP 文件解压与 GitHub 仓库安装），不再常驻霸占日常使用空间。
  - **安全与卸载交互原生化**：卸载应用（保留数据/清理数据）全面采用桌面端无障碍 `<AlertDialog>` 确认框，彻底替代了侵入式阻塞主线程的浏览器 `window.confirm`。
- **验证**：`svelte-check` 0/0、Desktop 结构与单元测试（223 项全量通过）、`chat-ui.test.mjs` 守卫同步更新并通过。

### Fixed: Project 会话内打开本轮文件不再丢失文件列表

- 在 Project 会话里点击"本轮文件"卡片（或其中的 scratch 文件，如生成的图片）时，右侧面板此前会整体切到 Session 作用域，只剩"本轮文件/文件"两个页签，文件树/变更/附件全部消失且无法返回。
- 现在面板作用域恒随会话面板：Project 作用域保持完整页签，Session 产物以自身作用域的页签在预览区打开（会话身份随面板传入 store，经既有授权路由加载）。面板内两套按作用域复制的预览区合并为按页签 scope 渲染的一套；store 仅在表面身份变化时整体重置，Project 内切换会话只回收上一会话的 Session 页签。
- 验证：`chat-ui.test.mjs` 作用域模型结构守卫重写（229 项通过）、`svelte-check` 0/0、production build 通过。

### Fixed: 文件树右键菜单 + 右键菜单支持复制绝对路径

- 文件树的行此前从未绑定 `oncontextmenu`（菜单回调传进了组件却没有接到元素上），右键一直无响应；现在文件树与变更列表共用同一套菜单。
- 右键菜单在"复制路径"（相对路径）旁新增"复制绝对路径"，由项目规范根目录拼接，根目录未知时置灰。
- 验证：`svelte-check` 0/0、Desktop 结构测试、production build 通过。

### Changed: 文件面板头部移除手动刷新按钮

- 文件树与 Git 状态本就实时监听自动同步（面板底部有状态提示），手动刷新按钮从未被使用，连同 store 的 `refreshAll()` 与双语文案一起删除；搜索（⌘P）与"跟随 Agent 改动"开关保留。
- 验证：`svelte-check` 0/0、Desktop 结构测试与单元测试、production build 通过。

### Fixed: 文件预览页签条右侧动作按钮统一靠右

- 折叠文件树与关闭全部页签两个按钮此前各自带 `margin-left: auto`，把页签条剩余宽度平分了；改为仅第一个动作吸收自由空间，两个作用域统一靠右排列。
- 验证：`svelte-check` 0/0、Desktop 结构测试、production build 通过。

### Fixed: 切换会话后右侧文件面板跟随新会话，不再残留上一会话状态

- 从 Project 会话切到 Web 会话时，右侧 Artifact 面板此前仍显示上一会话的本轮文件和 Project 作用域，点击旧文件会以空 Project id 请求接口、把路由 404 的整页 HTML 画进错误卡片。
- 现在 `ChatView` 以会话上下文 key 的响应式守卫"移植"打开中的 Inspector：文件/本轮文件/附件打开请求随上下文重置、scope 按当前面板重新派生，Mini App 面板存活语义不变；Project 身份读取 `projectsView` 投影避免 legacy `$:` 失踪跟踪（pitfall #2）。面板 turn 页签在列表清空时回退文件页签；`requestJson` 对非 JSON 错误体统一为简短的状态码信息。
- 验证：`chat-ui.test.mjs` 新增结构回归守卫；Desktop 全量测试（228 结构 + 全部单元）、`svelte-check` 0/0、production build 通过。

### Fixed: Artifact 面板 Markdown 预览的相对图片可正常显示

- leaf-bundle 形态的 markdown（`index.md` 与图片同目录，`![alt](xxx.png)` 相对引用）在右侧面板预览时图片不再破图：预览把相对图片引用解析到 markdown 文件所在目录，Project scope 经既有 raw 文件路由流式返回字节，Session scope 经 HTML 预览同款 artifact 路由，CSP `img-src` 相应放行 `molibot-artifact`。
- 绝对 URL、data URI、逃逸根目录的引用保持原样不重写；带 resolver 的渲染绕过 markdown 渲染缓存，避免不同目录的同内容文件互相污染图片。
- 验证：新增 `markdownImages.test.ts` 路径解析单测，完整 Desktop 测试（242 + 227 项）、`svelte-check` 0/0、production build 通过。

### Changed: Desktop 设置页内容列宽度对齐 Chat（576px → 720px）

- 设置中心所有页面（含通用设置、供应商工作台、数据页和记忆中心）的内容列从 576px 标准列统一放宽到与 Chat 会话列一致的 720px，页头标题与内容卡共享同一左边缘；窄窗口下仍按 `min(calc(100% - 56px), 720px)` 自适应收缩。
- 顺带把 6 处手抄的 `min(calc(100% - 56px), var(--settings-content-width))` 收敛为共享 token `--settings-col`，消除宽度表达式漂移的隐患；`DESIGN.md` 宽度规范同步更新。
- 验证：完整 Desktop 测试（含 UI 结构断言更新与 60 项 Rust 测试）、`svelte-check` 0/0 通过。

### Fixed: Project 受保护目录访问与本轮图片预览

- Project 根目录位于 iCloud、桌面或文稿等 macOS 受保护位置且访问被拒绝时，右侧 Artifact Inspector 提供原生目录重新授权；只能重新选择同一根目录，不会在修复权限时改写 Project。
- Project 会话中生成到 Session scratch 的图片保留 Session 文件作用域；本轮文件投影会在去重前合并工具回执的 scratch 文件名与自动上传附件的 `fileId/local`，再进入既有授权图片流，不再显示“文件当前不可用”。
- 新增真实生成图片双身份、目录权限分类、同目录校验和 Project-hosted Session 产物作用域回归测试；完整 Desktop 测试（含 60 项 Rust 测试）、`svelte-check` 0/0、production build 和服务重启恢复检查通过。

### Added: AI 供应商设置页自动替换品牌 Logo

- Desktop 设置中心的“AI 供应商”页面支持根据供应商的 ID 和名称自动匹配并渲染官方品牌 SVG Logo，覆盖 OpenAI、Anthropic / Claude、DeepSeek、Google / Gemini、Moonshot / Kimi、MiniMax、Qwen、Z.AI / 智谱、xAI、Groq、Mistral、OpenRouter、Together、Fireworks、Cloudflare、GitHub、Hugging Face、NVIDIA、Ollama、Bedrock、Azure、SiliconFlow 等数十种常见服务商。
- 未匹配品牌时无缝 fallback 回原有的彩色首字母圆形徽标，确保第三方或私有中转站点显示正常。
- 验证：`providerLogos.test.ts` 单元测试通过、Desktop UI 结构测试、`svelte-check` 0/0、Desktop production build 通过。

### Changed: Desktop Chat 渠道使用 Reicon 品牌 Logo

- Chat 左侧 Session 列表为 Telegram、QQ、微信和飞书使用对应的本地 Reicon SVG Logo（飞书使用 Doubao Logo），保持现有 16px 图标槽位和列表交互。
- 验证：Desktop UI 结构测试 219/219、`svelte-check` 0/0、Desktop production build 通过。

### Changed: Desktop Chat Web 使用 Safari 风格自制 SVG Logo

- Chat 左侧 Session 列表的 Web 渠道改用随包本地的彩色指南针 SVG，采用蓝青渐变和红白指针表现 Safari 风格，保持 16px 图标槽位与现有列表交互。
- 验证：Desktop UI 结构测试 219/219、`svelte-check` 0/0、Desktop production build 通过。

### Changed: Desktop 图标库统一迁移到 Reicon

- Desktop 外壳、聊天、设置、项目、Artifact、Mini Apps 与原始 DOM/HTML 图标边界统一从 Phosphor CSS 字体迁移为 `reicon-svelte`，保留状态、尺寸、颜色、动效和无障碍语义。
- 移除 Phosphor 字体入口、CSS 规则、依赖和 lockfile 记录；所有 Reicon 图标使用子路径导入，避免上游 barrel 的重复导出缺陷。
- 验证：Desktop UI 结构测试 219/219、完整 Desktop 测试、`svelte-check` 0/0、Desktop 与 root production build 通过。

### Changed: 用量 / Trace / 服务日志设置页宽度对齐标准列

- 三个页面从 720px"data page"宽列收回至与其它设置页一致的 576px 标准列（页头、KPI 卡、图表、过滤器全部对齐；服务日志页此前页头 720px / 卡片 576px 自身不一致的问题一并解决）；记忆中心保留 720px 数据列。`DESIGN.md` 宽度规范同步更新。

### Fixed: Desktop 沙箱设置页预设卡片布局

- 修复沙箱设置页"沙箱严格程度"预设卡片竖向堆叠、宽窄不一的样式错乱：上一轮设置页重构时组件 class 名更新（`sandbox-tier-grid` 等）但 `styles.css` 未同步，网格布局整体丢失。现已补齐卡片/标题/网格样式并删除全部旧名死规则；预设卡片默认 2×2 网格，窄窗口降为单列。

### Changed: Desktop Web Interface Guidelines 合规第二轮（键盘导航 / 读屏 / Intl / 未保存守卫）

- 全仓 a11y 合规第二轮：新增共享 `tablist` 键盘导航 action 应用到 18 处 tabs 与 2 处 radiogroup（方向键/Home/End + tabpanel 关联），约 35 处异步反馈补 `aria-live`，清理无效 listbox/tree/alertdialog 角色，`ConversationRow` 重构消除嵌套交互，右键菜单补键盘替代。
- 数字/日期全面走 `Intl`（新增共享 `formatTimestamp`/`formatDuration`），10 处手搓日期与 8 处 `toFixed` 替换；弹层补 `overscroll-behavior: contain`；`prefers-reduced-motion` 块补齐 6 个遗漏动画；生图/视频任务删除与排队消息移除改两步确认；新增 `unsavedGuard` 让 9 个设置页在窗口关闭/刷新前确认未保存更改；22 处 modal 关闭按钮 aria-label 从"取消"改为"关闭"（新增 `dialogClose` key）。
- 顺带修复 `RunActivity` 真实逻辑 bug：`isFailed` 恒 false 导致活动级失败状态永不显示。
- 验证：svelte-check 0/0，tsx 单测 233/233，node UI 测试 224/224，`vite build` 通过。

### Changed: Web 端与 Mini Apps 图标库统一切换为 Reicon

- Web 主应用（Svelte）从 `@lucide/svelte` 迁移到 `reicon-svelte`，Mini Apps（mini-chat / prompt-box）从 `@heroicons/react` 迁移到 `reicon-react`，两端统一为同一图标视觉体系（Solar 风格、Outline/Filled 双字重、MIT 许可）。
- 因 `reicon-svelte` 上游 barrel 存在 `Icon` 重复导出缺陷（会让生产构建失败），全部图标使用子路径导入（`reicon-svelte/icons/*`），约束记入 CLAUDE.md pitfall 45。
- 旧图标依赖已移除；Mini App 的 THIRD_PARTY_NOTICES 补充 Reicon 与 Solar Icons（CC BY 4.0）署名。
- Desktop 端 Phosphor（CSS 字体方案）迁移另行立项（prd.md §3.129），本轮未改动。

### Changed: Desktop 设置与客户端界面设计规范全面对齐（P0 / P1 / P2）

- **Web Interface Guidelines 全局审计与修复**：对照 Web Interface Guidelines 与 `DESIGN.md`，对 `apps/desktop` 全仓进行合规审计与修复：密码/API Key 输入框统一显式标注 `autocomplete="new-password"` 与 `spellcheck="false"`；技术/配置/搜索输入框标注 `autocomplete="off"`；装饰性图标元素补齐 `aria-hidden="true"`；遮罩与装饰层标注 `role="presentation"`；排版规范中省略号统一为 Unicode `…`；静态与头像图片补齐显式 `width`/`height` 防止布局偏移（CLS）。
- **设置容器宽度校准**：按照 `DESIGN.md` §420 布局规范，将 Desktop 设置页内容容器宽度 `--settings-content-width` 从 720px 统一校准为 576px，保留数据与图表视图 `--data-content-width: 720px`。
- **设置组件标准化**：全面迁移 Desktop 设置子页面中的零散 `.settings-card` 结构，统一采用标准化语义容器 `<SettingGroup>` / `<SettingRow>`，包含生图、视频、语音、搜索、Agent、Web Profile、Channels、MCP、Runtime 环境、Sandbox、Skills 以及诊断面板。
- **文案国际化修复**：修复生图、视频生成、语音合成设置页面中因复制粘贴导致的 `webSearchEnabled`、`webSearchDefaultEngine`、`webSearchApiKey` 错乱问题，补齐独立本地化字段（`imageGenerateEnabled`、`imageDefaultEngine`、`videoGenerateEnabled`、`videoDefaultEngine`、`videoTestEngine`、`ttsGenerateEnabled`、`toolApiKey`）。
- **Switch 控件统一**：彻底移除 `ModelsSection.svelte`（模型上下文压缩）与 `ChatView.svelte`（开机自启引导）中残留的手写 `<button class="switch">`，统一迁移至共享的 `<IosSwitch>` 组件。
- **状态指示本地化**：`ProvidersSection` 中的状态指示（`ON` / `OFF`）支持中英文国际化本地化显示（`providerStateOn` / `providerStateOff`）。

### Changed: 隔离预览重构为全屏灯箱

- 聊天气泡的「隔离预览 HTML / SVG」与表格查看器不再弹 900×720 的小窗，改为与图片灯箱一致的深色全屏观感：近全屏浮动舞台、悬浮格式标签与圆形关闭按钮、弹性缩放入场，并随系统减弱动态效果降级。
- 表格查看器按全屏阅读尺寸排版（13px、更宽松的行距与内边距），Inspector 内的同一查看器保持原有紧凑密度。
- 表格查看器支持点击表头排序：升序 → 降序 → 取消，带 `aria-sort` 与方向指示；百分比、千分位数字按数值比较，其余按本地化字符串比较（排序逻辑位于共享 `csvTable.ts` 并有回归测试）。
- 聊天 Markdown 表格的「在表格查看器中打开」不再作为表格上方的独立按钮，改为注入表格表头行末单元格的图标按钮（带本地化 aria-label 与 tooltip），点击行为不变。

### Fixed: 隔离预览 HTML 的脚本可正常运行

- 聊天气泡中“隔离预览 HTML / SVG”打开的预览 iframe 之前使用空 `sandbox`，导致页面 JS 全部失效；现在改为 `sandbox="allow-scripts"`，脚本可以执行，同时仍不带 `allow-same-origin`，预览页无法访问宿主 DOM、Cookie 与存储。

### Fixed: 本轮文件点击不再被面板初始化刷新误判为不可用

- Artifact Inspector 同时进行挂载刷新和点击刷新时，文件点击现在使用本次请求返回的 Session 文件记录；代次守卫仍只控制可见列表更新，不再丢弃调用方已经取得的结果。
- 修复了文件随后已出现在面板计数中，但首次点击仍提示“文件当前不可用”的竞态。

### Added: Desktop 会话搜索入口与轻量 Agent 快速开始

- 左侧栏折叠按钮旁新增唯一的全局搜索入口，统一检索 Web、Project、Telegram、飞书、QQ 与微信会话。
- 搜索支持“全部 / Web / 项目 / 其他渠道”范围筛选，外部渠道可继续细分；结果按来源分组并各自以 10 条为一页加载。
- 结果可直接进入对应 Web、Project 或只读外部会话，并显示所属上下文、匹配摘要和时间；标记为不可搜索的消息不会进入摘要匹配。
- 空白 Agent 会话新增三个轻量快速开始选项；选择后只填入并聚焦输入框，不会自动发送或覆盖已有草稿。

### Changed: “更多对话”按 10 条原地展开

- 各会话渠道默认显示 10 条记录；“更多对话”现在通过服务端游标追加下一批 10 条，不再跳转搜索界面。
- 后台列表重载会保留用户已展开的记录数量，追加加载期间也不会清空已有列表。
- 搜索界面升级为统一会话搜索后，旧的按 Bot 分组浏览器接口（`/api/desktop/conversations/groups`）已删除，统一走 `/api/desktop/conversations/search`。

### Added: Pi Provider Registry、请求级 Sampling 与 Telemetry Trace

- Web 与 Desktop 的 Provider 候选和内置模型目录改为由 Pi registry 派生，不再手工维护易漂移的静态清单。
- 自定义模型支持按请求传入 JSON sampling 参数，经细粒度设置、SQLite 持久化和 Pi runtime 原样传递；Web 与 Desktop 编辑器均提供中英文校验。
- Pi telemetry context 接入现有 Run/Trace，记录 Provider、模型、API、用量、首 chunk 耗时、终止原因和错误；`rawStopReason` / `endTurn` 同步保留在模型调用 Trace 中。

### Changed: Pi Runtime 升级到 0.84.3

- `pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 从 0.82.0 整体升级到 0.84.3，继续通过共享 PiRuntime 服务主 Agent、子 Agent、认证、模型路由与 compaction。
- 获得上游 OAuth 提前刷新与取消、模型目录竞态、严格工具 schema、reasoning/tool replay、截断恢复及模型目录更新；无关直接依赖保持原解析版本。
- OAuth 并发回归更新为使用越过 5 分钟提前刷新窗口的替换凭证；聚焦运行时测试与生产构建通过。

### Fixed: Chat 仅恢复 AI 消息的 Fork 操作

- AI 回复下方重新显示分叉按钮，可从该回复复制出独立子 Session；用户消息仍只保留复制与编辑。
- 主 Chat 与 Project Chat 共用同一角色边界，并恢复请求在途防重复、运行中与过期消息提示。

### Fixed: 普通 Session scratch 产物无需 attach 即可展示

- 普通 Session 的成功 `write/edit` 现在直接产生可持久化的 Session 文件回执；回复下方和右侧 Artifact Inspector 会展示并打开最终磁盘内容。
- `attach` 继续只负责发送附件。Agent 仅保存 HTML 并回复路径时，HTML 也会进入本轮产物列表并可预览。
- 文件服务只接受当前 Session scratch 根内、真实存在且被成功回执引用的文件。

### Added: 回复内本轮文件产物清单

- Agent 完成回复后，以单一列表展示本轮创建或更新的文件，并可直接在右侧 Artifact Inspector 打开最终内容。
- 清单基于持久化的工具产物回执和普通 Session 生成附件，不依赖 Git 快照；失败写入会被排除，同一文件会自动去重。
- 回复卡片与右侧面板复用同一列表组件，支持中英文和明暗主题。
- 修复同一生成附件同时出现在本轮文件卡片和旧附件条的问题，只保留本轮文件卡片。
- 修复普通 Session HTML 被原生 Artifact transport 当作无效请求拒绝的问题；Session scope 与真实长度的安全 token 现在可以转发，未知 scope 和超长 token 仍会被拒绝。

### Fixed: HTML 产物预览空白与 Session 列表每轮闪烁

- 新写入的 HTML 现在从活动卡片和 follow-the-agent 直接进入 Artifact Inspector 的沙箱页面预览；其它文件写入仍默认展示 Git diff。
- 自动 Session Title 总结只在第一条用户消息后运行，后续轮次不会因标题仍为默认值而重复调用模型。
- Desktop 后台刷新 Session 标题、排序和时间时保留现有列表行，不再短暂替换为加载占位。
- 增加 HTML 打开策略、非首轮标题跳过和静默列表刷新的回归守卫。

### Changed: 服务器默认端口由 3000 调整为 3040

- **统一默认服务端口**：将服务端运行时、设置默认值、桌面 Supervisor 守护进程、开发环境配置及相关文档中的默认端口从 `3000` 调整为 `3040`；
- **配置与多端对齐**：
  - `src/lib/server/app/env.ts` 与 `src/lib/server/settings/defaults.ts` 中的 `serverPort` / `PORT` 默认回退值更新为 `3040`；
  - `scripts/runtime/service-port.mjs` 中的 `DEFAULT_SERVICE_PORT` 更新为 `3040`；
  - `apps/desktop/src-tauri/src/supervisor.rs` 中的 `DEFAULT_PORT` 更新为 `3040`；
  - Web 系统设置页面（`src/routes/settings/system/+page.svelte`）与桌面端设置（`App.svelte` / `i18n.ts`）中文/英文提示文案同步更新；
  - `vite.config.ts`、`bin/molibot-manage.js`、`docker-compose.yml`、`Dockerfile`、`.env.example` 以及 `readme.md` / `readme.zh-CN.md` 中的默认端口全面对齐至 `3040`。

### Fixed: 项目文件面板图片与媒体即时更新及缓存击穿修复

- 修复在 Project 维度覆盖生成图片（例如 `1.png`）后，Finder 中文件已更新但从右侧文件面板打开仍显示旧图的问题；
- **Tab 动态版本戳与重载打通**：在 `ArtifactTab` 中添加 `version` 戳，在文件变更（Watcher 捕获）、用户从文件树再次点击或手动刷新时自动更新，确保磁盘最新变更即时同步；
- **URL Cache Buster 动态透传**：`desktopProjectRawFileUrl` 与 `desktopFileContentUrl` 支持透传版本参数 `&v=${version}`，`ArtifactPanel.svelte` 中的 `rawUrl` 与 `sessionStreamUrl` 基于 `activeTab.version` 动态派生，彻底击穿 WebKit `<img src>` 内存解码缓存；
- **强化流式响应缓存头**：`streamFileWithRange` 将 `Cache-Control` 设置为 `no-cache, no-store, must-revalidate`；
- **Web 端文件面板同步升级**：Web 界面 `buildPersistedFileUrl` 同步附带文件更新时间戳参数 `&v=...`。

### Added: Prompt Box（提示词箱）详情弹窗统一滚动与底栏按钮常驻修复 (v1.0.7)

- **详情弹窗统一平滑滚动**：将详情与编辑弹窗的 Astryx `Layout` 调整为 `height="fill"`，取消正文区域的独立 `max-height` 限制，使图片、标签与 Markdown 内容在 `LayoutContent` 内共同平滑滚动；
- **操作底栏始终固定可见**：确保弹窗底部的【编辑】、【复制】与【填入输入框】操作栏（`LayoutFooter`）牢固固定在弹窗底部，不再被超长图片或提示词遮挡；
- **外链图片全量正常渲染**：通过移除 `crossOrigin="anonymous"` 与放通宿主 CSP `img-src`，所有云端图片均正常且高清呈现；
- **图片即时解析与防盗链支持**：
  - 后端增加正文/描述图片兜底提取层，无需等待重新同步即可展示历史本地提示词的图片；
  - 为所有图片加载添加 `referrerPolicy="no-referrer"`，彻底解决外链图片 403 防盗链拦截；
  - 卡片右侧展示 `62x62px` 优雅圆角缩略图，点击即时弹出高清 Lightbox 大图预览；
- **多标签筛选与 5 维本地秒级排序**：支持多标签组合筛选（带标签提示词数量统计），支持按最近更新、最近创建、标题 A-Z / Z-A、内容长度等 5 种维度纯本地秒级排序；
- **创作与编辑体验优化**：
  - **标签 Chip 管理与常用标签推荐**：支持按键自动成词与标签删除，下方聚合展示已有标签，支持一键点击快选；
  - **Markdown 快捷模板工具栏**：支持一键在光标处插入动态变量 `{{variable}}`、图片模板 `![图片](url)`、链接、代码块与角色预设；
  - **编辑/实时预览双模式切换**：支持在【编辑】与【Markdown 实时渲染预览】间秒级切换；
  - **实时字符与词数统计 & 快捷键保存**：支持实时字数统计与 `⌘ + Enter` / `Ctrl + Enter` 一键保存；
- **一键填入聊天输入框**：支持在小程序卡片或详情页点击【填入输入框】，通过宿主 Bridge（`composer.insert`）无缝将提示词正文追加至主聊天输入框；
- **AI 消息右键存为提示词**：注册 `contributions.messageActions`（`save_prompt`），在聊天消息气泡右键或悬浮菜单提供【存为提示词】功能，自动提取消息/选区内容并生成带深度链接的反馈卡片；
- **现代响应式 Astryx UI**：使用 `@astryxdesign/core` + `@astryxdesign/theme-neutral` 全套组件构建，支持中英双语与明暗主题自适应。

### Fixed: 项目会话模型别名与设置变更实时同步修复

- 修复在“设置 › 供应商 / 模型”中修改模型别名或调整模型列表后，项目对话（Project Chat）及项目设置弹窗仍显示修改前旧别名的问题；
- **项目会话接入设置事件**：在 `ProjectChat.svelte` 与 `ProjectDetail.svelte` 中挂载 `SETTINGS_CHANGED_EVENT` 监听，设置保存后自动拉取最新模型列表，无需重启应用即可实时刷新；
- **激活模型标签别名优先**：`ProjectChat.svelte` 底部输入框当前激活模型标签优先读取 `activeModelOption?.alias`，与主会话保持一致；
- **服务端 textOptions 补充 alias**：修复 `desktopModels.ts` 中 `textOptions` 构造时遗漏 `alias` 字段的缺陷。

### Fixed: 项目大文件与未跟踪文件性能熔断及 UI 响应优化

- 修复在包含较多未跟踪文件（例如 454 个文件）的项目中打开大文件（例如 6.9MB 文本）时导致整个桌面应用卡死、窗口顶部无法拖拽的严重性能问题；
- **后端 Git Status 遍历熔断**：为未跟踪文件引入 256 KB 统计上限（`MAX_UNTRACKED_STAT_BYTES`），超大文件直接跳过内容读取并显示为 `+—`；小于 256 KB 的文件采用 Buffer 原生零分配字节扫描 `countBufferLines`，并采用 16 路并发批次处理；
- **前端代码与大文本安全降级**：超过 256 KB 的分片文本跳过 heavy 正则高亮，降级为纯文本转义；对单行超过 4,000 字符的极端长行做安全截断；将初次 DOM 渲染批次 `CHUNK_LINES` 调整为 500，全面释放 WebView 主线程；
- 保证大文件加载时事件循环随时响应，macOS 顶栏拖拽流畅无阻。

### Fixed: Note 便签明暗主题文字对比度与分享按钮样式修复 (v1.8.10)

- 修复信纸主题下底栏【分享】按钮在亮色主题下文字发白看不清的问题：调整为高对比度的棕黑文字 `#4a3828`、白色渐变背景与微投影，与纸张底色完美融合并保证清晰可读；
- 修复暗色主题下便签标题与搜索框、输入框文字颜色发暗看不清的问题：为暗色主题补充完整的 `.editor-title-input`、`.note-search`、`.note-input-title` 浅色高对比度样式（`#e6ded6`）与金色光标；
- 为暗色主题下的分享预览弹窗操作按钮（【复制文本】、【复制图片】、【保存图片】）补充深色拟物按压样式，提升各明暗主题下的可读性与质感；
- `manifest.json` 版本升级至 `1.8.10`。

### Fixed: Note 便签分享卡片品牌署名统一为 Moli Note 与宿主原生文件保存支持 (v1.8.9)

- 将 Note 便签分享卡片（Keep 主题与锤子/信纸主题）右下角与底部的品牌署名统一为 `Moli Note`，移除原 `Smartisan Notes` 与 `Note` 差异；
- 新增 `fileSave` 宿主能力协议（`molibot-miniapp-host-capability`），Mini App 点击【保存图片】通过 postMessage 请求宿主 Agent / Desktop 原生桥调用 `save_file_dialog` 弹出原生系统保存对话框，真实将 PNG 图片文件写入本地磁盘指定路径；
- `manifest.json` 声明 `host.capabilities: ["fileSave"]` 并升级版本至 `1.8.9`。

### Fixed: Desktop 左侧栏顶部红绿灯与工具栏区域窗口拖拽响应修复

- 修复 Desktop 端左侧侧边栏顶部区域（macOS 红绿灯及折叠按钮周围）无法点击拖动窗口的问题。
- 根因定位：`.sidebar-top-bar` 样式阻断（`pointer-events: none`）导致内部未显式设置 `pointer-events: auto` 的 `.sidebar-titlebar-drag` 无法捕获鼠标事件，且底层容器无拖拽绑定。
- 解决方案：为 `.sidebar-titlebar-drag` 补充 `pointer-events: auto` 与 `height: 42px` 铺满顶栏，并在 `ChatSidebar.svelte` 与 `SidebarShell.svelte` 中挂载原生 `startDragging()` 事件，实现顶部空白区域流畅拖动。

### Fixed: disabled External Subagent providers can no longer execute

- Codex and Claude Code provider switches are now enforced again immediately before `subagent` execution, including existing tool instances, direct provider tools, parallel tasks, and chains. A disabled provider is rejected before any child process starts.
- External Subagent prompt sections now mention only providers that are actually enabled, preventing stale or mixed-provider guidance from asking the Agent to call a disabled runtime.
- Added regression coverage for disabling Claude Code after tool creation and for the final rendered system prompt when only Codex is enabled.

### Fixed: Note 便签分享保存图片多重降级与剪贴板双保险

- 解决沙箱 iframe / 桌面端 WebView 拦截常规 a download 导致点击保存无反应的问题，采用二进制 Blob 下载与自动写入系统剪贴板双重保障；
- 增加保存/复制操作后的即时成功高亮反馈与右键/长按另存指引。

### Fixed: Note 便签分享图零留白无缝贴合与弹窗自适应包裹

- 移除分享图生成器中多余的外层背景 padding 和额外高度偏移，生成图直接作为 360px 便签纸卡片输出；
- 弹窗宽度调整为自适应紧贴卡片（最大 384px），弹窗 body 背景设为透明，彻底消除锤子与 Keep 主题下右侧和下方的多余突出与色差留白。

### Fixed: Note 便签编辑页 Markdown 预览内容被截断修复

- 修复编辑页 Markdown 预览误继承列表卡片 `line-clamp` 截断样式的缺陷，收紧卡片样式作用域并为 `.editor-preview-content` 赋予独立完整排版规则，确保预览时完整展示全部内容与滚动。

### Fixed: Note 便签分享弹窗层级与卡片紧凑排版

- 修复编辑页点击【分享】被遮挡在全屏编辑弹窗后方的层级问题，将分享弹窗 `z-index` 调整为 `2000` 并提供生成中按钮反馈。
- 分享卡片宽度从 `480px` 收窄至 `380px`，移除冗余线框与多余留白，文字左右居中对称、排版饱满紧凑。

### Fixed: Note 便签列表视图三行布局（一行标题、一行内容、一行标签）

- Note 列表视图重构为紧凑的 3 行卡片结构：标题单行截断、正文单行摘要（限高 20px / 24px）、标签栏单行横排，解决此前多段落撑高卡片的问题。

### Fixed: Chat 用户消息气泡上下留白对称性修复与操作栏 Fork 按钮移除

- **修复用户消息气泡上下留白不对称**：为 `.markdown-body` 补全 `.chat-markdown-segment:last-child > :last-child` 与 `:first-child` 的边距归零规则，消除 Markdown 内部段落末尾残留的 `10px` 下外边距，使用户消息气泡上下内边距达到完全一致对称的视觉效果。
- **移除用户消息操作栏 Fork 按钮**：移除用户消息 hover 操作栏上的分叉（`ph-git-branch`）按钮与无用分支绑定，仅保留复制与编辑，界面更加简洁。

### Added: Note 便签全屏编辑页 Markdown 渲染预览与模式切换

- Note 编辑页顶部动作栏新增 Markdown 预览切换按钮，支持在可编辑输入框与渲染后的富文本 Markdown 视图之间平滑切换。
- 预览模式即时渲染标题、代码高亮、表格、引用块、列表及富文本样式，并深度适配默认浅色/深色主题与 Smartisan 锤子信纸风格。

### Fixed: Note 便签小程序全屏编辑页光标过大与字号行高优化

- 修复 Note 小程序全屏编辑页正文 textarea 硬编码 `line-height: 32px` 导致光标被拉伸过大的问题；统一接入语义 token `var(--md-body-md-lh)`（20px/24px），光标高度精准自然。
- 将标题输入框从 `title-lg`（22px）优化为 `title-md`（16px），光标高度收紧至 20px。
- Smartisan 信纸主题横线网格与行高从 28px/32px 统一调整为 24px 精致网格，实现信纸横线、文字基线与光标的精准贴合。

### Fixed: Mini App 桌面路由防御性异常捕获与版本号对齐

- 在 `src/routes/api/desktop/miniapps/+server.ts` 的 `GET` 处理函数与 `badge/+server.ts` 的 `POST` 处理函数中接入细粒度 `try ... catch` 异常守卫与状态码映射，防止底层临时抖动时 SvelteKit 未捕获异常导致前端收到 500 Internal Server Error。
- 将 `builtin/meeting-notes/manifest.json` 版本号提升至 `2.3.0`，与用户磁盘已安装版本严格对齐，确保更新与加载校验正确。

### Fixed: External Subagent 设置页主题、高度与 Codex 安装状态

- Desktop 与 Web 插件宿主现在向自带设置页同步当前明暗模式和语义主题色；插件内容通过受校验的 resize 消息驱动 iframe 高度，不再使用固定 `520px` 高度和内层滚动区。
- Codex 与 Claude Code 的 Provider 开关默认锁定，加载设置后自动检测环境；检测失败或自定义路径变化会立即关闭并锁定对应开关，只有检测通过后才允许启用。
- 修复插件独立数据目录尚不存在时安装进程以该目录作为 `cwd` 而失败的问题；安装前会创建目录，并且 UI 只在 `{ success: true }` 后提示成功。失败原因直接展示，不再先误报安装完成、随后又提示 Codex 未安装。
- 修复 Desktop 将 Svelte 响应式代理直接传入插件 iframe、触发 `The object can not be cloned.` 并让已保存 Provider 开关显示为空的问题；设置值和密钥状态现在以可克隆快照跨越 WebView 边界。
- External Subagent 升级到 `0.2.2`；随包插件升级覆盖代码前保留带时间戳的 owner 副本，配置与数据目录不参与替换。

### Fixed: 测试环境持久化工作区隔离修复与根目录残留清理

- **单元测试隔离修复 ([runner.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/runner.test.ts)、[self-evolution.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/skills/self-evolution.test.ts))**：
  - 修复 `runner.test.ts` 中 `createRunnerForHookTest` 与 Hook 测试未指定独立临时目录导致回退到 `process.cwd()` 并直接在项目根目录生成 `chat-*` 文件夹的问题；
  - 为所有 Runner Hook 测试用例接入系统临时目录 `tmpdir()` 并在测试后安全隔离；
  - 移除 [.gitignore](file:///Users/gusi/Github/molipibot/.gitignore) 中针对 12 个泄漏测试目录的临时 ignore 补丁规则；
  - 彻底清理项目根目录遗留的所有 `chat-*` 测试文件夹。

### Improved: Note 便签标签收纳至顶栏下拉菜单与高度抖动修复

- **Note 便签小程序 (v1.8.0)**：
  - 移除主界面常驻横向标签栏，彻底消除点击不同标签时标签栏的高度伸缩与样式抖动；
  - 将标签筛选能力完整收纳进顶栏“笔记 / 归档”切换下拉菜单中，支持分类显示【笔记】、【归档】与动态【标签】列表；
  - 菜单项高度严格统一（`36px`），点击选中任意标签后顶栏标题联动，可一键随时切回全部笔记。

### Improved: 内置小程序体验增强（Todo 待办快捷日期与一键清空、MD Preview 公众号新主题与字数统计）

- **Todo 待办小程序 (v1.8.0)**：
  - 新增【今天】、【明天】、【下周一】快捷截止日期胶囊，点击一键自动填入，免除繁琐展开日历选择；
  - 已完成列表新增【清空】快捷操作按钮，提供 `POST /todos/clear-completed` 路由与 `clear_completed` Agent 工具，支持一键清空已完成待办；
  - 样式全面统一至 Material 3 语义 token 与明暗模式自适应。
- **MD Preview 公众号排版小程序 (v1.2.0)**：
  - 新增 `geek-mint` (极客薄荷) 与 `warm-amber` (暖橙知秋) 两款流行排版主题；
  - 顶栏增加实时文章字数与预计阅读时间（分/秒）统计指示胶囊；
  - 优化公众号富文本复制与主题选择指示。
- **Mini Chat 轻量对话小程序 (v1.1.0)**：
  - 更新版本号并优化跨端通信与交互。

### Fixed: 服务启动时 sanitizePluginEntries 缺失引用导致的崩溃问题

- **修复模块导入缺失**：
  - 修复 `src/lib/server/settings/store.ts` 在加载和序列化插件配置时调用 `sanitizePluginEntries` 但未从 `$lib/server/settings/sanitize.js` 导入的问题，彻底解决服务启动时 `ReferenceError: sanitizePluginEntries is not defined` 导致的桌面与后台服务 crash。
  - 清理 `src/lib/server/settings/handlers/plugins.ts` 中多余的未用导入，修复 `src/lib/server/settings/store.test.ts` 中的测试用例与清理残余代码。
  - 修复桌面前端 `PluginsSection.svelte` 与 `api.ts` 的类型定义与组件属性检查，确保 `svelte-check` 0 错误 0 警告。

### Improved: 思考过程状态解耦与会话切换触底定位优化

- **思考过程宏微观状态解耦**：
  - 顶层折叠卡片状态改由整轮交付结果驱动，单步探索性试错（如尝试读取不存在的文件）只要最终顺利产出回答，顶层摘要始终显示 `✓ 已完成操作`，杜绝误报警告；
  - 展开后依然诚实保留每一步工具的详细执行与报错状态；仅在整轮真正硬性报错或中断时才显示 `⚠ 操作遇到问题`。
- **会话切换默认瞬时触底**：
  - 引入会话切换锁，在切换会话时立即瞬移到底部并抑制布局计算产生的 synthetic 滚动，杜绝“回到最新”悬浮按钮闪现，确保每次打开任意会话永远直接落在最新一行。
- **自动化测试**：
  - `stickToBottom.test.ts` 与 `transcript.test.ts` 单测全量通过；`chat-ui.test.mjs` 桌面测试 214 项 + 56 项 Rust 测试全量通过。

### Improved: 工具执行波浪律动动画与工具类型专属图标

- **优雅波浪等待动画**：
  - 彻底替换原先在时间线上偏心旋转晃动的“转圈圈”动画；
  - 引入专为时间线节点设计的 `.timeline-wave-node` 3 柱律动波浪动画，在时间线节点上完美居中起伏；
  - 在 `TurnProcess` live 过程摘要与 `RunActivity` 中全面应用，并在减弱动态效果（reduced motion）模式下优雅降级。
- **工具类型专属 Icon**：
  - 在 `activityView.ts` 中实现 `activityToolIcon`，精准映射终端命令（`ph-terminal-window`）、文件写入（`ph-pencil-simple-line`）、文件读取（`ph-file-text`）、搜索（`ph-magnifying-glass`）、目录（`ph-folder-open`）、网络（`ph-globe`）、记忆（`ph-brain`）、子代理（`ph-tree-structure`）、小程序（`ph-cube`）、MCP（`ph-plug`）等工具类型；
  - 在 `ProcessActivityItem` 与 `RunActivity` 的操作标题前展示对应语义图标，执行中呈现品牌高亮。
- **自动化测试**：
  - `activityView.test.ts` 新增 17 项工具图标映射单测全部通过；`chat-ui.test.mjs` 桌面测试 214 项 + 56 项 Rust 测试全量通过。

### Improved: 内置小程序体验全面优化（Note 便签与 Meeting Notes 会议纪要）

- **Note 小程序 (v1.7.0)**：
  - 修复便签编辑页光标过大问题（行高与内边距调整为 24px/28px 与文字基线对齐）；
  - 修复分享图片在桌面 Webview 无法保存问题，新增【保存图片】、【复制图片】与【复制文本】操作按钮；
  - 新增标签胶囊筛选栏（`#tag-filter-bar`）与实时字数统计。
- **Meeting Notes 会议纪要 (v1.3.0)**：
  - 新增 `GET /meetings/:id/audio` 音频流服务与现代卡片式音频播放器（支持播放/暂停、进度拖动、倍速 1.0x-2.0x 切换）；
  - 新增逐字稿音字同步高亮与单句点击跳转播放；
  - 新增语音识别错误归因与一键重试全部转写（`POST /meetings/:id/retry-transcription`）；
  - 支持一键下载完整 `.wav` 会议录音与导出 `.md` 会议纪要文件。

### Improved: Chat 思考内容展示逻辑优化（默认折叠、流式自展开、回复后收起与会话切换保持）

- **历史与切换会话默认折叠**：
  - 移除已完成回合 `<TurnProcess>` 的 `forceOpen` 强制展开判定，确保历史消息以及切换会话重新挂载时思考过程始终保持默认折叠状态（`opened = false`）；
  - 避免因个别步骤带有异常状态标记而导致整个卡片被强行撑开的问题。
- **流式回复时按需主动展开与正文出现后平滑收起**：
  - 仅在 Live 流式且未产生回答正文时（`!liveSections.response.length`）才主动打开展示思考时序，一旦正文回答或 Plan 块开始输出即刻平滑折叠；
  - Web 端 `switchSession` 彻底重置残留的流式思考与诊断状态，避免跨会话切换后流式思考块污染。
- **支持随时手动展开/折叠**：
  - 用户随时可点击思考摘要卡片自主查看完整的思考与工具执行详情。
- **自动化测试**：
  - `chat-ui.test.mjs` 新增针对 Transcript 中已完成消息保持默认折叠、Live 视图按需展开的回归断言；214 项桌面测试全部通过，`desktop:check` 0 错误 0 警告。

### Added: Desktop 端侧边栏折叠按钮、变窄自动吸附折叠与平滑过渡动画

- **顶部折叠与展开按钮**：
  - 在左侧侧边栏顶部（与 macOS 红绿灯同高度右侧）添加折叠按钮（`ph-sidebar-simple`），点击即可平滑收起侧栏；
  - 侧边栏折叠时，在主内容区顶部标题栏（`chat-header`、`workspace-header`、`ProjectDetail` 头部）左侧（已为 macOS 红绿灯留出 84px 安全边距）展示展开按钮，点击即可平滑展开；
  - 新增全局快捷键 `Cmd+B` / `Ctrl+B` 快速切换侧边栏折叠状态。
- **Title 栏与控制按钮垂直对齐 macOS 红绿灯**：
  - 将 `chat-header`、`window-drag-mask` 及侧栏顶部从臃肿的 60px 收敛为精致统一的 42px 高度；
  - 修复 `window-drag-mask` 遮挡按钮点击事件的层级问题，确保折叠/展开按钮、Title 及所有操作区 100% 可点击响应；
  - 微调 macOS 原生红绿灯按钮垂直坐标（`trafficLightPosition: { x: 18, y: 20 }`），将系统三色控制按钮与右侧折叠按钮（`sidebar-collapse-btn`）、展开按钮、Title 标题文字及操作按钮精准拉平在同一水平中心线（y: 21px），解决系统按钮偏上、高低错落的问题。
- **拖拽至最小宽度防挤压与平滑吸附折叠**：
  - 手动向左拖拽侧边栏分割条（`sidebar-resizer`）达到最小宽度（228px）时，侧边栏宽度稳固锁在 228px，坚决不再单独往内挤压变形（防止文字折行、图标挤压）；继续向左拖拽越过触发阈值（160px）时，直接平滑触发整栏收起折叠动画；
  - 重新展开时自动恢复用户原本设定的理想宽度（默认 228px 或最后设定的宽度）；
  - 窗口尺寸缩窄至 `<= 820px` 紧凑模式时自动折叠侧边栏以保障会话区域宽度，拉宽窗口时自动恢复；
  - 记忆用户折叠状态（`molibot-desktop-sidebar-collapsed`）。
- **流畅过渡动画与直接操控零延迟**：
  - CSS Grid 轨道与 `transform: translateX(-100%)` / `opacity` 联动硬件加速，带来丝滑顺畅的展开/折叠过渡动画；
  - 拖拽调整宽度时（`resizingSidebar`）自动关闭 transition（`transition: none !important`），确保 120fps/60fps 实时跟手零延迟。
- **右侧面板 Header 高度统一为 42px**：
  - 将右侧文件/小程序面板（`.file-panel-head`、`.artifact-panel .file-panel-head`）以及任务检查面板（`.durable-inspector-head`）的头部高度从 60px/68px 统一缩减为 42px（垂直居中 y: 21px），与左侧 Chat 标题栏、侧栏顶部及 macOS 红绿灯无缝在一条水平线上对齐，消除下坠错落感。
- **彻底解决变窄时 Chat 区域被隐藏与空白列问题**：
  - 根因：媒体查询 `@media (max-width: 1000px)` 将 `.chat-sidebar` 置为 `display: none`，但 `.chat-layout.sidebar-collapsed.with-files` 复合选择器因高特异性仍强制应用 3 列 Grid，导致第一列（0px）吞掉了 Chat 区域，第二列渲染文件面板，第三列变为空白列；
  - 修复：统一在窄屏媒体查询中声明双列自适应 Grid `minmax(0, 1fr) minmax(var(--files-min-w), var(--files-w, 280px))`，确保 Chat 区域任何时候绝对不会被隐藏或遮挡，始终占据可用空间。
- **文件面板默认宽度与紧凑调整**：
  - 将文件面板首次打开的初始默认宽度从过宽的 `380px` 调整为适中的 `280px`（最小 `240px`，最大 `720px`），大幅减少对中间 Chat 区域的压迫感，并持续支持拖拽分割条自定义调整。
- **左右两侧面板丝滑过渡与无缝直接铺展**：
  - **左侧导航平滑折叠/展开**：重构 `.chat-sidebar` 的宽度与透明度过渡体系（`width/max-width/padding 240ms cubic-bezier(0.2, 0, 0, 1)` + `opacity 180ms ease`），彻底移除导致首帧瞬间消失的无序隐藏，实现左侧导航栏像抽屉般自然平滑地折叠收起与滑出展开；
  - **右侧文件/小程序面板关闭直接铺展**：彻底移除退出延迟定时器与中间空白过渡态，关闭面板时左侧 Chat 内容区瞬间无缝铺满整屏，杜绝任何透明幽灵留白与视觉停顿。
- **自动化测试**：
  - `chat-ui.test.mjs` 新增针对折叠按钮、展开按钮、吸附阈值（160px）、快捷键（`Cmd+B`）及两侧面板平滑动画 CSS 规则的回归测试；214 项桌面测试 + 56 项 Rust 测试全量通过，`desktop:check` 0 错误 0 警告。

### Improved: Desktop 端思考流自动折叠与屏幕变窄视口底部自动吸附（防跑焦）

- **屏幕变窄视口底部自动锚定**：
  - 在 `stickToBottom.ts` 中引入 `ResizeObserver` 监听滚动容器几何重排与尺寸变化；
  - 窗口变窄、侧边栏拖拽或多栏分屏导致文字折行、内容总高 `scrollHeight` 增加时，只要用户处于底部（`pinned === true`），即刻自动同步更新滚动高度 `scrollTop = scrollHeight - clientHeight`，保证视口永远牢牢吸附在最后一行，彻底消除焦点下坠与内容丢失问题。
- **思考流时序收起与完成折叠**：
  - 在 `conversationController.svelte.ts` 的 `onDone` 中兜底同步正文与思考步骤至 `liveSteps`，确保在任何返回形态下 `liveSections.response` 均能触发 `TurnProcess` 自动收起；
  - 同步优化 Web 端 `+page.svelte` 在 `phase: "end"` 及 `done` 时的思考块折叠标记。
- **自动化测试**：
  - `stickToBottom.test.ts` 新增针对 `ResizeObserver` 尺寸变化时自动吸附与非锁定态不干扰的回归测试；全端 213 项桌面测试通过。

### Fixed: plugin catalog blank state and External Subagent package-owned settings

- Fixed the contract plugin APIs to use the live Runtime settings interface. Server failures now surface in the Web page instead of being swallowed as an empty plugin list.
- Fixed the Web catalog crash caused by calling the nonexistent `locale.get()` method on a Svelte writable store; the real page now renders returned plugins instead of remaining blank.
- Replaced inline plugin forms with a compact catalog and dedicated pages while preserving pi extension install/reload/toggle/uninstall management. Memory and Daily Materials are visible as auto-installed built-ins with dedicated settings routes, while Cloudflare HTML and External Subagent are discovered from package directories.
- External Subagent now ships its own bilingual custom settings UI and declared detect/install/test actions, built as a self-contained release artifact. Its enablement stays in host settings; its fields and runtime files live under isolated plugin config/data roots and survive a cold restart.
- Fixed the native Desktop catalog to merge core and contract plugin APIs instead of reading only contract packages. The packaged app now shows Memory, Daily Materials, Cloudflare HTML, and External Subagent, and opens each configuration in an in-app detail page.
- Added the narrow Tauri HTTP capabilities required by both plugin API families and a `molibot-plugin://` UI-only transport for package-provided settings. The CSP names that fixed origin without granting iframe access to arbitrary localhost services.
- Added Web/Desktop custom-UI bridges, manifest action allowlists, disabled-action enforcement, payload validation, atomic owner-only secrets, and regression coverage for the real HTTP, persistence, worker, Tauri, and cold-start seams.

### Documented: plugin-owned settings and independent storage

- Added a planned PRD for replacing accordion plugin forms with dedicated plugin routes, allowing enhanced pi/Molibot packages to ship their own settings UI and actions without Core-specific code.
- The proposed persistence contract keeps only plugin enablement in global RuntimeSettings and separates replaceable code, durable configuration, durable domain data, and disposable cache under the owner-global `DATA_DIR`. External Subagent is the first required migration; no runtime behavior changed in this documentation-only slice.

## 2026-08-21

### Added: External Subagent 一键真实可用性测试（Test Run）

- **问题**：「检测环境」只证明二进制存在，不证明能跑；已出现检测显示可用、执行时失败的假可用（协议不兼容 / 认证缺失 / 二进制损坏）。
- **修复**：Web 与 Desktop 设置页 Codex / Claude Code 行新增「测试运行」按钮 -- 复用 `tools.ts` 共享的 `ExternalSubagentRuntime`（pitfall 21：探活必须走真实运行时），在 `mkdtemp` 隔离目录跑一次最小真实任务（`Reply with exactly: OK`），完整经过 wire 协议 + 认证 + provider 选择，120s 上限（`PROBE_TIMEOUT_MS`）。只有 `stopReason === "completed"` 且有输出才算通过；测试失败时徽章强制显示红色「测试失败」+ diagnostic，覆盖绿色检测态；传输层异常同样判失败。
- **接口**：两端 `POST /api/{settings,desktop}/plugins/external-subagent` 支持 `action:"test"`（缺省仍为 install，向后兼容），permissionMode 取自已保存设置，自定义路径接受表单未保存值（与检测语义一致）。
- **验证**：`probe.test.ts` 4 用例全过（通过判定 / error 失败 / not_installed+timeout / 异常时清理临时目录）；`svelte-check` 0 错误 0 警告；`vite build` 通过。

### Optimized: 桌面端与发布包体积缩减 90% & 全局 Source Map 源码防泄露

- **构建防累积守卫**：在 `package.json` 的 `build` 与 `clean` 脚本中增加构建前自动清理 `build` 与 `.svelte-kit` 目录，彻底杜绝历史带有随机 Hash 的 chunk 文件持续单调累积。
- **Source Map 源码防泄露**：
  - `vite.config.ts` 中显式配置 `sourcemap: false` 与 `minify: "esbuild"` 代码压缩；
  - `bin/molibot-release.sh` 中在生产打包完成后全局清理所有 `.map` 文件（包括 node_modules 第三方 map），彻底杜绝从安装包逆向出原始 TypeScript 源码的风险。
- **恢复 `--no-optional` 精简依赖**：在发布包的 `pnpm install --prod` 中恢复 `--no-optional`，精简多余的跨平台 native binding。
- **实测成果**：`molibot-runtime.tar.gz` 从 **555 MB** 降低到 **51 MB**；生产解压目录从 **2.7 GB** 降低到 **319 MB**；产物中 `.map` 源码映射文件彻底清零。

### Fixed: External Subagent 一键安装在 .app / 桌面上下文下报 `spawn npm ENOENT`

- **症状**：Desktop 一键安装 Codex / Claude Code 时，install endpoint 抛出 `Failed to spawn npm: spawn npm ENOENT`，终端里 `which npm` 正常。原因是 Tauri `.app` 启动的 Node 进程不继承用户 shell 的 `PATH`，homebrew / nvm / fnm / asdf 安装的 `npm` 都解析不到。
- **修复**：在 `package/external-subagent/src/resolver.ts` 模块加载时调用 `fix-path`（sindresorhus，macOS 读登录 shell、Linux/终端 no-op、Win 读注册表 App Paths），补齐 `process.env.PATH`。这样 `findExecutableInPath("codex")`、`pnpm --version` 探测、最终 `installProviderRuntime` 的 `spawn(packageManager, …)` 全部用上修复后的 PATH。
- **结构保护**：新增 `package/external-subagent/test/resolver.test.ts` 守住三件事 —— 模块顶部导入并调用 `fixPath()`；`installProviderRuntime` 的 spawn 仍传 `env: process.env`（不丢 PATH）；`fixPath()` 幂等不破坏已存在 PATH。任何回归（删 import / 改 env / 改调用位置）任一断言失败即知。
- **没改 `bin/molibot.js`**：那里 `spawn("npm", …)` 是 `pnpm run dev` 的入口，只在终端跑，自带完整 PATH，不踩此坑。

### Improved: Web 聊天界面 Agent 多轮思考流式分段与完成自动折叠

- **彻底消除视口跳动**：将思考、工具活动与正文输出重构为自上而下单向生长的独立时序块（Streaming Blocks），单向追加，杜绝顶部大框反复伸缩对正文的挤压。
- **完成即自动折叠**：思考流式生成时实时展开展示；进入工具执行或正式输出正文时，前面的思考块自动收起为精致小胶囊（`🧠 已完成思考 · 点击展开`），固定高度并支持随时手动展开。
- **后端完整多轮思考保真**：后端 `/api/stream` 支持多轮 Agent 循环中多次思考的完整拼接与 `thinking_state` 显式事件通知。

## 2026-08-20

### Added: External Subagent 内置插件（OpenAI Codex & Claude Code 一体化子 Agent）

- **独立子包与运行时解耦**：创建独立包 `package/external-subagent`（`#external-subagent`），提供进程生命周期管理 `ManagedProcess`、`JsonRpcLineTransport`、Codex wire 适配器与 Claude Code SDK/CLI 适配器。主 Molibot 依然保持在 pi runtime 上，现有 pi `subagent` 行为不变。
- **按需与动态解析机制（方案 3）**：SDK 不强行内置打包 500MB+ 原生二进制文件，支持检测系统 PATH（`codex` / `claude` CLI）、自定义路径、或按需安装到 `~/.molibot/runtimes/external-subagent`。
- **全生命周期安全与进程树隔离**：
  - 环境变量白名单过滤（`environment.ts`），严格阻断不相关的认证凭据（Telegram, Feishu, QQ, 数据库, MCP 等）；
  - 全进程树级终止（POSIX 进程组 / Windows `taskkill /T /F`），先 SIGTERM（grace 3000ms）后 SIGKILL，杜绝孤儿/僵尸进程；
  - 统一超时与取消机制，精确区分用户取消（`aborted`）与超时（`timeout`）；
  - 仅返回首尾压缩文本（最大 ~6000 字符）与结构化诊断，防止原始 stderr、协议交互与多轮思考污染主模型上下文。
- **深度整合至内置 `subagent` 工具**：
  - 将 `claude-code` 与 `codex` 作为一等公民角色（First-class Roles）直接接入内置的 `subagent` 工具；
  - 主模型无需额外多记工具，只需调用 `subagent({ agent: "claude-code", task: "..." })` 或 `subagent({ agent: "codex", task: "..." })`；
  - 原生支持链式协作流水线（如 `chain: [scout -> claude-code -> reviewer]`）；
  - Plan 模式自动过滤写操作外部子 Agent，维持安全只读边界；
  - Web 与 Desktop 均提供运行时环境探测卡片与一键安装，设置支持 SQLite round-trip 持久化。
- **发布打包**：`bin/molibot-release.sh` 移除 `--no-optional`，确保可选平台二进制依赖正常支持。

### Added: 按需图片识别与多 API 引擎路由

- 图片不再在入站解析时一次性转成文字：视觉主模型直接读取原图，纯文本模型通过 `read(path, prompt)` 按需、可重复识别。
- 新增独立图片识别模块和有序 API 引擎故障切换；PDF OCR 同步复用该模块，旧 `imageAnalyze`/`visionAnalysis` 路径已删除。
- Web 与 Desktop 图片设置页新增“图片识别”Tab，可配置多个引擎、优先级、默认模式并上传图片测试；Desktop 使用安全投影、精确网络权限和可恢复的断线状态；CLI adapter 计划在第二期启用。
- Feishu、Telegram、QQ、微信和 Web 统一为附件持久化/规范化职责，识别逻辑留在共享 Agent 层。

### Fixed: Desktop 图片识别引擎编辑与 Tab 对齐

- 修复第二个及后续识别引擎在输入名称时自动折叠：展开状态现在独立于会被输入更新替换的引擎数据，新添加的引擎会持续保持展开。
- 图片生成/识别 Tab 使用与设置卡片相同的共享内容列宽，宽屏和窄屏下左右边界保持一致。
- 增加结构守卫，防止再次使用数组位置直接控制响应式 disclosure 的展开状态。


### Improved: 优化 AI 回复底部状态条（总耗时精确计算、Token 紧凑展示与纯净模型名）

- **总耗时端到端精确统计**：重构 `transcriptTurnSummary` 计算逻辑，精准计算从对应用户提问发出到 AI 回复生成的端到端总时间，彻底解决原先仅累加 Tool Activities 导致耗时显示偏少的问题；
- **Token 紧凑易读格式**：引入 `formatCompactTokens`，将原本显示为长串数字的 Token 计数自动精简为 `17k`、`1m`、`3.6m tokens`，大幅提升状态条整洁度；
- **纯净模型名称展示**：底部信息栏自动去除服务商前缀（如 `Cli Proxy API · `），与聊天输入框保持一致只展示纯净模型名（如 `Gemini 3.7 Flash High`）。

## 2026-08-19

### Improved: 统一右侧 MiniApp 面板与全局滚动条为极简细窄风格

- **问题与根因**：右侧小程序面板（如便签 Note、待办 Todo 等）运行于独立的 iframe 沙箱中，此前未定义滚动条 CSS 规则，导致在 WebKit / WebView 环境下直接渲染了 15~16px 宽度的原生厚重滚动条；而主应用的文件面板与聊天窗采用的是 4~6px 的半透明细窄滚动条，视觉风格割裂且右侧遮挡内容较多。
- **优化方案**：
  - 将各 Mini App 顶层 `html, body` 锁定为 `height: 100%; overflow: hidden;`，完全交由小程序内部的主体容器（便签列表、全屏编辑框、会议记录列表等）自主管理滚动，彻底消除外层 iframe 的冗余外层滚动条；
  - 在 Mini App 共享设计基线以及所有内置小程序（Note、Todo、Meeting Notes、MD Preview、Mini Chat 及 miniapp-creator 模板）中注入统一的极简细窄滚动条样式（`6px` 槽宽、透明轨道、圆角全胶囊半透明滑块、悬停高亮、明暗及暖色主题自适应）；
  - 将 Desktop 主应用全局滚动条样式同步收窄优化至 `6px`；
  - 升级所有内置 Mini App 的 patch 版本，并在 `uiDesignBaseline.test.ts` 与 `chat-ui.test.mjs` 中加入自动化守卫断言。

### Fixed: 修复 Desktop 切换/打开历史会话时短暂闪烁「未配置可用文本模型」警告的问题

- **问题根因**：`ChatView.svelte` 在响应式计算 `modelReady` 时将 `&& !modelSelectionHydrating` 耦合在一起。当用户点击打开历史 Session 时，前端异步请求该 Session 的独立模型配置，期间 `modelSelectionHydrating` 为 `true`，导致 `modelReady` 被计算为 `false`，使得输入框上方的 `ChatInputArea` 误认为全局未配置模型并短暂弹出了警告横幅。
- **修复方案**：解耦 `modelReady` 与 `modelSelectionHydrating`，`modelReady` 仅严格表达系统是否存在合法模型配置；`modelSelectionHydrating` 独立负责禁用输入组件、选择器和 `sendMessage` 守卫，避免竞态与误报。
- **验证**：Desktop 单元测试全部通过，`svelte-check` 0 错误 0 警告。

## 2026-08-18

### Fixed: 审批等待改为挂起与异步恢复机制，消除内联等待超时与卡死

- **问题根因**：
  - 审批等待（如 MCP 工具）此前直接阻塞在内联 5 分钟轮询中，且整个等待时间被外层工具超时（如 `mcpInvoke` 的 300s 预算）计入；当用户超过 5 分钟未审批时，外层时钟超时直接杀掉当前 Run，但前端卡片仍显示为 pending，用户后续点击批准也无法唤醒已被杀死的 Run（Session `s-20260818-vtjv`）。
  - 处于等待中的 Run 被取消时，审批请求未落盘终态，导致死 Run 的审批永远 pending。
  - 聚合审批请求生成的 Grant 强行绑定了包含批次指纹的 `actionFingerprint`，导致后续单次调用的指纹永远无法命中，使得用户选的「本会话允许」反复失效。
- **架构重构与修复**：
  - **30 秒短握手窗口**：`ToolRuntime` 审批等待缩短为 30 秒（`BROKER_APPROVAL_INLINE_WINDOW_MS = 30s`）。用户即时点击在 30 秒内直接内联执行；超过 30 秒则将当前 Run 干净挂起为 `waiting_for_approval` 状态并退出，释放所有连接和租约，不再消耗工具超时。
  - **异步恢复（`brokerApprovalResume.ts`）**：在用户通过 Web (`/api/chat` 的 `/hosttools`)、Desktop (`/api/desktop/host-bash`) 或 Channel 回调异步批准后，自动改写上下文中的挂起 `toolResult` 并复用原 `runId` 发起恢复轮次，无缝继续任务。
  - **请求终态管理**：Abort / 取消时通过 `ApprovalService.expireRequest` 将请求标记为 `expired`。
  - **Grant 匹配粒度修正**：非 write 类工具的 Grant 仅按 capability + actor + scope 匹配，彻底修复制聚合卡片批准后后续调用无法复用的问题。
- **验证**：`toolRuntime.test.ts`、`approvalBroker.test.ts`、`brokerApprovalResume.test.ts` 全部测试通过，SvelteCheck 0 错误。

### Improved: 审批中心全面重构（Host Bash 泛化为全能力统一审批与白名单中心）

- **需求背景**：原 Host Bash 审批系统仅检索和展示命令行操作（硬编码 `capability LIKE 'bash:%'`），导致用户在 Auto/Sandbox 模式下审批通过的 MCP 工具调用（如 OpenConnector）、文件修改（`write`/`edit`）和应用插件操作无法在设置页查看、管理长期白名单和审计历史。
- **架构与服务端重构**：
  - **全动作分类推断与聚合**：`HostBashStore` 升级为通用审批存储层，支持全量动作分类（`bash` / `mcp` / `file_write` / `miniapp`），自动推断动作类型与结构化参数（`payload.path`、`payload.diff`、`payload.parameters`）。
  - **全能查询与白名单支持**：移除所有 SQL 强制 `bash:%` 前缀过滤，`listPending`、`listWhitelist`、`listHistory`、`hasAnyData` 支持按分类（`category`）、状态（`status`，含 `expired` 超时态）、模式（`approvalMode`）与关键词联合查询。
  - **卡片持久化 Scope 解锁**：`toolRuntime.ts` 与 `approval.ts` 优化，根据 Tool Policy 的 `scopeOptions`（`["once", "session", "persistent"]`）为 MCP、文件修改等工具开放持久化选项（`approve_persistent`），支持“本 Bot 一直允许 / 本项目一直允许”。
  - **统一 API 接口**：新增 `/api/settings/approvals` 统一接口，保留 `/api/settings/host-bash` 并增加 `category` 筛选支持。
- **Web 端与 Desktop 界面升级**：
  - **Web 端 (`/settings/approvals`)**：侧边栏更名为「审批管理」，提供全部/命令行/MCP工具/文件修改/应用插件分类切换，定制化彩色徽标与参数展示，`/settings/host-bash` 自动平滑重定向。
  - **Desktop 桌面端 (`HostBashSection.svelte`)**：多语言更名为「审批管理 (Approvals)」，在筛选栏新增分类下拉控制器（`categoryFilter`），支持按分类检索与徽标渲染。
- **验证**：`store.test.ts`、`approval.test.ts`、`desktopHostBash.test.ts`、`desktop api.test.ts` 全部 104 项单元测试通过；Desktop `svelte-check` 0 错误 0 警告；`npm run build` 打包构建成功。


### Added: MD Preview 小程序新增「Macaron · 甜彩微排」主题与体验优化

- **新增 Macaron（甜彩微排）主题**：
  - 汲取微排（Punk微排）版式特色，摒弃原站黄色，定制了清新舒缓的马卡龙色系（薄荷绿 `#38A3A5` + 甜桃粉 `#FF9AA2` + 香芋紫 `#9B89B3` + 奶泡白 `#FAFDFB`）。
  - 支持 macOS 窗口风格代码框（粉/黄/绿三色圆点 + CODE 栏）、H1 居中带粉色指示条、H2 居中带下划装饰、柔和薄荷阴影引用卡片与定制表格。
  - 全内联样式渲染，直接 Cmd/Ctrl + V 粘贴到微信公众号后台即可呈现。
- **小程序交互体验提升**：
  - **右下角固定悬浮主题切换**：主题切换器由顶部 nav 移至右下角固定悬浮按钮（FAB），点击向上弹出主题选择菜单，操作更便捷，顶部导航更清爽。
  - **主题偏好本地记忆**：使用 `localStorage` 记录用户上次选择的主题，切换文档与刷新不重置。
  - **空状态排版示例**：新增「加载排版示例」一键按钮，方便免导入即时体验全功能排版。
  - **主题选择器**：下拉菜单提供 Macaron 主题专属多色 Swatch 色块与描述。
  - 版本 bump 至 `1.1.1`（修复右下角悬浮按钮与向上菜单的定位冲突及层叠上下文）。
- **验证**：`mdPreview.test.ts`、`uiDesignBaseline.test.ts`、`bootstrap.test.ts` 30 项测试全绿，`npm run build` 通过。


### Improved: 沙箱安全策略预设 UI 重构与设计打磨

- 优化背景：沙箱预设原采用简陋单轴滑块搭配混乱的 Emoji 缩写（`🌐❌ · ✏️❌`），视觉层次扁平、信息传达晦涩且在多端字体环境下参差不齐。
- 升级改进：
  1. **4 档专业安全卡片矩阵**：重构为包含专属矢量图标、级别徽标（`最高隔离`、`安全探索`、`推荐开发`、`完全信任`）与语义化胶囊标签（网络 / 文件系统 / 环境变量三维支持）的现代化交互卡片。
  2. **双向联动的严格度光谱滑条**：在卡片下方保留「最严格 🛡️ ➔ 最宽松 ⚡」两极提示的平滑轨道与刻度定位点，支持卡片选择、滑块拖动及键盘无障碍控制。
  3. **自定义状态反馈与一键重置**：当在下方高级配置中微调规则导致偏离预设时，优雅呼出「当前为自定义策略」提示卡片并支持一键重置回标准预设。
  4. **全端设计规范与多主题适配**：严格遵循 `DESIGN.md` 与语义色彩系统，零硬编码颜色；桌面端与 Web 端同步升级，完美自适应浅色、深色、macOS 毛玻璃主题与自适应栅格断点。
- 验证：Desktop `svelte-check` 0 错误 0 警告；`chat-ui.test.mjs` 211 项测试全绿；`npm run desktop:test` 全部通过。

### Fixed: Trace 活跃运行（Active Runs）永久残留「未关联会话」孤儿记录与 Runner 重试生命周期 Hook 修复

- 症状：Trace 页面下方「正在执行」列表中堆积大量很久以前早已结束的历史运行记录，显示为「未关联会话（orphan）」且时间持续增长（如“1 天 11 小时”）。
- 根因：
  1. Runner 在遇到上游错误（如 502/空回复）触发重试或模型降级（Fallback）时，第一轮尝试的 `agent_end` 过早调用了 `finishHookRun()`，将内部标志位 `hookRunFinished` 设为了 `true` 并发出了 `run.finished`。
  2. 随后下一轮重试（Candidate 2）触发 `agent_start` 发出了 `run.started`，`TraceRecorderHook` 将 SQLite `agent_trace_facts` 中的状态重新覆盖改写回了 `"started"`。
  3. 当任务最终成功或结束退出时，`finishHookRun()` 因 `hookRunFinished === true` 拦截跳过，不再发出终态 `run.finished`，导致事实表永久停留在 `started`，成为僵尸孤儿记录。
- 修复：
  1. `runner.ts` 将 `run.started` 加守卫为单次发射；移除单轮 prompt 的 `agent_end` 对全局 `finishHookRun()` 的触发，确保仅在整个 Runner turn 真正结束（`finally`）时发射带有最终状态的 `run.finished`。
  2. `SqliteTraceStore.upsertFact` 增加终态保护，禁止处于 `success`/`error`/`aborted` 终态的事实记录被非终态的 `started`/`waiting` 倒退覆盖。
  3. `SqliteTraceStore` 引入 `reconcileStaleOrphanRuns()`，在获取 active-runs 列表时自动清理超时的非活跃孤儿记录；一并清理了数据库中历史遗留的 125 条孤儿记录。
- 验证：`traceRecorderHook.test.ts` 22/22 全绿；`desktopTrace.test.ts` 全绿；`runner.test.ts` 36/36 全绿；数据库 unfinished run facts 降为 0。

### Fixed: macOS Desktop 运行历史打开空白卡死、多渠道聚合、Bot 筛选与分页

- 症状：桌面端打开「运行历史 (Run History)」面板时长时间无限卡在「正在加载…」，无法查看历史记录或错误信息；且后端即便扫描也只能看到 Telegram 记录，桌面主会话、飞书、QQ、微信与 Projects 的运行历史全部缺失；多记录时缺乏分页且只能关键词模糊搜索。
- 根因：
  1. 前端 Svelte 5 `$effect` 未使用 `untrack()` 进行依赖隔离，`runHistoryStore.svelte.ts` 在加载失败时将 `endpoint` 重置为 `""`，引发毫秒级死循环重试，`loading` 始终被置为 `true`。
  2. 后端 `reviewData.ts` 中的 `listAgentWorkspaces` 硬编码了 `moli-t/bots` 扫描路径，完全忽略了 `moli-w`（桌面/Web）、`moli-f`（飞书）、`moli-q`（QQ）、`moli-wx`（微信）、`system/bots` 与 `projects/*/runtime` 中的 `run-summaries.jsonl`，且原逻辑把 `events` / `skill-drafts` 等非会话目录也误判为会话。
- 修复：
  1. 服务端打通多渠道与项目工作区全量扫描（引入 `TASK_CHANNEL_ROOTS`、`system/bots`、`projects/*/runtime` 并精准过滤保留目录）。
  2. 前端 `RunHistorySection.svelte` 的 `$effect` 引入 `untrack()`，`runHistoryStore` 增加代际控制与刷新状态，错误时不触发重试循环；`#each` 采用复合唯一键避免追加重复 key 报错。
  3. UI 升级遵循 `DESIGN.md`：接入 `SkeletonRows` 骨架屏、`EmptyState` 规范空状态、手动刷新按钮、Bot 原生下拉选择器（`SelectControl`）与客户端分页控制器（支持 10/20/50/100 条每页切换）。
- 验证：`reviewData.test.ts` 2/2 全绿；Desktop `api.test.ts` 87/87 全绿；Desktop `chat-ui.test.mjs` 211/211 全绿；Desktop `svelte-check` 0 错误 0 警告。

### Added: macOS Desktop Host Bash 审批与白名单管理设置页

- 概述：在 macOS 桌面端（`apps/desktop`）新增完整的 Host Bash 设置页（`HostBashSection.svelte`），归入侧边栏「活动 (Activity)」分类下，对齐 Web 端 `/settings/host-bash` 的全部审计与管理能力。
- 功能点：
  - 4 档顶部指标卡片（待审批、白名单总数、生效中、历史记录）与快捷分段筛选。
  - 待审批列表展示（实时审查会话中等待用户确认的工具调用与安全权限）。
  - 长期白名单管理（支持 iOS 开关即时启用/禁用、权限摘要展示以及带安全确认弹窗的删除操作）。
  - 审批历史记录审计（支持按已批准/已拒绝/已执行/失败状态、单次/会话/持久模式以及关键词全局搜索）。
- 设计规范：严格遵守 `DESIGN.md`，零硬编码颜色，全量基于 CSS 语义变量（`--card-bg`, `--surface`, `--surface-secondary`, `--label-primary`, `--label-secondary`, `--separator`, `--accent`, `--danger`, `--online`, `--warning`），浅色、深色及多主题完美自适应。
- 验证：Desktop `svelte-check` 0 错误；`chat-ui.test.mjs` 211 项测试全绿（包含 Geist CSS 变量完整性及 settings 分组结构断言）；生产构建通过。

### Fixed: macOS Desktop 聊天页滑到底部/点击“回到最新”后按钮不消失，且 AI 回复停止自动滚动

- 症状：macOS App 聊天页滑到最底或点击“回到最新”后按钮不消失；且在 AI 流式生成新回答时页面偶发停止自动滚屏。
- 根因：macOS 触控板滑到底部的惯性橡皮筋回弹向上微移（`moved < 0`）与高分屏浮点计算误差（`dist <= 0.5px`）无条件将内部 `pinned`（吸底跟随）状态置为 `false`；而 `MutationObserver` 在 `!pinned` 时跳过自动跟随，`TranscriptDock` 也在 `!pinned` 时展示按钮；点击按钮时未主动派发 `resumeStickToBottom` 唤醒跟随状态。
- 修复：放宽吸底亚像素判定阈值至 2px，触底区内的向上微移保护为回弹而不解绑跟随；`TranscriptDock` 点击按钮时显式调用 `resumeStickToBottom` 触发物理弹簧并重置跟随状态。
- 验证：新增 `stickToBottom.test.ts` 单元测试；`chat-ui.test.mjs` 207 项全通；Desktop `svelte-check` 0 错误；生产构建全通过。

### Added: Web 聊天页面审批卡片 UI（`host_bash_approval` 实时交互与一键解决）

- 症状（Session `s-20260818-shhs`）：Web 聊天中触发需要审批的操作（如 `miniAppManage` 或非 Auto 模式下的 Host Bash）时，后端 SSE 正确发送了 `host_bash_approval` 事件，但 Web 页面前端丢弃了该事件，导致用户看不到审批按钮，任务等待超时失败。
- 修复：Web 聊天页面（`src/routes/+page.svelte`）接入 `host_bash_approval` SSE 事件监听与状态管理；在聊天消息流式区域底部渲染交互式审批卡片（包含工具名称、完整命令、原因说明），提供「拒绝」「本会话允许」「仅此一次」三个操作按钮；点击后通过 `/api/chat` 的 `/hosttools` 命令实时提交审批结果并自动刷新会话消息。
- 验证：中英双语、明暗主题适配；`npm run build` 和 host bash / chat web commands 测试套件全数通过。

### Fixed: 微信/QQ 触发模型降级后用户只收到 "Internal error."，真实回复被吞（归档通知闭包引用未定义 `scopeId`）

- 症状（微信 Session `s-20260818-wnjk`）：主模型 `cli-proxy-api/mimo-v2.5-pro` 连续 502、运行时自动切换到 deepseek 并正常生成回答（run-detail 显示 `Run finished successfully`，session 里也有完整回复），但用户在微信里只收到 "Internal error."；`/models` 等命令回复正常，切走主模型后恢复。QQ 渠道同款代码同样中招（尚未被触发过）。
- 根因：6-16 的 runlog 归档通知功能（3596e0552）在 weixin / qq `processEvent` 的 `onRunComplete` 闭包里写了 `this.commandService.shouldSendRunArchiveNotice(scopeId)`，而 `scopeId` 在该作用域未定义。`&&` 链短路导致它只在 `threadEventCount > 0` 时求值--而 `respondInThread` 目前唯一的调用方恰是**模型降级通知**，于是异常精确地只在降级 run 的收尾阶段抛出，冒泡到 InboundTaskCoordinator 的兜底 catch，给用户补发 "Internal error."，缓冲区里的真实回复从未 flush。feishu / telegram 同款代码各自定义了 `scopeId`，未受影响。
- 教训：`tsc` 其实一直在报这两个 `TS2304: Cannot find name 'scopeId'`（weixin:520 / qq:508），但全项目存量 tsc 噪音（400+）把新错误淹没了；且该分支只在降级路径执行，单靠"平时能跑"永远发现不了。
- 修复与机器守卫：新增共享 helper `createRunArchiveNoticeOnComplete()`（`channels/shared/runArchiveNotice.ts`），`scopeId` 作为**必填构造参数**（结构上杜绝再引用环境变量名），weixin / qq 统一接入；单测驱动降级形态（`threadEventCount > 0`、无 thread 事件 / 无 runId / 非正常结束 / runlog 关闭四个反例）。
- 验证：`runArchiveNotice.test.ts` 3/3、`weixin/runtime.test.ts` 2/2 通过；tsc 触碰文件新增 0 错误（weixin:520 / qq:508 的 TS2304 消失，剩余 hookManager 报错为存量）。

## 2026-08-17

### Added: Auto 权限模式真·全自动 —— 沙箱网络全放行 + 沙箱拒绝自动升级放行

- 选 Auto 模式后不再被审批卡打断：session 有效沙箱网络自动提为全放行（域名白名单不再静默杀命令），沙箱权限拒绝后的 host bash 升级自动通过（标注 `[AUTO]`）；第三方代码安装/执行（manage 类）仍会询问。主链路、subagent、消息渠道统一走共享层实现。
- 沙箱设置页预设重设计：observe/build/strict 卡片改为单轴严格度滑条（锁定/只读/标准/全开，锁定绿、全开红，主题 token 配色，明暗主题与移动宽度适配），微调细节仍自动落「自定义」。
- 两轴关系（权限模式 × 沙箱策略）官方口径见 `docs/guides/permission-and-sandbox-modes.md`。

### Fixed: 点名 MCP server 却提示 MCP 工具缺失（`loadMcp` 注册门控与 prompt 宣传脱节，改为按配置常驻）

- 症状（Session `s-20260817-ztfk`）：用户消息「使用 open-connector 查询…」点名了已启用的 MCP server，system prompt 的 `<mcp-access>` 段也列出 `tdx` / `open-connector` 并指示用 `loadMcp` 加载，但 `loadMcp` / `mcpInvoke` 根本没注册进工具集--`toolSearch` 返回 `No deferred tool matched`，模型被迫用 bash/find/curl 乱试后给出「环境缺少 loadMcp 支持」的错误诊断。
- 根因定性：用「猜用户这句话算不算点名 MCP」来决定工具是否存在，把能力开关建立在脆弱的自然语言匹配上，且 prompt 宣传与注册门槛用两套词表，永远对不齐。第一次修复（把 server id/name 加进词表）仍是同族--修 NLU 的办法不是把 NLU 写得更全，是不再需要它。
- 结构性修复：`loadMcp` / `mcpInvoke` 的注册与 prompt `<mcp-access>` 段现在派生自**同一个谓词** `hasConfiguredMcpServers(settings)`（`openConnector.ts`）--配置了任意 MCP server 即常驻注册（含 disabled，`loadMcp` 能解释缺什么），零配置则两侧都不出现。`hasExplicitMcpInvocation()` 及其词表匹配整体删除；「是否加载某个 server」完全交给模型经 `loadMcp` 决定，prompt 里「仅显式要求时用 MCP」降级为成本建议（避免投机加载）。
- 机器守卫：`prompt.test.ts` 新增不变量测试--prompt 出现 `<mcp-access>` ⟺ `hasConfiguredMcpServers` 为真（enabled / disabled / 零配置三档），并结构化断言 `runner.ts` 的门控必须写 `exposeLoadMcpTool = hasConfiguredMcpServers(settings)`、不得再引用 `hasExplicitMcpInvocation`。
- 验证：`prompt.test.ts` 33/33、`runnerHelpers.test.ts` 7/7、`runner.test.ts` + `loadMcp` / `mcp` / `toolClassification` 65/65；tsc 触碰文件 0 错误。

## 2026-08-16

### Added: Project-scoped scheduled automations

- Projects can now own periodic automations that execute with the Project's current Agent context, workspace, rules, Skills, Memory, model, and Sandbox settings.
- Project automation results stay inside the app: every trigger uses the existing fresh task-session semantics, records inspectable run history and transcript, and never sends through a Bot or external Channel.
- The Desktop Automations workspace now includes a Project category, while Project Settings includes a locked Automations tab that reuses the same create, edit, schedule, run-now, pause, delete, history, and transcript flow.
- Project events use the existing watched JSON/runtime lease system; Project creation and deletion refresh watcher registration, and deleting a Project prevents orphan task dispatch without deleting its working directory.

### Updated: MD Preview 内置小程序 Icon 视觉重构

- 将 `md-preview` 的图标重构为暖橙色调立体双色圆形徽章（`#FB8C00` 活力橙基底 + 右侧 `#E65100` 深橙半弧阴影 + 居中精准对齐的 `#FFE0B2` 浅橙 Markdown `M↓` 专有标志），独立于 `todo` 的方形卡片造型，同时与 `note` / `meeting-notes` / `mini-chat` 保持统一的色彩丰富度与双层矢量设计语言。
- 内置小程序版本 bump 至 1.0.4（同步备份旧文件覆盖离线工作区副本）。

### Fixed: MD Preview R2 测试连接报 SignatureDoesNotMatch（SigV4 scope 区域写死 `$`）

- `server/index.mjs` 的 `signRequest` 把 credential scope 区域硬编码为 `$`（`20260816/$/s3/aws4_request`），而派生签名密钥用的是真实 region——签名与凭证不一致，R2/AWS 验签必然失败；其他客户端正常正是因为它们用真实区域（R2 为 `auto`）签名。已改为 `${dateStamp}/${region}/s3/aws4_request`。
- 测试连接（GET LIST）另有一个签名头不匹配：`content-type: application/xml` 被纳入 SignedHeaders 但实际请求没发送该头——SigV4 要求每个签名头必须真实携带，已补上。
- 用 aws4（成熟参考实现）交叉验证：上传 PUT 与连接测试 GET 的签名逐字节一致，scope 为 `auto/s3`；mdPreview/httpRoute/bootstrap/manifest 46/46 pass。内置小程序版本 bump 至 1.0.3。

### Fixed: MD Preview R2 设置无法保存（PUT 被宿主两层 405 拦截）＋ 主题下拉左对齐

- R2 配置点保存后并不落库、点测试报 "Bucket 没有配置"、禁用重开后配置丢失：根因是面板保存走 `PUT /api/settings`，而宿主 HTTP 门禁（`host.handleHttp` 的方法白名单）与 SvelteKit 路由（`src/routes/miniapps/[appId]/[...path]/+server.ts`）都只允许 `GET/POST/PATCH/DELETE`，PUT 在到达应用 SQLite 前被 405 拒绝——主题切换的 PUT 同样一直静默失败。已在两处门禁放行 PUT，并新增 httpRoute 回归测试（PUT 全链路透传 + 落盘 + 同一 dataRoot 重启后仍在）。
- 主题下拉菜单改为与触发器左边缘对齐（`left: 0; right: auto`），不再向左溢出覆盖文档标题区。
- 内置小程序版本 bump 至 1.0.2。
- 验证：httpRoute/host/mdPreview/bootstrap/manifest/uiDesignBaseline/processIsolation/invocation 共 103/103 pass；真实宿主端到端走查——面板形状 PUT → 200 且全字段落库、GET 回读一致、disable/re-enable（新 host 同 dataRoot）后配置仍在。

### Fixed: MD Preview 主题下拉点击后只出蒙版、菜单不可见（模块级崩溃）

- `ui/app.js` 仍引用旧 tab 设计的 `#tab-momo` / `#tab-vercel`（HTML 已改为 `#theme-trigger` + `#theme-menu` 下拉），模块求值到该处即抛 `TypeError`，`boot()` 及后续全部逻辑失效——上传、设置、文档加载都不再工作。
- 主题下拉从未接线：补齐 trigger 开合（含 backdrop 蒙版）、菜单项选择（更新 trigger 标签/色块/选中态并持久化）、`closeAllPopovers` 关闭与 `aria-expanded` 同步；`renderChrome` 改为同步主题下拉状态。
- 内置小程序版本 bump 至 1.0.1，触发现有安装的副本更新。
- 验证：miniapps 相关套件 37/37 pass；DOM 桩冷启动冒烟：模块无崩溃、boot 完整走完、trigger 点击开菜单+蒙版、doc/theme 菜单互斥切换、选择主题后标签与 PUT 持久化正确。

### Added: MD Preview built-in Mini App (Markdown 预览 + 公众号复制 + R2 图床)

- New opt-in built-in Mini App `md-preview`: render a Markdown document with switchable themes (Momo Paper 暖米书卷 / Vercel Geist 极简, both with matched code-highlight palettes) in the desktop panel, and copy it as WeChat Official Account (公众号) rich text with fully inline styles - preview DOM is the copy content, WYSIWYG.
- Agent tool `preview` takes a workspace Markdown file plus its locally-referenced images through `fileParams` host staging (zero-token file passing); unresolved local image references are reported back so the Agent can supply the files on a retry. The tool result card deep-links into the panel.
- Cloudflare R2 image hosting: settings page (Account ID / Endpoint / Region / Bucket / Access Key / write-only Secret / public base URL / key prefix, with connection test), content-addressed uploads (`sha256.ext` keys, deduped across documents via the mapping table), AWS SigV4 signing on node:crypto in the app's own process. Generic S3-compatible endpoints work by setting Endpoint.
- The upload mapping lives in the app's DB only: the Markdown source (on disk and in the document record) keeps its local image paths; URLs are substituted at copy time. Copy with pending local images asks first (上传 / 仍要复制 / 取消).
- Panel niceties: local .md file picker, document list with delete, remote-image preview through a server-side data-URI proxy (the iframe CSP allows only `'self'` + `data:`), theme preference persisted in settings.
- Vendor: `marked` + `prismjs` (core + 14 languages) inlined at build time with a THIRD_PARTY_NOTICES entry; prism runs manual so `render.js` owns highlighting.
- Verified: `src/lib/server/miniapps/mdPreview.test.ts` (manifest + fileParams, image-ref matching, unresolved-ref reporting, SigV4 PUT shape with content-addressed keys, source-markdown-untouched-by-upload, cross-document upload reuse, settings masking, proxy validation), `uiDesignBaseline` and `bootstrap` builtin assertions updated.

### Added: dynamic custom engines for Agent image generation

- Image settings in Web and Desktop can add multiple custom engines with a display name and a one-time protocol choice: `images/generations` or `chat/completions`.
- Custom engines route through the matching generic provider, support credential-safe Desktop editing, can be selected as the default or tested independently, and can be removed without being reintroduced by settings sanitization.
- Existing custom protocols are locked in the shared settings layer, reserved `auto` ids are rejected, and custom engine name/protocol/base URL/model/API key survive a fresh `SettingsStore` load.
- Verification: focused image/settings suite 55/55, root production build, Desktop `svelte-check` 0 errors/0 warnings, and Desktop Vite build passed. The broader Desktop suite remains 263/264 because its existing SessionStore test still fails on SQLite `bm25` context usage.

## 2026-08-15

### Added: Mini App tool fileParams with host staging (zero-token file passing)

- Mini App tools can declare `fileParams` in `manifest.json` (`accepts: ["file"|"image"]`, optional `maxBytes` up to 64 MiB, optional `multiple: true`).
- The Agent passes ordinary workspace-relative file paths using the file tools' exact path semantics (`resolveToolPath` with home-prefix expansion and shared allowed-roots guard).
- The host validates existence, kind and size before copying files into the app's `dataDir/incoming/`, rewrites parameters in place to dataDir-relative paths (`incoming/...`), and passes metadata via `context.stagedFiles`.
- Subprocess worker runtime marshals `stagedFiles` across the IPC boundary so isolated handlers receive complete staging context.
- Prevents full document text from consuming LLM output tokens during tool invocations, and allows apps to receive referenced local files (e.g. images).
- Verified: `npx tsc --noEmit` 0 errors; 73/73 tests in miniapps suite (manifest validation, staging semantics, process isolation round-trip) and 45/45 tests in service bootstrap pass.

### Fixed: conversation auto title summarization never ran (TypeError: settings.get is not a function)

- `tryAutoSummarizeConversationTitleAsync` destructured `settings` from `getRuntime()` and called `settings.get()`, but the runtime exposes `getSettings()`; every background run threw immediately and titles stayed as the default/truncated snippet.
- Now reads the live settings snapshot through `getSettings()`.
- Added a regression test that injects a fake `__molibotRuntime` and asserts the wrapper reads settings via `getSettings()` and performs the rename (the previous tests only covered the pure `summarizeSessionTitleWithLlm`, which is why the broken seam shipped). Verified: title summarizer test suite passes.

## 2026-08-14

## 2026-08-14

### Release: v2.9.25 / Desktop v0.9.22
- Synchronized the root and Desktop package versions for the new release.

### Fixed: Mini Chat conversation deletion works inside the app sandbox

- Replaced the blocked browser `window.confirm()` dependency with an Astryx confirmation dialog, so the top-right delete action now opens reliably and deletes the selected conversation and its messages.
- Bumped the built-in Mini Chat package to v1.0.5 so existing installations receive the UI fix.

### Fixed: Mini Chat honors its selected model

- A Mini Chat per-request model selection now overrides the configured global text route, so choosing a PI or custom model sends the request to that exact model instead of silently falling back to the default.
- Added a real routing regression that covers a non-empty global `textModelKey`, the condition missed by the earlier model-selection tests.

### Improved: Chat transcript follows new content on a physics spring

- Transcript auto-scroll no longer teleports on every streamed frame: `stickToBottom` now glides to the newest content on an interruptible, frame-rate-independent rAF spring that retargets as content grows.
- The reader's first upward wheel or touch cancels the glide and hands scroll ownership back; returning near the bottom re-arms following. Session switches still land on the tail instantly, and `prefers-reduced-motion` / low-performance modes keep the instant behavior.
- Added a Motion section to DESIGN.md fixing the app-wide motion tokens, the opacity/transform-only rule, and the "what never animates" list.

### Fixed: the finished reply no longer blinks out at end of turn

- The end-of-turn transcript reload re-keys message rows in the same frame the streaming bubble is removed; those rows now mount fully opaque instead of fading in from zero, so the reply the reader was watching hands over to its persisted row with no visible swap.

### Changed: chat composer focus loses its tinted border

- Clicking into the chat input no longer paints a bright accent border around the whole composer area; focus is signaled by a faint neutral glow only.

### Improved: the reasoning card folds as soon as the answer starts

- While the model reasons or runs tools with no answer yet, the live process card stays open; the moment the first answer content streams, it now collapses by itself so the answer leads instead of waiting for the turn to end. A manual re-expand afterwards is respected.
- Collapsed summaries, failure/interruption behavior, and the committed transcript treatment are unchanged.

### Release: v2.9.24 / Desktop v0.9.21
- Synchronized the root and Desktop package versions for the new release.

### Added: Mini Chat for lightweight, prompt-free conversations

- Added the optional built-in Mini Chat app, using the Astryx `ai-chat` interface with responsive Chinese/English and light/dark presentation.
- Mini Chat stores conversations in its own SQLite database and sends only its bounded user/assistant history through the Mini App AI route; it does not enter the Agent Runtime or inherit Agent prompts, memory, Skills, or tools.
- Added host-level structured chat and cancellation support, with persistent interrupted/failed receipts, retry, copy, conversation deletion, and restart recovery.

### Fixed: Mini Chat uses supported reasoning and explains request failures

- Mini Chat text requests now use the `low` reasoning level instead of `off`, matching Providers that require an enabled reasoning level.
- Provider errors now reach Mini Chat as a short, credential-redacted description with the upstream HTTP status when available, so configuration and model capability problems are actionable.

### Improved: Mini Chat streams replies and preserves narrow-screen width

- Mini App text generation can now forward Provider text deltas across the app process boundary while retaining the same final result, cancellation, usage, and error contracts.
- Mini Chat renders those deltas while generation is active, persists only the completed reply, and removes the oversized assistant initials avatar.
- At 390px wide, the assistant message column now uses 327px with no avatar reservation or horizontal overflow.

### Improved: Mini Chat adds per-app model and prompt settings

- Mini Chat now offers a compact settings dialog for choosing any configured text model or following the Mini App default, plus an optional short system prompt stored only in Mini Chat's own data directory.
- Model discovery returns only routed model identifiers and display labels; Provider credentials remain inside the host. The selected model and prompt cross the child-process bridge without entering the Agent Runtime.
- Assistant metadata now shares the reply bubble's content inset so timestamps and copy actions align with the answer, and the hidden mobile conversation rail no longer casts a visible left-edge shadow.

### Improved: Mini Chat has a distinctive built-in app icon

- Replaced the generic black chat tile with a compact teal two-bubble mark, using the same primary/deep/highlight color construction as the Note, Todo, and Meeting Notes icons.

### Improved: repeated Chat actions collapse into readable groups

- Completed adjacent reads, file changes, searches, and shell commands now condense into one plain-language action row while preserving their original position in the reasoning timeline.
- Expanding a group reveals every original tool call and its payload. Running, failed, and unknown tools always remain separate so active work and diagnostics are never hidden.
- Chat and Project Chat share the same projection, with Chinese/English summaries for action count, unique file count, and elapsed time.

### Improved: Chat process is one Codex-style ordered timeline

- Live Chat and Project Chat now keep the current reasoning/tool process expanded; successful turns collapse to one quiet summary, while failures and interruptions remain open.
- Expanding a process shows one chronological timeline instead of separate reasoning and tool sections. Each tool call owns one lifecycle record and only its payload expands.
- Tool start/end events now pair by the runtime's real `toolCallId`, fixing parallel same-name calls and preserving the specific start label. Summaries use elapsed time, tool count, and changed-file count rather than unstable reasoning chunk counts.

### Improved: AI provider model families use the first name prefix

- Desktop Settings → AI Providers now groups both the configured model inventory and the discovery dialog by the text before the first `-` in the model name, so `gemini-3.5-*` and `gemini-3.6-*` appear together under `gemini`.
- Model IDs, ordering, search, sorting, collapsing, and add/remove behavior are unchanged.

### Fixed: live Chat keeps reasoning and tool events in arrival order

- Desktop Chat and Project Chat no longer let a tool call jump ahead of reasoning that arrived earlier in the same animation frame, or render answer text before the final reasoning chunk.
- The shared conversation controller now batches one ordered stream of text/reasoning chunks and flushes it at tool and Plan boundaries; persisted transcript projection remains unchanged.
- The ordering feature shipped in v2.9.17, but its first implementation combined the pre-existing frame buffer with immediate tool insertion and therefore contained this timing-dependent regression from that release onward. Controller-level regression tests now cover both boundary cases.

### Release: v2.9.23 / Desktop v0.9.20
- Synchronized the root and Desktop package versions for the new release.

### Fixed: Settings page edit dialogs, Memory cold-start, MCP auto-connect, and media test surfaces

- Entity edit dialogs (Agent / Web Profile / Channels / MCP) rendered cramped at 560px because `.entity-editor-dialog` lost the CSS cascade to the later base `.desktop-dialog-content` (both single-class selectors on the same element); switched to a compound `.desktop-dialog-content.entity-editor-dialog` selector so the 720px / 86vh override is immune to source order. Added a base `.provider-editor-toolbar` rule so file-section headers align with the 16px-padded fields below and the Channels test button shares its row instead of wrapping.
- Sandbox policy cards were 664px left-aligned with an asymmetric right gap because `.sandbox-policy-grid .settings-card` reset `margin` without `width`; cards now fill their grid cell.
- Skills search-config disclosure summary inherited UA 16px bold and zero vertical padding, reading as "错乱" next to its neighbors; aligned to the settings-row typography and box. The collapse itself was already test-guarded.
- Memory overview stayed blank for seconds because `loadMemory` gated records / candidates / rejections behind the slow LLM-synthesized profile inside one `Promise.allSettled`; the fast datasets now paint first and the profile settles after.
- MCP servers no longer auto-connect when the app reopens. Added a `reconnectAll` action that reuses the shared boot-time `reconcileMcpServers` primitive (idempotent — already-connected servers are skipped), fired from `loadMcp` when an enabled-but-disconnected server is found. Kept off the GET list path so a misconfigured server cannot stall the list load.
- Image test section was cramped / misaligned: the Test button now aligns left with the form fields and has top padding. Voice test audio element bumped from 34px to 40px so native controls are not clipped (matches the web UI).

### Improved: Meeting Notes recording studio and history interactions

- Refined Live into a quiet recording-studio surface with an active-time focal clock, state orbit, audio activity, explicit microphone/save health, clearer pause/resume hierarchy, and a keyboard-cancellable end-meeting confirmation.
- History now shows its result count and All / Processing / Complete / Needs attention filters. Search is debounced and rejects stale responses instead of allowing slower old queries to replace current results.
- Background refresh no longer dismisses an open end confirmation or overwrites a meeting title while it is being edited. Meeting Notes is bumped to `2.2.0`.

### Fixed: Meeting Notes is now a usable recorder and meeting library

- Added native pause/resume for the same disk-backed capture. Pausing flushes the current partial block, stops the effective meeting clock, and remains resumable after the Mini App panel is closed and reopened.
- Replaced the mixed banner/list/detail layout with separate Live and History surfaces. Live owns the timer and capture controls; History provides server-side search across titles, notes, and transcript text, date grouping, duration/status metadata, and a clear list-detail return path.
- Added idempotent `paused` meeting state, active-meeting guards, and service-restart reconciliation against the Desktop host's surviving native capture. Meeting Notes is bumped to `2.1.0`.

### Fixed: Meeting Notes audio chunks pass the production service boundary
- Raised adapter-node's bounded request limit before server startup so a 10-second PCM WAV encoded as Base64 JSON is no longer rejected by the framework's 512 KiB default.
- Oversize-body failures now return a specific 413 upload-limit message instead of the misleading “Request body must be JSON”; transcription and summary failures are logged with safe meeting/chunk identifiers and shown in the meeting UI with an actionable Mini App AI settings path.
- The meeting page now keeps polling while final notes are summarizing. Meeting Notes is bumped to `2.0.1` so installed copies receive the diagnostic UI.

### Added: production-ready live Meeting Notes V1
- Meeting recording now runs in the Desktop host as bounded 10-second WAV chunks, so closing the Mini App panel no longer owns or ends the capture lifecycle.
- Transcription appears on a live timeline, provisional notes update from bounded one-minute evidence windows, and stopping performs a hierarchical final summary instead of uploading or prompting with an hour-long file/transcript.
- Track/sequence barriers, idempotent uploads, retained audio, missing/failed chunk visibility, restart recovery, and partial-result marking make interruptions explicit and recoverable.
- Meeting Notes is now `2.0.1`; V1 ships the in-room microphone adapter on a multi-track architecture ready for a later system-audio source.

## 2026-08-13

### Improved: Settings model selectors are grouped and refresh after Provider saves
- Settings → Models now groups text, vision, transcription, subagent, advanced-routing, compaction, and Mini App AI model choices by provider, with one compact row per model.
- Returning from AI Providers now reloads the model inventory even when the service endpoint is unchanged, so newly saved models appear immediately without restarting or manually refreshing.
- The regression guard covers the previously missed lifecycle boundary where the Models section was unmounted when the Provider change event fired.

### Improved: Chat model selection is grouped by provider
- Desktop Chat and Project Chat now group the shared model menu by provider instead of mixing every configured model into one flat list.
- Each model occupies one compact row using its alias or readable name; the full provider/model label remains available as a tooltip, with Session routing and keyboard selection unchanged.

### Release: v2.9.22 / Desktop v0.9.19
- Synchronized the root and Desktop package versions for the new release.

### Added: AI-powered one-sentence session title summarization
- First-message session creation now automatically generates a concise title using a background LLM request, with locale-aware System Prompt (`zh-CN` / `en-US`) and `reasoning: "off"`.
- Updated `/api/stream` and `/api/chat` with `tryAutoSummarizeConversationTitleAsync` and SSE `session_title_updated` event for instant UI sidebar updates.

### Fixed: Note stays current and renders Markdown
- An already-open Note panel now watches the shared Mini App revision while visible, so Agent-created or edited notes appear without switching panels or manually refreshing.
- Note card bodies render safe GitHub-flavored Markdown, including headings, emphasis, lists, quotes, code, links, and tables. Raw HTML, remote images, and unsafe link protocols remain inert; editing continues to expose the original Markdown source.
- Note was bumped to v1.4.0 so installed copies can receive the bundled UI and renderer update.

### Fixed: built-in Provider tests and model discovery use their native path
- Built-in Providers such as OpenCode no longer require a self-hosted `baseUrl` or call a custom `/models` endpoint. Model discovery now returns the packaged Pi catalog directly.
- Connectivity tests now send one minimal request through the same Pi runtime used by the Agent, including a saved settings API-key override, so failures distinguish missing local configuration from the upstream account response.
- Verified the current OpenCode setup reaches the upstream service; its remaining response is an account `Insufficient balance` error, not the previous local `baseUrl` guard.

## 2026-08-12

### Release: v2.9.21 / Desktop v0.9.18
- Synchronized the root and Desktop package versions for the new release.

### Added: server-rendered D2 diagrams and fixed CJK Markdown tables
- Complete `d2` fenced blocks now render through the Desktop server's D2/Kroki endpoint with bounded source/output sizes, timeout protection, small response caching, theme forwarding, and a readable source fallback.
- Chat Markdown table previews now use the UTF-8 CSV viewer instead of the binary workbook parser, so Chinese headers and cells no longer become mojibake.
- Sticky sidebar section headers use the same quiet `var(--fill)` surface as hovered Sessions while retaining the existing blur and accessibility/performance fallbacks.

### Fixed: Todo list actions no longer squeeze task titles
- Built-in Todo row actions now float over the row's right edge instead of reserving a permanent flex slot, so long task titles use the full available width.
- The floating action surface remains readable in Light/Dark themes and keeps hover, touch, keyboard focus, and anchored menus working. Todo was bumped to v1.7.0 so installed copies can receive the UI fix.

### Fixed: Message menu placement and File Inspector theme sync
- Assistant message overflow actions now open upward from the bottom of the reading column, keeping the composer visually clear while preserving the shared keyboard/focus behavior.
- File / Artifact Inspector chrome now derives canvas, surfaces, borders, labels, accent, and status roles from the active Desktop theme family and resolved brightness instead of a separate hard-coded Primer palette.

### Added: Independent brightness and theme families
- Desktop Settings → General → Appearance now separates Brightness (`Light` / `Dark` / `System`) from Theme family (`Minimal (macOS)` / `Rosé Pine` / `Catppuccin` / `Midnight`), with independent persistence and live system-following updates.
- Added Rosé Pine Dawn/Moon, Catppuccin Latte/Macchiato, and Midnight's Daybreak light companion. Shared semantic tokens keep Chat, Settings, Agent City, Artifact previews, and syntax colors aligned across all family/brightness combinations.
- The native macOS sidebar glass contract now uses each family's translucent tint with the shared `blur(18px) saturate(160%)` layer, while accessibility and low-performance fallbacks remain opaque by design.

### Release: v2.9.20 / Desktop v0.9.17
- Synchronized the root and Desktop package versions for the new release.

### Fixed: Desktop sidebar glass restoration
- Restored the Chat and Settings sidebar's translucent theme tint plus `blur(18px) saturate(160%)` while keeping the native macOS `sidebar` window effect. Light, Dark, Midnight, and System now retain visible material depth; reduced-transparency, increased-contrast, and low-performance paths use the opaque fallback.

### Added: Desktop Midnight theme
- Desktop Settings → General → Appearance now offers a fourth, deep-blue Midnight theme alongside Light, Dark, and System. The choice persists across restarts and maps its native macOS window material to the dark appearance without losing the Midnight CSS palette.
- Chat Markdown, Agent City, Artifact Inspector, PPTX/Mermaid previews, and system-following dark rules now resolve Midnight consistently instead of falling back to Light or System.

### Fixed: Plan completion, decision placement, and read-only delegation
- A successful `exitPlan` is now a terminal structured result, so the Runner no longer retries it as an empty answer, duplicates terminal messages, or burns the remaining tool budget after the Plan already exists.
- Persisted Plans are projected once from their canonical metadata and proposed Plans remain the final visible item in the completed turn, below later reasoning or activity blocks and immediately beside their confirmation actions.
- Plan mode can delegate substantial repository analysis to Scout and Planner Subagents. The mode rejects write-capable roles and removes delegated Bash, while ordinary permission modes retain their existing Subagent capabilities.

## 2026-08-11

### Release: v2.9.19 / Desktop v0.9.16
- Synchronized the root and Desktop package versions for the new release.

### Fixed: Desktop settings editors, loading, and cold-start connectivity
- Agent, Web Profile, Channel, and MCP editors now use the shared accessible dialog shell with a bounded scrolling body and fixed header/footer. The shell explicitly portals to `body`, so an editor always opens as a centered top-layer modal instead of inheriting its list position or appearing below a long settings page.
- Skill search configuration is collapsed by default; image/TTS test fields and Sandbox policy groups use balanced settings layouts across wide and narrow windows.
- Memory Center paints its summary as soon as the primary request completes instead of waiting for four slower datasets. Enabled MCP servers now reconnect during runtime cold start, including the managed OpenConnector server.

### Improved: Chat code follows the Inspector theme and reply metadata stays quiet
- Chat and Project Chat Markdown code blocks now share the Artifact Inspector's GitHub/Primer syntax tokens, including light, explicit-dark, and system-dark palettes, instead of forcing dark code surfaces in a light transcript.
- Completed assistant replies keep metadata inline at normal message-column widths. Only a genuinely narrow column folds technical details and Mini App actions into one right-aligned ellipsis; the pointer-opened popover closes when the pointer leaves its complete region.

### Improved: compact Bot identity and Project Session disclosure
- The Desktop composer Bot control now uses one initial instead of `@` plus the full Agent name, while keeping the complete identity in its tooltip, accessible label, and selection menu.
- The adjacent permission-mode control no longer spends horizontal space on a trailing dropdown arrow; its icon, label, hover/open states, and keyboard-accessible menu remain unchanged.
- Bot badges use a restrained subset of the documented palette on quieter fills; adjacent picker options are distinct, and channel glyphs use the same low-emphasis outline treatment as primary navigation.
- Each expanded Project initially shows 10 Sessions. “More conversations” reveals the next 10 instead of letting one Project consume the sidebar.

### Release: v2.9.18 / Desktop v0.9.15
- Synchronized the root and Desktop package versions for the new release.

### Improved: Mermaid diagrams expose source and a zoomable preview
- Every rendered Mermaid block in Chat, Project Chat, and Markdown artifacts now has a persistent Preview / Source switch. Source mode is selectable and includes an explicit copy action.
- Preview mode can open the shared image viewer for zoom, reset, and drag-to-pan without changing the diagram's secure rendering path.

### Fixed: malformed Mermaid diagrams stay inside their message
- A Mermaid syntax error no longer leaves the library's temporary 2412×512 error SVG attached directly to `document.body`, where it could displace the Desktop window until restart. Chat and Artifact Markdown both suppress Mermaid's own error drawing while preserving Molibot's localized failure note and source fallback.
- A browser regression reproduced the leaked body child and extra page height before the fix, then verified zero leaked nodes and unchanged viewport height after it. A structural guard now covers every Svelte Mermaid renderer.

## 2026-08-10

### Release: v2.9.17 / Desktop v0.9.14
- Synchronized the root and Desktop package versions for the new release.

### Fixed: wide message content stays inside the reading column
- Desktop Chat and Project Chat no longer let an unbreakable rendered block widen the whole transcript. Prose and paths wrap inside the bounded message column, while tables, code, math, diagrams, and diffs keep layout through their own horizontal scrollers.
- Persisted explicit Skill references now render with the Skill invocation card instead of expanding their local `SKILL.md` path as an ordinary Markdown link; only the Skill identity and the user's remaining request are visible.
- A real browser layout probe reduced a 760px transcript's `scrollWidth` from 1380px to 760px while preserving a 1342px module's local overflow; structural regressions cover the complete shrink chain and scroll ownership.

### Added: Web sidebar shortcut for a new Session
- The Desktop Web channel row now has its own accessible plus action immediately before the disclosure arrow; like Project actions, it stays hidden until row hover or keyboard focus and reuses the primary New chat flow without toggling the channel accordion.
- Telegram, Feishu, QQ, and Weixin remain unchanged.

### Improved: accepted Plans execute durably, one step at a time
- Accepting an editable Session Plan now creates one idempotent, multi-step Durable Execution instead of resuming one ordinary all-at-once Run.
- Each attempt completes only its current accepted step, records inspectable run evidence, queues the next step, and projects progress back into the Plan card; retrying acceptance cannot duplicate the task and can recover the create-before-queue crash window.
- Plan, Manual, Accept edits, and Auto now have an independent composer control immediately to the right of Attach; the model menu is limited to model and thinking choices.
- Focused Durable tests (17), Desktop UI structure tests (186), Svelte diagnostics, production build, and whitespace checks pass. The broader Desktop chat suite remains at 250/252 because of two pre-existing harness failures (`$derived` in direct Node execution and SQLite FTS `bm25`).

### Improved: completed Chat reasoning folds into one process row
- Once a turn finishes, its reasoning, pre-tool narration, and tool activity collapse behind one compact “Thinking · N steps · duration” disclosure, leaving the final answer immediately readable.
- Live work remains visible, failed or aborted work opens automatically, and Plan cards stay outside the disclosure so required decisions cannot be hidden.

### Added: ordered Chat runs, complete Plan workflow, and rich Markdown
- Chat transcripts preserve the real interleaving of reasoning, tool calls, plans, and answer text, with per-step metadata and compact turn summaries.
- Desktop Plan mode now narrows tools before inference, emits an editable artifact-backed Plan card, and continues accepted work in the same Session.
- Approval and Plan choices share one DecisionCard; approvals carry structured diffs and support multiple pending requests.
- Chat Markdown supports Mermaid, KaTeX, isolated HTML/SVG previews, table-viewer handoff, answer outlines, and paged long transcripts.

### Release: v2.9.16 / Desktop v0.9.13
- Synchronized the root and Desktop package versions for the new release.

### Added: session permission modes (Plan / Manual / Accept edits / Auto), slices 0 and 1

- Molibot had three gates that did not know about each other, and between them "what may this touch" and "do we ask first" had collapsed into one boolean: `bashPolicy` returned `allow` the moment the sandbox was off, `write`/`edit` were never gated at all, and `toolSandbox.filesystem.denyWrite` — a setting the operator can configure today — did nothing to the file tools. Permission mode is now a second axis, orthogonal to the sandbox: Plan ⊂ Manual ⊂ Accept edits (default) ⊂ Auto, with no Bypass.
- **The gate is one pure function with its whole matrix under test.** `decidePolicy` used to be an anonymous closure whose only rule was `risk === high || critical`, and it could not be tested at all. `decidePermission(mode, effect, containment, hint)` is now tested cell by cell against a hand-written table — a test that recomputed the decision would pass against any bug the implementation has. Three invariants are asserted separately: `manage` asks in every mode including Auto, `deny` appears only in Plan, and `host` containment never auto-allows, so a sandbox that failed to start cannot silently become "run it on the host".
- **`effect` exists because `risk` cannot express the gate.** `write`(medium) sits beside `webSearch`(medium) and `bash`(high) beside `miniapp__x.delete`(high), so "auto-approve file writes but keep asking before running commands" was unsayable. Classification returns `effect` alongside the unchanged `risk`, which keeps its display and audit duty.
- **Installed apps and external services are trusted differently.** Wiring the gate revealed that a single `third_party` cell would put an approval card in front of every call to an installed Mini App — three installed apps means a card on every note and every expense, which the PRD's migration section never admitted. The owner installed those explicitly and that install already passed `manage`; an external MCP server is a *connection* whose contents can change and whose annotations are self-reported. So `installed_app` runs without a card from Accept edits up, `destructiveHint` still asks, and `manage` still asks in every mode so the trust cannot become circular.
- **Automation suspends instead of blocking.** An unattended run that waits on an approval holds its execution lease in `running`, which `hasActiveForTask` reads as a live owner — every later run of that task is then suppressed as `task_already_running` and the task goes quiet permanently (pitfall 23). Risk now decides *how* we ask (an individual card, or the 1.5s debounced batch) and never *whether* the caller may decline to wait. The lease guard asserts both halves, because either alone is insufficient: the suspended lease is not `running`, **and** the next dispatch is not suppressed — `retry_wait` also leaves `running` and still counts as occupancy.
- **`denyWrite` binds the file tools.** It is necessarily a second enforcement point (the sandbox enforces it in the OS around a *process*, and there is no process when `write` goes through `fs`), so the module says so rather than implying one mechanism, and shares gitignore semantics through the `ignore` package. `allowWrite` is accepted but never grants: letting a policy string widen where the file tools may write would make it a second, weaker path guard.
- **One override chain, not two.** `resolveSessionScopedOverride` owns the five levels (session → project → instance → agent → global) and the sandbox is now a caller rather than a hand-written copy. `null`/`undefined` mean "keep looking"; `false` is a value, not an absence — treating it as unset would make "off here" silently inherit "on" from above.
- The settings round-trip found **four** hand-written projections that had to carry the new field — two in `sanitize.ts` and two duplicate local copies in `store.ts` that shadow them. The agent-level value was written to SQLite correctly and dropped on load by the shadowing copy, the exact silent reset pitfall 11 describes. `sandboxOverride` had no round-trip coverage at all and is covered now, including the case where writing one axis must not drop the other from the shared preferences container.
- Permission mode is a third page inside the existing composer menu, not a second dropdown: model, thinking level and mode all answer "how should this conversation run", and a separate control would fork the trigger, the keyboard handling and the outside-click logic. Every mode carries a sentence saying what actually changes; a host that does not offer the axis gets no row rather than a disabled one. Channels see Plan and Manual clamped to Accept edits — neither has an interaction surface there.
- Approval cards now offer a `persistent` grant, so a strict mode is livable rather than an endless prompt. Installs are excluded: a lasting grant there would let one approval authorize every future install.
- **Slice 3 closed two gaps the convergence work had left.** `bash` returned from `decidePolicy` *before* the gate ran, so Manual — the mode whose point is "ask before you run things" — silently did not apply to the one tool a user most expects it to cover. It now delegates the ask/allow call to the mode, while keeping the two decisions only it knows: the file-tool redirect, and an approved Host Bash grant. A host command stays `allow` here on purpose, because the bash handler owns that conversation and gating twice would double-prompt; a sandboxed command has no second conversation, so an `ask` there must be honoured or the mode does nothing. Separately, the "always allow" chain (card offers the scope → desktop maps the decision → broker records a grant → `checkGrant` matches it) existed piece by piece but was never asserted end to end; six cases now cover it, including that a session grant must not leak into another session and that approving one write must not grant every future write.
- The rest of what slice 3 asked for was already done: the two approval tables were merged in 2026-06 and the hand-written cross-store bridge deleted, so "converge HostBash into ApprovalService" needed no new adapter. One correction recorded in that plan: its justification for deleting the bridge ("no built-in tool ever creates a broker request") no longer holds now that MCP asks in the default mode and Manual asks before `write`/`edit` — the deletion is still right, but for a different reason.
- Verification: permissions 26/26 + gate 14/14 + matrix 11/11, bashPolicy 11/11, grant round trip 6/6, lease guard 4/4, settings round-trip 15/15, full server suites 584/584, desktop `svelte-check` 0 errors 0 warnings, `vite build` clean, desktop structural guards 185/186 (the one failure is a pre-existing Phosphor path mismatch, confirmed by stashing and re-running). Slice 2 (Plan mode) remains: the gate can already `deny`, but the tool list is not yet narrowed before the model sees it, so Plan is not exposed.

### Release: v2.9.15 / Desktop v0.9.12
- Synchronized the root and Desktop package versions for the new release.

### Fixed: a delivered reminder killed every model in that Session with `Cannot read properties of undefined (reading 'totalTokens')`

- The symptom read as a provider outage: every candidate in the fallback chain failed instantly with the same `type=request_error`, across three different providers and base URLs, and no HTTP request was ever sent. `totalTokens` is not a new field — it belongs to `@earendil-works/pi-ai@0.82.0`, whose version did not change.
- Root cause is a null dereference on our own data, on the pre-dispatch path shared by every API. `buildBaseOptions` → `clampMaxTokensToContext` → `estimateContextTokens` → `calculateContextTokens(assistant.usage)` reads `usage.totalTokens` with no guard (pi-agent-core's copy of the same function has one, which is why nothing else caught it). One assistant message without a `usage` block therefore throws before the request is built, identically for every model.
- The message came from `appendDirectEventContextMessage`: a `delivery=text` automation (a fired reminder) is persisted into the Agent Context as an assistant message, and it never went through a provider, so it carried `role`/`content`/`timestamp` only. Every later turn of that Session re-read it and died — a permanent, per-Session failure, confirmed in live data (`moli-t/.../contexts/s-mmat4fav.jsonl` and several `[Molibot reminder acceptance ...] delivered` archives).
- Fixed at both ends, because one end alone is not enough: the write site now attaches `zeroAssistantUsage()`, and `prepareMessagesForModelContext` — the single funnel into `agent.state.messages` — normalizes any assistant message that still arrives without one, so Sessions already poisoned on disk recover instead of waiting for compaction.
- Guarded against the vendor module itself rather than a hand-written stub: `runnerHelpers.test.ts` asserts pi-ai's real `clampMaxTokensToContext` throws on the unrepaired message and returns a number on the prepared one, so a future pi bump that changes this contract fails in the suite; `directEventPersistence.test.ts` asserts the persisted delivery carries the usage block.
- Verification: agent core + session + shared-channel suites 176/176, `tsc` clean on the touched files.

### Added: a runnable cold-start acceptance for Durable Execution

- PRD §430 asks for a harness that "can stop the scratch service at a declared fault point, restart it with the same temporary data directory, and continue through the public API". That walk had been done once by hand and written up in `findings.md`, which proves it worked that day and nothing about tomorrow. `node evals/durable-restart-live.mjs` is the same walk as a script: 14 checks, no model calls, reusing `evals/lib/service.mjs` so the lease, signal handling and external-channel kill switch are the real ones.
- It leaves behind what a crash actually leaves behind — a `running` execution holding an **unexpired** lease owned by a process id that is gone — then restarts and asserts startup reconcile reclaims it by ownership: execution → `recovery_required`, orphaned attempt → `interrupted`, running step → `uncertain`. The lease being 10 minutes from expiry is the point: a timeout-based sweep would leave it pinned as `running` forever, which is the production bug pitfall #23 came from.
- Two ordering traps are recorded in the script because both were hit while writing it. The first version left the probe in `queued` holding no lease, so it reached `recovery_required` through the missed-continuation seam instead — and every check still passed with `reconcile()` stubbed to `return 0`. A harness that stays green against a stubbed-out mechanism is asserting nothing, so the startup pass now has to report the count it reclaimed. The second: `create` + `activate` dispatches a real attempt that keeps writing after the API call returns, so the injection happens only after the service is stopped and is read back before continuing.
- Phase 4 covers the other half of the contract — a recovered execution stays operable: it can still be cancelled through the public API, cancellation is terminal and persisted, and replaying the same `actionId` leaves it cancelled rather than producing a second transition.

### Fixed: the eval harness reported "cannot ingest documents" when only its own upload was broken

- Every attachment task in the golden set (B2 PDF, B3 image, B4 unreadable-input honesty, B5 spreadsheet, B6 vision-on-history) errored in ~0s with `chat request failed: Invalid request body`, and the 2026-08-10 full run scored 23/31 with the B group at 1/6. Read at face value that is "document ingestion is dead" — a P0-shaped capability regression.
- The product path was never broken. `sendTurn` posts through undici's `fetch` (the global one takes no `dispatcher`, which is how a run gets an HTTP timeout longer than a task — pitfall #25's transport-timeout rule), but built the body with Node's **global** `FormData`. Those come from two different undici instances, and undici detects a form body by an internal brand it stamps only on its own class. The foreign form failed that check, fell through to generic body handling, and reached the service as something `parseRequest` could not read. Proven against a live service, not by inspection: global `FormData` + undici `fetch` = 400, undici `FormData` + undici `fetch` = 200, global + global = 200.
- The form is now built with undici's `FormData`. Only that class has to match the sender — undici does not export `Blob`, and does not need to, because it brands the *form*, not its parts. After the fix the B group re-ran 6/6 against a real provider.
- Guarded by a new `evals/client.test.mjs` case that drives `runTaskTurns` against a real HTTP server and asserts what the wire actually carries: a `multipart/form-data; boundary=` content-type, the file's own bytes, and the `files`/`message` parts. Verified by reverting the fix and watching the guard go red, so a future upload call site cannot reintroduce the realm mismatch.
- A2 (edit an existing file) failed on that run and passed on re-run — non-deterministic model behaviour, not a regression. A5 stays `baseline: unknown` by design: the sandbox blocks egress, so the Agent correctly asks for Host approval and an unattended run stops there.
- Full set re-run after the fix: **30/31**, 0 errors, 0 unproven, A5 the only failure. The capability matrix now records that as the confirmed baseline instead of the 24/31 待验证 entry.

### Release: v2.9.14 / Desktop v0.9.11
- Synchronized the root and Desktop package versions for the new release.

### Fixed: runner helper fixtures retain canonical model capability types
- The two unsupported-developer-role fixtures now use the canonical `RuntimeSettings` shape. This keeps custom provider `tags` and `supportedRoles` as their literal capability types, so settings-shape drift is caught by the type guard without producing a false production failure.
- Verification: `runnerHelpers.test.ts` 5/5, Desktop structural guards 183/183, no remaining root type-check diagnostic points at `runnerHelpers.test.ts`, and `git diff --check` clean. The repository-wide TypeScript baseline still contains unrelated pre-existing diagnostics outside this fix.

### Improved: Durable Execution recovery, evidence, and channel controls
- Queryable recovery now probes external state before deciding whether to retry; missing, failed, or unknown probes open an explicit recovery review instead of replaying a possible side effect.
- Durable attempts can read only their own attached evidence through a bounded `durableEvidence` tool. Run-detail reads enforce the source chat/Project/Session boundary, fail soft when the target is gone, and label returned content as untrusted.
- Approval requests, repeat counts, one-time/session/persistent scopes, source-channel notices, and shared `/durable` short-handle commands now use the Durable aggregate. QQ and Weixin route replies through the remembered source message; Desktop uses the same inspector state.
- Web Chat requests whose profile id is not a materialized channel instance now resolve to an active Web manager before Durable activation. A real `/api/chat` request with a virtual `personal` profile reached the local provider and recovered as `recovery_required` after same-database service restart.
- Focused recovery/evidence/approval/channel tests pass. Full cold-start/cross-channel acceptance and equivalent external-provider live coverage remain the release gate.

## 2026-08-09

### Improved: a streaming reply renders block-by-block and keeps your selection

- A reply being generated used to call `renderMarkdown(streamingText)` on every frame and swap the whole `{@html}` tree. That was O(whole source) per frame (parse + sanitize + DOM replace), and because the entire `innerHTML` was replaced each frame it blew away any text the reader had selected - copy-while-generating was impossible. An unclosed code fence mid-stream also let marked swallow everything after it into the code block, so the picture lurched until the fence closed.
- The reply is now split into top-level blocks - blank-line boundaries, fence-aware so a blank line inside a code block does not split - and rendered as a keyed `{#each}` of one `{@html}` per block inside a `.md-stream-block` wrapper. Sealed blocks (everything before the final boundary, immutable for the rest of the stream) are parsed once and their html cached; only the still-growing last block is re-parsed per frame, so per-frame cost drops from O(whole source) to O(active block).
- Selection survives because Svelte 5's `{@html}` runtime guards `value === (value = get_value())` and skips the `innerHTML` write when the value is unchanged (`svelte/src/runtime/client/dom/blocks/html.js`); a sealed block hands back the same cached html string each frame, so its DOM node is never touched. An open code fence at the end of the stream is synthetically closed before parsing, so the lines that follow are not swallowed while the fence is still open.
- The cache holds the html *string*, not the wrapper object: Svelte's `{#each}` treats every object item as changed (`safe_not_equal` returns true for any object), so caching the object would buy nothing and mislead readers into thinking reference identity is the mechanism. The wrapper object is fresh each frame; only its html value is pinned.
- Verification: `streamingMarkdown` 15/15, `chat-ui` structural guards 183/183, `svelte-check` 0 errors / 0 warnings, production build passed. The selection-preservation mechanism is verified from the Svelte 5 runtime source (the `{@html}` value guard plus keyed-`{#each}` index reuse of the wrapper div, confirmed by compiling the exact template); a cold-start smoke walk - stream a multi-block reply, select text in an early block and confirm it survives, and confirm an unclosed fence does not swallow - is the remaining runtime gate (CLAUDE.md pitfall #10).

### Improved: several images in one turn render as a gallery, not a vertical stack

- A turn that produced six pictures rendered six full-width cards stacked vertically, pushing the rest of the conversation off screen. Consecutive image attachments now collapse into one grid whose height stops growing with the number of results.
- The column count is a real layout switch rather than an auto-fit that happens to land on three: one image keeps its full-width card (shrinking a lone result to a thumbnail loses the thing the turn was about), two split the width side by side, three or more use a three-column grid with square `cover` thumbnails — with `contain`, a portrait and a landscape result produce two different heights and the row reads as broken.
- Clicking any image opens a full-screen gallery with ←/→ arrows and keys, a wrap-around position readout, Escape and backdrop dismissal, and a download button. Images inside rendered Markdown open the same viewer, paging across every image in that block, so the two surfaces cannot drift apart.
- Grouping is by *consecutive* run, so a file between two images never causes the attachments to be reordered; only images that have finished loading enter the viewer, so the arrows can never page onto a blank slide.
- Fixed, in the same change, two independent reasons an attachment could stay a name-only chip forever. (a) The `{#each}` iterates groups derived from `attachments` alone, so resolving a file through a bare helper called from a `{@const}` read `actions` where the compiler could not see it and the cells never re-rendered when the record and blob URL arrived — the maps are populated *after* first render, so this was not subtle staleness but a permanently blank gallery (CLAUDE.md pitfall #2). Resolution now happens in a `$:` that names `actions` explicitly. (b) Nothing refetched the Session file list after a turn, so a file the run had just produced had no record until the next session switch; `ChatView` now implements the `afterMutate` hook the shared controller already calls.
- Verification: Desktop UI 184/184, `attachmentGroups` 6/6, `svelte-check` clean, production build passed. Exercised in a live render (dark and light): 1/2/3/6-image galleries plus mixed runs, arrow and keyboard navigation, wrap-around, single-image control hiding, Markdown-image paging, and — starting from empty maps, which is the real order of events — the chip → loading → image transition as records and then bytes arrive.

### Fixed: a turn blocked on an approval is now visible from anywhere in the transcript

- The Host Bash approval card renders at the end of the transcript, while `stickToBottom` deliberately hands scroll ownership to a reader who has paged up. Together those two correct behaviours produced a run that hung with the decision off screen and nothing anywhere saying so.
- Added a shared transcript dock: a jump-to-latest button whenever following is suspended, and an assertive "an approval is waiting for you / Review" pill whenever the blocked card is off screen. The dock is handed an element, never an approval-shaped flag, so the next blocking card (a Plan proposal) reuses it unchanged.
- The approval card now states how long it has been waiting, so a blocked run never reads as a dead service, and its window-level digit/⌘⏎ shortcuts only fire while the card is actually on screen.
- Both chat surfaces (Chat and Project Chat) are wired, not just the one the dock was written against.

### Improved: tool activity renders per payload instead of one grey `<pre>`

- Every tool used to print into the same `<pre>`, so a patch, a file, a shell transcript and an MCP payload were indistinguishable. Activity bodies now dispatch through a tested pure classifier: unified diffs render through diff2html, file contents and JSON through `CodeViewer`, shell output as a terminal block that keeps its columns.
- `edit` now also emits a real unified patch (`generateUnifiedPatch`) alongside pi's display diff, carried to the transcript on a new capped `ConversationActivity.diff`; the activity also records its own `tool` id rather than leaving surfaces to parse it back out of the dedup key.
- The collapsed head names a step ("Step 3 of 5 · npm test") instead of only counting them, preferring a failed step over the merely latest.
- The `paths`/`mutates` the runtime has always recorded are finally surfaced: a "N files changed / read" chip row that opens the file's diff or contents in the Artifact Panel, raised through the existing composer bridge so the generic component stays free of scope conditionals.

### Fixed: code and wide tables scroll inside the chat column instead of being destroyed

- Code blocks no longer force `pre-wrap`, which broke the indentation carrying their structure; they scroll horizontally inside a box clamped to the column, with a per-block wrap toggle for prose-shaped output. Markdown tables lost `table-layout: fixed`, which split a wide table into stacks of one character per column, in favour of a scrolling wrapper.
- Fixed the layout regression this exposed: `.assistant-layout` was a block-level flex container with `width: auto`, so it shrink-to-fit to its content — the first block wider than the column made the whole assistant row exceed the 720px message column and the transcript scrolled sideways.
- Images in rendered Markdown open in a lightbox attached to `<body>`, so it is never clipped by the transcript's overflow or a panel's stacking context.
- Removed the streaming bubble's private copy-code handler; every rendered-Markdown surface now shares one delegated handler, so the wrap toggle and lightbox work on the reply being generated too.
- Verification: Desktop UI 180/180, `activityView` 12/12, `test:projects` 71/71, edit/runner/projection 54/54, `svelte-check` clean, production build passed, and all three behaviours exercised in a live render (dark and light) — approval pill, per-tool renderers, wrap toggle, lightbox, and zero transcript overflow.

### Release: v2.9.13 / Desktop v0.9.10
- Synchronized the root and Desktop package versions for the new release.

### Added: Durable Execution foundation for multi-day work

- Added the shared Agent-layer Durable Execution foundation: dedicated SQLite state, versioned plans and leases, watched-event continuation, fresh automation attempts, side-effect intent/receipt records, verifier-gated completion, budgets, quotas, queue projection, and Desktop task surfaces/notifications.
- This is a partial foundation release. Tiered structured model preflight now promotes ordinary Runs lazily, absorbs their executed prefix and side-effect receipts, and stops the current tool before its handler when the Durable handoff is committed. External probes/evidence reading, full approval/channel adapters, cross-channel commands, and restart-level Chat API acceptance remain pending. Durable one-shot events now use the shared catch-up window and move to explicit `recovery_required` when the window is missed.

### Improved: Chat and Settings navigation now share one width baseline

- Desktop Chat and Settings now use the Settings navigation rail as their shared `228px` desktop baseline, with the same `170px` narrow-window width.
- Chat remains resizable and keeps saved widths at or above the baseline; stale narrower saved widths are clamped to `228px`, removing the runtime width drift between the two shells.
- Verification: Desktop UI 177/177, full Desktop tests 160 + 181 + 55, `svelte-check` clean, and production build passed.

### Maintained: one current assistant capability matrix and a clean data root

- Added one four-state capability matrix as the only current status source. Historical PRD sections and delivery logs no longer override it or regenerate already-completed work; H2, `add_content`, document export, Runtime Todo, and the owner-verified Mini App microphone are recorded as delivered.
- Applied the safe-only data cleanup after a fresh scan: 11 superseded items were removed and 326MB reclaimed. The follow-up scan reports no safe items. Raw response dumps, settings backups, `event.log`, and the Skill backup remain review-only and untouched.

### Added: verified DOCX, XLSX, and PDF deliverable export

- Added deferred `documentExport` for bounded Markdown-to-DOCX/PDF and typed multi-sheet XLSX generation inside Project or Session scratch. PPTX export and browser automation remain intentionally out of scope.
- Every output is read back from disk and format-parsed before the temporary file is atomically renamed or attached: Mammoth verifies DOCX text, `pdf-parse` verifies PDF text, and SheetJS verifies sheet names and typed cell values. Chinese PDFs embed packaged Noto Sans SC subsets.
- Added path/extension/content/cell limits and regression coverage for all three formats. Targeted document/tool/prompt/event tests pass and the production build succeeds.

### Fixed: reminders recover honestly and pass three live delivery chains

- One-shot reminders missed by a short restart now catch up once within the configured window; older reminders are explicitly skipped. Stable trigger slots and completed leases suppress repeated dispatch.
- Telegram and Feishu now fail closed when their bot/client is offline. Explicit `delivery=text` consistently means direct delivery for periodic/manual triggers across Web, Telegram, Feishu, QQ, and Weixin instead of accidentally invoking the Agent.
- Added a repeatable real-environment probe. Desktop/Web, Telegram, and Feishu each passed watched-event creation, CRUD update round-trip, scheduled trigger, completed execution receipt, and cleanup. A stale Telegram group id failed visibly rather than being reported as delivered.

### Verified: Mini App H2 final live install

- `node evals/run.mjs --id H2 --keep-data-dir` passed 1/1 in 280 seconds. The retained isolated data contains the installed manifest/server/UI; `miniAppManage` validate/install/inspect all returned receipts, and the service continued through the final model response after installation.
- Evidence: `evals/results/2026-08-09T07-49-11-671Z.json` and its matching service log.

### Fixed: Artifact Inspector now previews PPTX presentations

- `.pptx` files and the PowerPoint MIME type now route to a lazy `PptxPreview` in both Project and Session scopes instead of stopping at the unsupported-format card.
- The MIT-licensed `@silurus/ooxml` Canvas/WASM viewer renders a bounded, continuously scrollable slide desk with text selection, read-only status, and the shared download/external-open actions. External hyperlinks and Google Fonts are disabled; malformed or over-budget OOXML enters a retryable error state. Legacy `.ppt` and unknown binaries retain the system-open fallback.
- Verification: PPTX/registry tests 19/19, Desktop UI 176/176, `svelte-check` 0/0, and production build passed; the PPTX parser and WASM remain separate lazy chunks.

### Fixed: three P0 reliability gaps before expanding assistant breadth

- Published-content memory can no longer silently absorb personal facts: `add_content` requires explicit `world_knowledge`, rejects missing or conversational-memory types, and directs the Agent to `add`.
- Added a pre-provider context gate over the final system prompt, serialized tools, history, and current message. Oversized turns compact first, cap only the model-facing prompt if necessary, preserve the raw transcript, and fail before provider dispatch if the final context still cannot fit.
- Missing Web request thinking levels now remain absent instead of overriding the Runtime default with `off`; custom Subagents inherit developer-role compatibility from each configured model.
- The eval transport now gives long Agent work a 15-minute headers/body budget. Full baseline evidence is 24/31 with no Provider-chain errors; the corrected affected set C1/C4/D1/D2/H2 is 5/5, including a 429-second H2 with the service still alive.
- Calendar, contacts, email, and browser capabilities were intentionally not added. Calendar/contact/email remain external Skill/MCP/Connector integrations; browser work remains P1.
- Verification: final memory/context/compaction/thinking/Subagent suite 62/62, eval client/harness/cleanup suite 25/25, affected live eval 5/5, and production build passed.

### Fixed: Artifact Inspector now previews DOCX documents

- `.docx` files and the Word MIME type now route to a lazy `DocxPreview` in both Project and Session scopes instead of stopping at the unsupported-format card.
- Mammoth converts the authorized bytes to Markdown, then the existing sanitized Markdown renderer owns the final read-only surface. External file access and embedded image resource loads are disabled; conversion warnings are non-blocking and malformed documents can be retried. Legacy `.ppt` and unknown binaries keep the system-open fallback while PPTX uses its slide viewer.
- Verification: DOCX/registry tests 18/18, Desktop UI 175/175, `svelte-check` 0/0, and production build passed (existing chunk-size warnings only).

### Fixed: Artifact Inspector now previews XLS/XLSX workbooks as tables

- `.xls` / `.xlsx` files no longer stop at the unsupported-format card. The shared viewer registry routes spreadsheet extensions and Excel MIME types to a lazy SheetJS-backed read-only table viewer in both Project and Session scopes.
- Workbooks expose sheet tabs, sticky headers, row numbers, horizontal overflow, and a 5,000-row-per-sheet DOM cap with a visible truncation state. Parse failures are retryable; formulas are never executed, and legacy `.ppt`/unknown binaries keep the system-open fallback while DOCX/PPTX use dedicated viewers.
- Verification: spreadsheet/registry tests 18/18, Desktop UI 174/174, `svelte-check` 0/0, and production build passed (existing chunk-size warnings only).

### Improved: Git Changes rows show impact and diff gutters scroll with code

- Project Changes rows now include GitHub-style `+additions` and `−deletions` counts sourced from `git diff HEAD --numstat -z`, including staged, unstaged, deleted, renamed, and untracked text files. Binary and unavailable counts are explicit instead of misleading.
- Anchored diff2html's absolute line-number gutter to the rendered diff surface so vertical scrolling keeps each line number beside its code row in both diff layouts.
- Verification: project inspection 13/13, Desktop UI 173/173, with the existing Artifact Inspector `svelte-check` and production build gates retained.

### Added: route-driven image analysis and PDF OCR

- Added deferred `imageAnalyze(path, prompt?)` for on-demand OCR, screenshot inspection, invoice/chart reading, and general workspace-image understanding. It always follows the current Agent/global `visionModelKey`; arbitrary per-call model selection is intentionally unavailable.
- Consolidated inbound image fallback and tool-driven image analysis behind one shared vision module using the existing pi/custom provider runtime. Channels remain responsible only for receiving, persisting, and normalizing attachments.
- Extended `docExtract` with `auto`, `force`, and `never` PDF OCR policies. Auto mode only rasterizes low-text pages that contain embedded images; every OCR call is sequential and capped at 20 pages. Image and OCR output use the shared context budget/full-output spill and remain labeled as untrusted evidence.
- Added a two-turn live eval proving an Agent can rediscover a persisted attachment, load `imageAnalyze`, dispatch it through the configured vision route, and return the observed color without a new inbound image.

### Added: first-party PDF, DOCX, and XLSX document extraction

- Added deferred `docExtract(path)` for contracts, invoices, reports, papers, and Office attachments. PDF content streams are parsed with `pdf-parse`; DOCX semantic HTML is produced by Mammoth with external-file access disabled and converted through the shared HTML-to-Markdown cleaner; XLSX sheets are rendered as labeled CSV sections through the packaged SheetJS 0.20.3 dependency.
- Kept basic `read` small and explicit: supported binary documents now point the Agent to `docExtract`. Inputs and resolved symlink targets remain workspace-scoped and capped at 50 MiB; Office archives have unpacked-size/entry-count limits; extraction calls are serialized to avoid concurrent memory spikes; extracted text uses the shared line/byte budget, UTF-8-safe single-line fallback, and full-output spill path. Scanned/image-only PDFs can now use the configured vision route for OCR.
- Replaced B2's easy plaintext PDF with a valid FlateDecode fixture whose answer is absent from the raw bytes, and require a recorded `docExtract` call. Unit/integration coverage passes and the isolated live-Agent B2 eval completes successfully.

### Added: Runtime Task CRUD without Mini App Todo coupling

- Replaced the create-only Agent `createEvent` surface with deferred `runtimeTask` CRUD for unscheduled todos, reminders (`one-shot`), and automations (`periodic`). Stable task ids now support list/get/update/delete without manual event-file edits; plain todos are retained but never dispatched.
- Clarified the runtime model: Task owns user CRUD, Event is trigger/execution state, and Notification is a delivery outcome. Immediate events and Molibot-managed internal jobs are excluded from user task mutation.
- Extended Desktop's opaque task-id management path to one-shot reminders, while keeping the optional Todo Mini App's storage and business rules fully isolated from Agent Runtime Tasks.
- Added ADR 0003 plus regression coverage for CRUD, task-type validation, internal/immediate exclusion, and reminder path resolution.

### Added: third-party runtime process fault isolation

- Mini App server modules now run one process per App, with bounded IPC for tools/HTTP and explicit AI, badge, and log bridges. Exit, infinite loop, V8 heap exhaustion, timeout, and cancellation terminate only that App runtime; the next call recreates it.
- Agent-side scratch validation now uses the same child-process boundary; a candidate module can no longer re-enter the service through the Host's test-only import seam.
- Installed Pi extensions now load and execute outside the Molibot service process. Tools, runtime events, and commands cross a serializable IPC boundary, so extension process failure no longer takes down channels or active service work.
- The shared tool runtime now has a final execution deadline and propagates abort to process-backed handlers, preventing an asynchronous tool that ignores cancellation from holding a run forever.
- These are crash-containment boundaries, not OS permission sandboxes; installed Mini Apps and extensions still require trust.

### Fixed: Mini App install approval no longer masquerades as a service crash

- H2's five-minute `fetch failed` was a pending ApprovalBroker request, not an unhandled service crash: Desktop rendered a shared approval card but its endpoint could only resolve Host Bash records. The eval client then timed out and stopped its own service, explaining the absent crash report.
- Desktop pending approvals now merge Host Bash and Broker requests for the exact Session, and the same endpoint resolves Broker once/session/persistent/reject decisions without crossing Session boundaries.
- H2 opts into one-time approval explicitly and exercises that production API; normal critical-tool policy is unchanged. Deterministic tests cover the concurrent wait/approve path. Later the same day, Provider override/role compatibility and the eval transport timeout were corrected; live H2 passed twice, including a 429-second run with the service still alive.

### Improved: Artifact Inspector file icons now carry language and media identity

- Restored per-type Phosphor glyph colours across the project tree, search results, open tabs, Session attachments, and the system open card. TypeScript/JavaScript/Python/Rust/Go/Vue/Svelte/CSS/Markdown/JSON/YAML/SQL, media, archives, and Office files now read at a glance.
- Added special-name resolution for README, Dockerfile, `.gitignore`, `.env`, `package.json`, and lock files. Unknown extensions remain neutral, while directory glyphs use a stable folder accent.
- Kept file-type colour separate from selection, dirty, touched, warning, and failure semantics; focused selected rows no longer flatten their file glyphs to grey.
- Reused the existing `@phosphor-icons/web` dependency after reviewing Iconify/VSCode Icons and older file-icon font packages, avoiding a remote icon API and a second icon runtime.
- Verification: `fileIcons.test.ts` 3/3; existing Desktop UI/artifact suites, Svelte check, build, and diff check remain green.

### Fixed: JSON artifacts now open as source first instead of freezing the Inspector

- Opening a JSON tab now shows the original file through the shared highlighted `CodeViewer`; tree parsing is an explicit “Parse as tree” action, and “View source” returns to the exact source view.
- Project previews that are still partial disable tree parsing until the remaining bytes are loaded. Invalid JSON, oversized files, deep recursion, and a 5,000-row tree budget all fall back to readable source with a localized explanation.
- Escaped JSON Pointer paths prevent duplicate tree keys for object names containing `/`, and visible-row projection is linear so collapsed trees do not rescan every ancestor for every row.
- Verification: `jsonTree.test.ts` 13/13, `chat-ui.test.mjs` 173/173, `svelte-check` 0/0, `vite build` passed (existing chunk-size warnings only).

### Improved: Project file rows stay single-line and use filename status color

- Removed the standalone agent-touched dot from Project file rows. It was a fifth grid child in a four-column layout, which pushed sizes such as `5.5 KB` into an implicit second row.
- File sizes now remain `nowrap`; touched filenames use the semantic warning/attention color, matching Git's modified-file language. The Changes tab remains the place for detailed update review.
- Verification: Desktop UI structural tests, `svelte-check` 0/0, and production build pass.

### Fixed: memory namespaces and private-turn retention now share one contract

New personal facts and preferences now default to the owner namespace (or the current project namespace) instead of a channel chat namespace, so an acknowledged memory remains reachable from ordinary authorized conversations. Published-content and Agent-self namespaces remain isolated by purpose.

Turns now persist one policy across transcript metadata and Agent entries. “Do not remember” blocks memory writes and reflection; “not searchable” additionally excludes conversation indexing; “this turn only” additionally excludes future Agent Context while preserving the visible audit transcript. The same rules cover user and assistant entries, external-channel search reconciliation, automatic memory flush, daily reflection, and run-derived memory artifacts. Delete remains an explicit target operation with existing search tombstones for message/session removal.

### Added: first-party `webFetch` for reading public webpages

Agents can now fetch a user-provided public HTTP(S) URL, extract readable Markdown, and inspect it against an explicit prompt. The deferred built-in tool complements `webSearch`: search finds a page; fetch reads its body.

The fetch boundary rejects credentialed, local, private, link-local, multicast, and documentation-only network targets; revalidates DNS and redirects; surfaces cross-host redirects for an explicit second call; rejects binary documents; and caps time, bytes, redirect hops, cache size, and context output. A narrow DNS-only exception keeps public hostnames working behind Clash/TUN fake-IP proxies while direct access to that synthetic range remains blocked. HTML scripts/styles and page chrome are removed, fetched text is labeled as untrusted evidence, and oversized or single-line content uses the existing shared UTF-8-safe tool-output budget.

### Fixed: memory saved in conversation could not be recalled in a later one

An unstructured `memory add` — the shape the agent uses for almost every "remember this", since it carries neither `type` nor `subject` — was written where an ordinary later turn does not read. The `memory` tool answered "Added memory: mem-…" and the next session answered "记忆里没有记录", both truthfully. Found by the new `evals/` C group (0/4 in a clean environment) and confirmed against the stored rows.

Two defaults were wrong, both in `buildMoryWritePlan`, and both are fixed:
- **Type** defaulted to `task`, which the `chat` retrieval intent (a normal turn's default) excludes from its `memoryTypes` SQL filter, and which the injected profile only files under the time-windowed `currentFocus` bucket. The new `defaultMemoryTypeForLayer` makes it `user_fact` (long-term) / `event` (daily), both of which an ordinary turn reads, and the path prefix now derives from the same type so the two filters agree.
- **Namespace** defaulted to the per-channel-per-user `chat:` namespace, which changes key whenever the session or channel does. It now resolves through `namespaceForDomain` to `owner:owner`, the owner-wide namespace shared across every surface — the right default for a single-owner personal assistant.

Guarded deterministically (no live model) by `moryCore.plan.test.ts`. The remaining `add_content` seam is now closed at the tool boundary: it accepts only explicit published-content `world_knowledge` and rejects personal-memory routing. Existing fragmented rows in a real database are intentionally not migrated.

### Added: `evals/` golden set — a measured answer to "can it actually do the work"

Thirty-one real tasks with known-good outcomes, run against a throwaway service, producing one number. Until now every suite verified that a function returns the right value for a given input; none of them could say whether the Agent got a job done, so a model swap or a prompt change could only be judged by feel.

- Tasks are graded on outcome and evidence, never on route: state assertions (`file_exists`, `file_contains`, `sqlite`) rank above trace assertions (`tool_used`, `tool_not_used`), which rank above reply text. A `judge` assertion with no judge model configured reports **unproven** and is counted separately from both pass and fail.
- Schema validation runs before any model call, so an unknown assertion key, a task with no assertions, or a malformed regex fails the load — otherwise a typo would make a task assert nothing and report a pass.
- Each task records a `baseline` prediction and a `why`; the report flags every result that disagrees with its prediction in either direction, so a closed gap and a regression are equally visible.
- Each run gets a fresh `DATA_DIR` and starts the service through `scripts/start-server.mjs`, never `node build/index.js` (prd.md §3.41). Provider configuration is seeded from `~/.molibot`, which necessarily copies channel credentials, so `MOLIBOT_DISABLE_EXTERNAL_CHANNELS=1` is set and asserted before the process starts.
- PDF, PNG and CSV fixtures are generated by visible code rather than committed as binaries.
- Verification: `evals/harness.test.mjs` 17/17, `clean-data-dir.test.mjs` 5/5, and a full baseline run against the live runtime.

**First baseline: 23/30 (77%)** — A 5/6 · B 4/5 · C 1/4 · D 3/3 · E 1/2 · F 6/6 · G 2/2 · H 1/2. Two P0 findings came out of it, both filed in `prd.md`:

- **§3.49 — memory does not survive a new session.** The C group is red in a clean environment. C3 has the full evidence chain: the corrected fact *is* written (`memory_nodes` holds "常用的笔记工具是 Obsidian（已弃用 Notion）") but under `user_id = content:personal`, while the run's `MemoryScope.externalUserId` is `web:personal:eval-c3`. The live database shows the same fragmentation: 1229 rows across **11** different `user_id` shapes.
- **§3.48 — installing a Mini App appeared to kill the service.** The log stopped at `tool_start … tool=miniAppManage` because a critical Broker approval could be displayed but not resolved by Desktop. After five minutes the eval HTTP client timed out and its cleanup stopped the service; no service crash had occurred.
- **§3.48 fixed both exposed seams.** Desktop now resolves Broker approvals through the shared card endpoint, H2 explicitly approves once through that endpoint, and scratch candidate validation uses the normal per-App child runtime. Regressions cover approval Session isolation and a top-level candidate `process.exit(73)`.

F 6/6 is the encouraging half: the failure posture — refusing to fabricate a file's contents, admitting it cannot post to Weibo, reporting an unwritable path instead of claiming success, keeping tool syntax out of prose, and taking no side effects on a plain question — held on every check.

### Fixed: plain-HTTP same-origin uploads were rejected as cross-site form submissions

`adapter-node` derives the service's own origin from request headers and **defaults the scheme to `https`** when nothing says otherwise, so the server believed it was `https://127.0.0.1:<port>` while a browser on `http://localhost:3000` sent an `http` origin. The two never matched and every same-origin multipart POST — any Web attachment send — was refused with "Cross-site POST form submissions are forbidden".

This is the third surface of the same failure (CLAUDE.md pitfall 25) and it hid behind the previous two: `tauri://localhost` is on the trusted-origin list, so the packaged desktop app worked and only the plain Web surface was broken. The fix is not another trusted origin — the origin was legitimate and same-site. `start-server.mjs` now declares the real origin via `resolveServiceOrigin()`, and leaves it alone when the operator has set `ORIGIN` or `PROTOCOL_HEADER`, or when the bind is not loopback.

### Fixed: the launcher erased the environment layer that `DATA_DIR` isolation depends on

`dataDirScope.ts` drops a `DB_DIR` that came only from the repository `.env` when `DATA_DIR` was set in the OS environment — that layer distinction is the whole guard (prd.md §3.41). But `scripts/start-server.mjs` must read the repository `.env` before it can resolve `DATA_DIR` and take the lease, and that merge happens *before* `env.ts` snapshots `process.env`, so the repository's value was indistinguishable from an operator's export. A source install started with a scoped `DATA_DIR` refused to boot instead of dropping the override. The launcher now publishes the true OS key set in `MOLIBOT_OS_ENV_KEYS` before its first `dotenv.config()`, and a source-order test keeps the two statements in that order.

### Added: `MOLIBOT_DISABLE_EXTERNAL_CHANNELS` kill switch for outward channels

The ownership gate asks whether this process owns its data directory, which is the right question for an orphaned duplicate and the wrong one for a throwaway run: an eval instance seeded from a real data directory holds real bot tokens *and* legitimately owns its own temporary directory. The switch outranks ownership for every plugin that does not declare `requiresServiceOwnership: false`, and drives teardown through the existing reconcile loop rather than a second shutdown path. Web and CLI keep running.

### Fixed: superseded desktop runtime generations are now reclaimed

Every upgrade extracts a new ~300 MB `runtime/desktop-runtime-<version>` directory and nothing ever removed the old ones — an install updated a few times was carrying gigabytes of unreachable service code (a v2.6.3 generation was still present on a v2.9.12 install). The supervisor now prunes on both the cached and the freshly-extracted path, keeping the current generation plus one, since an adopted sidecar from the previous build may still be lazy-loading its chunks. Abandoned `desktop-runtime-<uuid>` extraction directories, which can never be in use, are always removed. Best-effort: a directory that will not delete costs disk space, never a failed start.

### Improved: one source for the runtime and tooling directory layout, and a data-directory cleanup tool

`<dataDir>/runtime` (service-owned: lock, state, logs, crashes, generations — mode 0700) and `<dataDir>/tooling` (Agent-owned: Python venv and caches, GOPATH/GOCACHE) had their paths written independently in four places. They are now declared once per language — `storagePaths`, `scripts/runtime/runtime-paths.mjs`, and the Rust supervisor — and a test asserts the two trees stay disjoint in both directions, because folding the Agent's writable working directory into the supervisor's private tree would put the running service's own code one `rm -rf "$TMPDIR/../.."` away from a Skill.

Go tool isolation no longer depends on `MOLIBOT_TOOLING_DIR` being set: the default install used to let `go install` write into the owner's `~/go`, the exact pollution the tooling directory exists to prevent. Settings provider-test artifacts moved from three top-level directories into `cache/settings-tests/`. `node scripts/maintenance/clean-data-dir.mjs` reports superseded and leftover files with sizes and reasons and deletes nothing without `--apply`; a relocated database is only ever proposed once its migrated copy exists in `db/`.

### Improved: Artifact Inspector now uses a GitHub / Primer code-workspace language

- Reworked the right-side File / Artifact Inspector as a three-plane repository workspace: canvas, source tree, and editor/preview surface. Existing file tabs, search, Git changes, session attachments, diff, download, source toggles, and resizable split remain intact.
- Replaced floating macOS-style file controls with flat repository tabs, accent underlines, a path/action header, and border-led selection states. Human-readable names use the UI font; paths, identifiers, line numbers, tables, and code use Mono.
- Applied scoped Primer light/dark semantic tokens and GitHub-like syntax, Markdown, JSON, CSV, diff, SVG, and media-preview colors. Dirty/modified/added/deleted states retain semantic emphasis without recoloring the rest of Desktop.
- Verification: `svelte-check` 0/0, `vite build` passed (existing chunk-size warnings only), `chat-ui.test.mjs` 173/173, Artifact viewer tests 43/43, and `git diff --check` passed.

## 2026-08-08

### Release: v2.9.12 / Desktop v0.9.9
- Synchronized the root and Desktop package versions for the new release.

### Improved: Desktop Artifact Inspector now follows DESIGN.md

The right-side File / Artifact Inspector now uses system UI typography for human-readable file names, monochrome file glyphs, and semantic colors only for dirty, touched, warning, and failure states. Project tabs, change scope, search modes, and attachment filters share compact macOS segmented-control geometry with tonal and border selection instead of elevation shadows; attachment filters expose their pressed state to assistive technology, and the narrow layout honors the shared 300px Inspector floor.

### Added: Mini App installs and updates activate immediately

Installing or replacing a Mini App now makes its new server code callable in the current Molibot runtime—no App or service restart. The shared Host drains active calls, disposes the previous Runtime process, refreshes discovery, and eagerly activates a content-addressed bundle of the complete server module graph in a fresh child process. This invalidates Node's cache for changed child modules and same-version replacements while preserving app data and enablement. Desktop and Agent install paths now share that lifecycle, and the obsolete restart-required response/UI state is gone.

### Improved: Telegram and Feishu queued messages now have Stop and Steer buttons

When another message arrives while an Agent task is running, its queue notice now includes one-click Stop and Steer actions instead of requiring `/stop` or `/steer <queueId>`. Steer injects that exact queued message into the active task; Stop aborts the task and clears pending work. Shared scope and queue-state validation prevents stale, forwarded, duplicate, or opposite clicks from affecting another run, and these runtime controls never enter conversation history or model context.

Feishu now acknowledges those clicks with an immediate processing card and then explicitly updates the original card to the final Stop/Steer result. If the card update API fails, Molibot sends the same result as a text receipt, so a successful, stale, or failed action is never left without visible feedback. HTTP and WebSocket card callbacks are both observable in service logs.

Accepted Steer messages now survive whole-attempt model retries. If a provider times out after the Agent has consumed the injected text, the shared Runner restores that runtime-only message before the next attempt instead of silently reverting to the original prompt; replay remains exactly once per attempt and does not create a normal Session turn.

### Added: Review daily memory candidates from Telegram and Feishu

Daily Memory Reflection now keeps its aggregate completion notice and follows it with individually numbered candidates in the configured private Telegram or Feishu chat. Each candidate can be kept or rejected with one button click. Review batches, delivery identity, numbering, and decisions survive restarts and remain idempotent; group targets receive no candidate content, Skill draft suggestions stay App-only, and channel callbacks never enter Agent conversation history. Telegram edits the source message after a decision, while Feishu uses a prompt processing response and asynchronous card update with retry buttons restored after transient failures.

### Fixed: MCP dynamic loading reports the requested server's real outcome

MCP save and enable still reconcile immediately without restarting Molibot, but explicit Reconnect now fails when its target remains unavailable instead of returning a false success. Agent `loadMcp` now consumes workspace-scoped per-server states and validates the requested server id, so an already connected MCP can no longer hide another MCP's connection failure. Failed selections remain active for a direct retry on the next turn; existing disconnect recovery and cross-Session isolation are unchanged.

### Release: v2.9.11 / Desktop v0.9.8
- Synchronized the root and Desktop package versions for the new release.

---
## 2026-08-07

### Changed: Mini App AI settings moved to Settings › Models; Settings › Plugins drops its Mini App manager

Settings › Plugins carried a full second copy of the Mini App management surface (install tabs, built-in offers, the installed list) plus the Mini App AI model selectors. Neither belonged there: browsing and installing apps already has a home in the sidebar's Mini Apps destination, and the AI selectors are a *model route* like every other one on the Models page.
- **Removed** `MiniAppsSettingsGroup.svelte` and its `.miniapps-card` wrapper; Plugins now renders only memory backend + feature plugins. `MiniAppsManager` is mounted from exactly one place (`ChatWorkspacePane`), asserted across every Settings section.
- **Moved** `MiniAppsAiSettings` into `ModelsSection`, and re-rendered it with that page's own `SettingGroup` / `SettingRow` / `SelectControl` primitives (bespoke `settings-card` + `settings-form` markup removed) so it reads as part of the screen instead of a transplant. Both selectors gained the page's `technicalId` disclosure; the cost note and 30-day usage block were re-inset to match `SettingRow`'s 16px gutter.
- **Rewired** the Mini Apps page signpost from `openSettings("plugins")` to `openSettings("models")`.
- The controls still commit immediately through their own route, and the Models page has no `<form>` — a change here can neither be swept into the advanced-routing save nor block it (guarded).
- Verification: `chat-ui.test.mjs` 173/173, `svelte-check` 0 errors / 0 warnings, `vite build` OK.

### Improved: Unified Todo/Note header layout and tightened sizes

Both Mini Apps now share one header pattern: app icon, a dropdown trigger, and the search box in a single row. Todo's dropdown opens the task-list picker (the redundant hamburger button is gone); Note's dropdown opens the Notes/Archive view switcher, so the old tab bar moved into the dropdown and the manual refresh button was replaced with auto-refresh on panel focus. Sized the header to DESIGN.md's compact toolbar tier: 32px search/trigger controls, 14px body text, 16px titles (Todo's title dropped from 22px), and a 40px collapsed composer. Drift guard stays green (4/4).
- **Note cards without a title** no longer reserve an empty title row: the action buttons float to the top-right and the content starts at the card's top padding instead of below a blank header.

### Improved: Built-in Mini Apps restyled to the macOS / Geist design system

The Todo and Note Mini Apps shipped a Material Design 3 baseline (Google Blue, Google Sans, M3 ripples/elevation tints, Google Keep palette) that read as a different product from the macOS/Geist desktop app. Repointed the shared `--md-*` baseline in all four style sheets (todo, note, meeting-notes, miniapp-creator template) to the Molibot macOS product layer from DESIGN.md: accent `#007aff`, `-apple-system` font, AppKit semantic surfaces/labels/separators, 6/8/12/999 radii, and shadows reserved for floating overlays (cards stay flat on a separator border). The `--md-*` namespace is kept (pinned by `uiDesignBaseline.test.ts`); only the values change, so the drift guard stays green.
- **Todo**: removed M3 ripple pseudo-elements, refocused composer/search on border + accent focus rings instead of elevation shadows, and made list/move dropdowns white popovers.
- **Note**: retuned the seven card colors from Keep-saturated to soft Geist-scale tints, and dropped ripples for subtle hover/focus states. The Note lightbulb icon was left as-is.
- **Versions**: Todo 1.5.0 -> 1.6.0, Note 1.2.0 -> 1.3.0, Meeting Notes 1.1.0 -> 1.2.0 (baseline mirror) so on-disk installs update.
- Verification: `uiDesignBaseline.test.ts` 4/4, `bootstrap.test.ts` 17/17.

### Release: v2.9.10 / Desktop v0.9.7
- Synchronized the root and Desktop package versions for the new release.

### Improved: Added icon for Note "Insert into composer" menu and brought the feature to Todo

- **Note Mini App**: Added the missing SVG icon for the "Insert into composer" item in the note dropdown menu, aligning its visual appearance with Archive and Delete actions.
- **Todo Mini App**: Added the "Insert into composer" action button to Todo item action rows using the `composer.insert` bridge protocol, allowing users to instantly push task titles into the chat draft area.

### Improved: Todo Mini App UI redesigned for crisp Material 3 elegance

Redesigned the Todo Mini App interface to resolve layout clutter and visual noise while strictly preserving the Material Design 3 design baseline (`uiDesignBaseline.test.ts` 4/4 passing):
- **De-cluttered item rows**: Removed the redundant normal-priority ring indicator that previously appeared beside every check circle (which gave every row two side-by-side circles). High and low priority tasks now use clean colored rings, while normal tasks show only the clean check circle.
- **Card boundaries and inner dividers**: Enclosed task groups in M3 container cards (`surface-container-low`) with subtle `outline-variant` row dividers.
- **Header & list dropdown**: Added a subtle chevron with animated 180° rotation on dropdown open; list title is now an interactive trigger for the list picker dropdown.
- **Search & Composer elevation**: Added smooth focus state layers, `elev-2` shadow transitions, and styled date/time inputs.
- **Illustration Empty State**: Replaced raw text empty states with an M3 SVG check illustration and friendly task status messaging.

### Fixed: Mini App schema upgrades no longer block app startup

`assertSchemaVersion` in `host.ts` threw `load_failed` when `_host.json` recorded a different `schemaVersion` than the manifest declared — which meant any Mini App that bumped its schema (e.g. Todo v3 adding `due_at`/`remind_at` columns) could never start after an update, even though the app's own `openDatabase()` ran defensive `ALTER TABLE` migrations. The host now logs the version change and lets the app start; `writeHostState` records the new version after successful runtime creation. If the app's migration fails, the error propagates and the recorded version stays unchanged.

### Changed: Mini App version bumps — Note v1.1.0 → v1.2.0, Todo v1.4.0 → v1.5.0

Version bumps to trigger update-available detection in the Mini Apps Manager for the new Note menu icon fix and Todo "Insert into composer" feature & UI overhaul.



### Changed: the three built-in Mini Apps now share one Material 3 design baseline

The panel looked like three different products. Note was Google Keep, Todo was iOS (`-apple-system`, `#007aff`, 14px radii, SF-style separators), and Meeting Notes was a single minified line of generic grey-and-blue with its own third palette — three type scales, three shadow systems, three ideas of what a button is. All three now render from one Material Design 3 token set: Google Blue primary, the full neutral surface-container ramp, a type scale declared as size/line-height **pairs**, the 4/8/12/16/28/full shape scale, M3 easing curves, and elevation expressed as container tint plus a soft shadow.

- **The baseline is duplicated on purpose, and guarded.** Each App is served from its own origin under `default-src 'self'` (`httpRoute.ts`), so there is no stylesheet the three could import — the `--md-*` block has to be copied into all three plus `skills/miniapp-creator/template`. Nothing errors when one copy drifts; it just makes the panel look like three products again. New `uiDesignBaseline.test.ts` parses the token declarations out of all four sheets and fails on any difference, on a missing `[hidden]` guard, and on a raw `font-size: Npx` anywhere (the drift mechanism from pitfall 24). Confirmed to fail on an induced drift, not only to pass.
- **Interaction is now a state layer**, not a background swap: `color-mix(in srgb, currentColor 8%/12%, transparent)` for hover/press, a CSS-only ripple on menus and icon buttons, and `:focus-visible` rings everywhere. Filled buttons express hover through elevation and brightness, since `background-color` is already spent.
- **App-level expressive colour stays app-level**, layered over the baseline: Note keeps a note palette (refreshed to Keep's current tones, with Keep's real dark set), Todo keeps priority colours. Note's swatches no longer carry inline hexes — both palettes are driven by the same `[data-color]` rules that paint the surfaces, so a swatch cannot disagree with the note it represents in either theme, and swatch selection now shows a checkmark rather than colour alone.
- **Icons**: the three app icons were three visual languages (a 64-unit blue tile, two 24-unit glyphs); all three are now Google-palette two-tone 24-unit glyphs. In-app SVGs moved to Material Symbols geometry at the M3 icon sizes — Todo's action row was drawing 13px icons.
- **Three real defects surfaced while doing this and are fixed.** (a) Todo's Completed section was rendered but permanently invisible: `index.html` carried an inline `style="display:none"` that beat the `.done-section.visible { display: block }` rule meant to reveal it — the same family as the documented `[hidden]` failure, with an inline style instead of an author `display`, and equally silent. (b) Todo's static shell (search placeholder, "New To-Do", "Add", "New List", "No to-dos", the priority label) was never translated, so a zh locale showed English chrome around Chinese content — most of what read as "messy". It now runs the same `data-i18n` pass the other two Apps use. (c) Todo's per-list accent came from the iOS system palette in a single set, so the same tone was used as text colour on both light and dark surfaces; it is now the Google label palette with a per-theme set.
- Meeting Notes also gained localized status chips (its statuses were raw English enum values in both locales) and its recording banner moved off `error-container` — recording is a state, not an error, and a full-width red band read as a failure in dark theme. The alert tone is now spent only on the pulsing dot and the Stop button.
- No version bump, no behaviour change to any App's data, tools, or API surface.
- Verification: Mini App server + route suites 127/127 including the new baseline guard 4/4; desktop unit 145/145, structural 177/177, Rust 52/52. Rendered verification rather than by eye — all three UIs were served through a stub-API harness and checked in light and dark, at the real DOM the shipped `app.js` produces: Note's grid/composer/palette, Todo's list/picker/composer/completed section, Meeting Notes' two-pane detail, segments, and recording banner.

### Fixed: one WeChat question got five answers — the runtime now owns its data directory, and `DATA_DIR` really isolates

Five `node build/index.js` processes left over from smoke and upgrade-probe runs on 2026-07-26 and 08-05 had been long-polling the production WeChat bot for twelve days. One message received five replies, each reporting a different session list (`s-20260807-xpjk` / `kaoh` / `bsxv`) that existed nowhere in `~/.molibot`, so the owner could neither find the sessions nor identify the responders. The processes served no HTTP port, held no lease, and appeared in no UI — only `ps` could see them. Two independent defects had to line up for this, and each is now closed.

- **Ownership moved from the launcher into the runtime.** `acquireServiceLease()` lived only in `scripts/start-server.mjs`, so `node build/index.js` skipped the lease, the signal handlers and the forced exit in one step — and its long-poll loop then kept the event loop alive indefinitely. `serviceOwnership.ts` now adopts the launcher's lease when the published `MOLIBOT_SERVICE_OWNER_ID` matches the lock, otherwise acquires one itself, and **fails closed on conflict and on any lock it cannot evaluate** — an unreadable lock is not evidence of ownership. `applyChannelPlugins` is the single gate: an unowned process gets an empty instance list for every plugin that does not declare `requiresServiceOwnership: false`, so teardown runs through the existing reconcile loop instead of a second shutdown path. Only the local `web` plugin is exempt; the default is "required", so a third-party channel cannot opt out by omission. Acquiring once is not enough — a 30s unref'd watchdog re-reads the lock and re-runs the same apply path when ownership is lost (a swept `/tmp` data dir, a takeover). A runtime-acquired lease releases on `exit`, `SIGTERM` and `SIGINT`, since a process that bypassed the launcher has no other handler.
- **`DATA_DIR` now isolates the whole tree.** `DB_DIR` resolved independently of `DATA_DIR` and the repo `.env` pinned it to `~/.molibot/db`; because `dotenv` merges that in before any path is resolved, `DATA_DIR=/tmp/molibot-smoke` sent sessions and workspaces to `/tmp` while `settings.sqlite` — holding the live WeChat token — was opened **read-write** on the real data directory. `dataDirScope.ts` makes the configuration layer decide: an override present only in the cwd `.env` is dropped when `DATA_DIR` came from the OS environment, and a non-default `DATA_DIR` whose data still escapes it refuses to boot unless `MOLIBOT_ALLOW_EXTERNAL_DATA_PATHS=1`. Applied to `DB_DIR`, `SETTINGS_FILE`, `SETTINGS_DB_FILE`, `WEB_WORKSPACE_DIR`, `SESSIONS_DIR`, `SESSIONS_INDEX_FILE` and `PI_CODING_AGENT_DIR`. The dropped override is announced on stderr — a silently relocated database is the whole failure.
- **Behaviour change worth knowing**: a live orphan holding the lease now blocks the desktop sidecar (`start-server.mjs` exits 73) rather than silently double-answering. That is the intended trade, but today it surfaces only as a restart loop in the service log; a user-facing state for it is filed in prd.md §3.41.
- Recorded as prd.md §3.41 and CLAUDE.md pitfall 30. The third finding — smoke harnesses must launch through `start-server.mjs` and reap the pid on exit — is a working rule with no code change.
- Verification: new `dataDirScope.test.ts` (8) and `serviceOwnership.test.ts` (6) wired into `test:service-bootstrap`, 36 pass; `test:projects` 68/68; `test:desktop-chat` 249/250 with one pre-existing `SessionStore` failure reproduced on clean `master`; desktop `svelte-check` 0 errors / 0 warnings over 1545 files; production build clean. Cold path exercised against the real build (pitfall 10): the incident's own invocation now opens `/tmp/.../db/settings.sqlite` instead of the production database and logs the dropped `DB_DIR`; a foreign live lock produces `channel_plugins_suppressed` with telegram/feishu/qq/weixin at 0 instances and `web` still at 1; an unowned directory is claimed by the runtime's own pid; a stale lock from a dead pid is reclaimed; `SIGTERM` releases the lock and exits; `DATA_DIR=~/.molibot` and an unset `DATA_DIR` both still resolve to the production database unchanged.

### Added: Mini Apps can show a result card, link back into themselves, badge the sidebar, and attach files to the composer

Four connected additions from `docs/requirements/miniapp-platform-extension-roadmap.md` §2.2–§2.5. Together they close the loop the earlier slices opened: an App could already receive a message and call host models, but everything it produced came back as one line of plain text with no way to point at what it made.

- **Composer bridge v2** (`composer.attach`, `chat.openSession`). `composer.attach` is the return leg of the attachment path Phase 2 delivered — an App that edited an image or exported a summary can put the file back in the chat draft. The `path` is relative to the App's own data directory; the host resolves it, proves containment after following symlinks, and answers with a basename plus bytes, so the WebView never learns a host path. **v1 apps are unaffected**: both versions stay supported and each version's action set is frozen, so a v1 message asking for a v2 action gets `unsupported_action` rather than being silently upgraded. The bridge still carries UI intent only — no action can send a message or start an Agent turn, and there is a structural guard asserting that stays true.
- **Result cards.** A tool result may carry a `card` (title, subtitle, up to 6 label/value fields, a Phosphor icon, one deep link) rendered beside the message-action feedback in both Chat and Project Chat. Deviates deliberately from the roadmap's "reuse the iframe/CSP boundary" sketch: an iframe per card means unbounded live documents in a scrolling transcript, and — more decisive — an iframe can do anything, which contradicts the same paragraph's own rule that a card is display-only. A fixed declarative shape makes that rule hold by construction. `content` remains the authoritative text: it is what the model reads and all any non-desktop surface shows.
- **Deep links** (`molibot://miniapp/<id>/<path>`). Parsed into an intent and routed in-process — never handed to the WebView to navigate, and the card's affordance is a `<button>`, not an `<a>`. The locator reaches the App as a `?path=` startup hint beside `locale`/`theme`; its meaning belongs entirely to the App. Parsing deliberately avoids `new URL()`: the URL parser normalizes `..` before anything can inspect it, so `molibot://miniapp/notes/../../etc/passwd` would arrive already rewritten to app `etc` — a link claiming one App silently opening another. OS-level scheme registration is **not** included; every consumer today is in-app, and adding it later only needs the same parser wired to a system entry point.
- **Sidebar badges** (`ctx.badge`). A count (capped at 99) or an unlabelled dot on the App's sidebar row; `count <= 0` clears rather than rendering a "0" chip. Deliberately quiet — no system notification, no interrupting popup. In-memory only: after a restart no App can still be doing the work a badge described, so restoring one would be a claim nothing backs (pitfall #23a/#23d). The App's server code is the only writer — the desktop route can only *clear* — and opening the panel is what retires it, applying the server's returned catalog instead of guessing locally. Disabled and failed Apps stop advertising a badge.
- Creator template and `reference.md` updated with all four contracts, including the `ctx.badge?.` optional-call note for older hosts; template `engines.molibot` raised to `>=2.9.9`. The template was loaded through the real host to confirm the card sanitizes, the badge lands in the catalog, and the deep link stays scoped to the declaring App.
- Also fixed: `apps/desktop/src/lib/miniapps/messageActions.test.ts` was never listed in the desktop `test` script, so this slice's own desktop test had never run in the gate.
- Versions: server 2.9.9, Desktop 0.9.6. No tag, push, or GitHub Release.
- Verification: Mini App server + route suites 187/187 (including new deep-link 10, card 10, bridge v2 10, attach 7, badge 4), desktop unit 145/145 + structural 173/173 + Rust 52/52, `svelte-check` 0 errors / 0 warnings, root and desktop `vite build` clean. Two real defects were caught by the new guards and fixed before delivery: the `..`-normalization cross-app routing bug above, and an undefined `--radius-medium` token (pitfall #5) flagged by the existing CSS variable guard.

---
## 2026-08-06

### Added: Mini Apps can exchange messages, drafts, attachments and host AI capabilities

- Mini Apps can contribute deterministic message/selection/attachment actions, fill (but never send) the active Desktop composer through a strict versioned bridge, and call host-routed text generation/transcription without receiving Provider credentials.
- Added controlled per-route binary uploads, App-scoped limits/rate limiting, stable sanitized AI errors, fine-grained model settings and 30-day App usage summaries. Third-party AI Apps install disabled until explicitly enabled.
- Todo now ships a “Save as Todo” message action. A new opt-in Meeting Notes built-in retains minute-long audio segments, survives failures/restarts, and can regenerate or permanently delete a meeting.
- Updated the Mini App creator contract and templates to 1.3.0. Synchronized server 2.9.8 and Desktop 0.9.5 only; no tag or GitHub Release was created.
- Automated contract/runtime/build checks passed. This slice originally lacked live microphone evidence; the product owner later confirmed the microphone works in the real app on 2026-08-09, so denial/device-loss automation is test hardening rather than a release gate.

### Added: built-in Mini Apps are now an offer with their own tab — install, update, uninstall

Built-ins were invisible as a *class*: the manager only ever listed what was installed, so an app the owner uninstalled disappeared from the product with no way back (the removal tombstone kept the next start from restoring it, correctly), and an app this build shipped but had never installed could not be discovered at all. Only the reference Todo app existed, and it arrived unasked.

- **A Built-in tab in Manage Mini Apps** (`小程序 › 安装小应用 › 内置应用`), first of the four install sources. Each row answers the two questions the owner actually has — *do I have it?* and *is there a newer one?* — with the bundled name, description, icon, version and tool list read from the copy in the build, so a row exists whether or not anything is on disk. States: `Not installed` / `Uninstalled` (removed by the owner) / `Up to date` / `v1.2.0 available`.
- **Install, update, uninstall from that row.** Install and update are one host operation (`installBuiltin`) — they differ only in whether something was there before — with the same suspend / drain / dispose / replace ordering as uninstall, because an installed app may hold an open SQLite handle inside the directory being replaced. Code only: the app's data directory is never touched, and enablement is preserved (an app switched off gets the new code, still switched off). Installing clears the removal tombstone, or the next start would delete what the owner just asked for.
- **`Note` ships as a built-in**, and new built-ins are opt-in: `autoInstall` is per app, `todo` keeps it (an empty workspace still starts with the reference app, unchanged), everything else is listed as an offer. An upgrade never plants a new app in someone's workspace.
- The built-in id list is derived from the bundle (`builtinMiniAppIds()`) instead of a second hand-written array in `registry.ts` — pitfall #22's shape: a shipped-but-unlabelled app would get no update, no bundled reinstall, and a `directory` provenance it never had.
- Every Mini App route now answers with **both** catalogs (`{ items, builtin }`) through one shared `buildDesktopMiniAppsPayload()`, and the store assigns them together: an install, update or uninstall changes both lists, so a route returning one would leave the other showing the state before the click. A desktop build talking to an older service degrades to "no built-ins on offer" rather than throwing.
- New route `GET/POST /api/desktop/miniapps/builtin`. It is not `/install`: there is no owner-supplied source to trust, so the third-party trust warning is not repeated on that tab (repeating it on a build's own apps only teaches people to click past it).
- Guards: built-in catalog / opt-in bootstrap / tombstone round-trip / stale-copy update / id-derivation cases in `src/lib/server/miniapps/bootstrap.test.ts`, the both-catalogs projection in `src/lib/server/app/desktopMiniApps.test.ts`, and the tab + `applyCatalogs` structural assertions in `apps/desktop/src/chat-ui.test.mjs`. A generic case installs and smoke-tests **every** built-in the bundle ships, so adding one cannot ship a catalog row that fails to load.
- Also: the Todo app icon was redrawn to match Note's style (24×24, no background plate, one hue in three flat tones).
- Verification: Mini App bootstrap 17/17, Mini App host/install/manifest 48/48, Mini App projection 5/5, desktop UI 168/168 + unit 143/143 + Rust 52/52, `svelte-check` 0 errors / 0 warnings, `vite build` + desktop `vite build` clean. Walked the real HTTP surface against a service on a throwaway data dir: offer → install (`note` appears, loads) → uninstall (tombstone written) → reinstall (tombstone cleared) → restart with a downgraded installed copy (`updateAvailable: true`) → update (back to the shipped version).

### Release: v2.9.7 / Desktop v0.9.4
- Synchronized the root and Desktop package versions for the new release.

### Fixed: opening a Mini App and then switching conversations lost the app, and the panel's Files side was empty in a chat

Reported together, and they turned out to be one seam plus its consequence.

- **A Mini App did not survive a session switch.** `ArtifactTabsStore.connect()` cleared *every* tab whenever the panel's context changed (endpoint / project / profile / session), so selecting another conversation destroyed the running app's iframe and dropped the panel back to the file surface. A Mini App is a workspace of its own, not an artifact of the conversation it happened to be opened beside: its tabs, the active one, and the mode showing them are now carried across `connect()`, while file/diff tabs (which do belong to the old context) are still cleared. The `{#each}` keys are unchanged, so the surviving tab keeps its DOM and the iframe's document stays alive.
- **Switching the panel back to Files inside a chat showed nothing.** In Session scope the panel only ever rendered open file tabs, with an "no artifacts yet" empty state behind them - the session's artifact list lived in a *separate* right-hand aside in `ChatView`, which the host rendered only when no Mini App was open. So the moment an app was open, the list was unreachable, and the Files side was blank by construction. The list now lives inside the panel (media filter, count/size footer, click-to-open into the viewer, download), the legacy aside is gone, and Chat mounts exactly one inspector in every scope.
- Two things the fold uncovered: the panel read its attachments with a hard-coded `"personal"` profile, which returns an empty list with no error for a conversation owned by another bot - it now takes the host's `profileId`, resolved the same way the transcript's own preview/download actions resolve it. And `.project-panel-body.browser-collapsed > .project-browser` had stopped matching when the `.artifact-file-surface` wrapper was introduced, so the collapse button silently did nothing; the rules are now written against the wrapper.
- Panel visibility is derived from the live pane (`projectPaneActive`) instead of the open-time `inspector.scope`, so the visibility test can no longer disagree with the props the panel is actually given.
- Guards: `connect()` keeps-Mini-Apps / mode-preservation, the Session artifact-list surface, no-`artifactEmpty`, close-last-tab-does-not-close-the-panel, one-inspector (`inspectorVisible = artifactPanelVisible`, no `sessionFilesAsideVisible`, no `file-list`) and the collapse-selector assertions in `apps/desktop/src/chat-ui.test.mjs`.
- Verification: desktop UI tests 167/167 + unit 143/143 + Rust 52/52, `svelte-check` 0 errors / 0 warnings, `vite build` clean. Walked the real UI against a running service: open Mini App → switch session (app stays) → switch to Files (session artifacts listed) → open a file (viewer splits below the list) → close the tab (list remains) → switch to a Project session (tree, Changes, Attachments intact, Mini App tab still there) → collapse/expand the browser.

### Fixed: Artifact Panel could not preview CSV or images, .gitignore opened as a system card, and Markdown source had no line numbers (issue #31)

Four right-hand panel bugs that shipped with the unified Artifact Panel, each a different root cause. Reported against the project file panel: CSV and images showed blank / loading-forever, `.gitignore` showed a system-open card instead of its contents, and the Markdown source view had no line numbers.

- **CSV blanked on any repeated value.** `CsvTable` keyed its `{#each}` blocks by cell/row/header *value* (`row.join("\0")`, `cell`, `header`). Svelte 5 throws `each_key_duplicate` in **production**, not only dev, so a row like `yes,yes,yes,yes`, two identical rows, or a repeated column name threw during render and left the tab blank - a very common shape in data CSVs. Keys are now row/column indexes, which are safe for a static list (appending rows only adds new indices; a reload updates each index in place). The `row.join` also embedded a raw NUL byte that made git treat `CsvTable.svelte` as binary; both are gone.
- **Images were CSP-blocked.** `app.security.csp` allowed `http://127.0.0.1:*` in `media-src` (so `<video>`/`<audio>` streamed) but **not** in `img-src`, so `<img src={serviceUrl}>` was blocked while video and audio worked - which is exactly why only images were reported broken. `img-src` now matches `media-src`. The same fix unblocks streamed SVG rendering and session-scope attachment images.
- **`.gitignore` opened as a system card.** `classifyFilePreview` returned `"binary"` for dotfiles (`extensionOf` treats `.gitignore` as the extension), so `matchViewer` routed to `"system"` and the panel showed reveal / open-externally / download instead of the file. A `TEXT_DOTFILES` set now classifies common config dotfiles (`.gitignore`, `.gitattributes`, `.gitmodules`, `.dockerignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `.prettierrc`, `.eslintrc`, `.babelrc`, ...) as `"text"`; the server already read them as text via `detectTextEncoding`, so they open in CodeViewer. `.DS_Store` and other binary dotfiles stay on the system card.
- **Markdown / CSV / SVG source views had no line numbers.** Each rendered a bare `<pre>`; they now reuse the shared `CodeViewer`, so the source view carries line numbers, find and wrap like every other text file. `MarkdownPreview` and `CsvTable` gained a `name` prop for CodeViewer's path-based highlighter.
- Machine guards: CsvTable index-key / no-raw-NUL / source-view-uses-CodeViewer / `name`-prop / CSP `img-src` loopback assertions in `apps/desktop/src/chat-ui.test.mjs`; `.gitignore` -> `code` in `viewerRegistry.test.ts`; dotfile classification in the new `src/lib/shared/filePreview.test.ts` (wired into `test:projects`).
- Verification: desktop UI tests 166/166 + unit 143/143 + Rust 52/52, `test:projects` 68/68, `svelte-check` 0/0, `vite build` clean. The CSP change is baked into the Tauri build, so it needs a Rust rebuild (pitfall #18) - a WebView reload alone will not pick it up.

### Release: v2.9.6 / Desktop v0.9.3
- Synchronized the root and Desktop package versions for the new release.

### Fixed: one MCP tool result could blow the context window, and compaction could never recover from it

Reported as a provider 400: a request carrying ~2.88M tokens of text input against a 1M-token endpoint. That is not gradual growth — it is ~11 MB arriving in a single tool step — and it exposed two gaps that only look like one bug.

- **MCP results were inlined verbatim.** `read` and `bash` truncate their own output to `DEFAULT_MAX_BYTES`/`DEFAULT_MAX_LINES` and spill the rest to disk, but `normalizeToolContent` pushed `item.text`, `resource.text` and `structuredContent` (pretty-printed, so *larger* than the wire payload) straight into the context with no limit. An MCP server is third-party code; how big its answer is was never our decision to leave to it. Results now go through `capMcpToolContent`, which applies the same shared budget across *all* text parts of one result — a server that splits a payload into 50 parts is bounded exactly like one that returns a single blob — spills the full text next to bash's, and passes image parts through untouched.
- **Compaction could not repair the result.** `findFirstKeptIndex` seeds the kept slice with the newest message unconditionally (dropping the message the model just produced or consumed would corrupt the turn), so when *one* message is bigger than the whole window, every compaction returned `changed: false` or shrank to something still oversized, the post-overflow retry gave up, and the session was permanently unable to run — the offending message was inherited by every later turn. `capOversizedMessages` now rewrites any single message above the keep-recent budget, and because the compacted list is what `appendCompaction` persists, the blob leaves the live context for good instead of being re-truncated forever.
- Two details that would each have made the fix look like it worked while doing nothing: `truncateHead` never splits a line, so a minified-JSON payload (one enormous line) came back **empty** — both paths fall back to a byte-safe `sliceToBytes` that steps over UTF-8 continuation bytes rather than cutting a character in half. And the compaction byte budget is 2 bytes per token, which stays under the estimator's real cost for CJK (1 token per 3-byte character) as well as ASCII (pitfall 8).
- The spill path was already written out four times across `bash.ts` and `hostToolExec.ts`; rather than adding a fifth, both now delegate to `outputSpill.ts`, whose write never throws — a read-only scratch directory must degrade to "truncated, no pointer", not fail the tool call (pitfall 7).
- Guards: oversized-single-message, no-history-to-summarize, tool-call-block-untouched and CJK-budget cases in `src/lib/server/agent/session/compaction.test.ts`; pass-through, shared-budget, single-line-payload, image-survival and spill round-trip cases in `src/lib/server/agent/tools/mcp.test.ts`.
- Verification: `compaction.test.ts` + `compactionFileOps.test.ts` + `bash-output.test.ts` + `read.test.ts` + `runnerHelpers.test.ts` 64/64, `mcp.test.ts` 9/9, `tools/index|path|sandbox` + `hostBashExecContext` + `hostBash/approval` 31/31, `tsc --noEmit` clean on every touched file.
- **Resolved later on 2026-08-09**: the pre-flight size gate now budgets the assembled system prompt, tools, history, and current message, compacts/caps before dispatch, and performs a final fail-closed check at the Provider boundary.

### Changed: files and Mini Apps are two surfaces in the Artifact Panel, not one mixed tab strip

Reported after using the shipped build: "点击文件后会回到文件窗口，小程序就丢失了". Two problems behind it, and only one was the tab strip.

- **The mixed strip was the wrong model.** Slice 0 made "a Mini App is just another tab kind" a headline decision. In use, one strip listing `AGENTS.md` next to a running expense tracker made "go read a file" and "leave my app" read as the same gesture. The panel head now carries a Files / Mini Apps segmented control, each side owns its tab strip, and each keeps its own selection so switching returns you to where you were. Multiple Mini Apps still coexist as tabs among themselves.
- **The switch is a quiet menu in the head, not a control of its own.** The panel is ~380px wide, so space is the scarce resource in both axes: a row of its own pushed the content down while repeating the app name the tab strip already showed, and a two-button segmented pill then spent the head's width restating the choice on every frame. Switching surfaces is rare next to the reading you do inside one, so the affordance now names the current surface and adds a caret — click it for a two-item menu. The two heads collapsed into one: the trigger takes the flexible slack where the title used to be (shrinking label-first so the action buttons keep their natural width, pitfall 16a), file actions appear only in Files mode, and with no Mini App open the head keeps its plain title.
- It reuses `OverflowMenu` — extended with an optional `trigger` slot and an `inline` variant — rather than growing a bespoke popover, because dismiss, Escape and arrow-key handling would otherwise be forked (pitfall 7). The popover opens left-aligned under the trigger; no ancestor clips it, and the head's existing `z-index: 31` keeps both above the window-drag mask.
- Two things the head swap broke and this fixes: the action buttons had been pushed right by the title's `flex: 1`, and a content-sized trigger left nothing to absorb the slack, so they bunched against it on the left — the trigger now carries `margin-right: auto`, keeping it label-sized (a quiet control should not own a header-wide hover target) while the actions stay pinned right. And `.file-panel-head strong` was a *descendant* selector, so it also captured the menu's own `<strong>` label, overriding its type rank with a raw 13px and making it grow inside its trigger; it is now a direct-child selector, which is what it always meant.
- Removed `.miniapp-panel-head` / `-title` / `-close` and `.miniapp-icon-panel` as dead CSS. The drag-mask guard that had been asserting `.miniapp-panel-head`'s `z-index: 31` now asserts it on `.file-panel-head` — the head that actually exists. A guard pointed at a dead rule protects nothing, and this one covers pitfall 18, whose failure mode is buttons that go dead with nothing in the console.
- **The real data loss was a lifecycle bug.** `{#if miniAppActive}` and the file branch were siblings, so activating a file tab destroyed every `MiniAppPanel` and its iframe: the app reloaded to its start screen and anything half-typed was gone. Every open Mini App is now mounted at all times and hidden with `display: none`, which keeps an iframe's document alive; the file surface is hidden the same way so its scroll position survives a round trip. Separating the strips alone would **not** have fixed this — the app would still have been torn down on every switch.
- Consequences handled: the `MAX_OPEN_TABS` cap now applies per kind, so browsing a dozen files cannot silently evict a Mini App the user has open in the other mode; `closeTab` falls back within the closed tab's own kind rather than jumping across; `closeAllTabs` closes only the mode on screen and revokes just that subset.
- What survives from Slice 0 is the part that was right: one panel, one inspector column, one resizer, one width budget, one viewer registry. The mount seam is still single — only the tab model split.
- Guards: the old "co-hosts files and Mini Apps" assertion is replaced by a separation guard (two tab lists, two selections, no strip iterating the merged `store.tabs`, per-kind cap and per-kind close fallback) and a persistence guard (`class:is-hidden` on all three slots, exactly one `MiniAppPanel` mount, the `display: none` rule present). Confirmed the persistence guard fails when the hide is removed.
- Verification: desktop UI tests 163/163 + unit 142/142 + Rust 52/52, `test:projects` 62/62, `svelte-check` 0/0, both builds clean.

### Fixed: the artifact tab cap evicted tabs without releasing their blob URLs

Writing PRD §3.38's test seam #5 — "closing a tab revokes its blob URL" — found the one removal path that did not. `closeTab`, `closeAllTabs`, `connect` and `dispose` all revoked correctly, but the `MAX_OPEN_TABS` cap was applied inline as `next.slice(next.length - MAX_OPEN_TABS)` in three separate open paths, and each silently dropped the oldest tab without releasing it. Opening a 13th session attachment leaked the first one's bytes for the life of the WebView, with nothing in any console.

- Eviction is a close, so all three open paths now commit through one `#commitTabs` helper that revokes whatever falls off the front. `MAX_OPEN_TABS` is referenced only by its declaration and that helper.
- Guarded in `apps/desktop/src/chat-ui.test.mjs`: exactly one `createObjectURL`, a revoke on each of the five removal paths, no inline capping, and the cap referenced nowhere outside the helper. Confirmed the guard fails against the pre-fix code and passes after.

### Fixed: a Session HTML preview rendered as a bare skeleton, and its tab had one action

Two gaps found by auditing PRD §3.38 against the code after Slices 2/3 landed.

- **Relative assets did not resolve in Session scope.** The artifact route accepted only `scope === "project"`, so a chat-attachment HTML preview fell back to `URL.createObjectURL(blob)`. A blob URL has no path: every relative `css/`, `img/` and `../assets/` reference in the page resolved to nothing, and a multi-file page rendered as a skeleton with no error anywhere. Session previews now go through the same root-scoped transport as Project previews, rooted at the Session workspace, with the identical `..`/symlink fail-closed check. The blob remains only where the route declines to serve — an external-channel transcript, whose workspace holds files sent by other people; rendering those is a stronger capability than streaming their bytes, so it stays out.
- **The Session token is one shared codec.** A Session has no single id (profile + session + optional project), so the three pack into one opaque base64url URL segment carrying ids only, never a host path. It lives in `src/lib/shared/artifactToken.ts` and is imported by both the WebView and the service — a client-side re-implementation is exactly how an encoder and its decoder drift into a silent 404 that reads as "relative assets are broken again".
- **The Session action bar had only Download.** It now carries copy-path, reveal-in-Finder and open-with-system alongside it, through a new `POST /api/web/files/reveal` that mirrors the Project inspection reveal — same shared spawn helper (`shell: false`, argument array), absolute path resolved service-side behind the root check and never returned. The same actions reached `SystemOpenCard`, so a `.docx` attachment can finally be opened rather than only downloaded.
- `resolveAuthorizedConversation` moved out of `/api/web/files/+server.ts` into `src/lib/server/web/sessionWorkspace.ts`; the byte route, the preview route and the reveal route now share one answer to "which workspace does this Session own, and may this caller reach it" (pitfall 7).
- A session tab's `path` is now the attachment's workspace-relative path instead of empty, so one path string means one thing in every action that reads it (pitfall 6 corollary).
- **Still open, deliberately**: insert-as-`@`-reference in Session scope. The composer bridge is Project-only, and more fundamentally the shared Runtime validates `@[name](path)` against a registered Project root (§3.35) — an ordinary Session has no equivalent, so the button would insert a reference the Runtime fails closed on. It needs a Session-attachment reference model in the Runtime first, not a UI wire-up.
- Guards: token round-trip / ids-only / malformed-refused and the Session workspace escape cases in `artifactRoute.test.ts`; client↔service token parity incl. CJK ids in `apps/desktop/src/lib/api.test.ts`; and in `chat-ui.test.mjs` — route-before-blob ordering, no client-side token re-implementation, session tab path, and the Session action set including the deliberate absence of `mentionInChat`.
- Verification: desktop UI tests 160/160 + unit tests 142/142 + Rust 52/52, `test:projects` 62/62, `svelte-check` 0/0, both builds clean. The cold-start smoke walk remains outstanding (see below).

### Added: the Artifact Panel renders Markdown, JSON, SVG and mermaid, and no file is a dead end

PRD §3.38 Slices 2 and 3, completing the unified right-hand panel. Slice 0 (one tab container + viewer registry, Mini Apps as a tab) and Slice 1 (sandboxed HTML preview, chat attachments routed into the panel, CSV tables) were already in the working tree; this finishes the viewer set.

- **Markdown** renders through the transcript's own `renderMarkdown` — the same marked + highlight.js + DOMPurify pipeline, not a second one — so an agent-written report reads in the panel exactly as it does in chat. The click behaviour that makes external links and code-block copy buttons work was duplicated-in-waiting, so it moved to one shared `lib/markdownInteractions.ts` that the transcript and the panel both use (pitfall 7); the panel mounts it as an action rather than a `<div onclick>`, so the wrapper needs no invented ARIA role.
- **Mermaid** diagrams render inside Markdown, loaded with a dynamic `import()` gated on the document actually containing a diagram — the library is ~590 kB and stays a separate chunk, out of the initial bundle. `securityLevel: "strict"`, because diagram text is agent-generated content. A render failure shows that diagram's source; it never blanks the tab. Re-renders on theme change, since mermaid bakes its palette into the SVG rather than reading CSS.
- **JSON** opens as a collapsible tree, containers deeper than two levels collapsed. Both failure modes are visible and fall back to source: invalid JSON reports the parser's message, and a document over the 1 MB ceiling says so. The ceiling counts UTF-8 bytes, not characters — a character count under-reports CJK by ~3x (pitfall 8).
- **SVG** gets its own viewer ahead of the media check, so the graphic renders with its source one toggle away in both scopes. It renders through `<img src=…>`, never inlined markup: an `<img>` document cannot run scripts or fetch external resources.
- **Audio** was already covered by `MediaViewer`; it now reaches the Session scope too, through the same registry dispatch.
- **Unsupported formats** (Office, unknown binaries, oversized text) get a real card — icon, name, size, reason, and Open-with-system / Reveal-in-Finder / Download. Office deliberately gets no embedded preview: the conversion chain is heavy and the payoff small, so the product answer is the system app. Reveal and open are omitted in Session scope, where an attachment has no host path; download always applies.
- The rendered/source toggle is now a registry fact (`hasSourceToggle`) read by both scope toolbars, and which viewers need decoded bytes is `needsTextContent`, read by the session loader instead of its own hand-maintained exclusion list. Adding a viewer is one branch in `viewerRegistry.ts`; nothing else has a list to forget to update.
- Removed the now-orphaned `isRenderableTextName` from `src/lib/shared/filePreview.ts` (the registry owns that decision).
- Guards: registry dispatch, `needsTextContent` / `hasSourceToggle`, and empty-MIME fallback in `viewerRegistry.test.ts`; flattening, collapse-by-prefix (a `/ab` sibling is not hidden by a collapsed `/a`), both failure modes and the UTF-8 ceiling in `jsonTree.test.ts`; fence handling incl. unterminated, longer-fence and tilde cases in `mermaidBlocks.test.ts`; and in `chat-ui.test.mjs` — every viewer reachable from **both** scopes (the assertion that catches a Project-only wiring), system-card actions with download non-optional, the single-source toggle, mermaid lazy + strict + generation-guarded, no second markdown pipeline, SVG never `{@html}`, and both-locale copy keys.
- Verification: desktop UI tests 157/157 + unit tests 142/142 + Rust 52/52, `test:projects` 58/58, `svelte-check` 0 errors / 0 warnings, service and desktop `vite build` both clean. **Not done: the cold-start smoke walk** (pitfall 10) — it needs the packaged Tauri window, which this environment cannot drive; the HTML preview and Mini App tabs in particular resolve through custom protocols that only exist there.

### Release: v2.9.5 / Desktop v0.9.2
- Synchronized the root and Desktop package versions for the new release.
