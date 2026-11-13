# Molibot 设计规范

本文定义 Molibot 所有界面共同遵守的视觉与交互核心约定，并提供专项设计指南与实现入口。本文解释“**什么时候使用什么**”；具体色值、像素尺寸与动画曲线由样式与主题 token 维护，不在多处手写同步。

## 1. 产品视觉方向与品质标准

- **品质标准**：目标是达到 **Awwwards、Webby Awards、FWA** 能获奖的品质水准。通过自我检查、反复迭代提升视觉与交互品质，直到真正达到该标准为止——这是用户能自豪展示的真实产品，绝非演示或粗糙原型。
- **安静、紧凑、突出内容**：以系统字体、留白、间距和对齐建立信息层级。主任务与核心结果周围留出充裕空间，辅助记录使用紧凑平面行与发丝分隔线，不把普通列表堆成卡片墙。
- **视觉重心收敛**：设置页、导航栏、日志与右侧检查器（Inspector）保持安静克制；适度的视觉表现集中在新对话欢迎页、执行过程披露与产出物展示。
- **语义表面优先于阴影**：优先通过表面明暗阶梯表达层级（窗口与侧栏共享同一底层平面，设置分组与主内容卡片抬升一阶）。阴影仅用于浮层（Popover、Dialog）与少量焦点容器（如浮动输入区）。纹理与光泽只用于有意义的图像展示，不用于日常控件或工作区背景。

## 2. 适用范围

| 界面范围 | 适用规则 |
|---|---|
| **Desktop (`apps/desktop/`)** | 完整遵循本规范及下方桌面专项指南，包括 Tauri 原生侧栏材质、全局唯一窗口顶栏、窗口拖拽遮罩与多列流式工作区。 |
| **Web (`src/routes/`)** | 复用相同的语义表面层级、排版阶梯、共享表单与开关组件（`IosSwitch`）、固定保存底栏、四态反馈与无障碍规则；不适用 Tauri 原生窗口材质与标题栏控制簇。 |
| **内嵌页面（Iframe / 小程序）** | 同源或受控 HTML 报表（如 Call Trace）使用应用语义 token 并自带 fallback（如 `var(--card-bg, #fff)`），由宿主注入实时计算值并随主题更新，不在服务端复制色板；独立 origin 的 Mini App 通过 URL 参数接收 `locale` 与 `theme` 提示，自行维护明暗样式与非纯色状态表达。 |

## 3. 视觉基础

- **字体层级**：
  - 优先使用 macOS 系统 UI 字体栈（`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `PingFang SC`）；大标题可用 display 栈；ID、路径、代码、表格数据与原始 cron 表达式使用等宽字体（Mono）。
  - 字号与行高必须**成对**使用 `--fs-*` / `--lh-*` token（例如聊天区的正文 `body`、界面标签 `label`、辅助元信息 `meta` 三档，弹窗的 `page` / `section` / `body-lg`），禁止单独手写 `font-size` 或省略行高（`pitfall #24`）。
  - 图标尺寸独立使用 `--icon-xs` / `sm` / `md` / `lg`，不混用文字字号 token。页面与容器根节点必须锚定明确字号档位，不依赖浏览器默认 `16px`。
