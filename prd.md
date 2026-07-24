# Molibot PRD (V1)

## Archive Index / 归档索引
- [2026 Q2 PRD Archive (Apr - Jun)](docs/archive/prd-archive-2026-Q2.md)
- [2026 Q1 PRD Archive (Feb - Mar)](docs/archive/prd-archive-2026-Q1.md)

---
## 3.03 Desktop Single-Window Settings and Per-Session Model Reliability (2026-07-24)

- **Priority / Status**: P0 / Delivered.
- **Scope**: Keep Settings in the live Chat window without nested-dialog Escape leakage; make text-model selection conversation-scoped and restart-persistent through a narrow Session API; keep draft first-send, multipart attachments, failed saves, and late Session switches consistent.
- **Acceptance**:
  - Escape closes only the topmost shared Dialog; it closes Settings only when no nested Dialog consumed/owns the event.
  - A missing multipart model selector falls through to the persisted conversation model, then Project/global defaults.
  - Existing and draft Session model caches become authoritative only after persistence succeeds; failures remain visible and preserve the composer for retry.
  - Late save/hydration responses cannot overwrite another currently viewed Session.
  - UI/API/persistence regressions, Svelte diagnostics, Root/Desktop builds, and Rust tests pass before release.

## 3.02 pi 0.81 Custom-Model Prompt Role Compatibility (2026-07-23)

- **Priority / Status**: P0 / Delivered.
- **Scope**: Keep system instructions at the pi `Context.systemPrompt` boundary for every custom model; unsupported `developer` messages may be normalized only into that top-level prompt and must never become `system` entries inside the Agent transcript. Project each custom model's declared `supportedRoles` into the pi request serializer rather than relying on URL-based role detection.
- **Acceptance**: OpenAI-compatible candidates reach request dispatch without synchronous token-estimation errors; transcript roles remain limited to the pi Agent message contract; the serialized top-level prompt uses `developer` only when the selected model explicitly declares it and otherwise uses `system`; focused tests cover both capability branches and actual unsupported developer content.

## 3.01 Desktop Light Sidebar Native-Composite Correction (2026-07-23)
- **Priority**: P0
- **Status**: Done; palette values superseded by the 2026-07-24 semantic-surface calibration recorded in 3.03/`DESIGN.md`.
- **Scope**: Correct the Light sidebar color in the real transparent WKWebView/native-material composition without changing the edge-to-edge geometry or the accepted Dark material.
- **Acceptance**:
  - The Light material predicts within four channel levels of the supplied Finder `#ECEDEE` reference under the captured native compositor; low-alpha fills that premultiply into dark gray are rejected by regression.
  - Dark and System Dark keep the WebView sidebar plane transparent and continue using the native `sidebar` effect.
  - The correction remains on the existing sidebar plane and cannot add a nested panel, pseudo-element, blur, radius, shadow, inset, or second divider.

## 3.00 Desktop macOS Semantic Color System (2026-07-22)
- **Priority**: P1
- **Status**: Done
- **Scope**: Replace pure-black and mixed Geist Desktop colors with one AppKit-derived semantic palette across Light, Dark, and System appearances.
- **Acceptance**:
  - Dark window/workspace, grouped, elevated, and nested surfaces use distinct semantic roles and never use `#000000` or `#0A0A0A` for structural UI.
  - Primary/secondary/tertiary labels, separators, inactive selection, controls, accent/status colors, and charts map consistently in Light, explicit Dark, and System Dark.
  - Native sidebar material remains system-rendered and shares the selected window appearance.
  - `DESIGN.md` is authoritative; the dark-theme companion and structural regression prevent the superseded Geist/pure-black palette from returning.

## 2.99 Desktop Edge-to-Edge Liquid-Glass Sidebars (2026-07-22)
- **Priority**: P1
- **Status**: Done
- **Scope**: Supersede the inset/floating visual treatment from 2.88 with one edge-to-edge macOS liquid-glass material for the shared Chat and Settings navigation sidebar.
- **Acceptance**:
  - Shared sidebars have no outer inset, panel radius, elevation shadow, hover glow, perspective, or parallax; they sit flush with the window and use one workspace divider.
  - Normal mode uses the native macOS `sidebar` window effect. The Tauri window and WebView root/layout are transparent, while the right content pane is opaque, so there is no second app canvas behind the sidebar.
  - Light appearance applies one uniform thick white material veil directly to the edge-to-edge sidebar plane so WKWebView's transparent backing composes near Finder's `#ECEDEE` reference instead of premultiplying a low-alpha tint into dark gray; Dark and System Dark keep the tint transparent. The veil must not be implemented as a nested panel, pseudo-element, extra blur layer, or card.
  - Explicit Light/Dark appearance synchronizes the native window theme with WebView tokens; System clears that override and follows macOS.
  - Reduced transparency and low-performance mode use an opaque no-blur fallback; increased contrast uses a near-opaque tint and stronger divider.
  - Chat resize affordance and both native macOS traffic-light groups align with the true edge-to-edge geometry.
  - `DESIGN.md` and Desktop structural tests prevent the superseded floating material from returning.
  - The macOS private API requirement is accepted for direct DMG distribution; Mac App Store submission is out of scope for this material path.

## 2.98 pi-mono 0.81 Shared Runtime Upgrade (2026-07-21)
- **Priority**: P1
- **Status**: Done
- **Scope**: Return Molibot to pi-mono's maintained package scope and converge model lookup, authentication, request dispatch, compaction, and subagent sessions behind one shared server runtime without changing Channel responsibilities or replacing Molibot's session storage.
- **Acceptance**:
  - Active dependencies use `@earendil-works/pi-ai`, `pi-agent-core`, and `pi-coding-agent` 0.81 with Node >=22.19; deprecated scope packages and unused pi Web UI dependencies are absent.
  - Main Agent and AssistantService supply `streamFunction`; compaction uses the same auth-aware dispatcher; custom endpoints retain protocol/base URL/thinking mappings and existing timeout/fallback/context repair behavior.
  - API-key/OAuth persistence implements the async `CredentialStore` contract with atomic, serialized, cross-process-safe updates and temporary-data round-trip/concurrency/login/logout/failure tests.
  - Subagents receive one `ModelRuntime` across ordered fallback attempts, backed by the same credential file and catalog boundary as the parent runtime.
  - Deferred tool activation returns `addedToolNames`; Node 22.23.1 runtime tests, Desktop diagnostics, builds, and isolated cold-start/model-catalog smoke pass.
- **Deferred follow-ups**: Provider/model UI generated fully from the Models registry, reasoning/tool/compaction/subagent Usage dimensions, `xhigh`/`max` UI, dynamic Radius/extension catalogs, and SQLite session-backend evaluation remain separate P2/P3 slices.

## 2.97 Desktop Settings Standard Controls and Native Time Picker (2026-07-20)
- **Priority**: P1
- **Status**: Done
- **Scope**: Restore the DESIGN-defined default input size across Desktop Settings and make every time field invoke the host-native time picker without adding a third-party component.
- **Acceptance**:
  - Settings form text, number, time, and select controls share the default 40px input height and existing theme/focus tokens.
  - Memory Reflection does not mix field-grid and settings-row layout classes.
  - Memory Reflection, Daily Materials, and Automation schedules reuse one native `input[type=time]` component; pointer activation calls `showPicker()` when supported and manual/keyboard entry remains available.
  - Structural/style regressions lock the shared height, all call sites, and native picker wiring; light/dark and compact window layouts remain valid.

## 2.96 Desktop Usage and Trace Compact Filters (2026-07-20)
- **Priority**: P1
- **Status**: Done
- **Scope**: Reduce the default footprint of the Usage and Trace filter surfaces without removing any query dimension or changing their existing apply semantics.
- **Acceptance**:
  - Usage keeps range/model/Bot/channel visible in one compact toolbar, with the time presets rendered as a dropdown and selection continuing to refresh immediately.
  - Trace keeps range/fact type/Bot/channel visible; Chat/Session/Run IDs and source limit remain available inside an accessible native disclosure, with an active advanced-filter count.
  - The four primary controls own a dedicated row in the 720px data column. Clear is tertiary, refresh is an icon utility, only Trace Apply is primary, and the disclosure is transparent at rest.
  - Effective date window, timezone, generated time, reset, refresh, and Trace apply actions remain reachable while the filter-to-KPI separation is 24px.
  - Shared semantic CSS supports Chinese/English, light/dark themes, keyboard access, and 860×620 without page-level horizontal overflow.

## 2.95 Daily Materials Notification Target Access (2026-07-20)
- **Priority**: P1
- **Status**: Done
- **Scope**: Let users configure the existing shared memory-task notification destination directly from the expanded Daily Materials plugin card.
- **Acceptance**:
  - Memory Backend Settings and Daily Materials both expose the same authorized Telegram/Feishu target list and edit the same persisted structured setting.
  - Reflection and Daily Materials retain independent notification switches; the shared selector is disabled only when both switches are off.
  - Bilingual copy remains correct regardless of which accordion card is open, and the existing fixed save footer handles persistence.
  - A structural regression prevents either card from losing access to the shared selector.

## 2.94 Project Chat Single Live Reply Ownership (2026-07-19)
- **Priority**: P0
- **Status**: Done
- **Scope**: Prevent transcript hydration from exposing an in-flight thinking/tool projection beside the live assistant row in Project Chat.
- **Acceptance**:
  - A transcript request that begins during, commits during, or is overtaken by a newer turn cannot replace that runtime entry's cached messages.
  - The active controller remains the sole owner of live thinking, activity, approvals, and streaming text; its final/stop/approval reload may commit while `sending` is still true.
  - The rule lives in the shared per-session runtime and applies consistently to Main Chat and Project Chat without Channel-layer or per-panel gating.
  - Regression tests reproduce the exact temporary two-row symptom, cover late stale responses, and prove the final owner reload remains intact.

## 2.93 Workplace English Coach, Momo Default, and Project Prompt Observability (2026-07-19)
- **Priority**: P0
- **Status**: Done
- **Scope**: Add a built-in workplace-English coaching Agent; make Momo the true first-use default without breaking saved Agent references; give every Project an inspectable final system-prompt preview generated by the runtime renderer.
- **Acceptance**:
  - The coach template uses the standard `AGENTS.md` / `SOUL.md` / `IDENTITY.md` contract and covers natural-language routing, optional commands, meeting preparation/review, active recall, assessment, progress, and privacy boundaries.
  - New and legacy-placeholder settings resolve to Momo under the stable `default` id; explicitly customized Agent names remain unchanged.
  - A Project prompt refresh writes `SYSTEM_PROMPT.preview.md` at that Project's Molibot workspace root after prompt hooks, with the exact final prompt and only its effective source paths; Project mode retains `USER.md` while excluding Bot/Agent identity and persona profiles.
  - Project `AGENTS.md`, `AGENT.md`, and `CLAUDE.md` follow one documented priority order and their rendered contents invalidate the prompt cache when changed.
  - Preview observability remains best-effort and cannot fail an otherwise valid Agent run; settings/persistence tests use temporary stores only.

## 2.92 Dark Theme OKLCH Color Palette Update (2026-07-18)
- **Priority**: P1
- **Status**: Done
- **Scope**: Replace the high-contrast dark theme colors in the application with a new custom OKLCH color palette, while leaving the light theme colors unchanged. Also, document the new dark theme values in design.dark.md.
- **Acceptance**: The `.dark` block in `src/styles/theme.css` is updated with the new OKLCH colors and flat shadow variables; the design document `design.dark.md` is created/updated to define these tokens for future reference; light theme remains unmodified.

## 2.91 Desktop Compact Expanded Session Rows (2026-07-18)
- **Priority**: P1
- **Status**: Done
- **Scope**: Reduce the visual density of expanded Chat sidebar Session rows through the shared `ConversationRow`, using only the compact sizes already defined by `DESIGN.md`.
- **Acceptance**: Every channel and Project Session row uses the 32px compact-control height, 4px grid padding, and `label-12` 12px/16px typography; selection, timestamps, status, rename/delete, read-only behavior, themes, and narrow layouts remain intact; a structural test ties the values back to `DESIGN.md`.

## 2.90 Desktop Settings Reopen and Provider Configuration Parity (2026-07-18)
- **Priority**: P0
- **Status**: Done
- **Scope**: Keep the native Settings window reusable after close; give built-in providers a compact API-key/enablement/default-model/model-ID editor backed by the same persisted structure as Web while retaining the full separate self-hosted editor; show saved enablement instead of catalog membership as provider availability; pin save bars to the content-pane bottom; remove the retired `/login` and `/logout` command paths.
- **Acceptance**: Settings opens after repeated close/reopen cycles; a many-model built-in editor scrolls only its body and keeps actions visible; built-in list badges match saved enabled/disabled state and expose credential presence in details; built-in saves do not require a custom Base URL or switch provider mode; page save actions remain at the bottom edge without covering scroll content; custom providers still validate endpoint credentials; removed commands are absent from suggestions, documentation, Telegram registration, and shared handlers.

## 2.89 Desktop Shared Transcript Header Search (2026-07-18)
- [Done, P0] 普通 Chat 与 Project Chat 必须复用同一个 Header 搜索组件；展开态留在 Header action row 的正常 flex 流内，不得以 absolute/transform 覆盖标题或相邻操作。
- [Done, P0] 搜索结果必须以消息实际渲染文本为准，包含本地化 Assistant 错误回退并排除不可导航的无 ID 消息；Session、消息或查询变化后当前结果索引必须始终有效。
- [Done, P1] 组件提供实时结果计数、上一条/下一条、Enter/Shift+Enter、关闭焦点恢复，并让普通 Chat 与 Project Chat 都能高亮、滚动到匹配消息。
- [Done] 保持中英、明暗主题、860×620 最低窗口和键盘可访问性；结构与纯函数回归进入 Desktop 默认测试链路。

## 2.88 Desktop Inset Floating Sidebars (2026-07-18, superseded by 2.99)
- [Done, P1] Desktop Settings 与 Chat 左侧导航必须共用同一 inset sidebar surface：10px 外部留白、12px panel 圆角与低对比细边/高光；elevation 按各自底层 canvas 选择，不得维护两套材质样式。
- [Done, P1] Chat 与 Settings 的 macOS 原生交通灯必须使用同一窗口级安全偏移，按钮不得与 inset sidebar 顶部圆角边框重叠，且不得通过页面私有 CSS 分别补偿。
- [Done, P1] Chat 侧栏外露画布必须与 Header/消息区使用同一主表面；Settings 单独保持次级画布。共享材质不等于强制两个应用模板使用同一底层 canvas。
- [Done, P1] Chat 与 Settings 悬浮侧栏使用紧贴面板的双层阴影表达深度；默认态持续使用完整强度，hover/键盘焦点不得改变整块面板 elevation，只可增加克制的边框微光和短扩散；亮色使用中性银灰、暗色使用强调蓝，不得位移、缩放或形成宽光晕。
- [Done, P1] Chat resize handle 保留可用热区但不得绘制独立竖线；宽度拖拽只通过光标表达，避免与悬浮卡片边框竞争。
- [Done, P1] 隐藏的项目组操作按钮不得继续占用标题宽度；标题平时使用完整可用行宽，hover/键盘焦点显示操作时再为按钮让位。
- [Done, P0] 本地 Chat 没有已选 Session 时必须自动成为默认 Bot 的新会话草稿，输入框保持可聚焦、可输入；首次发送再创建 Session，删除最后一个 Session 后也遵循同一规则。
- [Done, P1] Chat resize handle 必须与面板可见右边缘对齐，并从当前宽度开始追踪；键盘调整、220–420px 范围、窄窗口与文件面板开启时的既有行为保持不变。
- [Done, P0] 材质必须适配浅色、深色、窗口失焦、increased contrast、reduced transparency 与低性能模式；reduced transparency/低性能下不得继续使用 blur，低性能下同时关闭环境阴影。
- [Done] DESIGN 规范和 Desktop UI 机器守卫已落地；真实渲染覆盖 1200×800、860×620、浅色/深色、低性能降级、冷打开 Settings/Chat 与键盘 resize，无横向溢出。

## 2.87 Desktop Settings macOS Switch Consistency (2026-07-18)
- [Done, P0] Skills、搜索、图像、视频、语音、Host Bash、Web Profile、沙箱和插件页的布尔开关必须复用 General 页同一 `IosSwitch`，不得保留无样式的 `.switch` 按钮或新增页面私有开关。
- [Done, P0] 迁移不得改变原有状态更新、禁用态、dirty 标记、细粒度保存/API 与持久化行为；共享组件继续负责 checked/unchecked、键盘焦点、明暗主题、中英和紧凑窗口表现。
- [Done] 结构回归覆盖全部目标页面，并通过 Desktop UI、Svelte diagnostics、production build 与 860×620 冷启动/页面切换检查。

## 2.86 Fresh Automation Shared Archive Sessions (2026-07-18)
- [Done, P0] 带稳定 `taskId` 的 fresh 周期任务必须按“每个任务一个隐藏归档 Session”聚合历史结果，不得每次触发都创建新的 Session；缺少稳定任务 ID 的旧 Event 保持逐次 Session 兼容。
- [Done, P0] 共享归档只能作为 transcript persistence，模型每次执行必须从空消息上下文开始并在结束后清空；Memory profile、provider execution identity、通用工具审批和 Subagent 不得继承前次运行作用域。
- [Done, P0] 归档消息必须记录 `runId`，执行历史打开详情时只投影对应运行；旧执行记录没有消息 `runId` 时继续读取其原 Session。
- [Done, P1] 归档追加不得反复重建全历史模型快照；fresh 任务结束后恢复此前 Active Session，普通聊天不得长期停留在自动任务归档中。
- [Done, P1] 自动任务等待 Host Bash 审批时保留可发现的归档 Session；真正的新 fresh 运行忽略归档上残留的 Session 旁路模式，避免审批能力跨定时执行扩大。
- [Done, P0] Host Bash 审批续跑必须持久化原 `runId`、只改写/加载该 run 的归档消息，并恢复同一 Turn 状态；不得用聚合 Session 上下文续跑或覆盖兄弟运行。

## 2.85 Unified Context-Free Memory Task Notifications (2026-07-18)
- [Done, P0] 记忆反思与每日素材必须共用同一个已授权 Telegram/飞书 Bot + Chat 通知目标；两者分别保留自己的通知开关，但不得按素材源 Bot 各自选择首个聊天。
- [Done, P0] 内部完成通知必须走独立 Channel 投递接口，不得调用 Agent Runner、不得追加 Agent Context、不得创建/替换 active Session，也不得作为普通 assistant 消息回灌模型。
- [Done, P0] 每个 Owner 任务运行最多发送一条完成摘要；每日素材聚合所有目标结果并对相同输出路径去重，反思继续发送聚合扫描/候选结果。
- [Done, P0] 用户创建的一次性提醒继续返回其来源 Session；修复内部通知不得改变普通 reminder 的 execution-linked 持久化契约。
- [Done, P1] 设置页使用中英文说明共享目标，并在反思或每日素材任一通知开启时允许选择目标；已保存目标失效时只可安全回退到仍授权的 Telegram/飞书会话。

## 2.84 Desktop Clipboard Image Attachments and Live Recognition (2026-07-17)
- [Done, P0] Desktop 普通 Chat 与 Project Chat 的共享输入框必须接收剪贴板 `image/*` 文件；使用系统截图工具复制后直接粘贴，应自动加入待发送附件，同时普通文本粘贴行为保持不变。
- [Done, P0] 同一次剪贴板粘贴若为同一截图暴露 PNG/TIFF 等多个图片表示，只能选择第一个有效表示并生成一个附件，不得重复添加。
- [Done, P0] 图片附件发送必须按“上传中 → 图片识别中 → AI 流式响应”即时更新，不得因附件存在而退化到非流式 `/api/chat` 整轮等待。
- [Done, P0] `/api/stream` 必须同时兼容既有 JSON 文本请求和 multipart 附件请求，并把附件、图片内容与 Session 展示元数据交给同一共享 Web/Agent 运行链路。
- [Done] 回归测试锁定剪贴板过滤/命名、multipart SSE、上传完成阶段、Token 流更新和两种 Desktop Chat 表面接线；Svelte 检查保持 0 错误 0 警告。

## 2.83 Desktop Settings Canvas and Card Hierarchy (2026-07-17)
- [Done, P0] Desktop 设置左侧导航保持既有侧栏表面，右侧 Header 与主内容统一使用次级浅灰画布，白色设置卡片形成清晰层级。
- [Done, P0] 设置卡片外框与内部横向分隔线使用更低对比度的现有 DESIGN token，不新增硬编码颜色。
- [Done] 保持中英、显式/系统明暗主题、窄窗口与固定保存底栏兼容，并由 Desktop UI 回归、Svelte 检查和 production build 验证。

