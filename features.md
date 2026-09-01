# Molibot Features

## Archive Index / 归档索引
- [2026 Q2 Features Archive (Apr - Jun)](docs/archive/features-archive-2026-Q2.md)
- [2026 Q1 Features Archive (Feb - Mar)](docs/archive/features-archive-2026-Q1.md)
- [2026 Q3 Features Archive (Jul - Sep)](docs/archive/features-archive-2026-Q3.md)

## 2026-09-01

### Desktop 图标库统一迁移到 Reicon（已交付）

- **范围**：Desktop 外壳、聊天、设置、项目文件树、Artifact、Mini Apps，以及图片灯箱和 Markdown 表格等原始 DOM/HTML 边界，全部从 `@phosphor-icons/web` 字体类迁移为 `reicon-svelte` 图标组件或类型安全的 Reicon SVG 边界映射。
- **实现**：普通图标统一使用 `reicon-svelte/icons/*` 子路径导入；动态状态、菜单和文件类型图标改为显式组件/语义映射；保留现有语义、尺寸、颜色、旋转、减弱动效和无障碍属性；移除 Phosphor 字体入口、专用 CSS、依赖和 lockfile 记录。
- **验证**：Desktop UI 结构测试 219/219、完整 Desktop 测试、`svelte-check` 0 error / 0 warning、Desktop 与 root production build 全部通过；应用内预览已走查聊天、设置、明暗主题、中英文、自动任务和 Mini Apps，页面无旧图标节点。

## 2026-08-29

### 用量 / Trace / 服务日志页宽度对齐标准设置列（已交付）

- **问题**：三个页面被当作"data page"放宽到 720px（页头走 `dataPage`、用量/Trace 卡片走 `[data-section]` 覆盖、图表容器走 `--data-content-width`），与其它设置页的 576px 标准列不一致；服务日志页自身也不一致（页头 720px、卡片 576px）。
- **修复**：删除 `settings-scroll[data-section="trace"/"usage"] > .settings-card` 宽度覆盖；`chart-kpi-grid` / `chart-split` / `usage-detail-grid` 宽度统一改用 `--settings-col`；`App.svelte` 的 `PageHeader` `dataPage` 只保留 memory（记忆中心仍是 720px 数据列，本轮未动）。顺带删除无组件引用的死 class `usage-split` 及其响应式残留。
- **规范同步**：`DESIGN.md` 三处描述更新——设置内容（含用量/Trace/服务日志）统一 576px，仅记忆中心使用 720px 数据列；过滤器工具栏描述中的"720px data column"改为标准设置列。
- **验证**：svelte-check 0/0、`vite build` 通过、node UI 测试 220/220；静态走查页确认 576px 下 KPI 四卡一行、过滤器四字段一行、双列图表布局正常（与运行历史页同构，观感一致）。

### 沙箱设置页预设卡片布局修复（已交付）

- **根因**：`SandboxSection` 重构（b9214414）时组件 class 更名为 `sandbox-spectrum-card` / `sandbox-tier-grid` 等，但 `styles.css` 仍停留在旧名（`sandbox-tier-cards`、`sandbox-presets-panel`、`sandbox-section-head`、`sandbox-form`），导致四张预设卡片失去网格布局，按按钮 shrink-to-fit 宽度竖向堆叠（用户截图所示乱象）。
- **修复**：`styles.css` 双向同步——新增 `sandbox-spectrum-card`（卡片内边距 + 纵向 flex）、`sandbox-spectrum-title-row`（标题/提示排版，覆盖 `settings-section-hint` 全局宽度）与 `sandbox-tier-grid`（2×2 网格，576px 内容列下 4 列过挤）；删除全部无组件引用的旧 sandbox class 及其在响应式/减弱动效块中的残留（含 `sandbox-preset-card`）。
- **响应式**：默认 2 列；≤820px（设置页窄布局断点）与 ≤440px 降为 1 列。
- **验证**：svelte-check 0/0、`vite build` 通过；以真实 `styles.css` + 组件 DOM 结构搭建静态走查页，1200px 与 680px 两档宽度截图核对网格、选中态、标签换行与滑杆均正常。
- **遗留（守卫）**：该根因（组件改 class 名、CSS 未同步）为首次出现，按流程暂不加机器守卫；可行的守卫方向已评估——"used-but-undefined" 全仓扫描需维护约 160 项白名单（图标库/JS 锚点类误报），"defined-but-unused" 需先分诊约 200 条存量死规则（hljs/d2h 库类、动态拼接类豁免），立项后再做。

### Web Interface Guidelines 合规第二轮：共享层键盘导航 / 读屏反馈 / Intl 格式化 / 真实 bug 修复（已交付）

- **逻辑 bug 修复**：`RunActivity.svelte` 的 `isFailed` 第二子句与 `hasRunning` 恒等（恒 false），声明的 `hasError` 从未使用，导致活动级 error 状态永远不显示失败——改为 `failed || hasError`。
- **共享键盘导航 action**：新增 `lib/a11y/tablist.ts`（方向键/Home/End 移动焦点并激活、跳过禁用项，`use:tablist` 默认 `[role="tab"]`，可传 `'[role="radio"]'` 复用于 radiogroup），应用到 18 处 tablist（ArtifactPanel×4、Providers×3、Tasks、Trace、Usage、ImageSettings、FileSearchPanel、ProjectSettingsDialog、MiniAppsManager、D2/Mermaid/Spreadsheet）与 2 处 radiogroup（App.svelte、SandboxSection，含 roving tabindex），全部补齐 `aria-controls`/`role="tabpanel"`/`aria-labelledby` 关联。
- **读屏反馈**：约 35 处异步保存/操作反馈、错误提示补 `aria-live="polite"` / `role="alert"`；`RecordingBar` 的 live region 不再包裹每秒跳动的计时器；`PendingFilesBar` 移除按钮的 accessible name 携带文件名；`DurableExecutionCard/Inspector` 进度条补 `role="progressbar"` + `aria-valuenow/min/max`。
- **无效 ARIA 清理**：Providers/Tasks 的 `listbox>option(button)` 无效嵌套角色移除；`ConversationRow` 重构为真实 `<button class="row-open">` 主表面 + 菜单按钮兄弟节点（消除 interactive-in-interactive），行菜单补 Escape/方向键与焦点管理；`DecisionCard` 误用的 `role="alertdialog"` 移除；`FileTreeNode` 移除断裂的 tree 角色并支持 Shift+F10/ContextMenu 键打开右键菜单；`TranscriptAttachments` 四处右键专属操作补键盘路径。
- **Intl 格式化统一**：新增 `formatTimestamp` / `formatDuration`（`lib/presentation.ts`，基于 `Intl.DateTimeFormat`/`Intl.NumberFormat`），替换 ImageGenerate/Memory/VideoGenerate 的 ISO 手工切片日期（10 处）与 chat 侧 5 处手搓时长格式化；`ModelsSection` K 值、`MemoryTraceDrawer` 百分比、`MiniAppsAiSettings` 秒数、`fileIcons.formatSize` 同步改 Intl。
- **弹层滚动收敛**：`settings-scroll`/`modal-body`/`browser-body`/`project-settings-body`/`command-palette-results`/`agent-city-search`/`memory-trace-body`/`preview-body`/`onboarding-card`/`durable-inspector-scroll` 补 `overscroll-behavior: contain`。
- **动效降级补漏**：全局 `prefers-reduced-motion` 块补齐 6 个遗漏的 infinite 动画（automation-spinner、project-spin×2、activity-spin×2、provider-auth-pulse）与 `mention-menu`；`DurableExecution` 进度条从 `transition: width` 改为 `transform: scaleX`。
- **破坏性操作确认**：生图/视频媒体任务删除与排队消息移除改为两步确认（首次点击武装、再次点击执行、失焦解除）。
- **未保存离开守卫**：新增 `lib/unsavedGuard.ts`（beforeunload 引用计数守卫），9 个设置页按各自 dirty 条件接入，窗口关闭/刷新不再静默丢弃未保存更改。
- **X 关闭按钮语义**：新增 `dialogClose` i18n key，22 处 modal 关闭按钮 aria-label 从 "取消" 改为 "关闭"（读屏不再出现两个"取消"）。
- **文案与杂项**：i18n 中 14 处加载/搜索文案 `...` → `…`、20+ placeholder 补省略号（保留 `mcpMapPlaceholder` 示例 token 等字面模式）；SlashSuggestionMenu 硬编码英文分组标题/aria-label 接入 i18n（新 key `slashMenuLabel`/`slashGroup*`）；`observatory` 原生 select 补显式背景/前景色（暗色适配）；`index.html` 补 `theme-color`（明暗双份）；`initialLocale` 改用 `navigator.languages` 链；`diag-value`/`host-bash` 统计数字补 `tabular-nums`；`chat-ui.test.mjs` 过时的 `role="listbox"` 断言更新为 tablist/tabpanel 结构断言。
- **验证**：svelte-check 0 错误 0 警告；tsx 单测 233/233、node UI 测试 224/224、`vite build` 通过。
- **有意跳过（已立项）**：大列表虚拟化（CSV/JSON/表格 5000 行、Trace 排行分页、Usage 移动端双份渲染）、PluginsSection 阻塞式 confirm 换应用内弹窗、MemorySection 过期时间输入校验——立项至 `prd.md` §3.130，不在本 slice 混做。

### 图标库统一迁移到 Reicon（Web 端 + Mini Apps，已完成）

- **Web 主应用**：`@lucide/svelte` → `reicon-svelte`（7 个文件、10 个图标：shadcn select/checkbox 的 ChevronDown/ChevronUp/Check/Minus、设置页 Cpu/MessageSquare/BookOpen/Settings、Provider 页 Eye/EyeSlash），全部使用 `reicon-svelte/icons/*` 子路径导入；`EyeSlash` 在 Provider 页以 `EyeOff` 别名导入，JSX 用法零改动。
- **Mini Apps**：`@heroicons/react` → `reicon-react`（mini-chat 8 个、prompt-box 20 个图标），heroicons 名称通过导入别名映射到 Reicon（如 `Xmark as XMarkIcon`、`Refresh as ArrowPathIcon`），JSX 与 `width/height/strokeWidth/className` 用法零改动（reicon props 透传已核实）。
- **依赖清理**：移除 `@lucide/svelte` 与 `@heroicons/react`；两个 Mini App 的 `THIRD_PARTY_NOTICES.md` 补充 Reicon（MIT）与 Solar Icons by 480 Design（CC BY 4.0）署名；native-select 中引用旧库名的注释同步更新。
- **上游缺陷规避（已记入 CLAUDE.md pitfall 45）**：`reicon-svelte@1.0.102` barrel `index.js` 存在 `Icon` 重复导出，Rollup 生产构建直接失败（`Duplicate export "Icon"`）；因此全仓强制 `reicon-svelte/icons/*` 子路径导入，子路径组件不依赖 barrel。`reicon-react` 无此问题。
- **Desktop 当时未迁移**：`@phosphor-icons/web`（CSS 字体方案，91 文件/165 图标/99 行 `.ph` CSS）迁移复杂度高（动态图标名组件 API 重设计 + 样式体系重做 + 守卫测试重写），当时立项为 `prd.md` §3.129 独立 slice；该 slice 已于 2026-09-01 交付，见上方条目。
- **验证**：root production build 通过；mini-chat/prompt-box esbuild 构建通过，产物 tree-shaking 生效（仅 73 行 diff）、无 heroicons 残留；全仓无 `@lucide`/`@heroicons` 引用残留；构建产物确认包含 reicon 组件。设置页与两个 Mini App 的真实冷启动走查待产品验收。

### Desktop 设置与客户端 Web 界面设计规范全面对齐（P0 / P1 / P2 已交付）

- **Web Interface Guidelines 全局审计与修复**：对照 Vercel Web Interface Guidelines 与 `DESIGN.md` 规范，对 `apps/desktop` 全仓进行了系统级合规审计与专项修复：
  - **表单体验与密码管理**：非认证技术/配置/搜索输入框全面显式声明 `autocomplete="off"`，所有密码/API Key 输入框统一显式声明 `autocomplete="new-password"` 与 `spellcheck="false"`，所有代码/URL/ID 字段禁用拼写检查。
  - **无障碍（A11y）与辅助技术支持**：全部纯装饰性图标元素（`i.ph*`、`i.ph-fill*`）补齐 `aria-hidden="true"`；遮罩与装饰层标注 `role="presentation"`；所有表单输入（含数字输入与动态插件表单字段）补齐 `aria-label` / `ariaLabel`。
  - **排版规范统一**：代码与界面占位符中省略号全面规范为标准 Unicode 省略号字符（`…`，U+2026），杜绝连续英文句点（`...`）。
  - **防布局偏移（CLS）**：全仓静态与头像类 `<img>` 标签补齐显式 `width` 与 `height` 属性（如 `ChatSidebar`、`ConversationLiveView`、`ConversationTranscript`、`MiniAppIcon`、`ProjectList`、`OpenConnectorSection`、`PluginsSection`）。
- **设置容器宽度规范（P1）**：按照 `DESIGN.md` §420 布局规范，将 Desktop 设置页内容容器宽度 `--settings-content-width` 从 720px 统一校准为 576px（文本/表单最优可读宽度），同时保留数据与图表视图 `--data-content-width: 720px` 与聊天流 `--message-content-width: 720px`。
- **组件结构统一（P1）**：全量迁移 Desktop 12 个设置子页面中的零散 `.settings-card`，统一采用标准化语义容器 `<SettingGroup>` / `<SettingRow>` 进行重构（涵盖 `WebSearchSection`、`ImageGenerateSection`、`ImageRecognitionSection`、`VideoGenerateSection`、`TtsGenerateSection`、`SkillsSection`、`AgentsSection`、`ProfilesSection`、`ChannelsSection`、`McpSection`、`RuntimeEnvSection`、`SandboxSection` 以及 `App.svelte` 诊断面板），并保留顶部动作插槽（`agentAdd` / `profileAdd` / `channelAdd` / `mcpAdd` / `diagnostics`）。
- **多语言文案修复（P0）**：修复生图、视频生成、语音合成设置页面中因复制粘贴导致的 `webSearchEnabled`、`webSearchDefaultEngine`、`webSearchApiKey` 错乱问题，补齐中英文对应键值。
- **Switch 控件规范（P0）**：彻底移除 `ModelsSection.svelte` 与 `ChatView.svelte` 中遗留的手写 `<button class="switch">`，统一使用共享的 `<IosSwitch>` 组件，并通过前端单元测试回归守卫。
- **状态指示本地化（P0）**：`ProvidersSection` 列表项状态（`ON` / `OFF`）适配多语言。

## 2026-08-28

### Markdown 产物预览重构（已完成）

- 聊天气泡「隔离预览 HTML / SVG」与表格查看器弹窗重构为与图片灯箱一致的全屏观感：78% 黑色遮罩 + 近全屏浮动舞台（12px 圆角、弹性缩放入场），替代原先 900×720 的标题栏小窗。
- 预览页脚本可用性修复：iframe 从空 `sandbox` 改为 `sandbox="allow-scripts"`，仍不带 `allow-same-origin`，预览页无法访问宿主 DOM、Cookie 与存储。
- 表格查看器新增表头点击排序（升序 → 降序 → 取消，`aria-sort` + 方向指示），比较器在共享 `csvTable.ts`：数值/百分比/千分位按数值比较，其余按本地化字符串比较，并覆盖排序回归测试。
- 全屏表格查看器使用大号排版（13px、宽松内边距，`CsvTable` 新增 `large` 模式）；Artifact Inspector 内保持紧凑密度。
- 聊天 Markdown 表格的「在表格查看器中打开」按钮移入表头行末单元格（图标 + 本地化 tooltip），`wrapTables` 注入每个表格表尾 `</th></tr></thead>` 缝隙，多表格逐一生效。
- 舞台内容上方悬浮格式标签（HTML / CSV）与圆形关闭按钮（复用 `closePreview` 文案，带 focus-visible 焦点环）；入场动画进入 `prefers-reduced-motion` 降级清单。
- 覆盖选择器与 `.desktop-dialog-*` 基类成对书写，避免同文件后置基类在同等优先级下覆盖宽高（旧实现因此静默塌缩到 560px 默认宽度）。

## 2026-08-27

### 本轮文件并发打开稳定性（修复，P1）

- Artifact Inspector 挂载刷新与用户点击同一本轮文件并发时，点击操作直接使用自己取得的 Session 文件结果，不再因共享列表尚未落盘而误报“文件当前不可用”。
- 回归守卫覆盖面板初始化刷新与点击刷新交错的路径；已有文件定位、越界拒绝和 scratch 产物测试继续通过。

### Desktop 会话检索、渐进历史与 Agent 快速开始（已完成）

- 左侧栏折叠按钮旁提供统一会话搜索入口；默认同时检索 Web、Project 与外部渠道，也可按来源筛选，结果按来源分组并各自分页。
- 搜索结果展示所属 Agent、Project 或渠道 Bot、匹配摘要与时间；点击后进入对应 Web/Project Session，外部渠道保持只读。
- 各会话渠道默认展示 10 条记录；点击“更多对话”按游标原地追加 10 条，并在后台刷新时保留已经展开的记录。
- 空白 Agent 会话提供三个轻量快速开始入口，只把提示填入并聚焦输入框，不会自动发送或把空状态改造成仪表盘；交互支持中英文、明暗主题与窄窗口。

### Pi P1–P3 产品能力接入（已完成）

- **P1 Provider registry**：Web API、Desktop API 与设置 schema 共用 Pi 模型目录作为内置 Provider 真相源，新增 Provider 和模型无需再同步静态列表。
- **P2 请求级 sampling**：自定义模型可保存任意 JSON sampling 参数，Web/Desktop 中英文编辑和校验、SQLite 重启 round-trip、Desktop 窄投影与 Pi runtime 传递均已打通。
- **P2 终止诊断**：`model.call.after` 保留 Pi 返回的 `rawStopReason` 与 `endTurn`，用于区分 Provider 终止和显式结束轮次。
- **P3 telemetry context**：Pi 请求 span 按 run/model attempt 关联到现有 Trace，包含 Provider、模型、API、用量/成本、chunk/首 chunk 耗时、HTTP 状态和错误诊断；不新建第二套观测系统。

## 2026-08-26

### Pi Runtime 0.84.3（已完成，P1）

- 共享 `pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 运行时从 0.82.0 升级到 0.84.3，主 Agent、子 Agent、模型路由、认证和 compaction 继续共用同一上层边界。
- 内置 Provider 自动获得提前刷新 OAuth、可取消认证与模型目录请求、严格工具 schema、reasoning/tool replay、截断恢复和新模型目录等上游修复。
- OAuth 并发回归按新的 5 分钟提前刷新窗口校准；替换凭证必须越过该窗口，才能验证多个等待者只触发一次刷新。

### AI 回复分叉入口恢复（修复，P1）

- 主 Chat 与 Project Chat 的 AI 回复操作栏恢复 Fork；子 Session 包含所选 AI 回复，父 Session 不变。
- 用户消息操作栏继续只显示复制与编辑，不重新引入此前移除的 Fork。
- 分叉请求在途时按钮进入忙碌态并阻止重复提交；运行中 Session 与过期消息沿用现有中英文错误提示。

### 普通 Session scratch 产物自动登记（修复，P1）

- 普通 Session 的 `write/edit` 成功后，scratch 文件回执直接进入本轮文件卡片和右侧 Artifact Inspector，不再要求 Agent 额外调用 `attach`。
- 文件仍保留在 Session scratch 中；`attach` 只负责向渠道发送附件，不再承担产物是否可见的隐式开关。
- Session 文件接口根据持久化回执定位最终磁盘内容，HTML 可直接预览；失败写入、越界路径和不存在的文件不会进入列表。
- 回归覆盖 Runner scratch 回执、SSE 投影、消息持久化 round-trip、文件定位，以及回复卡片与右侧面板的同一列表映射。

## 2026-08-25

### 本轮文件产物清单（已完成，P1）

- Agent 回复末尾新增本轮文件卡片，以一个扁平列表展示成功创建或更新的文件，不依赖 Git 快照，也不按状态分区。
- 工具层产物回执会随活动消息持久化；同一文件本轮先创建再修改时仍归为“创建”，失败写入不会展示。
- 点击卡片标题可在右侧 Artifact Inspector 查看完整列表，点击文件可打开当前最终内容；普通 Session 的生成附件也使用同一路径。
- 过程时间线不再重复展示写入文件，只保留读取上下文；界面支持中英文与明暗主题。
- 已进入本轮文件卡片的生成附件不再在回复底部重复渲染；普通 Session HTML 可经原生 Artifact transport 在右侧正常预览。

### HTML 产物直达预览与首轮会话标题稳定更新（已完成，P1）

- Project 中新写入的 `.html`、`.htm` 与 `.xhtml` 从活动文件入口及 follow-the-agent 链路直接进入右侧 Artifact Inspector 的沙箱预览，不再因新文件缺少 Git diff 而显示空白；其它写入文件继续默认打开差异视图。
- AI 会话标题只在 Session 的第一条用户消息后尝试生成。后续轮次即使标题仍为默认值，也不会再次调用标题模型或发送标题更新事件。
- 对话完成后的 Session 列表仍会在后台同步排序和时间，但保留现有行，不再用加载占位替换整组列表。
- 回归覆盖 HTML 打开策略、非首轮标题跳过和后台列表静默刷新；Desktop UI 守卫 212/212 通过。

## 2026-08-23

### 服务器默认端口由 3000 调整为 3040（已完成，P1）

- **背景与目标**：
  - 避免默认端口 `3000` 容易与其它常见 Web 服务（如 React/Next.js/Grafana 等）冲突，将 Molibot 默认监听与配置端口提升并统一为 `3040`；
- **改动范围与实现**：
  - 服务端配置与环境：`src/lib/server/app/env.ts` 与 `src/lib/server/settings/defaults.ts` 中的 `PORT` / `serverPort` 默认值调整为 `3040`；
  - 脚本与工具层：`scripts/runtime/service-port.mjs` 中的 `DEFAULT_SERVICE_PORT` 调整为 `3040`；`bin/molibot-manage.js` 默认 `PORT` 更新为 `3040`；
  - 桌面端守护与 UI：`apps/desktop/src-tauri/src/supervisor.rs` 中的 `DEFAULT_PORT` 调整为 `3040`；`apps/desktop/src/App.svelte` 与 `apps/desktop/src/lib/i18n.ts` 默认端口与中英文说明更新；
  - Web 设置页：`src/routes/settings/system/+page.svelte` 默认端口与提示文案更新为 `3040`；
  - 开发与容器部署：`vite.config.ts`、`docker-compose.yml`、`Dockerfile`、`.env.example` 以及 `readme.md` / `readme.zh-CN.md` 同步更新。
- **测试覆盖**：
  - 更新 `scripts/runtime/service-port.test.mjs` 验证默认端口回退；
  - `cargo test`、`npm run test:service-bootstrap`、`npm run desktop:test`、`npm run desktop:check`、`npm run test:desktop-chat`、`npm run test:projects` 均 100% 通过。

### 项目文件面板图片与媒体即时更新及缓存击穿修复（已完成，P0）

- **问题背景**：
  - 用户在 Project 维度生成或覆盖图片（如 `1.png`）后，在 Finder 中确认文件内容已更新，但从右侧文件面板打开时仍显示旧图；
  - 根因为多层缓存叠加：
    1. 前端 `ArtifactTabsStore` 对已打开的 Tab 做复用，再次从树点击时直接跳过请求；
    2. 图片和流式媒体的 URL 始终为固定的 `/api/settings/projects/{id}/inspection/file?path=1.png&raw=true`，Svelte 响应式（`$derived`）未感知变化；
    3. WebKit WebView 内核对于 `<img src="...">` 具有强内存解码缓存（Decoded Image Cache），只要 URL 字符串未变，即使重新挂载也不发送网络请求；
    4. HTTP 响应头原使用 `no-cache`，强化为 `no-cache, no-store, must-revalidate`。
- **解决方案与实现**：
  - **Tab 动态版本戳（`version: number`）**：
    - `ArtifactTab` 引入 `version` 戳并在新建、重新打开或通过 Watcher 重新加载时自动刷新；
    - 从文件树再次点击已打开的文件时，调用 `reloadTab` 重新抓取磁盘最新状态；
  - **URL Cache Buster 动态透传**：
    - `desktopProjectRawFileUrl` 与 `desktopFileContentUrl` 支持透传版本参数 `&v=${version}`；
    - `ArtifactPanel.svelte` 中 `rawUrl` 与 `sessionStreamUrl` 基于 `activeTab.version` 动态派生，文件更新或刷新时 URL 自动改变，彻底击穿 WebKit 图片内存缓存；
  - **流式文件响应头强化**：
    - `streamFileWithRange` 默认 `Cache-Control` 设置为 `no-cache, no-store, must-revalidate`；
  - **Web 端文件面板同步升级**：
    - Web 界面 `buildPersistedFileUrl` 同步附带文件更新时间戳参数 `&v=...`。
- **测试覆盖**：
  - 更新 `inspection/file/server.test.ts` 验证 `cache-control` 响应头以及携带 `v` 参数的正确返回；
  - 更新 `api.test.ts` 验证带有 `version` 参数的 URL 构造函数；
  - 全量 `pnpm run test:projects`、`pnpm run desktop:test` 与 `pnpm run test:desktop-chat` 均 100% 通过。

### Prompt Box（提示词箱）详情弹窗统一滚动与底栏按钮常驻修复 (v1.0.7)（已完成，P0）

- **功能概述**：
  - 参考 Raycast 官方扩展功能，为 Molibot 打造开箱即用的内置小程序 **Prompt Box（提示词箱）**，提供提示词的高效管理、云端双向同步、一键填入输入框以及 AI 回复右键存为提示词等全套功能；
  - 升级至 `1.0.7`：
    1. **弹窗布局统一滚动（Unified Dialog Scrolling）**：将详情弹窗与编辑弹窗的 Astryx `Layout` 设为 `height="fill"`，取消正文内部嵌套 `max-height` / 二级滚动条，使图片与完整 Markdown 提示词内容随 `LayoutContent` 一起自然平滑滚动；
    2. **底部操作栏吸底常驻（Pinned Action Footer）**：无论图片和提示词内容多长，底部的【编辑】、【复制】与【填入输入框】操作按钮均牢固吸附在弹窗底部（`LayoutFooter`），100% 随时可见可用；
    3. **外链图片跨域与 CSP 全量放通**：彻底解决图片加载、防盗链与莫兰迪主题配色；
- **核心能力与 UI 便利性优化**：
  - **莫兰迪色系视觉升级（Morandi Design System）**：
    - 主色调采用柔和沉稳的雾霾蓝灰（`#4A6072`）与鼠尾草灰绿（`#5B7068`），搭配温润卡片白与深色底色，明暗主题深度调优；
    - 小程序主图标 `icon.svg` 采用莫兰迪渐变重新设计，应用栏与侧边栏标签颜色同步；
  - **API 示例图片字段（example_image_url）与正文图片即时解析**：
    - 后端 SQLite 新增 `example_image_url` 字段与自动提取兼容层，即使未再次手动点击同步，也能即时从正文/描述中提取并呈现图片；
    - 卡片右侧展示 `62x62px` 圆角缩略图，悬浮显示预览遮罩，点击即刻弹出居中高清大图 Lightbox 预览；
  - **纯图标操作栏（Icon-only Card Actions）**：
    - 卡片底部的【填入输入框】（`PaperAirplaneIcon`）、【复制】（`ClipboardDocumentIcon`）、【编辑】与【删除】采用独立 24px 极简图标按钮；
    - 点击填入或复制时即时切换为打勾动画反馈；
  - **API Key 设置与安全存储**：支持配置 `pb.onlinestool.com` 的 API Key 与服务端 Base URL，存储于本地独立的 SQLite 数据库设置表中，支持脱敏显示与随时修改；
  - **云端与本地双向数据同步（刷新/同步）**：顶栏提供明确的刷新/同步按钮，支持一键将本地离线/新创建的提示词推送到云端，并将云端最新提示词拉取合并到本地，展示精确的推拉条数反馈；
  - **多标签筛选与即时多维排序（纯本地计算）**：
    - 标签栏展示库中所有标签及其提示词数量（如 `#coding (5)`），支持多标签组合筛选；
    - 支持按【最近更新】、【最近创建】、【标题 A-Z / Z-A】、【内容长度】等 5 种维度即时本地排序，无额外网络开销；
  - **高效编辑与创作体验（Rich Editing Experience）**：
    - **交互式标签管理与常用标签推荐**：已选标签以 Chip 形式展示并支持一键删除，输入时支持回车/逗号/空格自动成词；下方聚合推荐已有标签，单键点击即可快速添加到当前提示词；
    - **Markdown 快捷模板工具栏**：支持一键在光标处插入动态变量 `{{variable}}`、图片模板 `![图片](url)`、链接 `[标题](url)`、代码块 ```` ```` 以及角色预设模板；
    - **编辑/实时预览双模式切换**：通过 SegmentedControl 支持随时在【编辑】与【Markdown 实时渲染预览】间切换；
    - **字符与词数实时统计**：实时显示提示词当前字符数与词数；
    - **快捷键保存**：支持 `⌘ + Enter` / `Ctrl + Enter` 一键保存；
  - **一键填入聊天输入框（Composer Bridge）**：在提示词卡片或详情页点击【填入输入框】，通过宿主 Bridge（`composer.insert`）无缝将提示词正文写入 Molibot 聊天主输入框，支持动态变量占位符角标高亮；
  - **AI 回复右键存为提示词（Message Action）**：在聊天消息气泡右键或悬浮操作栏中提供【存为提示词】操作，自动提取消息文本/选区、智能生成标题、持久化存入 Prompt Box，并在聊天中生成带深度链接的反馈卡片；
  - **基于 Astryx 框架全套组件构建 UI**：使用 `@astryxdesign/core` + `@astryxdesign/theme-neutral` 构建现代卡片式响应式界面，中英多语言（zh/en）以及明暗主题自适应切换；