- **文档排版轴（AI 回复 Markdown）**：
  - `.markdown-body` 使用独立的 `--md-fs-*` / `--md-lh-*` 成对 token（正文 15/25、h1 24/34、h2 20/28、代码 14/22、图注 12/18），仅比界面 UI 正文 14/22 高一档，避免在聊天时间线里显得过大；与界面 UI 的 `--fs-*` 阶梯分离；飞书文档式阅读节奏是**全局默认**，`themes/feishu.css` 只贡献配色语义，不做主题专属排版。数值参照高使用量的 `imageslr/mweb-themes` `lark` 主题校准，只复制样式思路、不引入依赖包。
  - 只消费标准 Markdown / GFM：图片标题用 `![alt](src "title")` 渲染为 `<figure>` / `<figcaption>`，任务列表用 `- [ ]` / `- [x]`；禁止引入自定义块语法或 directive。
  - Web 端由 `src/styles/markdown.css` 镜像同一组数值（颜色改用 Web 语义 token）并经 `src/app.css` 全局引入；主聊天、流式回答、Markdown 文件预览与会话历史预览共用一份，禁止在页面 `<style>` 里再写 `:global(.markdown-body ...)` 副本。
  - 语音附件一律走共享 `AudioPlayer`（Desktop `lib/components/AudioPlayer.svelte`、Web `components/ui/audio-player`），宿主容器只负责卡片表面，不再使用原生 `<audio controls>`。
  - **两套可切换的文档皮肤**通过 `:root[data-doc-style="feishu|notion"]` 表达，与 `data-theme-family` 正交：主题族管颜色与表面，文档皮肤管 Markdown 的阅读节奏。默认飞书；Notion 只在同一份 `--md-*` 轴上覆盖差异（标题 600 字重/负字距、h1 无分隔线、链接继承色+下划线、引用 3px 实色边框、表格无外框、行内代码红字），数值参照 Notion 官方导出页面的 CSS 缩放到 15px 正文基准。**渲染器不感知皮肤**：两套共用同一个 `renderMarkdown()` 输出、同一份缓存与流式骨架，禁止为皮肤分叉解析或复制第二份 `.markdown-body`。Desktop 由 `App.svelte` 持久化 `molibot-desktop-doc-style` 并写入根节点，Web 由 `app.html` 首屏前初始化、`+layout.svelte` 跨标签同步。
- **数字排版**：
  - 变化计数、耗时、文件大小与表格列默认使用等宽表格数字（`tabular-nums`）；`time`、`input`、`select`、`td`、`th` 需显式声明以防 `font:` 简写重置。
  - Markdown 渲染正文（`.markdown-body`）恢复比例数字（其内部表格仍为表格数字）；散落在正文中需对齐的计数器显式添加 `.tnum`。
  - 聊天输入区（composer）因与语法高亮叠层（token overlay）逐字符镜像对齐，始终保持表格数字。由 `apps/desktop/src/numeric-typography.test.mjs` 守卫。
- **尺寸、间距与圆角刻度**：
  - 设置表单控件（文本、数值、下拉）使用共享紧凑高度 token（`--control-h`）；操作按钮与独立搜索框使用按钮高度 token（`--control-h-button`）；密集列表与表格分页操作使用紧凑高度 token（`--control-h-compact`）。
  - 圆角按紧凑控件、常规控件/小卡片、主卡片/Inspector、状态点/头像/分段胶囊四档语义使用，不自造中间圆角；间距遵循 4px 倍数刻度。
- **表面层级与语义颜色**：
  - 普通界面统一消费语义 token：表面（`--window-bg`、`--sidebar-bg`、`--content-bg`、`--header-bg`、`--card-bg`、`--surface-secondary`）、文本（`--label-primary` / `secondary` / `tertiary`）、分隔线（`--separator`、`--chrome-border`）、填充（`--fill`）与功能色（`--accent`、`--online`、`--warning`、`--danger`）。
  - **暗色结构表面禁令**：桌面结构表面严禁使用纯黑 `#000000` 或近黑 `#0A0A0A`（仅 `System 6` 1-bit 主题及确需纯黑的媒体/代码内容区例外）。
  - **选中与激活分离**：「当前打开的标签页/视图」使用 `--accent`（激活标签页的计数徽标可借用选中色对以保证浅色强调色下的对比度）；「列表中被用户选中的条目或卡片」使用 `--selection-bg` / `--on-selection`，悬停态必须排除已选中项（`:not(.selected)` / `:not(.active)`）。
  - **状态浅底**：统一通过 `color-mix(in srgb, var(--danger) 14%, transparent)` 等语义混合生成，禁止写死亮色 hex；不得将分隔线颜色当作文本色使用。
