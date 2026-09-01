# Task Plan: Desktop 图标库统一迁移（Phosphor → Reicon）

## Goal

将 `apps/desktop` 的全部界面图标从 `@phosphor-icons/web` 迁移到 `reicon-svelte`，保留现有语义、状态、尺寸、颜色、动效和无障碍行为，最终删除 Phosphor 依赖、字体入口、类名和专用 CSS。

## Current Phase

Phase 7 — 全量验证、对抗式审查与文档收尾（complete）

## Execution Rules

- 每完成一个复选项，立即将 `[ ]` 改为 `[x]`，并同步记录到 `progress.md`。
- 静态图标只能从 `reicon-svelte/icons/*` 子路径导入，禁止使用存在重复导出缺陷的 barrel。
- 动态图标必须改成显式组件引用或类型安全枚举，禁止保留 `ph-${name}` 字符串拼接兼容层。
- 普通操作默认 `Outline`，选中/强调/完成状态使用 `Filled`；沿用现有图标尺寸 token 和 `currentColor`。
- 最终状态不得混用 Phosphor 与 Reicon；中间阶段可以保持可构建，但完成前必须删除旧体系。
- 文件图标使用 Reicon 的语义类别图标并保留现有扩展名颜色，不自画语言专用图标。
- 每一阶段完成后运行针对性检查；最终必须完成全量测试、构建和冷启动走查。

## Phases

### Phase 1: 现状盘点与迁移决策

- [x] 确认 Web 主应用与 Mini Apps 已使用 Reicon，Desktop 是剩余迁移面。
- [x] 扫描 Desktop 的 Phosphor 使用范围、动态图标边界和 CSS 耦合。
- [x] 核实 `reicon-svelte` 已在根 workspace，Desktop package 尚未声明依赖。
- [x] 核实上游 barrel 重复导出问题及子路径导入约束。
- [x] 确认文件类型专用图标无法一对一迁移，采用语义类别图标 + 现有颜色。
- **Status:** complete

### Phase 2: 图标基础设施与共享组件

- [x] 在 `apps/desktop/package.json` 声明 `reicon-svelte`，同步 lockfile。
- [x] 定义最小的共享图标类型/动态渲染边界，只覆盖确实需要动态选择的组件。
- [x] 迁移 `src/lib/components/ui/EmptyState.svelte`。
- [x] 迁移 `src/lib/components/ui/OverflowMenu.svelte`。
- [x] 迁移 `src/lib/components/ui/SearchField.svelte`。
- [x] 迁移 `src/lib/components/ui/SelectControl.svelte`。
- [x] 迁移 `src/lib/components/ui/MultiSelectControl.svelte`。
- [x] 迁移 `src/lib/chat/GroupHeader.svelte` 的动态图标 API。
- [x] 为共享图标 API 和动态映射补充/更新结构测试。
- [x] 运行共享组件相关测试、`svelte-check` 和 Desktop build。
- **Status:** complete

### Phase 3: Desktop 外壳、设置导航与设置页面

- [x] 迁移 `src/App.svelte` 的设置导航、搜索和状态图标。
- [x] 迁移 `src/ChatView.svelte` 的窗口级操作和状态图标。
- [x] 迁移 `settings/AgentsSection.svelte`。
- [x] 迁移 `settings/ChannelsSection.svelte`。
- [x] 迁移 `settings/HostBashSection.svelte`。
- [x] 迁移 `settings/ImageGenerateSection.svelte`。
- [x] 迁移 `settings/ImageRecognitionSection.svelte`。
- [x] 核查 `settings/ImageSettingsSection.svelte`（无 Phosphor 直接使用）。
- [x] 迁移 `settings/LogsSection.svelte`。
- [x] 迁移 `settings/McpSection.svelte`。
- [x] 迁移 `settings/MemorySection.svelte`。
- [x] 迁移 `settings/ModelsSection.svelte`。
- [x] 迁移 `settings/OpenConnectorSection.svelte`。
- [x] 迁移 `settings/PluginsSection.svelte`。
- [x] 迁移 `settings/ProfilesSection.svelte`。
- [x] 迁移 `settings/ProvidersSection.svelte` 的能力、密钥和动态状态图标。
- [x] 迁移 `settings/RunHistorySection.svelte`。
- [x] 核查 `settings/RuntimeEnvSection.svelte`（通过已迁移的 `EmptyState` 使用 Reicon，无直接 Phosphor）。
- [x] 迁移 `settings/SkillsSection.svelte`。
- [x] 迁移 `settings/TaskScheduleBuilder.svelte`。
- [x] 迁移 `settings/TasksSection.svelte` 的任务状态、动作菜单和 loading 图标。
- [x] 迁移 `settings/TraceSection.svelte`。
- [x] 迁移 `settings/TtsGenerateSection.svelte`。
- [x] 迁移 `settings/UsageSection.svelte`。
- [x] 迁移 `settings/VideoGenerateSection.svelte`。
- [x] 迁移 `settings/WebSearchSection.svelte`。
- [x] 将 `settings/SandboxSection.svelte` 的手写功能 SVG 换成对应 Reicon；保留数据图表 SVG。
- [x] 运行设置页相关测试、`svelte-check` 和 Desktop build。
- **Status:** complete