- **平台集成与打包**：
  - 在 `src/lib/server/miniapps/bootstrap.ts` 中注册 `prompt-box` 内置小程序包，支持开箱即用与单键安装；
  - 新增 `scripts/build-prompt-box.mjs` 编译脚本并集成至 `package.json`；
  - 编写全面单元与集成测试 `src/lib/server/miniapps/promptBox.test.ts`，覆盖 CRUD、设置脱敏、Message Capture、云端 Mock 双向同步与 Materialize 打包。

### 项目会话模型别名与设置变更实时同步修复（已完成，P1）

- **项目会话与设置变更事件打通**：
  - 在 `ProjectChat.svelte` 与 `ProjectDetail.svelte` 中接入 `SETTINGS_CHANGED_EVENT`（`molibot:settings-changed`）事件监听与清理，在用户于“设置 › 供应商 / 模型”中修改别名或调整模型后，无需重启或切换页面，项目对话与项目设置弹窗即时同步最新模型列表与别名；
- **激活模型标签 alias 优先级对齐**：
  - 修复 `ProjectChat.svelte` 底部输入框激活模型标签（`activeModelLabel`）未优先读取 `alias` 的缺陷，与 `ChatView.svelte` 保持一致，优先展示用户配置的别名；
- **服务端 textOptions alias 映射补齐**：
  - 修复 `src/lib/server/app/desktopModels.ts` 中 `textOptions` 构造时遗漏 `alias: option.alias` 字段的问题；
- **测试覆盖**：
  - 补充 `desktopModels.test.ts` 路由别名断言以及 `chat-ui.test.mjs` 项目会话设置同步与别名优先级断言，全量测试通过。

### 大文件打开防卡死与 Git Status 未跟踪文件检查性能优化（已完成，P0）

- **后端 Git Status 遍历熔断与并发加速**：
  - 针对工作区包含大量未跟踪文件（如 454 个未跟踪文件或大型小说/数据集）时导致 Node.js 主线程卡死的问题进行彻底重构；
  - 引入 `MAX_UNTRACKED_STAT_BYTES = 256 * 1024`（256 KB）熔断阈值：大于 256 KB 的未跟踪文件直接跳过行数统计，返回 `+—`，不再将数兆字节读入内存做字符串切割；
  - 小于等于 256 KB 的文件采用 Buffer 原生字节扫描 `countBufferLines` 统计换行，消除 `replaceAll().split("\n")` 带来的海量临时字符串与 GC 压力；
  - 采用 16 路并发批次处理未跟踪文件状态检查，避免数百个文件串行 I/O 耗尽时间。
- **前端代码查看器与大文本安全降级**：
  - `CodeViewer` 引入 `MAX_SYNTAX_HIGHLIGHT_BYTES = 256 * 1024`：大于 256 KB 的文本内容跳过 heavy 正则语法高亮，降级为安全的纯文本转义，防止 UI 渲染主线程卡死；
  - 对单行超过 4,000 字符的极端超长行引入 `safeEscapeLine` 安全截断保护，防止浏览器排版引擎冻结；
  - 将单次挂载批次 `CHUNK_LINES` 由 2,000 降为 500，初次加载速度提升 4 倍并保持窗口拖拽随时响应。

### Note 便签明暗主题文字对比度与分享按钮样式修复 (v1.8.10)（已完成，P1）

- **分享按钮对比度提升**：
  - 修复信纸主题编辑页底栏【分享】按钮在亮色模式下因浅色文字导致看不清的问题，采用 `#4a3828` 高对比度字色与白色渐变微浮雕质感；
- **暗色主题标题与输入框样式补齐**：
  - 补充暗色模式下 `.editor-title-input`、`.note-search`、`.note-input-title` 的深底浅字规则（`#e6ded6`）与金色光标，解决暗色主题下便签标题和搜索输入发黑无法阅读的问题；
  - 补充暗色模式下分享预览弹窗操作按钮（复制文本、复制图片、保存图片）的深色拟物按钮风格；
- **版本声明与 Bump**：
  - `manifest.json` 版本升级至 `1.8.10`。

### Note 便签分享卡片品牌署名统一为 Moli Note 与宿主原生文件保存支持 (v1.8.9)（已完成，P1）

- **统一卡片品牌署名**：
  - Keep 风格与锤子拟物风格生成的分享卡片底部/右下角品牌署名一律统一为 `Moli Note`，移除 `Smartisan Notes` 与 `Note` 差异；
- **宿主原生文件保存桥接**：
  - 在 `miniappHostCapability` 中新增 `file.save` 协议，Desktop 原生层提供 `save_file_dialog` 命令，通过原生 Save File Sheet 让用户自定义保存路径并直接落盘写入 PNG 文件；
  - Note 小程序与宿主通过 postMessage 进行双向请求与状态响应，保存成功后即时展示“已保存至本地文件”；
- **版本声明与 Bump**：
  - `manifest.json` 声明 `host.capabilities: ["fileSave"]`，版本升级至 `1.8.9`。

### Desktop 左侧栏顶部红绿灯与工具栏区域窗口拖拽响应修复（已完成，P1）

- **问题定位**：Desktop 端左侧侧边栏顶部区域（macOS 红绿灯及折叠按钮周围）点击无法拖动窗口，原因是 `.sidebar-top-bar` 容器 `pointer-events: none` 阻断导致 `.sidebar-titlebar-drag` 未能接收鼠标事件，事件穿透到底层普通 `<aside>` 容器。
- **修复方案**：
  - 为 `.sidebar-titlebar-drag` 显式设置 `pointer-events: auto` 并将高度调整为 `42px` 铺满顶栏；
  - 在 `ChatSidebar.svelte` 与 `SidebarShell.svelte` 中显式绑定 `onmousedown={startWindowDrag}` 调用 Tauri `getCurrentWindow().startDragging()`；
  - 216 项桌面端与 59 项 Rust 全量测试通过。

## 2026-08-22

### Note 便签小程序分享保存图片多重降级与剪贴板双保险增强 (v1.8.8)（已完成，P1）

- **点击保存图片无反应根因排查与彻底解决**：
  - 根因定位：Mini App 运行于沙箱隔离 iframe / 桌面端 WebView 环境中，部分平台出于安全策略会静默拦截/抛弃 `<a download href="data:...">` 或 `blob:` 链接触发的直接文件保存，且此前未提供任何按钮视觉反馈；
  - **双重保障：文件下载 + 自动写入系统剪贴板**：
    - 点击【保存图片】时，不仅自动通过高质量二进制 Blob 触发浏览器/系统文件下载，还**同步将生成的 PNG 写入系统剪贴板**（`navigator.clipboard.write`）；
    - 无论处于何种受限沙箱环境，用户均可直接在微信、Slack、备忘录或聊天框中 `Cmd+V` / `Ctrl+V` 一键粘贴高清便签图；
  - **即时成功动效与提示指引**：
    - 点击后按钮即时变为绿色高亮“✓ 已保存！”，底部提示更新为“已保存（同时已复制到剪贴板），也可长按或右键图片另存为”；
    - 全面补全 `.share-action-btn` 浅色/深色/锤子主题下的拟物交互样式；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.8`，并已实时物化同步至本地 `miniapps/apps/note/` 目录。

### Note 便签小程序分享图零留白无缝贴合与弹窗紧密包裹修复 (v1.8.7)（已完成，P1）

- **分享图右方与下方多余突出留白根因修复**：
  - 根因定位：
    1. 生成器中设置了 `padding: 16px; background: outerBg`，并在测量高度时额外加了 `+32px` 空白，导致图片内容下方和右侧生成了多余的底色外框；
    2. `.share-preview-dialog` 设为了 `max-width: 420px` 且 `.share-preview-body` 带有多余的浅色背景底色，导致弹窗比图片更宽、在右侧和下方突出形成双层底色色差；
  - **精简生成器至零外层留白**：
    - 去除卡片外周所有多余的 `outerBg` 与 `padding`，图片本身直接为 `360px` 便签纸本身（Smartisan 浅米色信纸 / Keep 主题色）；
    - 高度精准按卡片内容实际高度渲染，不再叠加任何额外固定偏移；
  - **弹窗尺寸自适应包裹**：
    - `.share-preview-dialog` 设为 `max-width: min(calc(100vw - 32px), 384px)`，`.share-preview-body` 背景设为 `transparent`，弹窗紧密贴合图片；
    - 锤子主题与 Keep 主题下均已彻底消除右侧和下方的多余空白与突出；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.7`，并已实时物化同步至本地 `miniapps/apps/note/` 目录。

### Note 便签小程序编辑页 Markdown 预览内容被截断修复 (v1.8.6)（已完成，P1）

- **预览模式只展示几行根因修复**：
  - 根因定位：编辑页预览容器 `#preview-content` 此前复用了 `.card-content` 类名，导致直接命中了列表/网格卡片的 `-webkit-line-clamp: 5` 和列表模式下的 `-webkit-line-clamp: 1` 截断规则与单行内联样式；
  - 精确将卡片截断样式的作用域收紧至 `.note-card .card-content`，并将 `#preview-content` 与 `.card-content` 完全解耦；
  - 为 `.editor-preview-content` 编写独立完整的 Markdown 排版规则（`max-height: none; overflow: visible; display: block`），确保编辑页预览时无任何行数限制、完整渲染全部长文并支持平滑滚动；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.6`，并已实时物化同步至本地 `miniapps/apps/note/` 目录。

### Note 便签小程序分享弹窗层级修复与分享卡片紧凑窄版布局 (v1.8.5)（已完成，P1）

- **编辑页点击分享无反应根因修复**：
  - 根因定位：全屏编辑页（`#edit-modal`）的 `z-index` 为 `1000`，而分享预览弹窗（`#share-modal`）的 `z-index` 为 `200`，导致在编辑页中点击【分享】时弹窗被遮挡在编辑页后方，只有保存退出编辑页后才能看见；
  - 将 `.share-preview-backdrop` 的 `z-index` 提升为 `2000`，点击【分享】按钮后立即在最顶层弹出，并为分享按钮添加生成中的即时反馈状态；
- **消除右侧多余留白，整体收窄紧凑排版**：
  - 彻底移除 Smartisan 分享卡片中冗余笨重的 `.frame-outer`、`.frame-inner` 双层线框和四角 `.corner`；
  - 将分享卡片总宽度从 `480px` 优化收窄为 `380px`（卡片主体 `348px`），左右内边距均匀对称（`20px`），文字左右对齐饱满自然，完全消除右侧过宽留白；
  - 弹窗容器最大宽度调整为 `420px`，整体小巧精美，底栏操作按钮完整呈现；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.5`，并已实时物化同步至本地 `miniapps/apps/note/` 目录。

### Note 便签小程序列表视图三行布局（一行标题、一行内容、一行标签）(v1.8.4)（已完成，P1）

- **严格 3 行结构化展示**：
  - **第 1 行 标题**：`.note-app[data-view="list"] .card-title` 设为单行不换行，超长截断（`white-space: nowrap; text-overflow: ellipsis`）；
  - **第 2 行 内容摘要**：`.note-app[data-view="list"] .card-content` 设为 `-webkit-line-clamp: 1`，限高单行行高（`max-height: var(--md-body-md-lh)` 20px / Smartisan 24px），内部多段落自动扁平化单行截断展示；
  - **第 3 行 标签**：`.note-app[data-view="list"] .card-labels` 设为单行不换行（`flex-wrap: nowrap; overflow: hidden`），整张卡片呈现极简紧凑的 3 行结构；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.4`，并已实时物化同步至本地 `miniapps/apps/note/` 目录。

### Chat 对话页用户消息气泡上下留白对称性修复与操作栏 Fork 按钮移除（已完成，P1）

- **消息气泡上下留白不对称根因修复**：
  - 根因分析：`ChatMarkdown` 引入了 `chat-markdown-segment` 容器，但 `.markdown-body > :last-child { margin-bottom: 0 }` 仅作用于直接子节点；`chat-markdown-segment` 为 `display: contents`，导致内部末尾 `<p>` 的 `margin-bottom: 10px` 无法被重置，叠加气泡本身的 `padding-bottom: 10px` 造成底部留白达到 20px（上方仅 10px），上下严重不对称；
  - 在 `styles.css` 中将 `.markdown-body` 的 `:first-child` / `:last-child` 重置规则扩展支持 `.chat-markdown-segment:first-child > :first-child` 与 `.chat-markdown-segment:last-child > :last-child`，彻底消除尾部段落的多余下外边距，使用户消息气泡上下留白完全对称；
- **移除用户消息下方多余的 Fork（分支）按钮**：
  - 移除 `ConversationTranscript.svelte`、`ChatView.svelte`、`ProjectChat.svelte` 与 `transcript.ts` 中用户消息操作栏的 `onForkUser`（分叉）按钮与相关状态，用户消息 hover 动作栏仅保留复制与编辑，界面更清爽聚焦；
  - 保持破坏性“编辑重发”（Edit-and-resend）的原地截断能力，会话侧边栏分支标识与后端 Session 分叉 API 保持健全。

### Note 便签小程序全屏编辑页 Markdown 渲染预览按钮与交互 (v1.8.2)（已完成，P1）

- **顶部预览/编辑切换按钮**：
  - 在全屏编辑页顶部动作栏（`#editor-header-right`）新增预览模式切换按钮（`#modal-preview-btn`），支持在“编辑模式”（输入框）与“Markdown 渲染预览模式”之间一键无缝切换；
  - 切换按钮提供眼睛（预览）与铅笔（编辑）平滑状态图标切换，配备中英文 hover 提示与高亮激活态；
- **富文本 Markdown 预览容器**：
  - 接入 Note 统一的 `renderMarkdown` 引擎，支持标题、列表、富文本、表格、代码高亮、引用块与段落的即时渲染；
  - 标题与正文富文本联动展示，无缝适配默认浅色/深色主题以及 Smartisan 拟真信纸背景；
  - 在预览状态下可直接保存或切回编辑，退出弹窗自动重置为编辑状态；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.2`，已全量同步物化至本地 `miniapps/apps/note/` 目录。

### Note 便签小程序全屏编辑页光标与字号行高优化 (v1.8.1)（已完成，P1）

- **光标巨大根因修复**：
  - 将 `.editor-title-input` 字号与行高从 `title-lg`（22px / 28px）优化调整为 `title-md`（16px / 24px），消除标题输入时过大拉伸的光标；
  - 将 `.editor-textarea` 正文字号与行高从硬编码的 `line-height: 32px` 收紧为语义 token `var(--md-body-md-lh)`（20px/24px），彻底解决进入编辑详情页时光标被 32px 高行距异常拉伸的问题；
- **Smartisan 信纸网格与光标对齐**：
  - 同步调整 Smartisan 锤子信纸背景网格为 `24px`，正文字号设为 `14px`，`line-height: 24px`，确保文字基线、光标位置与信纸横线完美贴合，光标高度自然紧凑；
- **落盘物化与版本 Bump**：
  - `manifest.json` 版本升级至 `1.8.1`，并已实时物化同步至用户本地 `miniapps/apps/note/` 目录。

### Mini App 桌面路由防御性异常捕获与版本号对齐修复（已完成，P1）

- **路由健壮性与 500 防御**：
  - 在 `src/routes/api/desktop/miniapps/+server.ts` 的 `GET` 处理函数及 `badge/+server.ts` 的 `POST` 处理函数中接入细粒度 `try ... catch` 异常守卫与状态码映射，防止底层临时抖动时 SvelteKit 未捕获异常导致前端收到 500 Internal Server Error；
- **内置小程序版本号对齐**：
  - 将 `builtin/meeting-notes/manifest.json` 版本号提升至 `2.3.0`，与用户磁盘已安装版本严格对齐，确保更新与加载校验正确；
- **验证**：全量 218 项 Mini App 测试与桌面端路由测试全部 100% 通过（0 失败），全量生产构建打包成功，并在运行端口实测全部 Mini App UI 与 API 返回 200 OK。

### External Subagent 自有设置页宿主集成完善（已完成，P1）

- **主题与布局**：插件 iframe 接收 Agent App 当前明暗模式及语义主题 token，并通过受校验的内容高度消息自动伸缩，避免设置页出现异色白底、固定高度和双重滚动条。
- **可用性门禁**：Codex / Claude Code 在设置加载后自动检测；检测失败或可执行路径变化时 Provider 保持关闭且不可启用，检测通过后才开放开关与真实运行测试。
- **可靠安装**：运行时安装写入插件独立 `plugins/data/external-subagent` 目录；宿主先创建目录并严格读取安装结果，失败不再被展示为成功。真实临时目录安装及随后的 Codex 解析均已通过。
- **可靠回读**：Desktop 在向插件 iframe 回传设置与密钥状态前生成普通状态快照，避免 Svelte 代理触发 WebView clone 错误；Codex 与 Claude Code 启用状态经过保存、新建 store、重新加载的完整 round-trip 验证。
- **运行时硬门禁**：Provider 开关不仅控制设置页和工具说明；每次单任务、并行任务或链式任务执行前都会重新读取插件独立配置。即使旧会话仍提交 `claude-code`，禁用后也会在启动 CLI 前拒绝；系统提示词只列出当前启用的 Provider。
- **升级保护**：External Subagent `0.2.2` 更新只替换 package 代码；替换前备份现有落盘副本，独立配置和数据保持不变。

### 测试环境持久化工作区隔离修复与根目录残留清理（已完成，P1）

- **测试环境持久化隔离与根目录污染清理 ([runner.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/runner.test.ts)、[self-evolution.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/skills/self-evolution.test.ts))**：
  - **根因修复**：重构 `runner.test.ts` 中 `createRunnerForHookTest` 与 Hook 桥接测试，统一默认使用 `node:os` 的 `tmpdir()` 创建独立隔离临时目录，消除 `MomRuntimeStore` 在 `process.cwd()` 根目录生成会话工作区目录的行为；
  - **临时路径规范**：同步将 `self-evolution.test.ts` 中的 `.tmp-skill-creator-` 与 `.tmp-skeleton-` 临时模板目录迁移到系统 `tmpdir()`；
  - **规则与目录清理**：彻底删除根目录残留的 12 个 `chat-*` 文件夹，并移除 [.gitignore](file:///Users/gusi/Github/molipibot/.gitignore) 中针对这 12 个特定测试目录的硬编码规则；
  - **测试验证**：53 项单元测试全量通过，根目录保持干净零污染。

### Note 便签小程序标签筛选下拉菜单收纳与高度抖动修复（已完成，P1）

- **Note 便签小程序 (v1.8.0)**：
  - **移除主界面常驻标签栏**：取消在便签列表主界面顶部常驻的横向标签栏，彻底消除点击不同标签时标签行高度形变与样式抖动的问题；
  - **标签筛选收纳至顶栏下拉菜单**：将标签筛选能力无缝整合进顶栏“笔记 / 归档”的切换下拉菜单（`#tab-picker`）中；
  - **分类结构清晰与固定高度约束**：
    - 上半部分清晰展示【笔记】（全部便签）与【归档】项及对应计数 badge；
    - 下半部分通过分割线与【标签】小节动态展示所有活跃标签（`#工作`、`#生活` 等）及便签数量；
    - 严格固定菜单项的高度（`36px`）与内边距，点击切换任何标签或分类时零形变、零抖动；
    - 选中标签后顶栏标题自动切换为对应标签名（如 `#工作`），再次点击下拉菜单可随时切回全部笔记或其他分类。
- **验证**：`noteUi.test.ts`、`uiDesignBaseline.test.ts` 及全套 201 项 Mini App 自动化测试 100% 通过。

### 内置小程序增强（Todo 待办快捷日期胶囊与一键清空已完成、MD Preview 公众号新主题与字数统计、Mini Chat 快捷交互）（已完成，P1）

- **Todo 待办小程序 (v1.8.0)**：
  - **快捷截止日期选择胶囊**：在新建待办的日期选择抽屉顶部新增【今天】、【明天】、【下周一】（中英文自动适配）快捷胶囊，点击一键自动换算当前本地对应 ISO 日期并填入，免除繁琐点击日历控件逐层选择；
  - **一键清空已完成待办**：在已完成分组标题右侧新增【清空】快捷操作按钮，支持按当前列表或全局一键永久清除所有已完成待办，并提供 `POST /todos/clear-completed` 后端批量清理路由与 `clear_completed` Agent 工具；
  - **规范 Design Tokens**：所有新增样式全面遵循 Material 3 设计体系与 `--md-*` 语义 token，支持明暗主题自适应。
- **MD Preview 公众号排版预览小程序 (v1.2.0)**：
  - **新增精美排版主题**：
    - `geek-mint` (极客薄荷)：清新科技青绿主色，搭配暗色终端风格代码块与利落边框，专为技术分享与开发笔记设计；
    - `warm-amber` (暖橙知秋)：温暖柔和琥珀橙，衬线标题与雅致阅读底色，适合生活随笔与长文排版；
  - **文章字数与预计阅读时间统计**：在顶部栏增加实时字数与预计阅读时长（如 `1,420 字 · 约 5 分钟`）胶囊，直观感知篇幅与排版体量；
  - **多语言与主题指示优化**：菜单项与主题指示标完美支持中英文与明暗模式切换。
- **Mini Chat 跨端轻量对话小程序 (v1.1.0)**：
  - 更新版本号并优化跨端通信与快捷发送交互。
- **验证**：`todo.test.ts`、`mdPreview.test.ts`、`uiDesignBaseline.test.ts`、`bootstrap.test.ts` 等全量 200 项 Mini App 测试 100% 通过（0 失败）。

### 服务启动 sanitizePluginEntries 缺失引用修复（已完成，P0）

- **修复启动崩溃**：
  - 在 `src/lib/server/settings/store.ts` 中正确补齐 `sanitizePluginEntries` 命名导出引入；
  - 修复 `src/lib/server/settings/store.test.ts` 插件持久化回归测试用例；
  - 修复桌面前端 `PluginsSection.svelte` 与 `api.ts` 的类型与属性匹配；
  - 全量构建与服务启动冒烟测试通过。

### 思考过程状态解耦与会话切换触底定位优化（已完成，P1）

- **思考过程宏微观状态解耦（消除误报警告）**：
  - **宏观回合结果驱动**：顶层 `<TurnProcess>` 折叠卡片的状态改为由整次回合的最终交付结果（`failed = assistantStatus === "error" || assistantStatus === "aborted"`）驱动；
  - **消除试错误判**：Agent 在思考探索过程中单步工具调用（如 `read` 文件不存在、`grep` 暂未命中）属于正常的试错探索，只要回合最终成功生成了回答，顶层摘要栏始终呈现正常的绿勾 `✓ 已完成操作`（包含工具数、文件数与耗时），杜绝出现“操作遇到问题”的误报警告；
  - **微观事实诚实保留**：用户手动展开时间线详情时，具体的某一步工具依然如实呈现其自身的状态与输出详情，满足开发者需要时的排障溯源需求；
  - **真正故障才报异常**：仅当回合发生未恢复的崩溃错误（`assistantStatus === "error"`）或被用户主动中断且未产出内容（`aborted`）时，顶层摘要栏才展示警告图标 `ph-warning-circle` 和 `操作遇到问题`。
- **会话切换默认瞬时触底（消除浮动按钮与停留中间）**：
  - **会话切换过渡锁**：在 `stickToBottom.ts` 中引入 `switchingSession` 状态机锁，在切换会话 `key` 时立即执行 `instantToBottom()`（`scrollTop = scrollHeight`）并广播 `announce(true)`；
  - **抑制过渡伪滚动机**：拦截新会话 DOM 替换和布局计算期间浏览器触发的 synthetic `scroll` 事件，杜绝将其误判为用户“向上翻页浏览历史”，彻底防止 `pinned` 被置为 `false`；
  - **消除浮动按钮误弹**：从 Session A 切换到 Session B 时，视口永远瞬移并锁定在 Session B 最下方最新一条消息，不会再弹出“回到最新 / 回到最下”悬浮按钮，更不会悬停在历史半中间；
  - **正常历史浏览无缝保留**：当用户在当前会话内主动向上滑动时，依然正常响应并弹出“回到最新”按钮，点击即可快速返回最新一行。
- **验证**：`transcript.test.ts`、`stickToBottom.test.ts` 单元测试全部通过；`chat-ui.test.mjs` 桌面测试 214 项 + 56 项 Rust 测试全量通过；`desktop:check` 0 错误 0 警告；全端集成测试 267 项全量通过。

### 工具执行波浪律动动画与工具类型专属图标（已完成，P1）

- **优雅波浪律动等待动画（Wave Effect）**：
  - 彻底替换原先在时间线上偏心旋转、视觉粗糙的“转圈圈”动画（`ph-circle-notch spin`）；
  - 引入专为垂直时间线设计的 `.timeline-wave-node` 与 `.timeline-wave-bar` 3 柱律动动画，在时间线节点上完美居中，通过 `ease-in-out alternate` 错峰延迟实现如声波般平滑细腻的起伏，彻底消除旋转晃动感；
  - `TurnProcess` live 过程摘要栏与 `RunActivity` 执行条目同步应用波浪律动效果，并在 `prefers-reduced-motion` 媒体查询中优雅降级。
- **丰富的工具类型专属 Icon**：
  - 在 `activityView.ts` 中新增 `activityToolIcon`，将不同工具分类映射为精美的 Phosphor 语义图标：
    - 终端/命令执行（`bash`, `hostBash`, `exec` 等）➔ `ph-terminal-window`
    - 文件写入/修改（`write`, `edit`, `patch`, `documentExport` 等）➔ `ph-pencil-simple-line`
    - 文件读取/文档提取（`read`, `view_file`, `docExtract` 等）➔ `ph-file-text`
    - 代码/文件检索（`grep`, `glob`, `find`, `project_search` 等）➔ `ph-magnifying-glass`
    - 目录浏览（`ls`, `list_dir` 等）➔ `ph-folder-open`
    - 网络搜索/抓取（`webSearch`, `search_web`, `read_url_content` 等）➔ `ph-globe`
    - 记忆存取（`memory_store`, `memory_recall` 等）➔ `ph-brain`
    - 任务/子代理调度（`subagent`, `delegate`, `schedule` 等）➔ `ph-tree-structure`
    - 小程序/插件/MCP（`miniapp__*`, `mcp__*`, `extensionManage` 等）➔ `ph-cube` / `ph-plug`
    - 媒体/图像/音频（`image_generate`, `tts`, `audio_transcribe` 等）➔ `ph-image` / `ph-waveform`
    - 通用办事工具兜底 ➔ `ph-wrench`
  - 在 `ProcessActivityItem` 与 `RunActivity` 的操作标题前展示对应工具图标，执行中呈现品牌主色 `var(--accent)` 高亮。
- **验证**：`activityView.test.ts` 新增 17 项工具分类与图标单测全部通过；`chat-ui.test.mjs` 桌面测试 214 项 + 56 项 Rust 测试全量通过；`desktop:check` 0 错误 0 警告。

### 内置小程序体验全面优化（Note 便签光标与图片保存修复、Meeting Notes 音频播放与语音识别重试）（已完成，P1）

- **Note 小程序 (v1.7.0)**：
  - **修复详情页大光标与行高失衡**：在默认主题与 Smartisan 信纸主题下分别规范 `.editor-title-input` 与 `.editor-textarea` 的 line-height 与内边距（从原先撑满 32px 的过大光标回归至优雅的 24px/28px，与文字基线对齐）；
  - **分享图片一键保存与剪贴板复制**：在分享预览弹窗底栏增加【保存图片】（自动触发 `.png` 格式文件下载）、【复制图片】（基于 `navigator.clipboard.write([ClipboardItem])` 复制 PNG Blob）与【复制纯文本】按钮，并带有友好的复制成功轻量提示，彻底解决桌面 Webview 禁用右键导致分享图片无法保存的问题；
  - **标签胶囊筛选条与分类速览**：在便签列表顶部新增动态标签胶囊栏（`#tag-filter-bar`），自动统计标签便签数量，支持按标签一键快速筛选；
  - **编辑页实时字数统计**：在详情页底部固定底栏实时计算标题与正文字数；
  - **规范 Design Token**：修复所有未通过 token 的裸 `font-size`，完全符合 M3 设计规范。
- **Meeting Notes 会议纪要小程序 (v1.3.0)**：
  - **历史会议音频流与播放器**：
    - 后端 `server/index.mjs` 新增 `GET /meetings/:id/audio` 和 `GET /chunks/:id/audio` 路由，智能解析并拼接会议所有 chunk 的 PCM 数据为标准 WAV 音频流，支持 HTTP Range 和 `<audio>` 随意 seek；
    - 前端新增现代卡片式音频播放器（包含播放/暂停切换、可拖拽进度条、当前时间/总时长、1.0x/1.25x/1.5x/2.0x 倍速切换）；
  - **逐字稿音字同步高亮与单句跳转**：
    - 逐字稿每行新增独立播放按钮，点击即可跳至对应时间戳起播；
    - 监听音频播放时间，实时对当前朗读句子添加 `.active-playing` 聚焦高亮；
  - **语音识别错误归因与一键重试**：
    - 遇到未配置 STT 或网络错误时，给出清晰中文引导说明；
    - 新增 `POST /meetings/:id/retry-transcription` 接口与前端【重试语音识别】按钮，配置好 Whisper 后可一键重新排队转写所有失败分片；
  - **录音与纪要导出**：支持一键下载完整 `.wav` 原始录音，以及导出包含摘要与逐字稿的完整 `.md` 会议纪要文件。
- **验证**：`noteUi.test.ts`、`meetingNotes.test.ts`、`uiDesignBaseline.test.ts` 及全套 198 项 Mini App 测试全量通过。

### Chat 思考内容展示逻辑优化（默认折叠、流式自展开、回复后收起与会话切换保持）（已完成，P1）

- **默认折叠与已完成消息隔离**：
  - 移除已完成回合 `<TurnProcess>` 的 `forceOpen` 强制展开属性，让已完成的历史消息在 Transcript 挂载或会话切换时统一保持默认折叠状态（`opened = false`）；
  - 保留过程卡片中醒目的状态图标与执行统计（耗时、工具调用数、修改文件数），消除会话切换或存在异常活动时思考内容被强行自动撑开的异常。
- **流式回复时主动展开与正文出现后自动收起**：
  - 桌面端：`ConversationLiveView` 中的 live 过程卡在模型未产生正文回答时维持 `forceOpen={!liveSections.response.length}` 主动展开，首个正文文本或 Plan 块产生时即刻平滑折叠；
  - Web 端：在 `src/routes/+page.svelte` 的 `switchSession` 中同步重置残留的流式思考与正文状态，防止跨会话切换后流式思考块污染或重新展开。