- **图标体系**：
  - `reicon-svelte` 统一使用子路径导入（`pitfall #45`）。20px 及以上展示位（空状态、欢迎页）与聊天主框架（侧栏导航、顶栏、输入区控件、分区头）使用由 `scripts/generate-duotone-icons.mjs` 生成的 duotone 图标（严禁手改生成文件）；特定主入口与搜索槽位按审定清单使用 Filled 或 Outline（详见 [视觉基础与主题指南](docs/guides/ui/desktop-foundations.md)）。
  - 状态指示、旋转加载、工具类型、勾选/关闭及搜索清除按钮（`XCircle`）统一保持线性 Outline。双色图标通过 `currentColor` 与内置次级透明度自动适配主题，不逐层拆改颜色。

## 4. 组件复用

- **共享组件优先**：
  - 优先复用 shadcn-svelte / Bits UI 原语与共享语义组件：`PageHeader`、`SettingGroup`、`SettingRow`、`SelectControl`、`Button`、`Dialog`、`AlertDialog`、`Popover`、菜单、空状态、`AppFooterMark`、`ConversationRow`、`AgentConversationRow`、`ChatHeader`、`ChatInputArea`、`ConversationTranscript`、共享代码（`CodeViewer`）/ Mermaid / D2 渲染器。
  - 禁止在页面内复制私有控件副本，禁止在通用共享组件中写入特定项目或渠道的分支逻辑（差异由调用方通过 props / adapter 注入，`pitfall #7`）。
- **表单与选择器约定**：
  - **开关**：所有布尔开关统一使用 `IosSwitch`（`$lib/components/ui/ios-switch`），禁用普通 `Switch` 或常驻描边按钮代替开关。
  - **枚举选择**：桌面端枚举字段统一使用基于 Bits UI 的 `SelectControl`（禁止渲染原生 `<select>`），由组件统一维护触发器高度、宽度上下限（`--select-min-w` / `--select-max-w`）、弹出菜单尺寸、内部滚动與键盘导航。
  - **数值与时间**：时间输入保留原生 `input[type="time"]`（整框触发系统时间选择器）；紧凑数值设置框保持固定宽度、不随 flex 收缩，预留六位数与原生步进器空间。
- **样式与第三方组件边界**：
  - 页面样式写入共享语义 CSS 并消费主题 token；设置页与工作区不新增零散 `<style>`、裸 Tailwind 工具类链或硬编码颜色。
  - 共享默认规则（如 `desktop-dialog-*` 默认尺寸）使用 `:where()` 零特异性声明（`pitfall #51`），确保调用方传入的变体类可直接覆盖。
  - 第三方组件（如 `diff2html`）必须通过重映射其自身 CSS 变量集（覆盖其全部明暗类名）来适配主题，并在真实渲染 DOM 下验证（`pitfall #17`）。

## 5. 通用布局模式

- **全局窗口与唯一顶栏**：
  - 桌面端最小支持窗口为 `860×620`。整窗仅有一条顶部全局标题栏（42px），横跨侧栏与主内容列：左侧固定预留原生窗口红绿灯（84px）与窗口级控制簇（侧栏折叠切换、搜索/新对话），右侧由当前页面通过 `ChatHeader` 发布标题、来源标签与操作按钮；下方内容框不再渲染第二条标题栏。
  - 展开态顶栏通过 CSS `subgrid` 继承侧栏与主内容列轨道；标题区自适应截断（`flex: 1 1 auto; min-width: 0`），操作按钮保持固有宽度，绝不重叠。
  - 顶栏空白区域与被动标题文本透传给原生窗口拖拽遮罩（`.window-drag-mask`）；抬升在遮罩之上的操作容器须设 `pointer-events: none` 并仅在子按钮恢复 `pointer-events: auto`（`pitfall #18`）。
- **侧栏与树形导航**：
  - Chat 与 Settings 共用 `228px` 侧栏宽度基准与底部 `AppFooterMark`。Chat 侧栏折叠后保留 `48px` 图标栏；点击列表型入口（Agent、项目、Agent Team）在图标栏旁展开按需浮层并复用同一个 `SidebarLists` 组件。
  - 侧栏一级分组标题在同一滚动容器内共享吸顶槽位（带渐隐毛玻璃遮罩，禁用 `isolation`），二级内容统一使用 `.sidebar-tree-children` 缩进，不设分区限高或嵌套滚动。
