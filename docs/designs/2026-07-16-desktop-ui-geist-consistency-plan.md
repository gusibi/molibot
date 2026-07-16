# 桌面端 UI 一致性修复方案(Geist 收敛计划)

> 依据:2026-07-16 apple-design skill 审查报告 + DESIGN.vercel.md(Geist)。
> 目标:消灭三种并存风格(Geist 扁平 / Liquid Glass 残留 / 组件私有 ad-hoc),全面收敛到 Geist 扁平风;修复静默坏样式;补齐动效对称性、排版纪律与无障碍。
> 原则:**只收敛、不重设计**。所有改动落在 token 与既有类上,不引入新组件形态。

---

## 阶段划分

| 阶段 | 主题 | 性质 | 预估规模 |
|---|---|---|---|
| P0 | 静默 bug 修复(坏 token / 坏深色模式) | bug fix | ~10 处点改 + 1 个组件重建 |
| P1 | 风格统一(焦点环 / 阴影 / 圆角 / 材质 / scrim / 动效对) | 重构 | styles.css 系统性替换 + 4 个组件 |
| P2 | 排版与无障碍(字号地板 / 字重 / 字距 / aria-label / 对比度) | 打磨 | 全局替换 + i18n 增量 |
| P3 | 防回归机制(静态检查测试)+ 文档同步 | 基建 | chat-ui.test.mjs + 文档 |

每阶段独立可发布;P0 可单独出补丁版本。

---

## P0 静默 bug 修复

### P0-1 补齐/替换失效 token 与 keyframe(styles.css)

| 位置 | 现状 | 改为 |
|---|---|---|
| `styles.css:2721` `.memory-trace-state .ph-spinner-gap` | `animation: spin .8s linear infinite`(无此 keyframes) | `animation: activity-spin .8s linear infinite`(复用既有 keyframes,不新增) |
| `styles.css:2730` `.memory-trace-tags span, .memory-write-kind` | `background: var(--hover-bg)` | `background: var(--fill)` |
| `styles.css:2734` `.memory-trace-actions button:hover…` | `background: var(--hover-bg)` | `background: var(--fill)` |
| `styles.css:2736` `.memory-feedback-reasons` | `background: var(--hover-bg)` | `background: var(--fill)` |
| `styles.css:721` `.settings-action-toast` | `background: var(--popover-bg)`(未定义→透明) | `background: var(--card-bg)` |
| `styles.css:839` `.project-change-status` | `font: 11px/16px var(--font-sans)`(未定义→整条失效) | `font: 11px/16px var(--font-ui)` |
| `styles.css:2484-2493` 低性能模式 | 引用已删除的 `.pug--typing` `.pug-paw` `.pug--phone` `.pug-phone i` `.pug-tail` `.subagent-pug` `.subagent-pug em` `.agent-link` `.agent-link .ph` | 从选择器列表中删除这些死引用 |

### P0-2 ConversationBrowserDialog 重建在共享模态骨架上

文件:`apps/desktop/src/lib/chat/ConversationBrowserDialog.svelte`

问题:`var(--surface, #fff)` / `var(--border, …)` 未定义 → 深色模式白卡;opacity 层级;粉色 danger fallback;ad-hoc 阴影;无入场动画;英文 aria-label。

改法(结构保留,样式换血):
- 外层 `.conversation-browser-overlay` → 复用全局 `.modal-overlay`(scrim 统一见 P1-4)。
- 卡片 `.conversation-browser` → 复用 `.modal-card` 的底色/边框/阴影:`background: var(--card-bg); border: 0.5px solid var(--glass-border); box-shadow: var(--glass-shadow); border-radius: var(--rounded-md)`。组件内只保留布局(宽度 `min(560px,100%)`、`max-height: 76vh`、flex 列)。
- 文字层级:`opacity: .6/.75` → `color: var(--label-secondary)` / `var(--label-tertiary)`。
- 所有 fallback 修正:`var(--danger, #e4106e)` → `var(--danger)`;`var(--border,…)` → `var(--separator)`;`var(--accent, #006bff)` 保留(fallback 正确)。
- 搜索框 focus 样式与 composer 对齐(P1-1 的 focus-within 规则)。
- 关闭按钮 `aria-label="close"` → i18n 键(如 `text.close`,i18n.ts 已有关闭类文案则复用)。
- 入场动画:与实体编辑器共用 `settings-editor-in`(P1-5 会将其改名为通用 `modal-in`)。

