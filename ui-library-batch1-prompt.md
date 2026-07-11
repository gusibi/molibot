# 任务 Prompt · 第一批:P0 地基 + P1 审计 + P2 首批组件 + P3 试点(仅 Chat 页)

> 本批是 `ui-library-tech-design.md` 实施计划的第一个垂直切片:打通"地基 → 审计 → 组件 → 真实页面落地"全链路,用 Chat 页做 P3 试点验证整套方案,后续批次再铺开其余页面。
> 通用规则见 `ui-library-task-prompt.md`(已锁定决策、规格获取方法、切片完成定义、踩坑注意项),**先读它和 `ui-library-tech-design.md`(v3)再动手,§9 决策不许重议**。

---

## 本批范围(四步,顺序执行)

### Step 1 — P0 地基

1. 建 `package/ui` 骨架(`@molipibot/ui`,源码消费、不做独立构建),`pnpm-workspace.yaml` **只**新增 `package/ui` 一条。
2. 从本地 Astryx 克隆(仓库同级目录 `../astryx`)快照 token 契约:
   - 读 `../astryx/packages/core/src/theme/tokens.stylex.ts` 的全部 `*Defaults`(color/spacing/size/radius/shadow/duration/ease/typography/typeScale/fontWeight);
   - 生成 `src/tokens/contract.css`(`--ui-` 前缀 + Astryx 实名,含注释文档)与 `src/tokens/theme.astryx.css`(默认值快照,颜色保持 `light-dark()` 双值)。
   - motion token 必须纳入;`theme.geist.css` 本批只建占位文件(P5 才填)。
3. 在 `package/ui` 内搭 Storybook(`@storybook/svelte-vite`),全局 decorator 支持:theme 切换(本批只有 astryx)+ 亮/暗切换(切 `color-scheme`)。
4. `light-dark()` 实测:在 Web 端跑通 `color-scheme` 亮暗切换即可(Desktop WKWebView 实测留到 P5 前,本批不阻塞)。
5. bits-ui 冒烟:确认现有 Web 构建里 bits-ui 组件可正常用于新包组件(它已是 Web 依赖,预期直接通过)。

### Step 2 — P1 Web 审计(全量,不只 chat)

扫 `src/routes/` 全部页面(约 22 个 settings 页 + 根 chat 页)与 `src/lib/components/`,产出两张清单,**写进 `ui-library-tech-design.md` 新增的「实施进度」小节或其附录**:

1. 「已用组件清单」:`src/lib/components/ui` 17 个组件各自被哪些页面使用、使用频次;
2. 「内联 UI 缺口清单」:页面里手写、应抽成组件的 UI 模式(重点标注 chat 页,`src/routes/+page.svelte`,约 2800 行单文件);
3. 据此给出 P2 全量组件优先级排序(频次为主序;被复合组件依赖的原子优先;Desktop 会复用的优先),并标出**本批要实现的子集**(见 Step 3)。

### Step 3 — P2 首批组件(只做 Chat 页需要的)

只实现 **Chat 页改造所需的原子/交互组件**(以 P1 审计为准,预计 8–12 个,典型如:button / icon-button / input / textarea / select(bits-ui 行为)/ card / badge / skeleton / separator / tabs / 消息气泡与会话列表行等 chat 特有组件中"通用可复用"的部分)。

每个组件:
- 视觉规格直接对照 `../astryx/packages/core/src/<Name>/<Name>.tsx` 的 `stylex.create` 块(间距/transition/伪类/reduced-motion 全要);props 形态参考 `pnpm astryx component <Name> --json --dense`;
- 遵守 §6.2 三条硬规范:组件私有变量(`--_component-*` + `--ui-*` 回退)、图标 snippet 注入(不硬编码图标库)、size 机制——**做第一个组件前先定 size 传递约定并写进设计文档**;
- scoped `<style>` + 语义类名,禁 Tailwind 工具类、禁硬编码视觉值;
- 配 story,亮/暗两态目检。

Chat 特有但非通用的 UI(如消息流布局)不进 `package/ui`,留在页面层用语义类名重写。

### Step 4 — P3 试点:只改造 Chat 页

改造 `src/routes/+page.svelte`(根路由 chat 页):

1. `src/app.css` 引入 `theme.astryx.css`(注意:此时其余页面仍在旧样式体系,确认 token 引入不影响未改造页面);
2. 页面改用 `package/ui` 组件替换内联 UI;把这个 2800 行文件按职责拆分(消息列表、输入区、会话侧栏等子组件),拆出的子组件放页面同级或 `src/lib/`,通用者沉淀进 `package/ui`;
3. 页面级布局语义化,**移除本页的全部 Tailwind 工具类**(全局 `@tailwindcss/vite` 依赖不动,后续批次摘);
4. 功能回归重点:会话切换、消息流式渲染、markdown 渲染、文件预览、i18n、亮/暗两种模式。

**其余 settings 页本批一律不碰。**

## 本批完成定义

- `svelte-check` 0 errors / 0 warnings;`vite build` 通过;相关 `*.test.ts` 通过——结果写进 CHANGELOG 条目。
- 新组件全部在 Storybook 亮/暗两态下目检过;chat 页在浏览器实际走一轮核心流程(发消息、切会话、切亮暗)。
- 更新 `features.md` + `CHANGELOG.md`(同批完成)。
- 在 `ui-library-tech-design.md` 维护「实施进度」:P0 ✅ / P1 ✅(附两张清单)/ P2 已完成组件列表 / P3 chat 页 ✅,并记录偏差(尤其 P1 审计若显著改变 P2 全量范围,先更新文档再继续)。
- 给出下一批(P2 剩余组件 + P3 其余页面分批方案)的建议切法。

## 本批特别注意

- Chat 页是全站最大的单文件,**先拆结构、后换组件**,避免一次 diff 里同时做两件事导致回归无法定位。
- chat 页有流式渲染与异步会话加载,改造时警惕 CLAUDE.md 踩坑记录里的 Svelte 5 反应性与 stale async 问题(请求带 generation/ownerId 校验的现有逻辑不许弄丢)。
- 任何 toggle 用 `IosSwitch`;引用 CSS 变量前确认它在 contract.css 里存在。