- **阅读列与多列流式工作区**：
  - 设置页、数据页（用量、Trace、服务日志）、记忆中心与聊天时间线共用居中阅读列（上限 `720px`）；主功能工作区（自动任务、技能、计划、小程序、Agent）共用居中容器（`--workspace-col`）与顶部工具栏。
  - 主从工作区（左列 `300–320px` 列表 → 右侧弹性详情）与聊天右侧 Inspector（文件与小程序共用同一槽位，同时最多打开一个）均保持在**文档流网格**内，面板与主列声明 `minmax` 宽度下限。
  - **分栏铁律**：任何宽度受兄弟面板影响的列内严禁使用 `vw` / `vh` 计算尺寸或边距（改用相对容器的 `%` 与 flex 截断）；窄窗时按保底顺序收缩或切换为流内单列并提供返回入口，严禁将侧边面板改为遮挡正文或破坏拖拽层级的 `position: fixed`（`pitfall #16`）。
- **设置页与固定保存栏**：
  - 设置左栏按“配置对象”单一轴线分为通用、模型、助手、能力、数据与历史、安全与权限、系统七组；窄窗（`≤ 600px`）左栏收窄、设置行控件自动纵向堆叠。
  - 凡有保存操作的设置页均使用底部固定 `.settings-footbar`，正文独立滚动；单 Agent、房间等二级编辑页保留应用主侧栏，内部采用顶部横向可滚动分类导航。
- **弹窗、浮层与滚动链路**：
  - 模态框保持外壳、标题与底栏稳定固定，仅中间 `.modal-body` 纵向滚动。从 `overflow: hidden` 对话框到 `.modal-body` 的**每一个祖先节点**都必须设置 `display: flex; flex-direction: column; min-height: 0`（WebKit 下滚动容器使用 flex 列而非 grid，对话框设置明确高度预算，`pitfall #16c`）。
  - 禁止在内容自适应宽度的 flex 子项上设置 `container-type: inline-size`（会导致宽度塌缩为 0）。
  - 侧栏行菜单与列表内触发的编辑弹窗必须显式 Portal 到 `body`（`pitfall #69`）。需要精细阅读的放大内容（图片、HTML/CSV Artifact、Mermaid/D2 图表）打开近全屏 Lightbox。
- **聊天时间线与浮动输入区**：
  - 时间线（`.messages`）只允许纵向滚动，并预留对称滚动条槽位（`scrollbar-gutter: stable both-edges`）以与底部输入区严格对齐；长路径、链接与行内代码在列内折行，代码块、表格、公式、图表与 diff 各自维护 `max-width: 100%` 的局部横向滚动（`pitfall #38`），整条链路保持 `min-width: 0`，撑满列的非用户消息行保持 `width: 100%`。
  - 聊天顶栏与底部浮动输入区（`.composer-wrap.is-floating`）悬浮于时间线之上，时间线通过实时测量的 `--chat-header-h` 与 `--composer-h` 预留内边距。输入区行内胶囊叠层（`/skill`、`@miniapp`、`@[file](path)`）仅绘制背景与内阴影，水平内边距须由等量负外边距抵消，严禁改变字符字宽（advance）以免漂移或错位中文输入法候选窗（`pitfall #24e`）。

## 6. 通用交互规则

- **键盘、焦点与操作分层**：
  - 所有交互元素必须支持键盘操作并在 `:focus-visible` 显示清晰焦点环；纯图标按钮必须提供可访问名称（`aria-label`）与双语悬浮提示。
  - 主操作直接可见；低频或破坏性操作放入更多菜单，不可逆操作须经 `AlertDialog` 确认并写明后果。弹窗取消或按 `Escape` 关闭后，焦点必须归还给触发入口。聊天列底部边缘的更多菜单向上展开，避免遮挡输入区。
- **四态反馈与异步竞态守卫**：
  - 加载中、空记录、搜索/筛选无匹配、错误必须分别给出明确反馈（空状态指向下一步动作；错误说明原因并提供原地重试或外部打开降级）。
  - 异步刷新或切换预检时保留当前可见内容与布局骨架，锁定重复提交；列表、详情与预检请求必须携带序号（generation）与归属 ID，只允许最后一次有效请求更新共享视图，交互动作直接消费自身请求返回值（`pitfall #3`）。
