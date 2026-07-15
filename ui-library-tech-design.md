# 技术方案:共享 UI 组件库(Astryx 视觉 · Svelte 实现)

> 状态:v3 · 已对照 Astryx 源码 review,评审决策全部确认(见 §9),可进入 P0/P1
> 作者:Molipibot
> 日期:2026-07-11
> 关联文档:`AGENTS.md`、`DESIGN.md`、`DESIGN.vercel.md`(Geist)、`prd.md`
> Astryx 源码本地路径:与本仓库同级的 `astryx/` 克隆(不写绝对路径;下文 `astryx:` 前缀均指该克隆内路径)

---

## 1. 背景与动机

Molipibot 的 **Web 端(设置管理后台)** 视觉粗糙,且存在结构性技术债:大量界面在页面里内联手写,没有抽成可复用组件。与此同时,**Desktop 端** 正在迁移到 Vercel Geist 设计体系,拥有自己的一套视觉语言。

我们希望以 Meta 开源的设计系统 **Astryx** 为**视觉与组件规格的参考**,建立一套 **token 驱动的 Svelte 共享组件库**,一次实现、Web 与 Desktop 两端复用,从根本上解决"丑"和"没抽组件"两个问题。

**关键定位:向 Astryx 借"设计",不借"技术"。** 只采纳它的设计 token 与组件视觉/API 规格,不引入它的 React/StyleX 技术栈。

---

## 2. 目标 / 非目标

### 目标
- 建立 `package/ui` 共享 Svelte 组件库,Web 与 Desktop 均可 import。
- 组件视觉参考 Astryx 规格,通过 **CSS 变量 token 层**实现"一套组件、两张皮":Web 戴 Astryx 皮,Desktop 戴 Geist 皮。
- 将 Web 页面中内联的 UI **抽取为可复用组件**(本方案的核心刚需)。
- 组件写法符合项目既有语义类名规范(`DESIGN.md`),不引入 Tailwind 工具类到组件内部;Web 页面级布局在 P3 一并语义化,最终摘除 Tailwind 依赖。

### 非目标
- **不**整体迁移 Web 前端到 React。
- **不**直接 import / 依赖 Astryx 的 npm 包(`@astryxdesign/*`)作为运行时依赖。
- **不**采用 StyleX 作为样式方案(理由见 §5.3)。
- **不**追求 1:1 复刻 Astryx 全部 150+ 组件;按实际使用量与通用性分批实现。
- **不**在本期废弃 Desktop 的 Geist 迁移方向。

---

## 3. 现状盘点(事实依据)

| 维度 | Web (`src/`) | Desktop (`apps/desktop/`) |
|---|---|---|
| 框架 | SvelteKit + Svelte 5 | Svelte 5(桌面壳) |
| 样式 | Tailwind v4 (`@tailwindcss/vite`) | **纯 CSS + CSS 变量,无 Tailwind、无构建插件** |
| 组件基座 | `bits-ui`(Shadcn 风) | 无 UI 库,chat/projects/settings 各自手写 |
| 设计方向 | 待上 Astryx | Vercel Geist(`DESIGN.vercel.md`) |
| UI 组件数 | `src/lib/components/ui` 17 个组件目录(约 15 个去重原子) | 无独立 UI 层 |
| 路由页面 | 约 30 个设置页 | — |
| 是否复用对方 | — | **完全未复用 Web 组件** |
| 共享包 | **不存在**;`pnpm-workspace.yaml` 仅含 `apps/desktop` | |

**Web 实际用到的原子组件(约 15 个):**
`button / card / alert / badge / checkbox / input / label / select / native-select / switch(ios-switch) / table / tabs / textarea / separator / skeleton`