- **全生命周期手动交互**：
  - 用户在任何时候均可手动点击摘要栏自主展开或收起思考过程，手动展开状态在流式后续阶段不被强制覆盖。
- **验证**：`chat-ui.test.mjs` 补充已完成 Transcript 中 TurnProcess 默认折叠与 Live 阶段仅在无正文时 forceOpen 的回归断言；214 项桌面测试全部通过，`desktop:check` 0 错误 0 警告，267 项全端集成测试全量通过。

### Desktop 端侧边栏折叠按钮、变窄自动吸附折叠与平滑过渡动画（已完成，P1）

- **顶部折叠与展开按钮 & 系统红绿灯水平对齐**：
  - 在左侧侧边栏顶部（与 macOS 红绿灯同高度右侧）添加折叠按钮（`ph-sidebar-simple`），点击即可平滑收起侧栏；
  - 侧边栏折叠时，在主内容区顶部标题栏（`chat-header`、`workspace-header`、`ProjectDetail` 头部）左侧（已为 macOS 红绿灯留出 84px 安全边距）展示展开按钮，点击即可平滑展开；
  - 新增全局快捷键 `Cmd+B` / `Ctrl+B` 快速切换侧边栏折叠状态；
  - 微调 macOS 原生红绿灯按钮垂直坐标（`trafficLightPosition: { x: 18, y: 20 }`），使系统关闭/最小化/最大化三色按钮与右侧折叠按钮（`sidebar-collapse-btn`）、展开按钮在同一水平中心线（y: 21px）上精准对齐。
- **拖拽至最小宽度防挤压与平滑吸附折叠**：
  - 手动向左拖拽侧边栏分割条（`sidebar-resizer`）达到最小宽度（228px）时，侧边栏宽度稳固锁在 228px，坚决不再单独往内挤压变形（防止文字折行、图标挤压）；继续向左拖拽越过触发阈值（160px）时，直接平滑触发整栏收起折叠动画；
  - 重新展开时自动恢复用户原本设定的理想宽度（默认 228px 或最后设定的宽度）；
  - 窗口尺寸缩窄至 `<= 820px` 紧凑模式时自动折叠侧边栏以保障会话区域宽度，拉宽窗口时自动恢复；
  - 记忆用户折叠状态（`molibot-desktop-sidebar-collapsed`）。
- **流畅过渡动画与直接操控零延迟**：
  - CSS Grid 轨道与 `transform: translateX(-100%)` / `opacity` 联动硬件加速，带来丝滑顺畅的展开/折叠过渡动画；
  - 拖拽调整宽度时（`resizingSidebar`）自动关闭 transition（`transition: none !important`），确保 120fps/60fps 实时跟手零延迟。
- **右侧面板 Header 高度统一与全栏无缝对齐**：
  - 将右侧文件/小程序面板（`.file-panel-head`、`.artifact-panel .file-panel-head`）与任务检查面板（`.durable-inspector-head`）头部高度从 60px/68px 统一缩减为 42px（垂直居中 y: 21px），与左侧 Chat 标题栏、侧栏顶部工具栏及 macOS 红绿灯无缝在一条水平线上对齐。
- **彻底解决变窄时 Chat 区域被隐藏与空白列问题**：
  - 根因：媒体查询 `@media (max-width: 1000px)` 将 `.chat-sidebar` 置为 `display: none`，但 `.chat-layout.sidebar-collapsed.with-files` 复合选择器因高特异性仍强制应用 3 列 Grid，导致第一列（0px）吞掉了 Chat 区域，第二列渲染文件面板，第三列变为空白列；
  - 修复：统一在窄屏媒体查询中声明双列自适应 Grid `minmax(0, 1fr) minmax(var(--files-min-w), var(--files-w, 280px))`，确保 Chat 区域任何时候绝对不会被隐藏或遮挡，始终占据可用空间。
- **文件面板默认宽度与紧凑调整**：
  - 将文件面板首次打开的初始默认宽度从过宽的 `380px` 调整为适中的 `280px`（最小 `240px`，最大 `720px`），大幅减少对中间 Chat 区域的压迫感，并持续支持拖拽分割条自定义调整。
- **左右两侧面板丝滑过渡与无缝直接铺展**：
  - **左侧导航平滑折叠/展开**：重构 `.chat-sidebar` 的宽度与透明度过渡体系（`width/max-width/padding 240ms cubic-bezier(0.2, 0, 0, 1)` + `opacity 180ms ease`），彻底移除导致首帧瞬间消失的无序隐藏，实现左侧导航栏像抽屉般自然平滑地折叠收起与滑出展开；
  - **右侧文件/小程序面板关闭直接铺展**：彻底移除退出延迟定时器与中间空白过渡态，关闭面板时左侧 Chat 内容区瞬间无缝铺满整屏，杜绝任何透明幽灵留白与视觉停顿。
- **验证**：`chat-ui.test.mjs` 新增针对折叠按钮、展开按钮、吸附阈值（160px）、快捷键（`Cmd+B`）及两侧面板平滑动画 CSS 规则的回归测试；214 项桌面测试 + 56 项 Rust 测试全量通过，`desktop:check` 0 错误 0 警告。

### Desktop 端思考流完成自动折叠 & 屏幕变窄视口底部自动锚定（已完成，P1）

- **思考流自动折叠与时序收起**：
  - 在 `conversationController.svelte.ts` 的 `onDone` 中兜底同步正文与思考步骤至 `liveSteps`，确保非 token 流式返回或单次回合结束时 `liveSections.response` 立即非空，触发 `TurnProcess` 自动收起为简洁摘要。
  - 在 Web `+page.svelte` 中同步完善 `thinking_state` 的 `phase: "end"` 与 `done` 事件即刻标记 `folded: true`。
- **屏幕变窄视口底部锚定（防跑焦/防挤压）**：
  - 在 `stickToBottom.ts` 引入 `ResizeObserver`，监听聊天消息容器与布局几何重排。
  - 当窗口宽度拉窄、侧边栏拖拽或多栏分屏导致文字折行、内容总高 `scrollHeight` 增加时，只要用户处于底部（`pinned === true`），即刻自动同步更新滚动高度 `scrollTop = scrollHeight - clientHeight`，保证视口永远吸附在最后一行，彻底消除焦点下坠与内容丢失问题。
- **验证**：`stickToBottom.test.ts` 新增 ResizeObserver 自动锚定与滚动解绑单测全部通过；全端 213 项桌面测试 + 267 项服务端测试全量通过；`desktop:check` 0 错误 0 警告。

## Plugin-owned settings host and External Subagent migration (partially delivered, P1)

- `/settings/plugins` is now a compact catalog with immediate enable switches and dedicated `/settings/plugins/<plugin-id>` pages. API failures remain visible instead of being converted into a false empty state; the existing pi extension installer, reload, enable, and uninstall controls remain available as a separate compatibility section.
- Memory Backend and Daily Materials remain legacy built-ins for this slice, but are again visible in the same catalog, need no installation, and open dedicated bilingual settings pages. A regression guard prevents plugin pages from calling unsupported methods on the shared locale store.
- The native Desktop catalog merges the core and contract APIs, so Memory Backend, Daily Materials, Cloudflare HTML, and External Subagent remain visible together. Desktop details use the same fine-grained save/enable routes as Web rather than submitting the global settings object.
- Plugin packages use owner-global `<dataDir>/plugins/{packages,config,data,cache}/<plugin-id>` roots. Non-secret settings and owner-only secrets persist outside global RuntimeSettings, survive a fresh service process, and are read by both the settings page and runtime actions.
- External Subagent is the first custom-mode reference: its bilingual, theme-aware settings UI and declared detect/install/test actions ship in `package/external-subagent`; the release build produces a self-contained runtime artifact. Desktop loads it through the fixed `molibot-plugin://` origin, whose Tauri transport exposes only the selected plugin's `/ui/` mount.
- The shared contract rejects undeclared actions, disabled invocations, malformed/oversized bridge messages, escaping paths, invalid manifests, and non-0600 secret replacements. Remaining enhanced-pi installation and legacy built-in migrations stay tracked in the [active PRD](docs/requirements/plugin-owned-settings-prd.md).

## Documentation update: plugin-owned settings and storage PRD (2026-08-22)

- Added an execution-ready PRD for installable plugins to own their dedicated settings route, configuration validation, settings actions, and isolated UI without adding plugin-specific branches to Molibot Core.
- Locked the planned owner-global storage boundary to `<dataDir>/plugins/{packages,config,data,cache}/<plugin-id>` and distinguished it from per-Bot/Channel/Session/Project workspaces. This is a documented plan, not a claim that the runtime capability is already delivered.
- Selected External Subagent as the required reference migration and defined the install → configure → fresh restart → upgrade → uninstall-retain acceptance seam.

## 2026-08-21

### External Subagent 真实可用性测试按钮（已完成，P1）

- **背景**：设置页的「检测环境」只做路径解析（文件存在 + `which`），绿徽章只代表「找到了二进制」，不代表「能跑」。已出现多次检测显示可用、实际执行报错（协议不兼容 / 认证缺失 / 二进制损坏）的假可用。
- **一键测试运行（Test Run）**：Web 与 Desktop 设置页每个 provider 行新增「测试运行」按钮，走真实链路验证：
  - 复用 `tools.ts` 的共享 `ExternalSubagentRuntime`（pitfall 21：探活必须走真实运行时，不另起探针）；
  - 在隔离的 `mkdtemp` 临时目录中执行最小真实任务（`Reply with exactly: OK`），完整走一遍 wire 协议、认证与 provider 选择；
  - 120 秒上限（`PROBE_TIMEOUT_MS`），失败/超时/无输出一律判不可用；
  - 使用已保存的 permissionMode 与表单中未保存的自定义路径（与「检测环境」语义一致）。
- **诚实徽章**：测试结果覆盖检测状态 -- 通过显示「测试通过 · Ns」，失败显示红色「测试失败」+ diagnostic（含 stopReason），检测为绿但测试失败时绝不显示可用；传输层异常（服务中途死亡）同样记为失败而非吞掉。
- **实现**：`probe.ts`（可注入 runtime 便于单测）+ 两端 POST `action:"test"`（缺省 action 保持 install 向后兼容）+ Desktop `testExternalSubagentRuntime` API client + 中英 i18n。
- **验证**：`probe.test.ts` 4 用例（通过判定 / error 失败 / not_installed+timeout / 异常时清理临时目录）；`svelte-check` 0 错误 0 警告；production build 通过。

### 桌面端与发布产物体积优化 & Source Map 源码防泄露（已完成，P0）

- **构建清理守卫与防累积**：在 `package.json` 的 `build` 脚本与 `clean` 命令中加入前置清理逻辑，确保每次构建前清空 `build` 与 `.svelte-kit` 目录，彻底杜绝历史带 Hash 的 chunk 文件单调累积膨胀。
- **Source Map 彻底剥离与安全加固**：
  - 在 `vite.config.ts` 中显式配置 `sourcemap: false` 与 `minify: "esbuild"` 开启混淆压缩；
  - 在 `bin/molibot-release.sh` 中增加全局 `.map` 文件清理命令，将生产运行时中的 Source Map 全部剔除，彻底杜绝原始 TypeScript 源码被反编译还原的风险。
- **恢复 `--no-optional` 依赖裁剪**：在发布包 `pnpm install --prod` 中恢复 `--no-optional`，精简不必要的跨平台多架构 Native Binding 冗余文件。
- **体积优化成效**：
  - `molibot-runtime.tar.gz` 打包体积从 **555 MB** 骤降至 **~51 MB**（缩减 90%+）；
  - 解压后的生产运行时目录从 **2.7 GB** 降至 **~319 MB**；
  - 产物中 `.map` 源码映射文件数量归零。

### Web 聊天界面：Agent 多轮思考流式展示与完成自动折叠（已完成，P1）

- **背景与问题根因**：
  - 对话流式生成过程中，思考过程固定渲染在正文上方的单一面板中，并伴随频繁滚底；当流式输出思考内容时视口在底部，随后正文从思考下方输出又将思考顶至上方；在 Agent 多轮循环（思考 ➔ 工具执行 ➔ 再次思考 ➔ 输出）中，顶部思考框反复展开与内容变化导致页面剧烈上下跳动与抽搐。
- **优化方案（分段时序块 + 完成即折叠）**：
  - **分段时序块（Streaming Blocks）**：流式阶段将每次思考、工具活动、正文输出作为独立的时序块（Block）向下单向追加，永不回头修改上方已完成块的高度。
  - **完成即自动平滑折叠**：当前思考块在流式进行中保持展开；一旦进入工具执行（`runner_event`）或正式输出正文（`token` / `replace`），前面的思考块立即自动平滑收起为精致小胶囊（`🧠 已完成思考 · 点击展开`），固定高度，杜绝挤压下方正文。
  - **多轮 Agent 连续追加**：当模型在工具调用后发起第二轮思考时，在最下方追加崭新的思考块，完成时同样自动折叠，保持整体界面极度清爽且随时可回溯展开。
  - **后端多轮思考保真**：`api/stream/+server.ts` 确保多轮 Agent 循环中多次 `thinking_start` 能够完整保留与拼接段落，并通过 `thinking_state` 显式通知前端分块。
  - **全端与国际化适配**：严格遵循 `DESIGN.md`，支持明暗主题、中英双语（`zh-CN` / `en-US`），并通过 267 项全量单元测试与 production build 校验。

## 2026-08-20

### External Subagent 内置插件：OpenAI Codex & Claude Code 一体化子 Agent（已完成，P1）

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

### 图片按需识别与多 API 引擎（已完成，P0）

- 入站消息不再预先把图片一次性转成文字；实际主模型支持视觉时直接接收原图，纯文本模型按任务需要调用 `read(path, prompt)`。
- `read` 可对同一图片使用不同 prompt 重复识别；内部图片识别模块支持多个 API 引擎、显式优先级、自动故障切换、attempt/warning 记录与统一不可信内容边界。
- 删除公开 `imageAnalyze` 与旧 `visionAnalysis`/入站 fallback，不保留兼容层；PDF OCR 复用同一内部模块。
- Web 与 Desktop 图片设置页均拆为“图片生成 / 图片识别”双 Tab；识别页支持引擎增删、排序、启停、默认选择、未保存配置测试、中英/明暗/窄窗口布局与固定保存栏。Desktop 使用独立安全投影和精确 Tauri HTTP scope，服务中断后进入有界、可重试状态。第一期仅 API，第二期 CLI 通过既有 adapter seam 接入。
- Desktop 引擎卡片使用独立展开状态，新增或编辑第二个及后续引擎不会因响应式数据更新而折叠；顶部双 Tab 与 720px 设置内容列精确对齐。
- Feishu、Telegram、QQ、微信和 Web 入口只负责附件下载、持久化与统一图片内容构造，识别路由完全位于共享 Agent 层。


### AI 回复内容底部状态条优化：总耗时计算、Token 紧凑格式化与纯净模型名展示（已完成，P1）

- **背景与问题**：
  - AI 回复内容下方的统计信息栏（`turn-summary`）存在三处可读性与准确性问题：
    1. **耗时非全量时间**：此前时间统计仅累加了 tool activities 的执行时间，未计入 LLM 推理、思考及网络往返耗时，导致显示的 27.2s 远低于用户从发送到接收完成的实际端到端总时间；
    2. **Token 显示冗长**：Token 计数直接显示完整大整数（如 `3632294 tokens`），在有限宽度的状态条中过于冗长且不易快速获知数量级；
    3. **模型名称包含服务商前缀**：最右侧模型信息显示了 `Cli Proxy API · Gemini 3.7 Flash High` 这类长名称，包含了服务商前缀，未能与聊天输入框保持一致的纯净模型名呈现。
- **优化方案**：
  - **端到端总时间精确计算**：`transcriptTurnSummary` 支持关联本轮对应的用户消息 `previousUserMessage`，若存在则使用 `assistantMessage.createdAt` 与 `userMessage.createdAt` 的时间差精确计算从发送到完成的总耗时（端到端 Wall-clock 耗时），无前置消息时平滑回退至 activities 耗时累加；
  - **Token 紧凑格式化（`formatCompactTokens`）**：引入 `<1k` 显示原始数值、`1k~999k` 紧凑展示为 `17k` / `17.4k`、`>=1m` 紧凑展示为 `1m` / `3.6m` 的标准算法，底部状态条及弹出详情菜单统一应用；
  - **纯净模型名称提取（`modelShortLabel`）**：自动剥离 provider/namespace 前缀（如 `cli-proxy-api/`、`custom::`、`custom|` 等），将 `Cli Proxy API · Gemini 3.7 Flash High` 提炼为只展示纯净模型名 `Gemini 3.7 Flash High`，与输入框保持一致的高级极简设计。
- **验证与测试**：
  - `apps/desktop/src/lib/chat/transcript.test.ts` 新增对端到端耗时计算、紧凑 Token 格式化、纯净模型名提取的 12/12 自动化单元测试；
  - `apps/desktop` `svelte-check` 0 错误 0 警告，`test:desktop-chat` 266 项回归测试全部通过。

## 2026-08-19

### 右侧 MiniApp 面板与全局滚动条细窄化统一（已完成，P2）

- **问题根因**：
  - 各 Mini App 均运行在独立的沙箱 iframe 中（`molibot-miniapp://<id>/...`），拥有独立的样式作用域；此前 Mini App 基础样式未定义滚动条规则，导致 WebKit/WebView 回退为 15~16px 宽的原生宽滚动条，与主应用内文件面板/聊天区域的细窄精致滚动条风格割裂。
- **优化方案**：
  - **消除外部多余滚动条**：将 Mini App 页面顶层 `html, body` 锁定为 `height: 100%; width: 100%; overflow: hidden;`，完全由 Mini App 内部容器（如便签列表、全屏编辑模态框等）按需承载滚动，彻底杜绝外层 iframe 产生第二条滚动条。
  - 在 Mini App 共享设计基线（`note`、`todo`、`meeting-notes`、`md-preview`、`mini-chat` 以及 `miniapp-creator` 模板）中统一定义现代细窄滚动条：
    - `scrollbar-width: thin;` 与 `scrollbar-color: var(--md-outline-variant) transparent;`
    - `::-webkit-scrollbar` 宽度收缩至 `6px`，轨道完全透明；
    - 滑块使用圆角全胶囊（`border-radius: var(--md-shape-full)`）搭配半透明轮廓色，悬停自适应加深；在锤子便签等自定义主题下自动继承暖色纸调。
  - 同步将 Desktop 主应用滚动条槽宽由 `10px` 优化收窄至 `6px`，全应用保持一致极简轻盈体验。
  - 内置 Mini App 全部递增 patch 版本号（Note 1.5.5, Todo 1.7.1, Meeting Notes 1.2.1, MD Preview 1.1.2, Mini Chat 1.0.6, miniapp-creator 1.4.1）。
- **验证与守卫**：
  - `src/lib/server/miniapps/uiDesignBaseline.test.ts` 新增对所有 Mini App 及模板样式表滚动条规则的自动化守卫断言，6/6 测试全部通过。
  - `apps/desktop/src/chat-ui.test.mjs` 新增滚动条规则断言；`svelte-check` 0 错误 0 警告。

### Desktop 切换/打开历史会话时闪烁「未配置可用文本模型」修复（已完成，P1）

- **状态解耦**：
  - 将 `ChatView.svelte` 中的 `modelReady` 判定与 `modelSelectionHydrating` 解耦，`modelReady` 仅反映系统是否存在可用模型。
  - 会话模型水合加载态（`modelSelectionHydrating`）独立控制输入框与模型选择器的禁用状态及 `sendMessage` 前置守卫，彻底消除打开历史会话时因异步拉取模型配置而短暂误报「未配置可用文本模型」的问题。

### Desktop 侧边栏分组标题滚动体验优化（已完成，P2）

- **移除吸顶与伪元素遮罩**：
  - 移除 `.sidebar-section-head` 原先的 `position: sticky` 吸顶机制与背景遮罩，使「对话」、「项目」和「小程序」等分组标题随会话列表自然滚动。
  - 彻底解决吸顶时下方列表文字向上穿透导致的文字重叠/杂乱问题，以及实体背景遮罩破坏 macOS 毛玻璃质感的问题。
  - 内容向上滚动时统一在上方固定导航栏（新对话/自动任务/技能/Agent/小程序）的下边界处平滑裁切。


### Session Title 自动总结修复与增强日志（已完成，P1）

- **Desktop SSE 实时同步**：
  - `conversationTurn.ts` 支持解析 `session_title_updated` SSE 事件，并在 `conversationController.svelte.ts` 收到时立即触发 `refreshSessions()` 刷新侧栏，解决客户端依赖 turn 结束竞态刷新导致 title 无法及时呈现的问题。
- **Project 会话跨存储定位支持**：
  - 修复 `SessionStore.getConversationById` 和 `renameConversation` 原先无法定位 Project 目录下会话（`/projects/{projectId}/sessions/...`）的问题，打通 `resolveSessionStorage` 兜底机制。
- **增强标题覆盖判定规则**：
  - 判定未自定义标题时，将原消息全文作为初始标题（短消息未截断）的情况正确识别为可自动总结状态，避免短消息被误判为“用户已手动改名”而跳过。
- **全链路结构化调试日志**：
  - 在 `titleSummarizer.ts` 中加入涵盖触发参数、会话查找、初始状态比对、模型与 API Key 准备、LLM 耗时及重命名结果的完整日志输出。

### Note MiniApp 升级：Markdown 渲染排版与明暗双色分享图（已完成，P1）

- **分享图片完整支持 Markdown 语法富文本渲染**：
  - 不再输出生硬的 Markdown 源码纯文本，而是通过内置轻量渲染管线解析为排版完整的富文本卡片：
    - **标题**（`#`、`##`、`###`）字号与权重分级；
    - **文字格式**：粗体（`**加粗**`）、斜体（`*斜体*`）、高亮、行内代码（`code`）；
    - **排版块**：代码块（`pre code` 独立背景与等宽字体）、引用块（`blockquote` 左侧竖线装饰与微底色）、无序/有序列表（`ul`/`ol`/`li` 缩进与标记符）、分割线（`hr`）等。
- **分享图片全面支持明暗双色模式**：
  - **锤子主题暗色模式**：分享图自适应深色，采用深色石墨纸质底（`#131113` / `#1c1a1c`）、深灰内外双层线框（`#332f33`）及暖棕高对比度文字（`#e6ded6` / `#baa996`），在暗黑模式下生成风格统一的拟真深色信纸卡片。
  - **Keep 主题暗色模式**：分享图自适应深色 Google Keep 卡片色阶（`#1a1a1c` 底色，随笔记颜色呈现深灰/深黄/深蓝等 Material 暗色色阶）及浅色文本（`#e8eaed` / `#bdc1c6`）。
- **锤子主题下「分享」按钮样式与 Header「返回」按键完全统一**：
  - 锤子主题下的「分享」按钮采用与顶部返回/控制按键完全一致的**复古拟物按键质感**（`linear-gradient` 半透明玻璃高光、`rgba(0,0,0,0.35)` 微描边、内阴影高光以及微圆角 `4px`），悬浮与按压交互完美统一。
- **极简化分享图预览弹窗**：
  - 移除了冗余的底部按钮，仅保留简洁明了的指引提示「长按或右键图片即可复制/保存」，弹窗整体更干净紧凑。
- MiniApp 版本升级至 `1.5.9`，测试全部通过。

## 2026-08-18

### 审批等待改为挂起与异步恢复机制，消除内联等待超时（已完成，P1）

- **审批等待解耦与短窗口握手**：
  - `ToolRuntime` 中的 Broker 审批等待从原先的 5 分钟内联长轮询重构为 **30 秒短握手窗口**（`BROKER_APPROVAL_INLINE_WINDOW_MS = 30s`）。
  - 用户秒级点批准时维持快速内联执行；超过 30 秒则干净落盘并挂起为 `waiting_for_approval` 状态并释放租约/连接，彻底消除审批等待吞噬外层工具执行超时（如 `mcpInvoke` 300s 超时）的结构缺陷，支持用户在几小时或数天后随时批准。
- **中止与超时落终态（Bug 修复）**：
  - 当处于审批等待中的 Run 被外部 Stop 或上下文取消时，`ApprovalService.expireRequest` 会将对应的 Broker 审批请求明确更新为 `expired` 终态，防止死 Run 的悬挂请求永远停留在 pending。
- **聚合审批 Grant 粒度修正**：
  - `ApprovalBroker.resolveRequest` 在为非 write 类工具（如 `mcp:*`、`plugin:*` 等）生成授权（Grant）时，不再强行绑定批次聚合指纹 `{fingerprints:[...]}`，改为按能力（Capability）、用户（Actor）与作用域（Scope）匹配，确保「本会话允许」与「一直允许」在后续新入参调用中真实生效。
- **跨平台异步恢复中枢（`brokerApprovalResume.ts`）**：
  - 新增 `brokerApprovalResume.ts` 共享恢复模块，在用户通过 Web、Desktop 或 Channel 异步批准或拒绝挂起请求后：
    1. 改写上下文中的挂起 `toolResult` 为明确的 Runtime Notice（批准提示模型重新发起调用，拒绝提示模型停止重试）；
    2. 通过 `TurnOrchestrator` 自动复用原 `runId` 恢复执行，无缝承接后续任务。
- **全入口接线**：
  - **Web 端 (`/api/chat`)**：修复 `_handleWebHostToolsCommand` 缺乏 Broker 回退导致卡片点击无效的问题，并在批准/拒绝后触发异步恢复。
  - **Desktop 端 (`/api/desktop/host-bash`)**：在 `resolveDesktopBrokerApproval` 完成后接入异步恢复。
  - **Channel 端 (`channelCommands.ts`)**：在 `resolveBrokerApproval` 成功后触发异步恢复。
- **验证守卫**：
  - `toolRuntime.test.ts` 新增短窗口超时挂起与中止落终态测试；
  - `approvalBroker.test.ts` 新增聚合指纹豁免与文件写入指纹严格匹配测试；
  - `brokerApprovalResume.test.ts` 新增上下文改写与恢复测试；
  - 全部 39 项审批与运行相关单元测试通过。

### 统一审批中心全面重构与全能力白名单管理（已完成，P1）

- **全能力动作分类推断与聚合存储**：
  - `HostBashStore` 升级为通用审批存储层，支持全量动作分类（`bash` 命令行、`mcp` 外部工具调用、`file_write` 文件修改、`miniapp` 插件应用），从 `capability` 前缀与 `action_json.type` 自动推断。
  - 完整保留并结构化解析 `payload`（`path`、`diff`、`parameters`），提供统一的只读审计、长期白名单与历史流水管理。
- **全量过滤查询与超时态支持**：
  - 移除 SQL 中所有硬编码的 `capability LIKE 'bash:%'` 限制，`listPending`、`listWhitelist`、`listHistory` 与 `hasAnyData` 支持按 `category`（`all` / `bash` / `mcp` / `file_write` / `miniapp`）、`status`（新增 `expired` 超时态）、`approvalMode` 及关键词联合过滤。
- **持久化 Scope 解锁与通用审批 Prompt**：
  - `toolRuntime.ts` 与 `approval.ts` 优化：根据 Tool Policy 的 `scopeOptions`（`["once", "session", "persistent"]`）为非 Bash 工具（如 MCP、文件写操作）开放持久化选项（`approve_persistent`），支持“本 Bot 一直允许 / 本项目一直允许”。
  - 优化审批卡片格式化逻辑，针对 MCP 工具、文件修改与 Bash 命令定制化展示操作类型与目标。
- **统一 API 接口与平滑兼容**：
  - 新增统一 API 路由 `/api/settings/approvals`（支持 `listPending`、`listWhitelist`、`listHistory`、`toggle_whitelist`、`delete_whitelist`、`delete_history`）；`/api/settings/host-bash` 增加 `category` 筛选支持以保持向后兼容。
- **Web 端与 Desktop 界面升级**：
  - **Web 端 (`/settings/approvals`)**：侧边栏更名为「审批管理」，提供全部/命令行/MCP/文件/插件多分类过滤、彩色分类徽标、状态胶囊与参数展示，`/settings/host-bash` 平滑重定向。
  - **Desktop 桌面端 (`HostBashSection.svelte`)**：多语言更名为「审批管理 (Approvals)」，在筛选栏新增分类下拉控制器（`categoryFilter`），各数据行新增彩色分类胶囊。
- **验证守卫**：
  - `src/lib/server/hostBash/store.test.ts` 新增多分类过滤与动作推断单元测试；
  - `store.test.ts`、`approval.test.ts`、`desktopHostBash.test.ts`、`desktop api.test.ts` 全部 104 项单元测试通过；
  - Desktop `svelte-check` 0 错误 0 警告；`npm run build` 全量打包构建成功。


### MD Preview 内置小程序优化与新增「Macaron · 甜彩微排」主题（已完成，P1）

- **新增 Macaron（甜彩微排）主题**：
  - 汲取微排（Punk微排，`https://weipai.iamadrianpunk.com/`）的版式结构精髓，去除原站黄色，定制了**马卡龙甜彩配色体系**（清雅薄荷绿 `#38A3A5`、柔和蜜桃粉 `#FF9AA2`、香芋紫 `#9B89B3`、奶泡底白 `#FAFDFB` 及高对比正文墨色 `#243746`）。
  - **macOS 风格代码框**：在代码围栏顶部内联注入带粉/黄/绿马卡龙三色圆点与 `CODE` 标识的 macOS 窗口控制栏，高亮配色走 Prism 马卡龙定制语法高亮。
  - **标题与结构装饰**：H1 居中带甜桃粉指示底条，H2 章节居中带甜桃下划装饰，H3 带左侧 4px 粗装饰线，引用块带柔和薄荷渐变卡片与边框阴影，表格带 2px 双横线。
  - 所有样式完全通过内联样式（inline styles）生成，100% 完美兼容微信公众号网页编辑器粘贴。