### P0-3 ConversationRow 假 token / 错 fallback

文件:`apps/desktop/src/lib/chat/ConversationRow.svelte`

- `.status-dot[data-color="completed"]`:`var(--success, #28a948)` → `var(--online)`(修复深色模式绿点不换色)。
- 所有 `var(--danger, #e4106e)` → `var(--danger)`(粉色 fallback 移除;`--danger` 全局必定义)。
- 行菜单 `box-shadow: 0 8px 24px … , 0 2px 6px …` → `var(--popover-shadow)`;`background: var(--panel-bg,#fff)` → `var(--card-bg)`。

### P0-4 验证(P0 出口条件)

- `pnpm run desktop:check`(svelte-check 0 err/0 warn)+ `vite build` + 桌面 UI 测试。
- 手工核对:深色模式打开会话浏览对话框(卡片为深色)、记忆抽屉 loading 图标旋转、设置页触发保存 toast(有底色)、深色模式会话行 completed 状态点为 #4ce15e。

---

## P1 风格统一

### P1-1 焦点样式二元规则

新增规则并全局执行(styles.css 顶部注释写明):

- **键盘焦点(`:focus-visible`)**:一律两层环 `box-shadow: 0 0 0 2px <所在表面色>, 0 0 0 4px var(--accent)`(已有全局规则,保留)。
- **文本输入容器(`:focus-within`)**:一律柔性光晕 `border-color: color-mix(in srgb, var(--accent) 38%, var(--control-border-strong)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent)`(即 `.composer:focus-within` 现状,提炼为可复用片段)。

需要替换的偏离点:

| 位置 | 现状 | 改为 |
|---|---|---|
| `styles.css:2750` `.memory-center-tabs button:focus-visible` 等 6 个选择器 | `outline: 2px solid var(--accent); outline-offset: 2px` | 两层环(表面色用 `var(--card-bg)`) |
| `styles.css:2256` `.external-row.active` | `outline: 2px solid var(--accent); outline-offset:-2px` | 这是选中态不是焦点:改 `background: var(--accent-soft)`(与 `.conversation-row.active` 一致) |
| `.search-field:focus-within`、`.installed-skills-search:focus-within`、`.automation-workspace-search:focus-within`(硬两层环) | 硬环 | 柔性光晕 |
| `.automation-search:focus-within`、`.memory-all-search:focus-within` | 已是柔光晕但参数各异 | 统一为标准柔光晕参数 |
| `.settings-search:focus-within`、`.settings-field input:focus`(styles.css:1693,混用 `:focus`) | 硬环且用 `:focus` | 容器类改柔光晕;`:focus` 改 `:focus-visible`/`:focus-within` |

### P1-2 圆角吸附 token

规则:视图内只允许 `--radius-small(6)/--radius-control(8)/--radius-panel(12)/--radius-full`。

| 位置 | 现状 | 改为 |
|---|---|---|
| `.message-memory-trace`(styles.css:2693) | 7px | `var(--radius-control)` |
| `.automation-search`(1963)、`.automation-schedule-panel` 移动端 9px(2056) | 9px | `var(--radius-control)` |
| `.task-bulk-bar`(1995)、`.memory-trace-card`(2727) | 10px | `var(--radius-panel)`(卡)/ bulk-bar 用 `--radius-control` |
| `.memory-trace-tags span / .memory-write-kind`(2730)5px、`.memory-feedback-reasons`(2736)8px、`.memory-trace-actions button`(2732)6px | 5/6/8 混用 | 统一 `var(--radius-small)`(chips)与 `var(--radius-control)`(容器) |
| `.automation-command-mark`(1953) | 15px | `var(--radius-panel)` |
| `.slash-suggestion-icon`(1233) | 8px | `var(--radius-control)` |
| `.task-schedule-tabs button`(2006) | 6px 裸值 | `var(--radius-small)` |
| BotAvatar.svelte `.bot-avatar` | 8px 裸值 | `var(--radius-control, 8px)` |
| ConversationBrowserDialog `.browser-search` 8px、卡片 12px | 裸值 | token(随 P0-2 一并) |