### Astryx 关键事实(已对照本地源码核实)
- Meta 开源设计系统,**React + StyleX**,MIT 许可,当前 **Beta**。
- 组件规模:`packages/core/src` 约 105 个组件目录,`packages/lab` 另有 14 个;官方主题 7 套(neutral/matcha/stone/gothic/chocolate/y2k/butter)。
- 主打 "built for people and agents":提供 CLI 与 MCP endpoint 供 AI agent 读取;CLI 支持 `--lang zh` 输出中文文档。
- **不存在"导出 JSON UI 协议"能力**(不会把界面序列化成可反渲染的 JSON 树)。其 JSON 能力是**给 agent 读的元数据**:
  - `astryx docs tokens --json` → 设计 token(配色/字号/间距/圆角/阴影/motion),**框架无关的纯数据,本方案会用到**。
  - `astryx component <Name> --json [--dense]` → 组件文档/props/示例,作为**视觉与 API 规格参考**(其源码是 React/StyleX,不可直接翻译)。
  - `astryx theme build <file>` → 把 `defineTheme()` 文件编译为纯 CSS(token 覆盖 + 组件覆盖),可直接用作 theme 文件底稿。
- **源码已克隆到本地**,不依赖 npx 下载:
  - token 全量默认值直接读 `astryx:packages/core/src/theme/tokens.stylex.ts`(`colorDefaults / spacingDefaults / radiusDefaults / typeScaleDefaults / durationDefaults / easeDefaults` 等);
  - 每个组件的精确视觉规格直接读 `astryx:packages/core/src/<Name>/<Name>.tsx` 的 `stylex.create` 块(间距、transition、伪类、reduced-motion 降级),比文档 JSON 更完整。
- ⚠️ **Astryx 的 theme ≠ 纯 token 覆盖**。`DefinedTheme`(`defineTheme.ts`)包含四部分,本方案需逐一决定取舍(见 §5.5、§6.2):
  1. `tokens` — CSS 变量覆盖(本方案主要采纳);
  2. `components` — 按组件/variant 的样式覆盖(如 `button: {'variant:ghost': {borderWidth: '1px'}}`),落地机制是组件私有变量 `--_button-radius` 之类;
  3. `icons` — 主题自带图标注册表(neutral 主题整套换 Lucide);
  4. typography — 字体族与加载(neutral 用 Figtree)。
- ⚠️ **所有颜色 token 都是 `light-dark()` 双值**(如 `--color-accent: light-dark(#0064E0, #2694FE)`),暗色模式是 token 体系的地基,不是附加功能(见 §5.5)。

---

## 4. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                     package/ui (共享)                     │
│  组件结构 + 行为(Svelte 5),视觉只引用语义 CSS 变量        │
│  <style> background: var(--ui-color-surface); ...          │
│  交互行为(select/tabs/dialog)复用 bits-ui,Astryx 仅视觉参考│
└───────────────┬─────────────────────────┬─────────────────┘
                │                         │
      ┌─────────▼─────────┐     ┌─────────▼─────────┐
      │  Web (theme)       │     │  Desktop (theme)   │
      │  --ui-* = Astryx   │     │  --ui-* = Geist    │
      │  token 值          │     │  token 值(已有)    │
      └────────────────────┘     └────────────────────┘
