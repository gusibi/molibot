# Molibot PRD (V1)

## Archive Index / 归档索引
- [2026 Q2 PRD Archive (Apr - Jun)](docs/archive/prd-archive-2026-Q2.md)
- [2026 Q1 PRD Archive (Feb - Mar)](docs/archive/prd-archive-2026-Q1.md)
- [2026 Q3 PRD Archive (Jul - Sep)](docs/archive/prd-archive-2026-Q3.md)

## 3.124 本轮文件产物清单（2026-08-25）

- **Priority / Status**: P1 / Delivered (2026-08-25).
- **Problem**: Agent 完成一轮修改后，用户需要从回复中直接看到本轮创建或更新了哪些文件，并在右侧文件面板查看最终内容；Git 快照不适用于普通 Session，复杂度也超出当前需求。
- **Decision**:
  - 工具成功结束时记录结构化文件产物回执，随消息持久化，不依赖 Git 快照。
  - 回复末尾与 Artifact Inspector 共用一份扁平列表，只以“创建 / 更新”标识区分，不做文件分区。
  - Project 文件打开磁盘当前内容；普通 Session 展示并打开本轮生成的最终附件。
- **Acceptance**:
  - 成功产物去重后按单一列表展示，失败工具不进入列表。
  - 已进入本轮文件卡片的 assistant 附件不再在回复下方重复展示。
  - 点击回复卡片或文件行可打开右侧面板，并查看对应最终内容。
  - 普通 Session 的 HTML 通过原生 Artifact transport 转发并正常预览。
  - 中英文、明暗主题、重启后的消息回读均可用。

---

## 3.123 HTML 产物预览与首轮 Session Title 更新修复（2026-08-25）

- **Priority / Status**: P1 / Delivered (2026-08-25).
- **Problem**:
  - 新写入的 HTML 被活动卡片和 follow-the-agent 无条件送入 Git Diff；未跟踪的新文件没有有效 diff，右侧 Artifact Inspector 因而无法展示页面。
  - 标题总结入口只判断标题是否仍为默认值，没有判断当前是否首轮；首次总结未成功时，后续每轮都会再次尝试。Desktop 的后台 Session 刷新同时切换加载态，以省略号替换整组列表，造成可见闪烁。
- **Decision**:
  - HTML 家族写入统一打开文件 viewer，其它写入仍打开 diff；两个入口复用同一判定函数。
  - 标题总结在读取模型配置前，以持久化消息中的用户消息数强制限定为首条消息。
  - 自动后台刷新保留已有 Session 行，仅更新请求完成后的数据；首次加载和用户主动展开仍显示加载态。
- **Acceptance**:
  - 新建 HTML 可直接在右侧沙箱预览，普通代码写入仍打开差异视图。
  - 第二轮及之后不调用标题模型、不重命名 Session；后台同步不再清空 Session 列表。
  - 标题总结、HTML 路由和 Desktop UI 回归测试通过。

---

## 3.122 服务器默认端口调整为 3040（2026-08-23）

- **Priority / Status**: P1 / Delivered (2026-08-23).
- **Problem**:
  - 端口 3000 是许多常见 Web 框架和本地调试工具的默认端口，极易发生占用与端口抢占；
  - 需要将 Molibot 的全套默认端口统一由 3000 升级为 3040。
- **Decision**:
  - 服务端运行时（`env.ts`）、设置默认值（`defaults.ts`）、端口检测（`service-port.mjs`）的默认端口统一定义为 `3040`；
  - 桌面 Supervisor 守护进程（`supervisor.rs`）与桌面端设置界面（`App.svelte` / `i18n.ts`）同步默认端口；
  - 启动配置（`vite.config.ts`、`bin/molibot-manage.js`、`docker-compose.yml`、`Dockerfile`、`.env.example`、`readme.md`）全面更新为 `3040`。
- **Acceptance**:
  - 未配置环境变量和持久化设置时，服务默认在 `3040` 端口监听并正常对外提供服务；
  - 单元测试、集成测试与桌面端检查通过。

---

## 3.121 项目文件面板图片与媒体即时更新及缓存击穿（2026-08-23）

- **Priority / Status**: P0 / Delivered (2026-08-23).
- **Problem**:
  - 用户在 Project 维度生成或覆盖图片（如 `1.png`）后，在 Finder 中确认文件内容已更新，但从右侧文件面板打开时仍显示旧图；
  - 根因为多层缓存叠加：
    1. 前端 `ArtifactTabsStore` 对已打开的 Tab 做复用，再次从树点击时直接跳过请求；
    2. 图片和流式媒体的 URL 始终为固定的 `/api/settings/projects/{id}/inspection/file?path=1.png&raw=true`，Svelte 响应式（`$derived`）未感知变化；
    3. WebKit WebView 内核对于 `<img src="...">` 具有强内存解码缓存（Decoded Image Cache），只要 URL 字符串未变，即使重新挂载也不发送网络请求；
    4. HTTP 响应头原使用 `no-cache`，需强化为 `no-cache, no-store, must-revalidate`。
- **Decision**:
  - `ArtifactTab` 添加 `version` 戳并在新建、重新打开或通过 Watcher 重新加载时自动更新；
  - 从文件树再次点击已打开的文件时，调用 `reloadTab` 重新抓取磁盘最新状态；
  - `desktopProjectRawFileUrl` 与 `desktopFileContentUrl` 支持透传版本参数 `&v=${version}`；
  - `ArtifactPanel.svelte` 中 `rawUrl` 与 `sessionStreamUrl` 基于 `activeTab.version` 动态派生，文件更新或刷新时 URL 自动改变，彻底击穿 WebKit 图片内存缓存；
  - `streamFileWithRange` 默认 `Cache-Control` 设置为 `no-cache, no-store, must-revalidate`；
  - Web 界面 `buildPersistedFileUrl` 同步附带文件更新时间戳参数 `&v=...`。
- **Acceptance**:
  - 在 Project 文件树中打开图片后，外部或模型覆盖重写该图片，文件面板中预览即时刷新为新图片；
  - 再次点击已打开的文件时能即时从磁盘加载最新数据；
  - 全套单元测试与桌面端检查 100% 通过。

---

## 3.120 Prompt Box（提示词箱）详情弹窗统一滚动与底栏按钮常驻修复 (v1.0.7)（2026-08-23）

- **Priority / Status**: P0 / Delivered (2026-08-23).
- **Problem**:
  - 用户需要高效管理常用的提示词库，并与云端（Prompt Box / `pb.onlinestool.com`）双向同步；
  - 在对话与任务过程中，需要能够随时一键将提示词填入聊天输入框，或者在 AI 输出/用户消息处通过右键快速提取提示词保存到提示词箱；
  - 需要在本地支持高效的标签筛选、多维度即时排序、富文本/图片快捷模板、编辑实时预览与快捷键保存等便利性交互。
- **Decision**:
  - 打造全新的内置小程序 `prompt-box`（Prompt Box 提示词箱）；
  - **API Key 与双向同步**：提供设置面板配置 API Key 与 Base URL，顶栏【刷新/同步】按钮支持将本地离线新增提示词推送到云端并将云端更新拉取到本地；
  - **多标签筛选与纯本地多维排序**：支持多标签组合筛选（带标签计数），支持按最近更新、最近创建、标题 A-Z / Z-A、内容长度等 5 种维度纯本地秒级排序，无需每次请求远程；
  - **高效编辑与创作便利性**：
    - 交互式标签 Chip 管理与现有库常用标签一键推荐；
    - Markdown 快捷模板工具栏（动态变量占位符 `{{var}}`、图片 `![img](url)`、链接、代码块、角色预设）；
    - SegmentedControl 编辑 / Markdown 实时预览切换；
    - 实时字符与词数统计；
    - 键盘快捷键 `⌘ + Enter` / `Ctrl + Enter` 一键保存；
  - **输入框填入桥接**：在 UI 卡片中提供【填入输入框】操作，通过 `composer.insert` 消息协议即时追加提示词至主聊天输入框；
  - **右键消息提取**：注册 `contributions.messageActions`（`save_prompt`），在消息气泡右键动作中支持一键提取消息或选区内容并保存；
  - **UI 构建**：基于 `/Users/gusi/Github/astryx`（`@astryxdesign/core` + `@astryxdesign/theme-neutral`）构建卡片式响应式界面，支持多语言与明暗主题自适应。
- **Acceptance**:
  - 在 Mini Apps 列表中可一键安装与使用 Prompt Box；
  - 支持多标签筛选与 5 种排序方式即时响应；
  - 刷新/同步按钮支持双向同步并正确返回推拉结果；
  - 编辑弹窗支持常用标签快选、快捷模板注入、编辑/预览切换与快捷键保存；
  - 点击卡片上的【填入输入框】可正确将提示词注入聊天输入框；
  - 在 AI 回复处右键选择【存为提示词】可成功保存并在聊天中展示反馈卡片；
  - 全套单元测试与桌面端检查 100% 通过。

---

## 3.119 大文件打开防卡死与 Git Status 检查性能优化（2026-08-23）

- **Priority / Status**: P0 / Delivered (2026-08-23).
- **Problem**:
  - 打开 6.9MB 大文本文件时，如果项目包含数百个未跟踪文件（如 454 个文件），后端 `getProjectGitStatus` 会在单线程主循环中完整读取每个文件并执行全量 `replaceAll` 和 `split` 统计行数，导致 Node.js 事件循环长时间阻塞，文件加载请求排队挂起；
  - 前端 `CodeViewer` 对 512KB 分片在主线程执行 `highlight.js` 重正则匹配并一次性挂载 2,000 行 DOM，若遇超长行会导致 WebView 排版引擎冻结，且导致顶部标题栏拖拽失效（`onmousedown` 无法响应）。
- **Decision**:
  - 后端对大于 256 KB 的未跟踪文件直接跳过行数统计，返回 `additions: null`（界面显示 `+—`）；
  - 小于等于 256 KB 的文件采用 Buffer 原生零分配换行统计（`countBufferLines`）；
  - 未跟踪文件状态检查采用 16 路并发批次执行；
  - 前端超过 256 KB 文本跳过 heavy 正则语法高亮并安全降级；单行超过 4,000 字符进行视觉安全截断；`CHUNK_LINES` 调整为 500。
- **Acceptance**:
  - 大文本文件打开即时响应，无界面白屏或长期“正在加载...”；大文件与多文件场景下顶部标题栏拖动流畅无阻；77 项项目文件测试与 216 项桌面端测试全量通过。

---

## 3.118 Note 便签明暗主题文字对比度与分享按钮样式修复 (v1.8.10)（2026-08-23）

- **Priority / Status**: P1 / Delivered (2026-08-23).
- **Problem**:
  - 信纸主题下编辑页底栏【分享】按钮在亮色模式下因浅白字色导致严重泛白看不清；
  - 暗色模式下由于遗漏了 `.editor-title-input`、`.note-search`、`.note-input-title` 的暗色字色覆盖，导致便签标题和搜索框输入文字仍为暗棕色，在黑色背景上几乎无法看清；
- **Decision**:
  - 亮色信纸主题下【分享】按钮改用高对比度棕黑字色（`#4a3828`）、柔和白渐变背景与微投影；
  - 暗色模式下完整补齐 `.editor-title-input`、`.note-search`、`.note-input-title`、`.share-action-btn` 的浅色字色（`#e6ded6`）与深色拟物按压样式；
  - `manifest.json` 版本升级至 `1.8.10`。
- **Acceptance**:
  - 亮色模式下编辑页底栏【分享】按钮文字清晰醒目；暗色模式下便签标题与各输入框文本均清晰可读；全量测试通过。

---

## 3.117 Note 便签分享卡片品牌署名统一为 Moli Note 与宿主原生文件保存支持 (v1.8.9)（2026-08-23）

- **Priority / Status**: P1 / Delivered (2026-08-23).
- **Problem**:
  - Note 分享卡片底部署名不统一（Keep 主题显示为“Note”，锤子主题显示为“Smartisan Notes”），用户希望统一为“Moli Note”且不带有第三方品牌字样；
  - 沙箱 iframe 拦截了虚拟 `<a download>` 下载，导致点击【保存图片】无法真实将文件存入本地磁盘；
- **Decision**:
  - Keep 风格与锤子拟物风格生成的分享卡片底部品牌署名统一为 `Moli Note`；
  - 扩展 `miniappHostCapability` 宿主能力（`file.save`），Desktop 端原生实现 `save_file_dialog` 弹出原生系统保存对话框，将 PNG 图片真实落盘写入磁盘；
  - `manifest.json` 声明 `host.capabilities: ["fileSave"]`，版本升级至 `1.8.9`。
- **Acceptance**:
  - 分享预览卡片右下角/底部统一显示 `Moli Note`；点击【保存图片】呼出原生保存窗口并将图片保存至指定本地目录；全量测试通过。

---

## 3.116 Desktop 左侧栏顶部红绿灯与工具栏区域窗口拖拽响应修复（2026-08-23）

- **Priority / Status**: P1 / Delivered (2026-08-23).
- **Problem**: Desktop 端左侧侧边栏顶部区域（macOS 红绿灯及折叠按钮周围）点击无法拖动窗口，原因是 `.sidebar-top-bar` 容器 `pointer-events: none` 阻断导致 `.sidebar-titlebar-drag` 未能接收鼠标事件，事件穿透到底层普通 `<aside>` 容器。
- **Decision**:
  - 为 `.sidebar-titlebar-drag` 显式设置 `pointer-events: auto` 并将高度调整为 `42px` 铺满顶栏；
  - 在 `ChatSidebar.svelte` 与 `SidebarShell.svelte` 中显式绑定 `onmousedown={startWindowDrag}` 调用 Tauri `getCurrentWindow().startDragging()`；
- **Acceptance**:
  - 点击左上角红绿灯右侧空白区域及折叠按钮周围区域可流畅拖拽窗口；折叠按钮等交互控件正常工作；216 项桌面端测试与 59 项 Rust 测试全量通过。

---

## 3.115 内置小程序全套体验增强（Note 标签下拉菜单收纳与高度抖动修复、Todo 待办快捷日期与一键清空、MD Preview 新主题与字数统计、Meeting Notes 会议纪要体验重构）（2026-08-22）

- **Priority / Status**: P1 / Delivered (2026-08-22).
- **Problem**:
  - **Note 便签**：主界面常驻标签栏在点击不同标签时高度与样式发生抖动形变；主界面默认常驻标签栏占用垂直排版空间，用户希望将标签收纳至顶栏“笔记”下拉菜单中；
  - **Todo 待办**：设置截止日期必须手动点开日历控件逐层选择，缺乏“今天”、“明天”、“下周一”一键快捷选项；缺乏一键清空已完成待办的操作入口；
  - **MD Preview 公众号排版**：预设主题较少，缺少适合技术分享和生活随笔的流行排版风格；顶栏缺乏文章字数与预计阅读时间统计；
  - **Meeting Notes 会议纪要**：历史录音无法播放，逐字稿缺少音字同步播放与点击跳转，未配置语音识别时缺少清晰指引与一键重试。
- **Decision**:
  - **Note 便签 (v1.8.0)**：移除主界面常驻横向标签栏；将标签筛选整合进顶栏“笔记 / 归档”下拉菜单（`#tab-picker`）；菜单项固定 `36px` 高度与规范间距，彻底消除高度形变；选中标签后顶栏标题联动并可一键切回全部笔记。
  - **Todo 待办 (v1.8.0)**：在日期抽屉增加快捷日期胶囊；在已完成列表头部增加【清空】操作；提供 `clear_completed` Agent 工具与批量清理路由；规范 Material 3 语义 token。
  - **MD Preview (v1.2.0)**：增加 `geek-mint` (极客薄荷) 与 `warm-amber` (暖橙知秋) 两款流行排版主题；顶栏增加实时字数与预计阅读时间胶囊；优化主题选择指示与多语言支持。
  - **Meeting Notes (v1.3.0)**：后端提供音频拼接流与 Range 支持；前端提供现代卡片式音频播放器；逐字稿支持单句点击跳转与播放同步高亮；提供未配置语音识别时的中文指引与一键批量重试。
- **Acceptance**:
  - 各小程序功能正常可用；M3 设计基线规范校验通过；全量 201 项 Mini App 测试 100% 通过。

---

## 3.112 Desktop 端侧边栏折叠按钮、变窄自动吸附折叠与平滑过渡动画（2026-08-22）

- **Priority / Status**: P1 / Delivered (2026-08-22).
- **Problem**:
  - Desktop 桌面端左侧侧边栏缺少快捷折叠/收起入口，无法一键沉浸聚焦主聊天区域；
  - 侧边栏拖拽变窄到极限时只能硬性卡在 228px，无法继续向左吸附折叠；
  - 屏幕或窗口缩小时无法自适应折叠侧边栏；
  - 折叠展开过程缺乏顺畅平滑的过渡动画。
- **Decision**:
  - 在左侧侧边栏顶部工具栏添加折叠按钮（`ph-sidebar-simple`），折叠后在各页面主头部左侧提供展开按钮（留出 84px 适配 macOS 红绿灯安全边距），支持 `Cmd+B` 快捷键；
  - 拖拽侧栏宽度压缩低于 160px 阈值并释放时自动触发吸附折叠，展开时恢复用户原本宽度；窗口尺寸缩窄至 `<= 820px` 时自动折叠；
  - CSS Grid 轨道与 `transform: translateX(-100%)` / `opacity` 结合硬件加速平滑动画，手动调整宽度时禁用 transition 保持 120fps/60fps 实时跟手零延迟。