### Phase 4: Chat、侧栏与会话组件

- [x] 迁移 `chat/AgentCityFallback.svelte`。
- [x] 迁移 `chat/AgentStudioPane.svelte`。
- [x] 迁移 `chat/ApprovalCard.svelte`。
- [x] 迁移 `chat/BotAvatar.svelte`。
- [x] 迁移 `chat/BotMention.svelte`。
- [x] 迁移 `chat/ChannelAccordion.svelte`。
- [x] 迁移 `chat/ChatComposerShell.svelte`。
- [x] 迁移 `chat/ChatHeader.svelte`。
- [x] 迁移 `chat/ChatInputArea.svelte`。
- [x] 迁移 `chat/ChatMessagesPane.svelte`。
- [x] 迁移 `chat/ChatSidebar.svelte`。
- [x] 迁移 `chat/ChatWorkspacePane.svelte`。
- [x] 迁移 `chat/ComposerModelMenu.svelte`。
- [x] 迁移 `chat/ComposerPermissionMenu.svelte` 的模式图标映射。
- [x] 迁移 `chat/ConversationBrowserDialog.svelte`。
- [x] 迁移 `chat/ConversationLiveView.svelte`。
- [x] 迁移 `chat/ConversationRow.svelte`。
- [x] 迁移 `chat/ConversationTranscript.svelte` 的调用类型、状态和动态消息动作图标。
- [x] 迁移 `chat/DecisionCard.svelte`。
- [x] 迁移 `chat/DurableExecutionCard.svelte`。
- [x] 迁移 `chat/DurableExecutionInspector.svelte`。
- [x] 迁移 `chat/DurableExecutionSidebarSection.svelte`。
- [x] 迁移 `chat/InstalledSkillsPane.svelte`。
- [x] 迁移 `chat/MarkdownArtifactOverlay.svelte`。
- [x] 迁移 `chat/MemoryTraceDrawer.svelte`。
- [x] 迁移 `chat/PlanCard.svelte`。
- [x] 迁移 `chat/ProcessActivityItem.svelte` 的运行状态映射。
- [x] 迁移 `chat/ProcessTimeline.svelte`。
- [x] 迁移 `chat/QueuedMessagesBar.svelte`。
- [x] 迁移 `chat/RunActivity.svelte` 的运行状态映射。
- [x] 迁移 `chat/SlashSuggestionMenu.svelte` 的 invocation 类型映射。
- [x] 迁移 `chat/TranscriptAttachments.svelte` 的附件和动态动作图标。
- [x] 迁移 `chat/TranscriptDock.svelte`。
- [x] 迁移 `chat/TranscriptSearch.svelte`。
- [x] 迁移 `chat/TurnFileList.svelte`。
- [x] 迁移 `chat/TurnFilesCard.svelte`。
- [x] 迁移 `chat/TurnProcess.svelte`。
- [x] 运行聊天/侧栏相关测试、`svelte-check` 和 Desktop build。
- **Status:** complete

### Phase 5: Project、Artifact、Mini App 与原始 DOM 边界

