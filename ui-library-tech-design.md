# 技术方案:共享 UI 组件库(Astryx 视觉 · Svelte 实现)

> 状态:草案 v2 · 已对照 Astryx 源码 review 修订
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
- 建立 `packages/ui` 共享 Svelte 组件库,Web 与 Desktop 均可 import。
- 组件视觉参考 Astryx 规格,通过 **CSS 变量 token 层**实现"一套组件、两张皮":Web 戴 Astryx 皮,Desktop 戴 Geist 皮。
- 将 Web 页面中内联的 UI **抽取为可复用组件**(本方案的核心刚需)。
- 组件写法符合项目既有语义类名规范(`DESIGN.md`),不引入 Tailwind 工具类到组件内部。

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
│                     packages/ui (共享)                    │
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

> ⚠️ 待确认(开放问题 §9):`bits-ui` 依赖 SvelteKit/浏览器环境的程度,及其在 Desktop(Tauri/Electron 壳)构建下的可用性,需在 Phase 0 验证。若不可用,交互组件的行为层需另选或自实现。

---

## 6. 包结构与工程约定

### 6.1 目录
```
packages/ui/
  package.json            # name: @molipibot/ui,私有 workspace 包
  src/
    tokens/
      contract.css        # 语义变量清单(声明契约,含默认值/文档)
      theme.astryx.css    # Web:--ui-* = Astryx token 值
      theme.geist.css     # Desktop:--ui-* = Geist token 值(从现有 styles.css 提取)
    components/
      button/Button.svelte
      card/Card.svelte
      ...
    index.ts              # 统一导出
```
- `pnpm-workspace.yaml` 增加 `packages/*`。
- Web:`src/app.css` 引入 `theme.astryx.css`;Desktop:`styles.css` 引入 `theme.geist.css`。

### 6.2 组件规范
- Svelte 5 runes;内容通过 snippet 传递。
- 样式一律 scoped `<style>` + `var(--ui-*)`;**禁止**硬编码颜色/间距、**禁止** Tailwind 工具类。
- Props 命名与形态参考对应 Astryx 组件(`astryx component <Name> --json --dense`)。
- 每个组件配 `*.stories`/示例页,便于评审两套主题下的观感。

### 6.3 Token 契约(示例,最终以 `astryx docs --json` 输出为准)
```
--ui-color-surface / --ui-color-surface-muted / --ui-color-border
--ui-color-fg / --ui-color-fg-muted / --ui-color-accent / --ui-color-danger ...
--ui-radius-sm|md|lg   --ui-space-1..8   --ui-font-size-*   --ui-shadow-*
```

---

## 7. 分阶段实施计划

| 阶段 | 内容 | 产出 | 风险 |
|---|---|---|---|
| **P0 地基** | 建 `packages/ui` 骨架;拉 `astryx docs --json` 定 token 契约;提取 Geist theme;验证 `bits-ui` 在两端可用性 | 包骨架 + 两套 theme 文件 + token 契约 | 需 npx 下载 Astryx CLI(待确认) |
| **P1 Web 审计** | 扫约 30 个路由页,产出「已用组件清单」+「内联 UI 缺口清单」 | 两张清单,驱动 P2 范围 | 零风险(只读自有代码) |
| **P2 实现用到的集合** | 按 P1 用量,token 化实现约 15 个原子组件(逐个对 Astryx 规格) | `packages/ui` 首批组件 | 中 |
| **P3 改造 Web** | 页面改 import `packages/ui`;抽取内联 UI 替换 | Web 全量换肤 + 组件化 | 中(回归测试) |
| **P4 补通用集** | 增 dialog/dropdown/tooltip/toast 等(总数至 30–40) | 更完整组件库 | 中 |
| **P5 接入 Desktop** | Desktop 套 Geist theme,逐步替换 ad-hoc 组件 | 两端统一组件基座 | 中(Geist 观感回归) |

**建议起步:P1**(零风险、零下载,且正是"抽组件"核心刚需,其缺口清单直接决定 P2 范围)。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自建库无升级通道,Astryx 更新不会自动跟进 | 长期维护成本 | 只借视觉规格,不追 API 全等;token 契约集中管理便于批量调整 |
| `bits-ui` 在 Desktop 壳/构建下不可用 | 交互组件行为层受阻 | P0 先验证;不可用则改用其它 headless 方案或按需自实现 |
| Astryx Beta,规格可能变动 | 参考基准漂移 | 以某一时间点快照为准,不做实时对齐 |
| 两套主题回归工作量 | Web 改版可能影响 Desktop 观感 | 组件配双主题示例页;P5 单独做 Geist 回归 |
| 组件化改造引入 UI 回归 | 功能受影响 | 分页面灰度替换,配合现有测试(`*.test.ts` / `chat-ui.test.mjs`) |

---

## 9. 开放问题(待评审确认)

1. `bits-ui` 是否能在 Desktop 构建环境下工作?(决定交互组件行为层选型)
2. `packages/ui` 是否需要独立构建产物,还是以源码形式被两端 Vite 直接消费?
3. Web 是否保留 Tailwind 做**布局**(组件内部不用,页面级布局可保留),还是一并语义化?
4. 组件示例/回归展示:是否引入 Histoire/Storybook,还是自建一个 `/settings/_ui` 预览页?
5. P2 首批组件的优先级排序,是否以 P1 审计的使用频次为唯一依据?

---

## 10. 附:被否决的方案

- **A. 整体迁 React + 直接用 Astryx** — 等于重写前端,Astryx 尚 Beta。否决。
- **B. 就地给现有 Svelte 组件换肤,不抽组件** — 不满足"抽组件复用"这一核心刚需。否决。
- **C. 采用 StyleX 作为样式方案** — 见 §5.3。否决。
- **D. 期望 Astryx 导出 JSON UI 协议直接渲染** — 该能力不存在。否决。