```

**核心机制:token 契约。** 组件内部**永不硬编码视觉值**,只引用一组语义 CSS 变量(`--ui-*`)。每个 app 在自己的全局样式里给这组变量赋值 → 同一套组件在两端呈现不同设计语言。

Astryx 的主题机制以 token 覆盖为主体,但不止于此(还有组件级覆盖、图标注册表、字体,见 §3)。本方案对应的完整契约是三层:
1. **全局 token**(`--ui-*`)— 主题的主体;
2. **组件私有变量**(`--_component-*`)— 每个组件的逃生舱,带全局 token 回退(仿 Astryx `var(--_button-radius, var(--radius-element))` 模式),两张皮在单个组件上策略不同时不用改组件本体;
3. **图标注入**(snippet/props)— 内置图标的组件(select 箭头、alert 状态图标、spinner)不硬编码图标,由调用方或 theme 层注入(Web 可选 Lucide 风格,Desktop 用现有 Phosphor)。

---

## 5. 关键技术决策

### 5.1 为什么不整体迁 React / 不直接用 Astryx
Astryx 是 React 组件库,Web 端是 Svelte,无整库互操作方案。直接用 = 推倒重来用 React 重写整个前端,且 Astryx 尚处 Beta。成本与风险都不可接受。**采纳:重新实现,而非依赖。**

### 5.2 为什么用 CSS 变量 token 层(而非把视觉写死)
Desktop 走 Geist、Web 走 Astryx,是两套设计语言。要让**同一套组件**服务两端,唯一干净的解法是把"视觉值"外置为 CSS 变量,由各 app 注入。Desktop 现有的 Geist 实现已经就是"CSS 变量 + 语义类名",与本方案零摩擦对接。

### 5.3 为什么不用 StyleX(Astryx 的样式方案)
StyleX **不是 React 专属**(框架无关,产出 className + style),但对本项目不合适:
1. **买不到目标能力**:跨 app 换肤靠的是 CSS 变量,StyleX 只是"写样式的方式",并不提供主题切换。引入 = 加一个编译器却没解决实际问题。
2. **拖累 Desktop 构建**:Desktop 现在零构建插件,用 StyleX 得给它接上 Babel/Vite 编译流水线。
3. **违反项目规范**:StyleX 产出原子化 class,与 `DESIGN.md` 语义类名规范相反。
4. **无兼容必要**:我们是重新实现、样式自写,不需要 StyleX 来兼容 Astryx 源码。
5. **Svelte 支持实验性**:官方 demo 需每次构建前删缓存、样式须写在 `<script context="module">`,不宜长期依赖。

**采纳:Svelte 原生 scoped `<style>` + CSS 变量。** 零额外工具,两端写法一致。

### 5.4 交互/无障碍行为的来源
`select / tabs / dialog / dropdown / tooltip` 等需要键盘导航、焦点管理、ARIA 的组件,**行为层继续复用 `bits-ui`**(Web 已在用),Astryx 仅作为**视觉规格**参考。避免自己重造无障碍逻辑。

> 风险评估:**低**。Desktop 是 Tauri + Vite + Svelte 5 的完整前端构建(`apps/desktop/package.json`),`bits-ui` 是纯运行时 Svelte 库、不依赖 SvelteKit,WebView 即标准浏览器环境。P0 仍做一次冒烟验证(引入 bits-ui 渲染一个 Select),预期通过。真正的 P0 验证重点是 §5.5 的 `light-dark()` 支持。

### 5.5 暗色模式与 light-dark 策略(已定:方案 B)

Astryx 全部颜色 token 都是 `light-dark(亮值, 暗值)` 双值,依赖 CSS `color-scheme` 切换;Desktop(Geist)也有自己的暗色需求。token 契约必须在写第一个 theme 文件前定下双模式的表达方式:

- ~~方案 A:单值 token + `.dark` 作用域切换~~ — 兼容性零风险,但 theme 文件写法偏离上游。
- **方案 B(采纳):照搬 `light-dark()`。** theme 文件直接沿用 Astryx 双值写法,`:root { color-scheme: light dark; }` 全局启用,强制某模式时局部改 `color-scheme`。既然定位是"Astryx 的 Svelte 实现",token 表达方式与上游保持一致,快照/对照/回归都免转换。

**决策依据与约束:**
- 浏览器要求:`light-dark()` 需 Safari 17.5+ / Chrome 123+ / Firefox 120+。Web 端(现代浏览器)无风险;Desktop 端 Tauri WKWebView 随 macOS 版本浮动,**接受"最低支持 macOS 版本"随之上调**,P0 在目标最低 macOS 版本上实测确认。
- Geist theme(`theme.geist.css`)同样按 `light-dark()` 双值书写(从现有 styles.css 的亮/暗两套值合并),两套 theme 文件格式统一。
- 若 P0 实测发现目标 WKWebView 不支持,降级路径:用脚本把 `light-dark(a, b)` 机械拆分为 `:root` / `.dark` 两套单值(theme 文件仍以双值为源,构建时转换),组件代码不受影响。

---

## 6. 包结构与工程约定

### 6.1 目录
```
package/ui/               # 沿用仓库现有 package/(单数)约定,与 mory/acp/qqbot 并列
  package.json            # name: @molipibot/ui,私有 workspace 包
  src/
    tokens/
      contract.css        # 语义变量清单(声明契约,含默认值/文档)
      theme.astryx.css    # Web:--ui-* = Astryx token 值(用 astryx theme build / tokens.stylex.ts 快照生成)
      theme.geist.css     # Desktop:--ui-* = Geist token 值(从现有 styles.css 提取)
    components/
      button/Button.svelte
      card/Card.svelte
      ...
    index.ts              # 统一导出
