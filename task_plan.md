# Task Plan

## Goal
优化 Settings / AI / Providers 与 Settings / AI / Routing，让 built-in 与 custom 模型作为同一个模型池被理解和使用；同时提升 PC、移动端、明暗主题下的可读性和配置效率。

## Assumptions
- 不合并两个 URL；Providers 继续负责供应商和模型资产，Routing 继续负责运行时路由和默认策略。
- 优先做低风险 UI/配置语义融合，不重写后端模型选择核心。
- 保留现有 settings/API 数据结构，避免破坏已有配置。

## Phases
- [completed] 盘点两个页面的真实 UI、代码结构和当前逻辑割裂点
- [completed] 设计融合后的信息架构和样式改动
- [completed] 实现 Providers/Routing 页面优化
- [completed] 更新 `features.md` / `prd.md`
- [completed] 执行可用的编译/页面验证

## Success Criteria
- Built-in/custom 在文案和路由页中被表达为同一个可混用模型池。
- Providers 页和 Routing 页在移动端、常见桌面宽度、明暗主题下都不依赖硬编码白/黑色造成割裂。
- Routing 页能更清楚展示当前活动模型、各能力路由和 fallback 策略。
- 修改后至少通过 Svelte 页面编译解析；如完整 build 受环境限制，记录原因。

## Errors Encountered
- `npm run build` 仍受当前只读沙箱限制，SvelteKit 无法写入 `.svelte-kit/tsconfig.json`；改用 Svelte compiler 对两个改动页面做模板编译解析并通过。