- [x] 将 `projects/fileIcons.ts` 从 CSS 类名改为类型安全的 Reicon 语义类别映射并更新测试。
- [x] 迁移 `projects/CodeViewer.svelte`。
- [x] 迁移 `projects/FileSearchPanel.svelte`。
- [x] 迁移 `projects/FileTreeNode.svelte`。
- [x] 迁移 `projects/MediaViewer.svelte`。
- [x] 迁移 `projects/ProjectChat.svelte`。
- [x] 迁移 `projects/ProjectDetail.svelte`。
- [x] 迁移 `projects/ProjectList.svelte`。
- [x] 迁移 `projects/ProjectSettingsDialog.svelte`。
- [x] 迁移 `projects/ProjectTree.svelte`。
- [x] 迁移 `artifacts/ArtifactPanel.svelte` 的文件树、tab 和上下文菜单动态图标。
- [x] 迁移 `artifacts/CsvTable.svelte` 的排序图标状态。
- [x] 迁移 `artifacts/D2Diagram.svelte`。
- [x] 迁移 `artifacts/DocxPreview.svelte`。
- [x] 迁移 `artifacts/JsonTree.svelte`。
- [x] 迁移 `artifacts/MermaidDiagram.svelte`。
- [x] 迁移 `artifacts/PptxPreview.svelte`。
- [x] 迁移 `artifacts/SpreadsheetTable.svelte`。
- [x] 迁移 `artifacts/SystemOpenCard.svelte`。
- [x] 迁移 `miniapps/MiniAppActionToast.svelte`。
- [x] 迁移 `miniapps/MiniAppIcon.svelte`。
- [x] 迁移 `miniapps/MiniAppResultCard.svelte`。
- [x] 迁移 `miniapps/MiniAppsAiSettings.svelte`。
- [x] 迁移 `miniapps/MiniAppsManager.svelte`。
- [x] 迁移 `miniapps/MiniAppsSidebarSection.svelte`。
- [x] 迁移 `src/lib/imageLightbox.ts` 的原始 DOM 图标注入边界。
- [x] 迁移 `src/lib/markdown.ts` 的原始 HTML 图标边界。
- [x] 运行 Project/Artifact/Mini App 相关测试、`svelte-check` 和 Desktop build。
- **Status:** complete

### Phase 6: 样式收敛、旧依赖删除与机器守卫

- [x] 将 `styles.css` 的 `.ph` / `.ph-fill` / `.ph-bold` 选择器迁移为组件 class 或稳定的 `.reicon`/语义 class。
- [x] 保留并验证 spinner、caret rotate、状态色和 reduced-motion 行为。
- [x] 从 `src/main.ts` 删除三项 Phosphor webfont import。
- [x] 从 `apps/desktop/package.json` 删除 `@phosphor-icons/web` 并同步 lockfile。
- [x] 更新 `chat-ui.test.mjs`：删除 Phosphor 字体/类名有效性守卫，增加 Reicon 子路径和无残留守卫。
- [x] 全仓确认 `apps/desktop` 无 `@phosphor-icons`、`ph-*`、`.ph` 残留。
- [x] 比较迁移前后 Desktop 生产构建产物大小，记录结果但不以体积优化为由改变功能。
- **Status:** complete

### Phase 7: 全量验证、对抗式审查与文档收尾

- [x] 运行 Desktop 单元测试和结构测试。
- [x] 运行 `svelte-check`，达到 0 error / 0 warning。
- [x] 运行 Desktop production build。
- [x] 运行 root production build，确认 Reicon barrel 未进入构建。
- [x] 走查明暗主题、中英文、窄窗口下的设置页、聊天页和项目文件树（应用内预览已覆盖可执行的设置/聊天/Mini Apps 入口与主题语言状态；窄窗口断点由静态守卫覆盖，当前会话没有可控原生窗口尺寸接口）。
- [x] 执行冷路径的可执行范围：独立临时数据目录的服务停止 → 重启 → 首次打开/页面重新加载恢复；当前会话没有 Native Tauri supervisor 冷启动接口，因此不宣称已完成原生进程级 E2E。
- [x] 对抗式审查 3–5 个最可能翻车点并修正。
- [x] 更新 `features.md`：记录 Desktop Reicon 迁移已交付。
- [x] 更新 `prd.md §3.129`：从 Planned 标记为 Delivered 并写明验收结果。
- [x] 更新 `CHANGELOG.md`：添加适合发布的高层摘要。
- [x] 检查 `README.md`；仅在入口、导航或维护约定变化时更新，否则在进度记录中说明无需修改。
- [x] 运行 `git diff --check` 并审阅最终 diff，确保每一行都服务于本次迁移。
- [x] 将本文件所有任务勾选完成，或明确留下未完成项、阻塞原因和下一步命令。
- **Status:** complete

## Key Questions