- **小程序交互与体验优化**：
  - **右下角固定悬浮切换按钮**：将主题切换器从上方 topbar 移至右下角固定悬浮胶囊按钮（FAB），点击后向上呼出主题菜单，随时随地一键切换，释放顶部导航空间。
  - **主题偏好记忆**：接入 `localStorage` 本地存储，切换主题后自动记忆，刷新页面或切换文档不再被重置回默认主题。
  - **快速上手示例**：在空状态新增「加载排版示例」快捷按钮，无需导入文件即可一键载入涵盖 H1/H2/H3、多级嵌套列表、引用、macOS 代码块与数据表格的全功能演示稿。
  - **主题选择器视觉升级**：主题下拉菜单新增 Macaron 主题专属多色甜彩 Swatch 色块指示、标题与说明文案。
  - **版本 Bump 与规范对齐**：依 MiniApp 规则 bump `manifest.json` 至 `1.1.1`；修复浮动按钮与向上弹出菜单层叠上下文与定位；严格遵循 `uiDesignBaseline` M3 token 规范，零硬编码字体大小。
- **测试守卫**：`src/lib/server/miniapps/mdPreview.test.ts` 新增 Macaron 主题设置持久化与定义测试；`uiDesignBaseline.test.ts` 及 `bootstrap.test.ts` 30 项测试全绿；全量生产构建 `npm run build` 通过。


### 沙箱安全策略档位 UI 重构与体验打磨（已完成，P1）

- **4 档预设卡片矩阵与语义化标签体系**：将原粗糙的「单条滑块 + Emoji 字符串（`🌐❌ · ✏️❌`）」重构为现代化的 4 档交互式安全卡片矩阵（`锁定`、`只读`、`标准`、`全开`）。每档包含专属安全图标、安全级别徽标（`最高隔离` / `安全探索` / `推荐开发` / `完全信任`）、网络 / 文件 / 环境变量三维微型胶囊标签（如 `🌐 常用开发源`、`📁 可写项目`、`⚙️ 白名单环境`）与清晰的一句话使用指引。
- **平滑双向联动的严格度光谱滑条**：在卡片下方集成具备「最严格 🛡️ ➔ 最宽松 ⚡」两极提示的平滑光谱滑条与步进刻度点，支持鼠标拖拽、卡片点击与键盘左右方向键（无障碍标准）无缝双向双控。
- **自定义策略状态呼出与一键重置**：当用户在下方微调网络、文件或环境变量配置导致策略偏离预设时，自动优雅呼出「当前为自定义策略」提示卡片并提供「重置为标准预设」一键恢复操作。
- **macOS 与 Web 端全栈对齐与主题自适应**：零硬编码色彩，全量复用 `DESIGN.md` 与 AppKit 语义色彩 token（`--card-bg`, `--surface-secondary`, `--label-primary`, `--label-secondary`, `--online`, `--accent`, `--warning`, `--danger`）；桌面端与 Web 端（`/settings/sandbox`）同步升级并完整支持中英文双语实时切换与响应式栅格布局（大屏 4 列、中屏 2 列、小屏 1 列）。
- **验证守卫**：`svelte-check` 0 错误 0 警告；`chat-ui.test.mjs` 211 项测试全通（通过 11px 排版下限断言、滑条交互断言与语义 token 断言）；`desktop:test` 全部通过。

### Trace 活跃运行状态与 Runner 重试生命周期 Hook 修复（已完成，P1）

- **Runner 重试生命周期 Hook 单次发射与终态保护**：修复模型候选 Fallback 或空回复重试时，底层 `agent_end` 提前触发 `finishHookRun()` 导致后续重试的 `agent_start` 将 Trace 事实表覆盖为 `started`、且终态 `run.finished` 被拦截漏发的问题。将 `run.started` 加守卫为单次发射，移除单轮 prompt 的 `agent_end` 对全局 `finishHookRun()` 的早退触发，确保仅在整个 Runner turn 退出（`finally`）时发射最终状态（`success`/`error`/`aborted`）。
- **SQLite Trace 事实表防倒退与过期孤儿对齐**：在 `SqliteTraceStore.upsertFact` 增加终态保护，禁止处于 `success`/`error`/`aborted` 终态的事实记录被非终态的 `started`/`waiting` 倒退覆盖；新增 `reconcileStaleOrphanRuns` 自动清理超时的非活跃孤儿记录，`/api/desktop/active-runs` 请求时即时对齐。
- **历史残留数据清理**：批量对齐历史遗留的 125 条未结束孤儿记录，Trace 页面下方「正在执行」恢复只展示真实活跃运行。
- **机器守卫**：`traceRecorderHook.test.ts` 补充终态防倒退单测与孤儿超时对齐单测；`runner.test.ts` 新增多轮重试下的 hook 单次发射与终态完成断言。

### macOS Desktop 运行历史多渠道聚合、Bot 筛选与分页体验优化（已完成，P1）

- **多渠道与项目工作区全量聚合**：重构服务端 `listAgentWorkspaces` 与 `readRunHistory`（`src/lib/server/agent/session/reviewData.ts`），打通 `moli-w`（桌面/Web）、`moli-t`（Telegram）、`moli-f`（飞书）、`moli-q`（QQ）、`moli-wx`（微信）、`system/bots` 与 `projects/*/runtime`；精准过滤 `skills`、`skill-drafts`、`events`、`scratch`、`attachments`、`contexts` 等非会话保留目录，实现全平台统一审计。
- **Svelte 5 响应式死循环与复合唯一 Key 修复**：`RunHistorySection.svelte` 的 `$effect` 增加 `untrack()` 隔离；`runHistoryStore.svelte.ts` 引入 `generation` 计数器与 `refreshing` 状态，捕获异常时不重置 `endpoint`，彻底消除无限重新触发与 `loading: true` 卡死问题；`#each` 采用复合唯一键避免多次追加 snapshot 引起的 `each_key_duplicate`。
- **Observatory UI 规范打磨、Bot 下拉与客户端分页**：加载中采用 `SkeletonRows` 骨架屏；空状态与无匹配搜索接入标准 `EmptyState`；顶部提供带状态感知的刷新按钮与统计徽标（成功/部分/失败）；筛选区域新增 Bot 原生下拉选择器（`SelectControl`）与关键词搜索组合过滤；列表底部新增客户端分页控制器（支持 10/20/50/100 条每页切换与翻页）。
- **测试守卫**：`reviewData.test.ts` 覆盖多渠道工作区及项目 runtime 发现；`api.test.ts` 新增 `loadDesktopRunHistory` 单测；桌面 211 项测试与 56 项 Rust 测试全通；`svelte-check` 0 错误。

### macOS Desktop Host Bash 审批与白名单管理设置页（已完成，P1）

- **对齐 Web 端完整能力并归入「活动」分类**：在 macOS 桌面端（`apps/desktop`）新增完整的 Host Bash 设置页（`HostBashSection.svelte`），归入侧边栏「活动 (Activity)」分类下；具备待处理审批（Pending）、长期白名单（Whitelist，支持一键切换启用/禁用与删除）、审批历史检索与审计（History，支持按状态、模式与关键词过滤）以及 4 个汇总指标卡片。
- **严格遵循 DESIGN.md 与多主题自适应**：统一采用标准 720px 居中内容流容器（`var(--settings-content-width)`），消除全屏过度拉伸与分组标题居中漂移；零硬编码颜色，全量基于 CSS 语义变量（`--card-bg`, `--surface`, `--surface-secondary`, `--label-primary`, `--label-secondary`, `--separator`, `--accent`, `--danger`, `--online`, `--warning`），在所有桌面主题（浅色、深色、macOS 毛玻璃）下完美适配。
- **原生组件与安全确认**：复用既有的 `IosSwitch`、`SearchField`、`SelectControl`、`AlertDialog`、`EmptyState`、`StatusBadge` 等原生组件，具备删除确认弹窗与快捷过滤。
- **验证与守卫**：`svelte-check` 0 错误；`chat-ui.test.mjs` 211 项测试全通（含 Geist CSS 变量完整性、11px 字体下限及 settings 分组结构断言）；生产构建 `npm run build` 通过。

### macOS Desktop 聊天滚动吸底与“回到最新”按钮状态修复（已完成，P1）

- **触底回弹与亚像素吸附修复**：修复 macOS 触控板滑到底部时橡皮筋回弹微移（`moved < 0`）与视网膜高分屏浮点误差（`dist <= 0.5px`）无条件解绑 `pinned` 状态的问题。在 `dist <= SETTLE_DISTANCE`（容差 2px）内将微小向上运动正确识别为触底回弹/亚像素抖动，不再误判为用户主动翻看历史。
- **回到最新显式唤醒**：`TranscriptDock.svelte` 点击“回到最新”从浏览器的 `scrollElement.scrollTo({ behavior: 'smooth' })` 改为显式调用 `resumeStickToBottom`，统一通过物理弹簧动作同步 `pinned: true` 并平滑回到底部，点击后按钮立即消失且 AI 流式回复无缝继续自动滚动。
- **机器守卫**：新增 `stickToBottom.test.ts`（覆盖回弹容错、亚像素吸附、翻看历史解绑、会话切换跳转及 resume 事件）；更新 `chat-ui.test.mjs` 结构断言。

### Web 聊天页面审批卡片 UI（已完成，P1）

- **审批事件接入与卡片渲染**：Web 聊天前端（`src/routes/+page.svelte`）在 `consumeSseResponse` 中处理 `host_bash_approval` SSE 事件，并在实时输出区域下方渲染包含标题、工具名、命令内容及原因说明的警告风格审批卡片。
- **一键审批解决**：卡片提供「拒绝」「本会话允许」「仅此一次」三个操作选项，点击后调用 `/api/chat` 的 `/hosttools` 接口直接解决审批，自动重连/拉取最新会话消息。
- **会话状态联动**：切换会话或发送新消息时自动重置审批状态，防止状态泄露；支持中英文多语言与明暗主题自适应。

### 微信/QQ 模型降级后回复被吞修复：runlog 归档通知闭包未定义 `scopeId`（已完成）

- 修复 weixin / qq `processEvent` 的 `onRunComplete` 闭包引用未定义 `scopeId` 的 ReferenceError（6-16 引入）：异常只在 `threadEventCount > 0`（即模型降级通知走 `respondInThread`）时抛出，导致降级 run 的真实回复被吞、用户只收到兜底 "Internal error."，而 session 与 run-detail 均显示成功。
- 归档通知谓词抽为共享 helper `createRunArchiveNoticeOnComplete()`（`channels/shared/runArchiveNotice.ts`），`scopeId` 为必填构造参数；weixin / qq 统一接入，feishu / telegram 原实现已正确、不动。
- 机器守卫：`runArchiveNotice.test.ts` 覆盖降级形态（`threadEventCount > 0` 发通知）与四个反例（无 thread 事件 / 无 runId / 非正常结束 / runlog 关闭）。

## 2026-08-17

### Auto 权限模式 × 沙箱联动 + 沙箱预设单轴滑条（已完成）

- **Auto 模式联动（PRD §3.65）**：新增共享层 `liftSandboxForPermissionMode()`（`src/lib/server/agent/tools/sandbox.ts`）——session 权限模式为 `auto` 时，该 session 有效沙箱网络自动提为 `["*"]` 全放行，域名白名单不再静默杀掉命令并触发审批卡；主工具链（`tools/index.ts`）与 subagent bash 路径（`subagent.ts`）统一走该共享函数，无逐工具补丁。
- **沙箱拒绝自动升级放行**：`bash.ts` 新增 `autoApproveSandboxEscalation` ——auto 模式下沙箱权限拒绝后的 host bash 升级不再弹审批卡，直接回退到宿主执行并标注 `[AUTO]`；与既有 session-approved 分支同路径复用。manage 类（第三方代码安装/执行）仍走审批 broker 询问，安全底线不变。
- **沙箱设置页 4 档滑动条**：`/settings/sandbox`（Web）与 `apps/desktop` 原生设置（`SandboxSection.svelte` + `api.ts` 预设 + `i18n.ts` 文案 + `styles.css`）同步改为单轴严格度滑条：锁定（绿）→ 只读 → 标准 → 全开（红），颜色全部走主题 token（Web 新增 `--success`，桌面复用 `--online`/`--danger`），零 hardcode；手动修改细节仍自动落入「自定义」档。新档位「全开」= 网络 `["*"]` + 可写项目目录。
- 关系文档：`docs/guides/permission-and-sandbox-modes.md`（两轴口径、覆盖链、十字矩阵）。回归：`sandbox.test.ts`（lift 纯函数矩阵）、`bash-output.test.ts`（auto 升级放行）。

### MCP 工具常驻注册：能力存在与否不再由用户消息文本决定（已完成）

- 取代上一版「扩展 NLU 词表」的方案：`hasExplicitMcpInvocation()` 及整词匹配删除，`loadMcp` / `mcpInvoke` 的注册与 prompt `<mcp-access>` 段改为派生自同一谓词 `hasConfiguredMcpServers(settings)`（`src/lib/server/settings/openConnector.ts`）--配置了任意 MCP server（含 disabled，`loadMcp` 能解释缺什么）即常驻注册，零配置则两侧都不出现（修复 s-20260817-ztfk：prompt 教模型用 `loadMcp` 但门控在猜「这句话算不算点名 MCP」，猜错即死路）。
- 「是否加载某个 server」完全交给模型经 `loadMcp` 决定；prompt 中「仅显式要求时用 MCP」降级为成本建议（`avoid speculative loads`），违反也不再有正确性后果。
- 机器守卫：`prompt.test.ts` 不变量测试锁死 prompt 宣传 ⟺ 注册门槛（enabled / disabled / 零配置三档 + `runner.ts` 结构断言：门控必须写 `hasConfiguredMcpServers(settings)`、不得再引用 `hasExplicitMcpInvocation`）。回归：`prompt.test.ts` 33/33、`runnerHelpers.test.ts` 7/7、`runner` + `loadMcp` / `mcp` / `toolClassification` 65/65；tsc 触碰文件 0 错误。

## 2026-08-16

### Project 自动任务（已完成，P0）

- Project 成为现有 `periodic` Runtime Task 的一级执行目标：任务落在 Project workspace 的 watched `events/` JSON 目录，调度器和“立即运行”共用同一个 Project dispatcher、执行租约与超时停止链路，不新增数据库、OS scheduler 或 Channel 层编排。
- 每次触发复用现有 `fresh` 任务归档语义并进入 Project Runtime，运行时读取 Project 当前 root、规则、Agent、Skills、Memory、模型、Sandbox 和 Workspace；执行结果、runId、Session 与 transcript 只留在 APP，自动化会话不进入普通 Project 会话树，也不向任何 Bot/Channel 出站。
- Desktop 全局自动任务新增 Project 分类；Project 设置新增“常规 / 自动任务”Tabs。两处复用同一列表、编辑器、计划构建器、启停/删除/立即运行、执行历史和 transcript，Project 内入口锁定目标且只允许 Agent + `fresh`。
- Project 新建/删除会重启共享 task watcher 注册；Project 删除后孤儿目录不再参与发现或调度，是否移除 Project workspace 继续遵守既有 `removeSessions` 选择且永不删除工作目录。
- 验证：临时 dataDir + SQLite 的 Project CRUD/发现/手动 dispatcher 回归、Project Runtime 路由与隐藏 automation Session 回归、调度 target 守卫及 Desktop 投影共 120/120；Desktop UI 结构测试 207/207；Desktop `svelte-check` 0/0；Root 与 Desktop production build 通过。真实冷启动走查已验证全局 Project 分类、Project Settings → 自动任务、Project 内锁定目标及全局 Project 选择器，临时测试数据已清理。

### MD Preview 内置小程序（Markdown 预览 + 公众号复制 + R2 图床，P1）

- **Icon 视觉升级**：更新 `ui/icon.svg` 为立体双色暖橙圆形徽章（`#FB8C00` 活力橙基底 + 右侧 `#E65100` 深橙半弧阴影 + 放大清晰版 `#FFE0B2` 浅橙 Markdown `M↓` 专有符号），在保持与 `meeting-notes` / `note` / `mini-chat` 相同设计质感的同时，独立于 `todo` 的方形卡片造型。
- 新增 opt-in 内置小程序 `md-preview`（Mini Apps 管理器"内置"页安装）：把 Markdown 文档渲染成可切换主题的预览，并一键复制为微信公众号格式（全内联样式，`text/html` + `text/plain` 双风味写剪贴板，带 execCommand 兜底）。预览 DOM 即复制内容，所见即所得。
- **主题**：Momo Paper（暖米书卷）与 Vercel Geist（极简）两套（移植自 momo-paper 的 markdown-to-mp 参考实现），各配同源代码高亮配色；代码高亮由 vendored Prism（core + 14 种语言，构建期内联,manual 模式）驱动，marked 负责解析。
- **Agent 工具 `preview`**：走 `fileParams` 宿主 staging（零 Token 传文件），Agent 传 Markdown 工作区路径 + 本地图片列表；图片引用按 basename 匹配，未解析的本地引用在工具结果里报回（Agent 补传重试），结果卡片 deep-link 直开面板文档。面板也支持本地 .md 文件选择器。
- **R2 图床**：应用内设置页（Account ID / Endpoint(可选,兼容任意 S3) / Region / Bucket / Access Key / 只写 Secret / 公开前缀 URL / key 前缀 + 连接测试）；上传在 App 子进程内以 node:crypto 实现 AWS SigV4 PUT；对象 key 内容寻址（`sha256.ext`,可选前缀），跨文档经映射表去重不重传。
- **核心契约**:上传只改映射,不改文档 —— Markdown 源文件(磁盘与 DB 记录)始终保持本地图片路径,R2 URL 只存在 `assets` 表,复制时取用;存在未上传本地图时复制前弹窗让用户选择(先上传/仍要复制/取消)。
- 远程图片预览走服务端 data-URI 代理（iframe CSP 仅允许 `'self'` + `data:`），复制时保留原 URL；Secret 只写不回显；面板与文档列表/删除、主题偏好持久化。
- **修复**：主题下拉点击后只出蒙版、菜单不可见——`app.js` 残留旧 tab 设计的 `#tab-momo`/`#tab-vercel` 空引用导致模块级崩溃（`boot()` 及上传/设置/文档加载全部失效）；已接线 `#theme-trigger` 下拉（开合 + backdrop + 菜单选择 + trigger 标签/色块/选中态同步 + 持久化 + `aria-expanded`），版本 bump 1.0.2。
- **修复**：R2 设置保存不落库——面板保存走 `PUT /api/settings`，但宿主 HTTP 门禁与 SvelteKit 路由仅放行 `GET/POST/PATCH/DELETE`，PUT 到应用前即 405（测试连接因此报 "Bucket 没有配置"，禁用重开后配置消失）；已放行 PUT 并补 httpRoute 回归（PUT 全链路 + 落盘 + 同 dataRoot 重启保持）。主题下拉改为与触发器左缘对齐（`left: 0`），不再向左溢出遮挡文档标题区。
- **修复**：R2 测试连接报 `SignatureDoesNotMatch`——SigV4 credential scope 区域被硬编码为 `$`（签名密钥用真实 region、scope 却写 `$`，验签必失败）；测试连接的 GET LIST 还把 `content-type` 列入 SignedHeaders 却没发送该头。已改为 scope 用真实 region（R2 为 `auto`）并补发 `content-type`，用 aws4 参考实现交叉验证签名逐字节一致，版本 bump 1.0.3。
- 验证:`src/lib/server/miniapps/mdPreview.test.ts`（manifest+fileParams、图片引用匹配、未解析引用报告、SigV4 PUT 形状与内容寻址 key、上传不改源文、跨文档上传复用、设置掩码、代理校验）;`uiDesignBaseline` 与 `bootstrap` 内置断言已更新；DOM 桩冷启动冒烟通过。

### Agent 图像生成动态自定义引擎（已完成，P1）

- Web 与 Desktop 的图像生成设置支持添加多个自定义引擎；创建时填写 ID/显示名称并选择 `images/generations` 或 `chat/completions`，创建后协议只读不可改。
- Agent provider 按引擎协议分流到通用 Image Generations / Chat Completions 请求，支持默认引擎、显式测试、启停与删除；Desktop 不回传已保存 API Key。
- 共享 sanitizer 以带 `engines` 的请求作为权威集合，避免删除后被 fallback 补回；统一 SettingsStore sanitizer，补齐临时 SQLite 的 save → fresh store → load 与删除回归；`auto` 保留 ID、畸形 Desktop payload 和空自定义端点均有守卫。
- 验证：图像/设置聚焦套件 55/55；root production build；Desktop `svelte-check` 0/0；Desktop Vite build。Desktop 全套 263/264，唯一失败为既有 SessionStore SQLite `bm25` 测试。

## 2026-08-15

### Mini App 工具文件入参宿主 Staging（通用能力，P0）

- Mini App 架构支持通过 `manifest.json` 为工具声明 `fileParams`（`accepts: ["file"|"image"]`、可选 `maxBytes` 上限 1..64 MiB 缺省 25 MiB、可选 `multiple: true` 数组形式）。
- Agent 调工具时传普通工作区相对路径，宿主沿用与 Agent 文件工具完全一致的路径解析与 allowed-roots 守卫（`resolveToolPath` 展开 `~`、`createPathGuard` 限制工作区与白名单根）。
- 校验（guard / 存在性 / 大小 / kind 扩展名）全部在拷贝前执行（pitfall 26d validate-before-side-effect）；通过后复用 `stageIncomingResource` 写入该 App 私有 `dataDir/incoming/`，工具参数原位改写为 `incoming/...` 相对路径，原文件名与文件类型通过 `context.stagedFiles[paramName]` 传给 App handler。
- 子进程运行时（`MiniAppProcessRuntime` 与 `untrusted-miniapp-worker.mjs`）跨 IPC 透传 `stagedFiles`，在独立进程内重构 handler context。
- 解决文档渲染/多媒体处理类 App 必须让大文件内容经过模型上下文的 Token 浪费问题，并让隔离运行的 App 能够访问被引用的本地附属资源（如文档图片）。
- 验证：`npx tsc --noEmit` 零错误；miniapps 完整测试套件 73/73 pass（新增 manifest 校验、路径与跨根守卫、IPC 跨进程 staging 回显）；服务 bootstrap 24+21 pass。

## 2026-08-14

### Release v2.9.25 / Desktop v0.9.22

- 升级 root 与 Desktop/Tauri 客户端包版本，发布弹簧跟随滚动与回合无缝交接、思考卡自动折叠、Mini Chat 沙箱会话删除与模型选择路由修复。

### Desktop Chat 动效第一批：弹簧跟随滚动与回合无缝交接（优化，P0）

- 新增 DESIGN.md **§Motion** 动效规范：沿用现有 token 三档时长（100/160/240/300ms）与 `--ease-standard`/`--ease-spring`，只允许动画 `opacity`/`transform`，写明"不动"清单（流式 token、键盘选择、高频 hover、用户直接造成的变更），并沉淀 transcript 跟随滚动与回合交接两条行为契约。
- `stickToBottom` 从"每次内容变更瞬移 `scrollTop`"重写为**可打断的 rAF 物理弹簧**（半隐式积分、帧率无关、流式期间逐帧重定目标；灵感来自 mini-chat 的实现但零依赖）。读者向上滚轮/触摸立即中断滑行并交还滚动所有权，回到底部阈值内自动重新吸附；Session 切换保持瞬时跳转；`prefers-reduced-motion: reduce` 与 `data-performance="low"` 回退为瞬移。`suspend/resume/SCROLL_PINNED_EVENT` 契约不变，TranscriptDock 无需改动，外部只读 transcript 同步受益。
- **回合结束交接消除"消失一帧"**：turn 结束的 reload 会把 optimistic `pending-` id 换成真实 id（re-key 消息行）并同帧移除流式气泡，此前 re-key 行从 opacity 0 淡入，正在看的回复会"灭掉再淡回"。现在把 `sending` 的下降沿并入 `settleEntrances` 的 key，re-key 行以全不透明挂载，交接读起来"什么都没发生"；发送时的乐观用户气泡与流式行仍保留入场淡入（上升沿被刻意排除）。
- `docs/work/plans/001-streaming-render-smoothness.md`、`docs/work/plans/002-chat-entrance-motion.md` 状态修正为 DONE（两份早已随 v2.9.x 实现，仅状态未更新，曾导致后续动效审计误判缺口）。
- 机器守卫：`chat-ui.test.mjs` 新增弹簧积分/滚轮中断/reduced-motion 回退的结构断言，以及 turn-end settle key（含下降沿排除上升沿）守卫。
- **思考卡在回答出现时自动折叠**：live 过程卡此前整个 turn 期间 `forceOpen` 常开，回答文本开始流式输出后思考时间线仍占着屏幕顶端。现在 `forceOpen={!liveSections.response.length}`--首个回答块（文本或 Plan）一出现就收起，回答领衔；`TurnProcess` 改为跟随 `forceOpen` 的双向跳变，折叠后状态归读者，手动展开不会被再次收起。DESIGN.md 过程披露契约同步更新。
- **Composer 聚焦样式收敛**：`.composer:focus-within` 不再把边框染成 accent 色（38% 混合的亮框过于突兀），聚焦只保留 3px 中性灰（`--label-secondary` 9%）的柔和光晕，边框维持常态 `--control-border`。
- 验证：手动行为矩阵全部通过（流式自动跟随/上滚立即打断/回底恢复跟随/切 Session 瞬时落地无动画/回答出现时思考卡自动折叠/composer 聚焦无边框亮色）；机器验证（`svelte-check`、`chat-ui.test.mjs`、production build）因会话内命令通道故障未执行，需在下个 slice 补跑。

### Release v2.9.24 / Desktop v0.9.21

- 升级 root 与 Desktop/Tauri 客户端包版本，发布 Mini Chat 轻量对话小程序、连续工具聚合与动作摘要、扁平执行时间线、AI 服务商模型前缀归组以及思考与工具调用实时顺序修复。

### Mini Chat 轻量对话小程序（新增，P0）

- Mini Chat 删除会话改用应用内 Astryx 确认对话框，不再依赖 iframe 禁止的浏览器原生 modal；确认后删除当前会话及其全部消息，并升级内置包至 v1.0.5。
- 新增可选安装的内置 **Mini Chat**（`mini-chat`，v1.0.5），界面基于 Astryx `ai-chat` 模板与组件构建，并随包保留其 MIT 第三方声明；支持中英、明暗/系统主题、移动窄宽度和独立会话侧栏。图标改为青绿双气泡，复用 Note/Todo/Meeting Notes 的主色、深色层与浅色高光家族风格，不再使用黑色方块底。
- 每个 Mini Chat Session 与消息由小程序自己的 `mini-chat.sqlite` 持久化；重启保留历史，启动时将未完成回复标为可重试的 interrupted，不复用也不污染 Agent Session。
- 模型请求走扩展后的 Host AI Facade `context.ai.chat()`，只提交经校验和有界裁剪的 `user/assistant` 历史；默认不设置 `system`，只在用户主动填写 Mini Chat 简短提示词时传入，始终不进入 Agent Runner，因此不会合并默认 Agent 系统提示词、记忆、Skills 或工具定义。
- 顶部齿轮设置可跟随小程序默认模型，或从已配置文本模型中为 Mini Chat 单独选择；可选系统提示词限 2000 字符。两者持久化到小程序自有设置文件，模型列表不包含 Provider 凭证。
- Mini Chat 显式选择的 PI 或自定义模型按请求覆盖全局 `textModelKey`，最终 Provider 路由和用量记录使用用户所选模型，不再被全局默认路由抢占。
- 支持新建/删除会话、Markdown 回复、复制、失败/停止后重试以及真实取消。取消信号可跨小程序子进程传到模型 Provider，不只是停止界面动画。
- Mini Chat 的文本调用固定使用 `low` reasoning；Provider 拒绝请求时，界面显示带 HTTP 状态的简短可操作原因，Host 会先移除凭证并限制长度，运行日志同时记录同一脱敏错误。
- Host AI Facade 支持 `onTextDelta`，Pi 原生文本增量可跨小程序子进程传递；Mini Chat 生成期间以轻量轮询读取内存增量，完成后才一次写入 SQLite，避免逐 token 写库。
- Assistant 消息移除占位过大的 `MC` 头像，并在 480px 以下收紧 Astryx 消息内层留白；metadata 通过气泡插槽与正文共享左边线，移动端隐藏侧栏不再向主内容投影。
- Mini App manifest 允许 `tools: []`，UI-only 应用无需为了通过校验而暴露虚假的 Agent 工具。
- 验证：Astryx UI TypeScript 检查、生产构建与 Mini Chat/AI Facade 定向回归通过；新增真实 Provider 路由回归，覆盖全局 `textModelKey` 已配置时按请求切换模型。Mini Chat 与内置安装回归通过；全量 Mini App 回归唯一失败为本切片之外 `toolAdapter.test.ts` 对已扩展风险元数据的旧等值断言。390px 实际渲染下正文与 metadata 左边坐标均为 44px，隐藏侧栏阴影为 `none`，页面无横向溢出，模型选择和系统提示词保存交互通过。

### Desktop Chat 连续工具聚合与动作摘要（优化，P1）

- 完成态时间线把连续且成功的读取、文件修改、搜索、命令调用压缩为一句可扫读的动作摘要；按唯一文件数或调用次数描述工作，不展示内部工具名堆叠。
- 展开摘要仍能按原顺序检查每次工具调用及 payload。运行中、失败和未知工具始终独占一行；思考或过程说明会中断聚合，排障信息不会被吞掉。
- 聚合只是一层纯展示投影，不改写会话活动、工具生命周期或持久化数据；Chat 与 Project Chat 复用同一实现，中英文、明暗和窄宽度共享语义样式。
- 机器守卫覆盖同类连续聚合、动作切换边界、运行/失败保护、未知工具保护与共享时间线接入。
- 验证：活动投影 16/16、Desktop TypeScript/结构测试 210/210、Rust 56/56、Project/活动 73/73，`svelte-check` 0 错误/0 警告，Root 与 Desktop production build、`git diff --check` 通过；临时数据冷启动、首次进入 Chat、页面切换、断服请求与同目录服务恢复通过，临时数据已移入废纸篓。

### Desktop Chat 扁平执行时间线（优化/修复，P1）

