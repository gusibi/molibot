# Findings & Decisions: Desktop Reicon Migration

## Requirements

- 将 Desktop 界面里的列表、设置、按钮、菜单、状态和组件图标迁移到 Reicon。
- 列出完整任务清单，依次执行，每完成一项就在文件中打勾。
- 未完成时保留足够的进度、发现和验证信息，允许其他执行者无损接手。
- 最终产品不能长期混用 Phosphor 和 Reicon。

## Research Findings

- Web 主应用和内置 Mini Apps 已迁移到 Reicon；Desktop 迁移已在 `prd.md §3.129` 立项。
- 当前 Desktop 从 `src/main.ts` 全量加载 Phosphor regular/bold/fill webfont。
- 当前扫描发现约 97 个 Desktop 源文件含 Phosphor 使用，图标 token 约 166 个；`styles.css` 有约 99 行 `.ph*` 相关规则。
- `reicon-svelte@1.0.102` 已存在于根 workspace，但 `apps/desktop/package.json` 尚未声明它。
- `reicon-svelte` 的根 barrel 会因重复导出 `Icon` 使 Rollup production build 失败；必须使用 `reicon-svelte/icons/*` 子路径。
- 按名称直接映射时只有约 62/166 个 Phosphor 图标与 Reicon 同名；其余必须按语义选择，而不是文本替换。
- 动态边界包括 `EmptyState`、`GroupHeader`、菜单项、运行状态、密码显示、排序、展开状态、消息动作、文件扩展名图标以及 raw HTML 注入。
- `fileIcons.ts` 使用大量 Phosphor 语言专用文件图标；Reicon 没有完整等价集合，但现有扩展名颜色可以继续承担语言辨识。
- Reicon Svelte 组件支持 `size`、`color`、`weight`、`strokeWidth`、`class` 和其余 SVG 属性，可保持现有主题、尺寸、ARIA 和动效行为。
- Svelte 5 的 Reicon 组件可通过大写组件变量动态渲染；组件标签不能使用 `class:foo` 指令，需要生成完整 class 字符串。
- `EmptyState` 的字符串 prop 表达的是稳定状态语义，而不是图标库类名；内部穷举 Reicon component map 即可消除 Phosphor 耦合，无需改动全部调用方。
- 设置导航原本把 Phosphor class 后缀保存在数据里；迁移后数据直接持有类型化 Reicon component，模板用局部大写变量渲染，消除了运行时字符串拼接。

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| 静态图标按文件直接子路径导入 | 最简单、可 tree-shake、构建安全 |
| 动态图标只在确有需要的领域组件内建显式 map | 避免全局大 registry 和字符串兼容层 |
| 默认 Outline，强调/完成/选中使用 Filled | 对齐 Reicon 双字重能力和现有界面层级 |
| 使用 `currentColor` 与现有尺寸 token | 自动适配明暗主题并减少样式改动 |
| 文件图标按 code/document/media/archive 等类别归并 | Reicon 不提供完整语言专用 glyph；保留颜色可维持辨识度 |
| 图表 SVG 与真实内容 SVG 不迁移 | 它们不是图标，不应因图标库迁移改变 |
| `EmptyState` 保留类型化语义名称 API | 调用方表达状态语义；内部 map 可以集中保证 Reicon 映射完整 |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| 计划技能要求根目录文件，而项目规范把时间型材料放 `docs/work/` | 本次以技能要求的根目录三文件作为唯一执行账本；产品计划仍引用现有 `prd.md`，不新建重复 PRD |

## Resources

- `task_plan.md`
- `progress.md`
- `prd.md §3.129`
- `features.md` 的“图标库统一迁移到 Reicon”条目
- `CLAUDE.md` pitfall 45
- `apps/desktop/src/main.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/lib/projects/fileIcons.ts`
- Reicon: https://reicon.dev/icons

## Visual/Browser Findings

- Reicon 提供 24×24 网格的 Outline/Filled 双字重图标，适合 Desktop 的导航、按钮和设置项 glyph。
- Reicon 是图标目录而非自动替换工具；具体迁移需要组件导入和语义映射。

## 2026-09-01 Resume Findings

- 工作区现状显示 Phase 5 的项目、Artifact 和 Mini App 组件已经有大量 Reicon 改动，但 `task_plan.md` 尚未同步勾选；接手时应以源码与验证结果为准，避免重复迁移。
- 当前 `apps/desktop` 残留集中在四类边界：`src/styles.css` 的旧 `.ph*` 选择器、`src/main.ts` 的三项字体入口、`src/lib/markdown.ts` 的 raw HTML 注入，以及 `src/chat-ui.test.mjs` 中的旧结构守卫；另有 `dialog-harness.html` 这个静态调试页面仍直接引用旧字体。
- `projects/fileIcons.ts` 已经提供 `FileIconKind`、`fileIconKind()` 和颜色样式 API，`fileKindIcons.ts` 提供完整语义类别到 Reicon 组件的映射；需要重点验证其所有调用方、测试和目录/符号链接行为，而不是重新设计映射。

## 2026-09-01 Phase 5/6 Findings

- 图片灯箱和 Markdown 表格动作是在 Svelte 外生成 HTML 字符串，不能直接使用 `.svelte` 组件；`reiconSvg.ts` 只在这两个边界复用 Reicon Outline 路径，普通界面仍走直接子路径导入。
- `SidebarNav.svelte` 的旧动态图标契约没有出现在旧类名扫描结果里，因为它只保留了通用前缀；迁移守卫需要同时检查旧包名、旧类前缀和旧基础 class。
- Reicon 根节点是 SVG，旧 CSS 中针对已迁移直系图标的 `font-size`/`i` 选择器不会生效；实际直系图标已改为 `.reicon` 并使用宽高，状态圆点及承载布局的 `<i>` 包裹仍按语义保留。
- `pnpm --dir apps/desktop run check` 在移除旧依赖后仍为 0 errors / 0 warnings；依赖锁文件同步移除了旧包。

## 2026-09-01 Phase 7 Findings

- 应用内浏览器预览实际走查了聊天首屏、设置页、暗色主题、英文即时切换、自动任务和 Mini Apps；页面渲染 28 个 `.reicon` 节点、0 个旧图标节点，正常窗口无横向溢出。
- 浏览器能力没有提供可控 viewport，因此窄窗口没有被冒充为真实截图结论；现有移动断点和结构守卫继续作为可执行覆盖。当前会话也没有 Native Tauri supervisor 冷启动接口。
- 独立临时数据目录已完成服务停止→重启→浏览器页面 reload 恢复链路；停止时代理返回失败，重启后聊天首屏恢复。
- 对抗式审查确认 146 个唯一 Reicon 子路径组件全部存在；无根 barrel 导入；旧包名、旧 class token 和旧选择器扫描均为空；完整构建验证没有发现上游重复导出问题。
- Desktop HEAD 基线 `dist` 27,388 KB，当前 `dist` 15,904 KB，减少约 41.9%；该变化是记录项，不作为迁移功能取舍依据。
