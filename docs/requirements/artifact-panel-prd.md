# Artifact Panel PRD — 统一右侧工件面板与查看器体系

> Unified right-side Artifact Panel: one tab container + viewer registry for files, diffs, media, HTML preview, CSV/XLS tables, DOCX preview, and Mini Apps.
>
> - **Status**: Delivered 2026-08-06 (local-only PRD, no GitHub issue). Slices 0–3 complete; see `features.md` / `CHANGELOG.md` for the delivered scope and verification. **Three acceptance items remain open**: (a) the cold-start smoke walk (pitfall #10), which needs the packaged Tauri window; (b) insert-as-`@`-reference in Session scope — blocked on the Runtime, which validates `@[name](path)` against a registered Project root (§3.35) that an ordinary Session has no equivalent of, so this needs a Session-attachment reference model before any UI work; (c) User Story 12's follow-the-agent in ordinary sessions — the existing follow path is git/Project-based and inert in Session scope, and the product owner has deferred it (2026-08-06) pending a decision on whether ordinary sessions have a file-write event source at all.
> - **PRD index entry**: `prd.md` §3.38 (2026-08-05)
> - **Revision**: v1 (2026-08-05) — initial version from product-owner discussion. Priorities P0/P1/P2 all approved for implementation, in slice order.
> - **Revision v2** (2026-08-06, from using the shipped build): **files and Mini Apps must not share one tab strip.** Slice 0 made "Mini App is just another tab kind" a headline decision; in practice one strip listing `AGENTS.md` beside a running expense tracker made "go read a file" and "leave my app" read as the same gesture, and because the two were sibling `{#if}` branches, clicking a file destroyed every Mini App iframe — the app came back to its start screen with in-progress input gone. The panel now hosts **two surfaces** switched by a segmented control in its head, each with its own tab strip and its own selection; multiple Mini Apps remain open as tabs among themselves. Every open Mini App stays mounted and is hidden with `display: none`, never removed. What survives from Slice 0 is the part that was actually right: one panel, one inspector column, one width budget, one viewer registry — the mount seam is still single, only the tab model split.
> - **Delivery note** (2026-08-06): two rules were promoted out of the templates into the registry during implementation — `needsTextContent` (which viewers need decoded bytes, read by the session loader) and `hasSourceToggle` (which viewers offer a rendered/source toggle, read by both scope toolbars) — because each had started life as a hand-maintained list in a second place. Mermaid landed inside `MarkdownPreview` rather than as a standalone viewer; a standalone `.mmd` viewer remains unbuilt and unclaimed.
> - **Revision v3** (2026-08-09): JSON is now **source-first**. Opening a JSON tab renders the original text through `CodeViewer`; parsing is an explicit, user-triggered action. The tree parser is bounded by both the existing 1 MiB ceiling and a 5,000-row budget, and every parse failure falls back to the source view. This prevents a large or deeply nested JSON document from blocking the panel before its controls can be used.
> - **Revision v4** (2026-08-09): Project source-list rows keep the filename, status, and size on one line. Agent-touched files no longer add a separate dot that creates an implicit grid row; the filename uses the existing warning/attention color instead, matching Git's modified-file language.
> - **Revision v5** (2026-08-09): Project Changes rows expose per-file GitHub-style additions/deletions from `git diff HEAD --numstat -z`; binary and unavailable counts stay explicit. The diff2html gutter is anchored to the rendered diff surface so line numbers share the vertical scroll with code in both layouts.
> - **Revision v6** (2026-08-09): `.xls` / `.xlsx` is now a lazy `SpreadsheetTable` viewer in both Project and Session scopes. The viewer fetches bytes through the existing authorized transport, parses with the packaged SheetJS dependency, exposes sheet tabs with sticky headers and row numbers, caps the rendered DOM at 5,000 data rows per sheet, and leaves DOCX/PPTX/unknown binaries on the SystemOpen fallback.
> - **Revision v7** (2026-08-09): `.docx` and the Word MIME type now use a lazy `DocxPreview` viewer in both scopes. Mammoth converts the authorized bytes to Markdown, the existing sanitized Markdown renderer owns the final HTML surface, external file access and embedded image loads are disabled, and PPTX/unknown binaries remain on the SystemOpen fallback.
> - **Revision v8** (2026-08-09): `.pptx` and the PowerPoint MIME type now use a lazy `PptxPreview` viewer in both scopes. The MIT-licensed `@silurus/ooxml` Canvas/WASM renderer paints bounded, continuously scrollable read-only slides; external hyperlinks and Google Fonts are disabled, and legacy `.ppt`/unknown binaries remain on the SystemOpen fallback.
> - **Implementer note**: read CLAUDE.md "Recurring Pitfalls" before starting — #2 (Svelte 5 reactivity), #4 (three theme states), #6 (path validation / no absolute host paths in WebView), #7 (shared modules, no forks), #16 (resizable column layout floors), #17 (third-party widget theming), #20 (UI reference marker ≠ filesystem path) all directly apply to this surface.

## Problem Statement

桌面端右侧目前有三类互不相通的面板：

1. **ProjectFilePanel**（仅 Project 会话）：文件树 + CodeViewer（代码高亮）+ diff2html Git Diff（含 follow-the-agent 自动打开刚写文件的 diff）+ MediaViewer（图片缩放/拖拽、视频、PDF）。能力最全，但只服务 Project。
2. **MiniAppPanel**：sandboxed iframe，从固定 origin `molibot-miniapp://<app-id>/` 加载，面板对 app 零感知。与文件面板是平行的另一套容器。
3. **聊天附件预览**（普通会话）：`ChatView` 里的 modal 弹层（`openPreview`），`canPreview` 只放行 image/audio/video；PDF、HTML、CSV、代码文件一律只能下载。`MediaViewer` 在聊天侧完全没有被使用。

结果是三个具体缺口 + 一个结构性问题：

- **HTML 预览不存在**：Agent 生成一个 HTML 页面后，用户无法在应用内看到渲染结果。
- **聊天会话没有右侧文件查看能力**：图片/视频只有 modal，PDF 连 modal 都进不去；Project 里能做到的事在普通会话里做不到。
- **结构化文本没有结构化呈现**：CSV 是纯文本、JSON 是纯文本、Markdown 是源码、SVG 是源码。
- **结构性问题**：每加一种格式都要在 Project 面板和聊天弹层各做一遍（正是 pitfall #7 警告的 fork），Mini App 又是第三套容器。不先统一容器，格式增强的成本是 N×2 且必然分裂。

## Solution

右侧收敛为一个 **Artifact Panel（工件面板）**：Agent 工作成果的观察窗。

**一个面板容器 + Tab 栏 + 查看器注册表（viewer registry）**：

- 容器负责：tab 生命周期（打开/关闭/激活/去重）、面板宽度与布局（沿用现有 `with-files` grid 契约）、follow-the-agent（沿用 ProjectFilePanel 现有行为并推广到普通会话的生成产物）。
- 每种内容类型注册一个 viewer，按 **MIME + 扩展名** 分发（注意 pitfall #26e：`File.type` 可能为空，分类必须复用共享的 `resolveWebInboundFileMeta()` 语义 —— 声明的 MIME 优先，缺失时按扩展名兜底）。
- **Mini App 是注册表里的一种 viewer**（iframe 型 tab），不再是平行面板。`MiniAppPanel` 的内部实现（iframe、sandbox、URL 构造、不可用态）原样保留，只是外壳换成统一容器的 tab。
- Project 文件树、聊天附件、Session workspace 产物三个入口共用同一注册表，任何新 viewer 一次注册、处处可用。

### Viewer 清单

| Viewer | 内容类型 | 来源 | 优先级 |
|---|---|---|---|
| CodeViewer | 代码/纯文本（现有） | 复用 | 已有 |
| DiffViewer | Git diff（diff2html，现有） | 复用 | 已有 |
| MediaViewer | image / video / pdf（现有）+ **audio（新增分支）** | 复用+扩展 | 已有 / P1 |
| **HtmlPreview** | `.html` / `.htm` | 新增 | **P0** |
| **CsvTable** | `.csv` / `.tsv` | 新增 | **P0** |
| **SpreadsheetTable** | `.xls` / `.xlsx` + Excel MIME | 新增（SheetJS，懒加载、只读） | **P1** |
| **DocxPreview** | `.docx` + Word MIME | 新增（Mammoth + Markdown renderer，懒加载、只读） | **P1** |
| **PptxPreview** | `.pptx` + PowerPoint MIME | 新增（`@silurus/ooxml` Canvas/WASM，懒加载、只读） | **P1** |
| **MarkdownPreview** | `.md` | 新增（复用聊天的 `markdown.ts` 渲染器） | P1 |
| **JsonTree** | `.json` | 新增 | P1 |
| **SvgViewer** | `.svg` | 新增（渲染 + 源码双视图） | P1 |
| MermaidRender | markdown 内 mermaid 代码块 | 新增 | P2 |
| SystemOpen 兜底 | legacy `.ppt` 及一切未注册类型 | 新增（不做内嵌渲染） | P2 |

### 通用操作条（每个文件型 tab 共享）

tab 顶部一致的操作组，由容器提供、viewer 不重复实现：

1. **在 Finder 中显示**（reveal）
2. **用系统默认应用打开**
3. **复制路径**（复用现有 `copyPath`）
4. **下载 / 另存为**（复用现有 `downloadFile`）
5. **作为 `@` 引用插入输入框**：把当前文件以结构化 `@[display name](path)` 语法插入 composer（走 §3.35 已交付的引用机制与校验路径；聊天附件插入的是 session 文件引用，Project 文件插入的是 Project-relative 路径）。这是 Agent 产品特有的闭环：看到产物 → 一键变成下一轮上下文。

Mini App tab 不显示文件操作条（它没有"路径"语义），保留其现有头部（图标 + 名称 + 关闭）。

## User Stories

1. As a user, I want to preview an agent-generated HTML file rendered in the right panel, so that I don't have to download it and open a browser to see the result.
2. As a user, I want the HTML preview to have Refresh and Open-in-system-browser actions, so that I can re-check after the agent edits it or inspect it with real devtools.
3. As a user in an ordinary (non-Project) chat, I want images, videos, PDFs and code files from the conversation to open in the right panel with the same viewers Projects already have, so that preview capability does not depend on which kind of session I'm in.
4. As a user, I want a CSV/TSV file to render as a scrollable table with a header row, so that I can read tabular agent output without counting commas.
5. As a user, I want a raw-text toggle on the CSV table, so that I can always fall back to the exact bytes.
6. As a user, I want an XLS/XLSX workbook to render as a read-only table with a tab for each worksheet, so that I can inspect spreadsheets without leaving Molibot.
6a. As a user, I want a DOCX document to render as a readable, read-only document in the right panel, so that I can inspect reports without opening Word.
6b. As a user, I want a PPTX presentation to render as a read-only slide deck in the right panel, so that I can review generated presentations without opening PowerPoint.
6. As a user, I want Markdown files rendered with the same renderer the chat transcript uses, with a source/preview toggle, so that agent-written reports are readable in place.
7. As a user, I want JSON files to open as their original highlighted source, with an explicit action to parse them into a collapsible tree, so that opening a file is immediate while structured navigation remains available when I ask for it.
8. As a user, I want SVG files rendered visually with a source toggle, so that I can check generated graphics.
9. As a user, I want audio files playable inline in the panel, so that generated/received audio doesn't require download.
10. As a user, I want every file tab to offer reveal-in-Finder, open-with-system-app, copy-path, save-as, and insert-as-`@`-reference, so that the panel closes the loop back into the conversation.
11. As a user, I want Mini Apps to open as tabs in the same right panel as files, so that the right side is one coherent surface instead of competing panels.
12. As a user, I want the panel to follow the agent — when it writes or generates a file, the relevant tab opens/refreshes automatically — so that I can watch the work happen (existing Project behavior, extended to ordinary sessions).
14. As a user, I want unsupported formats (legacy `.ppt`, unknown types) to offer "open with system app" instead of a broken preview, so that no file is a dead end.

## Slices

### Slice 0 — 容器统一（纯重构，行为不变）

把三套右侧承载收敛到一个 `ArtifactPanel` 容器 + viewer registry：

- 抽出 tab 容器：tab 数据模型（`kind` + `path`/`appId` + 去重键）、tab 栏 UI、激活/关闭逻辑。ProjectFilePanel 现有的 tab 逻辑是起点，抽取时保持其文件树、diff-follow、attachments 区不变。
- 定义 viewer registry 接口：`match(meta) → viewer`，输入为共享文件元信息（名称、声明 MIME、扩展名、来源 scope：project | session | miniapp）。分发逻辑放共享层，**不在 UI 组件里写 if/else 链**。
- 现有 CodeViewer / DiffViewer(diff2html) / MediaViewer 注册进 registry。
- MiniAppPanel 变为 registry 中的 iframe viewer，内部实现不动；ChatView 中 `MiniAppPanel` 与 `ProjectFilePanel` 的两个挂载点合并为一个 `ArtifactPanel` 挂载点。
- 布局沿用现有 `with-files` grid 的 floor/clamp 契约（pitfall #16），只改 DOM 归属不改尺寸规则。

**Acceptance（Slice 0）**：Project 文件树/diff/预览、Mini App 打开与关闭、聊天现有 modal 预览行为全部与重构前一致；`apps/desktop/src/chat-ui.test.mjs` 现有结构断言（floor/clamp/gutter、`--d2h-*`、drag mask）全部保持通过；svelte-check 0/0 + vite build + 桌面 UI 测试通过。

### Slice 1 — P0：HTML 预览 + 聊天侧接入 + CSV 表格

**1a. HtmlPreview viewer**

- 服务端为 session workspace / Project 根下的 HTML 文件提供静态服务路由（含其相对引用的 css/js/图片资源），模式对齐 Mini App 的固定 origin 通道（`molibot-miniapp://` 的 Tauri 转发架构）；**禁止** `file://`、禁止把宿主绝对路径暴露给 WebView（pitfall #6）、禁止放宽 CSP 到 localhost 端口段（§3.31 已有结论）。
- 路径必须校验在所属根（session workspace 或注册的 Project root）之内，越界 fail closed；校验逻辑放共享层，复用 §3.35 的根校验语义。
- iframe `sandbox="allow-scripts"`（**不给** `allow-same-origin`，静态预览不需要，也隔离它与 Mini App API 通道），`referrerpolicy="no-referrer"`。
- 操作条追加两个按钮：**刷新**（重载 iframe）、**在系统浏览器打开**。
- follow-the-agent：agent 写入/覆盖已打开的 HTML 文件后自动刷新该 tab。

**1b. 聊天附件/产物接入面板**

- 普通会话的附件与生成产物点击「预览」改为在 ArtifactPanel 打开对应 viewer tab（替代现有 modal）；`canPreview` 的判定改为「registry 是否有匹配 viewer」，PDF 从此可预览。
- 文件内容仍经现有 `fetchDesktopFileBlob` 权限路径取回（blob URL 交给 viewer），不新开数据通道；blob URL 生命周期由容器统一管理（tab 关闭即 revoke）。
- 分类经共享 `resolveWebInboundFileMeta()` 语义（pitfall #26e），空 MIME 按扩展名兜底。

**1c. CsvTable viewer**

- 解析放共享工具模块（带引号转义、逗号/制表符自动识别），首行作表头展示（不做类型推断）。
- 大文件虚拟滚动或行数上限 +「已截断，共 N 行」提示（阈值建议 5,000 行，超出仍可切原始文本）；解析失败整体回退 CodeViewer。
- 「表格 / 原始文本」切换。V1 不做排序、筛选、编辑。
- CJK 单元格宽度与截断正常（pitfall #8 意识：不要按 ASCII 字宽估算列宽）。

**Acceptance（Slice 1）**：agent 生成的多文件 HTML（含相对 css/img）在面板内渲染正确，刷新与系统浏览器打开可用，越界路径与不存在路径 fail closed 且不泄漏宿主路径；普通会话中 image/video/pdf/代码文件均在右侧面板打开，外部只读会话同样可预览；CSV 正确渲染表头与转义单元格、大文件不冻结 UI、损坏文件回退源码视图；三种主题态（light/dark/无属性跟随系统）全部经语义 token 渲染正确（pitfall #4）。

### Slice 2 — P1：Markdown / JSON / SVG / Audio

- **MarkdownPreview**：复用聊天 `markdown.ts` 渲染器（共享模块，不 fork），源码/预览切换，默认预览；渲染样式对齐 transcript 的排版 token。
- **JsonTree**：默认显示原始 JSON 源码（复用 `CodeViewer` 的高亮、行号、查找和分块加载）；用户点击“解析为树形”后才构建可折叠树，默认展开两层。解析失败、超过 1 MiB 或超过 5,000 行节点预算都回退源码并提示。
- **SvgViewer**：渲染视图经 `<img>`（blob URL）呈现以天然禁脚本；源码视图走 CodeViewer。渲染/源码切换。
- **Audio**：MediaViewer 增加 `<audio controls>` 分支，聊天侧与 Project 侧同时生效（同一组件）。

**Acceptance（Slice 2）**：md/json/svg/audio 在聊天与 Project 两个入口都按预期打开；JSON 首次打开不调用树解析器，点击显式操作后才进入树形，且树形失败态都有明确回退（不出现空白 tab）；每个 viewer 的失败态都有明确回退（不出现空白 tab）；markdown 渲染器无第二份实现。

### Slice 2b — P1：XLS/XLSX SpreadsheetTable（已交付 2026-08-09）

- 通过共享 registry 将 `.xls`、`.xlsx` 与 Excel MIME 类型路由到 `SpreadsheetTable`；Project 文件和 Session 附件都通过已有授权字节通道取回，不新增绕过权限的数据入口。
- SheetJS 仅在第一次打开工作簿时动态加载。每个工作表显示为只读表格，提供工作表标签、固定表头、行号、横向滚动和空表状态；每表最多渲染 5,000 行，超出显示截断提示，避免巨型 DOM 冻结 WebView。
- 公式按显示值读取且不执行；损坏/不兼容的工作簿显示可重试错误，不会回退到无意义的系统卡片或冻结整个面板。下载、Finder 和系统打开仍由公共操作条提供。

**Acceptance（Slice 2b）**：扩展名与 MIME 分发正确；多工作表、重复值、空表和截断均可显示；Project/Session 两个入口一致；SheetJS 不进入初始 bundle；解析失败可重试且不影响其他 tab。

### Slice 2c — P1：DOCX DocxPreview（已交付 2026-08-09）

- 通过共享 registry 将 `.docx` 与 Word MIME 类型路由到 `DocxPreview`；Project 文件和 Session 附件都通过已有授权字节通道取回，不新增绕过权限的数据入口。
- Mammoth 仅在第一次打开 DOCX 时动态加载，关闭外部文件访问和嵌入图片资源，将文档结构转换成 Markdown，再交给已有 Markdown/DOMPurify 渲染链；右侧只读，不提供 Word 布局复刻或编辑。
- 转换提示显示为非阻塞的文档状态；损坏或不兼容文件显示可重试错误，不会回退到空白或冻结面板；公共操作条继续提供下载、Finder 和系统打开。

**Acceptance（Slice 2c）**：扩展名与 MIME 分发正确；真实 DOCX fixture 可转换为 Markdown；恶意/活动标记不进入新渲染管线；Project/Session 两个入口一致；Mammoth 不进入初始 bundle；损坏文件可重试且不影响其他 tab。

### Slice 2d — P1：PPTX PptxPreview（已交付 2026-08-09）

- 通过共享 registry 将 `.pptx` 与 PowerPoint MIME 类型路由到 `PptxPreview`；Project 文件和 Session 附件都通过已有授权字节通道取回，不新增绕过权限的数据入口。
- 使用 MIT 授权的 `@silurus/ooxml` 浏览器端 Canvas/WASM 渲染器。解析器和 WASM 仅在第一次打开 PPTX 时动态加载；幻灯片以连续滚动的只读 desk 展示，支持文字选择，禁用外链跳转和 Google Fonts 请求。
- 预解析限制 50 MiB，OOXML archive entry、膨胀总量和 entry count 还有独立上限；损坏、超限或渲染失败显示可重试/非阻塞错误，不会把整个 Artifact Panel 卡死。统一操作条继续提供下载、Finder 和系统打开。

**Acceptance（Slice 2d）**：扩展名与 MIME 分发正确；PPTX viewer 在 Project/Session 两个入口一致；Canvas/WASM 解析器保持懒加载；输入与 archive 资源边界有机器守卫；外链/远程字体不出网；损坏文件可重试且不影响其他 tab；light/dark desk token、`svelte-check`、桌面 UI 测试和生产构建通过。

### Slice 3 — P2：Mermaid + 系统应用兜底

- **MermaidRender**：MarkdownPreview 内的 mermaid 代码块渲染为图（第三方库主题必须走其自有变量体系并覆盖其全部 scheme，验证用真实产出 DOM —— pitfall #17）；独立 `.mmd` 文件可选。
- **SystemOpen 兜底**：legacy `.ppt` 及一切无匹配 viewer 的类型显示文件卡片（图标 + 名称 + 大小）+「用系统应用打开」「在 Finder 显示」「下载」。PPTX 由 `PptxPreview` 承担只读幻灯片预览，DOCX 由 `DocxPreview` 承担只读内容预览，XLS/XLSX 由 `SpreadsheetTable` 承担只读表格预览。

**Acceptance（Slice 3）**：mermaid 图在三种主题态下可读；任何未知类型文件都不是死胡同。

## Out of Scope（明确不做，避免范围蔓延）

- **内嵌编辑器**（monaco 等）：已有 deferred 决策（见 desktop-ide-stack-decisions）。右侧是观察窗不是 IDE；修改经 agent 或系统应用。
- **文件管理操作**（重命名/移动/删除/批量）：越过观察窗定位，且与 agent 并发写文件冲突。
- **通用浏览器**（任意 URL 地址栏）：HTML 文件预览 ≠ 浏览器；安全面与产品面都不在本期。
- **CSV 排序/筛选/编辑**、**JSON 编辑**：V1 只读。
- **PPTX 编辑和演示能力**：只提供静态只读幻灯片预览，不提供编辑、动画播放、演讲者视图、放映控制或 legacy `.ppt` 转换；DOCX 的只读内容预览不提供 Word 布局复刻或编辑；XLS/XLSX 的只读数据预览不提供编辑、公式计算或格式复刻。
- **Mini App 面板内部改造**：iframe、sandbox、API 通道全部不动，只换外壳容器。
- **SSE/实时文件监听**：follow-the-agent 沿用现有的写入事件驱动刷新，不引入 chokidar（已 deferred）。

## Test Seams（实现方必须落的机器防护）

1. **Viewer registry 分发**：单测覆盖 MIME/扩展名映射、空 MIME 兜底（对齐 `attachments.test.ts` 的空 MIME 案例）、未知类型落 SystemOpen 兜底、同一文件在 project/session 两个 scope 分发一致。
2. **HTML 静态路由**：根校验单测 —— 根内相对引用可达、`../` 越界与符号链接逃逸 fail closed、响应不含宿主绝对路径；对齐 `path.test.ts` 的现有模式。
3. **CSV 解析**：引号/转义/CRLF/制表符/CJK 案例；截断阈值行为。
4. **Spreadsheet 解析**：XLSX 多工作表、重复值、空表、公式不执行、5,000 行 DOM 上限与损坏文件错误态；扩展名/MIME registry 分发覆盖 Project/Session 两个 scope。
5. **DOCX 解析**：真实 DOCX fixture 转换、外部文件访问关闭、嵌入图片不发起资源加载、损坏文件错误态；扩展名/MIME registry 分发覆盖 Project/Session 两个 scope。
6. **PPTX 解析/渲染**：PPTX 扩展名/MIME 分发、50 MiB 输入限制、archive resource limits、懒加载 `@silurus/ooxml/pptx`、解析失败/渲染失败错误态、两个 scope 接入；远程字体和外链默认关闭。
7. **结构守卫**（`apps/desktop/src/chat-ui.test.mjs`）：单一 `ArtifactPanel` 挂载点（不允许 MiniAppPanel/ProjectFilePanel 再各自出现在 ChatView）；操作条按钮存在性；`with-files` floor/clamp 契约延续；iframe sandbox 属性断言（HtmlPreview 无 `allow-same-origin`）；三主题态 token 断言。
8. **Blob URL 生命周期**：tab 关闭后 revoke（防泄漏）。
9. **验证约定**（pitfall #9/#10）：每个 slice 交付 = svelte-check 0/0 + vite build + 桌面 UI 测试 + 服务端触及文件 tsc；并做冷启动 smoke walk —— 重启服务后首开面板、首点预览、切换会话、Mini App tab 与文件 tab 混开。

## Delivery Notes

- 每个 slice 交付后按 CLAUDE.md 更新 `features.md` 与 `CHANGELOG.md`（含验证结果）。
- Slice 0 先行且独立合入；Slice 1 的 1a/1b/1c 可并行；Slice 2、3 依赖 Slice 0 的 registry。
- i18n：所有新增 UI 文案进 `apps/desktop/src/lib/i18n.ts`，中英双语。
- 开关类控件（如出现）一律 `IosSwitch`。