- **用户控制权与草稿保留**：
  - 用户的会话选中项、折叠面板展开态（如对话「查看过程」）、搜索筛选条件和阅读滚动位置由用户掌控，流式增量或后台刷新不得重置。
  - 跨会话输入草稿（文本、附件、思考深度、权限模式）通过单一响应式镜像自动保存与恢复（`pitfall #47`）；设置页切换内部分类保留未保存草稿，切换或关闭未保存草稿须明确处理。
- **真实状态与面向人的文案**：
  - 只展示真实运行与持久化回执状态：不凭模型文本宣称文件已修改（`pitfall #20`），不从耗时或调用次数推算进度百分比，不把未提交 final 的过程文本当成最终回答（`pitfall #57`），也不把中间重试失败标为整轮失败。
  - 每轮回答仅有一个统一可折叠过程区（入口统一为「查看过程」，默认收起，内部按真实时间线展示思考、进度与工具调用）和一个独立最终结果区；待审批请求、待决定计划与需人工处理的失败直接外露在过程区之外。
  - 文案以用户任务为先，时间与状态使用本地化格式；原始模型 key、协议、trace ID、完整服务端路径与 cron 表达式作为次级详情展示。

## 7. 主题与无障碍

- **明暗与主题族正交**：
  - 根节点分别维护用户偏好 `data-appearance`、实际生效亮度 `data-resolved-appearance`（`light` | `dark`）、主题族 `data-theme-family` 与组件语法配方 `data-theme-recipe`（`pitfall #4`）。
  - **一切依赖明暗的样式规则必须挂在 `data-resolved-appearance` 上**。显式切换明暗同步更新 WebView token 与原生 Tauri 窗口外观。
  - 主题族文件（`apps/desktop/src/themes/<family>.css`）只声明语义 token、预览色块及受控的 `data-theme-region` 区域外观修饰（仅限改变背景/边框/圆角/阴影，严禁改变布局或给全局 `header` 单独上色）。VSCode 导入主题作为单变体、纯色彩产品层运行，侧栏与输入区使用不透明表面，文本自动保底 WCAG AA 对比度（`4.5:1`）。
- **毛玻璃材质与强制无障碍降级**：
  - 聊天瞬态表面与浮动顶栏/输入区使用共享毛玻璃 token（背景半透明与 `backdrop-filter` 必须成对出现）；凡包含子弹出层的宿主容器（输入区、顶栏、侧栏）必须将毛玻璃绘制在 `z-index: -1` 的 `::before` 伪元素上（宿主设 `z-index: 0`，严禁设 `isolation: isolate` 或置于半透明/滤镜祖先内），防止宿主成为 backdrop root 导致子菜单模糊失效。禁止在材质层使用 SVG 位移滤镜（`pitfall #48`）。
  - 在减少透明度（`data-reduced-transparency`）、增加对比度（`prefers-contrast: more`）与低性能模式（`data-performance="low"`）下，所有毛玻璃与侧栏半透明层必须**同时移除模糊并将背景切换为不透明语义表面**，严禁只去掉模糊而留下半透明底色。
- **双语与非纯色状态**：
  - 所有界面文案支持中文/英文即时切换（集中维护在 `apps/desktop/src/lib/i18n.ts`），布局需容纳中英文长度差异与自然换行，中文标题不使用负字距。
  - 状态绝不仅靠颜色表达，必须同时配以文字标签、状态点或不同形状的图标；红色仅用于终态失败或破坏性操作。

## 8. 动效原则