### P1-3 阴影收敛三档

规则:弹出层=`--popover-shadow`,模态/抽屉=`--glass-shadow`,卡片/激活分段=`--soft-shadow`。

| 位置 | 现状 | 改为 |
|---|---|---|
| BotMention.svelte 弹层 | `0 14px 40px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.12)` | `var(--popover-shadow)` |
| ConversationRow 行菜单 | ad-hoc(P0-3 已改) | — |
| `.automation-category-tab.active`(635)`0 1px 3px var(--gray-alpha-200)`、`.memory-center-tabs button.active`(2749)`0 1px 3px rgba(0,0,0,.08)`、`.model-tab-button.active`(1839)`0 1px 2px rgba(0,0,0,.05)` | 三种微阴影 | 统一 `var(--soft-shadow)` |
| 窄屏文件面板(871)`-12px 0 32px rgb(0 0 0/12%)`、记忆抽屉(2711)`-18px 0 48px rgba(0,0,0,.16)` | ad-hoc 侧投影 | 统一新增一档侧向阴影 token `--drawer-shadow: -8px 0 24px -8px rgba(0,0,0,.12)`(dark: `.4`),两处共用 |
| `.trend-peak-tag`(1539) | `var(--soft-shadow)` ✓ | 不动(正确示范) |

### P1-4 scrim 与模态遮罩统一

新增 token:

```css
:root { --scrim: rgba(0,0,0,0.35); }
:root[data-theme="dark"], (prefers-color-scheme 分支) { --scrim: rgba(0,0,0,0.55); }
```

替换五处透明度各异的遮罩:`.modal-overlay`(.32)、`.preview-overlay`(.45)、`.onboarding-overlay`(.35)、`.project-dialog-backdrop`(.48)、`.memory-trace-backdrop`(.28)、ConversationBrowserDialog(.35)→ 全部 `background: var(--scrim)`。

实体编辑器(`#desktop-*-form`,styles.css:1726)的 `box-shadow: 0 0 0 100vmax rgba(0,0,0,0.34)` 技巧 → 保留结构不动(改成真 overlay 涉及 DOM 层级,风险大),仅把 `0.34` 换成 `var(--scrim)` 不可行(box-shadow 不接受含 alpha 的变量拼接没问题,可以直接 `0 0 0 100vmax var(--scrim)`)——采用后者。

### P1-5 动效体系:easing 双 token + 模态对称进出