- **Acceptance**:
  - 折叠按钮、展开按钮、`Cmd+B` 快捷键交互正常；拖拽低于 160px 自动吸附折叠；窗口缩窄自动折叠；动画丝滑；214 项桌面测试与 56 项 Rust 测试全量通过。

---

## 3.111 Desktop 端思考自动折叠与屏幕变窄视口底部自动锚定（2026-08-22）

- **Priority / Status**: P1 / Delivered (2026-08-22).
- **Problem**:
  - Desktop 桌面端在部分模型一次性完成或思考结束至正文输出交接阶段，思考过程未能及时自动折叠为摘要栏；
  - 调整窗口宽度、拉伸侧边栏或分屏使屏幕变窄时，消息折行变多导致 `scrollHeight` 增加，但缺少尺寸变化监听，`scrollTop` 停留在旧坐标，底部最新内容被挤压至屏幕下方，焦点丢失。
- **Decision**:
  - `stickToBottom.ts` 引入 `ResizeObserver`，当布局宽度改变触发文本重排时，只要处于底部锁定态（`pinned === true`），即刻重设 `scrollTop = scrollHeight - clientHeight` 保持视口牢牢吸附在最后一行；
  - `conversationController.svelte.ts` 在 `onDone` 中兜底同步正文与思考步骤，保证 `liveSections.response` 及时产生，触发 `TurnProcess` 折叠；
  - Web 端 `+page.svelte` 完善 `phase: "end"` 与 `done` 即刻标记折叠。
- **Acceptance**:
  - 缩放/拉窄窗口时视口始终锚定在最新一行；思考流在正文出现/回合完成时自动折叠；213 项桌面测试与 267 项后端测试全量通过。

---

## 3.110 插件自有设置页与独立配置/数据目录（2026-08-22）

