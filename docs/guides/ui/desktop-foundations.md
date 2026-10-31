# 桌面视觉基础与主题指南

修改字体、图标字重、毛玻璃材质、语义颜色、主题族/视觉配方或 VSCode 主题导入时读取。通用视觉与无障碍原则见 [DESIGN.md](../../../DESIGN.md)。

## 1. 字体、数字、尺度与图标 (Foundations)

- **字体栈**：优先使用 macOS 系统 UI 栈（`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `PingFang SC`）；大标题使用 display 栈；ID、路径、代码与原始调度表达式使用等宽栈（Mono）。
- **表格数字 (Tabular Numerals)**：数据数字默认使用等宽表格数字（在 `styles.css` 的 `body` 统一声明），使计数、耗时、文件大小与表格列在数值变化时不发生宽度抖动。因具体 `font:` 简写会重置 `font-variant-numeric`，`time`、`input`、`select`、`td`、`th` 需显式重申。Markdown 正文（`.markdown-body`）切回比例数字（其内部表格仍用表格数字）；通过 `font:` 简写设置的计数器用 `.tnum` 显式开启表格数字。聊天输入区（composer）因 token 叠层需与 `<textarea>` 逐字镜像对齐，始终保持表格数字。由 `apps/desktop/src/numeric-typography.test.mjs` 守卫，仅真实正文容器可扩展其白名单。
- **圆角与高度刻度**：标准圆角分为紧凑控件 `6px`、常规控件与小卡片 `8px`、主卡片与 Inspector `12px`，以及状态点、头像与分段胶囊的完全圆角（`9999px`），不发明中间值。标准控件高度使用统一 token：设置表单控件与下拉 `--control-h: 28px`、按钮与搜索框 `--control-h-button: 32px`、密集列表/表格操作 `--control-h-compact: 24px`。桌面顶栏/拖拽区高度基准与 720px 居中阅读列定义见 `styles.css`。
- **双色与线性图标体系 (Reicon Hybrid System)**：
  - 20px 及以上装饰性展示位（空状态、欢迎面板、面板级空文件列表）与桌面聊天主框架图标（侧栏导航、顶栏与输入区控件、行操作、分区标题、搜索栏、面板工具栏）使用 **duotone** 字重。展示位通过 `DuotoneIcon` 渲染；聊天主框架直接导入由 `scripts/generate-duotone-icons.mjs` 生成的图标组件（`apps/desktop/src/lib/icons/duotone/components/`）。新增双色图标必须扩展脚本清单并重新生成，严禁手改生成模块。无官方 duotone 的图标回退到同概念 Outline，或按清单显式映射同概念官方 duotone（如 `Timer` → `stopwatch-duotone`、`Grid` → `squares-duotone`）。
  - **审定专有槽位**：技能 → `ruler-pen-duotone`，Agent → `users2-duotone`，Agent Team（分区头与折叠栏）→ `dialog-duotone`，发送 → `plane2-duotone`，计划模式 → `circle-arrows-down-duotone`，手动模式 → `handshake-duotone`，全部小程序入口 → `list-duotone`，Agent 顶栏设置 → `Tuning3` duotone；主导航 Filled 例外：项目 → Filled `Package`、自动任务 → Filled `SendClock`、计划 → Filled `Bulb2`、设置入口（侧栏底栏与项目顶栏）→ Filled `Settings2`、Agent 顶栏文件与附件 → Filled `Library`；搜索与新建会话 Outline 例外：全局会话搜索 → Outline `Search4`、会话内搜索 → Outline `MessageSearch`、新建会话行操作 → Outline `ChatPlus`；设置侧栏底栏返回默认 Agent 首页使用 duotone `Users2`。
  - **保持线性 Outline 的场景**：旋转加载、完成/失败/警告状态标记、已读回执、工具活动类型图标、基础 `Check` / `X` / `Plus` / `Minus` / 箭头，以及跨聊天与设置保持一致的搜索清除 `XCircle`。
  - **着色规则**：duotone 图层使用 `currentColor` 与内置 50% 次级透明度，随主题与亮度自动继承颜色，严禁单独覆写子图层颜色。

## 2. 毛玻璃材质系统 (Glass Materials)

### 2.1 原生侧栏材质 (Native Sidebar Material)

- Chat 与 Settings 窗口透明并启用 Tauri 原生 `sidebar` 窗口特效（`macOSPrivateApi: true`），WebView 根容器透明、右侧内容区保持不透明。
- 侧栏平面在原生材质之上叠加各主题族/变体的半透明底色（`--sidebar-material-tint`）与 `--sidebar-material-filter: blur(18px) saturate(160%)`（macOS Light 为 `rgb(253 255 255 / 62%)`，macOS Dark 在浅色系统下为 `rgb(30 30 30 / 68%)`；当系统本身处于暗色模式时，媒体查询将暗色变体的 tint 设为 `transparent`，直接由原生暗色材质提供深度）。
- 侧栏紧贴窗口边缘，不加外边距、圆角、阴影或悬浮发光；Settings 在材质层保留 1px `--separator` 右边框，Chat 则以浮动内容框边缘自然分界。
- 侧栏材质必须绘制在 `.chat-sidebar::before` / `.settings-sidebar::before`（`z-index: -1`，宿主 `z-index: 0; background: transparent`），禁止直接写在侧栏元素上。侧栏一级吸顶标题仅使用 `blur(14px)` 渐隐伪元素遮罩且不涂实色底、不设 `isolation`。

### 2.2 聊天瞬态表面与浮动框架 (Chat Glass & Floating Chrome)

- **核心 Token**：`--glass-surface-bg`（大表面 66% 密度）与 `--glass-popover-bg`（小字号菜单/胶囊 72% 密度，均基于 `--card-bg` 向透明混合）、`--glass-surface-filter`（32px 模糊）/ `--glass-popover-filter`（28px 模糊）/ `--glass-chrome-filter`（40px 模糊）、`--glass-edge`（基于 `--glass-border-light` 的顶部高光内边）、`--glass-surface-shadow`（浮层阴影）与 `--glass-chip-shadow`（轻阴影，在 `:root[data-resolved-appearance="dark"]` 下统一加深）。半透明背景与 `backdrop-filter` 必须成对使用；模糊与不透明度上下限（65%–92%）由测试守卫。
- **适用边界**：审批/决定卡、计划卡、进行中思考卡、回合文件卡、运行中状态胶囊、浮动顶栏与输入区（及其上方堆叠条）、聊天弹出菜单（斜杠建议、模型/权限/上下文用量菜单、更多菜单、文件菜单、行菜单、命令面板、小程序快捷菜单、提问预览）及时间线底部跳转胶囊使用毛玻璃；已完成的思考折叠区（`.turn-process`）保持无边框透明，静态消息正文、气泡、侧栏与设置页保持不透明。严禁在毛玻璃表面上直接堆叠第二层毛玻璃。
- **弹窗遮罩与全屏检视**：所有弹窗共享 `desktop-dialog-overlay`（`--modal-scrim` + `--glass-modal-filter`），背景微模糊而弹窗面板保持不透明（默认尺寸使用 `:where()` 零特异性声明）。图片、HTML/CSV Artifact 与 Mermaid/D2 图表放大检视统一铺满深色遮罩视口（近全屏 Lightbox）。
- **禁用折射位移**：禁止在材质层使用 `filter` 或在 `backdrop-filter` 中引用 SVG `feDisplacementMap`（详见 [Pitfalls #48](../../pitfalls.md)）。
- **宿主防 Backdrop Root 铁律**：凡包含子弹出层的宿主（如输入区、顶栏、侧栏）严禁在宿主元素自身设置 `backdrop-filter`、`isolation: isolate`、`< 1` 的 `opacity`、`filter` 或 `mask`；必须将背景、模糊与阴影统一放在 `z-index: -1`、`inset: -1px` 并继承圆角的 `::before` 伪元素上，宿主自身保持 `z-index: 0; background: transparent`，确保子菜单能正常模糊底层时间线。
- **浮动顶栏与输入区布局**：`.chat-header` 与 `.composer-wrap.is-floating` 在 `.chat-content` 内脱离文档流浮动，分别通过 `--glass-chrome-opacity` 混合 `--chrome-header-bg` 与 `--composer-bg`（保留非激活窗口外观投影）。时间线通过实时测量的 `--chat-header-h` 与 `--composer-h` 预留内边距与底部浮件偏移。在非浮动的 `ProjectChat` 中，输入区上方的堆叠条保持实色表面。
- **入场与强制无障碍降级**：毛玻璃入场允许 `opacity` + `transform` 伴随 `filter: blur(6px) -> blur(0)`（结束帧不留 `forwards`），退场瞬时完成。在 `data-reduced-transparency="true"`、`data-performance="low"` 与 `prefers-contrast: more` 下，必须同时移除模糊并将 `--glass-surface-bg` 设为 `var(--card-bg)`、`--glass-chrome-opacity` 设为 `100%`、侧栏切换为 `--chrome-sidebar-bg`。

## 3. macOS 语义角色与主题体系 (Themes & Recipes)

### 3.1 亮度、主题族与视觉配方正交

DOM 根节点独立维护 `data-appearance`（用户偏好 `light`/`dark`/`system`）、`data-resolved-appearance`（实际解析出的 `light`/`dark`）、`data-theme-family`（主题族）与 `data-theme-recipe`（组件语法配方）。所有明暗规则以 `data-resolved-appearance` 为准；切换亮度同步更新 WebView token 与原生 Tauri 窗口外观。

- **产品主题族 (Product families)**：`Minimal (macOS)`（默认，无区域修饰）、`Rosé Pine`、`Catppuccin`、`Midnight`、`iOS`、`Office`、`WPS`、`WhatsApp`、`WeChat`、`Telegram`、`Facebook`、`Feishu`。共享 macOS 控件几何尺度。
- **鲜明主题族 (Bold families)**：`Windows 98`、`Terminal`、`Brutalism`、`Raft`、`Blueprint`、`System 6`、`Cyberpunk`、`Android`、`Discord`、`QQ`、`Candy`、`Cartoon`、`Google`。可通过 token 重定义字体栈、圆角、阴影高程与不透明材质（不透明鲜明主题在 `.composer::before` 上通过 `inset 0 0 0 1px var(--control-border-strong)` 绘制边框）。
- **主题视觉配方 (`data-theme-recipe`)**：将可复用的组件形态（气泡几何、状态层、控件形状、选中语言）与调色板解耦，但不改变侧栏/聊天/Inspector 的产品布局与字号体系：
  - `material`（Android、Google）：色调状态层、大圆角控件、填充气泡与 Material 输入区。
  - `messenger`（QQ、WeChat、Telegram、WhatsApp、Facebook、Discord、Feishu）：紧凑非对称聊天框、聊天壁纸与 IM 风格输入区。
  - `retro`（Windows 98、System 6、Terminal）：硬边、显式边框、物理按钮态与无毛玻璃表面。
  - 其余预置配方标识包括 `native`、`editorial`、`technical`、`product`、`expressive`。

### 3.2 区域修饰钩子 (Region Adaptation)

主题族文件（`apps/desktop/src/themes/<family>.css`，由 `themes/index.css` 汇总导入）除声明明暗 token 块、预览色块与 Windows 98 专属斜角（`--win98-bevel-*`）外，仅允许通过以下固定 `data-theme-region` 钩子修饰既有区域外观：

| Hook | 对应元素 | 区域说明 |
|---|---|---|
| `window` | `.chat-layout` | 整窗容器 |
| `header` | `.chat-header` | 全局窗口顶栏（仅限修饰内部按钮色，严禁给顶栏元素自身加背景、底边框或阴影） |
| `sidebar` | `.chat-sidebar` | 左侧导航列 |
| `session-list` | `.sidebar-channels` | 会话与项目树（行与分区头静息态保持透明，仅 `:hover` / `.active` 可上色） |
| `chat` | `.chat-content` | 聊天时间线画布 |
| `composer` | `.composer-wrap` | 底部输入区 |
| `file-panel` | `.file-panel` | 右侧 Inspector |

区域规则严禁修改 `display`、网格/弹性轨道、`position` 或尺寸布局，由 `chat-ui.test.mjs` 自动守卫。

### 3.3 颜色表与气泡/选中语义

macOS 默认主题明暗参考值（采样自 AppKit sRGB 语义色；暗色详细说明见 [design.dark.md](../../../design.dark.md)）：

| 产品角色 | AppKit 参考 | macOS Light | macOS Dark |
|---|---|---|---|
| 窗口/工作区 + 侧栏基底 | System Settings 统一画布 | `#F6F6F6` | `#1E1E1E` |
| 分组画布 | 次级安静表面 | `#ECECEC` | `#282828` |
| 原生侧栏遮罩 | Finder 材质面纱 | `rgb(253 255 255 / 62%)` | `rgb(30 30 30 / 68%)` |
| 抬升卡片/控件表面 | `controlBackgroundColor` | `#FFFFFF` | `#2C2C2E` |
| 嵌套次级表面 | 内凹中性内容 | `#F5F5F5` | `#343436` |
| 一 / 二 / 三级文本 | `labelColor` 系列 | 黑 `84.7%` / `49.8%` / `25.9%` | 白 `84.7%` / `54.9%` / `24.7%` |
| 分隔线 / 非强调选中 | `separator` / `unemphasizedSelected` | 黑 `9.8%` / `#DCDCDC` | 白 `9.8%` / `#464646` |
| 强调色 / 成功 / 危险 / 警告 | 系统功能色 | `#007AFF` / `#34C759` / `#FF383C` / `#FF8D28` | `#007AFF` / `#30D158` / `#FF4245` / `#FF9230` |