1. 新增 easing token,全局只允许两个:

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);      /* 已有:状态变化、hover */
--ease-spring:   cubic-bezier(0.175, 0.885, 0.32, 1.1); /* 有动量语义的进出场 */
```

替换散落曲线:`conversation-empty-in`(.2,.8,.2,1)、`settings-editor-in`(.2,.8,.2,1)、`mention-pop`(.2,.8,.2,1)→ `var(--ease-spring)`;`agent-city-shell`/`agent-city-tooltip` 的 `.175,.885,.32,1.1` → `var(--ease-spring)`。

2. `settings-editor-in` 改名 `modal-in` 并补对称退场 `modal-out`(镜像:fade + 下移 8px + scale .985,时长 150ms ≈ 入场的 80%)。应用面:六个实体编辑器、`.modal-card`、ConversationBrowserDialog、确认对话框。实现方式:关闭时先切 `closing` class,`animationend` 后卸载(各组件在关闭 handler 中加一帧延迟;Svelte 可用 `on:animationend` 或 `setTimeout(150)` 兜底)。
3. 记忆抽屉进出场:`translateX(100%) → 0` 入场 240ms `--ease-spring`、退场 200ms 镜像;backdrop 同步 fade。`prefers-reduced-motion` 下两者都退化为 150ms opacity cross-fade。
4. 窄屏文件面板(820px 断点 fixed 抽屉)同样右进右出。
5. 弹层锚定:`.overflow-menu-popover`、`.row-menu`、`.command-palette`、BotMention 弹层统一加 `transform-origin: top right`(或按触发方向)+ 通用 `popover-in`(scale .98→1 + fade,120ms `--ease-spring`)。`mention-pop` 删除,改用通用动画。
6. `.message-actions` hover 出现加 `transition-delay: 80ms`(仅入场,离开立即),消除快速划过闪烁。
7. `.sandbox-preset-card:hover` 的 `translateY(-1px)` 补 reduce-motion 豁免(与 `.automation-card` 同款规则合并)。

### P1-6 记忆抽屉去毛玻璃(采纳推荐项)

`styles.css:2702-2712` `.memory-trace-drawer`:
- `background: color-mix(in srgb, var(--card-bg) 96%, transparent)` → `var(--card-bg)`
- 删除 `backdrop-filter: blur(24px) saturate(1.15)`
- `box-shadow` → `var(--drawer-shadow)`(P1-3)

随之:`styles.css:2447-2450` 的空 `prefers-reduced-transparency` 块删除(应用内不再有半透明表面);低性能模式的 `backdrop-filter: none` 覆盖保留(防御)。

### P1-7 设置页头滚动边缘(激活 is-scrolled)

`PageHeader.svelte` 已输出 `.is-scrolled`,补样式(渐变遮罩优于 1px 实线):

```css
.settings-page-header { position: relative; }
.settings-page-header.is-scrolled::after {
  content: ""; position: absolute; inset: auto 0 -6px; height: 6px;
  background: linear-gradient(to bottom, var(--gray-alpha-100), transparent);
  pointer-events: none;
}
```

聊天页头维持现有 1px 实线不动(有 header-bg 实底,风格允许),但若要完全一致可同样换渐变——本方案选**保留聊天实线**,只修设置页(改动最小)。

### P1-8 `.empty-state` 拆类

- `styles.css:1418-1422` 的 settings 版 `.empty-state` 整体改名 `.section-empty`(含 `> .ph` / `strong` / `p` / `-action` 子规则)。
- 使用方:`lib/components/ui/EmptyState.svelte` 改用 `.section-empty`;聊天页的 `.empty-state`(929)保持原名不动。
- 全仓 grep `class="empty-state` 确认没有第三处依赖合并行为。

### P1-9 组件私有样式回收(小项)

- ChannelAccordion / ChatSidebar / ProjectTree:样式基本合规,仅统一 fallback 写法(`var(--label-secondary, #666)` 这类 fallback 允许保留,但值必须等于 light 主题真值;`#8a8a8a`、`#28a745` 等错误 fallback 修正为 `#8f8f8f`、`#28a948`)。
- `.project-location-option:hover`:accent 边框+accent-soft 底 → 改 `border-color: var(--control-border-strong); background: var(--fill)`;`.selected`(若有)才用 accent 对。

---

## P2 排版与无障碍

### P2-1 字号地板与 type ramp

新增注释性 ramp(不强制 token 化,避免大改;以“允许值清单”执行):

- 标题:22 / 18 / 15 / 14(600)
- 正文/标签:14 / 13 / 12
- 最小 meta:**11px**(唯一允许的最小值)
- mono 同步:13 / 12 / 11

替换清单(全部 <11px 升档,styles.css 内约 40 处,组件内约 6 处):

| 现值 | 出现位置(代表) | 改为 |
|---|---|---|
| 7px | `.agent-city-fallback-floor em`(2610) | 9px→ 保留例外:Agent City 插画标签允许 9px 地板(见下) |
| 8px | `.memory-fact-trust`、`.memory-fact-row time`、`.memory-record-tags em`、agent-city 各 small | 10px(城市标签)/ 11px(功能文本) |
| 9px | `.slash-suggestion-heading`、`.observatory-table th`、`.automation-status`、`.task-history-modal-head span`、`.memory-*` 各处 | 11px(表头/eyebrow 类保留大写+字距即可保持层级) |
| 10px | `.icon-badge`、`.channel-chip-label`、`.queued-*`、`.automation-*` meta、`.memory-*` | 11px |
| 12.5px | BotMention | 13px |