- **Priority / Status**: P1 / Partially Delivered — External Subagent reference migration and the shared catalog/settings host are delivered; enhanced third-party pi package installation and the remaining legacy built-ins are still planned under GitHub Issue [#34](https://github.com/gusibi/molibot/issues/34).
- **Delivered Desktop slice**: 原生设置页已合并 core/contract 两类目录，固定展示 Memory、Daily Materials、Cloudflare HTML 与 External Subagent；Tauri 只授权两组细粒度插件 API，并通过 `molibot-plugin://` 隔离加载插件自带设置页，不开放任意 localhost iframe。
- **Delivered custom-UI polish**: 自带页面接收宿主明暗模式与语义主题 token，并通过受校验的 resize bridge 自动调整 iframe 高度；External Subagent Provider 必须先通过环境检测才能启用，安装结果失败时不得显示成功，安装目录由插件独立数据根负责创建。
- **Delivered persistence fix**: Desktop 宿主不得把响应式代理直接发送到插件 WebView；设置与密钥状态以 structured-clone-safe 快照回传，Provider 启用状态必须通过保存、重建 store、重新加载的 round-trip。
- **Delivered runtime enforcement**: Codex / Claude Code 的独立开关是执行权限边界，不只是展示状态；`subagent` 在每次执行前按插件独立配置校验 single、parallel 与 chain 中的全部 Provider，并在底层 runtime 调用前再次 fail closed。最终系统提示词不得出现已禁用 Provider。
- **Problem**: External Subagent 已证明 package-owned 设置链路，但增强型 pi 包尚不能自动进入该目录；Memory Backend、Daily Materials 等遗留内置项仍使用全局 RuntimeSettings。在过渡期间，目录必须继续明确显示这些内置项，不能因尚未迁移而让用户误以为它们被卸载或丢失。
- **Decision**:
  - `/settings/plugins` 只保留紧凑插件目录、来源/健康状态和启停开关；配置动作进入 `/settings/plugins/<plugin-id>` 独立页面；
  - 新契约插件在全局 RuntimeSettings 只保留 `enabled`，插件专属字段、Flag、凭据与路径不得进入通用 settings；遗留内置项必须明确标识，直至单独迁移或删除；
  - 插件以 owner 全局 `config.dataDir` 为根，固定拆分 `plugins/packages/<id>`、`plugins/config/<id>`、`plugins/data/<id>`、`plugins/cache/<id>`；绝不从 Bot/Channel/Session/Project `workspaceDir` 推导；
  - 简单插件由插件提供 Schema、宿主用现有 shadcn-svelte 设置组件渲染；复杂插件自带隔离设置 UI 和设置 action，宿主只提供版本化窄桥、原子持久化、秘密 replace/clear、生命周期和故障边界；
  - External Subagent 是首个 tracer bullet：设置 UI、配置、环境检测、运行时安装和测试回归 package，删除 Core 中全部专属分支，不保留兼容字段或迁移层。
- **Acceptance**: 安装一个带 Molibot settings contribution 的 pi 插件后无需改 Core 即出现独立设置页；保存后 fresh Runtime/Plugin Host 重启可读；升级只替换 code 并在覆盖 owner 副本前备份；普通卸载保留 config/data；全局 settings 无插件专属值；Desktop/Web 中英、语义主题、内容高度和窄宽冷路径通过；依赖环境未就绪时 Provider 不能启用，已禁用 Provider 的直接/并行/链式调用不得启动进程，安装失败必须原样可见。
- **Detailed PRD**: [Plugin-owned Settings and Storage PRD](docs/requirements/plugin-owned-settings-prd.md).

---

## 3.109 Web 聊天界面思考时序分段与自动折叠（2026-08-21）

- **Priority / Status**: P1 / Delivered (2026-08-21).
- **Problem**: 
  - 传统单一思考框固定在正文上方，在流式生成思考、流式输出正文以及 Agent 多轮思考（思考 ➔ 工具执行 ➔ 再次思考 ➔ 输出）中，顶部思考框反复展开与内容变化导致页面剧烈上下跳动与抽搐。
- **Decision**:
  - **分段时序块（Streaming Blocks）**：流式阶段将每次思考、工具活动、正文输出作为独立的时序块（Block）向下单向追加，永不回头修改上方已完成块的高度；
  - **完成即自动平滑折叠**：当前思考块在流式进行中保持展开；进入工具执行（`runner_event`）或正式输出正文（`token` / `replace`），前面的思考块立即自动平滑收起为精致小胶囊（`🧠 已完成思考 · 点击展开`），固定高度，杜绝挤压下方正文；
  - **多轮 Agent 连续追加**：当模型在工具调用后发起第二轮思考时，在最下方追加崭新的思考块，完成时同样自动折叠，保持整体界面极度清爽且随时可回溯展开；
  - **后端多轮思考保真**：`api/stream/+server.ts` 确保多轮 Agent 循环中多次 `thinking_start` 能够完整保留与拼接段落，并通过 `thinking_state` 显式通知前端分块。
- **Acceptance**: 已交付。流式思考与正文输出无视口跳动；多轮思考按序向下生长并自动收起；全量测试 267 项全绿，build 成功。

---

## 3.108 External Subagent 内置插件（Codex & Claude Code 一次性子 Agent）（2026-08-20）

- **Priority / Status**: P1 / Delivered (2026-08-20).
- **Problem**: 
  - 当前 Molibot 仅支持基于 Pi Runtime 的内部 Subagent，缺少将外部成熟代码/开发 Agent（如 OpenAI Codex、Claude Code）作为独立非交互子任务委派的能力；
  - 外部 Agent 需要在隔离进程中安全执行，既不能继承父会话不相关的认证凭证，也不能因超时或取消留下孤儿进程；
  - 外部 Agent 的原始 stderr、协议交互与多轮思考不应污染主模型上下文。
- **Decision**:
  - **架构决策**：将外部独立进程代码 Agent（Codex & Claude Code）无缝统一进内置的 `subagent` 工具体系中，作为一等公民角色（`claude-code` / `codex`）存在，无需向主模型暴露冗余的顶级工具；
  - **独立实现包**：创建 `package/external-subagent` 独立包，提供统一 `ExternalSubagentRuntime`、进程管理 `ManagedProcess`、`JsonRpcLineTransport` 以及 Codex / Claude Code 适配器；
  - **安全与生命周期**：
    - 环境变量白名单过滤，严格阻断不相关凭证；
    - 全进程树级终止（POSIX 进程组 / Windows taskkill /T），先 SIGTERM（grace 3000ms）后 SIGKILL；
    - 统一超时与取消处理，区分 `aborted` 与 `timeout`；
    - 仅向父 Agent 返回压缩后的最终文本（头部+尾部压缩，最多 ~6000 字符）与结构化诊断；
  - **工具与设置**：
    - `subagent` 工具直接支持 `agent: "claude-code"` 与 `agent: "codex"`，并可在 `chain`（如 `scout -> claude-code -> reviewer`）与 `tasks` 中链式/并发编排；
    - Plan 模式自动过滤写操作子 Agent，维持安全只读边界；
    - 插件默认禁用（`enabled: false`），支持分别启用 Codex 和 Claude Code 及其非交互权限模式（默认 `never` / `dontAsk`）；
    - 设置支持 SQLite round-trip 持久化，中英文双语配置；Web / Desktop 支持环境探测卡片与一键安装；
  - **发布与打包**：
    - 精确锁定 `@openai/codex@0.147.0` 与 `@anthropic-ai/claude-agent-sdk@0.3.220`；
    - 打包构建移除 `--no-optional` 以包含当前平台二进制 payload。
- **Acceptance**:
  - 独立包单元测试（进程树终止、超时、取消、凭证过滤、JSON-RPC、Codex/Claude wire 与 provider）全部通过；
  - 插件工具分类与串行执行策略正确生效，Plan 模式隔离；
  - 设置保存、重启恢复与 round-trip 测试通过；
  - 发布构建包含平台依赖，无残留后台进程；
  - 文档、类型检查与全量测试全绿。
- **Detailed Plan**: [External Subagent 实现计划](docs/archive/requirements/external-subagent-implementation-plan.md).

---

## 3.107 图片按需识别与多引擎路由（2026-08-20）

- **Priority / Status**: P0 / Delivered (2026-08-20).
- **Decision**: 不在 Channel/消息解析阶段预识别图片。主模型具备已验证视觉能力时原生读取；否则由现有 `read(path, prompt)` 在需要时调用独立图片识别模块。识别设置允许多个 API 引擎按序故障切换，第一期不执行本地 CLI，但保留内部 adapter 接口供第二期接入。
- **Acceptance**: 同图可多次按不同要求识别；配置可独立保存、重启恢复和用未保存值测试；删除旧公开图片分析工具；所有 Channel 只保存和规范化附件；Web 与 Desktop 图片页均提供生成/识别双 Tab；Desktop 服务中断后可明确重试并恢复原有引擎顺序，连续编辑任意引擎不会改变其展开状态，Tab 与设置内容列保持对齐。

---

## 3.106 AI 回复底部状态条体验优化（2026-08-20）

- **Priority / Status**: P1 / Delivered (2026-08-20).
- **Problem**: 
  1. AI 回复内容下方的执行耗时原先仅累加了 tool activities 执行耗时，未计入 LLM 推理、思考及通信时间，导致显示的耗时偏小，非用户从发送到回复完成的真实总耗时；
  2. Token 数量显示为完整大整数（如 `3632294 tokens`），过于冗长不易识别；
  3. 底部信息栏最右侧的模型标签显示了服务商前缀（如 `Cli Proxy API · Gemini 3.7 Flash High`），与输入框只展示模型名不一致。
- **Decision**:
  1. **端到端总时间计算**：`transcriptTurnSummary` 计算当前回复与其前置用户提问的时间戳差值作为总耗时，准确反映完整端到端轮次时长；
  2. **Token 紧凑展示**：`formatCompactTokens` 实现 `17k`、`1m`、`3.6m` 等标准紧凑数值展示；
  3. **纯净模型名称**：`modelShortLabel` 剥离 provider 命名空间前缀，仅显示纯净模型名称。
- **Acceptance**: 已交付。状态条显示端到端总时长、紧凑 Token 计数与纯净模型名；自动化测试 12/12 全部通过。

---

## 3.105 右侧 MiniApp 面板与全局滚动条细窄化统一（2026-08-19）

- **Priority / Status**: P2 / Delivered (2026-08-19).
- **Problem**: 
  - 右侧 Mini App（便签 Note、待办 Todo 等）运行在独立 iframe 沙箱内，此前未设置统一滚动条 CSS，在 WebKit / WebView 环境下显示为 15~16px 宽的灰底原生滚动条，与主应用内文件面板（ProjectFilePanel / FileViewer）及聊天窗口的 4~6px 细窄滚动条风格严重不一致。
- **Decision**:
  - Mini App 页面顶层 `html, body` 统一设置为 `height: 100%; overflow: hidden;`，完全由应用内部主体容器自适应滚动，杜绝 iframe 外部产生冗余滚动条；
  - 在 Mini App 共享基础样式基线及各内置小程序中统一注入细窄（6px）、透明轨道、半透明圆角胶囊滑块的滚动条定义，且自动适配明暗主题及锤子等特色主题。
  - Desktop 主应用同步将全局滚动条规范统一为 6px 细窄滑块。
- **Acceptance**: 已交付。Mini App 面板与文件面板/主聊天滚动条尺寸与美观度完全一致；`uiDesignBaseline.test.ts` 6/6 通过，版本号已递增。

---

## 3.104 Desktop 会话模型加载态（Hydration）与全局模型就绪状态解耦（2026-08-19）

- **Priority / Status**: P1 / Delivered (2026-08-19).
- **Problem**: 
  - 用户打开历史 Session 时，前端会异步从后端拉取该会话绑定的模型配置（水合过程）。由于 `ChatView.svelte` 的 `modelReady` 响应式依赖了 `!modelSelectionHydrating`，水合期间 `modelReady` 为 `false`，导致输入框上方短暂闪烁「未配置可用文本模型」警告横幅，造成用户困惑。
- **Decision**:
  - 解耦 `modelReady` 与 `modelSelectionHydrating`，`modelReady` 仅表达系统是否存在有效模型配置。
  - `modelSelectionHydrating` 独立用于禁用输入框、模型切换器及 `sendMessage` 竞态防护，不再触发全局缺失模型横幅。
- **Acceptance**: 已交付。切换历史会话时平滑加载，不再闪烁无模型警告；水合期间安全防护正常生效；自动化测试全部通过。

---
## 3.103 Note 小程序体验升级：锤子便签主题与卡片/列表双视图支持（2026-08-19）

- **Priority / Status**: P1 / Delivered (2026-08-19).
- **Problem**: 
  1. 用户希望为内置 Note 小程序添加主题切换功能，除默认现代风格外引入复刻自 Smartisan Note（开源版锤子便签）的拟真复古纸感设计。
  2. 需要支持卡片与列表两种视图布局，并对正文预览行数进行规范限制（卡片视图最多 5 行，列表视图最多 3 行），提升大量便签下的浏览与管理体验。
- **Decision**:
  1. **双主题支持与持久化**：
     - 默认保持原 Google Keep 极简卡片主题；
     - 新增锤子便签（Smartisan）拟真纸感主题（暖白纸纹背景、暖调便签纸、木棕与复古琥珀色主调、柔和投影及暗色模式兼容）；
     - 顶栏右侧提供主题切换按钮与徽标，配置持久化保存在 `localStorage` 中。
  2. **卡片 / 列表双视图切换与行数限制**：
     - 顶栏提供卡片/列表视图切换按钮与图标，持久化保存在 `localStorage` 中；
     - 卡片视图模式下正文预览限制最多 5 行（`-webkit-line-clamp: 5`）；
     - 列表视图模式下正文预览限制最多 3 行（`-webkit-line-clamp: 3`）。
  3. **版本升级与 i18n 完备**：MiniApp manifest 版本升级至 `1.5.0`，双语文案全覆盖。
- **Acceptance**: 已交付。多视图与双主题无缝切换并记忆；行数限制严格生效；单元测试全部通过。

---
## 3.102 审批等待挂起与异步恢复机制（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**:
  1. `ToolRuntime` 的 Broker 审批等待此前采用 5 分钟内联长轮询，且等待时钟直接计入外层工具的 300s 执行超时（如 `mcpInvoke` 嵌套 MCP 工具）；当用户在 5 分钟内未完成审批时，外层工具超时直接杀掉 Run，而审批卡片仍保持 pending。用户后续批准后无法唤醒已死 Run（Session `s-20260818-vtjv`）。
  2. 处于审批等待中的 Run 被取消时，未将请求状态更新为 `expired`，导致死 Run 的悬挂请求永远停留为 pending。
  3. 聚合审批请求创建的 Grant 强行绑定了包含聚合批次的 `actionFingerprint`，导致后续单次调用的指纹永远无法命中，使得用户选的「本会话允许」在后续调用中反复失效。
- **Decision**:
  1. **30 秒短握手窗口 + 干净挂起**：将 `ToolRuntime` 的内联审批等待缩短为 30 秒（`BROKER_APPROVAL_INLINE_WINDOW_MS = 30s`）。若用户在 30 秒内点击，则直接内联执行；若超过 30 秒，Run 干净挂起为 `waiting_for_approval` 状态并释放所有连接和租约，不再消耗工具超时。用户可在数小时或数天后随时批准。
  2. **异步恢复中枢 (`brokerApprovalResume.ts`)**：用户在 Web、Desktop 或 Channel 异步批准/拒绝后，自动改写上下文中的挂起 `toolResult` 并复用原 `runId` 发起恢复轮次，无缝继续任务。
  3. **终态管理**：Abort / 取消时通过 `ApprovalService.expireRequest` 将请求标记为 `expired`。
  4. **Grant 粒度修正**：非 write 类工具的 Grant 仅按 capability + actor + scope 匹配，彻底解决聚合卡片批准后后续调用无法复用的问题。
- **Acceptance**: 已交付。单元测试 39 项全通；SvelteCheck 0 错误；短窗口超时挂起、终态落盘与异步恢复验证无误。

---
## 3.101 统一审批中心全面重构与全能力白名单管理（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: 原 Host Bash 审批系统仅支持命令行操作，所有 SQL 检索强制限定 `WHERE capability LIKE 'bash:%'`，导致用户在 Auto/Sandbox 模式下审批通过的 MCP 工具调用（如 OpenConnector）、文件修改（`write`/`edit`）和应用插件操作无法在设置页查看、管理长期白名单和审计历史，且非 Bash 工具在审批弹窗中无法展示“本 Bot 一直允许 / 本项目一直允许”的持久化选项。
- **Decision**:
  1. **全动作分类推断与聚合存储**：`HostBashStore` 升级为通用审批存储层，根据 `capability` 前缀与 `action_json.type` 自动识别 `bash`（命令行）、`mcp`（MCP 外部工具）、`file_write`（文件修改）、`miniapp`（应用插件）四类动作，保留结构化 `payload`（`path`、`diff`、`parameters`）。
  2. **全量过滤查询与超时态支持**：移除所有 SQL `bash:%` 前缀硬编码，`listPending`、`listWhitelist`、`listHistory`、`hasAnyData` 支持按 `category`、`status`（支持 `expired` 超时态）、`approvalMode` 及关键词联合过滤。
  3. **持久化 Scope 解锁与通用审批 Prompt**：`toolRuntime.ts` 与 `approval.ts` 优化，根据 Tool Policy 的 `scopeOptions`（`["once", "session", "persistent"]`）为非 Bash 工具开放持久化选项（`approve_persistent`），并定制化格式化 MCP、文件修改与命令行的卡片内容。
  4. **统一 API 接口与全端升级**：新增 `/api/settings/approvals` 统一路由；Web 设置页更名为 `/settings/approvals`（「审批管理」），支持全部/命令行/MCP/文件/插件多分类过滤、彩色徽标与参数展示；macOS 桌面端 `HostBashSection.svelte` 同步升级分类筛选控制器与胶囊标签。
- **Acceptance**: 已交付。多分类审批记录完整落库与展示；长期白名单启停与删除生效；单测 104 项全通；Desktop `svelte-check` 0 错误 0 警告；`npm run build` 全量构建通过。

---
## 3.100 MD Preview 小程序新增「Macaron · 甜彩微排」主题与体验优化（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: 用户希望为 `md-preview` 内置小程序引入微排风格的排版结构，但不喜欢原站的亮黄色系，期望使用清新优雅的马卡龙色系，并优化主题记忆与上手体验。
- **Decision**:
  1. 新增 `macaron` 主题：提取微排的结构排版（H1 居中指示条、H2 居中下划线、H3 侧边粗线、阴影引用块、macOS 窗口代码框），配色采用马卡龙甜彩体系（薄荷绿 `#38A3A5`、蜜桃粉 `#FF9AA2`、香芋紫 `#9B89B3`、奶泡白 `#FAFDFB`、正文字色 `#243746`）。
  2. 增强渲染管线 `render.js`：支持 macOS 代码窗口控制栏注入与标题装饰，输出全部采用内联样式以兼容微信公众号粘贴。
  3. 主题切换器重构为右下角固定悬浮按钮（FAB），点击向上弹出主题选择菜单；增加 `localStorage` 主题持久化记忆与空状态一键加载全功能示例文章能力。
  4. 版本 bump 至 `1.1.1`。
- **Acceptance**: 已交付。主题切换流畅，样式在微信公众号编辑器完美内联；测试全绿，全量构建通过。

---
## 3.99 沙箱安全策略档位 UI 重构与体验打磨（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: 原沙箱严格程度配置使用简陋单轴滑块搭配 Emoji 字符串缩写（`🌐❌ · ✏️❌`），视觉层次差、信息表达晦涩且跨平台字符渲染不一致；修改下方细节后缺少直观的“自定义状态”视觉反馈与重置途径。
- **Decision**:
  1. 重构为包含 4 档交互式安全卡片矩阵（`锁定`、`只读`、`标准`、`全开`），每档配备专属矢量图标、级别徽标（`最高隔离`、`安全探索`、`推荐开发`、`完全信任`）、网络 / 文件 / 环境变量三维微型胶囊标签（如 `🌐 常用开发源`、`📁 可写项目`、`⚙️ 白名单环境`）与清晰说明文案。
  2. 卡片下方保留具备「最严格 🛡️ ➔ 最宽松 ⚡」两极提示的平滑轨道与步进刻度点，支持鼠标拖动、卡片点击与键盘左右箭头无障碍操作。
  3. 当用户在下方自定义微调策略时，优雅呼出「当前为自定义策略」提示卡片并提供「重置为标准预设」一键恢复能力。
  4. 桌面端与 Web 端（`/settings/sandbox`）全量对齐，严格遵循 `DESIGN.md` 与 AppKit 语义色彩系统，完美适配中英双语、明暗多主题与响应式栅格断点。
- **Acceptance**: 已交付。4 档卡片与滑条无缝双向联动；字体严格遵循 11px 下限规范；`desktop:check` 0 错误 0 警告；`chat-ui.test.mjs` 211 项测试全绿；`desktop:test` 全部通过。

---
## 3.98 Trace 活跃运行状态与 Runner 重试生命周期 Hook 修复（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: Trace 页面下方「正在执行」列表中堆积大量已结束的历史运行记录，显示为「未关联会话（orphan）」且耗时持续增长。根因是 Runner 遇到错误重试（Fallback / Retry）时，首轮 `agent_end` 过早触发 `finishHookRun()` 锁死完成标志，而次轮 `agent_start` 重新发射 `run.started` 将数据库状态重写回 `started`，最终完成时 `run.finished` 漏发，导致数据库事实永久处于 `started`。
- **Decision**:
  1. `runner.ts` 对 `run.started` 施加单次发射守卫；移除单轮 prompt 的 `agent_end` 对全局 `finishHookRun()` 的触发，确保仅在整个 Runner turn 真正结束时（`finally`）才发射带有最终状态的 `run.finished`。
  2. `SqliteTraceStore.upsertFact` 增加终态保护：处于 `success`/`error`/`aborted` 终态的事实记录禁止被非终态的 `started`/`waiting` 倒退覆盖。
  3. `SqliteTraceStore` 增加 `reconcileStaleOrphanRuns()` 并在 `/api/desktop/active-runs` 请求时即时对齐超时的非活跃孤儿记录为 `aborted`。
  4. 批量清理数据库中 125 条历史残留未终结孤儿记录。
- **Acceptance**: 已交付。多轮重试下 `run.started` / `run.finished` 严格只发射一次；终态记录不会倒退；历史孤儿记录已清零；`traceRecorderHook.test.ts`、`desktopTrace.test.ts` 及 `runner.test.ts` 全数通过。

---
## 3.97 macOS Desktop 运行历史多渠道聚合、Bot 筛选与分页体验优化（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: 桌面应用中打开「运行历史」时，界面无限卡在「正在加载…」且无法显示内容；后端仅硬编码扫描 Telegram（`moli-t`）工作区，桌面主会话（`moli-w`）、飞书、QQ、微信与项目的运行记录均无法被读取展示；历史记录过多时全部平铺在一个页面造成滚动卡顿，且缺乏按特定 Bot 快速切片筛选的能力。
- **Decision**: 
  1. 服务端 `reviewData.ts` 扩展 `listAgentWorkspaces`，全量扫描 `TASK_CHANNEL_ROOTS`（`moli-w`, `moli-t`, `moli-f`, `moli-q`, `moli-wx`）、`system/bots` 与 `projects/*/runtime` 并过滤系统保留目录。
  2. 前端 `RunHistorySection.svelte` 的 `$effect` 采用 `untrack()` 隔离，`runHistoryStore` 增加 `generation` 计数与 `refreshing` 状态，修复死循环；`#each` 采用复合唯一键避免重复 key 报错。
  3. UI 对齐 `DESIGN.md` Observatory 规范：顶部新增 Bot 原生下拉选择器（`SelectControl`）与搜索组合过滤；卡片底部新增客户端分页控制器（每页 10/20/50/100 条切换与翻页）。
- **Acceptance**: 已交付。桌面端可秒级加载并展示所有渠道的近期运行历史；支持 Bot 下拉选择、即时搜索与分页翻页；`reviewData.test.ts`、Desktop UI 测试及 `svelte-check` 均通过。

---
## 3.96 macOS Desktop Host Bash 审批与白名单管理设置页（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: macOS 桌面应用中缺乏独立的 Host Bash 管理与审计界面，用户无法在桌面端查看待审批命令、启闭或删除长期白名单，也无法审计历史审批记录。
- **Decision**: 在 `apps/desktop` 构建完整的 `HostBashSection.svelte`，并归入设置侧边栏「活动 (Activity)」分类下，接入 `/api/settings/host-bash`，提供统计卡片、分段视图标签、搜索与状态/模式过滤器、待审批清单、白名单管理（含 iOS 开关和删除确认）及历史记录审查。样式严格遵循 `DESIGN.md`，使用语义 CSS 变量适配所有主题。
- **Acceptance**: 已交付。桌面端可完整进行待审批查看、白名单切换/删除、历史记录筛选；支持多主题且无硬编码颜色；UI 单测、类型检查和全量构建均通过。

---
## 3.95 macOS Desktop 聊天滚动吸底与“回到最新”按钮状态修复（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: macOS App 聊天页面中，当用户滑到底部或点击“回到最新”后，浮动按钮不消失，且在 AI 回复生成时页面偶尔停止自动向下滚动。
- **Decision**: 优化 `stickToBottom.ts` 滚动状态机：放宽吸底亚像素判定阈值至 2px，触底区内的向上微移（`dist <= SETTLE_DISTANCE`）作为回弹保护不解绑跟随；`TranscriptDock.svelte` 点击按钮时显式调用 `resumeStickToBottom` 触发物理弹簧并重置跟随状态。
- **Acceptance**: 已交付。滑到底部与点击“回到最新”按钮均能正常消失；AI 流式回复自动向下滚动；新增 `stickToBottom.test.ts`，UI 结构测试与构建全数通过。

---
## 3.94 Web 聊天页面审批卡片 UI（2026-08-18）

- **Priority / Status**: P1 / Delivered (2026-08-18).
- **Problem**: Web 聊天中当模型或工具触发审批（如 `miniAppManage` 或非 Auto 模式下的 Host Bash 升级）时，后端 SSE 正确发送了 `host_bash_approval` 事件，但 Web 前端静默丢弃了该事件，导致用户在 Web 上无法看到审批按钮，任务等待 5 分钟超时失败。
- **Decision**: 在 Web 聊天页面（`src/routes/+page.svelte`）监听 `host_bash_approval` SSE 事件，在消息输出区渲染结构化审批卡片（包含工具名称、完整命令、原因说明），提供「拒绝」「本会话允许」「仅此一次」操作按钮；用户点击后直接调用 `/api/chat` 的 `/hosttools` 命令解决审批并自动刷新会话。
- **Acceptance**: 已交付。Web 页面正确接收并渲染审批卡片；点击操作按钮能调用 `/hosttools` 解决审批并继续任务；中英多语言与明暗主题自适应；构建与测试通过。

---
## 3.93 Project 自动任务（2026-08-16）

- **Priority / Status**: P0 / Delivered (2026-08-16).
- **Problem**: Runtime Task 目前只能绑定 Channel/Bot 或 Molibot 内部系统执行，无法原生进入 Project Runtime；用户不能让每日待办、邮件和工作进展总结稳定使用 Project root、工作规范、Skills、Memory、模型、Sandbox 与独立运行上下文，也无法保证结果只留在 App。
- **Decision**: Project 成为现有 `periodic` Runtime Task 的一级执行目标，不新增任务类型、数据库或调度器。任务继续落 watched event JSON、复用现有 `fresh` Session 语义与执行租约；调度和“立即运行”共用共享 Project executor，执行时读取 Project 当前配置，结果只持久化到 App 可读取的 Project Runtime/执行记录，零 Channel 出站。Desktop 自动任务增加 Project 分类；Project 设置增加 General/Automations Tabs，并复用同一 CRUD、计划构建、历史和 transcript 展示。
- **Acceptance**: 已交付。Project watched event 与“立即运行”经同一 dispatcher 和执行租约进入 Project Runtime，附着 fresh archive Session 并按 runId 读取 transcript；Web executor 只作为本地 Runtime driver，不产生 Bot/Channel 出站。临时 dataDir API CRUD/发现/触发、Project 路由与隐藏 automation Session、target 守卫、全局与 Project 双入口、中英 UI、类型检查、结构测试和生产构建已通过。
- **Detailed PRD**: [Project 自动任务 PRD](docs/requirements/project-automations-prd.md).

---
## 3.92 Agent 图像生成动态自定义引擎（2026-08-16）

- **Priority / Status**: P1 / Delivered (2026-08-16).
- **Problem**: `imageGenerate` 已支持多个内置引擎，但接入新的 OpenAI-compatible 图像服务必须改代码；不同服务还可能分别使用 `images/generations` 或 `chat/completions`，协议不能在引擎创建后漂移。
- **Decision**: Web 与 Desktop 设置页允许创建多个自定义引擎，创建时一次选择协议并以只读字段展示；共享设置 sanitizer、SQLite round-trip 和 Desktop credential-safe projection 共同维护引擎集合、凭据和协议不变性。Agent 根据已保存协议选择通用 provider，`auto` 继续作为保留路由哨兵而不是可注册引擎。
- **Acceptance**: 已交付。可添加/启用/测试/设为默认/删除多个自定义引擎；两种协议请求路径和结果解析均覆盖；协议修改被共享层阻止；删除后不被 fallback 复活；重启后名称、协议、端点、模型和 key 保留；中英、明暗、窄宽设置面板与固定保存底栏保持可用；聚焦测试、类型诊断、生产构建和 Desktop UI 检查完成。

---
## 3.91 Mini Chat 轻量对话小程序（2026-08-14）

- **Priority / Status**: P0 / Delivered (2026-08-14).
- **Problem**: 临时问答若进入完整 Agent Runtime，会携带长系统提示词、Profile、记忆、Skills 与工具定义；这些能力在短对话中无用，却增加 token 成本与延迟。普通 Agent Session 又把临时聊天混入 Agent 的长期会话语义。
- **Decision**: 内置可选安装的 Mini Chat 使用 Astryx `ai-chat` UI；小程序以独立 SQLite 管理 Session，Host AI Facade 增加结构化 `chat(messages)`、`listTextModels()` 与 `onTextDelta`，通过 Pi 模型路由与用户现有凭证直调模型，但不调用 Agent Runner。Mini Chat 默认不传 `system`，允许用户在小程序自有设置中选择文本模型并显式填写一段简短 `system`；模型发现不暴露凭证，manifest 不暴露 Agent tools；文本调用固定使用 `low` reasoning；文本增量跨子进程进入小程序内存并由页面读取，完成结果一次持久化；停止操作以 AbortSignal 跨子进程取消 Provider 请求；Provider 错误经限长和凭证脱敏后返回界面并写入运行日志。窄屏 assistant 消息不保留无信息量的 initials 头像列，metadata 与正文对齐，隐藏侧栏无投影泄漏。
- **Acceptance**: 能创建、切换、删除并在重启后恢复独立会话；删除操作在 iframe 禁止原生 modal 的环境中仍能通过应用内确认对话框完成；多轮请求只包含交替的 user/assistant 历史且不存在默认 system prompt，只在用户填写时带上 Mini Chat 自有 system prompt；可选择已配置文本模型或恢复跟随默认，选项和提示词在重启后保留，显式选择必须按请求优先于全局 `textModelKey` 并路由到所选 PI/自定义模型；回复在模型生成期间逐步显示，最终持久化内容与增量拼接一致；支持 Markdown、复制、停止、错误收据与重试；请求使用 `low` reasoning，失败时能看到可用于调整模型/Provider 配置的安全错误说明；中英、明暗/系统主题及窄宽度可用，assistant metadata 与正文左对齐，390px 下无头像占位、隐藏侧栏投影或横向溢出；小程序图标在 24px 尺寸保持双气泡识别度，与其他内置小程序共享彩色分层风格；内置安装、Session/设置持久化、历史边界、流式/错误/取消/模型选择链路、类型检查和生产构建通过。

---
## 3.90 Desktop Chat 连续工具聚合与动作摘要（2026-08-14）

- **Priority / Status**: P1 / Delivered (2026-08-14).
- **Problem**: 第一阶段恢复了真实顺序并合并工具开始/结束生命周期，但读取多个文件、连续修改或连续搜索仍逐行占据时间线。真实任务中这些重复成功记录会压过思考与最终回答，用户必须逐条翻译内部工具名才能理解 Agent 完成了哪类工作。
- **Decision**: 在共享时间线增加纯展示投影，只聚合相邻、成功且语义明确的读取、修改、搜索、命令调用；摘要使用动作、唯一文件数/调用数和耗时。组内保留原始活动与 payload，运行中、失败、未知工具独立展示；聚合不跨越思考、过程文本或动作类型边界。
- **Acceptance**: Chat 与 Project Chat 对相邻同类成功调用显示一个可展开动作摘要；展开后原始顺序和详情完整；错误与当前动作无需展开组即可看到；聚合不改变存储或生命周期数据；中英文、明暗、窄宽度、结构/单元测试、类型检查、生产构建与冷启动路径通过。

---
## 3.89 Desktop Chat 扁平执行时间线（2026-08-14）

- **Priority / Status**: P1 / Delivered (2026-08-14).
- **Problem**: 实时思考默认折叠，工具调用的开始/结束容易表现为两条记录；完成态又叠加过程、工具组和单条 payload 三层 disclosure，用户无法像 Codex 一样扫读“正在做什么”，也难以从摘要判断实际工作量。同名并行工具还依赖工具名倒序配对，存在串线风险。
- **Decision**: 以运行时 `toolCallId` 作为工具活动唯一 key；Chat 与 Project Chat 共享一层 `TurnProcess` 和扁平 `ProcessTimeline`。执行中强制可见，成功后默认折叠，失败/中断展开；思考、过程文本、工具行按到达顺序平铺，只有工具 payload 使用局部 disclosure。摘要只呈现耗时、工具数和修改文件数。
- **Acceptance**: 同名并行工具开始/结束准确归并为各自一行；实时思考和当前工具无需点击即可看到；成功回答保持视觉主位；失败行与错误 payload 自动可见；中英文、明暗主题、窄宽度、结构测试、类型检查、生产构建与冷启动路径通过。

---
## 3.88 Desktop AI 服务商模型按名称前缀归组（2026-08-14）

- **Priority / Status**: P1 / Delivered (2026-08-14).
- **Problem**: 设置 → AI 服务商的模型列表按模型名的前两段连字符片段分组，`gemini-3.5-*` 与 `gemini-3.6-*` 被拆成多个版本组，模型数量变多后难以扫描。
- **Decision**: 以模型标识最后一个 `/` 后的名称为准，按第一个 `-` 之前的前缀生成组键；模型列表和发现模型弹窗共用同一规则，不改变模型 ID、排序、搜索、添加或折叠行为。
- **Acceptance**: `gemini-3.5-*` 与 `gemini-3.6-*` 同组显示为 `gemini`；无连字符模型保持自身名称为组名，空模型继续进入本地化“其他”组；Desktop 结构回归、类型检查和生产构建通过。

---
## 3.87 Desktop Chat 思考/工具调用实时顺序恢复（2026-08-14）

- **Priority / Status**: P1 / Delivered (2026-08-14).
- **Problem**: 有序 Chat timeline 把 text/thinking 追加到按类型分离的 16ms 帧缓冲，而工具/Plan 事件立即写入 `liveSteps`。同一帧内先到的思考会被后到的工具越过，thinking→answer 切换也会因固定 flush 顺序显示成 answer→thinking。
- **Decision**: 在共享 `ConversationController` 使用单一、按到达顺序的 chunk 队列；相邻同类增量仍合并以控制重绘，工具与 Plan 是必须先 flush 的显式顺序边界。服务端 SSE 与历史 `steps` 投影保持原样。
- **Acceptance**: Chat 与 Project Chat 的实时 thinking/text/tool/Plan 顺序等于事件到达顺序；工具结束更新原位置而不重复；完成并 reload 后顺序保持；controller 回归、历史投影测试、Desktop 全量测试、类型检查、构建与冷启动走查通过。

---
## 3.86 Meeting Notes 生产化 V1（2026-08-14）

- **Priority / Status**: P0 / Delivered (2026-08-14).
- **Problem**: 草稿实现由 iframe 直接录制 60 秒文件，关闭面板即中断；一小时会议依赖长音频与最终一次性总结，无法实时看到内容，也没有停止屏障、缺片证据或可靠恢复。
- **Decision**: V1 先交付线下面对面麦克风，但从第一天采用 `source adapter → track → 10s chunk → utterance timeline → rolling notes → hierarchical final notes`。设备生命周期和有界磁盘队列归 Desktop 宿主，Meeting Notes 只持有领域状态与 UI；独立 `host.audioCapture` capability 由 manifest 声明，并在 Panel 与服务入口两次授权。
- **Acceptance**: Panel 销毁后录音继续；一小时录音内存不线性增长；块上传幂等且确认后删除；最后序号 barrier、缺片、失败、重启孤儿恢复与旧草稿备份有机器回归；会中可见转写和每分钟临时纪要；最终总结不发送完整全文单 prompt；中英、明暗与窄宽度可用。Zoom/腾讯会议/飞书系统音频适配器继续为后续 P1，且不得改动下游领域模型。
- **Production fix (2026-08-14)**: 真实 10 秒 PCM 块经 Base64 JSON 后约 1.28 MiB，不能依赖 adapter-node 默认 512 KiB。Desktop 启动器必须在加载服务前设置有界请求上限，路由继续做更窄的音频大小校验；UI 与结构化日志必须区分上传、转写和总结失败。Meeting Notes `2.0.1` 已交付该修复。
- **Acceptance correction / `2.1.0` (2026-08-14)**: 首轮用户验收确认 `2.0.1` 仍不是可用产品：没有暂停/继续，历史只是活动页里的平铺列表，活动 capture 与 meeting 详情重复且状态来源分裂。验收口径修正为：原生同一 capture 支持多次 pause/resume；暂停边界落盘且有效时长停止；Live 与 History 是两个独立表面；历史可按标题/纪要/转写搜索、按日期浏览并进入/返回详情；活动会议不重复出现；服务重启后由宿主真实状态恢复未结束会议。上述能力已由 `2.1.0` 交付并纳入跨层机器守卫。
- **UI refinement / `2.2.0` (2026-08-14)**: Live 必须同时回答“是否仍在录音、麦克风是否工作、音频是否已安全保存”，而不依赖红色或工程术语；结束确认可用键盘撤销且不能被后台刷新关闭。History 提供数量、状态筛选和无竞态全文搜索；轮询不能覆盖用户正在编辑的标题。中英、明暗、减少动态效果与窄宽度共享同一交互层级。

---
## 3.85 Desktop 设置模型分组与 Provider 保存后即时刷新（2026-08-13）

- **Priority / Status**: P1 / Delivered (2026-08-13).
- **Problem**: 设置 → 模型的路由选择器仍把不同供应商平铺混排；同时，AI 服务商与模型页互斥挂载，Provider 保存时发出的同步事件没有模型页监听者，重新进入模型页又因 endpoint 未变化而跳过加载，导致新增模型保持旧列表直到重启或刷新。
- **Decision**: 扩展共享 Bits UI `SelectControl` 支持可选分组标题，并让模型页及 Mini App AI 的模型选项复用统一供应商分组。模型页每次进入都强制拉取最新模型与路由数据，不再依赖未挂载期间无法接收的 Provider 事件。
- **Acceptance**: 设置 → 模型的所有模型型选择器按供应商分组且每项单行；在 AI 服务商新增并保存模型后切回模型页即可看到新模型，无需重启或手动刷新；普通非模型下拉保持原样；回归测试、类型检查和生产构建通过。

---
## 3.84 Desktop Chat 模型选择按供应商分组（2026-08-13）

- **Priority / Status**: P1 / Delivered (2026-08-13).
- **Problem**: Chat 与 Project Chat 的共享模型菜单把所有模型平铺在一起，并为每个模型同时显示名称和技术标识；供应商多时难以扫描，双行条目也降低了可见密度。
- **Decision**: 按模型现有供应商信息稳定分组，保留供应商与模型的原始顺序；组内每个模型只显示一行别名或可读名称，完整技术标签保留在 tooltip，不改变路由 key、会话级选择、选中态或键盘导航。
- **Acceptance**: Chat 与 Project Chat 的模型页显示供应商标题和单行模型项；同供应商模型连续归组，长名称安全截断；中英文、全部主题和窄窗口继续可用；分组单测、UI 结构守卫、类型检查与生产构建通过。

---
## 3.83 Note live refresh and Markdown reading mode（2026-08-13）

- **Priority / Status**: P1 / Delivered (2026-08-13).
- **Problem**: Note only refreshed on window focus or document visibility changes. If the panel stayed open while an Agent wrote through the shared tool runtime, no event fired and the visible list remained stale. Card bodies also displayed Markdown as literal plain text.
- **Decision**: Poll the cheap shared Mini App revision every two seconds only while the panel is visible, and reload notes only when that revision changes. Render card bodies with the already-packaged `marked` library while suppressing raw HTML, images, and unsafe link protocols; keep the editor as raw Markdown.
- **Acceptance**: Agent writes appear in an already-open visible Note panel without navigation; failed reloads do not consume a revision or hide later recovery; headings, emphasis, lists, quotes, code, safe links, and GFM tables render in both themes and narrow widths; unsafe HTML/images/links stay inert; installed copies can detect the Note `1.4.0` update; focused tests and production build pass.

---
## 3.82 AI 自动会话标题总结（2026-08-13）

- **Priority / Status**: P1 / Delivered (2026-08-13).
- **Problem**: 新建 Session 发送首条消息时，原有逻辑直接截取前 40 字符作为标题，无法精炼出真实对话主题，影响历史会话识别。
- **Decision**: 新增后台异步提炼模块 `titleSummarizer.ts`。首条用户消息到达时，根据系统语言配置（`zh-CN` / `en-US`）在 `systemPrompt` 与 `prompt` 中注入对应的中文/英文提炼要求（含 `reasoning: "off"` 与超时保护），提炼为一句话总结标题。通过 SSE 事件 `session_title_updated` 实时推送到前端 UI 并动态更新侧边栏列表。
- **Acceptance**: 首条消息自动触发一句话总结；系统提示词准确注入当前语言要求；模型失败或超时无缝降级；单测与 E2E 验证通过。

---
## 3.81 Desktop 内置 Provider 独立检测与模型目录（2026-08-12）

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: 内置 Provider 被自建服务商接口复用，检测要求不存在的 `baseUrl`，模型拉取也尝试访问自建 `/models` 端点；因此像 OpenCode 这样的 Pi Provider 即使 API Key 已保存，也会在本地配置守卫处失败。
- **Decision**: 内置 Provider 统一走 Pi 的模型目录和 `streamWithPiRuntime`；设置中的 API Key 作为运行时覆盖传入。只有自建 Provider 继续要求 `baseUrl`、API Key 和自定义模型配置。
- **Acceptance**: 内置模型目录不依赖 Base URL 或外部 `/models` 请求；检测能发出真实最小请求并返回脱敏的上游结果；自建 Provider 既有路径不变；相关回归、Desktop UI、类型检查和生产构建通过。

---
## 3.80 D2 服务端渲染与中文表格预览（2026-08-12）

- **Priority / Status**: P1/P2 / Delivered (2026-08-12).
- **Problem**: AI 回复里的 Markdown 表格在预览链路中被当作二进制工作簿读取，中文 UTF-8 字节因此显示为乱码；D2 图表也缺少与 Mermaid 一致的预览入口和服务端渲染链路。
- **Decision**: 聊天表格统一交给 UTF-8 CSV viewer；完整 `d2` fenced block 由 Desktop API 调用服务端 D2 renderer（默认 Kroki，可由服务端环境变量改为自托管端点），校验输入/输出大小和超时，并通过安全的图片边界展示 SVG。渲染失败只影响当前图块并显示源码。
- **Acceptance**: 中文表头、单元格在 Chat Markdown artifact 中保持原文；D2 在 Chat、Project Chat 和 Markdown artifact 中能按明暗主题预览、切换源码、复制源码和放大；服务不可用时页面不崩；服务端和 UI 回归、类型检查、构建通过。

---
## 3.79 Todo list action overlay（2026-08-12）

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: Built-in Todo action buttons stayed in the row's flex layout even while transparent, permanently taking width away from long task titles.
- **Decision**: Position the action tray over the row's right edge, remove its flex reservation, and give the tray a theme-aware floating surface. Keep hover, touch, keyboard focus, and anchored menu behavior unchanged; bump the built-in Todo version to `1.7.0`.
- **Acceptance**: Todo titles use the full row width at rest; action buttons remain reachable and legible in Light/Dark, hover/touch, and keyboard states; layout regression and existing Mini App tests pass.

---
## 3.77 Desktop 独立明暗模式与主题家族（2026-08-12）

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: 旧主题控件把明暗状态与颜色风格绑在一个值里，无法让用户独立选择明 / 暗 / 跟随系统，也无法为 Rosé Pine、Catppuccin 和 Midnight 提供成对的亮暗变体。
- **Decision**: 用两个独立偏好和存储键实现 Brightness（`light` / `dark` / `system`）与 Theme family（`macos` / `rose-pine` / `catppuccin` / `midnight`）；新增 Dawn / Moon、Latte / Macchiato、Daybreak / Midnight token 对，并通过 `data-resolved-appearance` 统一驱动需要真实明暗状态的边界组件。
- **Acceptance**: 设置页在中英文、窄窗口和明暗模式下提供两个可访问控件；任意主题家族都能独立切换亮暗；侧栏保持半透明模糊并在无障碍/低性能路径安全降级；偏好重启后保留；API/UI、类型检查、生产构建和冷启动路径通过。

---
## 3.78 Desktop 消息菜单与文件面板主题统一（2026-08-12）

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: Assistant 消息底部的操作菜单向下展开，视觉上压到输入栏；右侧 File / Artifact Inspector 仍维护独立 Primer 明暗色板，新增主题家族切换后没有同步到当前家族。
- **Decision**: 给共享 `OverflowMenu` 增加向上 placement，Assistant 底部菜单明确使用该 placement；Inspector 保留仓库工作区结构，但所有 chrome 角色从共享 semantic tokens 派生，直接跟随 `data-theme-family` 与 `data-resolved-appearance`。
- **Acceptance**: 菜单向上展开且不改变布局流；文件面板在全部主题家族/明暗组合下与 Chat/Settings 使用同一组颜色语义；代码语法色仍复用共享 syntax tokens；UI 回归、类型检查、生产构建通过。

---
## 3.76 Desktop sidebar glass restoration（2026-08-12）

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: 主题切换改造后，Chat 和 Settings 侧栏的 WebView `backdrop-filter` 被关闭，Light / Dark / Midnight 的 tint 又过于不透明，导致原先的半透明、模糊视觉不再可见。
- **Decision**: 侧栏保留原生 macOS `sidebar` window effect，并恢复共享的 `blur(18px) saturate(160%)`；Light / Dark / Midnight 使用可见原生材质贡献的主题 tint，系统深色外观下显式深色 tint 透明。降低透明度、增强对比度和低性能模式关闭 blur 并使用 opaque surface。
- **Acceptance**: Chat / Settings 侧栏在四种主题中保持 edge-to-edge 的半透明模糊层次；无障碍和低性能路径不强制透明或模糊；UI、类型检查和生产构建通过。

---
## 3.75 Desktop Midnight theme（2026-08-12）

- **Priority / Status**: P2 / Delivered (2026-08-12).
- **Problem**: Desktop 的主题机制已完成 token 化，但切换器仍封闭在 `system/light/dark`，新增主题会被归一化为 System；需要一个真实的第四主题来验证 CSS、系统外观和第三方预览的闭环。
- **Decision**: 增加 `midnight` 主题，使用深蓝黑语义 token 和冷蓝紫强调色；原生 macOS windowState 映射为 dark，Chat/Agent City/Artifact/PPTX/Mermaid 等不支持自定义主题的边界统一映射为 dark appearance；显式 Midnight 排除 system-dark 媒体查询。
- **Acceptance**: 设置页可在中英文和窄窗口显示并切换 Light / Dark / Midnight / System；Midnight 重启后保持；全局 token、Agent City、Artifact Inspector、Markdown/PPTX/Mermaid 与原生窗口不出现浅色泄漏；API/UI/类型检查/生产构建通过。

---
## 3.74 Plan completion and read-only delegation reliability (2026-08-12)

- **Priority / Status**: P1 / Delivered (2026-08-12).
- **Problem**: `exitPlan` terminated its tool call but produced no ordinary assistant text, so the outer Runner classified a successful structured decision as an empty response and retried. Retry-split assistant rows then detached the persisted full Plan from the raw tool block, leaving an empty/default card above later content. Plan mode also removed `subagent` before inference, forcing large repository analysis through the main Agent despite the shared delegation policy.
- **Decision**: treat a `plan_proposal` event as a terminal structured completion; project the latest durable Plan once at the end of its user turn; keep proposed Plan cards last in the completed response section; expose a Plan-specific Subagent surface restricted to Scout/Planner with delegated Bash removed and reject all other roles before execution.
- **Acceptance**: one successful `exitPlan` ends without an empty-response retry or final error; retry-shaped history shows one complete Plan beside its confirmation controls at the bottom of the turn; substantial Plan analysis can create visible Scout/Planner activity; Worker, write/edit, and Bash remain unavailable through both direct and delegated paths; ordinary modes retain their existing roles; projection, transcript, Runner retry, tool safety, type, and build guards pass.

---
## 3.73 Desktop settings editor and cold-start reliability (2026-08-11)

- **Priority / Status**: P1 / Delivered (2026-08-11).
- **Problem**: several entity editors implemented their own fixed, scrollable form instead of the shared dialog contract, so sticky headings and footers competed with the form content. Skills, media tests, and Sandbox policy grids also exposed advanced controls too aggressively or produced unbalanced columns. Memory blocked its complete first paint on five datasets, while enabled MCP configuration was restored without reconnecting the live registry.
- **Decision**: use the shared Dialog, explicitly portaled to `body`, with one bounded `.entity-editor-body`; keep advanced Skill search collapsed; use balanced semantic settings grids; publish Memory summary independently from secondary datasets; reconcile enabled effective MCP servers from runtime cold start.
- **Acceptance**: Agent/Profile/Channel/MCP editors open in the centered top layer independently of list length or scroll position, retain visible actions while only their body scrolls; affected layouts adapt at narrow widths and both themes; Memory leaves loading state after its summary response; a restarted runtime attempts enabled MCP connections without requiring the MCP page; structural, type, build, and focused runtime guards pass.

---
## 3.72 Unified Chat code theme and compact reply metadata (2026-08-11)

- **Priority / Status**: P2 / Delivered (2026-08-11).
- **Problem**: Chat Markdown forced a dark code palette even in the light app theme, while the Artifact Inspector already followed GitHub/Primer light and dark roles. Completed replies also laid time, duration, tool/file/token totals, model, memory provenance, and actions onto one line, which collapsed when the Inspector narrowed Chat.
- **Decision**: make Chat Markdown and the Inspector consume one shared theme-aware syntax-token source. Keep reply metadata inline at normal message-column widths; when that actual column becomes narrow, merge technical metadata and Mini App contribution actions into one right-aligned ellipsis disclosure. Pointer-opened details close after leaving the complete trigger/popover region.
- **Acceptance**: Chat and Project Chat code blocks match the Inspector palette in light, explicit dark, and OS-following dark modes; syntax remains readable and locally scrollable; opening the Inspector switches the footer to one overflow without duplicate ellipsis buttons or a metadata wall; wide Chat retains inline metadata; the combined details expose model identity, turn totals, memory trace and contributed actions with pointer, keyboard, Escape and screen-reader semantics; structural guards, Svelte diagnostics, production build, and diff checks pass.

---
## 3.71 Compact Bot identity and bounded Project Session lists (2026-08-11)

- **Priority / Status**: P2 / Delivered (2026-08-11).
- **Problem**: the composer repeated `@`, avatar, full Agent name, and caret in a scarce horizontal row; sidebar Bot badges could collide on one bright colour; expanded Projects rendered every Session at once.
- **Decision**: reduce the composer Bot control to its initial while preserving the full accessible label and full-name menu. Use a small DESIGN.md-derived accent subset on low-opacity fills, assigning adjacent menu entries distinct slots. Remove the redundant trailing arrow from the adjacent permission-mode control while preserving its menu semantics. Project groups reveal Sessions in batches of 10 through the existing “More conversations” copy.
- **Acceptance**: draft selection and locked Sessions retain the same Bot routing; dropdown, outside-click, Escape, keyboard focus, bilingual labels and themes remain usable; different visible Bot options are distinguishable without saturated fills; Project group 11+ initially renders 10 and each disclosure adds at most 10; structural guards, Svelte diagnostics, production build, and cold-path UI walk pass.

---
## 3.70 Mermaid source access and zoomable preview (2026-08-11)

- **Priority / Status**: P2 / Delivered (2026-08-11).
- **Problem**: a successfully rendered Mermaid block hides the original diagram text, so users cannot inspect or copy it; larger diagrams are constrained to the message width with no focused inspection mode.
- **Decision**: use one shared Mermaid block across Chat, Project Chat, and Markdown artifacts. It defaults to Preview, exposes an always-visible Preview / Source switch and source copy action, and opens the sanitized SVG through the existing image zoom/pan viewer.
- **Acceptance**: each valid diagram can switch independently between rendered and selectable source views, copy its exact source, and expand for zoom/pan; failed diagrams keep their local source fallback; controls are bilingual, theme-safe, responsive, and structurally guarded across every rendering surface.

---
## 3.69 Mermaid failure layout containment (2026-08-11)

- **Priority / Status**: P1 / Delivered (2026-08-11), resolving Issue #32.
- **Problem**: Mermaid's default syntax-error path renders a large temporary SVG as a direct `document.body` child and throws before cleaning it up. Molibot caught the exception inside the message, but the orphaned renderer node remained outside the transcript and could displace the whole Desktop window until restart.
- **Decision**: every Svelte Mermaid renderer enables `suppressErrorRendering`; Molibot remains the only owner of the user-visible failure state and continues to show the localized note plus diagram source.
- **Acceptance**: malformed Mermaid produces no body-level renderer node and does not change the viewport/page height; valid diagrams still render; Chat and Artifact Markdown share the contract; a browser measurement and a guard over every Mermaid-importing Svelte component cover it.

---
## 3.68 Bounded message content overflow (2026-08-10)

- **Priority / Status**: P1 / Delivered (2026-08-10).
- **Decision**: the shared Desktop Chat/Project Chat transcript is vertically scrollable only. Prose and long paths wrap inside the 720px reading column; layout-preserving structures own a local horizontal scroller capped to their message width. Persisted explicit Skill references are semantic selectors, not prose: they render with the Skill invocation treatment and hide the authoritative local path from the visible message.
- **Acceptance**: opening the Project/File Inspector cannot make `.messages` wider than its client width; long prose wraps; tables, code, rendered math, diagrams, and diffs remain readable through their own horizontal overflow; `[$skill](.../SKILL.md)` shows a Skill card plus the remaining user request without displaying its path; browser layout measurement, pure classifier tests, and structural guards cover the contract.

---
## 3.67 Web Session sidebar shortcut (2026-08-10)

- **Priority / Status**: P2 / Delivered (2026-08-10).
- **Decision**: expose a compact new-Session action only on the Desktop sidebar's Web channel row. It calls the exact same `newConversation()` path as the primary “New chat” destination; Telegram, Feishu, QQ, and Weixin do not receive this action.
- **Acceptance**: the plus is an independent accessible button immediately before the disclosure arrow, follows Project's hidden-until-hover/focus interaction, does not toggle the Web accordion, preserves the row's compact layout in both themes and locales, and passes Desktop structural guards, `svelte-check`, and production build.

---
## 3.66 Completed-turn process disclosure (2026-08-10)

- **Priority / Status**: P2 / Delivered (2026-08-10).
- **Problem**: ordered Chat steps preserved the real run sequence, but completed turns left every reasoning and tool disclosure visible as separate rows, consuming most of the transcript before the final answer.
- **Decision**: after a turn commits, fold all reasoning, tool activity, and pre-tool narration before the final response into one lazy, default-closed process disclosure. Keep live runs expanded; force failed or aborted processes open; never hide a Plan decision card.
- **Acceptance**: the summary reports step count and duration when available; expanding restores the ordered detail; narrow width has no horizontal overflow; both locales, themes, structural guards, `svelte-check`, and production build pass.

---
## 3.65 Automatic Durable Execution 基础主链路（2026-08-10）

- **Priority / Status**: P1 / Partially delivered. Detailed scope: [Automatic Durable Execution PRD](docs/requirements/automatic-durable-execution-prd.md).
- **Delivered**: shared Agent-layer Durable Execution aggregate with dedicated `durable-execution.sqlite`; deterministic activation and per-request override; accepted Session Plan → deterministic multi-step Durable conversion; one-step-per-attempt continuation with run-detail evidence and Plan-card projection; versioned plan/step/criterion/attempt/decision/evidence/side-effect records; CAS and leases; watched-event JSON/runtime internal continuation; fresh hidden automation attempts; intent/receipt callbacks around non-pure tools; verifier-gated terminal states; cumulative token/attempt/lifetime guards; unfinished-task quota; creation-order queue position; shared one-shot catch-up handling with `recovery_required` on missed continuations; tiered structured model preflight with lazy promotion, executed-prefix absorption, and pre-handler termination; fail-closed queryable recovery; bounded, owner-scoped and explicitly untrusted evidence reads exposed to Durable attempts; persisted approvals with repeat counts and source-channel notifications; shared `/durable` short-handle actions; virtual Web profile routing to an active manager; Desktop transcript card, shared task inspector, sidebar projection, and terminal/waiting feedback.
- **Not yet release-complete**: the local OpenAI-compatible-provider Chat API + same-database restart seam now passes, but the complete cold-start/cross-channel acceptance matrix and equivalent external-provider live acceptance remain. Temporary-database, focused runner and channel tests cover the offline seam, authorization, evidence bounds, no-probe recovery and approval consumption; they do not replace those remaining gates.
- **Verification maintenance**: runner helper fixtures are typed against the canonical `RuntimeSettings` shape, keeping provider capability literals checked by TypeScript without expanding the product runtime surface.

---
## 3.65 Sandbox preset re-axing + Auto mode linkage (2026-08-17)

- **Priority / Status**: P1 / Planned.
- **Problem**: (a) sandbox presets are named observe/build/strict/custom — unreadable, not a single strictness axis; (b) Auto chat mode has zero linkage with the sandbox: users expecting "Auto = fully automatic" still hit host-bash approval cards escalated from sandbox network denials (`bash.ts:730`). Full relationship write-up: [Permission × Sandbox guide](docs/guides/permission-and-sandbox-modes.md).
- **Decision**: re-ax sandbox presets into a single 4-level slider (全开 Full Access / 标准 Standard / 只读 Read-Only / 锁定 Locked + Custom); Auto session mode auto-approves sandbox approvals and lifts the session's effective network policy to `["*"]` (manage-class tools still ask); add a global-lock toggle in the sandbox settings page that, when on, forces the preset across all channels with no session override; messaging channels keep the existing clamp to Accept edits.
- **Acceptance**: with sandbox preset = strict and chat mode = Auto, a network-touching bash command runs without any approval card and with network allowed (except manage-class); with global lock on, the desktop session mode selector cannot change the effective sandbox policy; preset detection round-trips after save/reload.

---
## 3.64 Session permission modes (Plan / Manual / Accept edits / Auto) (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-10). Slices 0–3 complete.
- **Full PRD**: [Permission Modes PRD](docs/requirements/permission-modes-prd.md).
- **Problem**: "要不要问用户" 和 "跑在哪个盒子里" today collapse into one boolean — `bashPolicy.ts:62` returns `allow` whenever the sandbox is off, `write`/`edit` are never gated at all, and `toolSandbox.filesystem.denyWrite` has no effect on the file tools (they use `createPathGuard`, not the sandbox config). There is no read-only planning state.
- **Decision**: add a session-scoped permission mode as a second axis, orthogonal to the sandbox. Four modes, strictly monotone: `Plan ⊂ Manual ⊂ Accept edits (default) ⊂ Auto`. **Bypass is explicitly not built** (product decision) — its use case is served by Auto plus an owner-scoped persistent grant. Tool classification gains an `effect` dimension (`read | write | execute | network | third_party | manage`); `risk` keeps only display/audit duty. `manage` (extension / Mini App install) asks in every mode, including Auto.
- **Acceptance**: a pure `decidePermission(mode, effect, containment)` with a full 4×6×containment matrix test; sandbox-off + Manual yields `ask`, never `allow`; `denyWrite` binds `write`/`edit` and `bash` identically; Plan is proven by asserting the tool list handed to the Provider excludes `write`/`edit`/`bash` (never by counting denials, pitfall #14a); automation leases never stall in `running`; settings round-trip and the desktop structural guards pass.
- **Delivered Plan slice**: pre-inference tool narrowing, structured `exitPlan`, artifact-backed editable checklist, shared DecisionCard, and same-Session Durable continuation without persisting a transient control instruction as an ordinary user message. The permission selector is independent from model selection and sits immediately after Attach in the composer.
- **Open**: automation's default behaviour (suspend-and-resume vs. fixed Auto with hard failure); whether Manual is exposed on messaging channels; whether third-party MCP `readOnlyHint` may relax a call.

---
## 3.62 Current work/life assistant capability status (2026-08-09)

- **Priority / Status**: P2 / Delivered (2026-08-09).
- **Single current source**: [Personal Assistant Capability Matrix](docs/requirements/personal-assistant-capability-matrix.md).
- All lower `prd.md` sections are design and delivery history. Their historical words such as planned, pending, or unresolved do not override the matrix and must not be used alone to generate tasks.
- The superseded session PRD is reduced to a redirect notice. `features.md` and `CHANGELOG.md` remain delivery logs rather than alternative status sources.

---
## 3.63 Desktop Chat/Settings navigation width unification (2026-08-09)

- **Priority / Status**: P2 / Delivered (2026-08-09).
- **Problem**: the macOS Desktop Chat navigation rail used a `260px` default while Settings used `228px`, making the same left navigation surface visibly change width between pages.
- **Decision**: make Settings' `228px` rail the shared desktop baseline and use one `170px` narrow-window token for both shells. Chat remains user-resizable, preserves saved widths at or above the baseline, and clamps stale narrower values to the baseline.
- **Acceptance**: Chat and Settings resolve to the same navigation track at desktop and narrow widths; CSS and runtime guards cover the shared baseline plus persisted-width clamping; Desktop UI, full Desktop tests, `svelte-check`, and production build pass.

---
## 3.61 DOCX/XLSX/PDF deliverable export (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09). PPTX export deferred; browser capability explicitly out of scope.
- **Problem**: ingestion alone cannot finish reports, workbooks, contracts, or summaries; a raw file write is not evidence that the artifact can be opened or contains the requested content.
- **Decision**: add deferred `documentExport`. DOCX/PDF accept bounded Markdown; XLSX accepts bounded, typed sheets. Outputs remain inside Project or Session scratch and are written atomically.
- **Acceptance**: DOCX is re-read with Mammoth, PDF with `pdf-parse`, and XLSX with SheetJS after the temporary file is read back from disk. Missing source text, wrong sheet/cell values, invalid extensions, path escapes, or oversized inputs fail before rename/attachment. CJK PDF generation uses packaged fonts. Targeted tests and production build pass.

---
## 3.60 Reminder and notification real-environment acceptance matrix (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: Runtime Task CRUD proved persistence but not end-to-end delivery, restart catch-up, offline honesty, or duplicate suppression.
- **Decision**: short-missed one-shot events are caught up within the existing window using a stable trigger slot; older events are skipped. Explicit `delivery=text` is one shared direct-delivery rule for every channel and task type. Telegram and Feishu reject when their transport is offline. A repeatable live probe creates watched events, updates them through formal CRUD, waits for scheduled delivery and a completed execution receipt, then deletes them.
- **Acceptance**: Desktop/Web, Telegram, and Feishu live chains pass create/update/trigger/receipt/delete. Deterministic guards cover restart recovery, missed-window expiry, offline transports, and duplicate completion suppression using temporary storage. Provider delivery errors remain visible and are never converted to success. Exact external delivery across the crash-after-provider-send/before-local-ack window remains at-least-once because Telegram/Feishu do not expose a shared idempotency key.

---
## 3.59 Mini App H2 final live gate (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09), completing §3.48's live evidence.
- **Acceptance result**: `node evals/run.mjs --id H2 --keep-data-dir` passed 1/1 in 280 seconds. `eval-water` exists under the isolated install root with manifest/server/UI files; the trace contains completed `miniAppManage` validate, install, and inspect receipts; model work continued after installation, proving service survival. Result: `evals/results/2026-08-09T07-49-11-671Z.json`.

---
## 3.58 Artifact Inspector PPTX read-only slide preview (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: `.pptx` files were still classified as `system`, so the right panel stopped at the external-app card even though the user expected the same in-app inspection path as DOCX/XLSX.
- **Decision**: register `.pptx` and the PowerPoint MIME type as a lazy `pptx` viewer. Fetch bytes through the existing authorized Project/session transport and render slides with the MIT-licensed `@silurus/ooxml` Canvas/WASM browser entry in a continuous, read-only slide desk.
- **Guardrails**: reject inputs above 50 MiB before parsing; pass archive entry, total inflated-byte, and entry-count limits to the OOXML parser; keep parser/WASM in a separate lazy chunk; disable external hyperlinks and Google Fonts; stale tab loads destroy their viewer; malformed/over-budget/render failures are retryable or non-blocking and never blank/freeze the panel. Legacy `.ppt` and unknown binaries remain SystemOpen fallbacks.
- **Acceptance**: extension/MIME registry tests pass; byte-window copy and size budget are covered; Project/Session branches mount the same viewer; `svelte-check`, Desktop UI tests, targeted artifact tests, and production build pass with PPTX parser/WASM emitted separately from the initial bundle.

---
## 3.57 Artifact Inspector DOCX read-only preview (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: `.docx` files were intentionally classified as `system`, so the right panel showed only the external-app card even though the server already had Mammoth-based DOCX extraction for the Agent.
- **Decision**: register `.docx` and the Word MIME type as a lazy `docx` viewer. Fetch bytes through the existing authorized Project/session transport, convert with Mammoth to Markdown, and reuse the existing sanitized Markdown renderer for the read-only document surface.
- **Guardrails**: external file access and embedded image resource loads are disabled; malformed documents enter a retryable error state; conversion warnings are visible but non-blocking; no Word layout-faithful editor, formula-like execution, or in-panel mutation is added. Legacy `.ppt` and unknown binaries remain SystemOpen fallbacks; PPTX is covered by §3.58.
- **Acceptance**: registry tests cover extension/MIME paths; a real DOCX fixture converts to Markdown; the viewer is reachable from Project and Session branches; Mammoth is lazy-loaded and the existing Markdown/DOMPurify path owns final rendering; `svelte-check`, targeted tests, full desktop tests, and production build pass.

---
## 3.56 Artifact Inspector XLS/XLSX table preview (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: the Artifact Inspector's existing table viewer only registered CSV/TSV. `.xlsx` files were classified as `system`, so the panel showed the unsupported-format card before any parser ran, even though SheetJS already powered the Agent's `docExtract` tool.
- **Decision**: register `.xls`/`.xlsx` and spreadsheet MIME types as a lazy `spreadsheet` viewer. Fetch bytes through the existing authorized Project/session transport, parse with the packaged SheetJS dependency, show every worksheet as a read-only table with sheet tabs and sticky headers, and keep the shared action bar for download/open externally.
- **Guardrails**: parsing/rendering is bounded to 5,000 data rows per sheet so a large workbook cannot freeze the WebView, reports truncation, never executes formulas, and rejects malformed workbooks into a retryable error state. The viewer is shared by Project files and Session attachments; legacy `.ppt` and unknown binaries remain system-open fallbacks while DOCX/PPTX are covered by §3.57/§3.58.
- **Acceptance**: registry dispatch tests cover extension and MIME paths; parser tests cover multiple sheets, duplicate values, empty sheets, and truncation; Desktop UI structural tests include both artifact scopes; `svelte-check`, production build, and targeted artifact tests pass.

---
## 3.55 Artifact Inspector Git change stats and synchronized diff gutters (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: the Project Changes list exposed only a status and path, so users had to open every file to estimate its impact. In the diff viewer, diff2html's absolutely positioned line-number cells were not anchored to the rendered diff's scroll coordinate space, so the gutter could remain visually fixed while the code moved.
- **Decision**: return `git diff HEAD --numstat -z` statistics with every Git status entry and render GitHub-style `+additions` / `−deletions` metadata beside each path; binary and unavailable counts remain explicit. Make the diff surface the containing block for diff2html's gutter so line numbers and code share one vertical scroll surface without replacing the maintained renderer.
- **Acceptance**: every Changes row shows additions/deletions or an explicit binary/unknown state; staged, unstaged, deleted, renamed, untracked, CJK, and spaced paths retain correct stats; line numbers move vertically with their diff rows in line-by-line and side-by-side layouts; light/dark Artifact tokens, list actions, and existing diff rendering remain intact.

---
## 3.54 Artifact Inspector source-list row status language (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: the Project file tree rendered an agent-touched marker as an extra grid child. The four-column row then created an implicit fifth grid row, so a size such as `5.5 KB` wrapped below the filename. The separate red/orange dot also duplicated the existing Changes surface and did not explain its meaning well.
- **Decision**: keep every file-tree row single-line and nowrap the size column. Remove the standalone touched dot. A touched file is identified by the filename's warning/attention color, matching Git's modified-file treatment; the Changes tab remains the detailed update surface.
- **Acceptance**: filename, icon, and size remain in one horizontal row at the Inspector's minimum width; touched files have no `.file-tree-touched` element; touched filenames use a semantic color in light/dark/system themes; selected/focused rows remain legible; existing tree, search, and artifact tests stay green.

---
## 3.53 Runtime Task CRUD and Mini App Todo isolation (2026-08-09)

- **Priority / Status**: P0 / Delivered (2026-08-09).
- **Problem**: watched events already powered reminders and automations, but the Agent only had a create tool; Event, reminder, notification, and todo terminology implied multiple competing resources. The optional Todo Mini App is a separate product domain and cannot be a dependency or source of truth for the base Runtime.
- **Decision**: make Runtime Task the sole user CRUD aggregate (`todo` unscheduled item, `one-shot` reminder, `periodic` automation), with formal create/list/get/update/delete through `runtimeTask`. Runtime Events remain trigger/execution occurrences and Notifications remain delivery outcomes. The watcher retains but never dispatches `todo`; immediate execution events and Molibot-managed system tasks are excluded from user CRUD.
- **Isolation**: Mini App Todo owns its database, CRUD, and rules. Runtime discovery and mutation never import or inspect Mini App Todo data; installing/removing the app does not alter Runtime Tasks. A future Mini App notification bridge must be an explicit narrow capability and must not synchronize records.
- **Acceptance**: Runtime Task CRUD works without any Mini App installed; stable task ids address reads/updates/deletes; an unscheduled todo requires no invented time and never triggers; one-shot and periodic validation is type-safe; Desktop opaque-id management accepts reminders as well as automations; immediate/internal events remain unreachable through user CRUD; prompt routing loads `runtimeTask` rather than writing event files.
- **Architecture**: [ADR 0003](docs/adr/0003-runtime-tasks-and-mini-app-todo-boundary.md).

---
## 3.52 Artifact Inspector JSON source-first viewer and freeze guard (2026-08-09)

- **Priority / Status**: P0/P1 / Delivered (2026-08-09).
- **Problem**: opening a JSON artifact immediately parsed and flattened the whole document on the WebView main thread. Large, deeply nested, or high-row-count JSON could make every right-panel button appear frozen, even though the user only wanted to inspect the original file.
- **Decision**: JSON opens in the existing `CodeViewer` by default, preserving the original text, syntax highlighting, line numbers, find, wrapping, and chunked loading. A visible “Parse as tree” action is the only entry into the structured view; the source/tree mode resets when the file or content changes. Tree parsing requires the complete file, keeps the existing 1 MiB byte ceiling, and stops at a 5,000-row budget. JSON Pointer-style path escaping keeps object keys containing `/` unique, while visible-row projection is linear in the flattened row list.
- **Failure posture**: invalid JSON, oversized JSON, row-budget overflow, and caught deep-recursion errors remain visible as a highlighted source view with a localized explanation. A partial Project preview disables tree parsing until the user loads the remaining bytes.
- **Acceptance**: opening a JSON file renders source without invoking `buildJsonTree`; the explicit action enters a bounded, collapsible tree; “View source” returns to the exact source viewer; large/deep documents cannot permanently block panel controls; JSON tree unit tests, Desktop UI structural tests, `svelte-check`, and production build pass.

---
## 3.51 Untrusted runtime process fault isolation (2026-08-09)

- **Priority / Status**: P0 / Delivered (2026-08-09).
- **Problem**: Mini App and Pi extension code shared the service process. Exceptions were catchable, but explicit exits, native aborts, OOM, and synchronous loops could kill or freeze every Agent/channel. A Promise timeout in that same event loop was not a fault boundary. Async tool handlers could also ignore cancellation forever.
- **Decision**: run each Mini App in its own bounded child process; run installed Pi extensions in a dedicated extension child process; expose only serializable IPC contracts and explicit AI/badge/log bridges. Abort, deadline, and abnormal exit kill the process group and invalidate the runtime. Add a shared final deadline to `ToolRuntime` for asynchronous non-settling handlers.
- **Acceptance**: a fixture calling `process.exit` or entering `while(true)` cannot terminate/block the test host; the Mini App can be called successfully after automatic reconstruction; a crashing extension tool cannot terminate the service-side test; a never-settling async tool returns a typed timeout; existing Mini App and extension bridge behavior plus production build remain green.
- **Boundary**: fault isolation is not a permissions sandbox. Pi extensions currently share one extension process, so one crash temporarily invalidates all extensions but never the service. Trusted built-in synchronous code remains in-process and must be fixed as a service bug.
- **Architecture**: [ADR 0002](docs/adr/0002-untrusted-runtime-process-boundaries.md).

---
## 3.50 Artifact Inspector file-type icons (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: the GitHub-style Inspector deliberately made every file glyph neutral, which removed the fast visual recognition users expect from a repository tree.
- **Decision**: reuse the existing Phosphor file glyph family and add one shared filename/extension resolver with `--file-color`. Special repository files win over generic extensions; unknown files stay neutral; no remote icon API or new runtime dependency is introduced.
- **Acceptance**: tree rows, search hits, open tabs, Session files, and the system card agree on icon and color; selected/dirty/touched/error states remain distinguishable; Light/Dark themes keep the same type identity; offline startup has no icon fetch.

---
## 3.49 Memory: write path and read path disagree on what is retrievable (2026-08-09)

**统一收口（已交付，2026-08-09）：** 无结构个人记忆不再默认写入 `chat:`，而是按 domain 统一落到 `owner:`（Project 内落 `project:`）；`content:` 只承载已发布内容，`agent:` 只承载 Agent 自身知识。新增整轮留存策略并贯穿 Agent entry、UI metadata、会话索引、跨渠道 transcript、自动 flush、每日 reflection 和记忆工具写入口：`standard`、`no_memory`、`not_searchable`、`turn_only` 的能力矩阵见 [ADR 0001](docs/adr/0001-memory-namespace-and-turn-retention.md)。删除保持为必须指定目标的独立操作，不再与“不记忆”混称。存量 namespace 不迁移。

**`add_content` 误路由已关闭（已交付，2026-08-09）：** `add_content` 的工具说明现在明确限定为“用户已发布内容语料”，并强调它永不参与普通对话召回；工具层只接受显式 `type=world_knowledge`，缺失类型或任何个人事实/偏好类型都会失败并要求改用 `action=add`。不把 `content:` 放进日常读取集，也不静默重路由，从而保持 namespace 的真实语义并让模型错误可见。回归覆盖个人事实、有意省略类型、合法发布内容及普通 `add` 路径。

现象：eval C 组（C1 偏好、C2 语言、C3 纠错）在干净环境里 0/3。挖下去发现不是一个 bug，而是「写进去的东西，日常对话读不到」这一类问题的两个独立实例。两者都会让写入侧和读取侧各自报告成功。

**（一）已修：无结构 `memory add` 同时落在读不到的类型和读不到的 namespace 上（两个杠杆）。**
- `memory` 工具的 `add` 动作既不带 `type` 也不带 `subject`，所以绝大多数「顺手记一下」走的是默认路径，而 `buildMoryWritePlan` 对这条路径原来给了两个都偏离日常读取的默认值：
  - **类型** 原为 `task`。读取侧两条路都把 `task` 排除在日常之外：(a) `moryPlanner` 的 `chat` intent（普通一轮的默认 intent）只查 `user_preference | user_fact | event`，而 `memoryTypes`/`pathPrefixes` 在 `moryRetrieval` 里是硬 SQL 过滤不是排序权重——不在集合里就不进候选池；(b) 注入 prompt 的 `profileBuilder` 把 `task` 只放进受时间窗约束、且要求 `chat:` namespace 的 `currentFocus` 桶，`user_fact` 则无条件进更稳的 `profileFacts` 桶。
  - **namespace** 原为 `chatNamespace(scope)`＝`chat:<bot>:<channel>:<externalUserId>`，是每渠道每用户独立的。它虽在 `promptMemoryNamespaces` 里，但一旦换渠道/换会话 key 就换了一份，天然不跨会话共享。
- 修复（两处一起改，都在 `buildMoryWritePlan`）：类型走新的 `defaultMemoryTypeForLayer`（长期 `user_fact`、每日 `event`，都在上述读取路里），path 前缀从同一个 `type` 派生（原来 `task`/`event` 硬编码，type 与 path 不一致会两头都被过滤）；namespace 改走 `namespaceForDomain(scope, domain)`，个人域即 `owner:owner`——它是 `promptMemoryNamespaces` 的第一项、跨所有渠道/会话共享，正对「跨会话记住」。
- 取舍：把无结构记忆默认放进 `owner:owner` 意味着任意一处随口记的东西会对该 owner 全局可见。对「单用户、本地优先的个人助理」这是符合定位的默认；若将来要区分「某个会话内的临时记忆」，需要显式类型/namespace 而不是回退到窄默认。
- 守卫：`moryCore.plan.test.ts` 断言默认写入类型 ∈ 普通一轮的检索计划、默认 namespace＝`owner:owner`、path 前缀与 type 一致，均不依赖线上模型。C 组现在 4/4。

**（二）已修：`add_content` 写进一个日常读不到的 namespace。**
- C3 最初红时，模型选的是 `add_content` 而不是 `add`。证据：临时 `DATA_DIR` 的 `memory_nodes` 里确实有更正后的记录（`l0_title`＝「常用的笔记工具是 Obsidian（已弃用 Notion）」），但 `user_id` 是 `content:personal`。
- 而 `contentNamespace` 只有在 `deriveMemoryAccessScope({ includeContent: true })` 时才进授权集，`promptMemoryNamespaces()` 从不包含它——`add_content` 对普通对话是只写不读的。
- 这是 pitfall 19 家族的变体：弱模型把「记一条个人事实」误路由到本为「已发布内容去重」设计的 `add_content`。C3 现在能过，是因为这几次模型改用了 `add`+`update`；换成 `add_content` 会再次静默失败。
- 采用边界最清晰的方案：保留发布内容能力，但收窄工具描述并在执行层强制 `type=world_knowledge`；个人事实、偏好和缺省类型全部拒绝并指向 `add`。不扩大普通对话授权读取面，也不把模型的错误选择静默改写成另一类操作。

**存量数据仍然分裂（两者的共同背景）：** 真实库 `~/.molibot/db/mory.sqlite` 的 1229 行分布在 11 种 `user_id` 形状上——`telegram::7706709760`（1167，`domain` 为 null）、`chat:momo_body_bot:telegram:7706709760`（29）、`owner:owner`（13）、`content:momo_body_bot`（1，`domain` 竟是 `owner|project|agent_self|content` 拼接串）等。（一）只改了新写入的默认类型，没有迁移这些历史行；是否迁移/兼容读需单独决定。

补充症状：eval E2（换会话后不该记得的临时编号）在多次运行之间来回翻。它和 C 组是同一条会话/记忆边界的两个方向，说明边界本身缺少确定性，值得连带排查。

优先级：P0（记忆优先是核心定位）。新写入、工具路由与留存语义已落地并有机器守卫；存量 namespace 明确不迁移。

## 3.48 Mini App install through the Agent appeared to kill the service (2026-08-09)

**已解决（2026-08-09）：** H2 的原始现象不是服务崩溃。`miniAppManage` 作为 critical 工具创建了 Broker 审批请求，但 Desktop 的统一审批卡接口只查询/解决 `hostBashStore`，无法解决同一张卡所代表的 Broker 请求。运行时因此等待完整五分钟；随后 Node/Undici 的 response-headers timeout 把 `/api/chat` 报成 `fetch failed`，eval 的 `finally` 再终止它自己启动的服务。数据库里保留的 `builtin:miniAppManage / pending` 请求、约 300 秒的固定时长、`serviceExit: null` 和没有 crash report 都与这条链一致。

- 根修审批链：Desktop `list_pending` 现在合并当前 Session 的 Host Bash 与 Broker 请求；`resolve_approval` 可按同一个 `requestId` 对 Broker 执行 once/session/persistent/reject，并严格拒绝跨 Session 请求。H2 以显式 `auto_approve: true` 通过真实 Desktop API 选择「仅此一次」，不修改生产风险策略，也不提供隐式免审批通道。
- 同时修掉一个真实但并非本次 300 秒现象主因的故障域漏洞：`miniAppManage.validateBuild()` 曾通过 `importModule` 测试 seam 把 scratch 候选模块动态载回服务进程。现在候选 validate/smoke 与正式运行统一走每 App 子进程；Agent 工具入口的 `process.exit(73)` 回归证明候选只会终止自己的进程。完整边界见 §3.51 / [ADR 0002](docs/adr/0002-untrusted-runtime-process-boundaries.md)。
- 机器守卫：(1) `desktopApprovals.test.ts` 覆盖当前 Session 列表、四种决策与跨 Session 拒绝；(2) `evals/client.test.mjs` 用并发假服务证明 `auto_approve` 读取卡片的 `requestId` 并调用真实同形 API 后原 turn 才完成；(3) `miniAppManage.processIsolation.test.ts` 锁住安装入口故障域。
- Provider/eval 路径也完成根修：Web Chat/Stream 未传思考等级时保持“无覆盖”，由 Runtime 默认值接管，不再被请求解析器强制改成 `off`；自定义 Subagent 按模型 `supportedRoles` 声明 developer-role 兼容性；eval 使用 15 分钟 Undici headers/body timeout，长任务不再被 Node 默认 300 秒响应头超时截断。
- live 证据：单独 H2 首次复跑 1/1（258 秒）；修正传输超时和 Subagent 角色映射后的受影响回归 C1/C4/D1/D2/H2 为 5/5，H2 用时 429 秒且 `serviceExit=null`。结果分别见 `evals/results/2026-08-09T06-16-48-064Z.json` 与 `evals/results/2026-08-09T06-53-55-944Z.json`。
- 优先级：P0 / Delivered。

## 3.47 Agent capability breadth: fetch, documents, calendar (2026-08-09)

- 背景：2026-08-09 的能力盘点结论是「深度够、宽度不够」。除 `bash` 与 MCP 之外，Agent 对外部世界几乎只读，且读不全。
- P0-1 `webFetch`（已交付 2026-08-09）：Agent 可按 `url + prompt` 读取公开 HTTP(S) 文本页面，HTML 转 Markdown，并复用 pitfall 27 的共享截断预算。实现同时限制 URL、超时、响应体、重定向和 15 分钟缓存；阻断凭据 URL、本机/内网/高风险保留地址，兼容公网域名经本机代理映射到 DNS fake-IP 的环境，跨域跳转要求再次显式抓取。认证页与 PDF/图片等二进制仍归后续专用连接器/文档摄入能力。
- P0-2 文档摄入（已交付 2026-08-09）：新增独立延迟工具 `docExtract`，从工作区 PDF、DOCX、XLSX 提取可读文本/表格；`read` 遇到这三种二进制会明确路由到它。PDF 使用 `pdf-parse` v2，DOCX 使用 Mammoth 且关闭外部文件访问，XLSX 使用正式随包的 SheetJS 0.20.3。输入及 symlink 真实目标限制在工作区和 50 MiB，Office 解包另有限额；输出复用 pitfall 27 的共享行/字节预算、UTF-8 单行回退和全文落盘。eval B2 已换成答案不以明文存在的 FlateDecode 压缩流 PDF，并要求 trace 中真实调用 `docExtract`；真实 Agent eval 通过。
- P0-2a 通用视觉/OCR（已交付 2026-08-09）：新增 `imageAnalyze(path, prompt?)` 延迟工具，覆盖 OCR、截图、票据、图表与通用图片分析。Agent 不直接指定模型，统一走当前 Agent 覆盖后的 `visionModelKey`，再跟随全局配置；入站图片 fallback、工具分析和 PDF OCR 复用同一共享视觉模块。`docExtract` 的 PDF OCR 支持 `auto/force/never`，auto 只处理低文本且含图片的页面，单次最多 20 页并串行调用。后续若真实 eval 证明复杂版面准确率不足，再评估专用版面/OCR模型，不预先引入第二套 Provider 配置。
- 外置能力边界：日历、联系人、邮件不进入 Runtime 内置能力；后续通过 Skill / MCP / Connector 按需集成。Runtime Task 只管理 Agent 自己的 todo、提醒与自动化，不冒充用户的日历或邮箱。
- P1：无头浏览器；第一方待办账本；xlsx/docx/pdf 导出。
- 验收：以 `evals/` B 组转绿为准。

## 3.46 Artifact Inspector GitHub / Primer workspace (2026-08-09)

- **Priority / Status**: P1 / Delivered (2026-08-09).
- **Problem**: the right-side File / Artifact Inspector still read as a lightly styled macOS file panel, while file browsing and previews needed the stronger information hierarchy of a real code workspace.
- **Decision**: keep the existing narrow Inspector seam and vertical resizable split, but restyle its complete surface as a GitHub/Primer repository workspace: neutral canvas, inset tree, opaque editor surface, flat tabs, path header, semantic light/dark tokens, and GitHub-like syntax/diff colors.
- **Acceptance**: files, changes, attachments, search, downloads, source toggles, viewer tabs, and resizing keep their existing behavior; all viewer types share the same surface grammar; selection/focus remains visible without shadow-only cues; Artifact colors remain scoped away from Chat and Settings.

---
## 3.45 Desktop Artifact Inspector design alignment (2026-08-08)

- **Priority / Status**: P1 / Delivered (2026-08-08).
- **Problem**: the right-side File / Artifact Inspector still mixed monospace filenames, extension-specific icon colors, elevated segmented controls, and a narrow-screen width floor that disagreed with the shared layout contract.
- **Decision**: apply the `DESIGN.md` source-list/detail language: system UI typography for human-readable names, monochrome file glyphs, compact 8px/6px segmented controls with tonal + border selection, semantic attachment filter state, and the shared 300px Inspector minimum.
- **Acceptance**: filenames remain readable at normal density, status colors are reserved for status, selected controls remain distinguishable without shadow, `aria-pressed`/`aria-selected` expose state, and the File Inspector keeps its grid seam in narrow layouts.

---
## 3.44 Mini App install/update hot activation (2026-08-08)

- **Priority / Status**: P0 / Delivered (2026-08-08).
- **Problem**: install and replacement refreshed only the on-disk catalog. The live Host retained the old Runtime, while Node's ESM cache also retained the entry module and its relative imports, so the new code could not run until the whole service restarted.
- **Decision**: make installation success mean activation success. The shared Host drains in-flight calls, disposes the previous Runtime, refreshes discovery, bundles the complete server module graph into a content-addressed ESM cache, imports it under a fresh activation URL, and eagerly creates the enabled Runtime. Desktop, built-in updates, and Agent `miniAppManage` all call this same lifecycle method.
- **Acceptance**: a newly installed app is callable in the existing Host; a same-version replacement runs changed entry and child-module code immediately; old Runtime `dispose()` runs before replacement; app-local packages remain resolvable; disabled apps remain disabled and unexecuted; data is untouched; API/UI contracts contain no restart-required state; an enabled app's activation failure is returned by the install/update request instead of becoming a delayed first-use surprise.

---
## 3.43 Target-accurate dynamic MCP loading (2026-08-08)

- **Priority / Status**: P1 / Delivered (2026-08-08).
- **Problem**: explicit Reconnect reused a background reconciliation path that absorbed connection errors, so the API could report success while the target remained in Error. Agent `loadMcp` judged success from the aggregate connected count, allowing another healthy MCP to mask the requested server's failure.
- **Decision**: keep background save/enable reconciliation failure-tolerant, but make explicit Reconnect require the target to finish Connected. Return workspace-scoped per-server statuses to the Session loader and judge the requested server id directly; preserve its selection after failure so retry requires no restart or reconfiguration.
- **Acceptance**: saving/enabling immediately attempts connection; explicit reconnect rejects with a credential-safe target error; server B cannot report loaded because server A is connected; successful load refreshes current Runner tools in the same turn; disconnect recovery and cross-Session isolation remain green.

---
## 3.43 Telegram / Feishu queued-message control buttons (2026-08-08)

- **Priority / Status**: P1 / Delivered (2026-08-08).
- **Problem**: when a second message arrived during an active Agent run, Telegram and Feishu persisted it correctly but exposed only command instructions (`/stop`, `/steer <queueId>`). On mobile this required copying an ID and typing a command even though the intended action was already unambiguous.
- **Decision**: attach Stop and Steer buttons to that exact queued-message notice. Steer injects the notice's queued message into the active run and retires the queue item; Stop retains the existing behavior of aborting the active run and clearing pending work. Queue authorization and first-action-wins idempotency live in `SharedRuntimeCommandService`; Channels only encode callbacks and render/edit platform UI.
- **Safety / Acceptance**: the referenced queue item must still be pending in the callback's verified Chat/Topic scope; forwarded, stale, cross-chat, duplicate, or opposite callbacks cannot affect another run. Telegram callback data remains compact and edits the original notice. Feishu cards disable forwarding, acknowledge immediately, then explicitly update the original card to a button-free success/stale/failure result; when that update fails, a text receipt is mandatory. A Steer accepted by the shared Runner must survive provider timeout and whole-attempt retry, appear exactly once in every retried model attempt, and remain runtime-only rather than becoming a persisted Session turn. Existing typed commands remain available.

---
## 3.42 Interactive daily memory review in Telegram and Feishu (2026-08-08)

- **Priority / Status**: P1 / Delivered (2026-08-08).
- **Problem**: daily reflection only reported aggregate counts, so every pending candidate still required opening the App and reviewing it there.
- **Decision**: retain the aggregate notice and follow it with one numbered candidate per message in the configured Telegram or Feishu private chat. Each ordinary candidate has Keep / Don't keep buttons; actions are authorized and decided in the shared memory layer, while Channels only render payloads and convert callbacks.
- **Safety**: actionable content is private-chat only; a group or unverifiable target receives the aggregate notice only. Delivery identity, stable Owner/date numbering, retry state, and idempotency are persisted in the existing memory SQLite. Skill draft suggestions remain App-only. Button events never become conversation messages or model context.
- **Acceptance**: exact post-reflection pending IDs include enriched older candidates and exclude auto-confirmed candidates; restart/retry preserves numbering and skips already delivered items; concurrent/opposite decisions cannot create both a memory and a suppression row; Telegram acknowledges and edits the source message; Feishu returns promptly, edits asynchronously, and restores buttons on transient failure; QQ/Weixin/Web receive no interactive items.

---
## 3.41 Single-instance ownership and real data-dir isolation (2026-08-07)

- **Priority / Status**: P0 (a, b) / P2 (c) / (a) and (b) Delivered (2026-08-07); (c) is a working rule, no code.
- **Incident**: five orphaned `node build/index.js` processes from 2026-07-26/08-05 smoke and upgrade-probe runs kept long-polling the production WeChat bot `weixin-momo-2` for twelve days. One user message received five replies, each from a different process, each reporting its own unrelated session list (`s-20260807-xpjk` / `kaoh` / `bsxv`) that existed nowhere in `~/.molibot` — so the owner could neither find the sessions nor identify the responders. The processes served no HTTP port (their servers had already closed), held no lease, and appeared in no UI: only `ps` could see them. Confirmed by five `success` rows for one `sourceMessageId` across three `DATA_DIR`s, and by `queueId` running consecutively across those data dirs (1248 → 1266), proving one shared outbox.
- **(a) A lease in the launcher is not a single-instance guarantee.** `acquireServiceLease()` lives only in `scripts/start-server.mjs`; `node build/index.js` bypasses it entirely, along with the SIGTERM handler and the forced `process.exit(0)`. Nothing else refuses to start, so N processes can hold one bot identity and the orphan never dies (the long-poll loop, timers and sqlite keep the event loop alive forever). Ownership must be held by the runtime, not the wrapper: a channel's live loop verifies lease ownership before its first poll and stops when the lease is lost or owned by another process identity. Same root-cause class as pitfall 23 — *liveness is ownership, and age is not evidence*.
- **(b) `DB_DIR` defeats `DATA_DIR` isolation, so "throwaway" instances run on production credentials.** `env.ts:55` resolves `DB_DIR` independently of `DATA_DIR`, and the repo `.env` pins `DB_DIR=~/.molibot/db`. A run with `DATA_DIR=/tmp/molibot-smoke` therefore split: workspace and sessions went to `/tmp` (`weixin/index.ts:12` derives `moli-wx` from `config.dataDir`), while `settings.sqlite`, `inbound-queue.sqlite` and `outbox.sqlite` were opened **read-write** on the real database — handing the test instance the live WeChat token. Every derived path must follow `DATA_DIR` unless its own variable is set *in the same layer*; a repo-level `.env` must not be able to pin one branch of the tree to the production data dir. A non-default `DATA_DIR` with an inherited production `DB_DIR` should refuse to boot rather than silently split-brain.
- **(c) A background test service must be launched and reaped like one.** The smoke and upgrade-probe runs used bare `nohup node build/index.js &`; the launching shell exited, the processes reparented to init, and nothing ever reaped them. Test harnesses launch through `start-server.mjs` (lease + signal handling + forced exit), record the pid, and kill it on exit including on failure; `/tmp` data dirs are removed in the same teardown. Verification runs that touch a live channel must additionally set `MOLIBOT_DISABLE_LIVE_CHANNELS=1` unless the channel is the thing under test.
- **Delivered (2026-08-07)**: `serviceOwnership.ts` asserts ownership in the runtime — adopt the launcher's lease when the published `MOLIBOT_SERVICE_OWNER_ID` matches the lock, otherwise acquire one, and fail closed on conflict *or* on any lock the process cannot evaluate. `applyChannelPlugins` is the single gate: an unowned process yields an empty instance list for every plugin that does not declare `requiresServiceOwnership: false`, so the existing reconcile loop performs the teardown and no second shutdown path exists; only the local `web` plugin is exempt. A 30s unref'd watchdog re-reads the lock and re-runs the same apply path when ownership is lost. A runtime-acquired lease releases on `exit`, `SIGTERM` and `SIGINT` (a bypass process has no other handler). `dataDirScope.ts` adds the layer rule: an override present only in the cwd `.env` is dropped when `DATA_DIR` came from the OS environment, and a non-default `DATA_DIR` whose data still escapes it refuses to boot unless `MOLIBOT_ALLOW_EXTERNAL_DATA_PATHS=1`. Applied to `DB_DIR`, `SETTINGS_FILE`, `SETTINGS_DB_FILE`, `WEB_WORKSPACE_DIR`, `SESSIONS_DIR`, `SESSIONS_INDEX_FILE`, `PI_CODING_AGENT_DIR`.
- **Verification**: `dataDirScope.test.ts` (8) + `serviceOwnership.test.ts` (6) wired into `test:service-bootstrap` (36 pass); `test:projects` 68 pass; `test:desktop-chat` 249/250 with one pre-existing `SessionStore` failure also present on `master`; desktop `svelte-check` 0/0 over 1545 files; production build clean. Cold path exercised against the real build (CLAUDE.md pitfall 10): `DATA_DIR=/tmp/... node build/index.js` from the repo now opens `/tmp/.../db/settings.sqlite` instead of `~/.molibot/db/settings.sqlite` and logs the dropped `DB_DIR`; a foreign live lock yields `channel_plugins_suppressed` with telegram/feishu/qq/weixin at 0 instances and `web` still at 1; an unowned dir is claimed by the runtime's own pid; a stale lock from a dead pid is reclaimed; `SIGTERM` releases the lock and exits; both `DATA_DIR=~/.molibot` and an unset `DATA_DIR` still resolve to the production database unchanged.
- **Not addressed**: a live orphan holding the lease now blocks the desktop sidecar (`start-server.mjs` exits 73) instead of silently double-answering. That is the intended trade, but the supervisor surfaces it only as a restart loop in the log; a user-facing "another process owns this data directory" state is left for a follow-up.

---
## 3.40 Mini App ↔ host communication platform (2026-08-06)

- **Priority / Status**: P0/P1 / Delivered; owner live microphone acceptance completed 2026-08-09.
- **Delivered**: strict `messageActions` + capture/resources; deterministic invoke; composer bridge v1; host AI text/transcription facade; fine-grained routing settings and 30-day usage; controlled raw uploads; Todo action; opt-in built-in Meeting Notes; creator contract v1.3.0. Server target is 2.9.8 and Desktop 0.9.5; no tag or release was created.
- **Live acceptance**: the product owner confirmed that the Mini App microphone works in the real app on 2026-08-09. Permission denial, device loss, and rollover automation remain optional test hardening; they are not a blocker or an unverified product capability.
- **Deferred v2**: streaming text, images/embeddings, active send, channel emoji/commands, app-to-app calls, per-App model overrides and composer attachments remain out of scope.

## 3.39 Pre-flight context size gate (2026-08-06)

- **Priority / Status**: P0 / Delivered (2026-08-09).
- **Problem**: every context-overflow defence is reactive. The request is assembled and sent; if it does not fit, we depend on `isContextOverflowError` recognising the provider's wording — ~25 hand-collected phrasings, plus a usage-based check for the endpoints that never report the error at all (z.ai answers normally past the window, MiMo truncates and stops on `length`). A gateway with wording nobody has seen yet is an unhandled hard failure, and every miss costs a full round trip.
- **Decision**: before dispatching, estimate the complete assembled context—system prompt、serialized tool schemas、history 和当前 user/tool-result message—against `selectedModel.contextWindow || compaction.defaultContextWindow`. Over budget ⇒ force compaction with a budget derived from the current model; if the newest prompt itself is too large, cap only its model-facing copy while preserving the raw persisted user message. The actual `streamFn` performs a final fail-closed check after role mapping、orphan tool-result cleanup and image routing, before any provider request/log event. The reactive path remains a backstop because token estimation is conservative rather than provider-tokenizer exact.
- **Acceptance**: delivered. Unit/integration coverage locks CJK-aware counts, tool/system overhead, base64 image exclusion, default windows, prompt capping without source mutation, and “provider callback is never invoked” for oversized final context. Ordinary in-budget requests add no model call. Covers CLAUDE.md pitfall 27 (e).

## 3.38 Unified Artifact Panel: viewer registry, HTML preview, CSV tables (2026-08-05)

- **Priority / Status**: P0-P2 slices / Planned (local PRD only, no GitHub issue).
- **Problem**: the right side is three unrelated surfaces — ProjectFilePanel (code/diff/MediaViewer, Projects only), MiniAppPanel (its own container), and a chat-side modal that previews only image/audio/video. HTML preview does not exist anywhere, ordinary chats cannot preview PDFs or code in a panel, CSV/JSON/Markdown/SVG render as raw text, and every new format would have to be built twice (pitfall #7 fork).
- **Decision**: converge the right side into one Artifact Panel — a tab container plus a shared viewer registry keyed on MIME + extension (empty-MIME fallback per `resolveWebInboundFileMeta()`); Mini Apps become an iframe-type tab with their internals untouched. Slice 0 is a behavior-preserving container refactor; Slice 1 (P0) adds sandboxed same-pattern-as-miniapp HTML preview (no `allow-same-origin`, root-validated, fail-closed), routes chat attachments into the panel viewers, and adds a CSV/TSV table viewer with raw toggle; Slice 2 (P1) adds Markdown (reusing `markdown.ts`), **source-first JSON with explicit tree parsing**, SVG, audio, lazy XLS/XLSX tables, lazy DOCX content, and lazy PPTX slides; Slice 3 (P2) adds mermaid and a system-app fallback card for unsupported types. Every file tab shares one action bar: reveal, open-with-system, copy path, save-as, insert-as-`@`-reference (via §3.35 validated syntax). Explicitly out of scope: embedded editor, file management ops, a general browser, PPTX editing/animation/presenter controls, CSV/JSON editing, Word layout-faithful editing, and spreadsheet editing/formula execution.
- **Acceptance**: full PRD with user stories, per-slice acceptance, and mandatory test seams (registry dispatch, HTML route escape/fail-closed, CSV parsing incl. CJK, single-mount + sandbox + three-theme structural guards, blob URL lifecycle, cold-start smoke walk) in [docs/requirements/artifact-panel-prd.md](docs/requirements/artifact-panel-prd.md).

## 3.37 Model verification feedback belongs to the model dialog (2026-08-05)

- **Priority / Status**: P2 / Delivered (2026-08-05).
- **Problem**: a per-model connection check wrote its outcome to the Provider page's generic action message, leaving success/failure visibly behind the modal and disconnected from the button that initiated it.
- **Decision**: return the model-check outcome from the Provider store without publishing a page-level message; let the open model editor own its transient result and place it immediately left of the verification action.
- **Acceptance**: pending, passed, and failed states remain within the model dialog; success and failure share one stable footer position and explicit accessible text; closing or switching editors rejects stale outcomes; the outer Provider pane receives no model-check result; Desktop structural tests, Svelte diagnostics, and production build pass.

## 3.36 Project custom-command editor hierarchy and focus ownership (2026-08-05)

- **Priority / Status**: P2 / Delivered (2026-08-05).
- **Problem**: one custom command appeared as three unrelated, misaligned bordered boxes; the remove action shortened only the name row, and focusing the nested name input drew both its generic settings-field ring and the composite wrapper ring.
- **Decision**: present each command as one label/field grid inside a grouped surface, reserve a stable action gutter, use tonal wells instead of another border layer, and make the slash/name wrapper the sole owner of the command-name focus ring. Scope Project settings to the AppKit-neutral `--control-border-strong` / `--label-primary` focus hierarchy instead of the generic blue Geist ring.
- **Acceptance**: command, description, and content share aligned edges and explicit labels; empty state is visible; Light/Dark roles stay token-driven; every Project-settings control retains a visible neutral keyboard focus with no accent-blue border; structural regressions, Svelte diagnostics, and the Desktop production build pass.

## 3.35 Trusted Project file references and mutation claims (2026-08-03)

- **Priority / Status**: P0 / Delivered (2026-08-03).
- **Problem**: Project file mentions were serialized as bare `@path`. The presentation marker reached file tools as part of the path, so edits targeted a non-existent `@...` tree; after tool failure and an empty real diff, the model could still claim success and invent diff output.
- **Decision**: the composer owns a structured `@[display name](Project-relative path)` syntax, while the shared Runtime validates the target against the registered Project root and exposes only a transient exact-path mapping to the model. Existing multi-segment bare `@path` references remain readable through a validation-only compatibility path; Mini App selectors such as `@todo` remain separate. File completion claims are accepted only when the run observed a successful structured `write`/`edit` receipt.
- **Acceptance**: new and legacy Project references never pass a leading `@` to filesystem tools; missing/escaping paths fail closed; transcript display stays readable; a failed edit or empty diff cannot be presented as a successful save; real Project and scratch writes and non-file content generation remain unaffected.

## 3.34 Multiple terminal replies remain visible (2026-08-02)

- **Priority / Status**: P0 / Delivered (2026-08-02).
- **Problem**: one Agent run can legitimately persist multiple terminal assistant replies, including a primary answer plus a supplement. Web/Desktop conversation projection collapsed every assistant entry before the next visible user message into one bubble, so the last reply silently replaced the earlier, more complete answer. Runtime-authored corrective notices also used the follow-up queue, allowing a notice raised mid-tool-loop to run only after the task had already answered.
- **Decision**: collapse non-terminal tool progress but preserve each textual terminal assistant as its own projected message. Runtime-authored corrective controls steer the active loop before its next model call; only owner-authored follow-ups retain post-completion queue semantics.
- **Acceptance**: the captured `s-20260802-grja` pattern projects both terminal replies; an intervening tool-use message cannot replace either one; a trailing abort/error remains status on the existing answer; repeated-failure, tool-failure-budget, and subagent-delegation notices are machine-guarded as steering controls.

## 3.33 Evidence-backed Mini App Creator delivery (2026-08-02)

- **Priority / Status**: P0 / Delivered (2026-08-02).
- **Problem**: the Creator scaffold accepted hyphenated ids but copied them verbatim into SQLite identifiers; generic file tools could previously miss the live code root; and later turns could claim an install/update with zero tool calls. The prompt required cold verification without providing a machine-owned install receipt.
- **Decision**: builds live in Session scratch until a shared `miniAppManage` tool validates the manifest and actually loads the Runtime against temporary data, then delegates installation to the existing staged atomic installer and reads an exact receipt back from the live directory. Validate/install are critical owner-approved actions because they execute selected server code with owner permissions in an isolated child process; inspect is read-only. App ids and SQL identifiers are distinct generated values. Prompt evidence rules are backed by a Runner retry when a zero-tool attempt fabricates a Mini App completion claim, plus a runtime-authored warning when some tools ran but no successful install receipt exists.
- **Acceptance**: `expense-tracker` scaffolds with SQL-safe identifiers; direct scaffold into `miniapps/apps` is refused; invalid SQL installs nothing; successful install/inspect returns matching app id, version and manifest hash; completion prose without a successful install receipt is never presented without a runtime correction; bundled `miniapp-creator` is versioned so existing owner workspaces receive the workflow safely.

## 3.32 Shared readable Session and Task context IDs (2026-08-02)

- **Priority / Status**: P1 / Delivered (2026-08-02).
- **Problem**: channel Agent contexts already used readable `s-YYYYMMDD-xxxx` ids, while App/Web and Project conversations used UUIDs and forks used a third `fork-*` form. The split made one Agent appear to follow different identity rules depending on entry surface.
- **Decision**: one shared Agent-layer generator owns new Session ids across App/Web, Projects, external channels, and forks. Ordinary Sessions use `s-YYYYMMDD-xxxx`; automation contexts use `t-YYYYMMDD-xxxx` (or `t-archive-*` for shared archives). Channels do not implement their own naming rules. Persisted UUID, `fork-*`, and `task-*` ids remain valid and are never renamed in place.
- **Acceptance**: Web, Project, Agent, Task, and fork creation paths are machine-guarded; current and legacy Task contexts remain hidden from ordinary conversation lists, routable, recoverable, and eligible for retention cleanup.

## 3.31 Mini App platform: workspace-installed apps with agent tools + hosted UI (2026-08-02)

- **Priority / Status**: P1 / **Delivered 2026-08-02** (GitHub Issue [#26](https://github.com/gusibi/molibot/issues/26)). Slices 0-6 complete; see `features.md` for the delivered scope. **Scope expanded 2026-08-02 after review**: Mini Apps became a primary sidebar destination with a full manager (the original Settings-only entry was undiscoverable); the peer sidebar section keeps the product name while prioritizing the 10 most recently used apps; manifests gained an optional `ui.icon` rendered consistently in the manager, quick list, and Inspector; and graphical installation from a local folder / ZIP / GitHub repo was added. Remote install deliberately relaxes the original trust model — app server code runs in a fault-isolated child process but remains **unsandboxed for owner permissions** — so the UI confirms provenance before every install and the catalog records where each app came from. Hot activation was delivered in §3.44 and process fault isolation in §3.51. Still deferred: SSE push (V1 polls a revision), an app marketplace with signing/permission scopes, per-agent or per-project app instances, app-to-app calls, automatic data-schema migration.
- **Delivered follow-up**: every channel supports `/miniapps` (aliases `/mini-apps`, `/apps`) to list the active catalog and the exact `@<app-id>` invocation form. A leading `@todo` / `@<installed-app>` narrows that turn's Mini App tool catalog to the selected app. The selector is a transient runtime control, stripped before persistence and never replayed in later turns.
- **Delivered UI follow-up**: Conversation, Project, and Mini App sidebar sections share one global 32px sticky header contract. Mini Apps must not depend on a parent component's scoped CSS. Headers remain transparent in normal flow; only the title actually pinned to the scroll container reveals an extended, masked glass pseudo-element whose blur and tint fade vertically. Dark mode lifts the material rather than laying down a dark rectangle, with no-blur accessibility/performance fallbacks.
- **Reliability guard**: explicit `@<app-id>` calls preload only the selected Mini App's Agent tools into the first loop snapshot and exclude generic fallback tools. Deferred discovery refreshes the active loop snapshot between model turns, so a toolSearch result is genuinely callable in that same run.
- **Problem**: agent-managed daily data (todos, expenses, schedules) has no visual surface — it lives in memory or files and is only reachable by asking in chat; building bespoke UI per domain would bloat the main app indefinitely.
- **Decision** (v2 after review, fault boundary superseded by §3.51): introduce Mini Apps as a new plugin kind reusing the existing manifest/discovery/catalog/enable patterns, installed owner-globally under the fixed owner workspace root — `miniapps/apps/<app-id>/` (replaceable code) separated from `miniapps/data/<app-id>/` (independent-lifecycle data, the single source of truth shared by all channels); never derive the install root from a per-channel `workspaceDir`. Agent tools and the app's own UI API handlers share one domain module over the app's database — no host-provided file-level data API and no MCP/postMessage bridge for the UI (both explicitly rejected as too heavy; full MCP Apps host protocol stays out of scope, concept alignment only). Tools register internally as `miniapp__<appId>__<tool>` (display `<appId>.<tool>`), classify as `source: plugin` with manifest risk hints, and enforce enablement at invoke time (disabled apps also 403 their routes). App server code is owner-trusted but executes in a per-App child process; this contains crashes but does not restrict owner permissions. The UI iframe remains a separate browser isolation boundary. v3 pins: owner workspace = `config.dataDir` (`~/.molibot`); iframe transport uses the fixed custom protocol `molibot-miniapp://` forwarded by a Tauri adapter (Slice 0 WKWebView spike gates it; never widen CSP to localhost port ranges); installs and replacements hot-activate through the shared Host without restarting Molibot; Mini App tools load via toolSearch deferral; Ajv + SemVer + esbuild are production dependencies. MVP ships a Todo reference app (SQLite + polling revision); SSE later. Implementation plan: [docs/archive/requirements/miniapp-platform-implementation-plan.md](docs/archive/requirements/miniapp-platform-implementation-plan.md).
- **Acceptance**: full PRD v2 with user stories, four test seams (discovery/settings round-trip, tool executor incl. classification and invoke-time disable, HTTP scoping incl. bidirectional round-trip/concurrency/uninstall-reinstall, desktop structural guards) and out-of-scope list in Issue #26 and [docs/archive/requirements/miniapp-platform-prd.md](docs/archive/requirements/miniapp-platform-prd.md).

## 3.30 OpenConnector Cloudflare gateway and connector catalog (2026-08-01)

- **Priority / Status**: P1 / Delivered (2026-08-01); Cloudflare deployment supplied by the product owner at `https://opc.eztoolab.com`.
- **Decision**: self-host OpenConnector on Cloudflare Workers with D1 and R2. Molibot derives one remote MCP connection from a dedicated OpenConnector setting and presents a searchable, visibly categorized service catalog using `/v1/providers` plus active connections from `/v1/apps`. Credential and OAuth management remains in OpenConnector Console for V1; Molibot does not store an Admin Token or call `/api/connections`.
- **Delivered**: Desktop Settings exposes OpenConnector beside MCP, with a default-collapsed fine-grained configuration panel, searchable/filterable two-column Provider catalog in the standard settings column, one-row search/status/multi-category filtering, active connected-service status, Console deep links, explicit manual refresh, cached catalog reads on page entry, Iconify/Favicon brand images, explicit saved-token reveal/hide, and one derived remote MCP server plus an Agent Skill. The generic MCP editor never owns or duplicates the Runtime Token.
- **Safety boundary**: Molibot stores only a least-privilege Runtime Token; it stays hidden by default and is returned only after an explicit reveal action through the local Desktop API. V1 Agent instructions are read-only and do not store the Admin Token. The deployed Runtime Token/Action policy must also enforce the read-only allowlist. Write Actions require a later shared Agent-layer approval/idempotency slice.
- **Unified MCP ownership**: the derived `open-connector` server is visible in Desktop MCP inventory, counts, live state, and reconnect controls. It is explicitly marked managed; configuration mutations remain exclusively owned by OpenConnector Settings so the two pages cannot produce competing sources of truth.
- **Catalog layout detail**: Provider results are independent two-column cards rather than cells inside one full-row frame, so an odd final result leaves the unused right column visually empty.
- **Card alignment**: Provider identity owns the flexible left side; status and manage/connect form one fixed, right-aligned action group.
- **Provider discovery**: when catalog metadata supplies `homepageUrl`, the logo/name identity opens that official homepage in the system browser; missing homepage metadata stays non-interactive.
- **Plan / Acceptance**: [docs/requirements/openconnector-cloudflare-and-molibot-plan.md](docs/requirements/openconnector-cloudflare-and-molibot-plan.md).

## 3.29 Quiet Chat source identity and contextual timestamps (2026-08-01)

- **Priority / Status**: P2 / Delivered (2026-08-01).
- **Problem**: the large circular initial in the Chat header competed with the conversation title while still providing little source information; message metadata showed only a clock, so older turns could not be placed on a date.
- **Decision**: replace the avatar with one quiet `# + source initial / title` sequence whose accessible name retains the full Web/Feishu/Telegram/QQ/Weixin/Project identity. Keep all three header elements at one compact size and vertical center. Remove redundant channel prefixes from ordinary Chat titles, retain Project/session hierarchy, and share one contextual message-time formatter between local and Project Chat. Tighten the four primary sidebar destinations to 30px rows, use coherent regular-weight semantic icons, and let spacing replace the redundant divider above conversations.
- **Acceptance**: all Chat surfaces expose a compact source dimension without a prominent avatar; external read-only transcripts merge source and status into one footer line without a duplicate top banner; Conversation and Project act as peer sticky sections where the next title pushes off the previous and only one title is pinned; the complete 60px header drag zone moves the window without intercepting header actions or the first sidebar destination; today/yesterday/older/cross-year messages retain the clock and add the appropriate localized date context; invalid timestamps fail quietly; header and date-boundary regressions plus Desktop diagnostics and production build pass.

## 3.28 Design-system selects across Desktop (2026-08-01)

- **Priority / Status**: P1 / Delivered (2026-08-01).
- **Problem**: settings pages mixed a shared wrapper with 45 direct native selects; the wrapper itself was also native, so expanded menus ignored Molibot's visual system and behaved differently across pages.
- **Decision**: make one Bits UI-backed `SelectControl` the only enumeration control and migrate every Desktop settings, Project settings, and onboarding call site. Preserve native time and numeric inputs where direct entry or a platform picker is the correct behavior.
- **Acceptance**: no Desktop Svelte file contains `<select>`; triggers and floating menus follow semantic Light/Dark tokens; every item retains the Bits UI option root and is independently clickable; checked state, long-list scrolling, typeahead, disabled state, pointer dismissal, and complete keyboard navigation work; settings-row triggers allow up to 320px for readable model names while shrinking safely in narrow windows; all existing narrow save/update paths remain unchanged. Delivered, including the 2026-08-01 item-root regression fix.

## 3.27 Compact composer model menu (2026-08-01)

- **Priority / Status**: P2 / Delivered (2026-08-01).
- **Problem**: model and thinking depth used two separate pills backed by native selects, consuming scarce composer width and exposing platform-default menus that could not follow Molibot's light/dark visual system.
- **Decision**: combine both settings into one `model · depth` summary and one custom, in-place hierarchical popover shared by Chat and Project Chat. Keep the existing Session-scoped model persistence and runtime thinking contracts unchanged.
- **Acceptance**: one trigger reaches both choices; long model lists scroll inside the popover; current values remain visible and checked; outside-click, Escape, arrow-key navigation, focus, bilingual copy, light/dark themes, and narrow composer widths work; no native select remains in the shared composer.

## 3.26 Memory usage trace and feedback loop (2026-08-01)

- **Priority / Status**: P1 / Delivered (2026-08-01). Design doc: [docs/designs/memory/memory-usage-trace-and-feedback.md](docs/designs/memory/memory-usage-trace-and-feedback.md).
- **Problem**: the memory panel claims every reply "referenced N memories" but the trace only records prompt-injected items — the system never knows what the model actually used; memories the agent actively fetched via the memory tool mid-run (the strongest "really referenced" signal) are invisible; retrieval has no relevance floor so low-signal questions ("what time is it") always inject the same high-class-weight memories; the helpful/irrelevant feedback buttons write a `utility` score that no ranking path reads, and the forgetting path requires `injectionCount === 0`, so daily-injected memories can never be demoted or forgotten.
- **Decision**: split memory usage into `injected_profile` / `injected_retrieved` / `referenced`. "Referenced" is captured deterministically from memory-tool hits recorded into the turn trace, plus a citation protocol (`[[mem:M1]]` markers, stripped from output) for prompt-injected items; no lexical-overlap guessing. The chat chip renders only when the referenced set is non-empty; the drawer groups 参考记忆 (with source session/time) above collapsed 本次附带. Feedback buttons remap per usage: "别再自动附带" flips `allowInjection` (immediately for profile items, after 3 strikes for retrieved), "参考错了" applies a stronger utility penalty, and `memoryPriority` gains a utility term plus a relevance floor so both actually change future injection. Forgetting eligibility switches from never-injected to never-referenced-and-low-utility.
- **Acceptance**: low-signal questions show no memory chip and an empty referenced group; cited and tool-retrieved memories appear in the referenced group with provenance; citation markers never leak into visible or persisted text; 别再自动附带 takes effect (immediate / 3-strike); utility measurably lowers ranking under machine test; feedback idempotency/undo and store round-trip regressions pass; agent suite, `tsc`, `svelte-check` 0/0, `vite build`, desktop UI tests, and a cold-start smoke walk pass.