各内置非 macOS 主题族配对变体：Rosé Pine（Dawn / Moon）、Catppuccin（Latte / Macchiato）、Midnight（Daybreak / Midnight）、Windows 98（Classic / Midnight）、Terminal（Paper / Phosphor）、Brutalism（Poster / Night）、Raft（Cream / Ink）、Blueprint（Vellum / Diazotype）、System 6（1-bit White / 1-bit Black，唯一允许使用 `#000000` 纯黑结构表面的例外）、Cyberpunk（Daylight / Midnight）、iOS、Office（White / Night）、WPS（Paper / Night）、WhatsApp、WeChat、Telegram、Android（Material Light / Dark）、Discord、QQ（Sky / Night）、Candy（Marshmallow / Dark Chocolate）、Cartoon（Daytime / Bedtime）、Facebook、Google、Feishu。

- **消息气泡**：用户发送气泡使用 `--bubble-mine-bg` / `-border` / `-text`；助手回复默认为纯文本排版，聊天应用类主题通过 `--bubble-assistant-bg` / `-border` / `-padding` / `-radius` 开启气泡，而工具与思考卡始终位于 `.message-bubble` 之外保持无框。
- **选中语义**：工作区卡片与列表选中项读取 `--selection-bg` / `--on-selection`（默认映射强调色对，Raft 映射为配对粉 `#fe7da8`；macOS 默认主题在聊天工作区内渲染为 `16%` 浅底加 `40%` 细边）；鲜明海报主题（Brutalism、Raft 等）将焦点强调色用于顶栏图标按钮与激活导航，并将侧栏与时间线画布分为相邻两阶高程。

### 3.4 导入主题 (Imported VSCode JSON Themes)

- 桌面端在运行时解析 VSCode 颜色主题 JSON（`colors` + `tokenColors`，存储在数据目录 `themes/<slug>.json`，不支持 `.vsix` / `.tmTheme`），通过 `lib/theme/vscodeTheme.ts` 的 `VARIANT_TOKENS` 映射生成 `:root[data-theme-family="imported-<id>"]` 规则。
- **单变体与不透明框架**：导入主题保持 macOS 几何尺度，但自带固定明暗属性（不受用户明暗开关覆盖，并驱动原生窗口外观）；侧栏、顶栏与输入区强制使用不透明表面（无模糊，`--glass-chrome-opacity: 100%`），保持 `--header-bg === --content-bg`。
- **对比度与角色映射**：文本对画布强制保底 WCAG AA（`ensureContrast`）；次级/三级文本与列表悬停/选中色直接取自主题对应语义键（如 `tab.inactiveForeground`、`comment`、`list.*Background`），不通过主文本向背景淡化生成；高光内边 `--glass-border-light` 保持固定白色透明度（浅色 60% / 暗色 18%）。