- **用途与即时路径**：动效仅用于解释结构变化或状态转换（`< 300ms`），绝不作装饰。直接输入、高频悬停、键盘列表导航、实时筛选与流式文本输出必须在同一帧立即响应（`0ms`）。有疑问时不加动画。
- **共享 Token 与属性白名单**：
  - 统一使用 `apps/desktop/src/styles.css` 中的时长（`--duration-instant: 100ms` 微交互、`--duration-fast: 160ms` 菜单/状态、`--duration-normal: 240ms` 页面/面板/弹窗、`--duration-panel: 300ms` 侧边 Inspector）与缓动 token（`--ease-standard`、`--ease-spring`），禁止手写 120ms/150ms 等一次性数值。
  - **只允许动画 `opacity` 与 `transform`**（唯一例外：毛玻璃表面入场可伴随 `filter: blur(6px) -> blur(0)`，且结束帧严禁保留 `forwards` 滤镜）；严禁动画 `width`、`height` 或网格轨道。
- **连续性与无障碍降级**：
  - 时间线底部跟随采用可随时被用户上滚打断的 rAF 弹簧滚动（`stickToBottom.ts`）；流式回复切换为持久化消息时同帧重绑 key 并抑制入场淡入（`settleEntrances.ts`），避免回答闪烁重播。
  - 每个新增动画必须在同一改动中加入 `prefers-reduced-motion: reduce` 与 `data-performance="low"` 降级规则；表示持续运行态的循环动效（`RunningOrb`、思维波浪、`BeamRing`）在降级模式下定格为静态代表帧。

## 9. 实现入口与专项导航

- **样式与 Token 定义**：`apps/desktop/src/styles.css`（核心 token、基础与聊天/设置样式）、`apps/desktop/src/workspaces.css`（工作区样式）、`src/app.css`（Web 样式）
- **主题族与导入实现**：`apps/desktop/src/themes/<family>.css`、`apps/desktop/src/themes/index.css`、`apps/desktop/src/lib/theme/vscodeTheme.ts`
- **共享组件与国际化**：`src/lib/components/ui/`、`apps/desktop/src/lib/components/`、`apps/desktop/src/lib/chat/`、`apps/desktop/src/lib/settings/`、`apps/desktop/src/lib/i18n.ts`

| 修改对象 | 必读专项文档 |
|---|---|
| 字体细节、毛玻璃材质层级、主题族/配方、macOS 语义色表、VSCode 主题导入 | [桌面视觉基础与主题指南](docs/guides/ui/desktop-foundations.md) · [macOS 暗色语义参考](design.dark.md) |
| 窗口顶栏、侧栏、设置页、数据页、Inspector、聊天时间线、组件与动效实现 | [桌面布局、组件与动效实现指南](docs/guides/ui/desktop-patterns.md) |
| Personal Agent 首页/交接、设置分类、四大工作区（自动任务/技能/计划/小程序）等页面规格 | [桌面页面与工作区交互规格](docs/guides/ui/desktop-pages.md) |
| 具体功能业务规则（Agent 与记忆、Agent 房间、Skill 维护） | [Personal Agent 与记忆](docs/features/personal-agent-and-memory.md) · [Agent 房间指南](docs/guides/agent-rooms.md) · [Skill 维护](docs/features/skill-maintenance.md) |
| 历史 Geist 10 阶色板与文案参考（不作为当前组件尺寸或暗色规范） | [Geist 原始参考](docs/reference/geist-design-reference.md) |

## 10. 维护边界

- **何时更新本文**：只有改变**跨页面共用的视觉或交互约定**，才更新 `DESIGN.md`。
- **专项与功能归属**：主题与材质细节更新 [桌面视觉基础与主题指南](docs/guides/ui/desktop-foundations.md)；共享布局与动效实现更新 [桌面布局、组件与动效实现指南](docs/guides/ui/desktop-patterns.md)；单页面功能变化更新 [桌面页面与工作区交互规格](docs/guides/ui/desktop-pages.md) 或所属功能/设计文档；API、保存与并发实现细节更新代码与测试；事故复盘更新 [Pitfalls](docs/pitfalls.md)；交付日期与记录更新 `features.md`。
- **单点维护与事实核对**：重复规则只引用、不再复制；通用要求（中英、明暗、窄窗、共享 token）已在本文统一声明，局部文档只写例外。精确值以样式中的 token 定义为准；当实现与设计规范不一致时，必须明确报告差异并核实产品预期，不得默认现有代码一定正确。