## 2.82 Desktop Chat Workspace Surface Hierarchy (2026-07-17)
- [Done, P0] Desktop Chat 左侧导航和右侧文件面板保持侧栏表面，中间 Header 与消息内容区统一为主工作区表面，并保留共享浅分隔线。
- [Done, P0] Chat 工作区使用 DESIGN 派生的语义 token，不复用设置页次级画布，也不新增硬编码色值。
- [Done] 明暗主题、窄窗口和设置页既有“次级画布 + 主卡片”层级保持兼容，并由 Desktop UI 回归、Svelte 检查和 production build 验证。

## 2.81 Web Chat / Settings Surface Hierarchy (2026-07-17)
- [Done, P1] Web Chat 保持左右侧栏现有表面，中间 Header 与消息区域统一为主表面，并以浅分隔线明确三栏边界。
- [Done, P1] Web 设置页主内容使用次级画布，设置卡片使用主卡片表面，卡片边框与内部横向分隔线降低对比度。
- [Done] 页面只消费 DESIGN/theme 语义 token，不新增硬编码色值，并保持中英、明暗主题与窄宽度布局兼容。

## 2.80 Desktop Native Experience Behavior Layer (2026-07-16)
- 状态：**实现、自动化、DMG 产物与隔离 packaged-host 运行验证完成；受当前 macOS 权限/硬件限制的最终交互矩阵待补。** 完整技术看板、依赖和验收见 [`docs/work/plans/2026-07-16-native-experience-developer-board.md`](docs/work/plans/2026-07-16-native-experience-developer-board.md)。
- [Implemented, P0] 深 Module 已提供 production/in-memory Adapter：`CommandSystem`、`StartupCoordinator`、`Dialog`/`AlertDialog`、`WindowState`、`DirectManipulation`、`FeedbackCoordinator`、`ActivityScheduler`；未创建万能 `NativeHost`，Channel 未承载平台编排。
- [Implemented, P0] App Menu、Tray 与 ⌘K 使用同一稳定命令 ID/标签/快捷键/可用状态；⌘K 空查询按本地成功历史、当前 workspace 和 catalog 推荐级别显示动作，检索保持文本相关性优先。版本化本地历史只保留命令 ID、成功次数和本地时间，最多 20 项、保留 90 天，不记录查询、用户内容、会话/Profile、参数、标签或错误；启动超过 8 秒进入可恢复状态；关闭 Chat 的菜单栏驻留/退出行为由用户偏好控制并走 orderly service shutdown。
- [Implemented, P0] Chat、Project、Settings modal 已迁移到 Desktop 本地 primitive，统一 focus trap、inert、Escape、焦点恢复和退出生命周期，并保留中英、明暗、860×620 与无障碍契约。
- [Implemented, P1] Tasks Inspector、Sidebar resize 与 Drawer 使用共享 Pointer/速度/中断语义；活动/非活动窗口和 reduced-transparency/increased-contrast 使用实时平台状态，克制材质只用于 chrome。
- [Implemented, P1] 前台使用应用内反馈，后台按权限发送去重的原生通知；Force Touch 触觉只响应用户主动的 snap/commit；数据轮询迁入窗口感知的 `ActivityScheduler`，隐藏窗口不保留高频 timer。
- [Verified] Desktop native/unit 45/45、UI/HTTP 74/74、Rust 19/19、`svelte-check` 0 errors/0 warnings、Vite build、`cargo check` 与 `git diff --check` 均通过。Apple Silicon DMG `Molibot_0.5.5_aarch64.dmg` 已生成，SHA-256 与 `hdiutil verify` 均通过且挂载内容正确；独立编译 identifier 的 QA `.app` 已以前台原生应用启动、解析 bundle resources、在隔离 `DATA_DIR` 启动 3001 managed sidecar，并验证二次启动保持单一 QA host，未影响原 debug host/3000 service。
- [Pending manual host verification] 本机 System Events 辅助功能自动化和显示捕获均被 macOS 拒绝，因而 menu/tray 点击、关闭/重开、通知点击、VoiceOver/焦点、显示缩放/主题/辅助功能视觉状态及 Force Touch 矩阵仍须在允许这些能力且具备支持硬件的 macOS 会话完成；通知权限未绕过产品约束，仅能由用户显式开启设置时请求。本机也没有 Developer ID 签名 identity。

## 2.79 Memory System Improvement Plan v3 — Loop Closure & Honest Profile (2026-07-16)
- 状态：**已完成（2026-07-17）**。v3.2 的 C0/C1 与 T10–T18 已交付；权威契约、边界和六组顶层验收保留在 [`docs/requirements/memory-improvement-plan-v3.md`](docs/requirements/memory-improvement-plan-v3.md)。
- [Done, P0] C0/C1：记忆拥有显式 active/disputed/dormant/archived 生命周期、真实注入计数、版本/utility/provenance、独立隐私 suppression 与服务端授权 scope；`MemoryProfileBuilder` 同时服务 UI 和 prompt，稳定偏好不再被 recency 截断。
- [Done, P0] T10/T11/T12：Desktop 消费真实画像及扫描/排除元数据；反馈改为 append-only、幂等、验证实际注入并可重放；反思只通过授权 R 引用建立 supersedes/disputes，拒绝伪造关系与重复值。
- [Done, P1] T13/T14：Session 持久化冻结约 500-token 的 profile base，治理 revocation 每轮覆盖且不补位；maintenance 由独立 watched event 与机会触发共用租约/计划/dry-run/幂等审计，不依赖反思成功。
- [Done, P1] T15/T16：候选按确定性 evidence key 跨 run 聚合并识别冲突；自动确认默认关闭且仅允许低敏感偏好/显式 project task，撤销检查后继版本。`conversation_search` 使用 Jieba search-mode + CJK bigram 预分词、增量 change sequence、可续跑回填、SQL allowlist、delete/truncate tombstone 与 reconciliation；FTS5 缺失的嵌入式 SQLite 自动使用等价 term index。
- [Done, P2] T17/T18：确定性纠正只对上一成功 trace 中实际注入且相关的记忆置 disputed，并可恢复；Skill 建议要求三次证据和至少两次成功执行 trace，确认只创建既有 review 流程中的 draft，未确认绝不创建可执行 Skill。
- [Done] 顶层验收覆盖画像隔离、隐私反馈、偏好演变、稳定快照撤销、独立维护与授权原文找回；临时 SQLite 测试、mory 全量、Desktop API/Svelte 与 production build 均已执行。

## 2.78 Desktop UI Geist Consistency Convergence (2026-07-16)
- [Done, P0] Desktop 静默坏样式必须被修复：CSS 变量与 keyframe 引用均可解析，会话浏览器在深色主题使用共享模态表面，会话状态与危险色不得回退到错误色值。
- [Done, P1] 现有页面只做 Geist 扁平风收敛，不重设计；焦点、圆角、阴影、scrim、弹层与抽屉动效、设置页滚动边缘和空状态使用共享语义规则，并尊重 reduced-motion/低性能模式。
- [Done, P1] 功能文本字号地板为 11px，字重限 400/500/600，等宽内容统一走 `--font-mono`；Agent City 画布内插画标签允许 9px，信息 tooltip 仍执行 11px 地板。
- [Done, P2] CSS 防回归测试必须递归扫描全局与 Svelte 私有样式，阻止未定义变量、未定义 keyframe 和字号地板违规重新进入。

## 2.77 Desktop Runtime Upgrade Safety and Profile-Selectable New Chat (2026-07-16)
- [Done, P0] Desktop 升级发布 bundled runtime 时，不得删除仍可能被已运行或已接管 sidecar 的旧 manifest 引用的哈希 chunk；不同版本必须使用彼此隔离的不可变运行时目录。
- [Done, P0] 新建 Desktop Chat 时必须先进入 Web Profile 可选择的草稿态，不得在用户选择前用 default/最近 Profile 创建空 Session。
- [Done, P0] 第一条消息发送时才创建 Session，并把草稿选择的 Profile 固定到该 Session Runtime；后续轮次不得因默认 Profile 变化而漂移。
- [Done, P0] 回归测试必须模拟旧运行时代际仍读取 chunk 时安装新版本，并锁定“点击新会话不提前请求创建 Session”的客户端契约。

## 2.76 Desktop Issue #16 Reliability and Information Architecture (2026-07-16)
- [Done, P0] AI 服务商页必须分别从 `builtinProviders` 与 `customProviders` 渲染对应 Tab；内置服务商不得因自定义列表过滤而消失，也不得暴露不适用的编辑/删除操作。
- [Done, P0] 自动化、一次性任务与系统任务必须以有边界的任务卡片呈现；一次性任务要明确关联最近 execution，并能打开该 execution 的消息详情。
- [Done, P0] 各 Channel 的 direct one-shot / immediate 文本投递必须通过共享 runtime 写入 execution 关联 Agent Context，不能只写渠道消息日志或 Desktop 展示记录。
- [Done, P1] 自动任务只保留 Chat 工作区入口，Settings 不再重复提供；诊断页必须显示 Desktop App 版本；Agent 页只保留一层工作区标题并减少顶部留白。
- [Done, P0] 显式 Skill 选择在持久化用户消息中只显示 `[$skill-name](.../SKILL.md)` 引用，不得内联 Skill 正文或持久化临时运行控制块。

## 2.75 Desktop Usage and Trace Observability Parity (2026-07-16)
- [Done, P0] Desktop Usage 必须支持 today / yesterday / 7 天 / 30 天范围与模型、Bot、渠道组合筛选，并提供筛选后的 KPI、趋势、模型/API/Bot/渠道排行和分页请求明细。
- [Done, P0] Desktop Trace 必须支持 fact 类型、Bot、渠道、Chat、Session、Run 与读取上限筛选，并提供工具/技能/模型/Bot/Chat/Session/Run 排行和分页 facts；active run 控制继续位于完整分析看板之后。
- [Done, P0] Usage/Trace 的筛选、聚合与分页必须位于 Desktop 专用服务边界；客户端必须拒绝提交过期请求响应。Trace 不得向 WebView 返回 payload、参数/结果/错误预览、blockedBy 或消息/命令内容。
- [Done, P1] 两页必须支持中英、明暗主题、860×620 最小窗口和窄宽度表格转记录卡片；不得引入页面级横向溢出。
- [Done, P0] 页面首次进入只能由跟踪 service readiness/endpoint 的单一 effect 发起数据加载；请求 generation、loading、query 等 store 状态不得成为该 effect 的依赖，Trace active-run 首开不得同时从 onMount 与 effect 重复请求。

## 2.74 Desktop Internal Session Isolation and Reminder Routing (2026-07-15)
- [Done, P0] Desktop Host Bash 审批必须调用专用结构化 API，不得把 `/hosttools...` 审批指令作为普通 Chat 消息持久化或创建新 Session。
- [Done, P0] one-shot / immediate Event 必须在 watched event JSON 中保留来源 Session，并在触发时优先投递回该 Session；`fresh` 周期任务与历史缺字段 Event 保持兼容。
- [Done, P0] 历史 `/hosttools...`、`[EVENT:...]` 内部 Web Session 只能做可逆分类回填和普通 Chat 隐藏，不得删除原始消息、Session 文件或索引。
- [Done, P1] 可调 Chat 侧栏变宽时，Session 标题可用宽度必须同步增长，时间与操作区不得挤压或覆盖标题。
- [Done, P0] 回归测试必须锁定专用审批 API、内部 Session 不进入普通 Chat、提醒返回来源 Session，以及标题不再受固定字符宽度限制。

## 2.73 System Task Execution Records (2026-07-15)
- [Done, P0] Molibot Owner 系统任务不得把内部关联 ID 当作普通聊天 Session 打开；执行详情必须展示独立、可读取的 execution record。
- [Done, P0] 新的记忆反思与每日素材执行要在共享 event lease 中保存结构化结果，包括处理目标、扫描会话/消息，以及新增候选或生成文件；Channel 层不得承担该逻辑。
- [Done, P1] 旧执行无法恢复已丢弃的业务结果时，仍需展示真实状态、起止时间与尝试次数，并明确说明历史版本未保存明细，不得误报“会话已清理”。
- [Done, P1] Desktop 中英文界面使用“查看执行记录 / Execution record”；普通用户自动化的真实会话详情行为保持不变。

## 2.72 Desktop One-Shot Reminder Inbox (2026-07-15)
- [Done, P0] Desktop“自动任务”增加“一次性任务”Tab；用户 one-shot watched events 与周期自动化、Molibot 系统任务分开，以 todo 列表展示提醒内容、触发时间和“提醒 / 已提醒”状态。
- [Done, P0] 只有一次性提醒成功触发才写入显式未读标志并增加 Chat 侧栏角标；进入“一次性任务”Tab 后持久化已读并即时清零。失败不得显示为已提醒。
- [Done, P0] 缺少未读字段的历史 one-shot 默认已读；周期任务和 immediate 诊断任务不参与未读机制。本条仅取代 2.23/2.29 对 one-shot 产品入口的排除约定，immediate 仍不进入产品列表。
- [Done, P1] 提醒状态与已读状态继续存放在 watched event JSON，经共享事件运行时和 one-shot 限定 Desktop API 读写；不得迁移到 memory、OS scheduler 或 Channel 专属实现。
- [Done, P1] 页面支持中英、明暗主题、键盘可读状态和窄窗口；角标使用低频轻量摘要轮询，打开页面后的变化即时回传，不为轮询加载执行历史。

## 2.71 Project Chat Transcript Hydration Reliability (2026-07-15)
- [Done, P0] Project Session 选择必须只有一个 transcript 加载权威；成功响应同时更新选择状态与固定 Session Runtime，不能因重复请求之一失败而把已有会话显示为空。
- [Done, P0] 修复不得改变 Feishu/Telegram 外部 transcript 的只读加载路径，也不得影响普通 Web Chat。

## 2.70 Memory Center and Per-Turn Memory Disclosure (2026-07-15)
- [Done, P0] Desktop「内存」已重组为面向用户的「记忆」中心，并提供三个独立 Tab：“概览”承载综合画像与待确认候选，“主题”承载主题导航、Agent 摘要、关键事实和相关实体，“全部记忆”承载底层记录搜索与管理；高级管理降为次级弹窗。画像与主题必须由真实记忆字段确定性投影，正式记忆可关闭自动注入。
- [Done, P0] 成功的 Assistant 消息按两条独立事实链展示「参考了 N 条记忆」和「保存了 N 条记忆」；完整详情懒加载，参考项与新增/更新项分别呈现。
- [Done, P0] `MemoryInjectionSnapshot` 在最终 Prompt 封装阶段同时生成精确文本与 items，回答参考数量不再使用可能被二次裁剪的 `MemoryPromptSnapshot.selected`。
- [Done, P0] 结构化 Memory 工具结果生成写入回执，Trace 通过 `runId + assistantSourceEntryId` 持久化不可变快照；Trace 异常不阻塞回答，反馈支持 helpful / irrelevant / incorrect / expired / too_private。
- [Done, P0] Trace、反馈、消息关联与 `allowInjection` 过滤均位于共享 Agent/app 层，Channel 未增加分支；列表只返回轻量计数，测试使用内存或临时 SQLite。
- [Planned, P1] 展示回答时版本与当前版本差异、来源对话跳转和 retrieved/selected/injected 漏斗。
- [Spec] 完整产品、数据、API、生命周期、测试和验收契约见 [`docs/requirements/memory-trace-and-memory-center-prd.md`](docs/requirements/memory-trace-and-memory-center-prd.md)。

## 2.69 Desktop Trace Action Feedback (2026-07-14)
- [Done, P0] Trace 页面首屏优先展示时间范围、KPI 和分析图表；当前运行及 orphan 操作记录必须位于完整看板之后。
- [Done, P0] Trace 的“删除记录/停止运行”必须使用应用内可见确认对话框，不得依赖桌面 WebView 的浏览器原生确认行为；取消、遮罩和 Escape 均不得提交请求。
- [Done, P0] 确认后只向细粒度 active-runs API 提交所选 `runId` 一次；orphan 记录标记为 `aborted` 后从当前运行列表移除，同时保留审计 facts。

## 2.68 Molibot macOS App Interface Redesign (2026-07-14)
- [Done, P0] GitHub Issue #13：Desktop 必须统一系统字体、52px 工具栏、6/8/12/full 圆角、语义状态、共享 PageHeader/SettingGroup/OverflowMenu，以及 576px 设置与 720px 数据/消息内容宽度。
- [Done, P0] Models、Providers、Trace 与 Automatic Tasks 必须优先显示用户语言，技术 ID/raw cron 只作次级信息；危险操作进入溢出菜单，开关不得用普通描边按钮伪装。
- [Done, P0] Tasks 在宽窗口使用 Global Sidebar + 320px List + flexible Detail，窄于 1100px 使用右侧 inspector overlay，并分别表达启用、调度、执行和最近结果。
- [Done, P1] Chat 使用 260px 默认可调侧栏、720px Message Unit/Composer、Assistant 身份行和单行起始的自动增长输入框；设置与数据页标题和内容起点保持一致。
- [Done, P1] 所有改造支持中英、明暗主题、860×620 最小窗口、reduced motion/transparency 与 increased contrast；不得改写业务 API、运行时或持久化合同。长期规范写入 `DESIGN.md`。
- [Done, P2] 全局交互补齐 Command+F / Command+, / Command+K / Command+Return、菜单上下键和 Escape；关闭的 Popover 卸载内容，危险弹层主动接收焦点。通用设置提供可持久化低性能模式，并在系统减少动态/透明度或低资源硬件上自动关闭阴影、模糊和非必要动效。

## 2.67 GitHub Issues #6 / #11 / #12 Runtime and Session Completion (2026-07-14)
- [Done, P0] UI Session 必须收敛为展示元数据；普通消息正文、模型与工具历史只由 Agent entries 持有，旧 transcript 仅在确认可无损投影后清理，命令类 display-only 消息不得丢失。
- [Done, P0] 附件、activity、reasoning、模型标识与消息顺序必须通过共享投影保留；编辑重发同时截断 UI metadata 与 Agent append-only entries/context snapshot。
- [Done, P0] Desktop Stop 必须在断开 SSE 前等待服务端完成 abort/finalization，并 reload 已持久化的部分输出。
- [Done, P0] Trace 活跃运行控制必须覆盖 Channel、普通 Web 与 Desktop Project RunnerPool；不得把真实 Web 运行误判为只能清理记录的 orphan。

## 2.66 AnySearch and Desktop Tool-Test Parity (2026-07-14)
- [Done, P0] GitHub Issue #9：Web 与 Desktop 搜索设置支持 AnySearch `/v1/search`，API key 可选，匿名模式不得被“缺少 key”逻辑跳过。
- [Done, P0] Desktop 搜索、图片、视频测试必须在不向 WebView 回传密钥的前提下复用已保存 key；空草稿不得覆盖服务端凭据。
- [Done, P1] Desktop 图片与视频测试提供与 Web 一致的独立引擎选择，并保持中英、明暗主题、窄屏和现有固定保存底栏。

## 2.65 Running-Session Workspace Navigation and Issue #8 Polish (2026-07-14)
- [Done, P0] Project Session 运行中打开 Skill、Agent 或任务时必须立即显示目标工作区；后台 turn 不得被取消、迁移或错误渲染到当前面板。
- [Done, P0] Assistant 消息需持久化并展示实际响应模型；代码块支持安全高亮与独立复制，长用户消息默认折叠且可恢复全文。
- [Done, P1] 启动页显示当前阶段，消息操作与时间同排，待发消息使用可扫描的纵向队列；Project Chat 统一为 `Shift+Enter` 发送、Enter 换行。
- [Done, P1] `@` 选择器面向用户展示 Agent 名称但继续使用 Profile ID 路由；Desktop Settings 提供只读、限量的本地服务日志页。全部 UI 支持中英、明暗主题和窄屏。

## 2.64 Selectable Owner Reflection Notification Target (2026-07-14)
- [Done, P0] 每日记忆反思允许从已启用飞书/Telegram Bot 的授权会话中选择一个统一通知目标；不得接受未授权或其它渠道的伪造目标。
- [Done, P0] Owner 任务无论扫描/产出是否为 0，成功结束后都必须发送且只发送一条汇总通知；终态失败发送一条失败摘要。
- [Done, P0] 多 Bot 扫描、逐 Session watermark 与失败隔离保持在共享 Agent 上层；Channel 只负责最终消息投递，通知不得进入模型上下文或普通 Session。
- [Done, P1] 设置必须支持中英、明暗主题、窄屏和固定保存底栏，并在目标授权失效时安全回退。