- Chat 与 Project Chat 共用一套过程展示：执行中默认展开，成功后折叠为克制摘要，失败/中断保持展开；展开后按真实到达顺序呈现思考、过程说明和工具动作，连续成功动作可在第二阶段压缩为一行摘要。
- 每次工具调用只显示一行生命周期记录；运行时的真实 `toolCallId` 从 Agent 事件贯穿到会话活动收集器，同名并行调用不会串行配对，结束事件也保留开始时包含目标文件/命令的具体标签。
- 完成摘要只使用稳定事实：耗时、工具次数、修改文件数；不再把思考分块数伪装成步骤数。工具 payload 仍可按需展开，错误 payload 自动展开。
- 机器守卫覆盖同名并行工具调用、实时/完成态展示策略、扁平时间线结构和稳定摘要。
- 验证：活动/Project 72/72、Desktop 全量 TypeScript/结构/Rust 测试通过（UI 206/206），`svelte-check` 0 错误/0 警告，Root 与 Desktop production build、`git diff --check` 通过；临时数据冷启动、首次进入 Chat、页面切换和服务重启恢复通过，临时数据已移入废纸篓。

### Desktop AI 服务商模型按名称前缀归组（优化，P1）

- 设置 → AI 服务商的模型清单与发现模型弹窗，统一按模型名第一个 `-` 之前的前缀分组；例如 `gemini-3.5-*` 与 `gemini-3.6-*` 现在归入同一个 `gemini` 组，不再按版本号拆组。
- 保留模型路径取最后一段、组内原始顺序、搜索、排序和折叠状态；空模型仍显示在本地化的“其他”组。
- 验证：Desktop UI 结构回归 206/206、`svelte-check` 0 错误/0 警告、生产构建通过，`git diff --check` 通过。

### Desktop Chat 思考/工具调用实时顺序恢复（修复，P1）

- Chat 与 Project Chat 共用的 `ConversationController` 改为按 SSE 到达顺序缓存 text/thinking chunk；工具调用与 Plan 到达时先 flush 之前的模型输出，再插入边界事件，实时列表不会再显示为“工具 → 之前的思考”或“结果 → 最后一段思考”。
- 版本追溯：有序 `liveSteps` 在 `3ce82e2a` 加入并随 v2.9.17 / Desktop v0.9.14 发布，但它直接叠加在 2026-07-18 已存在的分类型帧缓冲上，工具事件又同步入列，所以该功能从首个发布版本起就带有同帧竞态；之后 controller 的相关逻辑没有再次改动，不是 v2.9.18–v2.9.23 中某个版本删除了功能。
- 新增 controller 级回归，覆盖 `thinking → tool` 与 `thinking → answer text` 两种同帧边界；历史会话继续由结构化 `steps` 保持顺序，无需迁移。
- 验证：controller/transcript 11/11、历史 conversation projection 11/11、Desktop 全量 TypeScript/结构/Rust 测试通过，`svelte-check` 0 错误/0 警告、生产构建通过；使用临时 `DATA_DIR` 冷启动服务和 Desktop Preview，首次进入 Chat、切换自动任务后返回、断服后重启恢复均通过，临时数据已移入废纸篓。

### Release v2.9.23 / Desktop v0.9.20

- 升级 root 与 Desktop/Tauri 客户端包版本，发布 Meeting Notes 生产级 Live 录制工作室与历史检索过滤、设置页编辑弹窗、Memory 加载提速与 MCP 自动连接等优化。

### 设置页面修复：编辑弹窗、Memory 冷启动、MCP 自动连接、媒体测试区（修复，P1）

- **编辑弹窗宽度**：Agent / Web Profile / Channels / MCP 编辑弹窗实际渲染为 560px 而非 720px。根因是 `.entity-editor-dialog`（720px/86vh）与基类 `.desktop-dialog-content`（560px/80vh）同属单类选择器且作用在同一元素上，基类声明在后、级联胜出，导致 720px 覆盖失效、双列表单被挤。改为复合选择器 `.desktop-dialog-content.entity-editor-dialog`，覆盖对源序回归免疫。新增 `.provider-editor-toolbar` 基础规则，使文件区标题与下方 16px 内边距字段对齐，Channels 的测试按钮回到同一行而不是换行。
- **沙箱卡片**：`.sandbox-policy-grid .settings-card` 只重置 `margin` 未重置 `width`，卡片 664px 左对齐、右侧留不对称空白；现填充整个网格单元。
- **Skills 搜索配置**：折叠摘要继承 UA 16px 加粗、垂直内边距为 0，与相邻设置行不一致，页面看起来“错乱”；对齐到设置行的字号与盒型。折叠本身已由测试守卫（无 `open` 属性）。
- **Memory 白屏**：`loadMemory` 把 records/candidates/rejections 与慢速 LLM profile 合并进一个 `Promise.allSettled`，profile 合成需要数秒，期间概览区为空。现先 settle 快速三项并赋值，profile 随后单独 settle，不再阻塞整页。
- **MCP 自动连接**：APP 重新打开时 MCP 不再自动连接。新增 `reconnectAll` 动作，复用启动期 `reconcileMcpServers(connectEnabled: true)` 原语（幂等，已连接的跳过），在 `loadMcp` 发现任一 enabled 且未连接的服务时触发。保持在 GET 列表路径之外，避免单个配置错误的服务拖死列表加载。
- **图像测试区 / 语音测试区**：图像测试按钮改为与表单字段左对齐并加顶部内边距，不再拥挤错位；语音测试的 `<audio>` 高度从 34px 提到 40px，避免原生控件被裁剪（与 Web 端一致）。
- 机器守卫：在 `apps/desktop/src/chat-ui.test.mjs` 与 `src/routes/settings/mcp/mcp-ui.test.mjs` 增加断言覆盖级联选择器、沙箱宽度、工具栏基础规则、Skills 摘要排版、Memory 快/慢数据集顺序、MCP `reconnectAll` 动作与 `loadMcp` 触发。

### Meeting Notes 生产化 V1（新增/重构，P0）

- `2.2.0` 将现场页打磨为克制的“录音棚仪表盘”：计时器周围提供状态光环和音频生命体征，明确区分麦克风工作、暂停与收尾；空状态解释本机音频边界，异步按钮显示进行中状态。结束会议使用聚焦确认条并支持 Escape 取消。
- 历史库增加结果数量和“全部 / 处理中 / 已完成 / 需处理”筛选；搜索采用 220ms 防抖和请求序号守卫，旧响应不能覆盖新关键词。2 秒后台刷新不会再关闭结束确认，也不会覆盖正在编辑的会议标题。
- 用户首轮真实验收推翻了“基础设施完成即产品可用”的结论。Meeting Notes `2.1.0` 现在提供完整的 `录音中 → 已暂停 → 录音中 → 已停止` 原生状态机；暂停会冲刷当前不足 10 秒的缓冲，暂停期间不记录声音或推进有效时长，关闭面板后仍由 Desktop 宿主持有同一 capture。
- 页面从混合的“开始按钮 + 活动横幅 + 全量列表 + 双栏详情”重做为两个独立任务表面：会议现场只显示当前会议、大计时器、暂停/继续与二次确认结束；历史记录提供服务端全文搜索、日期分组、状态/有效时长、列表到详情的明确返回路径和完整空状态。活动会议不会在历史里重复出现。
- 会议域新增幂等 pause/resume、paused 活动保护和服务重启后的宿主状态对齐；原生 capture 仍存活时可把暂时标记为 interrupted 的未结束会议恢复为 recording/paused。
- 修复真实桌面录音首批 10 秒 WAV 无法上传：Base64 JSON 约 1.28 MiB，超过 adapter-node 默认 512 KiB 请求上限。启动器现于服务加载前设置有界 12 MiB 上限，音频路由继续独立执行 25 MiB 校验；超限返回明确 413，不再误报“Request body must be JSON”。
- 转写和总结失败现在写入安全结构化日志，会议页显示中英文故障类型、错误码和“设置 → 小程序 → AI”处理入口；总结中状态保持轮询。Meeting Notes 内置版本升级到 `2.0.1`。
- 线下会议录音改由 Desktop 宿主持有，不再由 Mini App iframe 的生命周期决定；原生采集每 10 秒旋转写入 WAV，内存有界，关闭会议面板后仍继续采集和上传。
- 音频块以 `meeting / track / seq / startMs / endMs` 进入独立 SQLite 领域模型；上传按序、至少一次且幂等，服务确认后才清理原生临时文件。停止操作提交显式最后序号，缺片、失败与采集告警都会把结果标为 partial，而不是伪装完整。
- 转写随音频块后台进行，时间轴每 2 秒刷新；每累计约 60 秒新证据滚动更新有界的会中临时纪要，停止后再用分层窗口生成最终纪要，长会议不再走单文件或单次全文 prompt。
- v2 支持多轨数据和 `sourceKind`，当前只启用 microphone adapter；未来系统音频只需新增采集来源，不改转写、时间线或纪要模型。
- 旧草稿 v1 数据不会进入兼容层；首次 v2 启动备份旧 SQLite 与音频目录后启用新格式。Meeting Notes 内置版本升级到 `2.0.1`。
- 本轮验证：Mini App/manifest/bootstrap 40/40、会议状态与搜索 13/13、Desktop UI 205/205、`svelte-check` 0 错误/0 警告、原生聚焦测试与 Root/Desktop production build 通过。应用内浏览器阻止 loopback，本轮没有把视觉冷路径误报为自动通过。

## 2026-08-13

### Desktop 设置模型分组与 Provider 保存后即时刷新（优化/修复，P1）

- 设置 → 模型的文本、视觉、语音转写、子智能体、高级路由、压缩与 Mini App AI 模型选择统一按供应商分组，组内每个模型保持单行；普通下拉继续使用原有平铺结构。
- 修复从 AI 服务商新增并保存模型后，切回模型页仍显示旧清单的问题。根因是两个设置 section 互斥挂载：Provider 保存事件发出时模型页没有监听者，而重新挂载又被相同 endpoint 的缓存条件拦截。模型页现在每次进入都强制拉取最新模型与路由数据。
- 机器守卫覆盖 Provider 保存 → 重新进入模型页的生命周期边界，以及共享 `SelectControl` 的正式分组结构；验证 Desktop UI 204/204、分组逻辑 6/6、`svelte-check` 0 错误/0 警告、生产构建通过。

### Desktop Chat 模型选择按供应商分组（优化，P1）

- Chat 与 Project Chat 共用的模型菜单不再把不同供应商平铺混排；供应商标题按原模型列表首次出现顺序展示，组内模型继续保持原顺序。
- 每个模型压缩为单行，只显示配置别名或可读模型名；完整供应商 / 模型 ID 仍可通过 tooltip 查看，路由 key、逐会话选择、选中勾选和键盘导航保持不变。
- 验证：分组展示单测、Desktop UI 结构守卫、`svelte-check` 与生产构建通过。

### Release v2.9.22 / Desktop v0.9.19

- 升级 root 与 Desktop/Tauri 客户端包版本，发布内置 Provider（含 OpenCode）自有传输与模型目录、支持 settings 覆盖检测 API Key 等修复。

### AI 自动会话标题总结（新增 → 修复，P1）

- 会话第一条用户消息到达时，系统不再采用截断首 40 字符的传统做法，而是触发自动感知系统多语言配置（`zh-CN` / `en-US`）的后台轻量级 LLM 请求。
- 请求在 `systemPrompt` 与 `prompt` 中注入对应的中文/英文提炼要求与 `reasoning: "off"`，自动将提问提炼为一句话短标题。
- Stream 与非流式请求接入 `tryAutoSummarizeConversationTitleAsync`；Stream 输出流在后台提炼完成后通过 `session_title_updated` SSE 事件即时推送到前端 UI 并刷新侧边栏。
- 若 API Key 未配置、网络超时或模型报错，自动降级安全保护，不阻塞主要聊天流。
- **修复**：初版使用 `completeSimple`（`@earendil-works/pi-ai/compat`）无法路由至自定义 Provider 的 base URL，导致标题始终不生效。改为使用 `streamWithPiRuntime`（项目统一 LLM 分发器），复用 compaction 同款 `.result()` 模式收集输出，兼容 Pi 内置 + 自定义 Provider。
- **修复（第二次）**：包装器 `tryAutoSummarizeConversationTitleAsync` 从 `getRuntime()` 解构 `settings` 后调用不存在的 `settings.get()`（运行时暴露的是 `getSettings()` 函数与普通对象 `settings`），每次后台运行都在入口抛 `TypeError: settings.get is not a function`，标题从未真正生成。改为 `getSettings()` 读取实时快照；新增注入 fake `__molibotRuntime` 的回归测试覆盖该接缝（此前测试只覆盖纯函数 `summarizeSessionTitleWithLlm`，这正是缺陷漏网的原因）。
- 验证：`titleSummarizer.test.ts` 通过（含 stream 异常兜底与 getSettings 接缝回归）；前端 `+page.svelte` SSE 解包正常；生产构建通过。

### Note 自动刷新与 Markdown 阅读模式（修复/新增，P1）

- Note 面板在可见期间每 2 秒读取共享 Mini App revision；只有 Agent 或 UI 写入使版本变化时才重新拉取笔记，隐藏页面停止轮询，重新聚焦立即检查。
- 卡片阅读模式支持标题、粗体/斜体、列表、引用、代码、链接和 GFM 表格；编辑弹窗继续保留原始 Markdown 文本。
- 渲染边界丢弃原始 HTML 和远程图片，并移除非 HTTP/HTTPS/mailto 链接，避免 Agent/用户内容获得脚本执行或隐式网络加载能力。
- 内置 Note 版本升级到 `1.4.0`；新增刷新竞态、Markdown 能力与不安全内容回归守卫。

### 内置 Provider 自有传输与模型目录（修复，P1）

- 内置 Provider（包括 OpenCode）不再进入自建服务商的 `baseUrl` 检查，也不再访问自建服务商的 `/models` 端点；模型拉取直接使用 Pi 随包目录。
- 内置 Provider 的检测现在通过真实的 Pi 运行时发起 minimal 请求，并把设置中保存的 API Key 作为运行时覆盖传入；OpenCode 的检测因此能区分本地配置错误与上游账户错误。
- 验证：新增内置模型目录与 API Key 转发回归；服务端 11/11、Desktop UI 203/203、`svelte-check` 0 错误/0 警告、生产构建通过。当前本机 OpenCode Key 已实际到达上游，返回的是账户余额不足，而非 Base URL 缺失。

## 2026-08-12

### Release v2.9.21 / Desktop v0.9.18

- 升级 root 与 Desktop/Tauri 客户端包版本，发布 D2 流程图服务端渲染、Markdown 中文表格乱码修复、Todo 任务列表布局调整以及亮度与主题家族完全解耦等改进。

### D2 服务端渲染与中文表格预览修复（新增，P1/P2）

- Markdown 的 `d2` fenced block 现在由 Desktop 服务端代理到 D2/Kroki 渲染，按当前解析后的明暗状态传递主题；服务端限制源码/输出大小、超时并缓存结果，客户端只把 SVG 放进 `<img>`，渲染失败时保留可复制的源码。
- AI 回复中的 Markdown 表格改用 UTF-8 CSV viewer，不再把聊天生成的 CSV 当作二进制 XLSX 读取；中文表头和单元格不再出现 `å§“...` 一类乱码。
- 左侧导航吸顶标题的背景改为与 Session hover 相同的 `var(--fill)`，继续保留模糊层和低性能/无障碍不透明降级。
- 机器守卫覆盖 D2 block 分流、服务端请求限制、中文 CSV、表格 viewer 选择和吸顶 token；定向测试、Desktop structural guard、`svelte-check` 与生产构建已纳入收尾验证。

### Todo 任务行操作悬浮化（优化，P1）

- 修复 Todo 列表操作按钮虽然不可见但仍占用 flex 宽度，导致长任务标题只能显示在按钮左侧、文字区域被挤压的问题。
- `.item-actions` 改为行内绝对定位的右侧浮层，标题区域不再为操作区预留空间；悬浮层使用 Todo 自己的明暗主题 surface、分隔线和轻模糊，保持按钮与下拉菜单可读、可点击。
- 保留 hover、触屏、键盘聚焦和菜单打开时的显示逻辑，并新增布局静态回归守卫；Todo manifest 从 `1.6.0` 升至 `1.7.0`，已安装副本可检测到更新。
- 验证：Mini App M3 基线与 Todo 浮层布局守卫通过，Todo 服务端与启动链路测试通过。

### Desktop 独立明暗模式与主题家族（新增，P1）

- 通用设置把“明暗模式”和“主题家族”拆成两个互不覆盖的控件：明暗模式提供“明 / 暗 / 跟随系统”，主题家族提供“精简（macOS）/ Rosé Pine / Catppuccin / Midnight”。两组偏好分别持久化，切换其中一组不会重置另一组。
- Rosé Pine 配套 Dawn / Moon，Catppuccin 配套 Latte / Macchiato；Midnight 补齐 Daybreak 亮色变体。CSS 通过 `data-resolved-appearance` 与 `data-theme-family` 组合解析所有 token，Chat Markdown、Agent City、Artifact 和原生窗口边界继续使用解析后的明暗状态。
- 所有主题家族沿用原生 macOS sidebar window effect 和 `blur(18px) saturate(160%)` 半透明模糊层；各家族提供自己的 tint，降低透明度、增强对比度和低性能模式仍使用明确的 opaque fallback。
- 验证：Desktop UI 200/200、Desktop API 85/85、完整 Desktop Node 204/204、Rust 55/55、`svelte-check` 0 错误/0 警告；Desktop/root production build、`git diff --check` 与真实冷启动走查均通过。

### Desktop 消息菜单与文件面板主题统一（修复，P1）

- Assistant 消息底部的 Mini App/技术详情共享菜单改为向上展开，使用通用 `OverflowMenu` 的显式 placement，不再向输入栏方向覆盖视觉空间。
- 右侧 File / Artifact Inspector 保留仓库树与编辑器的 Primer 风格层级，但画布、表面、边框、文字、强调色和状态色统一继承当前主题家族与解析后的明暗 token；切换 Rosé Pine、Catppuccin、Midnight 或 macOS 时不再停留在独立的默认色板。
- 验证：新增菜单 placement 与 Inspector shared-token 结构回归；Desktop UI 201/201、`svelte-check`、生产构建和 `git diff --check` 通过。

### Release v2.9.20 / Desktop v0.9.17

- 升级 root 与 Desktop/Tauri 客户端包版本，发布侧边栏毛玻璃恢复、全新 Midnight 午夜主题、计划完成度与退回提示等优化。

### Desktop 侧栏半透明模糊视觉恢复（修复，P1）

- Chat 与 Settings 左侧栏恢复主题半透明 tint 与 `blur(18px) saturate(160%)`，并继续叠加原生 macOS `sidebar` window effect；Light / Dark / Midnight / System 不再因为高不透明度或关闭的 WebView blur 失去玻璃层次。
- Light 使用 62% 浅色 veil，显式 Dark / Midnight 在浅色系统下使用各自主题 tint，系统深色外观下改为透明以保留原生深色材质；降低透明度、增强对比度和低性能模式保持不模糊的 opaque fallback。
- 验证：Desktop UI 199/199、Desktop Node 全套 203/203、Rust 55/55、Desktop API 聚焦测试 84/84、`svelte-check` 0 错误/0 警告、Desktop production build 通过。

### Desktop Midnight theme（新增，P2）

- Desktop 设置 → 通用 → 外观新增 `Midnight`（午夜）主题：深蓝黑工作区、冷蓝紫强调色，和 Light / Dark / System 并列，选择写入现有 localStorage 偏好并在重启后恢复。
- 原生 macOS 窗口只接收 Light / Dark / System 三种外观，因此 Midnight 映射到 Dark 原生材质；CSS token、侧栏材质、Agent City 清屏色、Artifact Inspector 和系统深色媒体查询均单独覆盖，避免 Midnight 被误判为浅色或被 OS 查询覆盖。
- Chat Markdown、Mermaid、PPTX、Artifact 和 Agent City 的外部/烘焙主题参数统一把 Midnight 解析为 dark appearance；中英文案和预览缩略图已补齐。
- 验证：Desktop UI 199/199、Desktop API 聚焦测试 84/84、`svelte-check` 0 错误/0 警告、Desktop production build 通过；构建仅保留既有动态导入与大 chunk 提示。

### Plan 结束态、决策位置与只读 Subagent（修复，P1）

- `exitPlan` 产生结构化计划后即结束本轮，不再因为没有普通文本回复而触发空回复重试、重复终态消息或耗尽工具预算。
- 对话投影以持久化 Plan 元数据为唯一事实源：同一用户轮次中的重试残留和重复计划会被归并为一张完整卡片；待确认 Plan 固定为完成轮次的最后一个可见决策，不再藏在后续思考/活动块上方。
- Plan 模式现在可以把大型只读代码调查交给 Scout/Planner Subagent；执行层在启动子任务前拒绝 Worker 等写入角色，并移除 Plan 子任务的 Bash 能力。其它权限模式的 Subagent 行为保持不变。
- 验证：相关服务端与 Desktop 回归测试 112/112，`svelte-check` 0 错误/0 警告，生产构建通过。Desktop 全套在 UI 阶段为 201/203，并因既有未提交 `styles.css` 改动触发的 2 个结构断言而在 Rust 阶段前停止；本次未修改该文件。

## 2026-08-11

### Release v2.9.19 / Desktop v0.9.16

- 升级 root 与 Desktop/Tauri 客户端包版本，发布设置页 Dialog 收敛与冷启 Reconcile、明暗代码主题与元信息折叠、输入栏首字母缩略与 Mermaid 源码切换等优化。

### Desktop 设置页稳定性与布局收敛（修复，P1）

- Agent、Web Profile、渠道与 MCP 编辑器统一复用共享 Dialog，并明确 portal 到 `body`：无论编辑按钮位于长列表的第几屏，编辑器都在窗口顶层居中；标题栏和操作栏固定，只有正文滚动；开关统一使用现有 `IosSwitch`。
- Skills 的“技能搜索配置”默认折叠并由摘要行点击展开；图像测试按“引擎/尺寸 + 提示词”对齐，语音服务按基础信息、音色/格式、宽屏密钥分组；沙箱网络与文件系统策略改为宽行堆叠，窄屏自动回到单列。
- 记忆页把摘要请求从附属记录、画像、候选和拒绝列表中拆出，摘要完成即解除首屏加载，并用请求代次阻止快速切换时旧结果回写。
- 运行时冷启动会对全部有效且启用的 MCP（含托管 OpenConnector）执行一次共享 registry reconcile；单个服务失败只记录启动错误，不阻塞应用启动。
- 验证：Desktop UI 199/199、`svelte-check` 0 错误/0 警告、Desktop 与服务端生产构建、MCP 聚焦测试 17/17、`git diff --check` 均通过。完整 Desktop Chat 套件仍为 250/252，失败是已有的 Node 直跑 `$derived` 与 SQLite FTS `bm25` 环境问题，与本次改动无关。

### Chat 代码主题与回复元信息收敛（改进，P2）

- Chat 与 Project Chat 的 Markdown 代码块不再固定使用暗色背景，改为和右侧 Artifact/File Inspector 共用同一组 GitHub/Primer 明暗语法色 token；浅色、显式深色与跟随系统主题不会再出现两个代码高亮体系。
- AI 回复底部在正常消息宽度继续内联展示耗时、工具/文件/Token 汇总、模型标识和真实使用过的记忆来源；仅当实际消息列窄于 620px 时折叠，不使用可能被右侧 Inspector 绕过的窗口宽度判断。
- 窄栏的技术详情与“存为笔记/待办”等 Mini App 消息操作合并到唯一的右侧“…”；鼠标离开触发器和弹层整体后自动关闭，并保留方向键、Escape 与无障碍 dialog 语义。机器守卫覆盖共享语法 token、三种主题分支、容器断点、单入口归属与离开关闭行为。
- 验证：Desktop UI 194/194，`svelte-check` 0 错误/0 警告，生产构建与 `git diff --check` 通过；浏览器冷开页面正常进入服务发现/诊断状态，并读取到系统深色模式的新 Primer 代码背景。浏览器不具备 Tauri 托管服务和本机会话数据，因此真实历史回复的点击走查留给 Desktop 运行态验收。

### Desktop 输入栏与侧栏身份密度优化（改进，P2）

- Composer 的 Bot/Agent 入口移除 `@`、完整名称、锁与下拉箭头，只显示一个可识别首字母；完整 Bot 名仍保留在 tooltip、无障碍标签和选择菜单中，路由与锁定语义不变。
- “自动改文件”等权限模式按钮移除尾部下拉箭头；图标、文字、hover/open 状态和完整键盘菜单继续表达可操作性。
- Bot 首字母颜色收敛到 `DESIGN.md` 的 6 个中深色阶并降低背景混合比例；Agent 下拉相邻选项固定使用不同色槽，侧栏按显示名与稳定 id 生成颜色，渠道图标统一为低强调线性图标。
- Project 下每组 Session 默认只展示最近 10 条，超过后显示“更多对话”，每次点击再展示 10 条，避免一个项目占满侧栏。
- 机器守卫覆盖首字母触发器、设计色来源、下拉色槽与 Project 10 条分批展开契约。

### Mermaid 源码切换与缩放预览（改进，P2）

- Chat、Project Chat 和 Markdown Artifact 中的每个 Mermaid 图表统一提供“预览 / 源码”切换；默认仍显示图表，源码可选中，并可一键复制。
- 图表预览可展开到共享图片查看器，支持缩放、重置与拖拽查看；明暗主题、双语和窄窗口沿用共享控件规范。
- 机器守卫覆盖两个 Mermaid 渲染入口必须共用同一组件，并检查切换、复制与放大能力，避免不同面板后续漂移。

### Mermaid 错误渲染布局隔离（修复，P1）

- Desktop Chat 与 Artifact Markdown 遇到 Mermaid 语法错误时，不再让 Mermaid 把巨大的临时错误 SVG 挂到应用根布局；窗口顶部、消息滚动位置和其它面板不会再被持续挤出视口，也不需要重启恢复。
- 消息内仍显示 Molibot 自己的本地化失败提示和原始 Mermaid 源码，正常图表、明暗主题重渲染、懒加载及 strict 安全级别保持不变。
- 验证：真实浏览器中坏图从“残留 1 个 body 子节点、页面高度 720→834px”恢复为“无残留、页面高度保持 720px”；机器守卫覆盖所有 Svelte Mermaid 渲染入口。

## 2026-08-10

### Release v2.9.17 / Desktop v0.9.14

- 升级 root 与 Desktop/Tauri 客户端包版本，发布消息宽度限制、Web 侧边栏快捷新建会话、长任务 Durable 计划按步推进执行与 Chat 折叠思考等优化。

### Message 内容宽度隔离（修复，P1）

- Desktop Chat 与 Project Chat 的消息视口现在只纵向滚动，普通文本、连续路径、链接和 inline code 会在 720px 阅读列内自动换行，任何消息都不能再把中间面板整体撑宽。
- 表格、代码块、渲染公式等需要保留固有排版的模块继续保持原布局，但横向滚动条由模块自身承载；共享消息链路补齐 `min-width: 0` 与 `max-width: 100%` 边界。
- 显式 Skill 调用持久化后的 `[$skill-name](.../SKILL.md)` 现在恢复为紫色 Skill 调用卡，只显示 Skill 名称与后续用户请求；本机绝对路径仍供 Agent 执行，但不会再作为普通 Markdown 链接展开到聊天正文。
- 验证：真实浏览器布局中 760px Message 面板的 `scrollWidth` 从 1380px 恢复为 760px，1342px 宽模块保留自身滚动；新增结构守卫覆盖文本断行、消息列隔离、表格和公式内部滚动。

### Web 侧栏快捷新建 Session（新增，P2）

- Desktop 左侧 Web 渠道行在下拉箭头左侧新增独立加号，像 Project 操作一样默认隐藏、在整行 hover 或键盘聚焦时出现；它直接复用顶部“新对话”的同一 `newConversation()` 流程，且点击不会触发展开/收起。
- 该动作只对 Web 渲染，Telegram、飞书、QQ、微信保持原样；按钮提供中英文无障碍名称、键盘焦点和明暗主题语义色。
- 验证：Desktop UI 结构守卫 187/187，`svelte-check` 0 错误/0 警告。

### Chat 有序运行记录、Plan 决策与复杂内容渲染（新增/优化，P1）

- 对话改为持久化有序 step 流，流式与历史记录保留文本、思考、工具和 Plan 的真实交错顺序；活动新增耗时、退出码、行数、token 元数据，并提供 turn 级工具/文件/耗时/token 汇总。
- 新增共享 `DecisionCard` 与完整 Plan 原语：Plan 模式在模型调用前收窄为只读工具 + `exitPlan`，计划落为 Session artifact，可修改、拒绝或选择 Manual/Accept edits 接受；接受后转换为同一 Session 关联的多步骤 Durable Execution，每次 attempt 只执行一个已确认步骤，逐步留下 run-detail 证据并在全部步骤完成后统一验收。
- 四档权限模式已从模型选择器拆成独立控件，固定放在输入框左侧附件按钮右边；模型菜单只负责模型与 thinking，Desktop Chat 与 Project Chat 共用同一个权限控件及会话级持久化。
- 审批卡支持路径、diff 与参数等结构化载荷；Desktop 投影从单个 pending 改为有序队列，共享快捷键仲裁确保只有最近且可见的决策卡响应数字键。
- Chat Markdown 统一支持 Mermaid、KaTeX、沙箱 HTML/SVG 预览和宽表 SpreadsheetTable 入口；单换行恢复 CommonMark 语义。长工具输出采用前 32 行预览，活动展开态跨 live/final 保留。
- 长会话按 80 条分页挂载；包含至少 3 个标题的回答显示内部大纲。
- 完成态把最终回答之前的思考、过程说明与工具步骤统一收进一个默认折叠的“思考过程”摘要；运行中保持逐步可见，失败/中止自动展开，Plan 决策卡不被隐藏。
- 本次 Plan/Durable 联动验证：Durable 激活、分步 runtime、状态投影 17/17，Desktop 结构守卫 186/186，`svelte-check` 0 错误/0 警告，服务端生产构建与 `git diff --check` 通过。完整 `test:desktop-chat` 为 250/252；两个失败分别是既有 Node 直跑 Svelte rune 的 `$derived is not defined` 与 SQLite FTS `bm25` 上下文错误，均不在本切片触达路径。
- 验证：Desktop 190/190 UI/逻辑测试、55/55 Rust 测试、`svelte-check` 0/0、Desktop 与服务端生产构建通过。既有 SessionStore FTS 测试仍受 Node SQLite `bm25` 上下文错误影响，单独重跑可复现，未由本切片引入。

