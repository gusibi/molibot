# 任务 Prompt:实施共享 UI 组件库(Astryx 视觉 · Svelte 实现)

> 用法:将本文件内容作为初始任务指令交给执行者(人或 agent)。每个新会话/新阶段都从头引用本文件 + 设计文档。

---

你在 Molipibot 仓库(SvelteKit + Svelte 5 多渠道 bot 框架)中执行一个 UI 重构项目。

## 第一步:读这三份文件,再动手

1. `AGENTS.md` 与 `CLAUDE.md` — 项目协作规则、分层边界、验证约定,**全程遵守**。
2. `ui-library-tech-design.md` — 本任务的技术方案(v3)。**这是唯一的需求来源,方案 §9 的 8 项决策已全部评审确认,不要重新讨论或推翻**;发现方案与现实冲突时,停下来向 owner 报告,不要自行改方向。
3. `DESIGN.md`(Web 语义类名规范)与 `DESIGN.vercel.md`(Desktop Geist)。

参考源码:Astryx 官方仓库已克隆在本仓库的**同级目录** `../astryx`(不要把任何绝对路径写进代码或文档)。

## 任务目标(一句话)

建立 `package/ui` 共享 Svelte 组件库:视觉规格照抄 Astryx、token 用 `--ui-` 前缀对齐 Astryx 实名、`light-dark()` 双值暗色、行为层复用 bits-ui;先完成 Web 端(Astryx 皮)全量组件化 + 去 Tailwind,再接入 Desktop(Geist 皮)。

## 已锁定的关键决策(违背任何一条即返工)

- 目录是 `package/ui`(单数,与 mory/acp 并列);pnpm workspace 只新增这一个条目。
- **不用 React、不用 StyleX、不依赖 `@astryxdesign/*` 运行时包**。Svelte 5 runes + scoped `<style>` + CSS 变量。
- 颜色 token 一律 `light-dark(亮, 暗)` 双值 + `color-scheme` 切换(方案 B);P0 需在目标最低 macOS 版本的 Tauri WKWebView 实测,失败走"构建期拆分为 `:root`/`.dark`"兜底,不改组件。
- token 命名 = `--ui-` 前缀 + Astryx 实名(如 `--ui-color-text-primary`),全量清单快照自 `../astryx/packages/core/src/theme/tokens.stylex.ts` 的各 `*Defaults`;motion token(duration/ease)必须纳入。
- 组件三条硬规范(§6.2):① 关键属性用组件私有变量 `var(--_button-radius, var(--ui-radius-element))`;② 内置图标位通过 snippet/props 注入,不硬编码图标库;③ size 机制在 P2 第一个组件前统一定死。
- 组件展示用 Storybook(`@storybook/svelte-vite`,放在 `package/ui` 内),每个组件的 story 带 Astryx/Geist 双主题 + 亮/暗切换。
- Web 端 Tailwind **最终全部移除**:组件内禁止工具类,P3 逐页把布局语义化,全部完成后摘除 `@tailwindcss/vite`。
- 交互组件(select/tabs/dialog/dropdown/tooltip)行为层用 bits-ui,只自写视觉。

## 如何取 Astryx 规格

- 单个组件的精确视觉规格:直接读 `../astryx/packages/core/src/<Name>/<Name>.tsx` 的 `stylex.create` 块(含间距、transition、伪类、reduced-motion 降级)——**以源码为准,文档为辅**。
- 组件 props/用法文档:在 astryx 仓库内跑 `pnpm astryx component <Name> --json --dense`(支持 `--lang zh`)。
- theme 文件底稿:可用 `pnpm astryx theme build` 编译 defineTheme 得到纯 CSS。

## 执行方式:按阶段切片,禁止一把梭

按设计文档 §7 的 P0→P5 顺序执行。**每个会话只做一个阶段(P2/P3/P4 内部再按批拆分)**,建议切法:

| 会话 | 内容 |
|---|---|
| 1 | P0 地基 + P1 Web 审计(两张清单) |
| 2–4 | P2:约 15 个原子组件,按依赖序分批(先 button/input/label/icon 等被依赖的原子) |
| 5–10 | P3:约 30 个设置页按功能域分批改造(每批含去 Tailwind) |
| 11–12 | P4:dialog/dropdown/tooltip/toast 等交互组件 |
| 13–15 | P5:Desktop 接入 Geist theme + 逐面替换 ad-hoc UI |

P2 优先级:P1 审计的使用频次为主序;同频次时,被复合组件依赖的先做、Desktop 也会用到的先做。

## 每个切片的完成定义(缺一不可)

1. 验证通过并在 CHANGELOG 条目中写明结果:Web 侧 = `svelte-check` 0 errors/0 warnings + `vite build` + 相关 `*.test.ts`;Desktop 侧(P5)另加 desktop UI 测试。
2. 新/改组件在 Storybook 中双主题、亮/暗四种组合下目检过。
3. 更新 `features.md` 与 `CHANGELOG.md`(同一切片内完成,不拖欠)。
4. 在 `ui-library-tech-design.md` 顶部维护一个「实施进度」小节:勾掉已完成批次,记录偏差与遗留。

## 注意项(来自本仓库踩坑记录)

- 任何 toggle 一律用 `IosSwitch`,不用通用 `Switch`。
- 不确认存在的 `var(--token)` 不许引用(CSS 变量失效是静默的)。
- 复用共享模块,不许 fork 副本;通用组件内不许出现项目/渠道条件分支,差异由调用方注入。
- Svelte 5 陷阱:legacy `$:` 不追踪其他模块的 runes `$state`;模板里裸调用无参函数不建立依赖追踪;`onMount` 与 `$:` 不要重复触发同一异步加载。
- 遇到与方案冲突、或 P1 审计结果显著改变 P2/P3 范围时,先更新设计文档并说明,再继续。

**从会话 1(P0 + P1)开始。**