## 2.63 Plugin Memory Settings Restart Persistence (2026-07-14)
- [Done, P0] 记忆后端、每日回顾与每日素材的完整 `plugins.memory` 配置必须在保存和服务重启后保持不变，不得回退到默认关闭状态。
- [Done, P0] 回归测试必须使用临时设置文件和临时 SQLite，经过真实 `save → 新 SettingsStore → load` 验证，不得读写用户真实运行数据，也不能只测试内存序列化对象。

## 2.62 Project Session Selection Owns the Active Transcript (2026-07-14)
- [Done, P0] 点击项目下任意 Session 时，左侧选中态、标题、composer 上下文与 `projectChatStore` active runtime 必须指向同一个 Session；聊天正文不得继续显示前一个 Session。
- [Done, P0] Session 选择与 runtime 激活必须在共享选择动作中同步，不得依赖组件通过 legacy `$:` 观察导入 rune store 的属性变化。
- [Done, P0] 回归测试必须使用两个返回不同消息的 Session，验证 A → B 后 active runtime 和 transcript 同时切换，并保留各 Session 独立 controller 的后台运行语义。

## 2.61 Live-Safe Production Build Publishing (2026-07-13)
- [Done, P0] 生产构建不得在生成完整替代产物前删除运行中服务依赖的 `build/`；构建失败或中断时，当前服务必须继续可用。
- [Done, P0] 发布新 manifest 前必须先发布其引用的全部 server chunk，并保留仍在运行的旧 manifest 可能按需加载的哈希 chunk，避免设置页模型路由等未加载端点返回 `ERR_MODULE_NOT_FOUND`。
- [Done, P0] 回归验证必须覆盖运行中服务与生产构建重叠的真实窗口，并持续请求 `/api/desktop/model-routing` 断言无 500。