### Release v2.9.15 / Desktop v0.9.12

- 升级 root 与 Desktop/Tauri 客户端包版本，修复已发送提醒引起的消息上下文 `usage` 缺失导致模型调用崩溃的问题。

### Release v2.9.14 / Desktop v0.9.11

- 升级 root 与 Desktop/Tauri 客户端包版本，发布流式回复增量渲染（选区存活）、一轮多图画廊展示、审批提示条、代码/宽表横向滚动及工具活动卡渲染器分类优化。

### Runner helper 类型守卫修复（维护）

- 两个 unsupported-developer-role 测试 fixture 现在直接使用 canonical `RuntimeSettings` 上下文类型，避免自定义 Provider 的 `tags` / `supportedRoles` 被推断成宽泛 `string[]`，让类型守卫真正覆盖配置结构变化。
- 验证：`runnerHelpers.test.ts` 5/5、Desktop 结构守卫 183/183，`git diff --check` 通过；全仓 TypeScript 仍有与本修复无关的既有诊断。

## 2026-08-09

### 流式回复改为按块增量渲染，保留选区（优化，P2）

- 流式回复每帧都 `renderMarkdown(streamingText)` 再整体替换 `{@html}` 树，带来三个问题：每帧 O(全文) parse+sanitize+DOM 替换，几千字时明显卡顿；整棵 `innerHTML` 被替换会清空读者选中的文本，边生成边复制做不到；未闭合代码围栏期间 marked 会把后续内容全吞进代码块，画面剧烈跳变。
- 现在按顶层 block 切分（空行为边界，**fence-aware**：围栏内的空行不分），渲染成 keyed `{#each}`、每块一个 `.md-stream-block` 包裹的 `{@html}`。已封口 block（最后一条空行之前、流式期间不可变）只 parse 一次并缓存 html，每帧只有仍在生长的末块重新 parse -- 帧成本从 O(全文) 降到 O(活动块)。
- 选区得以保留，是因为 Svelte 5 的 `{@html}` 运行时有值守卫 `value === (value = get_value())`，值不变就跳过 `innerHTML` 写入（`svelte/src/runtime/client/dom/blocks/html.js`）；sealed block 每帧返回同一份缓存 html 字符串，其 DOM 节点永不被触碰。末块若处于打开的 fence，parse 前虚拟补一个闭合标记，挡掉「后续全被吞」。
- 缓存的是 html **字符串**而非 wrapper 对象：Svelte 的 `{#each}` 对任何对象 item 都判定为变更（`safe_not_equal` 对对象恒为 true），缓存对象零收益，还会误导后人以为「引用稳定是机制」。wrapper 每帧是新对象，只有其 html 值被钉死不变。
- 验证：`streamingMarkdown` 15/15、`chat-ui` 结构守卫 183/183、`svelte-check` 0 错误/0 警告、生产构建通过。选区保留机制已从 Svelte 5 运行时源码核实（`{@html}` 值守卫 + keyed `{#each}` 按 index 复用 wrapper div，并用真实模板编译验证）；剩余运行时 gate 为冷启走查（流一条多段回复、在早期段落选中文本确认存活、确认未闭合围栏不吞内容，pitfall #10）。

### 一轮多图改为画廊网格展示（优化，P2）

- 一轮生成 6 张图时，过去会渲染 6 张纵向堆叠的全宽卡片，把后面的对话整个挤出屏幕。现在连续的图片附件合并为一个网格，块高度不再随图片数量增长。
- 列数是真正的布局切换，而不是碰巧落在 3 列的 auto-fit：1 张保留原来的全宽卡片（把唯一的结果缩成缩略图会丢掉这一轮的主体），2 张左右并排，3 张及以上走三列方形 `cover` 缩略图 —— 用 `contain` 的话，竖图和横图会产生两种高度，整行看起来就是坏的。
- 点击任意图片打开全屏画廊：←/→ 按钮与方向键、可循环的位置计数、Escape 与点击背景关闭、下载按钮。Markdown 里的图片打开同一个查看器，并在该块内的所有图片间翻页，两个面不会各自长出一套。
- 分组按**连续段**进行，图片之间夹着文件时不会被重排；只有已加载完成的图片进入查看器，箭头不会翻到空白页。
- 同时修掉了「图片永远停在只有文件名的占位」的两个独立原因：(a) `{#each}` 遍历的分组只依赖 `attachments`，因此在 `{@const}` 里通过无参 helper 解析文件，会在编译器看不见的地方读 `actions`，记录与 blob URL 到达后单元格不会重渲染 —— 这两个 Map 是**首次渲染之后**才被填充的，所以这不是轻微的过期，而是画廊永久空白（CLAUDE.md pitfall #2）。现在解析放在显式引用 `actions` 的 `$:` 里。(b) 一轮结束后没有任何地方重新拉取 Session 文件列表，本轮刚生成的文件要等到下次切换会话才有记录；`ChatView` 现在实现了共享 controller 一直在调用的 `afterMutate` 钩子。
- 验证：Desktop UI 184/184、`attachmentGroups` 6/6、`svelte-check` 0 错误/0 警告、生产构建通过；并在真实渲染中（深/浅色）走查了 1/2/3/6 张与混合排列、箭头与键盘翻页、循环、单图时控件隐藏、Markdown 图片翻页，以及**从空 Map 开始**（真实的事件顺序）的 占位 → 加载中 → 图片 三段转换。

### Chat 阻塞态可见性：审批卡不再被滚动位置藏起来（修复，P1）

- 审批卡渲染在转录末尾，而 `stickToBottom` 在用户上翻历史时会正确交出滚动权。两个都正确的行为相乘的结果是：这一轮静默挂起，决定在屏幕外，界面上没有任何提示 —— 即 CLAUDE.md 记录的「审批等待伪装成服务崩溃」。
- 新增共享 `TranscriptDock`：跟随被挂起时显示「回到最新」；被阻塞的卡片滚出视口时显示 `role="alert"` 的「有一条审批在等待你的决定 · 查看」。Dock 接收的是一个元素而不是「有没有审批」的布尔标记，因此下一张阻塞卡（Plan 提案）可以原样复用（pitfall #7）。
- 审批卡自报等待时长（超过 10 秒后显示「等待你的决定 · N 秒/分钟」），阻塞的运行不会再看起来像死掉的服务；其 window 级数字键 / ⌘⏎ 快捷键改为仅在卡片真正可见时才生效。
- Chat 与 Project Chat 两个聊天面都已接入。

### 工具活动按结果类型分渲染器（优化，P1）

- 过去所有工具的结果都打进同一个 `<pre>`，补丁、文件内容、Shell 输出和 MCP JSON 长得完全一样。现在活动体经由纯函数 `classifyActivityBody` 分派：unified diff 走 diff2html，文件内容与 JSON 走 `CodeViewer`，Shell 输出走保留列对齐的终端块，失败一律回落纯文本（失败时的载荷是错误信息，不是工具产物）。
- `edit` 在 pi 的展示型 diff 之外额外产出真正的 unified patch（`generateUnifiedPatch`），经新增的 `ConversationActivity.diff`（带字节上限）送到转录；活动同时记录自己的 `tool` id，不再让消费方从去重用的 `key` 里反解。
- 折叠头改为点名当前步骤（「第 3/5 步 · npm test」）而不只报数量，且优先点名失败的那一步。
- 运行时一直记录却从没被渲染的 `paths`/`mutates` 终于露出：「改动 / 读取 N 个文件」chip 行，点击在 Artifact Panel 打开该文件的 diff 或内容；请求经既有 composer bridge 转发，通用组件内部不含任何 scope 条件。

### Markdown 复杂内容：代码与宽表在列内滚动而不是被压毁（修复，P2）

- 代码块不再强制 `pre-wrap`（那会破坏承载结构的缩进），改为在钳制到列宽的盒子里横向滚动，并在代码块头部提供逐块「折行」开关，供长日志行使用。Markdown 表格去掉 `table-layout: fixed`（它会把宽表压成每列一个字的竖排），改为 `width: max-content` + 滚动包裹层。
- 顺带修掉由此暴露的布局回归：`.assistant-layout` 是 `width: auto` 的块级 flex 容器，会 shrink-to-fit 到内容宽度 —— 只要转录里出现一个比列宽的块，整个助手行就会超出 720px 消息列，转录开始横向滚动（pitfall #16）。
- 渲染后的 Markdown 中的图片支持灯箱预览，挂在 `<body>` 上，因此不会被转录的 overflow 裁掉或困在面板的层叠上下文里。
- 删除流式气泡里私有的 copy-code 实现，所有渲染 Markdown 的面统一走同一个委托 handler，折行开关与灯箱在正在生成的那条回复上同样可用（pitfall #7）。
- 验证：Desktop UI 180/180、`activityView` 12/12、`test:projects` 71/71、edit/runner/projection 54/54、`svelte-check` 0 错误/0 警告、生产构建通过；并在真实渲染中（深/浅色）逐项走查了审批提示条、各工具渲染器、折行开关、图片灯箱，以及转录零横向溢出。

### Release v2.9.13 / Desktop v0.9.10

- 升级 root 与 Desktop/Tauri 客户端包版本，发布 Office 文档（DOCX/PPTX/Excel）及 PDF 导出与本地预览、定时提醒 Catch-up 修复以及新一轮核心稳定性优化。

### Automatic Durable Execution 基础主链路（部分交付，P1）

- 新增共享 Agent 层 Durable Execution 聚合与独立 `durable-execution.sqlite`，持久化线性计划、步骤、验收标准、attempt、证据、副作用 intent/receipt、decision 和 action receipt；共享层使用版本 CAS、lease 与 owner/Bot/Project 边界。
- 确定性长任务信号、`auto/force/suppress` 请求覆盖、watched event JSON/runtime internal event 续跑、fresh 隐藏 automation attempt、任务级 token/attempt/lifetime 预算、未终结配额和创建顺序排队已接入；非纯工具在 handler 前后统一经过 side-effect boundary。
- Desktop 已接入会话内原地任务卡、既有右侧 inspector 的任务模式、侧栏“进行中”投影和等待/终态反馈通知；普通聊天仍保持快速路径，验证器才能决定 `completed`。
- 普通 Run 的首次非纯工具边界已接入分层限次的结构化模型 preflight；升级时会把已执行前缀、证据摘要和副作用回执吸收到 Durable SQLite，并在当前副作用 handler 前以 `terminate` 交接，避免误执行或重放。离线事件已复用共享 catch-up window，超窗会明确进入 `recovery_required`。
- 恢复现在会先调用按幂等键注册的 queryable 探针；无探针、探针失败或结果不确定时只创建 `recovery_required` 决策，不会盲重试。证据读取器只解引用当前任务授权的 run-detail，按来源聊天/Project/Session 校验，24KB 截断并标记为不可信；Durable attempt 通过仅在该上下文加载的 `durableEvidence` 只读工具按 evidence id 取回它。
- 审批请求会持久化到 Durable SQLite，记录重复次数并从隐藏 attempt 投影回来源渠道；共享 `/durable` 命令按 owner/Bot/channel/chat 做鉴权，支持 `approve|reject|answer|pause|resume|cancel` 和 `#N` 短句柄，QQ/微信使用来源消息回传，Desktop 使用同一 inspector。
- Web API 的虚拟 profile 会在 Durable 入队前解析到已启用的真实 Web manager；因此 `personal` 这类未单独物化的 profile 不会创建一个必然找不到执行器的队列项。真实 `/api/chat` + 临时 provider + 同库服务重启已验证请求发出后恢复为 `recovery_required`，attempt 为 `interrupted`。
- 用户接受的 Session Plan 现在以确定性 id 幂等转换为一个多步骤 Durable Execution；步骤状态由 Durable SQLite 投影回 Plan 卡。每个成功 attempt 只完成当前步骤、写入 run-detail evidence，再排队下一步；创建后入队前崩溃也可由重复接受安全恢复。
- 当前仍属部分交付：完整冷启动/跨渠道验收矩阵和外部 provider live 验收尚未完成。已验证的当前切片包括 Durable/tool、Runner/runtime、证据、审批和渠道命令定向回归；Desktop `svelte-check` 0 错误/0 警告，生产构建通过。

### Desktop Chat 与 Settings 导航宽度统一（优化，P2）

- Chat 与 Settings 左侧导航现在共用 Settings 的 `228px` 桌面基准宽度；窄窗口统一使用 `170px`，宽度来源收敛为共享 CSS token。
- Chat 仍保留拖拽和键盘调整能力；已有用户保存过且不小于基线的自定义宽度继续保留，低于 `228px` 的旧值会在加载时钳回 Settings 基线。
- 验证：Desktop UI 177/177、Desktop 全量测试 160 + 181 + 55、`svelte-check` 0 错误/0 警告、生产构建通过。

### 个人助理状态源统一与安全旧数据清理（P2）

- 新增唯一的 [个人助理能力矩阵](docs/requirements/personal-assistant-capability-matrix.md)，只使用“已交付 / 部分交付 / 待验证 / 未开始”四种当前状态。`prd.md` 下方历史章节只保留设计和交付上下文，不再具有覆盖矩阵或直接生成任务的权威。
- 矩阵修正了临时 PRD 的过期结论：文档导出、Runtime Todo、`add_content` 边界、H2 和 Mini App 麦克风均已交付；PPTX 生成及日历/联系人/邮件/浏览器仍按明确产品边界保持未开始，其中外部集成和浏览器不会自动转成内置开发任务。
- 产品负责人已在真实 App 中确认 Mini App 麦克风可用；原“macOS microphone acceptance pending”不再作为发布阻塞。拒绝权限、设备丢失等自动化只保留为测试加固方向。
- 经只读复扫后执行 `node scripts/maintenance/clean-data-dir.mjs --apply`，删除 11 个明确 safe 的旧位置并回收 326MB；复扫 safe=0。`response.json*`、两份设置备份、`event.log` 和 Skill 备份共 2.9MB 仍为 review-only，未删除。

### 可交付文档导出、提醒真实链路与 H2 最终绿测（新增/修复，P1）

- 新增延迟加载的 `documentExport`：可从 Markdown 生成 DOCX/PDF，从带类型的二维数据生成多工作表 XLSX；输出仅允许写入 Project 或 Session scratch，扩展名、路径、内容和工作簿规模都有边界。PPTX 导出按决策后置，未引入浏览器。
- “生成成功”现在是强凭证：DOCX 用 Mammoth 重读，PDF 用 `pdf-parse` 重读，XLSX 用 SheetJS 重开并逐表/逐单元格校验；只有临时文件从磁盘重读验证通过后才原子改名和附件投递。中文 PDF 使用随包 Noto Sans SC 子集字体，不依赖系统字体。
- 提醒恢复补齐短时错过的一次性任务：重启后仍在 catch-up window 内会按稳定 trigger slot 补投，过期任务明确 skipped；completed lease 与 completed 文件状态共同抑制重复投递。Telegram/飞书离线时不再返回假成功，显式 `delivery=text` 对周期任务和手动触发也统一走直接通知，不再误进 Agent 队列。
- 真实环境矩阵通过 Desktop/Web、Telegram、飞书三条链路的 watched-event create、正式 CRUD update、scheduled trigger、completed execution receipt 和 delete；失效的 Telegram 旧群组目标返回 provider error，未被吞掉。重启补偿、超窗跳过、离线失败和重复抑制由临时数据库/目录回归覆盖。
- H2 最终 live 为 1/1（280 秒）：安装目录和 manifest 存在，trace 中 `miniAppManage` validate/install/inspect 全部结束，安装后模型继续完成回答，服务没有在工具调用处退出。结果见 `evals/results/2026-08-09T07-49-11-671Z.json`，保留数据目录由运行结果打印。
- 验证：文档/工具/prompt/事件定向回归 67/67；Runtime Task/渠道定向回归 40/40；提醒共享/渠道回归 34/34；生产构建通过。

### Artifact Inspector PPTX 演示文稿预览（新增，P1）

- `.pptx` 文件和 PowerPoint MIME 现在进入独立的 `pptx` viewer，不再直接落到系统应用兜底；扩展名/MIME 分发仍由共享 registry 负责，Project 和 Session 两个入口保持一致。
- 使用 MIT 授权的 `@silurus/ooxml` 浏览器端 Canvas/WASM viewer，首次打开时才懒加载解析器和 WASM；演示文稿按幻灯片连续滚动显示，提供页数、文字选择和统一操作条，保持只读，不启用外链跳转或 Google Fonts 请求。
- 输入限制为 50 MiB，OOXML 解包还有条目数和膨胀体积上限；损坏、超限或不兼容文件显示可重试错误，不会冻结面板。旧 `.ppt` 和未知二进制继续使用系统应用卡片。
- 回归覆盖 PPTX 扩展名/MIME 分发、字节窗口复制与 50 MiB 上限、两个 artifact scope、懒加载/只读/资源限制结构守卫；artifact 定向测试 19/19，Desktop UI 176/176，`svelte-check` 0/0，生产构建通过，PPTX JS/WASM 保持独立懒加载 chunk。

### Artifact Inspector DOCX 文档预览（新增，P1）

- `.docx` 文件现在进入独立的 `docx` viewer，不再直接落到“格式无法预览”的系统应用兜底卡片；扩展名和 Word MIME 都由共享 registry 处理。
- 复用现有授权的 Project/session 文件字节通道和随包 Mammoth 1.12.0，首次打开时懒加载并转换为 Markdown，再交给已有 Markdown/DOMPurify 渲染链；关闭外部文件访问与嵌入图片资源，面板只提供只读内容预览和统一下载/外部打开操作。
- 转换警告以非阻塞状态提示，损坏文档显示可重试错误；旧 `.ppt`/未知二进制仍走系统应用，PPTX 由独立 viewer 处理。回归覆盖真实 DOCX fixture、损坏输入、扩展名/MIME 分发和 Project/Session 两个入口；DOCX/registry 定向测试 18/18，Desktop UI 175/175，`svelte-check` 0/0，生产构建通过。

### 三项个人助理 P0 可靠性闭环（修复）

- `add_content` 只再接受显式 `world_knowledge`，用于用户已发布内容语料；个人事实、偏好或缺失类型会明确失败并要求改用 `add`，避免“工具返回保存成功、以后对话永远召回不到”。
- Runner 在 Provider 调用前计算最终 system prompt、工具 schema、历史和当前消息的总预算；超限先按当前模型窗口压缩历史，再只裁剪送模副本，原始用户消息仍完整持久化。最终 transport 边界会再次 fail closed，超限请求不会到达 Provider。
- Web Chat/Stream 未传思考等级时不再强制覆盖为 `off`，保留 Runtime 默认；自定义 Subagent 同步模型的 developer-role 能力，避免主 Agent 能调用而子 Agent 首次请求 400。
- eval 长请求改用 15 分钟 headers/body timeout。完整基线 `2026-08-09T06-21-19-850Z` 为 24/31 且没有 Provider 请求链错误；随后受影响用例 C1/C4/D1/D2/H2 为 5/5，H2 运行 429 秒、服务未退出。剩余 A5/F2 属于后续行为质量问题，不在本次三个 P0 范围。
- 日历、联系人、邮件及浏览器能力未加入；前三者保持 Skill / MCP / Connector 外置集成边界，浏览器留待 P1。

### Artifact Inspector XLS/XLSX 表格预览（新增，P1）

- `.xls` / `.xlsx` 文件现在进入独立的 `spreadsheet` viewer，不再误落到“格式无法预览”的系统应用兜底卡片；扩展名和 Excel MIME 都由共享 registry 处理。
- 复用现有授权的 Project/session 文件字节通道和随包 SheetJS 0.20.3，懒加载解析每个工作表；面板显示工作表标签、固定表头、行号和只读单元格，保持 GitHub/Primer 数据表面与共享下载/外部打开操作条。
- 每个工作表最多展示 5,000 行，超出明确提示，避免把巨型表格一次性挂进 WebView DOM；不执行公式，损坏工作簿显示可重试错误态，旧 `.ppt`/未知二进制仍走系统应用，DOCX/PPTX 由独立 viewer 处理。
- 回归覆盖 registry 扩展名/MIME 分发、多工作表/重复值/空表/截断解析，以及 Project 和 Session 两个入口；artifact 定向测试 18/18，Desktop UI 174/174，`svelte-check` 0/0，生产构建通过。

### Artifact Inspector Git 变更统计与 Diff 行号滚动同步（优化，P1）

- Project Changes 列表现在沿用 `git diff HEAD --numstat -z` 为每个文件展示 `+新增 / −删除` 行数，统计覆盖 staged、unstaged、删除、重命名和路径含空格/CJK 的文件；二进制或无法统计的文件明确显示状态，不再要求逐个打开 Diff 才能判断改动规模。
- 未跟踪文本文件按完整内容统计新增行，二进制文件不伪造行数；服务端沿用现有 Git 根目录与路径归一化边界，统计不会把项目外文件带入面板。
- Diff2html 的行号 gutter 由渲染 Diff 自身建立 containing block，和代码行共享滚动坐标；行号不再固定在查看器视口中，保留原有 GitHub（Primer）颜色与 line-by-line / side-by-side 布局。
- 回归守卫覆盖服务端 staged/unstaged/deleted/untracked 统计、Desktop Changes 行结构与 gutter CSS；Desktop UI 173/173，项目 inspection 13/13。

### ImageAnalyze 与共享视觉/OCR 能力（新增，P0）

- 新增延迟加载的 `imageAnalyze(path, prompt?)`：Agent 可在运行过程中主动分析工作区 PNG/JPEG/GIF/WebP，用于 OCR、发票/票据、截图、图表、UI 状态和通用图片理解，不再局限于 Channel 入站消息刚好携带的图片。
- 工具不接受任意 Provider/模型名；模型固定复用当前 Agent 覆盖后的 `visionModelKey`，未覆盖时跟随全局视觉路由。调用结果记录实际 Provider、模型与 usage，图片和识别文本均标记为不可信证据。
- Channel 入站 fallback 与新工具统一复用共享 `VisionAnalysis` 深模块，支持 pi 内置与 custom Provider transport；Channel 只保留附件下载、保存和统一消息结构转换。
- `docExtract` 增加 PDF OCR policy：默认 `auto` 仅识别原生文字少且确实含嵌入图片的页面，`force` 识别全部页面，`never` 禁止模型调用；页面先渲染为 1600px PNG，再走同一个视觉模块。单次最多 OCR 20 页，串行执行，避免意外费用和内存峰值。
- `imageAnalyze` 与 OCR 输出复用 pitfall 27 的共享截断/UTF-8/全文落盘模块；路径与 symlink 真实目标受工作区约束，源图片限制 20 MiB，送模前限制 5 MiB并按需缩放。
- 验证：视觉/工具/文档/路由/eval 定向回归 85/85，生产构建通过；真实隔离服务 B6 1/1（14 秒），第二轮无入站图片时由 Agent 加载并调用 `imageAnalyze`，识别结果与 trace 均通过。

### DocExtract：PDF、DOCX、XLSX 文档摄入（新增，P0）

- 新增延迟加载的 `docExtract(path)` 内置工具，和基础 `read` 分层：`read` 继续负责文本/图片文件，PDF、DOCX、XLSX 的格式解析独立承载；`read` 的描述与二进制错误会把支持的文档明确导向 `docExtract`。
- PDF 通过 `pdf-parse` v2 解释内容流并在结束后释放 parser；DOCX 通过 Mammoth 从 Buffer 转语义 HTML，再复用 WebFetch 的共享 HTML→Markdown 清理器，外部文件访问保持关闭且不内联图片；XLSX 使用正式随包的 SheetJS 0.20.3，逐工作表输出带标题的 CSV 文本，不执行公式。
- 资源与上下文边界：文件及其真实路径必须位于允许的工作区根内且不超过 50 MiB，DOCX/XLSX 解包总量限制 256 MiB/10,000 entries，XLSX 每表最多读取 100,000 行；提取结果复用 `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES`、UTF-8 安全单行回退和 `outputSpill` 全文落盘。文档正文统一标为不可信证据；扫描/纯图片 PDF 现可通过共享视觉路由 OCR。
- eval B2 改用真正的 `/FlateDecode` 压缩流 fixture，秘密编号不以明文存在于 PDF 原始字节，并新增 `tool_used: docExtract` 守卫。验证：文档/工具/eval 定向测试 61/61；真实隔离服务 B2 1/1（5 秒）；生产构建通过。

### Agent Runtime Task 正式 CRUD 与 Mini App Todo 边界（新增，P0）

- Agent 的用户可管理对象统一为 Runtime Task：`todo` 是不会触发的普通待办，`one-shot` 是提醒，`periodic` 是自动化；Runtime Event 只表示触发/执行，Notification 只表示投递结果，不再各自形成重复任务库。
- 原仅能创建的 `createEvent` 延迟工具替换为 `runtimeTask`，正式支持 create/list/get/update/delete；按稳定 `taskId` 管理，修改提醒时间会恢复 pending，删除只命中当前 Bot 的用户任务。
- watcher 对普通 `todo` 只保留、不派发，避免无时间待办变成通知；immediate 执行事件与 Molibot Owner 系统任务不进入用户 CRUD；Desktop 的 opaque-id 管理路径补齐 one-shot 的更新、删除、历史和 execution Session 查询。
- 可选 Mini App Todo 保持独立 bounded context：Runtime Task 不读取、不投影、不修改 Mini App 数据，Mini App 未安装时 Runtime 能力仍完整。未来如需联动，只开放窄的通知请求能力，不共享 Todo 数据或级联。
- 契约见 `docs/reference/CONTEXT.md` 与 [ADR 0003](docs/adr/0003-runtime-tasks-and-mini-app-todo-boundary.md)；定向测试覆盖完整 CRUD、类型字段校验、internal/immediate 排除和 one-shot Desktop 路径解析。

### Mini App、Pi 扩展与失控工具进程故障隔离（新增，P0）

- Mini App server runtime 改为每 App 一个独立 Node 子进程；工具与 HTTP 走有界 IPC，AI、badge、日志走显式双向桥接。第三方代码 `process.exit`、同步死循环、V8 heap OOM、超时或取消只终止对应 App 进程，不再带走 Molibot 服务；下次调用会重建运行时。
- Agent `miniAppManage` 的 scratch-build validate/smoke/install 复用同一子进程边界，不再通过 `importModule` 把尚未安装的候选代码载回服务；临时 Host 会显式 dispose 后再清理验证数据目录。
- 修复 H2 暴露的审批假死：Desktop 的 pending/resolve 接口现在同时处理 Host Bash 与 ApprovalBroker 工具请求，按 Session 隔离并保留 once/session/persistent/reject 语义。此前 `miniAppManage` 请求能显示成审批卡却无法由该卡解决，运行时等待五分钟后被 HTTP 客户端报成 `fetch failed`，并非服务崩溃。
- H2 的 `auto_approve` 是 eval YAML 的显式选项，通过正式 Desktop API 选择「仅此一次」；生产运行时不自动批准 critical 工具，也没有测试专用的策略后门。
- Pi 扩展不再把可执行函数加载进服务进程：发现、注册、tool/event/command 执行统一进入独立扩展进程，服务只保留可序列化元数据和 IPC client。扩展进程异常后标记 host 失效，下次加载重建。
- 两类不受信任进程都设置 256 MiB old-space 上限、60 秒调用 watchdog 和进程组强杀；共享 `ToolRuntime` 增加五分钟最终截止时间，异步 handler 即使忽略取消也会稳定收口，进程型工具同时收到 abort。
- 隔离边界与权限边界明确分开：这次防止故障扩散，不限制第三方代码的 owner 权限；内置工具仍是主进程内可信代码。
- 回归测试真实覆盖已安装 Mini App `process.exit`、同步无限循环后的自动重建、Agent 安装候选模块顶层 `process.exit(73)`、Desktop Broker 审批的会话/范围语义、eval 并发批准恢复原 turn、Pi 扩展工具主动退出，以及永不 settle 的普通异步工具。架构决策见 [ADR 0002](docs/adr/0002-untrusted-runtime-process-boundaries.md)。

### Artifact Inspector 文件类型图标与颜色（优化，P1）

- 恢复并扩展现有 `@phosphor-icons/web` 文件 glyph：TypeScript、JavaScript、Python、Rust、Go、Vue、Svelte、CSS、Markdown、JSON、YAML、SQL、图片、音频、视频、压缩包和 Office 文件分别使用对应图标。
- 增加 README、Dockerfile、`.gitignore`、`.env`、`package.json`、锁文件等仓库特殊文件名识别；目录统一使用文件树 folder 色，未知文件仍保持中性回退。
- 文件类型色通过 `--file-color` 贯穿文件树、搜索结果、打开文件 tab、Session 附件和系统打开卡；选中、脏文件、修改/新增/删除状态继续使用独立语义色，不会覆盖类型色。
- 评估过 `@iconify/svelte` + `@iconify-json/vscode-icons`、`@exuanbo/file-icons-js` 等方案：Iconify 数据完整但桌面离线需要额外打包整套 SVG，旧 file-icons 包多年未更新；当前 Phosphor 已在项目内，复用它更小、更稳定、无需远程请求。
- 验证：新增 `fileIcons.test.ts` 3/3，现有 Chat UI、Artifact viewer、Svelte check、Vite build 与 diff check 保持通过。

### JSON 文件改为源码优先、树形按需解析（修复，P0/P1）