1. Reicon 缺少语言专用文件图标时，如何保持辨识度？——使用语义类别图标，保留现有扩展名颜色。
2. 如何处理运行状态、菜单和外部数据提供的动态图标？——在对应领域组件内使用显式组件映射，不建立全库字符串兼容层。
3. 如何避免 Reicon 上游构建缺陷？——只允许 `reicon-svelte/icons/*` 子路径导入，并以生产 build 为守卫。

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 在同一个完整 slice 内完成 Desktop 全量迁移 | 跨面板视觉概念必须统一，最终不保留混合图标体系 |
| 静态图标直接子路径导入 | 保持 tree-shaking，并避开 barrel 重复导出缺陷 |
| 动态图标在领域边界内显式映射 | 类型安全、可审查，不复刻 CSS 字符串兼容层 |
| 文件类型降为语义类别图标并保留颜色 | Reicon 无完整语言专用图标；这是最简单且不自造图标的方案 |
| 图表/数据可视化 SVG 不纳入图标迁移 | 它们不是 UI glyph，替换会改变功能和视觉表达 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Phase 2 首个组合补丁因 `apps/desktop/package.json` 依赖上下文与实际文件不一致而未应用 | 1 | 重新读取精确依赖片段，将依赖变更与组件变更拆成更小补丁 |
| 首次 Phase 2 `svelte-check`：实例脚本不能导出 type；组件不支持 `class:open` 指令 | 1 | type 改为脚本内类型，组件 class 改为显式条件字符串后复查 |
| Phase 2 完成状态的首个文档组合补丁因 `findings.md` 表格文本不匹配而未应用 | 1 | 按文件拆分状态更新，使用已读取的精确上下文 |
| Phase 3 UI 结构测试仍断言 OpenConnector 的旧 `ph-arrow-square-out` | 1 | 将行为守卫更新为 Reicon `SquareArrowUp` 子路径断言后复跑 |
| Phase 3 收尾 `svelte-check` 报 `weight="Fill"` 类型错误（两处）与 Memory 缺失 `CaretRight` 导入 | 1 | weight 改为字面量 `Filled`；补回被 import 重构时误删的 `CaretRight` 子路径导入后复跑通过 |
| Phase 4 `svelte-check` 首轮报 4 错误：`{@const}` 放进普通元素、`VideoCamera` 不存在、runes 模式组件用 `$:` | 1 | `{@const}` 上提到块直接子级；改用 `Video`；ChannelAccordion 改 `$derived` 并放到 props 之后 |
| Phase 4 组件局部 `<style>` 报 16 个 unused selector：Reicon 的 svg 来自子组件，局部选择器够不到 | 1 | 局部样式改用 `:global(svg)`/`:global(class)`，或把语义 class 挪回本地 `<i>` 包裹元素；全局 styles.css 无需 `:global` |
| Phase 4 结构测试首轮 216/219：3 个断言仍匹配 Phosphor class | 1 | 断言改为 `Grid`/`Loader class="message-action-spin"`/`<Paperclip` 后复跑 219/219 |
| Phase 5/6 样式批量补丁因前置上下文已变化未命中 | 1 | 拆成语义小块精准更新 direct Reicon 尺寸、状态选择器与减弱动效规则，再通过 CSS 残留扫描 |
| Phase 5 结构测试首轮 218/219：一项旧图标断言未同步 | 1 | 更新为当前 Reicon 组件契约后复跑 219/219 |
| 迁移前基线构建首次受 pnpm workspace 与已删除 Phosphor 入口影响 | 2 | 在临时 detached worktree 中用直接 Vite 构建并提供临时依赖链接；取得基线后立即清理 worktree |
| 浏览器 Node REPL 侧直接读取 `document` 报错；1420 端口已有进程 | 2 | 改用页面 evaluate 读取 DOM，并把临时预览切到 1422；原有进程未触碰 |
| 最终残留扫描的一次命令因 zsh 引号未闭合而未执行 | 1 | 改用 `rg -e` 参数形式复跑，旧包名、旧 class token 和旧选择器均无匹配 |

## Handoff Notes

- 产品计划权威来源：`prd.md §3.129`。
- 研究结论：`findings.md`。
- 已执行操作、改动文件和测试结果：`progress.md`。
- 本 slice 已完成；最终证据、浏览器范围和已知环境限制记录在 `progress.md`。
- 若继续维护，先运行 `git status --short`、`node --test src/chat-ui.test.mjs` 和 `pnpm --dir apps/desktop run check`，不要重做已完成迁移。