**例外区**:Agent City 画布内标签(`.agent-city-agent-copy`、fallback 楼层)为插画元素,地板放宽到 9px;但 tooltip 内文(信息载体)执行 11px 地板。

### P2-2 字重收敛 400/500/600

全局替换:`520→500`、`540→500`、`550→500`、`580→600`、`620→600`、`630→600`、`650→600`、`750→600`(kicker 类用 600+大写+字距补层级)。涉及 automation / memory / observatory / agent-city 区约 25 处。

### P2-3 字距分档

新增 token 并替换散值:

```css
--tracking-tight: -0.02em;  /* ≥18px 标题 */
--tracking-normal: 0;       /* 正文 */
--tracking-caps: 0.04em;    /* 大写 eyebrow/表头 */
```

- `.settings-page-header h2`(-0.04em)、`.conversation-empty h2`(-0.04em)→ `--tracking-tight`(-0.02em;22px 按 Geist 应约 -0.9px≈-0.04em,但为减少档位统一 -0.02em,视觉回归确认)。
- `.automation-command-summary strong`(-.055em,40px)→ 保留(接近 Geist 40px 档 -0.06em),写成注释豁免。
- `.11em`(slash-suggestion-heading)→ `--tracking-caps`。

### P2-4 警告色文字对比度

```css
:root { --warning-text: #aa4d00; }            /* amber-900 */
:root[data-theme="dark"]… { --warning-text: #ffb224; }
```

替换文字场景:`.external-error`、`.project-change-status.status-modified` 的 `color`、`.status-badge[data-state="warning"]` 的 `color`、`.onboarding-error`、`.memory-runtime-state i`(图标可保留 --warning)。边框/底色场景(`.model-banner`、`.approval-card`)继续用 `--warning`。

### P2-5 图标按钮 aria-label 全量补齐

范围(用无障碍树验证过的空名按钮):
- `ChatSidebar.svelte` / `SidebarNav.svelte`:新对话、自动任务、技能、Agent、各频道项、设置齿轮、折叠钮。
- `ChatHeader.svelte`:搜索、文件面板开关等 icon-button。
- `ChatInputArea.svelte`:附件、录音、发送(发送若已有文本则跳过)。
- `ConversationBrowserDialog`:关闭按钮(P0-2 已含)。
- 各 Section 的 `.row-icon-btn` / `.modal-close` / `.overflow-menu > summary`(加 `aria-label` 或 `aria-haspopup`+label)。

做法:i18n.ts 新增 `a11y*` 键(中英双语),模板逐个补 `aria-label={text.a11yXxx}`。验收:axe 或无障碍树扫描,交互控件 0 空名。

### P2-6 reduced-motion 补漏

全局 reduce 块(2461)追加:

```css
.skeleton-row span, .skeleton-row i,           /* skeleton-pulse */
.conversation-empty,                            /* conversation-empty-in */
.bot-mention-pop-target                         /* popover-in(P1-5 后的统一类)*/
{ animation: none !important; }
```

并在 reduce 下将 P1-5 的 modal/drawer 进出改为 opacity cross-fade(`transform: none !important` + `transition: opacity 150ms`)。

### P2-7 主题切换缓和(可选,末位)

切主题瞬间给 `<html>` 挂 `theme-transition` class(300ms 后移除),class 内 `* { transition: background-color 200ms var(--ease-standard), color 200ms var(--ease-standard) !important; }`。`prefers-reduced-motion` 下不挂。实现在 App.svelte 主题切换处。

### P2-8 Agent City 深色补漏

- `styles.css:2585` `.agent-city-overflow` 补深色覆盖:`:root[data-theme="dark"] .agent-city-overflow { border-color: rgba(255,178,36,.35); background: rgba(86,25,0,.85); color: #ffdc73; }`(prefers-color-scheme 分支同步)。
- 硬编码 hex 不做 token 化(插画区豁免),仅补齐深色分支缺口。

### P2-9 等宽字体栈统一