- JSON 文件打开后默认显示原始内容，使用共享 `CodeViewer` 提供 GitHub 风格语法高亮、行号、查找、换行和分块加载；不会在打开 tab 时自动 `JSON.parse` 或构建树。
- 工具栏提供显式“解析为树形”按钮；只有用户主动点击且文件内容完整时才进入可折叠树，树形视图可随时“查看原文件”返回源码。
- 树形解析沿用 1 MiB 字节上限并增加 5,000 行预算，超限、非法 JSON、深层递归异常均回退到带说明的源码，不再让整个右侧面板卡死。对象键使用 JSON Pointer 转义，避免 `/` 键造成重复行 key。
- Project 文件树的每一行现在固定单行：移除会占用额外 grid 单元的独立更新圆点，文件大小强制不换行；本次会话被 Agent 修改过的文件只通过文件名语义色标记，详细变更仍在 Git Changes 面板展示。
- 验证：`jsonTree.test.ts` 13/13、`chat-ui.test.mjs` 173/173、`svelte-check` 0 errors / 0 warnings、`vite build` 通过。

### 记忆 namespace 与整轮留存语义统一（新增，P0）

- 用户事实/偏好统一写入 `owner:`，Project 事实写入 `project:`；`chat:` 仅作为会话授权/召回边界，`content:` 与 `agent:` 保持专用语义，避免“保存成功、下轮不可达”。
- 新增 `standard / no_memory / not_searchable / turn_only` 四种持久策略，覆盖用户消息、本轮回答和工具过程；分别控制未来 Agent Context、会话搜索与记忆/反思资格。
- “仅本轮”仍可在 transcript 中审计，但不会重进上下文；“不可搜索”不会进入或被回填进会话索引；“不记忆”阻止显式与自动记忆写入，但仍允许查已有记忆和明确删除。
- 删除明确为针对记忆、消息/轮次或 Session 的独立操作；会话删除/截断继续写搜索 tombstone。
- 契约记录于 `docs/reference/CONTEXT.md` 与 ADR 0001；定向回归覆盖语义优先级、namespace、上下文重建、索引、反思及工具写守卫。

### WebFetch：Agent 可直接读取公开网页正文（新增，P0）

- 新增延迟加载的 `webFetch(url, prompt)` 内置工具：用户贴链接或 `webSearch` 找到目标页面后，Agent 可抓取完整文本正文；HTML 通过成熟的 `turndown` 转为 Markdown，脚本、样式与页面头部不会进入上下文。
- 公网边界在共享 Agent 工具层实现：仅允许 HTTP(S)，拒绝带凭据 URL、本机/局域网/链路本地/高风险保留 IP，DNS 结果和每一跳重定向都重新校验；Clash/TUN 的 DNS fake-IP 仅对公网域名做窄例外，直接访问该地址段仍拒绝。同站点及 `www` 变体可跟随，跨站点跳转返回目标 URL 并要求下一次显式调用。
- 资源边界：60 秒超时、10 MiB 下载上限、最多 10 次同站跳转、15 分钟/50 MiB 进程内 LRU 缓存；二进制明确拒绝，交给独立的文档摄入能力。
- 返回正文复用 `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` 与 UTF-8 安全单行回退，避免一个超大网页永久撑爆会话；工具结果把网页标为不可信证据，防止页面中的 prompt 注入被当作系统指令。
- 验证：WebFetch 定向测试 7/7、工具注册测试 10/10、生产构建通过。

### 修复：会话里记住的东西，换个会话读不回来（P0）

- 现象：eval C 组在干净环境 0/4——`memory` 工具答「Added memory: mem-…」，换会话后 Agent 却答「记忆里没有记录」，两边都说的是真话。
- 根因（`buildMoryWritePlan` 里两个默认都偏离日常读取路径）：无结构 `add`（不带 `type`/`subject`，即绝大多数「顺手记一下」）默认类型是 `task`，被 `chat` 检索 intent 的 `memoryTypes` 硬过滤排除、注入 profile 时又只进受时间窗约束的 `currentFocus` 桶；默认 namespace 是每渠道每用户独立的 `chat:...`，换会话就换 key。
- 修复：新增 `defaultMemoryTypeForLayer`（长期 `user_fact`、每日 `event`，都在日常读取集内；path 前缀从同一 type 派生）；无结构写入 namespace 改走 `namespaceForDomain` → 个人域 `owner:owner`（跨所有渠道/会话共享，`promptMemoryNamespaces` 第一项）。
- 守卫：`moryCore.plan.test.ts` 断言默认类型可被普通一轮检索到、默认 namespace＝`owner:owner`、path 前缀与 type 一致，全部不依赖线上模型。C 组转 4/4。
- 后续同日已关闭 `add_content` 误路由：只有显式发布内容 `world_knowledge` 可以写入 `content:`，个人事实与缺失类型会被工具拒绝并引导到 `add`。存量分裂行（真实库 1229 行分布在 11 种 `user_id` 形状）仍按决策不迁移。

### Eval golden set：把「能不能干活」变成一个数字（新增，P0）

- 新增 `evals/`：31 条真实任务（A 基础工具 6 / B 输入摄入 6 / C 记忆 4 / D 任务调度 3 / E 会话 2 / F 失败姿态 6 / G 代码改动 2 / H 扩展面 2），每条带 `why` 和 `baseline` 预期。
- 判定分三档，优先用高档：state（`file_exists` / `file_contains` / `file_absent` / `sqlite`）> trace（`tool_used` / `tool_not_used`）> text（`reply_*` / `judge`）。没有配置 judge 模型时 `judge` 断言记为 **unproven**，既不算通过也不算失败，单独计数。
- 加载期严格校验：未知断言键、无断言的任务、非法正则一律在调用模型之前失败——否则一个拼写错误会让任务什么都不断言并报告通过。
- 报告双向标注与 `baseline` 不符的结果：`pass → fail` 是回归，`fail → pass` 说明能力补上了、YAML 该更新。
- 隔离：每次运行使用全新临时 `DATA_DIR`，通过 `scripts/start-server.mjs` 启动（绝不 `node build/index.js`，prd.md §3.41）。Provider 配置从 `~/.molibot` 复制，因此必然带上渠道凭据，`MOLIBOT_DISABLE_EXTERNAL_CHANNELS=1` 强制设置并在启动前断言，日志可见 `telegram(0) feishu(0) qq(0) weixin(0)`。
- PDF / PNG / CSV 附件 fixture 由 `evals/fixtures/build-fixtures.mjs` 生成而非提交二进制，「Agent 应该看到什么」可以从代码读出来。
- 命令：`node evals/run.mjs`（`--group` / `--id` / `--skip-tag` / `--seed-from` / `--keep-data-dir` / `--list`），结果落 `evals/results/<ts>.json`。
- 验证：`evals/harness.test.mjs` 17/17。

### 修复：纯 HTTP 同源上传被当成跨站表单拒绝（P0）

- `adapter-node` 在 `ORIGIN` 未设置时从请求头推导自身 origin，且**协议默认 `https`**，于是服务认为自己是 `https://127.0.0.1:<port>`，而浏览器在 `http://localhost:3000` 发来的是 `http` origin，两者永不相等——所有同源 multipart POST（Web 端发附件）都被拒绝。
- 这是 CLAUDE.md pitfall 25 的第三个出现面，而且被前两个盖住了：`tauri://localhost` 在信任列表里，所以打包桌面端正常，只有纯 Web 面是坏的。
- 修法不是再加一个信任 origin（这个 origin 本来就是合法同源），而是让服务说清楚自己是谁：`start-server.mjs` 通过 `resolveServiceOrigin()` 声明真实 origin；操作者已设置 `ORIGIN` 或 `PROTOCOL_HEADER`、或绑定非回环地址时不接管。

### 修复：启动器擦掉了 `DATA_DIR` 隔离依赖的环境层次（P0）

- `dataDirScope.ts` 的规则是：`DATA_DIR` 来自 OS 环境时，只在仓库 `.env` 里出现的 `DB_DIR` 应被丢弃。但 `start-server.mjs` 必须先读仓库 `.env` 才能解析 `DATA_DIR` 和端口，这次 merge 发生在 `env.ts` 快照 `process.env` **之前**，仓库值与操作者导出的值再也分不开。
- 后果：源码安装用 `DATA_DIR=/tmp/...` 启动会直接拒绝启动（守卫误判为「刻意指向外部目录」），而设计意图是丢弃这个覆盖。
- 启动器现在在第一次 `dotenv.config()` 之前把真实 OS key 集合发布到 `MOLIBOT_OS_ENV_KEYS`，`env.ts` 优先读它；新增源码顺序测试锁住这两条语句的先后。

### 新增：`MOLIBOT_DISABLE_EXTERNAL_CHANNELS` 对外渠道总闸（P1）

- 归属守卫问的是「本进程是否拥有该数据目录」，这对孤儿进程是对的问题，对一次性运行是错的：eval 实例从真实数据目录 seed，既带着真实 bot token，又合法拥有自己的临时目录。
- 总闸优先级高于归属：凡未声明 `requiresServiceOwnership: false` 的插件一律停跑，Web / CLI 保留；停跑通过已有的 reconcile 空实例列表完成，不新增第二条关停路径（pitfall 7）。

### 修复：桌面运行时旧代目录从不回收（P1）

- 每次升级解压一个约 300 MB 的 `runtime/desktop-runtime-<version>`，旧代永不删除——一台升级过几次的机器上躺着数 GB 不可达的服务代码（v2.9.12 的安装里还留着 v2.6.3）。
- supervisor 现在在「命中缓存」和「新解压」两条路径上都做回收，保留当前代 + 一代（被 adopt 的上一版 sidecar 可能仍在懒加载它的 chunk）。无 `.molibot-runtime-version` 标记的 `desktop-runtime-<uuid>` 解压残留一律删除。
- 尽力而为：删不掉的目录只损失磁盘空间，不会导致启动失败。

### 优化：runtime / tooling 目录的单一来源与数据目录清理工具（P1）

- `<dataDir>/runtime`（服务私有：lock、state、日志、崩溃报告、运行时代目录，0700）与 `<dataDir>/tooling`（Agent 依赖：Python venv 与缓存、GOPATH/GOCACHE）此前在四处各写一遍路径字面量，现在每种语言各一处：`storagePaths`、`scripts/runtime/runtime-paths.mjs`、Rust supervisor。
- 新增测试断言两棵树互不包含（双向）：把 Agent 可写的工作目录塞进 supervisor 私有目录，等于让正在运行的服务代码离一次 `rm -rf "$TMPDIR/../.."` 只有一步之遥。
- Go 隔离不再依赖 `MOLIBOT_TOOLING_DIR`：默认安装此前会让 `go install` 写进用户的 `~/go`，正是 tooling 目录要防的污染。
- Settings 的 provider 测试产物从三个顶层目录收进 `cache/settings-tests/`。
- 新增 `node scripts/maintenance/clean-data-dir.mjs`：按名列出可回收项（含体积与原因），默认只报告，`--apply` 才删除，`--include-review` 才处理需人工确认的项；已迁移的数据库只有在 `db/` 副本存在时才会被提议删除。
- 验证：`storage.test.ts` 9/9、`helpers.test.ts` 6/6、`serviceOwnership.test.ts` 7/7、`dataDirScope.test.ts` 11/11、`csrf-trusted-origins.test.mjs` 7/7、`clean-data-dir.test.mjs` 5/5、Rust `cargo test --lib supervisor` 21/21。

### Artifact Inspector GitHub / Primer 工作区重构（优化，P1）

- 右侧 File / Artifact Inspector 统一为仓库画布、源文件树和编辑器预览三层结构，保留原有文件切换、搜索、diff、附件、下载和可调整分栏行为。
- 项目 tab、打开文件 tab、路径栏和工具栏改为扁平 GitHub 风格：底部 accent 选中线、细边框、紧凑工具控件，去掉漂浮分段卡片和重复阴影。
- 文件树、搜索结果、变更列表与附件列表使用 Primer 语义 surface / border / selection token；文件名使用 UI 字体，路径、行号、标识符与表格使用 Mono。
- CodeViewer、Markdown、JSON、CSV、Diff、SVG 和媒体预览共享 GitHub 风格的 Light / Dark 配色，保留脏文件、修改、添加、删除等语义色；颜色仅作用于 Artifact Inspector，不污染 Chat 与 Settings。
- 验证：`svelte-check` 0 errors / 0 warnings、`vite build` 通过、`chat-ui.test.mjs` 173/173、Artifact viewer tests 43/43、`git diff --check` 通过。

## 2026-08-08

### Release v2.9.12 / Desktop v0.9.9

- 升级 root 与 Desktop/Tauri 客户端包版本，发布即时生效的小程序安装与更新机制、Telegram/飞书每日记忆按钮审核与任务排队按钮控制。

### Desktop 工件面板对齐 DESIGN.md（优化，P1）

- 右侧 File / Artifact Inspector 的文件名改用系统 UI 字体，路径、大小和代码继续使用等宽字体；文件类型图标统一为语义中性色，脏文件、触达和错误状态保留颜色表达。
- 项目 tab、变更范围、搜索模式和附件筛选统一为紧凑 macOS 分段控件：8px 外层、6px 分段、分隔线选中态，无浮层阴影；附件筛选补充 `aria-pressed`，窄屏文件栏与共享 300px 最小宽度保持一致。

### Mini App 安装与更新即时生效（新增，P0）

- 从本地目录、ZIP、GitHub、内置应用入口或 Agent `miniAppManage` 安装/覆盖后，新代码会在当前 Molibot 进程内立即激活，不再要求重启 App 或服务。
- 共享 Host 先停止接收新调用、等待进行中的调用结束并执行旧 Runtime 的 `dispose()`，再刷新 manifest，并主动加载新 Runtime；停用状态与独立数据目录保持不变。
- Server 模块图由 esbuild 打成内容寻址的 ESM 缓存；入口或任意相对子模块改变都会生成新模块 URL，同版本覆盖也会获得全新的模块作用域，App 自带依赖会一起打包。
- 桌面端删除了 `restartRequired` 状态、提示和响应字段。已启用应用的安装请求只有在新 Runtime 成功创建后才返回成功，因此加载错误会直接显示在本次操作中；停用应用保持不执行。
- 回归覆盖新安装即时调用、同版本覆盖、旧 Runtime 销毁、相对子模块缓存失效、相同字节重新激活和 App 本地包解析。

### Release v2.9.11 / Desktop v0.9.8

- 升级 root 与 Desktop/Tauri 客户端包版本，发布对齐 macOS Geist 设计规范的内置小程序以及小程序 AI 模型设置页面重构。

### Telegram / 飞书每日记忆按钮审核（新增，P1）

- 每日记忆反思保留原汇总通知，并在选定的 Telegram 或飞书私聊中逐条发送待确认记忆；每条带稳定编号和「保留 / 不保留」按钮，无需打开 App 或回复文字。
- 按钮决定由共享记忆层执行并持久化：编号和消息身份可跨重启恢复，重复点击、相反操作和过期卡片保持幂等；「不保留」沿用候选忽略与同命题抑制语义。
- Telegram 回调会即时应答并更新原消息；飞书先返回处理中卡片，再异步更新结果。临时失败会恢复原按钮供重试，群聊只收到原汇总通知，不披露候选内容。
- Skill 草稿建议仍需在 App 中审核；普通重复、替代或争议候选会在卡片中给出警告。
- 实现位于共享 `memory/review`、Owner 反思调度与 Telegram/飞书适配层；未向 QQ、微信或 Web 增加交互入口，也未把按钮事件写入 Agent Session。

### Telegram / 飞书排队消息按钮控制（优化，P1）

- 当当前任务仍在执行、后续消息进入持久队列时，Telegram 和飞书不再只提示 `/stop`、`/steer <queueId>` 命令，而是直接提供「停止 Stop」与「插入 Steer」按钮。
- 「插入 Steer」会把这条通知所对应的排队消息原文注入当前任务，并从队列移除，用户不需要再次输入内容；「停止 Stop」保持原 `/stop` 语义，停止当前任务并清除待处理队列。
- 按钮由共享运行时验证 Chat/Topic/队列项状态，同一通知的快速重复或相反点击只执行第一次；过期、转发或跨会话按钮不能影响后续任务。
- 飞书点击后先显示「操作处理中」，再主动更新原卡为「已插入当前任务」「已停止当前任务」或明确的过期/失败结果；若原卡更新失败，会发送同内容的文字回执，不再出现点击后没有任何反馈。
- Steer 一经共享 Runner 接受，即使模型随后发生首 Token 超时并整轮重试，插入内容也会在下一次尝试中按原顺序恢复，不再出现回执成功但最终回答只看到原消息；每次尝试只消费一次。
- 按钮回调属于临时运行控制，不写入 Session，也不会进入模型上下文。QQ、微信和 Web 的现有行为不变。

### MCP 目标级动态加载状态修正（已修复，P1）

- MCP 保存、启用和 Session 内 `loadMcp` 继续即时连接，无需重启服务；失败选择仍保留，后续轮次可以直接重试。
- 显式“重新连接”现在检查目标服务器的最终实时状态：目标仍为 Error/Disconnected 时请求会真实失败并返回已脱敏原因，不再出现界面提示完成但连接实际失败。
- `loadMcp` 从聚合连接数改为读取当前 Session workspace 下每个服务器的状态；即使服务器 A 已连接，目标服务器 B 失败也不会再被误报为加载成功。
- 增加显式重连失败、单服务器失败、多服务器下目标失败的回归守卫，并保留断线恢复、跨 Session 隔离和 MCP 输出预算测试。

---
## 2026-08-07

### 小程序 AI 设置迁至「设置 › 模型」，插件页去掉小程序管理（调整，P1）

「设置 › 插件」原本挂了一整套小程序管理界面（安装小应用的四个 tab、内置应用列表、已安装列表）加上小程序 AI 模型下拉。两者都不该在这里：浏览/安装小程序在侧边栏的 Mini Apps 入口已经有归属，而 AI 下拉本质上就是一条**模型路由**，和模型页上的其它路由是同一类决定。
- **删除** `MiniAppsSettingsGroup.svelte` 及其 `.miniapps-card` 包裹层；插件页现在只剩记忆后端 + 功能插件。`MiniAppsManager` 只在 `ChatWorkspacePane` 一处挂载，测试对所有 Settings section 断言不得再出现第二份。
- **迁移** `MiniAppsAiSettings` 到 `ModelsSection`，并改用模型页自己的 `SettingGroup` / `SettingRow` / `SelectControl` 原语重写（去掉自制的 `settings-card` + `settings-form` 结构），保证与新页面 UI 一致而不是"贴过来的一块"。两个下拉补上该页统一的 `technicalId` 技术详情折叠；费用提示与近 30 天用量块重新按 `SettingRow` 的 16px 内边距对齐。
- **改线** 小程序页的 AI 设置指路行由 `openSettings("plugins")` 改为 `openSettings("models")`。
- 控件仍各自即时提交，且模型页没有 `<form>` —— 这里的改动既不会被"高级路由"的保存顺手带走，也不会挡住它（已加守卫断言）。
- 改动文件：`apps/desktop/src/lib/settings/{ModelsSection,PluginsSection}.svelte`、`apps/desktop/src/lib/miniapps/{MiniAppsAiSettings,MiniAppsManager}.svelte`、`apps/desktop/src/ChatView.svelte`、`apps/desktop/src/styles.css`（删除 `MiniAppsSettingsGroup.svelte`）。
- 验证：`chat-ui.test.mjs` 173/173、`svelte-check` 0 errors / 0 warnings、`vite build` 通过。

### Todo/Note Mini App 头部布局统一 + 字号收紧（优化，P1）

两个 Mini App 共享同一 header 布局：应用图标 + 下拉菜单触发器 + 搜索框（单行）。Todo 下拉打开任务列表选择器（去掉冗余的汉堡按钮）；Note 下拉打开「笔记/归档」视图切换（原 tab 栏移入下拉，手动刷新按钮改为面板聚焦时自动刷新）。按 DESIGN.md 紧凑工具栏档收紧字号：搜索/触发器 32px、正文 14px、标题 16px（Todo 标题由 22px 下调）、折叠态 composer 40px。drift 守卫保持 4/4。
- **Note 无标题卡片**：不再为空标题预留标题行（操作按钮浮到右上角，内容从卡片顶部 padding 起排，消除上方空白）。

### 内置 Mini App UI 对齐 macOS / Geist 设计系统（优化，P1）

Todo / Note 两个内置 Mini App 原本沿用 Material Design 3 基线（Google Blue、Google Sans、M3 水波纹/阴影分层、Google Keep 调色），与桌面 App 的 macOS/Geist 风格明显不同。将 4 份 styles.css（todo / note / meeting-notes / miniapp-creator 模板）共享的 `--md-*` 基线重指为 DESIGN.md 的 macOS 产品层：accent `#007aff`、`-apple-system` 字体、AppKit 语义 surface/label/separator、6/8/12/999 圆角、阴影仅留给浮层（卡片靠边框扁平表达）。`--md-*` 命名保留（drift 测试 pin），仅改值，`uiDesignBaseline.test.ts` 4/4 守卫保持通过。
- **Todo**：移除 M3 水波纹，composer/search 聚焦改为边框 + accent 聚焦环（不再靠 elevation 阴影），列表/移动下拉改为白色 popover。
- **Note**：7 色卡片从 Keep 饱和色重调为 Geist 软色阶，移除水波纹改用细微 hover/focus（Note 灯泡图标保留不动）。
- **版本**：Todo 1.5.0 -> 1.6.0、Note 1.2.0 -> 1.3.0、Meeting Notes 1.1.0 -> 1.2.0（基线镜像，已装副本随版本更新）。
- 改动文件：`src/lib/server/miniapps/builtin/{todo,note,meeting-notes}/ui/styles.css`、`.../note/ui/{index.html,icon.svg}`、`skills/miniapp-creator/template/ui/styles.css`、3 个 `manifest.json`。
- 测试：`uiDesignBaseline.test.ts` 4/4、`bootstrap.test.ts` 17/17。

### Release v2.9.10 / Desktop v0.9.7

- 升级 root 与 Desktop/Tauri 客户端包版本，同步发布 Mini App Redesign 与微信孤儿进程租约隔离机制。

### Mini App 填充至输入框（composer.insert）菜单图标补全（优化，P1）

- **Note Mini App**：为下拉菜单中的「填入输入框 / Insert into composer」补全 Material SVG 图标 `SVG_ICONS.composer`，与「归档」「删除」选项的图标呈现统一视觉规范。
- **Todo Mini App**：新增「填入输入框 / Insert into composer」操作按钮及 `insertIntoComposer` 宿主桥通信（`composer.insert`），点击即可将待办标题快速填充至聊天草稿输入框。

- 改动文件：`builtin/note/ui/app.js`、`builtin/todo/ui/app.js`

### Todo Mini App UI 精细化排版与视觉重构（优化，P1）

重构 Todo Mini App 视觉表现，在保持 Material Design 3 基线（`uiDesignBaseline.test.ts` 4/4 守卫完全通过）前提下解决视觉杂乱、元素拥挤问题：
- **行左侧精简**：隐藏普通优先级（pri-normal）的冗余双圈图标，仅保留主 Checkbox；仅高/低优先级渲染彩色警示环，彻底解决「每行像有两个复选框」的杂乱感。移除星标负边距悬挂。
- **分组卡片与分割线**：`.group-card` 统一应用 M3 Container 低阶层级与 `border-color: var(--md-outline-variant)` 内部分割线，呈现清晰层级。
- **顶栏与列表切换**：顶栏标题增加下拉 Chevron 指针与平滑旋转动画，支持点击标题直接展开列表选择器；列表计数器重构为高对比度 Pill 徽章。
- **搜索与快速添加**：搜索框与 Composer 优化边框焦点态（`var(--md-primary)` 高亮与 `elev-2` 提升），Date/Time 原生控件统一暗色/明色主题包裹层。
- **空状态重构**：增加 SVG 绘图插画与优雅无任务提示，替换原本单薄的纯文字文本。

- 改动文件：`styles.css`、`index.html`、`app.js`
- 验证证据：`uiDesignBaseline.test.ts` 4/4、`todo.test.ts` 10/10、`host.test.ts` 42/42 全过。

### Mini App schema 升级不再阻止启动（修复，P0）

`host.ts` 的 `assertSchemaVersion` 原本在 `_host.json` 记录的 schemaVersion 与 manifest 声明不一致时直接抛 `load_failed`。这导致任何 bump 了 schemaVersion 的 Mini App（如 Todo v3 添加 `due_at`/`remind_at` 列）在更新后无法启动，尽管 app 自己的 `openDatabase()` 有 defensive `ALTER TABLE` 迁移。改为记录日志 + 放行，`writeHostState` 在运行时创建成功后记录新版本。如果 app 迁移失败，错误自然传播，记录版本不变。

- 改动文件：`src/lib/server/miniapps/host.ts`
- 测试更新：`src/lib/server/miniapps/host.test.ts`（42/42 通过）
- Todo 专项测试 10/10 通过（含 v2→v3 schema 迁移）

### Mini App 版本升级：Note v1.1.0 → v1.2.0，Todo v1.4.0 → v1.5.0（版本升级）

Bump 版本号以触发 Mini Apps Manager 的更新检测。包含了 Note「填入输入框」菜单图标补全，以及 Todo 视觉重构与「填入输入框」快捷按钮功能。

- 改动文件：`builtin/note/manifest.json`、`builtin/todo/manifest.json`



### 三个内置 Mini App 统一到一套 Material 3 设计基线（改进，P1）

面板里像三个不同的产品：Note 是 Google Keep，Todo 是 iOS（`-apple-system`、`#007aff`、14px 圆角、SF 风格分隔线），Meeting Notes 是压成一行的通用灰蓝，各带一套配色——三套字号体系、三套阴影、三种「按钮长什么样」。现在三者都从同一份 Material Design 3 token 渲染：Google Blue 主色、完整的中性 surface-container 阶梯、**字号与行高成对**声明的字阶、4/8/12/16/28/full 形状阶、M3 缓动曲线，层级用容器色调 + 轻阴影表达。

- **基线是有意复制的，并且有守卫。** 每个 App 一个 origin、CSP 为 `default-src 'self'`（`httpRoute.ts`），三者之间不存在可以 import 的样式表——`--md-*` 这段只能逐字复制到三个 App 加 `skills/miniapp-creator/template`。某一份漂移不会报任何错，只会让面板重新变回三个产品。新增 `uiDesignBaseline.test.ts` 从四份样式表里解析 token 声明，一旦不一致就失败；同时检查 `[hidden]` 守卫是否仍在最前，以及是否出现裸 `font-size: Npx`（pitfall 24 那条漂移机制）。已用人为改坏验证过它**确实会失败**，不只是能通过。
- **交互态改为 state layer**：hover/press 用 `color-mix(in srgb, currentColor 8%/12%, transparent)`，菜单与图标按钮带纯 CSS 涟漪，各处补上 `:focus-visible` 焦点环。实心按钮的 `background-color` 已被占用，改用海拔 + `brightness()` 表达 hover。
- **App 自己的表达色留在 App 层**，叠在基线之上：Note 保留便签配色（换成 Keep 现行色板与其真实暗色集），Todo 保留优先级色。Note 的色点不再写行内 hex——色点和它代表的便签面由同一组 `[data-color]` 规则上色，两种主题下都不可能对不上；选中态也从「只靠颜色」改成显示对勾。
- **图标**：三个应用图标原本是三种视觉语言（一个 64 单位蓝色方块 + 两个 24 单位字形），现统一为 Google 配色的 24 单位双色字形。应用内 SVG 换成 Material Symbols 几何与 M3 图标尺寸——Todo 的操作行此前在画 13px 图标。
- **顺带修掉三个真实缺陷。**（a）Todo 的「已完成」分组一直在渲染但永远不可见：`index.html` 上的行内 `style="display:none"` 压过了本该显示它的 `.done-section.visible { display: block }`——与已记录的 `[hidden]` 是同一族失败，只是把作者 `display` 换成了行内样式，同样一声不吭。（b）Todo 的静态外壳（搜索占位符、New To-Do、Add、New List、No to-dos、优先级标签）从未被翻译，zh 语言下是中文内容外面套一圈英文界面——这正是「看着乱」的大部分来源；现在走另外两个 App 相同的 `data-i18n` 流程。（c）Todo 的列表强调色取自 iOS 系统色且只有一套，同一个色值同时被用作亮暗两种表面上的文字色；改为 Google 标签色板并分主题两套。
- Meeting Notes 另外补上状态 chip 的本地化（此前两种语言都直接显示英文枚举值），并把录音条从 `error-container` 移开——录音是状态不是错误，整条红色横幅在暗色下读起来像出了故障；警示色现在只花在脉动圆点和「停止」按钮上。
- 未升版本，未改动任何 App 的数据、工具或 API 表面。
- 验证：Mini App 服务端 + 路由套件 127/127（含新增基线守卫 4/4）；desktop unit 145/145、结构 177/177、Rust 52/52。不靠肉眼：三个 UI 都通过 stub API 的静态 harness 实际渲染，在亮/暗两种主题下检查了 shipped `app.js` 产生的真实 DOM——Note 的网格/编辑框/调色盘、Todo 的列表/列表选择器/编辑框/已完成分组、Meeting Notes 的双栏详情/分段/录音条。

### Mini App 展示面：结果卡片、深链、侧栏徽标与 Composer 桥 v2（新增，P1）

roadmap §2.2–§2.5 四条能力一起交付。它们补上了前几个切片留下的缺口：App 已经能接收消息、能调宿主模型，但产出回到用户面前时只有一行纯文本，没有任何办法指向它刚做出来的东西。