## 2.60 Three.js Pug Agent City (2026-07-13, released in v2.4.9)
- [Done, P1] 将 Desktop Agent Studio 从 CSS 拼装办公室升级为 Three.js 固定等距微缩城市；完整 PRD 与验收口径见 [GitHub Issue #10](https://github.com/gusibi/molibot/issues/10)。
- [Done, P1] 城市固定保留 10 个普通 Agent 地块、独立 Global 总部和中央主人调度中心；普通 Agent 从 1–10 栋一层工作室逐层增长到最多 10 栋 × 10 层，超过 100 个时只显示未展示数量。
- [Done, P1] 每层对应一个 Agent，并以玩偶屋剖面展示巴哥犬的真实 disabled/idle/working/completed/error 状态；任务路线抵达准确楼层，Sub-agent 在父 Agent 楼层的临时协作舱中展示。
- [Done, P1] Three.js 只负责场景、角色、灯光和动画，现有 Svelte/Agent Activity 继续负责数据、悬浮详情、国际化与无障碍；共享 Agent City 投影是唯一新业务 seam，Channel 无改动，也不根据任务文本伪造工具动作。
- [Done, P1] 第一阶段使用程序化城市与代理角色验证 0/1/10/11/40/41/100/101 Agent 布局、稳定槽位、明暗主题、低动效、完整/低画质 3D 和信息等价 2D 降级。
- [Done, P1] 三维城市不常驻渲染楼层圆点、文字或面板；鼠标命中 Global 总部或任意实际楼层时，只展示该楼层的一张 Agent/任务详情卡。`working` 状态完全绘制在对应楼层的墙体、屋顶和底座轮廓上；减少动态时保留静态亮边而不显示 DOM 跑马灯。
- [Planned, P2] 后续以 Blender GLB 整体替换代理模型、骨骼、动画与材质；不得把仅替换材质视为正式角色资产完成。

## 2.59 Owner-Level Memory Automations (2026-07-13)
- [Done, P0] “每日记忆反思”和“每日素材整理”分别只能存在一个 Molibot Owner 级系统任务；不得按渠道或 Bot 复制 watched event。
- [Done, P0] Owner 任务每次执行必须从最新设置动态发现启用的 Bot/授权会话，使新增 Bot 无需重建任务即可在下一轮被识别；各目标 watermark 和失败隔离保持不变。
- [Done, P0] 自动任务页必须以明确的 managed metadata 区分“用户任务 / 系统任务”，支持中英、明暗主题和移动宽度；系统任务只能查看和手动运行，配置变更回到对应插件设置。
- [Done, P0] 启动迁移只移除可确认的旧版 per-Bot managed memory 文件，禁止按标题或模糊文件名删除用户任务。
- [Done, P1] 托管事件的幂等比较必须忽略 JSON 对象 key 顺序和运行时 `status`，语义未变时不得重写 watched event 文件。

## 2.58 GitHub Bug Stabilization Pass (2026-07-13)
- [Done, P0] Project raw 文件预览必须返回真实媒体字节与正确 MIME；路由级测试必须拒绝 HTML 404 回退。
- [Done, P0] Web Profile 与 Project 范围内连续新建会话必须复用各自唯一空 Session。
- [Done, P0] Chat 与 Project Chat 的运行输出、队列、停止和审批必须由发起 Session 持有；切换 Session 不得串台。
- [Done, P0] Agents、Skills、Automations 必须等 Desktop bootstrap 完成后再加载；首次请求失败必须显示可操作错误并允许对同一 endpoint 重试，不能永久停在 Loading。
- [Done, P0] Skills 异步数据到达后，计数与卡片列表必须来自同一响应式状态；空搜索渲染全部卡片，输入搜索即时过滤。
- [Done, P0] 中断或缺失结束事件的工具活动必须在持久化边界收敛为终态，并保留已产生的部分输出。
- [Done, P0] Web 展示投影统一命名为 UI Session，并迁移到 `ui-sessions/<scope>`；旧 `users/<scope>/sessions` 必须幂等迁移且保留顺序，外部渠道不得创建该副本。
- [Done, P0] 删除 Web UI Session 必须由 Web/Desktop 共用上层生命周期同步删除 Agent context；运行中拒绝删除，最后一个 context 也必须允许清理。
- [Done, P1] UI Session 已收敛为纯展示元数据，Agent entries 成为普通消息正文、模型与工具历史的唯一权威；附件/activity/reasoning/模型投影与编辑重发的双存储截断已补齐（2026-07-14）。

## 2.57 Desktop Project File Panel Large Image Preview (2026-07-12)
- [Done, P0] 修复桌面端 Project 文件面板在预览大图时显示“超过预览上限”或“二进制文件不能预览”的问题。
- [Done, P0] 后端在 `/api/settings/projects/[id]/inspection/file` 接口上支持 `raw=true` 选项，绕过大文本 256KB 预览限制，直接返回原始二进制响应并附带 correct MIME type 与 Cache-Control。
- [Done, P0] 桌面端 `ProjectFilePanel.svelte` 新增对 `@molibot/shared/filePreview` 别名引用（同时配置 vite.config.ts 和 tsconfig.json），基于 `mediaTypeFromName` 判定文件是否是 image/audio/video，并使用 raw API 在前端直接预览大图和音视频。

## 2.56 Volcengine reference-image generation (2026-07-12)
- [Done, P0] `imageGenerate(images)` 使用 Volcengine 时必须把参考图 URL 按官方 API 的 `image` 数组发送，禁止工具 schema 接收后在 provider 层静默丢弃。
- [Done, P1] 请求体测试必须覆盖多张参考图、模型与尺寸，保证角色一致性工作流真实使用图生图而非退化为文生图。

## 2.55 Bot Project Mode (2026-07-12)
- [Done, P0] 飞书等 Bot 会话支持 `/project` 列出、选择和退出 Project 模式，移动端无需安装 Desktop App。
- [Done, P0] Project 选择按 channel + bot instance + conversation scope 持久化，切换只允许在当前 scope 空闲时执行。
- [Done, P0] 后续消息进入既有 `MomContext.project` 路径，继承 Project root、instructions、Skills、模型与思考默认值；禁止在 Channel 层复制 Project 逻辑。
- [Done, P1] Project 被删除时同步清理绑定；Telegram 提供原生命令菜单入口，飞书、QQ、微信共享相同命令。

## 2.54 Desktop Composer Suggestions and Project Defaults (2026-07-12)
- [Done, P0] Chat 与 Project Chat 输入 `/` 时从共享服务端目录提示命令和已启用 Skill，支持键盘、鼠标、IME 和窄窗口交互。
- [Done, P0] 命令元数据与 `/help` 共用注册表；前端不得维护独立命令清单，禁用 Skill 不得出现在可执行建议中。
- [Done, P1] 共享 transcript 区分已识别 Command、Skill 与未知斜杠文本，并同时使用标签、图标和颜色表达语义。
- [Done, P0] Project 设置支持名称、instructions、默认模型和默认思考等级；继承优先级为 Session → Project → Global，Project 操作不得修改全局模型路由。
- [Done, P1] Agent 选择不进入 Project 设置；项目行为继续由项目指令文件与现有 prompt 分层决定。
- [Done, P0] Project Chat 加载 `<projectRoot>/.agents/skills/`，Project Skill 同时进入斜杠提示、显式调用、system prompt、skillSearch 与 `/skills`，并在同名时优先于其它 scope。
- [Done, P0] Project A/B 的 Skill prompt 缓存必须按 rootPath 隔离；普通 Chat 不得看到 Project Skills。
- [Done, P0] Project 设置提供 Sandbox、Tool Progress、Reasoning 和 Runlog 通知继承覆盖；Sandbox 必须复用现有开关语义，不另造 Project 安全策略。

## 2.53 Web / Desktop Trace Active Run Controls (2026-07-12)
- [Done, P0] Trace 当前运行列表必须把持久化 started fact 与真实 RunnerPool 快照交叉验证，不得仅凭 Trace 推断进程仍存活。
- [Done, P0] 统一展示运行中、超过 10 分钟的疑似卡住 Runner 和无 Runner 的孤儿记录，并显示 Agent/Bot/渠道/任务/持续时间。
- [Done, P0] 停止操作按 channel/Bot/chat/session 精确 abort；孤儿清理更新为 aborted 且保留审计记录，禁止直接删除 Trace。
- [Done, P1] Web 与 Mac App Trace 页面同步交付，3 秒刷新、操作确认、中英/明暗/响应式一致。

## 2.52 Desktop Agent Studio (2026-07-12)
- [Superseded] 本节记录的单层 CSS 办公室与 4×2 工位密度已由 2.60 Three.js Agent City 取代；保留下列条目仅用于历史追溯。
- [Done, P1] Mac App 主导航在 Skills 下方新增 Agent/Agents 工作区，复用主窗口工作区切换，不增加独立 Tauri 窗口。
- [Done, P1] 工作室展示 Global/default 与用户创建的 Agent；当 API 没有 `settings.agents.default` 实体时仅在展示层合成并去重，不写回设置；未显式绑定的 Bot 运行归属该工位。
- [Done, P1] 以等距办公室工位和走动巴哥犬拟人化呈现 Agent，支持启停状态、描述、模型路由摘要、空状态与设置入口。
- [Done, P1] 保持中英双语、明暗主题、窄窗口和低动效偏好可用。
- [Done, P1] 标准窗口采用 4×2 首屏密度，最多同时看清 8 个 Agent；更窄窗口响应式降列，超过 8 个后向下滚动。
- [Done, P1] 从 Trace run fact 实时投影 Bot 绑定 Agent 的 working/completed/error 状态，2.5 秒轮询并在 terminal 状态展示 10 秒后恢复待命。
- [Done, P1] 工作室顶部增加“老板/发起人”，工作中的 Agent 与老板之间显示流动虚线和文件传输动画。
- [Done, P1] 老板使用窗下独立管理工位而非悬浮头像，场景道具与员工工位保持同一空间语言。
- [Done, P1] 待命与工作状态使用不同角色动画：趴卧刷手机 vs 站立双爪敲电脑。
- [Done, P1] 工作连线使用流动虚线和多个错峰文件包形成不间断传输，并兼容 reduced-motion。
- [Done, P1] Sub-agent 通过父 `runId` 关联派活的主 Agent，在其卡片底部以临时迷你工位展示；最多直接展示三个，更多任务折叠为 `+N`，完成/失败后自动淡出。
- [Done, P1] 活动工位常驻截断 Bot 徽标，hover/focus 展示完整 Bot、渠道、开始时间和最多 160 字任务摘要；详情同时满足鼠标与键盘访问。
- [Done, P0] 孤儿 started Trace 在 12 分钟无任何 Run fact 更新后失效，避免永久 busy；活动详情显式显示状态，并保证浮层 stacking 高于相邻工位。
- [Done, P0] Trace 活动投影保持凭据与内容安全，只返回身份、状态和时间字段，不回传 payload/preview。
- [Planned, P2] 后续按 `docs/requirements/agent-workbench-plan.md` 接入 Sub-agent 与更细粒度的任务派发事件动画；共享运行状态仍归 Agent/app 上层，不下沉 Channel。

## 2.51 Model routing and AI provider UI optimizations (2026-07-12)
- [Done, P0] 从全局模型路由选择中移除 "tts" (语音合成) 选项。
- [Done, P0] AI 服务商页面底部的模型注册表按 "内置模型" (Built-in Models) 与 "自建模型" (Custom Models) 进行 Tab 分组展示。
- [Done, P0] AI 服务商主页面底部的服务商列表按 "内置服务商" (Built-in Providers) 与 "自建服务商" (Custom Providers) 进行 Tab 分组展示，并提供搜索框与已启用优先排序切换。
- [Done, P0] 模型注册表中支持搜索框搜索模型 ID，并默认支持 "已启用优先" 排序和默认排序切换。
- [Done, P0] 修复：限制仅在提供商 ID 变化时才执行模型 Tab 与搜索词重置，避免编辑模型选项或改变任何输入导致状态被自动恢复。
- [Done, P0] 修复：将 Web App 的新按钮 `onclick` 事件改为 `on:click`，确保在 Svelte 5 的 legacy 模式中能正确触发状态变化和重绘。

## 2.50 Desktop Chat reasoning, tool activity disclosure, and approval fixes (2026-07-12)
- [Done, P0] 思考过程在流式与历史消息中默认展开，并保留手动收起能力。
- [Done, P0] 工具调用进度默认收起，仅由用户手动展开。
- [Done, P0] `runner_event` 仅进入结构化工具进度，不再污染正文状态或重复显示原始 diagnostic。
- [Done, P0] 修复权限审批卡片按钮在流式响应仍在进行时因 `sending` 状态被禁用且控制器决议被拦截的冲突问题。
- [Done, P0] 在控制器中分离流式/离线审批路径，并去掉模板对按钮 disabled 的误杀。

## 2.49 macOS Compliant Desktop Icon and Avatar Processing (2026-07-11)
- [Done, P0] 处理原始方形头像 `momo-happy-icon.png` 满足 macOS app icon 视觉规范（824x824 圆角主体居中于 1024x1024 透明画布，225px corner radius），配合双层阴影和 1px 描边。
- [Done, P0] 覆盖替换 public 下的 `molibot-icon.png` 并重新生成全套 Tauri 桌面应用编译所依赖的 PNG、ICNS、ICO 格式图标。

## 2.48 Daily materials internal task (2026-07-11)
- [Done, P0] internal watched event 从授权会话只读投影生成 Project 内每日素材文件，与 memory reflection watermark 隔离且不进入普通 Runner。
- [Done, P0] 注册 Project、相对路径/软链接、凭据模式和 abort 使用 fail-closed 语义；失败不推进 watermark、不写 scratch。
- [Done, P1] Desktop 完整配置与 Automation 手动触发接通，momo-agent 模板和运营契约同步交付。

## 2.47 Desktop project directory confirmation (2026-07-11)
- [Done, P0] 选择已有目录后显示路径与明确的创建按钮，提交失败时保留选择以便重试。
- [Done, P1] 两个 Desktop 项目创建入口保持双语、主题与交互一致，并由回归测试锁定。
- [Done, P0] 项目行提供 `…` 菜单，首批支持重命名与受确认保护的删除；默认不删除本地目录，可选清理 Molibot 项目对话。

## 2.46 Configurable memory reflection and completion notice (2026-07-11)
- [Done, P1] Memory reflection 支持 Desktop 配置每日本地时间，保存后即时更新各 Bot 的 managed watched event。
- [Done, P1] 仅在产生新候选时向首个允许 Chat ID 发送独立完成通知；内部 reflection 仍不经过普通 Agent Runner。

## 2.45 Memory review stability fixes (2026-07-11)
- [Done, P0] 每日 03:00 reflection 读取上一个完整本地日，消除当天 03:00–24:00 永久漏扫窗口。
- [Done, P0] 每个 extracted candidate 独立校验；坏候选不阻断同批有效候选，非校验类异常继续失败并保留重试能力。
- [Done, P1] embedding API key 轮换会触发 backend 重配；provider 失败后 add/search 使用有界冷却和 lexical fallback。
- [Done, P2] compact 的 expired/duplicate ID 查找改为 Set，保持 10k 上限扫描的线性 membership 成本。

## 2.44 Document Archiving Scheme (2026-07-11)
- [Done] 解决 CHANGELOG.md 和 prd.md 文件体积过大（超过 256KB 读取上限）导致 Agent 检索和全量读取成本高的问题。
- [Done] 实施按季度归档方案，将 2026 Q1（2月-3月）和 Q2（4月-6月）的历史条目移入 `docs/archive/` 目录中。
- [Done] 在主 `CHANGELOG.md` 和 `prd.md` 顶部增加归档索引，保留核心 V1 PRD 静态规格（1-9章）和最近的活跃条目。
- [Done] 在 `AGENTS.md` 和 `CLAUDE.md` 中增加归档位置与约定的说明。

## 2.42 Memory stable paths and namespaces (2026-07-11)
- [Approved] Memory Plan C0.1–C0.6 已完成实现前评审，无未决产品契约。
- [Done, P1] T2 + T6a 已同批交付：共享 namespace/domain 类型与 query plan、旧 SQLite 幂等迁移、canonical subject 稳定路径、版本链、低置信唯一兜底路径均已落地。
- [Done] runtime scope 已贯通 prompt snapshot 与 Agent Memory 工具；普通会话读取 owner/chat/agent，Project 额外读取当前 project，content 不自动注入；跨 namespace 管理与全局搜索/compact 已按实际存储 namespace 工作，并兼容 legacy chat id。
- [Done, P1] T1b、T3+T5 已交付：统一 tokenizer；internal 每日反思；独立 Candidate Inbox；唯一确认/编辑重校验/忽略抑制；importer 治理；mory 默认启用与 json-file 候选迁移。
- [Done, P2] T4、T6b、T7 已交付：Provider embedding + 模型版本回填与 lexical 降级；content/agent_self 应用；版本/来源/pin/过期/遗忘审计；Desktop 双语 Inbox 与详情操作。

## 2.43 Support Files and Media Preview for External Sessions (2026-07-11)
- [Done] 解决微信/飞书/Telegram等外部渠道会话在 macOS app 中点击时无法加载/刷新 scratch 生成文件、无法预览 inline 媒体（图片、音频、视频等）以及无法下载附件的问题。
- [Done] 外部会话查看时，使 Desktop 前端在 openSession 时触发 refreshFiles，并动态查找外部会话 botId 以作为 profileId、外部 session ID 作为 sessionId 发送给 `/api/web/files` 接口。
- [Done] 外部 Transcript 接口 `buildDesktopExternalTranscriptMessage` 保留附件的 `local` 相对路径以便 Svelte 匹配，并且 `externalSessionsFromContexts.ts` 中 `buildMessages` 补充解析 `entry.message.attachments`；
- [Done] 文件 API 端点 `/api/web/files` 支持解析外部 Session ID，递归扫描对应的 Agent scratch 目录，返回完整的文件记录，并能够服务（下载/预览）具体的外部文件资源。

## 2.42 Fix WeChat External Session Loading (2026-07-11)
- [Done] 解决微信（weixin-momo 等）以及其它第三方外部渠道 Session 在 Desktop 侧栏列表能展示，但点击加载时因 ID 包含特殊字符（例如 `@`）被 `isSafeSegment` 过度安全检查误判为 traversal 进而返回 "Session not found" 的问题。
- [Done] 扩充 `isSafeSegment` 安全字符白名单，支持 `@`, `:`, `+`, `%`，并在单元测试中覆盖包含 `@` 和 `:` 的 WeChat ID 解析。

## 2.41 Desktop Automation State Refresh & Sidebar Leak Fix (2026-07-11)
- [Done] 修复定时任务在 `sessionMode=chat` 下执行时，因复用已有会话导致 `origin: "automation"` 标记丢失，使 event 对话泄露到左侧 Sidebar 对话树中的问题。
- [Done] 引入定时任务面板的自动更新机制：结合 `onMount` 初次强制刷新、浏览器 Page Visibility API（恢复焦点即刷新）与 30 秒定时轮询，确保页面在长期停滞后依然能呈现最新触发任务的运行状态。

## 2.40 Project Session File Provenance and Inspection (2026-07-11)
- [Decided] Project 文件与 Git 变更采用全局实时视角，不再按 Session/run 归因，也不建设 `TurnFileProvenance`、文件 baseline、manifest 或 SQLite effect ledger。任意 Project Session 打开文件面板，都看到同一份当前文件树和 Git 工作区状态。
- [Planned, P1] Project Desktop 提供 Project-aware 的 **文件 / 变更 / 附件** 视图：文件树和 Git status/diff 属于 Project 全局；附件沿用现有会话消息和附件存储，只显示当前 Session。非 Git Project 不模拟变更历史。
- [Planned, P1] 新增只读 ProjectInspection：仅在注册 Project root 下执行受限的目录/Git 查询，所有 API 返回相对路径；必须处理 Git 不可用、嵌套仓库、软链接逃逸、未跟踪文件、二进制、大目录/大 diff 截断，并隔离 Git config、pager、external diff 与 textconv。
- [Done, P0] Project 模式已禁用 Bash 基于 mtime 的根文件自动搬家，并把完整截断输出移到 Project runtime `tool-output`，避免用户并发保存的正常项目文件被移动或 Molibot 元数据污染 Project root。
- [Decided] Project 输出使用显式 `target: project | scratch`：文本 `write/edit` 默认写 Project，媒体/下载/转换默认写 runtime scratch 日期目录；工具返回结构化最终路径供卡片展示，但不把它当作完整修改历史。删除 Session 或 Project history 永不触碰用户 Project root。
- 详细契约、数据模型、接口、安全边界、实施切片与验收矩阵见 `docs/requirements/project-session-provenance-and-inspection.md`。
- [In Progress] Slice B 已落地共享 `RunOutputLayout` 与 Project `write` 的 project/scratch 目标和结构化结果；媒体/附件统一、ProjectInspection 与 Desktop 面板待续。runtime 自动清理明确延期。
- [In Progress] Slice C 首批只读 ProjectInspection 与 tree/file/status/diff 路由已落地；cursor 和剩余极端边界矩阵完成后再标记交付。
- [Done] Slice D Desktop 面板已接入文件、变更、附件三个准确作用域的标签页，并覆盖中英、主题 token、键盘焦点和窄窗口布局。
- [Done] Slice B/C 已收尾：文件工具结构化结果覆盖文本编辑、媒体生成与附件；ProjectInspection 支持稳定 cursor、显式截断、二进制/超限、空仓库和父仓库子目录隔离。runtime 自动清理仍按决策延期。

## 2.39 DuckDuckGo Search UX Polish (2026-07-10)
- [Done] 区分“未配置任何可用引擎”和“成功调用但无结果”，当有成功尝试但返回 0 条结果时，正确提示 `"No search results found."`。
- [Done] 修复搜索引擎测试或调用中，若引擎正常工作但没有返回结果，错误地提示配置错误（"No configured search engine returned results."）的问题。

## 2.38 Desktop Automation Workspace Density (2026-07-10)
- [Done] Chat 内的“自动任务”工作区采用紧凑的任务列表 + 右侧详情/执行记录布局；任务行只保留名称、计划与状态，选中后才展示完整任务文本、计划元数据和最近执行，避免任务数量增多时大量卡片撑高页面。
- [Done] “自动任务”和“技能”主导航必须反映当前工作区的选中状态；任务创建、编辑、立即运行、删除、执行会话和完整历史入口保持可用。
- [Done] Automation 工作区在中英、明暗主题、键盘焦点与窄窗口下保持可用；窄窗口改为列表在上、详情在下，不产生横向溢出。

## 2.37 Unified Desktop Conversation and Project Navigation (2026-07-10)
- [Done] Desktop Chat 将项目从独立页面收进同一侧栏：一级菜单为“对话”和“项目”，二级为渠道/项目，三级为 Session；一级与二级均可多开、折叠状态本地持久化，折叠不得改变当前右侧会话或中断运行。
- [Done] 普通 Web Profile 与每个项目各自最多保留一个立即持久化的空 Session；重复点击新对话必须复用所属范围的空 Session，保存失败不得插入虚假列表行。
- [Done] 项目 Session 仅在所属项目树中显示，普通/外部会话仅在对话树中显示；右侧标题统一为 `来源或项目名 / 会话名`，项目工作目录与运行时隔离保持不变。
- [Done] 侧栏一级标题与主导航使用同级图标字重；项目不重复展示二级“项目”行。展开/新增控件仅在 hover 或键盘焦点时显示，Session 行不得造成横向滚动，右侧时间/菜单保留安全内边距并可覆盖超长标题。

## 2.36 Memory System Improvement Plan v2.2 (2026-07-10)
- 背景：定位收敛为「记忆优先、可审计、长期陪伴的个人 Agent」（魔魔计划）；审计发现 mory SDK 能力足够但宿主接线不足。经三轮外部 review 修订至 v2.2，详细契约、任务书与端到端验收见 `docs/requirements/memory-improvement-plan.md`。
- [Decided] C0 统一契约：**mory 为唯一正式后端**（owner 决策 2026-07-10，`MemoryBackend` 插拔接口保留供未来接入其他记忆工具，json-file 转维护模式 + 迁移）；**namespace（owner/chat/project/agent/content 编码）是 mory 的检索隔离键，domain 只做审计与注入策略标签，注入由显式 query plan 合并 namespace，content 绝不自动注入普通聊天**（v2.1）；三入口写入状态机（显式记住直写 / 反思抽取进候选 / importer 收编治理），**候选确认唯一入口 `gateway.confirmCandidate`：reload → revalidate → 策略 → ingest → 原子确认，编辑后必须重校验，任何入口不得绕过（v2.2）**；**反思运行契约**：watched-event `execution:"internal"` → MemoryReflectionService（**不经聊天 Runner、不写会话消息、不向用户外泄过程，通知为成功后的独立步骤**，v2.2），幂等键 ReflectionTargetId(hash of owner+bot+timezone+scopes)+localDate + per-conversation watermark + 候选 fingerprint，重试幂等、中断不推进，输入经 ReflectionSourceReader 只读投影（messages + 可选 Summary，可降级）；溯源为多消息数组（conversationMessageId 必填 + platformMessageId 可选）；layer/retention 与 lowConfidencePath 入契约；Summary 定位为会话连续性输入而非长期记忆。
- [Done] T1a 宿主中文分词止血：`package/mory/src/moryTokenize.ts`（当前为 Jieba search mode + CJK bigram + 停用词降权 + query 归一），替换三处按空格切词的打分（moryCore / jsonFileCore / classifier.memoryPriority）；mory 179 测试 + 宿主 classifier 中文单测通过。
- [Planned, P1] T1b mory 全链路统一 tokenizer：宿主检索 / prompt 行选择 / moryRetrieval / writeGate 去重冲突四个消费点强制统一，防止 T4 接管后中文匹配回退。
- [Planned, P1] T2 稳定路径与版本链激活：路径主来源为 extractor 完整输出（domain+type+subject+path），inferFactKey 仅低置信兜底且不落共享路径（防「喜欢简洁」覆盖「喜欢中文」）；与 T6a 同批做一次 schema 变更。
- [Planned, P1] T3 双链路抽取：即时链路只处理显式「记住」（廉价）；每日反思走 watched-event `execution:"internal"` 内部执行（不经聊天 Runner、不污染会话、不外发过程，通知独立，v2.2），按 ReflectionTarget 经 SourceReader 批量读当天增量 + 可选 Summary + 既有记忆，产出结构化候选进 Inbox，**不再挂在 per-message flush 上**；同 RunKey 重试幂等、中断不推进 watermark。
- [Planned, P1] T5 Candidate Inbox：独立候选层（pending 绝不写 mory），confirm 后才 ingest 到目标 namespace；importer 收编进治理与候选；确定性 suppression key 先行（不依赖 T4）；reason/sources 等最小审计字段随本批落库；与 T3 必须同批同 Agent。
- [Planned, P1] T6a Namespace 与 Domain 模型落地：namespace 编码为 mory userId（存量懒迁移），domain 列同批加；owner 跨渠道注入合并（带共享开关）、project 绑定隔离（v2.1）。
- [Planned, P2] T4 语义检索：embedder + engine.retrieve、存量回填、embedding 模型版本记录、继承 T1b、**retrieve 接口增加 namespace/domain 过滤**（普通聊天只检索 owner+chat+agent，content 绝不自动注入）、注入预算可配置、无 key 降级。
- [Planned, P2] T6b 内容/自我记忆应用：已发布内容记录与重复梗检测（依赖 T4）、魔魔成长状态存取。
- [Planned, P2] T7 可审计收尾：版本历史 UI、来源跳转、pin、遗忘/过期策略（moryForgetting 接入）。
- [Planned] 端到端验收集四场景：跨渠道注入、偏好演变可追溯、反思候选未确认零影响、已发内容防重。
- 拆出：T8 Subagent 信息采集 → `docs/requirements/content-collection-pipeline.md`；T9 Project 级技能加载 → `docs/requirements/project-skills-loading.md`（记忆 MVP 不依赖两者）。

## 2.34 Clean-machine First Launch Polish (2026-07-08)
- [Done] 全新数据目录必须自动拥有 `default` Agent，并让默认 Web Profile 关联该 Agent；旧数据中缺失 Agent 或默认 Web 关联为空时必须幂等补齐。
- [Done] Desktop 首次启动配置必须在对话式引导中询问用户称呼与偏好的 AI 回复风格，并保存到当前默认 Agent 的 profile 文件。
- [Done] 首次配置 Provider 后，Desktop 模型列表必须即时刷新，不要求用户重启 App 或服务。通过 BroadcastChannel 实现多窗口间设置更改的动态同步（覆盖 Providers/Models/Profiles/Agents 保存与删除），主窗口收到事件后非阻塞式重新拉取并更新数据；允许用户在未保存新服务商前，使用表单中的临时 URL 与 API Key 拉取并发现远端模型。
- [Done] Web Search 首启默认使用无需 API key 的 DuckDuckGo；旧配置缺失 DuckDuckGo engine 时必须自动补齐，`auto` 与显式 `duckduckgo` 都不能因为缺少 API key 被判为不可用。
- [Done] Desktop Automations 必须允许为 Web Profile 创建任务；所有 Desktop 自动任务必须写入 Bot 级 `events/` watched directory，保留 `chatId` 作为投递目标；此前误写入 Web chat scratch 的 JSON 在 scheduler 启动时迁移，以保证继续由共享事件运行时执行。
- [Done] macOS overlay titlebar 下，Chat/Settings/Project/Workspace 顶部空白与标题区域必须可拖动窗口；顶部必须有与红黄绿窗口控制区高度匹配的透明拖拽蒙版并调用原生 `startDragging()`；Chat/Project 左侧栏顶部和标题栏非交互子元素也必须是拖拽区域，按钮/输入框不得被拖拽层覆盖。
- [Follow-up, P1] 在真实打包 App 上复测“先显示窗口、后台启动服务”的启动体验；当前代码路径已异步启动服务且主 Chat 窗口默认可见，如仍慢需继续定位 WebView 首屏资源加载。

## 2.35 Desktop Release Versioning and Intel DMG (2026-07-08)
- [Done] Desktop App 的展示/包版本必须来自 `apps/desktop/package.json`，并在构建前同步到 Tauri config 与 Rust crate，不得继续停留在 `0.1.0`。
- [Done] GitHub Desktop Release 必须同时产出 Apple Silicon 与 Intel DMG；两个包必须内置各自架构的 Node sidecar。
- [Done] DMG 文件名必须包含 Desktop App 版本号和架构，格式为 `Molibot_<version>_<arch>.dmg`，对应 checksum 文件必须引用最终文件名。
- [Follow-up, P1] 若后续需要 Universal DMG，再评估 Rust/Tauri app、Node sidecar 与签名公证的 universal bundle 成本；当前先发布两个清晰分开的架构包。

## 2.33 Desktop Periodic Schedule Builder (2026-07-06)
- [Done] 周期任务创建与编辑提供每天、每周多选、每月指定日期和自定义 Cron 四种计划模式；旧复杂 Cron 必须无损回退到自定义模式，且保持中英、明暗主题、键盘与窄窗口可用。
- [Done] 新建任务目标只能来自已启用 Bot 配置中的 `allowedChatIds`，并按渠道/Bot 与 Chat ID 两级选择；不得依赖历史 Session 展示元数据，也不得把内部目录或无明确收件人的工作区暴露为目标。已有工作区任务保持兼容。
- [Follow-up, P1] 补充可读化 next-runs 预览和“复制到其他 chat/bot”。

## 2.32 Configurable Service Port (2026-07-05)
- [Done] 系统设置提供服务端口配置，默认 3000，仅接受 1024–65535 的整数并持久化到共享 Runtime settings。
- [Done] 独立服务启动与 Desktop supervisor 均读取持久化端口；显式 `PORT` 环境变量继续拥有更高优先级。
- [Done] Desktop 设置支持保存端口并重启托管服务；外部/非托管服务禁止由 UI 强制终止，避免无法自动恢复。
- [Done] Web 设置在托管模式下提供独立重启操作，并在端口变化后自动连接新地址。
- [Done] Desktop Tauri HTTP capability 必须精确放行 loopback `/api/settings/system`，服务端口通过该细粒度端点读取和保存，并由契约测试防止设置读写 scope 回归。
- [Done] Desktop 重新发现先前由自身启动的 sidecar 时必须恢复托管 ownership 和重启控制，不能一律降级为 external。

## 2.31 Desktop Projects (2026-07-05)
- [Done] 支持注册多个外部目录为 Project（注册表 = 名字 + rootPath + 配置），Workspace 数据目录位置与结构零变化，非项目 session 行为零回归。
- [Done] 项目 session 的工具 cwd 指向项目 rootPath，scratch/runlogs/memory 仍留在 Workspace；path guard 保持项目工作目录与 Workspace 服务目录可达，并拒绝其它路径。
- [Done] 项目 session 存储在 `<dataDir>/projects/<projectId>/sessions/`，与 web/渠道会话物理隔离；删除项目永不触碰 rootPath，项目目录里永不落 molipibot 元数据。
- [Done] 项目根目录的 AGENTS.md/AGENT.md/CLAUDE.md（按此优先级取首个）作为高优先"工作规范"注入项目 session 提示词，可覆盖 bot 的干活约定但不可覆盖身份与安全层；目录说明按 Workspace/项目两种模式互斥生成；项目文件一律经注入扫描与截断。
- [Done] Desktop 新增 Projects 视图：项目列表/添加/删除、项目详情（会话列表 + 多会话聊天），消息展示复用共享 completed-message renderer；渠道接入（/project 绑定命令）为后续版本。
- [Done] Desktop Tauri HTTP capability 放行 loopback Projects CRUD 与嵌套 session 路由，任意已配置本地服务端口均可访问。
- [Done] 添加项目先弹窗输入名称，再提供“自动创建目录 / 使用现有文件夹”两种方式；仅后者调用一次 macOS 原生目录选择器，用户始终不需要输入绝对路径。
- [Done] Projects 使用 Codex 式两列布局：会话直接展开在当前项目下方，右侧只显示聊天；新增或选择空项目时立即创建并打开首个会话。
- [Done] 普通 Chat 与 Project Chat 共用同一套会话发送运行模块、实时消息视图和 composer 外壳；Project 只通过 adapter 增加 projectId，不维护独立 SSE/消息实现。
- [Done] 项目 Session 切换后，右侧详情面板立即显示对应历史消息或明确的空会话状态。
- [Done] Project 与 Chat 的 Session 列表必须直接复用同一个 `ConversationRow` 组件，不允许只复用相似 class 后继续维护两套重命名/删除交互。
- [Done] Project/Session 异步加载必须按 Project ID、Session ID 和请求代次保持所有权；首次进入和快速切换时，旧响应不得覆盖当前右侧对话。
- [Done] Project Chat composer 必须复用 `ChatInputArea`，并由调用方传入真实模型名和 thinking 档位；共享组件不得内置 Project/Chat 分支判断，也不得把无意义的 Bot/Profile 或 Project token 塞入输入区。
- [Done] Chat 与 Project 共享 composer 必须保持紧凑可用：焦点态不能用过重的高饱和描边，正文区域默认可见多行并可随内容增长，工具区和发送按钮不得挤占正文输入空间。
- [Done] Desktop Chat 启动时不得把普通会话列表/默认会话选择作为整页 loading 的硬阻塞；侧栏 resize 状态必须能在窗口失焦、鼠标离开或组件销毁时释放，不能让整页长期不可点击。
- [Done] Projects 左侧只保留项目页语义：顶部“添加项目”、项目分组、项目下 Session 列表、项目名右侧 `+` 新对话；不得搬入 Chat 的新对话/自动任务/技能主导航。
- [Done] Project 详情头部只展示项目名，不展示本机 root path；Project 侧栏底部提供返回 Chat；Chat 与 Project 侧栏底部品牌入口都使用 Molibot logo，并保持紧凑高度与整行 hover 背景。
- [Done] Chat 侧栏外部渠道必须使用可渲染的图标；飞书和 QQ 不得引用当前图标字体里不存在的 glyph 名称。
- [Done] Fresh 自动任务会话（`origin:"automation"` 或 `task-*`）不得进入普通 Chat Session 列表和更多对话弹窗；只通过自动任务历史入口查看。
- [Done] 外部渠道 `contexts/` 中的历史任务会话也不得进入普通 Chat Session 列表；除 `origin:"automation"` 和 `task-*` 外，旧格式首条用户消息为 `[EVENT:...]` 的会话也必须过滤，只能从自动任务历史查看。
- [Done] Chat 右侧 Header 必须保持单行，头像显示当前 Bot 名称首字；在线/离线状态由左下 Molibot logo 徽标表达，Header 不再展示在线副标题或设置按钮。
- 详细实施方案（分 5 个 Slice，含代码锚点、每步理由与验证清单）：`docs/requirements/projects-feature-plan.md`。

## 2.30 Desktop Chat DESIGN Compliance (2026-07-04)
- [Done] Chat、Automations、Skills 必须以真实截图对照 `DESIGN.md` 做组合 UX/可访问性审计，并保存项目内证据与结论。
- [Done] Skills 列表必须支持搜索，长说明默认收敛且可展开；CSS Grid 不得让短卡片继承同排最长卡片高度造成大面积空白。
- [Done] Chat 媒体失败提示必须贴近对应附件并提供重试，不在 composer 重复暴露技术错误；共享 assistant fallback 必须按界面语言提供可执行的下一步。
- [Done] Chat 工作区交互必须具备统一 `:focus-visible` 焦点环；实际最小窗口宽度必须能进入紧凑布局，不能使用永远无法触发的断点。
- [Done] Automations 使用 Geist 6px/12px 半径、轻阴影和有限表面层级；执行状态必须本地化，单行任务标题不得在正文区域重复。
- [Done] Chat-side Automations 默认只展示紧凑列表和简单执行统计；用户选择任务后才展开可关闭的详情面板，列表必须显示执行次数与上次执行时间。
- [Done] 周期任务必须支持启用/暂停并持久化到 watched event JSON；手动运行状态只能锁定当前任务，不得冻结其它任务或其详情/操作。

## 2.29 Desktop Automation Management (2026-07-04)
- [Done] macOS Automations 页面提供周期任务的创建、搜索、编辑、删除、批量管理与立即运行，不把 one-shot/immediate 诊断任务混入产品入口。
- [Done] 任务默认保持紧凑，只展示计划、状态、上次执行时间与最近 3 次结果；完整执行记录按需展开。
- [Done] 完整执行记录由 SQLite 按时间倒序分页查询，默认每页 10 条，不在 WebView 预载全量记录后做假分页。
- [Done] 创建任务通过结构化 channel/bot/chat/scope 目标调用受限后端接口，最终仍只落地 watched event JSON，且不向 WebView 暴露本机路径。
- [Done] 页面适配中英、明暗主题与窄窗口，并保留执行会话详情入口和旧本地服务响应兼容。
- [Done] 完整执行记录使用独立分页弹窗，不在任务卡片中下拉展开；任务列表在查看历史时保持稳定高度。

## 2.28 Desktop Shared Rich Transcript (2026-07-04)
- [Done] 本地 Chat、历史、外部只读会话与自动任务详情共用同一个完成消息 renderer；附件和工具执行的样式/逻辑只能在共享组件中实现。
- [Done] 图片内联展示并可预览，音频和视频直接使用原生播放器；受保护媒体经 Desktop 文件接口和 Blob URL 加载，不暴露本机路径，并在会话切换/组件销毁时释放 URL。
- [Done] 工具开始/结束合并为单个结构化执行条目，流式与 multipart 路由共用收集逻辑，并随 assistant 消息持久化以保证历史回放一致。
- [Done] 共享展示适配中英、明暗主题与窄窗口；媒体加载失败提供重试，普通文件保持紧凑下载入口。
- [Done] 纯附件消息不展示内部占位文本或空白气泡；工具执行成功、进行中、失败使用准确且可本地化的状态文案。
- [Done] Fresh 自动化产生的 `task-*` Session 不进入 Desktop 普通左侧 Session 列表；历史记录仍能从自动化执行详情按 id 打开。
- [Done] Desktop 开发入口必须在启动 Tauri 前构建共享 Server；Server 构建失败时不得继续启动使用旧 `build/` 的 Desktop 服务。

## 2.27 Desktop Automation Transcript (2026-07-03)
- [Done] 自动任务执行会话不得显示 Agent 内容块 JSON，包括历史数据中的 JSON-string block/object array；只展示 user/assistant 的可读文本，内部 thinking/system/tool 消息不进入用户对话弹窗，并兼容前端连接旧本地服务的短暂版本错配。
- [Done] 会话详情直接复用 Chat 的消息 DOM/CSS 结构，不另造相似样式；使用相同 Markdown 气泡、时间、头像和滚动布局，并适配明暗主题和窄窗口。
- [Done] 本地 Chat 历史、外部渠道 transcript 与自动任务会话必须通过同一个 completed-message 展示模块渲染；实时 streaming、审批和 composer 作为 Chat shell 专有状态保留在调用方。

## 2.26 Desktop Chat Workspace Navigation (2026-07-03)
- [Done] “新对话”必须切回 Chat、展开并定位当前 Web Profile 的新 Session；当前 Session 尚无消息时重复点击不得再次创建。
- [Done] “自动任务”和“技能广场”必须保留在 Chat 窗口，只切换右侧内容区，不得打开 Settings 窗口。
- [Done] 技能工作区当前只列出已安装/已发现的全局、Bot、会话级技能，包括自动生成技能；安装、搜索和技能市场留待后续版本。
- [Done] Chat 工作区导航与新增视图使用独立模块，避免继续把新能力堆入单一 `ChatView.svelte`。
- [Follow-up, P1] 继续按消息流、文件面板、onboarding 和侧栏边界拆分 `ChatView.svelte`，每个 slice 保持行为回归覆盖，不做一次性大重写。

## 2.25 Desktop Session Navigation (2026-07-02)
- [Done] Desktop Chat 的 Bot/Profile 分类默认全部折叠，不因首次加载或切换渠道自动展开第一个分类；点击分类后展开，再次点击收起。
- [Done] 分类与 Session 条目使用协调的视觉密度，保持双语、明暗主题和窄侧栏可读性。
- [Done] Web 与外部渠道 Session 以最后更新时间倒序排列，而不是创建时间；旧 Session 在新活动后回到列表顶部。

## 2.24 Agent Engineering Methodology (2026-07-02)
- [Done] 根 `AGENTS.md` 明确采用第一性原理：实现前确认根本问题、拆分最小可验证单元，并为每个决定说明原因。
- [Done] 所有交付执行对抗式自审：主动列出并修正最可能翻车的 3～5 个点，以验证证据替代主观判断。

## 2.23 Scope Clarification (2026-07-02)
- [Done] macOS Chat 侧栏“自动化任务”入口应成为独立 Automations 面板，仅展示周期定时任务；一次性/立即 watched-event 任务不在此入口展示，继续作为 settings 诊断/底层运行时能力存在。
- [Done] 周期任务必须具备稳定 taskId，并把后续定时触发、手动触发、失败、超时、停止、跳过和 retry attempt 关联到同一个执行历史视图。
- [Done] 同一周期任务禁止并发启动；已有 active execution 时，新触发记录为 skipped，不再启动第二个 Agent。
- [Done] fresh 自动化 session 不进入普通左侧 session 列表；只能从 Automations 执行记录查看。session retention 清理后，执行记录保留并展示会话已清理状态。
- [Done] Automations 执行记录可打开只读 session 详情；真实 event JSON 路径和本机绝对路径不得暴露给 macOS WebView。
- [Done] macOS 前端与本地服务短暂版本错配时，Automations 页面仍须结束加载、只展示周期任务，并兼容旧响应中缺失的执行记录字段。
- [Follow-up, P1] 周期任务的可读化 next-runs 预览和“复制到其他 chat/bot”可在后续迭代补强。

## 2.22 Package Management (2026-07-01)
- [Done] 根应用与 `apps/desktop` 使用同一个 pnpm workspace 和锁文件，依赖通过 pnpm 内容寻址 store 跨项目复用，降低重复安装的存储成本。
- [Done] 本地开发、Tauri、CI、Docker 与 release bundle 统一使用固定版本的 pnpm 和 frozen lockfile；npm 锁文件不再作为产品主工程安装入口。
- [Done] Makefile 及其嵌套 package/Tauri 脚本通过 Corepack 解析项目固定版本，不要求用户额外配置全局 pnpm PATH。
- [Done] 自定义 SQLite-aware Node adapter 必须替换当前 adapter-node handler 的全部运行时占位符，production build 后 Desktop 托管服务可直接启动并通过 handshake。


## 1. Product Goal
Build a minimal but real multi-channel AI assistant using pi-mono, with **Telegram + CLI + Web** in V1.

## 2. Target Users
- Solo builders and small teams who want one AI assistant across channels.
- Users who prefer simple interaction over complex automation.


## 3. V1 Scope

### Must Have (P0)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P0-01 | Unified message router | P0 | V1 | Incoming messages from Telegram/CLI/Web are normalized and processed by one core pipeline |
| P0-02 | Telegram adapter | P0 | V1 | Bot receives user text and returns assistant response with stable delivery/retry |
| P0-03 | CLI adapter | P0 | V1 | `molibot cli` supports interactive multi-turn conversation |
| P0-04 | Web chat | P0 | V1 | Browser chat supports send/receive and response streaming |
| P0-05 | Session persistence | P0 | V1 | Conversation history persists in SQLite and can be restored by session |
| P0-06 | Basic guardrails | P0 | V1 | Request size limit, rate limiting, and secrets via env vars |
| P0-07 | Operational baseline | P0 | V1 | Health endpoint, structured logs, and startup checks are implemented |
| P0-08 | Telegram image response media correctness | P0 | V1 | When bot returns image files, Telegram should render them as photos (not opaque data documents) whenever payload is an image |

### Should Have (P1)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P1-01 | Conversation summary compression | P1 | Delivered (2026-03-13) | Runtime auto-compacts old turns when context nears model limits, exposes manual `/compact [instructions]` commands that force an older-context summary even when the automatic keep window is larger than the current context, reloads the latest persisted session before idle manual compaction, and allows operators to configure reserve/keep token thresholds in AI Routing settings |
| P1-02 | Redis cache/rate state | P1 | Post V1 | Hot session and throttling moved from in-memory to Redis |
| P1-03 | Basic tool call wrapper | P1 | Post V1 | 1-2 tools can be called via normalized interface |
| P1-04 | Telegram mom parity core | P1 | V1.1 | Telegram bot supports per-chat runner, stop/cancel, tool-calling (`read/bash/edit/write/attach`), attachment ingestion, and event-file scheduling (immediate/one-shot/periodic) |
| P1-05 | Global skills registry for mom runtime | P1 | V1.1 | Runner loads reusable skills from `<workspace>/skills/**/SKILL.md` and exposes skill catalog/rules in system prompt |
| P1-06 | Pluggable memory backend architecture | P1 | Delivered (2026-03-01) | Stable memory gateway now supports replaceable backend selection (`json-file` default, optional `mory`) with unified interfaces (`add/search/flush/delete/update`) and UI/backend setting control |
| P1-15 | Memory backend/source separation | P1 | Delivered (2026-03-01) | Memory storage backends and external sync sources should be separate extension points, so legacy file import or future external memory systems do not have to masquerade as the primary storage backend |
| P1-16 | Startup diagnostics for runtime plugin state | P1 | Delivered (2026-03-01) | Server startup logs should show discovered plugin catalog entries, applied channel plugin instances, selected memory backend, available memory importers, and initial sync results so operators can verify runtime state quickly |
| P1-07 | Memory retrieval strategy and lifecycle | P1 | V1.1 | Memory should support layered storage (`long_term` + `daily`), incremental flush from sessions, and hybrid retrieval (keyword + recency) for prompt injection |
| P1-08 | Memory governance and manual operations | P1 | V1.1 | Memory entries should support conflict labeling and TTL expiration, and operators should have a settings page to list/search/flush/edit/delete memories |
| P1-09 | Unified memory filesystem layout | P1 | V1.1 | All memory files must be stored under `${DATA_DIR}/memory`; channel/runtime-specific memory uses subdirectories under this root (no memory files directly in chat workspace folders) |
| P1-10 | Gateway-only memory contract for agent layer | P1 | V1.1 | Telegram agent memory operations must be routed through memory gateway interfaces/tools (not direct file edits), with periodic import from external memory files and unified management visibility |
| P1-11 | File-driven runner instruction stack | P1 | V1.1 | Telegram runner system prompt should be code-owned at runtime, then merge instruction/profile files from `${DATA_DIR}` (`~/.molibot`) and optional workspace-local overlays; fallback order must be `data-root global files` -> `workspace-local overlays` -> bundled default template |
| P1-12 | Auto-maintained instruction profile files | P1 | V1.1 | Bot prompt should define automatic maintenance for `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md` based on explicit conversation triggers, with high-risk confirmation gate and deterministic priority conflict rules |
| P1-13 | AGENTS workspace-target enforcement | P1 | V1.1 | Any AGENTS update operation must target `${workspaceDir}/AGENTS.md` only; project-root `AGENTS.md` must remain unchanged during bot-runtime instruction edits |
| P1-14 | Workspace bootstrap CLI init command | P1 | V1.1 | Add `molibot init` to initialize `${DATA_DIR:-~/.molibot}`; bootstrap `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `BOOTSTRAP.md` / `IDENTITY.md` / `USER.md` from bundled `src/lib/server/agent/prompts/*.template.md` files |
| P1-15 | Profile files global-path guardrail | P1 | V1.1 | Enforce that `SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md` are written only to `${DATA_DIR}` root-level files, preventing chat/workspace-scoped duplicates like `moli-t/bots/<bot>/<chatId>/soul.md` |
| P1-16 | Global profile path compatibility | P1 | V1.1 | Global profile path guard should accept normalized absolute targets (including case variants on case-insensitive filesystems) and avoid false blocking when writing to `${DATA_DIR}/*.md` |
| P1-17 | Multi-scope skills architecture | P1 | V1.1 | Skills should be loaded from `${DATA_DIR}/skills` (global reusable) + `${workspaceDir}/skills` (bot-scoped) + optional `${workspaceDir}/${chatId}/skills` (chat-specific), with deterministic precedence and no startup cleanup of bot-scoped skills |
| P1-18 | Skills inventory in settings UI | P1 | V1.1 | Provide `/settings/skills` to inspect currently installed skills across scopes (`global`/`bot`/`chat`) with explicit file paths and bot/chat context, backed by a server inventory endpoint |
| P1-19 | Standalone mory memory SDK package | P1 | V1.1 | `package/mory` should be independently buildable/testable as a Node package, include path normalization + write-gate APIs, and provide SQLite/pgvector schema/query templates for storage integration |
| P1-21 | Mory cognitive control modules | P1 | V1.1 | `package/mory` should provide non-integration logic modules for write scoring (`importance/novelty/utility/confidence`), conflict resolution/versioning, retrieval intent planning, episodic-to-semantic consolidation, and task-scoped workspace memory helpers with unit tests |
| P1-20 | SOUL tone baseline governance | P1 | V1.1 | Global `SOUL.md` should enforce decisive opinions, anti-corporate phrasing, direct-answer openings, mandatory brevity, and bounded humor/profanity rules for consistent assistant voice |
| P1-22 | Mory README capability checklist | P1 | V1.1 | `package/mory/README.md` should maintain a complete capability matrix with explicit `完成` / `TODO` status so integration work can track SDK readiness without reading source code |
| P1-23 | Mory engine orchestration and executable API | P1 | V1.1 | `package/mory` should provide unified `moryEngine` methods (`ingest/retrieve/commit/readByPath`) and executable `read_memory(path)` tool API for runtime integration |
| P1-24 | Mory async commit execution pipeline | P1 | V1.1 | Commit flow should support async extraction-to-persistence pipeline: extraction result validation, scoring gate, conflict resolution/versioning, and storage write outcomes |
| P1-25 | Mory concrete storage adapters | P1 | V1.1 | In addition to SQL templates, provide concrete adapter contracts and executors for in-memory, SQLite, and pgvector drivers so SDK can be wired without rewriting persistence layer |
| P1-26 | Mory retrieval execution stack | P1 | V1.1 | Retrieval should include planner routing, optional vector recall, reranking, and prompt injection output grouped as L0/L1/L2 memory context |
| P1-27 | Mory forgetting/archive policy engine | P1 | V1.1 | SDK should support retention scoring and capacity-based archive planning/execution with recency/frequency/importance-aware policy |
| P1-28 | Mory extraction validation and observability | P1 | V1.1 | SDK should include strict extraction payload validators and lightweight observability metrics for write outcomes, conflicts, retrieval hit/miss, and token cost |
| P1-29 | Mory full-loop composition E2E | P1 | V1.1 | Add composition-level E2E tests that cover commit -> read -> retrieve -> forgetting loop to ensure module interoperability |
| P1-30 | Global profile template governance | P1 | V1.1 | `${DATA_DIR}` profile files (`AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md`) should keep a stable template structure with clear per-file ownership, lightweight frontmatter metadata, and preserved user-specific content during future rewrites |
| P1-31 | Init bootstrap from bundled profile templates | P1 | V1.1 | `molibot init` should bootstrap `${DATA_DIR}` by copying bundled `src/lib/server/agent/prompts/*.template.md` files instead of creating empty companion profiles, with `AGENTS.template.md` also serving as the runtime fallback AGENTS context when no profile files exist |
| P1-32 | Remove duplicated AGENTS template artifact | P1 | V1.1 | Runtime fallback and install-time bootstrap should converge on a single bundled `AGENTS.template.md`, and the legacy duplicated `AGENTS.default.md` file should be removed |
| P1-33 | Prompt builder module isolation | P1 | V1.1 | Telegram mom system prompt assembly should live in a dedicated module (`src/lib/server/agent/prompt.ts`) rather than inside `runner.ts`, and code-owned prompt sections should focus on runtime contract instead of repeating editable persona/style rules |
| P1-34 | Prompt preview stable-before-dynamic ordering | P1 | V1.1 | System prompt output should place stable runtime contract sections before high-churn payload sections like current memory and skill inventory, so prompt previews are easier to inspect and diff |
| P1-35 | Runtime profile injection sanitization | P1 | V1.1 | Profile file injection should strip YAML frontmatter, avoid injecting human-only meta guidance that conflicts with runtime reality, and normalize path placeholders such as `${dataRoot}` before insertion into the system prompt |
| P1-36 | Adapter-selectable channel prompt sections | P1 | V1.1 | Core prompt assembly should remain channel-agnostic, while each adapter supplies its own channel-specific prompt sections (Telegram/Slack/Feishu/WhatsApp) so adding a client does not require rewriting core prompt rules |
| P1-37 | Settings task inventory UI | P1 | V1.1 | Provide `/settings/tasks` to inspect event-file tasks across workspace and chat scopes, grouped by task type and showing status, delivery, schedule, run count, and file path |
| P1-38 | Channel plugin registry architecture | P1 | V1.1 | New messaging channels should be installable via a manifest/adapter plugin contract without modifying `runtime.ts`, runner core, prompt core, or settings persistence schema beyond plugin registration |
| P1-145 | Feature plugin MVP and Cloudflare HTML publish | P1 | Delivered (2026-04-20) | Runtime should support built-in feature plugins with enable/config flows in `/settings/plugins`, feature-plugin prompt injection, and plugin-owned tools; the first delivered plugin should upload complete HTML documents to Cloudflare R2 and return a public URL in the configured `domain + routePrefix + randomFileName` format |
| P1-146 | Plugin authoring, install, and enable documentation | P1 | Delivered (2026-04-20) | Docs should clearly explain the current plugin support matrix, how to write a built-in plugin that really runs today, how to install and enable it, what the current external manifest format does and does not do, and include a simple Cloudflare HTML publish demo as the reference example |
| P1-147 | Feature-plugin build stabilization | P1 | Delivered (2026-04-20) | The first feature-plugin rollout should keep production build green; plugin-settings merge logic in runtime must compile cleanly so `npm run build` succeeds after enabling the new feature-plugin paths |
| P1-148 | Feature-plugin ownership cleanup | P1 | Delivered (2026-04-20) | Plugin-specific runtime actions should live under the plugin module itself instead of generic `agent/tools`, and Cloudflare HTML publish should use a dedicated Worker base host setting for final public-link generation while keeping older saved base-url configs readable |
| P1-149 | Feature-plugin dynamic settings rendering | P1 | Delivered (2026-04-20) | Feature plugins should declare their own settings fields in registry metadata, and `/settings/plugins` should render/save those fields dynamically so new plugins do not require hand-written form markup inside the settings page |
| P1-150 | Feature-plugin declaration colocation | P1 | Delivered (2026-04-20) | Each built-in feature plugin should keep its own declaration file inside its own subdirectory (for example `src/lib/server/plugins/<plugin>/plugin.ts`), while the root feature registry stays as a thin aggregator rather than holding plugin-specific definitions inline |
| P1-151 | Cloudflare HTML Worker template | P1 | Delivered (2026-04-20) | The Cloudflare HTML plugin should ship a Worker-side template in its own plugin directory so operators can manually deploy the public HTML-serving side, bind the target R2 bucket, and keep route/object-prefix settings aligned with the Molibot plugin config |
| P1-155 | Web UI consistency and localization baseline | P1 | Delivered (2026-04-22) | Main web chat and settings should feel like one product: shared theme tokens, clearer visual hierarchy, locale-aware settings shell/overview, and no obvious hard-coded mixed-language status strings in the core chat flow |
| P1-152 | Cloudflare HTML Worker safe custom filenames | P1 | Delivered (2026-04-21) | The Worker-side HTML serving template should accept safe custom `.html` names like `gold_daily_20260420_v5.html`, not just one hard-coded random-name pattern, so manually named uploaded pages can be served without false 404s |
| P1-153 | Cloudflare HTML dual public-link modes | P1 | Delivered (2026-04-22) | The Cloudflare HTML plugin should support both Worker-based public links and direct public R2 links, with explicit plugin settings and docs so operators can choose either mode without removing the other path |
| P1-154 | Cloudflare plugin partial settings validation | P1 | Delivered (2026-04-22) | The settings API should validate `plugins.cloudflareHtml` after merging partial updates with the currently saved values, so incremental plugin changes do not fail or crash when omitted fields are still present in persisted config |
| P1-164 | Cloudflare HTML file-path upload input | P1 | Delivered (2026-06-03) | The Cloudflare HTML publish tool should accept a workspace-local `filePath` instead of inline HTML content, so runtime can read the file directly, preserve path-guard checks, and avoid inflating model context with large HTML payloads |
| P1-155 | Channel boundary hardening for shared agent logic | P1 | Delivered (2026-04-22) | Queue ownership, recovery, queue commands, and shared task-execution scaffolding must live in shared runtime or agent layers rather than per-channel runtimes; channels should keep only transport-specific send/receive, platform adaptation, and raw-message normalization/rehydration hooks |
| P1-156 | Dedicated model failure logging and settings visibility | P1 | Delivered (2026-04-22) | Only failed model calls should be persisted, with enough context to diagnose why a primary model failed or why fallback was triggered; operators should be able to review these failures from a dedicated Settings page instead of reading mixed runtime console logs |
| P1-157 | Queue success auto-cleanup | P1 | Delivered (2026-04-22) | Persisted inbound and outbound queues should remove successfully processed items immediately, so SQLite keeps only unfinished work that actually needs retry or recovery after restart |
| P1-158 | Readable default mom runtime logs | P1 | Delivered (2026-04-23) | Default `[mom-t]` runtime logs should be human-readable single-line entries showing `time -> scope -> event -> key fields`, with color-coded event categories for terminal scanning and an explicit env escape hatch to restore raw JSON when machine parsing is needed |
| P1-159 | Explicit model fallback policy and route hygiene | P1 | Delivered (2026-04-24) | Runtime model retry/fallback should be operator-controllable (`off` / `same-provider` / `any-enabled`), default to same-provider fallback to avoid surprising cross-provider switches, exclude disabled providers from STT/vision fallback paths, and keep settings UI model options aligned with backend route resolution |
| P1-160 | Documentation role separation and AGENTS extraction policy | P1 | Delivered (2026-04-26) | Project docs should keep stable collaboration/architecture rules in `AGENTS.md`, planned scope in `prd.md`, delivered facts in `features.md`, onboarding/navigation in `README.md`, and high-level release summaries in `CHANGELOG.md`; when extracting from PRD/features into AGENTS, only evergreen rules should move upward |
| P1-161 | Time-aware prompt env injection and operator timezone control | P1 | Delivered (2026-04-26) | Live model input should include structured current-time metadata per turn (`message_received_at`, `timezone`, `today`) without permanently polluting saved user context, and operators should be able to choose a validated runtime timezone from Settings so date-sensitive replies and scheduling share the same reference timezone |
| P1-162 | Settings shadcn-svelte component migration | P1 | Phase 2 Delivered (2026-05-06) | Settings pages should move from ad hoc local UI wrappers and scattered Tailwind styling toward source-owned shadcn-svelte components. Phase 1 established `components.json`, shared UI components, and `/settings/system`; Phase 2 migrated `/settings/web` as the first profile form/list sample while keeping the chat page unchanged. Later phases should migrate remaining Settings pages progressively. |
| P1-162 | Source-free production release and auto update | P1 | Delivered (2026-05-01) | Production should support running from a release bundle or Docker image instead of a source checkout, with an update script that fetches GitHub, builds a timestamped release, atomically switches `current`, and restarts the managed service |
| P1-163 | Interactive deployment manager CLI | P1 | Delivered (2026-05-01) | Operators should be able to run a lightweight CLI manager to configure GitHub deployment, install/update, start/stop/restart, inspect status/logs, and uninstall runtime files without deleting persistent `DATA_DIR` data |
| P1-164 | Web version visibility and read-only update check | P1 | Delivered (2026-05-01) | Web UI should expose the currently running Molibot version and check whether a newer GitHub version exists, but browser UI must not trigger update or restart operations; updates stay in the CLI deployment manager |
| P1-165 | System settings page for core preferences | P1 | Delivered (2026-05-01) | Settings should include a dedicated System Config page for interface language, runtime timezone, and read-only deployment/GitHub information; GitHub source must not be editable from Web UI |
| P1-166 | Default GitHub deployment source | P1 | Delivered (2026-05-01) | Deployment update, CLI manager, and Web version checks should default to `https://github.com/gusibi/molibot` branch `master` while still allowing environment/deploy config overrides outside Web UI |
| P1-167 | Release tooling bootstrap for older source checkouts | P1 | Delivered (2026-05-01) | The update flow should be able to install from a source checkout that predates the release scripts by injecting current installer-owned release tooling into the managed clone and self-healing known missing root runtime dependencies, without using the developer workspace as the production runtime |
| P1-168 | Lightweight service watchdog | P1 | Delivered (2026-05-01) | Manual service start should keep a lightweight supervisor alive that restarts the Molibot child process after unexpected exits, while manual stop/restart must remain explicit and must not install an OS-level boot service |
| P1-178 | Subagent model route and runtime visibility | P1 | Delivered (2026-05-01) | AI Routing should expose a dedicated subagent fallback route plus Claude Code-style `haiku` / `sonnet` / `opus` / `thinking` level mappings, built-in subagent definitions should be visible read-only in Agents settings behind one Subagents navigation entry, the displayed effective model should match runtime resolution, Web/Telegram traces should show subagent tool usage, and Telegram tool result summaries should stay compact |
| P1-179 | Subagent early-delegation budget strategy | P1 | Delivered (2026-05-01) | Codebase-heavy parent runs should be instructed to use subagents before exhausting the 24-tool hard limit, and runtime should inject a transient delegation notice after sustained direct tool use when no subagent has been used yet |
| P1-180 | Telegram typing action failure must not abort run | P1 | Delivered (2026-05-04) | `sendChatAction(typing)` failure in Telegram runtime should be treated as non-critical transport noise: keep retry/timeout logs for diagnostics, but never let typing-action exhaustion terminate the active run or suppress final user-visible answer/error messages |
| P1-181 | Skill Draft metadata must use reusable skill identifiers | P1 | Delivered (2026-05-06) | Automatic and manual Skill Draft generation should normalize `name` / `description` / `aliases` through a skill-creator-aware metadata step, so raw user messages, complaint wording, or generic retry commands are preserved only as trigger context and never become the draft skill name |
| P1-182 | Skill Draft metadata subagent execution path | P1 | Delivered (2026-05-06) | Automatic Skill Draft saves should exercise a dedicated read-only `skill-drafter` subagent to generate frontmatter metadata, while preserving local normalization fallback if the subagent fails, returns invalid JSON, or is unavailable |
| P1-183 | Agent bash OS sandbox boundary | P1 | Delivered (2026-05-10, updated 2026-05-19) | Operators can opt into OS-level sandboxing for main and built-in subagent `bash` only, configure env/network/filesystem policy in Settings, resolve allowlisted sandbox env keys from both host env and `.env.sandbox.local` with env-file precedence, see startup warnings and diagnostics for missing allowlist keys without exposing values, and get concise `Sandbox` / `Sandbox disabled` labels in tool output when the sandbox path is used or soft-disables after init failure; host-browser, desktop app, ACP, MCP, and channel transport access remain outside this sandbox |
| P1-201 | WeRead skill must verify env before blaming env | P1 | Delivered (2026-05-19) | The global WeRead skill must not claim `WEREAD_API_KEY` is missing unless it first checks `printenv WEREAD_API_KEY` and confirms the value is absent. When WeRead returns `用户不存在` or other non-zero business/auth errors, the skill must surface the actual `api_name` and request/error context instead of mislabeling the failure as local sandbox env absence. |
| P1-202 | Host Bash approvals move from settings JSON to SQLite with management UI | P1 | Delivered (2026-05-23) | Host Bash approvals and whitelist entries should persist in dedicated SQLite tables instead of runtime settings JSON, migrate legacy data once, keep session-only fallback semantics unchanged, and expose `/settings/host-bash` for pending/history/whitelist inspection plus whitelist/history management (enable, disable, delete) without adding manual approve/reject controls to the web page. |
| P1-203 | Host Bash labels reflect real execution path | P1 | Delivered (2026-05-26) | `bash` progress, diagnostics, and run detail should show `Host Bash` when an approved host entry or session-approved host fallback executes, reserve `Sandbox` for actual OS sandbox execution, and use `Sandbox disabled` only when sandbox initialization soft-disables. |
| P1-204 | Agent session failure-turn persistence parity | P1 | Delivered (2026-05-27) | Agent session persistence should match Pi/Pae-style message-boundary behavior: save the user prompt at run start, keep assistant error/partial messages and completed tool results, write compaction before the current prompt when threshold compaction runs, exclude transient runtime notices from normal history, and allow retry/fallback to isolate error assistant messages from the next model attempt without deleting audit history. |
| P1-205 | Named sandbox profile security configuration | P1 | Delivered (2026-05-30) | Provide three preset sandbox profile configuration cards (Observe, Build, Strict) on `/settings/sandbox` page with dynamic auto-detection and custom adjustments, localized in Chinese and English. |
| P1-206 | Feishu Bot account health check | P1 | Delivered (2026-06-08) | `/settings/feishu` should let operators test the currently edited `appId` / `appSecret` immediately through `POST /api/settings/feishu/test`, returning Bot name/open_id on success and local validation or Feishu SDK code/msg on failure, without sending a test message or attempting a full permission matrix. |
| P1-207 | Feishu bot-participated thread continuation | P1 | Delivered (2026-06-08) | Feishu group main-stream messages still require `@bot`, but once the Bot has replied inside a group thread, later messages in that same thread should continue the same scoped conversation without another mention; unknown or registry-expired threads require one fresh `@bot` to activate. |
| P1-208 | Feishu multi-bot mention ownership | P1 | Delivered (2026-06-11) | In Feishu groups with multiple bots, each Molibot Feishu instance should respond only when the incoming message mentions that instance's resolved bot identity. Identity probing should prefer `bot/v1/openclaw_bot/ping` and fall back to `bot/v3/info`; mentions of other bots must be ignored, and an unresolved bot identity must not fall back to accepting arbitrary group mentions. Startup queue recovery must not duplicate inbound tasks when a stale/busy run blocks processing, and completed or discarded inbound tasks must be removed from SQLite instead of accumulating terminal rows. Private chat and known bot thread continuation remain unchanged. |
| P1-209 | Centralized database directory | P1 | Delivered (2026-06-11) | Default runtime SQLite files should live under `${DATA_DIR}/db` instead of scattering across the data root or memory directories. Startup should migrate legacy default DB files and their WAL/SHM sidecars into the DB directory when the new target does not already exist, while preserving explicit operator/test database paths. |
| P1-188 | Concise sandbox labels and readable Weixin tool batches | P1 | Delivered (2026-05-13) | User-facing tool progress should prefer concise sandbox labels (`Sandbox` / `Sandbox disabled`) over repetitive `bash (...)` wording, and Weixin grouped tool-progress deliveries must render each tool call on its own line instead of collapsing a batch into a single dense line |
| P1-184 | Telegram live-control commands bypass busy enqueue | P1 | Delivered (2026-05-11) | Telegram slash-command registration must include shared `/steer`, `/followup`, `/follow_up`, and `/queue` commands so they reach shared runtime command handling before ordinary busy-message queuing. In particular, `/steer <queueId>` must promote the referenced pending queue item instead of being queued as a new task. |
| P1-185 | Chat-first host tool approval | P1 | Delivered (2026-05-12) | When a skill or task needs a host-only external tool, the agent should request a specific host capability through the `bash` entry itself instead of trying to bypass sandbox with plain shell retries; Telegram/Feishu/QQ/Weixin operators can approve a single pending request from chat by replying `安装` / `批准` / `approve`, and the result is persisted as an approved host tool registry entry that can only run its fixed command through structured argv, not through a general host shell. |
| P1-186 | Structured host approval payload and auto-continue | P1 | Delivered (2026-05-13) | Host approval requests should surface as structured approval payloads (title/body/options/request metadata) instead of only free-text prompts, so Web/API streams and chat channels can render native approve/reject buttons; once approved, the pending host action should be auto-executed immediately using the stored structured argv/stdin/timeout payload instead of requiring another follow-up turn. |
| P1-187 | Bash host whitelist routing | P1 | Delivered (2026-05-13) | The `bash` tool should route single-executable commands through the approved host capability whitelist before normal execution, run approved entries directly on host, and auto-create a structured host approval request after sandbox permission failures for eligible single commands so later runs can reuse the stored whitelist entry immediately. |
| P1-188 | Host approval rejection acknowledgement | P1 | Delivered (2026-05-14) | Rejecting a host tool approval from channel-native buttons/cards should send an explicit visible chat reply saying the request was rejected, rather than only changing the approval card state with no clear terminal acknowledgement. |
| P1-189 | Host approval blocks current run | P1 | Delivered (2026-05-14) | When sandbox permission failure auto-creates a structured host approval request, the current runner turn must stop in a blocked “waiting for approval” state instead of treating the tool call as a normal success and continuing to generate downstream answers before the operator approves or rejects it. |
| P1-197 | Non-interactive host approval fallback for Weixin/QQ | P1 | Delivered (2026-05-16) | Channels without native host-approval buttons must not tell operators to click missing UI. Shared runtime should provide a text fallback that explicitly explains reply-based approve/reject behavior and per-request `/hosttools approve|reject <approvalId>` commands, and QQ/Weixin must consume that shared fallback instead of reusing interactive-only wording. |
| P1-198 | Persistent single-command vs one-time compound host approval | P1 | Delivered (2026-05-16) | Host approval should split into two operator-facing models: a single executable command (`mv`, `pip`, `mkdir`, etc.) becomes a reusable approved host capability after one approval, while a compound shell command (`&&`, newline, multi-step install flow, etc.) becomes a one-time exact host action approval that is executed once and never persisted into the reusable approved-tool whitelist. Resolved approvals must also leave the pending list so operators only see true waiting requests there. |
| P1-199 | Success-path run-detail archive with on-demand retrieval | P1 | Delivered (2026-05-16) | IM channels should not leave bulky success-path execution details inline after a run finishes. Shared runtime must archive structured per-run detail logs, expose `/runlog latest|<runId>` for later inspection, prefer returning archived logs as text files on channels that support file delivery, keep Web’s existing diagnostics view unchanged, rewrite Telegram’s successful `运行详情` message into one archive notice, make Telegram final answers/archive notices reply to the original user message where supported, and let QQ/Weixin/Feishu append the same archive notice even when they cannot edit old detail messages. |
| P1-200 | Host approval waiting state must not masquerade as manual stop | P1 | Delivered (2026-05-19) | When sandbox host approval pauses a run, runtime must expose a dedicated waiting stop state instead of reusing generic `aborted`. Channel adapters, especially Telegram, must not emit terminal `Stopped.` copy for that path, and the temporary waiting prompt must not be persisted into session history as if it were a normal assistant answer. |
| P1-190 | Cross-channel subagent execution notices | P1 | Delivered (2026-05-14) | Subagent delegated runs must surface explicit operator-visible start/end and per-task progress hints across Web, Telegram, Feishu, Weixin, and other shared text channels through one shared event/runner path, without pushing delegation state logic down into individual channel adapters. |
| P1-191 | Non-blocking subagent progress sinks | P1 | Delivered (2026-05-14) | Shared subagent UI-event delivery must be best-effort only: channel/UI sink failures cannot abort delegated work, and failed delegated runs must still emit terminal lifecycle events so progress panes do not remain stuck on started tasks. |
| P1-192 | Settings shell and first-screen hierarchy unification | P1 | Delivered (2026-05-15) | The shared `/settings` frame should use one DESIGN-driven shell for left navigation, top chrome, hero surface, content width, card layering, and first-screen action styling, so page entry feels like one coherent product even before deeper per-page form cleanup happens. |
| P1-193 | Settings shell visual restraint pass | P1 | Delivered (2026-05-15) | After the first shell unification, ordinary settings page headers should stay compact rather than consuming large hero-height blocks, and shared card borders should remain low-contrast, especially in dark mode where bright outlines break the intended refined editorial feel. |
| P1-194 | Providers page compact-header follow-through | P1 | Delivered (2026-05-15) | `/settings/ai/providers` must follow the compact shared settings-header rhythm too; it should not keep a special oversized first-screen header just because it uses a custom `div + header + action` layout. |
| P1-195 | Shared Card primitive should avoid hard ring outlines | P1 | Delivered (2026-05-15) | The shared shadcn `Card` primitive should not default to hard `ring`-based outlines that read as black in light mode or bright in dark mode; its default surface separation should come from a softer border plus shadow instead. |
| P1-196 | Tasks settings page must tolerate long operational text | P1 | Delivered (2026-05-15) | `/settings/tasks` should keep long file paths, bot/chat identifiers, status reasons, timezones, and error messages inside the layout by using wrapping/fixed-width table columns and non-overflowing action controls instead of letting content expand the page horizontally. |
| P1-187 | Interactive manager TTY disconnect resilience | P1 | Delivered (2026-05-13) | `molibot manage` must treat an interactive terminal read `EIO` as a normal prompt shutdown, resolve any pending menu prompt when the `readline` interface closes, and exit quietly when stdin disappears instead of crashing with an unhandled `Interface` error stack. |
| P1-162 | Cache-safe time awareness split | P1 | Delivered (2026-04-26) | Current-time awareness should live in the live per-message env wrapper instead of the runtime-owned system prompt, so prompt caching is not invalidated by time-bearing guidance that no longer needs to be in the cached system layer |
| P2-160 | AI Providers maintenance UX | P2 | Delivered (2026-04-24) | Providers settings should reduce long-list noise and thinking-config misinterpretation with an earlier two-pane layout, independently scrolling provider list, collapsed built-in models, and explicit reasoning parameter guidance |
| P1-165 | DeepSeek v4 upstream compatibility | P1 | Delivered (2026-04-25) | Runtime should use pi-mono's built-in DeepSeek v4 provider support instead of Molibot-specific payload patches, migrate stale `custom|deepseek|...` routes to built-in `pi|deepseek|...` routes, and keep only generic old-session cleanup for orphan tool-result messages |
| P1-166 | Direct schema dependency hygiene | P1 | Delivered (2026-04-25) | Tool schema libraries imported by Molibot source must be declared as Molibot dependencies instead of relying on pi-mono transitive packages, so production builds remain stable across upstream upgrades |
| P1-167 | Agent edit diff readability | P1 | Delivered (2026-04-25) | The `edit` tool should return context-aware line diffs for insertions/deletions instead of naive same-index comparisons, while preserving existing workspace path guardrails |
| P1-168 | AI usage observability redesign | P1 | Delivered (2026-04-25) | `/settings/ai/usage` should present a reference-quality usage dashboard from existing tracker data only, including request/token summary cards, trends, token-type distribution, API/model/bot/channel breakdowns, and recent events, while omitting modules for unrecorded fields such as cost, latency, success rate, and auth index |
| P1-169 | AI providers and model-error console polish | P1 | Delivered (2026-04-25) | `/settings/ai/providers` should keep save/default-model controls visible near the top of the provider editor, insert newly added providers and models first, and `/settings/ai/errors` should present failure logs as a concise operational console with summary cards, filters, provider ranking, and detailed records |
| P1-170 | Shared subagent delegation via pi-mono SDK | P1 | Delivered (2026-04-26; upgraded 2026-07-21) | The runtime exposes one shared `subagent` tool backed by isolated `@earendil-works/pi-coding-agent` 0.81 sessions using the canonical `ModelRuntime`, so complex codebase tasks can delegate to `scout`, `planner`, `worker`, and `reviewer` roles with their own tool budgets instead of exhausting the parent run; default runtime logs make delegated execution visibly distinct from parent-run execution |
| P1-171 | Stop command clears pending queue backlog | P1 | Delivered (2026-04-26) | Shared channel `/stop` should abort the current running task and also cancel same-scope pending queued requests, so users can actually stop a backlog instead of watching queued follow-up prompts continue after the current run aborts |
| P1-172 | Shared live run controls (`abort` / `steer` / `followUp`) | P1 | Delivered (2026-04-26) | Shared agent/runtime layer should expose three distinct live controls for active work: hard-abort current run, inject a correction into the current run, and queue a follow-up turn to execute immediately after the current run finishes, without re-implementing this behavior inside each channel adapter. If a second message is already sitting in the inbound queue, operators should be able to promote it by `queueId` instead of retyping the message text. |
| P1-173 | Gold daily task fixed serial search path | P1 | Delivered (2026-04-26) | The Molifin gold daily scheduled workflow should stop launching four ad-hoc parallel 30-second searches and instead use one fixed wrapper that runs the four required queries serially, gives each engine a fixed 60-second budget, falls back across the documented web-search engine order on failure, and keeps the event prompt/scheme version aligned with that execution path |
| P1-174 | Shared prompt parallelism decision rule | P1 | Delivered (2026-04-26) | Shared tool-execution guidance should stop treating all “independent” calls as parallel-by-default and instead distinguish safe local read-only parallel work from remote/network/search steps that involve timeouts, retries, fallbacks, quotas, or result normalization, steering those flows toward sequential or tightly limited parallel execution |
| P1-175 | Tool-budget runtime notice isolation and structured session error code | P1 | Delivered (2026-04-26) | When a run exhausts its tool-call budget and the runner launches one no-tool continuation, the temporary `Do not call tools` control prompt must not persist as a normal conversation turn. Runtime should instead persist a non-contextual structured session error/event code (for example `RUN_TOOL_BUDGET_EXHAUSTED`) for debugging, keep detailed human-readable limitation text in channel output, and ensure later turns in the same session start with a fresh tool budget and no inherited no-tools instruction. |
| P1-176 | Shared runner and subagent regression hardening | P1 | Delivered (2026-04-26) | The new shared runner/subagent path must clear stale streamed assistant text between assistant messages, block shell control operators in read-only delegated bash commands, and honor each checked-in subagent role's explicit `model:` hint instead of always inheriting the parent run model. |
| P1-176 | Project-wide transient runtime control separation rule | P1 | Delivered (2026-04-26) | All future runtime error/limit strategies should follow one shared separation rule: temporary model-control instructions belong only to the active run and must never persist as normal session conversation; persistent debugging signals should be stored only as structured non-contextual runtime error/event codes; and detailed user-facing explanations should be emitted only through the channel/client response path. This policy should be documented in `AGENTS.md` and treated as the default design rule for similar failures beyond tool-budget exhaustion. |
| P1-177 | Queue id notice must reflect real pending state | P1 | Delivered (2026-04-26) | Channel adapters should only tell the user `Queued as #...` when the just-received inbound message is actually still waiting in the shared queue. Messages that are immediately claimed and start executing must not receive a queue-id notice, even if they briefly pass through the enqueue path internally. The check should be based on the persisted task state after enqueue, not a coarse pre-enqueue busy heuristic. |
| P2-162 | Shared workbench UI system for Web + Settings | P2 | Delivered (2026-04-26) | User-visible Web chat and Settings pages should share one reusable workbench design layer with consistent hero/panel/form/table/config-shell primitives. The four showcase AI settings pages must stop relying on page-local style blocks, the rest of Settings should move onto the same material/spacing system, and the main chat surface should inherit the same product language while keeping its calmer conversation-first rhythm. |
| P2-163 | Usage dashboard cache-hit ratio visibility | P2 | Delivered (2026-04-26) | The AI usage dashboard should expose whether prompt caching is working by showing both a current cache-hit ratio KPI and a time-series trend, using only recorded token fields and defining the ratio explicitly from prompt-side tokens (`cacheRead / (input + cacheRead)`) so operators can interpret it without guessing |
| P2-164 | Usage range tabs should fetch fresh stats | P2 | Delivered (2026-04-26) | The AI usage dashboard should not require a second manual refresh after switching time windows. Clicking `today / yesterday / last7Days / last30Days` must immediately trigger a fresh backend usage fetch so the selected window, generated timestamp, and derived KPI/chart values always reflect current data |
| P2-165 | Web chat current-session file workspace | P2 | Delivered (2026-04-26) | Web chat should support general file upload and expose a real right-side file workspace for the current session: searchable attachment inventory, type filtering, inline preview for common formats, and safe browse/download/copy-path actions, without turning the pane into a full filesystem manager or mixing in unrelated internal runtime directories |
| P2-161 | Unified AI model-pool settings UX | P2 | Delivered (2026-04-24) | AI Providers and AI Routing should present built-in and custom models as one mixed routing pool, demote legacy fallback details, and use responsive theme-aware layouts for both desktop and mobile settings workflows |
| P1-162 | Web locale switching reliability and Settings Chinese fallback | P1 | Delivered (2026-04-24) | Chat and Settings should share one locale state, Settings child pages should react to language changes, and hardcoded English settings pages should get a Chinese fallback until they are fully migrated to structured i18n |
| P1-163 | Custom provider thinking-format compatibility | P1 | Delivered (2026-04-24) | Custom providers with provider-specific thinking protocols should be explicitly configurable, legacy `thinking-type` saved values should migrate to `deepseek`, and custom DeepSeek-style endpoints should emit `thinking.type` plus mapped `reasoning_effort` without needing runner-level payload patches |
| P1-164 | Web chat Markdown rendering and latest-message scroll | P1 | Delivered (2026-04-24) | Assistant responses should render Markdown with a maintained parser plus HTML sanitization, and long chats / streaming updates should keep the viewport pinned to the newest message |
| P1-39 | Feishu inbound media parity core | P1 | Delivered (2026-03-01) | Feishu channel should normalize image/audio/file messages into the same runner input contract as Telegram: attachments persisted, images injected for vision, and audio/media optionally transcribed through configured STT routing |
| P1-40 | Core-owned workspace prompt and skills semantics | P1 | Delivered (2026-03-01) | Data root, memory root, prompt source loading, and skills directory resolution should live in `mom` core and work for all channel workspaces (for example `moli-t`, `moli-f`) so plugins only add optional bot/channel-specific prompt sections |
| P1-41 | Memory import deduplication and prompt hygiene | P1 | Delivered (2026-03-01) | Periodic external memory sync must not re-ingest identical content for the same scope/layer, and prompt rendering must hide repeated memory lines if historical duplicates already exist |
| P1-42 | Memory update dedupe semantics and tool parity | P1 | Delivered (2026-03-02) | Editing a memory into content that already exists must merge rather than create a duplicate, and both web/API and agent memory tools must expose the same dedupe cleanup capability |
| P1-43 | Explicit all-scope query control | P1 | Delivered (2026-03-02) | Cross-scope memory search/list/compact must happen only when explicitly requested; default behavior should stay limited to the current scope |
| P1-44 | Memory settings operator-first default view | P1 | Delivered (2026-03-02) | `/settings/memory` should default to an operator-friendly all-scope view and clearly label the source scope/session of each memory item |
| P1-45 | Backend module structure realignment | P1 | Delivered (2026-03-02) | Server code should be reorganized into explicit modules (`app`, `agent`, `channels`, `sessions`, `settings`, `providers`, `memory`) so ownership is readable without upstream-specific naming like `mom` or generic buckets like `services` |
| P1-46 | Settings/bootstrap boundary split | P1 | Delivered (2026-03-02) | Runtime env/path config should live under `app`, runtime setting schema/defaults should live under `settings`, and the shared web/CLI router path should be explicitly owned under `channels/shared` instead of generic `config.ts` and `core/` buckets |
| P1-47 | Infra and shared-type extraction | P1 | Delivered (2026-03-02) | Cross-cutting storage helpers, rate limiting, and shared message types should move out of generic `db/services/types` buckets into explicit `infra` and `shared` homes so business modules depend on stable foundations |
| P1-48 | Remove dead local web storage backend | P1 | Delivered (2026-03-02) | Unused leftover files from earlier web-storage experiments should be deleted once no runtime or route imports remain, so root `src/lib` does not accumulate misleading dead modules |
| P1-49 | Telegram runtime low-risk modularization | P1 | Delivered (2026-03-02) | Oversized Telegram runtime should first extract low-risk leaf concerns such as queueing, text formatting, STT integration, and local helper types into sibling files before any deeper command-flow split |
| P1-50 | Feishu runtime low-risk modularization | P1 | Delivered (2026-03-02) | Feishu runtime should follow the same shallow-split rule as Telegram: keep orchestration in `runtime.ts`, but move queueing and message send/edit leaf concerns into sibling files |
| P1-51 | Shared channel queue and STT primitives | P1 | Delivered (2026-03-02) | Telegram and Feishu should stop carrying duplicated queue and STT core logic; common queueing and transcription target/HTTP flow should live in `channels/shared`, while channel-specific wrappers keep only transport-local normalization and retry differences |
| P1-52 | Feishu outbound media parity baseline | P1 | Delivered (2026-03-03) | Feishu runtime should no longer drop agent-generated files; it must support outbound file delivery, native image send, audio/media best-effort delivery with safe fallback to file messages, and silent-response message deletion via the channel context |
| P1-53 | README information architecture cleanup | P1 | Delivered (2026-03-03) | Project README should use a conventional GitHub structure and present setup, status, usage, architecture, project layout, API, and limitations in a concise, scannable order |
| P1-54 | README branding polish | P1 | Delivered (2026-03-03) | README should include the project logo in a restrained, well-spaced header treatment so the page has a recognizable identity without hurting readability |
| P1-55 | README positioning aligned to product lineage | P1 | Delivered (2026-03-03) | README introduction should describe Molibot as a simplified OpenClaw-style personal AI assistant so the project framing matches its real origin and intent |
| P1-56 | README first-screen copy polish | P1 | Delivered (2026-03-03) | The README opening should read like a concise product positioning statement, not a loose explanatory paragraph, while preserving the OpenClaw lineage framing |
| P1-57 | README header slogan | P1 | Delivered (2026-03-03) | README header should include a short slogan under the logo to complete the brand presentation without adding visual clutter |
| P1-58 | Unified safe runtime model switching | P1 | Delivered (2026-03-03) | Model switching should be exposed through one validated runtime update path shared by channels/API/agent tools, with Feishu command parity and explicit guardrails against direct settings-file edits by the agent |
| P1-59 | Runtime token usage accounting and settings visibility | P1 | Delivered (2026-03-03) | Each AI request should persist token usage with provider/model metadata, and `/settings/ai` should show today/yesterday/7-day/30-day totals plus daily/weekly/monthly breakdowns and per-model usage summaries |
| P1-60 | Mory backend first-run bootstrap robustness | P1 | Delivered (2026-03-03) | New-machine startup must not fail just because `${DATA_DIR}/memory` or the SQLite parent directory does not exist before the Mory backend initializes |
| P1-61 | Agent-owned multimodal preprocessing boundary | P1 | Delivered (2026-03-03) | Channel adapters should normalize raw text/image/audio/file inputs only; the agent runner should decide STT execution, transcript injection, model routing, and recognition-failure fallback |
| P1-62 | Provider capability verification states | P1 | Delivered (2026-03-03) | Custom model configuration should preserve manual capability tags as the routing source of truth while storing lightweight per-capability verification status (`untested` / `passed` / `failed`) from provider probes for operator review |
| P1-63 | Agent-level identity layer and bot linkage | P1 | Delivered (2026-03-03) | Settings should expose reusable `agents`, allow Telegram/Feishu bot instances to bind an `agentId`, edit agent/bot Markdown prompt files in-page, and load prompt sources in `global -> agent -> bot` order |
| P1-64 | Prompt profile override semantics | P1 | Delivered (2026-03-03) | Profile files with the same logical slot should resolve by override, not concatenation: `bot` overrides `agent`, and `agent` overrides `global`, so only one version of each file participates in the final prompt |
| P1-64 | Verification-aware native vision routing | P1 | Delivered (2026-03-03) | Agent routing should send image payloads natively only when the selected custom text model or dedicated vision-route model has `vision` both declared and verification-passed; otherwise it should fall back to attachment-based handling instead of blindly invoking native vision |
| P1-65 | Audio-input capability groundwork | P1 | Delivered (2026-03-03) | Model configuration should support an explicit `audio_input` capability tag and verification placeholder state even before native audio prompt transport is wired, so later audio routing can build on declared capability metadata without another schema migration |
| P1-66 | Core prompt identity neutrality | P1 | Delivered (2026-03-04) | The base system prompt should not hardcode a bot/persona name; assistant identity must come from configured profile files (`IDENTITY.md`, `SOUL.md`) so agent personas are not overridden by runtime boilerplate |
| P1-67 | Verification-aware audio fallback routing | P1 | Delivered (2026-03-04) | Agent routing should make audio handling explicit from `audio_input` and `stt` metadata: until native audio transport exists, the runner must log why direct audio is unavailable, prefer declared STT fallback routes, and otherwise preserve voice-placeholder behavior with a visible notice |
| P1-68 | Provider settings enable control and built-in/custom split | P1 | Delivered (2026-03-06) | Settings should allow enabling/disabling providers per entry, separate built-in provider management from custom OpenAI-compatible providers, ensure built-in providers default to disabled, and ensure routing/default/model options only use enabled providers while keeping agent runtime flow unchanged |
| P1-69 | Settings navigation active-state correctness | P1 | Delivered (2026-03-06) | Settings sidebar tab highlight should always follow the current page route, with normalized path matching and exact-tab matching for sibling pages to avoid stale active colors when switching tabs |
| P1-70 | Provider enable state persistence on save | P1 | Delivered (2026-03-06) | Saving settings must preserve `customProviders[].enabled` in runtime persistence path so built-in/custom provider toggle state survives refresh and default custom provider resolution remains consistent with enabled providers |
| P1-71 | Vision-to-text fallback for unsupported image models | P1 | Delivered (2026-03-06) | When the active reply model cannot accept native image input, the agent runner should mirror the voice-transcript fallback path: resolve a usable vision route, convert each image into structured text analysis, inject that text into the user prompt, emit explicit notices instead of letting text-only models guess from attachment paths, and strip any historical `image` parts from session context before calling a text-only model |
| P1-72 | Settings single-entity save and unsaved-switch guard | P1 | Delivered (2026-03-07) | Agents/Web Profiles/Telegram/Feishu settings pages should save only the selected entity (single agent/bot/profile), switching selection with unsaved edits must prompt the operator to save first, editing a new entity ID must keep selection bound to that draft (no fallback save to `default`), and New Chat profile selection should show Web Profile names instead of opaque internal user IDs |
| P1-73 | Web chat identity model simplification (profile-only) | P1 | Delivered (2026-03-07) | Web chat should remove user-ID selection entirely and use Web Profile as the only session identity dimension in UI flow, so New Chat only picks profile and no opaque user-id input appears |
| P1-74 | README visual information architecture polish | P1 | Delivered (2026-03-08) | README should present a clear first-screen story with hero, concise highlights, architecture diagram, feature snapshot, and quick-start-first onboarding while keeping all capability claims grounded in actual implementation status |
| P1-75 | README scannability and navigation polish | P1 | Delivered (2026-03-08) | README should add fast navigation and status cues (table of contents, badges, and concise surface matrix) so first-time readers can locate setup/usage sections in seconds |
| P1-76 | README architecture rendering compatibility fallback | P1 | Delivered (2026-03-08) | Architecture section should remain visible even in environments without Mermaid rendering by keeping Mermaid syntax compatibility-friendly and providing a local static diagram fallback |
| P1-77 | Web UI theme tokenization + i18n switch foundation | P1 | Delivered (2026-03-08) | Web chat and settings UI should support light/dark/system theme switching and zh/en language switching with local persistence, while visual colors are driven by one replaceable theme token file (`src/styles/theme.css`) so future theme swaps do not require page-level code rewrites; themed light/dark modes must keep readable text/input contrast across all settings subpages, including AI Engine / Channels / Agent Data / System sections, and should allow palette refreshes such as Solar Dusk without touching page business logic; selection states (selected vs unselected) and form borders must remain visually distinguishable under both themes |
| P1-78 | MCP server integration for agent toolchain | P1 | Delivered (2026-03-08) | Runtime settings should support configurable MCP stdio servers, runner should automatically load MCP tools and merge them with built-in tools, and MCP failures should degrade gracefully without breaking normal chat execution |
| P1-79 | Skill-gated MCP exposure and settings panel | P1 | Delivered (2026-03-08) | MCP configuration should be manageable in Settings UI, and MCP tools must remain hidden by default: only skills that explicitly declare MCP dependencies and are explicitly invoked may enable scoped MCP tools for a run |
| P1-80 | Settings Overview dark-mode accessibility contrast | P1 | Delivered (2026-03-08) | Settings Overview cards should keep WCAG-friendly readable description contrast in dark mode by using theme-aware text tokens instead of fixed low-contrast slate grays, while preserving existing layout and palette behavior |
| P1-81 | Telegram media recognition pre-status and transient action retry | P1 | Delivered (2026-03-10) | When users send image/audio messages, Telegram should immediately show a reusable `Recognizing ...` status before runner thinking starts, and transient network failures on `sendChatAction` / status edits should retry instead of aborting the handling path |
| P1-82 | Telegram transport error root-cause visibility | P1 | Delivered (2026-03-10) | Telegram retry/failure logs should include nested fetch/HTTP cause metadata (`code`, `errno`, `syscall`, `address`, `port`, inner cause message) so operators can distinguish DNS, timeout, reset, and upstream reachability failures without blind reproduction |
| P1-83 | Declared-capability-first native vision routing | P1 | Delivered (2026-03-10) | If the active custom text model explicitly declares `vision`, runtime should send image inputs directly to that model by default; verification state remains advisory/observable and must not force a separate fallback vision API call against operator intent |
| P1-84 | Periodic task in-place update semantics | P1 | Delivered (2026-03-10) | Repeating `create_event` for periodic tasks with the same `chatId + schedule + timezone` must update the existing event in place (not create a duplicate); when duplicates already exist, runtime should keep the newest one active and mark older matches as superseded/non-runnable |
| P1-85 | Cross-provider fallback for retryable model failures | P1 | Delivered (2026-03-13) | When the active model request fails with retryable upstream errors such as `429` / rate limit / timeout / upstream `5xx`, runtime should automatically retry another configured provider before surfacing failure, and final operator-visible errors must include provider/model/baseUrl context for each failed attempt |
| P1-86 | Web config commands should bypass LLM | P1 | Delivered (2026-03-13) | In web chat, operator commands like `/models`, `/skills`, and route-specific model switching should be handled directly by runtime settings/skill data APIs instead of relying on LLM interpretation, so configuration inspection and switching still work when the active model is failing |
| P1-87 | Session entry log substrate and context rebuild | P1 | Delivered (2026-03-14) | Per-chat runtime context should persist as append-only session entries (`message` / `compaction`) in `contexts/<sessionId>.jsonl`, rebuild runnable context from those entries on load, and migrate legacy snapshot-only `.json` context files without losing active sessions |
| P1-88 | Chat-driven OAuth login and auth.json resolver | P1 | Delivered (2026-03-14) | Runtime should resolve built-in provider credentials from `${DATA_DIR}/auth.json` (or `PI_AI_AUTH_FILE`), refresh OAuth-backed credentials automatically when needed, and expose `/login <provider>` plus `/logout <provider>` commands across web and chat channels so auth can be completed from product surfaces rather than manual file editing |
| P1-89 | Compaction overflow recovery retry | P1 | Delivered (2026-03-14) | When an upstream model rejects a request for context/window overflow, runner should compact the current session, persist a structured compaction entry with token metadata, rebuild context from that compacted state, and retry the active request automatically before surfacing failure |
| P1-90 | Bot-level AI usage observability and filtering | P1 | Delivered (2026-03-14) | Usage tracking should include bot identity, and `/settings/ai/usage` should support bot-level filtering and ranking so operators can compare token/request consumption across different bot instances |
| P1-146 | AI usage analytics contrast resilience | P1 | Delivered (2026-04-21) | `/settings/ai/usage` should keep visible iconography, token badges, and timeline bar contrast inside the shared settings theme, so light/dark theme remapping cannot wash accent visuals into near-background monochrome |
| P1-91 | Telegram streaming output mode switch | P1 | Delivered (2026-03-14) | Telegram settings should provide a per-bot stream output switch (default enabled), and runtime should support both incremental streaming edits and final one-shot output when disabled |
| P1-92 | Telegram Codex ACP control path MVP | P1 | Delivered (2026-03-14) | Telegram should support a first ACP-based coding control flow for Codex via explicit `/acp` commands: register allowlisted projects, open a chat-scoped Codex ACP session against a chosen project path, stream back session updates, surface ACP permission requests for operator approval via Telegram, and keep the normal chat runner path unchanged |
| P1-93 | ACP web settings workspace | P1 | Delivered (2026-03-14) | Operators should be able to configure ACP from `/settings/acp`: toggle ACP globally, manage adapter targets (command/args/env/cwd), register allowlisted projects with absolute paths and target bindings, and set each project's default approval mode without editing settings JSON manually |
| P1-94 | Shared settings button interaction reliability | P1 | Delivered (2026-03-14) | Shared UI `Button` must forward native click events so settings actions wired through `<Button on:click={...}>` remain functional across ACP, MCP, channel bot forms, memory operations, and task management pages |
| P1-95 | Codex ACP startup diagnostics and auth hinting | P1 | Delivered (2026-03-14) | When a Codex ACP session fails during adapter startup, runtime should distinguish transport mismatch from adapter-side startup stalls and explicitly hint when no `OPENAI_API_KEY` / `CODEX_API_KEY` is available, because Telegram ACP cannot complete interactive Codex login flows |
| P1-96 | Codex file-auth reuse and startup timeout resilience | P1 | Delivered (2026-03-15) | Codex ACP startup should recognize existing file-based login state from `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) as valid authentication, avoid misleading API-key-only warnings, and allow longer adapter warm-up before failing `initialize` / `session/new` |
| P1-97 | Telegram ACP rate-limit crash hardening | P1 | Delivered (2026-03-15) | ACP task execution over Telegram must tolerate status-edit rate limiting by honoring `retry_after`, suppressing non-fatal edit errors, and throttling status updates so `editMessageText` failures cannot terminate the entire bot process |
| P1-98 | ACP Telegram tool-event consolidation | P1 | Delivered (2026-03-15) | Telegram ACP should not send one chat message per completed tool call; low-value tool completion noise must be consolidated into the final task summary while preserving high-value plan and permission events |
| P1-99 | ACP final-result structured formatting | P1 | Delivered (2026-03-15) | Telegram ACP final answers should render as readable Markdown reports instead of plain-text walls by adding default output-format instructions to `/acp task` and formatting the local completion summary with sections and bullets |
| P1-100 | ACP session restore across Molibot restarts | P1 | Delivered (2026-03-15) | Telegram ACP should persist chat-to-remote-session metadata and automatically restore prior Codex sessions via ACP `session/load` after a Molibot restart, so operators can continue with `/acp status` or `/acp task` instead of always re-running `/acp new` |
| P1-101 | ACP available command list readability | P1 | Delivered (2026-03-15) | `/acp status` should display human-readable available command names when ACP adapters return object-form command entries, instead of leaking `[object Object]` strings |
| P1-102 | ACP sessions inspection command | P1 | Delivered (2026-03-15) | Telegram ACP should expose an explicit `/acp sessions` command that lists available remote sessions (with current marker and project-aware filtering) to support controlled manual session recovery after restarts |
| P1-103 | Telegram ACP permission card interaction | P1 | Delivered (2026-03-15) | ACP permission requests in Telegram should render as clickable action cards with inline approve/deny actions and a guided “deny with note” flow, instead of forcing operators to manually type `/approve` or `/deny` commands from raw text blobs |
| P1-104 | ACP task execution-context diagnostics | P1 | Delivered (2026-03-15) | `/acp task` should always return a structured execution-context snapshot (cwd, directory listing, python/uv path and versions, DB-related env values, exact command and exit code) so “works in local terminal but fails in Codex ACP” issues can be diagnosed from one response |
| P1-105 | ACP immediate stop command alias | P1 | Delivered (2026-03-15) | Telegram ACP should support `/acp stop` as a first-class immediate-stop command (alias of task cancel) so operators can quickly terminate a running ACP task without remembering `/acp cancel` |
| P1-106 | Skill protocol simplification and YAML multiline frontmatter support | P1 | Delivered (2026-03-17) | When global `~/.molibot/skills/skill-creator/SKILL.md` exists, prompt should prioritize this skill for skill creation/update instructions; prompt skills runtime section should remove non-actionable diagnostics and redundant `base_dir` output; skill metadata parser must accept YAML block-style multiline `description` (`>` / `|`) in both runtime loading and settings inventory |
| P1-107 | Explicit slash skill invocation semantics | P1 | Delivered (2026-03-17) | Users should be able to force a skill via direct slash form such as `/skill-name` or `/skill-name@bot`; matching must be case-insensitive and normalize spaces, `_`, and `-`; runner should pass an authoritative explicit-skill marker into the model input so prompt behavior and MCP skill-gating follow the same invocation decision |
| P1-108 | Bot-scope skill path authority and SKILL.md execution safety | P1 | Delivered (2026-03-18) | When explicit skill invocation targets a bot-scoped skill, runner context must include the exact resolved `skill_file` path so the model does not fall back to guessed global paths; skill protocol must explicitly forbid executing `SKILL.md` itself via shell and require reading it before running declared scripts |
| P1-109 | Periodic running lock and slot-level dedupe | P1 | Delivered (2026-03-20) | Events watcher must acquire a persistent `running` lock before dispatching periodic jobs, dedupe per cron minute slot (`lastSlotKey` / `runningSlotKey`), and guard completion/error writes by run id so file status updates cannot re-trigger the same slot repeatedly |
| P1-110 | BOT.md prompt merge enforcement | P1 | Delivered (2026-03-20) | Prompt builder must merge `BOT.md` into final system prompt output (not only source discovery), preserving bot-scope instruction precedence and ensuring bot-level guardrails are active at runtime |
| P1-111 | Settings task edit workflow | P1 | Delivered (2026-03-20) | `/settings/tasks` should support inline editing and save-back of task config (`text`, `delivery`, and type-specific schedule fields) through a validated backend update API, so operators can adjust existing tasks without manual JSON file edits |
| P1-112 | Settings task edit textarea build compliance | P1 | Delivered (2026-03-20) | `/settings/tasks` inline edit input must use explicit `<textarea></textarea>` markup (not self-closing form) so Svelte SSR/client production builds are warning-free and standards-compliant |
| P1-113 | WeChat channel integration | P1 | Delivered (2026-03-22) | Operators can configure `/settings/weixin`, enable a WeChat bot instance, complete QR login through the npm-installed SDK, and reuse the shared chat runtime (sessions, model switching, skills, compaction, OAuth commands) for inbound WeChat conversations without touching core runner architecture |
| P1-114 | WeChat login QR helper in settings | P1 | Delivered (2026-03-22) | Operators can paste the WeChat SDK login URL from runtime logs into `/settings/weixin` and immediately render a scannable QR code in the browser, so phone login does not depend on opening or forwarding the raw link manually |
| P1-115 | Telegram forum topic intake and topic-scoped reply continuity | P1 | Delivered (2026-03-24) | Telegram forum-topic messages should be accepted without mandatory `@bot` mention gating, runtime should preserve `message_thread_id` on status/messages/media replies so responses stay inside the originating topic, and each topic should maintain an isolated runtime/session scope instead of sharing one supergroup context |
| P1-116 | Custom provider controllable thinking support | P1 | Delivered (2026-03-24) | Runtime should stop treating `reasoning: true` as a fake thinking switch, read a real default thinking level from settings, map `off/low/medium/high` into provider-specific request fields for custom providers, and keep the legacy assistant path behavior aligned with the main agent runner |
| P1-117 | ACP settled-history progress display and ACP-first proxy routing | P1 | Delivered (2026-03-24) | ACP channel progress should preserve recent completed/failed history without persisting transient `pending` chatter, Telegram should keep a compact single edited progress message plus separate final summary, and active ACP sessions should proxy slash-style input to the remote agent unless the message is a reserved ACP control command |
| P1-118 | Web chat visible thinking controls and traceability | P1 | Delivered (2026-03-24) | Web chat should expose a per-send thinking selector (`off` / `low` / `medium` / `high`), pass that choice into the runner request, and display enough request/payload/thinking trace information for operators to verify whether reasoning was requested and whether any thinking stream was actually returned |
| P1-119 | Runner-level delta streaming parity for Web and Telegram | P1 | Delivered (2026-03-24) | The shared runner should consume assistant `message_update` deltas from the upgraded agent runtime so Web text chat can stream through the real runner path with a collapsible thinking panel above the answer, and Telegram can render incremental output with batched edits, no duplicate fallback sends, and observable thinking diagnostics instead of per-delta updates that trigger rate-limit stalls |
| P1-120 | Telegram session status command and session-local thinking control | P1 | Delivered (2026-03-25) | Telegram should expose `/status` and `/state` for current session/runtime/model visibility, and `/thinking <default|off|low|medium|high>` must override thinking depth only for the active session so future new sessions still inherit the global default |
| P1-121 | Shared public channel-command ownership | P1 | Delivered (2026-03-25) | Public text-channel commands and session-control behavior should be owned by agent core instead of being reimplemented in each channel runtime; Telegram/Feishu/QQ/Weixin must keep only channel-local parsing, attachment handling, and reply transport while shared command/session/model/thinking flows live in one reusable layer |
| P1-122 | Skill-first prompt rules and slash skill alias resolution | P1 | Delivered (2026-03-25) | The runtime prompt should use generic skill-loading semantics instead of hardcoded skill names, treat slash skill forms as authoritative explicit invocation, and resolve them against both frontmatter `name` and runtime alias forms such as the skill directory name so the model receives the exact `skill_file` path rather than guessing |
| P1-123 | Dedicated-tool-first execution and memory governance prompt policy | P1 | Delivered (2026-03-25) | Runtime/system prompt guidance should prefer dedicated runtime tools over bash when equivalent, require parallel execution for independent tool calls, and define practical memory governance (what to store, what not to store, stale-memory verification/update) so behavior stays predictable across long-lived sessions |
| P1-124 | Prompt mainline prioritization and dynamic payload trimming | P1 | Delivered (2026-03-25) | The live runtime prompt should front-load stable high-value behavior rules before environment/detail sections, compress skill inventory into an index instead of long prose, and trim injected current-memory payloads so dynamic noise does not drown the core instructions that drive task execution |
| P1-125 | Memory write-time classification and prompt eligibility filtering | P1 | Delivered (2026-03-26) | Memory should be classified when written, not only when displayed: long-term collaboration/project/reference memories must be tagged automatically, temporary and lifestyle records must be isolated by default, and prompt injection should prefer high-value classes while still allowing relevant lifestyle memory to surface when the current query actually concerns it |
| P1-126 | General-purpose agent prompt hardening | P1 | Delivered (2026-03-26) | The runtime prompt should not assume a coding-only workload. It must explicitly frame task types, verify fresh/current information before answering, resist prompt injection from fetched content, and require confirmation for broader high-impact actions such as external posting, credential/config changes, and destructive runtime edits |
| P1-127 | Profile template responsibility cleanup | P1 | Delivered (2026-03-26) | Long-term profile templates should have clean boundaries: AGENTS for collaboration contract, IDENTITY for stable role, SOUL for communication style, USER for collaboration-relevant user facts, BOOTSTRAP for minimal init residue only. Repeated runtime rules and low-value personal noise should be removed so these files stop competing with the main system prompt |
| P1-128 | Existing-capability-first routing | P1 | Delivered (2026-03-26) | The agent must treat requests for voice/image/search/reminder output as result requests first, not as implementation asks. Installed skills and dedicated runtime tools must be attempted before any code-writing or workspace modification is considered, and a missed first guess must not immediately escalate into development work |
| P1-129 | Shared text-channel runtime skeleton | P1 | Delivered (2026-03-27) | Text-channel runtimes should share queue/dedupe/stop/prompt-preview/session-append/context assembly where behavior is truly common, while Telegram-specific streaming/status/topic/interactive behavior remains channel-owned instead of being flattened by an over-generic base class |
| P1-130 | Weixin outbound delivery audit and retry | P1 | Delivered (2026-03-28) | When Weixin outbound send fails or stalls, operators should be able to tell whether the bot tried to send, whether it retried, and whether it finally succeeded or failed. Text sends should automatically retry transient failures, and each chat should keep a local delivery audit trail independent of the model context file |
| P1-131 | Model runner logging must not interfere with response capture | P1 | Delivered (2026-03-28) | Shared runner observability must never wrap or mutate the low-level model event stream in a way that can affect response capture. First-token timing should be derived from real assistant delta events, and pretty terminal logs must only activate through explicit configuration instead of implicit TTY detection |
| P1-132 | Bash tool Python virtualenv isolation | P1 | Delivered (2026-03-29) | Agent `bash` executions should always run Python-related commands (`python/pip/uv`) in one dedicated runtime-managed virtualenv, with shared cache/env variables, so dependency installs no longer pollute the host global environment or fragment into per-directory unmanaged envs |
| P1-133 | Bot profile editing tool with hierarchical bootstrap | P1 | Delivered (2026-03-29) | Runtime should provide a dedicated profile tool to read/bootstrap/write/edit bot-level profile files (`BOT/SOUL/USER/TOOLS/IDENTITY/SONG`) and auto-initialize missing bot files from agent scope first, then global scope, so bot-specific tuning does not mutate shared agent/global profiles |
| P1-134 | Telegram stalled-request timeout and auto-retry continuity | P1 | Delivered (2026-03-29) | Telegram outbound API calls should have per-attempt timeout protection so transient socket hangs do not freeze status-message updates forever; timed-out attempts must be treated as retryable and continue through the existing retry/backoff path |
| P1-135 | Python sandbox execution hard-binding for bash tool | P1 | Delivered (2026-03-29) | Bash tool should force all `python/pip/pip3` invocations onto one managed virtualenv, auto-repair missing pip in that env, and tolerate system-only install flags so skill dependency bootstrap can run reliably without leaking into global Python |
| P1-136 | Settings task inventory cross-channel parity | P1 | Delivered (2026-03-31) | `/settings/tasks` and `/api/settings/tasks` must cover all built-in channels (`telegram`/`feishu`/`qq`/`weixin`) rather than Telegram-only roots, with channel-aware listing/validation and trigger dispatch through the correct channel manager |
| P1-137 | Prompt context layering hardening | P1 | Delivered (2026-03-31) | System prompt should separate identity overlays (`SOUL.md`/`IDENTITY.md`) from generic instruction files, inject prioritized workspace context file discovery (`.hermes.md -> AGENTS.md -> CLAUDE.md -> .cursorrules`) with prompt-injection safety scan/truncation, cache formatted skill index for rapid refreshes, and expose detailed source observability including identity/project-context sources |
| P1-138 | Deterministic explicit skill invocation matching | P1 | Delivered (2026-04-04) | Explicit skill invocation should be stable when users place `/skill` commands in the middle of sentences, use `$skill` or language-agnostic label forms (`label:skill`, `/label skill`), or hit alias collisions; runtime must normalize aliases consistently, avoid URL-like false positives, and resolve conflicts deterministically with clear precedence (`exact name` then `chat > bot > global` scope) without binding behavior to one natural language |
| P1-139 | Telegram outbound timeout crash guard | P1 | Delivered (2026-04-14) | When Telegram outbound retries are exhausted and even fallback error notifications time out, the run should fail with logs only; timeout handling must never rethrow from cleanup/error-reporting paths or terminate the whole service process |
| P1-140 | Silent run-summary chat policy | P1 | Delivered (2026-04-14) | Normal chat runs should not append operator-style run summaries to the user conversation; only runs that actually save a reusable draft may send one short draft notice, while full run metadata remains stored internally for review |
| P1-141 | Skill Drafts bot-folder dedupe | P1 | Delivered (2026-04-14) | The Skill Drafts inventory must treat `bots/<bot>/skill-drafts` as one bot-level folder, not one folder per chat, so the same draft file appears only once even when a bot has multiple chat directories |
| P1-142 | Session token visibility and QQ voice media routing | P1 | Delivered (2026-04-18) | Shared `/status` must show current session context size plus accumulated session token usage so operators can judge compaction/cleanup, and QQ outbound media must recognize audio resources as voice replies instead of degrading remote audio into generic attachments |
| P1-143 | QQ local audio must prefer explicit voice-format upload | P1 | Delivered (2026-04-18) | For QQ single/group chats, local audio replies must be converted into a clearly recognizable voice format before upload instead of bare `file_data` passthrough of `mp3/wav`, because otherwise the platform may render the payload as a generic file attachment rather than a voice message |
| P1-144 | QQ AIFF audio classification parity | P1 | Delivered (2026-04-18) | QQ outbound media classification must treat `aif/aiff` as audio, not generic files, otherwise AIFF-based TTS outputs in single chats degrade into file attachments before the voice upload path even starts |

### P1-117 Implementation Note (2026-03-24)
- Telegram ACP middleware must not keep any stale direct reference to the old local control-command helper once proxy gating is centralized through the shared ACP proxy rule, otherwise bot startup can fail before ACP routing is reached.
- Telegram ACP session identity and permission handling must use the same topic-scoped Telegram conversation key as the main runtime. Using only the raw `chatId` is not sufficient for forum topics because it merges distinct topic sessions, approvals, and progress replies back into one supergroup-level ACP state.

### P1-119 Implementation Note (2026-03-24)
- Web-side visible thinking is only trustworthy if the trace block stays attached to the assistant reply itself, above the final answer, and remains operator-controllable via collapse/expand instead of always-open raw text.
- Telegram live streaming must batch intermediate edits on a fixed cadence and skip over long server-requested retry waits for non-final status edits; otherwise one over-eager delta stream can degrade into multi-minute reply lag after a single 429.
- Telegram stream rendering must not treat every edit failure as permission to send a brand-new copy of the same answer; only a genuinely missing edit target should reopen a fresh message, otherwise one transient edit error can multiply a single reply into several duplicate Telegram messages.

### P1-120 Implementation Note (2026-03-25)
- Session-local thinking changes must persist with the session itself, not in global runtime settings, otherwise switching one Telegram conversation would silently mutate every other session and every future new session.
- `/status` needs to report the next-request reality, not just raw config fragments: active session id, queue/running state, active route models, global default thinking, session override, and the effective next-request thinking level after model capability downgrade.

### P1-121 Implementation Note (2026-03-25)
- Text-channel runtimes should keep only channel-specific concerns: inbound message parsing, attachment/media normalization, transport-local reply/edit behavior, and platform-only commands such as `/chatid`.
- Shared public commands (`/new`, `/clear`, session switching, model switching, OAuth auth commands, status, thinking depth, help, skills, compaction) must be implemented once in agent core and reused by Telegram, Feishu, QQ, and Weixin.
- Session mutations triggered through shared commands must still allow each channel to run local side effects such as prompt-preview refresh, but that callback must stay optional and channel-owned.

### P1-122 Implementation Note (2026-03-25)
- Skill routing prompt rules must stay generic. They should describe how to honor installed skills and explicit invocation, but must not hardcode project-specific skill names into the runtime prompt builder.
- Slash skill invocation must not depend only on `SKILL.md` frontmatter `name`. Directory-name aliases are part of operator reality, so matching and prompt context should carry both the canonical name and aliases, along with the exact resolved `skill_file` path.


### Later (P2)
| ID | Feature | Priority | Phase | Acceptance Criteria |
|---|---|---|---|---|
| P2-01 | New channels (WhatsApp/Lark/Slack) | P2 | V2 | New adapters added without core pipeline change |
| P2-02 | Cross-channel identity linking | P2 | V2 | User can merge identities across channels |
| P2-03 | Long-term memory (vector DB) | P2 | V2 | Retrieval-augmented memory improves continuity |
| P2-04 | Admin dashboard | P2 | V2 | Operator can inspect sessions/errors and run controls |

## 4. Out of Scope (V1)
- WhatsApp/Lark/Slack production integration.
- Autonomous multi-step agent planning loops.
- Enterprise permission model and RBAC.


## 5. Technical Approach (Plain Language)
- Build one central backend that understands a single message format.
- Every channel gets a thin adapter: transform inbound message into unified format, then transform response back.
- Telegram adapter is implemented with `grammY` to reduce webhook/update handling complexity.
- Use pi-mono runtime for LLM interaction.
- Store conversations in SQLite so users can continue sessions.

## 6. Dependencies and Decisions Needed
- Telegram Bot token and webhook URL.
- Telegram bot library: `grammY` (`grammy` npm package).
- LLM provider/API key configuration.
- Deployment environment (single VM or container platform).

## 7. Complexity Assessment
- Overall: **Medium**.
- Highest risk: stable channel delivery and production error handling.

## 8. Release Definition (V1)
V1 is complete when a user can chat with Molibot from Telegram, CLI, and Web with consistent behavior and persisted session history.

## 9. Documentation Structure (Current)
- `readme.md`: project entry and document navigation.
- `DESIGN.md`: page/UI design baseline and visual rules; page-facing changes should treat it as the design source of truth.
- Frontend component rule: unless the current `shadcn-svelte` system truly cannot express the needed UI, page-facing work should prefer `src/lib/components/ui` primitives and existing shadcn-style composition instead of introducing non-shadcn replacements.
- `prd.md`: product scope, priority, and acceptance criteria.
- `architecture.md`: V1 architecture and sprint plan.
- `features.md`: implementation status and change log.
- `docs/guides/plugins/plugin-development.md`: plugin development contract, lifecycle, config shape, and current discovery/runtime boundaries.
- `AGENTS.md`: collaboration and process constraints.
- Documentation sync rule: `readme.md` must reflect current implemented behavior; when implementation and docs diverge, use `features.md` + actual code/runtime behavior as source of truth and refresh README accordingly.
- Validation status rule: distinguish clearly between `implemented` and `validated in real usage`; do not describe channels/features as “stable/available” unless they have been actually verified in this project usage context.
- Skills provisioning rule: default behavior is manual installation by user; if project-local reusable skills are provided, README must include explicit copy/install commands to `${DATA_DIR}/skills`.