全局替换为 `var(--font-mono)`:`styles.css:1124`(code-block-head)、`1110`(markdown code)、`1156`(approval-field code)、`1181`(run-activity pre)、`2066`(logs pre)、`2403`(runtime-install-command)、`1236/1238/1244/1293`(Geist Mono 硬编码)等。`--font-mono` 保持现值(SF Mono 优先)。

### P2-10 Onboarding 微调

- `--sidebar-surface` 借用 → `var(--fill)`(steps、channels、health-check-card)。
- 步骤完成态:`line-through` → `ph-check-circle` 图标 + `color: var(--online)`。

---

## P3 防回归机制 + 文档

### P3-1 chat-ui.test.mjs 新增三条静态检查

对 `styles.css` + 所有 `.svelte` 内 `<style>` 块做文本级断言:

1. **未定义 var 引用**:收集所有 `--x:` 定义(styles.css + 各 style 块 + 已知 inline 白名单 `--sidebar-w/--detail-drag/--kpi-accent/--dot/--c/--badge-color/--file-color/--agent-city-height/--size/--conversation-row-overlay`),断言每个无 fallback 的 `var(--x)` 都有定义。
2. **未定义 keyframes**:`animation(-name)?:` 中出现的名字(排除 `none`)必须有对应 `@keyframes`。
3. **字号地板**:`font-size` < 11px 仅允许出现在白名单选择器(agent-city 插画区);新增违规即失败。

(可选第 4 条:`box-shadow` 中的裸 `rgba(0,0,0` 投影只允许出现在 token 定义行。)

### P3-2 文档同步(每阶段随 slice 更新)

- `features.md`:记录"桌面端 UI Geist 一致性收敛(P0/P1/P2)"条目。
- `CHANGELOG.md`:按阶段记 fix/refactor,注明验证结果(svelte-check 0/0 + vite build + desktop tests)。
- `DESIGN.vercel.md` 附录补三条项目化决策:焦点二元规则、easing 双 token、11px 字号地板与 Agent City 豁免。

---

## 验证方案(每阶段出口)

1. `pnpm run desktop:check`(svelte-check 0 errors / 0 warnings)。
2. `pnpm --dir apps/desktop run build`(vite build 通过)。
3. `pnpm run desktop:test`(含 P3 新增静态检查)。
4. 手工回归清单(浅/深两主题各过一遍):
   - 会话浏览对话框、六个实体编辑器、任务历史/会话模态:进出场动画对称、scrim 一致;
   - 记忆抽屉:实底、右进右出、spinner 旋转、标签有底色;
   - 设置页滚动:页头出现渐变边缘;保存 toast 有底色;
   - 键盘 Tab 走查聊天页与设置页:焦点环一致为两层环;
   - 系统开启"减弱动态效果":无滑入/缩放,仅淡入淡出;
   - 无障碍树扫描:交互控件无空名。

## 风险与回滚

- **P1-5 退场动画**涉及组件卸载时序(Svelte `{#if}` + animationend),是唯一有逻辑风险的项;每个模态独立提交,坏了单独 revert。
- **P2-1/P2-2 批量字号字重替换**可能引起局部换行/溢出;按区域(memory → automation → observatory)分三次提交,每次跑截图对比。
- 其余均为等价样式替换,风险低;P0 全部是修复既有破损,无视觉回退风险。

## 建议提交切分

1. `fix(desktop): repair silent CSS token/keyframe breakage`(P0-1)
2. `fix(desktop): rebuild conversation browser dialog on shared modal chrome`(P0-2)
3. `fix(desktop): conversation row status token + menu shadow`(P0-3)
4. `refactor(desktop): unify focus rings, radii, shadows, scrim`(P1-1~4)
5. `refactor(desktop): symmetric modal/drawer motion + easing tokens`(P1-5)
6. `refactor(desktop): flatten memory drawer, settings header scroll edge, empty-state split`(P1-6~9)
7. `refactor(desktop): type ramp floor + weight/tracking consolidation`(P2-1~3)
8. `fix(desktop): warning text contrast + dark gaps + mono stack`(P2-4, 2-8, 2-9)
9. `feat(desktop): icon button aria-labels`(P2-5)
10. `test(desktop): static CSS guards (vars/keyframes/font floor)`(P3-1)+ 文档