- **Composer 桥 v2**：新增 `composer.attach` 与 `chat.openSession`。`composer.attach` 是缝 4 Phase 2 附件去程的**回程**——App 处理完的图或导出的纪要可以填回聊天草稿。`path` 是 App 自己数据目录内的相对路径，宿主 `readDataFile()` 跟随符号链接后证明包含性再读取（≤32 MiB），响应只有 basename 和字节，WebView 全程拿不到宿主路径。**v1 App 不受影响**：两个版本同时受支持，且每个版本的动作集冻结——v1 消息请求 v2 动作得到 `unsupported_action`，不会被静默升级。桥依旧只搬运 UI 意图，没有任何动作能发送消息或触发 Agent 轮次，这条纪律有结构守卫。
- **结果卡片**：工具结果可带 `card`（标题、副标题、≤6 条 label/value、Phosphor 图标、一个深链），在 Chat 与 Project Chat 的消息动作反馈处渲染。**刻意偏离** roadmap 原文的「复用 iframe/CSP 边界」：卡片出现在滚动的 transcript 里，每张一个 iframe 就是不设上限的活文档；更关键的是 iframe 什么都能做，与同一段话自己的约束「卡片是展示、交互一律跳面板」直接冲突。固定的声明式结构让这条约束由构造成立。`content` 仍是权威文本——模型只读它，非桌面端也只显示它。
- **深链** `molibot://miniapp/<id>/<path>`：解析成意图后在进程内路由，永不交给 WebView 导航（卡片上是 `<button>` 而非 `<a>`）。定位符作为 `?path=` 启动参数随 `locale`/`theme` 交给 App，语义完全归 App。解析**不走 `new URL()`**：URL 解析器会先把 `..` 规范化掉，`molibot://miniapp/notes/../../etc/passwd` 会变成指向 `etc` 这个 App——一个声称打开 A 的链接静默打开了 B。**本期未做** OS 级 scheme 注册；当前消费方都在应用内，将来只需把同一个解析函数接到系统入口。
- **侧栏徽标** `ctx.badge`：计数（上限 99）或一个无标签圆点；`count <= 0` 等同清除，而不是渲染一个 "0"。刻意做小——没有系统通知，没有打断式弹窗。**只存在内存里**：重启后不可能还有进行中的工作，恢复一个没有依据的计数正是 pitfall #23a/#23d 那一类错误。写入方只有 App 服务端（桌面路由只能 `clear`），用户打开面板即清除，且应用服务端返回的整份 catalog 而不在本地猜。被停用/加载失败的 App 不再对外报告徽标。
- Creator 模板与 `reference.md` 覆盖四条契约（含老宿主要用 `ctx.badge?.` 的说明），模板 `engines.molibot` 提到 `>=2.9.9`。模板已通过真实宿主加载验证：卡片被 sanitize、徽标进入 catalog、深链限定在声明它的 App。
- 顺带修复：`apps/desktop/src/lib/miniapps/messageActions.test.ts` 从未被列入 desktop `test` 脚本，上一个切片自己的桌面测试一直没有在门禁里跑过。
- 版本：服务端 2.9.9、Desktop 0.9.6。未打 tag、未推送、未发 Release。
- 验证：Mini App 服务端 + 路由套件 187/187（新增深链 10、卡片 10、桥 v2 10、attach 7、badge 4），desktop unit 145/145 + 结构 173/173 + Rust 52/52，`svelte-check` 0 errors / 0 warnings，根与 desktop `vite build` 均通过。新守卫在交付前抓到并修掉两个真实缺陷：上面那个 `..` 规范化导致的跨 App 路由问题，以及一个未定义的 `--radius-medium` token（pitfall #5，由既有 CSS 变量守卫发现）。

---
## 2026-08-06

### Mini App ↔ 主程序通信平台（新增，P0/P1）

- 消息、选区和附件现在可由 Desktop 通过 manifest `contributions.messageActions` 确定性送入 Mini App，不经过模型。服务端重建时间/来源/截断状态，正文按 UTF-8 64 KiB 安全截断；附件从真实会话 locator 解析后以不透明文件名暂存到目标 App `incoming/`，不暴露会话 id、宿主路径或原路径。
- Bridge v1 只接受来自当前 iframe 的 `molibot-miniapp` / `composer.insert`，32 KiB 上限，支持 append/replace；填入并聚焦 Session/Project 当前草稿，但不发送、不改模型/附件/队列，历史编辑态和只读 external view 会拒绝并保留原草稿。
- Runtime 新增 `ctx.ai.generateText()` / `transcribe()`：能力声明、实时模型路由、宿主凭据、无工具非流式文本、App dataDir realpath、25 MiB/10 分钟音频、BCP-47、Abort、每 App 并发 2 + 30/min、稳定脱敏错误和成功/失败 JSONL 计量。Manager 提供细粒度模型设置、费用/不可用提示及近 30 天按 App 汇总；设置已做 fresh-store round-trip。
- HTTP raw body 只在 manifest 明确允许的 `/api/*` 路由开放，路径段匹配并在 Runtime 前 413；Tauri transport 绝对硬顶 25 MiB。第三方 AI App 初装默认 disabled，须用户看过费用提示后显式启用。
- Todo v1.0.2 增加「存为待办」活体动作；新增按需安装的 Meeting Notes v1.0.0，按 60 秒永久保存音频分段、独立转写/重试、失败不中断后续段、尾段完成后生成 Markdown 纪要，支持重启 interrupted、失败段重试、重新生成、重命名和不可恢复删除。
- `miniapp-creator` Skill/Agent 模板升级到 1.3.0，模板与作者指南覆盖 message actions、bridge、`ctx.ai`、raw 上传和 restart-safe job。
- 机器证据：消息/bridge/manifest/AI/settings/resources 聚焦测试 23/23；HTTP、built-in 与 Meeting 测试 32/32；用量/settings/manifest 16/16；Desktop `svelte-check` 0/0；服务端生产构建通过。该切片当时尚缺真实验收；产品负责人已于 2026-08-09 在真实 App 确认麦克风可用，当前状态以能力矩阵为准。

### 内置小程序独立成 tab：可安装 / 可更新 / 可卸载（新增，P1）

此前「内置」只是一个标签，不是一类可管理的东西：管理页只列**已安装**的应用，于是被卸载的内置应用会从产品里彻底消失（卸载墓碑正确地阻止了下次启动自动装回），而这个版本自带、但从未安装过的应用根本无从发现。而且内置应用是不问自取地装进工作区的。

- **「管理小程序 › 安装小应用 › 内置应用」新增一个 tab**，排在四个安装来源的第一位。每行直接回答用户真正会问的两个问题——*装了没有？有没有新版？*——名称、描述、图标、版本、工具列表都从**打包进构建的那份副本**里读，所以磁盘上有没有东西都能显示一行。状态：`未安装` / `已卸载`（用户主动删的）/ `已是最新` / `有新版本 v1.2.0`。
- **安装、更新、卸载都在这一行完成。** 安装与更新在宿主里是同一个操作（`installBuiltin`），区别只在于「之前有没有」；同样遵守 挂起 → 排空 → dispose → 覆盖 的顺序，因为正在运行的应用可能持有被替换目录里的 SQLite 句柄。只覆盖代码：应用数据目录从不触碰，启用状态保留（关着的应用拿到新代码，仍然是关着的）。安装会清除卸载墓碑，否则下次启动就会把用户刚要回来的东西再删一遍。
- **`Note` 作为内置应用发布**；并且新增内置应用一律「按需安装」：`autoInstall` 按应用声明，`todo` 保留（空工作区首次启动仍自带这个参考应用，行为不变），其余只在列表里作为「可安装项」出现。升级不会往用户工作区里塞新应用。
- 内置 id 列表改为从打包清单推导（`builtinMiniAppIds()`），不再在 `registry.ts` 里手写第二份——正是 pitfall #22 的形状：漏登记会让某个应用「发布了但不被认作内置」，没有更新、没有内置重装、provenance 还写成 `directory`。
- 所有 Mini App 路由现在统一通过 `buildDesktopMiniAppsPayload()` 返回**两份目录**（`{ items, builtin }`），store 也成对赋值：安装/更新/卸载会同时改变两份列表，只返回其中一份就会让另一份停留在点击前的状态。桌面端遇到不返回 `builtin` 的旧服务，降级为「没有可装的内置应用」而不是抛错。
- 新增路由 `GET/POST /api/desktop/miniapps/builtin`。它不并入 `/install`：这里没有需要用户判断是否可信的来源，因此该 tab 不重复第三方信任警告（在自家应用上重复这句话，只会训练用户忽略它）。
- 机器防护：`src/lib/server/miniapps/bootstrap.test.ts` 覆盖内置目录、按需安装、墓碑往返、旧副本更新、id 推导；`src/lib/server/app/desktopMiniApps.test.ts` 覆盖双目录投影；`apps/desktop/src/chat-ui.test.mjs` 断言 tab 与 `applyCatalogs`。其中一条通用用例会安装并 smoke test **每一个**打包的内置应用，新增内置应用不可能只在目录里出现却加载失败。
- 附带：Todo 图标按 Note 的风格重画（24×24、无底板、同色系三阶平涂）。
- 验证：Mini App bootstrap 17/17、host/install/manifest 48/48、投影 5/5、desktop UI 168/168 + unit 143/143 + Rust 52/52，`svelte-check` 0/0，`vite build` 与 desktop `vite build` 均通过。并对着临时数据目录上的真实服务走了一遍 HTTP：列出 → 安装（`note` 出现并加载）→ 卸载（写入墓碑）→ 重新安装（清除墓碑）→ 改旧版本号后重启（`updateAvailable: true`）→ 更新（回到打包版本）。

### 打开小程序后切换会话丢失小程序、会话里「文件面板」为空（已修复，P1）

两个现象，同一个接缝。

- **切换 Session 时小程序被销毁。** `ArtifactTabsStore.connect()` 在上下文（endpoint / project / profile / session）变化时清空**所有** tab，于是选中另一个会话就把正在运行的小程序 iframe 一并拆掉，面板退回文件侧。小程序是独立的工作面，不是「它恰好被打开时那个会话」的产物：现在 `connect()` 保留小程序 tab、当前选中项与所处 mode，只清理确实属于旧上下文的 file/diff tab。`{#each}` 的 key 不变，保留下来的 tab 复用原 DOM，iframe 文档不重载。
- **会话里切回「文件」是空的。** Session scope 下面板只渲染已打开的文件 tab，背后是一句「暂无工件」；真正的会话产物列表在 `ChatView` 的**另一个**右侧 aside 里，而宿主只在「没有打开小程序」时才渲染它。所以一旦开着小程序，那个列表根本无法到达，文件侧从结构上就是空的。现在产物列表移进面板内部（媒体类型筛选、数量/体积页脚、点击在下方查看器打开、下载），旧 aside 删除，Chat 在任何 scope 下都只挂一个右侧检查器。
- 合并时暴露的两处旧问题：面板读取附件时把 profile 硬编码成 `"personal"`，对属于其它 bot 的会话会返回空列表且不报错——现在接收宿主传入的 `profileId`，与转写区自己的预览/下载走同一套身份解析；`.project-panel-body.browser-collapsed > .project-browser` 自 `.artifact-file-surface` 包装层引入后就不再匹配，折叠按钮点了没反应，规则改写到包装层上。
- 面板可见性改由实时的 `projectPaneActive` 推导，不再读打开时写死的 `inspector.scope`，可见性判断与真正传给面板的 props 不可能再打架。
- 机器防护：`apps/desktop/src/chat-ui.test.mjs` 断言 `connect()` 保留小程序 tab 与 mode、Session 产物列表面存在、不再有 `artifactEmpty`、关闭最后一个 tab 不关面板、单一检查器（`inspectorVisible = artifactPanelVisible`，无 `sessionFilesAsideVisible`、无 `file-list`）、折叠选择器写在包装层上。
- 验证：desktop UI 167/167 + unit 143/143 + Rust 52/52，`svelte-check` 0/0，`vite build` 通过。并对着真实服务走了一遍冷路径：打开小程序 → 切会话（小程序还在）→ 切到「文件」（列出会话产物）→ 打开文件（列表上、查看器下分屏）→ 关闭 tab（列表仍在）→ 切到项目会话（文件树/变更/附件正常，小程序 tab 仍在）→ 折叠再展开列表。

### 工件面板四个文件预览 bug 修复（issue #31，已修复，P1）

统一工件面板上线后，项目文件面板里 CSV 和图片预览空白/一直转圈、`.gitignore` 打开后是系统打开卡片而非内容、Markdown 源码视图无行号。四个 bug，四个不同根因。

- **CSV 遇到重复值就空白。** `CsvTable` 的三个 `{#each}` 都用**值**做 key（`row.join("\0")`、`cell`、`header`）。Svelte 5 在**生产环境**也会抛 `each_key_duplicate`（不是只 dev 警告），所以一行 `yes,yes,yes,yes`、两行完全相同、或重复列名都会在渲染时抛错，tab 直接空白--数据类 CSV 极常见。改为按行/列 index 做 key：CSV 是静态列表，追加行只新增 index，重载则在原 index 原地更新，安全。顺手去掉 `row.join` 里嵌的原始 NUL 字节（git 因此把 `CsvTable.svelte` 当二进制）。
- **图片被 CSP 挡住。** `app.security.csp` 的 `media-src` 允许了 `http://127.0.0.1:*`（所以 video/audio 能流式播放），但 `img-src` **没有**，于是 `<img src={serviceUrl}>` 被拦、video/audio 却正常--这正是只有图片被报坏的原因。`img-src` 现与 `media-src` 对齐；同一改动也修好了 SVG 流式渲染图和会话附件图片。
- **`.gitignore` 打开成系统卡片。** `classifyFilePreview` 对 dotfile 返回 `"binary"`（`extensionOf` 把 `.gitignore` 整串当扩展名），`matchViewer` 据此路由到 `"system"`，面板只给「在外部打开/在 Finder 中显示/下载」。新增 `TEXT_DOTFILES` 集合，把常见配置 dotfile（`.gitignore`/`.gitattributes`/`.gitmodules`/`.dockerignore`/`.editorconfig`/`.npmrc`/`.nvmrc`/`.prettierrc`/`.eslintrc`/`.babelrc` 等）判成 `"text"`；服务端本就用 `detectTextEncoding` 把它们读成文本，于是直接在 CodeViewer 里打开。`.DS_Store` 等二进制 dotfile 仍走系统卡片。
- **Markdown/CSV/SVG 源码视图无行号。** 三者原本都是裸 `<pre>`，现统一复用共享的 `CodeViewer`，源码视图 thus 带行号、查找、换行，和其它文本文件一致。`MarkdownPreview`、`CsvTable` 新增 `name` prop 供 CodeViewer 按路径高亮。
- 机器防护：`apps/desktop/src/chat-ui.test.mjs` 断言 CsvTable 用 index key、无原始 NUL、源码视图走 CodeViewer、`name` prop、CSP `img-src` 含 loopback；`viewerRegistry.test.ts` 断言 `.gitignore` -> `code`；新建 `src/lib/shared/filePreview.test.ts` 覆盖 dotfile 分类（接入 `test:projects`）。
- 验证：desktop UI 166/166 + unit 143/143 + Rust 52/52，`test:projects` 68/68，`svelte-check` 0/0，`vite build` 通过。CSP 改动烧在 Tauri 构建里，需要 Rust 重建（pitfall #18），WebView reload 不生效。

### 单个 MCP 工具结果可撑爆上下文，且压缩永远救不回来（已修复，P0）

现象是 provider 返回 400：一次请求携带约 288 万 token 文本，而端点上限 100 万。这不是多轮累积——是约 11 MB 在**一个工具步骤**里一次性进来的——它暴露了两个看起来像一个 bug 的缺口。

- **MCP 结果此前原样内联**：`read`、`bash` 都会把自己的输出截到 `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` 并把全文落盘，但 `normalizeToolContent` 把 `item.text`、`resource.text`、`structuredContent`（还带缩进美化，比线上载荷更大）无上限地直接塞进上下文。MCP server 是第三方代码，「它的回答可以多大」从来就不该交给它决定。现在统一走 `capMcpToolContent`：同一个结果的**所有**文本 part 共享一份预算——把载荷拆成 50 段的 server 和返回单个大块的 server 受到完全相同的约束——全文落盘到与 bash 相同的位置，图片 part 原样保留。
- **压缩修不好这条消息**：`findFirstKeptIndex` 无条件以最新一条消息作为保留切片的起点（丢掉模型刚产出或刚消费的那条会破坏该轮），所以当**单条**消息就大于整个窗口时，每次压缩要么返回 `changed: false`，要么压完仍然超窗，溢出重试随之放弃，该会话从此再也跑不动——那条消息被之后每一轮继承。现在 `capOversizedMessages` 会重写任何超过 keep-recent 预算的单条消息；由于 `appendCompaction` 持久化的正是压缩后的列表，这个大块是真正离开了活动上下文，而不是每轮重截一次。
- 两个细节，任一处做错都会让修复「看起来生效、实际什么也没做」：`truncateHead` 从不切分行，所以压缩后的 JSON（一整行）会返回**空内容**——两条路径都回退到按字节安全切分的 `sliceToBytes`，它会跨过 UTF-8 续字节，不把一个字符劈成两半；压缩侧的字节预算取每 token 2 字节，对中文（1 个 3 字节字符 = 1 token）和 ASCII 都低于估算器的真实成本（pitfall 8）。
- 落盘代码此前已在 `bash.ts` 与 `hostToolExec.ts` 里写了四遍；这次没有加第五遍，两者统一委托给 `outputSpill.ts`，其写入永不抛错——只读的临时目录应当降级成「已截断、无全文指针」，而不是让产出这份输出的工具调用失败（pitfall 7）。
- 机器防护：`compaction.test.ts` 覆盖单条超窗、无历史可摘要、toolCall 块不得被改写、中文预算四类用例；`mcp.test.ts` 覆盖小结果原样透传、跨 part 共享预算、单行载荷、图片不被丢弃、落盘全文往返。
- 验证：`compaction.test.ts` + `compactionFileOps.test.ts` + `bash-output.test.ts` + `read.test.ts` + `runnerHelpers.test.ts` 64/64，`mcp.test.ts` 9/9，`tools/index|path|sandbox` + `hostBashExecContext` + `hostBash/approval` 31/31，全部改动文件 `tsc --noEmit` 无新增报错。
- **明确暂不做**：请求前的尺寸闸门。上面全部仍是反应式的——请求照发，靠工具层上限兜底或被拒后重试。在发请求前用 `contextWindow` 校验已组装的上下文，才能不再依赖 `isContextOverflowError` 里那约 25 种 provider 报错措辞。此项立项而非半做。

### 工件面板拆成「文件 / 小程序」两个界面（已完成，P0）

用户使用实际构建后反馈：「点击文件后会回到文件窗口，小程序就丢失了」。背后是两个问题，而 tab 混排只是其中之一。

- **混排的 tab 条本身是错的模型**：Slice 0 把「小程序只是另一种 tab」当作核心决策。实际用起来，一条 tab 条里 `AGENTS.md` 挨着一个正在运行的记账应用，「去看个文件」和「离开我的应用」变成了同一个手势。现在面板头部有「文件 / 小程序」分段控件，两侧各有自己的 tab 条、各自记住自己的选中项，切回来还在原处。多个小程序之间仍然用 tab 并存。
- **切换器是头部里一个低调的下拉菜单，不是独立控件**：面板只有约 380px 宽，两个方向上空间都紧张 —— 单独占一行会把内容往下压、且重复显示 tab 条已有的应用名；改成分段控件后又用头部宽度长期陈列两个选项。相对于在一个界面里的阅读时间，切换界面本身是低频动作，所以现在只显示当前界面名 + 一个下拉箭头，点开是两项菜单。两个头部合并为一个：触发器占用原标题的弹性空间（优先压缩文字，让操作按钮保持自然宽度，pitfall 16a），文件类操作只在文件模式出现，没有打开小程序时头部保持纯标题。
- 复用 `OverflowMenu`（为其增加可选 `trigger` slot 与 `inline` 变体），而不是新写一个浮层 —— 否则关闭、Esc、方向键三套行为都会被 fork（pitfall 7）。浮层在触发器下方左对齐展开；祖先链上没有裁剪它的 overflow，头部已有的 `z-index: 31` 让两者都盖过窗口拖拽遮罩。
- 换头部时带出的两个问题一并修掉：原本是标题的 `flex: 1` 把操作按钮顶到右边，而按内容定宽的触发器没有任何元素吸收空白，按钮就贴着触发器堆在左侧 —— 现在触发器带 `margin-right: auto`，既保持按标签定宽（低调控件不该拥有一整条头部宽的悬停区），又让操作按钮固定在右边缘。另外 `.file-panel-head strong` 是**后代**选择器，连菜单触发器里的 `<strong>` 一起命中，把它的字号覆盖成裸 13px 并让它在触发器内拉伸；已改为直接子选择器，这本来就是它的原意。
- 由此 `.miniapp-panel-head` / `-title` / `-close` 与 `.miniapp-icon-panel` 成为死代码并删除；原本断言 `.miniapp-panel-head` 的 `z-index: 31` 拖拽遮罩防护改为断言 `.file-panel-head` —— 现在真正存在的那个头部。指向死规则的断言等于没有防护，而这条覆盖的是 pitfall 18，其失败表现正是按钮静默失灵。
- **真正丢数据的是生命周期 bug**：`{#if miniAppActive}` 和文件分支是兄弟分支，激活文件 tab 会销毁所有 `MiniAppPanel` 及其 iframe —— 小程序回到初始界面，填了一半的内容全没。现在所有已打开的小程序始终挂载，用 `display: none` 隐藏（这能让 iframe 的 document 保持存活）；文件界面同样用隐藏而非移除，因此往返一趟后滚动位置还在。**只拆 tab 条并不能修好这一点** —— 每次切换应用照样会被拆掉。
- 连带处理：`MAX_OPEN_TABS` 改为按类型分别计数，浏览十几个文件不会悄悄挤掉用户在另一侧开着的小程序；`closeTab` 在同类型内回退，不会跨类型跳走；`closeAllTabs` 只关当前模式，且只 revoke 这一部分。
- Slice 0 中正确的部分保留了：一个面板、一列 inspector、一个 resizer、一份宽度预算、一套 viewer 注册表。挂载缝隙仍然唯一，拆开的只是 tab 模型。
- 机器防护：原「co-hosts files and Mini Apps」断言替换为分离断言（两份 tab 列表、两个选中项、任何 tab 条都不得遍历合并后的 `store.tabs`、按类型封顶、按类型回退）与存活断言（三处 `class:is-hidden`、面板内有且仅有一个 `MiniAppPanel` 挂载、`display: none` 规则存在）。已验证移除隐藏后存活断言会失败。
- 验证：桌面 UI 测试 163/163 + 单元 142/142 + Rust 52/52，`test:projects` 62/62，`svelte-check` 0/0，两侧 build 通过。

### 工件 tab 超上限淘汰时泄漏 blob URL（已修复，P1）

补 PRD §3.38 test seam #5（「关闭 tab 必须 revoke blob URL」）时，正是这条断言找出了唯一没有释放的移除路径。`closeTab`、`closeAllTabs`、`connect`、`dispose` 四条都正确 revoke，但 `MAX_OPEN_TABS` 上限是在三处 open 路径里各自内联 `next.slice(next.length - MAX_OPEN_TABS)` 实现的，每一处都在悄悄丢掉最旧的 tab 而不释放它。打开第 13 个会话附件，第一个的字节就会在整个 WebView 生命周期内泄漏，且任何 console 都看不到。

- 淘汰即关闭，三条 open 路径现在统一经由 `#commitTabs` 提交，由它负责 revoke 被挤出去的 tab。`MAX_OPEN_TABS` 只被其声明处和该 helper 引用。
- `apps/desktop/src/chat-ui.test.mjs` machine guard：`createObjectURL` 有且仅有一处、五条移除路径各自 revoke、不得再出现内联封顶、上限不得在 helper 之外被引用。已验证该断言在修复前的代码上失败、修复后通过。

### Session scope 的 HTML 预览与文件操作条补齐（已完成，P0）

Slice 2/3 落地后按 PRD §3.38 逐条核对代码发现的两个缺口。

- **Session scope 下相对资源加载不出来**：artifact 路由此前只接受 `scope === "project"`，聊天附件的 HTML 预览退回 `URL.createObjectURL(blob)`。blob URL 没有路径，页面里所有相对 `css/`、`img/`、`../assets/` 引用一律解析失败，多文件页面只剩骨架，且任何地方都不报错。现在 Session 预览走与 Project 相同的按根托管通道，根为该 Session 的 workspace，`..` 与符号链接逃逸沿用同一套 fail-closed 校验。blob 仅保留为路由拒绝服务时的兜底——外部渠道会话的 workspace 里是别人发来的文件，渲染执行比只流式传字节能力更强，故明确排除。
- **Session token 是单一共享编解码**：Session 没有 Project 那样的单一 id（profile + session + 可选 project），三者打包成一个不透明 base64url 段，只带 id、绝不带宿主路径。它放在 `src/lib/shared/artifactToken.ts`，WebView 与服务端共同引用——客户端另写一份，正是编码端与解码端漂移成静默 404 的经典路径，而那个 404 表现出来又恰好是「相对资源又坏了」。
- **Session 操作条此前只有「下载」**：现在补齐复制路径、在 Finder 显示、用系统应用打开，经新增的 `POST /api/web/files/reveal`，与 Project 的 inspection reveal 对称——共用同一个 spawn 辅助（`shell: false` + 参数数组），绝对路径在服务端根校验之内解析且从不回传。同一组动作也接进了 `SystemOpenCard`，`.docx` 附件终于可以打开而不只是下载。
- `resolveAuthorizedConversation` 从 `/api/web/files/+server.ts` 抽到 `src/lib/server/web/sessionWorkspace.ts`，字节路由、预览路由、reveal 路由现在对「这个 Session 属于哪个 workspace、调用方是否有权访问」共用同一个答案（pitfall 7）。
- Session tab 的 `path` 由空串改为附件的 workspace 相对路径，使同一个路径字符串在每个读取它的动作里含义一致（pitfall 6 推论）。
- **明确暂不做**：Session scope 的「作为 `@` 引用插入」。composer bridge 目前只服务 Project，更根本的是共享 Runtime 会把 `@[name](path)` 对照已注册的 Project root 校验（§3.35），普通会话没有对应物，按钮插进去的引用会被 Runtime fail closed 拒绝。这需要 Runtime 先有 Session 附件的引用模型，不是接根线的事。
- 机器防护：`artifactRoute.test.ts` 覆盖 token 往返 / 只含 id / 非法拒绝，以及 Session workspace 的逃逸用例；`apps/desktop/src/lib/api.test.ts` 覆盖客户端↔服务端 token 一致性（含 CJK id）；`chat-ui.test.mjs` 覆盖路由优先于 blob、客户端不得自建 token、session tab path、Session 动作集合（含刻意缺席的 `mentionInChat`）。
- 验证：桌面 UI 测试 160/160 + 单元测试 142/142 + Rust 52/52，`test:projects` 62/62，`svelte-check` 0/0，两侧 build 均通过。冷启动 smoke walk 仍未做（见下条）。

### 工件面板补齐 Markdown / JSON / SVG / mermaid 与不可预览兜底（已完成，P1+P2）

PRD §3.38 Slice 2、Slice 3。右侧统一工件面板的容器（Slice 0：一个 tab 容器 + viewer 注册表，小程序作为一种 tab）与 Slice 1（沙箱 HTML 预览、聊天附件接入面板、CSV 表格）此前已在工作区完成，本次补齐剩余查看器。

- **Markdown** 复用聊天转录自己的 `renderMarkdown`（同一套 marked + highlight.js + DOMPurify），不新起第二条渲染链路，Agent 写的报告在面板里和在对话里读起来完全一致。外链跳转与代码块复制按钮的点击行为原本要被复制一份，因此抽到共享的 `lib/markdownInteractions.ts`，转录与面板共用（pitfall 7）；面板以 action 形式挂载，避免给纯布局容器编造 ARIA role。
- **mermaid** 图表在 Markdown 内渲染，用动态 `import()` 且以「文档里确实有图」为前提加载——库约 590 kB，始终是独立 chunk，不进初始包。`securityLevel: "strict"`，因为图表文本是 Agent 生成内容。渲染失败只回退该图的源码，不会让整个 tab 空白。主题切换会重新渲染，因为 mermaid 把配色烘进 SVG 而不是读 CSS。
- **JSON** 默认以原始源码打开，使用 CodeViewer 高亮和分块加载；点击显式操作后才进入可折叠树，超过两层的容器默认折叠。解析失败、超过 1 MB 或超过行数预算都可见且回退源码。上限按 UTF-8 字节计，不按字符数——按字符数会把中文少算约 3 倍（pitfall 8）。
- **SVG** 拥有独立 viewer 且排在媒体判定之前，因此在两种 scope 下都能「渲染 + 一键看源码」。渲染走 `<img src=…>` 而非内联标记：`<img>` 文档无法执行脚本，也无法拉取外部资源。
- **音频**此前已由 `MediaViewer` 支持，现在通过同一套注册表分发，Session scope 同样可用。
- **无法预览的格式**（Office、未知二进制、超大文本）给出真正的卡片：图标、文件名、大小、原因，以及「用系统应用打开 / 在 Finder 中显示 / 下载」。Office 明确不做内嵌预览——转换链路重、收益低，产品答案就是系统应用。Session scope 下附件没有宿主路径，故不显示前两项，下载始终可用。
- 渲染/源码切换现在是注册表事实（`hasSourceToggle`），两个 scope 的工具栏共读；哪些 viewer 需要解码文本是 `needsTextContent`，由 session 加载器直接读取，而不是自己维护一份排除名单。新增一种 viewer 只需在 `viewerRegistry.ts` 加一个分支，别处没有会被忘记更新的名单。
- 顺带移除 `src/lib/shared/filePreview.ts` 中已无引用的 `isRenderableTextName`（该判断已归注册表所有）。
- 机器防护：`viewerRegistry.test.ts` 覆盖分发、`needsTextContent` / `hasSourceToggle`、空 MIME 兜底；`jsonTree.test.ts` 覆盖扁平化、按路径前缀折叠（折叠 `/a` 不得连带隐藏兄弟节点 `/ab`）、两种失败与 UTF-8 上限；`mermaidBlocks.test.ts` 覆盖围栏解析（未闭合、更长围栏、波浪号围栏）；`chat-ui.test.mjs` 新增：每个 viewer 在**两个 scope** 都可达（这条断言专门拦「只接了 Project 分支」）、系统卡片动作且下载不可选、切换开关单一来源、mermaid 懒加载 + strict + 代次防护、不存在第二条 markdown 链路、SVG 永不 `{@html}`、新增文案双语齐全。
- 验证：桌面 UI 测试 157/157 + 单元测试 142/142 + Rust 52/52，`test:projects` 58/58，`svelte-check` 0 error / 0 warning，服务端与桌面 `vite build` 均通过。**未做：冷启动 smoke walk**（pitfall 10）——它需要打包后的 Tauri 窗口，当前环境无法驱动；HTML 预览与小程序 tab 尤其依赖只在该环境存在的自定义协议。