```
- 仓库已有 `package/`(单数)目录(`mory / acp / qqbot / weixin-agent-sdk`),但均未进 workspace(`pnpm-workspace.yaml` 仅含 `apps/desktop`)。**不新开 `packages/`(复数)以免两套目录并存**;workspace 本期只新增 `package/ui` 一个条目,其余 `package/*` 维持现状不动。
- 以**源码形式**被两端 Vite 直接消费(裸导出 `.svelte`,不上 svelte-package 独立构建),两端编译零额外配置。
- Web:`src/app.css` 引入 `theme.astryx.css`;Desktop:`styles.css` 引入 `theme.geist.css`。

### 6.2 组件规范
- Svelte 5 runes;内容通过 snippet 传递。
- 样式一律 scoped `<style>` + `var(--ui-*)`;**禁止**硬编码颜色/间距、**禁止** Tailwind 工具类。
- **组件私有变量层**:可能被单端定制的关键属性写成 `var(--_button-radius, var(--ui-radius-element))` 形式(私有变量 + 全局 token 回退),theme 层可按组件覆盖而不改组件本体(对应 Astryx theme 的 `components` 覆盖机制)。
- **图标注入**:组件不内嵌具体图标库;内置图标位(select 箭头、alert 图标、spinner、关闭按钮)通过 snippet/props 注入,库内只提供默认 SVG 兜底。
- **尺寸传递**:P2 开工前统一定死 size 机制(prop 显式传递,必要时加 Svelte context 做容器级继承,仿 Astryx `SizeContext`),避免 15 个组件各自发明 `size` 形态。
- **motion**:transition 一律引用 `--ui-duration-* / --ui-ease-*` token,并内建 `prefers-reduced-motion: reduce` 降级(Astryx 组件的标准做法)。
- Props 命名与形态参考对应 Astryx 组件(`astryx component <Name> --json --dense`,或直接读 `astryx:packages/core/src/<Name>/<Name>.tsx`)。
- **组件展示用 Storybook**(`@storybook/svelte-vite`,置于 `package/ui` 内):每个组件配 `*.stories`,story 里提供 Astryx/Geist 双主题切换 + 亮/暗切换(方案 B 下即切 `color-scheme`),作为两套皮的评审与回归基准。选 Storybook 而非 Histoire:与 Astryx 上游一致(便于并排对照其官方 Storybook),且维护活跃度更高。

### 6.3 Token 契约
命名**直接对齐 Astryx 实名**(加 `--ui-` 前缀),不自造一层映射——否则每次对照 Astryx 规格/源码都要心算翻译。Astryx 的语义划分(text/icon/border/background × 状态 × 9 色相族)比自造的 `fg/fg-muted` 更细,照抄可省设计决策:

```
颜色:  --ui-color-accent / --ui-color-background-surface / --ui-color-background-body
       --ui-color-text-primary|secondary|disabled|accent
       --ui-color-icon-primary|secondary|accent
       --ui-color-border / --ui-color-border-emphasized
       --ui-color-success|error|warning(+ -muted / on- 变体)
间距:  --ui-spacing-1..N        圆角: --ui-radius-element|container|...
字体:  --ui-font-family-body|heading|code   --ui-text-*-size|leading   --ui-font-weight-*
阴影:  --ui-shadow-*
motion: --ui-duration-fast|...  --ui-ease-standard|...(必须纳入,否则 P2 会硬编码 transition)
```

全量清单以 `astryx:packages/core/src/theme/tokens.stylex.ts` 的 defaults 为准做快照;暗色双值按 §5.5 方案 A 拆分。

---

## 7. 分阶段实施计划

| 阶段 | 内容 | 产出 | 风险 |
|---|---|---|---|
| **P0 地基** | 建 `package/ui` 骨架(含 Storybook);从本地 Astryx 源码(`tokens.stylex.ts` / `astryx theme build`)快照 token 契约;WKWebView `light-dark()` 实测(§5.5);提取 Geist theme(双值格式);bits-ui 冒烟验证 | 包骨架 + 两套 theme 文件 + token 契约 + `light-dark()` 实测结论 | 低(源码在本地,零下载) |
| **P1 Web 审计** | 扫约 30 个路由页,产出「已用组件清单」+「内联 UI 缺口清单」 | 两张清单,驱动 P2 范围 | 零风险(只读自有代码) |
| **P2 实现用到的集合** | 按 P1 用量,token 化实现约 15 个原子组件(视觉规格直接对 `astryx:packages/core/src/<Name>` 源码的 `stylex.create` 块);先定 size/图标/私有变量三条规范(§6.2) | `package/ui` 首批组件 | 中 |
| **P3 改造 Web** | 页面改 import `package/ui`;抽取内联 UI 替换;**页面级布局一并语义化,逐页移除 Tailwind 工具类**(全部页面完成后摘除 `@tailwindcss/vite` 依赖) | Web 全量换肤 + 组件化 + 去 Tailwind | 中(回归测试) |
| **P4 补通用集** | 增 dialog/dropdown/tooltip/toast 等(总数至 30–40) | 更完整组件库 | 中 |
| **P5 接入 Desktop** | Desktop 套 Geist theme,逐步替换 ad-hoc 组件 | 两端统一组件基座 | 中(Geist 观感回归) |

**建议起步:P1**(零风险、零下载,且正是"抽组件"核心刚需,其缺口清单直接决定 P2 范围)。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自建库无升级通道,Astryx 更新不会自动跟进 | 长期维护成本 | 只借视觉规格,不追 API 全等;token 契约集中管理便于批量调整 |
| `light-dark()` / `color-scheme` 在 Tauri WKWebView 支持不确定 | 已选方案 B,Desktop 最低系统版本受牵制 | P0 在目标最低 macOS 版本实测;失败则构建期把双值机械拆分为 `:root`/`.dark` 两套(theme 源文件不变,组件不受影响) |
| 只搬 token、漏掉 Astryx theme 的组件覆盖/图标/字体三层 | 观感"形似神不似" | §4/§6.2 已把私有变量层、图标注入、字体加载纳入契约 |
| `bits-ui` 在 Desktop 壳/构建下不可用 | 交互组件行为层受阻 | 风险评估为低(纯运行时 Svelte 库,Tauri WebView 即浏览器);P0 冒烟验证兜底 |
| Astryx Beta,规格可能变动 | 参考基准漂移 | 以本地克隆的源码快照为准,不做实时对齐 |
| 两套主题回归工作量 | Web 改版可能影响 Desktop 观感 | 组件配双主题示例页;P5 单独做 Geist 回归 |
| 组件化改造引入 UI 回归 | 功能受影响 | 分页面灰度替换,配合现有测试(`*.test.ts` / `chat-ui.test.mjs`) |

---

## 9. 决策记录(评审已确认,无遗留开放问题)

| # | 问题 | 结论 |
|---|---|---|
| 1 | 暗色策略 | **方案 B:照搬 `light-dark()`**,与 Astryx 上游一致(§5.5);P0 实测 WKWebView,失败则构建期机械拆分兜底 |
| 2 | workspace 收编范围 | **本期只加 `package/ui`**,其余 `package/*` 维持现状(§6.1) |
| 3 | Web 的 Tailwind | **不保留,一并语义化**;P3 逐页移除工具类,完成后摘除 `@tailwindcss/vite`(§7) |
| 4 | 组件展示 | **引入 Storybook**(`@storybook/svelte-vite`),与 Astryx 上游对照方便;不用 Histoire、不自建预览页(§6.2) |
| 5 | P2 优先级 | **P1 使用频次为主序**,再按两条规则调整:① 被复合组件依赖的原子先行(button/input/label/icon 等);② 同频次时优先 Desktop(P5)也会用到的组件 |
| 6 | `bits-ui` 在 Desktop 可用性 | 风险评估为低(§5.4),P0 冒烟验证即可 |
| 7 | 独立构建 vs 源码消费 | 源码消费(§6.1) |
| 8 | Astryx CLI 获取 | 源码已在本地,直读源码或本地跑 CLI(§3) |

---

## 10. 附:被否决的方案

- **A. 整体迁 React + 直接用 Astryx** — 等于重写前端,Astryx 尚 Beta。否决。
- **B. 就地给现有 Svelte 组件换肤,不抽组件** — 不满足"抽组件复用"这一核心刚需。否决。
- **C. 采用 StyleX 作为样式方案** — 见 §5.3。否决。
- **D. 期望 Astryx 导出 JSON UI 协议直接渲染** — 该能力不存在。否决。
